// The map editor's page: a 2-D canvas over map.json (format 1). The document is the parsed map.json itself, so
// members the page doesn't know stay in it; the server writes it back in the file's own layout and checks every
// edit with mapc. The frame (frame.js: menus, toolbar, minimap, docked palettes, status bar) and the other parts (the
// 3-D view, props, ground paint, the void) plug in through ED: ED.on('doc' | 'preview' | 'select' | 'open' |
// 'started', fn), ED.addView({id, title, el, pick, project, ...}) for the main view's other mode (3-D; the views'
// contract and the one input pipeline for both: ED.views, VIEW2D, inputDown), ED.addPane(home, title) for a
// group in a palette tab or a window, ED.actions[name] for what a menu item runs, ED.selftests[mode] for a part's own
// ?selftest=<mode>.
'use strict';

const ED = {
  handlers: {},
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
  emit(ev, ...a) { (this.handlers[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { log(String(e), 'err'); } }); },
  // the main views (EDUX2): views[id] = {id, title, el, pick, pickAt, project, ppm, overlay} (the contract at VIEW2D
  // below); '2d' is app.js's canvas, a part adds another with addView (view3d.js: '3d'); one shows at a time, ED.view
  views: {}, view: '2d',
  addView(v) { // v: {id, title, el, ...the contract; what it leaves out can't pick or draw}; el is placed in #views
    v.el.classList.add('view');
    v.el.id = v.el.id || 'view' + v.id;
    $('views').appendChild(v.el);
    const none = { pick: () => null, pickAt: () => null, project: () => null, ppm: () => 0, overlay: null };
    for (const k of Object.keys(none)) if (v[k] === undefined) v[k] = none[k];
    this.views[v.id] = v;
    renderTabs();
  },
  active() { return this.views[this.view] || this.views['2d']; }, // the view shown
  setView(id) { // shows the view id ('2d' or an added one) and emits 'view'
    const all = Object.values(this.views);
    if (!all.some(v => v.id === id)) return;
    all.forEach(v => v.el.classList.toggle('on', v.id === id));
    this.view = id;
    renderTabs();
    if (id === '2d') resize();
    this.emit('view', id);
  },
  // what the menus, the toolbar and the keys run (frame.js): actions[name] = fn; a part registers its own
  actions: {},
  act(name, ...a) { const fn = this.actions[name]; if (fn) return fn(...a); log('no such action: ' + name, 'err'); },
  // windows: floating panels over the view (the Map menu's, the Advanced menu's, the Map Check); window(id, title)
  // makes one (hidden) and returns its body, openWindow(id) shows it
  windows: {},
  window(id, title) {
    if (this.windows[id]) return this.windows[id].body;
    const sec = document.createElement('section');
    sec.className = 'win hidden';
    sec.id = 'win_' + id;
    sec.innerHTML = '<div class="wh"><span></span><button title="Close">&#x2715;</button></div><div class="wb"></div>';
    sec.querySelector('.wh span').textContent = title;
    sec.querySelector('.wh button').onclick = () => this.closeWindow(id);
    $('windows').appendChild(sec);
    const head = sec.firstChild;
    head.addEventListener('mousedown', e => { // drag the window by its title
      if (e.target.tagName === 'BUTTON') return;
      const r = sec.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const mv = ev => { sec.style.left = (r.left + ev.clientX - x0) + 'px'; sec.style.top = Math.max(0, r.top + ev.clientY - y0) + 'px'; sec.style.right = 'auto'; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    this.windows[id] = { el: sec, body: sec.lastChild, title };
    return sec.lastChild;
  },
  openWindow(id) {
    const w = this.windows[id];
    if (!w) return;
    w.el.classList.remove('hidden');
    $('windows').appendChild(w.el); // on top of the others
    this.emit('window', id, true);
  },
  closeWindow(id) { const w = this.windows[id]; if (w) { w.el.classList.add('hidden'); this.emit('window', id, false); } },
  isOpen(id) { const w = this.windows[id]; return !!w && !w.el.classList.contains('hidden'); },
  // plug-ins (props.js): sel[t] = {value(sel), inspector(el, sel), move(drag, w, e), del(sel)} for a selection type,
  // tools[name] = {down(w, e), move(w, e) and up() (a tool that drags: ground.js), finish(pts) (a polygon drawn
  // with the tool), hover, hint}, hitFirst/hitItems:
  // fn(sx, sy, w, near, pk) -> {sel, mirrored} before the objects (handles) and after them (items), keys(e) -> true;
  // near(p, px) is true when the world point p shows within px CSS pixels of the mouse (through the view's project),
  // pk the view's pick (pk.near: the metres a CSS pixel covers there);
  // down: fn(h, e, w, pk) -> true takes a Select click itself (h the hit or null; propsel.js: Shift/Ctrl+click, the box,
  // dragging a multiple selection) and may set S.grab = {move(w, e), up()} to follow the mouse until it is let go
  // tools[name].status() -> the status bar's tool part (its brush, the doodad being placed); tools[name].tab: the
  // palette tab the tool belongs to (Space switches between Select and the tab's last tool)
  // previews: fn(v) draws what a tool is about to do (a ghost, the brush, a drawing in progress, the scatter's estimate)
  // through the view v: v.overlay (a 2-D context), v.project(p), v.ppm(p); drawPreviews(v) runs them (2-D: render())
  // wheels: fn(e) -> true takes the wheel after the armed tool's (props.js: Alt+wheel raises the selected doodads)
  sel: {}, tools: {}, hitFirst: [], hitItems: [], keys: null, down: [], previews: [], marks: [], wheels: [],
  drawPreviews(v) {
    if (!v || !v.overlay || !S.doc) return;
    for (const fn of this.previews) { try { fn(v); } catch (e) { log(String(e), 'err'); } }
  },
  // marks: fn(v) draws the selection's rings and handles through a view other than the 2-D (whose render() draws the
  // same through the 'draw' events); drawOverlay(v) draws a view's whole overlay: the marks, the previews, the check's
  // markers (EDUX3: the 3-D view each frame)
  drawOverlay(v) {
    if (!v || !v.overlay || !S.doc) return;
    for (const fn of this.marks) { try { fn(v); } catch (e) { log(String(e), 'err'); } }
    this.drawPreviews(v);
    try { drawFindings(v); } catch (e) { log(String(e), 'err'); }
  },
  // addPane(home, title, order) returns the body of a new group: home 'terrain' | 'doodads' | 'units' | 'lanes' (a
  // palette tab; groups sorted by order, then as added) or 'window:<id>' (a window, made hidden: ED.openWindow)
  addPane(home, title, order) {
    if (String(home).startsWith('window:')) return this.window(home.slice(7), title);
    const tab = $('tab_' + home) || $('tab_terrain');
    const sec = document.createElement('section');
    sec.className = 'grp';
    sec.dataset.order = order === undefined ? 50 : order;
    sec.innerHTML = '<div class="gh"></div><div></div>';
    sec.firstChild.textContent = title;
    const after = [...tab.children].find(c => +c.dataset.order > +sec.dataset.order);
    tab.insertBefore(sec, after || null);
    return sec.lastChild;
  },
};

const S = {
  config: null, pkg: null, doc: null, base: null, savedJSON: null, undo: [], redo: [],
  sel: null, hover: null, hoverFinding: null, tool: 'select', drawing: null, drag: null,
  // the Terrain tab's Apply Cliff: the kind a new shape gets (wall, open, chasm, water = a chasm with water, island,
  // bush) the Terrain tab draws, and the draw mode it and the textures share (brush, polygon, circle, path); the Units tab's + Well or + Mine
  cliff: 'wall', draw: 'brush', wellKind: 'well', campType: 'green', stroke: null, lastMaterial: 'shape',
  // the brush both materials draw with (ground.js's G.brush is this object): size and soft edge (m), erase and into
  // the picture (textures), its shape (circle or square)
  brush: { size: 8, soft: 3, erase: false, raster: false, shape: 'circle' },
  snap: false, joined: true, noMesh: false, // Tools > Snap to 1 m, Tools > Drag Joined Shapes Along, Advanced > Build without the PhysX Mesh
  report: null, preview: null, images: null, rev: 0, checkSeq: 0, checking: false, checkTimer: 0,
  bg: 'layout.png', bgAlpha: 0.8, img: null, imgFile: '', imgRev: 0,
  show: { shapes: true, mirror: true, lanes: true, objects: true, props: true, findings: true, bots: true, half: true, grid: false },
  fitted: false, partIdx: {},
  placed: null, placedFrom: null, mouseW: null, press: null, // mouseW: the world under the mouse by the shown view's pick (null where it cannot pick); press: the view that took the left press
  near: 1, // the metres a CSS pixel covers at the last pick (the snaps' reach: feedback.js)
  view: { x: 0, y: 0, scale: 1 }, mouse: null, pan: null, grab: null,
};

const $ = id => document.getElementById(id);
const r1 = v => Math.round(v * 10) / 10;
const mir = p => [-p[0], -p[1]];
const TEAM = ['#58a6ff', '#ff7b72'];
const LANE = { 1: '#f0b44c', 2: '#4cc9f0' };
const TYPE = {
  open: ['rgba(222,205,160,0.30)', '#d9c48f'],
  wall: ['rgba(55,42,38,0.80)', '#b08a70'],
  chasm: ['rgba(40,70,140,0.60)', '#7d9ff0'],
  island: ['rgba(183,177,194,0.55)', '#c9b8e8'], // ground only NPCs walk (a well on it is out of the players' reach)
  bush: ['rgba(60,170,70,0.60)', '#6fe07a'],
};
const TIERS = ['Outer', 'Middle', 'Inner'];
// tierNames are the names of a lane's n Bindings from the own base's far side, as the compiler gives them (mapc
// TierNames): three are Outer, Middle and Inner, two are Middle and Inner (MM_Map_v3's tiers)
function tierNames(n) { return n === 2 ? TIERS.slice(1) : TIERS; }
const LANE_MIN = 6, LANE_MAX = 80; // the check's lanes.width (mapc MinLaneWidth, MaxLaneWidth)
// setLaneWidth sets both lanes' width (the Lanes tab's and the inspector's field) as one undo step; a width the check
// refuses (lanes.width) is refused here (EDUX6), the field shows the width again
function setLaneWidth(v, input) {
  if (!(v >= LANE_MIN && v <= LANE_MAX)) {
    log(`a lane is ${LANE_MIN} to ${LANE_MAX} m wide (lanes.width): ${v} m refused`, 'err');
    if (input) input.value = (lanes()[0] || {}).width;
    return false;
  }
  edit(d => d.lanes.forEach(x => { x.width = v; }));
  return true;
}

// log writes a line into the Messages window (View > Messages, closed by default); an error also flashes in the status
// bar's last part for a few seconds
function log(msg, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  $('log').prepend(d);
  if (cls === 'err' || cls === 'tip') { // the status bar shows these for a while; a tip is guidance, not an error
    const f = $('st4flash');
    f.classList.toggle('tip', cls === 'tip');
    f.textContent = msg;
    f.title = msg + ' (View > Messages)';
    clearTimeout(log.timer);
    log.timer = setTimeout(() => { f.textContent = ''; }, 6000);
  }
}

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
    opt.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch (e) { data = { error: res.statusText }; }
  data._status = res.status;
  return data;
}

// ---- the document: paths, points, edits -------------------------------------------------------------------

function getAt(o, path) {
  for (const k of path) { if (o == null) return undefined; o = o[k]; }
  return o;
}
function setAt(o, path, v) {
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = v;
}
function pathStr(path) {
  let s = '';
  for (const k of path) s += typeof k === 'number' ? '[' + k + ']' : (s ? '.' : '') + k;
  return s;
}
function parsePath(str) {
  const out = [];
  for (const m of String(str || '').matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? +m[2] : m[1]);
  return out;
}

function snapshot() { return JSON.stringify(S.doc); }
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 300) S.undo.shift();
  S.redo = [];
}
// edit runs fn on the document as one undoable step.
function edit(fn) {
  pushUndo();
  fn(S.doc);
  changed();
}
function changed(noCheck) {
  updateDirty();
  render();
  renderInspector();
  ED.emit('doc', S.doc);
  if (!noCheck) scheduleCheck();
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  S.doc = JSON.parse(S.undo.pop());
  fixSel();
  changed();
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  S.doc = JSON.parse(S.redo.pop());
  fixSel();
  changed();
}
function fixSel() { if (S.sel && selValue(S.sel) === undefined) select(null); }
function updateDirty() {
  const dirty = S.doc && snapshot() !== S.savedJSON;
  $('dirty').classList.toggle('hidden', !dirty);
  $('btnUndo').disabled = !S.undo.length;
  $('btnRedo').disabled = !S.redo.length;
  $('btnSave').disabled = !S.doc || !!S.delivered;
  $('btnSave').title = S.delivered ? S.delivered.why : 'Save Map (Ctrl+S): map.json; unchanged values keep their bytes';
  $('readOnly').classList.toggle('hidden', !S.doc || !S.delivered);
  if (S.delivered) $('readOnly').title = S.delivered.why + ' (File > Save as My Own Copy)';
  $('mapName').textContent = S.doc ? S.pkg + (S.doc.display ? ' (' + S.doc.display + ')' : '') : '';
  updateTestButton();
  return dirty;
}
// canBuild: File > Build needs a game copy (the backend's)
function canBuild() { return !!S.doc && !!S.config && !!S.config.copy; }

function lanes() { return Array.isArray(S.doc.lanes) ? S.doc.lanes : []; }
function laneById(id) { return lanes().find(l => l && l.id === id); }
function shapes() { return (S.doc.terrain && Array.isArray(S.doc.terrain.shapes)) ? S.doc.terrain.shapes : []; }
function isPt(p) { return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'; }

// The lanes are point-symmetric: with two lanes, lane B's knot n-1-k is lane A's knot k mirrored; one lane is its
// own mirror walked back. Moving, adding or deleting a knot keeps that.
function partnerKnot(li, k) {
  const L = lanes();
  const a = L[li];
  if (!a || !Array.isArray(a.knots)) return null;
  const n = a.knots.length;
  if (L.length === 2) {
    const bi = 1 - li;
    if (L[bi] && Array.isArray(L[bi].knots) && L[bi].knots.length === n) return [bi, n - 1 - k];
    return null;
  }
  return n - 1 - k !== k ? [li, n - 1 - k] : null;
}
function setPoint(path, p) {
  p = [r1(p[0]), r1(p[1])];
  if (path[0] === 'lanes' && path[2] === 'knots') {
    setAt(S.doc, path, p);
    const pk = partnerKnot(path[1], path[3]);
    if (pk) S.doc.lanes[pk[0]].knots[pk[1]] = mir(p);
    return;
  }
  const old = getAt(S.doc, path);
  if (Array.isArray(old) && old.length > 2) p = p.concat(old.slice(2)); // a prop's z stays
  setAt(S.doc, path, p);
}
function insertKnot(li, k) {
  const L = lanes(), a = L[li].knots, n = a.length;
  const p = k + 1 < n ? [r1((a[k][0] + a[k + 1][0]) / 2), r1((a[k][1] + a[k + 1][1]) / 2)]
    : [r1(2 * a[k][0] - a[k - 1][0]), r1(2 * a[k][1] - a[k - 1][1])];
  const pk = L.length === 2 ? partnerKnot(li, k) : null;
  a.splice(k + 1, 0, p);
  if (pk) L[pk[0]].knots.splice(n - 1 - k, 0, mir(p));
}
// setLaneCount switches the map between one lane and two (the Lanes tab), as one undo step, so that the check passes:
// - two -> one: a lane that is its own mirror walked back must pass the centre, so lane 1 keeps its base exit (its
//   first knot, and its second while that is on team 1's half) and runs through the centre (0, 0) to their mirrors
//   (its corridor shape follows; one is added when it has none); lane 2 and the shapes that follow it go; Bindings placed by hand go back
//   to "auto" (they stood on the old routes); the confirm names what is replaced.
// - one -> two: lane 2 is the lane's mirror walked back (each shape that follows lane 1 gets a twin for lane 2), so both start on the same path (as on the second original
//   map: Bindings on one lane are enough there); dragging lane 1's knots parts them (each partner follows mirrored).
// eachLaneShapeList calls fn with every list of shapes that may follow a lane: terrain.shapes and each ground layer's
function eachLaneShapeList(d, fn) {
  if (d.terrain && Array.isArray(d.terrain.shapes)) fn(d.terrain.shapes);
  if (d.ground && Array.isArray(d.ground.layers)) d.ground.layers.forEach(l => { if (l && Array.isArray(l.shapes)) fn(l.shapes); });
}
function eachLaneShape(d) { // the shapes with a "lane"; a ground layer's marked layer: true
  const out = [];
  if (d.terrain && Array.isArray(d.terrain.shapes)) d.terrain.shapes.forEach(s => { if (s && s.lane !== undefined) out.push(s); });
  if (d.ground && Array.isArray(d.ground.layers)) d.ground.layers.forEach(l => (l && Array.isArray(l.shapes) ? l.shapes : []).forEach(s => { if (s && s.lane !== undefined) out.push({ lane: s.lane, layer: true }); }));
  return out;
}
function setLaneCount(n) {
  const L = lanes();
  if (!S.doc || !L.length || L.length === n || (n !== 1 && n !== 2)) return false;
  const b = S.doc.base || {}, explicit = !!b.bindings && typeof b.bindings === 'object';
  if (n === 1) {
    const l1 = L.find(l => l && l.id === 1) || L[0], ks = l1.knots.filter(isPt);
    const exit = ks.slice(0, 2).filter((p, i) => i === 0 || (p[0] + p[1] < -2 && Math.hypot(p[0], p[1]) > 2));
    const lost = [];
    if (ks.length > exit.length) lost.push(`lane ${l1.id}'s route past its base exit (${ks.length - exit.length} knots)`);
    lost.push('lane ' + L.filter(l => l !== l1).map(l => l.id).join(', '));
    if (explicit) lost.push('the Bindings you placed (back to "auto")');
    if (ks.length > exit.length || explicit) {
      if (!confirm('One lane through the centre: ' + lost.join('; ') + ' will be replaced; the lane\'s corridor follows its new route. Go on?')) return false;
    }
    const knots = exit.concat([[0, 0]], exit.slice().reverse().map(mir));
    edit(d => {
      const keep = d.lanes.find(l => l && l.id === l1.id) || d.lanes[0], gone = d.lanes.filter(l => l !== keep).map(l => l.id);
      keep.knots = knots.map(p => p.slice());
      d.lanes = [keep];
      if (explicit) d.base.bindings = 'auto';
      // the shapes that followed the old routes ({"lane": id}: a corridor, a ground layer's band) stay where they were,
      // as plain paths, so the ground the map was built round stays walkable and painted
      const old = {};
      L.forEach(l => { old[l.id] = { knots: l.knots.filter(isPt).map(p => p.slice()), width: +l.width || 24 }; });
      eachLaneShapeList(d, list => list.forEach((s, i) => {
        if (!s || !old[s.lane]) return;
        const o = Object.assign({}, s, { path: old[s.lane].knots.map(p => p.slice()), width: s.width !== undefined ? s.width : old[s.lane].width });
        delete o.lane;
        list[i] = o;
      }));
      // the new route crosses the middle of the map: its corridor goes last, over what lies there, so the minions can
      // walk it (the lane's own corridor shapes keep their place)
      d.terrain = d.terrain && typeof d.terrain === 'object' ? d.terrain : { default: 'wall' };
      d.terrain.shapes = Array.isArray(d.terrain.shapes) ? d.terrain.shapes : [];
      d.terrain.shapes.push({ type: 'open', lane: keep.id });
    });
  } else {
    edit(d => {
      const l = d.lanes[0];
      if (l.id !== 1 && l.id !== 2) l.id = 1;
      const id2 = 3 - l.id;
      d.lanes.push(Object.assign(JSON.parse(JSON.stringify(l)), { id: id2, knots: l.knots.slice().reverse().map(mir) }));
      d.lanes.sort((a, c) => a.id - c.id);
      // each shape that follows the lane gets its twin on the new lane, right after it
      eachLaneShapeList(d, list => { for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].lane === l.id) list.splice(i + 1, 0, Object.assign(JSON.parse(JSON.stringify(list[i])), { lane: id2 })); });
    });
  }
  select(null);
  return true;
}
function deleteKnot(li, k) {
  const L = lanes();
  const pk = L.length === 2 ? partnerKnot(li, k) : null;
  L[li].knots.splice(k, 1);
  if (pk) L[pk[0]].knots.splice(pk[1], 1);
}

// The objects of team 1 (authored or derived by "auto"); team 2's are their mirror.
function objects() {
  const d = S.doc, b = d.base || {}, out = [];
  const add = (kind, name, pos, path, extra) => { if (isPt(pos)) out.push(Object.assign({ kind, name, pos, path }, extra)); };
  add('locus', 'Locus', b.locus, ['base', 'locus']);
  add('guardian', 'Guardian', b.guardian, ['base', 'guardian']);
  add('shop', 'shop', b.shop, ['base', 'shop']);
  (Array.isArray(b.spawns) ? b.spawns : []).forEach((p, i) => add('spawn', 'spawn ' + (i + 1), p, ['base', 'spawns', i]));
  const pv = S.preview ? S.preview.objects.filter(o => o.team === 1) : [];
  if (Array.isArray(b.cores)) b.cores.forEach((p, i) => add('core', 'Core ' + 'ABCDE'[i], p, ['base', 'cores', i]));
  else pv.filter(o => o.kind === 'core').forEach((o, i) => add('core', o.name, o.pos, null, { auto: 'cores', idx: i }));
  if (b.bindings && typeof b.bindings === 'object') {
    for (const id of Object.keys(b.bindings)) {
      const list = Array.isArray(b.bindings[id]) ? b.bindings[id] : [], names = tierNames(list.length);
      list.forEach((p, t) => add('binding', 'lane ' + id + ' ' + (names[t] || t), p,
        ['base', 'bindings', id, t], { lane: +id, tier: t, tname: names[t] }));
    }
  } else {
    pv.filter(o => o.kind === 'binding').forEach(o => {
      const tn = o.name.split(' ').pop();
      add('binding', o.name, o.pos, null, { auto: 'bindings', lane: o.lane, tier: TIERS.indexOf(tn), tname: tn });
    });
  }
  (Array.isArray(d.wells) ? d.wells : []).forEach((w, i) => w && add('well', w.kind === 'mine' ? 'mine' : 'well', w.pos, ['wells', i, 'pos']));
  // a camp: its name stays kind + noun (the overlays and the 3-D view's keys read it), label and color are what people see
  (Array.isArray(d.camps) ? d.camps : []).forEach((c, i) => c && add('camp', (c.kind || 'camp') + ' ' + (c.noun || ''), c.pos, ['camps', i, 'pos'],
    ED.camps ? { label: ED.camps.labelOf(c), color: ED.camps.colorOf(c), once: c.kind === 'parasite' } : null));
  // the bots' ward spots (map.json "wards"): shown and moved like the wells; new ones are added in map.json
  (Array.isArray(d.wards) ? d.wards : []).forEach((w, i) => w && add('ward', 'ward ' + (i + 1), w.pos, ['wards', i, 'pos']));
  return out;
}

// materialize turns "auto" Cores or Bindings into explicit points at their derived places, so one can be moved.
function materialize(which) {
  const pv = S.preview ? S.preview.objects.filter(o => o.team === 1) : [];
  if (which === 'cores') {
    const cores = pv.filter(o => o.kind === 'core').map(o => [r1(o.pos[0]), r1(o.pos[1])]);
    if (cores.length !== 5) return false;
    S.doc.base.cores = cores;
    return true;
  }
  const bind = {};
  for (const o of pv.filter(o => o.kind === 'binding')) {
    const t = TIERS.indexOf(o.name.split(' ').pop());
    (bind[o.lane] = bind[o.lane] || [null, null, null])[t] = [r1(o.pos[0]), r1(o.pos[1])];
  }
  if (!Object.keys(bind).length) return false;
  S.doc.base.bindings = bind;
  return true;
}

// ---- the Bindings a lane: three (Outer, Middle, Inner) or two (Middle, Inner), every lane the same (mapc
// fixed.bindings); "auto" places three
function bindingsPlaced() { const b = S.doc.base || {}; return !!b.bindings && typeof b.bindings === 'object'; }
function bindingCount() {
  if (!bindingsPlaced()) return 3;
  const ls = Object.values(S.doc.base.bindings).filter(Array.isArray);
  return ls.length ? ls[0].length : 3;
}
// canPlaceBindings: "auto" ones become points from the last check's preview (materialize), so there must be one
function canPlaceBindings() {
  if (bindingsPlaced() || (S.preview && S.preview.objects.some(o => o.team === 1 && o.kind === 'binding'))) return true;
  log('the Bindings\' places come from the check: wait for it to pass once', 'err');
  return false;
}
// MIDDLE_BESIDE is how far SM_Map_v5's Middle Binding stands beside its lane's line, to the left of lane 1's way
// (mapc smBindingLateral, as "auto" places it; lane 2's the other side): a Binding's footprint is off the graphs
// (mapc StructureRadius), so one on the line would cut the minions' leg (lanes.graph)
const MIDDLE_BESIDE = -7.1;
// middleBetween is where a new Middle Binding goes: lane id's route halfway along it between where a and c lie on it,
// MIDDLE_BESIDE beside it, so it stands in its lane, off the minions' line and between the two in tier order (the
// straight midpoint without the lane)
function middleBetween(id, a, c) {
  const l = laneById(id), ks = l && Array.isArray(l.knots) ? l.knots.filter(isPt) : [];
  if (ks.length < 2) return [r1((a[0] + c[0]) / 2), r1((a[1] + c[1]) / 2)];
  const lat = id === 1 ? MIDDLE_BESIDE : -MIDDLE_BESIDE;
  const along = p => { // the arc length of the route's point nearest p
    let best = Infinity, s = 0, acc = 0;
    for (let i = 1; i < ks.length; i++) {
      const u = ks[i - 1], v = ks[i], vx = v[0] - u[0], vy = v[1] - u[1], L = Math.hypot(vx, vy);
      const t = L ? Math.max(0, Math.min(1, ((p[0] - u[0]) * vx + (p[1] - u[1]) * vy) / (L * L))) : 0;
      const d = Math.hypot(u[0] + t * vx - p[0], u[1] + t * vy - p[1]);
      if (d < best) { best = d; s = acc + t * L; }
      acc += L;
    }
    return s;
  };
  let s = (along(a) + along(c)) / 2;
  for (let i = 1; i < ks.length; i++) {
    const u = ks[i - 1], v = ks[i], L = Math.hypot(v[0] - u[0], v[1] - u[1]);
    if (s <= L || i === ks.length - 1) {
      const t = L ? Math.min(1, s / L) : 0, dx = L ? (v[0] - u[0]) / L : 1, dy = L ? (v[1] - u[1]) / L : 0;
      return [r1(u[0] + t * (v[0] - u[0]) - dy * lat), r1(u[1] + t * (v[1] - u[1]) + dx * lat)];
    }
    s -= L;
  }
  return [r1(ks[0][0]), r1(ks[0][1])];
}
// setBindingCount makes every lane's Bindings n (one undo step; team 2's are the mirror): from three to two the middle
// one goes and the others keep their places (named Middle and Inner then); from two to three a Middle one comes halfway
// between them, beside the lane's line (middleBetween)
function setBindingCount(n) {
  if (!S.doc || (n !== 2 && n !== 3) || bindingCount() === n || !canPlaceBindings()) return false;
  const auto = !bindingsPlaced();
  edit(d => {
    if (auto) materialize('bindings');
    for (const [id, ls] of Object.entries(d.base.bindings)) {
      if (!Array.isArray(ls)) continue;
      if (n === 2 && ls.length === 3) ls.splice(1, 1);
      else if (n === 3 && ls.length === 2 && isPt(ls[0]) && isPt(ls[1])) ls.splice(1, 0, middleBetween(+id, ls[0], ls[1]));
    }
  });
  select(null);
  log(n === 2 ? 'two Bindings a lane: the middle one went, the others are Middle and Inner' : 'three Bindings a lane: a Middle one halfway between the two, beside the lane', 'ok');
  return true;
}
// bindingTier is the selected Binding's tier (its place in the lane's list), -1 when the selection is no Binding
function bindingTier(sel) {
  if (!sel) return -1;
  if (sel.t === 'obj' && sel.path[0] === 'base' && sel.path[1] === 'bindings' && typeof sel.path[3] === 'number') return sel.path[3];
  if (sel.t === 'auto' && sel.which === 'bindings' && sel.tier >= 0) return sel.tier;
  return -1;
}
// deleteBindingTier takes tier t off every lane (three a lane to two; team 2's go with them): two is the fewest
function deleteBindingTier(t) {
  if (bindingCount() !== 3) { log('two Bindings a lane are the fewest (Middle and Inner): Lanes > Bindings sets three again', 'err'); return false; }
  if (!(t >= 0 && t < 3) || !canPlaceBindings()) return false;
  const auto = !bindingsPlaced();
  edit(d => {
    if (auto) materialize('bindings');
    for (const ls of Object.values(d.base.bindings)) if (Array.isArray(ls) && ls.length === 3) ls.splice(t, 1);
  });
  select(null);
  log(`the ${TIERS[t]} Binding went from every lane: the other two are Middle and Inner`, 'ok');
  return true;
}

// ---- selection -------------------------------------------------------------------------------------------
// S.sel: {t: 'obj', path} | {t: 'auto', which, idx | lane, tier} | {t: 'shape', i} | {t: 'vertex', i, v}
//        | {t: 'radius', i} | {t: 'knot', l, k} | {t: 'lane', l}

function selValue(sel) {
  if (!sel || !S.doc) return undefined;
  switch (sel.t) {
    case 'obj': return getAt(S.doc, sel.path);
    case 'auto': return S.doc.base && S.doc.base[sel.which];
    case 'shape': case 'radius': return shapes()[sel.i];
    case 'vertex': { const s = shapes()[sel.i]; return s && (s.polygon || s.path || [])[sel.v]; }
    case 'knot': return getAt(S.doc, ['lanes', sel.l, 'knots', sel.k]);
    case 'lane': case 'lwidth': return lanes()[sel.l];
    default: return ED.sel[sel.t] && ED.sel[sel.t].value ? ED.sel[sel.t].value(sel) : undefined;
  }
}
function select(sel) {
  S.sel = sel;
  renderInspector();
  render();
  ED.emit('select', sel);
}
// selectPath selects what a finding's path names, where the page can.
function selectPath(str) {
  const p = parsePath(str);
  if (p[0] === 'terrain' && p[1] === 'shapes' && typeof p[2] === 'number') return select({ t: 'shape', i: p[2] });
  if (p[0] === 'lanes' && typeof p[1] === 'number') {
    if (p[2] === 'knots' && typeof p[3] === 'number') return select({ t: 'knot', l: p[1], k: p[3] });
    return select({ t: 'lane', l: p[1] });
  }
  if (p[0] === 'props' && typeof p[1] === 'number') return select({ t: 'prop', k: p[1] });
  if (p[0] === 'scatter' && typeof p[1] === 'number') return select({ t: 'scatter', k: p[1] });
  if ((p[0] === 'wells' || p[0] === 'camps' || p[0] === 'wards') && typeof p[1] === 'number') {
    return select({ t: 'obj', path: [p[0], p[1], 'pos'] });
  }
  if (p[0] === 'base' && p.length >= 2 && isPt(getAt(S.doc, p))) return select({ t: 'obj', path: p });
  select(null);
  if (p[0] === 'void') ED.emit('focus-void', str); // the void window (void.js, Map > The Void) shows its field
}

// ---- the view ---------------------------------------------------------------------------------------------

const cv = $('canvas');
const ctx = cv.getContext('2d');
let dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  if (S.fitted) fit(); // MAPED-EDIT6: a fit made while the canvas was still small (the page loading) follows its size
  render();
}
new ResizeObserver(resize).observe(cv);

// fit shows the whole map; until the view is panned or zoomed it is fit again whenever the canvas changes size
function fit() {
  if (!S.doc) return;
  const size = +S.doc.size || 400;
  S.view = { x: 0, y: 0, scale: Math.min(cv.width, cv.height) / (size * 1.06) };
  S.fitted = true;
  render();
}
const w2s = p => [cv.width / 2 + (p[0] - S.view.x) * S.view.scale, cv.height / 2 - (p[1] - S.view.y) * S.view.scale];
const s2w = (x, y) => [(x - cv.width / 2) / S.view.scale + S.view.x, -(y - cv.height / 2) / S.view.scale + S.view.y];
function evPos(e) {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
}

// ---- the main views' contract (EDUX2): ED.views[id] = {id, title, el, pick, pickAt, project, ppm, overlay} -------
// - pick(e): the world under a mouse event (anything with clientX, clientY) -> {w: [x, y], z, near, sx, sy, view}, or
//   null where the view can't tell (the 3-D view until EDUX3): w the ground point, z its height where the view knows
//   it (2-D: 0), sx, sy the view's canvas pixels (CSS pixels × dpr), near the metres one CSS pixel covers there (a hit
//   within k pixels is one within k * near metres), view the view's id; pickAt(sx, sy) the same from canvas pixels
// - project([x, y(, z)]) -> [sx, sy] in the same pixels (null behind the camera); without z the view takes the
//   ground's height (2-D ignores z): project(pickAt(sx, sy).w) gives sx, sy back
// - ppm(p): the canvas pixels a metre at the world point p (a radius drawn there)
// - overlay: the 2-D context the view's handles and the tools' previews draw on (ED.previews), or null
// The tools keep their (w, e) interface: the input pipeline below hands them the pick's w.
const VIEW2D = {
  id: '2d', title: '2-D', el: $('view2d'), canvas: cv, overlay: ctx,
  pickAt(sx, sy) { return { w: s2w(sx, sy), z: 0, near: dpr / S.view.scale, sx, sy, view: '2d' }; },
  pick(e) { const s = evPos(e); return this.pickAt(s[0], s[1]); },
  project: p => w2s(p),
  ppm: () => S.view.scale,
};
ED.views['2d'] = VIEW2D;
// vpoly starts a path through the view v's projection (the 2-D poly's twin for previews). In a view that drapes (3-D:
// v.drape) each edge is cut into steps of about a metre, so the line lies on the ground's heights.
function vpoly(v, pts, close) {
  const g = v.overlay;
  g.beginPath();
  let on = false;
  const to = p => {
    const s = v.project(p);
    if (!s) { on = false; return; }
    if (on) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]);
    on = true;
  };
  const list = close && v.drape && pts.length > 2 ? pts.concat([pts[0]]) : pts;
  list.forEach((p, i) => {
    if (v.drape && i) { // the points between the last and this one, a metre apart (at most 400 an edge)
      const a = list[i - 1], n = Math.min(400, Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1])));
      for (let k = 1; k < n; k++) to([a[0] + (p[0] - a[0]) * k / n, a[1] + (p[1] - a[1]) * k / n]);
    }
    to(p);
  });
  if (close && !v.drape) g.closePath();
}
// vring starts a circle of r metres round the ground point c through the view v (2-D: an arc; 3-D: draped)
function vring(v, c, r) {
  if (!v.drape) {
    const s = v.project(c);
    v.overlay.beginPath();
    if (s) v.overlay.arc(s[0], s[1], Math.max(0, r * v.ppm(c)), 0, 2 * Math.PI);
    return;
  }
  const n = Math.max(16, Math.min(128, Math.ceil(2 * Math.PI * r)));
  const pts = [];
  for (let k = 0; k < n; k++) pts.push([c[0] + r * Math.cos(2 * Math.PI * k / n), c[1] + r * Math.sin(2 * Math.PI * k / n)]);
  vpoly(v, pts, true);
}
// vmark draws a handle at the world point p through the view v: 'round' (a dot) or 'square', size CSS pixels across
// its half, filled with fill. p = [x, y] stands on the ground; [x, y, z] at the height z (a handle above the ground).
function vmark(v, p, shape, size, fill) {
  const s = v.project(p), g = v.overlay;
  if (!s) return null;
  g.fillStyle = fill;
  if (shape === 'round') { g.beginPath(); g.arc(s[0], s[1], size * dpr, 0, 2 * Math.PI); g.fill(); } else g.fillRect(s[0] - size * dpr, s[1] - size * dpr, 2 * size * dpr, 2 * size * dpr);
  return s;
}
// the metres one CSS pixel covers at p in the view v (the handles' sizes on the ground)
const vmpp = (v, p) => dpr / Math.max(1e-9, v.ppm(p));
// vband strokes a band width metres wide along pts through the view v with the overlay's current strokeStyle (a
// brush stroke, a path being drawn): 2-D one line of that width; 3-D (EDUX4) its outline draped on the ground (the
// ground under it shows what the stroke does: the live preview)
function vband(v, pts, width) {
  const g = v.overlay;
  g.save();
  g.lineCap = g.lineJoin = 'round';
  if (!v.drape || pts.length < 2) {
    g.lineWidth = Math.max(1, width * v.ppm(pts[0] || [0, 0]));
    vpoly(v, pts.length < 2 && pts.length ? [pts[0], pts[0]] : pts);
    g.stroke();
    g.restore();
    return;
  }
  // 3-D: the band's outline on the ground (each leg's two sides, a ring round each end), so the ground it changes
  // shows through it
  const hw = width / 2;
  g.lineWidth = 1.5 * dpr;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const n = [-(b[1] - a[1]) / len * hw, (b[0] - a[0]) / len * hw];
    for (const s of [1, -1]) { vpoly(v, [[a[0] + s * n[0], a[1] + s * n[1]], [b[0] + s * n[0], b[1] + s * n[1]]]); g.stroke(); }
  }
  for (const p of pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts) { vring(v, p, hw); g.stroke(); }
  g.restore();
}
// vsquare starts the outline of a square of side 2h round the ground point c through the view v (draped in 3-D)
function vsquare(v, c, hs) {
  vpoly(v, [[c[0] - hs, c[1] - hs], [c[0] + hs, c[1] - hs], [c[0] + hs, c[1] + hs], [c[0] - hs, c[1] + hs]], true);
}

function poly(pts, mirror, close) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = w2s(mirror ? mir(p) : p);
    if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]);
  });
  if (close) ctx.closePath();
}

function drawShape(sh, i, mirror) {
  if (!sh || typeof sh !== 'object') return;
  const c = TYPE[sh.type] || ['rgba(255,0,255,0.3)', '#f0f'];
  ctx.save();
  ctx.fillStyle = c[0];
  ctx.strokeStyle = c[1];
  ctx.lineWidth = 1.5 * dpr;
  if (mirror) { ctx.globalAlpha = 0.45; ctx.setLineDash([5 * dpr, 4 * dpr]); }
  if (sh.lane !== undefined) {
    const l = laneById(sh.lane);
    if (l && Array.isArray(l.knots) && !mirror) {
      poly(l.knots, false);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = c[0];
      ctx.lineWidth = (+l.width || 1) * S.view.scale;
      ctx.stroke();
    }
  } else if (isPt(sh.circle)) {
    const s = w2s(mirror ? mir(sh.circle) : sh.circle);
    ctx.beginPath();
    ctx.arc(s[0], s[1], Math.max(0, (+sh.r || 0) * S.view.scale), 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  } else if (Array.isArray(sh.polygon) && sh.polygon.every(isPt)) {
    poly(sh.polygon, mirror, true);
    ctx.fill('evenodd');
    ctx.stroke();
  } else if (Array.isArray(sh.path) && sh.path.every(isPt)) {
    poly(sh.path, mirror);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = c[0];
    ctx.lineWidth = (+sh.width || 1) * S.view.scale;
    ctx.stroke();
    ctx.strokeStyle = c[1];
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }
  ctx.restore();
}

function shapeHandles(i) {
  const sh = shapes()[i];
  if (!sh) return [];
  if (isPt(sh.circle)) return [{ t: 'radius', i, pos: [sh.circle[0] + (+sh.r || 0), sh.circle[1]] }];
  const pts = Array.isArray(sh.polygon) ? sh.polygon : Array.isArray(sh.path) ? sh.path : [];
  return pts.filter(isPt).map((p, v) => ({ t: 'vertex', i, v, pos: p }));
}

function drawSymbol(o, team, sel) {
  const p = team === 2 ? mir(o.pos) : o.pos;
  const s = w2s(p), R = (o.kind === 'guardian' ? 9 : o.kind === 'prop' ? 3.5 : 6.5) * dpr;
  ctx.save();
  if (o.kind === 'guardian') { // its hole
    ctx.beginPath();
    ctx.arc(s[0], s[1], 10 * S.view.scale, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  if (o.kind === 'binding') {
    ctx.moveTo(s[0], s[1] - R); ctx.lineTo(s[0] + R, s[1]); ctx.lineTo(s[0], s[1] + R); ctx.lineTo(s[0] - R, s[1]);
    ctx.closePath();
  } else if (o.kind === 'locus' || o.kind === 'shop') {
    ctx.rect(s[0] - R, s[1] - R, 2 * R, 2 * R);
  } else if (o.kind === 'spawner') {
    ctx.moveTo(s[0], s[1] - R); ctx.lineTo(s[0] + R, s[1] + R); ctx.lineTo(s[0] - R, s[1] + R); ctx.closePath();
  } else {
    ctx.arc(s[0], s[1], R, 0, 2 * Math.PI);
  }
  ctx.globalAlpha = team === 2 ? 0.6 : 1;
  if (o.auto || o.kind === 'spawner') {
    ctx.fillStyle = '#0f1114';
    ctx.fill();
    ctx.strokeStyle = TEAM[team - 1];
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  } else {
    ctx.fillStyle = o.color || TEAM[team - 1];
    ctx.fill();
  }
  if (sel) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  }
  const label = { locus: 'L', guardian: 'G', shop: '$', spawn: o.name.slice(-1), core: o.name.slice(-1),
    binding: o.tname ? o.tname[0] : 'B', well: 'W', camp: o.once ? 'P' : 'C', spawner: 'm', prop: '', ward: 'w' }[o.kind] || '?';
  ctx.globalAlpha = 1;
  ctx.fillStyle = o.auto || o.kind === 'spawner' ? TEAM[team - 1] : '#0b0d10';
  ctx.font = `bold ${9 * dpr}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, s[0], s[1] + 0.5 * dpr);
  ctx.restore();
}

function sameSel(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }
function objSel(o) { return o.path ? { t: 'obj', path: o.path } : { t: 'auto', which: o.auto, idx: o.idx, lane: o.lane, tier: o.tier }; }

function render() {
  // another view shown (3-D): the hidden 2-D canvas isn't drawn; that view draws its frame and overlay instead (a
  // switch back to 2-D draws it: setView -> resize)
  if (ED.view !== '2d' && ED.active().redraw) { ED.active().redraw(); return; }
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0f1114';
  ctx.fillRect(0, 0, W, H);
  if (!S.doc) return;
  const size = +S.doc.size || 400, h = size / 2;
  const a = w2s([-h, h]), b = w2s([h, -h]);
  // the derived layer
  if (S.img && S.bg && S.img.complete && S.img.naturalWidth) {
    ctx.save();
    ctx.globalAlpha = S.bgAlpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.img, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  }
  ED.emit('render-bg', ctx); // a pane's own background (the ground's bake)
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  const ia = w2s([-h + 2, h - 2]), ib = w2s([h - 2, -h + 2]);
  ctx.save();
  ctx.setLineDash([2 * dpr, 4 * dpr]);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(ia[0], ia[1], ib[0] - ia[0], ib[1] - ia[1]);
  ctx.restore();
  if (S.show.grid) {
    ctx.save();
    for (let g = -Math.floor(h / 20) * 20; g <= h; g += 20) {
      ctx.strokeStyle = g === 0 ? 'rgba(255,255,255,0.25)' : g % 100 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
      poly([[g, -h], [g, h]]); ctx.stroke();
      poly([[-h, g], [h, g]]); ctx.stroke();
    }
    ctx.restore();
  }
  if (S.show.half) { // team 1's half: x + y <= 0
    ctx.save();
    ctx.fillStyle = 'rgba(255,123,114,0.05)';
    poly([[-h, h], [h, h], [h, -h]], false, true);
    ctx.fill();
    ctx.setLineDash([8 * dpr, 6 * dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    poly([[-h, h], [h, -h]]);
    ctx.stroke();
    ctx.restore();
  }
  const sh = shapes();
  if (S.show.shapes) {
    if (S.show.mirror) sh.forEach((s, i) => drawShape(s, i, true));
    sh.forEach((s, i) => drawShape(s, i, false));
  }
  if (S.show.lanes) {
    lanes().forEach((l, li) => {
      if (!l || !Array.isArray(l.knots) || !l.knots.every(isPt)) return;
      ctx.save();
      ctx.strokeStyle = LANE[l.id] || '#ccc';
      ctx.lineWidth = (S.sel && S.sel.t === 'lane' && S.sel.l === li ? 3 : 1.5) * dpr;
      poly(l.knots);
      ctx.stroke();
      ctx.fillStyle = LANE[l.id] || '#ccc';
      l.knots.forEach((p, k) => {
        const s = w2s(p), sel = S.sel && S.sel.t === 'knot' && S.sel.l === li && S.sel.k === k;
        ctx.fillRect(s[0] - 3.5 * dpr, s[1] - 3.5 * dpr, 7 * dpr, 7 * dpr);
        if (sel) { ctx.strokeStyle = '#fff'; ctx.strokeRect(s[0] - 5 * dpr, s[1] - 5 * dpr, 10 * dpr, 10 * dpr); }
      });
      if (l.knots.length >= 2) { // the direction of travel from team 1's base
        const p = w2s(l.knots[0]), q = w2s(l.knots[1]), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], L = 8 * dpr;
        ctx.beginPath();
        ctx.moveTo(m[0] + L * Math.cos(ang), m[1] + L * Math.sin(ang));
        ctx.lineTo(m[0] + L * Math.cos(ang + 2.5), m[1] + L * Math.sin(ang + 2.5));
        ctx.lineTo(m[0] + L * Math.cos(ang - 2.5), m[1] + L * Math.sin(ang - 2.5));
        ctx.fill();
      }
      ctx.restore();
    });
    drawLaneExtras(VIEW2D); // the selected lane's corridor and its width handle (EDUX4)
  }
  ED.emit('draw', 'under'); // the props (props.js)
  if (S.show.objects) {
    const obs = objects();
    if (S.show.mirror) obs.filter(o => !o.once).forEach(o => drawSymbol(o, 2, false));
    if (S.preview) {
      S.preview.objects.filter(o => o.kind === 'spawner').forEach(o =>
        drawSymbol({ kind: 'spawner', name: o.name, pos: o.team === 2 ? mir(o.pos) : o.pos }, o.team, false));
    }
    obs.forEach(o => drawSymbol(o, 1, sameSel(objSel(o), S.sel)));
  }
  // the selected shape's outline and handles
  if (S.sel && (S.sel.t === 'shape' || S.sel.t === 'vertex' || S.sel.t === 'radius')) {
    const s = sh[S.sel.i];
    if (s) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      if (isPt(s.circle)) {
        const c = w2s(s.circle);
        ctx.beginPath(); ctx.arc(c[0], c[1], (+s.r || 0) * S.view.scale, 0, 2 * Math.PI); ctx.stroke();
      } else if (Array.isArray(s.polygon)) { poly(s.polygon.filter(isPt), false, true); ctx.stroke(); }
      else if (Array.isArray(s.path)) { poly(s.path.filter(isPt)); ctx.stroke(); }
      for (const hd of shapeHandles(S.sel.i)) {
        const p = w2s(hd.pos), on = sameSel({ t: hd.t, i: hd.i, v: hd.v }, S.sel) || (hd.t === 'radius' && S.sel.t === 'radius');
        ctx.fillStyle = on ? '#58a6ff' : '#fff';
        ctx.fillRect(p[0] - 4 * dpr, p[1] - 4 * dpr, 8 * dpr, 8 * dpr);
      }
      ctx.restore();
    }
  }
  drawJoined();
  if (S.show.bots) drawBots();
  ED.emit('render', ctx); // a pane's own drawing (the ground's strokes and stamps, a tool's cursor)
  ED.emit('draw', 'over'); // handles (props.js, propsel.js)
  ED.drawPreviews(VIEW2D); // the tools' previews: the drawing in progress, the brushes, the ghosts, the estimate
  if (S.show.findings && S.report) drawFindings(VIEW2D);
}

// drawFindings marks the check's findings at their places through the view v (a ring, the rule; the parts of a
// reach.dropped or reach.narrow finding as dashed circles)
function drawFindings(v) {
  if (!S.show.findings || !S.report) return;
  const g = v.overlay;
  for (const f of S.report.findings || []) {
    // EDUX6 (feedback.js): a finding whose place the page knows is marked on the object (where it is now) and its
    // mirror twin, with the rule's reason
    if (ED.markFinding && !(f.parts && f.parts.length) && ED.markFinding(v, f)) continue;
    if (!f.at) continue;
    const p = v.project(f.at), on = f === S.hoverFinding;
    if (!p) continue;
    g.save();
    g.strokeStyle = f.severity === 'warning' ? '#f2b84b' : '#ff6b6b';
    g.lineWidth = (on ? 3 : 2) * dpr;
    g.beginPath(); g.arc(p[0], p[1], (on ? 14 : 10) * dpr, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = g.strokeStyle;
    g.font = `bold ${10 * dpr}px Segoe UI, sans-serif`;
    g.fillText(f.rule, p[0] + 13 * dpr, p[1] - 9 * dpr);
    for (const [k, part] of (f.parts || []).entries()) { // reach.dropped, reach.narrow: every part (MAPED-EDIT6, EDNARROW)
      const sel = S.sel && S.sel.t === 'part' && S.sel.k === k && partRule(S.sel) === f.rule;
      g.setLineDash([4 * dpr, 3 * dpr]);
      g.lineWidth = (sel ? 3 : 1.5) * dpr;
      vring(v, part.centre, Math.max(6 * vmpp(v, part.centre), part.r));
      g.stroke();
    }
    g.restore();
  }
}

// the selection's marks in a view other than the 2-D (EDUX3; the 2-D view's render() draws its own): a ring round the
// selected object (dashed at its mirror), the selected shape's outline and handles, a knot's square, draped on the ground
const MARK_R = { guardian: 10, locus: 6, shop: 4, binding: 4, core: 4, spawn: 2, well: 3, camp: 4, ward: 1.5 };
ED.marks.push(function selectionMarks(v) {
  const sel = S.sel, g = v.overlay;
  if (!sel || !S.doc) return;
  g.save();
  g.strokeStyle = '#fff';
  g.lineWidth = 2 * dpr;
  if (sel.t === 'obj' || sel.t === 'auto') {
    const o = objects().find(x => sameSel(objSel(x), sel));
    if (o && S.show.objects) {
      const r = Math.max(MARK_R[o.kind] || 3, 8 * vmpp(v, o.pos));
      vring(v, o.pos, r); g.stroke();
      if (S.show.mirror && !o.once) { g.globalAlpha = 0.55; g.setLineDash([5 * dpr, 4 * dpr]); vring(v, mir(o.pos), r); g.stroke(); }
    }
  } else if (sel.t === 'knot') {
    const p = getAt(S.doc, ['lanes', sel.l, 'knots', sel.k]);
    if (isPt(p)) { vmark(v, p, 'square', 5, '#fff'); vring(v, p, 6 * vmpp(v, p)); g.stroke(); }
  } else if (['shape', 'vertex', 'radius'].includes(sel.t)) {
    const s = shapes()[sel.i];
    if (s) {
      if (isPt(s.circle)) vring(v, s.circle, +s.r || 0);
      else if (Array.isArray(s.polygon)) vpoly(v, s.polygon.filter(isPt), true);
      else if (Array.isArray(s.path)) vpoly(v, s.path.filter(isPt));
      g.stroke();
      for (const hd of shapeHandles(sel.i)) {
        const on = sameSel({ t: hd.t, i: hd.i, v: hd.v }, sel) || (hd.t === 'radius' && sel.t === 'radius');
        vmark(v, hd.pos, 'square', 4, on ? '#58a6ff' : '#fff');
      }
    }
  }
  g.restore();
});

// ---- the lanes in every view (EDUX4) ------------------------------------------------------------------------
// laneWidthHandle: with a lane, a knot or the handle itself selected, a round handle beside the lane at the knot (a
// lane: its middle knot), half the lane's width out to its left; a drag sets every lane's width (the Lanes tab's field)
function laneWidthHandle() {
  const s = S.sel;
  if (!s || !['knot', 'lane', 'lwidth'].includes(s.t) || !S.show.lanes || !S.doc) return null;
  const l = lanes()[s.l];
  if (!l || !Array.isArray(l.knots) || l.knots.length < 2 || !l.knots.every(isPt)) return null;
  const k = s.t === 'lane' ? Math.floor((l.knots.length - 1) / 2) : Math.min(s.k, l.knots.length - 1);
  const a = l.knots[Math.max(0, k - 1)], b = l.knots[Math.min(l.knots.length - 1, k + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], hw = (+l.width || 0) / 2, p = l.knots[k];
  return { l: s.l, k, at: p, n, pos: [p[0] + n[0] * hw, p[1] + n[1] * hw] };
}
// laneEdges: the corridor's two sides (each leg offset by half the width), as pairs of points
function laneEdges(l) {
  const out = [], hw = (+l.width || 0) / 2;
  for (let i = 1; i < l.knots.length; i++) {
    const a = l.knots[i - 1], b = l.knots[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / len * hw, (b[0] - a[0]) / len * hw];
    out.push([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]]], [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]]]);
  }
  return out;
}
// drawLaneExtras: the selected lane's corridor sides (dashed) and the width handle, through the view v
function drawLaneExtras(v) {
  const hd = laneWidthHandle();
  if (!hd) return;
  const g = v.overlay, l = lanes()[hd.l];
  g.save();
  g.strokeStyle = LANE[l.id] || '#ccc';
  g.globalAlpha = 0.8;
  g.lineWidth = 1 * dpr;
  g.setLineDash([5 * dpr, 4 * dpr]);
  for (const e of laneEdges(l)) { vpoly(v, e); g.stroke(); }
  g.setLineDash([]);
  g.globalAlpha = 1;
  vpoly(v, [hd.at, hd.pos]); g.stroke();
  vmark(v, hd.pos, 'round', 5, S.sel.t === 'lwidth' ? '#58a6ff' : '#fff');
  g.restore();
}
// the lanes through a view that drapes (3-D; the 2-D view's render() draws its own): each lane's line on the ground,
// its knots, its direction of travel from team 1's base (the selected lane thicker), and the extras above
ED.marks.push(function laneMarks(v) {
  if (!v.drape || !S.show.lanes || !S.doc) return;
  const g = v.overlay;
  lanes().forEach((l, li) => {
    if (!l || !Array.isArray(l.knots) || !l.knots.every(isPt)) return;
    const col = LANE[l.id] || '#ccc';
    g.save();
    g.strokeStyle = col;
    g.lineWidth = (S.sel && ['lane', 'lwidth'].includes(S.sel.t) && S.sel.l === li ? 3 : 1.5) * dpr;
    vpoly(v, l.knots);
    g.stroke();
    l.knots.forEach(p => vmark(v, p, 'square', 3.5, col));
    if (l.knots.length >= 2) { // the direction of travel, at the first leg's middle
      const a = l.knots[0], b = l.knots[1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const p = v.project(m), q = v.project([m[0] + (b[0] - a[0]) * 0.01, m[1] + (b[1] - a[1]) * 0.01]);
      if (p && q) {
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), L = 8 * dpr;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(p[0] + L * Math.cos(ang), p[1] + L * Math.sin(ang));
        g.lineTo(p[0] + L * Math.cos(ang + 2.5), p[1] + L * Math.sin(ang + 2.5));
        g.lineTo(p[0] + L * Math.cos(ang - 2.5), p[1] + L * Math.sin(ang - 2.5));
        g.fill();
      }
    }
    g.restore();
  });
  drawLaneExtras(v);
});

// drawJoined outlines what a drag of the selected knot, well or camp takesalong (or takes along now)
function drawJoined() {
  let js = S.drag && S.drag.moved ? S.drag.joined : null;
  if (!js && S.sel && S.joined && (S.sel.t === 'knot' || (S.sel.t === 'obj' && ['wells', 'camps'].includes(S.sel.path[0])))) {
    js = joinedTo(S.sel);
  }
  if (!js || !js.length) return;
  const sh = shapes();
  ctx.save();
  ctx.strokeStyle = '#3ee0d0';
  ctx.lineWidth = 2 * dpr;
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  for (const m of js) {
    const s = sh[m.i];
    if (!s) continue;
    if (!m.whole) {
      const p = (s.polygon || s.path || [])[m.v];
      if (!isPt(p)) continue;
      const q = w2s(p);
      ctx.beginPath(); ctx.arc(q[0], q[1], 6 * dpr, 0, 2 * Math.PI); ctx.stroke();
    } else if (isPt(s.circle)) {
      const c = w2s(s.circle);
      ctx.beginPath(); ctx.arc(c[0], c[1], (+s.r || 0) * S.view.scale, 0, 2 * Math.PI); ctx.stroke();
    } else if (Array.isArray(s.polygon)) { poly(s.polygon.filter(isPt), false, true); ctx.stroke(); }
  }
  ctx.restore();
}

// drawBots draws the bots' derived points from the check's preview (mapc: the match host's rules): each team's rally
// point for the parasite (a line from the parasite camp; turned off the straight line, the straight point crossed and
// the angle written) and each team's Hunter route (the camps in order, numbered)
function drawBots() {
  const b = S.preview && S.preview.bots;
  if (!b) return;
  ctx.save();
  ctx.font = `bold ${9 * dpr}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const rt of b.routes || []) {
    const col = TEAM[rt.team - 1], pts = rt.steps.map(s => s.pos);
    if (!pts.length) continue;
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    poly(pts);
    ctx.stroke();
    ctx.setLineDash([]);
    rt.steps.forEach((s, i) => {
      const q = w2s(s.pos), o = 11 * dpr;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q[0] + o, q[1] - o, 6 * dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#0b0d10';
      ctx.fillText(String(i + 1), q[0] + o, q[1] - o + 0.5 * dpr);
    });
  }
  ctx.globalAlpha = 1;
  for (const r of b.rally || []) {
    const col = TEAM[r.team - 1], a = w2s(r.from), p = w2s(r.pos), R = 6 * dpr;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * dpr;
    if (Math.abs(r.turn) > 0.01) {
      const s = w2s(r.straight);
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(s[0], s[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(s[0] - R, s[1] - R); ctx.lineTo(s[0] + R, s[1] + R); ctx.moveTo(s[0] + R, s[1] - R); ctx.lineTo(s[0] - R, s[1] + R); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(p[0], p[1] - R); ctx.lineTo(p[0] + R, p[1]); ctx.lineTo(p[0], p[1] + R); ctx.lineTo(p[0] - R, p[1]); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0d10';
    ctx.fillText('R', p[0], p[1] + 0.5 * dpr);
    ctx.fillStyle = col;
    ctx.textAlign = 'left';
    ctx.fillText(`rally ${r.team}` + (Math.abs(r.turn) > 0.01 ? ` turned ${Math.round(r.turn)}°` : '') + (r.quality !== 'open-line' ? ` (${r.quality})` : ''), p[0] + R + 3 * dpr, p[1]);
    ctx.textAlign = 'center';
  }
  ctx.restore();
}

// botsSummary is the bots' line under the check: the rally points, how far each turned, and whether the two teams'
// differ (an uneven map: the edit that made it is the one to look at), and the routes' camps
function botsSummary() {
  const b = S.preview && S.preview.bots;
  if (!b) return { text: '', uneven: false };
  const rs = b.rally || [];
  const one = r => `team ${r.team} (${r.pos[0].toFixed(1)}, ${r.pos[1].toFixed(1)}), ${r.dist.toFixed(1)} m` +
    (Math.abs(r.turn) > 0.01 ? `, turned ${Math.round(r.turn)}°` : ', straight') + (r.quality !== 'open-line' ? ` (${r.quality})` : '');
  const uneven = rs.length === 2 && (Math.abs(Math.abs(rs[0].turn) - Math.abs(rs[1].turn)) > 15 || Math.abs(rs[0].dist - rs[1].dist) > 6);
  let text = rs.length ? 'bots: the parasite rally ' + rs.map(one).join('; ') + (uneven ? ': UNEVEN between the teams' : '') : 'bots: no parasite camp (the first map\'s rally points)';
  for (const rt of b.routes || []) text += `. Hunter route team ${rt.team}: ` + (rt.steps.length ? rt.steps.map((s, i) => `${i + 1} ${s.role}${s.minLevel > 1 ? ' (L' + s.minLevel + ')' : ''}`).join(', ') : 'none (no camps on its half)');
  return { text, uneven };
}

// ---- hit testing and the mouse ----------------------------------------------------------------------------

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function distLine(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(p, pts[i - 1], pts[i]));
  return d;
}
function inPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function shapeHit(sh, w) {
  if (!sh || sh.lane !== undefined) return false;
  if (isPt(sh.circle)) return Math.hypot(w[0] - sh.circle[0], w[1] - sh.circle[1]) <= (+sh.r || 0);
  if (Array.isArray(sh.polygon) && sh.polygon.every(isPt)) return inPoly(w, sh.polygon);
  if (Array.isArray(sh.path) && sh.path.every(isPt)) return distLine(w, sh.path) <= Math.max(+sh.width || 0, 2) / 2;
  return false;
}

// hit returns what is under a view's pick (or under the shown view's canvas point sx, sy): {sel, mirrored}. Handles,
// objects and knots are hit on the screen through the view's project (within so many pixels), shapes and lanes at
// the pick's world point.
function hit(a, b) {
  const pk = typeof a === 'number' ? ED.active().pickAt(a, b) : a;
  if (!pk) return null;
  const v = ED.views[pk.view] || VIEW2D, w = pk.w, sx = pk.sx, sy = pk.sy;
  const near = (p, px) => { const s = v.project(p); return !!s && Math.hypot(s[0] - sx, s[1] - sy) <= px * dpr; };
  if (S.sel && ['shape', 'vertex', 'radius'].includes(S.sel.t)) {
    for (const hd of shapeHandles(S.sel.i)) if (near(hd.pos, 7)) return { sel: { t: hd.t, i: hd.i, v: hd.v } };
  }
  const lw = laneWidthHandle(); // the lanes' width (EDUX4)
  if (lw && near(lw.pos, 8)) return { sel: { t: 'lwidth', l: lw.l, k: lw.k } };
  for (const fn of ED.hitFirst) { const r = fn(sx, sy, w, near, pk); if (r) return r; }
  if (S.show.objects) {
    const obs = objects();
    for (const o of obs) if (near(o.pos, 9)) return { sel: objSel(o) };
    if (S.show.mirror) for (const o of obs) if (!o.once && near(mir(o.pos), 9)) return { sel: objSel(o), mirrored: true };
  }
  for (const fn of ED.hitItems) { const r = fn(sx, sy, w, near, pk); if (r) return r; }
  if (S.show.lanes) {
    const L = lanes();
    for (let li = 0; li < L.length; li++) {
      const ks = (L[li] && L[li].knots) || [];
      for (let k = 0; k < ks.length; k++) if (isPt(ks[k]) && near(ks[k], 7)) return { sel: { t: 'knot', l: li, k } };
    }
  }
  if (S.show.shapes) {
    const sh = shapes();
    for (let i = sh.length - 1; i >= 0; i--) if (shapeHit(sh[i], w)) return { sel: { t: 'shape', i } };
    if (S.show.mirror) for (let i = sh.length - 1; i >= 0; i--) if (shapeHit(sh[i], mir(w))) return { sel: { t: 'shape', i }, mirrored: true };
  }
  if (S.show.lanes) {
    const L = lanes();
    for (let li = 0; li < L.length; li++) {
      const l = L[li];
      if (l && Array.isArray(l.knots) && l.knots.every(isPt) && distLine(w, l.knots) <= (+l.width || 0) / 2) return { sel: { t: 'lane', l: li } };
    }
  }
  return null;
}

// snapW rounds a point the mouse gives: to 1 m with Shift or Tools > Snap to 1 m, else to 0.1 m (the grid snap; the
// doodads' tools and the brush strokes use it)
function snapW(w, e) {
  if ((e && e.shiftKey) || S.snap) return [Math.round(w[0]), Math.round(w[1])];
  return [r1(w[0]), r1(w[1])];
}
// smartW is snapW with the labelled snaps (EDUX6, feedback.js: the mirror line, a lane's edge, a midpoint, the grid)
// for a point the mouse places (e: its event): a drawing's corners, + Well, + Camp, + Ward spot. e.exact: the point as
// it is (typed); no event (a script's point): snapW only
function smartW(w, e) {
  if (e && e.exact) return [r1(w[0]), r1(w[1])];
  if (ED.snapAt && e) { const s = ED.snapAt(w, e); if (s) return s.p; }
  return snapW(w, e);
}

// moveSel applies a drag: the world delta d from the drag's start, on the values as they were then. The delta goes
// through the labelled snaps first (ED.snapDrag: the dragged point snapped as a whole, so a shape keeps its form);
// e.fixedD gives the delta itself (a typed value, a refused step's last good one: feedback.js)
function moveSel(drag, w, e) {
  const sel = drag.sel;
  let d0 = w ? [w[0] - drag.start[0], w[1] - drag.start[1]] : [0, 0];
  drag.snap = null;
  if (e && e.fixedD) d0 = e.fixedD.slice();
  else if (ED.snapDrag) d0 = ED.snapDrag(drag, d0, e) || d0;
  drag.d0 = d0;
  const d = drag.mirrored ? mir(d0) : d0;
  const orig = drag.orig, ge = drag.snap || (e && e.fixedD && e.exact) ? null : e; // a snapped point isn't rounded off it
  const at = p => snapW([p[0] + d[0], p[1] + d[1]], ge);
  switch (sel.t) {
    case 'obj': setPoint(sel.path, at(orig)); break;
    case 'knot': setPoint(['lanes', sel.l, 'knots', sel.k], at(orig)); break;
    case 'vertex': { const s = shapes()[sel.i]; (s.polygon || s.path)[sel.v] = at(orig); break; }
    case 'radius': { // e.r: a typed radius
      const s = shapes()[sel.i];
      s.r = e && e.r ? e.r : w ? Math.max(1, r1(Math.hypot(w[0] - s.circle[0], w[1] - s.circle[1]))) : orig.r;
      break;
    }
    case 'lwidth': { // the lanes' width: twice the mouse's distance from the knot across the lane (half metres; Shift or
      // Snap: metres), kept within the check's 6 to 80 m (EDUX6: what the mouse asks for is drag.want, drawn red past it)
      const hd = laneWidthHandle();
      if (!hd) break;
      let want = e && e.width ? e.width : +orig.width || 24;
      if (w && !(e && e.width)) {
        const off = Math.abs((w[0] - hd.at[0]) * hd.n[0] + (w[1] - hd.at[1]) * hd.n[1]), q = (e && e.shiftKey) || S.snap ? 1 : 2;
        want = Math.round(2 * off * q) / q;
      }
      drag.want = want;
      const width = Math.min(LANE_MAX, Math.max(LANE_MIN, want));
      lanes().forEach(l => { if (l) l.width = width; });
      break;
    }
    case 'shape': {
      const s = shapes()[sel.i];
      if (isPt(orig.circle)) s.circle = at(orig.circle);
      if (Array.isArray(orig.polygon)) s.polygon = orig.polygon.map(at);
      if (Array.isArray(orig.path)) s.path = orig.path.map(at);
      break;
    }
    default: if (ED.sel[sel.t] && ED.sel[sel.t].move) ED.sel[sel.t].move(drag, w, e, at);
  }
  if (drag.joined && drag.joined.length) { // the shapes joined to a knot, a well or a camp follow its own move
    const now = selValue(sel);
    if (isPt(now) && isPt(orig)) moveJoined(drag.joined, [now[0] - orig[0], now[1] - orig[1]]);
  }
}

// startMove keeps what a drag starts from: the selection's value and, for a lane knot, a well or a camp with the
// option on, the shapes joined to it (MAPED-EDIT6)
function startMove(drag) {
  const v = drag.sel.t === 'shape' ? shapes()[drag.sel.i] : selValue(drag.sel);
  drag.orig = JSON.parse(JSON.stringify(v));
  drag.joined = S.joined ? joinedTo(drag.sel) : [];
  if (ED.dragStart) ED.dragStart(drag); // feedback.js: what the drag's refusals compare with
}

// ---- what a drag takes along (MAPED-EDIT6) ------------------------------------------------------------------
// joinedTo lists the shapes joined to a lane knot, a well or a camp, each as a move {i, whole | v, w, neg, orig}: the
// shape (whole) or one of its points (v: a polygon's corner or a path's point) moves by w times the object's move
// (mirrored when neg). At the object (within JOIN_AT): a circle centred on it, path points and corners on it (w 1).
// Along a knot's two legs (the corridor: the lane's half width + 2 m): the ends of paths and the corners of polygons
// in it, and the shapes no wider than the lane whose centre is in it, moved whole; w is 1 at the knot and falls to 0 at
// the leg's other knot, so a path that met the lane keeps meeting it. The other lane's partner knot (the mirror) takes
// its own joined shapes along mirrored.
const JOIN_AT = 3;
function shapeCentre(s) {
  if (isPt(s.circle)) return s.circle;
  const pts = (Array.isArray(s.polygon) ? s.polygon : Array.isArray(s.path) ? s.path : []).filter(isPt);
  if (!pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}
function shapeExtent(s, c) {
  if (isPt(s.circle)) return +s.r || 0;
  const pts = (Array.isArray(s.polygon) ? s.polygon : Array.isArray(s.path) ? s.path : []).filter(isPt);
  return pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - c[0], p[1] - c[1])), 0) + (+s.width || 0) / 2;
}
function joinedTo(sel) {
  const out = [], taken = new Set(), sh = shapes();
  const add = m => {
    const k = m.i + ':' + (m.whole ? '*' : m.v);
    if (taken.has(k) || taken.has(m.i + ':*')) return;
    taken.add(k);
    const s = sh[m.i];
    m.orig = JSON.parse(JSON.stringify(m.whole ? s : (s.polygon || s.path)[m.v]));
    out.push(m);
  };
  const atPoint = (P, neg) => sh.forEach((s, i) => {
    if (!s || s.lane !== undefined) return;
    if (isPt(s.circle) && Math.hypot(s.circle[0] - P[0], s.circle[1] - P[1]) <= JOIN_AT) add({ i, whole: true, w: 1, neg });
    const pts = Array.isArray(s.polygon) ? s.polygon : Array.isArray(s.path) ? s.path : null;
    if (pts) pts.forEach((p, v) => { if (isPt(p) && Math.hypot(p[0] - P[0], p[1] - P[1]) <= JOIN_AT) add({ i, v, w: 1, neg }); });
  });
  const alongLegs = (li, k, neg) => {
    const l = lanes()[li];
    if (!l || !Array.isArray(l.knots) || !isPt(l.knots[k])) return;
    const K = l.knots, P = K[k], width = +l.width || 0, half = width / 2 + 2;
    atPoint(P, neg);
    const weight = q => { // 1 - t on the nearer leg whose corridor holds q, or null
      let best = null;
      for (const j of [k - 1, k + 1]) {
        if (j < 0 || j >= K.length || !isPt(K[j])) continue;
        const dx = K[j][0] - P[0], dy = K[j][1] - P[1], l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = ((q[0] - P[0]) * dx + (q[1] - P[1]) * dy) / l2;
        if (t < 0 || t > 1) continue;
        const d = Math.hypot(q[0] - P[0] - t * dx, q[1] - P[1] - t * dy);
        if (d <= half && (!best || d < best.d)) best = { d, w: 1 - t };
      }
      return best && best.w;
    };
    sh.forEach((s, i) => {
      if (!s || s.lane !== undefined) return;
      const c = shapeCentre(s);
      if (!c) return;
      if (!Array.isArray(s.path) && shapeExtent(s, c) <= width) {
        const w = weight(c);
        if (w !== null) { add({ i, whole: true, w, neg }); return; }
      }
      const pts = Array.isArray(s.polygon) ? s.polygon.map((p, v) => v) : Array.isArray(s.path) ? [0, s.path.length - 1] : [];
      for (const v of pts) {
        const p = (s.polygon || s.path)[v];
        if (!isPt(p)) continue;
        const w = weight(p);
        if (w !== null) add({ i, v, w, neg });
      }
    });
  };
  if (sel.t === 'knot') {
    alongLegs(sel.l, sel.k, false);
    const pk = partnerKnot(sel.l, sel.k);
    if (pk) alongLegs(pk[0], pk[1], true);
  } else if (sel.t === 'obj' && ['wells', 'camps'].includes(sel.path[0])) {
    const P = getAt(S.doc, sel.path);
    if (isPt(P)) atPoint(P, false);
  }
  return out;
}
function moveJoined(joined, d) {
  const sh = shapes();
  for (const m of joined) {
    const s = sh[m.i];
    if (!s) continue;
    const dd = m.neg ? mir(d) : d, by = p => [r1(p[0] + m.w * dd[0]), r1(p[1] + m.w * dd[1])].concat(p.slice(2));
    if (!m.whole) { (s.polygon || s.path)[m.v] = by(m.orig); continue; }
    if (isPt(m.orig.circle)) s.circle = by(m.orig.circle);
    if (Array.isArray(m.orig.polygon)) s.polygon = m.orig.polygon.map(by);
    if (Array.isArray(m.orig.path)) s.path = m.orig.path.map(by);
  }
}

function beginDrag(h, w) {
  let sel = h.sel;
  if (sel.t === 'lane') return null;
  if (sel.t === 'shape' && shapes()[sel.i] && shapes()[sel.i].lane !== undefined) return null;
  return { sel, mirrored: !!h.mirrored, start: w, orig: null, moved: false };
}

// ---- the input pipeline (EDUX2): one set of mouse handlers for every view ---------------------------------------
// A view's own handlers keep its camera (2-D: the right, middle and Alt + left drags, the wheel's zoom) and send the
// rest here: inputDown(v, e) on a left press, inputDbl(v, e) on a double-click, inputWheel(v, e) before the wheel
// zooms. The window's mousemove and mouseup follow the view that took the press (S.press), else the shown one. Each
// works on the view's pick: S.mouseW and hit() follow the view, and the tools keep their (w, e) interface. A view
// whose pick gives null (the 3-D view until EDUX3) takes no press: inputDown returns false and its camera moves.
function inputDown(v, e) {
  if (!S.doc || e.button !== 0) return false;
  const pk = v.pick(e);
  if (!pk) return false;
  S.press = v.id;
  S.near = pk.near;
  const w = pk.w;
  if (ED.pressed) ED.pressed(e); // feedback.js: a press ends what a typed value would still change
  if (S.tool === 'shape') { // a cliff: the brush strokes, the other draw modes draw a shape
    if (S.draw === 'brush') { S.stroke = { pts: [snapW(w, e)] }; render(); return true; }
    drawDown(w, e);
    return true;
  }
  if (ED.tools[S.tool] && ED.tools[S.tool].down) { ED.tools[S.tool].down(w, e); return true; }
  if (S.tool === 'camp') { ED.camps.place(smartW(w, e)); return true; } // Units > Add a Camp: the type armed (camps.js)
  if (S.tool === 'well' || S.tool === 'ward') { // the Units tab's + Well, + Mine, + Ward spot
    const p = smartW(w, e), list = { well: 'wells', ward: 'wards' }[S.tool];
    if (ED.refusePlace && ED.refusePlace(S.tool, p)) return true; // feedback.js: on a wall, past the edge, team 2's half
    const item = S.tool === 'well' && S.wellKind === 'mine' ? { kind: 'mine', pos: p } : { pos: p };
    edit(d => {
      d[list] = Array.isArray(d[list]) ? d[list] : [];
      d[list].push(item);
      select({ t: 'obj', path: [list, d[list].length - 1, 'pos'] });
    });
    return true;
  }
  const h = hit(pk);
  for (const fn of ED.down) if (fn(h, e, w, pk)) return true;
  select(h ? h.sel : null);
  if (h) S.drag = beginDrag(h, w);
  return true;
}
function inputMove(e) {
  if (!S.doc) return;
  const v = (S.press && ED.views[S.press]) || ED.active(), pk = v.pick(e);
  S.mouseW = pk ? pk.w : null;
  if (pk) S.near = pk.near;
  if (pk) ED.emit('cursor', pk.w); // the status bar's first part (frame.js)
  if (ED.tools[S.tool] && ED.tools[S.tool].hover && !S.pan && !S.drawing) render();
  if (S.pan) return pan2d(e);
  if (!pk) return;
  const w = pk.w;
  if (S.grab) { S.grab.move(w, e); return; } // propsel.js: the selection box
  if (S.drawing) { S.drawing.mouse = smartW(w, e); if (S.drawing.down) drawMove(w, e); render(); return; }
  if (S.stroke) { // the cliff brush's stroke: a point every eighth of the brush
    const last = S.stroke.pts[S.stroke.pts.length - 1];
    if (Math.hypot(w[0] - last[0], w[1] - last[1]) >= Math.max(0.3, S.brush.size / 8)) S.stroke.pts.push(snapW(w, e));
    render();
    return;
  }
  if (S.tool === 'shape' && S.draw === 'brush') { render(); return; } // the brush's outline follows the mouse
  if (ED.tools[S.tool] && ED.tools[S.tool].move) { ED.tools[S.tool].move(w, e); return; } // ground.js: paint, stamp
  if (S.drag && (e.buttons & 1)) {
    if (!S.drag.moved) {
      if (Math.hypot(w[0] - S.drag.start[0], w[1] - S.drag.start[1]) < 3 * pk.near) return; // 3 pixels
      if (S.drag.sel.t === 'auto') { // the derived places become explicit, then this one moves
        pushUndo();
        if (!materialize(S.drag.sel.which)) { log('no derived places yet: wait for the check', 'err'); S.drag = null; return; }
        S.drag.sel = autoToPath(S.drag.sel);
        S.drag.undone = true;
        select(S.drag.sel);
      }
      if (!S.drag.undone) pushUndo();
      S.drag.moved = true;
      startMove(S.drag);
    }
    moveSel(S.drag, w, e);
    if (ED.dragCheck) ED.dragCheck(S.drag, w, e); // feedback.js: a hard rule break is refused (the last good step stays)
    changed(true);
  }
}
function inputUp() {
  S.press = null;
  if (S.pan) { S.pan = null; return; }
  if (S.grab) { const g = S.grab; S.grab = null; g.up(); return; }
  if (S.drawing && S.drawing.down) return drawUp();
  if (S.stroke) return cliffStrokeEnd();
  if (ED.tools[S.tool] && ED.tools[S.tool].up) { ED.tools[S.tool].up(); return; }
  if (S.drag && S.drag.moved) { scheduleCheck(); if (ED.dragEnd) ED.dragEnd(S.drag); }
  S.drag = null;
}
// inputWheel offers the wheel to the armed tool (props.js: Ctrl+wheel sizes, Shift+wheel turns the next doodad);
// true when it took it (the view then doesn't zoom)
// then to the parts' ED.wheels (props.js: Alt+wheel, the selected doodads' height). Alt+wheel never zooms.
function inputWheel(v, e) {
  if (!S.doc) return false;
  const tool = ED.tools[S.tool];
  if (tool && tool.wheel) {
    const pk = v.pick(e);
    if (pk && tool.wheel(e, pk.w)) { render(); return true; }
  }
  for (const fn of ED.wheels) if (fn(e)) { render(); return true; }
  return !!e.altKey;
}
function inputDbl(v, e) {
  if (S.drawing) { drawFinish(); return true; }
  const pk = v.pick(e);
  if (!pk) return false;
  const h = hit(pk);
  if (h && h.sel.t === 'shape') { // a polygon or path gets a vertex where it's double-clicked
    const s = shapes()[h.sel.i], pts = s.polygon || s.path;
    if (!Array.isArray(pts)) return true;
    const w = snapW(pk.w);
    let best = 0, bd = Infinity;
    const n = s.polygon ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) { const d = distSeg(w, pts[i], pts[(i + 1) % pts.length]); if (d < bd) { bd = d; best = i; } }
    edit(() => pts.splice(best + 1, 0, w));
    select({ t: 'vertex', i: h.sel.i, v: best + 1 });
  }
  return true;
}
ED.input = { down: inputDown, dbl: inputDbl, wheel: inputWheel, move: inputMove, up: inputUp };
window.addEventListener('mousemove', inputMove);
window.addEventListener('mouseup', inputUp);

// the 2-D view's own mouse: the camera (right or middle drag pans, the World Editor's; Shift + right drag zooms; Alt +
// left drag pans; the wheel zooms about the mouse); the left button goes to the pipeline
cv.addEventListener('mousedown', e => {
  if (!S.doc) return;
  cv.focus();
  if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
    const [sx, sy] = evPos(e);
    S.pan = { sx, sy, x: S.view.x, y: S.view.y, zoom: e.button === 2 && e.shiftKey, scale: S.view.scale, w: s2w(sx, sy) };
    e.preventDefault();
    return;
  }
  inputDown(VIEW2D, e);
});
function pan2d(e) {
  const [sx, sy] = evPos(e);
  S.fitted = false;
  if (S.pan.zoom) { // Shift + right drag: up zooms in, about the point the drag started at
    S.view.scale = Math.max(0.05, S.pan.scale * Math.exp(-(sy - S.pan.sy) * 0.01 / dpr));
    const ps = w2s(S.pan.w);
    S.view.x += (ps[0] - S.pan.sx) / S.view.scale;
    S.view.y -= (ps[1] - S.pan.sy) / S.view.scale;
    render();
    return;
  }
  S.view.x = S.pan.x - (sx - S.pan.sx) / S.view.scale;
  S.view.y = S.pan.y + (sy - S.pan.sy) / S.view.scale;
  render();
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  if (!S.doc) return;
  e.preventDefault();
  if (inputWheel(VIEW2D, e)) return;
  const [sx, sy] = evPos(e), w = s2w(sx, sy);
  S.fitted = false;
  S.view.scale *= Math.exp(-e.deltaY * 0.0015);
  const w2 = s2w(sx, sy);
  S.view.x += w[0] - w2[0];
  S.view.y += w[1] - w2[1];
  render();
}, { passive: false });
cv.addEventListener('dblclick', e => inputDbl(VIEW2D, e));

function autoToPath(sel) {
  if (sel.which === 'cores') return { t: 'obj', path: ['base', 'cores', sel.idx] };
  return { t: 'obj', path: ['base', 'bindings', String(sel.lane), sel.tier] };
}

// ---- drawing: one draw mode for textures and cliffs -----------------------------------------------------------
// The Terrain tab draws a material (a texture layer: the 'paint' tool, ground.js; a cliff kind: the 'shape' tool) with
// one shared draw mode S.draw: 'brush' (a stroke of S.brush's size and shape), 'polygon' (click corners; double-click
// or Enter ends), 'circle' (press at the centre, drag the radius) or 'path' (click points; its width the brush size).
// Picking a material never changes the draw mode, and picking a draw mode keeps the material.

// the Terrain tab's Apply Cliff kind; Water is a chasm with water in its dip
function newType() { return S.cliff === 'water' ? 'chasm' : S.cliff; }
function newGeom() { return S.draw === 'brush' ? 'circle' : S.draw; } // the geometry a click-drawn shape takes
function newShape(sh) { // a drawn shape of the armed kind
  const s = Object.assign({ type: newType() }, sh);
  if (S.cliff === 'water') s.water = true;
  return s;
}
const DRAW_NAMES = { brush: 'Brush', polygon: 'Polygon', circle: 'Circle', path: 'Path' };
// drawLabel is the draw mode for the status bar ("Brush 8 m", "Polygon", "Path 8 m")
function drawLabel() {
  const b = S.brush;
  return S.draw === 'brush' ? `Brush ${b.size} m${b.shape === 'square' ? ' square' : ''}` : S.draw === 'path' ? `Path ${b.size} m` : DRAW_NAMES[S.draw];
}
// setCliff picks a cliff kind as the material (Terrain > Apply Cliff): the shape tool, the draw mode kept
function setCliff(kind) {
  if (kind) S.cliff = kind;
  S.drawing = null;
  setTool('shape');
}
// setMaterial picks what the pen applies (the Terrain tab's Texture | Cliff switch): 'paint' (a texture layer: Apply
// Texture) or 'shape' (a cliff kind: Apply Cliff); it arms that material's tool and keeps the draw mode, and the tab
// then shows only that material's list. S.lastMaterial remembers it across Select and the other tabs.
function setMaterial(m) {
  if (m === 'paint' && ED.tools.paint) setTool('paint');
  else if (m === 'shape') setCliff();
}
// setDraw picks the draw mode (Terrain > Draw with); a material's tool stays (or comes back from Select)
function setDraw(mode) {
  if (!DRAW_NAMES[mode]) return;
  S.draw = mode;
  S.drawing = null;
  S.stroke = null;
  setTool(S.tool === 'paint' || S.tool === 'shape' ? S.tool : (S.lastMaterial === 'paint' && ED.tools.paint ? 'paint' : 'shape'));
}
function drawDown(w, e, geom) {
  const p = smartW(w, e), g = geom || newGeom();
  if (ED.refuseCorner && ED.refuseCorner(p, g)) { render(); return; } // feedback.js: a polygon's corner that crosses it
  if (g === 'circle') { S.drawing = { geom: g, center: p, r: 0, down: true, mouse: p }; return; }
  if (!S.drawing) S.drawing = { geom: g, pts: [], mouse: p };
  S.drawing.pts.push(p);
  render();
}
function drawMove(w) {
  const d = S.drawing;
  if (d.geom === 'circle') d.r = r1(Math.hypot(w[0] - d.center[0], w[1] - d.center[1]));
}
function drawUp() {
  const d = S.drawing;
  if (d.geom === 'circle') {
    S.drawing = null;
    if (d.r < 1) { render(); return; }
    commitDrawn({ circle: d.center, r: d.r });
  }
}
function drawFinish() {
  const d = S.drawing;
  if (!d || d.geom === 'circle') return;
  S.drawing = null;
  // a double-click adds its point twice
  const pts = d.pts.filter((p, i) => !i || Math.hypot(p[0] - d.pts[i - 1][0], p[1] - d.pts[i - 1][1]) > 0.05);
  if (d.geom === 'polygon' && ED.refuseClose && ED.refuseClose(pts)) { d.pts = pts; S.drawing = d; render(); return; } // feedback.js: its closing edge crosses it
  if (ED.tools[S.tool] && ED.tools[S.tool].finish) { ED.tools[S.tool].finish(pts); render(); return; }
  let done = true;
  if (d.geom === 'polygon' && pts.length >= 3) done = commitDrawn({ polygon: pts });
  else if (d.geom === 'path' && pts.length >= 2) done = commitDrawn({ path: pts, width: r1(Math.max(1, S.brush.size)) });
  else render();
  if (done === false) { d.pts = pts; S.drawing = d; render(); } // refused (feedback.js): the drawing stays to be mended
}
// commitDrawn hands a drawn geometry to the tool's drawn(sh) (a texture layer's mask: ground.js), else adds it as a
// cliff shape: one on team 2's half (its box's centre past the line) is mirrored onto team 1's (symmetry.half)
function commitDrawn(sh) {
  const t = ED.tools[S.tool];
  if (t && t.drawn) { t.drawn(sh); render(); return; }
  const s = asBush(newShape(toTeam1(sh)));
  if (ED.refuseShapes && ED.refuseShapes([s])) { render(); return false; } // feedback.js: an object it would wall in
  addShape(s);
  return true;
}
function shapePts(sh) { return sh.circle ? [sh.circle] : sh.polygon || sh.path || []; }
function toTeam1(sh) {
  const ps = shapePts(sh);
  if (!ps.length) return sh;
  const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
  if ((Math.min(...xs) + Math.max(...xs)) / 2 + (Math.min(...ys) + Math.max(...ys)) / 2 <= 0) return sh;
  const m = Object.assign({}, sh);
  if (sh.circle) m.circle = mir(sh.circle);
  if (sh.polygon) m.polygon = sh.polygon.map(mir);
  if (sh.path) m.path = sh.path.map(mir);
  return m;
}
// the drawing in progress (a polygon, circle or path of the draw mode), through the view v (a preview)
function drawDrawing(v) {
  const d = S.drawing;
  if (!d) return;
  const g = v.overlay;
  g.save();
  g.strokeStyle = '#fff';
  g.setLineDash([4 * dpr, 3 * dpr]);
  g.lineWidth = 1.5 * dpr;
  if (d.geom === 'circle') {
    vring(v, d.center, d.r); // draped in 3-D
    g.stroke();
  } else {
    const pts = d.pts.concat(d.mouse ? [d.mouse] : []);
    if (d.geom === 'path' && S.tool === 'shape' && pts.length > 1) { // the path's band at the brush's width
      g.save();
      g.setLineDash([]);
      g.globalAlpha = v.drape ? 0.9 : 0.35;
      g.strokeStyle = (TYPE[newType()] || TYPE.open)[1];
      vband(v, pts, Math.max(1, S.brush.size));
      g.restore();
    }
    vpoly(v, pts, d.geom === 'polygon');
    g.stroke();
  }
  g.restore();
}
ED.previews.push(drawDrawing);
function addShape(sh) {
  edit(d => {
    d.terrain = d.terrain && typeof d.terrain === 'object' ? d.terrain : { default: 'wall' };
    d.terrain.shapes = Array.isArray(d.terrain.shapes) ? d.terrain.shapes : [];
    d.terrain.shapes.push(sh);
  });
  select({ t: 'shape', i: shapes().length - 1 });
}

// ---- the cliff brush: a stroke of the brush becomes terrain shapes of the kind ----------------------------------
// A click is a dab (a circle of the brush's size, the square brush a square polygon); a drag a path of its width,
// thinned (simplifyPts, as the ground's strokes are). The stroke is split where it crosses the mirror line (x + y = 0)
// and each piece on team 2's half is mirrored onto team 1's, so every piece passes symmetry.half and the compiler's
// mirrors show the stroke as drawn. One undo step a stroke.
function simplifyPts(pts, tol) { // Douglas-Peucker
  if (pts.length < 3) return pts.slice();
  let best = -1, bd = tol;
  for (let i = 1; i < pts.length - 1; i++) { const d = distSeg(pts[i], pts[0], pts[pts.length - 1]); if (d > bd) { bd = d; best = i; } }
  if (best < 0) return [pts[0], pts[pts.length - 1]];
  return simplifyPts(pts.slice(0, best + 1), tol).slice(0, -1).concat(simplifyPts(pts.slice(best), tol));
}
function brushDab(c, size, square) {
  const p = c[0] + c[1] > 0 ? mir(c) : c, hs = size / 2;
  if (square) return { polygon: [[r1(p[0] - hs), r1(p[1] - hs)], [r1(p[0] + hs), r1(p[1] - hs)], [r1(p[0] + hs), r1(p[1] + hs)], [r1(p[0] - hs), r1(p[1] + hs)]] };
  return { circle: [r1(p[0]), r1(p[1])], r: r1(hs) };
}
function cliffStrokeShapes(pts) {
  const size = Math.max(1, +S.brush.size || 8), square = S.brush.shape === 'square';
  const span = Math.max(...pts.map(p => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])));
  if (pts.length < 2 || span < size / 4) return [brushDab(pts[0], size, square)];
  const pieces = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], sa = a[0] + a[1], sb = b[0] + b[1];
    if ((sa > 0) !== (sb > 0) && sa !== sb) { // crosses the mirror line: split at the crossing
      const t = sa / (sa - sb), c = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      cur.push(c);
      pieces.push(cur);
      cur = [c];
    }
    cur.push(b);
  }
  pieces.push(cur);
  const out = [];
  for (const pc of pieces) {
    const len = pc.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pc[i][0], p[1] - pc[i][1]), 0);
    if (len < 0.5) continue;
    const mid = pc.reduce((s, p) => s + p[0] + p[1], 0) / pc.length;
    const q = simplifyPts(mid > 0 ? pc.map(mir) : pc, Math.max(0.15, size / 20)).map(p => [r1(p[0]), r1(p[1])]);
    out.push({ path: q.filter((p, i) => !i || p[0] !== q[i - 1][0] || p[1] !== q[i - 1][1]), width: r1(size) });
  }
  return out.filter(s => s.path.length >= 2);
}
// ---- a bush drawn as a band: its outline -----------------------------------------------------------------------
// A bush is a circle or a polygon (the compiler's terrain.shape rule: the game outlines a bush's grass), so a bush's
// Brush stroke or Path (a band: a path of a width) is written as the band's outline: the band laid on a grid of
// cells of about w/8 m (at most 400 000 cells), holes filled, cells touching only at a corner joined, the largest piece
// kept, its edge traced round (counter-clockwise) and thinned (Douglas-Peucker on the closed outline) as far as it
// stays a polygon that doesn't cross itself.
function segsHit(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (!o1 && on(a, b, c)) || (!o2 && on(a, b, d)) || (!o3 && on(c, d, a)) || (!o4 && on(c, d, b));
}
function polyCrosses(ps) { // two edges of the closed polygon ps that aren't neighbours meet
  const n = ps.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsHit(ps[i], ps[(i + 1) % n], ps[j], ps[(j + 1) % n])) return true;
    }
  }
  return false;
}
function bandOutline(path, w) {
  const r = w / 2, xs = path.map(p => p[0]), ys = path.map(p => p[1]);
  const x0 = Math.min(...xs) - r, y0 = Math.min(...ys) - r, x1 = Math.max(...xs) + r, y1 = Math.max(...ys) + r;
  const c = Math.max(Math.min(1, Math.max(0.2, w / 8)), Math.sqrt((x1 - x0) * (y1 - y0) / 4e5));
  const ox = x0 - c, oy = y0 - c, nx = Math.ceil((x1 - x0) / c) + 2, ny = Math.ceil((y1 - y0) / c) + 2;
  const at = (i, j) => j * nx + i;
  let g = new Uint8Array(nx * ny); // 1: in the band (the border ring of cells stays out)
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const i0 = Math.max(1, Math.floor((Math.min(a[0], b[0]) - r - ox) / c)), i1 = Math.min(nx - 2, Math.ceil((Math.max(a[0], b[0]) + r - ox) / c));
    const j0 = Math.max(1, Math.floor((Math.min(a[1], b[1]) - r - oy) / c)), j1 = Math.min(ny - 2, Math.ceil((Math.max(a[1], b[1]) + r - oy) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!g[at(i, j)] && distSeg([ox + (i + 0.5) * c, oy + (j + 0.5) * c], a, b) <= r) g[at(i, j)] = 1;
    }
  }
  const flood = (from, ok) => { // the cells 4-connected to from where ok(cell), as a list
    const seen = new Uint8Array(nx * ny), out = [from], st = [from];
    seen[from] = 1;
    while (st.length) {
      const q = st.pop(), i = q % nx, j = (q - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, n = at(ii, jj);
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || seen[n] || !ok(n)) continue;
        seen[n] = 1; out.push(n); st.push(n);
      }
    }
    return out;
  };
  for (let round = 0; round < 8; round++) {
    const outside = new Uint8Array(nx * ny); // holes filled: what the border's outside cells don't reach is in
    for (const n of flood(0, n => !g[n])) outside[n] = 1;
    for (let n = 0; n < g.length; n++) g[n] = outside[n] ? 0 : 1;
    let joined = 0; // two cells in touching only at a corner: the cell beside them taken in
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = g[at(i, j)], b = g[at(i + 1, j)], d = g[at(i, j + 1)], e = g[at(i + 1, j + 1)];
      if (a && e && !b && !d) { g[at(i + 1, j)] = 1; joined++; } else if (b && d && !a && !e) { g[at(i, j)] = 1; joined++; }
    }
    if (!joined) break;
  }
  let best = [];
  const done = new Uint8Array(nx * ny);
  for (let n = 0; n < g.length; n++) {
    if (!g[n] || done[n]) continue;
    const part = flood(n, m => g[m] === 1);
    part.forEach(m => { done[m] = 1; });
    if (part.length > best.length) best = part;
  }
  if (!best.length) return null;
  const keep = new Uint8Array(nx * ny);
  best.forEach(m => { keep[m] = 1; });
  // the edge: each cell's sides towards out, counter-clockwise (the band on the left), corner (i, j) to the next
  const nxt = new Map(), V = (i, j) => j * (nx + 1) + i, inn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && keep[at(i, j)];
  let start = -1;
  for (const m of best) {
    const i = m % nx, j = (m - i) / nx;
    if (!inn(i, j - 1)) nxt.set(V(i, j), V(i + 1, j));
    if (!inn(i + 1, j)) nxt.set(V(i + 1, j), V(i + 1, j + 1));
    if (!inn(i, j + 1)) nxt.set(V(i + 1, j + 1), V(i, j + 1));
    if (!inn(i - 1, j)) nxt.set(V(i, j + 1), V(i, j));
  }
  start = nxt.keys().next().value;
  const ring = [];
  for (let v = start, k = 0; k <= nxt.size; k++) {
    ring.push(v);
    v = nxt.get(v);
    if (v === start || v === undefined) break;
  }
  const P = ring.map(v => { const i = v % (nx + 1); return [ox + i * c, oy + (v - i) / (nx + 1) * c]; });
  // the middles of the cells' sides: the staircase smoothed (within c/2 of the band's edge, not c)
  let pts = P.map((p, k) => { const q = P[(k + 1) % P.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
  pts = pts.filter((p, k) => { // the turns only
    const a = pts[(k + pts.length - 1) % pts.length], b = pts[(k + 1) % pts.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-9;
  });
  const tidy = ps => {
    const q = ps.map(p => [r1(p[0]), r1(p[1])]).filter((p, k, a) => !k || p[0] !== a[k - 1][0] || p[1] !== a[k - 1][1]);
    while (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
    return q;
  };
  for (let tol = Math.max(0.8 * c, w / 12); tol >= 0.1 * c; tol /= 2) {
    let far = 0; // the closed outline as two chains: from the first corner to the one farthest from it, and back
    pts.forEach((p, k) => { if (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = k; });
    const q = tidy(simplifyPts(pts.slice(0, far + 1), tol).concat(simplifyPts(pts.slice(far).concat([pts[0]]), tol).slice(1, -1)));
    if (q.length >= 3 && !polyCrosses(q)) return q;
  }
  return tidy(pts);
}
// asBush writes a drawn bush that is a band as its outline (anything else as it is)
function asBush(s) {
  if (!s || s.type !== 'bush' || !Array.isArray(s.path)) return s;
  const poly = bandOutline(s.path, Math.max(1, +s.width || 1));
  if (!poly || poly.length < 3) return s;
  const o = Object.assign({}, s, { polygon: poly });
  delete o.path;
  delete o.width;
  return o;
}
function cliffStrokeEnd() {
  const st = S.stroke;
  S.stroke = null;
  if (!st) return;
  const list = cliffStrokeShapes(st.pts).map(newShape).map(asBush);
  if (!list.length) { render(); return; }
  if (ED.refuseShapes && ED.refuseShapes(list)) { render(); return; } // feedback.js: an object it would wall in
  edit(d => {
    d.terrain = d.terrain && typeof d.terrain === 'object' ? d.terrain : { default: 'wall' };
    d.terrain.shapes = Array.isArray(d.terrain.shapes) ? d.terrain.shapes : [];
    d.terrain.shapes.push(...list);
  });
  select({ t: 'shape', i: shapes().length - 1 });
}
// the brush's outline under the mouse (and the stroke being drawn) for the cliff brush, through the view v (a preview)
function drawBrushCursor(v) {
  if (S.tool !== 'shape' || S.draw !== 'brush' || !S.mouseW) return;
  const c = v.project(S.mouseW);
  if (!c) return;
  const g = v.overlay, hs = Math.max(0.5, S.brush.size / 2);
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.5 * dpr;
  if (S.brush.shape === 'square') vsquare(v, S.mouseW, hs); else vring(v, S.mouseW, hs); // draped on the ground in 3-D
  g.stroke();
  if (S.stroke && S.stroke.pts.length > 1) {
    g.strokeStyle = (TYPE[newType()] || TYPE.open)[1];
    g.globalAlpha = v.drape ? 0.9 : 0.6; // 3-D: an outline; the live ground shows the stroke itself (relief.js)
    vband(v, S.stroke.pts, Math.max(1, S.brush.size));
  }
  g.restore();
}
ED.previews.push(drawBrushCursor);

// the hints of app.js's own tools (shown over the view while the tool is armed)
const TOOL_HINTS = {
  well: 'Click where the new well goes (team 1\'s half; team 2 gets the mirror). Esc ends.',
  camp: 'Click the map to place the camp. Esc cancels.', // camps.js names the type once the tool is armed
  ward: 'Click where the bots\' new ward spot goes (open ground both bases reach). Esc ends.',
};
function setTool(t) {
  S.tool = t;
  S.drawing = null;
  S.stroke = null;
  if (t === 'paint' || t === 'shape') S.lastMaterial = t;
  else if (t === 'stamp') S.lastMaterial = 'paint'; // a stamp is laid from Apply Texture
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  if (t === 'shape' || t === 'paint') updateHint();
  else if (ED.tools[t] && ED.tools[t].hint) $('toolHint').textContent = ED.tools[t].hint;
  else if (TOOL_HINTS[t]) $('toolHint').textContent = TOOL_HINTS[t];
  $('toolHint').style.display = t === 'shape' || TOOL_HINTS[t] || (ED.tools[t] && ED.tools[t].hint) ? '' : 'none';
  ED.emit('tool', t);
  render();
}
// updateHint: the draw mode's gesture, then what the material does
function updateHint() {
  const g = S.draw, size = S.brush.size;
  const how = g === 'brush' ? `Brush: drag to draw, click for a dab (${size} m; [ ] size)`
    : g === 'circle' ? 'Circle: press at the centre, drag out the radius'
      : g === 'polygon' ? 'Polygon: click the corners; double-click or Enter ends, Esc cancels'
        : `Path: click the points; double-click or Enter ends (${size} m wide: the brush size)`;
  const what = S.tool === 'paint' ? 'the chosen texture layer; X erases'
    : 'a ' + ((S.cliff === 'water' ? 'water' : S.cliff) || '') + ' shape; Open erases walls, Wall erases openings';
  $('toolHint').textContent = `${how}. Draws ${what}; team 2 gets the mirror. Esc ends.`;
}

// deleteSel removes the selection where the format allows it: the fixed set can only be moved, but a Binding's tier
// goes from every lane (three a lane to two).
function deleteSel() {
  const s = S.sel;
  if (!s) return;
  if (ED.sel[s.t] && ED.sel[s.t].del) return ED.sel[s.t].del(s);
  if (s.t === 'shape' || s.t === 'radius') { edit(d => d.terrain.shapes.splice(s.i, 1)); return select(null); }
  if (s.t === 'vertex') {
    const sh = shapes()[s.i], pts = sh.polygon || sh.path;
    if (pts.length <= (sh.polygon ? 3 : 2)) return log('too few corners left to delete one', 'err');
    edit(() => pts.splice(s.v, 1));
    return select({ t: 'shape', i: s.i });
  }
  if (s.t === 'knot') {
    if (lanes()[s.l].knots.length <= 2) return log('a lane keeps at least 2 knots', 'err');
    edit(() => deleteKnot(s.l, s.k));
    return select({ t: 'lane', l: s.l });
  }
  if (s.t === 'obj' && ['wells', 'camps', 'wards'].includes(s.path[0])) {
    edit(d => d[s.path[0]].splice(s.path[1], 1));
    select(null);
    if (s.path[0] === 'camps' && ED.camps) ED.camps.deleted();
    return;
  }
  if (bindingTier(s) >= 0) return deleteBindingTier(bindingTier(s)); // three a lane to two
  log('the fixed set (Locus, Guardian, shop, spawns, Cores) is moved, never deleted', 'err');
}

// ---- the inspector ----------------------------------------------------------------------------------------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, ...kids);
  return el;
}

// appendAll appends the children that are nodes or text, skipping null, undefined and booleans (an optional row's
// `cond ? h(...) : null` or `cond && h(...)`): the DOM's own append writes those as the text "null" or "false"
// (EDUXNULL). Every part appends a list with optional members through it (or through h).
function appendAll(el, ...kids) {
  el.append(...kids.filter(c => c != null && typeof c !== 'boolean'));
  return el;
}

// Under ?selftest the DOM's append, prepend, replaceChildren, before, after and replaceWith record a null, undefined or
// boolean they are given (it would show as text), and a self-test that passed turns failed with the call sites
// (EDUXNULL): a stray "null" anywhere the self-tests reach is a failure, not a picture someone has to notice.
if (new URLSearchParams(location.search).has('selftest')) {
  const stray = [];
  const watch = (proto, name) => {
    const f = proto[name];
    proto[name] = function (...kids) {
      if (kids.some(c => c == null || typeof c === 'boolean')) {
        const at = (new Error().stack || '').split('\n').slice(2, 4).map(s => s.trim()).join(' < ');
        if (stray.length < 20) stray.push(`${name}(${kids.map(c => c == null || typeof c === 'boolean' ? String(c) : '...').join(', ')}) ${at}`);
      }
      return f.apply(this, kids);
    };
  };
  for (const n of ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']) watch(Element.prototype, n);
  for (const n of ['append', 'prepend', 'replaceChildren']) watch(DocumentFragment.prototype, n);
  let told = 0;
  new MutationObserver(() => {
    const st = document.body.dataset.selftest;
    if (!st || told === stray.length) return;
    $('selftest').textContent += stray.slice(told).map(s => '\nFAIL a stray text: ' + s).join('');
    told = stray.length;
    if (st === 'passed') { document.title = 'selftest failed'; document.body.dataset.selftest = 'failed'; }
  }).observe(document.body, { attributes: true, attributeFilter: ['data-selftest'] });
}

function xyInputs(get, set) {
  const p = get() || [0, 0];
  const mk = i => h('input', { type: 'number', step: '0.1', value: p[i], onchange: ev => {
    const q = (get() || [0, 0]).slice();
    q[i] = +ev.target.value;
    edit(() => set(q));
  } });
  return h('div', { class: 'xy' }, 'x', mk(0), 'y', mk(1));
}

// pretty writes JSON with short arrays and objects on one line (the files' style).
function inline(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + inline(x)).join(', ') + '}';
}
function pretty(v, ind) {
  ind = ind || '';
  const one = inline(v);
  if (v === null || typeof v !== 'object' || one.length + ind.length <= 72) return one;
  const ind2 = ind + '  ';
  if (Array.isArray(v)) return '[\n' + v.map(x => ind2 + pretty(x, ind2)).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => ind2 + JSON.stringify(k) + ': ' + pretty(x, ind2)).join(',\n') + '\n' + ind + '}';
}

function jsonEditor(value, apply) {
  const ta = h('textarea', { rows: 6 });
  ta.value = pretty(value);
  const msg = h('span', { class: 'small' });
  const btn = h('button', { onclick: () => {
    let v;
    try { v = JSON.parse(ta.value); } catch (e) { msg.textContent = e.message; return; }
    edit(() => apply(v));
  } }, 'Apply JSON');
  return h('div', { class: 'jsoned' }, ta, h('div', { class: 'btns' }, btn, msg));
}

// adv marks controls for the selection's Advanced section (a closed details at the end of the selection's info:
// the JSON editors, the drawing order, a prop's tilt and footprint, a group's source, the scatter's settings)
function adv(...kids) { return h('div', { class: 'adv-item' }, ...kids); }
ED.adv = adv;

function renderInspector() {
  const el = $('inspector');
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  const wasOpen = !!el.querySelector('details.adv[open]');
  el.textContent = '';
  inspectorBody(el);
  // the simplified inspector: what is marked advanced (and every JSON editor) goes into the closed Advanced section
  const items = [...el.querySelectorAll(':scope > .adv-item, :scope > .jsoned, :scope > div > .jsoned')];
  if (items.length) {
    const d = h('details', { class: 'adv' }, h('summary', {}, 'Advanced'));
    if (wasOpen || S.advOpen) d.open = true;
    S.advOpen = false;
    items.forEach(it => d.append(it));
    el.append(d);
  }
  ED.emit('inspector', el);
}
// openAdvanced opens the selection's Advanced section (Advanced > Edit the Selection as JSON)
function openAdvanced() {
  const d = $('inspector').querySelector('details.adv');
  if (!d) return false;
  d.open = true;
  const ta = d.querySelector('textarea');
  if (ta) { ta.scrollIntoView({ block: 'nearest' }); ta.focus(); } else d.scrollIntoView({ block: 'nearest' });
  return true;
}
function inspectorBody(el) {
  if (!S.doc) { el.append(h('p', { class: 'hint' }, 'Open a map (File > Open Map, Ctrl+O).')); return; }
  const s = S.sel;
  if (!s || selValue(s) === undefined && s.t !== 'auto') return mapInspector(el);
  if (ED.sel[s.t] && ED.sel[s.t].inspector) return ED.sel[s.t].inspector(el, s);
  if (s.t === 'obj') {
    if (s.path[0] === 'camps' && ED.camps) return ED.camps.inspector(el, s);
    const o = objects().find(o => o.path && pathStr(o.path) === pathStr(s.path));
    el.append(h('div', { class: 'path' }, pathStr(s.path)), h('div', {}, o ? o.name : ''),
      xyInputs(() => getAt(S.doc, s.path), q => setPoint(s.path, q)));
    const p = getAt(S.doc, s.path);
    el.append(h('p', { class: 'small' }, `team 2's mirror at (${-p[0]}, ${-p[1]})`));
    const parentPath = s.path.slice(0, -1);
    if (s.path[0] === 'wells') { // the kind: SM's well (18 worker spots) or MM's mine (36)
      const w = getAt(S.doc, parentPath);
      el.append(h('label', {}, 'kind ', h('select', { onchange: ev => edit(() => { if (ev.target.value === 'mine') w.kind = 'mine'; else delete w.kind; }) },
        h('option', { value: 'well', selected: w.kind !== 'mine' }, 'well (18 workers)'),
        h('option', { value: 'mine', selected: w.kind === 'mine' }, 'mine (36 workers)'))));
    }
    if (['wells', 'camps', 'wards'].includes(s.path[0])) {
      if (s.path[0] !== 'wards') el.append(joinedNote(s));
      el.append(h('div', { class: 'btns' }, h('button', { onclick: deleteSel }, 'Delete')),
        jsonEditor(getAt(S.doc, parentPath), v => setAt(S.doc, parentPath, v)));
    }
    if (s.path[1] === 'cores' || s.path[1] === 'bindings') {
      el.append(h('div', { class: 'btns' }, h('button', { onclick: () => { edit(d => { d.base[s.path[1]] = 'auto'; }); select(null); } },
        'Back to "auto" (all ' + s.path[1] + ')')));
    }
    if (bindingTier(s) >= 0) el.append(bindingCountInfo(s));
    return;
  }
  if (s.t === 'auto') {
    el.append(h('div', { class: 'path' }, 'base.' + s.which + ' = "auto"'),
      h('p', {}, 'Placed by the compiler from the lanes and the Guardian. Drag one to place them all by hand (they become explicit points).'));
    if (bindingTier(s) >= 0) el.append(bindingCountInfo(s));
    return;
  }
  if (s.t === 'knot' || s.t === 'lane' || s.t === 'lwidth') {
    const l = lanes()[s.l];
    el.append(h('div', { class: 'path' }, s.t === 'knot' ? `lanes[${s.l}].knots[${s.k}]` : s.t === 'lwidth' ? `lanes[*].width` : `lanes[${s.l}]`),
      h('div', {}, `lane ${l.id} (${{ 1: 'Top', 2: 'Bottom' }[l.id] || '?'}), ${l.knots.length} knots, team 1's direction from its base`));
    if (s.t === 'knot') {
      el.append(xyInputs(() => l.knots[s.k], q => setPoint(['lanes', s.l, 'knots', s.k], q)),
        h('p', { class: 'small' }, partnerKnot(s.l, s.k) ? 'The other lane\'s matching knot follows (point symmetry).' : 'No partner knot (the lanes have different knot counts).'),
        joinedNote(s),
        h('div', { class: 'btns' },
          h('button', { onclick: () => { edit(() => insertKnot(s.l, s.k)); select({ t: 'knot', l: s.l, k: s.k + 1 }); } }, 'Insert knot after'),
          h('button', { onclick: deleteSel }, 'Delete knot')));
    }
    el.append(h('label', {}, 'width (m, both lanes) ', h('input', { type: 'number', step: '1', value: l.width, onchange: ev => {
      setLaneWidth(+ev.target.value, ev.target);
    } })));
    return;
  }
  const i = s.i, sh = shapes()[i];
  el.append(h('div', { class: 'path' }, `terrain.shapes[${i}]`));
  if (s.t === 'vertex') el.append(h('div', {}, `corner ${s.v}`), xyInputs(() => (sh.polygon || sh.path)[s.v], q => { (sh.polygon || sh.path)[s.v] = q; }));
  const typeSel = h('select', { onchange: ev => edit(() => {
    sh.type = ev.target.value;
    HT.fitType(sh);
    if (sh.type === 'bush' && Array.isArray(sh.path) && sh.lane === undefined) { // a band made a bush: its outline
      const b = asBush(sh);
      if (b !== sh) { delete sh.path; delete sh.width; sh.polygon = b.polygon; }
    }
  }) },
    ...['open', 'wall', 'chasm', 'island', 'bush'].map(t => h('option', { value: t, selected: sh.type === t }, t)));
  el.append(h('label', {}, 'type ', typeSel));
  if (sh.r !== undefined) el.append(h('label', {}, 'radius (m) ', h('input', { type: 'number', step: '0.5', value: sh.r, onchange: ev => edit(() => { sh.r = +ev.target.value; }) })));
  if (sh.width !== undefined) el.append(h('label', {}, 'width (m) ', h('input', { type: 'number', step: '0.5', value: sh.width, onchange: ev => edit(() => { sh.width = +ev.target.value; }) })));
  if (sh.type === 'chasm') { // water in the chasm's dip: true, or {"z": m, "mask": name} from the JSON below
    el.append(h('label', { title: 'A water plane at z -2 m (or the JSON\'s "z"), sized to the chasm by the compiler' },
      h('input', { type: 'checkbox', checked: !!sh.water, onchange: ev => edit(() => { if (ev.target.checked) sh.water = true; else delete sh.water; }) }), ' water'));
  }
  if (sh.lane === undefined) { const hf = HT.field(sh, i); if (hf) el.append(hf); } // a wall's height, a chasm's depth (heights.js, EDUX9)
  const move = dlt => () => {
    const j = i + dlt;
    if (j < 0 || j >= shapes().length) return;
    edit(d => { const a = d.terrain.shapes; [a[i], a[j]] = [a[j], a[i]]; });
    select({ t: 'shape', i: j });
  };
  el.append(h('div', { class: 'btns' }, h('button', { onclick: deleteSel }, 'Delete')),
    h('p', { class: 'small' }, 'Team 2 gets its mirror. Double-click an edge to add a corner.'),
    adv(h('div', { class: 'btns' }, 'drawing order ', h('button', { onclick: move(-1), title: 'Drawn earlier (under)' }, 'Up'),
      h('button', { onclick: move(1), title: 'Drawn later (over)' }, 'Down')),
    h('p', { class: 'small' }, 'Shapes are drawn in order over the ground everywhere else (Map > Options); a later one wins where they overlap.')),
    jsonEditor(sh, v => { S.doc.terrain.shapes[i] = v; }));
}

// bindingCountInfo: a selected Binding's Delete (its tier off every lane, three to two) and the count it belongs to
function bindingCountInfo(sel) {
  const n = bindingCount(), t = bindingTier(sel);
  return h('div', { 'data-binding-count': n },
    n === 3 ? h('div', { class: 'btns' }, h('button', { title: 'Takes this tier off every lane (team 2\'s with it); the other two become Middle and Inner',
      onclick: () => deleteBindingTier(t) }, 'Delete (every lane)')) : null,
    h('p', { class: 'small' }, n === 3
      ? 'Three Bindings a lane (Outer, Middle, Inner). Delete takes this one\'s tier off every lane, leaving two (Middle, Inner).'
      : 'Two Bindings a lane (Middle, Inner, as MM_Map_v3). Lanes > Bindings: Three adds a Middle one halfway between them.'));
}

// joinedNote says what a drag of the knot, well or camp takes along (outlined on the map)
function joinedNote(sel) {
  if (!S.joined) return h('p', { class: 'small' }, 'A drag moves only this point (Tools > Drag Joined Shapes Along takes the shapes joined to it).');
  const js = joinedTo(sel), whole = js.filter(m => m.whole).length;
  return h('p', { class: 'small' }, js.length ? `A drag takes ${whole} shape${whole === 1 ? '' : 's'} and ${js.length - whole} path end${js.length - whole === 1 ? '' : 's'} or corner${js.length - whole === 1 ? '' : 's'} along (outlined; Tools > Drag Joined Shapes Along).` : 'Nothing is joined to it: a drag moves only this point.');
}

// mapInspector: with nothing selected, the selection info shows the map's facts; its fields are in the Map menu's
// windows (Properties, Options) and the whole document in Advanced > Edit the Map as JSON
function mapInspector(el) {
  const d = S.doc, st = S.report && S.report.stats, n = k => Array.isArray(d[k]) ? d[k].length : 0;
  const link = (t, fn) => h('a', { class: 'lnk', onclick: fn }, t);
  el.append(h('dl', {},
    h('dt', {}, 'map'), h('dd', {}, S.pkg),
    h('dt', {}, 'display name'), h('dd', {}, String(d.display || '')),
    h('dt', {}, 'size'), h('dd', {}, (d.size || 400) + ' m, ground everywhere else ' + ((d.terrain && d.terrain.default) || 'wall')),
    h('dt', {}, 'terrain'), h('dd', {}, shapes().length + ' shapes'),
    h('dt', {}, 'doodads'), h('dd', {}, n('props') + ' props, ' + n('scatter') + ' scatter regions'),
    h('dt', {}, 'units'), h('dd', {}, n('wells') + ' wells, ' + n('camps') + ' camps, ' + n('wards') + ' ward spots'),
    h('dt', {}, 'lanes'), h('dd', {}, lanes().length + (st && st.laneLengths ? ': ' + st.laneLengths.join(' / ') + ' m' : '')),
    st ? h('dt', {}, 'graphs') : null, st ? h('dd', {}, `${st.playerAreas} (Player) / ${st.npcAreas} (NPC) areas`) : null,
    st ? h('dt', {}, 'paths') : null, st ? h('dd', { title: "How wide open ground must be for the graphs' squares: narrower ground is left out of them, and nobody walks it in game" }, graphWidths(st)) : null,
    h('dt', {}, 'check'), h('dd', {}, link($('checkState').textContent, () => ED.openWindow('check')))));
  el.append(h('p', { class: 'small', 'data-units-pointer': '' }, 'Camps, wells and ward spots: ', link('the Units tab', () => ED.act('map.addCamp')), '.'));
  const bs = S.report ? botsSummary() : null;
  if (bs && bs.text) el.append(h('p', { class: 'small' + (bs.uneven ? ' warn' : '') }, bs.text));
  el.append(h('p', { class: 'small' }, 'Map > ', link('Properties...', () => ED.act('map.properties')), ', ', link('Options...', () => ED.act('map.options')),
    '. Click something in the view, or pick it in a palette tab, to edit it.'),
  jsonEditor(d, v => { S.doc = v; }));
}

// the Map menu's Properties and Options windows and Advanced > Edit the Map as JSON (frame.js opens them)
function renderMapWindows() {
  const d = S.doc;
  const wp = ED.window('props', 'Map Properties'), wo = ED.window('options', 'Map Options'), wj = ED.window('mapjson', 'The Map as JSON');
  for (const w of [wp, wo, wj]) {
    if (w.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) continue;
    w.textContent = '';
    if (!d) w.append(h('p', { class: 'hint' }, 'Open a map.'));
  }
  if (!d) return;
  const field = (label, get, set, type) => h('label', {}, label + ' ', h('input', {
    type: type || 'text', value: get() ?? '', onchange: ev => edit(() => set(type === 'number' ? +ev.target.value : ev.target.value)),
  }));
  if (!wp.firstChild) {
    wp.append(h('div', { class: 'path' }, S.pkg + '/map.json'));
    for (const [k, v] of Object.entries(d)) { // every top-level scalar, the unknown ones too
      if (v === null || typeof v === 'object') continue;
      wp.append(field(k, () => d[k], x => { d[k] = x; }, typeof v === 'number' ? 'number' : 'text'));
    }
    wp.append(h('p', { class: 'small' }, 'name: the Level\'s and the folder\'s; display: the name the game shows (1-13 characters); tag: the custom game\'s ~#tag; prefix: its names\' prefix.'));
  }
  if (!wo.firstChild) {
    if (d.terrain && typeof d.terrain === 'object') {
      wo.append(h('label', { title: 'The ground where no shape lies' }, 'the ground everywhere else (terrain.default) ', h('select', { onchange: ev => edit(() => { d.terrain.default = ev.target.value; }) },
        ...['wall', 'open', 'chasm'].map(t => h('option', { value: t, selected: d.terrain.default === t }, t)))));
    }
    wo.append(h('p', { class: 'small' }, 'Shapes (Terrain > Apply Cliff) are drawn over it.'));
  }
  if (!wj.firstChild) wj.append(jsonEditor(d, v => { S.doc = v; }), h('p', { class: 'small' }, 'The whole map.json; Apply JSON is one undo step.'));
}
ED.on('doc', () => { if (ED.isOpen('props') || ED.isOpen('options') || ED.isOpen('mapjson')) renderMapWindows(); });
ED.on('open', renderMapWindows);
ED.on('window', (id, on) => { if (on && ['props', 'options', 'mapjson'].includes(id)) renderMapWindows(); });

// ---- checks -----------------------------------------------------------------------------------------------

// the Map Check window (Map > Check..., the status bar's last part, the toolbar's check badge): the findings, the
// graphs' stats and the bots' line
ED.window('check', 'Map Check').append(h('div', { class: 'small', id: 'checkSummary' }), h('div', { id: 'findings' }),
  h('div', { id: 'stats', class: 'small' }), h('div', { id: 'botsInfo', class: 'small' }));

function scheduleCheck() {
  clearTimeout(S.checkTimer);
  S.checkTimer = setTimeout(runCheck, 120);
}
async function runCheck() {
  if (!S.pkg) return;
  const seq = ++S.checkSeq, pkg = S.pkg;
  setBadge('checking...', 'busy');
  let res;
  const sent = snapshot();
  try { res = await api('POST', '/api/check/' + pkg, sent); } catch (e) { res = { error: String(e) }; }
  if (seq !== S.checkSeq || pkg !== S.pkg) return; // a newer edit is being checked
  if (res.placed !== undefined) { // what the props place (mapc props), and the entries it was placed from
    const d = JSON.parse(sent);
    S.placed = res.placed;
    S.placedFrom = { props: Array.isArray(d.props) ? d.props : [], scatter: Array.isArray(d.scatter) ? d.scatter : [] };
  }
  if (res.error && !res.report) {
    setBadge('check failed', 'fail');
    log('check: ' + res.error, 'err');
    S.report = { ok: false, findings: [{ rule: 'editor', severity: 'error', message: String(res.error) }] };
  } else {
    S.report = res.report;
  }
  S.rev = res.rev || S.rev;
  S.checkedJSON = sent; // the draft the 3-D ground and the bake are made from next (the live preview's base: relief.js)
  if (res.preview) {
    S.previewJSON = sent; // what layout.png shows
    S.preview = res.preview;
    S.images = res.images;
    renderLayers();
    loadBg();
  }
  S.stale = !res.preview;
  renderFindings();
  render();
  ED.emit('preview', S.preview, S.report);
  ED.emit('checked', S.report);
}
function setBadge(text, cls) {
  const b = $('checkState');
  b.textContent = text;
  b.className = 'badge ' + (cls || '');
  ED.emit('badge', text, cls); // the status bar's last part (frame.js)
}

function renderFindings() {
  const el = $('findings'), r = S.report;
  el.textContent = '';
  if (!r) return;
  const fs = (r.findings || []).slice().sort((a, b) => (a.severity === 'warning') - (b.severity === 'warning'));
  const errs = fs.filter(f => f.severity !== 'warning').length, warns = fs.length - errs;
  setBadge(r.ok ? (warns ? `passes, ${warns} warning${warns > 1 ? 's' : ''}` : 'passes') : `fails: ${errs} error${errs !== 1 ? 's' : ''}`, r.ok ? 'ok' : 'fail');
  $('checkSummary').textContent = S.stale ? '(layers from the last passing check)' : '';
  if (!fs.length) el.append(h('div', { class: 'none' }, 'No findings.'));
  for (const f of fs) {
    const where = (f.path || '') + (f.at ? ` at (${f.at[0].toFixed(1)}, ${f.at[1].toFixed(1)})` : '');
    const row = h('div', { class: 'f ' + (f.severity || ''), 'data-rule': f.rule, 'data-path': f.path || '',
      onmouseenter: () => { S.hoverFinding = f; render(); }, onmouseleave: () => { S.hoverFinding = null; render(); },
      onclick: () => {
        if (Array.isArray(f.parts) && f.parts.length) return selectPart(f, 'next'); // reach.dropped, reach.narrow: part by part
        if (f.shape && f.at) { // reach.npc, lanes.graph on ground too narrow (EDNARROW): the shape to widen, at the object
          selectPath(f.shape);
          if (typeof FR !== 'undefined') FR.centre(f.at); else { S.view.x = f.at[0]; S.view.y = f.at[1]; S.fitted = false; render(); }
          return;
        }
        if (ED.jumpFinding && ED.jumpFinding(f)) return; // feedback.js: select it and show it in the view shown
        if (f.path) selectPath(f.path);
        if (f.at) { if (typeof FR !== 'undefined') FR.centre(f.at); else { S.view.x = f.at[0]; S.view.y = f.at[1]; S.fitted = false; render(); } } // either view
      } },
    h('div', { class: 'rule' }, (f.severity === 'warning' ? 'warning ' : 'error ') + f.rule), where ? h('div', { class: 'where' }, where) : null,
    h('div', {}, f.message || ''),
    Array.isArray(f.parts) && f.parts.length > 1 ? h('div', { class: 'small' }, `${f.parts.length} parts: click again for the next`) : null,
    f.shape ? h('div', { class: 'small' }, `click: selects ${f.shape}, to widen it`) : null);
    el.append(row);
  }
  const st = r.stats;
  $('stats').textContent = st ? `graphs ${st.playerAreas} (Player) / ${st.npcAreas} (NPC) areas of ${st.cell} cells (paths ${graphWidths(st)}), lanes ${(st.laneLengths || []).join(' / ')} m, ${st.bushes} bushes, ${st.wells} wells` : '';
  const bs = botsSummary();
  $('botsInfo').textContent = bs.text;
  $('botsInfo').classList.toggle('warn', bs.uneven);
}

// graphWidths: how wide open ground must be for the graphs' squares, from the check's stats (EDNARROW; before it,
// feedback.js computes them from the square size)
function graphWidths(st) {
  const [a, b] = Array.isArray(st.pathWidth) ? st.pathWidth : ED.pathWidths ? ED.pathWidths() : [0, 0];
  const sq = (st.cell * (st.cellSize || 0)).toFixed(1);
  return a ? `from ${a} m across, ${b} m at an angle (${sq}-m squares)` : `${sq}-m squares`;
}

// selectPart selects a part of a finding with parts (reach.dropped's cut-off ground, reach.narrow's thin ground; the
// next one on each call) and centres it, zoomed in far enough to see it
function selectPart(f, k) {
  const n = f.parts.length;
  if (k === 'next') k = S.sel && S.sel.t === 'part' && partRule(S.sel) === f.rule ? (S.sel.k + 1) % n : 0;
  const p = f.parts[k];
  select({ t: 'part', k, rule: f.rule });
  S.view.x = p.centre[0];
  S.view.y = p.centre[1];
  S.view.scale = Math.max(S.view.scale, Math.min(cv.width, cv.height) / Math.max(60, 4 * p.r));
  S.fitted = false;
  render();
}
const partRule = sel => sel.rule || 'reach.dropped';
function partFinding(sel) { return S.report && (S.report.findings || []).find(f => f.rule === partRule(sel) && Array.isArray(f.parts)); }
// what a part is and what to do (EDNARROW: the widths from the check, no longer "about 4 m")
function partHelp(rule) {
  const st = (S.report && S.report.stats) || {}, w = st.cell ? graphWidths(st) : 'about twice the square size';
  if (rule === 'reach.narrow') return `Walkable ground too narrow for the graphs' squares: they leave it out, so nobody walks it in game. Open ground holds them ${w}: widen it, or close it with a wall shape. Team 2's mirror is the same ground (the squares may fit it a little differently).`;
  return `Walkable ground the graphs leave out: nothing joins it to the bases that the graphs can hold (open ground holds their squares ${w}). Open or widen a path to it, or close it with a wall shape. Team 2's mirror has the same.`;
}
ED.sel.part = {
  value: sel => { const f = partFinding(sel); return f ? f.parts[sel.k] : undefined; },
  inspector: (el, sel) => {
    const f = partFinding(sel), p = f.parts[sel.k], cs = (S.preview && S.preview.size || +S.doc.size || 400) / (S.preview && S.preview.grid || 512);
    el.append(h('div', { class: 'path' }, `${f.rule}: part ${sel.k + 1} of ${f.parts.length}`),
      h('div', {}, `${p.cells} cells (${Math.round(p.cells * cs * cs)} m²) round (${p.centre[0]}, ${p.centre[1]}), about ${p.r} m across from its centre`),
      h('p', { class: 'small' }, partHelp(f.rule)),
      h('div', { class: 'btns' }, f.parts.length > 1 ? h('button', { onclick: () => selectPart(f, 'next') }, 'Next part') : null));
  },
  move: () => {},
  del: () => log('a cut-off part is the check\'s finding: change the shapes round it', 'err'),
};

// ---- layers -----------------------------------------------------------------------------------------------

// the check's pictures under the 2-D view: View > Background Layer (S.preview.files; '' none) and its opacity;
// View > Pathing (P) is the Player graph's picture; the overlays are View's Show items (S.show)
function renderLayers() { ED.emit('layers', S.preview && S.preview.files); }
function setBg(file) {
  S.bg = file || '';
  loadBg();
  render();
}
function loadBg() {
  if (!S.bg || !S.images) { S.img = null; return; }
  if (S.imgFile === S.bg && S.imgRev === S.rev) return;
  const img = new Image(), file = S.bg, rev = S.rev;
  img.onload = () => { if (file === S.bg) { S.img = img; S.imgFile = file; S.imgRev = rev; render(); } };
  img.src = S.images + file;
}
function toggleShow(k) { S.show[k] = !S.show[k]; render(); ED.emit('show', k); }

// ---- views: the main view is 2-D or 3-D (the toolbar's switch, View, Tab) --------------------------------------

function renderTabs() {
  const nav = $('viewSeg');
  nav.textContent = '';
  for (const v of Object.values(ED.views)) {
    nav.append(h('button', { class: ED.view === v.id ? 'on' : '', 'data-view': v.id,
      title: (v.id === '2d' ? 'The 2-D view, from above' : 'The ' + v.title + ' view') + ' (Tab switches)', onclick: () => ED.setView(v.id) }, v.title));
  }
}

// ---- files: open, save, new, build ------------------------------------------------------------------------

async function loadState() {
  S.config = await api('GET', '/api/state');
  if (S.config.test && !S.config.test.enabled && !S.testNoted) { S.testNoted = true; log('Test is off: ' + S.config.test.reason); }
  if (!S.test) pollTest(true); // a Test started before the page was (re)loaded
  if (S.config.pageError) log(S.config.pageError, 'err'); // the backend serves an error page instead; a page kept open
  updateDirty();
}

async function openMap(pkg) {
  if (S.doc && updateDirty() && !confirm('Discard the unsaved changes to ' + S.pkg + '?')) return;
  const res = await api('GET', '/api/map/' + pkg);
  if (res.error) { log(res.error, 'err'); return; }
  let doc;
  try { doc = JSON.parse(res.text); } catch (e) { log(pkg + '/map.json does not parse: ' + e.message, 'err'); return; }
  if (res.delivered) log(res.delivered.why);
  Object.assign(S, { pkg, doc, base: res.sha256, savedJSON: JSON.stringify(doc), undo: [], redo: [], sel: null,
    delivered: res.delivered || null,
    report: null, preview: null, images: null, img: null, imgFile: '', drawing: null, placed: null, placedFrom: null });
  history.replaceState(null, '', '?open=' + encodeURIComponent(pkg) + (location.search.includes('selftest') ? '&selftest=' + new URLSearchParams(location.search).get('selftest') : ''));
  fit();
  changed(true);
  ED.emit('open', pkg);
  await runCheck();
}

async function save(force) {
  if (!S.doc) return;
  if (S.delivered) { log(S.delivered.why, 'err'); return; }
  const res = await api('POST', `/api/save/${S.pkg}?base=${S.base}${force ? '&force=1' : ''}`, snapshot());
  if (res._status === 409) {
    if (confirm(res.error + '. Overwrite it?')) return save(true);
    return;
  }
  if (!res.ok) { log('save: ' + res.error, 'err'); return; }
  S.base = res.sha256;
  S.savedJSON = snapshot();
  updateDirty();
  log(res.written ? `saved ${S.pkg}/map.json (sha256 ${res.sha256.slice(0, 12)})` : `${S.pkg}/map.json unchanged, not written`, 'ok');
  ED.emit('saved', S.pkg);
  return res;
}

// build: File > Build; noMesh (Advanced > Build without the PhysX Mesh) leaves the cooked mesh out
async function build(noMesh) {
  if (!S.doc) return;
  if (updateDirty() && !S.delivered) { if (!confirm('Build reads the saved package. Save first?')) return; await save(); }
  log(`building ${S.pkg}...`);
  const res = await api('POST', `/api/build/${S.pkg}?mesh=${noMesh === true ? 0 : 1}`);
  const r = res.result;
  if (res.exit === 0 && r && r.ok) log(`built ${r.archive}: ${r.bytes} bytes, sha256 ${r.sha256.slice(0, 16)}${r.mesh ? '' : ' (no mesh)'}`, 'ok');
  else log('build: ' + ((r && r.error) || res.error || 'failed'), 'err');
}

// Test: a practice match on the saved map, in the game of the Start-Client that serves the page (Start-Client.exe
// --editor): mapc check of the saved package, the running game closed, This PC's server stopped (it starts again at
// the login with this map), the game copy set up again, the game started with This PC preselected. Each Test starts
// the game again on the saved version (the game reads its maps only at its start); Stop closes the game. The log
// follows the phases and the Test's own lines (GET /api/test: test, tail).
const TEST_PHASES = { check: 'checking the saved map', closing: 'closing the game', server: "stopping This PC's server",
  setup: 'setting up the game copy', starting: 'starting the game', playing: 'the game runs', done: 'over' };
async function testMap() {
  if (!S.doc || !S.pkg) return;
  if (updateDirty()) { if (!confirm('Test plays the saved map. Save first?')) return; if (!(await save())) return; }
  const again = S.test && S.test.running;
  const res = await api('POST', '/api/test/' + S.pkg);
  if (!res.ok) { log('test: ' + res.error, 'err'); return; }
  S.test = res.test;
  S.testSeen = '';
  S.testLines = 0;
  log(`test ${res.test.name}: ${again ? 'the game closes and starts again on the saved version' : 'the game starts in a moment'};` +
    ' log in on This PC with any name, then PLAY, PRACTICE DAWNGATE', 'ok');
  updateTestButton();
  if (!S.testPolling) pollTest();
}
async function stopTest() {
  const force = S.test && S.test.stopped && confirm('The game is still closing. End it at once?');
  const res = await api('POST', '/api/test-stop' + (force ? '?force=1' : ''));
  log(res.ok ? 'test: stopping (the game closes)' : 'stop: ' + res.error, res.ok ? '' : 'err');
}
async function pollTest(quiet) {
  S.testPolling = true;
  let res;
  try { res = await api('GET', '/api/test'); } catch (e) { res = {}; }
  const t = res && res.test;
  if (!t) { S.testPolling = false; return; }
  if (quiet && !t.running) { S.test = t; S.testPolling = false; updateTestButton(); return; } // an earlier Test's result
  if (!S.test || S.test.name !== t.name) { S.testSeen = ''; S.testLines = 0; }
  S.test = t;
  // the Test's own lines since the last poll (the backend keeps its last ones)
  const tail = res.tail || [];
  if (tail.length < (S.testLines || 0)) S.testLines = 0;
  for (const l of tail.slice(S.testLines || 0)) log(`  ${l}`, /FAILED/.test(l) ? 'err' : '');
  S.testLines = tail.length;
  const line = (TEST_PHASES[t.phase] || t.phase) + (t.stopped && t.running ? ' (stopping)' : '');
  if (line !== S.testSeen) { S.testSeen = line; log(`test ${t.name}: ${line}`); }
  updateTestButton();
  if (t.running) { setTimeout(pollTest, 1500); return; }
  S.testPolling = false;
  if (t.error) log(`test ${t.name}: ${t.error}`, 'err');
  else log(`test ${t.name}: over${t.stopped ? ' (stopped)' : ''}`, 'ok');
}
function updateTestButton() {
  const b = $('btnTest'), stop = $('btnTestStop'), state = $('testState');
  const on = S.config && S.config.test && S.config.test.enabled, run = S.test && S.test.running;
  const starting = run && S.test.phase !== 'playing'; // one Test at a time until its game runs
  b.innerHTML = '<i class="ic">&#x25B6;</i>' + (run && !starting ? 'Test Again' : 'Test Map');
  b.disabled = !S.doc || !on || starting;
  b.title = !on ? (S.config && S.config.test && S.config.test.reason) || ''
    : starting ? 'A Test is starting: wait until the game runs, or press Stop'
      : run ? 'Save, then close the game and start it again on the saved version'
        : 'Test Map (Ctrl+F9): save, then play this map in the game: log in on This PC, then PLAY, PRACTICE DAWNGATE';
  stop.classList.toggle('hidden', !run);
  state.classList.toggle('hidden', !S.test);
  if (S.test) {
    state.textContent = 'test: ' + (TEST_PHASES[S.test.phase] || S.test.phase);
    state.className = 'badge' + (run ? ' busy' : S.test.error ? ' fail' : ' ok');
  }
}

// New from template: the page's templates (source "templates") and the maps folder's packages ("maps"); the
// option's value is "<source>:<pkg>". Save as my own copy (own) is the same dialog on the open delivered package:
// the copy is made from it, then the page's document, edits and all, is saved into the copy under the new names.
function newDialog(own) {
  const sel = $('newTemplate');
  sel.textContent = '';
  const groups = [['templates', 'Templates', (S.config && S.config.templates) || []], ['maps', 'Your maps folder', (S.config && S.config.maps) || []]];
  for (const [src, title, list] of groups) {
    if (!list.length) continue;
    const g = h('optgroup', { label: title });
    for (const m of list) g.append(h('option', { value: src + ':' + m.pkg, selected: src === 'maps' && m.pkg === S.pkg }, m.pkg + (m.display ? ' - ' + m.display : '')));
    sel.append(g);
  }
  sel.disabled = !!own;
  $('dlgNew').dataset.own = own ? '1' : '';
  $('dlgNew').querySelector('h2').textContent = own ? 'Save ' + S.pkg + ' as my own copy' : 'New map from a template';
  $('dlgNew').showModal();
}
$('dlgNew').addEventListener('close', async () => {
  if ($('dlgNew').returnValue !== 'ok') return;
  const own = $('dlgNew').dataset.own === '1' && S.doc && S.delivered;
  const f = new FormData($('formNew'));
  const [source, template] = own ? ['maps', S.pkg] : String($('newTemplate').value).split(/:(.*)/s);
  const q = { template, source, name: f.get('name'), display: f.get('display'), tag: f.get('tag'), prefix: f.get('prefix'), keepAdded: !!own };
  const res = await api('POST', '/api/new', q);
  if (!res.ok) { log('new: ' + res.error, 'err'); return; }
  log(`made ${res.pkg} from ${q.template}`, 'ok');
  if (own) {
    const copy = await api('GET', '/api/map/' + res.pkg);
    const doc = JSON.parse(snapshot());
    try {
      const names = JSON.parse(copy.text);
      for (const k of ['name', 'display', 'tag', 'prefix']) if (k in names) doc[k] = names[k];
    } catch (e) { log('the copy: ' + e.message, 'err'); return; }
    const sv = await api('POST', `/api/save/${res.pkg}?base=${copy.sha256}`, JSON.stringify(doc));
    if (!sv.ok) { log('saving the copy: ' + sv.error, 'err'); return; }
    log(`saved your edits into ${res.pkg}`, 'ok');
    S.doc = null; // nothing unsaved is lost: openMap asks no question
  }
  await loadState();
  await openMap(res.pkg);
});

// ---- keys and buttons -------------------------------------------------------------------------------------

// viewFocused: the view's own keys (the arrows, F) apply. The 2-D view: always (but typing); another view (3-D) only
// with the focus in it (a click there) or on nothing, so the keys of a focused list or button stay theirs
function viewFocused() {
  if (ED.view === '2d') return true;
  const ae = document.activeElement, v = ED.active();
  return !ae || ae === document.body || (!!v.el && v.el.contains(ae));
}

window.addEventListener('keydown', e => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (ED.keys && ED.keys(e)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (e.key === 'Escape') { if (S.grab) { S.grab = null; render(); } else if (S.drawing) { S.drawing = null; render(); } else if (S.tool !== 'select') setTool('select'); else select(null); }
  else if (e.key === 'Enter') drawFinish();
  else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (ED.view === '2d') fit(); else if (viewFocused()) ED.act('view.frameSel'); }
});
window.addEventListener('beforeunload', e => { if (S.doc && updateDirty()) { e.preventDefault(); e.returnValue = ''; } });
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnSave').onclick = () => save();
$('btnTest').onclick = testMap;
$('btnTestStop').onclick = stopTest;
$('btnNew').onclick = () => newDialog(false);
document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });

// ---- the self-test (?selftest=1, or =save to save too): scripted edits through the same functions ------------

async function selftest(mode) {
  const out = $('selftest'), lines = [];
  out.classList.remove('hidden');
  const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
  const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
  const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || ''));
  let ok = true;
  ok &= say(S.report && S.report.ok, 'opened ' + S.pkg + ': ' + (S.report && S.report.ok ? 'passes' : rules().join(' ')));
  // a Binding moved: "auto" becomes explicit
  const b = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 0);
  ok &= say(!!b, 'found lane 1 Outer Binding');
  if (b) {
    const start = b.pos, sel = objSel(b);
    S.drag = { sel, start, moved: false };
    if (sel.t === 'auto') { pushUndo(); materialize('cores' === sel.which ? 'cores' : 'bindings'); S.drag.sel = autoToPath(sel); S.drag.undone = true; }
    S.drag.orig = selValue(S.drag.sel).slice();
    moveSel(S.drag, [start[0] + 2, start[1] - 3], null);
    S.drag = null;
    changed(true);
    await settle();
    const nb = getAt(S.doc, ['base', 'bindings', '1', 0]);
    ok &= say(Array.isArray(nb) && Math.abs(nb[0] - start[0] - 2) < 0.11, 'Binding moved to ' + JSON.stringify(nb) + '; check ' + (S.report.ok ? 'passes' : rules().join(' ')));
  }
  // a bush added beside lane 1, a wall pillar added in the base, then moved
  addShape({ type: 'bush', circle: [-165, -70], r: 4 });
  addShape({ type: 'wall', circle: [-130, -120], r: 3 });
  const wi = shapes().length - 1;
  S.drag = { sel: { t: 'shape', i: wi }, start: [-130, -120], moved: true, orig: JSON.parse(JSON.stringify(shapes()[wi])) };
  moveSel(S.drag, [-128, -118], null);
  S.drag = null;
  changed(true);
  await settle();
  ok &= say(S.report.ok, 'bush and wall added, wall moved to ' + JSON.stringify(shapes()[wi].circle) + '; check ' + (S.report.ok ? 'passes' : rules().join(' ')));
  // a broken edit: a spawn point into the wall
  edit(() => setPoint(['base', 'spawns', 0], [-100, -20]));
  await settle();
  const row = document.querySelector('#findings .f[data-rule="fixed.open"][data-path="base.spawns[0]"]');
  ok &= say(!S.report.ok && !!row, 'broken edit shows ' + rules().join(' '));
  if (row) row.click();
  ok &= say(S.sel && S.sel.t === 'obj' && pathStr(S.sel.path) === 'base.spawns[0]', 'clicking the finding selects base.spawns[0]');
  undo();
  await settle();
  ok &= say(S.report.ok, 'undo: passes again');
  if (mode === 'save') {
    const r = await save();
    ok &= say(r && r.written, 'saved: ' + (r && r.sha256));
    const again = await save();
    ok &= say(again && !again.written, 'saved again unchanged: not written');
  }
  say(ok, ok ? 'selftest passed' : 'selftest failed');
  document.title = ok ? 'selftest passed' : 'selftest failed';
  document.body.dataset.selftest = ok ? 'passed' : 'failed';
}

// ---- EDUX2's self-test (?selftest=views): the views' contract and the one input pipeline, unit-style; nothing edited
ED.selftests = ED.selftests || {};
ED.selftests.views = async function selftestViews() {
  const out = $('selftest'), lines = [];
  out.classList.remove('hidden');
  const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
  const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
  let ok = true;
  ok &= say(await until(() => S.doc && S.preview && objects().length, 20000), `a map open with its objects (${S.pkg})`);
  ED.setView('2d');
  setTool('select');
  const V2 = ED.views['2d'], V3 = ED.views['3d'], fns = ['pick', 'pickAt', 'project', 'ppm'];
  ok &= say(V2 === VIEW2D && fns.every(k => typeof V2[k] === 'function') && V2.overlay === ctx && V2.el === $('view2d'),
    'the 2-D view registers the contract: el, pick, pickAt, project, ppm and its canvas as the overlay');
  ok &= say(V3 && fns.every(k => typeof V3[k] === 'function') && V3.overlay && V3.overlay.canvas && V3.drape && V3.pick({ clientX: 50, clientY: 50 }) === null,
    'the 3-D view registers it too: its overlay canvas, draping; no pick while it is hidden');
  ok &= say(Object.keys(ED.views).join(',') === '2d,3d' && $('viewSeg').children.length === 2, 'ED.views by id (2d, 3d), the toolbar\'s switch made from it');
  // round trips at three zooms and pans: world -> screen -> world and screen -> world -> screen
  const view0 = Object.assign({}, S.view), fitted0 = S.fitted, r = cv.getBoundingClientRect();
  const pts = [[0, 0], [-150.5, 120.25], [173.3, -88.8], [12.34, 56.78]];
  let worstW = 0, worstS = 0, worstE = 0, nearOk = true;
  for (const vw of [view0, { x: 40, y: -25, scale: 3.7 }, { x: -120, y: 80, scale: 0.21 }]) {
    S.view = Object.assign({}, vw);
    for (const p of pts) {
      const s = V2.project(p), pk = V2.pickAt(s[0], s[1]);
      worstW = Math.max(worstW, Math.hypot(pk.w[0] - p[0], pk.w[1] - p[1]));
      nearOk = nearOk && Math.abs(pk.near - dpr / S.view.scale) < 1e-12 && pk.z === 0 && pk.view === '2d' && pk.sx === s[0] && pk.sy === s[1] && V2.ppm(p) === S.view.scale;
      const pe = V2.pick({ clientX: r.left + s[0] / dpr, clientY: r.top + s[1] / dpr });
      worstE = Math.max(worstE, Math.hypot(pe.w[0] - p[0], pe.w[1] - p[1]));
      const q = V2.project(V2.pickAt(s[0] + 7.5, s[1] - 3.25).w);
      worstS = Math.max(worstS, Math.hypot(q[0] - s[0] - 7.5, q[1] - s[1] + 3.25));
    }
  }
  S.view = view0; S.fitted = fitted0; render();
  ok &= say(worstW < 1e-9, `project then pickAt gives the world point back (worst ${worstW.toExponential(1)} m, 4 points at 3 zooms)`);
  ok &= say(worstS < 1e-9, `pickAt then project gives the pixel back (worst ${worstS.toExponential(1)} px)`);
  ok &= say(worstE < 1e-6, `pick(e) from client coordinates gives the same point (worst ${worstE.toExponential(1)} m)`);
  ok &= say(nearOk, 'the pick: near = dpr / scale metres a pixel, z 0, view 2d, sx, sy the canvas pixel; ppm the scale');
  // hit: through a pick the same as through the canvas point; the object under it
  const o = objects()[0];
  S.view = { x: o.pos[0], y: o.pos[1], scale: 6 * dpr }; S.fitted = false; render();
  select(null);
  const so = V2.project(o.pos), h1 = hit(V2.pickAt(so[0], so[1])), h2 = hit(so[0], so[1]);
  ok &= say(h1 && sameSel(h1.sel, objSel(o)) && JSON.stringify(h1) === JSON.stringify(h2), `hit(pick) = hit(sx, sy): the object under it (${h1 && JSON.stringify(h1.sel)})`);
  // the pipeline with real events: a mousemove sets S.mouseW from the shown view's pick, a click selects
  const client = w => { const b = cv.getBoundingClientRect(), s = w2s(w); return { clientX: b.left + s[0] / dpr, clientY: b.top + s[1] / dpr }; };
  const tol = dpr / S.view.scale + 1e-9; // whole-pixel events: within a pixel
  window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true }, client([o.pos[0] + 2, o.pos[1] - 1]))));
  ok &= say(S.mouseW && Math.hypot(S.mouseW[0] - o.pos[0] - 2, S.mouseW[1] - o.pos[1] + 1) <= tol, `a mousemove: S.mouseW from the 2-D pick (${S.mouseW})`);
  cv.dispatchEvent(new MouseEvent('mousedown', Object.assign({ button: 0, bubbles: true }, client(o.pos))));
  const pressed = S.press;
  window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ button: 0, bubbles: true }, client(o.pos))));
  ok &= say(sameSel(S.sel, objSel(o)) && pressed === '2d' && S.press === null && !S.drag, `a click on it selects it through the pipeline (the press went to ${pressed})`);
  // the 3-D view (EDUX3): its pick is the camera's ray over the ground, so the mouse has a world point there and a
  // left press is the tools'
  select(null);
  ED.setView('3d');
  const ready3 = typeof V3D !== 'undefined' && V3D.V.gl && await until(() => V3D.V.heights && !V3D.V.groundBusy && V3D.V.scene, 60000);
  if (ready3) {
    V3D.frame();
    const c = V3.project(V3D.look()), cw = V3D.V.canvas.width, ch = V3D.V.canvas.height;
    ok &= say(c && Math.hypot(c[0] - cw / 2, c[1] - ch / 2) < 0.5 && V3.ppm(V3D.look()) > 0 && V3.project(V3D.eye()) === null,
      `the 3-D project: the camera's look point at the canvas's centre (${c && c.map(v => v.toFixed(1))} of ${cw}x${ch}), the eye itself nowhere`);
    let worst3 = 0, picked = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.7], [0.7, 0.35], [0.45, 0.9]]) {
      const pk = V3.pickAt(cw * fx, ch * fy);
      if (!pk) continue;
      picked++;
      const q = V3.project(pk.w);
      worst3 = Math.max(worst3, q ? Math.hypot(q[0] - cw * fx, q[1] - ch * fy) : Infinity);
    }
    ok &= say(picked === 4 && worst3 < 1, `3-D: pickAt then project gives the pixel back (worst ${worst3.toFixed(3)} px, ${picked} of 4 pixels on the ground)`);
    const b3 = V3D.V.canvas.getBoundingClientRect(), at = { clientX: Math.round(b3.left + b3.width / 2), clientY: Math.round(b3.top + b3.height * 0.6) };
    window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true }, at)));
    const pe = V3.pick(at);
    ok &= say(S.mouseW && pe && Math.hypot(S.mouseW[0] - pe.w[0], S.mouseW[1] - pe.w[1]) < 1e-9 && pe.view === '3d' && pe.near > 0,
      `3-D: a mousemove gives S.mouseW from its pick (${S.mouseW && S.mouseW.map(v => v.toFixed(1))}, ${pe && pe.near.toFixed(3)} m a pixel)`);
    const taken = ED.input.down(V3, new MouseEvent('mousedown', Object.assign({ button: 0 }, at)));
    const pressed3 = S.press;
    window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ button: 0, bubbles: true }, at)));
    ok &= say(taken === true && pressed3 === '3d' && S.press === null, 'a left press in 3-D is the tools\' (the pipeline took it)');
    const hs = [V3.project(pe.w)].map(s => [hit(s[0], s[1]), hit(V3.pickAt(s[0], s[1]))])[0];
    ok &= say(JSON.stringify(hs[0]) === JSON.stringify(hs[1]), 'hit(sx, sy) follows the shown view (3-D): ' + JSON.stringify(hs[0] && hs[0].sel));
  } else ok &= say(true, 'the 3-D view: skipped (no WebGL)');
  select(null);
  ED.setView('2d');
  // the previews draw through the view they are given (its project and ppm), and not without an overlay
  const calls = [];
  const rec = { id: 'rec', overlay: ctx, project: p => { calls.push(p); return VIEW2D.project(p); }, ppm: p => VIEW2D.ppm(p) };
  const through = () => { calls.length = 0; ED.drawPreviews(rec); return calls.length; };
  const draw0 = S.draw;
  setTool('shape'); S.draw = 'brush'; S.mouseW = [5, 5];
  const nBrush = through();
  S.draw = 'polygon'; S.drawing = { geom: 'polygon', pts: [[0, 0], [20, 0]], mouse: [20, 20] };
  const nPoly = through();
  S.drawing = null; S.draw = draw0;
  await until(() => PR.P.nouns && PR.P.nouns.length, 10000);
  const cur0 = PR.P.cur;
  PR.P.cur = PR.P.nouns.length ? PR.P.nouns[0].name : cur0;
  setTool('prop'); S.mouseW = [5, 5];
  const nGhost = through();
  calls.length = 0;
  ED.drawPreviews(Object.assign({}, rec, { overlay: null }));
  const nNone = calls.length;
  PR.P.cur = cur0;
  setTool('select');
  S.view = view0; S.fitted = fitted0; render();
  ok &= say(nBrush >= 1 && nPoly >= 3 && nGhost >= 1 && nNone === 0,
    `the previews draw through the view's project: the cliff brush ${nBrush}, a polygon in progress ${nPoly}, the doodad's ghost ${nGhost} points; none without an overlay`);
  say(ok, ok ? 'selftest passed' : 'selftest failed');
  document.title = ok ? 'selftest passed' : 'selftest failed';
  document.body.dataset.selftest = ok ? 'passed' : 'failed';
};

// ---- MAPED-EDIT6's self-test (?selftest=edit6): CM_Grove's drags with what is joined, a cut-off part, CM_Marsh's
// bots' points and a prop on the water, the fit that follows the canvas; every edit undone, nothing saved -----------

ED.selftests = ED.selftests || {};
ED.selftests.edit6 = async function selftestEdit6() {
  const out = $('selftest'), lines = [];
  out.classList.remove('hidden');
  const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
  const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
  const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || '')).join(' ') || 'none';
  const near = (p, q, tol) => isPt(p) && Math.hypot(p[0] - q[0], p[1] - q[1]) <= (tol || 0.051);
  const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
  const drag = async (sel, to) => { // the mouse's drag: startMove at the first move, then moveSel, the check at the end
    S.drag = { sel, start: selValue(sel).slice(), moved: true };
    pushUndo();
    startMove(S.drag);
    moveSel(S.drag, to, null);
    const d = S.drag;
    S.drag = null;
    changed(true);
    await settle();
    return d;
  };
  let ok = true;
  if (S.pkg !== 'CM_Grove') await openMap('CM_Grove');
  ok &= say(S.pkg === 'CM_Grove' && S.report && S.report.ok, 'opened CM_Grove: ' + rules());
  // (4) the fit follows the canvas while the view is untouched
  ok &= say(S.fitted, 'the view is fit after opening');
  const box = cv.getBoundingClientRect(), want = s => Math.abs(S.view.scale - Math.min(cv.width, cv.height) / ((+S.doc.size) * 1.06)) < 1e-6 && s;
  // The fit follows through the canvas's ResizeObserver, whose callbacks come only in a drawn frame. Under a
  // virtual-time budget headless Edge draws none while the timers run (no animation frame in 3 s of virtual
  // time), so run this mode in real time (DEVELOPING.md *Self-tests*); a wait that saw no frame says so.
  const resized = async (fn, ms) => {
    let frames = 0, on = true;
    const tick = () => { if (on) { frames++; requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
    await until(fn, ms);
    on = false;
    return frames ? '' : ' (no frame drawn while it waited: run edit6 in real time, not under a virtual-time budget)';
  };
  const w0 = cv.width;
  cv.style.width = Math.round(box.width / 2) + 'px';
  let note = await resized(() => cv.width < w0, 3000);
  ok &= say(cv.width < w0 && want(true), `the canvas narrowed to ${cv.width} px: the map fit again (${S.view.scale.toFixed(3)} px a metre)` + (cv.width < w0 ? '' : note));
  cv.style.width = box.width + 'px'; // back to its size (then the stylesheet's 100 % again)
  note = await resized(() => cv.width === w0, 3000);
  cv.style.width = '';
  ok &= say(cv.width === w0 && want(true), `the canvas back to ${cv.width} px: fit again (${S.view.scale.toFixed(3)})` + (cv.width === w0 ? '' : note));
  // (1) a well dragged with its clearing and the ends of its paths
  const sh = () => shapes();
  const wellSel = { t: 'obj', path: ['wells', 1, 'pos'] };
  const j1 = joinedTo(wellSel);
  ok &= say(j1.length === 3 && j1.filter(m => m.whole).length === 1, 'well 2 (-130, -60): joined ' + j1.map(m => m.i + (m.whole ? '' : '.' + m.v)).join(', '));
  await drag(wellSel, [-136, -66]);
  ok &= say(near(getAt(S.doc, wellSel.path), [-136, -66]) && near(sh()[7].circle, [-136, -66]) && near(sh()[8].path[0], [-136, -66]) &&
    near(sh()[9].path[0], [-136, -66]) && near(sh()[8].path[1], [-172, -60]), 'the well, its clearing and its two paths\' ends moved to (-136, -66), the paths\' far ends stayed');
  ok &= say(S.report.ok, 'the check passes: ' + rules());
  undo();
  await settle();
  ok &= say(near(sh()[7].circle, [-130, -60]) && near(sh()[8].path[0], [-130, -60]), 'undo: one step puts them all back');
  // the same drag with the option off moves the well alone
  S.joined = false;
  await drag(wellSel, [-136, -66]);
  ok &= say(near(getAt(S.doc, wellSel.path), [-136, -66]) && near(sh()[7].circle, [-130, -60]), 'option off: only the well moved');
  undo();
  S.joined = true;
  await settle();
  // a lane knot: lane 1's knot 2 (-174, -30) to (-182, -35); the shapes beside its legs follow by their place on them
  const knotSel = { t: 'knot', l: 0, k: 2 };
  const j2 = joinedTo(knotSel), find = (i, v) => j2.find(m => m.i === i && (v === undefined ? m.whole : m.v === v));
  const bush = sh().findIndex(s => s.type === 'bush' && Array.isArray(s.polygon) && near(s.polygon[0], [-186, -24]));
  ok &= say(find(14, 1) && find(8, 1) && find(bush), `knot lanes[0].knots[2]: joined ${j2.map(m => m.i + (m.whole ? '' : '.' + m.v) + ' w ' + m.w.toFixed(2)).join(', ')}`);
  const b0 = sh()[bush].polygon[0].slice();
  await drag(knotSel, [-182, -35]);
  const L = lanes();
  ok &= say(near(L[0].knots[2], [-182, -35]) && near(L[1].knots[7], [182, 35]), 'the knot and its partner moved: ' + JSON.stringify(L[0].knots[2]) + ' ' + JSON.stringify(L[1].knots[7]));
  ok &= say(near(sh()[14].path[1], [-168, -18.8], 0.11) && near(sh()[8].path[1], [-176.6, -62.9], 0.11) && near(sh()[14].path[0], [-100, -15]),
    `the paths' ends on the legs followed by their place: ${JSON.stringify(sh()[14].path[1])}, ${JSON.stringify(sh()[8].path[1])}`);
  const b1 = sh()[bush].polygon[0];
  ok &= say(b1[0] < b0[0] - 5 && b1[0] > b0[0] - 7, `the bush beside the leg moved whole: ${JSON.stringify(b0)} to ${JSON.stringify(b1)}`);
  ok &= say(S.report.ok, 'the check passes: ' + rules());
  undo();
  await settle();
  // (2) a pocket cut off: the finding's parts, and clicking it selects and centres the part
  addShape({ type: 'open', circle: [-130, 20], r: 7 });
  await settle();
  const f = (S.report.findings || []).find(x => x.rule === 'reach.dropped');
  ok &= say(f && f.at && near(f.at, [-130, 20], 3) && f.parts && f.parts.length === 1, 'an open circle out of reach: ' + (f ? f.message : rules()));
  const row = document.querySelector('#findings .f[data-rule="reach.dropped"]');
  if (row) row.click();
  ok &= say(S.sel && S.sel.t === 'part' && near([S.view.x, S.view.y], [-130, 20], 3) && $('inspector').textContent.includes('part 1 of 1'),
    `clicking it selects the part and centres it (${S.view.x.toFixed(1)}, ${S.view.y.toFixed(1)}, ${S.view.scale.toFixed(2)} px a metre)`);
  undo();
  await settle();
  ok &= say(S.report.ok && !S.report.findings.length, 'undo: no finding');
  // (5) CM_Grove's bots' points, then CM_Marsh's: its pillar turned team 1's rally
  const bg = S.preview.bots;
  ok &= say(bg && bg.rally.length === 2 && bg.rally.every(r => r.turn === 0) && bg.routes.every(r => r.steps.length === 4) && !botsSummary().uneven,
    'CM_Grove: ' + botsSummary().text);
  await openMap('CM_Marsh');
  const bm = S.preview && S.preview.bots, r1m = bm && bm.rally[0];
  ok &= say(r1m && near(r1m.pos, [28.0, -39.5], 0.06) && r1m.turn === 80 && bm.rally[1].turn === 0 && botsSummary().uneven && $('botsInfo').classList.contains('warn'),
    'CM_Marsh: ' + $('botsInfo').textContent);
  S.show.bots = true;
  render();
  ok &= say(true, 'drawn with the overlay on');
  // (3) a lily pad dropped to z 0, then *On the water*: the water's z + 0.1
  const pk = (S.doc.props || []).findIndex(p => p && typeof p.noun === 'string' && /lily/i.test(p.noun));
  ok &= say(pk >= 0 && (S.preview.water || []).length > 0, `CM_Marsh's lily pads: props[${pk}], ${(S.preview.water || []).length} water planes`);
  if (pk >= 0) {
    const z0 = S.doc.props[pk].pos[2];
    edit(d => { d.props[pk].pos = [d.props[pk].pos[0], d.props[pk].pos[1]]; });
    select({ t: 'prop', k: pk });
    const btn = [...$('inspector').querySelectorAll('button')].find(b => b.textContent === 'On the water');
    if (btn) btn.click();
    const z = S.doc.props[pk].pos[2];
    ok &= say(btn && z === r1(S.preview.water[0].pos[2] + 0.1) && z === z0, `On the water: z ${z} (the file's ${z0}, the water's ${S.preview.water[0].pos[2]})`);
    undo(); undo();
    select(null);
    ok &= say(snapshot() === S.savedJSON, 'undone: CM_Marsh as saved');
  }
  say(ok, ok ? 'selftest passed' : 'selftest failed');
  document.title = ok ? 'selftest passed' : 'selftest failed';
  document.body.dataset.selftest = ok ? 'passed' : 'failed';
};

// ---- EDBIND's self-test (?selftest=bindings, CM_Ring): Lanes > Bindings three or two a lane, a Binding's Delete (its
// tier off every lane, from "auto" too), two the fewest, the tiers' names as the compiler's preview gives them
ED.selftests.bindings = async function selftestBindings() {
  const out = $('selftest'), lines = [];
  out.classList.remove('hidden');
  const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
  const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
  const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || '')).join(' ');
  const lane = id => objects().filter(o => o.kind === 'binding' && o.lane === id).sort((a, b) => a.tier - b.tier);
  const names = id => lane(id).map(o => o.name.split(' ').pop()).join(',');
  const glyphs = id => lane(id).map(o => o.tname ? o.tname[0] : 'B').join('');
  const pvNames = id => S.preview.objects.filter(o => o.team === 1 && o.kind === 'binding' && o.lane === id).map(o => o.name.split(' ').pop()).join(',');
  const same = (p, q) => isPt(p) && isPt(q) && Math.abs(p[0] - q[0]) < 0.11 && Math.abs(p[1] - q[1]) < 0.11;
  const counts = () => Object.values(S.doc.base.bindings).map(l => l.length).join(',');
  const named = (want, what) => {
    const ok = names(1) === want && names(2) === want && pvNames(1) === want && pvNames(2) === want;
    return say(ok, `${what}: the page names lane 1 ${names(1)}, lane 2 ${names(2)} (${glyphs(1)}); the compiler's preview ${pvNames(1)} / ${pvNames(2)}`);
  };
  const lanesBtn = n => document.querySelector(`#tab_lanes [data-bindings="${n}"]`);
  let ok = true;
  await settle();
  ok &= say(S.report && S.report.ok && !bindingsPlaced() && bindingCount() === 3, `opened ${S.pkg}: Bindings "auto", three a lane; check ${S.report.ok ? 'passes' : rules()}`);
  ok &= named('Outer,Middle,Inner', 'auto');
  const auto = { 1: lane(1).map(o => o.pos.slice()), 2: lane(2).map(o => o.pos.slice()) };
  // Lanes > Bindings: Two a lane, from "auto": the middle one goes, the others keep their places
  ED.setTab('lanes');
  ok &= say(lanesBtn(3) && lanesBtn(2) && lanesBtn(3).classList.contains('on') && !lanesBtn(2).classList.contains('on'), 'the Lanes tab has Bindings: Three a lane (on), Two a lane');
  const u0 = S.undo.length;
  if (lanesBtn(2)) lanesBtn(2).click();
  await settle();
  ok &= say(bindingsPlaced() && counts() === '2,2' && S.undo.length === u0 + 1, `Two a lane: ${counts()} placed, one undo step`);
  ok &= say([1, 2].every(id => same(lane(id)[0].pos, auto[id][0]) && same(lane(id)[1].pos, auto[id][2])), 'the Outer and Inner places stay: ' + JSON.stringify(S.doc.base.bindings));
  ok &= say(S.report.ok, 'the check passes: ' + (S.report.ok ? 'yes' : rules()));
  ok &= named('Middle,Inner', 'two a lane') && say(glyphs(1) === 'MI', 'drawn as M and I: ' + glyphs(1));
  ok &= say(lanesBtn(2) && lanesBtn(2).classList.contains('on'), 'Two a lane is on');
  const onLane = $('tab_lanes').textContent;
  ok &= say(/lane 1 Middle/.test(onLane) && /lane 1 Inner/.test(onLane) && !/lane 1 Outer/.test(onLane), 'the Lanes tab lists lane 1 Middle and Inner');
  // two are the fewest: a Delete is refused, the info has no Delete button
  select(objSel(lane(1)[0]));
  ok &= say(!!$('inspector').querySelector('[data-binding-count="2"]') && ![...$('inspector').querySelectorAll('button')].some(b => /every lane/.test(b.textContent)),
    'a selected one of two: its info says two a lane, no Delete');
  const j2 = snapshot();
  deleteSel();
  ok &= say(snapshot() === j2 && S.undo.length === u0 + 1, 'Delete refused at two a lane: ' + counts());
  // Three a lane: a Middle one comes halfway between them, 7.1 m beside the lane's line (SM's Middle)
  if (lanesBtn(3)) lanesBtn(3).click();
  await settle();
  ok &= say(counts() === '3,3', 'Three a lane: ' + counts());
  for (const id of [1, 2]) {
    const [a, m, c] = lane(id).map(o => o.pos), ks = laneById(id).knots;
    let dl = Infinity;
    for (let i = 1; i < ks.length; i++) {
      const u = ks[i - 1], v = ks[i], vx = v[0] - u[0], vy = v[1] - u[1], L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, ((m[0] - u[0]) * vx + (m[1] - u[1]) * vy) / L)) : 0;
      dl = Math.min(dl, Math.hypot(u[0] + t * vx - m[0], u[1] + t * vy - m[1]));
    }
    const dac = Math.hypot(a[0] - c[0], a[1] - c[1]);
    ok &= say(same(a, auto[id][0]) && same(c, auto[id][2]) && Math.abs(dl - 7.1) < 0.2 && Math.hypot(m[0] - a[0], m[1] - a[1]) < dac && Math.hypot(m[0] - c[0], m[1] - c[1]) < dac,
      `lane ${id}'s new Middle ${JSON.stringify(m)}: ${dl.toFixed(2)} m beside the lane's line (7.1), between the two`);
  }
  ok &= say(S.report.ok, 'the check passes: ' + (S.report.ok ? 'yes' : rules()));
  ok &= named('Outer,Middle,Inner', 'three a lane');
  // a selected Binding's Delete: its tier off every lane (the inspector's button and the Del key both go through deleteSel)
  const three = { 1: lane(1).map(o => o.pos.slice()), 2: lane(2).map(o => o.pos.slice()) };
  select(objSel(lane(2)[0]));
  const del = [...$('inspector').querySelectorAll('button')].find(b => /every lane/.test(b.textContent));
  ok &= say(!!del && !!$('inspector').querySelector('[data-binding-count="3"]'), 'a selected one of three: its info has Delete (every lane)');
  if (del) del.click();
  await settle();
  ok &= say(counts() === '2,2' && [1, 2].every(id => same(lane(id)[0].pos, three[id][1]) && same(lane(id)[1].pos, three[id][2])) && !S.sel,
    'lane 2\'s Outer deleted: every lane keeps its Middle and Inner places, ' + counts());
  ok &= say(S.report.ok, 'the check passes: ' + (S.report.ok ? 'yes' : rules()));
  ok &= named('Middle,Inner', 'after the Delete');
  undo();
  await settle();
  ok &= say(counts() === '3,3', 'undo: three a lane again');
  // from "auto": Del on the auto Middle one places them all and takes the Middle tier off
  edit(d => { d.base.bindings = 'auto'; });
  await settle();
  const am = lane(1).find(o => o.tname === 'Middle');
  select(objSel(am));
  ok &= say(S.sel && S.sel.t === 'auto' && !!$('inspector').querySelector('[data-binding-count="3"]'), 'an "auto" Binding selected: its info has the count');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await settle();
  ok &= say(bindingsPlaced() && counts() === '2,2' && [1, 2].every(id => same(lane(id)[0].pos, auto[id][0]) && same(lane(id)[1].pos, auto[id][2])),
    'Del on the "auto" Middle: placed, two a lane at the Outer and Inner places');
  ok &= say(S.report.ok, 'the check passes: ' + (S.report.ok ? 'yes' : rules()));
  while (S.undo.length > u0) undo();
  await settle();
  ok &= say(snapshot() === S.savedJSON, 'undone: ' + S.pkg + ' as saved');
  say(ok, ok ? 'selftest passed' : 'selftest failed');
  document.title = ok ? 'selftest passed' : 'selftest failed';
  document.body.dataset.selftest = ok ? 'passed' : 'failed';
};

// ---- start ------------------------------------------------------------------------------------------------

// start runs when every part of the page has loaded (the frame and the parts register first)
window.addEventListener('DOMContentLoaded', async function start() {
  renderTabs();
  setTool('select');
  await loadState();
  const q = new URLSearchParams(location.search);
  const want = q.get('open') || (q.get('selftest') ? 'CM_Ring' : '');
  if (want) await openMap(want);
  if (want && q.get('view') !== '3d' && q.get('at')) { // the 2-D view: &at=x,y centres it, &ppm= pixels a metre
    const [x, y] = q.get('at').split(',').map(Number);
    S.view.x = x; S.view.y = y;
    S.fitted = false;
    if (+q.get('ppm') > 0) S.view.scale = +q.get('ppm') * dpr;
    render();
  }
  for (const fn of ED.handlers.started || []) await fn();
  const st = q.get('selftest');
  if (st) {
    try { await ((ED.selftests && ED.selftests[st]) || selftest)(st); } catch (e) { // shown, not lost in the console
      $('selftest').classList.remove('hidden');
      $('selftest').textContent += '\nFAIL the self-test threw: ' + (e && e.stack || e);
      document.title = 'selftest failed';
      document.body.dataset.selftest = 'failed';
    }
  }
});

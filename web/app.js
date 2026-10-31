// The map editor's page: a 2-D canvas over map.json (format 1). The document is the parsed map.json itself, so
// members the page doesn't know stay in it; the server writes it back in the file's own layout and checks every
// edit with mapc. Later panes (the 3-D view, props, ground paint) plug in through ED: ED.on('doc' | 'preview' |
// 'select' | 'open' | 'started', fn), ED.addView({id, title, el}) for a tab beside the 2-D view,
// ED.addPane(side, title), ED.selftests[mode] for a pane's own ?selftest=<mode>.
'use strict';

const ED = {
  handlers: {},
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
  emit(ev, ...a) { (this.handlers[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { log(String(e), 'err'); } }); },
  views: [],
  addView(v) { // v: {id, title, el}; el is placed in #views
    v.el.classList.add('view');
    v.el.id = v.el.id || 'view' + v.id;
    $('views').appendChild(v.el);
    this.views.push(v);
    renderTabs();
  },
  // plug-ins (props.js): sel[t] = {value(sel), inspector(el, sel), move(drag, w, e), del(sel)} for a selection type,
  // tools[name] = {down(w, e), move(w, e) and up() (a tool that drags: ground.js), finish(pts) (a polygon drawn
  // with the tool), hover, hint}, hitFirst/hitItems:
  // fn(sx, sy, w, near) -> {sel, mirrored} before the objects (handles) and after them (items), keys(e) -> true;
  // down: fn(h, e, w) -> true takes a Select click itself (h the hit or null; propsel.js: Shift/Ctrl+click, the box,
  // dragging a multiple selection) and may set S.grab = {move(w, e), up()} to follow the mouse until it is let go
  sel: {}, tools: {}, hitFirst: [], hitItems: [], keys: null, down: [],
  addPane(side, title) { // returns the pane's body element
    const sec = document.createElement('section');
    sec.className = 'pane';
    sec.innerHTML = '<h2></h2><div></div>';
    sec.firstChild.textContent = title;
    $(side === 'left' ? 'left' : 'right').appendChild(sec);
    return sec.lastChild;
  },
};

const S = {
  config: null, pkg: null, doc: null, base: null, savedJSON: null, undo: [], redo: [],
  sel: null, hover: null, hoverFinding: null, tool: 'select', drawing: null, drag: null,
  report: null, preview: null, images: null, rev: 0, checkSeq: 0, checking: false, checkTimer: 0,
  bg: 'layout.png', bgAlpha: 0.8, img: null, imgFile: '', imgRev: 0,
  show: { shapes: true, mirror: true, lanes: true, objects: true, props: true, findings: true, bots: true, half: true, grid: false },
  fitted: false, partIdx: {},
  placed: null, placedFrom: null, mouseW: null,
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

function log(msg, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  $('log').prepend(d);
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
  $('btnSave').title = S.delivered ? S.delivered.why : 'Save map.json (Ctrl+S); unchanged values keep their bytes';
  $('btnSaveOwn').classList.toggle('hidden', !S.doc || !S.delivered);
  $('readOnly').classList.toggle('hidden', !S.doc || !S.delivered);
  if (S.delivered) $('readOnly').title = S.delivered.why;
  $('btnBuild').disabled = !S.doc || !S.config || !S.config.copy;
  updateTestButton();
  return dirty;
}

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
      (Array.isArray(b.bindings[id]) ? b.bindings[id] : []).forEach((p, t) => add('binding', 'lane ' + id + ' ' + (TIERS[t] || t), p,
        ['base', 'bindings', id, t], { lane: +id, tier: t }));
    }
  } else {
    pv.filter(o => o.kind === 'binding').forEach(o => add('binding', o.name, o.pos, null,
      { auto: 'bindings', lane: o.lane, tier: TIERS.indexOf(o.name.split(' ').pop()) }));
  }
  (Array.isArray(d.wells) ? d.wells : []).forEach((w, i) => w && add('well', w.kind === 'mine' ? 'mine' : 'well', w.pos, ['wells', i, 'pos']));
  (Array.isArray(d.camps) ? d.camps : []).forEach((c, i) => c && add('camp', (c.kind || 'camp') + ' ' + (c.noun || ''), c.pos, ['camps', i, 'pos']));
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
    case 'lane': return lanes()[sel.l];
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
  if ((p[0] === 'wells' || p[0] === 'camps') && typeof p[1] === 'number') {
    return select({ t: 'obj', path: [p[0], p[1], 'pos'] });
  }
  if (p[0] === 'base' && p.length >= 2 && isPt(getAt(S.doc, p))) return select({ t: 'obj', path: p });
  select(null);
  if (p[0] === 'void') ED.emit('focus-void', str); // the void panel (void.js) shows its field
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
    ctx.fillStyle = TEAM[team - 1];
    ctx.fill();
  }
  if (sel) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  }
  const label = { locus: 'L', guardian: 'G', shop: '$', spawn: o.name.slice(-1), core: o.name.slice(-1),
    binding: o.tier >= 0 ? 'OMI'[o.tier] : 'B', well: 'W', camp: 'C', spawner: 'm', prop: '', ward: 'w' }[o.kind] || '?';
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
  }
  ED.emit('draw', 'under'); // the props (props.js)
  if (S.show.objects) {
    const obs = objects();
    if (S.show.mirror) obs.forEach(o => drawSymbol(o, 2, false));
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
  if (S.drawing) drawDrawing();
  ED.emit('draw', 'over'); // handles and ghosts (props.js)
  if (S.show.findings && S.report) {
    for (const f of S.report.findings || []) {
      if (!f.at) continue;
      const p = w2s(f.at), on = f === S.hoverFinding;
      ctx.save();
      ctx.strokeStyle = f.severity === 'warning' ? '#f2b84b' : '#ff6b6b';
      ctx.lineWidth = (on ? 3 : 2) * dpr;
      ctx.beginPath(); ctx.arc(p[0], p[1], (on ? 14 : 10) * dpr, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${10 * dpr}px Segoe UI, sans-serif`;
      ctx.fillText(f.rule, p[0] + 13 * dpr, p[1] - 9 * dpr);
      for (const [k, part] of (f.parts || []).entries()) { // reach.dropped: every cut-off part (MAPED-EDIT6)
        const c = w2s(part.centre), sel = S.sel && S.sel.t === 'part' && S.sel.k === k;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.lineWidth = (sel ? 3 : 1.5) * dpr;
        ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(6 * dpr, part.r * S.view.scale), 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// drawJoined outlines what a drag of the selected knot, well or camp takes along (or takes along now)
function drawJoined() {
  let js = S.drag && S.drag.moved ? S.drag.joined : null;
  if (!js && S.sel && $('optJoined').checked && (S.sel.t === 'knot' || (S.sel.t === 'obj' && ['wells', 'camps'].includes(S.sel.path[0])))) {
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

// hit returns what is under the screen point: {sel, mirrored}.
function hit(sx, sy) {
  const w = s2w(sx, sy), near = (p, px) => Math.hypot(w2s(p)[0] - sx, w2s(p)[1] - sy) <= px * dpr;
  if (S.sel && ['shape', 'vertex', 'radius'].includes(S.sel.t)) {
    for (const hd of shapeHandles(S.sel.i)) if (near(hd.pos, 7)) return { sel: { t: hd.t, i: hd.i, v: hd.v } };
  }
  for (const fn of ED.hitFirst) { const r = fn(sx, sy, w, near); if (r) return r; }
  if (S.show.objects) {
    const obs = objects();
    for (const o of obs) if (near(o.pos, 9)) return { sel: objSel(o) };
    if (S.show.mirror) for (const o of obs) if (near(mir(o.pos), 9)) return { sel: objSel(o), mirrored: true };
  }
  for (const fn of ED.hitItems) { const r = fn(sx, sy, w, near); if (r) return r; }
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

function snapW(w, e) {
  if ((e && e.shiftKey) || $('optSnap').checked) return [Math.round(w[0]), Math.round(w[1])];
  return [r1(w[0]), r1(w[1])];
}

// moveSel applies a drag: the world delta d from the drag's start, on the values as they were then.
function moveSel(drag, w, e) {
  const sel = drag.sel, d0 = [w[0] - drag.start[0], w[1] - drag.start[1]];
  const d = drag.mirrored ? mir(d0) : d0;
  const orig = drag.orig;
  const at = p => snapW([p[0] + d[0], p[1] + d[1]], e);
  switch (sel.t) {
    case 'obj': setPoint(sel.path, at(orig)); break;
    case 'knot': setPoint(['lanes', sel.l, 'knots', sel.k], at(orig)); break;
    case 'vertex': { const s = shapes()[sel.i]; (s.polygon || s.path)[sel.v] = at(orig); break; }
    case 'radius': { const s = shapes()[sel.i]; s.r = Math.max(1, r1(Math.hypot(w[0] - s.circle[0], w[1] - s.circle[1]))); break; }
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
  drag.joined = $('optJoined').checked ? joinedTo(drag.sel) : [];
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

cv.addEventListener('mousedown', e => {
  if (!S.doc) return;
  cv.focus();
  const [sx, sy] = evPos(e), w = s2w(sx, sy);
  if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
    S.pan = { sx, sy, x: S.view.x, y: S.view.y };
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  if (S.tool === 'shape') return drawDown(w, e);
  if (ED.tools[S.tool] && ED.tools[S.tool].down) return ED.tools[S.tool].down(w, e);
  if (S.tool === 'well' || S.tool === 'camp') {
    const p = snapW(w, e);
    edit(d => {
      if (S.tool === 'well') { d.wells = Array.isArray(d.wells) ? d.wells : []; d.wells.push({ pos: p }); select({ t: 'obj', path: ['wells', d.wells.length - 1, 'pos'] }); }
      else { d.camps = Array.isArray(d.camps) ? d.camps : []; d.camps.push({ kind: 'camp', noun: '', pos: p }); select({ t: 'obj', path: ['camps', d.camps.length - 1, 'pos'] }); }
    });
    return;
  }
  const h = hit(sx, sy);
  for (const fn of ED.down) if (fn(h, e, w)) return;
  select(h ? h.sel : null);
  if (h) S.drag = beginDrag(h, w);
});
window.addEventListener('mousemove', e => {
  if (!S.doc) return;
  const [sx, sy] = evPos(e), w = s2w(sx, sy);
  $('coords').textContent = `x ${w[0].toFixed(1)}  y ${w[1].toFixed(1)}  (x+y ${(w[0] + w[1]).toFixed(1)})`;
  S.mouseW = w;
  if (ED.tools[S.tool] && ED.tools[S.tool].hover && !S.pan && !S.drawing) render();
  if (S.pan) {
    S.fitted = false;
    S.view.x = S.pan.x - (sx - S.pan.sx) / S.view.scale;
    S.view.y = S.pan.y + (sy - S.pan.sy) / S.view.scale;
    render();
    return;
  }
  if (S.grab) { S.grab.move(w, e); return; } // propsel.js: the selection box
  if (ED.tools[S.tool] && ED.tools[S.tool].move) { ED.tools[S.tool].move(w, e); return; } // ground.js: paint, stamp
  if (S.drawing) { S.drawing.mouse = snapW(w, e); if (S.drawing.down) drawMove(w, e); render(); return; }
  if (S.drag && (e.buttons & 1)) {
    if (!S.drag.moved) {
      if (Math.hypot(w[0] - S.drag.start[0], w[1] - S.drag.start[1]) * S.view.scale < 3 * dpr) return;
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
    changed(true);
  }
});
window.addEventListener('mouseup', () => {
  if (S.pan) { S.pan = null; return; }
  if (S.grab) { const g = S.grab; S.grab = null; g.up(); return; }
  if (ED.tools[S.tool] && ED.tools[S.tool].up) { ED.tools[S.tool].up(); return; }
  if (S.drawing && S.drawing.down) return drawUp();
  if (S.drag && S.drag.moved) scheduleCheck();
  S.drag = null;
});
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  if (!S.doc) return;
  e.preventDefault();
  const [sx, sy] = evPos(e), w = s2w(sx, sy);
  S.fitted = false;
  S.view.scale *= Math.exp(-e.deltaY * 0.0015);
  const w2 = s2w(sx, sy);
  S.view.x += w[0] - w2[0];
  S.view.y += w[1] - w2[1];
  render();
}, { passive: false });
cv.addEventListener('dblclick', e => {
  if (S.drawing) return drawFinish();
  const [sx, sy] = evPos(e);
  const h = hit(sx, sy);
  if (h && h.sel.t === 'shape') { // a polygon or path gets a vertex where it's double-clicked
    const s = shapes()[h.sel.i], pts = s.polygon || s.path;
    if (!Array.isArray(pts)) return;
    const w = snapW(s2w(sx, sy));
    let best = 0, bd = Infinity;
    const n = s.polygon ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) { const d = distSeg(w, pts[i], pts[(i + 1) % pts.length]); if (d < bd) { bd = d; best = i; } }
    edit(() => pts.splice(best + 1, 0, w));
    select({ t: 'vertex', i: h.sel.i, v: best + 1 });
  }
});

function autoToPath(sel) {
  if (sel.which === 'cores') return { t: 'obj', path: ['base', 'cores', sel.idx] };
  return { t: 'obj', path: ['base', 'bindings', String(sel.lane), sel.tier] };
}

// ---- drawing new shapes -----------------------------------------------------------------------------------

function newType() { return document.querySelector('input[name=stype]:checked').value; }
function newGeom() { return document.querySelector('input[name=sgeom]:checked').value; }
function drawDown(w, e, geom) {
  const p = snapW(w, e), g = geom || newGeom();
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
    addShape({ type: newType(), circle: d.center, r: d.r });
  }
}
function drawFinish() {
  const d = S.drawing;
  if (!d || d.geom === 'circle') return;
  S.drawing = null;
  // a double-click adds its point twice
  const pts = d.pts.filter((p, i) => !i || Math.hypot(p[0] - d.pts[i - 1][0], p[1] - d.pts[i - 1][1]) > 0.05);
  if (ED.tools[S.tool] && ED.tools[S.tool].finish) { ED.tools[S.tool].finish(pts); render(); return; }
  if (d.geom === 'polygon' && pts.length >= 3) addShape({ type: newType(), polygon: pts });
  else if (d.geom === 'path' && pts.length >= 2) addShape({ type: newType(), path: pts, width: 12 });
  else render();
}
function drawDrawing() {
  const d = S.drawing;
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.lineWidth = 1.5 * dpr;
  if (d.geom === 'circle') {
    const c = w2s(d.center);
    ctx.beginPath(); ctx.arc(c[0], c[1], d.r * S.view.scale, 0, 2 * Math.PI); ctx.stroke();
  } else {
    poly(d.pts.concat(d.mouse ? [d.mouse] : []), false, d.geom === 'polygon');
    ctx.stroke();
  }
  ctx.restore();
}
function addShape(sh) {
  edit(d => {
    d.terrain = d.terrain && typeof d.terrain === 'object' ? d.terrain : { default: 'wall' };
    d.terrain.shapes = Array.isArray(d.terrain.shapes) ? d.terrain.shapes : [];
    d.terrain.shapes.push(sh);
  });
  select({ t: 'shape', i: shapes().length - 1 });
}

function setTool(t) {
  S.tool = t;
  S.drawing = null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('shapeOpts').style.display = t === 'shape' ? '' : 'none';
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  updateHint();
  if (ED.tools[t] && ED.tools[t].hint) $('toolHint').textContent = ED.tools[t].hint;
  $('toolHint').style.display = t === 'shape' || (ED.tools[t] && ED.tools[t].hint) ? '' : 'none';
  ED.emit('tool', t);
  render();
}
function updateHint() {
  const g = newGeom();
  $('toolHint').textContent = g === 'circle' ? 'Circle: press at the centre, drag out the radius.'
    : g === 'polygon' ? 'Polygon: click the corners; double-click or Enter ends, Esc cancels.'
      : 'Path: click the points; double-click or Enter ends (width 12 m, change it in the inspector).';
}

// deleteSel removes the selection where the format allows it: the fixed set can only be moved.
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
  if (s.t === 'obj' && ['wells', 'camps'].includes(s.path[0])) {
    edit(d => d[s.path[0]].splice(s.path[1], 1));
    return select(null);
  }
  log('the fixed set (Locus, Guardian, shop, spawns, Cores, Bindings) is moved, never deleted', 'err');
}

// ---- the inspector ----------------------------------------------------------------------------------------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
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
  return h('div', {}, ta, h('div', { class: 'btns' }, btn, msg));
}

function renderInspector() {
  const el = $('inspector');
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  el.textContent = '';
  if (!S.doc) { el.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
  const s = S.sel;
  if (!s || selValue(s) === undefined && s.t !== 'auto') return mapInspector(el);
  if (ED.sel[s.t] && ED.sel[s.t].inspector) return ED.sel[s.t].inspector(el, s);
  if (s.t === 'obj') {
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
    if (['wells', 'camps'].includes(s.path[0])) {
      el.append(joinedNote(s));
      el.append(jsonEditor(getAt(S.doc, parentPath), v => setAt(S.doc, parentPath, v)),
        h('div', { class: 'btns' }, h('button', { onclick: deleteSel }, 'Delete')));
    }
    if (s.path[1] === 'cores' || s.path[1] === 'bindings') {
      el.append(h('div', { class: 'btns' }, h('button', { onclick: () => { edit(d => { d.base[s.path[1]] = 'auto'; }); select(null); } },
        'Back to "auto" (all ' + s.path[1] + ')')));
    }
    return;
  }
  if (s.t === 'auto') {
    el.append(h('div', { class: 'path' }, 'base.' + s.which + ' = "auto"'),
      h('p', {}, 'Placed by the compiler from the lanes and the Guardian. Drag one to place them all by hand (they become explicit points).'));
    return;
  }
  if (s.t === 'knot' || s.t === 'lane') {
    const l = lanes()[s.l];
    el.append(h('div', { class: 'path' }, s.t === 'knot' ? `lanes[${s.l}].knots[${s.k}]` : `lanes[${s.l}]`),
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
      edit(d => d.lanes.forEach(x => { x.width = +ev.target.value; }));
    } })));
    return;
  }
  const i = s.i, sh = shapes()[i];
  el.append(h('div', { class: 'path' }, `terrain.shapes[${i}]`));
  if (s.t === 'vertex') el.append(h('div', {}, `corner ${s.v}`), xyInputs(() => (sh.polygon || sh.path)[s.v], q => { (sh.polygon || sh.path)[s.v] = q; }));
  const typeSel = h('select', { onchange: ev => edit(() => { sh.type = ev.target.value; }) },
    ...['open', 'wall', 'chasm', 'island', 'bush'].map(t => h('option', { value: t, selected: sh.type === t }, t)));
  el.append(h('label', {}, 'type ', typeSel));
  if (sh.r !== undefined) el.append(h('label', {}, 'radius (m) ', h('input', { type: 'number', step: '0.5', value: sh.r, onchange: ev => edit(() => { sh.r = +ev.target.value; }) })));
  if (sh.width !== undefined) el.append(h('label', {}, 'width (m) ', h('input', { type: 'number', step: '0.5', value: sh.width, onchange: ev => edit(() => { sh.width = +ev.target.value; }) })));
  if (sh.type === 'chasm') { // water in the chasm's dip: true, or {"z": m, "mask": name} from the JSON below
    el.append(h('label', { title: 'A water plane at z -2 m (or the JSON\'s "z"), sized to the chasm by the compiler' },
      h('input', { type: 'checkbox', checked: !!sh.water, onchange: ev => edit(() => { if (ev.target.checked) sh.water = true; else delete sh.water; }) }), ' water'));
  }
  const move = dlt => () => {
    const j = i + dlt;
    if (j < 0 || j >= shapes().length) return;
    edit(d => { const a = d.terrain.shapes; [a[i], a[j]] = [a[j], a[i]]; });
    select({ t: 'shape', i: j });
  };
  el.append(h('div', { class: 'btns' }, h('button', { onclick: move(-1), title: 'Drawn earlier (under)' }, 'Up'),
    h('button', { onclick: move(1), title: 'Drawn later (over)' }, 'Down'), h('button', { onclick: deleteSel }, 'Delete')),
  h('p', { class: 'small' }, 'Shapes are drawn in order over terrain.default; the compiler adds each one\'s mirror. Double-click an edge to add a corner.'),
  jsonEditor(sh, v => { S.doc.terrain.shapes[i] = v; }));
}

// joinedNote says what a drag of the knot, well or camp takes along (outlined on the map)
function joinedNote(sel) {
  if (!$('optJoined').checked) return h('p', { class: 'small' }, 'A drag moves only this point (tick *drag joined shapes along* to take the shapes joined to it).');
  const js = joinedTo(sel), whole = js.filter(m => m.whole).length;
  return h('p', { class: 'small' }, js.length ? `A drag takes ${whole} shape${whole === 1 ? '' : 's'} and ${js.length - whole} path end${js.length - whole === 1 ? '' : 's'} or corner${js.length - whole === 1 ? '' : 's'} along (outlined; the option *drag joined shapes along*).` : 'Nothing is joined to it: a drag moves only this point.');
}

function mapInspector(el) {
  const d = S.doc;
  el.append(h('div', { class: 'path' }, S.pkg + '/map.json'));
  const field = (label, get, set, type) => h('label', {}, label + ' ', h('input', {
    type: type || 'text', value: get() ?? '', onchange: ev => edit(() => set(type === 'number' ? +ev.target.value : ev.target.value)),
  }));
  for (const [k, v] of Object.entries(d)) { // every top-level scalar, the unknown ones too
    if (v === null || typeof v === 'object') continue;
    el.append(field(k, () => d[k], x => { d[k] = x; }, typeof v === 'number' ? 'number' : 'text'));
  }
  if (d.terrain && typeof d.terrain === 'object') {
    el.append(h('label', {}, 'terrain.default ', h('select', { onchange: ev => edit(() => { d.terrain.default = ev.target.value; }) },
      ...['wall', 'open', 'chasm'].map(t => h('option', { value: t, selected: d.terrain.default === t }, t)))));
  }
  el.append(h('p', { class: 'small' }, 'Select something on the canvas to edit it. Esc deselects, F fits the view, Del deletes, drag with the right button pans.'));
  el.append(h('details', {}, h('summary', {}, 'The whole document as JSON'), jsonEditor(d, v => { S.doc = v; })));
}

// ---- checks -----------------------------------------------------------------------------------------------

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
  if (res.preview) {
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
        if (Array.isArray(f.parts) && f.parts.length) return selectPart(f, 'next'); // reach.dropped: part by part
        if (f.path) selectPath(f.path);
        if (f.at) { S.view.x = f.at[0]; S.view.y = f.at[1]; S.fitted = false; render(); }
      } },
    h('div', { class: 'rule' }, (f.severity === 'warning' ? 'warning ' : 'error ') + f.rule), where ? h('div', { class: 'where' }, where) : null,
    h('div', {}, f.message || ''),
    Array.isArray(f.parts) && f.parts.length > 1 ? h('div', { class: 'small' }, `${f.parts.length} parts: click again for the next`) : null);
    el.append(row);
  }
  const st = r.stats;
  $('stats').textContent = st ? `graphs ${st.playerAreas} (Player) / ${st.npcAreas} (NPC) areas of ${st.cell} cells, lanes ${(st.laneLengths || []).join(' / ')} m, ${st.bushes} bushes, ${st.wells} wells` : '';
  const bs = botsSummary();
  $('botsInfo').textContent = bs.text;
  $('botsInfo').classList.toggle('warn', bs.uneven);
}

// selectPart selects a cut-off part of a reach.dropped finding (the next one on each call) and centres it, zoomed in
// far enough to see it
function selectPart(f, k) {
  const n = f.parts.length;
  if (k === 'next') k = S.sel && S.sel.t === 'part' ? (S.sel.k + 1) % n : 0;
  const p = f.parts[k];
  select({ t: 'part', k });
  S.view.x = p.centre[0];
  S.view.y = p.centre[1];
  S.view.scale = Math.max(S.view.scale, Math.min(cv.width, cv.height) / Math.max(60, 4 * p.r));
  S.fitted = false;
  render();
}
function droppedFinding() { return S.report && (S.report.findings || []).find(f => f.rule === 'reach.dropped' && Array.isArray(f.parts)); }
ED.sel.part = {
  value: sel => { const f = droppedFinding(); return f ? f.parts[sel.k] : undefined; },
  inspector: (el, sel) => {
    const f = droppedFinding(), p = f.parts[sel.k], cs = (S.preview && S.preview.size || +S.doc.size || 400) / (S.preview && S.preview.grid || 512);
    el.append(h('div', { class: 'path' }, `reach.dropped: part ${sel.k + 1} of ${f.parts.length}`),
      h('div', {}, `${p.cells} cells (${Math.round(p.cells * cs * cs)} m²) round (${p.centre[0]}, ${p.centre[1]}), about ${p.r} m across from its centre`),
      h('p', { class: 'small' }, 'Walkable ground the graphs leave out: nothing joins it to the bases (or a neck is narrower than the graphs\' squares, about 4 m). Open a path to it, widen the neck, or close it with a wall shape. Team 2\'s mirror has the same.'),
      h('div', { class: 'btns' }, f.parts.length > 1 ? h('button', { onclick: () => selectPart(f, 'next') }, 'Next part') : null));
  },
  move: () => {},
  del: () => log('a cut-off part is the check\'s finding: change the shapes round it', 'err'),
};

// ---- layers -----------------------------------------------------------------------------------------------

function renderLayers() {
  const el = $('bgList');
  if (!S.preview || el.dataset.rev === 'set') return;
  el.dataset.rev = 'set';
  el.textContent = '';
  const files = [{ file: '', shows: 'no picture' }].concat(S.preview.files);
  for (const f of files) {
    const name = f.file ? f.file.replace('.png', '') : 'none';
    el.append(h('label', { title: f.shows }, h('input', { type: 'radio', name: 'bg', value: f.file, checked: f.file === S.bg,
      onchange: () => { S.bg = f.file; loadBg(); render(); } }), ' ' + name));
  }
}
function loadBg() {
  if (!S.bg || !S.images) { S.img = null; return; }
  if (S.imgFile === S.bg && S.imgRev === S.rev) return;
  const img = new Image(), file = S.bg, rev = S.rev;
  img.onload = () => { if (file === S.bg) { S.img = img; S.imgFile = file; S.imgRev = rev; render(); } };
  img.src = S.images + file;
}
function renderOverlays() {
  const el = $('overlayList');
  const names = { shapes: 'shapes', mirror: "team 2's mirror", lanes: 'lanes', objects: 'objects', props: 'props', findings: 'findings', bots: "the bots' points (rally, Hunter routes)", half: 'the halves', grid: 'grid (20 m)' };
  for (const k of Object.keys(S.show)) {
    el.append(h('label', {}, h('input', { type: 'checkbox', checked: S.show[k], onchange: ev => { S.show[k] = ev.target.checked; render(); } }), ' ' + names[k]));
  }
}

// ---- views (2-D now; later packages add theirs) -----------------------------------------------------------

function renderTabs() {
  const nav = $('viewTabs');
  nav.textContent = '';
  const all = [{ id: '2d', title: '2-D', el: $('view2d') }].concat(ED.views);
  for (const v of all) {
    nav.append(h('button', { class: v.el.classList.contains('on') ? 'on' : '', onclick: () => {
      all.forEach(x => x.el.classList.toggle('on', x === v));
      renderTabs();
      if (v.id === '2d') resize();
      ED.emit('view', v.id);
    } }, v.title));
  }
}

// ---- files: open, save, new, build ------------------------------------------------------------------------

async function loadState() {
  S.config = await api('GET', '/api/state');
  const sel = $('mapSelect');
  const cur = sel.value;
  sel.textContent = '';
  sel.append(h('option', { value: '' }, '(open a map)'));
  for (const m of S.config.maps || []) sel.append(h('option', { value: m.pkg }, m.pkg + (m.display ? ' - ' + m.display : '')));
  sel.value = S.pkg || cur;
  if (S.config.test && !S.config.test.enabled && !S.testNoted) { S.testNoted = true; log('Test is off: ' + S.config.test.reason); }
  if (!S.test) pollTest(true); // a Test started before the page was (re)loaded
  if (S.config.pageError) log(S.config.pageError, 'err'); // the backend serves an error page instead; a page kept open
  updateDirty();
}

async function openMap(pkg) {
  if (S.doc && updateDirty() && !confirm('Discard the unsaved changes to ' + S.pkg + '?')) { $('mapSelect').value = S.pkg; return; }
  const res = await api('GET', '/api/map/' + pkg);
  if (res.error) { log(res.error, 'err'); return; }
  let doc;
  try { doc = JSON.parse(res.text); } catch (e) { log(pkg + '/map.json does not parse: ' + e.message, 'err'); return; }
  if (res.delivered) log(res.delivered.why);
  Object.assign(S, { pkg, doc, base: res.sha256, savedJSON: JSON.stringify(doc), undo: [], redo: [], sel: null,
    delivered: res.delivered || null,
    report: null, preview: null, images: null, img: null, imgFile: '', drawing: null, placed: null, placedFrom: null });
  $('bgList').dataset.rev = '';
  $('mapSelect').value = pkg;
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

async function build() {
  if (!S.doc) return;
  if (updateDirty() && !S.delivered) { if (!confirm('Build reads the saved package. Save first?')) return; await save(); }
  log(`building ${S.pkg}...`);
  const res = await api('POST', `/api/build/${S.pkg}?mesh=${$('optNoMesh').checked ? 0 : 1}`);
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
  b.textContent = run && !starting ? 'Test again' : 'Test';
  b.disabled = !S.doc || !on || starting;
  b.title = !on ? (S.config && S.config.test && S.config.test.reason) || ''
    : starting ? 'A Test is starting: wait until the game runs, or press Stop'
      : run ? 'Save, then close the game and start it again on the saved version'
        : 'Save, then play this map in the game: log in on This PC, then PLAY, PRACTICE DAWNGATE';
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
  else if (e.key === 'f' || e.key === 'F') fit();
});
window.addEventListener('beforeunload', e => { if (S.doc && updateDirty()) { e.preventDefault(); e.returnValue = ''; } });
$('mapSelect').addEventListener('change', e => e.target.value && openMap(e.target.value));
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnSave').onclick = () => save();
$('btnBuild').onclick = build;
$('btnTest').onclick = testMap;
$('btnTestStop').onclick = stopTest;
$('btnNew').onclick = () => newDialog(false);
$('btnSaveOwn').onclick = () => newDialog(true);
$('bgAlpha').oninput = e => { S.bgAlpha = e.target.value / 100; render(); };
$('optJoined').onchange = () => { renderInspector(); render(); };
document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
document.querySelectorAll('input[name=sgeom]').forEach(r => { r.onchange = () => { S.drawing = null; updateHint(); }; });

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
  const w0 = cv.width;
  cv.style.width = Math.round(box.width / 2) + 'px';
  await until(() => cv.width < w0, 3000);
  ok &= say(cv.width < w0 && want(true), `the canvas narrowed to ${cv.width} px: the map fit again (${S.view.scale.toFixed(3)} px a metre)`);
  cv.style.width = box.width + 'px'; // back to its size (then the stylesheet's 100 % again)
  await until(() => cv.width === w0, 3000);
  cv.style.width = '';
  ok &= say(cv.width === w0 && want(true), `the canvas back to ${cv.width} px: fit again (${S.view.scale.toFixed(3)})`);
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
  $('optJoined').checked = false;
  await drag(wellSel, [-136, -66]);
  ok &= say(near(getAt(S.doc, wellSel.path), [-136, -66]) && near(sh()[7].circle, [-130, -60]), 'option off: only the well moved');
  undo();
  $('optJoined').checked = true;
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

// ---- start ------------------------------------------------------------------------------------------------

(async function start() {
  renderOverlays();
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
})();

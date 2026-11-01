// Feedback while editing: what the author sees while a drag, a drawing or a brush is under way, in either view.
// - Measurements at the cursor and in the status bar's selection part: a lane's length and width while its knot or
//   width handle moves, the spacing from a dragged Binding to the others, every dragged thing's distance to the
//   centre, a corner's edges, a circle's radius, a drawing's leg, the brush's size.
// - Labelled snaps (on by default; Tools > Smart Snaps or the status bar's Snap part switch them; Ctrl while dragging
//   leaves them out for that move): the centre and the midpoints of lane legs and shape edges first, then the mirror
//   line, a lane's edge and, with the grid shown, the grid's lines (where two of them meet, their crossing); Shift
//   still rounds to 1 m. A drag snaps the point it moves (an object, a knot, a corner; a whole shape the point
//   grabbed), so a shape keeps its form.
// - A typed value: digits (and . - ,) then Enter, while dragging or drawing or right after a drag: a distance along
//   the drag's direction (x,y: the place), a circle's radius, the lanes' width, a drawing's next leg (x,y: the next
//   corner), with a brush armed its size. Backspace and Esc edit the number.
// - Hard rule breaks refused while dragging and drawing, where the page decides them exactly and cheaply: an object on
//   a wall, a chasm or (but a well) an island cell of the live raster (relief.js, the compiler's raster port; the
//   check's fixed.open), past the level's edge (size.bounds), on team 2's half (symmetry.half), the Guardian out of
//   the south-west (symmetry.base), a shape moved onto team 2's half, a lane knot on its neighbour (lanes.knots), the
//   lanes' width outside 6 to 80 m (lanes.width), a polygon crossing itself (the page's own rule), a terrain edit that
//   would leave an object on such ground. The drag keeps its last good step; the refused place shows as a red ghost
//   with the reason. A rule broken before the drag began isn't refused (so a broken map can be mended).
// - Soft findings (every finding of the check the page doesn't refuse: its warnings, the rules it can't decide such
//   as fixed.range or fixed.hole) marked on the object where it is now and on its mirror twin, with the rule's reason.
// - The Map Check window: a click on a finding selects what it names and shows it in the view shown (2-D: centred and
//   zoomed in; 3-D: the camera on it).
// Plugs into app.js through ED: snapAt, snapDrag, dragStart, dragCheck, dragEnd, pressed, refusePlace,
// refuseShapes, refuseCorner, refuseClose, markFinding, jumpFinding, measureText, previews, selftests.feedback.
'use strict';

const FB = (() => {
  const F = {
    on: true, // the smart snaps
    snap: null, // the last snap: {p, label, lines: [{a, u}], grid1}
    typed: '', // the number being typed
    last: null, // the last drag, which a typed value can still set (until the next press or edit)
    jumped: null, // the finding the Map Check window last showed
    mods: { ctrlKey: false, shiftKey: false },
    flash: null, // a refusal outside a drag: {ghost, lines, at, until}
    tags: {}, snaps: {}, markLog: {}, // what the last frame drew per view (the self-test reads them)
    stack: {}, ms: [], // stack: per view, the findings labelled at a place; ms: the drag rules' milliseconds per step (the last 200)
  };
  const TOL = 8; // CSS pixels: a snap's reach
  const EDGE_PX = 40; // an edge shorter than this on the screen offers no midpoint (a brush stroke's legs)
  const OPEN = 1, ISLAND = 4, KIND_NAME = { 0: 'wall', 1: 'open', 2: 'chasm', 4: 'island' };
  const RED = '#ff5c5c', SNAP = '#ffd84a';
  const m1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const polyLen = pts => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

  // ---- snaps ---------------------------------------------------------------------------------------------------
  // snapAt: the labelled snap for the point p the mouse gives (null: none; the caller rounds), and F.snap. ex: what
  // isn't a target (a dragged knot's lanes, a dragged shape's own edges)
  function snapAt(p, e, ex) {
    F.snap = null;
    if (!S.doc || !p) return null;
    if (!ex && (S.tool === 'well' || S.tool === 'camp')) { // + Well, + Camp: no snap onto a place it would be refused
      const path = [S.tool === 'well' ? 'wells' : 'camps', 0, 'pos'];
      ex = { ok: q => !objFails(path, q).length };
    }
    if (F.on && !(e && e.ctrlKey)) {
      const s = smart(p, ex || {});
      if (s && (!ex || !ex.ok || ex.ok(s.p))) return (F.snap = s);
    }
    if ((e && e.shiftKey) || S.snap) return (F.snap = { p: [Math.round(p[0]), Math.round(p[1])], label: 'Grid 1 m', grid1: true, lines: [] });
    return null;
  }
  function edgesOf(pts, closed) {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
    if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
    return out;
  }
  function smart(p, ex) {
    const near = S.near || 1, tol = TOL * near, minEdge = EDGE_PX * near;
    let best = null;
    const pt = (q, label) => { const d = dist(q, p); if (d <= tol && (!best || d < best.d)) best = { p: q, label, d, lines: [] }; };
    pt([0, 0], 'Centre');
    const mids = (pts, closed, mirror) => {
      for (const [a, b] of edgesOf(pts, closed)) {
        if (dist(a, b) < minEdge) continue;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        pt(m, 'Midpoint');
        if (mirror) pt(mir(m), 'Midpoint');
      }
    };
    const L = lanes().filter(l => l && Array.isArray(l.knots) && l.knots.length > 1 && l.knots.every(isPt));
    if (!ex.lanes) L.forEach(l => mids(l.knots, false, false)); // the lanes hold both teams' halves already
    shapes().forEach((s, i) => {
      if (!s || s.lane !== undefined || i === ex.shape) return;
      const pts = Array.isArray(s.polygon) ? s.polygon : Array.isArray(s.path) ? s.path : null;
      if (pts && pts.every(isPt)) mids(pts, !!s.polygon, true);
    });
    if (best) return finish(best);
    // lines: the mirror line, the lanes' edges, the grid's lines; where two meet near the point, their crossing
    const lines = [];
    const line = (a, u, label, len) => {
      const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
      if (len !== undefined && (t < 0 || t > len)) return;
      const f = [a[0] + t * u[0], a[1] + t * u[1]], d = dist(f, p);
      if (d <= tol) lines.push({ a, u, d, f, label });
    };
    line([0, 0], [Math.SQRT1_2, -Math.SQRT1_2], 'Mirror line');
    if (!ex.lanes) {
      for (const l of L) {
        const hw = (+l.width || 0) / 2;
        for (const [a, b] of edgesOf(l.knots, false)) {
          const len = dist(a, b);
          if (len < 1e-6) continue;
          const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]];
          for (const sg of [1, -1]) line([a[0] + sg * n[0] * hw, a[1] + sg * n[1] * hw], u, 'Lane edge', len);
        }
      }
    }
    if (S.show.grid) { // app.js draws the grid's lines every 20 m
      line([Math.round(p[0] / 20) * 20, 0], [0, 1], 'Grid');
      line([0, Math.round(p[1] / 20) * 20], [1, 0], 'Grid');
    }
    if (!lines.length) return null;
    lines.sort((a, b) => a.d - b.d);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const A = lines[i], B = lines[j], cr = A.u[0] * B.u[1] - A.u[1] * B.u[0];
        if (Math.abs(cr) < 1e-6) continue;
        const t = ((B.a[0] - A.a[0]) * B.u[1] - (B.a[1] - A.a[1]) * B.u[0]) / cr, x = [A.a[0] + t * A.u[0], A.a[1] + t * A.u[1]];
        if (dist(x, p) <= tol) return finish({ p: x, label: A.label === B.label ? A.label : A.label + ' \u00D7 ' + B.label, lines: [A, B] });
      }
    }
    return finish({ p: lines[0].f, label: lines[0].label, lines: [lines[0]] });
  }
  // finish rounds a snapped point to the format's 0.1 m, a point on the mirror line onto it (x = -y)
  function finish(s) {
    if (s.label === 'Centre') s.p = [0, 0];
    else if (s.lines.some(l => l.label === 'Mirror line')) { const t = r1(s.p[0]); s.p = [t, t === 0 ? 0 : -t]; } else s.p = [r1(s.p[0]), r1(s.p[1])];
    return s;
  }
  // refOf: the point a drag moves, as shown (the mirror twin's when the drag took the twin): an object's, a knot's, a
  // corner's, a doodad's place; else (a whole shape, a region, several doodads) the point grabbed
  function refOf(drag) {
    const o = drag.orig, t = drag.sel.t;
    let r = t !== 'shape' && isPt(o) ? o : t !== 'shape' && o && isPt(o.pos) ? o.pos : null;
    if (!r) return drag.start;
    r = [r[0], r[1]];
    return drag.mirrored ? mir(r) : r;
  }
  const NO_SNAP = ['radius', 'lwidth', 'protate', 'pscale'];
  // the drags that snap: the layout's points and shapes (the doodads, the scatter regions and the ground's own keep the
  // grid's rounding, as their placing does)
  const SNAPS = ['obj', 'knot', 'vertex', 'shape'];
  // snapDrag: the drag's delta with the moved point snapped (null: no snap; a Grid 1 m snap is left to moveSel, which
  // rounds every point as before); only a drag the mouse started (startMove: drag.fb)
  function snapDrag(drag, d0, e) {
    if (!SNAPS.includes(drag.sel.t) || !drag.orig || !drag.fb) return null;
    const ref = refOf(drag), t = drag.sel.t;
    const ex = t === 'knot' ? { lanes: true } : ['shape', 'vertex'].includes(t) ? { shape: drag.sel.i } : {};
    if (t === 'obj') { // an object isn't snapped onto a place its drag would refuse (a lane's edge on a wall cell)
      const before = drag.fb.before || [];
      ex.ok = q => !objFails(drag.sel.path, drag.mirrored ? mir(q) : q).some(f => !before.includes(f.rule));
    }
    const s = snapAt([ref[0] + d0[0], ref[1] + d0[1]], e, ex);
    if (!s || s.grid1) return null;
    drag.snap = s;
    return [s.p[0] - ref[0], s.p[1] - ref[1]];
  }

  // ---- the rules the page decides --------------------------------------------------------------------------------
  const scratch = new Uint8Array(512 * 512);
  // kindAt: the raster's kind of the cell under p for the terrain T (RL.terrainOf: the compiler's raster, one cell)
  function kindAt(T, p) {
    if (!T || typeof RL === 'undefined') return OPEN;
    const i = RL.cellOf(p[0], T.c), j = RL.cellOf(p[1], T.c);
    RL.paint(scratch, T, { i0: i, j0: j, i1: i, j1: j });
    return scratch[j * 512 + i];
  }
  const terrain = extra => (typeof RL === 'undefined' ? null : RL.terrainOf(S.doc, extra));
  const kindOk = (k, well) => k === OPEN || (k === ISLAND && well);
  // the authored objects fixed.open checks (wards aren't; nor the "auto" Cores and Bindings, whose places the page
  // knows only from the last passing check), with their kind under the terrain T and whether it may stand there
  function objectStates(T) {
    return objects().filter(o => o.kind !== 'ward' && o.path && isPt(o.pos)).map(o => {
      const k = kindAt(T, o.pos);
      return { key: o.kind + '|' + o.name + '|' + JSON.stringify(o.path || o.auto), name: o.name, kind: k, ok: kindOk(k, o.kind === 'well') };
    });
  }
  // walledIn: the first object that stood on allowed ground under T0 and doesn't under T1, or null
  function walledIn(T0, T1, before) {
    const was = new Map((before || objectStates(T0)).map(s => [s.key, s.ok]));
    for (const s of objectStates(T1)) if (!s.ok && was.get(s.key)) return { rule: 'fixed.open', why: `${s.name} would stand on ${KIND_NAME[s.kind] || 'blocked'} ground` };
    return null;
  }
  // objFails: the rules a point at the map.json path breaks: size.bounds, symmetry.half and symmetry.base for the
  // authored points (base, wells, camps; mapc check.go authored()), fixed.open for those and the camps and wells
  function objFails(path, P, T) {
    const out = [];
    if (!Array.isArray(path) || !isPt(P) || !['base', 'wells', 'camps'].includes(path[0])) return out;
    const lim = (+S.doc.size || 400) / 2 - 2;
    if (Math.abs(P[0]) > lim || Math.abs(P[1]) > lim) out.push({ rule: 'size.bounds', why: `past the level's edge (\u00B1${lim} m)` });
    if (P[0] + P[1] > 0) out.push({ rule: 'symmetry.half', why: 'on team 2\'s half: author team 1\'s, team 2\'s mirrors it' });
    if (path[0] === 'base' && path[1] === 'guardian' && !(P[0] < 0 && P[1] < 0)) out.push({ rule: 'symmetry.base', why: 'team 1\'s Guardian stays in the south-west (x < 0, y < 0)' });
    const k = kindAt(T === undefined ? terrain() : T, P);
    if (!kindOk(k, path[0] === 'wells')) out.push({ rule: 'fixed.open', why: `on ${KIND_NAME[k] || 'blocked'} ground` });
    return out;
  }
  // knotFails: a knot past the edge or within 1 m of its neighbours (lanes.knots)
  function knotFails(l, k) {
    const ks = (lanes()[l] || {}).knots || [], P = ks[k], out = [];
    if (!isPt(P)) return out;
    const lim = (+S.doc.size || 400) / 2 - 2;
    if (Math.abs(P[0]) > lim || Math.abs(P[1]) > lim) out.push({ rule: 'size.bounds', why: `past the level's edge (\u00B1${lim} m)` });
    for (const j of [k - 1, k + 1]) if (isPt(ks[j]) && dist(ks[j], P) < 1) out.push({ rule: 'lanes.knots', why: `on knot ${j + 1}: knots stay 1 m apart` });
    return out;
  }
  // segment crossing (touching counts): orientation tests
  function orient(a, b, c) { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1; }
  function onSeg(a, b, c) { return Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9; }
  function segsMeet(a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
  }
  // selfCross: two edges of the closed polygon that aren't neighbours meet ([i, j]), or null
  function selfCross(pts) {
    const n = pts.length;
    if (n < 4) return null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segsMeet(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return [i, j];
      }
    }
    return null;
  }
  // crossesChain: the new edge from the chain's last point to p meets one of its edges but the last
  function crossesChain(pts, p) {
    const n = pts.length;
    if (n < 2 || dist(pts[n - 1], p) < 0.05) return false;
    for (let i = 0; i + 2 < n; i++) if (segsMeet(pts[i], pts[i + 1], pts[n - 1], p)) return true;
    return false;
  }
  const CROSS = { rule: 'polygon', why: 'the polygon would cross itself' };
  function shapeHalf(s) { // symmetry.half for a terrain shape: its box's centre has x + y > 0.5 (lane corridors excepted)
    if (!s || s.lane !== undefined) return false;
    const pts = isPt(s.circle) ? [s.circle] : (s.polygon || s.path || []).filter(isPt);
    if (!pts.length) return false;
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    return (Math.min(...xs) + Math.max(...xs)) / 2 + (Math.min(...ys) + Math.max(...ys)) / 2 > 0.5;
  }
  // dragStart keeps what the drag's rules compare with: the rules broken before it began, the objects' ground
  function dragStart(drag) {
    const t = drag.sel.t, fb = drag.fb = { before: [] };
    if (t === 'obj') fb.before = objFails(drag.sel.path, drag.orig).map(f => f.rule);
    else if (t === 'knot') fb.before = knotFails(drag.sel.l, drag.sel.k).map(f => f.rule);
    else if (['shape', 'vertex', 'radius'].includes(t)) {
      const s = shapes()[drag.sel.i];
      fb.objects = objectStates(terrain());
      if (shapeHalf(s)) fb.before.push('symmetry.half');
      if (s && Array.isArray(s.polygon) && selfCross(s.polygon)) fb.before.push('polygon');
    } else if (t === 'svertex') {
      const sc = (S.doc.scatter || [])[drag.sel.k];
      if (sc && Array.isArray(sc.polygon) && selfCross(sc.polygon)) fb.before.push('polygon');
    }
    if (t === 'knot') { const l = lanes()[drag.sel.l]; fb.len0 = l && Array.isArray(l.knots) ? polyLen(l.knots) : 0; }
  }
  // dragFails: the first hard rule the drag's present step breaks that wasn't broken when it began, or null
  function dragFails(drag) {
    const t = drag.sel.t, fb = drag.fb || { before: [] }, fresh = list => list.find(f => !fb.before.includes(f.rule)) || null;
    if (t === 'obj') return fresh(objFails(drag.sel.path, selValue(drag.sel)));
    if (t === 'knot') return fresh(knotFails(drag.sel.l, drag.sel.k));
    if (t === 'lwidth') return drag.want !== undefined && !(drag.want >= LANE_MIN && drag.want <= LANE_MAX)
      ? { rule: 'lanes.width', why: `a lane is ${LANE_MIN} to ${LANE_MAX} m wide (${m1(drag.want)} m asked)`, keep: true } : null;
    if (['shape', 'vertex', 'radius'].includes(t)) {
      const s = shapes()[drag.sel.i], out = [];
      if (shapeHalf(s)) out.push({ rule: 'symmetry.half', why: 'the shape\'s centre would be on team 2\'s half' });
      if (s && Array.isArray(s.polygon) && selfCross(s.polygon)) out.push(CROSS);
      const f = fresh(out);
      if (f) return f;
      return fb.objects ? walledIn(null, terrain(), fb.objects) : null;
    }
    if (t === 'svertex') {
      const sc = (S.doc.scatter || [])[drag.sel.k];
      return sc && Array.isArray(sc.polygon) && selfCross(sc.polygon) ? fresh([CROSS]) : null;
    }
    return null;
  }
  function ghostOf(drag) {
    const t = drag.sel.t, disp = q => (isPt(q) ? (drag.mirrored ? mir(q) : [q[0], q[1]]) : null);
    if (t === 'lwidth') return { width: drag.want };
    if (['shape', 'vertex', 'radius'].includes(t)) {
      return { shape: JSON.parse(JSON.stringify(shapes()[drag.sel.i])), mirrored: drag.mirrored, pt: t === 'vertex' ? disp(selValue(drag.sel)) : null };
    }
    if (t === 'svertex') { const sc = (S.doc.scatter || [])[drag.sel.k]; return { shape: { polygon: JSON.parse(JSON.stringify(sc.polygon)) }, mirrored: drag.mirrored, pt: disp(selValue(drag.sel)) }; }
    return { pt: disp(selValue(drag.sel)) || S.mouseW };
  }
  const mods = e => ({ shiftKey: !!(e && e.shiftKey), ctrlKey: !!(e && e.ctrlKey) });
  // dragCheck runs after each drag step: a step that breaks a hard rule is undone (the last good one stays) and kept
  // as the red ghost; the lanes' width stays clamped at 6 or 80 m
  function dragCheck(drag, w, e) {
    const t0 = performance.now(), bad = dragFails(drag);
    F.ms.push(performance.now() - t0);
    if (F.ms.length > 200) F.ms.shift();
    if (!bad) {
      drag.good = { w: w ? w.slice() : null, d0: drag.d0 ? drag.d0.slice() : [0, 0], exact: !!drag.snap, e: mods(e) };
      drag.refused = null;
      return null;
    }
    drag.refused = Object.assign({}, bad, { ghost: ghostOf(drag) });
    F.snap = null;
    if (!bad.keep) restore(drag);
    return bad;
  }
  function restore(drag) {
    const g = drag.good;
    if (g) moveSel(drag, g.w, Object.assign({}, g.e, { fixedD: g.d0, exact: g.exact }));
    else {
      moveSel(drag, drag.start, { fixedD: [0, 0], exact: true });
      if (drag.sel.t === 'radius') shapes()[drag.sel.i].r = drag.orig.r;
    }
    drag.snap = null;
  }
  function dragEnd(drag) {
    if (drag.refused) log(`refused: ${drag.refused.why} (${drag.refused.rule}); kept the last good place`, 'err');
    drag.refused = null;
    F.last = drag;
    drag.undoLen = S.undo.length;
    F.snap = null;
  }
  function flash(bad, ghost, at) {
    F.flash = { bad, ghost, at, until: performance.now() + 2500 };
    log(`refused: ${bad.why} (${bad.rule})`, 'err');
  }
  // refusePlace: + Well, + Mine, + Camp at p (true: refused)
  function refusePlace(tool, p) {
    const path = tool === 'well' ? ['wells', 0, 'pos'] : tool === 'camp' ? ['camps', 0, 'pos'] : null;
    const bad = path && objFails(path, p)[0];
    if (!bad) return false;
    flash(bad, { pt: p }, p);
    render();
    return true;
  }
  const BLOCKING = ['wall', 'chasm', 'island'];
  // refuseShapes: new terrain shapes (a drawn shape, a brush stroke) that would leave an object on blocked ground
  function refuseShapes(list) {
    if (!list.some(s => s && BLOCKING.includes(s.type))) return false;
    const bad = walledIn(terrain(), terrain(list));
    if (!bad) return false;
    flash(bad, { shapes: list }, S.mouseW);
    return true;
  }
  function refuseCorner(p, geom) {
    const d = S.drawing;
    if (geom !== 'polygon' || !d || d.geom !== 'polygon' || !crossesChain(d.pts, p)) return false;
    flash(CROSS, { seg: [d.pts[d.pts.length - 1], p] }, p);
    return true;
  }
  function refuseClose(pts) {
    if (pts.length < 4 || !selfCross(pts)) return false;
    flash({ rule: 'polygon', why: 'its closing edge would cross it: add a corner, or Esc' }, { seg: [pts[pts.length - 1], pts[0]] }, pts[0]);
    return true;
  }
  // pending: what the drawing or stroke in progress would add (a cliff's shapes), and the refusal it would meet
  let pendMemo = { key: null, val: null };
  function pending() {
    const d = S.drawing, out = { shapes: [], bad: null, ghost: null };
    if (d && d.geom === 'polygon' && d.mouse && crossesChain(d.pts, d.mouse)) {
      out.bad = CROSS;
      out.ghost = { seg: [d.pts[d.pts.length - 1], d.mouse] };
      return out;
    }
    if (S.tool !== 'shape' || !BLOCKING.includes(newType())) return out;
    if (S.stroke && S.stroke.pts.length) out.shapes = cliffStrokeShapes(S.stroke.pts).map(newShape);
    else if (d && d.geom === 'circle' && d.down && d.r >= 1) out.shapes = [newShape(toTeam1({ circle: d.center, r: d.r }))];
    else if (d && d.geom === 'polygon' && d.pts.length + (d.mouse ? 1 : 0) >= 3) out.shapes = [newShape(toTeam1({ polygon: d.pts.concat(d.mouse ? [d.mouse] : []) }))];
    else if (d && d.geom === 'path' && d.pts.length + (d.mouse ? 1 : 0) >= 2) out.shapes = [newShape(toTeam1({ path: d.pts.concat(d.mouse ? [d.mouse] : []), width: r1(Math.max(1, S.brush.size)) }))];
    if (!out.shapes.length) return out;
    const key = JSON.stringify(out.shapes) + '|' + S.undo.length;
    if (pendMemo.key !== key) pendMemo = { key, val: walledIn(terrain(), terrain(out.shapes)) };
    out.bad = pendMemo.val;
    if (out.bad) out.ghost = { shapes: out.shapes };
    return out;
  }

  // ---- typed values --------------------------------------------------------------------------------------------
  function typedCtx() {
    if (S.drag && S.drag.moved && S.drag.orig) return { k: 'drag', drag: S.drag };
    const d = S.drawing;
    if (d && d.geom === 'circle' && d.down) return { k: 'circle' };
    if (d && Array.isArray(d.pts) && d.pts.length) return { k: 'leg' };
    const L = F.last;
    if (L && L.undoLen === S.undo.length && sameSel(S.sel, L.sel) && selValue(L.sel) !== undefined) return { k: 'drag', drag: L, after: true };
    if (S.draw === 'brush' && (S.tool === 'shape' || S.tool === 'paint') && !S.stroke) return { k: 'brush' };
    return null;
  }
  function typedWhat(c) {
    if (!c) return '';
    if (c.k === 'drag') {
      const t = c.drag.sel.t;
      return t === 'lwidth' ? 'the lanes\' width' : t === 'radius' ? 'the radius' : NO_SNAP.includes(t) ? '' : 'the distance (x,y: the place)';
    }
    return { circle: 'the radius', leg: 'the leg (x,y: the corner)', brush: 'the brush\'s size' }[c.k] || '';
  }
  function parseTyped(txt) {
    const nums = txt.split(',').map(s => s.trim());
    if (!nums.length || nums.length > 2 || nums.some(s => s === '' || !isFinite(+s))) return null;
    return nums.map(Number);
  }
  // applyTyped sets what the context's value is: true when it was set
  function applyTyped(c, nums) {
    const no = msg => { log(msg, 'err'); render(); return false; };
    if (!nums) return no('not a number: ' + F.typed);
    if (c.k === 'brush') {
      if (nums.length !== 1 || !(nums[0] >= 1 && nums[0] <= 60)) return no('a brush is 1 to 60 m');
      S.brush.size = r1(nums[0]);
      if (typeof FR !== 'undefined') FR.renderStatus();
      render();
      return true;
    }
    if (c.k === 'circle') {
      if (nums.length !== 1 || !(nums[0] >= 1)) return no('a circle\'s radius is at least 1 m');
      S.drawing.r = r1(nums[0]);
      drawUp();
      return true;
    }
    if (c.k === 'leg') {
      const d = S.drawing, last = d.pts[d.pts.length - 1];
      let p;
      if (nums.length === 2) p = nums;
      else {
        const m = d.mouse || last, L = dist(m, last);
        if (L < 1e-6) return no('move the mouse first: it gives the leg\'s direction');
        p = [last[0] + (m[0] - last[0]) / L * nums[0], last[1] + (m[1] - last[1]) / L * nums[0]];
      }
      p = [r1(p[0]), r1(p[1])];
      const n0 = d.pts.length;
      drawDown(p, { exact: true }, d.geom);
      if (S.drawing && S.drawing.pts.length > n0) S.drawing.mouse = p;
      render();
      return !!S.drawing && S.drawing.pts.length > n0;
    }
    // a drag: during it (the drag ends there) or right after it (one more undo step)
    const drag = c.drag, t = drag.sel.t;
    let e2;
    if (t === 'lwidth') {
      if (nums.length !== 1 || !(nums[0] >= LANE_MIN && nums[0] <= LANE_MAX)) return no(`a lane is ${LANE_MIN} to ${LANE_MAX} m wide (lanes.width): ${nums.join(',')} m refused`);
      e2 = { width: nums[0] };
    } else if (t === 'radius') {
      if (nums.length !== 1 || !(nums[0] >= 1)) return no('a circle\'s radius is at least 1 m');
      e2 = { r: r1(nums[0]) };
    } else if (NO_SNAP.includes(t)) return no('a turn or a size isn\'t typed here: use the selection\'s fields');
    else {
      const ref = refOf(drag);
      let d0;
      if (nums.length === 2) d0 = [nums[0] - ref[0], nums[1] - ref[1]];
      else {
        const cur = drag.d0 || [0, 0], L = Math.hypot(cur[0], cur[1]);
        if (L < 1e-6) return no('drag a little first: the drag gives the direction (or type x,y)');
        d0 = [cur[0] / L * nums[0], cur[1] / L * nums[0]];
      }
      e2 = { fixedD: d0, exact: true };
    }
    const before = c.after ? snapshot() : null;
    if (c.after) pushUndo();
    moveSel(drag, drag.good ? drag.good.w : drag.start, e2);
    const bad = dragFails(drag);
    if (bad && !bad.keep) {
      const ghost = ghostOf(drag);
      if (c.after) { S.doc = JSON.parse(before); S.undo.pop(); } else restore(drag);
      flash(bad, ghost, ghost.pt || S.mouseW);
      changed(true);
      return false;
    }
    drag.good = { w: drag.good ? drag.good.w : null, d0: drag.d0 ? drag.d0.slice() : [0, 0], exact: true, e: {} };
    drag.refused = null;
    if (!c.after) { S.drag = null; drag.undoLen = S.undo.length; F.last = drag; } else drag.undoLen = S.undo.length;
    F.snap = null;
    changed(); // the check
    return true;
  }
  window.addEventListener('keydown', e => {
    const ae = document.activeElement;
    if (!S.doc || (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const c = typedCtx(), k = e.key;
    if (!c) { F.typed = ''; return; }
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); render(); };
    if (/^[0-9.]$/.test(k) || (k === '-' && (!F.typed || F.typed.endsWith(','))) || (k === ',' && F.typed && !F.typed.includes(','))) {
      F.typed += k;
      return take();
    }
    if (!F.typed) return;
    if (k === 'Backspace') { F.typed = F.typed.slice(0, -1); return take(); }
    if (k === 'Escape') { F.typed = ''; return take(); }
    if (k === 'Enter') {
      const nums = parseTyped(F.typed);
      applyTyped(c, nums);
      F.typed = '';
      return take();
    }
  }, true);
  window.addEventListener('mousemove', e => { F.mods = mods(e); }, true);
  window.addEventListener('mousedown', e => { F.mods = mods(e); }, true);
  function pressed() { F.last = null; F.typed = ''; F.flash = null; F.snap = null; }
  ED.on('open', () => { F.last = null; F.typed = ''; F.jumped = null; F.flash = null; });

  // ---- measurements --------------------------------------------------------------------------------------------
  function bindingLines(P, sel) {
    const all = objects().filter(o => o.kind === 'binding'), me = all.find(o => sameSel(objSel(o), sel));
    if (!me) return [];
    const near = all.filter(o => o !== me && o.lane === me.lane && Math.abs(o.tier - me.tier) === 1).sort((a, b) => a.tier - b.tier);
    const out = near.map(o => `to ${TIERS[o.tier] || o.tier} ${m1(dist(P, o.pos))} m`);
    let enemy = null;
    for (const o of all) { const d = dist(P, mir(o.pos)); if (!enemy || d < enemy.d) enemy = { d, o }; }
    if (enemy) out.push(`nearest enemy Binding ${m1(enemy.d)} m`);
    return out.length ? [out.join(' \u00B7 ')] : [];
  }
  // measure: the lines the cursor's tag shows and the status bar joins ([] when nothing is being edited)
  function measure() {
    const out = [], drag = S.drag && S.drag.moved && S.drag.orig ? S.drag : null;
    if (drag) {
      const t = drag.sel.t, v = selValue(drag.sel);
      if (t === 'obj' && isPt(v)) {
        const o = objects().find(x => sameSel(objSel(x), drag.sel));
        out.push(`${o ? o.name : 'object'}${drag.mirrored ? ' (team 2\'s twin)' : ''}: moved ${m1(dist(v, drag.orig))} m \u00B7 centre ${m1(Math.hypot(v[0], v[1]))} m`);
        if (o && o.kind === 'binding') out.push(...bindingLines(v, drag.sel));
      } else if (t === 'knot' && isPt(v)) {
        const l = lanes()[drag.sel.l], ks = l.knots, k = drag.sel.k, len = polyLen(ks), d = len - ((drag.fb && drag.fb.len0) || len);
        const legs = [k - 1, k + 1].filter(j => isPt(ks[j])).map(j => m1(dist(ks[j], v)));
        out.push(`lane ${l.id}: ${m1(len)} m (${d >= 0 ? '+' : ''}${m1(d)}) \u00B7 width ${l.width} m`);
        out.push(`knot ${k + 1}: legs ${legs.join(' / ')} m \u00B7 centre ${m1(Math.hypot(v[0], v[1]))} m`);
      } else if (t === 'lwidth') {
        const l = lanes()[drag.sel.l] || {};
        out.push(`the lanes' width ${l.width} m (${LANE_MIN} to ${LANE_MAX})`);
      } else if (t === 'vertex' && isPt(v)) {
        const s = shapes()[drag.sel.i], pts = s.polygon || s.path, n = pts.length, k = drag.sel.v;
        const nb = s.polygon ? [(k - 1 + n) % n, (k + 1) % n] : [k - 1, k + 1].filter(j => j >= 0 && j < n);
        out.push(`corner ${k + 1}: edges ${nb.map(j => m1(dist(pts[j], v))).join(' / ')} m \u00B7 centre ${m1(Math.hypot(v[0], v[1]))} m`);
      } else if (t === 'radius') {
        const s = shapes()[drag.sel.i];
        out.push(`radius ${m1(+s.r || 0)} m (across ${m1(2 * (+s.r || 0))} m)`);
      } else if (!NO_SNAP.includes(t)) {
        const d0 = drag.d0 || [0, 0], c = t === 'shape' && v ? shapeCentre(v) : refOf(drag);
        out.push(`moved ${m1(Math.hypot(d0[0], d0[1]))} m` + (c ? ` \u00B7 centre ${m1(Math.hypot(c[0], c[1]))} m` : ''));
      }
      if (drag.refused) out.push({ t: `refused: ${drag.refused.why} (${drag.refused.rule})`, c: RED });
    } else if (S.drawing) {
      const d = S.drawing;
      if (d.geom === 'circle') out.push(`radius ${m1(d.r || 0)} m (across ${m1(2 * (d.r || 0))} m)`);
      else if (d.pts && d.pts.length) {
        const last = d.pts[d.pts.length - 1], leg = d.mouse ? dist(last, d.mouse) : 0, tot = polyLen(d.pts) + leg;
        out.push(`leg ${m1(leg)} m \u00B7 ${d.geom === 'polygon' ? 'edges' : 'length'} ${m1(tot)} m` + (d.geom === 'polygon' && d.mouse && d.pts.length > 1 ? ` \u00B7 closing ${m1(dist(d.mouse, d.pts[0]))} m` : '') + (d.geom === 'path' ? ` \u00B7 width ${m1(Math.max(1, S.brush.size))} m` : ''));
      }
    } else if (S.draw === 'brush' && (S.tool === 'shape' || S.tool === 'paint') && S.mouseW) {
      out.push(`Brush ${S.brush.size} m${S.brush.shape === 'square' ? ' square' : ''}` + (S.tool === 'shape' ? ' \u00B7 ' + newType() : ''));
    } else if (['well', 'camp', 'ward'].includes(S.tool) && S.mouseW) {
      const p = F.snap ? F.snap.p : S.mouseW;
      out.push(`centre ${m1(Math.hypot(p[0], p[1]))} m`);
    }
    const pd = !drag ? pending() : null;
    if (pd && pd.bad) out.push({ t: `refused: ${pd.bad.why} (${pd.bad.rule})`, c: RED });
    if (F.typed) out.push({ t: `typed: ${F.typed}\u258F Enter sets ${typedWhat(typedCtx())}`, c: SNAP });
    return out;
  }
  const txt = l => (typeof l === 'string' ? l : l.t);
  // measureText: the status bar's selection part while something is being edited (a drag, a drawing, a number typed)
  function measureText() {
    if (!(S.drag && S.drag.moved) && !S.drawing && !F.typed && !S.stroke) return '';
    return measure().map(txt).join(' \u00B7 ');
  }

  // ---- drawing (both views) ------------------------------------------------------------------------------------
  // tag draws a box of text lines at canvas pixel s (below and right of it, kept inside the canvas)
  function tag(v, s, lines, dx, dy) {
    if (!s || !lines.length) return;
    const g = v.overlay;
    g.save();
    g.font = `${11 * dpr}px Segoe UI, sans-serif`;
    const lh = 14 * dpr, w = Math.max(...lines.map(l => g.measureText(txt(l)).width)) + 8 * dpr, h = lines.length * lh + 4 * dpr;
    let x = s[0] + (dx === undefined ? 16 : dx) * dpr, y = s[1] + (dy === undefined ? 14 : dy) * dpr;
    if (x + w > g.canvas.width) x = s[0] - w - 12 * dpr;
    if (y + h > g.canvas.height) y = s[1] - h - 12 * dpr;
    g.fillStyle = 'rgba(14,16,20,0.82)';
    g.fillRect(x, y, w, h);
    lines.forEach((l, i) => { g.fillStyle = (typeof l === 'object' && l.c) || '#e8edf3'; g.fillText(txt(l), x + 4 * dpr, y + (i + 1) * lh - 2 * dpr); });
    g.restore();
  }
  function shapeOutline(v, s, mirrored) {
    const m = q => (mirrored ? mir(q) : q);
    if (isPt(s.circle)) vring(v, m(s.circle), +s.r || 0);
    else if (Array.isArray(s.polygon)) vpoly(v, s.polygon.filter(isPt).map(m), true);
    else if (Array.isArray(s.path)) vpoly(v, s.path.filter(isPt).map(m));
    else return false;
    return true;
  }
  function drawGhost(v, gh) {
    if (!gh) return;
    const g = v.overlay;
    g.save();
    g.strokeStyle = RED;
    g.lineWidth = 2 * dpr;
    g.setLineDash([5 * dpr, 3 * dpr]);
    for (const s of (gh.shapes || []).concat(gh.shape ? [gh.shape] : [])) {
      if (s.path && s.width && !gh.shape) { g.save(); g.globalAlpha = 0.45; vband(v, s.path.map(q => (gh.mirrored ? mir(q) : q)), +s.width); g.restore(); }
      if (shapeOutline(v, s, gh.mirrored)) g.stroke();
    }
    if (gh.seg) { g.setLineDash([]); vpoly(v, gh.seg); g.stroke(); }
    if (gh.width !== undefined && S.sel) {
      const l = lanes()[S.sel.l];
      if (l && Array.isArray(l.knots)) { g.globalAlpha = 0.5; vband(v, l.knots, Math.max(0.5, gh.width)); }
    }
    if (isPt(gh.pt)) {
      g.setLineDash([]);
      vring(v, gh.pt, Math.max(1.5, 9 * vmpp(v, gh.pt)));
      g.stroke();
      const s = v.project(gh.pt);
      if (s) { g.beginPath(); g.moveTo(s[0] - 5 * dpr, s[1] - 5 * dpr); g.lineTo(s[0] + 5 * dpr, s[1] + 5 * dpr); g.moveTo(s[0] + 5 * dpr, s[1] - 5 * dpr); g.lineTo(s[0] - 5 * dpr, s[1] + 5 * dpr); g.stroke(); }
    }
    g.restore();
  }
  function drawSnap(v, s) {
    const g = v.overlay, c = v.project(s.p);
    if (!c) return;
    g.save();
    g.strokeStyle = SNAP;
    g.lineWidth = 1.5 * dpr;
    for (const l of s.lines || []) { // the line it took, 60 pixels each way
      const r = 60 * vmpp(v, s.p);
      g.setLineDash([4 * dpr, 3 * dpr]);
      vpoly(v, [[s.p[0] - l.u[0] * r, s.p[1] - l.u[1] * r], [s.p[0] + l.u[0] * r, s.p[1] + l.u[1] * r]]);
      g.stroke();
    }
    g.setLineDash([]);
    g.beginPath(); // a diamond on the point
    g.moveTo(c[0], c[1] - 6 * dpr); g.lineTo(c[0] + 6 * dpr, c[1]); g.lineTo(c[0], c[1] + 6 * dpr); g.lineTo(c[0] - 6 * dpr, c[1]); g.closePath();
    g.stroke();
    g.restore();
    tag(v, c, [{ t: s.label, c: SNAP }], 10, -24);
    F.snaps[v.id] = s.label;
  }
  // the hover snap: where the next click of a placing tool lands (+ Well, + Camp, + Ward spot, a drawing's corner)
  function hoverSnap() {
    if (S.drag || S.stroke || !S.mouseW) return null;
    const placing = ['well', 'camp', 'ward'].includes(S.tool) || S.drawing || S.tool === 'scatter' || ((S.tool === 'shape' || S.tool === 'paint') && S.draw !== 'brush');
    if (!placing) return null;
    if (S.drawing) return F.snap; // the drawing's mouse is snapped already (app.js smartW)
    return snapAt(S.mouseW, F.mods, {});
  }
  function drawFeedback(v) {
    if (!S.doc) return;
    F.markLog[v.id] = []; // markFinding fills it after the previews (drawFindings)
    F.stack[v.id] = new Map(); // the findings already labelled at a place this frame (their tags stack)
    F.tags[v.id] = null;
    F.snaps[v.id] = null;
    const drag = S.drag && S.drag.moved ? S.drag : null;
    if (drag && drag.refused) drawGhost(v, drag.refused.ghost);
    const pd = drag ? null : pending();
    if (pd && pd.bad) drawGhost(v, pd.ghost);
    if (F.flash && performance.now() < F.flash.until) {
      drawGhost(v, F.flash.ghost);
      if (isPt(F.flash.at)) tag(v, v.project(F.flash.at), [{ t: `refused: ${F.flash.bad.why} (${F.flash.bad.rule})`, c: RED }]);
    } else F.flash = null;
    const s = drag ? (drag.snap || (F.snap && F.snap.grid1 ? F.snap : null)) : hoverSnap();
    if (s) drawSnap(v, s);
    const lines = measure();
    if (lines.length && S.mouseW && v.id === (S.press || ED.view)) {
      tag(v, v.project(S.mouseW), lines);
      F.tags[v.id] = lines.map(txt);
    }
    chip(s);
  }
  ED.previews.push(drawFeedback);
  // the status bar's Snap part: on or off, and the snap taken
  function chip(s) {
    const el = $('stSnap');
    if (!el) return;
    el.textContent = !F.on ? 'Snap: off' : s ? 'Snap: ' + s.label : 'Snap: on';
    el.classList.toggle('off', !F.on);
    if (S.drag || S.drawing) { const st3 = $('st3'), m = measureText(); if (st3 && m) st3.textContent = m; }
  }
  function toggle() {
    F.on = !F.on;
    log('smart snaps ' + (F.on ? 'on' : 'off'), 'ok');
    chip(null);
    render();
  }
  ED.actions['tools.smartSnaps'] = toggle;
  ED.flags = ED.flags || {};
  ED.flags['tools.smartSnaps'] = () => F.on;
  if ($('stSnap')) $('stSnap').addEventListener('click', toggle);

  // ---- the check's findings in place --------------------------------------------------------------------------
  // placesOf: where a finding's object is now and its mirror twin ([{p, twin}]), or null
  function placesOf(f) {
    if (!S.doc) return null;
    const P = parsePath(f.path || '');
    let pos = null, twin = true;
    if (P[0] === 'terrain' && P[1] === 'shapes' && typeof P[2] === 'number') { const s = shapes()[P[2]]; pos = s && s.lane === undefined ? shapeCentre(s) : null; }
    else if (P[0] === 'lanes' && typeof P[1] === 'number' && P[2] === 'knots' && typeof P[3] === 'number') pos = getAt(S.doc, P.slice(0, 4));
    else if (['wells', 'camps', 'wards'].includes(P[0]) && typeof P[1] === 'number') { const it = (S.doc[P[0]] || [])[P[1]]; pos = it && it.pos; }
    else if (P[0] === 'props' && typeof P[1] === 'number') { const it = (S.doc.props || [])[P[1]]; pos = it && (isPt(it.pos) ? it.pos : it.group && it.group.at); twin = !(it && it.mirror === false); }
    else if (P[0] === 'scatter' && typeof P[1] === 'number') { const it = (S.doc.scatter || [])[P[1]]; pos = it && (isPt(it.circle) ? it.circle : Array.isArray(it.polygon) ? shapeCentre(it) : null); }
    else if (P[0] === 'base') {
      const q = getAt(S.doc, P);
      if (isPt(q)) pos = q;
      else if (isPt(f.at)) { // an "auto" Core or Binding, a spawner: the object at the finding's place
        const o = objects().filter(x => x.kind !== 'ward').map(x => ({ x, d: dist(x.pos, f.at) })).sort((a, b) => a.d - b.d)[0];
        pos = o && o.d < 3 ? o.x.pos : f.at;
      }
    }
    if (!isPt(pos)) pos = isPt(f.at) ? f.at : null;
    if (!pos) return null;
    pos = [pos[0], pos[1]];
    const out = [{ p: pos, twin: false }];
    if (twin && Math.hypot(pos[0], pos[1]) > 1) out.push({ p: mir(pos), twin: true });
    return out;
  }
  function selPathStr() {
    const s = S.sel;
    if (!s) return '';
    if (s.t === 'obj') return pathStr(s.path);
    if (['shape', 'vertex', 'radius'].includes(s.t)) return `terrain.shapes[${s.i}]`;
    if (s.t === 'knot') return `lanes[${s.l}].knots[${s.k}]`;
    if (s.t === 'prop') return `props[${s.k}]`;
    if (s.t === 'scatter') return `scatter[${s.k}]`;
    return '';
  }
  const short = (m, n) => (m.length > n ? m.slice(0, n - 1) + '\u2026' : m);
  // markFinding draws a finding on its object (where it is now) and its mirror twin: a ring and the rule's reason
  function markFinding(v, f) {
    const pl = placesOf(f);
    if (!pl) return false;
    const sp = selPathStr(), on = f === S.hoverFinding || f === F.jumped || (!!sp && !!f.path && (f.path === sp || f.path.startsWith(sp + '.')));
    const col = f.severity === 'warning' ? '#f2b84b' : '#ff6b6b', g = v.overlay;
    for (const q of pl) {
      const s = v.project(q.p), reason = short(f.message || '', on ? 160 : q.twin ? 44 : 64);
      const lines = [{ t: (f.severity === 'warning' ? '\u26A0 ' : '\u2716 ') + f.rule + (q.twin ? ' (mirror twin)' : ''), c: col }, reason];
      (F.markLog[v.id] = F.markLog[v.id] || []).push({ rule: f.rule, severity: f.severity, p: q.p, twin: q.twin, on, shown: !!s, text: lines.map(txt).join(' | ') });
      if (!s) continue;
      g.save();
      g.strokeStyle = col;
      g.lineWidth = (on ? 3 : 2) * dpr;
      if (q.twin) { g.globalAlpha = 0.7; g.setLineDash([4 * dpr, 3 * dpr]); }
      g.beginPath(); g.arc(s[0], s[1], (on ? 14 : 10) * dpr, 0, 2 * Math.PI); g.stroke();
      g.restore();
      const at = Math.round(s[0] / (6 * dpr)) + ',' + Math.round(s[1] / (6 * dpr)), n = (F.stack[v.id] && F.stack[v.id].get(at)) || 0;
      if (F.stack[v.id]) F.stack[v.id].set(at, n + 1);
      tag(v, s, lines, 13, -10 + n * 34);
    }
    return true;
  }
  // jumpFinding (a click on a finding in the Map Check window): select what it names, show it in the view shown
  function jumpFinding(f) {
    selectPath(f.path || '');
    const pl = placesOf(f), p = pl ? pl[0].p : isPt(f.at) ? f.at : null;
    if (!S.sel && p) { // a derived object (an "auto" Binding or Core) at the finding's place
      const o = objects().map(x => ({ x, d: dist(x.pos, p) })).sort((a, b) => a.d - b.d)[0];
      if (o && o.d < 3) select(objSel(o.x));
    }
    F.jumped = f;
    if (ED.view === '2d') {
      if (p) {
        S.view.x = p[0]; S.view.y = p[1];
        S.view.scale = Math.max(S.view.scale, Math.min(cv.width, cv.height) / 160); // at least 160 m across
        S.fitted = false;
      }
      render();
    } else if (typeof V3D !== 'undefined') {
      const t = S.sel && S.sel.t;
      if (t && ['shape', 'vertex', 'radius', 'scatter', 'lane'].includes(t)) V3D.frameSel();
      else if (p) { V3D.V.cam.dist = Math.min(V3D.V.cam.dist, 90); V3D.setTarget(p[0], p[1]); }
      render();
    }
    return true;
  }

  Object.assign(ED, { snapAt, snapDrag, dragStart, dragCheck, dragEnd, pressed, refusePlace, refuseShapes, refuseCorner, refuseClose, markFinding, jumpFinding, measureText });

  // T6: the self-test's and the poses' mouse and keys at world points through the shown view (whole CSS pixels, as
  // a mouse gives them)
  const T6 = (() => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
    const checked = async () => { await sleep(300); return until(() => !$('checkState').classList.contains('busy'), 30000); };
    const client = w => {
      if (ED.view === '2d') { const b = cv.getBoundingClientRect(), s = w2s(w); return { clientX: Math.round(b.left + s[0] / dpr), clientY: Math.round(b.top + s[1] / dpr) }; }
      const c = V3D.V.canvas, b = c.getBoundingClientRect(), s = V3D.project(w);
      return s ? { clientX: Math.round(b.left + s[0] * b.width / c.width), clientY: Math.round(b.top + s[1] * b.height / c.height) } : { clientX: 0, clientY: 0 };
    };
    const down = (w, o) => {
      const c = Object.assign({ bubbles: true, cancelable: true, button: 0, buttons: 1 }, client(w), o || {});
      if (ED.view === '2d') cv.dispatchEvent(new MouseEvent('mousedown', c));
      else V3D.V.canvas.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1 }, c)));
    };
    const move = (w, o) => window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 1 }, client(w), o || {})));
    const hover = (w, o) => window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 0 }, client(w), o || {})));
    const up = (w, o) => window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ bubbles: true, button: 0 }, client(w), o || {})));
    const click = (w, o) => { down(w, o); up(w, o); };
    // a drag: the press without Ctrl (Ctrl + click is the doodads' selection), the moves with the modifiers o
    const drag = (a, b, o, steps) => { down(a, Object.assign({}, o || {}, { ctrlKey: false })); const n = steps || 4; for (let k = 1; k <= n; k++) move([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], o); };
    // keys go to the page's body, as a key with nothing focused does (the window's capture sees it first)
    const key = (k, o) => document.body.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
    const type = s => { for (const ch of s) key(ch); };
    const zoom = (c, ppm) => { S.view = { x: c[0], y: c[1], scale: ppm * dpr }; S.fitted = false; render(); };
    return { sleep, until, checked, client, down, move, hover, up, click, drag, key, type, zoom };
  })();

  // ---- the self-test (?selftest=feedback, CM_Ring) ------------------------------------------------------------------
  async function selftest() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
    const { sleep, until, checked, down, move, hover, up, click, drag, key, type, zoom } = T6;
    let ok = true;
    ok &= say(await until(() => S.doc && S.preview && S.report && objects().length && typeof RL !== 'undefined', 30000), `CM_Ring open with its objects (${S.pkg})`);
    const doc0 = snapshot();
    ED.setView('2d');
    setTool('select');
    select(null);
    const near2 = (a, b, tol) => isPt(a) && isPt(b) && dist(a, b) <= tol;
    const CTRL = { ctrlKey: true }, px = 0.25 + 1e-9; // 4 pixels a metre: a whole pixel is 0.25 m
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const L0 = () => lanes()[0], knot = k => L0().knots[k];
    const errs0 = $('log').children.length, lastLog = () => ($('log').firstChild || {}).textContent || '';

    // -- measurements (2-D) --
    const K = knot(2).slice();
    zoom(K, 4);
    drag(K, [K[0] + 6, K[1] + 8]);
    const lenNow = polyLen(L0().knots), mt = measureText();
    const mLen = /lane 1: ([\d.]+) m/.exec(mt);
    ok &= say(S.drag && S.drag.moved && mLen && Math.abs(+mLen[1] - lenNow) < 0.051 && /width 24 m/.test(mt) && /knot 3: legs [\d.]+ \/ [\d.]+ m/.test(mt),
      `a knot's drag measures the lane: "${mt}" (the knots' length ${lenNow.toFixed(2)} m)`);
    ok &= say($('st3').textContent.includes('lane 1:') && F.tags['2d'] && F.tags['2d'].join(' ').includes('lane 1:'), `in the status bar and at the cursor: "${$('st3').textContent}"`);
    up([K[0] + 6, K[1] + 8]);
    undo();
    ok &= say(near2(knot(2), K, 1e-9), 'undone');
    await checked();
    const bind = () => objects().filter(o => o.kind === 'binding' && o.lane === 1);
    const B0 = bind().find(o => o.tier === 0), B0p = B0.pos.slice();
    zoom(B0p, 4);
    drag(B0p, [B0p[0] + 2, B0p[1] + 3], CTRL);
    const bv = getAt(S.doc, ['base', 'bindings', '1', 0]), mid = getAt(S.doc, ['base', 'bindings', '1', 1]), mb = measureText();
    const toMid = /to Middle ([\d.]+) m/.exec(mb), cen = /centre ([\d.]+) m/.exec(mb), enemy = /nearest enemy Binding ([\d.]+) m/.exec(mb);
    const enemyD = Math.min(...objects().filter(o => o.kind === 'binding').map(o => dist(bv, mir(o.pos))));
    ok &= say(isPt(bv) && toMid && Math.abs(+toMid[1] - dist(bv, mid)) < 0.051 && cen && Math.abs(+cen[1] - Math.hypot(bv[0], bv[1])) < 0.051 && enemy && Math.abs(+enemy[1] - enemyD) < 0.051,
      `a Binding's drag: the tower spacing and the centre: "${mb}"`);
    up([B0p[0] + 2, B0p[1] + 3], CTRL);
    undo();
    ok &= say(S.doc.base.bindings === 'auto', 'undone: the Bindings "auto" again');
    select({ t: 'knot', l: 0, k: 2 });
    const hd = laneWidthHandle();
    drag(hd.pos, [hd.pos[0] + hd.n[0] * 3, hd.pos[1] + hd.n[1] * 3]);
    ok &= say(/the lanes' width ([\d.]+) m/.test(measureText()) && measureText().includes(`${L0().width} m`) && L0().width > 24, `the width handle: "${measureText()}"`);
    up(hd.pos);
    undo();
    select(null);
    setCliff('wall'); setDraw('brush');
    zoom([-100, -80], 4);
    hover([-100, -80]);
    const mbr = measure().map(txt).join(' | ');
    ok &= say(/^Brush 8 m \u00B7 wall/.test(mbr) && F.tags['2d'] && F.tags['2d'][0].startsWith('Brush 8 m'), `the brush's size at the cursor: "${mbr}"`);
    setCliff('open'); setDraw('circle');
    drag([-100, -80], [-93, -80], CTRL, 2);
    const rr = /radius ([\d.]+) m/.exec(measureText());
    ok &= say(S.drawing && rr && Math.abs(+rr[1] - 7) <= 0.3, `a circle being drawn: "${measureText()}"`);
    up([-93, -80], CTRL);
    undo();

    // -- snaps with labels (2-D): a polygon's corners --
    setDraw('polygon');
    const tolM = TOL * 0.25;
    zoom([-60, 60], 4);
    click([-70, 50]);
    const perp = [Math.SQRT1_2, Math.SQRT1_2];
    hover([-60 + perp[0] * 0.45 * tolM, 60 + perp[1] * 0.45 * tolM]);
    const mm = S.drawing && S.drawing.mouse;
    ok &= say(mm && Math.abs(mm[0] + mm[1]) < 1e-9 && F.snap && F.snap.label === 'Mirror line' && F.snaps['2d'] === 'Mirror line' && $('stSnap').textContent === 'Snap: Mirror line',
      `Mirror line: the corner on x + y = 0 (${mm}), labelled at the point and in the status bar`);
    hover([-60 + perp[0] * 0.45 * tolM, 60 + perp[1] * 0.45 * tolM], CTRL);
    ok &= say(!F.snap && S.drawing.mouse[0] + S.drawing.mouse[1] !== 0, `Ctrl: no snap for the move (${S.drawing.mouse})`);
    $('stSnap').click();
    hover([-60 + perp[0] * 0.45 * tolM, 60 + perp[1] * 0.45 * tolM]);
    ok &= say(!F.on && !F.snap && $('stSnap').textContent === 'Snap: off', 'the status bar\'s Snap part switches them off');
    $('stSnap').click();
    FR.openMenu('tools');
    const item = [...document.querySelectorAll('.it')].find(x => x.dataset.t === 'Smart Snaps');
    ok &= say(F.on && item && item.textContent.includes('Smart Snaps'), 'and on again; Tools > Smart Snaps');
    FR.closeMenus();
    S.drawing = null;
    // a lane's edge: lane 2's leg from (-100, -170) to (-30, -174), a quarter along, 12 m to its left
    const la = [-100, -170], lb = [-30, -174], ll = dist(la, lb), lu = [(lb[0] - la[0]) / ll, (lb[1] - la[1]) / ll], ln = [-lu[1], lu[0]];
    const E = [la[0] + lu[0] * ll / 4 + ln[0] * 12, la[1] + lu[1] * ll / 4 + ln[1] * 12];
    zoom(E, 4);
    click([-90, -148]);
    hover([E[0] + ln[0] * 0.45 * tolM, E[1] + ln[1] * 0.45 * tolM]);
    const em = S.drawing.mouse, ed = Math.abs((em[0] - la[0]) * ln[0] + (em[1] - la[1]) * ln[1]);
    ok &= say(F.snap && F.snap.label === 'Lane edge' && Math.abs(ed - 12) < 0.08 && F.snaps['2d'] === 'Lane edge', `Lane edge: the corner ${m1(ed)} m from lane 2's line (half its 24 m), labelled`);
    const M = [(la[0] + lb[0]) / 2, (la[1] + lb[1]) / 2];
    hover([M[0] + 0.5, M[1] + 0.4]);
    ok &= say(F.snap && F.snap.label === 'Midpoint' && near2(S.drawing.mouse, M, 1e-9) && F.snaps['2d'] === 'Midpoint', `Midpoint: the leg's middle ${S.drawing.mouse}`);
    S.drawing = null;
    zoom([-120, -70], 4);
    click([-130, -78]);
    S.show.grid = true;
    hover([-120 + 0.8, -70]);
    ok &= say(F.snap && F.snap.label === 'Grid' && S.drawing.mouse[0] === -120 && F.snaps['2d'] === 'Grid', `Grid (shown): on its 20-m line ${S.drawing.mouse}`);
    S.show.grid = false;
    hover([-119.4, -70.4], { shiftKey: true });
    ok &= say(F.snap && F.snap.label === 'Grid 1 m' && S.drawing.mouse[0] === -119 && S.drawing.mouse[1] === -70, `Shift: Grid 1 m ${S.drawing.mouse}`);
    S.drawing = null;
    // a drag snaps the point it moves: a corner onto the mirror line, the shape's other corners unmoved
    const Q = [[-50, 10], [-30, 10], [-30, 25], [-50, 25]];
    zoom([-40, 18], 4);
    for (const q of Q) click(q, CTRL);
    key('Enter');
    const qi = shapes().length - 1;
    ok &= say(shapes()[qi] && Array.isArray(shapes()[qi].polygon) && shapes()[qi].polygon.length === 4, 'a square drawn by four clicks and Enter');
    edit(() => { shapes()[qi].polygon = Q.map(q => q.slice()); });
    setTool('select');
    select({ t: 'shape', i: qi });
    drag([-30, 25], [-26.6, 27.5], {}, 3);
    const qv = shapes()[qi].polygon[2];
    ok &= say(S.drag && S.drag.snap && S.drag.snap.label === 'Mirror line' && Math.abs(qv[0] + qv[1]) < 1e-9 && JSON.stringify(shapes()[qi].polygon.slice(0, 2)) === JSON.stringify(Q.slice(0, 2)),
      `a dragged corner snaps onto the mirror line (${qv}), the others stay`);
    up([-26.6, 27.5]);

    // -- refused: a self-crossing polygon (the square's corner across its far edge), while drawing too --
    select({ t: 'shape', i: qi });
    drag([-50, 25], [-20, 25], CTRL, 6);
    const qr = S.drag && S.drag.refused, q3 = shapes()[qi].polygon[3];
    ok &= say(qr && qr.rule === 'polygon' && !selfCross(shapes()[qi].polygon) && qr.ghost && qr.ghost.shape && selfCross(qr.ghost.shape.polygon),
      `a corner dragged across the far edge: refused (${qr && qr.why}), the corner at ${q3}, the ghost crossing`);
    render();
    ok &= say(F.tags['2d'] && F.tags['2d'].some(t => t.startsWith('refused: the polygon would cross itself')), 'the reason at the cursor');
    up([-20, 25], CTRL);
    ok &= say(!selfCross(shapes()[qi].polygon) && /refused: the polygon would cross itself/.test(lastLog()), 'let go: the last good corner kept, the refusal in Messages');
    setCliff('open'); setDraw('polygon');
    zoom([-100, -88], 4);
    for (const q of [[-110, -90], [-90, -90], [-90, -70]]) click(q, CTRL);
    click([-100, -95], CTRL);
    ok &= say(S.drawing && S.drawing.pts.length === 3 && /cross itself/.test(lastLog()), `a corner whose edge crosses the drawing: refused (${S.drawing && S.drawing.pts.length} corners)`);
    S.drawing = null;
    const nSh = shapes().length;
    for (const q of [[-100, -85], [-105, -90], [-95, -90], [-100, -95]]) click(q, CTRL);
    key('Enter');
    ok &= say(S.drawing && shapes().length === nSh && /closing edge/.test(lastLog()), 'a polygon whose closing edge crosses it: not ended, nothing added');
    S.drawing = null;

    // -- typed values (2-D) --
    setTool('select');
    zoom(K, 4);
    const u0 = S.undo.length;
    drag(K, [K[0] + 4, K[1] + 3], CTRL, 2);
    type('12');
    ok &= say(F.typed === '12' && F.tags && measureText().includes('typed: 12'), `typing during a drag: "${measureText()}"`);
    key('Enter');
    const kt = knot(2).slice(), dk = [kt[0] - K[0], kt[1] - K[1]];
    move([K[0] - 6, K[1] - 10], CTRL);
    up([K[0] - 6, K[1] - 10], CTRL);
    const L = lanes(), part = L[1].knots[L[1].knots.length - 1 - 2];
    ok &= say(Math.abs(Math.hypot(dk[0], dk[1]) - 12) < 0.08 && Math.abs(dk[0] / 12 - 0.8) < 0.06 && !S.drag && near2(knot(2), kt, 0) && near2(part, mir(kt), 1e-9) && S.undo.length === u0 + 1,
      `12 Enter: the knot exactly 12 m along the drag (${kt}), the drag ended there, its mirror partner follows, one undo step`);
    type('-150,-20'); key('Enter');
    ok &= say(near2(knot(2), [-150, -20], 1e-9) && S.undo.length === u0 + 2, `right after the drag, x,y Enter: the knot at ${knot(2)}`);
    undo();
    ok &= say(near2(knot(2), kt, 1e-9), 'undone: back to the typed 12 m');
    undo();
    ok &= say(near2(knot(2), K, 1e-9), 'undone again: where it began');
    // a radius, the lanes' width, a circle, a polygon's legs, the brush
    select({ t: 'shape', i: 4 });
    zoom([-40, -130], 4);
    drag([-34, -130], [-31, -130], CTRL, 2);
    type('15'); key('Enter');
    up([-31, -130]);
    ok &= say(shapes()[4].r === 15, `a circle's radius handle, 15 Enter: r ${shapes()[4].r}`);
    undo();
    select({ t: 'knot', l: 0, k: 2 });
    zoom(K, 4);
    const hd2 = laneWidthHandle();
    drag(hd2.pos, [hd2.pos[0] + hd2.n[0], hd2.pos[1] + hd2.n[1]], CTRL, 2);
    type('30'); key('Enter');
    up(hd2.pos);
    ok &= say(lanes().every(l => l.width === 30), 'the width handle, 30 Enter: both lanes 30 m');
    undo();
    drag(hd2.pos, [hd2.pos[0] + hd2.n[0], hd2.pos[1] + hd2.n[1]], CTRL, 2);
    const wNow = L0().width;
    type('4'); key('Enter');
    ok &= say(L0().width === wNow && S.drag && /lanes\.width/.test(lastLog()), `4 Enter: refused (lanes.width), the width stays ${L0().width}`);
    up(hd2.pos);
    undo();
    select(null);
    setCliff('open'); setDraw('circle');
    zoom([-100, -80], 4);
    const nc = shapes().length;
    drag([-100, -80], [-104, -80], CTRL, 2);
    type('9'); key('Enter');
    up([-104, -80]);
    const cs = shapes()[shapes().length - 1];
    ok &= say(shapes().length === nc + 1 && cs.r === 9 && near2(cs.circle, [-100, -80], 0.2) && !S.drawing, `a circle being drawn, 9 Enter: r ${cs.r} at ${cs.circle}`);
    undo();
    setDraw('polygon');
    click([-110, -90], CTRL);
    hover([-107, -86], CTRL);
    type('20'); key('Enter');
    const p1 = S.drawing && S.drawing.pts[1], a0 = S.drawing && S.drawing.pts[0];
    ok &= say(p1 && Math.abs(dist(p1, a0) - 20) < 0.08 && Math.abs((p1[0] - a0[0]) / 20 - 0.6) < 0.06, `a polygon's leg, 20 Enter: the corner ${p1} 20 m on`);
    type('-120,-70'); key('Enter');
    ok &= say(S.drawing && near2(S.drawing.pts[2], [-120, -70], 1e-9), `x,y Enter: the next corner at ${S.drawing && S.drawing.pts[2]}`);
    S.drawing = null;
    setDraw('brush');
    type('12'); key('Enter');
    ok &= say(S.brush.size === 12, 'with the brush armed, 12 Enter: the brush 12 m');
    type('99'); key('Enter');
    ok &= say(S.brush.size === 12 && /1 to 60 m/.test(lastLog()), '99 Enter: refused, the brush stays 12 m');
    type('12'); key('Backspace');
    ok &= say(F.typed === '1', 'Backspace takes the last digit back');
    key('Escape');
    ok &= say(F.typed === '' && S.tool === 'shape', `Esc clears the number (the tool stays): "${F.typed}", ${S.tool}`);
    S.brush.size = 8;

    // -- refused: objects on blocked ground, team 2's half, a knot on its neighbour, the lanes below 6 m --
    setTool('select');
    const G = S.doc.base.guardian.slice();
    zoom([-142, -110], 4);
    drag(G, [-142, -70], CTRL, 18);
    const gNow = S.doc.base.guardian.slice(), gr = S.drag && S.drag.refused;
    ok &= say(gr && gr.rule === 'fixed.open' && gNow[1] < -89 && gNow[1] > -95 && kindOk(kindAt(terrain(), gNow), false) && near2(gr.ghost.pt, [-142, -70], 0.3),
      `the Guardian dragged into the wall: refused (${gr && gr.why}), it stays at ${gNow}, the red ghost at the mouse`);
    render();
    const gs = w2s([-142, -70]), gd = ctx.getImageData(Math.round(gs[0]) - 12, Math.round(gs[1]) - 12, 24, 24).data;
    let red = 0;
    for (let i = 0; i < gd.length; i += 4) if (gd[i] > 200 && gd[i + 1] < 130 && gd[i + 2] < 130) red++;
    ok &= say(red > 10, `the red ghost drawn in 2-D (${red} red pixels round it)`);
    up([-142, -70], CTRL);
    await checked();
    ok &= say(!(S.report.findings || []).some(f => f.rule === 'fixed.open' && f.path === 'base.guardian'), 'the check after: the Guardian on open ground');
    undo();
    ok &= say(near2(S.doc.base.guardian, G, 1e-9), 'undone');
    setTool('well');
    zoom([-140, 140], 4);
    const nw = S.doc.wells.length;
    click([-136, 142], CTRL);
    ok &= say(S.doc.wells.length === nw && /symmetry\.half/.test(lastLog()) && F.flash, '+ Well on team 2\'s half: refused (symmetry.half)');
    click([-142, 138], CTRL);
    ok &= say(S.doc.wells.length === nw + 1, '+ Well on the lane at (-142, 138): placed');
    setTool('select');
    drag([-142, 138], [-135, 145], CTRL, 7);
    const wp = S.doc.wells[nw].pos, wr = S.drag && S.drag.refused;
    ok &= say(wr && wr.rule === 'symmetry.half' && wp[0] + wp[1] <= 0, `dragged across the mirror line: refused (${wr && wr.why}), the well at ${wp}`);
    up([-135, 145], CTRL);
    undo(); undo();
    ok &= say(S.doc.wells.length === nw, 'undone');
    select({ t: 'knot', l: 0, k: 1 });
    const K1 = knot(1).slice();
    zoom([-170, -122], 4);
    drag(K1, [-170, -144.6], CTRL, 8);
    const kr = S.drag && S.drag.refused;
    ok &= say(kr && kr.rule === 'lanes.knots' && dist(knot(1), knot(0)) >= 1, `a knot onto its neighbour: refused (${kr && kr.why}), ${m1(dist(knot(1), knot(0)))} m apart`);
    up([-170, -144.6], CTRL);
    if (S.undo.length) undo();
    select({ t: 'knot', l: 0, k: 2 });
    zoom(K, 4);
    const hd3 = laneWidthHandle();
    drag(hd3.pos, hd3.at, CTRL, 4);
    const lr = S.drag && S.drag.refused;
    ok &= say(lr && lr.rule === 'lanes.width' && L0().width === LANE_MIN && S.drag.want < LANE_MIN, `the width handle dragged onto the lane: the lanes stay ${L0().width} m, refused below (${lr && lr.why})`);
    up(hd3.at, CTRL);
    undo();
    ok &= say(objFails(['base', 'shop'], [-219, -100], null).some(f => f.rule === 'size.bounds') && objFails(['base', 'guardian'], [-10, 5], null).some(f => f.rule === 'symmetry.base') && objFails(['camps', 0, 'pos'], [10, -5], null).some(f => f.rule === 'symmetry.half'),
      'the page\'s rules: past the edge (size.bounds), the Guardian out of the south-west (symmetry.base), team 2\'s half (symmetry.half)');
    // terrain edits that would wall an object in: a wall polygon round the well, a wall stroke over the Guardian, the
    // base's open circle moved off the Guardian
    select(null);
    setCliff('wall'); setDraw('polygon');
    zoom([-60, -130], 4);
    const n1 = shapes().length;
    for (const q of [[-70, -140], [-50, -140], [-50, -120]]) click(q, CTRL);
    hover([-70, -120], CTRL);
    const pr = pending();
    ok &= say(pr.bad && pr.bad.rule === 'fixed.open' && /well/.test(pr.bad.why), `a wall polygon being drawn round the well: red (${pr.bad && pr.bad.why})`);
    click([-70, -120], CTRL);
    key('Enter');
    ok &= say(shapes().length === n1 && /fixed\.open/.test(lastLog()), 'Enter: refused, nothing added');
    S.drawing = null;
    setDraw('brush');
    zoom([-142, -142], 4);
    drag([-150, -142], [-134, -142], {}, 6);
    up([-134, -142]);
    ok &= say(shapes().length === n1 && /Guardian/.test(lastLog()), 'a wall stroke over the Guardian: refused');
    setTool('select');
    select({ t: 'shape', i: 2 });
    zoom([-130, -130], 4);
    F.ms.length = 0;
    drag([-130, -130], [-50, -130], CTRL, 16);
    const sr = S.drag && S.drag.refused;
    ok &= say(sr && sr.rule === 'fixed.open' && sr.ghost && sr.ghost.shape && sr.ghost.shape.circle[0] > -75 && shapes()[2].circle[0] < -80 && /Guardian/.test(sr.why), `the base's open circle dragged off the Guardian: refused (${sr && sr.why}), the circle kept at ${shapes()[2].circle}, its ghost at ${sr && sr.ghost.shape.circle}`);
    const msS = F.ms.slice().sort((x, y) => x - y);
    say(true, `the rules of a shape's drag step: median ${(msS[msS.length >> 1] || 0).toFixed(2)} ms, max ${(msS[msS.length - 1] || 0).toFixed(2)} ms (${msS.length} steps; 0 under virtual time)`);
    up([-50, -130], CTRL);
    if (shapes()[2].circle[0] !== -150) undo();
    select(null);

    // -- soft findings marked on the object and its mirror twin --
    setTool('select');
    zoom([-180, -175], 4);
    drag([-204, -204], [-150, -142], CTRL, 20);
    up([-150, -142], CTRL);
    await checked();
    const shop = S.doc.base.shop.slice(), fh = (S.report.findings || []).find(f => f.path === 'base.shop');
    render();
    const ml = F.markLog['2d'] || [];
    const mk = ml.filter(m => fh && m.rule === fh.rule);
    ok &= say(fh && mk.length === 2 && near2(mk[0].p, shop, 1e-9) && near2(mk[1].p, mir(shop), 1e-9) && mk[1].twin && mk.every(m => m.text.includes(fh.message.slice(0, 20))),
      `the shop moved near the Guardian: ${fh && fh.rule} (${fh && fh.severity}) marked on it and on its mirror twin with the reason: ${mk.map(m => m.text).join(' / ')}`);
    select(null);
    setCliff('bush'); setDraw('polygon');
    zoom([-95, -55], 4);
    for (const q of [[-100, -60], [-90, -60], [-90, -50], [-100, -50]]) click(q, CTRL);
    key('Enter');
    const bi = shapes().length - 1;
    await checked();
    const fw = (S.report.findings || []).find(f => f.severity === 'warning' && f.path === `terrain.shapes[${bi}]`);
    render();
    const mw = (F.markLog['2d'] || []).filter(m => fw && m.rule === fw.rule && m.severity === 'warning');
    const bc = shapeCentre(shapes()[bi]);
    ok &= say(fw && mw.length === 2 && near2(mw[0].p, bc, 1e-9) && near2(mw[1].p, mir(bc), 1e-9), `a bush on the walls: the warning ${fw && fw.rule} marked on the bush and its twin: ${mw.map(m => m.text).join(' / ')}`);
    // a bush brushed (a drag of the Brush) and one drawn as a Path: each written as its outline, a polygon (a bush is a
    // circle or a polygon, terrain.shape), and the check finds no terrain.shape error on them
    const nb = shapes().length;
    setDraw('brush');
    zoom([-120, -85], 4);
    drag([-130, -80], [-110, -76], {}, 8);
    up([-110, -76]);
    setDraw('path');
    for (const q of [[-130, -95], [-115, -100]]) click(q, CTRL);
    key('Enter');
    const nbs = shapes().slice(nb);
    await checked();
    const bushErr = (S.report.findings || []).filter(f => f.rule === 'terrain.shape' && f.path && f.path.startsWith('terrain.shapes['));
    ok &= say(nbs.length === 2 && nbs.every(s => s.type === 'bush' && Array.isArray(s.polygon) && s.polygon.length >= 3 && !s.path && s.width === undefined) && !bushErr.length,
      `a bush brushed and one drawn as a path: ${nbs.map(s => s.type + ' ' + (s.polygon ? s.polygon.length + ' corners' : JSON.stringify(s).slice(0, 60))).join(', ')}; terrain.shape errors ${bushErr.length}`);
    for (let k = 0; k < 4 && shapes().length > nb; k++) undo();
    setTool('select');
    zoom(shop, 4);
    drag(shop, [shop[0] + 1, shop[1] - 2], CTRL, 2);
    const shopNow = S.doc.base.shop.slice();
    render();
    const mlive = (F.markLog['2d'] || []).filter(m => fh && m.rule === fh.rule);
    ok &= say(mlive.length === 2 && near2(mlive[0].p, shopNow, 1e-9) && near2(mlive[1].p, mir(shopNow), 1e-9) && !near2(shopNow, shop, 0.5), 'the marks follow the shop while it is dragged, before the check');
    up([shop[0] + 1, shop[1] - 2], CTRL);
    undo();
    await checked();

    // -- the Map Check window jumps to the object in the view shown --
    ED.openWindow('check');
    renderFindings();
    S.view = { x: 150, y: 150, scale: 0.5 * dpr }; S.fitted = false; render();
    const row = document.querySelector('#findings .f[data-path="base.shop"]');
    if (row) row.click();
    const fj = (S.report.findings || []).find(f => f.path === 'base.shop');
    ok &= say(row && S.sel && S.sel.t === 'obj' && pathStr(S.sel.path) === 'base.shop' && Math.abs(S.view.x - shop[0]) < 1e-6 && Math.abs(S.view.y - shop[1]) < 1e-6 && S.view.scale >= Math.min(cv.width, cv.height) / 160 - 1e-9 && F.jumped === fj,
      `2-D: a click on the shop's finding selects it and centres the view on it, zoomed in (${S.view.scale.toFixed(2)} px a metre)`);
    render();
    ok &= say((F.markLog['2d'] || []).some(m => m.on && near2(m.p, shop, 1e-9)), 'the finding it jumped to drawn highlighted');

    // -- 3-D: the jump, the marks, a knot's measurement and a typed value, a refusal, a snap's label --
    ED.setView('3d');
    const ready = typeof V3D !== 'undefined' && V3D.V.gl && await until(() => V3D.V.heights && !V3D.V.groundBusy && V3D.V.scene && V3D.V.snap, 60000);
    if (ready) {
      V3D.setTarget(120, 120);
      V3D.frame();
      const rowB = document.querySelector(`#findings .f[data-path="terrain.shapes[${bi}]"]`);
      if (rowB) rowB.click();
      V3D.frame();
      const c = V3D.V.cam;
      ok &= say(rowB && S.sel && S.sel.t === 'shape' && S.sel.i === bi && Math.hypot(c.tx - bc[0], c.ty - bc[1]) < 1 && c.dist <= 120, `3-D: a click on the bush's warning selects it and frames it (target ${m1(c.tx)}, ${m1(c.ty)}, ${m1(c.dist)} m)`);
      const rowS = document.querySelector('#findings .f[data-path="base.shop"]');
      if (rowS) rowS.click();
      V3D.frame();
      ok &= say(Math.hypot(c.tx - shop[0], c.ty - shop[1]) < 1e-6 && c.dist <= 90, `the shop's finding: the camera on the shop (${m1(c.tx)}, ${m1(c.ty)}, ${m1(c.dist)} m)`);
      const m3 = (F.markLog['3d'] || []).filter(m => fh && m.rule === fh.rule);
      ok &= say(m3.length === 2 && near2(m3[0].p, shop, 1e-9) && near2(m3[1].p, mir(shop), 1e-9) && m3[0].on, `3-D: the finding marked on the shop and its twin, highlighted: ${m3.map(m => m.text).join(' / ')}`);
      select(null);
      // a knot dragged in 3-D: the measurement, then 10 Enter
      V3D.V.cam.dist = 90;
      V3D.setTarget(K[0], K[1]);
      V3D.frame();
      drag(K, [K[0] + 4, K[1] + 3], {}, 3);
      V3D.frame();
      const m3t = measureText();
      ok &= say(S.drag && S.drag.moved && S.press === '3d' && /lane 1: [\d.]+ m/.test(m3t) && F.tags['3d'] && F.tags['3d'].join(' ').includes('lane 1:'), `3-D: a knot's drag measures the lane at the cursor: "${m3t}"`);
      type('10'); key('Enter');
      up([K[0] + 4, K[1] + 3]);
      ok &= say(Math.abs(dist(knot(2), K) - 10) < 0.08 && !S.drag, `3-D: 10 Enter: the knot 10 m from where it began (${knot(2)})`);
      undo();
      // the Guardian into the wall in 3-D
      V3D.setTarget(-142, -105);
      V3D.V.cam.dist = 110;
      V3D.frame();
      drag(G, [-142, -70], CTRL, 18);
      V3D.frame();
      const g3 = S.doc.base.guardian, gr3 = S.drag && S.drag.refused;
      ok &= say(gr3 && gr3.rule === 'fixed.open' && g3[1] < -88 && kindOk(kindAt(terrain(), g3), false), `3-D: the Guardian dragged into the wall: refused, it stays at ${g3}`);
      ok &= say(F.tags['3d'] && F.tags['3d'].some(t => t.startsWith('refused:')), `3-D: the reason at the cursor (${F.tags['3d'] && F.tags['3d'].join(' | ')})`);
      up([-142, -70], CTRL);
      undo();
      ok &= say(near2(S.doc.base.guardian, G, 1e-9), 'undone');
      // a corner on the mirror line in 3-D, labelled
      setCliff('open'); setDraw('polygon');
      V3D.setTarget(-60, 60);
      V3D.V.cam.dist = 80;
      V3D.frame();
      click([-70, 50]);
      const pk = V3D.pickAt(V3D.V.canvas.width / 2, V3D.V.canvas.height / 2), tol3 = TOL * (pk ? pk.near : 0.25);
      hover([-60 + perp[0] * 0.4 * tol3, 60 + perp[1] * 0.4 * tol3]);
      V3D.frame();
      const m3m = S.drawing && S.drawing.mouse;
      ok &= say(m3m && Math.abs(m3m[0] + m3m[1]) < 1e-9 && F.snap && F.snap.label === 'Mirror line' && F.snaps['3d'] === 'Mirror line', `3-D: the corner snaps onto the mirror line (${m3m}), labelled on the 3-D overlay`);
      S.drawing = null;
      setTool('select');
    } else ok &= say(true, 'the 3-D view: skipped (no WebGL)');
    ED.setView('2d');

    // back to the map as it was opened; nothing saved
    S.doc = JSON.parse(doc0);
    S.undo = []; S.redo = [];
    select(null);
    setTool('select');
    changed();
    await checked();
    ok &= say(snapshot() === doc0 && !updateDirty(), 'the map as it was opened (nothing saved)');
    ok &= say($('log').children.length > errs0, `Messages: ${$('log').children.length - errs0} lines (the refusals among them)`);
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.feedback = selftest;

  // ?pose6=<name> (CM_Ring): the page left mid-edit for a picture: measure, snap, refused, typed, marks; with _3d in the
  // 3-D view (measure_3d, refused_3d, marks_3d)
  const POSE6 = new URLSearchParams(location.search).get('pose6');
  async function pose6() {
    if (!POSE6 || !S.doc) return;
    const { until, checked, down, move, hover, up, click, drag, type, zoom } = T6;
    if (!await until(() => S.preview && S.report && objects().length && typeof RL !== 'undefined', 30000)) return;
    const three = POSE6.endsWith('_3d'), what = POSE6.replace(/_3d$/, ''), CTRL = { ctrlKey: true };
    const look = (at, d, yaw) => {
      if (!three) return zoom(at, 900 / d);
      V3D.V.cam.yaw = yaw || 0;
      V3D.V.cam.dist = d;
      V3D.setTarget(at[0], at[1]);
      V3D.frame();
    };
    if (three) {
      ED.setView('3d');
      if (!await until(() => V3D.V.heights && !V3D.V.groundBusy && V3D.V.scene && V3D.V.snap, 120000)) return;
    }
    setTool('select');
    if (what === 'measure') {
      const B = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 1);
      if (!B) return;
      look(B.pos, three ? 90 : 220);
      drag(B.pos, [B.pos[0] + 3, B.pos[1] + 9], CTRL, 4);
    } else if (what === 'snap') {
      setCliff('open'); setDraw('polygon');
      look([-80, -160], 160);
      click([-92, -146], CTRL);
      click([-74, -144], CTRL);
      hover([-66.1, -159.6]);
    } else if (what === 'refused') {
      look([-142, -112], three ? 110 : 200, 0);
      drag(S.doc.base.guardian.slice(), [-142, -76], CTRL, 16);
    } else if (what === 'typed') {
      const K = lanes()[0].knots[2].slice();
      look(K, 200);
      select({ t: 'knot', l: 0, k: 2 });
      drag(K, [K[0] + 4, K[1] + 3], CTRL, 3);
      type('12');
    } else if (what === 'marks') {
      look([-170, -165], three ? 120 : 260, 0);
      drag(S.doc.base.shop.slice(), [-150, -142], CTRL, 20);
      up([-150, -142], CTRL);
      await checked();
      ED.openWindow('check');
      const row = document.querySelector('#findings .f[data-path="base.shop"]');
      if (row) row.click();
      if (three) { V3D.V.cam.dist = 120; V3D.V.cam.yaw = 0; V3D.setTarget(-150, -142); }
    }
    if (three) V3D.frame(); else render();
  }
  ED.on('started', pose6);

  return { F, toggle, snapAt, snapDrag, objFails, knotFails, selfCross, kindAt, placesOf, measure, measureText, pending };
})();

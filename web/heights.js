// Heights as a 3-D transform (EDUX9): a wall shape's plateau height and a chasm shape's depth (map.json's
// terrain.shapes[k].height: 1 to 40 m for a wall, -40 to -1 m for a chasm; none: 5 m up or down). Walkable ground has
// none: it stays the flat floor at z 0 the characters stand on.
// - The Terrain tab's Apply Height: the selected wall's or chasm's height field (the group shows only while one is
//   selected: EDUX11).
// - The selection's info: the same field (HT.field), under the shape's type; a type change keeps a height only where it
//   fits (HT.fitType).
// - The 3-D view: a vertical handle over the selected wall's or chasm's middle, at its height (a stem from the floor);
//   dragging it up or down sets the height (half metres; Shift or Tools > Snap: metres), one undo step; the live ground
//   preview (relief.js) follows during the drag, the compiler's ground after.
// - The check's terrain.height-hide and terrain.height-void findings show under the field of the shape they name.
// The self-test height3d drags a wall's height and a chasm's depth in 3-D, compares the live ground with the
// compiler's mesh, then sets the same heights in 2-D and gets the same map.json.
'use strict';

const HT = (() => {
  const P = () => RL.RELIEF;
  const fits = sh => sh && (sh.type === 'wall' || sh.type === 'chasm');
  // the shape's height as the compiler reads it: its own, or the kind's default
  const heightOf = sh => typeof sh.height === 'number' ? sh.height : sh.type === 'chasm' ? -P().plateau : P().plateau;
  // clamp to the kind's range (a chasm's typed as a positive depth is taken as below the floor), rounded to step metres
  function clampFor(sh, v, step) {
    if (!isFinite(v)) return undefined;
    let a = Math.abs(v);
    if (step) a = Math.round(a / step) * step;
    a = Math.min(P().maxHeight, Math.max(P().minHeight, a));
    return sh.type === 'chasm' ? -a : a;
  }
  // fitType: after a type change, a height only on a wall or a chasm, with the kind's sign
  function fitType(sh) {
    if (!sh || sh.height === undefined) return;
    if (!fits(sh)) delete sh.height;
    else sh.height = clampFor(sh, sh.height);
  }
  // the selected wall or chasm shape: its index, or -1
  function selected() {
    const s = S.sel;
    if (!S.doc || !s || !['shape', 'vertex', 'radius'].includes(s.t)) return -1;
    const sh = shapes()[s.i];
    return sh && sh.lane === undefined && fits(sh) ? s.i : -1;
  }
  // findings: the check's height findings that name the shape i
  const findingsOf = i => ((S.report && S.report.findings) || []).filter(f => /^terrain\.height/.test(f.rule) && (f.path === `terrain.shapes[${i}]` || f.path === `terrain.shapes[${i}].height`));
  // field: the shape's height field (with its findings), or null for a kind without one
  function field(sh, i) {
    if (!fits(sh)) return null;
    const chasm = sh.type === 'chasm', def = chasm ? -P().plateau : P().plateau;
    const input = h('input', { type: 'number', step: '0.5', min: chasm ? -P().maxHeight : P().minHeight, max: chasm ? -P().minHeight : P().maxHeight,
      placeholder: String(def), value: typeof sh.height === 'number' ? sh.height : '', 'data-height': i,
      onchange: ev => edit(() => {
        const t = String(ev.target.value).trim(), v = t === '' ? undefined : clampFor(sh, +t, 0.5);
        if (v === undefined) delete sh.height; else sh.height = v;
      }) });
    const wrap = h('div', { class: 'hfield' }, h('label', { title: chasm ? `The chasm's depth: ${-P().maxHeight} to ${-P().minHeight} m (empty: ${def} m). Walkable ground stays at 0.` : `The plateau's height: ${P().minHeight} to ${P().maxHeight} m (empty: ${def} m). Walkable ground stays at 0.` },
      chasm ? 'depth (m) ' : 'height (m) ', input),
    h('div', { class: 'small' }, `${chasm ? 'below' : 'above'} the floor; empty: ${def} m. In 3-D drag the handle over its middle.`));
    for (const f of findingsOf(i)) wrap.append(h('div', { class: 'small warn', 'data-rule': f.rule }, '⚠ ' + f.message));
    return wrap;
  }

  // ---- Terrain > Apply Height ---------------------------------------------------------------------------------
  const body = ED.addPane('terrain', 'Apply Height', 20);
  function renderPane() {
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    body.textContent = '';
    const i = selected();
    body.parentNode.hidden = i < 0; // EDUX11: shown only while a wall or chasm shape is selected (hidden, not greyed)
    body.parentNode.classList.toggle('armed', i >= 0);
    if (i < 0) return;
    body.append(h('div', { class: 'note' }, 'The selected Wall\'s plateau or Chasm\'s depth: type it here or in its info, or in 3-D drag the handle over its middle up or down. Walkable ground stays level at 0 m, where the characters stand.'));
    const sh = shapes()[i];
    body.append(h('div', { class: 'small' }, `terrain.shapes[${i}]: ${sh.type}, ${heightOf(sh)} m`), field(sh, i));
  }
  for (const ev of ['open', 'doc', 'select', 'checked', 'tool']) ED.on(ev, renderPane);

  // ---- the 3-D handle -----------------------------------------------------------------------------------------
  // handle: the selected wall's or chasm's handle {i, base, pos} (at its middle; pos at its height) in the 3-D view
  function handle(v) {
    if (!v || !v.drape) return null;
    const i = selected();
    if (i < 0) return null;
    const sh = shapes()[i], c = shapeCentre(sh);
    if (!c) return null;
    return { i, c, pos: [c[0], c[1], heightOf(sh)] };
  }
  ED.marks.push(function heightMarks(v) {
    const hd = handle(v), g = v.overlay;
    if (!hd) return;
    const a = v.project([hd.c[0], hd.c[1], 0]), b = v.project(hd.pos);
    if (!a || !b) return;
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2 * dpr;
    g.setLineDash([4 * dpr, 3 * dpr]);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); // the stem from the floor
    g.setLineDash([]);
    const on = DRAG && DRAG.i === hd.i, up = hd.pos[2] >= 0;
    g.fillStyle = on ? '#58a6ff' : '#fff';
    g.beginPath(); // a triangle pointing up (a wall) or down (a chasm)
    const s = 7 * dpr;
    g.moveTo(b[0], b[1] + (up ? -s : s)); g.lineTo(b[0] - s, b[1] + (up ? s * 0.6 : -s * 0.6)); g.lineTo(b[0] + s, b[1] + (up ? s * 0.6 : -s * 0.6)); g.closePath();
    g.fill();
    g.font = `${11 * dpr}px sans-serif`;
    g.fillText(`${hd.pos[2]} m`, b[0] + 10 * dpr, b[1] + 4 * dpr);
    g.restore();
  });
  ED.hitFirst.unshift(function heightHit(sx, sy, w, near, pk) {
    const v = pk && ED.views[pk.view], hd = handle(v);
    return hd && near(hd.pos, 9) ? { sel: { t: 'sheight', i: hd.i } } : null;
  });
  // zFor: the height whose point over c shows at the screen row sy (the view's projection; bisection)
  function zFor(v, c, sy) {
    let lo = -P().maxHeight - 5, hi = P().maxHeight + 5;
    const at = z => { const s = v.project([c[0], c[1], z]); return s ? s[1] : NaN; };
    if (!(at(lo) > at(hi))) return null; // the view doesn't see the vertical as up
    if (sy >= at(lo)) return lo;
    if (sy <= at(hi)) return hi;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (at(m) > sy) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  let DRAG = null;
  ED.down.unshift(function heightDown(hh, e, w, pk) {
    if (!hh || hh.sel.t !== 'sheight') return false;
    const v = ED.views[pk.view], hd = handle(v);
    if (!hd || !v.xy) return false;
    const sh = shapes()[hd.i], s0 = v.project(hd.pos), z0 = heightOf(sh);
    DRAG = { i: hd.i, v, c: hd.c, off: pk.sy - s0[1], undo: false, before: sh.height };
    S.grab = {
      move(w2, e2) {
        const sy = v.xy(e2)[1] - DRAG.off, z = zFor(v, DRAG.c, sy);
        if (z === null) return;
        const nz = clampFor(sh, z, (e2 && e2.shiftKey) || S.snap ? 1 : 0.5);
        if (nz === heightOf(sh) && (sh.height !== undefined || nz !== z0)) return;
        if (!DRAG.undo) { pushUndo(); DRAG.undo = true; }
        sh.height = nz;
        changed(true); // the live ground follows (relief.js), the check after the release
      },
      up() {
        const d = DRAG;
        DRAG = null;
        if (d && d.undo) scheduleCheck();
        render();
      },
    };
    return true;
  });

  // ---- the self-test ------------------------------------------------------------------------------------------
  // height3d (CM_Marsh): a wall polygon and a chasm polygon drawn on open ground; the wall's handle dragged to about
  // 12 m and the chasm's to about -15 m in 3-D (the live ground follows during the drag); after the check the live
  // heights equal the compiler's mesh at every vertex the preview touched; the check warns terrain.height-hide for the
  // tall wall; then undone and the same two heights typed into the selection's info in 2-D: the same map.json.
  async function selftest() {
    const T = RL, o = T.out();
    let ok = true;
    ok &= o.say(await V3D.until(() => S.doc && S.preview, 60000), 'a map open: ' + S.pkg);
    ok &= o.say(await T.ready(300000), '3-D ready, the ground read by the live preview');
    let R0 = 12, [A, B] = T.openSpots(2, 12, 40);
    if (!A || !B) { R0 = 10; [A, B] = T.openSpots(2, 10, 35); }
    ok &= o.say(A && B, `two spots of open ground: (${A}), (${B})`);
    if (!A || !B) return o.finish('height3d', false);
    const doc0 = snapshot(), snap0 = S.snap, n0 = shapes().length;
    S.snap = false;
    select(null);
    const poly = (c, kind) => {
      setCliff(kind); setDraw('polygon');
      T.T3.look(c, 60);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(d => [d[0] * (R0 - 1), d[1] * (R0 - 1)]).map(d => [c[0] + d[0], c[1] + d[1]]);
      pts.forEach(p => T.T3.click(p));
      T.T3.dbl(pts[3]);
    };
    poly(A, 'wall');
    poly(B, 'chasm');
    setTool('select');
    ok &= o.say(shapes().length === n0 + 2 && shapes()[n0].type === 'wall' && shapes()[n0 + 1].type === 'chasm', 'drawn: a wall and a chasm polygon');
    ok &= o.say(await T.settleGround(), 'checked; the compiler\'s ground for them drawn');
    // drag a handle in 3-D to the height z (the mouse moved to where the handle at z shows)
    const dragTo = async (i, c, z, label) => {
      T.T3.look(c, 70);
      select({ t: 'shape', i });
      V3D.frame();
      const v = ED.views['3d'], hd = handle(v);
      const ink = hd ? T.T3.inked(v.project(hd.pos), 8) : 0;
      if (!hd) return o.say(false, label + ': no handle');
      const M0 = T.R.mesh, before = new Map();
      T.T3.down(hd.pos);
      const steps = [];
      for (let k = 1; k <= 10; k++) {
        const zz = hd.pos[2] + (z - hd.pos[2]) * k / 10, t0 = performance.now();
        T.T3.move([c[0], c[1], zz]);
        V3D.frame();
        steps.push(performance.now() - t0);
      }
      const mid = T.vtx(c), sh = shapes()[i];
      for (const b of (T.R.mesh && T.R.mesh.dirty) || []) for (let j = b.j0; j <= b.j1; j++) for (let q = b.i0; q <= b.i1; q++) before.set(j * (T.GRID + 1) + q, T.R.mesh.Zl[j * (T.GRID + 1) + q]);
      T.T3.up([c[0], c[1], z]);
      let r = o.say(sh.height !== undefined && Math.abs(sh.height - z) <= 1 && ink > 10 && mid && mid.live / sh.height > 0.75 && V3D.heightAt(c[0], c[1]) / sh.height > 0.75 && S.sel && S.sel.t === 'shape',
        `${label}: the handle (${ink} pixels) dragged to ${sh.height} m in 3-D; mid-drag the live ground at its middle ${mid && T.fmt(mid.live)} m (the compiler's mesh ${mid && T.fmt(mid.mesh)} m), heightAt ${T.fmt(V3D.heightAt(c[0], c[1]))} m; a drag step median ${T.fmt(T.med(steps))} ms, max ${T.fmt(Math.max(...steps))} ms; the shape still selected`);
      r &= o.say(await T.settleGround(), 'checked; the compiler\'s ground drawn');
      V3D.frame();
      let worst = 0, n = 0;
      for (const [g, zl] of before) { worst = Math.max(worst, Math.abs(zl - T.R.mesh.Z0[g])); n++; }
      r &= o.say(T.R.mesh !== M0 && n > 50 && worst < 0.05 && !T.R.mesh.dirty, `the live heights against the compiler's mesh over ${n} vertices the preview touched: worst ${worst.toFixed(4)} m; the new mesh needs no patch`);
      return r;
    };
    const iw = n0, ic = n0 + 1, undo0 = S.undo.length;
    ok &= await dragTo(iw, A, 12, 'the wall');
    ok &= o.say(S.undo.length === undo0 + 1, `one undo step for the drag (${S.undo.length - undo0})`);
    ok &= await dragTo(ic, B, -15, 'the chasm');
    const hide = (S.report.findings || []).filter(f => f.rule === 'terrain.height-hide');
    ok &= o.say(hide.some(f => f.path === `terrain.shapes[${iw}]`), `the check warns: ${hide.map(f => f.path + ' ' + f.message.slice(0, 60)).join('; ') || 'nothing'}`);
    select({ t: 'shape', i: iw });
    renderInspector();
    const warnEl = document.querySelector('#inspector [data-rule="terrain.height-hide"], .hfield [data-rule="terrain.height-hide"]');
    ok &= o.say(!!warnEl, 'the warning under the wall\'s height field');
    const hw = shapes()[iw].height, hc = shapes()[ic].height, doc3 = snapshot();
    // the same in 2-D: undone to the drawn shapes, the heights typed into the selection's info
    while (S.undo.length && shapes()[iw] && (shapes()[iw].height !== undefined || shapes()[ic].height !== undefined)) undo();
    ED.setView('2d');
    const typeIn = (i, v) => {
      select({ t: 'shape', i });
      renderInspector();
      const inp = document.querySelector(`input[data-height="${i}"]`);
      if (!inp) return false;
      inp.value = String(v);
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    ok &= o.say(typeIn(iw, hw) && typeIn(ic, hc), `typed in 2-D: ${hw} m and ${hc} m`);
    ok &= o.say(snapshot() === doc3, 'the same map.json as the 3-D drags');
    // an empty field gives the default back; a type change keeps a height only where it fits
    typeIn(iw, '');
    ok &= o.say(shapes()[iw].height === undefined, 'emptied: the wall back to the default');
    // back
    while (S.undo.length && snapshot() !== doc0) undo();
    ok &= o.say(snapshot() === doc0, 'undone: the document as it was');
    S.snap = snap0;
    setTool('select');
    o.finish('height3d', ok);
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.height3d = selftest;
  // ?pose9=<k> (with ?open=<map>&view=3d): terrain.shapes[k] selected and framed, its height handle shown, for a picture
  // (&tab=terrain shows Apply Height with its field)
  const POSE9 = new URLSearchParams(location.search).get('pose9');
  ED.on('started', async () => {
    if (POSE9 === null || !S.doc || !await RL.ready(300000)) return;
    const k = +POSE9, sh = shapes()[k], c = sh && shapeCentre(sh);
    if (!c) return;
    select({ t: 'shape', i: k });
    V3D.V.cam.yaw = 25;
    RL.T3.look([c[0], c[1] - 10], 90);
    V3D.frame();
  });

  return { field, fitType, handle, heightOf, clampFor, zFor };
})();

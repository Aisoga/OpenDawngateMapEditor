// Gameplay overlays (View > Gameplay Overlays): numbers that explain the map, drawn over both views and listed in the
// Gameplay Numbers window, computed in the page from the document and the last check's preview:
// - Binding Ranges: a ring of the Bindings' attack range round each Binding of both teams (from its edge);
// - Lane Lengths: each lane along its knots (as the check's laneLengths measures it), with marks every 100 m, its
//   length in metres and the time a minion and a shaper take to walk it;
// - Walk Times from the Base: the shortest walk from team 1's spawns to each Binding, the parasite, the camps, the wells
//   and the centre along the Player graph (the check's graph_player.png: its squares are where a shaper can walk),
//   drawn as the path and the time at the objective (team 2's are the mirror);
// - the comparison with SM_Map_v5, the game's own map: the same numbers measured once on it (SM below), shown as
//   "lane 1 12 % shorter than SM_Map_v5".
// The walking speeds and the range are the game's data (SPEED, RANGE: where each comes from is in the map editor's
// notes). The walk is a 16-neighbour Dijkstra over the graph's pixels (512 x 512; a diagonal or knight step only where
// both pixels it crosses are on the graph), so it is at most about 3 % longer than the straightest path; an objective's
// walk ends at the nearest reached pixel within REACH metres plus the straight rest (a Binding stands on its own
// footprint). A walk follows a moved spawn at once; the graph is the last check's.
//
// It uses app.js's globals (S, ED, objects, lanes, mir, vpoly, vring, vmark, vmpp, dpr, render, h, appendAll, TEAM,
// LANE, TIERS, isPt) and its hooks: ED.actions/ED.flags 'overlay.ranges', 'overlay.lanes', 'overlay.walk' (the View
// menu's toggles), 'overlay.numbers' (the window), ED.marks (the 3-D view's overlay), ED.on('render') (the 2-D view),
// ED.selftests.overlays.
'use strict';

const OV = (() => {
  // metres a second: a shaper without items or effects (the most common base speed of the game's shaper classes; they
  // range from 10.89 to 11.77) and a lane minion (melee and ranged alike)
  const SPEED = { shaper: 11.18, minion: 9.56 };
  // a Binding attacks a target whose edge lies within RANGE metres of its own edge (its footprint FOOT metres round its
  // centre), so the ring is drawn at RANGE + FOOT from the centre
  const RANGE = 28, FOOT = 2.76;
  const REACH = 12;
  const GRID = 512;
  // SM_Map_v5's numbers, measured once with these rules on its import (its team 1 markers and splines, the walkable
  // ground traced from its own line-of-sight map and Player graph; team 2 the mirror): metres
  // (the lanes base to base as the editor's lanes run: the game's own splines end at the enemy's spline head, 59 m
  // before the enemy's base end of the lane)
  const SM = {
    lanes: { 1: 595.09, 2: 595.09 },
    walk: {
      'own 1 Inner': 139.18, 'own 1 Middle': 213.99, 'own 1 Outer': 285.39, 'own 2 Inner': 139.26, 'own 2 Middle': 214.13,
      'own 2 Outer': 285.27, 'enemy 1 Outer': 402.83, 'enemy 1 Middle': 465.08, 'enemy 1 Inner': 539.71, 'enemy 2 Outer': 402.69,
      'enemy 2 Middle': 465.93, 'enemy 2 Inner': 540.54, parasite: 354.89, centre: 357.55,
    },
  };
  const on = { ranges: false, lanes: false, walk: false };
  const O = { graph: null, graphURL: '', loading: '', field: null, fieldKey: '', stats: {} };

  // ---- the numbers ----------------------------------------------------------------------------------------------
  const len = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
  const okLane = l => l && Array.isArray(l.knots) && l.knots.length >= 2 && l.knots.every(isPt);
  // the lanes of team 1 (map.json "lanes", live): {id, knots, length}
  const laneList = () => (S.doc ? lanes() : []).filter(okLane).map(l => ({ id: l.id, knots: l.knots, length: len(l.knots) }));
  const clock = s => (s < 60 ? Math.round(s) + ' s' : Math.floor(Math.round(s) / 60) + ':' + String(Math.round(s) % 60).padStart(2, '0'));
  const secs = (m, who) => m / SPEED[who || 'shaper'];
  // compare: "12 % longer than SM_Map_v5" (as long within half a per cent)
  function compare(v, sm, word) {
    if (!(sm > 0) || !(v >= 0)) return '';
    const p = (v - sm) / sm * 100;
    if (Math.abs(p) < 0.5) return 'as ' + (word === 'long' ? 'long' : 'far') + ' as on SM_Map_v5';
    return Math.round(Math.abs(p)) + ' % ' + (p > 0 ? (word === 'long' ? 'longer' : 'farther') : (word === 'long' ? 'shorter' : 'nearer')) + ' than SM_Map_v5';
  }
  function segDist(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
    return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]);
  }
  // the team 1 lane whose knots pass nearest p (an enemy Binding's lane as team 1 sees it)
  function nearestLane(p) {
    let best = Infinity, id = null;
    for (const l of laneList()) for (let i = 1; i < l.knots.length; i++) { const d = segDist(p, l.knots[i - 1], l.knots[i]); if (d < best) { best = d; id = l.id; } }
    return id;
  }
  // the objectives: {key, label, pos, kind}; key as SM's (own|enemy <lane> <tier>, parasite, centre)
  function objectives() {
    const out = [];
    for (const o of objects()) {
      if (o.kind === 'binding') {
        const t = o.tname || o.name.split(' ').pop(), e = mir(o.pos), el = nearestLane(e);
        out.push({ key: `own ${o.lane} ${t}`, label: `own ${t} Binding, lane ${o.lane}`, pos: o.pos, kind: 'binding', team: 1 });
        out.push({ key: `enemy ${el} ${t}`, label: `enemy ${t} Binding, lane ${el}`, pos: e, kind: 'binding', team: 2 });
      } else if (o.kind === 'camp' || o.kind === 'well') {
        const what = o.kind === 'well' ? o.name : /^parasite/.test(o.name) ? 'parasite' : /^buff/.test(o.name) ? 'buff camp' : 'camp';
        const noun = o.kind === 'camp' ? (o.name.split(' ')[1] || '').replace(/^SpawnPoint_(v5_)?|\.Noun$/gi, '') : '';
        const key = what === 'parasite' ? 'parasite' : '';
        out.push({ key, label: what + (noun && what !== 'parasite' ? ' ' + noun : ''), pos: o.pos, kind: o.kind, team: 1 });
        if (what !== 'parasite' && Math.hypot(o.pos[0], o.pos[1]) > 0.5) out.push({ key: '', label: 'enemy ' + what + (noun ? ' ' + noun : ''), pos: mir(o.pos), kind: o.kind, team: 2 });
      }
    }
    out.push({ key: 'centre', label: 'the centre', pos: [0, 0], kind: 'centre', team: 0 });
    return out;
  }
  // team 1's base: the spawns' mean (live)
  function base() {
    const sp = objects().filter(o => o.kind === 'spawn');
    if (!sp.length) return null;
    return [sp.reduce((a, o) => a + o.pos[0], 0) / sp.length, sp.reduce((a, o) => a + o.pos[1], 0) / sp.length];
  }

  // ---- the Player graph and the walk ------------------------------------------------------------------------------
  // loadGraph reads the last check's graph_player.png into O.graph (1 where a graph square covers the pixel)
  function loadGraph() {
    if (!S.images || !S.preview) return;
    const url = S.images + 'graph_player.png';
    if (O.graphURL === url || O.loading === url) return;
    O.loading = url;
    const img = new Image();
    img.onload = () => {
      if (O.loading !== url) return;
      const c = document.createElement('canvas');
      c.width = GRID; c.height = GRID;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, GRID, GRID).data, walk = new Uint8Array(GRID * GRID);
      for (let k = 0; k < GRID * GRID; k++) walk[k] = px[4 * k + 1] > px[4 * k] + 30 ? 1 : 0;
      Object.assign(O, { graph: walk, graphURL: url, graphSize: +S.preview.size, loading: '', field: null, fieldKey: '' });
      ED.emit('overlay-graph');
      redraw();
    };
    img.onerror = () => { if (O.loading === url) O.loading = ''; };
    img.src = url;
  }
  const centre = (size, k) => [((k % GRID + 0.5) / GRID - 0.5) * size, (0.5 - (Math.floor(k / GRID) + 0.5) / GRID) * size];
  const pixelOf = (size, p) => [Math.min(GRID - 1, Math.max(0, Math.floor((p[0] / size + 0.5) * GRID))), Math.min(GRID - 1, Math.max(0, Math.floor((0.5 - p[1] / size) * GRID)))];
  // the 16 steps: [dx, dy, the pixels it crosses]
  const STEPS = (() => {
    const out = [];
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const x = dx * sx, y = dy * sy;
      if (out.some(s => s[0] === x && s[1] === y)) continue;
      const cross = dx === 1 && dy === 1 ? [[sx, 0], [0, sy]] : dx === 2 ? [[sx, 0], [sx, sy]] : dy === 2 ? [[0, sy], [sx, sy]] : [];
      out.push([x, y, cross, Math.sqrt(x * x + y * y)]);
    }
    return out;
  })();
  // field: the walk in metres from the graph pixel nearest the point src to every pixel (Infinity: not reached), and
  // each pixel's predecessor
  function field(walk, size, src) {
    let s = -1, best = Infinity;
    for (let k = 0; k < GRID * GRID; k++) {
      if (!walk[k]) continue;
      const c = centre(size, k), d = (c[0] - src[0]) ** 2 + (c[1] - src[1]) ** 2;
      if (d < best) { best = d; s = k; }
    }
    const dist = new Float64Array(GRID * GRID).fill(Infinity), prev = new Int32Array(GRID * GRID).fill(-1);
    if (s < 0) return { dist, prev, src: -1 };
    const cs = size / GRID;
    // a binary heap of (distance, pixel)
    let hd = new Float64Array(1 << 16), hk = new Int32Array(1 << 16), n = 0;
    const push = (d, k) => {
      if (n === hd.length) { const a = new Float64Array(n * 2), b = new Int32Array(n * 2); a.set(hd); b.set(hk); hd = a; hk = b; }
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hd[i] = hd[p]; hk[i] = hk[p]; i = p; }
      hd[i] = d; hk[i] = k;
    };
    const pop = () => {
      const d = hd[0], k = hk[0], ld = hd[--n], lk = hk[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hd[c + 1] < hd[c]) c++;
        if (hd[c] >= ld) break;
        hd[i] = hd[c]; hk[i] = hk[c]; i = c;
      }
      hd[i] = ld; hk[i] = lk;
      return [d, k];
    };
    dist[s] = 0;
    push(0, s);
    while (n) {
      const [d, k] = pop();
      if (d > dist[k]) continue;
      const x = k % GRID, y = (k - x) / GRID;
      for (const [dx, dy, cross, w] of STEPS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || !walk[ny * GRID + nx]) continue;
        if (cross.some(c => !walk[(y + c[1]) * GRID + x + c[0]])) continue;
        const nd = d + cs * w, nk = ny * GRID + nx;
        if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nd, nk); }
      }
    }
    return { dist, prev, src: s };
  }
  // the field from team 1's base on the last check's graph (cached while the graph and the base pixel stay)
  function walkField() {
    if (!O.graph) { loadGraph(); return null; }
    if (S.images && O.graphURL !== S.images + 'graph_player.png') loadGraph();
    const b = base();
    if (!b) return null;
    const key = O.graphURL + '|' + pixelOf(O.graphSize, b).join(',') + '|' + b.map(v => v.toFixed(3)).join(',');
    if (O.fieldKey !== key) {
      const t0 = performance.now();
      O.field = field(O.graph, O.graphSize, b);
      O.fieldKey = key;
      O.fieldMs = performance.now() - t0;
    }
    return O.field;
  }
  // walkTo: {m, path} (metres from the base, the pixels' centres back to it) or null where no reached pixel lies
  // within REACH of p
  function walkTo(F, p) {
    const size = O.graphSize, cs = size / GRID, [cx, cy] = pixelOf(size, p), r = Math.ceil(REACH / cs) + 1;
    let best = Infinity, bk = -1;
    for (let y = Math.max(0, cy - r); y <= Math.min(GRID - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(GRID - 1, cx + r); x++) {
        const k = y * GRID + x, d = F.dist[k];
        if (d === Infinity) continue;
        const c = centre(size, k), e = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (e <= REACH && d + e < best) { best = d + e; bk = k; }
      }
    }
    if (bk < 0) return null;
    return { m: best, k: bk };
  }
  function pathOf(F, k, p) {
    const pts = [p];
    for (let i = k, n = 0; i >= 0 && n < GRID * GRID; i = F.prev[i], n++) pts.push(centre(O.graphSize, i));
    // fewer points: keep a pixel where the step changes
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // numbers: the lanes and the walks now (walks null until the graph has loaded, or with noWalk)
  function numbers(noWalk) {
    const ln = laneList().map(l => ({ id: l.id, length: l.length, minion: secs(l.length, 'minion'), shaper: secs(l.length), sm: SM.lanes[l.id], vs: compare(l.length, SM.lanes[l.id], 'long') }));
    const F = S.doc && !noWalk ? walkField() : null;
    let walks = null;
    if (F) {
      walks = objectives().map(o => {
        const w = walkTo(F, o.pos), sm = o.key && SM.walk[o.key];
        return Object.assign({}, o, { m: w ? w.m : null, k: w ? w.k : -1, s: w ? secs(w.m) : null, sm: sm || null, vs: w && sm ? compare(w.m, sm, 'far') : '' });
      });
    }
    return { lanes: ln, walks, base: base() };
  }

  // ---- drawing ------------------------------------------------------------------------------------------------
  function label(v, p, lines, color, dy) {
    const s = v.project(p), g = v.overlay;
    if (!s) return false;
    g.save();
    g.font = `bold ${10 * dpr}px Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lh = 12 * dpr, w = Math.max(...lines.map(t => g.measureText(t).width)) + 8 * dpr, y0 = s[1] + (dy || 0) * dpr - (lines.length - 1) * lh / 2;
    g.fillStyle = 'rgba(12,14,18,0.78)';
    g.fillRect(s[0] - w / 2, y0 - lh / 2 - 1 * dpr, w, lines.length * lh + 2 * dpr);
    g.fillStyle = color || '#fff';
    lines.forEach((t, i) => { g.fillStyle = i ? '#c8d0da' : (color || '#fff'); g.fillText(t, s[0], y0 + i * lh); });
    g.restore();
    return true;
  }
  // draw draws the overlays that are on through the view v (2-D: after the objects; 3-D: draped, each frame)
  function draw(v) {
    if (!v) return;
    O.stats[v.id] = null;
    if (!S.doc || !v.overlay || !(on.ranges || on.lanes || on.walk)) return;
    const g = v.overlay, st = { rings: [], lanes: [], labels: 0, paths: 0, walks: 0 };
    O.stats[v.id] = st;
    if (on.ranges) {
      for (const o of objects().filter(x => x.kind === 'binding')) {
        for (const [team, c] of [[1, o.pos], [2, mir(o.pos)]]) {
          g.save();
          g.lineWidth = 1.5 * dpr;
          g.strokeStyle = TEAM[team - 1];
          g.fillStyle = team === 1 ? 'rgba(88,166,255,0.10)' : 'rgba(255,123,114,0.10)';
          vring(v, c, RANGE + FOOT);
          g.fill(); g.stroke();
          g.restore();
          st.rings.push(c);
          if (RANGE * v.ppm(c) > 30 * dpr && label(v, [c[0], c[1] + RANGE + FOOT], [RANGE + ' m from its edge'], TEAM[team - 1])) st.labels++;
        }
      }
    }
    const N = numbers(!on.walk);
    if (on.lanes) {
      for (const l of N.lanes) {
        const knots = laneList().find(x => x.id === l.id).knots;
        g.save();
        g.strokeStyle = LANE[l.id] || '#ccc';
        g.globalAlpha = 0.85;
        g.lineWidth = 4 * dpr;
        vpoly(v, knots); g.stroke();
        g.restore();
        // a mark every 100 m from team 1's base
        let run = 0;
        for (let i = 1; i < knots.length; i++) {
          const a = knots[i - 1], b = knots[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let m = Math.ceil(run / 100) * 100 || 100; m < run + d; m += 100) {
            if (m <= run) continue;
            const t = (m - run) / d, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            vmark(v, p, 'round', 3.5, LANE[l.id] || '#ccc');
            if (label(v, p, [m + ' m'], LANE[l.id] || '#ccc', -11)) st.labels++;
          }
          run += d;
        }
        // the lane's numbers at its half
        let half = l.length / 2, at = knots[0];
        for (let i = 1; i < knots.length; i++) {
          const a = knots[i - 1], b = knots[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (half <= d) { at = [a[0] + (b[0] - a[0]) * half / d, a[1] + (b[1] - a[1]) * half / d]; break; }
          half -= d;
        }
        const lines = [`lane ${l.id}: ${Math.round(l.length)} m`, `minions ${clock(l.minion)}, a shaper ${clock(l.shaper)}`];
        if (l.vs) lines.push(l.vs);
        if (label(v, at, lines, LANE[l.id] || '#fff', 22)) st.labels++;
        st.lanes.push({ id: l.id, length: l.length });
      }
    }
    if (on.walk && N.walks && N.base) {
      const F = O.field;
      for (const w of N.walks) {
        if (w.m === null) continue;
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        g.lineWidth = 1.5 * dpr;
        g.setLineDash([4 * dpr, 3 * dpr]);
        vpoly(v, pathOf(F, w.k, w.pos)); g.stroke();
        g.restore();
        st.paths++;
      }
      for (const w of N.walks) {
        const col = w.team === 2 ? TEAM[1] : w.team === 1 ? TEAM[0] : '#e6edf3';
        const t = w.m === null ? ['no walk'] : [clock(w.s), Math.round(w.m) + ' m'];
        if (label(v, w.pos, t, col, w.kind === 'centre' ? 18 : -16)) st.labels++; // the centre's below (a parasite often stands there)
        st.walks++;
      }
      vmark(v, N.base, 'round', 5, '#e6edf3');
      label(v, N.base, ['base'], '#e6edf3', 14);
    }
  }
  function redraw() { if (on.ranges || on.lanes || on.walk) render(); renderWindow(); }

  // ---- the window: Gameplay Numbers -------------------------------------------------------------------------------
  const body = ED.window('overlays', 'Gameplay Numbers');
  body.id = 'ovNumbers';
  function renderWindow() {
    if (!ED.isOpen('overlays')) return;
    const N = numbers(), row = (...c) => h('tr', {}, ...c.map(x => h('td', {}, x)));
    body.replaceChildren();
    appendAll(body,
      h('div', { class: 'hint' }, `A shaper walks ${SPEED.shaper} m/s, a minion ${SPEED.minion} m/s; a Binding attacks within ${RANGE} m of its edge, ${(RANGE + FOOT).toFixed(2)} m from its centre (the game's data). SM_Map_v5 is the game's own map, measured the same way.`),
      h('div', { class: 'gh' }, 'Lanes (team 1\'s knots)'),
      h('table', { class: 'ovt' }, row('lane', 'length', 'minions', 'a shaper', 'SM_Map_v5'),
        ...N.lanes.map(l => row(String(l.id), Math.round(l.length) + ' m', clock(l.minion), clock(l.shaper), l.sm ? Math.round(l.sm) + ' m: ' + l.vs.replace(' than SM_Map_v5', '') : ''))),
      h('div', { class: 'gh' }, 'Walks from team 1\'s base (along the Player graph)'),
      N.walks ? h('table', { class: 'ovt' }, row('to', 'walk', 'time', 'SM_Map_v5'),
        ...N.walks.map(w => row(w.label, w.m === null ? 'none' : Math.round(w.m) + ' m', w.m === null ? '' : clock(w.s), w.sm ? clock(secs(w.sm)) + ': ' + w.vs.replace(' than SM_Map_v5', '') : '')))
        : h('div', { class: 'hint' }, S.images ? 'reading the Player graph...' : 'after the check'));
  }
  const toggle = k => () => { on[k] = !on[k]; if (on[k] && k === 'walk') loadGraph(); render(); ED.emit('overlay', k); };
  ED.actions['overlay.ranges'] = toggle('ranges');
  ED.actions['overlay.lanes'] = toggle('lanes');
  ED.actions['overlay.walk'] = toggle('walk');
  ED.actions['overlay.numbers'] = () => { ED.openWindow('overlays'); loadGraph(); renderWindow(); };
  for (const k of Object.keys(on)) ED.flags['overlay.' + k] = () => on[k];
  ED.on('render', () => { if (ED.view === '2d') draw(VIEW2D); });
  ED.marks.push(v => { if (v.id !== '2d') draw(v); });
  ED.on('checked', () => { if (on.walk || ED.isOpen('overlays')) loadGraph(); renderWindow(); });
  ED.on('doc', renderWindow);
  ED.on('open', () => { Object.assign(O, { graph: null, graphURL: '', loading: '', field: null, fieldKey: '' }); });

  // ---- the self-test (?selftest=overlays, CM_Ring then CM_Marsh): the menu's items, the numbers against values
  // computed apart from the page from the same check (the preview, graph_player.png, the document's lanes) by the
  // same rules, the overlays drawn in 2-D and 3-D and following edits, the window, everything off again ----------------
  // (computed apart from the page; CM_Marsh's centre, enemy Inner and parasite walks again 1.614 m longer since
  // the Bindings' and Cores' holes in the graphs, mapc StructureRadius, 2026-11-13)
  const EXPECT = {
    CM_Ring: { lanes: { 1: 591.889, 2: 591.889 }, walk: { centre: null, 'enemy 1 Inner': 523.77, 'enemy 1 Middle': 439.277,
      'enemy 1 Outer': 367.2, 'enemy 2 Inner': 523.77, 'enemy 2 Middle': 439.277, 'enemy 2 Outer': 367.2, 'own 1 Inner': 142.898,
      'own 1 Middle': 226.655, 'own 1 Outer': 311.024, 'own 2 Inner': 142.898, 'own 2 Middle': 226.655, 'own 2 Outer': 311.024 } },
    CM_Marsh: { lanes: { 1: 575.855, 2: 575.855 }, walk: { centre: 268.138, 'enemy 1 Inner': 497.0, 'enemy 1 Middle': 430.589,
      'enemy 1 Outer': 362.065, 'enemy 2 Inner': 501.946, 'enemy 2 Middle': 430.434, 'enemy 2 Outer': 362.343, 'own 1 Inner': 140.337,
      'own 1 Middle': 220.344, 'own 1 Outer': 296.103, 'own 2 Inner': 139.822, 'own 2 Middle': 220.183, 'own 2 Outer': 300.338,
      parasite: 270.26 } },
  };
  async function selftest() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const bar = () => document.querySelector('#menubar [data-menu="view"]');
    const closeMenus = () => { if (bar().classList.contains('open')) bar().click(); };
    const viewMenu = () => { closeMenus(); bar().click(); return [...document.querySelectorAll('#menuLayer .menu .it')]; };
    const item = t => viewMenu().find(e => e.dataset.t === t);
    // the pixels round where p shows (5 x 5, summed per channel): the ring's line passes there
    const pixel = (g, p) => {
      const s = g === ctx ? VIEW2D.project(p) : ED.views['3d'].project(p);
      if (!s || s[0] < 2 || s[1] < 2 || s[0] > g.canvas.width - 3 || s[1] > g.canvas.height - 3) return 'off the canvas ' + (s ? s.map(Math.round) : '');
      const d = g.getImageData(Math.round(s[0]) - 2, Math.round(s[1]) - 2, 5, 5).data, sum = [0, 0, 0, 0];
      for (let k = 0; k < d.length; k++) sum[k % 4] += d[k];
      return sum.join(',');
    };
    let ok = true;
    // the numbers of the map open now against EXPECT
    async function numbersOf(map) {
      ok &= say(await until(() => S.pkg === map && S.preview && S.images && S.report, 60000), `${map} open and checked`);
      loadGraph();
      ok &= say(await until(() => O.graph && O.graphURL === S.images + 'graph_player.png', 30000), `${map}: the Player graph read (${O.graph ? O.graph.reduce((a, x) => a + x, 0) : 0} pixels on the graph)`);
      const N = numbers(), E = EXPECT[map];
      const lens = N.lanes.map(l => `${l.id} ${l.length.toFixed(3)}`).join(', ');
      ok &= say(N.lanes.length === Object.keys(E.lanes).length && N.lanes.every(l => near(l.length, E.lanes[l.id], 0.001)) &&
        JSON.stringify(N.lanes.map(l => Math.round(l.length))) === JSON.stringify(S.report.stats.laneLengths),
      `${map}: the lanes ${lens} m (expected ${JSON.stringify(E.lanes)}; the check's laneLengths ${JSON.stringify(S.report.stats.laneLengths)})`);
      ok &= say(N.lanes.every(l => near(l.minion, l.length / 9.56, 1e-9) && near(l.shaper, l.length / 11.18, 1e-9)),
        `${map}: the lanes' times: minions ${N.lanes.map(l => clock(l.minion)).join(', ')}, a shaper ${N.lanes.map(l => clock(l.shaper)).join(', ')}`);
      const keyed = {};
      for (const w of N.walks || []) if (w.key) keyed[w.key] = w.m;
      const bad = Object.keys(E.walk).filter(k => !(k in keyed) || (E.walk[k] === null ? keyed[k] !== null : !(keyed[k] !== null && near(keyed[k], E.walk[k], 0.01))));
      ok &= say(N.walks && !bad.length && Object.keys(keyed).length === Object.keys(E.walk).length,
        `${map}: the walks from the base (${O.fieldMs ? O.fieldMs.toFixed(0) : '?'} ms): ` + Object.keys(E.walk).map(k => `${k} ${keyed[k] == null ? 'none' : keyed[k].toFixed(2)}`).join(', ') + (bad.length ? '; differ: ' + bad.join(', ') : ''));
      return N;
    }
    // (1) the View menu's items and the actions
    const items = ['Binding Ranges', 'Lane Lengths', 'Walk Times from the Base', 'Gameplay Numbers...'];
    ok &= say(items.every(t => { const e = item(t); return e && !e.classList.contains('off'); }) && ['ranges', 'lanes', 'walk', 'numbers'].every(k => ED.actions['overlay.' + k]),
      'View > Gameplay Overlays: ' + items.join(', '));
    closeMenus();
    await numbersOf('CM_Ring');
    // (2) Binding Ranges by the menu, in 2-D: a ring round each Binding of both teams, at 28 + 2.76 m
    const b = objects().find(o => o.kind === 'binding');
    Object.assign(S.view, { x: b.pos[0], y: b.pos[1], scale: Math.min(3, 0.4 * VIEW2D.canvas.width / dpr / (RANGE + FOOT)) * dpr });
    S.fitted = false;
    render();
    const edge = [b.pos[0] + RANGE + FOOT, b.pos[1]], px0 = pixel(ctx, edge);
    item('Binding Ranges').click();
    const nb = objects().filter(o => o.kind === 'binding').length, st = () => O.stats['2d'];
    ok &= say(on.ranges && item('Binding Ranges').classList.contains('check') && st() && st().rings.length === 2 * nb && pixel(ctx, edge) !== px0,
      `2-D: ${st() ? st().rings.length : 0} rings for ${nb} Bindings a team, the pixel at the ring ${px0} -> ${pixel(ctx, edge)}, ${st() ? st().labels : 0} labels`);
    closeMenus();
    // a moved Binding's ring follows at once (materialized from "auto", then undone)
    edit(() => { materialize('bindings'); S.doc.base.bindings[String(b.lane)][b.tier] = [b.pos[0] + 6, b.pos[1] - 4]; });
    ok &= say(st().rings.some(c => near(c[0], b.pos[0] + 6, 1e-9) && near(c[1], b.pos[1] - 4, 1e-9)) && st().rings.some(c => near(c[0], -b.pos[0] - 6, 1e-9)),
      'a moved Binding\'s ring and its mirror follow the document');
    undo();
    // (3) Lane Lengths: the 100-m marks and the label; a moved knot changes the length at once
    ED.act('overlay.lanes');
    const L0 = numbers(true).lanes[0], k3 = lanes()[0].knots[3].slice(), k2 = lanes()[0].knots[2], k4 = lanes()[0].knots[4];
    ok &= say(on.lanes && st().lanes.length === lanes().length && st().labels >= Math.floor(L0.length / 100), `2-D: ${st().lanes.length} lanes drawn, ${st().labels} labels`);
    edit(() => { S.doc.lanes[0].knots[3] = [k3[0] + 10, k3[1]]; });
    const d = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]), moved = [k3[0] + 10, k3[1]];
    const want = L0.length - d(k2, k3) - d(k3, k4) + d(k2, moved) + d(moved, k4);
    ok &= say(near(st().lanes[0].length, want, 1e-9), `a knot moved 10 m: lane 1 ${L0.length.toFixed(2)} -> ${st().lanes[0].length.toFixed(2)} m (expected ${want.toFixed(2)})`);
    undo();
    ok &= say(near(numbers(true).lanes[0].length, L0.length, 1e-9), 'undone: the length back');
    // the comparison's words
    ok &= say(compare(595.09 * 1.18, 595.09, 'long') === '18 % longer than SM_Map_v5' && compare(500, 595.09, 'long') === '16 % shorter than SM_Map_v5' &&
      compare(596, 595.09, 'long') === 'as long as on SM_Map_v5' && compare(300, 285.39, 'far') === '5 % farther than SM_Map_v5', 'the comparison: ' + compare(595.09 * 1.18, 595.09, 'long'));
    // (4) Walk Times: a path and a time label per objective; a moved spawn moves the base, undone the walks are back
    ED.act('overlay.walk');
    const N0 = numbers(), reached = N0.walks.filter(w => w.m !== null).length;
    ok &= say(st().paths === reached && st().walks === N0.walks.length, `2-D: ${st().paths} paths drawn, ${st().walks} objectives labelled`);
    const sp = S.doc.base.spawns[0].slice();
    edit(() => { S.doc.base.spawns[0] = [sp[0] + 15, sp[1] + 15]; });
    const N1 = numbers(), o1 = w => (w.walks.find(x => x.key === 'own 1 Outer') || {}).m;
    ok &= say(o1(N1) < o1(N0), `a spawn moved towards the lanes: own 1 Outer ${o1(N0).toFixed(1)} -> ${o1(N1).toFixed(1)} m`);
    undo();
    ok &= say(near(o1(numbers()), o1(N0), 1e-9), 'undone: the walk back');
    // (5) the window
    item('Gameplay Numbers...').click();
    const wt = $('ovNumbers').textContent;
    ok &= say(ED.isOpen('overlays') && /SM_Map_v5/.test(wt) && /1 % shorter/.test(wt) && /own Outer Binding, lane 1/.test(wt) && /11\.18 m\/s/.test(wt),
      'the window: ' + wt.slice(0, 160).replace(/\s+/g, ' '));
    // (6) the 3-D view: the same overlays draped, drawn on its overlay canvas
    ED.setView('3d');
    ok &= say(await V3D.until(() => V3D.settled() && V3D.V.snap, 240000), '3-D: the scene loaded');
    V3D.V.cam.dist = 90;
    V3D.setTarget(edge[0], edge[1]); // the ring's point at the view's centre
    V3D.frame();
    const s3 = () => O.stats['3d'], g3 = V3D.V.octx;
    ok &= say(s3() && s3().rings.length === 2 * nb && s3().lanes.length === lanes().length && s3().paths === reached,
      `3-D: ${s3() ? s3().rings.length : 0} rings, ${s3() ? s3().lanes.length : 0} lanes, ${s3() ? s3().paths : 0} paths, ${s3() ? s3().labels : 0} labels`);
    const on3 = pixel(g3, edge);
    ED.act('overlay.ranges');
    V3D.frame();
    ok &= say(pixel(g3, edge) !== on3 && s3().rings.length === 0, `3-D: Binding Ranges off: the ring's pixel ${on3} -> ${pixel(g3, edge)}`);
    ED.act('overlay.lanes');
    ED.act('overlay.walk');
    V3D.frame();
    ok &= say(!s3(), '3-D: all off, nothing drawn');
    ED.setView('2d');
    // (7) CM_Marsh: its camps, wells and parasite
    await openMap('CM_Marsh');
    await settle();
    const NM = await numbersOf('CM_Marsh');
    const kinds = NM.walks.reduce((a, w) => { a[w.kind] = (a[w.kind] || 0) + 1; return a; }, {});
    ok &= say(kinds.camp >= 4 && kinds.well >= 2 && NM.walks.some(w => w.key === 'parasite' && w.m !== null), 'CM_Marsh\'s objectives: ' + JSON.stringify(kinds));
    renderWindow();
    ok &= say(/parasite/.test($('ovNumbers').textContent), 'the window follows the map: ' + ($('ovNumbers').textContent.match(/parasite.{0,40}/) || [''])[0]);
    ED.closeWindow('overlays');
    ok &= say(!on.ranges && !on.lanes && !on.walk && !ED.isOpen('overlays') && snapshot() === S.savedJSON, 'everything off, CM_Marsh as saved');
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.overlays = selftest;

  return { O, on, SPEED, RANGE, FOOT, SM, REACH, numbers, objectives, laneList, compare, clock, walkField, walkTo, field, draw, loadGraph };
})();

// The live ground preview: while a terrain edit is under way (a cliff brush stroke, a circle dragged out, a shape, a
// corner, a lane knot or the lanes' width dragged) the page makes the ground's relief itself and shows it at once: in
// the 3-D view the ground mesh and its heights (what the pick and the draped lines follow), in 2-D the cells whose
// kind changed, in the layout's colours over the background. The compiler's mesh, layout and bake replace it when
// they come for that document; until then the approximation stays (the view never falls back to the old ground).
//
// The rule is the compiler's, in one place (height() and colour() with its constants, below), so a change of the
// relief extends both:
// - mapc's raster: the terrain's default everywhere, then every terrain shape and its point mirror in order on a
//   512 x 512 grid of cells over the map's square; a cell takes a shape whose geometry holds its centre; a bush keeps
//   the ground; a lane corridor follows its lane's knots and width;
// - the ground's field: each cell's signed distance (m) to the edge between walkable ground (open, island; a blocking
//   prop's footprint counts as walkable, so props never change the relief) and walls or chasms, negative on walkable
//   ground;
// - the ground model's height(): walkable ground at 0 m; walls a 5-m plateau, its cliff rising from 1 to 4.5 m past the
//   edge (smoothstep), with low hills of +-0.6 m beyond 6 m; chasms the same curve down; the vertices of the mesh's
//   321 x 321 grid (two raster cells apart) take the height of the cell under them;
// - EDUX9's authored heights (a wall shape's "height", its plateau; a chasm's, negative, its depth): each cell's top
//   from its last shape (as its kind), blended per kind over 4 m (blendWin, topAt: mapc relief.go), and the cliff band
//   widened with the height (cliffEnd), the hills past its end + 1.5 m. Without a height anywhere: the 5-m rule above.
// Left out: the fords' dips (their water comes from the props) and the cliff texture a baked ground gives its steep
// triangles. Where the relief doesn't change, the compiler's own mesh stays as it is, so those show there.
//
// Cost: a drag step paints again only the cells the changed shapes covered or cover (the shapes over them painted in
// order), solves the field only round the changed cells (REACH metres: no farther does a change move a height or a
// shade) and sends the changed vertices to the GL buffers. RL.stats keeps the times (milliseconds).
'use strict';

const RL = (() => {
  const N = 512, HALF = 256; // mapc raster.go Grid: cell (i, j)'s centre is ((i - 256) c, (j - 256) c), c = size / 512
  const GRID = 320, GH = 160; // ground.go Grid: the mesh's cells (two raster cells each), 321 x 321 vertices
  const NV = GRID + 1;
  // ground.go's constants: Plateau, cliffLo, cliffHi, roll; baseTints, baseIn, baseOut; relief.go's (EDUX9): RollFrom,
  // HeightBlend, MinHeight, MaxHeight
  const RELIEF = { plateau: 5.0, cliffLo: 1.0, cliffHi: 4.5, roll: 0.6, rollFrom: 1.5, blend: 4.0, minHeight: 1.0, maxHeight: 40.0 };
  const TINTS = [[0.84, 0.91, 1.0], [1.0, 0.86, 0.82]], TINT_IN = 70, TINT_OUT = 100;
  const WALL = 0, OPEN = 1, CHASM = 2, ISLAND = 4; // mapc raster.go's kinds
  const DEFAULTS = { wall: WALL, open: OPEN, chasm: CHASM }, KINDS = { wall: WALL, open: OPEN, chasm: CHASM, island: ISLAND };
  // a signed distance below DLO or above DHI moves neither height() nor colour(); REACH metres cover both
  const DLO = -4, DHI = 14, REACH = 16;
  const LAYOUT_RGB = { [WALL]: [70, 62, 58], [OPEN]: [196, 186, 160], [CHASM]: [40, 60, 110], [ISLAND]: [183, 177, 194] }; // mapc preview.go

  // ---- the relief (ground.go) ----------------------------------------------------------------------------------
  const smooth = t => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
  function lattice(ix, iy, seed) { // ground.go lattice: a lattice point hashed to [0, 1) (uint32 arithmetic)
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) & 0xFFFF) / 65536;
  }
  function valueNoise(x, y, period, seed) {
    const gx = x / period, gy = y / period, fix = Math.floor(gx), fiy = Math.floor(gy);
    const fx = smooth(gx - fix), fy = smooth(gy - fiy);
    const top = lattice(fix, fiy, seed) * (1 - fx) + lattice(fix + 1, fiy, seed) * fx;
    const bot = lattice(fix, fiy + 1, seed) * (1 - fx) + lattice(fix + 1, fiy + 1, seed) * fx;
    return top * (1 - fy) + bot * fy;
  }
  // cliffEnd is relief.go CliffEnd: where the cliff of a plateau h high (or a chasm h deep) ends past the walkable edge;
  // the band widens with the height so a tall cliff keeps the 5-m one's slope
  const cliffEnd = h => RELIEF.cliffLo + (RELIEF.cliffHi - RELIEF.cliffLo) * Math.max(1, h / RELIEF.plateau);
  // height is ground.go's height() without the fords' dips: d the signed distance (m) to the walkable edge (negative on
  // walkable ground), (x, y) the point, down: a chasm's cell (the ground drops instead of rising), h: the blended height
  // there (topAt; EDUX9) or, without authored heights, the 5-m plateau
  function height(d, x, y, down, h) {
    if (h === undefined) h = RELIEF.plateau;
    const hi = cliffEnd(h), r = hi + RELIEF.rollFrom;
    let z = h * smooth((d - RELIEF.cliffLo) / (hi - RELIEF.cliffLo));
    if (d > 0 && down) return -z;
    if (d > r) z += RELIEF.roll * (2 * valueNoise(x, y, 23, 7) - 1) * smooth((d - r) / 8);
    return z;
  }
  // colour is ground.go's colour(): the vertex colour (0..1) by zone, times the bases' tints (bases: the two teams'
  // spawn centres); h as height()'s
  function colour(d, z, x, y, bases, h) {
    if (h === undefined) h = RELIEF.plateau;
    let c;
    if (d <= RELIEF.cliffLo) c = 1 - 0.28 * smooth((d + 4) / (4 + RELIEF.cliffLo));
    else if (d < cliffEnd(h)) c = 0.72 - 0.30 * Math.min(Math.max(z / h, 0), 1);
    else c = 0.60 * (0.88 + 0.12 * valueNoise(x, y, 9, 3));
    const rgb = [c, c, c];
    bases.forEach((b, t) => {
      if (!b) return;
      const f = 1 - smooth((Math.hypot(x - b[0], y - b[1]) - TINT_IN) / (TINT_OUT - TINT_IN));
      if (f > 0) for (let k = 0; k < 3; k++) rgb[k] *= (1 - f) + f * TINTS[t][k];
    });
    return rgb;
  }

  // ---- the raster (mapc raster.go) -------------------------------------------------------------------------------
  function goHypot(p, q) { // Go's math.Hypot (the compiler's dist and segDist)
    p = Math.abs(p); q = Math.abs(q);
    if (p < q) { const t = p; p = q; q = t; }
    if (p === 0) return 0;
    q = q / p;
    return p * Math.sqrt(1 + q * q);
  }
  // geomOf is a terrain shape's geometry ({circle, r} | {poly} | {path, half}) with its kind and box, or null for one
  // that paints no ground (a bush) or that the check refuses
  function geomOf(s, lanes) {
    if (!s || typeof s !== 'object') return null;
    const kind = KINDS[s.type];
    if (kind === undefined) return null;
    let n = 0, g = null;
    if (s.lane !== undefined && s.lane !== null && s.lane !== 0) {
      n++;
      const l = lanes.find(x => x && x.id === s.lane);
      if (!l || !Array.isArray(l.knots) || !l.knots.length || !l.knots.every(isPt)) return null;
      g = { path: l.knots, half: (+l.width || 0) / 2 };
    }
    if (s.circle != null) { n++; if (!isPt(s.circle) || !(+s.r > 0)) return null; g = { circle: s.circle, r: +s.r }; }
    if (s.polygon != null) { n++; if (!Array.isArray(s.polygon) || s.polygon.length < 3 || !s.polygon.every(isPt)) return null; g = { poly: s.polygon }; }
    if (s.path != null) { n++; if (!Array.isArray(s.path) || s.path.length < 2 || !s.path.every(isPt) || !(+s.width > 0)) return null; g = { path: s.path, half: +s.width / 2 }; }
    if (n !== 1) return null;
    g.kind = kind;
    g.box = boxOf(g);
    g.authored = typeof s.height === 'number' && isFinite(s.height); // EDUX9: a wall's plateau, a chasm's depth
    g.top = kindTop(kind, g.authored ? s.height : undefined);
    g.key = JSON.stringify([kind, g.circle, g.r, g.poly, g.path, g.half, g.top]);
    const m = { kind, r: g.r, half: g.half, top: g.top };
    if (g.circle) m.circle = [-g.circle[0], -g.circle[1]];
    if (g.poly) m.poly = g.poly.map(p => [-p[0], -p[1]]);
    if (g.path) m.path = g.path.map(p => [-p[0], -p[1]]);
    m.box = boxOf(m);
    g.m = m;
    return g;
  }
  function boxOf(g) {
    if (g.circle) return [g.circle[0] - g.r, g.circle[1] - g.r, g.circle[0] + g.r, g.circle[1] + g.r];
    const pts = g.poly || g.path, r = g.poly ? 0 : g.half;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) { b[0] = Math.min(b[0], p[0] - r); b[1] = Math.min(b[1], p[1] - r); b[2] = Math.max(b[2], p[0] + r); b[3] = Math.max(b[3], p[1] + r); }
    return b;
  }
  function segDist(px, py, a, b) { // mapc resolve.go segDist
    const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
    let t = 0;
    if (ll > 0) t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / ll));
    return goHypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }
  function holds(g, x, y) { // mapc raster.go shapeGeom.contains
    if (g.circle) return goHypot(x - g.circle[0], y - g.circle[1]) <= g.r;
    if (g.poly) { // the even-odd rule (inPolygon)
      const q = g.poly;
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i, i++) {
        const a = q[i], b = q[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    }
    const p = g.path;
    for (let i = 0; i + 1 < p.length; i++) if (segDist(x, y, p[i], p[i + 1]) <= g.half) return true;
    return p.length === 1 && goHypot(x - p[0][0], y - p[0][1]) <= g.half;
  }
  // kindTop is mapc height.go kindTop: a cell's authored top for its kind (a wall's plateau height, h or 5; a chasm's
  // depth, negative; 0 for walkable ground)
  function kindTop(kind, h) {
    if (kind === WALL) return h !== undefined ? h : RELIEF.plateau;
    if (kind === CHASM) return h !== undefined ? h : -RELIEF.plateau;
    return 0;
  }
  // terrainOf: what the raster depends on (size, default, the shapes' geometries in order, with extra shapes after the
  // document's: a stroke still being drawn) and its key
  function terrainOf(doc, extra) {
    if (!doc) return null;
    const size = +doc.size || 0, t = doc.terrain && typeof doc.terrain === 'object' ? doc.terrain : {};
    if (!(size > 0)) return null;
    const def = DEFAULTS[t.default] !== undefined ? DEFAULTS[t.default] : WALL;
    const lanes = Array.isArray(doc.lanes) ? doc.lanes : [];
    const list = [];
    for (const s of (Array.isArray(t.shapes) ? t.shapes : []).concat(extra || [])) { const g = geomOf(s, lanes); if (g) list.push(g); }
    // heights: a shape sets one (mapc HasHeights: the compiler then blends the tops, relief.go); hmax the tallest
    const heights = list.some(g => g.authored), hmax = Math.max(RELIEF.plateau, ...list.map(g => Math.abs(g.top)));
    return { size, c: size / N, def, list, heights, hmax, key: size + '|' + def + '|' + list.map(g => g.key).join('|') };
  }
  const cellOf = (v, c) => Math.min(Math.max(Math.floor(v / c + HALF + 0.5), 0), N - 1); // mapc CellOf, clamped
  // paint draws the terrain into the cells of the window w ({i0, j0, i1, j1}): the default, then each shape and its
  // mirror in order (mapc Rasterise restricted to w); with tops (a Float64Array) each cell's authored top too, the later
  // shape's winning as its kind does (EDUX9)
  function paint(grid, T, w, tops) {
    const c = T.c;
    for (let j = w.j0; j <= w.j1; j++) grid.fill(T.def, j * N + w.i0, j * N + w.i1 + 1);
    if (tops) { const t0 = kindTop(T.def); for (let j = w.j0; j <= w.j1; j++) tops.fill(t0, j * N + w.i0, j * N + w.i1 + 1); }
    for (const g of T.list) {
      for (const gg of [g, g.m]) {
        const b = gg.box;
        const i0 = Math.max(cellOf(b[0], c) - 1, w.i0), i1 = Math.min(cellOf(b[2], c) + 1, w.i1);
        const j0 = Math.max(cellOf(b[1], c) - 1, w.j0), j1 = Math.min(cellOf(b[3], c) + 1, w.j1);
        if (gg.path && gg.path.length > 1) { // a path holds a cell when one of its legs does: each leg over its own box
          for (let s = 0; s + 1 < gg.path.length; s++) {
            const a = gg.path[s], e = gg.path[s + 1], h = gg.half;
            const si0 = Math.max(cellOf(Math.min(a[0], e[0]) - h, c) - 1, i0), si1 = Math.min(cellOf(Math.max(a[0], e[0]) + h, c) + 1, i1);
            const sj0 = Math.max(cellOf(Math.min(a[1], e[1]) - h, c) - 1, j0), sj1 = Math.min(cellOf(Math.max(a[1], e[1]) + h, c) + 1, j1);
            for (let j = sj0; j <= sj1; j++) {
              const y = (j - HALF) * c;
              for (let i = si0; i <= si1; i++) if (segDist((i - HALF) * c, y, a, e) <= h) { grid[j * N + i] = gg.kind; if (tops) tops[j * N + i] = gg.top; }
            }
          }
          continue;
        }
        for (let j = j0; j <= j1; j++) {
          const y = (j - HALF) * c;
          for (let i = i0; i <= i1; i++) if (holds(gg, (i - HALF) * c, y)) { grid[j * N + i] = gg.kind; if (tops) tops[j * N + i] = gg.top; }
        }
      }
    }
  }
  const ALL = { i0: 0, j0: 0, i1: N - 1, j1: N - 1 };
  function rasterise(T, tops) { const g = new Uint8Array(N * N); paint(g, T, ALL, tops); return g; }
  // topsOf: a raster's tops (its own with heights; without: each kind's default, made once)
  function topsOf(e) {
    if (!e.tops) { e.tops = new Float64Array(N * N); for (let k = 0; k < N * N; k++) e.tops[k] = kindTop(e.grid[k]); }
    return e.tops;
  }

  // ---- the authored heights' blend (mapc relief.go NewRelief, Top) in a window ------------------------------------
  // blendWin: for each cell of the window w, per kind (wall, chasm) the mean of that kind's tops (positive metres) over
  // the square of rad cells round it, the other kinds not counted, 5 where it holds none: a row pass, then a column
  // pass, each a plain sum in the compiler's order (so the same bits)
  function blendWin(tops, w, rad) {
    const W = w.i1 - w.i0 + 1, H = w.j1 - w.j0 + 1, ja = Math.max(0, w.j0 - rad), jb = Math.min(N - 1, w.j1 + rad);
    const out = { w, W, wall: new Float64Array(W * H), chasm: new Float64Array(W * H) };
    for (const [sign, arr] of [[1, out.wall], [-1, out.chasm]]) {
      const R2 = jb - ja + 1, sum = new Float64Array(R2 * W), cnt = new Float64Array(R2 * W);
      for (let j = ja; j <= jb; j++) {
        for (let i = w.i0; i <= w.i1; i++) {
          let s = 0, n = 0;
          for (let q = Math.max(0, i - rad), qe = Math.min(N - 1, i + rad); q <= qe; q++) { const v = sign * tops[j * N + q]; if (v > 0) { s += v; n++; } }
          sum[(j - ja) * W + i - w.i0] = s; cnt[(j - ja) * W + i - w.i0] = n;
        }
      }
      for (let j = w.j0; j <= w.j1; j++) {
        for (let i = w.i0; i <= w.i1; i++) {
          let s = 0, n = 0;
          for (let q = Math.max(0, j - rad), qe = Math.min(N - 1, j + rad); q <= qe; q++) { s += sum[(q - ja) * W + i - w.i0]; n += cnt[(q - ja) * W + i - w.i0]; }
          arr[(j - w.j0) * W + i - w.i0] = n > 0 ? s / n : RELIEF.plateau;
        }
      }
    }
    return out;
  }
  const blendRad = size => Math.round(RELIEF.blend * (N / size)); // relief.go: HeightBlend * Scale
  // topAt is relief.go Relief.Top: the blended plateau height (down false) or chasm depth at (x, y), bilinear between
  // the cells' centres, clamped to the grid
  function topAt(B, x, y, down, size) {
    const v = down ? B.chasm : B.wall, scale = N / size;
    const fi = Math.min(Math.max(N / 2 + x * scale, 0), N - 1), fj = Math.min(Math.max(N / 2 + y * scale, 0), N - 1);
    const i0 = Math.min(Math.trunc(fi), N - 2), j0 = Math.min(Math.trunc(fj), N - 2), tx = fi - i0, ty = fj - j0;
    const a = (j0 - B.w.j0) * B.W + (i0 - B.w.i0), b = a + B.W;
    const top = v[a] * (1 - tx) + v[a + 1] * tx, bot = v[b] * (1 - tx) + v[b + 1] * tx;
    return top * (1 - ty) + bot * ty;
  }

  // ---- the field (ground.go NewField) in a window --------------------------------------------------------------
  function edt1d(f, n, d, v, z) { // Felzenszwalb and Huttenlocher's squared distance of one row (ground.go edt1d)
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let p = v[k], s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));
      while (s <= z[k]) { k--; p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
  }
  function edt(mask, W, H, src) { // the distance (cells) from every cell to the nearest whose mask is src (ground.go edt)
    const BIG = 1e20, m = Math.max(W, H), out = new Float64Array(W * H), cols = new Float64Array(W * H);
    const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < H; j++) f[j] = mask[j * W + i] === src ? 0 : BIG;
      edt1d(f, H, d, v, z);
      for (let j = 0; j < H; j++) cols[i * H + j] = d[j];
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) f[i] = cols[i * H + j];
      edt1d(f, W, d, v, z);
      for (let i = 0; i < W; i++) out[j * W + i] = d[i] < BIG ? Math.sqrt(d[i]) : 1e9;
    }
    return out;
  }
  // field: every cell's signed distance in the window w, as NewField computes it over the whole grid; exact up to the
  // distance the window reaches past the cells read
  function field(grid, w, c) {
    const W = w.i1 - w.i0 + 1, H = w.j1 - w.j0 + 1, blocked = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = grid[(w.j0 + j) * N + w.i0 + i]; blocked[j * W + i] = k === WALL || k === CHASM ? 1 : 0; }
    const toOpen = edt(blocked, W, H, 0), toBlocked = edt(blocked, W, H, 1), half = 0.5 * c, D = new Float64Array(W * H);
    for (let k = 0; k < W * H; k++) D[k] = blocked[k] ? toOpen[k] * c - half : -(toBlocked[k] * c - half);
    return { w, W, D };
  }
  // fieldAt is ground.go Field.At: bilinear between the cells' centres, outside the grid the edge cell plus the distance
  // beyond it
  function fieldAt(F, x, y, size) {
    const c = size / N, scale = N / size, fi = N / 2 + x * scale, fj = N / 2 + y * scale;
    const ci = Math.min(Math.max(fi, 0), N - 1), cj = Math.min(Math.max(fj, 0), N - 1);
    const i0 = Math.min(Math.trunc(ci), N - 2), j0 = Math.min(Math.trunc(cj), N - 2), tx = ci - i0, ty = cj - j0;
    const D = F.D, W = F.W, a = (j0 - F.w.j0) * W + (i0 - F.w.i0), b = a + W;
    const top = D[a] * (1 - tx) + D[a + 1] * tx, bot = D[b] * (1 - tx) + D[b + 1] * tx, v = top * (1 - ty) + bot * ty;
    return v > 0 ? v + Math.hypot(fi - ci, fj - cj) * c : v;
  }

  // ---- the live raster, its bases ------------------------------------------------------------------------------
  const R = {
    T: null, grid: null, rev: 0, bases: new Map(), mesh: null, patch2d: null,
    stats: { raster: [], full: [], diff: [], field: [], mesh: [], vertices: [], frame: [], paint: [] },
  };
  const note = (k, ms) => { const a = R.stats[k]; a.push(ms); if (a.length > 200) a.shift(); };
  // the shapes a stroke in progress adds (app.js: the cliff brush's stroke as the release will write it, a circle being
  // dragged out)
  function pending() {
    if (S.tool !== 'shape') return [];
    if (S.stroke && S.stroke.pts.length) return cliffStrokeShapes(S.stroke.pts).map(newShape);
    const d = S.drawing;
    if (d && d.geom === 'circle' && d.down && d.r >= 1) return [newShape(toTeam1({ circle: d.center, r: d.r }))];
    return [];
  }
  // sync brings the live raster up to the document and the stroke in progress (only the changed shapes' cells again);
  // true when it changed
  function sync() {
    if (!S.doc) return false;
    const T = terrainOf(S.doc, pending());
    if (!T || (R.T && T.key === R.T.key)) return false;
    const t0 = performance.now();
    if (!R.grid || !R.T || R.T.size !== T.size || R.T.def !== T.def || R.T.heights !== T.heights) {
      R.tops = T.heights ? new Float64Array(N * N) : null; // the authored tops, kept with the kinds while a shape sets a height
      R.grid = rasterise(T, R.tops);
      note('full', performance.now() - t0);
    } else {
      // the cells a changed shape covered or covers, and their mirrors: each its own window (a stroke and its mirror
      // lie at opposite ends of the map); overlapping windows merged
      const boxes = [];
      for (let k = 0, n = Math.max(R.T.list.length, T.list.length); k < n; k++) {
        const o = R.T.list[k], g = T.list[k];
        if (o && g && o.key === g.key) continue;
        for (const b of changeBoxes(o, g)) boxes.push(b, [-b[2], -b[3], -b[0], -b[1]]);
      }
      const wins = [];
      for (const b of boxes) {
        let w = { i0: Math.max(cellOf(b[0], T.c) - 1, 0), j0: Math.max(cellOf(b[1], T.c) - 1, 0), i1: Math.min(cellOf(b[2], T.c) + 1, N - 1), j1: Math.min(cellOf(b[3], T.c) + 1, N - 1) };
        for (let q = wins.length - 1; q >= 0; q--) {
          const x = wins[q];
          if (x.i0 <= w.i1 && w.i0 <= x.i1 && x.j0 <= w.j1 && w.j0 <= x.j1) { w = { i0: Math.min(x.i0, w.i0), j0: Math.min(x.j0, w.j0), i1: Math.max(x.i1, w.i1), j1: Math.max(x.j1, w.j1) }; wins.splice(q, 1); q = wins.length; }
        }
        wins.push(w);
      }
      for (const w of wins) paint(R.grid, T, w, R.tops);
      note('raster', performance.now() - t0);
    }
    R.T = T;
    R.rev++;
    return true;
  }
  // changeBoxes: where the cells of a shape that changed from o to g may differ (world boxes, team 1's side; sync adds
  // the mirrors): a path or polygon with the same points but some moved: round the moved points' legs or corners; else
  // both shapes' boxes
  function changeBoxes(o, g) {
    if (!o || !g) return [o, g].filter(Boolean).map(s => s.box);
    const pts = s => s.path || s.poly;
    const po = pts(o), pg = pts(g);
    if (o.kind !== g.kind || o.top !== g.top || !po || !pg || !!o.path !== !!g.path || po.length !== pg.length || o.half !== g.half) return [o.box, g.box];
    const n = po.length, out = [], r = o.path ? o.half : 0;
    for (let i = 0; i < n; i++) {
      if (po[i][0] === pg[i][0] && po[i][1] === pg[i][1]) continue;
      const near = [po[i], pg[i]];
      for (const d of [-1, 1]) { const k = o.poly ? (i + d + n) % n : i + d; if (k >= 0 && k < n) near.push(po[k], pg[k]); }
      const xs = near.map(p => p[0]), ys = near.map(p => p[1]);
      out.push([Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r]);
    }
    return out.length ? out : [o.box, g.box];
  }
  // baseGrid: the raster of a map.json text (the document a compiled mesh, layout or bake was made from), kept for the
  // last few
  function baseGrid(json) {
    if (!json) return null;
    let e = R.bases.get(json);
    if (!e) {
      let doc = null;
      try { doc = JSON.parse(json); } catch (err) { return null; }
      const T = terrainOf(doc), t0 = performance.now(), tops = T && T.heights ? new Float64Array(N * N) : null;
      e = T ? { T, grid: rasterise(T, tops), tops } : { T: null, grid: null };
      if (T) note('full', performance.now() - t0);
      e.doc = doc;
      R.bases.set(json, e);
      while (R.bases.size > 4) R.bases.delete(R.bases.keys().next().value);
    }
    return e.grid ? e : null;
  }
  // diffBoxes: the boxes ({i0, j0, i1, j1}) of the cells whose kind (or, given both, authored top) differs, one for
  // each team's half (an edit changes its mirror too: one box round both would hold the map's middle), or []
  function diffBoxes(a, b, ta, tb) {
    const A = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2), B = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
    const bx = [{ i0: N, j0: N, i1: -1, j1: -1 }, { i0: N, j0: N, i1: -1, j1: -1 }];
    const mark = k => {
      const i = k % N, j = (k - i) / N, x = bx[i + j <= N ? 0 : 1];
      if (i < x.i0) x.i0 = i; if (i > x.i1) x.i1 = i; if (j < x.j0) x.j0 = j; if (j > x.j1) x.j1 = j;
    };
    for (let q = 0; q < A.length; q++) {
      if (A[q] === B[q]) continue;
      for (let k = 4 * q; k < 4 * q + 4; k++) if (a[k] !== b[k]) mark(k);
    }
    if (ta && tb) for (let k = 0; k < N * N; k++) if (ta[k] !== tb[k]) mark(k);
    return bx.filter(x => x.i1 >= 0);
  }
  function diffBox(a, b) { // the box round every difference, or null
    const bs = diffBoxes(a, b);
    return bs.length ? bs.reduce((u, x) => ({ i0: Math.min(u.i0, x.i0), j0: Math.min(u.j0, x.j0), i1: Math.max(u.i1, x.i1), j1: Math.max(u.j1, x.j1) })) : null;
  }
  const grow = (b, r) => ({ i0: Math.max(b.i0 - r, 0), j0: Math.max(b.j0 - r, 0), i1: Math.min(b.i1 + r, N - 1), j1: Math.min(b.j1 + r, N - 1) });

  // ---- the 3-D mesh ---------------------------------------------------------------------------------------------
  // meshIndex reads the ground model's vertices (each mesh's positions, normals and colours, kept with the originals)
  // and finds each one's vertex of the 321 x 321 grid; null when the model isn't such a grid (then nothing is patched)
  function meshIndex(gm) {
    const m = gm.model, src = m.src, base = baseGrid(gm.doc);
    if (!src || !base) return null;
    const size = base.T.size, cell = 2 * (size / N), doc = src.doc, bin = src.bin;
    const sets = [], seen = new Map(), tex = new Map(), head = new Int32Array(NV * NV).fill(-1), next = [], setOf = [], local = [];
    const Z0 = new Float32Array(NV * NV).fill(NaN), H = m.heights, hcell = new Int32Array(NV * NV).fill(-1);
    const read = (ai, Type, n) => {
      const a = doc.accessors[ai], v = doc.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0);
      if ((v.byteStride || 0) !== 0 && v.byteStride !== n * Type.BYTES_PER_ELEMENT) return null; // interleaved: not mapc's
      return { arr: new Type(bin.slice(off, off + a.count * n * Type.BYTES_PER_ELEMENT)), buf: src.views[a.bufferView].buf, off: a.byteOffset || 0 };
    };
    for (const node of doc.nodes) {
      for (const p of doc.meshes[node.mesh].primitives) {
        const at = p.attributes;
        if (seen.has(at.POSITION)) continue;
        seen.set(at.POSITION, true);
        const pos = read(at.POSITION, Float32Array, 3);
        if (!pos) return null;
        const nrm = at.NORMAL !== undefined ? read(at.NORMAL, Float32Array, 3) : null;
        const col = at.COLOR_0 !== undefined && doc.accessors[at.COLOR_0].componentType === 5121 ? read(at.COLOR_0, Uint8Array, 4) : null;
        const s = { pos, nrm, col, pos0: pos.arr.slice(), nrm0: nrm && nrm.arr.slice(), col0: col && col.arr.slice(), lo: Infinity, hi: -1 };
        const k = sets.length;
        sets.push(s);
        const n = pos.arr.length / 3;
        // the live paint: the mesh's first material's texture (a bake tile) and how its UVs follow the world (affine:
        // from the first vertex and the first ones a step away in x and in y)
        const mt = p.material !== undefined && doc.materials && doc.materials[p.material], bt = mt && mt.pbrMetallicRoughness && mt.pbrMetallicRoughness.baseColorTexture;
        const uv = bt && at.TEXCOORD_0 !== undefined ? read(at.TEXCOORD_0, Float32Array, 2) : null;
        if (uv && n > 2) {
          const url = m.url.slice(0, m.url.lastIndexOf('/') + 1) + doc.images[doc.textures[bt.index].source].uri, P = pos.arr, U = uv.arr;
          let qx = -1, qy = -1;
          for (let q = 1; q < n && (qx < 0 || qy < 0); q++) { if (qx < 0 && P[3 * q] !== P[0] && P[3 * q + 2] === P[2]) qx = q; if (qy < 0 && P[3 * q + 2] !== P[2] && P[3 * q] === P[0]) qy = q; }
          if (qx > 0 && qy > 0 && !tex.has(url)) {
            const ax = (U[2 * qx] - U[0]) / (P[3 * qx] - P[0]), ay = (U[2 * qy + 1] - U[1]) / (-P[3 * qy + 2] + P[2]);
            tex.set(url, { ax, bx: U[0] - ax * P[0], ay, by: U[1] - ay * -P[2] });
          }
        }
        for (let q = 0; q < n; q++) {
          const x = pos.arr[3 * q], z = pos.arr[3 * q + 1], y = -pos.arr[3 * q + 2];
          const vi = Math.round(x / cell) + GH, vj = Math.round(y / cell) + GH;
          if (vi < 0 || vj < 0 || vi > GRID || vj > GRID || Math.abs(x - (vi - GH) * cell) > 0.01 || Math.abs(y - (vj - GH) * cell) > 0.01) return null;
          const g = vj * NV + vi, id = next.length;
          next.push(head[g]); setOf.push(k); local.push(q);
          head[g] = id;
          Z0[g] = z;
          if (H) hcell[g] = Math.floor(y - H.y0) * H.nx + Math.floor(x - H.x0);
        }
      }
    }
    if (Z0.some(isNaN)) return null; // a vertex of the grid missing
    return { model: m, base, size, cell, sets, tex, head, next: Int32Array.from(next), setOf: Int32Array.from(setOf), local: Int32Array.from(local),
      Z0, Zl: Z0.slice(), on: new Uint8Array(NV * NV), dl: new Float64Array(NV * NV), hl: new Float64Array(NV * NV), hcell, dirty: null, rev: -1 };
  }
  // the vertices whose raster cell lies in the cell box b (outside the grid: the edge cells', as Field.At clamps)
  function vertexBox(b) {
    return { i0: b.i0 <= 0 ? 0 : Math.ceil((b.i0 + 64) / 2), j0: b.j0 <= 0 ? 0 : Math.ceil((b.j0 + 64) / 2),
      i1: b.i1 >= N - 1 ? GRID : Math.floor((b.i1 + 64) / 2), j1: b.j1 >= N - 1 ? GRID : Math.floor((b.j1 + 64) / 2) };
  }
  const vgrow = (b, r) => ({ i0: Math.max(b.i0 - r, 0), j0: Math.max(b.j0 - r, 0), i1: Math.min(b.i1 + r, GRID), j1: Math.min(b.j1 + r, GRID) });
  const vunion = (a, b) => !a ? b : !b ? a : { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
  const clampD = (d, hi) => Math.min(Math.max(d, DLO), hi === undefined ? DHI : hi);
  function spawnCentres() { // the bases' tints are centred there (mapc GroundSpec: the spawn points' centres)
    const objs = (S.preview && S.preview.objects) || [];
    return [1, 2].map(t => {
      const sp = objs.filter(o => o.kind === 'spawn' && o.team === t);
      return sp.length ? [sp.reduce((a, o) => a + o.pos[0], 0) / sp.length, sp.reduce((a, o) => a + o.pos[1], 0) / sp.length] : null;
    });
  }

  // patchMesh makes the drawn ground follow the live raster: the vertices whose signed distance (clamped where it no
  // longer matters) or chasm differs from the mesh's own document get height() and colour(), their neighbours new
  // normals; every other vertex keeps (or gets back) the compiler's values. V3D's heights (heightAt) follow.
  function patchMesh() {
    const gm = typeof V3D !== 'undefined' && V3D.groundModel();
    if (!gm || !R.grid) return;
    if (!R.mesh || R.mesh.model !== gm.model) {
      R.mesh = meshIndex(gm);
      if (!R.mesh) { R.mesh = { model: gm.model, bad: true }; log('3-D: the live ground preview can\'t read this ground mesh'); }
    }
    const M = R.mesh;
    if (M.bad || M.rev === R.rev) return;
    M.rev = R.rev;
    if (R.T.size !== M.size) return; // a new size: the compiler's ground comes next
    const t0 = performance.now(), c = M.size / N, cell = M.cell;
    // EDUX9: with authored heights in either document the tops count too (a height drag changes no kind), and a taller
    // plateau's cliff and hills reach farther: past the band's end, its hills (hi + 1.5 + 8 m)
    const hasH = R.T.heights || M.base.T.heights, dhi = Math.max(DHI, cliffEnd(Math.max(R.T.hmax, M.base.T.hmax)) + RELIEF.rollFrom + 8);
    const liveTops = hasH ? (R.tops || topsOf({ grid: R.grid, tops: null })) : null, baseTops = hasH ? topsOf(M.base) : null;
    const boxes = diffBoxes(M.base.grid, R.grid, baseTops, liveTops);
    const t1 = performance.now();
    note('diff', t1 - t0);
    const reach = Math.ceil((dhi - DHI + REACH) / c) + 1, rad = blendRad(M.size);
    const vbs = boxes.map(b => vertexBox(grow(b, reach)));
    // the vertices to look at: round each team's changes and where the last steps patched (boxes kept apart: one box
    // round a change and its mirror would hold the map's middle)
    const regions = vbs.concat(M.dirty || []);
    if (!regions.length) return;
    const on = M.on;
    for (const rg of regions) for (let j = rg.j0; j <= rg.j1; j++) on.fill(0, j * NV + rg.i0, j * NV + rg.i1 + 1); // the old marks
    const marks = [];
    boxes.forEach((box, bi) => {
      let marked = null;
      const vb = vbs[bi], w = grow(box, 2 * reach), Fl = field(R.grid, w, c), Fb = field(M.base.grid, w, c);
      const Bl = R.T.heights ? blendWin(liveTops, w, rad) : null, Bb = M.base.T.heights ? blendWin(baseTops, w, rad) : null;
      for (let j = vb.j0; j <= vb.j1; j++) {
        const y = (j - GH) * cell, cj = cellOf(y, c);
        for (let i = vb.i0; i <= vb.i1; i++) {
          const x = (i - GH) * cell, ci = cellOf(x, c), k = cj * N + ci;
          const dl = fieldAt(Fl, x, y, M.size), db = fieldAt(Fb, x, y, M.size);
          const downL = R.grid[k] === CHASM, downB = M.base.grid[k] === CHASM;
          // the blended height there (relief.go cliff(): only past the edge, else the plateau)
          const hl = Bl && dl > 0 ? topAt(Bl, x, y, downL, M.size) : RELIEF.plateau, hb = Bb && db > 0 ? topAt(Bb, x, y, downB, M.size) : RELIEF.plateau;
          if (clampD(dl, dhi) === clampD(db, dhi) && downL === downB && hl === hb) continue;
          const g = j * NV + i;
          on[g] = 1;
          M.dl[g] = dl;
          M.hl[g] = hl;
          marked = marked ? vunion(marked, { i0: i, j0: j, i1: i, j1: j }) : { i0: i, j0: j, i1: i, j1: j };
        }
      }
      if (marked) marks.push(vgrow(marked, 1));
    });
    const t2 = performance.now();
    note('field', t2 - t1);
    // heights
    const Zl = M.Zl, Z0 = M.Z0, H = V3D.V.heights, bases = spawnCentres();
    let nv = 0;
    for (const region of regions) for (let j = region.j0; j <= region.j1; j++) {
      for (let i = region.i0; i <= region.i1; i++) {
        const g = j * NV + i, z = on[g] ? height(M.dl[g], (i - GH) * cell, (j - GH) * cell, R.grid[cellOf((j - GH) * cell, c) * N + cellOf((i - GH) * cell, c)] === CHASM, M.hl[g]) : Z0[g];
        if (Zl[g] === Math.fround(z)) continue;
        Zl[g] = z;
        nv++;
        for (let id = M.head[g]; id >= 0; id = M.next[id]) { const s = M.sets[M.setOf[id]], q = M.local[id]; s.pos.arr[3 * q + 1] = z; s.lo = Math.min(s.lo, q); s.hi = Math.max(s.hi, q); }
        if (H && M.hcell[g] >= 0 && M.hcell[g] < H.z.length) { H.z[M.hcell[g]] = z; if (z > H.zmax) H.zmax = z; if (z < H.zmin) H.zmin = z; }
      }
    }
    // normals (ground.go's central differences; the compiler's own where neither the vertex nor a neighbour moved) and
    // colours
    for (const nb of regions.map(rg => vgrow(rg, 1))) for (let j = nb.j0; j <= nb.j1; j++) {
      for (let i = nb.i0; i <= nb.i1; i++) {
        const g = j * NV + i, ia = Math.max(i - 1, 0), ib = Math.min(i + 1, GRID), ja = Math.max(j - 1, 0), jb = Math.min(j + 1, GRID);
        const moved = Zl[g] !== Z0[g] || Zl[j * NV + ia] !== Z0[j * NV + ia] || Zl[j * NV + ib] !== Z0[j * NV + ib] || Zl[ja * NV + i] !== Z0[ja * NV + i] || Zl[jb * NV + i] !== Z0[jb * NV + i];
        let n = null, rgb = null;
        if (moved) {
          const zx = (Zl[j * NV + ib] - Zl[j * NV + ia]) / ((ib - ia) * cell), zy = (Zl[jb * NV + i] - Zl[ja * NV + i]) / ((jb - ja) * cell);
          const ln = Math.sqrt(zx * zx + zy * zy + 1);
          n = [-zx / ln, 1 / ln, zy / ln]; // glTF's (x, z, -y)
        }
        if (on[g]) rgb = colour(M.dl[g], Zl[g], (i - GH) * cell, (j - GH) * cell, bases, M.hl[g]);
        for (let id = M.head[g]; id >= 0; id = M.next[id]) {
          const s = M.sets[M.setOf[id]], q = M.local[id];
          if (s.nrm) for (let a = 0; a < 3; a++) s.nrm.arr[3 * q + a] = n ? n[a] : s.nrm0[3 * q + a];
          if (s.col) for (let a = 0; a < 3; a++) s.col.arr[4 * q + a] = rgb ? Math.min(255, Math.max(0, Math.round(rgb[a] * 255))) : s.col0[4 * q + a];
          s.lo = Math.min(s.lo, q); s.hi = Math.max(s.hi, q);
        }
      }
    }
    // to the GL buffers: each mesh's changed range
    const gl = V3D.V.gl;
    for (const s of M.sets) {
      if (s.hi < 0) continue;
      for (const [a, k] of [[s.pos, 3], [s.nrm, 3], [s.col, 4]]) {
        if (!a) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, a.off + s.lo * k * a.arr.BYTES_PER_ELEMENT, a.arr.subarray(s.lo * k, (s.hi + 1) * k));
      }
      s.lo = Infinity; s.hi = -1;
    }
    M.dirty = marks.length ? marks : null;
    note('mesh', performance.now() - t2);
    note('vertices', nv);
    note('frame', performance.now() - t0);
  }
  // paintedAt: for the self-test, each ground texture's pixel at world point w: the picture's and the painted copy's
  function paintedAt(w) {
    const M = R.mesh, P = R.paint, out = [];
    if (!M || !M.tex || !P) return out;
    for (const [url, A] of M.tex) {
      const T = P.tex.get(url), t = V3D.V.textures.get(url);
      if (!T || !T.C || !t) continue;
      const px = Math.floor((A.ax * w[0] + A.bx) * T.C.c.width), py = Math.floor((A.ay * w[1] + A.by) * T.C.c.height);
      if (px < 0 || py < 0 || px >= T.C.c.width || py >= T.C.c.height) continue;
      out.push({ url: url.split('/').pop(), px, py, was: Array.from(T.C.c0.getContext('2d').getImageData(px, py, 1, 1).data), now: Array.from(T.C.g.getImageData(px, py, 1, 1).data) });
    }
    return out;
  }
  // the live heights of the mesh's grid now, and the compiler's: for the self-test's comparison
  function meshHeights() {
    const M = R.mesh;
    return M && !M.bad ? { Zl: M.Zl, Z0: M.Z0, cell: M.cell, model: M.model, on: M.on, dirty: M.dirty } : null;
  }

  // ---- 2-D: the cells whose kind changed, over the layout or the bake ---------------------------------------------
  function draw2d(g) {
    if (!S.doc || ED.view !== '2d') return;
    sync();
    if (!R.grid) return;
    const bake = ED.bakeShown ? ED.bakeShown() : null;
    const from = bake ? bake.from : (S.bg === 'layout.png' && S.img ? S.previewJSON : '');
    const base = baseGrid(from);
    if (!base || base.T.size !== R.T.size) return;
    let P = R.patch2d;
    if (!P || P.rev !== R.rev || P.base !== base) {
      const t0 = performance.now(), box = diffBox(base.grid, R.grid);
      P = R.patch2d = { rev: R.rev, base, box, canvas: null };
      if (box) {
        const W = box.i1 - box.i0 + 1, Hh = box.j1 - box.j0 + 1, cv2 = document.createElement('canvas');
        cv2.width = W; cv2.height = Hh;
        const g2 = cv2.getContext('2d'), im = g2.createImageData(W, Hh);
        for (let j = box.j0; j <= box.j1; j++) {
          for (let i = box.i0; i <= box.i1; i++) {
            const k = j * N + i;
            if (base.grid[k] === R.grid[k]) continue;
            const rgb = LAYOUT_RGB[R.grid[k]] || [255, 0, 255], o = 4 * ((box.j1 - j) * W + (i - box.i0));
            im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2]; im.data[o + 3] = 255;
          }
        }
        g2.putImageData(im, 0, 0);
        P.canvas = cv2;
      }
      note('diff', performance.now() - t0);
    }
    if (P.canvas) {
      const c = R.T.c, hf = R.T.size / 2, b = P.box;
      const a = w2s([-hf + b.i0 * c, -hf + (b.j1 + 1) * c]), z = w2s([-hf + (b.i1 + 1) * c, -hf + b.j0 * c]);
      g.save();
      g.globalAlpha = bake ? 1 : S.bgAlpha;
      g.imageSmoothingEnabled = false;
      g.drawImage(P.canvas, a[0], a[1], z[0] - a[0], z[1] - a[1]);
      g.restore();
    }
    if (bake) { // the texture strokes and stamps since the bake, painted over it
      const items = liveItems(bake.from);
      if (!items.length) return;
      const o = w2s([0, 0]), ex = w2s([1, 0]), ey = w2s([0, 1]);
      g.save();
      g.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
      items.forEach(it => paintItem(g, it));
      g.restore();
    }
  }

  // ---- the live texture paint ----------------------------------------------------------------------------------
  // The texture strokes (a layer's mask shapes) and stamps the document has that the bake (2-D) or the 3-D ground's
  // textures were made without, and the stroke being drawn, painted straight onto them: the layer's texture (its
  // picture at its scale in metres a repeat, its turn, tint and opacity) inside the shape, a stamp's picture; their
  // mirrors too. Approximate: hard edges (no soft edge, no noise), laid over the layers above, an eraser's stroke and a
  // removed one wait for the bake; the bake (and the ground made with it) replaces it when it comes.
  const PICS = new Map(); // picture URL -> {img, tinted: tint -> canvas}
  function picOf(url) {
    let p = PICS.get(url);
    if (!p) {
      p = { img: new Image(), tinted: new Map() };
      p.img.onload = () => { if (ED.view === '2d') render(); else if (typeof V3D !== 'undefined') { if (R.paint) R.paint.tex.forEach(T => { T.keys = new Map(); }); V3D.redraw(); } }; // painted again with it
      p.img.src = url;
      PICS.set(url, p);
    }
    return p.img.complete && p.img.naturalWidth ? p : null;
  }
  function tinted(p, tint) {
    const key = tint ? tint.join() : '';
    let c = p.tinted.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = p.img.naturalWidth; c.height = p.img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true }); // on the CPU, as the canvases it is drawn into (no read-back a draw)
      g.drawImage(p.img, 0, 0);
      if (tint) {
        const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
        for (let i = 0; i < d.length; i += 4) for (let a = 0; a < 3; a++) d[i + a] = Math.min(255, d[i + a] * (+tint[a] || 0));
        g.putImageData(im, 0, 0);
      }
      p.tinted.set(key, c);
    }
    return c;
  }
  const JDOC = new Map(); // map.json text -> its document (the last few)
  function docOf(json) {
    if (!json) return null;
    if (!JDOC.has(json)) {
      let d = null;
      try { d = JSON.parse(json); } catch (e) { d = null; }
      JDOC.set(json, d);
      while (JDOC.size > 4) JDOC.delete(JDOC.keys().next().value);
    }
    return JDOC.get(json);
  }
  // liveItems: what to paint over a ground made from the map.json text from: [{k, l, sh}] (layer k's new mask shapes,
  // then the stroke being drawn) and [{stamp}] (new or moved stamps), in the bake's order
  function liveItems(from) {
    const gr = S.doc && S.doc.ground, live = ED.groundLive;
    if (!gr || gr.style !== 'baked' || !Array.isArray(gr.layers) || !live) return [];
    const base = docOf(from), bg = base && base.ground && typeof base.ground === 'object' ? base.ground : {};
    const bl = Array.isArray(bg.layers) ? bg.layers : [], out = [], st = live.stroke();
    gr.layers.forEach((l, k) => {
      if (!l || k < live.first()) return;
      const have = new Map();
      ((bl[k] && Array.isArray(bl[k].shapes)) ? bl[k].shapes : []).forEach(s => { const j = JSON.stringify(s); have.set(j, (have.get(j) || 0) + 1); });
      for (const s of Array.isArray(l.shapes) ? l.shapes : []) {
        const j = JSON.stringify(s), n = have.get(j);
        if (n) { have.set(j, n - 1); continue; }
        if (!s.erase) out.push({ k, l, sh: s });
      }
      if (st && st.k === k && !st.sh.erase) out.push({ k, l, sh: st.sh });
    });
    const haveS = new Set((Array.isArray(bg.stamps) ? bg.stamps : []).map(s => JSON.stringify(s)));
    for (const s of Array.isArray(gr.stamps) ? gr.stamps : []) if (s && Array.isArray(s.pos) && Array.isArray(s.size) && !haveS.has(JSON.stringify(s))) out.push({ stamp: s });
    return out;
  }
  const mirSh = sh => {
    const m = Object.assign({}, sh);
    if (sh.circle) m.circle = [-sh.circle[0], -sh.circle[1]];
    if (sh.polygon) m.polygon = sh.polygon.map(p => [-p[0], -p[1]]);
    if (sh.path) m.path = sh.path.map(p => [-p[0], -p[1]]);
    return m;
  };
  // the path and width of a mask shape that follows a lane ({"lane": id})
  function laneOf(sh) {
    if (sh.lane === undefined) return sh;
    const ln = lanes().find(l => l && l.id === sh.lane);
    return ln && Array.isArray(ln.knots) ? { path: ln.knots, width: +sh.width || +ln.width || 10 } : {};
  }
  // itemBox: an item's extent in the world (with its mirror)
  function itemBoxes(it) { // its box and its mirror's (apart: one box round both would hold the map's middle)
    const b = [Infinity, Infinity, -Infinity, -Infinity], add = (p, r) => { b[0] = Math.min(b[0], p[0] - r); b[1] = Math.min(b[1], p[1] - r); b[2] = Math.max(b[2], p[0] + r); b[3] = Math.max(b[3], p[1] + r); };
    if (it.stamp) add(it.stamp.pos, Math.hypot(it.stamp.size[0], it.stamp.size[1]) / 2 + 1);
    else {
      const sh = laneOf(it.sh);
      if (isPt(sh.circle)) add(sh.circle, (+sh.r || 0) + 1);
      for (const p of (Array.isArray(sh.polygon) ? sh.polygon : Array.isArray(sh.path) ? sh.path : [])) if (isPt(p)) add(p, (+sh.width || 0) / 2 + 1);
    }
    return [b, [-b[2], -b[3], -b[0], -b[1]]];
  }
  // paintItem paints one item on g, whose transform maps world metres to its pixels
  function paintItem(g, it) {
    const live = ED.groundLive;
    g.save();
    if (it.stamp) {
      const s = it.stamp, url = live.texURL(s.image), p = url ? picOf(url) : null;
      if (p) {
        for (const m of s.mirror === false ? [false] : [false, true]) {
          g.save();
          g.translate(m ? -s.pos[0] : s.pos[0], m ? -s.pos[1] : s.pos[1]);
          g.rotate(((+s.rot || 0) + (m ? 180 : 0)) * Math.PI / 180);
          g.scale(1, -1); // the picture's top to the north (the world's y is up)
          g.globalAlpha = s.opacity !== undefined ? +s.opacity : 1;
          g.drawImage(p.img, -s.size[0] / 2, -s.size[1] / 2, s.size[0], s.size[1]);
          g.restore();
        }
      }
      g.restore();
      return;
    }
    const l = it.l, url = live.texURL(l.texture), p = url ? picOf(url) : null;
    if (p) {
      const c = tinted(p, Array.isArray(l.tint) ? l.tint : null), pat = g.createPattern(c, 'repeat'), sc = +l.scale || 16;
      pat.setTransform(new DOMMatrix().rotateSelf(0, 0, +l.rot || 0).scaleSelf(sc / c.width, -sc / c.height));
      g.fillStyle = g.strokeStyle = pat;
    } else g.fillStyle = g.strokeStyle = live.colour(l.texture);
    g.globalAlpha = l.opacity !== undefined ? Math.min(1, Math.max(0, +l.opacity)) : 1;
    g.lineCap = g.lineJoin = 'round';
    for (const m of l.mirror === false ? [false] : [false, true]) {
      const sh = laneOf(m ? mirSh(it.sh) : it.sh), shm = m && it.sh.lane !== undefined ? mirSh(sh) : sh;
      g.beginPath();
      if (isPt(shm.circle)) { g.arc(shm.circle[0], shm.circle[1], Math.max(0, +shm.r || 0), 0, 2 * Math.PI); g.fill(); }
      else if (Array.isArray(shm.polygon) && shm.polygon.every(isPt)) { shm.polygon.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill('evenodd'); }
      else if (Array.isArray(shm.path) && shm.path.length && shm.path.every(isPt)) {
        g.lineWidth = Math.max(0.1, +shm.width || 1);
        const pts = shm.path.length === 1 ? [shm.path[0], shm.path[0]] : shm.path;
        pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]));
        g.stroke();
      }
    }
    g.restore();
  }
  // paint3d: the items onto the 3-D ground's textures (each a bake tile; a canvas copy of the parts painted, sent to
  // the GL texture by the changed rectangle; mipmaps left: the painted texture is drawn from its full size)
  function paint3d() {
    const gm = V3D.groundModel(), M = R.mesh;
    if (!gm || !M || M.bad || M.model !== gm.model || !M.tex.size) return;
    let P = R.paint;
    if (!P || P.model !== gm.model) P = R.paint = { model: gm.model, tex: new Map() };
    const items = liveItems(gm.doc), keys = new Map();
    items.forEach((it, i) => keys.set(i + ':' + JSON.stringify(it.stamp ? ['s', it.stamp] : [it.k, it.sh, it.l.texture, it.l.scale, it.l.rot, it.l.tint, it.l.opacity, it.l.mirror]), it));
    const t0 = performance.now(), gl = V3D.V.gl, list = [...keys.values()], boxes = new Map();
    const boxOf = k => { if (!boxes.has(k)) boxes.set(k, itemBoxes(keys.get(k))); return boxes.get(k); };
    let painted = 0, waiting = 0;
    for (const [url, A] of M.tex) {
      // each texture by itself, once it has loaded (a ground just drawn may still be loading them: the load's own
      // upload would cover a paint sent before it)
      const t = V3D.V.textures.get(url);
      if (!t || !t.ok || !t.img || !t.img.naturalWidth) { waiting++; continue; }
      let T = P.tex.get(url);
      if (!T) P.tex.set(url, T = { keys: new Map(), C: null });
      const dirty = [];
      for (const k of keys.keys()) if (!T.keys.has(k)) dirty.push(...boxOf(k));
      for (const [k, bs] of T.keys) if (!keys.has(k)) dirty.push(...bs);
      if (!dirty.length) continue;
      T.keys = new Map([...keys.keys()].map(k => [k, boxOf(k)]));
      const W = t.img.naturalWidth, H = t.img.naturalHeight;
      for (const box of dirty) {
        const xs = [box[0], box[2]].map(x => (A.ax * x + A.bx) * W), ys = [box[1], box[3]].map(y => (A.ay * y + A.by) * H);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2), x1 = Math.min(W, Math.ceil(Math.max(...xs)) + 2);
        const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2), y1 = Math.min(H, Math.ceil(Math.max(...ys)) + 2);
        if (x1 <= x0 || y1 <= y0) continue;
        if (!T.C) {
          const c = document.createElement('canvas'), c0 = document.createElement('canvas');
          c.width = c0.width = W; c.height = c0.height = H;
          c0.getContext('2d', { willReadFrequently: true }).drawImage(t.img, 0, 0);
          T.C = { c, c0, g: c.getContext('2d', { willReadFrequently: true }) };
          T.C.g.drawImage(c0, 0, 0);
        }
        const g = T.C.g;
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(x0, y0, x1 - x0, y1 - y0);
        g.drawImage(T.C.c0, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.setTransform(A.ax * W, 0, 0, A.ay * H, A.bx * W, A.by * H);
        list.forEach(it => paintItem(g, it));
        g.restore();
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, gl.RGBA, gl.UNSIGNED_BYTE, g.getImageData(x0, y0, x1 - x0, y1 - y0));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        painted++;
      }
    }
    R.stats.waiting = waiting;
    if (!painted) return;
    note('paint', performance.now() - t0);
    R.stats.painted = (R.stats.painted || 0) + painted;
  }

  // ---- self-tests (?open=CM_Marsh&selftest=draw3d | live3d) and the pictures' poses (&pose4=) ---------------------
  // T3 drives the 3-D view by real events at world points (whole client pixels, as a mouse gives them)
  const T3 = {
    client(p) {
      const s = V3D.project(p), cv = V3D.V.canvas;
      if (!s) return null;
      const r = cv.getBoundingClientRect();
      return { clientX: Math.round(r.left + s[0] * r.width / cv.width), clientY: Math.round(r.top + s[1] * r.height / cv.height) };
    },
    down(p, o) { V3D.V.canvas.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1 }, T3.client(p), o || {}))); },
    move(p, o) { window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 1 }, T3.client(p), o || {}))); },
    up(p) { window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ bubbles: true, button: 0 }, T3.client(p)))); },
    click(p) { T3.down(p); T3.up(p); },
    dbl(p) { V3D.V.canvas.dispatchEvent(new MouseEvent('dblclick', Object.assign({ bubbles: true, button: 0 }, T3.client(p)))); },
    look(p, dist) { V3D.V.cam.dist = dist || 60; V3D.setTarget(p[0], p[1]); V3D.frame(); },
    // overlay pixels drawn (alpha > 0) in a box of half-size h round canvas pixel s
    inked(s, hh) {
      const ov = V3D.V.ov;
      if (!s) return 0;
      const x0 = Math.max(0, Math.round(s[0] - hh)), y0 = Math.max(0, Math.round(s[1] - hh)), w = Math.min(ov.width - x0, 2 * hh), hgt = Math.min(ov.height - y0, 2 * hh);
      if (w <= 0 || hgt <= 0) return 0;
      const d = V3D.V.octx.getImageData(x0, y0, w, hgt).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    },
  };
  // ready: the 3-D view shown with its scene, its ground (read by the live preview) and the nouns
  async function ready(ms) {
    V3D.activate();
    const ok = await V3D.until(() => V3D.settled() && V3D.V.heights && V3D.groundModel() && typeof PR !== 'undefined' && PR.P.state === 'ready', ms);
    V3D.gameCamera();
    V3D.frame();
    return ok && !!RL.meshHeights();
  }
  // openSpots: n spots of flat open ground on team 1's half, a disc of r metres round each open, away from the lanes,
  // the objects and the doodads, apart metres from each other
  function openSpots(n, r, apart) {
    const L = lanes().filter(l => l && Array.isArray(l.knots) && l.knots.every(isPt)), obs = objects(), items = PR.live(), out = [];
    const pv = ((S.preview && S.preview.objects) || []).filter(o => isPt(o.pos));
    const ok = p => {
      if (p[0] + p[1] > -2 * r - 12 || pv.some(o => Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < r + 12)) return false; // off the base and the placed objects
      for (let a = 0; a < 12; a++) for (const rr of [0, r / 2, r]) {
        const q = [p[0] + rr * Math.cos(a * Math.PI / 6), p[1] + rr * Math.sin(a * Math.PI / 6)];
        if (FR.groundKind(q).kind !== 'open' || Math.abs(V3D.heightAt(q[0], q[1])) > 0.3) return false;
      }
      if (L.some(l => distLine(p, l.knots) < (+l.width || 0) / 2 + r + 1)) return false;
      if (obs.some(o => Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < r + 5)) return false;
      if (items.some(it => Math.hypot(it.pos[0] - p[0], it.pos[1] - p[1]) < r + 3 || Math.hypot(it.pos[0] + p[0], it.pos[1] + p[1]) < r + 3)) return false;
      return !out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < apart);
    };
    const hf = (+S.doc.size || 400) / 2 - r - 10;
    for (let y = -hf; y <= hf && out.length < n; y += 4) for (let x = -hf; x <= hf && out.length < n; x += 4) if (ok([x, y])) out.push([x, y]);
    return out;
  }
  // the grid vertex nearest a world point, and the live and compiled heights there
  function vtx(p) {
    const M = R.mesh;
    if (!M || M.bad) return null;
    const i = Math.round(p[0] / M.cell) + GH, j = Math.round(p[1] / M.cell) + GH, g = j * NV + i;
    return { g, live: M.Zl[g], mesh: M.Z0[g] };
  }
  // the pixel (RGBA) of a picture the check or the bake made, at world point p over the square of half-size hf (the
  // check's pictures: the map's size, row 0 north)
  async function pixels(url, hf, pts) {
    const img = new Image();
    img.src = url;
    await new Promise(res => { img.onload = res; img.onerror = res; });
    if (!img.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return pts.map(p => {
      const px = Math.min(c.width - 1, Math.max(0, Math.floor((p[0] + hf) / (2 * hf) * c.width))), py = Math.min(c.height - 1, Math.max(0, Math.floor((hf - p[1]) / (2 * hf) * c.height)));
      return Array.from(g.getImageData(px, py, 1, 1).data);
    });
  }
  const KIND_RGB = [['open', LAYOUT_RGB[OPEN]], ['wall', LAYOUT_RGB[WALL]], ['chasm', LAYOUT_RGB[CHASM]], ['island', LAYOUT_RGB[ISLAND]], ['solid', [120, 84, 52]]];
  const kindOf = px => px ? KIND_RGB.reduce((b, k) => { const e = (px[0] - k[1][0]) ** 2 + (px[1] - k[1][1]) ** 2 + (px[2] - k[1][2]) ** 2; return e < b[0] ? [e, k[0]] : b; }, [Infinity, ''])[1] : '?';
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  const fmt = v => v.toFixed(2);
  // settle: the check of the document now (not the timer's), then the 3-D ground the compiler makes from it drawn
  async function settleGround(ms) {
    clearTimeout(S.checkTimer);
    await runCheck();
    const want = S.checkedJSON;
    return V3D.until(() => { V3D.frame(); return !V3D.V.groundBusy && !V3D.V.groundNext && V3D.V.groundDoc === want && V3D.settled(); }, ms || 90000);
  }
  function out() {
    const el = $('selftest'), lines = [];
    el.classList.remove('hidden');
    return { say(ok, msg) { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); el.textContent = lines.join('\n'); return ok; },
      finish(name, ok) { this.say(ok, ok ? `selftest ${name} passed` : `selftest ${name} failed`); document.title = ok ? `selftest ${name} passed` : `selftest ${name} failed`; document.body.dataset.selftest = ok ? 'passed' : 'failed'; } };
  }

  // live3d: the live ground preview by real events in 3-D on CM_Marsh: a wall stroke rises while it is drawn (timed:
  // the input and the frame of each drag step), stays up until the compiler's mesh for that document comes and then
  // matches it (heights sampled over every vertex the preview touched); a chasm polygon drops at once and matches too;
  // a lane knot dragged moves the corridor's relief while the drag is under way; undo restores the mesh
  async function selftestLive() {
    const o = out();
    let ok = true;
    ok &= o.say(await V3D.until(() => S.doc && S.preview, 60000), 'a map open: ' + S.pkg);
    ok &= o.say(await ready(300000), '3-D: the scene, the ground and its grid read by the live preview (' + (R.mesh && R.mesh.sets ? R.mesh.sets.length + ' meshes' : 'none') + ')');
    if (!R.mesh || R.mesh.bad) return o.finish('live3d', false);
    { // the method's measure: a full raster of the map (the base of every compiled thing) against the windowed updates
      const T = terrainOf(S.doc), full = [];
      for (let q = 0; q < 5; q++) { const t0 = performance.now(); rasterise(T); full.push(performance.now() - t0); }
      const t1 = performance.now(), F = field(R.grid, ALL, T.c), t2 = performance.now();
      o.say(F.D.length === N * N, `a full raster of ${S.pkg} (${T.list.length} shapes) ${fmt(med(full))} ms; the whole field ${fmt(t2 - t1)} ms; a difference scan ${fmt(med(R.stats.diff))} ms`);
    }
    const [P, Q] = openSpots(2, 10, 30);
    ok &= o.say(P && Q, `two spots of open ground: (${P}), (${Q})`);
    if (!P || !Q) o.say(false, 'spots of open ground with r 5: ' + openSpots(20, 5, 10).map(p => '(' + p + ')').join(' '));
    if (!P || !Q) return o.finish('live3d', false);
    const doc0 = snapshot(), snap0 = S.snap, size0 = S.brush.size;
    S.snap = true;
    select(null);
    // (1) a wall with the brush: it rises while the stroke is drawn
    T3.look(P, 55);
    setCliff('wall'); setDraw('brush'); S.brush.size = 10;
    const A = [P[0] - 8, P[1] + 2], B = [P[0] + 8, P[1] - 2], mid = [P[0], P[1]], n0 = R.stats.frame.length;
    const steps = [], inputs = [], idle = [];
    for (let k = 0; k < 12; k++) { const t0 = performance.now(); V3D.frame(); idle.push(performance.now() - t0); } // the same view without an edit
    const f0 = V3D.V.frameMs.length;
    T3.down(A);
    for (let k = 1; k <= 16; k++) {
      const p = [A[0] + (B[0] - A[0]) * k / 16, A[1] + (B[1] - A[1]) * k / 16], t0 = performance.now();
      T3.move(p);
      const t1 = performance.now();
      V3D.frame();
      inputs.push(t1 - t0);
      steps.push(performance.now() - t0);
    }
    const vm = vtx(mid), side = vtx([P[0], P[1] + 14]);
    ok &= o.say(S.stroke && vm && vm.live > 4.2 && vm.mesh < 0.3 && Math.abs(side.live - side.mesh) < 1e-6 && V3D.heightAt(mid[0], mid[1]) > 4.2,
      `mid-stroke, before the release: the ground under the stroke at ${fmt(vm.live)} m (the compiler's mesh there ${fmt(vm.mesh)} m), 14 m beside it unchanged, heightAt ${fmt(V3D.heightAt(mid[0], mid[1]))} m`);
    const live = R.stats.frame.slice(n0), fr = V3D.V.frameMs.slice(f0), ovm = V3D.V.overlayMs.slice(f0), lsm = V3D.V.listMs.slice(f0);
    ok &= o.say(med(steps) < 16.7, `a drag step (the input: pick, stroke, redraw; then the frame with the live ground): median ${fmt(med(steps))} ms, max ${fmt(Math.max(...steps))} ms; the input ${fmt(med(inputs))} ms; the frame ${fmt(med(fr))} ms (of it the list and layers ${fmt(med(lsm))}, the live ground ${fmt(med(live))}, max ${fmt(Math.max(...live))}), the overlay ${fmt(med(ovm))} ms; the raster ${fmt(med(R.stats.raster.slice(-16)))} ms; ${R.stats.vertices.slice(-1)[0]} vertices last step; the same view idle ${fmt(med(idle))} ms a frame`);
    T3.up(B);
    const sh = shapes()[shapes().length - 1];
    ok &= o.say(sh && sh.type === 'wall' && Array.isArray(sh.path) && sh.width === 10, 'released: a wall path of 10 m: ' + JSON.stringify(sh));
    // it stays up until the compiler's mesh for this document is drawn
    const M0 = R.mesh, before = new Map();
    const keep = Mx => { for (const b of Mx.dirty || []) for (let j = b.j0; j <= b.j1; j++) for (let i = b.i0; i <= b.i1; i++) before.set(j * NV + i, Mx.Zl[j * NV + i]); };
    keep(M0);
    let low = Infinity, frames = 0;
    clearTimeout(S.checkTimer);
    const checked = runCheck();
    const swapped = await V3D.until(() => { V3D.frame(); frames++; low = Math.min(low, V3D.heightAt(mid[0], mid[1])); return R.mesh !== M0 && V3D.settled(); }, 90000);
    await checked;
    ok &= o.say(swapped && low > 4.2, `until the compiler's ground came (${frames} frames) the wall stayed up: lowest ${fmt(low)} m at its middle`);
    V3D.frame();
    const cmp = Mesh => { // the live heights before the swap against the compiler's
      let worst = 0, sum = 0, n = 0, over = 0;
      for (const [g, z] of before) { const d = Math.abs(z - Mesh.Z0[g]); worst = Math.max(worst, d); sum += d; n++; if (d > 0.05) over++; }
      return { worst, mean: sum / Math.max(1, n), n, over };
    };
    let c1 = cmp(R.mesh);
    ok &= o.say(!R.mesh.bad && c1.worst < 0.05 && !R.mesh.dirty, `the live heights against the compiler's mesh over ${c1.n} vertices round the stroke: worst ${c1.worst.toFixed(4)} m, mean ${c1.mean.toFixed(5)} m; the new mesh needs no patch`);
    // (2) a chasm drawn as a polygon drops at once
    T3.look(Q, 60);
    setCliff('chasm'); setDraw('polygon');
    const corners = [[-7, -6], [7, -6], [8, 5], [-6, 7]].map(d => [Q[0] + d[0], Q[1] + d[1]]);
    for (const p of corners) T3.click(p);
    T3.dbl(corners[3]);
    V3D.frame();
    const vq = vtx(Q), M1 = R.mesh;
    ok &= o.say(shapes()[shapes().length - 1].type === 'chasm' && vq.live < -4.2 && vq.mesh > -0.3, `a chasm polygon: the ground at its middle at once at ${fmt(vq.live)} m (the compiler's mesh ${fmt(vq.mesh)} m)`);
    before.clear();
    keep(M1);
    ok &= o.say(await settleGround(), 'checked; the compiler\'s ground for it drawn');
    c1 = cmp(R.mesh);
    ok &= o.say(c1.worst < 0.05 && !R.mesh.dirty && V3D.heightAt(Q[0], Q[1]) < -4.2, `the chasm's live heights against the compiler's over ${c1.n} vertices: worst ${c1.worst.toFixed(4)} m, mean ${c1.mean.toFixed(5)} m; heightAt ${fmt(V3D.heightAt(Q[0], Q[1]))} m`);
    // (3) a lane knot dragged: the corridor's relief follows during the drag
    setTool('select');
    const L1 = lanes()[0];
    let kk = -1, K = null;
    for (let q = 1; q < L1.knots.length - 1 && kk < 0; q++) { // a knot the mouse can take (no doodad, model or object over it)
      T3.look(L1.knots[q], 70);
      const hh = hit(ED.views['3d'].pickAt(...V3D.project(L1.knots[q])));
      if (hh && hh.sel.t === 'knot' && hh.sel.l === 0 && hh.sel.k === q) { kk = q; K = L1.knots[q].slice(); }
    }
    ok &= o.say(kk > 0, `a knot of lane 1 the mouse takes: ${kk} (${K})`);
    if (!K) return o.finish('live3d', false);
    T3.down(K);
    const ksteps = [], kin = [], kn = R.stats.frame.length, kr = R.stats.raster.length, kf = R.stats.field.length;
    for (let k = 1; k <= 8; k++) { const t0 = performance.now(); T3.move([K[0] + k, K[1]]); kin.push(performance.now() - t0); V3D.frame(); ksteps.push(performance.now() - t0); }
    const kpart = `the input (the move, the joined shapes, changed()) ${fmt(med(kin))} ms, the raster ${fmt(med(R.stats.raster.slice(kr)))}, the field ${fmt(med(R.stats.field.slice(kf)))}, the live ground in all ${fmt(med(R.stats.frame.slice(kn)))}`;
    const moved = lanes()[0].knots[kk];
    ok &= o.say(S.sel && S.sel.t === 'knot' && Math.abs(moved[0] - K[0] - 8) < 1.01 && R.mesh.dirty && med(ksteps) < 16.7, `a lane knot dragged by 8 m: (${moved}); the live ground patched round it and its partner (vertices ${R.mesh.dirty ? R.mesh.dirty.map(b => (b.i1 - b.i0 + 1) + ' x ' + (b.j1 - b.j0 + 1)).join(', ') : 0}); a step median ${fmt(med(ksteps))} ms, max ${fmt(Math.max(...ksteps))} ms: ${kpart}`);
    T3.up([K[0] + 8, K[1]]);
    // (4) back: undo every step; the compiler's ground for the first document comes back unpatched
    while (S.undo.length && snapshot() !== doc0) undo();
    ok &= o.say(snapshot() === doc0, 'undone: the document as it was');
    ok &= o.say(await settleGround(), 'the ground made again');
    V3D.frame();
    const back = vtx(mid), backQ = vtx(Q);
    ok &= o.say(Math.abs(back.live) < 0.3 && Math.abs(backQ.live) < 0.3 && !R.mesh.dirty, `the spots flat again: ${fmt(back.live)} m and ${fmt(backQ.live)} m; nothing patched`);
    S.snap = snap0; S.brush.size = size0;
    setTool('select');
    o.finish('live3d', ok);
  }

  // draw3d: every draw mode in 3-D by real events on CM_Marsh: walls and chasms with the brush and as polygons, an
  // island circle, an open path; a texture layer painted and a stamp placed; the check passes and the layout, the
  // layer's mask and the bake show them; the lanes, the width handle, the scatter regions, the footprints and the
  // paste tool's group in 3-D
  async function selftestDraw(mode) {
    const o = out(), saving = mode === 'draw3d-save'; // -save: the map kept as drawn (no lane width, no undo) and saved
    let ok = true;
    ok &= o.say(await V3D.until(() => S.doc && S.preview, 60000), 'a map open: ' + S.pkg);
    ok &= o.say(await ready(300000), '3-D ready');
    const sp = openSpots(7, 6, 20);
    ok &= o.say(sp.length === 7, `seven spots of open ground on team 1's half: ${sp.map(p => '(' + p + ')').join(' ')}`);
    if (sp.length < 7) o.say(false, 'spots of open ground with r 5: ' + openSpots(20, 5, 10).map(p => '(' + p + ')').join(' '));
    if (sp.length < 7) return o.finish('draw3d', false);
    const doc0 = snapshot(), snap0 = S.snap, size0 = S.brush.size, n0 = shapes().length;
    S.snap = true;
    select(null);
    const strokeAt = (c, kind) => {
      setCliff(kind); setDraw('brush'); S.brush.size = 5;
      T3.look(c, 55);
      const a = [c[0] - 6, c[1]], b = [c[0] + 6, c[1]];
      T3.down(a);
      for (let k = 1; k <= 12; k++) T3.move([a[0] + k, a[1]]);
      V3D.frame();
      const ink = T3.inked(V3D.project(c), 40); // the band's outline and the brush's ring round the mouse
      T3.up(b);
      return ink;
    };
    const polyAt = (c, kind) => {
      setCliff(kind); setDraw('polygon');
      T3.look(c, 55);
      const pts = [[-6, -5], [6, -5], [6, 6], [-5, 6]].map(d => [c[0] + d[0], c[1] + d[1]]);
      pts.forEach(p => T3.click(p));
      V3D.frame();
      const ink = T3.inked(V3D.project(pts[1]), 6); // the drawing in progress, dashed on the ground
      T3.dbl(pts[3]);
      return ink;
    };
    // (1) the four: a wall and a chasm with the brush, each as a polygon
    const inks = [strokeAt(sp[0], 'wall'), strokeAt(sp[1], 'chasm'), polyAt(sp[2], 'wall'), polyAt(sp[3], 'chasm')];
    const added = shapes().slice(n0);
    ok &= o.say(added.length === 4 && added.map(s => s.type).join() === 'wall,chasm,wall,chasm' && added[0].path && added[1].path && added[2].polygon && added[3].polygon && inks.every(n => n > 10),
      `drawn in 3-D: ${added.map(s => s.type + ' ' + (s.path ? 'path' : s.polygon ? 'polygon' : '?')).join(', ')}; the previews on the overlay (${inks.join(', ')} pixels)`);
    // (2) a circle (island: press, drag the radius) and a path (open: clicks, its width the brush's)
    setCliff('island'); setDraw('circle');
    T3.look(sp[4], 55);
    T3.down(sp[4]);
    for (let k = 1; k <= 7; k++) T3.move([sp[4][0] + k, sp[4][1]]);
    V3D.frame();
    const circleInk = T3.inked(V3D.project([sp[4][0] + 7, sp[4][1]]), 5);
    T3.up([sp[4][0] + 7, sp[4][1]]);
    setCliff('open'); setDraw('path'); S.brush.size = 4;
    T3.look(sp[5], 55);
    const pp = [[-6, 0], [0, 4], [6, 0]].map(d => [sp[5][0] + d[0], sp[5][1] + d[1]]);
    pp.forEach(p => T3.click(p));
    T3.dbl(pp[2]);
    const isl = shapes()[shapes().length - 2], opn = shapes()[shapes().length - 1];
    ok &= o.say(isl && isl.type === 'island' && Math.abs(isl.r - 7) <= 1 && opn && opn.type === 'open' && opn.path && opn.path.length === 3 && opn.width === 4 && circleInk > 5,
      `a circle ${JSON.stringify(isl)} (its ring on the ground: ${circleInk} pixels) and a path ${JSON.stringify(opn)}`);
    // (3) the check, then layout.png shows each kind where it was drawn
    clearTimeout(S.checkTimer);
    await runCheck();
    ok &= o.say(S.report && S.report.ok, 'the check passes' + (S.report && !S.report.ok ? ': ' + (S.report.findings || []).map(f => f.rule).join(' ') : ''));
    const hf = (+S.doc.size) / 2, at = [sp[0], sp[1], sp[2], sp[3], sp[4]];
    const px = await pixels(S.images + 'layout.png?r=' + S.rev, hf, at.map(p => [p[0] + 0.5 * R.T.c, p[1] - 0.5 * R.T.c]));
    const kinds = (px || []).map(kindOf);
    ok &= o.say(kinds.join() === 'wall,chasm,wall,chasm,island', 'layout.png at the five: ' + kinds.join(', '));
    // (4) a texture layer painted with the brush in 3-D, a stamp placed by a click
    const ls = S.doc.ground.layers, k = ls.findIndex((l, i) => i >= 1 && !l.auto);
    const tile = document.querySelector(`#tab_terrain .tiles [data-k="${k}"]`);
    ok &= o.say(k > 0 && tile, `the layer ${k} (${ls[k] && ls[k].name}) armed from its tile`);
    if (!tile) return o.finish('draw3d', false);
    await V3D.until(() => ED.bakeShown && ED.bakeShown() && ED.bakeShown().from === S.checkedJSON, 120000);
    const bake0 = ED.bakeShown(), C = sp[6]; // open ground: the stroke shows on the floor's texture
    const pre = await pixels(bake0.img.src, bake0.half, [C, [C[0] + 3, C[1]], [C[0] - 3, C[1]]]);
    tile.click();
    setDraw('brush'); S.brush.size = 6;
    T3.look(C, 50);
    const rgbDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
    const pre3 = V3D.readAt([C[0], C[1], V3D.heightAt(C[0], C[1])], 8), np = R.stats.paint.length;
    T3.down([C[0] - 6, C[1]]);
    for (let q = 1; q <= 12; q++) T3.move([C[0] - 6 + q, C[1]]);
    V3D.frame();
    const paintInk = T3.inked(V3D.project(C), 40);
    let livePaint = 0;
    await V3D.until(() => { livePaint = rgbDiff(pre3, V3D.readAt([C[0], C[1], V3D.heightAt(C[0], C[1])], 8)); return livePaint > 8; }, 30000);
    const pms = R.stats.paint.slice(np);
    ok &= o.say(livePaint > 8, `the stroke painted onto the 3-D ground's texture while drawn: the picture there changed by ${fmt(livePaint)} per channel (the texture's pixel ${paintedAt(C).map(q => q.was.slice(0, 3) + ' -> ' + q.now.slice(0, 3)).join('; ')}; a paint ${fmt(med(pms))} ms, ${R.mesh && R.mesh.tex ? R.mesh.tex.size : 0} textures)`);
    const ps = [];
    for (let q = 1; q <= 6; q++) { T3.move([C[0] + 6, C[1] + q]); const t0 = performance.now(); V3D.frame(); ps.push(performance.now() - t0); }
    ok &= o.say(med(ps) < 16.7, `a texture stroke's drag step (the frame with the paint): median ${fmt(med(ps))} ms, max ${fmt(Math.max(...ps))} ms; the paint ${fmt(med(R.stats.paint.slice(-6)))} ms, the list and layers ${fmt(med(V3D.V.listMs.slice(-6)))} ms, the overlay ${fmt(med(V3D.V.overlayMs.slice(-6)))} ms`);
    T3.up([C[0] + 6, C[1] + 6]);
    const lk = S.doc.ground.layers[k], st = lk.shapes && lk.shapes[lk.shapes.length - 1];
    ok &= o.say(S.tool === 'paint' && st && st.path && st.width === 6 && paintInk > 10, `painted in 3-D: layer ${k}'s mask got ${JSON.stringify(st)} (the stroke on the ground while drawn: ${paintInk} pixels)`);
    setTool('stamp');
    const SP = [sp[4][0], sp[4][1] - 14];
    T3.look(SP, 50);
    T3.click(SP);
    const stp = (S.doc.ground.stamps || []).slice(-1)[0];
    ok &= o.say(stp && Math.hypot(stp.pos[0] - SP[0], stp.pos[1] - SP[1]) < 0.6, `a stamp placed in 3-D at (${stp && stp.pos})`);
    V3D.frame();
    ok &= o.say(T3.inked(V3D.project([SP[0] + stp.size[0] / 2, SP[1]]), 5) > 3, 'its outline on the ground');
    clearTimeout(S.checkTimer);
    await runCheck();
    ok &= o.say(S.report.ok && await V3D.until(() => ED.bakeShown() && ED.bakeShown().from === S.checkedJSON, 120000), 'checked; baked again');
    const bake1 = ED.bakeShown();
    const mask = await V3D.until(() => bake1.masks[k] && bake1.masks[k].complete, 30000) && await pixels(bake1.masks[k].src, bake1.half, [C, [C[0], C[1] + 8]]);
    ok &= o.say(mask && mask[0][0] > 200 && mask[1][0] < mask[0][0], `mask_${k}.png: ${mask && mask[0][0]} under the stroke, ${mask && mask[1][0]} 8 m beside it`);
    const post = await pixels(bake1.img.src, bake1.half, [C, [C[0] + 3, C[1]], [C[0] - 3, C[1]]]);
    const inStamp = []; // 25 points over the stamp's middle half
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) inStamp.push([SP[0] + a * stp.size[0] / 10, SP[1] + b * stp.size[1] / 10]);
    const preS = await pixels(bake0.img.src, bake0.half, inStamp), postS = await pixels(bake1.img.src, bake1.half, inStamp);
    const dc = pre.reduce((s, p, i) => s + Math.abs(p[0] - post[i][0]) + Math.abs(p[1] - post[i][1]) + Math.abs(p[2] - post[i][2]), 0) / 3;
    const ds = preS.reduce((s, p, i) => s + Math.abs(p[0] - postS[i][0]) + Math.abs(p[1] - postS[i][1]) + Math.abs(p[2] - postS[i][2]), 0) / preS.length;
    ok &= o.say(dc > 6 && ds > 6, `the bake changed under the stroke (${fmt(dc)} per pixel) and at the stamp (${ds})`);
    ok &= o.say(await settleGround(), 'the 3-D ground made again with the painting');
    // (5) the lanes in 3-D: their lines, a knot, the width handle dragged
    setTool('select');
    const L0 = lanes()[0], K1 = L0.knots[1], K2 = L0.knots[2], w0 = L0.width, M = [(K1[0] + K2[0]) / 2, (K1[1] + K2[1]) / 2];
    T3.look(M, 80);
    const laneInk = T3.inked(V3D.project(M), 4);
    T3.click(K1);
    V3D.frame();
    const hd = laneWidthHandle();
    ok &= o.say(laneInk > 3 && S.sel && S.sel.t === 'knot' && S.sel.k === 1 && hd, `lane 1's line on the ground (${laneInk} pixels); its knot selected by a click; the width handle at (${hd && hd.pos.map(fmt)})`);
    if (hd && !saving) {
      const to = [hd.at[0] + hd.n[0] * (w0 / 2 + 3), hd.at[1] + hd.n[1] * (w0 / 2 + 3)];
      T3.down(hd.pos);
      for (let q = 1; q <= 6; q++) T3.move([hd.pos[0] + (to[0] - hd.pos[0]) * q / 6, hd.pos[1] + (to[1] - hd.pos[1]) * q / 6]);
      T3.up(to);
      ok &= o.say(lanes().every(l => Math.abs(l.width - (w0 + 6)) <= 1), `the width handle dragged 3 m out: the lanes ${w0} -> ${lanes().map(l => l.width).join(', ')} m`);
    }
    // (6) the props in 3-D: the scatter regions not selected, the blocking footprints, the paste tool's group
    select(null);
    const sc = (S.doc.scatter || []).find(s => Array.isArray(s.polygon)), fpc = (S.doc.props || []).find(c => c.blocks && PR.footprint(c));
    if (sc) { T3.look(sc.polygon[0], 70); }
    const scInk = sc ? T3.inked(V3D.project(sc.polygon[0]), 4) : 0;
    let fpInk = 0;
    if (fpc) { const f = PR.footprint(fpc); T3.look(f.c, 40); fpInk = T3.inked(V3D.project([f.c[0] + f.a[0] * Math.cos(f.yaw * Math.PI / 180), f.c[1] + f.a[0] * Math.sin(f.yaw * Math.PI / 180)]), 4); }
    ok &= o.say(sc && fpc && scInk > 2 && fpInk > 2, `a scatter region's corner (${scInk} pixels) and a blocking doodad's footprint (${fpInk} pixels) on the overlay`);
    const noun = PR.P.nouns.find(n => n.icon && n.box && /rock/i.test(n.name));
    if (noun) {
      PR.P.paste = { level: 'test', sets: [], at: [0, 0], r: 6, members: [{ noun: noun.name, rel: [0, 0], z: 0, rot: [0, 0, 0], scale: 1 }, { noun: noun.name, rel: [3, 1], z: 0, rot: [0, 0, 40], scale: 1.2 }] };
      setTool('paste');
      T3.look(sp[5], 40);
      T3.move(sp[5], { buttons: 0 });
      await V3D.until(() => { V3D.frame(); return V3D.V.lastList.filter(i => i.ghost && String(i.key).startsWith('paste|') && i.model.ready).length === 2; }, 60000);
    }
    const pg = V3D.V.lastList.filter(i => i.ghost && String(i.key).startsWith('paste|'));
    ok &= o.say(noun && pg.length === 2, `the paste tool's group under the mouse: ${pg.length} see-through models`);
    setTool('select');
    PR.P.paste = null;
    if (saving) {
      clearTimeout(S.checkTimer);
      await runCheck();
      const r = await save();
      ok &= o.say(S.report.ok && r && r.written, 'checked and saved: ' + S.pkg + (r ? ' (' + JSON.stringify(r.pictures || []) + ')' : ''));
      S.snap = snap0; S.brush.size = size0;
      return o.finish(mode, ok);
    }
    // back
    while (S.undo.length && snapshot() !== doc0) undo();
    ok &= o.say(snapshot() === doc0, 'undone: the document as it was');
    S.snap = snap0; S.brush.size = size0;
    o.finish('draw3d', ok);
  }
  // ?pose4=<name> (with ?open=CM_Marsh&view=3d): the 3-D view left mid-edit for a picture: wall (a wall stroke being
  // drawn, the ground rising under it), texture (a texture stroke being drawn, painted onto the ground), lanes (a lane's
  // knot selected: the lanes, the corridor and the width handle), props (the scatter regions and the footprints)
  const POSE4 = new URLSearchParams(location.search).get('pose4');
  async function pose4() {
    if (!POSE4 || !S.doc || !await ready(300000)) return;
    const sps = openSpots(3, 8, 40), P = sps[sps.length - 1]; // away from the base's models
    if (POSE4 === 'wall' && P) {
      V3D.V.cam.yaw = 0;
      T3.look([P[0], P[1] + 2], 55);
      setCliff('wall'); setDraw('brush'); S.brush.size = 10;
      T3.down([P[0] - 9, P[1] + 2]);
      for (let k = 1; k <= 12; k++) T3.move([P[0] - 9 + k, P[1] + 2 - k / 4]);
    } else if (POSE4 === 'texture' && P) {
      const ls = S.doc.ground.layers, k = ls.findIndex((l, i) => i >= 1 && !l.auto && l.texture && !l.texture.procedural), tile = document.querySelector(`#tab_terrain .tiles [data-k="${k}"]`);
      if (!tile) return;
      tile.click();
      setDraw('brush'); S.brush.size = 8;
      V3D.V.cam.yaw = 0;
      T3.look(P, 50);
      T3.down([P[0] - 10, P[1] - 3]);
      for (let q = 1; q <= 16; q++) T3.move([P[0] - 10 + q, P[1] - 3 + q / 3]);
      await V3D.until(() => { V3D.frame(); return R.stats.painted > 0 && [...PICS.values()].every(p => p.img.complete); }, 60000);
    } else if (POSE4 === 'lanes') {
      const L = lanes()[0];
      if (!L) return;
      V3D.V.cam.yaw = 20;
      T3.look(L.knots[2], 110);
      select({ t: 'knot', l: 0, k: 2 });
    } else if (POSE4 === 'props') {
      const sc = (S.doc.scatter || []).find(s => Array.isArray(s.polygon)), fpc = (S.doc.props || []).find(c => c.blocks && PR.footprint(c));
      const at = fpc ? PR.footprint(fpc).c : sc ? sc.polygon[0] : [0, 0];
      V3D.V.cam.yaw = 15;
      T3.look(at, 75);
      select(null);
    }
    V3D.frame();
  }
  ED.on('started', pose4);

  ED.selftests = ED.selftests || {};
  ED.selftests.live3d = selftestLive;
  ED.selftests.draw3d = selftestDraw;
  ED.selftests['draw3d-save'] = selftestDraw;

  ED.on('render-bg', draw2d); // relief.js loads after ground.js: over the bake
  ED.on('open', () => { R.T = null; R.grid = null; R.tops = null; R.mesh = null; R.patch2d = null; R.bases.clear(); });
  if (typeof V3D !== 'undefined') V3D.addLayer(() => { sync(); patchMesh(); paint3d(); }); // each 3-D frame, before it draws

  return { R, N, GRID, RELIEF, height, colour, cliffEnd, kindTop, blendWin, topAt, terrainOf, rasterise, paint, field, fieldAt, diffBox, diffBoxes, baseGrid, sync, patchMesh, meshHeights, pending, cellOf, valueNoise, lattice, stats: R.stats,
    // the self-tests' helpers, for heights.js's
    T3, ready, openSpots, vtx, out, settleGround, med, fmt };
})();

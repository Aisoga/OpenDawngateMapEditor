// The props layer (MAPED-EDIT3): the palette of the copy's dressing nouns with top-down icons (`mapc nouns`, `mapc
// icon`), placing, moving, turning and scaling props on the 2-D canvas (props[] of map.json; team 2's are the live
// mirror), the blocks flag (it writes the footprint from the noun's box, so the check needs no copy), groups pasted
// from SM_Map_v5's dressing (props[].group), scatter along the walls in a drawn polygon (scatter[]), and the props in
// the 3-D view (`mapc model` of each noun, drawn through V3D.addLayer).
//
// What the props place comes from the server's `mapc props` with every check (S.placed: every marker, both teams,
// the map.json entry each comes from); between checks an edited entry's markers are moved, turned and scaled with it
// (and a new entry is drawn from map.json alone), so a drag shows at once in both views.
//
// Plugs into app.js through ED (sel, tools, hitFirst, hitItems, keys, the 'draw' event, addPane, selftests.props).
'use strict';

const PR = (() => {
  const P = {
    nouns: [], byKey: new Map(), state: 'not loaded', icons: new Map(), cur: '', multi: new Set(),
    search: '', type: '', modelOnly: true, randomTurn: false, newShadow: false, newBlocks: false,
    models: new Map(), modelReq: new Set(), level: null, levelName: 'SM_Map_v5', pick: null, paste: null,
    groups: new Map(), grid: null, status: null, dlg: null,
    // the next doodad the Prop tool places (its ghost): the turn (degrees, counter-clockwise from east) and size the
    // Doodads tab's fields, R / Shift+R, [ ], Shift+wheel and Ctrl+wheel set; with Random turn ticked the turn is
    // dealt at random instead (dealt ahead, so the ghost shows it; a new one after each placement)
    nextRot: 0, nextScale: 1, dealt: 0,
    // the next doodad's height (pos z, metres; Alt+wheel, the Next: height field); zWheel: the last Alt+wheel change
    // of the selection's height (one undo step per gesture), zShown: when a height last changed (its label shows a moment)
    nextZ: 0, zWheel: null, zShown: 0,
    // the Doodads tab's mode (EDUX11): 'place' (the Prop tool), 'scatter' (the Scatter tool) or 'paste' (a group from
    // SM_Map_v5); a palette click never changes it. The palette's picks: multi (a click replaces them, Shift/Ctrl+click
    // adds or removes one); cur is the next doodad Place lays (with several picked, one of them dealt at random ahead,
    // so the ghost shows it). A cur without picks (multi empty) counts as the one pick.
    mode: 'place', fillDensity: 0,
  };
  const key = n => String(n || '').trim().replace(/\.Noun$/i, '').toLowerCase();
  const bare = n => String(n || '').trim().replace(/\.Noun$/i, '');
  const info = n => P.byKey.get(key(n));
  const scaleOf = v => (+v || 0) === 0 ? 1 : +v;
  const r2 = v => Math.round(v * 100) / 100;
  const normDeg = a => { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; };
  const pos3 = p => Array.isArray(p) ? [+p[0] || 0, +p[1] || 0, +p[2] || 0] : [0, 0, 0];
  const rot2 = (v, deg) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  };
  const props = () => (S.doc && Array.isArray(S.doc.props)) ? S.doc.props : [];
  const scatters = () => (S.doc && Array.isArray(S.doc.scatter)) ? S.doc.scatter : [];
  const groupKey = g => JSON.stringify([g.level, g.sets, g.at, g.r, g.polygon]);
  // an entry with "mirror": false stands once, where it is, on either half (mapc import --dress writes a level's
  // dressing so: both halves as the level has them); no mirror is drawn or hit for it
  const isOnce = c => !!c && c.mirror === false;
  // a group's region is r round at, or a polygon (an imported level's whole: mapc import --dress)
  const groupPoly = g => (g && Array.isArray(g.polygon) && g.polygon.length >= 3) ? g.polygon : null;
  // the polygon where the group lands: each corner moved, turned and scaled about at as the members are
  function groupOutline(c) {
    const g = c.group, poly = groupPoly(g);
    if (!poly) return null;
    const p = pos3(c.pos), at = Array.isArray(g.at) ? g.at : [0, 0], s = scaleOf(c.scale), rot = +c.rot || 0;
    return poly.map(q => { const v = rot2([(q[0] - at[0]) * s, (q[1] - at[1]) * s], rot); return [p[0] + v[0], p[1] + v[1]]; });
  }

  // ---- the nouns and their icons ---------------------------------------------------------------------------

  async function loadNouns() {
    if (P.state === 'loading' || P.state === 'ready') return;
    P.state = 'loading';
    showStatus('reading the nouns and baking their icons (the first time takes a few seconds)...');
    const res = await api('GET', '/api/nouns');
    if (!res.ok) {
      P.state = 'off';
      showStatus(res.error || 'mapc nouns failed');
      return;
    }
    P.nouns = res.nouns;
    P.byKey = new Map(res.nouns.map(n => [key(n.name), n]));
    P.state = 'ready';
    showStatus(`${res.nouns.length} props, ${res.icons} icons` + (res.noModel ? `, ${res.noModel} without a model in the copy` : ''));
    renderPalette();
    const dl = document.getElementById('propNouns') || document.body.appendChild(h('datalist', { id: 'propNouns' }));
    dl.textContent = '';
    for (const n of res.nouns) dl.append(h('option', { value: bare(n.name) }));
    render();
  }

  function iconImg(inf) {
    if (!inf || !inf.icon) return null;
    let img = P.icons.get(inf.icon.url);
    if (!img) {
      img = new Image();
      img.onload = () => render();
      img.src = inf.icon.url;
      P.icons.set(inf.icon.url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // a noun's radius on the ground at a scale (half the box's diagonal in x and y)
  function radius(noun, s) {
    const b = (info(noun) || {}).box;
    if (!b) return 1.5 * s;
    const x = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), y = Math.max(Math.abs(b.min[1]), Math.abs(b.max[1]));
    return Math.max(0.5, Math.hypot(x, y) * s);
  }
  function entryRadius(c) {
    if (c && c.group && groupPoly(c.group)) return 12; // the handles' reach; the region is drawn as its outline
    if (c && c.group) return Math.max(1, (+c.group.r || 1) * scaleOf(c.scale));
    return radius(c && c.noun, scaleOf(c && c.scale));
  }
  // the footprint the blocks flag writes: the noun's box at the prop's scale (width along x, depth along y)
  function boxFootprint(noun, s) {
    const b = (info(noun) || {}).box;
    if (!b) return null;
    return [Math.max(0.1, r1((b.max[0] - b.min[0]) * s)), Math.max(0.1, r1((b.max[1] - b.min[1]) * s))];
  }
  // the blocking ellipse as the compiler stamps it (team 1's): the author's footprint centred on pos, else the box
  function footprint(c) {
    if (!c || !c.blocks || !c.noun) return null;
    const p = pos3(c.pos), s = scaleOf(c.scale), rot = +c.rot || 0;
    if (Array.isArray(c.footprint)) return { c: [p[0], p[1]], a: [c.footprint[0] / 2, c.footprint[1] / 2], yaw: rot };
    const b = (info(c.noun) || {}).box;
    if (!b) return null;
    const off = rot2([(b.min[0] + b.max[0]) / 2 * s, (b.min[1] + b.max[1]) / 2 * s], rot);
    return { c: [p[0] + off[0], p[1] + off[1]], a: [(b.max[0] - b.min[0]) / 2 * s, (b.max[1] - b.min[1]) / 2 * s], yaw: rot };
  }

  // ---- what the props place, live ----------------------------------------------------------------------------

  // propMap pairs the entries the last check placed (base) with today's (cur): index -> index or -1 (deleted). Equal
  // lengths pair by index (an edit); otherwise unchanged entries pair in order (an insertion or a deletion).
  function propMap(base, cur, bj, cj) { // bj, cj: the entries as JSON (live() has them)
    const out = new Array(base.length).fill(-1);
    if (base.length === cur.length) return out.map((_, i) => i);
    bj = bj || base.map(x => JSON.stringify(x)); cj = cj || cur.map(x => JSON.stringify(x));
    for (let i = 0, j = 0; i < base.length && j < cur.length;) {
      if (bj[i] === cj[j]) { out[i] = j; i++; j++; } else if (base.length > cur.length) i++; else j++;
    }
    return out;
  }

  // moved is a placed marker of entry b carried along to entry c (moved, turned, scaled about the entry's point)
  function moved(p, b, c, k, same) { // same: b and c are equal (live() compared their JSON once)
    const it = Object.assign({}, p, { path: 'props[' + k + ']', kind: 'prop', k });
    if (!b || !c || (same !== undefined ? same : JSON.stringify(b) === JSON.stringify(c))) return it;
    const bp = pos3(b.pos), cp = pos3(c.pos), dr = (+c.rot || 0) - (+b.rot || 0);
    const ratio = scaleOf(c.scale) / scaleOf(b.scale), t2 = p.team === 2;
    const A = t2 ? [-bp[0], -bp[1]] : bp, A2 = t2 ? [-cp[0], -cp[1]] : cp;
    const rel = rot2([(p.pos[0] - A[0]) * ratio, (p.pos[1] - A[1]) * ratio], dr);
    it.pos = [A2[0] + rel[0], A2[1] + rel[1], (p.pos[2] - bp[2]) * ratio + cp[2]];
    it.rot = [p.rot[0], p.rot[1], p.rot[2] + dr];
    it.scale = p.scale * ratio;
    if (c.noun && !p.card && key(c.noun) !== key(b.noun)) it.noun = c.noun;
    it.stale = true;
    return it;
  }

  // provisional are the markers of an entry the last check didn't see: a noun on both sides, a pasted group's members
  // (once, where they are, for an entry that doesn't mirror)
  function provisional(c, k, out) {
    if (!c || typeof c !== 'object') return;
    let members = null;
    if (c.noun) members = [{ noun: c.noun, rel: [0, 0], z: 0, rot: Array.isArray(c.tilt) ? [+c.tilt[0] || 0, +c.tilt[1] || 0, 0] : [0, 0, 0], scale: 1 }];
    else if (c.group) members = P.groups.get(groupKey(c.group));
    if (!members) return;
    const p = pos3(c.pos), rot = +c.rot || 0, s = scaleOf(c.scale);
    for (const m of members) {
      const rel = rot2([m.rel[0] * s, m.rel[1] * s], rot);
      const it = { noun: m.noun, pos: [p[0] + rel[0], p[1] + rel[1], m.z * s + p[2]], rot: [m.rot[0], m.rot[1], m.rot[2] + rot],
        scale: m.scale * s, path: 'props[' + k + ']', kind: 'prop', k, team: 1, provisional: true };
      if (isOnce(c) || Math.hypot(p[0], p[1]) <= 0.5) { it.team = 0; out.push(it); continue; }
      out.push(it, Object.assign({}, it, { team: 2, pos: [-it.pos[0], -it.pos[1], it.pos[2]], rot: [it.rot[0], it.rot[1], it.rot[2] + 180] }));
    }
  }

  // live is every marker the props place now: the last check's, carried along with their entries' edits since. Kept
  // while the entries (their JSON), the check's markers and the pasted groups' members stay the same (EDUX3: the 3-D
  // view, the hits and both layers ask for it many times a frame); callers only read it
  const LIVE = { key: null, placed: null, from: null, groups: -1, out: null, shown: null, hide: false };
  function live() {
    if (!S.doc) return [];
    const cur = props(), curS = scatters(), from = S.placedFrom || { props: [], scatter: [] };
    const cj = cur.map(x => JSON.stringify(x)), key = JSON.stringify(cj) + JSON.stringify(curS);
    if (LIVE.out && LIVE.key === key && LIVE.placed === S.placed && LIVE.from === S.placedFrom && LIVE.groups === P.groups.size) return LIVE.out;
    const bj = from.props.map(x => JSON.stringify(x));
    const map = propMap(from.props, cur, bj, cj), smap = propMap(from.scatter, curS);
    const out = [], mapped = new Set(map.filter(k => k >= 0));
    for (const p of S.placed || []) {
      const m = /^(props|scatter)\[(\d+)\]/.exec(p.path || '');
      if (!m) continue;
      const j = +m[2];
      if (m[1] === 'scatter') {
        const k = smap[j];
        if (k >= 0) out.push(Object.assign({}, p, { path: 'scatter[' + k + ']', kind: 'scatter', k }));
        continue;
      }
      const k = map[j];
      if (k >= 0) out.push(moved(p, from.props[j], cur[k], k, bj[j] === cj[k]));
    }
    cur.forEach((c, k) => { if (!mapped.has(k)) provisional(c, k, out); });
    Object.assign(LIVE, { key, placed: S.placed, from: S.placedFrom, groups: P.groups.size, out, shown: null });
    return out;
  }
  // shown is what the views draw and hit: live() without the scatters' props while View > Hide Derived Art is on
  // (they are derived from the walls; mapc's NoDerived places none)
  const shown = () => {
    const all = live();
    if (!S.hideDerived) return all;
    if (LIVE.out !== all || !LIVE.shown) LIVE.shown = all.filter(it => it.kind !== 'scatter');
    return LIVE.shown;
  };

  // ---- the 2-D layer ---------------------------------------------------------------------------------------

  // drawItem draws a doodad's icon (or its circle) at its place on the ground through the view v (app.js's ED.views;
  // the 2-D view by default): the props layer and, as a preview, the placing tools' ghosts
  function drawItem(it, alpha, v) {
    v = v || VIEW2D;
    const at = [it.pos[0], it.pos[1]], s = v.project(at);
    if (!s) return;
    if (v.drape) { // 3-D: the model shows it (a ghost: layer3d's); here its ring and its facing, on the ground
      const g = v.overlay, r = radius(it.noun, it.scale), a = (it.rot[2] || 0) * Math.PI / 180;
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = '#e8d4a8';
      g.lineWidth = 1.5 * dpr;
      if (it.dashed) g.setLineDash([5 * dpr, 4 * dpr]);
      vring(v, at, r); g.stroke();
      vpoly(v, [at, [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)]]); g.stroke();
      g.restore();
      return;
    }
    const g = v.overlay, ppm = v.ppm(at), inf = info(it.noun), k = ppm * it.scale;
    g.save();
    g.globalAlpha = alpha;
    g.translate(s[0], s[1]);
    g.rotate(-(it.rot[2] || 0) * Math.PI / 180);
    const img = iconImg(inf);
    if (img) {
      const ic = inf.icon, sz = ic.size * ic.metresPerPixel * k;
      if (sz >= 2) g.drawImage(img, ic.centre[0] * k - sz / 2, -ic.centre[1] * k - sz / 2, sz, sz);
      else { g.fillStyle = '#b9a37a'; g.fillRect(-1, -1, 2, 2); }
    } else {
      const r = Math.max(1.5 * dpr, radius(it.noun, it.scale) * ppm);
      g.beginPath();
      g.arc(0, 0, r, 0, 2 * Math.PI);
      g.fillStyle = 'rgba(190,160,110,0.35)';
      g.fill();
      g.strokeStyle = '#c9a66b';
      g.lineWidth = 1 * dpr;
      g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(r, 0); g.stroke(); // its facing
    }
    g.restore();
  }

  function drawEllipse(f, mirror, style) {
    const c = mirror ? mir(f.c) : f.c, yaw = mirror ? f.yaw + 180 : f.yaw, s = w2s(c);
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    if (mirror) ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(s[0], s[1], Math.max(1, f.a[0] * S.view.scale), Math.max(1, f.a[1] * S.view.scale), -yaw * Math.PI / 180, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function scatterPts(sc, mirror) {
    if (!sc) return null;
    if (Array.isArray(sc.polygon) && sc.polygon.length >= 3 && sc.polygon.every(isPt)) return mirror ? sc.polygon.map(mir) : sc.polygon;
    return null;
  }

  // ---- the scatter's estimate: where "Scatter along the walls" will place doodads, before the check does --------
  // mapc's rule (Scattered): the wall cells of team 1's half inside the region that touch walkable ground (open or
  // island) on a side, each moved `inset` into the wall, taken in a shuffled order while `spacing` from every one
  // taken and its mirror, at most `max`. The page reads the cell kinds from the last check's layout.png and applies the
  // spacing greedily in row order (no shuffle, no inset): the count is an estimate, close to the check's, not exact.
  const LY = { rev: -1, loading: -1, kinds: null, grid: 0, size: 0 };
  // layout.png's colours (mapc preview.go): 1 open, 2 wall, 3 chasm, 4 island, 5 a blocking prop's footprint (not a wall)
  const LY_COL = [[1, [196, 186, 160]], [2, [70, 62, 58]], [3, [40, 60, 110]], [4, [183, 177, 194]], [5, [120, 84, 52]]];
  function layoutKinds() {
    if (!S.images || !S.preview || !(S.preview.files || []).some(f => f.file === 'layout.png')) return null;
    if (LY.rev !== S.rev && LY.loading !== S.rev) {
      const rev = S.rev, img = new Image();
      LY.loading = rev;
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, n = img.width, k = new Uint8Array(n * n);
        for (let py = 0; py < n; py++) {
          for (let px = 0; px < n; px++) {
            const o = 4 * (py * n + px);
            let r = d[o], gg = d[o + 1], b = d[o + 2];
            if (gg > r + 40 && gg > b + 40) { r *= 3; gg = (gg - 110) * 3; b *= 3; } // a bush over its kind
            let best = 0, bd = Infinity;
            for (const [kind, c3] of LY_COL) { const e = (r - c3[0]) ** 2 + (gg - c3[1]) ** 2 + (b - c3[2]) ** 2; if (e < bd) { bd = e; best = kind; } }
            k[(n - 1 - py) * n + px] = best; // row j from the south, as mapc's cells
          }
        }
        Object.assign(LY, { rev, kinds: k, grid: n, size: +(S.preview.size || S.doc.size) || 400 });
        if (S.sel && S.sel.t === 'scatter') renderInspector(); // its estimate, now known
        P.estKey = '';
        render();
        if (typeof FR !== 'undefined') FR.renderStatus();
      };
      img.src = S.images + 'layout.png';
    }
    return LY.kinds ? LY : null;
  }
  // scatterEstimate gives the candidate cells (team 1's) and the estimated count for a region (a polygon, or a circle
  // {circle, r}) with a scatter's settings; null until the check's layout is loaded
  function scatterEstimate(region, sc) {
    if (sc && sc.along === 'area') return fillEstimate(region, sc);
    const ly = layoutKinds();
    if (!ly || !region) return null;
    const poly3 = Array.isArray(region) ? region : null;
    if (poly3 && poly3.length < 3) return { cells: [], n: 0 };
    const key = JSON.stringify([LY.rev, region, sc && [sc.spacing, sc.max]]);
    if (key === P.estKey && P.est) return P.est;
    const n = ly.grid, cs = ly.size / n;
    const inside = poly3 ? (q => inPoly(q, poly3)) : (q => Math.hypot(q[0] - region.circle[0], q[1] - region.circle[1]) <= region.r);
    const pts = poly3 || [[region.circle[0] - region.r, region.circle[1] - region.r], [region.circle[0] + region.r, region.circle[1] + region.r]];
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) / cs + n / 2)), i1 = Math.min(n - 1, Math.ceil(Math.max(...xs) / cs + n / 2));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) / cs + n / 2)), j1 = Math.min(n - 1, Math.ceil(Math.max(...ys) / cs + n / 2));
    const walk = (i, j) => i >= 0 && j >= 0 && i < n && j < n && (ly.kinds[j * n + i] === 1 || ly.kinds[j * n + i] === 4);
    const cells = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (ly.kinds[j * n + i] !== 2) continue;
        const c = [(i - n / 2) * cs, (j - n / 2) * cs];
        if (c[0] + c[1] > 0 || !inside(c)) continue;
        if (walk(i - 1, j) || walk(i + 1, j) || walk(i, j - 1) || walk(i, j + 1)) cells.push(c);
      }
    }
    const spacing = (sc && +sc.spacing) || 6, most = (sc && +sc.max) || 200, taken = [];
    let count = 0;
    for (const c of cells) {
      if (count >= most) break;
      if (Math.hypot(2 * c[0], 2 * c[1]) < spacing) continue;
      if (taken.some(q => Math.hypot(c[0] - q[0], c[1] - q[1]) < spacing)) continue;
      taken.push(c, mir(c));
      count++;
    }
    P.estKey = key;
    P.est = { cells, n: count, cs };
    return P.est;
  }

  // ---- the fill's estimate (EDUX10): "Fill area" (scatter[].along "area") computed as mapc does it (fill.go
  // `filled`), bit for bit, from the last check's layout.png and fill.png: the count shown while drawing is the count
  // the check places. fill.png (mapc preview): grey the cells a fill never uses (the lanes' and the fixed set's
  // keep-out, the edge, past the void's cut), green the blocking fills' footprints (walkable before they stamped).
  const FL = { rev: -1, loading: -1, cells: null };
  function fillCells() {
    if (!S.images || !S.preview || !(S.preview.files || []).some(f => f.file === 'fill.png')) return null;
    if (FL.rev !== S.rev && FL.loading !== S.rev) {
      const rev = S.rev, img = new Image();
      FL.loading = rev;
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, n = img.width, k = new Uint8Array(n * n);
        for (let py = 0; py < n; py++) {
          for (let px = 0; px < n; px++) {
            const o = 4 * (py * n + px), r = d[o], gg = d[o + 1];
            k[(n - 1 - py) * n + px] = r < 160 && gg < 130 ? 1 : gg > r + 50 ? 2 : 0; // 1 never, 2 a fill's footprint
          }
        }
        Object.assign(FL, { rev, cells: k });
        if (S.sel && S.sel.t === 'scatter') renderInspector(); // its count, now known
        P.estKey = '';
        render();
        if (typeof FR !== 'undefined') FR.renderStatus();
      };
      img.src = S.images + 'fill.png';
    }
    return FL.cells && FL.rev === LY.rev ? FL : null;
  }
  // SplitMix64 as mapc's scatter draws it (props.go splitmix), on two 32-bit halves (exact in doubles)
  function splitmix(seed) {
    let hi = Math.floor(seed / 4294967296) >>> 0, lo = seed >>> 0;
    const mul32 = (a, b) => { // the 64-bit product of two 32-bit numbers: [high, low]
      const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16, mid = a0 * b1 + a1 * b0;
      const low = a0 * b0 + (mid % 65536) * 65536;
      return [(a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / 4294967296)) >>> 0, low >>> 0];
    };
    const mul64 = (ah, al, bh, bl) => { const p = mul32(al, bl); return [(p[0] + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0, p[1]]; };
    const xsh = (h, l, n) => [(h ^ (h >>> n)) >>> 0, (l ^ (((l >>> n) | (h << (32 - n))) >>> 0)) >>> 0]; // z ^ (z >> n)
    const next = () => {
      const l = lo + 0x7F4A7C15;
      lo = l >>> 0;
      hi = (hi + 0x9E3779B9 + (l > 0xffffffff ? 1 : 0)) >>> 0;
      let z = xsh(hi, lo, 30);
      z = mul64(z[0], z[1], 0xBF58476D, 0x1CE4E5B9);
      z = xsh(z[0], z[1], 27);
      z = mul64(z[0], z[1], 0x94D049BB, 0x133111EB);
      return xsh(z[0], z[1], 31);
    };
    return {
      next,
      float: () => { const z = next(); return (z[0] * 2097152 + (z[1] >>> 11)) / 9007199254740992; },
      mod: m => { const z = next(); return ((z[0] % m) * (4294967296 % m) + z[1] % m) % m; },
      hex: () => { const z = next(); return z[0].toString(16).padStart(8, '0') + z[1].toString(16).padStart(8, '0'); },
    };
  }
  const round3 = v => Math.sign(v) * Math.round(Math.abs(v) * 1000) / 1000; // Go's math.Round: half away from zero
  // the decor nouns (mapc DecorPrefixes): low plants a unit walks through, placed on walkable ground without blocking
  const DECOR = ['grass', 'flowers_', 'foliage_', 'forestbush_', 'forestleaves_', 'fungus_mushroom', 'leaves_', 'lowshrub_', 'plants_', 'pumpkin_leaves'];
  const isDecor = n => DECOR.some(p => key(n).startsWith(p));
  // where a fill may go (scatter[].on): mapc's FillOns
  const FILL_ON = [['any', 'Anywhere'], ['walls', 'On walls'], ['off-ground', 'Off walkable ground (walls, chasms)'], ['ground', 'On walkable ground']];
  const fillTakes = (on, k) => on === 'walls' ? k === 2 : on === 'off-ground' ? (k === 2 || k === 3) : on === 'ground' ? (k === 1 || k === 4) : k !== 5;
  // fillEstimate: the candidate cells (team 1's), the places the fill takes (team 1's) and their count
  function fillEstimate(region, sc) {
    const ly = layoutKinds(), fl = fillCells();
    if (!ly || !fl || !region) return null;
    const poly3 = Array.isArray(region) ? region : null;
    if (poly3 && poly3.length < 3) return { cells: [], pts: [], n: 0, fill: true, why: 'corners' };
    const key0 = JSON.stringify([LY.rev, FL.rev, region, sc]);
    if (key0 === P.estKey && P.est) return P.est;
    const n = ly.grid, cs = ly.size / n;
    let inside;
    if (poly3) inside = q => inPoly(q, poly3);
    else { const c0 = region.circle, r = region.r; inside = q => { const dx = q[0] - c0[0], dy = q[1] - c0[1]; return dx * dx + dy * dy <= r * r; }; }
    const pts = poly3 || [[region.circle[0] - region.r, region.circle[1] - region.r], [region.circle[0] + region.r, region.circle[1] + region.r]];
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) / cs + n / 2) - 1), i1 = Math.min(n - 1, Math.ceil(Math.max(...xs) / cs + n / 2) + 1);
    const j0 = Math.max(0, Math.floor(Math.min(...ys) / cs + n / 2) - 1), j1 = Math.min(n - 1, Math.ceil(Math.max(...ys) / cs + n / 2) + 1);
    const on = sc.on || 'any', base = k => ly.kinds[k] === 5 && fl.cells[k] === 2 ? 1 : ly.kinds[k]; // a fill's footprint: walkable before
    const cands = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i, c = [(i - n / 2) * cs, (j - n / 2) * cs];
        if (c[0] + c[1] > 0 || fl.cells[k] === 1 || !fillTakes(on, base(k)) || !inside(c)) continue;
        cands.push(k);
      }
    }
    const rng = splitmix(Math.max(0, Math.round(+sc.seed || 0)));
    for (let i = cands.length - 1; i > 0; i--) { const j = rng.mod(i + 1), t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
    const spacing = +sc.spacing || 6, most = Math.round(+sc.max || 200), lim = spacing * spacing, dens = +sc.density || 1;
    const sl = Array.isArray(sc.scale) ? +sc.scale[0] : 0.8, shi = Array.isArray(sc.scale) ? +sc.scale[1] : 1.2;
    const nouns = Array.isArray(sc.nouns) ? sc.nouns : [];
    const buckets = new Map(), bk = (x, y) => Math.floor(x / spacing) + ',' + Math.floor(y / spacing);
    const near = p => {
      const bx = Math.floor(p[0] / spacing), by = Math.floor(p[1] / spacing);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const q of buckets.get((bx + dx) + ',' + (by + dy)) || []) { const ex = p[0] - q[0], ey = p[1] - q[1]; if (ex * ex + ey * ey < lim) return true; }
      }
      return false;
    };
    const add = p => { const b = bk(p[0], p[1]); if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(p); };
    const out = [];
    let count = 0;
    if (nouns.length) {
      for (const k of cands) {
        if (count >= most) break;
        const c = [(k % n - n / 2) * cs, (Math.floor(k / n) - n / 2) * cs];
        const jx = (rng.float() - 0.5) * cs, jy = (rng.float() - 0.5) * cs;
        const noun = nouns[rng.mod(nouns.length)];
        rng.float(); rng.float(); // the turn and the scale
        const decor = isDecor(noun), bk0 = base(k);
        if ((bk0 === 1 || bk0 === 4) && !decor && !sc.blocks) continue;
        const p = [round3(c[0] + jx), round3(c[1] + jy)];
        if (4 * (p[0] * p[0] + p[1] * p[1]) < lim || near(p)) continue;
        add(p); add(mir(p));
        if (dens < 1 && rng.float() >= dens) continue;
        out.push(p);
        count++;
      }
    }
    void sl; void shi;
    P.estKey = key0;
    P.est = { cells: cands.map(k => [(k % n - n / 2) * cs, (Math.floor(k / n) - n / 2) * cs]), pts: out, n: count, cs, fill: true,
      why: !cands.length ? 'cells' : count ? '' : 'nouns' };
    return P.est;
  }
  // the settings a region drawn now gets (the Brush's mode, where, blocks; the seed dealt ahead, so the estimate while
  // drawing is the check's)
  function drawingSc() {
    if (!P.nextSeed) P.nextSeed = 1 + Math.floor(Math.random() * 999999);
    const sc = { nouns: paletteNouns().map(bare), seed: P.nextSeed };
    if (P.smode === 'fill') {
      sc.along = 'area';
      if (P.fillOn && P.fillOn !== 'any') sc.on = P.fillOn;
      if (P.fillBlocks) sc.blocks = true;
      if (P.fillDensity > 0 && P.fillDensity < 1) sc.density = P.fillDensity;
    }
    return sc;
  }
  // the region being drawn with the Scatter tool (team 1's source when drawn on team 2's half), or the selected one
  function scatterRegion() {
    if (S.tool === 'scatter' && S.drawing && Array.isArray(S.drawing.pts)) {
      let pts = S.drawing.pts.concat(S.drawing.mouse ? [S.drawing.mouse] : []);
      if (pts.length < 3) return null;
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      if (cx + cy > 0) pts = pts.map(mir);
      return { region: pts, sc: drawingSc(), drawing: true };
    }
    if (S.sel && (S.sel.t === 'scatter' || S.sel.t === 'svertex') && scatters()[S.sel.k]) {
      const sc = scatters()[S.sel.k];
      const region = scatterPts(sc, false) || (isPt(sc.circle) ? { circle: sc.circle, r: +sc.r || 0 } : null);
      return region ? { region, sc, k: S.sel.k } : null;
    }
    return null;
  }
  const NO_EDGE = 'No wall edge in this region — Along the walls places doodads only there; Fill area covers the whole region';
  // why a fill places nothing (fillEstimate's why)
  const NO_FILL = {
    cells: 'Nothing to fill here — no free cell of the kind it fills (Where); the lanes, the bases, wells and camps keep their ground clear',
    nouns: 'Nothing to fill here — rocks and trees stand on walkable ground only with Block; plants (grass, flowers, ferns...) always may',
    corners: 'a region needs at least 3 corners',
  };
  const noneText = est => est.fill ? NO_FILL[est.why] || NO_FILL.cells : NO_EDGE;
  // drawEstimate marks the cells that will get doodads and writes the estimate at the region, through the view v (a
  // preview: the region being drawn, or the selected scatter)
  function drawEstimate(v) {
    const r = scatterRegion();
    if (!r) return;
    const est = scatterEstimate(r.region, r.sc);
    if (r.drawing && typeof FR !== 'undefined') FR.renderStatus();
    const pts = Array.isArray(r.region) ? r.region : [r.region.circle];
    const mid = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
    const g = v.overlay, at = v.project(mid);
    g.save();
    if (est) {
      const px = Math.max(2 * dpr, est.cs * v.ppm(mid));
      g.fillStyle = est.fill ? 'rgba(255,196,64,0.28)' : 'rgba(255,196,64,0.85)'; // a fill: its cells faint, its places bright
      for (const c of est.cells) { const q = v.project(c); if (q) g.fillRect(q[0] - px / 2, q[1] - px / 2, px, px); }
      if (est.fill) {
        g.fillStyle = 'rgba(255,214,90,0.95)';
        const rr = Math.max(2 * dpr, 0.8 * v.ppm(mid));
        for (const c of est.pts) { const q = v.project(c); if (q) { g.beginPath(); g.arc(q[0], q[1], rr, 0, 2 * Math.PI); g.fill(); } }
      }
    }
    const txt = !est ? 'estimating... (after the check)' : est.n ? (est.fill ? `${est.n} doodads (and their mirrors)` : `≈ ${est.n} doodads (and their mirrors)`) : noneText(est);
    if (at) {
      g.font = `${12 * dpr}px Segoe UI, sans-serif`;
      const w = g.measureText(txt).width;
      g.fillStyle = 'rgba(15,17,20,0.85)';
      g.fillRect(at[0] - w / 2 - 6 * dpr, at[1] - 10 * dpr, w + 12 * dpr, 20 * dpr);
      g.fillStyle = est && !est.n ? '#f2b84b' : '#ffd479';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, at[0], at[1]);
    }
    g.restore();
  }
  // scatterError shows a refusal in the Doodads tab beside the Scatter button until the next action (and in Messages)
  function scatterError(msg, warnOnly) {
    P.scatterMsg = msg;
    renderBrush();
    log('scatter: ' + msg, warnOnly ? '' : 'err');
  }
  function clearScatterMsg() { if (P.scatterMsg) { P.scatterMsg = ''; renderBrush(); } }

  function drawUnder() {
    if (!S.doc || !S.show.props) return;
    // the scatters' regions
    scatters().forEach((sc, k) => {
      const on = S.sel && (S.sel.t === 'scatter' || S.sel.t === 'svertex') && S.sel.k === k;
      for (const m of S.show.mirror ? [true, false] : [false]) {
        ctx.save();
        ctx.strokeStyle = on ? '#fff' : 'rgba(150,220,140,0.8)';
        ctx.lineWidth = (on ? 2 : 1.2) * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        if (m) ctx.globalAlpha = 0.4;
        const pts = scatterPts(sc, m);
        if (pts) { poly(pts, false, true); ctx.stroke(); } else if (sc && isPt(sc.circle)) {
          const c = w2s(m ? mir(sc.circle) : sc.circle);
          ctx.beginPath(); ctx.arc(c[0], c[1], (+sc.r || 0) * S.view.scale, 0, 2 * Math.PI); ctx.stroke();
        }
        ctx.restore();
      }
    });
    const items = shown().filter(it => !it.card);
    if (S.show.mirror) for (const it of items) if (it.team === 2) drawItem(it, 0.45);
    for (const it of items) if (it.team !== 2) drawItem(it, 1);
    props().forEach(c => {
      const f = footprint(c);
      if (!f) return;
      drawEllipse(f, false, '#e0a060');
      if (S.show.mirror && !isOnce(c) && Math.hypot(pos3(c.pos)[0], pos3(c.pos)[1]) > 0.5) drawEllipse(f, true, '#e0a060');
    });
  }

  // the handles of a selected prop (team 1's side): turn (round, on its facing) and scale (square, a quarter back), at
  // least 18 pixels out in the view v (its ppm at the prop: 2-D the zoom, 3-D the distance)
  function handles(k, v) {
    const c = props()[k];
    if (!c || typeof c !== 'object') return null;
    const p = pos3(c.pos), a = (+c.rot || 0) * Math.PI / 180;
    const R = Math.max(entryRadius(c), 18 * vmpp(v || VIEW2D, p));
    return { anchor: p, R, rot: [p[0] + R * Math.cos(a), p[1] + R * Math.sin(a)], scale: [p[0] + R * Math.cos(a - Math.PI / 2), p[1] + R * Math.sin(a - Math.PI / 2)] };
  }
  const isPropSel = s => s && (s.t === 'prop' || s.t === 'protate' || s.t === 'pscale');

  // drawOver draws the selection's rings and handles through the view v (2-D: the 'draw' 'over' phase; 3-D: ED.marks)
  function drawOver(v) {
    if (!S.doc) return;
    v = v && v.overlay ? v : VIEW2D;
    const sel = S.sel, g = v.overlay;
    if (S.show.props && isPropSel(sel) && props()[sel.k]) {
      g.save();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 * dpr;
      for (const it of live()) {
        if (it.kind !== 'prop' || it.k !== sel.k || it.card) continue;
        const at = [it.pos[0], it.pos[1]], mpp = vmpp(v, at);
        g.globalAlpha = it.team === 2 ? 0.5 : 1;
        if (v.drape && it.team === 2) g.setLineDash([5 * dpr, 4 * dpr]); // 3-D: the mirror's ring dashed
        vring(v, at, Math.max(4 * mpp, radius(it.noun, it.scale)) + 2 * mpp);
        g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      const c = props()[sel.k], hd = handles(sel.k, v);
      if (recent(P.zShown) || (v.drape && pos3(c.pos)[2])) zLabel(v, [hd.anchor[0], hd.anchor[1]], pos3(c.pos)[2], entryRadius(c)); // its height
      if (c.group) { // the group's circle, or its polygon where it lands
        const out = groupOutline(c);
        g.setLineDash([3 * dpr, 3 * dpr]);
        if (out) vpoly(v, out, true); else vring(v, hd.anchor, entryRadius(c));
        g.stroke();
        g.setLineDash([]);
      }
      vpoly(v, [hd.anchor, hd.rot]); g.stroke();
      vmark(v, hd.rot, 'round', 5, sel.t === 'protate' ? '#58a6ff' : '#fff');
      vmark(v, hd.scale, 'square', 4.5, sel.t === 'pscale' ? '#58a6ff' : '#fff');
      vmark(v, hd.anchor, 'square', 2, '#fff');
      g.restore();
    }
    if (sel && (sel.t === 'scatter' || sel.t === 'svertex')) {
      const pts = scatterPts(scatters()[sel.k], false) || [];
      g.save();
      if (v.drape && pts.length) { g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.setLineDash([6 * dpr, 4 * dpr]); vpoly(v, pts, true); g.stroke(); } // 3-D: its region
      pts.forEach((p, i) => vmark(v, p, 'square', 4, sel.t === 'svertex' && sel.v === i ? '#58a6ff' : '#fff'));
      g.restore();
    }
  }
  // the ghosts of the placing tools under the mouse, through the view v (a preview)
  function drawGhosts(v) {
    if (!S.mouseW) return;
    if (S.tool === 'prop' && P.cur) {
      drawItem({ noun: P.cur, pos: [S.mouseW[0], S.mouseW[1], 0], rot: [0, 0, nextTurn()], scale: P.nextScale }, 0.55, v);
      const gz = ghostZ(P.cur, P.nextScale);
      if (P.nextZ || recent(P.zShown)) zLabel(v, [S.mouseW[0], S.mouseW[1]], gz, radius(P.cur, P.nextScale)); // its height
      // 3-D: the mirror the placed one gets too (team 2's copy, turned by 180), dashed
      if (v.drape && Math.hypot(S.mouseW[0], S.mouseW[1]) > 0.5) drawItem({ noun: P.cur, pos: [-S.mouseW[0], -S.mouseW[1], 0], rot: [0, 0, nextTurn() + 180], scale: P.nextScale, dashed: true }, 0.4, v);
    }
    if (S.tool === 'paste' && P.paste) {
      for (const m of P.paste.members) drawItem({ noun: m.noun, pos: [S.mouseW[0] + m.rel[0], S.mouseW[1] + m.rel[1], 0], rot: m.rot, scale: m.scale }, 0.55, v);
      const s = v.project(S.mouseW), g = v.overlay;
      if (!s) return;
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.setLineDash([3 * dpr, 3 * dpr]);
      g.beginPath(); g.arc(s[0], s[1], P.paste.r * v.ppm(S.mouseW), 0, 2 * Math.PI); g.stroke();
      g.restore();
    }
  }

  // ---- hits, drags, deletes ------------------------------------------------------------------------------

  function hitFirst(sx, sy, w, near, pk) {
    if (!S.show.props || !S.sel) return null;
    if (isPropSel(S.sel)) {
      const hd = handles(S.sel.k, (pk && ED.views[pk.view]) || VIEW2D);
      if (hd && near(hd.rot, 8)) return { sel: { t: 'protate', k: S.sel.k } };
      if (hd && near(hd.scale, 8)) return { sel: { t: 'pscale', k: S.sel.k } };
    }
    if (S.sel.t === 'scatter' || S.sel.t === 'svertex') {
      const pts = scatterPts(scatters()[S.sel.k], false) || [];
      for (let v = 0; v < pts.length; v++) if (near(pts[v], 7)) return { sel: { t: 'svertex', k: S.sel.k, v } };
    }
    return null;
  }

  function hitItems(sx, sy, w, near, pk) { // pk.near: the metres a pixel covers at the mouse
    if (!S.show.props || !S.doc) return null;
    let best = null, bd = Infinity;
    const mpp = pk ? pk.near : dpr / S.view.scale, minR = 6 * mpp;
    for (const it of shown()) {
      if (it.card || (it.team === 2 && !S.show.mirror)) continue;
      const r = Math.max(radius(it.noun, it.scale), minR), d = Math.hypot(w[0] - it.pos[0], w[1] - it.pos[1]);
      if (d <= r && d / r < bd) { bd = d / r; best = it; }
    }
    if (best) return { sel: best.kind === 'scatter' ? { t: 'scatter', k: best.k } : { t: 'prop', k: best.k }, mirrored: best.team === 2 };
    // a group's anchor, a scatter's outline
    const tol = 7 * mpp;
    for (let k = 0; k < props().length; k++) {
      const c = props()[k];
      if (!c || !c.group) continue;
      const p = pos3(c.pos);
      if (Math.hypot(w[0] - p[0], w[1] - p[1]) <= tol) return { sel: { t: 'prop', k } };
      if (S.show.mirror && !isOnce(c) && Math.hypot(w[0] + p[0], w[1] + p[1]) <= tol) return { sel: { t: 'prop', k }, mirrored: true };
    }
    for (let k = 0; k < scatters().length; k++) {
      for (const m of S.show.mirror ? [false, true] : [false]) {
        const pts = scatterPts(scatters()[k], m);
        if (pts && distLine(w, pts.concat([pts[0]])) <= tol) return { sel: { t: 'scatter', k }, mirrored: m };
      }
    }
    return null;
  }

  // setPos moves an entry to p (x, y), keeping its z; a single noun flush with the floor is lifted (flushLift)
  const setPos = (c, p) => { const z = Array.isArray(c.pos) && c.pos.length > 2 ? c.pos.slice(2) : []; c.pos = [p[0], p[1]].concat(z); flushLift(c); };

  // The flush lift (mapc's props.flush warning, applied at once): a single noun, untilted, whose model box has some
  // height and whose top (pos z + scale x the box's top) lies within FLUSH_TOL of the floor (z 0) is coplanar with the
  // compiled ground, and the two fight in the depth buffer (CM_Pass's darius_tower_binding plinths drew torn at z 0).
  // A prop placed or moved (dragged, turned or scaled with others, pasted, duplicated) with no height of its own (z 0
  // or none) gets pos z = FLUSH_LIFT - scale x the box's top, so its top lies 0.05 m up (0.05 for a top at the model's
  // z 0). A z the author set (anything but 0) is left alone. Returns the new z, or null.
  const FLUSH_TOL = 0.02, FLUSH_LIFT = 0.05;
  function flushZ(c) { // the z flushLift would give c, or null
    if (!c || !c.noun || c.group || Array.isArray(c.tilt)) return null;
    const b = (info(c.noun) || {}).box;
    if (!b || !(b.min[2] < b.max[2])) return null; // an effect's point box
    const top = scaleOf(c.scale) * b.max[2];
    return Math.abs(top) < FLUSH_TOL ? Math.round((FLUSH_LIFT - top) * 1000) / 1000 : null;
  }
  function flushLift(c) {
    if (!c || pos3(c.pos)[2] !== 0) return null;
    const z = flushZ(c);
    if (z === null) return null;
    c.pos = [c.pos[0], c.pos[1], z];
    return z;
  }
  const angleTo = (a, w) => Math.atan2(w[1] - a[1], w[0] - a[0]) * 180 / Math.PI;

  ED.sel.prop = {
    value: s => props()[s.k],
    inspector: (el, s) => propInspector(el, s.k),
    move(drag, w, e, at) { setPos(props()[drag.sel.k], at(pos3(drag.orig.pos))); },
    del(s) { edit(d => d.props.splice(s.k, 1)); select(null); },
  };
  ED.sel.protate = {
    value: s => props()[s.k],
    inspector: (el, s) => propInspector(el, s.k),
    move(drag, w, e) {
      const c = props()[drag.sel.k], a = pos3(drag.orig.pos);
      let deg = (+drag.orig.rot || 0) + angleTo(a, w) - angleTo(a, drag.start);
      deg = e && e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
      c.rot = normDeg(deg);
    },
    del(s) { ED.sel.prop.del(s); },
  };
  ED.sel.pscale = {
    value: s => props()[s.k],
    inspector: (el, s) => propInspector(el, s.k),
    move(drag, w) {
      const c = props()[drag.sel.k], a = pos3(drag.orig.pos);
      const d0 = Math.hypot(drag.start[0] - a[0], drag.start[1] - a[1]) || 1, d = Math.hypot(w[0] - a[0], w[1] - a[1]);
      const s0 = scaleOf(drag.orig.scale), s = Math.min(20, Math.max(0.05, r2(s0 * d / d0)));
      c.scale = s;
      if (Array.isArray(drag.orig.footprint)) c.footprint = drag.orig.footprint.map(v => Math.max(0.1, r1(v * s / s0)));
    },
    del(s) { ED.sel.prop.del(s); },
  };
  ED.sel.scatter = {
    value: s => scatters()[s.k],
    inspector: (el, s) => scatterInspector(el, s.k),
    move(drag, w, e, at) {
      const sc = scatters()[drag.sel.k], o = drag.orig;
      if (Array.isArray(o.polygon)) sc.polygon = o.polygon.map(at);
      if (isPt(o.circle)) sc.circle = at(o.circle);
    },
    del(s) { edit(d => d.scatter.splice(s.k, 1)); select(null); },
  };
  ED.sel.svertex = {
    value: s => { const sc = scatters()[s.k]; return sc && Array.isArray(sc.polygon) ? sc.polygon[s.v] : undefined; },
    inspector: (el, s) => scatterInspector(el, s.k),
    move(drag, w, e, at) { scatters()[drag.sel.k].polygon[drag.sel.v] = at(drag.orig); },
    del(s) {
      const pts = scatters()[s.k].polygon;
      if (pts.length <= 3) return log('a scatter region keeps at least 3 corners', 'err');
      edit(() => pts.splice(s.v, 1));
      select({ t: 'scatter', k: s.k });
    },
  };

  // ---- placing -----------------------------------------------------------------------------------------------

  // placeNoun adds props[] entry for a noun at w (on team 2's half: its source on team 1's, turned so the dropped one
  // faces as it would have)
  // nextTurn is the turn the next placed doodad gets: the dealt random one with Random turn ticked, else the field's
  // ---- heights: Alt+wheel (EDUX3, the user's request): 0.1 m a notch, 1 m with Shift; between Z_MIN and Z_MAX ----
  const Z_MIN = -10, Z_MAX = 30;
  const clampZ = z => Math.min(Z_MAX, Math.max(Z_MIN, Math.round(z * 100) / 100));
  const zStep = e => (e.shiftKey ? 1 : 0.1) * ((e.deltaY || e.deltaX) < 0 ? 1 : -1);
  // ghostZ: the height the next doodad stands at: its Next: height, or flushLift's lift where that is higher
  const ghostZ = (noun, scale) => { const f = flushZ({ noun, scale, pos: [0, 0, 0] }); return f !== null && f > P.nextZ ? f : P.nextZ; };
  const recent = t => performance.now() - t < 1500;
  const later = () => setTimeout(render, 1600); // the label goes again
  // zLabel writes "z 2.4 m" beside a ring of r metres round the ground point c, through the view v; in a view that
  // drapes (3-D) a stem from the ground up to the height
  function zLabel(v, c, z, r) {
    const g = v.overlay, s = v.project(c);
    if (!s) return;
    g.save();
    if (v.drape) {
      const top = v.project([c[0], c[1], z]);
      if (top) { g.strokeStyle = '#ffd666'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(top[0], top[1]); g.stroke(); vmark(v, [c[0], c[1], z], 'round', 3, '#ffd666'); }
    }
    g.font = `bold ${11 * dpr}px Segoe UI, sans-serif`;
    g.fillStyle = '#ffd666';
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 3 * dpr;
    const t = 'z ' + (Math.round(z * 100) / 100) + ' m', x = s[0] + r * v.ppm(c) + 6 * dpr, y = s[1] - 6 * dpr;
    g.strokeText(t, x, y);
    g.fillText(t, x, y);
    g.restore();
  }
  // wheelZ: Alt+wheel over a view raises or lowers the selected doodads (one undo step a gesture: changes within
  // 400 ms of each other); on another selection it changes nothing and says why. Alt+wheel never zooms.
  function wheelZ(e) {
    if (!e.altKey || !S.doc) return false;
    const ks = isPropSel(S.sel) ? [S.sel.k] : S.sel && Array.isArray(S.sel.ks) ? S.sel.ks : [];
    const es = ks.map(k => props()[k]).filter(c => c && typeof c === 'object');
    if (!es.length) {
      if (S.sel) log('Alt+wheel raises doodads only: the base objects, wells, camps and ward spots stand on the ground (their height is the ground\'s)', 'err');
      return true;
    }
    const now = performance.now(), key = JSON.stringify(ks), d = zStep(e);
    // the same gesture: the same doodads, within 400 ms, and its undo step still the last one (nothing undone or edited since)
    if (!P.zWheel || P.zWheel.key !== key || now - P.zWheel.at > 400 || P.zWheel.depth !== S.undo.length || P.zWheel.doc !== S.doc) pushUndo();
    P.zWheel = { key, at: now, depth: S.undo.length, doc: S.doc };
    for (const c of es) { const p = pos3(c.pos); c.pos = [c.pos[0], c.pos[1], clampZ(p[2] + d)]; }
    P.zShown = now;
    later();
    changed();
    return true;
  }
  ED.wheels.push(wheelZ);

  const deal = () => { P.dealt = Math.round(Math.random() * 3600) / 10 - 180; };
  const nextTurn = () => P.randomTurn ? P.dealt : P.nextRot;
  // setNext sets the next doodad's turn (which unticks Random turn: a turn you set wins) or size, and shows it
  function setNext(o) {
    if (o.rot !== undefined) {
      P.nextRot = normDeg(Math.round(o.rot * 10) / 10);
      if (P.randomTurn) { P.randomTurn = false; if (P.randomBox) P.randomBox.checked = false; }
    }
    if (o.scale !== undefined && o.scale > 0) P.nextScale = Math.min(20, Math.max(0.05, r2(o.scale)));
    if (o.z !== undefined && isFinite(o.z)) P.nextZ = clampZ(o.z);
    renderBrush();
    render();
    if (typeof FR !== 'undefined') FR.renderStatus();
  }

  // placeNoun places a doodad at w with the given turn and size, by default the next doodad's (the ghost's, at its
  // height); on team 2's half its source goes onto team 1's half, so that its mirror stands at w as the ghost showed it
  function placeNoun(noun, w, rot, scale) {
    if (!S.doc || !noun) return;
    let p = [r1(w[0]), r1(w[1])];
    const dealt = rot === undefined && P.randomTurn;
    rot = rot !== undefined ? rot : nextTurn();
    scale = scale !== undefined ? scale : P.nextScale;
    if (p[0] + p[1] > 0) { p = mir(p); rot = normDeg(rot + 180); }
    const entry = { noun: bare(noun), pos: P.nextZ ? p.concat([P.nextZ]) : p, rot, scale };
    if (dealt) deal();
    const fz = P.nextZ ? flushZ(Object.assign({}, entry, { pos: p })) : null;
    if (fz !== null && fz > P.nextZ) entry.pos = p.concat([fz]); // the flush lift wins where it is higher
    const lift = flushLift(entry);
    if (lift !== null) log(`${bare(noun)}: its top lies on the floor, so it stands ${lift} m up (props.flush; it would show torn at z 0)`);
    if (P.newBlocks) {
      entry.blocks = true;
      const f = boxFootprint(noun, scale);
      if (f) entry.footprint = f;
    }
    if (P.newShadow) entry.shadow = true;
    edit(d => { d.props = Array.isArray(d.props) ? d.props : []; d.props.push(entry); });
    select({ t: 'prop', k: props().length - 1 });
  }

  function placeGroup(g, w) {
    if (!S.doc || !g) return;
    let p = [r1(w[0]), r1(w[1])], rot = 0;
    if (p[0] + p[1] > 0) { p = mir(p); rot = 180; }
    const group = { level: g.level, sets: g.sets.slice(), at: g.at.slice(), r: g.r };
    P.groups.set(groupKey(group), g.members);
    edit(d => { d.props = Array.isArray(d.props) ? d.props : []; d.props.push({ group, pos: p, rot, scale: 1 }); });
    select({ t: 'prop', k: props().length - 1 });
  }

  function addScatter(pts, nouns) {
    if (!S.doc) return;
    if (!nouns.length) { scatterError('pick the doodads to scatter first: click one in the palette, Shift+click to add more'); return; }
    if (pts.length < 3) { scatterError('a region needs at least 3 corners (click them, then double-click or Enter)'); return; }
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (cx + cy > 0) pts = pts.map(mir); // drawn on team 2's half: team 1's source
    // the Brush's mode and settings, and the seed the estimate used while drawing (a new one for the next region)
    const sc = Object.assign(drawingSc(), { nouns: nouns.map(bare), polygon: pts });
    P.nextSeed = 0;
    edit(d => { d.scatter = Array.isArray(d.scatter) ? d.scatter : []; d.scatter.push(sc); });
    select({ t: 'scatter', k: scatters().length - 1 });
    const est = scatterEstimate(pts, sc);
    if (est && !est.n) scatterError(noneText(est), true); // kept and selected: move it, or change its settings
    else if (est) { P.scatterMsg = ''; renderBrush(); }
  }
  const paletteNouns = () => P.multi.size ? [...P.multi] : P.cur ? [P.cur] : [];
  // the palette's picks (EDUX11): pickOne replaces them (a plain click), togglePick adds or removes one (Shift+click,
  // Ctrl+click), unpick removes one (a chip's x); dealNoun deals Place's next doodad from several picks
  const isPicked = n => paletteNouns().some(x => key(x) === key(n));
  function dealNoun() {
    const ps = [...P.multi];
    if (ps.length > 1) P.cur = ps[Math.floor(Math.random() * ps.length)];
  }
  function fixCur() {
    const ps = [...P.multi];
    if (!ps.length) P.cur = '';
    else if (!ps.some(x => key(x) === key(P.cur))) { P.cur = ps[0]; dealNoun(); }
  }
  function pickOne(n) { P.multi = new Set([n]); P.cur = n; }
  function togglePick(n) {
    if (!P.multi.size && P.cur) P.multi.add(P.cur);
    const had = [...P.multi].find(x => key(x) === key(n));
    if (had) P.multi.delete(had); else P.multi.add(n);
    fixCur();
  }
  function unpick(n) {
    if (!P.multi.size && P.cur) P.multi.add(P.cur);
    const had = [...P.multi].find(x => key(x) === key(n));
    if (had) P.multi.delete(had);
    fixCur();
  }
  // a palette click arms the mode's tool (Place: the Prop tool, Scatter: the Scatter tool) unless it is armed; Paste
  // arms nothing (it places a group, not the picks)
  function armMode() {
    const t = { place: 'prop', scatter: 'scatter' }[P.mode];
    if (t && S.tool !== t) setTool(t);
  }
  // setMode switches the Doodads tab's mode: its tool armed (Paste only once a group is taken; else Select)
  function setMode(m) {
    P.mode = m;
    if (m === 'place') setTool('prop');
    else if (m === 'scatter') { clearScatterMsg(); setTool('scatter'); } else if (P.paste) setTool('paste');
    else { if (S.tool === 'prop' || S.tool === 'scatter') setTool('select'); renderBrush(); renderPalette(); }
  }

  // the Prop tool: a click places the next doodad (ghost() says what it writes: the noun, turn and size), wheel(e) and
  // key(e) set its turn and size before it is placed; a view that places by its own pick (the 3-D view) calls the same
  ED.tools.prop = {
    hover: true, tab: 'doodads',
    status: () => P.cur ? `Place: ${bare(P.cur)}${P.multi.size > 1 ? ` (one of ${P.multi.size} picked, at random)` : ''}, size ${P.nextScale}, ${P.randomTurn ? 'random turn' : 'turn ' + P.nextRot + '\u00B0'}, height ${P.nextZ} m` : 'Place: pick a doodad',
    hint: 'Place a doodad: each click places a picked one as the ghost shows it (several picked: one at random; or drag a tile onto the map); R / Shift+R or Shift+wheel turn it, [ ] or Ctrl+wheel size it, Alt+wheel raises or lowers it (0.1 m; Shift+Alt: 1 m). Esc ends.',
    ghost: () => P.cur ? { noun: P.cur, rot: nextTurn(), scale: P.nextScale } : null,
    down(w, e) {
      if (!P.cur) { log('pick a doodad in the palette first', 'err'); return; }
      placeNoun(P.cur, snapW(w, e));
      if (P.multi.size > 1) { dealNoun(); renderPalette(); render(); } // several picked: the next one at random (the ghost shows it)
    },
    wheel(e) { // Ctrl+wheel sizes, Shift+wheel turns, Alt+wheel raises (Shift+Alt: by a metre); the plain wheel zooms
      const d = e.deltaY || e.deltaX;
      if (!d || !(e.ctrlKey || e.shiftKey || e.altKey)) return false;
      if (e.altKey) { setNext({ z: P.nextZ + zStep(e) }); P.zShown = performance.now(); later(); return true; }
      if (e.ctrlKey) setNext({ scale: P.nextScale * (d < 0 ? 1.1 : 1 / 1.1) });
      else setNext({ rot: nextTurn() + (d < 0 ? 15 : -15) });
      return true;
    },
    key(e) { // R / Shift+R turn by 15 degrees, ] and [ size by 10 %
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'r' || e.key === 'R') { setNext({ rot: nextTurn() + (e.shiftKey ? -15 : 15) }); return true; }
      if (e.key === ']' || e.key === '[') { setNext({ scale: P.nextScale * (e.key === ']' ? 1.1 : 1 / 1.1) }); return true; }
      return false;
    },
  };
  ED.tools.paste = {
    hover: true, tab: 'doodads',
    status: () => P.paste ? `Paste: ${P.paste.members.length} markers of ${P.paste.level}` : 'Paste',
    hint: 'Paste: click where the group\'s centre goes. Esc ends.',
    down(w, e) { if (P.paste) placeGroup(P.paste, snapW(w, e)); },
  };
  // the Scatter tool (Brush: Scatter along the walls): a region drawn as a polygon; while it is drawn the wall-edge
  // cells that get doodads are marked and the estimate shown (drawEstimate); refusals stay in the Doodads tab
  const scatterHint = () => P.smode === 'fill'
    ? 'Fill area: pick the doodads to scatter in the palette (Shift+click adds more), then draw the region (click its corners; double-click or Enter ends). The bright dots get doodads; rocks and trees go on walkable ground only with Block.'
    : 'Scatter along the walls: pick the doodads to scatter in the palette (Shift+click adds more), then draw the region over a wall edge (click its corners; double-click or Enter ends). The marked cells get doodads.';
  // setSmode switches the Brush's scatter between along the walls and fill area (and its settings for the next region)
  function setSmode(o) {
    Object.assign(P, o);
    P.estKey = '';
    renderBrush();
    if (S.tool === 'scatter' && $('toolHint')) $('toolHint').textContent = scatterHint();
    if (typeof FR !== 'undefined') FR.renderStatus();
    render();
  }
  ED.tools.scatter = {
    tab: 'doodads', hover: true,
    status: () => {
      const r = scatterRegion(), est = r && r.drawing ? scatterEstimate(r.region, r.sc) : null, fill = P.smode === 'fill';
      return `${fill ? 'Fill area' : 'Scatter along the walls'}: ${paletteNouns().length} doodad${paletteNouns().length === 1 ? '' : 's'} picked` +
        (est ? ` \u00B7 ${fill ? '' : '\u2248 '}${est.n} placed` : '');
    },
    get hint() { return scatterHint(); },
    down(w, e) {
      if (!S.drawing && !paletteNouns().length) { scatterError('pick the doodads to scatter first: click one in the palette, Shift+click to add more'); return; }
      clearScatterMsg();
      drawDown(w, e, 'polygon');
      if (typeof FR !== 'undefined') FR.renderStatus();
    },
    finish(pts) { addScatter(pts, paletteNouns()); setTool('select'); },
  };

  ED.keys = e => {
    if (S.tool === 'prop' && ED.tools.prop.key(e)) return true; // the Prop tool armed: R and [ ] shape the next doodad
    if (!isPropSel(S.sel) || !props()[S.sel.k]) return false;
    const k = S.sel.k, c = props()[k];
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const copy = JSON.parse(JSON.stringify(c));
      const p = pos3(c.pos);
      setPos(copy, [r1(p[0] + 4), r1(p[1] - 4)]);
      edit(d => d.props.splice(k + 1, 0, copy));
      select({ t: 'prop', k: k + 1 });
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'r' || e.key === 'R') { edit(() => { c.rot = normDeg((+c.rot || 0) + (e.shiftKey ? -15 : 15)); }); return true; }
    if (e.key === '[' || e.key === ']') {
      const s0 = scaleOf(c.scale), s = Math.min(20, Math.max(0.05, r2(s0 * (e.key === ']' ? 1.1 : 1 / 1.1))));
      edit(() => { c.scale = s; if (Array.isArray(c.footprint)) c.footprint = c.footprint.map(v => Math.max(0.1, r1(v * s / s0))); });
      return true;
    }
    return false;
  };

  // ---- the inspectors ----------------------------------------------------------------------------------------

  const numIn = (label, get, set, step) => h('label', {}, label + ' ', h('input', { type: 'number', step: step || '0.1', value: get() ?? '',
    onchange: ev => edit(() => set(+ev.target.value)) }));
  const chkIn = (label, get, set, title) => h('label', { title }, h('input', { type: 'checkbox', checked: !!get(),
    onchange: ev => edit(() => set(ev.target.checked)) }), ' ' + label);
  const placedOf = (kind, k) => live().filter(it => it.kind === kind && it.k === k && !it.card);

  // waterZ is the height a prop at p floats at: the water plane (mapc's, from the last check) of the chasm under it plus
  // 0.1 m, or null. The plane of the chasm shape that holds p wins; else a plane whose turned rectangle holds it.
  function waterZ(p) {
    const ws = (S.preview && S.preview.water) || [];
    const inRect = w => {
      const a = -(w.rot || 0) * Math.PI / 180, dx = p[0] - w.pos[0], dy = p[1] - w.pos[1];
      const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(x) <= w.size[0] / 2 && Math.abs(y) <= w.size[1] / 2;
    };
    const own = ws.filter(w => w.team !== 2);
    const w = own.find(w => shapeHit(shapes()[w.shape], p)) || own.find(inRect) || ws.find(inRect);
    return w ? r1(w.pos[2] + 0.1) : null;
  }
  ED.waterZ = waterZ;

  function propInspector(el, k) {
    const c = props()[k];
    const p = pos3(c.pos);
    el.append(h('div', { class: 'path' }, `props[${k}]`));
    const once = isOnce(c);
    const mirrorNote = once ? (c.group ? 'mirror off: the members stand once, where the level has them (moved with the group), on either half; no copy for team 2' : 'mirror off: it stands once, where it is, on either half; no copy for team 2')
      : Math.hypot(p[0], p[1]) <= 0.5 ? 'at the centre: it stands once' : `team 2's mirror at (${r1(-p[0])}, ${r1(-p[1])}), turned 180`;
    const mirrorIn = chkIn('mirror for team 2', () => !once, on => { if (on) delete c.mirror; else c.mirror = false; },
      'On: authored on team 1\'s half and mirrored for team 2 (the check refuses it on team 2\'s half). Off ("mirror": false): it stands once, where it is.');
    if (c.group) {
      const g = c.group, n = placedOf('prop', k);
      el.append(h('div', {}, once ? `group of ${g.level}: ${n.length} markers, each once` : `group of ${g.level}: ${n.filter(i => i.team !== 2).length} markers (team 1)`),
        xyInputs(() => c.pos, q => setPos(c, q)), mirrorIn, h('p', { class: 'small' }, mirrorNote),
        numIn('turn (degrees)', () => c.rot || 0, v => { c.rot = normDeg(v); }, '1'),
        numIn('scale', () => scaleOf(c.scale), v => { c.scale = v; }, '0.05'),
        h('p', { class: 'small' }, 'Drag it, or turn and scale it by its handles (R / Shift+R turn 15 degrees, [ and ] scale). A group neither blocks nor gets a shadow: draw a wall shape where it should block.'),
        adv(h('label', {}, 'sets ', h('input', { value: (g.sets || []).join(', '), onchange: ev => edit(() => { g.sets = ev.target.value.split(/[ ,]+/).filter(Boolean); }) })),
          h('div', { class: 'small' }, groupPoly(g) ? `taken from ${g.level} inside a polygon of ${g.polygon.length} corners (its coordinates; drawn dashed where it lands); at lands on pos:` : `taken from ${g.level} within r of at:`),
          xyInputs(() => g.at, q => { g.at = q; }),
          groupPoly(g) ? h('span') : numIn('r (m)', () => g.r, v => { g.r = v; }, '1'),
          Array.isArray(g.holes) && g.holes.length ? h('div', { class: 'small' }, `${g.holes.length} hole${g.holes.length > 1 ? 's' : ''}: the members taken out as single props`) : null,
          h('div', { class: 'btns' }, h('button', { title: 'Turn every member into a single prop (its noun, place, height, turn, scale and tilt); to take only some, drag a box over them and split the box', onclick: () => PS.split([k], null) }, 'Split into props'))));
    } else {
      const inf = info(c.noun), n = placedOf('prop', k);
      appendAll(el, h('label', {}, 'noun ', h('input', { list: 'propNouns', value: c.noun || '', onchange: ev => edit(() => { c.noun = bare(ev.target.value); }) })),
        h('div', { class: 'small' }, inf ? `${inf.type}, box ${r1(inf.box.max[0] - inf.box.min[0])} x ${r1(inf.box.max[1] - inf.box.min[1])} x ${r1(inf.box.max[2] - inf.box.min[2])} m` + (inf.icon ? '' : ' (no model in the copy)') : (P.state === 'ready' ? 'not a dressing noun of the copy' : '')),
        P.cur && key(P.cur) !== key(c.noun) ? h('div', { class: 'btns' }, h('button', { onclick: () => edit(() => { c.noun = bare(P.cur); }) }, 'Use ' + bare(P.cur))) : null,
        xyInputs(() => c.pos, q => setPos(c, q)),
        numIn('height z (m)', () => pos3(c.pos)[2], v => { const q = pos3(c.pos); c.pos = v ? [q[0], q[1], v] : [q[0], q[1]]; }),
        flushZ(c) !== null ? h('p', { class: 'small', 'data-flush': String(flushZ(c)) }, pos3(c.pos)[2] === flushZ(c)
          ? `Lifted to z ${flushZ(c)} at once: this model's top lies at its z 0, and on the floor (z 0) the two surfaces fight and it shows torn (props.flush). Another height you set is kept; z 0 is lifted again at the next move.`
          : pos3(c.pos)[2] === 0 ? `Its top lies on the floor (z 0): it would show torn (props.flush). A move lifts it to z ${flushZ(c)}, or set a height.` : 'Its model\'s top lies at its z 0: at z 0 it would show torn (props.flush); this height is yours and kept.') : null,
        h('div', { class: 'btns' }, h('button', { title: 'Sets z to the water plane under the prop (the check\'s chasm water) plus 0.1 m, so it floats on it',
          onclick: () => { const z = waterZ(c.pos); if (z === null) { log('no water under the prop (a chasm with water, after a check)', 'err'); return; } edit(() => { const q = pos3(c.pos); c.pos = [q[0], q[1], z]; }); } }, 'On the water')),
        mirrorIn, h('p', { class: 'small' }, mirrorNote),
        numIn('turn (degrees, counter-clockwise from east)', () => c.rot || 0, v => { c.rot = normDeg(v); }, '1'),
        Array.isArray(c.tilt) ? adv(h('div', { class: 'xy', title: 'The lean about x and y (degrees) a member taken out of a group keeps' }, 'tilt x',
          h('input', { type: 'number', step: '1', value: c.tilt[0], onchange: ev => edit(() => { c.tilt = [+ev.target.value || 0, c.tilt[1]]; if (!c.tilt[0] && !c.tilt[1]) delete c.tilt; }) }),
          'y', h('input', { type: 'number', step: '1', value: c.tilt[1], onchange: ev => edit(() => { c.tilt = [c.tilt[0], +ev.target.value || 0]; if (!c.tilt[0] && !c.tilt[1]) delete c.tilt; }) }))) : null,
        numIn('scale', () => scaleOf(c.scale), v => {
          const s0 = scaleOf(c.scale);
          c.scale = v;
          if (Array.isArray(c.footprint) && v > 0) c.footprint = c.footprint.map(x => Math.max(0.1, r1(x * v / s0)));
        }, '0.05'),
        chkIn('blocks (walking and sight)', () => c.blocks, on => {
          if (on) { c.blocks = true; const f = boxFootprint(c.noun, scaleOf(c.scale)); if (f) c.footprint = f; } else { delete c.blocks; delete c.footprint; }
        }, 'Its footprint becomes blocking ground; the footprint is written from the model\'s box (edit it below)'),
        chkIn('shadow card under it', () => c.shadow, on => { if (on) c.shadow = true; else delete c.shadow; }));
      if (c.blocks) {
        const f = Array.isArray(c.footprint) ? c.footprint : null;
        el.append(adv(h('div', { class: 'xy' }, 'footprint w', h('input', { type: 'number', step: '0.1', value: f ? f[0] : '', onchange: ev => edit(() => { c.footprint = [+ev.target.value, f ? f[1] : +ev.target.value]; }) }),
          'd', h('input', { type: 'number', step: '0.1', value: f ? f[1] : '', onchange: ev => edit(() => { c.footprint = [f ? f[0] : +ev.target.value, +ev.target.value]; }) })),
        h('div', { class: 'btns' }, h('button', { onclick: () => edit(() => { const g = boxFootprint(c.noun, scaleOf(c.scale)); if (g) c.footprint = g; }) }, 'From the model\'s box')),
        h('p', { class: 'small' }, 'The ellipse (w along the prop\'s turned x, d along its y) centred on the prop blocks units and sight. For a tree give the trunk\'s.')));
      }
      el.append(h('p', { class: 'small' }, `${n.length} marker${n.length === 1 ? '' : 's'} placed (${once ? 'once' : 'both teams'}). Drag it; the round handle turns it (Shift: 15-degree steps), the square one scales it; R / Shift+R turn, [ and ] scale, Ctrl+D duplicates.`));
    }
    el.append(h('div', { class: 'btns' }, h('button', { onclick: () => ED.keys({ key: 'd', ctrlKey: true, preventDefault() {} }) }, 'Duplicate'),
      h('button', { onclick: deleteSel }, 'Delete')),
    jsonEditor(c, v => { S.doc.props[k] = v; }));
  }

  function scatterInspector(el, k) {
    const sc = scatters()[k];
    const n = placedOf('scatter', k).filter(i => i.team === 1).length;
    const nouns = Array.isArray(sc.nouns) ? sc.nouns : [];
    const fill = sc.along === 'area', on = sc.on || 'any';
    const blocking = placedOf('scatter', k).filter(i => i.team === 1 && i.blocks).length;
    appendAll(el, h('div', { class: 'path' }, `scatter[${k}]`),
      h('div', {}, fill ? `${n} props on team 1's half (and their mirrors), filling the region (${FILL_ON.find(o => o[0] === on)?.[1] || on}${sc.blocks ? `; ${blocking} block` : ''})`
        : `${n} props on team 1's half (and their mirrors), along the walls inside the region`),
      (() => { const est = scatterEstimate(scatterPts(sc, false) || (isPt(sc.circle) ? { circle: sc.circle, r: +sc.r || 0 } : null), sc);
        return est ? h('div', { class: est.n ? 'small' : 'small warn', 'data-estimate': est.n }, est.n ? (fill ? `the page counts ${est.n} (the bright dots)` : `the page estimates \u2248 ${est.n} (the marked wall-edge cells)`) : noneText(est)) : null; })(),
      h('div', { class: 'row', title: 'Along the walls: at the wall edge inside the region. Fill area: over the whole region.' }, h('span', { class: 'small' }, 'Scatter'),
        h('button', { class: fill ? '' : 'on', 'data-smode-sel': 'walls', onclick: () => edit(() => { delete sc.along; delete sc.on; delete sc.blocks; delete sc.footprint; delete sc.density; }) }, 'Along the walls'),
        h('button', { class: fill ? 'on' : '', 'data-smode-sel': 'fill', onclick: () => edit(() => { sc.along = 'area'; delete sc.inset; }) }, 'Fill area')),
      fill ? h('div', { class: 'row' }, h('span', { class: 'small' }, 'Where'),
        h('select', { 'data-fill-sel': 'on', onchange: ev => edit(() => { if (ev.target.value === 'any') delete sc.on; else sc.on = ev.target.value; }) },
          ...FILL_ON.map(([v, t]) => h('option', { value: v, selected: on === v }, t))),
        chkIn('Block', () => sc.blocks, b => { if (b) sc.blocks = true; else { delete sc.blocks; delete sc.footprint; } }, 'Rocks and trees on walkable ground block walking and sight; plants never block')) : null,
      h('div', { class: 'chips' }, ...nouns.map((x, i) => h('span', { class: 'chip' }, x, h('button', { title: 'Remove', onclick: () => edit(() => nouns.splice(i, 1)) }, 'x')))),
      h('div', { class: 'btns' }, h('button', { disabled: !paletteNouns().length, onclick: () => edit(() => {
        sc.nouns = nouns.concat(paletteNouns().map(bare).filter(x => !nouns.some(y => key(y) === key(x))));
      }) }, `Add the palette's selection (${paletteNouns().length})`)),
      h('div', { class: 'btns' }, h('button', { onclick: () => { edit(d => d.scatter.splice(k, 1)); select(null); } }, 'Delete')),
      adv(h('div', { class: 'small' }, 'Scatter settings'),
      h('div', { class: 'xy' }, numIn('seed', () => sc.seed, v => { sc.seed = Math.max(0, Math.round(v)); }, '1'),
        h('button', { onclick: () => edit(() => { sc.seed = 1 + Math.floor(Math.random() * 999999); }) }, 'New seed')),
      numIn('spacing (m, default 6)', () => sc.spacing || '', v => { if (v) sc.spacing = v; else delete sc.spacing; }, '0.5'),
      fill ? null : numIn('inset into the wall (m, default 1)', () => sc.inset || '', v => { if (v) sc.inset = v; else delete sc.inset; }, '0.5'),
      fill ? numIn('density (0-1, default 1: every spaced place)', () => sc.density || '', v => { if (v > 0 && v < 1) sc.density = v; else delete sc.density; }, '0.05') : null,
      fill && sc.blocks ? numIn('footprint (m across at size 1, default 2)', () => sc.footprint || '', v => { if (v) sc.footprint = v; else delete sc.footprint; }, '0.5') : null,
      numIn('at most (team 1, default 200)', () => sc.max || '', v => { if (v) sc.max = Math.round(v); else delete sc.max; }, '1'),
      h('div', { class: 'xy' }, 'scale', h('input', { type: 'number', step: '0.05', value: (sc.scale || [0.8, 1.2])[0], onchange: ev => edit(() => { sc.scale = [+ev.target.value, (sc.scale || [0.8, 1.2])[1]]; }) }),
        'to', h('input', { type: 'number', step: '0.05', value: (sc.scale || [0.8, 1.2])[1], onchange: ev => edit(() => { sc.scale = [(sc.scale || [0.8, 1.2])[0], +ev.target.value]; }) })),
      chkIn('shadow cards', () => sc.shadow, on => { if (on) sc.shadow = true; else delete sc.shadow; })),
      h('p', { class: 'small' }, 'Drag the region\'s outline to move it, its corners to reshape it (Del deletes a corner).'),
      jsonEditor(sc, v => { S.doc.scatter[k] = v; }));
  }

  // ---- the palette ---------------------------------------------------------------------------------------

  function showStatus(t) { if (P.status) P.status.textContent = t; }

  // the Doodads tab (D), top to bottom (EDUX11: how you place, then what): (1) the Brush group: the mode Place |
  // Scatter | Paste group (P.mode) and right under it that mode's settings only (Place: the next doodad's size, turn
  // and height, Random turn, Blocks, Shadow; Scatter: Along the walls / Fill area, Where, Block, density; Paste: Pick a
  // group from SM_Map_v5...); (2) the palette: the category, the search, With a model, the picks (a chip each), the
  // tiles. A click picks one doodad (replacing the picks), Shift+click (or Ctrl+click) adds or removes one; neither
  // changes the mode. Place lays one of the picks per click (several: one at random, dealt ahead), Scatter all of them.
  function buildPalette() {
    P.brush = ED.addPane('doodads', 'Brush', 5);
    const body = ED.addPane('doodads', 'Doodads', 10);
    body.classList.add('palette');
    const search = h('input', { type: 'search', placeholder: 'search', oninput: ev => { P.search = ev.target.value; renderPalette(); } });
    const type = h('select', { title: 'Category', onchange: ev => { P.type = ev.target.value; renderPalette(); } },
      ...[['', 'All'], ['obstacle', 'Obstacles'], ['terrain', 'Terrain pieces'], ['Placeable Effect', 'Effects and lights'], ['other', 'Other']].map(([v, t]) => h('option', { value: v }, t)));
    P.grid = h('div', { class: 'grid' });
    P.status = h('div', { class: 'small' }, 'open a map');
    P.picksEl = h('div', { class: 'picks' });
    body.append(h('div', { class: 'bar' }, type, search),
      h('div', { class: 'opts small' }, h('label', { title: 'Hide the doodads whose model your copy lacks (they draw nothing)' },
        h('input', { type: 'checkbox', checked: P.modelOnly, 'data-opt': 'modelOnly', onchange: ev => { P.modelOnly = ev.target.checked; renderPalette(); } }), ' With a model')),
      P.picksEl, P.grid, P.status,
      h('p', { class: 'hint' }, 'Click a doodad to pick it, Shift+click to add or remove one (Ctrl+click too). Place lays a pick per click (several: one at random), Scatter uses all of them. Or drag a tile onto the map.'));
    renderBrush();
  }
  const MODES = [['place', 'prop', 'Place', 'Each click places one of the picked doodads, as the ghost shows it'],
    ['scatter', 'scatter', 'Scatter', 'Draw a region: the picked doodads go along its wall edge, or fill it (Fill area)'],
    ['paste', 'paste', 'Paste group', 'Take a dressed group from SM_Map_v5 and place it']];
  // an option new doodads get (Place's Random turn, Blocks, Shadow)
  const opt = (label, k, title) => h('label', { title }, h('input', { type: 'checkbox', checked: P[k], 'data-opt': k,
    onchange: ev => { P[k] = ev.target.checked; if (k === 'randomTurn') { deal(); render(); } renderBrush(); renderPalette(); } }), ' ' + label);
  function renderBrush() {
    if (!P.brush) return;
    P.brush.textContent = '';
    P.brush.parentNode.classList.toggle('armed', S.tool === 'prop' || S.tool === 'scatter' || S.tool === 'paste');
    const m = P.mode;
    const modes = h('div', { class: 'row seg' }, ...MODES.map(([id, tool, t, tip]) =>
      h('button', { class: m === id ? 'on' : '', 'data-dmode': id, 'data-dtool': tool, title: tip, onclick: () => setMode(id) }, t)));
    if (m === 'place') {
      const random = opt('Random turn', 'randomTurn', 'Each placed doodad gets a random turn (the ghost shows the next one); setting a turn unticks it');
      P.randomBox = random.querySelector('input');
      appendAll(P.brush, modes,
        // the next doodad's size, turn and height: a caption, then the three fields on one line (each label with its
        // field and unit, so the line never breaks inside one)
        h('div', { class: 'small next-cap', title: 'The next doodad: kept for the next placements' }, 'Next doodad'),
        h('div', { class: 'row next3', title: 'The next doodad: kept for the next placements' },
          h('label', { class: 'small' }, 'size',
            h('input', { type: 'number', step: '0.05', min: '0.05', max: '20', value: P.nextScale, 'data-next': 'scale', onchange: ev => setNext({ scale: +ev.target.value }) })),
          h('label', { class: 'small' }, 'turn',
            h('input', { type: 'number', step: '15', value: P.randomTurn ? '' : P.nextRot, placeholder: 'random', 'data-next': 'rot', onchange: ev => { if (ev.target.value !== '') setNext({ rot: +ev.target.value }); } }),
            '\u00B0'),
          h('label', { class: 'small', title: 'Its height (pos z, metres): Alt+wheel, Shift+Alt+wheel by a metre' }, 'height',
            h('input', { type: 'number', step: '0.1', min: String(Z_MIN), max: String(Z_MAX), value: P.nextZ, 'data-next': 'z', onchange: ev => setNext({ z: +ev.target.value || 0 }) }),
            'm')),
        h('div', { class: 'opts small' }, random,
          opt('Blocks', 'newBlocks', 'New doodads block walking and sight (their footprint from the box)'),
          opt('Shadow', 'newShadow', 'New doodads get a shadow card')),
        h('div', { class: 'note' }, (P.multi.size > 1 ? `${P.multi.size} picked: each click lays one of them at random (the ghost shows the next). ` : '') +
          'While placing: R / Shift+R or Shift+wheel turn the next doodad, [ ] or Ctrl+wheel size it, Alt+wheel raises or lowers it (the ghost shows it). Random turn wins until you set a turn. With Select they act on the selected doodads; Ctrl+D duplicates.'));
      return;
    }
    if (m === 'scatter') {
      const fill = P.smode === 'fill';
      appendAll(P.brush, modes,
        h('div', { class: 'row seg', title: 'How Scatter places the doodads' },
          h('button', { class: !fill ? 'on' : '', 'data-smode': 'walls', title: 'Doodads along the wall edge inside the region (at the cliff foot)', onclick: () => setSmode({ smode: 'walls' }) }, 'Along the walls'),
          h('button', { class: fill ? 'on' : '', 'data-smode': 'fill', title: 'Doodads over the whole region: plants anywhere, rocks and trees off walkable ground (or blocking it with Block)', onclick: () => setSmode({ smode: 'fill' }) }, 'Fill area')),
        fill ? h('div', { class: 'row', title: 'Where the fill places doodads, and whether its rocks and trees block' }, h('span', { class: 'small' }, 'Where'),
          h('select', { 'data-fill': 'on', onchange: ev => setSmode({ fillOn: ev.target.value }) }, ...FILL_ON.map(([v, t]) => h('option', { value: v, selected: (P.fillOn || 'any') === v }, t))),
          h('label', { class: 'small', title: 'Rocks and trees on walkable ground block walking and sight (a 2 m footprint each, times its size): units and bots go round them. Plants never block.' },
            h('input', { type: 'checkbox', 'data-fill': 'blocks', checked: !!P.fillBlocks, onchange: ev => setSmode({ fillBlocks: ev.target.checked }) }), ' Block')) : null,
        fill ? h('div', { class: 'row', title: 'The share of the spaced places that get a doodad (0-1; empty: every one)' }, h('span', { class: 'small' }, 'Density'),
          h('input', { type: 'number', step: '0.05', min: '0.05', max: '1', placeholder: '1', value: P.fillDensity || '', 'data-fill': 'density',
            onchange: ev => { const v = +ev.target.value; setSmode({ fillDensity: v > 0 && v < 1 ? v : 0 }); } })) : null,
        P.scatterMsg ? h('div', { class: 'note scattermsg', 'data-scatter-msg': '1' }, P.scatterMsg) : null,
        h('div', { class: 'note' }, `${paletteNouns().length ? paletteNouns().length + ' picked. ' : 'Pick the doodads below (Shift+click adds more). '}Draw the region: click its corners, Enter ends. Its settings: Advanced > Scatter Settings; a new seed: Tools.` +
          (fill ? ' Plants (grass, flowers, ferns, leaves, mushrooms) may stand anywhere; rocks and trees on walkable ground only with Block. Lanes, bases, wells and camps stay clear.' : '')));
      return;
    }
    appendAll(P.brush, modes,
      h('div', { class: 'row' }, h('button', { 'data-paste': '1', title: 'Take a dressed group from the original map', onclick: openPaste }, 'Pick a group from SM_Map_v5...')),
      P.paste ? h('div', { class: 'small' }, `Placing ${P.paste.members.length} markers of ${P.paste.level}: click where the group's centre goes.`) : null,
      h('div', { class: 'note' }, 'A group\'s doodads move, turn and scale together; Advanced > Split the Group into Doodads makes them single. The palette\'s picks are for Place and Scatter.'));
  }
  ED.on('tool', t => {
    const m = { prop: 'place', scatter: 'scatter', paste: 'paste' }[t];
    if (m) P.mode = m;
    if (t === 'prop' || t === 'paste') P.scatterMsg = '';
    renderBrush();
    renderPicks();
  });
  ED.on('doc', () => { if (P.scatterMsg && P.scatterMsg !== NO_EDGE && !Object.values(NO_FILL).includes(P.scatterMsg) && S.tool !== 'scatter') clearScatterMsg(); });

  function renderPalette() {
    if (!P.grid) return;
    P.grid.textContent = '';
    if (P.state !== 'ready') return;
    const words = P.search.toLowerCase().split(/\s+/).filter(Boolean);
    const known = ['obstacle', 'terrain', 'Placeable Effect'];
    let shown = 0;
    for (const n of P.nouns) {
      if (P.modelOnly && !n.icon) continue;
      if (P.type && (P.type === 'other' ? known.includes(n.type) : n.type !== P.type)) continue;
      const nm = bare(n.name).toLowerCase();
      if (!words.every(w => nm.includes(w))) continue;
      shown++;
      const b = n.box, size = b ? `${r1(b.max[0] - b.min[0])} x ${r1(b.max[1] - b.min[1])} x ${r1(b.max[2] - b.min[2])} m` : '';
      const tile = h('div', {
        class: 'tile' + (isPicked(n.name) ? ' cur' : '') + (n.icon ? '' : ' nomodel'),
        title: `${bare(n.name)}\n${n.type}, ${size}\nClick: pick it; Shift+click: add or remove it`, draggable: 'true', 'data-noun': n.name,
        onclick: ev => { // EDUX11: a click replaces the picks, Shift+click (Ctrl+click) adds or removes; the mode stays
          if (ev.ctrlKey || ev.shiftKey || ev.metaKey) togglePick(n.name); else pickOne(n.name);
          clearScatterMsg();
          armMode();
          renderPalette();
          renderBrush();
          renderInspector();
          render();
          if (typeof FR !== 'undefined') FR.renderStatus();
        },
        ondragstart: ev => { ev.dataTransfer.setData('text/x-dg-noun', n.name); ev.dataTransfer.setData('text/plain', bare(n.name)); },
      }, n.icon ? h('img', { src: n.icon.url, loading: 'lazy', alt: '' }) : h('div', { class: 'noimg' }, n.type), h('div', { class: 'nm' }, bare(n.name)));
      P.grid.append(tile);
    }
    showStatus(`${shown} of ${P.nouns.length} doodads`);
    renderPicks();
  }
  // the picks above the tiles: "3 picked", a chip each (x removes it; Place's next one marked)
  function renderPicks() {
    if (!P.picksEl) return;
    P.picksEl.textContent = '';
    const ps = paletteNouns();
    if (!ps.length) { P.picksEl.append(h('span', { class: 'small', 'data-picks': '0' }, 'Nothing picked: click a doodad; Shift+click adds more')); return; }
    P.picksEl.append(h('span', { class: 'small', 'data-picks': String(ps.length) }, `${ps.length} picked`),
      ...ps.map(n => h('span', { class: 'chip' + (P.mode === 'place' && ps.length > 1 && key(n) === key(P.cur) ? ' next' : ''), 'data-chip': n,
        title: bare(n) + (P.mode === 'place' && ps.length > 1 && key(n) === key(P.cur) ? ' (placed next)' : '') },
      bare(n), h('button', { class: 'x', title: 'Remove it from the picks', onclick: () => { unpick(n); renderPalette(); renderBrush(); render(); if (typeof FR !== 'undefined') FR.renderStatus(); } }, '\u00D7'))));
  }

  // dropping a palette tile onto a view places it where the view's pick says (the 2-D canvas here; EDUX3: the 3-D's)
  function dropOnto(v, el) {
    el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-dg-noun')) e.preventDefault(); });
    el.addEventListener('drop', e => {
      const n = e.dataTransfer.getData('text/x-dg-noun'), pk = S.doc && v.pick(e);
      if (!n || !pk) return;
      e.preventDefault();
      placeNoun(n, snapW(pk.w, e));
    });
  }
  dropOnto(VIEW2D, cv);
  dropOnto(ED.views['3d'], V3D.V.canvas); // EDUX3: placed where the 3-D view's pick says

  // ---- paste from SM_Map_v5: pick a spot and a radius on the level's markers ----------------------------------

  const DRESS = /_D_|Lights|shadow|Water|Scene/i;
  function setColour(set) {
    if (/D_Rocks/i.test(set)) return '#c49a6c';
    if (/D_Trees|Canop/i.test(set)) return '#4caf50';
    if (/D_Foliage|Ivy|Flower|Grass/i.test(set)) return '#9ccc65';
    if (/Water/i.test(set)) return '#4fc3f7';
    if (/Light/i.test(set)) return '#ffd54f';
    if (/_D_/i.test(set)) return '#ce93d8';
    return '#555b66';
  }
  const suffix = set => set.slice(P.levelName.length + 1);

  function buildPaste() {
    const d = h('dialog', { id: 'dlgPaste' });
    d.innerHTML = `<h2>Paste a group from <span class="lvl"></span></h2>
<div class="wrap"><canvas width="600" height="600"></canvas><div class="side">
<p class="small">Click the spot to take; wheel zooms, right drag pans. The group is every marker of the ticked sets within r of it; members that aren't dressing are left out.</p>
<label>r (m, at most 80) <input type="number" class="r" min="1" max="80" step="1" value="12"></label>
<div class="at small"></div><div class="sets"></div><div class="count small"></div></div></div>
<menu><button class="cancel">Cancel</button> <button class="place" disabled>Place...</button></menu>`;
    document.body.append(d);
    const c = d.querySelector('canvas'), g = c.getContext('2d');
    const V = { x: 0, y: 0, s: 1 };
    const w2c = p => [300 + (p[0] - V.x) * V.s, 300 - (p[1] - V.y) * V.s], c2w = (x, y) => [(x - 300) / V.s + V.x, -(y - 300) / V.s + V.y];
    const cpos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * 600 / r.width, (e.clientY - r.top) * 600 / r.height]; };
    function members() {
      if (!P.level || !P.pick || !P.pick.at) return [];
      const at = P.pick.at, r = P.pick.r, sets = new Set(P.pick.sets);
      return P.level.objects.filter(o => o.parts && o.parts.length && !o.hidden && sets.has(suffix(o.markerset || '')) &&
        Math.hypot(o.pos[0] - at[0], o.pos[1] - at[1]) <= r);
    }
    function draw() {
      g.fillStyle = '#0f1114';
      g.fillRect(0, 0, 600, 600);
      if (!P.level) { g.fillStyle = '#8b95a3'; g.fillText('reading ' + P.levelName + ' (mapc scene)...', 20, 30); return; }
      for (const o of P.level.objects) {
        if (!o.parts || o.hidden) continue;
        const p = w2c(o.pos);
        if (p[0] < 0 || p[1] < 0 || p[0] > 600 || p[1] > 600) continue;
        g.fillStyle = setColour(o.markerset || '');
        g.fillRect(p[0] - 1, p[1] - 1, 2.5, 2.5);
      }
      if (P.pick && P.pick.at) {
        const p = w2c(P.pick.at);
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(p[0], p[1], P.pick.r * V.s, 0, 2 * Math.PI); g.stroke();
        g.fillStyle = '#fff';
        for (const o of members()) { const q = w2c(o.pos); g.fillRect(q[0] - 2, q[1] - 2, 4, 4); }
      }
    }
    function side() {
      const el = d.querySelector('.sets');
      el.textContent = '';
      if (!P.level || !P.pick || !P.pick.at) { d.querySelector('.place').disabled = true; return; }
      const at = P.pick.at, counts = new Map();
      for (const o of P.level.objects) {
        if (!o.parts || !o.parts.length || o.hidden || Math.hypot(o.pos[0] - at[0], o.pos[1] - at[1]) > P.pick.r) continue;
        const s = suffix(o.markerset || '');
        counts.set(s, (counts.get(s) || 0) + 1);
      }
      for (const [s, n] of [...counts].sort()) {
        el.append(h('label', {}, h('input', { type: 'checkbox', checked: P.pick.sets.includes(s), onchange: ev => {
          P.pick.sets = ev.target.checked ? P.pick.sets.concat([s]) : P.pick.sets.filter(x => x !== s);
          side(); draw();
        } }), ` ${s} (${n})`));
      }
      d.querySelector('.at').textContent = `at (${at[0]}, ${at[1]})`;
      const m = members();
      d.querySelector('.count').textContent = `${m.length} markers in the group`;
      d.querySelector('.place').disabled = !m.length;
    }
    c.addEventListener('mousedown', e => {
      const [x, y] = cpos(e);
      if (e.button !== 0) { V.pan = { x, y, vx: V.x, vy: V.y }; e.preventDefault(); return; }
      const w = c2w(x, y);
      P.pick.at = [r1(w[0]), r1(w[1])];
      // a new spot ticks its dressing sets
      P.pick.sets = [];
      for (const o of P.level ? P.level.objects : []) {
        const s = suffix(o.markerset || '');
        if (o.parts && Math.hypot(o.pos[0] - w[0], o.pos[1] - w[1]) <= P.pick.r && /^D_/.test(s) && !P.pick.sets.includes(s)) P.pick.sets.push(s);
      }
      side(); draw();
    });
    c.addEventListener('mousemove', e => {
      if (!V.pan) return;
      const [x, y] = cpos(e);
      V.x = V.pan.vx - (x - V.pan.x) / V.s; V.y = V.pan.vy + (y - V.pan.y) / V.s;
      draw();
    });
    window.addEventListener('mouseup', () => { V.pan = null; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = cpos(e), w = c2w(x, y);
      V.s *= Math.exp(-e.deltaY * 0.0015);
      const w2 = c2w(x, y);
      V.x += w[0] - w2[0]; V.y += w[1] - w2[1];
      draw();
    }, { passive: false });
    d.querySelector('.r').addEventListener('change', e => { P.pick.r = Math.max(1, Math.min(80, +e.target.value || 12)); side(); draw(); });
    d.querySelector('.cancel').addEventListener('click', e => { e.preventDefault(); d.close(); });
    d.querySelector('.place').addEventListener('click', e => { e.preventDefault(); takeGroup(members()); d.close(); });
    P.dlg = { d, draw, side, fit() { const s = (P.level && P.level.size) || 600; V.x = 0; V.y = 0; V.s = 600 / (s * 1.05); } };
  }

  // takeGroup arms the Paste tool with the picked group (its members relative to at, for the ghost and the drawing
  // until the check places them)
  function takeGroup(ms) {
    const at = P.pick.at;
    const members = ms.map(o => {
      const part = o.parts[0], gs = (info(o.noun) || {}).graphicsScale || 1;
      return { noun: o.noun, rel: [o.pos[0] - at[0], o.pos[1] - at[1]], z: o.pos[2] || 0, rot: part.rot || [0, 0, 0], scale: (part.scale || 1) / gs };
    });
    P.paste = { level: P.levelName, sets: P.pick.sets.slice(), at: at.slice(), r: P.pick.r, members };
    setTool('paste');
    log(`paste: ${members.length} markers of ${P.levelName} at (${at[0]}, ${at[1]}), r ${P.pick.r}; click where the group goes`);
  }

  async function loadLevel() {
    if (P.level) return P.level;
    const res = await api('GET', '/api/level-scene/' + P.levelName + '?models=0');
    if (!res.ok) { log('paste: ' + (res.error || JSON.stringify(res.result)), 'err'); return null; }
    P.level = res.scene;
    return P.level;
  }

  async function openPaste() {
    if (!P.dlg) buildPaste();
    P.dlg.d.querySelector('.lvl').textContent = P.levelName;
    P.pick = P.pick || { at: null, r: 12, sets: [] };
    P.dlg.d.showModal();
    P.dlg.draw();
    if (!P.level) { await loadLevel(); P.dlg.fit(); }
    P.dlg.draw();
    P.dlg.side();
  }

  // ---- the 3-D view --------------------------------------------------------------------------------------

  async function requestModels(nouns) {
    nouns = [...new Set(nouns.map(key))].filter(k => !P.modelReq.has(k) && !P.models.has(k));
    if (!nouns.length) return;
    nouns.forEach(k => P.modelReq.add(k));
    const res = await api('POST', '/api/models', { nouns });
    nouns.forEach(k => P.modelReq.delete(k));
    if (!res.ok) { nouns.forEach(k => P.models.set(k, '')); log('3-D props: ' + res.error, 'err'); return; }
    for (const [k, url] of Object.entries(res.models)) P.models.set(k, url);
    V3D.redraw();
  }

  // the props' instances for the 3-D view: kept while shown() and the models known stay the same (EDUX3: a frame
  // during a drag remakes only what the drag changed: shown() is new, the matrices of unmoved markers are reused by
  // their place); item: the marker (the 3-D hit selects its entry). Then the Prop tool's ghost under the mouse and
  // its mirror, see-through (frame()'s ghost pass)
  const L3 = { items: null, models: -1, nouns: -1, mats: new Map(), list: [] };
  function layer3d({ list, modelFor, M }) {
    if (V3D.V.source !== 'map' || !S.doc || !S.show.props) return;
    const items = shown();
    if (L3.items !== items || L3.models !== P.models.size || L3.nouns !== P.nouns.length) {
      const need = [], mats = new Map(), out = [];
      for (const it of items) {
        const k = key(it.noun);
        if (!P.models.has(k)) { need.push(k); continue; }
        const url = P.models.get(k);
        if (!url) continue;
        const gs = (info(it.noun) || {}).graphicsScale || 1, s = it.scale * gs;
        // a shadow card lies at its template's height (0.1 m; mapc props reports the floor), here a little higher so the
        // generated ground's top doesn't hide it
        const z = it.card ? Math.max(it.pos[2], 0.1) + 0.25 : it.pos[2];
        const mk = url + '|' + it.pos[0] + ',' + it.pos[1] + ',' + z + '|' + it.rot.join(',') + '|' + s;
        const mat = L3.mats.get(mk) || M.mul(M.trs([it.pos[0], it.pos[1], z], it.rot, s), V3D.FROM_GLTF);
        mats.set(mk, mat);
        out.push({ url, mat, scale: s, key: 'prop|' + it.path + '|' + it.team + '|' + it.noun, at: [it.pos[0], it.pos[1], z], item: it });
      }
      Object.assign(L3, { items, models: P.models.size, nouns: P.nouns.length, mats, list: out });
      if (need.length) requestModels(need);
    }
    for (const e of L3.list) list.push({ model: modelFor(e.url), mat: e.mat, scale: e.scale, key: e.key, at: e.at, prop: true, item: e.item });
    const w = S.mouseW;
    if (S.tool === 'prop' && P.cur && w && ED.view === '3d') {
      const k = key(P.cur), url = P.models.get(k);
      if (!P.models.has(k)) requestModels([k]);
      if (url) {
        const gs = (info(P.cur) || {}).graphicsScale || 1, sc = P.nextScale, rot = nextTurn();
        const z = ghostZ(P.cur, sc);
        list.push({ model: modelFor(url), mat: M.mul(M.trs([w[0], w[1], z], [0, 0, rot], sc * gs), V3D.FROM_GLTF), scale: sc * gs, ghost: 0.55, key: 'ghost' });
        if (Math.hypot(w[0], w[1]) > 0.5) {
          list.push({ model: modelFor(url), mat: M.mul(M.trs([-w[0], -w[1], z], [0, 0, rot + 180], sc * gs), V3D.FROM_GLTF), scale: sc * gs, ghost: 0.3, key: 'ghost|2' });
        }
      }
    }
    // the Paste tool's group under the mouse: its members' models, see-through (EDUX4)
    if (S.tool === 'paste' && P.paste && w && ED.view === '3d') {
      const need = [];
      P.paste.members.forEach((m, i) => {
        const k = key(m.noun), url = P.models.get(k);
        if (!P.models.has(k)) { need.push(k); return; }
        if (!url) return;
        const gs = (info(m.noun) || {}).graphicsScale || 1;
        list.push({ model: modelFor(url), mat: M.mul(M.trs([w[0] + m.rel[0], w[1] + m.rel[1], m.z || 0], m.rot || [0, 0, 0], (m.scale || 1) * gs), V3D.FROM_GLTF),
          scale: (m.scale || 1) * gs, ghost: 0.55, key: 'paste|' + i });
      });
      if (need.length) requestModels([...new Set(need)]);
    }
  }
  // 3-D (EDUX4): what the 2-D drawUnder shows besides the icons (the models stand for those): every scatter's region but
  // the selected one (drawOver's) and the blocking doodads' footprints, with their mirrors, draped on the ground
  function drawUnder3d(v) {
    if (!v.drape || !S.doc || !S.show.props) return;
    const g = v.overlay;
    g.save();
    g.lineWidth = 1.2 * dpr;
    g.setLineDash([6 * dpr, 4 * dpr]);
    g.strokeStyle = 'rgba(150,220,140,0.8)';
    scatters().forEach((sc, k) => {
      if (S.sel && (S.sel.t === 'scatter' || S.sel.t === 'svertex') && S.sel.k === k) return;
      for (const m of S.show.mirror ? [true, false] : [false]) {
        g.globalAlpha = m ? 0.4 : 1;
        const pts = scatterPts(sc, m);
        if (pts) { vpoly(v, pts, true); g.stroke(); } else if (sc && isPt(sc.circle)) { vring(v, m ? mir(sc.circle) : sc.circle, +sc.r || 0); g.stroke(); }
      }
    });
    g.strokeStyle = '#e0a060';
    g.setLineDash([4 * dpr, 3 * dpr]);
    const ellipse = (f, mirror) => {
      const c = mirror ? mir(f.c) : f.c, a = ((mirror ? f.yaw + 180 : f.yaw) || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), pts = [];
      for (let k = 0; k < 24; k++) { const t = 2 * Math.PI * k / 24, u = f.a[0] * Math.cos(t), w = f.a[1] * Math.sin(t); pts.push([c[0] + u * co - w * si, c[1] + u * si + w * co]); }
      g.globalAlpha = mirror ? 0.5 : 1;
      vpoly(v, pts, true);
      g.stroke();
    };
    props().forEach(c => {
      const f = footprint(c);
      if (!f) return;
      ellipse(f, false);
      if (S.show.mirror && !isOnce(c) && Math.hypot(pos3(c.pos)[0], pos3(c.pos)[1]) > 0.5) ellipse(f, true);
    });
    g.restore();
  }

  // ---- wiring ------------------------------------------------------------------------------------------------

  buildPalette();
  // the menus' actions (frame.js): Advanced > Paste a Group, Split the Group, Scatter Settings; Tools > New Seed
  const selScatter = () => S.sel && S.sel.t === 'scatter' && scatters()[S.sel.k] ? S.sel.k : -1;
  ED.actions['props.paste'] = openPaste;
  ED.actions['props.split'] = () => {
    if (isPropSel(S.sel) && props()[S.sel.k] && props()[S.sel.k].group) return PS.split([S.sel.k], null);
    if (!S.sel || S.sel.t === 'prop' || !openAdvanced()) log('select a group (Doodads > Paste group) or several doodads with groups', 'err');
  };
  ED.actions['props.scatterSettings'] = () => { if (selScatter() < 0 || !openAdvanced()) log('select a scatter region first (Doodads > Brush: Scatter along the walls draws one)', 'err'); };
  ED.actions['props.newSeed'] = () => {
    const k = selScatter();
    if (k < 0) { log('select a scatter region first', 'err'); return; }
    edit(() => { scatters()[k].seed = 1 + Math.floor(Math.random() * 999999); });
  };
  ED.hitFirst.push(hitFirst);
  ED.hitItems.push(hitItems);
  ED.on('draw', phase => (phase === 'under' ? drawUnder : drawOver)());
  ED.marks.push(drawUnder3d, drawOver); // the 3-D view's overlay: the regions and footprints, the same rings and handles, draped
  ED.previews.push(drawEstimate, drawGhosts); // drawn through a view (app.js ED.drawPreviews)
  ED.on('open', () => { if (S.tool === 'paste' || S.tool === 'prop') setTool('select'); loadNouns(); });
  ED.on('doc', () => V3D.redraw());
  ED.on('checked', () => { V3D.redraw(); if (isPropSel(S.sel) || (S.sel && S.sel.t === 'scatter')) renderInspector(); });
  V3D.addLayer(layer3d);
  // ?scatter=k selects scatter[k] (for a picture of its region, its estimate and its info)
  const scatterQ = new URLSearchParams(location.search).get('scatter');
  ED.on('started', async () => {
    if (scatterQ === null || !scatters()[+scatterQ]) return;
    select({ t: 'scatter', k: +scatterQ });
    await until(() => layoutKinds() && (scatters()[+scatterQ].along !== 'area' || fillCells()), 20000);
    render();
  });
  // ?dmode=place|scatter|paste (the Doodads tab's mode) and ?picks=<noun>,<noun> (the palette's picks; with &smode=fill
  // the Scatter's Fill area) for a picture of the tab
  const dmodeQ = new URLSearchParams(location.search);
  ED.on('started', async () => {
    const m = dmodeQ.get('dmode'), pk = dmodeQ.get('picks');
    if (!m && !pk) return;
    if (pk) {
      await loadNouns();
      await until(() => P.state !== 'loading', 120000);
      const ns = pk.split(',').map(x => (P.nouns.find(n => key(n.name) === key(x)) || {}).name).filter(Boolean);
      P.multi = new Set(ns);
      P.cur = ns[0] || '';
    }
    if (dmodeQ.get('smode')) P.smode = dmodeQ.get('smode');
    if (m) setMode(m);
    renderPalette();
    renderBrush();
  });
  // ?paste=x,y opens the paste dialog with that spot of SM_Map_v5 picked (for a picture of it)
  const pasteQ = new URLSearchParams(location.search).get('paste'); // read at load: opening a map rewrites the URL
  ED.on('started', async () => {
    const q = pasteQ;
    if (!q) return;
    await openPaste();
    const [x, y] = q.split(',').map(Number);
    if (!isNaN(y) && P.level) {
      P.pick = { at: [x, y], r: 12, sets: [] };
      for (const o of P.level.objects) {
        const s = suffix(o.markerset || '');
        if (o.parts && Math.hypot(o.pos[0] - x, o.pos[1] - y) <= 12 && /^D_/.test(s) && !P.pick.sets.includes(s)) P.pick.sets.push(s);
      }
      P.dlg.side();
      P.dlg.draw();
    }
  });

  // ---- the self-test (?selftest=props, or props-save): the props tool through the functions the mouse uses ------

  const until = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await new Promise(r => setTimeout(r, 50));
    }
    return true;
  };
  const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
  // drag runs a mouse drag of a selection from a to b (world points) through app.js's moveSel
  function drag(sel, a, b, mirrored) {
    S.drag = { sel, mirrored: !!mirrored, start: a, moved: false };
    pushUndo();
    S.drag.moved = true;
    S.drag.orig = JSON.parse(JSON.stringify(selValue(sel)));
    moveSel(S.drag, b, null);
    S.drag = null;
    changed(true);
  }

  async function selftest(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || ''));
    let ok = true;
    ok &= say(S.report && S.report.ok, 'opened ' + S.pkg + ': ' + (S.report && S.report.ok ? 'passes' : rules().join(' ')));
    await loadNouns();
    ok &= say(await until(() => P.state !== 'loading', 120000) && P.state === 'ready' && P.nouns.length >= 300,
      `palette: ${P.nouns.length} nouns, ${P.nouns.filter(n => n.icon).length} with icons`);
    const tiles = P.grid.querySelectorAll('.tile').length;
    ok &= say(tiles > 200, `palette shows ${tiles} tiles`);
    P.search = 'pastoral large';
    renderPalette();
    const rockTile = [...P.grid.querySelectorAll('.tile')].find(t => key(t.dataset.noun) === 'rock_pastoral_large_01');
    ok &= say(!!rockTile && P.grid.querySelectorAll('.tile').length < 10, `search "pastoral large": ${P.grid.querySelectorAll('.tile').length} tiles, the rock among them`);
    if (rockTile) rockTile.click(); // picks it and arms the Prop tool
    ok &= say(S.tool === 'prop' && key(P.cur) === 'rock_pastoral_large_01', 'clicking the tile arms the Prop tool with ' + bare(P.cur));
    P.search = '';
    renderPalette();
    // place: a click of the Prop tool; one dropped on team 2's half
    ED.tools.prop.down([-130, -120], null);
    ok &= say(props().length === 1 && props()[0].noun === 'Rock_Pastoral_Large_01', 'placed: ' + JSON.stringify(props()[0]));
    placeNoun('lichenrock_02', [100, 60]);
    ok &= say(props().length === 2 && props()[1].pos[0] === -100 && props()[1].pos[1] === -60 && props()[1].rot === 180,
      'dropped on team 2\'s half: its source ' + JSON.stringify(props()[1]));
    setTool('select');
    await settle();
    const pl = (S.placed || []).filter(p => p.path === 'props[0]');
    ok &= say(S.report.ok && pl.length === 2 && pl.some(p => p.team === 2 && Math.abs(p.pos[0] - 130) < 0.01 && Math.abs(p.pos[1] - 120) < 0.01),
      `check ${S.report.ok ? 'passes' : rules().join(' ')}; mapc props placed props[0] on both teams: ${pl.map(p => p.team + '@' + p.pos.slice(0, 2)).join(' ')}`);
    // hits: the rock, its mirror (zoomed in, as one works on props)
    S.view = { x: 0, y: 0, scale: 3 * dpr };
    const sc = w2s([-130, -120]), sm = w2s([130, 120]);
    let hh = hit(sc[0], sc[1]);
    ok &= say(hh && hh.sel.t === 'prop' && hh.sel.k === 0 && !hh.mirrored, 'a click on the rock selects props[0]: ' + JSON.stringify(hh) +
      ` (canvas ${cv.width}x${cv.height}, ${S.view.scale.toFixed(2)} px a metre)`);
    hh = hit(sm[0], sm[1]);
    ok &= say(hh && hh.sel.t === 'prop' && hh.sel.k === 0 && hh.mirrored, 'a click on its mirror selects props[0], mirrored: ' + JSON.stringify(hh));
    // drag it, turn it and scale it by its handles
    drag({ t: 'prop', k: 0 }, [-130, -120], [-128, -125]);
    ok &= say(props()[0].pos[0] === -128 && props()[0].pos[1] === -125, 'dragged to ' + JSON.stringify(props()[0].pos));
    const live0 = live().find(it => it.k === 0 && it.team === 2);
    ok &= say(live0 && Math.abs(live0.pos[0] - 128) < 0.01 && Math.abs(live0.pos[1] - 125) < 0.01, 'its mirror follows at once: ' + (live0 && live0.pos.slice(0, 2)));
    select({ t: 'prop', k: 0 });
    let hd = handles(0), hs = w2s(hd.rot);
    hh = hit(hs[0], hs[1]);
    ok &= say(hh && hh.sel.t === 'protate', 'the turn handle is hit');
    const a = hd.anchor, R = hd.R;
    drag({ t: 'protate', k: 0 }, hd.rot, [a[0], a[1] + R]);
    ok &= say(Math.abs(props()[0].rot - 90) < 0.11, 'turned to ' + props()[0].rot);
    hd = handles(0);
    drag({ t: 'pscale', k: 0 }, hd.scale, [a[0] + 1.5 * (hd.scale[0] - a[0]), a[1] + 1.5 * (hd.scale[1] - a[1])]);
    ok &= say(Math.abs(props()[0].scale - 1.5) < 0.011, 'scaled to ' + props()[0].scale);
    // blocks: the footprint written from the box at the scale
    select({ t: 'prop', k: 0 });
    const box = info('Rock_Pastoral_Large_01').box;
    const cb = [...$('inspector').querySelectorAll('label')].find(l => /blocks/.test(l.textContent));
    if (cb) { const i = cb.querySelector('input'); i.checked = true; i.dispatchEvent(new Event('change')); }
    const sb = [...$('inspector').querySelectorAll('label')].find(l => /shadow card/.test(l.textContent));
    if (sb) { const i = sb.querySelector('input'); i.checked = true; i.dispatchEvent(new Event('change')); }
    ok &= say(props()[0].shadow === true, 'shadow ticked');
    const fp = props()[0].footprint;
    ok &= say(props()[0].blocks === true && Array.isArray(fp) && Math.abs(fp[0] - r1((box.max[0] - box.min[0]) * 1.5)) < 0.01,
      'blocks ticked: footprint ' + JSON.stringify(fp) + ' (the box ' + r1(box.max[0] - box.min[0]) + ' x ' + r1(box.max[1] - box.min[1]) + ' m times 1.5)');
    await settle();
    const fpl = (S.placed || []).find(p => p.path === 'props[0]' && p.team === 1);
    ok &= say(S.report.ok && fpl && fpl.footprint && Math.abs(fpl.footprint.axes[0] * 2 - fp[0]) < 0.01,
      'check ' + (S.report.ok ? 'passes' : rules().join(' ')) + '; mapc props: blocks ' + (fpl && JSON.stringify(fpl.footprint)));
    // a group pasted from SM_Map_v5 (CM_Dress's camp)
    await loadLevel();
    ok &= say(!!P.level && P.level.objects.length > 5000, `${P.levelName}: ${P.level ? P.level.objects.length : 0} markers read`);
    P.pick = { at: [-87.5, -52.6], r: 12, sets: ['D_Rocks', 'D_Trees', 'D_Foliage', 'D_IvyNFlowers', 'D_Objects'] };
    const sets = new Set(P.pick.sets);
    const ms = P.level.objects.filter(o => o.parts && o.parts.length && !o.hidden && sets.has(suffix(o.markerset || '')) &&
      Math.hypot(o.pos[0] - P.pick.at[0], o.pos[1] - P.pick.at[1]) <= P.pick.r);
    takeGroup(ms);
    ok &= say(S.tool === 'paste' && P.paste.members.length > 5, `the paste tool holds ${P.paste.members.length} markers`);
    ED.tools.paste.down([-140, -110], null);
    setTool('select');
    const gk = props().length - 1;
    const prov = live().filter(it => it.k === gk).length;
    await settle();
    const gpl = (S.placed || []).filter(p => p.path === 'props[' + gk + ']');
    ok &= say(S.report.ok && gpl.length > 5 && prov > 0, `group placed: ${prov} markers drawn at once, mapc props placed ${gpl.length} (both teams); check ${S.report.ok ? 'passes' : rules().join(' ')}`);
    // scatter along the wall west of lane 1
    P.multi = new Set(['lichenrock_01.Noun', 'lichenrock_02.Noun']);
    setTool('scatter');
    ED.tools.scatter.finish([[-215, -100], [-180, -100], [-180, -20], [-215, -20]]);
    ok &= say(scatters().length === 1 && scatters()[0].nouns.length === 2 && S.sel.t === 'scatter', 'scatter added: ' + JSON.stringify(scatters()[0]));
    await settle();
    const spl = (S.placed || []).filter(p => p.path === 'scatter[0]');
    ok &= say(S.report.ok && spl.length >= 6, `scatter placed ${spl.length} props (both teams); check ${S.report.ok ? 'passes' : rules().join(' ')}`);
    const seed0 = scatters()[0].seed;
    edit(() => { scatters()[0].seed = seed0 + 1; });
    await settle();
    const spl2 = (S.placed || []).filter(p => p.path === 'scatter[0]');
    ok &= say(JSON.stringify(spl2.map(p => p.pos)) !== JSON.stringify(spl.map(p => p.pos)), 'a new seed scatters them anew');
    P.multi = new Set();
    // a gameplay noun is refused (mapc props' placing finding reaches the check)
    edit(d => d.props.push({ noun: 'itemshoppe_archon', pos: [-150, -170], rot: 0, scale: 1 }));
    await settle();
    ok &= say(!S.report.ok && rules().some(r => /^(props\.type|nouns\.exist)@props\[3\]/.test(r)), 'a creature as a prop fails: ' + rules().join(' '));
    undo();
    await settle();
    ok &= say(S.report.ok && props().length === 3, 'undo: passes again with ' + props().length + ' props');
    render();
    // the 3-D view: the props drawn from their models; the archons on the floor
    ED.setView('3d');
    const V = V3D.V;
    const ready = () => {
      if (!V.gl || !V.scene) return false;
      const l = [];
      layer3d({ list: l, modelFor: V3D.modelFor, M: V3D.M });
      return !V.pending && !P.modelReq.size && l.length > 0 && l.every(i => i.model.ready || i.model.failed);
    };
    ok &= say(!!V.gl && await until(ready, 180000), `3-D: the props' models loaded (${[...P.models.values()].filter(Boolean).length} nouns)`);
    if (V.gl) {
      const l = [];
      layer3d({ list: l, modelFor: V3D.modelFor, M: V3D.M });
      const rock = l.find(i => /props\[0\]\|1\|/.test(i.key));
      ok &= say(l.length >= gpl.length && rock && Math.abs(rock.at[0] + 128) < 0.01, `3-D: ${l.length} prop instances, the rock at (${rock && rock.at.slice(0, 2)})`);
      const cards = l.filter(i => /blobshadow/i.test(i.key));
      ok &= say(cards.length === 2 && cards.every(i => i.model.ready && i.model.draws.length), `3-D: ${cards.length} shadow cards (` +
        cards.map(i => i.model.draws.map(d => d.mat.draw + (d.mat.tex && d.mat.tex.ok ? '+tex' : '-tex')).join('/') + ' at z ' + i.at[2].toFixed(2)).join(', ') + ')');
      const scene = V.scene.objects.filter(o => /_props$/i.test(o.markerset || '')).length;
      say(true, `3-D: the last export's ${scene} props markers are left to the layer`);
      const archons = [];
      for (const o of V.scene.objects) for (const p of o.parts || []) if (/itemshoppe_archon/i.test(p.noun)) archons.push(p.offset[2]);
      ok &= say(archons.length === 4 && archons.every(z => z === 0), 'the shop archons stand on the floor: z ' + archons.join(', '));
      V.dirty = false;
      V3D.setTarget(-128, -125);
      await new Promise(r => setTimeout(r, 400));
      ok &= say(V.gl.getError() === 0 && V.stats.draws > 10, `3-D frame: ${V.stats.draws} draws, ${V.stats.parts} parts, no GL error`);
    }
    if (mode === 'props-save') {
      const r = await save();
      ok &= say(r && r.written, 'saved: ' + (r && r.sha256));
    }
    say(ok, ok ? 'selftest props passed' : 'selftest props failed');
    document.title = ok ? 'selftest props passed' : 'selftest props failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.props = selftest;
  ED.selftests['props-save'] = selftest;

  // ---- EDUX10's self-test (?selftest=fill, CM_Ring): Fill area in 2-D: the mode switch, the estimate while drawing
  // equal to what the check places (count and places), the blocking rocks, Where and Block in the region's info, a
  // fill that places nothing and why, density, back to along the walls; all undone
  ED.selftests.fill = async function selftestFill() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || ''));
    let ok = true;
    ok &= say(S.report && S.report.ok, 'opened ' + S.pkg);
    const r7 = splitmix(7), hx = [r7.hex(), r7.hex(), r7.hex()].join(' ');
    ok &= say(hx === '63cbe1e459320dd7 044c3cd7f43c661c e6984080bab12a02', 'SplitMix64 as mapc\'s (seed 7): ' + hx);
    const h8 = splitmix(2 ** 40 + 5).hex(), r8 = splitmix(2 ** 40 + 5), m8 = r8.mod(1000003), f8 = r8.float();
    ok &= say(h8 === '486e851c593533ba' && m8 >= 0 && m8 < 1000003 && f8 >= 0 && f8 < 1, `a seed over 32 bits: ${h8}, mod ${m8}, float ${f8}`);
    await settle();
    ok &= say(await until(() => layoutKinds() && fillCells(), 20000), 'the check\'s layout.png and fill.png read');
    const doc0 = JSON.stringify(S.doc);
    const msg = () => { const m = $('tab_doodads').querySelector('[data-scatter-msg]'); return m ? m.textContent : ''; };
    const placedK = k => (S.placed || []).filter(q => q.path === 'scatter[' + k + ']' && q.team === 1 && !q.card);
    const samePts = (est, pl) => est && est.pts.length === pl.length && pl.every((q, i) => q.pos[0] === est.pts[i][0] && q.pos[1] === est.pts[i][1]);
    const cur = () => scatters()[scatters().length - 1];
    // the Brush: Scatter's mode switch, Fill area's Where and Block
    P.multi = new Set(['grassblades01_forest', 'rock_forest_small_02']);
    P.cur = '';
    $('tab_doodads').querySelector('[data-dtool="scatter"]').click();
    const fillBtn = () => $('tab_doodads').querySelector('[data-smode="fill"]');
    ok &= say(S.tool === 'scatter' && fillBtn() && !fillBtn().disabled, 'the Scatter tool armed; Fill area enabled');
    fillBtn().click();
    ok &= say(P.smode === 'fill' && fillBtn().classList.contains('on') && $('tab_doodads').querySelector('[data-fill="on"]') &&
      /Fill area/.test($('toolHint').textContent), 'Fill area chosen: Where and Block shown, the hint says so');
    const blk = $('tab_doodads').querySelector('[data-fill="blocks"]');
    blk.checked = true;
    blk.dispatchEvent(new Event('change'));
    ok &= say(P.fillBlocks === true, 'Block ticked');
    // a region over the base's open ground and its walls: the estimate while drawing, then the check's
    const R = [[-135, -135], [-80, -135], [-80, -40], [-135, -40]];
    for (const q of R.slice(0, 3)) ED.tools.scatter.down(q, null);
    S.drawing.mouse = R[3];
    const seed = P.nextSeed, est1 = scatterEstimate(R, drawingSc());
    render();
    ok &= say(est1 && est1.fill && est1.n > 20 && est1.cells.length > est1.n && new RegExp(`Fill area: .* ${est1.n} placed`).test($('st2').textContent),
      `while drawing: ${est1 && est1.cells.length} cells, ${est1 && est1.n} places; ${$('st2').textContent}`);
    ED.tools.scatter.down(R[3], null);
    drawFinish();
    const k1 = scatters().length - 1, sc1 = cur();
    ok &= say(sc1.along === 'area' && sc1.blocks === true && !sc1.on && sc1.seed === seed && sc1.nouns.length === 2, 'the region written: ' + JSON.stringify(sc1));
    await settle();
    const pl1 = placedK(k1), blocks1 = pl1.filter(q => q.blocks), decor1 = pl1.filter(q => isDecor(q.noun));
    ok &= say(S.report.ok && pl1.length === est1.n && samePts(est1, pl1),
      `the check placed ${pl1.length} on team 1's half at the estimate's places (the page counted ${est1.n}); ${S.report.ok ? 'passes' : rules().join(' ')}`);
    ok &= say(blocks1.length > 0 && blocks1.every(q => !isDecor(q.noun) && q.footprint) && decor1.every(q => !q.blocks) && decor1.length > 0,
      `${blocks1.length} rocks block (footprints), ${decor1.length} plants don't`);
    const fresh = () => layoutKinds() && fillCells() && LY.rev === S.rev && FL.rev === S.rev; // this check's pictures read
    ok &= say(await until(fresh, 20000) && FL.cells.some(v => v === 2) && LY.kinds.some(v => v === 5),
      `fill.png marks the blocking footprints (${FL.cells.filter(v => v === 2).length} cells; layout.png's prop colour there)`);
    const est1b = scatterEstimate(R, sc1);
    ok &= say(est1b && est1b.n === pl1.length && samePts(est1b, pl1), `the selected region re-estimated after the check: ${est1b && est1b.n} (its own footprints read as walkable)`);
    const insp = $('inspector');
    ok &= say(S.sel && S.sel.t === 'scatter' && S.sel.k === k1 && +insp.querySelector('[data-estimate]').dataset.estimate === pl1.length &&
      /filling the region/.test(insp.textContent) && insp.querySelector('[data-fill-sel="on"]') && insp.querySelector('[data-smode-sel="fill"]').classList.contains('on'),
      'the region\'s info: the mode, Where, Block, the count: ' + insp.querySelector('[data-estimate]').textContent);
    // Where: on walls (the info's select): every place on a wall cell, the estimate still the check's
    const sel = insp.querySelector('[data-fill-sel="on"]');
    sel.value = 'walls';
    sel.dispatchEvent(new Event('change'));
    await settle();
    await until(fresh, 20000);
    const ly = layoutKinds(), n = ly.grid, cs = ly.size / n, kindAt = q => ly.kinds[Math.floor(q[1] / cs + n / 2 + 0.5) * n + Math.floor(q[0] / cs + n / 2 + 0.5)];
    const pl2 = placedK(k1), est2 = scatterEstimate(R, cur());
    ok &= say(cur().on === 'walls' && pl2.length > 0 && est2.n === pl2.length && samePts(est2, pl2) && pl2.every(q => kindAt(q.pos) === 2) &&
      pl2.some(q => q.pos[2] > 3), `on walls: ${pl2.length} placed, all on wall cells, the estimate ${est2.n}; heights up to ${Math.max(...pl2.map(q => q.pos[2])).toFixed(1)} m (the plateau)`);
    // density 0.5
    edit(() => { cur().density = 0.5; });
    await settle();
    await until(fresh, 20000);
    const pl3 = placedK(k1), est3 = scatterEstimate(R, cur());
    ok &= say(pl3.length > 0 && pl3.length < pl2.length && est3.n === pl3.length && samePts(est3, pl3), `density 0.5: ${pl3.length} placed (of ${pl2.length}), the estimate ${est3.n}`);
    // rocks on walkable ground without Block: nothing, and why
    edit(() => { const s = cur(); s.on = 'ground'; delete s.blocks; delete s.density; s.nouns = ['rock_forest_small_02']; });
    await settle();
    await until(fresh, 20000);
    const est4 = scatterEstimate(R, cur());
    ok &= say(placedK(k1).length === 0 && est4.n === 0 && est4.why === 'nouns' && /only with Block/.test($('inspector').textContent) &&
      rules().some(r => r.startsWith('scatter.decor@')) && rules().some(r => r.startsWith('scatter.empty@')),
      `rocks on walkable ground without Block: none placed, said in the info and by the check (${rules().filter(r => r.startsWith('scatter.')).join(' ')})`);
    // a new region with nothing free to fill (inside lane 1's corridor: the lanes keep clear)
    setTool('scatter');
    setSmode({ fillOn: 'ground', fillBlocks: false });
    for (const q of [[-173, -123], [-167, -123], [-170, -117]]) ED.tools.scatter.down(q, null);
    drawFinish();
    await settle();
    ok &= say(placedK(scatters().length - 1).length === 0 && msg() === NO_FILL.cells && $('inspector').textContent.includes('Nothing to fill here'),
      'a region in a lane: kept, nothing placed, said at the tool and in its info: ' + msg());
    // back to along the walls (the info's switch): the fill's members dropped
    select({ t: 'scatter', k: k1 });
    $('inspector').querySelector('[data-smode-sel="walls"]').click();
    ok &= say(!cur() || (scatters()[k1].along === undefined && scatters()[k1].on === undefined && scatters()[k1].blocks === undefined), 'Along the walls again: ' + JSON.stringify(scatters()[k1]));
    setSmode({ smode: 'walls', fillOn: 'any', fillBlocks: false });
    setTool('select');
    for (let i = 0; i < 20 && JSON.stringify(S.doc) !== doc0; i++) undo();
    ok &= say(JSON.stringify(S.doc) === doc0, 'all undone');
    say(ok, ok ? 'selftest fill passed' : 'selftest fill failed');
    document.title = ok ? 'selftest fill passed' : 'selftest fill failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  };

  return { P, paletteNouns, setMode, live, shown, placeNoun, dropOnto, setNext, nextTurn, scatterEstimate, addScatter, NO_EDGE, NO_FILL, fillEstimate, splitmix, isDecor, setSmode, placeGroup, addScatter, loadNouns, loadLevel, takeGroup, footprint, boxFootprint,
    // for propsel.js (the multiple selection, copy and paste, split)
    key, bare, info, radius, entryRadius, handles, pos3, setPos, flushZ, flushLift, normDeg, rot2, scaleOf, r2, isPropSel, isOnce, groupPoly, groupOutline, layer3d, drag, until, settle };
})();

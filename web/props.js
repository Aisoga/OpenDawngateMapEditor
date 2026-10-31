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
  function propMap(base, cur) {
    const out = new Array(base.length).fill(-1);
    if (base.length === cur.length) return out.map((_, i) => i);
    const bj = base.map(x => JSON.stringify(x)), cj = cur.map(x => JSON.stringify(x));
    for (let i = 0, j = 0; i < base.length && j < cur.length;) {
      if (bj[i] === cj[j]) { out[i] = j; i++; j++; } else if (base.length > cur.length) i++; else j++;
    }
    return out;
  }

  // moved is a placed marker of entry b carried along to entry c (moved, turned, scaled about the entry's point)
  function moved(p, b, c, k) {
    const it = Object.assign({}, p, { path: 'props[' + k + ']', kind: 'prop', k });
    if (!b || !c || JSON.stringify(b) === JSON.stringify(c)) return it;
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

  // live is every marker the props place now: the last check's, carried along with their entries' edits since
  function live() {
    if (!S.doc) return [];
    const cur = props(), curS = scatters(), from = S.placedFrom || { props: [], scatter: [] };
    const map = propMap(from.props, cur), smap = propMap(from.scatter, curS);
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
      if (k >= 0) out.push(moved(p, from.props[j], cur[k], k));
    }
    cur.forEach((c, k) => { if (!mapped.has(k)) provisional(c, k, out); });
    return out;
  }

  // ---- the 2-D layer ---------------------------------------------------------------------------------------

  function drawItem(it, alpha) {
    const inf = info(it.noun), s = w2s(it.pos), k = S.view.scale * it.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s[0], s[1]);
    ctx.rotate(-(it.rot[2] || 0) * Math.PI / 180);
    const img = iconImg(inf);
    if (img) {
      const ic = inf.icon, sz = ic.size * ic.metresPerPixel * k;
      if (sz >= 2) ctx.drawImage(img, ic.centre[0] * k - sz / 2, -ic.centre[1] * k - sz / 2, sz, sz);
      else { ctx.fillStyle = '#b9a37a'; ctx.fillRect(-1, -1, 2, 2); }
    } else {
      const r = Math.max(1.5 * dpr, radius(it.noun, it.scale) * S.view.scale);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(190,160,110,0.35)';
      ctx.fill();
      ctx.strokeStyle = '#c9a66b';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r, 0); ctx.stroke(); // its facing
    }
    ctx.restore();
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
    const items = live().filter(it => !it.card);
    if (S.show.mirror) for (const it of items) if (it.team === 2) drawItem(it, 0.45);
    for (const it of items) if (it.team !== 2) drawItem(it, 1);
    props().forEach(c => {
      const f = footprint(c);
      if (!f) return;
      drawEllipse(f, false, '#e0a060');
      if (S.show.mirror && !isOnce(c) && Math.hypot(pos3(c.pos)[0], pos3(c.pos)[1]) > 0.5) drawEllipse(f, true, '#e0a060');
    });
  }

  // the handles of a selected prop (team 1's side): turn (round, on its facing) and scale (square, a quarter back)
  function handles(k) {
    const c = props()[k];
    if (!c || typeof c !== 'object') return null;
    const p = pos3(c.pos), a = (+c.rot || 0) * Math.PI / 180;
    const R = Math.max(entryRadius(c), 18 * dpr / S.view.scale);
    return { anchor: p, R, rot: [p[0] + R * Math.cos(a), p[1] + R * Math.sin(a)], scale: [p[0] + R * Math.cos(a - Math.PI / 2), p[1] + R * Math.sin(a - Math.PI / 2)] };
  }
  const isPropSel = s => s && (s.t === 'prop' || s.t === 'protate' || s.t === 'pscale');

  function drawOver() {
    if (!S.doc) return;
    const sel = S.sel;
    if (S.show.props && isPropSel(sel) && props()[sel.k]) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      for (const it of live()) {
        if (it.kind !== 'prop' || it.k !== sel.k || it.card) continue;
        const s = w2s(it.pos);
        ctx.globalAlpha = it.team === 2 ? 0.5 : 1;
        ctx.beginPath();
        ctx.arc(s[0], s[1], Math.max(4 * dpr, radius(it.noun, it.scale) * S.view.scale) + 2 * dpr, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const c = props()[sel.k], hd = handles(sel.k);
      if (c.group) { // the group's circle, or its polygon where it lands
        const s = w2s(hd.anchor), out = groupOutline(c);
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        if (out) out.forEach((q, i) => { const v = w2s(q); if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); });
        else ctx.arc(s[0], s[1], entryRadius(c) * S.view.scale, 0, 2 * Math.PI);
        if (out) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const a = w2s(hd.anchor), ro = w2s(hd.rot), sc = w2s(hd.scale);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(ro[0], ro[1]); ctx.stroke();
      ctx.fillStyle = sel.t === 'protate' ? '#58a6ff' : '#fff';
      ctx.beginPath(); ctx.arc(ro[0], ro[1], 5 * dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = sel.t === 'pscale' ? '#58a6ff' : '#fff';
      ctx.fillRect(sc[0] - 4.5 * dpr, sc[1] - 4.5 * dpr, 9 * dpr, 9 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillRect(a[0] - 2 * dpr, a[1] - 2 * dpr, 4 * dpr, 4 * dpr);
      ctx.restore();
    }
    if (sel && (sel.t === 'scatter' || sel.t === 'svertex')) {
      const pts = scatterPts(scatters()[sel.k], false) || [];
      ctx.save();
      pts.forEach((p, v) => {
        const s = w2s(p);
        ctx.fillStyle = sel.t === 'svertex' && sel.v === v ? '#58a6ff' : '#fff';
        ctx.fillRect(s[0] - 4 * dpr, s[1] - 4 * dpr, 8 * dpr, 8 * dpr);
      });
      ctx.restore();
    }
    // the ghosts of the placing tools
    if (S.mouseW && S.tool === 'prop' && P.cur) {
      drawItem({ noun: P.cur, pos: [S.mouseW[0], S.mouseW[1], 0], rot: [0, 0, 0], scale: 1 }, 0.55);
    }
    if (S.mouseW && S.tool === 'paste' && P.paste) {
      for (const m of P.paste.members) drawItem({ noun: m.noun, pos: [S.mouseW[0] + m.rel[0], S.mouseW[1] + m.rel[1], 0], rot: m.rot, scale: m.scale }, 0.55);
      const s = w2s(S.mouseW);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.arc(s[0], s[1], P.paste.r * S.view.scale, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- hits, drags, deletes ------------------------------------------------------------------------------

  function hitFirst(sx, sy, w, near) {
    if (!S.show.props || !S.sel) return null;
    if (isPropSel(S.sel)) {
      const hd = handles(S.sel.k);
      if (hd && near(hd.rot, 8)) return { sel: { t: 'protate', k: S.sel.k } };
      if (hd && near(hd.scale, 8)) return { sel: { t: 'pscale', k: S.sel.k } };
    }
    if (S.sel.t === 'scatter' || S.sel.t === 'svertex') {
      const pts = scatterPts(scatters()[S.sel.k], false) || [];
      for (let v = 0; v < pts.length; v++) if (near(pts[v], 7)) return { sel: { t: 'svertex', k: S.sel.k, v } };
    }
    return null;
  }

  function hitItems(sx, sy, w) {
    if (!S.show.props || !S.doc) return null;
    let best = null, bd = Infinity;
    const minR = 6 * dpr / S.view.scale;
    for (const it of live()) {
      if (it.card || (it.team === 2 && !S.show.mirror)) continue;
      const r = Math.max(radius(it.noun, it.scale), minR), d = Math.hypot(w[0] - it.pos[0], w[1] - it.pos[1]);
      if (d <= r && d / r < bd) { bd = d / r; best = it; }
    }
    if (best) return { sel: best.kind === 'scatter' ? { t: 'scatter', k: best.k } : { t: 'prop', k: best.k }, mirrored: best.team === 2 };
    // a group's anchor, a scatter's outline
    const tol = 7 * dpr / S.view.scale;
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
  function placeNoun(noun, w, rot) {
    if (!S.doc || !noun) return;
    let p = [r1(w[0]), r1(w[1])];
    rot = rot !== undefined ? rot : P.randomTurn ? Math.round(Math.random() * 3600) / 10 - 180 : 0;
    if (p[0] + p[1] > 0) { p = mir(p); rot = normDeg(rot + 180); }
    const entry = { noun: bare(noun), pos: p, rot, scale: 1 };
    const lift = flushLift(entry);
    if (lift !== null) log(`${bare(noun)}: its top lies on the floor, so it stands ${lift} m up (props.flush; it would show torn at z 0)`);
    if (P.newBlocks) {
      entry.blocks = true;
      const f = boxFootprint(noun, 1);
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
    if (!nouns.length) { log('scatter: pick its props in the palette first (Ctrl+click for several)', 'err'); return; }
    if (pts.length < 3) { log('scatter: a region needs at least 3 corners', 'err'); return; }
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (cx + cy > 0) pts = pts.map(mir); // drawn on team 2's half: team 1's source
    const sc = { nouns: nouns.map(bare), seed: 1 + Math.floor(Math.random() * 999999), polygon: pts };
    edit(d => { d.scatter = Array.isArray(d.scatter) ? d.scatter : []; d.scatter.push(sc); });
    select({ t: 'scatter', k: scatters().length - 1 });
  }
  const paletteNouns = () => P.multi.size ? [...P.multi] : P.cur ? [P.cur] : [];

  ED.tools.prop = {
    hover: true,
    hint: 'Prop: each click places the palette\'s prop (or drag one from the palette); on team 2\'s half it places the mirror\'s source. Esc ends.',
    down(w, e) {
      if (!P.cur) { log('pick a prop in the palette first', 'err'); return; }
      placeNoun(P.cur, snapW(w, e));
    },
  };
  ED.tools.paste = {
    hover: true,
    hint: 'Paste: click where the group\'s centre goes. Esc ends.',
    down(w, e) { if (P.paste) placeGroup(P.paste, snapW(w, e)); },
  };
  ED.tools.scatter = {
    hint: 'Scatter: click the corners of the region (double-click or Enter ends); the palette\'s selected props are spread along the walls inside it.',
    down(w, e) { drawDown(w, e, 'polygon'); },
    finish(pts) { addScatter(pts, paletteNouns()); setTool('select'); },
  };

  ED.keys = e => {
    if (e.key === 'p' && !e.ctrlKey && !e.metaKey) { setTool('prop'); return true; }
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
        h('label', {}, 'sets ', h('input', { value: (g.sets || []).join(', '), onchange: ev => edit(() => { g.sets = ev.target.value.split(/[ ,]+/).filter(Boolean); }) })),
        h('div', { class: 'small' }, groupPoly(g) ? `taken from ${g.level} inside a polygon of ${g.polygon.length} corners (its coordinates; drawn dashed where it lands); at lands on pos:` : `taken from ${g.level} within r of at:`),
        xyInputs(() => g.at, q => { g.at = q; }),
        groupPoly(g) ? h('span') : numIn('r (m)', () => g.r, v => { g.r = v; }, '1'),
        h('p', { class: 'small' }, 'Drag it, or turn and scale it by its handles (R / Shift+R turn 15 degrees, [ and ] scale). A group neither blocks nor gets a shadow: draw a wall shape where it should block.'),
        Array.isArray(g.holes) && g.holes.length ? h('div', { class: 'small' }, `${g.holes.length} hole${g.holes.length > 1 ? 's' : ''}: the members taken out as single props`) : null,
        h('div', { class: 'btns' }, h('button', { title: 'Turn every member into a single prop (its noun, place, height, turn, scale and tilt); to take only some, drag a box over them and split the box', onclick: () => PS.split([k], null) }, 'Split into props')));
    } else {
      const inf = info(c.noun), n = placedOf('prop', k);
      el.append(h('label', {}, 'noun ', h('input', { list: 'propNouns', value: c.noun || '', onchange: ev => edit(() => { c.noun = bare(ev.target.value); }) })),
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
        Array.isArray(c.tilt) ? h('div', { class: 'xy', title: 'The lean about x and y (degrees) a member taken out of a group keeps' }, 'tilt x',
          h('input', { type: 'number', step: '1', value: c.tilt[0], onchange: ev => edit(() => { c.tilt = [+ev.target.value || 0, c.tilt[1]]; if (!c.tilt[0] && !c.tilt[1]) delete c.tilt; }) }),
          'y', h('input', { type: 'number', step: '1', value: c.tilt[1], onchange: ev => edit(() => { c.tilt = [c.tilt[0], +ev.target.value || 0]; if (!c.tilt[0] && !c.tilt[1]) delete c.tilt; }) })) : null,
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
        el.append(h('div', { class: 'xy' }, 'footprint w', h('input', { type: 'number', step: '0.1', value: f ? f[0] : '', onchange: ev => edit(() => { c.footprint = [+ev.target.value, f ? f[1] : +ev.target.value]; }) }),
          'd', h('input', { type: 'number', step: '0.1', value: f ? f[1] : '', onchange: ev => edit(() => { c.footprint = [f ? f[0] : +ev.target.value, +ev.target.value]; }) })),
        h('div', { class: 'btns' }, h('button', { onclick: () => edit(() => { const g = boxFootprint(c.noun, scaleOf(c.scale)); if (g) c.footprint = g; }) }, 'From the model\'s box')),
        h('p', { class: 'small' }, 'The ellipse (w along the prop\'s turned x, d along its y) centred on the prop blocks units and sight. For a tree give the trunk\'s.'));
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
    el.append(h('div', { class: 'path' }, `scatter[${k}]`),
      h('div', {}, `${n} props on team 1's half (and their mirrors), along the walls inside the region`),
      h('div', { class: 'chips' }, ...nouns.map((x, i) => h('span', { class: 'chip' }, x, h('button', { title: 'Remove', onclick: () => edit(() => nouns.splice(i, 1)) }, 'x')))),
      h('div', { class: 'btns' }, h('button', { disabled: !paletteNouns().length, onclick: () => edit(() => {
        sc.nouns = nouns.concat(paletteNouns().map(bare).filter(x => !nouns.some(y => key(y) === key(x))));
      }) }, `Add the palette's selection (${paletteNouns().length})`)),
      h('div', { class: 'xy' }, numIn('seed', () => sc.seed, v => { sc.seed = Math.max(0, Math.round(v)); }, '1'),
        h('button', { onclick: () => edit(() => { sc.seed = 1 + Math.floor(Math.random() * 999999); }) }, 'New seed')),
      numIn('spacing (m, default 6)', () => sc.spacing || '', v => { if (v) sc.spacing = v; else delete sc.spacing; }, '0.5'),
      numIn('inset into the wall (m, default 1)', () => sc.inset || '', v => { if (v) sc.inset = v; else delete sc.inset; }, '0.5'),
      numIn('at most (team 1, default 200)', () => sc.max || '', v => { if (v) sc.max = Math.round(v); else delete sc.max; }, '1'),
      h('div', { class: 'xy' }, 'scale', h('input', { type: 'number', step: '0.05', value: (sc.scale || [0.8, 1.2])[0], onchange: ev => edit(() => { sc.scale = [+ev.target.value, (sc.scale || [0.8, 1.2])[1]]; }) }),
        'to', h('input', { type: 'number', step: '0.05', value: (sc.scale || [0.8, 1.2])[1], onchange: ev => edit(() => { sc.scale = [(sc.scale || [0.8, 1.2])[0], +ev.target.value]; }) })),
      chkIn('shadow cards', () => sc.shadow, on => { if (on) sc.shadow = true; else delete sc.shadow; }),
      h('p', { class: 'small' }, 'Drag the region\'s outline to move it, its corners to reshape it (Del deletes a corner).'),
      h('div', { class: 'btns' }, h('button', { onclick: () => { edit(d => d.scatter.splice(k, 1)); select(null); } }, 'Delete')),
      jsonEditor(sc, v => { S.doc.scatter[k] = v; }));
  }

  // ---- the palette ---------------------------------------------------------------------------------------

  function showStatus(t) { if (P.status) P.status.textContent = t; }

  function buildPalette() {
    const body = ED.addPane('left', 'Props');
    body.classList.add('palette');
    const layers = $('paneLayers');
    if (layers) layers.before(body.parentElement); // under the tools
    const search = h('input', { type: 'search', placeholder: 'search props', oninput: ev => { P.search = ev.target.value; renderPalette(); } });
    const type = h('select', { onchange: ev => { P.type = ev.target.value; renderPalette(); } },
      ...[['', 'all'], ['obstacle', 'obstacles'], ['terrain', 'terrain'], ['Placeable Effect', 'effects'], ['other', 'other']].map(([v, t]) => h('option', { value: v }, t)));
    const opt = (label, k, title) => h('label', { title }, h('input', { type: 'checkbox', checked: P[k], onchange: ev => { P[k] = ev.target.checked; renderPalette(); } }), ' ' + label);
    P.grid = h('div', { class: 'grid' });
    P.status = h('div', { class: 'small' }, 'open a map');
    body.append(h('div', { class: 'bar' }, search, type),
      h('div', { class: 'opts small' }, opt('with a model', 'modelOnly', 'Hide the nouns whose model the copy lacks (they draw nothing)'),
        opt('random turn', 'randomTurn', 'Each placed prop gets a random turn'),
        opt('blocks', 'newBlocks', 'New props block walking and sight (their footprint from the box)'),
        opt('shadow', 'newShadow', 'New props get a shadow card')),
      P.grid, P.status,
      h('div', { class: 'btns' }, h('button', { title: 'Take a dressed group from SM_Map_v5', onclick: openPaste }, 'Paste from SM_Map_v5...'),
        h('button', { title: 'Draw a region; the selected props are spread along its walls', onclick: () => setTool('scatter') }, 'Scatter...')),
      h('p', { class: 'hint' }, 'Click a prop, then click the map (or drag it onto the map). Ctrl+click selects several for a scatter.'));
  }

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
        class: 'tile' + (key(n.name) === key(P.cur) ? ' cur' : '') + (P.multi.has(n.name) ? ' multi' : '') + (n.icon ? '' : ' nomodel'),
        title: `${bare(n.name)}\n${n.type}, ${size}`, draggable: 'true', 'data-noun': n.name,
        onclick: ev => {
          if (ev.ctrlKey || ev.shiftKey || ev.metaKey) { if (P.multi.has(n.name)) P.multi.delete(n.name); else P.multi.add(n.name); } else { P.cur = n.name; setTool('prop'); }
          renderPalette();
          renderInspector();
        },
        ondragstart: ev => { ev.dataTransfer.setData('text/x-dg-noun', n.name); ev.dataTransfer.setData('text/plain', bare(n.name)); P.cur = n.name; },
      }, n.icon ? h('img', { src: n.icon.url, loading: 'lazy', alt: '' }) : h('div', { class: 'noimg' }, n.type), h('div', { class: 'nm' }, bare(n.name)));
      P.grid.append(tile);
    }
    showStatus(`${shown} of ${P.nouns.length} props` + (P.multi.size ? `; ${P.multi.size} selected for a scatter` : '') + (P.cur ? `; placing ${bare(P.cur)}` : ''));
  }

  // dropping a palette tile onto the canvas places it
  cv.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-dg-noun')) e.preventDefault(); });
  cv.addEventListener('drop', e => {
    const n = e.dataTransfer.getData('text/x-dg-noun');
    if (!n || !S.doc) return;
    e.preventDefault();
    const [sx, sy] = evPos(e);
    placeNoun(n, snapW(s2w(sx, sy), e));
  });

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

  function layer3d({ list, modelFor, M }) {
    if (V3D.V.source !== 'map' || !S.doc || !S.show.props) return;
    const need = [];
    for (const it of live()) {
      const k = key(it.noun);
      if (!P.models.has(k)) { need.push(k); continue; }
      const url = P.models.get(k);
      if (!url) continue;
      const gs = (info(it.noun) || {}).graphicsScale || 1, s = it.scale * gs;
      // a shadow card lies at its template's height (0.1 m; mapc props reports the floor), here a little higher so the
      // generated ground's top doesn't hide it
      const z = it.card ? Math.max(it.pos[2], 0.1) + 0.25 : it.pos[2];
      list.push({ model: modelFor(url), mat: M.mul(M.trs([it.pos[0], it.pos[1], z], it.rot, s), V3D.FROM_GLTF), scale: s,
        key: 'prop|' + it.path + '|' + it.team + '|' + it.noun, at: [it.pos[0], it.pos[1], z], prop: true });
    }
    if (need.length) requestModels(need);
  }

  // ---- wiring ------------------------------------------------------------------------------------------------

  buildPalette();
  ED.hitFirst.push(hitFirst);
  ED.hitItems.push(hitItems);
  ED.on('draw', phase => (phase === 'under' ? drawUnder : drawOver)());
  ED.on('open', () => { if (S.tool === 'paste' || S.tool === 'prop') setTool('select'); loadNouns(); });
  ED.on('doc', () => V3D.redraw());
  ED.on('checked', () => { V3D.redraw(); if (isPropSel(S.sel) || (S.sel && S.sel.t === 'scatter')) renderInspector(); });
  V3D.addLayer(layer3d);
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
    const tab = [...document.querySelectorAll('#viewTabs button')].find(x => x.textContent === '3-D');
    if (tab) tab.click();
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

  return { P, live, placeNoun, placeGroup, addScatter, loadNouns, loadLevel, takeGroup, footprint, boxFootprint,
    // for propsel.js (the multiple selection, copy and paste, split)
    key, bare, info, radius, entryRadius, pos3, setPos, flushZ, flushLift, normDeg, rot2, scaleOf, r2, isPropSel, isOnce, groupPoly, groupOutline, layer3d, drag, until, settle };
})();

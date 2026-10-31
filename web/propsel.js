// Several props at once (MAPED-EDIT7): the Select tool's Shift+click (adds), Ctrl+click (toggles) and box (a drag on
// empty ground, or with Shift or Ctrl anywhere: what the box touches); the selection is moved (drag any of it), turned
// and scaled about its centre (its handles, R / Shift+R, [ and ]), duplicated (Ctrl+D), deleted (Del), copied (Ctrl+C,
// Ctrl+X) and pasted at the mouse (Ctrl+V; on team 2's half the source goes on team 1's half, turned by 180, as a new
// prop's), Ctrl+A selects every prop. Split turns a group into single props (each member's noun, place, height, turn,
// scale and tilt, from the last check's placement), or only the members inside the box: the group gets the box as a
// hole (mapc's group.holes, the level's coordinates) and the members stand beside it as props.
//
// Plugs into app.js through ED (sel, down, hitFirst, keys, the 'draw' event, S.grab) and props.js through PR.
'use strict';

const PS = (() => {
  const { key, bare, pos3, setPos, normDeg, rot2, scaleOf, isPropSel, isOnce, live, radius, entryRadius, groupOutline } = PR;
  const props = () => (S.doc && Array.isArray(S.doc.props)) ? S.doc.props : [];
  const r3 = v => Math.round(v * 1000) / 1000;
  const MULTI = ['props', 'msrotate', 'msscale'];
  const isMulti = s => !!s && MULTI.includes(s.t);
  const Q = { clip: null, over: false, box: null };

  // the props entries a selection holds (indices, ascending)
  function selKs(s) {
    if (isMulti(s)) return s.ks.slice();
    if (isPropSel(s)) return [s.k];
    return [];
  }
  // multi makes the selection of entries ks: none, one prop, or several (box: the box they were taken with, kept
  // while a group is among them so its members inside can be split out)
  function multi(ks, box) {
    ks = [...new Set(ks)].filter(k => props()[k]).sort((a, b) => a - b);
    if (box && !ks.some(k => props()[k].group)) box = null;
    if (!ks.length) return null;
    if (ks.length === 1 && !box) return { t: 'prop', k: ks[0] };
    return box ? { t: 'props', ks, box } : { t: 'props', ks };
  }
  const entries = s => {
    const ps = props(), ks = (s && s.ks) || [];
    return ks.length && ks.every(k => ps[k]) ? ks.map(k => ps[k]) : undefined;
  };
  // the centre of entries (team 1's places)
  function centre(es) {
    if (!es || !es.length) return [0, 0];
    const ps = es.map(c => pos3(c.pos));
    return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
  }
  const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const inRect = (p, r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
  const mirRect = r => [-r[2], -r[3], -r[0], -r[1]];
  const touches = (p, rad, r) => Math.hypot(p[0] - Math.max(r[0], Math.min(p[0], r[2])), p[1] - Math.max(r[1], Math.min(p[1], r[3]))) <= rad;

  // entriesIn lists the props entries the box r touches: a marker's circle (its noun's radius) or a group's anchor
  function entriesIn(r) {
    if (!S.show.props) return [];
    const out = new Set();
    for (const it of live()) {
      if (it.kind !== 'prop' || it.card || (it.team === 2 && !S.show.mirror)) continue;
      if (touches(it.pos, radius(it.noun, it.scale), r)) out.add(it.k);
    }
    props().forEach((c, k) => {
      if (!c || !c.group) return;
      const p = pos3(c.pos);
      if (inRect(p, r) || (S.show.mirror && !isOnce(c) && inRect([-p[0], -p[1]], r))) out.add(k);
    });
    return [...out];
  }

  // ---- the handles: turn (round, east of the centre, turning with the drag) and scale (square, south) -------------

  function handles(s) {
    const es = entries(s);
    if (!es) return null;
    const c = centre(es);
    let R = 0;
    es.forEach(e => { const p = pos3(e.pos); R = Math.max(R, Math.hypot(p[0] - c[0], p[1] - c[1]) + entryRadius(e)); });
    R = Math.max(R, 24 * dpr / S.view.scale);
    const a = (s.ang || 0) * Math.PI / 180;
    return { anchor: c, R, rot: [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)], scale: [c[0], c[1] - R] };
  }

  function hitFirst(sx, sy, w, near) {
    if (!S.show.props || !isMulti(S.sel)) return null;
    const hd = handles(S.sel);
    const base = { ks: S.sel.ks, box: S.sel.box, ang: S.sel.ang || 0 };
    if (hd && near(hd.rot, 8)) return { sel: Object.assign({ t: 'msrotate' }, base) };
    if (hd && near(hd.scale, 8)) return { sel: Object.assign({ t: 'msscale' }, base) };
    return null;
  }

  // ---- moving, turning, scaling the selection (a drag starts from drag.orig: the entries' copies) ----------------

  // turnAll turns the entries es (now) by deg about c, from their originals o
  function turnAll(es, o, c, deg) {
    es.forEach((e, i) => {
      const p = pos3(o[i].pos), v = rot2([p[0] - c[0], p[1] - c[1]], deg);
      setPos(e, [r3(c[0] + v[0]), r3(c[1] + v[1])]);
      e.rot = r3(normDeg((+o[i].rot || 0) + deg));
    });
  }
  // scaleAll scales the entries es about c by f (bounded so every scale stays 0.05 to 20), from their originals o
  function scaleAll(es, o, c, f) {
    for (const x of o) { const s = scaleOf(x.scale); f = Math.min(20 / s, Math.max(0.05 / s, f)); }
    es.forEach((e, i) => {
      const p = pos3(o[i].pos);
      setPos(e, [r3(c[0] + (p[0] - c[0]) * f), r3(c[1] + (p[1] - c[1]) * f)]);
      e.scale = r3(scaleOf(o[i].scale) * f);
      if (Array.isArray(o[i].footprint)) e.footprint = o[i].footprint.map(v => Math.max(0.1, r1(v * f)));
    });
  }
  const angleTo = (a, w) => Math.atan2(w[1] - a[1], w[0] - a[0]) * 180 / Math.PI;

  const del = s => {
    const ks = selKs(s).sort((a, b) => b - a);
    edit(d => { for (const k of ks) d.props.splice(k, 1); });
    select(null);
  };
  ED.sel.props = {
    value: entries,
    inspector: (el, s) => inspector(el, s),
    // every entry moves by the drag (the first one's move, snapped as a single prop's; the others keep their offsets)
    move(drag, w, e, at) {
      const o = drag.orig, es = entries(drag.sel);
      if (!es || !o) return;
      const a0 = pos3(o[0].pos), t = at(a0), d = [t[0] - a0[0], t[1] - a0[1]];
      // dragging a mirror moves the mirrored sources the other way; an entry that stands once follows the mouse
      es.forEach((x, i) => {
        const p = pos3(o[i].pos), s = drag.mirrored && isOnce(x) ? -1 : 1;
        setPos(x, [r3(p[0] + s * d[0]), r3(p[1] + s * d[1])]);
      });
    },
    del,
  };
  ED.sel.msrotate = {
    value: entries,
    inspector: (el, s) => inspector(el, s),
    move(drag, w, e) {
      const o = drag.orig, es = entries(drag.sel);
      if (!es || !o) return;
      const c = centre(o);
      let deg = angleTo(c, w) - angleTo(c, drag.start);
      deg = e && e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
      turnAll(es, o, c, deg);
      drag.sel.ang = normDeg((drag.ang0 === undefined ? (drag.ang0 = drag.sel.ang || 0) : drag.ang0) + deg);
    },
    del,
  };
  ED.sel.msscale = {
    value: entries,
    inspector: (el, s) => inspector(el, s),
    move(drag, w) {
      const o = drag.orig, es = entries(drag.sel);
      if (!es || !o) return;
      const c = centre(o);
      const d0 = Math.hypot(drag.start[0] - c[0], drag.start[1] - c[1]) || 1, d = Math.hypot(w[0] - c[0], w[1] - c[1]);
      scaleAll(es, o, c, d / d0);
    },
    del,
  };

  // ---- the mouse: Shift/Ctrl+click, the box, dragging the selection -----------------------------------------------

  function down(h, e, w) {
    if (!S.doc || S.tool !== 'select') return false;
    const mod = !!(e && (e.shiftKey || e.ctrlKey || e.metaKey));
    const onProp = h && h.sel.t === 'prop';
    if (!mod && h && isMulti(S.sel) && (h.sel.t === 'msrotate' || h.sel.t === 'msscale')) return false; // a handle
    if (!mod && onProp && isMulti(S.sel) && S.sel.ks.includes(h.sel.k)) { // drag the whole selection
      if (S.sel.t !== 'props') select(Object.assign({ t: 'props', ks: S.sel.ks }, S.sel.box ? { box: S.sel.box } : {}));
      S.drag = { sel: S.sel, mirrored: !!h.mirrored, start: w, orig: null, moved: false };
      return true;
    }
    if (!mod && h) return false; // a plain click on something: app.js selects it
    // a box (a drag on empty ground, or with Shift or Ctrl); without a move it is a click
    const sx0 = w2s(w);
    Q.box = { a: w, b: w, mode: e && (e.ctrlKey || e.metaKey) ? 'toggle' : e && e.shiftKey ? 'add' : 'replace', h };
    S.grab = {
      move(w2) { Q.box.b = w2; render(); },
      up() {
        const b = Q.box;
        Q.box = null;
        const s1 = w2s(b.b);
        if (Math.hypot(s1[0] - sx0[0], s1[1] - sx0[1]) < 4 * dpr) click(b.h, b.mode);
        else boxSelect(rectOf(b.a, b.b), b.mode);
        render();
      },
    };
    return true;
  }

  function click(h, mode) {
    if (mode === 'replace') return select(h ? h.sel : null);
    if (!h) return; // Shift or Ctrl on empty ground keeps the selection
    if (h.sel.t !== 'prop') return select(h.sel);
    const ks = selKs(S.sel), k = h.sel.k, box = isMulti(S.sel) ? S.sel.box : null;
    if (mode === 'toggle' && ks.includes(k)) return select(multi(ks.filter(x => x !== k), box));
    select(multi(ks.concat([k]), box));
  }

  function boxSelect(r, mode) {
    const found = entriesIn(r);
    let ks = mode === 'replace' ? [] : selKs(S.sel);
    if (mode === 'toggle') { for (const k of found) ks = ks.includes(k) ? ks.filter(x => x !== k) : ks.concat([k]); } else ks = ks.concat(found);
    select(multi(ks, found.length ? r : null));
    if (found.length) log(`box: ${found.length} prop${found.length > 1 ? 's' : ''} touched`);
  }

  // ---- copy, paste, duplicate, keys ----------------------------------------------------------------------------

  function copy(cut) {
    const ks = selKs(S.sel);
    if (!ks.length) return false;
    const es = ks.map(k => JSON.parse(JSON.stringify(props()[k])));
    Q.clip = { entries: es, centre: centre(es) };
    log(`${cut ? 'cut' : 'copied'} ${es.length} prop${es.length > 1 ? 's' : ''}` + (cut ? '' : '; Ctrl+V pastes them at the mouse'));
    if (cut) del(S.sel);
    return true;
  }

  // place adds copies of es, their centre c moved to m (on team 2's half: the mirrored ones' sources on team 1's half,
  // turned by 180, so the copies stand where m is as the mirror; one that stands once just stands there), as one
  // edit; selects them
  function place(es, c, m) {
    const team2 = m[0] + m[1] > 0;
    const made = es.map(x => {
      const e = JSON.parse(JSON.stringify(x)), p = pos3(x.pos);
      let q = [r3(m[0] + p[0] - c[0]), r3(m[1] + p[1] - c[1])];
      if (team2 && !isOnce(x)) { q = [-q[0], -q[1]]; e.rot = r3(normDeg((+e.rot || 0) + 180)); }
      setPos(e, q);
      return e;
    });
    edit(d => { d.props = Array.isArray(d.props) ? d.props : []; d.props.push(...made); });
    const n = props().length;
    select(multi(made.map((_, i) => n - made.length + i)));
    return made;
  }

  function paste(at) {
    if (!Q.clip || !S.doc) return false;
    const c = Q.clip.centre;
    const m = at || (Q.over && S.mouseW ? snapW(S.mouseW) : [r1(c[0] + 4), r1(c[1] - 4)]);
    const made = place(Q.clip.entries, c, m);
    log(`pasted ${made.length} prop${made.length > 1 ? 's' : ''} at (${m[0]}, ${m[1]})` + (m[0] + m[1] > 0 && Q.clip.entries.some(e => !isOnce(e)) ? ': on team 2\'s half, so the mirrored ones\' sources went on team 1\'s half' : ''));
    return true;
  }

  function keys(e) {
    const ctl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctl && !e.altKey && k === 'a' && props().length) { e.preventDefault(); select(multi(props().map((_, i) => i))); return true; }
    if (ctl && !e.altKey && (k === 'c' || k === 'x')) { if (copy(k === 'x')) { e.preventDefault(); return true; } return false; }
    if (ctl && !e.altKey && k === 'v') { if (paste()) { e.preventDefault(); return true; } return false; }
    if (!isMulti(S.sel) || !entries(S.sel)) return false;
    const es = entries(S.sel), o = JSON.parse(JSON.stringify(es)), c = centre(o);
    if (ctl && k === 'd') { e.preventDefault(); place(o, c, [r1(c[0] + 4), r1(c[1] - 4)]); return true; }
    if (ctl || e.altKey) return false;
    if (k === 'r') { edit(() => turnAll(es, o, c, e.shiftKey ? -15 : 15)); return true; }
    if (e.key === '[' || e.key === ']') { edit(() => scaleAll(es, o, c, e.key === ']' ? 1.1 : 1 / 1.1)); return true; }
    return false;
  }

  // ---- split: a group's members as single props --------------------------------------------------------------------

  // asProp is the single prop that places what a group's member p (mapc props' placement, team 1, or team 0 for a
  // group that stands once) placed; a member of a group that stands once stands once too ("mirror": false)
  function asProp(p, once) {
    const e = { noun: bare(p.noun), pos: p.pos[2] ? [r3(p.pos[0]), r3(p.pos[1]), r3(p.pos[2])] : [r3(p.pos[0]), r3(p.pos[1])],
      rot: r3(normDeg(p.rot[2])), scale: r3(Math.min(20, Math.max(0.05, p.scale))) };
    if (r3(p.rot[0]) || r3(p.rot[1])) e.tilt = [r3(p.rot[0]), r3(p.rot[1])];
    if (once) e.mirror = false;
    return e;
  }
  // toLevel is a point of the map (team 1's) in group c's level coordinates (where the member there came from)
  function toLevel(c, q) {
    const p = pos3(c.pos), at = Array.isArray(c.group.at) ? c.group.at : [0, 0], s = scaleOf(c.scale);
    const v = rot2([(q[0] - p[0]) / s, (q[1] - p[1]) / s], -(+c.rot || 0));
    return [r3(at[0] + v[0]), r3(at[1] + v[1])];
  }
  const corners = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  const checkCurrent = () => S.placed && S.placedFrom && JSON.stringify(S.placedFrom.props) === JSON.stringify(props());

  // split turns the groups among the entries ks into single props: every member, or with box (the map's rectangle
  // [x0, y0, x1, y1]) only the members inside it (or whose mirror is inside it), the group keeping the rest. One edit.
  async function split(ks, box) {
    if (!S.doc) return null;
    const gks = ks.filter(k => props()[k] && props()[k].group);
    if (!gks.length) { log('split: no group selected', 'err'); return null; }
    if (!checkCurrent()) { clearTimeout(S.checkTimer); await runCheck(); }
    if (!checkCurrent()) { log('split: the members come from the check\'s placement, which needs the game files (-copy) and a check of this draft', 'err'); return null; }
    const plan = [];
    let clamped = 0;
    for (const k of gks) {
      const c = props()[k], p = pos3(c.pos), once = isOnce(c);
      if (!once && Math.hypot(p[0], p[1]) <= 0.5) { log(`split: props[${k}] stands at the centre, where its members stand once; move it off the centre first`, 'err'); continue; }
      const ms = S.placed.filter(q => q.path === 'props[' + k + ']' && q.team !== 2 && !q.card);
      const hit1 = q => box && inRect(q.pos, box), hit2 = q => box && !once && S.show.mirror && inRect([-q.pos[0], -q.pos[1]], box);
      const take = box ? ms.filter(q => hit1(q) || hit2(q)) : ms;
      if (!take.length) continue;
      const whole = take.length === ms.length;
      const holes = [];
      if (!whole) {
        if (take.some(hit1)) holes.push(corners(box).map(q => toLevel(c, q)));
        if (take.some(hit2)) holes.push(corners(mirRect(box)).map(q => toLevel(c, q)));
      }
      const singles = take.map(q => asProp(q, once));
      clamped += take.filter(q => q.scale < 0.05 || q.scale > 20).length;
      plan.push({ k, whole, holes, singles, members: ms.length });
    }
    if (!plan.length) { log('split: no member of the selected groups ' + (box ? 'inside the box' : 'placed'), 'err'); return null; }
    edit(d => {
      for (const s of plan.slice().sort((a, b) => b.k - a.k)) {
        if (s.whole) { d.props.splice(s.k, 1, ...s.singles); continue; }
        const g = d.props[s.k].group;
        g.holes = (Array.isArray(g.holes) ? g.holes : []).concat(s.holes);
        d.props.splice(s.k + 1, 0, ...s.singles);
      }
    });
    const made = new Set(plan.flatMap(s => s.singles));
    const nks = props().map((c, i) => made.has(c) ? i : -1).filter(i => i >= 0);
    select(multi(nks));
    const n = made.size;
    log(`split: ${n} member${n > 1 ? 's' : ''} as single props` + plan.map(s => s.whole ? `; props[${s.k}] whole (${s.members})` : `; ${s.singles.length} of props[${s.k}]'s ${s.members}, the box its hole`).join('') +
      (clamped ? `; ${clamped} scale${clamped > 1 ? 's' : ''} brought into 0.05 to 20` : ''));
    return { made: n, plan };
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  function drawOver() {
    if (!S.doc) return;
    ctx.save();
    if (S.show.props && isMulti(S.sel) && entries(S.sel)) {
      const ks = new Set(S.sel.ks);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      for (const it of live()) {
        if (it.kind !== 'prop' || !ks.has(it.k) || it.card || (it.team === 2 && !S.show.mirror)) continue;
        const s = w2s(it.pos);
        ctx.globalAlpha = it.team === 2 ? 0.5 : 1;
        ctx.beginPath();
        ctx.arc(s[0], s[1], Math.max(4 * dpr, radius(it.noun, it.scale) * S.view.scale) + 2 * dpr, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      for (const k of ks) {
        const out = groupOutline(props()[k]);
        if (!out) continue;
        ctx.beginPath();
        out.forEach((q, i) => { const v = w2s(q); if (i) ctx.lineTo(v[0], v[1]); else ctx.moveTo(v[0], v[1]); });
        ctx.closePath();
        ctx.stroke();
      }
      if (S.sel.box) { // the box the groups' members can be split out with
        const r = S.sel.box, a = w2s([r[0], r[3]]), b = w2s([r[2], r[1]]);
        ctx.strokeStyle = 'rgba(255,214,102,0.9)';
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      }
      ctx.setLineDash([]);
      const hd = handles(S.sel), a = w2s(hd.anchor), ro = w2s(hd.rot), sc = w2s(hd.scale);
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(ro[0], ro[1]); ctx.stroke();
      ctx.fillStyle = S.sel.t === 'msrotate' ? '#58a6ff' : '#fff';
      ctx.beginPath(); ctx.arc(ro[0], ro[1], 5 * dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = S.sel.t === 'msscale' ? '#58a6ff' : '#fff';
      ctx.fillRect(sc[0] - 4.5 * dpr, sc[1] - 4.5 * dpr, 9 * dpr, 9 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillRect(a[0] - 3 * dpr, a[1] - 3 * dpr, 6 * dpr, 6 * dpr);
    }
    if (Q.box) { // the box being dragged
      const a = w2s(Q.box.a), b = w2s(Q.box.b);
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = 'rgba(88,166,255,0.12)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    ctx.restore();
  }

  // ---- the inspector -------------------------------------------------------------------------------------------

  function inspector(el, s) {
    const es = entries(s), ks = s.ks;
    const groups = ks.filter(k => props()[k].group);
    const placed = live().filter(it => it.kind === 'prop' && !it.card && it.team !== 2);
    const members = k => placed.filter(it => it.k === k);
    const inBox = s.box ? groups.reduce((n, k) => n + members(k).filter(it => inRect(it.pos, s.box) || (S.show.mirror && !isOnce(props()[k]) && inRect([-it.pos[0], -it.pos[1]], s.box))).length, 0) : 0;
    const c = centre(es);
    const turn = h('input', { type: 'number', step: '1', value: 15 }), scale = h('input', { type: 'number', step: '0.05', value: 1.1 });
    el.append(h('div', { class: 'path' }, ks.length <= 8 ? `props[${ks.join(', ')}]` : `${ks.length} props entries`),
      h('div', {}, `${ks.length} props selected: ${ks.length - groups.length} single, ${groups.length} group${groups.length === 1 ? '' : 's'}; centre (${r1(c[0])}, ${r1(c[1])})`),
      h('div', { class: 'xy' }, 'turn by', turn, h('button', { onclick: () => { const o = JSON.parse(JSON.stringify(es)); edit(() => turnAll(es, o, centre(o), +turn.value || 0)); } }, 'Turn')),
      h('div', { class: 'xy' }, 'scale by', scale, h('button', { onclick: () => { const o = JSON.parse(JSON.stringify(es)); edit(() => scaleAll(es, o, centre(o), +scale.value || 1)); } }, 'Scale')),
      h('div', { class: 'btns' },
        h('button', { title: 'Ctrl+C; Ctrl+V pastes at the mouse', onclick: () => copy(false) }, 'Copy'),
        h('button', { title: 'Ctrl+D', onclick: () => keys({ key: 'd', ctrlKey: true, preventDefault() {} }) }, 'Duplicate'),
        h('button', { title: 'Del', onclick: deleteSel }, 'Delete')));
    if (groups.length) {
      const total = groups.reduce((n, k) => n + members(k).length, 0);
      el.append(h('div', { class: 'btns' },
        s.box ? h('button', { title: 'The members inside the box (or whose mirror is) become single props; their group keeps the rest (the box becomes its hole)', disabled: !inBox, onclick: () => split(ks, s.box) }, `Split the box (${inBox} member${inBox === 1 ? '' : 's'})`) : null,
        h('button', { title: 'Every member of the selected groups becomes a single prop', onclick: () => split(ks, null) }, `Split the group${groups.length > 1 ? 's' : ''} (${total})`)),
      h('p', { class: 'small' }, 'Split takes each member\'s noun, place, height, turn, scale and tilt from the last check (it needs the game files). The single props are copies of the noun\'s first shipped marker: a member\'s own settings (a light\'s colour, an effect\'s parameters) are not kept.'));
    }
    const list = h('div', { class: 'small proplist' });
    for (const k of ks.slice(0, 40)) {
      const e = props()[k];
      list.append(h('div', {}, h('a', { href: '#', onclick: ev => { ev.preventDefault(); select({ t: 'prop', k }); } }, `props[${k}]`),
        ' ' + (e.group ? `group of ${e.group.level} (${members(k).length})` : bare(e.noun))));
    }
    if (ks.length > 40) list.append(h('div', {}, `and ${ks.length - 40} more`));
    el.append(list, h('p', { class: 'small' }, 'Drag any of them to move them all; the round handle turns them about the centre (Shift: 15-degree steps), the square one scales them; R / Shift+R turn, [ and ] scale, Del deletes, Ctrl+C / Ctrl+V copy and paste at the mouse, Esc clears. Shift+click adds a prop, Ctrl+click adds or removes one, a box (drag on empty ground, or with Shift or Ctrl) selects what it touches.'));
  }

  // ---- wiring ------------------------------------------------------------------------------------------------

  ED.down.push(down);
  ED.hitFirst.push(hitFirst);
  const inner = ED.keys;
  ED.keys = e => keys(e) || (inner ? inner(e) : false);
  ED.on('draw', phase => { if (phase === 'over') drawOver(); });
  ED.on('open', () => { Q.box = null; });
  cv.addEventListener('mouseenter', () => { Q.over = true; });
  cv.addEventListener('mouseleave', () => { Q.over = false; });

  // ---- the self-test (?selftest=propsel): the real mouse and key events on CM_Ring ------------------------------

  async function selftest() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
    let ok = true;
    // the events as the browser sends them: down on the canvas, move and up on the window, keys on the window
    const client = w => { const r = cv.getBoundingClientRect(), s = w2s(w); return { clientX: r.left + s[0] / dpr, clientY: r.top + s[1] / dpr }; };
    const mouse = (type, w, mods) => (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign(client(w),
      { bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1 }, mods || {})));
    const clickAt = (w, mods) => { mouse('mousedown', w, mods); mouse('mouseup', w, mods); };
    const dragFrom = (a, b, mods) => {
      mouse('mousedown', a, mods);
      for (let i = 1; i <= 4; i++) mouse('mousemove', [a[0] + (b[0] - a[0]) * i / 4, a[1] + (b[1] - a[1]) * i / 4], mods);
      mouse('mouseup', b, mods);
    };
    const key = (k, mods) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
    const ksOf = () => selKs(S.sel).join(',');
    const near = (a, b, d) => Math.abs(a[0] - b[0]) < (d || 0.011) && Math.abs(a[1] - b[1]) < (d || 0.011);
    const P = k => pos3(props()[k].pos);
    const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || ''));

    ok &= say(S.report && S.report.ok, 'opened ' + S.pkg);
    await PR.loadNouns();
    await PR.until(() => PR.P.state !== 'loading', 120000);
    setTool('select');
    // three rocks in the base's south-west, zoomed in as one works on props
    PR.placeNoun('Rock_Pastoral_Large_01', [-160, -150], 0);
    PR.placeNoun('lichenrock_02', [-148, -156], 0);
    PR.placeNoun('lichenrock_01', [-155, -138], 0);
    setTool('select');
    S.view = { x: -150, y: -140, scale: 6 * dpr };
    S.fitted = false;
    render();
    // clicks: one, Shift adds, Ctrl toggles, Esc clears
    clickAt([-160, -150]);
    ok &= say(S.sel && S.sel.t === 'prop' && S.sel.k === 0, 'a click selects props[0]: ' + JSON.stringify(S.sel));
    clickAt([-148, -156], { shiftKey: true });
    ok &= say(S.sel && S.sel.t === 'props' && ksOf() === '0,1', 'Shift+click adds props[1]: ' + ksOf());
    clickAt([-155, -138], { ctrlKey: true });
    ok &= say(ksOf() === '0,1,2', 'Ctrl+click adds props[2]: ' + ksOf());
    clickAt([-148, -156], { ctrlKey: true });
    ok &= say(ksOf() === '0,2', 'Ctrl+click on props[1] takes it out: ' + ksOf());
    key('Escape');
    ok &= say(S.sel === null, 'Esc clears the selection');
    // a box on empty ground (where nothing, not even a terrain shape, is hit): what it touches
    const hitAt = w => { const s = w2s(w); return hit(s[0], s[1]); };
    let empty = null;
    for (let t = 12; t <= 80 && !empty; t += 2) {
      for (const d of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = [-155 + d[0] * t, -147 + d[1] * t];
        if (!hitAt(p)) { empty = p; break; }
      }
    }
    if (empty) {
      dragFrom(empty, [-310 - empty[0], -294 - empty[1]]);
      ok &= say(ksOf() === '0,1,2', `a box from empty ground at (${empty}) over the three rocks selects them: ` + ksOf());
    } else say(true, 'no empty ground near the rocks (shapes everywhere): the plain box is left out');
    key('Escape');
    // with Shift a box starts anywhere (here on the rock itself) and adds
    dragFrom([-160, -150], [-146, -157], { shiftKey: true });
    ok &= say(ksOf() === '0,1', 'Shift+box from the rock over two rocks selects them: ' + ksOf());
    dragFrom([-157, -140], [-153, -136], { shiftKey: true });
    ok &= say(ksOf() === '0,1,2', 'Shift+box adds the third: ' + ksOf());
    dragFrom([-157, -140], [-153, -136], { ctrlKey: true });
    ok &= say(ksOf() === '0,1', 'Ctrl+box toggles it out again: ' + ksOf());
    dragFrom([-157, -140], [-153, -136], { ctrlKey: true });
    // drag one: all move by the same; one undo puts them back
    const before = [0, 1, 2].map(P), undo0 = S.undo.length;
    dragFrom([-148, -156], [-138, -151]);
    const moved = [0, 1, 2].map(P);
    ok &= say(moved.every((p, i) => near(p, [before[i][0] + 10, before[i][1] + 5])) && S.undo.length === undo0 + 1,
      'dragging props[1] moves all three by (10, 5): ' + JSON.stringify(moved));
    const mir2 = live().filter(it => it.k === 2 && it.team === 2)[0];
    ok &= say(mir2 && near(mir2.pos, [-moved[2][0], -moved[2][1]]), 'their mirrors follow at once');
    key('z', { ctrlKey: true });
    ok &= say([0, 1, 2].map(P).every((p, i) => near(p, before[i])), 'one Ctrl+Z undoes the drag');
    select(multi([0, 1, 2]));
    // turn and scale about the centre: keys and handles
    const c0 = centre(entries(S.sel));
    key('r');
    const t = [0, 1, 2].map(k => props()[k]);
    ok &= say(t.every((e, i) => {
      const v = rot2([before[i][0] - c0[0], before[i][1] - c0[1]], 15);
      return near(pos3(e.pos), [c0[0] + v[0], c0[1] + v[1]]) && Math.abs(e.rot - 15) < 1e-6;
    }), 'R turns all three by 15 degrees about their centre: ' + t.map(e => e.rot).join(', '));
    key('z', { ctrlKey: true });
    key(']');
    ok &= say([0, 1, 2].every(k => Math.abs(props()[k].scale - 1.1) < 1e-6 && near(P(k), [c0[0] + (before[k][0] - c0[0]) * 1.1, c0[1] + (before[k][1] - c0[1]) * 1.1])),
      '] scales all three by 1.1 about their centre');
    key('z', { ctrlKey: true });
    let hd = handles(S.sel);
    dragFrom(hd.rot, [hd.anchor[0], hd.anchor[1] + hd.R]);
    ok &= say([0, 1, 2].every(k => Math.abs(props()[k].rot - 90) < 1) && S.sel.t === 'msrotate', 'the turn handle turns them by 90: ' + [0, 1, 2].map(k => props()[k].rot).join(', '));
    key('z', { ctrlKey: true });
    select(multi([0, 1, 2]));
    hd = handles(S.sel);
    dragFrom(hd.scale, [hd.anchor[0], hd.anchor[1] - 2 * hd.R]);
    ok &= say([0, 1, 2].every(k => Math.abs(props()[k].scale - 2) < 0.01), 'the scale handle scales them by 2: ' + [0, 1, 2].map(k => props()[k].scale).join(', '));
    key('z', { ctrlKey: true });
    ok &= say([0, 1, 2].map(P).every((p, i) => near(p, before[i])) && [0, 1, 2].every(k => props()[k].scale === 1 && props()[k].rot === 0), 'undone: as before');
    // copy, paste at the mouse on team 1's half and on team 2's (mirrored source), one undo each
    select(multi([0, 1]));
    key('c', { ctrlKey: true });
    ok &= say(Q.clip && Q.clip.entries.length === 2, 'Ctrl+C copies two');
    S.view = { x: -130, y: -60, scale: 3 * dpr };
    render();
    cv.dispatchEvent(new MouseEvent('mouseenter'));
    mouse('mousemove', [-130, -60], { buttons: 0 });
    key('v', { ctrlKey: true });
    const n1 = props().length, pc = centre([props()[n1 - 2], props()[n1 - 1]]);
    ok &= say(n1 === 5 && near(pc, [-130, -60], 0.35) && ksOf() === '3,4', 'Ctrl+V pastes them centred at the mouse: ' + JSON.stringify(pc));
    S.view = { x: 60, y: 40, scale: 3 * dpr };
    render();
    mouse('mousemove', [60, 40], { buttons: 0 });
    key('v', { ctrlKey: true });
    const n2 = props().length, src = [props()[n2 - 2], props()[n2 - 1]], sc = centre(src);
    ok &= say(n2 === 7 && near(sc, [-60, -40], 0.35) && src.every(e => e.rot === 180), 'on team 2\'s half: their sources at ' + JSON.stringify(sc) + ', turned 180');
    const seen = live().filter(it => it.team === 2 && (it.k === n2 - 2 || it.k === n2 - 1));
    ok &= say(seen.length === 2 && near(centre(seen), [60, 40], 0.35), 'their mirrors stand where the mouse was: ' + JSON.stringify(centre(seen)));
    key('z', { ctrlKey: true });
    ok &= say(props().length === 5, 'one Ctrl+Z takes the paste back');
    // Delete, Ctrl+A
    select(multi([3, 4]));
    key('Delete');
    ok &= say(props().length === 3 && S.sel === null, 'Del deletes the selection');
    key('a', { ctrlKey: true });
    ok &= say(ksOf() === '0,1,2', 'Ctrl+A selects every prop: ' + ksOf());
    key('Escape');
    // a group pasted from SM_Map_v5 (the camp of the props self-test), then split: a box, then the rest
    await PR.loadLevel();
    PR.P.pick = { at: [-87.5, -52.6], r: 12, sets: ['D_Rocks', 'D_Trees', 'D_Foliage', 'D_IvyNFlowers', 'D_Objects'] };
    const sets = new Set(PR.P.pick.sets);
    PR.takeGroup(PR.P.level.objects.filter(o => o.parts && o.parts.length && !o.hidden && sets.has((o.markerset || '').slice(PR.P.levelName.length + 1)) &&
      Math.hypot(o.pos[0] - PR.P.pick.at[0], o.pos[1] - PR.P.pick.at[1]) <= PR.P.pick.r));
    ED.tools.paste.down([-120, -110], null);
    setTool('select');
    await PR.settle();
    const gk = props().length - 1;
    const sig = () => (S.placed || []).filter(p => !p.card).map(p => [bare(p.noun).toLowerCase(), p.team === 2 ? 2 : 1, ...p.pos.map(v => v.toFixed(2)),
      ...p.rot.map(v => (Math.round(normDeg(v) * 10) / 10 + 0).toFixed(1)), p.scale.toFixed(3)].join(' ')).sort();
    const sig0 = sig(), gm = S.placed.filter(p => p.path === 'props[' + gk + ']' && p.team === 1);
    ok &= say(S.report.ok && gm.length > 6, `group props[${gk}]: ${gm.length} members on team 1; check ${S.report.ok ? 'passes' : rules().join(' ')}`);
    // a click on a member selects the whole group; a box over a few selects it with the box
    S.view = { x: -120, y: -110, scale: 6 * dpr };
    render();
    const xs = gm.map(p => p.pos[0]).sort((a, b) => a - b), mid = xs[Math.floor(xs.length / 2)];
    const box = [mid - 0.01, -125, -100, -95];
    const want = gm.filter(p => inRect(p.pos, box)).length;
    dragFrom([box[0], box[1]], [box[2], box[3]], { shiftKey: true });
    ok &= say(S.sel && S.sel.t === 'props' && S.sel.box && S.sel.ks.includes(gk), `a box over the group's east side selects it with the box (${want} of ${gm.length} members inside)`);
    const r = await split(S.sel.ks, S.sel.box);
    const g = props()[gk];
    ok &= say(r && r.made === want && Array.isArray(g.group.holes) && g.group.holes.length === 1 && props().length === gk + 1 + want,
      `split the box: ${r && r.made} single props after the group, its hole ${JSON.stringify(g.group.holes)}`);
    const one = props()[gk + 1];
    ok &= say(one && one.noun && Array.isArray(one.pos) && typeof one.rot === 'number', 'a split member: ' + JSON.stringify(one));
    ok &= say(props().slice(gk + 1).some(e => e.pos.length === 3 || e.tilt), 'members keep their height or tilt: ' + props().slice(gk + 1).filter(e => e.pos.length === 3 || e.tilt).length + ' of ' + want);
    await PR.settle();
    const sig1 = sig();
    const diff = (a, b) => a.filter(x => !b.includes(x)).length + b.filter(x => !a.includes(x)).length;
    ok &= say(S.report.ok && sig1.length === sig0.length && diff(sig0, sig1) === 0,
      `the check places the same ${sig1.length} markers (noun, team, place, turn, scale) as before the split; ${diff(sig0, sig1)} differ; ${S.report.ok ? 'passes' : rules().join(' ')}`);
    const n3 = props().length;
    select({ t: 'prop', k: gk });
    const r2 = await split([gk], null);
    await PR.settle();
    ok &= say(r2 && r2.made === gm.length - want && props().length === n3 - 1 + gm.length - want && !props().some(e => e.group),
      `split the rest: ${r2 && r2.made} more single props, no group left`);
    const sig2 = sig();
    ok &= say(S.report.ok && diff(sig0, sig2) === 0, `the same markers again (${sig2.length}); ${diff(sig0, sig2)} differ`);
    key('z', { ctrlKey: true });
    ok &= say(props()[gk] && props()[gk].group && props()[gk].group.holes.length === 1, 'one Ctrl+Z brings the group back (with its hole)');
    key('z', { ctrlKey: true });
    ok &= say(props()[gk] && props()[gk].group && !props()[gk].group.holes && props().length === gk + 1, 'another undoes the box split');
    await PR.settle();
    ok &= say(S.report.ok, 'check passes');
    say(ok, ok ? 'selftest propsel passed' : 'selftest propsel failed');
    document.title = ok ? 'selftest propsel passed' : 'selftest propsel failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.propsel = selftest;

  // ---- the self-test of groups that stand once (?open=CM_Pass&selftest=once; needs -copy; saves nothing) ----------

  async function selftestOnce() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
    let ok = true;
    const rules = () => (S.report.findings || []).map(f => f.rule + '@' + (f.path || ''));
    const near = (a, b, d) => Math.abs(a[0] - b[0]) < (d || 0.011) && Math.abs(a[1] - b[1]) < (d || 0.011);
    const key = (k, mods) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
    const hitAt = w => { const s = w2s(w); return hit(s[0], s[1]); };
    const sig = () => (S.placed || []).filter(p => !p.card).map(p => [bare(p.noun).toLowerCase(), p.team, ...p.pos.map(v => v.toFixed(2)),
      ...p.rot.map(v => (Math.round(normDeg(v) * 10) / 10 + 0).toFixed(1)), p.scale.toFixed(3)].join(' ')).sort();
    const diff = (a, b) => a.filter(x => !b.includes(x)).length + b.filter(x => !a.includes(x)).length;

    ok &= say(S.report && S.report.ok, 'opened ' + S.pkg + ': ' + (S.report && S.report.ok ? 'passes' : rules().join(' ')));
    await PR.loadNouns();
    await PR.until(() => PR.P.state !== 'loading', 120000);
    await PR.settle();
    setTool('select');
    const gk = props().findIndex(c => c.group && (c.group.sets || []).includes('rocks'));
    const pl = (S.placed || []).filter(p => !p.card), sig0 = sig();
    // the imported dressing is groups that stand once; the two plinths added by hand (MAPED-VOID) are mirrored singles
    const dress = props().map((c, k) => k).filter(k => props()[k].group), dpaths = new Set(dress.map(k => 'props[' + k + ']'));
    const dpl = pl.filter(p => dpaths.has(p.path));
    ok &= say(gk >= 0 && isOnce(props()[gk]) && dress.every(k => isOnce(props()[k])), `props[${gk}] is the rocks group; every group has "mirror": false`);
    ok &= say(dpl.length > 0 && dpl.every(p => p.team === 0), `the check places ${dpl.length} dressing markers, every one once (team 0)`);
    ok &= say(!live().some(it => it.team === 2 && dress.includes(it.k)), 'no dressing drawn as a mirror (no team 2 copy)');
    // a rock of the group on team 2's half: where the level has it, its click selects the group, not a mirror
    const mem = pl.filter(p => p.path === 'props[' + gk + ']');
    const r2 = mem.find(p => p.pos[0] + p.pos[1] > 40 && !mem.some(q => q !== p && Math.hypot(q.pos[0] - p.pos[0], q.pos[1] - p.pos[1]) < 4));
    ok &= say(r2, `a lone rock on team 2's half at (${r2 && r2.pos.slice(0, 2).map(v => v.toFixed(1))})`);
    if (!r2) return finish();
    S.view = { x: r2.pos[0], y: r2.pos[1], scale: 6 * dpr };
    S.fitted = false;
    render();
    const hh = hitAt(r2.pos);
    ok &= say(hh && hh.sel.t === 'prop' && !hh.mirrored, 'a click on it hits ' + JSON.stringify(hh) + ', not a mirror');
    const a = pos3(props()[gk].pos), ha = hitAt([-a[0], -a[1]]);
    ok &= say(!(ha && ha.sel.k === gk && ha.mirrored), 'the group\'s anchor has no mirror to hit: ' + JSON.stringify(ha));
    select({ t: 'prop', k: gk });
    ok &= say($('inspector').textContent.includes('mirror off') && $('inspector').textContent.includes('each once'), 'the inspector says the members stand once, mirror off');
    // move the group by (2, 2): every member, on either half, moves the same way (between checks and after one)
    const n0 = S.undo.length;
    PR.drag({ t: 'prop', k: gk }, r2.pos.slice(0, 2), [r2.pos[0] + 2, r2.pos[1] + 2], false);
    const moved = live().filter(it => it.k === gk && !it.card), m2 = moved.find(it => near(it.pos, [r2.pos[0] + 2, r2.pos[1] + 2]));
    ok &= say(m2 && moved.every(it => it.team === 0) && near(pos3(props()[gk].pos), [a[0] + 2, a[1] + 2]), 'a drag moves the group 2 m; its rock follows at once, unmirrored');
    await PR.settle();
    const after = (S.placed || []).filter(p => p.path === 'props[' + gk + ']');
    const t1 = mem.find(p => p.pos[0] + p.pos[1] < -40);
    ok &= say(S.report.ok && after.length === mem.length && after.every(p => p.team === 0) && after.some(p => near(p.pos, [r2.pos[0] + 2, r2.pos[1] + 2])) &&
      t1 && after.some(p => near(p.pos, [t1.pos[0] + 2, t1.pos[1] + 2])), `checked: the ${after.length} members 2 m north-east on both halves, once`);
    key('z', { ctrlKey: true });
    await PR.settle();
    ok &= say(S.undo.length === n0 && diff(sig0, sig()) === 0, 'Ctrl+Z puts it back');
    // split a box round the rock: the members inside become single props that stand once; the same markers
    const box = [r2.pos[0] - 2, r2.pos[1] - 2, r2.pos[0] + 2, r2.pos[1] + 2];
    const want = mem.filter(p => inRect(p.pos, box)).length, np = props().length;
    select(multi([gk], box));
    const r = await split([gk], box);
    const singles = props().slice(gk + 1, gk + 1 + want);
    ok &= say(r && r.made === want && singles.every(e => e.noun && e.mirror === false) && props()[gk].group.holes.length === 1,
      `split the box: ${r && r.made} single prop(s) with "mirror": false, the group's hole ${JSON.stringify(props()[gk].group.holes)}`);
    await PR.settle();
    ok &= say(S.report.ok && diff(sig0, sig()) === 0, `the check places the same ${sig().length} markers, all once; ${diff(sig0, sig())} differ; ${S.report.ok ? 'passes' : rules().join(' ')}`);
    // copy the single and paste it on team 2's half: it stands where the mouse is, once
    select({ t: 'prop', k: gk + 1 });
    copy(false);
    const at = [r2.pos[0] + 10, r2.pos[1] - 6];
    paste(at);
    const pk = props().length - 1, pe = props()[pk];
    ok &= say(pe.mirror === false && near(pos3(pe.pos), at, 0.02), `pasted on team 2's half at (${pos3(pe.pos).slice(0, 2)}), "mirror": false`);
    const pv = live().filter(it => it.k === pk);
    ok &= say(pv.length === 1 && pv[0].team === 0, 'drawn once before its check');
    await PR.settle();
    const pp = S.placed.filter(p => p.path === 'props[' + pk + ']');
    ok &= say(S.report.ok && pp.length === 1 && pp[0].team === 0 && near(pp[0].pos, at, 0.02), 'checked: placed once where it was pasted');
    key('z', { ctrlKey: true });
    key('z', { ctrlKey: true });
    await PR.settle();
    ok &= say(props().length === np && !props()[gk].group.holes && diff(sig0, sig()) === 0, 'two Ctrl+Z: the group whole again, the same markers');
    return finish();

    function finish() {
      say(ok, ok ? 'selftest once passed' : 'selftest once failed');
      document.title = ok ? 'selftest once passed' : 'selftest once failed';
      document.body.dataset.selftest = ok ? 'passed' : 'failed';
    }
  }
  ED.selftests.once = selftestOnce;

  return { Q, split, copy, paste, selKs, multi, entriesIn, handles };
})();

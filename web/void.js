// The void panel: map.json's optional "void" section (mapc's format 1; what the map shows past its ground): the
// cut, the backdrop plane, the mist layer and the environment's height fog, each switched on and off on its own, with
// the format's ranges and what the live checks found written at the fields, and the check's void.* findings shown at
// the field their path names. Switching the section on writes MM_Map_v3's look the user picked (a lit black backdrop
// at z -50, the ground cut 1.5 m past the walkable edge, the mist at z -0.2 with FogRange 10 in (0.467, 0.824, 0.859)).
// The 3-D view draws the backdrop (the ground export holds it) and tints what lies under the mist by its depth
// (view3d.js mistNow); the height fog isn't drawn there.
//
// It uses app.js's globals (S, ED, edit, h, log, undo, runCheck) and its hooks: ED.on('doc' | 'open' | 'checked' |
// 'focus-void'), ED.texButton (ground.js's texture picker) and ED.selftests.void (and void-save).
'use strict';

const VOID = (() => {
  // the user's MM pick (mmvoid --backdrop black --mist-z -0.2 --mist-range 10 --mist-color 0.467,0.824,0.859, cut 1.5)
  const PICK = { cut: 1.5, backdrop: { z: -50, texture: { rgb: [0, 0, 0] } }, mist: { z: -0.2, range: 10, color: [0.467, 0.824, 0.859] } };
  const FOG = { start: 10, end: -225 }; // the shipped environments' height fog (MM_Map_v3, SM_Map_v5): black
  const clone = v => JSON.parse(JSON.stringify(v));
  const vd = () => (S.doc && S.doc.void && typeof S.doc.void === 'object' && !Array.isArray(S.doc.void)) ? S.doc.void : null;
  const sub = k => { const v = vd(); return v && v[k] && typeof v[k] === 'object' ? v[k] : null; };

  // colours: the format's floats (the mist's 0-2, the fog's 0-1) and the picker's #rrggbb (0-1); a texture's rgb 0-255
  const hex2 = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const toHex = c => '#' + [0, 1, 2].map(i => hex2((+c[i] || 0) * 255)).join('');
  const fromHex = s => [1, 3, 5].map(i => Math.round(parseInt(s.slice(i, i + 2), 16) / 255 * 1000) / 1000);
  const rgbHex = c => '#' + [0, 1, 2].map(i => hex2(+c[i] || 0)).join('');
  const hexRgb = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));

  const pane = ED.addPane('right', 'Void');
  const sec = pane.parentNode;
  sec.id = 'paneVoid';
  let slots = {}; // a field's path (void.mist.z) -> the element its findings go into

  // field: a row with a label, its control, the hint (ranges, findings) and a place for the check's findings
  function field(path, label, control, hint) {
    const f = h('div', { class: 'vfind' });
    slots[path] = f;
    return h('div', { class: 'vfield', 'data-path': path }, h('label', { class: 'gf' }, label + ' ', control), hint ? h('div', { class: 'hint' }, hint) : null, f);
  }
  // num: a number input bound to obj()[key]; an empty input removes an optional member (else the old value stays)
  function num(path, label, obj, key, o, hint) {
    const t = obj(), v = t ? t[key] : undefined;
    const inp = h('input', { type: 'number', step: o.step || 'any', min: o.min, max: o.max, placeholder: o.def !== undefined ? String(o.def) : '', 'data-v': path });
    if (v !== undefined) inp.value = v;
    inp.onchange = () => {
      const s = inp.value.trim(), n = Number(s);
      if ((s === '' && !o.optional) || (s !== '' && !Number.isFinite(n))) { inp.value = v ?? ''; return; }
      edit(() => { const x = obj(); if (!x) return; if (s === '') delete x[key]; else x[key] = n; });
    };
    return field(path, label, inp, hint);
  }
  // section: a sub-section's switch (backdrop, mist, fog): on writes its default, off removes it
  function section(k, label, def, hint) {
    const on = !!sub(k);
    const box = h('input', { type: 'checkbox', checked: on, 'data-v': 'void.' + k + ':on', onchange: ev => edit(() => {
      const v = vd();
      if (!v) return;
      if (ev.target.checked) v[k] = clone(def); else delete v[k];
    }) });
    const f = h('div', { class: 'vfind' });
    slots['void.' + k] = f;
    return h('div', { class: 'vsec', 'data-path': 'void.' + k }, h('label', { class: 'vhead' }, box, ' ' + label), hint ? h('div', { class: 'hint' }, hint) : null, f);
  }
  // colour: a picker and the three numbers (each 0 to max) for obj()[key]
  function colour(path, label, obj, key, max, hint) {
    const t = obj(), c = t && Array.isArray(t[key]) ? t[key] : [0, 0, 0];
    const pick = h('input', { type: 'color', value: toHex(c), 'data-v': path, title: 'The colour (the picker covers 0-1 each)' });
    pick.onchange = () => edit(() => { const x = obj(); if (x) x[key] = fromHex(pick.value); });
    const txt = h('input', { type: 'text', value: c.join(', '), 'data-v': path + ':text', title: `r, g, b: each 0 to ${max}` });
    txt.onchange = () => {
      const a = txt.value.split(/[ ,;]+/).filter(Boolean).map(Number);
      if (a.length !== 3 || !a.every(Number.isFinite)) { txt.value = c.join(', '); return; }
      edit(() => { const x = obj(); if (x) x[key] = a; });
    };
    return field(path, label, h('span', { class: 'vcol' }, pick, txt), hint);
  }

  function renderPane() {
    pane.textContent = '';
    slots = {};
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    const v = vd();
    const top = h('div', { class: 'vfind' });
    slots.void = top;
    pane.append(h('label', { class: 'vhead' }, h('input', { type: 'checkbox', checked: !!v, 'data-v': 'void:on', onchange: ev => edit(d => {
      if (ev.target.checked) d.void = clone(PICK); else delete d.void;
    }) }), ' a void: what the map shows past its ground'), top);
    if (!v) {
      pane.append(h('p', { class: 'hint' }, 'Off: the ground covers the whole square, as the shipped maps\' (their dark rim). On: MM_Map_v3\'s look as tuned live: the ground cut 1.5 m past the walkable edge, a lit black backdrop at z -50 and a pale cyan mist at z -0.2 (range 10). Each part can then be changed or switched off.'));
      return;
    }
    pane.append(num('void.cut', 'cut (m)', vd, 'cut', { min: 0, max: 50, step: 0.5, def: 0, optional: true },
      'The ground ends this far past the walkable edge (0.5 to 50; empty or 0: the whole square). A cut needs a backdrop: where nothing is drawn the game shows its earlier frames ("hall of mirrors").'));

    const bd = sub('backdrop');
    pane.append(section('backdrop', 'backdrop: a plane under the level', PICK.backdrop,
      'A plane 1,400 m wide that fills the view past the ground. Lit (the default) the sun, its shadow and the mist reach it; on a light texture its shadow ends at straight screen-aligned edges. Unlit it takes no shadow but shows its colour flat, and the mist can\'t tint it. MM\'s pick: lit black.'));
    if (bd) {
      const t = bd.texture && typeof bd.texture === 'object' ? bd.texture : null;
      const setTex = ref => edit(() => { const b = sub('backdrop'); if (b) b.texture = ref; });
      const ctl = h('span', { class: 'vcol' });
      if (!t || t.rgb) ctl.append(h('input', { type: 'color', value: rgbHex(t && Array.isArray(t.rgb) ? t.rgb : [0, 0, 0]), 'data-v': 'void.backdrop.texture', title: 'One colour (rgb 0-255)', onchange: ev => setTex({ rgb: hexRgb(ev.target.value) }) }));
      if (ED.texButton) ctl.append(ED.texButton(t, setTex, ['colour', 'game', 'package', 'dirt'], 'The backdrop\'s texture'));
      pane.append(field('void.backdrop.texture', 'texture', ctl, 'One colour, a game texture, a PNG of the package or the procedural dirt; made opaque.'),
        num('void.backdrop.z', 'z (m)', () => sub('backdrop'), 'z', { min: -150, max: -1, step: 1 },
          '-150 to -1. Deep enough that the cliffs fade into the mist before they reach it.'),
        num('void.backdrop.scale', 'repeat (m)', () => sub('backdrop'), 'scale', { min: 1, max: 1400, step: 5, def: 175, optional: true },
          'The texture repeats every this many metres (1 to 1,400; empty: 175). A one-colour backdrop looks the same at any repeat.'),
        field('void.backdrop.unlit', 'light', h('select', { 'data-v': 'void.backdrop.unlit', onchange: ev => edit(() => { const b = sub('backdrop'); if (!b) return; if (ev.target.value === 'unlit') b.unlit = true; else delete b.unlit; }) },
          h('option', { value: 'lit', selected: !bd.unlit }, 'lit: the sun, shadows; the mist sees it'),
          h('option', { value: 'unlit', selected: !!bd.unlit }, 'unlit: no shadow, flat colour')), null));
    }

    const mi = sub('mist');
    pane.append(section('mist', 'mist: a see-through layer below the floor', PICK.mist,
      'This is what colours the void: what lies under the plane takes its colour, the more the deeper, fully at FogRange metres down (the cliff faces fade into it). The height fog below reaches neither backdrop, lit or unlit.'));
    if (mi) {
      pane.append(num('void.mist.z', 'z (m)', () => sub('mist'), 'z', { max: -0.01, step: 0.05 },
          'Below the floor (z 0: an error at or above it) and above the backdrop. A ford\'s water (z -0.22) more than 5 % of the range under it shows the tint (a warning); at -0.2 it stays clear.'),
        num('void.mist.range', 'FogRange (m)', () => sub('mist'), 'range', { min: 0.5, max: 1000, step: 1 },
          '0.5 to 1,000. The smaller, the sooner below the plane things take the full colour: at 10 the cliffs fade over their first metres and the void is the full colour; the user tried 40, 25, 5 and kept 10.'),
        colour('void.mist.color', 'colour', () => sub('mist'), 'color', 2,
          'Each 0 to 2 (the shader\'s DiffuseTint; the picker covers 0 to 1). The level\'s colour grading may shift what shows. MM\'s pick: RGB 119, 210, 219.'));
    }

    const fg = sub('fog');
    pane.append(section('fog', 'height fog: the environment\'s, for this map', FOG,
      'Darkens the cliffs and what stands low, towards its colour, from start down to end. It reaches neither backdrop (seen live): the void stays the backdrop\'s colour, so tint the void with the mist. Shipped: start 10, end -225, black.'));
    if (fg) {
      pane.append(num('void.fog.start', 'start (m)', () => sub('fog'), 'start', { min: -1000, max: 1000, step: 1 }, null),
        num('void.fog.end', 'end (m)', () => sub('fog'), 'end', { min: -1000, max: 1000, step: 1 }, 'The start above the end, each within 1,000 m of the floor.'));
      const own = Array.isArray(fg.color);
      pane.append(h('label', { class: 'vhead small' }, h('input', { type: 'checkbox', checked: own, 'data-v': 'void.fog.color:on', onchange: ev => edit(() => {
        const f = sub('fog');
        if (!f) return;
        if (ev.target.checked) f.color = [0, 0, 0]; else delete f.color;
      }) }), ' own colour (else the environment\'s, black)'));
      if (own) pane.append(colour('void.fog.color', 'colour', () => sub('fog'), 'color', 1, 'Each 0 to 1.'));
    }
    pane.append(h('p', { class: 'hint' }, 'The 3-D view draws the cut ground and the backdrop as the build makes them, and the mist as a tint by depth (its "mist" switch); the game\'s fog shader looks somewhat different, and the height fog isn\'t drawn there.'));
    placeFindings();
  }

  // placeFindings puts each void.* finding of the last check at the field whose path is the longest prefix of its own
  function placeFindings() {
    const fs = ((S.report && S.report.findings) || []).filter(f => f.path === 'void' || (f.path || '').startsWith('void.'));
    for (const f of fs) {
      let best = 'void';
      for (const k of Object.keys(slots)) if ((f.path === k || f.path.startsWith(k + '.') || f.path.startsWith(k + '[')) && k.length > best.length) best = k;
      slots[best].append(h('div', { class: 'vf ' + (f.severity || 'error'), 'data-rule': f.rule }, (f.severity === 'warning' ? 'warning ' : 'error ') + f.rule + ': ' + (f.message || '')));
    }
  }

  // ---- events --------------------------------------------------------------------------------------------

  let paneKey = '';
  const key = () => JSON.stringify([S.pkg, vd(), ((S.report && S.report.findings) || []).filter(f => (f.path || '').startsWith('void'))]);
  const refresh = () => { const k = key(); if (k !== paneKey) { paneKey = k; renderPane(); } };
  ED.on('doc', refresh);
  ED.on('checked', refresh);
  ED.on('open', () => { paneKey = ''; refresh(); });
  ED.on('focus-void', path => {
    refresh();
    let best = null;
    for (const el of pane.querySelectorAll('[data-path]')) {
      const p = el.dataset.path;
      if ((path === p || path.startsWith(p + '.')) && (!best || p.length > best.dataset.path.length)) best = el;
    }
    (best || sec).scrollIntoView({ block: 'nearest' });
    const inp = best && best.querySelector('input, select');
    if (inp) inp.focus();
  });
  renderPane();

  // ---- the self-test (?selftest=void on any map; =void-save saves the map with the pick's void at the end) --------
  // On CM_Pass (its void): the fields show it and the 3-D view tints the void; through the panel's own inputs: the
  // mist moved above the floor (void.mist-floor at its field), the mist's colour, the unlit backdrop (void.mist-unlit),
  // the height fog on and broken (void.fog), the void off and on again (the pick); the flush lift of a placed plinth.

  async function selftest(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const inp = path => pane.querySelector(`[data-v="${path}"]`);
    const set = (path, value) => { const el = inp(path); if (!el) return false; if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change')); return true; };
    const shown = (path, rule) => { const el = pane.querySelector(`.vfield[data-path="${path}"] .vf[data-rule="${rule}"], .vsec[data-path="${path}"] .vf[data-rule="${rule}"]`) || (path === 'void' && [...slots.void.children].find(x => x.dataset.rule === rule)); return !!el; };
    const rules = () => ((S.report && S.report.findings) || []).map(f => f.rule + '@' + f.path);
    let ok = true;
    await settle();
    const had = vd() ? JSON.stringify(vd()) : '';
    ok &= say(S.report && S.report.ok, `opened ${S.pkg}: ${S.report && S.report.ok ? 'passes' : rules().join(' ')}; ${had ? 'its void ' + had : 'no void'}`);
    if (!had) {
      set('void:on', true);
      await settle();
      ok &= say(JSON.stringify(vd()) === JSON.stringify(PICK) && S.report.ok, 'void switched on: the pick ' + JSON.stringify(vd()) + ', ' + (S.report.ok ? 'passes' : rules().join(' ')));
    }
    // the fields show the section (v: a copy; the edits below change the document's objects in place)
    const v = clone(vd());
    ok &= say(inp('void:on').checked && +inp('void.cut').value === v.cut && +inp('void.backdrop.z').value === v.backdrop.z &&
      +inp('void.mist.z').value === v.mist.z && +inp('void.mist.range').value === v.mist.range && inp('void.mist.color').value === toHex(v.mist.color) &&
      inp('void.backdrop.unlit').value === (v.backdrop.unlit ? 'unlit' : 'lit') && !inp('void.fog.start') === !v.fog,
    `the fields: cut ${inp('void.cut').value}, backdrop z ${inp('void.backdrop.z').value} (${inp('void.backdrop.unlit').value}, ${inp('void.backdrop.texture') ? inp('void.backdrop.texture').value : 'texture'}), mist z ${inp('void.mist.z').value}, range ${inp('void.mist.range').value}, colour ${inp('void.mist.color').value}; fog ${v.fog ? 'on' : 'off'}`);
    // the 3-D view: the ground export with its backdrop and mist planes, the void tinted by the mist past the square
    V3D.activate();
    const ground = () => V3D.V.models.get(V3D.V.groundUrl);
    ok &= say(await V3D.until(() => V3D.settled() && ground() && ground().ready && V3D.V.groundKey === V3D.groundKey(), 240000), '3-D: the scene and the ground loaded');
    const g = ground(), mats = g ? g.draws.map(d => d.mat.shader) : [];
    ok &= say(g && g.draws.some(d => V3D.isFogFace(d.mat)),
      `3-D: the ground's ${g ? g.draws.length : 0} draws, ${g ? g.triangles : 0} triangles, shaders ${[...new Set(mats)].join(', ')} (the mist plane on labsFogFace, not drawn)`);
    const half = (+S.doc.size || 400) / 2, w = [0, -(half + 40), v.backdrop.z]; // past the square: only the backdrop
    V3D.gameCamera();
    V3D.setTarget(w[0], w[1]);
    const mean = b => { const s = [0, 0, 0]; for (let k = 0; k < b.length; k += 4) for (let i = 0; i < 3; i++) s[i] += b[k + i]; return s.map(x => Math.round(x / (b.length / 4))); };
    const on = mean(V3D.readAt(w, 8));
    V3D.V.mist = false;
    const off = mean(V3D.readAt(w, 8));
    V3D.V.mist = true;
    const want = v.mist.color.map(x => Math.round(Math.min(1, x) * 255));
    ok &= say(on.every((x, i) => Math.abs(x - want[i]) <= 12) && Math.max(...off) <= 40,
      `3-D: the void at (${w.map(x => x.toFixed(0))}) with the mist rgb ${on} (the mist's ${want}), without it ${off} (the black backdrop)`);
    // a broken mist through its field: above the floor
    set('void.mist.z', '0.1');
    await settle();
    ok &= say(vd().mist.z === 0.1 && !S.report.ok && shown('void.mist.z', 'void.mist-floor'), 'mist z 0.1: ' + rules().join(' ') + ', shown at the mist\'s z');
    undo();
    await settle();
    ok &= say(vd().mist.z === v.mist.z && S.report.ok, 'undo: mist z ' + vd().mist.z + ', passes');
    // the mist's colour through the picker: the void turns red in 3-D
    set('void.mist.color', '#ff0000');
    const red = mean(V3D.readAt(w, 8));
    ok &= say(JSON.stringify(vd().mist.color) === '[1,0,0]' && red[0] > 200 && red[1] < 40 && red[2] < 40, 'mist colour #ff0000: ' + JSON.stringify(vd().mist.color) + ', the void in 3-D rgb ' + red);
    undo();
    // the backdrop unlit: the mist can't see it (a warning at the mist)
    set('void.backdrop.unlit', 'unlit');
    await settle();
    ok &= say(vd().backdrop.unlit === true && S.report.ok && shown('void.mist', 'void.mist-unlit'), 'backdrop unlit: ' + rules().join(' ') + ', the warning at the mist');
    undo();
    // the height fog: on (the shipped values), then its end above its start
    set('void.fog:on', true);
    await settle();
    ok &= say(JSON.stringify(vd().fog) === JSON.stringify(FOG) && S.report.ok && !!inp('void.fog.start'), 'height fog on: ' + JSON.stringify(vd().fog) + ', passes');
    set('void.fog.end', '20');
    await settle();
    ok &= say(!S.report.ok && shown('void.fog', 'void.fog'), 'fog end 20 over start 10: ' + rules().join(' ') + ', shown at the fog');
    set('void.fog.color:on', true);
    set('void.fog.color', '#4d5773');
    ok &= say(JSON.stringify(vd().fog.color) === '[0.302,0.341,0.451]', 'fog colour ' + JSON.stringify(vd().fog.color));
    undo(); undo(); undo(); undo();
    await settle();
    ok &= say(!vd().fog && S.report.ok, 'four undos: no fog, passes');
    // a cut without its backdrop
    set('void.backdrop:on', false);
    await settle();
    ok &= say(!vd().backdrop && !S.report.ok && shown('void', 'void.backdrop'), 'backdrop off with the cut: ' + rules().join(' ') + ', shown at the top');
    undo();
    // the section off and on: off removes it, on writes the pick
    set('void:on', false);
    await settle();
    ok &= say(!S.doc.void && S.report.ok, 'void off: no section, passes');
    undo();
    await settle();
    ok &= say(JSON.stringify(vd()) === JSON.stringify(v) && S.report.ok, 'undo: the void back as it was');
    // the flush lift: a plinth (its top at its model's z 0) placed stands 0.05 m up; moved from z 0 it is lifted, a
    // height of the author's is kept; at z 0 the check warns (props.flush)
    if (PR.P.state === 'ready' && PR.info('darius_tower_binding')) {
      const at = [-60, -150];
      PR.placeNoun('darius_tower_binding', at, 0);
      const k = S.doc.props.length - 1, c = () => S.doc.props[k];
      ok &= say(c().pos[2] === 0.05 && !!document.querySelector('#inspector [data-flush]'), 'plinth placed: pos ' + JSON.stringify(c().pos) + ', the inspector says why');
      await settle();
      ok &= say(!rules().some(r => r.startsWith('props.flush')), 'its check: ' + (rules().join(' ') || 'no findings'));
      edit(() => { c().pos = [at[0], at[1]]; });
      await settle();
      ok &= say(rules().some(r => r.startsWith('props.flush@props[' + k + ']')), 'at z 0 the check warns: ' + rules().join(' '));
      edit(() => PR.setPos(c(), [at[0] + 2, at[1]]));
      ok &= say(c().pos[2] === 0.05, 'moved from z 0: pos ' + JSON.stringify(c().pos));
      edit(() => { c().pos = [at[0], at[1], -0.081]; PR.setPos(c(), [at[0] + 4, at[1]]); });
      ok &= say(c().pos[2] === -0.081, 'a height of the author\'s kept through a move: pos ' + JSON.stringify(c().pos));
      for (let i = 0; i < 4; i++) undo();
      await settle();
      ok &= say(S.doc.props.length === k && S.report.ok, 'four undos: the plinth gone, passes');
    } else say(true, 'the flush lift skipped: no nouns (start the editor with -copy)');
    if (mode === 'void-save') {
      if (!vd()) { set('void:on', true); await settle(); }
      const r = await save();
      ok &= say(r && r.ok, 'saved: ' + JSON.stringify(r && { written: r.written, sha256: r.sha256 }));
    }
    say(ok, ok ? 'selftest void passed' : 'selftest void failed');
    document.title = ok ? 'selftest void passed' : 'selftest void failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.void = selftest;
  ED.selftests['void-save'] = selftest;

  return { PICK, FOG, renderPane };
})();

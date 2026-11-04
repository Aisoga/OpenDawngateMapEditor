// camps.js: the jungle camps by name. Units > Add a Camp lists the camp types the map format offers (the original map's
// camp spawners: map.json's camps[].kind and noun). A click on a type arms the tool, showing a ghost at the mouse; a
// click on the map places one camp and goes back to Select, the new camp selected. The selected camp's Type changes it,
// and Ctrl+D, Ctrl+C, Ctrl+X and Ctrl+V copy it. The 2-D view and the lists show each type in its colour.
// What is written is the same map.json a hand would write; docs/making-maps.md lists the same table for its authors.
// ED.camps is what app.js, frame.js and feedback.js ask.
(function () {
  // the buffs' and the pigs' colours are the ones the game's jungle tags have in the map's layers
  const SMALL = '#c7b38a';
  const TYPES = [
    { id: 'green', name: 'Green buff', sub: 'Power', kind: 'buff', noun: 'SpawnPoint_v5_Buff_Fish.Noun', color: '#3fd45f',
      tip: 'Two small fish and a big one. Killing the big one gives its killer Power for 150 seconds.' },
    { id: 'blue', name: 'Blue buff', sub: 'Haste', kind: 'buff', noun: 'SpawnPoint_v5_Buff_Fungus.Noun', color: '#4f7dff',
      tip: 'Two small mushrooms and a big one. Killing the big one gives its killer Haste for 150 seconds.' },
    { id: 'orange', name: 'Orange buff', sub: 'Armor', kind: 'buff', noun: 'SpawnPoint_v5_Buff_Ugger.Noun', color: '#ff9a2e',
      tip: 'A small Ugger and a big one. Killing the big one gives its killer armor for 150 seconds.' },
    { id: 'fish', name: 'Fish camp', sub: 'small', kind: 'camp', noun: 'SpawnPoint_v5_CreepsFish.Noun', color: SMALL,
      tip: 'A small camp: three fish. No buff.' },
    { id: 'mushroom', name: 'Mushroom camp', sub: 'small', kind: 'camp', noun: 'SpawnPoint_v5_CreepsFungus.Noun', color: SMALL,
      tip: 'A small camp: four mushrooms. No buff.' },
    { id: 'ugger', name: 'Ugger camp', sub: 'small', kind: 'camp', noun: 'SpawnPoint_v5_CreepsUgger.Noun', color: SMALL,
      tip: 'A small camp: two Uggers. No buff.' },
    { id: 'pigs', name: 'Gold Pigs', sub: 'big, gold', kind: 'buff', noun: 'SpawnPoint_v5_CreepsBoar.Noun', color: '#ff69b4',
      tip: 'Two boars worth the most gold of any camp. They come late and respawn slowly. No buff.' },
    { id: 'parasite', name: 'Parasite', sub: 'one a map', kind: 'parasite', noun: 'SpawnPoint_Objective_Titan.Noun', color: '#aa28f0', once: true,
      tip: 'The big objective in the middle of the map. A map has one, and it has no mirror: keep it within 30 m of the centre.' },
  ];
  const UNKNOWN = '#ff5d5d'; // a camp whose noun no type has: blank, or written by hand
  const RED = '#ff6b6b';
  const ROOM = 9; // about how far a camp's creatures stand from its centre (the rule camps.spots)
  const ON_TOP = 4; // closer than this to another camp is a slip (a double click), not a place
  const OFF_CENTRE = 30; // mapc's ParasiteOffCentre
  const COPY_AT = 20; // how far Ctrl+D looks for its copy's place

  const camps = () => (S.doc && Array.isArray(S.doc.camps) ? S.doc.camps : []);
  const bareNoun = n => String(n || '').toLowerCase().replace(/\.noun$/, '');
  const typeOf = c => (c ? TYPES.find(t => bareNoun(t.noun) === bareNoun(c.noun)) : null) || null;
  const byId = id => TYPES.find(t => t.id === id) || TYPES[0];
  const current = () => byId(S.campType);
  const hasParasite = skip => camps().some((c, i) => i !== skip && c && c.kind === 'parasite');
  function labelOf(c) {
    const t = typeOf(c);
    if (t) return t.name;
    return c && c.noun ? String(c.noun).replace(/^SpawnPoint_(v5_|Objective_)?/, '').replace(/\.Noun$/, '') : 'Camp: choose its type';
  }
  const colorOf = c => { const t = typeOf(c); return t ? t.color : UNKNOWN; };

  // ---- where a camp goes ---------------------------------------------------------------------------------------
  // placement: where a camp of the type stands for the world point w, and what refuses it. Only team 1's half is
  // written, so a point on team 2's half places its source at the mirror and the twin stands at w; the parasite has no
  // twin, so it goes to the nearest point on team 1's side of the mirror line.
  function placement(w, once, skip) {
    let p = [r1(w[0]), r1(w[1])], twin = false;
    if (p[0] + p[1] > 0) {
      if (once) {
        const s = (p[0] + p[1]) / 2;
        p = [r1(p[0] - s), r1(p[1] - s)];
        if (p[0] + p[1] > 0) p[0] = r1(p[0] - 0.1);
      } else { p = mir(p); twin = true; }
    }
    let bad = ED.placeFails ? ED.placeFails('camp', p)[0] : null;
    if (!bad && !once && Math.hypot(p[0], p[1]) < ON_TOP / 2) bad = { rule: 'camps', why: 'on its own mirror: move it off the centre' };
    if (!bad && camps().some((c, i) => i !== skip && c && isPt(c.pos) && Math.hypot(c.pos[0] - p[0], c.pos[1] - p[1]) < ON_TOP)) bad = { rule: 'camps', why: 'on top of another camp' };
    return { p, twin, bad: bad || null };
  }
  function added(fields, p, what) {
    edit(d => {
      d.camps = Array.isArray(d.camps) ? d.camps : [];
      d.camps.push(Object.assign({}, fields, { pos: p }));
    });
    select({ t: 'obj', path: ['camps', S.doc.camps.length - 1, 'pos'] });
    log(`${what} at (${p[0]}, ${p[1]})` + (fields.kind === 'parasite' ? '; it has no mirror' : `; team 2's mirror at (${-p[0]}, ${-p[1]})`) + '. Drag it to move it.');
  }
  // place: the armed tool's click. One click, one camp: the tool goes back to Select, the new camp selected, so the next
  // drag moves it instead of placing another one.
  function place(w) {
    const t = current();
    if (t.once && hasParasite()) { log('the map already has its parasite: delete that one first', 'err'); setTool('select'); return false; }
    const pl = placement(w, t.once);
    if (pl.bad) { if (ED.flashRefusal) ED.flashRefusal(pl.bad, pl.twin ? mir(pl.p) : pl.p); return false; }
    added({ kind: t.kind, noun: t.noun }, pl.p, t.name + ' placed');
    setTool('select');
    return true;
  }
  // the parasite's button while the map has one: it goes to that one, which can be dragged or deleted
  function showParasite() {
    const i = camps().findIndex(c => c && c.kind === 'parasite');
    if (i < 0) return;
    if (S.tool !== 'select') setTool('select');
    select({ t: 'obj', path: ['camps', i, 'pos'] });
    ED.centre(camps()[i].pos);
    log('a map has one parasite: this is it. Drag it to move it, or press Del to place a new one.');
  }
  function arm(id) {
    const t = byId(id);
    if (S.tool === 'camp' && S.campType === t.id) { setTool('select'); return; } // its button again: off
    S.campType = t.id;
    setTool('camp');
  }
  const hint = t => (t.once
    ? `Click near the centre to place the ${t.name}: a map has one, and it has no mirror. Esc cancels.`
    : `Click the map to place ${/ Pigs$/.test(t.name) ? 'the' : /^[AEIOU]/.test(t.name) ? 'an' : 'a'} ${t.name}${/ camp$| Pigs$/.test(t.name) ? '' : ' camp'}: team 2 gets its mirror. Esc cancels.`);

  // the lines beside the mouse while the tool is armed (feedback.js's measurements)
  function hoverLines(w) {
    const t = current(), pl = placement(w, t.once), out = [{ t: t.name }];
    if (pl.bad) out.push({ t: `can't go here: ${pl.bad.why}`, bad: true });
    else if (t.once && Math.hypot(pl.p[0], pl.p[1]) > OFF_CENTRE) out.push({ t: `${Math.round(Math.hypot(pl.p[0], pl.p[1]))} m from the centre: keep it within ${OFF_CENTRE} m`, bad: true });
    return out;
  }
  // the ghost: the camp where a click puts it, the room its creatures take, and the twin. Red where it can't go.
  function drawPlacing(v) {
    if (S.tool !== 'camp' || !S.doc || !S.mouseW || S.drag) return;
    const t = current(), snap = ED.snapNow ? ED.snapNow() : null, pl = placement(snap ? snap.p : S.mouseW, t.once);
    const g = v.overlay, col = pl.bad ? RED : t.color, at = pl.twin ? mir(pl.p) : pl.p;
    g.save();
    g.strokeStyle = col;
    g.lineWidth = 2 * dpr;
    g.setLineDash([5 * dpr, 4 * dpr]);
    vring(v, at, ROOM); g.stroke();
    if (!t.once) {
      g.globalAlpha = 0.5;
      vring(v, mir(at), ROOM); g.stroke();
      vmark(v, mir(at), 'round', 5, col);
      g.globalAlpha = 1;
    }
    g.setLineDash([]);
    vmark(v, at, 'round', 7, col);
    g.restore();
  }
  ED.previews.push(drawPlacing);

  // ---- the palette ---------------------------------------------------------------------------------------------
  const body = ED.addPane('units', 'Add a Camp', 5);
  body.parentNode.id = 'paneCamps';
  function renderPane() {
    body.textContent = '';
    body.parentNode.hidden = !S.doc;
    if (!S.doc) return;
    const armed = S.tool === 'camp', grid = h('div', { class: 'camptypes' });
    for (const t of TYPES) {
      const taken = t.once && hasParasite();
      grid.append(h('button', { class: (taken ? 'taken ' : '') + (armed && S.campType === t.id ? 'on' : ''), 'data-camp': t.id,
        title: taken ? 'The map already has its parasite: click to go to it' : t.tip, onclick: () => (taken ? showParasite() : arm(t.id)) },
      h('span', { class: 'dot', style: 'background:' + t.color }), h('span', { class: 'nm' }, t.name), h('span', { class: 'we' }, t.sub)));
    }
    body.append(grid, h('div', { class: 'note' }, armed ? hint(current()) : 'Pick one, then click the map. Team 2 gets its mirror.'));
    body.parentNode.classList.toggle('armed', armed);
  }
  ED.on('tool', t => {
    if (t === 'camp') $('toolHint').textContent = hint(current());
    renderPane();
  });
  ED.on('doc', renderPane);
  ED.on('open', renderPane);
  ED.on('tab', renderPane);

  // showAdd takes the user to Add a Camp from anywhere: the Units tab, the pane in view, a short pulse round it. The Map
  // menu's item and the left panel's link lead here, and so does deleting a camp.
  let attnTimer = null;
  function showAdd() {
    if (!S.doc) return;
    ED.setTab('units');
    const g = body.parentNode;
    g.scrollIntoView({ block: 'nearest' });
    g.classList.remove('attn');
    void g.offsetWidth; // a new pulse if one is running
    g.classList.add('attn');
    clearTimeout(attnTimer);
    attnTimer = setTimeout(() => g.classList.remove('attn'), 2600);
  }
  ED.actions['map.addCamp'] = showAdd;
  // a camp deleted (Del, or its Delete button): where its replacement comes from, so nobody has to look for it. The
  // whole sentence goes over the view, where the tools' hints are; the status bar has room for the short one only.
  const DELETED_HINT = 'Camp deleted. Pick a new one in Add a Camp on the right, or press Ctrl+Z to undo.';
  let tipTimer = null;
  function deleted() {
    showAdd();
    log('Camp deleted. Ctrl+Z undoes it.', 'tip');
    const el = $('toolHint');
    if (S.tool !== 'select') return; // a tool's own hint stays
    el.textContent = DELETED_HINT;
    el.style.display = '';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { if (el.textContent === DELETED_HINT && S.tool === 'select') el.style.display = 'none'; }, 6000);
  }

  // ---- the selected camp ---------------------------------------------------------------------------------------
  function setType(i, id) {
    const t = byId(id);
    edit(d => { d.camps[i].kind = t.kind; d.camps[i].noun = t.noun; });
  }
  function typeSelect(i, c) {
    const t = typeOf(c), other = hasParasite(i);
    const known = TYPES.map(x => h('option', { value: x.id, selected: t === x ? 'selected' : null, disabled: x.once && other ? 'disabled' : null },
      x.name + (x.once && other ? ' (the map has one)' : ` (${x.sub})`)));
    const first = t ? null : h('option', { value: '', selected: 'selected', disabled: 'disabled' }, c.noun ? 'Other: ' + labelOf(c) : 'Choose a type...');
    return h('label', { class: 'camptype' }, 'Type ', h('select', { 'data-camp-type': i, onchange: ev => setType(i, ev.target.value) }, first, ...known));
  }
  function inspector(el, s) {
    const i = s.path[1], c = camps()[i], t = typeOf(c), p = c.pos, once = c.kind === 'parasite';
    el.append(h('p', { class: 'small' }, t ? t.tip : c.noun ? 'A camp the editor has no name for: it comes from the map\'s text.' : 'This camp has no creatures yet: choose its type below.'));
    el.append(typeSelect(i, c), xyInputs(() => getAt(S.doc, s.path), q => setPoint(s.path, q)));
    el.append(h('p', { class: 'small' }, once ? 'It stands once: no mirror.' : `Team 2's mirror at (${-p[0]}, ${-p[1]}).`));
    el.append(joinedNote(s));
    el.append(h('div', { class: 'btns' }, once ? null : h('button', { title: 'Ctrl+D', 'data-camp-duplicate': i, onclick: duplicate }, 'Duplicate'),
      h('button', { title: 'Del', onclick: deleteSel }, 'Delete')));
    el.append(jsonEditor(c, v => setAt(S.doc, ['camps', i], v)));
  }

  // ---- duplicate, copy and paste -------------------------------------------------------------------------------
  let clip = null; // the copied camp's kind and noun; null when the last copy was something else
  const selectedCamp = () => {
    const s = S.sel;
    return s && s.t === 'obj' && Array.isArray(s.path) && s.path[0] === 'camps' ? camps()[s.path[1]] : null;
  };
  // a place for a copy: beside the camp, on open ground with room for its creatures if there is one
  function copyPlace(c) {
    const at = a => [r1(c.pos[0] + COPY_AT * Math.cos(a)), r1(c.pos[1] + COPY_AT * Math.sin(a))];
    const angles = [-Math.PI / 4, -Math.PI / 2, 0, -3 * Math.PI / 4, Math.PI / 4, Math.PI, Math.PI / 2, 3 * Math.PI / 4];
    const free = q => q[0] + q[1] <= 0 && !placement(q, false).bad;
    const roomy = q => [0, 1, 2, 3, 4, 5, 6, 7].every(k => !ED.placeFails('camp', [r1(q[0] + ROOM * Math.cos(k * Math.PI / 4)), r1(q[1] + ROOM * Math.sin(k * Math.PI / 4))]).some(f => f.rule === 'fixed.open'));
    const ok = angles.map(at).filter(free);
    return ok.find(roomy) || ok[0] || null;
  }
  function duplicate() {
    const c = selectedCamp();
    if (!c || !isPt(c.pos)) return false;
    if (c.kind === 'parasite') { log('a map has one parasite, so it can\'t be duplicated', 'err'); return true; }
    const q = copyPlace(c), t = typeOf(c);
    if (q) { added({ kind: c.kind, noun: c.noun }, q, labelOf(c) + ' duplicated'); return true; }
    if (t) { // no room beside it: the same type on the mouse instead
      S.campType = t.id;
      setTool('camp');
      log('no free ground beside this camp: click where the copy goes');
    } else log('no free ground beside this camp: drag it first', 'err');
    return true;
  }
  function paste() {
    if (clip.kind === 'parasite' && hasParasite()) { log('the map already has its parasite: delete that one first', 'err'); return true; }
    const w = S.mouseW || [-20, -20], pl = placement(w, clip.kind === 'parasite');
    if (pl.bad) { if (ED.flashRefusal) ED.flashRefusal(pl.bad, pl.twin ? mir(pl.p) : pl.p); return true; }
    added(clip, pl.p, labelOf(clip) + ' pasted');
    return true;
  }
  function keys(e) {
    const ctl = e.ctrlKey || e.metaKey, k = String(e.key || '').toLowerCase();
    if (!ctl || e.altKey) return false;
    const c = selectedCamp();
    if (k === 'd' && c) { e.preventDefault(); return duplicate(); }
    if (k === 'c' || k === 'x') {
      if (!c) { if (S.sel) clip = null; return false; } // a doodad's copy (propsel.js) replaces the camp's
      e.preventDefault();
      clip = { kind: c.kind, noun: c.noun };
      log(`${k === 'x' ? 'cut' : 'copied'} ${labelOf(c)}; Ctrl+V pastes it at the mouse`);
      if (k === 'x') { // not deleteSel: whoever cuts is about to paste, so no pointer to Add a Camp
        const i = S.sel.path[1];
        edit(d => d.camps.splice(i, 1));
        select(null);
      }
      return true;
    }
    if (k === 'v' && clip) { e.preventDefault(); return paste(); }
    return false;
  }
  const inner = ED.keys;
  ED.keys = e => keys(e) || (inner ? inner(e) : false);

  ED.camps = { TYPES, typeOf, labelOf, colorOf, place, placement, hoverLines, inspector, arm, duplicate, current, showAdd, deleted };

  // ---- the self-test (?open=CM_Grove&selftest=camps): every type by name, nothing typed; every edit undone, nothing
  // saved. camps-save keeps one camp of every type and saves the map, for the compiler's build to read.
  async function selftest(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const press = (k, mods) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const btn = id => document.querySelector(`#tab_units [data-camp="${id}"]`);
    // a handler's exception doesn't reach the click() or dispatchEvent() that ran it: collected here, and any one fails
    const thrown = [];
    window.addEventListener('error', e => thrown.push(e.message));
    const finish = () => {
      ok &= say(!thrown.length, 'no uncaught error' + (thrown.length ? ': ' + thrown.join('; ') : ''));
      say(ok, ok ? 'selftest passed' : 'selftest failed');
      document.title = ok ? 'selftest passed' : 'selftest failed';
      document.body.dataset.selftest = ok ? 'passed' : 'failed';
    };
    const last = () => camps()[camps().length - 1];
    const kinds = ['camps.noun', 'camps.kind', 'camps.role', 'camps.parasite', 'nouns.exist'];
    const campFindings = () => (S.report.findings || []).filter(f => kinds.includes(f.rule) && f.severity === 'error');
    let ok = true;
    ok &= say(S.doc && S.report, 'opened ' + S.pkg);
    const start = JSON.stringify(S.doc);

    // finding it, as a newcomer starts: on the Terrain tab, no key known
    const onUnits = () => $('tab_units').classList.contains('on');
    const pulsing = () => document.getElementById('paneCamps').classList.contains('attn');
    const quiet = () => { press('t'); document.getElementById('paneCamps').classList.remove('attn'); };
    quiet();
    select(null);
    ok &= say(!onUnits(), 'the editor starts away from the Units tab');
    ok &= say([...document.querySelectorAll('[data-tab="units"]')].every(b => /camps/.test(b.title)), 'both Units buttons\' tooltips name the camps');
    const pointer = document.querySelector('#inspector [data-units-pointer]');
    ok &= say(pointer && /Camps/.test(pointer.textContent), 'with nothing selected, the left panel points at the Units tab: ' + (pointer ? pointer.textContent : ''));
    if (pointer) pointer.querySelector('a').click();
    ok &= say(onUnits() && pulsing(), 'its link opens the tab and pulses Add a Camp');
    quiet();
    document.querySelector('#menubar [data-menu="map"]').click();
    const item = [...document.querySelectorAll('#menuLayer .menu .it')].find(x => x.textContent.includes('Add a Camp'));
    ok &= say(!!item, 'the Map menu has Add a Camp');
    if (item) item.click();
    ok &= say(onUnits() && pulsing(), 'it opens the tab and pulses Add a Camp');
    quiet();
    const iDel = camps().findIndex(c => c && c.kind !== 'parasite');
    select({ t: 'obj', path: ['camps', iDel, 'pos'] });
    press('Delete');
    ok &= say(onUnits() && pulsing(), 'deleting a camp from another tab opens Units and pulses Add a Camp');
    ok &= say($('st4flash').classList.contains('tip') && $('st4flash').textContent.length <= 33, 'the status bar says so, short enough to read whole: ' + $('st4flash').textContent);
    ok &= say($('toolHint').style.display !== 'none' && /Add a Camp/.test($('toolHint').textContent), 'the line over the view says where a new one comes from: ' + $('toolHint').textContent);
    ok &= say($('st2').textContent.includes('Select'), 'and nothing is armed');
    btn('fish').click();
    ok &= say($('toolHint').textContent.includes('Fish camp'), 'arming a camp replaces that line');
    press('Escape');
    ok &= say($('toolHint').style.display === 'none', 'Esc clears it');
    press('z', { ctrlKey: true });
    ok &= say(JSON.stringify(S.doc) === start, 'Ctrl+Z brings it back');
    quiet();
    select({ t: 'obj', path: ['camps', iDel, 'pos'] });
    press('x', { ctrlKey: true });
    ok &= say(!onUnits() && !pulsing(), 'Ctrl+X, about to paste, stays on its tab');
    press('z', { ctrlKey: true });
    log('a real error', 'err');
    ok &= say(!$('st4flash').classList.contains('tip'), 'an error still reads as an error after a tip');
    press('u');

    // the palette: every type on a button, named; nothing to type
    ok &= say(TYPES.every(t => btn(t.id) && btn(t.id).textContent.includes(t.name)), 'Units > Add a Camp names all ' + TYPES.length + ' types');
    ok &= say(!document.querySelector('#tab_units [data-add="+ Camp"]'), 'no blank + Camp left');
    ok &= say(new Set(TYPES.map(t => bareNoun(t.noun))).size === TYPES.length, 'each type has a spawner of its own');

    // the parasite: one a map, its button says so
    const had = camps().findIndex(c => c && c.kind === 'parasite');
    let centre0 = [-3, 0];
    if (had >= 0) {
      centre0 = camps()[had].pos.slice();
      ok &= say(btn('parasite').classList.contains('taken'), 'the map has its parasite: its button is greyed');
      btn('parasite').click();
      ok &= say(S.tool === 'select' && S.sel && S.sel.path[1] === had && S.view.x === centre0[0] && S.view.y === centre0[1], 'and goes to the parasite instead of arming');
      fit();
      ok &= say(!document.querySelector('[data-camp-duplicate]'), 'the parasite has no Duplicate');
      press('d', { ctrlKey: true });
      ok &= say(camps().filter(c => c && c.kind === 'parasite').length === 1, 'Ctrl+D doesn\'t make a second parasite');
      deleteSel();
      ok &= say(!btn('parasite').classList.contains('taken'), 'deleted: its button is back');
    }

    // free ground, away from the camps there are
    const free = [], size = (+S.doc.size || 400) / 2 - 12;
    for (let x = -size; x <= 0 && free.length < 16; x += 6) {
      for (let y = -size; y <= size && free.length < 16; y += 6) {
        const q = [x, y];
        if (x + y > -8 || placement(q, false).bad) continue;
        if (free.every(f => Math.hypot(f[0] - x, f[1] - y) > 24) && camps().every(c => Math.hypot(c.pos[0] - x, c.pos[1] - y) > 24)) free.push(q);
      }
    }
    ok &= say(free.length >= 9, free.length + ' free places found');

    // every type: its button, the hint, a place, and it reads as the type everywhere
    for (const [i, t] of TYPES.entries()) {
      const n = camps().length;
      btn(t.id).click();
      ok &= say(S.tool === 'camp' && S.campType === t.id && btn(t.id).classList.contains('on') && document.getElementById('paneCamps').classList.contains('armed'), t.name + ': its button arms the tool');
      ok &= say($('toolHint').textContent.includes(t.name) && $('toolHint').style.display !== 'none', t.name + ': the hint names it: ' + $('toolHint').textContent);
      ok &= say(!!place(t.once ? centre0 : free[i]), t.name + ': placed');
      const c = last();
      ok &= say(camps().length === n + 1 && c.kind === t.kind && c.noun === t.noun, t.name + ': written as ' + JSON.stringify(c));
      ok &= say(S.tool === 'select' && S.sel && S.sel.path[1] === n, t.name + ': back to Select with the new camp selected');
      const row = [...document.querySelectorAll('#tab_units .li[data-kind="camp"]')].some(r => r.textContent.includes(t.name));
      ok &= say(row, t.name + ': the Units list says so');
      ok &= say($('st3').textContent.startsWith(t.name), t.name + ': the status bar says so: ' + $('st3').textContent);
      ok &= say($('selPreview').textContent.includes(t.name), t.name + ': the selection\'s preview says so');
      const sel = document.querySelector('[data-camp-type]');
      ok &= say(sel && sel.value === t.id, t.name + ': its Type shows it');
    }
    await settle();
    let fs = campFindings();
    ok &= say(!fs.length, 'the check takes every type: ' + (fs.length ? JSON.stringify(fs) : 'no camp errors'));
    ok &= say(btn('parasite').classList.contains('taken'), 'the parasite placed: its button is greyed again');
    const opts = () => [...document.querySelector('[data-camp-type]').options];
    select({ t: 'obj', path: ['camps', camps().length - 2, 'pos'] });
    ok &= say(opts().find(o => o.value === 'parasite').disabled, 'and greyed in another camp\'s Type');

    if (mode === 'camps-save') { // one of every type on the map, no other edit: the compiler builds this
      const r = await save();
      ok &= say(r, 'saved');
      finish();
      return;
    }

    // the mirror: a click on team 2's half lands where it was clicked
    const q2 = mir(free[9] || free[0]);
    btn('fish').click();
    const before2 = camps().length;
    if (say(!!place(q2), 'a camp placed on team 2\'s half')) {
      const c = last();
      ok &= say(c.pos[0] + c.pos[1] <= 0 && Math.abs(c.pos[0] + q2[0]) < 0.11 && Math.abs(c.pos[1] + q2[1]) < 0.11, 'written on team 1\'s half, its twin at the click: ' + JSON.stringify(c.pos));
    } else ok = false;
    press('z', { ctrlKey: true });
    ok &= say(camps().length === before2, 'Ctrl+Z takes it back');

    // the parasite's click past the mirror line stays on team 1's side, near the click
    const pp = placement([12, 14], true);
    ok &= say(pp.p[0] + pp.p[1] <= 0 && Math.abs(Math.hypot(pp.p[0] - 12, pp.p[1] - 14) - 13 * Math.SQRT2) < 0.2, 'the parasite past the mirror line goes to the nearest point on team 1\'s side: ' + JSON.stringify(pp.p));

    // refusals say why, and place nothing
    const n1 = camps().length;
    let wall = null;
    for (let x = -size; x <= 0 && !wall; x += 3) for (let y = -size; y <= 0 && !wall; y += 3) if (ED.placeFails('camp', [x, y]).some(f => f.rule === 'fixed.open')) wall = [x, y];
    btn('blue').click();
    if (wall) {
      ok &= say(!place(wall) && camps().length === n1 && S.tool === 'camp', 'on a wall: refused, the tool stays armed');
      ok &= say(hoverLines(wall).some(l => l.bad), 'the mouse\'s line says why: ' + JSON.stringify(hoverLines(wall)));
    }
    ok &= say(!place(camps()[0].pos) && camps().length === n1, 'on top of another camp: refused');
    press('Escape');
    ok &= say(S.tool === 'select', 'Esc cancels the tool');
    btn('blue').click();
    btn('blue').click();
    ok &= say(S.tool === 'select', 'its button again: off');

    // a real click through the page's own pipeline
    if (free[10] || free[9]) {
      const pt = free[10] || free[9], r = cv.getBoundingClientRect();
      btn('ugger').click();
      S.view.scale *= 3; S.view.x = pt[0]; S.view.y = pt[1]; render();
      const s = w2s(pt), n2 = camps().length;
      cv.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + s[0] / dpr, clientY: r.top + s[1] / dpr, button: 0, bubbles: true }));
      cv.dispatchEvent(new MouseEvent('mouseup', { clientX: r.left + s[0] / dpr, clientY: r.top + s[1] / dpr, button: 0, bubbles: true }));
      ok &= say(camps().length === n2 + 1 && typeOf(last()).id === 'ugger', 'a real click places it: ' + JSON.stringify(last()));
      press('z', { ctrlKey: true });
      fit();
    }

    // the selected camp's Type: both fields follow, one undo
    const iT = camps().findIndex(c => c && typeOf(c) && typeOf(c).id === 'fish');
    select({ t: 'obj', path: ['camps', iT, 'pos'] });
    const pick = id => { const s = document.querySelector('[data-camp-type]'); s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('orange');
    ok &= say(camps()[iT].kind === 'buff' && camps()[iT].noun === byId('orange').noun, 'Type > Orange buff: kind and noun follow: ' + JSON.stringify(camps()[iT]));
    press('z', { ctrlKey: true });
    ok &= say(typeOf(camps()[iT]).id === 'fish', 'Ctrl+Z restores the type');

    // a camp from the text with no noun, or one the editor has no name for
    const n3 = camps().length;
    edit(d => d.camps.push({ kind: 'camp', noun: '', pos: free[11] || free[8] }));
    select({ t: 'obj', path: ['camps', n3, 'pos'] });
    ok &= say(labelOf(last()) === 'Camp: choose its type' && document.querySelector('[data-camp-type]').value === '', 'a camp with no noun asks for its type');
    pick('mushroom');
    ok &= say(typeOf(last()).id === 'mushroom' && last().kind === 'camp', 'chosen: ' + JSON.stringify(last()));
    press('z', { ctrlKey: true });
    edit(d => { d.camps[n3].noun = 'SpawnPoint_v5_Whatever.Noun'; });
    ok &= say(labelOf(last()) === 'Whatever', 'a noun with no name keeps its own: ' + labelOf(last()));
    press('z', { ctrlKey: true });
    press('z', { ctrlKey: true });

    // Duplicate, Ctrl+D and the menu's route; copy, cut and paste at the mouse
    const iD = camps().findIndex(c => c && typeOf(c) && typeOf(c).id === 'green');
    select({ t: 'obj', path: ['camps', iD, 'pos'] });
    const n4 = camps().length, from = camps()[iD].pos.slice();
    press('d', { ctrlKey: true });
    if (say(camps().length === n4 + 1, 'Ctrl+D duplicates a camp')) {
      const c = last();
      ok &= say(typeOf(c).id === 'green' && c.kind === 'buff' && S.sel.path[1] === n4, 'the copy is the same type, and selected: ' + JSON.stringify(c));
      ok &= say(Math.hypot(c.pos[0] - from[0], c.pos[1] - from[1]) > ON_TOP && !ED.placeFails('camp', c.pos).length, 'beside the original, on open ground');
      press('z', { ctrlKey: true });
    } else ok = false;
    select({ t: 'obj', path: ['camps', iD, 'pos'] });
    document.querySelector('[data-camp-duplicate]').click();
    ok &= say(camps().length === n4 + 1, 'its Duplicate button too');
    press('z', { ctrlKey: true });
    select({ t: 'obj', path: ['camps', iD, 'pos'] });
    press('c', { ctrlKey: true });
    S.mouseW = (free[12] || free[8]).slice();
    press('v', { ctrlKey: true });
    ok &= say(camps().length === n4 + 1 && typeOf(last()).id === 'green' && Math.hypot(last().pos[0] - S.mouseW[0], last().pos[1] - S.mouseW[1]) < 0.11, 'Ctrl+C, Ctrl+V: a copy at the mouse');
    press('x', { ctrlKey: true });
    ok &= say(camps().length === n4 && !S.sel, 'Ctrl+X cuts it');
    press('v', { ctrlKey: true });
    ok &= say(camps().length === n4 + 1 && typeOf(last()).id === 'green', 'Ctrl+V brings it back');

    // the mirror's words: the parasite says it has none
    const iP = camps().findIndex(c => c && c.kind === 'parasite');
    select({ t: 'obj', path: ['camps', iP, 'pos'] });
    ok &= say($('inspector').textContent.includes('no mirror') && !$('inspector').textContent.includes('Team 2\'s mirror'), 'the parasite\'s info says it has no mirror');
    ok &= say(objects().find(o => o.path && o.path[1] === iP).once === true, 'and the views draw no twin for it');
    select({ t: 'obj', path: ['camps', iD, 'pos'] });
    ok &= say($('inspector').textContent.includes('Team 2\'s mirror') && !!$('inspector').querySelector('details.adv textarea'), 'a camp\'s info names its mirror, the JSON stays under Advanced');

    // the JSON stays for whoever wants it
    const ta = $('inspector').querySelector('details.adv textarea');
    ta.value = JSON.stringify({ kind: 'camp', noun: byId('ugger').noun, pos: camps()[iD].pos });
    [...$('inspector').querySelectorAll('details.adv button')].find(b => b.textContent === 'Apply JSON').click();
    ok &= say(typeOf(camps()[iD]).id === 'ugger', 'Apply JSON still works');
    press('z', { ctrlKey: true });

    // every edit undone
    while (S.undo.length) undo();
    ok &= say(JSON.stringify(S.doc) === start, 'every edit undone');
    await settle();
    fs = campFindings();
    ok &= say(!fs.length, 'the check after: no camp errors');
    finish();
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.camps = selftest;
  ED.selftests['camps-save'] = selftest;

  // ?pose7=<name> (CM_Grove, &tab=units): the page left mid-edit for a picture: armed (the ghost and its twin on open
  // ground), team2 (the same with the mouse on team 2's half), refused (the ghost on a wall), selected (a camp's info);
  // deleted (with &tab=terrain) a camp just deleted, its pulse and status line held for the picture
  const POSE7 = new URLSearchParams(location.search).get('pose7');
  ED.on('started', () => {
    if (!POSE7 || !S.doc) return;
    if (POSE7 === 'deleted') {
      select({ t: 'obj', path: ['camps', 0, 'pos'] });
      deleteSel();
      clearTimeout(attnTimer);
      clearTimeout(tipTimer);
      clearTimeout(log.timer);
      return;
    }
    const size = (+S.doc.size || 400) / 2 - 12;
    const find = test => { for (let x = -size; x <= 0; x += 3) for (let y = -size; y <= 0; y += 3) if (x + y < -60 && test([x, y])) return [x, y]; return [-120, -120]; };
    if (POSE7 === 'selected') {
      const i = camps().findIndex(c => c && c.kind === 'buff');
      if (i >= 0) select({ t: 'obj', path: ['camps', i, 'pos'] });
    } else {
      arm(POSE7 === 'refused' ? 'blue' : 'green');
      const p = find(q => (POSE7 === 'refused') === ED.placeFails('camp', q).some(f => f.rule === 'fixed.open') && (POSE7 === 'refused' || !placement(q, false).bad));
      S.mouseW = POSE7 === 'team2' ? mir(p) : p;
      render();
    }
  });
})();

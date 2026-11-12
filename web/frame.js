// The editor's frame, after the Warcraft III World Editor's: the menu bar (File, Edit, View, Layer, Map, Tools,
// Advanced, Help) with every key shown, the toolbar, the minimap with the selection's preview and info below it, one
// main view switched between 2-D and 3-D (Tab), the palettes docked on the right as tabs (Terrain T, Doodads D,
// Units U, Lanes L), the four-part status bar (the cursor, the tool, the selection, the check and Test) and the
// Messages window (View > Messages, closed by default).
//
// It uses app.js's globals (S, ED, edit, select, setTool, render, fit, h, log, ...) and the parts' actions
// (ED.actions[name], ED.flags[name]: ground.js, props.js, propsel.js, void.js, view3d.js register theirs). A menu item
// whose action no part registered is greyed. The Units and Lanes tabs and the Terrain tab's Draw with, Apply (the
// Texture | Cliff switch) and Apply Cliff groups are here; Apply Texture and the draw mode's settings are ground.js's,
// Apply Height heights.js's, the Doodads tab props.js's.
'use strict';

const FR = (() => {
  const URLQ = new URLSearchParams(location.search); // read at load: opening a map rewrites the URL
  const F = {
    tab: 'terrain', menu: null,
    // Space switches between Select and the tab's last tool
    lastTool: { terrain: 'shape', doodads: 'prop', units: 'select', lanes: 'select' },
    player: 'all', // the Units tab's player selector
    lane: 0, // the Lanes tab's lane (an index into lanes())
    minimap: { img: null, src: '' },
  };
  ED.flags = ED.flags || {};
  const TOOL_TAB = { shape: 'terrain', paint: 'terrain', stamp: 'terrain', prop: 'doodads', scatter: 'doodads', paste: 'doodads',
    well: 'units', camp: 'units', ward: 'units' };
  const TOOL_NAME = { select: 'Select', shape: 'Apply Cliff', well: '+ Well', camp: 'Add a Camp', ward: '+ Ward spot',
    prop: 'Place a doodad', scatter: 'Scatter', paste: 'Paste a group', paint: 'Apply Texture', stamp: 'Stamp' };
  const KIND = { locus: ['L', '#58a6ff'], guardian: ['G', '#58a6ff'], shop: ['S', '#58a6ff'], spawn: ['P', '#9cc8ff'],
    core: ['C', '#7fb2ff'], binding: ['B', '#7fb2ff'], spawner: ['M', '#f2b84b'], well: ['W', '#5fd38d'],
    camp: ['C', '#ff8f6b'], ward: ['w', '#c8a2ff'] };
  // the Apply Cliff kinds, with the World Editor's word beside ours
  const CLIFFS = [
    { id: 'chasm', name: 'Chasm', we: 'Lower', tip: 'Lowers the ground 5 m: seen across, never walked (the World Editor\'s Decrease One)' },
    { id: 'open', name: 'Open', we: 'Level', tip: 'Walkable ground at the floor\'s height (Same Level)' },
    { id: 'wall', name: 'Wall', we: 'Raise', tip: 'Raises the ground 5 m: blocks walking and sight (Increase One)' },
    { id: 'water', name: 'Water', we: 'Water', tip: 'A chasm with a water plane in its dip (Shallow Water)' },
    { id: 'island', name: 'Island', we: '-', tip: 'Ground only NPCs walk: a well on it is out of the players\' reach (no World Editor counterpart)' },
    { id: 'bush', name: 'Bush', we: '-', tip: 'Where champions hide: grass that blocks sight from outside (no counterpart)' },
  ];

  // ---- keys sent by the menus: the same handlers the keyboard reaches ---------------------------------------------
  function key(k, mods) {
    const o = Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {});
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', o));
  }
  const act = name => () => ED.act(name);
  const has = name => !!ED.actions[name];
  const flag = name => !!(ED.flags[name] && ED.flags[name]());

  // ---- tabs and views ---------------------------------------------------------------------------------------
  function setTab(t) {
    if (!$('tab_' + t)) return;
    F.tab = t;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.ptab').forEach(p => p.classList.toggle('on', p.id === 'tab_' + t));
    if (TOOL_TAB[S.tool] && TOOL_TAB[S.tool] !== t) setTool('select'); // no tool of a hidden palette stays armed
    renderPalettes();
    ED.emit('tab', t);
  }
  ED.setTab = setTab;
  function toggleView() { ED.setView(ED.view === '2d' ? '3d' : '2d'); }
  function spaceToggle() { // Space: Select <-> the palette's tool
    if (S.tool !== 'select') { setTool('select'); return; }
    const t = F.lastTool[F.tab];
    if (t && t !== 'select' && (t === 'shape' || ED.tools[t] || ['well', 'camp', 'ward'].includes(t))) setTool(t);
  }
  ED.on('tool', t => {
    $('btnSelect').classList.toggle('on', t === 'select');
    const tab = TOOL_TAB[t];
    if (tab) { F.lastTool[tab] = t; if (F.tab !== tab) setTab(tab); }
    renderPalettes();
    renderStatus();
  });

  // centre moves the main view to a world point (the 2-D view's centre, the 3-D camera's target)
  function centre(p) {
    if (!p) return;
    if (ED.view === '2d') { S.view.x = p[0]; S.view.y = p[1]; S.fitted = false; render(); } else if (typeof V3D !== 'undefined') V3D.setTarget(p[0], p[1]);
  }
  ED.centre = centre;
  function selPoint() {
    const v = selValue(S.sel);
    if (Array.isArray(v) && typeof v[0] === 'number') return v;
    if (v && Array.isArray(v.circle)) return v.circle;
    if (v && Array.isArray(v.pos)) return v.pos;
    if (v && Array.isArray(v.polygon) && v.polygon.length) return v.polygon[0];
    if (v && Array.isArray(v.path) && v.path.length) return v.path[0];
    if (v && Array.isArray(v.knots) && v.knots.length) return v.knots[Math.floor(v.knots.length / 2)];
    if (v && Array.isArray(v.centre)) return v.centre;
    const o = S.sel && S.sel.t === 'auto' && objects().find(x => x.auto && sameSel(objSel(x), S.sel));
    return o ? o.pos : null;
  }
  function goTo(which) { // View > Camera's places, in either view
    if (ED.view !== '2d' && typeof V3D !== 'undefined') return V3D.goTo(which);
    if (!S.doc) return;
    if (which === 'centre') return centre([0, 0]);
    if (which === 'sel') return centre(selPoint());
    const sp = objects().filter(o => o.kind === 'spawn');
    if (!sp.length) return;
    const c = [sp.reduce((s, o) => s + o.pos[0], 0) / sp.length, sp.reduce((s, o) => s + o.pos[1], 0) / sp.length];
    centre(which === 'base2' ? mir(c) : c);
  }
  function fitMap() {
    if (ED.view === '2d') return fit();
    if (typeof V3D === 'undefined' || !S.doc) return;
    const c = V3D.V.cam, size = +S.doc.size || 400;
    c.dist = Math.min(900, size * 0.62 / Math.tan(c.fov * Math.PI / 360));
    V3D.setTarget(0, 0);
  }
  ED.actions['view.frameSel'] = () => {
    if (ED.view !== '2d' && typeof V3D !== 'undefined' && S.sel) return V3D.frameSel(); // the target on it, near enough to see it
    if (S.sel) goTo('sel'); else fitMap();
  };

  // ---- the menus --------------------------------------------------------------------------------------------
  const tog = k => ({ check: () => !!S.show[k], act: () => toggleShow(k) });
  const v3 = (k, label) => ({ t: label, check: () => typeof V3D !== 'undefined' && !!V3D.V[k], act: () => { V3D.V[k] = !V3D.V[k]; V3D.redraw(); } });
  const MENUS = [
    { id: 'file', label: 'File', items: () => [
      { t: 'New Map from Template...', k: 'Ctrl+N', act: () => newDialog(false) },
      { t: 'Open Map', k: 'Ctrl+O', sub: 'open' },
      { t: 'Save Map', k: 'Ctrl+S', off: () => !S.doc || !!S.delivered, act: () => save() },
      { t: 'Save as My Own Copy...', off: () => !S.doc || !S.delivered, note: 'a map from a server', act: () => newDialog(true) },
      '-',
      { t: 'Build', note: 'the archive, into the output folder', off: () => !canBuild(), act: () => build() },
      '-',
      { t: 'Test Map', k: 'Ctrl+F9', off: () => $('btnTest').disabled, title: () => $('btnTest').title, act: testMap },
      { t: 'Stop the Test', off: () => !(S.test && S.test.running), act: stopTest },
    ] },
    { id: 'edit', label: 'Edit', items: () => [
      { t: 'Undo', k: 'Ctrl+Z', off: () => !S.undo.length, act: undo },
      { t: 'Redo', k: 'Ctrl+Y', off: () => !S.redo.length, act: redo },
      '-',
      { t: 'Cut', k: 'Ctrl+X', off: () => !S.sel, act: () => key('x', { ctrlKey: true }) },
      { t: 'Copy', k: 'Ctrl+C', off: () => !S.sel, act: () => key('c', { ctrlKey: true }) },
      { t: 'Paste', k: 'Ctrl+V', act: () => key('v', { ctrlKey: true }) },
      { t: 'Duplicate', k: 'Ctrl+D', off: () => !S.sel, act: () => key('d', { ctrlKey: true }) },
      { t: 'Delete', k: 'Del', off: () => !S.sel, act: deleteSel },
      '-',
      { t: 'Select All Doodads', k: 'Ctrl+A', off: () => !S.doc, act: () => key('a', { ctrlKey: true }) },
      { t: 'Select / Place', k: 'Space', act: spaceToggle },
      { t: 'Deselect', k: 'Esc', act: () => key('Escape') },
      '-',
      { t: 'Turn Left 15°', k: 'R', off: () => !S.sel, act: () => key('r') },
      { t: 'Turn Right 15°', k: 'Shift+R', off: () => !S.sel, act: () => key('R', { shiftKey: true }) },
      { t: 'Scale Up 10 %', k: ']', note: 'or the brush', act: () => key(']') },
      { t: 'Scale Down 10 %', k: '[', note: 'or the brush', act: () => key('[') },
    ] },
    { id: 'view', label: 'View', items: () => [
      { t: '2-D View', k: 'Tab', radio: () => ED.view === '2d', act: () => ED.setView('2d') },
      { t: '3-D View', k: 'Tab', radio: () => ED.view === '3d', off: () => !ED.views['3d'], act: () => ED.setView('3d') },
      { t: 'Camera', sub: 'camera' },
      { t: 'Fit the Map', k: 'F', act: fitMap },
      { t: 'Follow the Selection (3-D)', check: () => typeof V3D !== 'undefined' && V3D.V.follow, act: () => { V3D.V.follow = !V3D.V.follow; } },
      '-',
      { t: 'Background Layer', sub: 'bg' },
      { t: 'Pathing (the Player graph)', k: 'P', note: 'green walked, red too narrow, orange cut off', check: () => S.bg === 'graph_player.png', act: () => togglePathing('graph_player.png') },
      { t: 'Pathing (the NPC graph)', note: 'where camps, wells and minions walk', check: () => S.bg === 'graph_npc.png', act: () => togglePathing('graph_npc.png') },
      { t: 'Grid (20 m)', k: 'G', ...tog('grid') },
      { head: 'Show' },
      { t: 'Terrain Shapes', ...tog('shapes') }, { t: 'Team 2\'s Mirror', ...tog('mirror') },
      { t: 'Lanes', ...tog('lanes') }, { t: 'Units', ...tog('objects') }, { t: 'Doodads', ...tog('props') },
      { t: 'Check Findings', ...tog('findings') }, { t: 'The Bots\' Points', note: 'rally, Hunter routes', ...tog('bots') },
      { t: 'The Halves', ...tog('half') },
      { t: 'Ground Texture', note: 'the bake', check: () => flag('ground.bakeOn'), off: () => !has('ground.bakeOn'), act: act('ground.bakeOn') },
      { t: 'Texture Layer\'s Mask', check: () => flag('ground.mask'), off: () => !has('ground.mask'), act: act('ground.mask') },
      { t: 'Hide Derived Art', note: 'lane paths, edge bands, scatters', check: () => flag('ground.hideDerived'), off: () => !has('ground.hideDerived'), act: act('ground.hideDerived') },
      { t: 'Water, Bushes, Mist (3-D)', sub: 'show3d' },
      { head: 'Gameplay Overlays' },
      { t: 'Binding Ranges', note: 'where a Binding attacks', check: () => flag('overlay.ranges'), off: () => !has('overlay.ranges'), act: act('overlay.ranges') },
      { t: 'Lane Lengths', note: 'metres and walking time', check: () => flag('overlay.lanes'), off: () => !has('overlay.lanes'), act: act('overlay.lanes') },
      { t: 'Walk Times from the Base', note: 'along the Player graph', check: () => flag('overlay.walk'), off: () => !has('overlay.walk'), act: act('overlay.walk') },
      { t: 'Gameplay Numbers...', note: 'compared with SM_Map_v5', off: () => !has('overlay.numbers'), act: act('overlay.numbers') },
      '-',
      { t: 'Compare with a Level', sub: 'scene' },
      { t: 'Messages', check: () => !$('messages').classList.contains('hidden'), act: toggleMessages },
    ] },
    { id: 'layer', label: 'Layer', items: () => [
      { t: 'Terrain', k: 'T', radio: () => F.tab === 'terrain', act: () => setTab('terrain') },
      { t: 'Doodads', k: 'D', radio: () => F.tab === 'doodads', act: () => setTab('doodads') },
      { t: 'Units', k: 'U', radio: () => F.tab === 'units', act: () => setTab('units') },
      { t: 'Lanes', k: 'L', radio: () => F.tab === 'lanes', note: 'the World Editor\'s Regions', act: () => setTab('lanes') },
      '-',
      { t: 'Cameras', off: () => true, note: 'none: the game has one camera' },
    ] },
    { id: 'map', label: 'Map', items: () => [
      { t: 'Properties...', note: 'name, display name, tag, prefix', off: () => !S.doc, act: act('map.properties') },
      { t: 'Options...', note: 'the ground everywhere else', off: () => !S.doc, act: act('map.options') },
      { t: 'The Void...', note: 'what lies past the ground', off: () => !has('map.void'), act: act('map.void') },
      { t: 'Ground Bake and Cliff...', note: 'texels, tiles, minimap, cliff material', off: () => !has('ground.bake'), act: act('ground.bake') },
      '-',
      { t: 'Add a Camp', note: 'opens the Units tab', off: () => !S.doc || !has('map.addCamp'), act: act('map.addCamp') },
      '-',
      { t: 'Check...', act: () => ED.openWindow('check') },
      { t: 'The Bots\' Points...', note: 'rally, Hunter routes, uneven', act: () => { if (!S.show.bots) toggleShow('bots'); ED.openWindow('check'); } },
    ] },
    { id: 'tools', label: 'Tools', items: () => [
      { t: 'Smart Snaps', note: 'mirror line, lane edge, midpoint, grid; Ctrl while dragging: off', check: () => typeof FB !== 'undefined' && FB.F.on, act: () => FB.toggle() },
      { t: 'Snap to 1 m', k: 'hold Shift', check: () => S.snap, act: () => { S.snap = !S.snap; } },
      { t: 'Drag Joined Shapes Along', check: () => S.joined, act: () => { S.joined = !S.joined; renderInspector(); render(); } },
      '-',
      { t: 'Paint into the Picture', note: 'heavy painting: a PNG, not strokes', check: () => flag('ground.raster'), off: () => !has('ground.raster'), act: act('ground.raster') },
      { t: 'New Seed for the Scatter', off: () => !has('props.newSeed'), act: act('props.newSeed') },
    ] },
    { id: 'advanced', label: 'Advanced', items: () => [
      { t: 'Edit the Map as JSON...', off: () => !S.doc, act: () => ED.openWindow('mapjson') },
      { t: 'Edit the Selection as JSON...', off: () => !S.sel, act: () => { if (!openAdvanced()) log('the selection has no JSON of its own', 'err'); } },
      '-',
      { t: 'Ground Layers in Detail...', note: 'order, masks, rules, every field', off: () => !has('ground.layers'), act: act('ground.layers') },
      { t: 'Stamps in Detail...', note: 'cut a piece, size, soft border', off: () => !has('ground.stamps'), act: act('ground.stamps') },
      { t: 'Scatter Settings...', note: 'spacing, inset, at most, scale', off: () => !has('props.scatterSettings'), act: act('props.scatterSettings') },
      { t: 'Paste a Group from SM_Map_v5...', off: () => !has('props.paste') || !S.doc, act: act('props.paste') },
      { t: 'Split the Group into Doodads', off: () => !has('props.split'), act: act('props.split') },
      '-',
      { t: 'Export Ground Pictures...', off: () => !has('ground.export'), act: act('ground.export') },
      { t: 'Import Ground Pictures...', off: () => !has('ground.import'), act: act('ground.import') },
      { t: 'Flatten Strokes into the Picture', note: 'the selected texture layer', off: () => !has('ground.flatten'), act: act('ground.flatten') },
      '-',
      { t: 'Build without the PhysX Mesh', note: 'for inspection only', off: () => !canBuild(), act: () => build(true) },
    ] },
    { id: 'help', label: 'Help', items: () => [
      { t: 'Keys and Mouse...', k: 'F1', act: () => help('keys') },
      { t: 'Making Maps (the guide)', act: () => help('guide') },
      { t: 'About the Map Editor', act: () => help('about') },
    ] },
  ];
  const SUBS = {
    open: () => {
      const maps = (S.config && S.config.maps) || [];
      if (!maps.length) return [{ t: '(no maps in the maps folder)', off: () => true }];
      return maps.map(m => ({ t: m.pkg + (m.display ? ' (' + m.display + ')' : ''), radio: () => S.pkg === m.pkg, act: () => openMap(m.pkg) }))
        .concat(['-', { t: 'New Map from Template...', k: 'Ctrl+N', act: () => newDialog(false) }]);
    },
    camera: () => [
      { t: 'Game Camera', radio: () => typeof V3D !== 'undefined' && V3D.V.cam.mode === 'game', note: '3-D', act: () => { V3D.gameCamera(); } },
      { t: 'Free Camera', radio: () => typeof V3D !== 'undefined' && V3D.V.cam.mode === 'free', note: '3-D: Ctrl + right drag orbits', act: () => { V3D.freeCamera(); } },
      '-', { t: 'Team 1\'s Base', act: () => goTo('base1') }, { t: 'Team 2\'s Base', act: () => goTo('base2') },
      { t: 'The Centre', act: () => goTo('centre') }, { t: 'The Selection', k: 'F', off: () => !S.sel, act: () => goTo('sel') }],
    bg: () => {
      const files = (S.preview && S.preview.files) || [];
      const items = [{ t: 'none', radio: () => !S.bg, act: () => setBg('') }]
        .concat(files.map(f => ({ t: f.file.replace('.png', ''), title: () => f.shows, radio: () => S.bg === f.file, act: () => setBg(f.file) })));
      if (!files.length) items.push({ t: '(the check\'s pictures after the first check)', off: () => true });
      items.push('-', { ctl: () => h('span', { class: 'small' }, 'opacity ', h('input', { type: 'range', min: 0, max: 100, value: Math.round(S.bgAlpha * 100),
        oninput: e => { S.bgAlpha = e.target.value / 100; render(); } })) });
      return items;
    },
    show3d: () => [v3('water', 'Water'), v3('grass', 'Bushes\' Grass'), v3('mist', 'Mist')],
    scene: () => [
      { t: 'This Map', radio: () => typeof V3D !== 'undefined' && V3D.V.source === 'map', act: () => compare('') },
      { t: 'SM_Map_v5', radio: () => typeof V3D !== 'undefined' && V3D.V.source === 'level' && V3D.V.level === 'SM_Map_v5', act: () => compare('SM_Map_v5') },
      { t: 'MM_Map_v3', radio: () => typeof V3D !== 'undefined' && V3D.V.source === 'level' && V3D.V.level === 'MM_Map_v3', act: () => compare('MM_Map_v3') },
      '-', v3('dressing', 'Level Dressing')],
  };
  function compare(level) {
    if (typeof V3D === 'undefined') return;
    ED.setView('3d');
    V3D.setScene(level);
  }
  // the graph's picture as the background, or back to the layout (EDNARROW: either graph; both paint what they leave
  // out, red too narrow for any square, orange cut off from the bases)
  function togglePathing(file) { const f = typeof file === 'string' ? file : 'graph_player.png'; setBg(S.bg === f ? 'layout.png' : f); }
  function toggleMessages() { $('messages').classList.toggle('hidden'); resize(); }
  ED.actions['view.messages'] = toggleMessages;

  function renderMenubar() {
    const mb = $('menubar');
    mb.textContent = '';
    for (const m of MENUS) {
      const el = h('span', { class: 'm' + (F.menu === m.id ? ' open' : ''), 'data-menu': m.id }, m.label);
      el.onclick = e => { e.stopPropagation(); F.menu === m.id ? closeMenus() : openMenu(m.id); };
      el.onmouseenter = () => { if (F.menu && F.menu !== m.id) openMenu(m.id); };
      mb.append(el);
    }
  }
  function itemEl(it) {
    if (it === '-') return h('hr');
    if (it.head) return h('div', { class: 'head' }, it.head);
    if (it.ctl) return h('div', { class: 'ctl' }, it.ctl());
    const off = it.off && it.off();
    const cls = ['it'];
    if (it.check && it.check()) cls.push('check');
    if (it.radio && it.radio()) cls.push('radio');
    if (off) cls.push('off');
    const el = h('div', { class: cls.join(' '), title: it.title ? it.title() : null }, it.t,
      it.note ? h('span', { class: 'note' }, '(' + it.note + ')') : null,
      it.sub ? h('span', { class: 'sub' }, '▸') : it.k ? h('span', { class: 'k' }, it.k) : null);
    el.dataset.t = it.t;
    return el;
  }
  function menuBox(items, x, y, sub) {
    const box = h('div', { class: 'menu' + (sub ? ' subm' : '') });
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    for (const it of items) {
      const el = itemEl(it);
      box.append(el);
      if (!el.classList.contains('it')) continue;
      el.onmouseenter = () => {
        box.querySelectorAll('.it.open').forEach(o => o.classList.remove('open'));
        if (!sub) document.querySelectorAll('.menu.subm').forEach(s => s.remove());
        if (it.sub) {
          el.classList.add('open');
          const r = el.getBoundingClientRect();
          menuBox(SUBS[it.sub](), r.right - 2, r.top - 5, true);
        }
      };
      el.onclick = e => {
        e.stopPropagation();
        if (it.sub) { el.onmouseenter(); return; }
        if (el.classList.contains('off')) return;
        closeMenus();
        if (it.act) it.act();
        renderStatus();
      };
    }
    $('menuLayer').append(box);
    const r = box.getBoundingClientRect(); // keep it on the screen
    if (r.right > innerWidth) box.style.left = Math.max(0, innerWidth - r.width - 2) + 'px';
    if (r.bottom > innerHeight) box.style.top = Math.max(0, innerHeight - r.height - 2) + 'px';
    return box;
  }
  function openMenu(id, sub) {
    closeMenus(true);
    F.menu = id;
    renderMenubar();
    const m = MENUS.find(x => x.id === id), el = document.querySelector(`#menubar [data-menu="${id}"]`);
    const r = el.getBoundingClientRect();
    const box = menuBox(m.items(), r.left, r.bottom);
    if (sub) {
      const it = [...box.querySelectorAll('.it')].find(x => (m.items().find(i => i.sub === sub) || {}).t === x.dataset.t);
      if (it) it.onmouseenter();
    }
  }
  function openSubAt(sub, el) { // a submenu by itself, under a toolbar button (Open)
    closeMenus(true);
    F.menu = 'tb';
    const r = el.getBoundingClientRect();
    menuBox(SUBS[sub](), r.left, r.bottom, true);
  }
  function closeMenus(keep) {
    $('menuLayer').textContent = '';
    if (!keep) { F.menu = null; renderMenubar(); }
  }
  document.addEventListener('mousedown', e => { if (F.menu && !e.target.closest('.menu') && !e.target.closest('#menubar')) closeMenus(); });

  // ---- the palettes: Terrain's Draw with, Apply and Apply Cliff, the Units tab, the Lanes tab ------------------------
  function cliffGlyph(id) {
    const col = { chasm: '#8b95a3', open: '#b49a6a', wall: '#b08a70', water: '#3d8fb0', island: '#c9b8e8', bush: '#6fe07a' }[id];
    const shape = { chasm: 'M0 4 H12 V12 H28 V4 H40', open: 'M0 8 H40', wall: 'M0 12 H12 V3 H28 V12 H40',
      water: 'M0 4 H12 V12 H28 V4 H40', island: 'M0 10 H10 V6 H30 V10 H40', bush: 'M0 12 H40' }[id];
    const extra = id === 'water' ? '<rect x="12" y="8" width="16" height="4" fill="#3d8fb0"/>'
      : id === 'bush' ? '<path d="M8 12 l2-7 l2 7 M16 12 l2-9 l2 9 M24 12 l2-7 l2 7 M31 12 l2-8 l2 8" stroke="#6fe07a" fill="none"/>' : '';
    const sp = h('span');
    sp.innerHTML = `<svg class="glyph" viewBox="0 0 40 14">${extra}<path d="${shape}" stroke="${col}" stroke-width="2" fill="none"/></svg>`;
    return sp.firstChild;
  }
  // The Terrain tab, top to bottom (EDUX11, after Aseprite's order: how you draw, then what): (1) Draw with, the draw
  // mode the textures and the cliffs share (app.js S.draw), and right under it that mode's and the material's settings
  // (ED.drawSettings: ground.js fills it: the size for Brush and Path, Circle/Square for the Brush, the soft edge and
  // Erase for textures); (2) the Texture | Cliff switch (what the pen applies: S.lastMaterial, remembered); (3) only
  // that material's list: Apply Texture (ground.js, order 12) or Apply Cliff (here, order 12); (4) Apply Height
  // (heights.js, order 20), shown only while a wall or chasm is selected. A draw mode stays when the material changes.
  const drawBody = ED.addPane('terrain', 'Draw with', 5);
  const DRAWS = [['brush', '\u270E Brush', 'Brush: drag to draw, click for a dab'],
    ['polygon', '\u2B20 Polygon', 'Polygon: click the corners; double-click or Enter ends'], ['circle', '\u25EF Circle', 'Circle: press at the centre, drag the radius'],
    ['path', '\u3030 Path', 'Path: click the points; double-click or Enter ends; as wide as the size']];
  ED.drawSettings = h('div', { class: 'drawset' }); // the settings below the draw mode (ground.js renderBrush)
  const drawTip = h('div', { class: 'note' });
  function renderDraw() {
    drawBody.textContent = '';
    drawBody.parentNode.classList.toggle('armed', S.tool === 'paint' || S.tool === 'shape');
    const d = DRAWS.find(x => x[0] === S.draw);
    drawTip.textContent = d ? d[2] + '. Esc cancels.' : '';
    drawBody.append(h('div', { class: 'row seg' }, ...DRAWS.map(([m, t, tip]) => h('button', { class: S.draw === m ? 'on' : '', 'data-draw': m, title: tip, onclick: () => setDraw(m) }, t))),
      drawTip, ED.drawSettings);
  }
  // Terrain > Apply: the switch between the materials (a texture layer, a cliff kind)
  const applyBody = ED.addPane('terrain', 'Apply', 8);
  applyBody.parentNode.id = 'paneApply';
  const MATERIALS = [['paint', 'Texture', 'Paint a ground texture layer (Apply Texture)'], ['shape', 'Cliff', 'Draw walls, chasms, water, open ground, islands and bushes (Apply Cliff)']];
  function renderApply() {
    applyBody.textContent = '';
    applyBody.append(h('div', { class: 'row seg' }, ...MATERIALS.map(([m, t, tip]) => h('button', { class: S.lastMaterial === m ? 'on' : '', 'data-material': m, title: tip, onclick: () => setMaterial(m) }, t))),
      h('div', { class: 'note' }, S.lastMaterial === 'paint' ? 'The pen paints the chosen texture layer.' : 'The pen draws the chosen cliff kind.'));
  }
  const cliffBody = ED.addPane('terrain', 'Apply Cliff', 12);
  cliffBody.parentNode.id = 'paneCliff';
  cliffBody.parentNode.firstChild.append(h('span', { class: 'k small' }, 'raise, lower, water'));
  function renderCliff() {
    cliffBody.textContent = '';
    cliffBody.parentNode.hidden = S.lastMaterial !== 'shape';
    cliffBody.parentNode.classList.toggle('armed', S.tool === 'shape');
    const grid = h('div', { class: 'cliffs' });
    for (const c of CLIFFS) {
      grid.append(h('button', { class: S.cliff === c.id ? 'on' : '', title: c.tip, 'data-cliff': c.id, onclick: () => setCliff(c.id) },
        cliffGlyph(c.id), h('span', {}, c.name), h('span', { class: 'we' }, c.we)));
    }
    const c = CLIFFS.find(x => x.id === S.cliff);
    cliffBody.append(grid, h('div', { class: 'note' }, (c ? c.tip + '. ' : '') + 'Each drawing is a shape, team 2 gets the mirror. Open erases walls, Wall erases openings. A selected shape\'s kind changes in its info.'));
  }

  const unitsBody = ED.addPane('units', 'Units', 10);
  function renderUnits() {
    if (unitsBody.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    unitsBody.textContent = '';
    if (!S.doc) { unitsBody.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    const player = h('select', { onchange: e => { F.player = e.target.value; renderUnits(); } },
      ...[['all', 'All'], ['team1', 'Team 1 (team 2 is its mirror)'], ['neutral', 'Neutral']].map(([v, t]) => h('option', { value: v, selected: F.player === v }, t)));
    const objs = objects();
    const row = o => {
      const [ch, col] = KIND[o.kind] || ['?', '#888'];
      const sel = objSel(o);
      return h('div', { class: 'li' + (sameSel(sel, S.sel) ? ' on' : ''), 'data-kind': o.kind, title: 'Select it and jump there', onclick: () => { select(sel); centre(o.pos); } },
        h('span', { class: 'dot', style: 'background:' + (o.color || col) }, o.once ? 'P' : ch), h('span', { class: 'nm' }, o.label || o.name),
        h('span', { class: 'r' }, `${r1(o.pos[0])}, ${r1(o.pos[1])}`));
    };
    const add = (t, tool, tip, extra) => h('a', { class: 'lnk', title: tip, 'data-add': t, onclick: () => { if (extra) extra(); setTool(tool); } }, t);
    const cat = (title, adds, f) => {
      const rows = objs.filter(f);
      return [h('div', { class: 'cat' }, title, adds.length ? h('span', { class: 'add' }, ...adds) : null), ...rows.map(row)];
    };
    const list = h('div', { class: 'list' });
    if (F.player !== 'neutral') list.append(...cat('Base: moved, never added', [], o => ['locus', 'guardian', 'shop', 'spawn', 'core', 'binding'].includes(o.kind)));
    if (F.player !== 'team1') {
      list.append(...cat('Neutral passive', [add('+ Well', 'well', 'A spirit well (18 workers): click the map', () => { S.wellKind = 'well'; }),
        add('+ Mine', 'well', 'A mine (36 workers): click the map', () => { S.wellKind = 'mine'; })], o => o.kind === 'well'));
      list.append(...cat('Neutral hostile', [], o => o.kind === 'camp')); // added from Add a Camp above (camps.js)
    }
    if (F.player !== 'neutral') list.append(...cat('The bots\' ward spots', [add('+ Ward spot', 'ward', 'A spot the bots ward: click the map')], o => o.kind === 'ward'));
    unitsBody.parentNode.classList.toggle('armed', TOOL_TAB[S.tool] === 'units');
    unitsBody.append(h('div', { class: 'row' }, h('span', { class: 'small' }, 'Player'), player), list,
      h('div', { class: 'note' }, 'Click one to select it and jump there; drag it on the map. Del deletes a camp. The base is moved, never added or deleted; team 2\'s is the mirror.'));
  }

  const lanesBody = ED.addPane('lanes', 'Lanes', 10);
  lanesBody.parentNode.firstChild.append(h('span', { class: 'k small' }, 'team 1\'s; team 2 walks the mirror'));
  function renderLanes() {
    if (lanesBody.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    lanesBody.textContent = '';
    if (!S.doc) { lanesBody.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    const L = lanes();
    if (!L.length) { lanesBody.append(h('p', { class: 'hint' }, 'This map has no lanes.')); return; }
    if (S.sel && (S.sel.t === 'knot' || S.sel.t === 'lane') && L[S.sel.l]) F.lane = S.sel.l;
    if (!L[F.lane]) F.lane = 0;
    const l = L[F.lane], len = (S.report && S.report.stats && S.report.stats.laneLengths) || [];
    const pick = h('div', { class: 'row' }, ...L.map((x, i) => h('button', { class: i === F.lane ? 'on' : '', 'data-lane': i,
      onclick: () => { F.lane = i; select({ t: 'lane', l: i }); } }, 'Lane ' + (x && x.id), h('span', { class: 'small' }, len[i] ? ' ' + len[i] + ' m' : ''))));
    const width = h('div', { class: 'row' }, h('span', { class: 'small' }, 'width'), h('input', { type: 'number', step: '1', value: l.width, onchange: ev => {
      setLaneWidth(+ev.target.value, ev.target);
    } }), h('span', { class: 'small' }, 'm, both lanes'));
    const ks = Array.isArray(l.knots) ? l.knots : [];
    const selK = S.sel && S.sel.t === 'knot' && S.sel.l === F.lane ? S.sel.k : -1;
    const kl = h('div', { class: 'list' }, h('div', { class: 'cat' }, `Lane ${l.id}: its knots, from team 1's base`,
      h('span', { class: 'add' },
        h('a', { class: 'lnk', title: 'A knot halfway to the next one', onclick: () => { if (selK < 0) return log('select a knot first', 'err'); edit(() => insertKnot(F.lane, selK)); select({ t: 'knot', l: F.lane, k: selK + 1 }); } }, 'Insert knot after'),
        h('a', { class: 'lnk', onclick: () => { if (selK < 0) return log('select a knot first', 'err'); deleteSel(); } }, 'Delete knot'))),
    ...ks.map((k, i) => h('div', { class: 'li' + (i === selK ? ' on' : ''), 'data-knot': i, onclick: () => { select({ t: 'knot', l: F.lane, k: i }); centre(k); } },
      h('span', { class: 'dot', style: 'background:' + (LANE[l.id] || '#888') }, String(i + 1)), 'knot ' + (i + 1),
      h('span', { class: 'r' }, isPt(k) ? `${r1(k[0])}, ${r1(k[1])}` : '?'))));
    const on = objects().filter(o => o.kind === 'binding' && o.lane === l.id);
    const sp = ((S.preview && S.preview.objects) || []).filter(o => o.kind === 'spawner' && o.team === 1 && (o.lane === undefined || o.lane === l.id));
    const onLane = h('div', { class: 'list' }, h('div', { class: 'cat' }, 'On this lane'),
      ...on.map(o => h('div', { class: 'li' + (sameSel(objSel(o), S.sel) ? ' on' : ''), onclick: () => { select(objSel(o)); centre(o.pos); } },
        h('span', { class: 'dot', style: 'background:' + KIND.binding[1] }, 'B'), o.name, h('span', { class: 'r' }, `${r1(o.pos[0])}, ${r1(o.pos[1])}`))),
      ...sp.map(o => h('div', { class: 'li', onclick: () => centre(o.pos) }, h('span', { class: 'dot', style: 'background:' + KIND.spawner[1] }, 'M'),
        o.name || 'minion spawner', h('span', { class: 'r' }, `${r1(o.pos[0])}, ${r1(o.pos[1])}`))));
    const count = h('div', { class: 'row' }, h('span', { class: 'small' }, 'Lanes'),
      h('button', { class: L.length === 1 ? 'on' : '', 'data-lanes': 1, title: 'One lane: a mid lane through the centre, its own mirror walked back', onclick: () => setLaneCount(1) }, 'One lane'),
      h('button', { class: L.length === 2 ? 'on' : '', 'data-lanes': 2, title: 'Two lanes: lane 2 is lane 1 mirrored and walked back', onclick: () => setLaneCount(2) }, 'Two lanes'));
    const countNote = h('div', { class: 'note' }, L.length === 1
      ? 'One lane runs through the centre and is its own mirror walked back. Two lanes: lane 2 starts as its mirror, on the same path; drag lane 1\'s knots to part them.'
      : 'One lane keeps lane 1\'s base exit and runs it through the centre (its corridor follows); lane 2 and its corridor go, and Bindings you placed go back to "auto" (you are asked first).');
    lanesBody.append(count, countNote, pick, width, h('div', { class: 'note' }, 'Drag a knot on the map; its partner in the other lane follows, so the lanes stay mirrors.'),
      kl, onLane, h('div', { class: 'note' }, 'The Bindings stand where the editor puts them ("auto") until you drag one; then they are yours (Back to "auto" in the selection\'s info).'));
  }

  function renderPalettes() {
    renderDraw();
    renderApply();
    renderCliff();
    if (F.tab === 'units') renderUnits();
    if (F.tab === 'lanes') renderLanes();
  }
  ED.on('select', () => { renderPalettes(); renderPreview(); renderStatus(); });
  ED.on('doc', () => { if (F.tab === 'units' || F.tab === 'lanes') renderPalettes(); renderStatus(); });
  ED.on('checked', () => { renderPalettes(); renderStatus(); loadMinimap(); if (!S.sel) renderInspector(); });
  ED.on('open', () => { F.lane = 0; renderPalettes(); renderPreview(); loadMinimap(); });

  // ---- the selection's preview ------------------------------------------------------------------------------
  function renderPreview() {
    const el = $('selPreview');
    el.textContent = '';
    const s = S.sel;
    let pv = h('div', { class: 'pv' }), title = '', sub = '';
    if (!S.doc) title = 'No map open';
    else if (!s) { title = S.pkg; sub = 'nothing selected: the map\'s facts'; pv.textContent = '▦'; pv.style.color = 'var(--dim)'; }
    else if (s.t === 'prop' && typeof PR !== 'undefined') {
      const c = selValue(s), inf = c && c.noun && PR.info(c.noun);
      if (inf && inf.icon) pv.append(h('img', { src: inf.icon.url, alt: '' }));
      else pv.textContent = c && c.group ? '∴' : '◆';
      title = c ? (c.group ? 'group of ' + c.group.level : PR.bare(c.noun)) : 'doodad';
      sub = 'a doodad; team 2 gets its mirror';
    } else if (s.t === 'obj' || s.t === 'auto') {
      const o = objects().find(x => sameSel(objSel(x), s));
      const [ch, col] = (o && KIND[o.kind]) || ['?', '#888'];
      pv.textContent = o && o.once ? 'P' : ch;
      pv.style.color = (o && o.color) || col;
      title = o ? o.label || o.name : 'unit';
      sub = o && o.auto ? 'placed by the editor ("auto")' : o && o.once ? 'stands once, no mirror' : 'team 2 gets its mirror';
    } else if (['shape', 'vertex', 'radius'].includes(s.t)) {
      const sh = shapes()[s.i];
      const k = sh ? (sh.type === 'chasm' && sh.water ? 'water' : sh.type) : '';
      pv.append(cliffGlyph(CLIFFS.some(c => c.id === k) ? k : 'open'));
      title = (CLIFFS.find(c => c.id === k) || { name: k }).name + ' shape';
      sub = s.t === 'vertex' ? 'a corner' : sh && sh.circle ? 'a circle' : sh && sh.polygon ? 'a polygon' : 'a path';
    } else if (s.t === 'knot' || s.t === 'lane') {
      const l = lanes()[s.l];
      pv.textContent = s.t === 'knot' ? String(s.k + 1) : '≈';
      pv.style.color = (l && LANE[l.id]) || '#888';
      title = 'Lane ' + (l && l.id) + (s.t === 'knot' ? ', knot ' + (s.k + 1) : '');
      sub = 'team 2 walks the mirror';
    } else {
      pv.textContent = '•';
      title = { scatter: 'scatter region', props: 'several doodads', part: 'a cut-off part' }[s.t] || s.t;
    }
    el.append(pv, h('div', {}, h('div', { class: 'pvt' }, title), h('div', { class: 'small' }, sub)));
  }

  // ---- the minimap: the check's minimap.png and the camera's rectangle; a click or a drag jumps -------------------
  const mm = $('minimap'), mctx = mm.getContext('2d');
  function loadMinimap() {
    const files = (S.preview && S.preview.files) || [];
    const f = files.find(x => x.file === 'minimap.png') || files.find(x => x.file === 'layout.png');
    const src = f && S.images ? S.images + f.file : '';
    if (src === F.minimap.src) return;
    F.minimap.src = src;
    if (!src) { F.minimap.img = null; drawMinimap(); return; }
    const img = new Image();
    img.onload = () => { if (F.minimap.src === src) { F.minimap.img = img; drawMinimap(); } };
    img.src = src;
  }
  function camPoly() { // the view's ground footprint, world points
    if (!S.doc) return null;
    if (ED.view === '2d') {
      const W = cv.width, H = cv.height;
      return [s2w(0, 0), s2w(W, 0), s2w(W, H), s2w(0, H)];
    }
    if (typeof V3D === 'undefined' || !V3D.V.canvas) return null;
    const c = V3D.V.cam, pr = c.pitch * Math.PI / 180, yr = c.yaw * Math.PI / 180;
    const f = [Math.sin(yr) * Math.cos(pr), Math.cos(yr) * Math.cos(pr), -Math.sin(pr)]; // looking down along the yaw
    const rt = [Math.cos(yr), -Math.sin(yr), 0];
    const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
    const eye = [c.tx - f[0] * c.dist, c.ty - f[1] * c.dist, c.tz - f[2] * c.dist];
    const th = Math.tan(c.fov * Math.PI / 360), asp = V3D.V.canvas.clientWidth / Math.max(1, V3D.V.canvas.clientHeight);
    const far = (+S.doc.size || 400) * 2;
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([u, v]) => {
      const d = [0, 1, 2].map(i => f[i] + u * th * asp * rt[i] + v * th * up[i]);
      let t = d[2] < -1e-3 ? -eye[2] / d[2] : far;
      t = Math.min(t, far);
      return [eye[0] + d[0] * t, eye[1] + d[1] * t];
    });
  }
  function drawMinimap() {
    const dpr2 = window.devicePixelRatio || 1, N = Math.round(250 * dpr2);
    if (mm.width !== N) { mm.width = N; mm.height = N; }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#0f1114';
    mctx.fillRect(0, 0, N, N);
    if (!S.doc) return;
    const size = +S.doc.size || 400, k = N / size;
    const toM = p => [(p[0] + size / 2) * k, (size / 2 - p[1]) * k];
    if (F.minimap.img) mctx.drawImage(F.minimap.img, 0, 0, N, N);
    const poly = camPoly();
    if (poly) {
      mctx.save();
      mctx.beginPath();
      poly.forEach((p, i) => { const q = toM(p); if (i) mctx.lineTo(q[0], q[1]); else mctx.moveTo(q[0], q[1]); });
      mctx.closePath();
      mctx.lineWidth = 1.5 * dpr2;
      mctx.strokeStyle = 'rgba(0,0,0,.7)';
      mctx.lineWidth = 3 * dpr2; mctx.stroke();
      mctx.strokeStyle = '#fff';
      mctx.lineWidth = 1.5 * dpr2; mctx.stroke();
      mctx.restore();
    }
    const sp = S.sel && selPoint();
    if (sp) {
      const q = toM(sp);
      mctx.fillStyle = '#58a6ff';
      mctx.beginPath(); mctx.arc(q[0], q[1], 3 * dpr2, 0, 2 * Math.PI); mctx.fill();
    }
  }
  let mmQueued = false;
  function queueMinimap() { if (!mmQueued) { mmQueued = true; requestAnimationFrame(() => { mmQueued = false; drawMinimap(); }); setTimeout(() => { if (mmQueued) { mmQueued = false; drawMinimap(); } }, 120); } }
  ED.on('render', queueMinimap);
  ED.on('view', () => { queueMinimap(); renderStatus(); });
  ED.on('camera', () => { queueMinimap(); renderStatus1(); });
  function minimapJump(e) {
    if (!S.doc) return;
    const r = mm.getBoundingClientRect(), size = +S.doc.size || 400;
    const x = (e.clientX - r.left) / r.width * size - size / 2, y = size / 2 - (e.clientY - r.top) / r.height * size;
    centre([r1(x), r1(y)]);
    queueMinimap();
  }
  mm.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    minimapJump(e);
    const mv = ev => minimapJump(ev), up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });

  // ---- the status bar ----------------------------------------------------------------------------------------
  // groundKind is the kind of ground under a world point: the last shape (or its mirror) that holds it, else the
  // ground everywhere else; with the height the compiler gives it (wall +5 m, chasm -5 m, else 0)
  function groundKind(w) {
    if (!S.doc) return null;
    const size = +S.doc.size || 400;
    if (Math.abs(w[0]) > size / 2 || Math.abs(w[1]) > size / 2) return { kind: 'outside', z: null };
    const sh = shapes();
    for (let i = sh.length - 1; i >= 0; i--) {
      if (shapeHit(sh[i], w) || shapeHit(sh[i], mir(w))) {
        const t = sh[i].type === 'chasm' && sh[i].water ? 'water' : sh[i].type;
        return { kind: t, z: t === 'wall' ? 5 : t === 'chasm' || t === 'water' ? -5 : 0 };
      }
    }
    const d = (S.doc.terrain && S.doc.terrain.default) || 'wall';
    return { kind: d, z: d === 'wall' ? 5 : d === 'chasm' ? -5 : 0 };
  }
  F.cursor = null;
  ED.on('cursor', w => { F.cursor = w; renderStatus1(); });
  function renderStatus1() {
    const st = $('st1');
    if (ED.view !== '2d' && typeof V3D !== 'undefined') {
      const c = V3D.V.cam, cam = `camera at (${c.tx.toFixed(1)}, ${c.ty.toFixed(1)}), ${c.dist.toFixed(0)} m, ${c.mode === 'game' ? 'game' : 'free'} camera`;
      const w = S.mouseW, g = w && S.doc && groundKind(w);
      // the cursor where the view's pick has a ground point (its height the 3-D ground's), else the camera
      st.textContent = w && g ? `x ${w[0].toFixed(1)}  y ${w[1].toFixed(1)}  z ${V3D.heightAt(w[0], w[1]).toFixed(1)}  ${g.kind}` + (w[0] + w[1] > 0 ? '  (team 2)' : '') : '3-D: ' + cam;
      st.title = '3-D: ' + cam + '\n' + (V3D.statusText || '');
      return;
    }
    const w = F.cursor;
    if (!w || !S.doc) { st.textContent = ''; return; }
    const g = groundKind(w);
    st.textContent = `x ${w[0].toFixed(1)}  y ${w[1].toFixed(1)}` + (g && g.z !== null ? `  z ${g.z}  ${g.kind}` : '  outside the map') + (w[0] + w[1] > 0 ? '  (team 2)' : '');
    st.title = 'The cursor: x, y, the height and the ground kind under it (x + y > 0 is team 2\'s half, the mirror)';
  }
  function describeSel() {
    const s = S.sel;
    if (!s || !S.doc) return '';
    const v = selValue(s), p = selPoint(), at = p ? ` at (${r1(p[0])}, ${r1(p[1])})` : '';
    if (s.t === 'obj' || s.t === 'auto') { const o = objects().find(x => sameSel(objSel(x), s)); return (o ? o.label || o.name : 'unit') + (o && o.once ? '' : ', team 1') + at; }
    if (s.t === 'prop') return (v && v.group ? 'group of ' + v.group.level : 'doodad ' + (v && v.noun || '')) + at;
    if (['shape', 'vertex', 'radius'].includes(s.t)) { const sh = shapes()[s.i]; return (sh ? sh.type : '') + ' shape ' + s.i + (s.t === 'vertex' ? ', corner ' + s.v : '') + at; }
    if (s.t === 'knot') return 'lane ' + (lanes()[s.l] || {}).id + ', knot ' + (s.k + 1) + at;
    if (s.t === 'lane') return 'lane ' + (lanes()[s.l] || {}).id;
    if (s.t === 'props') return (s.ks ? s.ks.length : 'several') + ' doodads';
    return s.t + at;
  }
  function renderStatus() {
    if (!$('st1')) return;
    renderStatus1();
    const t = S.tool, tool = ED.tools[t];
    let st2 = TOOL_NAME[t] || t;
    if (t === 'shape') st2 = drawLabel() + ' \u00B7 ' + ((CLIFFS.find(c => c.id === S.cliff) || {}).name || S.cliff);
    if (t === 'well') st2 = S.wellKind === 'mine' ? '+ Mine' : '+ Well';
    if (t === 'camp' && ED.camps) st2 = 'Add a Camp · ' + ED.camps.current().name;
    if (tool && tool.status) { try { st2 = tool.status(); } catch (e) { /* the tool's own line */ } }
    $('st2').textContent = st2;
    $('st2').title = $('toolHint').textContent || 'The tool and its brush';
    $('st3').textContent = (ED.measureText && ED.measureText()) || describeSel(); // EDUX6: the measurements while editing
    const tst = S.config && S.config.test; // Test's state: the badge while one runs, else "off" where this editor has no game
    $('st4check').textContent = 'check: ' + $('checkState').textContent + (!S.test && tst && !tst.enabled ? '  ·  Test: off' : '');
    $('st4').title = 'The map check and Test (click: the Map Check window)' + (!S.test && tst && !tst.enabled ? '\nTest is off: ' + tst.reason : '');
    $('st4check').className = $('checkState').className.replace('badge', '');
  }
  ED.on('badge', renderStatus);
  $('st4').addEventListener('click', () => ED.openWindow('check'));
  $('checkState').addEventListener('click', () => ED.openWindow('check'));

  // ---- help ------------------------------------------------------------------------------------------------
  const KEYS = [
    ['Files', [['Ctrl+N', 'New Map from Template'], ['Ctrl+O', 'Open Map'], ['Ctrl+S', 'Save Map'], ['Ctrl+F9', 'Test Map']]],
    ['Editing', [['Ctrl+Z / Ctrl+Y', 'Undo / Redo (also Ctrl+Shift+Z)'], ['Ctrl+X, Ctrl+C, Ctrl+V', 'Cut, Copy, Paste doodads (Paste at the mouse)'],
      ['Ctrl+D', 'Duplicate'], ['Del', 'Delete'], ['Ctrl+A', 'Select All Doodads'], ['Space', 'Select / the palette\'s tool'],
      ['Esc', 'End the drawing, then the tool, then deselect'], ['Enter', 'End a polygon or path'],
      ['A number, Enter', 'While dragging or drawing: the exact distance, radius or width (x,y: a place); with a brush: its size'], ['R / Shift+R', 'Turn 15°'],
      ['[ ]', 'Scale the selection; with Apply Texture the brush'], ['X', 'Apply Texture: erase / paint']]],
    ['Palettes and view', [['T, D, U, L', 'Terrain, Doodads, Units, Lanes'], ['Tab', '2-D / 3-D'], ['F', 'Fit the map (2-D); frame the selection (3-D)'],
      ['G', 'Grid'], ['P', 'Pathing (the Player graph)'], ['Arrow keys', 'Scroll the view (3-D: with the view clicked)'], ['F1', 'This list']]],
    ['Mouse', [['Left', 'The tool: select and drag, draw, place, paint'], ['Shift + left', 'Snap to 1 m; add doodads to the selection; on a palette tile: add or remove it from the picks'], ['Ctrl while dragging', 'No smart snaps for this move'],
      ['Ctrl + left', 'Add or remove a doodad (on a palette tile too, as Shift)'], ['Drag on empty ground', 'Select the doodads in the box'],
      ['Double-click', 'End a drawing; add a corner to a shape\'s edge'], ['Right or middle drag, Alt + left drag', 'Scroll (pan)'],
      ['Wheel, Shift + right drag', 'Zoom'], ['Alt + wheel', 'A doodad\'s height: the selected ones, or the next one while placing (0.1 m; Shift+Alt: 1 m)'], ['Ctrl + right drag', 'Turn the camera (3-D; free camera: and tilt it)'],
      ['Minimap: click or drag', 'Jump there'], ['Drag a doodad tile onto the map', 'Place it (either view)']]],
  ];
  function help(what) {
    const b = $('helpBody');
    b.textContent = '';
    if (what === 'keys') {
      const col = list => h('div', {}, ...list.map(([title, rows]) => h('div', {}, h('h3', {}, title),
        h('table', {}, ...rows.map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t)))))));
      b.append(h('h2', {}, 'Keys and Mouse'), h('div', { class: 'cols' }, col(KEYS.slice(0, 2)), col(KEYS.slice(2))));
    } else if (what === 'guide') {
      b.append(h('h2', {}, 'Making Maps'), h('p', {}, 'The map makers\' guide is docs\\making-maps.md in the editor\'s folder: what a map needs, map.json and the rules the check applies.'),
        h('p', { class: 'small' }, 'The editor\'s own guide (the panes, the keys, Test) is README.md beside it.'));
    } else {
      const pg = (S.config && S.config.page) || {};
      b.append(h('h2', {}, 'About the Map Editor'), h('p', {}, 'Dawngate Map Editor ' + (pg.version || '') + (S.config && S.config.release ? ', served by Start-Client ' + S.config.release : '') + '.'),
        h('p', { class: 'small' }, 'Its layout follows the Warcraft III World Editor\'s: the menu bar, the minimap, the palettes Terrain, Doodads, Units and Lanes.'));
    }
    $('dlgHelp').showModal();
  }
  $('btnHelpClose').onclick = () => $('dlgHelp').close();

  // ---- keys --------------------------------------------------------------------------------------------------
  window.addEventListener('keydown', e => {
    const ae = document.activeElement, typing = ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName);
    const ctl = e.ctrlKey || e.metaKey;
    if (e.key === 'F1') { e.preventDefault(); help('keys'); return; }
    if (ctl && e.key === 'F9') { e.preventDefault(); if (!$('btnTest').disabled) testMap(); return; }
    if (ctl && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newDialog(false); return; }
    if (ctl && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openMenu('file', 'open'); return; }
    if (typing || ctl || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && F.menu) { closeMenus(); e.stopImmediatePropagation(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const tabs = { t: 'terrain', d: 'doodads', u: 'units', l: 'lanes' };
    if (tabs[k] && !e.shiftKey) { setTab(tabs[k]); e.stopImmediatePropagation(); return; }
    if (k === 'Tab' && !e.shiftKey) { e.preventDefault(); toggleView(); return; }
    if (k === ' ') { if (ae && ae.tagName === 'BUTTON') ae.blur(); e.preventDefault(); spaceToggle(); return; }
    if (k === 'g') { toggleShow('grid'); return; }
    if (k === 'p') { togglePathing(); return; }
    if (k.startsWith('Arrow')) { // scroll the view by a tenth of its width
      if (!viewFocused()) return; // 3-D: only with the view focused (a click in it), not while a list or button has it
      e.preventDefault();
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0;
      if (ED.view === '2d') {
        const step = cv.width / S.view.scale / 10;
        S.view.x += dx * step; S.view.y += dy * step; S.fitted = false; render();
      } else if (typeof V3D !== 'undefined') {
        const c = V3D.V.cam, step = c.dist / 8, y = c.yaw * Math.PI / 180;
        V3D.setTarget(c.tx + dx * step * Math.cos(y) + dy * step * Math.sin(y), c.ty - dx * step * Math.sin(y) + dy * step * Math.cos(y));
      }
    }
  }, true); // before the parts' own handlers: T, D, U, L and Space are the frame's

  // ---- the toolbar ----------------------------------------------------------------------------------------------
  $('btnOpen').onclick = e => { e.stopPropagation(); openSubAt('open', $('btnOpen')); };
  document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
  $('btnCloseMessages').onclick = toggleMessages;

  // ---- actions the frame owns -----------------------------------------------------------------------------------
  ED.actions['map.properties'] = () => ED.openWindow('props');
  ED.actions['map.options'] = () => ED.openWindow('options');
  ED.actions['tab'] = setTab;

  // the URL's state (for pictures): &tab=, &menu= (&sub=), &win=, &messages=1, &help=keys; the Terrain tab's
  // &material=paint|shape, &draw=brush|polygon|circle|path, &cliff=<kind> and &shape=<k> (terrain.shapes[k] selected:
  // Apply Height shows for a wall or chasm); the Doodads tab's &dmode= and &picks= are props.js's
  ED.on('started', () => {
    if (URLQ.get('tab')) setTab(URLQ.get('tab'));
    if (URLQ.get('material')) setMaterial(URLQ.get('material'));
    if (URLQ.get('cliff')) setCliff(URLQ.get('cliff'));
    if (URLQ.get('draw')) setDraw(URLQ.get('draw'));
    if (URLQ.get('shape') && S.doc && shapes()[+URLQ.get('shape')]) select({ t: 'shape', i: +URLQ.get('shape') });
    if (URLQ.get('messages')) toggleMessages();
    if (URLQ.get('win')) URLQ.get('win').split(',').forEach(w => (ED.actions[w] ? ED.act(w) : ED.openWindow(w)));
    if (URLQ.get('menu')) setTimeout(() => openMenu(URLQ.get('menu'), URLQ.get('sub')), 300);
    if (URLQ.get('help')) help(URLQ.get('help'));
  });

  // paletteOrder (EDUX11, part of ?selftest=frame): the palettes' order, how you draw or place first, then what: the
  // Terrain tab's groups top to bottom and the draw mode's settings under it, the cliff kinds hidden under Texture and
  // the texture layers under Cliff, Apply Height only with a wall or chasm selected; the Doodads tab's mode first, that
  // mode's settings only, then the palette; a click picks one (the mode and its tool kept), Shift+click and Ctrl+click
  // add or remove, a chip's x removes; Place with two picks lays both kinds over 20 clicks, each as its ghost showed
  async function paletteOrder(say, press) {
    let ok = true;
    const dprops = () => S.doc.props || [];
    const shown = tab => [...$('tab_' + tab).children].filter(s => !s.hidden).map(s => s.firstChild.firstChild.nodeValue);
    const has = sel => !!document.querySelector(sel);
    const dset = () => ['size', 'shape', 'soft', 'erase'].filter(k => ED.drawSettings.querySelector(`[data-${k}]`)).join(',');
    press('t');
    const m0 = S.lastMaterial, d0 = S.draw;
    setMaterial('shape');
    setDraw('brush');
    select(null);
    ok &= say(shown('terrain').join(' | ') === 'Draw with | Apply | Apply Cliff', 'Terrain, Cliff: ' + shown('terrain').join(' | '));
    ok &= say(dset() === 'size,shape' && ED.drawSettings.parentNode === $('tab_terrain').querySelector('section').lastChild,
      'Brush with a cliff: the size and Circle/Square right under Draw with (' + dset() + ')');
    setDraw('polygon');
    ok &= say(dset() === '', 'Polygon with a cliff: no settings (' + dset() + ')');
    document.querySelector('#tab_terrain [data-material="paint"]').click();
    ok &= say(S.tool === 'paint' && shown('terrain').join(' | ') === 'Draw with | Apply | Apply Texture' && $('paneCliff').hidden && !has('#tab_terrain section:not([hidden]) [data-cliff]'),
      'Texture: the cliff kinds hidden, the texture layers shown: ' + shown('terrain').join(' | '));
    ok &= say(dset() === 'soft,erase', 'Polygon with a texture: the soft edge and Erase (' + dset() + ')');
    setDraw('path');
    ok &= say(dset() === 'size,soft,erase' && /Width/.test(ED.drawSettings.textContent), 'Path with a texture: its width, the soft edge, Erase (' + dset() + ')');
    setTool('select');
    press('d');
    press('t');
    ok &= say(S.lastMaterial === 'paint' && !$('paneGround').hidden, 'the material remembered across Select and another tab');
    document.querySelector('#tab_terrain [data-material="shape"]').click();
    ok &= say(S.tool === 'shape' && $('paneGround').hidden && !$('paneCliff').hidden && S.draw === 'path', 'Cliff: the texture layers hidden, the kinds shown, the draw mode kept');
    // Apply Height: only while a wall or chasm shape is selected
    const hsec = [...$('tab_terrain').children].find(s => s.firstChild.firstChild.nodeValue === 'Apply Height');
    let wi = shapes().findIndex(s => s.type === 'wall' && s.lane === undefined), added = false;
    if (wi < 0) { edit(d => d.terrain.shapes.push({ type: 'wall', circle: [-150, -60], r: 6 })); wi = shapes().length - 1; added = true; }
    const oi = shapes().findIndex(s => s.type !== 'wall' && s.type !== 'chasm');
    setTool('select');
    ok &= say(hsec && hsec.hidden, 'Apply Height hidden with nothing selected');
    select({ t: 'shape', i: wi });
    ok &= say(hsec && !hsec.hidden && hsec.querySelector('[data-height]') && shown('terrain').join(' | ') === 'Draw with | Apply | Apply Cliff | Apply Height',
      'a wall selected: Apply Height shown with its field, last: ' + shown('terrain').join(' | '));
    if (oi >= 0) { select({ t: 'shape', i: oi }); ok &= say(hsec.hidden, `a shape of another kind (${shapes()[oi].type}) selected: Apply Height hidden`); }
    select(null);
    ok &= say(hsec.hidden, 'deselected: Apply Height hidden again');
    if (added) undo();
    // the Doodads tab: the mode first, its settings only, then the palette
    press('d');
    await PR.loadNouns();
    await PR.until(() => PR.P.state !== 'loading', 120000);
    const P = PR.P, tiles = [...P.grid.querySelectorAll('.tile')].map(t => t.dataset.noun).slice(0, 3);
    const tile = n => P.grid.querySelector(`.tile[data-noun="${CSS.escape(n)}"]`);
    const tap = (n, mods) => tile(n).dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, mods || {})));
    const picks = () => [...P.picksEl.querySelectorAll('[data-chip]')].map(c => c.dataset.chip).join(',');
    const inBrush = sel => !!P.brush.querySelector(sel);
    P.multi.clear(); P.cur = '';
    document.querySelector('#tab_doodads [data-dmode="place"]').click();
    const dsecs = [...$('tab_doodads').children].filter(s => !s.hidden);
    ok &= say(shown('doodads').join(' | ') === 'Brush | Doodads' && dsecs[0].querySelector('.row').querySelectorAll('[data-dmode]').length === 3 && dsecs[1].querySelector('.palette .grid'),
      'Doodads: the mode (Place | Scatter | Paste group) first, then the palette: ' + shown('doodads').join(' | '));
    ok &= say(S.tool === 'prop' && inBrush('[data-next="scale"]') && inBrush('[data-opt="randomTurn"]') && !inBrush('[data-smode]') && !inBrush('[data-paste]'),
      'Place: its settings only (next size, turn, height, Random turn)');
    document.querySelector('#tab_doodads [data-dmode="scatter"]').click();
    ok &= say(S.tool === 'scatter' && P.mode === 'scatter' && inBrush('[data-smode="fill"]') && !inBrush('[data-next]') && !inBrush('[data-paste]'), 'Scatter: its settings only (Along the walls / Fill area)');
    P.brush.querySelector('[data-smode="fill"]').click();
    ok &= say(inBrush('[data-fill="on"]') && inBrush('[data-fill="blocks"]') && inBrush('[data-fill="density"]'), 'Fill area: Where, Block and the density');
    const dens = P.brush.querySelector('[data-fill="density"]');
    dens.value = '0.5';
    dens.dispatchEvent(new Event('change'));
    ok &= say(P.fillDensity === 0.5, 'the density for the next region: ' + P.fillDensity);
    PR.setSmode({ smode: 'walls', fillDensity: 0 });
    document.querySelector('#tab_doodads [data-dmode="paste"]').click();
    ok &= say(P.mode === 'paste' && S.tool !== 'prop' && S.tool !== 'scatter' && inBrush('[data-paste]') && !inBrush('[data-next]') && !inBrush('[data-smode]'),
      'Paste group: Pick a group from SM_Map_v5... only, the Prop and Scatter tools dropped');
    tap(tiles[0]);
    ok &= say(P.mode === 'paste' && picks() === tiles[0], 'a palette click under Paste: picked, the mode kept');
    // the picks: a click replaces them, Shift+click and Ctrl+click add or remove, the chips; Scatter stays armed
    document.querySelector('#tab_doodads [data-dmode="scatter"]').click();
    tap(tiles[1]);
    ok &= say(S.tool === 'scatter' && P.mode === 'scatter' && picks() === tiles[1], 'a click under Scatter: one pick (replacing), Scatter kept armed');
    tap(tiles[0], { shiftKey: true });
    ok &= say(picks() === [tiles[1], tiles[0]].join(',') && /^2 picked/.test(P.picksEl.textContent) && S.tool === 'scatter', 'Shift+click adds one: ' + P.picksEl.textContent);
    tap(tiles[2], { ctrlKey: true });
    ok &= say(PR.paletteNouns().length === 3 && tile(tiles[2]).classList.contains('cur'), 'Ctrl+click adds one too: 3 picked, its tile marked');
    tap(tiles[1], { shiftKey: true });
    ok &= say(picks() === [tiles[0], tiles[2]].join(','), 'Shift+click a picked one removes it: ' + picks());
    P.picksEl.querySelector(`[data-chip="${CSS.escape(tiles[2])}"] .x`).click();
    ok &= say(picks() === tiles[0] && S.tool === 'scatter' && /Scatter.*1 doodad picked/.test($('st2').textContent), 'a chip\'s x removes it; Scatter still armed: ' + $('st2').textContent);
    // Place with two picks: one of them per click, at random, as the ghost showed; both kinds over 20 clicks
    document.querySelector('#tab_doodads [data-dmode="place"]').click();
    tap(tiles[1], { shiftKey: true });
    const np = dprops().length, kinds = new Set();
    let asGhost = true;
    for (let i = 0; i < 20; i++) {
      const g = ED.tools.prop.ghost();
      ED.tools.prop.down([-150 + 3 * (i % 5), -70 - 3 * Math.floor(i / 5)], null);
      const c = dprops()[dprops().length - 1];
      kinds.add(c.noun.toLowerCase());
      if (!g || c.noun.toLowerCase() !== g.noun.replace(/\.Noun$/i, '').toLowerCase()) asGhost = false;
    }
    ok &= say(dprops().length === np + 20 && kinds.size === 2 && asGhost && P.mode === 'place', `Place with two picks: 20 clicks laid both kinds (${[...kinds].join(', ')}), each the ghost's`);
    tap(tiles[2]);
    ok &= say(picks() === tiles[2] && S.tool === 'prop', 'a plain click replaces the picks; Place kept');
    for (let i = 0; i < 20; i++) undo();
    ok &= say(dprops().length === np, 'the 20 doodads undone');
    P.multi.clear(); P.cur = '';
    setTool('select');
    S.draw = d0;
    if (m0 !== S.lastMaterial) S.lastMaterial = m0;
    press('t');
    return !!ok;
  }

  // ---- the frame's self-test (?selftest=frame, CM_Ring): every menu, its actions registered, the keys, the tabs and
  // their tools, the minimap, the status bar, the windows; every edit undone, nothing saved ------------------------------
  async function selftest() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const press = (k, mods) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
    const click = (w, type, mods) => { const r = cv.getBoundingClientRect(), s = w2s(w); cv.dispatchEvent(new MouseEvent(type || 'mousedown', Object.assign({ clientX: r.left + s[0] / dpr, clientY: r.top + s[1] / dpr, button: 0, bubbles: true }, mods || {}))); };
    let ok = true;
    ok &= say(S.doc && S.report && S.report.ok, 'opened ' + S.pkg);
    // the menus: each opens, and every item's action is registered (greyed only for want of a map, a selection or a
    // game copy, never for a missing part)
    for (const m of MENUS) {
      openMenu(m.id);
      const n = document.querySelectorAll('#menuLayer .menu .it').length;
      ok &= say(n > 2 && document.querySelector(`#menubar [data-menu="${m.id}"]`).classList.contains('open'), `menu ${m.label}: ${n} items`);
    }
    closeMenus();
    for (const a of ['ground.layers', 'ground.stamps', 'ground.bake', 'ground.export', 'ground.import', 'ground.flatten', 'ground.bakeOn', 'ground.mask', 'ground.raster', 'ground.hideDerived',
      'props.paste', 'props.split', 'props.scatterSettings', 'props.newSeed', 'map.void', 'map.properties', 'map.options', 'view.frameSel']) {
      if (!ED.actions[a]) ok &= say(false, 'no action ' + a);
    }
    ok &= say(true, 'the menus\' actions are all registered');
    for (const sub of Object.keys(SUBS)) ok &= say(SUBS[sub]().length > 0, `submenu ${sub}: ${SUBS[sub]().length} items`);
    // the tabs by key, and the toolbar's buttons
    for (const [k, t] of [['d', 'doodads'], ['u', 'units'], ['l', 'lanes'], ['t', 'terrain']]) {
      press(k);
      ok &= say(F.tab === t && $('tab_' + t).classList.contains('on') && document.querySelector(`#dockTabs [data-tab="${t}"]`).classList.contains('on'), `key ${k.toUpperCase()}: the ${t} tab`);
    }
    // Terrain > Apply Cliff: a water circle (a chasm with water), then an island polygon (Draw with: Circle, Polygon)
    const n0 = shapes().length;
    document.querySelector('#tab_terrain [data-draw="circle"]').click();
    document.querySelector('#tab_terrain [data-cliff="water"]').click();
    ok &= say(S.tool === 'shape' && S.cliff === 'water' && $('st2').textContent.includes('Water'), 'Apply Cliff > Water arms the shape tool: ' + $('st2').textContent);
    drawDown([-150, -60]); S.drawing.mouse = [-146, -60]; drawMove([-146, -60]); drawUp();
    const sw = shapes()[n0];
    ok &= say(sw && sw.type === 'chasm' && sw.water === true && sw.r === 4, 'a water circle: ' + JSON.stringify(sw));
    document.querySelector('#tab_terrain [data-draw="polygon"]').click();
    document.querySelector('#tab_terrain [data-cliff="island"]').click();
    for (const p of [[-160, -100], [-150, -100], [-150, -90]]) drawDown(p);
    drawFinish();
    ok &= say(shapes()[n0 + 1] && shapes()[n0 + 1].type === 'island' && shapes()[n0 + 1].polygon.length === 3, 'an island polygon (Draw with: Polygon)');
    press('Escape');
    press(' ');
    ok &= say(S.tool === 'shape', 'Space: back to the tab\'s tool (' + S.tool + ')');
    press(' ');
    ok &= say(S.tool === 'select', 'Space: Select');
    // Units: + Ward spot and + Mine by a click on the map, a list row selects and jumps
    press('u');
    const nw = (S.doc.wards || []).length, nwell = (S.doc.wells || []).length;
    [...document.querySelectorAll('#tab_units [data-add]')].find(a => a.dataset.add === '+ Ward spot').click();
    ok &= say(S.tool === 'ward', '+ Ward spot arms its tool');
    click([-120, -40]);
    ok &= say((S.doc.wards || []).length === nw + 1 && S.sel && S.sel.path && S.sel.path[0] === 'wards', 'a ward spot added by a click: ' + JSON.stringify(S.doc.wards[nw]));
    [...document.querySelectorAll('#tab_units [data-add]')].find(a => a.dataset.add === '+ Mine').click();
    click([-100, -40]); // on the walls: refused (EDUX6: fixed.open)
    ok &= say(S.doc.wells.length === nwell, 'a mine on the walls refused');
    click([-170, -60]); // in lane 1's corridor (no snap onto its edge's wall cells: EDUX6)
    ok &= say(S.doc.wells.length === nwell + 1 && S.doc.wells[nwell].kind === 'mine', 'a mine added: ' + JSON.stringify(S.doc.wells[nwell]));
    press('Escape');
    const guard = document.querySelector('#tab_units .li[data-kind="guardian"]');
    if (guard) guard.click();
    ok &= say(S.sel && S.sel.t === 'obj' && S.sel.path.join('.') === 'base.guardian' && Math.abs(S.view.x - S.doc.base.guardian[0]) < 0.01, 'the Guardian\'s row selects it and centres the view');
    ok &= say($('st3').textContent.startsWith('Guardian'), 'the status bar\'s selection: ' + $('st3').textContent);
    ok &= say($('selPreview').textContent.includes('Guardian'), 'the selection\'s preview: ' + $('selPreview').textContent);
    // Lanes: a knot from the list, Insert knot after (both lanes), undo
    press('l');
    const kn = lanes()[0].knots.length;
    document.querySelector('#tab_lanes .li[data-knot="1"]').click();
    ok &= say(S.sel && S.sel.t === 'knot' && S.sel.k === 1, 'a knot row selects lane 1\'s knot 2');
    [...document.querySelectorAll('#tab_lanes .cat a')].find(a => a.textContent === 'Insert knot after').click();
    ok &= say(lanes()[0].knots.length === kn + 1 && lanes()[1].knots.length === kn + 1, 'Insert knot after: both lanes have ' + (kn + 1));
    // the selection's Advanced section and its JSON (Advanced > Edit the Selection as JSON)
    select({ t: 'shape', i: n0 });
    ok &= say(openAdvanced() && $('inspector').querySelector('details.adv[open] textarea') === document.activeElement, 'Edit the Selection as JSON opens the selection\'s Advanced section');
    document.activeElement.blur(); // the keys below are the view's, not the text's
    for (let i = 0; i < 5; i++) undo();
    await settle();
    ok &= say(shapes().length === n0 && (S.doc.wards || []).length === nw && S.doc.wells.length === nwell && lanes()[0].knots.length === kn && S.report.ok, 'five undos: back as opened, passes');
    // Doodads: the next doodad's size and turn before placing (keys, Ctrl/Shift+wheel, the fields), Random turn
    press('d');
    await PR.loadNouns();
    await PR.until(() => PR.P.state !== 'loading', 120000);
    const P = PR.P, noun = (P.nouns.find(n => n.icon) || P.nouns[0] || {}).name;
    ok &= say(!!noun, 'the palette has doodads (' + P.nouns.length + ')');
    select(null);
    P.cur = noun;
    setTool('prop');
    const np = (S.doc.props || []).length, scale0 = S.view.scale, wheel = mods => {
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new WheelEvent('wheel', Object.assign({ deltaY: -100, clientX: r.left + 20, clientY: r.top + 20, bubbles: true, cancelable: true }, mods)));
    };
    press('r');
    press(']');
    wheel({ ctrlKey: true });
    wheel({ shiftKey: true });
    const g = ED.tools.prop.ghost();
    ok &= say(g && g.rot === 30 && g.scale === 1.21 && S.view.scale === scale0, `R, ], Ctrl+wheel, Shift+wheel: the ghost turns ${g && g.rot}° and sizes ${g && g.scale}, the view keeps its zoom`);
    ok &= say(/size 1\.21, turn 30°/.test($('st2').textContent) && $('tab_doodads').querySelector('[data-next=scale]').value === '1.21' && $('tab_doodads').querySelector('[data-next=rot]').value === '30',
      'the status bar and the Doodads tab\'s fields show it: ' + $('st2').textContent);
    const fld = $('tab_doodads').querySelector('[data-next=rot]');
    fld.value = '45';
    fld.dispatchEvent(new Event('change'));
    ok &= say(ED.tools.prop.ghost().rot === 45, 'the turn field sets the next turn');
    click([-130, -120]);
    click([100, 60]);
    const pa = S.doc.props[np], pb = S.doc.props[np + 1];
    ok &= say(pa && pa.rot === 45 && pa.scale === 1.21 && pb && pb.rot === -135 && pb.scale === 1.21 && pb.pos[0] < 0 && pb.pos[1] < 0,
      `placed as the ghost showed: ${JSON.stringify(pa)}; on team 2's half its source ${JSON.stringify(pb)} (turned 180)`);
    P.randomBox.click();
    const gr = ED.tools.prop.ghost().rot;
    click([-140, -110]);
    const pc = S.doc.props[np + 2];
    ok &= say(P.randomTurn && pc && pc.rot === gr && pc.scale === 1.21 && /random turn/.test($('st2').textContent), `Random turn: the ghost's dealt turn ${gr}° placed, the size kept`);
    press('R', { shiftKey: true });
    ok &= say(!P.randomTurn && !P.randomBox.checked && Math.abs(ED.tools.prop.ghost().rot - PR.normDeg(P.dealt - 15)) < 0.06,'Shift+R sets a turn: Random turn unticked');
    PR.setNext({ rot: 0, scale: 1 });
    setTool('select');
    for (let i = 0; i < 3; i++) undo();
    ok &= say((S.doc.props || []).length === np, 'three undos: the doodads gone');
    // Doodads > Scatter along the walls: no doodads picked, too few corners, a region over a wall edge (marked cells
    // and an estimate while drawing, the check's count after), a region without one (kept, selected, said so)
    press('d');
    await settle();
    const docS = snapshot(), msg = () => { const m = $('tab_doodads').querySelector('[data-scatter-msg]'); return m ? m.textContent : ''; };
    P.multi.clear();
    P.cur = '';
    $('tab_doodads').querySelector('[data-dtool="scatter"]').click();
    ED.tools.scatter.down([-190, -130], null);
    ok &= say(S.tool === 'scatter' && !S.drawing && /Shift\+click to add more/.test(msg()), 'no doodads picked: refused at the tool, said in the Doodads tab: ' + msg());
    P.cur = noun;
    ED.tools.scatter.down([-190, -130], null);
    ok &= say(msg() === '' && S.drawing, 'a doodad picked: the region starts, the message gone');
    ED.tools.scatter.down([-180, -130], null);
    drawFinish();
    ok &= say(/at least 3 corners/.test(msg()), 'two corners: refused, said in the tab: ' + msg());
    setTool('scatter');
    await PR.until(() => PR.scatterEstimate([[-1, -1], [-2, -1], [-2, -2]], null), 20000);
    const edge = [[-200, -140], [-140, -140], [-140, -95], [-200, -95]];
    for (const q of edge.slice(0, 3)) ED.tools.scatter.down(q, null);
    S.drawing.mouse = edge[3];
    const est1 = PR.scatterEstimate(edge, null);
    render();
    ok &= say(est1 && est1.n > 0 && est1.cells.length >= est1.n && /≈ \d+ placed/.test($('st2').textContent), `while drawing over a wall edge: ${est1 && est1.cells.length} cells marked, ≈ ${est1 && est1.n}; ${$('st2').textContent}`);
    ED.tools.scatter.down(edge[3], null);
    drawFinish();
    const kS = (S.doc.scatter || []).length - 1;
    await settle();
    const placedS = (S.placed || []).filter(q => q.path === 'scatter[' + kS + ']' && q.team === 1 && !q.card).length;
    ok &= say(S.sel && S.sel.t === 'scatter' && placedS > 0 && msg() === '' && $('inspector').querySelector('[data-estimate]'),
      `the region kept and selected; the check placed ${placedS} on team 1's half, the page estimated ${est1 && est1.n}`);
    setTool('scatter');
    const flat = [[-173, -123], [-167, -123], [-170, -117]]; // inside lane 1's corridor: open ground only
    for (const q of flat) ED.tools.scatter.down(q, null);
    drawFinish();
    await settle();
    const k2 = (S.doc.scatter || []).length - 1, placed2 = (S.placed || []).filter(q => q.path === 'scatter[' + k2 + ']').length;
    ok &= say(S.sel && S.sel.t === 'scatter' && S.sel.k === k2 && placed2 === 0 && msg() === PR.NO_EDGE && $('inspector').textContent.includes('No wall edge'),
      'a region without a wall edge: kept, selected, said at the tool and in its info (' + placed2 + ' placed)');
    setTool('select');
    for (let i = 0; i < 10 && snapshot() !== docS; i++) undo();
    ok &= say(snapshot() === docS, 'the scatters undone');
    // Terrain > Draw with, shared by the cliffs and the textures: the brush (a dab, a stroke, a stroke across the mirror
    // line split in two), a polygon; a texture polygon and circle; the draw mode kept when the material changes
    press('t');
    await settle();
    const docD = snapshot(), b0 = Object.assign({}, S.brush), up = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const stroke = pts => { click(pts[0]); for (const p of pts.slice(1)) click(p, 'mousemove'); up(); };
    S.brush.size = 4;
    document.querySelector('#tab_terrain [data-draw="brush"]').click();
    document.querySelector('#tab_terrain [data-material="shape"]').click(); // the switch: Cliff
    document.querySelector('#tab_terrain [data-cliff="wall"]').click();
    ok &= say(S.draw === 'brush' && S.tool === 'shape' && /^Brush 4 m · Wall/.test($('st2').textContent), 'Brush and Wall: ' + $('st2').textContent);
    let ns = shapes().length;
    stroke([[-130, -120]]);
    ok &= say(shapes().length === ns + 1 && shapes()[ns].type === 'wall' && shapes()[ns].r === 2, 'a click of the brush: a wall dab ' + JSON.stringify(shapes()[ns]));
    document.querySelector('#tab_terrain [data-cliff="chasm"]').click();
    ok &= say(S.draw === 'brush', 'the draw mode stays when the material changes');
    ns = shapes().length;
    stroke([[-140, -112], [-138, -112], [-136, -112], [-134, -112]]);
    const cs = shapes()[ns];
    ok &= say(shapes().length === ns + 1 && cs.type === 'chasm' && Array.isArray(cs.path) && cs.width === 4, 'a stroke of the brush: a chasm path ' + JSON.stringify(cs));
    document.querySelector('#tab_terrain [data-cliff="open"]').click();
    ns = shapes().length;
    stroke([[-12, -6], [-8, -2], [-4, 2], [0, 6], [4, 10], [6, 12]]);
    const pieces = shapes().slice(ns), centre = s => { const xs = s.path.map(p => p[0]), ys = s.path.map(p => p[1]); return (Math.min(...xs) + Math.max(...xs) + Math.min(...ys) + Math.max(...ys)) / 2; };
    ok &= say(pieces.length === 2 && pieces.every(s => s.type === 'open' && centre(s) <= 0.5) && S.undo.length > 0, 'a stroke across the mirror line: two open paths, both on team 1\'s half ' + JSON.stringify(pieces));
    document.querySelector('#tab_terrain [data-draw="polygon"]').click();
    document.querySelector('#tab_terrain [data-cliff="wall"]').click();
    ns = shapes().length;
    for (const p of [[-125, -125], [-121, -125], [-121, -121]]) drawDown(p);
    drawFinish();
    ok &= say(shapes()[ns] && shapes()[ns].type === 'wall' && shapes()[ns].polygon.length === 3, 'Polygon and Wall: a wall polygon');
    await settle();
    ok &= say(S.report.ok, 'the check passes: ' + (S.report.ok ? 'yes' : (S.report.findings || []).map(f => f.rule + '@' + f.path).join(' ')));
    document.querySelector('#tab_terrain [data-material="paint"]').click(); // the switch: Texture
    ok &= say(S.tool === 'paint' && S.lastMaterial === 'paint' && !$('paneGround').hidden && $('paneCliff').hidden && S.draw === 'polygon',
      'the Texture | Cliff switch on Texture: Apply Texture shown, the cliff kinds hidden, the draw mode kept');
    const paintBtn = [...document.querySelectorAll('#paneGround button')].find(x => x.textContent === 'Paint this ground');
    if (paintBtn) paintBtn.click();
    document.querySelector('#tab_terrain .tile[data-k="1"]').click();
    ok &= say(S.tool === 'paint' && S.draw === 'polygon' && $('st2').textContent.startsWith('Polygon'), 'a texture layer: the paint tool, the draw mode kept: ' + $('st2').textContent);
    const ls = () => S.doc.ground.layers[1].shapes || [], nl = ls().length;
    for (const p of [[-150, -150], [-140, -150], [-140, -140]]) ED.tools.paint.down(p, null);
    drawFinish();
    document.querySelector('#tab_terrain [data-draw="circle"]').click();
    ED.tools.paint.down([-120, -150], null); drawMove([-114, -150]); drawUp();
    const tp = ls()[nl], tc = ls()[nl + 1];
    ok &= say(tp && tp.polygon && tp.polygon.length === 3 && tp.soft === S.brush.soft && tc && tc.circle && tc.r === 6, 'a texture polygon and circle on the layer\'s mask: ' + JSON.stringify([tp, tc]));
    await settle();
    ok &= say(S.report.ok, 'the check passes with them');
    setTool('select');
    for (let i = 0; i < 30 && snapshot() !== docD; i++) undo();
    Object.assign(S.brush, b0);
    ok &= say(snapshot() === docD, 'undone: as before');
    ok &= await paletteOrder(say, press);
    // Lanes: one lane and back to two, each one undo step, the check passing; Bindings placed by hand go back to auto
    press('l');
    await settle();
    const doc0 = snapshot(), conf = window.confirm;
    let asked = 0;
    window.confirm = () => { asked++; return true; };
    const u0 = S.undo.length;
    document.querySelector('#tab_lanes [data-lanes="1"]').click();
    const k1 = lanes()[0].knots, self = k1.every((p, i) => Math.abs(p[0] + k1[k1.length - 1 - i][0]) < 0.01 && Math.abs(p[1] + k1[k1.length - 1 - i][1]) < 0.01);
    await settle();
    ok &= say(lanes().length === 1 && self && S.undo.length === u0 + 1 && asked === 1 && S.report.ok, `two lanes -> one: ${JSON.stringify(k1)}, its own mirror; one undo step; asked ${asked}; check ${S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule + '@' + f.path).join(' ')}`);
    document.querySelector('#tab_lanes [data-lanes="2"]').click();
    const L2 = lanes();
    await settle();
    ok &= say(L2.length === 2 && L2[1].id === 2 && L2[1].knots.every((p, i) => p[0] === -L2[0].knots[L2[0].knots.length - 1 - i][0]) && asked === 1 && S.report.ok,
      `one lane -> two: lane 2 is lane 1 mirrored and walked back; no question; check ${S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule + '@' + f.path).join(' ')}`);
    undo();
    undo();
    ok &= say(snapshot() === doc0, 'two undos: the lanes as they were');
    edit(() => materialize('bindings'));
    document.querySelector('#tab_lanes [data-lanes="1"]').click();
    await settle();
    ok &= say(S.doc.base.bindings === 'auto' && asked === 2 && S.report.ok, `with Bindings placed by hand: asked, back to "auto"; check ${S.report.ok ? 'passes' : 'fails'}`);
    undo();
    undo();
    window.confirm = conf;
    await settle();
    ok &= say(snapshot() === doc0 && S.report.ok, 'undone: as opened');
    // the view keys and the minimap
    select(null);
    fit();
    press('g');
    ok &= say(S.show.grid, 'G: the grid');
    press('g');
    press('p');
    ok &= say(S.bg === 'graph_player.png', 'P: the pathing picture');
    press('p');
    const mmr = mm.getBoundingClientRect();
    mm.dispatchEvent(new MouseEvent('mousedown', { clientX: mmr.left + mmr.width * 0.75, clientY: mmr.top + mmr.height * 0.25, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const q = (+S.doc.size || 400) / 4;
    ok &= say(Math.abs(S.view.x - q) < 1 && Math.abs(S.view.y - q) < 1, `a click on the minimap moves the view to (${r1(S.view.x)}, ${r1(S.view.y)})`);
    press('ArrowLeft');
    ok &= say(S.view.x < q - 1, 'an arrow key scrolls the view');
    click([10, 20], 'mousemove');
    const m1 = /^x (-?[\d.]+) {2}y (-?[\d.]+) {2}z (-?\d+) {2}(\w+)/.exec($('st1').textContent), px = dpr / S.view.scale + 0.1; // whole-pixel events: within a pixel
    ok &= say(m1 && Math.abs(+m1[1] - 10) < px && Math.abs(+m1[2] - 20) < px && m1[4] === groundKind([+m1[1], +m1[2]]).kind, 'the status bar\'s cursor: ' + $('st1').textContent);
    // the windows and the status bar's check
    $('st4').click();
    ok &= say(ED.isOpen('check') && $('findings').children.length > 0, 'the status bar\'s check opens Map Check');
    for (const [a, w] of [['map.properties', 'props'], ['map.options', 'options'], ['map.void', 'void'], ['ground.bake', 'gbake'], ['ground.layers', 'glayers'], ['ground.stamps', 'gstamps']]) {
      ED.act(a);
      ok &= say(ED.isOpen(w) && ED.windows[w].body.textContent.length > 10, `${a} opens the window ${ED.windows[w].title}`);
      ED.closeWindow(w);
    }
    ED.openWindow('mapjson');
    ok &= say(ED.windows.mapjson.body.querySelector('textarea').value.includes('"lanes"'), 'Edit the Map as JSON shows the document');
    ED.closeWindow('mapjson');
    ED.closeWindow('check');
    toggleMessages();
    ok &= say(!$('messages').classList.contains('hidden') && $('log').children.length > 0, 'View > Messages opens the log (' + $('log').children.length + ' lines)');
    toggleMessages();
    press('F1');
    ok &= say($('dlgHelp').open && $('helpBody').textContent.includes('Keys and Mouse'), 'F1: Keys and Mouse');
    $('dlgHelp').close();
    // Tab: the 3-D view and back
    press('Tab');
    await wait(50);
    ok &= say(ED.view === '3d' && document.querySelector('.view3d').classList.contains('on'), 'Tab: the 3-D view');
    press('Tab');
    ok &= say(ED.view === '2d' && $('view2d').classList.contains('on'), 'Tab: the 2-D view again');
    ok &= say(!updateDirty(), 'nothing left unsaved');
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.frame = selftest;

  renderMenubar();
  setTab('terrain');
  renderPreview();
  renderStatus();
  return { F, setTab, goTo, centre, groundKind, openMenu, closeMenus, help, renderStatus, toggleMessages };
})();

// The ground panel (painting a baked ground, map.json's ground section as mapc's MAPED-TEX format has it): the
// layers (add, reorder, delete, texture, the automatic rule and its edge), a brush that paints a layer's mask (size,
// softness, erase), stamps placed on the canvas, the author's own PNG pictures added to the package, the bake
// settings and the cliff; the 2-D canvas shows the bake (`mapc bake` of the draft after every passing check), the
// 3-D view makes its ground again by itself (its ground key holds the ground section).
//
// What a stroke writes: by default a mask shape, so map.json stays diff-able text: a drag is a "path" with the brush's
// "width" and its own "soft" (the points thinned to the brush's scale, 0.1 m), a click a "circle"; with *erase* the
// same with "erase": true. *Into the picture* paints the layer's grey "image" PNG instead (1024 px over the level's
// square, north up): for heavy painting; each stroke saves a new ground/paint_<layer>_<hash>.png into the package's
// scratch store, so undo is a change of the name; Save copies the named one into the package. *Flatten* turns a
// layer's strokes into its picture. Team 2's half is the live mirror: the compiler draws every mask part and stamp
// with its point mirror unless the layer's or stamp's "mirror" is false; the canvas draws the mirror dashed.
//
// It uses app.js's globals (S, ED, edit, render, w2s, s2w, h, api, log) and its hooks: ED.tools.paint and
// ED.tools.stamp, ED.on('render-bg' | 'render' | 'doc' | 'open' | 'checked' | 'tool'), ED.selftests.ground.
'use strict';

(function () {
  const GRASS = { game: 'environments/anshavar/textures/OutsouceGroundMap02_D.dds', archive: 'anshavar3.snap' };
  const DISC = { game: 'environments/anshavar/textures/Mine_Disc_01_D.dds', archive: 'anshavar3.snap' };
  const AUTO = ['', 'all', 'floor', 'high', 'slope', 'chasm', 'bushes', 'lanes', 'edge'];
  // the rules that derive the art from the gameplay shapes (mapc's DerivedRule): worked out again from the lanes, walls
  // and chasms at every bake; View > Hide Derived Art leaves them out (with the scatters' props)
  const DERIVED = new Set(['lanes', 'edge']);
  const DIRT = { procedural: 'dirt' };
  // the one-click layers of Apply Texture (the templates' own: CM_Ring's path and cliff foot, CM_Marsh's pond rim)
  const PRESETS = [
    { id: 'lanepath', label: '+ Lane path', tip: 'A lighter path down every lane (10 m wide); it follows the lanes when you move them',
      layer: { name: 'lane path', texture: DIRT, scale: 16, break: 0.6, tint: [1.45, 1.36, 1.18], vary: 0.1, auto: 'lanes', width: 10, soft: 3, noise: 1.2 } },
    { id: 'clifffoot', label: '+ Cliff foot', tip: 'A darker band along the foot of the walls (1 m up their slope to 3 m out); it follows the walls',
      layer: { name: 'cliff foot', texture: DIRT, scale: 12, tint: [0.72, 0.68, 0.64], opacity: 0.8, auto: 'edge', range: [-1, 3], along: 'walls', soft: 2, noise: 1.5 } },
    { id: 'chasmrim', label: '+ Chasm rim', tip: 'A dark rim round the chasms and ponds (1 m down to 2.5 m out); it follows the chasms',
      layer: { name: 'chasm rim', texture: DIRT, scale: 10, tint: [0.55, 0.52, 0.44], auto: 'edge', range: [-1, 2.5], along: 'chasms', soft: 2, noise: 1 } },
  ];
  S.hideDerived = false; // View > Hide Derived Art (the bake and the 3-D ground with ?derived=0, the scatters' props hidden)
  const RASTER = 1024; // a painted picture's side (pixels over the level's square)

  const G = {
    layer: 1, stamp: -1,
    brush: S.brush, // the brush the Terrain tab shares with the cliffs (app.js): size, soft, erase, raster, shape
    stroke: null, mouse: null, drag: null,
    stampRef: DISC, stampSize: 16,
    bake: null, bakeOn: true, bakeAlpha: 1, showMask: false, showStrokes: true,
    bakeBusy: false, bakeAgain: false, bakeKey: '', bakeN: 0, bakeMs: 0, ioBusy: '', exported: null,
    textures: null, texByPath: {}, thumbs: {}, imgs: {}, assets: [], raster: {},
  };

  // ---- the document ------------------------------------------------------------------------------------

  const gr = () => (S.doc && S.doc.ground && typeof S.doc.ground === 'object') ? S.doc.ground : null;
  const baked = () => !!gr() && gr().style === 'baked';
  const layers = () => (baked() && Array.isArray(gr().layers)) ? gr().layers : [];
  const stamps = () => (baked() && Array.isArray(gr().stamps)) ? gr().stamps : [];
  const cur = () => layers()[G.layer];
  // pic is the ground's picture (painted tiles under the layers) or null; with it every layer, the first too, has a mask
  const pic = () => (baked() && Array.isArray(gr().picture) && gr().picture.length) ? gr().picture : null;
  const firstMasked = () => pic() ? 0 : 1;
  const r1g = v => Math.round(v * 10) / 10;
  const half = () => (+S.doc.size || 400) / 2;

  function defaultLayers() {
    return [{ name: 'earth', texture: { procedural: 'dirt' }, scale: 18 },
      { name: 'grass', texture: Object.assign({}, GRASS), scale: 24, auto: 'high', soft: 3, noise: 2 }];
  }
  // starterLayers are the compiler's two default layers with larger repeats and "break" on, so a new painted ground
  // doesn't show its texture's repeats as a grid (MAPED-EDIT5: the plain defaults did, in the first bake).
  function starterLayers() {
    const ls = defaultLayers();
    Object.assign(ls[0], { scale: 40, break: 0.8 });
    Object.assign(ls[1], { scale: 32, break: 0.8 });
    return ls;
  }
  // makeBaked turns the map's ground into a painted one (its decals kept), with starter layers written out so they
  // can be edited.
  function makeBaked() {
    edit(d => {
      const old = d.ground && typeof d.ground === 'object' ? d.ground : {};
      d.ground = Object.assign({ style: 'baked', texels: 2048, tiles: 2, layers: starterLayers() }, old.decals ? { decals: old.decals } : {});
    });
    G.layer = 1;
    renderPane();
  }
  // ensureLayers writes the default layers out when a baked map names none.
  function ensureLayers(d) {
    if (Array.isArray(d.ground.picture) && d.ground.picture.length) { // over a picture no layer is implied
      if (!Array.isArray(d.ground.layers)) d.ground.layers = [];
    } else if (!Array.isArray(d.ground.layers) || !d.ground.layers.length) d.ground.layers = defaultLayers();
    return d.ground.layers;
  }

  function refName(t) {
    if (!t || typeof t !== 'object') return '(none)';
    if (t.game) return t.game.split('/').pop().replace(/\.dds$/i, '');
    if (t.file) return t.file.split('/').pop();
    if (t.rgb) return 'rgb ' + t.rgb.join(', ');
    if (t.procedural) return t.procedural;
    return '(none)';
  }
  function refURL(t, big) {
    if (!t) return '';
    if (t.file) return '/api/asset/' + S.pkg + '/' + t.file;
    if (t.game) return (big ? G.thumbs['512:' + t.game] : G.thumbs['128:' + t.game]) || '';
    return '';
  }
  function refColour(t) {
    if (t && t.rgb) return `rgb(${t.rgb.map(v => Math.round(v)).join(',')})`;
    if (t && t.procedural) return '#7a5a3c';
    return '#333';
  }
  // ruleText says where a layer's rule paints (the tiles' line, the tooltips); short: for a tile's 60-px line
  const isDerived = l => !!l && DERIVED.has(l.auto);
  const edgeRange = l => Array.isArray(l.range) && l.range.length === 2 ? l.range : [0, 6];
  const minus = v => String(v).replace('-', '−');
  const edgeOf = l => l.along === 'walls' ? 'walls' : l.along === 'chasms' ? 'chasms' : 'walls and chasms';
  function ruleText(l, short) {
    if (!l || !l.auto) return '';
    if (l.auto === 'lanes') return short ? 'follows lanes' : 'follows the lanes' + (l.width ? ` (${l.width} m wide)` : " (each lane's width)");
    if (l.auto === 'edge') {
      const r = edgeRange(l), span = `${minus(r[0])}–${minus(r[1])} m`;
      return short ? `${l.along === 'chasms' ? 'chasm' : l.along === 'walls' ? 'wall' : 'edge'} ${span}` : `follows the edge of the ${edgeOf(l)} (${span})`;
    }
    return { all: 'everywhere', floor: 'the floor', high: 'high ground', slope: 'slopes', chasm: 'in the chasms', bushes: 'under the bushes' }[l.auto] || 'rule: ' + l.auto;
  }

  // ---- pictures: the palette's thumbnails, the package's PNGs -------------------------------------------

  async function loadTextures() {
    if (G.textures) return G.textures;
    const res = await api('GET', '/api/textures');
    if (!res.ok) { log('textures: ' + res.error, 'err'); return []; }
    G.textures = res.textures || [];
    for (const t of G.textures) G.texByPath[t.path.toLowerCase()] = t;
    return G.textures;
  }
  const thumbWait = {};
  async function thumbs(paths, max) {
    max = max || 128;
    const pending = new Set(paths.filter(p => p && thumbWait[max + ':' + p]).map(p => thumbWait[max + ':' + p]));
    const want = [...new Set(paths.filter(p => p && !G.thumbs[max + ':' + p] && !thumbWait[max + ':' + p]))];
    for (let i = 0; i < want.length; i += 60) {
      const part = want.slice(i, i + 60);
      const req = api('POST', '/api/texture-pictures', { paths: part, max }).then(res => {
        for (const t of res.textures || []) if (t.url) G.thumbs[max + ':' + t.path] = t.url;
        part.forEach(p => { delete thumbWait[max + ':' + p]; });
      });
      part.forEach(p => { thumbWait[max + ':' + p] = req; });
      pending.add(req);
    }
    await Promise.all(pending); // also the requests another call started for these paths
  }
  async function loadAssets() {
    if (!S.pkg) return [];
    const res = await api('GET', '/api/assets/' + S.pkg);
    G.assets = res.assets || [];
    return G.assets;
  }
  // picture returns a loaded Image for a URL (render runs again when it arrives).
  function picture(url) {
    if (!url) return null;
    let im = G.imgs[url];
    if (!im) {
      im = G.imgs[url] = new Image();
      im.onload = () => render();
      im.src = url;
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  // addPicture stores a PNG in the package's scratch store; Save copies it into the package when map.json names it.
  async function addPicture(blob, name) {
    const base = (name || 'picture').replace(/\.png$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'picture';
    const res = await fetch(`/api/asset/${S.pkg}?name=ground/${base}.png`, { method: 'POST', body: blob });
    const j = await res.json().catch(() => ({ error: res.statusText }));
    if (!j.ok) { log('picture: ' + j.error, 'err'); return null; }
    await loadAssets();
    return j.file;
  }

  // ---- the texture picker --------------------------------------------------------------------------------

  let dlg = null;
  function picker(title, kinds, done) {
    if (!dlg) {
      dlg = h('dialog', { id: 'gTexDlg', class: 'gdlg' });
      document.body.append(dlg);
    }
    dlg.textContent = '';
    const body = h('div', { class: 'gpick' });
    const tabs = h('div', { class: 'gtabs' });
    const close = () => dlg.close();
    const pick = ref => { close(); done(ref); };
    const show = k => {
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      body.textContent = '';
      if (k === 'game') gameTab(body, pick);
      else if (k === 'package') packageTab(body, pick);
      else if (k === 'colour') {
        const inp = h('input', { type: 'color', value: '#8a7a5a' });
        body.append(h('p', { class: 'hint' }, 'One colour (no texture): for block-outs.'), inp,
          h('button', { onclick: () => { const v = inp.value; pick({ rgb: [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) }); } }, 'Use'));
      } else if (k === 'dirt') {
        body.append(h('p', { class: 'hint' }, "The tiled style's procedural earth."), h('button', { onclick: () => pick({ procedural: 'dirt' }) }, 'Use dirt'));
      }
    };
    for (const k of kinds) tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, { game: 'Game textures', package: 'Package PNGs', colour: 'Colour', dirt: 'Dirt' }[k]));
    dlg.append(h('h2', {}, title), tabs, body, h('menu', {}, h('button', { onclick: close }, 'Cancel')));
    show(kinds[0]);
    dlg.showModal();
  }
  function gameTab(body, pick) {
    const filter = h('input', { type: 'search', placeholder: 'filter (path words)', value: 'environments/' });
    const grid = h('div', { class: 'ggrid' });
    const count = h('span', { class: 'small' });
    body.append(h('div', { class: 'row' }, filter, count), grid);
    let seq = 0;
    const fill = async () => {
      const list = await loadTextures(), my = ++seq;
      const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = list.filter(t => words.every(w => t.path.toLowerCase().includes(w)));
      count.textContent = `${hits.length} of ${list.length}`;
      grid.textContent = '';
      const shown = hits.slice(0, 120);
      for (const t of shown) {
        const im = h('img', { alt: '', loading: 'lazy' });
        im.dataset.path = t.path;
        if (G.thumbs['128:' + t.path]) im.src = G.thumbs['128:' + t.path];
        grid.append(h('button', { class: 'gtex', title: `${t.path} (${t.archive}, ${t.w} x ${t.h} ${t.format})`, onclick: () => pick({ game: t.path, archive: t.archive }) },
          im, h('span', {}, t.path.split('/').pop().replace(/\.dds$/i, '')), h('span', { class: 'small' }, `${t.w}${t.alpha ? ' a' : ''}`)));
      }
      await thumbs(shown.map(t => t.path), 128);
      if (my !== seq) return;
      grid.querySelectorAll('img').forEach(im => { const u = G.thumbs['128:' + im.dataset.path]; if (u && !im.src) im.src = u; });
    };
    let timer = 0;
    filter.oninput = () => { clearTimeout(timer); timer = setTimeout(fill, 250); };
    fill();
  }
  function packageTab(body, pick) {
    const grid = h('div', { class: 'ggrid' });
    const file = h('input', { type: 'file', accept: '.png,image/png' });
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      const name = await addPicture(f, f.name);
      if (name) { log('added ' + name + ' (saved into the package with map.json)', 'ok'); fill(); }
    };
    body.append(h('p', { class: 'hint' }, 'Your own pictures (PNG, at most 4096 pixels a side): they go into the package\'s ground/ folder when you save.'),
      h('label', {}, 'Add a PNG... ', file), grid);
    const fill = async () => {
      grid.textContent = '';
      for (const a of await loadAssets()) {
        grid.append(h('button', { class: 'gtex', title: a.file + (a.saved ? '' : ' (not saved yet)'), onclick: () => pick({ file: a.file }) },
          h('img', { src: a.url, alt: '' }), h('span', {}, a.file.split('/').pop()), h('span', { class: 'small' }, a.w ? `${a.w} x ${a.h}` : '')));
      }
    };
    fill();
  }

  // ---- the rectangle cutter (a stamp's "rect": a piece of a bigger picture) ------------------------------

  async function cutter(st, done) {
    const ref = st.image || {};
    let w = 0, hh = 0, url = '';
    if (ref.game) {
      await loadTextures();
      const t = G.texByPath[ref.game.toLowerCase()];
      if (t) { w = t.w; hh = t.h; }
      await thumbs([ref.game], 1024);
      url = G.thumbs['1024:' + ref.game];
    } else if (ref.file) {
      const a = (await loadAssets()).find(x => x.file === ref.file);
      if (a) { w = a.w; hh = a.h; }
      url = refURL(ref);
    }
    if (!url || !w) { log('cut: the picture or its size is not known', 'err'); return; }
    if (!dlg) { dlg = h('dialog', { id: 'gTexDlg', class: 'gdlg' }); document.body.append(dlg); }
    dlg.textContent = '';
    const c = h('canvas', { width: 640, height: Math.round(640 * hh / w), class: 'gcut' });
    const info = h('span', { class: 'small' });
    const im = new Image();
    let rect = st.rect ? st.rect.slice() : [0, 0, w, hh], down = null;
    const k = 640 / w;
    const draw = () => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (im.complete) g.drawImage(im, 0, 0, c.width, c.height);
      g.strokeStyle = '#ff0'; g.lineWidth = 2;
      g.strokeRect(rect[0] * k, rect[1] * k, rect[2] * k, rect[3] * k);
      info.textContent = `rect [${rect.join(', ')}] of ${w} x ${hh}`;
    };
    im.onload = draw;
    im.src = url;
    const at = e => { const b = c.getBoundingClientRect(); return [Math.max(0, Math.min(w, Math.round((e.clientX - b.left) / k))), Math.max(0, Math.min(hh, Math.round((e.clientY - b.top) / k)))]; };
    c.onmousedown = e => { down = at(e); };
    c.onmousemove = e => {
      if (!down) return;
      const p = at(e);
      rect = [Math.min(down[0], p[0]), Math.min(down[1], p[1]), Math.max(1, Math.abs(p[0] - down[0])), Math.max(1, Math.abs(p[1] - down[1]))];
      draw();
    };
    c.onmouseup = () => { down = null; };
    dlg.append(h('h2', {}, 'Cut a piece: drag a rectangle'), c, h('div', {}, info), h('menu', {},
      h('button', { onclick: () => { dlg.close(); done(null); } }, 'Whole picture'),
      h('button', { onclick: () => dlg.close() }, 'Cancel'),
      h('button', { onclick: () => { dlg.close(); done(rect); } }, 'Use the rectangle')));
    draw();
    dlg.showModal();
  }

  // ---- strokes -----------------------------------------------------------------------------------------

  // simplify thins a stroke's points (Ramer-Douglas-Peucker) to tol metres.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bd = tol;
      for (let i = a + 1; i < b; i++) {
        const d = distSeg(pts[i], pts[a], pts[b]);
        if (d > bd) { bd = d; best = i; }
      }
      if (best >= 0) { keep[best] = true; stack.push([a, best], [best, b]); }
    }
    return pts.filter((p, i) => keep[i]);
  }
  function strokeShape(pts) {
    const b = G.brush, size = Math.max(0.5, b.size);
    let sh;
    const thin = simplify(pts, Math.max(0.15, size / 20)).map(p => [r1g(p[0]), r1g(p[1])]);
    const span = Math.max(...pts.map(p => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])));
    if ((pts.length < 2 || span < size / 4) && b.shape === 'square') { // a dab of the square brush
      const c = pts[0], hs = size / 2;
      sh = { polygon: [[r1g(c[0] - hs), r1g(c[1] - hs)], [r1g(c[0] + hs), r1g(c[1] - hs)], [r1g(c[0] + hs), r1g(c[1] + hs)], [r1g(c[0] - hs), r1g(c[1] + hs)]] };
    } else if (pts.length < 2 || span < size / 4) sh = { circle: [r1g(pts[0][0]), r1g(pts[0][1])], r: r1g(size / 2) };
    else sh = { path: thin, width: r1g(size) };
    sh.soft = r1g(b.soft);
    if (b.erase) sh.erase = true;
    return sh;
  }
  // canPaint says why the selected layer can't take a stroke ('' when it can).
  function canPaint() {
    if (!S.doc) return 'open a map';
    if (!baked()) return 'the ground is not painted yet: press "Paint this ground" (Terrain > Apply Texture)';
    if (!cur()) return 'select a layer';
    if (G.layer === 0 && !pic()) return 'the first layer lies under all others and has no mask: select another layer';
    return '';
  }
  function addStroke(pts) {
    const why = canPaint();
    if (why) { log('paint: ' + why, 'err'); return false; }
    const sh = strokeShape(pts), k = G.layer;
    edit(d => {
      const l = ensureLayers(d)[k];
      l.shapes = Array.isArray(l.shapes) ? l.shapes : [];
      l.shapes.push(sh);
    });
    return true;
  }

  // ---- painting into the layer's picture ----------------------------------------------------------------

  function rasterFor(k) {
    let r = G.raster[k];
    const l = layers()[k];
    if (!r) {
      const c = document.createElement('canvas');
      c.width = c.height = RASTER;
      r = G.raster[k] = { c, file: null, ready: false };
    }
    const want = (l && l.image) || '';
    if (r.file !== want) { // the document names another picture (undo, a new map): load it
      r.file = want;
      r.ready = false;
      const g = r.c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, RASTER, RASTER);
      if (want) {
        const im = new Image();
        im.onload = () => { if (r.file === want) { g.drawImage(im, 0, 0, RASTER, RASTER); r.ready = true; render(); } };
        im.onerror = () => { r.ready = true; };
        im.src = '/api/asset/' + S.pkg + '/' + want;
      } else r.ready = true;
    }
    return r;
  }
  const toPix = p => [(p[0] / (2 * half()) + 0.5) * RASTER, (0.5 - p[1] / (2 * half())) * RASTER];
  function dab(g, p, size, soft, erase) {
    const pxm = RASTER / (2 * half()), q = toPix(p);
    const outer = Math.max(0.5, (size / 2 + soft / 2) * pxm), inner = Math.max(0, (size / 2 - soft / 2) * pxm);
    const grad = g.createRadialGradient(q[0], q[1], inner, q[0], q[1], outer);
    const c = erase ? '0,0,0' : '255,255,255';
    grad.addColorStop(0, `rgba(${c},1)`);
    grad.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grad;
    g.beginPath(); g.arc(q[0], q[1], outer, 0, 2 * Math.PI); g.fill();
  }
  function rasterSegment(r, a, b) {
    const g = r.c.getContext('2d'), br = G.brush;
    const step = Math.max(0.25, br.size / 5), n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 1; i <= n; i++) dab(g, [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], br.size, br.soft, br.erase);
  }
  async function hashOf(blob) {
    const buf = await blob.arrayBuffer();
    if (window.crypto && crypto.subtle) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      return Array.from(d.slice(0, 5), x => x.toString(16).padStart(2, '0')).join('');
    }
    let x = 2166136261; // FNV-1a when there's no Web Crypto
    new Uint8Array(buf).forEach(v => { x = Math.imul(x ^ v, 16777619) >>> 0; });
    return x.toString(16).padStart(8, '0');
  }
  // commitRaster saves the layer's picture as a new file and points the layer at it (one undoable step).
  async function commitRaster(k, dropShapes) {
    const r = G.raster[k];
    const blob = await new Promise(res => r.c.toBlob(res, 'image/png'));
    const name = `paint_${k}_${await hashOf(blob)}`;
    const file = await addPicture(blob, name);
    if (!file) return null;
    r.file = file;
    edit(d => {
      const l = ensureLayers(d)[k];
      l.image = file;
      if (dropShapes) delete l.shapes;
    });
    return file;
  }
  // flatten draws the layer's strokes into its picture and drops them (the soft edges approximated by a blur).
  async function flatten() {
    const k = G.layer, l = cur();
    if (!l || !Array.isArray(l.shapes) || !l.shapes.length) { log('flatten: the layer has no strokes', 'err'); return; }
    const r = rasterFor(k);
    while (!r.ready) await new Promise(res => setTimeout(res, 30));
    const g = r.c.getContext('2d'), pxm = RASTER / (2 * half());
    for (const sh of l.shapes) {
      const soft = sh.soft !== undefined ? sh.soft : (l.soft !== undefined ? l.soft : 2);
      g.save();
      g.filter = soft > 0 ? `blur(${Math.max(0.5, soft * pxm / 2.5)}px)` : 'none';
      g.strokeStyle = g.fillStyle = sh.erase ? '#000' : '#fff';
      g.lineCap = g.lineJoin = 'round';
      let pts = sh.path, width = sh.width;
      if (sh.lane !== undefined) { const ln = laneById(sh.lane); pts = ln && ln.knots; width = sh.width || (ln && ln.width) || 10; }
      if (sh.circle) { const q = toPix(sh.circle); g.beginPath(); g.arc(q[0], q[1], sh.r * pxm, 0, 2 * Math.PI); g.fill(); }
      else if (sh.polygon) { g.beginPath(); sh.polygon.forEach((p, i) => { const q = toPix(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); }
      else if (Array.isArray(pts) && pts.length) {
        g.lineWidth = width * pxm;
        g.beginPath(); pts.forEach((p, i) => { const q = toPix(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
      }
      g.restore();
    }
    await commitRaster(k, true);
    log(`layer ${k}: ${l.shapes ? l.shapes.length : 0} strokes flattened into its picture`, 'ok');
  }

  // ---- the canvas tools --------------------------------------------------------------------------------

  // the texture tool: the Terrain tab's draw mode (app.js S.draw) on the chosen layer's mask: the brush strokes as
  // before; Polygon, Circle and Path go through app.js's drawing and come back as drawn(sh), a mask shape
  ED.tools.paint = {
    tab: 'terrain',
    status: () => `${drawLabel()} \u00B7 ${(cur() && cur().name) || 'layer ' + G.layer}${G.brush.erase ? ' (erase)' : ''}${G.brush.raster && S.draw === 'brush' ? ', into the picture' : ''}`,
    down(w, e) {
      const why = canPaint();
      if (why) { log('paint: ' + why, 'err'); return; }
      if (S.draw !== 'brush') { drawDown(w, e); return; }
      G.stroke = { pts: [w] };
      if (G.brush.raster) { const r = rasterFor(G.layer); G.stroke.raster = r; rasterSegment(r, w, w); }
      render();
    },
    move(w) {
      G.mouse = w;
      const s = G.stroke;
      if (s) {
        const last = s.pts[s.pts.length - 1];
        if (Math.hypot(w[0] - last[0], w[1] - last[1]) >= Math.max(0.3, G.brush.size / 8)) {
          if (s.raster) rasterSegment(s.raster, last, w);
          s.pts.push(w);
        }
      }
      render();
    },
    up() {
      const s = G.stroke;
      G.stroke = null;
      if (!s) return;
      if (G.mouse && s.pts.length > 1) s.pts.push(G.mouse);
      if (s.raster) commitRaster(G.layer, false);
      else addStroke(s.pts);
      render();
    },
    drawn(sh) { // a polygon, circle or path drawn on the layer's mask, with the brush's soft edge (and erase)
      const why = canPaint();
      if (why) { log('paint: ' + why, 'err'); return; }
      const m = JSON.parse(JSON.stringify(sh)), k = G.layer;
      m.soft = r1g(G.brush.soft);
      if (G.brush.erase) m.erase = true;
      edit(d => {
        const l = ensureLayers(d)[k];
        l.shapes = Array.isArray(l.shapes) ? l.shapes : [];
        l.shapes.push(m);
      });
    },
  };

  // stampAt finds the stamp whose rectangle holds a point (the last drawn on top first); mirrored: its mirror's.
  function stampAt(w) {
    const list = stamps();
    for (let i = list.length - 1; i >= 0; i--) {
      const st = list[i];
      if (!Array.isArray(st.pos) || !Array.isArray(st.size)) continue;
      for (const m of [false, true]) {
        if (m && st.mirror === false) continue;
        const c = m ? [-st.pos[0], -st.pos[1]] : st.pos, rot = ((st.rot || 0) + (m ? 180 : 0)) * Math.PI / 180;
        const dx = w[0] - c[0], dy = w[1] - c[1];
        const u = dx * Math.cos(rot) + dy * Math.sin(rot), v = -dx * Math.sin(rot) + dy * Math.cos(rot);
        if (Math.abs(u) <= st.size[0] / 2 && Math.abs(v) <= st.size[1] / 2) return { i, mirrored: m };
      }
    }
    return null;
  }
  function addStamp(pos, ref, size, rect) {
    if (!baked()) { log('stamp: the ground is not painted yet', 'err'); return -1; }
    const st = { image: Object.assign({}, ref || G.stampRef), pos: [r1g(pos[0]), r1g(pos[1])], size: [size || G.stampSize, size || G.stampSize] };
    if (rect) st.rect = rect;
    edit(d => { d.ground.stamps = Array.isArray(d.ground.stamps) ? d.ground.stamps : []; d.ground.stamps.push(st); });
    G.stamp = stamps().length - 1;
    renderPane();
    return G.stamp;
  }
  ED.tools.stamp = {
    tab: 'terrain',
    hint: 'Stamp: a click places the stamp\'s picture, a drag moves a stamp; Del deletes the chosen one. Esc ends.',
    status: () => 'Stamp: ' + refName(G.stampRef),
    down(w) {
      const hit = stampAt(w);
      if (hit) {
        G.stamp = hit.i;
        G.drag = { i: hit.i, mirrored: hit.mirrored, start: w, orig: stamps()[hit.i].pos.slice(), moved: false };
        renderPane();
        render();
        return;
      }
      addStamp(w);
    },
    move(w) {
      G.mouse = w;
      const dr = G.drag;
      if (dr) {
        let dx = w[0] - dr.start[0], dy = w[1] - dr.start[1];
        if (dr.mirrored) { dx = -dx; dy = -dy; }
        if (!dr.moved && Math.hypot(dx, dy) < 3 * vmpp(ED.views[S.press] || ED.active(), w)) return; // 3 pixels in the view dragged in
        if (!dr.moved) { pushUndo(); dr.moved = true; }
        stamps()[dr.i].pos = [r1g(dr.orig[0] + dx), r1g(dr.orig[1] + dy)];
        changed(true);
      }
      render();
    },
    up() {
      const dr = G.drag;
      G.drag = null;
      if (dr && dr.moved) { scheduleCheck(); renderPane(); }
    },
  };

  // ---- drawing on the 2-D canvas -------------------------------------------------------------------------

  ED.on('render-bg', g => {
    if (!S.doc || !baked()) return;
    if (G.bakeOn && G.bake && G.bake.img.complete && G.bake.img.naturalWidth) {
      const a = w2s([-G.bake.half, G.bake.half]), b = w2s([G.bake.half, -G.bake.half]);
      g.save();
      g.globalAlpha = G.bakeAlpha;
      g.drawImage(G.bake.img, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      g.restore();
    }
    const mk = G.showMask && G.bake && G.bake.masks[G.layer];
    if (mk && mk.complete && mk.naturalWidth) {
      const a = w2s([-G.bake.half, G.bake.half]), b = w2s([G.bake.half, -G.bake.half]);
      g.save();
      g.globalAlpha = 0.6;
      g.globalCompositeOperation = 'screen';
      g.drawImage(mk, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      g.restore();
    }
  });
  function pathLine(g, pts, mirror) {
    g.beginPath();
    pts.forEach((p, i) => { const q = w2s(mirror ? [-p[0], -p[1]] : p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
  }
  function drawMaskShape(g, sh, mirror, l) {
    const col = sh.erase ? '255,90,90' : '255,220,90';
    const sc = S.view.scale;
    g.save();
    g.globalAlpha = mirror ? 0.25 : 0.45;
    g.lineCap = g.lineJoin = 'round';
    if (mirror) g.setLineDash([6 * dpr, 6 * dpr]);
    if (sh.circle) {
      const q = w2s(mirror ? [-sh.circle[0], -sh.circle[1]] : sh.circle);
      g.fillStyle = `rgb(${col})`;
      g.beginPath(); g.arc(q[0], q[1], sh.r * sc, 0, 2 * Math.PI);
      mirror ? (g.strokeStyle = g.fillStyle, g.lineWidth = 1.5 * dpr, g.stroke()) : g.fill();
    } else if (sh.polygon) {
      g.fillStyle = `rgb(${col})`;
      pathLine(g, sh.polygon, mirror); g.closePath();
      mirror ? (g.strokeStyle = g.fillStyle, g.lineWidth = 1.5 * dpr, g.stroke()) : g.fill();
    } else {
      let pts = sh.path, width = sh.width;
      if (sh.lane !== undefined) { const ln = laneById(sh.lane); pts = ln && ln.knots; width = sh.width || (ln && ln.width) || 10; }
      if (!Array.isArray(pts) || !pts.length) { g.restore(); return; }
      g.strokeStyle = `rgb(${col})`;
      g.lineWidth = mirror ? 1.5 * dpr : Math.max(1, width * sc);
      pathLine(g, pts, mirror);
      g.stroke();
    }
    g.restore();
  }
  function drawStamp(g, st, i, mirror) {
    if (!Array.isArray(st.pos) || !Array.isArray(st.size)) return;
    const c = w2s(mirror ? [-st.pos[0], -st.pos[1]] : st.pos), sc = S.view.scale;
    const rot = ((st.rot || 0) + (mirror ? 180 : 0)) * Math.PI / 180;
    const w = st.size[0] * sc, hh = st.size[1] * sc;
    g.save();
    g.translate(c[0], c[1]);
    g.rotate(-rot);
    if (st.image && st.image.game && !G.thumbs['512:' + st.image.game] && !thumbWait['512:' + st.image.game]) thumbs([st.image.game], 512).then(render);
    const im = picture(refURL(st.image, true));
    if (im && !(G.bakeOn && G.bake)) { // the bake draws the stamps itself; before one, the picture
      g.globalAlpha = (st.opacity !== undefined ? st.opacity : 1) * (mirror ? 0.5 : 0.9);
      if (st.rect) {
        const t = st.image.game ? G.texByPath[st.image.game.toLowerCase()] : (G.assets.find(a => a.file === st.image.file) || {});
        const k = t && t.w ? im.naturalWidth / t.w : 1;
        g.drawImage(im, st.rect[0] * k, st.rect[1] * k, st.rect[2] * k, st.rect[3] * k, -w / 2, -hh / 2, w, hh);
      } else g.drawImage(im, -w / 2, -hh / 2, w, hh);
      g.globalAlpha = 1;
    }
    const on = i === G.stamp && S.tool === 'stamp';
    g.strokeStyle = on ? '#58a6ff' : '#e0c060';
    g.lineWidth = (on ? 2 : 1) * dpr;
    if (mirror) g.setLineDash([5 * dpr, 5 * dpr]);
    if (st.round) { g.beginPath(); g.ellipse(0, 0, w / 2, hh / 2, 0, 0, 2 * Math.PI); g.stroke(); } else g.strokeRect(-w / 2, -hh / 2, w, hh);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -hh / 2); g.stroke(); // its top (north at rot 0)
    g.restore();
  }
  ED.on('render', g => {
    if (!S.doc || !baked()) return;
    const paintMode = S.tool === 'paint', l = cur();
    if (l && G.showStrokes && (paintMode || S.tool === 'stamp' || G.pinned)) {
      if (l.image && G.brush.raster && paintMode) { // the picture being painted, over the level's square
        const r = rasterFor(G.layer), hf = half(), a = w2s([-hf, hf]), b = w2s([hf, -hf]);
        g.save(); g.globalAlpha = 0.35; g.globalCompositeOperation = 'screen';
        g.drawImage(r.c, a[0], a[1], b[0] - a[0], b[1] - a[1]);
        g.restore();
      }
      for (const sh of Array.isArray(l.shapes) ? l.shapes : []) {
        drawMaskShape(g, sh, false, l);
        if (l.mirror !== false) drawMaskShape(g, sh, true, l);
      }
    }
    if (paintMode || S.tool === 'stamp') {
      stamps().forEach((st, i) => { drawStamp(g, st, i, false); if (st.mirror !== false) drawStamp(g, st, i, true); });
    }
    const s = G.stroke;
    if (s && !s.raster && s.pts.length) { // the stroke being drawn, with its mirror
      const sh = { path: s.pts.concat(G.mouse ? [G.mouse] : []), width: G.brush.size, erase: G.brush.erase };
      drawMaskShape(g, sh, false, l);
      if (!l || l.mirror !== false) drawMaskShape(g, sh, true, l);
    }
    if (s && s.raster) {
      const r = s.raster, hf = half(), a = w2s([-hf, hf]), b = w2s([hf, -hf]);
      g.save(); g.globalAlpha = 0.45; g.globalCompositeOperation = 'screen';
      g.drawImage(r.c, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      g.restore();
    }
  });
  // the texture brush under the mouse: its size and, dashed, where its soft edge ends; through the view v (a preview)
  ED.previews.push(v => {
    if (!baked() || S.tool !== 'paint' || !G.mouse || S.draw !== 'brush') return;
    if (!v.project(G.mouse)) return;
    const g = v.overlay, sq = G.brush.shape === 'square';
    const outline = r => { if (sq) vsquare(v, G.mouse, r); else vring(v, G.mouse, r); g.stroke(); }; // draped in 3-D
    g.save();
    g.strokeStyle = G.brush.erase ? '#ff6b6b' : '#fff';
    g.lineWidth = 1.5 * dpr;
    outline(G.brush.size / 2);
    if (G.brush.soft > 0) {
      g.setLineDash([3 * dpr, 4 * dpr]);
      outline(G.brush.size / 2 + G.brush.soft / 2);
    }
    g.restore();
  });
  // 3-D (EDUX4; the 2-D canvas draws these in its 'render' handler above): the texture stroke being drawn and its
  // mirror as bands on the ground, and the stamps' outlines while the Paint or Stamp tool is armed
  ED.previews.push(v => {
    if (!v.drape || !S.doc || !baked()) return;
    const g = v.overlay, s = G.stroke, l = cur();
    g.save();
    if (s && !s.raster && s.pts.length) {
      const pts = s.pts.concat(G.mouse ? [G.mouse] : []);
      g.strokeStyle = G.brush.erase ? 'rgba(255,90,90,0.9)' : 'rgba(255,220,90,0.9)'; // its outline: the paint shows inside
      vband(v, pts, Math.max(0.5, G.brush.size));
      if (!l || l.mirror !== false) { g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = 1.5 * dpr; vpoly(v, pts.map(p => [-p[0], -p[1]])); g.stroke(); g.setLineDash([]); }
    }
    if (S.tool === 'paint' || S.tool === 'stamp') {
      stamps().forEach((st, i) => {
        if (!Array.isArray(st.pos) || !Array.isArray(st.size)) return;
        for (const m of st.mirror === false ? [false] : [false, true]) {
          const c = m ? [-st.pos[0], -st.pos[1]] : st.pos, rot = ((st.rot || 0) + (m ? 180 : 0)) * Math.PI / 180;
          const hw = st.size[0] / 2, hh = st.size[1] / 2, co = Math.cos(rot), si = Math.sin(rot);
          const at = (u, w) => [c[0] + u * co - w * si, c[1] + u * si + w * co];
          g.strokeStyle = i === G.stamp && S.tool === 'stamp' ? '#58a6ff' : '#e0c060';
          g.lineWidth = (i === G.stamp && S.tool === 'stamp' ? 2 : 1) * dpr;
          g.setLineDash(m ? [5 * dpr, 5 * dpr] : []);
          if (st.round) { const pts = []; for (let k = 0; k < 32; k++) { const a = 2 * Math.PI * k / 32; pts.push(at(hw * Math.cos(a), hh * Math.sin(a))); } vpoly(v, pts, true); }
          else vpoly(v, [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)], true);
          g.stroke();
          vpoly(v, [c, at(0, hh)]); g.stroke(); // its top (north at rot 0)
        }
      });
    }
    g.restore();
  });

  // ---- the bake preview ----------------------------------------------------------------------------------

  // the bake under the 2-D view now ({img, half, from: the map.json text it was baked from}), else null (relief.js)
  ED.bakeShown = () => (S.doc && baked() && G.bakeOn && G.bake && G.bake.img.complete && G.bake.img.naturalWidth ? G.bake : null);
  // what the live texture paint needs (relief.js): the stroke being drawn on a layer's mask (null for the picture's
  // brush, which shows its own), a texture's picture URL (a game texture's 512-px thumbnail once made: asked for here)
  // or flat colour, the first layer with a mask
  const thumbAsked = new Set();
  ED.groundLive = {
    stroke: () => {
      const s = G.stroke;
      if (S.tool !== 'paint' || !s || s.raster || !s.pts.length || !baked()) return null;
      return { k: G.layer, sh: { path: s.pts.concat(G.mouse ? [G.mouse] : []), width: G.brush.size, soft: G.brush.soft, erase: G.brush.erase || undefined } };
    },
    texURL(t) {
      const u = refURL(t, true);
      if (!u && t && t.game && !thumbAsked.has(t.game)) { thumbAsked.add(t.game); thumbs([t.game], 512).then(() => { render(); if (typeof V3D !== 'undefined') V3D.redraw(); }); }
      return u;
    },
    colour: refColour,
    first: () => firstMasked(),
  };
  const bakeKey = () => S.doc ? JSON.stringify([S.doc.size, S.doc.terrain, S.doc.lanes, S.doc.base, S.doc.wells, S.doc.ground, !!S.hideDerived]) : '';
  const bakeURL = pkg => '/api/bake/' + pkg + (S.hideDerived ? '?derived=0' : ''); // without the derived art: mapc bake --no-derived
  async function runBake() {
    if (!S.pkg || !baked()) return;
    const key = bakeKey();
    if (key === G.bakeKey) return;
    if (G.bakeBusy) { G.bakeAgain = true; return; }
    G.bakeBusy = true;
    status();
    const pkg = S.pkg, t0 = performance.now(), from = S.checkedJSON || ''; // the draft it bakes (the live preview's base)
    let res;
    G.bakeURL = bakeURL(pkg);
    try { res = await api('POST', G.bakeURL); } catch (e) { res = { ok: false, error: String(e) }; }
    G.bakeBusy = false;
    if (pkg === S.pkg && res.ok) {
      const img = new Image(), masks = {};
      img.onload = () => { G.bake = { img, half: res.half_m, masks, n: res.n, from }; G.bakeN = res.n; render(); status(); };
      img.src = res.url + 'ground.png';
      for (let k = firstMasked(); k < layers().length; k++) { const m = new Image(); m.src = res.url + 'mask_' + k + '.png'; masks[k] = m; }
      G.bakeKey = key;
      G.bakeMs = Math.round(performance.now() - t0);
    } else if (pkg === S.pkg) {
      G.bakeKey = key; // don't retry the same document
      log('bake: ' + (res.error || JSON.stringify(res.result || res).slice(0, 300)), 'err');
    }
    status();
    if (G.bakeAgain) { G.bakeAgain = false; runBake(); }
  }

  // ---- the panes: Terrain > Apply Texture (the layers as tiles, erase, the stamps) and Brush; the windows Ground Layers
  // in Detail and Stamps in Detail (Advanced) and Ground Bake and Cliff (Map); the menus' actions -----------------------

  // (EDUX11: Apply Texture shows only while the Terrain tab's switch says Texture; its brush settings and Erase are in
  // ED.drawSettings, under the draw mode: frame.js's Draw with group)
  const pane = ED.addPane('terrain', 'Apply Texture', 12);
  const sec = pane.parentNode;
  sec.id = 'paneGround';
  pane.classList.add('gpane');
  sec.firstChild.append(h('span', { class: 'k small' }, 'the ground layers'));
  const brushPane = ED.drawSettings || h('div');
  brushPane.classList.add('gpane');
  const layersWin = ED.window('glayers', 'Ground Layers in Detail');
  const stampsWin = ED.window('gstamps', 'Stamps in Detail');
  const bakeWin = ED.window('gbake', 'Ground Bake and Cliff');
  for (const w of [layersWin, stampsWin, bakeWin]) w.classList.add('gpane');
  const fileIn = h('input', { type: 'file', accept: '.png,image/png', multiple: true, style: 'display:none', onchange: e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importGround(fs); } });
  document.body.append(fileIn);
  const statusEl = h('div', { class: 'small gstatus' });
  const statusEl2 = h('div', { class: 'small gstatus' });
  function status() {
    let t = !baked() ? 'not painted' : G.bakeBusy ? 'baking...' : G.bake ? `bake ${G.bakeN} shown (${G.bakeMs} ms)` : 'no bake yet';
    if (baked() && S.hideDerived) t += '; derived art hidden (View)';
    statusEl.textContent = statusEl2.textContent = t;
    document.body.dataset.groundBake = G.bakeBusy ? 'busy' : G.bake ? 'ready' : 'none';
  }
  const needBaked = what => { if (!S.doc) { log('open a map first', 'err'); return false; } if (!baked()) { log(what + ': the ground is not painted yet (Terrain > Apply Texture: Paint this ground)', 'err'); return false; } return true; };
  ED.actions['ground.bakeOn'] = () => { G.bakeOn = !G.bakeOn; renderPane(); render(); };
  ED.flags['ground.bakeOn'] = () => G.bakeOn;
  ED.actions['ground.mask'] = () => { G.showMask = !G.showMask; renderPane(); render(); };
  ED.flags['ground.mask'] = () => G.showMask;
  ED.actions['ground.raster'] = () => { G.brush.raster = !G.brush.raster; renderPane(); render(); };
  ED.flags['ground.raster'] = () => G.brush.raster;
  // View > Hide Derived Art: the bake (here) and the 3-D ground (view3d.js) again without the rules lanes and edge, the
  // scatters' props hidden in both views (props.js); off again, the plain requests
  ED.actions['ground.hideDerived'] = () => {
    S.hideDerived = !S.hideDerived;
    if (S.report && S.report.ok) runBake();
    ED.emit('derived', S.hideDerived);
    renderPane(); render();
    if (typeof V3D !== 'undefined') V3D.redraw();
    log(S.hideDerived ? 'derived art hidden: the lane paths, the edge bands and the scattered doodads' : 'derived art shown again', 'ok');
  };
  ED.flags['ground.hideDerived'] = () => !!S.hideDerived;
  ED.actions['ground.layers'] = () => ED.openWindow('glayers');
  ED.actions['ground.stamps'] = () => ED.openWindow('gstamps');
  ED.actions['ground.bake'] = () => ED.openWindow('gbake');
  ED.actions['ground.export'] = () => { if (needBaked('export')) { ED.openWindow('glayers'); exportGround(); } };
  ED.actions['ground.import'] = () => { if (needBaked('import')) fileIn.click(); };
  ED.actions['ground.flatten'] = () => { if (needBaked('flatten')) flatten(); };

  // field makes a labelled input bound to obj()[key]; an empty input removes the member.
  function field(label, obj, key, opt) {
    opt = opt || {};
    const o = obj();
    const v = o ? o[key] : undefined;
    const inp = h('input', { type: opt.type || 'number', step: opt.step || 'any', min: opt.min, max: opt.max, placeholder: opt.def !== undefined ? String(opt.def) : '', title: opt.tip || '' });
    if (opt.type === 'checkbox') inp.checked = v === undefined ? !!opt.def : !!v;
    else if (v !== undefined) inp.value = Array.isArray(v) ? v.join(', ') : v;
    inp.onchange = () => {
      edit(() => {
        const t = obj();
        if (!t) return;
        if (opt.type === 'checkbox') { if (inp.checked === !!opt.def) delete t[key]; else t[key] = inp.checked; return; }
        if (inp.value.trim() === '') { delete t[key]; return; }
        if (opt.list) { const a = inp.value.split(/[ ,]+/).filter(Boolean).map(Number); if (a.every(Number.isFinite)) t[key] = a; return; }
        if (opt.type === 'text') { t[key] = inp.value; return; }
        const n = Number(inp.value);
        if (Number.isFinite(n)) t[key] = n;
      });
      renderPane();
    };
    return h('label', { class: 'gf' + (opt.type === 'checkbox' ? ' gcheck' : '') }, label + ' ', inp);
  }
  function texButton(ref, onPick, kinds, title) {
    const sw = h('span', { class: 'gsw' });
    const url = refURL(ref);
    if (url) sw.append(h('img', { src: url, alt: '' }));
    else sw.style.background = refColour(ref);
    if (ref && ref.game && !url) thumbs([ref.game]).then(() => { const u = refURL(ref); if (u) { sw.textContent = ''; sw.append(h('img', { src: u, alt: '' })); } });
    return h('button', { class: 'gtexbtn', title: ref && ref.game ? ref.game + ' (' + ref.archive + ')' : '', onclick: () => picker(title, kinds, onPick) }, sw, ' ' + refName(ref));
  }
  ED.texButton = texButton; // the void panel's backdrop (void.js) picks its texture with the same dialog
  // swatch: a texture's thumbnail (filled in by fillThumbs once it is made)
  function swatch(ref, cls) {
    const sw = h('span', { class: 'gsw' + (cls ? ' ' + cls : '') });
    const u = refURL(ref);
    if (u) sw.append(h('img', { src: u, alt: '' })); else sw.style.background = refColour(ref);
    if (!u && ref && ref.game) sw.dataset.path = ref.game;
    return sw;
  }
  function fillThumbs(roots) {
    const gl = [];
    layers().forEach(l => { if (l.texture && l.texture.game) gl.push(l.texture.game); });
    if (!gl.length) return;
    thumbs(gl).then(() => roots.forEach(root => root.querySelectorAll('.gsw[data-path]').forEach(sw => {
      const url = G.thumbs['128:' + sw.dataset.path];
      if (url && !sw.firstChild) { sw.style.background = ''; sw.append(h('img', { src: url, alt: '' })); }
    })));
  }

  function renderPane() {
    status();
    renderTexture();
    renderBrush();
    renderLayersWin();
    renderStampsWin();
    renderBakeWin();
  }
  const notPainted = () => [h('p', { class: 'hint' }, `The ground's style is "${(gr() && gr().style) || 'tiled'}": one texture per triangle. A painted ground is baked from texture layers, a brush and stamps.`),
    h('button', { onclick: makeBaked }, 'Paint this ground')];

  // Terrain > Apply Texture: the layers as tiles (top first; a click arms the brush on it), + New layer, Erase, the stamps
  function renderTexture() {
    pane.textContent = '';
    sec.hidden = S.lastMaterial !== 'paint';
    sec.classList.toggle('armed', S.tool === 'paint' || S.tool === 'stamp');
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    if (!baked()) { pane.append(...notPainted()); return; }
    const ls = layers();
    if (G.layer >= ls.length) G.layer = ls.length - 1;
    const tiles = h('div', { class: 'tiles' });
    for (let k = ls.length - 1; k >= 0; k--) {
      const l = ls[k], drv = isDerived(l) && k >= firstMasked();
      const what = k === 0 && !pic() ? 'the base: under all others' : drv ? ruleText(l) + ': painted again from the gameplay shapes at every bake' : l.auto ? 'rule: ' + ruleText(l) : '';
      tiles.append(h('div', { class: 'tile' + (k === G.layer ? ' on' : '') + (drv ? ' drv' : ''), 'data-k': k, title: (l.name || 'layer ' + k) + (what ? ' (' + what + ')' : ''),
        onclick: () => { G.layer = k; setTool('paint'); renderPane(); render(); } },
      h('div', { class: 'sw' }, swatch(l.texture, 'big')), h('div', { class: 'nm' }, l.name || 'layer ' + k),
      drv ? h('div', { class: 'rl' }, ruleText(l, true)) : null));
    }
    tiles.append(h('div', { class: 'tile', title: 'A new layer above the selected one: pick its texture', 'data-new': '1',
      onclick: () => { if (ls.length >= 12) { log('at most 12 layers', 'err'); return; } picker('The new layer\'s texture', ['game', 'package', 'colour', 'dirt'], ref => addLayer(ref)); } },
    h('div', { class: 'sw' }, '+'), h('div', { class: 'nm' }, 'New layer...')));
    const b = G.brush;
    appendAll(pane, statusEl, tiles,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('a', { class: 'lnk', onclick: () => ED.openWindow('glayers') }, 'Layers in detail...')),
      h('div', { class: 'note' }, S.tool === 'paint' ? (canPaint() || `Painting ${(cur() && cur().name) || 'layer ' + G.layer}${b.raster ? ' into its picture' : ''}; team 2's half gets the mirror (drawn dashed).`)
        : 'Click a layer, then draw on the map (Draw with); team 2\'s half gets the mirror.'),
      isDerived(cur()) && G.layer >= firstMasked() ? h('div', { class: 'note gdrv' }, `${cur().name || 'layer ' + G.layer} ${ruleText(cur())}: every bake paints it again from the ${cur().auto === 'lanes' ? 'lanes' : edgeOf(cur())}, so editing them moves it; what you paint adds to it. Its fields: Advanced > Ground Layers in Detail.`) : null,
      // the layers that follow the gameplay shapes, one click each
      h('div', { class: 'row gpresets' }, h('span', { class: 'small', title: 'Layers the bake paints from the lanes, walls and chasms by itself' }, 'Follow the map'),
        ...PRESETS.map(p => h('button', { 'data-preset': p.id, title: p.tip, disabled: ls.length >= 12, onclick: () => addPreset(p) }, p.label))));
    // the stamps: pictures laid on the ground
    const sts = stamps();
    const srow = h('div', { class: 'row' }, h('span', { class: 'small' }, 'Stamps'),
      ...sts.map((st, i) => h('button', { class: i === G.stamp ? 'on' : '', title: refName(st.image) + (Array.isArray(st.pos) ? ` at (${st.pos.join(', ')})` : ''),
        onclick: () => { G.stamp = i; if (Array.isArray(st.pos)) FR.centre(st.pos); setTool('stamp'); renderPane(); render(); } }, String(i + 1))),
      texButton(G.stampRef, ref => { G.stampRef = ref; renderPane(); }, ['game', 'package'], 'The picture new stamps get'),
      h('button', { class: S.tool === 'stamp' ? 'on' : '', title: 'The Stamp tool: a click places one, a drag moves one', onclick: () => setTool('stamp') }, '+ Stamp'));
    pane.append(srow, h('div', { class: 'row' }, h('span', { class: 'grow' }), h('a', { class: 'lnk', onclick: () => ED.openWindow('gstamps') }, 'Stamps in detail...')));
    fillThumbs([pane]);
  }

  // Terrain > Draw with's settings (EDUX11: in ED.drawSettings, under the draw mode): only what the draw mode and the
  // material use: the size (2-32 m, [ ]) for Brush and Path (a Path's width), Circle/Square for the Brush, the soft
  // edge and Erase (X) for textures; a cliff drawn as a Polygon or Circle has none
  function renderBrush() {
    brushPane.textContent = '';
    const b = G.brush, tex = S.lastMaterial === 'paint', sized = S.draw === 'brush' || S.draw === 'path';
    const soft = h('span', { class: 'small' }, b.soft + ' m');
    appendAll(brushPane,
      sized ? h('div', { class: 'row sizes' }, h('span', { class: 'small', title: '[ and ] change it' }, S.draw === 'path' ? 'Width (m)' : 'Size (m)'),
        ...[2, 4, 8, 16, 32].map(v => h('button', { class: b.size === v ? 'on' : '', 'data-size': v, onclick: () => { b.size = v; renderPane(); updateHint(); render(); if (typeof FR !== 'undefined') FR.renderStatus(); } }, String(v))),
        [2, 4, 8, 16, 32].includes(b.size) ? null : h('span', { class: 'small' }, b.size + ' m'), h('span', { class: 'k small' }, h('kbd', {}, '['), ' ', h('kbd', {}, ']'))) : null,
      S.draw === 'brush' ? h('div', { class: 'row' }, h('span', { class: 'small' }, 'Shape'),
        ...[['circle', '\u25EF Circle', 'A round brush'], ['square', '\u25A1 Square', 'A square brush: a click lays a square; a stroke is a band like the round one\'s']].map(([v, t, tip]) =>
          h('button', { class: (b.shape || 'circle') === v ? 'on' : '', 'data-shape': v, title: tip, onclick: () => { b.shape = v; renderPane(); render(); if (typeof FR !== 'undefined') FR.renderStatus(); } }, t))) : null,
      tex ? h('div', { class: 'row', title: 'The texture\'s soft edge' }, h('span', { class: 'small' }, 'Soft edge'),
        h('input', { type: 'range', min: 0, max: 30, step: 0.5, value: b.soft, 'data-soft': '1', oninput: e => { b.soft = +e.target.value; soft.textContent = b.soft + ' m'; render(); } }), soft) : null,
      tex ? h('div', { class: 'row' },
        h('button', { class: b.erase ? 'on' : '', 'data-erase': '1', title: 'Erase the chosen layer where you paint (X)', onclick: () => { b.erase = !b.erase; if (S.tool !== 'paint') setTool('paint'); renderPane(); render(); } }, 'Erase ', h('kbd', {}, 'X')),
        b.raster ? h('span', { class: 'small' }, 'into the picture (Tools)') : null) : null);
  }

  // Advanced > Ground Layers in Detail: the bake shown, the ground picture, the layers' order and every field
  function renderLayersWin() {
    const pane = layersWin;
    pane.textContent = '';
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    if (!baked()) { pane.append(...notPainted()); return; }
    const ls = layers();
    pane.append(statusEl2, h('div', { class: 'row' },
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: G.bakeOn, onchange: e => { G.bakeOn = e.target.checked; render(); } }), ' show the bake'),
      h('input', { type: 'range', min: 0, max: 100, value: Math.round(G.bakeAlpha * 100), title: "the bake's opacity", oninput: e => { G.bakeAlpha = e.target.value / 100; render(); } }),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: G.showMask, onchange: e => { G.showMask = e.target.checked; render(); } }), ' mask')));

    // the layers, top first
    const list = h('div', { class: 'glayers' });
    for (let k = ls.length - 1; k >= 0; k--) {
      const l = ls[k];
      const n = Array.isArray(l.shapes) ? l.shapes.length : 0;
      const what = k === 0 && !pic() ? 'base' : [l.auto ? ruleText(l, isDerived(l)) : '', l.image ? 'picture' : '', n ? n + ' shapes' : ''].filter(Boolean).join(' + ') || 'no mask';
      list.append(h('div', { class: 'glayer' + (k === G.layer ? ' on' : ''), 'data-k': k, onclick: () => { G.layer = k; renderPane(); render(); } },
        swatch(l.texture), h('span', { class: 'gname' }, l.name || 'layer ' + k), h('span', { class: 'small' + (isDerived(l) && k >= firstMasked() ? ' gdrv' : ''), title: l.auto ? ruleText(l) : '' }, what),
        h('button', { title: 'Up (drawn later)', disabled: k === ls.length - 1, onclick: e => { e.stopPropagation(); moveLayer(k, 1); } }, '▲'),
        h('button', { title: 'Down', disabled: k === 0, onclick: e => { e.stopPropagation(); moveLayer(k, -1); } }, '▼'),
        h('button', { title: 'Delete the layer', disabled: ls.length < 2 && !pic(), onclick: e => { e.stopPropagation(); deleteLayer(k); } }, '×')));
    }
    if (pic()) list.append(h('div', { class: 'glayer', title: "The ground's picture: painted tiles under every layer" },
      h('span', { class: 'gsw', style: 'background:#6a5a40' }), h('span', { class: 'gname' }, 'picture'), h('span', { class: 'small' }, `${pic().length} tiles (base)`)));
    // the ground's picture: out to tiles and back in (painting in another program)
    const P = pic();
    appendAll(pane, h('div', { class: 'row' }, h('b', {}, 'Ground picture'), h('span', { class: 'grow' }),
      h('button', { title: "Write the bake's tiles at their full size (tile_<i>_<j>.png) to paint them in another program", disabled: !!G.ioBusy, onclick: () => exportGround() }, 'Export ground...'),
      h('button', { title: "Use painted tiles (tile_<i>_<j>.png, each exactly a tile's size) as the ground under the layers", disabled: !!G.ioBusy, onclick: () => fileIn.click() }, 'Import ground...')),
      h('p', { class: 'hint' }, G.ioBusy || (P ? `${P.length} painted tiles lie under the layers (no mirror: team 2's half as painted).` : 'none: the first layer is the ground.'),
        P ? h('button', { onclick: removePicture }, 'Remove the picture') : null),
      G.exported && G.exported.pkg === S.pkg ? h('p', { class: 'hint gexport' }, 'Exported to ', h('code', {}, G.exported.dir), ': ',
        ...G.exported.tiles_png.map(f => h('a', { href: G.exported.url + f, target: '_blank', download: f }, f + ' '))) : null);
    pane.append(h('div', { class: 'row' }, h('b', {}, 'Layers'), h('span', { class: 'grow' }),
      h('button', { title: 'A new layer above the selected one', disabled: ls.length >= 12, onclick: () => picker('The new layer\'s texture', ['game', 'package', 'colour', 'dirt'], ref => addLayer(ref)) }, '+ Layer')), list);

    // the selected layer
    const L = () => layers()[G.layer];
    const l = L();
    if (l) {
      const box = h('div', { class: 'gprops' });
      box.append(field('name', L, 'name', { type: 'text' }),
        h('div', { class: 'gf' }, 'texture ', texButton(l.texture, ref => { edit(() => { L().texture = ref; }); renderPane(); }, ['game', 'package', 'colour', 'dirt'], "The layer's texture")),
        field('repeat (m)', L, 'scale', { def: 16, min: 0.5, max: 500, tip: 'metres per repeat of the texture' }),
        field('turn (°)', L, 'rot', { def: 0 }),
        field('tint (r, g, b ×)', L, 'tint', { type: 'text', list: true, def: '1, 1, 1' }),
        field('vary', L, 'vary', { def: 0, min: 0, max: 1, step: 0.05, tip: 'brightness over 23-m noise' }),
        field('break', L, 'break', { def: 0, min: 0, max: 1, step: 0.05, tip: 'a second, turned copy breaks up the repeats' }),
        field('opacity', L, 'opacity', { def: 1, min: 0, max: 1, step: 0.05 }));
      if (G.layer >= firstMasked()) {
        const auto = h('select', { onchange: e => {
          edit(() => {
            const t = L(), v = e.target.value;
            if (v) t.auto = v; else delete t.auto;
            if (v !== 'lanes') delete t.width; // the other rules' members aren't read (mapc warns)
            if (v !== 'edge') { delete t.range; delete t.along; }
          });
          renderPane();
        } }, ...AUTO.map(a => h('option', { value: a, selected: (l.auto || '') === a }, a ? a + (DERIVED.has(a) ? ' (follows the map)' : '') : '(none)')));
        const n = Array.isArray(l.shapes) ? l.shapes.length : 0;
        box.append(h('b', {}, 'Mask'), h('label', { class: 'gf', title: 'An automatic rule the brush adds to' }, 'rule ', auto));
        if (l.auto === 'slope') box.append(field('slope (°)', L, 'slope', { def: 35, min: 5, max: 85 }));
        if (l.auto === 'lanes') box.append(field('width (m)', L, 'width', { min: 2, max: 120, tip: "the path's width, 2-120 m; empty: each lane's own width" }));
        if (l.auto === 'edge') {
          // range [from, to]: metres into the walkable ground from its edge (negative: up the wall's slope, down into the chasm)
          const rangeIn = (label, i, tip) => {
            const inp = h('input', { type: 'number', step: 'any', min: -20, max: 60, placeholder: String([0, 6][i]), title: tip, 'data-range': i });
            if (Array.isArray(l.range)) inp.value = l.range[i];
            inp.onchange = () => {
              edit(() => {
                const r = edgeRange(L()).slice(), v = inp.value.trim() === '' ? [0, 6][i] : Number(inp.value);
                if (!Number.isFinite(v)) return;
                r[i] = v;
                if (r[0] === 0 && r[1] === 6) delete L().range; else L().range = r;
              });
              renderPane();
            };
            return h('label', { class: 'gf', title: tip }, label + ' ', inp);
          };
          const along = h('select', { 'data-along': '1', onchange: e => { edit(() => { if (e.target.value) L().along = e.target.value; else delete L().along; }); renderPane(); } },
            ...[['', 'walls and chasms'], ['walls', 'walls'], ['chasms', 'chasms']].map(([v, t]) => h('option', { value: v, selected: (l.along || '') === v }, t)));
          box.append(rangeIn('from (m)', 0, 'where the band starts, metres out from the edge (-20 to 60; negative: up the wall\'s slope or down into the chasm)'),
            rangeIn('to (m)', 1, 'where the band ends, metres out from the edge (-20 to 60, more than from)'),
            h('label', { class: 'gf', title: 'measure from the walls\' edge, the chasms\' edge, or both' }, 'along ', along));
        }
        if (isDerived(l)) box.append(h('p', { class: 'hint' }, `This layer ${ruleText(l)}: every bake paints it again from the map. Edge soft feathers the band's edges, edge noise moves them in and out.`));
        box.append(field('edge soft (m)', L, 'soft', { def: 2, min: 0, max: 50, tip: "the rule's and the strokes' edge (a stroke's own softness wins)" }),
          field('edge noise (m)', L, 'noise', { def: 0, min: 0, max: 20 }),
          field('mirror for team 2', L, 'mirror', { type: 'checkbox', def: true }),
          h('div', { class: 'gf' }, `shapes and strokes: ${n}`, ' ',
            h('button', { disabled: !n, onclick: () => { edit(() => { delete L().shapes; }); renderPane(); } }, 'Clear'),
            h('button', { disabled: !n, title: 'Draw the strokes into the layer\'s picture (for heavy painting)', onclick: flatten }, 'Flatten into the picture')),
          h('div', { class: 'gf' }, 'picture: ' + (l.image || '(none)'), ' ',
            h('button', { disabled: !l.image, onclick: () => { edit(() => { delete L().image; }); renderPane(); } }, 'Clear'),
            h('button', { title: 'A grey PNG over the level\'s square, north up', onclick: () => picker('The mask picture (grey PNG)', ['package'], ref => { edit(() => { L().image = ref.file; }); renderPane(); }) }, 'Choose...')));
      } else box.append(h('p', { class: 'hint' }, 'The first layer is the ground under all others: it has no mask.'));
      pane.append(box);
    }
    fillThumbs([pane]);
  }

  // Advanced > Stamps in Detail: the list and every field of the chosen stamp
  function renderStampsWin() {
    const pane = stampsWin;
    pane.textContent = '';
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    if (!baked()) { pane.append(...notPainted()); return; }
    const sts = stamps();
    const slist = h('div', { class: 'glayers' });
    sts.forEach((st, i) => slist.append(h('div', { class: 'glayer' + (i === G.stamp ? ' on' : ''), onclick: () => { G.stamp = i; if (Array.isArray(st.pos)) FR.centre(st.pos); renderPane(); render(); } },
      h('span', { class: 'gname' }, refName(st.image)), h('span', { class: 'small' }, Array.isArray(st.pos) ? `(${st.pos.join(', ')})` : ''))));
    pane.append(h('div', { class: 'row' }, h('b', {}, 'Stamps'), h('span', { class: 'grow' }),
      texButton(G.stampRef, ref => { G.stampRef = ref; renderPane(); }, ['game', 'package'], 'The picture new stamps get'),
      h('button', { title: 'The Stamp tool: click places one, drag moves one', onclick: () => setTool('stamp') }, '+ Stamp')), slist);
    const T = () => stamps()[G.stamp];
    const st = T();
    if (st) {
      pane.append(h('div', { class: 'gprops' },
        h('div', { class: 'gf' }, 'picture ', texButton(st.image, ref => { edit(() => { T().image = ref; delete T().rect; }); renderPane(); }, ['game', 'package'], "The stamp's picture")),
        h('div', { class: 'gf' }, 'piece: ' + (st.rect ? `[${st.rect.join(', ')}]` : 'the whole picture'), ' ',
          h('button', { onclick: () => cutter(st, rect => { edit(() => { if (rect) T().rect = rect; else delete T().rect; }); renderPane(); }) }, 'Cut a piece...')),
        field('at (x, y)', T, 'pos', { type: 'text', list: true }),
        field('size (w, h m)', T, 'size', { type: 'text', list: true }),
        field('turn (°)', T, 'rot', { def: 0 }),
        field('opacity', T, 'opacity', { def: 1, min: 0, max: 1, step: 0.05 }),
        field('soft border (m)', T, 'soft', { def: 0, min: 0, max: 100 }),
        field('tint (r, g, b ×)', T, 'tint', { type: 'text', list: true, def: '1, 1, 1' }),
        field('round', T, 'round', { type: 'checkbox', def: false }),
        field('mirror for team 2', T, 'mirror', { type: 'checkbox', def: true }),
        h('button', { onclick: () => { const i = G.stamp; edit(d => { d.ground.stamps.splice(i, 1); if (!d.ground.stamps.length) delete d.ground.stamps; }); G.stamp = -1; renderPane(); } }, 'Delete the stamp')));
    } else if (sts.length) pane.append(h('p', { class: 'hint' }, 'Choose a stamp above, or click one on the map with the Stamp tool.'));
  }

  // Map > Ground Bake and Cliff: the bake's texels, tiles and minimap, the cliff material
  function renderBakeWin() {
    const pane = bakeWin;
    pane.textContent = '';
    if (!S.doc) { pane.append(h('p', { class: 'hint' }, 'Open a map.')); return; }
    if (!baked()) { pane.append(...notPainted()); return; }
    const GR = () => gr();
    const CL = () => gr() && gr().cliff;
    const bs = h('div', { class: 'gprops' },
      h('label', { class: 'gf', title: "a tile's side in texels" }, 'texels ', h('select', { onchange: e => { edit(() => { GR().texels = +e.target.value; }); } },
        ...[1024, 2048, 4096].map(v => h('option', { value: v, selected: (gr().texels || 2048) === v }, String(v))))),
      h('label', { class: 'gf' }, 'tiles a side ', h('select', { onchange: e => { edit(() => { GR().tiles = +e.target.value; }); } },
        ...[1, 2, 4].map(v => h('option', { value: v, selected: (gr().tiles || 2) === v }, String(v))))),
      h('label', { class: 'gf' }, 'minimap ', h('select', { onchange: e => { edit(() => { if (e.target.value === 'bake') delete GR().minimap; else GR().minimap = e.target.value; }); } },
        ...['bake', 'flat'].map(v => h('option', { value: v, selected: (gr().minimap || 'bake') === v }, v)))),
      h('label', { class: 'gf gcheck' }, 'cliff material ', h('input', { type: 'checkbox', checked: !!CL(), onchange: e => {
        edit(() => { if (e.target.checked) GR().cliff = { texture: { game: 'environments/anshavar/textures/Darius_cliffface_rocks_01_D.dds', archive: 'anshavar2.snap' }, scale: 10, slope: 50 }; else delete GR().cliff; });
        renderPane();
      } })));
    if (CL()) {
      bs.append(h('div', { class: 'gf' }, 'texture ', texButton(CL().texture, ref => { edit(() => { CL().texture = ref; }); renderPane(); }, ['game', 'package', 'colour', 'dirt'], "The cliff's texture")),
        field('repeat (m)', CL, 'scale', { def: 10, min: 6, max: 100 }), field('slope (°)', CL, 'slope', { def: 50, min: 20, max: 80 }),
        field('tint (r, g, b ×)', CL, 'tint', { type: 'text', list: true, def: '1, 1, 1' }));
    }
    pane.append(bs);
  }

  function addLayer(ref) {
    if (!baked()) return;
    const at = Math.max(firstMasked(), G.layer + 1);
    edit(d => {
      const ls = ensureLayers(d);
      ls.splice(at, 0, { name: 'layer ' + ls.length, texture: ref, scale: 16, shapes: [] });
    });
    G.layer = at;
    setTool('paint');
    renderPane();
    log(`layer ${at} added: paint its mask (Terrain > Apply Texture)`, 'ok');
  }
  // addPreset adds one of PRESETS: the lane path on top, an edge band just above the last layer of the older rules (so
  // the painted layers stay over it, as in the templates); the tool stays (the layer needs no painting)
  function addPreset(p) {
    if (!baked()) return;
    const ls = layers();
    if (ls.length >= 12) { log('at most 12 layers', 'err'); return; }
    let at = ls.length;
    if (p.layer.auto === 'edge') {
      at = firstMasked();
      ls.forEach((l, k) => { if (k === 0 || (l.auto && !DERIVED.has(l.auto)) || (isDerived(l) && l.auto === 'edge')) at = Math.max(at, k + 1); });
    }
    edit(d => { ensureLayers(d).splice(at, 0, JSON.parse(JSON.stringify(p.layer))); });
    G.layer = at;
    renderPane();
    log(`layer "${p.layer.name}" added: it ${ruleText(p.layer)}; its fields: Advanced > Ground Layers in Detail`, 'ok');
  }
  function moveLayer(k, dir) {
    const j = k + dir;
    if (j < 0 || j >= layers().length) return;
    edit(d => { const ls = d.ground.layers; [ls[k], ls[j]] = [ls[j], ls[k]]; });
    if (G.layer === k) G.layer = j;
    renderPane();
  }
  function deleteLayer(k) {
    if (layers().length < 2 && !pic()) return;
    edit(d => { d.ground.layers.splice(k, 1); if (!d.ground.layers.length) delete d.ground.layers; });
    G.layer = Math.min(G.layer, layers().length - 1);
    renderPane();
  }

  // ---- the ground's picture out and in -------------------------------------------------------------------

  // exportGround writes the draft's bake with every tile at its own size (`mapc bake --full`) into the editor's
  // export folder (<out>\ground\<map>\tile_<i>_<j>.png) and lists the tiles as links.
  async function exportGround() {
    if (!S.pkg || !baked()) return null;
    const pkg = S.pkg;
    G.ioBusy = 'exporting the tiles...';
    renderPane();
    clearTimeout(S.checkTimer);
    await runCheck(); // the draft is what the page shows
    let res;
    try { res = await api('POST', '/api/ground-export/' + pkg); } catch (e) { res = { ok: false, error: String(e) }; }
    G.ioBusy = '';
    if (!res.ok) log('export: ' + (res.error || JSON.stringify(res.result || res).slice(0, 300)), 'err');
    else {
      G.exported = Object.assign(res, { pkg });
      log(`exported ${res.tiles_png.length} tiles of ${res.texels} x ${res.texels} to ${res.dir} (the outer ${res.margin} pixels of each side are the neighbours' ground)`, 'ok');
    }
    renderPane();
    return res.ok ? res : null;
  }
  // importGround takes painted tiles (files named tile_<i>_<j>..., one per tile) as the ground's picture; drop (asked
  // when not given) removes the layers and stamps, which an exported picture already holds.
  async function importGround(files, drop) {
    if (!S.pkg || !baked()) return null;
    const n = +(gr().tiles || 2), want = n * n, byPos = {};
    for (const f of files) {
      const m = /tile_(\d+)_(\d+)/i.exec(f.name || '');
      if (!m || +m[1] >= n || +m[2] >= n) { log(`import: ${f.name} is not named tile_<i>_<j> for ${n} x ${n} tiles`, 'err'); return null; }
      byPos[+m[2] * n + +m[1]] = f;
    }
    if (Object.keys(byPos).length !== want) {
      log(`import: ${want} tiles are needed (tile_0_0.png to tile_${n - 1}_${n - 1}.png), ${Object.keys(byPos).length} chosen`, 'err');
      return null;
    }
    G.ioBusy = 'importing the tiles...';
    renderPane();
    const list = [];
    for (let k = 0; k < want; k++) {
      const res = await fetch(`/api/ground-tile/${S.pkg}?i=${k % n}&j=${Math.floor(k / n)}`, { method: 'POST', body: byPos[k] });
      const j = await res.json().catch(() => ({ error: res.statusText }));
      if (!j.ok) { G.ioBusy = ''; log('import: ' + byPos[k].name + ': ' + j.error, 'err'); renderPane(); return null; }
      list.push(j.file);
    }
    G.ioBusy = '';
    if (drop === undefined) {
      drop = !(layers().length || stamps().length) || confirm('Remove the layers and stamps? An exported picture already holds them; ' +
        'kept, they are drawn over it again (each layer then needs a mask).');
    }
    edit(d => {
      d.ground.picture = list;
      if (drop) { delete d.ground.layers; delete d.ground.stamps; }
    });
    G.layer = layers().length ? 0 : -1;
    renderPane();
    log(`ground picture: ${list.length} tiles` + (drop ? ' (the layers and stamps removed)' : ''), 'ok');
    return list;
  }
  // removePicture drops the picture; a ground left without layers gets the starter layers.
  function removePicture() {
    edit(d => {
      delete d.ground.picture;
      if (!Array.isArray(d.ground.layers) || !d.ground.layers.length) d.ground.layers = starterLayers();
    });
    G.layer = Math.min(Math.max(G.layer, 1), layers().length - 1);
    renderPane();
  }

  // ---- events --------------------------------------------------------------------------------------------

  let paneKey = '';
  ED.on('doc', () => {
    const k = JSON.stringify(gr());
    if (k !== paneKey) { paneKey = k; if (!G.drag) renderPane(); }
  });
  ED.on('open', () => {
    Object.assign(G, { layer: 1, stamp: -1, bake: null, bakeKey: '', raster: {}, assets: [] });
    paneKey = '';
    renderPane();
    loadAssets().then(() => render());
  });
  ED.on('checked', rep => { if (rep && rep.ok) runBake(); });
  let urlDone = false;
  const q = new URLSearchParams(location.search); // read now: opening a map rewrites the URL
  ED.on('open', () => setTimeout(() => { // ?tool=paint|stamp&layer=<k> on the first map opened (a bookmark's start)
    if (urlDone) return;
    urlDone = true;
    if (q.get('layer') && layers()[+q.get('layer')]) G.layer = +q.get('layer');
    if (q.get('tool') === 'paint' || q.get('tool') === 'stamp') setTool(q.get('tool'));
    renderPane();
  }, 0));
  ED.on('tool', () => { G.mouse = null; renderPane(); });
  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.ctrlKey || e.metaKey) return;
    if (S.tool === 'paint' || S.tool === 'shape') { // the shared brush; X erases textures
      const sized = () => { renderPane(); updateHint(); render(); if (typeof FR !== 'undefined') FR.renderStatus(); };
      if (e.key === '[') { G.brush.size = Math.max(1, G.brush.size - 1); sized(); }
      else if (e.key === ']') { G.brush.size = Math.min(60, G.brush.size + 1); sized(); }
      else if ((e.key === 'x' || e.key === 'X') && S.tool === 'paint') { G.brush.erase = !G.brush.erase; renderPane(); render(); }
    } else if (S.tool === 'stamp' && (e.key === 'Delete' || e.key === 'Backspace') && stamps()[G.stamp]) {
      const i = G.stamp;
      edit(d => { d.ground.stamps.splice(i, 1); if (!d.ground.stamps.length) delete d.ground.stamps; });
      G.stamp = -1;
      renderPane();
    }
  });
  renderPane();

  // ---- the self-test (?selftest=ground): a layer, strokes, erase, undo, a painted picture, a package PNG, a
  // stamp with a rect, the bake after each; =ground-save saves too ----------------------------------------------

  async function selftest(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const baked2 = async n => until(() => !G.bakeBusy && G.bakeN > n && G.bake && G.bake.img.complete, 120000);
    const pixel = (p) => { // the bake picture's colour at a place
      const c = document.createElement('canvas'), im = G.bake.img;
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const x = Math.round((p[0] / (2 * G.bake.half) + 0.5) * c.width), y = Math.round((0.5 - p[1] / (2 * G.bake.half)) * c.height);
      return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    };
    let ok = true;
    ok &= say(S.report && S.report.ok && baked(), 'opened ' + S.pkg + ': ' + (S.report && S.report.ok ? 'passes' : 'fails') + ', ground ' + (gr() && gr().style));
    ok &= say(await baked2(0), 'the first bake shown: ' + G.bakeN + ' (' + G.bakeMs + ' ms)');
    const n0 = layers().length, at = [-120, -96];
    const before = G.bake ? pixel(at) : [0, 0, 0];
    G.layer = n0 - 1;
    addLayer({ rgb: [230, 40, 200] });
    ok &= say(layers().length === n0 + 1 && S.tool === 'paint' && G.layer === n0, 'layer ' + G.layer + ' added, the Paint tool on');
    // a stroke through the tool's mouse code: down, moves, up
    Object.assign(G.brush, { size: 8, soft: 2, erase: false, raster: false, shape: 'circle' }); // the shared brush (S.brush) kept
    S.draw = 'brush';
    const tool = ED.tools.paint, pts = [[-140, -100], [-130, -98], [-120, -96], [-110, -94], [-100, -92]];
    tool.down(pts[0]); pts.slice(1).forEach(p => tool.move(p)); tool.up();
    const sh = cur().shapes;
    ok &= say(sh.length === 1 && sh[0].path && sh[0].width === 8 && sh[0].soft === 2, 'stroke: ' + JSON.stringify(sh[0]));
    // an eraser click
    G.brush.erase = true;
    tool.down([-100, -92]); tool.up();
    ok &= say(sh.length === 2 && cur().shapes[1].erase && cur().shapes[1].circle, 'eraser dab: ' + JSON.stringify(cur().shapes[1]));
    G.brush.erase = false;
    await settle();
    ok &= say(S.report.ok, 'check with the strokes: ' + (S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule).join(' ')));
    let n = G.bakeN;
    ok &= say(await baked2(n), 'bake ' + G.bakeN + ' after the strokes (' + G.bakeMs + ' ms)');
    const px = pixel(at);
    ok &= say(px[0] > px[1] + 80 && px[2] > px[1] + 60, `the painted path in the bake at (${at}): rgb ${px} (before ${before})`);
    const pm = pixel([-at[0], -at[1]]);
    ok &= say(pm[0] > pm[1] + 80, `its mirror at (${-at[0]}, ${-at[1]}): rgb ${pm}`);
    undo();
    ok &= say(cur().shapes.length === 1, 'undo: the eraser dab is gone');
    redo();
    ok &= say(cur().shapes.length === 2, 'redo: it is back');
    // painting into the picture
    G.brush.raster = true;
    tool.down([-60, -60]); [[-55, -62], [-50, -64], [-45, -66]].forEach(p => tool.move(p)); tool.up();
    ok &= say(await until(() => cur().image && /^ground\/paint_\d+_[0-9a-f]+\.png$/.test(cur().image), 10000), 'a stroke into the picture: ' + cur().image);
    const got = await fetch('/api/asset/' + S.pkg + '/' + cur().image);
    ok &= say(got.ok, 'the painted picture is served (' + got.status + ')');
    G.brush.raster = false;
    // a package PNG: a texture for the layer, made here
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#e0e040' : '#304080'; g.fillRect(x, y, 8, 8); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = await addPicture(blob, 'selftest checker.png');
    ok &= say(file === 'ground/selftest_checker.png' || /^ground\/selftest_checker_\d+\.png$/.test(file || ''), 'own PNG added: ' + file);
    // a stamp with a piece of a bigger picture
    setTool('stamp');
    const before2 = stamps().length;
    ED.tools.stamp.down([-90, -120]); ED.tools.stamp.up();
    ok &= say(stamps().length === before2 + 1 && G.stamp === before2, 'stamp placed: ' + JSON.stringify(stamps()[G.stamp]));
    edit(() => { stamps()[G.stamp].image = { file }; stamps()[G.stamp].rect = [8, 8, 32, 16]; stamps()[G.stamp].size = [16, 8]; });
    ED.tools.stamp.down([-90, -120]); ED.tools.stamp.move([-75, -114]); ED.tools.stamp.up();
    ok &= say(JSON.stringify(stamps()[G.stamp].pos) === '[-75,-114]', 'stamp dragged to ' + JSON.stringify(stamps()[G.stamp].pos));
    await settle();
    ok &= say(S.report.ok, 'check with the picture, the PNG and the stamp: ' + (S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule + ' ' + f.message).join('; ')));
    n = G.bakeN;
    ok &= say(await baked2(n), 'bake ' + G.bakeN + ' with them (' + G.bakeMs + ' ms)');
    const sp = pixel([-77, -112]) // the middle of a checker cell;
    ok &= say(sp[2] > sp[0] || sp[0] > 180, 'the stamp (a checker) in the bake: rgb ' + sp);
    // the layer moved down and back
    const k = G.layer; moveLayer(k, -1);
    ok &= say(G.layer === k - 1 && layers()[k - 1].texture.rgb, 'layer moved down');
    moveLayer(k - 1, 1);
    if (mode === 'ground-save') {
      const r = await save();
      ok &= say(r && r.written && (r.pictures || []).length >= 2, 'saved: ' + (r && JSON.stringify(r.pictures)));
    }
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  // ?selftest=groundio: the ground at 2 x 1024, Export, the tiles imported again (the layers and stamps dropped), the
  // check and the bake from the picture (the same colours), a layer painted over it, Remove; =groundio-save saves
  // the map with the picture
  async function selftestIO(mode) {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const baked2 = async n => until(() => !G.bakeBusy && G.bakeN > n && G.bake && G.bake.img.complete, 180000);
    const pixel = p => {
      const c = document.createElement('canvas'), im = G.bake.img;
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const x = Math.round((p[0] / (2 * G.bake.half) + 0.5) * c.width), y = Math.round((0.5 - p[1] / (2 * G.bake.half)) * c.height);
      return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    };
    const spots = [[-150, -150], [-100, 40], [120, 96], [0.5, -0.5], [60, -170]];
    let ok = true;
    ok &= say(S.report && S.report.ok && baked(), 'opened ' + S.pkg + ', ground ' + (gr() && gr().style));
    edit(d => { d.ground.texels = 1024; });
    await settle();
    let n = G.bakeN;
    ok &= say(S.report.ok && await baked2(n), 'bake ' + G.bakeN + ' at 2 x 1024');
    const before = spots.map(pixel);
    const ex = await exportGround();
    ok &= say(ex && ex.tiles_png.length === 4 && ex.texels === 1024 && document.querySelectorAll('.gexport a').length === 4, 'exported: ' + (ex && ex.tiles_png.join(' ') + ' to ' + ex.dir));
    const files = [];
    for (const f of (ex ? ex.tiles_png : [])) {
      const b = await (await fetch(ex.url + f)).blob();
      files.push(new File([b], f, { type: 'image/png' }));
    }
    ok &= say(files.length === 4 && files.every(f => f.size > 10000), 'the tiles fetched: ' + files.map(f => f.size).join(' ') + ' bytes');
    const bad = await importGround(files.slice(0, 3), true);
    ok &= say(bad === null && !pic(), 'three tiles refused');
    const list = await importGround(files.slice().reverse(), true);
    ok &= say(list && pic() && pic().length === 4 && /tile_1_0_[0-9a-f]{10}\.png$/.test(pic()[1]) && !layers().length && !stamps().length, 'imported: ' + JSON.stringify(pic()));
    await settle();
    n = G.bakeN;
    ok &= say(S.report.ok, 'check with the picture: ' + (S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule + ' ' + f.message).join('; ')));
    ok &= say(await baked2(n), 'bake ' + G.bakeN + ' from the picture (' + G.bakeMs + ' ms)');
    const after = spots.map(pixel);
    const diff = Math.max(...after.map((p, i) => Math.max(...p.map((v, q) => Math.abs(v - before[i][q])))));
    ok &= say(diff <= 12, `the bake from the picture as before: max difference ${diff} (${JSON.stringify(before)} / ${JSON.stringify(after)})`);
    // a layer over the picture, painted with the brush
    addLayer({ rgb: [230, 40, 200] });
    ok &= say(layers().length === 1 && G.layer === 0 && S.tool === 'paint' && !canPaint(), 'layer 0 added over the picture, paintable');
    Object.assign(G.brush, { size: 8, soft: 2, erase: false, raster: false, shape: 'circle' }); // the shared brush (S.brush) kept
    S.draw = 'brush';
    const tool = ED.tools.paint;
    tool.down([-140, -100]); [[-130, -98], [-120, -96], [-110, -94], [-100, -92]].forEach(p => tool.move(p)); tool.up();
    await settle();
    n = G.bakeN;
    ok &= say(S.report.ok && await baked2(n), 'check and bake with the stroke over the picture');
    const px = pixel([-120, -96]), pm = pixel([120, 96]);
    ok &= say(px[0] > px[1] + 80 && px[2] > px[1] + 60, `the stroke over the picture: rgb ${px}; its mirror ${pm}`);
    if (mode === 'groundio-save') {
      const r = await save();
      ok &= say(r && r.written && (r.pictures || []).filter(f => /tile_/.test(f)).length === 4, 'saved: ' + (r && JSON.stringify(r.pictures)));
    } else {
      removePicture();
      ok &= say(!pic() && layers().length === 1, 'picture removed, the layer kept');
      undo();
      ok &= say(pic() && pic().length === 4, 'undo: the picture is back');
    }
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  // ?open=CM_Marsh&selftest=derived: the layers that follow the gameplay shapes (EDUX7's rules lanes and edge): the
  // rule list, the tiles' marks, the fields (width; from, to, along), the presets, then View > Hide Derived Art (the
  // bake and the 3-D ground asked with ?derived=0, the scatters' props gone from both views, off again as before)
  async function selftestDerived() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 50)); } return true; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const baked2 = async n => until(() => !G.bakeBusy && G.bakeN > n && G.bake && G.bake.img.complete, 180000);
    const bakedNow = () => until(() => !G.bakeBusy && G.bakeKey === bakeKey() && G.bake && G.bake.n === G.bakeN && G.bake.img.complete, 180000); // the bake of the document as it is
    const grab = () => { // the bake at 256 x 256
      const c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d').drawImage(G.bake.img, 0, 0, 256, 256);
      return c.getContext('2d').getImageData(0, 0, 256, 256).data;
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n / (a.length / 4); };
    const change = (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); };
    const seen = [], fetch0 = window.fetch; // every request's URL (the bake's and the ground's query)
    window.fetch = (u, o) => { seen.push(String(u)); return fetch0(u, o); };
    const scat = () => PR.shown().filter(it => it.kind === 'scatter').length;
    const scatter3d = () => { // the props layer's 3-D instances of the scatters (their models loaded)
      const list = [];
      for (const fn of V3D.V.layers) fn({ gl: V3D.V.gl, list, modelFor: V3D.modelFor, M: V3D.M });
      return list.filter(i => /^prop\|scatter\[/.test(i.key || '')).length;
    };
    let ok = true;
    try {
      ok &= say(S.report && S.report.ok && baked(), 'opened ' + S.pkg + ': ' + (S.report && S.report.ok ? 'passes' : 'fails') + ', ground ' + (gr() && gr().style));
      ok &= say(await baked2(0), 'the first bake shown: ' + G.bakeN + ' (' + G.bakeMs + ' ms)');
      ok &= say(!/derived=0/.test(G.bakeURL || '') && !S.hideDerived, 'the plain bake request: ' + G.bakeURL);
      const ls = layers(), kLane = ls.findIndex(l => l.auto === 'lanes'), kFoot = ls.findIndex(l => l.auto === 'edge' && l.along === 'walls'),
        kRim = ls.findIndex(l => l.auto === 'edge' && l.along === 'chasms');
      ok &= say(kLane > 0 && kFoot > 0 && kRim > 0, `the derived layers: lane ${kLane}, cliff foot ${kFoot}, rim ${kRim}`);
      // the tiles: marked, with the rule under the name
      const tile = k => pane.querySelector(`.tile[data-k="${k}"]`), rl = k => (tile(k).querySelector('.rl') || {}).textContent || '';
      ok &= say(tile(kLane).classList.contains('drv') && rl(kLane) === 'follows lanes', `the lane tile marked: "${rl(kLane)}" (${tile(kLane).title})`);
      ok &= say(tile(kFoot).classList.contains('drv') && rl(kFoot) === 'wall −1–3 m', `the cliff foot's: "${rl(kFoot)}"`);
      ok &= say(rl(kRim) === 'chasm −1–2.5 m' && !tile(1).classList.contains('drv') && !tile(1).querySelector('.rl'), `the rim's: "${rl(kRim)}"; the grass (high) unmarked`);
      // the rule list and the lanes' width (Ground Layers in Detail)
      G.layer = 1; renderPane();
      ok &= say(!/null/.test(pane.textContent + layersWin.textContent), 'no "null" written in Apply Texture or the layers\' window (a layer without a rule chosen)');
      G.layer = kLane; renderPane();
      const sel = () => layersWin.querySelector('.gprops select');
      const opts = [...sel().options].map(o => o.value);
      ok &= say(opts.includes('lanes') && opts.includes('edge') && sel().value === 'lanes', 'the rule list: ' + opts.join(' ') + ', chosen ' + sel().value);
      ok &= say(pane.querySelector('.note.gdrv') && /follows the lanes \(10 m wide\)/.test(pane.querySelector('.note.gdrv').textContent), 'Apply Texture says why: ' + (pane.querySelector('.note.gdrv') || {}).textContent);
      const wIn = [...layersWin.querySelectorAll('.gprops label')].find(l => l.textContent.startsWith('width'));
      ok &= say(wIn && wIn.querySelector('input').value === '10', 'the lane layer\'s width field: ' + (wIn && wIn.querySelector('input').value));
      change(wIn.querySelector('input'), '14');
      ok &= say(layers()[kLane].width === 14, 'width 14 written: ' + JSON.stringify(layers()[kLane].width));
      change(sel(), 'edge');
      ok &= say(layers()[kLane].auto === 'edge' && layers()[kLane].width === undefined, 'the rule changed to edge: width dropped ' + JSON.stringify(layers()[kLane]).slice(0, 160));
      undo(); undo();
      ok &= say(layers()[kLane].auto === 'lanes' && layers()[kLane].width === 10, 'two undos: lanes, width 10 again');
      // the edge's fields: from, to, along
      G.layer = kRim; renderPane();
      const rIn = i => layersWin.querySelector(`input[data-range="${i}"]`), along = () => layersWin.querySelector('select[data-along]');
      ok &= say(rIn(0) && rIn(0).value === '-1' && rIn(1).value === '2.5' && along().value === 'chasms', `the rim's fields: from ${rIn(0) && rIn(0).value}, to ${rIn(1) && rIn(1).value}, along ${along() && along().value}`);
      change(rIn(0), '-2');
      ok &= say(JSON.stringify(layers()[kRim].range) === '[-2,2.5]', 'from -2: range ' + JSON.stringify(layers()[kRim].range));
      change(rIn(1), '');
      ok &= say(JSON.stringify(layers()[kRim].range) === '[-2,6]', 'to emptied (its default 6): range ' + JSON.stringify(layers()[kRim].range));
      change(along(), '');
      ok &= say(layers()[kRim].along === undefined && rl(kRim) === 'edge −2–6 m', `along both: the member gone, the tile "${rl(kRim)}"`);
      undo(); undo(); undo();
      ok &= say(JSON.stringify(layers()[kRim].range) === '[-1,2.5]' && layers()[kRim].along === 'chasms', 'three undos: the rim as before');
      // the presets: one click each
      const n0 = layers().length, tool0 = S.tool;
      pane.querySelector('[data-preset="lanepath"]').click();
      const top = layers()[layers().length - 1];
      ok &= say(layers().length === n0 + 1 && top.auto === 'lanes' && top.width === 10 && G.layer === n0 && S.tool === tool0, '+ Lane path: on top, ' + JSON.stringify(top));
      pane.querySelector('[data-preset="clifffoot"]').click();
      const at = G.layer, cf = layers()[at], below = layers()[at - 1];
      ok &= say(layers().length === n0 + 2 && cf.auto === 'edge' && cf.along === 'walls' && JSON.stringify(cf.range) === '[-1,3]' && below.auto === 'edge' && below.along === 'chasms',
        `+ Cliff foot: at ${at}, just above the ${below.name} (the older rules and edges under it, the painted layers over it)`);
      ok &= say(tile(at).classList.contains('drv') && rl(at) === 'wall −1–3 m', 'its tile marked: ' + rl(at));
      await settle();
      ok &= say(S.report.ok, 'the check with both: ' + (S.report.ok ? 'passes' : (S.report.findings || []).map(f => f.rule + ' ' + f.message).join('; ')));
      undo(); undo();
      ok &= say(layers().length === n0, 'two undos: the presets gone');
      await settle();
      ok &= say(await bakedNow(), 'the bake of the map as opened: ' + G.bakeN);
      const plain = grab(), at2 = [-176, -68], px = () => { const d = grab(), x = Math.round((at2[0] / (2 * G.bake.half) + 0.5) * 256), y = Math.round((0.5 - at2[1] / (2 * G.bake.half)) * 256); return Array.from(d.slice(4 * (y * 256 + x), 4 * (y * 256 + x) + 3)); };
      const lane0 = px();
      // View > Hide Derived Art: the bake without the rules, the scatters' props hidden
      const sc0 = scat(), live0 = PR.live().filter(it => it.kind === 'scatter');
      ok &= say(sc0 > 10, `the scatters' props drawn: ${sc0}`);
      // a team 1 marker far from every scatter's drawn region (whose outline a click selects too)
      const corners = (S.doc.scatter || []).flatMap(sc => Array.isArray(sc.polygon) ? sc.polygon : []);
      const away = it => Math.min(Infinity, ...corners.map(q => Math.hypot(it.pos[0] - q[0], it.pos[1] - q[1])));
      const m0 = live0.filter(it => it.team === 1).sort((a, b) => away(b) - away(a))[0], sm = w2s(m0.pos);
      const hitScatter = () => ED.hitItems.some(fn => { const r = fn(sm[0], sm[1], m0.pos); return r && r.sel && r.sel.t === 'scatter'; });
      ok &= say(hitScatter(), `a click on one at (${m0.pos.slice(0, 2).map(r1g)}) selects its scatter (${m0.path})`);
      let n = G.bakeN;
      seen.length = 0;
      ED.actions['ground.hideDerived']();
      ok &= say(S.hideDerived && ED.flags['ground.hideDerived']() && /\/api\/bake\/CM_Marsh\?derived=0$/.test(G.bakeURL) && seen.some(u => /\/api\/bake\/[^?]+\?derived=0$/.test(u)), 'Hide Derived Art on: the bake asked as ' + G.bakeURL);
      ok &= say(await bakedNow() && G.bakeN > n, 'bake ' + G.bakeN + ' without the derived art (' + G.bakeMs + ' ms)');
      const bare = grab(), d1 = differ(plain, bare), lane1 = px();
      ok &= say(d1 > 0.01 && Math.abs(lane1[0] - lane0[0]) + Math.abs(lane1[1] - lane0[1]) + Math.abs(lane1[2] - lane0[2]) > 30,
        `the bake changed: ${(d1 * 100).toFixed(1)} % of it, the lane at (${at2}) rgb ${lane0} -> ${lane1}`);
      ok &= say(scat() === 0 && PR.live().filter(it => it.kind === 'scatter').length === sc0, 'the scatters\' props hidden in 2-D; the check\'s markers kept');
      ok &= say(!hitScatter(), 'a click there hits no scatter prop');
      ok &= say(/derived art hidden/.test(statusEl.textContent), 'the ground status says so: ' + statusEl.textContent);
      // the 3-D view: its ground asked with ?derived=0, no scatter prop drawn
      seen.length = 0;
      ED.setView('3d');
      ok &= say(await until(() => V3D.settled() && V3D.V.groundKey === V3D.groundKey() && /derived=0$/.test(V3D.V.groundReq || ''), 240000),
        '3-D: the ground asked as ' + V3D.V.groundReq + ' (' + seen.filter(u => /\/api\/ground\//.test(u)).join(' ') + ')');
      await until(() => V3D.settled(), 60000);
      ok &= say(scatter3d() === 0, '3-D: no scatter prop drawn');
      // off again: the plain requests, the scatters back
      n = G.bakeN;
      const g0 = V3D.V.groundN;
      ED.actions['ground.hideDerived']();
      ok &= say(!S.hideDerived && !ED.flags['ground.hideDerived']() && !/derived/.test(G.bakeURL), 'Hide Derived Art off: the bake asked as ' + G.bakeURL);
      ok &= say(await until(() => V3D.V.groundN > g0 && V3D.settled() && V3D.V.groundKey === V3D.groundKey(), 240000) && !/derived/.test(V3D.V.groundReq),
        '3-D: the ground asked again as ' + V3D.V.groundReq);
      ok &= say(await until(() => scatter3d() > 0, 60000), '3-D: the scatters\' props drawn again: ' + scatter3d());
      ok &= say(await bakedNow() && G.bakeN > n, 'bake ' + G.bakeN + ' with the derived art');
      const d2 = differ(plain, grab());
      ok &= say(d2 < 0.001 && scat() === sc0 && hitScatter(), `the bake as before (${(d2 * 100).toFixed(2)} % differs), the scatters' ${scat()} props drawn and hit again`);
      ED.setView('2d');
    } finally { window.fetch = fetch0; }
    say(ok, ok ? 'selftest passed' : 'selftest failed');
    document.title = ok ? 'selftest passed' : 'selftest failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }
  ED.selftests = ED.selftests || {};
  ED.selftests.derived = selftestDerived;
  ED.selftests.groundio = selftestIO;
  ED.selftests['groundio-save'] = selftestIO;
  ED.selftests.ground = selftest;
  ED.selftests['ground-save'] = selftest;
})();

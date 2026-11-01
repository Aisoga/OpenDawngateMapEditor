// The 3-D view: the map's generated ground and the shipped models the level places, drawn with plain WebGL 1 from
// mapc's exports (glTF 2.0 + PNG in the server's cache, made from the player's own game files). It approximates the
// game's shaders: a texture times the material's tint and, for the vertex-lit shaders, the vertex colours, one sun
// and an ambient term; the effect shaders add or blend, the flora cuts out. The exact picture is the game's.
//
// Camera: "game" is the client's Main Gameplay Camera (its property list in the game's Other.package: pitch 60
// degrees, yaw 0, distance 63 m, FOV 47 degrees, near clip 5), centred on a target point; "free" orbits, pans and
// zooms. Scenes: the open map package (its derived objects follow the 2-D edits at once; the ground is made again by
// `mapc ground` after an edit of the layout) or a level of the copy (`mapc scene` of e.g. SM_Map_v5), for comparing.
//
// Plugs into app.js through ED (the 'view', 'open', 'preview', 'checked', 'select' events, ED.addView, and
// ED.selftests['3d']). Later parts draw more through V3D.addLayer(fn(ctx)): fn is called each frame with
// {gl, list, modelFor(url), M}: it may push instances {model: modelFor(url), mat (a game-space matrix times
// FROM_GLTF), scale} onto list, which is drawn after it (the props of MAPED-EDIT3, the painted ground of MAPED-EDIT4).
'use strict';

const V3D = (() => {
  const URLQ = new URLSearchParams(location.search);
  const GAME = { pitch: 60, yaw: 0, dist: 63, fov: 47, near: 5, far: 1500, offsetY: -2.6 };
  const V = {
    el: null, canvas: null, gl: null, prog: null, loc: {}, models: new Map(), textures: new Map(),
    scene: null, base: '/3d/', source: 'map', level: '', groundUrl: '', groundKey: '', groundBusy: false,
    groundAgain: false, groundN: 0, visible: false, dirty: false, pending: 0, layers: [],
    groundNext: '', groundNextN: 0, groundDoc: '', groundDocNext: '', // a newer ground loading (swapGround), the map.json texts the grounds come from
    cam: { tx: 0, ty: 0, tz: 0, yaw: GAME.yaw, pitch: GAME.pitch, dist: GAME.dist, fov: GAME.fov, mode: 'game' },
    stats: { draws: 0, culled: 0, parts: 0, models: 0, failed: 0 }, drag: null, status: null, frameNo: 0,
    follow: true, dressing: true,
    water: true, waterModel: null, vp: null, // the chasms' water planes (shown; their quad); the last frame's matrix
    mist: true, // the void's mist term (mistNow)
    grass: true, grassModel: null, grassKey: '', grassTex: null, grassTexState: '', // the bushes' blades
    heights: null, heightsN: 0, // the ground's heights (the last ground model's vertices), for what stands on it
    // EDUX3: the overlay (a 2-D canvas over the GL one: the selection's marks, the previews, the check's markers), the
    // camera of the last frame (pick's ray), a press in this view (no Follow the Selection for its own clicks), the
    // scene's instances by object (cached while the object stays put), the frames' times (the whole frame without
    // the overlay, the instance list's part of it, the overlay)
    ov: null, octx: null, snap: null, pressing: false, sceneCache: null, frameMs: [], listMs: [], overlayMs: [],
  };

  // ---- matrices (column-major, as WebGL takes them) -----------------------------------------------------
  const M = {
    ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    persp(fovy, aspect, n, f) {
      const t = 1 / Math.tan(fovy / 2);
      return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0];
    },
    lookAt(e, c, up) {
      const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
    },
    trs(p, rotDeg, s) { // game space: T * Rz * Ry * Rx * S
      const [rx, ry, rz] = rotDeg.map(d => d * Math.PI / 180);
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
      // R = Rz * Ry * Rx (columns)
      const r = [
        cz * cy, sz * cy, -sy,
        cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx,
        cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx];
      return [r[0] * s, r[1] * s, r[2] * s, 0, r[3] * s, r[4] * s, r[5] * s, 0, r[6] * s, r[7] * s, r[8] * s, 0,
        p[0], p[1], p[2], 1];
    },
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // glTF is Y up (mapc writes a game point (x, y, z) as (x, z, -y)); this turns it back into the game's Z up
  const FROM_GLTF = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

  // ---- GL setup ---------------------------------------------------------------------------------------------
  const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV; attribute vec4 aCol;
uniform mat4 uMVP; uniform mat4 uModel; uniform mat3 uNrm;
varying vec3 vN; varying vec2 vUV; varying vec4 vC; varying vec3 vW;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz; vN = uNrm * aNrm; vUV = aUV; vC = aCol;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
  const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uHasTex; uniform float uVC; uniform float uUnlit; uniform float uCut;
uniform vec4 uFactor; uniform vec3 uLight; uniform vec3 uEye; uniform vec3 uMist; uniform vec3 uMistCol; uniform float uAlpha;
varying vec3 vN; varying vec2 vUV; varying vec4 vC; varying vec3 vW;
void main() {
  vec4 c = uFactor;
  if (uHasTex > 0.5) c *= texture2D(uTex, vUV);
  if (uVC > 0.5) c.rgb *= vC.rgb;
  if (uCut > 0.0 && c.a < uCut) discard;
  vec3 n = normalize(vN);
  float l = uUnlit > 0.5 ? 1.0 : 0.62 + 0.55 * max(dot(n, uLight), 0.0);
  vec3 rgb = c.rgb * l;
  // the void's mist (uMist: its z, FogRange, on): what lies under the plane takes its colour by its depth below it
  if (uMist.z > 0.5 && vW.z < uMist.x) rgb = mix(rgb, uMistCol, clamp((uMist.x - vW.z) / uMist.y, 0.0, 1.0));
  float fog = clamp((distance(vW, uEye) - 250.0) / 900.0, 0.0, 0.6);
  rgb = mix(rgb, vec3(0.09, 0.11, 0.14), fog);
  gl_FragColor = vec4(rgb, (uCut > 0.0 ? 1.0 : c.a) * uAlpha); // uAlpha: a ghost's (EDUX3), else 1
}`;

  function initGL() {
    const gl = V.canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    ['aPos', 'aNrm', 'aUV', 'aCol'].forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    V.gl = gl;
    V.prog = p;
    for (const u of ['uMVP', 'uModel', 'uNrm', 'uTex', 'uHasTex', 'uVC', 'uUnlit', 'uCut', 'uFactor', 'uLight', 'uEye', 'uMist', 'uMistCol', 'uAlpha']) {
      V.loc[u] = gl.getUniformLocation(p, u);
    }
    return true;
  }

  // ---- loading: glTF (mapc's subset: one buffer, float/ubyte attributes, u16 indices) and PNG textures --------

  const COMP = { 5126: 4, 5121: 1, 5123: 2 };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  function texture(url) {
    if (V.textures.has(url)) return V.textures.get(url);
    const gl = V.gl, t = { tex: null, ok: false, url, img: null }; // img: the picture (the live paint draws on a copy: relief.js)
    V.textures.set(url, t);
    const img = new Image();
    t.img = img;
    V.pending++;
    img.onload = () => {
      t.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const pot = n => (n & (n - 1)) === 0;
      if (pot(img.width) && pot(img.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      t.ok = true;
      V.pending--;
      redraw();
    };
    img.onerror = () => { V.pending--; V.stats.failed++; };
    img.src = url;
    return t;
  }

  // modelFor returns the model record of a .gltf URL, loading it the first time.
  function modelFor(url) {
    if (V.models.has(url)) return V.models.get(url);
    const m = { url, ready: false, failed: false, draws: [], centre: [0, 0, 0], radius: 1, triangles: 0, texUrls: [], bufs: [], freed: false };
    V.models.set(url, m);
    V.pending++;
    loadModel(m).catch(e => { m.failed = true; V.stats.failed++; log('3-D: ' + url + ': ' + e, 'err'); })
      .finally(() => { V.pending--; redraw(); });
    return m;
  }

  async function loadModel(m) {
    const gl = V.gl, dir = m.url.slice(0, m.url.lastIndexOf('/') + 1);
    const doc = await (await fetch(m.url)).json();
    const bin = await (await fetch(dir + doc.buffers[0].uri)).arrayBuffer();
    const views = doc.bufferViews.map(v => {
      const target = v.target === 34963 ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, new Uint8Array(bin, v.byteOffset, v.byteLength), gl.STATIC_DRAW);
      m.bufs.push(b);
      return { buf: b, target };
    });
    const acc = i => {
      const a = doc.accessors[i];
      return { buf: views[a.bufferView].buf, off: a.byteOffset || 0, type: a.componentType, size: SIZE[a.type],
        norm: !!a.normalized, count: a.count, min: a.min, max: a.max };
    };
    const mats = (doc.materials || []).map(mt => {
      const pbr = mt.pbrMetallicRoughness || {}, ex = mt.extras || {};
      let tex = null;
      if (pbr.baseColorTexture) {
        const tu = dir + doc.images[doc.textures[pbr.baseColorTexture.index].source].uri;
        tex = texture(tu);
        if (!m.texUrls.includes(tu)) m.texUrls.push(tu);
      }
      return { tex, factor: pbr.baseColorFactor || [1, 1, 1, 1], draw: ex.draw || 'opaque', unlit: !!ex.unlit,
        vc: !!ex.vertColor, cut: mt.alphaMode === 'MASK' ? (mt.alphaCutoff || 0.5) : 0, shader: ex.shader || '' };
    });
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const node of doc.nodes) {
      for (const p of doc.meshes[node.mesh].primitives) {
        const at = p.attributes, pos = acc(at.POSITION);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos.min[k]); hi[k] = Math.max(hi[k], pos.max[k]); }
        const ix = acc(p.indices);
        m.triangles += ix.count / 3;
        m.draws.push({ pos, nrm: at.NORMAL !== undefined ? acc(at.NORMAL) : null, uv: at.TEXCOORD_0 !== undefined ? acc(at.TEXCOORD_0) : null,
          col: at.COLOR_0 !== undefined ? acc(at.COLOR_0) : null, ix,
          mat: p.material !== undefined ? mats[p.material] : { tex: null, factor: [0.7, 0.7, 0.7, 1], draw: 'opaque', cut: 0 } });
      }
    }
    // the bounds in game space (glTF (x, y, z) is the game's (x, -z, y))
    const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    m.centre = [c[0], -c[2], c[1]];
    m.radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    if (m.freed) { freeGL(m); return; } // replaced while it loaded (a newer ground)
    if (m.url === V.groundUrl || m.url === V.groundNext) {
      // a ground: its heights (heightAt) and its source, which the live ground preview patches (relief.js, EDUX4)
      m.heights = heightsOf(doc, bin);
      m.src = { doc, bin, views };
      if (m.url === V.groundUrl) { V.heights = m.heights; V.heightsN++; }
    }
    m.ready = true;
  }

  // freeModel drops a model no one draws any more (a replaced ground: refreshGround, a map opened): its buffers, and
  // its textures no other model uses. One still loading is freed when it has loaded.
  function freeModel(url) {
    const m = url && V.models.get(url);
    if (!m) return;
    V.models.delete(url);
    m.freed = true;
    m.ready = false;
    freeGL(m);
  }
  function freeGL(m) {
    const gl = V.gl;
    if (!gl) return;
    for (const b of m.bufs) gl.deleteBuffer(b);
    m.bufs = [];
    for (const tu of m.texUrls) {
      if ([...V.models.values()].some(o => o !== m && o.texUrls.includes(tu))) continue;
      const t = V.textures.get(tu);
      if (t && t.tex) gl.deleteTexture(t.tex);
      V.textures.delete(tu);
    }
    m.texUrls = [];
    V.stats.freed = (V.stats.freed || 0) + 1;
  }

  // heightsOf keeps the ground model's heights in a grid of 1-m cells (the highest vertex in each; the model is a
  // heightfield of about 1.9 m), read by heightAt for what stands on the ground (the grass)
  function heightsOf(doc, bin) {
    const pts = [];
    for (const node of doc.nodes) {
      for (const p of doc.meshes[node.mesh].primitives) {
        const a = doc.accessors[p.attributes.POSITION], v = doc.bufferViews[a.bufferView];
        if (a.componentType !== 5126) continue;
        const dv = new DataView(bin, (v.byteOffset || 0) + (a.byteOffset || 0)), stride = v.byteStride || 12;
        for (let i = 0; i < a.count; i++) { // glTF (x, y, z) is the game's (x, -z, y)
          pts.push(dv.getFloat32(i * stride, true), -dv.getFloat32(i * stride + 8, true), dv.getFloat32(i * stride + 4, true));
        }
      }
    }
    if (!pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    const nx = Math.ceil(x1 - x0) + 1, ny = Math.ceil(y1 - y0) + 1, z = new Float32Array(nx * ny).fill(NaN);
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const k = Math.floor(pts[i + 1] - y0) * nx + Math.floor(pts[i] - x0);
      if (!(z[k] >= pts[i + 2])) z[k] = pts[i + 2];
      zmin = Math.min(zmin, pts[i + 2]); zmax = Math.max(zmax, pts[i + 2]);
    }
    return { x0, y0, nx, ny, z, zmin, zmax };
  }
  // heightAt is the ground's height at (x, y): the nearest cell with a vertex within 3 m, else 0 (the floor)
  function heightAt(x, y) {
    const H = V.heights;
    if (!H) return 0;
    const i = Math.floor(x - H.x0), j = Math.floor(y - H.y0);
    for (let r = 0; r <= 3; r++) {
      let best = NaN, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= H.nx || b >= H.ny) continue;
        const v = H.z[b * H.nx + a];
        if (!isNaN(v) && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = v; }
      }
      if (!isNaN(best)) return best;
    }
    return 0;
  }

  // ---- the scene: instances of models -------------------------------------------------------------------

  // liveObjects: the package's objects by key (kind|team|name|n, n counting equal names: two wells), where they stand
  // now: the document's own points (objects(): what a drag moves, live; team 2 the mirror), else as the last check
  // placed them (derived ones: the auto Cores and Bindings, the minion spawners)
  function liveObjects() {
    const out = new Map();
    if (!S.preview || V.source !== 'map') return out;
    const seen = new Map(), keyOf = (kind, team, name) => {
      const k = kind + '|' + team + '|' + name, n = seen.get(k) || 0;
      seen.set(k, n + 1);
      return k + '|' + n;
    };
    for (const o of S.preview.objects || []) out.set(keyOf(o.kind, o.team, o.name), o.pos);
    const spawns = { 1: [], 2: [] };
    if (S.doc) {
      seen.clear();
      for (const o of objects()) {
        if (o.auto) continue; // derived: the check's place
        for (const team of [1, 2]) {
          const k = keyOf(o.kind, team, o.name), p = team === 2 ? mir(o.pos) : o.pos;
          if (out.has(k)) out.set(k, p);
          if (o.kind === 'spawn') spawns[team].push(p);
        }
      }
    }
    for (const team of [1, 2]) {
      const sp = spawns[team].length ? spawns[team] : (S.preview.objects || []).filter(o => o.kind === 'spawn' && o.team === team).map(o => o.pos);
      if (sp.length) out.set('spawns|' + team + '|spawn platform|0',
        [sp.reduce((s, p) => s + p[0], 0) / sp.length, sp.reduce((s, p) => s + p[1], 0) / sp.length]);
    }
    return out;
  }

  // the scene's instances: the ground, the water, the grass, then the scene's objects at their live places. The
  // objects' instances are kept by object while its place stays (sceneCache, made again for a new scene or preview):
  // a drag changes one object's, not the whole scene's
  // swapGround: a newer ground (refreshGround's V.groundNext) replaces the drawn one only once it has loaded, so the
  // view never shows no ground or an older one in between (EDUX4: the live preview stays until then); the replaced
  // one is freed
  function swapGround() {
    const nx = V.groundNext && V.models.get(V.groundNext);
    if (!nx || !(nx.ready || nx.failed)) return;
    if (nx.failed) { V.groundNext = ''; return; }
    if (V.groundUrl && V.groundUrl !== V.groundNext) freeModel(V.groundUrl);
    V.groundUrl = V.groundNext;
    V.groundNext = '';
    V.groundDoc = V.groundDocNext;
    V.groundN = V.groundNextN;
    V.heights = nx.heights;
    V.heightsN++;
  }
  // the ground model drawn now (ready) and the map.json text it was made from: the live preview's base (relief.js)
  function groundModel() {
    const m = V.source === 'map' && V.groundUrl && V.models.get(V.groundUrl);
    return m && m.ready && m.src ? { model: m, doc: V.groundDoc } : null;
  }

  function instances() {
    const out = [];
    const sc = V.scene;
    swapGround();
    if (V.source === 'map' && V.groundUrl) out.push({ model: modelFor(V.groundUrl), mat: FROM_GLTF, ground: true });
    waterInstances(out);
    grassInstances(out);
    if (!sc) return out;
    let C = V.sceneCache;
    if (!C || C.scene !== sc || C.preview !== S.preview || C.dressing !== V.dressing || C.source !== V.source || C.base !== V.base) {
      C = V.sceneCache = { scene: sc, preview: S.preview, dressing: V.dressing, source: V.source, base: V.base, objs: new Map(), rev: '', live: null };
    }
    const d = S.doc || {}, rev = JSON.stringify([d.base, d.wells, d.camps, d.wards]); // what objects() reads (small)
    if (C.rev !== rev) { C.live = liveObjects(); C.rev = rev; }
    const live = C.live, seen = new Map();
    sc.objects.forEach((o, oi) => {
      const k0 = o.kind + '|' + o.team + '|' + o.name, n = seen.get(k0) || 0;
      seen.set(k0, n + 1);
      if (!o.parts || o.hidden) return;
      if (V.source === 'level' && !V.dressing && /_D_|Lights|shadow|VFX|Removed/i.test(o.markerset || '')) return;
      // a package's props are drawn live from map.json by the props layer (props.js), not from the last export
      if (V.source === 'map' && /_props$/i.test(o.markerset || '')) return;
      let p = o.pos;
      const lp = live.get(k0 + '|' + n);
      if (lp) p = [lp[0], lp[1], o.pos[2] || 0];
      const at0 = p[0] + ',' + p[1] + ',' + p[2];
      let c = C.objs.get(oi);
      if (!c || c.at !== at0) {
        c = { at: at0, items: [] };
        for (const part of o.parts) {
          const info = sc.models[part.model];
          if (!info) continue;
          const at = [p[0] + part.offset[0], p[1] + part.offset[1], (V.source === 'map' ? part.offset[2] : p[2])];
          c.items.push({ url: V.base + info.file, mat: M.mul(M.trs(at, part.rot, part.scale), FROM_GLTF), scale: part.scale,
            key: k0, obj: { kind: o.kind, team: o.team, name: o.name, n }, at });
        }
        C.objs.set(oi, c);
      }
      for (const it of c.items) out.push({ model: modelFor(it.url), mat: it.mat, scale: it.scale, key: it.key, obj: it.obj, at: it.at });
    });
    return out;
  }

  const WATER_TINT = [0.1, 0.5, 0.52, 0.55];

  function waterModel() { // a unit square in glTF space (the game's (x, y, 0) is glTF's (x, 0, -y)), drawn blended
    if (V.waterModel) return V.waterModel;
    const gl = V.gl;
    const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    const pos = new Float32Array([-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5]);
    const ix = new Uint16Array([0, 1, 2, 0, 2, 3]);
    V.waterModel = { url: 'water', ready: true, failed: false, centre: [0, 0, 0], radius: Math.SQRT1_2, triangles: 2,
      draws: [{ pos: { buf: buf(gl.ARRAY_BUFFER, pos), off: 0, type: gl.FLOAT, size: 3, norm: false, count: 4 },
        nrm: null, uv: null, col: null, ix: { buf: buf(gl.ELEMENT_ARRAY_BUFFER, ix), off: 0, type: gl.UNSIGNED_SHORT, count: 6 },
        mat: { tex: null, factor: WATER_TINT, draw: 'blend', unlit: true, vc: false, cut: 0 } }] };
    return V.waterModel;
  }

  function waterInstances(out) {
    V.stats.water = 0;
    if (V.source !== 'map' || !V.water || !V.gl || !S.preview || !Array.isArray(S.preview.water)) return;
    const m = waterModel();
    for (const w of S.preview.water) {
      const sx = w.size[0], sy = w.size[1];
      const size = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      out.push({ model: m, mat: M.mul(M.mul(M.trs(w.pos, [0, 0, w.rot], 1), size), FROM_GLTF), scale: Math.max(sx, sy),
        key: 'water|' + w.team + '|' + w.shape, at: w.pos.slice(), water: w });
      V.stats.water++;
    }
  }

  // ---- the bushes' grass: blades as the client's grass renderer lays them out (GrassRenderer.cpp's blade table,
  // 0x00582C70): over each bush (the last check's preview.json bushes: the grass patches
  // of both teams, whose cells the grass map marks), a grid of `density` blades a metre, each moved by up to
  // `posVari` m, `height` +- `heightVari` m tall, turned at random; the generated Grass markers carry SM_Map_v5's
  // settings (density 2.15, posVari 0.22, size z 4, heightVari 1, width 0.35, bend 0.085) and its blade texture
  // Foliage_GrassBlades2_D.dds (a 128 x 64 colour strip, no alpha: the blade's shape is its geometry). Each blade is
  // a tapered strip of three triangles, 0.35 m wide at its foot, leaning by bend times its height squared [assumed:
  // the renderer's vertex shader, which bends and sways the blades, isn't read], coloured by a column of the
  // texture (foot at its bottom row, tip at its top [assumed]). Not the game's shader: no wind, no shadows.
  const GRASS = { texture: 'environments/anshavar/textures/Foliage_GrassBlades2_D.dds', density: 2.15, posVari: 0.22,
    height: 4, heightVari: 1, width: 0.35, bend: 0.085, most: 200000, chunk: 13000 };
  const GRASS_GREEN = [0.38, 0.56, 0.22, 1], GRASS_LIT = [1, 1, 1, 1];

  function grassTexture() {
    if (V.grassTexState) return;
    V.grassTexState = 'asking';
    api('POST', '/api/texture-pictures', { paths: [GRASS.texture], max: 128 }).then(res => {
      const t = res.ok && res.textures && res.textures[0];
      if (!t || !t.url) { V.grassTexState = 'failed'; log('3-D grass: the blade texture: ' + (res.error || (t && t.error) || '?'), 'err'); return; }
      V.grassTexState = 'ok';
      V.grassTex = texture(t.url);
      redraw();
    });
  }

  // grassRand is a small seeded generator (xorshift32), so a bush's blades stay put between frames and checks
  function grassRand(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // grassBlades lays out the blades of the bushes: [{b (the bush's index), x, y, z, h, yaw, lean, u}]
  function grassBlades(bushes) {
    const out = [], step = 1 / GRASS.density;
    bushes.forEach((bu, b) => {
      const pts = bu.outline;
      if (!Array.isArray(pts) || pts.length < 3) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const rnd = grassRand((parseInt(bu.id, 16) || b + 1) ^ (bu.team === 2 ? 0x5bd1e995 : 0));
      for (let gy = y0 + step / 2; gy < y1; gy += step) {
        for (let gx = x0 + step / 2; gx < x1; gx += step) {
          const x = gx + (2 * rnd() - 1) * GRASS.posVari, y = gy + (2 * rnd() - 1) * GRASS.posVari;
          const h = GRASS.height + (2 * rnd() - 1) * GRASS.heightVari, yaw = rnd() * 2 * Math.PI, lean = rnd() * 2 * Math.PI, u = rnd();
          if (h < 0.1 || !inPoly([x, y], pts)) continue;
          out.push({ b, x, y, z: heightAt(x, y), h, yaw, lean, u });
          if (out.length >= GRASS.most) return;
        }
      }
    });
    return out;
  }

  function dropGrass() {
    const m = V.grassModel, gl = V.gl;
    V.grassModel = null;
    if (!m || !gl) return;
    for (const d of m.draws) for (const a of [d.pos, d.nrm, d.uv, d.ix]) gl.deleteBuffer(a.buf);
  }

  // buildGrass makes the blades' model: glTF space (a game point (x, y, z) is (x, z, -y)), drawn with FROM_GLTF
  function buildGrass(bushes) {
    const gl = V.gl, blades = grassBlades(bushes);
    if (!blades.length) return null;
    const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    const draws = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ztop = 0;
    for (let s = 0; s < blades.length; s += GRASS.chunk) {
      const part = blades.slice(s, s + GRASS.chunk), n = part.length;
      const pos = new Float32Array(n * 15), nrm = new Float32Array(n * 15), uv = new Float32Array(n * 10), ix = new Uint16Array(n * 9);
      part.forEach((bl, i) => {
        const sx = Math.cos(bl.yaw) * GRASS.width / 2, sy = Math.sin(bl.yaw) * GRASS.width / 2;
        const lt = GRASS.bend * bl.h * bl.h, lx = Math.cos(bl.lean), ly = Math.sin(bl.lean);
        // foot left, foot right, middle left, middle right (0.6 as wide, a quarter of the lean), tip
        const vs = [[bl.x - sx, bl.y - sy, 0], [bl.x + sx, bl.y + sy, 0],
          [bl.x - 0.6 * sx + lx * lt / 4, bl.y - 0.6 * sy + ly * lt / 4, bl.h / 2], [bl.x + 0.6 * sx + lx * lt / 4, bl.y + 0.6 * sy + ly * lt / 4, bl.h / 2],
          [bl.x + lx * lt, bl.y + ly * lt, bl.h]];
        const vv = [1, 1, 0.5, 0.5, 0.02];
        vs.forEach((v, j) => {
          const o = (i * 5 + j) * 3;
          pos[o] = v[0]; pos[o + 1] = bl.z + v[2]; pos[o + 2] = -v[1];
          nrm[o] = 0; nrm[o + 1] = 1; nrm[o + 2] = 0;
          uv[(i * 5 + j) * 2] = bl.u; uv[(i * 5 + j) * 2 + 1] = vv[j];
        });
        const b = i * 5;
        ix.set([b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 2, b + 3, b + 4], i * 9);
        x0 = Math.min(x0, bl.x); x1 = Math.max(x1, bl.x); y0 = Math.min(y0, bl.y); y1 = Math.max(y1, bl.y); ztop = Math.max(ztop, bl.z + bl.h);
      });
      draws.push({ pos: { buf: buf(gl.ARRAY_BUFFER, pos), off: 0, type: gl.FLOAT, size: 3, norm: false, count: n * 5 },
        nrm: { buf: buf(gl.ARRAY_BUFFER, nrm), off: 0, type: gl.FLOAT, size: 3, norm: false, count: n * 5 },
        uv: { buf: buf(gl.ARRAY_BUFFER, uv), off: 0, type: gl.FLOAT, size: 2, norm: false, count: n * 5 },
        col: null, ix: { buf: buf(gl.ELEMENT_ARRAY_BUFFER, ix), off: 0, type: gl.UNSIGNED_SHORT, count: n * 9 },
        mat: { tex: null, factor: GRASS_GREEN, draw: 'opaque', unlit: false, vc: false, cut: 0 } });
    }
    return { url: 'grass', ready: true, failed: false, centre: [(x0 + x1) / 2, (y0 + y1) / 2, ztop / 2],
      radius: Math.hypot(x1 - x0, y1 - y0, ztop) / 2 + 2, triangles: blades.length * 3, draws, blades };
  }

  function grassInstances(out) {
    V.stats.blades = 0;
    if (V.source !== 'map' || !V.grass || !V.gl || !S.preview || !Array.isArray(S.preview.bushes)) return;
    grassTexture();
    const key = JSON.stringify(S.preview.bushes.map(b => [b.id, b.team, b.outline])) + '|' + V.heightsN;
    if (key !== V.grassKey) {
      dropGrass();
      V.grassModel = buildGrass(S.preview.bushes);
      V.grassKey = key;
    }
    const m = V.grassModel;
    if (!m) return;
    const t = V.grassTex && V.grassTex.ok ? V.grassTex : null;
    for (const d of m.draws) { d.mat.tex = t; d.mat.factor = t ? GRASS_LIT : GRASS_GREEN; }
    out.push({ model: m, mat: FROM_GLTF, scale: 1, key: 'grass', at: m.centre.slice(), grass: true });
    V.stats.blades = m.blades.length;
  }

  // ---- drawing ----------------------------------------------------------------------------------------------

  // look is the point the camera looks at: the target, in game mode moved by the client's cameraScreenOffsetY
  // (-2.6) along the ground towards the camera [assumed reading: it put the shaper 60 px above the centre of a
  // 720 px shot, as the game's own picture has it]
  function look() {
    const c = V.cam, y = c.yaw * Math.PI / 180;
    const off = c.mode === 'game' ? GAME.offsetY / Math.sin(c.pitch * Math.PI / 180) : 0;
    return [c.tx + off * Math.sin(y), c.ty + off * Math.cos(y), c.tz];
  }
  function eye() {
    const c = V.cam, p = c.pitch * Math.PI / 180, y = c.yaw * Math.PI / 180, t = look();
    const f = [Math.sin(y), Math.cos(y)]; // yaw 0 looks north (+y)
    return [t[0] - c.dist * Math.cos(p) * f[0], t[1] - c.dist * Math.cos(p) * f[1], t[2] + c.dist * Math.sin(p)];
  }

  // ---- the input contract (app.js ED.views, EDUX2; pick and the overlay EDUX3) ---------------------------------
  // project([x, y(, z)]) -> the canvas pixels of a world point by the last frame's camera (V.vp; null behind it or
  // before a frame); without z the point is on the ground (heightAt). ppm(p): the canvas pixels a metre at p, at its
  // distance from the last frame's eye. pickAt(sx, sy): the ray from that eye through the pixel, marched over heightAt
  // (half-metre steps between the heights' top and bottom, then bisection) -> {w, z, near, sx, sy, view} or null (the
  // sky, a level of the copy shown, no frame yet); pick(e) the same at a mouse event.
  function camBasis() { // the camera as frame() draws it: the eye, its axes (lookAt's), the half-extents at depth 1
    const c = V.cam, e = eye(), W = V.canvas.width, H = V.canvas.height;
    const z = norm(sub(e, look())), x = norm(cross([0, 0, 1], z)), y = cross(z, x);
    const ty = Math.tan(c.fov * Math.PI / 360);
    return { e, x, y, z, ty, tx: ty * W / Math.max(1, H), W, H };
  }
  function project(p) {
    const m = V.vp;
    if (!m || !V.canvas) return null;
    const x = p[0], y = p[1], z = p.length > 2 && typeof p[2] === 'number' ? p[2] : heightAt(x, y);
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 1e-6)) return null;
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    return [(nx + 1) / 2 * V.canvas.width, (1 - ny) / 2 * V.canvas.height];
  }
  function ppm(p) {
    if (!V.canvas) return 0;
    const C = V.snap, e = C ? C.e : eye(), z = p.length > 2 && typeof p[2] === 'number' ? p[2] : heightAt(p[0], p[1]);
    const d = Math.max(0.1, Math.hypot(p[0] - e[0], p[1] - e[1], z - e[2]));
    return V.canvas.height / (2 * d * (C ? C.ty : Math.tan(V.cam.fov * Math.PI / 360)));
  }
  // ray(sx, sy): the ray's origin and direction through a canvas pixel (the last frame's camera)
  function ray(sx, sy) {
    const C = V.snap;
    if (!C) return null;
    const nx = (2 * sx / C.W - 1) * C.tx, ny = (1 - 2 * sy / C.H) * C.ty;
    return { o: C.e, d: norm([C.x[0] * nx + C.y[0] * ny - C.z[0], C.x[1] * nx + C.y[1] * ny - C.z[1], C.x[2] * nx + C.y[2] * ny - C.z[2]]) };
  }
  // groundHit: where the ray first meets heightAt's ground, or null
  function groundHit(r) {
    const o = r.o, d = r.d;
    if (!(d[2] < -1e-6)) return null; // level or up: no ground
    const H = V.heights, hi = Math.max(H ? H.zmax : 0, 0), lo = Math.min(H ? H.zmin : 0, 0);
    const at = t => [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    const above = t => { const q = at(t); return q[2] - heightAt(q[0], q[1]); };
    let t0 = Math.max(0, (o[2] - hi) / -d[2]);
    const t1 = (o[2] - lo) / -d[2] + 1e-6, hz = Math.hypot(d[0], d[1]);
    const dt = hz > 1e-6 ? Math.max(0.5 / hz, (t1 - t0) / 4000) : t1 - t0;
    let t = t0;
    if (above(t0) > 0) {
      for (;;) {
        const tn = Math.min(t1, t + dt);
        if (above(tn) <= 0) { t0 = t; t = tn; break; }
        if (tn >= t1) { t = t1; break; } // reached the bottom (heightAt never lies under lo)
        t = tn;
      }
      for (let k = 0; k < 30 && t - t0 > 1e-4; k++) { const tm = (t0 + t) / 2; if (above(tm) > 0) t0 = tm; else t = tm; }
    }
    const q = at(t);
    return [q[0], q[1], heightAt(q[0], q[1])];
  }
  function pickAt(sx, sy) {
    if (!V.visible || V.source !== 'map' || !S.doc || !V.snap) return null;
    const r = ray(sx, sy), g = r && groundHit(r);
    if (!g) return null;
    return { w: [g[0], g[1]], z: g[2], near: dpr / Math.max(1e-9, ppm(g)), sx, sy, view: '3d' };
  }
  // xy(e): a mouse event's canvas pixels (CSS pixels times the canvas's own scale)
  function xy(e) {
    const r = V.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * V.canvas.width / Math.max(1, r.width), (e.clientY - r.top) * V.canvas.height / Math.max(1, r.height)];
  }
  function pick(e) {
    if (!V.visible || !V.snap) return null;
    const [sx, sy] = xy(e);
    return pickAt(sx, sy);
  }

  function planes(vp) { // the frustum's planes from the view-projection matrix
    const r = k => [vp[k], vp[4 + k], vp[8 + k], vp[12 + k]];
    const r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3), out = [];
    for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
      const p = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]];
      const l = Math.hypot(p[0], p[1], p[2]);
      out.push(p.map(v => v / l));
    }
    return out;
  }

  function frame() {
    V.dirty = false;
    const gl = V.gl;
    if (!gl || !V.visible) return;
    const t0 = performance.now();
    const w = V.canvas.clientWidth, h = V.canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (V.canvas.width !== Math.round(w * dpr) || V.canvas.height !== Math.round(h * dpr)) {
      V.canvas.width = Math.round(w * dpr);
      V.canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, V.canvas.width, V.canvas.height);
    gl.clearColor(0.09, 0.11, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const c = V.cam, e = eye();
    const view = M.lookAt(e, look(), [0, 0, 1]);
    const proj = M.persp(c.fov * Math.PI / 180, V.canvas.width / Math.max(1, V.canvas.height), GAME.near, GAME.far);
    const vp = M.mul(proj, view);
    V.vp = vp;
    V.snap = camBasis(); // pick's ray uses the camera this frame shows
    const fr = planes(vp);
    gl.useProgram(V.prog);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const L = norm([-0.45, -0.35, 0.82]); // a sun from the south-west, high [assumed; SM's World_Lights not read]
    gl.uniform3fv(V.loc.uLight, L);
    gl.uniform3fv(V.loc.uEye, e);
    gl.uniform1i(V.loc.uTex, 0);
    const mist = mistNow();
    gl.uniform3fv(V.loc.uMist, mist ? [mist.z, mist.range, 1] : [0, 1, 0]);
    gl.uniform3fv(V.loc.uMistCol, mist ? mist.color : [0, 0, 0]);
    gl.uniform1f(V.loc.uAlpha, 1);
    V.stats.mist = mist;
    const tl = performance.now();
    const list = instances();
    for (const layer of V.layers) layer({ gl, list, modelFor, M });
    V.lastList = list; // what this frame draws: the 3-D hits test it (hitModels)
    V.listMs.push(performance.now() - tl);
    const st = V.stats;
    st.draws = 0; st.culled = 0; st.parts = list.length;
    const late = [];
    for (const pass of ['solid', 'late']) {
      if (pass === 'late') { gl.enable(gl.BLEND); gl.depthMask(false); }
      for (const it of list) {
        const m = it.model;
        if (!m.ready) continue;
        if (pass === 'solid') {
          const wc = mulPoint(it.mat, glPoint(m.centre)), rad = m.radius * (it.scale || 1);
          if (!it.ground && fr.some(p => p[0] * wc[0] + p[1] * wc[1] + p[2] * wc[2] + p[3] < -rad)) { st.culled++; continue; }
          if (it.ghost) { late.push(it); continue; } // a ghost (the next doodad, EDUX3): all of it see-through, after the rest
        } else if (!late.includes(it)) continue;
        if (it.ghost) gl.uniform1f(V.loc.uAlpha, it.ghost);
        const mvp = M.mul(vp, it.mat);
        gl.uniformMatrix4fv(V.loc.uMVP, false, mvp);
        gl.uniformMatrix4fv(V.loc.uModel, false, it.mat);
        gl.uniformMatrix3fv(V.loc.uNrm, false, normalMat(it.mat));
        for (const d of m.draws) {
          if (isFogFace(d.mat)) continue; // the void's mist plane: the shader's mist term draws it (mistNow)
          const blend = d.mat.draw === 'blend' || d.mat.draw === 'add';
          if (!it.ghost && (pass === 'solid') === blend) { if (pass === 'solid' && !late.includes(it)) late.push(it); continue; }
          if (blend || it.ghost) gl.blendFunc(gl.SRC_ALPHA, d.mat.draw === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
          bindAttr(0, d.pos, 3);
          bindAttr(1, d.nrm, 3, [0, 0, 1]);
          bindAttr(2, d.uv, 2, [0, 0]);
          bindAttr(3, d.col, 4, [1, 1, 1, 1]);
          const t = d.mat.tex;
          gl.uniform1f(V.loc.uHasTex, t && t.ok ? 1 : 0);
          if (t && t.ok) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex); }
          // additive effects at a third: drawn at full strength the light shafts and glows wash the picture out
          const f = t && !t.ok ? [0.55, 0.55, 0.55, 1] : d.mat.factor;
          gl.uniform4fv(V.loc.uFactor, d.mat.draw === 'add' ? [f[0] / 3, f[1] / 3, f[2] / 3, f[3]] : f);
          gl.uniform1f(V.loc.uVC, d.mat.vc && d.col ? 1 : 0);
          gl.uniform1f(V.loc.uUnlit, d.mat.unlit ? 1 : 0);
          gl.uniform1f(V.loc.uCut, d.mat.cut || 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.ix.buf);
          gl.drawElements(gl.TRIANGLES, d.ix.count, gl.UNSIGNED_SHORT, d.ix.off);
          st.draws++;
        }
        if (it.ghost) gl.uniform1f(V.loc.uAlpha, 1);
      }
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    V.frameNo++;
    const t1 = performance.now();
    drawOverlay();
    V.frameMs.push(t1 - t0);
    V.overlayMs.push(performance.now() - t1);
    if (V.frameMs.length > 120) { V.frameMs.shift(); V.overlayMs.shift(); V.listMs.shift(); }
    showStatus();
  }

  // drawOverlay draws the overlay over this frame (app.js ED.drawOverlay: the selection's rings and handles, the
  // previews, the check's markers), through project and ppm; the canvas follows the GL canvas's size
  function drawOverlay() {
    const ov = V.ov, g = V.octx;
    if (!ov) return;
    if (ov.width !== V.canvas.width || ov.height !== V.canvas.height) { ov.width = V.canvas.width; ov.height = V.canvas.height; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ov.width, ov.height);
    if (V.source !== 'map' || !S.doc) return;
    ED.drawOverlay(VIEW3D);
  }

  // ---- the void (map.json's "void", mapc's MAPED-VOID): the ground export already holds the cut ground and the
  // backdrop plane (drawn as any mesh: lit or unlit, its texture) and the mist plane on the game's labsFogFace
  // material. That shader tints what lies behind the plane by how far behind it lies (fully at FogRange); a flat
  // plane can't show that, so the pane leaves the plane out and tints every pixel below the mist's z by its depth
  // under it, (z_mist - z) / range, towards the colour (each clamped to 1), taken live from the document. The game's
  // fog shader measures along the view [inferred], its colour grading shifts the colour, and the environment's
  // height fog ("fog") isn't drawn: the picture is close, not the game's.
  const isFogFace = mat => /fogface/i.test(mat.shader || '');
  function mistNow() {
    if (!V.mist || V.source !== 'map' || !S.doc || !S.doc.void || typeof S.doc.void !== 'object') return null;
    const m = S.doc.void.mist;
    if (!m || typeof m !== 'object' || !(+m.z < 0) || !(+m.range > 0)) return null;
    const c = Array.isArray(m.color) ? m.color : [0, 0, 0];
    return { z: +m.z, range: +m.range, color: [0, 1, 2].map(i => Math.min(1, Math.max(0, +c[i] || 0))) };
  }

  const glPoint = p => [p[0], p[2], -p[1]]; // a game point as glTF's (the model matrix turns it back)
  function mulPoint(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }
  function normalMat(m) { // the rotation part, its scale divided out (the scales are uniform)
    const s = Math.hypot(m[0], m[1], m[2]) || 1;
    return [m[0] / s, m[1] / s, m[2] / s, m[4] / s, m[5] / s, m[6] / s, m[8] / s, m[9] / s, m[10] / s];
  }
  function bindAttr(i, a, n, dflt) {
    const gl = V.gl;
    if (!a) { gl.disableVertexAttribArray(i); gl.vertexAttrib4f(i, ...(dflt.concat([1, 1, 1]).slice(0, 4))); return; }
    gl.enableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
    gl.vertexAttribPointer(i, a.size, a.type, a.norm, 0, a.off);
  }

  function redraw() {
    if (V.dirty) return;
    V.dirty = true;
    // a timer as well: a headless or hidden page may not run animation frames
    let done = false;
    const once = () => { if (!done) { done = true; frame(); } };
    requestAnimationFrame(once);
    setTimeout(once, 100);
  }

  function showStatus() {
    if (!V.status) return;
    const s = V.stats, c = V.cam;
    let txt = (V.source === 'level' ? V.level : (S.pkg || '')) + ': ' + s.parts + ' parts, ' + s.draws + ' draws, ' +
      s.culled + ' culled; target (' + c.tx.toFixed(1) + ', ' + c.ty.toFixed(1) + '), yaw ' + c.yaw.toFixed(0) +
      ', pitch ' + c.pitch.toFixed(0) + ', ' + c.dist.toFixed(0) + ' m';
    if (s.water) txt += '; ' + s.water + ' water plane' + (s.water > 1 ? 's' : '');
    if (s.blades) txt += '; ' + s.blades + ' grass blades';
    if (s.mist) txt += '; mist at z ' + s.mist.z + ' (range ' + s.mist.range + ')';
    if (V.pending) txt += '; loading ' + V.pending;
    if (V.groundBusy) txt += '; ground...';
    V.status.textContent = txt;
    api3d.statusText = txt;
    if (V.visible) ED.emit('camera', V.cam); // the status bar and the minimap's rectangle (frame.js)
    document.body.dataset.view3d = V.pending || V.groundBusy || !V.scene ? 'loading' : 'ready';
  }

  // ---- loading scenes and the ground -------------------------------------------------------------------

  async function loadScene() {
    V.scene = null;
    if (V.source === 'level') {
      if (!V.level) return;
      setBusy('exporting ' + V.level + ' (mapc scene)...');
      const res = await api('GET', '/api/level-scene/' + encodeURIComponent(V.level));
      if (!res.ok) { log('3-D: ' + (res.error || JSON.stringify(res.result)), 'err'); setBusy(''); return; }
      V.scene = res.scene;
      V.base = res.base;
    } else {
      if (!S.pkg) return;
      setBusy('exporting ' + S.pkg + ' (mapc scene)...');
      const res = await api('GET', '/api/scene/' + S.pkg);
      if (!res.ok) { log('3-D: ' + (res.error || JSON.stringify(res.result)), 'err'); setBusy(''); return; }
      V.scene = res.scene;
      V.base = res.base;
      if (res.scene.ground) { if (V.groundUrl && V.groundUrl !== res.base + res.scene.ground) freeModel(V.groundUrl); V.groundUrl = res.base + res.scene.ground; V.groundDoc = S.checkedJSON || ''; V.groundKey = S.hideDerived ? '' : groundKey(); } // the scene's is with the derived art
    }
    setBusy('');
    log('3-D: ' + V.scene.map + ': ' + V.scene.objects.length + ' objects, ' + Object.keys(V.scene.models).length + ' models' +
      (V.scene.missing ? '; missing: ' + V.scene.missing.join('; ') : ''));
    redraw();
  }

  function groundKey() { // what the ground depends on
    const d = S.doc || {};
    const v = d.void && typeof d.void === 'object' ? d.void : null; // the cut and the backdrop are the ground's; the mist is drawn live
    return JSON.stringify([d.size, d.terrain, d.lanes, d.base, d.wells, d.camps, d.ground, v && [v.cut, v.backdrop], !!S.hideDerived]);
  }

  async function refreshGround() {
    if (V.source !== 'map' || !S.pkg || !V.scene) return;
    const key = groundKey();
    if (key === V.groundKey) return;
    if (V.groundBusy) { V.groundAgain = true; return; }
    V.groundBusy = true;
    showStatus();
    const pkg = S.pkg, from = S.checkedJSON || ''; // the ground is made from the last checked draft
    V.groundReq = '/api/ground/' + pkg + (S.hideDerived ? '?derived=0' : ''); // View > Hide Derived Art: mapc ground --no-derived
    const res = await api('POST', V.groundReq);
    V.groundBusy = false;
    if (pkg === S.pkg) {
      if (res.ok) {
        V.groundKey = key;
        if (res.url !== V.groundUrl) {
          // drawn once it has loaded (swapGround; the replaced ground's buffers and texture freed then)
          if (V.groundNext && V.groundNext !== res.url) freeModel(V.groundNext);
          V.groundNext = res.url;
          V.groundDocNext = from;
          V.groundNextN = res.n;
          modelFor(res.url);
        } else V.groundN = res.n;
      } else if (S.report && S.report.ok !== false) {
        log('3-D ground: ' + (res.error || JSON.stringify(res.result)), 'err');
      }
    }
    if (V.groundAgain) { V.groundAgain = false; refreshGround(); }
    redraw();
  }

  function setBusy(t) { // also a line in Messages
    if (V.status) V.status.textContent = t || '';
    if (t && t !== V.lastBusy) log('3-D: ' + t);
    V.lastBusy = t || '';
  }

  // ---- camera input ---------------------------------------------------------------------------------------

  function setTarget(x, y) { V.cam.tx = x; V.cam.ty = y; redraw(); }
  function gameCamera() { Object.assign(V.cam, { yaw: GAME.yaw, pitch: GAME.pitch, dist: GAME.dist, fov: GAME.fov, mode: 'game' }); syncButtons(); redraw(); }

  // The mouse (EDUX3, the World Editor's): the left button is the tool's (app.js's pipeline: select, drag, place,
  // turn and scale by the handles, the box); right or middle drag pans, Shift + right drag zooms, Ctrl + right drag
  // turns the camera (free camera: and tilts it), the wheel zooms, Alt + left drag pans. A left press the pipeline
  // doesn't take (the sky, a level of the copy shown) moves the camera as before: pans (free camera: orbits).
  function onDown(e) {
    V.canvas.focus({ preventScroll: true }); // the view's keys (the arrows, F) want the focus in the view
    V.pressing = true;
    if (!(e.button === 0 && e.altKey) && ED.input.down(VIEW3D, e)) return; // a tool's press: the window's mousemove/up follow it
    V.drag = { x: e.clientX, y: e.clientY, b: e.button, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, cam: Object.assign({}, V.cam) };
    try { V.canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer (a self-test) has none to capture */ }
    e.preventDefault();
  }
  function onMove(e) {
    const d = V.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y, c = V.cam;
    const orbit = c.mode === 'free' && d.b === 0 && !d.alt;
    if (d.b === 2 && d.shift) { // Shift + right drag zooms (the World Editor's)
      c.dist = Math.max(8, Math.min(900, d.cam.dist * Math.exp(dy * 0.01)));
    } else if (d.b === 2 && d.ctrl) { // Ctrl + right drag turns the camera
      c.yaw = d.cam.yaw - dx * 0.3;
      if (c.mode === 'free') c.pitch = Math.max(5, Math.min(89, d.cam.pitch + dy * 0.3));
    } else if (orbit) {
      c.yaw = d.cam.yaw - dx * 0.3;
      c.pitch = Math.max(5, Math.min(89, d.cam.pitch + dy * 0.3));
    } else { // pan on the ground
      const k = 2 * c.dist * Math.tan(c.fov * Math.PI / 360) / Math.max(1, V.canvas.clientHeight);
      const y = c.yaw * Math.PI / 180, fx = Math.sin(y), fy = Math.cos(y);
      const along = dy * k / Math.max(0.3, Math.sin(c.pitch * Math.PI / 180)), across = -dx * k;
      c.tx = d.cam.tx + across * fy + along * fx;
      c.ty = d.cam.ty - across * fx + along * fy;
    }
    redraw();
  }
  function onUp() { V.drag = null; }
  // a press in this view ends after the window's mouseup handlers (app.js inputUp selects on a click): the selection it
  // makes is the view's own, so Follow the Selection leaves the camera where it is
  window.addEventListener('mouseup', () => { setTimeout(() => { V.pressing = false; }, 0); });
  window.addEventListener('pointerup', () => { setTimeout(() => { V.pressing = false; }, 0); });
  function onWheel(e) {
    e.preventDefault();
    if (ED.input.wheel(ED.views['3d'], e)) return; // the armed tool's wheel first (props.js), as in 2-D
    const c = V.cam;
    c.dist = Math.max(8, Math.min(900, c.dist * Math.pow(1.0015, e.deltaY)));
    redraw();
  }

  function syncButtons() { if (typeof FR !== 'undefined') FR.renderStatus(); } // the camera's mode shows in the status bar

  function goTo(which) {
    const objs = (V.source === 'map' && S.preview) ? S.preview.objects : [];
    const spawnCentre = team => {
      const sp = objs.filter(o => o.kind === 'spawn' && o.team === team);
      if (sp.length) return [sp.reduce((s, o) => s + o.pos[0], 0) / sp.length, sp.reduce((s, o) => s + o.pos[1], 0) / sp.length];
      const lv = V.scene ? V.scene.objects.filter(o => o.noun === 'SpawnPoint_Team' + team) : [];
      if (lv.length) return [lv.reduce((s, o) => s + o.pos[0], 0) / lv.length, lv.reduce((s, o) => s + o.pos[1], 0) / lv.length];
      return null;
    };
    let p = null;
    if (which === 'base1') p = spawnCentre(1);
    else if (which === 'base2') p = spawnCentre(2);
    else if (which === 'centre') p = [0, 0];
    else if (which === 'sel' && typeof selValue === 'function') {
      const v = selValue(S.sel);
      if (Array.isArray(v) && typeof v[0] === 'number') p = v;
      else if (v && v.circle) p = v.circle;
      else if (v && Array.isArray(v.pos)) p = v.pos; // a prop
      else if (v && Array.isArray(v.polygon) && v.polygon.length) p = v.polygon[0]; // a scatter
    }
    if (p) setTarget(p[0], p[1]);
  }

  // hitModels (ED.hitFirst, after the handles): in this view an object or a prop is hit where its model shows, by
  // its bounding sphere as projected (at least 6 pixels across), the best the one whose centre is nearest the mouse
  // for its size (as the 2-D props' hits); the objects by kind and name (the n-th of equal names), the props by the
  // marker the props layer drew. Shadow cards, the ground, the water and the grass aren't hit.
  function hitModels(sx, sy, w, near, pk) {
    if (!pk || pk.view !== '3d' || V.source !== 'map' || !S.doc || !V.lastList) return null;
    let best = null, bs = Infinity, obs = null;
    const objSelOf = o => { // a scene object's selection: the n-th team-1 object of its kind and name
      obs = obs || objects();
      const same = obs.filter(x => x.kind === o.kind && x.name === o.name), x = same[o.n] || same[0];
      return x ? objSel(x) : null;
    };
    for (const it of V.lastList) {
      if (it.ghost || it.ground || !(it.obj || it.item) || !it.model.ready) continue;
      let team, sel = null;
      if (it.obj) {
        if (!S.show.objects) continue;
        team = it.obj.team;
      } else {
        if (it.item.card) continue;
        team = it.item.team;
      }
      if (team === 2 && !S.show.mirror) continue;
      const c = mulPoint(it.mat, glPoint(it.model.centre)), s = project(c);
      if (!s) continue;
      const rp = Math.max(6 * dpr, it.model.radius * (it.scale || 1) * ppm(c)), d = Math.hypot(s[0] - sx, s[1] - sy);
      if (d > rp || d / rp >= bs) continue;
      if (it.obj) sel = objSelOf(it.obj);
      else sel = it.item.kind === 'scatter' ? { t: 'scatter', k: it.item.k } : { t: 'prop', k: it.item.k };
      if (!sel) continue;
      bs = d / rp;
      best = { sel, mirrored: team === 2 };
    }
    return best;
  }

  // frameSel (F, View > Fit the Map / The Selection in 3-D): the camera's target on the selection and its distance so
  // the selection fills about a third of the view's height (at least 25 m away); nothing selected: the whole map
  function frameSel() {
    const v = typeof selValue === 'function' ? selValue(S.sel) : undefined;
    const pts = [];
    let rad = 4;
    const add = (p, r) => { if (Array.isArray(p) && typeof p[0] === 'number') { pts.push(p); rad = Math.max(rad, r || 0); } };
    if (Array.isArray(v) && typeof v[0] === 'number') add(v, 4);
    else if (Array.isArray(v)) v.forEach(c => c && add(c.pos, typeof PR !== 'undefined' ? PR.entryRadius(c) : 4)); // several props
    else if (v && v.circle) add(v.circle, +v.r || 0);
    else if (v && Array.isArray(v.pos)) add(v.pos, typeof PR !== 'undefined' ? PR.entryRadius(v) : 4);
    else if (v) for (const k of ['polygon', 'path', 'knots']) if (Array.isArray(v[k])) v[k].forEach(p => add(p, 0));
    if (!pts.length) return goTo('sel');
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const r = Math.hypot(Math.max(...xs) - c[0], Math.max(...ys) - c[1]) + rad;
    V.cam.dist = Math.max(25, Math.min(900, 1.5 * r / Math.tan(V.cam.fov * Math.PI / 360)));
    setTarget(c[0], c[1]);
  }

  // ---- the view's element -----------------------------------------------------------------------------------

  // the view's element: the canvas alone; its controls are the frame's (View > Camera, Compare with a Level, Follow the
  // Selection, Water/Bushes/Mist), its status line the status bar's first part (V3D.statusText) and Messages
  function build() {
    const el = document.createElement('div');
    el.className = 'view3d';
    el.innerHTML = '<canvas class="c3d" tabindex="0"></canvas><canvas class="ov3d"></canvas><div class="status3d"></div>';
    V.canvas = el.querySelector('canvas');
    V.ov = el.querySelector('.ov3d');
    V.octx = V.ov.getContext('2d');
    V.status = el.querySelector('.status3d');
    V.canvas.addEventListener('pointerdown', onDown);
    V.canvas.addEventListener('pointermove', onMove);
    V.canvas.addEventListener('pointerup', onUp);
    V.canvas.addEventListener('wheel', onWheel, { passive: false });
    V.canvas.addEventListener('contextmenu', e => e.preventDefault());
    V.canvas.addEventListener('dblclick', e => ED.input.dbl(VIEW3D, e)); // ends a drawing, a corner on a shape's edge
    V.el = el;
    syncButtons();
    return el;
  }
  function freeCamera() { V.cam.mode = 'free'; syncButtons(); redraw(); }

  async function setScene(level) {
    V.source = level ? 'level' : 'map';
    V.level = level;
    await loadScene();
    goTo('base1');
  }

  function show(on) {
    V.visible = on;
    if (!on) return;
    if (!V.gl) {
      try {
        if (!initGL()) { setBusy('WebGL is not available in this browser.'); return; }
      } catch (e) { setBusy('WebGL: ' + e.message); return; }
    }
    if (!V.scene && (V.source === 'level' || S.pkg)) loadScene().then(() => { goTo('base1'); refreshGround(); });
    else refreshGround();
    redraw();
  }

  // ---- wiring -------------------------------------------------------------------------------------------------

  // the view's contract (app.js VIEW2D): pick by the ray over the ground, the camera's project and ppm, the overlay
  // (drawn each frame: drawOverlay); drape: lines through it are cut into metre steps on the ground; xy(e) a mouse
  // event's canvas pixels; redraw() for app.js's render() while this view is shown
  const VIEW3D = { id: '3d', title: '3-D', el: build(), pick, pickAt, project, ppm, xy, redraw, drape: true };
  VIEW3D.overlay = V.octx;
  VIEW3D.canvas = V.canvas;
  ED.addView(VIEW3D);
  ED.on('view', id => show(id === '3d'));
  ED.on('open', () => { freeModel(V.groundUrl); freeModel(V.groundNext); V.scene = null; V.groundUrl = ''; V.groundNext = ''; V.groundKey = ''; if (V.visible && V.source === 'map') show(true); });
  ED.on('preview', () => redraw());
  ED.on('doc', () => { if (V.visible) redraw(); }); // the mist follows the document at once
  ED.on('checked', () => { if (V.visible) refreshGround(); });
  ED.on('derived', () => { if (V.visible) refreshGround(); }); // View > Hide Derived Art
  ED.on('select', () => { if (V.visible && V.follow && !V.pressing) goTo('sel'); }); // not for a click in this view
  ED.on('open', () => { V.sceneCache = null; });

  function activate() { ED.setView('3d'); }

  // URL: ?view=3d shows the view, &scene=<level> a level of the copy, &at=x,y the target, &yaw=, &pitch=, &dist=
  async function fromURL() {
    const q = URLQ; // read at load: opening a map rewrites the URL
    if (q.get('view') !== '3d') return;
    if (q.get('full')) document.body.classList.add('full3d'); // the view alone (pictures at the game's aspect)
    const level = q.get('scene') || '';
    if (level) {
      V.source = 'level';
      V.level = level;
    }
    activate();
    await until(() => V.scene, 600000);
    await new Promise(r => setTimeout(r, 0));
    for (const k of ['yaw', 'pitch', 'dist', 'fov']) if (q.get(k)) V.cam[k] = +q.get(k);
    if (q.get('free')) { V.cam.mode = 'free'; syncButtons(); }
    if (q.get('dressing') === '0') V.dressing = false;
    if (q.get('at')) { const [x, y] = q.get('at').split(',').map(Number); setTarget(x, y); }
  }

  // the view's own self-test (?selftest=3d): open CM_Ring, draw it, edit, see the pane follow
  const until = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await new Promise(r => setTimeout(r, 50));
    }
    return true;
  };
  const settled = () => { // instances() asks for every model the scene draws, so nothing is left to start loading
    if (V.scene && V.gl) instances();
    return !V.pending && !V.groundBusy && !!V.scene;
  };

  async function selftest() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    let ok = true;
    activate();
    ok &= say(!!V.gl, 'WebGL context');
    ok &= say(await until(settled, 120000), 'scene, models and ground loaded (' + V.models.size + ' models)');
    const kinds = new Set((V.scene ? V.scene.objects : []).filter(o => o.parts && o.parts.length).map(o => o.kind));
    // the compiled Level's: the Guardians, Cores, Bindings and the archons with the spawn platform
    ok &= say(V.scene && S.doc && V.scene.level === S.doc.name + '.Level', 'scene from the compiled Level ' + (V.scene && V.scene.level));
    for (const k of ['guardian', 'binding', 'core', 'spawns']) ok &= say(kinds.has(k), 'models for ' + k);
    const ground = V.models.get(V.groundUrl);
    ok &= say(ground && ground.ready && ground.triangles > 100000, 'ground drawn: ' + (ground ? ground.triangles : 0) + ' triangles');
    goTo('base1');
    frame();
    ok &= say(V.stats.draws > 20 && V.gl.getError() === 0, 'frame: ' + V.stats.draws + ' draws, ' + V.stats.culled + ' culled, no GL error');
    // the picture isn't empty: some pixels differ from the clear colour
    const px = new Uint8Array(4 * 64);
    V.gl.readPixels(Math.floor(V.canvas.width / 2) - 32, Math.floor(V.canvas.height / 2), 64, 1, V.gl.RGBA, V.gl.UNSIGNED_BYTE, px);
    let drawn = 0;
    for (let i = 0; i < 64; i++) if (Math.abs(px[4 * i] - 23) + Math.abs(px[4 * i + 1] - 28) + Math.abs(px[4 * i + 2] - 36) > 12) drawn++;
    ok &= say(drawn > 32, 'centre row drawn (' + drawn + ' of 64 pixels)');
    // an edit of the layout: a wall in the base; the ground is made again
    const n0 = V.groundN, url0 = V.groundUrl;
    addShape({ type: 'wall', circle: [-150, -95], r: 5 });
    changed(true);
    clearTimeout(S.checkTimer);
    await runCheck();
    ok &= say(await until(() => V.groundN > n0 && settled() && V.models.get(V.groundUrl) && V.models.get(V.groundUrl).ready, 60000),
      'wall added: the ground was made again (' + url0 + ' -> ' + V.groundUrl + ')');
    // a Binding moved in 2-D: its models follow without a new export
    const key = 'binding|1|lane 1 Outer';
    const before = instances().find(i => i.key === key);
    const b = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 0);
    if (b) {
      const sel = objSel(b);
      S.drag = { sel, start: b.pos, moved: false };
      if (sel.t === 'auto') { pushUndo(); materialize('bindings'); S.drag.sel = autoToPath(sel); }
      S.drag.orig = selValue(S.drag.sel).slice();
      moveSel(S.drag, [b.pos[0] + 6, b.pos[1] - 4], null);
      S.drag = null;
      changed(true);
      clearTimeout(S.checkTimer);
      await runCheck();
    }
    const after = instances().find(i => i.key === key);
    ok &= say(!!(before && after && Math.abs(after.at[0] - before.at[0] - 6) < 0.2 && Math.abs(after.at[1] - before.at[1] + 4) < 0.2),
      'Binding moved: its models moved by (' + (after && before ? (after.at[0] - before.at[0]).toFixed(1) + ', ' + (after.at[1] - before.at[1]).toFixed(1) : '?') + ')');
    frame();
    say(ok, ok ? 'selftest 3d passed' : 'selftest 3d failed');
    document.title = ok ? 'selftest 3d passed' : 'selftest 3d failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }

  // the water's self-test (?selftest=water3d): CM_Water's three planes drawn at their heights, seen in the picture,
  // and following an edit of a chasm's water at the next check
  async function selftestWater() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
    let ok = true;
    if (S.pkg !== 'CM_Water') await openMap('CM_Water');
    activate();
    ok &= say(!!V.gl, 'WebGL context');
    ok &= say(await until(() => settled() && S.preview, 120000), 'scene, models and ground loaded');
    const shapes = (S.doc && S.doc.terrain && S.doc.terrain.shapes) || [];
    const wantZ = k => { const w = shapes[k] && shapes[k].water; return w && typeof w === 'object' && typeof w.z === 'number' ? w.z : -2; };
    const ws = (S.preview && S.preview.water) || [];
    ok &= say(ws.length === 3, 'preview.json: ' + ws.length + ' water planes (want 3: the centre once, the slab and its mirror)');
    const quads = () => instances().filter(i => i.water);
    // each quad: its four corners at the plane's z, half a diagonal from its place, turned by its rot
    const glP = p => [p[0], p[2], -p[1]];
    let fit = 0;
    for (const q of quads()) {
      const w = q.water, z = wantZ(w.shape), half = Math.hypot(w.size[0], w.size[1]) / 2;
      const cs = [[0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]].map(([u, v]) => mulPoint(q.mat, glP([u, v, 0])));
      const a = w.rot * Math.PI / 180, c0 = cs[0];
      const want0 = [w.pos[0] + (Math.cos(a) * w.size[0] - Math.sin(a) * w.size[1]) / 2, w.pos[1] + (Math.sin(a) * w.size[0] + Math.cos(a) * w.size[1]) / 2];
      const good = Math.abs(w.pos[2] - z) < 1e-6 && cs.every(p => Math.abs(p[2] - z) < 1e-4 &&
        Math.abs(Math.hypot(p[0] - w.pos[0], p[1] - w.pos[1]) - half) < 1e-3) &&
        Math.abs(c0[0] - want0[0]) < 1e-3 && Math.abs(c0[1] - want0[1]) < 1e-3;
      if (good) fit++;
      say(good, 'quad ' + q.key + ' at (' + w.pos.map(v => v.toFixed(1)).join(', ') + '), ' + w.size.map(v => v.toFixed(1)).join(' x ') +
        ' m, turned ' + w.rot.toFixed(1) + ', z ' + z);
    }
    ok &= say(fit === 3, fit + ' of 3 quads at their place, turn, size and the chasm\'s z');
    // in the picture: over each plane's centre the water on turns the pixels teal (the game camera, 16 x 16 pixels)
    const gl = V.gl, N = 16;
    const read = w => {
      frame();
      const vp = V.vp;
      const cx = vp[0] * w[0] + vp[4] * w[1] + vp[8] * w[2] + vp[12], cy = vp[1] * w[0] + vp[5] * w[1] + vp[9] * w[2] + vp[13];
      const cw = vp[3] * w[0] + vp[7] * w[1] + vp[11] * w[2] + vp[15];
      const px = Math.round((cx / cw + 1) / 2 * V.canvas.width) - N / 2, py = Math.round((cy / cw + 1) / 2 * V.canvas.height) - N / 2;
      const b = new Uint8Array(4 * N * N);
      gl.readPixels(px, py, N, N, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    let seen = 0;
    for (const w of ws) {
      gameCamera();
      setTarget(w.pos[0], w.pos[1]);
      const on = read(w.pos);
      V.water = false;
      const off = read(w.pos);
      V.water = true;
      let teal = 0;
      for (let i = 0; i < N * N; i++) {
        const t = k => (k[4 * i + 1] + k[4 * i + 2]) / 2 - k[4 * i];
        if (t(on) - t(off) > 6) teal++;
      }
      const good = teal > N * N * 0.8;
      if (good) seen++;
      say(good, 'picture at (' + w.pos[0].toFixed(1) + ', ' + w.pos[1].toFixed(1) + '): ' + teal + ' of ' + N * N + ' pixels turn teal with the water');
    }
    ok &= say(seen === 3 && gl.getError() === 0, seen + ' of 3 planes seen, no GL error');
    // an edit: the slab's water to z -3; both its quads follow at the next check
    const k = ws.length ? ws.find(w => w.team === 1 && w.pos[0] < -50) : null;
    if (k) {
      shapes[k.shape].water = { z: -3 };
      changed(true);
      clearTimeout(S.checkTimer);
      await runCheck();
    }
    const moved = quads().filter(q => k && q.water.shape === k.shape);
    ok &= say(moved.length === 2 && moved.every(q => q.water.pos[2] === -3 && Math.abs(q.mat[14] + 3) < 1e-6),
      'slab water to z -3: ' + moved.length + ' quads at z ' + moved.map(q => q.water.pos[2]).join(', '));
    frame();
    say(ok, ok ? 'selftest water3d passed' : 'selftest water3d failed');
    document.title = ok ? 'selftest water3d passed' : 'selftest water3d failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }

  // the bushes' self-test (?selftest=grass3d): CM_Ring's bushes as blades on the ground, laid out as the client's
  // grass renderer does, seen in the picture, and following an edit of a bush at the next check
  async function selftestGrass() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return !!ok; };
    let ok = true;
    activate();
    ok &= say(!!V.gl, 'WebGL context');
    const ground = () => V.models.get(V.groundUrl);
    ok &= say(await until(() => settled() && S.preview && ground() && ground().ready && V.heights && V.grassTex && V.grassTex.ok, 180000),
      'scene, ground, its heights and the blade texture loaded (' + V.grassTexState + ')');
    const bushes = (S.preview && S.preview.bushes) || [];
    instances();
    const m = V.grassModel, blades = m ? m.blades : [];
    ok &= say(bushes.length >= 2 && bushes.some(b => b.team === 2) && blades.length > 1000,
      `preview.json: ${bushes.length} bushes (both teams); ${blades.length} blades in ${m ? m.draws.length : 0} draws`);
    // each blade in its bush, on the ground, as tall as the grass data says; about density squared a square metre
    const area = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    let inside = 0, onGround = 0, tall = 0;
    for (const bl of blades) {
      if (inPoly([bl.x, bl.y], bushes[bl.b].outline)) inside++;
      if (Math.abs(bl.z - heightAt(bl.x, bl.y)) < 1e-6) onGround++;
      if (bl.h >= GRASS.height - GRASS.heightVari && bl.h <= GRASS.height + GRASS.heightVari) tall++;
    }
    ok &= say(inside === blades.length && onGround === blades.length && tall === blades.length,
      `${inside} of ${blades.length} blades inside their bush, ${onGround} on the ground's height, ${tall} between ${GRASS.height - GRASS.heightVari} and ${GRASS.height + GRASS.heightVari} m`);
    let dense = 0;
    bushes.forEach((b, i) => {
      const n = blades.filter(bl => bl.b === i).length, want = area(b.outline) * GRASS.density * GRASS.density;
      const good = n > want * 0.8 && n < want * 1.2;
      if (good) dense++;
      if (i < 4 || !good) say(good, `bush ${b.name} (team ${b.team}): ${n} blades for ${area(b.outline).toFixed(0)} m2 (${want.toFixed(0)} at ${GRASS.density} a metre)`);
    });
    ok &= say(dense === bushes.length, `${dense} of ${bushes.length} bushes as dense as the grass data`);
    const zs = blades.map(bl => bl.z);
    say(true, `the blades' feet from z ${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)}`);
    // in the picture: over each of the first team's bushes the blades change the pixels, towards green
    const gl = V.gl, N = 16;
    const read = w => {
      frame();
      const vp = V.vp;
      const cx = vp[0] * w[0] + vp[4] * w[1] + vp[8] * w[2] + vp[12], cy = vp[1] * w[0] + vp[5] * w[1] + vp[9] * w[2] + vp[13];
      const cw = vp[3] * w[0] + vp[7] * w[1] + vp[11] * w[2] + vp[15];
      const px = Math.round((cx / cw + 1) / 2 * V.canvas.width) - N / 2, py = Math.round((cy / cw + 1) / 2 * V.canvas.height) - N / 2;
      const b = new Uint8Array(4 * N * N);
      gl.readPixels(px, py, N, N, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    let seen = 0;
    const own = bushes.map((b, i) => [b, i]).filter(([b]) => b.team === 1);
    for (const [b, i] of own) {
      const bs = blades.filter(bl => bl.b === i);
      const c = [bs.reduce((s, bl) => s + bl.x, 0) / bs.length, bs.reduce((s, bl) => s + bl.y, 0) / bs.length];
      const w = [c[0], c[1], heightAt(c[0], c[1]) + 1];
      gameCamera();
      setTarget(c[0], c[1]);
      const on = read(w);
      V.grass = false;
      const off = read(w);
      V.grass = true;
      let changedPx = 0, green = 0;
      for (let k = 0; k < N * N; k++) {
        const d = Math.abs(on[4 * k] - off[4 * k]) + Math.abs(on[4 * k + 1] - off[4 * k + 1]) + Math.abs(on[4 * k + 2] - off[4 * k + 2]);
        if (d > 12) changedPx++;
        if (d > 12 && on[4 * k + 1] > on[4 * k] && on[4 * k + 1] >= on[4 * k + 2]) green++;
      }
      const good = changedPx > N * N * 0.4 && green > changedPx * 0.5;
      if (good) seen++;
      say(good, `picture over ${b.name} at (${c[0].toFixed(1)}, ${c[1].toFixed(1)}): ${changedPx} of ${N * N} pixels change with the blades, ${green} of them green`);
    }
    ok &= say(seen === own.length && gl.getError() === 0, `${seen} of ${own.length} bushes of team 1 seen, no GL error`);
    // an edit: a bush of team 1 moved 4 m east; its blades (and its mirror's) follow at the next check
    const b0 = bushes.find(b => b.team === 1), sh = b0 && S.doc.terrain.shapes[b0.shape];
    const mean = (bs, k) => bs.reduce((s, bl) => s + bl[k], 0) / Math.max(1, bs.length);
    const of = (team, shape) => { const i = S.preview.bushes.findIndex(b => b.team === team && b.shape === shape); return V.grassModel.blades.filter(bl => bl.b === i); };
    if (sh) {
      const x1 = mean(of(1, b0.shape), 'x'), x2 = mean(of(2, b0.shape), 'x');
      if (isPt(sh.circle)) sh.circle = [sh.circle[0] + 4, sh.circle[1]];
      if (Array.isArray(sh.polygon)) sh.polygon = sh.polygon.map(p => [p[0] + 4, p[1]]);
      changed(true);
      clearTimeout(S.checkTimer);
      await runCheck();
      instances();
      const y1 = mean(of(1, b0.shape), 'x'), y2 = mean(of(2, b0.shape), 'x');
      ok &= say(Math.abs(y1 - x1 - 4) < 0.6 && Math.abs(y2 - x2 + 4) < 0.6, `bush ${b0.name} moved 4 m east: its blades by ${(y1 - x1).toFixed(2)} m, its mirror's by ${(y2 - x2).toFixed(2)} m`);
    } else ok &= say(false, 'no bush shape to edit');
    frame();
    say(ok, ok ? 'selftest grass3d passed' : 'selftest grass3d failed');
    document.title = ok ? 'selftest grass3d passed' : 'selftest grass3d failed';
    document.body.dataset.selftest = ok ? 'passed' : 'failed';
  }

  // readAt draws a frame and returns the N x N pixels (RGBA) round the game point w, for other panes' self-tests
  function readAt(w, N) {
    frame();
    const gl = V.gl, vp = V.vp;
    const cx = vp[0] * w[0] + vp[4] * w[1] + vp[8] * w[2] + vp[12], cy = vp[1] * w[0] + vp[5] * w[1] + vp[9] * w[2] + vp[13];
    const cw = vp[3] * w[0] + vp[7] * w[1] + vp[11] * w[2] + vp[15];
    const px = Math.round((cx / cw + 1) / 2 * V.canvas.width) - N / 2, py = Math.round((cy / cw + 1) / 2 * V.canvas.height) - N / 2;
    const b = new Uint8Array(4 * N * N);
    gl.readPixels(px, py, N, N, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return b;
  }

  ED.selftests = ED.selftests || {};
  ED.selftests['3d'] = selftest;
  ED.selftests.water3d = selftestWater;
  ED.selftests.grass3d = selftestGrass;

  // ---- editing in 3-D: the self-test (?selftest=3d-edit) and the pictures' poses (?pose=) (EDUX3) ----------------

  // E3: helpers that drive the 3-D view by real events at world points (whole pixels, as a mouse gives them)
  const E3 = {
    client(p) { // a world point (on the ground, or [x, y, z]) -> {clientX, clientY} on the 3-D canvas, or null
      const s = project(p);
      if (!s) return null;
      const r = V.canvas.getBoundingClientRect();
      return { clientX: Math.round(r.left + s[0] * r.width / V.canvas.width), clientY: Math.round(r.top + s[1] * r.height / V.canvas.height) };
    },
    down(p, o) { const c = E3.client(p); V.canvas.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1 }, c, o || {}))); return c; },
    move(p, o) { const c = E3.client(p); window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 1 }, c, o || {}))); return c; },
    up(p, o) { const c = E3.client(p); window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ bubbles: true, button: 0 }, c, o || {}))); },
    // a camera drag by the button b (0 left, 1 middle, 2 right) from canvas pixel a by (dx, dy) CSS pixels
    camDrag(b, dx, dy, o) {
      const r = V.canvas.getBoundingClientRect(), x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const ev = (t, cx, cy) => V.canvas.dispatchEvent(new PointerEvent(t, Object.assign({ bubbles: true, cancelable: true, button: b, buttons: 1 << (b === 1 ? 2 : b === 2 ? 1 : 0), pointerId: 2, clientX: cx, clientY: cy }, o || {})));
      ev('pointerdown', x, y);
      ev('pointermove', x + dx, y + dy);
      ev('pointerup', x + dx, y + dy);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: b, clientX: x + dx, clientY: y + dy }));
    },
    // overlay pixels drawn (alpha > 0) in a box of half-size h round canvas pixel s
    inked(s, h) {
      if (!s) return 0;
      const x0 = Math.max(0, Math.round(s[0] - h)), y0 = Math.max(0, Math.round(s[1] - h));
      const w = Math.min(V.ov.width - x0, 2 * h), hh = Math.min(V.ov.height - y0, 2 * h);
      if (w <= 0 || hh <= 0) return 0;
      const d = V.octx.getImageData(x0, y0, w, hh).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    },
    // a spot of open ground on team 1's half, about t of the way from its spawns to the centre, with the spot +(dx, dy)
    // open too and no prop within 6 m of either (whole metres)
    openSpot(t0, dx, dy) {
      const sp = objects().filter(o => o.kind === 'spawn'), items = typeof PR !== 'undefined' ? PR.live() : [];
      const c = sp.length ? [sp.reduce((s, o) => s + o.pos[0], 0) / sp.length, sp.reduce((s, o) => s + o.pos[1], 0) / sp.length] : [-100, -100];
      const free = p => FR.groundKind(p).kind === 'open' && p[0] + p[1] < -4 &&
        !items.some(it => Math.hypot(it.pos[0] - p[0], it.pos[1] - p[1]) < 6 || Math.hypot(it.pos[0] + p[0], it.pos[1] + p[1]) < 6) &&
        !objects().some(o => Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < 10);
      for (let k = 0; k < 60; k++) {
        const t = t0 + (k % 12) * 0.05, side = Math.floor(k / 12) * 6 * (k % 2 ? 1 : -1);
        const p = [Math.round(c[0] * (1 - t) + side), Math.round(c[1] * (1 - t) - side)];
        if (free(p) && free([p[0] + dx, p[1] + dy])) return p;
      }
      return null;
    },
    // a noun with a model, a metre or two across (a rock, a crate): the test's doodad
    noun() {
      const ns = (typeof PR !== 'undefined' && PR.P.nouns) || [];
      const fit = n => n.icon && n.box && PR.radius(n.name, 1) >= 0.8 && PR.radius(n.name, 1) <= 2.5 && n.box.max[2] - n.box.min[2] > 0.5;
      const n = ns.find(n => fit(n) && /rock/i.test(n.name)) || ns.find(fit);
      return n ? n.name : '';
    },
    // the 3-D view ready to edit: the scene, the ground and its heights, the nouns
    async ready(ms) {
      activate();
      const ok = await until(() => settled() && V.heights && V.models.get(V.groundUrl) && V.models.get(V.groundUrl).ready &&
        typeof PR !== 'undefined' && PR.P.state === 'ready', ms);
      gameCamera();
      return ok;
    },
    look(p, dist) { V.cam.dist = dist || 35; setTarget(p[0], p[1]); frame(); },
  };

  async function selftestEdit() {
    const out = $('selftest'), lines = [];
    out.classList.remove('hidden');
    const say = (ok, msg) => { ok = !!ok; lines.push((ok ? 'PASS ' : 'FAIL ') + msg); out.textContent = lines.join('\n'); return ok; };
    const settle = async () => { clearTimeout(S.checkTimer); await runCheck(); };
    const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
    let ok = true;
    ok &= say(await until(() => S.doc && S.preview, 60000), 'a map open: ' + S.pkg);
    ok &= say(await E3.ready(300000), `3-D: the scene, the ground (${V.heights ? V.heights.nx + ' x ' + V.heights.ny + ' m of heights, z ' + V.heights.zmin.toFixed(1) + ' to ' + V.heights.zmax.toFixed(1) : 'none'}) and the nouns loaded`);
    const noun = E3.noun(), P0 = E3.openSpot(0.3, 4, -3);
    ok &= say(noun && P0, `the doodad ${noun}, the spot (${P0}) on open ground of team 1's half`);
    if (!noun || !P0) return finish();
    const P1 = [P0[0] + 4, P0[1] - 3];
    const doc0 = snapshot(), snap0 = S.snap;
    S.snap = true; // Tools > Snap to 1 m: both views land on the same whole metres (their pixels differ)
    select(null);
    E3.look(P0, 35);

    // (1) the pick: the ray over the ground, round trips through project
    const cw = V.canvas.width, ch = V.canvas.height;
    let worst = 0, n = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.75], [0.8, 0.3], [0.6, 0.95], [0.1, 0.1]]) {
      const pk = pickAt(cw * fx, ch * fy);
      if (!pk) continue;
      n++;
      const q = project(pk.w);
      worst = Math.max(worst, q ? Math.hypot(q[0] - cw * fx, q[1] - ch * fy) : Infinity);
    }
    const back = pickAt(...project(P0));
    ok &= say(n >= 4 && worst < 1 && back && Math.hypot(back.w[0] - P0[0], back.w[1] - P0[1]) < 0.05 && Math.abs(back.near / (dpr / ppm(P0)) - 1) < 1e-3,
      `pick: ${n} of 5 pixels on the ground, back through project within ${worst.toFixed(3)} px; the spot back within ${back ? Math.hypot(back.w[0] - P0[0], back.w[1] - P0[1]).toFixed(3) : '?'} m, near ${back ? back.near.toFixed(3) : '?'} m a pixel`);
    // tilted and turned: still the same ground point
    V.cam.yaw = 35; V.cam.pitch = 40; V.cam.mode = 'free'; frame();
    const tilt = pickAt(...project(P0));
    ok &= say(tilt && Math.hypot(tilt.w[0] - P0[0], tilt.w[1] - P0[1]) < 0.05, `pick with the camera turned 35 and tilted to 40 degrees: (${tilt && tilt.w.map(v => v.toFixed(2))})`);
    gameCamera(); E3.look(P0, 35);

    // (2) place: the Prop tool's ghost (and its mirror's) under the mouse, then a click places it as the ghost shows
    PR.P.cur = noun;
    setTool('prop');
    PR.setNext({ rot: 30, scale: 1.2 });
    E3.move(P0, { buttons: 0 });
    await until(() => { frame(); return V.lastList.filter(i => i.ghost && i.model.ready).length === 2; }, 60000); // its model asked for
    const ghosts = V.lastList.filter(i => i.ghost);
    const sP0 = project(P0), inkG = E3.inked(sP0, Math.ceil(PR.radius(noun, 1.2) * ppm(P0)) + 6);
    ok &= say(S.mouseW && Math.hypot(S.mouseW[0] - P0[0], S.mouseW[1] - P0[1]) < 0.3 && ghosts.length === 2 && ghosts.some(g => g.ghost === 0.3) && inkG > 20,
      `the ghost: ${ghosts.length} see-through models (the doodad and its mirror), ${inkG} overlay pixels of its ring at the mouse`);
    const nP = (S.doc.props || []).length;
    E3.down(P0); E3.up(P0);
    const k = (S.doc.props || []).length - 1, c = S.doc.props[k];
    ok &= say((S.doc.props || []).length === nP + 1 && c && eq(c.pos, P0) && c.rot === 30 && c.scale === 1.2 && S.sel && S.sel.t === 'prop' && S.sel.k === k,
      `a click placed props[${k}]: ${JSON.stringify(c)}`);
    setTool('select');
    frame();
    const hd0 = PR.handles(k, VIEW3D), sel0 = E3.inked(project(hd0.rot), 7);
    ok &= say(sel0 > 20, `selected in 3-D: its turn handle drawn (${sel0} pixels), ${Math.hypot(hd0.rot[0] - P0[0], hd0.rot[1] - P0[1]).toFixed(1)} m out`);

    // (3) move it by a drag (the model's middle, not the ground under it), timing the steps
    const mid = [P0[0], P0[1], (PR.P.byKey.get(PR.key(noun)).box.max[2] * 1.2) / 2];
    const hm = hit(...project(mid));
    ok &= say(hm && hm.sel.t === 'prop' && hm.sel.k === k, `its model hit at its middle (${(mid[2]).toFixed(1)} m up): ${JSON.stringify(hm && hm.sel)}`);
    const tIn = [], tFrame = [], nList = V.listMs.length;
    E3.down(P0);
    for (let i = 1; i <= 10; i++) {
      const p = [P0[0] + (P1[0] - P0[0]) * i / 10, P0[1] + (P1[1] - P0[1]) * i / 10];
      const t0 = performance.now();
      E3.move(p);
      const t1 = performance.now();
      frame(); V.gl.finish();
      tIn.push(t1 - t0); tFrame.push(performance.now() - t1);
    }
    E3.up(P1);
    await settle();
    ok &= say(eq(S.doc.props[k].pos, P1), `dragged to (${S.doc.props[k].pos})`);
    const tList = V.listMs.slice(nList), tOv = V.overlayMs.slice(nList);
    E3.perf = { input: med(tIn), inputMax: Math.max(...tIn), frame: med(tFrame), frameMax: Math.max(...tFrame), list: med(tList), overlay: med(tOv), parts: V.stats.parts };
    say(true, `the drag on ${S.pkg} (${V.canvas.width} x ${V.canvas.height} px): input ${E3.perf.input.toFixed(1)} ms a step (max ${E3.perf.inputMax.toFixed(1)}), ` +
      `frame ${E3.perf.frame.toFixed(1)} ms (max ${E3.perf.frameMax.toFixed(1)}; software WebGL), of it the instance list ${E3.perf.list.toFixed(2)} ms and the overlay ${E3.perf.overlay.toFixed(2)} ms; ` +
      `${V.stats.parts} instances, ${V.stats.draws} draws` + (Math.max(...tIn, ...tFrame) === 0 ? ' (all 0: virtual time; run it in real time to measure)' : ''));
    // the worst case: the whole map in view (nothing culled), a frame for each step of the drag back
    E3.look([0, 0], 420);
    const tWide = [], pos1 = S.doc.props[k].pos;
    for (let i = 1; i <= 10; i++) {
      S.doc.props[k].pos = [P1[0] - (P1[0] - P0[0]) * i / 10, P1[1] - (P1[1] - P0[1]) * i / 10];
      const t0 = performance.now();
      frame(); V.gl.finish();
      tWide.push(performance.now() - t0);
    }
    S.doc.props[k].pos = pos1;
    E3.perf.wide = med(tWide); E3.perf.wideMax = Math.max(...tWide);
    say(true, `the whole map in view: frame ${E3.perf.wide.toFixed(1)} ms (max ${E3.perf.wideMax.toFixed(1)}), ${V.stats.draws} draws, ${V.stats.culled} culled`);
    E3.look(P1, 35);

    // (4) turn it by its handle, 45 degrees (Shift: 15-degree steps)
    frame();
    const hd = PR.handles(k, VIEW3D), a0 = (+S.doc.props[k].rot || 0) * Math.PI / 180, R = Math.hypot(hd.rot[0] - P1[0], hd.rot[1] - P1[1]);
    const hr = hit(...project(hd.rot));
    ok &= say(hr && hr.sel.t === 'protate', `the turn handle hit: ${JSON.stringify(hr && hr.sel)}`);
    E3.down(hd.rot);
    for (let i = 1; i <= 5; i++) { const a = a0 + Math.PI / 4 * i / 5; E3.move([P1[0] + R * Math.cos(a), P1[1] + R * Math.sin(a)], { shiftKey: true }); }
    E3.up(hd.rot);
    await settle();
    ok &= say(S.doc.props[k].rot === 75, `turned by its handle to ${S.doc.props[k].rot} degrees`);

    // (5) a Binding moved by a drag; the camera stays (no Follow the Selection for a click in the view)
    const b = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 0);
    const T = b ? [Math.round(b.pos[0] + 6), Math.round(b.pos[1] - 4)] : null;
    if (b) {
      E3.look(b.pos, 40);
      // pressed on its model's middle (the tower, not its foot); the drag follows the ground under the mouse
      const bi = V.lastList.find(i => i.obj && i.obj.kind === 'binding' && i.obj.team === 1 && i.obj.name === b.name);
      const bc = bi ? mulPoint(bi.mat, glPoint(bi.model.centre)) : [b.pos[0], b.pos[1]];
      const hb = hit(...project(bc)), cam0 = [V.cam.tx, V.cam.ty], g0 = pickAt(...project(bc));
      ok &= say(hb && sameSel(hb.sel, objSel(b)) && g0, `the Binding hit on its model, ${bc[2] !== undefined ? bc[2].toFixed(1) : '?'} m up: ${JSON.stringify(hb && hb.sel)}`);
      const url0 = V.groundUrl;
      E3.down(bc);
      ok &= say(V.cam.tx === cam0[0] && V.cam.ty === cam0[1], 'selected by a click in 3-D: the camera stays');
      for (let i = 1; i <= 6; i++) E3.move([g0.w[0] + (T[0] - b.pos[0]) * i / 6, g0.w[1] + (T[1] - b.pos[1]) * i / 6]);
      frame();
      const live = instances().find(i => i.key === 'binding|1|lane 1 Outer');
      ok &= say(live && Math.hypot(live.at[0] - T[0], live.at[1] - T[1]) < 0.6, `its models follow the drag at once (${live && live.at.slice(0, 2).map(v => v.toFixed(1))})`);
      E3.up([g0.w[0] + T[0] - b.pos[0], g0.w[1] + T[1] - b.pos[1]]);
      await settle();
      ok &= say(eq(getAt(S.doc, ['base', 'bindings', '1', 0]), T), `the Binding dragged to (${getAt(S.doc, ['base', 'bindings', '1', 0])})`);
      await until(() => !V.groundBusy && V.groundUrl !== url0, 60000);
      ok &= say(V.groundUrl === url0 || (!V.models.has(url0) && V.stats.freed > 0), `the ground made again for the moved Binding; the replaced one freed (${V.stats.freed || 0} freed)`);
    } else ok &= say(false, 'no lane 1 Outer Binding');
    const doc3 = snapshot();

    // (6) the same edits in 2-D, by its mouse: the same map.json
    S.doc = JSON.parse(doc0);
    select(null);
    changed(true);
    await settle();
    ED.setView('2d');
    const r2 = cv.getBoundingClientRect();
    const c2 = p => { const s = w2s(p); return { clientX: Math.round(r2.left + s[0] / dpr), clientY: Math.round(r2.top + s[1] / dpr) }; };
    const at2 = p => { S.view = { x: p[0], y: p[1], scale: 10 * dpr }; S.fitted = false; render(); };
    const d2 = (p, o) => cv.dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true, button: 0, buttons: 1 }, c2(p), o || {})));
    const m2 = (p, o) => window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 1 }, c2(p), o || {})));
    const u2 = p => window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ bubbles: true, button: 0 }, c2(p))));
    at2(P0);
    setTool('prop');
    d2(P0); u2(P0);
    setTool('select');
    d2(P0); for (let i = 1; i <= 4; i++) m2([P0[0] + (P1[0] - P0[0]) * i / 4, P0[1] + (P1[1] - P0[1]) * i / 4]); u2(P1);
    await settle();
    at2(P1);
    const h2 = PR.handles(k, VIEW2D), b0 = (+S.doc.props[k].rot || 0) * Math.PI / 180, R2 = Math.hypot(h2.rot[0] - P1[0], h2.rot[1] - P1[1]);
    d2(h2.rot);
    for (let i = 1; i <= 5; i++) { const a = b0 + Math.PI / 4 * i / 5; m2([P1[0] + R2 * Math.cos(a), P1[1] + R2 * Math.sin(a)], { shiftKey: true }); }
    u2(h2.rot);
    await settle();
    if (b) { at2(b.pos); d2(b.pos); for (let i = 1; i <= 4; i++) m2([b.pos[0] + (T[0] - b.pos[0]) * i / 4, b.pos[1] + (T[1] - b.pos[1]) * i / 4]); u2(T); await settle(); }
    const doc2 = snapshot();
    ok &= say(doc2 === doc3, doc2 === doc3 ? `the same edits in 2-D give the same map.json (${doc3.length} bytes)` :
      `2-D and 3-D differ: 2-D ${JSON.stringify(S.doc.props[k])} ${JSON.stringify(getAt(S.doc, ['base', 'bindings', '1']))}; 3-D ${JSON.stringify(JSON.parse(doc3).props[k])} ${JSON.stringify(getAt(JSON.parse(doc3), ['base', 'bindings', '1']))}`);

    // (7) more of the 3-D view's mouse: a box on the screen, a doodad dropped from the palette, a polygon drawn
    S.doc = JSON.parse(doc3);
    select(null);
    changed(true);
    await settle();
    activate();
    E3.look(P1, 35);
    const sp = project(P1), rb = V.canvas.getBoundingClientRect(), k2 = V.canvas.width / rb.width;
    const corner = (dx, dy) => { const x = (sp[0] + dx * dpr) / k2 + rb.left, y = (sp[1] + dy * dpr) / k2 + rb.top; return { clientX: Math.round(x), clientY: Math.round(y) }; };
    V.canvas.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ bubbles: true, button: 0, buttons: 1, pointerId: 1, shiftKey: true }, corner(-60, -60))));
    window.dispatchEvent(new MouseEvent('mousemove', Object.assign({ bubbles: true, buttons: 1, shiftKey: true }, corner(60, 60))));
    frame();
    const boxInk = E3.inked([sp[0] + 60 * dpr, sp[1]], 4);
    window.dispatchEvent(new MouseEvent('mouseup', Object.assign({ bubbles: true, button: 0 }, corner(60, 60))));
    const ks = S.sel ? (S.sel.ks || (S.sel.t === 'prop' ? [S.sel.k] : [])) : [];
    ok &= say(ks.includes(k) && boxInk > 0, `a Shift + box on the screen round it selects it (${JSON.stringify(S.sel && (S.sel.ks || S.sel))}; the box drawn: ${boxInk} pixels)`);
    const nD = S.doc.props.length, Pd = [P1[0] - 3, P1[1] - 4];
    const dt = new DataTransfer();
    dt.setData('text/x-dg-noun', noun);
    V.canvas.dispatchEvent(new DragEvent('drop', Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, E3.client(Pd))));
    const dropped = S.doc.props[S.doc.props.length - 1];
    ok &= say(S.doc.props.length === nD + 1 && eq(dropped.pos, Pd), `a palette tile dropped onto the 3-D view places it there: ${JSON.stringify(dropped)}`);
    undo();
    const nW = (S.doc.wards || []).length, Pw = [P1[0] + 5, P1[1] + 2];
    setTool('ward'); // the Units palette's + Ward spot
    E3.down(Pw); E3.up(Pw);
    const ward = (S.doc.wards || [])[nW];
    ok &= say((S.doc.wards || []).length === nW + 1 && ward && eq(ward.pos, Pw), `the Units palette's + Ward spot places one where 3-D is clicked: ${JSON.stringify(ward)}`);
    if ((S.doc.wards || []).length === nW + 1) undo();
    setTool('select');
    const nS = shapes().length, draw0 = S.draw, cliff0 = S.cliff;
    setTool('shape'); S.cliff = 'wall'; S.draw = 'polygon';
    const tri = [[P1[0] - 2, P1[1] + 6], [P1[0] + 3, P1[1] + 6], [P1[0], P1[1] + 10]];
    for (const p of tri) { E3.down(p); E3.up(p); }
    const dc = E3.client(tri[2]);
    V.canvas.dispatchEvent(new MouseEvent('dblclick', Object.assign({ bubbles: true }, dc)));
    const tsh = shapes()[shapes().length - 1];
    ok &= say(shapes().length === nS + 1 && tsh && tsh.polygon && tsh.polygon.length === 3 && eq(tsh.polygon[0], tri[0]), `a polygon of three clicks, ended by a double-click: ${JSON.stringify(tsh)}`);
    if (shapes().length === nS + 1) undo();
    S.draw = draw0; S.cliff = cliff0;
    setTool('select');

    // (8) the camera: left on the ground is the tool's; right drag pans, Shift + right zooms, Ctrl + right turns, the
    // wheel zooms; the arrows and F only with the view focused
    E3.look(P1, 35);
    const cam = () => JSON.stringify([V.cam.tx, V.cam.ty, V.cam.dist, V.cam.yaw, V.cam.pitch]), c0 = cam();
    E3.down(P0); E3.up(P0);
    ok &= say(cam() === c0, 'a left click on the ground: the camera stays (the tool has it; selected ' + JSON.stringify(S.sel) + ')');
    select({ t: 'prop', k });
    let c1 = cam();
    E3.camDrag(2, 80, 0);
    const pan = cam() !== c1 && V.cam.dist === 35 && V.cam.yaw === 0;
    c1 = cam(); E3.camDrag(1, 0, 60);
    const panM = cam() !== c1 && V.cam.dist === 35;
    c1 = cam(); E3.camDrag(2, 0, -50, { shiftKey: true });
    const zoom = V.cam.dist < 35 && JSON.parse(cam())[0] === JSON.parse(c1)[0];
    c1 = cam(); E3.camDrag(2, 60, 0, { ctrlKey: true });
    const turn = V.cam.yaw !== 0;
    const d0 = V.cam.dist;
    V.canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200, clientX: 10, clientY: 10 }));
    const wheel = V.cam.dist > d0;
    ok &= say(pan && panM && zoom && turn && wheel && S.sel && S.sel.k === k, `right drag pans ${pan}, middle drag pans ${panM}, Shift + right zooms ${zoom}, Ctrl + right turns ${turn} (yaw ${V.cam.yaw.toFixed(0)}), the wheel zooms ${wheel}; the selection kept`);
    gameCamera();
    const key = kk => window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, cancelable: true }));
    const btn = $('btnNew');
    btn.focus();
    c1 = cam(); key('ArrowLeft');
    const ignored = cam() === c1;
    btn.blur();
    V.canvas.focus();
    key('ArrowLeft');
    const moved = cam() !== c1;
    V.cam.dist = 120; setTarget(0, 0);
    key('f');
    const framed = Math.hypot(V.cam.tx - P1[0], V.cam.ty - P1[1]) < 1e-6 && V.cam.dist >= 25 && V.cam.dist < 60;
    ok &= say(ignored && moved && framed, `ArrowLeft with a button focused: ignored ${ignored}; with the view focused: scrolls ${moved}; F frames the selection ${framed} (${V.cam.dist.toFixed(0)} m)`);

    // (9) a check marker in 3-D: a spawn moved into the wall
    const sp0 = getAt(S.doc, ['base', 'spawns', 0]);
    let wallAt = null;
    for (let r = 20; r < 200 && !wallAt; r += 4) for (let a = 0; a < 16 && !wallAt; a++) {
      const p = [Math.round(sp0[0] + r * Math.cos(a * Math.PI / 8)), Math.round(sp0[1] + r * Math.sin(a * Math.PI / 8))];
      if (p[0] + p[1] < -10 && FR.groundKind(p).kind === 'wall') wallAt = p;
    }
    if (wallAt) {
      edit(() => setPoint(['base', 'spawns', 0], wallAt));
      await settle();
      const f = (S.report.findings || []).find(x => x.at);
      if (f) {
        E3.look(f.at, 50);
        const s = project(f.at), ink = E3.inked(s, 16);
        ok &= say(ink > 30, `the check's marker ${f.rule} at (${f.at.map(v => v.toFixed(1))}) drawn in 3-D (${ink} overlay pixels)`);
      } else ok &= say(false, 'a spawn in the wall: no finding with a place (' + (S.report.findings || []).map(x => x.rule).join(' ') + ')');
      undo();
      await settle();
    } else say(true, 'no wall near the spawns: the marker not tested');

    // (10) the caches: live() kept while nothing changes, made again after an edit
    const l1 = PR.live(), l2 = PR.live();
    edit(() => { S.doc.props[k].rot = 90; });
    const l3 = PR.live();
    ok &= say(l1 === l2 && l3 !== l2 && l3.some(it => it.k === k && it.rot[2] !== l2.find(x => x.k === k && x.team === it.team).rot[2]), 'PR.live() kept while the document stays, made again after an edit');
    undo();

    // (11) Alt+wheel: a doodad's height (the user's request at the look): the selected one's, one undo step a gesture,
    // Shift+Alt by a metre, the model and the label following at once; nothing on a Binding; the next doodad's; 2-D too
    const zOf = () => PR.pos3(S.doc.props[k].pos)[2];
    const altWheel = (el, c, o) => el.dispatchEvent(new WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, deltaY: -100, altKey: true }, c, o || {})));
    activate();
    select({ t: 'prop', k });
    E3.look(P1, 35);
    const u0 = S.undo.length, dist0 = V.cam.dist, z0 = zOf();
    for (let i = 0; i < 3; i++) altWheel(V.canvas, E3.client(P1));
    frame();
    const zi = V.lastList.find(i => i.item && i.item.k === k && i.item.team === 1);
    const zInk = E3.inked(project([P1[0], P1[1], zOf()]), 5);
    ok &= say(Math.abs(zOf() - z0 - 0.3) < 1e-9 && S.undo.length === u0 + 1 && V.cam.dist === dist0 && zi && Math.abs(zi.at[2] - zOf()) < 1e-9 && zInk > 0,
      `Alt+wheel 3 notches on the selected doodad: z ${z0} -> ${zOf()} m, one undo step (${S.undo.length - u0}), no zoom, its model at z ${zi && zi.at[2]}, the height drawn (${zInk} pixels)`);
    await new Promise(r => setTimeout(r, 450));
    altWheel(V.canvas, E3.client(P1), { shiftKey: true });
    const zBig = zOf(), u1 = S.undo.length;
    undo();
    const zU = zOf();
    undo();
    ok &= say(Math.abs(zBig - z0 - 1.3) < 1e-9 && u1 === u0 + 2 && Math.abs(zU - z0 - 0.3) < 1e-9 && zOf() === z0,
      `Shift+Alt+wheel a metre more (${zBig} m) as its own step; undo: ${zU}, then ${zOf()} m`);
    const bb = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 0), bj = JSON.stringify(S.doc.base), uB = S.undo.length;
    select(objSel(bb));
    altWheel(V.canvas, E3.client(bb.pos));
    ok &= say(JSON.stringify(S.doc.base) === bj && S.undo.length === uB && V.cam.dist === dist0 && /stand on the ground/.test(($('log').firstChild || {}).textContent || ''),
      'Alt+wheel on a Binding: no height (it stands on the ground; Messages says so), no zoom');
    PR.P.cur = noun;
    setTool('prop');
    const Pg = [P1[0] - 4, P1[1] + 3];
    E3.move(Pg, { buttons: 0 });
    for (let i = 0; i < 5; i++) altWheel(V.canvas, E3.client(Pg));
    await until(() => { frame(); return V.lastList.some(i => i.ghost === 0.55 && i.model.ready); }, 30000);
    const gh = V.lastList.find(i => i.ghost === 0.55), field = document.querySelector('input[data-next="z"]');
    const nG = S.doc.props.length;
    E3.down(Pg); E3.up(Pg);
    const placedZ = PR.pos3(S.doc.props[S.doc.props.length - 1].pos)[2];
    ok &= say(PR.P.nextZ === 0.5 && gh && Math.abs(gh.mat[14] - 0.5) < 1e-9 && field && +field.value === 0.5 && /height 0\.5 m/.test($('st2').textContent) &&
      S.doc.props.length === nG + 1 && placedZ === 0.5 && V.cam.dist === dist0,
      `the next doodad: Alt+wheel 5 notches -> Next: height ${field && field.value} m, the ghost at z ${gh && gh.mat[14].toFixed(2)}, the status "${$('st2').textContent}", placed at z ${placedZ}`);
    undo();
    PR.setNext({ z: 0 });
    setTool('select');
    ED.setView('2d');
    select({ t: 'prop', k });
    at2(P1);
    const scale2 = S.view.scale;
    altWheel(cv, c2(P1)); altWheel(cv, c2(P1));
    ok &= say(Math.abs(zOf() - z0 - 0.2) < 1e-9 && S.view.scale === scale2, `2-D: Alt+wheel 2 notches -> z ${zOf()} m, the zoom kept`);
    undo();
    activate();
    S.snap = snap0;
    return finish();

    function finish() {
      say(ok, ok ? 'selftest 3d-edit passed' : 'selftest 3d-edit failed');
      document.title = ok ? 'selftest 3d-edit passed' : 'selftest 3d-edit failed';
      document.body.dataset.selftest = ok ? 'passed' : 'failed';
    }
  }

  // ?pose=<name> (with ?open=<map>): the 3-D view left in an editing state for a picture (a headless
  // screenshot): ghost (the Prop tool's next doodad under the mouse), mirror (the ghost near the centre with its mirror),
  // selected (a placed doodad with its handles), binding (a Binding in the middle of a drag), marker (a check finding)
  const POSE = URLQ.get('pose');
  async function pose() {
    if (!POSE || !S.doc) return;
    if (!await E3.ready(300000)) return;
    const noun = E3.noun(), P0 = E3.openSpot(0.3, 4, -3);
    if (!noun || !P0) return;
    PR.P.cur = noun;
    PR.setNext({ rot: 30, scale: 1.2 });
    if (POSE === 'ghost' || POSE === 'mirror') {
      const p = POSE === 'mirror' ? [-14, -9] : P0;
      E3.look(POSE === 'mirror' ? [0, 0] : p, POSE === 'mirror' ? 75 : 30);
      setTool('prop');
      E3.move(p, { buttons: 0 });
    } else if (POSE === 'selected') {
      E3.look(P0, 28);
      PR.placeNoun(noun, P0);
      setTool('select');
      E3.move([P0[0] + 2, P0[1] - 3], { buttons: 0 });
    } else if (POSE === 'binding') {
      const b = objects().find(o => o.kind === 'binding' && o.lane === 1 && o.tier === 0);
      if (!b) return;
      E3.look([b.pos[0] + 3, b.pos[1] - 2], 45);
      E3.down(b.pos);
      for (let i = 1; i <= 4; i++) E3.move([b.pos[0] + 2 * i, b.pos[1] - 1.5 * i]);
    } else if (POSE === 'marker') {
      const sp0 = getAt(S.doc, ['base', 'spawns', 0]);
      let wallAt = null;
      for (let r = 20; r < 200 && !wallAt; r += 4) for (let a = 0; a < 16 && !wallAt; a++) {
        const p = [Math.round(sp0[0] + r * Math.cos(a * Math.PI / 8)), Math.round(sp0[1] + r * Math.sin(a * Math.PI / 8))];
        if (p[0] + p[1] < -10 && FR.groundKind(p).kind === 'wall') wallAt = p;
      }
      if (!wallAt) return;
      edit(() => setPoint(['base', 'spawns', 0], wallAt));
      clearTimeout(S.checkTimer);
      await runCheck();
      const f = (S.report.findings || []).find(x => x.at);
      if (f) E3.look(f.at, 55);
    }
    frame();
  }
  ED.on('started', pose);
  ED.selftests['3d-edit'] = selftestEdit;

  ED.on('started', () => { ED.hitFirst.push(hitModels); }); // after every part's handles (they push theirs at load)
  ED.on('started', fromURL);

  const api3d = {
    V, M, GAME, FROM_GLTF, setTarget, setScene, goTo, frameSel, redraw, pick, pickAt, ray, groundHit, xy, instances, freeModel, modelFor, heightAt, eye, look, project, ppm,
    activate, settled, until, gameCamera, freeCamera, frame, readAt, mistNow, isFogFace, groundKey, groundModel, swapGround, refreshGround, statusText: '',
    addLayer(fn) { V.layers.push(fn); redraw(); },
  };
  return api3d;
})();

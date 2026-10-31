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
    cam: { tx: 0, ty: 0, tz: 0, yaw: GAME.yaw, pitch: GAME.pitch, dist: GAME.dist, fov: GAME.fov, mode: 'game' },
    stats: { draws: 0, culled: 0, parts: 0, models: 0, failed: 0 }, drag: null, status: null, frameNo: 0,
    follow: true, dressing: true,
    water: true, waterModel: null, vp: null, // the chasms' water planes (shown; their quad); the last frame's matrix
    mist: true, // the void's mist term (mistNow)
    grass: true, grassModel: null, grassKey: '', grassTex: null, grassTexState: '', // the bushes' blades
    heights: null, heightsN: 0, // the ground's heights (the last ground model's vertices), for what stands on it
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
uniform vec4 uFactor; uniform vec3 uLight; uniform vec3 uEye; uniform vec3 uMist; uniform vec3 uMistCol;
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
  gl_FragColor = vec4(rgb, uCut > 0.0 ? 1.0 : c.a);
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
    for (const u of ['uMVP', 'uModel', 'uNrm', 'uTex', 'uHasTex', 'uVC', 'uUnlit', 'uCut', 'uFactor', 'uLight', 'uEye', 'uMist', 'uMistCol']) {
      V.loc[u] = gl.getUniformLocation(p, u);
    }
    return true;
  }

  // ---- loading: glTF (mapc's subset: one buffer, float/ubyte attributes, u16 indices) and PNG textures --------

  const COMP = { 5126: 4, 5121: 1, 5123: 2 };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  function texture(url) {
    if (V.textures.has(url)) return V.textures.get(url);
    const gl = V.gl, t = { tex: null, ok: false };
    V.textures.set(url, t);
    const img = new Image();
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
    const m = { url, ready: false, failed: false, draws: [], centre: [0, 0, 0], radius: 1, triangles: 0 };
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
      if (pbr.baseColorTexture) tex = texture(dir + doc.images[doc.textures[pbr.baseColorTexture.index].source].uri);
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
    if (m.url === V.groundUrl) {
      V.heights = heightsOf(doc, bin);
      V.heightsN++;
    }
    m.ready = true;
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
    for (let i = 0; i < pts.length; i += 3) {
      const k = Math.floor(pts[i + 1] - y0) * nx + Math.floor(pts[i] - x0);
      if (!(z[k] >= pts[i + 2])) z[k] = pts[i + 2];
    }
    return { x0, y0, nx, ny, z };
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

  function liveObjects() { // the package's objects as the last check placed them, by key
    const out = new Map();
    if (!S.preview || V.source !== 'map') return out;
    for (const o of S.preview.objects || []) out.set(o.kind + '|' + o.team + '|' + o.name, o.pos);
    for (const team of [1, 2]) {
      const sp = (S.preview.objects || []).filter(o => o.kind === 'spawn' && o.team === team);
      if (sp.length) out.set('spawns|' + team + '|spawn platform',
        [sp.reduce((s, o) => s + o.pos[0], 0) / sp.length, sp.reduce((s, o) => s + o.pos[1], 0) / sp.length]);
    }
    return out;
  }

  function instances() {
    const out = [];
    const sc = V.scene;
    if (V.source === 'map' && V.groundUrl) out.push({ model: modelFor(V.groundUrl), mat: FROM_GLTF, ground: true });
    waterInstances(out);
    grassInstances(out);
    if (!sc) return out;
    const live = liveObjects();
    for (const o of sc.objects) {
      if (!o.parts || o.hidden) continue;
      if (V.source === 'level' && !V.dressing && /_D_|Lights|shadow|VFX|Removed/i.test(o.markerset || '')) continue;
      // a package's props are drawn live from map.json by the props layer (props.js), not from the last export
      if (V.source === 'map' && /_props$/i.test(o.markerset || '')) continue;
      let p = o.pos;
      const lp = live.get(o.kind + '|' + o.team + '|' + o.name);
      if (lp) p = [lp[0], lp[1], o.pos[2] || 0];
      for (const part of o.parts) {
        const info = sc.models[part.model];
        if (!info) continue;
        const m = modelFor(V.base + info.file);
        const at = [p[0] + part.offset[0], p[1] + part.offset[1], (V.source === 'map' ? part.offset[2] : p[2])];
        out.push({ model: m, mat: M.mul(M.trs(at, part.rot, part.scale), FROM_GLTF), scale: part.scale,
          key: o.kind + '|' + o.team + '|' + o.name, at });
      }
    }
    return out;
  }

  // ---- the chasms' water: the planes the last check's preview.json lists (mapc's WaterPlanes, the same rectangles
  // the build places as water markers: pos with the water's z, rot degrees counter-clockwise about z, size along the
  // turned x and y), each a flat translucent teal quad. Not the game's water shader (no mask, ripples or reflection):
  // it shows where the water lies and how high, and follows an edit at the next check.
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
    V.stats.mist = mist;
    const list = instances();
    for (const layer of V.layers) layer({ gl, list, modelFor, M });
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
        } else if (!late.includes(it)) continue;
        const mvp = M.mul(vp, it.mat);
        gl.uniformMatrix4fv(V.loc.uMVP, false, mvp);
        gl.uniformMatrix4fv(V.loc.uModel, false, it.mat);
        gl.uniformMatrix3fv(V.loc.uNrm, false, normalMat(it.mat));
        for (const d of m.draws) {
          if (isFogFace(d.mat)) continue; // the void's mist plane: the shader's mist term draws it (mistNow)
          const blend = d.mat.draw === 'blend' || d.mat.draw === 'add';
          if ((pass === 'solid') === blend) { if (pass === 'solid' && !late.includes(it)) late.push(it); continue; }
          if (blend) gl.blendFunc(gl.SRC_ALPHA, d.mat.draw === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
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
      }
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    V.frameNo++;
    showStatus();
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
      if (res.scene.ground) { V.groundUrl = res.base + res.scene.ground; V.groundKey = groundKey(); }
    }
    setBusy('');
    log('3-D: ' + V.scene.map + ': ' + V.scene.objects.length + ' objects, ' + Object.keys(V.scene.models).length + ' models' +
      (V.scene.missing ? '; missing: ' + V.scene.missing.join('; ') : ''));
    redraw();
  }

  function groundKey() { // what the ground depends on
    const d = S.doc || {};
    const v = d.void && typeof d.void === 'object' ? d.void : null; // the cut and the backdrop are the ground's; the mist is drawn live
    return JSON.stringify([d.size, d.terrain, d.lanes, d.base, d.wells, d.camps, d.ground, v && [v.cut, v.backdrop]]);
  }

  async function refreshGround() {
    if (V.source !== 'map' || !S.pkg || !V.scene) return;
    const key = groundKey();
    if (key === V.groundKey) return;
    if (V.groundBusy) { V.groundAgain = true; return; }
    V.groundBusy = true;
    showStatus();
    const pkg = S.pkg;
    const res = await api('POST', '/api/ground/' + pkg);
    V.groundBusy = false;
    if (pkg === S.pkg) {
      if (res.ok) {
        V.groundKey = key;
        V.groundUrl = res.url;
        V.groundN = res.n;
      } else if (S.report && S.report.ok !== false) {
        log('3-D ground: ' + (res.error || JSON.stringify(res.result)), 'err');
      }
    }
    if (V.groundAgain) { V.groundAgain = false; refreshGround(); }
    redraw();
  }

  function setBusy(t) { if (V.status) V.status.textContent = t || ''; }

  // ---- camera input ---------------------------------------------------------------------------------------

  function setTarget(x, y) { V.cam.tx = x; V.cam.ty = y; redraw(); }
  function gameCamera() { Object.assign(V.cam, { pitch: GAME.pitch, dist: GAME.dist, fov: GAME.fov, mode: 'game' }); syncButtons(); redraw(); }

  function onDown(e) {
    V.drag = { x: e.clientX, y: e.clientY, b: e.button, alt: e.altKey, cam: Object.assign({}, V.cam) };
    V.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e) {
    const d = V.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y, c = V.cam;
    const orbit = c.mode === 'free' && d.b === 0 && !d.alt;
    if (orbit) {
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
  function onWheel(e) {
    e.preventDefault();
    const c = V.cam;
    c.dist = Math.max(8, Math.min(900, c.dist * Math.pow(1.0015, e.deltaY)));
    redraw();
  }

  function syncButtons() {
    if (!V.el) return;
    V.el.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === V.cam.mode));
  }

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

  // ---- the view's element -----------------------------------------------------------------------------------

  function build() {
    const el = document.createElement('div');
    el.className = 'view3d';
    el.innerHTML = `
<div class="bar">
  <label>Scene <select data-k="scene"><option value="">this map</option><option>SM_Map_v5</option><option>MM_Map_v3</option></select></label>
  <span class="sep"></span>
  <button data-cam="game" title="The client's gameplay camera: pitch 60, distance 63 m, FOV 47">Game camera</button>
  <button data-cam="free" title="Orbit (drag), pan (right drag), zoom (wheel)">Free</button>
  <span class="sep"></span>
  <button data-go="base1">Base 1</button><button data-go="base2">Base 2</button><button data-go="centre">Centre</button>
  <button data-go="sel" title="Centre on the 2-D selection">Selection</button>
  <label class="small"><input type="checkbox" data-k="follow" checked> follow the selection</label>
  <label class="small" title="A level's dressing markersets (trees, rocks, foliage, effects)"><input type="checkbox" data-k="dressing" checked> dressing</label>
  <label class="small" title="The chasms' water planes (the last check's), as flat teal quads"><input type="checkbox" data-k="water" checked> water</label>
  <label class="small" title="The bushes' grass blades (the last check's bushes, the game's blade texture)"><input type="checkbox" data-k="grass" checked> bushes</label>
  <label class="small" title="The void's mist (map.json's void.mist): what lies under its plane takes its colour by its depth below it, fully at its range. The game's fog shader looks different"><input type="checkbox" data-k="mist" checked> mist</label>
</div>
<canvas class="c3d"></canvas>
<div class="status3d"></div>`;
    V.canvas = el.querySelector('canvas');
    V.status = el.querySelector('.status3d');
    el.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.cam === 'game') gameCamera(); else { V.cam.mode = 'free'; syncButtons(); }
    }));
    el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.go)));
    el.querySelector('[data-k=scene]').addEventListener('change', e => setScene(e.target.value));
    el.querySelector('[data-k=follow]').addEventListener('change', e => { V.follow = e.target.checked; });
    el.querySelector('[data-k=dressing]').addEventListener('change', e => { V.dressing = e.target.checked; redraw(); });
    el.querySelector('[data-k=water]').addEventListener('change', e => { V.water = e.target.checked; redraw(); });
    el.querySelector('[data-k=grass]').addEventListener('change', e => { V.grass = e.target.checked; redraw(); });
    el.querySelector('[data-k=mist]').addEventListener('change', e => { V.mist = e.target.checked; redraw(); });
    V.canvas.addEventListener('pointerdown', onDown);
    V.canvas.addEventListener('pointermove', onMove);
    V.canvas.addEventListener('pointerup', onUp);
    V.canvas.addEventListener('wheel', onWheel, { passive: false });
    V.canvas.addEventListener('contextmenu', e => e.preventDefault());
    V.el = el;
    syncButtons();
    return el;
  }

  async function setScene(level) {
    V.source = level ? 'level' : 'map';
    V.level = level;
    const sel = V.el.querySelector('[data-k=scene]');
    if (sel.value !== level) {
      if (level && ![...sel.options].some(o => o.value === level)) sel.append(new Option(level, level));
      sel.value = level;
    }
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

  ED.addView({ id: '3d', title: '3-D', el: build() });
  ED.on('view', id => show(id === '3d'));
  ED.on('open', () => { V.scene = null; V.groundUrl = ''; V.groundKey = ''; if (V.visible && V.source === 'map') show(true); });
  ED.on('preview', () => redraw());
  ED.on('doc', () => { if (V.visible) redraw(); }); // the mist follows the document at once
  ED.on('checked', () => { if (V.visible) refreshGround(); });
  ED.on('select', () => { if (V.visible && V.follow) goTo('sel'); });

  function activate() {
    const b = [...document.querySelectorAll('#viewTabs button')].find(x => x.textContent === '3-D');
    if (b) b.click();
  }

  // URL: ?view=3d shows the view, &scene=<level> a level of the copy, &at=x,y the target, &yaw=, &pitch=, &dist=
  async function fromURL() {
    const q = URLQ; // read at load: opening a map rewrites the URL
    if (q.get('view') !== '3d') return;
    if (q.get('full')) document.body.classList.add('full3d'); // the view alone (pictures at the game's aspect)
    const level = q.get('scene') || '';
    if (level) {
      V.source = 'level';
      V.level = level;
      const sel = V.el.querySelector('[data-k=scene]');
      if (![...sel.options].some(o => o.value === level)) sel.append(new Option(level, level));
      sel.value = level;
    }
    activate();
    await until(() => V.scene, 600000);
    await new Promise(r => setTimeout(r, 0));
    for (const k of ['yaw', 'pitch', 'dist', 'fov']) if (q.get(k)) V.cam[k] = +q.get(k);
    if (q.get('free')) { V.cam.mode = 'free'; syncButtons(); }
    if (q.get('dressing') === '0') { V.dressing = false; V.el.querySelector('[data-k=dressing]').checked = false; }
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
  ED.on('started', fromURL);

  return {
    V, M, GAME, FROM_GLTF, setTarget, setScene, goTo, redraw, modelFor, heightAt,
    activate, settled, until, gameCamera, frame, readAt, mistNow, isFogFace, groundKey,
    addLayer(fn) { V.layers.push(fn); redraw(); },
  };
})();

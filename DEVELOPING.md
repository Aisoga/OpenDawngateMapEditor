# Working on the editor

This repository holds the editor's **page**: plain HTML, CSS and JavaScript in `web/`, with no libraries, no build
step and no third-party code (the 3-D view is plain WebGL 1). The **backend** that serves it, the HTTP API below, is
part of Dawngate Restoration's `Start-Client.exe` (its Go code is `server/internal/mapedit` in that project), and it
runs the map compiler `mapc` (built into the same program: `Start-Client.exe --mapc ...`) for every check, preview,
bake and export. So the page works only against a release's `Start-Client.exe`, and needs that release's game copy.

## Running the page from your checkout

1. Install the release and start `Start-Client.exe` once (it makes the game copy).
2. Point its editor at your checkout instead of the unpacked `editor\` folder:

   ```
   Start-Client.exe --editor --editor-pages <your checkout>\web
   ```

   The backend serves the page's files from that folder. It reads the templates from the folder's own `templates`
   (the zip's layout: `editor\templates`) or, when it has none, from the `templates` folder beside it (this
   repository's layout), and `editor.json` the same way. `--editor-addr 127.0.0.1:<port>` serves on another port.
3. Reload the browser after an edit: the files are read from disk on every request, nothing is embedded.

`editor.json` (`{"version": "<semver>", "api": <n>}`) is read at the start: the backend refuses a page whose `api`
it doesn't speak, with a console line and an error page that name both. Raise `api` only together with a backend
that speaks it; raise `version` for every release of the zip.

## The files

| File | What |
|---|---|
| `web/index.html`, `web/style.css` | the page's frame: the toolbar, the panes, the 2-D canvas |
| `web/app.js` | the core: the state, the 2-D view, the tools, the inspector, the check, undo, save, *Test*; the hub `ED` the other parts plug into |
| `web/props.js` | the props: the palette, the props layer in 2-D and 3-D, the tools *Prop*, *Paste* and *Scatter*, the paste dialog |
| `web/propsel.js` | several props at once: the selection with its turn and scale handles, Shift/Ctrl+click, the box, copy and paste, split |
| `web/ground.js`, `web/ground.css` | the Ground pane: layers, masks, the *Paint* and *Stamp* tools, the texture picker, the bake under the canvas, the ground picture's export and import |
| `web/void.js` | the Void panel |
| `web/view3d.js` | the 3-D view: a glTF loader for `mapc`'s subset, the renderer, the cameras |
| `templates/<name>/` | the templates *New from template* offers: map packages (`map.json`, `ground/*.png`) |
| `editor.json` | the page's version and the API it speaks |
| `Map Editor.cmd` | the players' shortcut (CRLF line ends: `.gitattributes`) |
| `docs/making-maps.md` | the map makers' guide: what a map needs, `map.json`, the rules |

## The hub `ED` (app.js)

A part of the page plugs in through `ED`; `props.js` is the example to copy.

- **Events:** `ED.on('open' | 'doc' | 'preview' | 'checked' | 'select' | 'saved' | 'view', fn)`; `ED.emit(name, ...)`.
- **Panes and views:** `ED.addView({id, title, el})` adds a tab beside *2-D*; `ED.addPane('left' | 'right', title)`
  a pane.
- **State:** `S` (`S.doc` the parsed `map.json`, `S.preview`, `S.report`, `S.sel`, `S.placed`). Every edit goes
  through `edit(fn)`, which records the undo step, runs the check and redraws.
- **Selections:** `ED.sel[type] = {value, inspector, move, del}`.
- **Tools:** `ED.tools[name] = {down, finish, hover, hint}`, plus `move` and `up` for a tool that drags;
  `ED.emit('tool', name)` on a change.
- **Drawing:** `ED.on('render-bg' | 'render', ctx)` under or over the layout; `ED.on('draw', phase)` with `'under'`
  the objects and `'over'` everything.
- **Hits and clicks:** `ED.hitFirst` (before the objects), `ED.hitItems` (after them); `ED.down`: `fn(hit, event, w)`
  returns true to take the *Select* tool's click; `S.grab = {move, up}` follows the mouse until it is let go.
- **Keys:** `ED.keys`.
- **3-D:** `V3D.addLayer(fn)` gets `{gl, list, modelFor, M}` each frame and may push instances onto `list`;
  `V3D.modelFor(url)` loads any glTF `mapc` exported.

**Read URL parameters when the script loads**, not in an `open` handler: opening a map replaces the query with
`?open=<map>` (`history.replaceState`), so a parameter read later is gone (`view3d.js`'s `URLQ` and `props.js`'s
`pasteQ` do it right).

## URL parameters

- `?open=<map>` opens a map; `&view=3d` straight into the 3-D view; `&at=x,y&ppm=<pixels a metre>` centres and
  zooms the 2-D view; `&tool=paint|stamp`, `&layer=<k>` start the ground tools; `?paste=x,y` opens the paste dialog
  at a spot.
- 3-D: `&scene=SM_Map_v5` shows a level of the game instead (no map needed), `&yaw=`, `&pitch=`, `&dist=`,
  `&free=1`, `&dressing=0`, and `&full=1` hides everything but the picture (for screenshots at 16:9).

## Self-tests

The page tests itself against a running backend: open `/?selftest=<name>`; the result is in the page's corner and its
title (`selftest passed`). They drive the same functions the mouse and keys use. A name ending in `-save` saves the
map too, so run those on a scratch maps folder.

| `selftest=` | Map | What |
|---|---|---|
| `1`, `save` | CM_Ring | a Binding moved, a bush and a wall added, the wall moved, a spawn broken and its finding clicked, undo |
| `edit6` | CM_Grove, CM_Marsh | the view's fit when the canvas changes size, drags with what they take, a cut-off pocket's finding, the bots' points (even and uneven), *On the water* |
| `props`, `props-save` | CM_Ring | the palette, props placed on both halves, the handles, *blocks*, *shadow*, a pasted group, a scatter, a refused creature, undo, the 3-D models |
| `propsel` | CM_Ring | several props through real mouse and key events: clicks, boxes, handles, copy and paste, split |
| `once` | a map with unmirrored groups (`?open=<map>&selftest=once`) | groups with mirror off: no mirrors drawn or hit, drags, a split, a paste under the mouse |
| `grass3d` | CM_Ring | the bushes' blades in 3-D: inside their bush, on the ground, 3-5 m tall, moving with the bush |
| `ground`, `ground-save` | CM_Ring | a layer, strokes and an eraser dab, the bake, undo and redo, a stroke into the picture, an own PNG, a stamp |
| `groundio`, `groundio-save` | CM_Ring | the ground picture: export, refused tiles, the import, the bake from the picture, a layer over it, removal |
| `void`, `void-save` | any (`?open=<map>&selftest=void`) | the void fields, the mist in 3-D, the findings at their fields, a plinth lifted off the floor |
| `3d` | CM_Ring | WebGL, the models of every kind, the ground, a frame without GL errors, a wall and a dragged Binding |
| `water3d` | a map with watered chasms | the water planes' places and z, the picture turning teal, an edit of the water's z |

**Headless:** Edge or Chrome runs them without a window:

```
msedge --headless=new --user-data-dir=<scratch> --virtual-time-budget=20000 --dump-dom "http://127.0.0.1:17890/?selftest=1"
```

- The 3-D tests need WebGL in software: add `--enable-unsafe-swiftshader --use-angle=swiftshader` and a budget of
  120000. The bake tests wait for several bakes: `ground` 240000, `void` 300000, `groundio` 900000.
- From PowerShell, start it with `Start-Process -PassThru -RedirectStandardOutput <file> -WindowStyle Hidden` and
  wait for it: called with `&` it returns at once and prints nothing while the page goes on running.
- The default headless window leaves the canvas about 190 px wide: a test's drag must move more than the 3-px drag
  threshold, and a click by coordinates zooms in first (the objects' 9-px hit circles overlap at the fit zoom).
- `--screenshot=<png> --window-size=1280,720` with `?open=<map>&view=3d&full=1` takes a picture.

## The HTTP API (loopback only)

Every request must name a loopback host (no DNS rebinding), and a request other than GET that carries an `Origin`
must come from the page itself.

| Request | Body | Reply |
|---|---|---|
| `GET /api/state` | | the maps (`pkg`, `name`, `display`, `tag`, ...), the templates, `api`, `release`, the *Test* state |
| `GET /api/map/{pkg}` | | `{pkg, text, sha256}` |
| `POST /api/check/{pkg}` | the document | `{rev, exit, report, preview, images, text, copyChecked, placed}`: the check of the draft; `preview` when the structural rules pass, `text` the merged draft, `placed` the props' markers (`mapc props`) |
| `POST /api/save/{pkg}?base=<sha256>[&force=1]` | the document | `{ok, written, sha256, text, pictures, removed}`; 409 when the file changed on disk since it was opened |
| `POST /api/new` | `{template, name, display, tag, prefix}` | `{ok, pkg}`; 409 when it exists |
| `POST /api/build/{pkg}` | | `{exit, result}` (`mapc build`'s JSON, into the editor's output folder) |
| `POST /api/test/{pkg}`, `GET /api/test`, `POST /api/test-stop` | | *Test*: start, its phases and lines, Stop |
| `GET /preview/{pkg}/{rev}/{file}.png` | | a layer picture of a check |
| `GET /api/scene/{pkg}` | | `mapc scene` of the latest draft into the cache: `{ok, base, scene, result}` |
| `GET /api/level-scene/{level}[?models=0]` | | `mapc scene` of a level of the game (`models=0`: the marker list only) |
| `GET /api/nouns` | | the palette: `{ok, nouns: [{name, type, model, graphicsScale, box, icon}], icons, noModel}` |
| `POST /api/models` | `{nouns: [...]}` | `{ok, models: {<noun>: "/3d/<file>.gltf" or ""}}` |
| `POST /api/ground/{pkg}` | | the 3-D ground of the latest draft: `{ok, n, url, triangles}` |
| `GET /3d/...` | | the cache's files (glTF, .bin, PNG), read only |
| `GET /api/textures` | | the game's textures a ground can use (`mapc textures --json`) |
| `POST /api/texture-pictures` | `{paths: [1-200 .dds], max: 128\|512\|1024\|2048}` | `{ok, textures: [{path, url or error}]}` |
| `GET /api/assets/{pkg}` | | the package's PNGs and the added ones: `{ok, assets: [{file, saved, url, w, h}]}` |
| `POST /api/asset/{pkg}?name=ground/<name>.png` | the PNG | `{ok, file, w, h, url}`, kept until Save; 400 for no PNG, over 4096 px or 64 MB |
| `GET /api/asset/{pkg}/{file}` | | an added or package PNG |
| `POST /api/bake/{pkg}` | | `mapc bake` of the latest draft: `{ok, n, url, texels, tiles, texel_m, half_m, files, ms}` |
| `GET /bake/{pkg}/{n}/{ground\|minimap\|mask_<k>}.png` | | a bake's picture (over ±`half_m`, north up) |
| `POST /api/ground-export/{pkg}` | | `mapc bake --full` of the latest draft: `{ok, dir, url, tiles_png, texels, tiles, margin, ...}` |
| `GET /ground-export/{pkg}/{tile_<i>_<j>\|ground\|minimap}.png` | | a file of the export |
| `POST /api/ground-tile/{pkg}?i=&j=` | PNG | a painted tile into the store: `{ok, file, w, h, url}` |

**Saving keeps the file's layout.** The page holds the parsed `map.json` as a plain object, so members it doesn't
know stay in it. The backend writes it back with a merge that keeps the bytes of every unchanged value (member order,
line breaks, number spellings such as `440.0`) and writes changed values in the file's style, so an unchanged
open-and-save gives the same bytes and a moved point changes its two numbers. `mapc` reads `map.json` strictly: a
member it doesn't know shows as `format.json` in the check until `mapc` knows it, and the editor keeps it anyway.

## Continuous integration and releases

`.github/workflows/ci.yml` checks every push: `node --check` on every `web/*.js`, and that `editor.json` and every
template's `map.json` are valid JSON (`editor.json` with a semver `version` and an integer `api`). A pushed tag
`v<version>` (equal to `editor.json`'s version) builds `Dawngate-Map-Editor-<version>.zip` and attaches it to the
tag's GitHub release. The zip's layout:

```
Map Editor.cmd
editor/
  editor.json
  index.html, app.js, ... (every file of web/)
  templates/<name>/map.json, templates/<name>/ground/*.png
  README.md, DEVELOPING.md, LICENSE, docs/making-maps.md
```

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

`editor.json` (`{"version": "<semver>", "api": <n>}`) is read at the start: for a page whose `api` the backend
doesn't speak it prints a console line and serves an error page instead of the page; both name the two versions. Raise `api` only together with a backend
that speaks it; raise `version` for every release of the zip.

## The files

| File | What |
|---|---|
| `web/index.html`, `web/style.css` | the page's frame: the menu bar, the toolbar, the left column (minimap, the selection's preview and info), the main view, the dock with the palette tabs, the status bar, the Messages window |
| `web/app.js` | the core: the state, the 2-D view, the tools, the selection's info (the inspector), the check, undo, save, *Test*; the hub `ED` the other parts plug into |
| `web/frame.js` | the frame's behaviour: the menus (every item and its key), the toolbar, the palette tabs (T, D, U, L), the Terrain tab's Draw with, the Texture | Cliff switch (Apply) and Apply Cliff, the Units and Lanes tabs, the minimap, the selection's preview, the status bar, the frame's keys (Tab, Space, G, P, `F1`, Ctrl+N, Ctrl+O, `Ctrl+F9`, the arrows), Help |
| `web/props.js` | the props: the Doodads tab (the Brush: Place, Scatter or Paste group and that mode's settings; the palette with its picks), the props layer in 2-D and 3-D, the tools *Prop*, *Paste* and *Scatter*, the paste dialog |
| `web/propsel.js` | several props at once: the selection with its turn and scale handles, Shift/Ctrl+click, the box, copy and paste, split |
| `web/ground.js`, `web/ground.css` | the ground: Terrain > Apply Texture (with the layers that follow the map: their marks and presets) and the draw mode's settings under Draw with (`ED.drawSettings`), View > Hide Derived Art, the windows Ground Layers in Detail, Stamps in Detail and Ground Bake and Cliff, the *Paint* and *Stamp* tools, the texture picker, the bake under the canvas, the ground picture's export and import |
| `web/void.js` | the Void window (Map > The Void) |
| `web/overlays.js` | View > Gameplay Overlays: the Binding ranges, the lanes' lengths and walking times, the walks from the base along the Player graph (`graph_player.png`), the Gameplay Numbers window with SM_Map_v5's numbers |
| `web/view3d.js` | the 3-D view (the main view's other mode): a glTF loader for `mapc`'s subset, the renderer, the cameras |
| `web/heights.js` | heights (EDUX9): Terrain > Apply Height (shown only while a wall or chasm is selected), the selected wall's or chasm's height field (`HT.field`, also in the selection's info), the 3-D height handle, the self-test `height3d` |
| `web/feedback.js` | feedback while editing: the measurements at the cursor and in the status bar, the labelled snaps (Tools > Smart Snaps, the status bar's Snap part), typed values, the hard rule breaks refused while dragging and drawing (a red ghost), the check's other findings marked on the object and its mirror twin, the Map Check window's jump; the NPC graph read from the check's `graph_npc.png` (`ED.graphNear`, `ED.graphWarn`, `ED.pathWidths`: the warnings for a camp or well off the graph and for a path too thin, EDNARROW); the self-test `feedback` |
| `web/camps.js` | the camps by name: Units > Add a Camp (the type table, the tool, its ghost), the selected camp's info and *Type*, its Duplicate, copy and paste, the warning where the NPC graph doesn't reach (EDNARROW); the self-tests `camps`, `camps-save`, `narrow`. `ED.camps` is what app.js, frame.js and feedback.js ask |
| `web/relief.js` | the live ground preview: the compiler's raster, field and relief rule in JavaScript, the 3-D ground mesh and 2-D cells patched while a terrain edit is under way, texture strokes and stamps painted onto the ground before the bake; the self-tests `live3d` and `draw3d` |
| `templates/<name>/` | the templates *New from template* offers: map packages (`map.json`, `ground/*.png`) |
| `editor.json` | the page's version and the API it speaks |
| `Map Editor.cmd` | the players' shortcut (CRLF line ends: `.gitattributes`) |
| `docs/making-maps.md` | the map makers' guide: what a map needs, `map.json`, the rules |

## The hub `ED` (app.js)

A part of the page plugs in through `ED`; `props.js` is the example to copy. The scripts load in the order app.js,
frame.js, view3d.js, props.js, propsel.js, ground.js, void.js, overlays.js, relief.js, heights.js, feedback.js, camps.js; app.js starts (loads the state, opens a map, runs a
self-test) once all of them have loaded.

- **Events:** `ED.on('open' | 'doc' | 'preview' | 'checked' | 'select' | 'saved' | 'view' | 'tool' | 'tab' |
  'window' | 'cursor' | 'camera' | 'started' | 'derived', fn)`; `ED.emit(name, ...)`. `derived` comes with View > Hide
  Derived Art's toggle (`S.hideDerived`).
- **The frame's homes:** `ED.addPane(home, title, order)` returns the body of a new group: `home` is a palette tab
  (`'terrain'`, `'doodads'`, `'units'`, `'lanes'`; the groups sorted by `order`, then as added) or
  `'window:<id>'`, a floating window (made hidden). `ED.window(id, title)` makes a window and returns its body,
  `ED.openWindow(id)`, `ED.closeWindow(id)` and `ED.isOpen(id)` show and hide it. The Map Check window is `check`.
  A group hides itself with its section's `hidden` (Apply Texture or Apply Cliff by `S.lastMaterial`, Apply Height
  without a wall or chasm selected). The Terrain tab's order: Draw with (5) with `ED.drawSettings` under its modes,
  Apply (8, `setMaterial('paint'|'shape')`), Apply Texture and Apply Cliff (12), Apply Height (20); the Doodads tab's:
  Brush (5: the mode and its settings), Doodads (10: the palette).
- **Menus:** the menus are frame.js's `MENUS`; an item runs `ED.actions[name]` (a part registers its own:
  `ground.layers`, `props.paste`, `map.void`, ...) and shows a check mark from `ED.flags[name]()`. An item whose
  action no part registered is greyed. An Edit item sends the same key a player would press.
- **The main view:** 2-D or 3-D. `ED.addView({id, title, el, ...})` adds a mode (view3d.js's `3d`); `ED.setView(id)`
  switches (Tab), `ED.view` is the current one and `ED.active()` its entry in `ED.views`.
- **The views' contract** (`ED.views[id]`, app.js's `VIEW2D` is the 2-D one):
  - `pick(e)`: the world under a mouse event, `{w: [x, y], z, near, sx, sy, view}`, or `null` where the view can't
    tell. `sx`, `sy` are the view's canvas pixels (CSS pixels × `dpr`); `near` is the metres one CSS pixel covers
    there, so a hit within k pixels is one within `k * near` metres. `pickAt(sx, sy)` does the same from canvas pixels.
  - `project([x, y(, z)])` gives `[sx, sy]` in the same pixels, or `null` behind the camera. Without z the point lies
    on the ground; `project(pickAt(sx, sy).w)` gives `sx, sy` back.
  - `ppm(p)`: the canvas pixels a metre at `p` (the radius of a circle drawn there).
  - `overlay`: the 2-D context the view's handles and previews draw on, or `null`.
  - Optional: `drape` (true in 3-D: lines drawn through the view are cut into metre steps on the ground), `xy(e)` (a
    mouse event's canvas pixels), `redraw()` (app.js's `render()` calls it while that view is shown and leaves the
    hidden 2-D canvas alone).

- **The 3-D view's input and overlay** (`view3d.js`): `pickAt(sx, sy)` casts the ray from the last frame's eye through
  the pixel (`camBasis`, kept per frame as `V.snap`, so it always matches `project`) and marches it over `heightAt` in
  half-metre steps between the heights' top and bottom, then bisects; `null` on the sky, while a level of the copy is
  shown, or before the first frame. `near = dpr / ppm(w)`. A left press goes to the pipeline (the tools); right or
  middle drag pans, Shift + right drag zooms, Ctrl + right drag turns (free camera: and tilts), the wheel zooms after
  the tool's wheel, Alt + left drag pans; a left press the pipeline doesn't take (the sky) still pans (free: orbits).
  The arrow keys and F act only while the focus is in the view or on nothing (`viewFocused()`); a click in the view
  focuses it. A selection made by a click in the view doesn't move the camera (*Follow the Selection* is for lists and
  the 2-D view: `V.pressing`). Objects and props are hit first by their models' bounding spheres as projected
  (`hitModels`, pushed onto `ED.hitFirst` at `started`, after every part's handles), the best the one whose centre is
  nearest the mouse for its size. **The overlay** is a 2-D canvas over the GL canvas (`.ov3d`, no pointer events),
  cleared and drawn after every frame by `ED.drawOverlay(view)`: `ED.marks` (the selection's rings and handles:
  app.js's objects, shapes and knots, props.js's and propsel.js's), then `ED.previews`, then the check's markers. Draw
  through the view with app.js's `vpoly(v, pts, close)`, `vring(v, c, r)` (a circle of r metres) and `vmark(v, p,
  'round' | 'square', size, fill)` (a handle; `p` with a z stands above the ground), and size things on the ground
  with `vmpp(v, p)` (metres a CSS pixel there). A layer's instance with `ghost: alpha` is drawn see-through after
  the rest (the Prop tool's next doodad and its mirror); `V.lastList` is the last frame's list.
- **Caches** (EDUX3): `PR.live()` returns the same array while the props' and scatters' JSON, the check's markers and
  the pasted groups stay the same (treat it as read-only); `layer3d` keeps the props' instances while `shown()` stays
  and reuses the matrices of unmoved markers; `instances()` keeps each scene object's instances while its place stays
  (`V.sceneCache`). A replaced ground model is freed (`freeModel`: its buffers and its own textures).
- **The live ground preview** (`relief.js`): the page keeps a 512 x 512 raster of the terrain as the compiler paints
  it (`RL.terrainOf`, `RL.rasterise`; a change paints again only the cells round the changed shapes and their
  mirrors) and compares it with the raster of the document each compiled thing was made from: `S.checkedJSON` (the
  draft the next 3-D ground and bake come from), `S.previewJSON` (what `layout.png` shows), the bake's `from`
  (`ED.bakeShown()`) and the drawn 3-D ground's (`V3D.groundModel()`: `{model, doc}`). Where they differ it solves the
  compiler's distance field round the changed cells and gives the mesh's vertices `RL.height()` (the compiler's
  `height()` in one function with its constants: change both together) and `RL.colour()`; every other vertex keeps
  the compiler's. A newer 3-D ground is drawn only once it has loaded (`swapGround`), so the view never falls back.
  The authored heights (a wall's or chasm's `height`, EDUX9) are in the raster too: each cell's top from its last
  shape (`R.tops`), blended per kind over 4 m in the windows it solves (`blendWin`, `topAt`: mapc `relief.go`), and a
  height change alone (no kind changed) patches the shape's area; `height(d, x, y, down, h)` widens the cliff band
  with h (`cliffEnd`).
  Texture strokes and stamps the bake doesn't have yet (`ED.groundLive`: the stroke being drawn, the textures'
  pictures) are painted onto the 2-D bake and onto canvas copies of the 3-D ground's bake tiles. A height rule of
  the compiler that changes must change `RL.height()` too: `live3d` compares the two at every vertex it touches.
- **Drawing through a view** (EDUX4): `vband(v, pts, width)` strokes a band of metres (3-D: its outline on the ground),
  `vsquare(v, c, h)` a square's outline; with them the brushes, the drawings in progress, the
  lanes (`laneMarks`), the stamps and the props' regions and footprints (`drawUnder3d`) draw in 3-D. The lanes' width
  handle is the selection `{t: 'lwidth', l, k}` (`laneWidthHandle()`, both views).
- **Feedback while editing** (`feedback.js`, `FB`; app.js calls its hooks on `ED` where they exist):
  - Snaps: `snapW(w, e)` is the grid's rounding (0.1 m; Shift or Tools > Snap to 1 m: 1 m), which the doodads' tools
    and the brush strokes keep; `smartW(w, e)` adds the labelled snaps (`ED.snapAt(p, e, ex)` -> `{p, label, lines}`
    or null) for the points the mouse places: a drawing's corners, + Well, + Camp, + Ward spot (`e.exact`: none).
    `moveSel` snaps a drag's delta once through `ED.snapDrag(drag, d0, e)` (the moved point: an object's, a knot's,
    a corner's, a doodad's; a whole shape the point grabbed) and sets `drag.snap`, so a snapped point isn't rounded
    off; `e.fixedD` gives the delta itself (a typed value, a refused step's last good one). The targets: Centre and
    Midpoint (lane legs, shape edges at least 40 px long, and their mirrors) before the lines (Mirror line, Lane edge,
    with the grid shown the grid's 20-m lines; two lines that meet near the point give their crossing), within 8 CSS
    pixels (`S.near`, the metres a pixel covers at the last pick); Ctrl leaves them out; `FB.F.on` is Tools > Smart
    Snaps.
  - Refusals: `ED.dragStart(drag)` (from `startMove`) keeps the rules broken before; `ED.dragCheck(drag, w, e)` after
    every `moveSel` step undoes a step that breaks a new hard rule (`moveSel` again with the last good step) and keeps
    it in `drag.refused` (`{rule, why, ghost}`), drawn red; `ED.dragEnd(drag)` logs it. Placing and drawing ask
    `ED.refusePlace(tool, p)`, `ED.refuseShapes(list)` (`commitDrawn`, `cliffStrokeEnd`: an object walled in; then
    `commitDrawn` returns false and `drawFinish` keeps the drawing), `ED.refuseCorner(p, geom)` (`drawDown`) and
    `ED.refuseClose(pts)` (`drawFinish`). The objects' ground is the compiler's raster for one cell (`RL.terrainOf`,
    `RL.paint` on a single cell, `RL.cellOf`), for the authored objects only (an "auto" Core's or Binding's place is
    the last passing check's). The lanes' width handle keeps 6 to 80 m (`LANE_MIN`, `LANE_MAX`; what the mouse asks
    for is `drag.want`); the width fields go through `setLaneWidth`.
  - Typed values: a capture-phase `keydown` on the window takes digits, `.`, `-`, `,`, Backspace, Esc and Enter while
    a drag, a drawing or a brush is under way, or right after a drag (`F.last`, until the next press or edit).
  - The check's findings: `drawFindings` asks `ED.markFinding(v, f)` first (the finding's object where it is now and
    its mirror twin, the rule and its message), the Map Check window's rows `ED.jumpFinding(f)`; `ED.measureText()` is
    the status bar's selection part while something is edited.
- **The input pipeline:** one set of mouse handlers for every view (app.js `inputDown`, `inputMove`, `inputUp`,
  `inputDbl`, `inputWheel`; `ED.input`). A view's own handlers keep its camera and send the left button, the
  double-click and the wheel there; the window's mousemove and mouseup follow the view that took the press
  (`S.press`), else the shown one. `S.mouseW` is the shown view's pick (`null` where it can't pick), and `hit(pk)`
  takes a pick (`hit(sx, sy)` the shown view's canvas point). Handles, objects and knots are hit on the screen
  through the view's `project`, shapes and lanes at the world point. The tools never see a view: they keep `(w, e)`.
- **State:** `S` (`S.doc` the parsed `map.json`, `S.preview`, `S.report`, `S.sel`, `S.placed`; the Apply Cliff kind
  `S.cliff`, the Terrain tab's shared draw mode `S.draw` (`brush`, `polygon`, `circle`, `path`; `setDraw`) and brush
  `S.brush` (ground.js's `G.brush` is the same object), the Tools options `S.snap` and `S.joined`; `S.hideDerived`: View >
  Hide Derived Art, which the bake and the 3-D ground ask with `?derived=0` and the props layer reads through `PR.shown()`). Every edit goes through `edit(fn)`,
  which records the undo step, runs the check and redraws.
- **Selections:** `ED.sel[type] = {value, inspector, move, del}`. An inspector appends to the selection's info;
  what it wraps in `adv(...)` (and every `jsonEditor`) goes into the info's closed *Advanced* section, which
  Advanced > Edit the Selection as JSON opens.
- **Tools:** `ED.tools[name] = {down, finish, drawn, hover, hint, status, tab, ghost, wheel, key}`, plus `move` and
  `up` for a tool that drags; `drawn(sh)` takes a polygon, circle or path drawn with the draw mode (`commitDrawn`; the
  texture tool's mask shapes; without it the shape tool writes `terrain.shapes`); `ghost()` says what the next click
  places (the Prop tool: `{noun, rot, scale}`), `wheel(e)` and `key(e)` return true when the tool took the wheel or key
  (the Prop tool's Ctrl/Shift/Alt+wheel, R and `[` `]`); `ED.wheels`: fn(e) -> true takes a wheel the armed tool left
  (props.js: Alt+wheel raises the selected doodads); an Alt+wheel nobody takes still doesn't zoom; a drawing in progress takes the mouse before a tool's `move`/`up`;
  `hint` shows over the view while the tool is armed, `status()` is the status bar's tool part, `tab` the palette tab
  it belongs to (switching to another tab drops the tool; Space switches between Select and the tab's last tool).
  `ED.emit('tool', name)` on a change.
- **Drawing:** `ED.on('render-bg' | 'render', ctx)` under or over the layout; `ED.on('draw', phase)` with `'under'`
  the objects and `'over'` everything.
- **A tool's preview** (what the next click or the drag in progress will do: the doodad's ghost, a brush's outline,
  the polygon being drawn, the scatter's estimate) is a function `fn(v)` in `ED.previews`. It draws on `v.overlay`
  through `v.project(p)` and `v.ppm(p)`, never through `w2s` or `S.view.scale`, so the same code draws it in every
  view. `ED.drawPreviews(v)` runs them all; the 2-D view does so at the end of `render()`, after the handles and
  before the check's markers. A view without an overlay draws none.
- **Hits and clicks:** `ED.hitFirst` (before the objects), `ED.hitItems` (after them): `fn(sx, sy, w, near, pk)`,
  where `near(p, px)` says whether the world point `p` shows within `px` pixels of the mouse and `pk` is the pick (use
  `pk.near` for a distance in metres, not `S.view.scale`); `ED.down`: `fn(hit, event, w, pk)` returns true to take
  the *Select* tool's click; `S.grab = {move, up}` follows the mouse until it is let go.
- **Keys:** `ED.keys`. The frame's own keys (T, D, U, L, Tab, Space, G, P, `F1`, the arrows) are taken before the
  parts' handlers.
- **Messages:** `log(text, 'ok' | 'err')` writes a line into View > Messages; an error also shows in the status bar.
- **3-D:** `V3D.addLayer(fn)` gets `{gl, list, modelFor, M}` each frame and may push instances onto `list`;
  `V3D.modelFor(url)` loads any glTF `mapc` exported.

**Read URL parameters when the script loads**, not in an `open` handler: opening a map replaces the query with
`?open=<map>` (`history.replaceState`), so a parameter read later is gone (`view3d.js`'s `URLQ` and `props.js`'s
`pasteQ` do it right).

## URL parameters

- `?open=<map>` opens a map; `&view=3d` straight into the 3-D view; `&at=x,y&ppm=<pixels a metre>` centres and
  zooms the 2-D view; `&tool=paint|stamp`, `&layer=<k>` start the ground tools; `?paste=x,y` opens the paste dialog
  at a spot.
- The frame: `&tab=terrain|doodads|units|lanes` shows a palette tab, `&menu=file|edit|view|layer|map|tools|advanced|help`
  opens a menu (`&sub=open|camera|bg|show3d|scene|shapes` its submenu), `&win=<id>[,<id>]` opens windows or runs
  actions (`check`, `map.void`, `ground.layers`, ...), `&messages=1` opens Messages, `&help=keys` the keys.
- The palettes: `&material=paint|shape` (Texture or Cliff), `&draw=brush|polygon|circle|path`, `&cliff=<kind>`,
  `&shape=<k>` (selects `terrain.shapes[k]`); `&dmode=place|scatter|paste` (the Doodads tab's mode),
  `&picks=<noun>,<noun>` (the palette's picks), `&smode=fill` (Scatter's Fill area).
- 3-D: `&scene=SM_Map_v5` shows a level of the game instead (no map needed), `&yaw=`, `&pitch=`, `&dist=`,
  `&free=1`, `&dressing=0`, and `&full=1` hides everything but the picture (for screenshots at 16:9).

## Self-tests

The page tests itself against a running backend: open `/?selftest=<name>`; the result is in the page's corner and its
title (`selftest passed`). They drive the same functions the mouse and keys use. A name ending in `-save` saves the
map too, so run those on a scratch maps folder. Every mode also fails on a stray text: under `?selftest` the DOM's
`append`, `prepend`, `replaceChildren`, `before`, `after` and `replaceWith` record a `null`, `undefined` or boolean they
are given (the browser writes it as the text "null" or "false"), and a test that passed turns failed with the call
sites. A list with optional members goes through `h` or `appendAll(el, ...)` (app.js), which skip those.

| `selftest=` | Map | What |
|---|---|---|
| `1`, `save` | CM_Ring | a Binding moved, a bush and a wall added, the wall moved, a spawn broken and its finding clicked, undo |
| `frame` | CM_Ring | the frame: every menu and submenu with its actions, the tab keys, the palettes' order (the Terrain tab's groups and the draw mode's settings under Draw with, the cliff kinds hidden under Texture and the texture layers under Cliff, the material remembered, Apply Height only with a wall or chasm selected; the Doodads tab's mode first and only its settings, then the palette; a click picks one and keeps the mode and its tool, Shift+click and Ctrl+click add or remove, a chip's x; Place with two picks lays both kinds over 20 clicks, each as its ghost showed), Apply Cliff (a water circle, an island polygon), Space, the next doodad's size and turn (keys, Ctrl/Shift+wheel, the fields, Random turn), the scatter's refusals and estimate (with and without a wall edge), the draw modes (a wall dab and a chasm stroke with the brush, a stroke split at the mirror line, a wall polygon, a texture polygon and circle, the mode kept across materials), the lane switch (one and two lanes, the check passing, hand-placed Bindings back to "auto"), + Ward spot and + Mine by a click, the Units and Lanes lists, the selection's Advanced, undo, G, P, the minimap, an arrow key, the status bar, the windows, Messages, `F1`, Tab |
| `views` | CM_Ring | the views' contract and the input pipeline: `project` and `pick` round trips in 2-D at three zooms, `near` and `ppm`, `hit` through a pick, a mousemove and a click by real events, the 3-D view's `project` and `pick` (round trips, a mousemove, a press taken by the tools, `hit`), the previews drawn through the view they are given |
| `3d-edit` | CM_Marsh (`?open=CM_Marsh&selftest=3d-edit`) | editing in 3-D by real events: the pick (round trips, a turned and tilted camera), the Prop tool's ghost and its mirror, a doodad placed, its model hit, dragged (timed: input and frame milliseconds a step), turned by its handle, a Binding hit on its model and dragged (its models follow at once, the camera stays, the replaced ground freed); the same edits in 2-D give the same `map.json`; a box on the screen, a palette tile dropped, a polygon ended by a double-click, the camera's buttons and keys (the arrows and F only with the view focused), a check marker, `PR.live()`'s cache. Run it in a window of 1280 x 800 or so |
| `live3d` | CM_Marsh (`?open=CM_Marsh&selftest=live3d`; real time) | the live ground preview by real events in 3-D: a wall brush stroke rising while it is drawn (each drag step timed: the input, the frame, the live ground's part), staying up until the compiler's ground for that document is drawn and then equal to it at every vertex the preview touched, a chasm polygon dropping at once and matching too, a lane knot dragged (the corridor's relief follows; timed), undo back to the compiler's ground. Run it in real time (`--realtime`) in a window of 1280 x 800 |
| `height3d` | CM_Marsh (`?open=CM_Marsh&selftest=height3d`; real time) | heights (EDUX9): a wall and a chasm polygon drawn in 3-D, the wall's height handle dragged to 12 m and the chasm's to -15 m (one undo step each; the live ground follows mid-drag), after each check the live heights equal to the compiler's mesh at every vertex the preview touched, the check's `terrain.height-hide` under the wall's height field, then undone and the same heights typed into the selection's info in 2-D: the same `map.json`; an emptied field gives the default back. Run it in real time in a window of 1280 x 800 |
| `draw3d`, `draw3d-save` | CM_Marsh | drawing in 3-D by real events: a wall and a chasm with the brush and as polygons, an island circle, an open path, the previews on the ground; the check passing and `layout.png` showing each kind; a texture layer armed from its tile and painted with the brush (painted onto the 3-D ground while drawn), a stamp placed; the layer's mask and the bake showing them; the lanes' lines, a knot, the width handle dragged; the scatter regions, the footprints, the Paste tool's see-through group; undone. `-save` keeps the drawing (not the width) and saves the map |
| `edit6` | CM_Grove, CM_Marsh | the view's fit when the canvas changes size, drags with what they take, a cut-off pocket's finding, the bots' points (even and uneven), *On the water* |
| `props`, `props-save` | CM_Ring | the palette, props placed on both halves, the handles, *blocks*, *shadow*, a pasted group, a scatter, a refused creature, undo, the 3-D models |
| `propsel` | CM_Ring | several props through real mouse and key events: clicks, boxes, handles, copy and paste, split |
| `once` | a map with unmirrored groups (`?open=<map>&selftest=once`) | groups with mirror off: no mirrors drawn or hit, drags, a split, a paste under the mouse |
| `grass3d` | CM_Ring | the bushes' blades in 3-D: inside their bush, on the ground, 3-5 m tall, moving with the bush |
| `ground`, `ground-save` | CM_Ring | a layer, strokes and an eraser dab, the bake, undo and redo, a stroke into the picture, an own PNG, a stamp |
| `groundio`, `groundio-save` | CM_Ring | the ground picture: export, refused tiles, the import, the bake from the picture, a layer over it, removal |
| `void`, `void-save` | any (`?open=<map>&selftest=void`) | the void fields, the mist in 3-D, the findings at their fields, a plinth lifted off the floor |
| `3d` | CM_Ring | WebGL, the models of every kind, the ground, a frame without GL errors, a wall and a dragged Binding |
| `fill` | CM_Ring | Fill area: the Brush's mode switch, *Where* and *Block*; the estimate while drawing equal to the check's placements (count and places: the page runs mapc's fill on `layout.png` and `fill.png` with its own SplitMix64, checked against mapc's vector); the blocking rocks and the plants; re-estimated after the check; on walls with heights; density; rocks on walkable ground without Block (none, and why); a region in a lane; back to along the walls; undone |
| `derived` | CM_Marsh (`?open=CM_Marsh&selftest=derived`) | the layers that follow the map: the rules `lanes` and `edge` in the list, the tiles' marks, the fields (width; from, to, along), + Lane path and + Cliff foot, View > Hide Derived Art on and off (the bake and the 3-D ground asked with `?derived=0`, the scatters' props hidden in 2-D and 3-D and not hit, the bake back as before) |
| `overlays` | CM_Ring, CM_Marsh | View > Gameplay Overlays: the menu's items, the lanes' lengths and the walks against values computed apart from the page from the same check, the seconds, the rings, lanes and paths drawn in 2-D and 3-D and following a moved Binding, knot and spawn, the comparison with SM_Map_v5, the Gameplay Numbers window, everything off |
| `feedback` | CM_Ring | feedback while editing, by real events: the measurements of a knot's, a Binding's and the width handle's drag, the brush, a circle being drawn; each snap with its label (Mirror line, Lane edge, Midpoint, Grid, Shift's Grid 1 m; Ctrl and the status bar's switch leave them out; a dragged corner); typed values (a knot's distance during and after a drag, x,y, a radius, the lanes' width and its refusal, a circle, a polygon's legs, the brush); each refusal (a corner across its polygon while dragging and drawing, a closing edge, the Guardian into a wall with its red ghost, + Well and a drag on team 2's half, a knot on its neighbour, the lanes below 6 m, a wall polygon, a wall stroke and the base's circle moved off the Guardian); a bush brushed and one drawn as a Path written as polygons, no `terrain.shape` error; the soft marks on the object and its twin, following a drag; the Map Check window's jumps; in 3-D the jump, the marks, a knot's measurement and typed value, the Guardian refused, a snap's label. Run it at 1280 x 800 |
| `water3d` | a map with watered chasms | the water planes' places and z, the picture turning teal, an edit of the water's z |
| `camps`, `camps-save` | CM_Grove (`?open=CM_Grove&selftest=camps`) | finding Add a Camp from the Terrain tab (the tooltips, the left panel's link, Map > Add a Camp, a deleted camp's pulse and status line, Ctrl+X not taking you away), then Units > Add a Camp: every type by its button (the hint, what is written, back to Select, the list, the status bar, the preview, its *Type*), the check taking them all, a click on team 2's half, the parasite (one, its button going to it, no twin, past the mirror line), the refusals, a real click, *Type*, a camp with no noun or an unnamed one, Duplicate, Ctrl+C, Ctrl+X, Ctrl+V, Apply JSON, every edit undone; any uncaught error fails it. `camps-save` saves the map with one new camp of each type, for `mapc build`. Run them at 1280 x 800 |
| `narrow` | CM_Marsh (`?open=CM_Marsh&selftest=narrow`) | thin ground (EDNARROW): the check's `pathWidth` and the map's facts; a 6-m path into the wall gives `reach.narrow` with one part, reads as too narrow in `graph_npc.png` and shows red in the 2-D view (not with Check Findings hidden); the camp tool over it warns (the line beside the mouse) but places the camp and logs it, and the check's `reach.npc` names the path and the width it needs, its row selecting that path; no warning on wide ground or while a terrain edit isn't checked yet; the drawing measurement at 6, 9 and 12 m; the part's row and inspector; View > Pathing (the NPC graph); every edit undone |

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
- Under `--virtual-time-budget` the page's clock stands still while its code runs, and the browser draws no frame
  while the timers run: no animation frame comes, so no `ResizeObserver` callback either. `edit6` (the fit following
  the canvas's size) and anything that times a drag need real time: start Edge with `--remote-debugging-port=0` and
  no budget, and read `body[data-selftest]` over the DevTools protocol until it says `passed` or `failed`.
- `--screenshot=<png> --window-size=1280,720` with `?open=<map>&view=3d&full=1` takes a picture; with the frame's
  parameters above (`&tab=`, `&menu=`) a picture of the whole page. `&pose=ghost|mirror|selected|binding|marker`
  (with `&view=3d`) leaves the 3-D view in an editing state for the picture: the next doodad's ghost, the ghost and its
  mirror, a selected doodad with its handles, a Binding in the middle of a drag, a check's marker; `&pose4=wall|texture|lanes|props`
  (relief.js) a wall stroke being drawn with the ground rising, a texture stroke painted onto the ground, a lane's knot
  with the corridor and the width handle, the scatter regions and footprints; `&pose6=measure|snap|refused|typed|marks`
  (feedback.js, CM_Ring; `measure_3d`, `refused_3d`, `marks_3d` with `&view=3d`) a Binding's drag with its
  measurements, a corner snapped to a lane's edge, the Guardian refused in a wall, a number typed during a drag, the
  soft marks after the Map Check window's jump; `&pose7=armed|team2|refused|selected` (camps.js, CM_Grove, with
  `&tab=units`) the camp's ghost and its twin, the same with the mouse on team 2's half, the ghost on a wall, a camp's
  info; `&pose7=deleted` (with `&tab=terrain`) a camp just deleted, the Units tab opened and Add a Camp pulsing.

## The HTTP API (loopback only)

Every request must name a loopback host (no DNS rebinding), and a request other than GET that carries an `Origin`
must come from the page itself.

| Request | Body | Reply |
|---|---|---|
| `GET /api/state` | | the maps (`pkg`, `name`, `display`, `tag`, `delivered`, ...), the `templates` (the same), `api`, `release`, `page` (the manifest), `pageError`, `test: {enabled, reason}`, `view3d` |
| `GET /api/map/{pkg}` | | `{pkg, text, sha256}`, and `delivered: {server, why}` for a package map delivery put there (read-only) |
| `POST /api/check/{pkg}` | the document | `{rev, exit, report, preview, images, text, copyChecked, placed}`: the check of the draft; `preview` when the structural rules pass, `text` the merged draft, `placed` the props' markers (`mapc props`) |
| `POST /api/save/{pkg}?base=<sha256>[&force=1]` | the document | `{ok, written, sha256, text, pictures, removed}`; 409 when the file changed on disk since it was opened, 403 for a delivered package |
| `POST /api/new` | `{template, source, name, display, tag, prefix, keepAdded}` | `{ok, pkg}`; 409 when it exists. `source`: `maps` (default) or `templates`; `keepAdded` (*Save as my own copy*) also takes the pictures added to the template and not saved yet |
| `POST /api/build/{pkg}` | | `{exit, result}` (`mapc build`'s JSON, into the editor's output folder) |
| `POST /api/test/{pkg}` | options (a JSON object, optional; none are read today) | `{ok, test}`: *Test* of the saved package started (while its game runs, the game is closed and started again); 409 with `error` when it can't start: Test off (`/api/state`'s `test.reason`), a map without a name, a *Test* still starting, `Start-Server.exe` running in the folder, another game running |
| `GET /api/test` | | `{test, tail}`: the last *Test* (`null` before the first): `name`, `pkg`, `map`, `phase` (`check`, `closing`, `server`, `setup`, `starting`, `playing`, then `done`), `running`, `started`, `stopped`, `error`; `tail` its last lines (the check, the setup's steps, the game's pid and exit) |
| `POST /api/test-stop[?force=1]` | | `{ok}`: the game closed (`force`: at once), or a *Test* still starting starts none; 409 when none runs |
| `GET /preview/{pkg}/{rev}/{file}.png` | | a layer picture of a check |
| `GET /api/scene/{pkg}` | | `mapc scene` of the latest draft into the cache: `{ok, base, scene, result}` |
| `GET /api/level-scene/{level}[?models=0]` | | `mapc scene` of a level of the game (`models=0`: the marker list only) |
| `GET /api/nouns` | | the palette: `{ok, nouns: [{name, type, model, graphicsScale, box, icon}], icons, noModel}` |
| `POST /api/models` | `{nouns: [...]}` | `{ok, models: {<noun>: "/3d/<file>.gltf" or ""}}` |
| `POST /api/ground/{pkg}[?derived=0]` | | the 3-D ground of the latest draft: `{ok, n, url, triangles}`; `derived=0` without the art derived from the gameplay shapes (the layers' rules `lanes` and `edge`: `mapc ground --no-derived`) |
| `GET /3d/...` | | the cache's files (glTF, .bin, PNG), read only |
| `GET /api/textures` | | the game's textures a ground can use (`mapc textures --json`) |
| `POST /api/texture-pictures` | `{paths: [1-200 .dds], max: 128\|512\|1024\|2048}` | `{ok, textures: [{path, url or error}]}` |
| `GET /api/assets/{pkg}` | | the package's PNGs and the added ones: `{ok, assets: [{file, saved, url, w, h}]}` |
| `POST /api/asset/{pkg}?name=ground/<name>.png` | the PNG | `{ok, file, w, h, url}`, kept until Save; 400 for no PNG, over 4096 px or 64 MB |
| `GET /api/asset/{pkg}/{file}` | | an added or package PNG |
| `POST /api/bake/{pkg}[?derived=0]` | | `mapc bake` of the latest draft: `{ok, n, url, texels, tiles, texel_m, half_m, files, ms}`; `derived=0` as for the ground (`mapc bake --no-derived`) |
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

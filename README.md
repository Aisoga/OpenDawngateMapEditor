# Dawngate Map Editor

Make your own maps for [Dawngate Restoration](https://github.com/Aisoga/OpenDawngateServer), the server that makes
the 2014 MOBA Dawngate playable again. The editor runs in your web browser; `Start-Client.exe` of the release serves
it on your own PC. You draw the map from above, see it in 3-D, and press *Test Map* to play it in the game against bots,
without a server of your own.

A map is a **map package**: a folder with a `map.json` (the map as text) and, if you paint the ground with your own
pictures, a `ground` folder of PNGs. A package holds nothing of the game: every player's game builds the map's files
from its own copy. [docs/making-maps.md](docs/making-maps.md) explains what a map needs and every rule the check
applies.

## What you need

- The Dawngate Restoration release, installed and started once: unpack it, start `Start-Client.exe` and let it make
  your copy of the game (its *Installing* guide). Log in once on **This PC** to be sure the game runs.
- A current web browser: Edge, Chrome or Firefox. The 3-D view needs WebGL, which every current browser has.
- The editor's zip, `Dawngate-Map-Editor-<version>.zip`, from this project's *Releases* page.

## Installing

1. Close the game and `Start-Client.exe` if they run.
2. Unpack the editor's zip **into the release folder**, the folder with `Start-Client.exe`. It adds two things:
   - `editor\`: the editor's page, its templates and this guide;
   - `Map Editor.cmd`: the shortcut that starts it.
3. To update the editor later, unpack the new zip the same way and let it replace the old files. Your maps aren't in
   `editor\`, so they stay.

## Starting

Double-click **`Map Editor.cmd`**. A console window opens and says `Map editor: http://127.0.0.1:17890/`, and your
browser opens the editor. If the browser doesn't open, type that address into it. The editor is reachable from your
own PC only.

**Closing the console window quits the editor** (and the game, if a *Test* runs). Closing the browser tab doesn't:
open the address again to come back.

## Your first map

1. **File > New Map from Template...** (Ctrl+N, or *New* on the toolbar): pick a template, then give the map
   - a **name** (letters, digits and `_`, for example `CM_Lagoon`): the package folder's name and the map's name in
     the game files;
   - a **display name** of at most 13 characters: what the game's dialogs and the lobby show;
   - a **tag** (lower-case letters and digits, for example `lagoon`): what a custom game's name uses to pick the map;
   - a **prefix** for the game browser (for example `[Lagoon] `).

   The templates:
   - **CM_Ring** (*Test Ring*): two lanes round a ring, one well a side, a few bushes: the smallest complete map;
   - **CM_Grove** (*Test Grove*): two lanes with jungle camps, the buff camps and the parasite, bushes and the bots'
     ward spots;
   - **CM_Marsh** (*Marsh*): a map made in this editor from CM_Grove: reshaped lanes, a pond with water, props and a
     painted ground with its own picture.

   Your own packages in the `maps` folder can be templates too. **File > Open Map** (Ctrl+O, or *Open*) lists them.
2. **Edit** (the tour below). The check runs after every change.
3. **File > Save Map** (Ctrl+S) writes the package into `maps\<name>\`.
4. **Test Map** (`Ctrl+F9`, the green toolbar button) plays it (*Test: play your map* below).

## A tour of the editor

The editor is laid out like the Warcraft III World Editor: the **menu bar** and the **toolbar** at the top, the
**minimap** with the selection below it on the left, the **main view** in the middle, the **palettes** docked on the
right as tabs (**Terrain** T, **Doodads** D, **Units** U, **Lanes** L) and the **status bar** at the bottom. Every
menu item shows its key. Help > Keys and Mouse (`F1`) lists them all.

**The main view** shows the map from above (2-D, north up) or in 3-D; Tab, the toolbar's *2-D*/*3-D* or the View
menu switches. Under your drawing in 2-D lie the pictures the map compiles to (View > Background Layer: the layout,
the objects, the line of sight, the bushes, the paths the players and the creatures walk, the regions the bots use, the
minimap, the ground) with their opacity; View > Pathing (P) shows the players' paths, View > Grid (G) a 20-m grid, and
View's *Show* items turn the overlays on and off. A right or middle drag (or Alt + drag) scrolls, the wheel or
Shift + right drag zooms, the arrow keys scroll, F fits the map.

**The minimap** shows the whole map with the view's outline in white; click or drag on it to move the view there, in
2-D and in 3-D.

**You draw one team's half; the other is its mirror.** Every map is point-symmetric: team 2's half is team 1's turned
by 180 degrees round the centre. Team 2's things are drawn dashed and faded. Dragging one moves its team 1 original the
mirrored way.

**Selecting and moving** (*Select* on the toolbar; Space switches between it and the palette's tool): click a thing to
select it, drag it to move it. A shape moves whole, by its corners or by its radius handle; double-clicking an edge
adds a corner; Del deletes a shape, corner, lane knot, well, camp, ward spot or doodad. Esc ends a drawing, then the
tool, then the selection.

**The selection** (left, under the minimap) shows what you selected: its picture, its position and the few settings
of its kind, with *Delete*. Its **Advanced** section holds the rest: the drawing order, a prop's tilt and footprint, a
scatter's settings and its text as JSON (*Apply JSON*). With nothing selected it shows the map's facts; the map's own
settings are in **Map > Properties** and **Map > Options**, the whole document in **Advanced > Edit the Map as JSON**.

**The status bar** shows, left to right: the cursor's position, height and the ground under it (open, wall, chasm,
water, bush, island); the tool and its brush; the selection; the check and *Test*. Click the check to open the **Map
Check** window. Errors also show there for a moment; **View > Messages** opens the editor's log.

### Terrain (T)

The tab reads top to bottom: first how you draw, then what you draw. The status bar shows both ("Brush 8 m ·
Wall").

- **Draw with:** **Brush** (drag to draw, click for a dab), **Polygon** (click the corners; double-click or Enter
  ends), **Circle** (press at the centre, drag the radius) or **Path** (click the points; double-click or Enter ends).
  Esc cancels. Right under it are that draw mode's settings, and only those: the size for the Brush and a Path's width
  (2-32 m; `[` and `]`), Circle or Square for the Brush (a click lays a square; a stroke is a band either way), and
  for a texture its soft edge and *Erase* (X). A cliff drawn as a Polygon or a Circle needs none.
- **Apply: Texture | Cliff** switches what the pen applies. The draw mode stays when you switch, and the editor
  remembers your choice when you pick Select or another tab. Below the switch you see only the chosen one's list:
- **Apply Texture** paints the ground (see *Ground* below): the texture layers as tiles, *New layer...*, the stamps and
  *Follow the map*.
- **Apply Cliff:** **Chasm** (seen across, never walked), **Open** ground, **Wall**, **Water** (a chasm with water),
  **Island** (ground only the creatures walk) or **Bush** (where champions hide). Each drawing becomes a shape; to
  erase, draw the opposite: Open erases walls, Wall erases openings. A brush stroke over the middle line is split so
  each team gets its mirror. A bush drawn with the Brush or as a Path is saved as its outline (a bush is always an
  area with corners), so afterwards you shape it by dragging its corners.
- **Apply Height** shows while a wall or a chasm is selected: type its height (1-40 m; a chasm −1 to −40 m; empty:
  5 m) here or in its info, or in the 3-D view drag the handle over its middle up or down (half metres; Shift or
  Tools > Snap: metres). The ground follows while you drag. Walkable ground always stays level: the characters stand
  on the flat floor. A wall so tall it could hide a character from the game's camera gets a warning in the check,
  under its height too.

### Units (U)

**Add a Camp** is at the top of the Units tab: open the tab (top right, or press `U`), click a camp, click the map.
That's all a new camp takes. Map > Add a Camp and the link in the left panel lead here too, and when you delete a camp
the editor opens this tab for you.

| Camp | What it is |
|---|---|
| **Green buff**, **Blue buff**, **Orange buff** | killing the big creature gives its killer Power, Haste or armor for 150 seconds |
| **Fish camp**, **Mushroom camp**, **Ugger camp** | small camps, no buff |
| **Gold Pigs** | worth the most gold, late to appear and slow to respawn, no buff |
| **Parasite** | the big objective; a map has one |

While you choose where it goes, a ghost shows the camp, the room its creatures need and its mirror on team 2's side. It
turns red and says why where the camp can't go. You can click on either team's half: the camp stands where you
clicked, and its mirror on the other side. Each click places one camp, and it is left selected, so you can drag it right away.
Esc cancels. The Parasite has no mirror. While the map has one, its button is greyed and takes you to it: drag it, or
press Del and place a new one.

**A selected camp:** its *Type* changes what lives there. *Duplicate* (`Ctrl+D`) puts a copy beside it; `Ctrl+C` and
`Ctrl+V` paste one at the mouse. Del deletes it, and `Ctrl+Z` brings it back. The creatures, timers and rewards come with
the type. The camp's JSON stays under *Advanced* if you'd rather write it by hand, but you never need it.

Below is the list of the map's units: **the base** (the Locus, the Guardian, the shop, the five spawn points, the Cores
and the Bindings, the game's towers), which can only be moved; the **neutral passive** wells and mines (*+ Well*,
*+ Mine*), the **neutral hostile** camps and **the bots' ward spots** (*+ Ward spot*). A click selects one and jumps
there; *Player* filters the list. Cores and Bindings placed automatically are drawn hollow where the editor puts them;
dragging one makes your own points (*Back to "auto"* in the selection undoes it).

**Drags take what is joined** (Tools > Drag Joined Shapes Along, on by default): dragging a well, a camp or a lane
knot also moves the clearing round it and the ends of the paths that meet it, so paths stay connected. What a drag will
take is outlined in cyan.

### Lanes (L)

**One lane or two:** *One lane* makes a single lane through the centre, its own mirror: it keeps lane 1's way out of
your base and runs through the centre to the enemy's (the old lanes' corridors stay as open ground; Bindings you placed
go back to "auto"; the editor asks first when something is replaced). *Two lanes* adds lane 2 as the mirror of the
lane, on the same path at first: drag lane 1's knots to part them. Both are one undo step.

Each lane is a line of knots with a width (both lanes share it). The tab lists Lane 1 and Lane 2 with their lengths,
the chosen lane's knots from team 1's base (a click selects one and jumps there), *Insert knot after* and *Delete
knot*, and the Bindings and the minion spawner on the lane. Moving a knot moves its partner in the other lane, so the
two lanes stay mirrors. With a lane or a knot selected, the round handle beside the lane sets the width by a drag
(half metres; whole metres with Shift), between 6 and 80 m.

### The check, on every edit

The badge on the toolbar and the status bar say whether the map passes. **Map > Check...** (or a click on either)
opens the findings, errors first; clicking a finding selects the place it names and centres it.
[docs/making-maps.md](docs/making-maps.md) lists every rule with what to do about it. The window also shows where the
bots go (**Map > The Bots' Points**): each team's rally point at the parasite and its Hunter's route through the camps,
and **UNEVEN** when the two teams' points differ.

**Undo and redo:** Edit > Undo and Redo (Ctrl+Z and Ctrl+Y), 300 steps.

### Feedback while you edit

The editor shows what an edit does while you make it, in both views:

- **Measurements** beside the mouse and in the status bar's third part: while you drag a lane's knot, the lane's length
  (and how much it changed), its legs and its width; while you drag the width handle, the width; while you drag a
  Binding, the distance to its neighbours on the lane and to the nearest enemy Binding; for anything you drag, how far
  it moved and its distance to the centre; a corner's two edges; a circle's radius; the leg and the length of a polygon
  or path you draw; the brush's size.
- **Snaps with labels.** A point you drag or draw jumps to a nearby **Centre**, **Midpoint** (of a lane's leg or a
  shape's edge), the **Mirror line**, a **Lane edge** or, with the grid shown (G), the **Grid**'s lines; where two lines
  meet, to their crossing. The place it took is marked and named, and the status bar's *Snap* part names it too. Hold
  **Ctrl** while dragging to place freely for that move; a click on *Snap* in the status bar (or Tools > Smart Snaps)
  turns them off. **Shift** still rounds to whole metres.
- **Type a number** while you drag or draw, then **Enter**: the drag moves exactly that far in its direction (or type
  `x,y` for the place), a circle's radius handle and a circle you draw take it as the radius, the lanes' width handle
  as the width, a polygon or path you draw gets its next corner that far towards the mouse (`x,y`: there). Right after
  a drag, a number still sets that drag (one more undo step). With a brush armed, a number sets the brush's size.
  Backspace and Esc correct the number.
- **Hard errors are refused** where the editor can tell at once: a Locus, Guardian, shop, spawn, Core, Binding, well
  or camp on a wall or a chasm (or an island, but for a well), past the map's edge or on team 2's half (a new camp
  clicked there is placed instead, as the mirror of one on team 1's half); a new camp on top of another; the Guardian
  out of the south-west; a shape moved onto team 2's half; a lane knot on its neighbour; the lanes narrower than 6 m or
  wider than 80 m; a polygon crossing itself; a wall, chasm or island (drawn, brushed or moved) over one of those
  objects. The object stays where it last could; a red outline shows where you asked for, with the reason, and
  Messages keeps it. A rule that was already broken before you started doesn't hold you back, so you can mend it.
- **Everything else the check finds** (its warnings, and errors only the check can tell, such as a Binding too far from
  its lane) is marked on the object where it is now and on its mirror twin, with the rule and its reason. In the Map
  Check window a click on a finding selects the object and shows it in the view you are in (2-D: centred and zoomed
  in; 3-D: the camera on it).

### Gameplay overlays: how the map plays

**View > Gameplay Overlays** shows the numbers players feel, in the 2-D and the 3-D view:

- **Binding Ranges:** a ring round every Binding of both teams where it attacks (28 m from its edge, as in the game).
- **Lane Lengths:** each lane with a mark every 100 m and, at its middle, its length and how long a minion and a shaper
  walk it.
- **Walk Times from the Base:** how long a shaper walks from team 1's base to each Binding, camp, well, the parasite
  and the centre, along the ground players can walk (the dashed line is the way); team 2's are the mirror. The walk
  follows the ground of the last check, so after you move a wall it updates when the check has run.
- **Gameplay Numbers...:** all of it as a table, each lane and walk beside the same number on SM_Map_v5, the game's own
  map ("3 % shorter than SM_Map_v5").

The speeds are the game's base values without items: a shaper 11.18 m a second, a minion 9.56.

### Doodads (D): the game's models

The **Doodads** tab reads top to bottom: first how you place, then which doodads. The palette below holds the
game's dressing: rocks, trees, foliage, terrain pieces, effects and lights, each with a picture from above. Search
by words or pick a category.

- **Brush: Place | Scatter | Paste group** chooses what the pen does; right under it are that mode's settings only.
  *Place:* the next doodad's size, turn and height, *Random turn*, *Blocks* and *Shadow* (for new doodads).
  *Scatter:* *Along the walls* or *Fill area*, and for a fill *Where*, *Block* and the density. *Paste group:* *Pick a
  group from SM_Map_v5...*.
- **Picking doodads:** a click on a tile picks it (in place of the picks before), **Shift+click** adds a doodad or
  takes it out again (Ctrl+click does the same). The picks show above the tiles ("3 picked", one chip each; its x
  removes it). Picking never changes the mode: in Place a click arms placing, in Scatter the region tool stays armed.
- **Place:** click the map (each click places one, Esc ends), or drag a tile onto the map. With several doodads
  picked, each click lays one of them at random; the ghost under the mouse shows which comes next. A doodad dropped on
  team 2's half is placed on team 1's half so that its mirror stands where you dropped it.
- **Size and turn before placing:** the ghost under the mouse shows how the next doodad stands. While placing,
  Ctrl+wheel sizes it, Shift+wheel turns it (the wheel alone zooms), R and Shift+R turn it by 15 degrees, `]` and `[`
  size it by 10 %, Alt+wheel raises or lowers it by 0.1 m (Shift+Alt by 1 m); Place's *Next doodad* fields *size*, *turn*
  and *height* fields show and set the same, and they stay for the next doodads. With *Random turn* ticked each doodad gets a random turn (the ghost shows it); setting a turn unticks it.
- **Edit:** drag to move; the round handle turns, the square one scales. R and Shift+R turn by 15 degrees, `[` and
  `]` scale by 10 %, Alt+wheel raises or lowers by 0.1 m (Shift+Alt by 1 m; the view shows the height meanwhile), Ctrl+D duplicates, Del deletes (also in the Edit menu). The selection also sets the height (*On
  the water* puts a lily pad on the water), *blocks* and *shadow card*.
- **Several at once (on the map):** Shift+click or Ctrl+click adds doodads, a box selects every doodad it touches, Ctrl+A takes
  all. Ctrl+C, Ctrl+X and Ctrl+V copy and paste, also into another map.
- **Blocks:** a blocking doodad stops walking and sight inside its footprint (the dashed orange ellipse). The editor
  takes the footprint from the model's size; a tree wants only its trunk's (about 2 x 2 m: the selection's Advanced).
- **Paste group:** *Pick a group from SM_Map_v5...* takes a piece of the original map's dressing (pick a spot, a radius and the
  kinds), then you click where it goes. It moves, turns and scales as one group. Advanced > Split the Group into Doodads
  makes its members single doodads.
- **Scatter:** pick the doodads to scatter in the palette (Shift+click adds more), choose Scatter and draw the region. The
  doodads are turned and scaled at random and mirrored for team 2. *Along the walls* spreads them along the wall edge
  inside the region: while you draw, the wall-edge cells that get doodads are marked and an estimate is shown ("≈ 5
  doodads"); a region with no wall edge places nothing and says so. *Fill area* spreads them over the whole region:
  *Where* picks the ground (anywhere, on walls, off walkable ground, on walkable ground), and while you draw the cells
  it may use are shaded and a bright dot marks each doodad, with their count (the count the map gets). Plants (grass,
  flowers, ferns, leaves, mushrooms) may stand anywhere and never block; rocks and trees stand on walkable ground only
  with *Block*, and then each blocks walking and sight round its trunk, so a forest is something units walk round. The
  lanes, the bases, the wells and camps stay clear. The region's info switches the mode and sets *Where*, *Block*, the
  density and the footprint. Tools > New Seed for the Scatter deals them again; Advanced > Scatter Settings sets their
  spacing and scale.
- **Mirror off:** a doodad with *mirror for team 2* unticked stands once, where you put it.

### Ground: painting the map

**Terrain > Apply Texture** paints the map's ground from layers of the game's textures (or your own pictures), each
drawn where its mask is.

- *Paint this ground* starts with two layers: earth everywhere, grass on the high ground.
- **Paint:** click a layer's tile, then draw on the map with the draw mode (a brush stroke, a polygon, a circle or a
  path); *Erase* (X) under the draw mode erases. The size under the draw mode (`[` and `]`) sets the brush. What you draw is mirrored for team 2 unless
  the layer's *mirror* is off.
- **Layers** (Advanced > Ground Layers in Detail, bottom first): a texture (the game's, your own PNG, a colour or the
  dirt), its repeat in metres, turn, tint, variation, *break* (hides the repeats) and opacity, the order, and the
  **mask**: an automatic rule (all, floor, high ground, slopes, chasms, bushes, lanes, edge) plus what you paint.
- **Layers that follow the map:** the rules *lanes* (a path down every lane; *width* in metres, empty for the lane's
  own) and *edge* (a band along the walls' or chasms' edge; *from* and *to* in metres out from the edge, negative up
  the wall's slope or down into the chasm; *along* walls, chasms or both) are painted again from your layout at every
  bake, so moving a lane or a wall moves them; *edge soft* feathers the band. Their tiles are marked green with the
  rule under the name. *Follow the map* adds one with a click: **+ Lane path**, **+ Cliff foot** (along the walls) or
  **+ Chasm rim**.
- **View > Hide Derived Art** shows the map without them: the bake and the 3-D ground without the *lanes* and *edge*
  layers, and without the doodads the scatters place; click it again to bring them back. It changes only what you see.
- **Stamps** (*+ Stamp*): lay a picture once, for example a gold mine's disc; Advanced > Stamps in Detail cuts a piece
  out of a bigger picture (*Cut a piece...*) and sets its size and border.
- **Your own pictures:** *Add a PNG...* in the texture picker (at most 4096 pixels a side). Saving copies them into
  the package's `ground` folder; they travel with your map.
- **Painting in another program:** Advanced > Export Ground Pictures writes the ground's tiles as PNGs; paint them in
  any program and bring them back with Advanced > Import Ground Pictures. They become the ground's picture, under
  every layer. Tools > Paint into the Picture paints a picture instead of strokes.
- After each change the ground is baked again (a few seconds) and shown under the 2-D view (View > Ground Texture)
  and in 3-D. Map > Ground Bake and Cliff sets the bake's size and the cliffs' material.

### The void: what lies past the ground

**Map > The Void** makes the map end at a cliff over a deep plane seen through a coloured mist, as the original second
map looks. Switch on *a void* for that look, then set where the ground ends (*cut*), the plane far below (*backdrop*:
its colour or texture, depth, lit or unlit), the mist's height, depth and colour, and the map's height fog. Each field
shows its range.

### The 3-D view

**3-D** (Tab) shows the ground and the game's models the map will place, as the game's camera sees them (View >
Camera > Game Camera) or from anywhere (*Free Camera*). Water, bushes, the doodads and the void are drawn too (View >
Water, Bushes, Mist). View > Compare with a Level shows one of the original maps instead. The picture is close to the
game's; the game itself is the exact one.

You edit in 3-D as in 2-D: the left button is the tool's. A click selects what is under the mouse (a doodad or a
base object where its model shows, a corner, a knot, a shape on the ground) and a drag moves it along the ground; a
selected doodad has its turn handle (round) and its scale handle (square) on the ground round it, and team 2's mirror
shows as a dashed ring. With a doodad picked in the Doodads palette its see-through ghost (and its mirror's) follows the
mouse, and a click places it as the ghost shows it (R, `[` `]`, Shift+wheel and Ctrl+wheel turn and size it first,
Alt+wheel raises or lowers it; the overlay shows its height while it changes); a
palette tile dragged onto the view lands where you drop it. A drag on empty ground, or Shift/Ctrl + drag, selects the
doodads inside the box you see. The check's findings are marked where they are.

The camera, as in the World Editor: a right or middle drag (or Alt + left drag) scrolls, the wheel or Shift + right drag
zooms, Ctrl + right drag turns the camera (with the free camera: and tilts it). The arrow keys scroll and F frames the
selection while the view has the focus (click into it). View > Camera's *Team 1's Base*, *Team 2's Base*, *The Centre*
and *The Selection* move it; *Follow the Selection* keeps it on what you select in a list or the 2-D view (a click in
the 3-D view leaves the camera where it is). The status bar shows the ground under the mouse: x, y, its height and its
kind.

**Drawing in 3-D.** Every draw mode of the Terrain tab works in 3-D as in 2-D, on the ground under the mouse: the
brush's outline and the stroke lie on the ground, a polygon or path being drawn is dashed on it, a circle grows as you
drag. The lanes show as lines with their knots; drag a knot as in 2-D. With a lane or a knot selected, the lane's
edges show dashed and a round handle stands beside it: drag it to set the lanes' width. The scatter regions and the
blocking doodads' footprints are drawn on the ground, and the Paste tool's group shows as see-through models under
the mouse.

**Heights.** A selected wall or chasm has a handle over its middle at its height (a triangle on a dashed stem from the
floor, with its height beside it): drag it up or down to set the plateau's height or the chasm's depth (Apply Height
above).

**The ground follows at once.** While you draw a wall or a chasm, drag a shape, a corner, a lane knot, the lanes'
width or a height handle, the 3-D ground rises and falls with it, as the map will have it; a texture stroke or a stamp is painted onto
the ground (in 2-D onto the painted ground under the map) while you draw it. A moment later the editor's exact ground
and painting replace this quick version. The quick painting has hard edges, and an *Erase* stroke shows only with the
exact painting.

### Keys

| Keys | What |
|---|---|
| Ctrl+N, Ctrl+O, Ctrl+S, `Ctrl+F9` | New Map, Open Map, Save Map, Test Map |
| Ctrl+Z, Ctrl+Y | Undo, Redo |
| Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+D, Del, Ctrl+A | Cut, Copy, Paste, Duplicate, Delete, Select All Doodads |
| T, D, U, L | the Terrain, Doodads, Units and Lanes palettes |
| Space | Select, or the palette's tool |
| Tab | 2-D or 3-D |
| F | fit the map (2-D), frame the selection (3-D) |
| G, P | the grid, the pathing |
| R, Shift+R, `[`, `]` | turn the selection 15 degrees, scale it; while placing a doodad: its turn and size; while drawing terrain: the brush's size |
| Ctrl+wheel, Shift+wheel | while placing a doodad: its size, its turn |
| Alt+wheel, Shift+Alt+wheel | a doodad's height by 0.1 m, by 1 m: the selected doodads, or while placing the next one (its *Next doodad* height); in both views. Base objects, wells, camps and ward spots stay on the ground |
| X | Apply Texture: erase or paint |
| Shift+click, Ctrl+click a doodad tile | add it to the picks or take it out (a plain click picks it alone) |
| Esc, Enter | end the drawing, the tool, the selection; end a polygon or path |
| a number, Enter | while dragging or drawing: the exact distance, radius or width (`x,y`: the place); with a brush armed: its size |
| Ctrl (while dragging) | no snaps for this move |
| arrow keys | scroll the view (3-D: while it has the focus) |
| `F1` | the keys and the mouse |

The snaps (Centre, Midpoint, Mirror line, Lane edge, Grid) are on by default: Tools > Smart Snaps or a click on *Snap*
in the status bar. Shift snaps to whole metres while you draw or drag (Tools > Snap to 1 m keeps it on).

## Test: play your map

Press **Test Map** (`Ctrl+F9`, also in the File menu). The editor checks the saved map (it offers to save first), closes
the game if it runs, builds the map into your game and starts it with **This PC** selected and your map set. View >
Messages shows each step, and the status bar the current one:

1. Log in with any name (This PC checks no password). The login starts the server on your PC with your map; the
   first time it also sets up the match host, which takes about half a minute.
2. PLAY, then PRACTICE, then PRACTICE DAWNGATE: the practice match plays your map, five against five with bots.

While the game runs, the button says **Test Again**: it closes the game and starts it again with the saved version
(the game loads its maps only when it starts). File > **Stop the Test** (or *Stop* on the toolbar) closes the game. A
map that fails the check doesn't start: Messages shows its first error, and Map > Check lists them all. Another map in the `maps` folder that can't be built is
left out of the game (Messages says why); only the map you test must build.

*Test* doesn't run while `Start-Server.exe` runs in the same folder (it is This PC then), and the editor doesn't start
while it does. Stop it, or name your map in its `Start-Server.ini` (`map = CM_<name>`) and play there.

## Sharing a map

Give your package folder (`maps\<name>\`, with its `ground` folder if it has one) to the operator of a server, for
example as a zip. They copy it into their server's `maps` folder and name it in their `Start-Server.ini`. Their
server then hands the map to every player who logs in: you don't need to send it to the players.

A map you got from a server (it has a `delivered.txt`) opens read-only: the server would replace your changes at your
next login there. File > *Save as My Own Copy* makes a package of your own from it.

## Where the files are

| Folder (in the release folder) | What |
|---|---|
| `maps\<name>\` | your map packages: `map.json` and `ground\*.png`. Back these up. |
| `editor\` | the editor itself (this zip's files); replaced when you update it |
| `Dawngate-Data\editor\` | the editor's working files: the 3-D view's models and pictures, the bakes, the exported ground tiles. They are made from your copy of the game, so they stay on your PC; never share them. Deleting the folder is safe: the editor makes them again. |

## When something goes wrong

- **The console says the port is taken:** another program (or another editor) uses port 17890. Close it, or start
  `Start-Client.exe --editor --editor-addr 127.0.0.1:<another port>` from a console in the release folder.
- **The page says its version doesn't match:** the editor's zip and the release don't fit. Update both from their
  *Releases* pages.
- **The console says to unpack the editor:** the `editor` folder is missing or in the wrong place. Unpack the zip
  into the folder with `Start-Client.exe`.
- **The console says the editor needs the server picker:** your `Start-Client.ini` sets a server, `picker = off` or
  `tunnel = off`. The editor plays on This PC, which only the server list has: empty `server =` and set
  `picker = auto` and `tunnel = auto`.
- **The console says a Dawngate client is already running:** close the game (or the other `Start-Client.exe`), then
  start the editor again.
- **Test refuses to start:** read the line in View > Messages. A map that fails the check, `Start-Server.exe`
  running in the same folder, another game running, or a *Test* that is still starting are the usual reasons.

## Licence

The editor is free software under the GNU Affero General Public License, version 3 ([LICENSE](LICENSE)), like
Dawngate Restoration. Working on the editor: [DEVELOPING.md](DEVELOPING.md).

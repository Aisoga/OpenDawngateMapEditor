# Dawngate Map Editor

Make your own maps for [Dawngate Restoration](https://github.com/Aisoga/OpenDawngateServer), the server that makes
the 2014 MOBA Dawngate playable again. The editor runs in your web browser; `Start-Client.exe` of the release serves
it on your own PC. You draw the map from above, see it in 3-D, and press *Test* to play it in the game against bots,
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

1. **New from template...**: pick a template, then give the map
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

   Your own packages in the `maps` folder can be templates too.
2. **Edit** (the tour below). The check runs after every change.
3. **Save** (Ctrl+S) writes the package into `maps\<name>\`.
4. **Test** plays it (*Test: play your map* below).

## A tour of the editor

**The 2-D view** shows the map from above, north up. Under your drawing lie the layers the map compiles to, as a
background: the layout (walls, open ground, chasms), the objects, the line of sight, the bushes, the paths the players
and the creatures walk, the regions the bots use, the minimap and the ground. A slider sets how strongly they show.

**You draw one team's half; the other is its mirror.** Every map is point-symmetric: team 2's half is team 1's turned
by 180 degrees round the centre. Team 2's things are drawn dashed and faded. Dragging one moves its team 1 original the
mirrored way.

**Selecting and moving** (the *Select* tool): click a thing to select it, drag it to move it. A shape moves whole, by
its corners or by its radius handle; double-clicking an edge adds a corner; Del deletes a shape, corner, lane knot,
well, camp or prop.

- **The base** (the Locus, the Guardian, the shop, the five spawn points, the Cores and the Bindings, the game's
  towers) can only be moved. Cores and Bindings placed automatically are drawn hollow where the editor puts them;
  dragging one makes your own points (*Back to "auto"* in the inspector undoes it).
- **Lanes:** each lane is a line of knots with a width. Moving a knot moves its partner in the other lane, so the
  two lanes stay mirrors. *Insert knot after* and *Delete knot* change both lanes.
- **Drags take what is joined** (*drag joined shapes along*, on by default): dragging a well, a camp or a lane knot
  also moves the clearing round it and the ends of the paths that meet it, so paths stay connected. What a drag will
  take is outlined in cyan.

**New shapes** (the *Shape* tool): a **wall**, **open** ground, a **chasm** (seen through, never walked; it can hold
water) or a **bush** (where champions hide), as a circle (press and drag), a polygon or a path (click points;
double-click or Enter ends, Esc cancels). The *Well* and *Camp* tools place a spirit well or a jungle camp with one
click; the bots' ward spots are moved and added the same way.

**The inspector** (right) shows what you selected: its coordinates, type, size and order, and its text as JSON
(*Apply JSON*). With nothing selected it shows the map's own settings and the whole document.

**The check, on every edit.** The badge says whether the map passes. The findings list shows errors first; clicking a
finding selects the place it names and centres it. [docs/making-maps.md](docs/making-maps.md) lists every rule with
what to do about it. The line under the check also shows where the bots go: each team's rally point at the parasite
and its Hunter's route through the camps, and **UNEVEN** when the two teams' points differ.

**Undo and redo:** Ctrl+Z and Ctrl+Y, 300 steps.

### Props: the game's models

The **Props** pane is the palette of the game's dressing: rocks, trees, foliage, terrain pieces, effects and lights,
each with a picture from above. Search by words or filter by type.

- **Place:** click a tile, then click the map (each click places one, Esc ends), or drag a tile onto the map. A prop
  dropped on team 2's half is placed on team 1's half so that its mirror stands where you dropped it.
- **Edit:** drag to move; the round handle turns, the square one scales. R and Shift+R turn by 15 degrees, `[` and
  `]` scale by 10 %, Ctrl+D duplicates, Del deletes. The inspector also sets the height (*On the water* puts a lily
  pad on the water), *blocks* and *shadow card*.
- **Several at once:** Shift+click or Ctrl+click adds props, a box selects every prop it touches, Ctrl+A takes all.
  Ctrl+C, Ctrl+X and Ctrl+V copy and paste, also into another map.
- **Blocks:** a blocking prop stops walking and sight inside its footprint (the dashed orange ellipse). The editor
  takes the footprint from the model's size; a tree wants only its trunk's (about 2 x 2 m).
- **Paste from SM_Map_v5...:** take a piece of the original map's dressing (pick a spot, a radius and the kinds), then
  click where it goes. It moves, turns and scales as one group. *Split into props* makes its members single props.
- **Scatter:** pick several props in the palette with Ctrl+click, press *Scatter...* and draw a region: they are
  spread along the walls inside it, turned and scaled at random. *New seed* deals them again.
- **Mirror off:** a prop with *mirror for team 2* unticked stands once, where you put it.

### Ground: painting the map

The **Ground** pane paints the map's ground from layers of the game's textures (or your own pictures), each drawn
where its mask is.

- *Paint this ground* starts with two layers: earth everywhere, grass on the high ground.
- **Layers** (bottom first): a texture (the game's, your own PNG, a colour or the dirt), its repeat in metres, turn,
  tint, variation, *break* (hides the repeats) and opacity. A layer's **mask** is an automatic rule (all, floor, high
  ground, slopes, chasms, bushes) plus what you paint.
- **Paint** (the *Paint* tool): drag to paint the selected layer, click for a dab, `X` erases. `[` and `]` set the
  brush's size. Strokes are mirrored for team 2 unless the layer's *mirror* is off.
- **Stamps** (the *Stamp* tool): lay a picture once, for example a gold mine's disc; cut a piece out of a bigger
  picture with *Cut a piece...*.
- **Your own pictures:** *Add a PNG...* (at most 4096 pixels a side). Saving copies them into the package's `ground`
  folder; they travel with your map.
- **Painting in another program:** *Export ground...* writes the ground's tiles as PNGs; paint them in any program and
  bring them back with *Import ground...*. They become the ground's picture, under every layer.
- After each change the ground is baked again (a few seconds) and shown under the 2-D view and in 3-D.

### The void: what lies past the ground

The **Void** panel makes the map end at a cliff over a deep plane seen through a coloured mist, as the original
second map looks. Switch on *a void* for that look, then set where the ground ends (*cut*), the plane far below
(*backdrop*: its colour or texture, depth, lit or unlit), the mist's height, depth and colour, and the map's height fog.
Each field shows its range.

### The 3-D view

The **3-D** tab shows the ground and the game's models the map will place, as the game's camera sees them (*Game
camera*) or from anywhere (*Free*: drag to orbit, right-drag to pan, the wheel zooms). *Base 1*, *Base 2*, *Centre*
and *Selection* move the camera. Water, bushes, the props and the void are drawn too. *Scene* shows one of the
original maps instead, to compare. The picture is close to the game's; the game itself is the exact one.

### Keys

F fits the view, the wheel zooms, a right or middle drag (or Alt+drag) pans, Shift snaps to whole metres. Ctrl+S
saves, Ctrl+Z and Ctrl+Y undo and redo.

## Test: play your map

Press **Test**. The editor checks the saved map (it offers to save first), closes the game if it runs, builds the map
into your game and starts it with **This PC** selected and your map set:

1. Log in with any name (This PC checks no password).
2. PLAY, then PRACTICE, then PRACTICE DAWNGATE: the practice match plays your map, five against five with bots.

Each later *Test* closes the game and starts it again with the new version: the game loads its maps only when it
starts. **Stop** closes the game. A map that fails the check doesn't start; its findings are in the list.

*Test* doesn't run while `Start-Server.exe` runs in the same folder (it is This PC then). Stop it, or name your map
in its `Start-Server.ini` and play there.

## Sharing a map

Give your package folder (`maps\<name>\`, with its `ground` folder if it has one) to the operator of a server, for
example as a zip. They copy it into their server's `maps` folder and name it in their `Start-Server.ini`. Their
server then hands the map to every player who logs in: you don't need to send it to the players.

A map you got from a server (it has a `delivered.txt`) opens read-only: the server would replace your changes at your
next login there. *Save as my own copy* makes a package of your own from it.

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
- **Test refuses to start:** read the line in the *Test* panel. A map that fails the check, `Start-Server.exe`
  running in the same folder, or another `Start-Client.exe` whose game runs are the usual reasons.

## Licence

The editor is free software under the GNU Affero General Public License, version 3 ([LICENSE](LICENSE)), like
Dawngate Restoration. Working on the editor: [DEVELOPING.md](DEVELOPING.md).

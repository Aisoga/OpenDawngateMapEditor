# Making maps

This guide says what a Dawngate map needs, what `map.json` holds member by member, and every rule the check applies,
with what to do when a rule fails. The editor writes `map.json` for you; this is for understanding a finding, editing
the JSON in the selection's Advanced section (or Advanced > Edit the Map as JSON), or writing a package by hand.

## What a map is

A map is a **map package**: one folder, named like the map, with

```
<Name>/
  map.json          the map
  ground/*.png      your own pictures, only if the map's ground uses them
```

Nothing of the game is in a package. When a player's `Start-Client.exe` (or a server's `Start-Server.exe`) finds the
package in its `maps` folder, the map compiler `mapc` builds the map's game files from that player's own copy of the
game: one archive `zz_<Name>.snap` in the game's data folder. Every player and the server build the same bytes from
the same package, and a server lets a player into a game on the map only when their file is the same as its own.

## What every map gets

The compiler makes all of this from `map.json`; nothing has to be drawn by hand but the layout and the objects. It is
listed so that a finding about one of them makes sense:

| The game needs | What the compiler makes it from |
|---|---|
| the floor that units stand on (a physics mesh) | one shared flat floor for every map |
| two walking graphs: one for the champions, one for the minions and creatures | the open ground of the layout, with a hole of about 10 m round each Guardian |
| the line-of-sight map (walls block sight) | the walls of the layout and the blocking props |
| the fog's outlines, so walls and bushes hide what is behind them | the walls and the bushes |
| the bushes (where champions hide) | the `bush` shapes |
| the regions the bots use (base, lanes, jungle, camps) | the lanes, the bases and the camps |
| the minimap | the layout's colours (or the painted ground) |
| the ground model and its textures | the layout's heights and `ground` |
| the light, atmosphere, music and gameplay tuning | `environment` and `tuning`: those of one of the original maps |
| the base objects: spawn points, the shop, the Guardian, the Cores, the Bindings (towers) | `base`, mirrored for team 2 |
| the end-of-match cameras at each Guardian | the Guardians' places |
| the map's name in the game's dialogs and the browser | `display`, `tag` and `prefix` |

## The map's coordinates

The map is a square of `size` metres centred on (0, 0): x grows to the east, y to the north. **Every map is
point-symmetric:** team 1's base is in the south-west, and team 2's half is team 1's turned by 180 degrees round the
centre, (x, y) becomes (−x, −y). You author team 1's half only: everything you place is mirrored, and an authored
point must lie on team 1's side of the diagonal (x + y ≤ 0, a shape's centre at most 0.5 past it).

## map.json, member by member

`map.json` is read strictly: a member the compiler doesn't know is an error (`format.json`), so a typing error never
passes unnoticed.

| Member | What it is | Allowed |
|---|---|---|
| `format` | the package format | `1` |
| `name` | the map's name in the game files (the archive is `zz_<name>.snap`) | letters, digits, `_`; at most 80; not an original map's name; unique in the maps folder |
| `display` | the name the game's dialogs and the lobby show | 1-13 characters |
| `tag` | what a custom game's name uses to pick the map (`~#<tag>`) | lower-case letters and digits; not `sm` or `mm`; unique in the maps folder |
| `prefix` | what the game browser puts before a game's name, for example `[Ring] ` | at most 16 characters |
| `size` | the side of the map's square, in metres | more than 0, at most 600; every authored point at least 2 m inside the edge |
| `symmetry` | how team 2's half is made | `"point"` |
| `environment` | whose light, atmosphere and music the map has | `"SM_Map_v5"` or `"MM_Map_v3"` |
| `tuning` | whose gameplay tuning, items and settings the map uses | `"SM_Map_v5"` or `"MM_Map_v3"` |
| `lanes` | one or two lanes: `{"id": 1 (Top) or 2 (Bottom), "width": m, "knots": [[x, y], ...]}`, in team 1's direction from its base | ids once each; width 6-80 m; 2-16 knots, none within 1 m of the one before; lane 2 is lane 1 mirrored and walked back, with the same width |
| `base` | team 1's base: `locus`, `guardian`, `shop` (the shop's reach is measured from it), `spawns` (5 points), `cores` and `bindings` | below |
| `wells` | team 1's spirit wells or gold mines: `[{"kind": "well" or "mine", "pos": [x, y]}]`, each mirrored | 1-8 on the map (so 1-4 authored) |
| `camps` | team 1's jungle camps: `[{"kind": "camp", "buff" or "parasite", "noun": "<the camp's spawner>", "pos": [x, y]}]`, each mirrored but the parasite (the map has one). The editor's Units > Add a Camp writes these for you: *Camps by name* below | the noun one of the original map's camp spawners |
| `terrain` | the layout: `default` (what the ground is where no shape is: `wall`, `open` or `chasm`) and `shapes`, drawn in order over it, each mirrored | below |
| `ground` | how the ground looks: `{"style": "tiled"}` (the plain default) or `"baked"` (painted: layers, stamps, a cliff material, your own pictures) | below |
| `props` | the game's models as dressing: a single model (`noun`) or a piece of an original map's dressing (`group`) | below |
| `scatter` (optional) | props spread by a seed along the walls, or over a whole region | below |
| `void` (optional) | what the map shows past its ground: the ground cut off, a plane far below, a mist and the height fog | below |
| `graph` (optional) | `{"cell": n}`: the size of the walking graphs' squares, 2-4 map cells a side | below |
| `wards` (optional) | the bots' ward spots, team 1's: `[{"pos": [x, y]}]`, each mirrored, in order of preference; without it the bots use the original map's spots | at most 16 |

**The base.**
- `locus`, `guardian` and `shop` are points; `spawns` is five points.
- `cores`: `"auto"` (five Cores round the Guardian, A-E, as on the original map), or your own five points (or three,
  A-C, for a map like the second original map).
- `bindings`: `"auto"` (on each lane the Outer, Middle and Inner Binding at about 45 %, 31 % and 18 % of the lane's
  length from the base, a little to the side), or your own: `{"1": [Outer, Middle, Inner], "2": [...]}` per lane id,
  or two tiers `[Middle, Inner]` per lane, the same on every lane. When the two lanes run as one path (every knot
  within 60 m of the other lane), only one lane needs its Bindings: team 2's are their mirror on the other lane.
- Each lane's minion spawner stands 21 m behind its first knot; you don't place it.

**Shapes** (`terrain.shapes`). Each has a `type` and exactly one geometry:
- types: `open` (walked and seen through), `wall` (neither), `chasm` (seen through, never walked; the ground drops),
  `island` (ground only the creatures walk, like the gold mines' islands on the second original map; a well on it is
  out of the champions' reach), `bush` (grass that hides champions; the ground stays as it is);
- geometries: `"lane": <id>` (that lane's corridor at its width), `"circle": [x, y], "r": m`, `"polygon": [[x, y],
  ...]` (3 or more corners, even-odd), or `"path": [[x, y], ...], "width": m` (2 or more points);
- a bush is a circle or a polygon; an island anything but a lane; `terrain.default` can't be `island`;
- a wall may set its plateau's **height** and a chasm its depth: `"height": m`, 1 to 40 for a wall, −40 to −1 for a
  chasm (none: 5 m up or down). Where shapes overlap the later one's height wins, as its type does; neighbouring
  heights ramp over about 8 m. Walkable ground has no height: the characters always stand on the level floor. A
  taller cliff is wider (a 12-m wall reaches its full height about 9 m in from the edge), so a tall wall needs room; a
  chasm's cliff starts at the walkable ground round it, so give a chasm a rim of walkable ground (an `open` shape under
  it, a few metres wider) where it would meet a wall: cut straight into a wall it drops from the plateau to its floor
  in one vertical step, which the game draws as a dark pit with a stepped rim;
- a chasm can hold **water**: `"water": true`, `false`, or `{"z": m (−4.5 to −0.25, default −2), "mask": "none" |
  "circle" | "Chasm_wm_1" ... "_8" | "Fish_wm_1" ... "_6" | "Spirit_Lake_gobo", "look": "river" | "chasm"}`.

**The ground** (`"style": "baked"`; every member optional):
- `texels` (1024, 2048 or 4096: a tile's side), `tiles` (1, 2 or 4 a side), `minimap` (`"bake"` or `"flat"`);
- a **texture** is one of `{"game": "<.dds path>", "archive": "<the game's archive>.snap"}` (read from each player's
  copy), `{"file": "ground/<name>.png"}` (in the package; at most 4096 pixels a side), `{"procedural": "dirt"}` or
  `{"rgb": [r, g, b]}`;
- `layers` (at most 12, bottom first): `texture`, `scale` (metres a repeat covers), `rot`, `tint`, `vary`, `break`
  (0-1: hides the repeats), `opacity`, and every layer but the first a mask: `auto` (`all`, `floor`, `high`, `slope`,
  `chasm`, `bushes`, `lanes`, `edge`), `image` (a grey PNG over the map's square, north up) and `shapes` (painted
  strokes; `"erase": true` takes away), softened by `soft` and moved by `noise`, mirrored unless `"mirror": false`;
- two rules follow your layout, so the art moves with it: **`lanes`** paints both lanes' corridors (`width`: the
  band's width in metres, 2-120; without it each lane's own width), and a new or moved lane brings its path along;
  **`edge`** paints a band along the edge of the walkable ground (`range`: `[from, to]` metres from the edge, -20 to
  60, default `[0, 6]`; a negative `from` reaches onto the wall or into the chasm), against the walls, the chasms
  or both (`along`: `"walls"`, `"chasms"`, or leave it out). `soft` feathers the band's edges, `noise` breaks them
  up. Both are worked out again at every build, never saved as paint;
- `stamps` (at most 64, laid over the layers): `image` (with `rect` to cut a piece), `pos`, `size`, `rot`,
  `opacity`, `tint`, `soft`, `round`, `mirror`;
- `cliff`: a texture for the steep faces: `texture`, `scale` (6-100 m), `slope` (20-80 degrees), `tint`;
- `picture`: a painted picture per tile (the editor's *Export ground* and *Import ground*), under the layers;
- `decals` (at most 32, with either style): pictures projected onto the ground.

**Props** (`props`), each mirrored unless `"mirror": false`:
- a single model: `{"noun": "<the game's model>", "pos": [x, y] or [x, y, z], "rot", "scale" (0.05-20), "blocks",
  "footprint": [w, d], "shadow", "tilt": [x, y]}`. A blocking prop stops walking and sight inside its footprint, an
  ellipse of `footprint` metres;
- a group: `{"group": {"level", "sets", "at", "r" (up to 80 m) or "polygon", "holes"}, "pos", "rot", "scale"}`: the
  dressing of an original map within `r` of `at` (or inside the polygon), without the markers inside `holes`. A
  group neither blocks nor gets a shadow: draw a wall shape where it should block.

**Scatter** (`scatter`): `{"nouns", "seed", "along", "circle" and "r" or "polygon", "spacing" (at least 1 m, default
6), "inset" (0-10 m), "scale": [min, max], "max" (at most 1,000 a side, default 200), "shadow"}`, and for a filled area
`"on"`, `"blocks"`, `"footprint"`, `"density"`. Every scatter is mirrored for team 2, and its props keep `spacing`
from each other and from their mirrors.
- `"along": "walls"` (the default): along the wall edge inside the region, `inset` metres into the wall.
- `"along": "area"`: over the whole region. `"on"` says which ground: `"any"` (the default), `"walls"`,
  `"off-ground"` (walls and chasms) or `"ground"` (walkable ground). On walkable ground only plants stand without
  blocking: the nouns whose names begin `grass`, `flowers_`, `foliage_`, `forestbush_`, `forestleaves_`,
  `fungus_mushroom`, `leaves_`, `lowshrub_`, `plants_` or `pumpkin_leaves`. Rocks, trees and every other noun stand
  there only with `"blocks": true`, and then each blocks walking and sight in a circle `footprint` metres across
  (default 2, a trunk) times its size, so units and bots go round it; plants never block. Nothing stands on the lanes
  (their width plus 2 m), within 18 m of a Guardian, 24 m of a well, 12 m of a camp, 8 m of the Locus, the shop,
  a spawn point, a Core, a Binding or a minion spawner, or 4 m of a ward spot. `"density"` (over 0, up to 1) keeps
  that share of the spaced places, for a sparser fill. A filled prop stands on the ground's height (on a plateau, on
  top of it). A map that uses `"along": "area"` needs the editor and server of this version or later: an older one
  refuses it (`scatter.along`).

**The void** (`void`; every member optional): `cut` (the ground ends this many metres past the walkable edge),
`backdrop` (`z`, `texture`, `scale`, `unlit`: the plane under the level), `mist` (`z`, `range`, `color`: a
see-through layer that tints what lies under it), `fog` (`start`, `end`, `color`: the map's own height fog).

**The graph** (`graph`): the walking graphs are made of squares; a smaller square (`"cell": 2`) brings the walkable
ground nearer the walls. Without it the compiler picks the smallest square that keeps both graphs under 7,000 areas.

**How wide a path must be:** a square only exists where all of its cells are walkable, after the walkable ground has
been shrunk by one cell along every edge, and the squares sit on a fixed grid. So open ground narrower than about two
squares holds none, and nobody walks it in game: not the champions, not the minions, not a camp's creatures. On a
450-m map with the usual 3.5-m squares, a path running north-south or east-west needs about **8 m**, one at an angle
about **11 m**; the editor shows the numbers for your map under *paths* in the map's facts, the check names them in
`reach.narrow`, and the map shows such ground in red (with the check's findings shown).

### Camps by name

In the editor, Units > Add a Camp and a selected camp's *Type* use these names and write `kind` and `noun` for you. The
table is for writing `map.json` by hand. The creatures, timers and rewards come with the spawner.

| In the editor | `kind` | `noun` | Creatures |
|---|---|---|---|
| Green buff (Power) | `buff` | `SpawnPoint_v5_Buff_Fish.Noun` | 2 small fish, a big one |
| Blue buff (Haste) | `buff` | `SpawnPoint_v5_Buff_Fungus.Noun` | 2 small mushrooms, a big one |
| Orange buff (armor) | `buff` | `SpawnPoint_v5_Buff_Ugger.Noun` | a small Ugger, a big one |
| Fish camp | `camp` | `SpawnPoint_v5_CreepsFish.Noun` | 3 fish |
| Mushroom camp | `camp` | `SpawnPoint_v5_CreepsFungus.Noun` | 4 mushrooms |
| Ugger camp | `camp` | `SpawnPoint_v5_CreepsUgger.Noun` | 2 Uggers |
| Gold Pigs | `buff` | `SpawnPoint_v5_CreepsBoar.Noun` | 2 boars; the kind is `buff` so the bots treat them as a big camp, but they give no buff |
| Parasite | `parasite` | `SpawnPoint_Objective_Titan.Noun` | the objective; one on a map, no mirror |

## The check's rules

The editor runs the check after every edit, and a map that fails a rule (an **error**) doesn't build. A **warning**
doesn't stop the build but points at something that plays badly. Each finding names the place in `map.json` it
concerns (`base.spawns[2]`, `terrain.shapes[4]`, `lanes[0].knots[3]`; for something the compiler places, its
source: `base.bindings` for an automatic Binding) and the position on the map where there is one. Team 1's side is
checked; team 2's is its mirror.

### The file and its values

These run first; the layout rules run only when they pass.

| Rule | It fails when | What to do |
|---|---|---|
| `format.version` | `format` isn't 1 | set `"format": 1` |
| `format.json` | the file isn't valid JSON, or has a member the compiler doesn't know | fix the JSON (a comma, a quote) or remove or rename the member |
| `names.name` | the name has other characters than letters, digits and `_`, or is longer than 80 | rename the map |
| `names.shipped` | the name is an original map's (in any case), or a level the game has | pick another name |
| `names.unique` | another package in the maps folder has the name | rename one of them |
| `names.tag` | the tag has other characters than lower-case letters and digits | fix the tag |
| `names.tag-unique` | the tag is `sm`, `mm` or another package's | pick another tag |
| `names.display` | the display name is empty or longer than 13 characters | shorten it (the game cuts longer names) |
| `names.prefix` | the prefix is longer than 16 characters | shorten it |
| `size.max` | the size is 0 or over 600 m | pick a size up to 600 |
| `size.bounds` | an authored point (an object, a knot, a shape's point, a prop) is less than 2 m inside the edge | move it in, or make the map bigger |
| `symmetry.kind` | `symmetry` isn't `"point"` | set `"symmetry": "point"` |
| `symmetry.half` | an authored point lies on team 2's side (x + y > 0), or a shape's centre more than 0.5 past the diagonal | author it on team 1's half: its mirror appears on team 2's |
| `symmetry.base` | the Guardian isn't in the south-west (x < 0, y < 0) | move team 1's base to the south-west |
| `symmetry.lanes` | lane 2 isn't lane 1 mirrored and walked back (within 0.5 m), or has another width | move the knots in pairs (the editor does it) and give both lanes one width |
| `refs.environment`, `refs.tuning` | the value isn't `SM_Map_v5` or `MM_Map_v3`, or the game copy lacks that level | use one of the two |
| `ground.style` | `ground.style` isn't `tiled` or `baked` | fix the style |
| `ground.width`, `ground.range`, `ground.along` | a `lanes` layer's `width` outside 2-120 m, an `edge` layer's `range` not `[from, to]` with from < to within -20 to 60 m, `along` not `walls` or `chasms`; a warning when another rule's layer has one (it isn't read) | fix the value, or remove it |
| `lanes.count` | the map has no lane or more than two | one or two lanes |
| `lanes.ids` | a lane id isn't 1 or 2, or appears twice | use 1 and 2 once each |
| `lanes.width` | a lane is narrower than 6 m or wider than 80 m | set the width between 6 and 80 |
| `lanes.knots` | a lane has fewer than 2 or more than 16 knots, or a knot within 1 m of the one before | add, remove or move knots |
| `fixed.spawns` | the base hasn't exactly 5 spawn points | five spawn points |
| `fixed.cores` | `cores` isn't `"auto"`, 5 points or 3 points | fix the list, or *Back to "auto"* |
| `fixed.bindings` | the Bindings aren't 3 (or 2) per lane, the same count on every lane, for the map's lanes only | fix the lists, or *Back to "auto"* |
| `budget.wells` | fewer than 1 or more than 8 wells on the map (so more than 4 authored) | add or remove wells |
| `wells.kind` | a well's `kind` isn't `well` or `mine` | fix the kind (or leave it out: a well) |
| `camps.kind` | a camp's kind isn't `camp`, `buff` or `parasite` | select the camp and choose its *Type* |
| `camps.noun` | a camp has no noun, or one that isn't one of the original map's camp spawners | select the camp and choose its *Type* |
| `camps.parasite` | a second parasite camp (an error), or the parasite more than 30 m from the centre (a warning: it isn't mirrored, so it favours one team) | keep one parasite, near the centre |
| `camps.role` (warning) | a `buff` camp's noun has no Buff or Boar in its name, or a `camp`'s has | choose the camp's *Type* again (it sets both), or the bots treat the camp wrongly |
| `terrain.default` | `terrain.default` isn't `wall`, `open` or `chasm` | fix the value |
| `terrain.shape` | a shape's type is unknown, it hasn't exactly one geometry, a circle has no `r`, a polygon fewer than 3 corners, a path fewer than 2 points or no width, it names a lane the map hasn't, a bush is a lane or a path, an island is a lane | fix the shape in the selection's info (its JSON under Advanced) |

**Props, groups and scatter:**

| Rule | It fails when | What to do |
|---|---|---|
| `props.kind` | a prop has both or neither of `noun` and `group` | one of them |
| `props.scale` | the scale is under 0.05 or over 20 | set a scale in that range |
| `props.footprint` | a footprint side is 0 or over 100 m (an error); a blocking prop's footprint is unknown without the game copy (a warning) | set the footprint, or *From the model's box* |
| `props.blocks` | a group blocks or has a shadow | groups can't: draw a wall where it should block |
| `props.group` | a group's level or sets don't exist, its radius isn't over 0 and up to 80 m, a hole isn't a polygon (an error); some of its markers aren't dressing and are left out, or nothing is left (a warning) | fix the group in the paste dialog |
| `props.tilt` | a tilt is beyond ±180 degrees, or set on a group | fix the tilt |
| `props.type` | a noun isn't dressing (a creature, a tower, a spawn point) | use dressing only; creatures come from camps |
| `props.shadow` (warning) | a prop with a shadow card has no box for the card | turn the card off |
| `props.flush` (warning) | a model's top lies at the floor, so it flickers in the game | lift it: the message gives the height (the editor lifts it for you) |
| `scatter.nouns`, `scatter.along`, `scatter.spacing`, `scatter.inset`, `scatter.scale`, `scatter.max`, `scatter.region` | a scatter has no nouns, `along` isn't `walls` or `area`, the spacing is under 1 m, the inset outside 0-10 m, a bad scale range, more than 1,000 props, or its region isn't a circle or a polygon | fix the scatter in the selection's Advanced section |
| `scatter.on`, `scatter.footprint`, `scatter.density` | a filled area's `on` is none of `any`, `walls`, `off-ground`, `ground`; the footprint isn't over 0 and up to 20 m; the density isn't over 0 and up to 1 (errors). Set on a scatter along the walls, or a footprint without `blocks`, they are warnings: not read; so is `inset` on a filled area | fix them in the region's info |
| `scatter.decor` (warning) | a fill on walkable ground without `blocks` has no plant among its nouns, so it places nothing | add a plant, tick *Block*, or fill other ground |
| `scatter.empty` (warning) | a scatter places nothing: no wall edge in its region, or no free ground of the kind it fills | move the region, or change *Where* |
| `nouns.exist` | a camp's, prop's or scatter's noun isn't one of the game's models | pick one from the palette |

**The void:**

| Rule | It fails when | What to do |
|---|---|---|
| `void.cut` | the cut isn't 0 or 0.5-50 m | set a cut in that range |
| `void.backdrop` | a cut without a backdrop (the game would show stale pictures where nothing is drawn), the backdrop's z outside −150 to −1 m, its scale outside 1-1,400 m, or a bad texture | add a backdrop, or fix its values |
| `void.mist-floor` | the mist is at or above z 0, the walkable floor | lower the mist below 0 |
| `void.mist` | the mist is below the backdrop or below −150 m, its range outside 0.5-1,000 m, or a colour component outside 0-2 | fix the mist |
| `void.mist-unlit` (warning) | a mist over an unlit backdrop: the mist can't tint it | light the backdrop, or drop the mist |
| `void.mist-ford` (warning) | a ford's water lies deep under the mist, so the mist tints it | raise the water or the mist |
| `void.fog` | the fog's start is below its end, either is beyond ±1,000 m, or a colour component outside 0-1 | fix the fog |

**Water and the graph:**

| Rule | It fails when | What to do |
|---|---|---|
| `terrain.height` | a height on a shape that isn't a wall or a chasm (walkable ground stays level), a wall's outside 1-40 m, a chasm's outside −40 to −1 m | heights only on walls and chasms, in range |
| `terrain.height-hide` (warning) | a wall so tall that, from the game's camera (it looks north, the top of the view 36.5° down), it can hide a 2-m character on walkable ground north of it; walls up to 5.4 m never do | lower the wall where it meets walkable ground, or move its tall part back (the message says how far) |
| `terrain.height-void` (warning) | a chasm deeper than the void's backdrop, which then covers its bottom | lower the backdrop, or make the chasm shallower |
| `terrain.height-step` (warning, on a map with heights) | a chasm cut straight into a wall: away from walkable ground the ground drops from the plateau to the chasm's floor in one step (the message gives the drop), a vertical face the game draws as a dark pit with a stepped rim | draw an `open` shape under the chasm, a few metres wider, so walkable ground rims it where it meets the wall |
| `terrain.water` | water on a shape that isn't a chasm, its z out of range, an unknown mask (an error); a chasm whose ground never drops below its water, so no water shows (a warning) | water only in chasms; deepen the chasm or raise the water |
| `terrain.water-overlap` (warning) | two watered chasms' water overlaps (drawn twice) | separate them, or water one of them |
| `graph.cell` | a set `graph.cell` outside 2-4 | 2, 3 or 4, or leave it out |
| `graph.areas` | the set cell gives a graph more than 10,000 areas | a bigger cell, or leave it out |

### The layout

These run on the compiled layout and its walking graphs.

| Rule | It fails when | What to do |
|---|---|---|
| `fixed.open` | an object (the Locus, the Guardian, the shop, a spawn point, a Core, a Binding, a minion spawner, a well, a camp) stands on a wall or in a chasm (a well may stand on an island) | move it onto open ground, or open the ground under it |
| `fixed.hole` | something but the Guardian and the Cores stands within about 10 m (plus a square) of a Guardian, where the walking graph has its hole | move it away from the Guardian |
| `fixed.range` | a Binding is too far from its lane to cover the corridor (its distance plus half the corridor's width over 31 m) | move the Binding nearer the lane, or narrow the lane |
| `fixed.tiers` | along the lane from the own base the Bindings aren't Inner, Middle, Outer in that order, or the Outer (with two tiers the Middle) lies past the lane's middle | reorder or move the Bindings |
| `lanes.graph` | a knot, or the straight line between two knots, leaves the creatures' walking graph; the message says why where it can (which shape is too narrow and how wide it must be, or that the ground is cut off) | widen the lane's corridor, or move the knot off the wall |
| `lanes.start` | a lane's minion spawner (21 m behind its first knot) isn't on the walking graph next to the first knot | move the first knot, or open the ground behind it |
| `lanes.end` | a lane's last knot is more than 25 m from an enemy Core or the enemy Guardian, so the minions stop short | end the lane at the enemy base |
| `reach.islands` | the two bases' first spawn points aren't joined by walkable ground | open a way between the bases |
| `reach.player` | an object (but the Guardian, the camps and the wells on islands) can't be walked to from the bases | open a way to it |
| `reach.npc` | a well's workers' ring or a camp isn't on the creatures' walking graph; the message says why: the shape under it is too narrow, with its width and the width it needs (see *How wide a path must be*; clicking the finding selects that shape), or its ground is cut off from the bases. The editor warns while you place or drag a camp or well there | widen the path under it, or put the camp in a clearing (its creatures stand up to about 9 m round it) |
| `reach.dropped` (warning) | walkable ground that nothing joins to the bases; it's left out of the graphs (the editor draws each cut-off part) | join it to the rest with a path wide enough for the graphs, or make it a wall |
| `reach.narrow` (warning) | walkable ground too narrow for any graph square (a thin path, a narrow gap between props), so nobody walks it; the message gives the widths for the map, and the editor draws each part and shows the ground red | widen it, or make it a wall |
| `reach.island` | a well on an island is within 12 m of ground champions walk (an error: they could take it without a fight), or within 39 m (a warning: a dash reaches it) | move the well or the island's edge away |
| `terrain.edge` (warning) | open ground or a chasm within 4 cells of the map's edge | keep a wall along the edge |
| `budget.areas` | a walking graph has 7,000 areas or more even at the largest squares | simplify the layout: fewer small gaps and shapes |
| `budget.bush` | a bush is under 6 cells (an error), or lies mostly off walkable ground (a warning) | make it bigger, or move it onto open ground |
| `wards.budget` | more than 16 ward spots | remove some |
| `wards.axis` | a ward spot has a coordinate of exactly 0 | move it off the axis a little |
| `wards.reach` | a ward spot isn't on open ground joined to the bases | move it onto reachable ground |
| `wards.centre` (warning) | a ward spot within 60 m of the centre: only a Hunter wards there | move it out, if other roles should ward it |

### At the build

These come with the build's report, from the placed markers:

| Rule | It fails when | What to do |
|---|---|---|
| `wells.spots` (warning) | some of a well's worker spots (about 22 m round it) are on blocked ground | give the well a clearing of about 26 m |
| `camps.spots` (warning) | some of a camp's creature spots (up to about 9 m round it) are on blocked ground | give the camp more room |

## Tips

- Start from a template: it passes every rule, so each finding afterwards is about your change.
- Give a chasm with water about 10 m of shore inside its clearing.
- Draw paths at least as wide as *paths* in the map's facts says (about 8 m, 11 m at an angle, on a 450-m map):
  thinner ones are only pictures. The editor's line beside the mouse turns red while a path is too thin.
- A blocking tree wants a footprint of its trunk (about 2 x 2 m), not of its crown.
- Pieces of the original map's cliffs float over open ground: take dressing from its floor.
- Test early: the bots' rally points and the Hunter's route under the check show where a change makes the map uneven.

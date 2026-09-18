---
sessionId: session-260915-213954-126b
---

# Requirements

### Overview & Goals
Two new tools on the **Maps page**, as buttons in the CalTopo map card's header next to *Fetch Shapes*:

1. **Auto Draw Segments** — pick one CalTopo polygon (an Assignment or a Shape) from the fetched shapes, choose
   how it is sliced (**vertical**, **horizontal** or a **custom angle** typed into a value pill before confirming),
   and have the app cut the area into equal slices of **at most 15 acres and at least 10 acres** — as many as it
   takes to fill the shape — and draw the slices on the CalTopo map as new shapes.
2. **Trim Tracks** — open a popup listing the routes / tracks on the CalTopo map. For every track a row of pill
   buttons shows how much of the track lies in which segment and how much lies outside every segment. The
   planner clicks the pills to select the parts to remove (on as many tracks as wanted) and confirms; the
   selected parts are cut out of the tracks on CalTopo. A track that ends up in several pieces becomes several
   tracks named `<original> p1`, `<original> p2`, … (p = part).

### Rules (as requested / decided)
- **Slice sizes.** `count = ceil(total acres / 15)`, every slice `total / count` acres (equal areas). This is the
  fewest slices that keep every slice at or under 15 acres; with a total of 30 acres or more it also keeps
  every slice at or above 10 acres. A shape of 15–20 acres (or under 10) cannot be cut into 10–15 acre pieces:
  the popup preview says so (“under the 10-acre minimum”) before the planner confirms.
- **Slice direction.** *Vertical* = north–south cut lines, slices numbered west → east. *Horizontal* =
  east–west cut lines, numbered north → south. *Custom* = the angle of the cut lines in degrees clockwise from
  north (0° = vertical, 90° = horizontal). The cut positions are found by bisection on the area left of each
  cut line, so every slice has the same area whatever the shape.
- **Names.** Slices are `<source name>-1`, `<source name>-2`, … in sweep order. A concave shape can leave a
  slice in two disconnected pieces; each piece becomes its own numbered shape (north-most first).
- **Object class.** Slices are POSTed as CalTopo **Assignments** first (so they are importable as segments on
  this very page) and as **Shapes** when CalTopo refuses the Assignment class. They copy the source shape's
  style (stroke / fill / opacity / width) and folder. The source shape is left on the map.
- **Trim parts.** The track is cut where it crosses a segment shape's edge (same clipping as the Searchers
  Tracks miles); a piece is *in* a segment when its midpoint is inside that segment's shape (a piece inside two
  overlapping segments is removed when either is selected), *outside* when in none. Removing a piece splits
  the track. One piece left → the track is updated in place (same id, same name). Several pieces → new
  `Shape` lines `<name> p1…pN` are created, then the original is deleted (if the delete fails, the planner is
  told to delete it by hand). Nothing left → the track is not touched (the popup refuses the selection).
- **Case bookkeeping.** The case's copy of the map (`maps[0].features`) is updated at once (new pieces appended,
  a trimmed track's geometry replaced, a split track replaced by its parts) and a quiet re-fetch follows. An
  imported searcher track that is trimmed is re-measured; a split one is replaced by one record per part, each
  keeping the planner's task pick and import stamp (`saveSearcherTracksChange`, so the PSR maths follow).

### Out of scope / deliberately left
- Holes in polygons are ignored (outer rings only); MultiPolygon / GeometryCollection sources are cut ring by ring.
- The 10 / 15 acre bounds are fixed constants (`AUTO_DRAW_MIN_ACRES` / `AUTO_DRAW_MAX_ACRES`).
- Trimming keeps per-point extras (altitude / time) by linear interpolation at the cut points; a parallel
  `timestamps` property, if CalTopo ever sends one, is dropped from the pushed properties.

# Technical Design

### `map-segment-utils.js` (pure, shared with tests)
- Auto draw: `AUTO_DRAW_MIN_ACRES`, `AUTO_DRAW_MAX_ACRES`, `computeAutoDrawSliceCount(totalAcres)`,
  `splitRingsByVerticalLine(rings, x)` (planar; the classic split-by-line walk: intersections paired along the
  line, boundary walked on the kept side; vertices on the line are avoided by nudging `x`),
  `planAutoDrawSegments(feature, {angleDegrees})` → `{ok, reason, totalAcres, count, acresEach, undersized,
  angleDegrees, pieces: [{ring (closed lng/lat), acres, strip, index}]}`, `buildAutoDrawSegmentName(base, i)`.
  Plane: the `polygonAreaAcres` projection (69.172 mi/°, `cos(latRef)`), rotated so the cut lines are vertical.
- Trim: `slicePathBySegments(path, segments)` → pieces `{points, keys, miles}` (consecutive same-membership
  sub-legs merged), `summarizeTrackPortions(paths, segments)` → `[{key, miles}]` (`''` = outside),
  `trimTrackPaths(paths, segments, {segmentKeys, outside})` → `{parts, removedMiles, keptMiles}`,
  `buildTrimmedTrackPartName(base, i)`.

### `app.js`
- Maps page header: `#auto-draw-segments-btn` → `openAutoDrawSegmentsTool(btn)` → `showAutoDrawSegmentsPopup(areas)`
  → `drawAutoDrawSegments(feature, plan, options)`; `#trim-tracks-btn` → `openTrimTracksTool(btn)` →
  `showTrimTracksPopup(features)` → `trimCalTopoTracks(selections)`. Both fetch the shapes quietly when none
  are in the case yet.
- CalTopo writes: `createCalTopoMapFeature(map, objectTypes, geometry, properties)` (POST
  `/api/v1/map/<id>/<class>` — no object id — GeoJSON Feature; `extractCalTopoCreatedId` reads the id from
  `{status, result}`), `updateCalTopoMapFeatureGeometry(map, feature, geometry)` (POST to the object id under the
  reported class then Shape, as the rename does), `deleteCalTopoMapFeature(map, feature)` (DELETE, same
  candidates). `reloadMapsPageIframe()` bumps the iframe URL after a write.
- Trim bookkeeping: `getTrimTrackSegments(bundle)` (Segments rows with a CalTopo area shape via
  `findFeatureForSegmentRow`), searcher-track records via `buildSearcherTrackRecord`.

### `styles.css`
`.map-tool-*` popup layout, `.auto-draw-*` (feature list, direction pills, angle pill, preview), `.trim-*`
(portion pills; `.is-removed` = struck-through red tint).

# Testing
- `test_maps_auto_draw_trim_tracks.js`: pure maths (slice count table, vertical split of a square / a C shape
  into two pieces / vertex on the line, equal-area slices of a rectangle in all three directions with area
  preserved and pieces ordered, MultiPolygon, non-area → `no-area`; portions and trims of a path through one
  square, two adjacent squares, extras interpolated); `app.js` in a vm sandbox with `caltopo_api_call` recorded
  (draw → N Assignment POSTs + fallback to Shape, case copy updated, log entry; trim → in-place POST with the
  trimmed line and the track re-measured; split → two Shape creates + one DELETE, records replaced with the pick
  kept); popups built from the fake DOM (rows, pills, confirm). Static: the two buttons are in `buildMapsPage`.
- `npm test` chain (new suite appended to `package.json`), `node --check app.js`.

# Delivery Steps

### ✓ Step 1: Shared maths (`map-segment-utils.js`)
### ✓ Step 2: `app.js` — CalTopo write helpers, Auto Draw Segments popup/flow, Trim Tracks popup/flow, Maps page buttons; `styles.css`
### ✓ Step 3: Tests (`test_maps_auto_draw_trim_tracks.js`, 16 checks), `package.json`, `?v=20260923`, AGENTS.md §3/§5/§7/§8

Notes from the build: a split's part names are the track's name **without** the Search Log's `#task-segment ` code
(`parseSearcherTrackName(...).baseName`), so the rename sync can put each part's own code on it; a path nothing is
cut from comes back untouched from `trimTrackPaths` (no cut points added); a kept stretch that spans two segments
keeps the vertex at their shared edge (a legitimate point on the line).

---

# Round 2 — multi-select Auto Draw with a target acreage and auto-import, Merge Segments, several segments per task

## Requirements (as requested / decided)

**Auto Draw Segments (extended)**
- Several source polygons can be checked at once (checkboxes instead of the radio); each is cut and drawn in turn.
- A small **"Target acres per segment"** box: empty → the 10–15 acre rule as before; a number → the division
  (floor or ceil of `total / target`, at least 1) whose slices come **closest to the target** is used; the 10-acre
  warning is replaced by a note of the resulting slice size.
- After the slices are drawn they are **imported as segments at once**, into the **region of the Segments row the
  source shape belongs to** (the row carrying the shape's CalTopo id in column 9, else the row named like the
  shape); that source row is **removed** from the Segments page. A source without a Segments row is imported with
  no region (the planner picks one on the Segments page).
- The source shape on CalTopo is **moved into a folder named `Regions`** — created on the map when missing with
  "visible on map open" and labels **off**, so it is hidden by default — and marked unwanted in the case so the
  unaccounted panel and the New Assignment notifications stay quiet about it.
- Tasks on the source segment: every Search Log row of the source becomes **one row per new segment** (same
  task #, date, time, team, sweep width and sweep count); the team's assignment label is rebuilt from the rows.
  Imported searcher tracks are re-measured against the new segments.

**Merge Segments (new button beside Auto Draw / Trim Tracks)**
- The popup lists the Segments rows that have a CalTopo area shape. Checking one grays out every segment that is
  not a **neighbor** (shares an edge / touches / overlaps within ~30 ft) of *some* checked segment, and every
  segment of **another region** (merging across regions is refused — decided with the planner); more segments can
  be checked while neighbors remain. A **name box**, prefilled with the checked names joined by `+`, is editable.
- Confirm: the **exterior outline of the union** is created on CalTopo as an Assignment (else Shape) named as
  typed, in the first checked segment's style and folder; the old shapes go to the hidden `Regions` folder and are
  marked unwanted (decided with the planner). In the case: one Segments row replaces the merged rows (region kept,
  area / length from the outline, sweep width of the first row, CalTopo id of the new shape); the Search Log rows
  of the merged segments collapse to **one row per task #** for the new segment (the first row's date / time /
  team / sweep width / sweep count); assignment labels are rebuilt; tracks are re-measured.

**Several segments in one task #**
- A task # may own several Search Log rows — one per segment; Task #, Date, Time and Team identical on all of
  them. Creating one: the Personnel page's *Assign New Task* dropdown becomes a **multi-select checklist**; the
  Segments page's *search* button → after the team is picked a popup offers **the other segments** to add to the
  same task (Skip = just the one).
- Search Log table: the rows of a task are kept together; the **first row's Task #, Date, Time and Team cells span
  the group** (`rowspan`), each as one rounded rectangle stretching over the rows; Region … Num of Sweeps and
  Delete stay per row. A Date / Time edit applies to every row of the task; Delete removes that segment's row (the
  task's last row also ends the team's assignment, as before).
- PSR maths stay per row; with Map Tracking on, a row's miles are the miles allocated to its task **inside that
  row's segment**.
- Task Assignment form: a read-only **"Assigned Segments"** field listing the task's segments (from the log rows);
  the printout's Region/Segment field lists them too; Manage Forms lists every segment of a task.
- *Log sweeps* asks per row (the segment is shown); the "Fill Form" notification is one per task.

**Out of scope / decided**
- A sticky footer with the hovered segment's info: **not possible** — the CalTopo map is a cross-origin iframe
  and its embed has no hover API — skipped per the planner.
- Union holes: the outline keeps the **outer ring only**; the neighbor tolerance is a constant.
- The Search Log's mobile card layout shows a task's later rows without the spanning cells (follow-up).

## Technical Design

### `map-segment-utils.js`
- `computeAutoDrawSliceCount(total, {targetAcres})`: with a target, `count` = whichever of `floor` / `ceil`
  (`total / target`) brings `total / count` closer to the target (≥ 1); the result carries `targetAcres`.
  `planAutoDrawSegments(feature, {angleDegrees, targetAcres})` passes it through.
- Union (planar, miles, the `polygonAreaAcres` plane of the first vertex): `unionPolygonOutline(polygons,
  {toleranceMiles})` → `{ok, ring (closed lng/lat), acres, ringCount}` — weld vertices within the tolerance
  (vertex ↔ vertex, then vertex ↔ edge by splitting the edge), split edges at proper crossings, drop edges whose
  midpoint lies strictly inside another polygon and edges shared by two polygons, chain what is left into rings,
  keep the largest ring, drop collinear vertices. `polygonsAreNeighbors(a, b, toleranceMiles)` (edges cross, a
  vertex inside the other, or boundaries within the tolerance), `MERGE_NEIGHBOR_TOLERANCE_MILES = 0.006`.
- `getTaskTrackMiles(allocation, tag, region, segment)`: portions filtered to the segment when one is given.
- Labels: `buildTaskAssignmentLabel(taskNumber, pairs)` → `#N Region - A, B` (grouped by region, `; ` between
  regions), `parseTaskAssignmentLabel(label)` → `{taskTag, pairs}`.

### `app.js`
- Search Log helpers: `getTaskSearchLogRows(bundle, tag)`, `getTaskSegmentPairs(bundle, tag)`,
  `rebuildTeamAssignmentLabels(bundle)` (every `currentAssignments[team]` carrying a `#N` is rebuilt from the
  rows), `describeTaskSegments(bundle, tag)`.
- Assignment: `assignSearchTaskToTeamSegments(teamName, pairs, stamp)` (the old `assignSearchTaskToTeam` wraps
  it); `addAutoSearchLogEntry(teamName, pairs)` pushes one row per pair. `buildSegmentChecklist(segments,
  options)` is the shared checklist dropdown (Personnel popup, Segments page `showAdditionalSegmentsPopup`).
- Search Log table: `groupSearchLogRowsByTask(sortedData)`; the first row of a group gets `td.task-span-cell`
  cells with `rowSpan` for columns 0, 1, 2, 7; date / time edits fan out to the group; Delete per row.
- `recalculateEverything`: the "map back" loop goes (rows are mutated in place; it copied the first row's PSR onto
  every row of a task); per-row track miles. `calculatePSRAfter`, `appendTrackMilesTag` likewise.
- Auto Draw: checkboxes, `#auto-draw-target-acres`, per-shape preview lines; `drawAutoDrawSegments(feature,
  plan)` → `applyAutoDrawToCase(feature, created, plan)` (rows, tasks, tracks, unwanted, labels; saved through
  `saveSearcherTracksChange`); `ensureCalTopoRegionsFolder(map)` (folders captured as `map.folders` by
  `caltopo_request`; `POST …/Folder {title: 'Regions', visible: false, labelVisible: false}`),
  `moveCalTopoFeatureToFolder(map, feature, folderId)` (the whole fetched feature with `folderId`, class then
  Shape).
- Merge: `#merge-segments-btn` → `openMergeSegmentsTool(btn)` → `showMergeSegmentsPopup(candidates)` →
  `mergeSegmentsAction(candidates, name)`; candidates via `getMergeableSegments(bundle)`.
- Forms / Manage Forms / notifications / `showLogSweepsPopup(tag, {region, segment})`: per task segments.

### `styles.css`
`.task-span-cell` (the pill stretches over the rowspan), `.segment-checklist` dropdown, `.merge-*` popup rows
(`.is-disabled` grayed), `.auto-draw-target-wrap`.

## Testing
- `test_maps_merge_multi_segment_tasks.js` (new): union of two adjacent squares = a 2 sq mi rectangle with four
  corners; overlapping squares; the slices of a rectangle union back to it; neighbors (touching, a gap under /
  over the tolerance, far apart); target-acre counts; label build / parse; vm: a two-segment assignment (rows,
  label, activity log); the Search Log table's spanning cells; auto draw with import (rows, source row gone, task
  rows fanned out, Folder POST + move, unwanted); merge (create POST, moves, rows replaced, tasks collapsed).
- `test_maps_auto_draw_trim_tracks.js` updated for the auto-import (unaccounted list, Segments rows).
- `npm test`, `node --check app.js`.

## Delivery Steps

### ✓ Step 4: `map-segment-utils.js` — target-acre count, union / neighbors, per-segment track miles, assignment labels
### ✓ Step 5: `app.js` — several segments per task (assignment path, checklist popups, Search Log grouping / rowspan, PSR / track miles, forms, sweeps, notifications)
### ✓ Step 6: `app.js` — Auto Draw: multi-select, target acres, auto-import into the source's region, source row removed, Regions folder, tasks / tracks re-pointed
### ✓ Step 7: `app.js` — Merge Segments button, popup, action; `styles.css`
### ✓ Step 8: tests (new suite + updated suite), `package.json`, `?v=20260924`, AGENTS.md §3 / §5 / §7 / §8

Notes from the build (round 2): the `?v=` stamp was already `20260924` (bumped by the concurrent LPB session, whose
`app.js` / `styles.css` / `map-segment-utils.js` edits landed alongside these without a clash); `npm test` runs 33
suites green (`test_maps_merge_multi_segment_tasks.js` is the 33rd, 15 checks). `test_custom_search_task.js` still
fails on its pre-existing `'' vs '40 ft'` assertion (AGENTS.md §8; not in the chain). The Search Log's activity-log
describer (`PAGE_DATA_LOG_INFO.page4`) is now keyed by task + region + segment so a deleted row's sibling is not
logged as a "changed segment". The sync layer (`sync-delta.js`, index + `previous`-row identity; `search_log` table
by `row_index`) never keyed rows by task number, so several rows per task needed no change there.

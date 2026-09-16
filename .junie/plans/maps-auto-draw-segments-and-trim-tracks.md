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

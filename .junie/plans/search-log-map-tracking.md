---
sessionId: session-260914-213912-1jgx
---

# Requirements

### Overview & Goals
Search Log page: a **"Map Tracking"** switch in the same row as the "Newest First" switch, right-aligned.
When it is on, the searchers' GPS tracks imported from the CalTopo map drive the PSR maths instead of
the typed *Num of Sweeps*: for every task the miles of track that lie **inside the task's segment** stand in
for `Num of Sweeps × segment length` in the coverage term of the PSRc / PSR-after formula. The Num of Sweeps
column fades out and each task row shows a small tag with the miles tracked inside its segment. A
**Searchers Tracks** table below the Search Log lists the imported tracks (name, type, length, length per
segment as pills, delete), lets the planner import / refresh tracks and settle ambiguous ones.

### Rules (as requested)
- A track's **home segment** is the segment holding the majority of its miles; the track's progress goes
  to the task # of that segment. Miles the track spent in *another* segment go to the **most recent task #**
  of that segment (or to the next task # in that segment once it exists); miles outside every segment
  count for nothing. Only miles inside a segment count — leaving and re-entering is handled by clipping.
- Two (or more) task assignments to the same home segment make the track **ambiguous**: a red **?** shows
  on the track's *Length per Segment* cell and on the Task # of every candidate task; clicking it lets the
  planner choose the task # (until then the latest task of that segment gets the miles).
- **Track names** are prefixed with the task # and segment — `#2-4D <name>` — and the rename is forwarded
  to CalTopo. The code is recognised (`#<n>-<segment> `) and never stacked: a re-fetched `#2-4D Team 1`
  keeps the base name `Team 1`; a new assignment replaces the code.
- Formula term naming (follow-up): in Map Tracking mode the "Num of Sweeps" term reads as **Tracks**
  (column header `Tracks (mi)`, tag `1.23 mi`); the maths uses the track miles in that term.
- **Team count not used** (follow-up): with Map Tracking on the track miles replace the whole
  `length × numSweeps × numMembers` product — those three only ever estimated the miles walked.
- **Sweep-count reminders off** (follow-up): with Map Tracking on `getLogSweepsDue()` is empty, so the
  Search Log nav badge, the Segments page "log sweeps" button/row highlight and the "Log Sweeps"
  notification/toast are all off; the custom-search "finished" toast says the tracks count instead.
- **Dark red tracks on CalTopo** (follow-up): while PSRc Assignment Colors is on, every imported track is
  pushed with stroke `#8b0000` (`CALTOPO_IMPORTED_TRACK_COLOR`); its own style is captured in
  `caltopoAssignmentOverlayState.originals` and put back when the colors go off or the track is deleted.
- **Custom Track** (follow-up): a button in the Searchers Tracks card opens a form — name, miles, task #
  (dropdown of the Search Log tasks, newest first). Stored as a track record with `custom: true`, type
  `Custom`, every mile in the task's segment and the task as its pick; never re-measured, renamed or
  recolored on CalTopo.
- **Maps page** (follow-up): a fetched line already in the Searchers Tracks table is *accounted for*
  (`isFeatureImportedAsTrack`), so it leaves the unaccounted list and shows "Imported" in Fetch Shapes.
  Import destination by type (`getFeatureImportTarget`): only CalTopo **Assignments** → Segments, only
  **routes / tracks** → Searchers Tracks; markers, plain shapes and other are not importable. The
  unaccounted panel is three tables (assignments with the Segments columns; routes with the Searchers
  Tracks columns — proposed `#task-segment` name, type, length, miles per segment as pills; the rest with
  name/type/id and no checkbox). Import Selected, the Fetch Shapes popup and the Features tab route each
  shape to its destination.
- Switch off → the Num of Sweeps entries are used again exactly as before (tracks stay listed).

### Formula
Today: `z = sweepWidth / ((area / 640 / length / numSweeps / numMembers) × 5280)`; `share *= e^-z`.
Map Tracking on: `z = sweepWidth / ((area / 640 / trackMiles) × 5280)` where `trackMiles` is the task's
allocated track mileage (home portions of its tracks + spill-over portions handed to it + custom tracks).
A task with no track miles yet decays nothing. `numMembers` is **not** used (follow-up: the tracks replace
`length × numSweeps × numMembers` together). The same replacement applies in `calculatePSRAfter` (row blur)
and the charts' `calculateHourlyMetrics`. Shared term: `calculateSearchCoverage` in `app.js`.

### Out of scope / deliberately left
- Time-based matching of tracks to tasks (only geometry + the planner's pick decide).
- Linear (LineString) assignments have no area: a track inside one is not measured (0 mi).
- Overlapping segment shapes count a shared stretch for both segments.
- Plain polygon Shapes (not CalTopo Assignments) can no longer be imported as segments from the Maps page
  (the request: only Assignments → segments). The Segments page's own import paths are untouched.
- A custom track cannot be edited in place (delete and add again).

# Technical Design

### Bundle
- `mapTrackingEnabled: boolean` (case-wide, default `false`) → `settings_page`.
- `searcherTracks: [{id, featureId, baseName, caltopoName, type, lengthMiles, pointCount,
  segmentMiles: [{region, segment, miles}], assignedTask, importedAt, importedBy, evaluatedAt}]` → new
  collection table `searcher_tracks` (one row per track). The geometry itself stays in `maps[0].features`;
  the per-segment split is measured at import / refresh and stored, so every device computes the same PSR
  without redoing point-in-polygon work on every recalculation.

### `map-segment-utils.js` (pure, shared)
`getLineStringPaths`, `isTrackLikeFeature`, `getTrackTypeLabel` ('Track' for AppTrack/LiveTrack classes or
timestamped points, else 'Route'), `pathLengthMiles`, `pointInPolygonRings` (even-odd, holes),
`pointInAreaGeometry` (Polygon / MultiPolygon / GeometryCollection), `measurePathInsideGeometryMiles` (splits
every track leg at the polygon edges it crosses, keeps the pieces whose midpoint is inside),
`measureTrackMilesBySegment(feature, segmentRows, features)`, `parseSearcherTrackName(name, segmentNames)`,
`formatSearcherTrackName`, `normalizeSearcherTrack(s)`, `searchLogRowTimestamp`,
`allocateSearcherTracks(tracks, searchLogRows)` → `{byTask, tracks: [{id, home, homeTasks, task, ambiguous,
portions, displayName}], ambiguousTasks}`.

### `app.js`
- `defaultBundle` / `sanitizeBundle` carry both keys; `recalculateEverything`, `calculatePSRAfter`,
  `calculateHourlyMetrics` use `getTaskTrackMiles(allocation, task)` when tracking is on.
- Search Log page: `#map-tracking-toggle` (page4.html `.tool-actions`) bound in `buildSearchLogTable` →
  `setMapTrackingEnabled`; header `Tracks (mi)`; column 9 cells `.map-tracking-faded` (not editable) with a
  `.track-miles-tag`; `.track-question-badge` on ambiguous Task # cells.
- Searchers Tracks card (`#searcher-tracks-card`, page4.html): `renderSearcherTracksTable()`; buttons
  `Import Tracks` (`importSearcherTracksAction` → silent `caltopo_request` → `showSearcherTracksImportPopup`)
  and `Refresh Tracks` (`refreshSearcherTracks`); per-row Delete (`removeSearcherTrack`); the `?` opens
  `showSearcherTrackTaskPicker` → `assignSearcherTrackTask`.
- Every change goes through `saveSearcherTracksChange(bundle)` (deferred save → `recalculateEverything
  ({colorSyncDelay: 0})` → flush) and then `syncSearcherTrackNamesToCalTopo()` (POST
  `/api/v1/map/<id>/<class|Shape>/<featureId>` with `properties.title` = display name; silent; stores
  `caltopoName` on success so nothing is re-sent).

### Server / sync
`sync-delta.js`: `LIST_TABLES.searcherTracks = 'searcher_tracks'`, `SINGLE_TABLE_KEYS.mapTrackingEnabled =
'settings_page'`. `sync-server.js`: `'searcher_tracks'` in `COLLECTION_TABLES` (generic schema, `/api/v1/tables`,
whole-case delete), `buildStructuredPlan` collection + `settings_page.mapTrackingEnabled`.

### `styles.css`
`.map-tracking-toggle`, `.map-tracking-faded`, `.has-track-tag` / `.track-miles-tag`, `.track-question-badge`,
`.searcher-tracks-header`, `.track-portion-pill(.home|.other|.unassigned)`, `.searcher-tracks-status`.

# Testing
- `test_search_log_map_tracking.js`: pure maths (path length, point-in-polygon with a hole, exact clipping of a
  leg crossing a square, leave-and-re-enter, two adjacent segments), name code parse/format (no stacking,
  segment names with spaces), allocation (single task, two tasks → ambiguous + latest, pick, spill-over to the
  other segment's latest task, no task yet), sanitizer round-trip, PSR maths with the switch off/on (numeric),
  Search Log render (toggle, faded cells + tags, `?` badges, tracks table), import from fetched features,
  rename POST with the prefixed title and no re-prefix, sync-delta maps.
- `test_structured_tables.js`: `searcher_tracks` collection + `settings_page.mapTrackingEnabled`.
- `npm test` chain (new suite appended to `package.json`).

# Delivery Steps

### ✓ Step 1: Shared maths + allocation (`map-segment-utils.js`), sync maps, server table/plan
### ✓ Step 2: `app.js` — bundle keys, formula, Search Log switch/column/tags, Searchers Tracks table, import/refresh/pick/rename; `page4.html`; `styles.css`
### ✓ Step 3: Follow-ups — no team count, sweep reminders off, dark-red tracks in the color push, Custom Track, Maps page destinations
### ✓ Step 4: Tests (`test_search_log_map_tracking.js`, 24 checks; `test_structured_tables.js`), `package.json`, `?v=20260922`, AGENTS.md §3/§7/§8

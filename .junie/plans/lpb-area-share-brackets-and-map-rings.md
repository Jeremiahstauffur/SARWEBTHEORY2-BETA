---
sessionId: session-260915-212614-13z9
---

# Requirements

### Overview & Goals
Two changes to the **Lost Person Behavior** (LPB) section (Incident page, and its copy beside the map on the Maps page):

1. **PSRi by area share, not by centre.** A segment used to fall wholly into the bracket its *centre* lay in. Now every
   switched-on category places the segment by **how much of its area lies in each 25 / 50 / 75 / 95 % ring** around
   the IPP: each bracket's percentage per mile is weighed by the share of the segment's area inside that bracket's
   ring, the weighed additions are summed per category, and — as before — the categories' additions are summed onto
   the PSRi (`factor = 1 + Σ / 100`). A segment half in the 25 % bracket and half in the 50 % one gains half of each
   bracket's rate; the part beyond the 95 % distance adds nothing.
2. **Rings on the map.** Every category row gets a **"Rings on map"** switch. On, the category's distances are drawn on
   the case's CalTopo map as **filled discs — purple (`#800080`) at 10 % opacity, no outline to speak of** (per the
   follow-up: "not as outlines, but as a 10 % opacity fill in a purple color"), one per bracket; off, they are removed
   again.

### Rules (as requested / decided)
- **Area maths.** Exact circle–polygon clipping on a local plane around the IPP (x = miles east, y = miles north, on
  the same sphere `haversineMiles` uses). Holes are subtracted from both the whole and the parts. Distances that do
  not increase leave a bracket with no width (nothing counted twice). Fractions are snapped at `1e-9` so a shape
  wholly outside / inside a ring reads exactly 0 / 1.
- **Shapes without area** (a line) still count as a whole in their centre's bracket (`byArea: false`); a segment
  without a CalTopo shape is still not adjusted.
- **Tooltips** name the shares: `Dementia (Dry): 50% of the segment in the 25% bracket (…) adds 6.6%; 50% in the
  50% bracket (…) adds 1.3% - together 7.9% of the PSRi.` A segment wholly in one bracket keeps the old one-line
  sentence. The PSRi tag stays the total (`+7.9%`).
- **Rings.** Plain CalTopo `Shape` polygons (72 points, 5° apart) titled `LPB ring: <category> <percent>% (<miles>)`,
  `fill`/`stroke` `#800080`, `fill-opacity` **0.1**, `stroke-opacity` 0.1, `stroke-width` 1, a description saying what
  the disc stands for. Stacked discs shade the ground darker towards the IPP, so bracket edges show as steps.
- **State per category** (`categories.<key>.rings = {shown, featureIds, ipp, distances}`, canonicalised by
  `normalizeLpbRings`): the planner's wish, the ids CalTopo gave, and the IPP position + distances the discs were
  drawn for. Wanted on the map = category on ∧ switch on ∧ IPP ∧ some distance. Stale (IPP moved, distance edited)
  ⇒ delete + redraw; unwanted (switch off, category off, IPP removed) ⇒ delete; the wish survives a removed IPP or
  a switched-off category and the discs come back with them. A device that merely receives the section does
  nothing (record current).
- **The sync** (`syncLpbRingsToCalTopo`) runs after **every** change of the section (`updateLostPersonBehavior`),
  one pass at a time (a call during a pass queues one more). Partial success keeps the ids taken but leaves the
  record "incomplete" so the next pass redraws the set; a refused delete keeps its id unless the fetched map no
  longer has it. Outcomes: one activity-log line per category, a toast, `finishCalTopoMapWrite()` (iframe reload,
  quiet re-fetch).
- The discs are **accounted for** below the map (`isFeatureAccountedFor`) and are not offered to *Auto Draw Segments*.

### Out of scope / deliberately left
- No time-based or per-poll reconciliation: only a change of the section brings the map in step (a wish another
  device could not meet is retried at the next change anywhere in the section).
- No distance weighting inside a bracket (the request's per-mile rate applies to the whole share in the bracket).
- CalTopo's own rendering of `stroke-opacity` decides how faint the hairline edge is.

# Technical Design

### `map-segment-utils.js` (pure, shared with tests)
- `normalizeLpbRings(value)`; `normalizeLostPersonBehavior` adds `rings` to every category.
- Area maths: `LPB_MILES_PER_DEGREE`, `makeLpbPlane(ipp, latHint)`, `discTriangleArea(a, b, r)` (signed area of the
  triangle (origin, a, b) inside the disc — whole triangle / circular sector / pieces cut at the crossings),
  `planarRingAreaInsideDisc(ring, r)`, `measureAreaWithinRadii(geometry, center, radiiMiles)` →
  `{areaAcres, fractions}` | null, `computeLpbCategoryShares(geometry, centerDistanceMiles, ipp, rates)` →
  `{shares, beyondFraction, addedPercent, bracket, byArea, areaAcres}`; `getLpbSegmentAdjustment` now returns
  `{matched, distanceMiles, byArea, areaAcres, contributions: [{category, terrain, bracket, shares, beyondFraction,
  byArea, addedPercent}], addedPercent, factor}`.
- Rings: `LPB_RING_COLOR`, `LPB_RING_FILL_OPACITY`, `LPB_RING_STROKE_WIDTH`, `LPB_RING_TITLE_PREFIX`, `LPB_RING_POINTS`,
  `buildLpbRingCoordinates(ipp, miles, steps)`, `buildLpbRingTitle`, `isLpbRingFeature`, `buildLpbRingProperties`,
  `planLpbRingFeatures(label, terrain, distances, ipp)`; `isFeatureAccountedFor` includes `isLpbRingFeature`.

### `app.js`
- Wrappers `planLpbRingFeatures`, `isLpbRingMapFeature`; `describeLpbContribution` / `appendLpbBracketTag` describe
  the shares and how the segment was placed.
- Section: `buildLpbRingsSwitch(category, entry, lpb)` appended to `.lpb-category-extras` after the terrain
  (`label.lpb-rings-switch[.is-drawn] > .toggle-switch > input.lpb-rings-toggle`, text "Rings on map", state in the
  tooltip); `setLpbRingsShown(category, shown)` (toast when no map / IPP / distances yet).
- Sync: `LPB_RING_OBJECT_TYPES = ['Shape']`, `areLpbRingsWanted`, `areLpbRingsCurrent`, `planLpbRingSync(lpb)`,
  `syncLpbRingsToCalTopo()` (one pass at a time, `_lpbRingSyncPromise` / `_lpbRingSyncQueued`), `runLpbRingSync()`
  (uses `deleteCalTopoMapFeature`, `createCalTopoMapFeature`, `buildCreatedMapFeature`, `finishCalTopoMapWrite`),
  called from `updateLostPersonBehavior`. `getAutoDrawCandidateFeatures` skips ring discs.

### `styles.css`
`.lpb-rings-switch` (+ `.is-drawn`, scaled `.toggle-switch`); `.lpb-category-extras.is-visible` wraps in the mobile
media query and the `map-lpb` container query so the switch drops under the terrain.

# Testing
- `test_lost_person_behavior.js` (27 checks): `normalizeLpbRings` / canonical shape with `rings`;
  `measureAreaWithinRadii` (strip, π/4 and π/100 squares, wholly outside / inside, hole, open ring, no area);
  `computeLpbCategoryShares` (quarters, halves, half beyond, different rates, flat table, line fallback);
  `getLpbSegmentAdjustment` straddling a bracket edge; the unchanged fixtures (small squares wholly in one ring) keep
  their old expectations. Rectangles are laid out on the module's own sphere (`MILE_EXACT_DEG_LAT`).
- `test_lpb_map_rings.js` (9 checks): ring geometry / style / titles / accounted-for; the switch in every row;
  on → 4 Shape POSTs, record, case copy, log, toast; off → 4 DELETEs; distance edit / IPP move → redraw; IPP removed
  / category off → removed and back; receiving device idle, stale record redrawn once; CalTopo refusing, half
  taken → completed next pass; no IPP / no map / idle off.
- `test_caltopo_color_sync_schedule.js`: the LPB check now derives Seg A's expected factor from the area maths (the
  69-mile triangle has only a sliver inside the rings).

# Delivery Steps

### ✓ Step 1: Shared maths + rings helpers (`map-segment-utils.js`), `normalizeLpbRings`
### ✓ Step 2: `app.js` — share tooltips, "Rings on map" switch, `syncLpbRingsToCalTopo`; `styles.css`
### ✓ Step 3: Tests (`test_lost_person_behavior.js` extended, `test_lpb_map_rings.js` new, schedule test updated), `package.json`, `?v=20260924`, AGENTS.md §3/§7/§8

Notes from the build: the module's sphere (`EARTH_RADIUS_MILES`, 69.093 mi/°) differs from `polygonAreaAcres`'s
69.172 mi/° and from the older tests' 69.09 — a test that puts a rectangle's edge exactly on a ring must use the
module's scale, and disc areas via `polygonAreaAcres` are compared to 0.2 %. `isUserActionActive()` is always true
right after a `saveBundle` (the flush is in flight), so the post-sync redraw of the section gates on
`isEditingActive()` only.

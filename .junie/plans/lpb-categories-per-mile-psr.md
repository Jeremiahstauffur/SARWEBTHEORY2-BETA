---
sessionId: session-260914-195732-19zq
---

# Requirements

### Overview & Goals
Extend the Incident page's **Lost Person Behavior** section from one category (Mental Illness) to the
full list of lost-person categories, shown under group titles, each working exactly like Mental Illness
(switch + terrain dropdown + editable four-distance graph). Replace the PSR maths: instead of dividing a
segment's PSRi by the bracket percentage, every category turns its four distances into a **percentage
per mile** per bracket and a segment *gains* that percentage of its PSRi; with several categories on, the
gains are worked out from the plain PSRi and **summed** onto it once. Mental Illness uses the new maths too.

### Category list (titles are group headings, not switches)
- **External Forces:** Abduction, Aircraft
- **Water:** Non-Powered Boat, Person in Current Water, Person in Flat Water, Person in Flood Water, Power Boat
- **Wheel/Motorized:** ATV, Motorcycle, Mountain Bike, 4WD Vehicle, Road Vehicle
- **Mental State:** Autism, Dementia, Despondent, Intellectual Disability, Mental Illness, Substance Intoxication
- **Child:** Age 1-3, Age 4-6, Age 7-9, Age 10-12, Age 13-15
- **Outdoor Activity:** Abandoned Vehicle, Angler, Car Camper, Caver, Day Climber, Extreme Race, Gatherer, Hiker,
  Horseback Rider, Hunter, Mountaineer, Runner, Worker
- **Snow Activity:** Skier Alpine, Skier Nordic, Snowboarder, Snowmobiler, Snowshoer

(41 categories. Spellings normalised from the request: "Substanc" → Substance, "Mountaneer" →
Mountaineer, "Showshoer" → Snowshoer.)

### The maths (as requested)
For brackets `c1 < c2 < …` (25 / 50 / 75 / 95 %) at distances `d1 < d2 < …`, with `c0 = 0 %`, `d0 = 0 mi`:

```
rate_i (%/mi) = (c_i − c_(i−1)) / (d_i − d_(i−1))
addition      = rate_i / 100 × PSRi          for the bracket the segment's centre falls into
PSRi'         = PSRi + Σ additions over every switched-on category
```
Example from the request: 25 % at 1.9 mi → 13.16 %/mi; 50 % at 11.8 mi → 25 % / 9.9 mi → 2.53 %/mi.
Beyond a category's 95 % distance, or without a CalTopo shape for the row, that category adds nothing.
A bracket whose distance is not beyond the previous one has no rate (`null`) — no division by zero.

### Out of scope / deliberately left
- Real Koester distances (the DB placeholders 0.5/1.0/1.5/2.0 are seeded for every new category × terrain).
- Search/filter or "collapse all" for the now 41-row Incident section.
- Distance weighting inside a bracket (the request multiplies the bracket's rate straight against the PSRi).

### Follow-up: the section beside the map (Maps page)
- The **whole** Lost Person Behavior section (heading + IPP control, paragraph, group titles, 41 rows with
  terrain dropdown and editable graph) also appears on the Maps page, in a column **beside the CalTopo map**
  ("CalTopo View" tab). Same data, same handlers — a change on either page is the case's one section.
- **LPB column on the left, map on the right** (clarified by the user), the two halves of a row that spans
  the **whole screen width**, breaking out of `<main>`'s 1200 px container (a 20 px gutter at the screen
  edges; edge-to-edge under 600 px like the other cards).
- The LPB column is exactly as tall as the map column (`75vh`) and **scrolls inside**; the page itself still
  scrolls on to "Unaccounted Map Features" below the row (no `overscroll-behavior` — reaching the end of
  the column hands the wheel to the page).
- Mobile (≤ 860 px, the app's breakpoint): the two columns stack in DOM order (LPB section, then the
  map), the LPB column keeping its map-height inner scroll.
- The row is shown with the map (no map added → no row, as the map card today).

### Follow-up: PSRc and map colors follow every LPB change
- Whenever the section changes — a category switched on/off, its terrain, a distance, the IPP (Incident
  page **or** Maps page copy), or the Segments page switch — the PSR maths run **at once** (PSRi, PSRc,
  Search Log PSR before/after) instead of on the next visit to the Segments page, and the CalTopo PSRc
  color push is asked for with the **soonest** schedule the rate limit allows (`delay: 0`: now when the
  cooldown has passed, else at its end; the heartbeat is unchanged).

# Technical Design

### `map-segment-utils.js` (shared, pure)
- `LPB_CATEGORY_GROUPS = [{key, title, categories: [{key, label}]}]`; `LPB_CATEGORIES` is the flattened
  list with `group` added. `label` stays the DB `category` column value.
- `computeLpbBracketRates(distances)` → one entry per bracket
  `{key, percent, distance, previousPercent, previousDistance, ratePercentPerMile | null}`.
- `resolveLpbBracket(miles, distances)` keeps the "smallest distance ≥ the segment's" rule and now returns
  the rate entry (no more `factor: 100 / percent`).
- `buildLpbContext(bundle)` → `categories: [{category, terrain, distances, rates}]` (on **and** complete),
  `incomplete: [category]` (on, missing a distance); `active` needs ≥ 1 applied category + IPP.
  `category/terrain/distances` still name the first applied one for single-category status text.
- `getLpbSegmentAdjustment(row, context)` → `{matched, distanceMiles, contributions: [{category, terrain,
  bracket, addedPercent}], addedPercent, factor: 1 + addedPercent / 100}`.
- `formatLpbPercent(value)` → `"13.2%"` / `"50%"`.

### `app.js`
- Wrappers: `getLpbCategoryGroups`, `computeLpbBracketRates`, `formatLpbPercent`; `buildLpbContext`
  fallback carries `categories: []`, `incomplete: []`.
- `recalculateEverything` / `calculatePSR` unchanged in structure — `getLpbPsrFactor` still multiplies the
  initial share; only the factor's meaning changed (comments updated).
- Segments page: `describeLpbStatus` names every applied category and points out an incomplete one;
  `appendLpbBracketTag` shows `+NN%` (the total gain) with a per-category breakdown tooltip
  (`describeLpbContribution`).
- Incident page: `renderLostPersonBehaviorSection` walks `getLpbCategoryGroups()` and inserts a
  `.lpb-group-title` before each group's rows; the explanatory paragraph describes the per-mile maths;
  `buildLpbDistanceChart` adds a `.lpb-chart-rate` line ("50% / mi") under each column and the rate in
  the bar tooltip.

### `styles.css`
`.lpb-group-title` (uppercase muted heading with a rule), `.lpb-chart-rate`.

### Follow-up: Maps page column (`app.js` `buildMapsPage`, `styles.css`)
- Markup: `#map-lpb-row.map-lpb-row` (hidden until a map is shown) wraps, in this order, the new
  `#map-lpb-panel.table-card.map-lpb-panel` > `#map-lpb-scroll.map-lpb-scroll` (left) and `#map-view-section`
  (class `map-lpb-map`, inline `height: 75vh` / `margin-top` moved to the CSS; right); `buildMapsPage` calls
  `buildLostPersonBehaviorSection(document.getElementById('map-lpb-scroll'))`, so the section keeps its
  `id="lpb-section"` and every existing handler's `renderLostPersonBehaviorSection()` redraws it in place.
  `renderMaps` / `viewMap` toggle the row instead of the map card.
- Full-bleed: `.map-lpb-row { width: var(--sar-viewport-width, 100vw); margin-left: calc(50% -
  var(--sar-viewport-width, 100vw) / 2); }`. `100vw` counts the vertical scrollbar on Windows, so
  `syncViewportWidthVariable()` (new, `app.js`) writes `documentElement.clientWidth` into
  `--sar-viewport-width` on `<html>` and keeps it current (ResizeObserver on `<html>`, else `resize`);
  called from `buildMapsPage`, bound once.
- Layout: grid `minmax(0,1fr) minmax(0,1fr)`, `gap 20px`, `--map-lpb-height: 75vh` on the row; both
  columns `height: var(--map-lpb-height)`; the panel is `padding 0; overflow hidden; flex column` with the
  scroll area `flex: 1; min-height: 0; overflow-y: auto` and the card padding; `.map-lpb-scroll
  .lpb-section { margin-top: 0 }`. `@media (max-width: 860px)`: one column; `≤ 600px`: no gutter. The panel
  is a query container (`container: map-lpb / inline-size`); `@container map-lpb (max-width: 620px)` repeats
  the LPB 768 px compact rules so a half-screen column on a small desktop / tablet does not overflow.
- Comment on `_lpbDistances` updated (read by the Incident **and Maps** pages).

### Follow-up: recalculation + color push on change (`app.js`)
- `recalculateEverything(options = {})` gains `colorSyncDelay`: when finite it is passed to
  `refreshCalTopoAssignmentOverlayIfEnabled({delay})` (default behaviour unchanged for every other caller).
- New `saveLostPersonBehaviorChange(bundle)`: `saveBundle(bundle, true)` (store, no send) →
  `recalculateEverything({colorSyncDelay: 0})` (saves + flushes when a value moved → one `/rows` batch with
  the section, the log entry and the recomputed rows; asks for the push) → `.then(flushed ? true :
  pushBundleDelta(loadBundle()))` so the deferred rows go out when nothing moved (the pattern
  `importSegmentsAction` uses).
- `updateLostPersonBehavior` (all Incident/Maps handlers) and `setLpbPsrAdjustmentEnabled` (Segments switch)
  route through it. `buildSegmentsTable()`'s own `recalculateEverything()` then finds nothing to do.

### Server
No code change: `initDatabaseSchema` seeds `LPB_CATEGORIES × LPB_TERRAINS` (164 rows, `NOT EXISTS`, ids
continue), `/api/lpb/distances` accepts every key/label via `getLpbCategory`.

# Testing
- `test_lost_person_behavior.js` (22 checks): `computeLpbBracketRates` with the request's 1.9 / 11.8 mi
  example, `resolveLpbBracket` rates, the group list (41, unique keys/labels, Mental Illness in Mental
  State), canonical shape with every category, `buildLpbContext` applied/incomplete lists, single- and
  two-category `getLpbSegmentAdjustment` (summed, order-independent), PSRi 7.5 → 11.25 (50 %/mi) and
  12.2368 / 7.6894 with Dementia on too, PSRc/search log follow, Incident render (titles in order, 41 rows,
  rates shown), Segments tags `+50%` / `+63.2%` / `+2.5%` and tooltips, status line with an incomplete
  category.
- `test_lpb_server.js` (17 checks): seed order/ids for N categories, `defaults` keyed by every label,
  Dementia all-seed, `dementia` / `Age 1-3` accepted by PUT, `unicorn` rejected.
- `npm test` chain green.
- Follow-up (Maps page column): a new check in `test_lost_person_behavior.js` drives `buildMapsPage()` on
  `page10` (fake `main`): the markup carries `map-lpb-row` → `map-lpb-panel` / `map-lpb-scroll` **before**
  `map-view-section` (LPB left, map right), the section is appended to `#map-lpb-scroll` with `id="lpb-section"`, the
  same heading / IPP pill / group titles / 41 rows / graph render as on the Incident page, no console errors;
  a category switch flipped on the Maps page changes the case exactly like on the Incident page. A static
  check pins the `styles.css` rules (`.map-lpb-row` full-bleed with `--sar-viewport-width`, `.map-lpb-scroll`
  `overflow-y: auto`, the 860 px one-column rule). `test_map_unaccounted_app.js` (renders the Maps page)
  stays green.
- Follow-up (recalculation + push): `test_caltopo_color_sync_schedule.js` gets "a Lost Person Behavior
  change … recomputes PSRc at once and asks for the push at the soonest the cooldown allows": with the
  manual clock, an IPP at Seg A's centre + Hiker on via `updateLostPersonBehavior` → Seg A's PSRc × 1.25 in
  the stored bundle immediately, Seg B unchanged, push due `now` (cooldown over) and made within 50 ms, one
  `/rows` batch carrying `lostPersonBehavior` + `pages.page2` + `activityLog`; `setLpbPsrAdjustmentEnabled(false)`
  inside the cooldown restores PSRc at once and defers the push to the cooldown's end. The Maps render check
  also asserts the PSRi is back to 7.5 right after the switch's `onchange`.

# Delivery Steps

### ✓ Step 1: Category groups, per-mile rates, multi-category context in `map-segment-utils.js`
### ✓ Step 2: `app.js` wrappers, Segments status/tag, Incident group titles + rate line, `styles.css`
### ✓ Step 3: Tests updated/extended (`test_lost_person_behavior.js`, `test_lpb_server.js`), AGENTS.md §3/§7/§8
### ✓ Step 4: Maps page — LPB column (left) beside the map (right) (`buildMapsPage` row + `syncViewportWidthVariable`, `styles.css` full-bleed / inner scroll / mobile stacking)
### ✓ Step 5: Tests (`test_lost_person_behavior.js` Maps render + stylesheet checks, `test_caltopo_color_sync_schedule.js` LPB-change check, `npm test`), AGENTS.md §2/§3/§7/§8 (`?v=` already at `20260919` in the working tree — no second bump)

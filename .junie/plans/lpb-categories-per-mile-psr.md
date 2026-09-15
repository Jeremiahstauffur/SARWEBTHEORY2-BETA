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

# Delivery Steps

### ✓ Step 1: Category groups, per-mile rates, multi-category context in `map-segment-utils.js`
### ✓ Step 2: `app.js` wrappers, Segments status/tag, Incident group titles + rate line, `styles.css`
### ✓ Step 3: Tests updated/extended (`test_lost_person_behavior.js`, `test_lpb_server.js`), AGENTS.md §3/§7/§8

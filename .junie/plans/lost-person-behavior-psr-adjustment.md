---
sessionId: session-260909-212822-vuyq
---

# Requirements

### Overview & Goals
Add a **Lost Person Behavior** (LPB) section to the Incident page (`page6`) so a planner can switch
on a lost-person category (today: **Mental Illness**), pick the terrain, import the **IPP** marker
from the connected CalTopo map, and have every segment's PSRi divided by the probability of the
25 / 50 / 75 / 95 % distance bracket its centre falls into. The Segments page gets a switch to apply /
lift the adjustment without losing anything entered on the Incident page.

### Scope
**In scope**
- Incident page section: heading with the shared IPP control (Import IPP / imported-marker pill),
  one accordion row per category (switch + name + terrain dropdown on one line), a four-column
  distance graph (0 mi → largest distance) with click-to-edit values (miles, one decimal) and a
  reset-to-database-default button on edited values.
- Server tables: `lpb_default_distances` (category × terrain, editable by hand, seeded 0.5/1.0/1.5/2.0),
  `lpb_user_distances` (the login's edited values, keyed by username only), `lpb_ipp` (the case's IPP,
  keyed by username + CASE #), `lost_person_behavior` (single-record mirror of the bundle section).
- PSR maths: factor `100 / percent` on the segment's initial share (PSRi, PSRc and Search Log PSR
  before/after all follow). Bracket = smallest of the four distances ≥ the segment's distance from the
  IPP; beyond the 95 % distance or without a CalTopo shape → unchanged.
- Segments page: "Lost Person Behavior" panel with the apply switch + status line; a small `NN%` tag on
  the top-right border of each adjusted PSRi pill.

**Out of scope**
- Additional categories (the data model, tables and UI already loop over `LPB_CATEGORIES`).
- A UI for editing `lpb_default_distances` (edited directly in the database, as requested).
- `data.php` / `proxy.php` mirroring.

### Decisions taken with the user
- Beyond the 95 % distance: PSRi is **left unchanged** (no division by 5 %).
- The factor **carries through** to PSRc and the Search Log (initial share is scaled).
- Formula is `PSRi / percent` (e.g. 25 % bracket → PSRi / 0.25), not `PSRi / (1 - percent)`.
- Defaults seeded as 0.5 / 1.0 / 1.5 / 2.0 mi for every terrain; the user enters real values in the DB.
- IPP control sits beside the section heading (shared by all categories); label + terrain are on
  one line except on mobile.

# Technical Design

### Data model
`bundle.lostPersonBehavior` (canonical form produced by `normalizeLostPersonBehavior`):
```
{
  psrAdjustmentEnabled: true,                       // Segments page switch
  ipp: null | {featureId, featureName, lat, lng, importedAt, importedBy},
  categories: { mentalIllness: { enabled, terrain, distances: null | {p25, p50, p75, p95} } }
}
```
The case carries its **own copy** of the four distances (copied from the login's effective values when
the category is switched on / terrain changes, edited in place afterwards) so every device computes the
same PSR. The login's edits live only in `lpb_user_distances` and seed the next case / terrain.

### Where the logic lives
- `map-segment-utils.js` (shared, pure): `LPB_*` constants, `normalizeLostPersonBehavior`,
  `geometryCenterLngLat`, `getFeatureCenter`, `haversineMiles`, `findFeatureForSegmentRow`,
  `resolveLpbBracket`, `buildLpbContext`, `getLpbSegmentAdjustment`.
- `app.js`: wrappers + distance API client (`loadLpbDistances`, `saveLpbOverrideDistance`,
  `getLpbEffectiveDistances`); `sanitizeBundle`/`defaultBundle` keep the section;
  `recalculateEverything` builds one `lpbContext` and multiplies the initial share by
  `getLpbPsrFactor`; `calculatePSR` takes the context; Incident section
  (`buildLostPersonBehaviorSection` … `setLpbCaseDistance`, `showLpbIppMarkerPopup`,
  `setLostPersonIpp`); Segments panel (`bindLpbSegmentsPanel`, `setLpbPsrAdjustmentEnabled`,
  `describeLpbStatus`, `appendLpbBracketTag`).
- `sync-delta.js`: `SINGLE_TABLE_KEYS.lostPersonBehavior = 'lost_person_behavior'`.
- `sync-server.js`: tables + seed in `initDatabaseSchema`, `lost_person_behavior` in `SINGLE_TABLES`,
  `syncLostPersonIppTable` (REPLACE/DELETE `lpb_ipp` whenever the section is written),
  `GET/PUT /api/lpb/distances`, whole-case delete includes `lpb_ipp`.
- `page2.html`: LPB panel (`#lpb-toggle`, `#lpb-label`). `styles.css`: `.lpb-*`, `.psri-bracket-tag`.

### Sync
The IPP is not sent through a separate endpoint: it is part of the section, travels as a normal row
change (`path: ['lostPersonBehavior', 'ipp']`), and the server mirrors it into `lpb_ipp` from the
stored bundle (`applyChangesToTables` → `syncLostPersonIppTable`). Whole-file seeds/imports do the same
through `decomposeBundleToTables`.

# Testing
- `test_lost_person_behavior.js` — pure maths + vm sandbox over the real `app.js` (18 checks):
  bracket selection, centroid/haversine, sanitizer round-trip, PSRi ×4 / ×2 / unchanged, PSRc and
  Search Log follow, Segments switch keeps settings, IPP import → row batch, GET/PUT distances,
  Incident section and Segments table render (tags on PSRi pills).
- `test_lpb_server.js` — Express endpoints over an in-memory mysql2 stand-in.
- `test_structured_tables.js` — plan carries `lost_person_behavior` / `lostPersonIpp`.

# Delivery Steps

### ✓ Step 1: Shared LPB maths in `map-segment-utils.js`
### ✓ Step 2: Bundle key, PSR factor and Incident / Segments UI in `app.js`, `page2.html`, `styles.css`
### ✓ Step 3: Server tables, `/api/lpb/distances`, `lpb_ipp` mirror, whole-case delete
### ✓ Step 4: Tests (`test_lost_person_behavior.js`, `test_lpb_server.js`, `test_structured_tables.js`), `package.json`, `?v=` bump, AGENTS.md

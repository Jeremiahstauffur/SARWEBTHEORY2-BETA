---
sessionId: session-260922-061628-c5dl
---

# Requirements

### Overview & Goals
Three requests on the Search Log page's Map Tracking and the popups:

1. **Routes and tracks are the same thing.** Every CalTopo line - a drawn route (`Shape` with a
   `LineString`), a recorded / live track (`AppTrack`, `LiveTrack`, a `gpstype: TRACK` line, a line
   delivered as a `GeometryCollection`) - must be importable into the Searchers Tracks table and measured
   across the segments it crosses exactly like an imported route. No code path may treat one class of
   line differently from another (import target, unaccounted panel, Fetch Shapes popup, Features tab,
   Trim Tracks).
2. **Tracks lower the PSRc of segments without a task too.** Today the miles a track walked inside a
   segment that carries no Search Log task "wait for the next task" and count for nothing. With Map
   Tracking on they must search that segment off as well: `z = sweepWidth / ((area / 640 / trackMiles) x
   5280)` with the segment's own sweep width (Segments page column 4), applied once to the segment's share
   in `recalculateEverything` (PSRc) and in the charts (`calculateHourlyMetrics`). As soon as a task is
   logged on that segment the allocation hands the miles to the task (as before), so nothing is counted
   twice.
3. **One popup at a time; Enter confirms.** In the Incident Times form the "+" / time button keeps the
   keyboard focus while the popup opens; Enter or Space re-fires the button and stacks another copy of
   the same popup. `createPopup` must (a) move the focus into the popup so the origin button cannot
   re-fire, (b) replace an already open popup with the same title instead of stacking a copy, and
   (c) let Enter click the popup's primary (confirm) button. Every popup goes through `createPopup`,
   so the fix covers all of them (the same fault was latent in every popup opened from a focused
   button: status pickers, team pickers, delete confirmations, ...).

### Out of scope / deliberately left
- The Map Tracking switch still governs everything: with it off the tracks stay listed and change no
  PSR (segments with or without a task).
- Enter does not confirm from inside a `<textarea>`, a `<select>`, a button/link (those keep their own
  Enter), a contentEditable cell, or a search box (`type="search"` / placeholder saying "search").
- Space is left alone (it only had to stop re-opening the popup).

# Technical Design

### `map-segment-utils.js`
- `getFeatureCategoryKey` / `getFeatureTypeKey`: any class/type containing `track` (AppTrack,
  LiveTrack, Track) is a `route`, whatever the geometry says (a `GeometryCollection` of lines used to be
  a `shape` and therefore not importable). `getTrackTypeLabel`: `gpstype: TRACK` is a `Track`.
- `allocateSearcherTracks` also returns `unassignedBySegment: {'<region>|<segment>': {region, segment,
  miles, portions: [{trackId, miles, home}]}}` - the portions whose segment has no task. New helpers
  `getSegmentUnassignedTrackMiles(allocation, region, segment)` and
  `getSegmentUnassignedTrackPortions(allocation, region, segment)`.

### `app.js`
- Wrappers `getSegmentUnassignedTrackMiles` / `getSegmentUnassignedTrackPortions`.
- `recalculateEverything`: with Map Tracking on, after the Search Log rows, every segment with
  unassigned track miles gets `share *= e^-z`, `z = calculateSearchCoverage({area, sweepWidth: segment
  sweep, trackMiles})`.
- `calculateHourlyMetrics`: same for a segment at every hour, counting the tracks imported by then
  (`importedAt <= currentTs`; a track without a stamp always counts); the segment's PSR then follows.
- Segments page: the PSRc pill of such a segment carries a `.track-miles-tag` ("0.40 mi") whose tooltip
  names the tracks (`appendUnassignedTrackMilesTag`). Searchers Tracks pills: the "unassigned" tooltip
  says the miles lower the segment's PSRc directly; `MAP_TRACKING_COLUMN_HINT` says so too.
- `createPopup`: `replaceOpenPopupsTitled(title)` removes an open (non-fading) overlay whose
  `.popup-title` matches; the content gets `tabindex="-1"` and the focus (`focusPopupContent`); the
  overlay's `onkeydown` is `handlePopupKeydown`: Enter -> click the first enabled `.popup-btn.primary`
  in `.popup-buttons` (unless the focus is in a button/link/textarea/select/contentEditable/search box or
  the event was already handled), Escape -> the close (x) button.
- `styles.css`: `.popup-content:focus { outline: none; }`.

### Tests
- `test_search_log_map_tracking.js`: track classes -> `route` / `Track`; `unassignedBySegment` +
  helpers; app: a segment without a task loses PSRc from the miles walked in it (switch on), keeps it
  (switch off), the charts agree, a task logged later takes the miles over; the Segments page tag.
- `test_popup_single_instance.js` (new): `createPopup` extracted by name into a fake DOM - a second
  popup with the same title replaces the first, focus moves into the popup, Enter clicks the primary
  button (not from a button / search box), Escape closes; static: `showTimePrompt` builds its confirm as
  `.popup-btn.primary`.
- `package.json` `scripts.test` gets the new suite; `?v=` bumped in every HTML file.

# Delivery Steps

### ✓ Step 1: Shared module - track classes, `unassignedBySegment`, helpers; tests
### ✓ Step 2: `app.js` maths (recalculateEverything, charts), Segments tag, tooltips; tests
### ✓ Step 3: `createPopup` single instance + focus + Enter/Escape; `styles.css`; new test
### ✓ Step 4: `package.json`, `?v=` bump, AGENTS.md §3/§5/§7/§8

Notes from the build: no code path ever named a track class as "not importable" - the import filter
(`isTrackLikeFeature`) already took any line - but `getFeatureCategoryKey` judged by the geometry first, so a
track CalTopo delivers as a `GeometryCollection` was a `shape` on the Maps page (Other / not importable);
the class now decides first. The idle-miles term uses the **segment's** sweep width (Segments column 4)
because a segment without a task has no task sweep width; a blank sweep width means no reduction. In the
charts an idle portion counts from the track's `importedAt` on. The popup fix is in `createPopup` only
(no caller changed): focus onto `.popup-content`, same-title replacement, Enter -> `.popup-btn.primary`,
Escape -> the x. `?v=20260925` (the previous stamp, `20260924`, was already later than today's date, so the
next day was used to make sure caches turn over). `npm test`: every suite passes (25 + 5 new checks).

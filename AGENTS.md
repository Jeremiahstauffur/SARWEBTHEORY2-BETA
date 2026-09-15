# AGENTS.md — Handoff Guide for SAR Web Theory

> **Who this is for:** any AI coding agent (or human) picking up work in this repository.
> **What it is:** a living record of how the project is built, the rules that keep it working,
> and the lessons earlier sessions paid for. Read it before touching code; extend it before you leave.

---

## 0. How to use and maintain this file

**At the start of a session**
1. Read this whole file (it is short on purpose).
2. Skim `.junie/plans/*.md` — each is a full requirements/design/test record of a previous session.
   The `sessionId` front-matter and `### ✓ Step` markers tell you what was finished.
3. Check the **Open follow-ups** section (§8) before proposing new work; it may already be listed.

**At the end of a session** (this is the contract that makes the file useful)
- Append an entry to **§7 Lessons learned** if you discovered a non-obvious cause, a trap, or a
  convention that is not already written down. One dated bullet, cause → rule, no essays.
- Update **§8 Open follow-ups**: remove what you closed, add what you deliberately left.
- If you changed an architectural fact (an endpoint, a storage rule, a file's role), fix the
  sentence that describes it in §2–§5 rather than adding a contradicting bullet elsewhere.
- Keep entries **specific** (function names, file names, status codes). "Be careful with sync" helps nobody.
- Prefer superseding to deleting: if an older lesson is now wrong, strike it through and say why.
- Do not paste large code here; link to the function (`app.js` `saveBundle`) instead.

Entry template (copy it):

```
- **YYYY-MM-DD — <short title>.** Symptom: … Cause: … Rule: … (see `<file>` `<function>`; plan: `.junie/plans/<name>.md`)
```

---

## 1. What this project is

**Search & Rescue Theory Software** — a multi-page web app for SAR planners: regions, segments,
personnel, search log (task assignments), forms, maps (CalTopo import/overlay), uploads, incident
profile, user management and settings. Multiple devices work on the same **case** (a "search file",
identified by a **CASE #**) at the same time through a sync server.

Two halves, one repo, no build step:

| Half | Files | Runs where |
|---|---|---|
| Frontend | `*.html`, `app.js`, `styles.css`, `theme-boot.js`, `sync-delta.js`, `map-segment-utils.js`, `assets/` | Static files in the browser (also served by the Node server) |
| Backend | `sync-server.js` (Node/Express + `mysql2`), `sync-delta.js` (shared) | Railway (MySQL). `PORT` env, default 3000 |
| Legacy backend | `data.php`, `proxy.php` | PHP/MySQL bridge. **Not the active backend**; mirror changes only if asked |

Tooling: plain Node (`npm start` → `node sync-server.js`, `npm test` → chain of `node test_*.js`).
No bundler, no transpiler, no test framework. Development happens on Windows in PhpStorm; scripts
in the repo are PowerShell (`update_nav.ps1`).

---

## 2. Repository map (what matters, what to ignore)

**Core**
- `app.js` (~19.7k lines) — the entire frontend. Page detection via `document.body.dataset.page`.
  Sync layer lives near the bottom (`saveBundle` ~4557, `pushBundleDelta` ~19230, `pollServerState`
  ~19431, `applyServerSections` ~19377, `isUserActionActive` ~19618). Line numbers drift; grep.
- `sync-server.js` (~2.4k lines) — Express API, MySQL via a sqlite-style `db.run/get/all` wrapper
  (`translateSql` rewrites `INSERT OR REPLACE` → `REPLACE`). Structured tables built by the pure
  function `buildStructuredPlan(bundle, fallbackCase)`.
- `sync-delta.js` — UMD module shared by browser **and** server: row-level diff/merge
  (`computeBundleChanges`, `coalesceChange`, `applyBundleChanges`, `mergeServerSections`, `deepEqual`).
  Also owns the page→table maps (`PAGE_TABLES`, `LIST_TABLES`, `SINGLE_TABLE_KEYS`).
- `map-segment-utils.js` — UMD module with geometry / CalTopo feature helpers; the place to put
  pure logic that tests need to `require()`.
- `theme-boot.js` — synchronous `<head>` script and **the first tag in `<head>`, before `styles.css`**;
  reads the `sar-ui-hint` cookie, sets `html.light-mode` / `html.geek-mode`, injects the critical CSS
  (`<style id="sar-boot-style">`: per-theme `html` canvas colour + the 80% boot overlay/spinner) and
  adds `html.sar-booting` (removed by `finishPageBoot()`). The overlay CSS is **not** in `styles.css`.
- `styles.css` — single stylesheet; light palette is `html.light-mode` (not `body.`).
- `update_nav.ps1` — **generates the desktop `<nav>` and mobile `.bottom-nav` in every HTML file.**

**Pages** (`data-page` → file → nav title)

| data-page | file | title |
|---|---|---|
| `home` | `home.html` | Home (dashboard, Saved Cases, charts) |
| `page6` | `page6.html` | Incident (profile) |
| `index` | `index.html` | Regions |
| `page2` | `page2.html` | Segments |
| `page3` | `page3.html` | Personnel |
| `page4` | `page4.html` | Search Log |
| `page5` | `page5.html` | Forms |
| `page10` | `page10.html` | Maps (CalTopo map; the Incident page's LPB section beside it, see §3) |
| `page7` | `page7.html` | Uploads |
| `page8` | `page8.html` | Users / profile editor (`?tab=manage`) |
| `settings` | `settings.html` | Settings |
| `more` | `more.html` | Mobile "More" menu |
| — | `mobile-status.html` | Mobile status view |

**Tests** — `test_*.js` in the root, listed explicitly in `package.json` `scripts.test`.

**Ignore / do not run**
- `patch.js`, `patch2.js`, `patch3.js`, `patch4.js`, `patch_app.js`, `patch_backup.js`,
  `patch_delete.js` — one-off historical code-rewrite scripts (e.g. the sqlite→MySQL move). Never execute.
- `diff_mobile.txt`, `cookies.txt`, `temp_print.css`, `sar_prep.py` — scratch artifacts.
- `node_modules/` — committed dependencies; don't touch.
- `db/` is referenced as `DATA_DIR` but is empty/absent locally.

---

## 3. Data model (the "bundle")

One case = one JSON **bundle** stored on the server under a **bucket**.

```
bundle = {
  fileName,                       // the CASE # (also the structured-table search_case)
  pages: {
    index: { rows: [...] },       // Regions   (note: object with rows)
    page2: [...],                 // Segments  (array of rows)
    page3: [...],                 // Personnel
    page4: [...]                  // Search Log
  },
  forms: {...}, uploads: [...], maps: [...], activityLog: [...],
  profile: {...}, permanentPersonnel: {...}, parChecks: {...},
  lostPersonBehavior: {           // Incident page "Lost Person Behavior" (canonical, see below)
    psrAdjustmentEnabled, ipp: {featureId, featureName, lat, lng, ...} | null,
    categories: { <key of every LPB_CATEGORIES entry, e.g. mentalIllness, dementia, hiker>:
                  {enabled, terrain, distances: {p25, p50, p75, p95} | null} }   // any number may be on
  },
  theme, showTips, geekMode, background, deleteMode, parCheckFrequency, ...settings keys,
  lastModified                    // recomputed every save; never diffed
}
```

- Rows are **arrays of strings**; column indexes are the schema (e.g. personnel `row[3]`=GPS,
  `[4]`=Radio, `[5]`=Medic). Check the builder for the page before assuming an index.
- `sanitizeBundle()` rebuilds a bundle from a **fixed key list**. Any new top-level key must be added
  there or it silently vanishes on load/save (see Lessons).
- **Bucket id** = `${caseNumber}_${urlSafe(username)}` — `getSyncBucket()`, `caseNumberToBucket()`,
  `bucketToCaseNumber()`. Isolation is per **login username**, not per PIN. Keep the suffix logic in one place.
- Server "structured tables" mirror the bundle per `(username, search_case)`:
  `COLLECTION_TABLES` = regions, segments, personnel, search_log, uploaded_files, maps_settings,
  forms, activity_log; `SINGLE_TABLES` = profile, settings_page, lost_person_behavior. Plus
  `activity_log_entries`, `declined_assignment_features`, `lpb_ipp` (the case's IPP, derived from the
  bundle section by `syncLostPersonIppTable`), `user_assets`, `users`, `user_settings`, `user_buckets`,
  `store`. Not per case: `login_users` (the login's people, see below), `lpb_default_distances` (category × terrain miles, **edited by hand in the DB**,
  seeded 0.5/1.0/1.5/2.0) and `lpb_user_distances` (a login's edited values, username only). Both
  distance tables have `id` — a unique **five-digit** `AUTO_INCREMENT` primary key from `LPB_FIRST_ROW_ID`
  (10000) — with the old composite key kept as a `UNIQUE KEY`; `ensureLpbRowIds` adds/repairs it on every
  start, so never write those tables with `REPLACE` (delete+insert changes the id) or `INSERT IGNORE`
  (an ignored insert still burns a number).
- `INTERNAL_STORE_KEYS` (`bundle`, `all-files`, `user-<pin>` presence pings) are **never** a CASE #.
- **Lost Person Behavior** (`lostPersonBehavior`): 41 categories in 7 groups (`LPB_CATEGORY_GROUPS` →
  flattened `LPB_CATEGORIES = [{key, label, group}]`, `map-segment-utils.js`; `label` is the `category`
  column of the distance tables). The pure maths (`computeLpbBracketRates`, `resolveLpbBracket`,
  `getLpbSegmentAdjustment`, `buildLpbContext`, centroid/haversine) lives there too. Each bracket has a
  **percentage per mile**: `(pct − prevPct) / (mi − prevMi)` with the 25 % bracket measured from 0 %/0 mi
  (25 % at 1.9 mi → 13.16 %/mi; 50 % at 11.8 mi → 25 % / 9.9 mi = 2.53 %/mi). A segment in a bracket
  *gains that rate as a share of its PSRi*; with several categories on each works out its own gain from
  the plain PSRi and `factor = 1 + Σ rates / 100` is applied once to the *initial share* in
  `recalculateEverything()`, so PSRi, PSRc and Search Log PSR move together. Beyond a category's 95 %
  distance it adds nothing; with no CalTopo shape for the row (`findFeatureForSegmentRow`: column 9 id,
  else name) the factor is 1. A bracket whose distance is not beyond the previous one has no rate
  (`null`, adds nothing) — never a division by zero. The **case** holds its own copy of the four
  distances per category (seeded from the login's `lpb_user_distances` ∪ defaults when a category is
  switched on / terrain changes) so every device computes the same PSR. The section is **one component
  on two pages**: `buildLostPersonBehaviorSection(container)` renders it (as `#lpb-section`) under the
  profile form on the Incident page and into `#map-lpb-scroll` on the Maps page — the **left** half of the
  screen-wide `.map-lpb-row`, the CalTopo map being the right half (`buildMapsPage`; row shown only with
  a map; column as tall as the map, scrolling inside itself; stacked under 860 px). Every change —
  `updateLostPersonBehavior` (both pages) and the Segments switch `setLpbPsrAdjustmentEnabled` — goes
  through `saveLostPersonBehaviorChange`: deferred save → `recalculateEverything({colorSyncDelay: 0})`,
  so PSRi/PSRc are recomputed **at once** (one row batch: section + log entry + recomputed rows) and the
  CalTopo color push is asked for immediately (still gated by the cooldown). Plans:
  `.junie/plans/lost-person-behavior-psr-adjustment.md` (section, tables),
  `.junie/plans/lpb-categories-per-mile-psr.md` (category list, per-mile maths, multi-category sum,
  Maps page column, recalculation on change).
- **Geek Mode** is *not* a bundle key. It lives in the login's `user_settings` preference record
  (`sar-user-preferences-v1`) **per user account**: `geekModeByUser[<getAccountName>] = {enabled,
  paddingPercent}`, with the login-level `geekMode` / `geekPaddingPercent` as the fallback for an
  account without an entry (`getGeekModeRecord`, `saveGeekModePreference`, `applyGeekMode`). The
  percentage becomes `--geek-space-scale` inline on `<html>` (`html.geek-mode` maps it onto
  `--space-scale`); the boot hint cookie carries it as `pad<percent>`. Plan:
  `.junie/plans/geek-mode-per-user-compact-panels.md`.
- **CalTopo color sync limits** are two login-preference bundle keys mirrored like `parCheckFrequency`
  (`LOGIN_PREFERENCE_KEYS`, `settings_page`): `caltopoColorSyncHeartbeatMinutes` (default 1, "push at
  least every") and `caltopoColorSyncCooldownSeconds` (default 10, "never more often than"; clamped to
  the heartbeat by `getCalTopoColorSyncSettings`, which the sanitizer, the scheduler and the Settings
  page all use). The clock behind them is **not** case data: `sessionStorage[CALTOPO_COLOR_SYNC_LAST_PUSH_STORAGE_KEY]`
  holds this tab's last push attempt (deliberately per tab, survives page navigation), and
  `maps[0].caltopoAssignmentOverlayState.updatedAt` is the case's record of the last push that *changed*
  a shape (a hint other devices read as a lower bound). Plan: `.junie/plans/caltopo-color-sync-rate-limit.md`.
- **Which sync server / CalTopo proxy** is *not* a setting and *not* in the bundle. `getSyncServerUrl()`
  resolves, in order: the login popup's **"Set Server"** cookie (`SYNC_URL_LOCAL_STORAGE_KEY`) → the
  address the server publishes from its Railway variable **`CALTOPO_SYNC`** (`GET /api/config`, cached in
  the `SYNC_URL_CONFIG_STORAGE_KEY` cookie by `loadSyncServerConfig()`, which runs first in
  `DOMContentLoaded`) → `localhost:3000` for a localhost page → the bootstrap `DEFAULT_SYNC_SERVER_URL`.
  The CalTopo proxy is always `<sync server>/api/proxy` (`getCalTopoProxy()`, derived on every call).
  The Settings page has no server/proxy section: switching servers = log out → login popup → "Set Server".
  Plan: `.junie/plans/caltopo-sync-variable-and-login-profile-pick.md`.
- **The login's users belong to the login, not to a CASE #.** Table `login_users` (one row per login
  username + lower-cased name: `pin, handle, color, theme, is_file_manager, removed` + `record` JSON),
  `GET/PUT /api/auth/users` (verified credentials only; PUT upserts by name, **never deletes** — a removal
  is `removed: true`). `app.js` "The login's users" section: `loadLoginUsers()` right after
  `loadServerSettings()`, `applyLoginUsersToBundle()` lays the list over the open case **before drawing**
  (`bundle.accounts` = Super Admin + login users; every user gets a Personnel row — `Off Duty`, not on
  scene, PIN-linked — rows of removed users go), `syncLoginUsersFromBundle()` inside `saveBundle`
  writes back every account change (a name typed on Personnel becomes a user). `removeLoginUser()`
  (Users page "Remove", Personnel row delete) flags + drops; `noteLoginUserRename()` retires the old
  name. `bundle.accounts` is therefore a **per-case mirror** of the login's list, not the source. Only
  a user's Personnel row (team/status/times) is per case. Plan: `.junie/plans/login-wide-users.md`.
- **Who is at the device** (`sessionStorage['sar-current-user']`) is picked right after login
  (`showLoginProfilePopup`): the login's users (`GET /api/auth/users`) ∪ the login's personnel in **every**
  case (`GET /api/v1/tables/personnel`, never `?case=`), with the virtual **"Anonymous"**
  (`createAnonymousUser()`, pin `anonymous`, not in `bundle.accounts`) as the default and the Super Admin
  offered but never presumed. A tab with no pick works as Anonymous; "Switch User"
  (`requestUserSwitch()`, flag `sar-open-user-popup`) opens the in-page picker.

**Nothing is persisted on the device.** The case lives in memory for the page lifetime; the device
keeps only login cookies/sessionStorage and the sync-server URL cookies (the "Set Server" choice and
the `CALTOPO_SYNC`-published address). The `*_STORAGE_KEY` constants are
mostly keys into the **per-user server settings** (`GET/PUT /api/auth/settings`) or the in-memory
store, and `LEGACY_LOCAL_STORAGE_KEYS` is wiped at startup. Do not reintroduce localStorage caching
of case data. (`sessionStorage` is allowed for per-tab *clocks and flags* only — `sar-open-case-popup`,
`sar-open-user-popup`, the color-sync last-push time — never for case content.)

---

## 4. Sync protocol (the part that has bitten every previous session)

Read `.junie/plans/finish-outbox-sync-fix-segment-loss.md` before changing anything here.

Flow: edit → `saveBundle(bundle, deferFlush)` → diff vs previous in-memory copy
(`computeBundleChanges` + `coalesceChange`) → **outbox** → `pushBundleDelta()` flushes
`POST /api/v1/:bucket/rows {fileName, batchId, changes}` → server merges row-by-row and echoes
touched (non-heavy) sections → `applyServerSections()`. Every visible page polls
`GET /api/v1/:bucket/state?since=<cursor>` every `SYNC_POLL_INTERVAL_MS` (4 s).

Invariants — breaking any of these has caused real data loss:
1. **Never blind-overwrite local data with a server read.** Overlay sections
   (`mergeServerSections`), then re-apply pending outbox changes (`rebasePendingChanges`).
2. **The cursor advances only from `/state` answers**, never from `/rows` echoes.
3. **Whole-file `PUT /api/v1/:bucket/bundle` only for**: seeding (`?seed=1`, 409 `alreadyExists`
   → adopt server copy), a `fileName` switch, imports (`?import=1`), and legacy fallbacks
   (`400/404/405/413/501`). `409 needsFullSync` → seed.
4. **No `keepalive: true` on bodies ≥ 60 KB** (browsers reject > 64 KiB silently). `fetchInitWithKeepalive`.
5. **Rendering must be network-silent.** `recalculateEverything()` saves only if something changed;
   a page load must not push.
6. **No UI rebuild while the user is editing or an action is in flight** — gate with
   `isUserActionActive()` / `isEditingActive()`; otherwise the cursor gets yanked from the cell.
7. A retried batch reuses its `batchId`; the server dedupes (`wasBatchApplied`). Append/prepend are
   idempotent on the client.
8. Heavy sections (`uploads`, `maps`) are never echoed in `/rows` responses.

Server-side rules: every read/write filters by `req.user.username` (auth headers `X-User-Name` +
`X-User-Pin`/`X-User-Password`). Bundles written by the Super-Admin (PIN `1976`) can only be
overwritten/deleted by the Super-Admin (403 otherwise). `DELETE /api/v1/:bucket` removes store rows,
`user_buckets` history and every structured table for that case — even if the bundle is unreadable.

Key endpoints: `/api/auth/{register,login,history,settings,users,assets[/:kind]}`,
`/api/v1/:bucket/{rows,state,activity,declined-assignments,page/:page,all-files,latest,:key}`,
`/api/v1/tables[/:table]?case=`, `GET/PUT /api/lpb/distances` (login-scoped LPB distance defaults +
overrides), `GET /api/config` (public, `no-store`: the `CALTOPO_SYNC` sync-server address the website is
to use, read from `process.env` per request), `/api/health` (also carries it), `/api/proxy` + `/api/call`
(CalTopo, signed server-side).

---

## 5. Conventions that must be followed

- **Nav changes go through `update_nav.ps1`.** Edit `$navTemplate` / `$bottomNavTemplate`, run the
  script; it regex-replaces `<nav>…</nav>` in every `*.html`. Hand-editing one page desyncs the rest.
- **Cache-busting:** every `<script>`/`<link>` include carries `?v=YYYYMMDD` (currently `20260919`).
  When you change `app.js`, `styles.css`, `sync-delta.js`, `map-segment-utils.js` or `theme-boot.js`,
  bump the stamp in **all** HTML files (search `?v=`).
- **Panel grids:** `.home-grid` is 2 columns (Segments page), `.home-grid.settings-grid` is 3 equal
  columns (Settings), `.dashboard-grid` is `1fr 1fr 1.5fr` (Home). `.home-panel.full-width` spans
  `1 / -1` so it fills any of them; all collapse to one column at `max-width: 860px` (the mobile breakpoint).
  In Geek Mode `.home-grid` becomes a wrapping flex row (`styles.css`, "Geek Mode" block at the end).
- **Geek Mode markup:** a toggle/button panel that should condense gets `data-geek-compact` (and
  `data-geek-title="LPB"` for the short title shown via `::before`); a long label that should be
  swapped gets `class="geek-full"` with a `<span class="geek-abbr">` sibling. Nothing else is
  needed — CSS does the rest. Spacing must be written `calc(Npx * var(--space-scale, 1))` to follow
  the percentage; a fixed `min-height` needs its own `html.geek-mode` override (see `.pill-cell`).
- **Theme:** toggle classes on `document.documentElement`, target `html.light-mode` in CSS. Inline
  `--accent`/`--accent-rgb` on `<html>` must win over the class palette.
- **Code style:** 4-space indent in `app.js`/server (some older blocks are 2-space — match the
  surrounding function), `const`/`let`, `camelCase`, single quotes in JS. Comments are full sentences
  explaining *why*, often as a block above the constant/function — match that voice.
- **New storage/interval constant?** Declare it at the top of `app.js`. `test_sync_outbox.js` has a
  static guard: every `*_STORAGE_KEY` / `*_INTERVAL_MS` identifier used must be declared.
- **New bundle key?** Add it to `sanitizeBundle()`, to `sync-delta.js` maps if it should mirror to a
  table, and to `buildStructuredPlan` on the server if it needs its own table.
- **CalTopo color push = `updateCalTopoAssignmentOverlay(true)`, always through the scheduler.** Ask for
  it with `refreshCalTopoAssignmentOverlayIfEnabled()` (cooldown gate, one pending timer, heartbeat via
  `startCalTopoColorSyncTicker`); never add a second `setTimeout` path. The push **saves the case only
  when a shape's local style/description/class actually changed** (`changedLocally`): the heartbeat
  re-POSTs identical colors every minute and must not churn the heavy `maps` section on every device.
  Automatic pushes stay silent (`console.warn`); only the Maps page toggle may `alert`.
- **New server table?** Create it in `initDatabaseSchema` (MySQL DDL, `ENGINE=InnoDB … utf8mb4`),
  add to `COLLECTION_TABLES`/`SINGLE_TABLES` so `/api/v1/tables` exposes it, include it in the
  whole-case delete, and extend `test_structured_tables.js`.
- **New test?** Name it `test_<topic>.js`, use Node's `assert`, print `…: PASS`, and **append it to
  `package.json` `scripts.test`** (the chain is explicit; forgotten tests never run).
- **`README.md` is UTF-16 encoded.** Opening it shows spaced characters. Do not rewrite it with a
  UTF-8 tool unless you intend to convert it; several sessions deliberately left it alone.
- **CalTopo credentials stay on the server** (`.env` → `CALTOPO_CREDENTIAL_ID/SECRET`). Never add a
  client path that forwards them.
- **Never add a second way to change the data server.** The only override is the login popup's "Set
  Server" (a device cookie); the default comes from the server's `CALTOPO_SYNC` variable. Do not write
  a server URL into the login's `user_settings`, and do not make the CalTopo proxy configurable — it is
  `getCalTopoProxy()` = sync server + `/api/proxy`. `test_sync_server_config.js` pins both.
- **Do not run `git` history-rewriting or reset commands**; do not commit unless asked.

---

## 6. How to verify work

```powershell
node --check app.js            # syntax (app.js is too big to eyeball)
node --check sync-server.js
node test_structured_tables.js # one suite
npm test                       # everything in package.json (takes a while; some suites load app.js in a vm)
npm start                      # server on :3000; GET /api/health shows which .env paths were checked
```

Test patterns to copy:
- **vm sandbox over the real `app.js`** — `test_personnel_role_toggles.js`, `test_sync_outbox.js`:
  fake `localStorage`, `document.body.dataset.page`, scripted `fetch` that records requests.
- **Static wiring assertions** — `test_row_level_sync.js` pins function names/call shapes with regexes.
  If you rename `saveBundle`→`pushBundleDelta`, `syncWithServer` 404-seed branch, etc., update them.
- **Pure server transforms** — `test_structured_tables.js` calls `buildStructuredPlan` with no DB.
- **Endpoint tests** — `test_row_sync_endpoint.js`, `test_case_delete.js` spin the Express app.

Manual UI checks have no automation: state exactly what you clicked and on which page in your summary.

---

## 7. Lessons learned (append here — newest at the bottom)

- **2026-08-01 — Cursor yanked while typing.** Symptom: focus lost mid-edit. Cause: `focusout`
  debounced pull → `refreshSyncUI()` rebuilt the table while the next cell was focused. Rule: gate
  every server-driven rebuild with `isEditingActive()`/`isUserActionActive()` and reschedule.
  (plan: `home-saved-cases-and-login-fixes.md`)
- **2026-08-29 — Shared PIN leaked cases between logins.** Cause: bucket suffix was the PIN. Rule:
  bucket = case + URL-safe **username**; server also filters by `userName` (defense in depth).
  (plan: `per-user-isolation-delete-and-header.md`)
- **2026-08-29 — Corrupt case could not be deleted.** Cause: Delete required a loadable local copy and
  only removed the local entry, so sync resurrected it. Rule: deletes are server-side, whole-bucket,
  and must work without parsing the bundle. (`DELETE /api/v1/:bucket`)
- **2026-08-29 — 1.7-acre shape imported as 615 acres.** Cause: shoelace `polygonArea` assumed a
  closed ring; CalTopo native shapes arrive open, so the closing edge was skipped and large lon/lat
  terms failed to cancel. Rule: iterate rings cyclically, translate to the first vertex before
  multiplying, close rings in `calculateGeometry`. Regression test: `test_caltopo_area_calculation.js`.
- **2026-08-29 — Highlight color ignored in Light Mode / theme flash.** Cause: palette on `body.`
  shadowed inline vars on `<html>`; theme applied only after server round-trips. Rule: `html.light-mode`,
  pre-paint hint in `theme-boot.js`, re-apply theme on profile save.
  (plan: `light-mode-and-highlight-accent.md`)
- **2026-08-29 — Plans are not proof of implementation.** `record-par-checks-to-db.md` designs a
  `par_checks` structured table, but no code references `par_checks` anywhere in the repo (its steps
  carry no ✓). Rule: trust a plan only where its `### ✓ Step` markers are set, and grep the code before
  repeating a plan's claim in this file.
- **2026-09-03 — Imported segments vanished after ~1 s.** Cause chain: a renamed constant left
  `SYNC_SNAPSHOT_STORAGE_KEY` undefined (swallowed by try/catch) → every save became a whole-file
  `PUT` with `keepalive` → browsers rejected > 64 KiB bodies silently → stale server copy →
  `pullCurrentPageData()` blindly replaced the page. Rules: §4 items 1–5; a static guard now fails the
  build for undeclared `*_STORAGE_KEY`s. (plan: `finish-outbox-sync-fix-segment-loss.md`)
- **(undated, from `test_personnel_role_toggles.js`) — GPS/Radio/Medic toggles reset instantly.**
  Cause: `sanitizeBundle()` dropped `permanentPersonnel` because it was not in the key list. Rule: every
  new bundle key goes into `sanitizeBundle()` and gets a round-trip test.
- **2026-09-09 — Bootstrapping this file.** No `AGENTS.md` existed; knowledge lived only in
  `.junie/plans`. Rule: keep §7/§8 current at the end of each session (see §0).
- **2026-09-09 — Boot overlay not seen / theme still flashed.** Symptom: no 80% overlay + spinner on
  load; light-mode users saw a dark first paint (and dark users a white one). Cause: `theme-boot.js`
  ran *after* `<link styles.css>` and the overlay/canvas CSS lived only in `styles.css`, so nothing
  was in force before the stylesheet arrived, and a cached stylesheet could hide the overlay entirely.
  Rule: `theme-boot.js` is the first tag in `<head>` and injects its own critical CSS
  (`#sar-boot-style`); `test_user_preferences_assets.js` pins the order and that `styles.css` has no
  `sar-booting::` rules. Bump `?v=` when touching it.
- **2026-09-09 — vm-sandbox tests and `deepStrictEqual`.** Symptom: an object that printed identically
  to the expectation failed `assert.deepStrictEqual`. Cause: objects created inside the `vm` context
  have the context's `Object.prototype`, and `deepStrictEqual` compares prototypes. Rule: pass sandbox
  values through `JSON.parse(JSON.stringify(...))` (`plain()` in the tests) before deep-equal asserts.
  Also: `computeBundleChanges` descends one level into a top-level object, so a new section like
  `lostPersonBehavior` travels as `['lostPersonBehavior', '<key>']` changes — `describeChangeTarget`
  maps them by `path[0]`, so server mirrors must key off the section, not the full path.
  (plan: `lost-person-behavior-psr-adjustment.md`)
- **2026-09-09 — Settings full-width panels overflowed the grid.** Cause: `.home-panel.full-width` used
  `grid-column: span 3` while `.home-grid` had only 2 columns, so the browser created an implicit
  third column. Rule: full-width panels use `grid-column: 1 / -1`; give a page its own grid modifier
  (`settings-grid`) instead of changing the shared `.home-grid` column count.
- **2026-09-09 — Geek Mode scope.** "Per login" was not enough: several people share one login
  username and pick themselves from the accounts list, and not all of them want the dense layout.
  Rule: a *look-and-feel* preference is scoped to the **selected user account** (`data-setting-scope=
  "user"`), but stored in the login's `user_settings` record keyed by account name
  (`geekModeByUser`) — the account records in `bundle.accounts` are per case, so writing it there
  (as the theme is) would make it forget itself in the next CASE #. `test_user_preferences_assets.js`
  parses `settings.html` with a regex that expects `data-setting-scope` to be the *first* attribute
  after `class`; put new panel attributes after it. Also: a dynamic label set by a table builder
  (`sortLabel.textContent = …`) cannot be abbreviated in JS without touching every builder — hide it
  with `.geek-full` and show a static `.geek-abbr` sibling instead.
  (plan: `geek-mode-per-user-compact-panels.md`)
- **2026-09-09 — CalTopo color push rate-limited (10 s cooldown / 1 min heartbeat).** Two traps found on
  the way. (1) `updateCalTopoAssignmentOverlay` used to `saveBundle` on *every* push; with a heartbeat
  that would have re-saved the heavy `maps` section every minute on every device (each `/state` poll
  then re-downloads it everywhere). Rule: a periodic re-push saves only on a real local change
  (compare `captureCalTopoFeatureStyle` before/after). (2) `runCalTopoAssignmentOverlayRefresh` tested
  `typeof refreshCalTopoIframe === 'function'` — that is a closure inside `buildMapsPage`, so the branch
  was dead at global scope; it was removed rather than "fixed" (a 10 s iframe reload would be unusable).
  Testing: `test_caltopo_color_sync_schedule.js` drives `Date`/`setTimeout`/`setInterval` from a manual
  clock (`createClock().advance(ms)`) — copy it for any timer-based feature instead of the `setTimeout:
  () => 0` stubs (which silently never fire). (plan: `caltopo-color-sync-rate-limit.md`)
- **2026-09-09 — Hand-edited table rows were not editable in the DB UI.** Symptom: the planner could not
  edit single rows of `lpb_default_distances`. Cause: the table had only a composite primary key
  `(category, terrain)`; the database UI wants a single-column key to address a row. Rule: a table meant
  to be edited by hand gets a numeric `id` primary key (`ensureLpbRowIds`: `information_schema` check →
  one `ALTER TABLE … DROP PRIMARY KEY, ADD COLUMN id … AUTO_INCREMENT, ADD PRIMARY KEY (id), ADD UNIQUE
  KEY (…)` → shift ids `< 10000` up by `max(10000, hi + 1) − lo` so they cannot collide). Chain
  create → migrate → seed with promises (`runAsync().then(…)`), never as parallel `db.run` calls. Seed with
  `INSERT … SELECT … WHERE NOT EXISTS` and upsert with `INSERT … ON DUPLICATE KEY UPDATE` to keep the ids
  stable. `test_lpb_server.js` simulates the pre-id table shape and MySQL's numbering-from-1 behaviour.
  (plan: `lost-person-behavior-psr-adjustment.md`, Step 5)
- **2026-09-14 — Data server from `CALTOPO_SYNC`; Settings server/proxy sections removed.** Two things
  worth knowing. (1) A static frontend cannot read a server env var, so the server *publishes* it
  (`GET /api/config`) and the page asks for it **before anything else** in `DOMContentLoaded` (awaited,
  capped) and caches it in a cookie — otherwise the first requests of a load would go to the bootstrap
  address and the next load to the published one. Read the variable per request on the server, never
  once at start, or a test (and a Railway variable-only redeploy) sees a stale value. (2) The old
  `getCalTopoProxy()` fell back to the **production** proxy even for a localhost page, so
  `test_map_unaccounted_app.js` was silently pinned to the production URL; deriving the proxy from
  `getSyncServerUrl()` changed that to `http://localhost:3000/api/proxy` and the test's constant had to
  follow. Rule: any URL the frontend talks to must derive from `getSyncServerUrl()`, never be hard-coded.
  (plan: `caltopo-sync-variable-and-login-profile-pick.md`)
- **2026-09-14 — Post-login profile pick / "Anonymous".** The login (username + PIN) is a team; the
  person is chosen after verification. Traps: `setCurrentUser(null)` is the *logout* path (it erases the
  login cookies) — to "un-pick" someone use `sessionStorage.removeItem('sar-current-user')`. Personnel
  live per case, so before the case is in memory the picker reads the server's structured
  `personnel` table (`/api/v1/tables/personnel?case=` first, then every case) rather than the bundle;
  Anonymous is virtual (never in `bundle.accounts`, so `checkAccess`/Users page must tolerate a current
  user with no account, and `checkAccess` now also matches by name for a row that had no PIN yet).
  Testing a popup needs a fake DOM whose `querySelector` understands `.a.b` — see `makeElement` in
  `test_sync_server_config.js`. (plan: `caltopo-sync-variable-and-login-profile-pick.md`)
- **2026-09-14 — Toasts covered the header / went see-through on hover.** Cause: `showToastNotification`
  and `repositionToasts` started the stack at a hard-coded `top: 20px`, and `.notif-toast:hover` swapped
  the background for `--pill-focus` alone (a 16 % accent tint). Rules: the stack anchors at the measured
  bottom of `.site-shell > header` (`getToastStackTop`, `TOAST_STACK_GAP_PX`; re-run on `resize`; a
  hidden header measures 0, so mobile falls back to the viewport top) — z-index cannot do this because
  `.site-shell`'s `backdrop-filter` is its own stacking context, so a body-level toast always paints over
  the header. A hover tint on a translucent panel is layered `linear-gradient(tint, tint), <base>`, never
  swapped in. Test: `test_toast_stack_position.js` (extracts the two functions from `app.js` by name and
  runs them in a `vm` context with a stub `document` — cheap pattern for small DOM helpers).
- **2026-09-14 — 41 LPB categories, per-mile PSR maths, several categories at once.** Traps met while
  widening `LPB_CATEGORIES`: (1) tests that reached the only category with `getLpbCategories()[0]`,
  `walk(section).find('.lpb-chart')` or `Object.keys(defaults)` silently pointed at *Abduction* once it
  came first — address a category by `key` (`dataset.category`), never by position; (2) with one
  category the server seed test pinned ids `10000..10003` by terrain — with N×4 seeded rows derive the
  expected order from `LPB_CATEGORIES × LPB_TERRAINS` and skip the pre-existing planner row; (3) a label
  that later became a real category (`despondent`) was used as the "unknown category" in a 400 test —
  use a nonsense word. Maths rule: the additions are **summed, never compounded**
  (`factor = 1 + Σ rates/100`), each computed from the plain PSRi, so category order is irrelevant; a
  non-increasing distance pair yields `ratePercentPerMile: null` rather than `Infinity`. The Segments
  page tag now reads `+13.2%` (total gain) with the per-category breakdown in the tooltip.
  (plan: `lpb-categories-per-mile-psr.md`)
- **2026-09-14 — LPB section beside the map (Maps page), full-screen row; PSRc stale after LPB edits.**
  (1) A block that must be wider than `<main>` (1200 px) is broken out with `margin-left: calc(50% -
  W / 2); width: W` — but `W = 100vw` counts the vertical scrollbar on Windows and leaves a horizontal
  scrollbar behind. Rule: `W = var(--sar-viewport-width, 100vw)`, written on `<html>` by
  `syncViewportWidthVariable()` from `documentElement.clientWidth` and kept current by a
  `ResizeObserver` on `<html>` (a `resize` event does not fire when the scrollbar appears). (2) A
  `.table-card` is `overflow-x: auto`; a card that must scroll *inside* needs its own `overflow: hidden`
  + a flex column with a `min-height: 0; overflow-y: auto` child, and no `overscroll-behavior` (the page
  must scroll on once the column ends). (3) A half-screen column cannot use the viewport media queries —
  `.map-lpb-panel` is a query container (`container: map-lpb / inline-size`; safe because popups live on
  `<body>`) and `@container map-lpb (max-width: 620px)` repeats the LPB 768 px compact rules. (4) LPB
  edits used to leave PSRi/PSRc (and the CalTopo colors) stale until some page ran
  `recalculateEverything()`. Rule: whatever changes an *input* of the PSR maths recomputes right there —
  `saveLostPersonBehaviorChange` (`saveBundle(b, true)` → `recalculateEverything({colorSyncDelay: 0})`
  → flush), never a bare `saveBundle`. Test traps: in the fake DOM find a control by its handler
  (`typeof el.onchange === 'function'` minus `.lpb-terrain-select`), not by position; a static "no
  overscroll-behavior" assertion must scan the rule blocks, not the file (the comment says the word).
  Tests: `test_lost_person_behavior.js` (Maps render, stylesheet pins), `test_caltopo_color_sync_schedule.js`
  (LPB change → PSRc at once, push at `now` outside the cooldown / at its end inside).
  (plan: `lpb-categories-per-mile-psr.md`, Steps 4–5)
- **2026-09-14 — Background photo scrolled away; a white sheet slid up (light mode).** Cause: the photo
  was `body`'s own background with `background-attachment: fixed`, but `html, body { height: 100% }`
  makes the body box one viewport tall and `<html>` has its own canvas colour (`theme-boot.js`), so
  below the first viewport the html canvas (`#f4f7fb` / `#071022`) showed through. Rule: the page
  background is the fixed, full-viewport `body::before` (photo, from `--sar-background-image` on
  `<html>`, default `assets/us-night.jpg`) plus `body::after` (the `--bg-dim-*` tint), both `z-index: -1`
  and hidden in `@media print`; `applyBackground()` sets the custom property, never
  `body.style.backgroundImage`. Do not put a stacking context (`position`/`z-index`, `transform`,
  `filter`) on `body` or the `-1` layers would paint over the content. `test_user_preferences_assets.js`
  asserts on `documentElement.style.getPropertyValue('--sar-background-image')`.
- **2026-09-14 — Login logo on every printout.** All seven print windows (`printSingleTaskForm`,
  `downloadAllForms`, `printIcReport`, `printIncidentTimesReport`, `printCurrentReport`,
  `printAllReports`, `printSearchFile`) now open with `getPrintTitleRowHTML(bundle, title)` — the
  login's logo (`getPrintLogoHTML`, 150 px = `PRINT_LOGO_WIDTH_PX`) left of the `<h1>` in one flex row
  (`PRINT_LOGO_STYLES`, appended to `TASK_FORM_PRINT_STYLES` and the three inline style blocks); the
  Task form header got a third child (`getTaskFormPrintHTML(num, f, bundle)` — pass the bundle). Traps:
  (1) a print window is `about:blank`, so a legacy `bundle.logo` path is made absolute
  (`getPrintLogoSource`) — only the login's data: URL asset (`getLogoImageSource`) is used as is;
  (2) `_memoryStorage` is now seeded through `window.SAR_MEMORY_STORAGE` — a vm sandbox that only fakes
  `localStorage` (as `test_ic_report.js` still does) gets an empty `loadBundle()`, which is that suite's
  pre-existing `No case selected` failure; (3) top-level `const`s of `app.js` are not sandbox properties —
  read them with `vm.runInContext('NAME', sandbox)`. Test: `test_print_logo.js`.
- **2026-09-14 — "Not all users were loaded" — users moved from the case to the login.** Symptom: the
  post-login picker showed only the open case's personnel. Cause: users lived in `bundle.accounts`
  (per case) and the picker read `/api/v1/tables/personnel?case=` first. Rules: (1) the list is
  login-scoped (`login_users`, §3) and the case only mirrors it; anything that reads `bundle.accounts`
  as the source of truth is now reading a copy. (2) The overlay must run **only on a case that really is
  in memory for the open bucket** (`caseInMemory` in `DOMContentLoaded`) — running it on the empty
  stand-in a failed read leaves behind would seed a blank case with every user. (3) Deleting a person's
  Personnel row alone is not enough: `applyLoginUsersToBundle` puts the row back next load, so the delete
  must also `removeLoginUser()`, and the removal must also clear `permanentPersonnel[name]` or
  `syncPersonnelData` re-creates the row. (4) PIN uniqueness is per login: a case from before the list
  may have handed Bob the PIN that Zoe owns login-wide — claim rows by PIN **only when the row is not
  named after another present user**, then by name (`test_login_users.js` "PIN clash"). A removed
  record's PIN is free again (that is how a rename keeps its PIN). (5) `saveBundle` static guard:
  `test_row_level_sync.js` expects `pushBundleDelta(sanitized)` within 600 chars of `function saveBundle`
  — put explanations in the block comment above the function, not inline. (6) Two devices opening a case
  at once both append the same blank row; the overlay drops a second *blank* copy (`isBlankLoginUserRow`)
  and never a worked-on one. (plan: `login-wide-users.md`)

---

## 8. Open follow-ups / known rough edges

- Per-heavy-section `/state` cursors (skip `uploads`/`maps` unless the page shows them) — noted as a
  follow-up in the outbox plan; today a changed heavy section is downloaded once per device per change.
- Server `batchId` dedupe memory is per-process; a retry across a server restart could double-apply an
  `append`. Client rebase hides it visually; DB-backed batch memory would close it.
- `data.php` / `proxy.php` are not kept in lock-step with `sync-server.js` (e.g. whole-case delete,
  structured tables). Decide whether to retire or mirror before relying on them.
- Home "Saved Cases → Load" historically saved a cached bundle without switching the bucket; verify
  before extending that flow.
- **Par checks are still not first-class DB records.** `.junie/plans/record-par-checks-to-db.md` is a
  complete, unimplemented design (derive `par_checks` rows from `activityLog`; rebuild on every
  `activity_log` change). Par checks currently live only as activity-log text + `bundle.parChecks`.
- `.junie/plans/deletion-aware-lww-sync.md` is an empty placeholder — unknown whether that work happened.
- Two `patch*.js` families and scratch files clutter the root; safe to delete only with the user's OK.
- **Pre-existing test failures (not caused by the LPB session, verified against `HEAD`):**
  `test_custom_search_task.js` ("segment sweep width is carried over like a normal search": `''` vs
  `'40 ft'`) and `test_ic_report.js` ("the subtitle shows the case # without .json": `No case selected` —
  its sandbox seeds a fake `localStorage`, but the case now lives in `_memoryStorage`; hand the store in
  as `window.SAR_MEMORY_STORAGE` the way `test_print_logo.js` does to revive it).
  Neither is in `package.json` `scripts.test`, which is why `npm test` still passes.
- Lost Person Behavior follow-ups: `lpb_default_distances` holds the 0.5/1.0/1.5/2.0 placeholders for
  all 41 categories × 4 terrains (164 rows, seeded on the next server start) until the planner enters
  Koester's numbers; a new category is one entry in the right `LPB_CATEGORY_GROUPS` group
  (`map-segment-utils.js`) — the seed, the API, the sanitizer and the Incident page all loop over it.
  Labels follow the request with three spellings corrected (`Substance Intoxication`, `Mountaineer`,
  `Snowshoer`); the Child rows are labelled `Age 1-3` … `Age 13-15` in the DB too (group title only in
  the UI). The Incident section is now long (41 accordion rows); no search/filter or "collapse all" was
  added. The per-mile maths applies the request literally — a rate of 13.16 %/mi adds 13.16 % of the
  PSRi regardless of how far inside the bracket the segment lies (no distance weighting was asked for).
  A category that is on but missing a distance is skipped and named in the Segments status line.
- Maps page LPB column follow-ups: under 860 px the columns stack in DOM order — the LPB section **above**
  the map (flip with CSS `order` if the map should come first); the row is hidden when the case has no
  map (the section is then only on the Incident page); a 20 px gutter is kept at the screen edges (none
  under 600 px); before `buildMapsPage` runs the row is `100vw` wide (boot overlay hides it); container
  queries need Chrome 105+/Safari 16+/Firefox 110+ — older browsers simply get the desktop rules in the
  column. A full Maps page rebuild (`performSyncUIRefresh` after another device's change) resets the
  column's scroll position and reloads the map iframe, as it always did for the map alone.
- Segment centres come from the fetched CalTopo shape (`maps[0].features`); a segment typed by hand
  without a linked/like-named shape is never adjusted — the PSRi tooltip says so.
- Geek Mode follow-ups: only the Segments, Personnel, Search Log, Incident (LPB heading/paragraph) and
  Settings toggle areas are marked up for condensing; the Maps page toggles (`PSRc Overlay`, `PSRc
  Assignment Colors`) and the Home dashboard were left as they are. `bundle.geekMode` is still listed in
  `sync-delta.js` / `buildStructuredPlan` (`settings_page`) as a legacy key that is never written.
  The percentage input accepts 0–100; 100 removes every scaled padding entirely (allowed on purpose).
- CalTopo color sync follow-ups: the last-push clock is per **tab** (`sessionStorage`), so two tabs of
  the same device — or two devices — each heartbeat on their own schedule; the case's `updatedAt` hint
  only stops them re-pushing right after another device's *changing* push, so identical no-change
  pushes can double up. Accepted (CalTopo tolerates it); a shared per-login clock in `user_settings`
  would close it. The countdown pill therefore shows *this tab's* schedule, not a fleet-wide one.
- `CALTOPO_SYNC` follow-ups: the variable must be set on the Railway service (unset ⇒ the website keeps
  its built-in `DEFAULT_SYNC_SERVER_URL`; the server logs a `[CONFIG]` warning). `data.php`/`proxy.php`
  know nothing of `/api/config`. Old per-login settings still carry dead `sar-sync-url-v1` /
  `sar-caltopo-proxy-v1` values (ignored, never read; harmless). The old `getCalTopoProxyHealthUrl` /
  `normalizeCalTopoProxyUrl` helpers stay because `test_caltopo_php_proxy_query_params.js` and the
  `.php` proxy path use them. A localhost page whose local server publishes a remote `CALTOPO_SYNC`
  will follow it (by design — the variable is authoritative).
- Profile-pick follow-ups: Anonymous has no `bundle.accounts` record, so its theme/color/visible pages
  are the defaults and the Users page only offers "Switch User" / "Log Out" for it. A person offered
  from the personnel table of another case (not yet in `login_users`) is adopted into the list only when
  that case is next opened; until then the pick behaves like Anonymous with that name in the log tag.
- Login-wide users follow-ups: (1) the `login_users` table is filled lazily — a login's old cases hand
  their accounts to the list the first time each case is opened after this deploy (there is no one-off
  migration); the picker bridges the gap with the personnel table. (2) Removal is *soft* (`removed`
  flag) and other cases drop the person only when opened; the structured `personnel` table of a case
  nobody opens still lists them. (3) A case's Personnel row is created for every user, so the Personnel
  page of a login with many people gets long — no "hide Off Duty" filter was added. (4) `login_users` is
  not in `COLLECTION_TABLES`/`SINGLE_TABLES` (it is per login, not per case) and not part of
  `DELETE /api/v1/:bucket`. (5) The Users page "Remove" only shows for login users; the Super Admin stays
  "Built-in". `data.php` knows nothing of `/api/auth/users`. (6) `npm test` now prints a few harmless
  `[USERS] read failed: unhandled SQL in test stand-in … login_users` lines from older suites whose
  mysql2 stand-ins do not model the table (the page tolerates the 500); teach their `query` stubs the
  `SELECT … FROM \`login_users\`` shape to silence them.
- Printout logo follow-ups: the logo is the *login's* header logo (`/api/auth/assets/logo`), so a device
  that has not finished `loadUserAssets()` (or is offline with no cached asset) prints without it — no
  "logo missing" hint is shown. In the Case # Printout the IC Report block on page one keeps its plain
  title (the page's top row already carries the logo); only the stand-alone IC Report printout puts the
  logo in the `IC Report` row (`getIcReportPrintHTML(bundle, {logo: true})`). The logo is placed at its
  natural height for 150 px width; a very tall logo will make the title row tall (no `max-height`).

---

## 9. Quick orientation checklist for a new task

1. Which page? → find `data-page`, then the `build<Page>…` function in `app.js`.
2. Does it change the bundle shape? → `sanitizeBundle`, `sync-delta.js` maps, `buildStructuredPlan`, tests.
3. Does it touch sync? → re-read §4; write a vm-sandbox test that records `fetch` calls.
4. Does it touch nav/header? → `update_nav.ps1`, then run it.
5. Did you change a static asset? → bump `?v=` everywhere.
6. Added a test? → `package.json` `scripts.test`.
7. Leaving? → §0 end-of-session steps.

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
| `page10` | `page10.html` | Maps |
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
  forms, activity_log; `SINGLE_TABLES` = profile, settings_page. Plus `activity_log_entries`,
  `declined_assignment_features`, `user_assets`, `users`, `user_settings`, `user_buckets`, `store`.
- `INTERNAL_STORE_KEYS` (`bundle`, `all-files`, `user-<pin>` presence pings) are **never** a CASE #.

**Nothing is persisted on the device.** The case lives in memory for the page lifetime; the device
keeps only login cookies/sessionStorage and the sync-server URL. The `*_STORAGE_KEY` constants are
mostly keys into the **per-user server settings** (`GET/PUT /api/auth/settings`) or the in-memory
store, and `LEGACY_LOCAL_STORAGE_KEYS` is wiped at startup. Do not reintroduce localStorage caching
of case data.

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

Key endpoints: `/api/auth/{register,login,history,settings,assets[/:kind]}`,
`/api/v1/:bucket/{rows,state,activity,declined-assignments,page/:page,all-files,latest,:key}`,
`/api/v1/tables[/:table]?case=`, `/api/health`, `/api/proxy` + `/api/call` (CalTopo, signed server-side).

---

## 5. Conventions that must be followed

- **Nav changes go through `update_nav.ps1`.** Edit `$navTemplate` / `$bottomNavTemplate`, run the
  script; it regex-replaces `<nav>…</nav>` in every `*.html`. Hand-editing one page desyncs the rest.
- **Cache-busting:** every `<script>`/`<link>` include carries `?v=YYYYMMDD` (currently `20260910`).
  When you change `app.js`, `styles.css`, `sync-delta.js`, `map-segment-utils.js` or `theme-boot.js`,
  bump the stamp in **all** HTML files (search `?v=`).
- **Theme:** toggle classes on `document.documentElement`, target `html.light-mode` in CSS. Inline
  `--accent`/`--accent-rgb` on `<html>` must win over the class palette.
- **Code style:** 4-space indent in `app.js`/server (some older blocks are 2-space — match the
  surrounding function), `const`/`let`, `camelCase`, single quotes in JS. Comments are full sentences
  explaining *why*, often as a block above the constant/function — match that voice.
- **New storage/interval constant?** Declare it at the top of `app.js`. `test_sync_outbox.js` has a
  static guard: every `*_STORAGE_KEY` / `*_INTERVAL_MS` identifier used must be declared.
- **New bundle key?** Add it to `sanitizeBundle()`, to `sync-delta.js` maps if it should mirror to a
  table, and to `buildStructuredPlan` on the server if it needs its own table.
- **New server table?** Create it in `initDatabaseSchema` (MySQL DDL, `ENGINE=InnoDB … utf8mb4`),
  add to `COLLECTION_TABLES`/`SINGLE_TABLES` so `/api/v1/tables` exposes it, include it in the
  whole-case delete, and extend `test_structured_tables.js`.
- **New test?** Name it `test_<topic>.js`, use Node's `assert`, print `…: PASS`, and **append it to
  `package.json` `scripts.test`** (the chain is explicit; forgotten tests never run).
- **`README.md` is UTF-16 encoded.** Opening it shows spaced characters. Do not rewrite it with a
  UTF-8 tool unless you intend to convert it; several sessions deliberately left it alone.
- **CalTopo credentials stay on the server** (`.env` → `CALTOPO_CREDENTIAL_ID/SECRET`). Never add a
  client path that forwards them.
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

---

## 9. Quick orientation checklist for a new task

1. Which page? → find `data-page`, then the `build<Page>…` function in `app.js`.
2. Does it change the bundle shape? → `sanitizeBundle`, `sync-delta.js` maps, `buildStructuredPlan`, tests.
3. Does it touch sync? → re-read §4; write a vm-sandbox test that records `fetch` calls.
4. Does it touch nav/header? → `update_nav.ps1`, then run it.
5. Did you change a static asset? → bump `?v=` everywhere.
6. Added a test? → `package.json` `scripts.test`.
7. Leaving? → §0 end-of-session steps.

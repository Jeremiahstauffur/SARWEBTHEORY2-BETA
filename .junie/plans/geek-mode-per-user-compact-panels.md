---
sessionId: session-260909-231156-e6po
---

# Requirements

### Overview & Goals
Geek Mode (Settings page) existed as a login-wide "one third spacing" switch. This session makes it:

1. **Stored in the database per user account of the logged-in username** — people who share a login
   username pick themselves from the accounts list; each keeps their own Geek Mode choice. Never part of
   the case (CASE #).
2. **A real dense layout**: while on, the large toggle sections (Segments page *Sorting*, *Lost Person
   Behavior*, *Actions*; the Settings panels; the Personnel / Search Log sort switches; the Incident page
   LPB heading) collapse to abbreviated titles next to their controls — e.g. **LPB**, **Sort by PSRc** —
   shrinking in **width as well as height**.
3. **A user-entered percentage** (a pill number field in the Geek Mode panel) by which the padding of
   every pill button, label and text field is reduced.

### Scope
**In**: `app.js` preference plumbing + Settings bindings, `styles.css` Geek Mode block, `theme-boot.js`
hint flag, markup in `page2/3/4.html`, `settings.html`, Incident LPB header (JS-rendered), tests, docs.
**Out**: Maps page inline toggles, Home dashboard panels, any server/table change (none needed).

### Functional Requirements
- Geek Mode ON/OFF and the padding percentage are kept in `user_settings` (login username) under the
  **selected user account** (`geekModeByUser[accountName]`); the login-level keys remain as fallback.
- Percentage: whole number 0–100, default 67 (= the former one-third spacing); clamped; unusable input
  reverts to the stored value. Applied immediately when Geek Mode is on.
- Condensed panels show only the short title + control; descriptions and headings are hidden; the
  panel is only as wide as its content. Full status text stays reachable as a tooltip (LPB panel).
- First paint honours the choice (hint cookie `dark,geek,pad67`).

# Technical Design

### Storage
```js
// user_settings[username]['sar-user-preferences-v1']
{
  geekMode: true, geekPaddingPercent: 67,          // login-level fallback (legacy records)
  geekModeByUser: { Alex: {enabled: false, paddingPercent: 50}, 'Super-Admin': {...} }
}
```
`getGeekModeRecord(user = getCurrentUser())` → `{enabled, paddingPercent}`; `saveGeekModePreference(patch)`
writes the account entry (or the fallback when no account is picked). `applyGeekMode(enabled, percent)`
toggles `html.geek-mode` and sets `--geek-space-scale` (= (100 − percent) / 100) inline on `<html>`;
`rememberUiHint` appends `geek,pad<percent>`; `theme-boot.js` parses `pad(\d+)` before the first paint.
`setCurrentUser()` refreshes the hint so the reload after picking an account paints right.

### CSS (`styles.css`, "Geek Mode" block at the end)
- `html.geek-mode { --space-scale: var(--geek-space-scale, calc(1 / 3)); }`
- `.pill-cell / .pill-input / .psr-cell-container / .header-pill` min-heights scaled so padding rules.
- `.home-panel[data-geek-compact]`: inline-flex, `> h2/h3/p` hidden, `::before { content: attr(data-geek-title) }`,
  `.home-grid` → wrapping flex row (compact panels `flex: 0 0 auto`, full-width `1 1 100%`).
- `.geek-full` hidden / `.geek-abbr` shown in Geek Mode; Settings scope pill becomes inline (`order: 99`).
- Incident: `.lpb-section-header p` hidden; heading rendered as `geek-full`/`geek-abbr` spans ("LPB").

### Markup
`page2.html`: Sorting → `data-geek-title="Sort by PSRc"`, LPB → `id="lpb-panel" data-geek-title="LPB"`,
Actions → `data-geek-compact`. `page3.html` / `page4.html`: sort/filter labels get `.geek-full` +
`.geek-abbr` ("On Scene", "By Team", "Newest First"). `settings.html`: Delete Mode, Background, Logo,
Theme (two abbr labels), Tips, PAR (+"min"), Map Check, Geek (+ `#geek-padding-input`); Geek Mode panel
is now `data-setting-scope="user"`.

### Risks
- A dynamic label rewritten by a builder would undo a JS abbreviation → hidden via CSS instead.
- `bundle.accounts` is per case, so the account itself was *not* used as storage (would reset per CASE #).

# Testing

`test_user_preferences_assets.js` (vm sandbox over the real `app.js` + real `sync-server.js`):
- hint `light,geek,pad50` → `--geek-space-scale: 0.5` before app.js; legacy `dark,geek` keeps the CSS fallback.
- load with login-level `geekMode: true` → class on, scale `0.33`, input `67`, cookie `dark,geek,pad67`.
- percentage 50 / 250→100 / `abc`→kept, stored under `geekModeByUser.Alex`, never in the case.
- switch off for Alex; Sam (same login) still gets the default ON; back to Alex → off, 50 %; only
  changed accounts get an entry.
- static markup/CSS assertions for every condensed panel and label.
Also `node --check app.js`, `npm test` (all suites pass).

Manual checks to do in a browser (not automated): Settings → Geek Mode ON, enter 50 → pills shrink;
Segments page shows `Sort by PSRc [switch]`, `LPB [switch]` (hover for status), `[Import JSON]` in a
single wrapping row; pick another user → their own Geek Mode state after reload.

# Delivery Steps

### ✓ Step 1: Per-account storage + percentage preference (`app.js`)
### ✓ Step 2: `--geek-space-scale` / hint flag (`styles.css`, `theme-boot.js`)
### ✓ Step 3: Condensed panel CSS + markup (`styles.css`, `page2/3/4.html`, `settings.html`, LPB header)
### ✓ Step 4: Settings panel: percentage pill, user scope, status text
### ✓ Step 5: Tests, `?v=20260913` bump, `AGENTS.md` §3/§5/§7/§8

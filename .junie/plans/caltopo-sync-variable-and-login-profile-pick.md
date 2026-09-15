---
sessionId: 2026-09-14-caltopo-sync-variable-and-login-profile-pick
status: done
---

# Data server from `CALTOPO_SYNC`; profile pick after login

## Requirements (from the issue)

1. Remove the Settings page sections "Data Synchronization" (sync-server URL) and "CalTopo Proxy
   Settings" (proxy URL, status pill, "Help Me Setup" walkthrough).
2. The **only** way to change the data (sync) server is: log out → login popup → "Set Server".
3. The website takes the sync server to use from the Railway variable **`CALTOPO_SYNC`**.
4. *(follow-up)* After username + PIN are verified, the login popup asks which **user profile** the
   person is using. Default is a user called **"Anonymous"** (never the Super-Admin); the list offers
   every personnel stored under that login username.

## Design

### Server (`sync-server.js`)
- `getConfiguredSyncServerUrl(env)` reads `CALTOPO_SYNC` (Railway variable or `.env`), accepts only an
  absolute `http(s)://` URL, strips trailing slashes, else `''`. Read **per request**, not at start.
- `GET /api/config` (public, `Cache-Control: no-store`) → `{syncServerUrl, caltopoProxyUrl, source}`;
  `GET /api/health` also carries `syncServerUrl` / `syncServerUrlSource`. Start-up log names the value.
- Exported for tests: `CALTOPO_SYNC_ENV_KEY`, `getConfiguredSyncServerUrl`, `getPublishedSyncConfig`.

### Frontend (`app.js`)
- New cookie `SYNC_URL_CONFIG_STORAGE_KEY` (`sar-sync-url-config-v1`) = the address the server published.
  `loadSyncServerConfig()` runs **first** in `DOMContentLoaded` (awaited, 6 s cap): asks the current
  server, then the bootstrap `DEFAULT_SYNC_SERVER_URL` (not from a localhost page) for `/api/config`;
  stores the answer (or clears the cookie when the variable is unset); leaves everything alone when
  nothing answers; ignores an `http://` address on an `https://` page.
- `getSyncServerUrl()` precedence: **Set Server cookie → published (`CALTOPO_SYNC`) → localhost:3000
  (local page) → `DEFAULT_SYNC_SERVER_URL`**. `getDefaultSyncServerUrl()` = published || bootstrap; used by
  "Use Default", the Test fallback and the connection-error text. `getAuthServerUrlCandidates()` =
  device → published → bootstrap. The `_serverSettings[SYNC_URL_STORAGE_KEY]` branch and constant are gone.
- `getCalTopoProxy()` = `<getSyncServerUrl()>/api/proxy` (derived every call). Removed:
  `CALTOPO_PROXY_STORAGE_KEY`, `setCalTopoProxy`, `checkProxyHealth`, `startCalTopoSetupWalkthrough`, and
  the whole Settings wiring block. "No proxy" messages now point at "Set Server".
- Profile pick: `ANONYMOUS_USER_NAME/PIN`, `createAnonymousUser()`, `isAnonymousUser()`,
  `buildLoginProfileChoices(rows)` (Anonymous default → personnel A-Z → Super Admin),
  `fetchLoginProfilePersonnel()` (`GET /api/v1/tables/personnel?case=<open case>`, then without `?case`),
  `showLoginProfilePopup(choices, onPick)`. Login/Register success: cookies set, `sar-current-user`
  cleared, settings read, picker shown, `setCurrentUser(pick)` → reload. Boot with no current user
  → Anonymous (or the in-page picker after `requestUserSwitch()`, flag `sar-open-user-popup`).
  `checkAccess()` also matches an account by name; `showUserSelectionPopup()` lists Anonymous first;
  Users page explains Anonymous has no profile.

### HTML
- `settings.html`: both panels removed (10 `data-setting-scope` panels remain). `?v=` → `20260916` everywhere.

## Tests
- New `test_sync_server_config.js` (15 checks; in `package.json`): server normalisation + `/api/config`
  + `/api/health`; frontend precedence/cookie/proxy/candidates; static "no Settings wiring"; profile
  choices, server read (case first, all as fallback), picker behaviour, login-path wiring, boot default.
- Updated `test_user_preferences_assets.js` (panel list), `test_map_unaccounted_app.js` (proxy is the
  localhost sync server in the sandbox).

### ✓ Step 1 — server variable + `/api/config`
### ✓ Step 2 — frontend resolution order, derived proxy, Settings removal, cache stamp
### ✓ Step 3 — post-login profile pick (Anonymous default)
### ✓ Step 4 — tests (`npm test` green), AGENTS.md updated

## Manual checks still worth doing (no automation)
- Railway: set `CALTOPO_SYNC=https://<service>.up.railway.app`, redeploy, open `/api/config`.
- Log out → login popup → "Set Server" → "Use Default" shows the published address.
- Log in → "Who is using this device?" → "Continue as Anonymous" → header shows "A"; Users page →
  "Switch User" → picker on Home.

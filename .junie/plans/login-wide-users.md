---
sessionId: login-wide-users-2026-09-14
status: done
---

# Users belong to the login, not to a CASE #

## Requirement (from the user)

- Not all users were loaded in the post-login picker: it read the personnel of the **open case** first.
- The website authenticates username + password and then gets **the list of users stored under that
  username** — never under username + case #. The list is not reachable before the credentials are verified.
- Every user is listed **in every case**; a case never restricts who is available. Only the user's
  **status** (their Personnel row: team, status, times) is per case. The **name, color and theme
  preferences** travel with the login across all cases.
- Clarified: every login user gets a Personnel row in every case automatically (blank team/status);
  users are created on the Personnel page (typing a name) **and** on the Users page; the Users page's
  Remove takes a user off the login (all cases).

## Design

### Server (`sync-server.js`)
- New table **`login_users`** — `PRIMARY KEY (username, user_key)` where `user_key` = trimmed,
  lower-cased name. Typed columns (`user_name, pin, handle, color, theme, is_file_manager, removed`)
  for the DB UI + `record` (the whole account JSON) + `updatedAt`.
- `GET /api/auth/users` → `{users:[…]}` (removed ones included, flagged) — `authMiddleware`.
- `PUT /api/auth/users {users:[…]}` → upsert by name (`INSERT … ON DUPLICATE KEY UPDATE`, never
  `REPLACE`), **never deletes**; a removal is `removed: true`. Answers the whole list.
- `normalizeLoginUser` rejects the Super Admin (name or PIN 1976) and Anonymous.

### Frontend (`app.js`, section "The login's users")
- `_loginUsers` in memory for the page lifetime; `loadLoginUsers()` starts right after
  `loadServerSettings()` in `DOMContentLoaded` and is awaited before the case is drawn.
- `applyLoginUsersToBundle(bundle)` (once per load, only when the case for the open bucket really is in
  memory): adopts case-only accounts into the list (fresh PIN if theirs is taken by a *present* user),
  sets `bundle.accounts = [Super Admin, …login users]`, gives every user a Personnel row (`Off Duty`,
  not on scene, PIN linked, remembered GPS/Radio/Medic kept), claims rows by PIN then name, drops rows
  + `permanentPersonnel` of removed users, drops a duplicate *blank* row (two devices appending at once).
- `syncLoginUsersFromBundle(sanitized)` runs inside `saveBundle` → a name typed on the Personnel page
  (the sanitizer makes it an account) / an edited account / colour / theme is PUT to the login at once.
- `removeLoginUser(name)` (Users page "Remove", Personnel row delete) flags the record and drops the
  person from the open case; other cases drop them when next opened. Typing the name again revives it.
- `noteLoginUserRename(old, new)` retires the old name; the new one is adopted on save (PIN kept —
  a removed record's PIN is free).
- Picker: `fetchLoginProfileChoices()` = `/api/auth/users` ∪ `/api/v1/tables/personnel` (ALL cases,
  no `?case=`), Anonymous default, Super Admin last, removed users hidden.
- `checkAccess` merges `{...pick, ...caseAccount}` so the login's record wins over a stale pick.
- New case (`Create` popup) runs `applyLoginUsersToBundle(newBundle)`.

## Tests
- `test_login_users.js` (10 checks): server normalisation, schema, both routes over HTTP (401/400,
  upsert, removed flag), overlay (adoption, PIN clash, rename by PIN, removed rows, duplicate blank),
  save hook, remove/rename, no-op without the list, static wiring.
- `test_sync_server_config.js` check 11 rewritten: no `?case=` read; list PIN/colour/theme win over rows.

### ✓ Step 1 server table + endpoints
### ✓ Step 2 frontend list, overlay, save hook
### ✓ Step 3 Users page Add/Remove, Personnel delete, picker, new case
### ✓ Step 4 tests + `?v=20260918` bump + AGENTS.md

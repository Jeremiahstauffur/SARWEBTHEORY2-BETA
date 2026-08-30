---
sessionId: session-260829-225046-1ggy
---

# Requirements

### Overview & Goals
When an operator updates a team's status (or assigns a task), the app should always let them confirm/adjust the timestamp of the update — not only for skipped (missing) intermediate steps. Today, the timestamp popup (`showMissingStepsPopup` in `app.js`) only appears when one or more steps are skipped, and it only collects times for the *skipped* steps. The step actually being applied ("current step"), and the assignment event, silently use the wall-clock time.

The goal is that **every** team update prompts for a timestamp, the current step is always included, and the current time is always pre-filled as the default.

### Scope
#### In Scope
- Always show the timestamp popup on team updates, even when **no** step is skipped.
- Include the **current/target step** in the editable timestamp list (in addition to any skipped steps).
- Apply this to **all** update flows: status progressions (Leave Base, Begin Assignment, Finish Assignment, Return to Base, Arrived at Base) **and** the assignment flows ("Assign New Task" popup and auto-assign-from-segment).
- Always pre-fill the current date/time as the suggested default for every step (editable via the existing edit-time popup).
- Ensure the chosen timestamp for the current step is used for the resulting status change, activity-log entry, and related time fields (instead of `Date.now()` / recomputed wall-clock).

#### Out of Scope
- Changing the ordering/validation of timestamps (no chronological enforcement).
- Redesigning the status sequence or the edit-time popup UI.
- Par-check and "call all teams to base" bulk flows (separate function `callAllTeamsToBase`).

### User Stories
- As an operator, when I mark a team's status and I skipped steps, I want to set the time for the skipped steps **and** the step I'm applying now, so the log is accurate.
- As an operator, when I mark a team's status with no skipped steps, I still want to confirm/adjust the time of this update, defaulted to now.
- As an operator, when I assign a task to a team, I want to confirm/adjust the time of the assignment, defaulted to now.

### Functional Requirements
1. The timestamp popup appears on every team-update and assignment action.
2. The popup lists all relevant steps in a **single uniform list**: any skipped intermediate steps plus the current step (or, for assignment, a single "assignment" entry).
3. Every entry defaults to the current date/time and is editable via the existing `showEditTimePopup`.
4. On submit, the chosen timestamp of the current step drives the status update, the `teamStatuses`/time fields, and the activity-log entry.
5. If nothing is skipped, the popup still shows exactly one entry (the current update).

# Technical Design

### Current Implementation
All logic lives in `app.js`.

- `showMissingStepsPopup(teamName, targetStatus, onComplete)` (line ~5336):
  - Builds `sequence` (5 ordered steps) and computes `missingSteps = sequence.slice(currentIndex + 1, targetIndex)`.
  - If `missingSteps.length === 0` it calls `onComplete()` immediately (no popup).
  - Otherwise it renders a row per missing step with an editable timestamp (default = now) using `showEditTimePopup`, then on **Submit** applies each missing step's status/log via `addActivityLogEntry(..., d, t)` and calls `onComplete()`.
- `getStatusIndex(status)` (line ~5035) maps a status string to an index; returns `-1` for `assigned`/unknown/null.
- Callers of `showMissingStepsPopup`:
  - `showTeamUpdatePopup` → `updateStatus(newStatus, logAction)` (line ~5053) for `headed to assignment`, `searching`, `finished segment`, `returning`. Its `onComplete` sets `teamStatuses`, `teamLeaveTimes`, `parChecks` with `Date.now()` and logs via `addActivityLogEntry(teamName, logAction)`.
  - `showTeamUpdatePopup` → `at base` branch (line ~5076): recomputes `timeStr` from `now`, sets `at base (${timeStr})`, logs `Arrived at base at ${timeStr}`.
  - Auto-assign from segments page (line ~3594, `targetStatus = null`).
  - `showNewSegmentPopup` "Assign Selected Task" (line ~5237, `targetStatus = null`): sets `currentAssignments`, `teamAssignmentTimes = Date.now()`, `teamStatuses = 'assigned'`, logs assignment.
- `addActivityLogEntry(team, action, bundle, membersOverride, customDate, customTime)` (line ~5625) already supports a custom date/time and derives a millisecond `timestamp` from them.

### Key Decisions
- **Always show the popup, uniform single list** (per user choice): the current/target step is appended to `missingSteps` and rendered in the same editable list; every entry defaults to the current time. No separate heading for the current step.
- **Pass the chosen timestamp of the current step back to callers.** Change the `onComplete` contract from `onComplete()` to `onComplete(currentStamp)` where `currentStamp = { date, time, timestampMs }`. This keeps the popup responsible for status/time capture while callers keep their existing side-effects, now driven by the chosen time instead of `Date.now()`.
- **Assignment (null target) flows** get a single synthetic "current update" entry (e.g. label `Assign Task`) so they too always prompt for one timestamp; no intermediate steps are computed for them.
- **No double-application**: the popup continues to apply only the *intermediate/skipped* steps internally; the current/target step remains applied by the caller's `onComplete`, now using `currentStamp`.

### Proposed Changes
1. **`showMissingStepsPopup`**
   - Build the render list as `stepsToShow = [...missingSteps, currentStep]`, where `currentStep` is derived from `targetStatus` (the matching `sequence` entry) or, when `targetStatus` is null, a synthetic `{ id: '__current__', label: 'Assign Task', log: null }` marker.
   - Remove the early `onComplete()` short-circuit so the popup always renders (there is always at least the current entry).
   - Keep per-row default of current date/time and the `showEditTimePopup` edit path.
   - On Submit: apply only the *intermediate* (missing) steps to the bundle/log as today; then compute `currentStamp` from the current step's chosen `date`/`time` (reuse the ms conversion logic from `addActivityLogEntry`) and call `onComplete(currentStamp)`.
2. **`updateStatus` (in `showTeamUpdatePopup`)**: accept `currentStamp`; replace `Date.now()` for `teamLeaveTimes`/`parChecks` where appropriate with `currentStamp.timestampMs`, and log via `addActivityLogEntry(teamName, logAction, null, null, currentStamp.date, currentStamp.time)`.
3. **`at base` branch**: use `currentStamp.time` for the `at base (${time})` status string and the arrival log, and `currentStamp.timestampMs` for `teamAssignmentTimes`.
4. **Assignment flows (lines ~3594 and ~5237)**: accept `currentStamp`; use `currentStamp.timestampMs` for `teamAssignmentTimes`/`parChecks` and `currentStamp.date`/`currentStamp.time` for the assignment activity-log entry.

### Data Models / Contracts
```js
// New onComplete contract
// currentStamp = { date: 'MM-DD-YYYY', time: 'hh:mm', timestampMs: <number> }
showMissingStepsPopup(teamName, targetStatus, (currentStamp) => { /* apply current step using currentStamp */ });
```
The ms conversion mirrors `addActivityLogEntry`:
```js
const [mm, dd, yyyy] = date.split('-');
const timestampMs = new Date(`${yyyy}-${mm}-${dd}T${time}:00`).getTime();
```

### File Structure
- Modified: `app.js` (single file) — `showMissingStepsPopup` and its four call sites.

### Risks
- **Backward compatibility of `onComplete`**: all four call sites must be updated together, or a caller passing no arg would break. Mitigation: update every call site in the same change and default `currentStamp` safely inside the popup.
- **Assignment flow status index**: with `targetStatus = null`, `getStatusIndex` returns `-1`; ensure the missing-step slice is bypassed for null targets so no spurious intermediate steps appear.
- **Timestamp parsing**: malformed manual edits could yield `NaN` ms; fall back to `Date.now()` when parsing fails.

# Testing

### Validation Approach
Manual verification in the running web app (open the relevant page, use the team-update popup) plus, if practical, extending the existing lightweight Node test scripts pattern found in the repo root (e.g. `test_*.js`).

### Key Scenarios
- Update a team **skipping steps** (e.g. from `assigned` directly to `returning`): popup lists each skipped step **plus** the current step, all defaulting to now; editing times is reflected in statuses and the activity log.
- Update a team with **no skipped steps** (e.g. `searching` → `finished segment`): popup still appears with a single current-step entry defaulting to now; chosen time drives the status change and log entry.
- **Arrived at Base**: `at base (hh:mm)` status and the arrival log use the chosen time.
- **Assign New Task** and **auto-assign from segment**: popup shows one assignment entry defaulting to now; `teamAssignmentTimes` and the assignment log use the chosen time.

### Edge Cases
- Cancelling the popup makes no bundle/log changes.
- Manually edited invalid date/time falls back gracefully (no crash; defaults to now).

# Delivery Steps

### ✓ Step 1: Always show timestamp popup with the current step included
`showMissingStepsPopup` always renders and includes the current/target step in one uniform, editable list defaulting to the current time.

- Remove the `missingSteps.length === 0` early `onComplete()` short-circuit in `showMissingStepsPopup` (app.js ~5336).
- Derive the current step from `targetStatus` (matching `sequence` entry) or a synthetic `{ id:'__current__', label:'Assign Task' }` when `targetStatus` is null; skip missing-step computation for null targets.
- Build the rendered list as `[...missingSteps, currentStep]`, each row defaulting to the current date/time and editable via `showEditTimePopup`.
- On Submit, apply only the intermediate (skipped) steps to the bundle/log as before, then compute `currentStamp = { date, time, timestampMs }` for the current step (reusing the ms-conversion logic from `addActivityLogEntry`) and call `onComplete(currentStamp)`.

### ✓ Step 2: Drive status-progression updates from the chosen current timestamp
The status-progression flows in `showTeamUpdatePopup` apply the update using the user-chosen timestamp instead of wall-clock time.

- Update `updateStatus(newStatus, logAction)` (app.js ~5053) to accept `currentStamp` and use `currentStamp.timestampMs` for `teamLeaveTimes`/`parChecks`, and `addActivityLogEntry(teamName, logAction, null, null, currentStamp.date, currentStamp.time)` for logging.
- Update the `at base` branch (~5076) to build the `at base (${time})` status string and the arrival log from `currentStamp.time`, and set `teamAssignmentTimes` from `currentStamp.timestampMs`.
- Verify statuses, time fields, and activity-log entries reflect the chosen time for both skipped-step and no-skip cases.

### ✓ Step 3: Prompt and apply chosen timestamp for assignment flows
The assignment (null-target) flows always prompt for a single timestamp and apply it.

- Update the auto-assign-from-segment caller (app.js ~3594) and the "Assign Selected Task" caller in `showNewSegmentPopup` (~5237) to receive `currentStamp`.
- Use `currentStamp.timestampMs` for `teamAssignmentTimes` and `parChecks`, and `currentStamp.date`/`currentStamp.time` for the assignment activity-log entry.
- Confirm the popup shows a single assignment entry defaulting to now and that cancelling makes no changes; add a safe fallback to `Date.now()` when manual date/time parsing fails.
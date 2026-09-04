// Regression tests for "Custom" (manually entered) searches.
//
// From the Segments page the search popup offers a "Custom" team. Picking it
// creates a Search Log row plus a Task Assignment form without driving any
// team status / par-check workflow. The form is the single source of truth:
// its personnel list gives the Search Log its "(N)" member count, its par
// checks are typed in by hand, and the task counts as still-out (segment drawn
// in the active-search style on the map, no sweep count asked for) until the
// form is marked completed.
//
// Run with: node test_custom_search_task.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';

function makeElement(depth = 0) {
    const el = {
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {add() {}, remove() {}, contains: () => false, toggle() {}},
        children: [],
        appendChild(child) { el.children.push(child); return child; },
        append() {},
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        querySelector: () => makeElement(),
        querySelectorAll: () => [],
        insertBefore() {},
        after() {},
        focus() {},
        textContent: '',
        innerHTML: ''
    };
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

function createSandbox(store) {
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const cookieJar = {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = 'page5';
    const document = {
        get cookie() {
            return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set cookie(value) {
            const [pair] = String(value).split(';');
            const idx = pair.indexOf('=');
            if (idx <= 0) return;
            cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        },
        body,
        documentElement: makeElement(),
        head: makeElement(),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        createElement: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const sandbox = {
        console: {log() {}, info() {}, warn() {}, error() {}},
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        localStorage,
        sessionStorage: localStorage,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: () => Promise.reject(new Error('Failed to fetch')),
        alert() {},
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: 'http://localhost/page5.html', search: ''}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    return sandbox;
}

// A search file with one segment and one roster team (Alpha) that is out on a
// normal search of a second segment, so custom and normal tasks coexist.
const store = {};
store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-1'});
const app = createSandbox(store);
{
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-1';
    // One region with a consensus, so PSR values can be computed.
    bundle.pages.index.rows = [['R1', '50', '50', '50', '']];
    bundle.pages.page2 = [
        ['R1', 'Seg A', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', ''],
        ['R1', 'Seg B', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', '']
    ];
    bundle.pages.page3 = [
        ['Jane Doe', 'Alpha', 'Jane Doe', 'true', '', '', 'On-Scene', '', '', '', '', '', '', ''],
        ['John Roe', 'Alpha', 'Jane Doe', '', 'true', '', 'On-Scene', '', '', '', '', '', '', '']
    ];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
}

// Team Alpha starts a normal search on Seg B (task #1).
const alphaTask = app.addAutoSearchLogEntry('Alpha', 'R1', 'Seg B');
{
    const b = app.loadBundle();
    b.currentAssignments['Alpha'] = `#${alphaTask} R1 - Seg B`;
    b.teamStatuses['Alpha'] = 'searching';
    app.saveBundle(b);
}
assert.strictEqual(alphaTask, 1);

// --- 1. A custom search creates the log row + form and takes the next task # -
const taskNum = app.createCustomSearchTask('R1', 'Seg A');
assert.strictEqual(taskNum, 2, 'custom task takes the next task number');
let bundle = app.loadBundle();
const row = bundle.pages.page4.find(r => r[0] === '#2');
assert.ok(row, 'a Search Log row is created for the custom task');
assert.strictEqual(row[3], 'R1');
assert.strictEqual(row[4], 'Seg A');
assert.strictEqual(row[7], 'Custom (0)', 'team cell starts as Custom with no personnel');
assert.strictEqual(row[8], '40 ft', 'segment sweep width is carried over like a normal search');
assert.strictEqual(row[9], '', 'no sweep count yet');
const form = bundle.forms['2'];
assert.ok(form, 'a task assignment form is created');
assert.strictEqual(app.isCustomSearchTaskForm(form), true);
assert.strictEqual(form.teamName, 'Custom');
// (arrays come from the vm realm, so compare contents rather than prototypes)
assert.strictEqual(form.teamMembers.length, 0, 'no personnel is pre-filled');
assert.strictEqual(form.manualParChecks.length, 0, 'no par checks are pre-filled');
assert.strictEqual(form.completed, undefined);
assert.strictEqual(bundle.currentAssignments['Custom'], undefined, 'no team assignment is created');
assert.strictEqual(bundle.teamStatuses['Custom'], undefined, 'no team status is created');
assert.strictEqual(bundle.parChecks && bundle.parChecks['Custom'], undefined, 'no par check timer is started');
assert.strictEqual(app.isCustomSearchTaskForm(bundle.forms['1']), false, 'normal tasks are not custom');

// --- 2. While the form is open the task is "still out" ------------------------
assert.strictEqual(app.isTaskUnfinished('#2'), true, 'custom task is unfinished until its form is completed');
assert.strictEqual(app.isTaskUnfinished('#1'), true, 'the normal task is unfinished because Alpha is searching');
assert.strictEqual(app.getLogSweepsDue().length, 0, 'no sweep count is asked for while unfinished');

const active = app.buildActiveSearchSegmentNameSet(bundle);
assert.ok(active.has('seg a'), 'custom-searched segment is drawn in the active-search style');
assert.ok(active.has('r1 - seg a'));
assert.ok(active.has('seg b'), 'normal in-progress search stays active too');
assert.strictEqual(app.isFeatureActivelyBeingSearched({attributes: {name: 'Seg A'}}, active), true);

// --- 3. The personnel count follows the members typed into the form ---------
bundle = app.loadBundle();
bundle.forms['2'].teamMembers.push({name: 'Mutual Aid 1', leader: true, gps: false, radio: false, medic: false});
bundle.forms['2'].teamMembers.push({name: 'Mutual Aid 2', leader: false, gps: false, radio: false, medic: false});
bundle.forms['2'].teamMembers.push({name: '', leader: false, gps: false, radio: false, medic: false});
assert.strictEqual(app.syncCustomSearchTaskLogRow(bundle, '2'), true, 'sync reports a change');
assert.strictEqual(bundle.pages.page4.find(r => r[0] === '#2')[7], 'Custom (2)', 'blank members are not counted');
assert.strictEqual(app.syncCustomSearchTaskLogRow(bundle, '2'), false, 'no change on a second sync');
bundle.forms['2'].teamName = 'Mutual Aid';
assert.strictEqual(app.syncCustomSearchTaskLogRow(bundle, '2'), true);
assert.strictEqual(bundle.pages.page4.find(r => r[0] === '#2')[7], 'Mutual Aid (2)', 'team name typed on the form shows in the Search Log');
app.saveBundle(bundle);

// The Search Log "Recount" must not clobber the manual count with the roster.
app.recountTeamMembersForSearchLog();
bundle = app.loadBundle();
assert.strictEqual(bundle.pages.page4.find(r => r[0] === '#2')[7], 'Mutual Aid (2)', 'recount keeps the form-based count');
assert.strictEqual(bundle.pages.page4.find(r => r[0] === '#1')[7], 'Alpha (2)', 'roster teams are still recounted from the roster');

// The count feeds the PSR calculation like any other search once sweeps are logged.
bundle.pages.page4.find(r => r[0] === '#2')[9] = '1';
app.saveBundle(bundle);
app.recalculateEverything();
bundle = app.loadBundle();
const recalculated = bundle.pages.page4.find(r => r[0] === '#2');
assert.ok(parseFloat(recalculated[5]) > 0, 'PSR before is computed');
assert.ok(parseFloat(recalculated[6]) < parseFloat(recalculated[5]), 'PSR after drops using the manual personnel count');
recalculated[9] = '';
app.saveBundle(bundle);

// --- 4. Marking the form completed finishes the search ------------------------
bundle = app.loadBundle();
bundle.forms['2'].completed = true;
bundle.forms['2'].completedBy = 'tester';
app.saveBundle(bundle);
bundle = app.loadBundle();
assert.strictEqual(app.isTaskUnfinished('#2'), false, 'completed custom task is finished');
assert.strictEqual(app.getLogSweepsDue().map(d => d.taskNum).join(','), '#2', 'sweep count is now asked for');
const activeAfter = app.buildActiveSearchSegmentNameSet(bundle);
assert.strictEqual(activeAfter.has('seg a'), false, 'segment leaves the active-search style once the form is completed');
assert.ok(activeAfter.has('seg b'), 'the normal in-progress search is unaffected');
assert.strictEqual(app.getCustomSearchTasksInProgress(bundle).length, 0);

// --- 5. The team selection popup offers the Custom button only when asked for -
{
    const created = [];
    const origCreate = app.document.createElement;
    app.document.createElement = () => { const el = makeElement(); created.push(el); return el; };
    let customCalls = 0;
    app.showTeamSelectionPopup(() => {}, {onCustom: () => { customCalls++; }});
    const customBtn = created.find(el => el.children.some(c => c.textContent === 'Custom'));
    assert.ok(customBtn, 'a Custom button is rendered');
    customBtn.onclick();
    assert.strictEqual(customCalls, 1, 'clicking Custom runs the custom handler');

    created.length = 0;
    app.showTeamSelectionPopup(() => {});
    assert.strictEqual(created.some(el => el.children.some(c => c.textContent === 'Custom')), false, 'no Custom button without a handler');
    app.document.createElement = origCreate;
}

console.log('Custom search task: PASS');

// Regression tests for the activity log.
//
// 1. A search started from the Segments page ("search" button) must go through
//    the very same process as one assigned from the Personnel page ("Assign New
//    Task"): one Search Log row, the team put on the assignment, and ONE
//    "Assigned to segment: #N Region - Segment" activity log entry (no more
//    "Started search on ..." wording that the Task Assignment form mistook for
//    the Begin Search time).
// 2. Everything done in the app is recorded: table cell edits, marking /
//    restoring unwanted CalTopo shapes (by name), logging sweeps, settings
//    changes, timestamp edits, ...
//
// Run with: node test_activity_log_coverage.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

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
        innerHTML: '',
        value: ''
    };
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

function createSandbox(store, page = 'page2') {
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const cookieJar = {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = page;
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
        confirm: () => true,
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: `http://localhost/${page}.html`, search: ''}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    return sandbox;
}

function seedStore(page = 'page2') {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-1'});
    const app = createSandbox(store, page);
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-1';
    bundle.pages.index.rows = [['R1', '50', '50', '50', '']];
    bundle.pages.page2 = [
        ['R1', 'Seg A', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', ''],
        ['R1', 'Seg B', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', '']
    ];
    bundle.pages.page3 = [
        ['Jane Doe', 'Alpha', 'Jane Doe', 'true', '', '', 'On-Scene', '', '', '', '', '', '', ''],
        ['John Roe', 'Alpha', 'Jane Doe', '', 'true', '', 'On-Scene', '', '', '', '', '', '', '']
    ];
    bundle.maps = [{
        id: 'MAP1', name: 'Training Map', domain: 'caltopo.com', teamId: '',
        features: [
            {geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]}, attributes: {id: 'a', name: 'Seg A', class: 'Assignment'}},
            {geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]}, attributes: {id: 'c', name: 'Charlie', class: 'Assignment'}},
            {geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]}, attributes: {id: 'd', name: 'Delta', class: 'Assignment'}}
        ]
    }];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
    return {store, app};
}

const logActions = app => app.loadBundle().activityLog.map(e => e.action);
const logEntries = app => app.loadBundle().activityLog;

// Checks run one after another (some drive popups whose Save handler is async).
const checks = [];
function check(name, fn) {
    checks.push({name, fn});
}

// ---------------------------------------------------------------------------
// 1. Segments page and Personnel page start a search through the same process
// ---------------------------------------------------------------------------
check('assignSearchTaskToTeam creates the Search Log row, assigns the team and writes ONE "Assigned to segment" entry with the confirmed timestamp', () => {
    const {app} = seedStore('page2');
    const stamp = {date: '03-14-2026', time: '09:05', timestampMs: new Date('2026-03-14T09:05:00').getTime()};
    const result = app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A', stamp);
    assert.strictEqual(result.taskNumber, 1);
    assert.strictEqual(result.fullAssignment, '#1 R1 - Seg A');

    const bundle = app.loadBundle();
    const row = bundle.pages.page4.find(r => r[0] === '#1');
    assert.ok(row, 'a Search Log row is created');
    assert.strictEqual(row[3], 'R1');
    assert.strictEqual(row[4], 'Seg A');
    assert.strictEqual(row[7], 'Alpha (2)');
    assert.strictEqual(bundle.currentAssignments['Alpha'], '#1 R1 - Seg A');
    assert.strictEqual(bundle.teamStatuses['Alpha'], 'assigned');
    assert.strictEqual(bundle.teamAssignmentTimes['Alpha'], stamp.timestampMs);
    assert.strictEqual(bundle.parChecks['Alpha'].lastTime, stamp.timestampMs, 'the par-check timer starts at the confirmed time');

    const assigned = bundle.activityLog.filter(e => e.action.startsWith('Assigned to segment: '));
    assert.strictEqual(assigned.length, 1, 'exactly one assignment entry');
    assert.strictEqual(assigned[0].action, 'Assigned to segment: #1 R1 - Seg A');
    assert.strictEqual(assigned[0].team, 'Alpha');
    assert.strictEqual(assigned[0].date, '03-14-2026');
    assert.strictEqual(assigned[0].time, '09:05');
    assert.ok(assigned[0].tag.startsWith('#1'), `entry is tagged with the task, got ${assigned[0].tag}`);
    assert.strictEqual(assigned[0].members, 'Jane Doe*, John Roe');
    assert.ok(bundle.activityLog.some(e => e.action === 'Created Search Log Entry: #1'), 'the Search Log row creation is logged too');
    assert.ok(!bundle.activityLog.some(e => /started search/i.test(e.action)), 'the old Segments-page-only wording is gone');
});

check('the Segments page "search" button and the Personnel page "Assign New Task" both go through assignSearchTaskToTeam', () => {
    const segmentsSearch = appSource.slice(appSource.indexOf("actionBtn.textContent = 'search';"), appSource.indexOf("onCustom: () => {"));
    assert.ok(/showMissingStepsPopup\(teamName, null, \(currentStamp\) => \{[\s\S]*?assignSearchTaskToTeam\(teamName, region, segment, currentStamp\)/.test(segmentsSearch),
        'Segments page search uses the shared assignment');
    assert.ok(!/Started search on/.test(appSource), 'no code path logs "Started search on" any more');

    const personnelAssign = appSource.slice(appSource.indexOf('function showNewSegmentPopup('), appSource.indexOf('function showTeamSelectionPopup('));
    assert.ok(/showMissingStepsPopup\(teamName, null, \(currentStamp\) => \{[\s\S]*?assignSearchTaskToTeam\(teamName, region, segment, currentStamp\)/.test(personnelAssign),
        'Personnel page Assign New Task uses the shared assignment');
});

check('the Task Assignment form no longer fills Begin Search from the assignment entry', () => {
    const {app} = seedStore('page5');
    app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A', {date: '03-14-2026', time: '09:05', timestampMs: Date.now()});
    const bundle = app.loadBundle();
    const taskTag = '#1';
    const begin = bundle.activityLog.find(l => (l.tag === taskTag || l.tag.startsWith(taskTag + ' - '))
        && ['beginning search', 'begin search', 'beginning assignment', 'begin assignment', 'started search'].some(k => l.action.toLowerCase().includes(k)));
    assert.strictEqual(begin, undefined, 'assigning a task is not a "begin search" event');
});

// ---------------------------------------------------------------------------
// 2. Everything else is recorded
// ---------------------------------------------------------------------------
check('table cell edits are recorded with the row name, column and old/new value', () => {
    const {app} = seedStore('page2');
    const data = app.loadBundle().pages.page2;
    data[0][3] = '3 mi';
    data[1][1] = 'Seg B2';
    app.saveCurrentPageData(data);
    const actions = logActions(app);
    assert.ok(actions.includes('Segment "R1 - Seg A": Length changed from "2 mi" to "3 mi"'), actions.join('\n'));
    assert.ok(actions.includes('Segment "R1 - Seg B2": Segment changed from "Seg B" to "Seg B2"'), 'renames are recorded');
    assert.strictEqual(actions.filter(a => a.startsWith('Segment "')).length, 2, 'only the edited cells are recorded');

    // Saving the same data again records nothing.
    const before = logEntries(app).length;
    app.saveCurrentPageData(app.loadBundle().pages.page2);
    assert.strictEqual(logEntries(app).length, before, 'no entry when nothing changed');

    // Derived PSR cells are never reported as edits.
    const again = app.loadBundle().pages.page2;
    again[0][6] = '0.1234';
    again[0][7] = '0.2345';
    app.saveCurrentPageData(again);
    assert.strictEqual(logEntries(app).length, before, 'computed PSR cells are ignored');
});

check('deleting a row does not produce spurious cell-edit entries', () => {
    const {app} = seedStore('page2');
    const data = app.loadBundle().pages.page2;
    data.splice(0, 1);
    app.logDeletion('Segment', 'Seg A');
    app.saveCurrentPageData(data);
    const actions = logActions(app);
    assert.ok(actions.includes('Deleted Segment: Seg A'));
    assert.strictEqual(actions.filter(a => a.startsWith('Segment "')).length, 0, actions.join('\n'));
});

check('personnel toggles and renames are recorded; team / lead changes are left to their own handlers', () => {
    const {app} = seedStore('page3');
    const data = app.loadBundle().pages.page3;
    data[1][4] = 'false';
    data[1][5] = 'true';
    data[0][0] = 'Jane Q. Doe';
    data[0][1] = 'Bravo';
    app.saveCurrentPageData(data);
    const actions = logActions(app);
    assert.ok(actions.includes('Personnel "John Roe": Radio turned off'), actions.join('\n'));
    assert.ok(actions.includes('Personnel "John Roe": Medic turned on'));
    assert.ok(actions.includes('Personnel "Jane Q. Doe": Name changed from "Jane Doe" to "Jane Q. Doe"'));
    assert.ok(!actions.some(a => a.includes('Bravo')), 'team moves are logged by the team select handler, not twice');
});

check('regions: voter values and header renames are recorded, consensus and column add/remove are not', () => {
    const {app} = seedStore('index');
    let data = app.loadBundle().pages.index;
    data.rows[0][1] = '60';
    data.rows[0][4] = '53.3';
    data.headers[1] = 'Chief';
    app.saveCurrentPageData(data);
    let actions = logActions(app);
    assert.ok(actions.includes('Region "R1": Chief changed from "50" to "60"'), actions.join('\n'));
    assert.ok(actions.includes('Regions: voter column name changed from "Voter 1" to "Chief"'));
    assert.ok(!actions.some(a => /Consensus/.test(a)), 'the computed consensus column is ignored');

    const before = logEntries(app).length;
    data = app.loadBundle().pages.index;
    data.headers.splice(1, 1);
    data.rows.forEach(r => r.splice(1, 1));
    app.saveCurrentPageData(data);
    assert.strictEqual(logEntries(app).length, before, 'removing a column (logged by its button) is not reported cell by cell');
});

check('marking CalTopo shapes unwanted and restoring them is recorded by name', () => {
    const {app} = seedStore('page10');
    const features = app.loadBundle().maps[0].features;
    const marked = app.markMapFeaturesUnwanted(features);
    assert.strictEqual(marked, 2, 'Seg A is already a segment');
    let actions = logActions(app);
    assert.ok(actions.includes('Marked 2 CalTopo shapes as unwanted (not imported): Charlie, Delta'), actions.join('\n'));

    assert.strictEqual(app.markMapFeaturesUnwanted(features), 0);
    assert.strictEqual(logActions(app).filter(a => a.startsWith('Marked ')).length, 1, 'nothing is logged when nothing new is marked');

    const restored = app.unmarkMapFeaturesUnwanted([features[1]]);
    assert.strictEqual(restored, 1);
    actions = logActions(app);
    assert.ok(actions.includes('Restored 1 CalTopo shape from the unwanted list: Charlie'), actions.join('\n'));
});

check('an import from the Maps page logs the imported segments and the shapes marked unwanted exactly once each', () => {
    const {app} = seedStore('page10');
    const features = app.loadBundle().maps[0].features;
    app.getUnaccountedSelection().add(app.getMapFeatureIdentityKey(features[1]));
    app.importSelectedUnaccountedFeatures();
    const actions = logActions(app);
    assert.strictEqual(actions.filter(a => a === 'Imported segments: Charlie').length, 1, actions.join('\n'));
    assert.strictEqual(actions.filter(a => a.startsWith('Marked 1 CalTopo shape as unwanted (not imported): Delta')).length, 1, actions.join('\n'));
});

check('summarizeNamesForLog cuts long lists', () => {
    const {app} = seedStore('page2');
    assert.strictEqual(app.summarizeNamesForLog(['a', 'b']), 'a, b');
    const many = Array.from({length: 20}, (_, i) => `S${i + 1}`);
    assert.strictEqual(app.summarizeNamesForLog(many, 3), 'S1, S2, S3 (+17 more)');
});

check('logging sweeps for a finished task is recorded under the team', () => {
    const {app} = seedStore('page2');
    app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A', {date: '03-14-2026', time: '09:05', timestampMs: Date.now()});
    // Drive the popup: capture the created elements to reach the input and Submit button.
    const created = [];
    const origCreate = app.document.createElement;
    app.document.createElement = () => { const el = makeElement(); created.push(el); return el; };
    app.showLogSweepsPopup('#1');
    app.document.createElement = origCreate;
    const input = created.find(el => el.type === 'number');
    const submit = created.find(el => el.textContent === 'Submit');
    assert.ok(input && submit, 'the popup has a sweep input and a Submit button');
    input.value = '3';
    submit.onclick();
    const bundle = app.loadBundle();
    assert.strictEqual(bundle.pages.page4.find(r => r[0] === '#1')[9], '3');
    const entry = bundle.activityLog.find(e => e.action.startsWith('Logged 3 sweeps for #1 R1 - Seg A'));
    assert.ok(entry, logActions(app).join('\n'));
    assert.strictEqual(entry.team, 'Alpha');
});

check('settings changes are recorded with old and new values', () => {
    const {app} = seedStore('settings');
    const b = app.loadBundle();
    assert.strictEqual(app.logSettingChange('Theme', 'dark', 'dark', b), false, 'no entry when unchanged');
    assert.strictEqual(app.logSettingChange('Theme', 'dark', 'light', b), true);
    app.saveBundle(b);
    assert.ok(logActions(app).includes('Setting "Theme" changed from dark to light'));
    assert.ok(/logSettingChange\('Delete Mode'/.test(appSource), 'Delete Mode toggle logs');
    assert.ok(/logSettingChange\('Par check frequency \(minutes\)'/.test(appSource), 'par check frequency logs');
    assert.ok(/logSettingChange\('Automatic unaccounted map feature check'/.test(appSource), 'map auto check toggle logs');
    assert.ok(/logSettingChange\('Segment color scale maximum'/.test(appSource), 'segment scale toggle logs');
    assert.ok(/logSettingChange\('Tips'/.test(appSource), 'tips toggle logs');
});

check('editing a log entry timestamp leaves an audit entry', () => {
    const {app} = seedStore('page3');
    app.addActivityLogEntry('Alpha', 'Leaving base for assignment', null, null, '03-14-2026', '09:10');
    const entry = app.loadBundle().activityLog.find(e => e.action === 'Leaving base for assignment');
    const created = [];
    const origCreate = app.document.createElement;
    app.document.createElement = () => { const el = makeElement(); created.push(el); return el; };
    app.showEditLogTimePopup(entry);
    app.document.createElement = origCreate;
    const [dateInput, timeInput] = created.filter(el => el.type === 'text');
    const save = created.find(el => el.textContent === 'Save');
    assert.ok(dateInput && timeInput && save);
    timeInput.value = '09:25';
    // The Save handler runs its save action synchronously and then only waits
    // for the button feedback animation (timers are stubbed out here).
    save.onclick();
    const actions = logActions(app);
    assert.ok(actions.includes('Log entry time changed from 03-14-2026 09:10 to 03-14-2026 09:25: Team Alpha - Leaving base for assignment'), actions.join('\n'));
    assert.strictEqual(app.loadBundle().activityLog.find(e => e.action === 'Leaving base for assignment').time, '09:25');
});

check('describeCellChangeForLog wording', () => {
    const {app} = seedStore('page2');
    assert.strictEqual(app.describeCellChangeForLog('Length', '', '2 mi'), 'Length set to "2 mi"');
    assert.strictEqual(app.describeCellChangeForLog('Length', '2 mi', ''), 'Length cleared (was "2 mi")');
    assert.strictEqual(app.describeCellChangeForLog('Length', '2 mi', '3 mi'), 'Length changed from "2 mi" to "3 mi"');
    assert.strictEqual(app.describeCellChangeForLog('GPS', '', 'true'), 'GPS turned on');
    assert.strictEqual(app.describeCellChangeForLog('GPS', 'true', 'false'), 'GPS turned off');
});

(async () => {
    let passed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
        } catch (err) {
            console.error(`  FAIL - ${name}`);
            throw err;
        }
        passed++;
        console.log(`  ok - ${name}`);
    }
    console.log(`\nAll ${passed} activity log coverage checks passed.`);
})().catch(err => {
    console.error(err);
    process.exit(1);
});

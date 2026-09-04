// Regression tests for what the CalTopo assignment overlay pushes once a task
// assignment is FINISHED:
//
//  * the segment's border goes back to its standard thickness (the stroke-width
//    the shape had before the overlay, or CalTopo's default) instead of keeping
//    the thick active-search border, and
//  * a "[Task #N] Finished <date time> - Team ...: <members> - Tracks: N -
//    Sweep width: N ft" summary is appended to the shape's description (and
//    replaced in place, not duplicated, when the sweep count is logged later).
//
// Also checks that saving a team status change asks for an overlay refresh.
//
// Run with: node test_caltopo_finished_task_overlay.js

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
    // Same scripts as the pages load: the segment/PSRc helpers, the sync delta
    // helpers and the app itself.
    vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    return sandbox;
}

// A search file with two segments that are CalTopo assignments, one roster
// team (Alpha) and a fetched CalTopo map. "Seg A" had a custom 4px border in
// CalTopo, "Seg B" never carried a stroke-width.
const store = {};
store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-1'});
const app = createSandbox(store);
{
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-1';
    bundle.pages.index.rows = [['R1', '50', '50', '50', '']];
    bundle.pages.page2 = [
        ['R1', 'Seg A', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', 'cal-a'],
        ['R1', 'Seg B', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', 'cal-b']
    ];
    bundle.pages.page3 = [
        ['Jane Doe', 'Alpha', 'Jane Doe', 'true', '', '', 'On-Scene', '', '', '', '', '', '', ''],
        ['John Roe', 'Alpha', 'Jane Doe', '', 'true', '', 'On-Scene', '', '', '', '', '', '', '']
    ];
    bundle.maps = [{
        id: 'MAP1',
        domain: 'caltopo.com',
        features: [
            {
                attributes: {id: 'cal-a', name: 'Seg A', class: 'Assignment', description: 'Steep gully on the east side.', 'stroke-width': 4},
                geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]}
            },
            {
                attributes: {id: 'cal-b', name: 'Seg B', class: 'Assignment'},
                geometry: {type: 'Polygon', coordinates: [[[2, 2], [2, 3], [3, 3], [2, 2]]]}
            }
        ]
    }];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
}
app.recalculateEverything();

// Stub the CalTopo API: record every POST and pretend it succeeded.
const posted = [];
app.caltopo_api_call = async (method, endpoint, payload) => {
    posted.push({method, endpoint, payload: JSON.parse(JSON.stringify(payload))});
    return {result: {id: payload.id}};
};
const lastPayloadFor = id => {
    const hits = posted.filter(p => p.endpoint.endsWith(`/${id}`));
    return hits.length ? hits[hits.length - 1].payload : null;
};

(async () => {
    // --- 1. Team Alpha is searching Seg A (task #1): active-search style -----------
    const task = app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A');
    assert.strictEqual(task.taskNumber, 1);
    {
        const b = app.loadBundle();
        b.teamStatuses['Alpha'] = 'searching';
        app.saveBundle(b);
    }

    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    let segA = lastPayloadFor('cal-a');
    let segB = lastPayloadFor('cal-b');
    assert.ok(segA && segB, 'both assignment shapes are pushed');
    assert.strictEqual(segA.properties['stroke-width'], 3, 'actively searched segment gets the active-search border thickness');
    assert.strictEqual(segA.properties.fill, '#228be6', 'actively searched segment gets the active-search fill');
    assert.strictEqual(segA.properties.description, 'Steep gully on the east side.', 'description is untouched while the search is still out');
    assert.strictEqual(segB.properties['stroke-width'], 2, 'a resting segment without an original width is pushed at the CalTopo default');
    assert.strictEqual(segB.properties.description, undefined, 'no summary for a segment that was never searched');
    console.log('  ok - active search: thick border, no description change');

    // --- 2. Alpha reports "Finished Assignment" ----------------------------------------
    {
        const b = app.loadBundle();
        b.teamStatuses['Alpha'] = 'finished segment';
        app.saveBundle(b);
        app.addActivityLogEntry('Alpha', 'Finished assignment', null, null, '09-04-2026', '14:05');
    }
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segA = lastPayloadFor('cal-a');
    assert.strictEqual(segA.properties['stroke-width'], 4, 'finished segment goes back to the border thickness it had before the overlay');
    assert.notStrictEqual(segA.properties.fill, '#228be6', 'finished segment leaves the active-search fill color');
    assert.strictEqual(
        segA.properties.description,
        'Steep gully on the east side.\n[Task #1] Finished 09-04-2026 14:05 - Team Alpha: Jane Doe (lead), John Roe - Tracks: not logged - Sweep width: 40 ft',
        'summary of the finished task is appended after the existing description'
    );
    {
        const b = app.loadBundle();
        assert.strictEqual(b.maps[0].features[0].attributes.description, segA.properties.description, 'the pushed description is remembered locally');
        assert.strictEqual(b.maps[0].features[0].attributes['stroke-width'], 4, 'the restored border thickness is remembered locally');
    }
    console.log('  ok - finished search: standard border restored, task summary appended');

    // --- 3. Logging the sweep count later updates the line instead of adding one --
    {
        const b = app.loadBundle();
        b.pages.page4.find(r => r[0] === '#1')[9] = '5';
        app.saveBundle(b);
    }
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segA = lastPayloadFor('cal-a');
    const lines = segA.properties.description.split('\n');
    assert.strictEqual(lines.length, 2, 'the task summary is replaced, not appended a second time');
    assert.strictEqual(lines[0], 'Steep gully on the east side.');
    assert.strictEqual(lines[1], '[Task #1] Finished 09-04-2026 14:05 - Team Alpha: Jane Doe (lead), John Roe - Tracks: 5 - Sweep width: 40 ft');

    // Pushing again with nothing changed keeps the description stable.
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    assert.strictEqual(lastPayloadFor('cal-a').properties.description, segA.properties.description, 'idempotent re-push');
    console.log('  ok - later sweep count replaces the summary line in place');

    // --- 4. A second search of the same segment adds its own line -------------------
    {
        const b = app.loadBundle();
        b.teamStatuses['Alpha'] = 'at base (15:00)';
        b.currentAssignments['Alpha'] = 'Base';
        app.saveBundle(b);
    }
    const task2 = app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A');
    assert.strictEqual(task2.taskNumber, 2);
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segA = lastPayloadFor('cal-a');
    assert.strictEqual(segA.properties.description.split('\n').length, 2, 'a task that is only assigned is not summarised yet');
    {
        const b = app.loadBundle();
        b.teamStatuses['Alpha'] = 'finished segment';
        app.saveBundle(b);
        app.addActivityLogEntry('Alpha', 'Finished assignment', null, null, '09-04-2026', '17:30');
    }
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segA = lastPayloadFor('cal-a');
    const lines2 = segA.properties.description.split('\n');
    assert.strictEqual(lines2.length, 3, 'each finished task has its own line');
    assert.ok(lines2[1].startsWith('[Task #1] Finished 09-04-2026 14:05'), 'earlier task line is kept');
    assert.strictEqual(lines2[2], '[Task #2] Finished 09-04-2026 17:30 - Team Alpha: Jane Doe (lead), John Roe - Tracks: not logged - Sweep width: 40 ft');
    console.log('  ok - a second finished search adds a second summary line');

    // --- 5. Custom searches are summarised when their form is completed ------------
    const customNum = app.createCustomSearchTask('R1', 'Seg B');
    {
        const b = app.loadBundle();
        const form = b.forms[String(customNum)];
        form.teamName = 'Mutual Aid';
        form.teamMembers.push({name: 'Pat Lee', leader: true});
        form.teamMembers.push({name: 'Sam Kim', leader: false});
        form.dateTime = '09-04-2026';
        form.completeSearch = '16:45';
        app.syncCustomSearchTaskLogRow(b, customNum);
        app.saveBundle(b);
    }
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segB = lastPayloadFor('cal-b');
    assert.strictEqual(segB.properties['stroke-width'], 3, 'custom search in progress draws the active-search border');
    assert.strictEqual(segB.properties.description, undefined, 'no summary while the custom search is still out');
    {
        const b = app.loadBundle();
        b.forms[String(customNum)].completed = true;
        b.forms[String(customNum)].completedBy = 'tester';
        app.saveBundle(b);
    }
    posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    segB = lastPayloadFor('cal-b');
    assert.strictEqual(segB.properties['stroke-width'], 2, 'completed custom search goes back to the standard border');
    assert.strictEqual(
        segB.properties.description,
        `[Task #${customNum}] Finished 09-04-2026 16:45 - Team Mutual Aid: Pat Lee (lead), Sam Kim - Tracks: not logged - Sweep width: 40 ft`,
        'a shape with no description gets just the summary line'
    );
    console.log('  ok - completed custom search is summarised from its form');

    // --- 6. Saving a status change asks for an overlay refresh ---------------------
    let refreshRequests = 0;
    const origRefresh = app.refreshCalTopoAssignmentOverlayIfEnabled;
    app.refreshCalTopoAssignmentOverlayIfEnabled = () => { refreshRequests++; };
    {
        const b = app.loadBundle();
        b.profile = {...(b.profile || {}), incidentNumber: 'INC-1'};
        app.saveBundle(b);
        assert.strictEqual(refreshRequests, 0, 'unrelated edits do not ask for a refresh');
        b.teamStatuses['Alpha'] = 'returning';
        app.saveBundle(b);
        assert.strictEqual(refreshRequests, 1, 'a team status change asks for a refresh');
        b.forms[String(customNum)].teamMembers.push({name: 'New Member', leader: false});
        app.saveBundle(b);
        assert.strictEqual(refreshRequests, 2, 'editing a task form personnel list asks for a refresh');
    }
    app.refreshCalTopoAssignmentOverlayIfEnabled = origRefresh;
    console.log('  ok - status / form changes trigger the overlay refresh');

    console.log('CalTopo finished-task overlay: PASS');
})().catch(err => {
    console.error(err);
    process.exit(1);
});

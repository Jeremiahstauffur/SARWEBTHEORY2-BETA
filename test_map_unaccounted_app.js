// Drives the real app.js in a sandbox (fake localStorage / DOM / fetch) to check
// the Maps page "unaccounted map features" flow end to end:
//   - the hidden unwanted list and the automatic-check toggle survive a save,
//   - an import started from Fetch Shapes marks everything left out as unwanted,
//   - "Import Selected" below the map imports the checked shapes and marks the
//     unchecked ones unwanted (with nothing checked it marks everything),
//   - the check re-fetches the map, notifies about unaccounted segments by name
//     and the notification opens the Maps page,
//   - every unimported CalTopo Assignment gets its own "New Assignment"
//     notification with Import / Decline-for-now buttons,
//   - the feature-type toggles below the map hide (mark unwanted) whole types
//     and restore them when switched back on,
//   - the Settings toggle stops the automatic check.
//
// Run with: node test_map_unaccounted_app.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const LAST_CHECK_KEY = 'sar-map-unaccounted-last-check-v1';
const CASE = 'Case-1';
const PROXY_URL = 'https://sarwebtheory2-production.up.railway.app/api/proxy';

function makeElement(depth = 0) {
    const classes = new Set();
    const el = {
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            contains: (c) => classes.has(c),
            toggle: (c, force) => { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); }
        },
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
        scrollIntoView() {},
        textContent: ''
    };
    // Like the real DOM, assigning innerHTML throws away the appended children.
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set: (value) => { html = String(value); el.children = []; }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

function createSandbox({store, fetch, page = 'page10', withUtils = true} = {}) {
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
        get cookie() { return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; '); },
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
    const intervals = [];
    const alerts = [];
    const navigations = [];
    const logs = {warn: [], error: []};
    const sandbox = {
        console: {
            log() {}, info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: (fn, ms) => { intervals.push({fn, ms}); return intervals.length; },
        clearInterval() {},
        localStorage,
        sessionStorage: localStorage,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: (url, init) => fetch(url, init),
        alert: (msg) => alerts.push(String(msg)),
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        FormData: class FormData {},
        URL,
        URLSearchParams,
        location: {
            hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', search: '',
            pathname: `/${page}.html`,
            get href() { return `http://localhost/${page}.html`; },
            set href(value) { navigations.push(String(value)); }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    if (withUtils) vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__intervals = intervals;
    sandbox.__alerts = alerts;
    sandbox.__navigations = navigations;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A CalTopo proxy answering with `features`, plus a sync server that accepts
// everything. Records the proxy fetches.
function createServer(features) {
    const proxyCalls = [];
    const state = {features};
    const fetch = async (url, init = {}) => {
        const text = String(url);
        if (text.startsWith(PROXY_URL)) {
            proxyCalls.push(init.body ? JSON.parse(init.body) : null);
            return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => ({features: state.features})};
        }
        return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => ({success: true, applied: 1, modified: false})};
    };
    return {fetch, proxyCalls, state};
}

const calTopoFeature = (name, id) => ({
    type: 'Feature',
    id,
    geometry: {type: 'Polygon', coordinates: [[[-93.1, 44.9], [-93.0, 44.95], [-93.05, 45.0], [-93.1, 44.9]]]},
    properties: {title: name, class: 'Assignment'}
});

// Features as caltopo_request() stores them on the map.
const storedFeature = (name, id) => ({
    geometry: {type: 'Polygon', coordinates: [[[-93.1, 44.9], [-93.0, 44.95], [-93.05, 45.0], [-93.1, 44.9]]]},
    attributes: {name, id, class: 'Assignment', ObjectID: 1}
});
const storedShape = (name, id) => ({
    geometry: {type: 'Polygon', coordinates: [[[-93.1, 44.9], [-93.0, 44.95], [-93.05, 45.0], [-93.1, 44.9]]]},
    attributes: {name, id, class: 'Shape', ObjectID: 1}
});
const storedMarker = (name, id) => ({
    geometry: {type: 'Point', coordinates: [-93.1, 44.9]},
    attributes: {name, id, class: 'Marker', ObjectID: 1}
});
const storedRoute = (name, id) => ({
    geometry: {type: 'LineString', coordinates: [[-93.1, 44.9], [-93.0, 44.95]]},
    attributes: {name, id, class: 'Shape', ObjectID: 1}
});
const calTopoMarker = (name, id) => ({
    type: 'Feature',
    id,
    geometry: {type: 'Point', coordinates: [-93.1, 44.9]},
    properties: {title: name, class: 'Marker'}
});

function seedStore({features = [], segments = [], unwanted = [], autoCheck, typeFilters} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.page2 = segments.length ? segments : [['', '', '', '', '', '', '', '', '', '']];
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features}];
    bundle.unwantedMapFeatures = unwanted;
    if (autoCheck !== undefined) bundle.mapUnaccountedAutoCheck = autoCheck;
    if (typeFilters) bundle.mapFeatureTypeFilters = typeFilters;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const segmentNames = (app) => plain(app.loadBundle().pages.page2.map(r => r[1]).filter(Boolean));
const unwantedNames = (app) => plain(app.loadBundle().unwantedMapFeatures.map(e => e.name));
// A toast's title / text live in a child element, so the markup of the whole
// subtree is joined.
const deepHtml = (el) => (el.innerHTML || '') + (el.children || []).map(deepHtml).join('');
const toasts = (app) => app.__body.children.filter(el => /notif-toast/.test(el.className || '')).map(deepHtml);
// Only the toasts raised by the unaccounted-feature check (the sidebar also
// toasts unrelated reminders such as "Fill Incident Profile").
const unaccountedToasts = (app) => toasts(app).filter(html => /Unaccounted Map Features/.test(html));
const assignmentToasts = (app) => toasts(app).filter(html => /New Assignment/.test(html));
// Sidebar entries (the notification list is rebuilt by updateNotifications).
const sidebarItems = (app) => app.__byId['notif-list'].children.filter(el => /notification-item/.test(el.className || ''));
const assignmentItems = (app) => sidebarItems(app).filter(el => /map-assignment-new/.test(el.className || ''));
// The action buttons rendered into a notification entry / toast.
const actionButtons = (el) => {
    const found = [];
    const walk = node => {
        (node.children || []).forEach(child => {
            if (/notification-action-btn/.test(child.className || '')) found.push(child);
            walk(child);
        });
    };
    walk(el);
    return found;
};

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('the unwanted list and the automatic-check toggle survive sanitizeBundle / saveBundle', async () => {
    const store = seedStore();
    const app = createSandbox({store, fetch: createServer([]).fetch});
    const bundle = app.loadBundle();
    assert.deepStrictEqual(plain(bundle.unwantedMapFeatures), []);
    assert.strictEqual(bundle.mapUnaccountedAutoCheck, true, 'the automatic check is on by default');

    bundle.unwantedMapFeatures = [{id: 'abc', name: 'Old Track', markedAt: 't'}, {bogus: true}];
    bundle.mapUnaccountedAutoCheck = false;
    await app.saveBundle(bundle);

    const reloaded = createSandbox({store, fetch: createServer([]).fetch}).loadBundle();
    assert.deepStrictEqual(plain(reloaded.unwantedMapFeatures), [{id: 'abc', name: 'old track', markedAt: 't'}]);
    assert.strictEqual(reloaded.mapUnaccountedAutoCheck, false);
    assert.strictEqual(app.isMapUnaccountedAutoCheckEnabled(reloaded), false);
});

check('getUnaccountedMapFeatures skips segments and unwanted shapes and is sorted A-Z', () => {
    const store = seedStore({
        features: [storedFeature('Charlie', 'c'), storedFeature('alpha', 'a'), storedFeature('Bravo', 'b'), storedFeature('Delta', 'd')],
        segments: [['R1', 'Alpha', '', '', '', '', '', '', '', ''], ['R1', 'Other', '', '', '', '', '', '', '', 'd']],
        unwanted: [{id: 'b', name: 'bravo'}]
    });
    const app = createSandbox({store, fetch: createServer([]).fetch});
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Charlie']);
});

check('an import from Fetch Shapes marks every fetched shape that was left out as unwanted', () => {
    const features = [storedFeature('Charlie', 'c'), storedFeature('Alpha', 'a'), storedFeature('Bravo', 'b'), storedFeature('Existing', 'e')];
    const store = seedStore({features, segments: [['R1', 'Existing', '', '', '', '', '', '', '', 'e']]});
    const app = createSandbox({store, fetch: createServer([]).fetch});

    // The user imported only Alpha through the preview popup.
    app.importSegmentsAction([app.buildCalTopoSegmentImportItem(features[1])]);
    const marked = app.finishCalTopoFeatureImport(features, [app.buildCalTopoSegmentImportItem(features[1])]);

    assert.strictEqual(marked, 2, 'Charlie and Bravo are marked; Alpha was imported and Existing is already a segment');
    assert.deepStrictEqual(unwantedNames(app).sort(), ['bravo', 'charlie']);
    assert.deepStrictEqual(segmentNames(app).sort(), ['Alpha', 'Existing']);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), [], 'nothing is left unaccounted');
    assert.ok(toasts(app).some(html => /marked unwanted/.test(html)), 'the user is told how many shapes were marked unwanted');
});

check('Import Selected below the map imports the checked shapes and marks the unchecked ones unwanted', () => {
    const features = [storedFeature('Charlie', 'c'), storedFeature('Alpha', 'a'), storedFeature('Bravo', 'b')];
    const store = seedStore({features});
    const app = createSandbox({store, fetch: createServer([]).fetch});

    // Nothing is selected by default.
    assert.strictEqual(app.getUnaccountedSelection().size, 0);

    app.getUnaccountedSelection().add(app.getMapFeatureIdentityKey(features[1]));
    app.getUnaccountedSelection().add(app.getMapFeatureIdentityKey(features[2]));
    app.importSelectedUnaccountedFeatures();

    assert.deepStrictEqual(app.__alerts, [], 'no alert when shapes are checked');
    assert.deepStrictEqual(segmentNames(app).sort(), ['Alpha', 'Bravo']);
    const rows = app.loadBundle().pages.page2.filter(r => r[1]);
    assert.deepStrictEqual(plain(rows.map(r => r[9])).sort(), ['a', 'b'], 'the CalTopo id is kept on the imported rows');
    assert.deepStrictEqual(unwantedNames(app), ['charlie']);
    assert.strictEqual(app.getUnaccountedSelection().size, 0, 'the selection is cleared after the import');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures()), []);
});

check('Import Selected with nothing checked marks every unaccounted shape unwanted', () => {
    const features = [storedFeature('Charlie', 'c'), storedFeature('Alpha', 'a'), storedFeature('Bravo', 'b'), storedFeature('Existing', 'e')];
    const store = seedStore({features, segments: [['R1', 'Existing', '', '', '', '', '', '', '', 'e']]});
    const app = createSandbox({store, fetch: createServer([]).fetch});

    assert.strictEqual(app.getUnaccountedSelection().size, 0);
    app.importSelectedUnaccountedFeatures();

    assert.deepStrictEqual(app.__alerts, [], 'the button runs without complaining');
    assert.deepStrictEqual(segmentNames(app), ['Existing'], 'nothing is imported');
    assert.deepStrictEqual(unwantedNames(app).sort(), ['alpha', 'bravo', 'charlie'], 'every unaccounted shape is marked unwanted; the segment is left alone');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures()), []);
    assert.ok(toasts(app).some(html => /Nothing was checked: 3 shapes were marked unwanted/.test(html)), 'the user is told what happened');
    assert.ok(plain(app.loadBundle().activityLog).some(e => /Marked 3 CalTopo shapes as unwanted \(not imported\)/.test(e.action)), 'the activity log records it');

    // With nothing left to mark the button only reports.
    app.importSelectedUnaccountedFeatures();
    assert.ok(app.__alerts.some(a => /no unaccounted map features/.test(a)));
});

check('every unimported CalTopo Assignment gets its own New Assignment notification with Import / Decline buttons', () => {
    const features = [storedFeature('Zulu', 'z'), storedMarker('PLS', 'p'), storedShape('Hazard', 'h'), storedFeature('Mike', 'm')];
    const store = seedStore({features});
    const app = createSandbox({store, fetch: createServer([]).fetch, page: 'page2'});

    app.refreshUnaccountedMapFeatureNotifications();

    assert.deepStrictEqual(plain(app.window._unaccountedMapFeatureNames), ['Hazard', 'Mike', 'PLS', 'Zulu'], 'the general notification still covers every unaccounted shape');
    const items = assignmentItems(app);
    assert.strictEqual(items.length, 2, 'one entry per assignment (the marker and the plain shape get none)');
    assert.ok(/Assignment Mike is on the map but not imported as a segment/.test(items[0].innerHTML), items[0].innerHTML);
    assert.ok(/Assignment Zulu is on the map/.test(items[1].innerHTML));
    assert.deepStrictEqual(actionButtons(items[0]).map(b => b.textContent), ['Import', 'Decline for now']);
    assert.strictEqual(assignmentToasts(app).length, 2, 'each assignment toasts once');
    assert.deepStrictEqual(actionButtons(app.__body.children.find(el => /map-assignment-new/.test(el.className || ''))).map(b => b.textContent), ['Import', 'Decline for now'], 'the toast carries the same buttons');

    // Decline for now: the entry disappears, nothing is imported or marked unwanted.
    actionButtons(items[1])[1].onclick({stopPropagation() {}});
    assert.deepStrictEqual(assignmentItems(app).map(el => /Zulu/.test(el.innerHTML)), [false], 'only Mike is left');
    assert.deepStrictEqual(segmentNames(app), []);
    assert.deepStrictEqual(unwantedNames(app), []);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Hazard', 'Mike', 'PLS', 'Zulu'], 'Zulu still waits in the table below the map');
    assert.ok(plain(app.loadBundle().dismissedNotifications).some(k => /New AssignmentAssignment Zulu/.test(k)), 'its toast stays quiet like a dismissed one');

    // Import: only that assignment becomes a segment.
    actionButtons(assignmentItems(app)[0])[0].onclick({stopPropagation() {}});
    assert.deepStrictEqual(segmentNames(app), ['Mike']);
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.filter(r => r[1]).map(r => r[9])), ['m'], 'the CalTopo id is kept');
    assert.deepStrictEqual(unwantedNames(app), [], 'importing one assignment marks nothing else unwanted');
    assert.strictEqual(assignmentItems(app).length, 0, 'Mike is imported and Zulu was declined');
    assert.deepStrictEqual(plain(app.window._unaccountedMapFeatureNames), ['Hazard', 'PLS', 'Zulu']);
    assert.ok(toasts(app).some(html => /Imported assignment Mike as a segment/.test(html)));

    // Importing again is a no-op that just says so.
    assert.strictEqual(app.importUnaccountedAssignmentFeature(features[3]), false);
    assert.ok(toasts(app).some(html => /already imported/.test(html)));
});

check('the feature-type toggles mark switched-off types unwanted, keep doing so on later fetches, and restore them when switched back on', async () => {
    const features = [storedFeature('Zulu', 'z'), storedMarker('PLS', 'p'), storedShape('Hazard', 'h'), storedRoute('Trail', 't'), storedMarker('IPP', 'i')];
    const store = seedStore({features, unwanted: [{id: 'h', name: 'hazard'}]});
    const server = createServer([calTopoFeature('Zulu', 'z'), calTopoMarker('PLS', 'p'), calTopoMarker('Camp', 'c')]);
    const app = createSandbox({store, fetch: server.fetch});

    assert.deepStrictEqual(plain(app.getMapFeatureTypeFilters()), {marker: true, shape: true, assignment: true, route: true, other: true}, 'everything is on by default');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['IPP', 'PLS', 'Trail', 'Zulu']);

    // Markers off: both markers are marked unwanted (tagged with the toggle).
    const off = plain(app.setMapFeatureTypeFilterEnabled('marker', false));
    assert.deepStrictEqual(off, {marked: 2, restored: 0});
    assert.strictEqual(app.getMapFeatureTypeFilters().marker, false);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Trail', 'Zulu']);
    const tagged = plain(app.loadBundle().unwantedMapFeatures);
    assert.deepStrictEqual(tagged.filter(e => e.filteredType === 'marker').map(e => e.name).sort(), ['ipp', 'pls']);
    assert.strictEqual(tagged.find(e => e.name === 'hazard').filteredType, undefined, 'the shape a person marked is untouched');
    const log = plain(app.loadBundle().activityLog).map(e => e.action);
    assert.ok(log.some(m => /Marked 2 CalTopo shapes as unwanted \(Markers are switched off on the Maps page\)/.test(m)), log.join(' | '));
    assert.ok(log.some(m => /show new Markers.*ON.*OFF/.test(m)), 'the toggle change is logged as a setting change');

    // The toggle survives a save / reload.
    assert.strictEqual(createSandbox({store, fetch: server.fetch}).getMapFeatureTypeFilters().marker, false);

    // A later fetch brings a new marker: it is marked unwanted straight away.
    await app.checkUnaccountedMapFeaturesAndNotify();
    assert.deepStrictEqual(plain(app.loadBundle().maps[0].features.map(f => f.attributes.name)), ['Zulu', 'PLS', 'Camp']);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Zulu'], 'Camp never shows up as new');
    assert.strictEqual(plain(app.loadBundle().unwantedMapFeatures).find(e => e.name === 'camp').filteredType, 'marker');
    assert.deepStrictEqual(plain(app.window._unaccountedMapFeatureNames), ['Zulu']);

    // Switching markers back on restores exactly the toggle-marked ones.
    const on = plain(app.setMapFeatureTypeFilterEnabled('marker', true));
    assert.deepStrictEqual(on, {marked: 0, restored: 3});
    assert.deepStrictEqual(unwantedNames(app), ['hazard'], 'the person-marked shape stays unwanted');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Camp', 'PLS', 'Zulu']);

    // Unknown type keys are ignored.
    assert.strictEqual(app.setMapFeatureTypeFilterEnabled('bogus', false), undefined);
    assert.deepStrictEqual(plain(app.getMapFeatureTypeFilters()), {marker: true, shape: true, assignment: true, route: true, other: true});
});

check('the check re-fetches the map and notifies by segment name; the notification opens the Maps page', async () => {
    const store = seedStore({segments: [['R1', 'Alpha', '', '', '', '', '', '', '', '']]});
    const server = createServer([calTopoFeature('Zulu', 'z'), calTopoFeature('Alpha', 'a'), calTopoFeature('Mike', 'm')]);
    const app = createSandbox({store, fetch: server.fetch, page: 'page2'});

    const names = await app.checkUnaccountedMapFeaturesAndNotify();
    assert.strictEqual(server.proxyCalls.length, 1, 'the map is fetched through the proxy once');
    assert.deepStrictEqual(server.proxyCalls[0], {mapId: 'MAP1', domain: 'caltopo.com'});
    assert.deepStrictEqual(plain(names), ['Mike', 'Zulu'], 'unaccounted shapes, A-Z, Alpha is already a segment');
    assert.deepStrictEqual(plain(app.loadBundle().maps[0].features.map(f => f.attributes.name)), ['Zulu', 'Alpha', 'Mike'], 'the fetched shapes are stored on the map');
    assert.ok(Number(store[LAST_CHECK_KEY]) > 0, 'the time of the check is remembered');

    const shown = unaccountedToasts(app);
    assert.strictEqual(shown.length, 1, `exactly one unaccounted toast, got ${shown.length}`);
    assert.ok(/Mike and Zulu are on the map but not imported as segments/.test(shown[0]), shown[0]);
    assert.strictEqual(app.__alerts.length, 0, 'a background check never alerts');

    // Clicking the notification goes to the Maps page.
    app.openUnaccountedMapFeatures();
    assert.deepStrictEqual(app.__navigations, ['page10.html']);

    // The sidebar entry is fed from the same result.
    assert.deepStrictEqual(plain(app.window._unaccountedMapFeatureNames), ['Mike', 'Zulu']);

    // A second check with the same result raises the notification again.
    await app.checkUnaccountedMapFeaturesAndNotify();
    assert.strictEqual(unaccountedToasts(app).length, 2, 'every check that finds unaccounted shapes notifies');

    // Once everything is imported the check stays quiet.
    app.importSegmentsAction(app.getUnaccountedMapFeatures().map(app.buildCalTopoSegmentImportItem));
    const after = await app.checkUnaccountedMapFeaturesAndNotify();
    assert.deepStrictEqual(plain(after), []);
    assert.strictEqual(unaccountedToasts(app).length, 2, 'no toast when everything is accounted for');
});

check('a failed fetch is silent in the background and reported by the manual button', async () => {
    const store = seedStore();
    let fail = true;
    const fetch = async (url) => {
        if (String(url).startsWith(PROXY_URL)) {
            if (fail) throw new Error('Failed to fetch');
        }
        return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => ({features: []})};
    };
    const app = createSandbox({store, fetch});

    assert.deepStrictEqual(plain(await app.checkUnaccountedMapFeaturesAndNotify()), []);
    assert.strictEqual(app.__alerts.length, 0);
    assert.strictEqual(unaccountedToasts(app).length, 0);
    assert.ok(!toasts(app).some(html => /Check Failed/.test(html)), 'a background failure is not reported');

    await app.checkUnaccountedMapFeaturesAndNotify({manual: true});
    assert.ok(toasts(app).some(html => /Check Failed/.test(html)), 'the manual check tells the user it failed');
});

check('the automatic check runs every 5 minutes and stops when the Settings toggle is off', async () => {
    const store = seedStore();
    const server = createServer([calTopoFeature('Zulu', 'z')]);
    const app = createSandbox({store, fetch: server.fetch});

    app.startUnaccountedMapFeatureChecks();
    const timer = app.__intervals.find(t => t.ms === 30000);
    assert.ok(timer, 'a timer polls the 5-minute clock');

    // Never checked before: the first tick checks straight away.
    timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(server.proxyCalls.length, 1);

    // Just checked: the next tick waits.
    timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(server.proxyCalls.length, 1);

    // 5 minutes later it checks again.
    store[LAST_CHECK_KEY] = String(Date.now() - 5 * 60 * 1000 - 1);
    timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(server.proxyCalls.length, 2);

    // Turned off in Settings: no more fetches, even when it is due.
    const bundle = app.loadBundle();
    bundle.mapUnaccountedAutoCheck = false;
    await app.saveBundle(bundle);
    store[LAST_CHECK_KEY] = String(Date.now() - 10 * 60 * 1000);
    timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(server.proxyCalls.length, 2, 'the automatic check respects the Settings toggle');

    // The manual button still works with the toggle off.
    await app.checkUnaccountedMapFeaturesAndNotify({manual: true});
    assert.strictEqual(server.proxyCalls.length, 3);
});

check('a page without map-segment-utils.js still resolves unwanted / accounted shapes the same way', async () => {
    const store = seedStore({
        features: [storedFeature('Charlie', 'c'), storedFeature('alpha', 'a'), storedFeature('Bravo', 'b'), storedFeature('Delta', 'd'), storedFeature('Echo', 'gfx-5')],
        segments: [['R1', 'Alpha', '', '', '', '', '', '', '', ''], ['R1', 'Other', '', '', '', '', '', '', '', 'd']],
        unwanted: [{id: 'b', name: 'bravo'}, {id: '', name: 'echo'}]
    });
    const app = createSandbox({store, fetch: createServer([]).fetch, page: 'page3', withUtils: false});
    assert.strictEqual(app.window.SARMapSegmentUtils, undefined);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Charlie']);

    assert.strictEqual(app.markMapFeaturesUnwanted([storedFeature('Charlie', 'c'), storedFeature('Alpha', 'a')]), 1, 'Alpha is a segment, only Charlie is marked');
    assert.deepStrictEqual(unwantedNames(app).sort(), ['bravo', 'charlie', 'echo']);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures()), []);
    assert.strictEqual(app.unmarkMapFeaturesUnwanted([storedFeature('Charlie', 'c')]), 1);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Charlie']);

    const names = await app.checkUnaccountedMapFeaturesAndNotify();
    assert.deepStrictEqual(plain(names), [], 'the proxy answered with no shapes, so nothing is stored or reported');
});

check('the Maps page, its unaccounted table and the Fetch Shapes popup render without errors', async () => {
    const features = [storedFeature('Charlie', 'c'), storedFeature('Alpha', 'a'), storedFeature('Bravo', 'gfx-3')];
    const store = seedStore({features, segments: [['R1', 'Alpha', '', '', '', '', '', '', '', 'a']], unwanted: [{id: '', name: 'bravo'}]});
    const app = createSandbox({store, fetch: createServer([]).fetch});
    const main = makeElement();
    app.document.querySelector = (selector) => (selector === 'main' ? main : null);

    app.buildMapsPage();
    assert.ok(/id="unaccounted-features-section"/.test(main.innerHTML), 'the unaccounted table is part of the map tab');
    assert.ok(/id="check-unaccounted-btn"/.test(main.innerHTML), 'the refresh-style check button is rendered');
    assert.ok(/id="import-selected-unaccounted-btn"/.test(main.innerHTML), 'the Import Selected button is rendered above the table');
    assert.ok(/id="unaccounted-type-filters"/.test(main.innerHTML), 'the feature-type toggle row is rendered below the map');
    assert.strictEqual(app.__byId['unaccounted-features-count'].textContent, '1', 'only Charlie is unaccounted');
    assert.strictEqual(app.__byId['unaccounted-features-body'].children.length, 1, 'one row, no checkbox checked by default');
    assert.strictEqual(app.__byId['unaccounted-features-body'].children[0].children[0].children[0].checked, false);
    assert.strictEqual(app.__byId['unaccounted-features-body'].children[0].children[2].children[0].textContent, 'Assignment', 'the Type column shows the CalTopo type');
    const toggles = app.__byId['unaccounted-type-filters'].children.filter(el => el.dataset && el.dataset.typeKey);
    assert.deepStrictEqual(toggles.map(el => el.dataset.typeKey), ['marker', 'shape', 'assignment', 'route', 'other'], 'one toggle switch per feature type');
    assert.ok(toggles.every(el => el.children[1].children[0].checked === true), 'every toggle is on by default');

    app.showCalTopoShapesPopup(features);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
});

(async () => {
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(err && err.stack ? err.stack : err);
        }
    }
    if (failed) {
        console.log(`\n${failed} of ${checks.length} checks failed.`);
        process.exit(1);
    }
    console.log(`\nAll ${checks.length} unaccounted map feature app checks passed.`);
})();

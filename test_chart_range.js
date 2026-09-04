// Drives the real app.js in a sandbox (fake localStorage / DOM / fetch) to check
// the Start/End range of the PSRc and POS cumulative charts (Home / Search Log):
//   - by default Start is one hour before the earliest task assignment BY DATE
//     (a backdated task with a higher number still wins) and End is now,
//   - an edited Start/End is stored per user + case and survives a reload while
//     the other field keeps following its default,
//   - the tiny reset button only shows while a custom range is stored and
//     clicking it restores the defaults,
//   - another case does not inherit the stored range.
//
// Run with: node test_chart_range.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CHART_RANGE_KEY = 'sar-chart-range-v1';
const CASE = 'Case-1';
// getSyncBucket() namespaces the CASE # per login ("<case>_<username>"); the
// stored range is keyed by that bucket.
const BUCKET = 'Case-1_tester';

function makeElement() {
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
        textContent: '',
        innerHTML: '',
        value: ''
    };
    Object.defineProperty(el, 'parentElement', {get: () => null});
    return el;
}

function createSandbox({store, page = 'home'} = {}) {
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
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const settingsPuts = [];
    const logs = {warn: [], error: []};
    const sandbox = {
        console: {
            log() {}, info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
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
        // The settings endpoint answers with what this device last cached (the
        // cache is written right before every PUT, so it mirrors the server).
        fetch: async (url, init = {}) => {
            if (/\/api\/auth\/settings$/.test(String(url))) {
                if (init.method === 'PUT') settingsPuts.push(JSON.parse(init.body));
                return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => JSON.parse(store[SETTINGS_CACHE_KEY] || '{}')};
            }
            return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => ({success: true, applied: 1, modified: false})};
        },
        alert() {},
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        FormData: class FormData {},
        URL,
        URLSearchParams,
        location: {
            hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', search: '',
            pathname: `/${page}.html`,
            get href() { return `http://localhost/${page}.html`; },
            set href(_value) {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__settingsPuts = settingsPuts;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    return sandbox;
}

// Search Log rows: [task #, date MM-DD-YYYY, time HH:MM, region, segment, ...].
// Task #3 is backdated: it carries the highest number but the earliest time.
const SEARCH_LOG = [
    ['#1', '03-10-2026', '09:30', 'R1', 'A', '', '', 'Team 1 (3)', '50', '1'],
    ['#2', '03-10-2026', '11:00', 'R1', 'B', '', '', 'Team 2 (2)', '50', '1'],
    ['#3', '03-09-2026', '22:15', 'R1', 'C', '', '', 'Team 3 (4)', '50', '1']
];
// Default Start: one hour before the earliest task assignment (#3 at 22:15).
const EARLIEST_LOCAL = '2026-03-09T21:15';

function seedStore({searchLog = SEARCH_LOG, bucket = CASE, settings = {}} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify(Object.assign({}, settings, {'sar-sync-bucket-v1': bucket}));
    const scratch = createSandbox({store});
    const bundle = scratch.defaultBundle();
    bundle.fileName = bucket;
    bundle.pages.page4 = searchLog;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}

// Like the real page load: server settings are awaited before anything renders.
async function boot(store) {
    const app = createSandbox({store});
    await app.loadServerSettings();
    return app;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const minutesApart = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
const nowLocal = (app) => app.getLocalISOString(new Date());

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('the default range runs from one hour before the earliest task assignment (by date, not task number) to now', async () => {
    const app = await boot(seedStore());
    assert.strictEqual(app.getEarliestTaskAssignmentTs(), new Date(2026, 2, 9, 22, 15).getTime(), 'backdated #3 is the earliest');

    app.initCharts();
    assert.strictEqual(app.__byId['chart-start-datetime'].value, EARLIEST_LOCAL, 'Start defaults to one hour before the earliest task');
    assert.ok(minutesApart(app.__byId['chart-end-datetime'].value, nowLocal(app)) <= 1, 'End defaults to now');
    assert.strictEqual(app.__byId['chart-range-reset-btn'].style.display, 'none', 'no reset button while the defaults apply');
    assert.strictEqual(app.isChartRangeCustomized(), false);
    assert.deepStrictEqual(app.__logs.error, [], app.__logs.error.join(' | '));
});

check('with no dated task yet the default range is the last 24 hours', async () => {
    const app = await boot(seedStore({searchLog: [['', '', '', '', '', '', '', '', '', '']]}));
    assert.strictEqual(app.getEarliestTaskAssignmentTs(), 0);
    const range = app.getDefaultChartRange();
    assert.ok(Math.abs(minutesApart(range.start, range.end) - 24 * 60) <= 1, `${range.start} -> ${range.end}`);
});

check('an edited Start is stored for the user + case, survives a reload and shows the reset button; End keeps following now', async () => {
    const store = seedStore();
    const app = await boot(store);
    app.initCharts();

    const startInput = app.__byId['chart-start-datetime'];
    startInput.value = '2026-03-10T06:00';
    startInput.onchange();
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(app.resolveChartRange().start, '2026-03-10T06:00');
    assert.strictEqual(startInput.value, '2026-03-10T06:00');
    assert.strictEqual(app.__byId['chart-range-reset-btn'].style.display, '', 'the reset button appears once a value is edited');
    assert.deepStrictEqual(plain(app.getStoredChartRange()), {start: '2026-03-10T06:00', end: ''});
    assert.strictEqual(app.__settingsPuts.length, 1, 'the range is written to the per-user server settings');
    assert.deepStrictEqual(app.__settingsPuts[0][CHART_RANGE_KEY], {[BUCKET]: {start: '2026-03-10T06:00', end: ''}});
    assert.strictEqual(app.__settingsPuts[0]['sar-sync-bucket-v1'], CASE, 'the other settings (CASE #) are kept');

    // Reload: the edited Start is back, End is still "now".
    const reloaded = await boot(store);
    reloaded.initCharts();
    assert.strictEqual(reloaded.__byId['chart-start-datetime'].value, '2026-03-10T06:00');
    assert.ok(minutesApart(reloaded.__byId['chart-end-datetime'].value, nowLocal(reloaded)) <= 1);
    assert.strictEqual(reloaded.__byId['chart-range-reset-btn'].style.display, '');

    // Editing End as well keeps both.
    const endInput = reloaded.__byId['chart-end-datetime'];
    endInput.value = '2026-03-11T18:30';
    endInput.onchange();
    assert.deepStrictEqual(plain(reloaded.getStoredChartRange()), {start: '2026-03-10T06:00', end: '2026-03-11T18:30'});
    assert.strictEqual(reloaded.resolveChartRange().end, '2026-03-11T18:30');

    // Another case starts from the defaults again.
    const otherStore = seedStore({bucket: 'Case-2', settings: JSON.parse(store[SETTINGS_CACHE_KEY])});
    const other = await boot(otherStore);
    other.initCharts();
    assert.strictEqual(other.__byId['chart-start-datetime'].value, EARLIEST_LOCAL, 'the stored range belongs to Case-1 only');
    assert.strictEqual(other.__byId['chart-range-reset-btn'].style.display, 'none');
});

check('the reset button clears the stored range, hides itself and restores the defaults', async () => {
    const store = seedStore({settings: {[CHART_RANGE_KEY]: {[BUCKET]: {start: '2026-03-10T06:00', end: '2026-03-11T18:30'}}}});
    const app = await boot(store);
    app.initCharts();
    assert.strictEqual(app.__byId['chart-start-datetime'].value, '2026-03-10T06:00');
    assert.strictEqual(app.__byId['chart-end-datetime'].value, '2026-03-11T18:30');
    assert.strictEqual(app.__byId['chart-range-reset-btn'].style.display, '');

    app.__byId['chart-range-reset-btn'].onclick();
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(app.__byId['chart-start-datetime'].value, EARLIEST_LOCAL);
    assert.ok(minutesApart(app.__byId['chart-end-datetime'].value, nowLocal(app)) <= 1);
    assert.strictEqual(app.__byId['chart-range-reset-btn'].style.display, 'none');
    assert.deepStrictEqual(plain(app.getStoredChartRange()), {start: '', end: ''});
    assert.deepStrictEqual(JSON.parse(store[SETTINGS_CACHE_KEY])[CHART_RANGE_KEY], {}, 'nothing is left stored for the case');

    // Reload after the reset: still the defaults.
    const reloaded = await boot(store);
    reloaded.initCharts();
    assert.strictEqual(reloaded.__byId['chart-start-datetime'].value, EARLIEST_LOCAL);
});

check('clearing a field hands it back to its default and garbage in the settings is ignored', async () => {
    const store = seedStore({settings: {[CHART_RANGE_KEY]: {[BUCKET]: {start: 'not-a-date', end: '2026-03-11T18:30'}}}});
    const app = await boot(store);
    app.initCharts();
    assert.strictEqual(app.__byId['chart-start-datetime'].value, EARLIEST_LOCAL, 'an invalid stored Start falls back to the default');
    assert.strictEqual(app.__byId['chart-end-datetime'].value, '2026-03-11T18:30');

    const endInput = app.__byId['chart-end-datetime'];
    endInput.value = '';
    endInput.onchange();
    assert.ok(minutesApart(app.__byId['chart-end-datetime'].value, nowLocal(app)) <= 1, 'a cleared End is "now" again');
    assert.strictEqual(app.__byId['chart-range-reset-btn'].style.display, 'none');
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
    console.log(`\nAll ${checks.length} chart range checks passed.`);
})();

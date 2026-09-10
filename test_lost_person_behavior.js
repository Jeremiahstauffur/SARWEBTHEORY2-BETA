// Lost Person Behavior (Incident page section + Segments page switch).
//
// Part 1 checks the pure maths shared through map-segment-utils.js: the centre
// of a CalTopo shape, the distance to the IPP, which 25/50/75/95 % bracket a
// distance falls into and the PSR factor that follows from it.
//
// Part 2 drives the real app.js in a sandbox (in-memory store, fake DOM, a
// scripted fetch that records every request) to check that
//   - the section survives sanitizeBundle / saveBundle,
//   - PSRi is divided by the bracket percentage (x4 in the 25 % bracket, x2 in
//     the 50 % bracket), PSRc and the search log follow, segments beyond the
//     95 % distance or without a shape are left alone,
//   - the Segments page switch lifts and re-applies the adjustment without
//     losing the Incident page settings,
//   - importing the IPP marker stores its position in the case and sends the
//     section to the server as a row change (lost_person_behavior / lpb_ipp),
//   - the login's edited distances go to PUT /api/lpb/distances and the
//     defaults are read from GET /api/lpb/distances,
//   - the Incident page section and the Segments table (with the bracket tags
//     on the PSRi pills) render without errors.
//
// Run with: node test_lost_person_behavior.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const utils = require('./map-segment-utils');
const syncDelta = require('./sync-delta');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CASE = 'LPB-1';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

// ---------------------------------------------------------------------------
// Geometry helpers: the IPP sits at 45 N 93 W; one mile north is about
// 0.01447 degrees of latitude. Every segment is a small square (area centroid
// = its centre) `miles` north of the IPP.
// ---------------------------------------------------------------------------
const IPP = {lat: 45.0, lng: -93.0};
const MILE_IN_DEG_LAT = 1 / 69.09;
const squareAround = (lat, lng, half = 0.0005, closed = true) => {
    const ring = [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half]];
    if (closed) ring.push([lng - half, lat - half]);
    return ring;
};
const segmentShape = (name, id, milesNorth, options = {}) => ({
    geometry: {type: 'Polygon', coordinates: [squareAround(IPP.lat + milesNorth * MILE_IN_DEG_LAT, IPP.lng, 0.0005, options.closed !== false)]},
    attributes: {name, id, class: 'Assignment', ObjectID: 1}
});
const markerAt = (name, id, lat, lng) => ({
    geometry: {type: 'Point', coordinates: [lng, lat]},
    attributes: {name, id, class: 'Marker', ObjectID: 2}
});
const DISTANCES = {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0};

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('geometryCenterLngLat: point, open and closed rings, area-weighted collections', () => {
    assert.deepStrictEqual(utils.geometryCenterLngLat({type: 'Point', coordinates: [-93.1, 44.9]}), [-93.1, 44.9]);
    const open = utils.geometryCenterLngLat({type: 'Polygon', coordinates: [squareAround(45.01, -93.02, 0.001, false)]});
    const closed = utils.geometryCenterLngLat({type: 'Polygon', coordinates: [squareAround(45.01, -93.02, 0.001, true)]});
    near(open[0], -93.02, 1e-9, 'open ring lng');
    near(open[1], 45.01, 1e-9, 'open ring lat');
    assert.deepStrictEqual(open, closed, 'an open ring and its closed twin share the centroid');
    // A big square and a tiny one: the collection's centre stays with the big one.
    const collection = utils.geometryCenterLngLat({type: 'GeometryCollection', geometries: [
        {type: 'Polygon', coordinates: [squareAround(45.0, -93.0, 0.01)]},
        {type: 'Polygon', coordinates: [squareAround(45.5, -93.5, 0.0001)]}
    ]});
    near(collection[1], 45.0, 0.001, 'area-weighted collection lat');
    assert.strictEqual(utils.geometryCenterLngLat({type: 'Polygon', coordinates: []}), null);
    assert.strictEqual(utils.geometryCenterLngLat(null), null);
});

check('getFeatureCenter reads GeoJSON geometry or a marker position attribute', () => {
    assert.deepStrictEqual(utils.getFeatureCenter(markerAt('IPP', 'm1', 44.9, -93.1)), {lat: 44.9, lng: -93.1});
    assert.deepStrictEqual(utils.getFeatureCenter({attributes: {position: {lat: 44.5, lng: -93.5}}}), {lat: 44.5, lng: -93.5});
    assert.deepStrictEqual(utils.getFeatureCenter({attributes: {position: [-93.25, 44.25]}}), {lat: 44.25, lng: -93.25});
    assert.strictEqual(utils.getFeatureCenter({attributes: {name: 'nothing'}}), null);
    assert.strictEqual(utils.getFeatureCenter({geometry: {type: 'Point', coordinates: [500, 95]}}), null, 'out-of-range coordinates are unusable');
});

check('haversineMiles: one degree of latitude is about 69.1 miles', () => {
    near(utils.haversineMiles({lat: 44, lng: -93}, {lat: 45, lng: -93}), 69.09, 0.05, 'one degree north');
    near(utils.haversineMiles(IPP, IPP), 0, 1e-9, 'same point');
    assert.strictEqual(utils.haversineMiles(IPP, null), null);
    assert.strictEqual(utils.haversineMiles({lat: 'x', lng: 1}, IPP), null);
});

check('resolveLpbBracket picks the smallest distance that still contains the segment', () => {
    const at = (miles) => utils.resolveLpbBracket(miles, DISTANCES);
    assert.strictEqual(at(0.3).percent, 25);
    assert.strictEqual(at(0.3).factor, 4);
    assert.strictEqual(at(0.5).percent, 25, 'exactly on the 25 % distance stays in the 25 % bracket');
    assert.strictEqual(at(0.7).percent, 50);
    assert.strictEqual(at(0.7).factor, 2);
    assert.strictEqual(at(1.2).percent, 75);
    near(at(1.2).factor, 100 / 75, 1e-12, '75 % factor');
    assert.strictEqual(at(1.9).percent, 95);
    near(at(1.9).factor, 100 / 95, 1e-12, '95 % factor');
    assert.strictEqual(at(2.5), null, 'beyond the 95 % distance there is no bracket');
    assert.strictEqual(at(-1), null);
    assert.strictEqual(at('abc'), null);
    assert.strictEqual(utils.resolveLpbBracket(0.3, null), null);
    // With the 25 % distance missing the 50 % bracket is the smallest one left.
    assert.strictEqual(utils.resolveLpbBracket(0.3, {p50: 1, p75: 1.5, p95: 2}).percent, 50);
    // Two equal distances: the smaller percentage wins.
    assert.strictEqual(utils.resolveLpbBracket(0.8, {p25: 1, p50: 1, p75: 1.5, p95: 2}).percent, 25);
});

check('normalizeLpbDistanceMiles: miles to a tenth, positive numbers only', () => {
    assert.strictEqual(utils.normalizeLpbDistanceMiles('0.75'), 0.8);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('1 mi'), 1);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(1.25), 1.3);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('2,5'), 25, 'a thousands separator is dropped, not read as a decimal point');
    assert.strictEqual(utils.normalizeLpbDistanceMiles(0), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('-1'), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('abc'), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(''), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(null), null);
    assert.strictEqual(utils.formatLpbMiles(1), '1.0 mi');
    assert.strictEqual(utils.formatLpbMiles('x'), '');
    assert.strictEqual(utils.isCompleteLpbDistances(DISTANCES), true);
    assert.strictEqual(utils.isCompleteLpbDistances({p25: 0.5, p50: 1}), false);
    assert.strictEqual(utils.isCompleteLpbDistances(null), false);
});

check('normalizeLostPersonBehavior always yields the canonical shape', () => {
    assert.deepStrictEqual(utils.normalizeLostPersonBehavior(undefined), {
        psrAdjustmentEnabled: true,
        ipp: null,
        categories: {mentalIllness: {enabled: false, terrain: 'Mtn Temperate', distances: null}}
    });
    const messy = utils.normalizeLostPersonBehavior({
        psrAdjustmentEnabled: false,
        ipp: {lat: '44.95', lng: -93.05, featureId: 'mk1', featureName: 'IPP', importedAt: 't', importedBy: 'Jane', extra: 1},
        categories: {
            mentalIllness: {enabled: 'yes', terrain: 'Lunar', distances: {p25: '0.25', p50: 'x', p75: 1.5, p95: 2}},
            unknownCategory: {enabled: true}
        }
    });
    assert.deepStrictEqual(messy, {
        psrAdjustmentEnabled: false,
        ipp: {featureId: 'mk1', featureName: 'IPP', lat: 44.95, lng: -93.05, importedAt: 't', importedBy: 'Jane'},
        categories: {mentalIllness: {enabled: false, terrain: 'Mtn Temperate', distances: {p25: 0.3, p75: 1.5, p95: 2}}}
    });
    assert.strictEqual(utils.normalizeLostPersonBehavior({ipp: {lat: 200, lng: 0}}).ipp, null, 'an unusable position is no IPP');
    assert.strictEqual(utils.normalizeLpbTerrain('Dry'), 'Dry');
    assert.strictEqual(utils.getLpbCategory('mental illness').key, 'mentalIllness');
    assert.strictEqual(utils.getLpbCategory('mentalIllness').label, 'Mental Illness');
    assert.strictEqual(utils.getLpbCategory('dementia'), null);
    assert.deepStrictEqual(utils.LPB_TERRAINS, ['Mtn Temperate', 'Flat Temperate', 'Dry', 'Urban']);
    assert.deepStrictEqual(utils.LPB_SEED_DISTANCES, {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0});
});

const activeBundle = (overrides = {}) => ({
    lostPersonBehavior: {
        psrAdjustmentEnabled: true,
        ipp: {featureId: 'mk1', featureName: 'IPP', lat: IPP.lat, lng: IPP.lng},
        categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES}},
        ...overrides
    },
    maps: [{id: 'MAP1', features: [
        segmentShape('Alpha', 'a', 0.3),
        segmentShape('R1 - Bravo', 'gfx-2', 0.7, {closed: false}),
        segmentShape('Charlie', 'c', 5),
        markerAt('IPP', 'mk1', IPP.lat, IPP.lng)
    ]}]
});

check('buildLpbContext names why the adjustment is not active', () => {
    assert.strictEqual(utils.buildLpbContext(activeBundle()).active, true);
    assert.strictEqual(utils.buildLpbContext(activeBundle({psrAdjustmentEnabled: false})).reason, 'disabled');
    assert.strictEqual(utils.buildLpbContext(activeBundle({categories: {mentalIllness: {enabled: false}}})).reason, 'no-category');
    assert.strictEqual(utils.buildLpbContext(activeBundle({categories: {mentalIllness: {enabled: true, distances: {p25: 0.5}}}})).reason, 'no-distances');
    assert.strictEqual(utils.buildLpbContext(activeBundle({ipp: null})).reason, 'no-ipp');
    assert.strictEqual(utils.buildLpbContext({}).active, false);
    assert.strictEqual(utils.buildLpbContext(null).reason, 'no-category');
});

check('getLpbSegmentAdjustment finds the shape by CalTopo id or by name and grades the distance', () => {
    const context = utils.buildLpbContext(activeBundle());
    const byId = utils.getLpbSegmentAdjustment(['R1', 'Renamed', '640 ac', '1 mi', '100 ft', '', '', '', '', 'a'], context);
    assert.strictEqual(byId.matched, true);
    near(byId.distanceMiles, 0.3, 0.01, 'Alpha is 0.3 mi from the IPP');
    assert.strictEqual(byId.bracket.percent, 25);
    assert.strictEqual(byId.factor, 4);

    const byFullName = utils.getLpbSegmentAdjustment(['R1', 'Bravo', '640 ac', '1 mi', '100 ft', '', '', '', '', 'gfx-2'], context);
    assert.strictEqual(byFullName.matched, true, '"Region - Segment" matches the shape name; a gfx- id is never used');
    assert.strictEqual(byFullName.bracket.percent, 50);
    assert.strictEqual(byFullName.factor, 2);

    const far = utils.getLpbSegmentAdjustment(['R1', 'Charlie', '640 ac', '1 mi', '100 ft', '', '', '', '', ''], context);
    assert.strictEqual(far.matched, true);
    assert.strictEqual(far.bracket, null, 'beyond the 95 % distance');
    assert.strictEqual(far.factor, 1);

    const none = utils.getLpbSegmentAdjustment(['R1', 'Delta', '640 ac', '1 mi', '100 ft', '', '', '', '', ''], context);
    assert.deepStrictEqual(none, {matched: false, distanceMiles: null, bracket: null, factor: 1});

    assert.strictEqual(utils.getLpbSegmentAdjustment(['R1', 'Alpha'], utils.buildLpbContext(activeBundle({psrAdjustmentEnabled: false}))), null);
});

check('sync-delta mirrors the section into its own single-record table', () => {
    assert.strictEqual(syncDelta.SINGLE_TABLE_KEYS.lostPersonBehavior, 'lost_person_behavior');
    assert.deepStrictEqual(syncDelta.describeChangeTarget({path: ['lostPersonBehavior'], value: {}}), {kind: 'single', table: 'lost_person_behavior'});
});

// ---------------------------------------------------------------------------
// Part 2: app.js in a sandbox
// ---------------------------------------------------------------------------

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
        addEventListener(type, fn) { (el.listeners = el.listeners || {})[type] = fn; },
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        // A selector lookup hands back a fresh child hung under this element, so
        // what the page appends to it can still be found by walk().
        querySelector: () => { const child = makeElement(depth + 1); el.children.push(child); return child; },
        querySelectorAll: () => [],
        insertBefore(child) { el.children.push(child); return child; },
        after() {},
        focus() {},
        blur() {},
        closest: () => null,
        scrollIntoView() {},
        textContent: ''
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set: (value) => { html = String(value); el.children = []; }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    Object.defineProperty(el, 'className', {
        get: () => Array.from(classes).join(' '),
        set: (value) => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); }
    });
    return el;
}

// Every element in a subtree (children only; innerHTML strings are not parsed).
const walk = (el, out = []) => {
    (el.children || []).forEach(child => { out.push(child); walk(child, out); });
    return out;
};

function createSandbox({store, fetch, page = 'page2'} = {}) {
    const localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
    const sessionData = {};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
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
        createRange: () => ({selectNodeContents() {}}),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
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
        sessionStorage,
        SAR_MEMORY_STORAGE: store,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        getSelection: () => ({removeAllRanges() {}, addRange() {}}),
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: (url, init) => fetch(url, init),
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
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A sync server that accepts every row batch and answers the LPB distance
// endpoints; every request is recorded.
function createServer(options = {}) {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (/\/api\/lpb\/distances/.test(text)) {
            if (method === 'GET') {
                return json({
                    defaults: options.defaults || {'Mental Illness': {'Mtn Temperate': {p25: '0.5', p50: '1.0', p75: '1.5', p95: '2.0'}, Dry: {p25: '0.6', p50: '1.1', p75: '1.7', p95: '2.4'}}},
                    overrides: options.overrides || {'Mental Illness': {Dry: {p50: '1.3'}}}
                });
            }
            return json({success: true});
        }
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {fetch, requests};
}

// The case: two regions (R1 gets 60 % of the consensus), four R1 segments of
// one square mile each, and the CalTopo shapes of three of them.
const SEG = (name, caltopoId = '') => ['R1', name, '640 ac', '1 mi', '100 ft', '', '', '', '', caltopoId];
function seedStore({lpb, segments, searchLog, features} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', ''], ['R2', '4', '']], voterVisibility: [true]};
    bundle.pages.page2 = segments || [SEG('Alpha', 'a'), SEG('Bravo'), SEG('Charlie', 'c'), SEG('Delta')];
    if (searchLog) bundle.pages.page4 = searchLog;
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || activeBundle().maps[0].features}];
    if (lpb !== undefined) bundle.lostPersonBehavior = lpb;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const FULL_LPB = activeBundle().lostPersonBehavior;
const psri = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[6]]));
const psrc = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[7]]));
const settle = () => new Promise(resolve => setImmediate(resolve));

check('the section survives sanitizeBundle / saveBundle and starts out canonical', async () => {
    const store = seedStore();
    const app = createSandbox({store, fetch: createServer().fetch});
    assert.deepStrictEqual(plain(app.defaultBundle().lostPersonBehavior), utils.normalizeLostPersonBehavior(null));
    assert.deepStrictEqual(plain(app.loadBundle().lostPersonBehavior), utils.normalizeLostPersonBehavior(null));

    const bundle = app.loadBundle();
    bundle.lostPersonBehavior = FULL_LPB;
    await app.saveBundle(bundle);
    const reloaded = createSandbox({store, fetch: createServer().fetch}).loadBundle();
    assert.deepStrictEqual(plain(reloaded.lostPersonBehavior), utils.normalizeLostPersonBehavior(FULL_LPB));
    assert.strictEqual(reloaded.lostPersonBehavior.ipp.lat, IPP.lat);
    assert.strictEqual(reloaded.lostPersonBehavior.categories.mentalIllness.enabled, true);
});

check('PSRi is divided by the bracket percentage; PSRc and the search log follow', () => {
    const plainApp = createSandbox({store: seedStore(), fetch: createServer().fetch});
    plainApp.recalculateEverything();
    // ((100 ft * 1 mi) / 2 hr) * (0.6 * 640 / 2560) / (640 / 640) = 7.5 for every segment.
    assert.deepStrictEqual(psri(plainApp), {Alpha: '7.5000', Bravo: '7.5000', Charlie: '7.5000', Delta: '7.5000'});

    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: createServer().fetch});
    app.recalculateEverything();
    assert.deepStrictEqual(psri(app), {
        Alpha: '30.0000',   // 0.3 mi: 25 % bracket, PSRi / 0.25
        Bravo: '15.0000',   // 0.7 mi (matched as "R1 - Bravo"): 50 % bracket, PSRi / 0.50
        Charlie: '7.5000',  // 5 mi: beyond the 95 % distance
        Delta: '7.5000'     // no shape on the map
    });
    assert.deepStrictEqual(psrc(app), psri(app), 'nothing searched yet: PSRc equals PSRi');

    // A search of Alpha: PSR before uses the adjusted share (x4), then decays.
    const searched = createSandbox({
        store: seedStore({lpb: FULL_LPB, searchLog: [['#1', '', '', 'R1', 'Alpha', '', '', 'Team A (2)', '100 ft', '2']]}),
        fetch: createServer().fetch
    });
    searched.recalculateEverything();
    const log = searched.loadBundle().pages.page4[0];
    assert.strictEqual(log[5], '30.0000', 'PSR before the sweep is the adjusted PSRi');
    assert.ok(parseFloat(log[6]) < 30 && parseFloat(log[6]) > 0, `PSR after the sweep decays from the adjusted share (${log[6]})`);
    assert.strictEqual(psrc(searched).Alpha, log[6], 'PSRc of the searched segment is its PSR after');
    assert.strictEqual(psri(searched).Alpha, '30.0000');
});

check('the Segments page switch lifts and re-applies the adjustment without losing the settings', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch});
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '30.0000');

    await app.setLpbPsrAdjustmentEnabled(false);
    app.recalculateEverything();
    assert.deepStrictEqual(psri(app), {Alpha: '7.5000', Bravo: '7.5000', Charlie: '7.5000', Delta: '7.5000'});
    let lpb = app.loadBundle().lostPersonBehavior;
    assert.strictEqual(lpb.psrAdjustmentEnabled, false);
    assert.strictEqual(lpb.categories.mentalIllness.enabled, true, 'the category stays on');
    assert.deepStrictEqual(plain(lpb.categories.mentalIllness.distances), DISTANCES, 'the distances stay');
    assert.strictEqual(lpb.ipp.featureName, 'IPP', 'the IPP stays');
    assert.strictEqual(app.buildLpbContext(app.loadBundle()).reason, 'disabled');
    assert.ok(app.loadBundle().activityLog.some(e => /switched off on the Segments page/.test(e.action)), 'the switch is logged');

    await app.setLpbPsrAdjustmentEnabled(true);
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '30.0000');
    lpb = app.loadBundle().lostPersonBehavior;
    assert.strictEqual(lpb.psrAdjustmentEnabled, true);
    assert.strictEqual(await app.setLpbPsrAdjustmentEnabled(true), false, 'no change, nothing saved');
});

check('importing the IPP marker stores its position in the case and sends the section to the server', async () => {
    const server = createServer();
    const lpbWithoutIpp = {...FULL_LPB, ipp: null};
    const app = createSandbox({store: seedStore({lpb: lpbWithoutIpp}), fetch: server.fetch});
    assert.strictEqual(app.buildLpbContext(app.loadBundle()).reason, 'no-ipp');
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '7.5000', 'without an IPP nothing is adjusted');

    assert.strictEqual(app.setLostPersonIpp(markerAt('IPP', 'mk1', IPP.lat, IPP.lng)), true);
    await settle();
    const ipp = app.loadBundle().lostPersonBehavior.ipp;
    assert.strictEqual(ipp.featureId, 'mk1');
    assert.strictEqual(ipp.featureName, 'IPP');
    assert.strictEqual(ipp.lat, IPP.lat);
    assert.strictEqual(ipp.lng, IPP.lng);
    assert.ok(ipp.importedAt, 'the import time is kept');
    assert.ok(app.loadBundle().activityLog.some(e => /IPP imported from CalTopo marker "IPP"/.test(e.action)), 'the import is logged');

    const rowBatches = server.requests.filter(r => /\/rows/.test(r.url) && r.method === 'POST');
    assert.ok(rowBatches.length > 0, 'the change went to the server as a row batch');
    const changes = rowBatches.flatMap(r => r.body.changes || []);
    // The diff stops one level inside the section (one change per key), so the
    // IPP travels as lostPersonBehavior.ipp; the server maps any path under
    // lostPersonBehavior to the lost_person_behavior table (and lpb_ipp).
    const ippChange = changes.find(c => c.path[0] === 'lostPersonBehavior' && (c.path.length === 1 || c.path[1] === 'ipp'));
    assert.ok(ippChange, 'the batch carries the section\'s IPP');
    const sentIpp = ippChange.path.length === 1 ? ippChange.value.ipp : ippChange.value;
    assert.strictEqual(sentIpp.lat, IPP.lat, 'with the IPP position for the lpb_ipp table');
    assert.strictEqual(sentIpp.featureId, 'mk1');
    assert.ok(rowBatches.some(r => /\/api\/v1\/LPB-1_tester\/rows/.test(r.url)), 'under this login\'s bucket for the case');

    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '30.0000', 'the adjustment applies as soon as the IPP is there');
    assert.strictEqual(app.setLostPersonIpp({attributes: {name: 'nowhere'}}), false, 'a marker without a position is refused');

    app.clearLostPersonIpp();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.ipp, null);
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '7.5000');
});

check('the login\'s distances are read from and written to /api/lpb/distances', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch});
    const tables = await app.loadLpbDistances();
    assert.ok(server.requests.some(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'GET'), 'GET /api/lpb/distances');
    assert.strictEqual(tables.defaults['Mental Illness'].Dry.p50, 1.1, 'DECIMAL strings become numbers');
    assert.strictEqual(tables.overrides['Mental Illness'].Dry.p50, 1.3);
    assert.strictEqual(app.getLpbDefaultDistance('Mental Illness', 'Dry', 'p50'), 1.1);
    assert.strictEqual(app.getLpbDefaultDistance('Mental Illness', 'Urban', 'p50'), 1.0, 'a terrain the server did not list falls back to the seed value');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Dry')), {p25: 0.6, p50: 1.3, p75: 1.7, p95: 2.4}, 'the login\'s edit wins over the default');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Mtn Temperate')), {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0});

    assert.strictEqual(await app.saveLpbOverrideDistance('Mental Illness', 'Dry', 'p25', 0.9), true);
    const put = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.strictEqual(put.length, 1);
    assert.deepStrictEqual(put[0].body, {category: 'Mental Illness', terrain: 'Dry', values: {p25: 0.9, p50: 1.3, p75: null, p95: null}}, 'every bracket of the row travels; untouched ones as null');
    assert.strictEqual(put[0].body.category, 'Mental Illness');

    await app.saveLpbOverrideDistance('Mental Illness', 'Dry', 'p50', null);
    const put2 = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT')[1];
    assert.deepStrictEqual(put2.body.values, {p25: 0.9, p50: null, p75: null, p95: null}, 'a reset takes the bracket out of the login\'s row');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Dry')), {p25: 0.9, p50: 1.1, p75: 1.7, p95: 2.4});
});

check('switching a category on copies the login\'s distances into the case; edits update case and login', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch, page: 'page6'});
    await app.loadLpbDistances();
    const category = app.getLpbCategories()[0];

    // What the category switch does (buildLpbCategoryRow).
    app.updateLostPersonBehavior((lpb) => {
        const target = lpb.categories[category.key];
        target.enabled = true;
        target.terrain = 'Dry';
        if (!app.isCompleteLpbDistances(target.distances)) target.distances = app.getLpbEffectiveDistances(category.label, target.terrain);
        return 'on';
    });
    let entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.enabled, true);
    assert.deepStrictEqual(plain(entry.distances), {p25: 0.6, p50: 1.3, p75: 1.7, p95: 2.4}, 'the case starts from the login\'s Dry values');

    // Typing 2.0 under the 75 % column.
    app.setLpbCaseDistance(category, {key: 'p75', percent: 75}, 2.0, 1.7);
    await settle();
    entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.distances.p75, 2.0, 'the case has the typed value');
    const puts = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.deepStrictEqual(puts[puts.length - 1].body, {category: 'Mental Illness', terrain: 'Dry', values: {p25: null, p50: 1.3, p75: 2.0, p95: null}});
    assert.ok(app.loadBundle().activityLog.some(e => /75% distance changed from 1.7 mi to 2.0 mi/.test(e.action)), 'the edit is logged');

    // Reset to the database default (1.7): the login's row loses the bracket.
    app.setLpbCaseDistance(category, {key: 'p75', percent: 75}, app.getLpbDefaultDistance('Mental Illness', 'Dry', 'p75'), 2.0);
    await settle();
    entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.distances.p75, 1.7);
    const puts2 = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.deepStrictEqual(puts2[puts2.length - 1].body.values, {p25: null, p50: 1.3, p75: null, p95: null});
    assert.strictEqual(app.getLpbOverrideDistance('Mental Illness', 'Dry', 'p75'), null);
});

check('the Incident page section renders (heading with the IPP control, one row per category, the graph)', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch, page: 'page6'});
    app.buildProfilePage();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    const container = app.__byId['profile-form-container'];
    assert.ok(container.children.some(el => el.classList.contains('lpb-section')), 'the section is appended below the profile form');
    const section = app.__byId['lpb-section'];
    assert.ok(/Lost Person Behavior/.test(section.innerHTML), 'the section heading');
    assert.ok(/lpb-section-ipp/.test(section.innerHTML), 'the IPP control sits in the heading row');
    const rows = section.children.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(rows.length, 1, 'one row: Mental Illness');
    assert.strictEqual(rows[0].classList.contains('collapsed'), false, 'switched on: the graph is open');
    const header = rows[0].children[0];
    assert.ok(/lpb-category-toggle/.test(header.innerHTML) && /checked/.test(header.innerHTML), 'the switch is on');
    assert.ok(/Mental Illness/.test(header.innerHTML));
    const chart = walk(rows[0]).find(el => el.classList.contains('lpb-chart'));
    assert.ok(chart, 'the column graph is rendered');
    const labels = walk(chart).filter(el => el.classList.contains('lpb-chart-col-label')).map(el => el.textContent);
    assert.deepStrictEqual(labels, ['25%', '50%', '75%', '95%']);
    const bars = walk(chart).filter(el => el.classList.contains('lpb-chart-bar')).map(el => el.style.height);
    assert.deepStrictEqual(bars, ['25%', '50%', '75%', '100%'], 'the bars scale from 0 mi to the largest distance (2.0 mi)');
    const values = walk(chart).filter(el => el.classList.contains('lpb-chart-value')).map(el => el.textContent);
    assert.deepStrictEqual(values, ['0.5 mi', '1.0 mi', '1.5 mi', '2.0 mi']);
    assert.strictEqual(walk(chart).filter(el => el.classList.contains('lpb-reset-btn')).length, 0, 'every value is the default: no reset buttons');

    // The IPP control: a pill for the imported marker (Import IPP only when there is none).
    const ippPill = walk(section).find(el => el.classList.contains('lpb-ipp-pill'));
    assert.ok(ippPill, 'the imported IPP is shown as a pill');
    assert.strictEqual(walk(section).filter(el => el.classList.contains('lpb-import-ipp-btn')).length, 0);

    // A category that is off: collapsed, and the case with no IPP shows Import IPP.
    const offApp = createSandbox({store: seedStore(), fetch: server.fetch, page: 'page6'});
    offApp.buildProfilePage();
    await settle();
    const offSection = offApp.__byId['lpb-section'];
    const offRows = offSection.children.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(offRows[0].classList.contains('collapsed'), true);
    assert.ok(walk(offSection).some(el => el.classList.contains('lpb-import-ipp-btn')), 'Import IPP is offered when the case has no IPP');

    // An edited value gets a reset button.
    const edited = {...FULL_LPB, categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: {...DISTANCES, p50: 1.2}}}};
    const editedApp = createSandbox({store: seedStore({lpb: edited}), fetch: server.fetch, page: 'page6'});
    editedApp.buildProfilePage();
    await settle();
    const editedChart = walk(editedApp.__byId['lpb-section']).find(el => el.classList.contains('lpb-chart'));
    const resets = walk(editedChart).filter(el => el.classList.contains('lpb-reset-btn'));
    assert.strictEqual(resets.length, 1, 'only the edited 50 % value has a reset button');
    assert.ok(/1.0 mi/.test(resets[0].title), 'the reset names the database default');
});

check('the Segments page shows the switch state and tags the PSRi pills with their bracket', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch});
    // The sandbox's getElementById creates the elements the page would have.
    app.document.getElementById('lpb-toggle').checked = false;
    app.document.getElementById('lpb-label');
    app.buildSegmentsTable();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    assert.strictEqual(app.__byId['lpb-toggle'].checked, true, 'the switch shows the case\'s state');
    assert.ok(/^Applying Mental Illness \(Mtn Temperate\) from IPP "IPP"/.test(app.__byId['lpb-label'].textContent), app.__byId['lpb-label'].textContent);

    const tags = walk(app.__byId['table-body']).filter(el => el.classList.contains('psri-bracket-tag'));
    assert.deepStrictEqual(tags.map(t => t.textContent).sort(), ['25%', '50%'], 'Alpha (25 %) and Bravo (50 %) carry a tag; Charlie and Delta do not');
    assert.ok(/0\.3 mi from the IPP falls in the 25% bracket/.test(tags.find(t => t.textContent === '25%').title));
    const tagged = walk(app.__byId['table-body']).filter(el => el.classList.contains('has-lpb-tag'));
    assert.strictEqual(tagged.length, 2, 'the tagged PSRi containers let the tag overflow');

    // The switch: off lifts the adjustment and the tags.
    app.__byId['lpb-toggle'].checked = false;
    app.__byId['lpb-toggle'].onchange();
    await settle();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.psrAdjustmentEnabled, false);
    assert.strictEqual(psri(app).Alpha, '7.5000');
    assert.ok(/^Off - PSRi values are not adjusted\. Mental Illness and the IPP stay set/.test(app.__byId['lpb-label'].textContent), app.__byId['lpb-label'].textContent);
    assert.strictEqual(walk(app.__byId['table-body']).filter(el => el.classList.contains('psri-bracket-tag')).length, 0);

    // Status lines for the other states.
    assert.strictEqual(app.describeLpbStatus(app.buildLpbContext({})), 'No lost person category is switched on (Incident page, Lost Person Behavior).');
    assert.ok(/import the IPP marker/.test(app.describeLpbStatus(app.buildLpbContext({lostPersonBehavior: {...FULL_LPB, ipp: null}}))));
    assert.ok(/enter the four distances/.test(app.describeLpbStatus(app.buildLpbContext({lostPersonBehavior: {...FULL_LPB, categories: {mentalIllness: {enabled: true, distances: {p25: 1}}}}}))));
});

check('appendLpbBracketTag: a tag inside a bracket, a tooltip only beyond it or without a shape', () => {
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: createServer().fetch});
    const context = app.buildLpbContext(app.loadBundle());
    const tagged = () => {
        const container = makeElement();
        const cell = makeElement();
        return {container, cell};
    };

    let {container, cell} = tagged();
    app.appendLpbBracketTag(container, cell, SEG('Bravo'), context);
    assert.strictEqual(container.children.length, 1);
    assert.strictEqual(container.children[0].textContent, '50%');
    assert.strictEqual(container.classList.contains('has-lpb-tag'), true);
    assert.ok(/divided by 50%/.test(cell.title));

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Charlie', 'c'), context);
    assert.strictEqual(container.children.length, 0, 'beyond the 95 % distance: no tag');
    assert.ok(/beyond the 95% distance/.test(cell.title));

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Delta'), context);
    assert.strictEqual(container.children.length, 0, 'no shape: no tag');
    assert.ok(/no CalTopo shape/.test(cell.title));

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Alpha', 'a'), app.buildLpbContext({}));
    assert.strictEqual(container.children.length, 0, 'inactive: nothing');
    assert.strictEqual(cell.title, undefined);
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
    console.log(`\nLost Person Behavior: PASS (${checks.length} checks)`);
})();

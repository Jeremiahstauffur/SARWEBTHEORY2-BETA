// Lost Person Behavior: the "Rings on map" switch of every category and the
// purple discs it draws on the CalTopo map.
//
// Part 1 drives the shared module (map-segment-utils.js) directly:
//   - the circle of a distance around the IPP (closed ring, its radius and
//     area), the disc titles, the purple 10 % style, one disc per bracket
//     with a distance, none without an IPP,
//   - a disc counts as accounted for below the map (never "unaccounted").
// Part 2 runs the real app.js in a sandbox (in-memory store, fake DOM, fake
// sync server, caltopo_api_call recorded instead of sent):
//   - the switch in every category row, off by default,
//   - switching it on: one Shape POST per bracket (purple, 10 % fill), the
//     ids, IPP and distances recorded in the case, the discs in the case's
//     copy of the map (and not among the unaccounted shapes), the log entry,
//   - switching it off: one DELETE per disc, the record and the copy cleared,
//   - an edited distance / a moved IPP redraws the discs; a removed IPP or a
//     category switched off removes them and they come back with it,
//   - a device that merely receives the section leaves the map alone,
//   - CalTopo refusing: nothing recorded, the wish kept, told in a toast,
//   - the switch without an IPP: the wish is stored and explained, no calls.
//
// Run with: node test_lpb_map_rings.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const utils = require('./map-segment-utils');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CASE = 'Rings-1';
const PROXY_URL = 'http://localhost:3000/api/proxy';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

const IPP = {lat: 45.0, lng: -93.0, featureId: 'mk1', featureName: 'IPP'};
const DISTANCES = {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0};
const MILE_IN_DEG_LAT = 1 / 69.09;
const squareAround = (lat, lng, half = 0.0005) => [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half], [lng - half, lat - half]];
const segmentShape = (name, id, milesNorth) => ({
    geometry: {type: 'Polygon', coordinates: [squareAround(IPP.lat + milesNorth * MILE_IN_DEG_LAT, IPP.lng)]},
    attributes: {name, id, class: 'Assignment', ObjectID: 1}
});
const markerAt = (name, id, lat, lng) => ({geometry: {type: 'Point', coordinates: [lng, lat]}, attributes: {name, id, class: 'Marker', ObjectID: 2}});

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('buildLpbRingCoordinates: a closed circle of the distance around the IPP', () => {
    const ring = utils.buildLpbRingCoordinates(IPP, 1);
    assert.strictEqual(ring.length, 73, '72 points every 5 degrees plus the closing point');
    assert.deepStrictEqual(ring[0], ring[ring.length - 1], 'closed');
    ring.slice(0, -1).forEach((point, i) => near(utils.haversineMiles(IPP, {lat: point[1], lng: point[0]}), 1, 1e-4, `point ${i} is one mile out`));
    near(ring[0][0], IPP.lng, 1e-9, 'starts due north');
    assert.ok(ring[0][1] > IPP.lat);
    near(utils.polygonAreaAcres([ring]), Math.PI * 640, 3, 'about pi square miles in acres');
    const small = utils.buildLpbRingCoordinates(IPP, 0.5, 8);
    assert.strictEqual(small.length, 9, 'fewer points when asked');
    assert.strictEqual(utils.buildLpbRingCoordinates(IPP, 0), null);
    assert.strictEqual(utils.buildLpbRingCoordinates(IPP, 'x'), null);
    assert.strictEqual(utils.buildLpbRingCoordinates(null, 1), null);
    assert.strictEqual(utils.buildLpbRingCoordinates({lat: 200, lng: 0}, 1), null);
});

check('planLpbRingFeatures: one purple 10 % disc per bracket with a distance, titled after the category', () => {
    assert.strictEqual(utils.LPB_RING_COLOR, '#800080');
    assert.strictEqual(utils.LPB_RING_FILL_OPACITY, 0.1);
    assert.strictEqual(utils.LPB_RING_TITLE_PREFIX, 'LPB ring:');
    const discs = utils.planLpbRingFeatures('Mental Illness', 'Dry', DISTANCES, IPP);
    assert.deepStrictEqual(discs.map(d => [d.key, d.percent, d.miles]), [['p25', 25, 0.5], ['p50', 50, 1], ['p75', 75, 1.5], ['p95', 95, 2]]);
    assert.deepStrictEqual(discs.map(d => d.properties.title), [
        'LPB ring: Mental Illness 25% (0.5 mi)',
        'LPB ring: Mental Illness 50% (1.0 mi)',
        'LPB ring: Mental Illness 75% (1.5 mi)',
        'LPB ring: Mental Illness 95% (2.0 mi)'
    ]);
    discs.forEach(disc => {
        assert.strictEqual(disc.geometry.type, 'Polygon');
        assert.strictEqual(disc.geometry.coordinates.length, 1);
        assert.strictEqual(disc.geometry.coordinates[0].length, 73);
        near(utils.polygonAreaAcres(disc.geometry.coordinates), Math.PI * disc.miles * disc.miles * 640, Math.PI * disc.miles * disc.miles * 640 * 0.002, `${disc.percent}% disc area (to 0.2 %, the two earth models differ by that much)`);
        assert.strictEqual(disc.properties.fill, '#800080', 'purple fill');
        assert.strictEqual(disc.properties['fill-opacity'], 0.1, '10 % fill');
        assert.strictEqual(disc.properties.stroke, '#800080');
        assert.strictEqual(disc.properties['stroke-opacity'], 0.1, 'no outline to speak of');
        assert.strictEqual(disc.properties['stroke-width'], 1);
        assert.ok(/Lost Person Behavior: \d+% of Mental Illness \(Dry\) subjects are found within [\d.]+ mi of the IPP "IPP"/.test(disc.properties.description), disc.properties.description);
    });
    // Only the brackets with a distance; none without an IPP.
    assert.deepStrictEqual(utils.planLpbRingFeatures('Hiker', 'Dry', {p25: 0.5, p95: 3}, IPP).map(d => d.key), ['p25', 'p95']);
    assert.deepStrictEqual(utils.planLpbRingFeatures('Hiker', 'Dry', DISTANCES, null), []);
    assert.deepStrictEqual(utils.planLpbRingFeatures('Hiker', 'Dry', null, IPP), []);
    assert.strictEqual(utils.buildLpbRingTitle('Hiker', 95, 3), 'LPB ring: Hiker 95% (3.0 mi)');
    // A disc is recognised by its title, whatever attribute carries it.
    assert.strictEqual(utils.isLpbRingFeature({attributes: {title: 'LPB ring: Hiker 25% (0.5 mi)'}}), true);
    assert.strictEqual(utils.isLpbRingFeature({attributes: {name: 'LPB ring: Hiker 25% (0.5 mi)'}}), true);
    assert.strictEqual(utils.isLpbRingFeature({attributes: {name: 'Alpha'}}), false);
    assert.strictEqual(utils.isLpbRingFeature({}), false);
});

check('a ring disc is accounted for below the map: never listed as unaccounted', () => {
    const disc = {geometry: {type: 'Polygon', coordinates: [utils.buildLpbRingCoordinates(IPP, 0.5)]}, attributes: {id: 'ring-1', title: 'LPB ring: Hiker 25% (0.5 mi)', class: 'Shape'}};
    const other = {geometry: {type: 'Polygon', coordinates: [squareAround(45.1, -93.1)]}, attributes: {id: 'shape-1', title: 'Camp', class: 'Shape'}};
    assert.strictEqual(utils.isFeatureAccountedFor(disc, [], []), true);
    assert.strictEqual(utils.isFeatureAccountedFor(other, [], []), false);
    assert.deepStrictEqual(utils.getUnaccountedFeatures([disc, other], [], [], []).map(utils.getFeatureDisplayName), ['Camp']);
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
        setAttribute(name, value) { (el.attributes = el.attributes || {})[name] = String(value); },
        getAttribute: (name) => (el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null),
        querySelector: () => { const child = makeElement(depth + 1); el.children.push(child); return child; },
        querySelectorAll: () => [],
        insertBefore(child) { el.children.push(child); return child; },
        after() {},
        focus() {},
        blur() {},
        closest: () => null,
        scrollIntoView() {},
        getBoundingClientRect: () => ({left: 0, top: 0, width: 0, height: 0}),
        clientWidth: 300,
        clientHeight: 150,
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
const byClass = (root, cls) => walk(root).filter(el => el.classList.contains(cls));

function createSandbox({store, fetch, page = 'page6'} = {}) {
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
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        createRange: () => ({selectNodeContents() {}}),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const logs = {warn: [], error: [], alerts: []};
    const sandbox = {
        console: {
            log() {}, info() {}, group() {}, groupEnd() {},
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
        alert: (msg) => { logs.alerts.push(String(msg)); },
        confirm: () => true,
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
    // CalTopo writes are recorded instead of sent. The default answer is what
    // the Team API gives: {status, result} with the id of a created object.
    const posted = [];
    let created = 0;
    sandbox.caltopo_api_call = async (method, endpoint, payload, domain) => {
        posted.push({method, endpoint, payload: plain(payload), domain});
        if (sandbox.__caltopoAnswer) return sandbox.__caltopoAnswer(method, endpoint, payload);
        if (method === 'DELETE') return {status: 'ok'};
        if (/\/api\/v1\/map\/[^/]+\/[^/]+$/.test(endpoint)) return {status: 'ok', result: {id: `ring-${++created}`, type: 'Feature'}};
        return {status: 'ok', result: {id: payload && payload.id}};
    };
    sandbox.__posted = posted;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A sync server that accepts every row batch and answers the LPB distance
// endpoints; the CalTopo proxy has no shapes (so the quiet re-fetch after a
// write leaves the case's copy alone).
function createServer() {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (text.startsWith(PROXY_URL)) return json({features: []});
        if (/\/api\/lpb\/distances/.test(text)) {
            return method === 'GET'
                ? json({defaults: {'Mental Illness': {'Mtn Temperate': {p25: '0.5', p50: '1.0', p75: '1.5', p95: '2.0'}}}, overrides: {}})
                : json({success: true});
        }
        if (/declined-assignments/.test(text)) return json({declined: []});
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {fetch, requests};
}

const SEG = (name, caltopoId = '') => ['R1', name, '640 ac', '1 mi', '100 ft', '', '', '', '', caltopoId];
const FEATURES = () => [segmentShape('Alpha', 'a', 0.3), segmentShape('Charlie', 'c', 5), markerAt('IPP', 'mk1', IPP.lat, IPP.lng)];
const LPB = (overrides = {}) => ({
    psrAdjustmentEnabled: true,
    ipp: IPP,
    categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES}},
    ...overrides
});

function seedStore({lpb, features, maps} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', '']], voterVisibility: [true]};
    bundle.pages.page2 = [SEG('Alpha', 'a'), SEG('Charlie', 'c')];
    bundle.maps = maps !== undefined ? maps : [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || FEATURES()}];
    bundle.lostPersonBehavior = lpb === undefined ? LPB() : lpb;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const settle = async (rounds = 12) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };
const deepHtml = (el) => (el.innerHTML || '') + (el.children || []).map(deepHtml).join('');
const toasts = (app) => app.__body.children.filter(el => /notif-toast/.test(el.className || '')).map(deepHtml);
const rings = (app, key = 'mentalIllness') => plain(app.loadBundle().lostPersonBehavior.categories[key].rings);
const featureNames = (app) => plain(app.getMapFeatures(app.loadBundle()).map(app.getMapFeatureDisplayName));
const ringsToggleOf = (app, key = 'mentalIllness') => {
    const row = app.__byId['lpb-section'].children.find(el => el.classList.contains('lpb-category') && el.dataset.category === key);
    assert.ok(row, `the ${key} row`);
    return byClass(row, 'lpb-rings-toggle')[0];
};
const flipRings = async (app, checked, key = 'mentalIllness') => {
    const toggle = ringsToggleOf(app, key);
    assert.ok(toggle, 'the rings switch');
    toggle.checked = checked;
    toggle.onchange();
    await settle();
};
const psri = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[6]]));

check('every category row carries a "Rings on map" switch, off by default, after the terrain', async () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    app.buildProfilePage();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors: ${app.__logs.error.join(' | ')}`);
    const rows = app.__byId['lpb-section'].children.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(rows.length, utils.LPB_CATEGORIES.length);
    rows.forEach(row => {
        const toggles = byClass(row, 'lpb-rings-toggle');
        assert.strictEqual(toggles.length, 1, `${row.dataset.category} has one rings switch`);
        assert.strictEqual(toggles[0].checked, false, 'off');
        assert.strictEqual(typeof toggles[0].onchange, 'function');
        const label = byClass(row, 'lpb-rings-switch')[0];
        assert.ok(label && /purple discs at 10% opacity/.test(label.title), label && label.title);
        assert.ok(byClass(row, 'lpb-rings-switch-text')[0].textContent === 'Rings on map');
        assert.strictEqual(label.classList.contains('is-drawn'), false);
    });
    // The switch sits in the row's extras, after the terrain dropdown.
    const mental = rows.find(el => el.dataset.category === 'mentalIllness');
    const extras = walk(mental).find(el => el.children.some(c => c.classList.contains('lpb-terrain-select')) && el.children.some(c => c.classList.contains('lpb-rings-switch')));
    assert.ok(extras, 'terrain and rings switch share the extras');
    assert.ok(extras.children.findIndex(el => el.classList.contains('lpb-terrain-select')) < extras.children.findIndex(el => el.classList.contains('lpb-rings-switch')), 'terrain first');
    assert.deepStrictEqual(rings(app), {shown: false, featureIds: [], ipp: null, distances: null});
    // Static wiring: the switch, the module helpers and the stylesheet.
    assert.ok(/function buildLpbRingsSwitch\(category, entry, lpb\)/.test(appSource));
    assert.ok(/extras\.appendChild\(buildLpbRingsSwitch\(category, entry, lpb\)\)/.test(appSource), 'appended to the extras');
    assert.ok(/syncLpbRingsToCalTopo\(\)\.catch\(\(\) => \{\}\);/.test(appSource.slice(appSource.indexOf('function updateLostPersonBehavior('))), 'every section change brings the map in step');
    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    assert.ok(/\.lpb-rings-switch \{/.test(css) && /\.lpb-rings-switch\.is-drawn \{/.test(css), 'styled');
});

check('switching the rings on: one purple Shape POST per bracket, the record, the case\'s copy of the map, the log', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch});
    app.buildProfilePage();
    await settle();
    await flipRings(app, true);
    assert.deepStrictEqual(app.__logs.error, [], `no errors: ${app.__logs.error.join(' | ')}`);

    const posts = app.__posted;
    assert.strictEqual(posts.length, 4, 'one POST per bracket');
    posts.forEach((post, i) => {
        assert.strictEqual(post.method, 'POST');
        assert.strictEqual(post.endpoint, '/api/v1/map/MAP1/Shape', 'a plain Shape, no object id in the URL');
        assert.strictEqual(post.domain, 'caltopo.com');
        assert.strictEqual(post.payload.type, 'Feature');
        assert.strictEqual(post.payload.id, null);
        assert.strictEqual(post.payload.geometry.type, 'Polygon');
        assert.strictEqual(post.payload.geometry.coordinates[0].length, 73);
        const miles = [0.5, 1, 1.5, 2][i];
        near(utils.polygonAreaAcres(post.payload.geometry.coordinates), Math.PI * miles * miles * 640, Math.PI * miles * miles * 640 * 0.002, `disc ${i + 1} is a ${miles} mi circle`);
        assert.strictEqual(post.payload.properties.title, `LPB ring: Mental Illness ${[25, 50, 75, 95][i]}% (${miles.toFixed(1)} mi)`);
        assert.strictEqual(post.payload.properties.fill, '#800080', 'purple');
        assert.strictEqual(post.payload.properties['fill-opacity'], 0.1, '10 % fill');
        assert.strictEqual(post.payload.properties.stroke, '#800080');
        assert.strictEqual(post.payload.properties['stroke-opacity'], 0.1);
        assert.ok(/within [\d.]+ mi of the IPP "IPP"/.test(post.payload.properties.description));
    });

    // The case: the wish, the ids CalTopo gave, and what they were drawn for.
    assert.deepStrictEqual(rings(app), {shown: true, featureIds: ['ring-1', 'ring-2', 'ring-3', 'ring-4'], ipp: {lat: IPP.lat, lng: IPP.lng}, distances: DISTANCES});
    // The case's copy of the map has the discs (under CalTopo's ids), and they
    // are not unaccounted shapes.
    assert.deepStrictEqual(featureNames(app), ['Alpha', 'Charlie', 'IPP', 'LPB ring: Mental Illness 25% (0.5 mi)', 'LPB ring: Mental Illness 50% (1.0 mi)', 'LPB ring: Mental Illness 75% (1.5 mi)', 'LPB ring: Mental Illness 95% (2.0 mi)']);
    const discs = app.getMapFeatures(app.loadBundle()).slice(3);
    assert.deepStrictEqual(plain(discs.map(f => f.attributes.id)), ['ring-1', 'ring-2', 'ring-3', 'ring-4']);
    assert.ok(discs.every(f => f.attributes.class === 'Shape' && f.geometry.type === 'Polygon'));
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['IPP'], 'the discs are nothing to import (the marker is listed as before)');
    const log = app.loadBundle().activityLog;
    assert.ok(log.some(e => /Mental Illness \(Mtn Temperate\) rings on the CalTopo map switched on/.test(e.action)), 'the switch is logged');
    assert.ok(log.some(e => /Mental Illness \(Mtn Temperate\) rings drawn on the CalTopo map around IPP "IPP": 0\.5 mi, 1\.0 mi, 1\.5 mi, 2\.0 mi/.test(e.action)), `the drawing is logged: ${log.map(e => e.action).join(' | ')}`);
    assert.ok(toasts(app).some(html => /4 rings drawn on the CalTopo map/.test(html)), 'the toast');
    assert.deepStrictEqual(app.__logs.alerts, []);
    assert.ok(server.requests.some(r => /\/rows/.test(r.url) && r.method === 'POST'), 'the case was saved');
    // The switch now shows on, with the discs counted in its tooltip.
    const toggle = ringsToggleOf(app);
    assert.strictEqual(toggle.checked, true);
    const label = byClass(app.__byId['lpb-section'], 'lpb-rings-switch').find(el => el.classList.contains('is-drawn'));
    assert.ok(label && /4 discs on the map now/.test(label.title), label && label.title);
    // The rings are display only: the PSRi is what the distances make it
    // (((100 ft x 1 mi) / 2 hr) x (1.0 x 640 / 1280) / 1 = 25, plus 50 % for
    // Alpha's ground in the 25 % bracket).
    assert.strictEqual(psri(app).Alpha, '37.5000');
    assert.strictEqual(psri(app).Charlie, '25.0000');

    // Off again: one DELETE per disc, the record and the copy cleared, logged.
    app.__posted.length = 0;
    await flipRings(app, false);
    assert.deepStrictEqual(app.__logs.error, []);
    assert.deepStrictEqual(app.__posted.map(p => [p.method, p.endpoint]), [
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-1'],
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-2'],
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-3'],
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-4']
    ]);
    assert.deepStrictEqual(rings(app), {shown: false, featureIds: [], ipp: null, distances: null});
    assert.deepStrictEqual(featureNames(app), ['Alpha', 'Charlie', 'IPP']);
    assert.ok(app.loadBundle().activityLog.some(e => /Mental Illness \(Mtn Temperate\) rings removed from the CalTopo map$/.test(e.action)));
    assert.ok(toasts(app).some(html => /4 rings removed on the CalTopo map/.test(html)));
    assert.strictEqual(ringsToggleOf(app).checked, false);
});

check('the discs follow the settings: an edited distance or a moved IPP redraws them, a removed IPP or a switched-off category removes them until they are back', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch});
    app.buildProfilePage();
    await settle();
    await flipRings(app, true);
    assert.deepStrictEqual(rings(app).featureIds, ['ring-1', 'ring-2', 'ring-3', 'ring-4']);
    const mental = () => app.__byId['lpb-section'].children.find(el => el.classList.contains('lpb-category') && el.dataset.category === 'mentalIllness');
    const categoryToggle = () => walk(mental()).find(el => typeof el.onchange === 'function' && !el.classList.contains('lpb-terrain-select') && !el.classList.contains('lpb-rings-toggle'));

    // A distance edited on the graph: the old discs go, four new ones come.
    app.__posted.length = 0;
    const values = byClass(mental(), 'lpb-chart-value');
    const p95 = values[3];
    p95.textContent = '2.5';
    p95.listeners.blur();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors: ${app.__logs.error.join(' | ')}`);
    assert.deepStrictEqual(app.__posted.map(p => p.method), ['DELETE', 'DELETE', 'DELETE', 'DELETE', 'POST', 'POST', 'POST', 'POST'], 'redrawn: deletes, then creates');
    assert.deepStrictEqual(app.__posted.slice(0, 4).map(p => p.endpoint), ['/api/v1/map/MAP1/Shape/ring-1', '/api/v1/map/MAP1/Shape/ring-2', '/api/v1/map/MAP1/Shape/ring-3', '/api/v1/map/MAP1/Shape/ring-4']);
    assert.strictEqual(app.__posted[7].payload.properties.title, 'LPB ring: Mental Illness 95% (2.5 mi)');
    assert.deepStrictEqual(rings(app), {shown: true, featureIds: ['ring-5', 'ring-6', 'ring-7', 'ring-8'], ipp: {lat: IPP.lat, lng: IPP.lng}, distances: {...DISTANCES, p95: 2.5}});
    assert.deepStrictEqual(featureNames(app).slice(3), ['LPB ring: Mental Illness 25% (0.5 mi)', 'LPB ring: Mental Illness 50% (1.0 mi)', 'LPB ring: Mental Illness 75% (1.5 mi)', 'LPB ring: Mental Illness 95% (2.5 mi)']);

    // The IPP removed: the discs go, the wish stays.
    app.__posted.length = 0;
    app.clearLostPersonIpp();
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => [p.method, p.endpoint]), [
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-5'], ['DELETE', '/api/v1/map/MAP1/Shape/ring-6'],
        ['DELETE', '/api/v1/map/MAP1/Shape/ring-7'], ['DELETE', '/api/v1/map/MAP1/Shape/ring-8']
    ]);
    assert.deepStrictEqual(rings(app), {shown: true, featureIds: [], ipp: null, distances: null});
    assert.strictEqual(app.loadBundle().lostPersonBehavior.ipp, null);
    // A (new) IPP imported: drawn around it.
    app.__posted.length = 0;
    const marker = markerAt('IPP 2', 'mk2', IPP.lat + 0.01, IPP.lng);
    assert.strictEqual(app.setLostPersonIpp(marker), true);
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => p.method), ['POST', 'POST', 'POST', 'POST']);
    near(app.__posted[0].payload.geometry.coordinates[0][0][1], IPP.lat + 0.01 + 0.5 / 69.09, 1e-3, 'centred on the new IPP');
    assert.deepStrictEqual(rings(app).featureIds, ['ring-9', 'ring-10', 'ring-11', 'ring-12']);
    assert.deepStrictEqual(rings(app).ipp, {lat: IPP.lat + 0.01, lng: IPP.lng});

    // The category switched off: the discs go; on again: back.
    app.__posted.length = 0;
    const off = categoryToggle();
    off.checked = false;
    await off.onchange();
    await settle();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.categories.mentalIllness.enabled, false);
    assert.deepStrictEqual(app.__posted.map(p => p.method), ['DELETE', 'DELETE', 'DELETE', 'DELETE']);
    assert.deepStrictEqual(rings(app).featureIds, []);
    assert.strictEqual(rings(app).shown, true, 'the wish is kept');
    app.__posted.length = 0;
    const on = categoryToggle();
    on.checked = true;
    await on.onchange();
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => p.method), ['POST', 'POST', 'POST', 'POST']);
    assert.deepStrictEqual(rings(app).featureIds, ['ring-13', 'ring-14', 'ring-15', 'ring-16']);
    // Nothing else changed: another pass leaves the map alone.
    app.__posted.length = 0;
    await app.syncLpbRingsToCalTopo();
    assert.deepStrictEqual(app.__posted, []);
});

check('a device that merely receives the section leaves the map alone; a stale record is redrawn once, not on every pass', async () => {
    const drawn = LPB({categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES, rings: {shown: true, featureIds: ['r1', 'r2', 'r3', 'r4'], ipp: {lat: IPP.lat, lng: IPP.lng}, distances: DISTANCES}}}});
    const app = createSandbox({store: seedStore({lpb: drawn}), fetch: createServer().fetch});
    app.buildProfilePage();
    await settle();
    assert.strictEqual(ringsToggleOf(app).checked, true, 'the switch shows the other device\'s wish');
    await app.syncLpbRingsToCalTopo();
    assert.deepStrictEqual(app.__posted, [], 'the discs are already there');
    // The same device changes another category's terrain: still nothing for
    // Mental Illness, whose record is current.
    const hikerRow = app.__byId['lpb-section'].children.find(el => el.classList.contains('lpb-category') && el.dataset.category === 'hiker');
    const hikerToggle = walk(hikerRow).find(el => typeof el.onchange === 'function' && !el.classList.contains('lpb-terrain-select') && !el.classList.contains('lpb-rings-toggle'));
    hikerToggle.checked = true;
    await hikerToggle.onchange();
    await settle();
    assert.deepStrictEqual(app.__posted, [], 'no rings wanted for Hiker, Mental Illness is in step');

    // A record drawn for another IPP position: redrawn once.
    const stale = LPB({categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES, rings: {shown: true, featureIds: ['old-1', 'old-2'], ipp: {lat: IPP.lat + 1, lng: IPP.lng}, distances: DISTANCES}}}});
    const staleApp = createSandbox({store: seedStore({lpb: stale}), fetch: createServer().fetch});
    await staleApp.syncLpbRingsToCalTopo();
    assert.deepStrictEqual(staleApp.__posted.map(p => [p.method, p.endpoint]), [
        ['DELETE', '/api/v1/map/MAP1/Shape/old-1'], ['DELETE', '/api/v1/map/MAP1/Shape/old-2'],
        ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape']
    ]);
    assert.deepStrictEqual(rings(staleApp), {shown: true, featureIds: ['ring-1', 'ring-2', 'ring-3', 'ring-4'], ipp: {lat: IPP.lat, lng: IPP.lng}, distances: DISTANCES});
    staleApp.__posted.length = 0;
    await staleApp.syncLpbRingsToCalTopo();
    assert.deepStrictEqual(staleApp.__posted, []);
});

check('CalTopo refusing: nothing recorded, the wish kept and told in a toast; the next change tries again', async () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    app.__caltopoAnswer = () => null;
    app.buildProfilePage();
    await settle();
    await flipRings(app, true);
    assert.deepStrictEqual(app.__logs.error, []);
    assert.strictEqual(app.__posted.length, 4, 'tried every disc');
    assert.deepStrictEqual(rings(app), {shown: true, featureIds: [], ipp: null, distances: null});
    assert.deepStrictEqual(featureNames(app), ['Alpha', 'Charlie', 'IPP'], 'nothing added to the case\'s copy');
    assert.ok(toasts(app).some(html => /CalTopo did not take every ring for Mental Illness/.test(html)), toasts(app).join(' | '));
    assert.ok(!app.loadBundle().activityLog.some(e => /rings drawn/.test(e.action)));
    // CalTopo back: the next change of the section draws them.
    app.__caltopoAnswer = null;
    app.__posted.length = 0;
    app.setLpbCaseDistance(utils.getLpbCategory('mentalIllness'), {key: 'p25', percent: 25}, 0.6, 0.5);
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => p.method), ['POST', 'POST', 'POST', 'POST']);
    assert.deepStrictEqual(rings(app).featureIds, ['ring-1', 'ring-2', 'ring-3', 'ring-4']);
    assert.deepStrictEqual(rings(app).distances, {...DISTANCES, p25: 0.6});

    // Two of four taken: the record keeps the two, is marked incomplete and
    // the next pass completes the set (deleting the two first).
    const half = createSandbox({store: seedStore(), fetch: createServer().fetch});
    let n = 0;
    half.__caltopoAnswer = (method) => (method === 'POST' && ++n % 2 === 0 ? null : {status: 'ok', result: {id: `half-${n}`}});
    half.buildProfilePage();
    await settle();
    await flipRings(half, true);
    assert.deepStrictEqual(rings(half), {shown: true, featureIds: ['half-1', 'half-3'], ipp: null, distances: null});
    assert.ok(half.loadBundle().activityLog.some(e => /rings drawn on the CalTopo map .* \(2 of 4 not taken\)/.test(e.action)));
    half.__caltopoAnswer = null;
    half.__posted.length = 0;
    await half.syncLpbRingsToCalTopo();
    assert.deepStrictEqual(half.__posted.map(p => [p.method, p.endpoint]), [
        ['DELETE', '/api/v1/map/MAP1/Shape/half-1'], ['DELETE', '/api/v1/map/MAP1/Shape/half-3'],
        ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape'], ['POST', '/api/v1/map/MAP1/Shape']
    ]);
    assert.strictEqual(rings(half).featureIds.length, 4);
    assert.deepStrictEqual(rings(half).ipp, {lat: IPP.lat, lng: IPP.lng});
});

check('the switch without an IPP, without distances or without a map: the wish is stored and explained, nothing is sent', async () => {
    const noIpp = createSandbox({store: seedStore({lpb: LPB({ipp: null})}), fetch: createServer().fetch});
    noIpp.buildProfilePage();
    await settle();
    await flipRings(noIpp, true);
    assert.deepStrictEqual(noIpp.__posted, []);
    assert.deepStrictEqual(rings(noIpp), {shown: true, featureIds: [], ipp: null, distances: null});
    assert.ok(toasts(noIpp).some(html => /Import the IPP marker first/.test(html)), toasts(noIpp).join(' | '));
    const label = byClass(noIpp.__byId['lpb-section'], 'lpb-rings-switch').find(el => /Waiting for the IPP/.test(el.title));
    assert.ok(label, 'the tooltip says what it waits for');
    // The IPP imported: drawn.
    await settle();
    assert.strictEqual(noIpp.setLostPersonIpp(markerAt('IPP', 'mk1', IPP.lat, IPP.lng)), true);
    await settle();
    assert.deepStrictEqual(noIpp.__posted.map(p => p.method), ['POST', 'POST', 'POST', 'POST']);
    assert.deepStrictEqual(rings(noIpp).featureIds, ['ring-1', 'ring-2', 'ring-3', 'ring-4']);

    const noMap = createSandbox({store: seedStore({maps: []}), fetch: createServer().fetch});
    noMap.buildProfilePage();
    await settle();
    await flipRings(noMap, true);
    assert.deepStrictEqual(noMap.__posted, []);
    assert.strictEqual(rings(noMap).shown, true);
    assert.ok(toasts(noMap).some(html => /No CalTopo map is linked/.test(html)));

    // Off while nothing is drawn (a wish another device could not meet yet):
    // no calls, no log line about a removal. Rendering alone never writes.
    const idle = createSandbox({store: seedStore({lpb: LPB({categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES, rings: {shown: true}}}})}), fetch: createServer().fetch});
    idle.__caltopoAnswer = () => { throw new Error('CalTopo must not be called'); };
    idle.buildProfilePage();
    await settle();
    assert.strictEqual(ringsToggleOf(idle).checked, true);
    await flipRings(idle, false);
    assert.deepStrictEqual(idle.__posted, []);
    assert.strictEqual(rings(idle).shown, false);
    assert.ok(idle.loadBundle().activityLog.some(e => /rings on the CalTopo map switched off/.test(e.action)));
    assert.ok(!idle.loadBundle().activityLog.some(e => /rings removed/.test(e.action)));
    assert.deepStrictEqual(idle.__logs.error, []);
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
    console.log(`\nLost Person Behavior map rings: PASS (${checks.length} checks)`);
})();

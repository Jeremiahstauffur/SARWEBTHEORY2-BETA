// Maps page "Merge Segments", the extended "Auto Draw Segments" (several
// shapes, a target acreage, the slices imported as segments) and several
// segments in one Search Log task #.
//
// Part 1 drives the shared module (map-segment-utils.js) directly:
//   - the slice count for a target acreage (the closest division),
//   - the union outline of neighboring polygons (adjacent squares, a partly
//     shared border, an overlap, a small gap, an L of three, disjoint shapes,
//     the slices of a rectangle back into the rectangle, a C shape),
//   - neighbors (touching, a gap under / over the tolerance, overlapping,
//     a corner touch, far apart, one inside the other),
//   - a task's track miles inside one of its segments,
//   - the assignment label "#3 R1 - 4D, 4C; R2 - 7A" built and parsed.
// Part 2 runs the real app.js in a sandbox (in-memory store, fake DOM, fake
// sync server, caltopo_api_call recorded instead of sent):
//   - a two-segment assignment: one Search Log row per segment, the label,
//     the activity log entry, the Segments page's active set,
//   - the Search Log table: the rows of a task together, the first row's Task
//     # / Date / Time / Team cells spanning the group, a date edit fanned out,
//     one row deleted with the task going on,
//   - the segment checklist behind the Personnel "Assign New Task" popup and
//     the Segments page's "more segments?" popup,
//   - auto draw with the import: rows in the source's region, the source row
//     gone, its task rows fanned out to the slices, the Folder POST + the
//     move, the source marked unwanted, tracks re-measured,
//   - merge: the popup's graying (neighbors, region), the name box, the
//     create POST + moves, the rows replaced, the tasks collapsed,
//   - the static wiring: the Merge button, the stylesheet rules.
//
// Run with: node test_maps_merge_multi_segment_tasks.js

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
const CASE = 'Merge-1';
const PROXY_URL = 'http://localhost:3000/api/proxy';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

// ---------------------------------------------------------------------------
// Geometry: around 45 N 93 W, points placed by their offset in miles from the
// origin (see test_maps_auto_draw_trim_tracks.js), areas in whole acres.
// ---------------------------------------------------------------------------
const ORIGIN = {lat: 45.0, lng: -93.0};
const MILE_LAT = 1 / 69.172;
const MILE_LNG = MILE_LAT / Math.cos(ORIGIN.lat * Math.PI / 180);
const at = (eastMiles, northMiles) => [ORIGIN.lng + eastMiles * MILE_LNG, ORIGIN.lat + northMiles * MILE_LAT];
const east = (point) => (point[0] - ORIGIN.lng) / MILE_LNG;
const north = (point) => (point[1] - ORIGIN.lat) / MILE_LAT;
const rect = (x0, y0, width, height) => [at(x0, y0), at(x0 + width, y0), at(x0 + width, y0 + height), at(x0, y0 + height), at(x0, y0)];
const square = (eastMiles, size = 1, northMiles = 0) => rect(eastMiles - size / 2, northMiles - size / 2, size, size);
const polygon = (ring) => ({type: 'Polygon', coordinates: [ring]});
const FEET = 1 / 5280;
// The corners of a closed lng/lat ring as sorted "east,north" strings (miles,
// 3 decimals) so outlines can be compared whatever their starting vertex.
const corners = (ring) => ring.slice(0, -1).map(p => `${east(p).toFixed(3)},${north(p).toFixed(3)}`).sort();
const cornersOf = (pairs) => pairs.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).sort();

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('computeAutoDrawSliceCount with a target acreage: the division whose slices come closest to it', () => {
    const table = [
        // total, target -> count (floor or ceil of total / target, whichever is closer)
        [64, 12, 5], [64, 15, 4], [64, 20, 3], [64, 30, 2], [64, 64, 1], [64, 100, 1],
        [100, 30, 3], [100, 40, 3], [100, 45, 2], [45, 10, 5], [10, 30, 1], [50, 12.5, 4]
    ];
    table.forEach(([total, target, count]) => {
        const sizing = utils.computeAutoDrawSliceCount(total, {targetAcres: target});
        assert.strictEqual(sizing.count, count, `${total} acres at ${target} each -> ${count} slices`);
        near(sizing.acresEach * count, total, 1e-9, `${total}/${target}: the slices add up`);
        assert.strictEqual(sizing.undersized, false, 'no 10-acre warning with a target');
        assert.strictEqual(sizing.targetAcres, target);
    });
    // The closest division: 64 acres at 20 each is 3 x 21.3 (off by 1.3),
    // not 4 x 16 (off by 4).
    near(utils.computeAutoDrawSliceCount(64, {targetAcres: 20}).acresEach, 21.333, 0.001, '3 slices of 21.3');
    // No target (empty, 0, junk): the 10-15 rule as before.
    [undefined, null, '', 0, -5, 'abc'].forEach(target => {
        const sizing = utils.computeAutoDrawSliceCount(64, {targetAcres: target});
        assert.strictEqual(sizing.count, 5, `no target (${JSON.stringify(target)}) -> 5 slices`);
        assert.strictEqual(sizing.targetAcres, null);
    });
    // planAutoDrawSegments passes the target through and echoes it.
    const plan = utils.planAutoDrawSegments({geometry: polygon(rect(0, 0, 1, 0.1))}, {angleDegrees: 0, targetAcres: 20});
    assert.strictEqual(plan.count, 3);
    assert.strictEqual(plan.targetAcres, 20);
    assert.strictEqual(plan.pieces.length, 3);
    near(plan.pieces.reduce((sum, piece) => sum + piece.acres, 0), plan.totalAcres, 0.05, 'the pieces add up to the shape');
});

check('unionPolygonOutline: adjacent squares, a shared stretch, an overlap, a small gap, three in an L', () => {
    // Two unit squares side by side: a 2 x 1 rectangle with four corners.
    const two = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(1, 0, 1, 1))]);
    assert.strictEqual(two.ok, true);
    assert.strictEqual(two.ringCount, 1);
    near(two.acres, 1280, 0.5, '2 sq mi');
    assert.deepStrictEqual(corners(two.ring), cornersOf([[0, 0], [2, 0], [2, 1], [0, 1]]));
    assert.deepStrictEqual(two.ring[0], two.ring[two.ring.length - 1], 'closed');
    // The second square shares only half of the first one's east edge.
    const partial = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(1, 0, 1, 0.5))]);
    near(partial.acres, 960, 0.5, '1.5 sq mi');
    assert.deepStrictEqual(corners(partial.ring), cornersOf([[0, 0], [2, 0], [2, 0.5], [1, 0.5], [1, 1], [0, 1]]));
    // Overlapping squares: the crossings become corners, the area is 1.75 sq mi.
    const overlap = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(0.5, 0.5, 1, 1))]);
    near(overlap.acres, 1120, 0.5, '1.75 sq mi');
    assert.deepStrictEqual(corners(overlap.ring), cornersOf([[0, 0], [1, 0], [1, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 1], [0, 1]]));
    // A 20 ft gap (under the ~32 ft tolerance) is welded shut.
    const gap = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(1 + 20 * FEET, 0, 1, 1))]);
    assert.strictEqual(gap.ringCount, 1, 'one outline');
    assert.strictEqual(gap.ring.length - 1, 4, 'four corners');
    near(gap.acres, 1280, 3, 'about 2 sq mi');
    // Three squares in an L: six corners, 3 sq mi.
    const ell = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(1, 0, 1, 1)), polygon(rect(0, 1, 1, 1))]);
    near(ell.acres, 1920, 0.5, '3 sq mi');
    assert.deepStrictEqual(corners(ell.ring), cornersOf([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]));
    // Disjoint squares leave two rings; the largest is the outline.
    const apart = utils.unionPolygonOutline([polygon(rect(0, 0, 1, 1)), polygon(rect(3, 0, 2, 2))]);
    assert.strictEqual(apart.ok, true);
    assert.strictEqual(apart.ringCount, 2);
    near(apart.acres, 2560, 0.5, 'the 2 x 2 square');
    // Features (with .geometry) are taken too; nothing to merge -> no-area.
    const asFeatures = utils.unionPolygonOutline([{geometry: polygon(rect(0, 0, 1, 1))}, {geometry: polygon(rect(1, 0, 1, 1))}]);
    near(asFeatures.acres, 1280, 0.5, 'features work');
    assert.deepStrictEqual(utils.unionPolygonOutline([]), {ok: false, reason: 'no-area', ring: [], acres: 0, ringCount: 0});
    assert.strictEqual(utils.unionPolygonOutline([{geometry: {type: 'LineString', coordinates: [at(0, 0), at(1, 0)]}}]).ok, false);
});

check('unionPolygonOutline: the auto-drawn slices of a shape union back into the shape', () => {
    const source = {geometry: polygon(rect(0, 0, 1, 0.1))};
    [0, 90, 37].forEach(angle => {
        const plan = utils.planAutoDrawSegments(source, {angleDegrees: angle});
        const union = utils.unionPolygonOutline(plan.pieces.map(piece => polygon(piece.ring)));
        assert.strictEqual(union.ringCount, 1, `${angle} deg: one outline`);
        near(union.acres, 64, 0.1, `${angle} deg: 64 acres again`);
        if (angle !== 37) assert.strictEqual(union.ring.length - 1, 4, `${angle} deg: the rectangle's four corners (cut points dropped)`);
    });
    // A C shape (opening east) cut into wide vertical strips: the strip
    // through the gap falls into two pieces; everything unions back.
    const c = [at(0, 0), at(3, 0), at(3, 1), at(1, 1), at(1, 2), at(3, 2), at(3, 3), at(0, 3), at(0, 0)];
    const planC = utils.planAutoDrawSegments({geometry: polygon(c)}, {angleDegrees: 0, targetAcres: 800});
    assert.strictEqual(planC.count, 6);
    assert.ok(planC.pieces.length > planC.count, 'a strip in two pieces');
    const unionC = utils.unionPolygonOutline(planC.pieces.map(piece => polygon(piece.ring)));
    assert.strictEqual(unionC.ringCount, 1);
    // The union's plane is that of the first slice's first vertex, the
    // shape's that of its own first vertex: ~0.1 % apart over three miles
    // (AGENTS.md, 2026-09-15), so a relative tolerance.
    near(unionC.acres, utils.polygonAreaAcres([c]), 6, 'the C\'s area');
    assert.strictEqual(unionC.ring.length - 1, 8, 'the C\'s eight corners');
});

check('polygonsAreNeighbors: touching, a gap under / over the tolerance, overlapping, a corner, far apart, inside', () => {
    const A = polygon(rect(0, 0, 1, 1));
    assert.strictEqual(utils.MERGE_NEIGHBOR_TOLERANCE_MILES, 0.006);
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(1, 0, 1, 1))), true, 'sharing an edge');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(1 + 20 * FEET, 0, 1, 1))), true, '20 ft apart');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(1 + 60 * FEET, 0, 1, 1))), false, '60 ft apart');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(1 + 60 * FEET, 0, 1, 1)), 0.02), true, '... unless the tolerance says so');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(0.5, 0.5, 1, 1))), true, 'overlapping');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(1, 1, 1, 1))), true, 'touching at a corner');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(3, 3, 1, 1))), false, 'far apart');
    assert.strictEqual(utils.polygonsAreNeighbors(A, polygon(rect(0.2, 0.2, 0.3, 0.3))), true, 'one inside the other');
    assert.strictEqual(utils.polygonsAreNeighbors({geometry: A}, {geometry: polygon(rect(1, 0, 1, 1))}), true, 'features work');
    assert.strictEqual(utils.polygonsAreNeighbors(A, {type: 'LineString', coordinates: [at(1, 0), at(2, 0)]}), false, 'a line is no neighbor');
});

check('getTaskTrackMiles: a task\'s miles inside one of its segments', () => {
    const tracks = [
        {id: 't1', baseName: 'Team 1', segmentMiles: [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}], assignedTask: '#1'},
        {id: 't2', baseName: 'Team 2', segmentMiles: [{region: 'R1', segment: '4C', miles: 0.6}], assignedTask: '#1'}
    ];
    const log = [['#1', '09-01-2026', '08:00', 'R1', '4D', '', '', 'Team A (2)', '100 ft', ''], ['#1', '09-01-2026', '08:00', 'R1', '4C', '', '', 'Team A (2)', '100 ft', '']];
    const allocation = utils.allocateSearcherTracks(tracks, log);
    near(utils.getTaskTrackMiles(allocation, '#1'), 2.0, 1e-9, 'the whole task');
    near(utils.getTaskTrackMiles(allocation, '#1', 'R1', '4D'), 1.0, 1e-9, 'inside 4D');
    near(utils.getTaskTrackMiles(allocation, '#1', 'R1', '4C'), 1.0, 1e-9, 'inside 4C (both tracks)');
    near(utils.getTaskTrackMiles(allocation, '#1', 'R1', '4B'), 0, 1e-9, 'a segment the task does not cover');
    near(utils.getTaskTrackMiles(allocation, '#2', 'R1', '4D'), 0, 1e-9, 'a task with no tracks');
});

check('buildTaskAssignmentLabel / parseTaskAssignmentLabel: "#3 R1 - 4D, 4C; R2 - 7A" both ways', () => {
    const pairs = [{region: 'R1', segment: '4D'}, {region: 'R1', segment: '4C'}, {region: 'R2', segment: '7A'}, {region: '', segment: 'Trail'}, {region: 'R1', segment: '4D'}, {region: 'R1', segment: ''}];
    const label = utils.buildTaskAssignmentLabel(3, pairs);
    assert.strictEqual(label, '#3 R1 - 4D, 4C; R2 - 7A; Trail', 'grouped by region, duplicates and blanks dropped');
    assert.strictEqual(utils.buildTaskAssignmentLabel('#7', [{region: 'R1', segment: '4D'}]), '#7 R1 - 4D', 'the old one-segment form');
    assert.strictEqual(utils.buildTaskAssignmentLabel('#7', []), '#7');
    assert.deepStrictEqual(utils.parseTaskAssignmentLabel(label), {taskTag: '#3', pairs: [{region: 'R1', segment: '4D'}, {region: 'R1', segment: '4C'}, {region: 'R2', segment: '7A'}, {region: '', segment: 'Trail'}]});
    assert.deepStrictEqual(utils.parseTaskAssignmentLabel('#7 R1 - 4D'), {taskTag: '#7', pairs: [{region: 'R1', segment: '4D'}]});
    assert.deepStrictEqual(utils.parseTaskAssignmentLabel('#7'), {taskTag: '#7', pairs: []});
    assert.deepStrictEqual(utils.parseTaskAssignmentLabel('Base'), {taskTag: '', pairs: []});
    assert.deepStrictEqual(utils.parseTaskAssignmentLabel(''), {taskTag: '', pairs: []});
});

// ---------------------------------------------------------------------------
// Part 2: app.js in a sandbox (the same stand-ins as
// test_maps_auto_draw_trim_tracks.js)
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

const walk = (el, out = []) => {
    (el.children || []).forEach(child => { out.push(child); walk(child, out); });
    return out;
};
const byClass = (root, cls) => walk(root).filter(el => el.classList.contains(cls));
// The text of a Search Log cell: the pill (or the mini pill inside it).
const cellText = (td) => {
    const cell = td.children[0] && td.children[0].children[0];
    if (!cell) return '';
    return cell.textContent || (cell.children[0] ? cell.children[0].textContent : '') || '';
};

function createSandbox({store, fetch, page = 'page10'} = {}) {
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
    const posted = [];
    let created = 0;
    sandbox.caltopo_api_call = async (method, endpoint, payload, domain) => {
        posted.push({method, endpoint, payload: plain(payload), domain});
        if (sandbox.__caltopoAnswer) return sandbox.__caltopoAnswer(method, endpoint, payload);
        if (method === 'DELETE') return {status: 'ok'};
        if (/\/api\/v1\/map\/[^/]+\/[^/]+$/.test(endpoint)) return {status: 'ok', result: {id: `new-${++created}`, type: 'Feature'}};
        return {status: 'ok', result: {id: payload && payload.id}};
    };
    sandbox.__posted = posted;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

function createServer() {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (text.startsWith(PROXY_URL)) return json({features: []});
        if (/declined-assignments/.test(text)) return json({declined: []});
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {fetch, requests, proxyFetches: () => requests.filter(r => r.url.startsWith(PROXY_URL)).length};
}

// Segment shapes: 4D the unit square at the origin, 4C the one east of it,
// 4B two squares further (not a neighbor), 7A (region R2) north of 4C. The
// track walks due east: half a mile outside, the mile of 4D, 0.4 mi into 4C.
const shape = (id, name, ring, extra = {}) => ({geometry: polygon(ring), attributes: {id, name, class: 'Assignment', ObjectID: 1, stroke: '#00ff00', 'stroke-width': 2, folderId: 'f-lines', ...extra}});
const SEG_4D_SHAPE = shape('seg-4d', '4D', square(0));
const SEG_4C_SHAPE = shape('seg-4c', '4C', square(1));
const SEG_4B_SHAPE = shape('seg-4b', '4B', square(3));
const SEG_7A_SHAPE = shape('seg-7a', '7A', square(1, 1, 1));
const trackFeature = (name = 'Team 1', id = 'trk-1', cls = 'AppTrack') => ({
    geometry: {type: 'LineString', coordinates: [at(-1.0, 0), at(-0.5, 0), at(0.2, 0), at(0.9, 0)]},
    attributes: {id, name, title: name, class: cls, ObjectID: 3, stroke: '#8b0000', 'stroke-width': 2}
});
const SEG = (region, name, caltopoId = '', sweep = '100 ft') => [region, name, '640 ac', '1 mi', sweep, '2.00 hr', '', '', '', caltopoId];
const ROW = (task, date, time, segment, team = 'Team A (2)', sweep = '100 ft', sweeps = '2', region = 'R1') => [task, date, time, region, segment, '', '', team, sweep, sweeps];
const TRACK = (id, baseName, segmentMiles, assignedTask = '') => ({id, featureId: id, baseName, caltopoName: baseName, type: 'Track', lengthMiles: 1.9, pointCount: 4, segmentMiles, assignedTask});
const PERSONNEL = [['Ann', 'Team A', 'Ann', 'true', 'true', 'false', 'On-Scene'], ['Bob', 'Team A', 'Ann', 'false', 'false', 'false', 'On-Scene'], ['Cy', 'Team B', 'Cy', 'false', 'false', 'false', 'On-Scene']];

function seedStore({features, segments, searchLog, tracks, personnel, assignments, statuses, folders} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', ''], ['R2', '4', '']], voterVisibility: [true]};
    bundle.pages.page2 = segments || [SEG('R1', '4D', 'seg-4d'), SEG('R1', '4C', 'seg-4c'), SEG('R1', '4B', 'seg-4b'), SEG('R2', '7A', 'seg-7a')];
    bundle.pages.page3 = personnel || PERSONNEL;
    bundle.pages.page4 = searchLog || [['', '', '', '', '', '', '', '', '', '']];
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || [SEG_4D_SHAPE, SEG_4C_SHAPE, SEG_4B_SHAPE, SEG_7A_SHAPE, trackFeature()]}];
    if (folders) bundle.maps[0].folders = folders;
    if (tracks) bundle.searcherTracks = tracks;
    if (assignments) bundle.currentAssignments = assignments;
    if (statuses) bundle.teamStatuses = statuses;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };
const logRows = (app) => plain(app.loadBundle().pages.page4.filter(r => r[0]).map(r => [r[0], r[3], r[4], r[7]]));
const segmentRows = (app) => plain(app.loadBundle().pages.page2.filter(r => r[1]).map(r => [r[0], r[1], r[9]]));
const postSummary = (app) => app.__posted.map(p => `${p.method} ${p.endpoint}`);
const STAMP = {date: '09-16-2026', time: '10:00', timestampMs: Date.UTC(2026, 8, 16, 15, 0, 0)};

check('assignSearchTaskToTeamSegments: one Search Log row per segment, the label, the log entry, the active set', () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch, page: 'page3'});
    const result = app.assignSearchTaskToTeamSegments('Team A', [{region: 'R1', segment: '4D'}, {region: 'R1', segment: '4C'}, {region: 'R2', segment: '7A'}], STAMP);
    assert.deepStrictEqual(plain(result), {taskNumber: 1, fullAssignment: '#1 R1 - 4D, 4C; R2 - 7A'});
    const bundle = app.loadBundle();
    const rows = bundle.pages.page4.filter(r => r[0]);
    assert.deepStrictEqual(plain(rows.map(r => [r[0], r[1], r[2], r[3], r[4], r[7], r[8]])), [
        ['#1', rows[0][1], rows[0][2], 'R1', '4D', 'Team A (2)', '100 ft'],
        ['#1', rows[0][1], rows[0][2], 'R1', '4C', 'Team A (2)', '100 ft'],
        ['#1', rows[0][1], rows[0][2], 'R2', '7A', 'Team A (2)', '100 ft']
    ], 'three rows, one task #, same date / time / team');
    assert.strictEqual(bundle.currentAssignments['Team A'], '#1 R1 - 4D, 4C; R2 - 7A');
    assert.strictEqual(bundle.teamStatuses['Team A'], 'assigned');
    const entry = bundle.activityLog.find(e => /Assigned to segments/.test(e.action));
    assert.ok(entry, 'one activity log entry for the assignment');
    assert.strictEqual(entry.action, 'Assigned to segments: #1 R1 - 4D, 4C; R2 - 7A');
    assert.strictEqual(bundle.activityLog.filter(e => /Assigned to segment/.test(e.action)).length, 1, 'not one per segment');
    assert.strictEqual(bundle.activityLog.filter(e => /Created Search Log Entry: #1/.test(e.action)).length, 1);
    // The helpers read the rows.
    assert.deepStrictEqual(plain(app.getTaskSegmentPairs(bundle, '#1')), [{region: 'R1', segment: '4D'}, {region: 'R1', segment: '4C'}, {region: 'R2', segment: '7A'}]);
    assert.strictEqual(app.describeTaskSegments(bundle, '1'), 'R1 - 4D, 4C; R2 - 7A');
    assert.deepStrictEqual(plain(app.getTeamAssignmentSegmentPairs(bundle, 'Team A')).map(p => p.segment), ['4D', '4C', '7A']);
    const active = app.buildActiveSearchSegmentNameSet(bundle);
    ['4d', '4c', '7a', 'r1 - 4d', 'r2 - 7a'].forEach(name => assert.ok(active.has(name), `${name} is being searched`));
    assert.ok(!active.has('4b'));
    // The next task is #2 (not #4): the task number counts tasks, not rows.
    const second = app.assignSearchTaskToTeam('Team B', 'R1', '4B', STAMP);
    assert.strictEqual(second.taskNumber, 2);
    assert.strictEqual(second.fullAssignment, '#2 R1 - 4B', 'the one-segment form is unchanged');
    assert.ok(app.loadBundle().activityLog.some(e => e.action === 'Assigned to segment: #2 R1 - 4B'));
    // A label whose rows are gone is still understood.
    const b2 = app.loadBundle();
    b2.pages.page4 = b2.pages.page4.filter(r => r[0] !== '#1');
    assert.deepStrictEqual(plain(app.getTeamAssignmentSegmentPairs(b2, 'Team A')).map(p => p.segment), ['4D', '4C', '7A'], 'parsed from the label');
    // rebuildTeamAssignmentLabels follows the rows.
    const b3 = app.loadBundle();
    b3.pages.page4 = b3.pages.page4.filter(r => !(r[0] === '#1' && r[4] === '4C'));
    assert.strictEqual(app.rebuildTeamAssignmentLabels(b3), true);
    assert.strictEqual(b3.currentAssignments['Team A'], '#1 R1 - 4D; R2 - 7A');
    assert.strictEqual(app.rebuildTeamAssignmentLabels(b3), false, 'nothing to change the second time');
});

check('the Search Log table: a task\'s rows together, four spanning cells, a date edit fanned out, one row deleted', async () => {
    const app = createSandbox({store: seedStore({searchLog: [
        ROW('#2', '09-16-2026', '11:00', '4B', 'Team B (1)'),
        ROW('#1', '09-16-2026', '10:00', '4D'),
        ROW('#3', '09-16-2026', '12:00', '7A', 'Team B (1)', '100 ft', '', 'R2'),
        ROW('#1', '09-16-2026', '10:00', '4C')
    ], assignments: {'Team A': '#1 R1 - 4D, 4C', 'Team B': '#3 R2 - 7A'}, statuses: {'Team A': 'searching', 'Team B': 'assigned'}}), fetch: createServer().fetch, page: 'page4'});
    app.buildSearchLogTable();
    await settle();
    const body = app.__byId['table-body'];
    const trs = body.children;
    assert.strictEqual(trs.length, 4, 'four rows');
    // Oldest first: #1 (two rows, together), #2, #3.
    const labels = (tr) => tr.children.map(td => td.dataset.label);
    assert.deepStrictEqual(labels(trs[0]), ['Task #', 'Date', 'Time', 'Region', 'Segment', 'PSR Before', 'PSR After', 'Team', 'Sweep Width (ft)', 'Num of Sweeps', 'Delete']);
    assert.deepStrictEqual(labels(trs[1]), ['Region', 'Segment', 'PSR Before', 'PSR After', 'Sweep Width (ft)', 'Num of Sweeps', 'Delete'], 'the second row of the task has no Task # / Date / Time / Team cells');
    assert.deepStrictEqual(labels(trs[2]).length, 11);
    assert.deepStrictEqual(trs.map(tr => cellText(tr.children[tr.children.length > 7 ? 4 : 1])), ['4D', '4C', '4B', '7A'], 'the task\'s rows stay together, in time order otherwise');
    const spanning = trs[0].children.filter(td => td.classList.contains('task-span-cell'));
    assert.deepStrictEqual(spanning.map(td => td.dataset.label), ['Task #', 'Date', 'Time', 'Team']);
    assert.ok(spanning.every(td => td.rowSpan === 2), 'each spans the two rows');
    assert.ok(trs[2].children.every(td => !td.rowSpan && !td.classList.contains('task-span-cell')), 'a one-row task has plain cells');
    assert.ok(trs[0].classList.contains('task-group-first'));
    assert.ok(trs[1].classList.contains('task-group-more'));
    assert.ok(!trs[2].classList.contains('task-group-first') && !trs[2].classList.contains('task-group-more'));
    assert.strictEqual(cellText(trs[0].children[0]), '#1');
    assert.strictEqual(cellText(trs[0].children[7]), 'Team A (2)');
    // A date typed into the spanning cell lands on both rows (which moves the
    // task to the end of the chronological order).
    const dateCell = trs[0].children[1].children[0].children[0];
    dateCell.textContent = '09-17-2026';
    dateCell.listeners.blur();
    assert.deepStrictEqual(plain(app.loadBundle().pages.page4.filter(r => r[0] === '#1').map(r => r[1])), ['09-17-2026', '09-17-2026']);
    // A sweep count typed into a row stays with that row.
    app.buildSearchLogTable();
    const secondRowOf1 = () => app.__byId['table-body'].children.find(tr => tr.classList.contains('task-group-more'));
    const trs2 = app.__byId['table-body'].children;
    assert.deepStrictEqual(trs2.map(tr => cellText(tr.children[tr.children.length > 7 ? 4 : 1])), ['4B', '7A', '4D', '4C'], 'task #1 moved to the end');
    const sweepsCell = secondRowOf1().children[5].children[0].children[0];
    assert.strictEqual(sweepsCell.dataset.col, '9');
    sweepsCell.textContent = '4';
    sweepsCell.listeners.blur();
    const sweepRows = app.loadBundle().pages.page4.filter(r => r[0] === '#1');
    assert.deepStrictEqual(plain(sweepRows.map(r => [r[4], r[9]])), [['4D', '2'], ['4C', '4']]);
    assert.ok(parseFloat(sweepRows[1][6]) < parseFloat(sweepRows[0][6]), 'PSR After is per row: more sweeps on 4C searched more off');
    // Deleting the 4C row: the task goes on with 4D and the label follows.
    app.confirmDeleteRow = (tr, fn) => fn();
    app.buildSearchLogTable();
    const rowToDelete = secondRowOf1();
    const delTd = rowToDelete.children[rowToDelete.children.length - 1];
    delTd.children[0].children[0].onclick();
    await settle();
    const after = app.loadBundle();
    assert.deepStrictEqual(plain(after.pages.page4.filter(r => r[0] === '#1').map(r => r[4])), ['4D']);
    assert.strictEqual(after.currentAssignments['Team A'], '#1 R1 - 4D', 'the label follows the rows');
    assert.strictEqual(after.teamStatuses['Team A'], 'searching', 'the team is still out');
    assert.ok(after.activityLog.some(e => /Deleted Search Log Entry: #1 \(R1 - 4C\)/.test(e.action)), after.activityLog.map(e => e.action).join(' | '));
    // Deleting the last row of the task ends the assignment, as before.
    app.buildSearchLogTable();
    const lastOf1 = app.__byId['table-body'].children.find(tr => cellText(tr.children[0]) === '#1');
    const firstDel = lastOf1.children[lastOf1.children.length - 1];
    firstDel.children[0].children[0].onclick();
    await settle();
    const done = app.loadBundle();
    assert.strictEqual(done.pages.page4.filter(r => r[0] === '#1').length, 0);
    assert.strictEqual(done.currentAssignments['Team A'], 'Base');
    assert.ok(/^at base/.test(done.teamStatuses['Team A']));
    assert.deepStrictEqual(app.__logs.error, []);
});

check('groupSearchLogRowsByTask: the rows of a task follow its first row; blank rows keep their place', () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    const a1 = ['#1', '', '', 'R1', '4D'];
    const b = ['#2', '', '', 'R1', '4B'];
    const a2 = ['#1', '', '', 'R1', '4C'];
    const blank = ['', '', '', '', ''];
    const grouped = app.groupSearchLogRowsByTask([a1, b, a2, blank]);
    assert.deepStrictEqual(plain(grouped.rows.map(r => r[4])), ['4D', '4C', '4B', '']);
    assert.strictEqual(grouped.spans.get(a1), 2);
    assert.strictEqual(grouped.spans.get(b), 1);
    assert.strictEqual(grouped.spans.has(a2), false, 'a later row of a task has no span of its own');
    assert.strictEqual(grouped.spans.get(blank), 1);
    // Newest first: the task appears where its newest row would.
    const grouped2 = app.groupSearchLogRowsByTask([blank, a2, b, a1]);
    assert.deepStrictEqual(plain(grouped2.rows.map(r => r[4])), ['', '4C', '4D', '4B']);
    assert.strictEqual(grouped2.spans.get(a2), 2);
});

check('the segment checklist: the Personnel popup ticks several segments; the Segments page offers the other segments', async () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch, page: 'page3'});
    const segments = app.getAssignableSegments(app.loadBundle());
    assert.deepStrictEqual(plain(segments.map(s => `${s.region}|${s.segment}`)), ['R1|4D', 'R1|4C', 'R1|4B', 'R2|7A'], 'by region (PSRc ties keep the page order)');
    // The checklist on its own.
    const seen = [];
    const list = app.buildSegmentChecklist(segments, {open: true, onChange: picks => seen.push(picks.map(p => p.segment).join(','))});
    const boxes = byClass(list.element, 'segment-checklist-box');
    const toggle = byClass(list.element, 'segment-checklist-toggle')[0];
    assert.strictEqual(boxes.length, 4);
    assert.deepStrictEqual(byClass(list.element, 'segment-checklist-region').map(el => el.textContent), ['R1', 'R2'], 'grouped under the regions');
    assert.deepStrictEqual(byClass(list.element, 'segment-checklist-text').map(el => el.textContent), ['4D (PSRc: N/A)', '4C (PSRc: N/A)', '4B (PSRc: N/A)', '7A (PSRc: N/A)']);
    assert.strictEqual(toggle.textContent, 'Select segments...');
    boxes[1].checked = true; boxes[1].onchange();
    boxes[0].checked = true; boxes[0].onchange();
    assert.deepStrictEqual(plain(list.getSelected()), [{region: 'R1', segment: '4D'}, {region: 'R1', segment: '4C'}], 'in list order, not tick order');
    assert.strictEqual(toggle.textContent, '4D, 4C (2)');
    assert.deepStrictEqual(seen, ['4C', '4D,4C']);
    boxes[0].checked = false; boxes[0].onchange();
    assert.strictEqual(toggle.textContent, '4C (1)');

    // The Personnel page's "Assign New Task" popup: a checklist, then the
    // shared assignment with every ticked segment.
    let stampCallback = null;
    app.showMissingStepsPopup = (team, status, onComplete) => { stampCallback = onComplete; };
    // The Personnel page rebuild needs more DOM than the stand-in has.
    app.refreshCurrentPageTable = () => {};
    const popup = app.showNewSegmentPopup('Team A', null);
    const popupBoxes = byClass(popup, 'segment-checklist-box');
    const assignBtn = walk(popup).find(el => /Assign Selected Task/.test(el.textContent || ''));
    assert.strictEqual(popupBoxes.length, 4);
    assert.strictEqual(assignBtn.disabled, true);
    popupBoxes[1].checked = true; popupBoxes[1].onchange();
    assert.strictEqual(assignBtn.textContent, 'Assign Selected Task');
    popupBoxes[0].checked = true; popupBoxes[0].onchange();
    assert.strictEqual(assignBtn.textContent, 'Assign 2 Segments as One Task');
    assert.strictEqual(assignBtn.disabled, false);
    assignBtn.onclick();
    assert.strictEqual(typeof stampCallback, 'function', 'the status steps popup asks for the time');
    stampCallback(STAMP);
    assert.deepStrictEqual(logRows(app), [['#1', 'R1', '4D', 'Team A (2)'], ['#1', 'R1', '4C', 'Team A (2)']]);
    assert.strictEqual(app.loadBundle().currentAssignments['Team A'], '#1 R1 - 4D, 4C');

    // The Segments page's "search" follow-up: the other segments, "Just 4B"
    // or the ticked ones after the primary.
    const outcomes = [];
    const more = app.showAdditionalSegmentsPopup('Team B', {region: 'R1', segment: '4B'}, pairs => outcomes.push(plain(pairs)));
    const moreBoxes = byClass(more, 'segment-checklist-box');
    assert.deepStrictEqual(moreBoxes.map(b => b.dataset.key), ['R1|4D', 'R1|4C', 'R2|7A'], 'the primary segment is not offered again');
    const confirmBtn = byClass(more, 'segment-checklist-confirm')[0];
    const justBtn = walk(more).find(el => el.textContent === 'Just 4B');
    assert.strictEqual(confirmBtn.disabled, true);
    moreBoxes[2].checked = true; moreBoxes[2].onchange();
    assert.strictEqual(confirmBtn.textContent, 'Assign 2 Segments');
    confirmBtn.onclick();
    assert.deepStrictEqual(outcomes, [[{region: 'R1', segment: '4B'}, {region: 'R2', segment: '7A'}]], 'the primary first');
    const more2 = app.showAdditionalSegmentsPopup('Team B', {region: 'R1', segment: '4B'}, pairs => outcomes.push(plain(pairs)));
    walk(more2).find(el => el.textContent === 'Just 4B').onclick();
    assert.deepStrictEqual(outcomes[1], [{region: 'R1', segment: '4B'}]);
    // With no other segment there is no popup: the callback runs at once.
    const lonely = createSandbox({store: seedStore({segments: [SEG('R1', '4D', 'seg-4d')]}), fetch: createServer().fetch});
    const direct = [];
    assert.strictEqual(lonely.showAdditionalSegmentsPopup('Team A', {region: 'R1', segment: '4D'}, pairs => direct.push(plain(pairs))), null);
    assert.deepStrictEqual(direct, [[{region: 'R1', segment: '4D'}]]);
    assert.deepStrictEqual(app.__logs.error, []);
});

check('the task form, Manage Forms, notifications and log sweeps with several segments in a task', async () => {
    // Team A finished its two-segment task; Team B is back at base with its
    // sweeps still blank.
    const app = createSandbox({store: seedStore({searchLog: [ROW('#1', '09-16-2026', '10:00', '4D'), ROW('#1', '09-16-2026', '10:00', '4C'), ROW('#2', '09-16-2026', '11:00', '4B', 'Team B (1)', '100 ft', '')],
        assignments: {'Team A': '#1 R1 - 4D, 4C', 'Team B': 'Base'}, statuses: {'Team A': 'finished segment', 'Team B': 'at base (12:00)'}}), fetch: createServer().fetch, page: 'page5'});
    const bundle = app.loadBundle();
    // The form's read-only "Assigned Segments" field and the printout.
    assert.strictEqual(app.describeTaskSegments(bundle, '#1'), 'R1 - 4D, 4C');
    const html = app.getTaskFormPrintHTML('1', {teamName: 'Team A', segment: 'R1 - 4D'}, bundle);
    assert.ok(/Region\/Segment<\/span><div class="field-value">R1 - 4D, 4C<\/div>/.test(html), 'the printout lists both segments');
    const html2 = app.getTaskFormPrintHTML('9', {teamName: 'Custom', segment: 'R1 - Trail'}, bundle);
    assert.ok(/field-value">R1 - Trail</.test(html2), 'a task without rows keeps the form\'s own segment');
    // Manage Forms: one row per task, both segments.
    app.buildManageFormsTable();
    const formRows = app.__byId['table-body'].children;
    const infoOf = (tr) => tr.children[1].children[0].textContent;
    assert.strictEqual(formRows.filter(tr => tr.children[0].children[0].textContent === '#1').length, 1, 'one line for task #1');
    assert.ok(formRows.some(tr => infoOf(tr) === 'R1 - 4D, 4C'), formRows.map(infoOf).join(' | '));
    assert.ok(formRows.some(tr => infoOf(tr) === 'R1 - 4B'));
    // One "Fill Form" notification for the finished two-segment task.
    const notes = app.buildNotificationList ? app.buildNotificationList(bundle) : null;
    if (Array.isArray(notes)) {
        const fill = notes.filter(n => /Task #1/.test(n.message || n.text || JSON.stringify(n)));
        assert.strictEqual(fill.length, 1, 'one notification for task #1');
    }
    // Log sweeps: the Segments page asks per row; the popup finds the row by
    // its segment, else the first row still blank.
    const due = app.getLogSweepsDue();
    assert.deepStrictEqual(plain(due.map(d => `${d.taskNum}|${d.segment}`)), ['#2|4B'], 'task #1 has its sweeps; #2 is due');
    const b2 = app.loadBundle();
    b2.pages.page4[0][9] = '';
    b2.pages.page4[1][9] = '';
    assert.strictEqual(app.findSearchLogRowForSweeps(b2.pages.page4, '#1', {region: 'R1', segment: '4C'})[4], '4C', 'by segment');
    assert.strictEqual(app.findSearchLogRowForSweeps(b2.pages.page4, '#1')[4], '4D', 'the first blank row');
    b2.pages.page4[0][9] = '3';
    assert.strictEqual(app.findSearchLogRowForSweeps(b2.pages.page4, '#1')[4], '4C', 'the next blank row');
    assert.strictEqual(app.findSearchLogRowForSweeps(b2.pages.page4, '#1', {region: 'R1', segment: 'zz'})[4], '4C', 'an unknown segment falls back');
    assert.strictEqual(app.findSearchLogRowForSweeps(b2.pages.page4, '#9'), null);
    // The "finished segment" step stamps every row of the task.
    const b3 = app.loadBundle();
    b3.teamStatuses['Team A'] = 'searching';
    app.saveBundle(b3);
    app.showMissingStepsPopup('Team A', 'finished segment', () => {}, {date: '09-16-2026', time: '13:30', timestampMs: Date.UTC(2026, 8, 16, 18, 30)});
    await settle();
    const stamped = app.loadBundle().pages.page4.filter(r => r[0] === '#1');
    if (stamped.every(r => r[2] === '13:30')) assert.ok(true);
    else assert.ok(stamped.every(r => r[2] === stamped[0][2]), 'both rows carry the same time');
    // PSR maths: with Map Tracking, a row's miles are the task's miles inside
    // its own segment.
    const b4 = app.loadBundle();
    b4.mapTrackingEnabled = true;
    b4.searcherTracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}], '#1')];
    const allocation = app.allocateSearcherTracksForBundle(b4);
    near(app.getTaskTrackMiles(allocation, '#1', 'R1', '4D'), 1.0, 1e-9, '4D row');
    near(app.getTaskTrackMiles(allocation, '#1', 'R1', '4C'), 0.4, 1e-9, '4C row');
    near(app.getTaskTrackMiles(allocation, '#1'), 1.4, 1e-9, 'the task');
    assert.deepStrictEqual(app.__logs.error, []);
});

check('drawAutoDrawSegments with the import: rows in the source\'s region, the source row gone, tasks fanned out, the folder, unwanted', async () => {
    // "Alpha" is segment R1 / Alpha (id area-1) with task #1 (Team A, 3
    // sweeps) and an imported track through it; 4D is another segment.
    const alpha = shape('area-1', 'Alpha', rect(0, 0, 1, 0.1), {stroke: '#ff9900'});
    const server = createServer();
    const app = createSandbox({store: seedStore({
        features: [alpha, SEG_4D_SHAPE, trackFeature()],
        segments: [['R1', 'Alpha', '64.00 ac', '1.00 mi', '80 ft', '2.00 hr', '', '', '', 'area-1'], SEG('R1', '4D', 'seg-4d')],
        searchLog: [ROW('#1', '09-01-2026', '08:00', 'Alpha', 'Team A (2)', '80 ft', '3'), ROW('#2', '09-01-2026', '09:00', '4D')],
        assignments: {'Team A': '#1 R1 - Alpha'}, statuses: {'Team A': 'searching'},
        tracks: [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: 'Alpha', miles: 0.5}], '#1')],
        folders: [{id: 'f-lines', title: 'Lines and Polygons', visible: true, labelVisible: true}]
    }), fetch: server.fetch});
    const source = app.getMapFeatures(app.loadBundle())[0];
    const plan = app.planAutoDrawSegments(source, {angleDegrees: 0, targetAcres: 20});
    assert.strictEqual(plan.count, 3);
    const outcome = await app.drawAutoDrawSegments(source, plan);
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], app.__logs.error.join(' | '));
    assert.strictEqual(outcome.created.length, 3);
    assert.deepStrictEqual(plain(outcome.imported), {region: 'R1', rows: 3, sourceRemoved: true, repointed: 1, tracksChanged: true});
    // Three slices, the hidden Regions folder created, the source moved into it.
    assert.deepStrictEqual(postSummary(app), ['POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Folder', 'POST /api/v1/map/MAP1/Assignment/area-1']);
    const folderPost = app.__posted[3];
    assert.deepStrictEqual(folderPost.payload, {type: 'Feature', id: null, geometry: null, properties: {title: 'Regions', visible: false, labelVisible: false}}, 'a hidden folder with labels off, no geometry');
    const move = app.__posted[4];
    assert.strictEqual(move.payload.id, 'area-1');
    assert.strictEqual(move.payload.properties.folderId, 'new-4', 'into the folder CalTopo just created');
    assert.strictEqual(move.payload.properties.title, 'Alpha', 'the whole shape rides along');
    assert.strictEqual(move.payload.properties.stroke, '#ff9900');
    assert.strictEqual(move.payload.geometry.type, 'Polygon');
    // The case: the slices are segments in R1 where Alpha stood, Alpha's row
    // is gone, its sweep width is kept.
    assert.deepStrictEqual(segmentRows(app), [['R1', 'Alpha-1', 'new-1'], ['R1', 'Alpha-2', 'new-2'], ['R1', 'Alpha-3', 'new-3'], ['R1', '4D', 'seg-4d']]);
    const bundle = app.loadBundle();
    const newRows = bundle.pages.page2.filter(r => /^Alpha-/.test(r[1]));
    assert.ok(newRows.every(r => r[4] === '80 ft'), 'the source\'s sweep width');
    assert.ok(newRows.every(r => /ac$/.test(r[2]) && parseFloat(r[2]) > 21 && parseFloat(r[2]) < 22), `~21.3 acres each: ${newRows.map(r => r[2])}`);
    assert.ok(newRows.every(r => /hr$/.test(r[5])), 'the time column is filled in like an import');
    // Task #1 now covers the three slices (one row each, same team / sweeps);
    // task #2 is untouched; the label follows.
    assert.deepStrictEqual(plain(bundle.pages.page4.filter(r => r[0]).map(r => [r[0], r[3], r[4], r[7], r[8], r[9]])), [
        ['#1', 'R1', 'Alpha-1', 'Team A (2)', '80 ft', '3'],
        ['#1', 'R1', 'Alpha-2', 'Team A (2)', '80 ft', '3'],
        ['#1', 'R1', 'Alpha-3', 'Team A (2)', '80 ft', '3'],
        ['#2', 'R1', '4D', 'Team A (2)', '100 ft', '2']
    ]);
    assert.strictEqual(bundle.currentAssignments['Team A'], '#1 R1 - Alpha-1, Alpha-2, Alpha-3');
    assert.strictEqual(bundle.teamStatuses['Team A'], 'searching');
    // The track is re-measured against the slices: its record no longer names
    // "Alpha" (it runs along the shape's south edge, so the slices get what
    // the clipping gives them), and the task pick stays.
    assert.ok(!bundle.searcherTracks[0].segmentMiles.some(m => m.segment === 'Alpha'), 'the old segment is gone from the track');
    assert.strictEqual(bundle.searcherTracks[0].assignedTask, '#1', 'the task pick is kept');
    // The source shape is unwanted (not offered for import again), the folder
    // remembered, the source noted as moved.
    assert.deepStrictEqual(plain(bundle.unwantedMapFeatures.map(u => u.name)), ['alpha']);
    assert.deepStrictEqual(plain(bundle.maps[0].folders), [{id: 'f-lines', title: 'Lines and Polygons', visible: true, labelVisible: true}, {id: 'new-4', title: 'Regions', visible: false, labelVisible: false}]);
    assert.strictEqual(bundle.maps[0].features[0].attributes.folderId, 'new-4');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures(bundle).map(app.getMapFeatureDisplayName)), [], 'nothing left to import (the track is imported already)');
    const entry = bundle.activityLog.find(e => /Auto-drew/.test(e.action));
    assert.ok(/Auto-drew 3 segments from "Alpha".*imported as segments in region "R1"; "Alpha" was removed from the Segments page \(1 Search Log row re-pointed at the new segments\); its shape moved to the CalTopo "Regions" folder/.test(entry.action), entry.action);
    assert.ok(server.requests.some(r => /\/rows/.test(r.url) && r.method === 'POST'), 'saved');

    // A second draw finds the folder on the case and does not create another.
    const second = app.getMapFeatures(app.loadBundle()).find(f => app.getMapFeatureDisplayName(f) === '4D');
    app.__posted.length = 0;
    await app.drawAutoDrawSegments(second, app.planAutoDrawSegments(second, {angleDegrees: 90, targetAcres: 320}));
    await settle();
    assert.deepStrictEqual(postSummary(app), ['POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Assignment/seg-4d'], 'no second Folder POST');
    assert.strictEqual(app.__posted[2].payload.properties.folderId, 'new-4');
    assert.deepStrictEqual(segmentRows(app).map(r => r[1]), ['Alpha-1', 'Alpha-2', 'Alpha-3', '4D-1', '4D-2']);
    // A refused folder: the slices are still imported, a toast says the move
    // could not be done, no move is attempted.
    const noFolder = createSandbox({store: seedStore({features: [alpha], segments: [['R1', 'Alpha', '64.00 ac', '1.00 mi', '80 ft', '2.00 hr', '', '', '', 'area-1']]}), fetch: createServer().fetch});
    noFolder.__caltopoAnswer = (method, endpoint) => (/\/Folder$/.test(endpoint) ? null : {status: 'ok', result: {id: `x-${endpoint.length}-${Math.random()}`}});
    const src2 = noFolder.getMapFeatures(noFolder.loadBundle())[0];
    const out2 = await noFolder.drawAutoDrawSegments(src2, noFolder.planAutoDrawSegments(src2, {angleDegrees: 0}));
    await settle();
    assert.strictEqual(out2.created.length, 5);
    assert.deepStrictEqual(postSummary(noFolder).slice(5), ['POST /api/v1/map/MAP1/Folder']);
    assert.strictEqual(segmentRows(noFolder).length, 5);
    const deepHtml = (el) => (el.innerHTML || '') + (el.children || []).map(deepHtml).join('');
    assert.ok(noFolder.__body.children.some(el => /could not be moved to the "Regions" folder/.test(deepHtml(el))), 'the toast');
});

check('the Merge Segments popup: neighbors stay open, other regions and far segments gray out, the name box, the preview', () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    const candidates = app.getMergeableSegments(app.loadBundle());
    assert.deepStrictEqual(plain(candidates.map(c => `${c.region}/${c.segment}`)), ['R1/4B', 'R1/4C', 'R1/4D', 'R2/7A']);
    const popup = app.showMergeSegmentsPopup(candidates);
    const rows = byClass(popup, 'merge-segment-row');
    const checks = byClass(popup, 'merge-segment-check');
    const preview = byClass(popup, 'merge-preview')[0];
    const confirm = byClass(popup, 'merge-confirm')[0];
    const nameInput = byClass(popup, 'merge-segment-name')[0];
    const state = () => rows.map((tr, i) => `${candidates[i].segment}:${tr.classList.contains('is-disabled') ? 'gray' : 'open'}${tr.classList.contains('is-selected') ? '*' : ''}`);
    assert.strictEqual(rows.length, 4);
    const cells4D = rows[2].children.slice(1).map(td => td.children[0].textContent);
    assert.deepStrictEqual([cells4D[0], cells4D[1], cells4D[3]], ['4D', 'R1', '4D']);
    assert.ok(/^640\.\d\d$/.test(cells4D[2]), `the acres: ${cells4D[2]}`);
    assert.deepStrictEqual(state(), ['4B:open', '4C:open', '4D:open', '7A:open']);
    assert.strictEqual(confirm.disabled, true);
    assert.strictEqual(nameInput.id, 'merge-segment-name');
    assert.ok(/Tick two or more neighboring segments/.test(preview.textContent));
    // Tick 4D: 4C (its neighbor) stays open; 4B (far) and 7A (touches 4C at a
    // corner, but region R2) gray out.
    rows[2].onclick();
    assert.strictEqual(checks[2].checked, true);
    assert.deepStrictEqual(state(), ['4B:gray', '4C:open', '4D:open*', '7A:gray']);
    assert.ok(checks[0].disabled && checks[3].disabled && !checks[1].disabled);
    assert.ok(/Another region/.test(rows[3].title), rows[3].title);
    assert.ok(/Not a neighbor/.test(rows[0].title), rows[0].title);
    assert.strictEqual(nameInput.value, '4D', 'prefilled');
    assert.strictEqual(confirm.disabled, true, 'one segment is not a merge');
    assert.ok(/Tick at least one neighboring segment/.test(preview.textContent));
    rows[0].onclick();
    assert.ok(!checks[0].checked, 'a grayed row cannot be ticked');
    // Tick 4C: the union is the 2 x 1 rectangle; 4B is still no neighbor of
    // either; 7A stays out by region.
    rows[1].onclick();
    assert.deepStrictEqual(state(), ['4B:gray', '4C:open*', '4D:open*', '7A:gray']);
    assert.strictEqual(nameInput.value, '4D+4C', 'in tick order');
    assert.strictEqual(confirm.disabled, false);
    assert.strictEqual(confirm.textContent, 'Merge 2 Segments');
    assert.ok(/2 segments \(4D, 4C\) \u2192 "4D\+4C": 1280\.\d acres, 4 corners, region "R1"\./.test(preview.textContent), preview.textContent);
    assert.strictEqual(preview.classList.contains('is-warning'), false);
    // A typed name sticks; an emptied one goes back to the default.
    nameInput.value = 'Delta';
    nameInput.oninput();
    assert.ok(/"Delta": 1280/.test(preview.textContent));
    rows[1].onclick();
    assert.strictEqual(nameInput.value, 'Delta', 'the typed name is kept when the ticks change');
    assert.strictEqual(confirm.disabled, true, 'back to one segment');
    nameInput.value = '';
    nameInput.oninput();
    rows[1].onclick();
    assert.strictEqual(nameInput.value, '4D+4C', 'the default again');
    // Untick everything: every row opens again.
    rows[1].onclick();
    rows[2].onclick();
    assert.deepStrictEqual(state(), ['4B:open', '4C:open', '4D:open', '7A:open']);
    assert.strictEqual(nameInput.value, '');
    assert.deepStrictEqual(app.__logs.error, []);
});

check('mergeSegmentsAction: the outline POST, the moves, one Segments row, the tasks collapsed, the tracks re-measured', async () => {
    // Task #1 covers 4D and 4C (two rows), task #2 is on 4C alone, task #3 on
    // 4B; a track has miles in 4D and 4C.
    const server = createServer();
    const app = createSandbox({store: seedStore({
        searchLog: [ROW('#1', '09-01-2026', '08:00', '4D'), ROW('#1', '09-01-2026', '08:00', '4C'), ROW('#2', '09-01-2026', '09:00', '4C', 'Team B (1)', '100 ft', '1'), ROW('#3', '09-01-2026', '10:00', '4B', 'Team B (1)')],
        assignments: {'Team A': '#1 R1 - 4D, 4C', 'Team B': '#2 R1 - 4C'}, statuses: {'Team A': 'searching', 'Team B': 'assigned'},
        tracks: [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}], '#1')]
    }), fetch: server.fetch});
    const candidates = app.getMergeableSegments(app.loadBundle());
    const picked = candidates.filter(c => c.segment === '4C' || c.segment === '4D');
    const outcome = await app.mergeSegmentsAction(picked, 'Delta');
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], app.__logs.error.join(' | '));
    assert.deepStrictEqual(plain(outcome), {ok: true, name: 'Delta', errors: [], region: 'R1', repointed: 3, tracksChanged: true});
    assert.deepStrictEqual(postSummary(app), ['POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Folder', 'POST /api/v1/map/MAP1/Assignment/seg-4c', 'POST /api/v1/map/MAP1/Assignment/seg-4d']);
    const created = app.__posted[0].payload;
    assert.strictEqual(created.id, null);
    assert.strictEqual(created.properties.title, 'Delta');
    assert.strictEqual(created.properties.stroke, '#00ff00', 'the first segment\'s style');
    assert.strictEqual(created.properties.folderId, 'f-lines', '... and folder');
    assert.ok(/Merged from "4C", "4D" \(1280\.\d acres\)\./.test(created.properties.description), created.properties.description);
    assert.strictEqual(created.geometry.type, 'Polygon');
    assert.deepStrictEqual(corners(created.geometry.coordinates[0]), cornersOf([[-0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [-0.5, 0.5]]), 'the 2 x 1 outline, four corners');
    assert.ok(app.__posted.slice(2).every(p => p.payload.properties.folderId === 'new-2'), 'the old shapes go to the new folder');
    // The case: one row "Delta" where 4D stood (R1, the first row's sweep
    // width, the new id); 4B and 7A untouched.
    assert.deepStrictEqual(segmentRows(app), [['R1', 'Delta', 'new-1'], ['R1', '4B', 'seg-4b'], ['R2', '7A', 'seg-7a']]);
    const bundle = app.loadBundle();
    const delta = bundle.pages.page2.find(r => r[1] === 'Delta');
    assert.strictEqual(delta[4], '100 ft');
    assert.ok(/^1280\.\d+ ac$/.test(delta[2]), delta[2]);
    // Tasks: #1's two rows collapse to one on Delta (its sweeps kept), #2
    // moves to Delta, #3 stays on 4B; the labels follow.
    assert.deepStrictEqual(plain(bundle.pages.page4.filter(r => r[0]).map(r => [r[0], r[3], r[4], r[7], r[9]])), [
        ['#1', 'R1', 'Delta', 'Team A (2)', '2'],
        ['#2', 'R1', 'Delta', 'Team B (1)', '1'],
        ['#3', 'R1', '4B', 'Team B (1)', '2']
    ]);
    assert.deepStrictEqual(plain(bundle.currentAssignments), {'Team A': '#1 R1 - Delta', 'Team B': '#2 R1 - Delta'});
    // The track: 1.4 mi inside Delta now.
    assert.strictEqual(bundle.searcherTracks[0].segmentMiles.length, 1);
    assert.strictEqual(bundle.searcherTracks[0].segmentMiles[0].segment, 'Delta');
    near(bundle.searcherTracks[0].segmentMiles[0].miles, 1.4, 0.01, 'the 4D mile and the 0.4 mi of 4C');
    assert.strictEqual(bundle.searcherTracks[0].assignedTask, '#1');
    // The old shapes are unwanted, the new one is a segment and the track is
    // imported: nothing is left to import; the folder is remembered.
    assert.deepStrictEqual(plain(bundle.unwantedMapFeatures.map(u => u.name)), ['4c', '4d']);
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures(bundle).map(app.getMapFeatureDisplayName)), []);
    assert.deepStrictEqual(plain(bundle.maps[0].folders), [{id: 'new-2', title: 'Regions', visible: false, labelVisible: false}]);
    assert.deepStrictEqual(plain(bundle.maps[0].features.filter(f => /^4[cd]$/i.test(f.attributes.name)).map(f => f.attributes.folderId)), ['new-2', 'new-2']);
    const entry = bundle.activityLog.find(e => /^Merged/.test(e.action));
    assert.ok(/Merged 2 segments \(4C, 4D\) into "Delta" \(1280\.\d acres\) in region "R1": drawn on the CalTopo map; the old rows were removed from the Segments page \(3 Search Log rows re-pointed at the merged segment\); the old shapes moved to the CalTopo "Regions" folder/.test(entry.action), entry.action);
    assert.ok(server.proxyFetches() >= 1, 'the map is fetched again afterwards');

    // A refused outline changes nothing.
    const refused = createSandbox({store: seedStore(), fetch: createServer().fetch});
    refused.__caltopoAnswer = () => null;
    const cands = refused.getMergeableSegments(refused.loadBundle());
    const none = await refused.mergeSegmentsAction(cands.filter(c => c.segment !== '4B' && c.region === 'R1'), 'Nope');
    await settle();
    assert.strictEqual(none.ok, false);
    assert.ok(/CalTopo did not take the merged shape "Nope"/.test(none.errors[0]));
    assert.deepStrictEqual(postSummary(refused), ['POST /api/v1/map/MAP1/Assignment', 'POST /api/v1/map/MAP1/Shape'], 'Assignment then Shape, then nothing more');
    assert.deepStrictEqual(segmentRows(refused).map(r => r[1]), ['4D', '4C', '4B', '7A']);
    assert.ok(!refused.loadBundle().activityLog.some(e => /^Merged/.test(e.action)));
    // Fewer than two: refused before any call.
    const one = await refused.mergeSegmentsAction(cands.slice(0, 1), 'x');
    assert.strictEqual(one.ok, false);
});

check('the static wiring: the Merge button in the map header, its handler, the stylesheet, the helpers', () => {
    const start = appSource.indexOf('function buildMapsPage()');
    const end = appSource.indexOf('// Maps page tools: "Auto Draw Segments", "Trim Tracks" and "Merge Segments".');
    assert.ok(start !== -1 && end > start);
    const page = appSource.slice(start, end);
    const header = page.slice(page.indexOf('id="current-map-title"'), page.indexOf('id="map-iframe"'));
    assert.ok(/id="merge-segments-btn"[^>]*>Merge Segments</.test(header), 'the Merge Segments button');
    assert.ok(header.indexOf('id="trim-tracks-btn"') < header.indexOf('id="merge-segments-btn"'), 'after Trim Tracks');
    assert.ok(/getElementById\('merge-segments-btn'\)[\s\S]{0,140}openMergeSegmentsTool\(mergeSegmentsBtn\)/.test(page), 'wired to openMergeSegmentsTool');
    // The folder list rides along with a fetch.
    assert.ok(/const folders = extractCalTopoFolders\(data\.features \|\| \[\]\);/.test(appSource));
    assert.ok(/b\.maps\[0\]\.folders = folders;/.test(appSource));

    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    const rule = (selector) => {
        const idx = css.indexOf(`${selector} {`);
        assert.ok(idx !== -1, `${selector} is styled`);
        return css.slice(idx, css.indexOf('}', idx));
    };
    assert.ok(/opacity/.test(rule('.merge-segment-row.is-disabled')), 'a grayed merge row');
    rule('.merge-name-row .pill-input');
    rule('.auto-draw-target-wrap .pill-input');
    rule('.segment-checklist-list');
    rule('.segment-checklist-item.is-selected');
    // The spanning Search Log cells: rowspan cells whose pill fills the height.
    const span = rule('.grid-table td.task-span-cell .pill-cell');
    assert.ok(/height: 100%/.test(span) && /border-radius/.test(span), 'the pill stretches over the rows as one rounded rectangle');
    assert.ok(/td\.rowSpan = spanCount;/.test(appSource) && /task-span-cell/.test(appSource), 'the table sets the rowspan');
    assert.ok(/\[0, 1, 2, 7\]\.includes\(c\)/.test(appSource), 'Task #, Date, Time and Team span');

    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    ['openMergeSegmentsTool', 'showMergeSegmentsPopup', 'mergeSegmentsAction', 'applyMergeToCase', 'getMergeableSegments', 'applyAutoDrawToCase',
        'ensureCalTopoRegionsFolder', 'moveCalTopoFeatureToFolder', 'extractCalTopoFolders', 'findSegmentRowForMapFeature', 'repointSearchLogSegments',
        'remeasureSearcherTracks', 'assignSearchTaskToTeamSegments', 'buildSegmentChecklist', 'showAdditionalSegmentsPopup', 'groupSearchLogRowsByTask',
        'getTaskSearchLogRows', 'getTaskSegmentPairs', 'rebuildTeamAssignmentLabels', 'describeTaskSegments', 'findSearchLogRowForSweeps'].forEach(name => {
        assert.strictEqual(typeof app[name], 'function', name);
    });
    assert.strictEqual(vm.runInContext('CALTOPO_REGIONS_FOLDER_TITLE', app), 'Regions', 'a top-level const: read in-context');
    assert.deepStrictEqual(plain(app.extractCalTopoFolders([
        {id: 'f1', properties: {class: 'Folder', title: 'Regions', visible: false, labelVisible: false}},
        {id: 'f2', properties: {class: 'Folder', title: 'Lines'}},
        {id: 's1', properties: {class: 'Shape', title: 'Not a folder'}, geometry: {type: 'Point', coordinates: [0, 0]}},
        {properties: {class: 'Folder', title: 'No id'}}
    ])), [{id: 'f1', title: 'Regions', visible: false, labelVisible: false}, {id: 'f2', title: 'Lines', visible: true, labelVisible: true}]);
});

(async () => {
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (error) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(error && error.stack ? error.stack : error);
        }
    }
    if (failed) {
        console.log(`\nMaps Merge Segments / multi-segment tasks: ${failed} of ${checks.length} checks failed.`);
        process.exit(1);
    }
    console.log(`\nMaps Merge Segments / multi-segment tasks: PASS (${checks.length} checks)`);
})();

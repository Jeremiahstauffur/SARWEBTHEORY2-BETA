// Tests for the rate-limited CalTopo color sync: the PSRc segment-color push
// (updateCalTopoAssignmentOverlay) is never sent more often than the cooldown
// ("maximum refresh", seconds) and is re-asserted at least once per heartbeat
// ("minimum refresh", minutes), with both limits editable on the Settings page.
//
// app.js is loaded into a vm sandbox with a CONTROLLABLE CLOCK: Date.now(),
// setTimeout and setInterval are driven by advance(ms), so "wait ten seconds"
// costs nothing and every scheduled push runs exactly when it is due.
//
// Run with: node test_caltopo_color_sync_schedule.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const OVERLAY_KEY = 'sar-caltopo-assignment-overlay-v1';
const LAST_PUSH_KEY = 'sar-caltopo-color-sync-last-v1';
const CASE = 'Case-1';
const BUCKET = `${CASE}_tester`;
const API = `/api/v1/${BUCKET}`;

// --- Sandbox ----------------------------------------------------------------

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

// A manual clock: timers are kept in a queue and only run when advance() moves
// the clock past their due time. Between timers the microtask queue is drained
// so an async push (await caltopo_api_call, saveBundle) settles before the
// next timer fires - the same order a browser would produce.
function createClock(startAt) {
    const clock = {now: startAt, timers: [], nextId: 1};
    clock.setTimeout = (fn, ms) => {
        const id = clock.nextId++;
        clock.timers.push({id, at: clock.now + Math.max(0, Number(ms) || 0), fn, interval: null});
        return id;
    };
    clock.setInterval = (fn, ms) => {
        const id = clock.nextId++;
        const every = Math.max(1, Number(ms) || 0);
        clock.timers.push({id, at: clock.now + every, fn, interval: every});
        return id;
    };
    clock.clear = (id) => { clock.timers = clock.timers.filter(t => t.id !== id); };
    clock.settle = async () => {
        for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    };
    clock.advance = async (ms) => {
        const target = clock.now + ms;
        await clock.settle();
        for (;;) {
            const due = clock.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            clock.now = Math.max(clock.now, due.at);
            if (due.interval) due.at += due.interval;
            else clock.clear(due.id);
            try { due.fn(); } catch (e) { /* a throwing timer never stops the clock */ }
            await clock.settle();
        }
        clock.now = target;
        await clock.settle();
    };
    return clock;
}

// A scripted server: `handler(request)` returns {status, body}. Every request
// is recorded so the tests can see what the page saved (/rows) and what it read.
function createServer(handler) {
    const requests = [];
    const fetch = async (url, init = {}) => {
        const parsed = new URL(String(url));
        const rawBody = typeof init.body === 'string' ? init.body : '';
        let json = null;
        try { json = rawBody ? JSON.parse(rawBody) : null; } catch (e) { /* not JSON */ }
        const request = {url: String(url), path: parsed.pathname, method: String(init.method || 'GET').toUpperCase(), json};
        requests.push(request);
        const reply = handler(request);
        if (reply instanceof Error) throw reply;
        const status = reply && reply.status ? reply.status : 200;
        const body = reply && reply.body !== undefined ? reply.body : {success: true};
        return {ok: status >= 200 && status < 300, status, json: async () => body};
    };
    return {requests, fetch, rows: () => requests.filter(r => r.path === `${API}/rows` && r.method === 'POST')};
}

// The per-login server settings a page reads on load: the active CASE # and
// the "PSRc Assignment Colors" toggle (on unless a test switches it off).
function serverSettings(extra = {}) {
    return Object.assign({'sar-sync-bucket-v1': CASE, [OVERLAY_KEY]: 'true'}, extra);
}

function createSandbox({store, fetch, page = 'page4', sessionData = {}, startAt = Date.UTC(2026, 8, 9, 12, 0, 0)} = {}) {
    const clock = createClock(startAt);
    const localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
    };
    const cookieJar = {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = page;
    const listeners = {};
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
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {}
    };
    // Date inside the sandbox follows the manual clock.
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(clock.now);
            else super(...args);
        }
        static now() { return clock.now; }
    }
    const logs = {warn: [], error: []};
    const sandbox = {
        console: {
            log() {},
            info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        Date: FakeDate,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clear,
        setInterval: clock.setInterval,
        clearInterval: clock.clear,
        localStorage,
        sessionStorage,
        SAR_MEMORY_STORAGE: store,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: (url, init) => fetch(url, init),
        alert: (msg) => { logs.error.push(`alert: ${msg}`); },
        confirm: () => true,
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: `http://localhost/${page}.html`, search: '', reload() {}}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__clock = clock;
    sandbox.__byId = byId;
    sandbox.__session = sessionData;
    sandbox.__listeners = listeners;
    sandbox.__logs = logs;
    sandbox.__document = document;
    return sandbox;
}

// A search file with two segments that are CalTopo assignments, one roster
// team (Alpha) and a fetched CalTopo map with both assignment shapes.
function seedStore(scratchOptions = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify(serverSettings());
    const scratch = createSandbox({store, fetch: () => Promise.reject(new Error('Failed to fetch'))});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
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
                attributes: {id: 'cal-a', name: 'Seg A', class: 'Assignment', 'stroke-width': 4},
                geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]}
            },
            {
                attributes: {id: 'cal-b', name: 'Seg B', class: 'Assignment'},
                geometry: {type: 'Polygon', coordinates: [[[2, 2], [2, 3], [3, 3], [2, 2]]]}
            }
        ]
    }];
    if (typeof scratchOptions.mutate === 'function') scratchOptions.mutate(bundle);
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}

// A page over `store` whose server answers every call, with the CalTopo API
// stubbed so each POST is recorded (and the clock time it was made).
async function bootPage(options = {}) {
    const {store = seedStore(), settings = serverSettings(), page, sessionData, startAt} = options;
    const server = createServer((req) => {
        if (req.path === '/api/auth/settings') return {status: 200, body: settings};
        if (req.path === '/api/auth/history') return {status: 200, body: []};
        if (req.path === `${API}/state`) return {status: 200, body: {cursor: 1, sections: {}}};
        return {status: 200, body: {success: true, applied: 1}};
    });
    const app = createSandbox({store, fetch: server.fetch, page, sessionData, startAt});
    const posted = [];
    app.caltopo_api_call = async (method, endpoint, payload) => {
        posted.push({at: app.__clock.now, method, endpoint, payload: JSON.parse(JSON.stringify(payload))});
        return {result: {id: payload.id}};
    };
    // PSRc first (the overlay is still off: nothing is scheduled), then the
    // login's settings, which switch the overlay on.
    app.recalculateEverything();
    await app.loadServerSettings();
    await app.__clock.settle();
    return {app, server, posted, clock: app.__clock};
}

// The recorded /rows saves that touched the heavy `maps` section.
const mapsSaves = (server) => server.rows().filter(r => Array.isArray(r.json && r.json.changes) && r.json.changes.some(c => Array.isArray(c.path) && c.path[0] === 'maps'));
const lastPushAt = (app) => parseInt(app.__session[LAST_PUSH_KEY] || '0', 10);
const overlayUpdatedAt = (app) => ((app.loadBundle().maps[0] || {}).caltopoAssignmentOverlayState || {}).updatedAt;

// Values created inside the sandbox have the sandbox's prototypes;
// deepStrictEqual needs them re-created in this realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- Test runner --------------------------------------------------------------

const checks = [];
const check = (name, fn) => checks.push({name, fn});

// --- Settings normalisation ----------------------------------------------------

check('the two intervals default to 10 s / 1 min and are normalised by one shared helper', async () => {
    const {app} = await bootPage();
    const defaults = plain(app.getCalTopoColorSyncSettings({}));
    assert.deepStrictEqual(defaults, {heartbeatMinutes: 1, cooldownSeconds: 10, heartbeatMs: 60000, cooldownMs: 10000});
    assert.deepStrictEqual(plain(app.getCalTopoColorSyncSettings(null)), defaults, 'no bundle at all -> defaults');
    assert.deepStrictEqual(plain(app.getCalTopoColorSyncSettings(app.defaultBundle())), defaults, 'a new search file carries the defaults');

    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: 'abc'}).cooldownSeconds, 10, 'garbage -> default');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: 0}).cooldownSeconds, 10, '0 -> default');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: -5}).cooldownSeconds, 10, 'negative -> default');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: '30'}).cooldownSeconds, 30, 'a numeric string is accepted');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: 2.6}).cooldownSeconds, 3, 'rounded to a whole second');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncHeartbeatMinutes: 0}).heartbeatMinutes, 1, 'heartbeat 0 -> default');
    assert.strictEqual(app.getCalTopoColorSyncSettings({caltopoColorSyncHeartbeatMinutes: 5}).heartbeatMs, 300000);

    // The cooldown can never be longer than the heartbeat.
    const clamped = app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: 90, caltopoColorSyncHeartbeatMinutes: 1});
    assert.strictEqual(clamped.cooldownSeconds, 60, 'cooldown clamped to heartbeat * 60');
    assert.strictEqual(clamped.cooldownMs, 60000);
    const roomy = app.getCalTopoColorSyncSettings({caltopoColorSyncCooldownSeconds: 90, caltopoColorSyncHeartbeatMinutes: 2});
    assert.strictEqual(roomy.cooldownSeconds, 90, 'no clamp when the heartbeat is long enough');

    assert.strictEqual(app.normalizeCalTopoColorSyncInterval('', 7), 7);
    assert.strictEqual(app.normalizeCalTopoColorSyncInterval(undefined, 7), 7);
    assert.strictEqual(app.normalizeCalTopoColorSyncInterval('12', 7), 12);
});

check('sanitizeBundle keeps both keys (normalised) and a stale cooldown above the heartbeat is clamped on load', async () => {
    const {app} = await bootPage();
    const bundle = app.loadBundle();
    assert.strictEqual(bundle.caltopoColorSyncHeartbeatMinutes, 1, 'seeded file: default heartbeat');
    assert.strictEqual(bundle.caltopoColorSyncCooldownSeconds, 10, 'seeded file: default cooldown');

    bundle.caltopoColorSyncHeartbeatMinutes = 5;
    bundle.caltopoColorSyncCooldownSeconds = 30;
    const round = app.sanitizeBundle(JSON.parse(JSON.stringify(bundle)));
    assert.strictEqual(round.caltopoColorSyncHeartbeatMinutes, 5, 'heartbeat survives a sanitize round-trip');
    assert.strictEqual(round.caltopoColorSyncCooldownSeconds, 30, 'cooldown survives a sanitize round-trip');

    const stale = app.sanitizeBundle(Object.assign(JSON.parse(JSON.stringify(bundle)), {caltopoColorSyncHeartbeatMinutes: 1, caltopoColorSyncCooldownSeconds: 120}));
    assert.strictEqual(stale.caltopoColorSyncCooldownSeconds, 60, 'a cooldown longer than the heartbeat is clamped by the sanitizer, not only the UI');

    const garbage = app.sanitizeBundle(Object.assign(JSON.parse(JSON.stringify(bundle)), {caltopoColorSyncHeartbeatMinutes: 'x', caltopoColorSyncCooldownSeconds: null}));
    assert.strictEqual(garbage.caltopoColorSyncHeartbeatMinutes, 1);
    assert.strictEqual(garbage.caltopoColorSyncCooldownSeconds, 10);

    // Both are login preferences: they travel with the login, like parCheckFrequency.
    // (LOGIN_PREFERENCE_KEYS is a const, so it is pinned in the source.)
    const keysBlock = appSource.match(/const LOGIN_PREFERENCE_KEYS = \[([\s\S]*?)\];/);
    assert.ok(keysBlock, 'LOGIN_PREFERENCE_KEYS is declared');
    assert.ok(/'caltopoColorSyncHeartbeatMinutes'/.test(keysBlock[1]), 'the heartbeat is a login preference');
    assert.ok(/'caltopoColorSyncCooldownSeconds'/.test(keysBlock[1]), 'the cooldown is a login preference');
});

check('sync-delta.js mirrors both keys to the settings_page table', () => {
    const delta = require('./sync-delta');
    assert.strictEqual(delta.SINGLE_TABLE_KEYS.caltopoColorSyncHeartbeatMinutes, 'settings_page');
    assert.strictEqual(delta.SINGLE_TABLE_KEYS.caltopoColorSyncCooldownSeconds, 'settings_page');
});

// --- Scheduler ----------------------------------------------------------------

check('a burst of refresh requests becomes ONE push (one POST per assignment shape) and records the push time', async () => {
    const {app, server, posted, clock} = await bootPage();
    assert.strictEqual(posted.length, 0, 'nothing is pushed while nothing asked for it');
    assert.strictEqual(lastPushAt(app), 0, 'no push recorded yet');

    app.refreshCalTopoAssignmentOverlayIfEnabled();
    await clock.advance(100);
    app.refreshCalTopoAssignmentOverlayIfEnabled();
    await clock.advance(100);
    app.refreshCalTopoAssignmentOverlayIfEnabled();
    assert.strictEqual(posted.length, 0, 'the burst is still being collected');
    const due = app.getNextCalTopoColorSyncAt();
    assert.strictEqual(due, clock.now - 200 + 300, 'the first request in the burst decides when the push runs');

    await clock.advance(500);
    assert.strictEqual(posted.length, 2, 'exactly one batch: one POST for Seg A and one for Seg B');
    assert.deepStrictEqual(posted.map(p => p.endpoint.split('/').pop()).sort(), ['cal-a', 'cal-b']);
    assert.strictEqual(posted[0].at, due, 'pushed when due');
    assert.strictEqual(posted[1].at, due);
    assert.strictEqual(lastPushAt(app), due, 'this tab remembers the push in sessionStorage');
    assert.strictEqual(overlayUpdatedAt(app), due, 'the first push captured the original styles: the case records it');
    assert.strictEqual(mapsSaves(server).length, 1, 'that first push saved the maps section once');
    assert.strictEqual(app.__logs.error.length, 0, 'no dialogs, no errors');
});

check('inside the cooldown a request is deferred to its end, and further requests fold into the same pending push', async () => {
    const {app, server, posted, clock} = await bootPage();
    app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 0});
    await clock.advance(50);
    assert.strictEqual(posted.length, 2, 'first push at once (no push known yet)');
    const first = posted[0].at;
    const savesAfterFirst = server.rows().length;

    app.refreshCalTopoAssignmentOverlayIfEnabled();
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 10000, 'deferred to the end of the 10 s cooldown');
    await clock.advance(3000);
    assert.strictEqual(posted.length, 2, 'nothing pushed 3 s after the first push');
    app.refreshCalTopoAssignmentOverlayIfEnabled();
    app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 1200});
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 10000, 'more requests do not move (or add) the pending push');
    await clock.advance(6900);
    assert.strictEqual(posted.length, 2, 'still waiting just before the cooldown ends');
    await clock.advance(200);
    assert.strictEqual(posted.length, 4, 'one more batch once the cooldown is over');
    assert.strictEqual(posted[2].at, first + 10000, 'exactly at the end of the cooldown');
    assert.strictEqual(posted[3].at, first + 10000);
    assert.strictEqual(lastPushAt(app), first + 10000);
    assert.strictEqual(server.rows().length, savesAfterFirst, 'a push that changed no shape saved nothing');
    assert.strictEqual(overlayUpdatedAt(app), first, 'updatedAt still marks the last CHANGING push');
});

check('the heartbeat re-pushes every minute even when nothing changed - without touching the maps section', async () => {
    const {app, server, posted, clock} = await bootPage();
    app.startCalTopoColorSyncTicker();
    await clock.advance(600);
    assert.strictEqual(posted.length, 2, 'the page load pushed (no push known yet)');
    const first = posted[0].at;
    const rowsBefore = server.rows().length;
    const updatedAtBefore = overlayUpdatedAt(app);

    await clock.advance(59000);
    assert.strictEqual(posted.length, 2, 'quiet until the heartbeat');
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 60000, 'the countdown points at the heartbeat');
    await clock.advance(1500);
    assert.strictEqual(posted.length, 4, 'heartbeat: both shapes are POSTed again although nothing changed');
    assert.ok(posted[2].at >= first + 60000 && posted[2].at <= first + 61000, `heartbeat at ~1 min (${posted[2].at - first} ms)`);
    assert.strictEqual(server.rows().length, rowsBefore, 'a no-change heartbeat issues NO /rows save');
    assert.strictEqual(overlayUpdatedAt(app), updatedAtBefore, 'updatedAt untouched by the heartbeat');

    await clock.advance(60000);
    assert.strictEqual(posted.length, 6, 'and again a minute later');
    assert.strictEqual(mapsSaves(server).length, 1, 'only the very first push (original styles captured) saved the maps section');
});

check('a heartbeat that changes a shape saves the case once and bumps updatedAt', async () => {
    const {app, server, posted, clock} = await bootPage();
    app.startCalTopoColorSyncTicker();
    await clock.advance(600);
    const first = posted[0].at;
    assert.strictEqual(overlayUpdatedAt(app), first);

    // Alpha starts searching Seg A: the shape gets the active-search style.
    await clock.advance(2000);
    app.assignSearchTaskToTeam('Alpha', 'R1', 'Seg A');
    const b = app.loadBundle();
    b.teamStatuses['Alpha'] = 'searching';
    app.saveBundle(b);
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 10000, 'the data change is pushed at the end of the cooldown, not at once');
    const mapsSavesBefore = mapsSaves(server).length;
    await clock.advance(8000);
    assert.strictEqual(posted.length, 4, 'one batch for the change');
    assert.strictEqual(posted[2].at, first + 10000);
    const segA = posted.slice(2).find(p => p.endpoint.endsWith('/cal-a'));
    assert.strictEqual(segA.payload.properties.fill, '#228be6', 'the pushed style is the active-search fill');
    assert.strictEqual(overlayUpdatedAt(app), first + 10000, 'updatedAt moves: this push changed a shape');
    assert.strictEqual(mapsSaves(server).length, mapsSavesBefore + 1, 'the changed shape was saved exactly once');
    assert.strictEqual(app.loadBundle().maps[0].features[0].attributes.fill, '#228be6', 'the pushed style is remembered locally');

    // The heartbeat after that changes nothing again.
    const rows = server.rows().length;
    await clock.advance(61000);
    assert.strictEqual(posted.length, 6, 'heartbeat');
    assert.strictEqual(server.rows().length, rows, 'nothing saved by the heartbeat');
});

check('page load: pushes at once when the cooldown is over, otherwise at the end of the cooldown (sessionStorage clock)', async () => {
    const startAt = Date.UTC(2026, 8, 9, 12, 0, 0);
    // Last push 30 s ago -> the new page pushes right away.
    {
        const {app, posted, clock} = await bootPage({startAt, sessionData: {[LAST_PUSH_KEY]: String(startAt - 30000)}});
        app.startCalTopoColorSyncTicker();
        await clock.advance(600);
        assert.strictEqual(posted.length, 2, 'cooldown over: pushed within the page-load delay');
        assert.strictEqual(posted[0].at, startAt + 500);
    }
    // Last push 4 s ago -> wait for the 10 s mark.
    {
        const {app, posted, clock} = await bootPage({startAt, sessionData: {[LAST_PUSH_KEY]: String(startAt - 4000)}});
        app.startCalTopoColorSyncTicker();
        await clock.advance(600);
        assert.strictEqual(posted.length, 0, 'inside the cooldown: no push on load');
        assert.strictEqual(app.getNextCalTopoColorSyncAt(), startAt + 6000, 'pending push at the end of the cooldown');
        await clock.advance(5000);
        assert.strictEqual(posted.length, 0);
        await clock.advance(600);
        assert.strictEqual(posted.length, 2, 'pushed once the cooldown ended');
        assert.strictEqual(posted[0].at, startAt + 6000);
    }
});

check('page load: the case\'s updatedAt hint (another device\'s changing push) counts as a push too', async () => {
    const startAt = Date.UTC(2026, 8, 9, 12, 0, 0);
    const store = seedStore({mutate: (b) => { b.maps[0].caltopoAssignmentOverlayState = {originals: {}, updatedAt: startAt - 2000}; }});
    const {app, posted, clock} = await bootPage({store, startAt});
    assert.strictEqual(lastPushAt(app), 0, 'this tab never pushed');
    assert.strictEqual(app.getLastCalTopoColorSyncAt(app.loadBundle()), startAt - 2000, 'but the case says another device did 2 s ago');
    app.startCalTopoColorSyncTicker();
    await clock.advance(600);
    assert.strictEqual(posted.length, 0, 'no immediate push');
    await clock.advance(8000);
    assert.strictEqual(posted.length, 2, 'pushed 10 s after the other device');
    assert.strictEqual(posted[0].at, startAt + 8000);

    // The later of the two clocks wins.
    app.__session[LAST_PUSH_KEY] = String(startAt + 100000);
    assert.strictEqual(app.getLastCalTopoColorSyncAt(app.loadBundle()), startAt + 100000);
});

check('custom intervals: 30 s cooldown and 5 min heartbeat are honoured', async () => {
    const store = seedStore({mutate: (b) => { b.caltopoColorSyncCooldownSeconds = 30; b.caltopoColorSyncHeartbeatMinutes = 5; }});
    const {app, posted, clock} = await bootPage({store});
    app.startCalTopoColorSyncTicker();
    await clock.advance(600);
    assert.strictEqual(posted.length, 2);
    const first = posted[0].at;

    app.refreshCalTopoAssignmentOverlayIfEnabled();
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 30000);
    await clock.advance(29000);
    assert.strictEqual(posted.length, 2, 'still inside the 30 s cooldown');
    await clock.advance(1500);
    assert.strictEqual(posted.length, 4, 'pushed at the 30 s mark');
    assert.strictEqual(posted[2].at, first + 30000);

    await clock.advance(299000);
    assert.strictEqual(posted.length, 4, 'no heartbeat before 5 minutes');
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), first + 30000 + 300000);
    await clock.advance(1500);
    assert.strictEqual(posted.length, 6, 'heartbeat 5 minutes after the last push');
});

check('nothing runs when the overlay toggle is off or no shapes were fetched', async () => {
    {
        const {app, posted, clock} = await bootPage({settings: serverSettings({[OVERLAY_KEY]: 'false'})});
        app.startCalTopoColorSyncTicker();
        app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 0});
        await clock.advance(120000);
        assert.strictEqual(posted.length, 0, 'overlay off: no POST, ever');
        assert.strictEqual(lastPushAt(app), 0);
    }
    {
        const store = seedStore({mutate: (b) => { b.maps[0].features = []; }});
        const {app, posted, clock} = await bootPage({store});
        app.startCalTopoColorSyncTicker();
        app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 0});
        await clock.advance(120000);
        assert.strictEqual(posted.length, 0, 'no fetched shapes: no POST (and no background fetch)');
    }
});

check('a hidden tab skips the heartbeat but a data change still pushes; a failing push is retried no sooner than the cooldown', async () => {
    const {app, posted, clock} = await bootPage();
    app.startCalTopoColorSyncTicker();
    await clock.advance(600);
    assert.strictEqual(posted.length, 2);
    const first = posted[0].at;

    app.__document.hidden = true;
    await clock.advance(125000);
    assert.strictEqual(posted.length, 2, 'hidden: no heartbeat in two minutes');
    app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 0});
    await clock.advance(100);
    assert.strictEqual(posted.length, 4, 'a data change pushes even while hidden (the cooldown is long over)');
    app.__document.hidden = false;

    // CalTopo rejects everything: silent, and the attempt still counts.
    const good = app.caltopo_api_call;
    app.caltopo_api_call = async () => null;
    const failAt = posted[2].at;
    await clock.advance(60500);
    assert.strictEqual(posted.length, 4, 'the failing heartbeat made no recorded POST (stub returned null)');
    assert.ok(lastPushAt(app) >= failAt + 60000, 'the failed attempt is recorded as an attempt');
    assert.ok(app.__logs.warn.some(w => /auto-refresh failed/.test(w)), 'failure is a console.warn');
    assert.strictEqual(app.__logs.error.filter(e => /^alert/.test(e)).length, 0, 'never a dialog');
    const failedAt = lastPushAt(app);
    app.refreshCalTopoAssignmentOverlayIfEnabled({delay: 0});
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), failedAt + 10000, 'retried no sooner than the cooldown');
    app.caltopo_api_call = good;
    await clock.advance(10500);
    assert.strictEqual(posted.length, 6, 'the retry went through');
});

// --- Maps page countdown ----------------------------------------------------------

check('the Maps page markup carries the countdown pill next to the map title', () => {
    const maps = appSource.slice(appSource.indexOf('function buildMapsPage()'));
    const title = maps.indexOf('id="current-map-title"');
    const pill = maps.indexOf('id="caltopo-color-sync-countdown"');
    assert.ok(title > 0 && pill > 0, 'both the title and the pill are rendered');
    assert.ok(pill - title < 400, 'the pill sits right next to the title (same flex row)');
    assert.ok(/id="caltopo-color-sync-countdown" class="mini-pill" style="display: none;/.test(maps), 'hidden until the scheduler has something to say');
    assert.ok(/id="caltopo-color-sync-countdown"[^>]*title="Time until the PSRc segment colors are next pushed to CalTopo/.test(maps), 'tooltip explains the timer');
});

check('countdown: "Color sync in m:ss" to the heartbeat or the pending push, "Syncing..." while a push runs, hidden when the toggle is off', async () => {
    const {app, posted, clock} = await bootPage({page: 'page10'});
    // The fake document hands out one element per id, so this is the pill the
    // page would render (buildMapsPage itself is not run here).
    const pill = app.__document.getElementById('caltopo-color-sync-countdown');
    assert.strictEqual(pill.textContent, '', 'nothing rendered before the ticker starts');

    // Hold the CalTopo POSTs so the push stays in flight.
    let openGate = null;
    let gate = null;
    const record = app.caltopo_api_call;
    app.caltopo_api_call = async (...args) => { if (gate) await gate; return record(...args); };

    gate = new Promise(resolve => { openGate = resolve; });
    app.startCalTopoColorSyncTicker();
    assert.strictEqual(pill.style.display, '', 'visible: overlay on, shapes fetched');
    assert.strictEqual(pill.textContent, 'Color sync in 0:01', 'the page-load push is pending in 500 ms');
    await clock.advance(600);
    assert.strictEqual(pill.textContent, 'Syncing\u2026', 'a push is in flight');
    assert.strictEqual(posted.length, 0, 'still held by the gate');
    openGate();
    gate = null;
    await clock.settle();
    assert.strictEqual(posted.length, 2);
    const pushedAt = posted[0].at;
    assert.strictEqual(pill.textContent, 'Color sync in 1:00', 'straight after a push the heartbeat is a minute away');

    // A data change inside the cooldown: the pill points at the deferred push.
    await clock.advance(3000);
    app.refreshCalTopoAssignmentOverlayIfEnabled();
    app.renderCalTopoColorSyncCountdown();
    assert.strictEqual(app.getNextCalTopoColorSyncAt(), pushedAt + 10000);
    assert.strictEqual(pill.textContent, `Color sync in ${app.formatCountdown(pushedAt + 10000 - clock.now)}`, 'counts down to the pending push');
    assert.strictEqual(pill.textContent, 'Color sync in 0:07');
    await clock.advance(8000);
    assert.strictEqual(posted.length, 4, 'the deferred push ran');
    assert.strictEqual(posted[2].at, pushedAt + 10000);
    assert.ok(/^Color sync in \d:\d\d$/.test(pill.textContent), `the 1 s ticker keeps the text current (${pill.textContent})`);
    app.renderCalTopoColorSyncCountdown();
    assert.strictEqual(pill.textContent, `Color sync in ${app.formatCountdown(pushedAt + 10000 + 60000 - clock.now)}`, 'back on the heartbeat');
    assert.strictEqual(pill.textContent, 'Color sync in 0:59');

    await clock.advance(10000);
    assert.ok(/^Color sync in 0:[45]\d$/.test(pill.textContent), `ticking (${pill.textContent})`);
    app.renderCalTopoColorSyncCountdown();
    assert.strictEqual(pill.textContent, 'Color sync in 0:49');

    // Toggle off -> hidden; on again -> visible.
    app.setCalTopoAssignmentOverlayEnabled(false);
    app.renderCalTopoColorSyncCountdown();
    assert.strictEqual(pill.style.display, 'none', 'hidden while PSRc Assignment Colors is off');
    assert.strictEqual(pill.textContent, '');
    await clock.advance(120000);
    assert.strictEqual(posted.length, 4, 'no heartbeat while off');
    app.setCalTopoAssignmentOverlayEnabled(true);
    await clock.advance(1000);
    assert.strictEqual(pill.style.display, '', 'visible again on the next tick');
    assert.ok(/^(Color sync in \d+:\d\d|Syncing\u2026)$/.test(pill.textContent));

    assert.strictEqual(app.formatCountdown(0), '0:00');
    assert.strictEqual(app.formatCountdown(-5000), '0:00', 'never negative');
    assert.strictEqual(app.formatCountdown(299000), '4:59');
    assert.strictEqual(app.formatCountdown(600000), '10:00');
});

check('the countdown is a no-op on pages without the pill and hidden when no shapes are fetched', async () => {
    {
        const store = seedStore({mutate: (b) => { b.maps[0].features = []; }});
        const {app, clock} = await bootPage({store, page: 'page10'});
        app.startCalTopoColorSyncTicker();
        await clock.advance(2000);
        const pill = app.__document.getElementById('caltopo-color-sync-countdown');
        assert.strictEqual(pill.style.display, 'none', 'no shapes: hidden');
    }
    {
        const {app, clock} = await bootPage({page: 'page4'});
        app.startCalTopoColorSyncTicker();
        await clock.advance(2000);
        assert.doesNotThrow(() => app.renderCalTopoColorSyncCountdown());
        assert.strictEqual(app.__logs.error.length, 0);
    }
});

// --- Settings page --------------------------------------------------------------

check('settings.html carries the CalTopo Color Sync panel (per login, condensable, two inputs)', () => {
    const html = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
    assert.ok(/<div class="home-panel" data-setting-scope="login" data-geek-compact data-geek-title="Color Sync">\s*<h2>CalTopo Color Sync<\/h2>/.test(html), 'panel with the scope attribute first (test_user_preferences_assets parses it that way)');
    assert.ok(/type="number" id="caltopo-sync-heartbeat-input"[^>]*min="1"/.test(html), 'heartbeat input: whole minutes >= 1');
    assert.ok(/type="number" id="caltopo-sync-cooldown-input"[^>]*min="1"/.test(html), 'cooldown input: whole seconds >= 1');
    assert.ok(/id="caltopo-sync-heartbeat-label" class="geek-full"[^>]*>minutes at most between color pushes<\/span>\s*<span class="geek-abbr"/.test(html), 'long/short labels like the Par panel');
    assert.ok(/id="caltopo-sync-cooldown-label" class="geek-full"[^>]*>seconds at least between color pushes<\/span>\s*<span class="geek-abbr"/.test(html));
    const panelAt = html.indexOf('<h2>CalTopo Color Sync</h2>');
    assert.ok(panelAt > html.indexOf('<h2>Map Feature Check</h2>') && panelAt < html.indexOf('<h2>Geek Mode</h2>'), 'placed after Map Feature Check');
});

check('the Settings inputs change the intervals at once, save them to the case and the login, and clamp the cooldown', async () => {
    const {app, server, clock} = await bootPage({page: 'settings'});
    app.buildSettingsPage();
    const heartbeat = app.__byId['caltopo-sync-heartbeat-input'];
    const cooldown = app.__byId['caltopo-sync-cooldown-input'];
    const status = app.__byId['settings-status'];
    assert.strictEqual(String(heartbeat.value), '1', 'shows the default heartbeat');
    assert.strictEqual(String(cooldown.value), '10', 'shows the default cooldown');
    const prefPuts = () => server.requests.filter(r => r.path === '/api/auth/settings' && r.method === 'PUT');
    const storedPrefs = () => { const puts = prefPuts(); return puts.length ? (puts[puts.length - 1].json['sar-user-preferences-v1'] || {}) : {}; };
    const logMentions = (text) => app.loadBundle().activityLog.some(e => JSON.stringify(e).includes(text));

    // Heartbeat 3 minutes.
    heartbeat.value = '3';
    heartbeat.onchange();
    await clock.settle();
    assert.strictEqual(app.loadBundle().caltopoColorSyncHeartbeatMinutes, 3, 'saved to the case');
    assert.strictEqual(storedPrefs().caltopoColorSyncHeartbeatMinutes, 3, 'saved to the login record (user_settings)');
    assert.ok(logMentions('CalTopo color sync heartbeat (minutes)'), 'the change is logged');
    assert.match(status.textContent, /at least every 3 minutes/);
    assert.strictEqual(app.getCalTopoColorSyncSettings(app.loadBundle()).heartbeatMs, 180000, 'in force for the scheduler at once');

    // Cooldown 120 s with a 3-minute heartbeat: fine.
    cooldown.value = '120';
    cooldown.onchange();
    await clock.settle();
    assert.strictEqual(app.loadBundle().caltopoColorSyncCooldownSeconds, 120);
    assert.strictEqual(storedPrefs().caltopoColorSyncCooldownSeconds, 120);
    assert.ok(logMentions('CalTopo color sync cooldown (seconds)'));
    assert.match(status.textContent, /at most every 120 seconds\.$/);

    // Cooldown 400 s is more than the heartbeat: clamped to 180 and the input rewritten.
    cooldown.value = '400';
    cooldown.onchange();
    await clock.settle();
    assert.strictEqual(String(cooldown.value), '180', 'the input shows the clamped value');
    assert.strictEqual(app.loadBundle().caltopoColorSyncCooldownSeconds, 180);
    assert.strictEqual(storedPrefs().caltopoColorSyncCooldownSeconds, 180);
    assert.match(status.textContent, /capped at the 3-minute heartbeat/);

    // Shortening the heartbeat to 1 minute pulls the cooldown down to 60.
    heartbeat.value = '1';
    heartbeat.onchange();
    await clock.settle();
    assert.strictEqual(String(cooldown.value), '60', 'the cooldown input follows');
    assert.strictEqual(app.loadBundle().caltopoColorSyncCooldownSeconds, 60);
    assert.strictEqual(storedPrefs().caltopoColorSyncCooldownSeconds, 60);
    assert.strictEqual(storedPrefs().caltopoColorSyncHeartbeatMinutes, 1);
    assert.match(status.textContent, /cooldown was shortened to 60 seconds/);

    // Invalid input reverts to the value in force and saves nothing.
    const putsBefore = prefPuts().length;
    const logBefore = app.loadBundle().activityLog.length;
    heartbeat.value = 'abc';
    heartbeat.onchange();
    cooldown.value = '0';
    cooldown.onchange();
    await clock.settle();
    assert.strictEqual(String(heartbeat.value), '1', 'garbage -> back to the stored heartbeat');
    assert.strictEqual(String(cooldown.value), '60', '0 -> back to the stored cooldown');
    assert.strictEqual(prefPuts().length, putsBefore, 'nothing saved for invalid input');
    assert.strictEqual(app.loadBundle().activityLog.length, logBefore, 'nothing logged for invalid input');
    assert.match(status.textContent, /whole number of seconds/);

    // The same value again is a no-op.
    cooldown.value = '60';
    cooldown.onchange();
    await clock.settle();
    assert.strictEqual(prefPuts().length, putsBefore);
    assert.strictEqual(app.loadBundle().activityLog.length, logBefore);
    // The fake page has no AbortController for the CalTopo proxy health check;
    // only errors from the settings under test count.
    assert.deepStrictEqual(app.__logs.error.filter(e => !/\[PROXY\] Health check/.test(e)), [], 'no errors on the Settings page');
});

// --- Run ----------------------------------------------------------------------

(async () => {
    for (const {name, fn} of checks) {
        await fn();
        console.log(`  ok - ${name}`);
    }
    console.log('CalTopo color sync schedule: PASS');
})().catch(err => {
    console.error(err);
    process.exit(1);
});

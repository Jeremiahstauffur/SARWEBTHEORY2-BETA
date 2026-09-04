// Regression tests for the sync outbox: the rows a device changed are queued
// in localStorage and delivered to POST /rows as a batch with a stable id.
//
// The bug: segments imported on the Maps page (which loads CalTopo features and
// so pushes the search file past 64 KiB) vanished from the Segments page a
// second after it rendered. Every save had silently fallen back to a whole-file
// upload sent with `keepalive: true`, which browsers refuse above 64 KiB, so
// the server kept a stale copy - and the page then replaced its freshly
// imported rows with that stale copy.
//
// These tests drive the real app.js in a sandbox with a fake localStorage and a
// scripted fetch() that records every request the website makes.
//
// Run with: node test_sync_outbox.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
// The same row-merge logic the server runs, for checking what a batch does to its copy.
const syncDelta = require('./sync-delta.js');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const OUTBOX_KEY = 'sar-sync-outbox-v1';
const BUCKET_TAG_KEY = 'sar-bundle-bucket-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
// The CASE # doubles as the file name; getSyncBucket() suffixes it with the login.
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
    // A short parent chain, so code that walks up to the root terminates.
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

// Loads sync-delta.js + app.js over `store` (a plain object standing in for
// localStorage). Creating a second sandbox over the same store is a "reload".
function createSandbox({store, fetch, page = 'page2', bucketTag} = {}) {
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
            const name = pair.slice(0, idx).trim();
            if (/expires=thu, 01 jan 1970/i.test(value)) delete cookieJar[name];
            else cookieJar[name] = pair.slice(idx + 1);
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
        // Every id resolves to a generic element, so the page can render.
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };

    const timers = [];
    const listeners = {};
    document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    const logs = {warn: [], error: []};
    const sandbox = {
        console: {
            log() {},
            info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; },
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
        fetch: (url, init) => fetch(url, init),
        alert() {},
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: `http://localhost/${page}.html`, search: ''}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__timers = timers;
    sandbox.__listeners = listeners;
    sandbox.__logs = logs;
    if (bucketTag !== undefined) {
        if (bucketTag === null) delete store[BUCKET_TAG_KEY];
        else store[BUCKET_TAG_KEY] = bucketTag;
    }
    return sandbox;
}

// A scripted server: `handler(request)` returns {status, body}, throws to
// simulate a dropped connection. Every request is recorded.
function createServer(handler) {
    const requests = [];
    const fetch = async (url, init = {}) => {
        const parsed = new URL(String(url));
        const rawBody = typeof init.body === 'string' ? init.body : '';
        let json = null;
        try { json = rawBody ? JSON.parse(rawBody) : null; } catch (e) { /* not JSON */ }
        const request = {
            url: String(url),
            path: parsed.pathname,
            query: parsed.searchParams,
            method: String(init.method || 'GET').toUpperCase(),
            keepalive: init.keepalive === true,
            bodyLength: rawBody.length,
            json
        };
        requests.push(request);
        const reply = handler(request);
        if (reply instanceof Error) throw reply;
        const status = reply && reply.status ? reply.status : 200;
        const body = reply && reply.body !== undefined ? reply.body : {success: true};
        return {ok: status >= 200 && status < 300, status, json: async () => body};
    };
    return {requests, fetch, writes: () => requests.filter(r => r.method !== 'GET')};
}

const offline = () => new Error('Failed to fetch');

// Enough GeoJSON to push the search file well past the 64 KiB keepalive cap.
function bigFeatures(count = 800) {
    return Array.from({length: count}, (_, i) => ({
        type: 'Feature',
        id: `feature-${i}`,
        geometry: {type: 'Polygon', coordinates: [[[-93.1 + i / 1000, 44.9], [-93.0, 44.95 + i / 1000], [-93.05, 45.0], [-93.1 + i / 1000, 44.9]]]},
        properties: {title: `Segment ${i}`, class: 'Assignment', description: 'x'.repeat(40)}
    }));
}

// A store holding the Case-1 search file that already belongs to this device.
function seedStore({fileName = CASE, big = true, bucketTag = BUCKET} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: () => Promise.reject(offline())});
    const bundle = scratch.defaultBundle();
    bundle.fileName = fileName;
    bundle.pages.page2 = [['R1', 'Seg A', '', '', '', '', '', '', '', '']];
    if (big) bundle.maps = [{id: 'map-1', name: 'CalTopo map', features: bigFeatures()}];
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    if (bucketTag) store[BUCKET_TAG_KEY] = bucketTag;
    else delete store[BUCKET_TAG_KEY];
    return store;
}

const outboxRecord = (store, fileName = CASE) => {
    const parsed = JSON.parse(store[OUTBOX_KEY] || '{}');
    return parsed[`${BUCKET}::${fileName}`] || null;
};

const segmentRow = (region, name) => [region, name, '', '', '', '', '', '', '', ''];
const BLANK_ROW = segmentRow('', '');

// What the browser does when the page has loaded.
async function fireDomReady(app) {
    const handlers = app.__listeners.DOMContentLoaded || [];
    assert.strictEqual(handlers.length, 1, 'app.js registers one DOMContentLoaded handler');
    await handlers[0]();
}

// A server that answers the calls a page makes while loading.
function bootServer(extra) {
    return createServer((req) => {
        if (req.path === '/api/auth/settings') return {status: 200, body: {'sar-sync-bucket-v1': CASE}};
        if (req.path === '/api/auth/history') return {status: 200, body: []};
        if (req.path === `${API}/all-files`) return {status: 404, body: {}};
        const reply = extra(req);
        return reply === undefined ? {status: 500, body: {error: `unexpected ${req.method} ${req.path}`}} : reply;
    });
}

// Values created inside the sandbox have their own Array/Object prototypes;
// deepStrictEqual needs them re-created in this realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Requests that carry search-file data to the server (a page load also saves
// settings and announces the active user, which are neither).
const dataWrites = (server) => server.writes()
    .filter(r => [`${API}/bundle`, `${API}/rows`, `${API}/${CASE}`].includes(r.path))
    .map(r => `${r.method} ${r.path}`);

// --- Test runner --------------------------------------------------------------

const checks = [];
const check = (name, fn) => checks.push({name, fn});

// --- Static guards --------------------------------------------------------------

check('every *_STORAGE_KEY / *_INTERVAL_MS identifier app.js uses is declared', () => {
    // The regression that lost the imported segments was a renamed constant:
    // readSyncSnapshot() threw a ReferenceError that its try/catch swallowed.
    const used = new Set(appSource.match(/\b[A-Z][A-Z0-9_]*_(?:STORAGE_KEY|INTERVAL_MS)\b/g) || []);
    const declared = new Set(
        [...appSource.matchAll(/^\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]*_(?:STORAGE_KEY|INTERVAL_MS))\b/gm)].map(m => m[1])
    );
    const missing = [...used].filter(id => !declared.has(id)).sort();
    assert.deepStrictEqual(missing, [], `used but never declared: ${missing.join(', ')}`);
});

// --- The reported scenario, step by step ------------------------------------

check('a save on a > 64 KiB search file sends only the changed rows to /rows', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/rows`) {
            return {status: 200, body: {success: true, applied: 1, lastModified: '2026-03-01T10:00:00.000Z'}};
        }
        return {status: 500, body: {error: `unexpected ${req.method} ${req.path}`}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    assert.ok(JSON.stringify(bundle).length > 64 * 1024, 'the search file must exceed the keepalive cap');
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C'));

    const delivered = await app.saveBundle(bundle);
    assert.strictEqual(delivered, true, `the batch must be confirmed (${JSON.stringify(app.__logs)})`);

    assert.strictEqual(server.requests.length, 1, `exactly one request, got ${JSON.stringify(server.requests.map(r => r.method + ' ' + r.path))}`);
    const req = server.requests[0];
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.path, `${API}/rows`);
    assert.strictEqual(req.json.fileName, 'Case-1');
    assert.ok(typeof req.json.batchId === 'string' && req.json.batchId.length > 0, 'a batch id must travel');
    assert.deepStrictEqual(req.json.changes, [
        {path: ['pages', 'page2'], append: [segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C')]}
    ]);
    assert.ok(req.bodyLength < 60000, 'only the rows travel, never the whole file');
    assert.strictEqual(req.keepalive, true, 'a small row batch may still outlive the page');

    const record = outboxRecord(store);
    assert.ok(record, 'the outbox record must exist');
    assert.deepStrictEqual(record.changes, [], 'confirmed rows leave the outbox');
    assert.strictEqual(record.inFlight, null);
    assert.strictEqual(store[BUCKET_TAG_KEY], BUCKET, 'the local copy is tagged with its CASE #');
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Seg A', 'Seg B', 'Seg C']);
});

check('a row batch larger than the keepalive cap is sent as an ordinary request', async () => {
    const store = seedStore();
    const server = createServer(() => ({status: 200, body: {success: true, applied: 1}}));
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.maps[0].features.push({type: 'Feature', id: 'new', geometry: null, properties: {title: 'New'}});
    await app.saveBundle(bundle);

    assert.strictEqual(server.requests.length, 1);
    const req = server.requests[0];
    assert.strictEqual(req.path, `${API}/rows`);
    assert.deepStrictEqual(req.json.changes.map(c => c.path), [['maps', '0']]);
    assert.ok(req.bodyLength > 60000, 'the map item itself is large');
    assert.strictEqual(req.keepalive, false, 'large bodies must not ask for keepalive');
});

check('an unchanged save makes no request at all', async () => {
    const store = seedStore();
    const server = createServer(() => ({status: 200, body: {success: true}}));
    const app = createSandbox({store, fetch: server.fetch});

    const result = await app.saveBundle(app.loadBundle());
    assert.strictEqual(result, true);
    assert.strictEqual(server.requests.length, 0);
    assert.deepStrictEqual(outboxRecord(store) ? outboxRecord(store).changes : [], []);
});

// --- Persistence and retries --------------------------------------------------

check('an edit made offline survives a reload and is re-sent with the same batch id', async () => {
    const store = seedStore();
    const down = createServer(() => offline());
    const app1 = createSandbox({store, fetch: down.fetch});

    const bundle = app1.loadBundle();
    bundle.pages.page2[0][2] = 'Team 1';
    const delivered = await app1.saveBundle(bundle);
    assert.strictEqual(delivered, false, 'nothing was delivered while offline');
    assert.strictEqual(down.requests.length, 1);

    const pending = outboxRecord(store);
    assert.strictEqual(pending.changes.length, 1, 'the edit must stay queued');
    assert.deepStrictEqual(pending.changes[0].path, ['pages', 'page2', '0']);
    assert.strictEqual(pending.changes[0].value[2], 'Team 1');
    assert.ok(pending.inFlight && pending.inFlight.batchId, 'the attempt keeps its batch id');
    assert.strictEqual(pending.inFlight.batchId, down.requests[0].json.batchId);

    // Reload: a fresh page over the same storage, and the connection is back.
    // The server already applied the first attempt, so it reports a duplicate.
    const up = createServer((req) => {
        if (req.path === `${API}/rows`) return {status: 200, body: {success: true, applied: 0, duplicate: true}};
        return {status: 500, body: {}};
    });
    const app2 = createSandbox({store, fetch: up.fetch});
    const ok = await app2.pushBundleDelta(app2.loadBundle());
    assert.strictEqual(ok, true);
    assert.strictEqual(up.requests.length, 1);
    assert.strictEqual(up.requests[0].json.batchId, pending.inFlight.batchId, 'the retry repeats the same batch id');
    assert.deepStrictEqual(up.requests[0].json.changes, pending.changes, 'the retry repeats the same rows');

    const after = outboxRecord(store);
    assert.deepStrictEqual(after.changes, []);
    assert.strictEqual(after.inFlight, null);
    assert.strictEqual(app2.loadBundle().pages.page2[0][2], 'Team 1', 'the local copy keeps the edit');
});

check('edits queued while a batch is unanswered go in the next batch, not into the old one', async () => {
    const store = seedStore();
    const down = createServer(() => offline());
    const app = createSandbox({store, fetch: down.fetch});

    let bundle = app.loadBundle();
    bundle.pages.page2[0][2] = 'first';
    await app.saveBundle(bundle);
    const firstBatch = outboxRecord(store).inFlight;

    bundle = app.loadBundle();
    bundle.pages.page2[0][2] = 'second';
    await app.saveBundle(bundle);

    const record = outboxRecord(store);
    assert.strictEqual(record.changes.length, 2, 'the unanswered batch keeps its rows; the new edit is queued behind it');
    assert.strictEqual(record.changes[0].value[2], 'first');
    assert.strictEqual(record.changes[1].value[2], 'second');
    assert.deepStrictEqual(record.inFlight, firstBatch);
    assert.strictEqual(down.requests.length, 2);
    assert.deepStrictEqual(down.requests[1].json.changes.map(c => c.value[2]), ['first'], 'the retry only carries the original batch');

    const up = createServer(() => ({status: 200, body: {success: true, applied: 1}}));
    const app2 = createSandbox({store, fetch: up.fetch});
    await app2.pushBundleDelta(app2.loadBundle());
    await app2.pushBundleDelta(app2.loadBundle());
    assert.deepStrictEqual(up.requests.map(r => r.json.changes.map(c => c.value[2])), [['first'], ['second']]);
    assert.deepStrictEqual(outboxRecord(store).changes, []);
});

check('consecutive edits of the same row coalesce into one change when the flush is deferred', async () => {
    const store = seedStore();
    const server = createServer(() => ({status: 200, body: {success: true, applied: 1}}));
    const app = createSandbox({store, fetch: server.fetch});

    let bundle = app.loadBundle();
    bundle.pages.page2[0][2] = 'a';
    await app.saveBundle(bundle, true);
    bundle = app.loadBundle();
    bundle.pages.page2[0][3] = 'b';
    await app.saveBundle(bundle, true);
    assert.strictEqual(server.requests.length, 0, 'deferred saves do not flush');

    const record = outboxRecord(store);
    assert.strictEqual(record.changes.length, 1);
    assert.deepStrictEqual(record.changes[0].value.slice(0, 4), ['R1', 'Seg A', 'a', 'b']);
    assert.deepStrictEqual(record.changes[0].previous.slice(0, 4), ['R1', 'Seg A', '', ''], 'the earliest previous is kept');

    await app.pushBundleDelta(app.loadBundle());
    assert.strictEqual(server.requests.length, 1);
    assert.deepStrictEqual(server.requests[0].json.changes, record.changes);
});

// --- Server data never discards undelivered rows ------------------------------

// The row the server holds for page2 in the tests below.
const SERVER_SEG_A = segmentRow('R1', 'Seg A');

check('the reported bug: a stale server copy no longer wipes freshly imported segments', async () => {
    // A > 64 KiB search file (CalTopo features loaded), two segments imported
    // while the server is unreachable, then the Segments page asks the server
    // for changes and gets a copy that predates the import.
    const store = seedStore();
    let online = false;
    const server = createServer((req) => {
        if (!online) return offline();
        if (req.path === `${API}/state`) {
            return {status: 200, body: {
                found: true, modified: true, lastModified: '2026-03-01T10:00:00.000Z',
                bundle: {pages: {page2: [SERVER_SEG_A]}}
            }};
        }
        if (req.path === `${API}/rows`) return {status: 200, body: {success: true, applied: 1, lastModified: '2026-03-01T10:00:05.000Z'}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C'));
    assert.strictEqual(await app.saveBundle(bundle), false, 'offline: the import is queued, not delivered');

    // The page comes up: the poll must not blank the imported rows.
    online = true;
    server.requests.length = 0;
    const applied = await app.pollServerState();
    assert.strictEqual(applied, false, 'the stale copy adds nothing this device does not already show');
    assert.deepStrictEqual(server.requests.map(r => `${r.method} ${r.path}`), [`GET ${API}/state`]);
    assert.strictEqual(server.requests[0].query.get('since'), '', 'first poll starts from the beginning');
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Seg A', 'Seg B', 'Seg C'], 'imported segments stay on the page');

    const record = outboxRecord(store);
    assert.strictEqual(record.changes.length, 1, 'the import stays queued until the server confirms it');
    assert.strictEqual(record.cursor, '2026-03-01T10:00:00.000Z', 'the /state answer moves the cursor');

    // The connection is back for good: the queued import is delivered.
    server.requests.length = 0;
    assert.strictEqual(await app.pushBundleDelta(app.loadBundle()), true);
    assert.deepStrictEqual(server.requests.map(r => `${r.method} ${r.path}`), [`POST ${API}/rows`]);
    assert.deepStrictEqual(server.requests[0].json.changes, [
        {path: ['pages', 'page2'], append: [segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C')]}
    ]);
    assert.deepStrictEqual(outboxRecord(store).changes, []);
    assert.strictEqual(outboxRecord(store).cursor, '2026-03-01T10:00:00.000Z', 'a /rows answer never moves the cursor');
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Seg A', 'Seg B', 'Seg C']);
});

check('a poll applies the other devices\' rows and keeps this device\'s pending edit on top', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/state`) {
            return {status: 200, body: {
                found: true, modified: true, lastModified: '2026-03-01T11:00:00.000Z',
                bundle: {pages: {page2: [SERVER_SEG_A, segmentRow('R2', 'From other device')]}}
            }};
        }
        return offline();
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2[0][2] = '120';
    await app.saveBundle(bundle);

    assert.strictEqual(await app.pollServerState(), true);
    const page2 = plain(app.loadBundle().pages.page2);
    assert.strictEqual(page2.length, 2);
    assert.strictEqual(page2[0][2], '120', 'the undelivered cell edit is kept');
    assert.strictEqual(page2[1][1], 'From other device', 'the other device\'s row appears');
    assert.strictEqual(outboxRecord(store).changes.length, 1, 'the edit is still queued');
    assert.strictEqual(outboxRecord(store).cursor, '2026-03-01T11:00:00.000Z');
});

check('a queued append the server already applied is not shown twice after a poll', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/state`) {
            // The server got the row (the first answer was lost on the way back).
            return {status: 200, body: {
                found: true, modified: true, lastModified: '2026-03-01T12:00:00.000Z',
                bundle: {pages: {page2: [SERVER_SEG_A, segmentRow('R1', 'Seg B')]}}
            }};
        }
        return offline();
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'));
    await app.saveBundle(bundle);

    await app.pollServerState();
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Seg A', 'Seg B']);
});

check('a poll that reports nothing new changes nothing and makes no other request', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/state`) return {status: 200, body: {found: true, modified: false, lastModified: '2026-03-01T09:00:00.000Z'}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});
    const before = store[BUNDLE_KEY];

    assert.strictEqual(await app.pollServerState(), false);
    assert.strictEqual(server.requests.length, 1);
    assert.strictEqual(store[BUNDLE_KEY], before);
    assert.strictEqual((outboxRecord(store) || {cursor: ''}).cursor, '', 'an unmodified answer does not move the cursor');
});

check('the next poll asks only for what changed since the last answer', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/state`) {
            return {status: 200, body: {found: true, modified: true, lastModified: '2026-03-01T13:00:00.000Z', bundle: {teamStatuses: {'Team 1': 'at base'}}}};
        }
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    await app.pollServerState();
    await app.pollServerState();
    assert.deepStrictEqual(server.requests.map(r => r.query.get('since')), ['', '2026-03-01T13:00:00.000Z']);
    assert.deepStrictEqual(plain(app.loadBundle().teamStatuses), {'Team 1': 'at base'});
});

check('a poll on a CASE # the server has never seen falls back to the one-time full read', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/state`) return {status: 404, body: {found: false}};
        if (req.path === `${API}/all-files`) return {status: 404, body: {}};
        if (req.path === `${API}/bundle` && req.method === 'GET') return {status: 404, body: {}};
        if (req.method === 'PUT') return {status: 200, body: {success: true}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    await app.pollServerState();
    const seed = server.writes().find(r => r.path === `${API}/bundle`);
    assert.ok(seed, 'the file is seeded');
    assert.strictEqual(seed.query.get('seed'), '1');
    assert.strictEqual(seed.keepalive, false);
});

// --- Page load: which copy of the file a page starts from ----------------------

check('a stored file tagged with another CASE # is dropped and this case is read from the database', async () => {
    const store = seedStore({bucketTag: 'Other-Case_tester'});
    const server = bootServer((req) => {
        if (req.path === `${API}/bundle` && req.method === 'GET') {
            return {status: 200, body: {fileName: CASE, lastModified: '2026-03-01T08:00:00.000Z', pages: {page2: [segmentRow('R5', 'Server only')]}}};
        }
        if (req.path === `${API}/state`) return {status: 200, body: {found: true, modified: false}};
        return undefined;
    });
    const app = createSandbox({store, fetch: server.fetch});

    await fireDomReady(app);

    assert.ok(server.requests.some(r => r.method === 'GET' && r.path === `${API}/bundle`), 'the case is read in full');
    assert.deepStrictEqual(dataWrites(server), [], 'the other case\'s rows must never be uploaded here');
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Server only'], 'the other case\'s rows are gone');
    assert.strictEqual(store[BUCKET_TAG_KEY], BUCKET, 'the stored copy is now tagged with this CASE #');
    assert.strictEqual(outboxRecord(store).cursor, '2026-03-01T08:00:00.000Z', 'the full read primes the poll cursor');
});

check('a stored file tagged with this CASE # is kept: the page only flushes and polls', async () => {
    const store = seedStore();
    const before = JSON.parse(store[BUNDLE_KEY]);
    const server = bootServer((req) => {
        if (req.path === `${API}/state`) return {status: 200, body: {found: true, modified: false}};
        return undefined;
    });
    const app = createSandbox({store, fetch: server.fetch});

    await fireDomReady(app);

    const dataCalls = server.requests
        .filter(r => [`${API}/bundle`, `${API}/rows`, `${API}/${CASE}`, `${API}/state`].includes(r.path))
        .map(r => `${r.method} ${r.path}`);
    assert.deepStrictEqual(dataCalls, [`GET ${API}/state`], 'no full read and no upload for a copy that is already this case\'s');
    const after = JSON.parse(store[BUNDLE_KEY]);
    delete before.lastModified;
    delete after.lastModified;
    assert.deepStrictEqual(after, before, 'the local copy is untouched');
});

check('a device without a local copy reads the file once and needs no whole-file upload', async () => {
    const store = seedStore();
    delete store[BUNDLE_KEY];
    delete store[BUCKET_TAG_KEY];
    const server = bootServer((req) => {
        if (req.path === `${API}/bundle` && req.method === 'GET') {
            return {status: 200, body: {fileName: CASE, lastModified: '2026-03-01T08:30:00.000Z', pages: {page2: [SERVER_SEG_A]}}};
        }
        return undefined;
    });
    const app = createSandbox({store, fetch: server.fetch});

    await fireDomReady(app);

    assert.deepStrictEqual(dataWrites(server), [], 'nothing is uploaded');
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2), [SERVER_SEG_A]);
    assert.strictEqual(store[BUCKET_TAG_KEY], BUCKET);
});

check('an upgraded device delivers the rows the old build stranded, but never a differing existing cell', async () => {
    // The previous build left the local copy untagged. It holds two segments
    // the server never received (one typed into a blank row, one appended) and
    // one cell that differs from the server - which may well be another
    // device's newer edit, so it must not be pushed back.
    const store = seedStore({big: false, bucketTag: null});
    const scratch = createSandbox({store, fetch: () => Promise.reject(offline())});
    const local = scratch.loadBundle();
    local.pages.page2 = [segmentRow('R1', 'Seg A').map((c, i) => (i === 2 ? 'local-stale' : c)), segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C')];
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(local));
    delete store[BUCKET_TAG_KEY];

    const serverSegA = segmentRow('R1', 'Seg A').map((c, i) => (i === 2 ? 'server-newer' : c));
    const server = bootServer((req) => {
        if (req.path === `${API}/bundle` && req.method === 'GET') {
            return {status: 200, body: {fileName: CASE, lastModified: '2026-03-01T09:00:00.000Z', pages: {page2: [serverSegA, BLANK_ROW]}}};
        }
        if (req.path === `${API}/rows`) return {status: 200, body: {success: true, applied: 2}};
        return undefined;
    });
    const app = createSandbox({store, fetch: server.fetch});

    await fireDomReady(app);

    assert.deepStrictEqual(dataWrites(server), [`POST ${API}/rows`], 'only the stranded rows travel, as a row batch');
    const rows = server.writes().filter(r => r.path === `${API}/rows`);
    assert.deepStrictEqual(rows[0].json.changes, [
        {path: ['pages', 'page2', '1'], value: segmentRow('R1', 'Seg B'), previous: BLANK_ROW},
        {path: ['pages', 'page2'], append: [segmentRow('R1', 'Seg C')]}
    ]);
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2), [serverSegA, segmentRow('R1', 'Seg B'), segmentRow('R1', 'Seg C')],
        'the server cell wins, the stranded rows stay');
    assert.deepStrictEqual(outboxRecord(store).changes, []);
    assert.strictEqual(store[BUCKET_TAG_KEY], BUCKET, 'the copy is tagged, so the migration runs only once');
});

check('a seed refused because another device got there first adopts that copy', async () => {
    const store = seedStore();
    let rowsCalls = 0;
    const server = bootServer((req) => {
        if (req.path === `${API}/rows`) {
            rowsCalls++;
            return rowsCalls === 1 ? {status: 409, body: {needsFullSync: true}} : {status: 200, body: {success: true, applied: 1}};
        }
        if (req.path === `${API}/bundle` && req.method === 'PUT') return {status: 409, body: {alreadyExists: true}};
        if (req.path === `${API}/bundle` && req.method === 'GET') {
            return {status: 200, body: {fileName: CASE, lastModified: '2026-03-01T09:30:00.000Z', pages: {page2: [SERVER_SEG_A, segmentRow('R7', 'Seeded elsewhere')]}}};
        }
        return undefined;
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'));
    assert.strictEqual(await app.saveBundle(bundle), false);
    assert.strictEqual(app.__timers.filter(t => t.ms === 0).length, 1, 'the refused seed schedules the adoption of the server copy');
    await app.syncWithServer(); // what that timer runs

    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['Seg A', 'Seeded elsewhere', 'Seg B']);
    assert.deepStrictEqual(outboxRecord(store).changes, [], 'the queued row went out as a row batch on top of the adopted copy');
    assert.deepStrictEqual(dataWrites(server), [`POST ${API}/rows`, `PUT ${API}/bundle`, `POST ${API}/rows`]);
    const rows = server.writes().filter(r => r.path === `${API}/rows`);
    assert.deepStrictEqual(rows[1].json.changes, [{path: ['pages', 'page2'], append: [segmentRow('R1', 'Seg B')]}]);
});

// --- Rendering is silent; an import is one batch -----------------------------

check('recalculating and rendering an already-consistent Segments page makes no request', async () => {
    const store = seedStore();
    const server = createServer(() => ({status: 200, body: {success: true, applied: 1}}));
    const app = createSandbox({store, fetch: server.fetch});

    // Derived cells may be filled in once; from then on the data is consistent.
    await app.recalculateEverything();
    server.requests.length = 0;
    const settled = store[BUNDLE_KEY];

    assert.strictEqual(await app.recalculateEverything(), false, 'nothing to save');
    app.buildSegmentsTable();
    app.buildSegmentsTable();

    assert.strictEqual(server.requests.length, 0, `rendering must not talk to the server: ${JSON.stringify(server.requests.map(r => r.method + ' ' + r.path))}`);
    assert.strictEqual(store[BUNDLE_KEY], settled, 'rendering must not touch the stored file (not even lastModified)');
});

check('importing segments sends one row batch carrying the recalculated rows, never the whole file', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/rows`) return {status: 200, body: {success: true, applied: 1}};
        return {status: 500, body: {error: `unexpected ${req.method} ${req.path}`}};
    });
    const app = createSandbox({store, fetch: server.fetch});
    await app.recalculateEverything();
    server.requests.length = 0;

    const delivered = await app.importSegmentsAction([
        {region: 'R1', segment: 'Seg B', area: 10, length: 2},
        {region: 'R1', segment: 'Seg C', area: 5, length: 1}
    ]);
    assert.strictEqual(delivered, true);

    assert.deepStrictEqual(dataWrites(server), [`POST ${API}/rows`], 'exactly one row batch and no whole-file upload');
    const batch = server.writes()[0].json;
    const page2 = plain(app.loadBundle().pages.page2);
    assert.deepStrictEqual(page2.map(r => r[1]), ['Seg A', 'Seg B', 'Seg C']);

    const appended = batch.changes.find(c => Array.isArray(c.append) && c.path.join('.') === 'pages.page2');
    assert.ok(appended, 'the imported rows travel as an append');
    assert.ok(batch.changes.some(c => c.path.join('.') === 'activityLog'), 'the import\'s activity log entry is in the same batch');
    assert.deepStrictEqual(outboxRecord(store).changes, []);

    // Applied to the server's copy, the batch yields exactly the rows this
    // device shows - including the cells the recalculation filled in.
    const serverCopy = syncDelta.applyBundleChanges(JSON.parse(seedStore()[BUNDLE_KEY]), batch.changes).bundle;
    assert.deepStrictEqual(serverCopy.pages.page2, page2);
    assert.ok(page2[1][7] !== '' && page2[2][7] !== '', 'the PSRc cells were recalculated for the imported rows');

    // The highlight-clearing rebuild a few seconds later is render-only.
    server.requests.length = 0;
    app.buildSegmentsTable();
    assert.strictEqual(server.requests.length, 0);
});

// --- Whole-file paths ---------------------------------------------------------

check('a server without a copy of the CASE # is seeded once with PUT /bundle?seed=1', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/rows`) return {status: 409, body: {error: 'No stored search file', needsFullSync: true}};
        if (req.method === 'PUT') return {status: 200, body: {success: true, lastModified: '2026-03-01T10:00:00.000Z'}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'));
    const ok = await app.saveBundle(bundle);
    assert.strictEqual(ok, true);

    const writes = server.writes();
    assert.deepStrictEqual(writes.map(r => `${r.method} ${r.path}${r.query.has('seed') ? '?seed=1' : ''}`), [
        `POST ${API}/rows`,
        `PUT ${API}/bundle?seed=1`,
        `PUT ${API}/Case-1`
    ]);
    const seed = writes[1];
    assert.ok(seed.bodyLength > 64 * 1024, 'the seed carries the whole file');
    assert.strictEqual(seed.keepalive, false, 'a whole file never asks for keepalive');
    assert.deepStrictEqual(seed.json.pages.page2.map(r => r[1]), ['Seg A', 'Seg B']);
    assert.deepStrictEqual(outboxRecord(store).changes, [], 'the seed covers the queued rows');
});

check('a seed refused because another device got there first keeps the rows queued for /rows', async () => {
    const store = seedStore();
    let rowsCalls = 0;
    const server = createServer((req) => {
        if (req.path === `${API}/rows`) {
            rowsCalls++;
            return rowsCalls === 1
                ? {status: 409, body: {needsFullSync: true}}
                : {status: 200, body: {success: true, applied: 1}};
        }
        if (req.method === 'PUT' && req.query.get('seed') === '1') return {status: 409, body: {alreadyExists: true}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2.push(segmentRow('R1', 'Seg B'));
    assert.strictEqual(await app.saveBundle(bundle), false);
    assert.strictEqual(outboxRecord(store).changes.length, 1, 'the rows are still queued');

    assert.strictEqual(await app.pushBundleDelta(app.loadBundle()), true);
    assert.deepStrictEqual(outboxRecord(store).changes, []);
    assert.deepStrictEqual(server.writes().map(r => `${r.method} ${r.path}`), [
        `POST ${API}/rows`, `PUT ${API}/bundle`, `POST ${API}/rows`
    ]);
});

check('a backend without the row endpoint still receives the edit as a whole file', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.path === `${API}/rows`) return {status: 405, body: {}};
        if (req.method === 'PUT') return {status: 200, body: {success: true}};
        return {status: 500, body: {}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2[0][2] = 'legacy';
    assert.strictEqual(await app.saveBundle(bundle), true);

    const writes = server.writes();
    assert.deepStrictEqual(writes.map(r => `${r.method} ${r.path}`), [`POST ${API}/rows`, `PUT ${API}/bundle`, `PUT ${API}/Case-1`]);
    assert.ok(!writes[1].query.has('seed'), 'the legacy fallback is a plain whole-file upload');
    assert.strictEqual(writes[1].keepalive, false);
    assert.strictEqual(writes[1].json.pages.page2[0][2], 'legacy');
    assert.deepStrictEqual(outboxRecord(store).changes, []);
});

check('switching to another search file uploads it whole instead of diffing', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.method === 'PUT') return {status: 200, body: {success: true}};
        return {status: 500, body: {error: 'no rows expected'}};
    });
    const app = createSandbox({store, fetch: server.fetch});

    const other = app.defaultBundle();
    other.fileName = 'Case-2';
    other.pages.page2 = [segmentRow('R9', 'Other')];
    assert.strictEqual(await app.saveBundle(other), true);

    assert.deepStrictEqual(server.writes().map(r => `${r.method} ${r.path}`), [`PUT ${API}/bundle`, `PUT ${API}/Case-2`]);
    assert.strictEqual(server.writes()[0].keepalive, false);
    const record = outboxRecord(store, 'Case-2');
    assert.strictEqual(record.needsFullUpload, false);
    assert.deepStrictEqual(record.changes, []);
});

check('deleting a case also drops its queued rows', async () => {
    const store = seedStore();
    const server = createServer((req) => {
        if (req.method === 'DELETE') return {status: 200, body: {success: true}};
        return offline();
    });
    const app = createSandbox({store, fetch: server.fetch});

    const bundle = app.loadBundle();
    bundle.pages.page2[0][2] = 'x';
    await app.saveBundle(bundle);
    assert.strictEqual(outboxRecord(store).changes.length, 1);

    assert.strictEqual(await app.deleteCaseEverywhere('Case-1'), true);
    assert.strictEqual(outboxRecord(store), null, 'the outbox record of the deleted case is gone');
    assert.strictEqual(store[BUNDLE_KEY], undefined);
    assert.strictEqual(store[BUCKET_TAG_KEY], undefined);
});

// --- Run --------------------------------------------------------------------

(async () => {
    let passed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
        } catch (err) {
            console.log(`  FAIL - ${name}`);
            throw err;
        }
        passed++;
        console.log(`  ok - ${name}`);
    }
    console.log(`\nAll ${passed} checks passed.`);
})().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});

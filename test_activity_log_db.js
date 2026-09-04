// Regression tests: every activity-log entry is stored in the database, tied to
// the login username and the CASE #.
//
// 1. Website (the real app.js in a sandbox with a scripted fetch): an entry
//    written by addActivityLogEntry travels to POST /rows under the CASE # (the
//    file name) and the login (X-User-Name). An entry logged while another part
//    of the page still holds an older copy of the search file must survive that
//    copy being saved - promoteToTeamLead did exactly that (logged "reassigned",
//    then saved its stale copy) and the entry was erased again, locally and on
//    the server, before it ever reached the database.
// 2. Server (sync-server.js over an in-memory MySQL stand-in): each entry that
//    reaches the server - by row batch, seed or import - gets its own
//    activity_log_entries row keyed (username, search_case, entry_id); an edit
//    updates it, a removal stamps deletedAt, GET /:bucket/activity reads them
//    back, and deleting the case removes them.
//
// Run with: node test_activity_log_db.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool (installed before sync-server.js loads)
// ---------------------------------------------------------------------------
const dbStore = new Map();   // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const tables = new Map();    // table -> array of row objects
const singles = new Map();
const userBuckets = new Map();
const TEST_USER = {username: 'Team Alpha', pin: '2468', password: 'ignored'};

const tableRows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
};
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const query = (rawSql, params, cb) => {
    const sql = norm(rawSql);
    const p = params || [];
    let m;
    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        const ok = p[0] === TEST_USER.username && (p[1] === TEST_USER.password || p[2] === TEST_USER.pin);
        return cb(null, ok ? [{...TEST_USER}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        userBuckets.set(`${p[0]}\u0000${p[1]}`, {lastAccessed: p[2]});
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM user_buckets WHERE username = \? AND bucket = \?$/.test(sql)) {
        userBuckets.delete(`${p[0]}\u0000${p[1]}`);
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = dbStore.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin, updatedAt FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = dbStore.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{userPin: row.userPin, updatedAt: row.updatedAt}] : []);
    }
    if (/^SELECT userPin FROM store WHERE bucket = \? AND userName = \? AND userPin = \? LIMIT 1$/.test(sql)) {
        const hit = [...dbStore.entries()].find(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1] && v.userPin === p[2]);
        return cb(null, hit ? [{userPin: hit[1].userPin}] : []);
    }
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\)/.test(sql)) {
        dbStore.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        for (const [k, v] of [...dbStore.entries()]) {
            if (k.split('\u0000')[0] === p[0] && v.userName === p[1]) dbStore.delete(k);
        }
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \? AND row_index = \?$/))) {
        tables.set(m[1], tableRows(m[1]).filter(r => !(r.username === p[0] && r.search_case === p[1] && r.row_index === p[2])));
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        tables.set(m[1], tableRows(m[1]).filter(r => !(r.username === p[0] && r.search_case === p[1])));
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^INSERT INTO `(\w+)` \(username, search_case, row_index, label, data, updatedAt\)/))) {
        tableRows(m[1]).push({username: p[0], search_case: p[1], row_index: p[2], label: p[3], data: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1, insertId: 1});
    }
    if ((m = sql.match(/^REPLACE INTO `(\w+)` \(username, search_case, data, updatedAt\)/))) {
        singles.set(`${m[1]}\u0000${p[0]}\u0000${p[1]}`, {data: p[2], updatedAt: p[3]});
        return cb(null, {affectedRows: 1});
    }
    // ---- per-entry activity log (activity_log_entries) ----
    if (/^REPLACE INTO `activity_log_entries` \(username, search_case, entry_id,/.test(sql)) {
        const rows = tableRows('activity_log_entries');
        const kept = rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.entry_id === p[2]));
        kept.push({username: p[0], search_case: p[1], entry_id: p[2], user_handle: p[3], team: p[4], tag: p[5],
            members: p[6], action: p[7], log_date: p[8], log_time: p[9], logged_at: p[10], data: p[11], updatedAt: p[12], deletedAt: null});
        tables.set('activity_log_entries', kept);
        return cb(null, {affectedRows: 1});
    }
    if (/^UPDATE `activity_log_entries` SET deletedAt = \? WHERE username = \? AND search_case = \? AND entry_id = \? AND deletedAt IS NULL$/.test(sql)) {
        tableRows('activity_log_entries').forEach(r => {
            if (r.username === p[1] && r.search_case === p[2] && r.entry_id === p[3] && r.deletedAt === null) r.deletedAt = p[0];
        });
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^SELECT \* FROM `activity_log_entries` WHERE username = \? AND search_case = \?( AND deletedAt IS NULL)? ORDER BY logged_at DESC, entry_id DESC$/))) {
        let rows = tableRows('activity_log_entries').filter(r => r.username === p[0] && r.search_case === p[1]);
        if (m[1]) rows = rows.filter(r => r.deletedAt === null);
        rows = rows.slice().sort((a, b) => (b.logged_at - a.logged_at) || String(b.entry_id).localeCompare(String(a.entry_id)));
        return cb(null, rows.map(r => ({...r})));
    }
    return cb(new Error(`unhandled SQL in test stand-in: ${sql}`));
};

require.cache[require.resolve('mysql2')] = {
    id: require.resolve('mysql2'),
    filename: require.resolve('mysql2'),
    loaded: true,
    exports: {createPool: () => ({query})}
};

const server = require('./sync-server');
const {app: serverApp, activityEntryId, collectActivityEntryChanges} = server;

// ---------------------------------------------------------------------------
// Browser sandbox running the real app.js (see test_sync_outbox.js)
// ---------------------------------------------------------------------------
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const OUTBOX_KEY = 'sar-sync-outbox-v1';
const BUCKET_TAG_KEY = 'sar-bundle-bucket-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CASE = 'Case-1';
const LOGIN = 'tester';
const BUCKET = `${CASE}_${LOGIN}`;
const API = `/api/v1/${BUCKET}`;

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

function createSandbox({store, fetch, page = 'page3'}) {
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const cookieJar = {'sar-user-name-v1': LOGIN, 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = page;
    const document = {
        get cookie() { return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; '); },
        set cookie(value) {
            const [pair] = String(value).split(';');
            const idx = pair.indexOf('=');
            if (idx > 0) cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
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
        fetch: (url, init) => fetch(url, init),
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

// A scripted server that records every request (with its headers) and answers
// /rows with success, like the real one does for a valid batch.
function createRecorder() {
    const requests = [];
    const fetch = async (url, init = {}) => {
        const parsed = new URL(String(url));
        let json = null;
        try { json = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (e) { /* not JSON */ }
        const request = {path: parsed.pathname, method: String(init.method || 'GET').toUpperCase(), headers: init.headers || {}, json};
        requests.push(request);
        const ok = request.path === `${API}/rows` || request.path === `${API}/bundle`;
        const body = ok ? {success: true, applied: (json && json.changes && json.changes.length) || 0, lastModified: new Date().toISOString()} : {error: 'unexpected'};
        return {ok, status: ok ? 200 : 500, json: async () => body};
    };
    const rowChanges = () => requests.filter(r => r.path === `${API}/rows`).flatMap(r => (r.json && r.json.changes) || []);
    return {requests, fetch, rowChanges};
}

function seedStore(page = 'page3') {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const recorder = createRecorder();
    const app = createSandbox({store, fetch: recorder.fetch, page});
    const bundle = app.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.page2 = [['R1', 'Seg A', '100 ac', '2 mi', '40 ft', '4 hr', '', '', '', '']];
    bundle.pages.page3 = [
        ['Jane Doe', 'Alpha', 'Jane Doe', 'true', '', '', 'On-Scene', '', '', '', '', '', '', ''],
        ['John Roe', 'Alpha', 'Jane Doe', '', 'true', '', 'On-Scene', '', '', '', '', '', '', ''],
        ['Bob Lee', 'Bravo', 'Bob Lee', '', '', '', 'On-Scene', '', '', '', '', '', '', '']
    ];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
    store[BUCKET_TAG_KEY] = BUCKET;
    // A copy the server already holds: saves go as row batches, never whole files.
    store[OUTBOX_KEY] = JSON.stringify({[`${BUCKET}::${CASE}`]: {cursor: '', changes: [], inFlight: null, needsFullUpload: false}});
    return {store, app, recorder};
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const actionsOf = (app) => app.loadBundle().activityLog.map(e => e.action);

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const checks = [];
const check = (name, fn) => checks.push({name, fn});

// ---------------------------------------------------------------------------
// 1. Website: entries reach the server under the CASE # and the login
// ---------------------------------------------------------------------------
check('an activity-log entry is sent to /rows under the CASE # (fileName) and the login (X-User-Name)', async () => {
    const {app, recorder} = seedStore();
    const bundle = app.loadBundle();
    app.addActivityLogEntry('System', 'Imported segments: Seg A', bundle);
    await app.saveBundle(bundle);

    const rows = recorder.requests.filter(r => r.path === `${API}/rows`);
    assert.strictEqual(rows.length, 1, `one row batch expected, got ${JSON.stringify(recorder.requests.map(r => r.method + ' ' + r.path))}`);
    assert.strictEqual(rows[0].json.fileName, CASE, 'the batch names the CASE #');
    assert.strictEqual(rows[0].headers['X-User-Name'], LOGIN, 'the batch carries the login');
    const changes = plain(rows[0].json.changes);
    assert.strictEqual(changes.length, 1);
    assert.deepStrictEqual(changes[0].path, ['activityLog']);
    // A first entry into an empty log diffs as an append, later ones as a prepend.
    const added = changes[0].prepend || changes[0].append;
    assert.strictEqual(added.length, 1);
    const entry = added[0];
    assert.strictEqual(entry.action, 'Imported segments: Seg A');
    assert.strictEqual(entry.team, 'System');
    assert.ok(/^log-\d+-\d+$/.test(entry.id), `entry carries an id, got ${entry.id}`);
    assert.ok(Number.isFinite(entry.timestamp), 'entry carries a timestamp');
});

check('an entry logged while another caller holds an older copy survives that copy being saved', async () => {
    const {app, recorder} = seedStore();
    const stale = app.loadBundle();
    stale.pages.page2[0][2] = '120 ac';
    // Logged in between (a popup, another handler, a server poll ...):
    app.addActivityLogEntry('System', 'Logged in between');
    assert.ok(actionsOf(app).includes('Logged in between'));

    await app.saveBundle(stale);

    const after = app.loadBundle();
    assert.ok(after.activityLog.some(e => e.action === 'Logged in between'), 'the entry is still in the local copy');
    assert.strictEqual(after.pages.page2[0][2], '120 ac', "the caller's own edit is kept");
    const erased = recorder.rowChanges().filter(c => c.path[0] === 'activityLog' && c.deleted === true);
    assert.deepStrictEqual(plain(erased), [], 'no batch asks the server to delete the entry');
    const sent = recorder.rowChanges().filter(c => c.path[0] === 'activityLog' && (Array.isArray(c.prepend) || Array.isArray(c.append)));
    assert.strictEqual(sent.length, 1, 'the entry travelled exactly once');
});

check('an entry the caller removed on purpose stays removed', async () => {
    const {app} = seedStore();
    let bundle = app.loadBundle();
    app.addActivityLogEntry('System', 'To be removed', bundle);
    await app.saveBundle(bundle);

    bundle = app.loadBundle();
    bundle.activityLog.splice(bundle.activityLog.findIndex(e => e.action === 'To be removed'), 1);
    app.addActivityLogEntry('System', 'Another in between');
    await app.saveBundle(bundle);

    const actions = actionsOf(app);
    assert.ok(!actions.includes('To be removed'), 'the deliberate removal is respected');
    assert.ok(actions.includes('Another in between'), 'the entry logged in between is kept');
});

check('entries received from the server between a load and a save are kept', async () => {
    const {app, store} = seedStore();
    const stale = app.loadBundle();
    stale.pages.page2[0][2] = '130 ac';
    // Another device's entry arrives through the /state poll.
    const remote = {id: 'log-remote-1', date: '03-14-2026', time: '09:10', tag: 'base - Sam', team: 'Bravo', members: 'Bob Lee*', action: 'Leaving base for assignment', timestamp: Date.now()};
    app.applyServerSections({activityLog: [remote]}, new Date(Date.now() + 1000).toISOString(), {advanceCursor: true});
    assert.ok(JSON.parse(store[BUNDLE_KEY]).activityLog.some(e => e.id === 'log-remote-1'));

    await app.saveBundle(stale);
    assert.ok(app.loadBundle().activityLog.some(e => e.id === 'log-remote-1'), "the other device's entry is not wiped by the stale save");
});

check('promoteToTeamLead records both the move and the new lead', async () => {
    const {app} = seedStore('page3');
    app.promoteToTeamLead('John Roe', 'Bravo');
    const actions = actionsOf(app);
    assert.ok(actions.includes('John Roe reassigned from Alpha to Bravo'), `move entry missing: ${actions.join(' | ')}`);
    assert.ok(actions.includes('John Roe is now Team Lead (previously Bob Lee)'), `lead entry missing: ${actions.join(' | ')}`);
    const bundle = app.loadBundle();
    assert.strictEqual(bundle.pages.page3.find(r => r[0] === 'John Roe')[1], 'Bravo');
    assert.strictEqual(bundle.pages.page3.find(r => r[0] === 'Bob Lee')[2], 'John Roe');
});

// ---------------------------------------------------------------------------
// 2. Server: one activity_log_entries row per entry, tied to login and CASE #
// ---------------------------------------------------------------------------
const SERVER_BUCKET = 'CASE-77_Team Alpha';
const SERVER_CASE = 'CASE-77';
const authHeaders = {
    'Content-Type': 'application/json',
    'X-User-Name': TEST_USER.username,
    'X-User-Pin': TEST_USER.pin,
    'X-User-Password': TEST_USER.pin
};
let baseUrl = '';
const call = async (method, p, body) => {
    const resp = await fetch(`${baseUrl}${p}`, {method, headers: authHeaders, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: resp.status, body: await resp.json().catch(() => ({}))};
};
const entry = (n, extra = {}) => ({
    id: `log-${1000 + n}-${n}`, date: '09-04-2026', time: `13:0${n}`, tag: `base - Jane`, team: 'Alpha',
    members: 'Jane Doe*, John Roe', action: `Action ${n}`, timestamp: 1000 + n, ...extra
});
const entryRows = () => tableRows('activity_log_entries').filter(r => r.username === TEST_USER.username && r.search_case === SERVER_CASE);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

check('seeding a CASE # stores one row per activity-log entry, tied to the login and the CASE #', async () => {
    const resp = await call('PUT', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/bundle?seed=1`, {
        fileName: SERVER_CASE, lastModified: '2026-01-01T00:00:00.000Z',
        pages: {page2: [['R1', 'Seg A']]},
        activityLog: [entry(2), entry(1)]
    });
    assert.strictEqual(resp.status, 200);
    await wait(50); // the decompose after a whole-file upload is fire-and-forget
    const rows = entryRows();
    assert.deepStrictEqual(rows.map(r => r.entry_id).sort(), ['log-1001-1', 'log-1002-2']);
    rows.forEach(r => {
        assert.strictEqual(r.username, TEST_USER.username);
        assert.strictEqual(r.search_case, SERVER_CASE);
        assert.strictEqual(r.user_handle, 'Jane', 'the team member behind the entry is kept');
        assert.strictEqual(r.team, 'Alpha');
        assert.strictEqual(r.deletedAt, null);
    });
    assert.strictEqual(JSON.parse(rows.find(r => r.entry_id === 'log-1002-2').data).action, 'Action 2');
});

check('a row batch that adds an entry writes exactly that entry', async () => {
    const resp = await call('POST', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/rows`, {
        fileName: SERVER_CASE,
        changes: [{path: ['activityLog'], prepend: [entry(3)]}, {path: ['teamStatuses', 'Alpha'], value: 'en route'}]
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.body.applied, 2);
    const rows = entryRows();
    assert.strictEqual(rows.length, 3);
    const added = rows.find(r => r.entry_id === 'log-1003-3');
    assert.ok(added, 'the new entry has its row');
    assert.strictEqual(added.action, 'Action 3');
    assert.strictEqual(added.logged_at, 1003);
    assert.strictEqual(added.log_date, '09-04-2026');
    assert.strictEqual(added.log_time, '13:03');
});

check('a retried batch does not duplicate the entry', async () => {
    const body = {fileName: SERVER_CASE, batchId: 'batch-retry', changes: [{path: ['activityLog'], prepend: [entry(4)]}]};
    await call('POST', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/rows`, body);
    const again = await call('POST', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/rows`, body);
    assert.strictEqual(again.body.duplicate, true);
    assert.strictEqual(entryRows().filter(r => r.entry_id === 'log-1004-4').length, 1);
    assert.strictEqual(entryRows().length, 4);
});

check('editing an entry (timestamp edit) updates its row in place', async () => {
    const stored = JSON.parse(dbStore.get(`${SERVER_BUCKET}\u0000bundle`).value);
    const index = stored.activityLog.findIndex(e => e.id === 'log-1003-3');
    const previous = stored.activityLog[index];
    const edited = {...previous, time: '13:30', action: 'Action 3 (time corrected)'};
    const resp = await call('POST', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/rows`, {
        fileName: SERVER_CASE,
        changes: [{path: ['activityLog', String(index)], value: edited, previous}]
    });
    assert.strictEqual(resp.status, 200);
    const row = entryRows().find(r => r.entry_id === 'log-1003-3');
    assert.strictEqual(row.action, 'Action 3 (time corrected)');
    assert.strictEqual(row.log_time, '13:30');
    assert.strictEqual(entryRows().length, 4, 'an edit never adds a row');
});

check('removing an entry from the file keeps its row with deletedAt set', async () => {
    const stored = JSON.parse(dbStore.get(`${SERVER_BUCKET}\u0000bundle`).value);
    const index = stored.activityLog.findIndex(e => e.id === 'log-1001-1');
    const resp = await call('POST', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/rows`, {
        fileName: SERVER_CASE,
        changes: [{path: ['activityLog', String(index)], deleted: true, previous: stored.activityLog[index]}]
    });
    assert.strictEqual(resp.status, 200);
    const row = entryRows().find(r => r.entry_id === 'log-1001-1');
    assert.ok(row, 'the row is kept');
    assert.ok(row.deletedAt, 'and stamped as deleted');
    assert.strictEqual(JSON.parse(dbStore.get(`${SERVER_BUCKET}\u0000bundle`).value).activityLog.some(e => e.id === 'log-1001-1'), false);
});

check('GET /:bucket/activity reads the entries back for this login and CASE #, newest first', async () => {
    const resp = await call('GET', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/activity`);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.body.username, TEST_USER.username);
    assert.strictEqual(resp.body.searchCase, SERVER_CASE);
    assert.deepStrictEqual(resp.body.entries.map(e => e.entry_id), ['log-1004-4', 'log-1003-3', 'log-1002-2']);
    assert.strictEqual(resp.body.entries[1].data.action, 'Action 3 (time corrected)');
    const all = await call('GET', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}/activity?includeDeleted=1`);
    assert.deepStrictEqual(all.body.entries.map(e => e.entry_id), ['log-1004-4', 'log-1003-3', 'log-1002-2', 'log-1001-1']);
});

check('an entry without an id gets a stable derived id', () => {
    const noId = {date: '09-04-2026', time: '13:05', team: 'Alpha', action: 'Old entry', timestamp: 5};
    assert.strictEqual(activityEntryId(noId), activityEntryId({...noId}));
    assert.ok(activityEntryId(noId).startsWith('log-'));
    assert.notStrictEqual(activityEntryId(noId), activityEntryId({...noId, action: 'Other'}));
    assert.strictEqual(activityEntryId(entry(9)), 'log-1009-9');
});

check('collectActivityEntryChanges only looks at activity-log changes', () => {
    const bundle = {activityLog: [entry(1)]};
    const {upserts, deletions} = collectActivityEntryChanges(bundle, [
        {path: ['pages', 'page2', '0'], value: ['R1', 'Seg A']},
        {path: ['activityLog'], prepend: [entry(2)]},
        {path: ['activityLog', '0'], value: entry(1, {action: 'x'}), appliedIndex: 0},
        {path: ['activityLog', '5'], deleted: true, previous: entry(7)}
    ]);
    assert.deepStrictEqual(upserts.map(e => e.id), ['log-1002-2', 'log-1001-1']);
    assert.deepStrictEqual(deletions.map(e => e.id), ['log-1007-7']);
});

check('deleting the case removes its activity_log_entries rows too', async () => {
    const resp = await call('DELETE', `/api/v1/${encodeURIComponent(SERVER_BUCKET)}`);
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual(entryRows(), []);
});

// ---------------------------------------------------------------------------
const httpServer = http.createServer(serverApp);
httpServer.listen(0, '127.0.0.1', async () => {
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(`    ${(err && err.stack || err).toString().split('\n').slice(0, 6).join('\n    ')}`);
        }
    }
    httpServer.close();
    console.log(failed ? `\n${failed} of ${checks.length} checks failed.` : `\nAll ${checks.length} activity-log database checks passed.`);
    process.exitCode = failed ? 1 : 0;
});

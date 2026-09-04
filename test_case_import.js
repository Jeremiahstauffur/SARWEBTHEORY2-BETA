// End-to-end test of importing a case (.json) file from the home page.
//
// The bug: importing an exported case file left the account with a case that
// showed only a single (blank) segment - the whole file never made it into the
// database as one piece. The import must create the complete case on the
// server, stored under the importing login's own bucket (CASE # + username) and
// mirrored into the structured tables tagged with that username + CASE #, and
// the page must show every imported row after the reload.
//
// The real app.js runs in a sandbox (fake DOM/localStorage/FileReader) and
// talks over HTTP to the real sync-server.js, whose MySQL pool is replaced by
// an in-memory stand-in.
//
// Run with: node test_case_import.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool, installed before sync-server.js loads.
// ---------------------------------------------------------------------------
const USERS = [
    {username: 'tester', pin: '1234'},
    {username: 'other', pin: '1234'}
];
const store = new Map();        // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const userBuckets = new Map();  // "username\u0000bucket" -> {lastAccessed}
const userSettings = new Map(); // username -> settings json
const tables = new Map();       // table -> array of row objects
const singles = new Map();      // "table\u0000username\u0000case" -> row

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
        const u = USERS.find(x => x.username === p[0] && (x.password === p[1] || x.pin === p[2]));
        return cb(null, u ? [{...u}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        userBuckets.set(`${p[0]}\u0000${p[1]}`, {lastAccessed: p[2]});
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT bucket, lastAccessed FROM user_buckets WHERE username = \?/.test(sql)) {
        const rows = [...userBuckets.entries()]
            .filter(([k]) => k.split('\u0000')[0] === p[0])
            .map(([k, v]) => ({bucket: k.split('\u0000')[1], lastAccessed: v.lastAccessed}));
        return cb(null, rows);
    }
    if (/^SELECT settings FROM user_settings WHERE username = \?$/.test(sql)) {
        return cb(null, userSettings.has(p[0]) ? [{settings: userSettings.get(p[0])}] : []);
    }
    if (/^REPLACE INTO user_settings/.test(sql)) {
        userSettings.set(p[0], p[1]);
        return cb(null, {affectedRows: 1});
    }

    // ---- store ----
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin, updatedAt FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{userPin: row.userPin, updatedAt: row.updatedAt}] : []);
    }
    if (/^SELECT value FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value}] : []);
    }
    if (/^SELECT `key`, updatedAt FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        const rows = [...store.entries()]
            .filter(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1])
            .map(([k, v]) => ({key: k.split('\u0000')[1], updatedAt: v.updatedAt}));
        return cb(null, rows);
    }
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\)/.test(sql)) {
        store.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }

    // ---- structured tables ----
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \? AND row_index = \?$/))) {
        const rows = tableRows(m[1]);
        tables.set(m[1], rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.row_index === p[2])));
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        const rows = tableRows(m[1]);
        tables.set(m[1], rows.filter(r => !(r.username === p[0] && r.search_case === p[1])));
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

    return cb(new Error(`unhandled SQL in test stand-in: ${sql}`));
};

require.cache[require.resolve('mysql2')] = {
    id: require.resolve('mysql2'),
    filename: require.resolve('mysql2'),
    loaded: true,
    exports: {createPool: () => ({query})}
};

const {app} = require('./sync-server');

// ---------------------------------------------------------------------------
// Browser sandbox running the real app.js (see test_sync_outbox.js)
// ---------------------------------------------------------------------------
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const BUCKET_TAG_KEY = 'sar-bundle-bucket-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const USER = 'tester';

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
        click() {},
        textContent: '',
        innerHTML: ''
    };
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

function createSandbox({store: local, baseUrl, page = 'home'}) {
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null),
        setItem: (k, v) => { local[k] = String(v); },
        removeItem: (k) => { delete local[k]; }
    };
    const cookieJar = {
        'sar-user-name-v1': USER,
        'sar-user-password-v1': '1234',
        'sar-sync-url-local-v1': baseUrl
    };
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
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {}
    };

    const reloads = [];
    const alerts = [];
    const logs = {warn: [], error: []};
    // A FileReader that hands the file's text straight to onload.
    class FileReader {
        readAsText(file) {
            Promise.resolve().then(() => this.onload && this.onload({target: {result: file.text}}));
        }
    }
    const sandbox = {
        console: {
            log() {},
            info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        setTimeout: (fn, ms) => { if (ms <= 100) { setTimeout(fn, 0); } return 1; },
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
        alert: (msg) => alerts.push(String(msg)),
        confirm: () => true,
        FormData: class FormData {},
        FileReader,
        location: {
            hostname: 'localhost', protocol: 'http:', origin: 'http://localhost',
            href: `http://localhost/${page}.html`, search: '',
            reload: () => reloads.push(Date.now())
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__byId = byId;
    sandbox.__listeners = listeners;
    sandbox.__reloads = reloads;
    sandbox.__alerts = alerts;
    sandbox.__logs = logs;
    return sandbox;
}

async function fireDomReady(app) {
    const handlers = app.__listeners.DOMContentLoaded || [];
    assert.strictEqual(handlers.length, 1, 'app.js registers one DOMContentLoaded handler');
    await handlers[0]();
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const segmentRow = (region, name) => [region, name, '', '', '', '', '', '', '', ''];
const waitFor = async (predicate, what, ms = 5000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

// Drive the home page's Import button with a file whose contents are `text`.
async function importFile(app, text) {
    const input = app.__byId['import-search-input'];
    assert.strictEqual(typeof input.onchange, 'function', 'the import input must be wired up');
    input.onchange({target: {files: [{name: 'case.json', text}]}});
    await waitFor(() => app.__reloads.length > 0 || app.__alerts.length > 0, 'the import to finish');
}

// The case file a user exports from the Saved Cases table: a plain bundle.
function exportedCase(scratch, caseNumber, segmentCount) {
    const bundle = scratch.defaultBundle();
    bundle.fileName = caseNumber;
    bundle.pages.index.rows = [['North', '', ''], ['South', '', '']];
    bundle.pages.page2 = Array.from({length: segmentCount}, (_, i) => segmentRow(i % 2 ? 'South' : 'North', `Seg ${i + 1}`));
    bundle.pages.page3 = [['Alex', 'Team 1', 'Alex', '', '', '', 'true', '', '', '', '', '', '', '']];
    bundle.profile = {incidentName: `Incident ${caseNumber}`};
    return scratch.sanitizeBundle(bundle);
}

const storedBundle = (bucket) => {
    const row = store.get(`${bucket}\u0000bundle`);
    return row ? {...row, bundle: JSON.parse(row.value)} : null;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let baseUrl = '';
let passed = 0;

const run = async () => {
    const check = async (name, fn) => {
        await fn();
        passed++;
        console.log(`  ok - ${name}`);
    };

    const scratch = createSandbox({store: {}, baseUrl});
    const suffix = encodeURIComponent(USER);

    // The account already works on Case-1 (one segment), on this device and on
    // the server.
    const local = {};
    {
        userSettings.set(USER, JSON.stringify({'sar-sync-bucket-v1': 'Case-1'}));
        const current = exportedCase(scratch, 'Case-1', 1);
        store.set(`Case-1_${suffix}\u0000bundle`, {
            value: JSON.stringify(current), userName: USER, userPin: '1234', updatedAt: current.lastModified
        });
        local[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-1'});
        local[BUNDLE_KEY] = JSON.stringify(current);
        local[BUCKET_TAG_KEY] = `Case-1_${suffix}`;
    }

    const imported = exportedCase(scratch, 'Case-2', 6);
    imported.lastModified = '2025-06-01T12:00:00.000Z'; // exported a while ago

    console.log('Importing a case file on the home page');

    await check('the whole case lands in the database under the importing login', async () => {
        const home = createSandbox({store: local, baseUrl});
        await fireDomReady(home);
        await importFile(home, JSON.stringify(imported, null, 2));
        assert.deepStrictEqual(home.__alerts, [], 'the import must not fail');
        assert.strictEqual(home.__reloads.length, 1, 'the page reloads once the import is stored');

        const row = storedBundle(`Case-2_${suffix}`);
        assert.ok(row, 'the imported case must be stored under "<CASE #>_<username>"');
        assert.strictEqual(row.userName, USER, 'the stored file is owned by the importing login');
        assert.strictEqual(row.bundle.fileName, 'Case-2');
        assert.deepStrictEqual(row.bundle.pages.page2.map(r => r[1]), ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5', 'Seg 6'],
            'every imported segment must be stored');
        assert.deepStrictEqual(row.bundle.pages.index.rows.map(r => r[0]), ['North', 'South']);
        assert.strictEqual(row.bundle.profile.incidentName, 'Incident Case-2');
        assert.ok(row.bundle.lastModified > imported.lastModified, 'the stored copy is stamped with server time');
    });

    await check('the case is tied to the account: history + structured tables carry username and CASE #', async () => {
        assert.ok(userBuckets.has(`${USER}\u0000Case-2_${suffix}`), 'the CASE # must appear in this login\'s case history');
        const segments = tableRows('segments').filter(r => r.username === USER && r.search_case === 'Case-2');
        assert.strictEqual(segments.length, 6, `expected 6 segment rows for (${USER}, Case-2), got ${segments.length}`);
        assert.deepStrictEqual(segments.map(r => r.row_index).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
        const regions = tableRows('regions').filter(r => r.username === USER && r.search_case === 'Case-2');
        assert.strictEqual(regions.length, 2);
        const personnel = tableRows('personnel').filter(r => r.username === USER && r.search_case === 'Case-2');
        assert.strictEqual(personnel.length, 1);
        assert.ok(singles.has(`profile\u0000${USER}\u0000Case-2`), 'the profile record is keyed by username + CASE #');
        assert.strictEqual(tableRows('segments').filter(r => r.username !== USER).length, 0, 'nothing is written for another login');
    });

    await check('the imported CASE # becomes the account\'s active case', async () => {
        const settings = JSON.parse(userSettings.get(USER));
        assert.strictEqual(settings['sar-sync-bucket-v1'], 'Case-2');
        assert.strictEqual(local[BUCKET_TAG_KEY], `Case-2_${suffix}`, 'the local copy is tagged with the imported case');
    });

    await check('after the reload every imported segment is on screen', async () => {
        const reloaded = createSandbox({store: local, baseUrl});
        await fireDomReady(reloaded);
        const bundle = plain(reloaded.loadBundle());
        assert.strictEqual(bundle.fileName, 'Case-2');
        assert.deepStrictEqual(bundle.pages.page2.map(r => r[1]), ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5', 'Seg 6']);
        assert.deepStrictEqual(bundle.pages.index.rows.map(r => r[0]), ['North', 'South']);

        // And the server copy was not damaged by the reload.
        const row = storedBundle(`Case-2_${suffix}`);
        assert.strictEqual(row.bundle.pages.page2.length, 6);
    });

    await check('Case-1 is left exactly as it was', async () => {
        const row = storedBundle(`Case-1_${suffix}`);
        assert.strictEqual(row.bundle.pages.page2.length, 1);
        assert.strictEqual(row.bundle.fileName, 'Case-1');
    });

    console.log('\nRe-importing a backup of a case that already exists');

    await check('a re-import replaces the stored case with the file\'s contents', async () => {
        // Somebody wiped most of Case-2 on the server; the user restores it
        // from the exported file, while Case-2 is the active case.
        const damaged = plain(storedBundle(`Case-2_${suffix}`).bundle);
        damaged.pages.page2 = [segmentRow('North', 'Seg 1')];
        damaged.lastModified = new Date(Date.now() + 60000).toISOString(); // even "newer" than the client clock
        store.set(`Case-2_${suffix}\u0000bundle`, {
            value: JSON.stringify(damaged), userName: USER, userPin: '1234', updatedAt: damaged.lastModified
        });
        local[BUNDLE_KEY] = JSON.stringify(damaged);

        const home = createSandbox({store: local, baseUrl});
        await fireDomReady(home);
        assert.strictEqual(plain(home.loadBundle()).pages.page2.length, 1, 'precondition: the damaged copy is what the device has');

        await importFile(home, JSON.stringify(imported));
        assert.deepStrictEqual(home.__alerts, [], 'the import must not fail');
        assert.strictEqual(home.__reloads.length, 1);

        const row = storedBundle(`Case-2_${suffix}`);
        assert.deepStrictEqual(row.bundle.pages.page2.map(r => r[1]), ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5', 'Seg 6'],
            'the imported file must win over the stored copy');
        const segments = tableRows('segments').filter(r => r.username === USER && r.search_case === 'Case-2');
        assert.strictEqual(segments.length, 6);

        const reloaded = createSandbox({store: local, baseUrl});
        await fireDomReady(reloaded);
        assert.deepStrictEqual(plain(reloaded.loadBundle()).pages.page2.map(r => r[1]),
            ['Seg 1', 'Seg 2', 'Seg 3', 'Seg 4', 'Seg 5', 'Seg 6']);
    });

    console.log('\nImporting a file named with a .json suffix');

    await check('"<CASE #>.json" is imported as CASE # without the suffix', async () => {
        const withSuffix = exportedCase(scratch, 'Case-3.json', 3);
        const home = createSandbox({store: local, baseUrl});
        await fireDomReady(home);
        await importFile(home, JSON.stringify(withSuffix));
        assert.deepStrictEqual(home.__alerts, []);

        const row = storedBundle(`Case-3_${suffix}`);
        assert.ok(row, 'the bucket is built from the clean CASE #');
        assert.strictEqual(row.bundle.fileName, 'Case-3', 'the file name inside the case is the clean CASE #');
        assert.strictEqual(row.bundle.pages.page2.length, 3);
        assert.strictEqual(tableRows('segments').filter(r => r.username === USER && r.search_case === 'Case-3').length, 3,
            'structured rows are tagged with the clean CASE #');
        assert.strictEqual(JSON.parse(userSettings.get(USER))['sar-sync-bucket-v1'], 'Case-3');
    });

    console.log('\nBad input');

    await check('a file without pages is refused and nothing is written', async () => {
        const home = createSandbox({store: local, baseUrl});
        await fireDomReady(home);
        await importFile(home, JSON.stringify({fileName: 'Case-9'}));
        assert.strictEqual(home.__reloads.length, 0, 'no reload on a refused file');
        assert.strictEqual(home.__alerts.length, 1);
        assert.strictEqual(storedBundle(`Case-9_${suffix}`), null, 'nothing is stored for the refused file');
        assert.strictEqual(JSON.parse(userSettings.get(USER))['sar-sync-bucket-v1'], 'Case-3', 'the active case is unchanged');
    });

    await check('when the server cannot be reached nothing changes and the user is told', async () => {
        const dead = http.createServer(() => {});
        await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
        const deadUrl = `http://127.0.0.1:${dead.address().port}`;
        dead.close();

        const home = createSandbox({store: local, baseUrl: deadUrl});
        await fireDomReady(home);
        const localBefore = JSON.stringify(local);
        await importFile(home, JSON.stringify(exportedCase(scratch, 'Case-4', 2)));
        assert.strictEqual(home.__reloads.length, 0, 'no reload when the import did not land');
        assert.strictEqual(home.__alerts.length, 1);
        assert.ok(/could not reach the server/i.test(home.__alerts[0]), home.__alerts[0]);
        assert.strictEqual(storedBundle(`Case-4_${suffix}`), null);
        assert.strictEqual(local[BUCKET_TAG_KEY], `Case-3_${suffix}`, 'the device stays on its current case');
        assert.strictEqual(JSON.parse(local[BUNDLE_KEY]).fileName, 'Case-3');
        assert.strictEqual(JSON.stringify(local), localBefore, 'nothing local was touched');
    });

    await check('a file that is not JSON is refused', async () => {
        const home = createSandbox({store: local, baseUrl});
        await fireDomReady(home);
        await importFile(home, 'not json at all');
        assert.strictEqual(home.__reloads.length, 0);
        assert.strictEqual(home.__alerts.length, 1);
    });

    console.log(`\nAll ${passed} case-import checks passed.`);
};

const server = http.createServer(app);
server.listen(0, '127.0.0.1', async () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run();
        server.close();
    } catch (err) {
        server.close();
        console.error(err);
        process.exitCode = 1;
    }
});

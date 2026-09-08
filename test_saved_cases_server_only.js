// End-to-end test of the home page's Saved Cases table against the real
// sync-server.js: every case lives ONLY in the database.
//
// The bugs this covers:
//   * the Saved Cases table listed the website's own bookkeeping rows
//     ("bundle", "all-files", "user-1967", "user-Finders3!", ...) and the old
//     stand-in file name ("us-pill-data.json") as if they were cases, and a
//     copy of every case was kept on the computer (localStorage);
//   * a case whose search file could not be loaded could not be deleted
//     either, because Delete needed a loadable local copy;
//   * the table could show another login's cases from the on-device cache.
//
// Now the table is read from /api/auth/history (this login's cases only, with
// the server-computed row counts), Delete clears every database row tied to
// (username, CASE #) without loading the case - also for a defective one - and
// nothing is ever written to localStorage.
//
// The real app.js runs in a sandbox (fake DOM, its in-memory store handed in
// as window.SAR_MEMORY_STORAGE, localStorage a tripwire it must never touch)
// and talks over HTTP to the real sync-server.js, whose MySQL pool is replaced
// by an in-memory stand-in.
//
// Run with: node test_saved_cases_server_only.js

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
            .map(([k, v]) => ({bucket: k.split('\u0000')[1], lastAccessed: v.lastAccessed}))
            .sort((a, b) => String(b.lastAccessed).localeCompare(String(a.lastAccessed)));
        return cb(null, rows);
    }
    if (/^DELETE FROM user_buckets WHERE username = \? AND bucket = \?$/.test(sql)) {
        userBuckets.delete(`${p[0]}\u0000${p[1]}`);
        return cb(null, {affectedRows: 1});
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
    if (/^SELECT userPin FROM store WHERE bucket = \? AND userName = \? AND userPin = \? LIMIT 1$/.test(sql)) {
        const hit = [...store.entries()].find(([k, v]) =>
            k.split('\u0000')[0] === p[0] && v.userName === p[1] && v.userPin === p[2]);
        return cb(null, hit ? [{userPin: hit[1].userPin}] : []);
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
    if (/^DELETE FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        for (const [k, v] of [...store.entries()]) {
            if (k.split('\u0000')[0] === p[0] && v.userName === p[1]) store.delete(k);
        }
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
        for (const key of [...singles.keys()]) {
            const [table, username, searchCase] = key.split('\u0000');
            if (table === m[1] && username === p[0] && searchCase === p[1]) singles.delete(key);
        }
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
        kept.push({username: p[0], search_case: p[1], entry_id: p[2], data: p[11], updatedAt: p[12], deletedAt: null});
        tables.set('activity_log_entries', kept);
        return cb(null, {affectedRows: 1});
    }
    if (/^UPDATE `activity_log_entries` SET deletedAt = \?/.test(sql)) {
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

const {app, STRUCTURED_TABLES} = require('./sync-server');

// ---------------------------------------------------------------------------
// Browser sandbox running the real app.js (see test_sync_outbox.js)
// ---------------------------------------------------------------------------
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const homeHtml = fs.readFileSync(path.join(__dirname, 'home.html'), 'utf8');

const USER = 'tester';
const SUFFIX = encodeURIComponent(USER);

function makeElement(tag = 'div', depth = 0) {
    const el = {
        tagName: tag.toUpperCase(),
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
        _innerHTML: '',
        disabled: false
    };
    // Setting innerHTML empties the element like a browser would.
    Object.defineProperty(el, 'innerHTML', {
        get: () => el._innerHTML,
        set: (value) => { el._innerHTML = String(value); el.children = []; }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement('div', depth + 1)))
    });
    return el;
}

const localStorageAccess = [];
function createSandbox({store: local, baseUrl, page = 'home'}) {
    const localStorage = {
        getItem: (k) => { localStorageAccess.push(`getItem ${k}`); return null; },
        setItem: (k) => { localStorageAccess.push(`setItem ${k}`); },
        removeItem: () => {}
    };
    const sessionData = {};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
    };
    const cookieJar = {
        'sar-user-name-v1': USER,
        'sar-user-password-v1': '1234',
        'sar-sync-url-local-v1': baseUrl
    };
    const byId = {};
    const body = makeElement('body');
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
        documentElement: makeElement('html'),
        head: makeElement('head'),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        createElement: (tag) => makeElement(tag),
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent() { return true; }
    };

    const reloads = [];
    const alerts = [];
    const confirms = [];
    const downloads = [];
    const logs = {warn: [], error: []};
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
        sessionStorage,
        SAR_MEMORY_STORAGE: local,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: (url, init) => fetch(url, init),
        alert: (msg) => alerts.push(String(msg)),
        confirm: (msg) => { confirms.push(String(msg)); return true; },
        FormData: class FormData {},
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        Blob: class Blob { constructor(parts) { this.text = parts.join(''); } },
        URL: {createObjectURL: (blob) => { downloads.push(blob.text); return 'blob:x'; }, revokeObjectURL() {}},
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
    sandbox.__session = sessionData;
    sandbox.__listeners = listeners;
    sandbox.__reloads = reloads;
    sandbox.__alerts = alerts;
    sandbox.__confirms = confirms;
    sandbox.__downloads = downloads;
    sandbox.__logs = logs;
    return sandbox;
}

async function fireDomReady(app) {
    const handlers = app.__listeners.DOMContentLoaded || [];
    assert.strictEqual(handlers.length, 1, 'app.js registers one DOMContentLoaded handler');
    await handlers[0]();
}

const segmentRow = (region, name) => [region, name, '', '', '', '', '', '', '', ''];
const waitFor = async (predicate, what, ms = 5000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

// The rows of the Saved Cases table as {caseNumber, cells, buttons}.
function savedCaseRows(app) {
    const tbody = app.__byId['saved-files-body'];
    return tbody.children.map((tr) => {
        const tds = tr.children;
        const buttons = [];
        const collect = (el) => {
            if (!el) return;
            if (el.tagName === 'BUTTON') buttons.push(el);
            (el.children || []).forEach(collect);
        };
        collect(tds[tds.length - 1]);
        return {
            caseNumber: tds[0] ? tds[0].textContent : '',
            note: tds[0] && tds[0].children[0] ? tds[0].children[0].textContent : '',
            cells: tds.slice(1, 5).map(td => td.textContent),
            buttons: Object.fromEntries(buttons.map(b => [b.textContent, b]))
        };
    });
}

async function renderedSavedCases(app) {
    const tbody = app.__byId['saved-files-body'];
    await waitFor(() => tbody.children.length > 0 || /No saved cases/.test(tbody.innerHTML), 'the Saved Cases table');
    return savedCaseRows(app);
}

function caseFile(scratch, caseNumber, segmentCount) {
    const bundle = scratch.defaultBundle();
    bundle.fileName = caseNumber;
    bundle.pages.index.rows = [['North', '', ''], ['South', '', '']];
    bundle.pages.page2 = Array.from({length: segmentCount}, (_, i) => segmentRow(i % 2 ? 'South' : 'North', `Seg ${i + 1}`));
    bundle.pages.page3 = [['Alex', 'Team 1', 'Alex', '', '', '', 'true', '', '', '', '', '', '', '']];
    bundle.pages.page4 = [['Task 1', '', '', '', '', '', '', '', '', '']];
    return scratch.sanitizeBundle(bundle);
}

const now = () => new Date().toISOString();

// Seed a case the way the server stores one: the file under the bucket, a
// Saved Cases row, and the structured rows for (username, CASE #).
function seedCase(userName, caseNumber, bundle, {lastAccessed = now()} = {}) {
    const bucket = `${caseNumber}_${encodeURIComponent(userName)}`;
    store.set(`${bucket}\u0000bundle`, {value: JSON.stringify(bundle), userName, userPin: '1234', updatedAt: bundle.lastModified});
    userBuckets.set(`${userName}\u0000${bucket}`, {lastAccessed});
    tableRows('regions').push({username: userName, search_case: caseNumber, row_index: 0, label: 'North', data: '["North"]', updatedAt: now()});
    tableRows('segments').push({username: userName, search_case: caseNumber, row_index: 0, label: 'Seg 1', data: '[]', updatedAt: now()});
    singles.set(`profile\u0000${userName}\u0000${caseNumber}`, {data: '{}', updatedAt: now()});
    tableRows('activity_log_entries').push({username: userName, search_case: caseNumber, entry_id: 'log-1', data: '{}', updatedAt: now(), deletedAt: null});
    return bucket;
}

const structuredRowsFor = (userName, caseNumber) =>
    STRUCTURED_TABLES.reduce((n, t) => n + tableRows(t).filter(r => r.username === userName && r.search_case === caseNumber).length, 0)
    + [...singles.keys()].filter(k => k.split('\u0000')[1] === userName && k.split('\u0000')[2] === caseNumber).length
    + tableRows('activity_log_entries').filter(r => r.username === userName && r.search_case === caseNumber).length;

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

    console.log('The home page');

    await check('the case pill on the home page reads "Current Case #" and no page shows the old stand-in file name', () => {
        assert.ok(/<label for="bundle-file-name"[^>]*>Current Case #<\/label>/.test(homeHtml), 'the label must read "Current Case #"');
        assert.ok(!/us-pill-data/.test(homeHtml), 'home.html must not mention us-pill-data');
        assert.ok(!/us-pill-data/.test(appSource), 'app.js must not mention us-pill-data');
        fs.readdirSync(__dirname).filter(f => /\.html$/.test(f)).forEach((file) => {
            const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
            assert.ok(!/us-pill-data/.test(html), `${file} must not mention us-pill-data`);
            assert.ok(!/localStorage/.test(html), `${file} must not read localStorage`);
        });
    });

    // This login has two real cases on the server, one defective case (a
    // Saved Cases row whose search file is unreadable) and a handful of the
    // bookkeeping rows an older build registered as "cases". Another login has
    // cases of their own.
    userSettings.set(USER, JSON.stringify({'sar-sync-bucket-v1': 'Case-1'}));
    seedCase(USER, 'Case-1', caseFile(scratch, 'Case-1', 1), {lastAccessed: '2026-03-01T10:00:00.000Z'});
    seedCase(USER, 'Case-2', caseFile(scratch, 'Case-2', 6), {lastAccessed: '2026-03-02T10:00:00.000Z'});
    store.set(`Broken_${SUFFIX}\u0000bundle`, {value: '{not json at all', userName: USER, userPin: '1234', updatedAt: now()});
    userBuckets.set(`${USER}\u0000Broken_${SUFFIX}`, {lastAccessed: '2026-03-03T10:00:00.000Z'});
    tableRows('segments').push({username: USER, search_case: 'Broken', row_index: 0, label: 'x', data: '[]', updatedAt: now()});
    ['bundle', 'all-files', 'user-1967', 'user-Finders3!', 'user-1400', `bundle_${SUFFIX}`, `user-1400_${SUFFIX}`, 'us-pill-data.json']
        .forEach((b) => userBuckets.set(`${USER}\u0000${b}`, {lastAccessed: now()}));
    seedCase('other', 'Other-1', caseFile(scratch, 'Other-1', 2));
    seedCase('other', 'Case-1', caseFile(scratch, 'Case-1', 9)); // same CASE # as ours, another login

    console.log('\nSaved Cases: this login\'s cases only, straight from the server');

    let home;
    await check('the table lists exactly this login\'s cases with the server\'s row counts', async () => {
        home = createSandbox({store: {}, baseUrl});
        await fireDomReady(home);
        const rows = await renderedSavedCases(home);
        assert.deepStrictEqual(rows.map(r => r.caseNumber), ['Broken', 'Case-2', 'Case-1'], 'newest first, and only real cases');
        const case2 = rows.find(r => r.caseNumber === 'Case-2');
        assert.deepStrictEqual(case2.cells, ['2', '6', '1', '1'], 'Regions / Segments / Personnel / Tasks come from the server');
        assert.deepStrictEqual(Object.keys(case2.buttons).sort(), ['Delete', 'Edit', 'Export', 'Load']);
        const broken = rows.find(r => r.caseNumber === 'Broken');
        assert.strictEqual(broken.note, 'No search file stored for this case');
        assert.deepStrictEqual(broken.cells, ['\u2014', '\u2014', '\u2014', '\u2014']);
        assert.strictEqual(rows.find(r => r.caseNumber === 'Case-1').buttons.Reload && rows.find(r => r.caseNumber === 'Case-1').buttons.Reload.textContent, 'Reload', 'the open case offers Reload');
    });

    await check('the bookkeeping names never show as cases and another login\'s cases are never listed', async () => {
        const rows = savedCaseRows(home).map(r => r.caseNumber);
        ['bundle', 'all-files', 'user-1967', 'user-Finders3!', 'user-1400', 'us-pill-data.json', 'us-pill-data', 'Other-1']
            .forEach(name => assert.ok(!rows.includes(name), `"${name}" must not be listed`));
        // Our Case-1 shows OUR counts (1 segment), never the other login's 9.
        const case1 = savedCaseRows(home).find(r => r.caseNumber === 'Case-1');
        assert.deepStrictEqual(case1.cells, ['2', '1', '1', '1']);
    });

    await check('the Current Case # pill shows the open case and nothing is kept on the device', () => {
        assert.strictEqual(home.__byId['bundle-file-name'].value, 'Case-1');
        assert.strictEqual(home.loadBundle().fileName, 'Case-1', 'the open case was read from the server');
        assert.deepStrictEqual(localStorageAccess, [], `localStorage must never be read or written: ${localStorageAccess.join(', ')}`);
    });

    console.log('\nDelete works on any listed case, loaded or not');

    await check('Delete asks who is at the keyboard when pressed, not when the table was drawn', async () => {
        // The table is drawn while the profile popup is still open. Answering
        // the popup afterwards (setCurrentUser) must be enough for Delete to
        // work - the old table froze the permission at draw time and refused.
        delete home.__session['sar-current-user'];
        assert.strictEqual(home.getCurrentUser(), null, 'precondition: no profile picked yet');
        savedCaseRows(home).find(r => r.caseNumber === 'Case-2').buttons.Delete.onclick();
        await new Promise(r => setTimeout(r, 50));
        assert.match(home.__alerts[0] || '', /permission/, 'without a profile the delete is refused');
        assert.ok(userBuckets.has(`${USER}\u0000Case-2_${SUFFIX}`), 'and nothing was deleted');
        home.__alerts.length = 0;
        home.setCurrentUser({username: USER, pin: '1234'});
    });

    await check('a case that is not open is deleted from the database without loading it', async () => {
        const before = savedCaseRows(home);
        assert.strictEqual(structuredRowsFor(USER, 'Case-2') > 0, true, 'precondition: Case-2 has structured rows');
        before.find(r => r.caseNumber === 'Case-2').buttons.Delete.onclick();
        await waitFor(() => !userBuckets.has(`${USER}\u0000Case-2_${SUFFIX}`), 'the delete to reach the server');
        assert.match(home.__confirms[0] || '', /every row stored for it on the server/, 'the user confirms a server-wide delete');
        await waitFor(() => !savedCaseRows(home).some(r => r.caseNumber === 'Case-2'), 'the table to refresh');
        assert.deepStrictEqual(home.__alerts, [], 'no error is shown');
        assert.ok(!store.has(`Case-2_${SUFFIX}\u0000bundle`), 'the search file is gone');
        assert.strictEqual(structuredRowsFor(USER, 'Case-2'), 0, 'every structured row tied to (tester, Case-2) is gone');
        assert.ok(store.has(`Case-1_${SUFFIX}\u0000bundle`), 'the open case is untouched');
        assert.strictEqual(home.loadBundle().fileName, 'Case-1', 'the open case stays open');
        assert.strictEqual(structuredRowsFor('other', 'Case-1'), 4, 'the other login\'s rows are untouched');
    });

    await check('a defective case (unreadable search file) can be deleted just the same', async () => {
        savedCaseRows(home).find(r => r.caseNumber === 'Broken').buttons.Delete.onclick();
        await waitFor(() => !userBuckets.has(`${USER}\u0000Broken_${SUFFIX}`), 'the delete to reach the server');
        await waitFor(() => !savedCaseRows(home).some(r => r.caseNumber === 'Broken'), 'the table to refresh');
        assert.deepStrictEqual(home.__alerts, [], 'no error is shown');
        assert.ok(!store.has(`Broken_${SUFFIX}\u0000bundle`), 'the unreadable file is gone');
        assert.strictEqual(structuredRowsFor(USER, 'Broken'), 0, 'its structured rows are gone');
        assert.deepStrictEqual(savedCaseRows(home).map(r => r.caseNumber), ['Case-1']);
    });

    await check('a refused delete leaves the case in place and tells the user why', async () => {
        // A case written by the Super-Admin (PIN 1976) may not be deleted by a
        // regular user.
        const protectedFile = caseFile(scratch, 'Protected', 1);
        store.set(`Protected_${SUFFIX}\u0000bundle`, {value: JSON.stringify(protectedFile), userName: USER, userPin: '1976', updatedAt: now()});
        userBuckets.set(`${USER}\u0000Protected_${SUFFIX}`, {lastAccessed: now()});
        home.buildSavedFilesTable();
        await waitFor(() => savedCaseRows(home).some(r => r.caseNumber === 'Protected'), 'the table to show Protected');
        savedCaseRows(home).find(r => r.caseNumber === 'Protected').buttons.Delete.onclick();
        await waitFor(() => home.__alerts.length > 0, 'the refusal');
        assert.match(home.__alerts[0], /Super-Admin/);
        assert.ok(userBuckets.has(`${USER}\u0000Protected_${SUFFIX}`), 'the case is still listed on the server');
        home.__alerts.length = 0;
        userBuckets.delete(`${USER}\u0000Protected_${SUFFIX}`);
        store.delete(`Protected_${SUFFIX}\u0000bundle`);
    });

    await check('deleting the open case resets the page to "no case" and forgets its memory copy', async () => {
        home.buildSavedFilesTable();
        await waitFor(() => savedCaseRows(home).length === 1, 'the table to settle');
        savedCaseRows(home).find(r => r.caseNumber === 'Case-1').buttons.Delete.onclick();
        await waitFor(() => !userBuckets.has(`${USER}\u0000Case-1_${SUFFIX}`), 'the delete to reach the server');
        await waitFor(() => /No saved cases/.test(home.__byId['saved-files-body'].innerHTML), 'the table to empty');
        assert.strictEqual(structuredRowsFor(USER, 'Case-1'), 0);
        assert.strictEqual(structuredRowsFor('other', 'Case-1'), 4, 'the other login\'s Case-1 is untouched');
        assert.strictEqual(JSON.parse(userSettings.get(USER))['sar-sync-bucket-v1'], '', 'no case is open any more');
        assert.strictEqual(home.getActiveCaseNumber(), '');
        assert.strictEqual(home.loadBundle().fileName, '', 'no stand-in file is created');
        assert.deepStrictEqual(localStorageAccess, []);
    });

    console.log('\nExport reads the server copy');

    await check('Export downloads the case as the server holds it, without loading it', async () => {
        seedCase(USER, 'Case-3', caseFile(scratch, 'Case-3', 3));
        home.buildSavedFilesTable();
        await waitFor(() => savedCaseRows(home).some(r => r.caseNumber === 'Case-3'), 'the table to show Case-3');
        await savedCaseRows(home).find(r => r.caseNumber === 'Case-3').buttons.Export.onclick();
        assert.strictEqual(home.__downloads.length, 1, 'one file is downloaded');
        const exported = JSON.parse(home.__downloads[0]);
        assert.strictEqual(exported.fileName, 'Case-3');
        assert.deepStrictEqual(exported.pages.page2.map(r => r[1]), ['Seg 1', 'Seg 2', 'Seg 3']);
        assert.strictEqual(home.getActiveCaseNumber(), '', 'exporting does not open the case');
    });

    console.log(`\nAll ${passed} checks passed.`);
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

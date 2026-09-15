// The users of a login belong to the login, not to a CASE #.
//
// What this covers:
//   * sync-server.js keeps them in `login_users` (one row per login username +
//     lower-cased name) behind GET/PUT /api/auth/users: both need the verified
//     username + password, the PUT upserts by name and never deletes (a removal
//     is a record flagged removed), and the table is created by the schema.
//   * app.js reads the list right after the login's settings (loadLoginUsers)
//     and lays it over the open case before drawing (applyLoginUsersToBundle):
//     the case's accounts become Super Admin + the login's users, everyone gets
//     a Personnel row (team "Off Duty", not on scene) when the case has none,
//     rows are linked to the login-wide PIN, removed users lose their rows, and
//     a person this case knows but the login does not is adopted (with a fresh
//     PIN when theirs is taken).
//   * Every save (saveBundle -> syncLoginUsersFromBundle) writes back what the
//     case says about its users: a name typed on the Personnel page becomes a
//     login user, an edited colour travels, a removed name typed anew revives.
//   * removeLoginUser flags the record and drops the person from the case;
//     noteLoginUserRename retires the old name. Nothing at all happens while
//     the list was not read (an unreachable server keeps the old behaviour).
//
// Run with: node test_login_users.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool, installed before sync-server.js loads.
// Only the login lookup and the login_users table are modelled; every other
// statement (schema creation, LPB seeding) is acknowledged and recorded.
// ---------------------------------------------------------------------------
const executed = [];
const loginUsersTable = new Map(); // "<username>|<user_key>" -> row
const query = (rawSql, params, cb) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    executed.push(sql);
    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        return cb(null, params[0] === 'tester' && params[2] === '1234' ? [{username: 'tester', password: 'x', pin: '1234'}] : []);
    }
    if (/^SELECT user_name, pin, handle, color, theme, is_file_manager, removed, record, updatedAt FROM `login_users` WHERE username = \? ORDER BY user_name$/.test(sql)) {
        const rows = Array.from(loginUsersTable.values()).filter(r => r.username === params[0])
            .sort((a, b) => a.user_name.localeCompare(b.user_name));
        return cb(null, rows);
    }
    if (/^INSERT INTO `login_users` \(username, user_key, user_name, pin, handle, color, theme, is_file_manager, removed, record, updatedAt\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\) ON DUPLICATE KEY UPDATE /.test(sql)) {
        const [username, userKey, userName, pin, handle, color, theme, isFileManager, removed, record, updatedAt] = params;
        const key = `${username}|${userKey}`;
        const existed = loginUsersTable.has(key);
        loginUsersTable.set(key, {username, user_key: userKey, user_name: userName, pin, handle, color, theme, is_file_manager: isFileManager, removed, record, updatedAt});
        return cb(null, {affectedRows: existed ? 2 : 1, insertId: 0});
    }
    if (/^SELECT /i.test(sql)) return cb(null, []);
    return cb(null, {affectedRows: 0, insertId: 0});
};
require.cache[require.resolve('mysql2')] = {
    id: require.resolve('mysql2'),
    filename: require.resolve('mysql2'),
    loaded: true,
    exports: {createPool: () => ({query})}
};
const server = require('./sync-server');

// ---------------------------------------------------------------------------
// A small fake DOM for app.js (see test_sync_server_config.js).
// ---------------------------------------------------------------------------
function makeElement(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], parentNode: null, _classes: new Set(),
        textContent: '', _innerHTML: '', value: '',
        get className() { return Array.from(el._classes).join(' '); },
        set className(value) { el._classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
        get innerHTML() { return el._innerHTML; },
        set innerHTML(value) { el._innerHTML = String(value); el.children = []; },
        classList: {
            add: (...names) => names.forEach(n => el._classes.add(n)),
            remove: (...names) => names.forEach(n => el._classes.delete(n)),
            contains: (n) => el._classes.has(n),
            toggle: (n, force) => { if (force === undefined ? el._classes.has(n) : !force) el._classes.delete(n); else el._classes.add(n); }
        },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        insertBefore(child, before) { child.parentNode = el; const at = el.children.indexOf(before); if (at < 0) el.children.push(child); else el.children.splice(at, 0, child); return child; },
        remove() { if (el.parentNode) { el.parentNode.children = el.parentNode.children.filter(c => c !== el); el.parentNode = null; } },
        addEventListener() {}, removeEventListener() {},
        setAttribute(name, value) { el[name] = value; }, getAttribute: (name) => (name in el ? el[name] : null),
        focus() {}, closest: () => null,
        getBoundingClientRect: () => ({width: 0, height: 0, left: 0, top: 0}),
        querySelector: () => null, querySelectorAll: () => []
    };
    return el;
}

function createSandbox(options = {}) {
    const memory = {};
    const storage = () => ({
        getItem: (k) => (Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null),
        setItem: (k, v) => { memory[k] = String(v); },
        removeItem: (k) => { delete memory[k]; }
    });
    const sessionData = {};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
    };
    const jar = new Map(Object.entries(options.cookies || {}));
    const body = makeElement('body');
    body.dataset.page = options.page || 'page3';
    const document = {
        get cookie() { return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
        set cookie(raw) {
            const [pair] = String(raw).split(';');
            const index = pair.indexOf('=');
            if (index <= 0) return;
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (/Expires=Thu, 01 Jan 1970/i.test(raw) || value === '') jar.delete(name); else jar.set(name, value);
        },
        body, documentElement: makeElement('html'), head: makeElement('head'), readyState: 'complete', activeElement: null,
        createElement: (tag) => makeElement(tag), createTextNode: () => makeElement('text'),
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }
    };
    const sandbox = {
        console: {log() {}, warn() {}, error() {}, info() {}},
        setTimeout: (fn, ms) => { if (!ms || ms <= 400) setTimeout(fn, 0); return 1; },
        clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        AbortController, FormData: class FormData {},
        localStorage: storage(), sessionStorage, SAR_MEMORY_STORAGE: {}, document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {}, removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        alert: (msg) => { sandbox.__alerts.push(String(msg)); },
        confirm: () => true,
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        URL,
        location: {hostname: 'jeremiah.github.io', protocol: 'https:', href: 'https://jeremiah.github.io/page3.html', search: '', reload() {}}
    };
    sandbox.__alerts = [];
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.showLoginPopup = () => {};
    return sandbox;
}

const SERVER_URL = 'https://sar-sync.example.com';
const jsonResponse = (payload, status = 200) => Promise.resolve({ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload)});
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// A logged-in sandbox whose server holds `serverUsers`; every PUT of the list
// is recorded in `puts` (the users of each request).
async function loggedInSandbox(serverUsers) {
    const app = createSandbox({cookies: {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234', 'sar-sync-url-config-v1': SERVER_URL}});
    const puts = [];
    app.fetch = (url, init = {}) => {
        const u = String(url);
        if (u.includes('/api/auth/settings')) return jsonResponse(init.method === 'PUT' ? {success: true} : {});
        if (u.includes('/api/auth/users') && init.method === 'PUT') { puts.push(JSON.parse(init.body).users); return jsonResponse({success: true}); }
        if (u.includes('/api/auth/users?_=')) return jsonResponse({users: serverUsers});
        return Promise.reject(new TypeError('Failed to fetch'));
    };
    await app.setSyncBucket('CASE-1');
    return {app, puts};
}

const row = (name, pin, team = '', status = '') => {
    const r = Array.from({length: 14}, () => '');
    r[0] = name; r[1] = team; r[6] = status; r[8] = pin;
    return r;
};

process.exitCode = 1;
let passed = 0;
const check = async (name, fn) => {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
};

(async () => {
    console.log('sync-server.js: the login_users table and /api/auth/users');

    await check('a login user is canonical: trimmed name, string PIN, handle/colour/theme defaults; the stand-ins are never one', () => {
        assert.strictEqual(server.loginUserKey('  Alex Smith '), 'alex smith');
        const user = server.normalizeLoginUser({username: ' Alex ', pin: 1400, isFileManager: 'yes', theme: 'light', searchLogSortRecentFirst: true});
        assert.deepStrictEqual(user, {username: 'Alex', pin: '1400', isFileManager: false, theme: 'light', searchLogSortRecentFirst: true, handle: 'Alex', color: 'none', removed: false});
        assert.strictEqual(server.normalizeLoginUser({username: 'Super Admin', pin: '1976'}), null);
        assert.strictEqual(server.normalizeLoginUser({username: 'Someone', pin: '1976'}), null, 'the Super Admin PIN is never a login user');
        assert.strictEqual(server.normalizeLoginUser({username: 'Anonymous', pin: 'anonymous'}), null);
        assert.strictEqual(server.normalizeLoginUser({username: '   ', pin: '1400'}), null);
        assert.strictEqual(server.normalizeLoginUser(['Alex']), null);
        const fromRow = server.loginUserRowToJson({user_name: 'Alex', pin: '1400', handle: 'Al', color: 'red', theme: 'dark', is_file_manager: 1, removed: 0,
            record: JSON.stringify({username: 'Alex', pin: '1400', useHighlightColor: true, visiblePages: ['home']}), updatedAt: '2026-09-14T00:00:00.000Z'});
        assert.deepStrictEqual(fromRow, {username: 'Alex', pin: '1400', useHighlightColor: true, visiblePages: ['home'], handle: 'Al', color: 'red', theme: 'dark',
            isFileManager: true, removed: false, updatedAt: '2026-09-14T00:00:00.000Z'}, 'the typed columns win over the record, the rest comes from the record');
    });

    await check('the schema creates login_users keyed by (login username, lower-cased name)', () => {
        executed.length = 0;
        server.initDatabaseSchema();
        const create = executed.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS `login_users`'));
        assert.ok(create, 'CREATE TABLE login_users runs at start');
        assert.ok(/PRIMARY KEY \(username, user_key\)/.test(create), create);
        ['user_name', 'pin', 'handle', 'color', 'theme', 'is_file_manager', 'removed', 'record'].forEach((column) => assert.ok(create.includes(column), column));
        assert.strictEqual(server.LOGIN_USERS_TABLE, 'login_users');
    });

    const httpServer = http.createServer(server.app);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    const auth = {'X-User-Name': 'tester', 'X-User-Password': '1234', 'Content-Type': 'application/json'};

    try {
        await check('both routes want the verified login; GET answers an empty list for a fresh login', async () => {
            assert.strictEqual((await fetch(`${baseUrl}/api/auth/users`)).status, 401, 'no credentials');
            assert.strictEqual((await fetch(`${baseUrl}/api/auth/users`, {headers: {'X-User-Name': 'tester', 'X-User-Password': 'wrong'}})).status, 401, 'wrong password');
            assert.strictEqual((await fetch(`${baseUrl}/api/auth/users`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: '{"users":[]}'})).status, 401);
            const resp = await fetch(`${baseUrl}/api/auth/users`, {headers: auth});
            assert.strictEqual(resp.status, 200);
            assert.deepStrictEqual(await resp.json(), {users: []});
        });

        await check('PUT upserts by name under the login and never deletes; GET lists everyone, removed ones flagged', async () => {
            let resp = await fetch(`${baseUrl}/api/auth/users`, {method: 'PUT', headers: auth, body: JSON.stringify({users: [
                {username: 'Zoe', pin: '1400', color: 'blue', theme: 'light'},
                {username: 'Alex', pin: '1401'},
                {username: 'Super Admin', pin: '1976'},
                {username: 'Anonymous', pin: 'anonymous', isAnonymous: true}
            ]})});
            assert.strictEqual(resp.status, 200);
            let body = await resp.json();
            assert.strictEqual(body.saved, 2, 'the two stand-ins are not stored');
            assert.deepStrictEqual(body.users.map(u => [u.username, u.pin, u.color, u.theme, u.removed]),
                [['Alex', '1401', 'none', 'dark', false], ['Zoe', '1400', 'blue', 'light', false]]);

            resp = await fetch(`${baseUrl}/api/auth/users`, {method: 'PUT', headers: auth, body: JSON.stringify({users: [
                {username: 'zoe', pin: '1400', color: 'green', theme: 'light', removed: true}
            ]})});
            body = await resp.json();
            assert.deepStrictEqual(body.users.map(u => [u.username, u.color, u.removed]), [['Alex', 'none', false], ['zoe', 'green', true]],
                'the same name (any case) is one record; a removal is a flag, not a missing row');

            body = await (await fetch(`${baseUrl}/api/auth/users`, {headers: auth})).json();
            assert.strictEqual(body.users.length, 2);
            assert.strictEqual(body.users.find(u => u.username === 'zoe').removed, true);
            assert.ok(body.users.every(u => typeof u.updatedAt === 'string'), 'every record carries when it was written');

            assert.strictEqual((await fetch(`${baseUrl}/api/auth/users`, {method: 'PUT', headers: auth, body: JSON.stringify({users: 'Alex'})})).status, 400);
            assert.ok(Array.from(loginUsersTable.keys()).every(k => k.startsWith('tester|')), 'rows are stored under the login username');
        });
    } finally {
        httpServer.close();
    }

    console.log('\napp.js: the list is laid over the open case and learns from every save');

    const superAdmin = () => ({username: 'Super Admin', pin: '1976', color: 'none', handle: 'Super-Admin', isFileManager: true, theme: 'dark', visiblePages: ['home']});

    await check('applyLoginUsersToBundle: accounts = Super Admin + the login\'s users, a Personnel row each, removed users gone, strangers adopted', async () => {
        const {app, puts} = await loggedInSandbox([
            {username: 'Zoe', pin: '1400', color: 'blue', theme: 'light', useHighlightColor: true},
            {username: 'Old Guy', pin: '1401', removed: true}
        ]);
        await app.loadLoginUsers();
        const bundle = app.defaultBundle();
        bundle.fileName = 'CASE-1';
        bundle.permanentPersonnel = {Zoe: {gps: 'true', radio: '', medic: 'true'}};
        bundle.pages.page3 = [row('Alex', '1400', 'Team 1', 'On-Scene'), row('Old Guy', '1401', 'Team 1', 'On-Scene'), row('', '')];
        bundle.accounts = [superAdmin(), {username: 'Alex', pin: '1400', color: 'red', handle: 'Alex', theme: 'dark', isFileManager: false, visiblePages: ['home']},
            {username: 'Old Guy', pin: '1401', color: 'none', handle: 'Old Guy', theme: 'dark', isFileManager: false, visiblePages: ['home']}];

        assert.strictEqual(app.applyLoginUsersToBundle(bundle), true);
        assert.deepStrictEqual(plain(bundle.accounts).map(a => [a.username, a.pin, a.color]), [['Super Admin', '1976', 'none'], ['Zoe', '1400', 'blue'], ['Alex', '1401', 'red']],
            'Alex (this case only) was adopted with the next free PIN - 1400 is Zoe\'s, 1401 was the removed Old Guy\'s and is free again; Old Guy is gone');
        assert.strictEqual(bundle.accounts[1].useHighlightColor, true, 'the login\'s record is what the case carries');
        assert.ok(!('removed' in bundle.accounts[1]), 'the bookkeeping flag stays out of the case');
        const rows = plain(bundle.pages.page3);
        assert.deepStrictEqual(rows.map(r => [r[0], r[1], r[6], r[8]]), [['Alex', 'Team 1', 'On-Scene', '1401'], ['', '', '', ''], ['Zoe', 'Off Duty', 'false', '1400']],
            'Alex keeps his team/status but is re-linked to his PIN; Old Guy\'s row is dropped; Zoe gets a blank Off Duty row');
        assert.deepStrictEqual([rows[2][3], rows[2][4], rows[2][5]], ['true', '', 'true'], 'her remembered GPS / Medic toggles are kept');
        await tick();
        assert.deepStrictEqual(puts.map(users => users.map(u => [u.username, u.pin, u.removed])), [[['Alex', '1401', false]]], 'only the adopted person is written to the login');
        assert.deepStrictEqual(plain(app.getLoginUsers()).map(u => u.username), ['Zoe', 'Alex']);
        assert.deepStrictEqual(plain(app.getLoginUsers({includeRemoved: true})).map(u => u.username), ['Zoe', 'Old Guy', 'Alex']);

        assert.strictEqual(app.applyLoginUsersToBundle(bundle), false, 'laying it over again changes nothing');
        assert.strictEqual(puts.length, 1);
    });

    await check('a case from before the list keeps every row with its person: a PIN clash never hands one user\'s row to another; a renamed user keeps theirs', async () => {
        const {app} = await loggedInSandbox([
            {username: 'Zoe', pin: '1400'},
            {username: 'Bob', pin: '1401'},
            {username: 'Cara', pin: '1402'},
            {username: 'Carla', pin: '1402', removed: true}
        ]);
        await app.loadLoginUsers();
        const bundle = app.defaultBundle();
        bundle.fileName = 'CASE-2';
        bundle.permanentPersonnel = {Carla: {gps: 'true', radio: '', medic: ''}};
        // This case gave Bob 1400 (Zoe's login-wide PIN) and still calls Cara by her old name.
        bundle.pages.page3 = [row('Bob', '1400', 'Team 1', 'On-Scene'), row('Carla', '1402', 'Team 2', 'Enroute')];
        bundle.accounts = [superAdmin(), {username: 'Bob', pin: '1400'}, {username: 'Carla', pin: '1402'}];
        assert.strictEqual(app.applyLoginUsersToBundle(bundle), true);
        const rows = plain(bundle.pages.page3).map(r => [r[0], r[1], r[6], r[8]]);
        assert.deepStrictEqual(rows, [['Bob', 'Team 1', 'On-Scene', '1401'], ['Cara', 'Team 2', 'Enroute', '1402'], ['Zoe', 'Off Duty', 'false', '1400']],
            'Bob keeps his row (re-linked to 1401) although Zoe owns 1400; Carla\'s row becomes Cara\'s by PIN and keeps its team and status');
        assert.deepStrictEqual(plain(bundle.accounts).map(a => a.username), ['Super Admin', 'Zoe', 'Bob', 'Cara']);
        assert.deepStrictEqual(Object.keys(bundle.permanentPersonnel), [], 'the roles remembered for the removed name are gone too');

        // Two devices opened the case at once and both appended Zoe's blank row.
        bundle.pages.page3.push(row('Zoe', '1400', 'Off Duty', 'false'));
        assert.strictEqual(app.applyLoginUsersToBundle(bundle), true);
        assert.deepStrictEqual(plain(bundle.pages.page3).map(r => r[0]), ['Bob', 'Cara', 'Zoe'], 'the second blank copy goes');
        bundle.pages.page3.push(row('Zoe', '1400', 'Team 3', 'On-Scene'));
        assert.strictEqual(app.applyLoginUsersToBundle(bundle), false, 'a row somebody worked on is never dropped');
    });

    await check('saveBundle: a name typed on the Personnel page becomes a login user, an edited colour travels, a removed name typed anew revives', async () => {
        const {app, puts} = await loggedInSandbox([
            {username: 'Zoe', pin: '1400', color: 'blue', theme: 'light'},
            {username: 'Old Guy', pin: '1401', removed: true}
        ]);
        await app.loadLoginUsers();
        const bundle = app.defaultBundle();
        bundle.fileName = 'CASE-1';
        bundle.pages.page3 = [];
        bundle.accounts = [superAdmin()];
        app.applyLoginUsersToBundle(bundle);
        app.saveBundle(bundle);
        await tick();
        assert.strictEqual(puts.length, 0, 'a save that says nothing new writes nothing');

        // The Personnel page: a new name in a fresh row (the sanitizer links it to an account).
        let b = app.loadBundle();
        b.pages.page3.push(row('Newbie', '', 'Team 2', 'Enroute'));
        app.saveBundle(b);
        await tick();
        assert.strictEqual(puts.length, 1);
        assert.deepStrictEqual(puts[0].map(u => [u.username, u.pin, u.removed]), [['Newbie', '1401', false]],
            'the case\'s next PIN (1401, once the removed Old Guy\'s) is free for the login too');
        b = app.loadBundle();
        assert.strictEqual(b.pages.page3.find(r => r[0] === 'Newbie')[8], '1401', 'the row is linked to the login-wide PIN');
        assert.strictEqual(b.accounts.find(a => a.username === 'Newbie').pin, '1401');

        // The Settings / Users page: Zoe's colour.
        b.accounts.find(a => a.username === 'Zoe').color = 'green';
        app.saveBundle(b);
        await tick();
        assert.strictEqual(puts.length, 2);
        assert.deepStrictEqual(puts[1].map(u => [u.username, u.color]), [['Zoe', 'green']]);
        assert.strictEqual(plain(app.getLoginUsers()).find(u => u.username === 'Zoe').color, 'green');

        // Old Guy is typed again: revived, with the PIN the case gave him.
        b = app.loadBundle();
        b.pages.page3.push(row('Old Guy', '', 'Team 1', 'Enroute'));
        app.saveBundle(b);
        await tick();
        assert.strictEqual(puts.length, 3);
        assert.deepStrictEqual(puts[2].map(u => [u.username, u.pin, u.removed]), [['Old Guy', '1402', false]]);
        assert.deepStrictEqual(plain(app.getLoginUsers()).map(u => u.username), ['Zoe', 'Old Guy', 'Newbie']);

        app.saveBundle(app.loadBundle());
        await tick();
        assert.strictEqual(puts.length, 3, 'a save without a user change writes nothing');
    });

    await check('removeLoginUser flags the record and drops the person from the case; noteLoginUserRename retires the old name', async () => {
        const {app, puts} = await loggedInSandbox([
            {username: 'Zoe', pin: '1400', color: 'blue'},
            {username: 'Alex', pin: '1401'}
        ]);
        await app.loadLoginUsers();
        const bundle = app.defaultBundle();
        bundle.fileName = 'CASE-1';
        bundle.pages.page3 = [];
        bundle.accounts = [superAdmin()];
        app.applyLoginUsersToBundle(bundle);
        app.saveBundle(bundle);
        await tick();
        assert.deepStrictEqual(plain(app.loadBundle().pages.page3).map(r => r[0]), ['Zoe', 'Alex']);

        assert.strictEqual(app.removeLoginUser('alex'), true);
        await tick();
        assert.deepStrictEqual(puts.map(users => users.map(u => [u.username, u.removed])), [[['Alex', true]]]);
        const after = app.loadBundle();
        assert.deepStrictEqual(plain(after.accounts).map(a => a.username), ['Super Admin', 'Zoe']);
        assert.deepStrictEqual(plain(after.pages.page3).map(r => r[0]), ['Zoe']);
        assert.deepStrictEqual(plain(app.getLoginUsers()).map(u => u.username), ['Zoe']);
        assert.strictEqual(plain(app.getLoginUsers({includeRemoved: true})).find(u => u.username === 'Alex').removed, true);
        assert.strictEqual(app.removeLoginUser('alex'), false, 'removing again changes nothing');
        assert.strictEqual(puts.length, 1);

        app.noteLoginUserRename('Zoe', 'Zoey');
        await tick();
        assert.deepStrictEqual(puts[1].map(u => [u.username, u.removed]), [['Zoe', true]]);
        app.noteLoginUserRename('Zoey', 'zoey');
        assert.strictEqual(puts.length, 2, 'a change of case is not a rename');
        const b = app.loadBundle();
        b.accounts.find(a => a.username === 'Zoe').username = 'Zoey';
        b.pages.page3.find(r => r[0] === 'Zoe')[0] = 'Zoey';
        app.saveBundle(b);
        await tick();
        assert.deepStrictEqual(puts[2].map(u => [u.username, u.pin, u.removed]), [['Zoey', '1400', false]], 'the new name keeps the PIN');
        assert.deepStrictEqual(plain(app.getLoginUsers()).map(u => u.username), ['Zoey']);
    });

    await check('without the server\'s list nothing is laid over and nothing is written', async () => {
        const app = createSandbox({cookies: {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234', 'sar-sync-url-config-v1': SERVER_URL}});
        const asked = [];
        app.fetch = (url, init = {}) => {
            asked.push([String(url), init.method || 'GET']);
            if (String(url).includes('/api/auth/settings')) return jsonResponse(init.method === 'PUT' ? {success: true} : {});
            return Promise.reject(new TypeError('Failed to fetch'));
        };
        await app.setSyncBucket('CASE-1');
        assert.deepStrictEqual(plain(await app.loadLoginUsers()), []);
        const bundle = app.defaultBundle();
        bundle.fileName = 'CASE-1';
        bundle.pages.page3 = [row('Alex', '1400')];
        bundle.accounts = [superAdmin(), {username: 'Alex', pin: '1400', color: 'red', visiblePages: []}];
        assert.strictEqual(app.applyLoginUsersToBundle(bundle), false);
        assert.strictEqual(bundle.pages.page3.length, 1);
        app.saveBundle(bundle);
        await tick();
        assert.ok(!asked.some(([url, method]) => url.includes('/api/auth/users') && method === 'PUT'), 'no PUT of the list');
        assert.strictEqual(app.saveLoginUsers([{username: 'Alex', pin: '1400'}]), null, 'a write before the read is refused');
        assert.deepStrictEqual(plain(app.getLoginUsers()), []);
    });

    await check('the page load reads the list after the login\'s settings and lays it over the case before drawing; every save goes through the hook', () => {
        const boot = appSource.slice(appSource.indexOf("document.addEventListener('DOMContentLoaded'"));
        const settingsAt = boot.indexOf('await withTimeout(loadServerSettings()');
        const usersAt = boot.indexOf('withTimeout(loadLoginUsers()');
        const applyAt = boot.indexOf('applyLoginUsersToBundle(bundle)');
        const themeAt = boot.indexOf('applyTheme(bundle)');
        assert.ok(settingsAt > 0 && usersAt > settingsAt, 'loadLoginUsers() starts after the settings are read');
        assert.ok(boot.indexOf('await loginUsersReady') > usersAt && boot.indexOf('await loginUsersReady') < applyAt, 'and is awaited before the case is laid over');
        assert.ok(applyAt > 0 && applyAt < themeAt, 'the case is laid over before it is drawn');
        assert.ok(/caseInMemory && applyLoginUsersToBundle\(bundle\)/.test(boot), 'only a case that really was read is touched');
        const save = appSource.slice(appSource.indexOf('function saveBundle(bundle, deferFlush = false)'), appSource.indexOf('function getSavedFiles()'));
        assert.ok(/const sanitized = sanitizeBundle\(bundle\);[\s\S]*syncLoginUsersFromBundle\(sanitized\)[\s\S]*queueBundleChanges\(previous, sanitized\)/.test(save),
            'the hook runs on the sanitized copy before it is queued and stored');
        const clear = appSource.slice(appSource.indexOf('function clearInMemoryUserData()'), appSource.indexOf('function checkAccess()'));
        assert.ok(/_loginUsers = null/.test(clear) && /_loginUsersLoaded = false/.test(clear), 'logging out forgets the list');
        const management = appSource.slice(appSource.indexOf('function renderUserManagement('), appSource.indexOf('function buildUserManagementPage()'));
        assert.ok(/removeLoginUser\(acc\.username\)/.test(management), 'the Users page removes a person from the login');
        assert.ok(/add-user-btn-mgmt/.test(management) && /showEditAccountPopup\(null/.test(management), 'and can add one');
        assert.ok(!/Managed via Personnel/.test(management));
        const personnelDelete = appSource.slice(appSource.indexOf("logDeletion('Personnel', memberName);"), appSource.indexOf("addRowBtn.textContent = '+ Add new person'"));
        assert.ok(/removeLoginUser\(memberName\)/.test(personnelDelete), 'deleting a Personnel row takes the person off the login');
        const newCase = appSource.slice(appSource.indexOf('newBundle.accounts = currentBundle.accounts;'), appSource.indexOf("logCreation('New Case #'"));
        assert.ok(/applyLoginUsersToBundle\(newBundle\)/.test(newCase), 'a new case starts with every user of the login');
    });

    process.stdout.write(`\nAll ${passed} checks passed.\nLogin-wide users: PASS\n`, () => process.exit(0));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

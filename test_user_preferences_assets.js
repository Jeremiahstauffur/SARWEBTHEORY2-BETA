// Login preferences, per-login images and the theme boot overlay.
//
// What this covers:
//   * Preferences chosen on the Settings page are stored in the database under
//     the LOGIN username (user_settings) and applied again on every page load,
//     in every case - they used to live only inside the open search file.
//   * The header logo and the background photo are stored on the server under
//     the login (user_assets, /api/auth/assets) and come back after a refresh;
//     the logo used to disappear on the first reload because nothing applied it
//     on load. They only go away through "Remove Logo" / "Use Default".
//   * theme-boot.js paints the page in the last applied theme before the first
//     paint and covers it (80% dark/light overlay + spinner) until app.js has
//     applied the preferences read from the server, instead of flashing dark
//     and then switching to light.
//   * Every Settings panel carries a pill naming who it is saved for: the
//     selected user (per-account settings) or the username that is logged in.
//
// The real app.js runs in a sandbox (fake DOM, in-memory store) against the
// real sync-server.js, whose MySQL pool is replaced by an in-memory stand-in.
//
// Run with: node test_user_preferences_assets.js

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
const userAssets = new Map();   // "username\u0000kind" -> row
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

    // ---- per-login images ----
    if (/^SELECT asset_kind, file_name, mime_type, data, updatedAt FROM `user_assets` WHERE username = \? AND asset_kind = \?$/.test(sql)) {
        const row = userAssets.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, row ? [{...row}] : []);
    }
    if (/^SELECT asset_kind, file_name, mime_type, data, updatedAt FROM `user_assets` WHERE username = \?$/.test(sql)) {
        const rows = [...userAssets.entries()].filter(([k]) => k.split('\u0000')[0] === p[0]).map(([, v]) => ({...v}));
        return cb(null, rows);
    }
    if (/^REPLACE INTO `user_assets` \(username, asset_kind, file_name, mime_type, data, updatedAt\)/.test(sql)) {
        userAssets.set(`${p[0]}\u0000${p[1]}`, {asset_kind: p[1], file_name: p[2], mime_type: p[3], data: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM `user_assets` WHERE username = \? AND asset_kind = \?$/.test(sql)) {
        userAssets.delete(`${p[0]}\u0000${p[1]}`);
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
    if (/^REPLACE INTO `activity_log_entries`/.test(sql)) {
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

const {app, USER_ASSET_KINDS} = require('./sync-server');

// ---------------------------------------------------------------------------
// Browser sandbox running the real app.js
// ---------------------------------------------------------------------------
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const bootSource = fs.readFileSync(path.join(__dirname, 'theme-boot.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');

const USER = 'tester';
const CASE = 'Case-1';
const BUCKET = `${CASE}_${encodeURIComponent(USER)}`;
const LOGO_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const BG_DATA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

// A small fake element with a working classList, dataset and children.
function makeElement(tag = 'div') {
    const classes = new Set();
    const el = {
        tagName: tag.toUpperCase(),
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {
            add: (...names) => names.forEach(n => classes.add(n)),
            remove: (...names) => names.forEach(n => classes.delete(n)),
            contains: (n) => classes.has(n),
            toggle: (n, force) => {
                const on = force === undefined ? !classes.has(n) : !!force;
                if (on) classes.add(n); else classes.delete(n);
                return on;
            }
        },
        get className() { return [...classes].join(' '); },
        set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); },
        children: [],
        appendChild(child) { el.children.push(child); child._parent = el; return child; },
        append(...nodes) { nodes.forEach(n => el.appendChild(n)); },
        prepend(...nodes) { nodes.reverse().forEach(n => { el.children.unshift(n); n._parent = el; }); },
        insertBefore(node, ref) {
            const idx = ref ? el.children.indexOf(ref) : -1;
            if (idx === -1) el.children.push(node); else el.children.splice(idx, 0, node);
            node._parent = el;
            return node;
        },
        remove() { if (el._parent) el._parent.children = el._parent.children.filter(c => c !== el); },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) { el._attrs = el._attrs || {}; el._attrs[name] = String(value); if (name === 'src') el.src = String(value); },
        getAttribute: (name) => (el._attrs && Object.prototype.hasOwnProperty.call(el._attrs, name) ? el._attrs[name] : null),
        removeAttribute(name) { if (el._attrs) delete el._attrs[name]; if (name === 'src') delete el.src; },
        hasAttribute: (name) => !!(el._attrs && Object.prototype.hasOwnProperty.call(el._attrs, name)),
        querySelector: (selector) => findAll(el, selector)[0] || null,
        querySelectorAll: (selector) => findAll(el, selector),
        closest: () => null,
        focus() {},
        click() {},
        blur() {},
        textContent: '',
        _innerHTML: '',
        disabled: false,
        checked: false,
        value: ''
    };
    Object.defineProperty(el, 'innerHTML', {
        get: () => el._innerHTML,
        set: (value) => { el._innerHTML = String(value); el.children = []; }
    });
    Object.defineProperty(el, 'parentElement', {get: () => el._parent || null});
    Object.defineProperty(el, 'firstChild', {get: () => el.children[0] || null});
    return el;
}

// Just enough selector support for what app.js asks of the settings page.
function matches(el, selector) {
    const m = /^(\.[\w-]+)?(\[[\w-]+(?:="[^"]*")?\])?$/.exec(selector.trim());
    if (!m) return false;
    if (m[1] && !el.classList.contains(m[1].slice(1))) return false;
    if (m[2]) {
        const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(m[2]);
        const camel = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const has = name.startsWith('data-') ? Object.prototype.hasOwnProperty.call(el.dataset, camel) : el.hasAttribute(name);
        if (!has) return false;
        if (value !== undefined) {
            const actual = name.startsWith('data-') ? el.dataset[camel] : el.getAttribute(name);
            if (actual !== value) return false;
        }
    }
    return !!(m[1] || m[2]);
}

function findAll(root, selector) {
    const out = [];
    const walk = (node) => {
        (node.children || []).forEach((child) => {
            if (matches(child, selector)) out.push(child);
            walk(child);
        });
    };
    walk(root);
    return out;
}

// The Settings page as the sandbox sees it: one panel per data-setting-scope
// in settings.html, plus the header logo <img>.
function buildSettingsDom(body) {
    const logo = makeElement('img');
    logo.dataset.headerLogo = '';
    logo.style.display = 'none';
    body.appendChild(logo);
    const panels = [];
    const re = /<div class="home-panel[^"]*" data-setting-scope="(user|login)">\s*(?:<div[^>]*>\s*)?<h2[^>]*>([^<]+)<\/h2>/g;
    let m;
    while ((m = re.exec(settingsHtml))) {
        const panel = makeElement('div');
        panel.classList.add('home-panel');
        panel.dataset.settingScope = m[1];
        const h2 = makeElement('h2');
        h2.textContent = m[2].trim();
        panel.appendChild(h2);
        body.appendChild(panel);
        panels.push({title: m[2].trim(), scope: m[1], panel});
    }
    return {logo, panels};
}

function createSandbox({baseUrl, page = 'settings', cookies = {}}) {
    const sessionData = {};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
    };
    const cookieJar = {
        'sar-user-name-v1': USER,
        'sar-user-password-v1': '1234',
        'sar-sync-url-local-v1': baseUrl,
        ...cookies
    };
    const byId = {};
    const body = makeElement('body');
    body.dataset.page = page;
    const dom = buildSettingsDom(body);
    const documentElement = makeElement('html');
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
        documentElement,
        head: makeElement('head'),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        createElement: (tag) => makeElement(tag),
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: (selector) => findAll(body, selector)[0] || null,
        querySelectorAll: (selector) => findAll(body, selector),
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent() { return true; }
    };

    const logs = {warn: [], error: []};
    const sandbox = {
        console: {
            log() {},
            info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        setTimeout: (fn, ms) => { if (ms <= 400) { setTimeout(fn, 0); } return 1; },
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
        sessionStorage,
        SAR_MEMORY_STORAGE: {},
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        // Only the test server is reachable; anything else (the CalTopo proxy
        // health check) fails at once instead of going out to the internet.
        fetch: (url, init) => (String(url).startsWith(baseUrl) ? fetch(url, init) : Promise.reject(new TypeError('Failed to fetch'))),
        AbortController,
        alert: (msg) => { logs.error.push(`alert: ${msg}`); },
        confirm: () => true,
        FormData: class FormData {},
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        Blob: class Blob { constructor(parts) { this.text = parts.join(''); } },
        URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}},
        // A FileReader that hands back the data: URL the fake file carries.
        FileReader: class FileReader {
            readAsDataURL(file) {
                setTimeout(() => this.onload && this.onload({target: {result: file.dataUrl}}), 0);
            }
        },
        location: {
            hostname: 'localhost', protocol: 'http:', origin: 'http://localhost',
            href: `http://localhost/${page}.html`, search: '',
            reload() {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // theme-boot.js runs in <head>, before app.js.
    vm.runInContext(bootSource, sandbox, {filename: 'theme-boot.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__byId = byId;
    sandbox.__session = sessionData;
    sandbox.__listeners = listeners;
    sandbox.__logs = logs;
    sandbox.__cookies = cookieJar;
    sandbox.__dom = dom;
    sandbox.__html = documentElement;
    return sandbox;
}

async function loadPage(app) {
    const handlers = app.__listeners.DOMContentLoaded || [];
    assert.strictEqual(handlers.length, 1, 'app.js registers one DOMContentLoaded handler');
    await handlers[0]();
}

const waitFor = async (predicate, what, ms = 5000) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

const now = () => new Date().toISOString();
const storedPreferences = () => (JSON.parse(userSettings.get(USER) || '{}')['sar-user-preferences-v1'] || {});

function seedCase(scratch) {
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.page3 = [['Alex', 'Team 1', 'Alex', '', '', '', 'true', '', '1400', '', '', '', '', '']];
    const file = scratch.sanitizeBundle(bundle);
    store.set(`${BUCKET}\u0000bundle`, {value: JSON.stringify(file), userName: USER, userPin: '1234', updatedAt: now()});
    userBuckets.set(`${USER}\u0000${BUCKET}`, {lastAccessed: now()});
}

const authHeaders = (username = USER, pin = '1234') => ({'X-User-Name': username, 'X-User-Password': pin, 'Content-Type': 'application/json'});

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

    console.log('theme-boot.js: no dark-then-light flash');

    await check('every page loads theme-boot.js as the first thing in <head>, before the stylesheet', () => {
        fs.readdirSync(__dirname).filter(f => /\.html$/.test(f)).forEach((file) => {
            const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
            const head = html.slice(0, html.indexOf('<body'));
            assert.ok(/<script src="theme-boot\.js\?v=\d+"><\/script>/.test(head), `${file} must load theme-boot.js in <head>`);
            const bootAt = head.indexOf('src="theme-boot.js');
            assert.ok(bootAt < head.indexOf('href="styles.css'), `${file}: theme-boot.js comes before the stylesheet`);
            assert.strictEqual(head.indexOf('<script'), head.lastIndexOf('<script', bootAt), `${file}: no other script runs before theme-boot.js`);
            assert.strictEqual(head.indexOf('<link rel="stylesheet"'), head.indexOf('<link rel="stylesheet" href="styles.css'), `${file}: no stylesheet is requested before theme-boot.js ran`);
        });
        // The overlay CSS lives in theme-boot.js (injected inline), not in styles.css,
        // so it is in force before the stylesheet has even arrived.
        assert.ok(!/sar-booting::/.test(stylesSource), 'styles.css no longer carries the overlay (single source: theme-boot.js)');
        assert.ok(/html \{ background: #071022; color-scheme: dark; \}/.test(bootSource), 'dark canvas before styles.css arrives');
        assert.ok(/html\.light-mode \{ background: #f4f7fb; color-scheme: light; \}/.test(bootSource), 'light canvas before styles.css arrives');
        assert.ok(/html\.sar-booting::before[^']*rgba\(7, 16, 34, 0\.8\)/.test(bootSource), 'dark overlay at 80%');
        assert.ok(/html\.sar-booting\.light-mode::before[^']*rgba\(244, 247, 251, 0\.8\)/.test(bootSource), 'light overlay at 80%');
        assert.ok(/html\.sar-booting::after[^']*animation: sar-boot-spin/.test(bootSource), 'a rotating loader');
        assert.ok(/border-top-color: var\(--accent, #7dc6ff\)/.test(bootSource), 'the spinner has a colour even before styles.css defines --accent');
    });

    await check('the hint cookie puts the page in light mode (and Geek Mode) before the first paint, under the boot overlay', () => {
        const light = createSandbox({baseUrl, cookies: {'sar-ui-hint': 'light,geek'}});
        assert.ok(light.__html.classList.contains('light-mode'), 'light-mode is on before app.js ran');
        assert.ok(light.__html.classList.contains('geek-mode'));
        assert.ok(light.__html.classList.contains('sar-booting'), 'the overlay is up');
        const injected = light.document.head.children.find(c => c.id === 'sar-boot-style');
        assert.ok(injected, 'the overlay/canvas CSS is injected into <head> by theme-boot.js');
        assert.ok(/html\.sar-booting::before/.test(injected.textContent) && /@keyframes sar-boot-spin/.test(injected.textContent));
        const dark = createSandbox({baseUrl});
        assert.ok(!dark.__html.classList.contains('light-mode'), 'without a hint the page stays dark');
        assert.ok(dark.__html.classList.contains('sar-booting'));
    });

    console.log('\n/api/auth/assets: per-login images');

    await check('the endpoints require a login and reject unknown kinds / non-image payloads', async () => {
        assert.deepStrictEqual(USER_ASSET_KINDS, ['logo', 'background']);
        let resp = await fetch(`${baseUrl}/api/auth/assets`);
        assert.strictEqual(resp.status, 401);
        resp = await fetch(`${baseUrl}/api/auth/assets/avatar`, {method: 'PUT', headers: authHeaders(), body: JSON.stringify({data: LOGO_DATA})});
        assert.strictEqual(resp.status, 400);
        resp = await fetch(`${baseUrl}/api/auth/assets/logo`, {method: 'PUT', headers: authHeaders(), body: JSON.stringify({data: 'javascript:alert(1)'})});
        assert.strictEqual(resp.status, 400);
        resp = await fetch(`${baseUrl}/api/auth/assets`, {headers: authHeaders()});
        assert.deepStrictEqual(await resp.json(), {logo: null, background: null}, 'nothing stored yet');
    });

    await check('an image is stored under the login that uploaded it and read back by kind', async () => {
        let resp = await fetch(`${baseUrl}/api/auth/assets/logo`, {method: 'PUT', headers: authHeaders(), body: JSON.stringify({data: LOGO_DATA, fileName: 'team.png'})});
        assert.strictEqual(resp.status, 200);
        assert.strictEqual((await resp.json()).asset.mimeType, 'image/png');
        resp = await fetch(`${baseUrl}/api/auth/assets/background`, {method: 'PUT', headers: authHeaders(), body: JSON.stringify({data: BG_DATA, fileName: 'hills.jpg'})});
        assert.strictEqual(resp.status, 200);
        const all = await (await fetch(`${baseUrl}/api/auth/assets`, {headers: authHeaders()})).json();
        assert.strictEqual(all.logo.data, LOGO_DATA);
        assert.strictEqual(all.logo.fileName, 'team.png');
        assert.strictEqual(all.background.data, BG_DATA);
        assert.strictEqual(all.background.mimeType, 'image/jpeg');
        const one = await (await fetch(`${baseUrl}/api/auth/assets/logo`, {headers: authHeaders()})).json();
        assert.strictEqual(one.data, LOGO_DATA);
        assert.ok(userAssets.has(`${USER}\u0000logo`), 'the row is keyed by the login username');
    });

    await check('another login never sees them, and DELETE removes one kind only', async () => {
        const theirs = await (await fetch(`${baseUrl}/api/auth/assets`, {headers: authHeaders('other')})).json();
        assert.deepStrictEqual(theirs, {logo: null, background: null});
        const resp = await fetch(`${baseUrl}/api/auth/assets/background`, {method: 'DELETE', headers: authHeaders()});
        assert.strictEqual(resp.status, 200);
        const all = await (await fetch(`${baseUrl}/api/auth/assets`, {headers: authHeaders()})).json();
        assert.strictEqual(all.background, null);
        assert.strictEqual(all.logo.data, LOGO_DATA, 'the logo is untouched');
        assert.strictEqual((await fetch(`${baseUrl}/api/auth/assets/background`, {headers: authHeaders()})).status, 404);
    });

    console.log('\nPage load: the login\'s preferences and images are applied, then the overlay lifts');

    const scratch = createSandbox({baseUrl});
    seedCase(scratch);
    userSettings.set(USER, JSON.stringify({
        'sar-sync-bucket-v1': CASE,
        'sar-user-preferences-v1': {
            deleteMode: true,
            showTips: false,
            parCheckFrequency: 45,
            segmentColorScaleLowColor: '#112233',
            geekMode: true,
            theme: 'dark'
        }
    }));
    userAssets.set(`${USER}\u0000background`, {asset_kind: 'background', file_name: 'hills.jpg', mime_type: 'image/jpeg', data: BG_DATA, updatedAt: now()});

    let settings = createSandbox({baseUrl});
    await loadPage(settings);

    await check('preferences stored for the login override the case defaults on load and are written back to the case', async () => {
        const bundle = settings.loadBundle();
        assert.strictEqual(bundle.fileName, CASE, 'the case was read from the server');
        assert.strictEqual(bundle.deleteMode, true);
        assert.strictEqual(bundle.showTips, false);
        assert.strictEqual(bundle.parCheckFrequency, 45);
        assert.strictEqual(bundle.segmentColorScaleLowColor, '#112233');
        assert.strictEqual(settings.__byId['delete-mode-toggle'].checked, true, 'the Settings page shows the login\'s value');
        assert.strictEqual(settings.__byId['tips-toggle'].checked, false);
        assert.strictEqual(String(settings.__byId['par-freq-input'].value), '45');
        assert.strictEqual(settings.__byId['geek-mode-toggle'].checked, true);
        assert.ok(settings.__html.classList.contains('geek-mode'), 'Geek Mode is applied to <html>');
        await waitFor(() => {
            const stored = store.get(`${BUCKET}\u0000bundle`);
            return stored && JSON.parse(stored.value).deleteMode === true;
        }, 'the case on the server to mirror the login preference');
    });

    await check('the logo and background come from the login\'s stored images, and the boot overlay is lifted', async () => {
        assert.strictEqual(settings.__dom.logo.src, LOGO_DATA, 'the header logo is applied on load (it used to be lost on refresh)');
        assert.strictEqual(settings.__dom.logo.style.display, '');
        assert.ok(String(settings.document.body.style.backgroundImage).includes(BG_DATA), 'the uploaded background photo is used instead of the default');
        await waitFor(() => !settings.__html.classList.contains('sar-booting'), 'the boot overlay to be removed');
        assert.strictEqual(settings.__cookies['sar-ui-hint'], 'dark,geek', 'the hint for the next page load names the applied theme and Geek Mode');
    });

    await check('every Settings panel carries a pill naming who it is saved for', () => {
        const pills = settings.__dom.panels.map(({title, scope, panel}) => {
            const pill = panel.querySelector('.setting-scope-pill');
            assert.ok(pill, `${title} has a pill`);
            assert.ok(panel.classList.contains('has-scope-pill'));
            const name = pill.querySelector('.setting-scope-pill-name');
            return {title, scope, kind: pill.querySelector('.setting-scope-pill-kind').textContent, name: name.textContent,
                user: pill.classList.contains('setting-scope-pill--user'), login: pill.classList.contains('setting-scope-pill--login')};
        });
        assert.ok(pills.length >= 11, `all panels are tagged (${pills.length})`);
        const theme = pills.find(p => p.title === 'Theme');
        assert.strictEqual(theme.scope, 'user', 'the theme is a per-user setting');
        assert.strictEqual(theme.kind, 'User');
        assert.strictEqual(theme.user, true);
        ['Delete Mode', 'Background Image', 'Application Logo', 'Tips Display', 'Par Check Frequency', 'Map Feature Check',
            'Segment Color Scale', 'Geek Mode', 'CalTopo Proxy Settings', 'Data Synchronization'].forEach((title) => {
            const pill = pills.find(p => p.title === title);
            assert.ok(pill, `${title} is tagged`);
            assert.strictEqual(pill.scope, 'login', `${title} is a per-login setting`);
            assert.strictEqual(pill.kind, 'Login');
            assert.strictEqual(pill.name, USER, `${title} names the username that is logged in`);
            assert.strictEqual(pill.login, true);
        });
    });

    await check('the user pill names the selected user once one is picked', () => {
        settings.setCurrentUser({username: 'Alex', pin: '1400'});
        settings.renderSettingScopePills();
        const theme = settings.__dom.panels.find(p => p.title === 'Theme').panel;
        assert.strictEqual(theme.querySelector('.setting-scope-pill-name').textContent, 'Alex');
        assert.strictEqual(theme.querySelectorAll('.setting-scope-pill').length, 1, 're-rendering never doubles the pill');
        const del = settings.__dom.panels.find(p => p.title === 'Delete Mode').panel;
        assert.strictEqual(del.querySelector('.setting-scope-pill-name').textContent, USER, 'login pills keep the login username');
    });

    console.log('\nChanging settings stores them for the login');

    await check('toggling a login setting writes the login\'s preference record in the database', async () => {
        const toggle = settings.__byId['delete-mode-toggle'];
        toggle.checked = false;
        toggle.onchange();
        await waitFor(() => storedPreferences().deleteMode === false, 'deleteMode to reach user_settings');
        const tips = settings.__byId['tips-toggle'];
        tips.checked = true;
        tips.onchange();
        await waitFor(() => storedPreferences().showTips === true, 'showTips to reach user_settings');
        const par = settings.__byId['par-freq-input'];
        par.value = '30';
        par.onchange();
        await waitFor(() => storedPreferences().parCheckFrequency === 30, 'parCheckFrequency to reach user_settings');
        assert.strictEqual(settings.loadBundle().parCheckFrequency, 30, 'the open case follows');
    });

    await check('Geek Mode is a login preference applied to <html> and remembered in the hint', async () => {
        const geek = settings.__byId['geek-mode-toggle'];
        geek.checked = false;
        geek.onchange();
        await waitFor(() => storedPreferences().geekMode === false, 'geekMode to reach user_settings');
        assert.ok(!settings.__html.classList.contains('geek-mode'));
        assert.strictEqual(settings.__cookies['sar-ui-hint'], 'dark');
    });

    await check('the theme toggle changes the selected user\'s account theme and the hint for the next page', async () => {
        settings.setCurrentUser({username: 'Alex', pin: '1400'});
        settings.buildSettingsPage();
        const theme = settings.__byId['theme-toggle'];
        assert.strictEqual(theme.checked, false, 'Alex is on dark mode');
        theme.checked = true;
        theme.onchange();
        const account = settings.loadBundle().accounts.find(a => a.pin === '1400');
        assert.strictEqual(account.theme, 'light', 'stored on Alex\'s account');
        assert.ok(settings.__html.classList.contains('light-mode'));
        assert.strictEqual(settings.__cookies['sar-ui-hint'], 'light');
        await waitFor(() => storedPreferences().theme === 'light', 'the login remembers the last applied theme');
    });

    console.log('\nImages: kept for the login until removed');

    await check('choosing a logo stores it on the server under the login and shows it', async () => {
        userAssets.delete(`${USER}\u0000logo`);
        const input = settings.__byId['logo-image-input'];
        input.files = [{name: 'new-logo.png', dataUrl: LOGO_DATA}];
        await input.onchange();
        assert.strictEqual(settings.__dom.logo.src, LOGO_DATA);
        const row = userAssets.get(`${USER}\u0000logo`);
        assert.ok(row, 'stored in user_assets');
        assert.strictEqual(row.data, LOGO_DATA);
        assert.strictEqual(row.file_name, 'new-logo.png');
        assert.strictEqual(settings.loadBundle().logo, '', 'the case no longer embeds the image');
        assert.match(settings.__byId['settings-status'].textContent, /saved for your login/);
    });

    await check('choosing a background photo stores it on the server and uses it instead of the default', async () => {
        userAssets.delete(`${USER}\u0000background`);
        const input = settings.__byId['bg-image-input'];
        input.files = [{name: 'hills.jpg', dataUrl: BG_DATA}];
        await input.onchange();
        assert.ok(String(settings.document.body.style.backgroundImage).includes(BG_DATA));
        assert.strictEqual(userAssets.get(`${USER}\u0000background`).data, BG_DATA);
    });

    await check('a fresh page load (refresh) shows the stored logo and background again', async () => {
        const again = createSandbox({baseUrl, cookies: {'sar-ui-hint': settings.__cookies['sar-ui-hint']}});
        await loadPage(again);
        assert.strictEqual(again.__dom.logo.src, LOGO_DATA, 'the logo survives the refresh');
        assert.ok(String(again.document.body.style.backgroundImage).includes(BG_DATA));
        await waitFor(() => !again.__html.classList.contains('sar-booting'), 'the boot overlay to be removed');
        // The fake DOM cannot host every widget and the CalTopo proxy is
        // unreachable here; only failures of the features under test count.
        const relevant = [...again.__logs.error, ...again.__logs.warn].filter(e => /image|asset|preference|user_settings/i.test(e));
        assert.deepStrictEqual(relevant, [], `no image/preference errors: ${relevant.join(' | ')}`);
    });

    await check('"Remove Logo" and "Use Default" delete the images from the server', async () => {
        await settings.__byId['reset-logo-btn'].onclick();
        assert.ok(!userAssets.has(`${USER}\u0000logo`), 'the logo row is gone');
        assert.strictEqual(settings.__dom.logo.style.display, 'none');
        await settings.__byId['reset-bg-btn'].onclick();
        assert.ok(!userAssets.has(`${USER}\u0000background`), 'the background row is gone');
        assert.ok(String(settings.document.body.style.backgroundImage).includes('assets/us-night.jpg'), 'back to the default photo');
        const again = createSandbox({baseUrl});
        await loadPage(again);
        assert.strictEqual(again.__dom.logo.style.display, 'none', 'no logo after a refresh either');
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

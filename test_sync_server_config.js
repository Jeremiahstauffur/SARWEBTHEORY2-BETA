// The data server comes from the Railway variable CALTOPO_SYNC, and the person
// at the device is picked right after logging in.
//
// What this covers:
//   * sync-server.js publishes CALTOPO_SYNC (GET /api/config, also on
//     /api/health): an absolute http(s) URL without its trailing slash, or ''
//     when the variable is unset or malformed.
//   * app.js reads it on every page load (loadSyncServerConfig), remembers it
//     in a cookie and uses it as the default sync server AND as the CalTopo
//     proxy (<server>/api/proxy). A device that typed its own address into the
//     login popup's "Set Server" keeps it; a server that publishes nothing puts
//     the built-in bootstrap address back; an unreachable server changes nothing.
//   * The Settings page no longer has a "Data Synchronization" or "CalTopo
//     Proxy Settings" section and app.js no longer carries their wiring - the
//     login popup's "Set Server" is the only way to switch servers.
//   * After the login is verified the popup asks WHO is at the device: the
//     login's users (GET /api/auth/users, see test_login_users.js) plus the
//     personnel stored under the login in ANY case (server table `personnel`,
//     never restricted to one case), with "Anonymous" as the default and the
//     Super Admin offered but never presumed. A tab without a pick works as
//     Anonymous; "Switch User" opens the picker.
//
// Run with: node test_sync_server_config.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');

const DEFAULT_URL = 'https://sarwebtheory2-production.up.railway.app';
const PUBLISHED_URL = 'https://sar-sync.example.com';

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool, installed before sync-server.js loads.
// Only the login lookup is needed here; everything else is unreachable.
// ---------------------------------------------------------------------------
const query = (rawSql, params, cb) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        return cb(null, []);
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

// ---------------------------------------------------------------------------
// A small fake DOM: enough for createPopup() and the pickers to build their
// elements, and for the test to find pills by class and "click" them.
// ---------------------------------------------------------------------------
function makeElement(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        children: [],
        parentNode: null,
        _classes: new Set(),
        textContent: '',
        _innerHTML: '',
        value: '',
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
        insertBefore(child, before) {
            child.parentNode = el;
            const at = el.children.indexOf(before);
            if (at < 0) el.children.push(child); else el.children.splice(at, 0, child);
            return child;
        },
        remove() {
            if (el.parentNode) {
                el.parentNode.children = el.parentNode.children.filter(c => c !== el);
                el.parentNode = null;
            }
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) { el[name] = value; },
        getAttribute: (name) => (name in el ? el[name] : null),
        focus() {},
        getBoundingClientRect: () => ({width: 0, height: 0, left: 0, top: 0}),
        querySelector: (selector) => findAll(el, selector)[0] || null,
        querySelectorAll: (selector) => findAll(el, selector)
    };
    return el;
}

// ".a.b" (all classes) or "#id"; descendants only.
function matches(el, selector) {
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    const classes = selector.split('.').filter(Boolean);
    return classes.length > 0 && classes.every(c => el._classes.has(c));
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
    body.dataset.page = options.page || 'home';
    const listeners = {};
    const document = {
        get cookie() {
            return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set cookie(raw) {
            const [pair] = String(raw).split(';');
            const index = pair.indexOf('=');
            if (index <= 0) return;
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (/Expires=Thu, 01 Jan 1970/i.test(raw) || value === '') jar.delete(name);
            else jar.set(name, value);
        },
        body,
        documentElement: makeElement('html'),
        head: makeElement('head'),
        readyState: 'complete',
        activeElement: null,
        createElement: (tag) => makeElement(tag),
        createTextNode: () => makeElement('text'),
        getElementById: () => null,
        querySelector: (selector) => findAll(body, selector)[0] || null,
        querySelectorAll: (selector) => findAll(body, selector),
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent() { return true; }
    };
    const sandbox = {
        console: {log() {}, warn() {}, error() {}, info() {}},
        setTimeout: (fn, ms) => { if (!ms || ms <= 400) setTimeout(fn, 0); return 1; },
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        AbortController,
        FormData: class FormData {},
        localStorage: storage(),
        sessionStorage,
        SAR_MEMORY_STORAGE: {},
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        alert: (msg) => { sandbox.__alerts.push(String(msg)); },
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        URL,
        location: {
            hostname: options.hostname || 'jeremiah.github.io',
            protocol: options.protocol || 'https:',
            href: `${options.protocol || 'https:'}//${options.hostname || 'jeremiah.github.io'}/home.html`,
            search: '',
            reload() { sandbox.__reloads++; }
        }
    };
    sandbox.__alerts = [];
    sandbox.__reloads = 0;
    sandbox.__cookies = jar;
    sandbox.__session = sessionData;
    sandbox.__listeners = listeners;
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.showLoginPopup = () => {};
    return sandbox;
}

const jsonResponse = (payload, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload)
});
const plain = (value) => JSON.parse(JSON.stringify(value));

// If the assertions below never finish the process would otherwise end quietly
// with a success code; start out failing so only the PASS at the bottom clears it.
process.exitCode = 1;
let passed = 0;
const check = async (name, fn) => {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
};

(async () => {
    console.log('sync-server.js: CALTOPO_SYNC is published to the website');

    await check('the variable is normalised: absolute http(s) URL without a trailing slash, else nothing', () => {
        assert.strictEqual(server.CALTOPO_SYNC_ENV_KEY, 'CALTOPO_SYNC');
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: ` ${PUBLISHED_URL}/ `}), PUBLISHED_URL);
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: 'http://192.168.1.20:3000'}), 'http://192.168.1.20:3000');
        assert.strictEqual(server.getConfiguredSyncServerUrl({}), '');
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: ''}), '');
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: 'sar-sync.example.com'}), '', 'a bare host is not accepted');
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: 'ftp://sar-sync.example.com'}), '');
        assert.strictEqual(server.getConfiguredSyncServerUrl({CALTOPO_SYNC: 'https://'}), '');
        assert.deepStrictEqual(server.getPublishedSyncConfig({CALTOPO_SYNC: PUBLISHED_URL}), {
            syncServerUrl: PUBLISHED_URL,
            caltopoProxyUrl: `${PUBLISHED_URL}/api/proxy`,
            source: 'CALTOPO_SYNC'
        });
        assert.deepStrictEqual(server.getPublishedSyncConfig({}), {syncServerUrl: '', caltopoProxyUrl: '', source: 'unset'});
    });

    const httpServer = http.createServer(server.app);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    const previousEnv = process.env.CALTOPO_SYNC;

    try {
        await check('GET /api/config is public, uncached and answers the variable as it is NOW', async () => {
            process.env.CALTOPO_SYNC = `${PUBLISHED_URL}/`;
            let resp = await fetch(`${baseUrl}/api/config`);
            assert.strictEqual(resp.status, 200);
            assert.strictEqual(resp.headers.get('cache-control'), 'no-store');
            let body = await resp.json();
            assert.strictEqual(body.syncServerUrl, PUBLISHED_URL);
            assert.strictEqual(body.caltopoProxyUrl, `${PUBLISHED_URL}/api/proxy`);
            assert.strictEqual(body.source, 'CALTOPO_SYNC');

            delete process.env.CALTOPO_SYNC;
            resp = await fetch(`${baseUrl}/api/config`);
            body = await resp.json();
            assert.strictEqual(body.syncServerUrl, '', 'unset publishes nothing (read at request time, not at start)');
            assert.strictEqual(body.source, 'unset');
        });

        await check('GET /api/health carries the same address', async () => {
            process.env.CALTOPO_SYNC = PUBLISHED_URL;
            const body = await (await fetch(`${baseUrl}/api/health`)).json();
            assert.strictEqual(body.status, 'ok');
            assert.strictEqual(body.syncServerUrl, PUBLISHED_URL);
            assert.strictEqual(body.syncServerUrlSource, 'CALTOPO_SYNC');
        });
    } finally {
        if (previousEnv === undefined) delete process.env.CALTOPO_SYNC; else process.env.CALTOPO_SYNC = previousEnv;
        httpServer.close();
    }

    console.log('\napp.js: the published address is the default sync server and the CalTopo proxy');

    await check('a fresh device asks the bootstrap server and adopts what it publishes', async () => {
        const app = createSandbox();
        const asked = [];
        app.fetch = (url) => {
            asked.push(String(url));
            if (String(url).startsWith(`${DEFAULT_URL}/api/config`)) return jsonResponse({syncServerUrl: `${PUBLISHED_URL}/`, source: 'CALTOPO_SYNC'});
            return Promise.reject(new TypeError('Failed to fetch'));
        };
        assert.strictEqual(app.getSyncServerUrl(), DEFAULT_URL, 'before the first answer the built-in address is used');
        const inForce = await app.loadSyncServerConfig();
        assert.strictEqual(asked.length, 1);
        assert.ok(/\/api\/config\?_=\d+$/.test(asked[0]), asked[0]);
        assert.strictEqual(inForce, PUBLISHED_URL);
        assert.strictEqual(app.getSyncServerUrl(), PUBLISHED_URL);
        assert.strictEqual(app.getDefaultSyncServerUrl(), PUBLISHED_URL);
        assert.strictEqual(app.__cookies.get('sar-sync-url-config-v1'), PUBLISHED_URL, 'remembered for the next page load');
        assert.strictEqual(app.getCalTopoProxy(), `${PUBLISHED_URL}/api/proxy`, 'the proxy follows the sync server');
        assert.strictEqual(app.getAuthServerUrlCandidates().join(','), `${PUBLISHED_URL},${DEFAULT_URL}`,
            'login tries the published server first, the bootstrap one as a fallback');
    });

    await check('the next page load already uses the remembered address, and asks THAT server for its config', async () => {
        const app = createSandbox({cookies: {'sar-sync-url-config-v1': PUBLISHED_URL}});
        assert.strictEqual(app.getSyncServerUrl(), PUBLISHED_URL, 'known before any request is made');
        const asked = [];
        app.fetch = (url) => { asked.push(String(url)); return jsonResponse({syncServerUrl: PUBLISHED_URL}); };
        await app.loadSyncServerConfig();
        assert.ok(asked[0].startsWith(`${PUBLISHED_URL}/api/config`), asked[0]);
        assert.strictEqual(asked.length, 1);
    });

    await check('a device that set its own server in "Set Server" keeps it (that popup is the only override)', async () => {
        const app = createSandbox({cookies: {'sar-sync-url-config-v1': PUBLISHED_URL}});
        app.setLocalSyncServerUrl('https://my-own.example.com');
        const asked = [];
        app.fetch = (url) => { asked.push(String(url)); return jsonResponse({syncServerUrl: PUBLISHED_URL}); };
        await app.loadSyncServerConfig();
        assert.strictEqual(app.getSyncServerUrl(), 'https://my-own.example.com');
        assert.strictEqual(app.getCalTopoProxy(), 'https://my-own.example.com/api/proxy');
        assert.ok(asked[0].startsWith('https://my-own.example.com/api/config'), 'its own server is asked first');
        assert.strictEqual(app.getAuthServerUrlCandidates().join(','), `https://my-own.example.com,${PUBLISHED_URL},${DEFAULT_URL}`);
        // "Use Default" (setLocalSyncServerUrl('')) returns to the published address.
        app.setLocalSyncServerUrl('');
        assert.strictEqual(app.getSyncServerUrl(), PUBLISHED_URL);
    });

    await check('a server that publishes nothing puts the built-in address back; an unreachable one changes nothing', async () => {
        const app = createSandbox({cookies: {'sar-sync-url-config-v1': PUBLISHED_URL}});
        app.fetch = () => jsonResponse({syncServerUrl: '', source: 'unset'});
        await app.loadSyncServerConfig();
        assert.strictEqual(app.getSyncServerUrl(), DEFAULT_URL);
        assert.strictEqual(app.__cookies.has('sar-sync-url-config-v1'), false);

        const offline = createSandbox({cookies: {'sar-sync-url-config-v1': PUBLISHED_URL}});
        offline.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        assert.strictEqual(await offline.loadSyncServerConfig(), PUBLISHED_URL);
        assert.strictEqual(offline.getSyncServerUrl(), PUBLISHED_URL, 'the last published address stays in force');

        const broken = createSandbox();
        broken.fetch = () => jsonResponse({error: 'Not found'}, 404);
        await broken.loadSyncServerConfig();
        assert.strictEqual(broken.getSyncServerUrl(), DEFAULT_URL, 'an older server without /api/config is harmless');
    });

    await check('an http:// address published to an https:// page is ignored (the browser would block it)', async () => {
        const app = createSandbox();
        app.fetch = () => jsonResponse({syncServerUrl: 'http://192.168.1.20:3000'});
        await app.loadSyncServerConfig();
        assert.strictEqual(app.getSyncServerUrl(), DEFAULT_URL);
    });

    await check('a page opened from localhost only asks the local server', async () => {
        const app = createSandbox({hostname: 'localhost', protocol: 'http:'});
        assert.strictEqual(app.getSyncConfigServerCandidates().join(','), 'http://localhost:3000');
        assert.strictEqual(app.getCalTopoProxy(), 'http://localhost:3000/api/proxy');
    });

    await check('the page load asks for the config before anything else, and the Settings page has no server/proxy section', () => {
        const boot = appSource.slice(appSource.indexOf("document.addEventListener('DOMContentLoaded'"));
        const configAt = boot.indexOf('await withTimeout(loadSyncServerConfig()');
        assert.ok(configAt > 0, 'the DOMContentLoaded handler awaits loadSyncServerConfig()');
        assert.ok(configAt < boot.indexOf('if (!getUserCredentials())'), 'before the login check');
        assert.ok(configAt < boot.indexOf('loadServerSettings()'), 'before the per-login settings are read');

        ['sync-url-input', 'save-sync-url-btn', 'test-sync-btn', 'caltopo-proxy-input', 'save-proxy-btn', 'test-proxy-btn',
            'proxy-status-dot', 'start-walkthrough-btn', 'Data Synchronization', 'CalTopo Proxy Settings'].forEach((needle) => {
            assert.ok(!settingsHtml.includes(needle), `settings.html no longer has "${needle}"`);
            assert.ok(!appSource.includes(`'${needle}'`), `app.js no longer wires "${needle}"`);
        });
        ['SYNC_URL_STORAGE_KEY', 'CALTOPO_PROXY_STORAGE_KEY', 'checkProxyHealth', 'startCalTopoSetupWalkthrough', 'setCalTopoProxy(']
            .forEach((needle) => assert.ok(!appSource.includes(needle), `app.js no longer has ${needle}`));
        assert.ok(/function showSetServerPopup\(\)/.test(appSource), 'the login popup\'s "Set Server" stays');
        assert.ok(/setServerBtn\.textContent = 'Set Server'/.test(appSource));
        assert.ok(!/_serverSettings\[SYNC_URL/.test(appSource), 'the server address is never written into the login\'s settings');
    });

    console.log('\napp.js: who is at the device is picked after login');

    await check('the choices: Anonymous first and default, the team A-Z with their PINs, the Super Admin last and never default', () => {
        const app = createSandbox();
        const rows = [
            {label: 'Zed', data: ['Zed', 'Team 1', '', '', '', '', '', '', '1402']},
            {label: 'alex', data: ['alex', 'Team 2', '', '', '', '', '', '', '1400']},
            {label: 'Zed', data: ['Zed', '', '', '', '', '', '', '', '1402'], search_case: 'OTHER'},
            {label: 'Super Admin', data: ['Super Admin', '', '', '', '', '', '', '', '1976']},
            {label: 'Anonymous', data: ['Anonymous']},
            {label: '', data: ['', '', '']},
            ['Mia', 'Team 1', '', '', '', '', '', '', '']
        ];
        const choices = plain(app.buildLoginProfileChoices(rows));
        assert.deepStrictEqual(choices.map(c => c.user.username), ['Anonymous', 'alex', 'Mia', 'Zed', 'Super Admin']);
        assert.deepStrictEqual(choices.map(c => c.isDefault), [true, false, false, false, false]);
        assert.strictEqual(choices[0].user.pin, 'anonymous');
        assert.strictEqual(choices[0].user.isAnonymous, true);
        assert.strictEqual(choices[1].user.pin, '1400');
        assert.strictEqual(choices[2].user.pin, '', 'a row without a PIN link is still offered');
        assert.strictEqual(choices[4].user.pin, '1976');
        assert.strictEqual(choices[4].isSuperAdmin, true);
        assert.ok(app.isAnonymousUser(app.createAnonymousUser()));
        assert.ok(!app.isAnonymousUser(choices[4].user));
        assert.strictEqual(app.getAccountName(choices[0].user), 'Anonymous');
        assert.strictEqual(app.getAccountName(choices[4].user), 'Super-Admin');
        assert.deepStrictEqual(plain(app.buildLoginProfileChoices([])).map(c => c.user.username), ['Anonymous', 'Super Admin'],
            'a login without personnel still gets the two stand-ins');
    });

    await check('the people are read from the server under the login only: its user list plus its personnel in EVERY case, never one case', async () => {
        const app = createSandbox({cookies: {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234', 'sar-sync-url-config-v1': PUBLISHED_URL}});
        const asked = [];
        app.fetch = (url, init = {}) => {
            asked.push(String(url));
            if (String(url).includes('/api/auth/settings')) return jsonResponse({success: true});
            if (String(url).includes('/api/auth/users?_=')) {
                assert.strictEqual((init.headers || {})['X-User-Name'], 'tester', 'the read is authenticated');
                return jsonResponse({users: [
                    {username: 'Zoe', pin: '1401', color: 'blue', theme: 'light'},
                    {username: 'Gone', pin: '1402', removed: true}
                ]});
            }
            if (String(url).includes('/api/v1/tables/personnel?_=')) {
                assert.strictEqual((init.headers || {})['X-User-Name'], 'tester', 'the read is authenticated');
                return jsonResponse([
                    {label: 'Alex', data: ['Alex', '', '', '', '', '', '', '', '1400'], search_case: 'CASE-0'},
                    {label: 'Gone', data: ['Gone', '', '', '', '', '', '', '', '1402'], search_case: 'CASE-0'},
                    {label: 'zoe', data: ['zoe', '', '', '', '', '', '', '', '1409'], search_case: 'CASE-2'}
                ]);
            }
            return Promise.reject(new TypeError('Failed to fetch'));
        };
        await app.setSyncBucket('CASE-1');
        const choices = plain(await app.fetchLoginProfileChoices());
        assert.ok(!asked.some(u => u.includes('case=')), 'no read is restricted to the open case');
        const personnelCalls = asked.filter(u => u.includes('/api/v1/tables/personnel'));
        assert.strictEqual(personnelCalls.length, 1);
        assert.ok(personnelCalls[0].startsWith(`${PUBLISHED_URL}/api/v1/tables/personnel?_=`), personnelCalls[0]);
        assert.strictEqual(asked.filter(u => u.includes('/api/auth/users')).length, 1, 'the login\'s user list is read');
        assert.deepStrictEqual(choices.map(c => c.user.username), ['Anonymous', 'Alex', 'Zoe', 'Super Admin'],
            'the login\'s users and the personnel of other cases, a removed user never');
        assert.deepStrictEqual(choices.map(c => c.user.pin), ['anonymous', '1400', '1401', '1976'], 'the list\'s PIN wins over a case row');
        assert.strictEqual(choices[2].user.color, 'blue');
        assert.strictEqual(choices[2].user.theme, 'light');

        const loggedOut = createSandbox();
        let fetched = 0;
        loggedOut.fetch = () => { fetched++; return jsonResponse([]); };
        assert.strictEqual((await loggedOut.fetchLoginProfilePersonnel()).length, 0, 'nothing is read without credentials');
        assert.strictEqual((await loggedOut.loadLoginUsers()).length, 0);
        assert.strictEqual(fetched, 0);
    });

    await check('the picker: "Continue" (or closing it) picks Anonymous, clicking a name picks that person, once', () => {
        const app = createSandbox();
        const choices = app.buildLoginProfileChoices([{label: 'Alex', data: ['Alex', '', '', '', '', '', '', '', '1400']}]);

        let picked = [];
        let popup = app.showLoginProfilePopup(choices, (user) => picked.push(plain(user)));
        assert.ok(popup.classList.contains('login-profile-popup'));
        const pills = popup.querySelectorAll('.login-profile-pill');
        assert.deepStrictEqual(pills.map(p => p.textContent), ['Anonymous', 'Alex', 'Super Admin']);
        assert.ok(pills[0].classList.contains('active'), 'Anonymous is highlighted as the default');
        assert.ok(!pills[2].classList.contains('active'), 'the Super Admin is not');
        const continueBtn = popup.querySelector('#login-profile-continue-btn');
        assert.strictEqual(continueBtn.textContent, 'Continue as Anonymous');
        continueBtn.onclick();
        continueBtn.onclick();
        assert.strictEqual(picked.length, 1, 'onPick runs once');
        assert.strictEqual(picked[0].username, 'Anonymous');
        assert.strictEqual(picked[0].pin, 'anonymous');
        assert.ok(popup.classList.contains('fade-out'), 'the popup closes');

        popup.remove();
        picked = [];
        popup = app.showLoginProfilePopup(choices, (user) => picked.push(plain(user)));
        popup.querySelectorAll('.login-profile-pill').find(p => p.textContent === 'Alex').onclick();
        assert.deepStrictEqual(picked.map(u => [u.username, u.pin]), [['Alex', '1400']]);

        popup.remove();
        picked = [];
        popup = app.showLoginProfilePopup(choices, (user) => picked.push(plain(user)));
        popup.querySelector('.popup-close-btn').onclick();
        assert.strictEqual(picked[0].username, 'Anonymous', 'the ✕ continues as Anonymous rather than leaving nobody picked');
    });

    await check('the login success path opens the picker and only then reloads with the pick as the current user', () => {
        const login = appSource.slice(appSource.indexOf('function showLoginPopup()'), appSource.indexOf('function showAdminVerifyPopup('));
        const success = login.slice(login.indexOf('if (resp.ok && data.success)'));
        assert.ok(/sessionStorage\.removeItem\('sar-current-user'\)/.test(success), 'the login itself is not made the current user');
        assert.ok(!/setCurrentUser\(data\.user\)/.test(success), 'the login account is never presumed to be the person');
        const pickerAt = success.indexOf('showLoginProfilePopup(');
        assert.ok(pickerAt > 0, 'the picker is shown');
        assert.ok(success.indexOf('fetchLoginProfileChoices()') < pickerAt, 'with the team read from the server');
        assert.ok(success.indexOf('setCurrentUser(user)') > pickerAt && success.indexOf('window.location.reload()') > pickerAt,
            'the pick becomes the current user before the reload');
        const register = appSource.slice(appSource.indexOf('function showAdminVerifyPopup('), appSource.indexOf('const ANONYMOUS_USER_NAME'));
        assert.ok(/showLoginProfilePopup\(buildLoginProfileChoices\(\[\]\)/.test(register), 'registering a new login goes through the same pick');
    });

    await check('a tab without a pick works as Anonymous - never as the Super-Admin - and "Switch User" opens the picker', () => {
        const boot = appSource.slice(appSource.indexOf("document.addEventListener('DOMContentLoaded'"));
        const noUser = boot.slice(boot.indexOf('if (!currentUser) {'), boot.indexOf('const bell = document.getElementById'));
        assert.ok(/setCurrentUser\(createAnonymousUser\(\)\)/.test(noUser));
        assert.ok(!/a\.pin === '1976'/.test(noUser), 'the Super-Admin is no longer auto-selected');
        assert.ok(/OPEN_USER_POPUP_SESSION_KEY/.test(noUser) && /showUserSelectionPopup\(\)/.test(noUser));

        const app = createSandbox();
        app.requestUserSwitch();
        assert.strictEqual(app.__session['sar-open-user-popup'], '1');
        assert.strictEqual(app.__session['sar-current-user'], undefined);
        assert.strictEqual(app.location.href, 'home.html');
        // The account list of the in-page picker also starts with Anonymous.
        const picker = appSource.slice(appSource.indexOf('function showUserSelectionPopup()'), appSource.indexOf('function showAccountManager()'));
        assert.ok(/const accounts = \[createAnonymousUser\(\), \.\.\./.test(picker));
    });

    process.stdout.write(`\nAll ${passed} checks passed.\nCALTOPO_SYNC data server + post-login profile pick: PASS\n`, () => process.exit(0));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

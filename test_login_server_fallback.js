// Regression test: logging in from a new device must not dead-end on the
// browser's opaque "Failed to fetch" error.
//
// The bug: the login popup POSTed to whatever address getSyncServerUrl()
// returned and nothing else. When that address could not be reached (a stale
// "Set Server" value pointing at a laptop/LAN server, or an http:// address the
// browser blocks as mixed content on an https page) fetch() rejected with a
// bare TypeError and the popup simply echoed "Failed to fetch", with no
// fallback and no hint about which server it had tried.
//
// The fix drives every pre-login auth call through postAuthRequest(), which
// walks the candidate servers, remembers the one that answered and raises a
// descriptive error when none can be reached.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// APP_JS lets the pre-fix version of app.js be pointed at, to confirm this test
// really does fail without the fix.
const appJsPath = process.env.APP_JS || path.join(__dirname, 'app.js');
const source = fs.readFileSync(appJsPath, 'utf8');

function createSandbox(options = {}) {
    const store = {};
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };

    // Minimal DOM: app.js only needs enough to finish loading.
    const makeElement = () => {
        const el = {
            style: {},
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
            querySelector: () => null,
            querySelectorAll: () => [],
            insertBefore() {},
            after() {},
            focus() {},
            textContent: '',
            innerHTML: ''
        };
        return el;
    };

    // Cookie jar with the same "name=value; name2=value2" shape a browser
    // exposes, because the device's sync-server URL lives in a cookie.
    const jar = new Map();
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
            if (/Expires=Thu, 01 Jan 1970/i.test(raw) || value === '') {
                jar.delete(name);
            } else {
                jar.set(name, value);
            }
        },
        body: makeElement(),
        documentElement: makeElement(),
        head: makeElement(),
        readyState: 'complete',
        createElement: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };

    const sandbox = {
        console: {log() {}, warn() {}, error() {}, info() {}},
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        clearInterval,
        localStorage,
        sessionStorage: localStorage,
        document,
        navigator: {userAgent: 'node'},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: () => Promise.reject(new Error('no fetch stub installed')),
        location: {
            hostname: options.hostname || 'jeremiah.github.io',
            protocol: options.protocol || 'https:',
            href: `${options.protocol || 'https:'}//${options.hostname || 'jeremiah.github.io'}/home.html`,
            search: '',
            reload() {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, {filename: 'app.js'});

    if (options.deviceServerUrl) {
        sandbox.setLocalSyncServerUrl(options.deviceServerUrl);
    }
    return sandbox;
}

// A browser reports an unreachable/blocked address exactly like this.
const failedToFetch = () => Promise.reject(new TypeError('Failed to fetch'));
const okResponse = (url) => Promise.resolve({
    ok: true,
    status: 200,
    url,
    json: () => Promise.resolve({success: true, user: {username: 'jane', pin: '1234'}})
});

const DEFAULT_URL = 'https://sarwebtheory2-production.up.railway.app';

(async () => {
    // --- 1. A stale, unreachable "Set Server" address falls back to the public
    //        backend, and the address that answered is remembered ------------
    {
        const app = createSandbox({deviceServerUrl: 'https://old-server.example.com'});
        const tried = [];
        app.fetch = (url) => {
            tried.push(url);
            if (url.startsWith(DEFAULT_URL)) return okResponse(url);
            return failedToFetch();
        };

        const {resp, serverUrl} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'});
        assert.deepStrictEqual(tried, [
            'https://old-server.example.com/api/auth/login',
            `${DEFAULT_URL}/api/auth/login`
        ], 'the configured server must be tried first, then the public backend');
        assert.ok(resp.ok, 'the fallback server response must be returned');
        assert.strictEqual(serverUrl, DEFAULT_URL);
        assert.strictEqual(app.getLocalSyncServerUrl(), DEFAULT_URL,
            'the server that answered must be persisted so later data calls reach it too');
    }

    // --- 2. An http:// address on an https page is skipped, not fetched -----
    {
        const app = createSandbox({deviceServerUrl: 'http://192.168.1.50:3000'});
        const tried = [];
        app.fetch = (url) => {
            tried.push(url);
            return okResponse(url);
        };

        assert.strictEqual(app.isBlockedMixedContentUrl('http://192.168.1.50:3000'), true);
        assert.strictEqual(app.isBlockedMixedContentUrl('http://localhost:3000'), false,
            'loopback is a secure context and must stay usable');

        const {serverUrl} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'});
        assert.deepStrictEqual(tried, [`${DEFAULT_URL}/api/auth/login`],
            'the mixed-content address must be skipped instead of failing with "Failed to fetch"');
        assert.strictEqual(serverUrl, DEFAULT_URL);
    }

    // --- 3. When nothing is reachable the error explains what to do --------
    {
        const app = createSandbox({deviceServerUrl: 'https://old-server.example.com'});
        app.fetch = failedToFetch;

        await assert.rejects(
            () => app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}),
            (error) => {
                const message = String(error.message);
                assert.ok(/Cannot reach the sync server/i.test(message), message);
                assert.ok(message.includes('old-server.example.com'), 'the addresses tried must be named');
                assert.ok(message.includes(DEFAULT_URL), 'the fallback address must be named');
                assert.ok(/Set Server/.test(message), 'the user must be told how to fix it');
                assert.notStrictEqual(message.trim(), 'Failed to fetch');
                return true;
            }
        );
    }

    // --- 4. Local development must not silently talk to production ---------
    {
        const app = createSandbox({hostname: 'localhost', protocol: 'http:'});
        // Joined rather than deep-compared: arrays built inside the sandbox have
        // their own Array prototype, so deepStrictEqual would reject them.
        assert.strictEqual(app.getAuthServerUrlCandidates().join(','), 'http://localhost:3000',
            'a page opened from localhost must only target the local sync server');
    }

    // --- 5. Only network-level failures trigger the fallback ---------------
    {
        const app = createSandbox({deviceServerUrl: 'https://old-server.example.com'});
        assert.strictEqual(app.isNetworkFetchError(new TypeError('Failed to fetch')), true);
        assert.strictEqual(app.isNetworkFetchError(new TypeError('Load failed')), true, 'iOS Safari wording');
        assert.strictEqual(app.isNetworkFetchError(new Error('no matching login found')), false);

        let calls = 0;
        app.fetch = () => {
            calls += 1;
            return Promise.reject(new Error('boom'));
        };
        await assert.rejects(() => app.postAuthRequest('/api/auth/login', {}), /boom/);
        assert.strictEqual(calls, 1, 'a non-network error must surface immediately, not retry');
    }

    console.log('Login sync-server fallback / "Failed to fetch" diagnostics: PASS');
    // app.js schedules its own background sync timers on load; exit before they
    // fire so they cannot poke the fake DOM after the assertions are done.
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

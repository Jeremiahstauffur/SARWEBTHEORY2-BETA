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
        // The auth requests abort themselves on a timeout, so the sandbox needs
        // the same primitive a browser provides.
        AbortController,
        // getAuthHeaders() checks whether the extra headers are a FormData
        // instance, so the sandbox needs that browser global too.
        FormData: typeof FormData !== 'undefined' ? FormData : class FormData {},
        XMLHttpRequest: options.XMLHttpRequest,
        localStorage,
        sessionStorage: localStorage,
        document,
        navigator: {userAgent: 'node', onLine: options.onLine !== false},
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

    // app.js schedules a background sync that opens the login popup when no
    // credentials are stored. There is no real DOM here, so neutralize it; the
    // popup itself is not what this test exercises.
    sandbox.showLoginPopup = () => {};

    if (options.deviceServerUrl) {
        sandbox.setLocalSyncServerUrl(options.deviceServerUrl);
    }
    return sandbox;
}

// If the assertions below never finish (a request that is awaited forever) the
// process would otherwise end quietly with a success code; start out failing so
// only the explicit PASS at the bottom can clear it.
process.exitCode = 1;

// A browser reports an unreachable/blocked address exactly like this.
const failedToFetch = () => Promise.reject(new TypeError('Failed to fetch'));

// A server that accepts the connection and then never answers - a sleeping
// container, or a network that silently drops the packets. Like a real fetch,
// it only gives up when the abort signal fires.
const neverAnswers = (url, options = {}) => new Promise((resolve, reject) => {
    const signal = options.signal;
    if (!signal) return;
    const abort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort);
});
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

        const {resp, serverUrl} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {attempts: 1, transports: ['json']});
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

        const {serverUrl} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {attempts: 1, transports: ['json']});
        assert.deepStrictEqual(tried, [`${DEFAULT_URL}/api/auth/login`],
            'the mixed-content address must be skipped instead of failing with "Failed to fetch"');
        assert.strictEqual(serverUrl, DEFAULT_URL);
    }

    // --- 3. When nothing is reachable the error explains what to do --------
    {
        const app = createSandbox({deviceServerUrl: 'https://old-server.example.com'});
        app.fetch = failedToFetch;

        await assert.rejects(
            () => app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {attempts: 1, transports: ['json']}),
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

    // --- 6. A cold backend that misses the first attempt still logs in -----
    //        (the reported "it is trying but failing to reach the server")
    {
        const app = createSandbox();
        let calls = 0;
        app.fetch = (url, options) => {
            calls += 1;
            // First attempt hangs long enough for the request to time out; the
            // retry succeeds, exactly like a container waking from idle.
            if (calls === 1) return neverAnswers(url, options);
            return okResponse(url);
        };

        const {resp} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {
            attempts: 3,
            timeoutMs: 150,
            transports: ['json']
        });
        assert.ok(resp.ok, 'the retry must recover a login the first attempt lost');
        assert.strictEqual(calls, 2, 'exactly one retry was needed');
    }

    // --- 7. A request that never answers is reported as a timeout, not as a
    //        silent hang ---------------------------------------------------
    {
        const app = createSandbox();
        app.fetch = neverAnswers;

        const result = await app.checkSyncServerReachable(DEFAULT_URL, 150);
        assert.strictEqual(result.ok, false);
        assert.ok(/timed out/i.test(result.detail), `expected a timeout detail, got: ${result.detail}`);
    }

    // --- 8. The health probe reports a reachable server --------------------
    {
        const app = createSandbox();
        const tried = [];
        app.fetch = (url) => {
            tried.push(url);
            return Promise.resolve({ok: true, status: 200, url});
        };

        const result = await app.checkSyncServerReachable(DEFAULT_URL);
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(tried, [`${DEFAULT_URL}/api/health`],
            'the reachability probe must hit the unauthenticated health endpoint');
    }

    // --- 9. An offline device is told so, instead of being blamed on the
    //        server address ------------------------------------------------
    {
        const app = createSandbox({onLine: false});
        app.fetch = failedToFetch;

        await assert.rejects(
            () => app.postAuthRequest('/api/auth/login', {}, {attempts: 1, transports: ['json']}),
            (error) => {
                assert.ok(/offline/i.test(error.message), error.message);
                return true;
            }
        );
    }

    // --- 10. A device whose CORS preflight is blocked (the Windows 10 laptop:
    //         "tried the default good sync url with no success") still logs in
    //         through the preflight-free request, and remembers it ----------
    {
        const app = createSandbox();
        const seen = [];
        app.fetch = (url, options = {}) => {
            const contentType = (options.headers || {})['Content-Type'] || '';
            seen.push(contentType);
            // Anything that is not a CORS "simple request" needs an OPTIONS
            // preflight first, and on this device that preflight never gets an
            // answer - which the browser reports as "Failed to fetch".
            if (/application\/json/i.test(contentType)) return failedToFetch();
            return okResponse(url);
        };

        const {resp, transport} = await app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {attempts: 1});
        assert.ok(resp.ok, 'the preflight-free request must be able to log in');
        assert.strictEqual(transport, 'simple');
        assert.ok(/text\/plain/i.test(seen[seen.length - 1]),
            `the fallback must be sent as a simple request, got: ${seen.join(' | ')}`);
        assert.strictEqual(app.isPreflightFallbackEnabled(), true,
            'the device must remember that it needs the preflight-free path');
    }

    // --- 11. Once remembered, the authenticated data calls avoid the
    //         preflight too: no X-... headers, no application/json, and
    //         DELETE tunnelled through POST ---------------------------------
    {
        const app = createSandbox();
        app.setPreflightFallbackEnabled(true);
        app.setCookie('sar-user-name-v1', 'jane');
        app.setCookie('sar-user-password-v1', '1234');

        const calls = [];
        app.fetch = (url, options = {}) => {
            calls.push({url, options});
            return Promise.resolve({ok: true, status: 200, url, json: () => Promise.resolve({})});
        };

        await app.apiFetch(`${DEFAULT_URL}/api/v1/CASE1/bundle`, {
            method: 'DELETE',
            headers: app.getAuthHeaders()
        });

        const call = calls[0];
        assert.strictEqual(call.options.method, 'POST',
            'DELETE is not a CORS simple method, so it must be tunnelled through POST');
        assert.ok(call.url.includes('_method=DELETE'), call.url);
        assert.ok(call.url.includes('_h_x_user_name=jane'), call.url);
        assert.ok(call.url.includes('_h_x_user_password=1234'), call.url);
        Object.keys(call.options.headers).forEach((name) => {
            assert.ok(!/^x-/i.test(name), `custom header ${name} would re-introduce the preflight`);
        });
        assert.ok(!/application\/json/i.test(call.options.headers['Content-Type'] || ''),
            'an application/json body would re-introduce the preflight');

        // With the fallback off, the request must stay exactly as it was.
        app.setPreflightFallbackEnabled(false);
        calls.length = 0;
        await app.apiFetch(`${DEFAULT_URL}/api/v1/CASE1/bundle`, {
            method: 'DELETE',
            headers: app.getAuthHeaders()
        });
        assert.strictEqual(calls[0].options.method, 'DELETE');
        assert.strictEqual(calls[0].url, `${DEFAULT_URL}/api/v1/CASE1/bundle`);
        assert.strictEqual(calls[0].options.headers['X-User-Name'], 'jane');
    }

    // --- 12. The "Test" button distinguishes a blocked preflight from a
    //         server that is really unreachable ----------------------------
    {
        const app = createSandbox();
        app.fetch = (url, options = {}) => {
            const contentType = (options.headers || {})['Content-Type'] || '';
            if (/application\/json/i.test(contentType)) return failedToFetch();
            return Promise.resolve({ok: true, status: 400, url, json: () => Promise.resolve({})});
        };

        const diagnosis = await app.diagnoseSyncServerConnection(DEFAULT_URL);
        assert.strictEqual(diagnosis.ok, true);
        assert.strictEqual(diagnosis.preflightBlocked, true,
            'a health check that works while the JSON login fails means the preflight is blocked');
        const report = diagnosis.lines.join('\n');
        assert.ok(/compatibility mode/i.test(report), report);

        // Nothing reachable at all must NOT be reported as a preflight problem.
        const dead = createSandbox();
        dead.fetch = failedToFetch;
        const deadDiagnosis = await dead.diagnoseSyncServerConnection(DEFAULT_URL);
        assert.strictEqual(deadDiagnosis.ok, false);
        assert.strictEqual(deadDiagnosis.preflightBlocked, false);
        assert.strictEqual(deadDiagnosis.serverReachable, false);
    }

    // --- 13. A backend that has not been redeployed with the compatibility
    //         middleware answers the preflight-free request with a 500. That
    //         must not be mistaken for a working path ---------------------
    {
        const app = createSandbox();
        app.fetch = (url, options = {}) => {
            const contentType = (options.headers || {})['Content-Type'] || '';
            if (/application\/json/i.test(contentType)) return failedToFetch();
            return Promise.resolve({ok: false, status: 500, url, json: () => Promise.resolve({})});
        };

        await assert.rejects(
            () => app.postAuthRequest('/api/auth/login', {username: 'jane', pin: '1234'}, {attempts: 1}),
            (error) => {
                assert.ok(/Cannot reach the sync server/i.test(error.message), error.message);
                return true;
            }
        );
        assert.strictEqual(app.isPreflightFallbackEnabled(), false,
            'a 500 from an outdated server must not switch this device to compatibility mode');

        const diagnosis = await app.diagnoseSyncServerConnection(DEFAULT_URL);
        assert.strictEqual(diagnosis.ok, false);
        assert.strictEqual(diagnosis.preflightBlocked, false);
        assert.ok(/updated\/redeployed/i.test(diagnosis.lines.join('\n')), diagnosis.lines.join('\n'));
    }

    // app.js schedules its own background sync timers on load; exit before they
    // fire so they cannot poke the fake DOM after the assertions are done. The
    // exit waits for the result line to be flushed, which process.exit() alone
    // does not guarantee on a piped stdout.
    process.stdout.write('Login sync-server fallback / "Failed to fetch" diagnostics: PASS\n', () => process.exit(0));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

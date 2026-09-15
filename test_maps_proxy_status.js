// The Maps page "Proxy Status" dot.
//
// The dot used to be rendered with "Checking..." and nothing ever updated it:
// the function that did (checkProxyHealth, part of the Settings page's removed
// "CalTopo Proxy Settings" section) went with that section, while the Maps
// page kept the markup. The indicator now has its own probe:
//   * refreshMapsProxyStatus() GETs <sync server>/api/health (the proxy IS the
//     sync server) and paints green "Connected", amber when the server is up
//     but has no CalTopo credentials, red when it answers with an HTTP error,
//     and grey "Unproven Connection" when the address could not be tested at
//     all (no answer, or the browser would not send the request).
//   * the answer is remembered for MAPS_PROXY_STATUS_RECHECK_INTERVAL_MS so the
//     page's frequent rebuilds paint it at once instead of "Checking..." and do
//     not ask the server again; clicking the dot forces a fresh probe; a probe
//     already running is shared.
//   * buildMapsPage() wires all of that, under ids of its own (the old
//     'proxy-status-dot' id is pinned as gone by test_sync_server_config.js).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function makeElement() {
    const el = {
        style: {},
        dataset: {},
        children: [],
        textContent: '',
        title: '',
        className: '',
        classList: {add() {}, remove() {}, contains: () => false, toggle() {}},
        appendChild(child) { el.children.push(child); return child; },
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {}
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set: (value) => { html = String(value); el.children = []; }
    });
    return el;
}

// `clock.now` is what Date.now() answers inside the sandbox, so the "remembered
// answer goes stale" branch can be reached without waiting.
function createSandbox({fetch, clock}) {
    const byId = {};
    const document = {
        cookie: '',
        body: Object.assign(makeElement(), {dataset: {page: 'page10'}}),
        documentElement: makeElement(),
        head: makeElement(),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        createElement: () => makeElement(),
        createTextNode: () => makeElement(),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [clock.now]));
        }
        static now() { return clock.now; }
    }
    const sandbox = {
        console: {log() {}, info() {}, warn() {}, error() {}},
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        Date: FakeDate,
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        FormData: class FormData {},
        localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
        sessionStorage: {getItem: () => null, setItem() {}, removeItem() {}},
        SAR_MEMORY_STORAGE: {},
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        alert() {},
        fetch: (url, init) => fetch(url, init),
        URL,
        URLSearchParams,
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', search: '', pathname: '/page10.html', href: 'http://localhost/page10.html'}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__byId = byId;
    return sandbox;
}

const json = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
const HEALTH_URL = 'http://localhost:3000/api/health';

// A sync server whose /api/health answers `health` (a function of the call
// count, so one server can change its mind); every health call is recorded.
function createServer(health) {
    const calls = [];
    const fetch = async (url) => {
        const text = String(url);
        if (text.startsWith(HEALTH_URL)) {
            calls.push(text);
            const answer = await (typeof health === 'function' ? health(calls.length) : health);
            if (answer instanceof Error) throw answer;
            return answer;
        }
        return json({success: true});
    };
    return {fetch, calls};
}

const dot = (app) => app.__byId['maps-proxy-status-dot'];
const text = (app) => app.__byId['maps-proxy-status-text'];

const checks = [];
const check = (name, fn) => checks.push({name, fn});

check('buildMapsPage renders the dot under its own ids and asks for the status', () => {
    const start = appSource.indexOf('function buildMapsPage()');
    const body = appSource.slice(start, appSource.indexOf('function renderUnaccountedFeaturesPanel()', start));
    assert.ok(body.includes('id="maps-proxy-status-dot"'), 'the dot');
    assert.ok(body.includes('id="maps-proxy-status-text"'), 'its text');
    assert.ok(body.includes('id="maps-proxy-status"'), 'the clickable group');
    assert.ok(/refreshMapsProxyStatus\(\);/.test(body), 'the status is refreshed on every build');
    assert.ok(/proxyStatusEl\.onclick = \(\) => refreshMapsProxyStatus\(\{force: true\}\)/.test(body), 'a click forces a fresh probe');
    assert.ok(!body.includes('id="proxy-status-dot"'), 'the orphaned Settings-era id is gone');
    assert.ok(/^const MAPS_PROXY_STATUS_RECHECK_INTERVAL_MS = \d+;/m.test(appSource), 'the recheck interval is declared at the top');
});

check('a healthy server with CalTopo credentials: green "Connected"', async () => {
    const server = createServer(json({status: 'ok', caltopoSigningConfigured: true, message: 'Unified server is live.'}));
    const app = createSandbox({fetch: server.fetch, clock: {now: 1000000}});
    const status = await app.refreshMapsProxyStatus();
    assert.strictEqual(server.calls.length, 1);
    assert.ok(/^http:\/\/localhost:3000\/api\/health\?_=\d+$/.test(server.calls[0]), `the proxy's server is asked for its health: ${server.calls[0]}`);
    assert.strictEqual(status.state, 'ok');
    assert.strictEqual(text(app).textContent, 'Connected');
    assert.strictEqual(dot(app).style.background, '#40c057');
    assert.ok(text(app).title.includes('http://localhost:3000/api/proxy'), 'the tooltip names the proxy');
    assert.ok(text(app).title.includes('Unified server is live.'), 'and repeats the server\'s message');
});

check('a server that is up but cannot sign CalTopo requests: amber warning', async () => {
    const server = createServer(json({status: 'ok', caltopoSigningConfigured: false, message: 'Set CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET.'}));
    const app = createSandbox({fetch: server.fetch, clock: {now: 1000000}});
    const status = await app.refreshMapsProxyStatus();
    assert.strictEqual(status.state, 'warn');
    assert.strictEqual(text(app).textContent, 'Server up, CalTopo credentials missing');
    assert.strictEqual(dot(app).style.background, '#f59f00');
    assert.strictEqual(text(app).title, 'Set CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET.');
});

check('a URL that cannot be tested (no answer): grey "Unproven Connection" with the reason', async () => {
    const server = createServer(new TypeError('Failed to fetch'));
    const app = createSandbox({fetch: server.fetch, clock: {now: 1000000}});
    const status = await app.refreshMapsProxyStatus();
    assert.strictEqual(status.state, 'unproven');
    assert.strictEqual(text(app).textContent, 'Unproven Connection');
    assert.strictEqual(dot(app).style.background, '#868e96');
    assert.ok(/could not be tested: could not connect/.test(text(app).title), text(app).title);

    const timeout = Object.assign(new Error('timed out after 8s'), {isTimeout: true});
    const slow = createSandbox({fetch: createServer(timeout).fetch, clock: {now: 1000000}});
    assert.strictEqual((await slow.refreshMapsProxyStatus()).state, 'unproven');
    assert.strictEqual(text(slow).textContent, 'Unproven Connection');
    assert.ok(/timed out/.test(text(slow).title), text(slow).title);
});

check('an http:// proxy from an https:// page cannot be tested either: "Unproven Connection"', async () => {
    const app = createSandbox({fetch: createServer(json({})).fetch, clock: {now: 1000000}});
    app.location.protocol = 'https:';
    app.location.hostname = 'example.github.io';
    const status = await app.probeMapsProxyStatus('http://192.168.1.20:3000/api/proxy');
    assert.strictEqual(status.state, 'unproven');
    assert.strictEqual(status.text, 'Unproven Connection');
    assert.ok(/could not be tested: this page is served over HTTPS/.test(status.detail), status.detail);
});

check('an HTTP error: red with the status code and the server\'s message', async () => {
    const server = createServer(json({error: 'Down', message: 'Database unavailable'}, 503));
    const app = createSandbox({fetch: server.fetch, clock: {now: 1000000}});
    const status = await app.refreshMapsProxyStatus();
    assert.strictEqual(status.state, 'error');
    assert.strictEqual(text(app).textContent, 'Error (HTTP 503)');
    assert.strictEqual(text(app).title, 'Database unavailable');
});

check('a health answer that is not JSON still counts as an answer', async () => {
    const server = createServer({ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); }});
    const app = createSandbox({fetch: server.fetch, clock: {now: 1000000}});
    const status = await app.refreshMapsProxyStatus();
    assert.strictEqual(status.state, 'ok');
    assert.strictEqual(text(app).textContent, 'Connected');
});

check('no sync server at all: grey "No proxy" pointing at Set Server', async () => {
    const app = createSandbox({fetch: createServer(json({})).fetch, clock: {now: 1000000}});
    const status = await app.probeMapsProxyStatus('');
    assert.strictEqual(status.state, 'none');
    assert.strictEqual(status.text, 'No proxy');
    assert.ok(/Set Server/.test(status.detail));
});

check('the answer is remembered: rebuilds paint it at once, a click or a stale answer asks again, a running probe is shared', async () => {
    const clock = {now: 1000000};
    let pending = [];
    const server = createServer(() => new Promise((resolve) => pending.push(resolve)));
    const app = createSandbox({fetch: server.fetch, clock});

    const first = app.refreshMapsProxyStatus();
    assert.strictEqual(text(app).textContent, 'Checking...', 'nothing known yet');
    assert.strictEqual(dot(app).style.background, '#ccc');
    const shared = app.refreshMapsProxyStatus();
    assert.strictEqual(server.calls.length, 1, 'a second request while the probe runs does not ask again');
    assert.strictEqual(shared, first, 'it shares the running probe');
    pending.shift()(json({status: 'ok', caltopoSigningConfigured: true}));
    assert.strictEqual((await first).state, 'ok');
    assert.strictEqual(text(app).textContent, 'Connected');

    // The page is rebuilt (another device changed something): the dot is
    // painted from memory, the server is left alone.
    text(app).textContent = 'Checking...';
    clock.now += 5000;
    const again = await app.refreshMapsProxyStatus();
    assert.strictEqual(server.calls.length, 1, 'no new probe inside the recheck interval');
    assert.strictEqual(again.state, 'ok');
    assert.strictEqual(text(app).textContent, 'Connected', 'painted at once from the remembered answer');

    // Clicking the dot forces a probe.
    const forced = app.refreshMapsProxyStatus({force: true});
    assert.strictEqual(server.calls.length, 2, 'force asks again');
    assert.strictEqual(text(app).textContent, 'Checking...');
    pending.shift()(json({status: 'ok', caltopoSigningConfigured: false, message: 'no creds'}));
    assert.strictEqual((await forced).state, 'warn');
    assert.strictEqual(text(app).textContent, 'Server up, CalTopo credentials missing');

    // Once the remembered answer is older than the interval a rebuild probes again.
    clock.now += vm.runInContext('MAPS_PROXY_STATUS_RECHECK_INTERVAL_MS', app) + 1;
    const stale = app.refreshMapsProxyStatus();
    assert.strictEqual(server.calls.length, 3, 'a stale answer is checked again');
    pending.shift()(new TypeError('Failed to fetch'));
    assert.strictEqual((await stale).state, 'unproven');
    assert.strictEqual(text(app).textContent, 'Unproven Connection');
});

(async () => {
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (error) {
            failed++;
            console.error(`  FAIL - ${name}`);
            console.error(error && error.stack ? error.stack : error);
        }
    }
    if (failed) {
        console.error(`test_maps_proxy_status: ${failed} check(s) failed`);
        process.exit(1);
    }
    console.log('test_maps_proxy_status: PASS');
})();

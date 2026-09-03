// Regression test: the All Members page (page3) must persist the GPS, Radio and
// Medic toggles.
//
// The bug: sanitizeBundle() rebuilds the saved bundle from a fixed list of keys
// and did not include `permanentPersonnel`, while splitPersonnelData() blanked
// columns 3/4/5 out of every personnel row because those values were supposed
// to live in that map. The map was therefore dropped on every load AND save, so
// the three toggles were wiped immediately after being clicked and never
// reached the server.
//
// This test drives the real app.js helpers (loadData / saveCurrentPageData) in a
// sandbox with a fake localStorage and asserts a toggled role survives a
// save + reload round-trip and is present in the bundle that gets uploaded.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// APP_JS lets the pre-fix version of app.js be pointed at, to confirm this test
// really does fail without the fix.
const appJsPath = process.env.APP_JS || path.join(__dirname, 'app.js');
const source = fs.readFileSync(appJsPath, 'utf8');

function createSandbox() {
    const store = {};
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };

    // Minimal DOM: only what app.js touches while loading and while saving a
    // personnel page. Anything unknown resolves to a harmless stub.
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

    const body = makeElement();
    body.dataset.page = 'page3';

    const document = {
        cookie: '',
        body,
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
        console,
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
        // No server configured -> saveBundle() never tries to push anything.
        fetch: () => Promise.reject(new Error('no network in test')),
        location: {hostname: 'localhost', protocol: 'http:', href: 'http://localhost/page3.html', search: ''}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, {filename: 'app.js'});
    return sandbox;
}

const app = createSandbox();

// --- Seed one member, exactly like the personnel page would ------------------
const seedRow = Array.from({length: 14}, () => '');
seedRow[0] = 'Jane Doe';
seedRow[1] = 'Alpha';
seedRow[6] = 'Enroute';
app.saveCurrentPageData([seedRow]);

// --- Toggle GPS + Medic on, the way the All Members checkboxes do ------------
const data = app.loadData();
const jane = data.find(row => row[0] === 'Jane Doe');
assert.ok(jane, 'seeded member should be loadable');
jane[3] = 'true';  // GPS
jane[5] = 'true';  // Medic
app.saveCurrentPageData(data);

// --- 1. The toggles survive a reload ----------------------------------------
const reloaded = app.loadData().find(row => row[0] === 'Jane Doe');
assert.strictEqual(reloaded[3], 'true', 'GPS must survive a save + reload');
assert.strictEqual(reloaded[4], '', 'Radio must stay off');
assert.strictEqual(reloaded[5], 'true', 'Medic must survive a save + reload');

// --- 2. They are in the personnel row that is uploaded to the server --------
const bundle = app.loadBundle();
const storedRow = bundle.pages.page3.find(row => row[0] === 'Jane Doe');
assert.ok(storedRow, 'the member row must be in the saved bundle');
assert.strictEqual(storedRow[3], 'true', 'GPS must be in the synced personnel row');
assert.strictEqual(storedRow[5], 'true', 'Medic must be in the synced personnel row');

// --- 3. The global roles map is no longer thrown away by the sanitizer ------
assert.ok(bundle.permanentPersonnel, 'permanentPersonnel must be preserved');
assert.strictEqual(bundle.permanentPersonnel['Jane Doe'].gps, 'true');
assert.strictEqual(bundle.permanentPersonnel['Jane Doe'].medic, 'true');

// --- 4. Turning a role back off sticks (it must not be re-enabled) ----------
const data2 = app.loadData();
data2.find(row => row[0] === 'Jane Doe')[3] = 'false';
app.saveCurrentPageData(data2);
const afterOff = app.loadData().find(row => row[0] === 'Jane Doe');
assert.strictEqual(afterOff[3], 'false', 'unchecking GPS must stick');
assert.strictEqual(afterOff[5], 'true', 'Medic must be untouched by the GPS change');

console.log('All Members GPS/Radio/Medic toggle persistence: PASS');

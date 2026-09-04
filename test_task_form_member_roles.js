// Regression test: the Task Assignment form must pre-fill each team member's
// GPS / Radio / Medic checkboxes from the All Members (page3) roster.
//
// The bug: buildTaskAssignmentForm() auto-created every member with
// gps/radio/medic hardcoded to false, ignoring columns 3/4/5 of the roster
// row. Forms that were created before the fix also need a one-time seed from
// the roster without clobbering roles the user toggled on the form afterwards.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appJsPath = process.env.APP_JS || path.join(__dirname, 'app.js');
const source = fs.readFileSync(appJsPath, 'utf8');

function createSandbox() {
    const store = {};
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
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
    body.dataset.page = 'page5';
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
        fetch: () => Promise.reject(new Error('no network in test')),
        location: {hostname: 'localhost', protocol: 'http:', href: 'http://localhost/page5.html', search: ''}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, {filename: 'app.js'});
    return sandbox;
}

const app = createSandbox();

const makeRow = (name, team, lead, gps, radio, medic) => {
    const row = Array.from({length: 14}, () => '');
    row[0] = name;
    row[1] = team;
    row[2] = lead;
    row[3] = gps;
    row[4] = radio;
    row[5] = medic;
    row[6] = 'On-Scene';
    return row;
};

const roster = [
    makeRow('Jane Doe', 'Alpha', 'Jane Doe', 'true', '', 'true'),
    makeRow('John Roe', 'Alpha', 'Jane Doe', 'false', 'true', ''),
    makeRow('Sam Poe', 'Bravo', 'Sam Poe', 'true', 'true', 'true')
];

// --- 1. A newly auto-created member carries the roster roles ----------------
const jane = app.buildTaskFormMemberFromRoster(roster[0]);
assert.strictEqual(jane.name, 'Jane Doe');
assert.strictEqual(jane.leader, true, 'team lead must be flagged as leader');
assert.strictEqual(jane.gps, true, 'GPS must be pre-filled from the roster');
assert.strictEqual(jane.radio, false, 'Radio must stay off when not set on the roster');
assert.strictEqual(jane.medic, true, 'Medic must be pre-filled from the roster');

const john = app.buildTaskFormMemberFromRoster(roster[1]);
assert.strictEqual(john.leader, false);
assert.strictEqual(john.gps, false);
assert.strictEqual(john.radio, true, 'Radio must be pre-filled from the roster');
assert.strictEqual(john.medic, false);

// --- 2. Forms created before the fix get seeded once from the roster --------
const legacyMembers = [
    {name: 'Jane Doe', leader: true, gps: false, radio: false, medic: false},
    {name: 'John Roe', leader: false, gps: false, radio: false, medic: false},
    {name: 'Nobody Known', leader: false, gps: false, radio: false, medic: false}
];
assert.strictEqual(app.syncTaskFormMemberRolesFromRoster(legacyMembers, roster), true, 'seeding must report a change');
assert.strictEqual(legacyMembers[0].gps, true);
assert.strictEqual(legacyMembers[0].medic, true);
assert.strictEqual(legacyMembers[0].radio, false);
assert.strictEqual(legacyMembers[1].radio, true);
assert.strictEqual(legacyMembers[2].gps, false, 'members not on the roster are left alone');
assert.strictEqual(legacyMembers[2].rolesLoaded, undefined);

// --- 3. Roles the user unchecked on the form are not re-enabled --------------
legacyMembers[0].gps = false;
assert.strictEqual(app.syncTaskFormMemberRolesFromRoster(legacyMembers, roster), false, 'already-seeded members must not change');
assert.strictEqual(legacyMembers[0].gps, false, 'a role unchecked on the form must stick');

// --- 4. Members freshly built from the roster are never re-seeded -----------
const fresh = [app.buildTaskFormMemberFromRoster(roster[2])];
fresh[0].medic = false;
assert.strictEqual(app.syncTaskFormMemberRolesFromRoster(fresh, roster), false);
assert.strictEqual(fresh[0].medic, false);

console.log('Task Assignment form GPS/Radio/Medic pre-fill: PASS');

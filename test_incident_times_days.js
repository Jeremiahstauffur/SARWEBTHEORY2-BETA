// Regression tests for the day-based Incident Times Report.
//
// The report (Forms page "Incident Times", mobile status page, Member Reports)
// keeps one table per DAY of the incident - Name | Enroute | On Scene |
// Returning | Arrived Home | Hours On Scene - in bundle.incidentDays. Day
// buttons next to the report title show the earliest Enroute date of that day
// ("Day N" until someone is enroute) and a "+" adds the next day; the old
// "Add Row" / "Add Incident Row" affordances are gone. The Forms page "Print
// Report" and the Case # Printout (compactly) print the same tables.
//
// Run with: node test_incident_times_days.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';

// Objects built inside the vm have the context's prototypes; deepStrictEqual
// compares prototypes, so sandbox values are passed through JSON first.
const plain = value => JSON.parse(JSON.stringify(value));

function makeElement(depth = 0) {
    const classes = new Set();
    const el = {
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {
            add(...c) { c.forEach(x => classes.add(x)); },
            remove(...c) { c.forEach(x => classes.delete(x)); },
            contains: (c) => classes.has(c),
            toggle(c, force) { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); }
        },
        children: [],
        appendChild(child) { el.children.push(child); if (child && typeof child === 'object') child._parentEl = el; return child; },
        append() {},
        remove() { if (el._parentEl) { el._parentEl.children = el._parentEl.children.filter(c => c !== el); el._parentEl = null; } },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) { el._attrs = el._attrs || {}; el._attrs[name] = String(value); },
        getAttribute: (name) => (el._attrs && el._attrs[name]) || null,
        querySelector: () => makeElement(),
        querySelectorAll: () => [],
        insertBefore() {},
        after() {},
        before() {},
        focus() {},
        scrollIntoView() {},
        value: '',
        checked: false,
        readOnly: false,
        clientWidth: 300,
        clientHeight: 150
    };
    // Setting textContent or innerHTML detaches the current children, as in a real DOM.
    const detach = () => { el.children.forEach(child => { if (child && typeof child === 'object') child._parentEl = null; }); el.children = []; };
    Object.defineProperty(el, 'innerHTML', {
        get: () => el._innerHTML || '',
        set: (value) => { el._innerHTML = String(value); detach(); }
    });
    Object.defineProperty(el, 'textContent', {
        get: () => el._textContent || '',
        set: (value) => { el._textContent = String(value); detach(); }
    });
    // className keeps classList in step (the app sets both).
    Object.defineProperty(el, 'className', {
        get: () => Array.from(classes).join(' '),
        set: (value) => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => el._parentEl || (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    return el;
}

// Text of an element and its children (buttons carry their label in textContent).
function textOf(el) {
    if (!el || typeof el !== 'object') return '';
    const own = el._textContent || '';
    return (own + el.children.map(textOf).join('')).trim();
}

function createSandbox(store, page = 'page5') {
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const cookieJar = {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = page;
    const document = {
        get cookie() {
            return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set cookie(value) {
            const [pair] = String(value).split(';');
            const idx = pair.indexOf('=');
            if (idx <= 0) return;
            cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        },
        body,
        documentElement: makeElement(),
        head: makeElement(),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        createElement: () => {
            const el = makeElement();
            Object.defineProperty(el, 'id', {
                get: () => el._id || '',
                set: (value) => { el._id = String(value); byId[el._id] = el; }
            });
            return el;
        },
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        // Like a real DOM: null until something with that id was created.
        getElementById: (id) => byId[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; }
    };
    // The page's static elements.
    ['interactive-form-container', 'task-view-title', 'task-pills-container', 'print-btn-container',
        'btn-task-assignment', 'btn-incident-times', 'btn-ic-report', 'btn-manage-forms',
        'task-assignment-view', 'manage-forms-view', 'table-head', 'table-body'].forEach(id => {
        const el = makeElement();
        el._id = id;
        byId[id] = el;
    });
    const sandbox = {
        console: {log() {}, info() {}, warn() {}, error() {}},
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        localStorage,
        sessionStorage: localStorage,
        // The page keeps the case in memory only; the harness hands in the
        // object to seed and inspect (see _memoryStorage in app.js).
        SAR_MEMORY_STORAGE: store,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: () => Promise.reject(new Error('Failed to fetch')),
        alert() {},
        confirm: () => true,
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: `http://localhost/${page}.html`, search: '', pathname: `/${page}.html`},
        history: {replaceState() {}},
        URLSearchParams
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__byId = byId;
    return sandbox;
}

const store = {};
store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-9'});
store['sar-current-user'] = JSON.stringify({username: 'Super Admin', pin: '1976', handle: 'Super-Admin'});
const app = createSandbox(store);
{
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-9.json';
    bundle.pages.page3[0] = ['Jane Doe', 'Alpha', '', '', '', '', 'Off Duty', '', '', '', '', '', '', ''];
    bundle.pages.page3[1] = ['Bob Ray', 'Alpha', '', '', '', '', 'Off Duty', '', '', '', '', '', '', ''];
    bundle.pages.page3[2] = ['Ann Lee', 'Bravo', '', '', '', '', 'Off Duty', '', '', '', '', '', '', ''];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
}

// --- 1. The case carries incidentDays; the sanitizer keeps it canonical -------
{
    assert.deepStrictEqual(plain(app.defaultBundle().incidentDays), [{}], 'a new case starts with one empty day');

    const legacy = app.defaultBundle();
    delete legacy.incidentDays;
    assert.deepStrictEqual(plain(app.sanitizeBundle(legacy).incidentDays), [{}], 'a file without the section gets one empty day');

    // Files from before: times in personnel columns 9-12, one extra roster row
    // per extra "incident set" of the same member -> Day 1, Day 2.
    const old = app.defaultBundle();
    delete old.incidentDays;
    old.pages.page3[0] = ['Jane Doe', 'Alpha', '', '', '', '', 'Off Duty', '', '', '07:00', '08:15', '16:00', '17:30', ''];
    old.pages.page3[1] = ['Bob Ray', 'Alpha', '', '', '', '', 'Off Duty', '', '', '', '', '', '', ''];
    old.pages.page3[2] = ['Jane Doe', 'Alpha', '', '', '', '', 'Off Duty', '', '', '06:30', '', '', '', ''];
    const seeded = plain(app.sanitizeBundle(old).incidentDays);
    assert.deepStrictEqual(seeded, [
        {'Jane Doe': {enroute: '07:00', onScene: '08:15', returning: '16:00', arrived: '17:30'}},
        {'Jane Doe': {enroute: '06:30', onScene: '', returning: '', arrived: ''}}
    ], 'legacy personnel columns seed the days (a member without times is not listed)');

    const messy = app.defaultBundle();
    messy.incidentDays = [
        {'Jane Doe': {enroute: ' 09-09-2026 07:00 ', onScene: 5, extra: 'x'}, 'Bob Ray': {enroute: '', onScene: ''}, ' ': {enroute: '01:00'}, __proto__: {enroute: '01:00'}},
        'not a day',
        {}
    ];
    messy.incidentDays[0]['constructor'] = {enroute: '02:00'};
    const kept = plain(app.sanitizeBundle(messy).incidentDays);
    assert.deepStrictEqual(kept, [
        {'Jane Doe': {enroute: '09-09-2026 07:00', onScene: '5', returning: '', arrived: ''}},
        {},
        {}
    ], 'stamps are trimmed strings, blank members / blank names / unsafe keys are dropped, a bad day is an empty day');
}

// --- 2. Stamps, day labels and hours on scene --------------------------------
{
    assert.strictEqual(app.parseIncidentStamp(''), null);
    assert.deepStrictEqual(plain(app.parseIncidentStamp('9-9-2026 7:05')), {date: '09-09-2026', time: '07:05', ms: new Date(2026, 8, 9, 7, 5).getTime(), minutes: 425});
    assert.deepStrictEqual(plain(app.parseIncidentStamp('07:05')), {date: '', time: '07:05', ms: null, minutes: 425}, 'a bare time (legacy) has no date');
    assert.deepStrictEqual(plain(app.parseIncidentStamp('noon')), {date: '', time: 'noon', ms: null, minutes: null}, 'anything else is kept as typed');

    assert.strictEqual(app.getIncidentDayLabel({}, 0), 'Day 1', 'no enroute yet -> Day N');
    assert.strictEqual(app.getIncidentDayLabel({'Jane Doe': {enroute: '', onScene: '09-09-2026 08:00', returning: '', arrived: ''}}, 1), 'Day 2', 'only an Enroute time names the day');
    assert.strictEqual(app.getIncidentDayLabel({'Jane Doe': {enroute: '07:00', onScene: '', returning: '', arrived: ''}}, 0), 'Day 1', 'a legacy time without a date cannot name the day');
    assert.strictEqual(app.getIncidentDayLabel({
        'Jane Doe': {enroute: '09-10-2026 06:00', onScene: '', returning: '', arrived: ''},
        'Bob Ray': {enroute: '09-09-2026 23:30', onScene: '', returning: '', arrived: ''}
    }, 0), '09-09-2026', 'the button shows the date of the EARLIEST enroute of anyone that day');

    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '09-09-2026 08:15', returning: '09-09-2026 16:00'}), '07:45');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '09-09-2026 22:00', returning: '09-10-2026 02:30'}), '04:30', 'dated stamps cross midnight correctly');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '08:00', returning: '12:45'}), '04:45', 'legacy bare times work too');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '23:00', returning: '01:00'}), '02:00', 'bare times crossing midnight add a day');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '09-09-2026 08:15', returning: ''}), '', 'blank until Returning is entered');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '', returning: '09-09-2026 16:00'}), '');
    assert.strictEqual(app.getIncidentHoursOnScene({onScene: '09-09-2026 16:00', returning: '09-09-2026 08:15'}), '', 'a Returning before On Scene shows nothing rather than a negative');
    assert.strictEqual(app.getIncidentHoursOnScene(null), '');
}

// --- 3. Setting / clearing a time, the activity log and the derived status ---
{
    const logBefore = app.loadBundle().activityLog.length;
    assert.strictEqual(app.setIncidentTime('Jane Doe', 0, 'enroute', '09-09-2026 07:00'), true);
    let bundle = app.loadBundle();
    assert.deepStrictEqual(plain(bundle.incidentDays), [{'Jane Doe': {enroute: '09-09-2026 07:00', onScene: '', returning: '', arrived: ''}}]);
    assert.strictEqual(bundle.activityLog.length, logBefore + 1, 'setting a time is written to the activity log');
    assert.strictEqual(bundle.activityLog[0].action, 'Incident Times: Jane Doe Enroute time set to 09-09-2026 07:00 - Day 1, 09-09-2026');
    assert.strictEqual(bundle.activityLog[0].team, 'Alpha', 'the entry is filed under the member\'s team');
    assert.strictEqual(bundle.activityLog[0].members, 'Jane Doe', 'and names the member, so the mobile history shows it');

    assert.strictEqual(app.setIncidentTime('Jane Doe', 0, 'enroute', '09-09-2026 07:00'), false, 'the same value again changes nothing');
    assert.strictEqual(app.loadBundle().activityLog.length, logBefore + 1);

    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), 'Enroute');
    app.setIncidentTime('Jane Doe', 0, 'onScene', '09-09-2026 08:15');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), 'On-Scene');
    app.setIncidentTime('Jane Doe', 0, 'returning', '09-09-2026 16:00');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), 'Returning Home');
    assert.strictEqual(app.getMemberIncidentStatus('Bob Ray', app.loadBundle().incidentDays), null, 'a member without times falls back to the raw status');
    app.setIncidentTime('Jane Doe', 0, 'arrived', '09-09-2026 17:30');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), null, 'Arrived Home finishes the day');
    bundle = app.loadBundle();
    assert.ok(bundle.activityLog[0].action.startsWith('Incident Times: Jane Doe Arrived Home time set to 09-09-2026 17:30'));

    // Editing an existing time notes the old one; clearing removes it.
    app.setIncidentTime('Jane Doe', 0, 'arrived', '09-09-2026 17:45');
    assert.strictEqual(app.loadBundle().activityLog[0].action, 'Incident Times: Jane Doe Arrived Home time set to 09-09-2026 17:45 (was 09-09-2026 17:30) - Day 1, 09-09-2026');
    app.setIncidentTime('Jane Doe', 0, 'arrived', '');
    bundle = app.loadBundle();
    assert.strictEqual(bundle.incidentDays[0]['Jane Doe'].arrived, '');
    assert.strictEqual(bundle.activityLog[0].action, 'Incident Times: Jane Doe Arrived Home time cleared (was 09-09-2026 17:45) - Day 1, 09-09-2026');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', bundle.incidentDays), 'Returning Home');

    // Clearing every time of a member removes their entry from the day.
    app.setIncidentTime('Bob Ray', 0, 'onScene', '09-09-2026 09:00');
    assert.ok(app.loadBundle().incidentDays[0]['Bob Ray']);
    app.setIncidentTime('Bob Ray', 0, 'onScene', '');
    assert.strictEqual(app.loadBundle().incidentDays[0]['Bob Ray'], undefined);
    assert.strictEqual(app.setIncidentTime('Bob Ray', 0, 'bogus', '10:00'), false, 'unknown fields are ignored');
    assert.strictEqual(app.setIncidentTime('', 0, 'enroute', '10:00'), false);
}

// --- 4. Adding days: "Day 2" until someone is enroute, then its date ---------
{
    assert.strictEqual(app.addIncidentDay(), 1, 'the new day\'s index is returned');
    let days = app.loadBundle().incidentDays;
    assert.strictEqual(days.length, 2);
    assert.strictEqual(app.getIncidentDayLabel(days[1], 1), 'Day 2');
    assert.strictEqual(app.loadBundle().activityLog[0].action, 'Incident Times: Day 2 added');
    app.setIncidentTime('Bob Ray', 1, 'enroute', '09-10-2026 06:45');
    days = app.loadBundle().incidentDays;
    assert.strictEqual(app.getIncidentDayLabel(days[1], 1), '09-10-2026', 'the second day shows its earliest enroute date once entered');
    assert.strictEqual(app.getIncidentDayLabel(days[0], 0), '09-09-2026', 'the first day keeps its own date');
    assert.strictEqual(app.getMemberIncidentStatus('Bob Ray', days), 'Enroute');

    // The oldest unfinished day drives the status.
    app.setIncidentTime('Jane Doe', 1, 'enroute', '09-10-2026 07:00');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), 'Returning Home', 'Day 1 (still open) drives Jane\'s status, not the new day');
    app.setIncidentTime('Jane Doe', 0, 'arrived', '09-09-2026 17:45');
    assert.strictEqual(app.getMemberIncidentStatus('Jane Doe', app.loadBundle().incidentDays), 'Enroute', 'once Day 1 is finished, Day 2 does');
    app.setIncidentTime('Jane Doe', 1, 'enroute', '');

    // Setting a time on a day that does not exist yet creates the days up to it.
    app.setIncidentTime('Ann Lee', 3, 'enroute', '09-12-2026 05:00');
    days = app.loadBundle().incidentDays;
    assert.strictEqual(days.length, 4);
    assert.deepStrictEqual(plain(days[2]), {});
    assert.strictEqual(app.getIncidentDayLabel(days[3], 3), '09-12-2026');
    // (back to two days for the UI tests)
    const b = app.loadBundle();
    b.incidentDays = b.incidentDays.slice(0, 2);
    app.saveBundle(b);
}

// --- 5. The Forms page: day buttons next to the title, one table per day,
//        no "Add Row" any more -----------------------------------------------
{
    const byId = app.__byId;
    const container = byId['interactive-form-container'];
    const title = byId['task-view-title'];
    app.buildFormsPage();
    byId['btn-incident-times'].onclick();
    assert.strictEqual(byId['btn-incident-times'].classList.contains('active'), true);
    assert.strictEqual(title.textContent, 'Incident Times Report');
    assert.strictEqual(title.classList.contains('incident-times-title'), true, 'the title lays its text and the day buttons out in a row');

    const headerButtons = byId['print-btn-container'].children.map(b => String(b.innerHTML).replace(/<[^>]*>/g, ''));
    assert.deepStrictEqual(headerButtons, ['Download All Forms', 'Print Report'], 'the Add Row button is gone');
    assert.ok(!/function addIncidentRow\b/.test(appSource), 'the Add Row popup code is gone');
    assert.ok(!/Add Incident Row/.test(appSource), 'the "Add Incident Row" card affordance is gone');

    // Day buttons inside the title: the first day's date, then "+".
    let tabs = byId['incident-day-tabs'];
    assert.ok(tabs, 'the day buttons exist');
    assert.strictEqual(tabs.parentElement, title, 'the day buttons sit inside the title, next to its text');
    assert.deepStrictEqual(tabs.children.map(textOf), ['09-09-2026', '09-10-2026', '+']);
    assert.strictEqual(tabs.children[0].classList.contains('active'), true, 'Day 1 is open');
    assert.strictEqual(tabs.children[1].classList.contains('active'), false);
    assert.strictEqual(tabs.children[2].classList.contains('no-print'), true);

    // The open day's table: Name | Enroute | On Scene | Returning | Arrived Home | Hours On Scene.
    const table = container.children[0].children[0];
    assert.strictEqual(table.className, 'incident-times-table');
    const headRow = table.children[0].children[0];
    assert.deepStrictEqual(headRow.children.map(textOf), ['Name', 'Enroute', 'On Scene', 'Returning', 'Arrived Home', 'Hours On Scene']);
    const rows = table.children[1].children;
    assert.deepStrictEqual(rows.map(r => r.dataset.member), ['Ann Lee', 'Bob Ray', 'Jane Doe'], 'every roster member, sorted by name');
    const jane = rows[2];
    assert.deepStrictEqual(jane.children.map(textOf), ['Jane Doe', '07:00', '08:15', '16:00', '17:45', '07:45'], 'times show as hh:mm; hours on scene = On Scene (08:15) -> Returning (16:00)');
    const bob = rows[1];
    assert.deepStrictEqual(bob.children.map(textOf), ['Bob Ray', '+', '+', '+', '+', '—'], 'empty cells offer a + button');
    assert.strictEqual(bob.children[1].children[0].classList.contains('incident-time-empty'), true);
    assert.strictEqual(typeof bob.children[1].children[0].onclick, 'function', 'the + opens the time prompt');

    // Clicking the second day's button shows that day's table.
    tabs.children[1].onclick();
    tabs = byId['incident-day-tabs'];
    assert.strictEqual(tabs.children[1].classList.contains('active'), true);
    assert.strictEqual(tabs.children[0].classList.contains('active'), false);
    const day2Rows = container.children[0].children[0].children[1].children;
    assert.deepStrictEqual(day2Rows.map(r => textOf(r.children[1])), ['+', '06:45', '+'], 'Day 2 holds only Bob\'s enroute');

    // "+" adds Day 3 and opens it; its button says "Day 3" until an enroute is entered.
    tabs.children[2].onclick();
    tabs = byId['incident-day-tabs'];
    assert.deepStrictEqual(tabs.children.map(textOf), ['09-09-2026', '09-10-2026', 'Day 3', '+'], 'a third day appears with its own + for a fourth');
    assert.strictEqual(tabs.children[2].classList.contains('active'), true, 'the new day is opened');
    assert.strictEqual(app.loadBundle().incidentDays.length, 3);
    app.setIncidentTime('Ann Lee', 2, 'enroute', '09-11-2026 05:30');
    app.buildFormsPage();
    tabs = byId['incident-day-tabs'];
    assert.deepStrictEqual(tabs.children.map(textOf), ['09-09-2026', '09-10-2026', '09-11-2026', '+'], 'the third day takes its date from the earliest enroute');
    assert.strictEqual(tabs.parentElement, title, 'a rebuild keeps the buttons in the title');
    assert.strictEqual(title.children.filter(c => c._id === 'incident-day-tabs').length, 1, 'a rebuild does not duplicate the buttons');

    // A stamp on another date than the day's shows its date under the time.
    app.setIncidentTime('Ann Lee', 2, 'arrived', '09-12-2026 01:10');
    app.buildFormsPage();
    const annCell = container.children[0].children[0].children[1].children[0].children[4];
    assert.deepStrictEqual(annCell.children[0].children.map(textOf), ['01:10', '09-12-2026']);

    // Switching to another form clears the title row layout; coming back restores it.
    byId['btn-ic-report'].onclick();
    assert.strictEqual(title.classList.contains('incident-times-title'), false);
    assert.strictEqual(title.textContent, 'IC Report Form');
    byId['btn-incident-times'].onclick();
    assert.strictEqual(title.classList.contains('incident-times-title'), true);
    assert.strictEqual(byId['incident-day-tabs'].parentElement, title);
}

// --- 6. The mobile status page / Member Reports: one member, no Name column --
{
    const mobileTitle = app.document.createElement('h2');
    mobileTitle.id = 'incident-times-title';
    mobileTitle.textContent = 'Incident Times';
    const mobileContainer = app.document.createElement('div');
    app.renderIncidentTimesReport(mobileContainer, {memberName: 'Jane Doe', titleEl: mobileTitle});
    let tabs = app.__byId['incident-day-tabs'];
    assert.strictEqual(tabs.parentElement, mobileTitle, 'the day buttons move into the mobile title');
    assert.deepStrictEqual(tabs.children.map(textOf), ['09-09-2026', '09-10-2026', '09-11-2026', '+']);
    assert.strictEqual(tabs.children[2].classList.contains('active'), true, 'the day opened on the Forms page stays open (same page load)');
    // Back to Day 1 for Jane's row.
    tabs.children[0].onclick();
    tabs = app.__byId['incident-day-tabs'];
    assert.strictEqual(tabs.children[0].classList.contains('active'), true);
    const table = mobileContainer.children[0].children[0];
    assert.deepStrictEqual(table.children[0].children[0].children.map(textOf), ['Enroute', 'On Scene', 'Returning', 'Arrived Home', 'Hours On Scene'], 'no Name column for a single member');
    const rows = table.children[1].children;
    assert.strictEqual(rows.length, 1, 'only the selected member');
    assert.deepStrictEqual(rows[0].children.map(textOf), ['07:00', '08:15', '16:00', '17:45', '07:45']);

    // Legacy wrapper used by the Personnel page's Member Reports.
    const reportContainer = app.document.createElement('div');
    app.renderMemberIncidentCards('Bob Ray', reportContainer);
    assert.strictEqual(reportContainer.children[0].className, 'incident-day-tabs', 'without a title element the day buttons head the container');
    assert.strictEqual(reportContainer.children[1].children[0].children[1].children.length, 1);

    const html = fs.readFileSync(path.join(__dirname, 'mobile-status.html'), 'utf8');
    assert.ok(html.includes('id="incident-times-title"'), 'the mobile page titles the section so the day buttons have a home');
    assert.ok(html.includes("renderIncidentTimesReport(container, {memberName, titleEl: document.getElementById('incident-times-title')})"), 'the mobile page draws the day-based report');
    assert.ok(html.includes("addEventListener('sar-data-refreshed'"), 'the mobile page redraws when another device\'s edits arrive');
    assert.ok(appSource.includes("document.dispatchEvent(new CustomEvent('sar-data-refreshed'))"), 'app.js announces a sync-driven redraw');
}

// --- 7. Printing: the Forms page report and the Case # Printout --------------
{
    let written = '';
    app.window.open = () => ({document: {write(html) { written += html; }, close() {}}});
    app.printIncidentTimesReport();
    assert.ok(written.includes('<title>Incident Times Report - Case-9</title>'));
    assert.ok(written.includes('<div class="incident-times-print">'), 'the full (non-compact) report');
    assert.strictEqual((written.match(/class="incident-day-print"/g) || []).length, 3, 'one table per day');
    assert.ok(written.includes('Day 1 - 09-09-2026'));
    assert.ok(written.includes('Day 2 - 09-10-2026'));
    assert.ok(written.includes('<th>Name</th><th>Enroute</th><th>On Scene</th><th>Returning</th><th>Arrived Home</th><th>Hours On Scene</th>'), 'the new column layout');
    assert.ok(written.includes('<td class="incident-times-print-name">Jane Doe</td><td>07:00</td><td>08:15</td><td>16:00</td><td>17:45</td><td class="incident-times-print-hours">07:45</td>'));
    assert.ok(written.includes('<td class="incident-times-print-name">Bob Ray</td><td></td><td></td><td></td><td></td><td class="incident-times-print-hours"></td>'), 'the whole roster is printed so blanks can be filled by hand');
    assert.ok(written.includes('01:10 (09-12-2026)'), 'a stamp on another date carries its date');
    assert.ok(!written.includes('incident-card'), 'the old card layout is gone');
    assert.ok(written.includes('.incident-times-print-table {'), 'print styles included');

    written = '';
    app.printSearchFile();
    const tableAt = written.indexOf('class="search-log-table"');
    const timesAt = written.indexOf('class="incident-times-print compact"');
    const activityAt = written.indexOf('<h1>Activity Log</h1>');
    assert.ok(tableAt > -1 && timesAt > -1 && activityAt > -1, 'the Case # Printout has the compact Incident Times block');
    assert.ok(tableAt < timesAt && timesAt < activityAt, 'after the Search Log table, before the Activity Log');
    assert.ok(written.includes('<h2 class="incident-times-print-title">Incident Times</h2>'));
    const compactStart = written.indexOf('class="incident-times-print compact"');
    const compactEnd = written.indexOf('<h1>Activity Log</h1>');
    const compact = written.slice(compactStart, compactEnd);
    assert.ok(compact.includes('Jane Doe'));
    assert.ok(compact.includes('Bob Ray'), 'Bob has times on Day 2');
    assert.strictEqual((compact.match(/incident-times-print-name">Bob Ray/g) || []).length, 1, 'compact: only the days a member has times on');
    assert.strictEqual((compact.match(/incident-times-print-name">Jane Doe/g) || []).length, 1, 'Jane only on Day 1');
    assert.ok(compact.includes('.incident-times-print.compact') || written.includes('.incident-times-print.compact'), 'compact print styles included');

    // Nothing recorded -> a note, not an empty table; names are escaped.
    const blank = app.getIncidentTimesPrintHTML(app.defaultBundle(), {compact: true});
    assert.ok(blank.includes('No incident times have been recorded for this case.'));
    const b = app.defaultBundle();
    b.incidentDays = [{'<b>X</b>': {enroute: '09-09-2026 07:00', onScene: '', returning: '', arrived: ''}}];
    const escaped = app.getIncidentTimesPrintHTML(b, {compact: true});
    assert.ok(escaped.includes('&lt;b&gt;X&lt;/b&gt;') && !escaped.includes('<b>X</b>'));

    // The Member Reports printout lists the member's days with hours on scene.
    const memberRows = plain(app.getMemberIncidentTimecardRows(app.loadBundle(), 'Jane Doe'));
    assert.deepStrictEqual(memberRows, [{dayLabel: '09-09-2026', dayNumber: 1, entry: {enroute: '09-09-2026 07:00', onScene: '09-09-2026 08:15', returning: '09-09-2026 16:00', arrived: '09-09-2026 17:45'}, hours: '07:45'}]);

    let alerted = '';
    app.window.open = () => null;
    app.alert = (msg) => { alerted = msg; };
    app.printIncidentTimesReport();
    assert.ok(alerted.includes('popups'), alerted);
}

// --- 8. Row-level sync: one change per day, merged member by member ----------
{
    const utils = app.SARSyncDelta;
    const before = app.loadBundle();
    const after = JSON.parse(JSON.stringify(before));
    after.incidentDays[1]['Ann Lee'] = {enroute: '09-10-2026 07:10', onScene: '', returning: '', arrived: ''};
    const changes = utils.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1, 'one change for the one edited day');
    assert.strictEqual(changes[0].path.join('.'), 'incidentDays.1');

    // Another phone marked Bob on scene on the same day in the meantime: both edits survive.
    const server = JSON.parse(JSON.stringify(before));
    server.incidentDays[1]['Bob Ray'].onScene = '09-10-2026 08:00';
    const applied = utils.applyBundleChanges(server, changes);
    assert.strictEqual(applied.applied.length, 1);
    assert.strictEqual(applied.bundle.incidentDays[1]['Ann Lee'].enroute, '09-10-2026 07:10', 'the sent member landed');
    assert.strictEqual(applied.bundle.incidentDays[1]['Bob Ray'].onScene, '09-10-2026 08:00', 'the other phone\'s member is kept');
    assert.strictEqual(utils.describeChangeTarget(changes[0]).kind, 'none', 'no structured table: the bundle blob holds it');
}

console.log('Incident Times Days: PASS');

// Every printout opens with the login's logo (150 px wide) on the left and the
// form title beside it on the right, in one row: the single / all Task
// Assignment Forms, the IC Report, the Incident Times Report, the team and
// member activity reports and the whole Case # Printout. Without a logo the
// title row holds just the title.
//
// The real print functions of app.js run in a vm sandbox whose window.open
// records the HTML written into the print window.
//
// Run with: node test_print_logo.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeElement() {
    const classes = new Set();
    const el = {
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {
            add(c) { classes.add(c); },
            remove(c) { classes.delete(c); },
            contains: (c) => classes.has(c),
            toggle(c, force) { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); }
        },
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
        focus() {},
        textContent: '',
        innerHTML: '',
        value: '',
        checked: false,
        clientWidth: 300,
        clientHeight: 150,
        parentElement: null
    };
    return el;
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
        baseURI: `http://localhost/${page}.html`,
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
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const sandbox = {
        console: {log() {}, info() {}, warn() {}, error() {}},
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        localStorage,
        sessionStorage: localStorage,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: () => Promise.reject(new Error('Failed to fetch')),
        alert() {},
        FormData: class FormData {},
        location: {hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', href: `http://localhost/${page}.html`, search: '', pathname: `/${page}.html`},
        history: {replaceState() {}},
        URL,
        URLSearchParams,
        // The page keeps the open case in memory (never localStorage); the
        // harness hands in `store` so the test can seed it.
        SAR_MEMORY_STORAGE: store
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    sandbox.__byId = byId;
    return sandbox;
}

// A case with one task form, an IC report, an incident day and a log entry so
// every printout has something to print.
function seedCase(app, store) {
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-9.json';
    bundle.forms = {
        3: {teamName: 'Alpha', segment: 'R1 / S2', teamMembers: [{name: 'Chris Ray', leader: true}], teamTypes: {}, parChecksRaw: []},
        7: {teamName: 'Bravo', segment: 'R1 / S3', teamMembers: [], teamTypes: {}, parChecksRaw: []}
    };
    bundle.icReport = {text: 'Subject located.', completedName: '', completed: false, completedBy: '', completedAt: ''};
    bundle.pages.page3 = [['Chris Ray', '', '', '', '', '', '']];
    bundle.activityLog = [{date: '09-14-2026', time: '10:00', tag: '#3 - Chris Ray', team: 'Alpha', members: 'Chris Ray*', action: 'Alpha left base', timestamp: 1}];
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
}

// Runs `fn` with a recording print window and returns the HTML it wrote.
function capture(app, fn) {
    let written = '';
    app.window.open = () => ({document: {write(html) { written += html; }, close() {}}});
    fn();
    assert.ok(written.length > 0, 'the printout is written');
    return written;
}

const LOGO_IMG = `<img class="print-logo" src="${LOGO_DATA_URL}" alt="" width="150">`;

function countOf(haystack, needle) {
    return haystack.split(needle).length - 1;
}

// Every printout of `app`, by name.
function allPrintouts(app) {
    app.document.getElementById('team-report-filters').dataset.activeTeam = 'Alpha';
    return {
        singleForm: capture(app, () => app.printSingleTaskForm('3')),
        allForms: capture(app, () => app.downloadAllForms()),
        icReport: capture(app, () => app.printIcReport()),
        incidentTimes: capture(app, () => app.printIncidentTimesReport()),
        teamReport: capture(app, () => app.printCurrentReport('team')),
        allTeamReports: capture(app, () => app.printAllReports('team')),
        allMemberReports: capture(app, () => app.printAllReports('member')),
        caseFile: capture(app, () => app.printSearchFile())
    };
}

// --- 1. The helpers: 150 px logo, title row, safe attribute -----------------
{
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-9'});
    const app = createSandbox(store);
    seedCase(app, store);

    // (top-level consts are not sandbox properties; read them in-context)
    assert.strictEqual(vm.runInContext('PRINT_LOGO_WIDTH_PX', app), 150, 'the print logo is 150 px wide');
    const styles = vm.runInContext('PRINT_LOGO_STYLES', app);
    assert.ok(/\.print-logo \{[^}]*width: 150px/.test(styles), 'the print styles size the logo at 150 px');
    assert.ok(/\.print-title-row \{[^}]*display: flex/.test(styles), 'logo and title share one flex row');

    // No logo stored for the login and none in the case: just the title.
    assert.strictEqual(app.getPrintLogoHTML(app.loadBundle()), '', 'no logo -> no image');
    assert.strictEqual(app.getPrintTitleRowHTML(app.loadBundle(), 'Activity Log'),
        '<div class="print-title-row"><h1>Activity Log</h1></div>', 'the title row holds the title alone');
    assert.strictEqual(app.getPrintTitleRowHTML(app.loadBundle(), 'IC Report', {tag: 'h2', className: 'ic-report-title'}),
        '<div class="print-title-row"><h2 class="ic-report-title">IC Report</h2></div>', 'the heading level and class can be chosen');

    // A legacy case logo kept as a relative path is made absolute: the print
    // window is an about:blank page with nothing to resolve it against.
    const legacy = app.loadBundle();
    legacy.logo = 'assets/team-logo.png';
    assert.strictEqual(app.getPrintLogoSource(legacy), 'http://localhost/assets/team-logo.png');
    assert.ok(app.getPrintLogoHTML(legacy).startsWith('<img class="print-logo" src="http://localhost/assets/team-logo.png"'));

    // The login's stored logo wins and goes in as a data: URL, attribute-escaped.
    app.saveUserAsset('logo', LOGO_DATA_URL, 'logo.png');
    assert.strictEqual(app.getPrintLogoSource(legacy), LOGO_DATA_URL, 'the login logo beats the case logo');
    assert.strictEqual(app.getPrintLogoHTML(legacy), LOGO_IMG);
    assert.strictEqual(app.getPrintTitleRowHTML(legacy, 'Search Log: Case-9'),
        `<div class="print-title-row">${LOGO_IMG}<h1>Search Log: Case-9</h1></div>`, 'logo left, title right, one row');
    app.saveUserAsset('logo', 'data:image/png;base64,"><script>x</script>', 'evil.png');
    const evil = app.getPrintLogoHTML(app.loadBundle());
    assert.ok(!evil.includes('<script>'), 'the logo address is attribute-escaped');
    assert.ok(evil.includes('&quot;&gt;&lt;script&gt;'), evil);
}

// --- 2. With a logo: every printout carries it in the title row -------------
{
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-9'});
    const app = createSandbox(store);
    seedCase(app, store);
    app.saveUserAsset('logo', LOGO_DATA_URL, 'logo.png');
    const out = allPrintouts(app);

    // Each printout includes the styles that lay the row out.
    Object.entries(out).forEach(([name, html]) => {
        assert.ok(html.includes('.print-logo {'), `${name}: the print styles size the logo`);
        assert.ok(html.includes('.print-title-row {'), `${name}: the print styles lay out the title row`);
        assert.ok(html.includes(LOGO_IMG), `${name}: the login's logo is printed`);
    });

    // Task Assignment Form: logo, then the title, then the task # in the header row.
    const header = out.singleForm.match(/<div class="form-header">([\s\S]*?)<\/div>/);
    assert.ok(header, 'the form header is printed');
    const logoAt = header[1].indexOf(LOGO_IMG);
    const titleAt = header[1].indexOf('Task Assignment Form');
    const numAt = header[1].indexOf('Task # 3');
    assert.ok(logoAt > -1 && titleAt > -1 && numAt > -1, 'header has logo, title and task #');
    assert.ok(logoAt < titleAt && titleAt < numAt, 'logo on the left, title to its right, task # at the end');
    assert.ok(header[1].includes('<span class="form-header-title"'), 'the title takes the space between logo and task #');
    assert.strictEqual(countOf(out.singleForm, LOGO_IMG), 1, 'one logo on the single form');
    assert.strictEqual(countOf(out.allForms, LOGO_IMG), 2, 'one logo per form in Download All Forms');

    // IC Report: logo and "IC Report" title in one row inside the report box.
    assert.ok(out.icReport.includes(`<div class="print-title-row">${LOGO_IMG}<h2 class="ic-report-title">IC Report</h2></div>`),
        'the IC Report title row carries the logo');
    assert.strictEqual(countOf(out.icReport, LOGO_IMG), 1);

    // Incident Times Report.
    assert.ok(out.incidentTimes.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Incident Times Report</h1></div>`));

    // Team / member activity reports (single and "all").
    assert.ok(out.teamReport.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Team Activity Report: Alpha</h1></div>`));
    assert.ok(out.allTeamReports.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Team Activity Report: Alpha</h1></div>`));
    assert.ok(out.allMemberReports.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Member Activity Report: Chris Ray</h1></div>`));

    // The whole Case # Printout: top row of the first page, the Activity Log
    // page and each task form; the IC Report block inside page one has no
    // second logo of its own.
    assert.ok(out.caseFile.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Search Log: Case-9</h1></div>`), 'the case printout opens with logo + title');
    assert.ok(out.caseFile.includes(`<div class="print-title-row">${LOGO_IMG}<h1>Activity Log</h1></div>`), 'the Activity Log page has the logo too');
    assert.ok(out.caseFile.includes('<h2 class="ic-report-title">IC Report</h2>'));
    assert.strictEqual(countOf(out.caseFile, LOGO_IMG), 2 + 2, 'Search Log page + Activity Log page + one per task form');
    assert.ok(out.caseFile.indexOf(LOGO_IMG) < out.caseFile.indexOf('class="charts-container"'), 'the logo row is the first thing on the page');
}

// --- 3. Without a logo: the same printouts, title row without an image ------
{
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-9'});
    const app = createSandbox(store);
    seedCase(app, store);
    const out = allPrintouts(app);
    Object.entries(out).forEach(([name, html]) => {
        assert.ok(!html.includes('print-logo" src'), `${name}: no logo image when the login has none`);
        assert.ok(html.includes('<div class="print-title-row"><h') || html.includes('<div class="form-header">'), `${name}: the title row is still there`);
    });
    assert.ok(out.caseFile.includes('<h1>Search Log: Case-9</h1>'));
    assert.ok(out.caseFile.includes('<h1>Activity Log</h1>'));
    assert.ok(out.icReport.includes('<h2 class="ic-report-title">IC Report</h2>'));
    assert.ok(out.singleForm.includes('<span class="form-header-title" style="font-weight: bold; font-size: 16pt;">Task Assignment Form</span>'));
}

console.log('test_print_logo.js: PASS');

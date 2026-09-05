// Regression tests for the IC Report.
//
// Every CASE # carries one IC Report: a title, the case # as subtitle, a large
// free-text field and a "form completed" checkbox next to a small name field.
// Ticking the checkbox tags whatever name was typed into the small field (or
// the signed-in user when it is blank) with the completion date/time. The form
// lives on the Forms page under its own "IC Report" button (next to Incident
// Times), has a "Print Report" button that prints just that report, and the
// Case # Printout still includes it after the charts.
//
// Run with: node test_ic_report.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';

function makeElement(depth = 0) {
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
        appendChild(child) { el.children.push(child); if (child && typeof child === 'object') child._parentEl = el; return child; },
        append() {},
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        querySelector: () => makeElement(),
        querySelectorAll: () => [],
        insertBefore() {},
        after() {},
        focus() {},
        scrollIntoView() {},
        textContent: '',
        value: '',
        checked: false,
        readOnly: false,
        clientWidth: 300,
        clientHeight: 150
    };
    // Setting innerHTML detaches the current children, as in a real DOM.
    Object.defineProperty(el, 'innerHTML', {
        get: () => el._innerHTML || '',
        set: (value) => {
            el._innerHTML = String(value);
            el.children.forEach(child => { if (child && typeof child === 'object') child._parentEl = null; });
            el.children = [];
        }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => el._parentEl || (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
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
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        // Elements created by the app register themselves under their id, like
        // a real DOM, so getElementById finds the form fields the app built.
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
store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': 'Case-7'});
// The signed-in user (Super-Admin) is who gets tagged when no name is typed.
store['sar-current-user'] = JSON.stringify({username: 'Super Admin', pin: '1976', handle: 'Super-Admin'});
const app = createSandbox(store);
{
    const bundle = app.defaultBundle();
    bundle.fileName = 'Case-7.json';
    store[BUNDLE_KEY] = JSON.stringify(app.sanitizeBundle(bundle));
}

// --- 1. Every case carries a (blank) IC Report that survives the sanitizer ----
{
    const fresh = app.defaultBundle();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(fresh.icReport)),
        {text: '', completedName: '', completed: false, completedBy: '', completedAt: ''},
        'a new case starts with an empty IC Report');

    const legacy = app.defaultBundle();
    delete legacy.icReport;
    const sanitizedLegacy = app.sanitizeBundle(legacy);
    assert.ok(sanitizedLegacy.icReport, 'a file saved before IC Reports existed gets a blank one');
    assert.strictEqual(sanitizedLegacy.icReport.text, '');

    const filled = app.defaultBundle();
    filled.icReport = {text: 'Subject located.', completedName: 'J. Smith', completed: true, completedBy: 'J. Smith', completedAt: '09-04-2026 13:00'};
    const kept = app.sanitizeBundle(filled).icReport;
    assert.strictEqual(kept.text, 'Subject located.', 'report text is kept on load/save');
    assert.strictEqual(kept.completed, true);
    assert.strictEqual(kept.completedBy, 'J. Smith');
    assert.strictEqual(kept.completedAt, '09-04-2026 13:00');

    const notDone = app.sanitizeBundle({...app.defaultBundle(), icReport: {text: 'x', completed: false, completedBy: 'Ghost', completedAt: 'then'}}).icReport;
    assert.strictEqual(notDone.completedBy, '', 'an unticked report carries no completion tag');
    assert.strictEqual(notDone.completedAt, '');
}

// --- 2. Ticking the box tags the typed name (else the signed-in user) --------
{
    const when = new Date(2026, 8, 4, 13, 56);
    let bundle = app.loadBundle();
    bundle.icReport.text = 'Search concluded, subject found in Seg B.';
    bundle.icReport.completedName = 'Pat Lee';
    const signed = app.markIcReportCompleted(bundle, when);
    assert.strictEqual(signed.completed, true);
    assert.strictEqual(signed.completedBy, 'Pat Lee', 'the name typed in the small field is tagged');
    assert.strictEqual(signed.completedAt, '09-04-2026 13:56', 'the completion is stamped with date/time');
    assert.strictEqual(app.getIcReportCompletionLabel(signed), 'Completed by Pat Lee at 09-04-2026 13:56');
    app.saveBundle(bundle);

    bundle = app.loadBundle();
    assert.strictEqual(bundle.icReport.completedBy, 'Pat Lee', 'the completion survives a save/load round trip');
    assert.strictEqual(bundle.icReport.text, 'Search concluded, subject found in Seg B.');

    const reopened = app.reopenIcReport(bundle);
    assert.strictEqual(reopened.completed, false);
    assert.strictEqual(reopened.completedBy, '');
    assert.strictEqual(reopened.completedAt, '');
    assert.strictEqual(reopened.completedName, 'Pat Lee', 'the typed name stays for re-signing');
    assert.strictEqual(app.getIcReportCompletionLabel(reopened), 'Mark IC Report as Completed');

    reopened.completedName = '';
    const byUser = app.markIcReportCompleted(bundle, when);
    assert.strictEqual(byUser.completedBy, 'Super-Admin', 'a blank name field tags the signed-in user');
    app.reopenIcReport(bundle);
    app.saveBundle(bundle);
}

// --- 3. The Forms page: an "IC Report" button next to Incident Times showing
//        just the form (title, case # subtitle, text, checkbox + name) --------
{
    const byId = app.__byId;
    const container = app.document.getElementById('interactive-form-container');
    app.buildFormsPage();
    const btnIcReport = byId['btn-ic-report'];
    assert.strictEqual(typeof btnIcReport.onclick, 'function', 'the Forms page wires the IC Report button');
    assert.strictEqual(btnIcReport.classList.contains('active'), false, 'Task Assignment is the default subpage');

    btnIcReport.onclick();
    assert.strictEqual(btnIcReport.classList.contains('active'), true, 'the IC Report button becomes the active form button');
    assert.strictEqual(byId['btn-task-assignment'].classList.contains('active'), false);
    assert.strictEqual(byId['btn-incident-times'].classList.contains('active'), false);
    assert.strictEqual(byId['btn-manage-forms'].classList.contains('active'), false);
    assert.strictEqual(byId['task-view-title'].textContent, 'IC Report Form');
    assert.strictEqual(byId['task-pills-container'].style.display, 'none', 'the task # pills are hidden; only the IC Report is shown');
    assert.strictEqual(byId['manage-forms-view'].style.display, 'none');
    assert.strictEqual(container.children.length, 1, 'the form shell holds just the IC Report');
    assert.strictEqual(container.children[0].id, 'ic-report-panel');
    assert.strictEqual(container.children[0].children[0].textContent, 'IC Report', 'the form is titled IC Report');

    // The header offers Download All Forms plus a Print Report for just this report.
    const headerButtons = byId['print-btn-container'].children.map(b => String(b.innerHTML).replace(/<[^>]*>/g, ''));
    assert.deepStrictEqual(headerButtons, ['Download All Forms', 'Print Report']);

    const caseEl = byId['ic-report-case'];
    const textArea = byId['ic-report-text'];
    const check = byId['ic-report-completed'];
    const nameInput = byId['ic-report-name'];
    const statusEl = byId['ic-report-status'];
    assert.strictEqual(caseEl.textContent, 'Case # Case-7', 'the subtitle shows the case # without .json');
    assert.strictEqual(textArea.value, 'Search concluded, subject found in Seg B.', 'the large text field shows the saved report');
    assert.strictEqual(check.checked, false);
    assert.strictEqual(nameInput.readOnly, false);
    assert.strictEqual(statusEl.textContent, 'Mark IC Report as Completed');

    // Typing into the large field saves it.
    textArea.value = 'Search concluded. Debrief at 1500.';
    textArea.oninput();
    assert.strictEqual(app.loadBundle().icReport.text, 'Search concluded. Debrief at 1500.', 'typing in the text field auto-saves');

    // Typing a name, then ticking the checkbox, tags that name on completion.
    nameInput.value = 'Chris Ray';
    nameInput.oninput();
    assert.strictEqual(app.loadBundle().icReport.completedName, 'Chris Ray');
    const logBefore = app.loadBundle().activityLog.length;
    check.checked = true;
    check.onchange();
    let saved = app.loadBundle();
    assert.strictEqual(saved.icReport.completed, true, 'the checkbox marks the form completed');
    assert.strictEqual(saved.icReport.completedBy, 'Chris Ray', 'the name in the small field is tagged with the completion');
    assert.ok(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/.test(saved.icReport.completedAt), 'the completion carries a date/time stamp');
    assert.strictEqual(saved.activityLog.length, logBefore + 1, 'the completion is written to the activity log');
    assert.ok(saved.activityLog[0].action.includes('IC Report for Case # Case-7 marked as completed by Chris Ray'), saved.activityLog[0].action);
    assert.ok(statusEl.textContent.startsWith('Completed by Chris Ray at '), statusEl.textContent);
    assert.strictEqual(nameInput.readOnly, true, 'the name is locked while the form is completed');
    assert.strictEqual(byId['ic-report-panel'].classList.contains('is-completed'), true);

    // A rebuild triggered by another device's edits must not wipe a field
    // the user is typing in right now.
    app.document.activeElement = textArea;
    textArea.value = 'Search concluded. Debrief at 1500. Half-typed';
    app.renderIcReportForm();
    assert.strictEqual(textArea.value, 'Search concluded. Debrief at 1500. Half-typed', 'the focused text field is left alone on re-render');
    app.document.activeElement = null;
    app.renderIcReportForm();
    assert.strictEqual(textArea.value, 'Search concluded. Debrief at 1500.', 'an unfocused field follows the saved report');

    // Unticking reopens the form.
    check.checked = false;
    check.onchange();
    saved = app.loadBundle();
    assert.strictEqual(saved.icReport.completed, false);
    assert.strictEqual(saved.icReport.completedBy, '');
    assert.ok(saved.activityLog[0].action.includes('reopened'), saved.activityLog[0].action);
    assert.ok(saved.activityLog[0].action.includes('was completed by Chris Ray'), saved.activityLog[0].action);
    assert.strictEqual(nameInput.readOnly, false);

    // Re-sign: the checkbox with the name still in the small field.
    check.checked = true;
    check.onchange();
    assert.strictEqual(app.loadBundle().icReport.completedBy, 'Chris Ray');

    // A full page rebuild (e.g. another device's edit) keeps the same form.
    app.buildFormsPage();
    assert.strictEqual(container.children.length, 1, 'a rebuild does not duplicate the form');
    assert.strictEqual(byId['ic-report-text'], textArea, 'a rebuild keeps the existing fields');
    assert.strictEqual(byId['task-view-title'].textContent, 'IC Report Form', 'the IC Report stays selected across rebuilds');

    // Switching to another form button removes the IC Report from the shell.
    byId['btn-incident-times'].onclick();
    assert.strictEqual(byId['btn-incident-times'].classList.contains('active'), true);
    assert.strictEqual(btnIcReport.classList.contains('active'), false);
    assert.strictEqual(byId['task-view-title'].textContent, 'Incident Times Report');
    assert.ok(!container.children.some(child => child.id === 'ic-report-panel'), 'the IC Report is gone once another form is chosen');
    btnIcReport.onclick();
    assert.strictEqual(byId['ic-report-text'].value, 'Search concluded. Debrief at 1500.', 'coming back shows the saved report again');
}

// --- 4. "Print Report" prints only the IC Report ----------------------------
{
    let written = '';
    app.window.open = () => ({document: {write(html) { written += html; }, close() {}}});
    const printBtn = app.__byId['print-btn-container'].children.find(b => String(b.innerHTML).includes('Print Report'));
    printBtn.onclick();
    assert.ok(written.includes('<title>IC Report - Case-7</title>'), 'the print window is the IC Report of this case');
    assert.ok(written.includes('<h2 class="ic-report-title">IC Report</h2>'), 'titled IC Report');
    assert.ok(written.includes('<div class="ic-report-case">Case # Case-7</div>'), 'subtitled with the case #');
    assert.ok(written.includes('Search concluded. Debrief at 1500.'), 'the report text is printed');
    assert.ok(written.includes('Completed by Chris Ray at '), 'the completion tag is printed');
    assert.ok(written.includes('.ic-report-text {'), 'the print styles of the report are included');
    assert.ok(!written.includes('search-log-table'), 'no Search Log table in the IC Report printout');
    assert.ok(!written.includes('Activity Log'), 'no activity log in the IC Report printout');
    assert.ok(!written.includes('class="task-form"'), 'no task assignment forms in the IC Report printout');

    // No popup allowed -> a message, not a crash.
    let alerted = '';
    app.window.open = () => null;
    app.alert = (msg) => { alerted = msg; };
    app.printIcReport();
    assert.ok(alerted.includes('popups'), alerted);
}

// --- 5. The Search Log page no longer carries the form ------------------------
{
    const page4 = fs.readFileSync(path.join(__dirname, 'page4.html'), 'utf8');
    assert.ok(!page4.includes('ic-report-panel'), 'page4.html has no IC Report panel');
    const page5 = fs.readFileSync(path.join(__dirname, 'page5.html'), 'utf8');
    const incidentAt = page5.indexOf('id="btn-incident-times"');
    const icAt = page5.indexOf('id="btn-ic-report"');
    const manageAt = page5.indexOf('id="btn-manage-forms"');
    assert.ok(incidentAt > -1 && icAt > -1 && manageAt > -1, 'page5.html has the three form buttons');
    assert.ok(incidentAt < icAt && icAt < manageAt, 'the IC Report button sits right next to Incident Times');
    assert.ok(/id="btn-ic-report">IC Report</.test(page5), 'the button is labelled IC Report');

    // Building the Search Log page must not touch the form (it lives elsewhere).
    const logStore = {...store};
    const logApp = createSandbox(logStore, 'page4');
    logApp.buildSearchLogTable();
    assert.strictEqual(logApp.__byId['ic-report-text'], undefined, 'the Search Log page never renders the IC Report fields');
}

// --- 6. The Case # Printout still prints it after the charts, before the table -
{
    let written = '';
    app.window.open = () => ({document: {write(html) { written += html; }, close() {}}});
    app.printSearchFile();
    assert.ok(written.length > 0, 'the printout is written');
    const chartsAt = written.indexOf('class="charts-container"');
    const icAt = written.indexOf('class="ic-report"');
    const tableAt = written.indexOf('class="search-log-table"');
    const activityAt = written.indexOf('<h1>Activity Log</h1>');
    assert.ok(chartsAt > -1 && icAt > -1 && tableAt > -1 && activityAt > -1, 'all printout sections are present');
    assert.ok(chartsAt < icAt, 'the IC Report comes after the two charts');
    assert.ok(icAt < tableAt, 'the IC Report comes before the task assignment (Search Log) table');
    assert.ok(tableAt < activityAt, 'the reports still follow the table');
    assert.ok(written.includes('<h2 class="ic-report-title">IC Report</h2>'), 'titled IC Report');
    assert.ok(written.includes('<div class="ic-report-case">Case # Case-7</div>'), 'subtitled with the case #');
    assert.ok(written.includes('Search concluded. Debrief at 1500.'), 'the report text is printed');
    assert.ok(written.includes('Completed by Chris Ray at '), 'the completion tag is printed');

    // Report text is printed as text, never as markup.
    const b = app.loadBundle();
    b.icReport.text = '<b>bold</b> & "quotes"';
    app.saveBundle(b);
    const html = app.getIcReportPrintHTML(app.loadBundle());
    assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;'), html);
    assert.ok(!html.includes('<b>bold</b>'));

    const blank = app.getIcReportPrintHTML(app.defaultBundle());
    assert.ok(blank.includes('No IC report has been written for this case.'));
    assert.ok(blank.includes('Form not yet completed'));
}

// --- 7. Row-level sync carries the report field by field --------------------
{
    const utils = app.SARSyncDelta;
    const before = app.loadBundle();
    const after = JSON.parse(JSON.stringify(before));
    after.icReport.text = 'Edited on another device';
    const changes = utils.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1, 'one change for one edited field');
    // (arrays come from the vm realm, so compare contents rather than prototypes)
    assert.strictEqual(changes[0].path.join('.'), 'icReport.text');
    assert.strictEqual(changes[0].value, 'Edited on another device');

    const applied = utils.applyBundleChanges(JSON.parse(JSON.stringify(before)), changes);
    assert.strictEqual(applied.applied.length, 1, 'the receiving device applies the row');
    assert.strictEqual(applied.bundle.icReport.text, 'Edited on another device', 'the receiving device gets the new text');
    assert.strictEqual(applied.bundle.icReport.completedBy, before.icReport.completedBy, 'the completion tag is untouched');
}

console.log('IC Report: PASS');

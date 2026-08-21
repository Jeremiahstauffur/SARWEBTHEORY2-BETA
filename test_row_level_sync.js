// Tests for the row-level sync introduced so several devices can share one
// search file without overwriting each other.
//
// The bug: every device uploaded the WHOLE search file on every save, so the
// last writer wiped out the rows the other devices had just typed. A device now
// sends only the row behind the cell it left, and the server merges that row
// into the stored file.
//
// Run with: node test_row_level_sync.js

const assert = require('assert');
const fs = require('fs');
const syncDelta = require('./sync-delta');

let passed = 0;
const check = (name, fn) => {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseBundle = () => ({
    fileName: 'Case-2026#7',
    lastModified: '2026-01-01T00:00:00.000Z',
    theme: 'dark',
    profile: {incidentNumber: 'INC-1', lostPersonName: 'John Doe'},
    uploads: [{name: 'map.pdf'}, {name: 'clue.jpg'}],
    forms: {form_104: {a: 1}},
    pages: {
        index: {
            headers: ['Region', 'Voter 1', 'Voter 2', 'Consensus'],
            rows: [
                ['North Ridge', '', '', ''],
                ['South Valley', '', '', ''],
                ['East Creek', '', '', '']
            ],
            voterVisibility: [true, true]
        },
        page2: [
            ['R1', 'Seg A', '', '', '', '', '', '', '', ''],
            ['R1', 'Seg B', '', '', '', '', '', '', '', '']
        ],
        page3: [['Alice'], ['Bob']]
    }
});

console.log('computeBundleChanges - only the edited row travels');

check('entering a voter value sends exactly one Regions row', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.index.rows[1][1] = '40';
    after.lastModified = '2026-02-02T00:00:00.000Z';

    const changes = syncDelta.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1, `expected 1 change, got ${JSON.stringify(changes)}`);
    assert.deepStrictEqual(changes[0].path, ['pages', 'index', 'rows', '1']);
    assert.deepStrictEqual(changes[0].value, ['South Valley', '40', '', '']);
});

check('nothing else from the page (or any other page) is included', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.index.rows[0][2] = '15';

    const changes = syncDelta.computeBundleChanges(before, after);
    const paths = changes.map(c => c.path.join('.'));
    assert.deepStrictEqual(paths, ['pages.index.rows.0']);
});

check('an unchanged save produces no changes at all (so no request is sent)', () => {
    const before = baseBundle();
    const after = clone(before);
    assert.strictEqual(syncDelta.computeBundleChanges(before, after).length, 0);
});

check('a new lastModified alone is not a change', () => {
    const before = baseBundle();
    const after = clone(before);
    after.lastModified = new Date().toISOString();
    assert.strictEqual(syncDelta.computeBundleChanges(before, after).length, 0);
});

check('array-style pages (Segments) also send a single row', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.page2[1][7] = '62';

    const changes = syncDelta.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1);
    assert.deepStrictEqual(changes[0].path, ['pages', 'page2', '1']);
});

check('editing a header sends the header list, not the rows', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.index.headers[1] = 'Jeremiah';

    const changes = syncDelta.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1);
    assert.deepStrictEqual(changes[0].path, ['pages', 'index', 'headers']);
});

check('top-level lists send one item, not the whole list', () => {
    const before = baseBundle();
    const after = clone(before);
    after.uploads[1] = {name: 'renamed.jpg'};

    const changes = syncDelta.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 1);
    assert.deepStrictEqual(changes[0].path, ['uploads', '1']);
});

check('adding a row reports the new length plus only the new row', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.page2.push(['R2', 'Seg C', '', '', '', '', '', '', '', '']);

    const changes = syncDelta.computeBundleChanges(before, after);
    assert.strictEqual(changes.length, 2);
    assert.deepStrictEqual(changes[0], {path: ['pages', 'page2'], length: 3});
    assert.deepStrictEqual(changes[1].path, ['pages', 'page2', '2']);
});

console.log('\napplyBundleChanges - the server merges row by row');

check('applying a row change reproduces the sender bundle', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.index.rows[2][1] = '77';

    const changes = syncDelta.computeBundleChanges(before, after);
    const server = clone(before);
    syncDelta.applyBundleChanges(server, changes);
    assert.deepStrictEqual(server.pages.index.rows, after.pages.index.rows);
});

check('THE BUG: two devices editing different rows both keep their entry', () => {
    // Both devices start from the same stored file.
    const stored = baseBundle();

    const deviceA = clone(stored);
    deviceA.pages.index.rows[0][1] = 'A-value';
    const changesA = syncDelta.computeBundleChanges(stored, deviceA);

    const deviceB = clone(stored);
    deviceB.pages.index.rows[2][1] = 'B-value';
    const changesB = syncDelta.computeBundleChanges(stored, deviceB);

    // The server applies them in whatever order they arrive.
    const server = clone(stored);
    syncDelta.applyBundleChanges(server, changesA);
    syncDelta.applyBundleChanges(server, changesB);

    assert.strictEqual(server.pages.index.rows[0][1], 'A-value', 'device A entry was lost');
    assert.strictEqual(server.pages.index.rows[2][1], 'B-value', 'device B entry was lost');
    assert.strictEqual(server.pages.index.rows[1][0], 'South Valley', 'an untouched row was damaged');
});

check('a device on another page cannot clobber the page it is not on', () => {
    const stored = baseBundle();

    // Device A works on Segments only.
    const deviceA = clone(stored);
    deviceA.pages.page2[0][2] = 'segment-edit';
    const changesA = syncDelta.computeBundleChanges(stored, deviceA);

    // Meanwhile Regions already moved on for everybody else.
    const server = clone(stored);
    server.pages.index.rows[0][1] = 'set-by-someone-else';

    syncDelta.applyBundleChanges(server, changesA);
    assert.strictEqual(server.pages.index.rows[0][1], 'set-by-someone-else');
    assert.strictEqual(server.pages.page2[0][2], 'segment-edit');
});

check('deleting a row shortens the stored page correctly', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.page2.splice(0, 1);

    const changes = syncDelta.computeBundleChanges(before, after);
    const server = clone(before);
    syncDelta.applyBundleChanges(server, changes);
    assert.deepStrictEqual(server.pages.page2, after.pages.page2);
});

check('adding a row grows the stored page correctly', () => {
    const before = baseBundle();
    const after = clone(before);
    after.pages.index.rows.push(['West Fork', '', '', '']);

    const changes = syncDelta.computeBundleChanges(before, after);
    const server = clone(before);
    syncDelta.applyBundleChanges(server, changes);
    assert.deepStrictEqual(server.pages.index.rows, after.pages.index.rows);
});

check('a removed key is applied as a deletion', () => {
    const before = baseBundle();
    const after = clone(before);
    delete after.forms.form_104;

    const changes = syncDelta.computeBundleChanges(before, after);
    const server = clone(before);
    syncDelta.applyBundleChanges(server, changes);
    assert.deepStrictEqual(server.forms, {});
});

check('paths that try to reach Object.prototype are rejected', () => {
    const server = baseBundle();
    const applied = syncDelta.applyBundleChanges(server, [
        {path: ['__proto__', 'polluted'], value: true},
        {path: ['pages', 'constructor'], value: true},
        {path: [], value: true}
    ]).applied;
    assert.strictEqual(applied.length, 0);
    assert.strictEqual({}.polluted, undefined);
});

console.log('\ndescribeChangeTarget - one structured table row per change');

check('a Regions row maps to a single regions row', () => {
    const target = syncDelta.describeChangeTarget({path: ['pages', 'index', 'rows', '4'], value: []});
    assert.deepStrictEqual(target, {kind: 'collectionRow', table: 'regions', rowIndex: 4});
});

check('a Segments/Personnel/Search Log row maps to its own table row', () => {
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['pages', 'page2', '2'], value: []}),
        {kind: 'collectionRow', table: 'segments', rowIndex: 2}
    );
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['pages', 'page3', '0'], value: []}),
        {kind: 'collectionRow', table: 'personnel', rowIndex: 0}
    );
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['pages', 'page4', '9'], value: []}),
        {kind: 'collectionRow', table: 'search_log', rowIndex: 9}
    );
});

check('a row count change rebuilds only that one table', () => {
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['pages', 'page2'], length: 3}),
        {kind: 'collectionRebuild', table: 'segments'}
    );
});

check('profile and settings changes map to their single-record tables', () => {
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['profile', 'incidentNumber'], value: 'x'}),
        {kind: 'single', table: 'profile'}
    );
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['theme'], value: 'light'}),
        {kind: 'single', table: 'settings_page'}
    );
});

check('an upload item maps to a single uploaded_files row', () => {
    assert.deepStrictEqual(
        syncDelta.describeChangeTarget({path: ['uploads', '1'], value: {}}),
        {kind: 'collectionRow', table: 'uploaded_files', rowIndex: 1}
    );
});

check('getPageData returns one page and nothing else', () => {
    const bundle = baseBundle();
    assert.deepStrictEqual(syncDelta.getPageData(bundle, 'page3'), [['Alice'], ['Bob']]);
    assert.strictEqual(syncDelta.getPageData(bundle, 'page9'), undefined);
    assert.strictEqual(syncDelta.getPageData(bundle, '__proto__'), undefined);
});

console.log('\nwiring - the website no longer uploads whole pages');

const appSource = fs.readFileSync('./app.js', 'utf8');
const serverSource = fs.readFileSync('./sync-server.js', 'utf8');

check('saving a page pushes a row delta, not the whole search file', () => {
    assert.ok(
        /function saveBundle[\s\S]{0,600}?pushBundleDelta\(sanitized\)/.test(appSource),
        'saveBundle must push only the changed rows'
    );
});

check('leaving a page never uploads it', () => {
    const pagehide = appSource.match(/addEventListener\('pagehide'[\s\S]*?\n\}\);/);
    assert.ok(pagehide, 'pagehide handler must exist');
    assert.ok(!/syncWithServer\(\)/.test(pagehide[0]), 'pagehide must not push or full-sync');

    const hidden = appSource.match(/addEventListener\('visibilitychange'[\s\S]*?\n\}\);/);
    assert.ok(hidden, 'visibilitychange handler must exist');
    assert.ok(!/syncWithServer\(\)/.test(hidden[0]), 'visibilitychange must not push or full-sync');
});

check('the background sync never re-uploads the whole search file', () => {
    const sync = appSource.match(/async function syncWithServer[\s\S]*?\r?\n\}\r?\n/);
    assert.ok(sync, 'syncWithServer must exist');
    // The only whole-file upload left is the one-time seed when the server has
    // no copy of this CASE # yet (the 404 branch).
    const fullPushes = [...sync[0].matchAll(/pushBundleToServer\(/g)];
    assert.strictEqual(fullPushes.length, 1, 'syncWithServer must only seed a missing search file');
    assert.ok(/resp\.status === 404/.test(sync[0]), 'the remaining full push must be the seeding branch');
});

check('an edit is never dropped when the server has no row endpoint', () => {
    const push = appSource.match(/async function pushBundleDelta[\s\S]*?\r?\n\}\r?\n/);
    assert.ok(push, 'pushBundleDelta must exist');
    // A backend without /rows (or one that has no copy of this CASE # yet) must
    // still receive the edit as a whole-file upload.
    assert.ok(/needsFullSync/.test(push[0]));
    assert.ok(/404, 405/.test(push[0]), 'unsupported-endpoint statuses must fall back');
    assert.ok(/pushBundleToServer\(bundle\)/.test(push[0]));
});

check('the website can ask for a single page of data', () => {
    assert.ok(/async function pullCurrentPageData/.test(appSource));
    assert.ok(/\/page\/\$\{encodeURIComponent\(pageName\)\}/.test(appSource));
});

check('the server exposes row-change and single-page endpoints', () => {
    assert.ok(/app\.post\('\/api\/v1\/:bucket\/rows'/.test(serverSource));
    assert.ok(/app\.get\('\/api\/v1\/:bucket\/page\/:page'/.test(serverSource));
});

check('row changes for one CASE # are applied one at a time', () => {
    assert.ok(/const withBucketLock = /.test(serverSource), 'writes must be serialized per CASE #');
    assert.ok(/withBucketLock\(bucket/.test(serverSource), 'the row endpoint must take the lock');
});

check('the server writes single table rows instead of wiping the table', () => {
    assert.ok(/const upsertCollectionRow = /.test(serverSource));
    assert.ok(/applyChangesToTables\(userName, bucket, bundle, applied\)/.test(serverSource));
});

console.log(`\nAll ${passed} checks passed.`);

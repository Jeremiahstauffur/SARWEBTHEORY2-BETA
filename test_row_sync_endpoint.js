// End-to-end test of the row-level sync endpoints in sync-server.js.
//
// Two devices are simulated posting a single changed row each, in the same way
// the website does when a cell loses focus. Both entries must survive, and each
// device must only ever be able to read back the page it asks for.
//
// The MySQL pool is replaced with a tiny in-memory stand-in so the test runs
// without a database.
//
// Run with: node test_row_sync_endpoint.js

const assert = require('assert');
const http = require('http');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool, installed before sync-server.js loads.
// ---------------------------------------------------------------------------
const store = new Map();               // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const tables = new Map();              // table -> array of row objects
const singles = new Map();             // "table\u0000username\u0000case" -> row

const TEST_USER = {username: 'Team Alpha', pin: '2468', password: 'ignored'};

const tableRows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
};

const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const query = (rawSql, params, cb) => {
    const sql = norm(rawSql);
    const p = params || [];
    let m;

    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        const ok = p[0] === TEST_USER.username && (p[1] === TEST_USER.password || p[2] === TEST_USER.pin);
        return cb(null, ok ? [{...TEST_USER}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, row ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin, updatedAt FROM store WHERE bucket = \? AND `key` = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, row ? [{userPin: row.userPin, updatedAt: row.updatedAt}] : []);
    }
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\)/.test(sql)) {
        store.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \? AND row_index = \?$/))) {
        const rows = tableRows(m[1]);
        const kept = rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.row_index === p[2]));
        tables.set(m[1], kept);
        return cb(null, {affectedRows: rows.length - kept.length});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        const rows = tableRows(m[1]);
        const kept = rows.filter(r => !(r.username === p[0] && r.search_case === p[1]));
        tables.set(m[1], kept);
        return cb(null, {affectedRows: rows.length - kept.length});
    }
    if ((m = sql.match(/^INSERT INTO `(\w+)` \(username, search_case, row_index, label, data, updatedAt\)/))) {
        tableRows(m[1]).push({
            username: p[0], search_case: p[1], row_index: p[2], label: p[3], data: p[4], updatedAt: p[5]
        });
        return cb(null, {affectedRows: 1, insertId: 1});
    }
    if ((m = sql.match(/^REPLACE INTO `(\w+)` \(username, search_case, data, updatedAt\)/))) {
        singles.set(`${m[1]}\u0000${p[0]}\u0000${p[1]}`, {data: p[2], updatedAt: p[3]});
        return cb(null, {affectedRows: 1});
    }

    return cb(new Error(`unhandled SQL in test stand-in: ${sql}`));
};

require.cache[require.resolve('mysql2')] = {
    id: require.resolve('mysql2'),
    filename: require.resolve('mysql2'),
    loaded: true,
    exports: {createPool: () => ({query})}
};

const {app} = require('./sync-server');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const BUCKET = 'CASE-77_2468';
const FILE_NAME = 'CASE-77';

const authHeaders = {
    'Content-Type': 'application/json',
    'X-User-Name': TEST_USER.username,
    'X-User-Pin': TEST_USER.pin,
    'X-User-Password': TEST_USER.pin
};

let baseUrl = '';
let passed = 0;

const call = async (method, path, body) => {
    const resp = await fetch(`${baseUrl}${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {status: resp.status, body: await resp.json().catch(() => ({}))};
};

const storedBundle = () => JSON.parse(store.get(`${BUCKET}\u0000bundle`).value);

const seedBundle = () => ({
    fileName: FILE_NAME,
    lastModified: '2026-01-01T00:00:00.000Z',
    theme: 'dark',
    profile: {incidentNumber: 'INC-1'},
    pages: {
        index: {
            headers: ['Region', 'Voter 1', 'Consensus'],
            rows: [
                ['North Ridge', '', ''],
                ['South Valley', '', ''],
                ['East Creek', '', '']
            ],
            voterVisibility: [true]
        },
        page2: [['R1', 'Seg A', '', '', '', '', '', '', '', '']]
    }
});

const run = async () => {
    const check = async (name, fn) => {
        await fn();
        passed++;
        console.log(`  ok - ${name}`);
    };

    console.log('POST /api/v1/:bucket/rows');

    await check('a row change is refused until the search file exists', async () => {
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            changes: [{path: ['pages', 'index', 'rows', '0'], value: ['North Ridge', '10', '10']}]
        });
        assert.strictEqual(resp.status, 409);
        assert.strictEqual(resp.body.needsFullSync, true);
    });

    await check('the search file is seeded once with a full upload', async () => {
        const resp = await call('PUT', `/api/v1/${BUCKET}/bundle`, seedBundle());
        assert.strictEqual(resp.status, 200);
        assert.deepStrictEqual(storedBundle().pages.index.rows[0], ['North Ridge', '', '']);
    });

    await check('a single changed row is merged into the stored file', async () => {
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            changes: [{path: ['pages', 'index', 'rows', '1'], value: ['South Valley', '40', '40']}]
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.applied, 1);
        assert.deepStrictEqual(storedBundle().pages.index.rows[1], ['South Valley', '40', '40']);
    });

    await check('THE BUG: two devices posting different rows at once both win', async () => {
        // Fired without awaiting in between, exactly like two devices racing.
        const [a, b] = await Promise.all([
            call('POST', `/api/v1/${BUCKET}/rows`, {
                fileName: FILE_NAME,
                changes: [{path: ['pages', 'index', 'rows', '0'], value: ['North Ridge', 'A', 'A']}]
            }),
            call('POST', `/api/v1/${BUCKET}/rows`, {
                fileName: FILE_NAME,
                changes: [{path: ['pages', 'index', 'rows', '2'], value: ['East Creek', 'B', 'B']}]
            })
        ]);
        assert.strictEqual(a.status, 200);
        assert.strictEqual(b.status, 200);

        const rows = storedBundle().pages.index.rows;
        assert.deepStrictEqual(rows[0], ['North Ridge', 'A', 'A'], 'device A row was lost');
        assert.deepStrictEqual(rows[2], ['East Creek', 'B', 'B'], 'device B row was lost');
        assert.deepStrictEqual(rows[1], ['South Valley', '40', '40'], 'an untouched row was damaged');
    });

    await check('a device editing Segments leaves Regions untouched', async () => {
        const before = storedBundle().pages.index.rows;
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            changes: [{path: ['pages', 'page2', '0'], value: ['R1', 'Seg A', 'edited', '', '', '', '', '', '', '']}]
        });
        assert.strictEqual(resp.status, 200);
        assert.deepStrictEqual(storedBundle().pages.index.rows, before);
        assert.strictEqual(storedBundle().pages.page2[0][2], 'edited');
    });

    await check('only the changed row is rewritten in the regions table', async () => {
        const rows = tables.get('regions').filter(r => r.search_case === FILE_NAME);
        // The seed wrote all three rows; the row updates replaced them in place
        // rather than adding duplicates.
        assert.strictEqual(rows.length, 3, `expected 3 region rows, got ${rows.length}`);
        const byIndex = new Map(rows.map(r => [r.row_index, JSON.parse(r.data)]));
        assert.deepStrictEqual(byIndex.get(0), ['North Ridge', 'A', 'A']);
        assert.deepStrictEqual(byIndex.get(2), ['East Creek', 'B', 'B']);
    });

    await check('an empty change list is accepted without touching anything', async () => {
        const before = store.get(`${BUCKET}\u0000bundle`).value;
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {fileName: FILE_NAME, changes: []});
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(store.get(`${BUCKET}\u0000bundle`).value, before);
    });

    await check('a malformed body is rejected', async () => {
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {fileName: FILE_NAME});
        assert.strictEqual(resp.status, 400);
    });

    console.log('\nGET /api/v1/:bucket/page/:page');

    await check('a page request returns only that page', async () => {
        const resp = await call('GET', `/api/v1/${BUCKET}/page/index`);
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.found, true);
        assert.deepStrictEqual(resp.body.data.rows[0], ['North Ridge', 'A', 'A']);
        assert.ok(!('page2' in resp.body.data), 'the response must not carry other pages');
        assert.deepStrictEqual(Object.keys(resp.body).sort(), ['data', 'found', 'lastModified', 'page']);
    });

    await check('a page nobody has data for reports found:false', async () => {
        const resp = await call('GET', `/api/v1/${BUCKET}/page/page7`);
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.found, false);
        assert.strictEqual(resp.body.data, null);
    });

    await check('a request for a CASE # with no data does not fail', async () => {
        const resp = await call('GET', '/api/v1/UNKNOWN-CASE/page/index');
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.found, false);
    });

    await check('both endpoints require authentication', async () => {
        const rows = await fetch(`${baseUrl}/api/v1/${BUCKET}/rows`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({changes: []})
        });
        assert.strictEqual(rows.status, 401);
        const page = await fetch(`${baseUrl}/api/v1/${BUCKET}/page/index`);
        assert.strictEqual(page.status, 401);
    });

    console.log(`\nAll ${passed} endpoint checks passed.`);
};

const server = http.createServer(app);
server.listen(0, '127.0.0.1', async () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run();
        server.close();
    } catch (err) {
        server.close();
        console.error(err);
        process.exitCode = 1;
    }
});

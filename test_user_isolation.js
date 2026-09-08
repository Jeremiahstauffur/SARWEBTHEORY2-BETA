// Same-PIN / different-username isolation test for sync-server.js.
//
// Two logins deliberately share the SAME PIN but have DIFFERENT usernames.
// Every synced read/write is scoped to the authenticated username, so:
//   * with per-user buckets (the client namespaces each CASE # by username)
//     the two logins never touch the same row; and
//   * even if they somehow addressed the SAME bucket string, one login can
//     never read or merge into the other's data because the server filters by
//     userName on /latest, /:key, /page and /rows.
//
// The MySQL pool is replaced with a tiny in-memory stand-in so the test runs
// without a database.
//
// Run with: node test_user_isolation.js

const assert = require('assert');
const http = require('http');

// Two accounts that share a PIN on purpose. This is exactly the leak the
// per-user bucket + userName scoping is meant to close.
const USERS = [
    {username: 'alice', pin: '1234'},
    {username: 'bob', pin: '1234'}
];

const store = new Map();   // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const tables = new Map();  // table -> array of row objects
const singles = new Map(); // "table\u0000username\u0000case" -> row
const userBuckets = new Map(); // "username\u0000bucket" -> {lastAccessed} (the Saved Cases list)

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
        const u = USERS.find(x => x.username === p[0] && (x.password === p[1] || x.pin === p[2]));
        return cb(null, u ? [{...u}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        userBuckets.set(`${p[0]}\u0000${p[1]}`, {lastAccessed: p[2]});
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT bucket, lastAccessed FROM user_buckets WHERE username = \? ORDER BY lastAccessed DESC$/.test(sql)) {
        const rows = [...userBuckets.entries()]
            .filter(([k]) => k.split('\u0000')[0] === p[0])
            .map(([k, v]) => ({bucket: k.split('\u0000')[1], lastAccessed: v.lastAccessed}))
            .sort((a, b) => String(b.lastAccessed).localeCompare(String(a.lastAccessed)));
        return cb(null, rows);
    }

    // ---- store reads, all scoped to the authenticated login (userName) ----
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin, updatedAt FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{userPin: row.userPin, updatedAt: row.updatedAt}] : []);
    }
    if (/^SELECT value FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value}] : []);
    }
    if (/^SELECT `key`, updatedAt FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        const rows = [...store.entries()]
            .filter(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1])
            .map(([k, v]) => ({key: k.split('\u0000')[1], updatedAt: v.updatedAt}));
        return cb(null, rows);
    }
    if (/^SELECT value FROM store WHERE bucket = \? AND userName = \? ORDER BY updatedAt DESC LIMIT 1$/.test(sql)) {
        const matches = [...store.entries()]
            .filter(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1])
            .map(([, v]) => v)
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return cb(null, matches.length ? [{value: matches[0].value}] : []);
    }

    // ---- writes ----
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\)/.test(sql)) {
        // Models the store's PRIMARY KEY (bucket, key): a second write to the
        // same (bucket, key) overwrites the first, regardless of userName.
        store.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \? AND row_index = \?$/))) {
        const rows = tableRows(m[1]);
        tables.set(m[1], rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.row_index === p[2])));
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        const rows = tableRows(m[1]);
        tables.set(m[1], rows.filter(r => !(r.username === p[0] && r.search_case === p[1])));
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^INSERT INTO `(\w+)` \(username, search_case, row_index, label, data, updatedAt\)/))) {
        tableRows(m[1]).push({username: p[0], search_case: p[1], row_index: p[2], label: p[3], data: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1, insertId: 1});
    }
    if ((m = sql.match(/^REPLACE INTO `(\w+)` \(username, search_case, data, updatedAt\)/))) {
        singles.set(`${m[1]}\u0000${p[0]}\u0000${p[1]}`, {data: p[2], updatedAt: p[3]});
        return cb(null, {affectedRows: 1});
    }

    // ---- per-entry activity log (activity_log_entries) ----
    if (/^REPLACE INTO `activity_log_entries` \(username, search_case, entry_id,/.test(sql)) {
        const rows = tableRows('activity_log_entries');
        const kept = rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.entry_id === p[2]));
        kept.push({username: p[0], search_case: p[1], entry_id: p[2], user_handle: p[3], team: p[4], tag: p[5],
            members: p[6], action: p[7], log_date: p[8], log_time: p[9], logged_at: p[10], data: p[11], updatedAt: p[12], deletedAt: null});
        tables.set('activity_log_entries', kept);
        return cb(null, {affectedRows: 1});
    }
    if (/^UPDATE `activity_log_entries` SET deletedAt = \? WHERE username = \? AND search_case = \? AND entry_id = \? AND deletedAt IS NULL$/.test(sql)) {
        tableRows('activity_log_entries').forEach(r => {
            if (r.username === p[1] && r.search_case === p[2] && r.entry_id === p[3] && r.deletedAt === null) r.deletedAt = p[0];
        });
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

const headersFor = (username) => ({
    'Content-Type': 'application/json',
    'X-User-Name': username,
    'X-User-Pin': '1234',
    'X-User-Password': '1234'
});

let baseUrl = '';
let passed = 0;

const call = async (username, method, path, body) => {
    const resp = await fetch(`${baseUrl}${path}`, {
        method,
        headers: headersFor(username),
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {status: resp.status, body: await resp.json().catch(() => ({}))};
};

const bundleFor = (fileName, marker) => ({
    fileName,
    lastModified: '2026-01-01T00:00:00.000Z',
    pages: {
        index: {
            headers: ['Region', 'Note'],
            rows: [[marker, `secret-${marker}`]]
        }
    }
});

const run = async () => {
    const check = async (name, fn) => { await fn(); passed++; console.log(`  ok - ${name}`); };

    console.log('Per-user buckets (same PIN, different username)');

    await check('each login seeds its own username-scoped bucket', async () => {
        const a = await call('alice', 'PUT', '/api/v1/CASE-1_alice/bundle', bundleFor('CASE-1', 'alice'));
        const b = await call('bob', 'PUT', '/api/v1/CASE-1_bob/bundle', bundleFor('CASE-1', 'bob'));
        assert.strictEqual(a.status, 200);
        assert.strictEqual(b.status, 200);
    });

    await check('/latest returns only the caller\'s own data', async () => {
        const a = await call('alice', 'GET', '/api/v1/CASE-1_alice/latest');
        const b = await call('bob', 'GET', '/api/v1/CASE-1_bob/latest');
        assert.deepStrictEqual(a.body.pages.index.rows[0], ['alice', 'secret-alice']);
        assert.deepStrictEqual(b.body.pages.index.rows[0], ['bob', 'secret-bob']);
    });

    console.log('\nServer-side userName scoping (same bucket string)');

    await check('alice seeds a shared-named bucket', async () => {
        const a = await call('alice', 'PUT', '/api/v1/SHARED/bundle', bundleFor('SHARED', 'alice'));
        assert.strictEqual(a.status, 200);
    });

    await check('bob cannot read alice\'s bundle via /latest', async () => {
        const b = await call('bob', 'GET', '/api/v1/SHARED/latest');
        assert.strictEqual(b.status, 404);
    });

    await check('bob cannot read alice\'s bundle via /:key', async () => {
        const b = await call('bob', 'GET', '/api/v1/SHARED/bundle');
        assert.strictEqual(b.status, 404);
    });

    await check('bob cannot read alice\'s page via /page', async () => {
        const b = await call('bob', 'GET', '/api/v1/SHARED/page/index');
        assert.strictEqual(b.status, 200);
        assert.strictEqual(b.body.found, false);
    });

    await check('bob cannot merge rows into alice\'s bundle via /rows', async () => {
        const b = await call('bob', 'POST', '/api/v1/SHARED/rows', {
            fileName: 'SHARED',
            changes: [{path: ['pages', 'index', 'rows', '0'], value: ['bob', 'hijack']}]
        });
        // readStoredBundle finds nothing for bob, so the server asks bob to seed
        // his own file instead of letting him edit alice's.
        assert.strictEqual(b.status, 409);
        assert.strictEqual(b.body.needsFullSync, true);
    });

    await check('alice still reads her own data, untouched by bob', async () => {
        const a = await call('alice', 'GET', '/api/v1/SHARED/page/index');
        assert.strictEqual(a.body.found, true);
        assert.deepStrictEqual(a.body.data.rows[0], ['alice', 'secret-alice']);
    });

    console.log('\nSaved Cases (/api/auth/history) show only the caller\'s own cases');

    await check('each login sees its own cases only, with the stored file\'s row counts', async () => {
        const a = await call('alice', 'GET', '/api/auth/history');
        const b = await call('bob', 'GET', '/api/auth/history');
        assert.strictEqual(a.status, 200);
        assert.strictEqual(b.status, 200);
        assert.deepStrictEqual(a.body.map(r => r.bucket).sort(), ['CASE-1_alice', 'SHARED']);
        assert.deepStrictEqual(b.body.map(r => r.bucket).sort(), ['CASE-1_bob', 'SHARED']);
        const aliceCase1 = a.body.find(r => r.bucket === 'CASE-1_alice');
        assert.strictEqual(aliceCase1.caseNumber, 'CASE-1');
        assert.strictEqual(aliceCase1.hasFile, true);
        assert.deepStrictEqual(aliceCase1.stats, {regions: 1, segments: 0, personnel: 0, tasks: 0});
        // bob opened SHARED (his /rows attempt) but never got a file of his own
        // there: his row is his own empty case - alice's file, rows and counts
        // are never his to see - and shows as deletable, not as alice's data.
        const bobShared = b.body.find(r => r.bucket === 'SHARED');
        assert.strictEqual(bobShared.hasFile, false, 'bob has no file under SHARED');
        assert.strictEqual(bobShared.stats, null, 'alice\'s counts never leak to bob');
        const aliceShared = a.body.find(r => r.bucket === 'SHARED');
        assert.strictEqual(aliceShared.hasFile, true);
    });

    await check('the internal store keys never show up as cases', async () => {
        // A presence ping and a stale "all-files" write are bookkeeping, not cases.
        await call('alice', 'PUT', '/api/v1/CASE-1_alice/user-1234', {deviceId: 'd', lastModified: '2026-01-01T00:00:00.000Z'});
        await call('alice', 'PUT', '/api/v1/CASE-1_alice/all-files', {});
        await call('alice', 'PUT', '/api/v1/bundle/bundle', bundleFor('bundle', 'alice'));
        await call('alice', 'PUT', '/api/v1/user-1234/bundle', bundleFor('user-1234', 'alice'));
        const a = await call('alice', 'GET', '/api/auth/history');
        assert.deepStrictEqual(a.body.map(r => r.bucket).sort(), ['CASE-1_alice', 'SHARED']);
        // The per-bucket file list (older clients) lists the search file only,
        // never the bookkeeping rows that used to show up as cases.
        const files = await call('alice', 'GET', '/api/v1/CASE-1_alice/all-files');
        assert.strictEqual(files.status, 200);
        assert.deepStrictEqual(Object.keys(files.body).sort(), ['CASE-1']);
    });

    console.log(`\nAll ${passed} isolation checks passed.`);
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

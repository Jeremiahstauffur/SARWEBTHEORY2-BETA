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
        return cb(null, {affectedRows: 1});
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

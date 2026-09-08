// Whole-case delete test for sync-server.js (DELETE /api/v1/:bucket).
//
// Verifies that deleting a case removes every trace of it for the authenticated
// login so it cannot resync back:
//   * all store rows for (bucket, userName) — not just the "bundle" key;
//   * the user_buckets history row (username, bucket); and
//   * every structured-table row for (username, search_case = CASE #),
//     targeting the specific CASE # (never a sibling case).
// It also confirms the Super-Admin (PIN 1976) protection, that a case which
// exists only on the server (never cached), has no store rows at all (a
// corrupt/orphaned case) or holds an unreadable search file can still be
// deleted, that structured rows an older build keyed by the file name (with
// ".json") are cleared too, that a percent-encoded username in the URL
// round-trips to the decoded bucket the data lives under, and that
// /api/auth/history lists only real CASE #s (never the internal "bundle",
// "all-files" or "user-<pin>" keys) together with each case's row counts.
//
// The MySQL pool is replaced with a tiny in-memory stand-in so the test runs
// without a database. Data is pre-seeded directly into the stand-in (rather
// than via PUT) so the assertions are deterministic and independent of the
// fire-and-forget structured-table decompose the PUT route performs.
//
// Run with: node test_case_delete.js

const assert = require('assert');
const http = require('http');

const USERS = [
    {username: 'ranger', pin: '1234'},       // regular user
    {username: 'chief', pin: '1976'},        // Super-Admin
    {username: 'Team Alpha', pin: '1234'}    // username with a space (URL-encoded on the wire)
];

const store = new Map();       // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const userBuckets = new Map(); // "username\u0000bucket" -> {lastAccessed}
const tables = new Map();      // table -> array of row objects

const tableRows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
};

const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const query = (rawSql, params, cb) => {
    const sql = norm(rawSql);
    const p = params || [];
    let m;

    // ---- auth ----
    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        const u = USERS.find(x => x.username === p[0] && (x.password === p[1] || x.pin === p[2]));
        return cb(null, u ? [{...u}] : []);
    }

    // ---- DELETE /:bucket: Super-Admin protection lookup ----
    if (/^SELECT userPin FROM store WHERE bucket = \? AND userName = \? AND userPin = \? LIMIT 1$/.test(sql)) {
        const hit = [...store.entries()].find(([k, v]) =>
            k.split('\u0000')[0] === p[0] && v.userName === p[1] && v.userPin === p[2]);
        return cb(null, hit ? [{userPin: hit[1].userPin}] : []);
    }

    // ---- readStoredBundle (DELETE /:bucket and GET /api/auth/history) ----
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const hit = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, hit && hit.userName === p[2] ? [{value: hit.value, userPin: hit.userPin}] : []);
    }

    // ---- PUT /:bucket/:key (generic store write) ----
    if (/^SELECT userPin, updatedAt FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const hit = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, hit && hit.userName === p[2] ? [{userPin: hit.userPin, updatedAt: hit.updatedAt}] : []);
    }
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\) VALUES \(\?, \?, \?, \?, \?, \?\)$/.test(sql)) {
        store.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if (/^REPLACE INTO user_buckets \(username, bucket, lastAccessed\) VALUES \(\?, \?, \?\)$/.test(sql)) {
        userBuckets.set(`${p[0]}\u0000${p[1]}`, {lastAccessed: p[2]});
        return cb(null, {affectedRows: 1});
    }
    // Structured-table writes performed by the decompose after a PUT.
    if ((m = sql.match(/^INSERT INTO `(\w+)` \(username, search_case, row_index, label, data, updatedAt\) VALUES/))) {
        tableRows(m[1]).push({username: p[0], search_case: p[1], row_index: p[2], label: p[3], data: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^REPLACE INTO `(\w+)` \(username, search_case, data, updatedAt\) VALUES/))) {
        const rows = tableRows(m[1]).filter(r => !(r.username === p[0] && r.search_case === p[1]));
        rows.push({username: p[0], search_case: p[1], data: p[2], updatedAt: p[3]});
        tables.set(m[1], rows);
        return cb(null, {affectedRows: 1});
    }
    if (/^REPLACE INTO login_info/.test(sql)) {
        return cb(null, {affectedRows: 1});
    }

    // ---- DELETE /:bucket: three-way cleanup ----
    if (/^DELETE FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        for (const [k, v] of [...store.entries()]) {
            if (k.split('\u0000')[0] === p[0] && v.userName === p[1]) store.delete(k);
        }
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM user_buckets WHERE username = \? AND bucket = \?$/.test(sql)) {
        userBuckets.delete(`${p[0]}\u0000${p[1]}`);
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        const rows = tableRows(m[1]);
        tables.set(m[1], rows.filter(r => !(r.username === p[0] && r.search_case === p[1])));
        return cb(null, {affectedRows: 1});
    }

    // ---- verification reads ----
    if (/^SELECT bucket, lastAccessed FROM user_buckets WHERE username = \? ORDER BY lastAccessed DESC$/.test(sql)) {
        const rows = [...userBuckets.entries()]
            .filter(([k]) => k.split('\u0000')[0] === p[0])
            .map(([k, v]) => ({bucket: k.split('\u0000')[1], lastAccessed: v.lastAccessed}))
            .sort((a, b) => String(b.lastAccessed).localeCompare(String(a.lastAccessed)));
        return cb(null, rows);
    }
    if ((m = sql.match(/^SELECT \* FROM `(\w+)` WHERE username = \?( AND search_case = \?)?( ORDER BY row_index ASC)?$/))) {
        let rows = tableRows(m[1]).filter(r => r.username === p[0]);
        if (m[2]) rows = rows.filter(r => r.search_case === p[1]);
        return cb(null, rows);
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

const {app, STRUCTURED_TABLES} = require('./sync-server');

const headersFor = (username, pin) => ({
    'Content-Type': 'application/json',
    'X-User-Name': username,
    'X-User-Pin': pin,
    'X-User-Password': pin
});

let baseUrl = '';
let passed = 0;

const call = async (username, pin, method, path) => {
    const resp = await fetch(`${baseUrl}${path}`, {method, headers: headersFor(username, pin)});
    return {status: resp.status, body: await resp.json().catch(() => ({}))};
};

// Seed a fully-saved case straight into the stand-in: two store keys (bundle +
// file key), a history row, and a few structured rows across collection and
// single tables. `bucket` is the DECODED form the server persists.
const seedCase = (userName, userPin, caseNumber, bucket) => {
    const now = new Date().toISOString();
    store.set(`${bucket}\u0000bundle`, {value: '{}', userName, userPin, updatedAt: now});
    store.set(`${bucket}\u0000${caseNumber}`, {value: '{}', userName, userPin, updatedAt: now});
    userBuckets.set(`${userName}\u0000${bucket}`, {lastAccessed: now});
    tableRows('regions').push({username: userName, search_case: caseNumber, row_index: 0, label: 'R1', data: '["R1"]', updatedAt: now});
    tableRows('segments').push({username: userName, search_case: caseNumber, row_index: 0, label: 'S1', data: '["S1"]', updatedAt: now});
    tableRows('profile').push({username: userName, search_case: caseNumber, data: '{}', updatedAt: now});
};

const storeKeysFor = (bucket, userName) =>
    [...store.entries()].filter(([k, v]) => k.split('\u0000')[0] === bucket && v.userName === userName);

const structuredRowsFor = (userName, caseNumber) =>
    STRUCTURED_TABLES.reduce((n, t) => n + tableRows(t).filter(r => r.username === userName && r.search_case === caseNumber).length, 0);

const run = async () => {
    const check = async (name, fn) => { await fn(); passed++; console.log(`  ok - ${name}`); };

    console.log('Whole-case delete (DELETE /api/v1/:bucket)');

    await check('regular user deletes their own case: store + history + structured all cleared', async () => {
        seedCase('ranger', '1234', 'CASE-1', 'CASE-1_ranger');
        seedCase('ranger', '1234', 'CASE-2', 'CASE-2_ranger'); // sibling case must survive
        assert.strictEqual(storeKeysFor('CASE-1_ranger', 'ranger').length, 2, 'seeded two store keys');
        assert.strictEqual(structuredRowsFor('ranger', 'CASE-1'), 3, 'seeded three structured rows');

        const res = await call('ranger', '1234', 'DELETE', '/api/v1/CASE-1_ranger');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);

        assert.strictEqual(storeKeysFor('CASE-1_ranger', 'ranger').length, 0, 'all store keys removed');
        assert.ok(!userBuckets.has('ranger\u0000CASE-1_ranger'), 'history row removed');
        assert.strictEqual(structuredRowsFor('ranger', 'CASE-1'), 0, 'structured rows removed');
    });

    await check('sibling case for the same user is untouched (search_case targeting)', async () => {
        assert.strictEqual(storeKeysFor('CASE-2_ranger', 'ranger').length, 2);
        assert.ok(userBuckets.has('ranger\u0000CASE-2_ranger'));
        assert.strictEqual(structuredRowsFor('ranger', 'CASE-2'), 3);
    });

    await check('deleted case no longer appears in /api/auth/history', async () => {
        const hist = await call('ranger', '1234', 'GET', '/api/auth/history');
        assert.strictEqual(hist.status, 200);
        const buckets = (hist.body || []).map(r => r.bucket);
        assert.ok(!buckets.includes('CASE-1_ranger'), 'CASE-1 gone from history');
        assert.ok(buckets.includes('CASE-2_ranger'), 'CASE-2 still in history');
    });

    await check('deleted case returns no structured rows via /api/v1/tables', async () => {
        const t = await call('ranger', '1234', 'GET', '/api/v1/tables?case=CASE-1');
        assert.strictEqual(t.status, 200);
        const total = STRUCTURED_TABLES.reduce((n, name) => n + ((t.body[name] || []).length), 0);
        assert.strictEqual(total, 0, 'no structured rows for the deleted case');
    });

    await check('Super-Admin protection: a regular user cannot delete a 1976-owned case (403)', async () => {
        seedCase('ranger', '1976', 'PROTECTED', 'PROTECTED_ranger'); // written by Super-Admin
        const res = await call('ranger', '1234', 'DELETE', '/api/v1/PROTECTED_ranger');
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.error, 'Conflict');
        // Nothing was removed.
        assert.strictEqual(storeKeysFor('PROTECTED_ranger', 'ranger').length, 2, 'store untouched on 403');
        assert.ok(userBuckets.has('ranger\u0000PROTECTED_ranger'), 'history untouched on 403');
        assert.strictEqual(structuredRowsFor('ranger', 'PROTECTED'), 3, 'structured untouched on 403');
    });

    await check('Super-Admin CAN delete a 1976-owned case', async () => {
        seedCase('chief', '1976', 'CHIEF-1', 'CHIEF-1_chief');
        const res = await call('chief', '1976', 'DELETE', '/api/v1/CHIEF-1_chief');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(storeKeysFor('CHIEF-1_chief', 'chief').length, 0);
        assert.strictEqual(structuredRowsFor('chief', 'CHIEF-1'), 0);
    });

    await check('corrupt/orphaned case with NO store rows can still be deleted', async () => {
        // Only history + structured rows exist (no store bundle at all).
        const now = new Date().toISOString();
        userBuckets.set('ranger\u0000CORRUPT_ranger', {lastAccessed: now});
        tableRows('regions').push({username: 'ranger', search_case: 'CORRUPT', row_index: 0, label: 'x', data: '["x"]', updatedAt: now});
        const res = await call('ranger', '1234', 'DELETE', '/api/v1/CORRUPT_ranger');
        assert.strictEqual(res.status, 200);
        assert.ok(!userBuckets.has('ranger\u0000CORRUPT_ranger'), 'history row removed');
        assert.strictEqual(structuredRowsFor('ranger', 'CORRUPT'), 0, 'structured rows removed');
    });

    await check('case whose stored search file is unreadable (not JSON) is deleted like any other', async () => {
        const now = new Date().toISOString();
        store.set('BROKEN_ranger\u0000bundle', {value: '{not json', userName: 'ranger', userPin: '1234', updatedAt: now});
        userBuckets.set('ranger\u0000BROKEN_ranger', {lastAccessed: now});
        tableRows('segments').push({username: 'ranger', search_case: 'BROKEN', row_index: 0, label: 's', data: '["s"]', updatedAt: now});
        // Listed (so it can be deleted) but flagged as having no readable file.
        const before = await call('ranger', '1234', 'GET', '/api/auth/history');
        const listed = (before.body || []).find(r => r.bucket === 'BROKEN_ranger');
        assert.ok(listed, 'unreadable case is still listed');
        assert.strictEqual(listed.hasFile, false, 'flagged as having no readable file');
        const res = await call('ranger', '1234', 'DELETE', '/api/v1/BROKEN_ranger');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(storeKeysFor('BROKEN_ranger', 'ranger').length, 0, 'store row removed');
        assert.ok(!userBuckets.has('ranger\u0000BROKEN_ranger'), 'history row removed');
        assert.strictEqual(structuredRowsFor('ranger', 'BROKEN'), 0, 'structured rows removed');
    });

    await check('structured rows keyed by the file name ("<CASE>.json", older builds) are cleared too', async () => {
        const now = new Date().toISOString();
        store.set('OLD_ranger\u0000bundle', {value: JSON.stringify({fileName: 'OLD.json', pages: {}}), userName: 'ranger', userPin: '1234', updatedAt: now});
        userBuckets.set('ranger\u0000OLD_ranger', {lastAccessed: now});
        tableRows('regions').push({username: 'ranger', search_case: 'OLD.json', row_index: 0, label: 'r', data: '["r"]', updatedAt: now});
        tableRows('regions').push({username: 'ranger', search_case: 'OLD', row_index: 0, label: 'r', data: '["r"]', updatedAt: now});
        const res = await call('ranger', '1234', 'DELETE', '/api/v1/OLD_ranger');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(structuredRowsFor('ranger', 'OLD.json'), 0, '".json" keyed rows removed');
        assert.strictEqual(structuredRowsFor('ranger', 'OLD'), 0, 'clean keyed rows removed');
    });

    await check('a delete never touches rows keyed by the shared internal "bundle" name', async () => {
        const now = new Date().toISOString();
        // Rows an older build mis-filed under search_case = "bundle" belong to no
        // single case; a delete of one case must leave them alone.
        tableRows('regions').push({username: 'ranger', search_case: 'bundle', row_index: 0, label: 'shared', data: '["shared"]', updatedAt: now});
        seedCase('ranger', '1234', 'CASE-3', 'CASE-3_ranger');
        const res = await call('ranger', '1234', 'DELETE', '/api/v1/CASE-3_ranger');
        assert.strictEqual(res.status, 200);
        assert.ok(!res.body.deleted.searchCases.includes('bundle'), 'internal key never targeted');
        assert.strictEqual(structuredRowsFor('ranger', 'bundle'), 1, 'rows under "bundle" untouched');
        tables.set('regions', tableRows('regions').filter(r => r.search_case !== 'bundle'));
    });

    await check('/api/auth/history lists only real cases, with hasFile + row counts', async () => {
        const now = new Date().toISOString();
        // Internal bookkeeping names an older build registered as "cases".
        ['bundle', 'all-files', 'user-1967', 'user-Finders3!', 'bundle_ranger', 'all-files_ranger', 'user-1400_ranger']
            .forEach(b => userBuckets.set(`ranger\u0000${b}`, {lastAccessed: now}));
        const bundle = {
            fileName: 'CASE-2',
            pages: {
                index: {rows: [['Region A', '', ''], ['', '', ''], ['Region B', '', '']]},
                page2: [['', 'Seg 1'], ['', 'Seg 2'], ['', '']],
                page3: [['Alice'], ['Bob'], ['Carol'], ['']],
                page4: [['Task 1', 'x'], ['', '']]
            }
        };
        store.set('CASE-2_ranger\u0000bundle', {value: JSON.stringify(bundle), userName: 'ranger', userPin: '1234', updatedAt: now});
        const hist = await call('ranger', '1234', 'GET', '/api/auth/history');
        assert.strictEqual(hist.status, 200);
        const buckets = (hist.body || []).map(r => r.bucket);
        ['bundle', 'all-files', 'user-1967', 'user-Finders3!', 'bundle_ranger', 'all-files_ranger', 'user-1400_ranger']
            .forEach(b => assert.ok(!buckets.includes(b), `${b} is not listed as a case`));
        const case2 = hist.body.find(r => r.bucket === 'CASE-2_ranger');
        assert.ok(case2, 'CASE-2 listed');
        assert.strictEqual(case2.caseNumber, 'CASE-2');
        assert.strictEqual(case2.hasFile, true);
        assert.deepStrictEqual(case2.stats, {regions: 2, segments: 2, personnel: 3, tasks: 1});
        const protectedCase = hist.body.find(r => r.bucket === 'PROTECTED_ranger');
        assert.ok(protectedCase, 'PROTECTED listed');
        assert.strictEqual(protectedCase.hasFile, false, 'a stored "{}" (no pages) is not a readable search file');
    });

    await check('PUT of an internal key never registers a case or writes structured rows', async () => {
        const put = async (path, body) => {
            const resp = await fetch(`${baseUrl}${path}`, {method: 'PUT', headers: headersFor('ranger', '1234'), body: JSON.stringify(body)});
            return resp.status;
        };
        const fileBody = {fileName: 'bundle', pages: {index: {rows: [['R']]}}};
        assert.strictEqual(await put('/api/v1/CASE-2_ranger/all-files', {'CASE-2': {bundle: fileBody}}), 200);
        assert.strictEqual(await put('/api/v1/CASE-2_ranger/user-1234', {deviceId: 'd', lastModified: new Date().toISOString()}), 200);
        assert.strictEqual(await put('/api/v1/bundle/bundle', fileBody), 200);
        await new Promise(r => setTimeout(r, 50));
        const hist = await call('ranger', '1234', 'GET', '/api/auth/history');
        const buckets = (hist.body || []).map(r => r.bucket);
        assert.ok(!buckets.includes('bundle'), 'PUT /bundle/bundle did not register a case called "bundle"');
        assert.strictEqual(structuredRowsFor('ranger', 'bundle'), 0, 'no structured rows under "bundle"');
        assert.strictEqual(structuredRowsFor('ranger', 'all-files'), 0, 'no structured rows under "all-files"');
        assert.strictEqual(structuredRowsFor('ranger', 'user-1234'), 0, 'no structured rows under "user-1234"');
    });

    await check('percent-encoded username round-trips to the decoded bucket + CASE #', async () => {
        // Client sends the bucket as `${caseNumber}_${encodeURIComponent(username)}`.
        // Express URL-decodes :bucket, so the data lives under the decoded bucket.
        seedCase('Team Alpha', '1234', 'CASE-9', 'CASE-9_Team Alpha');
        const res = await call('Team Alpha', '1234', 'DELETE', '/api/v1/CASE-9_Team%20Alpha');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(storeKeysFor('CASE-9_Team Alpha', 'Team Alpha').length, 0, 'decoded bucket store cleared');
        assert.ok(!userBuckets.has('Team Alpha\u0000CASE-9_Team Alpha'), 'decoded bucket history cleared');
        assert.strictEqual(structuredRowsFor('Team Alpha', 'CASE-9'), 0, 'CASE # (not the suffixed bucket) structured rows cleared');
    });

    console.log(`\nAll ${passed} whole-case delete checks passed.`);
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

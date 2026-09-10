// Regression tests: a "New Assignment" notification declined with "Decline for
// now" is remembered in the database (declined_assignment_features), tied to
// the login username and the CASE #, so the same assignment is not announced
// again after a page refresh or on another device.
//
// Drives the real sync-server.js over HTTP against an in-memory MySQL stand-in:
//   - POST /:bucket/declined-assignments writes one row per feature for
//     (username, search_case = CASE #); declining again refreshes, not doubles,
//   - GET reads the rows back for this login and CASE # only,
//   - DELETE /:bucket/declined-assignments/:featureKey (an import) removes one,
//   - the preflight-free request shape (?_method=DELETE, text/plain body,
//     ?_h_x_user_name=...) reaches the same routes,
//   - a missing featureKey / an internal CASE # / bad credentials are refused,
//   - deleting the case removes its declined rows too.
//
// Run with: node test_declined_assignments_db.js

const http = require('http');
const assert = require('assert');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool (installed before sync-server.js loads)
// ---------------------------------------------------------------------------
const dbStore = new Map();   // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const tables = new Map();    // table -> array of row objects
const userBuckets = new Map();
const TEST_USER = {username: 'Team Alpha', pin: '2468', password: 'ignored'};
const OTHER_USER = {username: 'Team Bravo', pin: '1357', password: 'ignored'};

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
        const user = [TEST_USER, OTHER_USER].find(u => u.username === p[0] && (p[1] === u.password || p[2] === u.pin));
        return cb(null, user ? [{...user}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        userBuckets.set(`${p[0]}\u0000${p[1]}`, {lastAccessed: p[2]});
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM user_buckets WHERE username = \? AND bucket = \?$/.test(sql)) {
        userBuckets.delete(`${p[0]}\u0000${p[1]}`);
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = dbStore.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin FROM store WHERE bucket = \? AND userName = \? AND userPin = \? LIMIT 1$/.test(sql)) {
        const hit = [...dbStore.entries()].find(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1] && v.userPin === p[2]);
        return cb(null, hit ? [{userPin: hit[1].userPin}] : []);
    }
    if (/^DELETE FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        for (const [k, v] of [...dbStore.entries()]) {
            if (k.split('\u0000')[0] === p[0] && v.userName === p[1]) dbStore.delete(k);
        }
        return cb(null, {affectedRows: 1});
    }
    if ((m = sql.match(/^DELETE FROM `(\w+)` WHERE username = \? AND search_case = \?$/))) {
        tables.set(m[1], tableRows(m[1]).filter(r => !(r.username === p[0] && r.search_case === p[1])));
        return cb(null, {affectedRows: 1});
    }
    // ---- declined_assignment_features ----
    if (/^REPLACE INTO `declined_assignment_features` \(username, search_case, feature_key, feature_id, feature_name, declined_by, declined_at\) VALUES \(\?, \?, \?, \?, \?, \?, \?\)$/.test(sql)) {
        const rows = tableRows('declined_assignment_features');
        const kept = rows.filter(r => !(r.username === p[0] && r.search_case === p[1] && r.feature_key === p[2]));
        kept.push({username: p[0], search_case: p[1], feature_key: p[2], feature_id: p[3], feature_name: p[4], declined_by: p[5], declined_at: p[6]});
        tables.set('declined_assignment_features', kept);
        return cb(null, {affectedRows: 1});
    }
    if (/^SELECT feature_key, feature_id, feature_name, declined_by, declined_at FROM `declined_assignment_features` WHERE username = \? AND search_case = \? ORDER BY declined_at ASC, feature_key ASC$/.test(sql)) {
        const rows = tableRows('declined_assignment_features')
            .filter(r => r.username === p[0] && r.search_case === p[1])
            .sort((a, b) => String(a.declined_at).localeCompare(String(b.declined_at)) || String(a.feature_key).localeCompare(String(b.feature_key)));
        return cb(null, rows.map(({feature_key, feature_id, feature_name, declined_by, declined_at}) => ({feature_key, feature_id, feature_name, declined_by, declined_at})));
    }
    if (/^DELETE FROM `declined_assignment_features` WHERE username = \? AND search_case = \? AND feature_key = \?$/.test(sql)) {
        tables.set('declined_assignment_features', tableRows('declined_assignment_features').filter(r => !(r.username === p[0] && r.search_case === p[1] && r.feature_key === p[2])));
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

const server = require('./sync-server');
const {app: serverApp, DECLINED_ASSIGNMENTS_TABLE} = server;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const checks = [];
const check = (name, fn) => checks.push({name, fn});

const CASE = 'CASE-77';
const BUCKET = `${CASE}_${TEST_USER.username}`;
const API = `/api/v1/${encodeURIComponent(BUCKET)}/declined-assignments`;
const headersFor = (user) => ({
    'Content-Type': 'application/json',
    'X-User-Name': user.username,
    'X-User-Pin': user.pin,
    'X-User-Password': user.pin
});
let baseUrl = '';
const call = async (method, p, body, headers = headersFor(TEST_USER)) => {
    const resp = await fetch(`${baseUrl}${p}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: resp.status, body: await resp.json().catch(() => ({}))};
};
const rows = (user = TEST_USER, searchCase = CASE) => tableRows(DECLINED_ASSIGNMENTS_TABLE).filter(r => r.username === user.username && r.search_case === searchCase);

check('the table name is exported for the schema and the case delete', () => {
    assert.strictEqual(DECLINED_ASSIGNMENTS_TABLE, 'declined_assignment_features');
});

check('POST stores one row per declined feature under the login and the CASE #', async () => {
    const resp = await call('POST', API, {featureKey: 'id:z1', featureId: 'z1', featureName: 'Zulu', declinedBy: 'Jane'});
    assert.strictEqual(resp.status, 200, JSON.stringify(resp.body));
    assert.strictEqual(resp.body.success, true);
    assert.strictEqual(resp.body.searchCase, CASE, 'the CASE # is the bucket minus the login suffix');
    assert.strictEqual(resp.body.featureKey, 'id:z1');
    assert.ok(resp.body.declinedAt, 'the time of the decline is stamped by the server');

    const stored = rows();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].username, TEST_USER.username);
    assert.strictEqual(stored[0].search_case, CASE);
    assert.strictEqual(stored[0].feature_key, 'id:z1');
    assert.strictEqual(stored[0].feature_id, 'z1');
    assert.strictEqual(stored[0].feature_name, 'Zulu');
    assert.strictEqual(stored[0].declined_by, 'Jane');
    assert.strictEqual(stored[0].declined_at, resp.body.declinedAt);
});

check('body.fileName names the CASE # explicitly (a ".json" suffix is dropped); a shape without an id is keyed by name', async () => {
    const resp = await call('POST', API, {fileName: `${CASE}.json`, featureKey: 'name:mike', featureId: '', featureName: 'Mike', declinedBy: ''});
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.body.searchCase, CASE);
    assert.deepStrictEqual(rows().map(r => r.feature_key).sort(), ['id:z1', 'name:mike']);
    assert.strictEqual(rows().find(r => r.feature_key === 'name:mike').feature_id, null, 'empty optional fields are stored as NULL');
});

check('declining the same feature twice refreshes the row instead of doubling it', async () => {
    const before = rows().find(r => r.feature_key === 'id:z1').declined_at;
    await new Promise(resolve => setTimeout(resolve, 5));
    const resp = await call('POST', API, {featureKey: 'id:z1', featureName: 'Zulu (renamed)'});
    assert.strictEqual(resp.status, 200);
    const stored = rows().filter(r => r.feature_key === 'id:z1');
    assert.strictEqual(stored.length, 1, 'still one row for the feature');
    assert.strictEqual(stored[0].feature_name, 'Zulu (renamed)');
    assert.ok(stored[0].declined_at >= before, 'the stamp is refreshed');
});

check('GET reads the declined features back for this login and CASE # only', async () => {
    // Another login declines something under the same CASE # name.
    const other = await call('POST', `/api/v1/${encodeURIComponent(`${CASE}_${OTHER_USER.username}`)}/declined-assignments`, {featureKey: 'id:q'}, headersFor(OTHER_USER));
    assert.strictEqual(other.status, 200);
    // And this login declines one under another CASE #.
    const otherCase = await call('POST', `/api/v1/${encodeURIComponent(`CASE-78_${TEST_USER.username}`)}/declined-assignments`, {featureKey: 'id:z1'});
    assert.strictEqual(otherCase.status, 200);

    const resp = await call('GET', API);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.body.username, TEST_USER.username);
    assert.strictEqual(resp.body.searchCase, CASE);
    assert.deepStrictEqual(resp.body.declined.map(r => r.feature_key).sort(), ['id:z1', 'name:mike']);
    resp.body.declined.forEach(r => {
        assert.deepStrictEqual(Object.keys(r).sort(), ['declined_at', 'declined_by', 'feature_id', 'feature_key', 'feature_name']);
    });

    // ?case= reads another CASE # of the same login.
    const viaQuery = await call('GET', `${API}?case=CASE-78`);
    assert.strictEqual(viaQuery.body.searchCase, 'CASE-78');
    assert.deepStrictEqual(viaQuery.body.declined.map(r => r.feature_key), ['id:z1']);
});

check('DELETE /:featureKey forgets one decline (the assignment was imported)', async () => {
    const resp = await call('DELETE', `${API}/${encodeURIComponent('id:z1')}`);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.body.featureKey, 'id:z1');
    assert.deepStrictEqual(rows().map(r => r.feature_key), ['name:mike']);
    assert.deepStrictEqual(rows(TEST_USER, 'CASE-78').map(r => r.feature_key), ['id:z1'], 'the same key under another CASE # is untouched');
    assert.deepStrictEqual(rows(OTHER_USER).map(r => r.feature_key), ['id:q'], "the other login's row is untouched");

    // Deleting a key that is not there is not an error.
    const again = await call('DELETE', `${API}/${encodeURIComponent('id:z1')}`);
    assert.strictEqual(again.status, 200);
});

check('the preflight-free request shape (headers in the query, text/plain body, ?_method=DELETE) reaches the same routes', async () => {
    const auth = `_h_x_user_name=${encodeURIComponent(TEST_USER.username)}&_h_x_user_password=${encodeURIComponent(TEST_USER.pin)}`;
    const posted = await fetch(`${baseUrl}${API}?${auth}`, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: JSON.stringify({featureKey: 'id:pf', featureName: 'Preflight-free'})
    });
    assert.strictEqual(posted.status, 200);
    assert.ok(rows().some(r => r.feature_key === 'id:pf'));

    const listed = await fetch(`${baseUrl}${API}?${auth}`);
    assert.strictEqual(listed.status, 200);
    assert.deepStrictEqual((await listed.json()).declined.map(r => r.feature_key).sort(), ['id:pf', 'name:mike']);

    const removed = await fetch(`${baseUrl}${API}/${encodeURIComponent('id:pf')}?_method=DELETE&${auth}`, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'}
    });
    assert.strictEqual(removed.status, 200);
    assert.deepStrictEqual(rows().map(r => r.feature_key), ['name:mike']);
});

check('a missing featureKey, an internal CASE # and bad credentials are refused', async () => {
    const noKey = await call('POST', API, {featureName: 'Nameless'});
    assert.strictEqual(noKey.status, 400);
    const blankKey = await call('POST', API, {featureKey: '   '});
    assert.strictEqual(blankKey.status, 400);

    // "bundle" is the shared store slot, never a CASE #.
    const internal = await call('GET', `/api/v1/bundle/declined-assignments`);
    assert.strictEqual(internal.status, 400);
    const internalPost = await call('POST', `/api/v1/bundle/declined-assignments`, {featureKey: 'id:x'});
    assert.strictEqual(internalPost.status, 400);

    const wrongPin = await call('GET', API, undefined, {...headersFor(TEST_USER), 'X-User-Pin': '0000', 'X-User-Password': '0000'});
    assert.strictEqual(wrongPin.status, 401);
    const noUser = await call('GET', API, undefined, {'Content-Type': 'application/json'});
    assert.strictEqual(noUser.status, 401);

    assert.deepStrictEqual(rows().map(r => r.feature_key), ['name:mike'], 'nothing was written');
});

check('deleting the case removes its declined rows too', async () => {
    await call('POST', API, {featureKey: 'id:z2', featureName: 'Zulu 2'});
    assert.strictEqual(rows().length, 2);

    const resp = await call('DELETE', `/api/v1/${encodeURIComponent(BUCKET)}`);
    assert.strictEqual(resp.status, 200, JSON.stringify(resp.body));
    assert.ok(resp.body.deleted.searchCases.includes(CASE));
    assert.deepStrictEqual(rows(), []);
    assert.deepStrictEqual(rows(TEST_USER, 'CASE-78').map(r => r.feature_key), ['id:z1'], 'another CASE # of the same login keeps its rows');
    assert.deepStrictEqual(rows(OTHER_USER).map(r => r.feature_key), ['id:q'], 'another login keeps its rows');
});

// ---------------------------------------------------------------------------
const httpServer = http.createServer(serverApp);
httpServer.listen(0, '127.0.0.1', async () => {
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(`    ${(err && err.stack || err).toString().split('\n').slice(0, 6).join('\n    ')}`);
        }
    }
    httpServer.close();
    console.log(failed ? `\n${failed} of ${checks.length} checks failed.` : `\nAll ${checks.length} declined-assignment database checks passed.`);
    process.exitCode = failed ? 1 : 0;
});

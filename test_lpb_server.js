// Server half of the Lost Person Behavior feature in sync-server.js.
//
// Covers the distance endpoints (GET/PUT /api/lpb/distances: planner defaults
// + per-login overrides), the lpb_ipp marker table that follows
// bundle.lostPersonBehavior.ipp through row batches, the whole-case delete,
// and the seeding of lpb_default_distances after its CREATE TABLE.
//
// The MySQL pool is replaced with a tiny in-memory stand-in that also records
// every statement, so the test runs without a database and can assert which
// SQL did (and did not) run.
//
// Run with: node test_lpb_server.js

const assert = require('assert');
const http = require('http');

// ---------------------------------------------------------------------------
// In-memory stand-in for the MySQL pool, installed before sync-server.js loads.
// ---------------------------------------------------------------------------
const TEST_USER = {username: 'Team Alpha', pin: '2468', password: 'ignored'};

const store = new Map();               // "bucket\u0000key" -> {value, userName, userPin, updatedAt}
const tables = new Map();              // table -> array of row objects
const log = [];                        // every statement issued: {sql, params}

const tableRows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
};

// mysql2 returns DECIMAL columns as strings; the pre-seeded rows mimic that.
// A planner row exists for one terrain only, so the other three combinations
// have to be filled from the seed placeholders. The pre-seeded override has a
// single bracket set (p50) and the rest NULL.
tables.set('lpb_default_distances', [
    {category: 'Mental Illness', terrain: 'Mtn Temperate', p25: '0.7', p50: '1.4', p75: '2.6', p95: '5.1', updatedAt: 'x'}
]);
tables.set('lpb_user_distances', [
    {username: TEST_USER.username, category: 'Mental Illness', terrain: 'Mtn Temperate', p25: null, p50: '1.2', p75: null, p95: null, updatedAt: 'x'},
    {username: 'Somebody Else', category: 'Mental Illness', terrain: 'Dry', p25: '9.9', p50: null, p75: null, p95: null, updatedAt: 'x'}
]);

const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

const query = (rawSql, params, cb) => {
    const sql = norm(rawSql);
    const p = params || [];
    log.push({sql, params: p.slice()});
    let m;

    // ---- schema (only exercised by the initDatabaseSchema check) ----
    if (/^CREATE TABLE IF NOT EXISTS `lpb_default_distances`/.test(sql)) {
        // Answer asynchronously so the test can see whether the seed INSERTs
        // wait for the CREATE or race it.
        setImmediate(() => cb(null, {affectedRows: 0}));
        return;
    }
    if (/^CREATE TABLE/.test(sql)) {
        return cb(null, {affectedRows: 0});
    }
    if (/^INSERT IGNORE INTO `lpb_default_distances` \(category, terrain, p25, p50, p75, p95, updatedAt\)/.test(sql)) {
        const rows = tableRows('lpb_default_distances');
        if (!rows.some(r => r.category === p[0] && r.terrain === p[1])) {
            rows.push({category: p[0], terrain: p[1], p25: p[2], p50: p[3], p75: p[4], p95: p[5], updatedAt: p[6]});
        }
        return cb(null, {affectedRows: 1});
    }

    // ---- auth / bookkeeping ----
    if (/^SELECT \* FROM users WHERE username = \? AND \(password = \? OR pin = \?\)$/.test(sql)) {
        const ok = p[0] === TEST_USER.username && (p[1] === TEST_USER.password || p[2] === TEST_USER.pin);
        return cb(null, ok ? [{...TEST_USER}] : []);
    }
    if (/^REPLACE INTO user_buckets/.test(sql)) {
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM user_buckets WHERE username = \? AND bucket = \?$/.test(sql)) {
        return cb(null, {affectedRows: 1});
    }

    // ---- store (the JSON search file) ----
    if (/^SELECT value, userPin FROM store WHERE bucket = \? AND `key` = \? AND userName = \?$/.test(sql)) {
        const row = store.get(`${p[0]}\u0000${p[1]}`);
        return cb(null, (row && row.userName === p[2]) ? [{value: row.value, userPin: row.userPin}] : []);
    }
    if (/^SELECT userPin FROM store WHERE bucket = \? AND userName = \? AND userPin = \? LIMIT 1$/.test(sql)) {
        const hit = [...store.entries()].find(([k, v]) => k.split('\u0000')[0] === p[0] && v.userName === p[1] && v.userPin === p[2]);
        return cb(null, hit ? [{userPin: hit[1].userPin}] : []);
    }
    if (/^REPLACE INTO store \(bucket, `key`, value, userName, userPin, updatedAt\)/.test(sql)) {
        store.set(`${p[0]}\u0000${p[1]}`, {value: p[2], userName: p[3], userPin: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM store WHERE bucket = \? AND userName = \?$/.test(sql)) {
        for (const [k, v] of [...store.entries()]) {
            if (k.split('\u0000')[0] === p[0] && v.userName === p[1]) store.delete(k);
        }
        return cb(null, {affectedRows: 1});
    }

    // ---- Lost Person Behavior distance tables ----
    if (/^SELECT category, terrain, p25, p50, p75, p95 FROM `lpb_default_distances`$/.test(sql)) {
        return cb(null, tableRows('lpb_default_distances').map(r => ({...r})));
    }
    if (/^SELECT category, terrain, p25, p50, p75, p95 FROM `lpb_user_distances` WHERE username = \?$/.test(sql)) {
        return cb(null, tableRows('lpb_user_distances').filter(r => r.username === p[0]).map(r => ({...r})));
    }
    if (/^REPLACE INTO `lpb_user_distances` \(username, category, terrain, p25, p50, p75, p95, updatedAt\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?\)$/.test(sql)) {
        const kept = tableRows('lpb_user_distances').filter(r => !(r.username === p[0] && r.category === p[1] && r.terrain === p[2]));
        // Stored the way MySQL hands DECIMAL back: as strings (NULL stays null).
        const dec = (v) => v === null || v === undefined ? null : String(v);
        kept.push({username: p[0], category: p[1], terrain: p[2], p25: dec(p[3]), p50: dec(p[4]), p75: dec(p[5]), p95: dec(p[6]), updatedAt: p[7]});
        tables.set('lpb_user_distances', kept);
        return cb(null, {affectedRows: 1});
    }
    if (/^DELETE FROM `lpb_user_distances` WHERE username = \? AND category = \? AND terrain = \?$/.test(sql)) {
        const rows = tableRows('lpb_user_distances');
        const kept = rows.filter(r => !(r.username === p[0] && r.category === p[1] && r.terrain === p[2]));
        tables.set('lpb_user_distances', kept);
        return cb(null, {affectedRows: rows.length - kept.length});
    }

    // ---- lpb_ipp marker table ----
    if (/^REPLACE INTO `lpb_ipp` \(username, search_case, feature_id, feature_name, latitude, longitude, imported_by, imported_at, updatedAt\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)$/.test(sql)) {
        const kept = tableRows('lpb_ipp').filter(r => !(r.username === p[0] && r.search_case === p[1]));
        kept.push({username: p[0], search_case: p[1], feature_id: p[2], feature_name: p[3], latitude: p[4], longitude: p[5],
            imported_by: p[6], imported_at: p[7], updatedAt: p[8]});
        tables.set('lpb_ipp', kept);
        return cb(null, {affectedRows: 1});
    }

    // ---- generic structured tables (per username + search_case) ----
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
        tableRows(m[1]).push({username: p[0], search_case: p[1], row_index: p[2], label: p[3], data: p[4], updatedAt: p[5]});
        return cb(null, {affectedRows: 1, insertId: 1});
    }
    if ((m = sql.match(/^REPLACE INTO `(\w+)` \(username, search_case, data, updatedAt\)/))) {
        const kept = tableRows(m[1]).filter(r => !(r.username === p[0] && r.search_case === p[1]));
        kept.push({username: p[0], search_case: p[1], data: p[2], updatedAt: p[3]});
        tables.set(m[1], kept);
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
const {app, initDatabaseSchema, LPB_TABLE, LPB_IPP_TABLE, LPB_DEFAULTS_TABLE, LPB_USER_DISTANCES_TABLE} = server;
const {LPB_CATEGORIES, LPB_TERRAINS, LPB_BRACKETS, LPB_SEED_DISTANCES} = require('./map-segment-utils');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const BUCKET = 'CASE-LPB_Team_Alpha';
const FILE_NAME = 'CASE-LPB';
const IPP = {featureId: 'mk1', featureName: 'IPP', lat: 44.95, lng: -93.05, importedAt: '2026-09-09T12:00:00.000Z', importedBy: 'Jer'};

const authHeaders = {
    'Content-Type': 'application/json',
    'X-User-Name': TEST_USER.username,
    'X-User-Pin': TEST_USER.pin
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const storedBundle = () => JSON.parse(store.get(`${BUCKET}\u0000bundle`).value);
const statements = (pattern) => log.filter((entry) => pattern.test(entry.sql));
const ippRows = () => tableRows(LPB_IPP_TABLE).filter(r => r.username === TEST_USER.username && r.search_case === FILE_NAME);
const overridesFor = (body, terrain) => (body.overrides['Mental Illness'] || {})[terrain];

// A search file from before the feature existed: no lostPersonBehavior key.
const seedBundle = () => ({
    fileName: FILE_NAME,
    lastModified: '2026-01-01T00:00:00.000Z',
    theme: 'dark',
    profile: {incidentNumber: 'INC-1'},
    pages: {
        index: {headers: ['Region'], rows: [['North Ridge', '', '']]},
        page2: [['R1', 'Seg A', '', '', '', '', '', '', '', '']]
    }
});

const run = async () => {
    const check = async (name, fn) => {
        await fn();
        passed++;
        console.log(`  ok - ${name}`);
    };

    console.log('Table wiring');

    await check('lost_person_behavior is a single-record structured table', () => {
        assert.strictEqual(LPB_TABLE, 'lost_person_behavior');
        assert.ok(server.SINGLE_TABLES.includes(LPB_TABLE));
        assert.ok(server.STRUCTURED_TABLES.includes(LPB_TABLE));
        assert.strictEqual(LPB_DEFAULTS_TABLE, 'lpb_default_distances');
        assert.strictEqual(LPB_USER_DISTANCES_TABLE, 'lpb_user_distances');
        assert.strictEqual(LPB_IPP_TABLE, 'lpb_ipp');
        assert.strictEqual(typeof server.syncLostPersonIppTable, 'function');
    });

    await check('the default-distance seed rows are written only after their CREATE TABLE completes', async () => {
        log.length = 0;
        initDatabaseSchema();
        const seedInsert = /^INSERT IGNORE INTO `lpb_default_distances`/;
        assert.ok(statements(/^CREATE TABLE IF NOT EXISTS `lpb_default_distances`/).length === 1, 'the table is created');
        assert.ok(statements(/^CREATE TABLE IF NOT EXISTS `lpb_user_distances`/).length === 1);
        assert.ok(statements(/^CREATE TABLE IF NOT EXISTS `lpb_ipp`/).length === 1);
        assert.strictEqual(statements(seedInsert).length, 0, 'no seed INSERT may race the CREATE');
        await tick();
        const inserts = statements(seedInsert);
        assert.strictEqual(inserts.length, LPB_CATEGORIES.length * LPB_TERRAINS.length);
        const combos = inserts.map((entry) => `${entry.params[0]}|${entry.params[1]}`).sort();
        const expected = [];
        LPB_CATEGORIES.forEach((c) => LPB_TERRAINS.forEach((t) => expected.push(`${c.label}|${t}`)));
        assert.deepStrictEqual(combos, expected.sort());
        inserts.forEach((entry) => {
            assert.deepStrictEqual(entry.params.slice(2, 6), [LPB_SEED_DISTANCES.p25, LPB_SEED_DISTANCES.p50, LPB_SEED_DISTANCES.p75, LPB_SEED_DISTANCES.p95]);
        });
        // INSERT IGNORE never replaced the planner's own row.
        const planner = tableRows('lpb_default_distances').find(r => r.terrain === 'Mtn Temperate');
        assert.strictEqual(planner.p25, '0.7');
        // The stand-in now holds a seeded row for the other terrains; drop them
        // again so the endpoint checks below exercise the seed fallback.
        tables.set('lpb_default_distances', tableRows('lpb_default_distances').filter(r => r.terrain === 'Mtn Temperate'));
    });

    console.log('\nGET /api/lpb/distances');

    await check('requires authentication', async () => {
        const resp = await fetch(`${baseUrl}/api/lpb/distances`);
        assert.strictEqual(resp.status, 401);
    });

    await check('merges the planner defaults, the seed fallback and this login\'s overrides', async () => {
        const resp = await call('GET', '/api/lpb/distances');
        assert.strictEqual(resp.status, 200);
        assert.deepStrictEqual(resp.body.categories, LPB_CATEGORIES);
        assert.deepStrictEqual(resp.body.terrains, LPB_TERRAINS);
        assert.deepStrictEqual(resp.body.brackets, LPB_BRACKETS);
        assert.deepStrictEqual(Object.keys(resp.body.defaults), ['Mental Illness']);
        assert.deepStrictEqual(Object.keys(resp.body.defaults['Mental Illness']).sort(), [...LPB_TERRAINS].sort());
        // DECIMAL strings became numbers.
        assert.deepStrictEqual(resp.body.defaults['Mental Illness']['Mtn Temperate'], {p25: 0.7, p50: 1.4, p75: 2.6, p95: 5.1});
        // Combinations the table does not have are filled from the seed.
        assert.deepStrictEqual(resp.body.defaults['Mental Illness']['Dry'], LPB_SEED_DISTANCES);
        assert.deepStrictEqual(resp.body.defaults['Mental Illness']['Urban'], LPB_SEED_DISTANCES);
        // Only the non-null brackets of an override are listed, and only this
        // login's rows count.
        assert.deepStrictEqual(resp.body.overrides, {'Mental Illness': {'Mtn Temperate': {p50: 1.2}}});
    });

    console.log('\nPUT /api/lpb/distances');

    await check('upserts an override (key or label accepted, values kept to a tenth, blanks stay NULL)', async () => {
        log.length = 0;
        const resp = await call('PUT', '/api/lpb/distances', {
            category: 'mentalIllness',
            terrain: 'Flat Temperate',
            values: {p25: '0.44', p50: 1.26, p75: '', p95: null}
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.success, true);
        assert.strictEqual(resp.body.category, 'Mental Illness');
        assert.strictEqual(resp.body.terrain, 'Flat Temperate');
        assert.deepStrictEqual(resp.body.override, {p25: 0.4, p50: 1.3});
        // No planner row for Flat Temperate: the untouched brackets fall back to the seed.
        assert.deepStrictEqual(resp.body.effective, {p25: 0.4, p50: 1.3, p75: LPB_SEED_DISTANCES.p75, p95: LPB_SEED_DISTANCES.p95});
        const writes = statements(/^REPLACE INTO `lpb_user_distances`/);
        assert.strictEqual(writes.length, 1);
        assert.deepStrictEqual(writes[0].params.slice(0, 7), [TEST_USER.username, 'Mental Illness', 'Flat Temperate', 0.4, 1.3, null, null]);
        assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(writes[0].params[7]), 'updatedAt is an ISO stamp');
        const read = await call('GET', '/api/lpb/distances');
        assert.deepStrictEqual(overridesFor(read.body, 'Flat Temperate'), {p25: 0.4, p50: 1.3});
        assert.deepStrictEqual(overridesFor(read.body, 'Mtn Temperate'), {p50: 1.2}, 'other terrains are untouched');
    });

    await check('all-blank values remove the override row and fall back to the planner defaults', async () => {
        log.length = 0;
        const resp = await call('PUT', '/api/lpb/distances', {
            category: 'Mental Illness',
            terrain: 'Mtn Temperate',
            values: {p25: null, p50: ''}
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.override, null);
        assert.deepStrictEqual(resp.body.effective, {p25: 0.7, p50: 1.4, p75: 2.6, p95: 5.1});
        assert.strictEqual(statements(/^REPLACE INTO `lpb_user_distances`/).length, 0);
        const deletes = statements(/^DELETE FROM `lpb_user_distances` WHERE username = \? AND category = \? AND terrain = \?$/);
        assert.strictEqual(deletes.length, 1);
        assert.deepStrictEqual(deletes[0].params, [TEST_USER.username, 'Mental Illness', 'Mtn Temperate']);
        const read = await call('GET', '/api/lpb/distances');
        assert.strictEqual(overridesFor(read.body, 'Mtn Temperate'), undefined);
        assert.deepStrictEqual(overridesFor(read.body, 'Flat Temperate'), {p25: 0.4, p50: 1.3});
    });

    await check('rejects an unknown terrain, an unknown category and a non-positive distance', async () => {
        log.length = 0;
        const terrain = await call('PUT', '/api/lpb/distances', {category: 'mentalIllness', terrain: 'Swamp', values: {p25: 1}});
        assert.strictEqual(terrain.status, 400);
        assert.ok(typeof terrain.body.error === 'string' && terrain.body.error.length);
        const category = await call('PUT', '/api/lpb/distances', {category: 'despondent', terrain: 'Dry', values: {p25: 1}});
        assert.strictEqual(category.status, 400);
        const negative = await call('PUT', '/api/lpb/distances', {category: 'mentalIllness', terrain: 'Dry', values: {p25: 1, p50: -2}});
        assert.strictEqual(negative.status, 400);
        assert.ok(/50%/.test(negative.body.error), 'the error names the offending bracket');
        const garbage = await call('PUT', '/api/lpb/distances', {category: 'mentalIllness', terrain: 'Dry', values: {p95: 'far'}});
        assert.strictEqual(garbage.status, 400);
        assert.strictEqual(statements(/lpb_user_distances/).filter((e) => !/^SELECT/.test(e.sql)).length, 0, 'nothing was written');
    });

    console.log('\nlpb_ipp follows bundle.lostPersonBehavior.ipp');

    await check('seeding a file without a Lost Person Behavior section issues no lpb_ipp SQL', async () => {
        log.length = 0;
        const resp = await call('PUT', `/api/v1/${BUCKET}/bundle?seed=1`, seedBundle());
        assert.strictEqual(resp.status, 200);
        await tick(); // the decompose after a seed is not awaited by the endpoint
        assert.ok(statements(/^REPLACE INTO `profile`/).length === 1, 'the structured mirror was written');
        assert.strictEqual(statements(/lpb_ipp/).length, 0);
        assert.strictEqual(ippRows().length, 0);
    });

    await check('a row batch carrying the IPP mirrors it into lost_person_behavior and lpb_ipp', async () => {
        log.length = 0;
        // The client diff sends one change per key inside the section.
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            batchId: 'batch-ipp-1',
            changes: [{path: ['lostPersonBehavior', 'ipp'], value: IPP}]
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.body.applied, 1);
        assert.deepStrictEqual(storedBundle().lostPersonBehavior.ipp, IPP);
        assert.deepStrictEqual(resp.body.state.lostPersonBehavior.ipp, IPP, 'the touched section is echoed');

        const mirror = statements(/^REPLACE INTO `lost_person_behavior`/);
        assert.strictEqual(mirror.length, 1);
        assert.deepStrictEqual(mirror[0].params.slice(0, 2), [TEST_USER.username, FILE_NAME]);
        assert.deepStrictEqual(JSON.parse(mirror[0].params[2]).ipp, IPP);

        const marker = statements(/^REPLACE INTO `lpb_ipp`/);
        assert.strictEqual(marker.length, 1);
        assert.deepStrictEqual(marker[0].params.slice(0, 8), [TEST_USER.username, FILE_NAME, 'mk1', 'IPP', 44.95, -93.05, 'Jer', IPP.importedAt]);
        assert.strictEqual(statements(/^DELETE FROM `lpb_ipp`/).length, 0);
        assert.strictEqual(ippRows().length, 1);
        assert.strictEqual(ippRows()[0].latitude, 44.95);
        assert.strictEqual(ippRows()[0].longitude, -93.05);
    });

    await check('clearing the IPP removes the lpb_ipp row', async () => {
        log.length = 0;
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            batchId: 'batch-ipp-2',
            changes: [{path: ['lostPersonBehavior', 'ipp'], value: null}]
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(storedBundle().lostPersonBehavior.ipp, null);
        assert.strictEqual(statements(/^REPLACE INTO `lpb_ipp`/).length, 0);
        const deletes = statements(/^DELETE FROM `lpb_ipp` WHERE username = \? AND search_case = \?$/);
        assert.strictEqual(deletes.length, 1);
        assert.deepStrictEqual(deletes[0].params, [TEST_USER.username, FILE_NAME]);
        assert.strictEqual(ippRows().length, 0);
        assert.strictEqual(JSON.parse(tableRows(LPB_TABLE).find(r => r.search_case === FILE_NAME).data).ipp, null);
    });

    await check('a batch that does not touch the section leaves lpb_ipp alone', async () => {
        await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            batchId: 'batch-ipp-3',
            changes: [{path: ['lostPersonBehavior', 'ipp'], value: IPP}]
        });
        assert.strictEqual(ippRows().length, 1);
        log.length = 0;
        const resp = await call('POST', `/api/v1/${BUCKET}/rows`, {
            fileName: FILE_NAME,
            batchId: 'batch-rows-1',
            changes: [{path: ['pages', 'index', 'rows', '0'], value: ['North Ridge', '10', '10']}]
        });
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(statements(/lpb_ipp/).length, 0);
        assert.strictEqual(ippRows().length, 1);
    });

    console.log('\nDELETE /api/v1/:bucket');

    await check('the whole-case delete removes the lpb_ipp row with the rest of the case', async () => {
        log.length = 0;
        const resp = await call('DELETE', `/api/v1/${BUCKET}`);
        assert.strictEqual(resp.status, 200);
        assert.ok(resp.body.deleted.searchCases.includes(FILE_NAME));
        const deletes = statements(/^DELETE FROM `lpb_ipp` WHERE username = \? AND search_case = \?$/);
        assert.ok(deletes.some((e) => e.params[0] === TEST_USER.username && e.params[1] === FILE_NAME));
        assert.strictEqual(ippRows().length, 0);
        assert.strictEqual(tableRows(LPB_TABLE).filter(r => r.search_case === FILE_NAME).length, 0);
        assert.strictEqual(store.has(`${BUCKET}\u0000bundle`), false);
    });

    console.log(`\nAll ${passed} checks passed.`);
    console.log('Lost Person Behavior server: PASS');
};

const httpServer = http.createServer(app);
httpServer.listen(0, '127.0.0.1', async () => {
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    try {
        await run();
        httpServer.close();
    } catch (err) {
        httpServer.close();
        console.error(err);
        process.exitCode = 1;
    }
});

const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const syncDelta = require('./sync-delta');

const createCredentialHelperFallback = () => {
    const serverEnvironmentState = {
        checkedFiles: [],
        loadedFiles: [],
        loadedKeys: new Map(),
        protectedKeys: new Set(Object.keys(process.env))
    };

    const getTrimmedEnvString = (value) => typeof value === 'string' ? value.trim() : '';

    const getUniqueResolvedPaths = (pathsToResolve) => {
        const seen = new Set();
        const resolvedPaths = [];

        (pathsToResolve || []).forEach((candidatePath) => {
            if (!candidatePath || typeof candidatePath !== 'string') {
                return;
            }

            const resolvedPath = path.resolve(candidatePath);
            if (seen.has(resolvedPath)) {
                return;
            }

            seen.add(resolvedPath);
            resolvedPaths.push(resolvedPath);
        });

        return resolvedPaths;
    };

    const parseEnvFile = (content) => {
        const values = {};
        const lines = content.split(/\r?\n/);

        lines.forEach((line) => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) {
                return;
            }

            const separatorIndex = trimmedLine.indexOf('=');
            if (separatorIndex <= 0) {
                return;
            }

            const key = trimmedLine.slice(0, separatorIndex).trim();
            if (!key) {
                return;
            }

            let value = trimmedLine.slice(separatorIndex + 1).trim();
            const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));

            if (isQuoted) {
                value = value.slice(1, -1)
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r');
            } else {
                const inlineCommentIndex = value.indexOf(' #');
                if (inlineCommentIndex >= 0) {
                    value = value.slice(0, inlineCommentIndex).trim();
                }
            }

            values[key] = value;
        });

        return values;
    };

    const loadServerEnvironment = (options = {}) => {
        const searchPaths = getUniqueResolvedPaths(options.searchPaths || [__dirname]);
        const envFileNames = Array.isArray(options.envFileNames) && options.envFileNames.length
            ? options.envFileNames
            : ['.env', '.env.local'];
        const result = {
            checkedFiles: [],
            loadedFiles: [],
            loadedKeys: []
        };

        searchPaths.forEach((searchPath) => {
            envFileNames.forEach((fileName) => {
                const filePath = path.join(searchPath, fileName);
                result.checkedFiles.push(filePath);

                if (!serverEnvironmentState.checkedFiles.includes(filePath)) {
                    serverEnvironmentState.checkedFiles.push(filePath);
                }

                if (!fs.existsSync(filePath)) {
                    return;
                }

                const parsedValues = parseEnvFile(fs.readFileSync(filePath, 'utf8'));

                if (!serverEnvironmentState.loadedFiles.includes(filePath)) {
                    serverEnvironmentState.loadedFiles.push(filePath);
                }
                if (!result.loadedFiles.includes(filePath)) {
                    result.loadedFiles.push(filePath);
                }

                Object.entries(parsedValues).forEach(([key, value]) => {
                    if (serverEnvironmentState.protectedKeys.has(key)) {
                        return;
                    }

                    process.env[key] = value;
                    serverEnvironmentState.loadedKeys.set(key, value);
                    if (!result.loadedKeys.includes(key)) {
                        result.loadedKeys.push(key);
                    }
                });
            });
        });

        return result;
    };

    const getServerEnvironmentInfo = () => ({
        checkedFiles: [...serverEnvironmentState.checkedFiles],
        loadedFiles: [...serverEnvironmentState.loadedFiles],
        loadedKeys: [...serverEnvironmentState.loadedKeys.keys()]
    });

    const resolveCalTopoCredentials = (options = {}) => {
        const env = options.env || process.env;
        const credentialId = getTrimmedEnvString(env.CALTOPO_CREDENTIAL_ID || env.SARTOPO_CREDENTIAL_ID || '');
        const credentialSecret = getTrimmedEnvString(env.CALTOPO_CREDENTIAL_SECRET || env.CALTOPO_SECRET || env.SARTOPO_SECRET || '');
        const credentialKeys = [
            'CALTOPO_CREDENTIAL_ID',
            'SARTOPO_CREDENTIAL_ID',
            'CALTOPO_CREDENTIAL_SECRET',
            'CALTOPO_SECRET',
            'SARTOPO_SECRET'
        ];
        const source = credentialId && credentialSecret
            ? credentialKeys.some((key) => serverEnvironmentState.loadedKeys.has(key))
                ? 'env-file'
                : 'environment'
            : 'missing';

        return {
            credentialId,
            credentialSecret,
            configured: Boolean(credentialId && credentialSecret),
            source
        };
    };

    return {
        getServerEnvironmentInfo,
        loadServerEnvironment,
        resolveCalTopoCredentials
    };
};

const loadCredentialHelpers = () => {
    try {
        return require('./caltopo-credentials');
    } catch (error) {
        if (error && error.code === 'MODULE_NOT_FOUND' && /caltopo-credentials/.test(error.message || '')) {
            console.warn('[CONFIG] Missing optional helper module ./caltopo-credentials; using built-in credential loader fallback.');
            return createCredentialHelperFallback();
        }
        throw error;
    }
};

const {getServerEnvironmentInfo, loadServerEnvironment, resolveCalTopoCredentials} = loadCredentialHelpers();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'db');
const CALTOPO_DEFAULT_DOMAIN = 'caltopo.com';
const CALTOPO_TIMEOUT_MS = 30000;
const CALTOPO_SIGNING_WINDOW_MS = 5 * 60 * 1000;

loadServerEnvironment({
    searchPaths: [__dirname]
});

const getTrimmedString = (value) => typeof value === 'string' ? value.trim() : '';
const getCredentialConfigPaths = () => getServerEnvironmentInfo().checkedFiles.filter((filePath) => /\.env(\.local)?$/i.test(filePath));

const getCredentialConfigurationHelp = () => {
    const configPaths = getCredentialConfigPaths();
    return configPaths.length
        ? `Set CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET in the server environment or in ${configPaths.join(' or ')}.`
        : 'Set CALTOPO_CREDENTIAL_ID and CALTOPO_CREDENTIAL_SECRET in the server environment.';
};

const logCredentialConfigurationStatus = () => {
    const creds = resolveCalTopoCredentials();
    if (creds.configured) {
        console.log(`[CONFIG] CalTopo credentials loaded from ${creds.source}.`);
        return;
    }

    console.warn(`[CONFIG] ${getCredentialConfigurationHelp()}`);
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Initialize Database (MySQL on Railway)
//
// The frontend uses a small sqlite-style callback API (db.run/db.get/db.all).
// To keep every endpoint below unchanged we back that API with a MySQL
// connection pool (mysql2). Connection settings come from the Railway MySQL
// service environment variables (MYSQL_URL / MYSQLHOST / MYSQLUSER / ...).
const buildMysqlPool = () => {
    const commonOptions = {
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        charset: 'utf8mb4'
    };

    // Prefer a full connection URL when Railway provides one. Inside Railway's
    // private network use MYSQL_URL; MYSQL_PUBLIC_URL works from anywhere.
    const connectionUrl = (process.env.MYSQL_URL
        || process.env.MYSQL_PUBLIC_URL
        || process.env.DATABASE_URL
        || '').trim();

    if (/^mysql:\/\//i.test(connectionUrl)) {
        const parsed = new URL(connectionUrl);
        return mysql.createPool({
            host: decodeURIComponent(parsed.hostname),
            port: parsed.port ? Number(parsed.port) : 3306,
            user: decodeURIComponent(parsed.username || 'root'),
            password: decodeURIComponent(parsed.password || ''),
            database: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || 'railway',
            ...commonOptions
        });
    }

    return mysql.createPool({
        host: process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
        port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
        password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
        database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
        ...commonOptions
    });
};

const pool = buildMysqlPool();

// SQLite used "INSERT OR REPLACE"; MySQL's equivalent is "REPLACE".
const translateSql = (sql) => sql.replace(/INSERT\s+OR\s+REPLACE/gi, 'REPLACE');

// Preserve the sqlite error text that register() looks for on duplicate keys.
const normalizeDbError = (err) => {
    if (err && err.code === 'ER_DUP_ENTRY' && !/UNIQUE constraint failed/i.test(err.message || '')) {
        err.message = `UNIQUE constraint failed: ${err.message}`;
    }
    return err;
};

// sqlite3-compatible wrapper so existing endpoint code keeps working unchanged.
const db = {
    run(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(translateSql(sql), params || [], function (err, result) {
            if (err) {
                if (cb) { cb.call({}, normalizeDbError(err)); }
                else { console.error('[DB] run error:', err.message); }
                return;
            }
            if (cb) { cb.call({ lastID: result.insertId, changes: result.affectedRows }, null); }
        });
    },
    get(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(translateSql(sql), params || [], (err, rows) => {
            if (err) { return cb(normalizeDbError(err)); }
            cb(null, rows && rows.length ? rows[0] : undefined);
        });
    },
    all(sql, params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(translateSql(sql), params || [], (err, rows) => {
            if (err) { return cb(normalizeDbError(err)); }
            cb(null, rows || []);
        });
    },
    serialize(fn) { if (typeof fn === 'function') { fn(); } }
};

const initDatabaseSchema = () => {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS store (
            bucket VARCHAR(191) NOT NULL,
            \`key\` VARCHAR(191) NOT NULL,
            value LONGTEXT,
            userName VARCHAR(255),
            userPin VARCHAR(255),
            updatedAt VARCHAR(64),
            PRIMARY KEY (bucket, \`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            username VARCHAR(191) NOT NULL,
            password VARCHAR(255),
            pin VARCHAR(255),
            PRIMARY KEY (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        db.run(`CREATE TABLE IF NOT EXISTS user_buckets (
            username VARCHAR(191) NOT NULL,
            bucket VARCHAR(191) NOT NULL,
            lastAccessed VARCHAR(64),
            PRIMARY KEY (username, bucket)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        db.run(`CREATE TABLE IF NOT EXISTS user_settings (
            username VARCHAR(191) NOT NULL,
            settings LONGTEXT,
            PRIMARY KEY (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // Super-Admin credentials that gate account registration. This table is
        // populated manually by the operator (no UI manages it): insert one row
        // per admin code you want to accept. Registration is allowed only when
        // the password typed in the Super-Admin popup matches admin_password of
        // ANY row here. admin_name is informational bookkeeping only.
        db.run(`CREATE TABLE IF NOT EXISTS admin_credentials (
            admin_name VARCHAR(191) NOT NULL,
            admin_password VARCHAR(255),
            PRIMARY KEY (admin_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // ------------------------------------------------------------------
        // Structured, easily-managed tables. Every save from the website is
        // decomposed into these tables so the Railway database holds one row
        // per item (region, segment, person, ...) instead of a single JSON
        // blob. Each table carries the team `username` and the `search_case`
        // (the CASE # chosen on the home page) so data can be filtered to a
        // single team + case.
        // ------------------------------------------------------------------

        // Login info (team usernames + passwords).
        db.run(`CREATE TABLE IF NOT EXISTS login_info (
            username VARCHAR(191) NOT NULL,
            password VARCHAR(255),
            search_case VARCHAR(191) DEFAULT NULL,
            updatedAt VARCHAR(64),
            PRIMARY KEY (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // Row-collection tables: many rows per (username, search_case).
        COLLECTION_TABLES.forEach((table) => {
            db.run(`CREATE TABLE IF NOT EXISTS \`${table}\` (
                id BIGINT NOT NULL AUTO_INCREMENT,
                username VARCHAR(191) NOT NULL,
                search_case VARCHAR(191) NOT NULL,
                row_index INT DEFAULT 0,
                label VARCHAR(255),
                data LONGTEXT,
                updatedAt VARCHAR(64),
                PRIMARY KEY (id),
                KEY idx_${table}_user_case (username, search_case)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        });

        // Single-record tables: one row per (username, search_case).
        SINGLE_TABLES.forEach((table) => {
            db.run(`CREATE TABLE IF NOT EXISTS \`${table}\` (
                username VARCHAR(191) NOT NULL,
                search_case VARCHAR(191) NOT NULL,
                data LONGTEXT,
                updatedAt VARCHAR(64),
                PRIMARY KEY (username, search_case)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        });
    });
};

// Tables that hold one row per item in a page/list.
const COLLECTION_TABLES = [
    'regions',        // Regions page rows
    'segments',       // Segments page rows
    'personnel',      // Personnel page rows
    'search_log',     // Search Log page rows
    'uploaded_files', // Uploads page items
    'maps_settings',  // Maps page settings/entries
    'forms',          // Forms page entries
    'activity_log'    // Activity log entries
];

// Tables that hold a single record per (username, search_case).
const SINGLE_TABLES = [
    'profile',        // Incident / profile page
    'settings_page'   // Settings page values
];

// Every structured table that can be read back by the website.
const STRUCTURED_TABLES = [...COLLECTION_TABLES, ...SINGLE_TABLES];

// Promise wrapper around the sqlite-compatible db.run helper.
const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) { reject(err); } else { resolve(this); }
    });
});

const safeJsonParse = (value) => {
    if (value == null) { return null; }
    try { return JSON.parse(value); } catch (e) { return value; }
};

const toLabel = (value) => value == null ? null : String(value).slice(0, 255);

// Pure transform: turn a saved bundle into the structured rows that belong in
// each table. Returns null for payloads that are not real save bundles (file
// lists, presence pings, ...). Kept side-effect free so it can be unit tested
// without a database connection.
const buildStructuredPlan = (bundle, fallbackCase) => {
    if (!bundle || typeof bundle !== 'object') { return null; }
    if (!bundle.pages || typeof bundle.pages !== 'object') { return null; }

    // The CASE # is the bundle's own file/case name. Some pushes use a fixed
    // store key ("bundle"), so prefer the name inside the payload and only fall
    // back to the store key when the bundle does not carry one.
    const searchCase = (typeof bundle.fileName === 'string' && bundle.fileName.trim())
        ? bundle.fileName.trim()
        : (fallbackCase || '');
    if (!searchCase) { return null; }

    const collection = (items, mapFn) => {
        const list = Array.isArray(items) ? items : [];
        return list.map((item, i) => {
            const mapped = mapFn(item, i) || {};
            const data = mapped.data === undefined ? item : mapped.data;
            return { row_index: i, label: toLabel(mapped.label), data: data ?? null };
        });
    };

    const pages = bundle.pages;
    const regionRows = pages.index && Array.isArray(pages.index.rows) ? pages.index.rows : [];
    const formsObj = bundle.forms && typeof bundle.forms === 'object' ? bundle.forms : {};
    const formsArr = Object.keys(formsObj).map((key) => ({ key, value: formsObj[key] }));

    return {
        searchCase,
        collections: {
            regions: collection(regionRows, (row) => ({ label: Array.isArray(row) ? row[0] : '', data: row })),
            segments: collection(pages.page2, (row) => ({ label: Array.isArray(row) ? row[0] : '', data: row })),
            personnel: collection(pages.page3, (row) => ({ label: Array.isArray(row) ? row[0] : '', data: row })),
            search_log: collection(pages.page4, (row) => ({ label: Array.isArray(row) ? row[0] : '', data: row })),
            forms: collection(formsArr, (item) => ({ label: item.key, data: item.value })),
            uploaded_files: collection(bundle.uploads, (u) => ({ label: u && (u.name || u.fileName || u.title) || '', data: u })),
            maps_settings: collection(bundle.maps, (m) => ({ label: m && (m.name || m.id || m.title) || '', data: m })),
            activity_log: collection(bundle.activityLog, (e) => ({ label: e && (e.type || e.action || e.event || e.message) || '', data: e }))
        },
        singles: {
            profile: bundle.profile || {},
            settings_page: {
                theme: bundle.theme,
                showTips: bundle.showTips,
                background: bundle.background,
                deleteMode: bundle.deleteMode,
                segmentColorScaleUsePsriMax: bundle.segmentColorScaleUsePsriMax,
                segmentColorScaleLowColor: bundle.segmentColorScaleLowColor,
                segmentColorScaleMidColor: bundle.segmentColorScaleMidColor,
                segmentColorScaleHighColor: bundle.segmentColorScaleHighColor,
                segmentActiveSearchOpacityPercent: bundle.segmentActiveSearchOpacityPercent,
                parCheckFrequency: bundle.parCheckFrequency
            }
        }
    };
};

// Break a saved bundle into the structured tables above, tagged with the
// team username and the CASE #. The current rows for (username, search_case)
// are replaced so each table always mirrors the latest save.
const decomposeBundleToTables = async (username, fallbackCase, bundle) => {
    if (!username) { return; }
    const plan = buildStructuredPlan(bundle, fallbackCase);
    if (!plan) { return; }

    const {searchCase, collections, singles} = plan;
    const nowIso = new Date().toISOString();

    for (const table of Object.keys(collections)) {
        await runAsync(`DELETE FROM \`${table}\` WHERE username = ? AND search_case = ?`, [username, searchCase]);
        for (const row of collections[table]) {
            await runAsync(
                `INSERT INTO \`${table}\` (username, search_case, row_index, label, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
                [username, searchCase, row.row_index, row.label, JSON.stringify(row.data ?? null), nowIso]
            );
        }
    }

    for (const table of Object.keys(singles)) {
        await runAsync(
            `REPLACE INTO \`${table}\` (username, search_case, data, updatedAt) VALUES (?, ?, ?, ?)`,
            [username, searchCase, JSON.stringify(singles[table] ?? {}), nowIso]
        );
    }
};

// Write ONE row of a row-collection table. The collection tables key on an
// auto-increment id, so a targeted delete + insert is the single-row upsert.
const upsertCollectionRow = async (username, searchCase, table, row, nowIso) => {
    await runAsync(
        `DELETE FROM \`${table}\` WHERE username = ? AND search_case = ? AND row_index = ?`,
        [username, searchCase, row.row_index]
    );
    await runAsync(
        `INSERT INTO \`${table}\` (username, search_case, row_index, label, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [username, searchCase, row.row_index, row.label, JSON.stringify(row.data ?? null), nowIso]
    );
};

const replaceCollectionTable = async (username, searchCase, table, rows, nowIso) => {
    await runAsync(`DELETE FROM \`${table}\` WHERE username = ? AND search_case = ?`, [username, searchCase]);
    for (const row of rows) {
        await runAsync(
            `INSERT INTO \`${table}\` (username, search_case, row_index, label, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [username, searchCase, row.row_index, row.label, JSON.stringify(row.data ?? null), nowIso]
        );
    }
};

// Mirror only the rows a device actually changed into the structured tables.
// Rebuilding a whole table (or every table) is the fallback for changes that
// shift row indexes, such as inserting or deleting a row.
const applyChangesToTables = async (username, fallbackCase, bundle, changes) => {
    if (!username || !Array.isArray(changes) || !changes.length) { return; }
    const plan = buildStructuredPlan(bundle, fallbackCase);
    if (!plan) { return; }

    const {searchCase, collections, singles} = plan;
    const nowIso = new Date().toISOString();

    const tablesToRebuild = new Set();
    const rowsToWrite = new Map();
    const singlesToWrite = new Set();
    let rebuildEverything = false;

    changes.forEach((change) => {
        const target = syncDelta.describeChangeTarget(change);
        if (!target || target.kind === 'rebuild') { rebuildEverything = true; return; }
        if (target.kind === 'none') { return; }
        if (target.kind === 'single') { singlesToWrite.add(target.table); return; }
        if (target.kind === 'collectionRebuild') { tablesToRebuild.add(target.table); return; }
        if (target.kind === 'collectionRow') {
            if (!rowsToWrite.has(target.table)) { rowsToWrite.set(target.table, new Set()); }
            rowsToWrite.get(target.table).add(target.rowIndex);
        }
    });

    if (rebuildEverything) {
        await decomposeBundleToTables(username, fallbackCase, bundle);
        return;
    }

    for (const table of tablesToRebuild) {
        await replaceCollectionTable(username, searchCase, table, collections[table] || [], nowIso);
        rowsToWrite.delete(table);
    }

    for (const [table, indexes] of rowsToWrite) {
        for (const rowIndex of indexes) {
            const row = (collections[table] || []).find((candidate) => candidate.row_index === rowIndex);
            if (!row) {
                await runAsync(
                    `DELETE FROM \`${table}\` WHERE username = ? AND search_case = ? AND row_index = ?`,
                    [username, searchCase, rowIndex]
                );
                continue;
            }
            await upsertCollectionRow(username, searchCase, table, row, nowIso);
        }
    }

    for (const table of singlesToWrite) {
        await runAsync(
            `REPLACE INTO \`${table}\` (username, search_case, data, updatedAt) VALUES (?, ?, ?, ?)`,
            [username, searchCase, JSON.stringify(singles[table] ?? {}), nowIso]
        );
    }
};

// Expose the pure transform for unit testing without starting the server.
if (typeof module !== 'undefined' && module.exports) {
    module.exports.buildStructuredPlan = buildStructuredPlan;
    module.exports.COLLECTION_TABLES = COLLECTION_TABLES;
    module.exports.SINGLE_TABLES = SINGLE_TABLES;
    module.exports.STRUCTURED_TABLES = STRUCTURED_TABLES;
    // Exposed so an integration test can drive the endpoints over HTTP without
    // the server having to bind a fixed port on its own.
    module.exports.app = app;
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Name', 'X-User-Pin', 'X-User-Password', 'X-Last-Modified']
}));
app.use(express.json({limit: '50mb'}));

// Auth Endpoints
app.post('/api/auth/register', (req, res) => {
    const {username, pin, adminPassword} = req.body;
    if (!username || !pin) {
        return res.status(400).json({error: 'Username and PIN are required'});
    }

    // Registration is gated behind a Super-Admin password. The gate lives here,
    // server-side, so it cannot be bypassed by editing the client. Reject the
    // request when no admin password was supplied.
    if (!adminPassword) {
        return res.status(403).json({error: 'Super-Admin password is required.'});
    }

    // The admin password must match admin_password of ANY row in
    // admin_credentials (compared as plaintext, per the operator's request).
    // An empty table therefore blocks all registration by design.
    db.get("SELECT admin_name FROM admin_credentials WHERE admin_password = ?", [adminPassword], (adminErr, adminRow) => {
        if (adminErr) {
            return res.status(500).json({error: adminErr.message});
        }
        if (!adminRow) {
            return res.status(403).json({error: 'Invalid Super-Admin password.'});
        }

        const hashedPassword = crypto.createHash('sha256').update(pin).digest('hex');

        db.run("INSERT INTO users (username, password, pin) VALUES (?, ?, ?)",
            [username, hashedPassword, pin], (err) => {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({error: 'User already exists'});
                }
                return res.status(500).json({error: err.message});
            }
            // Mirror the credentials into the structured login_info table.
            db.run("INSERT OR REPLACE INTO login_info (username, password, updatedAt) VALUES (?, ?, ?)",
                [username, hashedPassword, new Date().toISOString()]);
            res.json({success: true, user: {username, pin}});
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const {username, pin} = req.body;
    if (!username || !pin) {
        return res.status(400).json({error: 'Username and PIN are required'});
    }

    db.get("SELECT * FROM users WHERE username = ? AND pin = ?", [username, pin], (err, row) => {
        if (err) {
            return res.status(500).json({error: err.message});
        }
        if (!row) {
            return res.status(401).json({error: 'no matching login found'});
        }
        res.json({success: true, user: {username: row.username, pin: row.pin}});
    });
});

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const username = req.headers['x-user-name'];
    const password = req.headers['x-user-password'] || req.headers['x-user-pin'];

    if (!username || !password) {
        return res.status(401).json({error: 'Not authenticated'});
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    // Accept EITHER the hashed password (accounts created through the app store
    // password = sha256(pin)) OR the plaintext pin (accounts inserted directly
    // into the DB by an operator with only username + pin). /api/auth/login only
    // checks the plaintext pin, so without this an admin-inserted account could
    // log in but every authenticated read/write would return 401 and silently
    // fail to persist (the reported "Case # never saves / DB stays empty" bug).
    db.get("SELECT * FROM users WHERE username = ? AND (password = ? OR pin = ?)", [username, hashedPassword, password], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        if (!row) return res.status(401).json({error: 'Invalid credentials'});
        req.user = row;
        next();
    });
};

app.get('/api/auth/history', authMiddleware, (req, res) => {
    db.all("SELECT bucket, lastAccessed FROM user_buckets WHERE username = ? ORDER BY lastAccessed DESC", [req.user.username], (err, rows) => {
        if (err) {
            return res.status(500).json({error: err.message});
        }
        res.json(rows);
    });
});

// User Settings Endpoints
app.get('/api/auth/settings', authMiddleware, (req, res) => {
    db.get("SELECT settings FROM user_settings WHERE username = ?", [req.user.username], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        try {
            res.json(row ? JSON.parse(row.settings) : {});
        } catch (e) {
            res.json({});
        }
    });
});

app.put('/api/auth/settings', authMiddleware, (req, res) => {
    const settings = JSON.stringify(req.body || {});
    db.run("INSERT OR REPLACE INTO user_settings (username, settings) VALUES (?, ?)", [req.user.username, settings], (err) => {
        if (err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// Helper to track bucket access
const trackBucketAccess = (username, bucket) => {
    if (!username || !bucket) return;
    const now = new Date().toISOString();
    db.run("INSERT OR REPLACE INTO user_buckets (username, bucket, lastAccessed) VALUES (?, ?, ?)", [username, bucket, now]);
};

const ensureHttpsDomain = (domain) => {
    const normalized = (domain || CALTOPO_DEFAULT_DOMAIN).trim().toLowerCase();
    if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('?')) {
        return CALTOPO_DEFAULT_DOMAIN;
    }
    return normalized;
};

const signCalTopoRequest = (method, endpoint, payloadString, credentialSecret) => {
    const expires = Date.now() + CALTOPO_SIGNING_WINDOW_MS;
    const message = `${method.toUpperCase()} ${endpoint}\n${expires}\n${payloadString || ''}`;
    const secret = Buffer.from(credentialSecret, 'base64');
    const signature = crypto.createHmac('sha256', secret).update(message).digest('base64');

    return {expires, signature};
};

const unwrapCalTopoPayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    if (payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)) {
        const result = payload.result;

        if (result.type === 'FeatureCollection' && Array.isArray(result.features)) {
            return {
                ...result,
                timestamp: result.timestamp || payload.timestamp || null
            };
        }

        if (result.state && result.state.type === 'FeatureCollection' && Array.isArray(result.state.features)) {
            return {
                ...result,
                state: {
                    ...result.state,
                    ids: result.state.ids || result.ids || null,
                    timestamp: result.state.timestamp || result.timestamp || payload.timestamp || null
                },
                ids: result.ids || null,
                timestamp: result.timestamp || payload.timestamp || null
            };
        }

        if (Array.isArray(result.features)) {
            return {
                type: 'FeatureCollection',
                features: result.features,
                ids: result.ids || null,
                timestamp: result.timestamp || payload.timestamp || null
            };
        }
    }

    return payload;
};

const normalizeCalTopoState = (payload) => {
    const normalizedPayload = unwrapCalTopoPayload(payload);

    if (!normalizedPayload || typeof normalizedPayload !== 'object') {
        return {
            type: 'FeatureCollection',
            features: []
        };
    }

    // 1. Direct FeatureCollection (standard GeoJSON)
    if (normalizedPayload.type === 'FeatureCollection' && Array.isArray(normalizedPayload.features)) {
        return normalizedPayload;
    }

    // 2. Nested FeatureCollection in 'state' (common Team API response)
    if (normalizedPayload.state && normalizedPayload.state.type === 'FeatureCollection' && Array.isArray(normalizedPayload.state.features)) {
        const fc = normalizedPayload.state;
        if (!fc.ids && normalizedPayload.ids) fc.ids = normalizedPayload.ids;
        if (!fc.timestamp && normalizedPayload.timestamp) fc.timestamp = normalizedPayload.timestamp;
        return fc;
    }

    // 3. Fallback: Aggregate features from typed arrays or 'state' object
    // CalTopo/SARTopo internal state often uses separate arrays for Marker, Shape, Assignment, etc.
    const state = normalizedPayload.state || normalizedPayload;
    const collectedFeatures = [];

    if (Array.isArray(state)) {
        // Direct array of features
        collectedFeatures.push(...state);
    } else if (state && typeof state === 'object') {
        if (Array.isArray(state.features)) {
            collectedFeatures.push(...state.features);
        } else {
            // Look for common typed arrays OR any array that might contain features
            // CalTopo standard types:
            const knownTypes = ['Marker', 'Shape', 'Assignment', 'Track', 'Route', 'Clue', 'Area', 'Line', 'Folder', 'Sector', 'Buffer'];
            
            // First check known types
            knownTypes.forEach(t => {
                if (Array.isArray(state[t])) {
                    state[t].forEach(item => {
                        if (item && typeof item === 'object') {
                            if (!item.type && !item.geometry && !item.class) item.class = t;
                            collectedFeatures.push(item);
                        }
                    });
                }
            });

            // Then check any other arrays (case-insensitive) just in case
            Object.keys(state).forEach(key => {
                if (Array.isArray(state[key]) && !knownTypes.includes(key) && key !== 'features' && key !== 'ids') {
                    state[key].forEach(item => {
                        if (item && typeof item === 'object') {
                            if (!item.type && !item.geometry && !item.class) item.class = key;
                            collectedFeatures.push(item);
                        }
                    });
                }
            });
        }
    }

    return {
        type: 'FeatureCollection',
        features: collectedFeatures,
        ids: normalizedPayload.ids || (state && typeof state === 'object' ? state.ids : null),
        timestamp: normalizedPayload.timestamp || (state && typeof state === 'object' ? state.timestamp : null)
    };
};

const fetchPublicCalTopoState = async (targetUrl) => {
    const response = await axios.get(targetUrl, {
        timeout: CALTOPO_TIMEOUT_MS,
        params: {
            _: Date.now()
        }
    });

    return normalizeCalTopoState(response.data);
};

// Helper to get file path
const getFilePath = (bucket, key) => {
    const bucketDir = path.join(DATA_DIR, bucket);
    if (!fs.existsSync(bucketDir)) {
        fs.mkdirSync(bucketDir);
    }
    // Sanitize key to prevent directory traversal
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(bucketDir, `${safeKey}.json`);
};

// ----------------------------------------------------------------------------
// Row-level sync
//
// A device never uploads a whole page any more. When a cell loses focus (or a
// button is pressed) it posts ONLY the rows it changed to /rows, and it reads
// back a single page from /page/:page. Because the merge happens here, two
// devices editing two different rows of the same table no longer overwrite each
// other. These routes are declared before the generic /:bucket/:key routes so
// they are not swallowed by them.
// ----------------------------------------------------------------------------
const STORE_BUNDLE_KEY = 'bundle';
const MAX_ROW_CHANGES = 2000;

const storeFileKey = (fileName) => String(fileName || '').replace(/[^a-zA-Z0-9.\-_]/g, '_');

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

// Serialize every write for one bucket so a read-modify-write of the stored
// bundle can never lose a concurrent device's row.
const bucketWriteQueues = new Map();

const withBucketLock = (bucket, task) => {
    const previous = bucketWriteQueues.get(bucket) || Promise.resolve();
    const current = previous.then(() => task(), () => task());
    bucketWriteQueues.set(bucket, current.then(() => {}, () => {}));
    return current;
};

const readStoredBundle = async (bucket) => {
    const row = await getAsync(
        "SELECT value, userPin FROM store WHERE bucket = ? AND `key` = ?",
        [bucket, STORE_BUNDLE_KEY]
    );
    if (!row) { return null; }
    const parsed = safeJsonParse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    return {bundle: parsed, userPin: row.userPin};
};

// Apply a device's changed rows onto the stored search file.
app.post('/api/v1/:bucket/rows', authMiddleware, async (req, res) => {
    const {bucket} = req.params;
    const userName = req.user.username || 'Unknown';
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';
    const changes = req.body && Array.isArray(req.body.changes) ? req.body.changes : null;

    if (!changes) {
        return res.status(400).json({error: 'A changes array is required'});
    }
    if (!changes.length) {
        return res.json({success: true, applied: 0});
    }
    if (changes.length > MAX_ROW_CHANGES) {
        return res.status(413).json({error: `At most ${MAX_ROW_CHANGES} row changes may be sent at once`});
    }

    trackBucketAccess(userName, bucket);

    try {
        const result = await withBucketLock(bucket, async () => {
            const stored = await readStoredBundle(bucket);
            // Nothing to merge into yet: ask the device to seed the search file
            // once with a full upload, after which it sends rows only.
            if (!stored) {
                return {status: 409, body: {error: 'No stored search file for this CASE #', needsFullSync: true}};
            }
            if (stored.userPin === '1976' && !isSuperAdmin) {
                return {
                    status: 403,
                    body: {
                        error: 'Conflict',
                        message: 'Changes by Super-Admin cannot be overwritten by a regular user.'
                    }
                };
            }

            const {bundle, applied} = syncDelta.applyBundleChanges(stored.bundle, changes);
            const nowIso = new Date().toISOString();
            bundle.lastModified = nowIso;

            const value = JSON.stringify(bundle);
            await runAsync(
                "INSERT OR REPLACE INTO store (bucket, `key`, value, userName, userPin, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                [bucket, STORE_BUNDLE_KEY, value, userName, userPin, nowIso]
            );

            const fileKey = storeFileKey(bundle.fileName);
            if (fileKey && fileKey !== STORE_BUNDLE_KEY) {
                await runAsync(
                    "INSERT OR REPLACE INTO store (bucket, `key`, value, userName, userPin, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
                    [bucket, fileKey, value, userName, userPin, nowIso]
                );
            }

            await applyChangesToTables(userName, bucket, bundle, applied);

            return {status: 200, body: {success: true, applied: applied.length, lastModified: nowIso}};
        });

        res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[SYNC] row change failed:', err.message);
        res.status(500).json({error: 'Failed to apply row changes'});
    }
});

// Read back a single page of the stored search file.
app.get('/api/v1/:bucket/page/:page', authMiddleware, async (req, res) => {
    const {bucket, page} = req.params;
    try {
        const stored = await readStoredBundle(bucket);
        if (!stored) {
            return res.json({page, found: false, data: null, lastModified: null});
        }
        const data = syncDelta.getPageData(stored.bundle, page);
        res.json({
            page,
            found: data !== undefined,
            data: data === undefined ? null : data,
            lastModified: stored.bundle.lastModified || null
        });
    } catch (err) {
        res.status(500).json({error: 'Failed to read page data'});
    }
});

// Get all files for a bucket
app.get('/api/v1/:bucket/all-files', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    trackBucketAccess(req.user.username, bucket);
    db.all("SELECT `key`, updatedAt FROM store WHERE bucket = ?", [bucket], (err, rows) => {
        if (err) return res.status(500).json({error: 'Failed to query database'});
        const files = {};
        rows.forEach(row => {
            files[row.key] = { lastModified: row.updatedAt };
        });
        res.json(files);
    });
});

// Get latest bundle for a bucket
app.get('/api/v1/:bucket/latest', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    db.get("SELECT value FROM store WHERE bucket = ? ORDER BY updatedAt DESC LIMIT 1", [bucket], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query database'});
        if (!row) return res.status(404).json({error: 'No data found'});
        try {
            res.json(JSON.parse(row.value));
        } catch (e) {
            res.status(500).json({error: 'Failed to parse stored data'});
        }
    });
});

// Get a specific key
app.get('/api/v1/:bucket/:key', authMiddleware, (req, res) => {
    const {bucket, key} = req.params;
    db.get("SELECT value FROM store WHERE bucket = ? AND `key` = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query database'});
        if (!row) return res.status(404).json({error: 'Not found'});
        try {
            res.json(JSON.parse(row.value));
        } catch (e) {
            res.status(500).json({error: 'Failed to parse stored data'});
        }
    });
});

// Set a value
// Delete a value
app.delete('/api/v1/:bucket/:key', authMiddleware, (req, res) => {
    const {bucket, key} = req.params;
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';

    db.get("SELECT userPin FROM store WHERE bucket = ? AND `key` = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query db'});
        if (!row) return res.json({success: true}); // already gone
        
        if (row.userPin === '1976' && !isSuperAdmin) {
            return res.status(403).json({
                error: 'Conflict',
                message: 'Cannot delete Super-Admin created files.'
            });
        }
        
        db.run("DELETE FROM store WHERE bucket = ? AND `key` = ?", [bucket, key], (err) => {
            if (err) return res.status(500).json({error: 'Failed to delete data'});
            res.json({success: true});
        });
    });
});

app.put('/api/v1/:bucket/:key', authMiddleware, (req, res) => {
    const {bucket, key} = req.params;
    const userName = req.user.username || 'Unknown';
    trackBucketAccess(req.user.username, bucket);
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';

    let incomingLastModified = Date.now();
    if (req.headers['x-last-modified']) {
        incomingLastModified = new Date(req.headers['x-last-modified']).getTime();
    } else if (req.body) {
        if (req.body.lastModified) {
            incomingLastModified = new Date(req.body.lastModified).getTime();
        } else if (typeof req.body === 'object' && req.body !== null) {
            let found = false;
            let maxM = 0;
            for (const k in req.body) {
                if (req.body[k] && req.body[k].lastModified) {
                    const m = new Date(req.body[k].lastModified).getTime();
                    if (m > maxM) maxM = m;
                    found = true;
                }
            }
            if (found) incomingLastModified = maxM;
        }
    }

    db.get("SELECT userPin, updatedAt FROM store WHERE bucket = ? AND `key` = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query database'});

        if (row) {
            const currentIsSuperAdmin = row.userPin === '1976';
            const existingLastModified = new Date(row.updatedAt).getTime();

            // Super-Admin priority
            if (currentIsSuperAdmin && !isSuperAdmin) {
                return res.status(403).json({
                    error: 'Conflict',
                    message: 'Changes by Super-Admin cannot be overwritten by a regular user.'
                });
            }

            // Conflict resolution
            if (isSuperAdmin === currentIsSuperAdmin) {
                if (incomingLastModified < existingLastModified) {
                    return res.status(403).json({
                        error: 'Conflict',
                        message: 'Incoming data is older than server data.'
                    });
                }
            }
        }

        const saveTime = (incomingLastModified && incomingLastModified > 0) 
            ? new Date(incomingLastModified).toISOString() 
            : new Date().toISOString();

        db.run(`INSERT OR REPLACE INTO store (bucket, \`key\`, value, userName, userPin, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [bucket, key, JSON.stringify(req.body), userName, userPin, saveTime],
                (err) => {
                    if (err) return res.status(500).json({error: 'Failed to save data'});
                    // Also split the saved bundle into the structured tables,
                    // tagged with the team username and CASE # (the store key).
                    decomposeBundleToTables(userName, key, req.body)
                        .catch((decomposeErr) => console.error('[DB] decompose error:', decomposeErr.message));
                    res.json({success: true});
                });
    });
});

// Structured table read endpoints.
//
// These return rows from the normalized tables filtered to the authenticated
// team username, and (when provided) to a single CASE # via ?case=...  so a
// team only ever sees its own data for the chosen case.
const mapStructuredRow = (row) => ({
    ...row,
    data: safeJsonParse(row.data)
});

// Read every structured table at once for a given CASE #.
app.get('/api/v1/tables', authMiddleware, async (req, res) => {
    const username = req.user.username;
    const searchCase = req.query.case || req.query.searchCase || '';
    try {
        const result = {};
        for (const table of STRUCTURED_TABLES) {
            const params = [username];
            let sql = `SELECT * FROM \`${table}\` WHERE username = ?`;
            if (searchCase) { sql += ' AND search_case = ?'; params.push(searchCase); }
            const rows = await new Promise((resolve, reject) => {
                db.all(sql, params, (err, r) => err ? reject(err) : resolve(r || []));
            });
            result[table] = rows.map(mapStructuredRow);
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

// Read a single structured table for a given CASE #.
app.get('/api/v1/tables/:table', authMiddleware, (req, res) => {
    const {table} = req.params;
    if (!STRUCTURED_TABLES.includes(table)) {
        return res.status(404).json({error: 'Unknown table'});
    }
    const username = req.user.username;
    const searchCase = req.query.case || req.query.searchCase || '';
    const params = [username];
    let sql = `SELECT * FROM \`${table}\` WHERE username = ?`;
    if (searchCase) { sql += ' AND search_case = ?'; params.push(searchCase); }
    if (SINGLE_TABLES.includes(table)) {
        // ordering not meaningful for single-record tables
    } else {
        sql += ' ORDER BY row_index ASC';
    }
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json((rows || []).map(mapStructuredRow));
    });
});

// Root endpoint for health check
app.get('/', (req, res) => {
    res.send('SAR Sync + Proxy Server is running');
});

// Health check endpoint for the proxy
app.get('/api/health', (req, res) => {
    const creds = resolveCalTopoCredentials();
    const envInfo = getServerEnvironmentInfo();
    res.json({
        status: 'ok',
        version: '1.3.0',
        service: 'SAR Proxy + Sync',
        message: creds.configured
            ? 'Unified server is live and ready to sign CalTopo Team API requests using backend credentials.'
            : getCredentialConfigurationHelp(),
        caltopoSigningConfigured: creds.configured,
        caltopoCredentialSource: creds.source,
        credentialConfigPaths: getCredentialConfigPaths(),
        credentialEnvFilesLoaded: envInfo.loadedFiles,
        supportsClientSuppliedCredentials: false,
        timestamp: new Date().toISOString()
    });
});

// CalTopo Proxy endpoint
const fetchMapHandler = async (req, res, overrideRequestData = null) => {
    const requestData = overrideRequestData && typeof overrideRequestData === 'object'
        ? overrideRequestData
        : req.method === 'POST' && req.body && typeof req.body === 'object'
            ? req.body
            : req.query;
    const mapId = getTrimmedString(requestData.mapId);
    const domain = getTrimmedString(requestData.domain);
    const usePostToCalTopo = requestData.usePost || false;

    if (!mapId) {
        return res.status(400).json({
            error: "Missing mapId parameter",
            message: "Please ensure your Map ID is correctly entered in the Maps page."
        });
    }

    const trimmedMapId = String(mapId).trim();
    const targetDomain = ensureHttpsDomain(domain);
    const endpoint = `/api/v1/map/${trimmedMapId}/since/0`;
    const targetUrl = `https://${targetDomain}${endpoint}`;
    const creds = resolveCalTopoCredentials();

    if (!creds.configured) {
        return res.status(500).json({
            error: 'Proxy Not Configured',
            message: getCredentialConfigurationHelp(),
            targetUrl,
            mapId: trimmedMapId,
            signingRequired: true,
            credentialConfigPaths: getCredentialConfigPaths(),
            supportsClientSuppliedCredentials: false
        });
    }

    const method = usePostToCalTopo ? 'POST' : 'GET';
    const payloadString = ''; // Empty for since endpoint
    
    const {expires, signature} = signCalTopoRequest(method, endpoint, payloadString, creds.credentialSecret);

    try {
        console.log(`[PROXY] Fetching shapes from ${targetUrl} (Method: ${method})`);
        
        const axiosConfig = {
            timeout: CALTOPO_TIMEOUT_MS,
            params: {
                id: creds.credentialId,
                expires,
                signature,
                _: Date.now()
            }
        };

        let response;
        if (method === 'POST') {
            response = await axios.post(targetUrl, payloadString, axiosConfig);
        } else {
            response = await axios.get(targetUrl, axiosConfig);
        }

        let normalizedState = normalizeCalTopoState(response.data);
        let responseSource = 'caltopo-signed-proxy';

        if ((normalizedState.features || []).length === 0) {
            try {
                const publicState = await fetchPublicCalTopoState(targetUrl);
                if ((publicState.features || []).length > 0) {
                    normalizedState = publicState;
                    responseSource = 'caltopo-public-fallback';
                    console.log(`[PROXY] Recovered ${publicState.features.length} features from public fallback for map ${trimmedMapId}`);
                }
            } catch (publicError) {
                console.warn(`[PROXY] Public fallback failed for ${targetUrl}:`, publicError.message);
            }
        }

        res.json({
            type: normalizedState.type,
            features: normalizedState.features || [],
            state: normalizedState,
            source: responseSource,
            credentialSource: creds.source,
            mapId: trimmedMapId,
            domain: targetDomain,
            caltopoMethod: method
        });
    } catch (error) {
        console.error(`[PROXY] Error fetching from ${targetUrl} (${method}):`, error.message);

        // If GET fails, try POST automatically if not already using it
        if (method === 'GET' && !usePostToCalTopo && (error.response?.status === 405 || error.response?.status === 403 || error.code === 'ECONNRESET')) {
            console.log(`[PROXY] GET failed, retrying with POST...`);
            return fetchMapHandler(req, res, {...requestData, usePost: true});
        }

        const responseStatus = error.response ? error.response.status : 500;
        const responseBody = error.response && error.response.data ? error.response.data : null;
        
        if (responseStatus === 401 || (typeof responseBody === 'string' && responseBody.includes('Authentication'))) {
            const authMessage = `${method.toUpperCase()} ${endpoint}\n${expires}\n${payloadString}`;
            console.error(`[PROXY] Auth Failure! Method: ${method}, Endpoint: ${endpoint}, Expires: ${expires}`);
            console.error(`[PROXY] Signature: ${signature}`);
            console.error(`[PROXY] Signed Message:\n${authMessage}`);
            
            if (typeof responseBody === 'object' && responseBody !== null) {
                responseBody.proxyDiagnostics = {
                    method: method.toUpperCase(),
                    endpoint,
                    expires,
                    payloadSize: payloadString.length,
                    messageToSign: authMessage
                };
            }
        }

        const detailMessage = typeof responseBody === 'string'
            ? responseBody.slice(0, 400)
            : responseBody && responseBody.message
                ? responseBody.message
                : error.message;

        // Return detailed JSON for better debugging in the website
        res.status(responseStatus).json({
            error: error.response ? `CalTopo Error ${responseStatus}` : "Proxy Connection Error",
            message: detailMessage,
            targetUrl: targetUrl,
            mapId: trimmedMapId,
            signingRequired: true,
            credentialSource: creds.source,
            supportsClientSuppliedCredentials: false,
            caltopoResponse: responseBody
        });
    }
};

const executeGenericCall = async (method, endpoint, payloadString, targetUrl, creds, expires, signature) => {
    const upperMethod = method.toUpperCase();
    const isPostLikeWithPayload = ['POST', 'PUT', 'PATCH'].includes(upperMethod) && payloadString.length > 0;

    if (isPostLikeWithPayload) {
        // CalTopo's Team API expects write requests to be form-encoded, with the
        // signed JSON payload supplied in a `json` field alongside the auth params
        // (id/expires/signature) in the request body and no query string. Sending
        // the JSON as a raw application/json body causes "Error Saving Object".
        const form = new URLSearchParams();
        form.append('id', creds.credentialId);
        form.append('expires', expires.toString());
        form.append('signature', signature);
        form.append('json', payloadString);

        try {
            return await axios({
                method: upperMethod,
                url: targetUrl,
                data: form.toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: CALTOPO_TIMEOUT_MS
            });
        } catch (e) {
            // Fallback: retry with the raw JSON body and query-string auth params
            // in case a particular endpoint prefers that legacy format.
            if (e.response && [400, 401, 403].includes(e.response.status)) {
                console.log(`[PROXY] Form-encoded approach failed with ${e.response.status}, retrying with JSON body...`);
                return await axios({
                    method: upperMethod,
                    url: targetUrl,
                    data: payloadString,
                    timeout: CALTOPO_TIMEOUT_MS,
                    params: {
                        id: creds.credentialId,
                        expires,
                        signature
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }
            throw e;
        }
    } else {
        // Standard GET, DELETE, or POST without payload (params in URL)
        const axiosConfig = {
            timeout: CALTOPO_TIMEOUT_MS,
            params: {
                id: creds.credentialId,
                expires,
                signature
            }
        };

        if (upperMethod === 'POST') {
            return await axios.post(targetUrl, payloadString, axiosConfig);
        } else if (upperMethod === 'PUT') {
            return await axios.put(targetUrl, payloadString, axiosConfig);
        } else if (upperMethod === 'DELETE') {
            return await axios.delete(targetUrl, { ...axiosConfig, data: payloadString });
        } else {
            return await axios.get(targetUrl, axiosConfig);
        }
    }
};

const genericCallHandler = async (req, res) => {
    const { method = 'GET', endpoint, payload, domain } = req.body;
    
    if (!endpoint) {
        return res.status(400).json({ error: 'Missing endpoint' });
    }

    const targetDomain = ensureHttpsDomain(domain || req.body.domain);
    const targetUrl = `https://${targetDomain}${endpoint}`;
    const creds = resolveCalTopoCredentials();

    if (!creds.configured) {
        return res.status(500).json({
            error: 'Proxy Not Configured',
            message: getCredentialConfigurationHelp(),
            credentialConfigPaths: getCredentialConfigPaths(),
            supportsClientSuppliedCredentials: false
        });
    }

    // CalTopo Team API: if payload is an empty object, sign and send it as an empty string
    const payloadString = (payload && typeof payload === 'object' && Object.keys(payload).length > 0) 
        ? JSON.stringify(payload) 
        : (typeof payload === 'string' && payload.length > 0 ? payload : '');

    const { expires, signature } = signCalTopoRequest(method, endpoint, payloadString, creds.credentialSecret);

    try {
        console.log(`[PROXY] Generic ${method.toUpperCase()} to ${targetUrl}`);
        if (payloadString) console.log(`[PROXY] Payload: ${payloadString.slice(0, 100)}${payloadString.length > 100 ? '...' : ''}`);
        
        const response = await executeGenericCall(method, endpoint, payloadString, targetUrl, creds, expires, signature);
        res.json(response.data);
    } catch (error) {
        console.error(`[PROXY] Error in generic call to ${targetUrl}:`, error.message);
        if (error.response) {
            console.error(`[PROXY] CalTopo Response Status: ${error.response.status}`);
            console.error(`[PROXY] CalTopo Response Data:`, error.response.data);
        }
        const status = error.response ? error.response.status : 500;
        const responseData = error.response ? error.response.data : { error: error.message };
        
        if (status === 401 || (typeof responseData === 'string' && responseData.includes('Authentication'))) {
            const authMessage = `${method.toUpperCase()} ${endpoint}\n${expires}\n${payloadString}`;
            console.error(`[PROXY] Auth Failure! Method: ${method}, Endpoint: ${endpoint}, Expires: ${expires}`);
            console.error(`[PROXY] Signature: ${signature}`);
            console.error(`[PROXY] Signed Message:\n${authMessage}`);
            
            // Add diagnostic info to help debug on the client
            if (typeof responseData === 'object') {
                responseData.proxyDiagnostics = {
                    method: method.toUpperCase(),
                    endpoint,
                    expires,
                    payloadSize: payloadString.length,
                    messageToSign: authMessage
                };
            }
        }
        
        res.status(status).json(typeof responseData === 'object' ? { ...responseData, targetUrl } : { error: responseData, message: responseData, targetUrl });
    }
};

app.get('/api/proxy', fetchMapHandler);
app.post('/api/proxy', fetchMapHandler);
app.post('/api/call', genericCallHandler);
app.get('/fetch-map', fetchMapHandler); // Alias for compatibility
app.post('/fetch-map', fetchMapHandler); // Alias for compatibility

// Fallback handlers so the API always answers with JSON. Without these,
// Express' defaults return an HTML page ("<!DOCTYPE html> ... Cannot POST
// /api/auth/login" for an unknown route, or "Bad Request" for a body-parser
// failure). A browser that then calls resp.json() throws the cryptic
// "Unexpected token '<', "<!DOCTYPE "... is not valid JSON".
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        method: req.method,
        path: req.originalUrl
    });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = (err && (err.status || err.statusCode)) || 500;
    console.error('[SERVER] Unhandled error:', err && err.message ? err.message : err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(status).json({error: (err && err.message) ? err.message : 'Internal Server Error'});
});

// Only initialize the schema, log credential status, and start listening when
// this file is run directly. When it is required (e.g. from a test), these
// side effects are skipped so no port is opened and no DB connection is made.
if (require.main === module) {
    initDatabaseSchema();
    logCredentialConfigurationStatus();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Sync server v1.3.0 listening on port ${PORT}`);
    });
}

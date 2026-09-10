const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const syncDelta = require('./sync-delta');
const mapSegmentUtils = require('./map-segment-utils');

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

// Gives one of the Lost Person Behavior distance tables its `id` column: a
// unique five-digit AUTO_INCREMENT primary key (LPB_FIRST_ROW_ID upwards),
// with the old composite key kept as a UNIQUE key so there is still exactly
// one row per `keyColumns` combination. The planner edits these tables by hand
// and the database UI will only edit a row it can address by a single-column
// primary key; the id also keeps an edit with its terrain x category row. A
// table created before the column existed is migrated in place - the rows and
// their values stay, MySQL numbers them when the column is added (possibly
// from 1) and the second step moves such rows up into the five-digit range,
// clear of any id already in use. A table that already has the column is left
// alone, so this runs on every start.
const ensureLpbRowIds = async (table, keyColumns) => {
    const column = await getAsync(
        'SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, 'id']
    );
    let changed = false;
    if (!column) {
        await runAsync(`ALTER TABLE \`${table}\`
            DROP PRIMARY KEY,
            ADD COLUMN id INT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
            ADD PRIMARY KEY (id),
            ADD UNIQUE KEY \`uq_${table}\` (${keyColumns.join(', ')}),
            AUTO_INCREMENT = ${LPB_FIRST_ROW_ID}`);
        changed = true;
    }
    const range = await getAsync(`SELECT MIN(id) AS lo, MAX(id) AS hi FROM \`${table}\``);
    const lo = range && range.lo != null ? Number(range.lo) : null;
    const hi = range && range.hi != null ? Number(range.hi) : null;
    if (lo !== null && lo < LPB_FIRST_ROW_ID) {
        const shift = Math.max(LPB_FIRST_ROW_ID, hi + 1) - lo;
        await runAsync(`UPDATE \`${table}\` SET id = id + ? WHERE id < ?`, [shift, LPB_FIRST_ROW_ID]);
        changed = true;
    }
    if (changed) {
        // MySQL raises this to (highest id + 1) when that is larger, so new
        // rows always continue after the ones that are there.
        await runAsync(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${LPB_FIRST_ROW_ID}`);
        console.log(`[DB] ${table}: rows now carry a five-digit id`);
    }
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

        // Images a login uploaded on the Settings page (the header logo and the
        // background photo), one row per (login username, kind). They belong to
        // the login - not to a CASE # - so they follow the user onto every
        // device and every case until "Remove Logo" / "Use Default" is pressed.
        // `data` is the image as a data: URL, exactly as the browser read it.
        db.run(`CREATE TABLE IF NOT EXISTS \`${USER_ASSETS_TABLE}\` (
            username VARCHAR(191) NOT NULL,
            asset_kind VARCHAR(32) NOT NULL,
            file_name VARCHAR(255),
            mime_type VARCHAR(100),
            data LONGTEXT,
            updatedAt VARCHAR(64),
            PRIMARY KEY (username, asset_kind)
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

        // One row per activity-log entry, keyed by the entry's own id and tied
        // to the login username and the CASE # (see the "Activity log entries"
        // section below). Unlike the activity_log mirror above this table is
        // never rebuilt: a row is written when the entry arrives and only ever
        // updated in place afterwards.
        db.run(`CREATE TABLE IF NOT EXISTS \`${ACTIVITY_ENTRIES_TABLE}\` (
            username VARCHAR(191) NOT NULL,
            search_case VARCHAR(191) NOT NULL,
            entry_id VARCHAR(191) NOT NULL,
            user_handle VARCHAR(255),
            team VARCHAR(255),
            tag VARCHAR(255),
            members TEXT,
            action TEXT,
            log_date VARCHAR(32),
            log_time VARCHAR(32),
            logged_at BIGINT DEFAULT NULL,
            data LONGTEXT,
            updatedAt VARCHAR(64),
            deletedAt VARCHAR(64) DEFAULT NULL,
            PRIMARY KEY (username, search_case, entry_id),
            KEY idx_activity_entries_case_time (username, search_case, logged_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // CalTopo Assignments whose "New Assignment" notification was declined
        // with the "Decline for now" button, one row per (login, CASE #,
        // feature). The website reads this list on every page load so a
        // declined assignment is not announced again after a refresh or on
        // another device; importing the assignment removes its row again.
        // feature_key is the website's identity key for the shape ("id:<CalTopo
        // id>" or "name:<lower-cased name>" when the shape has no real id).
        db.run(`CREATE TABLE IF NOT EXISTS \`${DECLINED_ASSIGNMENTS_TABLE}\` (
            username VARCHAR(191) NOT NULL,
            search_case VARCHAR(191) NOT NULL,
            feature_key VARCHAR(191) NOT NULL,
            feature_id VARCHAR(255),
            feature_name VARCHAR(255),
            declined_by VARCHAR(255),
            declined_at VARCHAR(64),
            PRIMARY KEY (username, search_case, feature_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // ------------------------------------------------------------------
        // Lost Person Behavior (see the section of the same name below).
        // ------------------------------------------------------------------

        // How far from the IPP a lost person of a behaviour category is found,
        // per terrain type: the 25 / 50 / 75 / 95 % distances in miles. This is
        // the table the planner edits by hand in the database (no UI writes
        // it), which is why every row carries `id`, a unique five-digit number
        // (see ensureLpbRowIds); (category, terrain) stays unique on top of
        // it. Every known category x terrain is seeded once with placeholder
        // miles so the website always finds a complete set, and a row the
        // planner already entered is never overwritten. The seed is written
        // as INSERT ... SELECT ... WHERE NOT EXISTS rather than INSERT IGNORE
        // because an ignored INSERT IGNORE still uses up an AUTO_INCREMENT
        // number, which would leave a gap in the ids after every start.
        // Create, migrate and seed are chained because the pool may otherwise
        // run them in any order.
        const seedLpbDefaults = async () => {
            const seed = mapSegmentUtils.LPB_SEED_DISTANCES;
            const nowIso = new Date().toISOString();
            for (const category of mapSegmentUtils.LPB_CATEGORIES) {
                for (const terrain of mapSegmentUtils.LPB_TERRAINS) {
                    await runAsync(`INSERT INTO \`${LPB_DEFAULTS_TABLE}\` (category, terrain, p25, p50, p75, p95, updatedAt)
                        SELECT ?, ?, ?, ?, ?, ?, ? FROM DUAL
                        WHERE NOT EXISTS (SELECT 1 FROM \`${LPB_DEFAULTS_TABLE}\` WHERE category = ? AND terrain = ?)`,
                        [category.label, terrain, seed.p25, seed.p50, seed.p75, seed.p95, nowIso, category.label, terrain]);
                }
            }
        };
        runAsync(`CREATE TABLE IF NOT EXISTS \`${LPB_DEFAULTS_TABLE}\` (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            category VARCHAR(191) NOT NULL,
            terrain VARCHAR(64) NOT NULL,
            p25 DECIMAL(6,1),
            p50 DECIMAL(6,1),
            p75 DECIMAL(6,1),
            p95 DECIMAL(6,1),
            updatedAt VARCHAR(64),
            PRIMARY KEY (id),
            UNIQUE KEY \`uq_${LPB_DEFAULTS_TABLE}\` (category, terrain)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=${LPB_FIRST_ROW_ID}`)
            .then(() => ensureLpbRowIds(LPB_DEFAULTS_TABLE, ['category', 'terrain']))
            .then(seedLpbDefaults)
            .catch((err) => console.error(`[DB] could not prepare ${LPB_DEFAULTS_TABLE}:`, err.message));

        // A login's own version of those distances, edited on the Incident
        // page. Tied to the login username only (never to a CASE #) so the
        // edits follow the user onto every device and every case. A NULL
        // bracket means "no override - use the planner's default". Same
        // five-digit `id` (and the same migration) as the defaults table so
        // these rows can be looked at and corrected in the database UI too.
        runAsync(`CREATE TABLE IF NOT EXISTS \`${LPB_USER_DISTANCES_TABLE}\` (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            username VARCHAR(191) NOT NULL,
            category VARCHAR(191) NOT NULL,
            terrain VARCHAR(64) NOT NULL,
            p25 DECIMAL(6,1) NULL,
            p50 DECIMAL(6,1) NULL,
            p75 DECIMAL(6,1) NULL,
            p95 DECIMAL(6,1) NULL,
            updatedAt VARCHAR(64),
            PRIMARY KEY (id),
            UNIQUE KEY \`uq_${LPB_USER_DISTANCES_TABLE}\` (username, category, terrain)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=${LPB_FIRST_ROW_ID}`)
            .then(() => ensureLpbRowIds(LPB_USER_DISTANCES_TABLE, ['username', 'category', 'terrain']))
            .catch((err) => console.error(`[DB] could not prepare ${LPB_USER_DISTANCES_TABLE}:`, err.message));

        // The IPP (initial planning point) of a case: which CalTopo marker it
        // was imported from and where it is, one row per (login, CASE #). It
        // is derived from bundle.lostPersonBehavior.ipp every time the search
        // file is saved (see syncLostPersonIppTable) and disappears again when
        // the IPP is cleared, so the row always matches the search file.
        db.run(`CREATE TABLE IF NOT EXISTS \`${LPB_IPP_TABLE}\` (
            username VARCHAR(191) NOT NULL,
            search_case VARCHAR(191) NOT NULL,
            feature_id VARCHAR(255),
            feature_name VARCHAR(255),
            latitude DOUBLE,
            longitude DOUBLE,
            imported_by VARCHAR(255),
            imported_at VARCHAR(64),
            updatedAt VARCHAR(64),
            PRIMARY KEY (username, search_case)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
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
    'profile',              // Incident / profile page
    'lost_person_behavior', // Lost Person Behavior settings + IPP (= LPB_TABLE)
    'settings_page'         // Settings page values
];

// Every structured table that can be read back by the website.
const STRUCTURED_TABLES = [...COLLECTION_TABLES, ...SINGLE_TABLES];

// Per-entry activity log store (one row per entry, keyed by entry id).
const ACTIVITY_ENTRIES_TABLE = 'activity_log_entries';

// "Declined for now" New Assignment notifications (one row per feature).
const DECLINED_ASSIGNMENTS_TABLE = 'declined_assignment_features';

// Lost Person Behavior (see the "Lost Person Behavior" section below).
// lost_person_behavior is the per-case mirror of bundle.lostPersonBehavior and
// sits in SINGLE_TABLES above, so it gets the generic single-record schema, is
// served by /api/v1/tables and is wiped by the whole-case delete like the rest.
const LPB_TABLE = 'lost_person_behavior';
// The distance table the planner maintains by hand: one row per behaviour
// category x terrain type with the 25 / 50 / 75 / 95 % distances in miles.
const LPB_DEFAULTS_TABLE = 'lpb_default_distances';
// A login's own edits to those distances (a NULL bracket = use the default),
// tied to the login username only - never to a CASE #.
const LPB_USER_DISTANCES_TABLE = 'lpb_user_distances';
// The first `id` handed out in the two distance tables: every row gets a
// unique five-digit number from here up (see ensureLpbRowIds).
const LPB_FIRST_ROW_ID = 10000;
// The IPP marker of a case, one row per (login, CASE #), derived from the
// search file whenever it is saved.
const LPB_IPP_TABLE = 'lpb_ipp';

// Per-login images from the Settings page (see initDatabaseSchema).
const USER_ASSETS_TABLE = 'user_assets';
const USER_ASSET_KINDS = ['logo', 'background'];

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

// Store keys the website uses for its own bookkeeping rather than for a search
// file: the shared "bundle" slot every case is saved under, the old "all-files"
// list and the "user-<pin>" presence pings. None of them is a CASE #, so none
// of them may ever name the structured-table rows (search_case) or show up in
// a user's Saved Cases. Anything else that reaches the store is a real file.
const INTERNAL_STORE_KEYS = ['bundle', 'all-files'];
const PRESENCE_KEY_PREFIX = 'user-';

const isInternalStoreKey = (key) => {
    const value = String(key || '').trim();
    if (!value) { return true; }
    if (INTERNAL_STORE_KEYS.includes(value)) { return true; }
    return value.startsWith(PRESENCE_KEY_PREFIX);
};

// The CASE # a stored search file belongs to: the bundle's own file name when
// it carries one, else the caller's fallback - but never one of the internal
// store keys, which would otherwise leak into the structured tables as cases
// called "bundle", "all-files" or "user-1234".
const searchCaseForBundle = (bundle, fallbackCase) => {
    const own = bundle && typeof bundle.fileName === 'string' ? bundle.fileName.trim() : '';
    if (own && !isInternalStoreKey(own)) { return own.replace(/\.json$/i, ''); }
    const fallback = String(fallbackCase || '').trim();
    if (fallback && !isInternalStoreKey(fallback)) { return fallback.replace(/\.json$/i, ''); }
    return '';
};

// Pure transform: turn a saved bundle into the structured rows that belong in
// each table. Returns null for payloads that are not real save bundles (file
// lists, presence pings, ...). Kept side-effect free so it can be unit tested
// without a database connection.
const buildStructuredPlan = (bundle, fallbackCase) => {
    if (!bundle || typeof bundle !== 'object') { return null; }
    if (!bundle.pages || typeof bundle.pages !== 'object') { return null; }

    // The CASE # is the bundle's own file/case name. Some pushes use a fixed
    // store key ("bundle"), so prefer the name inside the payload and only fall
    // back to the store key when the bundle does not carry one - and never to
    // an internal key (see searchCaseForBundle).
    const searchCase = searchCaseForBundle(bundle, fallbackCase);
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

    // The Lost Person Behavior section is optional (files from older builds
    // never had it). Only a file that carries it gets its IPP mirrored into
    // lpb_ipp - with lostPersonIpp null when the IPP is missing or unusable, so
    // the row is removed again - and a file without it leaves that table alone.
    const lpb = bundle.lostPersonBehavior;
    const hasLostPersonBehavior = !!(lpb && typeof lpb === 'object' && !Array.isArray(lpb));

    return {
        searchCase,
        hasLostPersonBehavior,
        lostPersonIpp: hasLostPersonBehavior ? mapSegmentUtils.normalizeLpbIpp(lpb.ipp) : null,
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
            lost_person_behavior: bundle.lostPersonBehavior || {},
            settings_page: {
                theme: bundle.theme,
                showTips: bundle.showTips,
                geekMode: bundle.geekMode,
                background: bundle.background,
                deleteMode: bundle.deleteMode,
                segmentColorScaleUsePsriMax: bundle.segmentColorScaleUsePsriMax,
                segmentColorScaleLowColor: bundle.segmentColorScaleLowColor,
                segmentColorScaleMidColor: bundle.segmentColorScaleMidColor,
                segmentColorScaleHighColor: bundle.segmentColorScaleHighColor,
                segmentActiveSearchOpacityPercent: bundle.segmentActiveSearchOpacityPercent,
                segmentActiveSearchFillColor: bundle.segmentActiveSearchFillColor,
                segmentActiveSearchBorderOpacityPercent: bundle.segmentActiveSearchBorderOpacityPercent,
                segmentActiveSearchBorderColor: bundle.segmentActiveSearchBorderColor,
                segmentActiveSearchBorderWidth: bundle.segmentActiveSearchBorderWidth,
                parCheckFrequency: bundle.parCheckFrequency,
                mapUnaccountedAutoCheck: bundle.mapUnaccountedAutoCheck,
                mapFeatureTypeFilters: bundle.mapFeatureTypeFilters,
                caltopoColorSyncHeartbeatMinutes: bundle.caltopoColorSyncHeartbeatMinutes,
                caltopoColorSyncCooldownSeconds: bundle.caltopoColorSyncCooldownSeconds
            }
        }
    };
};

// Keep the IPP marker of a case in its own table (lpb_ipp, one row per login
// and CASE #) besides the JSON mirror in lost_person_behavior, so the database
// answers "where is the IPP of this case" without parsing the search file.
// A file without a Lost Person Behavior section issues no SQL at all (older
// files, bookkeeping payloads); a file whose IPP is gone or unusable loses its
// row, so the table always reflects the current search file.
const syncLostPersonIppTable = async (username, searchCase, plan, nowIso) => {
    if (!username || !searchCase || !plan || !plan.hasLostPersonBehavior) { return; }
    const ipp = plan.lostPersonIpp;
    if (!ipp) {
        await runAsync(`DELETE FROM \`${LPB_IPP_TABLE}\` WHERE username = ? AND search_case = ?`, [username, searchCase]);
        return;
    }
    await runAsync(
        `REPLACE INTO \`${LPB_IPP_TABLE}\` (username, search_case, feature_id, feature_name, latitude, longitude, imported_by, imported_at, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, searchCase, toLabel(ipp.featureId) || null, toLabel(ipp.featureName) || null, ipp.lat, ipp.lng,
            toLabel(ipp.importedBy) || null, ipp.importedAt ? String(ipp.importedAt).slice(0, 64) : null, nowIso]
    );
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

    await syncLostPersonIppTable(username, searchCase, plan, nowIso);
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

    // A change anywhere under bundle.lostPersonBehavior may have moved or
    // cleared the IPP; the marker table follows the JSON mirror.
    if (singlesToWrite.has(LPB_TABLE)) {
        await syncLostPersonIppTable(username, searchCase, plan, nowIso);
    }
};

// ----------------------------------------------------------------------------
// Activity log entries
//
// Besides the activity_log mirror above (rebuilt from the file like every other
// table), every activity-log entry that reaches the server is kept as its own
// row in activity_log_entries, keyed by the entry's id and tied to the login
// username and the CASE #. The row is written the moment the entry arrives -
// in a row batch (POST /rows) or a whole-file upload/import - and is only ever
// updated in place afterwards, so the database keeps a complete record of what
// was done in a case: an entry edited later is updated, an entry removed from
// the file keeps its row with deletedAt set. GET /:bucket/activity reads them.
// ----------------------------------------------------------------------------

// The CASE # the structured rows of a bundle belong to: the file name inside
// the bundle, else the clean CASE # behind the bucket id (never the raw
// per-login bucket).
const resolveSearchCase = (bundle, bucket, username) => {
    const fallback = bucket && !isInternalStoreKey(bucket) ? caseNumberFromBucket(bucket, username) : '';
    return searchCaseForBundle(bundle, fallback);
};

// Every entry the website writes carries an id ('log-<ms>-<n>'). Entries from
// older builds or other code paths may not; those get a stable id derived from
// their content so a re-upload never duplicates them.
const activityEntryId = (entry) => {
    if (!entry || typeof entry !== 'object') { return ''; }
    const own = entry.id === undefined || entry.id === null ? '' : String(entry.id).trim();
    if (own) { return own.slice(0, 191); }
    const text = JSON.stringify([entry.timestamp, entry.date, entry.time, entry.team, entry.action]);
    return `log-${syncDelta.hashValue(text)}`;
};

// The tag is '<base|#task> - <handle>': the handle is the team member who was
// using the app when the entry was written.
const activityEntryHandle = (entry) => {
    const tag = String((entry && entry.tag) || '');
    const idx = tag.indexOf(' - ');
    return idx === -1 ? '' : tag.slice(idx + 3).trim();
};

const toText = (value, max = 0) => {
    if (value === undefined || value === null) { return null; }
    const text = String(value);
    return max > 0 ? text.slice(0, max) : text;
};

const activityEntryRow = (entry) => {
    const loggedAt = Number(entry.timestamp);
    return {
        entry_id: activityEntryId(entry),
        user_handle: toLabel(activityEntryHandle(entry)),
        team: toLabel(entry.team),
        tag: toLabel(entry.tag),
        members: toText(entry.members),
        action: toText(entry.action),
        log_date: toText(entry.date, 32),
        log_time: toText(entry.time, 32),
        logged_at: Number.isFinite(loggedAt) ? Math.trunc(loggedAt) : null,
        data: JSON.stringify(entry)
    };
};

// Write (or rewrite) one row per entry. REPLACE keys on (username, search_case,
// entry_id), so an entry that arrives twice - a retried batch, a whole-file
// upload after a row batch - stays a single row; an entry that comes back
// after being removed loses its deletedAt again.
const upsertActivityEntries = async (username, searchCase, entries, nowIso) => {
    if (!username || !searchCase) { return 0; }
    let written = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { continue; }
        const row = activityEntryRow(entry);
        if (!row.entry_id) { continue; }
        await runAsync(
            `REPLACE INTO \`${ACTIVITY_ENTRIES_TABLE}\` (username, search_case, entry_id, user_handle, team, tag, members, action, log_date, log_time, logged_at, data, updatedAt, deletedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [username, searchCase, row.entry_id, row.user_handle, row.team, row.tag, row.members, row.action,
                row.log_date, row.log_time, row.logged_at, row.data, nowIso]
        );
        written++;
    }
    return written;
};

// An entry removed from the file keeps its row; only deletedAt is stamped.
const markActivityEntriesDeleted = async (username, searchCase, entries, nowIso) => {
    if (!username || !searchCase) { return 0; }
    let marked = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
        const entryId = activityEntryId(entry);
        if (!entryId) { continue; }
        await runAsync(
            `UPDATE \`${ACTIVITY_ENTRIES_TABLE}\` SET deletedAt = ? WHERE username = ? AND search_case = ? AND entry_id = ? AND deletedAt IS NULL`,
            [nowIso, username, searchCase, entryId]
        );
        marked++;
    }
    return marked;
};

// Which activity-log entries a batch of applied row changes added or edited
// (upserts) and which it removed (deletions). Pure, so it can be unit tested.
const collectActivityEntryChanges = (bundle, changes) => {
    const upserts = [];
    const deletions = [];
    const list = bundle && Array.isArray(bundle.activityLog) ? bundle.activityLog : [];
    const hasValue = (change) => Object.prototype.hasOwnProperty.call(change, 'value');
    (Array.isArray(changes) ? changes : []).forEach((change) => {
        const path = syncDelta.normalizePath(change && change.path);
        if (!path.length || path[0] !== 'activityLog') { return; }
        if (Array.isArray(change.prepend)) { upserts.push(...change.prepend); }
        if (Array.isArray(change.append)) { upserts.push(...change.append); }
        if (path.length === 1) {
            // The whole list was replaced (legacy clients, a reconcile upload).
            if (hasValue(change) && Array.isArray(change.value)) { upserts.push(...change.value); }
            return;
        }
        if (path.length !== 2) { return; }
        if (change.deleted === true) {
            if (change.previous && typeof change.previous === 'object') { deletions.push(change.previous); }
            return;
        }
        if (hasValue(change)) {
            // The row as it now stands in the merged file (a cell-by-cell merge
            // may differ from what the sender put in `value`).
            const index = Number.isInteger(change.appliedIndex) ? change.appliedIndex : Number(path[1]);
            const merged = list[index];
            upserts.push(merged && typeof merged === 'object' ? merged : change.value);
        }
    });
    return {upserts, deletions};
};

// Row batch: store exactly the entries the batch touched.
const recordActivityEntryChanges = async (username, bucket, bundle, changes) => {
    const searchCase = resolveSearchCase(bundle, bucket, username);
    if (!username || !searchCase) { return {written: 0, marked: 0}; }
    const {upserts, deletions} = collectActivityEntryChanges(bundle, changes);
    if (!upserts.length && !deletions.length) { return {written: 0, marked: 0}; }
    const nowIso = new Date().toISOString();
    const written = await upsertActivityEntries(username, searchCase, upserts, nowIso);
    const marked = await markActivityEntriesDeleted(username, searchCase, deletions, nowIso);
    return {written, marked};
};

// Whole-file upload / import / seed: every entry in the file gets its row.
const recordActivityEntriesFromBundle = async (username, bucket, bundle) => {
    if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.activityLog)) { return 0; }
    const searchCase = resolveSearchCase(bundle, bucket, username);
    if (!username || !searchCase) { return 0; }
    return upsertActivityEntries(username, searchCase, bundle.activityLog, new Date().toISOString());
};

// Expose the pure transform for unit testing without starting the server.
if (typeof module !== 'undefined' && module.exports) {
    module.exports.buildStructuredPlan = buildStructuredPlan;
    module.exports.COLLECTION_TABLES = COLLECTION_TABLES;
    module.exports.SINGLE_TABLES = SINGLE_TABLES;
    module.exports.STRUCTURED_TABLES = STRUCTURED_TABLES;
    module.exports.ACTIVITY_ENTRIES_TABLE = ACTIVITY_ENTRIES_TABLE;
    module.exports.USER_ASSETS_TABLE = USER_ASSETS_TABLE;
    module.exports.USER_ASSET_KINDS = USER_ASSET_KINDS;
    module.exports.DECLINED_ASSIGNMENTS_TABLE = DECLINED_ASSIGNMENTS_TABLE;
    module.exports.LPB_TABLE = LPB_TABLE;
    module.exports.LPB_DEFAULTS_TABLE = LPB_DEFAULTS_TABLE;
    module.exports.LPB_USER_DISTANCES_TABLE = LPB_USER_DISTANCES_TABLE;
    module.exports.LPB_IPP_TABLE = LPB_IPP_TABLE;
    module.exports.LPB_FIRST_ROW_ID = LPB_FIRST_ROW_ID;
    module.exports.syncLostPersonIppTable = syncLostPersonIppTable;
    module.exports.ensureLpbRowIds = ensureLpbRowIds;
    // The schema builder is exposed so a test can check the seed rows are
    // written after (not alongside) the CREATE they depend on.
    module.exports.initDatabaseSchema = initDatabaseSchema;
    module.exports.activityEntryId = activityEntryId;
    module.exports.collectActivityEntryChanges = collectActivityEntryChanges;
    module.exports.isInternalStoreKey = isInternalStoreKey;
    module.exports.searchCaseForBundle = searchCaseForBundle;
    // Exposed so an integration test can drive the endpoints over HTTP without
    // the server having to bind a fixed port on its own.
    module.exports.app = app;
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Name', 'X-User-Pin', 'X-User-Password', 'X-Last-Modified']
}));

// Compatibility path for devices that cannot complete a CORS preflight.
//
// A cross-origin request only skips the browser's OPTIONS preflight when it is
// a "simple request": GET/HEAD/POST, no custom headers, and a content type of
// text/plain, multipart/form-data or application/x-www-form-urlencoded. The app
// normally sends application/json plus X-User-... headers, which always require
// that preflight - and some Windows security suites (antivirus "web shield" /
// HTTPS scanning) and older corporate proxies silently drop OPTIONS requests.
// The client then cannot reach this server at all, even though the site itself
// loads (see postAuthRequest/apiFetch in app.js).
//
// Such a device re-sends the identical request in a preflight-free shape:
//   * headers as query parameters: ?_h_x_user_name=...&_h_x_user_password=...
//   * a JSON body labelled text/plain
//   * PUT/DELETE tunnelled through POST with ?_method=PUT
// This middleware translates that shape back into a normal request, so every
// route below stays unchanged.
app.use((req, res, next) => {
    const query = req.query || {};
    Object.keys(query).forEach((key) => {
        const match = /^_h_(.+)$/.exec(key);
        if (!match) return;
        const headerName = match[1].replace(/_/g, '-').toLowerCase();
        // Only the app's own X-... headers may be injected this way.
        if (!headerName.startsWith('x-')) return;
        if (req.headers[headerName]) return;
        const value = Array.isArray(query[key]) ? query[key][0] : query[key];
        if (value === undefined || value === null || value === '') return;
        req.headers[headerName] = String(value);
    });

    const override = String(query._method || '').toUpperCase();
    if (req.method === 'POST' && ['PUT', 'DELETE', 'PATCH'].includes(override)) {
        req.method = override;
    }

    next();
});

// text/plain is accepted because a preflight-free request cannot declare
// application/json; the body is still JSON, so it is parsed the same way.
app.use(express.json({limit: '50mb', type: ['application/json', 'application/*+json', 'text/plain']}));

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

// The Saved Cases list: every CASE # this login has opened, newest first, each
// with the Regions / Segments / Personnel / Tasks counts of the stored search
// file and whether such a file exists at all (`hasFile`). The website shows
// this list as-is - it keeps no copy of any case - and a case without a
// readable file is still listed so it can be deleted.
app.get('/api/auth/history', authMiddleware, (req, res) => {
    const username = req.user.username;
    db.all("SELECT bucket, lastAccessed FROM user_buckets WHERE username = ? ORDER BY lastAccessed DESC", [username], async (err, rows) => {
        if (err) {
            return res.status(500).json({error: err.message});
        }
        const history = [];
        for (const row of rows || []) {
            // Rows an older build registered for the internal store keys are
            // not cases and never shown.
            if (!row || !isCaseBucket(row.bucket, username)) { continue; }
            const item = {bucket: row.bucket, lastAccessed: row.lastAccessed, hasFile: false, stats: null, caseNumber: caseNumberFromBucket(row.bucket, username)};
            try {
                const stored = await readStoredBundle(row.bucket, username);
                // A search file always carries its pages; anything else stored
                // under the key (a "{}" placeholder, a truncated write) is not
                // a file the website could open.
                if (stored && stored.bundle.pages && typeof stored.bundle.pages === 'object') {
                    item.hasFile = true;
                    item.stats = syncDelta.computeBundleStats(stored.bundle);
                    item.lastModified = stored.bundle.lastModified || null;
                }
            } catch (e) {
                // A stored file that cannot be read is reported without stats; the
                // case still shows so the user can delete it.
            }
            history.push(item);
        }
        res.json(history);
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

// ---------------------------------------------------------------------------
// Per-login images: the header logo and the background photo chosen on the
// Settings page. Stored under the login username (not the CASE #), so they are
// served back on every device and in every case until removed.
//   GET    /api/auth/assets          -> {logo: {...}|null, background: {...}|null}
//   PUT    /api/auth/assets/:kind    body {data: 'data:image/...;base64,...', fileName}
//   DELETE /api/auth/assets/:kind
// ---------------------------------------------------------------------------
const isUserAssetKind = (kind) => USER_ASSET_KINDS.includes(String(kind || ''));

// The MIME type carried by an image data: URL ('' when it is not one).
const imageDataUrlMimeType = (value) => {
    const match = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(String(value || ''));
    return match ? match[1].toLowerCase() : '';
};

const userAssetRowToJson = (row) => ({
    data: row.data,
    fileName: row.file_name || '',
    mimeType: row.mime_type || '',
    updatedAt: row.updatedAt || null
});

app.get('/api/auth/assets', authMiddleware, (req, res) => {
    db.all(`SELECT asset_kind, file_name, mime_type, data, updatedAt FROM \`${USER_ASSETS_TABLE}\` WHERE username = ?`, [req.user.username], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        const out = {};
        USER_ASSET_KINDS.forEach((kind) => { out[kind] = null; });
        (rows || []).forEach((row) => {
            if (row && isUserAssetKind(row.asset_kind) && row.data) {
                out[row.asset_kind] = userAssetRowToJson(row);
            }
        });
        res.json(out);
    });
});

app.get('/api/auth/assets/:kind', authMiddleware, (req, res) => {
    const {kind} = req.params;
    if (!isUserAssetKind(kind)) return res.status(400).json({error: 'unknown asset kind'});
    db.get(`SELECT asset_kind, file_name, mime_type, data, updatedAt FROM \`${USER_ASSETS_TABLE}\` WHERE username = ? AND asset_kind = ?`, [req.user.username, kind], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        if (!row || !row.data) return res.status(404).json({error: 'no such asset'});
        res.json(userAssetRowToJson(row));
    });
});

app.put('/api/auth/assets/:kind', authMiddleware, (req, res) => {
    const {kind} = req.params;
    if (!isUserAssetKind(kind)) return res.status(400).json({error: 'unknown asset kind'});
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = typeof body.data === 'string' ? body.data : '';
    const mimeType = imageDataUrlMimeType(data);
    if (!mimeType) return res.status(400).json({error: 'data must be an image data URL'});
    const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 255) : '';
    const nowIso = new Date().toISOString();
    db.run(
        `REPLACE INTO \`${USER_ASSETS_TABLE}\` (username, asset_kind, file_name, mime_type, data, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.username, kind, fileName, mimeType, data, nowIso],
        (err) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({success: true, asset: {fileName, mimeType, updatedAt: nowIso}});
        }
    );
});

app.delete('/api/auth/assets/:kind', authMiddleware, (req, res) => {
    const {kind} = req.params;
    if (!isUserAssetKind(kind)) return res.status(400).json({error: 'unknown asset kind'});
    db.run(`DELETE FROM \`${USER_ASSETS_TABLE}\` WHERE username = ? AND asset_kind = ?`, [req.user.username, kind], (err) => {
        if (err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// A bucket id names a case only when it is a real CASE # ("<CASE #>_<username>").
// A path such as /api/v1//bundle (empty CASE #) that a proxy collapsed to
// /api/v1/bundle would otherwise register "bundle", "all-files" or
// "user-<pin>" as cases in the user's Saved Cases list.
const isCaseBucket = (bucket, username) => {
    const value = String(bucket || '').trim();
    if (!value || isInternalStoreKey(value)) { return false; }
    return !isInternalStoreKey(caseNumberFromBucket(value, username));
};

// Helper to track bucket access (remember the CASE # in the user's Saved Cases)
const trackBucketAccess = (username, bucket) => {
    if (!username || !isCaseBucket(bucket, username)) return;
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
// A device never uploads a whole search file any more (except once, to seed a
// CASE # the database has never seen). When a cell loses focus (or a button is
// pressed) it posts ONLY the rows it changed to /rows, and it keeps its screen
// current by polling /state, which answers with just the sections that changed
// since the device last looked. Because the merge happens here, two devices
// editing at the same time never overwrite each other. These routes are
// declared before the generic /:bucket/:key routes so they are not swallowed
// by them.
// ----------------------------------------------------------------------------
const STORE_BUNDLE_KEY = 'bundle';
const MAX_ROW_CHANGES = 5000;
// How many recently applied batch ids to remember per CASE #, so a device that
// lost the response and re-sends the same batch does not append its row twice.
const MAX_REMEMBERED_BATCHES = 500;

const storeFileKey = (fileName) => String(fileName || '').replace(/[^a-zA-Z0-9.\-_]/g, '_');

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
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

const readStoredBundle = async (bucket, userName) => {
    const row = await getAsync(
        "SELECT value, userPin FROM store WHERE bucket = ? AND `key` = ? AND userName = ?",
        [bucket, STORE_BUNDLE_KEY, userName]
    );
    if (!row) { return null; }
    const parsed = safeJsonParse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    return {bundle: parsed, userPin: row.userPin};
};

// The stored bundle's lastModified doubles as the version a device polls with,
// so two writes in the same millisecond must still produce distinct values.
const nextLastModified = (previousIso) => {
    let ms = Date.now();
    const previousMs = previousIso ? new Date(previousIso).getTime() : NaN;
    if (Number.isFinite(previousMs) && ms <= previousMs) { ms = previousMs + 1; }
    return new Date(ms).toISOString();
};

// Persist a bundle under both the shared "bundle" key and its file-name key.
const writeStoredBundle = async (bucket, userName, userPin, bundle, nowIso) => {
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
};

const recentBatchIds = new Map(); // bucket -> Set of batch ids already applied

const wasBatchApplied = (bucket, batchId) => {
    if (!batchId) { return false; }
    const seen = recentBatchIds.get(bucket);
    return !!(seen && seen.has(batchId));
};

const rememberBatch = (bucket, batchId) => {
    if (!batchId) { return; }
    let seen = recentBatchIds.get(bucket);
    if (!seen) { seen = new Set(); recentBatchIds.set(bucket, seen); }
    seen.add(batchId);
    while (seen.size > MAX_REMEMBERED_BATCHES) {
        seen.delete(seen.values().next().value);
    }
};

const parseListParam = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

// Apply a device's changed rows onto the stored search file. The response
// echoes the sections those rows touched (minus the heavy ones) so the device
// can put the merged result on screen without a second request.
app.post('/api/v1/:bucket/rows', authMiddleware, async (req, res) => {
    const {bucket} = req.params;
    const userName = req.user.username || 'Unknown';
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';
    const changes = req.body && Array.isArray(req.body.changes) ? req.body.changes : null;
    const batchId = req.body && typeof req.body.batchId === 'string' ? req.body.batchId.slice(0, 128) : '';

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
            const stored = await readStoredBundle(bucket, userName);
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
            // A retry of a batch that already landed (the device never saw the
            // answer): report success without applying it a second time.
            if (wasBatchApplied(bucket, batchId)) {
                return {
                    status: 200,
                    body: {success: true, applied: 0, duplicate: true, lastModified: stored.bundle.lastModified || null}
                };
            }

            const {bundle, applied} = syncDelta.applyBundleChanges(stored.bundle, changes);
            const nowIso = nextLastModified(stored.bundle.lastModified);
            bundle.lastModified = nowIso;
            const touched = syncDelta.collectTouchedSections(applied);
            syncDelta.stampSections(bundle, touched, nowIso);

            await writeStoredBundle(bucket, userName, userPin, bundle, nowIso);
            await applyChangesToTables(userName, caseNumberFromBucket(bucket, userName), bundle, applied);
            // Every activity-log entry the batch carried gets its own row, tied
            // to this login and the CASE #, before the batch is confirmed.
            await recordActivityEntryChanges(userName, bucket, bundle, applied);
            rememberBatch(bucket, batchId);

            const state = syncDelta.pickBundleSections(bundle, {
                keys: Array.from(touched.keys),
                pages: touched.allPages ? null : Array.from(touched.pages),
                skip: syncDelta.HEAVY_KEYS
            });

            return {status: 200, body: {success: true, applied: applied.length, lastModified: nowIso, state}};
        });

        res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[SYNC] row change failed:', err.message);
        res.status(500).json({error: 'Failed to apply row changes'});
    }
});

// What a device polls to see the other devices' changes.
//
//   ?since=<lastModified>  the version the device already has. When nothing
//                          changed the answer is just {modified:false}; otherwise
//                          only the sections that changed since then are sent.
//   ?skip=uploads,maps     heavy sections the current page does not display.
//   ?pages=page2,page4     restrict the pages that are sent (default: all).
app.get('/api/v1/:bucket/state', authMiddleware, async (req, res) => {
    const {bucket} = req.params;
    const since = typeof req.query.since === 'string' ? req.query.since : '';
    const skip = parseListParam(req.query.skip);
    const wantedPages = req.query.pages ? parseListParam(req.query.pages) : null;
    if (!since) {
        trackBucketAccess(req.user.username, bucket);
    }
    try {
        const stored = await readStoredBundle(bucket, req.user.username);
        if (!stored) {
            return res.status(404).json({found: false, error: 'No stored search file for this CASE #'});
        }
        const lastModified = stored.bundle.lastModified || null;
        if (since && lastModified && since === lastModified) {
            return res.json({found: true, modified: false, lastModified});
        }
        const changed = syncDelta.sectionsChangedSince(stored.bundle, since);
        let pages = changed.pages;
        if (wantedPages) {
            pages = pages ? pages.filter((page) => wantedPages.includes(page)) : wantedPages;
        }
        const bundle = syncDelta.pickBundleSections(stored.bundle, {keys: changed.keys, pages, skip});
        res.json({found: true, modified: true, lastModified, bundle});
    } catch (err) {
        console.error('[SYNC] state read failed:', err.message);
        res.status(500).json({error: 'Failed to read state'});
    }
});

// The activity-log entries stored for this login and CASE # (newest first),
// straight from the per-entry table. ?includeDeleted=1 also lists entries that
// were later removed from the search file (they carry a deletedAt stamp).
app.get('/api/v1/:bucket/activity', authMiddleware, async (req, res) => {
    const {bucket} = req.params;
    const username = req.user.username;
    const searchCase = String(req.query.case || req.query.searchCase || '').trim() || caseNumberFromBucket(bucket, username);
    const includeDeleted = String(req.query.includeDeleted || '') === '1';
    if (!searchCase) {
        return res.status(400).json({error: 'A CASE # is required'});
    }
    const params = [username, searchCase];
    let sql = `SELECT * FROM \`${ACTIVITY_ENTRIES_TABLE}\` WHERE username = ? AND search_case = ?`;
    if (!includeDeleted) { sql += ' AND deletedAt IS NULL'; }
    sql += ' ORDER BY logged_at DESC, entry_id DESC';
    db.all(sql, params, (err, rows) => {
        if (err) { return res.status(500).json({error: 'Failed to read activity log'}); }
        res.json({
            username,
            searchCase,
            entries: (rows || []).map((row) => ({...row, data: safeJsonParse(row.data)}))
        });
    });
});

// ---------------------------------------------------------------------------
// "Declined for now" New Assignment notifications
// ---------------------------------------------------------------------------
// The website shows one "New Assignment" notification per CalTopo Assignment
// that is on the map but not imported as a segment. Its "Decline for now"
// button used to hide the entry in memory only, so every page refresh raised
// the same notification again. The declined features are kept here instead,
// per login and CASE #, so the website can leave them out on every load and on
// every device. `?case=` / body.fileName name the CASE # explicitly; otherwise
// it is the CASE # behind the bucket.
const declinedFeatureKey = (value) => String(value || '').trim().slice(0, 191);

const searchCaseForRequest = (req, bucket, username) => {
    const explicit = String((req.query && (req.query.case || req.query.searchCase))
        || (req.body && (req.body.searchCase || req.body.fileName)) || '').trim();
    const searchCase = explicit || caseNumberFromBucket(bucket, username);
    return isInternalStoreKey(searchCase) ? '' : searchCase.replace(/\.json$/i, '');
};

// The declined assignments of this login and CASE #.
app.get('/api/v1/:bucket/declined-assignments', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    const username = req.user.username;
    const searchCase = searchCaseForRequest(req, bucket, username);
    if (!searchCase) {
        return res.status(400).json({error: 'A CASE # is required'});
    }
    db.all(`SELECT feature_key, feature_id, feature_name, declined_by, declined_at FROM \`${DECLINED_ASSIGNMENTS_TABLE}\` WHERE username = ? AND search_case = ? ORDER BY declined_at ASC, feature_key ASC`,
        [username, searchCase], (err, rows) => {
            if (err) { return res.status(500).json({error: 'Failed to read declined assignments'}); }
            res.json({username, searchCase, declined: rows || []});
        });
});

// "Decline for now" pressed: remember the feature. Declining the same feature
// twice (two devices, a retry) just refreshes the row.
app.post('/api/v1/:bucket/declined-assignments', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    const username = req.user.username;
    const searchCase = searchCaseForRequest(req, bucket, username);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const featureKey = declinedFeatureKey(body.featureKey);
    if (!searchCase) {
        return res.status(400).json({error: 'A CASE # is required'});
    }
    if (!featureKey) {
        return res.status(400).json({error: 'featureKey is required'});
    }
    const now = new Date().toISOString();
    db.run(`REPLACE INTO \`${DECLINED_ASSIGNMENTS_TABLE}\` (username, search_case, feature_key, feature_id, feature_name, declined_by, declined_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [username, searchCase, featureKey, toLabel(body.featureId) || null, toLabel(body.featureName) || null, toLabel(body.declinedBy) || null, now], (err) => {
            if (err) { return res.status(500).json({error: 'Failed to save declined assignment'}); }
            res.json({success: true, username, searchCase, featureKey, declinedAt: now});
        });
});

// The decline no longer applies (the assignment was imported): forget it, so a
// later shape with the same key is announced again.
app.delete('/api/v1/:bucket/declined-assignments/:featureKey', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    const username = req.user.username;
    const searchCase = searchCaseForRequest(req, bucket, username);
    const featureKey = declinedFeatureKey(req.params.featureKey);
    if (!searchCase) {
        return res.status(400).json({error: 'A CASE # is required'});
    }
    if (!featureKey) {
        return res.status(400).json({error: 'featureKey is required'});
    }
    db.run(`DELETE FROM \`${DECLINED_ASSIGNMENTS_TABLE}\` WHERE username = ? AND search_case = ? AND feature_key = ?`,
        [username, searchCase, featureKey], (err) => {
            if (err) { return res.status(500).json({error: 'Failed to remove declined assignment'}); }
            res.json({success: true, username, searchCase, featureKey});
        });
});

// ---------------------------------------------------------------------------
// Lost Person Behavior
// ---------------------------------------------------------------------------
// How far from the IPP a lost person of a behaviour category is usually found,
// per terrain type, as the 25 / 50 / 75 / 95 % distances in miles. The planner
// keeps the base numbers in lpb_default_distances by hand (every row has a
// five-digit `id` for that, see ensureLpbRowIds); a login may replace single
// brackets on the Incident page, and those edits live in lpb_user_distances
// under the login username only - so they apply to every case and every device
// of that login, never to another login. The website always receives the
// complete picture: a default for every category x terrain (the seed
// placeholder standing in for a row the table does not have) plus this login's
// overrides. The IPP itself travels inside the search file
// (bundle.lostPersonBehavior.ipp) and is mirrored into lpb_ipp on every save
// (see syncLostPersonIppTable); there is no separate endpoint for it.
//   GET /api/lpb/distances  -> {categories, terrains, brackets, defaults, overrides}
//   PUT /api/lpb/distances  body {category, terrain, values: {p25, p50, p75, p95}}

// The four brackets of a table row as numbers. mysql2 hands DECIMAL columns
// back as strings, and anything that is not a positive number becomes null.
const lpbRowDistances = (row) => {
    const out = {};
    mapSegmentUtils.LPB_BRACKETS.forEach((bracket) => {
        out[bracket.key] = mapSegmentUtils.normalizeLpbDistanceMiles(row ? row[bracket.key] : null);
    });
    return out;
};

// Only the brackets that hold a value; null when none does.
const lpbDefinedDistances = (distances) => {
    const out = {};
    mapSegmentUtils.LPB_BRACKETS.forEach((bracket) => {
        if (distances && typeof distances[bracket.key] === 'number') { out[bracket.key] = distances[bracket.key]; }
    });
    return Object.keys(out).length ? out : null;
};

// The (category label, terrain) a table row belongs to; null for a row whose
// category or terrain the website does not know.
const lpbRowKey = (row) => {
    const category = mapSegmentUtils.getLpbCategory(row && row.category);
    const terrain = String((row && row.terrain) || '').trim();
    if (!category || !mapSegmentUtils.isLpbTerrain(terrain)) { return null; }
    return {label: category.label, terrain};
};

// defaults[category label][terrain] for every known combination: the
// planner's row when there is one, else the seed placeholders.
const buildLpbDefaults = (rows) => {
    const defaults = {};
    mapSegmentUtils.LPB_CATEGORIES.forEach((category) => {
        defaults[category.label] = {};
        mapSegmentUtils.LPB_TERRAINS.forEach((terrain) => {
            defaults[category.label][terrain] = {...mapSegmentUtils.LPB_SEED_DISTANCES};
        });
    });
    (rows || []).forEach((row) => {
        const key = lpbRowKey(row);
        if (key) { defaults[key.label][key.terrain] = lpbRowDistances(row); }
    });
    return defaults;
};

// overrides[category label][terrain] = only the brackets this login replaced.
const buildLpbOverrides = (rows) => {
    const overrides = {};
    (rows || []).forEach((row) => {
        const key = lpbRowKey(row);
        const defined = key ? lpbDefinedDistances(lpbRowDistances(row)) : null;
        if (!defined) { return; }
        if (!overrides[key.label]) { overrides[key.label] = {}; }
        overrides[key.label][key.terrain] = defined;
    });
    return overrides;
};

// Bracket by bracket: the login's override, else the planner's default, else
// the seed placeholder - the numbers the login actually works with.
const effectiveLpbDistances = (override, defaults) => {
    const out = {};
    mapSegmentUtils.LPB_BRACKETS.forEach((bracket) => {
        const own = override ? override[bracket.key] : null;
        const base = defaults ? defaults[bracket.key] : null;
        out[bracket.key] = typeof own === 'number' ? own
            : (typeof base === 'number' ? base : mapSegmentUtils.LPB_SEED_DISTANCES[bracket.key]);
    });
    return out;
};

// Everything the Settings page needs to show and edit the distances.
app.get('/api/lpb/distances', authMiddleware, async (req, res) => {
    const username = req.user.username;
    try {
        const defaultRows = await allAsync(`SELECT category, terrain, p25, p50, p75, p95 FROM \`${LPB_DEFAULTS_TABLE}\``);
        const userRows = await allAsync(`SELECT category, terrain, p25, p50, p75, p95 FROM \`${LPB_USER_DISTANCES_TABLE}\` WHERE username = ?`, [username]);
        res.json({
            categories: mapSegmentUtils.LPB_CATEGORIES,
            terrains: mapSegmentUtils.LPB_TERRAINS,
            brackets: mapSegmentUtils.LPB_BRACKETS,
            defaults: buildLpbDefaults(defaultRows),
            overrides: buildLpbOverrides(userRows)
        });
    } catch (err) {
        console.error('[LPB] distances read failed:', err.message);
        res.status(500).json({error: 'Failed to read Lost Person Behavior distances'});
    }
});

// One category x terrain of this login's overrides. Each bracket is either a
// distance in miles (kept to a tenth) or empty - null / '' / left out - which
// means "use the default" for that bracket; a row with every bracket empty is
// removed so the login is back on the planner's numbers. `category` may be
// the bundle key ("mentalIllness") or the label; the label is what is stored.
app.put('/api/lpb/distances', authMiddleware, async (req, res) => {
    const username = req.user.username;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const category = mapSegmentUtils.getLpbCategory(body.category);
    const terrain = String(body.terrain || '').trim();
    if (!category) {
        return res.status(400).json({error: 'Unknown Lost Person Behavior category'});
    }
    if (!mapSegmentUtils.isLpbTerrain(terrain)) {
        return res.status(400).json({error: 'Unknown terrain type'});
    }
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {};
    const override = {};
    for (const bracket of mapSegmentUtils.LPB_BRACKETS) {
        const raw = values[bracket.key];
        if (raw === null || raw === undefined || raw === '') {
            override[bracket.key] = null;
            continue;
        }
        const miles = mapSegmentUtils.normalizeLpbDistanceMiles(raw);
        if (miles === null) {
            return res.status(400).json({error: `The ${bracket.percent}% distance must be a positive number of miles`});
        }
        override[bracket.key] = miles;
    }

    const stored = lpbDefinedDistances(override);
    const nowIso = new Date().toISOString();
    try {
        if (stored) {
            // Update in place rather than REPLACE (delete + insert) so the row
            // keeps the five-digit id the planner sees in the database UI.
            await runAsync(
                `INSERT INTO \`${LPB_USER_DISTANCES_TABLE}\` (username, category, terrain, p25, p50, p75, p95, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE p25 = ?, p50 = ?, p75 = ?, p95 = ?, updatedAt = ?`,
                [username, category.label, terrain, override.p25, override.p50, override.p75, override.p95, nowIso,
                    override.p25, override.p50, override.p75, override.p95, nowIso]
            );
        } else {
            await runAsync(
                `DELETE FROM \`${LPB_USER_DISTANCES_TABLE}\` WHERE username = ? AND category = ? AND terrain = ?`,
                [username, category.label, terrain]
            );
        }
        const defaults = buildLpbDefaults(await allAsync(`SELECT category, terrain, p25, p50, p75, p95 FROM \`${LPB_DEFAULTS_TABLE}\``));
        res.json({
            success: true,
            category: category.label,
            terrain,
            override: stored,
            effective: effectiveLpbDistances(override, defaults[category.label][terrain])
        });
    } catch (err) {
        console.error('[LPB] distances write failed:', err.message);
        res.status(500).json({error: 'Failed to save Lost Person Behavior distances'});
    }
});

// Read back a single page of the stored search file.
app.get('/api/v1/:bucket/page/:page', authMiddleware, async (req, res) => {
    const {bucket, page} = req.params;
    try {
        const stored = await readStoredBundle(bucket, req.user.username);
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
// Scoped to the authenticated login: a user only ever sees the files they
// created (store.userName), so one login never sees another login's data even
// when they share a bucket (e.g. the same PIN).
//
// Only search files are listed. The bucket also holds the website's own
// bookkeeping rows - the shared "bundle" slot, the old "all-files" list and the
// "user-<pin>" presence pings - and listing those here is what made cases
// called "bundle", "all-files", "user-1967" appear in older builds' Saved Cases.
app.get('/api/v1/:bucket/all-files', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    trackBucketAccess(req.user.username, bucket);
    db.all("SELECT `key`, updatedAt FROM store WHERE bucket = ? AND userName = ?", [bucket, req.user.username], (err, rows) => {
        if (err) return res.status(500).json({error: 'Failed to query database'});
        const files = {};
        rows.forEach(row => {
            if (isInternalStoreKey(row.key)) { return; }
            files[row.key] = { lastModified: row.updatedAt };
        });
        res.json(files);
    });
});

// Get latest bundle for a bucket
app.get('/api/v1/:bucket/latest', authMiddleware, (req, res) => {
    const {bucket} = req.params;
    db.get("SELECT value FROM store WHERE bucket = ? AND userName = ? ORDER BY updatedAt DESC LIMIT 1", [bucket, req.user.username], (err, row) => {
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
    db.get("SELECT value FROM store WHERE bucket = ? AND `key` = ? AND userName = ?", [bucket, key, req.user.username], (err, row) => {
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
    const userName = req.user.username;
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';

    // Only consider the caller's own file: a login can never delete (or even
    // detect) a file created by another login.
    db.get("SELECT userPin FROM store WHERE bucket = ? AND `key` = ? AND userName = ?", [bucket, key, userName], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query db'});
        if (!row) return res.json({success: true}); // already gone
        
        if (row.userPin === '1976' && !isSuperAdmin) {
            return res.status(403).json({
                error: 'Conflict',
                message: 'Cannot delete Super-Admin created files.'
            });
        }
        
        db.run("DELETE FROM store WHERE bucket = ? AND `key` = ? AND userName = ?", [bucket, key, userName], (err) => {
            if (err) return res.status(500).json({error: 'Failed to delete data'});
            res.json({success: true});
        });
    });
});

// Strip the per-login "_<username>" suffix a bucket id carries so the clean
// CASE # can be matched against structured-table rows (whose search_case is the
// CASE #, never the internal bucket id). Express URL-decodes the :bucket param,
// so the decoded "_<username>" form is the common case; the percent-encoded
// form is a fallback for any path that reaches here still encoded. Mirrors the
// client's bucketToCaseNumber() so both ends agree on the round-trip.
const caseNumberFromBucket = (bucket, userName) => {
    if (!bucket) { return ''; }
    if (!userName) { return bucket; }
    const encodedSuffix = `_${encodeURIComponent(userName)}`;
    const rawSuffix = `_${userName}`;
    if (bucket.endsWith(encodedSuffix)) { return bucket.slice(0, -encodedSuffix.length); }
    if (bucket.endsWith(rawSuffix)) { return bucket.slice(0, -rawSuffix.length); }
    return bucket;
};

// Every search_case value the structured rows of a case may carry: the clean
// CASE # behind the bucket, the file name stored inside the search file (older
// builds keyed rows by it, with or without ".json") and the raw bucket id
// (older builds again). Never an internal store key, so a case delete can
// never wipe rows that belong to every case.
const searchCaseCandidates = (bucket, userName, storedBundle) => {
    const names = new Set();
    const add = (value) => {
        const text = String(value || '').trim();
        if (!text || isInternalStoreKey(text)) { return; }
        names.add(text);
        names.add(text.replace(/\.json$/i, ''));
        names.add(`${text.replace(/\.json$/i, '')}.json`);
    };
    add(caseNumberFromBucket(bucket, userName));
    add(bucket);
    if (storedBundle && typeof storedBundle.fileName === 'string') { add(storedBundle.fileName); }
    return Array.from(names).filter((name) => name && !isInternalStoreKey(name));
};

// Permanently delete an entire case (search file) for the authenticated login.
// Unlike DELETE /:bucket/:key (which removes a single store key), this wipes
// every trace of the case for this user so it cannot resync back: all store
// rows for (bucket, userName), the user_buckets history row (username, bucket),
// and every structured-table row for (username, search_case = CASE #). Saved
// Cases calls it for any listed case - one whose search file is missing or
// unreadable is removed exactly the same way, so a case that cannot be loaded
// can always still be deleted.
app.delete('/api/v1/:bucket', authMiddleware, async (req, res) => {
    const {bucket} = req.params;
    const userName = req.user.username;
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';

    try {
        // Super-Admin protection: a regular user cannot delete a case whose
        // stored bundle was written by the Super-Admin (userPin '1976'). Mirrors
        // the guard on DELETE /:bucket/:key.
        const guard = await getAsync(
            "SELECT userPin FROM store WHERE bucket = ? AND userName = ? AND userPin = ? LIMIT 1",
            [bucket, userName, '1976']
        );
        if (guard && !isSuperAdmin) {
            return res.status(403).json({
                error: 'Conflict',
                message: 'Cannot delete Super-Admin created files.'
            });
        }

        // The stored file (if it can still be read) tells which CASE # names
        // its structured rows; a corrupt or missing file just means the rows
        // are looked up by the bucket's CASE # alone.
        let storedBundle = null;
        try {
            const stored = await readStoredBundle(bucket, userName);
            storedBundle = stored ? stored.bundle : null;
        } catch (e) {
            storedBundle = null;
        }
        const searchCases = searchCaseCandidates(bucket, userName, storedBundle);

        await withBucketLock(bucket, async () => {
            // 1) Every store key for this case owned by the caller.
            await runAsync("DELETE FROM store WHERE bucket = ? AND userName = ?", [bucket, userName]);
            // 2) The case-history row so it stops appearing in Saved Cases.
            await runAsync("DELETE FROM user_buckets WHERE username = ? AND bucket = ?", [userName, bucket]);
            // 3) Structured rows for the specific CASE # (never the shared 'bundle'
            //    store key, which is common to every case), including the per-entry
            //    activity log rows, the declined assignments and the IPP marker.
            for (const searchCase of searchCases) {
                for (const table of [...STRUCTURED_TABLES, ACTIVITY_ENTRIES_TABLE, DECLINED_ASSIGNMENTS_TABLE, LPB_IPP_TABLE]) {
                    await runAsync(`DELETE FROM \`${table}\` WHERE username = ? AND search_case = ?`, [userName, searchCase]);
                }
            }
            // 4) A retried row batch for the deleted case must not be mistaken
            //    for one already applied should the CASE # be created again.
            recentBatchIds.delete(bucket);
        });

        res.json({success: true, deleted: {bucket, searchCases}});
    } catch (err) {
        console.error('[SYNC] case delete failed:', err.message);
        res.status(500).json({error: 'Failed to delete case'});
    }
});

// Whole-file upload of the active search file. With the row-level sync this is
// only used to seed a CASE # the database has never seen (?seed=1), so it runs
// under the same per-case lock as the row writes and refuses to replace a file
// that already exists - two devices seeding at once cannot wipe each other out.
// Without ?seed=1 it still accepts a whole file (older clients), but the
// stored copy is stamped with server time so state polls stay consistent.
//
// ?import=1 is the home page's "Import" of a case (.json) file. The file the
// user picked is authoritative: it replaces whatever this login already has
// under the CASE # (the file is usually an older backup, so the "older than
// server data" rule must not apply), and the structured tables for
// (username, CASE #) are rewritten from it BEFORE the answer goes out, so the
// whole case exists in the database - one row per region/segment/person -
// the moment the client reloads.
const putActiveBundle = async (req, res) => {
    const {bucket} = req.params;
    const userName = req.user.username || 'Unknown';
    const userPin = req.headers['x-user-pin'] || req.headers['x-user-password'] || '';
    const isSuperAdmin = userPin === '1976';
    const seedOnly = String(req.query.seed || '') === '1';
    const isImport = String(req.query.import || '') === '1';
    const incoming = req.body;

    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({error: 'A search file object is required'});
    }

    trackBucketAccess(userName, bucket);

    try {
        const result = await withBucketLock(bucket, async () => {
            const stored = await readStoredBundle(bucket, userName);
            if (stored) {
                if (stored.userPin === '1976' && !isSuperAdmin) {
                    return {
                        status: 403,
                        body: {error: 'Conflict', message: 'Changes by Super-Admin cannot be overwritten by a regular user.'}
                    };
                }
                if (seedOnly) {
                    return {
                        status: 409,
                        body: {
                            error: 'This CASE # already has a search file',
                            alreadyExists: true,
                            lastModified: stored.bundle.lastModified || null
                        }
                    };
                }
                // Legacy whole-file clients: never let an older copy replace a
                // newer one (they reconcile and retry on this answer). An import
                // is exempt: the user explicitly chose the file to restore.
                const incomingMs = new Date(req.headers['x-last-modified'] || incoming.lastModified || Date.now()).getTime();
                const storedMs = new Date(stored.bundle.lastModified || 0).getTime();
                if (!isImport && (stored.userPin === '1976') === isSuperAdmin && Number.isFinite(incomingMs) && incomingMs < storedMs) {
                    return {
                        status: 403,
                        body: {error: 'Conflict', message: 'Incoming data is older than server data.'}
                    };
                }
            }

            const bundle = JSON.parse(JSON.stringify(incoming));
            // Server-side bookkeeping from the exporting server must not travel
            // with an imported file; the stamps below describe THIS copy.
            if (isImport) { delete bundle._sectionUpdatedAt; }
            const nowIso = nextLastModified(stored ? stored.bundle.lastModified : null);
            bundle.lastModified = nowIso;
            syncDelta.stampSections(bundle, null, nowIso);

            await writeStoredBundle(bucket, userName, userPin, bundle, nowIso);
            if (isImport) {
                // The import is only reported as done once every table holds
                // the imported rows for (username, CASE #).
                await decomposeBundleToTables(userName, caseNumberFromBucket(bucket, userName), bundle);
                await recordActivityEntriesFromBundle(userName, bucket, bundle);
                // A retried row batch from before the import must not be
                // mistaken for one already applied to the new copy.
                recentBatchIds.delete(bucket);
                return {status: 200, body: {success: true, imported: true, lastModified: nowIso}};
            }
            decomposeBundleToTables(userName, caseNumberFromBucket(bucket, userName), bundle)
                .then(() => recordActivityEntriesFromBundle(userName, bucket, bundle))
                .catch((decomposeErr) => console.error('[DB] decompose error:', decomposeErr.message));

            return {status: 200, body: {success: true, lastModified: nowIso}};
        });
        res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[SYNC] bundle upload failed:', err.message);
        res.status(500).json({error: 'Failed to save data'});
    }
};

app.put('/api/v1/:bucket/:key', authMiddleware, (req, res) => {
    const {bucket, key} = req.params;
    if (key === STORE_BUNDLE_KEY) {
        return putActiveBundle(req, res);
    }
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

    db.get("SELECT userPin, updatedAt FROM store WHERE bucket = ? AND `key` = ? AND userName = ?", [bucket, key, userName], (err, row) => {
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
                    // tagged with the team username and the CASE # behind the
                    // bucket. Bookkeeping keys ("all-files", "user-<pin>") are
                    // not search files and never become cases.
                    if (!isInternalStoreKey(key)) {
                        const fallbackCase = caseNumberFromBucket(bucket, userName);
                        decomposeBundleToTables(userName, fallbackCase, req.body)
                            .then(() => recordActivityEntriesFromBundle(userName, bucket, req.body))
                            .catch((decomposeErr) => console.error('[DB] decompose error:', decomposeErr.message));
                    }
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

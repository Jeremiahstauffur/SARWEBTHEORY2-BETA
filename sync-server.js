const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Name', 'X-User-Pin', 'X-Last-Modified']
}));
app.use(express.json({limit: '50mb'}));

// ===========================================================================
// MySQL persistence layer (username/password accounts + fully-normalized
// per-user data storage). The bucket in the sync API === the account username,
// and the X-User-Pin header === that account's access code (password).
// ===========================================================================
const mysql = require('mysql2/promise');

const SUPER_ADMIN_USERNAME = 'SuperAdmin';
const SUPER_ADMIN_ACCESS_CODE = '1976';

let dbPool = null;

const buildMysqlPoolOptions = () => {
    const baseOptions = {
        waitForConnections: true,
        connectionLimit: 10,
        charset: 'utf8mb4'
    };

    const connectionString = getTrimmedString(
        process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL || ''
    );
    if (connectionString) {
        return {uri: connectionString, ...baseOptions};
    }

    const host = getTrimmedString(process.env.MYSQLHOST || process.env.MYSQL_HOST || '');
    const user = getTrimmedString(process.env.MYSQLUSER || process.env.MYSQL_USER || '');
    const database = getTrimmedString(process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || '');
    if (host && user && database) {
        return {
            host,
            user,
            database,
            password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
            port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
            ...baseOptions
        };
    }

    return null;
};

const createSchema = async () => {
    const statements = [
        `CREATE TABLE IF NOT EXISTS users (
            username VARCHAR(190) NOT NULL PRIMARY KEY,
            access_code VARCHAR(190) NOT NULL,
            is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS user_files (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_key VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NULL,
            data_json LONGTEXT NOT NULL,
            updated_by VARCHAR(190) NULL,
            is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
            last_modified DATETIME NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_file (username, file_key),
            KEY idx_user (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS column_headers (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            page_key VARCHAR(64) NOT NULL,
            col_index INT NOT NULL,
            label TEXT NULL,
            UNIQUE KEY uniq_header (username, file_name, page_key, col_index)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS data_cells (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            page_key VARCHAR(64) NOT NULL,
            row_index INT NOT NULL,
            col_index INT NOT NULL,
            col_key VARCHAR(190) NULL,
            value LONGTEXT NULL,
            updated_by VARCHAR(190) NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_cells_file (username, file_name, page_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS settings (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            setting_key VARCHAR(190) NOT NULL,
            value LONGTEXT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_setting (username, file_name, setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS profile_fields (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            field_key VARCHAR(190) NOT NULL,
            value LONGTEXT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_profile (username, file_name, field_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS form_fields (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(190) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            task_num VARCHAR(190) NOT NULL,
            field_key VARCHAR(190) NOT NULL,
            value LONGTEXT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_form (username, file_name, task_num, field_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ];

    for (const statement of statements) {
        await dbPool.query(statement);
    }
};

const seedSuperAdmin = async () => {
    await dbPool.query(
        'INSERT INTO users (username, access_code, is_super_admin) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE access_code = VALUES(access_code), is_super_admin = 1',
        [SUPER_ADMIN_USERNAME, SUPER_ADMIN_ACCESS_CODE]
    );
};

const initDatabase = async () => {
    const options = buildMysqlPoolOptions();
    if (!options) {
        console.warn('[DB] No MySQL configuration found. Set MYSQL_URL (or MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE). Login and data storage will be unavailable until configured.');
        return;
    }

    dbPool = mysql.createPool(options);

    const connection = await dbPool.getConnection();
    try {
        await connection.query('SELECT 1');
    } finally {
        connection.release();
    }

    await createSchema();
    await seedSuperAdmin();
    console.log(`[DB] MySQL connected. Schema ready and "${SUPER_ADMIN_USERNAME}" account ensured.`);
};

// --- Persistence helpers ---------------------------------------------------
const dbUnavailable = (res) => {
    res.status(503).json({
        error: 'Database not configured',
        message: 'The sync server is not connected to MySQL. Set MYSQL_URL and restart the server.'
    });
};

const getUserRow = async (username) => {
    const [rows] = await dbPool.query(
        'SELECT username, access_code, is_super_admin FROM users WHERE username = ? LIMIT 1',
        [username]
    );
    return rows && rows.length ? rows[0] : null;
};

// Verify the request may access a bucket. The bucket === the account username;
// the requester must present that account's access code via X-User-Pin.
const authenticateBucket = async (req, res) => {
    const bucket = req.params.bucket;
    const providedCode = req.headers['x-user-pin'] != null ? String(req.headers['x-user-pin']) : '';
    const user = await getUserRow(bucket);
    if (!user) {
        res.status(404).json({error: 'Unknown account', message: `No account named "${bucket}".`});
        return null;
    }
    if (String(user.access_code) !== providedCode) {
        res.status(403).json({error: 'Forbidden', message: 'Invalid access code for this account.'});
        return null;
    }
    return {bucket, isSuperAdmin: !!user.is_super_admin};
};

const requireSuperAdmin = async (req, res) => {
    const username = getTrimmedString(req.headers['x-user-name']);
    const code = req.headers['x-user-pin'] != null ? String(req.headers['x-user-pin']) : '';
    const user = await getUserRow(username);
    if (!user || !user.is_super_admin || String(user.access_code) !== code) {
        res.status(403).json({error: 'Forbidden', message: 'Super-Admin credentials are required for this action.'});
        return false;
    }
    return true;
};

const deriveFileName = (key, body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && body.fileName) {
        return String(body.fileName);
    }
    return String(key);
};

const computeIncomingLastModified = (req) => {
    if (req.headers['x-last-modified']) {
        const headerTime = new Date(req.headers['x-last-modified']).getTime();
        if (!Number.isNaN(headerTime)) return headerTime;
    }
    const body = req.body;
    if (body && typeof body === 'object') {
        if (body.lastModified) {
            const bodyTime = new Date(body.lastModified).getTime();
            if (!Number.isNaN(bodyTime)) return bodyTime;
        }
        let maxTime = 0;
        let found = false;
        for (const key of Object.keys(body)) {
            const entry = body[key];
            if (entry && entry.lastModified) {
                const entryTime = new Date(entry.lastModified).getTime();
                if (!Number.isNaN(entryTime) && entryTime > maxTime) {
                    maxTime = entryTime;
                    found = true;
                }
            }
        }
        if (found) return maxTime;
    }
    return Date.now();
};

const toCellString = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// Flatten a form object into [path, value] pairs, e.g. teamMembers[0].name.
const flattenFormValue = (prefix, value, out) => {
    if (value === null || value === undefined) {
        if (prefix) out.push([prefix, '']);
    } else if (Array.isArray(value)) {
        if (value.length === 0) {
            if (prefix) out.push([prefix, '[]']);
        } else {
            value.forEach((item, index) => flattenFormValue(`${prefix}[${index}]`, item, out));
        }
    } else if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) {
            if (prefix) out.push([prefix, '{}']);
        } else {
            keys.forEach((key) => flattenFormValue(prefix ? `${prefix}.${key}` : key, value[key], out));
        }
    } else {
        out.push([prefix || 'value', String(value)]);
    }
};

// Project a single file's bundle into the normalized tables. This is a
// derived view for organized querying; the authoritative copy lives in
// user_files.data_json, so a projection error never loses data.
const decomposeBundle = async (username, fileName, bundle, updatedBy) => {
    if (!bundle || typeof bundle !== 'object') return;
    const fname = String(fileName || 'bundle').slice(0, 255);

    const cellRows = [];
    const headerRows = [];
    const settingRows = [];
    const profileRows = [];
    const formRows = [];

    const pages = bundle.pages && typeof bundle.pages === 'object' ? bundle.pages : {};
    for (const [pageKey, pageData] of Object.entries(pages)) {
        const pk = String(pageKey).slice(0, 64);
        if (pageData && !Array.isArray(pageData) && Array.isArray(pageData.rows)) {
            // Regions-style page: { headers, rows, voterVisibility }
            const headers = Array.isArray(pageData.headers) ? pageData.headers : [];
            headers.forEach((header, colIndex) => {
                headerRows.push([username, fname, pk, colIndex, toCellString(header)]);
            });
            pageData.rows.forEach((row, rowIndex) => {
                const cols = Array.isArray(row) ? row : [row];
                cols.forEach((cellValue, colIndex) => {
                    const colKey = (headers[colIndex] != null ? toCellString(headers[colIndex]) : `col_${colIndex}`).slice(0, 190);
                    cellRows.push([username, fname, pk, rowIndex, colIndex, colKey, toCellString(cellValue), updatedBy]);
                });
            });
            if (Array.isArray(pageData.voterVisibility)) {
                settingRows.push([username, fname, `${pk}.voterVisibility`.slice(0, 190), JSON.stringify(pageData.voterVisibility)]);
            }
        } else if (Array.isArray(pageData)) {
            // Standard page: array of row-arrays
            pageData.forEach((row, rowIndex) => {
                const cols = Array.isArray(row) ? row : [row];
                cols.forEach((cellValue, colIndex) => {
                    cellRows.push([username, fname, pk, rowIndex, colIndex, `col_${colIndex}`, toCellString(cellValue), updatedBy]);
                });
            });
        }
    }

    const scalarSettingKeys = [
        'fileName', 'lastModified', 'deleteMode', 'theme', 'showTips', 'background',
        'parCheckFrequency', 'segmentColorScaleUsePsriMax', 'segmentColorScaleLowColor',
        'segmentColorScaleMidColor', 'segmentColorScaleHighColor', 'segmentActiveSearchOpacityPercent'
    ];
    scalarSettingKeys.forEach((settingKey) => {
        if (bundle[settingKey] !== undefined) {
            settingRows.push([username, fname, settingKey, toCellString(bundle[settingKey])]);
        }
    });

    if (bundle.profile && typeof bundle.profile === 'object') {
        Object.entries(bundle.profile).forEach(([fieldKey, value]) => {
            profileRows.push([username, fname, String(fieldKey).slice(0, 190), toCellString(value)]);
        });
    }

    if (bundle.forms && typeof bundle.forms === 'object') {
        Object.entries(bundle.forms).forEach(([taskNum, form]) => {
            const pairs = [];
            flattenFormValue('', form, pairs);
            pairs.forEach(([fieldKey, value]) => {
                formRows.push([username, fname, String(taskNum).slice(0, 190), String(fieldKey || 'value').slice(0, 190), value]);
            });
        });
    }

    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM data_cells WHERE username = ? AND file_name = ?', [username, fname]);
        await connection.query('DELETE FROM column_headers WHERE username = ? AND file_name = ?', [username, fname]);
        await connection.query('DELETE FROM settings WHERE username = ? AND file_name = ?', [username, fname]);
        await connection.query('DELETE FROM profile_fields WHERE username = ? AND file_name = ?', [username, fname]);
        await connection.query('DELETE FROM form_fields WHERE username = ? AND file_name = ?', [username, fname]);

        if (headerRows.length) await connection.query('INSERT INTO column_headers (username, file_name, page_key, col_index, label) VALUES ?', [headerRows]);
        if (cellRows.length) await connection.query('INSERT INTO data_cells (username, file_name, page_key, row_index, col_index, col_key, value, updated_by) VALUES ?', [cellRows]);
        if (settingRows.length) await connection.query('INSERT INTO settings (username, file_name, setting_key, value) VALUES ?', [settingRows]);
        if (profileRows.length) await connection.query('INSERT INTO profile_fields (username, file_name, field_key, value) VALUES ?', [profileRows]);
        if (formRows.length) await connection.query('INSERT INTO form_fields (username, file_name, task_num, field_key, value) VALUES ?', [formRows]);

        await connection.commit();
    } catch (err) {
        try { await connection.rollback(); } catch (rollbackErr) { /* ignore */ }
        throw err;
    } finally {
        connection.release();
    }
};

// --- Authentication routes -------------------------------------------------
// Login only validates against the users table; there is no registration.
app.post('/api/auth/login', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    const username = getTrimmedString(req.body && req.body.username);
    const password = req.body && req.body.password != null ? String(req.body.password) : '';

    if (!username || !password) {
        return res.status(400).json({success: false, error: 'Username and password are required.'});
    }

    try {
        const user = await getUserRow(username);
        if (!user || String(user.access_code) !== password) {
            return res.status(401).json({success: false, error: 'Invalid username or password.'});
        }
        res.json({success: true, username: user.username, isSuperAdmin: !!user.is_super_admin});
    } catch (err) {
        console.error('[AUTH] Login failed:', err.message);
        res.status(500).json({success: false, error: 'Login failed due to a server error.'});
    }
});

// Super-Admin only: list / create / delete accounts.
app.get('/api/auth/users', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        if (!(await requireSuperAdmin(req, res))) return;
        const [rows] = await dbPool.query('SELECT username, is_super_admin, created_at FROM users ORDER BY is_super_admin DESC, username ASC');
        res.json(rows);
    } catch (err) {
        console.error('[AUTH] List users failed:', err.message);
        res.status(500).json({error: 'Failed to list users.'});
    }
});

app.post('/api/auth/users', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        if (!(await requireSuperAdmin(req, res))) return;
        const username = getTrimmedString(req.body && req.body.username);
        const password = req.body && req.body.password != null ? String(req.body.password) : '';
        if (!username || !password) {
            return res.status(400).json({error: 'Username and password are required.'});
        }
        if (username.length > 190) {
            return res.status(400).json({error: 'Username is too long.'});
        }
        await dbPool.query(
            'INSERT INTO users (username, access_code, is_super_admin) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE access_code = VALUES(access_code)',
            [username, password]
        );
        res.json({success: true, username});
    } catch (err) {
        console.error('[AUTH] Create user failed:', err.message);
        res.status(500).json({error: 'Failed to save user.'});
    }
});

app.delete('/api/auth/users/:username', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        if (!(await requireSuperAdmin(req, res))) return;
        const target = req.params.username;
        if (target === SUPER_ADMIN_USERNAME) {
            return res.status(400).json({error: 'The SuperAdmin account cannot be deleted.'});
        }
        for (const table of ['user_files', 'data_cells', 'column_headers', 'settings', 'profile_fields', 'form_fields']) {
            await dbPool.query(`DELETE FROM ${table} WHERE username = ?`, [target]);
        }
        await dbPool.query('DELETE FROM users WHERE username = ?', [target]);
        res.json({success: true});
    } catch (err) {
        console.error('[AUTH] Delete user failed:', err.message);
        res.status(500).json({error: 'Failed to delete user.'});
    }
});

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

// Keys that hold a full data bundle (eligible for normalized decomposition).
const isBundlePayload = (key, body) => {
    if (key === 'all-files') return false;
    if (/^user-/.test(key)) return false;
    return !!(body && typeof body === 'object' && !Array.isArray(body) && (body.pages || body.profile || body.fileName));
};

// List all stored keys for a user (bucket === account username)
app.get('/api/v1/:bucket', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        const auth = await authenticateBucket(req, res);
        if (!auth) return;
        const [rows] = await dbPool.query('SELECT file_key FROM user_files WHERE username = ?', [auth.bucket]);
        res.json(rows.map(row => row.file_key));
    } catch (err) {
        console.error('[DATA] List failed:', err.message);
        res.status(500).json({error: 'Failed to list keys'});
    }
});

// Get the most recently updated data bundle for a user
app.get('/api/v1/:bucket/latest', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        const auth = await authenticateBucket(req, res);
        if (!auth) return;
        const [rows] = await dbPool.query(
            "SELECT data_json FROM user_files WHERE username = ? AND file_key <> 'all-files' AND file_key NOT LIKE 'user-%' ORDER BY last_modified DESC, updated_at DESC LIMIT 1",
            [auth.bucket]
        );
        if (!rows.length) return res.status(404).json({error: 'No data files found'});
        res.json(JSON.parse(rows[0].data_json));
    } catch (err) {
        console.error('[DATA] Latest failed:', err.message);
        res.status(500).json({error: 'Internal server error'});
    }
});

// Get a stored value by key
app.get('/api/v1/:bucket/:key', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        const auth = await authenticateBucket(req, res);
        if (!auth) return;
        const [rows] = await dbPool.query(
            'SELECT data_json FROM user_files WHERE username = ? AND file_key = ? LIMIT 1',
            [auth.bucket, req.params.key]
        );
        if (!rows.length) return res.status(404).json({error: 'Not found'});
        res.json(JSON.parse(rows[0].data_json));
    } catch (err) {
        console.error('[DATA] Read failed:', err.message);
        res.status(500).json({error: 'Failed to read data'});
    }
});

// Store a value by key, then project bundles into the normalized tables
app.put('/api/v1/:bucket/:key', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        const auth = await authenticateBucket(req, res);
        if (!auth) return;
        const bucket = auth.bucket;
        const key = req.params.key;
        const userName = getTrimmedString(req.headers['x-user-name']) || bucket;
        const incoming = computeIncomingLastModified(req);

        const [existing] = await dbPool.query(
            'SELECT last_modified FROM user_files WHERE username = ? AND file_key = ? LIMIT 1',
            [bucket, key]
        );
        if (existing.length && existing[0].last_modified) {
            const existingMs = new Date(existing[0].last_modified).getTime();
            if (incoming && !Number.isNaN(existingMs) && incoming < existingMs) {
                return res.status(403).json({error: 'Conflict', message: 'Incoming data is older than server data.'});
            }
        }

        const saveDate = new Date(incoming && incoming > 0 ? incoming : Date.now());
        const fileName = deriveFileName(key, req.body);

        await dbPool.query(
            `INSERT INTO user_files (username, file_key, file_name, data_json, updated_by, is_super_admin, last_modified)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), file_name = VALUES(file_name), updated_by = VALUES(updated_by), is_super_admin = VALUES(is_super_admin), last_modified = VALUES(last_modified)`,
            [bucket, key, fileName, JSON.stringify(req.body), userName, auth.isSuperAdmin ? 1 : 0, saveDate]
        );

        // Project into normalized tables (best-effort; never blocks the authoritative save).
        try {
            if (key === 'all-files' && req.body && typeof req.body === 'object') {
                for (const [fname, info] of Object.entries(req.body)) {
                    if (info && info.bundle) {
                        await decomposeBundle(bucket, fname, info.bundle, userName);
                    }
                }
            } else if (isBundlePayload(key, req.body)) {
                await decomposeBundle(bucket, fileName, req.body, userName);
            }
        } catch (decompErr) {
            console.warn('[DATA] Normalized projection skipped:', decompErr.message);
        }

        res.json({success: true});
    } catch (err) {
        console.error('[DATA] Save failed:', err.message);
        res.status(500).json({error: 'Failed to save data'});
    }
});

// Delete a stored value
app.delete('/api/v1/:bucket/:key', async (req, res) => {
    if (!dbPool) return dbUnavailable(res);
    try {
        const auth = await authenticateBucket(req, res);
        if (!auth) return;
        await dbPool.query('DELETE FROM user_files WHERE username = ? AND file_key = ?', [auth.bucket, req.params.key]);
        res.json({success: true});
    } catch (err) {
        console.error('[DATA] Delete failed:', err.message);
        res.status(500).json({error: 'Failed to delete data'});
    }
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
        version: '1.4.0',
        service: 'SAR Proxy + Sync',
        databaseConfigured: !!dbPool,
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
        const axiosConfig = {
            timeout: CALTOPO_TIMEOUT_MS,
            params: {
                id: creds.credentialId,
                expires,
                signature
            },
            headers: {
                'Content-Type': 'application/json'
            }
        };

        try {
            return await axios({
                method: upperMethod,
                url: targetUrl,
                data: payloadString,
                ...axiosConfig
            });
        } catch (e) {
            // If it's a format issue (400) or auth issue (401), try the legacy form-encoded approach.
            if (e.response && [400, 401, 403].includes(e.response.status)) {
                console.log(`[PROXY] JSON approach failed with ${e.response.status}, retrying with form-encoded...`);
                const form = new URLSearchParams();
                form.append('id', creds.credentialId);
                form.append('expires', expires.toString());
                form.append('signature', signature);
                form.append('json', payloadString);

                return await axios({
                    method: upperMethod,
                    url: targetUrl,
                    data: form.toString(),
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: CALTOPO_TIMEOUT_MS
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

logCredentialConfigurationStatus();

// Connect to MySQL, ensure the schema + SuperAdmin exist, then start serving.
// The server still boots (health + proxy) even if the database is unavailable;
// data + auth endpoints will return 503 until MYSQL_URL is configured.
initDatabase()
    .catch((err) => {
        console.error('[DB] Initialization failed. Login and data storage will be unavailable until MySQL is reachable:', err.message);
    })
    .finally(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Sync server v1.4.0 listening on port ${PORT}`);
        });
    });

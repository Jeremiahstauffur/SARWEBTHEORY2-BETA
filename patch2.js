const fs = require('fs');
let code = fs.readFileSync('sync-server.js', 'utf8');

const sqliteImports = `const sqlite3 = require('sqlite3').verbose();
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const db = new sqlite3.Database(path.join(DATA_DIR, 'sync.sqlite'));

db.serialize(() => {
    db.run(\`CREATE TABLE IF NOT EXISTS store (
        bucket TEXT,
        key TEXT,
        value TEXT,
        lastModified INTEGER,
        userName TEXT,
        userPin TEXT,
        PRIMARY KEY (bucket, key)
    )\`);
});`;

const searchBlock = `// Helper to get file path
const getFilePath = (bucket, key) => {
    const bucketDir = path.join(DATA_DIR, bucket);
    if (!fs.existsSync(bucketDir)) {
        fs.mkdirSync(bucketDir);
    }
    // Sanitize key to prevent directory traversal
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(bucketDir, \`\${safeKey}.json\`);
};

// List all keys in a bucket
app.get('/api/v1/:bucket', (req, res) => {
    const {bucket} = req.params;
    const bucketDir = path.join(DATA_DIR, bucket);

    if (!fs.existsSync(bucketDir)) {
        return res.json([]);
    }

    try {
        const files = fs.readdirSync(bucketDir);
        const keys = files
            .filter(f => f.endsWith('.json') && !f.endsWith('.meta'))
            .map(f => f.replace('.json', ''));
        res.json(keys);
    } catch (err) {
        res.status(500).json({error: 'Failed to list keys'});
    }
});

// Get the most recently updated file in a bucket
app.get('/api/v1/:bucket/latest', (req, res) => {
    const {bucket} = req.params;
    const bucketDir = path.join(DATA_DIR, bucket);

    if (!fs.existsSync(bucketDir)) {
        return res.status(404).json({error: 'Bucket not found'});
    }

    try {
        const files = fs.readdirSync(bucketDir)
            .filter(f => f.endsWith('.json') && f !== 'all-files.json' && f !== 'bundle.json');
        
        if (files.length === 0) {
            // Fallback to bundle.json if it exists
            const bundlePath = path.join(bucketDir, 'bundle.json');
            if (fs.existsSync(bundlePath)) {
                return res.json(JSON.parse(fs.readFileSync(bundlePath, 'utf8')));
            }
            return res.status(404).json({error: 'No data files found'});
        }

        let latestFile = null;
        let latestTime = 0;

        files.forEach(f => {
            const filePath = path.join(bucketDir, f);
            const metaPath = filePath + '.meta';
            let updatedAt;

            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    updatedAt = new Date(meta.updatedAt).getTime();
                } catch (e) {
                    updatedAt = fs.statSync(filePath).mtimeMs;
                }
            } else {
                updatedAt = fs.statSync(filePath).mtimeMs;
            }

            if (updatedAt >= latestTime) {
                latestTime = updatedAt;
                latestFile = f;
            }
        });

        // Also check bundle.json for its time
        const bundlePath = path.join(bucketDir, 'bundle.json');
        if (fs.existsSync(bundlePath)) {
            const bundleMetaPath = bundlePath + '.meta';
            let bundleTime;
            if (fs.existsSync(bundleMetaPath)) {
                try {
                    bundleTime = new Date(JSON.parse(fs.readFileSync(bundleMetaPath, 'utf8')).updatedAt).getTime();
                } catch (e) {
                    bundleTime = fs.statSync(bundlePath).mtimeMs;
                }
            } else {
                bundleTime = fs.statSync(bundlePath).mtimeMs;
            }

            if (bundleTime >= latestTime) {
                latestTime = bundleTime;
                latestFile = 'bundle.json';
            }
        }

        if (latestFile) {
            const data = fs.readFileSync(path.join(bucketDir, latestFile), 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.status(404).json({error: 'No files found'});
        }
    } catch (err) {
        console.error('Error finding latest file:', err);
        res.status(500).json({error: 'Internal server error'});
    }
});

// Get a value
app.get('/api/v1/:bucket/:key', (req, res) => {
    const {bucket, key} = req.params;
    const filePath = getFilePath(bucket, key);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({error: 'Not found'});
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        res.status(500).json({error: 'Failed to read data'});
    }
});

// Set a value
app.put('/api/v1/:bucket/:key', (req, res) => {
    const {bucket, key} = req.params;
    const filePath = getFilePath(bucket, key);
    const metaPath = filePath + '.meta';

    const userName = req.headers['x-user-name'] || 'Unknown';
    const userPin = req.headers['x-user-pin'] || '';
    const isSuperAdmin = userPin === '1976';

    let incomingLastModified = Date.now();
    if (req.headers['x-last-modified']) {
        incomingLastModified = new Date(req.headers['x-last-modified']).getTime();
    } else if (req.body) {
        if (req.body.lastModified) {
            incomingLastModified = new Date(req.body.lastModified).getTime();
        } else if (typeof req.body === 'object' && req.body !== null) {
            // Try to find latest modified time in a collection of files
            let found = false;
            let maxM = 0;
            for (const key in req.body) {
                if (req.body[key] && req.body[key].lastModified) {
                    const m = new Date(req.body[key].lastModified).getTime();
                    if (m > maxM) maxM = m;
                    found = true;
                }
            }
            if (found) incomingLastModified = maxM;
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const currentIsSuperAdmin = meta.userPin === '1976';
            const existingLastModified = new Date(meta.updatedAt).getTime();

            // Super-Admin priority
            if (currentIsSuperAdmin && !isSuperAdmin) {
                return res.status(403).json({
                    error: 'Conflict',
                    message: 'Changes by Super-Admin cannot be overwritten by a regular user.'
                });
            }

            // Conflict resolution (same level or Super-Admin overwriting anyone)
            if (isSuperAdmin === currentIsSuperAdmin) {
                if (incomingLastModified < existingLastModified) {
                    return res.status(403).json({
                        error: 'Conflict',
                        message: 'Incoming data is older than server data.'
                    });
                }
            }
        } catch (err) {
            console.error('Failed to read meta file:', err);
        }
    }

    const saveTime = (incomingLastModified && incomingLastModified > 0) 
        ? new Date(incomingLastModified).toISOString() 
        : new Date().toISOString();

    try {
        fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
        fs.writeFileSync(metaPath, JSON.stringify({
            userName,
            userPin,
            updatedAt: saveTime
        }, null, 2));
        res.json({success: true});
    } catch (err) {
        res.status(500).json({error: 'Failed to save data'});
    }
});`;

const replaceBlock = `// List all keys in a bucket
app.get('/api/v1/:bucket', (req, res) => {
    const {bucket} = req.params;
    db.all("SELECT key FROM store WHERE bucket = ?", [bucket], (err, rows) => {
        if (err) return res.status(500).json({error: 'Failed to list keys'});
        res.json(rows.map(r => r.key));
    });
});

// Get the most recently updated file in a bucket
app.get('/api/v1/:bucket/latest', (req, res) => {
    const {bucket} = req.params;
    db.get("SELECT value FROM store WHERE bucket = ? AND key != 'all-files' AND key != 'bundle' ORDER BY lastModified DESC LIMIT 1", [bucket], (err, row) => {
        if (err) return res.status(500).json({error: 'Internal server error'});
        if (row && row.value) return res.json(JSON.parse(row.value));
        
        // Fallback to bundle
        db.get("SELECT value FROM store WHERE bucket = ? AND key = 'bundle'", [bucket], (err, bundleRow) => {
            if (err) return res.status(500).json({error: 'Internal server error'});
            if (bundleRow && bundleRow.value) return res.json(JSON.parse(bundleRow.value));
            res.status(404).json({error: 'No files found'});
        });
    });
});

// Get a value
app.get('/api/v1/:bucket/:key', (req, res) => {
    const {bucket, key} = req.params;
    db.get("SELECT value FROM store WHERE bucket = ? AND key = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to read data'});
        if (row && row.value) return res.json(JSON.parse(row.value));
        res.status(404).json({error: 'Not found'});
    });
});

// Set a value
app.put('/api/v1/:bucket/:key', (req, res) => {
    const {bucket, key} = req.params;
    const userName = req.headers['x-user-name'] || 'Unknown';
    const userPin = req.headers['x-user-pin'] || '';
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

    db.get("SELECT lastModified, userPin FROM store WHERE bucket = ? AND key = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query db'});
        
        if (row) {
            const currentIsSuperAdmin = row.userPin === '1976';
            const existingLastModified = row.lastModified;

            if (currentIsSuperAdmin && !isSuperAdmin) {
                return res.status(403).json({
                    error: 'Conflict',
                    message: 'Changes by Super-Admin cannot be overwritten by a regular user.'
                });
            }

            if (isSuperAdmin === currentIsSuperAdmin) {
                if (incomingLastModified < existingLastModified) {
                    return res.status(403).json({
                        error: 'Conflict',
                        message: 'Incoming data is older than server data.'
                    });
                }
            }
        }

        db.run(
            "INSERT OR REPLACE INTO store (bucket, key, value, lastModified, userName, userPin) VALUES (?, ?, ?, ?, ?, ?)",
            [bucket, key, JSON.stringify(req.body), incomingLastModified, userName, userPin],
            function(err) {
                if (err) return res.status(500).json({error: 'Failed to save data'});
                res.json({success: true});
            }
        );
    });
});`;

code = code.replace("const DATA_DIR = path.join(__dirname, 'data');\nif (!fs.existsSync(DATA_DIR)) {\n    fs.mkdirSync(DATA_DIR);\n}", sqliteImports);
code = code.replace(searchBlock, replaceBlock);

fs.writeFileSync('sync-server.js', code);

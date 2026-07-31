const fs = require('fs');
let code = fs.readFileSync('sync-server.js', 'utf8');

const sqliteImports = `const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'data', 'sync.sqlite');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}
const db = new sqlite3.Database(dbPath);

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

code = code.replace(/const path = require\('path'\);/, "const path = require('path');\n" + sqliteImports);

fs.writeFileSync('sync-server-new.js', code);

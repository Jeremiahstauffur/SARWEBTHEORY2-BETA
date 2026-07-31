const fs = require('fs');
let code = fs.readFileSync('sync-server.js', 'utf8');

const listKeysBlock = `// List all keys in a bucket
app.get('/api/v1/:bucket', (req, res) => {
    const {bucket} = req.params;
    db.all("SELECT key FROM store WHERE bucket = ?", [bucket], (err, rows) => {
        if (err) return res.status(500).json({error: 'Failed to list keys'});
        res.json(rows.map(r => r.key));
    });
});`;

const newListKeysBlock = `// List all keys in a bucket
app.get('/api/v1/:bucket', (req, res) => {
    const {bucket} = req.params;
    db.all("SELECT key, lastModified, length(value) as size FROM store WHERE bucket = ? AND key != 'bundle' AND key != 'all-files'", [bucket], (err, rows) => {
        if (err) return res.status(500).json({error: 'Failed to list keys'});
        res.json(rows);
    });
});`;

code = code.replace(listKeysBlock, newListKeysBlock);
fs.writeFileSync('sync-server.js', code);

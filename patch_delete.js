const fs = require('fs');

// Patch sync-server.js to add DELETE
let code = fs.readFileSync('sync-server.js', 'utf8');
const putEndpoint = `app.put('/api/v1/:bucket/:key', (req, res) => {`;
const deleteEndpoint = `// Delete a value
app.delete('/api/v1/:bucket/:key', (req, res) => {
    const {bucket, key} = req.params;
    const userPin = req.headers['x-user-pin'] || '';
    const isSuperAdmin = userPin === '1976';

    db.get("SELECT userPin FROM store WHERE bucket = ? AND key = ?", [bucket, key], (err, row) => {
        if (err) return res.status(500).json({error: 'Failed to query db'});
        if (!row) return res.json({success: true}); // already gone
        
        if (row.userPin === '1976' && !isSuperAdmin) {
            return res.status(403).json({
                error: 'Conflict',
                message: 'Cannot delete Super-Admin created files.'
            });
        }
        
        db.run("DELETE FROM store WHERE bucket = ? AND key = ?", [bucket, key], (err) => {
            if (err) return res.status(500).json({error: 'Failed to delete data'});
            res.json({success: true});
        });
    });
});

`;
if (!code.includes('app.delete')) {
    code = code.replace(putEndpoint, deleteEndpoint + putEndpoint);
    fs.writeFileSync('sync-server.js', code);
}

// Patch app.js to use DELETE endpoint
let appCode = fs.readFileSync('app.js', 'utf8');
const deleteCallMatch = `                    if (serverUrl) {
                        try {
                            const safeKey = name.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
                            // No delete endpoint currently implemented in server? 
                            // We should probably add one or ignore it for now.
                        } catch(e) {}
                    }`;

const deleteCallReplace = `                    if (serverUrl) {
                        try {
                            const safeKey = name.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
                            const user = getCurrentUser();
                            await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}/\${safeKey}\`, {
                                method: 'DELETE',
                                headers: {
                                    'X-User-Pin': user ? user.pin : ''
                                }
                            });
                        } catch(e) {
                            console.error('Failed to delete from server:', e);
                        }
                    }`;

appCode = appCode.replace(deleteCallMatch, deleteCallReplace);
fs.writeFileSync('app.js', appCode);

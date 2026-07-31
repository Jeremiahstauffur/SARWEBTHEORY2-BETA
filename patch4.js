const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const matchBlock = `        // 4. Discover any files on server not in the list
        const keysResp = await fetch(\`\${apiBase}?_=\${Date.now()}\`);
        if (keysResp.ok) {
            const keys = await keysResp.json();
            const localFiles = getSavedFiles();
            let discovered = false;
            for (const key of keys) {
                if (key === 'all-files' || key === 'bundle' || key.startsWith('user-')) continue;
                
                // Check if any local file matches this sanitized key or if the name matches directly
                const alreadyHave = Object.keys(localFiles).some(name => 
                    name === key ||
                    name.replace(/[^a-zA-Z0-9.\\-_]/g, '_') === key ||
                    name.replace(/[^a-z0-9_-]/gi, '_') === key
                );
                
                if (!alreadyHave) {
                    // Fetch the missing file
                    const fileResp = await fetch(\`\${apiBase}/\${key}?_=\${Date.now()}\`);
                    if (fileResp.ok) {
                        const bundle = await fileResp.json();
                        const actualName = bundle.fileName || key;
                        localFiles[actualName] = {
                            bundle: sanitizeBundle(bundle),
                            lastModified: bundle.lastModified || new Date().toISOString()
                        };
                        discovered = true;
                        console.log(\`Discovered missing file from bucket: \${key} as \${actualName}\`);
                    }
                }
            }
            if (discovered) {
                localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(localFiles));
                pushFileListToServer(localFiles);
                refreshSyncUI();
            }
        }`;

const replaceBlock = `        // 4. Discovery step removed to prevent downloading all bundles into localStorage and exceeding quota.
        // The list is fetched directly from the backend dynamically instead.`;

code = code.replace(matchBlock, replaceBlock);
fs.writeFileSync('app.js', code);

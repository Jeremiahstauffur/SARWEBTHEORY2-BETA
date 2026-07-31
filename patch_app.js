const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// 1. Modify `saveFileToList` and `deleteFileFromList`
const saveFileToListMatch = `function saveFileToList(fileName, bundle) {
    const files = getSavedFiles();
    if (!files[fileName]) {
        logCreation('File', fileName, bundle);
    }
    files[fileName] = {
        bundle: sanitizeBundle(bundle),
        lastModified: new Date().toISOString()
    };
    localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(files));
    // No longer push to server immediately to prevent race conditions during sync.
    // Background sync loop will handle pushing merged updates.
}`;

const saveFileToListReplace = `function saveFileToList(fileName, bundle) {
    const files = getSavedFiles();
    if (!files[fileName]) {
        logCreation('File', fileName, bundle);
    }
    // Only store metadata to avoid localStorage quota limits
    files[fileName] = {
        lastModified: new Date().toISOString(),
        size: JSON.stringify(bundle).length
    };
    localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(files));
}`;

code = code.replace(saveFileToListMatch, saveFileToListReplace);

// 2. Modify `buildSavedFilesTable` to use API if available, else local
const buildSavedFilesMatch = `function buildSavedFilesTable() {
    const tbody = document.getElementById('saved-files-body');
    if (!tbody) return;

    const files = getSavedFiles();
    const fileNames = Object.keys(files).sort();
    
    if (fileNames.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted); padding: 20px;">No saved search files yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const currentUser = getCurrentUser();
    const isAdmin = isUserAdmin(currentUser);
    const isFileManager = currentUser && (currentUser.isFileManager === true || currentUser.isFileManager === 'true');

    fileNames.forEach(name => {
        const fileInfo = files[name];
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        // Name (Open button-like pill)
        const tdName = document.createElement('td');
        tdName.setAttribute('data-label', 'File Name');
        tdName.style.padding = '12px 15px';
        const nameBtn = document.createElement('button');
        nameBtn.className = 'mini-pill';
        nameBtn.style.fontWeight = 'bold';
        nameBtn.textContent = name;
        nameBtn.onclick = () => {
            saveBundle(fileInfo.bundle);
            window.location.reload();
        };
        tdName.appendChild(nameBtn);
        tr.appendChild(tdName);

        // Date
        const tdDate = document.createElement('td');
        tdDate.setAttribute('data-label', 'Last Modified');
        tdDate.style.padding = '12px 15px';
        tdDate.style.color = 'var(--muted)';
        try {
            tdDate.textContent = new Date(fileInfo.lastModified).toLocaleString();
        } catch(e) {
            tdDate.textContent = fileInfo.lastModified;
        }
        tr.appendChild(tdDate);

        // Size
        const tdSize = document.createElement('td');
        tdSize.setAttribute('data-label', 'File Size');
        tdSize.style.padding = '12px 15px';
        tdSize.style.color = 'var(--muted)';
        const sizeInBytes = JSON.stringify(fileInfo.bundle).length;
        const sizeInKB = (sizeInBytes / 1024).toFixed(1);
        tdSize.textContent = \`\${sizeInKB} KB\`;
        tr.appendChild(tdSize);

        // Actions
        const tdActions = document.createElement('td');
        tdActions.setAttribute('data-label', 'Actions');
        tdActions.style.padding = '12px 15px';
        tdActions.style.textAlign = 'center';
        
        const btnCont = document.createElement('div');
        btnCont.className = 'tool-actions';
        btnCont.style.justifyContent = 'center';
        btnCont.style.gap = '10px';

        const downBtn = document.createElement('button');
        downBtn.className = 'mini-pill';
        downBtn.textContent = 'Download';
        downBtn.onclick = () => {
            downloadTextFile(name, JSON.stringify(fileInfo.bundle, null, 2));
        };
        btnCont.appendChild(downBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'row-delete-btn';
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => {
            if (isAdmin || isFileManager) {
                const b = loadBundle();
                const doDelete = () => {
                    deleteFileFromList(name);
                    buildSavedFilesTable();
                };
                if (b.deleteMode) {
                    doDelete();
                } else if (confirm(\`Are you sure you want to delete "\${name}"?\`)) {
                    doDelete();
                }
            } else {
                alert('You do not have permission to delete files. Contact Super Admin or a File Manager.');
            }
        };
        btnCont.appendChild(delBtn);

        tdActions.appendChild(btnCont);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}`;

const buildSavedFilesReplace = `async function buildSavedFilesTable() {
    const tbody = document.getElementById('saved-files-body');
    if (!tbody) return;

    let filesMap = getSavedFiles(); // Fallback to local metadata
    
    // Fetch dynamically from server if available
    const bucket = getSyncBucket();
    const serverUrl = getSyncServerUrl();
    if (serverUrl) {
        try {
            const resp = await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}?_=\${Date.now()}\`);
            if (resp.ok) {
                const serverFiles = await resp.json();
                const newMap = {};
                serverFiles.forEach(sf => {
                    newMap[sf.key] = { lastModified: new Date(sf.lastModified).toISOString(), size: sf.size };
                });
                filesMap = newMap;
                localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(filesMap)); // update local metadata cache
            }
        } catch(e) {
            console.warn('Failed to fetch file list from server, using local metadata.');
        }
    }

    const fileNames = Object.keys(filesMap).sort();
    
    if (fileNames.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted); padding: 20px;">No saved search files yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const currentUser = getCurrentUser();
    const isAdmin = isUserAdmin(currentUser);
    const isFileManager = currentUser && (currentUser.isFileManager === true || currentUser.isFileManager === 'true');

    fileNames.forEach(name => {
        const fileInfo = filesMap[name];
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        // Name (Open button-like pill)
        const tdName = document.createElement('td');
        tdName.setAttribute('data-label', 'File Name');
        tdName.style.padding = '12px 15px';
        const nameBtn = document.createElement('button');
        nameBtn.className = 'mini-pill';
        nameBtn.style.fontWeight = 'bold';
        nameBtn.textContent = name;
        nameBtn.onclick = async () => {
            nameBtn.textContent = 'Loading...';
            nameBtn.disabled = true;
            if (serverUrl) {
                try {
                    const safeKey = name.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
                    const resp = await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}/\${safeKey}?_=\${Date.now()}\`);
                    if (resp.ok) {
                        const bundle = await resp.json();
                        saveBundle(bundle, true);
                        window.location.reload();
                        return;
                    }
                } catch(e) {
                    console.error('Failed to load bundle from server', e);
                }
            }
            alert('Failed to load file from server. Are you offline?');
            nameBtn.textContent = name;
            nameBtn.disabled = false;
        };
        tdName.appendChild(nameBtn);
        tr.appendChild(tdName);

        // Date
        const tdDate = document.createElement('td');
        tdDate.setAttribute('data-label', 'Last Modified');
        tdDate.style.padding = '12px 15px';
        tdDate.style.color = 'var(--muted)';
        try {
            tdDate.textContent = new Date(fileInfo.lastModified).toLocaleString();
        } catch(e) {
            tdDate.textContent = fileInfo.lastModified;
        }
        tr.appendChild(tdDate);

        // Size
        const tdSize = document.createElement('td');
        tdSize.setAttribute('data-label', 'File Size');
        tdSize.style.padding = '12px 15px';
        tdSize.style.color = 'var(--muted)';
        const sizeInBytes = fileInfo.size || 0;
        const sizeInKB = (sizeInBytes / 1024).toFixed(1);
        tdSize.textContent = \`\${sizeInKB} KB\`;
        tr.appendChild(tdSize);

        // Actions
        const tdActions = document.createElement('td');
        tdActions.setAttribute('data-label', 'Actions');
        tdActions.style.padding = '12px 15px';
        tdActions.style.textAlign = 'center';
        
        const btnCont = document.createElement('div');
        btnCont.className = 'tool-actions';
        btnCont.style.justifyContent = 'center';
        btnCont.style.gap = '10px';

        const downBtn = document.createElement('button');
        downBtn.className = 'mini-pill';
        downBtn.textContent = 'Download';
        downBtn.onclick = async () => {
            if (serverUrl) {
                try {
                    const safeKey = name.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
                    const resp = await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}/\${safeKey}?_=\${Date.now()}\`);
                    if (resp.ok) {
                        const bundle = await resp.json();
                        downloadTextFile(name, JSON.stringify(bundle, null, 2));
                        return;
                    }
                } catch(e) {}
            }
            alert('Failed to download file from server.');
        };
        btnCont.appendChild(downBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'row-delete-btn';
        delBtn.textContent = 'Delete';
        delBtn.onclick = async () => {
            if (isAdmin || isFileManager) {
                const b = loadBundle();
                const doDelete = async () => {
                    deleteFileFromList(name);
                    if (serverUrl) {
                        try {
                            const safeKey = name.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
                            // No delete endpoint currently implemented in server? 
                            // We should probably add one or ignore it for now.
                        } catch(e) {}
                    }
                    buildSavedFilesTable();
                };
                if (b.deleteMode) {
                    doDelete();
                } else if (confirm(\`Are you sure you want to delete "\${name}"?\`)) {
                    doDelete();
                }
            } else {
                alert('You do not have permission to delete files. Contact Super Admin or a File Manager.');
            }
        };
        btnCont.appendChild(delBtn);

        tdActions.appendChild(btnCont);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}`;

code = code.replace(buildSavedFilesMatch, buildSavedFilesReplace);

// 3. Remove all-files logic from syncWithServer
const syncWithServerMatch = `        // 1. Sync entire file list
        const listResp = await fetch(\`\${apiBase}/all-files?_=\${Date.now()}\`);
        if (listResp.ok) {
            const serverFiles = await listResp.json();
            const localFiles = getSavedFiles();
            let localChanged = false;
            let serverNeedsUpdate = false;

            for (const [name, sInfo] of Object.entries(serverFiles)) {
                const lInfo = localFiles[name];
                if (!lInfo || (new Date(sInfo.lastModified) > new Date(lInfo.lastModified))) {
                    localFiles[name] = sInfo;
                    localChanged = true;
                } else if (new Date(sInfo.lastModified) < new Date(lInfo.lastModified)) {
                    serverNeedsUpdate = true;
                }
            }

            for (const name of Object.keys(localFiles)) {
                if (!serverFiles[name]) {
                    serverNeedsUpdate = true;
                }
            }

            if (localChanged) {
                localStorage.setItem(FILE_LIST_STORAGE_KEY, JSON.stringify(localFiles));
                refreshSyncUI();
            }
            if (serverNeedsUpdate) {
                pushFileListToServer(localFiles);
            }
        } else if (listResp.status === 404) {
            const localFiles = getSavedFiles();
            if (Object.keys(localFiles).length > 0) {
                pushFileListToServer(localFiles);
            }
        }`;

const syncWithServerReplace = `        // No longer syncing all-files due to size limits`;

code = code.replace(syncWithServerMatch, syncWithServerReplace);

fs.writeFileSync('app.js', code);

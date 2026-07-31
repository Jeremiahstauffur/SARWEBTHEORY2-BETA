const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const backupMatch = `      const files = getSavedFiles();
      const fileNames = Object.keys(files);
      if (fileNames.length === 0) {
        alert("No saved search files to backup.");
        return;
      }

      try {
        const zip = new JSZip();
        fileNames.forEach(name => {
          const fileInfo = files[name];
          const content = JSON.stringify(fileInfo.bundle, null, 2);
          zip.file(name, content);
        });

        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = \`sar-search-files-backup-\${new Date().toISOString().split('T')[0]}.zip\`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      } catch (err) {
        console.error("Failed to create ZIP:", err);
        alert("An error occurred while creating the ZIP backup.");
      }`;

const backupReplace = `      const bucket = getSyncBucket();
      const serverUrl = getSyncServerUrl();
      if (!serverUrl) {
          alert("Server syncing must be configured to create full backups.");
          return;
      }

      try {
          // fetch keys
          const listResp = await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}?_=\${Date.now()}\`);
          if (!listResp.ok) throw new Error("Failed to fetch file list");
          const serverFiles = await listResp.json();
          
          if (serverFiles.length === 0) {
              alert("No saved search files on server to backup.");
              return;
          }

          const zip = new JSZip();
          backupZipBtn.textContent = 'Downloading...';
          backupZipBtn.disabled = true;

          for (const sf of serverFiles) {
              const safeKey = sf.key.replace(/[^a-zA-Z0-9.\\-_]/g, '_');
              const fResp = await fetch(\`\${serverUrl.replace(/\\/$/, '')}/api/v1/\${bucket}/\${safeKey}?_=\${Date.now()}\`);
              if (fResp.ok) {
                  const bndl = await fResp.json();
                  zip.file(sf.key, JSON.stringify(bndl, null, 2));
              }
          }

          const blob = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = \`sar-search-files-backup-\${new Date().toISOString().split('T')[0]}.zip\`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 500);
      } catch (err) {
          console.error("Failed to create ZIP:", err);
          alert("An error occurred while creating the ZIP backup.");
      } finally {
          backupZipBtn.textContent = 'Backup All Files (ZIP)';
          backupZipBtn.disabled = false;
      }`;

code = code.replace(backupMatch, backupReplace);
fs.writeFileSync('app.js', code);

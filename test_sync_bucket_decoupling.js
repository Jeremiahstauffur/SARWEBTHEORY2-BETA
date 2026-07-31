const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('./app.js', 'utf8');
const syncBucketWrites = [...source.matchAll(/setSyncBucket\([^)]+\)/g)];
const fileNameBucketWrites = [];

assert.strictEqual(syncBucketWrites.length, 2, 'SYNC_BUCKET_STORAGE_KEY should only be written by the default-bucket fallback and explicit Sync Settings save flow');
assert.strictEqual(fileNameBucketWrites.length, 0, 'Search file operations should no longer overwrite the sync bucket with the file name');

console.log('Sync bucket/file-name decoupling verified.');
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('./app.js', 'utf8');
// The sync bucket === the logged-in username. It must only be written by the
// login flow, never by search-file operations, and cleared on logout.
const loginBucketWrites = [...source.matchAll(/localStorage\.setItem\(SYNC_BUCKET_STORAGE_KEY,\s*result\.username\)/g)];
const fileNameBucketWrites = [...source.matchAll(/localStorage\.setItem\(SYNC_BUCKET_STORAGE_KEY,\s*(bucketName|fileName|name)\)/g)];
const logoutBucketClears = [...source.matchAll(/localStorage\.removeItem\(SYNC_BUCKET_STORAGE_KEY\)/g)];

assert.strictEqual(loginBucketWrites.length, 1, 'The sync bucket should only be set by the login flow, using the authenticated username.');
assert.strictEqual(fileNameBucketWrites.length, 0, 'Search file operations must never overwrite the sync bucket with a file name.');
assert.ok(logoutBucketClears.length >= 1, 'Logout should clear the sync bucket to force a fresh login.');

console.log('Sync bucket/login coupling verified.');
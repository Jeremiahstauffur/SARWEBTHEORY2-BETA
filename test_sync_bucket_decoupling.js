const assert = require('assert');
const fs = require('fs');

// Design change (CASE # is now the primary concept):
//
// Earlier, the app kept the sync bucket DECOUPLED from the search-file name, so
// this test asserted setSyncBucket() was written in exactly two places. That
// invariant has been intentionally reversed: the CASE # a user picks now drives
// the internal sync bucket, and the bucket is a background detail that is never
// shown to the user. The assertions below verify the NEW coupled design instead
// of the obsolete decoupling rule.
const source = fs.readFileSync('./app.js', 'utf8');

// 1. The CASE # selection/creation/switch flows must be able to apply the chosen
//    case number to the internal sync bucket.
const syncBucketWrites = [...source.matchAll(/setSyncBucket\([^)]*\)/g)];
assert.ok(
    syncBucketWrites.length >= 1,
    'setSyncBucket must be used to apply the chosen CASE # to the internal sync bucket'
);

// 2. setSyncBucket must PERSIST the CASE # server-side (by saving server settings)
//    so a page reload can read the current CASE # back from the database instead
//    of losing it (this was the core data-loss bug).
assert.ok(
    /function setSyncBucket[\s\S]*?saveServerSettings\(/.test(source),
    'setSyncBucket must persist the CASE # via saveServerSettings so it survives a reload'
);

// 3. A helper must exist to convert an internal (per-user suffixed) bucket id back
//    to the clean CASE #, so the raw bucket is never shown to the user or fed back
//    into setSyncBucket().
assert.ok(
    /function bucketToCaseNumber\s*\(/.test(source),
    'bucketToCaseNumber helper must exist to keep the internal bucket suffix hidden'
);

console.log('CASE #/sync-bucket coupling verified.');

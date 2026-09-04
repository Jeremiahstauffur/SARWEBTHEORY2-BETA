// Row-level sync helpers shared by the website (app.js) and the sync server
// (sync-server.js).
//
// Several devices work on the same search file at the same time. Uploading the
// whole bundle on every save made the last writer win and wipe out whatever the
// other devices had just typed. Instead a device sends ONLY the rows it actually
// changed, and the server merges those rows into the stored bundle one at a
// time, so two devices editing at the same time never overwrite each other.
//
// A change is a path plus one of the following:
//   { path: ['pages','index','rows','4'], value: [...], previous: [...] }
//        one row was edited. `previous` is the row as this device last saw it,
//        so the receiver can (a) find the row again even if it moved, and
//        (b) copy over only the cells that actually changed - two devices
//        editing two cells of the SAME row both keep their entry.
//   { path: ['pages','page2'], append: [row, ...] }
//   { path: ['activityLog'], prepend: [entry, ...] }
//        rows were added at the end / front. Two devices adding a row at the
//        same time both keep theirs instead of fighting over one index.
//   { path: ['pages','page2','7'], deleted: true, previous: [...] }
//        a row (or key) was removed. For array rows the deletion is only
//        carried out on a row that still matches `previous`, never on a row
//        another device has since put in that position.
//   { path: ['pages','index','rows'], length: 12 }
//        legacy shrink/grow, still accepted from older clients.
// The diff deliberately stops at ROW granularity (one change per table row) so
// a single edited cell travels as its own row and nothing else.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SARSyncDelta = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // Recomputed on every save, so it must never travel as a change of its own.
    // _sectionUpdatedAt is server-side bookkeeping (see stampSections) that a
    // client never sends and never keeps.
    const IGNORED_ROOT_KEYS = ['lastModified', '_sectionUpdatedAt'];

    // Keys that must never be walked, so a hostile path cannot reach Object.prototype.
    const UNSAFE_KEYS = ['__proto__', 'prototype', 'constructor'];

    // Sections that can hold megabytes (base64 file contents, GeoJSON). They
    // are never echoed back with a row response and a page only polls for them
    // when it actually displays them.
    const HEAVY_KEYS = ['uploads', 'maps'];

    // A `previous` row larger than this travels as a fingerprint instead, so an
    // edit to an uploaded file's entry does not send its content twice.
    const MAX_PREVIOUS_CHARS = 32 * 1024;

    // Table pages whose rows live in one row-per-item structured table.
    const PAGE_TABLES = {
        index: 'regions',
        page2: 'segments',
        page3: 'personnel',
        page4: 'search_log'
    };

    // Top-level bundle arrays that are mirrored one row per item.
    const LIST_TABLES = {
        uploads: 'uploaded_files',
        maps: 'maps_settings',
        activityLog: 'activity_log'
    };

    // Top-level bundle keys that make up the single-record structured tables.
    const SINGLE_TABLE_KEYS = {
        profile: 'profile',
        theme: 'settings_page',
        showTips: 'settings_page',
        background: 'settings_page',
        deleteMode: 'settings_page',
        parCheckFrequency: 'settings_page',
        segmentColorScaleUsePsriMax: 'settings_page',
        segmentColorScaleLowColor: 'settings_page',
        segmentColorScaleMidColor: 'settings_page',
        segmentColorScaleHighColor: 'settings_page',
        segmentActiveSearchOpacityPercent: 'settings_page',
        segmentActiveSearchFillColor: 'settings_page',
        segmentActiveSearchBorderOpacityPercent: 'settings_page',
        segmentActiveSearchBorderColor: 'settings_page',
        segmentActiveSearchBorderWidth: 'settings_page'
    };

    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const isContainer = (value) => Array.isArray(value) || isPlainObject(value);
    const isIndex = (value) => /^\d+$/.test(String(value));
    const isSafeKey = (key) => UNSAFE_KEYS.indexOf(key) === -1;

    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

    function deepEqual(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) return false;
            }
            return true;
        }
        if (isPlainObject(a) && isPlainObject(b)) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            for (const key of keysA) {
                if (!hasOwn(b, key)) return false;
                if (!deepEqual(a[key], b[key])) return false;
            }
            return true;
        }
        return false;
    }

    // Small, fast fingerprint (FNV-1a) of a row, used in place of `previous`
    // when the row itself is too large to send twice.
    function hashValue(value) {
        const text = JSON.stringify(value === undefined ? null : value);
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return `${text.length}:${hash.toString(16)}`;
    }

    // Attach the identity of the row a change was made against.
    function withPrevious(change, previousValue) {
        if (previousValue === undefined) return change;
        const serialized = JSON.stringify(previousValue);
        if (serialized.length > MAX_PREVIOUS_CHARS) {
            change.previousHash = hashValue(previousValue);
        } else {
            change.previous = JSON.parse(serialized);
        }
        return change;
    }

    // How deep the diff walks. The goal is one change per ROW, never per cell
    // and never a whole page, so:
    //   pages -> page -> rows -> row   (Regions style: {headers, rows, ...})
    //   pages -> page -> row           (Segments/Personnel/Search Log: array of rows)
    //   uploads/maps/forms/... -> item  (one change per list entry)
    function shouldDescend(path, prevValue, nextValue) {
        if (!isContainer(prevValue) || !isContainer(nextValue)) return false;
        if (Array.isArray(prevValue) !== Array.isArray(nextValue)) return false;
        if (path.length === 0) return true;
        if (path[0] === 'pages') {
            if (path.length === 1 || path.length === 2) return true;
            if (path.length === 3) return path[2] === 'rows';
            return false;
        }
        return path.length <= 1;
    }

    function prefixEqual(prev, next) {
        for (let i = 0; i < prev.length; i++) {
            if (!deepEqual(prev[i], next[i])) return false;
        }
        return true;
    }

    function suffixEqual(prev, next) {
        const offset = next.length - prev.length;
        for (let i = 0; i < prev.length; i++) {
            if (!deepEqual(prev[i], next[i + offset])) return false;
        }
        return true;
    }

    // Which rows of `prev` were removed to arrive at `next`? Only answers when
    // `next` is exactly `prev` with some rows taken out; anything more involved
    // (rows edited AND removed in one save) returns null and falls back to the
    // legacy rewrite.
    function detectDeletions(prev, next) {
        const removed = [];
        let j = 0;
        for (let i = 0; i < prev.length; i++) {
            if (j < next.length && deepEqual(prev[i], next[j])) {
                j++;
            } else {
                removed.push(i);
            }
        }
        if (j !== next.length || removed.length !== prev.length - next.length) return null;
        return removed;
    }

    function diffArray(prevValue, nextValue, path, changes) {
        if (nextValue.length > prevValue.length) {
            const added = nextValue.length - prevValue.length;
            if (prefixEqual(prevValue, nextValue)) {
                changes.push({path: path.slice(), append: clone(nextValue.slice(prevValue.length))});
                return;
            }
            if (suffixEqual(prevValue, nextValue)) {
                changes.push({path: path.slice(), prepend: clone(nextValue.slice(0, added))});
                return;
            }
            // Rows were edited and rows were added at the end in one save.
            for (let i = 0; i < prevValue.length; i++) {
                diffNode(prevValue[i], nextValue[i], path.concat(String(i)), changes);
            }
            changes.push({path: path.slice(), append: clone(nextValue.slice(prevValue.length))});
            return;
        }

        if (nextValue.length < prevValue.length) {
            const removed = detectDeletions(prevValue, nextValue);
            if (removed) {
                // Highest index first so the remaining indexes stay valid while
                // the deletions are applied in order.
                removed.sort((a, b) => b - a).forEach((index) => {
                    changes.push(withPrevious({path: path.concat(String(index)), deleted: true}, prevValue[index]));
                });
                return;
            }
            // Legacy fallback: shrink first, then rewrite the survivors.
            changes.push({path: path.slice(), length: nextValue.length});
            for (let i = 0; i < nextValue.length; i++) {
                diffNode(prevValue[i], nextValue[i], path.concat(String(i)), changes);
            }
            return;
        }

        for (let i = 0; i < nextValue.length; i++) {
            diffNode(prevValue[i], nextValue[i], path.concat(String(i)), changes);
        }
    }

    function diffNode(prevValue, nextValue, path, changes) {
        if (deepEqual(prevValue, nextValue)) return;

        if (!shouldDescend(path, prevValue, nextValue)) {
            if (nextValue === undefined) {
                changes.push(withPrevious({path: path.slice(), deleted: true}, prevValue));
            } else {
                changes.push(withPrevious({path: path.slice(), value: clone(nextValue)}, prevValue));
            }
            return;
        }

        if (Array.isArray(nextValue)) {
            diffArray(prevValue, nextValue, path, changes);
            return;
        }

        const keys = Object.keys(prevValue).concat(Object.keys(nextValue));
        const seen = {};
        keys.forEach((key) => {
            if (seen[key]) return;
            seen[key] = true;
            if (!isSafeKey(key)) return;
            if (path.length === 0 && IGNORED_ROOT_KEYS.indexOf(key) !== -1) return;
            if (!hasOwn(nextValue, key)) {
                changes.push(withPrevious({path: path.concat(key), deleted: true}, prevValue[key]));
                return;
            }
            diffNode(prevValue[key], nextValue[key], path.concat(key), changes);
        });
    }

    // Compare the bundle as it was before a save against the bundle the device
    // just saved and return only the rows that differ.
    function computeBundleChanges(previousBundle, nextBundle) {
        const changes = [];
        if (!isPlainObject(nextBundle)) return changes;
        diffNode(isPlainObject(previousBundle) ? previousBundle : {}, nextBundle, [], changes);
        return changes;
    }

    function normalizePath(path) {
        if (!Array.isArray(path) || path.length === 0) return [];
        const out = [];
        for (const segment of path) {
            if (typeof segment !== 'string' && typeof segment !== 'number') return [];
            const key = String(segment);
            if (!key || !isSafeKey(key)) return [];
            out.push(key);
        }
        return out;
    }

    function samePath(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (String(a[i]) !== String(b[i])) return false;
        }
        return true;
    }

    const hasIdentity = (change) => hasOwn(change, 'previous') || typeof change.previousHash === 'string';

    function matchesPrevious(row, change) {
        if (row === undefined) return false;
        if (hasOwn(change, 'previous')) return deepEqual(row, change.previous);
        if (typeof change.previousHash === 'string') return hashValue(row) === change.previousHash;
        return false;
    }

    // Find the row a change refers to. The index the sender used is tried
    // first; when another device has since moved the rows around, the row is
    // looked up by its previous content instead. Returns -1 when the row no
    // longer exists anywhere.
    function locateRow(list, index, change) {
        const validIndex = Number.isInteger(index) && index >= 0 && index < list.length;
        if (!hasIdentity(change)) return validIndex ? index : -1;
        if (validIndex && matchesPrevious(list[index], change)) return index;
        for (let i = 0; i < list.length; i++) {
            if (matchesPrevious(list[i], change)) return i;
        }
        return -1;
    }

    // Combine an edited row with the row currently stored. Only the cells (or
    // keys) that differ between `previous` and `value` are copied over, so a
    // cell another device changed in the meantime survives.
    function mergeRowValue(current, change) {
        const next = change.value;
        if (!hasOwn(change, 'previous')) return clone(next);
        const previous = change.previous;
        if (!isContainer(current) || !isContainer(next) || !isContainer(previous)) return clone(next);
        if (Array.isArray(next) !== Array.isArray(previous) || Array.isArray(next) !== Array.isArray(current)) {
            return clone(next);
        }
        if (deepEqual(current, previous)) return clone(next);

        if (Array.isArray(next)) {
            // A row that changed its number of cells was restructured; there is
            // no meaningful cell-by-cell merge for that.
            if (next.length !== previous.length) return clone(next);
            const result = current.slice();
            for (let i = 0; i < next.length; i++) {
                // Cells the stored row never had are taken from the sender.
                if (result[i] === undefined || !deepEqual(next[i], previous[i])) result[i] = clone(next[i]);
            }
            return result;
        }

        const result = {};
        Object.keys(current).forEach((key) => {
            if (isSafeKey(key)) result[key] = current[key];
        });
        const keys = Object.keys(previous).concat(Object.keys(next));
        const seen = {};
        keys.forEach((key) => {
            if (seen[key] || !isSafeKey(key)) return;
            seen[key] = true;
            if (!hasOwn(next, key)) {
                delete result[key];
            } else if (!deepEqual(next[key], previous[key])) {
                result[key] = clone(next[key]);
            }
        });
        return result;
    }

    function applyChange(bundle, change) {
        const path = normalizePath(change && change.path);
        if (!path.length) return false;

        let node = bundle;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!isContainer(node[key])) {
                node[key] = isIndex(path[i + 1]) ? [] : {};
            }
            node = node[key];
        }

        const last = path[path.length - 1];

        if (change.deleted === true) {
            if (Array.isArray(node)) {
                const index = locateRow(node, Number(last), change);
                // The row is already gone (or another device replaced it):
                // nothing to delete, and never delete somebody else's row.
                if (index === -1) return false;
                node.splice(index, 1);
            } else {
                delete node[last];
            }
            return true;
        }

        if (Array.isArray(change.append) || Array.isArray(change.prepend)) {
            if (!Array.isArray(node[last])) node[last] = [];
            const list = node[last];
            if (Array.isArray(change.append)) {
                change.append.forEach((item) => list.push(clone(item)));
            }
            if (Array.isArray(change.prepend)) {
                list.unshift(...change.prepend.map((item) => clone(item)));
            }
            return true;
        }

        if (typeof change.length === 'number' && Number.isFinite(change.length)) {
            const length = Math.max(0, Math.floor(change.length));
            if (!Array.isArray(node[last])) node[last] = [];
            const list = node[last];
            if (length < list.length) {
                list.length = length;
            } else {
                while (list.length < length) list.push(null);
            }
            return true;
        }

        if (!hasOwn(change, 'value')) return false;

        if (Array.isArray(node)) {
            const index = Number(last);
            if (!Number.isInteger(index) || index < 0) return false;
            const located = locateRow(node, index, change);
            // Not found anywhere: the row was edited concurrently, so merge
            // cell-by-cell into whatever now sits at the sender's index.
            const target = located === -1 ? index : located;
            node[target] = mergeRowValue(node[target], change);
            for (let i = 0; i < node.length; i++) {
                if (node[i] === undefined) node[i] = null;
            }
            // Remember where the row really landed so the structured-table
            // mirror rewrites that one row and not the sender's index.
            change.appliedIndex = target;
            return true;
        }

        node[last] = mergeRowValue(node[last], change);
        return true;
    }

    // Apply the received row changes onto the stored bundle in place and report
    // which ones actually landed, so the caller can mirror exactly those rows
    // into the structured tables.
    function applyBundleChanges(bundle, changes) {
        const target = isPlainObject(bundle) ? bundle : {};
        const applied = [];
        (Array.isArray(changes) ? changes : []).forEach((change) => {
            if (applyChange(target, change)) applied.push(change);
        });
        return {bundle: target, applied};
    }

    // Fold a new change into a pending list. Consecutive edits to the same row
    // (cell after cell, before the device managed to upload) collapse into one
    // change that keeps the earliest `previous` and the latest `value`; an edit
    // that is reverted before upload disappears entirely.
    function coalesceChange(list, change) {
        const out = Array.isArray(list) ? list : [];
        const isRowWrite = (c) => c && hasOwn(c, 'value') && c.deleted !== true
            && !Array.isArray(c.append) && !Array.isArray(c.prepend) && typeof c.length !== 'number';
        const previousChange = out.length ? out[out.length - 1] : null;
        if (previousChange && isRowWrite(previousChange) && isRowWrite(change) && samePath(previousChange.path, change.path)) {
            const merged = {path: previousChange.path.slice(), value: clone(change.value)};
            if (hasOwn(previousChange, 'previous')) merged.previous = previousChange.previous;
            else if (typeof previousChange.previousHash === 'string') merged.previousHash = previousChange.previousHash;
            out.pop();
            if (hasOwn(merged, 'previous') && deepEqual(merged.previous, merged.value)) return out;
            out.push(merged);
            return out;
        }
        out.push(change);
        return out;
    }

    // Work out which structured table (and which row of it) a change touches so
    // the server can write that single row instead of rebuilding every table.
    //   collectionRow     - one row of a row-per-item table
    //   collectionRebuild - that one table has to be rewritten (rows shifted)
    //   single            - one of the single-record tables
    //   rebuild           - not mappable; rebuild everything for this case
    function describeChangeTarget(change) {
        const path = normalizePath(change && change.path);
        if (!path.length) return {kind: 'rebuild'};

        const isRowWrite = !change.deleted && typeof change.length !== 'number'
            && !Array.isArray(change.append) && !Array.isArray(change.prepend);

        // A row write may have landed at another index than the sender used
        // (see applyChange); that index is the one mirrored.
        const landedIndex = (rowIndex) => Number.isInteger(change.appliedIndex) ? change.appliedIndex : Number(rowIndex);

        if (path[0] === 'pages') {
            const table = PAGE_TABLES[path[1]];
            if (!table) return {kind: 'rebuild'};
            // pages.<page>.rows.<i>  or  pages.<page>.<i>
            const rowIndex = (path.length === 4 && path[2] === 'rows') ? path[3]
                : (path.length === 3 && isIndex(path[2]) ? path[2] : null);
            if (rowIndex !== null && isRowWrite) {
                return {kind: 'collectionRow', table, rowIndex: landedIndex(rowIndex)};
            }
            return {kind: 'collectionRebuild', table};
        }

        if (LIST_TABLES[path[0]]) {
            const table = LIST_TABLES[path[0]];
            if (path.length === 2 && isIndex(path[1]) && isRowWrite) {
                return {kind: 'collectionRow', table, rowIndex: landedIndex(path[1])};
            }
            return {kind: 'collectionRebuild', table};
        }

        if (path[0] === 'forms') {
            return {kind: 'collectionRebuild', table: 'forms'};
        }

        if (SINGLE_TABLE_KEYS[path[0]]) {
            return {kind: 'single', table: SINGLE_TABLE_KEYS[path[0]]};
        }

        // Anything else (fileName, accounts, team statuses, ...) is not mirrored
        // into a structured table; the bundle blob already holds it.
        return {kind: 'none'};
    }

    // Which parts of the bundle a list of changes touched: top-level keys plus
    // the individual pages. `allPages` is set when the whole pages object was
    // replaced.
    function collectTouchedSections(changes) {
        const keys = new Set();
        const pages = new Set();
        let allPages = false;
        (Array.isArray(changes) ? changes : []).forEach((change) => {
            const path = normalizePath(change && change.path);
            if (!path.length) return;
            if (path[0] === 'pages') {
                if (path.length === 1) allPages = true;
                else pages.add(path[1]);
                return;
            }
            keys.add(path[0]);
        });
        return {keys, pages, allPages};
    }

    // Read a single page out of a bundle without copying the rest of it.
    function getPageData(bundle, pageKey) {
        if (!isPlainObject(bundle) || !isPlainObject(bundle.pages)) return undefined;
        const key = String(pageKey || '');
        if (!key || !isSafeKey(key)) return undefined;
        if (!hasOwn(bundle.pages, key)) return undefined;
        return bundle.pages[key];
    }

    // Copy out part of a bundle: only the listed top-level keys / pages (null
    // for "all"), minus the `skip` keys. Used to answer a state poll with just
    // the sections a page needs and to echo touched sections after a write.
    function pickBundleSections(bundle, options = {}) {
        if (!isPlainObject(bundle)) return {};
        const skip = new Set(Array.isArray(options.skip) ? options.skip : []);
        const keys = Array.isArray(options.keys) ? new Set(options.keys) : null;
        const pages = Array.isArray(options.pages) ? new Set(options.pages) : null;
        const out = {};
        Object.keys(bundle).forEach((key) => {
            if (!isSafeKey(key) || skip.has(key) || key === '_sectionUpdatedAt') return;
            if (key === 'pages') {
                if (!isPlainObject(bundle.pages)) return;
                if (keys && !keys.has('pages') && !pages) return;
                const picked = {};
                let any = false;
                Object.keys(bundle.pages).forEach((pageKey) => {
                    if (!isSafeKey(pageKey)) return;
                    if (pages && !pages.has(pageKey)) return;
                    picked[pageKey] = bundle.pages[pageKey];
                    any = true;
                });
                if (any || !pages) out.pages = picked;
                return;
            }
            if (keys && !keys.has(key)) return;
            out[key] = bundle[key];
        });
        return out;
    }

    // Overlay the sections a server response carried onto a local bundle. Keys
    // (and pages) absent from `sections` were not sent and keep their local
    // value. Returns a new object; neither input is modified.
    function mergeServerSections(localBundle, sections) {
        const base = isPlainObject(localBundle) ? localBundle : {};
        const out = {};
        Object.keys(base).forEach((key) => {
            if (isSafeKey(key)) out[key] = base[key];
        });
        if (!isPlainObject(sections)) return out;
        Object.keys(sections).forEach((key) => {
            if (!isSafeKey(key)) return;
            if (key === 'pages') {
                const pages = {};
                const localPages = isPlainObject(base.pages) ? base.pages : {};
                Object.keys(localPages).forEach((pageKey) => {
                    if (isSafeKey(pageKey)) pages[pageKey] = localPages[pageKey];
                });
                if (isPlainObject(sections.pages)) {
                    Object.keys(sections.pages).forEach((pageKey) => {
                        if (isSafeKey(pageKey)) pages[pageKey] = sections.pages[pageKey];
                    });
                }
                out.pages = pages;
                return;
            }
            out[key] = sections[key];
        });
        return out;
    }

    // Server-side bookkeeping: remember when each section (top-level key or
    // "pages.<page>") last changed, so a poll can be answered with only the
    // sections that moved since the caller last looked.
    function stampSections(bundle, touched, nowIso) {
        if (!isPlainObject(bundle)) return bundle;
        if (!isPlainObject(bundle._sectionUpdatedAt)) bundle._sectionUpdatedAt = {};
        const stamps = bundle._sectionUpdatedAt;
        if (!touched) {
            Object.keys(bundle).forEach((key) => {
                if (key === '_sectionUpdatedAt' || key === 'pages' || !isSafeKey(key)) return;
                stamps[key] = nowIso;
            });
            if (isPlainObject(bundle.pages)) {
                Object.keys(bundle.pages).forEach((pageKey) => {
                    if (isSafeKey(pageKey)) stamps[`pages.${pageKey}`] = nowIso;
                });
            }
            return bundle;
        }
        (touched.keys || []).forEach((key) => {
            if (key !== 'pages' && isSafeKey(key)) stamps[key] = nowIso;
        });
        if (touched.allPages && isPlainObject(bundle.pages)) {
            Object.keys(bundle.pages).forEach((pageKey) => {
                if (isSafeKey(pageKey)) stamps[`pages.${pageKey}`] = nowIso;
            });
        }
        (touched.pages || []).forEach((pageKey) => {
            if (isSafeKey(pageKey)) stamps[`pages.${pageKey}`] = nowIso;
        });
        return bundle;
    }

    // The sections of a stored bundle that changed at or after `since`. Without
    // stamps (a bundle written by an older server) everything is returned.
    function sectionsChangedSince(bundle, since) {
        if (!isPlainObject(bundle)) return {keys: null, pages: null};
        const stamps = isPlainObject(bundle._sectionUpdatedAt) ? bundle._sectionUpdatedAt : null;
        if (!since || !stamps) return {keys: null, pages: null};
        const keys = [];
        const pages = [];
        Object.keys(bundle).forEach((key) => {
            if (key === '_sectionUpdatedAt' || key === 'pages' || !isSafeKey(key)) return;
            if (!stamps[key] || stamps[key] >= since) keys.push(key);
        });
        if (isPlainObject(bundle.pages)) {
            Object.keys(bundle.pages).forEach((pageKey) => {
                if (!isSafeKey(pageKey)) return;
                const stamp = stamps[`pages.${pageKey}`];
                if (!stamp || stamp >= since) pages.push(pageKey);
            });
        }
        return {keys, pages};
    }

    return {
        computeBundleChanges,
        applyBundleChanges,
        applyChange,
        coalesceChange,
        describeChangeTarget,
        collectTouchedSections,
        getPageData,
        pickBundleSections,
        mergeServerSections,
        stampSections,
        sectionsChangedSince,
        hashValue,
        deepEqual,
        normalizePath,
        PAGE_TABLES,
        LIST_TABLES,
        SINGLE_TABLE_KEYS,
        HEAVY_KEYS
    };
});

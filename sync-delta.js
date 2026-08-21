// Row-level sync helpers shared by the website (app.js) and the sync server
// (sync-server.js).
//
// Several devices work on the same search file at the same time. Uploading the
// whole bundle on every save made the last writer win and wipe out whatever the
// other devices had just typed. Instead a device now sends ONLY the rows it
// actually changed, and the server applies those rows onto the stored bundle one
// at a time, so two devices editing two different rows never overwrite each
// other.
//
// A change is a path/value pair, e.g.
//   { path: ['pages', 'index', 'rows', '4'], value: ['North Ridge', '40', '40'] }
//   { path: ['pages', 'page2', '7'], deleted: true }
//   { path: ['pages', 'index', 'rows'], length: 12 }
// The diff below deliberately stops at ROW granularity (one change per table
// row) so a single edited cell travels as its own row and nothing else.
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
    const IGNORED_ROOT_KEYS = ['lastModified'];

    // Keys that must never be walked, so a hostile path cannot reach Object.prototype.
    const UNSAFE_KEYS = ['__proto__', 'prototype', 'constructor'];

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
        segmentActiveSearchOpacityPercent: 'settings_page'
    };

    const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const isContainer = (value) => Array.isArray(value) || isPlainObject(value);
    const isIndex = (value) => /^\d+$/.test(String(value));

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
                if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
                if (!deepEqual(a[key], b[key])) return false;
            }
            return true;
        }
        return false;
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

    function diffNode(prevValue, nextValue, path, changes) {
        if (deepEqual(prevValue, nextValue)) return;

        if (!shouldDescend(path, prevValue, nextValue)) {
            if (nextValue === undefined) {
                changes.push({path: path.slice(), deleted: true});
            } else {
                changes.push({path: path.slice(), value: clone(nextValue)});
            }
            return;
        }

        if (Array.isArray(nextValue)) {
            // Emit the new length first so applying the changes in order can
            // shrink the array before the surviving rows are written.
            if (nextValue.length !== prevValue.length) {
                changes.push({path: path.slice(), length: nextValue.length});
            }
            for (let i = 0; i < nextValue.length; i++) {
                diffNode(prevValue[i], nextValue[i], path.concat(String(i)), changes);
            }
            return;
        }

        const keys = Object.keys(prevValue).concat(Object.keys(nextValue));
        const seen = {};
        keys.forEach((key) => {
            if (seen[key]) return;
            seen[key] = true;
            if (UNSAFE_KEYS.indexOf(key) !== -1) return;
            if (path.length === 0 && IGNORED_ROOT_KEYS.indexOf(key) !== -1) return;
            if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
                changes.push({path: path.concat(key), deleted: true});
                return;
            }
            diffNode(prevValue[key], nextValue[key], path.concat(key), changes);
        });
    }

    // Compare the bundle the server is known to hold against the bundle the
    // device just saved and return only the rows that differ.
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
            if (!key || UNSAFE_KEYS.indexOf(key) !== -1) return [];
            out.push(key);
        }
        return out;
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
                const index = Number(last);
                if (Number.isInteger(index) && index >= 0 && index < node.length) {
                    node.splice(index, 1);
                }
            } else {
                delete node[last];
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

        if (!change || !Object.prototype.hasOwnProperty.call(change, 'value')) return false;
        node[last] = clone(change.value);
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

    // Work out which structured table (and which row of it) a change touches so
    // the server can write that single row instead of rebuilding every table.
    //   collectionRow     - one row of a row-per-item table
    //   collectionRebuild - that one table has to be rewritten (rows shifted)
    //   single            - one of the single-record tables
    //   rebuild           - not mappable; rebuild everything for this case
    function describeChangeTarget(change) {
        const path = normalizePath(change && change.path);
        if (!path.length) return {kind: 'rebuild'};

        const isRowWrite = !change.deleted && typeof change.length !== 'number';

        if (path[0] === 'pages') {
            const table = PAGE_TABLES[path[1]];
            if (!table) return {kind: 'rebuild'};
            // pages.<page>.rows.<i>  or  pages.<page>.<i>
            const rowIndex = (path.length === 4 && path[2] === 'rows') ? path[3]
                : (path.length === 3 && isIndex(path[2]) ? path[2] : null);
            if (rowIndex !== null && isRowWrite) {
                return {kind: 'collectionRow', table, rowIndex: Number(rowIndex)};
            }
            return {kind: 'collectionRebuild', table};
        }

        if (LIST_TABLES[path[0]]) {
            const table = LIST_TABLES[path[0]];
            if (path.length === 2 && isIndex(path[1]) && isRowWrite) {
                return {kind: 'collectionRow', table, rowIndex: Number(path[1])};
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

    // Read a single page out of a bundle without copying the rest of it.
    function getPageData(bundle, pageKey) {
        if (!isPlainObject(bundle) || !isPlainObject(bundle.pages)) return undefined;
        const key = String(pageKey || '');
        if (!key || UNSAFE_KEYS.indexOf(key) !== -1) return undefined;
        if (!Object.prototype.hasOwnProperty.call(bundle.pages, key)) return undefined;
        return bundle.pages[key];
    }

    return {
        computeBundleChanges,
        applyBundleChanges,
        applyChange,
        describeChangeTarget,
        getPageData,
        deepEqual,
        normalizePath,
        PAGE_TABLES,
        LIST_TABLES,
        SINGLE_TABLE_KEYS
    };
});

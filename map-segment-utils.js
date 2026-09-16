(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SARMapSegmentUtils = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    function getFeatureTypeKey(feature) {
        const attrs = feature?.attributes || feature?.properties || {};
        const geomType = (feature?.geometry && feature?.geometry.type) || attrs.class || attrs.type || '';
        
        if (attrs.class === 'Assignment' || attrs.type === 'Assignment' || attrs.assignment || geomType === 'Assignment' || geomType === 'Polygon' || geomType === 'GeometryCollection' || geomType === 'Shape') {
            return 'assignment';
        }
        if (geomType === 'LineString' || geomType === 'Polyline' || geomType === 'Line' || geomType === 'Route' || geomType === 'Track') {
            return 'route';
        }
        if (geomType === 'Point' || geomType === 'Marker') {
            return 'marker';
        }
        return 'other';
    }

    function getCalTopoApiObjectType(feature) {
        const attrs = feature?.attributes || feature?.properties || {};
        const geom = feature?.geometry || {};
        const rawClass = attrs.class || attrs.type || geom.class || geom.type || '';
        if (typeof rawClass === 'string' && rawClass) {
            const lower = rawClass.toLowerCase();
            if (lower === 'assignment') return 'Assignment';
            if (lower === 'shape') return 'Shape';
            if (lower === 'marker') return 'Marker';
            if (lower === 'folder') return 'Folder';
        }
        if (attrs.assignment || rawClass === 'Assignment') {
            return 'Assignment';
        }
        if (attrs.class === 'Shape') {
            return 'Shape';
        }
        return 'Assignment';
    }

    function captureCalTopoFeatureStyle(attributes = {}) {
        return {
            color: Object.prototype.hasOwnProperty.call(attributes, 'color') ? attributes.color : null,
            stroke: Object.prototype.hasOwnProperty.call(attributes, 'stroke') ? attributes.stroke : null,
            fill: Object.prototype.hasOwnProperty.call(attributes, 'fill') ? attributes.fill : null,
            'fill-opacity': Object.prototype.hasOwnProperty.call(attributes, 'fill-opacity') ? attributes['fill-opacity'] : null,
            opacity: Object.prototype.hasOwnProperty.call(attributes, 'opacity') ? attributes.opacity : null,
            'stroke-opacity': Object.prototype.hasOwnProperty.call(attributes, 'stroke-opacity') ? attributes['stroke-opacity'] : null,
            'stroke-width': Object.prototype.hasOwnProperty.call(attributes, 'stroke-width') ? attributes['stroke-width'] : null
        };
    }

    function applyCapturedCalTopoFeatureStyle(attributes, style = {}) {
        ['color', 'stroke', 'fill', 'fill-opacity', 'opacity', 'stroke-opacity', 'stroke-width'].forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(style, key)) {
                return;
            }
            const value = style[key];
            if (value === null || value === undefined || value === '') {
                delete attributes[key];
            } else {
                attributes[key] = value;
            }
        });
    }

    function cloneIfValidGeoJsonGeometry(geometry) {
        if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
            return null;
        }

        const type = typeof geometry.type === 'string' ? geometry.type.trim() : '';
        if (!type) {
            return null;
        }

        const hasCoordinates = Object.prototype.hasOwnProperty.call(geometry, 'coordinates');
        const hasGeometries = type === 'GeometryCollection' && Array.isArray(geometry.geometries);
        if (!hasCoordinates && !hasGeometries) {
            return null;
        }

        try {
            return JSON.parse(JSON.stringify(geometry));
        } catch (error) {
            return null;
        }
    }

    function buildCalTopoFeatureUpdatePayload(feature, styleOverrides = {}) {
        const attributes = {...(feature?.attributes || feature?.properties || {})};
        const geometry = cloneIfValidGeoJsonGeometry(feature?.geometry);

        delete attributes.ObjectID;
        delete attributes.id;

        applyCapturedCalTopoFeatureStyle(attributes, styleOverrides);

        const payload = {
            id: feature?.attributes?.id || feature?.id || null,
            type: 'Feature',
            properties: attributes
        };

        if (geometry) {
            payload.geometry = geometry;
        }

        return payload;
    }

    function getFeatureTypeLabel(feature) {
        const key = getFeatureTypeKey(feature);
        if (key === 'assignment') return 'Assignment';
        if (key === 'route') return 'Route';
        if (key === 'marker') return 'Marker';
        return 'Graphic';
    }

    // ------------------------------------------------------------------
    // Feature categories for the "which map features do I want to know
    // about" toggles below the map. Unlike getFeatureTypeKey (which lumps
    // every polygon in with assignments for import purposes) this tells a
    // CalTopo Assignment apart from a plain Shape, so each can be switched
    // on or off separately.
    // ------------------------------------------------------------------

    const FEATURE_CATEGORIES = [
        {key: 'marker', label: 'Markers', singular: 'Marker'},
        {key: 'shape', label: 'Shapes', singular: 'Shape'},
        {key: 'assignment', label: 'Assignments', singular: 'Assignment'},
        {key: 'route', label: 'Routes', singular: 'Route'},
        {key: 'other', label: 'Other', singular: 'Other'}
    ];

    function getFeatureCategoryKey(feature) {
        const attrs = feature?.attributes || feature?.properties || {};
        const rawClass = String(attrs.class || '').trim().toLowerCase();
        const rawType = String(attrs.type || '').trim().toLowerCase();
        const geomType = String((feature?.geometry && feature.geometry.type) || '').trim().toLowerCase();
        const classOrType = rawClass || (rawType !== 'feature' ? rawType : '');

        if (classOrType === 'assignment' || attrs.assignment) return 'assignment';
        if (classOrType === 'marker' || geomType === 'point' || geomType === 'multipoint') return 'marker';
        if (classOrType === 'route' || classOrType === 'track' || classOrType === 'line' || classOrType === 'polyline'
            || geomType === 'linestring' || geomType === 'multilinestring' || geomType === 'polyline' || geomType === 'line') {
            return 'route';
        }
        if (classOrType === 'shape' || classOrType === 'polygon' || classOrType === 'area'
            || geomType === 'polygon' || geomType === 'multipolygon' || geomType === 'geometrycollection') {
            return 'shape';
        }
        return 'other';
    }

    function getFeatureCategoryLabel(feature) {
        const key = getFeatureCategoryKey(feature);
        const category = FEATURE_CATEGORIES.find(entry => entry.key === key);
        return category ? category.singular : 'Other';
    }

    // {marker: true, shape: true, ...}: a category that is missing (or not a
    // boolean) is ON, so a file saved before the toggles existed shows everything.
    function normalizeFeatureTypeFilters(value) {
        const source = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
        const result = {};
        FEATURE_CATEGORIES.forEach(category => {
            result[category.key] = source[category.key] !== false;
        });
        return result;
    }

    function isFeatureCategoryEnabled(feature, filters) {
        return normalizeFeatureTypeFilters(filters)[getFeatureCategoryKey(feature)] !== false;
    }

    function normalizeSegmentName(value) {
        return String(value || '').trim().toLowerCase();
    }

    function formatSegmentAssignmentLabel(region, segment) {
        const trimmedSegment = String(segment || '').trim();
        const trimmedRegion = String(region || '').trim();
        if (!trimmedSegment) return '';
        return trimmedRegion ? `${trimmedRegion} - ${trimmedSegment}` : trimmedSegment;
    }

    function parseNumericCell(cell) {
        const match = String(cell || '').match(/[\d.]+/);
        if (!match) return null;
        const value = parseFloat(match[0]);
        return isNaN(value) ? null : value;
    }

    function buildSegmentPsrcLookup(rows, options = {}) {
        const values = new Map();
        let maxPsrc = 0;
        let maxPsri = 0;

        if (!rows || rows.length === 0) {
            return { values, maxValue: 0, maxPsrc: 0, maxPsri: 0 };
        }

        // Detect if first row is headers
        const firstRow = rows[0].map(h => String(h || '').trim().toLowerCase());
        let regionIdx = firstRow.indexOf('region');
        let segmentIdx = firstRow.findIndex(h => h.startsWith('segment'));
        let psrcIdx = firstRow.findIndex(h => h === 'psrc' || h.startsWith('psrc'));
        let psriIdx = firstRow.findIndex(h => h === 'psri' || h.startsWith('psri'));
        let caltopoIdx = firstRow.indexOf('caltopo');

        let startRow = 0;
        if (regionIdx !== -1 || segmentIdx !== -1 || psrcIdx !== -1 || psriIdx !== -1) {
            // It has headers
            startRow = 1;
        } else {
            // Hardcoded indices for our app's internal storage (page2)
            regionIdx = 0;
            segmentIdx = 1;
            psriIdx = 6;
            psrcIdx = 7;
            caltopoIdx = 9;
            startRow = 0;
        }

        for (let i = startRow; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[segmentIdx]) continue;

            const region = regionIdx !== -1 ? row[regionIdx] : '';
            const segment = row[segmentIdx];
            const psrc = parseNumericCell(psrcIdx !== -1 ? row[psrcIdx] : '');
            const psri = psriIdx !== -1 ? parseNumericCell(row[psriIdx]) : null;
            const caltopoId = caltopoIdx !== -1 ? String(row[caltopoIdx] || '').trim() : '';

            // Track the highest PSRi across the page even when a segment has no PSRc yet,
            // so the "scale max uses highest PSRi" option always has the true maximum.
            if (psri !== null && psri > maxPsri) maxPsri = psri;

            if (psrc === null) continue;

            const label = formatSegmentAssignmentLabel(region, segment);
            const name = normalizeSegmentName(label);

            // Store by name(s)
            values.set(name, psrc);
            values.set(normalizeSegmentName(segment), psrc);

            // Store by CalTopo ID if available
            if (caltopoId) {
                values.set('id:' + caltopoId, psrc);
            }

            if (psrc > maxPsrc) maxPsrc = psrc;
        }

        // `maxValue` is retained (as the highest PSRc) for backward compatibility.
        return { values, maxValue: maxPsrc, maxPsrc, maxPsri };
    }

    function hexToRgb(hex) {
        const stripped = String(hex || '').replace(/^#/, '');
        const full = stripped.length === 3
            ? stripped.split('').map(char => char + char).join('')
            : stripped;
        return [
            parseInt(full.substring(0, 2), 16),
            parseInt(full.substring(2, 4), 16),
            parseInt(full.substring(4, 6), 16)
        ];
    }

    function interpolateColor(color1, color2, factor) {
        const c1 = hexToRgb(color1);
        const c2 = hexToRgb(color2);
        const result = c1.map((c, i) => Math.round(c + factor * (c2[i] - c)));
        return '#' + result.map(c => c.toString(16).padStart(2, '0')).join('');
    }

    function getFeaturePsrcColor(feature, lookup, options = {}) {
        if (!feature || !lookup || !lookup.values) return null;
        
        const attrs = feature.attributes || feature.properties || {};
        const featureId = attrs.id;
        const featureName = normalizeSegmentName(attrs.name || attrs.label || attrs.title || attrs.id);
        
        let psrc = null;
        
        // Try ID match first
        if (featureId && lookup.values.has('id:' + featureId)) {
            psrc = lookup.values.get('id:' + featureId);
        } 
        // Fallback to name match
        else if (lookup.values.has(featureName)) {
            psrc = lookup.values.get(featureName);
        }
        
        if (psrc === null) return null;

        // The plotted value is always the segment's PSRc; the toggle only decides
        // whether the scale tops out at the highest PSRi or the highest PSRc on the
        // Segments page (see settings.html copy).
        const maxPsrc = Number.isFinite(lookup.maxPsrc) ? lookup.maxPsrc : lookup.maxValue;
        const maxPsri = Number.isFinite(lookup.maxPsri) ? lookup.maxPsri : 0;
        const max = options.usePsriMax
            ? (maxPsri > 0 ? maxPsri : maxPsrc)
            : maxPsrc;
        const ratio = max > 0 ? Math.min(1, Math.max(0, psrc / max)) : 0;

        const low = options.lowColor || '#40c057';
        const mid = options.midColor || '#ffd43b';
        const high = options.highColor || '#fa5252';

        let css;
        if (ratio < 0.5) {
            css = interpolateColor(low, mid, ratio * 2);
        } else {
            css = interpolateColor(mid, high, (ratio - 0.5) * 2);
        }

        return { css, value: psrc, ratio, rgb: hexToRgb(css) };
    }

    function getFeaturePsrcAssignmentStyle(feature, lookup, options = {}) {
        const color = getFeaturePsrcColor(feature, lookup, options);
        if (!color) return null;
        return {
            stroke: color.css,
            fill: color.css,
            color: color
        };
    }
    
    function filterSegmentImportsByType(items, typeKey) {
        if (!typeKey || typeKey === 'all') return items.slice();
        return items.filter(item => item.typeKey === typeKey);
    }

    // Planar shoelace area for one or more lon/lat rings, returned in acres.
    // Mirrors app.js `polygonArea`: robust to both closed (first vertex repeated
    // at the end) and open rings, and translates coordinates relative to the
    // ring's first vertex to avoid large-number floating-point cancellation.
    function polygonAreaAcres(rings) {
        if (!Array.isArray(rings)) return 0;
        let totalArea = 0;
        for (const ring of rings) {
            if (!ring || ring.length < 3) continue;
            const first = ring[0];
            const last = ring[ring.length - 1];
            const isClosed = first[0] === last[0] && first[1] === last[1];
            const n = isClosed ? ring.length - 1 : ring.length;
            if (n < 3) continue;
            const lonRef = first[0];
            const latRef = first[1];
            const k = Math.cos(latRef * Math.PI / 180);
            let area = 0;
            for (let i = 0; i < n; i++) {
                const p1 = ring[i];
                const p2 = ring[(i + 1) % n];
                const x1 = (p1[0] - lonRef) * k * 69.172;
                const y1 = (p1[1] - latRef) * 69.172;
                const x2 = (p2[0] - lonRef) * k * 69.172;
                const y2 = (p2[1] - latRef) * 69.172;
                area += (x1 * y2 - x2 * y1);
            }
            totalArea += Math.abs(area) / 2;
        }
        return totalArea * 640; // sq miles -> acres
    }
    
    function ensureSegmentsPageRows(bundle, defaultSegmentsData) {
        if (!bundle.pages) bundle.pages = {};
        if (Array.isArray(bundle.pages.page2)) return bundle.pages.page2;
        bundle.pages.page2 = defaultSegmentsData ? defaultSegmentsData() : [];
        return bundle.pages.page2;
    }

    // ------------------------------------------------------------------
    // Fetched-feature bookkeeping: sorting, searching, and telling which
    // CalTopo features are "accounted for" (already a segment or marked as
    // unwanted) versus still waiting to be imported.
    // ------------------------------------------------------------------

    function getFeatureDisplayName(feature) {
        const attrs = feature?.attributes || feature?.properties || {};
        const name = attrs.name || attrs.label || attrs.title || feature?.name || '';
        return String(name || '').trim() || 'Unnamed Graphic';
    }

    // Ids the app makes up for shapes CalTopo returned without one ("gfx-7")
    // only identify a feature within a single fetch, so they are never used to
    // match features across fetches.
    function isSyntheticFeatureId(featureId) {
        return /^gfx-\d+$/i.test(String(featureId || '').trim());
    }

    function getFeatureIdentity(feature) {
        const attrs = feature?.attributes || feature?.properties || {};
        const rawId = attrs.id !== undefined && attrs.id !== null ? attrs.id : feature?.id;
        const id = String(rawId === undefined || rawId === null ? '' : rawId).trim();
        return {
            id: id && !isSyntheticFeatureId(id) ? id : '',
            name: normalizeSegmentName(getFeatureDisplayName(feature))
        };
    }

    function getFeatureIdentityKey(feature) {
        const identity = getFeatureIdentity(feature);
        return identity.id ? `id:${identity.id}` : `name:${identity.name}`;
    }

    function compareFeatureNames(a, b) {
        return getFeatureDisplayName(a).localeCompare(getFeatureDisplayName(b), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    // Returns a new array sorted A-Z by display name; the input is not mutated.
    function sortFeaturesByName(features) {
        return (Array.isArray(features) ? features.slice() : []).sort(compareFeatureNames);
    }

    function filterFeaturesByName(features, query) {
        const list = Array.isArray(features) ? features : [];
        const needle = normalizeSegmentName(query);
        if (!needle) return list.slice();
        return list.filter(feature => normalizeSegmentName(getFeatureDisplayName(feature)).includes(needle));
    }

    function normalizeUnwantedEntry(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const id = String(entry.id || '').trim();
        const name = normalizeSegmentName(entry.name);
        if (!id && !name) return null;
        const normalized = {id: isSyntheticFeatureId(id) ? '' : id, name};
        if (entry.markedAt) normalized.markedAt = entry.markedAt;
        // Set when a feature-type toggle (not a person) hid the feature, so
        // turning that type back on can restore exactly those entries.
        if (typeof entry.filteredType === 'string' && entry.filteredType) normalized.filteredType = entry.filteredType;
        return normalized;
    }

    function normalizeUnwantedFeatureList(list) {
        return (Array.isArray(list) ? list : []).map(normalizeUnwantedEntry).filter(Boolean);
    }

    function buildUnwantedFeatureEntry(feature, markedAt, filteredType) {
        const identity = getFeatureIdentity(feature);
        const entry = {id: identity.id, name: identity.name};
        entry.markedAt = markedAt || new Date().toISOString();
        if (typeof filteredType === 'string' && filteredType) entry.filteredType = filteredType;
        return entry;
    }

    // A feature is unwanted when its CalTopo id was marked, or (for features
    // without a real id on either side) when its name was marked.
    function isFeatureUnwanted(feature, unwantedList) {
        const identity = getFeatureIdentity(feature);
        return normalizeUnwantedFeatureList(unwantedList).some(entry => {
            if (identity.id && entry.id) return identity.id === entry.id;
            return !!identity.name && identity.name === entry.name;
        });
    }

    // Segments page rows: [region, segment, area, length, sweep, time, psri, psrc, notes, caltopoId]
    function isFeatureImportedAsSegment(feature, segmentRows) {
        const identity = getFeatureIdentity(feature);
        return (Array.isArray(segmentRows) ? segmentRows : []).some(row => {
            if (!Array.isArray(row)) return false;
            const rowId = String(row[9] || '').trim();
            if (identity.id && rowId && identity.id === rowId) return true;
            const rowName = normalizeSegmentName(row[1]);
            return !!rowName && rowName === identity.name;
        });
    }

    // A fetched line that is already in the Searchers Tracks table (Search Log
    // page): the track that carries its CalTopo id, or - for a shape without a
    // real id - the track that was imported under the name CalTopo has for it.
    // A custom track (typed in, no shape) never matches.
    function isFeatureImportedAsTrack(feature, tracks) {
        const identity = getFeatureIdentity(feature);
        return normalizeSearcherTracks(tracks).some(track => {
            if (track.custom) return false;
            if (identity.id) return !!track.featureId && track.featureId === identity.id;
            return !track.featureId && !!identity.name && normalizeSegmentName(track.caltopoName) === identity.name;
        });
    }

    // Accounted for = imported somewhere: as a Segments row or (a line) as a
    // searcher track. `tracks` is the case's searcherTracks list.
    function isFeatureAccountedFor(feature, segmentRows, tracks = []) {
        return isFeatureImportedAsSegment(feature, segmentRows) || isFeatureImportedAsTrack(feature, tracks);
    }

    // Where a fetched feature can be imported: a CalTopo Assignment becomes a
    // Segments row ('segment'), a line - a recorded track or a drawn route -
    // becomes a Searchers Tracks row ('track'); markers, plain shapes and
    // everything else cannot be imported ('').
    function getFeatureImportTarget(feature) {
        const category = getFeatureCategoryKey(feature);
        if (category === 'assignment') return 'segment';
        if (category === 'route') return 'track';
        return '';
    }

    // Features that are neither imported (segment or track) nor marked
    // unwanted, sorted A-Z.
    function getUnaccountedFeatures(features, segmentRows, unwantedList, tracks = []) {
        const unwanted = normalizeUnwantedFeatureList(unwantedList);
        return sortFeaturesByName((Array.isArray(features) ? features : []).filter(feature =>
            !isFeatureAccountedFor(feature, segmentRows, tracks) && !isFeatureUnwanted(feature, unwanted)));
    }

    // Returns a new list with `features` added (no duplicates); the input list
    // is not mutated. `filteredType` tags the entries as hidden by that
    // feature-type toggle.
    function markFeaturesUnwanted(unwantedList, features, markedAt, filteredType) {
        const result = normalizeUnwantedFeatureList(unwantedList);
        (Array.isArray(features) ? features : []).forEach(feature => {
            if (isFeatureUnwanted(feature, result)) return;
            result.push(buildUnwantedFeatureEntry(feature, markedAt, filteredType));
        });
        return result;
    }

    // Returns a new list without the entries a feature-type toggle added for
    // `typeKey` (entries a person marked are kept).
    function unmarkFeaturesUnwantedByFilteredType(unwantedList, typeKey) {
        return normalizeUnwantedFeatureList(unwantedList).filter(entry => entry.filteredType !== typeKey);
    }

    // Returns a new list without the entries that match `features`.
    function unmarkFeaturesUnwanted(unwantedList, features) {
        const identities = (Array.isArray(features) ? features : []).map(getFeatureIdentity);
        return normalizeUnwantedFeatureList(unwantedList).filter(entry => !identities.some(identity => {
            if (identity.id && entry.id) return identity.id === entry.id;
            return !!identity.name && identity.name === entry.name;
        }));
    }

    // "Alpha, Bravo and 3 more are on the map but not imported as segments."
    function formatUnaccountedFeatureNotification(names, maxNames = 5) {
        const list = (Array.isArray(names) ? names : []).map(name => String(name || '').trim()).filter(Boolean);
        if (!list.length) return '';
        const shown = list.slice(0, Math.max(1, maxNames));
        const remaining = list.length - shown.length;
        let text = shown.length === 1
            ? shown[0]
            : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
        if (remaining > 0) {
            text = `${shown.join(', ')} and ${remaining} more`;
        }
        const verb = list.length === 1 ? 'is' : 'are';
        return `${text} ${verb} on the map but not imported as ${list.length === 1 ? 'a segment' : 'segments'}.`;
    }

    // ------------------------------------------------------------------
    // Lost Person Behavior (LPB).
    //
    // On the Incident page the planner switches on one or more lost-person
    // categories (grouped as External Forces, Water, Wheel/Motorized, Mental
    // State, Child, Outdoor Activity and Snow Activity), picks a terrain for
    // each and imports the IPP marker from the CalTopo map. Every category x
    // terrain carries four distances in miles (to a tenth): how far 25 / 50 /
    // 75 / 95 % of such subjects were found from the IPP.
    //
    // The maths turns those four points into a percentage PER MILE for each
    // bracket - what the category's probability gains per mile between the
    // previous bracket's distance and this one's: 25 % / d25 for the first
    // bracket, (50 - 25) % / (d50 - d25) for the second, and so on
    // (computeLpbBracketRates; with 25 % at 1.9 mi and 50 % at 11.8 mi the
    // rates are 13.16 %/mi and 25 % / 9.9 mi = 2.53 %/mi). A segment whose
    // centre lies within one of the distances falls into the smallest bracket
    // that still contains it, and that bracket's rate, taken as a share of the
    // segment's PSRi, is what the category ADDS to it: a segment in the 13.16
    // %/mi bracket gets PSRi + 0.1316 x PSRi. With several categories on,
    // every category works out its own addition from the unadjusted PSRi and
    // the additions are summed once at the end (factor = 1 + sum of the rates
    // / 100), so the order of the categories never matters. Segments farther
    // out than a category's 95 % distance, and segments without a shape on the
    // map, get nothing from it. Everything here is pure so the website, the
    // server (seeding and validating the distance tables) and the tests share
    // one implementation.
    // ------------------------------------------------------------------

    // The categories as they are listed on the Incident page: a title per
    // group, the categories of the group under it. `label` is also the value
    // of the `category` column in the distance tables on the server.
    const LPB_CATEGORY_GROUPS = [
        {key: 'externalForces', title: 'External Forces', categories: [
            {key: 'abduction', label: 'Abduction'},
            {key: 'aircraft', label: 'Aircraft'}
        ]},
        {key: 'water', title: 'Water', categories: [
            {key: 'nonPoweredBoat', label: 'Non-Powered Boat'},
            {key: 'personInCurrentWater', label: 'Person in Current Water'},
            {key: 'personInFlatWater', label: 'Person in Flat Water'},
            {key: 'personInFloodWater', label: 'Person in Flood Water'},
            {key: 'powerBoat', label: 'Power Boat'}
        ]},
        {key: 'wheelMotorized', title: 'Wheel/Motorized', categories: [
            {key: 'atv', label: 'ATV'},
            {key: 'motorcycle', label: 'Motorcycle'},
            {key: 'mountainBike', label: 'Mountain Bike'},
            {key: 'fourWdVehicle', label: '4WD Vehicle'},
            {key: 'roadVehicle', label: 'Road Vehicle'}
        ]},
        {key: 'mentalState', title: 'Mental State', categories: [
            {key: 'autism', label: 'Autism'},
            {key: 'dementia', label: 'Dementia'},
            {key: 'despondent', label: 'Despondent'},
            {key: 'intellectualDisability', label: 'Intellectual Disability'},
            {key: 'mentalIllness', label: 'Mental Illness'},
            {key: 'substanceIntoxication', label: 'Substance Intoxication'}
        ]},
        {key: 'child', title: 'Child', categories: [
            {key: 'childAge1to3', label: 'Age 1-3'},
            {key: 'childAge4to6', label: 'Age 4-6'},
            {key: 'childAge7to9', label: 'Age 7-9'},
            {key: 'childAge10to12', label: 'Age 10-12'},
            {key: 'childAge13to15', label: 'Age 13-15'}
        ]},
        {key: 'outdoorActivity', title: 'Outdoor Activity', categories: [
            {key: 'abandonedVehicle', label: 'Abandoned Vehicle'},
            {key: 'angler', label: 'Angler'},
            {key: 'carCamper', label: 'Car Camper'},
            {key: 'caver', label: 'Caver'},
            {key: 'dayClimber', label: 'Day Climber'},
            {key: 'extremeRace', label: 'Extreme Race'},
            {key: 'gatherer', label: 'Gatherer'},
            {key: 'hiker', label: 'Hiker'},
            {key: 'horsebackRider', label: 'Horseback Rider'},
            {key: 'hunter', label: 'Hunter'},
            {key: 'mountaineer', label: 'Mountaineer'},
            {key: 'runner', label: 'Runner'},
            {key: 'worker', label: 'Worker'}
        ]},
        {key: 'snowActivity', title: 'Snow Activity', categories: [
            {key: 'skierAlpine', label: 'Skier Alpine'},
            {key: 'skierNordic', label: 'Skier Nordic'},
            {key: 'snowboarder', label: 'Snowboarder'},
            {key: 'snowmobiler', label: 'Snowmobiler'},
            {key: 'snowshoer', label: 'Snowshoer'}
        ]}
    ];
    // Every category in page order, each knowing its group: {key, label, group}.
    const LPB_CATEGORIES = LPB_CATEGORY_GROUPS.reduce((list, group) => {
        group.categories.forEach(cat => list.push({key: cat.key, label: cat.label, group: group.key}));
        return list;
    }, []);
    const LPB_TERRAINS = ['Mtn Temperate', 'Flat Temperate', 'Dry', 'Urban'];
    const LPB_DEFAULT_TERRAIN = LPB_TERRAINS[0];
    const LPB_BRACKETS = [
        {key: 'p25', percent: 25},
        {key: 'p50', percent: 50},
        {key: 'p75', percent: 75},
        {key: 'p95', percent: 95}
    ];
    // Placeholder miles seeded into lpb_default_distances for every category x
    // terrain; the real numbers are entered in that table by the planner.
    const LPB_SEED_DISTANCES = {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0};
    const EARTH_RADIUS_MILES = 3958.7613;

    // A category by its bundle key ("mentalIllness") or its table label
    // ("Mental Illness"); null when unknown.
    function getLpbCategory(value) {
        const text = String(value || '').trim().toLowerCase();
        if (!text) return null;
        return LPB_CATEGORIES.find(cat => cat.key.toLowerCase() === text || cat.label.toLowerCase() === text) || null;
    }

    function isLpbTerrain(value) {
        return LPB_TERRAINS.includes(String(value || '').trim());
    }

    function normalizeLpbTerrain(value) {
        const text = String(value || '').trim();
        return LPB_TERRAINS.includes(text) ? text : LPB_DEFAULT_TERRAIN;
    }

    // A distance as typed or stored ("0.75", "1 mi", 1.25): miles rounded to a
    // tenth, or null when it is not a positive number.
    function normalizeLpbDistanceMiles(value) {
        if (value === null || value === undefined || value === '') return null;
        const match = String(value).replace(/,/g, '').match(/-?\d*\.?\d+/);
        if (!match) return null;
        const miles = parseFloat(match[0]);
        if (!Number.isFinite(miles) || miles <= 0) return null;
        return Math.round(miles * 10) / 10;
    }

    // {p25, p50, p75, p95} keeping only the brackets that hold a valid
    // distance; null when none does.
    function normalizeLpbDistances(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const out = {};
        let any = false;
        LPB_BRACKETS.forEach(bracket => {
            const miles = normalizeLpbDistanceMiles(value[bracket.key]);
            if (miles !== null) {
                out[bracket.key] = miles;
                any = true;
            }
        });
        return any ? out : null;
    }

    function isCompleteLpbDistances(value) {
        const distances = normalizeLpbDistances(value);
        return !!distances && LPB_BRACKETS.every(bracket => typeof distances[bracket.key] === 'number');
    }

    // "0.5 mi" - how every distance is shown; '' for an invalid one.
    function formatLpbMiles(value) {
        const miles = normalizeLpbDistanceMiles(value);
        return miles === null ? '' : `${miles.toFixed(1)} mi`;
    }

    function toFiniteNumber(value) {
        const num = typeof value === 'number' ? value : parseFloat(value);
        return Number.isFinite(num) ? num : null;
    }

    // "13.2%" - a percentage to a tenth, whole numbers without the decimal
    // ("50%"); '' when it is not a number.
    function formatLpbPercent(value) {
        const num = toFiniteNumber(value);
        if (num === null) return '';
        const rounded = Math.round(num * 10) / 10;
        return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
    }

    // The percentage per mile of every bracket of a category x terrain: the
    // probability the bracket adds over the previous one, spread over the
    // miles between the two distances (the 25 % bracket starts from 0 % at
    // the IPP). One entry per bracket, in LPB_BRACKETS order:
    //   {key, percent, distance, previousPercent, previousDistance, ratePercentPerMile}
    // A bracket without a distance, or whose distance does not lie beyond the
    // previous bracket's, has no rate (null) and can add nothing.
    function computeLpbBracketRates(distances) {
        const table = normalizeLpbDistances(distances) || {};
        let previousPercent = 0;
        let previousDistance = 0;
        return LPB_BRACKETS.map(bracket => {
            const distance = typeof table[bracket.key] === 'number' ? table[bracket.key] : null;
            const entry = {key: bracket.key, percent: bracket.percent, distance, previousPercent, previousDistance, ratePercentPerMile: null};
            if (distance !== null) {
                const span = distance - previousDistance;
                if (span > 0) entry.ratePercentPerMile = (bracket.percent - previousPercent) / span;
                previousPercent = bracket.percent;
                previousDistance = distance;
            }
            return entry;
        });
    }

    function normalizeLatLng(lat, lng) {
        const latitude = toFiniteNumber(lat);
        const longitude = toFiniteNumber(lng);
        if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
        return {lat: latitude, lng: longitude};
    }

    // The IPP as kept in the search file: which CalTopo marker it came from and
    // where it is; null when there is none or the position is unusable.
    function normalizeLpbIpp(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const position = normalizeLatLng(value.lat, value.lng);
        if (!position) return null;
        const out = {
            featureId: String(value.featureId || '').trim(),
            featureName: String(value.featureName || '').trim(),
            lat: position.lat,
            lng: position.lng
        };
        if (typeof value.importedAt === 'string' && value.importedAt) out.importedAt = value.importedAt;
        if (typeof value.importedBy === 'string' && value.importedBy) out.importedBy = value.importedBy;
        return out;
    }

    // The Lost Person Behavior section of a search file in canonical form:
    // every known category is present (off unless switched on), the PSR
    // adjustment is applied unless the Segments page switched it off, and the
    // distances of a category are the four values the case actually uses (a
    // copy of the login's values at the time the category / terrain was
    // chosen, so every device computes the same PSR).
    function normalizeLostPersonBehavior(value) {
        const src = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
        const rawCategories = (src.categories && typeof src.categories === 'object' && !Array.isArray(src.categories)) ? src.categories : {};
        const categories = {};
        LPB_CATEGORIES.forEach(cat => {
            const raw = (rawCategories[cat.key] && typeof rawCategories[cat.key] === 'object' && !Array.isArray(rawCategories[cat.key])) ? rawCategories[cat.key] : {};
            categories[cat.key] = {
                enabled: raw.enabled === true,
                terrain: normalizeLpbTerrain(raw.terrain),
                distances: normalizeLpbDistances(raw.distances)
            };
        });
        return {
            psrAdjustmentEnabled: src.psrAdjustmentEnabled !== false,
            ipp: normalizeLpbIpp(src.ipp),
            categories
        };
    }

    function meanLngLat(points) {
        const list = (Array.isArray(points) ? points : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!list.length) return null;
        let lng = 0;
        let lat = 0;
        list.forEach(p => { lng += p[0]; lat += p[1]; });
        return [lng / list.length, lat / list.length];
    }

    // Area centroid of one lon/lat ring (closed or open), worked out on a local
    // plane around the first vertex like polygonAreaAcres. Falls back to the
    // vertex mean for a degenerate ring.
    function ringCentroidLngLat(ring) {
        const pts = (Array.isArray(ring) ? ring : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!pts.length) return null;
        const first = pts[0];
        const last = pts[pts.length - 1];
        const isClosed = pts.length > 1 && first[0] === last[0] && first[1] === last[1];
        const n = isClosed ? pts.length - 1 : pts.length;
        if (n < 3) return meanLngLat(pts.slice(0, n));
        const lonRef = first[0];
        const latRef = first[1];
        const k = Math.cos(latRef * Math.PI / 180);
        let area = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < n; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % n];
            const x1 = (p1[0] - lonRef) * k;
            const y1 = p1[1] - latRef;
            const x2 = (p2[0] - lonRef) * k;
            const y2 = p2[1] - latRef;
            const cross = x1 * y2 - x2 * y1;
            area += cross;
            cx += (x1 + x2) * cross;
            cy += (y1 + y2) * cross;
        }
        if (Math.abs(area) < 1e-14) return meanLngLat(pts.slice(0, n));
        cx /= (3 * area);
        cy /= (3 * area);
        return [cx / k + lonRef, cy + latRef];
    }

    // Every centre a geometry contributes, weighted by area for polygons so a
    // collection of shapes is centred on its ground, not on its stray points.
    function collectGeometryCenters(geometry, out) {
        if (!geometry || typeof geometry !== 'object') return;
        const type = String(geometry.type || '');
        const coords = geometry.coordinates;
        if (type === 'Point') {
            if (Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) out.push({point: [coords[0], coords[1]], weight: 0});
        } else if (type === 'MultiPoint' || type === 'LineString') {
            const mean = meanLngLat(coords);
            if (mean) out.push({point: mean, weight: 0});
        } else if (type === 'MultiLineString') {
            (Array.isArray(coords) ? coords : []).forEach(line => {
                const mean = meanLngLat(line);
                if (mean) out.push({point: mean, weight: 0});
            });
        } else if (type === 'Polygon') {
            const centroid = Array.isArray(coords) ? ringCentroidLngLat(coords[0]) : null;
            if (centroid) out.push({point: centroid, weight: Math.max(polygonAreaAcres([coords[0]]), 1e-9)});
        } else if (type === 'MultiPolygon') {
            (Array.isArray(coords) ? coords : []).forEach(polygon => {
                const centroid = Array.isArray(polygon) ? ringCentroidLngLat(polygon[0]) : null;
                if (centroid) out.push({point: centroid, weight: Math.max(polygonAreaAcres([polygon[0]]), 1e-9)});
            });
        } else if (type === 'GeometryCollection') {
            (Array.isArray(geometry.geometries) ? geometry.geometries : []).forEach(member => collectGeometryCenters(member, out));
        }
    }

    // The centre of a GeoJSON geometry as [lng, lat]: the point itself, the
    // area centroid of a polygon (area-weighted across several), or the vertex
    // mean of a line. null when there is nothing usable.
    function geometryCenterLngLat(geometry) {
        const centers = [];
        collectGeometryCenters(geometry, centers);
        if (!centers.length) return null;
        const weighted = centers.filter(c => c.weight > 0);
        const list = weighted.length ? weighted : centers.map(c => ({point: c.point, weight: 1}));
        let total = 0;
        let lng = 0;
        let lat = 0;
        list.forEach(c => {
            total += c.weight;
            lng += c.point[0] * c.weight;
            lat += c.point[1] * c.weight;
        });
        return total > 0 ? [lng / total, lat / total] : null;
    }

    // The centre of a fetched CalTopo feature as {lat, lng}. Markers without
    // GeoJSON geometry are read from their position attribute.
    function getFeatureCenter(feature) {
        let center = geometryCenterLngLat(feature && feature.geometry);
        if (!center) {
            const attrs = feature?.attributes || feature?.properties || {};
            const pos = attrs.position || attrs.coordinates;
            if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
                center = [pos[0], pos[1]];
            } else if (pos && typeof pos === 'object') {
                const lng = toFiniteNumber(pos.lng !== undefined ? pos.lng : pos.lon);
                const lat = toFiniteNumber(pos.lat);
                if (lng !== null && lat !== null) center = [lng, lat];
            }
        }
        if (!center) return null;
        return normalizeLatLng(center[1], center[0]);
    }

    // Great-circle distance in miles between two {lat, lng}; null when either
    // position is unusable.
    function haversineMiles(a, b) {
        const from = a ? normalizeLatLng(a.lat, a.lng) : null;
        const to = b ? normalizeLatLng(b.lat, b.lng) : null;
        if (!from || !to) return null;
        const toRad = deg => deg * Math.PI / 180;
        const dLat = toRad(to.lat - from.lat);
        const dLng = toRad(to.lng - from.lng);
        const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    // The fetched CalTopo shape a Segments row was imported from: by the id in
    // column 9, else by name (the segment name alone or "Region - Segment").
    function findFeatureForSegmentRow(features, row) {
        if (!Array.isArray(features) || !Array.isArray(row)) return null;
        const rowId = String(row[9] || '').trim();
        if (rowId && !isSyntheticFeatureId(rowId)) {
            const byId = features.find(feature => getFeatureIdentity(feature).id === rowId);
            if (byId) return byId;
        }
        const names = [
            normalizeSegmentName(row[1]),
            normalizeSegmentName(formatSegmentAssignmentLabel(row[0], row[1]))
        ].filter(Boolean);
        if (!names.length) return null;
        return features.find(feature => names.includes(normalizeSegmentName(getFeatureDisplayName(feature)))) || null;
    }

    // The bracket a distance from the IPP falls into: the smallest of the four
    // distances that is at least as far (equal distances go to the smaller
    // percentage). Beyond the 95 % distance there is no bracket (null) and the
    // category adds nothing. The bracket comes with its rate (see
    // computeLpbBracketRates): `ratePercentPerMile` is the percentage of the
    // PSRi the category adds for a segment in this bracket.
    function resolveLpbBracket(distanceMiles, distances) {
        const distance = toFiniteNumber(distanceMiles);
        const table = normalizeLpbDistances(distances);
        if (distance === null || distance < 0 || !table) return null;
        let best = null;
        computeLpbBracketRates(table).forEach(bracket => {
            const limit = bracket.distance;
            if (typeof limit !== 'number' || limit < distance) return;
            if (!best || limit < best.distance || (limit === best.distance && bracket.percent < best.percent)) {
                best = Object.assign({}, bracket);
            }
        });
        return best;
    }

    // Everything the PSR maths needs from a search file, worked out once per
    // recalculation. `categories` lists every category that is switched on
    // AND has a complete set of distances - {category, terrain, distances,
    // rates} each - and `incomplete` the switched-on ones that still miss a
    // distance (they add nothing until it is entered). `active` is false -
    // with a `reason` - when the adjustment is switched off on the Segments
    // page ('disabled'), no category is on ('no-category'), none of the
    // switched-on categories has a complete set of distances ('no-distances')
    // or no IPP was imported ('no-ipp'). `category` / `terrain` / `distances`
    // are the first applied (else the first switched-on) category, for the
    // status lines that name one.
    function buildLpbContext(bundle) {
        const lpb = normalizeLostPersonBehavior(bundle && bundle.lostPersonBehavior);
        const map = bundle && Array.isArray(bundle.maps) && bundle.maps[0] ? bundle.maps[0] : null;
        const features = map && Array.isArray(map.features) ? map.features : [];
        const context = {active: false, reason: '', lpb, features, ipp: lpb.ipp, categories: [], incomplete: [], category: null, terrain: '', distances: null};
        if (!lpb.psrAdjustmentEnabled) {
            context.reason = 'disabled';
            return context;
        }
        const enabled = LPB_CATEGORIES.filter(cat => lpb.categories[cat.key] && lpb.categories[cat.key].enabled);
        if (!enabled.length) {
            context.reason = 'no-category';
            return context;
        }
        enabled.forEach(cat => {
            const entry = lpb.categories[cat.key];
            if (isCompleteLpbDistances(entry.distances)) {
                context.categories.push({category: cat, terrain: entry.terrain, distances: entry.distances, rates: computeLpbBracketRates(entry.distances)});
            } else {
                context.incomplete.push(cat);
            }
        });
        const first = context.categories.length ? context.categories[0] : {category: enabled[0], terrain: lpb.categories[enabled[0].key].terrain, distances: lpb.categories[enabled[0].key].distances};
        context.category = first.category;
        context.terrain = first.terrain;
        context.distances = first.distances;
        if (!context.categories.length) {
            context.reason = 'no-distances';
            return context;
        }
        if (!lpb.ipp) {
            context.reason = 'no-ipp';
            return context;
        }
        context.active = true;
        return context;
    }

    // How the Lost Person Behavior settings change one Segments row:
    //   null                                   - the adjustment is not active
    //   {matched: false, factor: 1, ...}       - no shape on the map for this row
    //   {matched: true, distanceMiles, contributions, addedPercent, factor}
    //     contributions  one per applied category: {category, terrain, bracket,
    //                    addedPercent} - bracket (see resolveLpbBracket) is
    //                    null beyond that category's 95 % distance, and
    //                    addedPercent is the bracket's rate (0 without one)
    //     addedPercent   the sum over the categories: the percentage of its
    //                    PSRi the segment gains
    //     factor         1 + addedPercent / 100, what the initial share is
    //                    multiplied by (1 when nothing reaches the segment)
    function getLpbSegmentAdjustment(row, context) {
        if (!context || !context.active) return null;
        const feature = findFeatureForSegmentRow(context.features, row);
        const center = feature ? getFeatureCenter(feature) : null;
        if (!center) return {matched: false, distanceMiles: null, contributions: [], addedPercent: 0, factor: 1};
        const distanceMiles = haversineMiles(center, context.ipp);
        let addedPercent = 0;
        const contributions = (context.categories || []).map(applied => {
            const bracket = resolveLpbBracket(distanceMiles, applied.distances);
            const rate = bracket && typeof bracket.ratePercentPerMile === 'number' ? bracket.ratePercentPerMile : 0;
            addedPercent += rate;
            return {category: applied.category, terrain: applied.terrain, bracket, addedPercent: rate};
        });
        return {matched: true, distanceMiles, contributions, addedPercent, factor: 1 + addedPercent / 100};
    }

    // ------------------------------------------------------------------
    // Searchers Tracks (Search Log page, "Map Tracking").
    //
    // The tracks the searchers recorded on the CalTopo map are imported into
    // the search file and measured against the segment shapes: how many miles
    // of each track lie inside each segment. With the Search Log's "Map
    // Tracking" switch on, those miles stand in for Num of Sweeps x segment
    // length in the coverage term of the PSR maths. A track belongs to the
    // segment that holds the majority of its miles (its home segment) and so
    // to that segment's task; the miles it spent in another segment go to the
    // most recent task of that segment (or to the next one, once it exists).
    // Two tasks on the home segment make the track ambiguous until the
    // planner picks one. The track's name on CalTopo carries a code with the
    // task and the segment ("#2-4D Team 1"); the code is recognised when a
    // name is read back so it is replaced, never stacked. Everything here is
    // pure so the website, the server and the tests share one implementation.
    // ------------------------------------------------------------------

    // "#<task>-<segment> " at the front of a track name (the generic form,
    // used when the segment is not one of the known names).
    const SEARCHER_TRACK_NAME_CODE = /^#(\d+)-(\S+)(?:\s+|$)/;
    // 'Track' / 'Route' come off the map; 'Custom' is typed in by the planner
    // (a name, a length and the task it counts toward - no shape behind it).
    const SEARCHER_TRACK_TYPES = ['Track', 'Route', 'Custom'];

    function isFiniteLngLat(point) {
        return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
            && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
    }

    // "#2" for '2', '#2' or ' #2 '; '' for anything without a number.
    function normalizeTaskTag(value) {
        const num = String(value === undefined || value === null ? '' : value).trim().replace(/^#/, '');
        return /^\d+$/.test(num) ? `#${num}` : '';
    }

    function segmentKey(region, segment) {
        return `${normalizeSegmentName(region)}|${normalizeSegmentName(segment)}`;
    }

    // Every line of a geometry as a list of [lng, lat(, alt, time)] points: a
    // LineString gives one path, a MultiLineString one per part, a
    // GeometryCollection the lines of its members. Points and polygons give
    // none; unusable points are skipped.
    function getLineStringPaths(geometry) {
        const paths = [];
        const collect = (geom) => {
            if (!geom || typeof geom !== 'object') return;
            const type = String(geom.type || '');
            if (type === 'LineString') {
                const pts = (Array.isArray(geom.coordinates) ? geom.coordinates : []).filter(isFiniteLngLat);
                if (pts.length >= 2) paths.push(pts);
            } else if (type === 'MultiLineString') {
                (Array.isArray(geom.coordinates) ? geom.coordinates : []).forEach(line => {
                    const pts = (Array.isArray(line) ? line : []).filter(isFiniteLngLat);
                    if (pts.length >= 2) paths.push(pts);
                });
            } else if (type === 'GeometryCollection') {
                (Array.isArray(geom.geometries) ? geom.geometries : []).forEach(collect);
            }
        };
        collect(geometry);
        return paths;
    }

    // A fetched CalTopo feature that is a line (a recorded track, a live
    // track, a drawn route) rather than an assignment, an area or a marker.
    function isTrackLikeFeature(feature) {
        if (!feature || typeof feature !== 'object') return false;
        const attrs = feature.attributes || feature.properties || {};
        if (String(attrs.class || '').toLowerCase() === 'assignment' || attrs.assignment) return false;
        return getLineStringPaths(feature.geometry).length > 0;
    }

    // 'Track' for a line recorded or live-tracked in the field (CalTopo's
    // AppTrack / LiveTrack classes, or points that carry timestamps), 'Route'
    // for a line somebody drew.
    function getTrackTypeLabel(feature) {
        const attrs = (feature && (feature.attributes || feature.properties)) || {};
        const cls = String(attrs.class || attrs.type || '').toLowerCase();
        if (/track/.test(cls)) return 'Track';
        if (Array.isArray(attrs.timestamps) && attrs.timestamps.length) return 'Track';
        const paths = getLineStringPaths(feature && feature.geometry);
        if (paths.some(path => path.some(pt => pt.length >= 4 && Number.isFinite(pt[3])))) return 'Track';
        return 'Route';
    }

    // Great-circle length of a path in miles.
    function pathLengthMiles(path) {
        const pts = (Array.isArray(path) ? path : []).filter(isFiniteLngLat);
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            total += haversineMiles({lat: pts[i - 1][1], lng: pts[i - 1][0]}, {lat: pts[i][1], lng: pts[i][0]}) || 0;
        }
        return total;
    }

    // Even-odd ray casting against one lon/lat ring (closed or open).
    function pointInRing(point, ring) {
        const pts = (Array.isArray(ring) ? ring : []).filter(isFiniteLngLat);
        const n = pts.length;
        if (n < 3) return false;
        const x = point[0];
        const y = point[1];
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = pts[i][0];
            const yi = pts[i][1];
            const xj = pts[j][0];
            const yj = pts[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    // Inside the polygon made of `rings` (the first is the outer boundary, the
    // rest are holes): even-odd over every ring.
    function pointInPolygonRings(point, rings) {
        if (!isFiniteLngLat(point) || !Array.isArray(rings)) return false;
        let inside = false;
        rings.forEach(ring => { if (pointInRing(point, ring)) inside = !inside; });
        return inside;
    }

    // The polygons (each a list of rings) of an area geometry: a Polygon, the
    // members of a MultiPolygon, the area members of a GeometryCollection.
    // A line or a point has none.
    function collectAreaPolygons(geometry, out = []) {
        if (!geometry || typeof geometry !== 'object') return out;
        const type = String(geometry.type || '');
        if (type === 'Polygon') {
            if (Array.isArray(geometry.coordinates) && geometry.coordinates.length) out.push(geometry.coordinates);
        } else if (type === 'MultiPolygon') {
            (Array.isArray(geometry.coordinates) ? geometry.coordinates : []).forEach(polygon => {
                if (Array.isArray(polygon) && polygon.length) out.push(polygon);
            });
        } else if (type === 'GeometryCollection') {
            (Array.isArray(geometry.geometries) ? geometry.geometries : []).forEach(member => collectAreaPolygons(member, out));
        }
        return out;
    }

    function pointInAreaGeometry(point, geometry) {
        return collectAreaPolygons(geometry).some(rings => pointInPolygonRings(point, rings));
    }

    // Where the leg a -> b crosses the edge p -> q, as the fraction of the leg
    // (0 at a, 1 at b); null when they do not cross (or run parallel - the
    // midpoint tests take care of a leg lying along an edge).
    function legCrossingParameter(a, b, p, q) {
        const rx = b[0] - a[0];
        const ry = b[1] - a[1];
        const sx = q[0] - p[0];
        const sy = q[1] - p[1];
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) < 1e-18) return null;
        const t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / denominator;
        const u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / denominator;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return t;
    }

    // The miles of a path that lie inside an area geometry. Every leg of the
    // path is cut where it crosses an edge of the shape and each piece is
    // counted when its midpoint is inside, so a track that leaves a segment
    // and comes back is measured exactly for the part it spent inside.
    function measurePathInsideGeometryMiles(path, geometry) {
        const polygons = collectAreaPolygons(geometry);
        const pts = (Array.isArray(path) ? path : []).filter(isFiniteLngLat);
        if (!polygons.length || pts.length < 2) return 0;

        const edges = [];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        polygons.forEach(rings => rings.forEach(ring => {
            const vertices = (Array.isArray(ring) ? ring : []).filter(isFiniteLngLat);
            for (let i = 0; i < vertices.length; i++) {
                const p = vertices[i];
                const q = vertices[(i + 1) % vertices.length];
                if (p[0] === q[0] && p[1] === q[1]) continue;
                edges.push({p, q, minX: Math.min(p[0], q[0]), maxX: Math.max(p[0], q[0]), minY: Math.min(p[1], q[1]), maxY: Math.max(p[1], q[1])});
                minX = Math.min(minX, p[0]);
                maxX = Math.max(maxX, p[0]);
                minY = Math.min(minY, p[1]);
                maxY = Math.max(maxY, p[1]);
            }
        }));
        if (!edges.length) return 0;

        const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        let inside = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const legMinX = Math.min(a[0], b[0]);
            const legMaxX = Math.max(a[0], b[0]);
            const legMinY = Math.min(a[1], b[1]);
            const legMaxY = Math.max(a[1], b[1]);
            // A leg outside the shape's bounding box cannot be inside it.
            if (legMaxX < minX || legMinX > maxX || legMaxY < minY || legMinY > maxY) continue;
            const cuts = [0, 1];
            edges.forEach(edge => {
                if (edge.maxX < legMinX || edge.minX > legMaxX || edge.maxY < legMinY || edge.minY > legMaxY) return;
                const t = legCrossingParameter(a, b, edge.p, edge.q);
                if (t !== null) cuts.push(t);
            });
            cuts.sort((x, y) => x - y);
            for (let k = 1; k < cuts.length; k++) {
                const t0 = cuts[k - 1];
                const t1 = cuts[k];
                if (t1 - t0 <= 1e-12) continue;
                const mid = at(a, b, (t0 + t1) / 2);
                if (!polygons.some(rings => pointInPolygonRings(mid, rings))) continue;
                const from = at(a, b, t0);
                const to = at(a, b, t1);
                inside += haversineMiles({lat: from[1], lng: from[0]}, {lat: to[1], lng: to[0]}) || 0;
            }
        }
        return inside;
    }

    const roundMiles = (miles) => Math.round(miles * 10000) / 10000;

    // How the miles of a track fall across the Segments rows whose CalTopo
    // shape is known (findFeatureForSegmentRow): {totalMiles, pointCount,
    // segments: [{region, segment, miles}]} listing only the segments the
    // track actually entered. A segment without an area shape (a line
    // assignment, no shape at all) is never entered.
    function measureTrackMilesBySegment(trackFeature, segmentRows, features) {
        const paths = getLineStringPaths(trackFeature && trackFeature.geometry);
        const totalMiles = roundMiles(paths.reduce((sum, path) => sum + pathLengthMiles(path), 0));
        const pointCount = paths.reduce((sum, path) => sum + path.length, 0);
        const segments = [];
        (Array.isArray(segmentRows) ? segmentRows : []).forEach(row => {
            if (!Array.isArray(row) || !String(row[1] || '').trim()) return;
            const shape = findFeatureForSegmentRow(features, row);
            if (!shape || !collectAreaPolygons(shape.geometry).length) return;
            const miles = roundMiles(paths.reduce((sum, path) => sum + measurePathInsideGeometryMiles(path, shape.geometry), 0));
            if (miles > 0) segments.push({region: String(row[0] || '').trim(), segment: String(row[1] || '').trim(), miles});
        });
        return {totalMiles, pointCount, segments};
    }

    // The task/segment code at the front of a track name: "#2-4D Team 1" ->
    // {taskNumber: '2', segment: '4D', baseName: 'Team 1'}. The known segment
    // names are tried first (longest first) so a segment name with spaces is
    // recognised; otherwise the code runs to the first space. A name without
    // the code comes back unchanged with an empty task and segment.
    function parseSearcherTrackName(name, segmentNames) {
        const text = String(name || '').trim();
        const result = {taskNumber: '', segment: '', baseName: text};
        const dash = text.indexOf('-');
        if (!text.startsWith('#') || dash < 2 || !/^\d+$/.test(text.slice(1, dash))) return result;
        const rest = text.slice(dash + 1);
        const known = (Array.isArray(segmentNames) ? segmentNames : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length);
        for (const segment of known) {
            if (rest === segment || (rest.startsWith(segment) && /^\s/.test(rest.slice(segment.length)))) {
                return {taskNumber: text.slice(1, dash), segment, baseName: rest.slice(segment.length).trim()};
            }
        }
        const match = text.match(SEARCHER_TRACK_NAME_CODE);
        if (!match) return result;
        return {taskNumber: match[1], segment: match[2], baseName: text.slice(match[0].length).trim()};
    }

    // "#2-4D Team 1"; the base name alone when there is no task or segment.
    function formatSearcherTrackName(taskTag, segment, baseName) {
        const num = normalizeTaskTag(taskTag).replace(/^#/, '');
        const seg = String(segment || '').trim();
        const base = String(baseName || '').trim();
        if (!num || !seg) return base;
        return `#${num}-${seg}${base ? ` ${base}` : ''}`;
    }

    // One imported track in canonical form (null when it cannot be one):
    //   id           the CalTopo feature id, or the id the website made up
    //   featureId    the CalTopo id ('' when the shape has none)
    //   baseName     the name without the task/segment code
    //   caltopoName  the title CalTopo last had (fetched, or pushed by us)
    //   type         'Track' | 'Route'
    //   lengthMiles, pointCount
    //   segmentMiles [{region, segment, miles}] - the miles inside each segment
    //   assignedTask '#2' when the planner picked the task; '' = automatic
    //   custom       true for a track typed in by hand (type 'Custom'): it has
    //                no shape on the map, so it is never re-measured, renamed
    //                or recolored there
    //   importedAt, importedBy, evaluatedAt
    function normalizeSearcherTrack(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const id = String(value.id || value.featureId || '').trim();
        if (!id) return null;
        const custom = value.custom === true || value.type === 'Custom';
        const lengthMiles = toFiniteNumber(value.lengthMiles);
        const pointCount = toFiniteNumber(value.pointCount);
        const segmentMiles = (Array.isArray(value.segmentMiles) ? value.segmentMiles : []).map(entry => {
            if (!entry || typeof entry !== 'object') return null;
            const miles = toFiniteNumber(entry.miles);
            const segment = String(entry.segment || '').trim();
            if (!segment || miles === null || miles <= 0) return null;
            return {region: String(entry.region || '').trim(), segment, miles};
        }).filter(Boolean);
        return {
            id,
            featureId: custom ? '' : String(value.featureId || '').trim(),
            baseName: String(value.baseName || '').trim(),
            caltopoName: custom ? '' : String(value.caltopoName || '').trim(),
            type: custom ? 'Custom' : (SEARCHER_TRACK_TYPES.includes(value.type) ? value.type : 'Route'),
            lengthMiles: lengthMiles !== null && lengthMiles > 0 ? lengthMiles : 0,
            pointCount: pointCount !== null && pointCount > 0 ? Math.floor(pointCount) : 0,
            segmentMiles,
            assignedTask: normalizeTaskTag(value.assignedTask),
            custom,
            importedAt: typeof value.importedAt === 'string' ? value.importedAt : '',
            importedBy: typeof value.importedBy === 'string' ? value.importedBy : '',
            evaluatedAt: typeof value.evaluatedAt === 'string' ? value.evaluatedAt : ''
        };
    }

    // The canonical list: usable records only, one per id (the first wins).
    function normalizeSearcherTracks(list) {
        const seen = new Set();
        const out = [];
        (Array.isArray(list) ? list : []).forEach(value => {
            const track = normalizeSearcherTrack(value);
            if (!track || seen.has(track.id)) return;
            seen.add(track.id);
            out.push(track);
        });
        return out;
    }

    // When a Search Log row was logged (column 1 = MM-DD-YYYY, column 2 =
    // HH:mm); 0 for a row without a date.
    function searchLogRowTimestamp(row) {
        if (!Array.isArray(row) || !row[1]) return 0;
        const [m, d, y] = String(row[1]).split('-').map(Number);
        const [hh, mm] = String(row[2] || '00:00').split(':').map(Number);
        const ts = new Date(y || 0, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime();
        return Number.isFinite(ts) ? ts : 0;
    }

    // Which task every imported track counts toward, from the tracks' stored
    // per-segment miles and the Search Log rows:
    //   byTask         {'#2': {miles, portions: [{trackId, region, segment,
    //                  miles, home}]}} - the track miles each task gets
    //   tracks         one per track: {id, track, home, homeTasks, task,
    //                  ambiguous, portions: [{region, segment, miles, task,
    //                  home}], displayName}
    //   ambiguousTasks the tasks that share a home segment with an ambiguous
    //                  track (they get the red question mark)
    // The home segment is the one with the most miles. Its tasks are the
    // Search Log rows for that segment, oldest first; the planner's pick
    // (assignedTask) wins when it is one of them, a single task is taken as
    // is, several make the track ambiguous and the latest gets the miles for
    // now, none leaves the miles unallocated until a task exists. The miles
    // in every other segment go to that segment's latest task (or wait for
    // the next one). displayName carries the "#task-segment " code.
    function allocateSearcherTracks(tracks, searchLogRows) {
        const list = normalizeSearcherTracks(tracks);
        const taskNumber = tag => parseInt(String(tag).replace('#', ''), 10) || 0;
        const rows = (Array.isArray(searchLogRows) ? searchLogRows : [])
            .filter(row => Array.isArray(row) && normalizeTaskTag(row[0]) && String(row[4] || '').trim())
            .sort((a, b) => (searchLogRowTimestamp(a) - searchLogRowTimestamp(b)) || (taskNumber(a[0]) - taskNumber(b[0])));
        const tasksBySegment = new Map();
        rows.forEach(row => {
            const key = segmentKey(row[3], row[4]);
            const tag = normalizeTaskTag(row[0]);
            if (!tasksBySegment.has(key)) tasksBySegment.set(key, []);
            if (!tasksBySegment.get(key).includes(tag)) tasksBySegment.get(key).push(tag);
        });
        const tasksFor = (region, segment) => (tasksBySegment.get(segmentKey(region, segment)) || []).slice();
        const latestTaskFor = (region, segment) => {
            const tasks = tasksFor(region, segment);
            return tasks.length ? tasks[tasks.length - 1] : '';
        };

        const byTask = {};
        const ambiguousTasks = [];
        const allocated = list.map(track => {
            const ordered = track.segmentMiles.slice().sort((a, b) => b.miles - a.miles);
            const home = ordered.length ? {region: ordered[0].region, segment: ordered[0].segment, miles: ordered[0].miles} : null;
            const homeTasks = home ? tasksFor(home.region, home.segment) : [];
            let task = '';
            let ambiguous = false;
            if (home) {
                if (track.assignedTask && homeTasks.includes(track.assignedTask)) {
                    task = track.assignedTask;
                } else if (homeTasks.length === 1) {
                    task = homeTasks[0];
                } else if (homeTasks.length > 1) {
                    task = homeTasks[homeTasks.length - 1];
                    ambiguous = true;
                }
            }
            if (ambiguous) homeTasks.forEach(tag => { if (!ambiguousTasks.includes(tag)) ambiguousTasks.push(tag); });
            const portions = ordered.map((portion, index) => {
                const isHome = index === 0;
                const portionTask = isHome ? task : latestTaskFor(portion.region, portion.segment);
                if (portionTask) {
                    if (!byTask[portionTask]) byTask[portionTask] = {miles: 0, portions: []};
                    byTask[portionTask].miles += portion.miles;
                    byTask[portionTask].portions.push({trackId: track.id, region: portion.region, segment: portion.segment, miles: portion.miles, home: isHome});
                }
                return {region: portion.region, segment: portion.segment, miles: portion.miles, task: portionTask, home: isHome};
            });
            const displayName = task && home ? formatSearcherTrackName(task, home.segment, track.baseName) : track.baseName;
            return {id: track.id, track, home, homeTasks, task, ambiguous, portions, displayName};
        });
        return {byTask, tracks: allocated, ambiguousTasks};
    }

    // The track miles a task gets from an allocation (0 without any).
    function getTaskTrackMiles(allocation, taskTag) {
        const tag = normalizeTaskTag(taskTag);
        const entry = allocation && allocation.byTask && tag ? allocation.byTask[tag] : null;
        return entry && Number.isFinite(entry.miles) ? entry.miles : 0;
    }

    // ------------------------------------------------------------------
    // Auto Draw Segments (Maps page).
    //
    // The planner picks one CalTopo polygon and the app cuts it into equal
    // slices of at most AUTO_DRAW_MAX_ACRES and - whenever the shape allows
    // it - at least AUTO_DRAW_MIN_ACRES, as many as it takes to fill the
    // shape, then draws the slices on the map. The slices are strips between
    // parallel cut lines: vertical (north-south lines, numbered west to
    // east), horizontal (east-west lines, numbered north to south) or at an
    // angle the planner types in (degrees clockwise from north; 0 =
    // vertical, 90 = horizontal). Everything is worked out on the local
    // plane polygonAreaAcres uses (miles east / north of the first vertex),
    // rotated so the cut lines are vertical; each cut position is found by
    // bisection on the area to its left, so every slice has the same area
    // whatever the outline. A concave outline can leave a strip in two
    // pieces - each becomes its own numbered shape. Everything here is pure
    // so the website and the tests share one implementation.
    // ------------------------------------------------------------------

    const AUTO_DRAW_MIN_ACRES = 10;
    const AUTO_DRAW_MAX_ACRES = 15;
    // Slivers below this are numerical noise from a cut running along an
    // edge, not segments anybody should search.
    const AUTO_DRAW_MIN_PIECE_ACRES = 0.01;
    const MILES_PER_DEGREE = 69.172;

    // The number of equal slices for a shape: the fewest that keep every
    // slice at or under the maximum. `undersized` says the slices come out
    // under the minimum (a shape under 10 acres, or one between 15 and 20
    // acres, cannot be cut into 10-15 acre pieces); 0 slices for no area.
    function computeAutoDrawSliceCount(totalAcres, options = {}) {
        const min = toFiniteNumber(options.minAcres) > 0 ? toFiniteNumber(options.minAcres) : AUTO_DRAW_MIN_ACRES;
        const max = Math.max(min, toFiniteNumber(options.maxAcres) > 0 ? toFiniteNumber(options.maxAcres) : AUTO_DRAW_MAX_ACRES);
        const total = toFiniteNumber(totalAcres);
        if (total === null || total <= 0) return {count: 0, acresEach: 0, undersized: false, minAcres: min, maxAcres: max};
        const count = total <= max ? 1 : Math.ceil(total / max);
        const acresEach = total / count;
        return {count, acresEach, undersized: acresEach < min, minAcres: min, maxAcres: max};
    }

    // The local plane around `ref` ([lng, lat]): x miles east, y miles north.
    function makeLocalPlane(ref) {
        const k = Math.cos(ref[1] * Math.PI / 180) * MILES_PER_DEGREE;
        return {
            toPlane: (p) => [(p[0] - ref[0]) * k, (p[1] - ref[1]) * MILES_PER_DEGREE],
            fromPlane: (q) => [q[0] / k + ref[0], q[1] / MILES_PER_DEGREE + ref[1]]
        };
    }

    function rotatePoint(p, radians) {
        const c = Math.cos(radians);
        const s = Math.sin(radians);
        return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
    }

    // A ring as a plain list of distinct [x, y] vertices: unusable points,
    // the closing repeat of the first vertex and consecutive duplicates go.
    function cleanRing(ring) {
        const out = [];
        (Array.isArray(ring) ? ring : []).forEach(p => {
            if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
            const last = out[out.length - 1];
            if (last && last[0] === p[0] && last[1] === p[1]) return;
            out.push([p[0], p[1]]);
        });
        while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
        return out.length >= 3 ? out : [];
    }

    // Shoelace area of a planar ring (open), in square plane units.
    function planarRingArea(ring) {
        const pts = Array.isArray(ring) ? ring : [];
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % pts.length];
            area += p[0] * q[1] - q[0] * p[1];
        }
        return Math.abs(area) / 2;
    }

    function planarRingCentroidY(ring) {
        const pts = Array.isArray(ring) ? ring : [];
        if (!pts.length) return 0;
        return pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
    }

    // Cuts one planar ring along the vertical line x = `x` (no vertex may lie
    // on the line - splitRingsByVerticalLine sees to that): {left, right},
    // each a list of simple rings. The classic walk: the crossings are
    // paired along the line (consecutive crossings bound a stretch inside
    // the polygon), the outline is walked on the kept side from a crossing
    // to the next, then the cut face is followed to that crossing's partner
    // and the walk goes on until it is back at the start.
    function splitRingByVerticalLine(ring, x) {
        const pts = cleanRing(ring);
        if (!pts.length) return {left: [], right: []};
        const sideOf = p => (p[0] < x ? -1 : 1);
        if (pts.every(p => sideOf(p) < 0)) return {left: [pts], right: []};
        if (pts.every(p => sideOf(p) > 0)) return {left: [], right: [pts]};
        const verts = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            verts.push({p: a, cross: false});
            if (sideOf(a) !== sideOf(b)) {
                const t = (x - a[0]) / (b[0] - a[0]);
                verts.push({p: [x, a[1] + (b[1] - a[1]) * t], cross: true});
            }
        }
        const n = verts.length;
        const crossings = verts.map((v, i) => (v.cross ? i : -1)).filter(i => i >= 0);
        const sorted = crossings.slice().sort((i, j) => verts[i].p[1] - verts[j].p[1]);
        const partner = new Map();
        for (let k = 0; k + 1 < sorted.length; k += 2) {
            partner.set(sorted[k], sorted[k + 1]);
            partner.set(sorted[k + 1], sorted[k]);
        }
        const collect = (wantSide) => {
            const pieces = [];
            const used = new Set();
            crossings.forEach(start => {
                if (used.has(start) || sideOf(verts[(start + 1) % n].p) !== wantSide) return;
                const piece = [];
                let cur = start;
                let guard = 0;
                while (guard++ <= n + crossings.length) {
                    used.add(cur);
                    piece.push(verts[cur].p);
                    let i = (cur + 1) % n;
                    while (!verts[i].cross) {
                        piece.push(verts[i].p);
                        i = (i + 1) % n;
                    }
                    piece.push(verts[i].p);
                    const jump = partner.get(i);
                    if (jump === undefined || jump === start || used.has(jump)) break;
                    cur = jump;
                }
                if (piece.length >= 3 && planarRingArea(piece) > 0) pieces.push(piece);
            });
            return pieces;
        };
        return {left: collect(-1), right: collect(1)};
    }

    // Cuts planar rings along x = `x`: {left, right, x} - `x` is the cut
    // actually used, nudged by a hair (a ten-millionth of a mile a step) when
    // a vertex sat exactly on the line.
    function splitRingsByVerticalLine(rings, x) {
        const list = (Array.isArray(rings) ? rings : []).map(cleanRing).filter(r => r.length);
        const onLine = value => list.some(ring => ring.some(p => Math.abs(p[0] - value) < 1e-9));
        let cut = x;
        for (let step = 1; onLine(cut) && step <= 60; step++) {
            cut = x + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 1e-7;
        }
        const left = [];
        const right = [];
        list.forEach(ring => {
            const parts = splitRingByVerticalLine(ring, cut);
            left.push(...parts.left);
            right.push(...parts.right);
        });
        return {left, right, x: cut};
    }

    // Cuts planar rings into `count` strips of equal area between vertical
    // lines, west to east: a list of `count` ring lists.
    function sliceRingsIntoEqualAreaStrips(rings, count) {
        const list = (Array.isArray(rings) ? rings : []).map(cleanRing).filter(r => r.length);
        if (!list.length) return [];
        if (count <= 1) return [list];
        const total = list.reduce((sum, ring) => sum + planarRingArea(ring), 0);
        let minX = Infinity;
        let maxX = -Infinity;
        list.forEach(ring => ring.forEach(p => {
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
        }));
        const areaLeftOf = x => splitRingsByVerticalLine(list, x).left.reduce((sum, ring) => sum + planarRingArea(ring), 0);
        const strips = [];
        let remaining = list;
        for (let k = 1; k < count; k++) {
            const target = total * k / count;
            let lo = minX;
            let hi = maxX;
            for (let iter = 0; iter < 60; iter++) {
                const mid = (lo + hi) / 2;
                if (areaLeftOf(mid) < target) lo = mid;
                else hi = mid;
            }
            const split = splitRingsByVerticalLine(remaining, (lo + hi) / 2);
            strips.push(split.left);
            remaining = split.right;
        }
        strips.push(remaining);
        return strips;
    }

    // An angle in degrees brought into [0, 360); 0 for anything unusable.
    function normalizeAutoDrawAngle(value) {
        const num = toFiniteNumber(value);
        if (num === null) return 0;
        return ((num % 360) + 360) % 360;
    }

    const roundCoordinate = value => Math.round(value * 1e7) / 1e7;

    // The slices of a CalTopo area feature:
    //   ok / reason      false with 'no-area' when the feature has no polygon
    //   totalAcres       the area cut (outer rings; holes are not taken out)
    //   count, acresEach, undersized   see computeAutoDrawSliceCount
    //   angleDegrees     the cut lines' bearing actually used
    //   pieces           [{ring, acres, strip, index}] - `ring` a closed
    //                    lng/lat ring (7 decimals), `strip` the slice (1-based,
    //                    in sweep order), `index` the running number the
    //                    shape is named with (a strip in two pieces gives two
    //                    numbers, north-most first)
    // options.angleDegrees is the bearing of the cut lines (0 vertical, 90
    // horizontal); options.minAcres / maxAcres override the bounds.
    function planAutoDrawSegments(feature, options = {}) {
        const outerRings = collectAreaPolygons(feature && feature.geometry)
            .map(rings => cleanRing(rings[0]))
            .filter(ring => ring.length);
        const empty = {ok: false, reason: 'no-area', totalAcres: 0, count: 0, acresEach: 0, undersized: false, angleDegrees: normalizeAutoDrawAngle(options.angleDegrees), pieces: []};
        if (!outerRings.length) return empty;
        const angleDegrees = normalizeAutoDrawAngle(options.angleDegrees);
        const radians = angleDegrees * Math.PI / 180;
        const plane = makeLocalPlane(outerRings[0][0]);
        const planar = outerRings.map(ring => cleanRing(ring.map(p => rotatePoint(plane.toPlane(p), radians)))).filter(ring => ring.length);
        const totalAcres = planar.reduce((sum, ring) => sum + planarRingArea(ring), 0) * 640;
        const sizing = computeAutoDrawSliceCount(totalAcres, options);
        if (!sizing.count) return empty;
        const strips = sliceRingsIntoEqualAreaStrips(planar, sizing.count);
        const pieces = [];
        strips.forEach((stripRings, stripIndex) => {
            stripRings
                .map(ring => ({ring, acres: planarRingArea(ring) * 640, y: planarRingCentroidY(ring)}))
                .filter(entry => entry.acres >= AUTO_DRAW_MIN_PIECE_ACRES)
                .sort((a, b) => b.y - a.y)
                .forEach(entry => {
                    const lngLat = entry.ring.map(p => plane.fromPlane(rotatePoint(p, -radians)).map(roundCoordinate));
                    lngLat.push(lngLat[0].slice());
                    pieces.push({ring: lngLat, acres: Math.round(entry.acres * 100) / 100, strip: stripIndex + 1, index: pieces.length + 1});
                });
        });
        return {ok: true, reason: '', totalAcres, count: sizing.count, acresEach: sizing.acresEach, undersized: sizing.undersized, angleDegrees, pieces};
    }

    // "Alpha-3": the source shape's name and the running number.
    function buildAutoDrawSegmentName(baseName, index) {
        const base = String(baseName || '').trim() || 'Segment';
        return `${base}-${index}`;
    }

    // ------------------------------------------------------------------
    // Trim Tracks (Maps page).
    //
    // A track on the CalTopo map is cut where it crosses the edge of a
    // segment shape (the same clipping the Searchers Tracks miles use) into
    // pieces that each lie in one set of segments - or outside every
    // segment. The planner picks the pieces to remove by segment ("the part
    // in 4D", "the part outside every segment"); what is left becomes the
    // trimmed track, in as many parts as the removed pieces cut it into.
    // Pieces are measured by the midpoint of every cut leg, so a piece
    // inside two overlapping segments belongs to both. Cut points keep the
    // extras a point may carry (altitude, time) by linear interpolation.
    // ------------------------------------------------------------------

    function interpolateTrackPoint(a, b, t) {
        const out = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for (let i = 2; i < Math.min(a.length, b.length); i++) {
            if (Number.isFinite(a[i]) && Number.isFinite(b[i])) out.push(a[i] + (b[i] - a[i]) * t);
            else break;
        }
        return out;
    }

    // The segment shapes as trimming needs them: [{key, polygons, edges}] for
    // every entry with an area geometry.
    function prepareTrimSegments(segments) {
        return (Array.isArray(segments) ? segments : []).map(segment => {
            const polygons = collectAreaPolygons(segment && segment.geometry);
            if (!polygons.length) return null;
            const edges = [];
            polygons.forEach(rings => rings.forEach(ring => {
                const vertices = (Array.isArray(ring) ? ring : []).filter(isFiniteLngLat);
                for (let i = 0; i < vertices.length; i++) {
                    const p = vertices[i];
                    const q = vertices[(i + 1) % vertices.length];
                    if (p[0] === q[0] && p[1] === q[1]) continue;
                    edges.push({p, q, minX: Math.min(p[0], q[0]), maxX: Math.max(p[0], q[0]), minY: Math.min(p[1], q[1]), maxY: Math.max(p[1], q[1])});
                }
            }));
            return {key: String(segment.key === undefined || segment.key === null ? '' : segment.key), polygons, edges};
        }).filter(Boolean);
    }

    // The pieces of a path: [{points, keys, miles}] in order along the path,
    // `keys` the segments (sorted) whose shape holds the piece, [] outside
    // every segment. Consecutive legs in the same segments form one piece.
    function slicePathBySegments(path, segments) {
        const pts = (Array.isArray(path) ? path : []).filter(isFiniteLngLat);
        const prepared = prepareTrimSegments(segments);
        if (pts.length < 2) return [];
        const membershipAt = point => prepared
            .filter(segment => segment.polygons.some(rings => pointInPolygonRings(point, rings)))
            .map(segment => segment.key)
            .sort();
        const pieces = [];
        let current = null;
        const addLeg = (from, to, keys) => {
            const signature = keys.join('\u0000');
            if (current && current.signature === signature) {
                current.points.push(to);
            } else {
                current = {signature, keys, points: [from, to]};
                pieces.push(current);
            }
        };
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const legMinX = Math.min(a[0], b[0]);
            const legMaxX = Math.max(a[0], b[0]);
            const legMinY = Math.min(a[1], b[1]);
            const legMaxY = Math.max(a[1], b[1]);
            const cuts = [0, 1];
            prepared.forEach(segment => segment.edges.forEach(edge => {
                if (edge.maxX < legMinX || edge.minX > legMaxX || edge.maxY < legMinY || edge.minY > legMaxY) return;
                const t = legCrossingParameter(a, b, edge.p, edge.q);
                if (t !== null) cuts.push(t);
            }));
            cuts.sort((x, y) => x - y);
            let previous = 0;
            for (let k = 1; k < cuts.length; k++) {
                const t1 = cuts[k];
                if (t1 - previous <= 1e-12) continue;
                const from = previous === 0 ? a : interpolateTrackPoint(a, b, previous);
                const to = t1 === 1 ? b : interpolateTrackPoint(a, b, t1);
                addLeg(from, to, membershipAt([a[0] + (b[0] - a[0]) * (previous + t1) / 2, a[1] + (b[1] - a[1]) * (previous + t1) / 2]));
                previous = t1;
            }
        }
        return pieces.map(piece => ({points: piece.points, keys: piece.keys, miles: pathLengthMiles(piece.points)}));
    }

    // How the miles of a track (one or more paths) fall: [{key, miles}] for
    // every segment entered plus {key: '', miles} for the miles outside every
    // segment; a stretch in two overlapping segments counts for both.
    function summarizeTrackPortions(paths, segments) {
        const totals = new Map();
        const add = (key, miles) => totals.set(key, (totals.get(key) || 0) + miles);
        (Array.isArray(paths) ? paths : []).forEach(path => slicePathBySegments(path, segments).forEach(piece => {
            if (!piece.keys.length) add('', piece.miles);
            else piece.keys.forEach(key => add(key, piece.miles));
        }));
        return Array.from(totals.entries())
            .map(([key, miles]) => ({key, miles: roundMiles(miles)}))
            .filter(portion => portion.miles > 0);
    }

    // The track with the chosen pieces taken out. `removal.segmentKeys` lists
    // the segments whose pieces go (a piece in any of them goes),
    // `removal.outside` removes the pieces outside every segment. Returns
    // {parts, removedMiles, keptMiles}: `parts` the paths left, in order -
    // one when the removed pieces were at the ends only, several when a
    // removed piece sat between kept ones, none when nothing is left. A path
    // nothing is cut from comes back as it was (no cut points added).
    function trimTrackPaths(paths, segments, removal = {}) {
        const removeKeys = new Set((Array.isArray(removal.segmentKeys) ? removal.segmentKeys : []).map(key => String(key)));
        const removeOutside = removal.outside === true;
        const parts = [];
        let removedMiles = 0;
        let keptMiles = 0;
        (Array.isArray(paths) ? paths : []).forEach(path => {
            const pieces = slicePathBySegments(path, segments);
            const isRemoved = piece => (piece.keys.length ? piece.keys.some(key => removeKeys.has(key)) : removeOutside);
            if (pieces.length && !pieces.some(isRemoved)) {
                const original = (Array.isArray(path) ? path : []).filter(isFiniteLngLat);
                keptMiles += pathLengthMiles(original);
                parts.push(original);
                return;
            }
            let run = null;
            pieces.forEach(piece => {
                if (isRemoved(piece)) {
                    removedMiles += piece.miles;
                    run = null;
                    return;
                }
                keptMiles += piece.miles;
                if (run) {
                    run.push(...piece.points.slice(1));
                } else {
                    run = piece.points.slice();
                    parts.push(run);
                }
            });
        });
        return {
            parts: parts.filter(part => part.length >= 2 && pathLengthMiles(part) > 0),
            removedMiles: roundMiles(removedMiles),
            keptMiles: roundMiles(keptMiles)
        };
    }

    // "Team 1 p2": the original name and the part number.
    function buildTrimmedTrackPartName(baseName, index) {
        const base = String(baseName || '').trim() || 'Track';
        return `${base} p${index}`;
    }

    return {
        AUTO_DRAW_MIN_ACRES,
        AUTO_DRAW_MAX_ACRES,
        computeAutoDrawSliceCount,
        splitRingsByVerticalLine,
        sliceRingsIntoEqualAreaStrips,
        planAutoDrawSegments,
        buildAutoDrawSegmentName,
        slicePathBySegments,
        summarizeTrackPortions,
        trimTrackPaths,
        buildTrimmedTrackPartName,
        LPB_CATEGORY_GROUPS,
        LPB_CATEGORIES,
        LPB_TERRAINS,
        LPB_DEFAULT_TERRAIN,
        LPB_BRACKETS,
        LPB_SEED_DISTANCES,
        getLpbCategory,
        isLpbTerrain,
        normalizeLpbTerrain,
        normalizeLpbDistanceMiles,
        normalizeLpbDistances,
        isCompleteLpbDistances,
        formatLpbMiles,
        formatLpbPercent,
        computeLpbBracketRates,
        normalizeLpbIpp,
        normalizeLostPersonBehavior,
        geometryCenterLngLat,
        getFeatureCenter,
        haversineMiles,
        findFeatureForSegmentRow,
        resolveLpbBracket,
        buildLpbContext,
        getLpbSegmentAdjustment,
        SEARCHER_TRACK_NAME_CODE,
        SEARCHER_TRACK_TYPES,
        normalizeTaskTag,
        getLineStringPaths,
        isTrackLikeFeature,
        getTrackTypeLabel,
        pathLengthMiles,
        pointInPolygonRings,
        collectAreaPolygons,
        pointInAreaGeometry,
        measurePathInsideGeometryMiles,
        measureTrackMilesBySegment,
        parseSearcherTrackName,
        formatSearcherTrackName,
        normalizeSearcherTrack,
        normalizeSearcherTracks,
        searchLogRowTimestamp,
        allocateSearcherTracks,
        getTaskTrackMiles,
        getFeatureTypeKey,
        getCalTopoApiObjectType,
        captureCalTopoFeatureStyle,
        applyCapturedCalTopoFeatureStyle,
        buildCalTopoFeatureUpdatePayload,
        getFeatureTypeLabel,
        FEATURE_CATEGORIES,
        getFeatureCategoryKey,
        getFeatureCategoryLabel,
        normalizeFeatureTypeFilters,
        isFeatureCategoryEnabled,
        normalizeSegmentName,
        formatSegmentAssignmentLabel,
        buildSegmentPsrcLookup,
        getFeaturePsrcColor,
        getFeaturePsrcAssignmentStyle,
        filterSegmentImportsByType,
        polygonAreaAcres,
        ensureSegmentsPageRows,
        getFeatureDisplayName,
        isSyntheticFeatureId,
        getFeatureIdentity,
        getFeatureIdentityKey,
        compareFeatureNames,
        sortFeaturesByName,
        filterFeaturesByName,
        normalizeUnwantedFeatureList,
        isFeatureUnwanted,
        isFeatureImportedAsSegment,
        isFeatureImportedAsTrack,
        isFeatureAccountedFor,
        getFeatureImportTarget,
        getUnaccountedFeatures,
        markFeaturesUnwanted,
        unmarkFeaturesUnwanted,
        unmarkFeaturesUnwantedByFilteredType,
        formatUnaccountedFeatureNotification
    };
});

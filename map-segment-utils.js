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
    function isFeatureAccountedFor(feature, segmentRows) {
        const identity = getFeatureIdentity(feature);
        return (Array.isArray(segmentRows) ? segmentRows : []).some(row => {
            if (!Array.isArray(row)) return false;
            const rowId = String(row[9] || '').trim();
            if (identity.id && rowId && identity.id === rowId) return true;
            const rowName = normalizeSegmentName(row[1]);
            return !!rowName && rowName === identity.name;
        });
    }

    // Features that are neither a segment yet nor marked unwanted, sorted A-Z.
    function getUnaccountedFeatures(features, segmentRows, unwantedList) {
        const unwanted = normalizeUnwantedFeatureList(unwantedList);
        return sortFeaturesByName((Array.isArray(features) ? features : []).filter(feature =>
            !isFeatureAccountedFor(feature, segmentRows) && !isFeatureUnwanted(feature, unwanted)));
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

    return {
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
        buildUnwantedFeatureEntry,
        isFeatureUnwanted,
        isFeatureAccountedFor,
        getUnaccountedFeatures,
        markFeaturesUnwanted,
        unmarkFeaturesUnwanted,
        unmarkFeaturesUnwantedByFilteredType,
        formatUnaccountedFeatureNotification
    };
});

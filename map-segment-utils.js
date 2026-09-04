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

    return {
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

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
            'stroke-opacity': Object.prototype.hasOwnProperty.call(attributes, 'stroke-opacity') ? attributes['stroke-opacity'] : null
        };
    }

    function applyCapturedCalTopoFeatureStyle(attributes, style = {}) {
        ['color', 'stroke', 'fill', 'fill-opacity', 'opacity', 'stroke-opacity'].forEach(key => {
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
    
    function ensureSegmentsPageRows(bundle, defaultSegmentsData) {
        if (!bundle.pages) bundle.pages = {};
        if (Array.isArray(bundle.pages.page2)) return bundle.pages.page2;
        bundle.pages.page2 = defaultSegmentsData ? defaultSegmentsData() : [];
        return bundle.pages.page2;
    }

    return {
        getFeatureTypeKey,
        getCalTopoApiObjectType,
        captureCalTopoFeatureStyle,
        applyCapturedCalTopoFeatureStyle,
        buildCalTopoFeatureUpdatePayload,
        getFeatureTypeLabel,
        normalizeSegmentName,
        formatSegmentAssignmentLabel,
        buildSegmentPsrcLookup,
        getFeaturePsrcColor,
        getFeaturePsrcAssignmentStyle,
        filterSegmentImportsByType,
        ensureSegmentsPageRows
    };
});

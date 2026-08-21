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

    function buildCalTopoFeatureUpdatePayload(feature, styleOverrides = {}) {
        const attributes = {...(feature?.attributes || feature?.properties || {})};
        const geometry = feature?.geometry ? JSON.parse(JSON.stringify(feature.geometry)) : null;

        delete attributes.ObjectID;
        delete attributes.id;

        applyCapturedCalTopoFeatureStyle(attributes, styleOverrides);

        return {
            id: feature?.attributes?.id || feature?.id || null,
            type: 'Feature',
            geometry,
            properties: attributes
        };
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

    function buildSegmentPsrcLookup(rows, options = {}) {
        const values = new Map();
        let maxValue = 0;
        
        if (!rows || rows.length === 0) return { values, maxValue };
        
        // Detect if first row is headers
        const firstRow = rows[0].map(h => String(h || '').trim().toLowerCase());
        let regionIdx = firstRow.indexOf('region');
        let segmentIdx = firstRow.findIndex(h => h.startsWith('segment'));
        let psrcIdx = firstRow.findIndex(h => h === 'psrc' || h.startsWith('psrc'));
        let caltopoIdx = firstRow.indexOf('caltopo');
        
        let startRow = 0;
        if (regionIdx !== -1 || segmentIdx !== -1 || psrcIdx !== -1) {
            // It has headers
            startRow = 1;
        } else {
            // Hardcoded indices for our app's internal storage (page2)
            regionIdx = 0;
            segmentIdx = 1;
            psrcIdx = 7;
            caltopoIdx = 9;
            startRow = 0;
        }
        
        for (let i = startRow; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[segmentIdx]) continue;
            
            const region = regionIdx !== -1 ? row[regionIdx] : '';
            const segment = row[segmentIdx];
            const psrcStr = String(row[psrcIdx] || '');
            const psrcMatch = psrcStr.match(/[\d.]+/);
            const caltopoId = caltopoIdx !== -1 ? String(row[caltopoIdx] || '').trim() : '';

            if (!psrcMatch) continue;
            
            const psrc = parseFloat(psrcMatch[0]);
            if (!isNaN(psrc)) {
                const label = formatSegmentAssignmentLabel(region, segment);
                const name = normalizeSegmentName(label);
                
                // Store by name(s)
                values.set(name, psrc);
                values.set(normalizeSegmentName(segment), psrc);
                
                // Store by CalTopo ID if available
                if (caltopoId) {
                    values.set('id:' + caltopoId, psrc);
                }
                
                if (psrc > maxValue) maxValue = psrc;
            }
        }
        
        return { values, maxValue };
    }

    function interpolateColor(color1, color2, factor) {
        const c1 = [
            parseInt(color1.substring(1, 3), 16),
            parseInt(color1.substring(3, 5), 16),
            parseInt(color1.substring(5, 7), 16)
        ];
        const c2 = [
            parseInt(color2.substring(1, 3), 16),
            parseInt(color2.substring(3, 5), 16),
            parseInt(color2.substring(5, 7), 16)
        ];
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
        
        const max = options.usePsriMax ? lookup.maxValue : 100;
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
        
        return { css, value: psrc, ratio };
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

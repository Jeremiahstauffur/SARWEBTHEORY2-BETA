const assert = require('assert');
const mapSegmentUtils = require('./map-segment-utils.js');

console.log('--- Testing SARMapSegmentUtils & CalTopo Object Helpers ---');

// 1. Test getFeatureTypeKey
{
    const assignmentFeature1 = {
        attributes: { class: 'Assignment', id: 'a1' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }
    };
    assert.strictEqual(mapSegmentUtils.getFeatureTypeKey(assignmentFeature1), 'assignment', 'Assignment class should be assignment');

    const assignmentFeature2 = {
        attributes: { id: 'a2' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }
    };
    assert.strictEqual(mapSegmentUtils.getFeatureTypeKey(assignmentFeature2), 'assignment', 'Polygon geometry should be assignment');

    const routeFeature = {
        attributes: { class: 'Shape', id: 'r1' },
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    };
    assert.strictEqual(mapSegmentUtils.getFeatureTypeKey(routeFeature), 'route', 'LineString geometry should be route');

    const markerFeature = {
        attributes: { class: 'Marker', id: 'm1' },
        geometry: { type: 'Point', coordinates: [0, 0] }
    };
    assert.strictEqual(mapSegmentUtils.getFeatureTypeKey(markerFeature), 'marker', 'Point geometry should be marker');
    console.log('  ok - getFeatureTypeKey identifies assignments, routes, and markers correctly');
}

// 2. Test getCalTopoApiObjectType
{
    const f1 = { attributes: { class: 'Assignment', id: '1' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f1), 'Assignment', 'Explicit class Assignment');

    const f2 = { attributes: { class: 'Shape', id: '2' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f2), 'Shape', 'Explicit class Shape');

    const f3 = { attributes: { class: 'Marker', id: '3' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f3), 'Marker', 'Explicit class Marker');

    const f4 = { attributes: { type: 'Assignment', id: '4' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f4), 'Assignment', 'type property Assignment');

    const f5 = { attributes: { assignment: { number: '101' }, id: '5' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f5), 'Assignment', 'assignment property object');

    const f6 = { attributes: { id: '6' }, geometry: { type: 'Polygon' } };
    assert.strictEqual(mapSegmentUtils.getCalTopoApiObjectType(f6), 'Assignment', 'Default for assignment shapes');
    console.log('  ok - getCalTopoApiObjectType resolves Assignment vs Shape endpoints accurately');
}

// 3. Test captureCalTopoFeatureStyle & applyCapturedCalTopoFeatureStyle
{
    const attrs = {
        name: 'Alpha',
        color: '#ff0000',
        stroke: '#ff0000',
        fill: '#00ff00',
        'fill-opacity': 0.35,
        opacity: 0.9,
        'stroke-opacity': 0.85
    };

    const captured = mapSegmentUtils.captureCalTopoFeatureStyle(attrs);
    assert.strictEqual(captured.color, '#ff0000');
    assert.strictEqual(captured.stroke, '#ff0000');
    assert.strictEqual(captured.fill, '#00ff00');
    assert.strictEqual(captured['fill-opacity'], 0.35);
    assert.strictEqual(captured.opacity, 0.9);
    assert.strictEqual(captured['stroke-opacity'], 0.85);

    const targetAttrs = { name: 'Alpha', color: '#111111', stroke: '#111111' };
    mapSegmentUtils.applyCapturedCalTopoFeatureStyle(targetAttrs, {
        color: '#40c057',
        fill: '#40c057',
        'fill-opacity': 0.5
    });

    assert.strictEqual(targetAttrs.color, '#40c057');
    assert.strictEqual(targetAttrs.fill, '#40c057');
    assert.strictEqual(targetAttrs['fill-opacity'], 0.5);

    // Apply null / undefined to remove style
    mapSegmentUtils.applyCapturedCalTopoFeatureStyle(targetAttrs, {
        color: null,
        fill: ''
    });
    assert.strictEqual(targetAttrs.color, undefined);
    assert.strictEqual(targetAttrs.fill, undefined);
    console.log('  ok - captureCalTopoFeatureStyle and applyCapturedCalTopoFeatureStyle handle color/fill/stroke');
}

// 4. Test buildCalTopoFeatureUpdatePayload
{
    const feature = {
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
        attributes: {
            id: 'uuid-1234',
            ObjectID: 42,
            name: 'Segment AB',
            title: 'AB',
            class: 'Assignment',
            fill: '#ff0000'
        }
    };

    const payload = mapSegmentUtils.buildCalTopoFeatureUpdatePayload(feature, {
        color: '#40c057',
        stroke: '#40c057',
        fill: '#40c057',
        'fill-opacity': 0.4
    });

    assert.strictEqual(payload.id, 'uuid-1234', 'Payload top-level id preserved');
    assert.strictEqual(payload.type, 'Feature', 'Payload type is Feature');
    assert.deepStrictEqual(payload.geometry, feature.geometry, 'Geometry is preserved');
    assert.strictEqual(payload.properties.ObjectID, undefined, 'ObjectID deleted from properties');
    assert.strictEqual(payload.properties.id, undefined, 'id deleted from properties');
    assert.strictEqual(payload.properties.color, '#40c057', 'Color override applied');
    assert.strictEqual(payload.properties.stroke, '#40c057', 'Stroke override applied');
    assert.strictEqual(payload.properties.fill, '#40c057', 'Fill override applied');
    assert.strictEqual(payload.properties['fill-opacity'], 0.4, 'Fill opacity override applied');
    assert.strictEqual(payload.properties.title, 'AB', 'Original title preserved');
    assert.strictEqual(payload.properties.class, 'Assignment', 'Original class preserved');
    console.log('  ok - buildCalTopoFeatureUpdatePayload produces valid CalTopo GeoJSON feature payload');
}

// 5. Test PSRc lookup and style generation
{
    const rows = [
        ['North', 'Alpha', '100', '10', '20', '', '', '15.5', '', 'cal-1'],
        ['South', 'Bravo', '200', '20', '20', '', '', '45.0', '', 'cal-2']
    ];

    const lookup = mapSegmentUtils.buildSegmentPsrcLookup(rows);
    assert.strictEqual(lookup.maxValue, 45.0);
    assert.strictEqual(lookup.values.get('north - alpha'), 15.5);
    assert.strictEqual(lookup.values.get('alpha'), 15.5);
    assert.strictEqual(lookup.values.get('id:cal-1'), 15.5);
    assert.strictEqual(lookup.values.get('south - bravo'), 45.0);

    const featureAlpha = {
        attributes: { id: 'cal-1', name: 'Alpha', class: 'Assignment' },
        geometry: { type: 'Polygon' }
    };
    const styleAlpha = mapSegmentUtils.getFeaturePsrcAssignmentStyle(featureAlpha, lookup);
    assert(styleAlpha !== null, 'Style generated for matching segment');
    assert(styleAlpha.stroke.startsWith('#'), 'Stroke is a valid hex color');
    assert.strictEqual(styleAlpha.stroke, styleAlpha.fill, 'Stroke matches fill color');
    console.log('  ok - buildSegmentPsrcLookup and getFeaturePsrcAssignmentStyle compute correct colors');
}

// 5b. Test color scale max source (highest PSRi vs highest PSRc) and gradient placement
{
    // PSRi lives at index 6, PSRc at index 7.
    const rows = [
        ['', 'Alpha', '', '', '', '', '80', '20', '', 'cal-a'],
        ['', 'Bravo', '', '', '', '', '40', '40', '', 'cal-b']
    ];

    const lookup = mapSegmentUtils.buildSegmentPsrcLookup(rows);
    assert.strictEqual(lookup.maxPsrc, 40, 'maxPsrc should be highest PSRc (40)');
    assert.strictEqual(lookup.maxPsri, 80, 'maxPsri should be highest PSRi (80)');
    assert.strictEqual(lookup.maxValue, 40, 'maxValue stays the highest PSRc for backward compatibility');

    const gradient = { lowColor: '#000000', midColor: '#808080', highColor: '#ffffff' };
    const featureAlpha = { attributes: { id: 'cal-a', name: 'Alpha', class: 'Assignment' } };
    const featureBravo = { attributes: { id: 'cal-b', name: 'Bravo', class: 'Assignment' } };

    // Scale to highest PSRc (40): Alpha PSRc 20 -> ratio 0.5 (mid), Bravo PSRc 40 -> ratio 1.0 (high).
    const alphaPsrc = mapSegmentUtils.getFeaturePsrcColor(featureAlpha, lookup, { ...gradient, usePsriMax: false });
    const bravoPsrc = mapSegmentUtils.getFeaturePsrcColor(featureBravo, lookup, { ...gradient, usePsriMax: false });
    assert.strictEqual(alphaPsrc.ratio, 0.5, 'PSRc scale: Alpha ratio is 0.5');
    assert.strictEqual(alphaPsrc.css, '#808080', 'PSRc scale: Alpha renders the mid color');
    assert.strictEqual(bravoPsrc.ratio, 1, 'PSRc scale: Bravo ratio is 1.0');
    assert.strictEqual(bravoPsrc.css, '#ffffff', 'PSRc scale: Bravo renders the high color');
    assert.notStrictEqual(alphaPsrc.css, bravoPsrc.css, 'Different PSRc must produce different colors, not all-max');

    // Scale to highest PSRi (80): Alpha PSRc 20 -> ratio 0.25, Bravo PSRc 40 -> ratio 0.5 (mid).
    const alphaPsri = mapSegmentUtils.getFeaturePsrcColor(featureAlpha, lookup, { ...gradient, usePsriMax: true });
    const bravoPsri = mapSegmentUtils.getFeaturePsrcColor(featureBravo, lookup, { ...gradient, usePsriMax: true });
    assert.strictEqual(alphaPsri.ratio, 0.25, 'PSRi scale: Alpha ratio is 0.25');
    assert.strictEqual(alphaPsri.css, '#404040', 'PSRi scale: Alpha interpolates low->mid at 0.25');
    assert.strictEqual(bravoPsri.ratio, 0.5, 'PSRi scale: Bravo ratio is 0.5');
    assert.strictEqual(bravoPsri.css, '#808080', 'PSRi scale: Bravo renders the mid color');

    assert.deepStrictEqual(bravoPsrc.rgb, [255, 255, 255], 'Color object exposes an rgb array for the map overlay');
    console.log('  ok - color scale honors highest-PSRi vs highest-PSRc setting and spreads gradient by PSRc');
}

// 6. Test CalTopo assignment overlay update simulation (with fallback)
{
    const simulatedCalls = [];
    const mockMap = {
        id: 'M123',
        domain: 'caltopo.com',
        features: [
            {
                attributes: { id: 'assign-1', name: 'Alpha', class: 'Assignment', title: 'Alpha', fill: '#000000' },
                geometry: { type: 'Polygon', coordinates: [] }
            },
            {
                attributes: { id: 'shape-2', name: 'Bravo', class: 'Shape', title: 'Bravo', fill: '#111111' },
                geometry: { type: 'Polygon', coordinates: [] }
            }
        ]
    };

    const mockRows = [
        ['', 'Alpha', '100', '10', '20', '', '', '20.0', '', 'assign-1'],
        ['', 'Bravo', '200', '20', '20', '', '', '40.0', '', 'shape-2']
    ];
    const lookup = mapSegmentUtils.buildSegmentPsrcLookup(mockRows);

    async function mockApiCall(method, endpoint, payload, domain) {
        simulatedCalls.push({ method, endpoint, payload, domain });
        // Suppose endpoint Shape/assign-1 would fail with Error Saving Object, but Assignment/assign-1 succeeds
        if (endpoint.includes('/Shape/assign-1')) {
            return null;
        }
        return { result: { id: payload.id } };
    }

    async function testUpdateOverlay(enabled) {
        for (const feature of mockMap.features) {
            const style = mapSegmentUtils.getFeaturePsrcAssignmentStyle(feature, lookup);
            const overlayStyle = enabled ? {
                color: style.stroke,
                stroke: style.stroke,
                fill: style.fill,
                'fill-opacity': 0.35,
                opacity: 1,
                'stroke-opacity': 1
            } : {};

            const payload = mapSegmentUtils.buildCalTopoFeatureUpdatePayload(feature, overlayStyle);
            const primaryType = mapSegmentUtils.getCalTopoApiObjectType(feature);
            const fallbackType = primaryType === 'Assignment' ? 'Shape' : 'Assignment';

            let endpoint = `/api/v1/map/${mockMap.id}/${primaryType}/${feature.attributes.id}`;
            let res = await mockApiCall('POST', endpoint, payload, mockMap.domain);
            if (!res && fallbackType) {
                endpoint = `/api/v1/map/${mockMap.id}/${fallbackType}/${feature.attributes.id}`;
                res = await mockApiCall('POST', endpoint, payload, mockMap.domain);
            }
            assert(res !== null, `Call for feature ${feature.attributes.id} must succeed`);
        }
    }

    testUpdateOverlay(true).then(() => {
        assert.strictEqual(simulatedCalls.length, 2, 'Two API calls made');
        assert.strictEqual(simulatedCalls[0].endpoint, '/api/v1/map/M123/Assignment/assign-1', 'Assignment object uses Assignment endpoint');
        assert.strictEqual(simulatedCalls[1].endpoint, '/api/v1/map/M123/Shape/shape-2', 'Shape object uses Shape endpoint');
        console.log('  ok - CalTopo overlay update uses correct /Assignment/ and /Shape/ endpoints');
        console.log('\nAll CalTopo overlay tests passed successfully!');
    });
}

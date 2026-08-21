const assert = require('assert');
const mapSegmentUtils = require('./map-segment-utils.js');

console.log('--- Testing CalTopo payload geometry sanitization ---');

{
    const invalidGeometryFeature = {
        geometry: {
            id: 'assign-1',
            class: 'Assignment',
            title: 'Alpha Segment',
            assignment: { number: 'A1' }
        },
        attributes: {
            id: 'assign-1',
            class: 'Assignment',
            title: 'Alpha Segment',
            fill: '#000000'
        }
    };

    const payload = mapSegmentUtils.buildCalTopoFeatureUpdatePayload(invalidGeometryFeature, {
        color: '#40c057',
        fill: '#40c057',
        'fill-opacity': 0.35
    });

    assert.strictEqual(payload.id, 'assign-1', 'Payload should preserve top-level object id');
    assert.strictEqual(payload.type, 'Feature', 'Payload should remain a Feature');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(payload, 'geometry'),
        false,
        'Invalid non-GeoJSON geometry objects must be excluded from update payloads'
    );
    assert.strictEqual(payload.properties.class, 'Assignment', 'Properties should still include assignment class');
    assert.strictEqual(payload.properties.color, '#40c057', 'Style override should be applied');
}

{
    const validGeometryFeature = {
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
        attributes: { id: 'shape-2', class: 'Shape', name: 'Bravo' }
    };

    const payload = mapSegmentUtils.buildCalTopoFeatureUpdatePayload(validGeometryFeature, {
        color: '#ff0000'
    });

    assert.deepStrictEqual(
        payload.geometry,
        validGeometryFeature.geometry,
        'Valid GeoJSON geometry must still be preserved'
    );
}

console.log('All CalTopo payload geometry sanitization checks passed.');
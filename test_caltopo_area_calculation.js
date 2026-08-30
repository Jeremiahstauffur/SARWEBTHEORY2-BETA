const assert = require('assert');
const mapSegmentUtils = require('./map-segment-utils.js');

console.log('--- Testing CalTopo polygon area calculation ---');

const { polygonAreaAcres } = mapSegmentUtils;

// A small ~1.7-acre rectangle expressed with realistic high-magnitude lon/lat
// coordinates (CalTopo assignments live in the Pacific Northwest, ~-122 lon / 47 lat).
// Side lengths chosen so the true area is ~1.7 acres.
const lon0 = -122.0;
const lat0 = 47.0;
const dLat = 0.000745;                       // ~0.0515 mi north-south
const dLon = 0.001093;                       // ~0.0515 mi east-west at lat 47

// Open ring: the first vertex is NOT repeated at the end (the bug case).
const openRing = [
    [lon0, lat0],
    [lon0 + dLon, lat0],
    [lon0 + dLon, lat0 + dLat],
    [lon0, lat0 + dLat]
];

// Closed ring: the same polygon with the first vertex repeated (valid GeoJSON).
const closedRing = openRing.concat([openRing[0]]);

{
    // The bug: an open ring must NOT inflate to hundreds of acres.
    const area = polygonAreaAcres([openRing]);
    assert.ok(
        area > 1.5 && area < 1.9,
        `Open-ring ~1.7-acre polygon should compute ~1.7 acres, got ${area}`
    );
    assert.ok(
        area < 10,
        `Open-ring polygon must not inflate to hundreds of acres (regression of 615-acre bug), got ${area}`
    );
}

{
    // Regression guard: an already-closed GeoJSON ring is unaffected.
    const area = polygonAreaAcres([closedRing]);
    assert.ok(
        area > 1.5 && area < 1.9,
        `Closed-ring ~1.7-acre polygon should compute ~1.7 acres, got ${area}`
    );
}

{
    // Consistency: open and closed representations of the same shape are equal.
    const openArea = polygonAreaAcres([openRing]);
    const closedArea = polygonAreaAcres([closedRing]);
    assert.ok(
        Math.abs(openArea - closedArea) < 1e-6,
        `Open and closed representations must return equal area, got ${openArea} vs ${closedArea}`
    );
}

{
    // MultiPolygon-style summing: two identical rings sum to twice the area.
    const single = polygonAreaAcres([openRing]);
    const doubled = polygonAreaAcres([openRing, closedRing]);
    assert.ok(
        Math.abs(doubled - 2 * single) < 1e-6,
        `Two rings should sum to twice the single-ring area, got ${doubled} vs ${2 * single}`
    );
}

{
    // Degenerate ring (< 3 points) yields 0 and does not throw.
    assert.strictEqual(polygonAreaAcres([[[lon0, lat0], [lon0 + dLon, lat0]]]), 0, 'Degenerate ring should be 0 acres');
    assert.strictEqual(polygonAreaAcres([]), 0, 'No rings should be 0 acres');
    assert.strictEqual(polygonAreaAcres(null), 0, 'Null input should be 0 acres');
}

console.log('All CalTopo polygon area calculation checks passed.');

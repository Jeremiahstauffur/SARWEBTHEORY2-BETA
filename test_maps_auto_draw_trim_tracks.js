// Maps page tools: "Auto Draw Segments" and "Trim Tracks".
//
// Part 1 drives the shared module (map-segment-utils.js) directly:
//   - the slice count for a total acreage (fewest slices at or under 15 acres,
//     flagged when they come out under 10),
//   - cutting planar rings along a vertical line (a square, a C shape that
//     falls into two pieces on one side, a vertex sitting on the line),
//   - equal-area slices of a rectangle in every direction (areas preserved,
//     pieces ordered west to east / north to south), a MultiPolygon, no area,
//   - cutting a track path by the segment shapes it crosses, the portions per
//     segment / outside, trimming with one part left, split into two, extras
//     (altitude, time) interpolated at the cut points, part names.
// Part 2 runs the real app.js in a sandbox (in-memory store, fake DOM, fake
// sync server, caltopo_api_call recorded instead of sent):
//   - drawing the slices: one Assignment POST per piece (Shape when the
//     Assignment class is refused), the case's copy of the map extended, the
//     log entry; nothing changes when every POST is refused,
//   - the Auto Draw popup: rows, direction pills, the angle pill, the preview
//     and the confirm button,
//   - trimming: the in-place POST with the trimmed line and the re-measured
//     Searchers Tracks record; a split into "p1" / "p2" Shape lines followed
//     by the DELETE of the original, records and the color push's style record
//     replaced; a refused delete is reported; nothing-left is refused,
//   - the Trim Tracks popup: portion pills, the result cell, confirm,
//   - the static wiring: the two buttons in buildMapsPage, the stylesheet.
//
// Run with: node test_maps_auto_draw_trim_tracks.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const utils = require('./map-segment-utils');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CASE = 'Tools-1';
const PROXY_URL = 'http://localhost:3000/api/proxy';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

// ---------------------------------------------------------------------------
// Geometry: everything sits around 45 N 93 W. The module's plane counts
// 69.172 miles per degree of latitude (and cos 45 of that per degree of
// longitude), so a point can be placed by its offset in miles from the origin
// and areas come out in whole acres (1 sq mi = 640 acres).
// ---------------------------------------------------------------------------
const ORIGIN = {lat: 45.0, lng: -93.0};
const MILE_LAT = 1 / 69.172;
const MILE_LNG = MILE_LAT / Math.cos(ORIGIN.lat * Math.PI / 180);
const at = (eastMiles, northMiles) => [ORIGIN.lng + eastMiles * MILE_LNG, ORIGIN.lat + northMiles * MILE_LAT];
const east = (point) => (point[0] - ORIGIN.lng) / MILE_LNG;
const north = (point) => (point[1] - ORIGIN.lat) / MILE_LAT;
// A closed rectangle `width` x `height` miles with its south-west corner at (x0, y0).
const rect = (x0, y0, width, height) => [at(x0, y0), at(x0 + width, y0), at(x0 + width, y0 + height), at(x0, y0 + height), at(x0, y0)];
const square = (eastMiles, size = 1, northMiles = 0) => rect(eastMiles - size / 2, northMiles - size / 2, size, size);
const polygon = (ring) => ({type: 'Polygon', coordinates: [ring]});
// The 1 mi x 0.1 mi rectangle = 64 acres: five slices of 12.8 acres.
const AREA_SHAPE = {geometry: polygon(rect(0, 0, 1, 0.1)), attributes: {id: 'area-1', name: 'Alpha', class: 'Assignment', ObjectID: 1, stroke: '#ff9900', fill: '#ff9900', 'fill-opacity': 0.2, 'stroke-width': 3, folderId: 'folder-7'}};
// Segment 4D is the unit square around the origin, 4C the unit square right
// next to it on the east; the track walks due east: half a mile outside, the
// whole mile of 4D, then 0.4 mi into 4C.
const SEG_4D_SHAPE = {geometry: polygon(square(0)), attributes: {id: 'seg-4d', name: '4D', class: 'Assignment', ObjectID: 1}};
const SEG_4C_SHAPE = {geometry: polygon(square(1)), attributes: {id: 'seg-4c', name: '4C', class: 'Assignment', ObjectID: 2}};
const trackFeature = (name = 'Team 1', id = 'trk-1', cls = 'AppTrack') => ({
    geometry: {type: 'LineString', coordinates: [at(-1.0, 0), at(-0.5, 0), at(0.2, 0), at(0.9, 0)]},
    attributes: {id, name, title: name, class: cls, ObjectID: 3, stroke: '#8b0000', 'stroke-width': 2}
});
const acresOf = (ring) => utils.polygonAreaAcres([ring]);

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('computeAutoDrawSliceCount: the fewest equal slices at or under 15 acres, flagged when under 10', () => {
    assert.strictEqual(utils.AUTO_DRAW_MIN_ACRES, 10);
    assert.strictEqual(utils.AUTO_DRAW_MAX_ACRES, 15);
    const table = [
        [100, 7, false], [30, 2, false], [31, 3, false], [29, 2, false], [45, 3, false], [64, 5, false],
        [12, 1, false], [15, 1, false], [8, 1, true], [19, 2, true], [15.5, 2, true], [20, 2, false]
    ];
    table.forEach(([total, count, undersized]) => {
        const sizing = utils.computeAutoDrawSliceCount(total);
        assert.strictEqual(sizing.count, count, `${total} acres -> ${count} slices`);
        assert.strictEqual(sizing.undersized, undersized, `${total} acres undersized = ${undersized}`);
        near(sizing.acresEach * count, total, 1e-9, `${total} acres: the slices add up`);
        assert.ok(sizing.acresEach <= 15 + 1e-9, `${total} acres: no slice over 15`);
    });
    assert.deepStrictEqual(utils.computeAutoDrawSliceCount(0).count, 0);
    assert.deepStrictEqual(utils.computeAutoDrawSliceCount('x').count, 0);
    // The bounds can be overridden (a max under the min is lifted to it).
    assert.strictEqual(utils.computeAutoDrawSliceCount(100, {minAcres: 20, maxAcres: 25}).count, 4);
    assert.strictEqual(utils.computeAutoDrawSliceCount(100, {minAcres: 30, maxAcres: 25}).count, 4);
});

check('splitRingsByVerticalLine: a square, a C shape in two pieces on one side, a vertex on the line', () => {
    const area = (rings) => rings.reduce((sum, ring) => {
        let a = 0;
        for (let i = 0; i < ring.length; i++) {
            const p = ring[i];
            const q = ring[(i + 1) % ring.length];
            a += p[0] * q[1] - q[0] * p[1];
        }
        return sum + Math.abs(a) / 2;
    }, 0);
    const unit = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const split = utils.splitRingsByVerticalLine([unit], 0.3);
    assert.strictEqual(split.left.length, 1);
    assert.strictEqual(split.right.length, 1);
    near(area(split.left), 0.3, 1e-12, 'the left 30 %');
    near(area(split.right), 0.7, 1e-12, 'the right 70 %');
    assert.ok(split.left[0].every(p => p[0] <= 0.3 + 1e-12) && split.right[0].every(p => p[0] >= 0.3 - 1e-12), 'each side stays on its side');
    // Entirely on one side.
    assert.deepStrictEqual(utils.splitRingsByVerticalLine([unit], 2).right, []);
    assert.strictEqual(utils.splitRingsByVerticalLine([unit], 2).left.length, 1);
    assert.strictEqual(utils.splitRingsByVerticalLine([unit], -1).left.length, 0);
    // A C opening east, cut through the gap: the spine stays one piece on the
    // left, the two arm tips are two pieces on the right.
    const cShape = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3]];
    const cSplit = utils.splitRingsByVerticalLine([cShape], 2);
    assert.strictEqual(cSplit.left.length, 1, 'one piece on the left');
    assert.strictEqual(cSplit.right.length, 2, 'two pieces on the right');
    near(area(cSplit.left), 7 - 2, 1e-12, 'the spine and the arm bases');
    near(area(cSplit.right), 2, 1e-12, 'the two arm tips');
    assert.ok(cSplit.right.every(ring => ring.length === 4), 'each tip is a plain rectangle');
    near(area(cSplit.left) + area(cSplit.right), 7, 1e-12, 'nothing lost');
    // Vertices exactly on the line: the cut is nudged by a hair and both sides
    // still come out whole.
    const twoSquares = [unit, [[1, 0], [2, 0], [2, 1], [1, 1]]];
    const nudged = utils.splitRingsByVerticalLine(twoSquares, 1);
    assert.ok(nudged.x !== 1 && Math.abs(nudged.x - 1) < 1e-5, 'nudged off the vertices');
    assert.strictEqual(nudged.left.length + nudged.right.length, 3, 'the first square is cut by the hair, the second is whole');
    near(area(nudged.left) + area(nudged.right), 2, 1e-9, 'nothing lost');
    // Rubbish in, nothing out.
    assert.deepStrictEqual(utils.splitRingsByVerticalLine([[[0, 0], [1, 1]]], 0.5), {left: [], right: [], x: 0.5});
    assert.deepStrictEqual(utils.splitRingsByVerticalLine(null, 0.5), {left: [], right: [], x: 0.5});
});

check('planAutoDrawSegments: five equal slices of the 64-acre rectangle, vertical, horizontal and at an angle', () => {
    near(acresOf(AREA_SHAPE.geometry.coordinates[0]), 64, 0.01, 'the source is 64 acres');
    const vertical = utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: 0});
    assert.strictEqual(vertical.ok, true);
    assert.strictEqual(vertical.count, 5);
    assert.strictEqual(vertical.pieces.length, 5, 'a rectangle leaves one piece per slice');
    near(vertical.totalAcres, 64, 0.01, 'total');
    near(vertical.acresEach, 12.8, 0.01, 'each');
    assert.strictEqual(vertical.undersized, false);
    assert.strictEqual(vertical.angleDegrees, 0);
    vertical.pieces.forEach((piece, i) => {
        assert.strictEqual(piece.index, i + 1);
        assert.strictEqual(piece.strip, i + 1);
        near(piece.acres, 12.8, 0.02, `piece ${i + 1} acres (stored)`);
        near(acresOf(piece.ring), 12.8, 0.02, `piece ${i + 1} acres (measured on the ring)`);
        const first = piece.ring[0];
        const last = piece.ring[piece.ring.length - 1];
        assert.deepStrictEqual(first, last, 'the ring is closed');
        const decimals = value => (String(value).split('.')[1] || '').length;
        assert.ok(piece.ring.every(p => decimals(p[0]) <= 7 && decimals(p[1]) <= 7), 'coordinates to 7 decimals');
    });
    // Vertical slices are strips 0.2 mi wide, numbered west to east.
    const centreEast = piece => piece.ring.slice(0, -1).reduce((s, p) => s + east(p), 0) / (piece.ring.length - 1);
    const centreNorth = piece => piece.ring.slice(0, -1).reduce((s, p) => s + north(p), 0) / (piece.ring.length - 1);
    vertical.pieces.forEach((piece, i) => near(centreEast(piece), 0.1 + 0.2 * i, 0.001, `vertical piece ${i + 1} sits at ${0.1 + 0.2 * i} mi east`));

    // Horizontal: strips 0.02 mi tall, numbered north to south.
    const horizontal = utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: 90});
    assert.strictEqual(horizontal.pieces.length, 5);
    horizontal.pieces.forEach((piece, i) => {
        near(acresOf(piece.ring), 12.8, 0.02, `horizontal piece ${i + 1} acres`);
        near(centreNorth(piece), 0.1 - 0.01 - 0.02 * i, 0.001, `horizontal piece ${i + 1} sits at ${0.1 - 0.01 - 0.02 * i} mi north`);
    });

    // At an angle: still five equal areas, nothing lost, the angle kept.
    const angled = utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: 45});
    assert.strictEqual(angled.angleDegrees, 45);
    assert.strictEqual(angled.pieces.length, 5);
    angled.pieces.forEach((piece, i) => near(acresOf(piece.ring), 12.8, 0.05, `angled piece ${i + 1} acres`));
    near(angled.pieces.reduce((s, p) => s + acresOf(p.ring), 0), 64, 0.05, 'the angled pieces add up');
    assert.ok(angled.pieces[0].ring.length >= 4, 'an angled cut leaves a real polygon');
    // Angles wrap; rubbish means vertical.
    assert.strictEqual(utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: 405}).angleDegrees, 45);
    assert.strictEqual(utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: -90}).angleDegrees, 270);
    assert.strictEqual(utils.planAutoDrawSegments(AREA_SHAPE, {angleDegrees: 'x'}).angleDegrees, 0);
});

check('planAutoDrawSegments: a concave outline, a MultiPolygon, a small shape, no area', () => {
    // A C of 3 x 3 miles with a 2 x 1 mile gap (7 sq mi = 4480 acres): one
    // vertical cut through the gap leaves a strip in two pieces, so more
    // pieces than slices come out and every piece is numbered.
    const cRing = [at(0, 0), at(3, 0), at(3, 1), at(1, 1), at(1, 2), at(3, 2), at(3, 3), at(0, 3), at(0, 0)];
    const plan = utils.planAutoDrawSegments({geometry: polygon(cRing)}, {angleDegrees: 0});
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.count, Math.ceil(plan.totalAcres / 15));
    assert.ok(plan.pieces.length > plan.count, 'the gap leaves extra pieces');
    // The stored acres are measured on the plan's plane (the source's first
    // vertex as the scale reference) and add up to the shape within their
    // 2-decimal rounding; measuring every piece on its own (polygonAreaAcres
    // takes the piece's own latitude as the reference) drifts by cos(lat) over
    // a 3-mile-tall shape - well under 0.1 %.
    near(plan.pieces.reduce((s, p) => s + p.acres, 0), plan.totalAcres, plan.pieces.length * 0.005, 'the stored acres add up to the shape');
    near(plan.pieces.reduce((s, p) => s + acresOf(p.ring), 0), plan.totalAcres, plan.totalAcres * 0.001, 'the pieces measured on their own add up within 0.1 %');
    assert.deepStrictEqual(plan.pieces.map(p => p.index), plan.pieces.map((p, i) => i + 1), 'numbered 1..n');
    assert.ok(plan.pieces.every((p, i, all) => i === 0 || p.strip >= all[i - 1].strip), 'in strip order');
    // Two separate squares (a MultiPolygon) are cut together: 1280 acres -> 86 slices.
    const multi = utils.planAutoDrawSegments({geometry: {type: 'MultiPolygon', coordinates: [[square(0)], [square(3)]]}}, {angleDegrees: 0});
    assert.strictEqual(multi.ok, true);
    near(multi.totalAcres, 1280, 0.3, 'both squares (the scale reference is the south-west corner, half a mile below the centre: 0.013 %)');
    assert.strictEqual(multi.count, 86);
    near(multi.pieces.reduce((s, p) => s + acresOf(p.ring), 0), 1280, 0.5, 'nothing lost across the two squares');
    // A shape already under the maximum is one slice (the whole shape).
    const small = utils.planAutoDrawSegments({geometry: polygon(rect(0, 0, 0.1, 0.1))}, {angleDegrees: 0});
    assert.strictEqual(small.count, 1);
    assert.strictEqual(small.pieces.length, 1);
    near(small.totalAcres, 6.4, 0.01, '6.4 acres');
    assert.strictEqual(small.undersized, true);
    // No area at all.
    const line = utils.planAutoDrawSegments({geometry: {type: 'LineString', coordinates: [at(0, 0), at(1, 0)]}}, {angleDegrees: 0});
    assert.deepStrictEqual([line.ok, line.reason, line.pieces], [false, 'no-area', []]);
    assert.strictEqual(utils.planAutoDrawSegments(null).ok, false);
    assert.strictEqual(utils.planAutoDrawSegments({geometry: polygon([at(0, 0), at(1, 0)])}).ok, false, 'two points are no ring');
    assert.strictEqual(utils.buildAutoDrawSegmentName('Alpha', 3), 'Alpha-3');
    assert.strictEqual(utils.buildAutoDrawSegmentName('  ', 1), 'Segment-1');
});

const SEGMENTS = [{key: 'r1|4d', geometry: SEG_4D_SHAPE.geometry}, {key: 'r1|4c', geometry: SEG_4C_SHAPE.geometry}];

check('slicePathBySegments / summarizeTrackPortions: the track falls into outside, 4D and 4C pieces with exact cut points', () => {
    const path = trackFeature().geometry.coordinates;
    const pieces = utils.slicePathBySegments(path, SEGMENTS);
    assert.deepStrictEqual(pieces.map(p => p.keys), [[], ['r1|4d'], ['r1|4c']], 'outside, then 4D, then 4C');
    near(pieces[0].miles, 0.5, 0.005, 'half a mile outside');
    near(pieces[1].miles, 1, 0.005, 'the mile of 4D');
    near(pieces[2].miles, 0.4, 0.005, '0.4 mi of 4C');
    near(east(pieces[0].points[pieces[0].points.length - 1]), -0.5, 1e-6, 'cut at the west edge of 4D');
    near(east(pieces[1].points[pieces[1].points.length - 1]), 0.5, 1e-6, 'cut at the shared edge');
    assert.deepStrictEqual(pieces[1].points[0], pieces[0].points[pieces[0].points.length - 1], 'consecutive pieces share their cut point');
    assert.strictEqual(pieces[1].points.length, 3, 'entry, the vertex at 0.2 mi, exit');
    const portions = utils.summarizeTrackPortions([path], SEGMENTS);
    assert.deepStrictEqual(portions.map(p => p.key), ['', 'r1|4d', 'r1|4c']);
    near(portions[0].miles, 0.5, 0.005, 'outside');
    near(portions[1].miles, 1, 0.005, '4D');
    near(portions[2].miles, 0.4, 0.005, '4C');
    // Without segments everything is outside; a single point is nothing.
    assert.deepStrictEqual(utils.summarizeTrackPortions([path], []).map(p => p.key), ['']);
    assert.deepStrictEqual(utils.slicePathBySegments([at(0, 0)], SEGMENTS), []);
    // A leg that leaves and comes back: two outside pieces around one inside piece.
    const back = utils.slicePathBySegments([at(-1, 0), at(0, 0), at(0, 1), at(0, 0)], [SEGMENTS[0]]);
    assert.deepStrictEqual(back.map(p => p.keys), [[], ['r1|4d'], [], ['r1|4d']]);
    // Overlapping segments: a piece in both carries both keys and counts for both.
    const overlap = utils.summarizeTrackPortions([[at(-0.2, 0), at(0.2, 0)]], [SEGMENTS[0], {key: 'twin', geometry: SEG_4D_SHAPE.geometry}]);
    assert.deepStrictEqual(overlap.map(p => p.key).sort(), ['r1|4d', 'twin']);
    near(overlap[0].miles, 0.4, 0.005, 'both get the 0.4 mi');
});

check('trimTrackPaths: cutting the ends leaves one part, cutting the middle splits the track, extras are interpolated', () => {
    const path = trackFeature().geometry.coordinates;
    // The outside half mile goes: one part from the edge of 4D to the end.
    const outside = utils.trimTrackPaths([path], SEGMENTS, {outside: true});
    assert.strictEqual(outside.parts.length, 1);
    near(outside.removedMiles, 0.5, 0.005, 'removed');
    near(outside.keptMiles, 1.4, 0.005, 'kept');
    near(east(outside.parts[0][0]), -0.5, 1e-6, 'starts at the west edge of 4D');
    near(east(outside.parts[0][outside.parts[0].length - 1]), 0.9, 1e-6, 'ends where the track ended');
    assert.strictEqual(outside.parts[0].length, 4, 'the cut point at the edge of 4D, the vertex at 0.2 mi, the shared edge, the end');
    // The 4D mile goes: two parts, before and after it.
    const middle = utils.trimTrackPaths([path], SEGMENTS, {segmentKeys: ['r1|4d']});
    assert.strictEqual(middle.parts.length, 2);
    near(middle.removedMiles, 1, 0.005, 'removed');
    near(utils.pathLengthMiles(middle.parts[0]), 0.5, 0.005, 'part 1');
    near(utils.pathLengthMiles(middle.parts[1]), 0.4, 0.005, 'part 2');
    near(east(middle.parts[1][0]), 0.5, 1e-6, 'part 2 starts at the shared edge');
    // Both segments: only the outside half mile is left.
    const both = utils.trimTrackPaths([path], SEGMENTS, {segmentKeys: ['r1|4d', 'r1|4c']});
    assert.strictEqual(both.parts.length, 1);
    near(both.keptMiles, 0.5, 0.005, 'kept');
    // Everything: nothing left.
    const all = utils.trimTrackPaths([path], SEGMENTS, {segmentKeys: ['r1|4d', 'r1|4c'], outside: true});
    assert.deepStrictEqual(all.parts, []);
    near(all.removedMiles, 1.9, 0.005, 'all removed');
    // Nothing selected: the track as it was.
    const none = utils.trimTrackPaths([path], SEGMENTS, {});
    assert.strictEqual(none.parts.length, 1);
    assert.deepStrictEqual(none.parts[0], path);
    // Altitude and time ride along and are interpolated at a cut point.
    const stamped = [[...at(-1, 0), 100, 1000], [...at(1, 0), 300, 3000]];
    const trimmed = utils.trimTrackPaths([stamped], [SEGMENTS[0]], {outside: true});
    assert.strictEqual(trimmed.parts.length, 1);
    assert.strictEqual(trimmed.parts[0].length, 2);
    near(trimmed.parts[0][0][2], 150, 1e-6, 'altitude at the west edge');
    near(trimmed.parts[0][0][3], 1500, 1e-6, 'time at the west edge');
    near(trimmed.parts[0][1][2], 250, 1e-6, 'altitude at the east edge');
    // Two paths (a MultiLineString) are trimmed one by one.
    const twoPaths = utils.trimTrackPaths([path, [at(-3, 0), at(-2, 0)]], SEGMENTS, {segmentKeys: ['r1|4d']});
    assert.strictEqual(twoPaths.parts.length, 3);
    assert.strictEqual(utils.buildTrimmedTrackPartName('Team 1', 2), 'Team 1 p2');
    assert.strictEqual(utils.buildTrimmedTrackPartName('', 1), 'Track p1');
});

// ---------------------------------------------------------------------------
// Part 2: app.js in a sandbox
// ---------------------------------------------------------------------------

function makeElement(depth = 0) {
    const classes = new Set();
    const el = {
        style: {setProperty() {}, removeProperty() {}},
        dataset: {},
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            contains: (c) => classes.has(c),
            toggle: (c, force) => { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); }
        },
        children: [],
        appendChild(child) { el.children.push(child); return child; },
        append() {},
        remove() {},
        addEventListener(type, fn) { (el.listeners = el.listeners || {})[type] = fn; },
        removeEventListener() {},
        setAttribute(name, value) { (el.attributes = el.attributes || {})[name] = String(value); },
        getAttribute: (name) => (el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, name) ? el.attributes[name] : null),
        querySelector: () => { const child = makeElement(depth + 1); el.children.push(child); return child; },
        querySelectorAll: () => [],
        insertBefore(child) { el.children.push(child); return child; },
        after() {},
        focus() {},
        blur() {},
        closest: () => null,
        scrollIntoView() {},
        getBoundingClientRect: () => ({left: 0, top: 0, width: 0, height: 0}),
        clientWidth: 300,
        clientHeight: 150,
        textContent: ''
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set: (value) => { html = String(value); el.children = []; }
    });
    Object.defineProperty(el, 'parentElement', {
        get: () => (depth >= 3 ? null : (el._parent = el._parent || makeElement(depth + 1)))
    });
    Object.defineProperty(el, 'className', {
        get: () => Array.from(classes).join(' '),
        set: (value) => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); }
    });
    return el;
}

// Every element in a subtree (children only; innerHTML strings are not parsed).
const walk = (el, out = []) => {
    (el.children || []).forEach(child => { out.push(child); walk(child, out); });
    return out;
};
const byClass = (root, cls) => walk(root).filter(el => el.classList.contains(cls));

function createSandbox({store, fetch, page = 'page10'} = {}) {
    const localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
    const sessionData = {};
    const sessionStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionData, k) ? sessionData[k] : null),
        setItem: (k, v) => { sessionData[k] = String(v); },
        removeItem: (k) => { delete sessionData[k]; }
    };
    const cookieJar = {'sar-user-name-v1': 'tester', 'sar-user-password-v1': '1234'};
    const byId = {};
    const body = makeElement();
    body.dataset.page = page;
    const document = {
        get cookie() { return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; '); },
        set cookie(value) {
            const [pair] = String(value).split(';');
            const idx = pair.indexOf('=');
            if (idx <= 0) return;
            cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
        },
        body,
        documentElement: makeElement(),
        head: makeElement(),
        readyState: 'complete',
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        createElement: () => makeElement(),
        createElementNS: () => makeElement(),
        createTextNode: () => makeElement(),
        createRange: () => ({selectNodeContents() {}}),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const logs = {warn: [], error: [], alerts: []};
    const sandbox = {
        console: {
            log() {}, info() {},
            warn: (...args) => logs.warn.push(args.map(String).join(' ')),
            error: (...args) => logs.error.push(args.map(String).join(' '))
        },
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        localStorage,
        sessionStorage,
        SAR_MEMORY_STORAGE: store,
        document,
        navigator: {userAgent: 'node', onLine: true},
        addEventListener() {},
        removeEventListener() {},
        getSelection: () => ({removeAllRanges() {}, addRange() {}}),
        matchMedia: () => ({matches: false, addListener() {}, addEventListener() {}}),
        fetch: (url, init) => fetch(url, init),
        alert: (msg) => { logs.alerts.push(String(msg)); },
        confirm: () => true,
        AbortController: class { constructor() { this.signal = {}; } abort() {} },
        FormData: class FormData {},
        URL,
        URLSearchParams,
        location: {
            hostname: 'localhost', protocol: 'http:', origin: 'http://localhost', search: '',
            pathname: `/${page}.html`,
            get href() { return `http://localhost/${page}.html`; },
            set href(_value) {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(utilsSource, sandbox, {filename: 'map-segment-utils.js'});
    vm.runInContext(deltaSource, sandbox, {filename: 'sync-delta.js'});
    vm.runInContext(appSource, sandbox, {filename: 'app.js'});
    // CalTopo writes are recorded instead of sent. The default answer is what
    // the Team API gives: {status, result} with the id of a created object.
    const posted = [];
    let created = 0;
    sandbox.caltopo_api_call = async (method, endpoint, payload, domain) => {
        posted.push({method, endpoint, payload: plain(payload), domain});
        if (sandbox.__caltopoAnswer) return sandbox.__caltopoAnswer(method, endpoint, payload);
        if (method === 'DELETE') return {status: 'ok'};
        if (/\/api\/v1\/map\/[^/]+\/[^/]+$/.test(endpoint)) return {status: 'ok', result: {id: `new-${++created}`, type: 'Feature'}};
        return {status: 'ok', result: {id: payload && payload.id}};
    };
    sandbox.__posted = posted;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A sync server that accepts every row batch; the CalTopo proxy has no
// shapes (so the quiet re-fetch after a write leaves the case's copy alone).
function createServer() {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (text.startsWith(PROXY_URL)) return json({features: []});
        if (/declined-assignments/.test(text)) return json({declined: []});
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {fetch, requests, proxyFetches: () => requests.filter(r => r.url.startsWith(PROXY_URL)).length};
}

const SEG = (name, caltopoId = '') => ['R1', name, '640 ac', '1 mi', '100 ft', '', '', '', '', caltopoId];
const ROW = (task, date, time, segment, team = 'Team A (2)', sweep = '100 ft', sweeps = '2') => [task, date, time, 'R1', segment, '', '', team, sweep, sweeps];
const TRACK = (id, baseName, segmentMiles, assignedTask = '') => ({id, featureId: id, baseName, caltopoName: baseName, type: 'Track', lengthMiles: 1.9, pointCount: 4, segmentMiles, assignedTask});

function seedStore({features, segments, searchLog, tracks, overlayOriginals} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', '']], voterVisibility: [true]};
    bundle.pages.page2 = segments || [SEG('4D', 'seg-4d'), SEG('4C', 'seg-4c')];
    bundle.pages.page4 = searchLog || [ROW('#1', '09-01-2026', '08:00', '4D'), ROW('#2', '09-01-2026', '09:00', '4C')];
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature()]}];
    if (overlayOriginals) bundle.maps[0].caltopoAssignmentOverlayState = {originals: overlayOriginals, updatedAt: 1};
    if (tracks) bundle.searcherTracks = tracks;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };
const featureNames = (app) => plain(app.getMapFeatures(app.loadBundle()).map(app.getMapFeatureDisplayName));
const deepHtml = (el) => (el.innerHTML || '') + (el.children || []).map(deepHtml).join('');
const toasts = (app) => app.__body.children.filter(el => /notif-toast/.test(el.className || '')).map(deepHtml);

check('drawAutoDrawSegments: one Assignment POST per slice in the source\'s style, the case\'s copy extended, the log entry', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({features: [AREA_SHAPE, SEG_4D_SHAPE]}), fetch: server.fetch});
    const source = app.getMapFeatures(app.loadBundle())[0];
    const plan = app.planAutoDrawSegments(source, {angleDegrees: 0});
    assert.strictEqual(plan.count, 5);
    const progress = [];
    const outcome = await app.drawAutoDrawSegments(source, plan, {onProgress: (done, total) => progress.push(`${done}/${total}`)});
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors: ${app.__logs.error.join(' | ')}`);
    assert.strictEqual(outcome.created.length, 5);
    assert.deepStrictEqual(plain(outcome.errors), []);
    assert.deepStrictEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);

    const posts = app.__posted;
    assert.strictEqual(posts.length, 5, 'one POST per slice');
    posts.forEach((post, i) => {
        assert.strictEqual(post.method, 'POST');
        assert.strictEqual(post.endpoint, '/api/v1/map/MAP1/Assignment', 'created as an Assignment, no object id in the URL');
        assert.strictEqual(post.domain, 'caltopo.com');
        assert.strictEqual(post.payload.type, 'Feature');
        assert.strictEqual(post.payload.id, null);
        assert.strictEqual(post.payload.geometry.type, 'Polygon');
        assert.strictEqual(post.payload.geometry.coordinates.length, 1, 'one ring');
        near(utils.polygonAreaAcres(post.payload.geometry.coordinates), 12.8, 0.02, `slice ${i + 1} is 12.8 acres`);
        assert.strictEqual(post.payload.properties.title, `Alpha-${i + 1}`);
        assert.strictEqual(post.payload.properties.stroke, '#ff9900', 'the source\'s stroke');
        assert.strictEqual(post.payload.properties.fill, '#ff9900');
        assert.strictEqual(post.payload.properties['fill-opacity'], 0.2);
        assert.strictEqual(post.payload.properties['stroke-width'], 3);
        assert.strictEqual(post.payload.properties.folderId, 'folder-7', 'the source\'s folder');
        assert.ok(/Auto-drawn from "Alpha" \(vertical slices\): segment \d of 5, 12\.8 acres\./.test(post.payload.properties.description), post.payload.properties.description);
        assert.ok(!('id' in post.payload.properties) && !('ObjectID' in post.payload.properties) && !('class' in post.payload.properties), 'nothing of the source\'s identity');
    });

    // The case's copy of the map has the five slices, with CalTopo's ids.
    assert.deepStrictEqual(featureNames(app), ['Alpha', '4D', 'Alpha-1', 'Alpha-2', 'Alpha-3', 'Alpha-4', 'Alpha-5']);
    const added = app.getMapFeatures(app.loadBundle()).slice(2);
    assert.deepStrictEqual(plain(added.map(f => f.attributes.id)), ['new-1', 'new-2', 'new-3', 'new-4', 'new-5']);
    assert.ok(added.every(f => f.attributes.class === 'Assignment' && f.geometry.type === 'Polygon'));
    assert.deepStrictEqual(plain(added.map(f => f.attributes.ObjectID)), [3, 4, 5, 6, 7]);
    // ... and they are unaccounted assignments, ready to be imported below the map.
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['Alpha', 'Alpha-1', 'Alpha-2', 'Alpha-3', 'Alpha-4', 'Alpha-5']);
    const entry = app.loadBundle().activityLog.find(e => /Auto-drew/.test(e.action));
    assert.ok(entry, 'logged');
    assert.ok(/Auto-drew 5 segments from "Alpha" on the CalTopo map \(vertical slices, ~12\.8 acres each\): Alpha-1, Alpha-2, Alpha-3, Alpha-4, Alpha-5/.test(entry.action), entry.action);
    assert.ok(toasts(app).some(html => /5 segments drawn on the map from "Alpha"/.test(html)), 'the toast');
    assert.deepStrictEqual(app.__logs.alerts, [], 'nothing to complain about');
    assert.ok(server.proxyFetches() >= 1, 'the map is fetched again afterwards');
    assert.ok(server.requests.some(r => /\/rows/.test(r.url) && r.method === 'POST'), 'the case was saved');
});

check('drawAutoDrawSegments: a refused Assignment class falls back to Shape; every class refused changes nothing', async () => {
    const app = createSandbox({store: seedStore({features: [AREA_SHAPE]}), fetch: createServer().fetch});
    let created = 0;
    app.__caltopoAnswer = (method, endpoint) => (/\/Assignment$/.test(endpoint) ? null : {status: 'ok', result: {id: `shape-${++created}`}});
    const source = app.getMapFeatures(app.loadBundle())[0];
    const outcome = await app.drawAutoDrawSegments(source, app.planAutoDrawSegments(source, {angleDegrees: 90}));
    await settle();
    assert.strictEqual(outcome.created.length, 5);
    assert.deepStrictEqual(app.__posted.slice(0, 2).map(p => p.endpoint), ['/api/v1/map/MAP1/Assignment', '/api/v1/map/MAP1/Shape'], 'Assignment first, then Shape');
    assert.strictEqual(app.__posted.length, 10);
    const added = app.getMapFeatures(app.loadBundle()).slice(1);
    assert.ok(added.every(f => f.attributes.class === 'Shape'), 'stored under the class that took them');
    assert.deepStrictEqual(plain(added.map(f => f.attributes.id)), ['shape-1', 'shape-2', 'shape-3', 'shape-4', 'shape-5']);
    assert.ok(/horizontal slices/.test(app.__posted[1].payload.properties.description));

    // Every class refused: nothing is created, the case is left alone, the
    // caller gets the names back (the popup shows them; no alert on top).
    const refused = createSandbox({store: seedStore({features: [AREA_SHAPE]}), fetch: createServer().fetch});
    refused.__caltopoAnswer = () => null;
    const src = refused.getMapFeatures(refused.loadBundle())[0];
    const none = await refused.drawAutoDrawSegments(src, refused.planAutoDrawSegments(src, {angleDegrees: 0}));
    await settle();
    assert.deepStrictEqual(plain(none.created), []);
    assert.deepStrictEqual(plain(none.errors), ['Alpha-1', 'Alpha-2', 'Alpha-3', 'Alpha-4', 'Alpha-5']);
    assert.deepStrictEqual(featureNames(refused), ['Alpha']);
    assert.deepStrictEqual(refused.__logs.alerts, []);
    assert.ok(!refused.loadBundle().activityLog.some(e => /Auto-drew/.test(e.action)));
    // CalTopo answering without an id: the slice is kept under a synthetic id
    // that is never written back.
    const noId = createSandbox({store: seedStore({features: [AREA_SHAPE]}), fetch: createServer().fetch});
    noId.__caltopoAnswer = () => ({status: 'ok'});
    const s2 = noId.getMapFeatures(noId.loadBundle())[0];
    await noId.drawAutoDrawSegments(s2, noId.planAutoDrawSegments(s2, {angleDegrees: 0}));
    await settle();
    const kept = noId.getMapFeatures(noId.loadBundle()).slice(1);
    assert.deepStrictEqual(plain(kept.map(f => f.attributes.id)), ['gfx-2', 'gfx-3', 'gfx-4', 'gfx-5', 'gfx-6']);
    assert.ok(kept.every(f => !noId.getCalTopoWritableFeatureId(f)), 'not writable');
});

check('the Auto Draw popup: pick a shape, a direction (or an angle), read the preview, confirm', async () => {
    const small = {geometry: polygon(rect(2, 0, 0.1, 0.1)), attributes: {id: 'area-2', name: 'Tiny', class: 'Shape', ObjectID: 2}};
    const app = createSandbox({store: seedStore({features: [AREA_SHAPE, small]}), fetch: createServer().fetch});
    const areas = app.getAutoDrawCandidateFeatures(app.getMapFeatures(app.loadBundle()));
    assert.deepStrictEqual(plain(areas.map(app.getMapFeatureDisplayName)), ['Alpha', 'Tiny'], 'polygons A-Z');
    const popup = app.showAutoDrawSegmentsPopup(areas);
    const rows = byClass(popup, 'auto-draw-feature-row');
    const radios = byClass(popup, 'auto-draw-feature-radio');
    const pills = byClass(popup, 'auto-draw-direction-btn');
    const angle = byClass(popup, 'auto-draw-angle')[0];
    const preview = byClass(popup, 'auto-draw-preview')[0];
    const confirm = byClass(popup, 'auto-draw-confirm')[0];
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(radios.length, 2);
    assert.deepStrictEqual(pills.map(p => p.textContent), ['Vertical', 'Horizontal', 'Custom angle']);
    assert.deepStrictEqual(pills.map(p => p.classList.contains('active')), [true, false, false], 'vertical to start with');
    assert.strictEqual(angle.disabled, true, 'the angle pill waits for Custom angle');
    assert.strictEqual(confirm.disabled, true);
    assert.ok(/Pick the shape/.test(preview.textContent));
    // The row's cells: name, type, acres, slices.
    assert.deepStrictEqual(rows[0].children.slice(1).map(td => td.children[0].textContent), ['Alpha', 'Assignment', '64.00', '5 x ~12.8 ac']);
    assert.deepStrictEqual(rows[1].children.slice(1).map(td => td.children[0].textContent), ['Tiny', 'Shape', '6.40', 'already \u2264 15 ac']);

    // Pick Alpha (clicking the row).
    rows[0].onclick();
    assert.strictEqual(radios[0].checked, true);
    assert.ok(/"Alpha": 64\.0 acres \u2192 5 slices of ~12\.8 acres \(vertical slices\)\. Names: Alpha-1 to Alpha-5\./.test(preview.textContent), preview.textContent);
    assert.strictEqual(confirm.disabled, false);
    assert.strictEqual(confirm.textContent, 'Draw 5 Segments');
    assert.strictEqual(preview.classList.contains('is-warning'), false);
    // Horizontal.
    pills[1].onclick();
    assert.deepStrictEqual(pills.map(p => p.classList.contains('active')), [false, true, false]);
    assert.ok(/horizontal slices/.test(preview.textContent));
    // Custom angle: the pill comes alive and the plan waits for a number.
    pills[2].onclick();
    assert.strictEqual(angle.disabled, false);
    assert.ok(/Type the slice angle/.test(preview.textContent));
    assert.strictEqual(confirm.disabled, true);
    angle.value = '30';
    angle.oninput();
    assert.ok(/slices at 30\u00b0 from north/.test(preview.textContent), preview.textContent);
    assert.strictEqual(confirm.disabled, false);
    // A shape already under 15 acres has nothing to cut.
    radios[1].checked = true;
    radios[1].onchange();
    assert.ok(/"Tiny" is 6\.4 acres - already at or under 15 acres, so there is nothing to cut/.test(preview.textContent), preview.textContent);
    assert.strictEqual(confirm.disabled, true);
    // Back to Alpha, vertical, and confirm: five POSTs, the popup closes.
    rows[0].onclick();
    pills[0].onclick();
    confirm.onclick();
    await settle();
    assert.strictEqual(app.__posted.length, 5);
    assert.deepStrictEqual(app.__posted.map(p => p.payload.properties.title), ['Alpha-1', 'Alpha-2', 'Alpha-3', 'Alpha-4', 'Alpha-5']);
    assert.ok(popup.classList.contains('fade-out'), 'closed');
    assert.deepStrictEqual(app.__logs.error, []);

    // A refused draw keeps the popup open and says so.
    const stuck = createSandbox({store: seedStore({features: [AREA_SHAPE]}), fetch: createServer().fetch});
    stuck.__caltopoAnswer = () => null;
    const popup2 = stuck.showAutoDrawSegmentsPopup(stuck.getAutoDrawCandidateFeatures(stuck.getMapFeatures(stuck.loadBundle())));
    byClass(popup2, 'auto-draw-feature-row')[0].onclick();
    byClass(popup2, 'auto-draw-confirm')[0].onclick();
    await settle();
    const status = byClass(popup2, 'auto-draw-status')[0];
    assert.strictEqual(status.style.display, 'block');
    assert.ok(/CalTopo did not take the new shapes \(Alpha-1, Alpha-2/.test(status.textContent), status.textContent);
    assert.strictEqual(popup2.classList.contains('fade-out'), false, 'still open');
    assert.strictEqual(byClass(popup2, 'auto-draw-confirm')[0].disabled, false, 'can try again');
});

check('openAutoDrawSegmentsTool / openTrimTracksTool: no map, no shapes, a quiet fetch first', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({features: []}), fetch: server.fetch});
    assert.strictEqual(await app.openAutoDrawSegmentsTool(), null);
    assert.ok(server.proxyFetches() >= 1, 'the shapes were fetched first');
    assert.ok(app.__logs.alerts.some(a => /No polygon was found on the CalTopo map/.test(a)), app.__logs.alerts.join(' | '));
    assert.strictEqual(await app.openTrimTracksTool(), null);
    assert.ok(app.__logs.alerts.some(a => /No route or track was found on the CalTopo map/.test(a)));
    const noMap = createSandbox({store: (() => { const s = seedStore(); const b = JSON.parse(s[BUNDLE_KEY]); b.maps = []; s[BUNDLE_KEY] = JSON.stringify(b); return s; })(), fetch: server.fetch});
    assert.strictEqual(await noMap.openAutoDrawSegmentsTool(), null);
    assert.ok(noMap.__logs.alerts.some(a => /No CalTopo map is linked/.test(a)));
    // With shapes in the case the popup opens without a fetch.
    const ready = createServer();
    const app2 = createSandbox({store: seedStore(), fetch: ready.fetch});
    const popup = await app2.openTrimTracksTool();
    assert.ok(popup && byClass(popup, 'trim-track-row').length === 1, 'the popup with the one track');
    assert.strictEqual(ready.proxyFetches(), 0, 'no fetch needed');
    const popup2 = await app2.openAutoDrawSegmentsTool();
    assert.strictEqual(byClass(popup2, 'auto-draw-feature-row').length, 2, 'the two segment polygons');
});

check('getTrimTrackSegments / getTrimTrackCandidateFeatures: segments with a shape, lines with a real id', () => {
    const app = createSandbox({store: seedStore({segments: [SEG('4D', 'seg-4d'), SEG('4C'), SEG('4B', 'missing'), SEG('')]}), fetch: createServer().fetch});
    const segments = app.getTrimTrackSegments(app.loadBundle());
    assert.deepStrictEqual(plain(segments.map(s => [s.key, s.region, s.segment])), [['r1|4d', 'R1', '4D'], ['r1|4c', 'R1', '4C']], '4D by id, 4C by name, 4B has no shape');
    assert.strictEqual(segments[0].geometry.type, 'Polygon', 'the shape\'s geometry rides along');
    const features = [trackFeature(), trackFeature('Ghost', 'gfx-4'), SEG_4D_SHAPE, {geometry: {type: 'LineString', coordinates: [at(0, 0), at(1, 0)]}, attributes: {id: 'la', name: 'Trail', class: 'Assignment'}}, trackFeature('Bravo', 'trk-2', 'Shape')];
    assert.deepStrictEqual(plain(app.getTrimTrackCandidateFeatures(features).map(app.getMapFeatureDisplayName)), ['Bravo', 'Team 1'], 'lines with an id, A-Z; no synthetic id, no polygon, no line assignment');
});

check('trimCalTopoTracks: cutting the outside half mile updates the line in place and re-measures the imported track', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({tracks: [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1}, {region: 'R1', segment: '4C', miles: 0.4}], '#1')]}), fetch: server.fetch});
    const track = app.getMapFeatures(app.loadBundle())[2];
    const outcome = await app.trimCalTopoTracks([{feature: track, removal: {outside: true}}]);
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], app.__logs.error.join(' | '));
    assert.deepStrictEqual(plain(outcome.errors), []);
    assert.deepStrictEqual(plain(outcome.warnings), []);
    assert.strictEqual(outcome.trimmed.length, 1);
    assert.deepStrictEqual(plain(outcome.trimmed[0]), {name: 'Team 1', partNames: ['Team 1'], removedMiles: outcome.trimmed[0].removedMiles, split: false});
    near(outcome.trimmed[0].removedMiles, 0.5, 0.005, 'half a mile cut off');

    assert.strictEqual(app.__posted.length, 1, 'one write');
    const post = app.__posted[0];
    assert.strictEqual(post.method, 'POST');
    assert.strictEqual(post.endpoint, '/api/v1/map/MAP1/AppTrack/trk-1', 'to the track\'s own id under the class CalTopo reported');
    assert.strictEqual(post.payload.id, 'trk-1');
    assert.strictEqual(post.payload.properties.title, 'Team 1', 'the name stays');
    assert.strictEqual(post.payload.properties.stroke, '#8b0000', 'the style stays');
    assert.strictEqual(post.payload.geometry.type, 'LineString');
    assert.strictEqual(post.payload.geometry.coordinates.length, 4, 'the cut point, the vertex, the shared edge, the end');
    near(east(post.payload.geometry.coordinates[0]), -0.5, 1e-6, 'starts at the edge of 4D');
    near(east(post.payload.geometry.coordinates[3]), 0.9, 1e-6, 'ends where it ended');

    // The case's copy carries the trimmed line under the same id and name.
    const features = app.getMapFeatures(app.loadBundle());
    assert.deepStrictEqual(featureNames(app), ['4D', '4C', 'Team 1']);
    assert.strictEqual(features[2].attributes.id, 'trk-1');
    assert.strictEqual(features[2].geometry.coordinates.length, 4);
    // The Searchers Tracks record is re-measured with the pick kept.
    const record = app.loadBundle().searcherTracks.find(t => t.id === 'trk-1');
    assert.ok(record, 'still one record');
    assert.strictEqual(app.loadBundle().searcherTracks.length, 1);
    near(record.lengthMiles, 1.4, 0.005, 're-measured');
    assert.deepStrictEqual(plain(record.segmentMiles.map(s => [s.segment, Math.round(s.miles * 100) / 100])), [['4D', 1], ['4C', 0.4]]);
    assert.strictEqual(record.assignedTask, '#1', 'the planner\'s pick stays');
    assert.strictEqual(record.pointCount, 4);
    const entry = app.loadBundle().activityLog.find(e => /Trimmed 1 track/.test(e.action));
    assert.ok(entry && /"Team 1" \(0\.50 mi cut off\)/.test(entry.action), entry && entry.action);
    assert.ok(toasts(app).some(html => /1 track trimmed on the map/.test(html)));
    assert.ok(server.requests.some(r => /\/rows/.test(r.url) && r.method === 'POST' && JSON.stringify(r.body).includes('searcherTracks')), 'the records went to the server');
    // Nothing left is refused without touching CalTopo.
    const refused = await app.trimCalTopoTracks([{feature: app.getMapFeatures(app.loadBundle())[2], removal: {segmentKeys: ['r1|4d', 'r1|4c'], outside: true}}]);
    assert.deepStrictEqual(plain(refused.trimmed), []);
    assert.ok(/nothing would be left of the track/.test(refused.errors[0]));
    assert.strictEqual(app.__posted.length, 1, 'no further write');
});

check('trimCalTopoTracks: cutting the middle creates "p1" / "p2" Shape lines, deletes the original and replaces the records', async () => {
    const originals = {'trk-1': {color: '#00aa00', stroke: '#00aa00', fill: null, 'fill-opacity': null, opacity: null, 'stroke-opacity': null, 'stroke-width': 2}};
    const app = createSandbox({
        store: seedStore({tracks: [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1}, {region: 'R1', segment: '4C', miles: 0.4}], '#1')], overlayOriginals: originals}),
        fetch: createServer().fetch
    });
    const track = app.getMapFeatures(app.loadBundle())[2];
    const outcome = await app.trimCalTopoTracks([{feature: track, removal: {segmentKeys: ['r1|4d']}}]);
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], app.__logs.error.join(' | '));
    assert.deepStrictEqual(plain(outcome.errors), []);
    assert.deepStrictEqual(plain(outcome.warnings), []);
    assert.deepStrictEqual(plain(outcome.trimmed.map(t => [t.name, t.partNames, t.split])), [['Team 1', ['Team 1 p1', 'Team 1 p2'], true]]);

    const calls = app.__posted;
    assert.deepStrictEqual(calls.map(c => `${c.method} ${c.endpoint}`), [
        'POST /api/v1/map/MAP1/Shape',
        'POST /api/v1/map/MAP1/Shape',
        'DELETE /api/v1/map/MAP1/AppTrack/trk-1'
    ], 'two parts created, then the original deleted');
    assert.deepStrictEqual(calls.slice(0, 2).map(c => c.payload.properties.title), ['Team 1 p1', 'Team 1 p2']);
    assert.ok(calls.slice(0, 2).every(c => c.payload.id === null && c.payload.geometry.type === 'LineString'));
    near(east(calls[0].payload.geometry.coordinates[0]), -1, 1e-6, 'p1 starts where the track started');
    near(east(calls[0].payload.geometry.coordinates[1]), -0.5, 1e-6, 'p1 ends at the edge of 4D');
    near(east(calls[1].payload.geometry.coordinates[0]), 0.5, 1e-6, 'p2 starts at the shared edge');
    near(east(calls[1].payload.geometry.coordinates[1]), 0.9, 1e-6, 'p2 ends where the track ended');
    assert.strictEqual(calls[0].payload.properties.stroke, '#00aa00', 'the parts get the track\'s own color, not the dark red of the color push');
    assert.ok(!('class' in calls[0].payload.properties) && !('id' in calls[0].payload.properties) && !('name' in calls[0].payload.properties));
    assert.strictEqual(calls[2].payload, null);

    // The case's copy: the original gone, the parts in its place.
    assert.deepStrictEqual(featureNames(app), ['4D', '4C', 'Team 1 p1', 'Team 1 p2']);
    const parts = app.getMapFeatures(app.loadBundle()).slice(2);
    assert.deepStrictEqual(plain(parts.map(f => [f.attributes.id, f.attributes.class, f.attributes.title])), [['new-1', 'Shape', 'Team 1 p1'], ['new-2', 'Shape', 'Team 1 p2']]);
    // The Searchers Tracks: two records, the pick and the import stamp kept.
    const records = app.loadBundle().searcherTracks;
    assert.deepStrictEqual(plain(records.map(r => [r.id, r.featureId, r.baseName, r.caltopoName, r.assignedTask])), [
        ['new-1', 'new-1', 'Team 1 p1', 'Team 1 p1', '#1'],
        ['new-2', 'new-2', 'Team 1 p2', 'Team 1 p2', '#1']
    ]);
    near(records[0].lengthMiles, 0.5, 0.005, 'p1 measured');
    assert.deepStrictEqual(plain(records[0].segmentMiles), [], 'p1 is outside every segment');
    near(records[1].lengthMiles, 0.4, 0.005, 'p2 measured');
    assert.deepStrictEqual(plain(records[1].segmentMiles.map(s => s.segment)), ['4C']);
    // The color push's record of the original style moved to the parts.
    const state = app.loadBundle().maps[0].caltopoAssignmentOverlayState;
    assert.deepStrictEqual(Object.keys(state.originals).sort(), ['new-1', 'new-2']);
    assert.strictEqual(state.originals['new-1'].stroke, '#00aa00');
    const entry = app.loadBundle().activityLog.find(e => /Trimmed 1 track/.test(e.action));
    assert.ok(entry && /"Team 1" \(1\.00 mi cut off \u2192 Team 1 p1, Team 1 p2\)/.test(entry.action), entry && entry.action);
    assert.ok(toasts(app).some(html => /1 track trimmed on the map \(1 split into parts\)/.test(html)));

    // A track the Search Log has renamed with its "#task-segment " code is
    // split under its own name: the code belongs to the whole track's home
    // segment and the rename sync puts the right one on each part later.
    const coded = createSandbox({store: seedStore({features: [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature('#1-4D Team 1')]}), fetch: createServer().fetch});
    const outcome2 = await coded.trimCalTopoTracks([{feature: coded.getMapFeatures(coded.loadBundle())[2], removal: {segmentKeys: ['r1|4d']}}]);
    await settle();
    assert.deepStrictEqual(plain(outcome2.trimmed[0].partNames), ['Team 1 p1', 'Team 1 p2']);
    assert.deepStrictEqual(coded.__posted.slice(0, 2).map(c => c.payload.properties.title), ['Team 1 p1', 'Team 1 p2']);
});

check('trimCalTopoTracks: a refused part rolls the created ones back; a refused delete is reported but the split stands', async () => {
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    let creates = 0;
    app.__caltopoAnswer = (method, endpoint) => {
        if (method === 'POST' && /\/Shape$/.test(endpoint)) return ++creates === 1 ? {status: 'ok', result: {id: 'part-1'}} : null;
        return {status: 'ok'};
    };
    const track = () => app.getMapFeatures(app.loadBundle())[2];
    const outcome = await app.trimCalTopoTracks([{feature: track(), removal: {segmentKeys: ['r1|4d']}}]);
    await settle();
    assert.deepStrictEqual(plain(outcome.trimmed), []);
    assert.ok(/did not take part 2 of "Team 1"/.test(outcome.errors[0]), outcome.errors[0]);
    assert.deepStrictEqual(app.__posted.map(c => `${c.method} ${c.endpoint}`), [
        'POST /api/v1/map/MAP1/Shape',
        'POST /api/v1/map/MAP1/Shape',
        'DELETE /api/v1/map/MAP1/Shape/part-1'
    ], 'the first part is taken back; the original is never deleted');
    assert.deepStrictEqual(featureNames(app), ['4D', '4C', 'Team 1'], 'the case is left alone');
    assert.deepStrictEqual(app.__logs.alerts, [], 'nothing trimmed, so the popup reports it, not an alert');

    // The delete refused: the parts exist, the case follows them, the planner
    // is told to remove the original by hand.
    const app2 = createSandbox({store: seedStore(), fetch: createServer().fetch});
    let n = 0;
    app2.__caltopoAnswer = (method) => (method === 'DELETE' ? null : {status: 'ok', result: {id: `p-${++n}`}});
    const outcome2 = await app2.trimCalTopoTracks([{feature: app2.getMapFeatures(app2.loadBundle())[2], removal: {segmentKeys: ['r1|4d']}}]);
    await settle();
    assert.strictEqual(outcome2.trimmed.length, 1);
    assert.ok(/original line could not be removed from CalTopo - delete it there by hand/.test(outcome2.warnings[0]), outcome2.warnings[0]);
    assert.deepStrictEqual(app2.__posted.map(c => `${c.method} ${c.endpoint}`), [
        'POST /api/v1/map/MAP1/Shape', 'POST /api/v1/map/MAP1/Shape',
        'DELETE /api/v1/map/MAP1/AppTrack/trk-1', 'DELETE /api/v1/map/MAP1/Shape/trk-1'
    ], 'the delete is tried under the reported class, then Shape');
    assert.deepStrictEqual(featureNames(app2), ['4D', '4C', 'Team 1 p1', 'Team 1 p2']);
    assert.ok(toasts(app2).some(html => /delete it there by hand/.test(html)));
    assert.strictEqual(app2.loadBundle().searcherTracks.length, 0, 'the track was never imported, so no record is made up');
});

check('the Trim Tracks popup: portion pills, the result cell, confirm', async () => {
    const app = createSandbox({store: seedStore({features: [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature(), trackFeature('Team 2', 'trk-2', 'Shape')]}), fetch: createServer().fetch});
    const tracks = app.getTrimTrackCandidateFeatures(app.getMapFeatures(app.loadBundle()));
    const popup = app.showTrimTracksPopup(tracks);
    const rows = byClass(popup, 'trim-track-row');
    const confirm = byClass(popup, 'trim-tracks-confirm')[0];
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0].children.slice(0, 3).map(td => td.children[0].textContent), ['Team 1', 'Track', '1.90 mi']);
    assert.deepStrictEqual(rows[1].children.slice(0, 3).map(td => td.children[0].textContent), ['Team 2', 'Route', '1.90 mi']);
    const pills = byClass(rows[0], 'trim-portion-pill');
    assert.deepStrictEqual(pills.map(p => p.textContent), ['Outside segments 0.50 mi', '4D 1.00 mi', '4C 0.40 mi'], 'a pill per part, in track order');
    assert.deepStrictEqual(pills.map(p => p.dataset.key), ['', 'r1|4d', 'r1|4c']);
    const result = byClass(rows[0], 'trim-track-result')[0];
    assert.strictEqual(result.textContent, 'Unchanged');
    assert.strictEqual(confirm.disabled, true);
    assert.strictEqual(confirm.textContent, 'Trim Tracks');
    // Cut the outside part off Team 1.
    pills[0].onclick();
    assert.strictEqual(pills[0].classList.contains('is-removed'), true);
    assert.strictEqual(result.textContent, '0.50 mi cut off \u2192 one track, 1.40 mi kept');
    assert.strictEqual(rows[0].classList.contains('is-selected'), true);
    assert.strictEqual(confirm.disabled, false);
    assert.strictEqual(confirm.textContent, 'Trim 1 Track');
    // ... and the 4D mile too: two parts.
    pills[1].onclick();
    assert.strictEqual(result.textContent, '1.50 mi cut off \u2192 one track, 0.40 mi kept', 'outside + 4D leaves the 4C stretch');
    pills[0].onclick();
    assert.strictEqual(pills[0].classList.contains('is-removed'), false, 'toggled back');
    assert.strictEqual(result.textContent, '1.00 mi cut off \u2192 2 parts (p1-p2), 0.90 mi kept');
    // Everything: refused.
    pills[0].onclick();
    pills[2].onclick();
    assert.strictEqual(result.textContent, 'Nothing would be left - unselect a part');
    assert.strictEqual(result.classList.contains('is-invalid'), true);
    assert.strictEqual(confirm.disabled, true, 'a track with nothing left cannot be confirmed');
    // Team 2 as well: two tracks to trim.
    pills[2].onclick();
    pills[0].onclick();
    const pills2 = byClass(rows[1], 'trim-portion-pill');
    pills2[0].onclick();
    assert.strictEqual(confirm.textContent, 'Trim 2 Tracks');
    confirm.onclick();
    await settle();
    assert.ok(popup.classList.contains('fade-out'), 'closed');
    assert.deepStrictEqual(app.__posted.map(c => `${c.method} ${c.endpoint}`), [
        'POST /api/v1/map/MAP1/Shape', 'POST /api/v1/map/MAP1/Shape', 'DELETE /api/v1/map/MAP1/AppTrack/trk-1',
        'POST /api/v1/map/MAP1/Shape/trk-2'
    ], 'Team 1 split into two parts, Team 2 trimmed in place');
    assert.deepStrictEqual(featureNames(app), ['4D', '4C', 'Team 1 p1', 'Team 1 p2', 'Team 2']);
    assert.deepStrictEqual(app.__logs.error, []);
});

check('the static wiring: the two buttons in the map header, their handlers, the stylesheet', () => {
    const start = appSource.indexOf('function buildMapsPage()');
    const end = appSource.indexOf('// Maps page tools: "Auto Draw Segments" and "Trim Tracks".');
    assert.ok(start !== -1 && end > start);
    const page = appSource.slice(start, end);
    const header = page.slice(page.indexOf('id="current-map-title"'), page.indexOf('id="map-iframe"'));
    assert.ok(/id="fetch-shapes-btn"/.test(header), 'Fetch Shapes is in the map header');
    assert.ok(/id="auto-draw-segments-btn"[^>]*>Auto Draw Segments</.test(header), 'the Auto Draw Segments button next to it');
    assert.ok(/id="trim-tracks-btn"[^>]*>Trim Tracks</.test(header), 'the Trim Tracks button next to it');
    assert.ok(header.indexOf('id="fetch-shapes-btn"') < header.indexOf('id="auto-draw-segments-btn"') && header.indexOf('id="auto-draw-segments-btn"') < header.indexOf('id="trim-tracks-btn"'));
    assert.ok(/getElementById\('auto-draw-segments-btn'\)[\s\S]{0,120}openAutoDrawSegmentsTool\(autoDrawBtn\)/.test(page), 'wired to openAutoDrawSegmentsTool');
    assert.ok(/getElementById\('trim-tracks-btn'\)[\s\S]{0,120}openTrimTracksTool\(trimTracksBtn\)/.test(page), 'wired to openTrimTracksTool');

    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    const rule = (selector) => {
        const at = css.indexOf(`${selector} {`);
        assert.ok(at !== -1, `${selector} is styled`);
        return css.slice(at, css.indexOf('}', at));
    };
    assert.ok(/line-through/.test(rule('.trim-portion-pill.is-removed')), 'a removed part is struck through');
    assert.ok(/224, 49, 49/.test(rule('.trim-portion-pill.is-removed')), '... in red');
    rule('.auto-draw-direction-row');
    rule('.auto-draw-preview.is-warning');
    rule('.auto-draw-angle-wrap .pill-input:disabled');
    rule('.map-tool-body');
    // The sandbox helpers exist under the names the plan gives them.
    const app = createSandbox({store: seedStore(), fetch: createServer().fetch});
    ['openAutoDrawSegmentsTool', 'showAutoDrawSegmentsPopup', 'drawAutoDrawSegments', 'openTrimTracksTool', 'showTrimTracksPopup', 'trimCalTopoTracks', 'createCalTopoMapFeature', 'updateCalTopoMapFeatureGeometry', 'deleteCalTopoMapFeature', 'reloadMapsPageIframe'].forEach(name => {
        assert.strictEqual(typeof app[name], 'function', name);
    });
    assert.strictEqual(app.extractCalTopoCreatedId({status: 'ok', result: {id: 'abc'}}), 'abc');
    assert.strictEqual(app.extractCalTopoCreatedId({id: 'raw'}), 'raw');
    assert.strictEqual(app.extractCalTopoCreatedId({status: 'ok'}), '');
    assert.strictEqual(app.isCalTopoCallAccepted(''), true, 'an empty DELETE answer counts');
    assert.strictEqual(app.isCalTopoCallAccepted(null), false);
    assert.strictEqual(app.isCalTopoCallAccepted({status: 'error'}), false);
});

(async () => {
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (error) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(error && error.stack ? error.stack : error);
        }
    }
    if (failed) {
        console.log(`\nMaps Auto Draw Segments / Trim Tracks: ${failed} of ${checks.length} checks failed.`);
        process.exit(1);
    }
    console.log(`\nMaps Auto Draw Segments / Trim Tracks: PASS (${checks.length} checks)`);
})();

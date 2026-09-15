// Lost Person Behavior (Incident page section, its copy beside the map on the
// Maps page, Segments page switch).
//
// Part 1 checks the pure maths shared through map-segment-utils.js: the centre
// of a CalTopo shape, the distance to the IPP, which 25/50/75/95 % bracket a
// distance falls into, the bracket's percentage per mile and the PSR factor
// that follows from it (1 + the summed rates of the switched-on categories).
//
// Part 2 drives the real app.js in a sandbox (in-memory store, fake DOM, a
// scripted fetch that records every request) to check that
//   - the section survives sanitizeBundle / saveBundle,
//   - a segment gains its bracket's percentage per mile of its PSRi (with the
//     0.5/1.0/1.5/2.0 mi placeholders: 50 %/mi in the 25 % and 50 % brackets),
//     several categories add up, PSRc and the search log follow, segments
//     beyond every 95 % distance or without a shape are left alone,
//   - the Segments page switch lifts and re-applies the adjustment without
//     losing the Incident page settings,
//   - importing the IPP marker stores its position in the case and sends the
//     section to the server as a row change (lost_person_behavior / lpb_ipp),
//   - the login's edited distances go to PUT /api/lpb/distances and the
//     defaults are read from GET /api/lpb/distances,
//   - the Incident page section and the Segments table (with the bracket tags
//     on the PSRi pills) render without errors,
//   - the Maps page renders the same section in the left half of a
//     screen-wide row, the map in the right half, and a switch flipped there
//     changes the case (and the PSR values, at once) like on the Incident page.
//
// Run with: node test_lost_person_behavior.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const utils = require('./map-segment-utils');
const syncDelta = require('./sync-delta');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const deltaSource = fs.readFileSync(path.join(__dirname, 'sync-delta.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'map-segment-utils.js'), 'utf8');

const BUNDLE_KEY = 'pill-table-bundle-v1';
const SETTINGS_CACHE_KEY = 'sar-server-settings-cache-v1';
const CASE = 'LPB-1';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

// ---------------------------------------------------------------------------
// Geometry helpers: the IPP sits at 45 N 93 W; one mile north is about
// 0.01447 degrees of latitude. Every segment is a small square (area centroid
// = its centre) `miles` north of the IPP.
// ---------------------------------------------------------------------------
const IPP = {lat: 45.0, lng: -93.0};
const MILE_IN_DEG_LAT = 1 / 69.09;
const squareAround = (lat, lng, half = 0.0005, closed = true) => {
    const ring = [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half]];
    if (closed) ring.push([lng - half, lat - half]);
    return ring;
};
const segmentShape = (name, id, milesNorth, options = {}) => ({
    geometry: {type: 'Polygon', coordinates: [squareAround(IPP.lat + milesNorth * MILE_IN_DEG_LAT, IPP.lng, 0.0005, options.closed !== false)]},
    attributes: {name, id, class: 'Assignment', ObjectID: 1}
});
const markerAt = (name, id, lat, lng) => ({
    geometry: {type: 'Point', coordinates: [lng, lat]},
    attributes: {name, id, class: 'Marker', ObjectID: 2}
});
const DISTANCES = {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0};

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('geometryCenterLngLat: point, open and closed rings, area-weighted collections', () => {
    assert.deepStrictEqual(utils.geometryCenterLngLat({type: 'Point', coordinates: [-93.1, 44.9]}), [-93.1, 44.9]);
    const open = utils.geometryCenterLngLat({type: 'Polygon', coordinates: [squareAround(45.01, -93.02, 0.001, false)]});
    const closed = utils.geometryCenterLngLat({type: 'Polygon', coordinates: [squareAround(45.01, -93.02, 0.001, true)]});
    near(open[0], -93.02, 1e-9, 'open ring lng');
    near(open[1], 45.01, 1e-9, 'open ring lat');
    assert.deepStrictEqual(open, closed, 'an open ring and its closed twin share the centroid');
    // A big square and a tiny one: the collection's centre stays with the big one.
    const collection = utils.geometryCenterLngLat({type: 'GeometryCollection', geometries: [
        {type: 'Polygon', coordinates: [squareAround(45.0, -93.0, 0.01)]},
        {type: 'Polygon', coordinates: [squareAround(45.5, -93.5, 0.0001)]}
    ]});
    near(collection[1], 45.0, 0.001, 'area-weighted collection lat');
    assert.strictEqual(utils.geometryCenterLngLat({type: 'Polygon', coordinates: []}), null);
    assert.strictEqual(utils.geometryCenterLngLat(null), null);
});

check('getFeatureCenter reads GeoJSON geometry or a marker position attribute', () => {
    assert.deepStrictEqual(utils.getFeatureCenter(markerAt('IPP', 'm1', 44.9, -93.1)), {lat: 44.9, lng: -93.1});
    assert.deepStrictEqual(utils.getFeatureCenter({attributes: {position: {lat: 44.5, lng: -93.5}}}), {lat: 44.5, lng: -93.5});
    assert.deepStrictEqual(utils.getFeatureCenter({attributes: {position: [-93.25, 44.25]}}), {lat: 44.25, lng: -93.25});
    assert.strictEqual(utils.getFeatureCenter({attributes: {name: 'nothing'}}), null);
    assert.strictEqual(utils.getFeatureCenter({geometry: {type: 'Point', coordinates: [500, 95]}}), null, 'out-of-range coordinates are unusable');
});

check('haversineMiles: one degree of latitude is about 69.1 miles', () => {
    near(utils.haversineMiles({lat: 44, lng: -93}, {lat: 45, lng: -93}), 69.09, 0.05, 'one degree north');
    near(utils.haversineMiles(IPP, IPP), 0, 1e-9, 'same point');
    assert.strictEqual(utils.haversineMiles(IPP, null), null);
    assert.strictEqual(utils.haversineMiles({lat: 'x', lng: 1}, IPP), null);
});

check('computeLpbBracketRates: each bracket\'s extra percentage over its extra miles', () => {
    // The worked example from the request: 25 % at 1.9 mi is 13.16 %/mi; the
    // 50 % bracket at 11.8 mi adds 25 % over 9.9 mi = 2.53 %/mi.
    const rates = utils.computeLpbBracketRates({p25: 1.9, p50: 11.8, p75: 20, p95: 30});
    assert.deepStrictEqual(rates.map(r => [r.key, r.percent, r.distance, r.previousPercent, r.previousDistance]), [
        ['p25', 25, 1.9, 0, 0],
        ['p50', 50, 11.8, 25, 1.9],
        ['p75', 75, 20, 50, 11.8],
        ['p95', 95, 30, 75, 20]
    ]);
    near(rates[0].ratePercentPerMile, 25 / 1.9, 1e-12, '25 % / 1.9 mi');
    near(rates[0].ratePercentPerMile, 13.1579, 0.0001, 'about 13.16 %/mi');
    near(rates[1].ratePercentPerMile, 25 / 9.9, 1e-12, '(50 - 25) % / (11.8 - 1.9) mi');
    near(rates[1].ratePercentPerMile, 2.5253, 0.0001, 'about 2.53 %/mi');
    near(rates[2].ratePercentPerMile, 25 / 8.2, 1e-12);
    near(rates[3].ratePercentPerMile, 20 / 10, 1e-12, '(95 - 75) % / (30 - 20) mi');
    // The placeholders: 50 %/mi for the first three brackets, 40 %/mi for the last.
    assert.deepStrictEqual(utils.computeLpbBracketRates(DISTANCES).map(r => r.ratePercentPerMile), [50, 50, 50, 40]);
    // A missing bracket has no rate; the next one measures from the last bracket that had a distance.
    const gap = utils.computeLpbBracketRates({p25: 0.5, p75: 1.5, p95: 2});
    assert.strictEqual(gap[1].ratePercentPerMile, null);
    assert.strictEqual(gap[1].distance, null);
    assert.strictEqual(gap[2].ratePercentPerMile, 50, '(75 - 25) % / (1.5 - 0.5) mi');
    assert.strictEqual(gap[2].previousPercent, 25);
    // A distance that does not lie beyond the previous bracket's has no rate
    // (no division by zero or a negative span).
    const flat = utils.computeLpbBracketRates({p25: 1, p50: 1, p75: 0.8, p95: 2});
    assert.strictEqual(flat[1].ratePercentPerMile, null);
    assert.strictEqual(flat[2].ratePercentPerMile, null);
    near(flat[3].ratePercentPerMile, 20 / 1.2, 1e-12, 'the 95 % bracket measures from the 75 % distance');
    assert.deepStrictEqual(utils.computeLpbBracketRates(null).map(r => r.ratePercentPerMile), [null, null, null, null]);
    assert.strictEqual(utils.formatLpbPercent(13.157894), '13.2%');
    assert.strictEqual(utils.formatLpbPercent(50), '50%');
    assert.strictEqual(utils.formatLpbPercent(2.5252), '2.5%');
    assert.strictEqual(utils.formatLpbPercent('x'), '');
});

check('resolveLpbBracket picks the smallest distance that still contains the segment, with its rate', () => {
    const at = (miles) => utils.resolveLpbBracket(miles, DISTANCES);
    assert.strictEqual(at(0.3).percent, 25);
    assert.strictEqual(at(0.3).ratePercentPerMile, 50, '25 % over 0.5 mi');
    assert.strictEqual(at(0.5).percent, 25, 'exactly on the 25 % distance stays in the 25 % bracket');
    assert.strictEqual(at(0.7).percent, 50);
    assert.strictEqual(at(0.7).ratePercentPerMile, 50, '(50 - 25) % over (1.0 - 0.5) mi');
    assert.strictEqual(at(0.7).previousDistance, 0.5);
    assert.strictEqual(at(1.2).percent, 75);
    assert.strictEqual(at(1.2).ratePercentPerMile, 50);
    assert.strictEqual(at(1.9).percent, 95);
    assert.strictEqual(at(1.9).ratePercentPerMile, 40, '(95 - 75) % over (2.0 - 1.5) mi');
    assert.strictEqual(at(2.5), null, 'beyond the 95 % distance there is no bracket');
    assert.strictEqual(at(-1), null);
    assert.strictEqual(at('abc'), null);
    assert.strictEqual(utils.resolveLpbBracket(0.3, null), null);
    // The request's example distances.
    const example = utils.resolveLpbBracket(5, {p25: 1.9, p50: 11.8, p75: 20, p95: 30});
    assert.strictEqual(example.percent, 50);
    near(example.ratePercentPerMile, 2.5253, 0.0001);
    // With the 25 % distance missing the 50 % bracket is the smallest one left.
    assert.strictEqual(utils.resolveLpbBracket(0.3, {p50: 1, p75: 1.5, p95: 2}).percent, 50);
    // Two equal distances: the smaller percentage wins.
    assert.strictEqual(utils.resolveLpbBracket(0.8, {p25: 1, p50: 1, p75: 1.5, p95: 2}).percent, 25);
});

check('normalizeLpbDistanceMiles: miles to a tenth, positive numbers only', () => {
    assert.strictEqual(utils.normalizeLpbDistanceMiles('0.75'), 0.8);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('1 mi'), 1);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(1.25), 1.3);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('2,5'), 25, 'a thousands separator is dropped, not read as a decimal point');
    assert.strictEqual(utils.normalizeLpbDistanceMiles(0), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('-1'), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles('abc'), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(''), null);
    assert.strictEqual(utils.normalizeLpbDistanceMiles(null), null);
    assert.strictEqual(utils.formatLpbMiles(1), '1.0 mi');
    assert.strictEqual(utils.formatLpbMiles('x'), '');
    assert.strictEqual(utils.isCompleteLpbDistances(DISTANCES), true);
    assert.strictEqual(utils.isCompleteLpbDistances({p25: 0.5, p50: 1}), false);
    assert.strictEqual(utils.isCompleteLpbDistances(null), false);
});

// Every category off, on the default terrain, without distances.
const blankCategories = () => Object.fromEntries(utils.LPB_CATEGORIES.map(cat => [cat.key, {enabled: false, terrain: 'Mtn Temperate', distances: null}]));

check('the categories are listed in their groups, Mental Illness among the Mental State ones', () => {
    assert.deepStrictEqual(utils.LPB_CATEGORY_GROUPS.map(g => g.title), ['External Forces', 'Water', 'Wheel/Motorized', 'Mental State', 'Child', 'Outdoor Activity', 'Snow Activity']);
    const labels = utils.LPB_CATEGORY_GROUPS.map(g => g.categories.map(c => c.label));
    assert.deepStrictEqual(labels[0], ['Abduction', 'Aircraft']);
    assert.deepStrictEqual(labels[1], ['Non-Powered Boat', 'Person in Current Water', 'Person in Flat Water', 'Person in Flood Water', 'Power Boat']);
    assert.deepStrictEqual(labels[2], ['ATV', 'Motorcycle', 'Mountain Bike', '4WD Vehicle', 'Road Vehicle']);
    assert.deepStrictEqual(labels[3], ['Autism', 'Dementia', 'Despondent', 'Intellectual Disability', 'Mental Illness', 'Substance Intoxication']);
    assert.deepStrictEqual(labels[4], ['Age 1-3', 'Age 4-6', 'Age 7-9', 'Age 10-12', 'Age 13-15']);
    assert.deepStrictEqual(labels[5], ['Abandoned Vehicle', 'Angler', 'Car Camper', 'Caver', 'Day Climber', 'Extreme Race', 'Gatherer', 'Hiker', 'Horseback Rider', 'Hunter', 'Mountaineer', 'Runner', 'Worker']);
    assert.deepStrictEqual(labels[6], ['Skier Alpine', 'Skier Nordic', 'Snowboarder', 'Snowmobiler', 'Snowshoer']);
    // The flat list follows the groups and every key / label is unique.
    assert.strictEqual(utils.LPB_CATEGORIES.length, 41);
    assert.deepStrictEqual(utils.LPB_CATEGORIES.map(c => c.label), labels.flat());
    assert.strictEqual(new Set(utils.LPB_CATEGORIES.map(c => c.key)).size, 41);
    assert.strictEqual(new Set(utils.LPB_CATEGORIES.map(c => c.label)).size, 41);
    utils.LPB_CATEGORIES.forEach(c => assert.ok(/^[a-z][A-Za-z0-9]*$/.test(c.key), `${c.key} is a camelCase bundle key`));
    assert.deepStrictEqual(utils.LPB_CATEGORIES.find(c => c.key === 'mentalIllness'), {key: 'mentalIllness', label: 'Mental Illness', group: 'mentalState'});
    assert.strictEqual(utils.getLpbCategory('dementia').label, 'Dementia');
    assert.strictEqual(utils.getLpbCategory('Age 10-12').key, 'childAge10to12');
    assert.strictEqual(utils.getLpbCategory('4wd vehicle').key, 'fourWdVehicle');
    assert.strictEqual(utils.getLpbCategory('unicorn'), null);
});

check('normalizeLostPersonBehavior always yields the canonical shape', () => {
    assert.deepStrictEqual(utils.normalizeLostPersonBehavior(undefined), {
        psrAdjustmentEnabled: true,
        ipp: null,
        categories: blankCategories()
    });
    const messy = utils.normalizeLostPersonBehavior({
        psrAdjustmentEnabled: false,
        ipp: {lat: '44.95', lng: -93.05, featureId: 'mk1', featureName: 'IPP', importedAt: 't', importedBy: 'Jane', extra: 1},
        categories: {
            mentalIllness: {enabled: 'yes', terrain: 'Lunar', distances: {p25: '0.25', p50: 'x', p75: 1.5, p95: 2}},
            dementia: {enabled: true, terrain: 'Dry', distances: {p25: 1.9, p50: 11.8, p75: 20, p95: 30}},
            unknownCategory: {enabled: true}
        }
    });
    assert.deepStrictEqual(messy, {
        psrAdjustmentEnabled: false,
        ipp: {featureId: 'mk1', featureName: 'IPP', lat: 44.95, lng: -93.05, importedAt: 't', importedBy: 'Jane'},
        categories: {
            ...blankCategories(),
            mentalIllness: {enabled: false, terrain: 'Mtn Temperate', distances: {p25: 0.3, p75: 1.5, p95: 2}},
            dementia: {enabled: true, terrain: 'Dry', distances: {p25: 1.9, p50: 11.8, p75: 20, p95: 30}}
        }
    });
    assert.strictEqual(utils.normalizeLostPersonBehavior({ipp: {lat: 200, lng: 0}}).ipp, null, 'an unusable position is no IPP');
    assert.strictEqual(utils.normalizeLpbTerrain('Dry'), 'Dry');
    assert.strictEqual(utils.getLpbCategory('mental illness').key, 'mentalIllness');
    assert.strictEqual(utils.getLpbCategory('mentalIllness').label, 'Mental Illness');
    assert.deepStrictEqual(utils.LPB_TERRAINS, ['Mtn Temperate', 'Flat Temperate', 'Dry', 'Urban']);
    assert.deepStrictEqual(utils.LPB_SEED_DISTANCES, {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0});
});

const activeBundle = (overrides = {}) => ({
    lostPersonBehavior: {
        psrAdjustmentEnabled: true,
        ipp: {featureId: 'mk1', featureName: 'IPP', lat: IPP.lat, lng: IPP.lng},
        categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES}},
        ...overrides
    },
    maps: [{id: 'MAP1', features: [
        segmentShape('Alpha', 'a', 0.3),
        segmentShape('R1 - Bravo', 'gfx-2', 0.7, {closed: false}),
        segmentShape('Charlie', 'c', 5),
        markerAt('IPP', 'mk1', IPP.lat, IPP.lng)
    ]}]
});

// The request's worked example as a second category.
const DEMENTIA_DISTANCES = {p25: 1.9, p50: 11.8, p75: 20, p95: 30};
const twoCategories = (overrides = {}) => activeBundle({
    categories: {
        mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES},
        dementia: {enabled: true, terrain: 'Dry', distances: DEMENTIA_DISTANCES}
    },
    ...overrides
});

check('buildLpbContext lists the applied categories and names why the adjustment is not active', () => {
    const single = utils.buildLpbContext(activeBundle());
    assert.strictEqual(single.active, true);
    assert.deepStrictEqual(single.categories.map(c => [c.category.key, c.terrain]), [['mentalIllness', 'Mtn Temperate']]);
    assert.deepStrictEqual(single.categories[0].rates.map(r => r.ratePercentPerMile), [50, 50, 50, 40]);
    assert.strictEqual(single.category.key, 'mentalIllness', 'the first applied category is still exposed on its own');
    assert.deepStrictEqual(single.incomplete, []);
    assert.strictEqual(utils.buildLpbContext(activeBundle({psrAdjustmentEnabled: false})).reason, 'disabled');
    assert.strictEqual(utils.buildLpbContext(activeBundle({categories: {mentalIllness: {enabled: false}}})).reason, 'no-category');
    assert.strictEqual(utils.buildLpbContext(activeBundle({categories: {mentalIllness: {enabled: true, distances: {p25: 0.5}}}})).reason, 'no-distances');
    assert.strictEqual(utils.buildLpbContext(activeBundle({ipp: null})).reason, 'no-ipp');
    assert.strictEqual(utils.buildLpbContext({}).active, false);
    assert.strictEqual(utils.buildLpbContext(null).reason, 'no-category');

    // Two categories on: both are applied, in list order (Dementia comes before Mental Illness).
    const both = utils.buildLpbContext(twoCategories());
    assert.strictEqual(both.active, true);
    assert.deepStrictEqual(both.categories.map(c => [c.category.key, c.terrain]), [['dementia', 'Dry'], ['mentalIllness', 'Mtn Temperate']]);
    assert.strictEqual(both.category.key, 'dementia');
    // One of them without complete distances: the other still applies, the
    // incomplete one is listed so the status line can say so.
    const partial = utils.buildLpbContext(twoCategories({categories: {
        mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES},
        dementia: {enabled: true, terrain: 'Dry', distances: {p25: 1.9}}
    }}));
    assert.strictEqual(partial.active, true);
    assert.deepStrictEqual(partial.categories.map(c => c.category.key), ['mentalIllness']);
    assert.deepStrictEqual(partial.incomplete.map(c => c.key), ['dementia']);
    // Both incomplete: nothing to apply.
    const nothing = utils.buildLpbContext(twoCategories({categories: {
        mentalIllness: {enabled: true, distances: {p25: 0.5}},
        dementia: {enabled: true, distances: null}
    }}));
    assert.strictEqual(nothing.active, false);
    assert.strictEqual(nothing.reason, 'no-distances');
    assert.deepStrictEqual(nothing.incomplete.map(c => c.key), ['dementia', 'mentalIllness']);
});

check('getLpbSegmentAdjustment finds the shape by CalTopo id or by name and adds the bracket\'s rate', () => {
    const context = utils.buildLpbContext(activeBundle());
    const byId = utils.getLpbSegmentAdjustment(['R1', 'Renamed', '640 ac', '1 mi', '100 ft', '', '', '', '', 'a'], context);
    assert.strictEqual(byId.matched, true);
    near(byId.distanceMiles, 0.3, 0.01, 'Alpha is 0.3 mi from the IPP');
    assert.strictEqual(byId.contributions.length, 1);
    assert.strictEqual(byId.contributions[0].category.key, 'mentalIllness');
    assert.strictEqual(byId.contributions[0].bracket.percent, 25);
    assert.strictEqual(byId.contributions[0].addedPercent, 50, '25 % over 0.5 mi = 50 %/mi');
    assert.strictEqual(byId.addedPercent, 50);
    assert.strictEqual(byId.factor, 1.5, 'PSRi + 50 % of itself');

    const byFullName = utils.getLpbSegmentAdjustment(['R1', 'Bravo', '640 ac', '1 mi', '100 ft', '', '', '', '', 'gfx-2'], context);
    assert.strictEqual(byFullName.matched, true, '"Region - Segment" matches the shape name; a gfx- id is never used');
    assert.strictEqual(byFullName.contributions[0].bracket.percent, 50);
    assert.strictEqual(byFullName.factor, 1.5, '(50 - 25) % over (1.0 - 0.5) mi = 50 %/mi');

    const far = utils.getLpbSegmentAdjustment(['R1', 'Charlie', '640 ac', '1 mi', '100 ft', '', '', '', '', ''], context);
    assert.strictEqual(far.matched, true);
    assert.strictEqual(far.contributions[0].bracket, null, 'beyond the 95 % distance');
    assert.strictEqual(far.contributions[0].addedPercent, 0);
    assert.strictEqual(far.addedPercent, 0);
    assert.strictEqual(far.factor, 1);

    const none = utils.getLpbSegmentAdjustment(['R1', 'Delta', '640 ac', '1 mi', '100 ft', '', '', '', '', ''], context);
    assert.deepStrictEqual(none, {matched: false, distanceMiles: null, contributions: [], addedPercent: 0, factor: 1});

    assert.strictEqual(utils.getLpbSegmentAdjustment(['R1', 'Alpha'], utils.buildLpbContext(activeBundle({psrAdjustmentEnabled: false}))), null);
});

check('with several categories on, each works out its own addition and the additions are summed', () => {
    const context = utils.buildLpbContext(twoCategories());
    // Alpha, 0.3 mi: Dementia 25 % bracket (25 % / 1.9 mi = 13.16 %/mi) + Mental
    // Illness 25 % bracket (50 %/mi) = 63.16 % of the PSRi added.
    const alpha = utils.getLpbSegmentAdjustment(['R1', 'Alpha', '640 ac', '1 mi', '100 ft', '', '', '', '', 'a'], context);
    assert.deepStrictEqual(alpha.contributions.map(c => [c.category.key, c.bracket && c.bracket.percent]), [['dementia', 25], ['mentalIllness', 25]]);
    near(alpha.contributions[0].addedPercent, 25 / 1.9, 1e-12);
    assert.strictEqual(alpha.contributions[1].addedPercent, 50);
    near(alpha.addedPercent, 50 + 25 / 1.9, 1e-12, 'the additions are summed, not compounded');
    near(alpha.factor, 1 + (50 + 25 / 1.9) / 100, 1e-12);
    // Charlie, 5 mi: beyond Mental Illness's 2.0 mi, in Dementia's 50 % bracket
    // (25 % over 9.9 mi = 2.53 %/mi).
    const charlie = utils.getLpbSegmentAdjustment(['R1', 'Charlie', '640 ac', '1 mi', '100 ft', '', '', '', '', 'c'], context);
    assert.strictEqual(charlie.contributions[0].bracket.percent, 50);
    assert.strictEqual(charlie.contributions[1].bracket, null);
    near(charlie.addedPercent, 25 / 9.9, 1e-12);
    near(charlie.factor, 1 + 25 / 9.9 / 100, 1e-12);
    // The order of the categories does not matter to the sum.
    const swapped = utils.buildLpbContext(activeBundle({categories: {
        dementia: {enabled: true, terrain: 'Dry', distances: DEMENTIA_DISTANCES},
        mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES}
    }}));
    near(utils.getLpbSegmentAdjustment(['R1', 'Alpha', '640 ac', '1 mi', '100 ft', '', '', '', '', 'a'], swapped).factor, alpha.factor, 1e-12);
});

check('sync-delta mirrors the section into its own single-record table', () => {
    assert.strictEqual(syncDelta.SINGLE_TABLE_KEYS.lostPersonBehavior, 'lost_person_behavior');
    assert.deepStrictEqual(syncDelta.describeChangeTarget({path: ['lostPersonBehavior'], value: {}}), {kind: 'single', table: 'lost_person_behavior'});
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
        setAttribute() {},
        getAttribute: () => null,
        // A selector lookup hands back a fresh child hung under this element, so
        // what the page appends to it can still be found by walk().
        querySelector: () => { const child = makeElement(depth + 1); el.children.push(child); return child; },
        querySelectorAll: () => [],
        insertBefore(child) { el.children.push(child); return child; },
        after() {},
        focus() {},
        blur() {},
        closest: () => null,
        scrollIntoView() {},
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

function createSandbox({store, fetch, page = 'page2'} = {}) {
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
        createTextNode: () => makeElement(),
        createRange: () => ({selectNodeContents() {}}),
        getElementById: (id) => (byId[id] = byId[id] || makeElement()),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
    };
    const logs = {warn: [], error: []};
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
        alert() {},
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
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A sync server that accepts every row batch and answers the LPB distance
// endpoints; every request is recorded.
function createServer(options = {}) {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (/\/api\/lpb\/distances/.test(text)) {
            if (method === 'GET') {
                return json({
                    defaults: options.defaults || {'Mental Illness': {'Mtn Temperate': {p25: '0.5', p50: '1.0', p75: '1.5', p95: '2.0'}, Dry: {p25: '0.6', p50: '1.1', p75: '1.7', p95: '2.4'}}},
                    overrides: options.overrides || {'Mental Illness': {Dry: {p50: '1.3'}}}
                });
            }
            return json({success: true});
        }
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {fetch, requests};
}

// The case: two regions (R1 gets 60 % of the consensus), four R1 segments of
// one square mile each, and the CalTopo shapes of three of them.
const SEG = (name, caltopoId = '') => ['R1', name, '640 ac', '1 mi', '100 ft', '', '', '', '', caltopoId];
function seedStore({lpb, segments, searchLog, features} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', ''], ['R2', '4', '']], voterVisibility: [true]};
    bundle.pages.page2 = segments || [SEG('Alpha', 'a'), SEG('Bravo'), SEG('Charlie', 'c'), SEG('Delta')];
    if (searchLog) bundle.pages.page4 = searchLog;
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || activeBundle().maps[0].features}];
    if (lpb !== undefined) bundle.lostPersonBehavior = lpb;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const FULL_LPB = activeBundle().lostPersonBehavior;
const psri = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[6]]));
const psrc = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[7]]));
const settle = () => new Promise(resolve => setImmediate(resolve));

check('the section survives sanitizeBundle / saveBundle and starts out canonical', async () => {
    const store = seedStore();
    const app = createSandbox({store, fetch: createServer().fetch});
    assert.deepStrictEqual(plain(app.defaultBundle().lostPersonBehavior), utils.normalizeLostPersonBehavior(null));
    assert.deepStrictEqual(plain(app.loadBundle().lostPersonBehavior), utils.normalizeLostPersonBehavior(null));

    const bundle = app.loadBundle();
    bundle.lostPersonBehavior = FULL_LPB;
    await app.saveBundle(bundle);
    const reloaded = createSandbox({store, fetch: createServer().fetch}).loadBundle();
    assert.deepStrictEqual(plain(reloaded.lostPersonBehavior), utils.normalizeLostPersonBehavior(FULL_LPB));
    assert.strictEqual(reloaded.lostPersonBehavior.ipp.lat, IPP.lat);
    assert.strictEqual(reloaded.lostPersonBehavior.categories.mentalIllness.enabled, true);
});

check('PSRi gains its bracket\'s percentage per mile; PSRc and the search log follow', () => {
    const plainApp = createSandbox({store: seedStore(), fetch: createServer().fetch});
    plainApp.recalculateEverything();
    // ((100 ft * 1 mi) / 2 hr) * (0.6 * 640 / 2560) / (640 / 640) = 7.5 for every segment.
    assert.deepStrictEqual(psri(plainApp), {Alpha: '7.5000', Bravo: '7.5000', Charlie: '7.5000', Delta: '7.5000'});

    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: createServer().fetch});
    app.recalculateEverything();
    assert.deepStrictEqual(psri(app), {
        Alpha: '11.2500',   // 0.3 mi: 25 % bracket, 25 % / 0.5 mi = 50 %/mi -> 7.5 + 0.5 x 7.5
        Bravo: '11.2500',   // 0.7 mi (matched as "R1 - Bravo"): 50 % bracket, (50 - 25) % / (1.0 - 0.5) mi = 50 %/mi
        Charlie: '7.5000',  // 5 mi: beyond the 95 % distance
        Delta: '7.5000'     // no shape on the map
    });
    assert.deepStrictEqual(psrc(app), psri(app), 'nothing searched yet: PSRc equals PSRi');

    // A search of Alpha: PSR before uses the adjusted share (x1.5), then decays.
    const searched = createSandbox({
        store: seedStore({lpb: FULL_LPB, searchLog: [['#1', '', '', 'R1', 'Alpha', '', '', 'Team A (2)', '100 ft', '2']]}),
        fetch: createServer().fetch
    });
    searched.recalculateEverything();
    const log = searched.loadBundle().pages.page4[0];
    assert.strictEqual(log[5], '11.2500', 'PSR before the sweep is the adjusted PSRi');
    assert.ok(parseFloat(log[6]) < 11.25 && parseFloat(log[6]) > 0, `PSR after the sweep decays from the adjusted share (${log[6]})`);
    assert.strictEqual(psrc(searched).Alpha, log[6], 'PSRc of the searched segment is its PSR after');
    assert.strictEqual(psri(searched).Alpha, '11.2500');
});

check('two categories on: every category\'s addition is worked out from the plain PSRi, then all are summed onto it', () => {
    const app = createSandbox({store: seedStore({lpb: twoCategories().lostPersonBehavior}), fetch: createServer().fetch});
    app.recalculateEverything();
    const values = psri(app);
    // Alpha / Bravo: Mental Illness adds 50 %, Dementia (25 % / 1.9 mi) 13.16 %: 7.5 x 1.6316 = 12.2368.
    assert.strictEqual(values.Alpha, (7.5 * (1 + (50 + 25 / 1.9) / 100)).toFixed(4));
    assert.strictEqual(values.Alpha, '12.2368');
    assert.strictEqual(values.Bravo, '12.2368');
    // Charlie (5 mi): only Dementia's 50 % bracket reaches it, 25 % / 9.9 mi = 2.53 %: 7.5 x 1.0253 = 7.6894.
    assert.strictEqual(values.Charlie, (7.5 * (1 + 25 / 9.9 / 100)).toFixed(4));
    assert.strictEqual(values.Charlie, '7.6894');
    assert.strictEqual(values.Delta, '7.5000', 'no shape: nothing added');
    assert.deepStrictEqual(psrc(app), values);
    // Switching Dementia off leaves Mental Illness's addition alone.
    app.updateLostPersonBehavior((lpb) => { lpb.categories.dementia.enabled = false; return 'off'; });
    app.recalculateEverything();
    assert.deepStrictEqual(psri(app), {Alpha: '11.2500', Bravo: '11.2500', Charlie: '7.5000', Delta: '7.5000'});
});

check('the Segments page switch lifts and re-applies the adjustment without losing the settings', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch});
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '11.2500');

    await app.setLpbPsrAdjustmentEnabled(false);
    app.recalculateEverything();
    assert.deepStrictEqual(psri(app), {Alpha: '7.5000', Bravo: '7.5000', Charlie: '7.5000', Delta: '7.5000'});
    let lpb = app.loadBundle().lostPersonBehavior;
    assert.strictEqual(lpb.psrAdjustmentEnabled, false);
    assert.strictEqual(lpb.categories.mentalIllness.enabled, true, 'the category stays on');
    assert.deepStrictEqual(plain(lpb.categories.mentalIllness.distances), DISTANCES, 'the distances stay');
    assert.strictEqual(lpb.ipp.featureName, 'IPP', 'the IPP stays');
    assert.strictEqual(app.buildLpbContext(app.loadBundle()).reason, 'disabled');
    assert.ok(app.loadBundle().activityLog.some(e => /switched off on the Segments page/.test(e.action)), 'the switch is logged');

    await app.setLpbPsrAdjustmentEnabled(true);
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '11.2500');
    lpb = app.loadBundle().lostPersonBehavior;
    assert.strictEqual(lpb.psrAdjustmentEnabled, true);
    assert.strictEqual(await app.setLpbPsrAdjustmentEnabled(true), false, 'no change, nothing saved');
});

check('importing the IPP marker stores its position in the case and sends the section to the server', async () => {
    const server = createServer();
    const lpbWithoutIpp = {...FULL_LPB, ipp: null};
    const app = createSandbox({store: seedStore({lpb: lpbWithoutIpp}), fetch: server.fetch});
    assert.strictEqual(app.buildLpbContext(app.loadBundle()).reason, 'no-ipp');
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '7.5000', 'without an IPP nothing is adjusted');

    assert.strictEqual(app.setLostPersonIpp(markerAt('IPP', 'mk1', IPP.lat, IPP.lng)), true);
    await settle();
    const ipp = app.loadBundle().lostPersonBehavior.ipp;
    assert.strictEqual(ipp.featureId, 'mk1');
    assert.strictEqual(ipp.featureName, 'IPP');
    assert.strictEqual(ipp.lat, IPP.lat);
    assert.strictEqual(ipp.lng, IPP.lng);
    assert.ok(ipp.importedAt, 'the import time is kept');
    assert.ok(app.loadBundle().activityLog.some(e => /IPP imported from CalTopo marker "IPP"/.test(e.action)), 'the import is logged');

    const rowBatches = server.requests.filter(r => /\/rows/.test(r.url) && r.method === 'POST');
    assert.ok(rowBatches.length > 0, 'the change went to the server as a row batch');
    const changes = rowBatches.flatMap(r => r.body.changes || []);
    // The diff stops one level inside the section (one change per key), so the
    // IPP travels as lostPersonBehavior.ipp; the server maps any path under
    // lostPersonBehavior to the lost_person_behavior table (and lpb_ipp).
    const ippChange = changes.find(c => c.path[0] === 'lostPersonBehavior' && (c.path.length === 1 || c.path[1] === 'ipp'));
    assert.ok(ippChange, 'the batch carries the section\'s IPP');
    const sentIpp = ippChange.path.length === 1 ? ippChange.value.ipp : ippChange.value;
    assert.strictEqual(sentIpp.lat, IPP.lat, 'with the IPP position for the lpb_ipp table');
    assert.strictEqual(sentIpp.featureId, 'mk1');
    assert.ok(rowBatches.some(r => /\/api\/v1\/LPB-1_tester\/rows/.test(r.url)), 'under this login\'s bucket for the case');

    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '11.2500', 'the adjustment applies as soon as the IPP is there');
    assert.strictEqual(app.setLostPersonIpp({attributes: {name: 'nowhere'}}), false, 'a marker without a position is refused');

    app.clearLostPersonIpp();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.ipp, null);
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '7.5000');
});

check('the login\'s distances are read from and written to /api/lpb/distances', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch});
    const tables = await app.loadLpbDistances();
    assert.ok(server.requests.some(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'GET'), 'GET /api/lpb/distances');
    assert.strictEqual(tables.defaults['Mental Illness'].Dry.p50, 1.1, 'DECIMAL strings become numbers');
    assert.strictEqual(tables.overrides['Mental Illness'].Dry.p50, 1.3);
    assert.strictEqual(app.getLpbDefaultDistance('Mental Illness', 'Dry', 'p50'), 1.1);
    assert.strictEqual(app.getLpbDefaultDistance('Mental Illness', 'Urban', 'p50'), 1.0, 'a terrain the server did not list falls back to the seed value');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Dry')), {p25: 0.6, p50: 1.3, p75: 1.7, p95: 2.4}, 'the login\'s edit wins over the default');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Mtn Temperate')), {p25: 0.5, p50: 1.0, p75: 1.5, p95: 2.0});

    assert.strictEqual(await app.saveLpbOverrideDistance('Mental Illness', 'Dry', 'p25', 0.9), true);
    const put = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.strictEqual(put.length, 1);
    assert.deepStrictEqual(put[0].body, {category: 'Mental Illness', terrain: 'Dry', values: {p25: 0.9, p50: 1.3, p75: null, p95: null}}, 'every bracket of the row travels; untouched ones as null');
    assert.strictEqual(put[0].body.category, 'Mental Illness');

    await app.saveLpbOverrideDistance('Mental Illness', 'Dry', 'p50', null);
    const put2 = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT')[1];
    assert.deepStrictEqual(put2.body.values, {p25: 0.9, p50: null, p75: null, p95: null}, 'a reset takes the bracket out of the login\'s row');
    assert.deepStrictEqual(plain(app.getLpbEffectiveDistances('Mental Illness', 'Dry')), {p25: 0.9, p50: 1.1, p75: 1.7, p95: 2.4});
});

check('switching a category on copies the login\'s distances into the case; edits update case and login', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch, page: 'page6'});
    await app.loadLpbDistances();
    const category = app.getLpbCategories().find(cat => cat.key === 'mentalIllness');
    assert.strictEqual(category.label, 'Mental Illness');

    // What the category switch does (buildLpbCategoryRow).
    app.updateLostPersonBehavior((lpb) => {
        const target = lpb.categories[category.key];
        target.enabled = true;
        target.terrain = 'Dry';
        if (!app.isCompleteLpbDistances(target.distances)) target.distances = app.getLpbEffectiveDistances(category.label, target.terrain);
        return 'on';
    });
    let entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.enabled, true);
    assert.deepStrictEqual(plain(entry.distances), {p25: 0.6, p50: 1.3, p75: 1.7, p95: 2.4}, 'the case starts from the login\'s Dry values');

    // Typing 2.0 under the 75 % column.
    app.setLpbCaseDistance(category, {key: 'p75', percent: 75}, 2.0, 1.7);
    await settle();
    entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.distances.p75, 2.0, 'the case has the typed value');
    const puts = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.deepStrictEqual(puts[puts.length - 1].body, {category: 'Mental Illness', terrain: 'Dry', values: {p25: null, p50: 1.3, p75: 2.0, p95: null}});
    assert.ok(app.loadBundle().activityLog.some(e => /75% distance changed from 1.7 mi to 2.0 mi/.test(e.action)), 'the edit is logged');

    // Reset to the database default (1.7): the login's row loses the bracket.
    app.setLpbCaseDistance(category, {key: 'p75', percent: 75}, app.getLpbDefaultDistance('Mental Illness', 'Dry', 'p75'), 2.0);
    await settle();
    entry = app.loadBundle().lostPersonBehavior.categories.mentalIllness;
    assert.strictEqual(entry.distances.p75, 1.7);
    const puts2 = server.requests.filter(r => /\/api\/lpb\/distances/.test(r.url) && r.method === 'PUT');
    assert.deepStrictEqual(puts2[puts2.length - 1].body.values, {p25: null, p50: 1.3, p75: null, p95: null});
    assert.strictEqual(app.getLpbOverrideDistance('Mental Illness', 'Dry', 'p75'), null);
});

check('the Incident page section renders (heading with the IPP control, group titles, one row per category, the graph)', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch, page: 'page6'});
    app.buildProfilePage();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    const container = app.__byId['profile-form-container'];
    assert.ok(container.children.some(el => el.classList.contains('lpb-section')), 'the section is appended below the profile form');
    const section = app.__byId['lpb-section'];
    assert.ok(/Lost Person Behavior/.test(section.innerHTML), 'the section heading');
    assert.ok(/lpb-section-ipp/.test(section.innerHTML), 'the IPP control sits in the heading row');
    assert.ok(/percentage per mile/.test(section.innerHTML), 'the paragraph explains the per-mile maths');

    // Group titles and category rows, in list order: a title, then its rows.
    const items = section.children.filter(el => el.classList.contains('lpb-group-title') || el.classList.contains('lpb-category'));
    const titles = items.filter(el => el.classList.contains('lpb-group-title')).map(el => el.textContent);
    assert.deepStrictEqual(titles, utils.LPB_CATEGORY_GROUPS.map(g => g.title));
    const rows = items.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(rows.length, utils.LPB_CATEGORIES.length, 'one row per category');
    assert.deepStrictEqual(rows.map(el => el.dataset.category), utils.LPB_CATEGORIES.map(c => c.key));
    const expectedOrder = [];
    utils.LPB_CATEGORY_GROUPS.forEach(g => { expectedOrder.push(`title:${g.key}`); g.categories.forEach(c => expectedOrder.push(c.key)); });
    assert.deepStrictEqual(items.map(el => (el.classList.contains('lpb-group-title') ? `title:${el.dataset.group}` : el.dataset.category)), expectedOrder, 'each title sits right before its categories');

    const mental = rows.find(el => el.dataset.category === 'mentalIllness');
    assert.strictEqual(mental.classList.contains('collapsed'), false, 'switched on: the graph is open');
    const header = mental.children[0];
    assert.ok(/lpb-category-toggle/.test(header.innerHTML) && /checked/.test(header.innerHTML), 'the switch is on');
    assert.ok(/Mental Illness/.test(header.innerHTML));
    rows.filter(el => el !== mental).forEach(el => assert.strictEqual(el.classList.contains('collapsed'), true, `${el.dataset.category} is off and folded`));
    const dementia = rows.find(el => el.dataset.category === 'dementia');
    assert.ok(/Dementia/.test(dementia.children[0].innerHTML) && !/checked/.test(dementia.children[0].innerHTML), 'Dementia has its own switch, off');
    assert.ok(walk(dementia).some(el => el.classList.contains('lpb-chart')), 'every category has its own graph');

    const chart = walk(mental).find(el => el.classList.contains('lpb-chart'));
    assert.ok(chart, 'the column graph is rendered');
    const labels = walk(chart).filter(el => el.classList.contains('lpb-chart-col-label')).map(el => el.textContent);
    assert.deepStrictEqual(labels, ['25%', '50%', '75%', '95%']);
    const bars = walk(chart).filter(el => el.classList.contains('lpb-chart-bar')).map(el => el.style.height);
    assert.deepStrictEqual(bars, ['25%', '50%', '75%', '100%'], 'the bars scale from 0 mi to the largest distance (2.0 mi)');
    const values = walk(chart).filter(el => el.classList.contains('lpb-chart-value')).map(el => el.textContent);
    assert.deepStrictEqual(values, ['0.5 mi', '1.0 mi', '1.5 mi', '2.0 mi']);
    const ratesShown = walk(chart).filter(el => el.classList.contains('lpb-chart-rate')).map(el => el.textContent);
    assert.deepStrictEqual(ratesShown, ['50% / mi', '50% / mi', '50% / mi', '40% / mi'], 'each column shows its percentage per mile');
    const barTitles = walk(chart).filter(el => el.classList.contains('lpb-chart-bar')).map(el => el.title);
    assert.ok(/50% per mile \(25% over 0\.0 mi to 0\.5 mi\)/.test(barTitles[0]), barTitles[0]);
    assert.ok(/40% per mile \(20% over 1\.5 mi to 2\.0 mi\)/.test(barTitles[3]), barTitles[3]);
    assert.strictEqual(walk(chart).filter(el => el.classList.contains('lpb-reset-btn')).length, 0, 'every value is the default: no reset buttons');

    // The IPP control: a pill for the imported marker (Import IPP only when there is none).
    const ippPill = walk(section).find(el => el.classList.contains('lpb-ipp-pill'));
    assert.ok(ippPill, 'the imported IPP is shown as a pill');
    assert.strictEqual(walk(section).filter(el => el.classList.contains('lpb-import-ipp-btn')).length, 0);

    // Every category off: all collapsed, and the case with no IPP shows Import IPP.
    const offApp = createSandbox({store: seedStore(), fetch: server.fetch, page: 'page6'});
    offApp.buildProfilePage();
    await settle();
    const offSection = offApp.__byId['lpb-section'];
    const offRows = offSection.children.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(offRows.length, utils.LPB_CATEGORIES.length);
    assert.ok(offRows.every(el => el.classList.contains('collapsed')));
    assert.ok(walk(offSection).some(el => el.classList.contains('lpb-import-ipp-btn')), 'Import IPP is offered when the case has no IPP');

    // Two categories on: both rows open, each with its own graph values.
    const twoApp = createSandbox({store: seedStore({lpb: twoCategories().lostPersonBehavior}), fetch: server.fetch, page: 'page6'});
    twoApp.buildProfilePage();
    await settle();
    const twoRows = twoApp.__byId['lpb-section'].children.filter(el => el.classList.contains('lpb-category'));
    assert.deepStrictEqual(twoRows.filter(el => !el.classList.contains('collapsed')).map(el => el.dataset.category), ['dementia', 'mentalIllness']);
    const dementiaChart = walk(twoRows.find(el => el.dataset.category === 'dementia')).find(el => el.classList.contains('lpb-chart'));
    assert.deepStrictEqual(walk(dementiaChart).filter(el => el.classList.contains('lpb-chart-value')).map(el => el.textContent), ['1.9 mi', '11.8 mi', '20.0 mi', '30.0 mi']);
    assert.deepStrictEqual(walk(dementiaChart).filter(el => el.classList.contains('lpb-chart-rate')).map(el => el.textContent), ['13.2% / mi', '2.5% / mi', '3% / mi', '2% / mi']);

    // An edited value gets a reset button.
    const edited = {...FULL_LPB, categories: {mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: {...DISTANCES, p50: 1.2}}}};
    const editedApp = createSandbox({store: seedStore({lpb: edited}), fetch: server.fetch, page: 'page6'});
    editedApp.buildProfilePage();
    await settle();
    const editedRow = editedApp.__byId['lpb-section'].children.find(el => el.classList.contains('lpb-category') && el.dataset.category === 'mentalIllness');
    const editedChart = walk(editedRow).find(el => el.classList.contains('lpb-chart'));
    const resets = walk(editedChart).filter(el => el.classList.contains('lpb-reset-btn'));
    assert.strictEqual(resets.length, 1, 'only the edited 50 % value has a reset button');
    assert.ok(/1.0 mi/.test(resets[0].title), 'the reset names the database default');
});

check('the Maps page shows the same section in the left half of a screen-wide row, the map in the right half, in a column that scrolls inside itself', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch, page: 'page10'});
    const main = makeElement();
    app.document.querySelector = (selector) => (selector === 'main' ? main : null);
    app.buildMapsPage();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);

    // The row: the section's column first (left), the map second (right), the
    // unaccounted features below the row.
    const html = main.innerHTML;
    const at = (marker) => html.indexOf(marker);
    assert.ok(at('id="map-lpb-row"') !== -1 && at('id="map-lpb-panel"') !== -1 && at('id="map-lpb-scroll"') !== -1 && at('id="map-view-section"') !== -1, 'row, LPB column, its scroll area and the map card are rendered');
    assert.ok(at('id="map-lpb-row"') < at('id="map-lpb-panel"') && at('id="map-lpb-panel"') < at('id="map-lpb-scroll"') && at('id="map-lpb-scroll"') < at('id="map-view-section"'), 'the LPB column comes before (left of) the map inside the row');
    assert.ok(at('id="map-view-section"') < at('id="unaccounted-features-section"'), 'the unaccounted features follow the row');
    assert.ok(/class="map-lpb-row"/.test(html) && /class="table-card map-lpb-panel"/.test(html) && /class="table-card map-lpb-map"/.test(html), 'the stylesheet hooks are in place');
    assert.ok(!/id="map-view-section"[^>]*75vh/.test(html), 'the map card no longer sizes itself inline: the row sizes both columns');

    // The section lands in the scroll area under its usual id, so every
    // handler's renderLostPersonBehaviorSection() redraws it in place.
    assert.ok(app.__byId['map-lpb-scroll'].children.some(el => el.classList.contains('lpb-section')), 'the section is appended to the scroll area');
    const section = app.__byId['lpb-section'];
    assert.ok(/Lost Person Behavior/.test(section.innerHTML) && /lpb-section-ipp/.test(section.innerHTML), 'the same heading with the IPP control');
    const rows = section.children.filter(el => el.classList.contains('lpb-category'));
    assert.strictEqual(rows.length, utils.LPB_CATEGORIES.length, 'one row per category');
    assert.deepStrictEqual(section.children.filter(el => el.classList.contains('lpb-group-title')).map(el => el.textContent), utils.LPB_CATEGORY_GROUPS.map(g => g.title), 'the group titles');
    const mental = rows.find(el => el.dataset.category === 'mentalIllness');
    assert.ok(mental && !mental.classList.contains('collapsed') && walk(mental).some(el => el.classList.contains('lpb-chart')), 'Mental Illness is on, with its graph');
    assert.ok(walk(section).some(el => el.classList.contains('lpb-ipp-pill')), 'the imported IPP pill');
    assert.strictEqual(app.__byId['map-lpb-row'].style.display, '', 'the row is shown with the map (the inline display: none is lifted)');

    // Flipping the switch in the Maps page copy changes the case exactly like on
    // the Incident page - and the PSR values follow at once.
    app.recalculateEverything();
    assert.strictEqual(psri(app).Alpha, '11.2500');
    const toggle = walk(mental).find(el => typeof el.onchange === 'function' && !el.classList.contains('lpb-terrain-select'));
    assert.ok(toggle, 'the category switch');
    toggle.checked = false;
    await toggle.onchange();
    await settle();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.categories.mentalIllness.enabled, false);
    assert.strictEqual(psri(app).Alpha, '7.5000', 'the PSRi is recomputed by the switch itself, not by a later visit to the Segments page');
    assert.ok(app.loadBundle().activityLog.some(e => /Mental Illness \(Mtn Temperate\) switched off/.test(e.action)), 'logged like on the Incident page');

    // No map in the case: neither the map card nor the LPB column.
    const noMapStore = seedStore({lpb: FULL_LPB});
    const noMapBundle = JSON.parse(noMapStore[BUNDLE_KEY]);
    noMapBundle.maps = [];
    noMapStore[BUNDLE_KEY] = JSON.stringify(noMapBundle);
    const noMapApp = createSandbox({store: noMapStore, fetch: server.fetch, page: 'page10'});
    const noMapMain = makeElement();
    noMapApp.document.querySelector = (selector) => (selector === 'main' ? noMapMain : null);
    noMapApp.buildMapsPage();
    await settle();
    assert.deepStrictEqual(noMapApp.__logs.error, []);
    assert.strictEqual(noMapApp.__byId['map-lpb-row'].style.display, 'none', 'hidden without a map');
});

check('styles.css / app.js: the Maps page row spans the whole screen, the LPB column is as tall as the map and scrolls inside itself, and the columns stack on mobile', () => {
    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    const block = (selector) => {
        const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
        assert.ok(match, `${selector} is styled`);
        return match[1];
    };
    const row = block('.map-lpb-row');
    assert.ok(/width:\s*var\(--sar-viewport-width,\s*100vw\)/.test(row), 'the row is as wide as the screen (measured width, 100vw fallback)');
    assert.ok(/margin-left:\s*calc\(50% - var\(--sar-viewport-width,\s*100vw\) \/ 2\)/.test(row), 'and starts at the screen\'s left edge, out of <main>');
    assert.ok(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(row), 'two equal halves');
    assert.ok(/--map-lpb-height:\s*75vh/.test(row), 'the shared height of both columns');
    assert.ok(/height:\s*var\(--map-lpb-height\)/.test(block('.map-lpb-map')), 'the map card takes the shared height');
    const panel = block('.map-lpb-panel.table-card');
    assert.ok(/height:\s*var\(--map-lpb-height\)/.test(panel) && /overflow:\s*hidden/.test(panel), 'the LPB column is exactly as tall as the map');
    const scroll = block('.map-lpb-scroll');
    assert.ok(/overflow-y:\s*auto/.test(scroll) && /min-height:\s*0/.test(scroll), 'and scrolls inside itself');
    assert.ok(!/overscroll-behavior/.test(scroll) && !/overscroll-behavior/.test(panel), 'no overscroll trap: at the end of the column the page scrolls on to the unaccounted features');
    assert.ok(/@media \(max-width: 860px\) \{\s*\.map-lpb-row \{\s*grid-template-columns: minmax\(0, 1fr\);/.test(css), 'one column (stacked) in mobile mode');
    assert.ok(/@container map-lpb \(max-width: 620px\)/.test(css) && /container: map-lpb \/ inline-size/.test(panel), 'a half-screen column gets the compact rules');

    // The measured width: documentElement.clientWidth (no scrollbar) into the
    // variable the row is sized from, kept current, asked for by the Maps page.
    assert.ok(/function syncViewportWidthVariable\(\)/.test(appSource));
    assert.ok(/root\.style\.setProperty\('--sar-viewport-width', `\$\{width\}px`\)/.test(appSource), 'the variable is written on <html>');
    assert.ok(/const width = Number\(root\.clientWidth\)/.test(appSource), 'from the document width without the scrollbar');
    assert.ok(/new ResizeObserver\(\(\) => syncViewportWidthVariable\(\)\)\.observe\(root\)/.test(appSource), 'kept current by a ResizeObserver on <html>');
    const maps = appSource.slice(appSource.indexOf('function buildMapsPage()'));
    assert.ok(/buildLostPersonBehaviorSection\(document\.getElementById\('map-lpb-scroll'\)\)/.test(maps), 'the Maps page renders the section into the scroll area');
    assert.ok(/syncViewportWidthVariable\(\);/.test(maps), 'and measures the screen for the row');
});

check('the Segments page shows the switch state and tags the PSRi pills with what they gain', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: server.fetch});
    // The sandbox's getElementById creates the elements the page would have.
    app.document.getElementById('lpb-toggle').checked = false;
    app.document.getElementById('lpb-label');
    app.buildSegmentsTable();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    assert.strictEqual(app.__byId['lpb-toggle'].checked, true, 'the switch shows the case\'s state');
    assert.ok(/^Applying Mental Illness \(Mtn Temperate\) from IPP "IPP"\.$/.test(app.__byId['lpb-label'].textContent), app.__byId['lpb-label'].textContent);

    const tags = walk(app.__byId['table-body']).filter(el => el.classList.contains('psri-bracket-tag'));
    assert.deepStrictEqual(tags.map(t => t.textContent), ['+50%', '+50%'], 'Alpha and Bravo gain 50 % and carry a tag; Charlie and Delta do not');
    assert.ok(/0\.3 mi from the IPP, PSRi \+ 50% of itself \(x1\.5000\)/.test(tags[0].title), tags[0].title);
    assert.ok(/Mental Illness \(Mtn Temperate\): 25% bracket \(25% over 0\.0 mi to 0\.5 mi = 50% per mile\), adds 50% of the PSRi\./.test(tags[0].title), tags[0].title);
    const tagged = walk(app.__byId['table-body']).filter(el => el.classList.contains('has-lpb-tag'));
    assert.strictEqual(tagged.length, 2, 'the tagged PSRi containers let the tag overflow');

    // Two categories: the tag is the sum, the tooltip lists both.
    const twoApp = createSandbox({store: seedStore({lpb: twoCategories().lostPersonBehavior}), fetch: server.fetch});
    twoApp.document.getElementById('lpb-toggle');
    twoApp.document.getElementById('lpb-label');
    twoApp.buildSegmentsTable();
    await settle();
    assert.deepStrictEqual(twoApp.__logs.error, []);
    assert.strictEqual(twoApp.__byId['lpb-label'].textContent, 'Applying Dementia (Dry), Mental Illness (Mtn Temperate) from IPP "IPP".');
    const twoTags = walk(twoApp.__byId['table-body']).filter(el => el.classList.contains('psri-bracket-tag'));
    assert.deepStrictEqual(twoTags.map(t => t.textContent), ['+63.2%', '+63.2%', '+2.5%'], 'Alpha, Bravo (both categories) and Charlie (Dementia only)');
    assert.ok(/Dementia \(Dry\): 25% bracket \(25% over 0\.0 mi to 1\.9 mi = 13\.2% per mile\), adds 13\.2% of the PSRi\./.test(twoTags[0].title), twoTags[0].title);
    assert.ok(/Mental Illness \(Mtn Temperate\): 25% bracket/.test(twoTags[0].title));
    assert.ok(/Mental Illness \(Mtn Temperate\): beyond its 95% distance, adds nothing\./.test(twoTags[2].title), twoTags[2].title);
    assert.ok(/Dementia \(Dry\): 50% bracket \(25% over 1\.9 mi to 11\.8 mi = 2\.5% per mile\)/.test(twoTags[2].title), twoTags[2].title);
    // One category still without its distances is pointed out in the status line.
    const partial = twoCategories({categories: {
        mentalIllness: {enabled: true, terrain: 'Mtn Temperate', distances: DISTANCES},
        dementia: {enabled: true, terrain: 'Dry', distances: {p25: 1.9}}
    }}).lostPersonBehavior;
    assert.strictEqual(app.describeLpbStatus(app.buildLpbContext({lostPersonBehavior: partial, maps: []})), 'Applying Mental Illness (Mtn Temperate) from IPP "IPP". Dementia: enter the four distances on the Incident page to include it.');

    // The switch: off lifts the adjustment and the tags.
    app.__byId['lpb-toggle'].checked = false;
    app.__byId['lpb-toggle'].onchange();
    await settle();
    assert.strictEqual(app.loadBundle().lostPersonBehavior.psrAdjustmentEnabled, false);
    assert.strictEqual(psri(app).Alpha, '7.5000');
    assert.ok(/^Off - PSRi values are not adjusted\. Mental Illness and the IPP stay set/.test(app.__byId['lpb-label'].textContent), app.__byId['lpb-label'].textContent);
    assert.strictEqual(walk(app.__byId['table-body']).filter(el => el.classList.contains('psri-bracket-tag')).length, 0);

    // Status lines for the other states.
    assert.strictEqual(app.describeLpbStatus(app.buildLpbContext({})), 'No lost person category is switched on (Incident page, Lost Person Behavior).');
    assert.ok(/import the IPP marker/.test(app.describeLpbStatus(app.buildLpbContext({lostPersonBehavior: {...FULL_LPB, ipp: null}}))));
    assert.ok(/enter the four distances/.test(app.describeLpbStatus(app.buildLpbContext({lostPersonBehavior: {...FULL_LPB, categories: {mentalIllness: {enabled: true, distances: {p25: 1}}}}}))));
});

check('appendLpbBracketTag: a tag inside a bracket, a tooltip only beyond it or without a shape', () => {
    const app = createSandbox({store: seedStore({lpb: FULL_LPB}), fetch: createServer().fetch});
    const context = app.buildLpbContext(app.loadBundle());
    const tagged = () => {
        const container = makeElement();
        const cell = makeElement();
        return {container, cell};
    };

    let {container, cell} = tagged();
    app.appendLpbBracketTag(container, cell, SEG('Bravo'), context);
    assert.strictEqual(container.children.length, 1);
    assert.strictEqual(container.children[0].textContent, '+50%');
    assert.strictEqual(container.classList.contains('has-lpb-tag'), true);
    assert.ok(/50% bracket \(25% over 0\.5 mi to 1\.0 mi = 50% per mile\), adds 50% of the PSRi/.test(cell.title), cell.title);

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Charlie', 'c'), context);
    assert.strictEqual(container.children.length, 0, 'beyond the 95 % distance: no tag');
    assert.ok(/nothing is added to the PSRi/.test(cell.title));
    assert.ok(/beyond its 95% distance, adds nothing/.test(cell.title));

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Delta'), context);
    assert.strictEqual(container.children.length, 0, 'no shape: no tag');
    assert.ok(/no CalTopo shape/.test(cell.title));

    ({container, cell} = tagged());
    app.appendLpbBracketTag(container, cell, SEG('Alpha', 'a'), app.buildLpbContext({}));
    assert.strictEqual(container.children.length, 0, 'inactive: nothing');
    assert.strictEqual(cell.title, undefined);
});

(async () => {
    let failed = 0;
    for (const {name, fn} of checks) {
        try {
            await fn();
            console.log(`  ok - ${name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL - ${name}`);
            console.log(err && err.stack ? err.stack : err);
        }
    }
    if (failed) {
        console.log(`\n${failed} of ${checks.length} checks failed.`);
        process.exit(1);
    }
    console.log(`\nLost Person Behavior: PASS (${checks.length} checks)`);
})();

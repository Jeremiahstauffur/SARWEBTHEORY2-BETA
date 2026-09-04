const assert = require('assert');
const utils = require('./map-segment-utils.js');

console.log('--- Testing map feature sorting, searching, and unaccounted/unwanted bookkeeping ---');

const feature = (name, id, extra = {}) => ({
    geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
    attributes: {name, id, class: 'Assignment', ...extra}
});

const alpha = feature('Alpha', 'id-alpha');
const bravo = feature('bravo', 'id-bravo');
const charlie = feature('Charlie', 'id-charlie');
const ten = feature('10 Delta', 'id-10');
const two = feature('2 Echo', 'id-2');
const noId = feature('Foxtrot', 'gfx-4');

// 1. Alphabetical A-Z sort (case-insensitive, numeric-aware, non-mutating)
{
    const input = [charlie, ten, bravo, two, alpha];
    const sorted = utils.sortFeaturesByName(input);
    assert.deepStrictEqual(sorted.map(utils.getFeatureDisplayName), ['2 Echo', '10 Delta', 'Alpha', 'bravo', 'Charlie']);
    assert.deepStrictEqual(input.map(utils.getFeatureDisplayName), ['Charlie', '10 Delta', 'bravo', '2 Echo', 'Alpha'], 'input must not be mutated');
    assert.strictEqual(utils.getFeatureDisplayName({attributes: {}}), 'Unnamed Graphic');
    console.log('  ok - sortFeaturesByName orders features A-Z without mutating the input');
}

// 2. Search filter by segment name
{
    const all = [alpha, bravo, charlie, ten];
    assert.strictEqual(utils.filterFeaturesByName(all, '').length, 4, 'blank query keeps everything');
    assert.strictEqual(utils.filterFeaturesByName(all, '   ').length, 4, 'whitespace query keeps everything');
    assert.deepStrictEqual(utils.filterFeaturesByName(all, 'BRA').map(utils.getFeatureDisplayName), ['bravo']);
    assert.deepStrictEqual(utils.filterFeaturesByName(all, 'delta').map(utils.getFeatureDisplayName), ['10 Delta']);
    assert.deepStrictEqual(utils.filterFeaturesByName(all, 'zulu'), []);
    console.log('  ok - filterFeaturesByName matches case-insensitively on the segment name');
}

// 3. Identity: synthetic gfx ids never count as real ids
{
    assert.deepStrictEqual(utils.getFeatureIdentity(alpha), {id: 'id-alpha', name: 'alpha'});
    assert.deepStrictEqual(utils.getFeatureIdentity(noId), {id: '', name: 'foxtrot'});
    assert.strictEqual(utils.getFeatureIdentityKey(alpha), 'id:id-alpha');
    assert.strictEqual(utils.getFeatureIdentityKey(noId), 'name:foxtrot');
    assert.strictEqual(utils.isSyntheticFeatureId('gfx-12'), true);
    assert.strictEqual(utils.isSyntheticFeatureId('abc123'), false);
    console.log('  ok - getFeatureIdentity ignores synthetic gfx-N ids');
}

// 4. Accounted for by CalTopo id or by segment name
{
    const rows = [
        ['North', 'Alpha', '', '', '', '', '', '', '', ''],
        ['', 'Something Else', '', '', '', '', '', '', '', 'id-bravo'],
        ['', '', '', '', '', '', '', '', '', '']
    ];
    assert.strictEqual(utils.isFeatureAccountedFor(alpha, rows), true, 'matched by name');
    assert.strictEqual(utils.isFeatureAccountedFor(bravo, rows), true, 'matched by CalTopo id');
    assert.strictEqual(utils.isFeatureAccountedFor(charlie, rows), false);
    assert.strictEqual(utils.isFeatureAccountedFor(charlie, null), false);
    console.log('  ok - isFeatureAccountedFor matches segments by CalTopo id or name');
}

// 5. Unwanted list: mark, match, unmark, dedupe
{
    let unwanted = [];
    unwanted = utils.markFeaturesUnwanted(unwanted, [charlie, noId], '2026-01-01T00:00:00.000Z');
    assert.strictEqual(unwanted.length, 2);
    assert.deepStrictEqual(unwanted[0], {id: 'id-charlie', name: 'charlie', markedAt: '2026-01-01T00:00:00.000Z'});
    assert.deepStrictEqual(unwanted[1], {id: '', name: 'foxtrot', markedAt: '2026-01-01T00:00:00.000Z'});

    // marking again does not duplicate
    const again = utils.markFeaturesUnwanted(unwanted, [charlie]);
    assert.strictEqual(again.length, 2);
    assert.strictEqual(unwanted.length, 2, 'input list is not mutated');

    assert.strictEqual(utils.isFeatureUnwanted(charlie, unwanted), true);
    // Same name but a different real id is a different feature
    assert.strictEqual(utils.isFeatureUnwanted(feature('Charlie', 'id-other'), unwanted), false);
    // A name-only entry matches a feature with the same name and no real id
    assert.strictEqual(utils.isFeatureUnwanted(feature('foxtrot', 'gfx-99'), unwanted), true);
    assert.strictEqual(utils.isFeatureUnwanted(alpha, unwanted), false);

    const restored = utils.unmarkFeaturesUnwanted(unwanted, [charlie]);
    assert.deepStrictEqual(restored.map(e => e.name), ['foxtrot']);

    // Garbage entries are dropped when normalizing
    assert.deepStrictEqual(utils.normalizeUnwantedFeatureList([null, {}, {id: ' x '}, 'str']), [{id: 'x', name: ''}]);
    console.log('  ok - markFeaturesUnwanted / isFeatureUnwanted / unmarkFeaturesUnwanted behave and dedupe');
}

// 6. Unaccounted = not a segment and not unwanted, sorted A-Z
{
    const rows = [['', 'Alpha', '', '', '', '', '', '', '', '']];
    const unwanted = utils.markFeaturesUnwanted([], [charlie]);
    const result = utils.getUnaccountedFeatures([charlie, ten, alpha, bravo, two], rows, unwanted);
    assert.deepStrictEqual(result.map(utils.getFeatureDisplayName), ['2 Echo', '10 Delta', 'bravo']);
    assert.deepStrictEqual(utils.getUnaccountedFeatures([], rows, unwanted), []);
    assert.deepStrictEqual(utils.getUnaccountedFeatures(null, rows, unwanted), []);
    console.log('  ok - getUnaccountedFeatures excludes imported and unwanted features');
}

// 7. Notification text
{
    assert.strictEqual(utils.formatUnaccountedFeatureNotification([]), '');
    assert.strictEqual(utils.formatUnaccountedFeatureNotification(['Alpha']), 'Alpha is on the map but not imported as a segment.');
    assert.strictEqual(utils.formatUnaccountedFeatureNotification(['Alpha', 'Bravo']), 'Alpha and Bravo are on the map but not imported as segments.');
    assert.strictEqual(utils.formatUnaccountedFeatureNotification(['A', 'B', 'C']), 'A, B and C are on the map but not imported as segments.');
    assert.strictEqual(utils.formatUnaccountedFeatureNotification(['A', 'B', 'C', 'D'], 2), 'A, B and 2 more are on the map but not imported as segments.');
    console.log('  ok - formatUnaccountedFeatureNotification lists segment names with an overflow count');
}

// 8. Feature categories: Assignment vs Shape vs Marker vs Route vs Other
{
    const polygon = {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]]};
    const line = {type: 'LineString', coordinates: [[0, 0], [1, 1]]};
    const point = {type: 'Point', coordinates: [0, 0]};
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: polygon, attributes: {class: 'Assignment'}}), 'assignment');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: line, attributes: {class: 'Assignment'}}), 'assignment', 'a line assignment is still an assignment');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: polygon, attributes: {assignment: {number: '1'}}}), 'assignment');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: polygon, attributes: {class: 'Shape'}}), 'shape');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: polygon, attributes: {}}), 'shape', 'a plain polygon is a shape');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: line, attributes: {class: 'Shape'}}), 'route', 'a line shape is a route');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: point, attributes: {class: 'Marker'}}), 'marker');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: point, attributes: {type: 'Feature'}}), 'marker', 'the GeoJSON "Feature" type is ignored');
    assert.strictEqual(utils.getFeatureCategoryKey({geometry: null, attributes: {class: 'Folder'}}), 'other');
    assert.strictEqual(utils.getFeatureCategoryKey(null), 'other');
    assert.strictEqual(utils.getFeatureCategoryLabel({geometry: polygon, attributes: {class: 'Assignment'}}), 'Assignment');
    assert.strictEqual(utils.getFeatureCategoryLabel({geometry: line, attributes: {class: 'Shape'}}), 'Route');
    assert.deepStrictEqual(utils.FEATURE_CATEGORIES.map(c => c.key), ['marker', 'shape', 'assignment', 'route', 'other']);
    console.log('  ok - getFeatureCategoryKey tells assignments, shapes, markers, routes and other apart');
}

// 9. Feature-type filters: missing = on, only false switches a type off
{
    assert.deepStrictEqual(utils.normalizeFeatureTypeFilters(undefined), {marker: true, shape: true, assignment: true, route: true, other: true});
    assert.deepStrictEqual(utils.normalizeFeatureTypeFilters({marker: false, bogus: false, route: 'no'}), {marker: false, shape: true, assignment: true, route: true, other: true});
    assert.deepStrictEqual(utils.normalizeFeatureTypeFilters([false]), {marker: true, shape: true, assignment: true, route: true, other: true});
    const marker = {geometry: {type: 'Point', coordinates: [0, 0]}, attributes: {class: 'Marker', name: 'PLS', id: 'm1'}};
    assert.strictEqual(utils.isFeatureCategoryEnabled(marker, {marker: false}), false);
    assert.strictEqual(utils.isFeatureCategoryEnabled(marker, {}), true);
    assert.strictEqual(utils.isFeatureCategoryEnabled(alpha, {marker: false}), true);
    console.log('  ok - normalizeFeatureTypeFilters / isFeatureCategoryEnabled default every type to on');
}

// 10. Unwanted entries a type toggle added are tagged and can be restored as a group
{
    let unwanted = utils.markFeaturesUnwanted([], [charlie], '2026-01-01T00:00:00.000Z');
    unwanted = utils.markFeaturesUnwanted(unwanted, [alpha, bravo], '2026-01-01T00:00:00.000Z', 'marker');
    assert.deepStrictEqual(unwanted.map(e => e.filteredType), [undefined, 'marker', 'marker']);
    assert.deepStrictEqual(utils.normalizeUnwantedFeatureList(unwanted).map(e => e.filteredType), [undefined, 'marker', 'marker'], 'the tag survives normalization');
    assert.deepStrictEqual(utils.normalizeUnwantedFeatureList([{id: 'x', filteredType: 7}]), [{id: 'x', name: ''}], 'a bogus tag is dropped');

    const restored = utils.unmarkFeaturesUnwantedByFilteredType(unwanted, 'marker');
    assert.deepStrictEqual(restored.map(e => e.name), ['charlie'], 'only the toggle-marked entries are removed');
    assert.strictEqual(unwanted.length, 3, 'input list is not mutated');
    assert.deepStrictEqual(utils.unmarkFeaturesUnwantedByFilteredType(unwanted, 'route').map(e => e.name), ['charlie', 'alpha', 'bravo']);
    console.log('  ok - markFeaturesUnwanted tags toggle-marked entries and unmarkFeaturesUnwantedByFilteredType restores them');
}

console.log('All map unaccounted feature tests passed.');

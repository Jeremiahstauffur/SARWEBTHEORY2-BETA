// Search Log page "Map Tracking": the searchers' CalTopo tracks measured
// against the segment shapes, allocated to the tasks and used in place of
// Num of Sweeps x segment length in the PSR maths.
//
// Part 1 checks the pure maths shared through map-segment-utils.js: track
// paths and their length, point-in-polygon (with a hole), the exact clipping
// of a track leg against a segment shape (leave and re-enter), the split of a
// track across two adjacent segments, the "#task-segment " name code (parsed,
// never stacked), the canonical track record and the allocation rules (home
// segment = majority of the miles, spill-over to the other segment's latest
// task, two tasks on the home segment = ambiguous until picked).
//
// Part 2 drives the real app.js in a sandbox (in-memory store, fake DOM, a
// scripted fetch and a recording caltopo_api_call) to check that
//   - both bundle keys survive sanitizeBundle / saveBundle and reach the
//     server as row changes (searcher_tracks / settings_page),
//   - with the switch off the classic formula is untouched, with it on the
//     task's track miles take the place of numSweeps x length x numMembers
//     (search log PSR after, PSRc, calculatePSRAfter, the charts) and the
//     "log sweeps" reminders are off,
//   - the Search Log renders the switch, the "Tracks (mi)" header, the faded
//     sweeps pills with their mile tags, the red question marks and the
//     Searchers Tracks table,
//   - importing a fetched line stores the measured record, the rename with
//     the "#1-4D " code goes to CalTopo once and a fetched name that already
//     carries the code is not prefixed again,
//   - the planner's pick settles an ambiguous track; deleting a track takes
//     its miles out of the maths,
//   - a custom track (name, miles, task #) counts like an imported one and is
//     left alone by the map (no refresh, rename or recolor),
//   - the PSRc Assignment Colors push draws imported tracks dark red and puts
//     their own style back when the colors go off or the track is dropped.
//
// Run with: node test_search_log_map_tracking.js

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
const CASE = 'Tracks-1';

const checks = [];
const check = (name, fn) => checks.push({name, fn});
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`);
};

// ---------------------------------------------------------------------------
// Geometry: everything sits around 45 N 93 W. One mile is 1/69.09 degrees of
// latitude and, at this latitude, 1/(69.09 cos 45) degrees of longitude, so a
// point can be placed by its offset in miles from the origin.
// ---------------------------------------------------------------------------
const ORIGIN = {lat: 45.0, lng: -93.0};
const MILE_LAT = 1 / 69.09;
const MILE_LNG = MILE_LAT / Math.cos(ORIGIN.lat * Math.PI / 180);
const at = (eastMiles, northMiles) => [ORIGIN.lng + eastMiles * MILE_LNG, ORIGIN.lat + northMiles * MILE_LAT];
// A square of `size` miles centred `eastMiles` east of the origin (closed ring).
const square = (eastMiles, size = 1, northMiles = 0) => {
    const h = size / 2;
    return [at(eastMiles - h, northMiles - h), at(eastMiles + h, northMiles - h), at(eastMiles + h, northMiles + h), at(eastMiles - h, northMiles + h), at(eastMiles - h, northMiles - h)];
};
const polygon = (ring, holes = []) => ({type: 'Polygon', coordinates: [ring, ...holes]});
// Segment 4D is the unit square around the origin, 4C the unit square right
// next to it on the east (they share the x = 0.5 mi edge).
const SEG_4D_SHAPE = {geometry: polygon(square(0)), attributes: {id: 'seg-4d', name: '4D', class: 'Assignment', ObjectID: 1}};
const SEG_4C_SHAPE = {geometry: polygon(square(1)), attributes: {id: 'seg-4c', name: '4C', class: 'Assignment', ObjectID: 2}};
// A track walked due east: half a mile outside, the whole mile of 4D, then
// 0.4 mi into 4C.
const trackFeature = (name = 'Team 1', id = 'trk-1', cls = 'Shape') => ({
    geometry: {type: 'LineString', coordinates: [at(-1.0, 0), at(-0.5, 0), at(0.2, 0), at(0.9, 0)]},
    attributes: {id, name, title: name, class: cls, ObjectID: 3}
});

// ---------------------------------------------------------------------------
// Part 1: the shared module
// ---------------------------------------------------------------------------

check('getLineStringPaths / pathLengthMiles: lines, multi-lines, timestamped points, nothing for areas', () => {
    const line = {type: 'LineString', coordinates: [at(0, 0), at(1, 0), at(1, 1)]};
    const paths = utils.getLineStringPaths(line);
    assert.strictEqual(paths.length, 1);
    near(utils.pathLengthMiles(paths[0]), 2, 0.01, 'one mile east, one mile north');
    const multi = utils.getLineStringPaths({type: 'MultiLineString', coordinates: [[at(0, 0), at(1, 0)], [at(0, 1), at(0, 3)]]});
    assert.strictEqual(multi.length, 2);
    near(utils.pathLengthMiles(multi[1]), 2, 0.01, 'the second part');
    // [lng, lat, alt, time] points are fine; a point without numbers is skipped.
    const stamped = utils.getLineStringPaths({type: 'LineString', coordinates: [[...at(0, 0), 300, 1700000000], ['x', 'y'], [...at(1, 0), 310, 1700000060]]});
    assert.strictEqual(stamped[0].length, 2);
    assert.deepStrictEqual(utils.getLineStringPaths(polygon(square(0))), [], 'a polygon has no line paths');
    assert.deepStrictEqual(utils.getLineStringPaths({type: 'LineString', coordinates: [at(0, 0)]}), [], 'a single point is no line');
    assert.strictEqual(utils.pathLengthMiles(null), 0);
});

check('isTrackLikeFeature / getTrackTypeLabel: lines are tracks or routes, assignments and markers are not', () => {
    assert.strictEqual(utils.isTrackLikeFeature(trackFeature()), true);
    assert.strictEqual(utils.getTrackTypeLabel(trackFeature()), 'Route', 'a drawn Shape line is a route');
    assert.strictEqual(utils.getTrackTypeLabel(trackFeature('T', 't', 'AppTrack')), 'Track', 'a recorded app track');
    assert.strictEqual(utils.getTrackTypeLabel(trackFeature('T', 't', 'LiveTrack')), 'Track');
    const stamped = {geometry: {type: 'LineString', coordinates: [[...at(0, 0), 0, 1700000000], [...at(1, 0), 0, 1700000060]]}, attributes: {id: 's', name: 'S', class: 'Shape'}};
    assert.strictEqual(utils.getTrackTypeLabel(stamped), 'Track', 'timestamped points mean a recorded track');
    assert.strictEqual(utils.isTrackLikeFeature(SEG_4D_SHAPE), false, 'an assignment polygon');
    const lineAssignment = {geometry: {type: 'LineString', coordinates: [at(0, 0), at(1, 0)]}, attributes: {id: 'la', name: 'Trail', class: 'Assignment'}};
    assert.strictEqual(utils.isTrackLikeFeature(lineAssignment), false, 'a line assignment is a segment, not a searcher track');
    assert.strictEqual(utils.isTrackLikeFeature({geometry: {type: 'Point', coordinates: at(0, 0)}, attributes: {class: 'Marker'}}), false);
    assert.strictEqual(utils.isTrackLikeFeature(null), false);
});

check('pointInPolygonRings / pointInAreaGeometry: inside, outside, a hole, multi-polygons and collections', () => {
    const ring = square(0);
    assert.strictEqual(utils.pointInPolygonRings(at(0, 0), [ring]), true);
    assert.strictEqual(utils.pointInPolygonRings(at(0.49, 0.49), [ring]), true);
    assert.strictEqual(utils.pointInPolygonRings(at(0.51, 0), [ring]), false);
    assert.strictEqual(utils.pointInPolygonRings(at(0, 0.6), [ring]), false);
    // A hole in the middle takes the centre out again.
    const hole = square(0, 0.2);
    assert.strictEqual(utils.pointInPolygonRings(at(0, 0), [ring, hole]), false, 'inside the hole');
    assert.strictEqual(utils.pointInPolygonRings(at(0.3, 0), [ring, hole]), true, 'between the hole and the edge');
    // Open rings work too.
    assert.strictEqual(utils.pointInPolygonRings(at(0, 0), [ring.slice(0, 4)]), true);
    assert.strictEqual(utils.pointInAreaGeometry(at(1, 0), {type: 'MultiPolygon', coordinates: [[square(0)], [square(1)]]}), true);
    assert.strictEqual(utils.pointInAreaGeometry(at(2.2, 0), {type: 'MultiPolygon', coordinates: [[square(0)], [square(1)]]}), false);
    assert.strictEqual(utils.pointInAreaGeometry(at(1, 0), {type: 'GeometryCollection', geometries: [polygon(square(1)), {type: 'Point', coordinates: at(5, 5)}]}), true);
    assert.strictEqual(utils.pointInAreaGeometry(at(0, 0), {type: 'LineString', coordinates: [at(-1, 0), at(1, 0)]}), false, 'a line has no inside');
    assert.strictEqual(utils.pointInPolygonRings(['x', 0], [ring]), false);
    assert.deepStrictEqual(utils.collectAreaPolygons(null), []);
});

check('measurePathInsideGeometryMiles: a leg is cut at the edges it crosses and only the inside pieces count', () => {
    const shape = polygon(square(0));
    // Straight through: 2 mi long, the middle mile inside.
    near(utils.measurePathInsideGeometryMiles([at(-1, 0), at(1, 0)], shape), 1, 0.005, 'straight through the square');
    // Leaves through the north edge and comes back: 0.5 in + 0.5 out + 0.5 back in.
    near(utils.measurePathInsideGeometryMiles([at(-1, 0), at(0, 0), at(0, 1), at(0, 0)], shape), 1.5, 0.005, 'leave and re-enter');
    // Entirely inside / entirely outside / no area.
    near(utils.measurePathInsideGeometryMiles([at(-0.4, 0), at(0.4, 0)], shape), 0.8, 0.005, 'entirely inside');
    assert.strictEqual(utils.measurePathInsideGeometryMiles([at(-3, 0), at(-2, 0)], shape), 0, 'entirely outside');
    assert.strictEqual(utils.measurePathInsideGeometryMiles([at(-1, 0), at(1, 0)], {type: 'LineString', coordinates: [at(0, -1), at(0, 1)]}), 0, 'a line assignment has no inside');
    assert.strictEqual(utils.measurePathInsideGeometryMiles([at(0, 0)], shape), 0, 'a single point has no length');
    // A hole: the stretch across it is not inside.
    near(utils.measurePathInsideGeometryMiles([at(-1, 0), at(1, 0)], polygon(square(0), [square(0, 0.2)])), 0.8, 0.005, 'the 0.2 mi across the hole are left out');
    // Two squares as one geometry: both miles count.
    near(utils.measurePathInsideGeometryMiles([at(-1, 0), at(2, 0)], {type: 'MultiPolygon', coordinates: [[square(0)], [square(1)]]}), 2, 0.005, 'across two squares');
});

check('measureTrackMilesBySegment: the miles per segment, for segments with a shape only', () => {
    const rows = [
        ['R1', '4D', '640 ac', '1 mi', '100 ft', '', '', '', '', 'seg-4d'],
        ['R1', '4C', '640 ac', '1 mi', '100 ft', '', '', '', '', ''],          // matched by name
        ['R1', '4B', '640 ac', '1 mi', '100 ft', '', '', '', '', 'seg-4b'],    // no shape on the map
        ['', '', '', '', '', '', '', '', '', '']
    ];
    const features = [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature()];
    const measured = utils.measureTrackMilesBySegment(trackFeature(), rows, features);
    near(measured.totalMiles, 1.9, 0.005, 'the whole track');
    assert.strictEqual(measured.pointCount, 4);
    assert.deepStrictEqual(measured.segments.map(s => s.segment), ['4D', '4C']);
    near(measured.segments[0].miles, 1.0, 0.005, 'one mile inside 4D');
    near(measured.segments[1].miles, 0.4, 0.005, '0.4 mi inside 4C');
    assert.strictEqual(measured.segments[0].region, 'R1');
    assert.deepStrictEqual(utils.measureTrackMilesBySegment(SEG_4D_SHAPE, rows, features), {totalMiles: 0, pointCount: 0, segments: []}, 'a polygon is not a track');
    assert.deepStrictEqual(utils.measureTrackMilesBySegment(trackFeature(), rows, []).segments, [], 'no shapes fetched: nothing measured');
});

check('parseSearcherTrackName / formatSearcherTrackName: the "#task-segment " code is recognised and never stacked', () => {
    assert.deepStrictEqual(utils.parseSearcherTrackName('#2-4D Team 1', ['4D', '4C']), {taskNumber: '2', segment: '4D', baseName: 'Team 1'});
    assert.deepStrictEqual(utils.parseSearcherTrackName('#2-Seg A Team 1', ['Seg A', '4D']), {taskNumber: '2', segment: 'Seg A', baseName: 'Team 1'}, 'a segment name with a space, known from the Segments page');
    assert.deepStrictEqual(utils.parseSearcherTrackName('#12-4D', ['4D']), {taskNumber: '12', segment: '4D', baseName: ''}, 'the code alone');
    assert.deepStrictEqual(utils.parseSearcherTrackName('#3-Old  Bob', []), {taskNumber: '3', segment: 'Old', baseName: 'Bob'}, 'an unknown segment: the code runs to the first space');
    assert.deepStrictEqual(utils.parseSearcherTrackName('Team 1', ['4D']), {taskNumber: '', segment: '', baseName: 'Team 1'});
    assert.deepStrictEqual(utils.parseSearcherTrackName('#Team 1', ['4D']), {taskNumber: '', segment: '', baseName: '#Team 1'}, 'a hash without a number is not the code');
    assert.deepStrictEqual(utils.parseSearcherTrackName('#4-4DX Team', ['4D']), {taskNumber: '4', segment: '4DX', baseName: 'Team'}, '"4D" must be followed by a space to be the known segment');
    assert.strictEqual(utils.formatSearcherTrackName('#2', '4D', 'Team 1'), '#2-4D Team 1');
    assert.strictEqual(utils.formatSearcherTrackName('2', '4D', 'Team 1'), '#2-4D Team 1');
    assert.strictEqual(utils.formatSearcherTrackName('#2', '4D', ''), '#2-4D');
    assert.strictEqual(utils.formatSearcherTrackName('', '4D', 'Team 1'), 'Team 1', 'no task: the base name alone');
    assert.strictEqual(utils.formatSearcherTrackName('#2', '', 'Team 1'), 'Team 1');
    // Round trip: formatting what was parsed gives the same name, and parsing
    // a formatted name gives the base back - so a re-fetched name is not
    // prefixed a second time.
    const formatted = utils.formatSearcherTrackName('#2', 'Seg A', 'Team 1');
    assert.strictEqual(utils.parseSearcherTrackName(formatted, ['Seg A']).baseName, 'Team 1');
    assert.strictEqual(utils.formatSearcherTrackName('#5', 'Seg A', utils.parseSearcherTrackName(formatted, ['Seg A']).baseName), '#5-Seg A Team 1', 'a new task replaces the code');
});

check('normalizeSearcherTrack(s): canonical records, usable ones only, one per id', () => {
    const track = utils.normalizeSearcherTrack({id: 'trk-1', featureId: 'trk-1', baseName: ' Team 1 ', caltopoName: '#1-4D Team 1', type: 'Track', lengthMiles: '1.9', pointCount: 4.7,
        segmentMiles: [{region: 'R1', segment: '4D', miles: 1}, {segment: '4C', miles: '0.4'}, {segment: '', miles: 3}, {segment: '4B', miles: 0}, null], assignedTask: '2', importedAt: '2026-09-14T10:00:00.000Z'});
    assert.deepStrictEqual(track, {
        id: 'trk-1', featureId: 'trk-1', baseName: 'Team 1', caltopoName: '#1-4D Team 1', type: 'Track', lengthMiles: 1.9, pointCount: 4,
        segmentMiles: [{region: 'R1', segment: '4D', miles: 1}, {region: '', segment: '4C', miles: 0.4}],
        assignedTask: '#2', custom: false, importedAt: '2026-09-14T10:00:00.000Z', importedBy: '', evaluatedAt: ''
    });
    assert.strictEqual(utils.normalizeSearcherTrack({baseName: 'no id'}), null);
    assert.strictEqual(utils.normalizeSearcherTrack({id: 'x', type: 'Line'}).type, 'Route', 'an unknown type is a route');
    // A custom track: typed in, so it has nothing on the map.
    const custom = utils.normalizeSearcherTrack({id: 'c1', custom: true, featureId: 'stray', caltopoName: 'stray', baseName: 'Paper log', lengthMiles: 2, segmentMiles: [{region: 'R1', segment: '4D', miles: 2}], assignedTask: '#1'});
    assert.strictEqual(custom.type, 'Custom');
    assert.strictEqual(custom.custom, true);
    assert.strictEqual(custom.featureId, '', 'a custom track never points at a map shape');
    assert.strictEqual(custom.caltopoName, '');
    assert.strictEqual(utils.normalizeSearcherTrack({id: 'c2', type: 'Custom'}).custom, true, 'the type alone marks it custom');
    assert.strictEqual(utils.normalizeSearcherTrack({id: 'x', assignedTask: 'later'}).assignedTask, '', 'a pick must be a task number');
    assert.strictEqual(utils.normalizeSearcherTrack({id: 'x', lengthMiles: -2}).lengthMiles, 0);
    const list = utils.normalizeSearcherTracks([{id: 'a', baseName: 'first'}, 'junk', {id: 'a', baseName: 'again'}, {id: 'b'}]);
    assert.deepStrictEqual(list.map(t => `${t.id}:${t.baseName}`), ['a:first', 'b:'], 'the first record of an id wins');
    assert.deepStrictEqual(utils.normalizeSearcherTracks(null), []);
    assert.strictEqual(utils.normalizeTaskTag(' 7 '), '#7');
    assert.strictEqual(utils.normalizeTaskTag('#7'), '#7');
    assert.strictEqual(utils.normalizeTaskTag('#'), '');
});

const ROW = (task, date, time, segment, team = 'Team A (2)', sweep = '100 ft', sweeps = '2') => [task, date, time, 'R1', segment, '', '', team, sweep, sweeps];
const TRACK = (id, baseName, segmentMiles, assignedTask = '') => ({id, featureId: id, baseName, caltopoName: baseName, type: 'Route', lengthMiles: 1.9, pointCount: 4, segmentMiles, assignedTask});

check('allocateSearcherTracks: the home segment (most miles) decides the task; the rest goes to the other segment\'s latest task', () => {
    const tracks = [TRACK('t1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}])];
    const rows = [ROW('#1', '09-01-2026', '08:00', '4D'), ROW('#2', '09-01-2026', '09:00', '4C'), ROW('#4', '09-01-2026', '11:00', '4C'), ['', '', '', '', '', '', '', '', '', '']];
    const allocation = utils.allocateSearcherTracks(tracks, rows);
    assert.strictEqual(allocation.tracks.length, 1);
    const entry = allocation.tracks[0];
    assert.deepStrictEqual(entry.home, {region: 'R1', segment: '4D', miles: 1.0});
    assert.deepStrictEqual(entry.homeTasks, ['#1']);
    assert.strictEqual(entry.task, '#1');
    assert.strictEqual(entry.ambiguous, false);
    assert.strictEqual(entry.displayName, '#1-4D Team 1');
    assert.deepStrictEqual(entry.portions, [
        {region: 'R1', segment: '4D', miles: 1.0, task: '#1', home: true},
        {region: 'R1', segment: '4C', miles: 0.4, task: '#4', home: false}
    ], 'the 4C miles go to the latest task of 4C (#4), not to #2');
    assert.deepStrictEqual(plain(allocation.byTask), {
        '#1': {miles: 1.0, portions: [{trackId: 't1', region: 'R1', segment: '4D', miles: 1.0, home: true}]},
        '#4': {miles: 0.4, portions: [{trackId: 't1', region: 'R1', segment: '4C', miles: 0.4, home: false}]}
    });
    assert.deepStrictEqual(allocation.ambiguousTasks, []);
    assert.strictEqual(utils.getTaskTrackMiles(allocation, '#1'), 1.0);
    assert.strictEqual(utils.getTaskTrackMiles(allocation, '1'), 1.0);
    assert.strictEqual(utils.getTaskTrackMiles(allocation, '#2'), 0);
    assert.strictEqual(utils.getTaskTrackMiles(null, '#1'), 0);

    // Two tracks add up on the same task; a portion in a segment without a
    // task waits (no task, no miles for anyone).
    const two = utils.allocateSearcherTracks([...tracks, TRACK('t2', 'Team 2', [{region: 'R1', segment: '4D', miles: 0.7}, {region: 'R1', segment: '4B', miles: 0.2}])], rows);
    near(two.byTask['#1'].miles, 1.7, 1e-9, 'both tracks searched 4D');
    assert.strictEqual(two.tracks[1].portions[1].task, '', '4B has no task yet');
    assert.strictEqual(Object.keys(two.byTask).includes(''), false);
    // A track outside every segment has no home and no task.
    const nowhere = utils.allocateSearcherTracks([TRACK('t3', 'Lost', [])], rows).tracks[0];
    assert.strictEqual(nowhere.home, null);
    assert.strictEqual(nowhere.task, '');
    assert.strictEqual(nowhere.displayName, 'Lost');
    assert.deepStrictEqual(utils.allocateSearcherTracks(null, null), {byTask: {}, tracks: [], ambiguousTasks: []});
});

check('allocateSearcherTracks: two tasks on the home segment make the track ambiguous - the latest by date/time gets the miles until the planner picks', () => {
    const tracks = [TRACK('t1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}])];
    // #5 was logged BEFORE #3 (a backdated task): the latest is #3.
    const rows = [ROW('#5', '09-01-2026', '07:00', '4D'), ROW('#3', '09-01-2026', '10:00', '4D'), ROW('#2', '09-01-2026', '09:00', '4C')];
    const auto = utils.allocateSearcherTracks(tracks, rows);
    assert.deepStrictEqual(auto.tracks[0].homeTasks, ['#5', '#3'], 'oldest first');
    assert.strictEqual(auto.tracks[0].ambiguous, true);
    assert.strictEqual(auto.tracks[0].task, '#3', 'the latest task of 4D holds the miles for now');
    assert.strictEqual(auto.tracks[0].displayName, '#3-4D Team 1');
    assert.deepStrictEqual(auto.ambiguousTasks, ['#5', '#3'], 'both tasks get the question mark');
    assert.strictEqual(utils.getTaskTrackMiles(auto, '#3'), 1.0);
    assert.strictEqual(utils.getTaskTrackMiles(auto, '#5'), 0);
    assert.strictEqual(utils.getTaskTrackMiles(auto, '#2'), 0.4, 'the 4C spill-over is not in question');

    // The planner's pick settles it.
    const picked = utils.allocateSearcherTracks([TRACK('t1', 'Team 1', tracks[0].segmentMiles, '#5')], rows);
    assert.strictEqual(picked.tracks[0].ambiguous, false);
    assert.strictEqual(picked.tracks[0].task, '#5');
    assert.strictEqual(picked.tracks[0].displayName, '#5-4D Team 1');
    assert.deepStrictEqual(picked.ambiguousTasks, []);
    assert.strictEqual(utils.getTaskTrackMiles(picked, '#5'), 1.0);
    assert.strictEqual(utils.getTaskTrackMiles(picked, '#3'), 0);

    // A pick that is not one of the home segment's tasks (the task was deleted
    // or the home changed) is ignored: back to automatic.
    const stale = utils.allocateSearcherTracks([TRACK('t1', 'Team 1', tracks[0].segmentMiles, '#2')], rows);
    assert.strictEqual(stale.tracks[0].ambiguous, true);
    assert.strictEqual(stale.tracks[0].task, '#3');

    // Rows with the same date/time fall back to the task number; a task on
    // another region's segment of the same name is a different segment.
    const tie = utils.allocateSearcherTracks(tracks, [ROW('#9', '09-01-2026', '08:00', '4D'), ROW('#8', '09-01-2026', '08:00', '4D'), ['#7', '09-01-2026', '12:00', 'R2', '4D', '', '', 'Team Z (1)', '100 ft', '1']]);
    assert.deepStrictEqual(tie.tracks[0].homeTasks, ['#8', '#9']);
    assert.strictEqual(tie.tracks[0].task, '#9');
});

check('searchLogRowTimestamp reads the MM-DD-YYYY / HH:mm columns', () => {
    assert.strictEqual(utils.searchLogRowTimestamp(ROW('#1', '09-01-2026', '08:30', '4D')), new Date(2026, 8, 1, 8, 30).getTime());
    assert.strictEqual(utils.searchLogRowTimestamp(ROW('#1', '09-01-2026', '', '4D')), new Date(2026, 8, 1, 0, 0).getTime());
    assert.strictEqual(utils.searchLogRowTimestamp(ROW('#1', '', '', '4D')), 0);
    assert.strictEqual(utils.searchLogRowTimestamp(null), 0);
});

check('sync-delta mirrors the tracks into their own collection table and the switch into settings_page', () => {
    assert.strictEqual(syncDelta.LIST_TABLES.searcherTracks, 'searcher_tracks');
    assert.strictEqual(syncDelta.SINGLE_TABLE_KEYS.mapTrackingEnabled, 'settings_page');
    assert.deepStrictEqual(syncDelta.describeChangeTarget({path: ['searcherTracks', '0'], value: {id: 't1'}}), {kind: 'collectionRow', table: 'searcher_tracks', rowIndex: 0});
    assert.deepStrictEqual(syncDelta.describeChangeTarget({path: ['searcherTracks'], append: [{id: 't1'}]}), {kind: 'collectionRebuild', table: 'searcher_tracks'});
    assert.deepStrictEqual(syncDelta.describeChangeTarget({path: ['mapTrackingEnabled'], value: true}), {kind: 'single', table: 'settings_page'});
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

function createSandbox({store, fetch, page = 'page4'} = {}) {
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
        alert: (msg) => { logs.error.push(`alert: ${msg}`); },
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
    // CalTopo writes are recorded instead of sent.
    const posted = [];
    sandbox.caltopo_api_call = async (method, endpoint, payload, domain) => {
        posted.push({method, endpoint, payload: plain(payload), domain});
        return sandbox.__caltopoAnswer ? sandbox.__caltopoAnswer(endpoint, payload) : {result: {id: payload && payload.id}};
    };
    sandbox.__posted = posted;
    sandbox.__logs = logs;
    sandbox.__byId = byId;
    sandbox.__body = body;
    return sandbox;
}

// A sync server that accepts every row batch; every request is recorded.
function createServer() {
    const requests = [];
    const json = (body, status = 200) => ({ok: status < 400, status, headers: {get: () => 'application/json'}, json: async () => body});
    const fetch = async (url, init = {}) => {
        const text = String(url);
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({url: text, method, body});
        if (/\/api\/v1\/[^/]+\/rows/.test(text)) return json({success: true, applied: (body && body.changes || []).length, lastModified: new Date().toISOString(), state: {}});
        if (/\/api\/v1\/[^/]+\/state/.test(text)) return json({found: true, modified: false});
        return json({success: true});
    };
    return {
        fetch,
        requests,
        changes: () => requests.filter(r => /\/rows/.test(r.url) && r.method === 'POST').flatMap(r => (r.body && r.body.changes) || [])
    };
}

// The case: two regions (R1 gets 60 % of the consensus), the R1 segments 4D
// and 4C of one square mile each with their CalTopo shapes, one task on each.
const SEG = (name, caltopoId = '') => ['R1', name, '640 ac', '1 mi', '100 ft', '', '', '', '', caltopoId];
const DEFAULT_LOG = () => [ROW('#1', '09-01-2026', '08:00', '4D', 'Team A (2)', '100 ft', '2'), ROW('#2', '09-01-2026', '09:00', '4C', 'Team B (3)', '100 ft', '')];
function seedStore({searchLog, features, tracks, tracking} = {}) {
    const store = {};
    store[SETTINGS_CACHE_KEY] = JSON.stringify({'sar-sync-bucket-v1': CASE});
    const scratch = createSandbox({store, fetch: async () => { throw new Error('offline'); }});
    const bundle = scratch.defaultBundle();
    bundle.fileName = CASE;
    bundle.pages.index = {headers: ['Region', 'Voter 1', 'Consensus'], rows: [['R1', '6', ''], ['R2', '4', '']], voterVisibility: [true]};
    bundle.pages.page2 = [SEG('4D', 'seg-4d'), SEG('4C', 'seg-4c')];
    bundle.pages.page4 = searchLog || DEFAULT_LOG();
    bundle.maps = [{id: 'MAP1', name: 'Test map', domain: 'caltopo.com', features: features || [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature()]}];
    if (tracks) bundle.searcherTracks = tracks;
    if (tracking !== undefined) bundle.mapTrackingEnabled = tracking;
    store[BUNDLE_KEY] = JSON.stringify(scratch.sanitizeBundle(bundle));
    return store;
}
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };
const logRow = (app, tag) => app.loadBundle().pages.page4.find(row => row[0] === tag);
const psrc = (app) => Object.fromEntries(app.loadBundle().pages.page2.map(row => [row[1], row[7]]));
// The formula (calculateSearchCoverage): PSR after = PSR before x e^-z, with
// z = sweepWidth / ((area / 640 / length / numSweeps / numMembers) x 5280)
// classically and z = sweepWidth / ((area / 640 / trackMiles) x 5280) under
// Map Tracking (the track miles replace length x sweeps x members together).
const PSR_BEFORE = 15; // (1 mi / 2 hr x 100 ft x 0.3) / (640 ac / 640)
const classicAfter = (numSweeps, numMembers) => (PSR_BEFORE * Math.exp(-(100 / ((640 / 640 / 1 / numSweeps / numMembers) * 5280)))).toFixed(4);
const trackedAfter = (trackMiles) => (PSR_BEFORE * Math.exp(-(100 / ((640 / 640 / trackMiles) * 5280)))).toFixed(4);

// The rendered Search Log: for every row the cells by column label.
function renderedRows(app) {
    return (app.__byId['table-body'].children || []).map(tr => {
        const cells = {};
        tr.children.forEach(td => {
            const container = td.children[0];
            cells[td.dataset.label] = {td, container, pill: container ? container.children[0] : null, extras: container ? container.children.slice(1) : []};
        });
        return cells;
    });
}
const headerTexts = (app) => app.__byId['table-head'].children[0].children.map(th => th.textContent);

check('the switch and the tracks are bundle keys: defaults, sanitizer round trip, and they reach the server as rows', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore(), fetch: server.fetch});
    assert.strictEqual(app.defaultBundle().mapTrackingEnabled, false);
    assert.deepStrictEqual(plain(app.defaultBundle().searcherTracks), []);
    assert.strictEqual(app.loadBundle().mapTrackingEnabled, false, 'a seeded file starts with the switch off');

    const bundle = app.loadBundle();
    bundle.mapTrackingEnabled = true;
    bundle.searcherTracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}]), {junk: true}, TRACK('trk-1', 'dupe', [])];
    await app.saveBundle(bundle);
    await settle();
    const reloaded = createSandbox({store: seedStore(), fetch: server.fetch});
    reloaded.SAR_MEMORY_STORAGE[BUNDLE_KEY] = app.SAR_MEMORY_STORAGE[BUNDLE_KEY];
    const again = reloaded.loadBundle();
    assert.strictEqual(again.mapTrackingEnabled, true);
    assert.strictEqual(again.searcherTracks.length, 1, 'junk and the duplicate id are dropped by the sanitizer');
    assert.strictEqual(again.searcherTracks[0].baseName, 'Team 1');
    assert.strictEqual(again.searcherTracks[0].type, 'Route');
    assert.strictEqual(app.sanitizeBundle({...plain(again), mapTrackingEnabled: 'yes'}).mapTrackingEnabled, false, 'only a real true switches it on');

    const changes = server.changes();
    assert.ok(changes.some(c => c.path[0] === 'mapTrackingEnabled' && c.value === true), 'the switch travels as a settings_page change');
    assert.ok(changes.some(c => c.path[0] === 'searcherTracks'), 'the tracks travel as searcher_tracks rows');
});

check('the switch off leaves the classic formula alone; on, the task\'s track miles replace numSweeps x length x team count', () => {
    const tracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}])];
    const off = createSandbox({store: seedStore({tracks}), fetch: createServer().fetch});
    off.recalculateEverything();
    assert.strictEqual(logRow(off, '#1')[5], PSR_BEFORE.toFixed(4), 'PSR before');
    assert.strictEqual(logRow(off, '#1')[6], classicAfter(2, 2), '#1: two sweeps by two searchers');
    assert.strictEqual(logRow(off, '#2')[6], PSR_BEFORE.toFixed(4), '#2 has no sweeps count typed: nothing searched off');
    assert.strictEqual(psrc(off)['4D'], classicAfter(2, 2), 'PSRc follows');

    const on = createSandbox({store: seedStore({tracks, tracking: true}), fetch: createServer().fetch});
    on.recalculateEverything();
    assert.strictEqual(logRow(on, '#1')[5], PSR_BEFORE.toFixed(4), 'PSR before is unchanged');
    assert.strictEqual(logRow(on, '#1')[6], trackedAfter(1.0), '#1: the mile tracked in 4D instead of 2 sweeps x 1 mi x 2 searchers');
    assert.strictEqual(logRow(on, '#2')[6], trackedAfter(0.4), '#2: the 0.4 mi spill-over into 4C count although no sweeps were typed');
    assert.strictEqual(psrc(on)['4D'], trackedAfter(1.0));
    assert.strictEqual(psrc(on)['4C'], trackedAfter(0.4));
    assert.ok(parseFloat(logRow(on, '#1')[6]) > parseFloat(classicAfter(2, 2)), 'one tracked mile searches less off than two full sweeps by two searchers');
    assert.notStrictEqual(trackedAfter(1.0), (PSR_BEFORE * Math.exp(-(100 / ((640 / 640 / 1.0 / 2) * 5280)))).toFixed(4), 'the team count (2) is not in the tracked term');

    // calculatePSRAfter (the blur handler) agrees with recalculateEverything.
    assert.strictEqual(on.calculatePSRAfter(logRow(on, '#1'), on.loadBundle()), trackedAfter(1.0));
    assert.strictEqual(off.calculatePSRAfter(logRow(off, '#1'), off.loadBundle()), classicAfter(2, 2));
    assert.strictEqual(off.calculatePSRAfter(logRow(off, '#2'), off.loadBundle()), '', 'classic: no sweeps typed, no value');
    // A team cell without a member count still computes under Map Tracking.
    const noCount = logRow(on, '#1').slice();
    noCount[7] = 'Team A';
    assert.strictEqual(on.calculatePSRAfter(noCount, on.loadBundle()), trackedAfter(1.0), 'no team count needed while tracking');
    const noCountOff = logRow(off, '#1').slice();
    noCountOff[7] = 'Team A';
    assert.strictEqual(off.calculatePSRAfter(noCountOff, off.loadBundle()), '', 'classic: the team count is required');
    // The shared term itself.
    near(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 2, numMembers: 2}), 100 / (0.25 * 5280), 1e-12, 'classic z');
    near(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 0, numMembers: 2, trackMiles: 1.0}), 100 / (1.0 * 5280), 1e-12, 'tracked z ignores the sweeps count and the team count');
    near(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 0, numMembers: 0, trackMiles: 1.0}), 100 / (1.0 * 5280), 1e-12, 'tracked z without a team count');
    assert.strictEqual(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 2, numMembers: 2, trackMiles: 0}), 0, 'no track miles yet: nothing decays');
    assert.strictEqual(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 0, numMembers: 2}), 0, 'classic without sweeps: nothing decays');
    assert.strictEqual(on.calculateSearchCoverage({area: 640, length: 1, sweepWidth: 100, numSweeps: 2, numMembers: 0}), 0, 'classic without a team count: nothing decays');

    // No tracks at all with the switch on: nothing is searched off anywhere.
    const empty = createSandbox({store: seedStore({tracking: true}), fetch: createServer().fetch});
    empty.recalculateEverything();
    assert.strictEqual(logRow(empty, '#1')[6], PSR_BEFORE.toFixed(4));
    assert.strictEqual(psrc(empty)['4D'], PSR_BEFORE.toFixed(4));
});

check('the charts follow: with the switch on a task without track miles adds no POS, one with miles does', () => {
    const start = new Date(2026, 8, 1, 7, 0).getTime();
    const end = new Date(2026, 8, 1, 12, 0).getTime();
    const off = createSandbox({store: seedStore(), fetch: createServer().fetch});
    const classic = off.calculateHourlyMetrics(start, end);
    assert.ok(classic[10].totalPOS > 0, 'classic: #1 (2 sweeps) and #2 (coverage without sweeps) both add POS');

    const none = createSandbox({store: seedStore({tracking: true}), fetch: createServer().fetch});
    assert.strictEqual(none.calculateHourlyMetrics(start, end)[10].totalPOS, 0, 'tracking on, no tracks: no POS');

    const tracked = createSandbox({store: seedStore({tracking: true, tracks: [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}])]}), fetch: createServer().fetch});
    const metrics = tracked.calculateHourlyMetrics(start, end)[10];
    const expectedPod = 1 - Math.exp(-(100 / ((640 / 640 / 1.0) * 5280)));
    near(metrics.totalPOS, 0.3 * expectedPod, 1e-9, 'POS of 4D from its tracked mile (POC 0.3), no team count');
    const seg4d = metrics.segments.find(s => s.segment === '4D');
    near(seg4d.spacing, (640 / 640 / 1.0) * 5280, 1e-9, 'the spacing uses the track miles alone');
});

check('the "log sweeps" reminders are off while Map Tracking is on: nothing due, no badge, no notification', () => {
    // Both tasks are finished (no team is out); #1 has 2 sweeps typed, #2 has
    // none - so classically #2 is due.
    const off = createSandbox({store: seedStore(), fetch: createServer().fetch});
    assert.deepStrictEqual(plain(off.getLogSweepsDue().map(d => d.taskNum)), ['#2'], 'classic: the blank sweeps count of #2 is due');
    const on = createSandbox({store: seedStore({tracking: true}), fetch: createServer().fetch});
    assert.deepStrictEqual(plain(on.getLogSweepsDue()), [], 'tracking: nothing is due');
    // The Search Log nav badge and the notification list follow getLogSweepsDue.
    on.checkParChecksAndNotify(true);
    const navOn = on.__byId['nav-search-log'];
    assert.ok(!navOn.classList.contains('log-sweeps-due'), 'no badge on the nav link');
    assert.strictEqual(navOn.title, 'Search Log');
    off.checkParChecksAndNotify(true);
    const navOff = off.__byId['nav-search-log'];
    assert.ok(navOff.classList.contains('log-sweeps-due'), 'classic: the nav link carries the badge');
    assert.strictEqual(navOff.title, 'Log Sweeps');
    const listOn = walk(on.__byId['notif-list']).concat(on.__byId['notif-list'].children).map(el => el.innerHTML || '').join(' ');
    assert.ok(!/needs sweep count/.test(listOn), 'no "Log Sweeps" notification while tracking');
    const listOff = walk(off.__byId['notif-list']).concat(off.__byId['notif-list'].children).map(el => el.innerHTML || '').join(' ');
    assert.ok(/needs sweep count/.test(listOff), 'classic: the notification is there');
});

check('the Search Log renders the switch, the Tracks header, the faded sweeps pills with their mile tags and the tracks table', async () => {
    const tracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}])];
    const app = createSandbox({store: seedStore({tracks, tracking: true}), fetch: createServer().fetch});
    app.document.getElementById('map-tracking-toggle').checked = false;
    app.buildSearchLogTable();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    assert.strictEqual(app.__byId['map-tracking-toggle'].checked, true, 'the switch shows the case setting');
    assert.strictEqual(typeof app.__byId['map-tracking-toggle'].onchange, 'function', 'and is bound');
    assert.ok(/Map Tracking is on/.test(app.__byId['map-tracking-control'].title));
    assert.deepStrictEqual(headerTexts(app), ['Task #', 'Date', 'Time', 'Region', 'Segment', 'PSR Before', 'PSR After', 'Team', 'Sweep Width (ft)', 'Tracks (mi)', 'Delete'], 'the sweeps column reads Tracks');

    const rows = renderedRows(app);
    assert.strictEqual(rows.length, 2);
    const first = rows.find(r => r['Task #'].pill.textContent === '#1');
    const sweeps = first['Num of Sweeps'];
    assert.ok(sweeps.pill.classList.contains('map-tracking-faded'), 'the sweeps pill is faded');
    assert.ok(sweeps.pill.classList.contains('readonly-pill') && sweeps.pill.contentEditable !== 'true', 'and not editable while tracking');
    assert.strictEqual(sweeps.pill.textContent, '2', 'the typed value stays visible');
    assert.ok(sweeps.container.classList.contains('has-track-tag'));
    const tag = sweeps.extras.find(el => el.classList.contains('track-miles-tag'));
    assert.strictEqual(tag.textContent, '1.00 mi', 'the tag shows the miles tracked inside 4D');
    assert.ok(/Team 1: 1.00 mi in 4D/.test(tag.title), 'the tooltip names the track');
    assert.ok(!sweeps.pill.classList.contains('blank-highlight'));
    const second = rows.find(r => r['Task #'].pill.textContent === '#2');
    const spill = second['Num of Sweeps'].extras.find(el => el.classList.contains('track-miles-tag'));
    assert.strictEqual(spill.textContent, '0.40 mi', 'the 4C spill-over shows on #2');
    assert.ok(/spill-over/.test(spill.title));
    assert.ok(!second['Num of Sweeps'].pill.classList.contains('blank-highlight'), 'a blank sweeps count is not flagged while tracking');
    assert.strictEqual(first['Task #'].extras.filter(el => el.classList.contains('track-question-badge')).length, 0, 'one task per segment: nothing to ask');
    assert.strictEqual(first['PSR After'].pill.textContent, trackedAfter(1.0));

    // The Searchers Tracks table.
    const trackRows = app.__byId['searcher-tracks-body'].children;
    assert.strictEqual(trackRows.length, 1);
    const cells = trackRows[0].children.map(td => td.dataset.label);
    assert.deepStrictEqual(cells, ['Track Name', 'Type', 'Length', 'Length per Segment', 'Delete']);
    assert.strictEqual(trackRows[0].children[0].children[0].children[0].textContent, '#1-4D Team 1', 'the name carries the task/segment code');
    assert.strictEqual(trackRows[0].children[1].children[0].children[0].textContent, 'Route');
    assert.strictEqual(trackRows[0].children[2].children[0].children[0].textContent, '1.90 mi');
    const pills = trackRows[0].children[3].children[0].children.filter(el => el.classList.contains('track-portion-pill'));
    assert.deepStrictEqual(pills.map(p => p.textContent), ['#1-4D 1.00 mi', '#2-4C 0.40 mi', 'outside 0.50 mi']);
    assert.ok(pills[0].classList.contains('home') && pills[1].classList.contains('other'));
    assert.strictEqual(trackRows[0].children[3].children[0].children.some(el => el.classList.contains('track-question-badge')), false);
    assert.ok(/1 track, 1.40 mi inside segments/.test(app.__byId['searcher-tracks-status'].textContent));
    assert.ok(/Map Tracking is on/.test(app.__byId['searcher-tracks-status'].textContent));
    assert.strictEqual(typeof app.__byId['import-tracks-btn'].onclick, 'function');
    assert.strictEqual(app.__byId['refresh-tracks-btn'].disabled, false);

    // Switched off: the header, the pills and the maths go back to the sweeps.
    await app.setMapTrackingEnabled(false);
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(headerTexts(app)[9], 'Num of Sweeps');
    const offRows = renderedRows(app);
    const offFirst = offRows.find(r => r['Task #'].pill.textContent === '#1');
    assert.ok(!offFirst['Num of Sweeps'].pill.classList.contains('map-tracking-faded'));
    assert.strictEqual(offFirst['Num of Sweeps'].pill.contentEditable, 'true');
    assert.strictEqual(offFirst['Num of Sweeps'].extras.length, 0, 'no tag');
    assert.strictEqual(offFirst['PSR After'].pill.textContent, classicAfter(2, 2));
    const offSecond = offRows.find(r => r['Task #'].pill.textContent === '#2');
    assert.ok(offSecond['Num of Sweeps'].pill.classList.contains('blank-highlight'), 'the blank sweeps count is flagged again');
    assert.ok(/Map Tracking is off/.test(app.__byId['searcher-tracks-status'].textContent));
    assert.strictEqual(app.__byId['searcher-tracks-body'].children.length, 1, 'the tracks stay listed');
    assert.ok(app.loadBundle().activityLog.some(e => /Map Tracking switched off/.test(e.action)), 'the switch is logged');
    assert.strictEqual(await app.setMapTrackingEnabled(false), false, 'no change, nothing saved');
});

check('importing a fetched line stores the measured record and forwards the "#1-4D " name to CalTopo once', async () => {
    const server = createServer();
    const app = createSandbox({store: seedStore({tracking: true}), fetch: server.fetch});
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(app.__posted.length, 0, 'nothing to rename before an import');
    assert.ok(/No searcher tracks yet/.test(app.__byId['searcher-tracks-body'].innerHTML));
    assert.strictEqual(app.__byId['refresh-tracks-btn'].disabled, true);

    await app.importSearcherTracks(app.loadBundle().maps[0].features);
    await settle();
    const tracks = app.loadBundle().searcherTracks;
    assert.strictEqual(tracks.length, 1, 'only the line was imported, not the two assignment polygons');
    const track = tracks[0];
    assert.strictEqual(track.id, 'trk-1');
    assert.strictEqual(track.featureId, 'trk-1');
    assert.strictEqual(track.baseName, 'Team 1');
    assert.strictEqual(track.type, 'Route');
    near(track.lengthMiles, 1.9, 0.005, 'length');
    assert.strictEqual(track.pointCount, 4);
    assert.deepStrictEqual(plain(track.segmentMiles.map(s => s.segment)), ['4D', '4C']);
    near(track.segmentMiles[0].miles, 1.0, 0.005, 'a mile in 4D');
    near(track.segmentMiles[1].miles, 0.4, 0.005, '0.4 mi in 4C');
    assert.ok(track.importedAt && track.evaluatedAt, 'stamped');
    assert.strictEqual(track.custom, false);
    assert.ok(app.loadBundle().activityLog.some(e => /Imported 1 searcher track from the CalTopo map/.test(e.action)), 'the import is logged');
    assert.strictEqual(logRow(app, '#1')[6], trackedAfter(track.segmentMiles[0].miles), 'the PSR maths use the measured miles at once');

    // The rename: one POST for the track's Shape with the coded title and the
    // untouched geometry; the record remembers what CalTopo now has.
    assert.strictEqual(app.__posted.length, 1, `one rename (${app.__posted.map(p => p.endpoint).join(', ')})`);
    assert.strictEqual(app.__posted[0].method, 'POST');
    assert.strictEqual(app.__posted[0].endpoint, '/api/v1/map/MAP1/Shape/trk-1');
    assert.strictEqual(app.__posted[0].payload.properties.title, '#1-4D Team 1');
    assert.strictEqual(app.__posted[0].payload.properties.name, '#1-4D Team 1');
    assert.strictEqual(app.__posted[0].payload.id, 'trk-1');
    assert.strictEqual(app.__posted[0].payload.geometry.type, 'LineString');
    assert.strictEqual(app.__posted[0].payload.geometry.coordinates.length, 4, 'the line travels with the rename so CalTopo keeps it');
    assert.strictEqual(app.loadBundle().searcherTracks[0].caltopoName, '#1-4D Team 1');
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(app.__posted.length, 1, 'a redraw does not send the same rename again');

    // Fetched again with the coded title: the base name is parsed off, not
    // prefixed once more, and nothing needs renaming.
    const renamedFeature = trackFeature('#1-4D Team 1');
    await app.importSearcherTracks([renamedFeature]);
    await settle();
    assert.strictEqual(app.loadBundle().searcherTracks.length, 1, 're-importing the same line re-measures it');
    assert.strictEqual(app.loadBundle().searcherTracks[0].baseName, 'Team 1');
    assert.strictEqual(app.loadBundle().searcherTracks[0].caltopoName, '#1-4D Team 1');
    assert.strictEqual(app.__posted.length, 1, 'no second rename');
    assert.strictEqual(app.__byId['searcher-tracks-body'].children[0].children[0].children[0].children[0].textContent, '#1-4D Team 1', 'never "#1-4D #1-4D Team 1"');

    const changes = server.changes();
    assert.ok(changes.some(c => c.path[0] === 'searcherTracks'), 'the tracks went to the server');
});

check('a rename CalTopo refuses is logged, not retried on every redraw, and the record keeps the old name', async () => {
    const features = [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature(), trackFeature('Live', 'trk-2', 'AppTrack')];
    const app = createSandbox({store: seedStore({tracking: true, features}), fetch: createServer().fetch});
    app.__caltopoAnswer = () => null;
    await app.importSearcherTracks([trackFeature()]);
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => p.endpoint), ['/api/v1/map/MAP1/Shape/trk-1'], 'a Shape has no other class to fall back to: one try');
    assert.strictEqual(app.loadBundle().searcherTracks[0].caltopoName, 'Team 1', 'CalTopo still has the old name');
    assert.ok(app.__logs.warn.some(line => /did not take the name "#1-4D Team 1"/.test(line)), 'the failure is a console warning, no dialog');
    assert.deepStrictEqual(app.__logs.error, []);
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(app.__posted.length, 1, 'not retried straight away');
    // An AppTrack is posted under its own class first, then as a Shape.
    app.__posted.length = 0;
    await app.importSearcherTracks([trackFeature('Live', 'trk-2', 'AppTrack')]);
    await settle();
    assert.deepStrictEqual(app.__posted.map(p => p.endpoint), ['/api/v1/map/MAP1/AppTrack/trk-2', '/api/v1/map/MAP1/Shape/trk-2']);
    assert.strictEqual(app.loadBundle().searcherTracks.find(t => t.id === 'trk-2').type, 'Track');
});

check('two tasks on the home segment: red question marks, the latest task holds the miles, the planner\'s pick settles it and is renamed', async () => {
    const searchLog = [...DEFAULT_LOG(), ROW('#3', '09-01-2026', '10:00', '4D', 'Team C (4)', '100 ft', '1')];
    const tracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}, {region: 'R1', segment: '4C', miles: 0.4}])];
    const app = createSandbox({store: seedStore({searchLog, tracks, tracking: true}), fetch: createServer().fetch});
    app.buildSearchLogTable();
    await settle();
    const rows = renderedRows(app);
    const byTask = Object.fromEntries(rows.map(r => [r['Task #'].pill.textContent, r]));
    assert.ok(byTask['#1']['Task #'].extras.some(el => el.classList.contains('track-question-badge')), '#1 gets the question mark');
    assert.ok(byTask['#3']['Task #'].extras.some(el => el.classList.contains('track-question-badge')), 'so does #3');
    assert.ok(!byTask['#2']['Task #'].extras.some(el => el.classList.contains('track-question-badge')), '#2 (4C) is not in question');
    assert.ok(byTask['#1']['Task #'].container.classList.contains('has-track-question'));
    assert.ok(/could belong to #1 or #3/.test(byTask['#1']['Task #'].extras[0].title));
    assert.strictEqual(byTask['#3']['Num of Sweeps'].extras[0].textContent, '1.00 mi', 'the latest task of 4D holds the miles for now');
    assert.strictEqual(byTask['#1']['Num of Sweeps'].extras[0].textContent, '0.00 mi');
    assert.strictEqual(byTask['#1']['PSR After'].pill.textContent, PSR_BEFORE.toFixed(4), '#1 searches nothing off yet');
    const trackRow = app.__byId['searcher-tracks-body'].children[0];
    assert.ok(trackRow.classList.contains('track-row-ambiguous'));
    const perSegment = trackRow.children[3].children[0].children;
    assert.ok(perSegment[0].classList.contains('track-question-badge'), 'the question mark leads the per-segment pills');
    assert.strictEqual(perSegment[1].textContent, '#3-4D 1.00 mi');
    assert.ok(/1 track needs a task #/.test(app.__byId['searcher-tracks-status'].textContent));
    assert.strictEqual(app.__posted.length, 1, 'the provisional name is pushed');
    assert.strictEqual(app.__posted[0].payload.properties.title, '#3-4D Team 1');

    // The picker lists both tasks and the automatic option.
    const popup = app.showSearcherTrackTaskPicker('trk-1');
    assert.ok(popup, 'the picker opens');
    const options = walk(popup).filter(el => el.classList.contains('track-task-option'));
    assert.deepStrictEqual(options.map(o => o.dataset.task), ['#1', '#3', '']);
    assert.ok(/^#1 - 09-01-2026 08:00 Team A \(2\)$/.test(options[0].textContent), 'the task\'s date, time and team help the choice');
    assert.ok(options[2].classList.contains('active'), 'automatic is the current state');

    // Picking #1 (what the badge's option does).
    options[0].onclick();
    await settle();
    const track = app.loadBundle().searcherTracks[0];
    assert.strictEqual(track.assignedTask, '#1');
    assert.ok(app.loadBundle().activityLog.some(e => /Searcher track "Team 1" assigned to task #1/.test(e.action)));
    const picked = renderedRows(app);
    const pickedByTask = Object.fromEntries(picked.map(r => [r['Task #'].pill.textContent, r]));
    assert.strictEqual(pickedByTask['#1']['Task #'].extras.length, 0, 'no more question marks');
    assert.strictEqual(pickedByTask['#3']['Task #'].extras.length, 0);
    assert.strictEqual(pickedByTask['#1']['Num of Sweeps'].extras[0].textContent, '1.00 mi');
    assert.strictEqual(pickedByTask['#3']['Num of Sweeps'].extras[0].textContent, '0.00 mi');
    assert.strictEqual(pickedByTask['#1']['PSR After'].pill.textContent, trackedAfter(1.0));
    assert.strictEqual(app.__byId['searcher-tracks-body'].children[0].children[0].children[0].children[0].textContent, '#1-4D Team 1');
    assert.strictEqual(app.__posted.length, 2, 'the settled name replaces the provisional one on CalTopo');
    assert.strictEqual(app.__posted[1].payload.properties.title, '#1-4D Team 1');
    assert.strictEqual(await app.assignSearcherTrackTask('trk-1', '#1'), false, 'the same pick again changes nothing');

    // Back to automatic: ambiguous again.
    await app.assignSearcherTrackTask('trk-1', '');
    assert.strictEqual(app.loadBundle().searcherTracks[0].assignedTask, '');
    assert.strictEqual(app.allocateSearcherTracksForBundle(app.loadBundle()).tracks[0].ambiguous, true);
    assert.strictEqual(await app.assignSearcherTrackTask('nope', '#1'), false, 'an unknown track is ignored');
});

check('deleting a track takes its miles out of the maths; the import popup lists the map\'s lines with their status', async () => {
    const tracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}])];
    const features = [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature(), trackFeature('Team 2', 'trk-2', 'AppTrack')];
    const app = createSandbox({store: seedStore({tracks, tracking: true, features}), fetch: createServer().fetch});
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(logRow(app, '#1')[6], trackedAfter(1.0));

    const popup = app.showSearcherTracksImportPopup(app.loadBundle().maps[0].features);
    const boxes = walk(popup).filter(el => el.classList.contains('track-import-checkbox'));
    assert.strictEqual(boxes.length, 2, 'the two lines, not the assignment polygons');
    assert.deepStrictEqual(boxes.map(b => b.checked), [false, true], 'the imported one starts unticked, the new one ticked');
    const pills = walk(popup).filter(el => el.classList.contains('readonly-pill')).map(el => el.textContent);
    assert.ok(pills.includes('Imported') && pills.includes('New'));
    assert.ok(pills.includes('Team') === false && pills.some(t => /^4D 1\.00 mi, 4C 0\.40 mi$/.test(t)), 'the preview shows the segments the line entered');
    assert.ok(pills.includes('Track') && pills.includes('Route'), 'the type column tells a recorded track from a drawn route');

    await app.removeSearcherTrack('trk-1');
    await settle();
    assert.deepStrictEqual(plain(app.loadBundle().searcherTracks), []);
    assert.strictEqual(logRow(app, '#1')[6], PSR_BEFORE.toFixed(4), 'no tracks: nothing searched off');
    assert.ok(app.loadBundle().activityLog.some(e => /Deleted Searcher Track: Team 1/.test(e.action)));
    assert.ok(/No searcher tracks yet/.test(app.__byId['searcher-tracks-body'].innerHTML));
    assert.strictEqual(await app.removeSearcherTrack('trk-1'), false);
});

check('a custom track (name, miles, task #) counts toward its task like an imported one and is left alone by the map', async () => {
    const searchLog = [...DEFAULT_LOG(), ROW('#3', '09-01-2026', '10:00', '4D', 'Team C (4)', '100 ft', '1')];
    const app = createSandbox({store: seedStore({searchLog, tracking: true}), fetch: createServer().fetch});
    app.buildSearchLogTable();
    await settle();
    assert.strictEqual(typeof app.__byId['custom-track-btn'].onclick, 'function', 'the button is bound');
    assert.strictEqual(app.__byId['refresh-tracks-btn'].disabled, true);

    // The form: name, miles and the tasks newest first.
    const popup = app.showCustomTrackPopup();
    const nameInput = walk(popup).find(el => el.classList.contains('custom-track-name'));
    const milesInput = walk(popup).find(el => el.classList.contains('custom-track-miles'));
    const taskSelect = walk(popup).find(el => el.classList.contains('custom-track-task'));
    assert.ok(nameInput && milesInput && taskSelect, 'three fields');
    assert.deepStrictEqual(taskSelect.children.map(o => o.value), ['#3', '#2', '#1'], 'the tasks, newest first');
    assert.ok(/^#3 - 4D \(R1\) - 09-01-2026 10:00 Team C \(4\)$/.test(taskSelect.children[0].textContent), 'segment, region, date, time and team in the label');
    const saveBtn = walk(popup).find(el => el.classList.contains('primary'));
    assert.strictEqual(saveBtn.textContent, 'Add Track');
    // Nothing typed: the form complains and stays.
    nameInput.value = '';
    milesInput.value = '';
    taskSelect.value = '#3';
    saveBtn.onclick();
    const error = walk(popup).find(el => el.classList.contains('custom-track-error'));
    assert.ok(/a track name, a length in miles above 0/.test(error.textContent), `validation: ${error.textContent}`);
    assert.deepStrictEqual(plain(app.loadBundle().searcherTracks), [], 'nothing stored');
    // Typed in: the code in the name is parsed off, never stacked.
    nameInput.value = '#9-4C Paper log';
    milesInput.value = '1.5';
    taskSelect.value = '#1';
    saveBtn.onclick();
    await settle();
    const tracks = app.loadBundle().searcherTracks;
    assert.strictEqual(tracks.length, 1);
    const custom = tracks[0];
    assert.strictEqual(custom.type, 'Custom');
    assert.strictEqual(custom.custom, true);
    assert.strictEqual(custom.baseName, 'Paper log');
    assert.strictEqual(custom.featureId, '');
    assert.strictEqual(custom.lengthMiles, 1.5);
    assert.deepStrictEqual(plain(custom.segmentMiles), [{region: 'R1', segment: '4D', miles: 1.5}], 'every mile in the task\'s segment');
    assert.strictEqual(custom.assignedTask, '#1');
    assert.ok(/^custom-/.test(custom.id));
    assert.ok(app.loadBundle().activityLog.some(e => /Custom track "Paper log" added: 1.50 mi in 4D for task #1/.test(e.action)), 'logged');

    // Allocation: the pick wins although 4D carries #1 and #3 - no question mark.
    const allocation = app.allocateSearcherTracksForBundle(app.loadBundle());
    assert.strictEqual(allocation.tracks[0].task, '#1');
    assert.strictEqual(allocation.tracks[0].ambiguous, false);
    assert.strictEqual(allocation.tracks[0].displayName, '#1-4D Paper log');
    assert.deepStrictEqual(plain(allocation.ambiguousTasks), []);
    assert.strictEqual(app.getTaskTrackMiles(allocation, '#1'), 1.5);
    assert.strictEqual(logRow(app, '#1')[6], trackedAfter(1.5), 'the PSR maths use the custom miles');
    assert.strictEqual(logRow(app, '#3')[5], trackedAfter(1.5), '#3 (later, same segment) starts from what #1 left');
    assert.strictEqual(logRow(app, '#3')[6], logRow(app, '#3')[5], '#3 itself gets nothing from the custom track');

    // The table row: type Custom, no "outside" pill, no map lookups.
    const trackRow = app.__byId['searcher-tracks-body'].children[0];
    assert.strictEqual(trackRow.children[0].children[0].children[0].textContent, '#1-4D Paper log');
    assert.strictEqual(trackRow.children[1].children[0].children[0].textContent, 'Custom');
    assert.strictEqual(trackRow.children[2].children[0].children[0].textContent, '1.50 mi');
    const pills = trackRow.children[3].children[0].children.filter(el => el.classList.contains('track-portion-pill'));
    assert.deepStrictEqual(pills.map(p => p.textContent), ['#1-4D 1.50 mi']);
    assert.ok(/Custom track \(typed in, no shape on the map\)/.test(trackRow.children[0].children[0].children[0].title));
    assert.strictEqual(app.__posted.length, 0, 'no rename goes to CalTopo for a custom track');
    assert.strictEqual(app.__byId['refresh-tracks-btn'].disabled, true, 'nothing on the map to re-measure');
    assert.strictEqual(await app.refreshSearcherTracks(), false, 'refresh has nothing to do');
    assert.strictEqual(app.findFeatureForSearcherTrack(custom, [trackFeature('Paper log', 'trk-9')]), null, 'a like-named shape on the map is not the custom track');
    assert.strictEqual(app.findSearcherTrackForFeature(trackFeature('Paper log', 'trk-9'), tracks), null, 'nor is the custom track that shape');
    const rendered = renderedRows(app);
    const first = rendered.find(r => r['Task #'].pill.textContent === '#1');
    assert.strictEqual(first['Num of Sweeps'].extras[0].textContent, '1.50 mi', 'the tag on the task row');

    // Direct API guards.
    assert.strictEqual(await app.addCustomSearcherTrack({name: 'x', miles: 0, taskTag: '#1'}), false, 'zero miles');
    assert.strictEqual(await app.addCustomSearcherTrack({name: 'x', miles: 1, taskTag: '#77'}), false, 'an unknown task');
    assert.strictEqual(app.loadBundle().searcherTracks.length, 1);
    await app.addCustomSearcherTrack({name: '', miles: '0.25', taskTag: '2'});
    const second = app.loadBundle().searcherTracks[1];
    assert.strictEqual(second.baseName, 'Custom track #2', 'a blank name gets a default');
    assert.deepStrictEqual(plain(second.segmentMiles), [{region: 'R1', segment: '4C', miles: 0.25}]);
    assert.strictEqual(logRow(app, '#2')[6], trackedAfter(0.25));
    // Deleting it takes the miles away again.
    await app.removeSearcherTrack(second.id);
    assert.strictEqual(logRow(app, '#2')[6], PSR_BEFORE.toFixed(4));
    // No tasks at all: the form says so and cannot be submitted.
    const empty = createSandbox({store: seedStore({searchLog: [['', '', '', '', '', '', '', '', '', '']], tracking: true}), fetch: createServer().fetch});
    const emptyPopup = empty.showCustomTrackPopup();
    const emptySave = walk(emptyPopup).find(el => el.classList.contains('primary'));
    assert.strictEqual(emptySave.disabled, true);
    assert.ok(walk(emptyPopup).some(el => /No task has been assigned yet/.test(el.textContent)));
});

check('PSRc Assignment Colors: an imported track is pushed to CalTopo in dark red, its own style put back when the colors go off or it is dropped', async () => {
    const features = [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature(), trackFeature('Team 2', 'trk-2', 'AppTrack')];
    const app = createSandbox({store: seedStore({tracking: true, features}), fetch: createServer().fetch});
    // Only "Team 1" is imported; "Team 2" stays a plain shape on the map.
    await app.importSearcherTracks([app.loadBundle().maps[0].features[2]]);
    await settle();
    app.__posted.length = 0;

    const result = await app.updateCalTopoAssignmentOverlay(true);
    const trackPosts = app.__posted.filter(p => /\/trk-/.test(p.endpoint));
    assert.strictEqual(trackPosts.length, 1, `one track colored (${app.__posted.map(p => p.endpoint).join(', ')})`);
    assert.strictEqual(trackPosts[0].endpoint, '/api/v1/map/MAP1/Shape/trk-1', 'the imported track, not Team 2');
    assert.strictEqual(trackPosts[0].payload.properties.stroke, '#8b0000', 'dark red');
    assert.strictEqual(trackPosts[0].payload.properties.color, '#8b0000');
    assert.strictEqual(trackPosts[0].payload.properties['stroke-opacity'], 1);
    assert.strictEqual(trackPosts[0].payload.properties.title, '#1-4D Team 1', 'the coded name travels along (the rename updated the case\'s copy of the shape, so the color push cannot rename it back)');
    assert.strictEqual(trackPosts[0].payload.properties.name, '#1-4D Team 1');
    assert.strictEqual(app.loadBundle().maps[0].features[2].attributes.name, '#1-4D Team 1', 'the shape in the case carries the new name');
    assert.strictEqual(trackPosts[0].payload.geometry.coordinates.length, 4, 'and so does the line itself');
    assert.ok(!Object.prototype.hasOwnProperty.call(trackPosts[0].payload.properties, 'fill'), 'a line gets no fill');
    assert.ok(result.updatedCount >= 1);
    const state = app.loadBundle().maps[0].caltopoAssignmentOverlayState;
    assert.deepStrictEqual(plain(state.originals['trk-1']), {color: null, stroke: null, fill: null, 'fill-opacity': null, opacity: null, 'stroke-opacity': null, 'stroke-width': null}, 'its own (unstyled) look is remembered');
    assert.strictEqual(app.loadBundle().maps[0].features[2].attributes.stroke, '#8b0000', 'the case\'s copy of the shape follows');

    // A second push with nothing changed sends the same color again but does
    // not touch the case.
    const savedBefore = app.SAR_MEMORY_STORAGE[BUNDLE_KEY];
    app.__posted.length = 0;
    const again = await app.updateCalTopoAssignmentOverlay(true);
    assert.strictEqual(again.changed, false, 'nothing changed locally');
    assert.strictEqual(app.SAR_MEMORY_STORAGE[BUNDLE_KEY], savedBefore, 'the case was not saved again');
    assert.strictEqual(app.__posted.filter(p => /\/trk-1/.test(p.endpoint)).length, 1, 're-asserted');

    // Dropped from the table: the next push puts its own style back.
    await app.removeSearcherTrack('trk-1');
    await settle();
    app.__posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(true);
    const restore = app.__posted.find(p => /\/trk-1/.test(p.endpoint));
    assert.ok(restore, 'the track is posted once more');
    assert.ok(!Object.prototype.hasOwnProperty.call(restore.payload.properties, 'stroke'), 'without the red');
    assert.strictEqual(app.loadBundle().maps[0].caltopoAssignmentOverlayState.originals['trk-1'], undefined, 'nothing left to put back');
    assert.strictEqual(app.loadBundle().maps[0].features[2].attributes.stroke, undefined);

    // Colors off: every colored track goes back too, and a custom track is
    // never touched (it has no shape).
    await app.importSearcherTracks([app.loadBundle().maps[0].features[2]]);
    await app.addCustomSearcherTrack({name: 'Paper', miles: 1, taskTag: '#1'});
    await settle();
    await app.updateCalTopoAssignmentOverlay(true);
    assert.strictEqual(app.loadBundle().maps[0].features[2].attributes.stroke, '#8b0000');
    app.__posted.length = 0;
    await app.updateCalTopoAssignmentOverlay(false);
    const off = app.__posted.find(p => /\/trk-1/.test(p.endpoint));
    assert.ok(off && !Object.prototype.hasOwnProperty.call(off.payload.properties, 'stroke'), 'restored when the colors go off');
    assert.strictEqual(app.loadBundle().maps[0].caltopoAssignmentOverlayState, undefined);
    assert.ok(app.__posted.every(p => !/custom-/.test(p.endpoint)), 'the custom track never reaches CalTopo');
});

check('Maps page: an imported track is accounted for; routes go to the Searchers Tracks table, assignments to Segments, the rest nowhere', async () => {
    // A new assignment, a route, a marker and a plain polygon on the map.
    const newAssignment = {geometry: polygon(square(3)), attributes: {id: 'seg-4b', name: '4B', class: 'Assignment', ObjectID: 5}};
    const marker = {geometry: {type: 'Point', coordinates: at(0, 0)}, attributes: {id: 'mk-1', name: 'IPP', class: 'Marker', ObjectID: 6}};
    const plainShape = {geometry: polygon(square(5)), attributes: {id: 'sh-1', name: 'Hazard', class: 'Shape', ObjectID: 7}};
    const features = [SEG_4D_SHAPE, SEG_4C_SHAPE, trackFeature(), trackFeature('Team 2', 'trk-2', 'AppTrack'), newAssignment, marker, plainShape];
    const tracks = [TRACK('trk-1', 'Team 1', [{region: 'R1', segment: '4D', miles: 1.0}])];
    const app = createSandbox({store: seedStore({features, tracks, tracking: true}), fetch: createServer().fetch, page: 'page10'});
    assert.strictEqual(utils.getFeatureImportTarget(trackFeature()), 'track');
    assert.strictEqual(utils.getFeatureImportTarget(newAssignment), 'segment');
    assert.strictEqual(utils.getFeatureImportTarget(marker), '');
    assert.strictEqual(utils.getFeatureImportTarget(plainShape), '', 'a plain polygon is not an assignment');
    assert.strictEqual(utils.isFeatureImportedAsTrack(trackFeature(), tracks), true, 'by CalTopo id');
    assert.strictEqual(utils.isFeatureImportedAsTrack(trackFeature('Team 1', 'other-id'), tracks), false, 'another id with the same name is another line');
    assert.strictEqual(utils.isFeatureImportedAsTrack(trackFeature('Team 1', 'gfx-9'), [{id: 'x', baseName: 'Team 1', caltopoName: 'Team 1', segmentMiles: []}]), true, 'a shape without a real id matches the name it was imported under');
    assert.strictEqual(utils.isFeatureImportedAsTrack(trackFeature('Paper', 'trk-9'), [{id: 'c', custom: true, baseName: 'Paper', segmentMiles: []}]), false, 'a custom track is no shape');
    assert.strictEqual(utils.isFeatureAccountedFor(trackFeature(), [], tracks), true);
    assert.strictEqual(utils.isFeatureAccountedFor(trackFeature(), []), false, 'without the tracks it is not');

    // The unaccounted list: the imported track and the two segments are
    // accounted for; Team 2, 4B, IPP and Hazard are not.
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures().map(app.getMapFeatureDisplayName)), ['4B', 'Hazard', 'IPP', 'Team 2']);
    assert.strictEqual(app.isMapFeatureAccountedFor(trackFeature(), app.loadBundle()), true);
    assert.strictEqual(app.isMapFeatureImportedAsTrack(trackFeature('Team 2', 'trk-2', 'AppTrack'), app.loadBundle()), false);

    // The panel: one table per destination, each with its own columns.
    const main = makeElement();
    app.document.querySelector = (selector) => (selector === 'main' ? main : null);
    app.buildMapsPage();
    await settle();
    assert.deepStrictEqual(app.__logs.error, [], `no errors while rendering: ${app.__logs.error.join(' | ')}`);
    assert.ok(/id="unaccounted-tracks-body"/.test(main.innerHTML) && /id="unaccounted-other-body"/.test(main.innerHTML), 'the routes and the other-shapes tables are part of the page');
    assert.ok(/Track Name<\/th>[\s\S]*Length per Segment<\/th>/.test(main.innerHTML), 'the routes table carries the Searchers Tracks columns');
    assert.ok(/Segment<\/th>[\s\S]*Area \(acres\)<\/th>[\s\S]*Time per Sweep \(hr\)<\/th>/.test(main.innerHTML), 'the assignments table keeps the Segments columns');
    assert.strictEqual(app.__byId['unaccounted-features-count'].textContent, '4');
    const assignmentRows = app.__byId['unaccounted-features-body'].children;
    assert.strictEqual(assignmentRows.length, 1, 'only the assignment is in the segments table');
    assert.strictEqual(assignmentRows[0].dataset.importTarget, 'segment');
    assert.strictEqual(assignmentRows[0].children[1].children[0].textContent, '4B');
    assert.strictEqual(assignmentRows[0].children[2].children[0].textContent, 'Assignment');
    const trackRows = app.__byId['unaccounted-tracks-body'].children;
    assert.strictEqual(trackRows.length, 1, 'only the route is in the tracks table');
    assert.strictEqual(trackRows[0].dataset.importTarget, 'track');
    assert.strictEqual(trackRows[0].children[1].children[0].textContent, '#1-4D Team 2', 'named as the import would name it (its home segment 4D has task #1)');
    assert.strictEqual(trackRows[0].children[2].children[0].textContent, 'Track');
    assert.strictEqual(trackRows[0].children[3].children[0].textContent, '1.90 mi');
    const portionPills = trackRows[0].children[4].children[0].children.filter(el => el.classList.contains('track-portion-pill'));
    assert.deepStrictEqual(portionPills.map(p => p.textContent), ['#1-4D 1.00 mi', '#2-4C 0.40 mi', 'outside 0.50 mi'], 'the miles per segment, as pills');
    assert.strictEqual(trackRows[0].children[5].children[0].textContent, 'trk-2');
    const otherRows = app.__byId['unaccounted-other-body'].children;
    assert.deepStrictEqual(otherRows.map(tr => tr.children[0].children[0].textContent), ['Hazard', 'IPP'], 'the marker and the plain shape cannot be imported');
    assert.ok(otherRows.every(tr => tr.children.length === 3), 'no checkbox for them');
    assert.strictEqual(app.__byId['unaccounted-tracks-wrap'].style.display, '', 'the routes table is shown');
    assert.strictEqual(app.__byId['unaccounted-other-wrap'].style.display, '');

    // Import Selected: the route becomes a searcher track, the assignment a
    // segment; the unchecked marker and shape are marked unwanted.
    app.getUnaccountedSelection().add(app.getMapFeatureIdentityKey(newAssignment));
    app.getUnaccountedSelection().add(app.getMapFeatureIdentityKey(features[3]));
    app.importSelectedUnaccountedFeatures();
    await settle();
    assert.deepStrictEqual(plain(app.loadBundle().pages.page2.map(r => r[1])), ['4D', '4C', '4B'], 'the assignment joined the Segments page');
    assert.ok(!app.loadBundle().pages.page2.some(r => r[1] === 'Team 2'), 'the route did not');
    const imported = app.loadBundle().searcherTracks.find(t => t.id === 'trk-2');
    assert.ok(imported, 'the route joined the Searchers Tracks table');
    assert.strictEqual(imported.type, 'Track');
    near(imported.lengthMiles, 1.9, 0.005, 'measured on import');
    assert.deepStrictEqual(plain(app.loadBundle().unwantedMapFeatures.map(e => e.name)).sort(), ['hazard', 'ipp'], 'the unchecked shapes are unwanted');
    assert.deepStrictEqual(plain(app.getUnaccountedMapFeatures()), [], 'nothing is left');
    assert.ok(app.loadBundle().activityLog.some(e => /Imported 1 searcher track from the CalTopo map/.test(e.action)));
    assert.ok(/Every shape on the map is imported/.test(app.__byId['unaccounted-features-body'].innerHTML));
    assert.strictEqual(app.__byId['unaccounted-tracks-wrap'].style.display, 'none', 'the routes table is hidden again');

    // The Fetch Shapes popup renders (both lines are "Imported" now); the
    // Features tab offers the right action per type.
    app.showCalTopoShapesPopup(features);
    await settle();
    app.renderFeaturesList();
    assert.deepStrictEqual(app.__logs.error, []);
    const labels = app.__byId['features-list-body'].children.map(tr => {
        const m = tr.innerHTML.match(/class="mini-pill import-feat"[^>]*>([^<]+)<\/button>/);
        return m ? m[1] : '';
    });
    assert.deepStrictEqual(labels, ['Reimport', 'Reimport', 'Reimport', 'Not importable', 'Not importable', 'Re-measure track', 'Re-measure track'], 'per type (A-Z: 4B, 4C, 4D, Hazard, IPP, Team 1, Team 2): assignments reimport, lines re-measure, the rest cannot be imported');
});

check('the static wiring: the page markup carries the switch and the tracks card, the stylesheet the fade and the tags', () => {
    const page = fs.readFileSync(path.join(__dirname, 'page4.html'), 'utf8');
    const toolsRow = page.slice(page.indexOf('<div class="table-tools">'), page.indexOf('<table class="grid-table" aria-label="Search Log table">'));
    assert.ok(/id="sort-toggle"/.test(toolsRow) && /id="map-tracking-toggle"/.test(toolsRow), 'both switches sit in the same tools row');
    assert.ok(toolsRow.indexOf('id="sort-toggle"') < toolsRow.indexOf('class="tool-actions"') && toolsRow.indexOf('class="tool-actions"') < toolsRow.indexOf('id="map-tracking-toggle"'), 'Map Tracking is in the right-hand tool-actions');
    assert.ok(/id="map-tracking-label">Map Tracking</.test(toolsRow), 'it says "Map Tracking"');
    assert.ok(/id="searcher-tracks-card"/.test(page) && /id="searcher-tracks-body"/.test(page) && /id="import-tracks-btn"/.test(page) && /id="refresh-tracks-btn"/.test(page));
    assert.ok(/id="custom-track-btn"[^>]*>Custom Track</.test(page), 'the Custom Track button');
    assert.ok(page.indexOf('id="custom-track-btn"') > page.indexOf('id="searcher-tracks-card"'), 'in the Searchers Tracks card');
    assert.ok(page.indexOf('id="searcher-tracks-card"') > page.indexOf('id="table-body"'), 'the tracks card comes after the Search Log table');
    assert.deepStrictEqual(page.match(/<th class="fixed-header">([^<]+)<\/th>/g).map(th => th.replace(/<[^>]+>/g, '')), ['Track Name', 'Type', 'Length', 'Length per Segment', 'Delete']);

    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    const rule = (selector) => {
        const start = css.indexOf(`${selector} {`);
        assert.ok(start !== -1, `${selector} is styled`);
        return css.slice(start, css.indexOf('}', start));
    };
    assert.ok(/opacity:\s*0\.35/.test(rule('.pill-cell.map-tracking-faded')), 'the sweeps pill fades');
    assert.ok(/position:\s*absolute/.test(rule('.track-miles-tag')) && /var\(--accent\)/.test(rule('.track-miles-tag')));
    assert.ok(/#e03131/.test(rule('.track-question-badge')), 'the question mark is red');
    assert.ok(/overflow:\s*visible/.test(rule('.pill-cell-container.has-track-tag')));
    rule('.track-portion-pill.home');
    rule('.track-portion-pill.unassigned');
    rule('.searcher-tracks-header');
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
        console.log(`\nSearch Log Map Tracking: ${failed} of ${checks.length} checks failed.`);
        process.exit(1);
    }
    console.log(`\nSearch Log Map Tracking: PASS (${checks.length} checks)`);
})();

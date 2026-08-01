// Unit test for the structured-table decomposition in sync-server.js.
// Verifies that a saved bundle is split into per-item rows tagged with the
// team username's CASE #, and that non-bundle payloads are ignored.
//
// Run with: node test_structured_tables.js

const assert = require('assert');
const {buildStructuredPlan, COLLECTION_TABLES, SINGLE_TABLES} = require('./sync-server');

let passed = 0;
const check = (name, fn) => {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
};

// A representative bundle similar to what the website saves.
const sampleBundle = {
    fileName: 'Case-2026#7 (Alpha)',
    theme: 'dark',
    showTips: true,
    background: 'assets/us-night.jpg',
    parCheckFrequency: 20,
    activityLog: [
        {type: 'New Search File', message: 'created', ts: 1},
        {type: 'Edit', message: 'changed region', ts: 2}
    ],
    forms: {
        form_104: {a: 1},
        form_204: {b: 2}
    },
    uploads: [
        {name: 'map.pdf', size: 1234},
        {name: 'clue.jpg', size: 5678}
    ],
    maps: [
        {id: 'ABCD', name: 'Primary Map'}
    ],
    profile: {incidentNumber: 'INC-1', lostPersonName: 'John Doe'},
    accounts: [{username: 'Super Admin', pin: '1976'}],
    pages: {
        index: {
            headers: ['Region', 'Voter 1', 'Consensus'],
            rows: [
                ['North Ridge', '0.4', '0.4'],
                ['South Valley', '0.6', '0.6']
            ],
            voterVisibility: [true]
        },
        page2: [
            ['Seg A', '', '', '', '', '', '', '', '', ''],
            ['Seg B', '', '', '', '', '', '', '', '', ''],
            ['Seg C', '', '', '', '', '', '', '', '', '']
        ],
        page3: [
            ['Alice', 'K9', 'on-scene'],
            ['Bob', 'Ground', 'off-scene']
        ],
        page4: [
            ['08:00', 'briefing']
        ]
    }
};

console.log('buildStructuredPlan');

check('derives CASE # from bundle.fileName (exact, symbols allowed)', () => {
    const plan = buildStructuredPlan(sampleBundle, 'bundle');
    assert.strictEqual(plan.searchCase, 'Case-2026#7 (Alpha)');
});

check('falls back to the store key when fileName is missing', () => {
    const noName = {...sampleBundle};
    delete noName.fileName;
    const plan = buildStructuredPlan(noName, 'my-fallback-case');
    assert.strictEqual(plan.searchCase, 'my-fallback-case');
});

check('regions: one row per regions-page row, labeled by region name', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.regions.length, 2);
    assert.strictEqual(plan.collections.regions[0].label, 'North Ridge');
    assert.strictEqual(plan.collections.regions[0].row_index, 0);
    assert.deepStrictEqual(plan.collections.regions[1].data, ['South Valley', '0.6', '0.6']);
});

check('segments: one row per segment row', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.segments.length, 3);
    assert.strictEqual(plan.collections.segments[2].label, 'Seg C');
});

check('personnel: one row per person', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.personnel.length, 2);
    assert.strictEqual(plan.collections.personnel[0].label, 'Alice');
});

check('search_log: one row per log row', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.search_log.length, 1);
});

check('forms: one row per form entry, labeled by form key', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    const labels = plan.collections.forms.map(r => r.label).sort();
    assert.deepStrictEqual(labels, ['form_104', 'form_204']);
});

check('uploaded_files: one row per upload', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.uploaded_files.length, 2);
    assert.strictEqual(plan.collections.uploaded_files[0].label, 'map.pdf');
});

check('maps_settings: one row per map', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.maps_settings.length, 1);
    assert.strictEqual(plan.collections.maps_settings[0].label, 'Primary Map');
});

check('activity_log: one row per entry', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.collections.activity_log.length, 2);
});

check('profile: single record captured', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.singles.profile.incidentNumber, 'INC-1');
});

check('settings_page: single record captures settings', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    assert.strictEqual(plan.singles.settings_page.theme, 'dark');
    assert.strictEqual(plan.singles.settings_page.parCheckFrequency, 20);
});

check('all declared tables are represented in the plan', () => {
    const plan = buildStructuredPlan(sampleBundle, 'x');
    COLLECTION_TABLES.forEach(t => assert.ok(t in plan.collections, `missing collection ${t}`));
    SINGLE_TABLES.forEach(t => assert.ok(t in plan.singles, `missing single ${t}`));
});

check('non-bundle payloads (no pages) are ignored', () => {
    assert.strictEqual(buildStructuredPlan({'Case A': {lastModified: 1}}, 'all-files'), null);
    assert.strictEqual(buildStructuredPlan({deviceId: 'd1'}, 'user-1976'), null);
    assert.strictEqual(buildStructuredPlan(null, 'x'), null);
});

check('empty collections produce empty arrays, not errors', () => {
    const plan = buildStructuredPlan({fileName: 'Empty', pages: {}}, 'x');
    assert.strictEqual(plan.collections.regions.length, 0);
    assert.strictEqual(plan.collections.segments.length, 0);
});

console.log(`\nAll ${passed} assertions passed.`);

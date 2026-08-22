const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunctionSource(source, signaturePrefix) {
    const start = source.indexOf(signaturePrefix);
    if (start === -1) {
        throw new Error(`Could not find function signature: ${signaturePrefix}`);
    }

    const openBrace = source.indexOf('{', start);
    if (openBrace === -1) {
        throw new Error(`Could not find opening brace for: ${signaturePrefix}`);
    }

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not find closing brace for: ${signaturePrefix}`);
}

console.log('--- Testing CalTopo overlay opacity resolution ---');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const settingsSrc = extractFunctionSource(appSource, 'function getSegmentDisplaySettings(bundle)');
const opacitySrc = extractFunctionSource(appSource, 'function resolveDisplayedSegmentOpacity(isActiveSearch, settings, baseOpacity = 0.2)');
const overlayStyleSrc = extractFunctionSource(appSource, 'function buildCalTopoOverlayStyle(overlayColor, isActiveSearch, segmentDisplaySettings)');

const sandbox = {
    console,
    // Force the built-in app.js fallbacks (no external map-segment-utils overrides).
    getMapSegmentUtils: () => ({})
};

vm.createContext(sandbox);
vm.runInContext(`${settingsSrc}\n${opacitySrc}\n${overlayStyleSrc}`, sandbox);

// The user's configured active-search opacity must be honored.
const settings = sandbox.getSegmentDisplaySettings({
    segmentActiveSearchOpacityPercent: 30,
    segmentColorScaleLowColor: '#123456',
    segmentColorScaleMidColor: '#654321',
    segmentColorScaleHighColor: '#abcdef',
    segmentColorScaleUsePsriMax: true
});

assert.strictEqual(settings.activeSearchOpacity, 0.3, 'activeSearchOpacity should reflect the 30% setting');
assert.strictEqual(settings.lowColor, '#123456', 'lowColor should reflect the gradient setting');
assert.strictEqual(settings.midColor, '#654321', 'midColor should reflect the gradient setting');
assert.strictEqual(settings.highColor, '#abcdef', 'highColor should reflect the gradient setting');
assert.strictEqual(settings.usePsriMax, true, 'usePsriMax should reflect the setting');

// Non active-search segments keep the requested base opacity (mirrors the app map display).
assert.strictEqual(
    sandbox.resolveDisplayedSegmentOpacity(false, settings, 0.42),
    0.42,
    'Non active-search fill opacity should equal the overlay base (0.42)'
);
assert.strictEqual(
    sandbox.resolveDisplayedSegmentOpacity(false, settings, 1),
    1,
    'Non active-search stroke opacity should equal the overlay base (1)'
);

// Active-search segments RESET to the configured opacity absolutely, ignoring the
// segment's base opacity.
assert.strictEqual(
    sandbox.resolveDisplayedSegmentOpacity(true, settings, 0.42),
    0.3,
    'Active-search fill opacity must be the absolute configured value (0.3)'
);
assert.strictEqual(
    sandbox.resolveDisplayedSegmentOpacity(true, settings, 1),
    0.3,
    'Active-search stroke opacity must be the absolute configured value (0.3)'
);

// A raw bundle (not yet normalized) must also resolve to the absolute configured value.
assert.strictEqual(
    sandbox.resolveDisplayedSegmentOpacity(true, { segmentActiveSearchOpacityPercent: 80 }, 0.42),
    0.8,
    'Raw bundle active-search opacity should be normalized and used as an absolute value'
);

console.log('  ok - overlay opacity honors gradient-scale + active-search opacity settings');

// --- CalTopo overlay style: border stays CONSTANT, only the fill reacts ---
const overlaySettings = sandbox.getSegmentDisplaySettings({ segmentActiveSearchOpacityPercent: 30 });

// Non active-search: fill uses the overlay base opacity; the border is fully opaque.
const restingStyle = sandbox.buildCalTopoOverlayStyle('#123456', false, overlaySettings);
assert.strictEqual(restingStyle.stroke, '#123456', 'Overlay stroke uses the PSRc color');
assert.strictEqual(restingStyle.fill, '#123456', 'Overlay fill uses the PSRc color');
assert.strictEqual(restingStyle['fill-opacity'], 0.42, 'Resting fill opacity equals the overlay base (0.42)');
assert.strictEqual(restingStyle['stroke-opacity'], 1, 'Resting border opacity is constant (1)');
assert.strictEqual(restingStyle.opacity, 1, 'Resting overall/border opacity is constant (1)');

// Active-search: ONLY the fill opacity changes; the border opacity must stay constant.
const activeStyle = sandbox.buildCalTopoOverlayStyle('#123456', true, overlaySettings);
assert.strictEqual(activeStyle['fill-opacity'], 0.3, 'Active fill opacity reflects the 30% active-search setting');
assert.strictEqual(activeStyle['stroke-opacity'], restingStyle['stroke-opacity'], 'Border (stroke) opacity must NOT change when actively searched');
assert.strictEqual(activeStyle.opacity, restingStyle.opacity, 'Overall/border opacity must NOT change when actively searched');
assert.notStrictEqual(activeStyle['fill-opacity'], restingStyle['fill-opacity'], 'Fill opacity MUST change when actively searched');
console.log('  ok - overlay keeps the border opacity constant while the fill reacts to active-search');

console.log('All CalTopo overlay opacity checks passed.');

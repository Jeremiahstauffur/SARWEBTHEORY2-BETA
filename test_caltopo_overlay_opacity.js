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
const sources = [
    'function getSegmentDisplaySettings(bundle)',
    'function normalizeSegmentDisplaySettingsInput(settings)',
    'function resolveDisplayedSegmentOpacity(isActiveSearch, settings, baseOpacity = 0.2)',
    'function resolveDisplayedSegmentBorderOpacity(isActiveSearch, settings, baseOpacity = 1)',
    'function resolveDisplayedSegmentFillColor(isActiveSearch, settings, baseColor)',
    'function resolveDisplayedSegmentBorderColor(isActiveSearch, settings, baseColor)',
    'function resolveDisplayedSegmentBorderWidth(isActiveSearch, settings, baseWidth)',
    'function resolveDisplayedSegmentRgb(isActiveSearch, settings, baseRgb, kind)',
    'function buildCalTopoOverlayStyle(overlayColor, isActiveSearch, segmentDisplaySettings)'
].map(signature => extractFunctionSource(appSource, signature));

const sandbox = {
    console,
    // Force the built-in app.js fallbacks (no external map-segment-utils overrides).
    getMapSegmentUtils: () => ({})
};

vm.createContext(sandbox);
vm.runInContext(sources.join('\n'), sandbox);

// Arrays built inside the vm context have the sandbox's Array prototype, so copy them
// into this realm before comparing them with deepStrictEqual.
const toRgb = value => Array.prototype.slice.call(value);

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

// --- Defaults for actively-searched segments: 10% blue fill, 100% blue border ---
const defaults = sandbox.getSegmentDisplaySettings({});
assert.strictEqual(defaults.activeSearchOpacityPercent, 10, 'Default active-search fill opacity is 10%');
assert.strictEqual(defaults.activeSearchOpacity, 0.1, 'Default active-search fill opacity resolves to 0.1');
assert.strictEqual(defaults.activeSearchFillColor, '#228be6', 'Default active-search fill color is blue');
assert.strictEqual(defaults.activeSearchBorderOpacityPercent, 100, 'Default active-search border opacity is 100%');
assert.strictEqual(defaults.activeSearchBorderOpacity, 1, 'Default active-search border opacity resolves to 1');
assert.strictEqual(defaults.activeSearchBorderColor, '#228be6', 'Default active-search border color is blue');
assert.strictEqual(defaults.activeSearchBorderWidth, 3, 'Default active-search border thickness is 3');
assert.deepStrictEqual(toRgb(defaults.activeSearchFillRgb), [34, 139, 230], 'Default fill color exposes an RGB triple');
assert.deepStrictEqual(toRgb(defaults.activeSearchBorderRgb), [34, 139, 230], 'Default border color exposes an RGB triple');
console.log('  ok - active-search defaults are a 10% blue fill with a 100% opaque blue border');

// --- Configured fill/border colors and thickness are honored and clamped ---
const styled = sandbox.getSegmentDisplaySettings({
    segmentActiveSearchFillColor: '#abc',
    segmentActiveSearchBorderColor: 'ff0000',
    segmentActiveSearchBorderWidth: 250,
    segmentActiveSearchBorderOpacityPercent: -5
});
assert.strictEqual(styled.activeSearchFillColor, '#aabbcc', 'Shorthand hex fill colors are expanded');
assert.strictEqual(styled.activeSearchBorderColor, '#ff0000', 'Border colors without a leading # are normalized');
assert.strictEqual(styled.activeSearchBorderWidth, 20, 'Border thickness is clamped to the 0-20 range');
assert.strictEqual(styled.activeSearchBorderOpacityPercent, 0, 'Border opacity is clamped to the 0-100 range');

// Non active-search segments keep their base color/thickness; active ones override.
assert.strictEqual(sandbox.resolveDisplayedSegmentFillColor(false, styled, '#123456'), '#123456', 'Resting fill color is untouched');
assert.strictEqual(sandbox.resolveDisplayedSegmentFillColor(true, styled, '#123456'), '#aabbcc', 'Active fill color uses the setting');
assert.strictEqual(sandbox.resolveDisplayedSegmentBorderColor(true, styled, '#123456'), '#ff0000', 'Active border color uses the setting');
assert.strictEqual(sandbox.resolveDisplayedSegmentBorderWidth(false, styled, 2), 2, 'Resting border thickness is untouched');
assert.strictEqual(sandbox.resolveDisplayedSegmentBorderWidth(true, styled, 2), 20, 'Active border thickness uses the setting');
assert.deepStrictEqual(toRgb(sandbox.resolveDisplayedSegmentRgb(false, styled, [1, 2, 3], 'fill')), [1, 2, 3], 'Resting RGB is untouched');
assert.deepStrictEqual(toRgb(sandbox.resolveDisplayedSegmentRgb(true, styled, [1, 2, 3], 'fill')), [170, 187, 204], 'Active fill RGB uses the setting');
assert.deepStrictEqual(toRgb(sandbox.resolveDisplayedSegmentRgb(true, styled, [1, 2, 3], 'border')), [255, 0, 0], 'Active border RGB uses the setting');
console.log('  ok - active-search fill color, border color and border thickness are honored');

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
assert.strictEqual(activeStyle['stroke-opacity'], restingStyle['stroke-opacity'], 'Border (stroke) opacity stays at the 100% default when actively searched');
assert.strictEqual(activeStyle.opacity, restingStyle.opacity, 'Overall/border opacity stays at the 100% default when actively searched');
assert.notStrictEqual(activeStyle['fill-opacity'], restingStyle['fill-opacity'], 'Fill opacity MUST change when actively searched');

// Active-search segments also override the fill/border colors and the border width.
assert.strictEqual(activeStyle.fill, '#228be6', 'Active fill uses the configured (default blue) fill color');
assert.strictEqual(activeStyle.stroke, '#228be6', 'Active stroke uses the configured (default blue) border color');
assert.strictEqual(activeStyle.color, '#228be6', 'Active color uses the configured (default blue) border color');
assert.strictEqual(activeStyle['stroke-width'], 3, 'Active border thickness is sent as stroke-width');
assert.ok(!Object.prototype.hasOwnProperty.call(restingStyle, 'stroke-width'), 'Resting segments must not have their border thickness overridden');
console.log('  ok - overlay applies the configured active-search fill/border colors and thickness');

console.log('All CalTopo overlay opacity checks passed.');

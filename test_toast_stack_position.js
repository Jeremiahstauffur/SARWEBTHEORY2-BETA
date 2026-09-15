// Toast notifications must stack downward from just under the sticky site
// header (never over it) and stay opaque while hovered.
//
// The positioning helpers are extracted from app.js by name and evaluated
// against a tiny fake DOM, so the test does not need the full vm sandbox the
// other app.js suites build.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

function extractFunction(name) {
    const start = appSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `app.js defines ${name}`);
    let depth = 0;
    for (let i = appSource.indexOf('{', start); i < appSource.length; i++) {
        if (appSource[i] === '{') depth++;
        if (appSource[i] === '}') depth--;
        if (depth === 0) return appSource.slice(start, i + 1);
    }
    throw new Error(`unterminated function ${name}`);
}

const gapMatch = appSource.match(/const TOAST_STACK_GAP_PX = (\d+);/);
assert.ok(gapMatch, 'TOAST_STACK_GAP_PX is declared');
const GAP = Number(gapMatch[1]);

function makeContext(header, toasts) {
    const document = {
        querySelector: (selector) => (selector === '.site-shell > header' ? header : null),
        querySelectorAll: (selector) => (selector === '.notif-toast' ? toasts : []),
    };
    const context = { document };
    vm.createContext(context);
    vm.runInContext(`${gapMatch[0]}\n${extractFunction('getToastStackTop')}\n${extractFunction('repositionToasts')}`, context);
    return context;
}

const makeToast = (height) => ({ offsetHeight: height, style: {} });

// A visible header 96px tall: the first toast starts below it and the rest
// follow downward, one gap apart.
{
    const header = { getBoundingClientRect: () => ({ top: 0, bottom: 96, height: 96 }) };
    const toasts = [makeToast(60), makeToast(40), makeToast(80)];
    const ctx = makeContext(header, toasts);
    assert.strictEqual(ctx.getToastStackTop(), 96 + GAP, 'stack starts under the header');
    ctx.repositionToasts();
    assert.deepStrictEqual(toasts.map(t => t.style.top), [
        `${96 + GAP}px`,
        `${96 + GAP + 60 + GAP}px`,
        `${96 + GAP + 60 + GAP + 40 + GAP}px`,
    ], 'toasts stack downward from the header, never above it');
}

// The header is display:none on mobile (measures 0) or absent from the page:
// the stack falls back to the top of the viewport.
{
    const hidden = { getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) };
    assert.strictEqual(makeContext(hidden, []).getToastStackTop(), GAP, 'hidden header -> viewport top');
    assert.strictEqual(makeContext(null, []).getToastStackTop(), GAP, 'no header -> viewport top');
    const noRect = {};
    assert.strictEqual(makeContext(noRect, []).getToastStackTop(), GAP, 'a fake DOM without getBoundingClientRect is tolerated');
}

// showToastNotification and repositionToasts share the same anchor.
{
    const show = extractFunction('showToastNotification');
    assert.ok(/let offset = getToastStackTop\(\);/.test(show), 'showToastNotification anchors under the header');
    assert.ok(/offsetHeight \+ TOAST_STACK_GAP_PX/.test(show), 'showToastNotification uses the shared gap');
    assert.ok(!/let offset = 20;/.test(show + extractFunction('repositionToasts')), 'no hard-coded 20px anchor remains');
    assert.ok(/window\.addEventListener\('resize', \(\) => \{\s*try \{\s*repositionToasts\(\);/.test(appSource), 'the stack is re-anchored on resize');
}

// Hover keeps the toast opaque: the accent tint is layered over the resting
// background instead of replacing it with a 16% tint.
{
    const hover = css.match(/\.notif-toast:hover \{([^}]*)\}/);
    assert.ok(hover, 'styles.css has a .notif-toast:hover rule');
    assert.ok(/linear-gradient\(var\(--pill-focus\), var\(--pill-focus\)\), var\(--glass-strong\)/.test(hover[1]), 'hover layers the tint over --glass-strong');
    assert.ok(!/opacity\s*:/.test(hover[1]), 'hover does not fade the toast');
}

console.log('test_toast_stack_position.js: PASS');

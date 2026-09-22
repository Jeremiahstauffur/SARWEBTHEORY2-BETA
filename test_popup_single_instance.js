// Popups (createPopup): one instance per title, the keyboard focus moves into
// the popup, Enter confirms and Escape closes.
//
// The fault this pins: the "+" / time button of the Incident Times form kept
// the keyboard focus while its "Set Enroute - <name>" popup opened, so Enter
// or Space re-fired the button and stacked another copy of the same popup.
// Every popup is built by createPopup, so the fix - focus into the popup, a
// same-titled request replacing the open popup, Enter clicking the primary
// button - covers all of them (status pickers, team pickers, confirmations).
//
// The popup helpers are extracted from app.js by name and evaluated against a
// tiny fake DOM (body children, class selectors, focus, click), so the test
// does not need the full vm sandbox the other app.js suites build.
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

const HELPERS = ['closePopup', 'findOpenPopupsTitled', 'replaceOpenPopupsTitled', 'focusPopupContent',
    'getPopupPrimaryButton', 'isPopupEnterReserved', 'handlePopupKeydown', 'createPopup'];

// ---------------------------------------------------------------------------
// The fake DOM: elements with children, classList, focus (tracked on
// document.activeElement), click (runs onclick) and class selectors.
// ---------------------------------------------------------------------------
function makeDocument() {
    const document = {activeElement: null, timers: []};
    function makeElement(tag) {
        const classes = new Set();
        const attrs = {};
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            dataset: {},
            children: [],
            parentNode: null,
            textContent: '',
            innerHTML: '',
            disabled: false,
            onclick: null,
            onkeydown: null,
            classList: {
                add: (...names) => names.forEach(n => classes.add(n)),
                remove: (...names) => names.forEach(n => classes.delete(n)),
                contains: (n) => classes.has(n)
            },
            get className() { return Array.from(classes).join(' '); },
            set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); },
            appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
            insertBefore(child, before) {
                child.parentNode = el;
                const at = el.children.indexOf(before);
                if (at < 0) el.children.push(child); else el.children.splice(at, 0, child);
                return child;
            },
            remove() {
                if (el.parentNode) {
                    el.parentNode.children = el.parentNode.children.filter(c => c !== el);
                    el.parentNode = null;
                }
            },
            setAttribute(name, value) { attrs[name] = String(value); },
            getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
            focus() { document.activeElement = el; },
            blur() { if (document.activeElement === el) document.activeElement = null; },
            click() { if (typeof el.onclick === 'function') el.onclick({type: 'click', target: el}); },
            getBoundingClientRect: () => ({left: 10, top: 20, width: 40, height: 20}),
            querySelector: (selector) => findAll(el, selector)[0] || null,
            querySelectorAll: (selector) => findAll(el, selector)
        };
        return el;
    }
    // ".a.b" (all classes) on descendants only.
    function matches(el, selector) {
        const classes = selector.split('.').filter(Boolean);
        return classes.length > 0 && classes.every(c => el.classList.contains(c));
    }
    function findAll(root, selector) {
        const out = [];
        const walk = (node) => (node.children || []).forEach(child => {
            if (matches(child, selector)) out.push(child);
            walk(child);
        });
        walk(root);
        return out;
    }
    document.body = makeElement('body');
    document.createElement = (tag) => makeElement(tag);
    document.querySelector = (selector) => findAll(document.body, selector)[0] || null;
    document.querySelectorAll = (selector) => findAll(document.body, selector);
    document.makeElement = makeElement;
    return document;
}

function makeContext() {
    const document = makeDocument();
    const context = {
        document,
        setTimeout: (fn, ms) => { document.timers.push({fn, ms}); return document.timers.length; }
    };
    vm.createContext(context);
    vm.runInContext(HELPERS.map(extractFunction).join('\n'), context);
    return context;
}

const overlays = (ctx) => ctx.document.querySelectorAll('.popup-overlay');
const titleOf = (overlay) => overlay.querySelector('.popup-title').textContent;
const keydown = (ctx, overlay, key, target) => {
    const event = {key, target: target || overlay.querySelector('.popup-content'), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
    overlay.onkeydown(event);
    return event;
};
// A popup the way showTimePrompt builds it: a time input and an "Update"
// primary button whose click reports the confirmation.
function openTimePrompt(ctx, title, confirmed) {
    const popup = ctx.createPopup(title);
    const content = popup.querySelector('.popup-content');
    const buttons = popup.querySelector('.popup-buttons');
    const input = ctx.document.createElement('input');
    input.type = 'text';
    input.className = 'pill-input';
    content.insertBefore(input, buttons);
    const update = ctx.document.createElement('button');
    update.className = 'popup-btn primary';
    update.textContent = 'Update';
    update.onclick = () => { confirmed.push(title); popup.remove(); };
    buttons.appendChild(update);
    return {popup, input, update};
}

// The Incident Times fault: the "+" button keeps the focus, Enter re-fires it.
// A second request for the same popup replaces the open one - never two.
{
    const ctx = makeContext();
    const plus = ctx.document.createElement('button');
    ctx.document.body.appendChild(plus);
    plus.focus();
    const confirmed = [];
    plus.onclick = () => openTimePrompt(ctx, 'Set Enroute - Bob', confirmed);
    plus.click();
    assert.strictEqual(overlays(ctx).length, 1, 'one popup');
    assert.strictEqual(ctx.document.activeElement, overlays(ctx)[0].querySelector('.popup-content'), 'the focus moved into the popup, off the "+" button');
    assert.strictEqual(overlays(ctx)[0].querySelector('.popup-content').getAttribute('tabindex'), '-1', 'the content is focusable without joining the tab order');
    assert.strictEqual(overlays(ctx)[0].querySelector('.popup-content').style.transformOrigin, '30px 30px', 'the opening animation still starts from the "+" button');

    // Were the button re-fired anyway (an old page, a stand-in without focus):
    // the open popup is replaced, not stacked.
    plus.click();
    plus.click();
    const open = overlays(ctx);
    assert.strictEqual(open.length, 1, 'still exactly one popup with that title');
    assert.strictEqual(titleOf(open[0]), 'Set Enroute - Bob');
    assert.strictEqual(ctx.document.body.children.filter(c => c.classList.contains('popup-overlay')).length, 1, 'the replaced popups left the DOM');

    // A popup with another title stacks (legitimate: "Set Server" over "Login").
    ctx.createPopup('Set On Scene - Bob');
    assert.deepStrictEqual(overlays(ctx).map(titleOf), ['Set Enroute - Bob', 'Set On Scene - Bob'], 'different titles coexist');

    // A popup already fading out is not "open": the next one of that title is
    // created alongside it and the fade-out finishes removing the old one.
    const fading = overlays(ctx)[0];
    ctx.closePopup(fading);
    assert.ok(fading.classList.contains('fade-out'));
    ctx.createPopup('Set Enroute - Bob');
    assert.strictEqual(overlays(ctx).filter(o => titleOf(o) === 'Set Enroute - Bob').length, 2, 'the fading one is left to its timer');
    ctx.document.timers.forEach(t => t.fn());
    assert.strictEqual(overlays(ctx).filter(o => titleOf(o) === 'Set Enroute - Bob').length, 1, 'and gone once it fired');
}

// Enter clicks the confirm (primary) button - from the popup itself (where
// the focus lands) and from a text input; Escape closes like the "x".
{
    const ctx = makeContext();
    const confirmed = [];
    const {popup} = openTimePrompt(ctx, 'Set Enroute - Bob', confirmed);
    const event = keydown(ctx, popup, 'Enter');
    assert.deepStrictEqual(confirmed, ['Set Enroute - Bob'], 'Enter on the freshly opened popup confirms it');
    assert.strictEqual(event.defaultPrevented, true);
    assert.strictEqual(overlays(ctx).length, 0, 'the confirm handler closed it');

    const second = openTimePrompt(ctx, 'Set Enroute - Bob', confirmed);
    keydown(ctx, second.popup, 'Enter', second.input);
    assert.deepStrictEqual(confirmed, ['Set Enroute - Bob', 'Set Enroute - Bob'], 'Enter in the time input confirms too');

    // A disabled primary is not clicked; a popup without one ignores Enter.
    const third = openTimePrompt(ctx, 'Set Enroute - Bob', confirmed);
    third.update.disabled = true;
    const ignored = keydown(ctx, third.popup, 'Enter');
    assert.strictEqual(confirmed.length, 2, 'a disabled confirm button is left alone');
    assert.strictEqual(ignored.defaultPrevented, false);
    third.popup.remove();
    let closed = 0;
    const plain = ctx.createPopup('Pick a team', null, () => { closed++; });
    keydown(ctx, plain, 'Enter');
    assert.strictEqual(overlays(ctx).length, 1, 'no primary button: Enter does nothing');

    // Escape = the "x": onClose runs and the popup fades out.
    keydown(ctx, plain, 'Escape');
    assert.strictEqual(closed, 1, 'Escape ran the onClose callback');
    assert.ok(plain.classList.contains('fade-out'), 'and closed the popup');
}

// Enter keeps its own meaning on buttons, links, textareas, selects, editable
// cells and search boxes, and an event another handler already took.
{
    const ctx = makeContext();
    const confirmed = [];
    const {popup} = openTimePrompt(ctx, 'Set Enroute - Bob', confirmed);
    const reserved = [
        Object.assign(ctx.document.createElement('button'), {}),
        Object.assign(ctx.document.createElement('a'), {}),
        Object.assign(ctx.document.createElement('textarea'), {}),
        Object.assign(ctx.document.createElement('select'), {}),
        Object.assign(ctx.document.createElement('div'), {isContentEditable: true}),
        Object.assign(ctx.document.createElement('input'), {type: 'search'}),
        Object.assign(ctx.document.createElement('input'), {type: 'text', placeholder: 'Type to search...'})
    ];
    reserved.forEach(target => {
        const event = keydown(ctx, popup, 'Enter', target);
        assert.strictEqual(event.defaultPrevented, false, `Enter on <${target.tagName.toLowerCase()}${target.type ? ` type=${target.type}` : ''}> is not taken`);
    });
    assert.deepStrictEqual(confirmed, [], 'none of them confirmed the popup');
    const handled = {key: 'Enter', target: popup.querySelector('.popup-content'), defaultPrevented: true, preventDefault() {}};
    popup.onkeydown(handled);
    assert.deepStrictEqual(confirmed, [], 'an Enter another handler already took is left alone');
    const other = keydown(ctx, popup, ' ');
    assert.strictEqual(other.defaultPrevented, false, 'Space does nothing on the popup');
    assert.deepStrictEqual(confirmed, []);
    const plainInput = Object.assign(ctx.document.createElement('input'), {type: 'text', placeholder: 'hh:mm'});
    keydown(ctx, popup, 'Enter', plainInput);
    assert.deepStrictEqual(confirmed, ['Set Enroute - Bob'], 'a plain text input confirms');
}

// The wiring in app.js and the stylesheet.
{
    const create = extractFunction('createPopup');
    assert.ok(/replaceOpenPopupsTitled\(titleText\)/.test(create), 'createPopup replaces an open popup of the same title');
    assert.ok(/focusPopupContent\(content\)/.test(create), 'createPopup moves the focus into the popup');
    assert.ok(/overlay\.onkeydown = \(event\) => handlePopupKeydown\(overlay, event, closeBtn\)/.test(create), 'createPopup wires Enter / Escape');
    assert.ok(/const origin = originElement \|\| document\.activeElement;\s*replaceOpenPopupsTitled/.test(create), 'the animation origin is read before the focus moves');
    const timePrompt = extractFunction('showTimePrompt');
    assert.ok(/updateBtn\.className = 'popup-btn primary'/.test(timePrompt), 'the time prompt\'s Update button is the primary Enter clicks');
    assert.ok(/showTimePrompt\(`Set \$\{field\.label\} - \$\{memberName\}`/.test(extractFunction('createIncidentTimeButton')), 'the Incident Times cells open the time prompt through createPopup');
    assert.strictEqual((appSource.match(/className = 'popup-overlay'/g) || []).length, 1, 'every popup overlay is built by createPopup');
    assert.ok(/\.popup-content:focus,\s*\.popup-content:focus-visible \{\s*outline: none;\s*\}/.test(css), 'no focus ring on the focused popup');
}

console.log('test_popup_single_instance.js: PASS');

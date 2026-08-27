// src/pkjs/config-ui/test/display-resolver.test.js — the display-resolver hook
// (item.displayFrom + PConf.displayResolvers).
//
// The hook exists for a key whose EFFECTIVE value is derived elsewhere: the graph
// night tint cascades from the metric's fill colour until the user pins it. The page
// must not write that cascade into storage (that write is what made "did the user pick
// this?" unanswerable), so the row paints the derived value while its stored value stays
// on its default — and picking the shown swatch is what pins it.
//
// What these tests hold down:
//   - an item WITHOUT displayFrom renders bit-for-bit as before;
//   - a hooked item paints the derived value in the chip AND marks it in the palette,
//     while cx.S is untouched;
//   - the derived value reaches a row inside an edit SHEET too (renderItem threads
//     cx.S/cx.ENV through renderEditModal, not just through the tab body);
//   - clicking the displayed swatch writes the real messageKey through setValue and
//     fires that item's onChange (the deliberate pin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const STORED = '#FFFF00';   // what the key actually holds (its untouched default)
const DERIVED = '#FF0000';  // what the cascade says it renders as

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'color', messageKey: 'plain', label: 'Plain', defaultValue: 0xFFFF00 },
    { type: 'color', messageKey: 'tint', label: 'Tint', defaultValue: 0xFFFF00,
      displayFrom: { resolver: 'derive', args: { scope: 'wind' } } }
  ] },
  { sheetOnly: true, sheetId: 'sheetWind', title: 'Wind colors', items: [
    { type: 'color', messageKey: 'sheetTint', label: 'Night', defaultValue: 0xFFFF00,
      displayFrom: { resolver: 'derive', args: { scope: 'wind' } } }
  ] }
] }] };

/** Build a render context around a settings object, mirroring boot()'s cx.
 * @param {Object} S Settings state.
 * @param {Object} [extra] Overrides (openColor, openEdit, ...).
 * @returns {Object} Render context.
 */
function cxFor(S, extra) {
  return Object.assign({
    S: S, ENV: { color: true }, USERDATA: {}, openColor: null, openSelect: null,
    openDate: null, openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: { color: true } })
  }, extra || {});
}

/** The palette swatch markup for one hex, as renderColor emits it.
 * @param {string} key messageKey the swatch writes to.
 * @param {string} hex Swatch colour.
 * @param {boolean} on Whether it is the current-value marker.
 * @returns {string} The substring to search for.
 */
function swatch(key, hex, on) {
  return '<button class="' + (on ? 'on' : '') + '" style="background:' + hex
    + '" data-k="' + key + '" data-color-pick="' + hex + '">';
}

test('displayResolvers registry: register/get; unknown id -> undefined', () => {
  E.displayResolvers.register('demo', function () { return DERIVED; });
  assert.equal(typeof E.displayResolvers.get('demo'), 'function');
  assert.equal(E.displayResolvers.get('nope'), undefined);
});

test('renderControl color: no displayValue -> byte-for-byte the pre-hook rendering', () => {
  const item = { type: 'color', messageKey: 'plain' };
  const before = E.renderControl(item, { value: STORED, openColor: 'plain' });
  // The hook is opt-in per ITEM; a view that never got a displayValue must render
  // exactly as one that predates the field.
  const after = E.renderControl(item, { value: STORED, displayValue: undefined, openColor: 'plain' });
  assert.equal(after, before, 'an unhooked color row must not change');
  assert.ok(before.indexOf(swatch('plain', STORED, true)) >= 0, 'stored value marked current');
  // An explicit null from a resolver means "nothing derived" -> stored value.
  assert.equal(E.renderControl(item, { value: STORED, displayValue: null, openColor: 'plain' }),
    before, 'a null displayValue falls back to the stored value');
});

test('renderControl color: displayValue paints the chip AND the palette marker', () => {
  const item = { type: 'color', messageKey: 'tint' };
  const html = E.renderControl(item, { value: STORED, displayValue: DERIVED, openColor: 'tint' });
  assert.ok(html.indexOf('<b style="background:' + DERIVED + '">') >= 0, 'chip paints the derived colour');
  assert.ok(html.indexOf('<span>' + DERIVED + '</span>') >= 0, 'the hex label follows it');
  assert.equal(html.indexOf('<b style="background:' + STORED + '">'), -1, 'not the stored colour');
  assert.equal(html.indexOf('<span>' + STORED + '</span>'), -1, 'nor its hex label');
  assert.ok(html.indexOf(swatch('tint', DERIVED, true)) >= 0, 'the DISPLAYED swatch is marked current');
  assert.ok(html.indexOf(swatch('tint', STORED, false)) >= 0, 'the stored one is just another swatch');
  // The write target never moves: every swatch still writes the item's own key.
  assert.equal(html.split('data-k="tint"').length - 1, 64, 'all 64 swatches write the messageKey');
});

test('renderControl color: a falsy-but-real derived value is honoured, not swallowed', () => {
  // '' is renderColor's "value the palette cannot represent" -> empty chip. The
  // fallback must key on null/undefined only, or a resolver could never say "blank".
  const html = E.renderControl({ type: 'color', messageKey: 'tint' },
    { value: STORED, displayValue: '', openColor: null });
  assert.ok(html.indexOf('<b style="background:"></b>') >= 0, 'empty derived value paints an empty chip');
  assert.equal(html.indexOf(STORED), -1, 'and does not fall back to the stored colour');
});

test('renderBody: displayFrom derives the painted value; cx.S is untouched', () => {
  E.displayResolvers.register('derive', function (S, env, args) {
    assert.equal(args.messageKey, 'tint', 'the row messageKey rides args');
    assert.equal(args.scope, 'wind', 'displayFrom.args are merged over it');
    assert.equal(env.color, true, 'env reaches the resolver');
    return S.tint === STORED ? DERIVED : S.tint;
  });
  const S = E.hydrate(SCHEMA, {});
  assert.equal(S.tint, STORED, 'the key hydrates its own default');
  const body = E.renderBody(SCHEMA, 't', cxFor(S, { openColor: 'tint' }));
  assert.ok(body.indexOf(swatch('tint', DERIVED, true)) >= 0, 'the hooked row marks the derived colour');
  assert.equal(S.tint, STORED, 'rendering must not write the derived value into storage');
  // The unhooked row in the same section is unaffected.
  const plain = E.renderBody(SCHEMA, 't', cxFor(S, { openColor: 'plain' }));
  assert.ok(plain.indexOf(swatch('plain', STORED, true)) >= 0, 'the unhooked row shows its stored value');
});

test('renderBody: an unregistered resolver id falls back to the stored value', () => {
  const SCH = JSON.parse(JSON.stringify(SCHEMA));
  SCH.tabs[0].sections[0].items[1].displayFrom = { resolver: 'missing' };
  const S = E.hydrate(SCH, {});
  const body = E.renderBody(SCH, 't', cxFor(S, { openColor: 'tint' }));
  assert.ok(body.indexOf(swatch('tint', STORED, true)) >= 0, 'no resolver -> stored value, no crash');
  assert.equal(body.indexOf('background:undefined'), -1, 'and no undefined chip');
});

test('renderEditModal: the hook reaches a colour row inside an edit sheet', () => {
  // The sheet body goes through the same renderItem, but via renderEditModal — the
  // only path that proves cx.S/cx.ENV are threaded into sheet rows.
  E.displayResolvers.register('derive', function () { return DERIVED; });
  const S = E.hydrate(SCHEMA, {});
  const sheet = E.renderEditModal(SCHEMA, cxFor(S, { openEdit: 'sheetWind', openColor: 'sheetTint' }));
  assert.ok(sheet.indexOf('data-color="sheetTint"') >= 0, 'the colour row is in the sheet');
  assert.ok(sheet.indexOf(swatch('sheetTint', DERIVED, true)) >= 0, 'sheet row marks the derived colour');
  assert.equal(S.sheetTint, STORED, 'still nothing written');
});

// --- the write path -----------------------------------------------------------
// setValue/controlClick are boot-local, so the pin can only be proven through a real
// boot. This shim is the minimum boot() touches: #scroll (body + delegated click),
// #tabs, #save, #appTitle, #toast, #modal.

/** A click event whose target.closest answers from a selector -> element map.
 * @param {Object} map Selector -> element (anything absent resolves to null).
 * @returns {{target: {closest: function(string): ?Object}}} The event stub.
 */
function clickOn(map) {
  return { target: { closest: (sel) => (Object.prototype.hasOwnProperty.call(map, sel) ? map[sel] : null) } };
}

/** An element stub answering getAttribute from an attribute map.
 * @param {Object} attrs Attribute name -> value.
 * @returns {{getAttribute: function(string): ?string, focus: function()}} The element stub.
 */
function el(attrs) {
  return { getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null), focus() {} };
}

/** Boot the engine against a DOM shim and return the knobs to drive the body.
 * @returns {{scroll: Object, listeners: Object}} The #scroll element and its listeners.
 */
function bootBody() {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = ['schema-walk.js', 'color.js', 'show-when.js', 'html.js', 'date-picker.js',
    'range-control.js', 'engine.js']
    .map((f) => fs.readFileSync(path.join(LIB, f), 'utf8')).join('\n')
    + '\nPConf.engine.boot();';

  const listeners = {}, rafQueue = [];
  const scroll = { innerHTML: '', className: '', scrollTop: 0,
    addEventListener: (type, fn) => { listeners[type] = fn; } };
  const modal = { innerHTML: '', style: {}, open: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [] };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener() {} });
  const ids = { scroll, modal, tabs: generic(), save: generic(),
    appTitle: generic(), toast: generic() };
  const document = {
    getElementById: (id) => ids[id] || generic(),
    addEventListener() {},
    querySelector: () => null
  };

  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, SCHEMA, { color: true }, {}, {}, 'pebblejs://close#',
    (f) => { rafQueue.push(f); return rafQueue.length; }, () => 0, () => {});
  return { scroll, listeners };
}

test('boot: picking the DISPLAYED swatch writes the real messageKey and fires onChange', () => {
  const h = bootBody();
  // The bundle installs its OWN registries over global.PConf, so app-side resolvers
  // can only be registered after it has run.
  const changes = [];
  global.PConf.displayResolvers.register('derive', function (S) {
    return S.tint === STORED ? DERIVED : S.tint;   // cascade until the key is pinned
  });
  global.PConf.onChange.register('noteTint', function (S, oldV, newV, env, key) {
    changes.push({ key: key, oldV: oldV, newV: newV, stored: S[key] });
  });
  SCHEMA.tabs[0].sections[0].items[1].onChange = 'noteTint';

  // Open the palette on the hooked row (this is also the first render that sees the
  // resolver at all).
  h.listeners.click(clickOn({ '[data-color]': el({ 'data-color': 'tint' }) }));
  assert.ok(h.scroll.innerHTML.indexOf(swatch('tint', DERIVED, true)) >= 0,
    'the palette marks the CASCADED colour as current');
  assert.ok(h.scroll.innerHTML.indexOf(swatch('tint', STORED, false)) >= 0,
    'the stored default is not marked');

  // Tap the marked (cascaded) swatch — the pin.
  h.listeners.click(clickOn({
    '[data-color-pick]': el({ 'data-color-pick': DERIVED, 'data-k': 'tint' })
  }));
  assert.deepEqual(changes, [{ key: 'tint', oldV: STORED, newV: DERIVED, stored: DERIVED }],
    'setValue wrote the item messageKey and dispatched its onChange');

  // Now the key genuinely holds it: the resolver stops cascading and the row is unchanged.
  h.listeners.click(clickOn({ '[data-color]': el({ 'data-color': 'tint' }) }));
  assert.ok(h.scroll.innerHTML.indexOf(swatch('tint', DERIVED, true)) >= 0,
    'the pinned colour is still the marked one');

  delete SCHEMA.tabs[0].sections[0].items[1].onChange;
});

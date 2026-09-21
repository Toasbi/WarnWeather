// test/config-night-color-sheet.test.js — the dim-backlight COLOUR surface: one
// compact row in the Nighttime card showing the colour that is set, and the three
// channel sliders behind it in a bottom sheet.
//
// The row shows the SHEET's own preview — the 24px chip plus the hex, not a 9px pip —
// built by html.js swatchReadout, which renderRgb prints too. That shared builder is
// what the tests below pin: a second inline copy of the markup is how the card and the
// sheet would start drifting.
//
// Owner review of the rendered page: three inline tracks made the card's smallest
// setting its tallest row, so the card now shows only the selected colour. The value
// itself did not move — same key, same "r,g,b" wire format, same default (pinned in
// config-schema.test.js next to the rest of the Nighttime keys); this file owns where
// it is edited.
//
// Everything here is RENDERED, not read off the schema: the point of the change is what
// the page draws. The last test boots the real generated page against a fake DOM,
// because a control that renders in the dialog can still be inert there — the edit
// sheet lives outside #scroll and wires its own pointer/keyboard handlers.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');   // registers the rgbSwatch badge resolver
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const SHEET_ID = 'backlightColor';
const KEY = 'backlightDimColor';
const emeryEnv = platform.computeEnv({ platform: 'emery' });
const basaltEnv = platform.computeEnv({ platform: 'basalt' });

/** A render context over the real schema, hydrated then overlaid with `state`.
 * @param {Object} [state] Stored values to overlay on the hydrated defaults.
 * @param {Object} [env] Platform env (default emery — the only backlight that tints).
 * @param {?string} [openEdit] sheetId of the open edit sheet, or null.
 * @returns {Object} Engine render context.
 */
function cxFor(state, env, openEdit) {
  const ENV = env || emeryEnv;
  const S = Object.assign(eng.hydrate(schema, {}), state || {});
  return {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null, openDate: null,
    openEdit: openEdit || null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: ENV })
  };
}

/** The Nighttime card's HTML, from its title to wherever the next card starts.
 * @param {Object} [state] Stored values to overlay on the hydrated defaults.
 * @param {Object} [env] Platform env.
 * @returns {string} Card HTML.
 */
function nightCard(state, env) {
  const body = eng.renderBody(schema, 'general', cxFor(state, env));
  const at = body.indexOf('>Nighttime settings<');
  assert.ok(at > 0, 'the Nighttime card rendered');
  const next = body.indexOf('<div class="card', at);
  return body.slice(at, next === -1 ? undefined : next);
}

/** The open colour sheet's HTML (header + body), as renderEditModal builds it.
 * @param {Object} [state] Stored values to overlay on the hydrated defaults.
 * @param {Object} [env] Platform env.
 * @returns {string} Sheet HTML, or '' when the sheet is gated off.
 */
function colorSheet(state, env) {
  return eng.renderEditModal(schema, cxFor(state, env, SHEET_ID));
}

/** The colour printed in the card row's readout — swatch and hex must AGREE, so this
 * reads both and fails rather than reporting one of them.
 * @param {Object} [state] Stored values to overlay on the hydrated defaults.
 * @returns {?string} '#RRGGBB', or null when no readout rendered.
 */
function swatchHex(state) {
  const card = nightCard(state);
  const m = /<span class="sw-wrap sw-ro"><b style="background:(#[0-9A-F]{6})"><\/b><span>(#[0-9A-F]{6})<\/span><\/span>/
    .exec(card);
  if (!m) { return null; }
  assert.equal(m[2], m[1], 'the hex printed beside the chip is the chip\'s own colour');
  return m[1];
}

// --- the card: the colour, not the sliders ---------------------------------

test('the Nighttime card shows one Color row — the readout and Edit, no channel tracks', () => {
  const card = nightCard();
  assert.ok(card.indexOf('data-edit-sheet="' + SHEET_ID + '"') !== -1,
    'the Color row opens the colour sheet');
  // The row carries the SHEET's own preview — the 24px chip and the hex, not a 9px pip —
  // seated left of the Edit button, which trails on the card's right edge.
  assert.match(card, /<div class="lbl">Color<\/div>[\s\S]*?<div class="rgt has-pen">[\s\S]*?<span class="sw-wrap sw-ro">[\s\S]*?data-edit-sheet="backlightColor"/);
  assert.equal(card.indexOf('pen-dot'), -1, 'the small dot it replaced is gone');
  // ...and NOTHING of the control itself is left in the card. These are the three
  // pieces renderRgb emits — the root, each channel's fill, each channel's thumb —
  // plus the two paint hooks, which belong to the sheet's live copy alone.
  ['data-range="' + KEY + '"', 'data-rgb-fill', 'data-range-thumb', 'rng-track',
    'data-rgb-swatch', 'data-rgb-hex'].forEach((frag) =>
    assert.equal(card.indexOf(frag), -1, 'the card must not carry ' + frag + ' any more'));
  // The sheet's rows are a dialog body: the tab renderer skips the whole section.
  const body = eng.renderBody(schema, 'general', cxFor());
  assert.equal(body.indexOf('data-range="' + KEY + '"'), -1,
    'the rgb control renders nowhere in the tab body');
  assert.equal(body.indexOf('Dim backlight color'), -1, 'nor does the sheet title');
});

test('the row prints the SAME preview the sheet does, from the same builder', () => {
  // The point of the extraction: one fragment, two surfaces. If these ever diverge the
  // card is showing a colour in a vocabulary the sheet behind it does not use.
  const htmlLib = require('../src/pkjs/config-ui/lib/html.js');
  const state = { [KEY]: '200,40,10' };
  assert.ok(nightCard(state).indexOf(htmlLib.swatchReadout('#C8280A')) !== -1,
    'the row prints swatchReadout, hookless');
  assert.ok(colorSheet(state).indexOf(htmlLib.swatchReadout('#C8280A', true)) !== -1,
    'the sheet prints the same fragment with its in-place paint hooks');
  // Same chip, same hex, same class — the `live` hooks are the only difference.
  assert.equal(htmlLib.swatchReadout('#C8280A').replace(/ data-rgb-(swatch|hex)/g, ''),
    htmlLib.swatchReadout('#C8280A', true).replace(/ data-rgb-(swatch|hex)/g, ''));
});

test('the readout is the colour that is stored — change the value, chip and hex follow', () => {
  assert.equal(swatchHex(), '#280A00', 'the default dim red');
  assert.equal(swatchHex({ [KEY]: '200,40,10' }), '#C8280A', 'a picked colour');
  assert.equal(swatchHex({ [KEY]: '0,0,0' }), '#000000', 'black is a colour, not a missing value');
  // The longest string the readout ever has to seat beside the Edit button. Nothing
  // measurable in Node — shell.html's row-scoped padding trim is pinned in
  // config-ui/test/theme-shell.test.js — but the markup must at least render whole.
  assert.equal(swatchHex({ [KEY]: '255,255,255' }), '#FFFFFF', 'the widest hex, #FFFFFF');
  // The badge parses with the control's own parser, so what it previews is exactly
  // what the sliders would open on: an out-of-range channel is clamped (the byte is
  // fixed by the hardware), while a value that is not three integers falls back to
  // the schema default rather than to black.
  assert.equal(swatchHex({ [KEY]: '300,-5,20' }), '#FF0014', 'a bruised channel clamps');
  assert.equal(swatchHex({ [KEY]: '' }), '#280A00', 'a blank value shows the default');
  assert.equal(swatchHex({ [KEY]: undefined }), '#280A00', 'and so does a missing one');
  assert.equal(swatchHex({ [KEY]: '#FF0000' }), '#280A00', 'so does a hex string, which is not r,g,b');
  assert.equal(swatchHex({ [KEY]: '12,34' }), '#280A00', 'and so do two channels');
  // Whatever it shows, the row still offers the way in and still SAYS the colour: the
  // readout is inside the aria-hidden preview wrapper, so the button carries the name.
  ['200,40,10', '', 'nonsense'].forEach((v) => {
    const card = nightCard({ [KEY]: v });
    assert.ok(card.indexOf('data-edit-sheet="' + SHEET_ID + '"') !== -1,
      'the Edit affordance survives the value ' + JSON.stringify(v));
    assert.ok(/aria-label="Edit settings for the Color value \(#[0-9A-F]{6}\)"/.test(card),
      'and announces a colour');
  });
  assert.ok(nightCard({ [KEY]: '200,40,10' })
    .indexOf('aria-label="Edit settings for the Color value (#C8280A)"') !== -1,
    'the Edit button announces the colour the readout shows');
});

test('the badge resolver refuses a row that names no key', () => {
  // A `sheet` row has no messageKey for the engine to merge in, so `key` in the args
  // is the resolver's whole identity for the value it previews. Without one there is
  // nothing to show, and printing #000000 (channel 0 is the parser's last resort)
  // would be a readout that means "unset" rather than a colour.
  const badge = global.PConf.badgeResolvers.get('rgbSwatch');
  assert.equal(typeof badge, 'function', 'badge resolver registered');
  assert.equal(badge({ [KEY]: '200,40,10' }, emeryEnv, {}), null);
  assert.equal(badge({ [KEY]: '200,40,10' }, emeryEnv, undefined), null);
});

// --- the sheet -------------------------------------------------------------

test('the row\'s sheetId resolves to a sheetOnly section holding the rgb control', () => {
  const sheet = colorSheet({ [KEY]: '200,40,10' });
  assert.ok(sheet.indexOf('Dim backlight color') !== -1, 'the sheet is titled');
  assert.ok(sheet.indexOf('Pick the color the backlight glows') !== -1,
    'and introduced — the hint that used to ride the card row lives here');
  assert.ok(sheet.indexOf('data-range="' + KEY + '"') !== -1, 'the rgb control renders in it');
  ['r', 'g', 'b'].forEach((ch) => {
    assert.ok(sheet.indexOf('data-range-thumb="' + ch + '"') !== -1, ch + ' has a thumb');
    assert.ok(sheet.indexOf('data-rgb-fill="' + ch + '"') !== -1, ch + ' has a fill');
  });
  assert.ok(sheet.indexOf('<span data-rgb-hex>#C8280A</span>') !== -1,
    'the control opens on the stored colour');
  // No label on the rgb row: the sheet title already names this control (the threshold
  // sliders drop theirs for the same reason).
  assert.equal(sheet.indexOf('<div class="lbl">'), -1, 'no row label stuttering under the title');
});

test('the sheet is gated exactly like the row that opens it', () => {
  // Forced open (an opener the user cannot reach still has to render nothing): basalt
  // has a colour screen but a plain white backlight, and a switched-off Dim backlight
  // has no colour to pick either.
  assert.equal(colorSheet({}, basaltEnv), '', 'no sheet on a watch whose backlight cannot be tinted');
  assert.equal(colorSheet({ backlightDim: false }), '', 'nor while the dimming is switched off');
  assert.ok(colorSheet().length > 0, 'emery with the switch on gets the sheet');
  // ...and the row is gone in both cases too, so nothing offers to open it.
  assert.equal(nightCard({}, basaltEnv).indexOf('data-edit-sheet="' + SHEET_ID + '"'), -1);
  assert.equal(nightCard({ backlightDim: false }).indexOf('data-edit-sheet="' + SHEET_ID + '"'), -1);
});

// --- operable INSIDE the dialog --------------------------------------------
// The sheet renders into #modal, which lives outside #scroll and gets its own
// delegated handlers; the range wiring serves both hosts from one drag state. Renders
// there, therefore works there is exactly the assumption worth checking.

/** A stub of the rendered .rng.rgb root, enough for the wiring to read and repaint.
 * Each channel's thumb answers `.closest('.rng-track')` with its OWN rect (R at x=0,
 * G at 100, B at 200), while the root's first track is R's — the real DOM's shape. A
 * handler that measured the root's track while dragging G would map the pointer onto
 * R's rect and slam the channel to 255 instead of the value under the finger.
 * @param {{r:number, g:number, b:number}} c Colour the control currently shows.
 * @returns {Object} Root stub, with .thumb(ch) for the channel buttons.
 */
function makeRgbRoot(c) {
  const attrs = { 'data-range': KEY, 'data-r': String(c.r), 'data-g': String(c.g), 'data-b': String(c.b) };
  const styled = () => ({ style: {}, setAttribute() {}, textContent: '' });
  const LEFT = { r: 0, g: 100, b: 200 };
  const trackFor = (ch) => ({ getBoundingClientRect: () => ({ left: LEFT[ch], width: 100 }) });
  const nodes = {
    '[data-rgb-swatch]': styled(), '[data-rgb-hex]': styled(), '.rng-track': trackFor('r')
  };
  ['r', 'g', 'b'].forEach((ch) => {
    nodes['[data-rgb-fill=' + ch + ']'] = styled();
    nodes['[data-range-thumb=' + ch + ']'] = styled();
    nodes['[data-rgb-val=' + ch + ']'] = styled();
  });
  const root = {
    isConnected: true,
    getAttribute: (n) => (attrs[n] == null ? null : attrs[n]),
    setAttribute(n, v) { attrs[n] = String(v); },
    querySelector: (sel) => nodes[sel] || null,
    querySelectorAll: () => [],
    closest: (sel) => (sel === '.rng' ? root : null)
  };
  root.thumb = (ch) => {
    const track = trackFor(ch);
    const th = {
      getAttribute: (n) => (n === 'data-range-thumb' ? ch : null),
      closest: (sel) => (sel === '[data-range-thumb]' ? th
        : sel === '.rng' ? root : sel === '.rng-track' ? track : null),
      focus() {}, setPointerCapture() {}, style: {}, setAttribute() {}
    };
    return th;
  };
  return root;
}
const NO_TARGET = { closest: () => null };

test('the sliders drag and nudge inside the sheet, and the card\'s swatch follows', () => {
  // This boots the flat concatenated page, where nothing require()s: it is also the
  // one test that exercises the badge resolver's webview branch (PConf.rangeControl
  // rather than a require of range-control.js) — the card swatch below repaints
  // through it.
  const page = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  assert.ok(page.scroll.innerHTML.indexOf('data-edit-sheet="' + SHEET_ID + '"') !== -1,
    'the General tab opens on the Color row');
  page.openEditSheet(SHEET_ID);
  assert.ok(page.modal.innerHTML.indexOf('data-range="' + KEY + '"') !== -1,
    'the rgb control is in the open sheet');
  assert.equal(page.S[KEY], '40,10,0', 'starting on the default dim red');

  // Drag the GREEN thumb to x=140 on its own track (left 100, width 100) → 40% of 255.
  const root = makeRgbRoot({ r: 96, g: 0, b: 0 });
  page.modal.dispatch('pointerdown', { target: root.thumb('g'), pointerId: 3, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 3, clientX: 140 });
  assert.equal(page.S[KEY], '96,102,0', 'the drag wrote the green channel, and only it');
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 3 });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 3, clientX: 240 });
  assert.equal(page.S[KEY], '96,102,0', 'no writes after the release');
  // Release re-renders, so the card behind the sheet now previews the new colour —
  // chip and hex both, and still without the sheet's in-place paint hooks.
  assert.ok(page.scroll.innerHTML.indexOf(
    '<span class="sw-wrap sw-ro"><b style="background:#606600"></b><span>#606600</span></span>') !== -1,
    'the card readout repainted to the dragged colour');
  assert.equal(page.scroll.innerHTML.indexOf('data-rgb-hex'), -1,
    'the tab body never grows a paint hook for paintRgb to find');

  // Keyboard: one step per arrow on the focused thumb, the other channels untouched.
  const root2 = makeRgbRoot({ r: 96, g: 102, b: 0 });
  page.modal.dispatch('keydown', { target: root2.thumb('b'), key: 'ArrowRight', preventDefault() {} });
  assert.equal(page.S[KEY], '96,102,1', 'blue nudged up one');
  page.modal.dispatch('keydown', { target: root2.thumb('r'), key: 'ArrowDown', preventDefault() {} });
  assert.equal(page.S[KEY], '95,102,1', 'red nudged down one');
});

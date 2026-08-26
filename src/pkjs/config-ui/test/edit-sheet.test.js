// src/pkjs/config-ui/test/edit-sheet.test.js — sheetOnly sections + the edit-sheet
// modal + the per-row pencil trigger (editSheetFrom).
const test = require('node:test');
const assert = require('node:assert/strict');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

// A select whose sheet resolver offers an edit sheet only for the 'wind' value,
// plus the sheetOnly section holding that sheet's fields.
const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Main', items: [
    { type: 'select', messageKey: 'slot', label: 'Left slot', defaultValue: 'wind',
      options: [['Wind', 'wind'], ['Time', 'time']],
      editSheetFrom: { resolver: 'slotSheet', args: { slotKey: 'slot' } } },
    { type: 'toggle', messageKey: 'flag', defaultValue: false }
  ] },
  { sheetOnly: true, sheetId: 'sheetWind', title: 'Wind thresholds', intro: 'Sheet intro.', items: [
    { type: 'text', messageKey: 'windWarn', label: 'Warn above', defaultValue: '' },
    { type: 'color', messageKey: 'windColor', label: 'Warn color', defaultValue: 0xFFAA00 }
  ] }
] }] };

global.PConf.sheetResolvers.register('slotSheet', function (S, env, args) {
  return S[args.slotKey] === 'wind' ? 'sheetWind' : null;
});

function cxFor(S, extra) {
  return Object.assign({
    S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, openDate: null,
    openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} })
  }, extra || {});
}

// The app-neutral badge shape: a label, an optional parenthesised aria note, and a
// dot list the engine paints as outlined (ring) or filled swatches. The library
// knows nothing about what the colours mean.
const BADGED_SCHEMA = JSON.parse(JSON.stringify(SCHEMA));
BADGED_SCHEMA.tabs[0].sections[0].items[0].editBadgeFrom = { resolver: 'penBadge' };
global.PConf.badgeResolvers.register('penBadge', function () {
  return { label: 'Edit', ariaNote: 'highlighting on',
    dots: [{ color: '#00AAFF', ring: true }, { color: '#5500FF' }] };
});

test('sheetOnly: hidden from the tab body, still hydrated and serialized', () => {
  const S = E.hydrate(SCHEMA, {});
  assert.equal(S.windWarn, '', 'sheet field hydrates its default');
  assert.equal(S.windColor, '#FFAA00', 'sheet color hydrates (int -> hex)');
  const body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.equal(body.indexOf('data-k="windWarn"'), -1, 'sheet field not in the tab body');
  assert.equal(body.indexOf('Wind thresholds'), -1, 'sheet title not in the tab body');
  const out = E.serialize(SCHEMA, S);
  ['windWarn', 'windColor'].forEach((k) =>
    assert.ok(Object.prototype.hasOwnProperty.call(out, k), 'serialize keeps ' + k));
});

test('pencil trigger: rendered only when the sheet resolver returns a sheet id', () => {
  const S = E.hydrate(SCHEMA, {});
  const withPen = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(withPen.indexOf('data-edit-sheet="sheetWind"') !== -1,
    'wind value offers its edit sheet');
  // The Edit button TRAILS the control: .rgt is right-aligned and the button is one
  // fixed width, so it lands on the same right edge in every row instead of being
  // pushed around by the dropdown's current value. The colour swatch leads instead.
  assert.ok(/data-select="slot"[\s\S]*?data-edit-sheet="sheetWind"/.test(withPen),
    'Edit sits in the control cell, RIGHT of the select trigger');
  assert.ok(!/data-edit-sheet="sheetWind"[\s\S]*?data-select="slot"/.test(withPen),
    'Edit must not precede the select trigger');
  const S2 = E.hydrate(SCHEMA, { slot: 'time' });
  const noPen = E.renderBody(SCHEMA, 't', cxFor(S2));
  assert.equal(noPen.indexOf('data-edit-sheet'), -1, 'time value has no pencil');
});

test('pencil trigger aria-label: the button label leads the sentence, no stutter', () => {
  // Without a badge the label falls back to 'Edit' — the announced text must be
  // 'Edit settings for the <slot> value', not 'Edit edit settings …'.
  const S = E.hydrate(SCHEMA, {});
  const html = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(html.indexOf('aria-label="Edit settings for the Left slot value"') !== -1,
    'announced as "Edit settings for the <slot> value"');
  assert.equal(html.indexOf('Edit edit'), -1, 'no stuttered wording');
  // A badge keeps the same lead label and appends its ariaNote in parentheses.
  const badged = E.renderBody(BADGED_SCHEMA, 't', cxFor(E.hydrate(BADGED_SCHEMA, {})));
  assert.ok(
    badged.indexOf('aria-label="Edit settings for the Left slot value (highlighting on)"') !== -1,
    'the badge\'s ariaNote is announced after the same sentence');
});

test('badge dots: ring -> outlined, no ring -> filled, in list order', () => {
  const html = E.renderBody(BADGED_SCHEMA, 't', cxFor(E.hydrate(BADGED_SCHEMA, {})));
  assert.ok(html.indexOf('<span class="pen-dot ring" style="--th-c:#00AAFF"></span>') !== -1,
    'a ring dot renders with the ring class');
  assert.ok(html.indexOf('<span class="pen-dot fill" style="--th-c:#5500FF"></span>') !== -1,
    'a ringless dot renders with the fill class');
  assert.ok(/pen-dot ring[\s\S]*?pen-dot fill/.test(html), 'dots keep the resolver\'s order');
  // The swatch is a preview outside the button; the button still trails the control.
  assert.ok(/thr-swatch[\s\S]*?data-select="slot"[\s\S]*?thr-btn/.test(html),
    'swatch leads the control, Edit trails it');
});

test('badge with an empty dot list: the Edit button still renders, no swatch', () => {
  const EMPTY = JSON.parse(JSON.stringify(SCHEMA));
  EMPTY.tabs[0].sections[0].items[0].editBadgeFrom = { resolver: 'penBadgeOff' };
  global.PConf.badgeResolvers.register('penBadgeOff', function () {
    return { label: 'Edit', ariaNote: '', dots: [] };
  });
  const html = E.renderBody(EMPTY, 't', cxFor(E.hydrate(EMPTY, {})));
  assert.ok(html.indexOf('data-edit-sheet="sheetWind"') !== -1, 'the trigger survives');
  assert.equal(html.indexOf('pen-dot'), -1, 'no dots for an empty list');
  assert.equal(html.indexOf('thr-swatch'), -1, 'no empty swatch wrapper either');
  assert.ok(html.indexOf('aria-label="Edit settings for the Left slot value"') !== -1,
    'an empty ariaNote adds no parentheses');
});

test('renderEditModal: header + intro + fields for the open sheet; \'\' otherwise', () => {
  const S = E.hydrate(SCHEMA, {});
  const html = E.renderEditModal(SCHEMA, cxFor(S, { openEdit: 'sheetWind' }));
  assert.ok(html.indexOf('Wind thresholds') !== -1, 'sheet title in the header');
  assert.ok(html.indexOf('Sheet intro.') !== -1, 'sheet intro rendered');
  assert.ok(html.indexOf('data-k="windWarn"') !== -1, 'text field rendered in the sheet');
  assert.ok(html.indexOf('data-color="windColor"') !== -1, 'color control rendered in the sheet');
  assert.ok(html.indexOf('data-select-close') !== -1, 'close button uses the shared close hook');
  assert.equal(E.renderEditModal(SCHEMA, cxFor(S)), '', 'nothing open -> empty');
  assert.equal(E.renderEditModal(SCHEMA, cxFor(S, { openEdit: 'nope' })), '', 'unknown sheet -> empty');
});

test('a gated sheetOnly section renders an empty modal (and no pencil can reach it)', () => {
  const GATED = JSON.parse(JSON.stringify(SCHEMA));
  GATED.tabs[0].sections[1].showWhen = { env: 'thresholds' };
  const S = E.hydrate(GATED, {});
  const cx = cxFor(S, { openEdit: 'sheetWind' });
  cx.evalCtx.env = { thresholds: false };
  assert.equal(E.renderEditModal(GATED, cx), '', 'section showWhen gates the sheet');
  cx.evalCtx.env = { thresholds: true };
  assert.ok(E.renderEditModal(GATED, cx).indexOf('data-k="windWarn"') !== -1,
    'capable env renders the sheet');
});

// --- subheader item: an in-body section header that can host the master toggle ---
// The threshold sheets grew a slot-level row (Bold) that must sit OUTSIDE the
// threshold group, so the group needs its own header — and the master on/off
// switch moves from the sheet's title row down onto that header.
const SUB_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { sheetOnly: true, sheetId: 'sheetSub', title: 'Wind speed slot', items: [
    { type: 'segmented', messageKey: 'bold', label: 'Bold', defaultValue: 'warn',
      options: [['Off', 'off'], ['Warn', 'warn'], ['Always', 'always']] },
    { type: 'subheader', text: 'Thresholds', toggleKey: 'windOn',
      labelAction: { action: 'resetIt', arg: 'Wind', label: 'Reset to defaults' } },
    { type: 'toggle', messageKey: 'windOn', label: 'Highlight this value', defaultValue: false },
    { type: 'text', messageKey: 'windWarn', label: 'Warn above', defaultValue: '' }
  ] }
] }] };

function subCx(S, extra) {
  return Object.assign({
    S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, openDate: null,
    openEdit: 'sheetSub', selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} })
  }, extra || {});
}

test('subheader renders its text as an in-body .subhdr', () => {
  const S = E.hydrate(SUB_SCHEMA, {});
  const html = E.renderEditModal(SUB_SCHEMA, subCx(S));
  assert.match(html, /class="subhdr[^"]*"[^>]*>[\s\S]*?Thresholds/);
});

test('subheader hosts the referenced toggle, which no longer renders its own row', () => {
  const S = E.hydrate(SUB_SCHEMA, { windOn: true });
  const html = E.renderEditModal(SUB_SCHEMA, subCx(S));
  const sw = html.match(/<button class="sw on"[^>]*data-k="windOn"[^>]*data-toggle="1"[^>]*>/);
  assert.ok(sw, 'the switch rides the subheader in its on state');
  assert.match(sw[0], /aria-label="Highlight this value"/, 'named from the toggle item');
  assert.equal(html.split('data-k="windOn"').length - 1, 1, 'exactly one switch, not two');
  assert.equal(html.indexOf('Highlight this value</div>'), -1, 'no separate label row');
});

test('subheader toggle reflects the off state', () => {
  const S = E.hydrate(SUB_SCHEMA, { windOn: false });
  const html = E.renderEditModal(SUB_SCHEMA, subCx(S));
  assert.match(html, /<button class="sw"[^>]*data-k="windOn"/);
});

test('the sheet title row keeps only the close button now', () => {
  const S = E.hydrate(SUB_SCHEMA, { windOn: true });
  const html = E.renderEditModal(SUB_SCHEMA, subCx(S));
  const hdr = html.slice(0, html.indexOf('</div>'));
  assert.match(hdr, /Wind speed slot/);
  assert.equal(hdr.indexOf('data-toggle'), -1, 'master switch is no longer in the title row');
});

test('subheader carries a labelAction button', () => {
  const S = E.hydrate(SUB_SCHEMA, {});
  const html = E.renderEditModal(SUB_SCHEMA, subCx(S));
  assert.match(html, /data-action="resetIt"[^>]*data-action-arg="Wind"/);
});

test('a toggle hosted by a subheader still hydrates and serializes', () => {
  const S = E.hydrate(SUB_SCHEMA, { windOn: true });
  assert.equal(S.windOn, true);
  assert.equal(E.serialize(SUB_SCHEMA, S).windOn, true);
});

test('a hidden subheader leaves no orphan header behind', () => {
  const gated = JSON.parse(JSON.stringify(SUB_SCHEMA));
  gated.tabs[0].sections[0].items[1].showWhen = { key: 'never' };
  const S = E.hydrate(gated, {});
  const html = E.renderEditModal(gated, subCx(S));
  assert.equal(html.indexOf('Thresholds'), -1);
});

// --- hosted-row rule on the other render paths: the main loop, the inline-run
// gatherer and the divider look-ahead all share one predicate (isHostedRow) ---

test('a hosted toggle caught in an inline run renders no duplicate switch', () => {
  const HOSTED_INLINE = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { sheetOnly: true, sheetId: 'sheetHost', title: 'Host', items: [
      { type: 'subheader', text: 'Grp', toggleKey: 'hostedOn' },
      { type: 'toggle', messageKey: 'other', label: 'Other', defaultValue: false, inline: 'pair' },
      { type: 'toggle', messageKey: 'hostedOn', label: 'Hosted', defaultValue: true, inline: 'pair' }
    ] }
  ] }] };
  const S = E.hydrate(HOSTED_INLINE, {});
  const html = E.renderEditModal(HOSTED_INLINE, cxFor(S, { openEdit: 'sheetHost' }));
  assert.equal(html.split('data-k="hostedOn"').length - 1, 1,
    'the switch renders once, on the subheader — not again in the inline row');
  assert.ok(html.indexOf('data-k="other"') !== -1, 'the non-hosted inline member still renders');
});

test('the row before a hosted toggle takes its divider from the row actually rendered next', () => {
  const DIV = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { sheetOnly: true, sheetId: 'sheetDiv', title: 'Div', items: [
      { type: 'subheader', text: 'Grp', toggleKey: 'hostedOn' },
      { type: 'toggle', messageKey: 'before', label: 'Before', defaultValue: false },
      { type: 'toggle', messageKey: 'hostedOn', label: 'Hosted', defaultValue: true, joinPrevious: true },
      { type: 'toggle', messageKey: 'after', label: 'After', defaultValue: false }
    ] }
  ] }] };
  const S = E.hydrate(DIV, {});
  const html = E.renderEditModal(DIV, cxFor(S, { openEdit: 'sheetDiv' }));
  assert.ok(html.indexOf('<div class="row"><div class="lft"><div class="lbl">Before</div>') !== -1,
    'Before keeps its plain row class');
  assert.equal(html.indexOf('class="row nb"'), -1,
    'the suppressed toggle\'s joinPrevious must not strip the divider above it');
});

// --- type:'sheet': a first-class trigger row, for a sheet that belongs to no single
// control (the graph-colors sheet) rather than to one slot's value ---

function sheetTriggerSchema(item) {
  const SCH = JSON.parse(JSON.stringify(SCHEMA));
  SCH.tabs[0].sections[0].items = [
    { type: 'toggle', messageKey: 'flag', label: 'Flag', defaultValue: false },
    item
  ];
  return SCH;
}

test('type:sheet renders a trigger row for its sheet, with no key of its own', () => {
  const SCH = sheetTriggerSchema({ type: 'sheet', sheetId: 'sheetColors',
    label: 'Graph colors', hint: 'Pick the graph colors.' });
  const html = E.renderBody(SCH, 't', cxFor(E.hydrate(SCH, {})));
  assert.ok(html.indexOf('data-edit-sheet="sheetColors"') !== -1, 'opens its sheet');
  assert.ok(html.indexOf('Graph colors') !== -1, 'shows its label');
  assert.ok(html.indexOf('Pick the graph colors.') !== -1, 'shows its hint');
  assert.equal(html.split('data-k=').length - 1, 1, 'only the sibling toggle has a key');
  assert.equal(html.indexOf('aria-label="Edit settings'), -1, 'it is a row, not the per-value pencil chip');
  // Same chevron as a button row, coloured by the shared .chev rule (var(--link)) so it
  // follows the light theme instead of being frozen at the dark link colour.
  assert.ok(html.indexOf('<span class="chev">&#9656;</span>') !== -1, 'class-based chevron');
  assert.equal(html.indexOf('#FF6A52'), -1, 'no hard-coded link colour');
});

test('type:sheet falls back to editSheetFrom, and renders nothing when nothing resolves', () => {
  const VIA_RESOLVER = sheetTriggerSchema({ type: 'sheet', label: 'Wind',
    editSheetFrom: { resolver: 'slotSheet', args: { slotKey: 'slot' } } });
  const S = E.hydrate(VIA_RESOLVER, { slot: 'wind' });
  assert.ok(E.renderBody(VIA_RESOLVER, 't', cxFor(S)).indexOf('data-edit-sheet="sheetWind"') !== -1,
    'the resolver supplies the sheet id when the item names none');
  const S2 = E.hydrate(VIA_RESOLVER, { slot: 'time' });
  assert.equal(E.renderBody(VIA_RESOLVER, 't', cxFor(S2)).indexOf('data-edit-sheet'), -1,
    'resolver returns null -> no row');
  const BARE = sheetTriggerSchema({ type: 'sheet', label: 'Nowhere' });
  const bare = E.renderBody(BARE, 't', cxFor(E.hydrate(BARE, {})));
  assert.equal(bare.indexOf('Nowhere'), -1, 'no sheet id and no resolver -> no row');
  assert.ok(bare.indexOf('data-k="flag"') !== -1, 'the rest of the section still renders');
});

test('type:sheet WITH a badge renders as a preview + Edit row, not a chevron row', () => {
  // The per-metric graph-colour rows: no control to pick, just the colours they hold
  // and the way in. The row has no messageKey, so its identity rides editBadgeFrom.args.
  global.PConf.badgeResolvers.register('scopeBadge', function (S, env, args) {
    return { label: 'Edit', dots: [{ color: '#55AAFF' }, { color: '#0055AA', ring: true }] };
  });
  const BADGED = sheetTriggerSchema({ type: 'sheet', sheetId: 'sheetColors',
    label: 'Wind speed', editBadgeFrom: { resolver: 'scopeBadge', args: { scope: 'wind' } } });
  const html = E.renderBody(BADGED, 't', cxFor(E.hydrate(BADGED, {})));
  assert.ok(html.indexOf('<div class="rgt has-pen">') !== -1, 'the swatch+Edit control cell');
  assert.ok(html.indexOf('data-edit-sheet="sheetColors"') !== -1, 'the Edit button opens the sheet');
  assert.ok(html.indexOf('thr-btn') !== -1, 'rendered as the shared Edit button');
  assert.equal(html.split('pen-dot').length - 1, 2, 'both badge dots rendered');
  assert.equal(html.indexOf('chev'), -1, 'a badged sheet row is NOT a chevron row');
  assert.ok(html.indexOf('Wind speed') !== -1, 'the label still shows');
  // renderControl has no case for 'sheet', so the cell between swatch and button is empty.
  assert.ok(/thr-swatch[\s\S]*?<\/span><button type="button" class="thr-btn"/.test(html),
    'nothing is drawn between the swatch and the Edit button');

  // Same item without the badge stays the chevron row it has always been.
  const PLAIN = sheetTriggerSchema({ type: 'sheet', sheetId: 'sheetColors', label: 'Wind speed' });
  const plain = E.renderBody(PLAIN, 't', cxFor(E.hydrate(PLAIN, {})));
  assert.ok(plain.indexOf('<span class="chev">&#9656;</span>') !== -1, 'still a chevron row');
  assert.equal(plain.indexOf('thr-btn'), -1, 'and no Edit button');
});

test('type:sheet honors showWhen like any other row', () => {
  const SCH = sheetTriggerSchema({ type: 'sheet', sheetId: 'sheetColors', label: 'Graph colors',
    showWhen: { env: 'color' } });
  const cx = cxFor(E.hydrate(SCH, {}));
  cx.evalCtx.env = { color: false };
  assert.equal(E.renderBody(SCH, 't', cx).indexOf('Graph colors'), -1, 'gated out on a b&w watch');
  cx.evalCtx.env = { color: true };
  assert.ok(E.renderBody(SCH, 't', cx).indexOf('Graph colors') !== -1, 'shown on a color watch');
});

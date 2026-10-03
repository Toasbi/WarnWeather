// src/pkjs/config-ui/test/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Shared dual-use modules must populate global.PConf before engine.js reads PConf.color/schemaWalk/showWhen.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const FIXTURE = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'select', messageKey: 'mode', defaultValue: 'a', options: [['A','a'],['B','b']] },
  { type: 'toggle', messageKey: 'flag', defaultValue: false, showWhen: { key: 'mode', eq: 'b' } },
  { type: 'color',  messageKey: 'tint', defaultValue: 0xFF0055 },
  { type: 'staticText' }
] } ] } ] };

test('hydrate: injected wins, defaults fill, color int default -> hex', () => {
  const S = E.hydrate(FIXTURE, { mode: 'b', tint: '#0055AA' });
  assert.equal(S.mode, 'b');
  assert.equal(S.tint, '#0055AA');
  const D = E.hydrate(FIXTURE, {});
  assert.equal(D.tint, '#FF0055');   // default int -> hex
  assert.equal(D.flag, false);
});

test('hydrate: defaultFrom resolves via the named defaults-resolver (env-aware); injected wins', () => {
  global.PConf.defaultsResolvers.register('fakeSlot', function (env, args) {
    return (env && env.hr) ? args.hi : args.lo;
  });
  const SCH = { tabs: [{ sections: [{ items: [
    { type: 'select', messageKey: 'slot', defaultFrom: { resolver: 'fakeSlot', args: { hi: 'H', lo: 'L' } },
      options: [['H', 'H'], ['L', 'L']] }
  ] }] }] };
  assert.equal(E.hydrate(SCH, {}, { hr: true }).slot, 'H');
  assert.equal(E.hydrate(SCH, {}, { hr: false }).slot, 'L');
  assert.equal(E.hydrate(SCH, {}, undefined).slot, 'L', 'no env -> base flavor');
  assert.equal(E.hydrate(SCH, { slot: 'H' }, { hr: false }).slot, 'H', 'injected still wins');
});

test('serialize: every messageKey incl. showWhen-hidden; staticText skipped; colors stay hex', () => {
  const out = E.serialize(FIXTURE, E.hydrate(FIXTURE, {}));
  ['mode','flag','tint'].forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(out, k), 'dropped ' + k));
  assert.equal(out.tint, '#FF0055');
});

// defaultFrom.sticky: false — a key whose default is resolved per watch stays OUT of the
// save blob while it holds that default, so the host keeps resolving it per watch instead
// of storing the saving watch's default as a pick.
test('serialize: a sticky:false defaultFrom key is omitted while it equals its env default', () => {
  global.PConf.defaultsResolvers.register('fakeLook', function (env) {
    return (env && env.color === false) ? 'outline' : 'fill';
  });
  global.PConf.defaultsResolvers.register('fakeTint', function (env) {
    return (env && env.color === false) ? 0xFFFFFF : 0xFF0055;
  });
  const SCH = { tabs: [{ sections: [{ items: [
    { type: 'segmented', messageKey: 'look', options: [['None', 'none'], ['Outline', 'outline'], ['Fill', 'fill']],
      defaultFrom: { resolver: 'fakeLook', sticky: false } },
    { type: 'color', messageKey: 'tint', defaultFrom: { resolver: 'fakeTint', sticky: false } },
    { type: 'segmented', messageKey: 'stuck', options: [['Outline', 'outline'], ['Fill', 'fill']],
      defaultFrom: { resolver: 'fakeLook' } }
  ] }] }] };
  const COLOUR = { color: true };
  const BW = { color: false };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Untouched: hydrate fills the resolved default into S, serialize leaves it out
  // (the colour default compares in the page's '#RRGGBB' shape).
  const S = E.hydrate(SCH, {}, COLOUR);
  assert.equal(S.look, 'fill', 'the page still shows the default');
  assert.equal(S.tint, '#FF0055');
  const fresh = E.serialize(SCH, S, COLOUR);
  assert.ok(!has(fresh, 'look'), 'a default look is not saved');
  assert.ok(!has(fresh, 'tint'), 'a default colour is not saved');
  assert.equal(fresh.stuck, 'fill', 'a sticky defaultFrom key (the default) is still saved');

  // A pick that differs from the default is saved; one that equals it is not.
  S.look = 'outline';
  S.tint = '#00AAFF';
  assert.equal(E.serialize(SCH, S, COLOUR).look, 'outline', 'a non-default pick is saved');
  assert.equal(E.serialize(SCH, S, COLOUR).tint, '#00AAFF');
  S.look = 'fill';
  assert.ok(!has(E.serialize(SCH, S, COLOUR), 'look'), 'picking the default back is not saved');

  // "Default" is the env's: the same value is a pick on a watch whose default differs.
  assert.equal(E.serialize(SCH, S, BW).look, 'fill', 'fill is a pick on the B&W watch');
  const bw = E.hydrate(SCH, {}, BW);
  assert.equal(bw.look, 'outline');
  assert.ok(!has(E.serialize(SCH, bw, BW), 'look'), 'the B&W default is not saved either');

  // A stored value equal to the default (saved before the key went non-sticky) is
  // dropped by the next save, so the key resolves per watch from then on.
  assert.ok(!has(E.serialize(SCH, E.hydrate(SCH, { look: 'fill' }, COLOUR), COLOUR), 'look'));
  assert.equal(E.serialize(SCH, E.hydrate(SCH, { look: 'none' }, COLOUR), COLOUR).look, 'none',
    'a stored pick survives the round trip');
});

test('blocks registry: register/get; unknown id -> undefined', () => {
  E.blocks.register('demo', (state) => '<b>' + state.mode + '</b>');
  assert.equal(typeof E.blocks.get('demo'), 'function');
  assert.equal(E.blocks.get('nope'), undefined);
});

test('optionsResolvers registry: register/get; unknown id -> undefined', () => {
  PConf.optionsResolvers.register('demo', function (S) { return [['Demo', S.mode]]; });
  assert.equal(typeof PConf.optionsResolvers.get('demo'), 'function');
  assert.equal(PConf.optionsResolvers.get('nope'), undefined);
});

test('hooks registry: onLoad/onSubmit run with ctx', () => {
  let loaded = false, submitted = false;
  E.hooks.onLoad(() => { loaded = true; });
  E.hooks.onSubmit(() => { submitted = true; });
  E.hooks.runLoad({}); E.hooks.runSubmit({});
  assert.ok(loaded && submitted);
});

test('esc: escapes the five HTML-significant characters', () => {
  assert.equal(E.esc('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
});

test('renderControl: toggle on/off, segmented selection, select selected option', () => {
  assert.ok(E.renderControl({ type: 'toggle', messageKey: 'flag' }, { value: true }).indexOf('sw on') >= 0);
  assert.equal(E.renderControl({ type: 'toggle', messageKey: 'flag' }, { value: false }).indexOf(' on') , -1);
  const seg = E.renderControl({ type: 'segmented', messageKey: 'mode', options: [['A','a'],['B','b']] }, { value: 'b' });
  assert.ok(seg.indexOf('<div class="seg">') === 0, 'segmented wraps in .seg');
  assert.ok(seg.indexOf('class="on" data-k="mode" data-v="b"') >= 0, 'selected pill marked on');
  assert.ok(seg.indexOf('class="" data-k="mode" data-v="a"') >= 0, 'unselected pill not on');
  const sel = E.renderControl({ type: 'select', messageKey: 'mode', label: 'Mode', options: [['A','a'],['B','b']] }, { value: 'a', openSelect: null });
  assert.ok(sel.indexOf('class="sel-wrap" data-select="mode"') >= 0, 'select renders the shared trigger button');
  assert.ok(sel.indexOf('<span>A</span>') >= 0, 'trigger shows the current value label');
  assert.equal(sel.indexOf('<option'), -1, 'no native <option> markup');
});

test('renderControl: text value and color display are HTML-escaped', () => {
  const txt = E.renderControl({ type: 'text', messageKey: 'q' }, { value: '"><b>' });
  assert.equal(txt.indexOf('"><b>'), -1, 'raw injection must not survive');
  assert.ok(txt.indexOf('&quot;&gt;&lt;b&gt;') >= 0);
  const col = E.renderControl({ type: 'color', messageKey: 'tint' }, { value: '#FF0055', openColor: null });
  assert.ok(col.indexOf('#FF0055') >= 0 && col.indexOf('sw-wrap') >= 0);
});

test('renderControl text: suffixAction adds an inline action button + result line', () => {
  const plain = E.renderControl({ type: 'text', messageKey: 'q' }, { value: 'x' });
  assert.equal(plain.indexOf('txt-act'), -1, 'no wrapper without suffixAction');

  const withBtn = E.renderControl(
    { type: 'text', messageKey: 'owmApiKey', suffixAction: 'testOwmKey', suffixLabel: 'Test' },
    { value: 'abc' }
  );
  assert.ok(withBtn.indexOf('class="txt-act"') >= 0, 'wraps input + button');
  assert.ok(withBtn.indexOf('data-action="testOwmKey"') >= 0, 'button dispatches the action');
  assert.ok(withBtn.indexOf('>Test<') >= 0, 'uses suffixLabel');
  assert.ok(withBtn.indexOf('data-action-result="owmApiKey"') >= 0, 'has a result line keyed by messageKey');
  assert.ok(withBtn.indexOf('data-k="owmApiKey"') >= 0, 'still renders the input');
});

test('renderControl color: excludeColors drops swatches from the open palette only', () => {
  const open = (item) => E.renderControl(item, { value: '#FF0055', openColor: 'tint' });
  // By default every picker offers white.
  assert.ok(open({ type: 'color', messageKey: 'tint' }).indexOf('data-color-pick="#FFFFFF"') >= 0,
    'white swatch should be present by default');
  // excludeColors removes the listed swatch but keeps the rest.
  const filtered = open({ type: 'color', messageKey: 'tint', excludeColors: ['#FFFFFF'] });
  assert.equal(filtered.indexOf('data-color-pick="#FFFFFF"'), -1, 'white swatch must be excluded');
  assert.ok(filtered.indexOf('data-color-pick="#FF0055"') >= 0, 'other swatches remain');
});

test('renderControl color: every picker offers all 64', () => {
  const full = E.renderControl({ type: 'color', messageKey: 'tint' }, { value: '#FF0055', openColor: 'tint' });
  assert.equal(full.split('data-color-pick=').length - 1, 64, 'the shared PALETTE is untouched');
});

test('renderRow: stacked for text/radio/open-color, wrap when multi-line hinted, inline otherwise; hintByValue wins', () => {
  // Rows with a multi-line (long) hint use the wrap layout (control floated right,
  // hint flows around it).
  const longHint = 'A hint long enough to span more than one row of text in the settings page.';
  const wrapped = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'Flag', hint: longHint }, { value: false });
  assert.ok(wrapped.indexOf('class="row wrap"') >= 0 && wrapped.indexOf('lft') === -1);
  // Short one-line hints and un-hinted rows keep the two-column flex layout.
  const shortHinted = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'Flag', hint: 'h' }, { value: false });
  assert.ok(shortHinted.indexOf('class="row"') >= 0 && shortHinted.indexOf('lft') >= 0);
  const inline = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'Flag' }, { value: false });
  assert.ok(inline.indexOf('class="row"') >= 0 && inline.indexOf('lft') >= 0);
  const stacked = E.renderRow({ type: 'text', messageKey: 'q', label: 'Q' }, { value: '' });
  assert.ok(stacked.indexOf('class="row stack"') >= 0);
  // A wide segmented control (4+ options) uses the .segwide layout: control stays on the
  // label's line (label in .lft wraps into the leftover width), hint on its own line below.
  const wideSeg = E.renderRow({ type: 'segmented', messageKey: 'reset', label: 'Reset',
    hint: longHint, options: [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']] }, { value: '2' });
  assert.ok(wideSeg.indexOf('class="row segwide"') >= 0 && wideSeg.indexOf('wrap') === -1);
  assert.ok(wideSeg.indexOf('<div class="lft">') >= 0 && wideSeg.indexOf('class="hint"') >= 0);
  // A narrow segmented control (2-3 options) keeps the float/inline layouts.
  const narrowSeg = E.renderRow({ type: 'segmented', messageKey: 'm', label: 'M',
    hint: longHint, options: [['A', 'a'], ['B', 'b']] }, { value: 'a' });
  assert.ok(narrowSeg.indexOf('class="row wrap"') >= 0 && narrowSeg.indexOf('segwide') === -1);
  const byVal = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'F', hint: 'base', hintByValue: { 'on': 'special' } }, { value: 'on' });
  assert.ok(byVal.indexOf('special') >= 0 && byVal.indexOf('base') === -1);
});

test('renderTabBar/renderBody: env-hidden tab produces no button and no body', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [
    { id: 'general', label: 'General', sections: [{ items: [{ type: 'toggle', messageKey: 'a', label: 'A' }] }] },
    { id: 'health', label: 'Health', showWhen: { env: 'health' },
      sections: [{ items: [{ type: 'toggle', messageKey: 'h', label: 'H' }] }] }
  ] };
  const mkCx = (health) => ({ S: E.hydrate(SCH, {}), ENV: { health }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { health } }) });

  // Hidden (aplite): no Health tab button, and no body even if it is forced active.
  const barHidden = E.renderTabBar(SCH, 'general', mkCx(false));
  assert.ok(barHidden.indexOf('data-tab="general"') >= 0, 'General tab present');
  assert.equal(barHidden.indexOf('data-tab="health"'), -1, 'Health tab button hidden when env.health is false');
  assert.equal(E.renderBody(SCH, 'health', mkCx(false)).indexOf('data-k="h"'), -1, 'hidden tab renders no body');

  // Visible (color platform): Health tab button present.
  assert.ok(E.renderTabBar(SCH, 'general', mkCx(true)).indexOf('data-tab="health"') >= 0,
    'Health tab button shown when env.health is true');
});

test('renderBody: only active tab, showWhen hides items, version footer present', () => {
  const cx = { S: E.hydrate(FIXTURE, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(FIXTURE, {}), { env: { color: true } }) };
  const html = E.renderBody(FIXTURE, 't', cx);
  assert.ok(html.indexOf('data-select="mode"') >= 0, 'visible select rendered');
  assert.equal(html.indexOf('data-toggle'), -1, 'flag hidden because mode!=b');
  assert.ok(html.indexOf('<div class="version">v0</div>') >= 0);
});

test('renderBody: consecutive inline-grouped items share one row with no internal divider', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'from', label: 'From', defaultValue: '22', options: [['22:00','22'],['07:00','7']], inline: 'sleep' },
    { type: 'select', messageKey: 'to',   label: 'To',   defaultValue: '7',  options: [['22:00','22'],['07:00','7']], inline: 'sleep' }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('data-select="from"') >= 0 && html.indexOf('data-select="to"') >= 0, 'both selects rendered');
  const rows = html.match(/class="row inline"/g) || [];
  assert.equal(rows.length, 1, 'exactly one combined inline row wraps the pair');
  assert.equal(html.indexOf('class="row"><div class="lft"'), -1, 'neither member rendered as its own standalone row');
  assert.ok(html.indexOf('>From<') >= 0 && html.indexOf('>To<') >= 0, 'both labels present');
});

test('renderBody: inline group with all members hidden renders no row and suppresses the empty card', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'Gone', items: [
    { type: 'select', messageKey: 'from', label: 'From', defaultValue: '22', options: [['a','22']], inline: 'sleep', showWhen: { key: 'never', eq: 'yes' } },
    { type: 'select', messageKey: 'to',   label: 'To',   defaultValue: '7',  options: [['a','7']],  inline: 'sleep', showWhen: { key: 'never', eq: 'yes' } }
  ] } ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(SCH, 't', cx);
  assert.equal(html.indexOf('class="row inline"'), -1, 'no inline row when all members hidden');
  assert.equal(html.indexOf('Gone'), -1, 'card with only hidden inline items omitted');
});

test('renderBody: joinPrevious strips the divider of the preceding visible row when the group shows', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'toggle', messageKey: 'en', label: 'Enable', defaultValue: true },
    { type: 'select', messageKey: 'from', label: 'From', defaultValue: 'a', options: [['A','a']], inline: 'g', joinPrevious: true, showWhen: { key: 'en', eq: true } },
    { type: 'select', messageKey: 'to',   label: 'To',   defaultValue: 'b', options: [['B','b']], inline: 'g', showWhen: { key: 'en', eq: true } },
    { type: 'toggle', messageKey: 'tail', label: 'Tail', defaultValue: false }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('data-k="en"') >= 0 && html.indexOf('class="row nb"') >= 0, 'toggle row loses its divider above the group');
  assert.ok(html.indexOf('class="row inline"') >= 0, 'group still renders (and keeps its own divider, since Tail does not join)');
});

test('renderBody: joinPrevious does NOT strip the divider when the joining group is hidden', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'toggle', messageKey: 'en', label: 'Enable', defaultValue: false },
    { type: 'select', messageKey: 'from', label: 'From', defaultValue: 'a', options: [['A','a']], inline: 'g', joinPrevious: true, showWhen: { key: 'en', eq: true } },
    { type: 'toggle', messageKey: 'tail', label: 'Tail', defaultValue: false }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.equal(html.indexOf('class="row inline"'), -1, 'hidden group not rendered');
  assert.equal(html.indexOf('class="row nb"'), -1, 'preceding toggle keeps its divider when nothing joins it');
});

test('renderBody: a chain of consecutive joinPrevious rows collapses every divider between them', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: true },
    { type: 'toggle', messageKey: 'b', label: 'B', defaultValue: true, joinPrevious: true },
    { type: 'toggle', messageKey: 'c', label: 'C', defaultValue: true, joinPrevious: true },
    { type: 'toggle', messageKey: 'd', label: 'D', defaultValue: true }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  // A and B drop their divider (B and C join upward); C keeps its divider (D does not join).
  const nb = (html.match(/class="row nb"/g) || []).length;
  assert.equal(nb, 2, 'exactly the two rows preceding a joiner lose their divider');
  // sanity: order is A(nb) B(nb) C(divider) D(divider)
  assert.ok(/data-k="a"[\s\S]*data-k="b"[\s\S]*data-k="c"[\s\S]*data-k="d"/.test(html));
});

test("renderBody: a loose joinPrevious drops the divider via nbl, not the tight nb", () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'text',   messageKey: 'key', label: 'Key', defaultValue: '' },
    { type: 'toggle', messageKey: 'opt', label: 'Opt', defaultValue: true, joinPrevious: 'loose' }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  // The Key row (stacked text) drops its divider with the roomy nbl class — never the tight nb.
  assert.ok(/class="row stack nbl"/.test(html), 'preceding row uses the loose no-divider class');
  assert.equal((html.match(/\bnb\b/g) || []).length, 0, 'a loose join emits no tight nb class');
});

test("renderBody: a loose joinPrevious staticText groups without the .join pull-up", () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: true },
    { type: 'staticText', joinPrevious: 'loose', text: 'note' }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(/class="row nbl"/.test(html), 'the control above drops its divider (loose)');
  assert.equal(html.indexOf('static join'), -1, 'a loose static gets no tight pull-up (.join)');
});

test('renderBody: joinPrevious look-ahead skips hidden items (mutually-exclusive showWhen chain)', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'segmented', messageKey: 'mode', label: 'Mode', defaultValue: 'w', options: [['P','p'],['W','w']] },
    { type: 'toggle', messageKey: 'pOpt', label: 'P opt', defaultValue: true, joinPrevious: true, showWhen: { key: 'mode', eq: 'p' } },
    { type: 'toggle', messageKey: 'wOpt', label: 'W opt', defaultValue: true, joinPrevious: true, showWhen: { key: 'mode', eq: 'w' } },
    { type: 'toggle', messageKey: 'tail', label: 'Tail', defaultValue: false }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);   // mode=w: pOpt hidden, wOpt shown & joins Mode
  assert.ok(html.indexOf('data-k="pOpt"') === -1, 'precip option hidden');
  assert.ok(html.indexOf('data-k="wOpt"') >= 0, 'wind option shown');
  const modeRow = html.slice(html.lastIndexOf('class="row', html.indexOf('data-k="mode"')), html.indexOf('data-k="mode"'));
  assert.ok(/\bnb\b/.test(modeRow), 'Mode drops its divider because the next VISIBLE item (wOpt) joins, skipping hidden pOpt');
});

// A `subheader` ITEM opens a new group and draws the separating line itself
// (.subhdr.grp's border-top), because its group can render NO rows at all when its
// master switch is off — there is then no last-row divider to borrow, and the next
// group used to run straight into it. So the look-ahead reports a LOOSE join for a
// sub-header: the row above drops its own divider (no two stacked 1px lines) and
// keeps its normal padding.
// Sub-headers draw in-card only inside a groupCard-merged body now (a standalone section
// splits into one card per sub-header — see the next test), so the rule is pinned there.
const SUBHDR_ITEMS = [
  { type: 'toggle', messageKey: 'lead', label: 'Lead', defaultValue: false },
  { type: 'subheader', text: 'Grp', toggleKey: 'grpOn' },
  { type: 'toggle', messageKey: 'grpOn', label: 'Grp', defaultValue: false },
  { type: 'toggle', messageKey: 'dep', label: 'Dep', defaultValue: false, showWhen: { key: 'grpOn', eq: true } },
  { type: 'subheader', text: 'Next' },
  { type: 'toggle', messageKey: 'tail', label: 'Tail', defaultValue: false }
];

test('renderBody: a subheader item makes the row above it divider-less, loosely', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { groupCard: 'g', title: 'S', items: SUBHDR_ITEMS } ] } ] };
  const render = (over) => {
    const S = Object.assign(E.hydrate(SCH, {}), over || {});
    return E.renderBody(SCH, 't', { S: S, ENV: { color: true }, USERDATA: {}, openColor: null,
      collapsed: {}, evalCtx: Object.assign({}, S, { env: { color: true } }) });
  };
  const rowClass = (html, key) => {
    const at = html.indexOf('data-k="' + key + '"');
    return /class="(row[^"]*)"/.exec(html.slice(html.lastIndexOf('<div class="row', at), at))[1];
  };

  // Switch off: the group contributes no rows at all, so the two sub-headers are
  // adjacent — the second one's own line is the ONLY thing separating them.
  const off = render({ grpOn: false });
  assert.equal(off.indexOf('data-k="dep"'), -1, 'the dependent row is hidden');
  assert.match(off, /class="subhdr grp"[\s\S]*?Grp[\s\S]*?class="subhdr grp"[\s\S]*?Next/);
  assert.equal(rowClass(off, 'lead'), 'row nbl',
    'the row above a sub-header drops its divider loosely, even with the group collapsed');

  // Switched on: the group's own row now ends it, and it too goes divider-less so the
  // next sub-header's line is the only one.
  const on = render({ grpOn: true, dep: true });
  assert.equal(rowClass(on, 'dep'), 'row nbl', 'the last row of an expanded group joins loosely too');
  assert.equal((on.match(/\bnb\b/g) || []).length, 0, 'a sub-header never pulls a row up tight');
});

// Outside a groupCard a sub-header no longer draws in-card: it opens a card of its own,
// titled by its text, with its hosted switch in that card's header. The row above it is
// then the last row of ITS card and keeps its plain class, and a card whose rows are all
// gated off survives only because its header hosts the master switch.
test('renderBody: in a standalone section each subheader opens a card of its own', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { title: 'S', items: SUBHDR_ITEMS } ] } ] };
  const render = (over) => {
    const S = Object.assign(E.hydrate(SCH, {}), over || {});
    return E.renderBody(SCH, 't', { S: S, ENV: { color: true }, USERDATA: {}, openColor: null,
      collapsed: {}, evalCtx: Object.assign({}, S, { env: { color: true } }) });
  };
  const off = render({ grpOn: false });
  assert.equal((off.match(/<div class="card[ "]/g) || []).length, 3, 'S, Grp and Next are three cards');
  assert.equal(off.indexOf('subhdr'), -1, 'no in-card sub-header');
  assert.match(off, /<div class="cardHdr"><span class="ttlwrap"><span class="ttl">Grp<\/span><\/span><button class="sw" data-k="grpOn" data-toggle="1" aria-label="Grp">/,
    'the hosted switch rides the Grp card header, even with every row of that card hidden');
  assert.match(off, /<span class="ttl">S<\/span>[\s\S]*?data-k="lead"[\s\S]*?<span class="ttl">Grp<\/span>[\s\S]*?<span class="ttl">Next<\/span>[\s\S]*?data-k="tail"/,
    'the cards keep the item order');
  assert.match(off, /<div class="row"><div class="lft"><div class="lbl">Lead<\/div>/,
    'the last row of a card keeps its plain class');
  const on = render({ grpOn: true, dep: true });
  assert.match(on, /<span class="ttl">Grp<\/span>[\s\S]*?<div class="row"><div class="lft"><div class="lbl">Dep<\/div>[\s\S]*?<span class="ttl">Next<\/span>/,
    'the dependent row renders inside the Grp card, divider and all');
});

test('renderBody: groupCard merges consecutive sections into one card with in-card sub-headers', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { groupCard: 'g', intro: 'Lead-in text.', items: [] },
    { groupCard: 'g', title: 'First Bar', items: [ { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: true } ] },
    { groupCard: 'g', title: 'Gated Bar', items: [ { type: 'toggle', messageKey: 'b', label: 'B', defaultValue: true, showWhen: { key: 'never', eq: 'yes' } } ] },
    { groupCard: 'g', title: 'Last Bar', items: [ { type: 'toggle', messageKey: 'c', label: 'C', defaultValue: true } ] },
    { title: 'Standalone', items: [ { type: 'toggle', messageKey: 'd', label: 'D', defaultValue: true } ] }
  ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  // Two card containers: the merged group + the standalone section. (`card[ "]`, so a
  // standalone card's <div class="cardHdr"> header is not counted as a card of its own.)
  assert.equal((html.match(/<div class="card[ "]/g) || []).length, 2, 'the four grouped sections collapse to one card beside the standalone');
  assert.ok(html.indexOf('Lead-in text.') >= 0, 'group intro rides the top of the merged card');
  // Grouped titles render as in-card sub-headers, never as their own card headers.
  assert.ok(html.indexOf('class="subhdr">First Bar</div>') >= 0, 'first bar title is a sub-header');
  assert.ok(html.indexOf('class="subhdr">Last Bar</div>') >= 0, 'last bar title is a sub-header');
  assert.equal(html.indexOf('class="ttl">First Bar'), -1, 'grouped title is not a card header');
  // A fully gated-off sub-section drops out entirely — sub-header and all.
  assert.equal(html.indexOf('Gated Bar'), -1, 'empty sub-section omitted, its sub-header included');
  // The ungrouped section keeps its own card header.
  assert.ok(html.indexOf('class="ttl">Standalone</span>') >= 0, 'standalone section keeps a normal card header');
});

test('initialCollapsed: collapsible sections seeded collapsed, non-collapsible absent', () => {
  const SCH = { tabs: [ { id: 't', sections: [
    { id: 'a', collapsible: true, items: [] },
    { id: 'b', items: [] },
    { title: 'C', collapsible: true, items: [] }
  ] } ] };
  const m = E.initialCollapsed(SCH);
  assert.equal(m.a, true, 'collapsible by id seeded');
  assert.equal(m.C, true, 'collapsible by title seeded');
  assert.ok(!('b' in m), 'non-collapsible section not seeded');
});

test('renderBody: a collapsible section seeded by initialCollapsed renders collapsed', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { id: 'adv', title: 'Advanced', collapsible: true, items: [ { type: 'toggle', messageKey: 'x', defaultValue: false } ] }
  ] } ] };
  const collapsed = E.initialCollapsed(SCH);
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: collapsed,
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('Advanced') >= 0, 'header still shown');
  assert.equal(html.indexOf('data-toggle'), -1, 'collapsed: inner controls not rendered');
  assert.ok(html.indexOf('&#9656;') >= 0 && html.indexOf('&#9662;') === -1, 'collapsed (right) chevron, not expanded (down)');
});

test('renderBody: a joinPrevious staticText carries the join class so it hugs the control above', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: true },
    { type: 'staticText', joinPrevious: true, text: 'note' }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('class="static join"') >= 0, 'joined static carries the join class');
  assert.ok(html.indexOf('class="row nb"') >= 0, 'preceding control row drops its divider');
});

test('renderBody: a standalone (non-joined) staticText has no join class', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'staticText', text: 'standalone' }
  ] } ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('class="static"') >= 0, 'plain static class');
  assert.equal(html.indexOf('join'), -1, 'no join modifier when not joined');
});

test('renderBody: a hinted staticText carries the hinted class (hint style) but not join (no pull-up)', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'staticText', hinted: true, text: 'note' }
  ] } ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('class="static hinted"') >= 0, 'hinted static carries the hinted class');
  assert.equal(html.indexOf('join'), -1, 'hinted does not imply join (no spacing pull-up)');
});

// style: 'info' boxes a note like the General tab's fetch-notice items (the tinted,
// left-ruled .notice-item) in the page's info amber — for a pointer the reader should
// not skim past as body copy.
test('renderBody: a staticText with style info renders boxed, with its own class', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'staticText', style: 'info', text: 'Set <b>elsewhere</b>.' },
    { type: 'staticText', text: 'plain' }
  ] } ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('<div class="static info"><div class="info-box">Set <b>elsewhere</b>.</div></div>') >= 0,
    'the note is wrapped in the info box, its HTML verbatim');
  assert.ok(html.indexOf('<div class="static">plain</div>') >= 0, 'a plain static is unboxed');
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  const rule = shell.match(/\.static\.info \.info-box \{([^}]*)\}/);
  assert.ok(rule, 'shell.html styles the box');
  // The amber comes from two theme variables the notice panel's info item shares
  // (test/notices-panel.test.js pins that side). The text colour is explicit: a
  // tight-joined box would otherwise take the hint grey, too faint on the dark amber.
  ['background: var(--info-tint)', 'border-left: 3px solid var(--info-rule)', 'border-radius: 6px',
    'color: var(--static)']
    .forEach((decl) => assert.ok(rule[1].indexOf(decl) !== -1, 'box carries ' + decl));
});

test('shell.html defines the info amber for both themes', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  const dark = /\n  body \{([^}]*)\}/.exec(shell);
  const light = /\n  body\.light \{([^}]*)\}/.exec(shell);
  assert.ok(dark && light, 'the body and body.light variable blocks');
  // Measured against --card: dark rule 6.1:1 (text 6.0:1); light rule 3.65:1, over the
  // 3:1 non-text minimum (text ~8.6:1).
  assert.match(dark[1], /--info-rule: #FFB02E;/);
  assert.match(dark[1], /--info-tint: rgba\(255,176,46,0\.12\);/);
  assert.match(light[1], /--info-rule: #B86E00;/);
  assert.match(light[1], /--info-tint: rgba\(217,142,4,0\.12\);/);
  assert.equal(/5A8CFF|90,140,255/i.test(shell), false, 'no info blue is left');
});

// An info box stands 14px off whatever sits above and below it, joined or not (measured in
// headless Chrome: the slot sheets' pointer, the key notes, the boxes under an intro).
// Each rule tops up the padding of the rule it pairs with to the page's 14px row padding.
test('shell.html: an info box keeps the row standoff on both sides, whatever joins it', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  [
    /\.static\.info\.join\s*\{\s*margin-top:\s*0;\s*padding-top:\s*9px;\s*\}/,   // tight join: + .row.nb's 5px
    /\.static\.info\.nb\s*\{\s*padding-bottom:\s*9px;\s*\}/,                      // a row tight-joined below: + its 5px
    /\.intro\s*\+\s*\.static\.info\s*\{\s*padding-top:\s*2px;\s*\}/,               // under an intro: + its 12px
    /\.row\.nbl\s*\+\s*\.static\.info\s*\{\s*padding-top:\s*0;\s*\}/,              // loose-joined under a row
    /\.static\.info\.nbl\s*\+\s*\.row\s*\{\s*padding-top:\s*0;\s*\}/                // a row loose-joined below
  ].forEach((re) => assert.match(shell, re));
  // The paddings those rules complete to 14px.
  assert.match(shell, /\.row\.nb, \.static\.nb \{ padding-bottom: 5px; \}/);
  assert.match(shell, /\.row\.nb \+ \.row, \.static\.nb \+ \.row \{ padding-top: 5px; \}/);
  assert.match(shell, /\.intro \{ padding: 2px 16px 12px;/);
  assert.match(shell, /\.static \{ padding: 14px 16px;/);
  assert.match(shell, /\.row \{[^}]*padding: 14px 16px;/);
  assert.doesNotMatch(shell, /\S:has\(/, 'adjacent siblings only: no :has() for old webviews');
});

test('shell.html: a toggle\'s switch is its cell\'s whole line (no strut under it)', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  assert.match(shell, /\.row \.rgt > \.sw\s*\{\s*vertical-align:\s*top;\s*\}/);
});

test('shell.html: an icon run in a hint never breaks inside', () => {
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  assert.match(shell, /\.ico-run\s*\{\s*display:\s*inline-block;\s*white-space:\s*nowrap;\s*margin-right:\s*12px;\s*\}/);
  assert.match(shell, /\.ico-run \.lbl-ico\s*\{\s*margin-right:\s*4px;\s*\}/);
});

test('shell.html: a sheet\'s last row or note draws no divider at the sheet\'s bottom edge', () => {
  // A card drops it (.card .static:last-child); a sheet that ends on a note (the Quiet
  // time and Sleep sheets end on their Shows on note) does too.
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  assert.match(shell, /dialog#modal \.esheet \.row:last-child, dialog#modal \.esheet \.static:last-child\s*\{\s*border-bottom:\s*none;\s*\}/);
});

test('renderSelectModal: duplicate messageKey resolves the VISIBLE block (theme B&W regression)', () => {
  // Two items share messageKey 'theme': a 4-option color block and a 2-option B/W block,
  // mutually exclusive by showWhen (mirrors schema.js). The open picker must mirror whichever
  // block's trigger is visible for the platform — not just the last match in schema order.
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { items: [
    { type: 'select', messageKey: 'theme', label: 'Theme', defaultValue: 'dark',
      options: [['Dark','dark'],['Light','light'],['B&W','bw'],['B&W Inverted','bw-light']],
      showWhen: { env: 'color' } },
    { type: 'select', messageKey: 'theme', label: 'Theme', defaultValue: 'dark',
      options: [['Dark','dark'],['Light','light']],
      showWhen: { all: [ { not: { env: 'color' } }, { env: 'themePolarity' } ] } }
  ] } ] } ] };
  function modalPicks(env) {
    const S = E.hydrate(SCH, {}, env);
    const cx = { S: S, ENV: env, USERDATA: {}, openSelect: 'theme', selectQuery: '',
      collapsed: {}, evalCtx: Object.assign({}, S, { env: env }) };
    const html = E.renderSelectModal(SCH, cx);
    return (html.match(/data-select-pick="([^"]*)"/g) || []).map((s) => s.replace(/data-select-pick="|"/g, ''));
  }
  // Color platform (basalt/chalk/emery): the visible block is the 4-option one — B&W + B&W Inverted must appear.
  assert.deepEqual(modalPicks({ color: true, themePolarity: true }), ['dark', 'light', 'bw', 'bw-light']);
  // B/W platform with polarity (diorite/flint): the visible block is the 2-option one.
  assert.deepEqual(modalPicks({ color: false, themePolarity: true }), ['dark', 'light']);
});

test('resolveOptionsFrom: lowest option = interval, ladder above it, deduped + labeled', () => {
  const item = { optionsFrom: { interval: 'iv', ladder: [30, 60, 120, 360, 720, 1440] } };
  assert.deepEqual(E.resolveOptionsFrom(item, { iv: '5' }),
    [['5 minutes','5'],['30 minutes','30'],['1 hour','60'],['2 hours','120'],['6 hours','360'],['12 hours','720'],['1 day','1440']]);
  assert.deepEqual(E.resolveOptionsFrom(item, { iv: '30' }),
    [['30 minutes','30'],['1 hour','60'],['2 hours','120'],['6 hours','360'],['12 hours','720'],['1 day','1440']]);
  assert.deepEqual(E.resolveOptionsFrom(item, { iv: '60' }),
    [['1 hour','60'],['2 hours','120'],['6 hours','360'],['12 hours','720'],['1 day','1440']]);
});

test('resolveOptionsFrom: static options pass through; bad interval falls back to ladder[0]', () => {
  assert.deepEqual(E.resolveOptionsFrom({ options: [['A','a']] }, {}), [['A','a']]);
  const item = { optionsFrom: { interval: 'iv', ladder: [30, 60] } };
  assert.deepEqual(E.resolveOptionsFrom(item, { iv: undefined }), [['30 minutes','30'],['1 hour','60']]);
});

test('resolveOptionsFrom: byKey/map returns the selected key\'s list, [] when unmapped', () => {
  const map = { DE: [['Whole country', 'all'], ['Bavaria', 'DE-BY']], US: [['Whole country', 'all']] };
  const item = { optionsFrom: { byKey: 'country', map: map } };
  assert.deepEqual(E.resolveOptionsFrom(item, { country: 'DE' }), [['Whole country', 'all'], ['Bavaria', 'DE-BY']]);
  assert.deepEqual(E.resolveOptionsFrom(item, { country: 'US' }), [['Whole country', 'all']]);
  assert.deepEqual(E.resolveOptionsFrom(item, { country: 'FR' }), [], 'unmapped country -> empty');
});

test('resolveOptionsFrom: unregistered resolver name falls back to []', () => {
  assert.deepEqual(E.resolveOptionsFrom({ optionsFrom: { resolver: 'missing-resolver' } }, {}, {}), [],
    'unregistered resolver -> empty');
});

test('optionsFrom.resolver derives options via the registry (multi-key + env) and the display-snap still applies', () => {
  PConf.optionsResolvers.register('testResolver', function (S, env, args) {
    var opts = [['Empty', 'empty'], ['Alpha', 'a']];
    if (env && env.health) { opts.push(['Beta', 'b']); }
    if (S.other !== 'a') { return opts; }
    return opts.filter(function (o) { return o[1] !== 'a'; });
  });
  const item = { type: 'select', messageKey: 'k', defaultValue: 'empty',
    optionsFrom: { resolver: 'testResolver', args: {} } };

  // Direct call: env.health adds Beta; S.other !== 'a' keeps Alpha in the list.
  assert.deepEqual(E.resolveOptionsFrom(item, { other: 'x' }, { health: true }),
    [['Empty', 'empty'], ['Alpha', 'a'], ['Beta', 'b']]);

  // renderBody exercise: S.other='a' makes the resolver exclude 'a' from the derived
  // list, so the stored value 'a' is no longer offered and the existing display-snap
  // (resolveRowItem) must still fire, snapping it to the item's defaultValue.
  const schema = { appName: 'X', versionLabel: '', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [ item ] } ] } ] };
  const cx = { S: { other: 'a', k: 'a' }, ENV: { health: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: { other: 'a', k: 'a', env: { health: true } } };
  const html = E.renderBody(schema, 't', cx);
  assert.equal(cx.S.k, 'empty', 'stored value no longer among the derived options snaps to defaultValue');
  assert.ok(html.indexOf('<span>Empty</span>') >= 0, 'snapped label shown in the trigger');
  assert.equal(html.indexOf('value="a"'), -1, 'the excluded option is not rendered');
});

test('renderSelectModal materializes an optionsFrom select into pickable option rows (and has no search box)', () => {
  const schema = { appName: 'X', versionLabel: '', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'iv', defaultValue: '15', options: [['15 minutes','15']] },
    { type: 'select', messageKey: 'gpsCacheMin', label: 'GPS cache', defaultValue: '30', optionsFrom: { interval: 'iv', ladder: [30, 60, 1440] } }
  ] } ] } ] };
  const cx = { S: { iv: '15', gpsCacheMin: '30' }, ENV: { color: true }, USERDATA: {},
    openColor: null, openSelect: 'gpsCacheMin', selectQuery: '', collapsed: {},
    evalCtx: { iv: '15', gpsCacheMin: '30', env: { color: true } } };
  const html = E.renderSelectModal(schema, cx);
  assert.ok(html.indexOf('data-select-pick="30"') >= 0 && html.indexOf('30 minutes') >= 0);
  assert.ok(html.indexOf('data-select-pick="60"') >= 0 && html.indexOf('1 hour') >= 0);
  assert.ok(html.indexOf('data-select-pick="1440"') >= 0 && html.indexOf('1 day') >= 0);
  assert.equal(html.indexOf('data-select-search'), -1, 'plain select modal has no search box');
});

test('renderBody snaps an optionsFrom value no longer in the derived options to the first option', () => {
  const schema = { appName: 'X', versionLabel: '', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'iv', defaultValue: '15', options: [['60 minutes','60']] },
    { type: 'select', messageKey: 'gpsCacheMin', defaultValue: '30', optionsFrom: { interval: 'iv', ladder: [30, 60, 120, 360, 720, 1440] } }
  ] } ] } ] };
  // Stored gpsCacheMin '30' is below the now-raised interval (60), so it is no longer an option.
  const cx = { S: { iv: '60', gpsCacheMin: '30' }, ENV: { color: true }, USERDATA: {},
    openColor: null, collapsed: {}, evalCtx: { iv: '60', gpsCacheMin: '30', env: { color: true } } };
  const html = E.renderBody(schema, 't', cx);
  assert.equal(cx.S.gpsCacheMin, '60', 'stale value snapped to the first (lowest = interval) option');
  assert.ok(html.indexOf('<span>1 hour</span>') >= 0, 'snapped label shown in the trigger');
  assert.ok(html.indexOf('value="30"') < 0, 'the removed value is not rendered');
});

test('renderBody leaves an optionsFrom value untouched when it is still a valid option', () => {
  const schema = { appName: 'X', versionLabel: '', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'iv', defaultValue: '15', options: [['60 minutes','60']] },
    { type: 'select', messageKey: 'gpsCacheMin', defaultValue: '30', optionsFrom: { interval: 'iv', ladder: [30, 60, 120, 360, 720, 1440] } }
  ] } ] } ] };
  const cx = { S: { iv: '60', gpsCacheMin: '120' }, ENV: { color: true }, USERDATA: {},
    openColor: null, collapsed: {}, evalCtx: { iv: '60', gpsCacheMin: '120', env: { color: true } } };
  const html = E.renderBody(schema, 't', cx);
  assert.equal(cx.S.gpsCacheMin, '120', 'valid value is not snapped');
  assert.ok(html.indexOf('<span>2 hours</span>') >= 0, 'valid value label shown in the trigger');
});

test('renderBody applies optionsFrom to a searchSelect and snaps an invalid value to the first option', () => {
  const map = { DE: [['Whole country', 'all'], ['Bavaria', 'DE-BY']] };
  const schema = { appName: 'X', versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'searchSelect', messageKey: 'country', defaultValue: 'DE', options: [['Germany', 'DE'], ['France', 'FR']] },
    { type: 'searchSelect', messageKey: 'region', defaultValue: 'all', optionsFrom: { byKey: 'country', map: map } }
  ] }] }] };
  // region 'US-CA' is not valid for country 'DE' -> snaps to first option ('all').
  const cx = { S: { country: 'DE', region: 'US-CA' }, ENV: { color: true }, USERDATA: {},
    openColor: null, openSelect: null, selectQuery: '', collapsed: {},
    evalCtx: { country: 'DE', region: 'US-CA', env: { color: true } } };
  const html = E.renderBody(schema, 't', cx);
  assert.equal(cx.S.region, 'all', 'invalid region snapped to Whole country (proves optionsFrom fires for searchSelect)');
  assert.ok(html.indexOf('Whole country') >= 0, 'snapped label shown in the searchSelect trigger');
});

test('renderBody: empty section card is suppressed', () => {
  const EMPTY = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { title: 'Gone', items: [ { type: 'toggle', messageKey: 'x', defaultValue: false, showWhen: { key: 'never', eq: 'yes' } } ] }
  ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(EMPTY, 't', cx);
  assert.equal(html.indexOf('Gone'), -1, 'card with only hidden items is omitted');
});

test('renderBody: button and sheet rows share ONE chevron, coloured by class not a literal', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      { type: 'button', action: 'doIt', label: 'Do it', hint: 'Runs it.' },
      { type: 'sheet', sheetId: 'more', label: 'More' }
    ] },
    { sheetOnly: true, sheetId: 'more', title: 'More', items: [
      { type: 'toggle', messageKey: 'f', defaultValue: false } ] }
  ] }] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null,
    collapsed: {}, evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('data-action="doIt"') >= 0, 'the button row dispatches its action');
  assert.ok(html.indexOf('data-edit-sheet="more"') >= 0, 'the sheet row opens its sheet');
  // Both are nav rows now: the whole row is the way in, the › chevron on its right.
  assert.equal(html.split('<span class="chev">&#8250;</span>').length - 1, 2,
    'both rows emit the same class-based chevron');
  assert.equal((html.match(/<div class="row nav" data-(action|edit-sheet)="/g) || []).length, 2,
    'both render as the same nav-row shape');
  // A literal here is the light-theme bug: --link is #FF6A52 dark / #D93A24 light, and
  // only the .chev rule in shell.html follows the flip.
  assert.equal(html.indexOf('#FF6A52'), -1, 'no hard-coded link colour survives');
  assert.ok(html.indexOf('Runs it.') >= 0, 'the button row keeps its hint');
});

// item.icon: a registered PConf.icons fragment leads the label text inside .lbl on every
// row shape — a value row (select, toggle) through renderRow and a button/sheet row
// through chevronRow — and an unregistered id drops out without a trace.
const ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M1 1h2" stroke="currentColor"/></svg>';
const ICON_SPAN = '<div class="lbl"><span class="lbl-ico" aria-hidden="true">' + ICON_SVG + '</span>';

test('item.icon: a registered glyph leads the label on select, toggle and chevron rows', () => {
  global.PConf.icons.register('testDrop', ICON_SVG);
  const select = E.renderRow({ type: 'select', messageKey: 's', label: 'Rain countdown', icon: 'testDrop',
    options: [['30', '30'], ['60', '60']] }, { value: '60' });
  assert.ok(select.indexOf(ICON_SPAN + 'Rain countdown</div>') >= 0,
    'select row: the span sits right after <div class="lbl">, before the label text');
  const toggle = E.renderRow({ type: 'toggle', messageKey: 't', label: 'UV index', icon: 'testDrop' },
    { value: true });
  assert.ok(toggle.indexOf(ICON_SPAN + 'UV index</div>') >= 0, 'toggle row carries it too');
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      { type: 'button', action: 'doIt', label: 'Do it', icon: 'testDrop' },
      { type: 'sheet', sheetId: 'more', label: 'More', icon: 'testDrop' }
    ] },
    { sheetOnly: true, sheetId: 'more', title: 'More', items: [
      { type: 'toggle', messageKey: 'f', defaultValue: false } ] }
  ] }] };
  const S = E.hydrate(SCH, {});
  const html = E.renderBody(SCH, 't', { S: S, ENV: {}, USERDATA: {}, openColor: null,
    collapsed: {}, evalCtx: Object.assign({}, S, { env: {} }) });
  assert.ok(html.indexOf(ICON_SPAN + 'Do it</div>') >= 0, 'button chevron row');
  assert.ok(html.indexOf(ICON_SPAN + 'More</div>') >= 0, 'sheet chevron row');
});

test('item.icon: an unregistered id prints nothing; no icon field prints nothing', () => {
  const unknown = E.renderRow({ type: 'toggle', messageKey: 't', label: 'Flag', icon: 'noSuchIcon' },
    { value: false });
  assert.equal(unknown.indexOf('lbl-ico'), -1, 'no empty span for an unregistered id');
  assert.ok(unknown.indexOf('<div class="lbl">Flag</div>') >= 0, 'the label renders as before');
  const plain = E.renderRow({ type: 'toggle', messageKey: 't', label: 'Flag' }, { value: false });
  assert.equal(plain.indexOf('lbl-ico'), -1);
  // The label-less slider row keeps dropping its .lbl box entirely.
  const bare = E.renderRow({ type: 'toggle', messageKey: 't' }, { value: false });
  assert.equal(bare.indexOf('class="lbl"'), -1, 'no label, no action, no icon -> no box');
});

test('item.icon: the fragment is printed verbatim — the registry is trusted page markup', () => {
  // Unescaped like a block's HTML: the registry is fed by page code only (never by
  // settings or fetched data), so the engine prints what it was given. The <script>
  // case documents that trust boundary rather than endorsing it.
  global.PConf.icons.register('testRaw', '<svg><g data-x="a&b"></g></svg>');
  const raw = E.renderRow({ type: 'toggle', messageKey: 't', label: 'L', icon: 'testRaw' }, { value: false });
  assert.ok(raw.indexOf('<svg><g data-x="a&b"></g></svg>') >= 0, 'not HTML-escaped');
  assert.equal(raw.indexOf('&lt;svg'), -1);
  global.PConf.icons.register('testScript', '<svg></svg><script>x()</script>');
  const scripted = E.renderRow({ type: 'toggle', messageKey: 't', label: 'L', icon: 'testScript' },
    { value: false });
  assert.ok(scripted.indexOf('<svg></svg><script>x()</script>') >= 0,
    'a registered fragment is trusted as-is, <script> included');
});

test('renderSelectOptions: empty query lists all; current value flagged on', () => {
  const item = { messageKey: 'c', options: [['United States','US'],['Germany','DE'],['Spain','ES']] };
  const all = E.renderSelectOptions(item, 'DE', '');
  assert.ok(all.indexOf('>United States<') >= 0 && all.indexOf('>Germany<') >= 0 && all.indexOf('>Spain<') >= 0, 'all options present');
  assert.ok(all.indexOf('data-select-pick="DE"') >= 0 && all.indexOf('data-k="c"') >= 0, 'pick + key attrs');
  assert.ok(/class="ssel-opt on"[^>]*data-select-pick="DE"/.test(all), 'current value row is .on');
  assert.equal(/class="ssel-opt on"[^>]*data-select-pick="US"/.test(all), false, 'non-current row not .on');
});

test('renderSelectOptions renders meta.desc as a stacked description; plain options untouched', () => {
  const item = { messageKey: 'p', options: [['Met.no', 'metno', { desc: 'Best in the Nordics' }], ['Plain', 'plain']] };
  const html = E.renderSelectOptions(item, 'metno', '');
  assert.ok(html.indexOf('<span class="ssel-opt-name">Met.no</span>') >= 0, 'name wrapped in ssel-opt-name');
  assert.ok(html.indexOf('<span class="ssel-opt-desc">Best in the Nordics</span>') >= 0, 'desc line rendered under the name');
  assert.ok(html.indexOf('<span>Plain</span>') >= 0, 'option without a desc keeps the plain single-span layout');
  assert.equal(html.indexOf('ssel-opt-txt"><span class="ssel-opt-name">Plain'), -1, 'plain option is not wrapped in the desc layout');
});

test('select trigger uses meta.short for the collapsed label; the sheet keeps the full name', () => {
  const item = { type: 'select', messageKey: 'p', label: 'Provider',
    options: [['Deutscher Wetterdienst', 'dwd', { short: 'DWD' }], ['Met.no', 'metno']] };
  const trigger = E.renderControl(item, { value: 'dwd', openSelect: null });
  assert.ok(trigger.indexOf('<span>DWD</span>') >= 0, 'trigger shows the short label');
  assert.equal(trigger.indexOf('Deutscher Wetterdienst'), -1, 'trigger does not show the long full name');
  assert.ok(E.renderSelectOptions(item, 'dwd', '').indexOf('Deutscher Wetterdienst') >= 0, 'sheet keeps the full name');
  // An option without meta.short falls back to its full label in the trigger.
  assert.ok(E.renderControl(item, { value: 'metno', openSelect: null }).indexOf('<span>Met.no</span>') >= 0);
});

test('renderSelectOptions: a recommended value appends a bold (Recommended) marker to that option only', () => {
  const desc = { messageKey: 'p', options: [['Met.no', 'metno', { desc: 'd' }], ['Open-Meteo', 'openmeteo', { desc: 'd2' }]] };
  const hDesc = E.renderSelectOptions(desc, 'metno', '', 'openmeteo');
  assert.ok(hDesc.indexOf('Open-Meteo <b class="ssel-rec">(Recommended)</b></span>') >= 0, 'marker rides the recommended option name');
  assert.equal(hDesc.indexOf('Met.no <b class="ssel-rec">'), -1, 'non-recommended option gets no marker');
  // Plain (no-desc) layout marks the name too.
  const plain = { messageKey: 'p', options: [['DWD', 'dwd'], ['Off', 'disabled']] };
  assert.ok(E.renderSelectOptions(plain, 'disabled', '', 'dwd').indexOf('<span>DWD <b class="ssel-rec">(Recommended)</b></span>') >= 0);
  // No recommendation (or a value not in the list) → no marker anywhere.
  assert.equal(E.renderSelectOptions(plain, 'dwd', '').indexOf('ssel-rec'), -1, 'omitted recommended value adds no marker');
  assert.equal(E.renderSelectOptions(plain, 'dwd', '', 'nope').indexOf('ssel-rec'), -1, 'unmatched recommended value adds no marker');
});

test('renderSelectOptions: a parenthesised name moves the Recommended marker to the front of its desc line', () => {
  // "Foo (beta) (Recommended)" reads as a stutter: the marker leads the desc instead.
  const picker = { messageKey: 'r', options: [
    ['Foo (beta)', 'foo', { desc: 'First line' }],
    ['Bar (alpha)', 'bar', { desc: 'Second line' }],
    ['Baz', 'baz', { desc: 'Third line' }]
  ] };
  const h = E.renderSelectOptions(picker, 'baz', '', 'foo');
  assert.ok(h.indexOf('<span class="ssel-opt-name">Foo (beta)</span>'
    + '<span class="ssel-opt-desc"><b class="ssel-rec">Recommended</b> · First line</span>') >= 0, h);
  assert.equal(h.indexOf('(beta) <b'), -1, 'no "(beta) (Recommended)" stutter');
  assert.equal(h.split('ssel-rec').length - 1, 1, 'one marker, on the recommended option only');
  // An unparenthesised recommended name keeps the marker after the name, byte for byte.
  const d = E.renderSelectOptions(picker, 'foo', '', 'baz');
  assert.ok(d.indexOf('<span class="ssel-opt-name">Baz <b class="ssel-rec">(Recommended)</b></span>'
    + '<span class="ssel-opt-desc">Third line</span>') >= 0, d);
  // Without a desc line there is nowhere to move it: the name keeps it.
  const plain = { messageKey: 'p', options: [['Foo (beta)', 'foo']] };
  assert.ok(E.renderSelectOptions(plain, 'foo', '', 'foo')
    .indexOf('<span>Foo (beta) <b class="ssel-rec">(Recommended)</b></span>') >= 0);
});

test('renderSelectOptions renders explicit groups without heading indicators', () => {
  const item = { messageKey: 'slot', options: [
    ['Empty', 'empty'],
    ['Weather', '__hdr_weather', { disabled: true, groupHeader: true }],
    ['Temperature', 'temp', { groupChild: true, groupEnd: false }],
    ['Wind', 'wind', { groupChild: true, groupEnd: true }],
    ['City', 'city']
  ] };
  const html = E.renderSelectOptions(item, 'temp', '');
  assert.match(html, /class="ssel-group" role="presentation">\s*<span>Weather<\/span>/);
  assert.doesNotMatch(html, /data-select-pick="__hdr_weather"/);
  assert.match(html, /class="ssel-opt group-child on"[^>]*data-select-pick="temp"/);
  assert.match(html, /class="ssel-opt group-child group-end"[^>]*data-select-pick="wind"/);
  assert.equal((html.match(/ssel-chk/g) || []).length, 1, 'indicator only on selected item');
});

test('renderSelectOptions omits group presentation classes and headings while filtering', () => {
  const item = { messageKey: 'slot', options: [
    ['Weather', '__hdr_weather', { disabled: true, groupHeader: true }],
    ['Temperature', 'temp', { groupChild: true, groupEnd: false }],
    ['Wind speed', 'wind', { groupChild: true, groupEnd: true }]
  ] };
  const html = E.renderSelectOptions(item, 'temp', 'wind');
  assert.doesNotMatch(html, /ssel-group|Weather/);
  assert.match(html, /class="ssel-opt"[^>]*data-select-pick="wind"/);
  assert.doesNotMatch(html, /group-child|group-end/);
});

test('renderSelectOptions: a non-header disabled option renders visible but inert', () => {
  // A provider-gated slot item (e.g. "Pollen (DWD)" under another provider)
  // rides the list as {disabled: true} without groupHeader: it must stay
  // visible, but carry no data-select-pick (the delegated pick handler must
  // never match it) and be disabled against taps/keyboard.
  const item = { messageKey: 'slot', options: [
    ['Empty', 'empty'],
    ['Pollen (DWD)', 'pollen', { disabled: true }]
  ] };
  const html = E.renderSelectOptions(item, 'empty', '');
  assert.match(html, /class="ssel-opt"[^>]*aria-selected="false" disabled aria-disabled="true"[^>]*><span>Pollen \(DWD\)<\/span>/,
    'disabled row rendered inert with its label');
  const rows = html.split('<button');
  const pollenRow = rows.find(r => r.indexOf('Pollen') >= 0);
  assert.equal(pollenRow.indexOf('data-select-pick'), -1, 'no pick attribute on the disabled row');
  assert.match(rows.find(r => r.indexOf('Empty') >= 0), /data-select-pick="empty"/,
    'sibling enabled row still pickable');
  // A disabled GROUP CHILD keeps its indentation classes.
  const grouped = { messageKey: 'slot', options: [
    ['Weather', '__hdr_weather', { disabled: true, groupHeader: true }],
    ['Pollen (DWD)', 'pollen', { disabled: true, groupChild: true, groupEnd: true }]
  ] };
  assert.match(E.renderSelectOptions(grouped, 'empty', ''),
    /class="ssel-opt group-child group-end"[^>]*disabled aria-disabled="true"/);
});

test('renderSelectOptions: case-insensitive label match', () => {
  const item = { messageKey: 'c', options: [['United States','US'],['Germany','DE'],['Spain','ES']] };
  const r = E.renderSelectOptions(item, 'US', 'ger');
  assert.ok(r.indexOf('>Germany<') >= 0, 'matches Germany');
  assert.equal(r.indexOf('>Spain<'), -1, 'Spain filtered out');
  assert.equal(r.indexOf('>United States<'), -1, 'US filtered out');
});

test('renderSelectOptions: matches the value code too', () => {
  const item = { messageKey: 'c', options: [['United States','US'],['Germany','DE']] };
  const r = E.renderSelectOptions(item, 'DE', 'us');
  assert.ok(r.indexOf('>United States<') >= 0, 'typing the code "us" finds United States');
  assert.equal(r.indexOf('>Germany<'), -1, 'Germany filtered out');
});

test('renderSelectOptions: no matches yields the muted row', () => {
  const item = { messageKey: 'c', options: [['United States','US'],['Germany','DE']] };
  const r = E.renderSelectOptions(item, 'US', 'zzz');
  assert.ok(r.indexOf('ssel-none') >= 0 && r.indexOf('No matches') >= 0);
  assert.equal(r.indexOf('ssel-opt'), -1, 'no option rows');
});

test('renderSelectOptions: label is HTML-escaped', () => {
  const item = { messageKey: 'c', options: [['<b>x</b>','X']] };
  const r = E.renderSelectOptions(item, 'X', '');
  assert.equal(r.indexOf('<b>x</b>'), -1, 'raw markup must not survive');
  assert.ok(r.indexOf('&lt;b&gt;x&lt;/b&gt;') >= 0);
});

test('renderControl searchSelect: closed trigger is a labelled native listbox button', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['United States','US'],['Germany','DE']] };
  const html = E.renderControl(item, { value: 'DE', openSelect: null });
  assert.match(html, /^<button type="button" class="sel-wrap" data-select="c"/);
  assert.match(html, /aria-label="Country: Germany"/);
  assert.match(html, /aria-haspopup="listbox" aria-expanded="false" aria-controls="ssel-list-c"/);
  assert.ok(html.indexOf('>Germany<') >= 0, 'shows current option label');
  assert.equal(html.indexOf('data-select-search'), -1, 'no search input when closed');
  assert.doesNotMatch(html, /tabindex=|onkeydown=|role="button"/, 'native button supplies keyboard behavior and tab stop');
});

test('renderControl searchSelect: an open trigger reports expanded but renders no inline list', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['United States','US'],['Germany','DE']] };
  const html = E.renderControl(item, { value: 'DE', openSelect: 'c', selectQuery: '' });
  assert.match(html, /^<button type="button" class="sel-wrap" data-select="c"/);
  assert.match(html, /aria-haspopup="listbox" aria-expanded="true" aria-controls="ssel-list-c"/);
  assert.equal(html.indexOf('data-select-search'), -1, 'search input is in the modal, not the control');
  assert.equal(html.indexOf('class="ssel-list"'), -1, 'option list is in the modal, not the control');
});

test('renderSelectModal: open searchSelect exposes header + search + controlled listbox, no overlay wrapper', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['United States','US'],['Germany','DE']] };
  const schema = { appName: 'X', versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [item] }] }] };
  const cx = { S: { c: 'DE' }, ENV: {}, USERDATA: {}, openColor: null, openSelect: 'c', selectQuery: '', collapsed: {}, evalCtx: { c: 'DE', env: {} } };
  const html = E.renderSelectModal(schema, cx);
  assert.equal(html.indexOf('ssel-overlay'), -1, 'no full-screen overlay wrapper — the host <dialog> is the sheet');
  assert.match(html, /class="ssel-modal-hdr"><span class="ssel-modal-ttl" id="ssel-ttl-c">Country<\/span>/);
  assert.match(html, /data-select-close/);
  assert.ok(html.indexOf('data-select-search="c"') >= 0, 'searchSelect modal has a search box');
  assert.match(html, /id="ssel-list-c" class="ssel-list" role="listbox" aria-label="Country options" data-ssel-list="c"/);
  assert.match(html, /role="option" aria-selected="true"[^>]*data-select-pick="DE"/);
  assert.match(html, /role="option" aria-selected="false"[^>]*data-select-pick="US"/);
});

test('renderSelectModal: no sheet child leaves the dialog\'s own box showing through a margin', () => {
  // The modal's click handler reads `e.target === modal` as a ::backdrop tap. The dialog is
  // the sheet itself, though, so a tap on a bare patch of it — a child's MARGIN — targets the
  // dialog too and light-dismissed the sheet (dropping the typed query). The search box had
  // `margin: 0 16px 10px`: tapping just beside it closed the country picker. Its spacing now
  // lives on a wrapper's padding. Node has no hit-testing, so this pins the contract instead:
  // every top-level child of the sheet resolves to no outer margin in shell.html.
  const shell = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'shell.html'), 'utf8');
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['Germany','DE']] };
  const schema = { appName: 'X', versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [item] }] }] };
  const cx = { S: { c: 'DE' }, ENV: {}, USERDATA: {}, openColor: null, openSelect: 'c', selectQuery: 'ger', collapsed: {}, evalCtx: { c: 'DE', env: {} } };
  const html = E.renderSelectModal(schema, cx);
  // Top-level elements only: walk the tags, tracking depth (void <input> has no close tag).
  const top = [];
  let depth = 0;
  html.replace(/<(\/?)([a-z]+)([^>]*)>/g, (m, close, tag, attrs) => {
    if (close) { depth--; return m; }
    if (depth === 0) { top.push({ tag, cls: (/class="([^"]*)"/.exec(attrs) || [])[1] || '' }); }
    if (tag !== 'input') { depth++; }
    return m;
  });
  assert.deepEqual(top.map((t) => t.tag + '.' + t.cls.split(' ')[0]),
    ['div.ssel-modal-hdr', 'div.ssel-search-wrap', 'div.ssel-list'],
    'the search box is wrapped, not a direct child of the dialog');
  assert.match(html, /<div class="ssel-search-wrap"><input type="text" class="ssel-search" data-select-search="c"[^>]*value="ger">/);
  top.forEach(({ cls }) => {
    const c = cls.split(' ')[0].replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    // The dialog-scoped rule wins where it sets a margin; otherwise the base rule decides.
    const scoped = new RegExp('dialog#modal \\.' + c + '\\s*\\{([^}]*)\\}').exec(shell);
    const base = new RegExp('(?:^|\\n)\\s*\\.' + c + '\\s*\\{([^}]*)\\}').exec(shell);
    const decl = (rule) => rule && /(?:^|;)\s*margin(?:-[a-z]+)?\s*:\s*([^;]*)/.exec(rule[1]);
    const m = decl(scoped) || decl(base);
    if (m) { assert.match(m[1].trim(), /^0(px)?$/, '.' + cls + ' must not carry an outer margin: ' + m[0].trim()); }
  });
  assert.match(shell, /dialog#modal \.ssel-search-wrap\s*\{[^}]*padding:\s*0 16px 10px/,
    'the wrapper carries the search box\'s spacing as padding');
});

test('renderSelectModal: the open list reflects the query', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'C', options: [['United States','US'],['Germany','DE']] };
  const schema = { appName: 'X', versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [item] }] }] };
  const cx = { S: { c: 'US' }, ENV: {}, USERDATA: {}, openColor: null, openSelect: 'c', selectQuery: 'ger', collapsed: {}, evalCtx: { c: 'US', env: {} } };
  const html = E.renderSelectModal(schema, cx);
  assert.ok(html.indexOf('data-select-pick="DE"') >= 0, 'matching option present');
  assert.equal(html.indexOf('data-select-pick="US"'), -1, 'non-matching option filtered from the list');
});

test('renderSelectModal: nothing open -> empty string', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'C', options: [['A','a']] };
  const schema = { appName: 'X', versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [item] }] }] };
  const cx = { S: { c: 'a' }, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, selectQuery: '', collapsed: {}, evalCtx: { c: 'a', env: {} } };
  assert.equal(E.renderSelectModal(schema, cx), '');
});

// The status-bar work tightens searchSelect rows into status-line slots (.slot). Since the
// modal refactor, a searchSelect never stacks inline (open or closed) — the popup is the
// modal's job — so the row stays a slot in both states.
test('renderRow: a searchSelect row is a tight status-line slot, never stacked', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['A','a']] };
  const closed = E.renderRow(item, { value: 'a', openSelect: null });
  assert.ok(closed.indexOf('class="row slot"') >= 0 && closed.indexOf('stack') === -1, 'closed searchSelect row is inline, tightened as a status-line slot');
  const open = E.renderRow(item, { value: 'a', openSelect: 'c', selectQuery: '' });
  assert.ok(open.indexOf('slot') >= 0 && open.indexOf('stack') === -1, 'open searchSelect row stays a slot, not stacked (the popup is the modal\'s job)');
});

test('renderRow: neither select nor searchSelect stacks (trigger stays inline)', () => {
  const ss = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['A','a']] };
  const open = E.renderRow(ss, { value: 'a', openSelect: 'c', selectQuery: '' });
  assert.ok(open.indexOf('class="row slot"') >= 0 && open.indexOf('stack') === -1, 'open searchSelect row is inline (a tight status-line slot)');
  const sel = { type: 'select', messageKey: 'm', label: 'Mode', options: [['A','a']] };
  const selRow = E.renderRow(sel, { value: 'a', openSelect: null });
  assert.ok(selRow.indexOf('class="row"') >= 0 && selRow.indexOf('stack') === -1, 'select row is inline');
});

// Status slots are searchless selects but must keep the compact .slot spacing. They carry
// no distinguishing type, so the row is matched by its statusSlot optionsFrom resolver.
test('renderRow: a status-slot select gets the compact .slot class; a plain select does not', () => {
  // renderRow renders an already-resolved item, so it carries materialized options
  // alongside the statusSlot optionsFrom marker (as resolveRowItem produces).
  const slot = { type: 'select', messageKey: 'statusTopMid', label: 'Middle slot',
    options: [['Date', 'date'], ['City', 'city']],
    optionsFrom: { resolver: 'statusSlot', args: { slotKey: 'statusTopMid', position: 'mid' } } };
  const slotRow = E.renderRow(slot, { value: 'date', openSelect: null });
  assert.ok(slotRow.indexOf('class="row slot"') >= 0, 'status-slot select row is tightened as a status-line slot');
  const plain = { type: 'select', messageKey: 'm', label: 'Mode', options: [['A','a']] };
  const plainRow = E.renderRow(plain, { value: 'a', openSelect: null });
  assert.equal(plainRow.indexOf('slot'), -1, 'a non-status select row is not a slot');
});

test('renderBody: an open searchSelect renders only the trigger; the popup is the modal\'s job, not renderBody\'s', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'searchSelect', messageKey: 'c', label: 'Country', defaultValue: 'US', options: [['United States','US'],['Germany','DE']] }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, openSelect: 'c', selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('class="sel-wrap" data-select="c"') >= 0, 'trigger rendered through renderBody');
  assert.equal(html.indexOf('data-select-search'), -1, 'no inline search input; that lives in the modal (Task 2)');
  assert.ok(html.indexOf('class="row slot"') >= 0 && html.indexOf('class="row stack"') === -1, 'row stays inline while open (a tight status-line slot)');
});

test('onChange registry: register/get; unknown id -> undefined', () => {
  E.onChange.register('demo', (S, oldV, newV) => { S.touched = [oldV, newV]; });
  assert.equal(typeof E.onChange.get('demo'), 'function');
  assert.equal(E.onChange.get('nope'), undefined);
});

// boot() requires a DOM; drive it with a minimal document shim (same technique as
// statictext-showwhen.test.js) so wireInputs()'s and wireModal()'s real click/input
// listeners run. scroll/modal.addEventListener here CAPTURE the listener (instead of
// no-op'ing it) so the test can invoke it directly, simulating a real browser event.
// `opts.modalQuery(sel)` (optional) answers #modal.querySelector — the edit-sheet
// tests hand it a scroll-list stub and a focusable trigger; without it every
// in-dialog query misses, as before. `opts.scrollQueryAll(sel)` / `opts.modalQueryAll(sel)`
// (optional) answer querySelectorAll on #scroll / #modal — the in-place trigger relabel
// after a text commit asks them for '.sel-wrap[data-select]'; without them both answer [].
// `opts.dialog` (optional) gives #modal a native-dialog surface — showModal()/close(), `open`
// and a classList recorded in `modal.classes` — so syncDialog runs past its guard and a test
// can read the sheet's .edit/.picking state and whether it is open. Without it syncDialog
// no-ops, as before.
function bootWithCapturedListeners(schema, env, opts) {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = fs.readFileSync(path.join(LIB, 'schema-walk.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'color.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'show-when.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'html.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'date-picker.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'range-control.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'rgb-control.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'engine.js'), 'utf8')
    + '\nPConf.hooks.onLoad(function (ctx) { module.exports.loadEnv = ctx.env; });'
    + '\nPConf.hooks.onReady(function (ctx) {'
    + ' module.exports.openSheet = ctx.openSheet;'
    + ' module.exports.activeTab = ctx.activeTab;'
    + ' module.exports.getValue = ctx.get; });'
    + '\nPConf.engine.boot();';
  const listeners = {};
  const modalListeners = {};
  const focusCounts = { select: {}, date: {}, 'edit-sheet': {} };
  const scroll = {
    innerHTML: '',
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelectorAll: (sel) => ((opts && opts.scrollQueryAll) ? opts.scrollQueryAll(sel) : [])
  };
  const modal = {
    innerHTML: '',
    style: {},
    addEventListener: (type, fn) => { modalListeners[type] = fn; },
    querySelector: (sel) => ((opts && opts.modalQuery) ? opts.modalQuery(sel) : null),
    querySelectorAll: (sel) => ((opts && opts.modalQueryAll) ? opts.modalQueryAll(sel) : [])
  };
  if (opts && opts.dialog) {
    // No toggle(): the engine must use add/remove (old Android WebViews).
    const classes = new Set();
    Object.assign(modal, {
      open: false,
      classes,
      classList: { add: (c) => { classes.add(c); }, remove: (c) => { classes.delete(c); },
        contains: (c) => classes.has(c) },
      setAttribute: () => {},
      removeEventListener: () => {},
      showModal() { this.open = true; },
      close() { this.open = false; }
    });
  }
  const sselList = { innerHTML: '', focus: () => {} };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener: () => {} });
  const tabsListeners = {};
  // `opts.tabs` (optional) adds fields to the tab bar's stub — querySelector, rects,
  // scrollLeft — for the tab-reveal tests; without it the reveal finds no tab and no-ops.
  const tabs = Object.assign({ innerHTML: '', addEventListener: (type, fn) => { tabsListeners[type] = fn; } },
    (opts && opts.tabs) || {});
  const ids = { scroll, modal, tabs, save: generic(), appTitle: generic(), toast: generic() };
  // Resolve the selectors boot() issues against `document`: live-search lists and the fresh
  // select/date/edit-sheet triggers that closeModal() may restore focus to after render.
  const document = {
    getElementById: (id) => ids[id] || generic(),
    addEventListener: () => {},
    querySelector: (sel) => {
      var m = /^\[data-ssel-list="(.+)"\]$/.exec(sel);
      if (m) { return sselList; }
      m = /^\[data-(select|date|edit-sheet)="(.+)"\]$/.exec(sel);
      if (m) {
        return { focus: () => {
          focusCounts[m[1]][m[2]] = (focusCounts[m[1]][m[2]] || 0) + 1;
        } };
      }
      return null;
    }
  };
  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'module', BUNDLE);
  const mod = { exports: {} };
  fn(document, schema, env, {}, {}, 'pebblejs://close#', mod);
  return {
    listeners, modalListeners, tabsListeners, scroll, modal, tabs, sselList, focusCounts,
    onChange: mod.exports.onChange, loadEnv: mod.exports.loadEnv,
    openSheet: mod.exports.openSheet, getValue: mod.exports.getValue,
    activeTab: mod.exports.activeTab
  };
}

test('date helpers use local YYYY-MM-DD and clamp invalid days', () => {
  assert.equal(E.formatDateValue(new Date(2028, 1, 29, 23, 30)), '2028-02-29');
  assert.deepEqual(E.parseDateParts('2026-12-24', new Date(2026, 0, 1)),
    { year: 2026, month: 12, day: 24 });
  assert.deepEqual(E.parseDateParts('not-a-date', new Date(2026, 6, 4)),
    { year: 2026, month: 7, day: 4 });
  assert.equal(E.dateValueFromParts({ year: 2027, month: 2, day: 31 }),
    '2027-02-28');
});

test('date control renders a whole-row calendar trigger with a real date', () => {
  const item = { type: 'date', messageKey: 'trip', label: 'Target date' };
  const view = { value: '2026-12-24', openDate: null };
  const html = E.renderRow(item, view);
  assert.match(html, /class="row date-row"/);
  assert.match(html, /class="date-wrap"/);
  assert.match(html, /data-date="trip"/);
  assert.match(html, /24 Dec 2026/);
  assert.match(html, /<svg[\s\S]*aria-hidden="true"/);
  assert.doesNotMatch(html, /class="lft"/);
  assert.doesNotMatch(html, /placeholder|unset/i);
});

test('date modal renders selected day, month, and year wheels', () => {
  const schema = { tabs: [{ id: 't', sections: [{ items: [
    { type: 'date', messageKey: 'trip', label: 'Target date' }
  ] }]}]};
  const cx = {
    S: { trip: '2026-12-24' }, ENV: {}, openDate: 'trip', openSelect: null,
    selectQuery: '', evalCtx: { trip: '2026-12-24', env: {} }
  };
  const html = E.renderDateModal(schema, cx);
  assert.match(html, /data-date-wheel="day"[\s\S]*class="date-opt on" data-date-value="24"/);
  assert.match(html, /data-date-wheel="month"[\s\S]*December/);
  assert.match(html, /data-date-wheel="year"[\s\S]*2026/);
  assert.doesNotMatch(html, /data-select-search/);
});

test('boot(): date trigger opens the shared sheet and a tapped wheel value persists', () => {
  const schema = { appName: 'X', versionLabel: 'v0', tabs: [
    { id: 't', label: 'T', sections: [{ items: [
      { type: 'date', messageKey: 'trip', label: 'Target date',
        defaultValue: '2026-12-24' }
    ] }] }
  ] };
  const result = bootWithCapturedListeners(schema, {});
  const trigger = {
    getAttribute: (name) => name === 'data-date' ? 'trip' : null
  };
  result.listeners.click({
    target: { closest: (selector) => selector === '[data-date]' ? trigger : null }
  });
  assert.match(result.modal.innerHTML, /data-date-picker="trip"/);

  const wheel = {
    getAttribute: (name) => name === 'data-date-wheel' ? 'day' : null
  };
  const option = {
    getAttribute: (name) => name === 'data-date-value' ? '25' : null,
    closest: (selector) => selector === '[data-date-wheel]' ? wheel : null
  };
  result.modalListeners.click({
    target: { closest: (selector) => selector === '.date-opt' ? option : null }
  });
  assert.match(result.modal.innerHTML,
    /class="date-opt on" data-date-value="25"/);
});

test('boot(): date swipe-dismiss arms only from the header or a wheel already at its top', () => {
  const schema = { appName: 'X', versionLabel: 'v0', tabs: [
    { id: 't', label: 'T', sections: [{ items: [
      { type: 'date', messageKey: 'trip', label: 'Target date',
        defaultValue: '2026-12-24' }
    ] }] }
  ] };

  function dragWasArmed(target) {
    const result = bootWithCapturedListeners(schema, {});
    const trigger = {
      getAttribute: (name) => name === 'data-date' ? 'trip' : null
    };
    result.listeners.click({
      target: { closest: (selector) => selector === '[data-date]' ? trigger : null }
    });
    let prevented = false;
    result.modalListeners.touchstart({
      target,
      touches: [{ clientY: 100 }]
    });
    result.modalListeners.touchmove({
      touches: [{ clientY: 120 }],
      preventDefault: () => { prevented = true; }
    });
    return prevented;
  }

  const gap = { closest: () => null };
  const header = {};
  const headerTarget = {
    closest: (selector) => selector === '.ssel-modal-hdr' ? header : null
  };
  const wheelAtTop = { scrollTop: 0 };
  const topWheelTarget = {
    closest: (selector) => selector === '[data-date-wheel]' ? wheelAtTop : null
  };
  const wheelBelowTop = { scrollTop: 20 };
  const scrolledWheelTarget = {
    closest: (selector) => selector === '[data-date-wheel]' ? wheelBelowTop : null
  };

  assert.equal(dragWasArmed(gap), false, 'picker gaps and padding do not arm dismissal');
  assert.equal(dragWasArmed(headerTarget), true, 'the modal header arms dismissal');
  assert.equal(dragWasArmed(topWheelTarget), true, 'a wheel at its top arms dismissal');
  assert.equal(dragWasArmed(scrolledWheelTarget), false,
    'a wheel below its top keeps scrolling normally');
});

const DATE_MODAL_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [
  { id: 't', label: 'T', sections: [{ items: [
    { type: 'date', messageKey: 'trip', label: 'Target date',
      defaultValue: '2026-12-24' }
  ] }] }
] };

function openDateInHarness(result) {
  const trigger = {
    getAttribute: (name) => name === 'data-date' ? 'trip' : null
  };
  result.listeners.click({
    target: { closest: (selector) => selector === '[data-date]' ? trigger : null }
  });
}

function dateWheel(part, value) {
  const option = {
    offsetTop: 0,
    offsetHeight: 44,
    getAttribute: (name) => name === 'data-date-value' ? String(value) : null
  };
  const wheel = {
    scrollTop: 0,
    clientHeight: 44,
    closest: (selector) => selector === '[data-date-wheel]' ? wheel : null,
    getAttribute: (name) => name === 'data-date-wheel' ? part : null,
    querySelectorAll: (selector) => selector === '.date-opt' ? [option] : []
  };
  return wheel;
}

function tapDateOption(result, part, value) {
  const wheel = {
    getAttribute: (name) => name === 'data-date-wheel' ? part : null
  };
  const option = {
    getAttribute: (name) => name === 'data-date-value' ? String(value) : null,
    closest: (selector) => selector === '[data-date-wheel]' ? wheel : null
  };
  result.modalListeners.click({
    target: { closest: (selector) => selector === '.date-opt' ? option : null }
  });
}

function closeDateWithX(result) {
  const closeButton = {};
  result.modalListeners.click({
    target: {
      closest: (selector) => selector === '[data-select-close]' ? closeButton : null
    }
  });
}

test('boot(): every fast date close path flushes the pending wheel selection', () => {
  const closeCases = [
    ['X', (result) => {
      const closeButton = {};
      result.modalListeners.click({
        target: {
          closest: (selector) => selector === '[data-select-close]' ? closeButton : null
        }
      });
    }],
    ['backdrop', (result) => {
      result.modalListeners.click({ target: result.modal });
    }],
    ['Escape', (result) => {
      result.modalListeners.cancel({ preventDefault: () => {} });
    }],
    ['swipe', (result) => {
      const header = {};
      const headerTarget = {
        closest: (selector) => selector === '.ssel-modal-hdr' ? header : null
      };
      result.modalListeners.touchstart({
        target: headerTarget,
        touches: [{ clientY: 100 }]
      });
      result.modalListeners.touchmove({
        touches: [{ clientY: 200 }],
        preventDefault: () => {}
      });
      result.modalListeners.touchend({
        changedTouches: [{ clientY: 200 }]
      });
    }]
  ];

  for (const [name, close] of closeCases) {
    const result = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
    openDateInHarness(result);
    result.modalListeners.scroll({ target: dateWheel('day', 25) });
    close(result);
    assert.equal(result.getValue('trip'), '2026-12-25',
      name + ' preserves the pending day');
  }
});

test('boot(): a tapped date option wins over a pending sample from the same wheel', () => {
  const result = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
  openDateInHarness(result);
  result.modalListeners.scroll({ target: dateWheel('day', 25) });
  tapDateOption(result, 'day', 26);
  closeDateWithX(result);
  assert.equal(result.getValue('trip'), '2026-12-26');
});

test('boot(): rapid cross-wheel scrolls settle independently', async () => {
  const dayMonth = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
  openDateInHarness(dayMonth);
  dayMonth.modalListeners.scroll({ target: dateWheel('day', 25) });
  dayMonth.modalListeners.scroll({ target: dateWheel('month', 2) });
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(dayMonth.getValue('trip'), '2026-02-25',
    'month scroll does not cancel the pending day');

  const monthYear = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
  openDateInHarness(monthYear);
  monthYear.modalListeners.scroll({ target: dateWheel('month', 1) });
  monthYear.modalListeners.scroll({ target: dateWheel('year', 2027) });
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(monthYear.getValue('trip'), '2027-01-24',
    'year scroll does not cancel the pending month');
});

test('boot(): the first settling timer flushes siblings before alignment can replace them', async () => {
  async function settleWithAlignment(firstPart, firstValue, secondPart, secondValue,
    expected) {
    const result = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
    openDateInHarness(result);
    result.modalListeners.scroll({ target: dateWheel(firstPart, firstValue) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    result.modalListeners.scroll({ target: dateWheel(secondPart, secondValue) });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const rendered = result.getValue('trip').split('-');
    const indexes = { year: 0, month: 1, day: 2 };
    const alignedValue = parseInt(rendered[indexes[secondPart]], 10);
    result.modalListeners.scroll({
      target: dateWheel(secondPart, alignedValue)
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(result.getValue('trip'), expected);
  }

  await settleWithAlignment('day', 25, 'month', 2, '2026-02-25');
  await settleWithAlignment('month', 1, 'year', 2027, '2027-01-24');
});

test('boot(): closing a date sheet restores focus to its date trigger', () => {
  const result = bootWithCapturedListeners(DATE_MODAL_SCHEMA, {});
  openDateInHarness(result);
  const closeButton = {};
  result.modalListeners.click({
    target: {
      closest: (selector) => selector === '[data-select-close]' ? closeButton : null
    }
  });
  assert.equal(result.focusCounts.date.trip, 1);
});

const THEME_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'select', messageKey: 'theme', label: 'Theme', defaultValue: 'dark', onChange: 'themeConvert',
      options: [['Dark', 'dark'], ['Light', 'light']] }
  ] }] }]
};

test('boot(): closing a directly opened select restores focus to its fresh trigger', () => {
  const result = bootWithCapturedListeners(THEME_SCHEMA, {});
  const trigger = {
    getAttribute: (name) => name === 'data-select' ? 'theme' : null
  };
  result.listeners.click({
    target: { closest: (selector) => selector === '[data-select]' ? trigger : null }
  });
  const closeButton = {};
  result.modalListeners.click({
    target: {
      closest: (selector) => selector === '[data-select-close]' ? closeButton : null
    }
  });
  assert.equal(result.focusCounts.select.theme, 1);
});

test('boot(): external openSheet close skips underlying trigger focus and calls onClose once', () => {
  const result = bootWithCapturedListeners(THEME_SCHEMA, {});
  let closed = 0;
  result.openSheet('theme', () => { closed++; });
  const closeButton = {};
  result.modalListeners.click({
    target: {
      closest: (selector) => selector === '[data-select-close]' ? closeButton : null
    }
  });
  result.modalListeners.cancel({ preventDefault: () => {} });
  assert.equal(result.focusCounts.select.theme || 0, 0);
  assert.equal(closed, 1);
});

// One openColor variable serves palettes on BOTH surfaces — the tab body and an edit
// sheet — so this card deliberately mixes a color row with a select row (the shipped
// Layout tab does exactly that) and adds a sheet holding a color row of its own.
const COLOR_SURFACE_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      { type: 'color', messageKey: 'tint', label: 'Tint', defaultValue: 0xFF0000,
        onChange: 'tintPicked' },
      { type: 'select', messageKey: 'mode', label: 'Mode', defaultValue: 'a',
        options: [['A', 'a'], ['B', 'b']] },
      { type: 'sheet', sheetId: 'more', label: 'More colors' }
    ] },
    { sheetOnly: true, sheetId: 'more', title: 'More colors', items: [
      { type: 'color', messageKey: 'accent', label: 'Accent', defaultValue: 0x00FF00 }
    ] }
  ] }]
};

/**
 * Dispatch one synthetic delegated click whose target matches exactly ONE selector —
 * the shape the engine's `e.target.closest(sel)` delegation reads.
 * @param {Function} listener Captured click listener (#scroll or #modal).
 * @param {string} selector The single selector the target answers to.
 * @param {Object} attrs getAttribute lookup table for the matched node.
 * @returns {void}
 */
function clickMatching(listener, selector, attrs) {
  const node = {
    getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
    closest: (sel) => (sel === selector ? node : null)
  };
  listener({ target: { closest: (sel) => (sel === selector ? node : null) } });
}

test('boot(): closing an unrelated modal leaves a tab-body palette expanded', () => {
  const r = bootWithCapturedListeners(COLOR_SURFACE_SCHEMA, {});
  clickMatching(r.listeners.click, '[data-color]', { 'data-color': 'tint' });
  assert.ok(r.scroll.innerHTML.indexOf('class="palette"') >= 0, 'the palette expands in the tab body');
  // Open the select sitting in the same card, then dismiss it. The palette behind it
  // belongs to the tab body, not to the modal, so it must survive the close.
  clickMatching(r.listeners.click, '[data-select]', { 'data-select': 'mode' });
  clickMatching(r.modalListeners.click, '[data-select-close]', {});
  assert.ok(r.scroll.innerHTML.indexOf('class="palette"') >= 0,
    'closing a select must not collapse a palette in the tab body');
});

test('boot(): closing an edit sheet collapses a palette expanded inside it', () => {
  // An edit sheet is a full-screen dialog: its ways out are × ([data-dlg-close], discards)
  // and Done ([data-dlg-done], keeps). Either one takes the expanded palette with it.
  ['[data-dlg-close]', '[data-dlg-done]'].forEach((way) => {
    const r = bootWithCapturedListeners(COLOR_SURFACE_SCHEMA, {});
    clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'more' });
    assert.ok(r.modal.innerHTML.indexOf('data-color="accent"') >= 0, 'the sheet renders its color row');
    assert.ok(r.modal.innerHTML.indexOf(way.slice(1, -1)) >= 0, way + ' is in the dialog header');
    clickMatching(r.modalListeners.click, '[data-color]', { 'data-color': 'accent' });
    assert.ok(r.modal.innerHTML.indexOf('class="palette"') >= 0, 'the palette expands inside the sheet');
    clickMatching(r.modalListeners.click, way, {});
    assert.equal(r.modal.innerHTML, '', way + ': the sheet closes');
    clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'more' });
    assert.equal(r.modal.innerHTML.indexOf('class="palette"'), -1, way + ': the sheet reopens collapsed');
  });
});

// A toggle row carrying the pencil (the shape the retired Alerts card's "show this
// alert" switches had; a generic engine capability, kept pinned): the
// switch and the Edit button share one row, and the #scroll delegate tells them apart —
// the switch flips the value in place, the Edit button opens the sheet.
const TOGGLE_PEN_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      { type: 'toggle', messageKey: 'alertUv', label: 'UV index', defaultValue: false,
        editSheetFrom: { resolver: 'togglePenSheet' },
        editBadgeFrom: { resolver: 'togglePenBadge' } }
    ] },
    { sheetOnly: true, sheetId: 'alertUvSheet', title: 'UV index alert', items: [
      { type: 'text', messageKey: 'uvWarn', label: 'Warn above', defaultValue: '' }
    ] }
  ] }]
};

test('boot(): on a toggle row the switch flips in place and the Edit button opens the sheet', () => {
  const r = bootWithCapturedListeners(TOGGLE_PEN_SCHEMA, {});
  // boot() re-ran engine.js, which rebuilt the registries on the shared global.PConf —
  // register against the live ones (they are what the booted page renders through).
  global.PConf.sheetResolvers.register('togglePenSheet', () => 'alertUvSheet');
  global.PConf.badgeResolvers.register('togglePenBadge', () => ({ label: 'Edit', dots: [{ color: '#FF5500' }] }));
  clickMatching(r.listeners.click, '[data-toggle]', { 'data-k': 'alertUv', 'data-toggle': '1' });
  assert.equal(r.getValue('alertUv'), true, 'the switch toggled the value');
  assert.equal(r.modal.innerHTML.indexOf('UV index alert'), -1, 'a switch click opens no sheet');
  assert.ok(r.scroll.innerHTML.indexOf('data-edit-sheet="alertUvSheet"') >= 0,
    'the re-rendered row offers its Edit button beside the switch');
  assert.ok(r.scroll.innerHTML.indexOf('pen-dot fill') >= 0, 'with the badge');
  clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'alertUvSheet' });
  assert.ok(r.modal.innerHTML.indexOf('UV index alert') >= 0, 'the Edit button opened the sheet');
  assert.ok(r.modal.innerHTML.indexOf('data-k="uvWarn"') >= 0, 'with its fields');
  assert.equal(r.getValue('alertUv'), true, 'opening the sheet left the switch alone');
});

// A `select` row INSIDE an edit sheet expands its options IN PLACE, under the row inside
// the sheet (the palette's pattern), instead of taking the dialog over. The sheet
// reveals a row on the picked value, so a test can see the pick reached the re-rendered
// sheet; it holds a color row whose palette shares the one-expander rule with the list,
// and a select with a gated option for the inert case.
const SHEET_SELECT_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [{ type: 'sheet', sheetId: 'fmt', label: 'Format' }] },
    { sheetOnly: true, sheetId: 'fmt', title: 'Format', items: [
      { type: 'toggle', messageKey: 'flag', label: 'Flag', defaultValue: false },
      { type: 'color', messageKey: 'tone', label: 'Tone', defaultValue: 0x00FF00 },
      { type: 'select', messageKey: 'sep', label: 'Separator', defaultValue: 'slash',
        onChange: 'sepPicked', options: [['12/10', 'slash'], ['Custom', 'custom']] },
      { type: 'text', messageKey: 'sepText', label: 'Custom separator', defaultValue: '',
        showWhen: { key: 'sep', eq: 'custom' } },
      { type: 'select', messageKey: 'mark', label: 'Mark', defaultValue: 'none',
        options: [['None', 'none'], ['»', 'raquo'], ['Locked', 'locked', { disabled: true }]] }
    ] }
  ] }]
};

/**
 * Boot SHEET_SELECT_SCHEMA and open its edit sheet.
 * @param {Object} [opts] Passed through to bootWithCapturedListeners.
 * @returns {Object} The harness.
 */
function bootWithFormatSheet(opts) {
  const r = bootWithCapturedListeners(SHEET_SELECT_SCHEMA, {}, opts);
  clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'fmt' });
  assert.ok(r.modal.innerHTML.indexOf('data-select="sep"') >= 0, 'the sheet renders its select row');
  return r;
}

/**
 * The opening tag of the row holding a select trigger, and the trigger's own tag.
 * @param {string} html Rendered sheet markup.
 * @param {string} key The select's messageKey.
 * @returns {{row: string, trigger: string}} The two tags ('' when absent).
 */
function selectRowTags(html, key) {
  const at = html.indexOf('data-select="' + key + '"');
  if (at < 0) { return { row: '', trigger: '' }; }
  const rowAt = html.lastIndexOf('<div class="row', at);
  const trigAt = html.lastIndexOf('<button', at);
  return {
    row: html.slice(rowAt, html.indexOf('>', rowAt) + 1),
    trigger: html.slice(trigAt, html.indexOf('>', at) + 1)
  };
}

test('boot(): a tap on a sheet\'s select expands its options inline; the sheet stays drawn', () => {
  const r = bootWithFormatSheet();
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  const html = r.modal.innerHTML;
  assert.ok(html.indexOf('<div id="ssel-list-sep" class="isel-list" role="listbox" aria-label="Separator options">') >= 0,
    'the list renders in place, under the id the trigger\'s aria-controls names');
  assert.ok(html.indexOf('data-select-pick="custom"') >= 0, 'with its options');
  assert.ok(html.indexOf('data-k="flag"') >= 0 && html.indexOf('data-color="tone"') >= 0,
    'the rest of the sheet is still drawn around it');
  assert.equal(html.indexOf('data-ssel-list'), -1, 'no select modal takes the dialog over');
  assert.equal(html.indexOf('class="ssel-list"'), -1, 'and the list is never a .ssel-list');
  const tags = selectRowTags(html, 'sep');
  assert.match(tags.trigger, /aria-expanded="true"/, 'the trigger reads as open');
  assert.match(tags.trigger, /aria-controls="ssel-list-sep"/);
  assert.match(tags.row, /\bisel-open\b/, 'the row carries isel-open');
  assert.doesNotMatch(tags.row, /\bstack\b/, 'and is not restacked: the trigger stays in place');
  assert.ok(html.indexOf('isel-list') > html.indexOf('data-select="sep"'),
    'the list follows the trigger inside its row');
  assert.doesNotMatch(selectRowTags(html, 'mark').trigger, /aria-expanded="true"/,
    'the other select stays collapsed');
});

test('boot(): opening a sheet\'s list moves focus onto its current option', () => {
  const focused = [];
  const r = bootWithFormatSheet({ modalQuery: (sel) => {
    if (sel === '.isel-list .ssel-opt.on[data-select-pick]') { return { focus: () => { focused.push(sel); } }; }
    return null;
  } });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.deepEqual(focused, ['.isel-list .ssel-opt.on[data-select-pick]']);
});

test('boot(): a gated current value hands focus to the first pickable option', () => {
  // The current value's option is gated (optionDisabledWhen), so it renders as a disabled
  // button, which cannot take focus. The query stand-in answers from the rendered list's
  // markup and, like a browser, lets a disabled match swallow focus() without moving it.
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [{ type: 'sheet', sheetId: 'g', label: 'Look' }] },
    { sheetOnly: true, sheetId: 'g', title: 'Look', items: [
      { type: 'toggle', messageKey: 'on', label: 'On', defaultValue: false },
      { type: 'select', messageKey: 'look', label: 'Look', defaultValue: 'bold',
        optionDisabledWhen: { bold: { key: 'on', eq: false } },
        options: [['Plain', 'plain'], ['Bold', 'bold']] }
    ] }
  ] }] };
  const focused = [];
  let r = null;
  const listQuery = (sel) => {
    const html = r ? r.modal.innerHTML : '';
    const at = html.indexOf('class="isel-list"');
    if (at < 0 || sel.indexOf('.isel-list ') !== 0) { return null; }
    const want = sel.slice('.isel-list '.length);
    const tag = (html.slice(at, html.indexOf('</div>', at)).match(/<button[^>]*>/g) || []).find((t) =>
      (want.indexOf('.ssel-opt.on') < 0 || /class="ssel-opt on"/.test(t))
      && (want.indexOf('[data-select-pick]') < 0 || /data-select-pick=/.test(t)));
    return tag ? { focus: () => { if (!/ disabled/.test(tag)) { focused.push(sel); } } } : null;
  };
  r = bootWithCapturedListeners(SCH, {}, { modalQuery: listQuery });
  clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'g' });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'look' });
  assert.match(r.modal.innerHTML, /class="ssel-opt on" role="option" aria-selected="true" disabled/,
    'the current value is gated');
  assert.deepEqual(focused, ['.isel-list [data-select-pick]'], 'focus lands on the first pickable option');
});

test('boot(): a pick in a sheet\'s inline list stores it, fires onChange once, collapses the list, keeps the sheet', () => {
  let triggerFocus = 0;
  const r = bootWithFormatSheet({ modalQuery: (sel) => (sel === '[data-select="sep"]'
    ? { focus: () => { triggerFocus++; } } : null) });
  const calls = [];
  r.onChange.register('sepPicked', (S, oldV, newV, env, key) => { calls.push([key, oldV, newV]); });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  clickMatching(r.modalListeners.click, '[data-select-pick]',
    { 'data-k': 'sep', 'data-select-pick': 'custom' });
  assert.equal(r.getValue('sep'), 'custom', 'the pick is stored');
  assert.deepEqual(calls, [['sep', 'slash', 'custom']], 'the row\'s onChange fired once');
  const html = r.modal.innerHTML;
  assert.equal(html.indexOf('isel-list'), -1, 'the list collapsed');
  assert.ok(html.indexOf('data-k="flag"') >= 0, 'the sheet is still open');
  assert.ok(html.indexOf('data-k="sepText"') >= 0, 'and re-rendered with the pick: the row it reveals is there');
  assert.doesNotMatch(selectRowTags(html, 'sep').trigger, /aria-expanded="true"/);
  assert.equal(triggerFocus, 1, 'focus returns to the row\'s trigger inside the sheet');
  assert.equal(r.focusCounts.select.sep || 0, 0, 'not to a trigger in the tab body');
  assert.equal(r.focusCounts['edit-sheet'].fmt || 0, 0, 'the sheet did not close');
});

test('boot(): a second tap on the trigger collapses the list without a pick', () => {
  const r = bootWithFormatSheet();
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'collapsed');
  assert.ok(r.modal.innerHTML.indexOf('data-k="flag"') >= 0, 'the sheet stays');
  assert.equal(r.getValue('sep'), 'slash', 'nothing picked');
  // A tap on a DIFFERENT select moves the one open list over to it.
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'mark' });
  assert.equal(r.modal.innerHTML.indexOf('id="ssel-list-sep"'), -1, 'the first list closed');
  assert.ok(r.modal.innerHTML.indexOf('id="ssel-list-mark"') >= 0, 'the second one opened');
});

test('boot(): an open palette and an open list in a sheet are mutually exclusive', () => {
  const r = bootWithFormatSheet();
  clickMatching(r.modalListeners.click, '[data-color]', { 'data-color': 'tone' });
  assert.ok(r.modal.innerHTML.indexOf('class="palette"') >= 0, 'the palette expands inside the sheet');
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.ok(r.modal.innerHTML.indexOf('isel-list') >= 0, 'the list opens');
  assert.equal(r.modal.innerHTML.indexOf('class="palette"'), -1, 'and the palette collapsed');
  clickMatching(r.modalListeners.click, '[data-color]', { 'data-color': 'tone' });
  assert.ok(r.modal.innerHTML.indexOf('class="palette"') >= 0, 'the palette opens again');
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'and the list collapsed');
});

test('boot(): Escape collapses an open list (or palette) first and closes the sheet on the next press', () => {
  ['list', 'palette'].forEach((what) => {
    const focused = [];
    const r = bootWithFormatSheet({ modalQuery: (sel) => (/^\[data-(select|color)="/.test(sel)
      ? { focus: () => { focused.push(sel); } } : null) });
    if (what === 'list') {
      clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
    } else {
      clickMatching(r.modalListeners.click, '[data-color]', { 'data-color': 'tone' });
    }
    r.modalListeners.cancel({ preventDefault: () => {} });
    assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, what + ': the first Escape collapses it');
    assert.equal(r.modal.innerHTML.indexOf('class="palette"'), -1, what + ': nothing stays expanded');
    assert.ok(r.modal.innerHTML.indexOf('data-k="flag"') >= 0, what + ': the sheet stays open');
    assert.deepEqual(focused, [what === 'list' ? '[data-select="sep"]' : '[data-color="tone"]'],
      what + ': focus goes back to its trigger');
    r.modalListeners.cancel({ preventDefault: () => {} });
    assert.equal(r.modal.innerHTML, '', what + ': the second Escape closes the sheet');
    assert.equal(r.focusCounts['edit-sheet'].fmt || 0, 1, what + ': focus returns to the Edit button');
  });
});

// Edit sheets are full-screen dialogs now: × and Done are the ways out (Escape too, see
// above). The bottom-sheet dismissals are gone by design — a full-screen dialog has no
// backdrop to tap, and a downward drag is no way to throw away (or keep) its changes.
test('boot(): × and Done close the sheet, list and all; it reopens collapsed', () => {
  const closes = {
    'the × button': (r) => clickMatching(r.modalListeners.click, '[data-dlg-close]', {}),
    'the Done button': (r) => clickMatching(r.modalListeners.click, '[data-dlg-done]', {})
  };
  Object.keys(closes).forEach((how) => {
    const r = bootWithFormatSheet();
    clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
    assert.ok(r.modal.innerHTML.indexOf('isel-list') >= 0, how + ': the list is open');
    closes[how](r);
    assert.equal(r.modal.innerHTML, '', how + ': the sheet itself closes, list and all');
    assert.equal(r.getValue('sep'), 'slash', how + ': nothing picked');
    assert.equal(r.focusCounts['edit-sheet'].fmt || 0, 1, how + ': focus returns to the row that opened it');
    clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'fmt' });
    assert.ok(r.modal.innerHTML.indexOf('data-select="sep"') >= 0, how + ': the sheet reopens');
    assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, how + ': collapsed');
  });
});

test('boot(): the backdrop and a swipe-down leave a full-screen sheet open', () => {
  const stays = {
    'the backdrop': (r) => r.modalListeners.click({ target: r.modal }),
    // The drag that dismissed the old bottom sheet: scrolled to its top, starting outside
    // the list, down past the 90 px threshold.
    'a swipe-down': (r) => {
      r.modalListeners.touchstart({ target: { closest: () => null }, touches: [{ clientY: 100 }] });
      r.modalListeners.touchmove({ touches: [{ clientY: 250 }], preventDefault: () => {} });
      r.modalListeners.touchend({ changedTouches: [{ clientY: 250 }] });
    }
  };
  Object.keys(stays).forEach((how) => {
    const list = { scrollTop: 0, querySelector: () => null };
    const r = bootWithFormatSheet({ modalQuery: (sel) => (sel === '.ssel-list' ? list : null) });
    stays[how](r);
    assert.ok(r.modal.innerHTML.indexOf('data-k="flag"') >= 0, how + ': the sheet stays open');
    assert.ok(!r.modal.style.transform, how + ': the dialog never followed a finger');
    assert.equal(r.focusCounts['edit-sheet'].fmt || 0, 0, how + ': nothing closed');
  });
});

test('boot(): a swipe that starts inside an open list never drags the sheet', () => {
  const list = { scrollTop: 0, querySelector: () => null };
  const r = bootWithFormatSheet({ modalQuery: (sel) => (sel === '.ssel-list' ? list : null) });
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  const inList = { closest: (sel) => (sel.indexOf('.isel-list') >= 0 ? inList : null) };
  let prevented = 0;
  r.modalListeners.touchstart({ target: inList, touches: [{ clientY: 100 }] });
  r.modalListeners.touchmove({ touches: [{ clientY: 250 }], preventDefault: () => { prevented++; } });
  r.modalListeners.touchend({ changedTouches: [{ clientY: 250 }] });
  assert.equal(prevented, 0, 'the drag never armed');
  assert.ok(!r.modal.style.transform, 'the sheet did not follow the finger');
  assert.ok(r.modal.innerHTML.indexOf('isel-list') >= 0, 'the sheet and its list stay open');
});

test('boot(): a disabled option in an inline list is inert', () => {
  const r = bootWithFormatSheet();
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'mark' });
  const html = r.modal.innerHTML;
  const locked = html.slice(html.lastIndexOf('<button', html.indexOf('Locked')), html.indexOf('Locked'));
  assert.match(locked, / disabled aria-disabled="true"/, 'the gated option renders disabled');
  assert.doesNotMatch(locked, /data-select-pick/, 'with no pick hook to match');
  // A tap on it: the delegated handlers find nothing to act on.
  const node = { closest: () => null, getAttribute: () => null };
  r.modalListeners.click({ target: node });
  assert.equal(r.getValue('mark'), 'none', 'the value is unchanged');
  assert.ok(r.modal.innerHTML.indexOf('id="ssel-list-mark"') >= 0, 'the list stays open');
  assert.ok(r.modal.innerHTML.indexOf('data-k="flag"') >= 0, 'so does the sheet');
});

// An open list lives only while its row renders live. The controls that hide a sheet's
// select (showWhen) or mute it (disabledWhen) sit in the same sheet, one tap away: the
// UV index slot sheet's Value selection over its Separator, an alert sheet's switch over
// its Tomorrow's mark.
const LIVE_ROW_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [{ type: 'sheet', sheetId: 'uv', label: 'UV index' }] },
    { sheetOnly: true, sheetId: 'uv', title: 'UV index', items: [
      { type: 'toggle', messageKey: 'alert', label: 'Alert', defaultValue: true },
      { type: 'segmented', messageKey: 'pick', label: 'Value selection', defaultValue: 'both',
        options: [['Now', 'now'], ['Both', 'both']] },
      { type: 'select', messageKey: 'sep', label: 'Separator', defaultValue: 'slash',
        showWhen: { key: 'pick', eq: 'both' }, options: [['3/7', 'slash'], ['3|7', 'bar']] },
      { type: 'select', messageKey: 'mark', label: 'Tomorrow\'s mark', defaultValue: 'none',
        disabledWhen: { key: 'alert', eq: false }, options: [['None', 'none'], ['»', 'raquo']] }
    ] }
  ] }]
};

/**
 * Boot LIVE_ROW_SCHEMA with a native-dialog #modal and open its edit sheet.
 * @returns {Object} The harness.
 */
function bootLiveRowSheet() {
  const r = bootWithCapturedListeners(LIVE_ROW_SCHEMA, {}, { dialog: true });
  clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'uv' });
  assert.equal(r.modal.open, true, 'the sheet opened');
  return r;
}

test('boot(): a list whose row a showWhen hides stops counting as open', () => {
  const r = bootLiveRowSheet();
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  assert.ok(r.modal.innerHTML.indexOf('id="ssel-list-sep"') >= 0, 'the list opens');
  assert.equal(r.modal.classes.has('picking'), true);
  // Now hides the Separator row.
  clickMatching(r.modalListeners.click, '[data-v]', { 'data-k': 'pick', 'data-v': 'now' });
  assert.equal(r.modal.innerHTML.indexOf('data-select="sep"'), -1, 'the row is hidden');
  assert.equal(r.modal.classes.has('picking'), false, 'the sheet drops back to its normal cap');
  // Both again: the row returns collapsed, not pre-opened.
  clickMatching(r.modalListeners.click, '[data-v]', { 'data-k': 'pick', 'data-v': 'both' });
  assert.ok(r.modal.innerHTML.indexOf('data-select="sep"') >= 0, 'the row is back');
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'collapsed');
  assert.match(selectRowTags(r.modal.innerHTML, 'sep').trigger, /aria-expanded="false"/);
  assert.equal(r.modal.classes.has('picking'), false);
  // Open it and hide the row again: a single Escape closes the sheet.
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'sep' });
  clickMatching(r.modalListeners.click, '[data-v]', { 'data-k': 'pick', 'data-v': 'now' });
  r.modalListeners.cancel({ preventDefault: () => {} });
  assert.equal(r.modal.open, false, 'one Escape closes the sheet');
  assert.equal(r.modal.innerHTML, '');
  assert.equal(r.focusCounts['edit-sheet'].uv || 0, 1, 'focus returns to the Edit button');
});

test('boot(): a list whose row a disabledWhen mutes collapses with it', () => {
  const r = bootLiveRowSheet();
  clickMatching(r.modalListeners.click, '[data-select]', { 'data-select': 'mark' });
  assert.ok(r.modal.innerHTML.indexOf('id="ssel-list-mark"') >= 0, 'the list opens');
  assert.equal(r.modal.classes.has('picking'), true);
  // The alert switch off mutes the row: .dis leaves its trigger untappable.
  clickMatching(r.modalListeners.click, '[data-toggle]', { 'data-k': 'alert' });
  const tags = selectRowTags(r.modal.innerHTML, 'mark');
  assert.match(tags.row, /\bdis\b/, 'the row is muted');
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'the list is gone');
  assert.doesNotMatch(tags.row, /isel-open/);
  assert.match(tags.trigger, /aria-expanded="false"/, 'the trigger reads as collapsed');
  assert.equal(r.modal.classes.has('picking'), false, 'the sheet drops back to its normal cap');
  // The switch back on: the row is live again, still collapsed.
  clickMatching(r.modalListeners.click, '[data-toggle]', { 'data-k': 'alert' });
  assert.doesNotMatch(selectRowTags(r.modal.innerHTML, 'mark').row, /\bdis\b/);
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'collapsed, not pre-opened');
  r.modalListeners.cancel({ preventDefault: () => {} });
  assert.equal(r.modal.open, false, 'one Escape closes the sheet');
});

test('renderEditModal: a muted member of an inline group never expands', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { sheetOnly: true, sheetId: 'fmt', title: 'Format', items: [
      { type: 'toggle', messageKey: 'on', label: 'On', defaultValue: false },
      { type: 'select', messageKey: 'a', label: 'A', inline: 'g', defaultValue: 'x',
        disabledWhen: { key: 'on', eq: false }, options: [['X', 'x'], ['Y', 'y']] },
      { type: 'select', messageKey: 'b', label: 'B', inline: 'g', defaultValue: 'x',
        options: [['X', 'x'], ['Y', 'y']] }
    ] }
  ] }] };
  const S = E.hydrate(SCH, {});
  const cx = (key) => ({ S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, openEdit: 'fmt',
    openInline: key, collapsed: {}, evalCtx: Object.assign({}, S, { env: {} }) });
  assert.equal(E.renderEditModal(SCH, cx('a')).indexOf('isel-list'), -1, 'the muted member stays shut');
  assert.ok(E.renderEditModal(SCH, cx('b')).indexOf('id="ssel-list-b" class="isel-list"') >= 0,
    'its live neighbour still expands');
});

test('renderEditModal/renderBody: only the sheet\'s copy of a key expands inline', () => {
  // The same select in a card AND in a sheet: an openInline key expands the sheet's row
  // only, so the card behind the sheet keeps its collapsed trigger.
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      { type: 'select', messageKey: 'sep', label: 'Separator', defaultValue: 'slash',
        options: [['12/10', 'slash'], ['Custom', 'custom']] }
    ] },
    { sheetOnly: true, sheetId: 'fmt', title: 'Format', items: [
      { type: 'select', messageKey: 'sep', label: 'Separator', defaultValue: 'slash',
        options: [['12/10', 'slash'], ['Custom', 'custom']] }
    ] }
  ] }] };
  const S = E.hydrate(SCH, {});
  const cx = { S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, openEdit: 'fmt',
    openInline: 'sep', collapsed: {}, evalCtx: Object.assign({}, S, { env: {} }) };
  const body = E.renderBody(SCH, 't', cx);
  assert.equal(body.indexOf('isel-list'), -1, 'the card row stays collapsed');
  assert.match(selectRowTags(body, 'sep').trigger, /aria-expanded="false"/);
  const sheet = E.renderEditModal(SCH, cx);
  assert.ok(sheet.indexOf('class="isel-list"') >= 0, 'the sheet row expands');
  assert.match(selectRowTags(sheet, 'sep').trigger, /aria-expanded="true"/);
  assert.match(sheet, /data-select-pick="custom" data-k="sep"/, 'its options pick into the key');
  assert.match(sheet, /class="ssel-opt on" role="option" aria-selected="true"/, 'the current value is checked');
});

test('boot(): a select in the tab body still opens the select modal and closes on a pick', () => {
  const r = bootWithCapturedListeners(COLOR_SURFACE_SCHEMA, {});
  clickMatching(r.listeners.click, '[data-select]', { 'data-select': 'mode' });
  assert.ok(r.modal.innerHTML.indexOf('data-ssel-list="mode"') >= 0, 'the modal list opens');
  assert.ok(r.modal.innerHTML.indexOf('class="ssel-list"') >= 0);
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1, 'never the in-sheet list');
  assert.match(selectRowTags(r.scroll.innerHTML, 'mode').trigger, /aria-expanded="true"/);
  assert.doesNotMatch(selectRowTags(r.scroll.innerHTML, 'mode').row, /isel-open/,
    'the tab-body row is not an inline-open row');
  clickMatching(r.modalListeners.click, '[data-select-pick]', { 'data-k': 'mode', 'data-select-pick': 'b' });
  assert.equal(r.getValue('mode'), 'b');
  assert.equal(r.modal.innerHTML, '', 'a pick closes the modal');
  assert.equal(r.focusCounts.select.mode, 1, 'focus returns to the tab-body trigger');
});

test('boot(): openSheet() still opens the select modal and a pick closes it once', () => {
  const r = bootWithCapturedListeners(COLOR_SURFACE_SCHEMA, {});
  let closed = 0;
  r.openSheet('mode', () => { closed++; });
  assert.ok(r.modal.innerHTML.indexOf('data-ssel-list="mode"') >= 0, 'the modal list opens');
  assert.equal(r.modal.innerHTML.indexOf('isel-list'), -1);
  clickMatching(r.modalListeners.click, '[data-select-pick]', { 'data-k': 'mode', 'data-select-pick': 'b' });
  assert.equal(r.getValue('mode'), 'b', 'the pick is stored');
  assert.equal(r.modal.innerHTML, '', 'and the sheet closes');
  assert.equal(closed, 1, 'onClose fired once');
  assert.equal(r.focusCounts.select.mode || 0, 0, 'no tab-body trigger takes focus');
});

test('boot(): a color swatch goes through setValue, so it fires the item\'s onChange', () => {
  const r = bootWithCapturedListeners(COLOR_SURFACE_SCHEMA, {});
  const calls = [];
  r.onChange.register('tintPicked', (S, oldV, newV, env, key) => {
    calls.push({ oldV, newV, key, sValue: S[key] });
  });
  clickMatching(r.listeners.click, '[data-color-pick]',
    { 'data-k': 'tint', 'data-color-pick': '#00AAFF' });
  assert.deepEqual(calls,
    [{ oldV: '#FF0000', newV: '#00AAFF', key: 'tint', sValue: '#00AAFF' }],
    'the hook sees the old and new values, and S is already written');
  assert.equal(r.getValue('tint'), '#00AAFF', 'the pick is stored');
});

test('boot(): onLoad hook context exposes the injected platform environment', () => {
  const env = { color: false, round: false, platform: 'aplite', health: false, radar: false, themePolarity: false };
  const result = bootWithCapturedListeners(THEME_SCHEMA, env);
  assert.strictEqual(result.loadEnv, env);
});

test('boot(): picking a modal option fires the item\'s registered onChange hook (replaces the native <select> change path)', () => {
  const { modalListeners, onChange } = bootWithCapturedListeners(THEME_SCHEMA, { color: true, round: false, platform: 'basalt' });
  let captured = null;
  onChange.register('themeConvert', (S, oldV, newV, env, key) => { captured = { oldV, newV, sTheme: S.theme, key }; });

  assert.equal(typeof modalListeners.click, 'function', 'a click listener was wired on #modal');
  const fakePick = { getAttribute: (a) => (a === 'data-k' ? 'theme' : a === 'data-select-pick' ? 'light' : null), closest: (sel) => (sel === '[data-select-pick]' ? fakePick : null) };
  modalListeners.click({ target: { closest: (sel) => (sel === '[data-select-pick]' ? fakePick : null) } });

  assert.ok(captured, 'the registered onChange hook fired for a modal pick');
  assert.equal(captured.oldV, 'dark', 'old value captured before the change');
  assert.equal(captured.newV, 'light', 'new value passed through');
  assert.equal(captured.sTheme, 'light', 'S was updated before the hook ran');
  assert.equal(captured.key, 'theme', 'the changed item messageKey is passed as the 5th onChange arg');
});

// A text item's onChange fires on COMMIT (change = blur / Enter), never per keystroke:
// the `input` listener keeps S live while typing, and only `change` dispatches the hook.
// A reverting hook (WarnWeather's validateThresholdPair) would otherwise be unable to let
// the user type "999" past an invalid "9". oldValue comes from the focusin sample, because
// `input` has already overwritten S[key] by commit time.
const TEXT_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'text', messageKey: 'limit', label: 'Limit', defaultValue: '10', onChange: 'clampLimit' },
    { type: 'text', messageKey: 'note', label: 'Note', defaultValue: '' }
  ] }] }]
};
/** One reusable synthetic text-field event (same node for focusin/input/change).
 * @param {string} key messageKey (data-k)
 * @param {string} value initial field text
 * @returns {{target: Object, input: Object}} event whose .input is the field node
 */
function textFieldEvent(key, value) {
  const inp = {
    value,
    getAttribute: (a) => (a === 'data-k' ? key : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null)
  };
  return { target: inp, input: inp };
}

test('boot(): a text item\'s onChange fires on commit (change), not on every keystroke', () => {
  const { listeners, onChange, getValue, scroll } = bootWithCapturedListeners(TEXT_SCHEMA, {});
  const calls = [];
  onChange.register('clampLimit', (S, oldV, newV, env, key) => {
    calls.push({ oldV, newV, key, sAtCall: S.limit });
    if (Number(newV) > 100) { S[key] = oldV; }   // reject the edit by reverting it
  });
  assert.equal(typeof listeners.focusin, 'function', 'a focusin listener was wired on #scroll');
  assert.equal(typeof listeners.change, 'function', 'a change listener was wired on #scroll');

  const ev = textFieldEvent('limit', '10');
  listeners.focusin(ev);
  ev.input.value = '9';                      // interim keystroke while typing "999"
  listeners.input(ev);
  assert.equal(getValue('limit'), '9', 'the input path keeps S live while typing');
  assert.equal(calls.length, 0, 'no hook dispatch per keystroke');
  ev.input.value = '999';
  listeners.input(ev);

  listeners.change(ev);
  assert.equal(calls.length, 1, 'the commit dispatched the hook exactly once');
  assert.equal(calls[0].oldV, '10', 'oldValue is the pre-edit value sampled at focusin');
  assert.equal(calls[0].newV, '999', 'newValue is the committed field text');
  assert.equal(calls[0].key, 'limit', 'the messageKey is passed as the 5th arg');
  assert.equal(calls[0].sAtCall, '999', 'S already carries the new value when the hook runs');
  assert.equal(getValue('limit'), '10', 'the hook reverted the rejected commit');
  assert.match(scroll.innerHTML, /data-k="limit" value="10"/,
    'the body was re-rendered so the corrected value is visible again');
});

test('boot(): committing a text item with no onChange hook keeps the typed value', () => {
  const { listeners, getValue } = bootWithCapturedListeners(TEXT_SCHEMA, {});
  const ev = textFieldEvent('note', '');
  listeners.focusin(ev);
  ev.input.value = 'hello';
  listeners.input(ev);
  listeners.change(ev);
  assert.equal(getValue('note'), 'hello');
});

// A text commit relabels select triggers IN PLACE: an optionsFrom resolver may name its
// options from a text key (WarnWeather's radar picker calls its Rainbow entry "limited"
// until an own key is typed), and commitTextChange deliberately skips render() — a full
// re-render there swallows the next tap. So on commit the engine rewrites only each
// rendered trigger's label span + aria-label, never the markup around it.
const RELABEL_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'text', messageKey: 'suffix', label: 'Suffix', defaultValue: '' },
    { type: 'text', messageKey: 'hooked', label: 'Hooked', defaultValue: '', onChange: 'acceptAll' },
    { type: 'select', messageKey: 'pick', label: 'Pick', defaultValue: 'a',
      optionsFrom: { resolver: 'suffixed' } },
    { type: 'select', messageKey: 'plain', label: 'Plain', defaultValue: 'p',
      options: [['P', 'p', { short: 'P!' }]] }
  ] }] }]
};
/** A rendered select trigger as the relabel reads it: its data-select key, an
 * aria-label, and the label <span>.
 * @param {string} key messageKey (data-select)
 * @param {string} label the label the trigger currently shows
 * @param {string} aria its current aria-label
 * @returns {{span: Object, attrs: Object, getAttribute: Function, setAttribute: Function,
 *   querySelector: Function}} trigger stub
 */
function triggerStub(key, label, aria) {
  const span = { textContent: label };
  const attrs = { 'data-select': key, 'aria-label': aria };
  return {
    span, attrs,
    getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = v; },
    querySelector: (sel) => (sel === 'span' ? span : null)
  };
}
/** Boot RELABEL_SCHEMA with one 'pick' trigger in #scroll and one in #modal, then
 * register the app-side resolver (the bundle installs its own registries, so it can
 * only be registered after boot).
 * @returns {Object} boot handles plus the two trigger stubs
 */
function bootRelabel() {
  const inPage = triggerStub('pick', 'A', 'Pick: A');
  const inSheet = triggerStub('pick', 'A', 'Pick: A');
  const plain = triggerStub('plain', 'P!', 'Plain: P!');
  const h = bootWithCapturedListeners(RELABEL_SCHEMA, {}, {
    scrollQueryAll: (sel) => (sel === '.sel-wrap[data-select]' ? [inPage, plain] : []),
    modalQueryAll: (sel) => (sel === '.sel-wrap[data-select]' ? [inSheet] : [])
  });
  global.PConf.optionsResolvers.register('suffixed', function (S) {
    if (S.suffix === 'drop') { return [['B', 'b']]; }
    return [['A' + (S.suffix ? ' ' + S.suffix : ''), 'a'], ['B', 'b']];
  });
  global.PConf.onChange.register('acceptAll', function () {});
  return Object.assign(h, { inPage, inSheet, plain });
}

test('boot(): a text commit relabels select triggers in place; typing alone does not', () => {
  const h = bootRelabel();
  const bodyBefore = h.scroll.innerHTML;
  const ev = textFieldEvent('suffix', '');
  h.listeners.focusin(ev);
  ev.input.value = 'x';
  h.listeners.input(ev);
  assert.equal(h.inPage.span.textContent, 'A', 'no relabel per keystroke');
  ev.input.value = 'xy';
  h.listeners.input(ev);
  h.listeners.change(ev);
  assert.equal(h.inPage.span.textContent, 'A xy', 'the page trigger shows the derived label');
  assert.equal(h.inPage.attrs['aria-label'], 'Pick: A xy', 'and announces it');
  assert.equal(h.inSheet.span.textContent, 'A xy', 'a trigger inside the dialog follows too');
  assert.equal(h.plain.span.textContent, 'P!', 'a static trigger keeps its (short) label');
  assert.equal(h.scroll.innerHTML, bodyBefore, 'no full re-render: the next tap still lands');
  assert.equal(h.getValue('pick'), 'a', 'the stored value is untouched');
});

test('boot(): the relabel also runs when a text item\'s onChange hook accepts the value', () => {
  const h = bootRelabel();
  const setSuffix = textFieldEvent('suffix', '');
  setSuffix.input.value = 'z';
  h.listeners.input(setSuffix);   // S.suffix = 'z' without a commit: no relabel yet
  assert.equal(h.inPage.span.textContent, 'A');
  const ev = textFieldEvent('hooked', '');
  h.listeners.focusin(ev);
  ev.input.value = 'ok';
  h.listeners.input(ev);
  h.listeners.change(ev);
  assert.equal(h.inPage.span.textContent, 'A z', 'any text commit relabels every trigger');
});

test('boot(): a trigger whose stored value left its derived options is left for the next render', () => {
  const h = bootRelabel();
  const ev = textFieldEvent('suffix', '');
  h.listeners.focusin(ev);
  ev.input.value = 'drop';
  h.listeners.input(ev);
  h.listeners.change(ev);
  assert.equal(h.inPage.span.textContent, 'A', 'no raw-value label painted in place');
  assert.equal(h.getValue('pick'), 'a', 'the relabel never snaps S — render() does');
});

test('selectTriggerLabel: the stored value\'s label from the CURRENT options; null when it left them', () => {
  const plain = RELABEL_SCHEMA.tabs[0].sections[0].items[3];
  assert.equal(E.selectTriggerLabel(plain, { plain: 'p' }, {}), 'P!', 'meta.short wins, as in the trigger');
  assert.equal(E.selectTriggerLabel(plain, { plain: 'gone' }, {}), null);
  global.PConf.optionsResolvers.register('suffixed', function (S) {
    return [['A' + (S.suffix ? ' ' + S.suffix : ''), 'a']];
  });
  const pick = RELABEL_SCHEMA.tabs[0].sections[0].items[2];
  assert.equal(E.selectTriggerLabel(pick, { pick: 'a', suffix: 'q' }, {}), 'A q');
  assert.equal(E.selectTriggerLabel(pick, { pick: 'b', suffix: 'q' }, {}), null);
});

test('findShownItem: the visible item of a shared messageKey wins; any match is the fallback', () => {
  const schema = { tabs: [{ id: 't', sections: [{ items: [
    { type: 'select', messageKey: 'theme', label: 'Color', options: [['Dark', 'dark']], showWhen: { env: 'color' } },
    { type: 'select', messageKey: 'theme', label: 'BW', options: [['Dark', 'dark']], showWhen: { not: { env: 'color' } } }
  ] }] }] };
  assert.equal(E.findShownItem(schema, 'theme', { env: { color: true } }).label, 'Color');
  assert.equal(E.findShownItem(schema, 'theme', { env: { color: false } }).label, 'BW');
  assert.equal(E.findShownItem(schema, 'nope', { env: {} }), null);
});

test('boot(): modal live-search on an optionsFrom searchSelect resolves options without throwing (regression: raw item threw)', () => {
  const schema = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'searchSelect', messageKey: 'country', label: 'Country', defaultValue: 'DE', options: [['Germany','DE']] },
    { type: 'searchSelect', messageKey: 'region', label: 'Region', defaultValue: 'all',
      optionsFrom: { byKey: 'country', map: { DE: [['Whole country','all'],['Bavaria','DE-BY']] } } }
  ] }] }] };
  const { modalListeners, sselList } = bootWithCapturedListeners(schema, { color: true, round: false, platform: 'basalt' });
  assert.equal(typeof modalListeners.input, 'function', 'a modal input listener was wired');
  const fakeSearch = { getAttribute: (a) => (a === 'data-select-search' ? 'region' : null), value: 'bav', closest: (sel) => (sel === '[data-select-search]' ? fakeSearch : null) };
  assert.doesNotThrow(() => {
    modalListeners.input({ target: { closest: (sel) => (sel === '[data-select-search]' ? fakeSearch : null) } });
  });
  assert.ok(sselList.innerHTML.indexOf('data-select-pick="DE-BY"') >= 0, 'derived optionsFrom option rendered');
  assert.ok(sselList.innerHTML.indexOf('data-select-pick="all"') < 0, 'query "bav" filtered out the non-matching option');
});

test('resolveTheme: no themeKey -> dark', () => {
  assert.equal(E.resolveTheme({ tabs: [] }, {}, true), 'dark');
  assert.equal(E.resolveTheme({ tabs: [] }, {}, false), 'dark');
});

test('resolveTheme: explicit light/dark ignore the media query', () => {
  const schema = { themeKey: 'ct', tabs: [] };
  assert.equal(E.resolveTheme(schema, { ct: 'light' }, false), 'light');
  assert.equal(E.resolveTheme(schema, { ct: 'dark' }, true), 'dark');
});

test('resolveTheme: auto follows prefers-color-scheme, unknown falls back to dark', () => {
  const schema = { themeKey: 'ct', tabs: [] };
  assert.equal(E.resolveTheme(schema, { ct: 'auto' }, true), 'light');
  assert.equal(E.resolveTheme(schema, { ct: 'auto' }, false), 'dark');
  assert.equal(E.resolveTheme(schema, {}, true), 'light');   // missing value = auto
  assert.equal(E.resolveTheme(schema, { ct: 'weird' }, false), 'dark');
});

test('hydrate: configTheme defaults to auto when absent from the saved blob', () => {
  const schema = require('../../settings/schema.js');
  const S = E.hydrate(schema, {});
  assert.equal(S.configTheme, 'auto');
});

// A block that repaints from an async completion (the Weather tab's fetch) asks
// which tab is on screen, so it never rebuilds a tab the user is typing in.
test('hooks: the onReady ctx reports the tab on screen, and follows a tab switch', () => {
  const schema = { tabs: [
    { id: 'general', label: 'General', sections: [{ items: [{ type: 'toggle', messageKey: 'a', label: 'A' }] }] },
    { id: 'weather', label: 'Weather', sections: [{ items: [{ type: 'toggle', messageKey: 'b', label: 'B' }] }] }
  ] };
  const h = bootWithCapturedListeners(schema, {});
  assert.equal(typeof h.activeTab, 'function', 'the ctx carries activeTab()');
  assert.equal(h.activeTab(), 'general', 'boot opens on the first tab');
  h.tabsListeners.click({ target: { closest: () => ({ getAttribute: () => 'weather' }) } });
  assert.equal(h.activeTab(), 'weather', 'a tab click moves it');
});

test('hooks: onReady runs registered fns with ctx (render/save exposed)', () => {
  let got = null;
  E.hooks.onReady((c) => { got = c; });
  E.hooks.runReady({ render: function () {}, save: function () {}, cfg: {} });
  assert.equal(typeof got.render, 'function');
  assert.equal(typeof got.save, 'function');
  assert.deepEqual(got.cfg, {});
});

test('serialize: hidden item is included in the blob', () => {
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'hidden', messageKey: 'onboardingDone', defaultValue: false }
  ] }] }] };
  const out = E.serialize(schema, E.hydrate(schema, {}));
  assert.equal(out.onboardingDone, false);
});

test('renderBody: button renders data-action row; hidden renders nothing', () => {
  const schema = { versionLabel: '', tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'button', label: 'Run setup again', action: 'startWizard' },
    { type: 'hidden', messageKey: 'onboardingDone', defaultValue: false }
  ] }] }] };
  const S = E.hydrate(schema, {});
  const cx = { S: S, ENV: {}, USERDATA: {}, collapsed: {}, evalCtx: Object.assign({}, S) };
  const html = E.renderBody(schema, 't', cx);
  assert.match(html, /data-action="startWizard"/);
  assert.match(html, /Run setup again/);
  assert.doesNotMatch(html, /onboardingDone/);
});

// --- segmented: per-option disable ------------------------------------------
// item.optionDisabledWhen maps an option VALUE to a showWhen-style condition.
// A matching option renders inert instead of vanishing, so a stored value can
// never be silently rewritten by the options-snapping path (which would, e.g.,
// turn a slot's stored "bold on warn" into "never bold" the moment its
// thresholds were switched off).
const SEG_ITEM = {
  type: 'segmented', messageKey: 'bold', label: 'Bold', defaultValue: 'warn',
  options: [['Off', 'off'], ['Warn', 'warn'], ['Always', 'always']],
  optionDisabledWhen: { warn: { not: { key: 'threshOn' } } }
};

const SEG_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T',
  sections: [{ title: 'S', items: [SEG_ITEM] }] }] };

function segBody(S) {
  return E.renderBody(SEG_SCHEMA, 't', {
    S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null,
    openDate: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} })
  });
}

test('segmented: an option whose condition holds renders disabled, not removed', () => {
  const html = segBody({ bold: 'warn', threshOn: false });
  assert.match(html, /data-v="warn"[^>]*disabled/, 'warn pill is inert');
  assert.match(html, />Warn</, 'warn pill is still shown');
  assert.match(html, /data-v="always"(?![^>]*disabled)/, 'always stays live');
  assert.match(html, /data-v="off"(?![^>]*disabled)/, 'off stays live');
});

test('segmented: no option is disabled once the condition is false', () => {
  const html = segBody({ bold: 'warn', threshOn: true });
  assert.equal(html.indexOf('disabled'), -1, 'every pill is live');
});

test('segmented: a disabled option keeps its stored value selected', () => {
  // The whole point of disabling rather than removing: 'warn' survives the
  // round-trip and lights up again when the gate reopens.
  const S = { bold: 'warn', threshOn: false };
  const html = segBody(S);
  assert.match(html, /class="on"[^>]*data-v="warn"/, 'warn is still the selection');
  assert.equal(S.bold, 'warn', 'stored value untouched');
});

test('segmented without optionDisabledWhen is unchanged', () => {
  const plain = E.renderControl(
    { type: 'segmented', messageKey: 'm', options: [['A', 'a'], ['B', 'b']] },
    { value: 'a' });
  assert.equal(plain.indexOf('disabled'), -1);
});

// A row may legitimately carry no label — the threshold slider's title moved onto
// its group sub-header, and repeating it on the row read as a stutter. Rendering
// esc(undefined) put the literal string "undefined" on the page.
test('a row without a label renders no label text at all', () => {
  const html = E.renderRow(
    { type: 'range', messageKey: 'r', min: 0, max: 10, step: 1, minSpan: 1 },
    { value: '2-8' });
  assert.equal(html.indexOf('undefined'), -1, 'no literal "undefined" on the page');
  assert.equal(html.indexOf('class="lbl"'), -1, 'no empty label box either');
});

test('a row without a label still renders its labelAction', () => {
  const html = E.renderRow(
    { type: 'toggle', messageKey: 't',
      labelAction: { action: 'doIt', arg: 'X', label: 'Reset' } },
    { value: false });
  assert.equal(html.indexOf('undefined'), -1);
  assert.match(html, /data-action="doIt"/);
});

test('a labelled row is unchanged', () => {
  const html = E.renderRow({ type: 'toggle', messageKey: 't', label: 'Vibrate' },
    { value: false });
  assert.match(html, /<div class="lbl">Vibrate<\/div>/);
});

test('titleFrom: a collapsed section header paints the resolved value; open/plain ones do not', () => {
  PConf.displayResolvers.register('pickLabel', function (S, env, args) {
    return S.mode === 'b' ? 'Bravo' : 'Alpha';
  });
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{
    id: 'pick', title: 'Provider', collapsible: true, titleFrom: { resolver: 'pickLabel' },
    items: [{ type: 'select', messageKey: 'mode', defaultValue: 'a', options: [['Alpha', 'a'], ['Bravo', 'b']] }]
  }] }] };
  const mkCx = (S, collapsed) => ({ S, ENV: {}, USERDATA: {}, openColor: null, collapsed,
    evalCtx: Object.assign({}, S, { env: {} }) });

  // Collapsed: header shows the resolved current pick.
  let html = E.renderBody(SCH, 't', mkCx({ mode: 'b' }, { pick: true }));
  assert.match(html, /class="ttlval">Bravo</);
  assert.equal(html.indexOf('data-k="mode"'), -1, 'collapsed card hides its rows');

  // Open: plain title, no ttlval — the row itself shows the value.
  html = E.renderBody(SCH, 't', mkCx({ mode: 'b' }, { pick: false }));
  assert.equal(html.indexOf('ttlval'), -1);
  assert.ok(html.indexOf('data-select="mode"') !== -1 || html.indexOf('data-k="mode"') !== -1,
    'open card renders the select');

  // Unknown resolver: header degrades to the plain title.
  const BAD = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{
    id: 'pick', title: 'Provider', collapsible: true, titleFrom: { resolver: 'nope' },
    items: [{ type: 'toggle', messageKey: 'x', defaultValue: false }]
  }] }] };
  html = E.renderBody(BAD, 't', mkCx({ x: false }, { pick: true }));
  assert.equal(html.indexOf('ttlval'), -1);
  assert.match(html, /class="ttl">Provider</);

  // A non-collapsible section ignores titleFrom entirely.
  const PLAIN = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{
    title: 'Provider', titleFrom: { resolver: 'pickLabel' },
    items: [{ type: 'toggle', messageKey: 'x', defaultValue: false }]
  }] }] };
  html = E.renderBody(PLAIN, 't', mkCx({ x: false, mode: 'b' }, {}));
  assert.equal(html.indexOf('ttlval'), -1);
});

test('initialTab: a tab may claim the opening slot, order alone does not', () => {
  const bar = (tabs) => ({ appName: 'X', versionLabel: 'v0', tabs: tabs });
  const T = (id, extra) => Object.assign({ id: id, label: id, sections: [] }, extra || {});

  // Plain schema: the first tab opens, as before.
  assert.equal(E.initialTab(bar([T('a'), T('b')]), {}), 'a');

  // A standing default wins over position — this is the round-10 shape:
  // Weather leads the bar, General still greets the user.
  const schema = bar([
    T('weather', { openWhen: { key: 'startOnWeatherTab', eq: true } }),
    T('general', { openDefault: true })
  ]);
  assert.equal(E.initialTab(schema, {}), 'general', 'leading the bar does not open the page');
  assert.equal(E.initialTab(schema, { startOnWeatherTab: false }), 'general', 'toggle off: unchanged');
  assert.equal(E.initialTab(schema, { startOnWeatherTab: true }), 'weather', 'toggle on: it claims the slot');
  // A truthy-but-not-true value does not satisfy an eq predicate.
  assert.equal(E.initialTab(schema, { startOnWeatherTab: 'yes' }), 'general', 'eq stays strict');

  // Claims are checked in bar order, and an empty schema is survivable.
  const two = bar([T('x', { openWhen: { key: 'k', eq: 1 } }), T('y', { openWhen: { key: 'k', eq: 1 } })]);
  assert.equal(E.initialTab(two, { k: 1 }), 'x', 'the first claimant wins');
  assert.equal(E.initialTab(bar([]), {}), '');
});

// ---- On demand engine additions: checklist, readout, compact rows, one-thumb range ----

// A checklist is a grid of ticks for ONE code (item.check): a row per option, and each
// row's ticks show that row's own lists (meta.keys, left to right). A tap goes to the
// writer the grid names (item.writeWith, a PConf.checkWriters id); the grid stores nothing.
/**
 * A tab with a grid over two rows and, in a sheet of their own, the hidden items of its
 * four lists (k1's carries an onChange, which a tick must not run).
 * @param {Object} [rowMeta] Merged over the first row's meta ({keys: ['k1', 'k2']}).
 * @param {Object} [grid] Merged over the grid item.
 * @returns {Object} Schema.
 */
function gridSchema(rowMeta, grid) {
  return { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'S', items: [
      Object.assign({ type: 'checklist', label: 'Shows on', check: 'x', writeWith: 'gridSpy',
        columns: [{ label: 'L' }, { label: 'R' }],
        options: [['Row 1', 'r1', Object.assign({ keys: ['k1', 'k2'] }, rowMeta || {})],
          ['Row 2', 'r2', { keys: ['k3', 'k4'], desc: 'Second' }]] }, grid || {})
    ] },
    { sheetOnly: true, sheetId: 'lists', items: [
      { type: 'hidden', messageKey: 'k1', defaultValue: 'p,y', onChange: 'listSpy' },
      { type: 'hidden', messageKey: 'k2', defaultValue: '' },
      { type: 'hidden', messageKey: 'k3', defaultValue: 'x' },
      { type: 'hidden', messageKey: 'k4', defaultValue: '' }
    ] }
  ] }] };
}
/**
 * Render tab 't' of a grid schema the way the page does, with no env and no userData.
 * @param {Object} SCH The schema (gridSchema()).
 * @param {Object} S The live settings it renders from (E.hydrate of SCH).
 * @returns {string} The tab body's HTML.
 */
function gridBody(SCH, S) {
  return E.renderBody(SCH, 't', { S: S, ENV: {}, USERDATA: {}, collapsed: {}, evalCtx: Object.assign({}, S, { env: {} }) });
}
/**
 * The attributes of the rendered tick that shows one list, read off the markup the way a
 * browser hands the engine its tapped element.
 * @param {string} html Rendered markup.
 * @param {string} key The tick's list (data-k).
 * @returns {Object<string, string>} Attribute name to value ('' for a bare attribute).
 */
function tickAttrs(html, key) {
  const tag = (html.match(/<button type="button" class="chk-tick[^>]*>/g) || [])
    .find((b) => b.indexOf(' data-k="' + key + '"') !== -1);
  assert.ok(tag, 'a tick shows ' + key);
  const attrs = {};
  const re = /\s([a-z-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(tag.slice('<button'.length, -1)))) { attrs[m[1]] = m[2] === undefined ? '' : m[2]; }
  return attrs;
}

test('checklist: one header captioned with the columns, a row per option, each tick naming its list, code and writer', () => {
  const SCH = gridSchema();
  const S = E.hydrate(SCH, {});
  const before = JSON.stringify(S);
  const html = gridBody(SCH, S);
  assert.equal(JSON.stringify(S), before, 'rendering never rewrites a list');
  assert.match(html, /<div class="row stack chk-row"><div><div class="chk-list" role="group" aria-label="Shows on">/,
    'a stacked row, only the grid\'s frame; the label names the grid');
  assert.equal(html.indexOf('<div class="lbl">'), -1, 'the label heads the grid, not the row');
  assert.ok(html.indexOf('<div class="chk-list" role="group" aria-label="Shows on"><div class="subhdr grp chk-hdr">'
    + '<span>Shows on</span><span class="chk-caps" aria-hidden="true"><span>L</span><span>R</span></span></div>'
    + '<div class="row chk-opt nb">') !== -1, 'one sub-header: the label, then the captions over the ticks');
  assert.equal(html.split('chk-hdr').length - 1, 1, 'exactly one header');
  assert.equal(html.slice(html.indexOf('<div class="chk-list')).indexOf('card'), -1, 'no cards in the grid');
  assert.deepEqual(html.match(/<button type="button" class="chk-tick[^>]*>/g), [
    '<button type="button" class="chk-tick" role="checkbox" aria-checked="false" aria-label="Row 1, L" data-k="k1" data-check="x" data-write="gridSpy">',
    '<button type="button" class="chk-tick" role="checkbox" aria-checked="false" aria-label="Row 1, R" data-k="k2" data-check="x" data-write="gridSpy">',
    '<button type="button" class="chk-tick on" role="checkbox" aria-checked="true" aria-label="Row 2, L" data-k="k3" data-check="x" data-write="gridSpy">',
    '<button type="button" class="chk-tick" role="checkbox" aria-checked="false" aria-label="Row 2, R" data-k="k4" data-check="x" data-write="gridSpy">'
  ], 'a tick names its row\'s list, the one code and the grid\'s writer; it is on while that list holds the code');
  assert.ok(html.indexOf('<div class="row chk-opt nb"><span class="lft"><span class="lbl">Row 1</span></span>') !== -1,
    'the rows join');
  assert.ok(html.indexOf('<div class="row chk-opt"><span class="lft"><span class="lbl">Row 2</span>'
    + '<span class="hint">Second</span></span>') !== -1, 'the last row ends the grid; meta.desc is its hint');
  // meta.disabled: inert ticks that keep their state.
  const off = gridSchema({ disabled: true });
  const offHtml = gridBody(off, E.hydrate(off, { k1: 'x' }));
  assert.match(offHtml, /<div class="row chk-opt nb off">/);
  assert.match(offHtml, /class="chk-tick on" role="checkbox" aria-checked="true" aria-label="Row 1, L" data-k="k1" data-check="x" data-write="gridSpy" disabled aria-disabled="true">/);
  assert.match(offHtml, /aria-label="Row 1, R" data-k="k2" data-check="x" data-write="gridSpy" disabled aria-disabled="true">/);
  assert.match(offHtml, /aria-label="Row 2, L" data-k="k3" data-check="x" data-write="gridSpy">/, 'the other row stays live');
  // The grid stores nothing: only the lists' own items are saved.
  assert.deepEqual(E.serialize(SCH, S), { k1: 'p,y', k2: '', k3: 'x', k4: '' });
});

test('checklist: optionsFrom rows are materialized without touching the lists', () => {
  global.PConf.optionsResolvers.register('gridRows', (S) => [['Only', 'o', { keys: ['k1', 'k2'], disabled: S.k3 === 'x' }]]);
  const SCH = gridSchema(null, { options: undefined, optionsFrom: { resolver: 'gridRows' } });
  const S = E.hydrate(SCH, { k1: 'zzz,x' });
  const html = gridBody(SCH, S);
  assert.equal((html.match(/<div class="row chk-opt/g) || []).length, 1, 'the resolver\'s rows');
  assert.match(html, /class="chk-tick on" role="checkbox" aria-checked="true" aria-label="Only, L" data-k="k1" data-check="x" data-write="gridSpy" disabled/,
    'a list holding other codes too still shows the tick, and the resolver gates the row');
  assert.equal(S.k1, 'zzz,x', 'rendering never rewrites a list');
});

test('boot(): a tick hands the tap to its grid\'s writer, asking for the state the tick does not show', () => {
  const r = bootWithCapturedListeners(gridSchema(), {});
  const calls = [], changes = [];
  global.PConf.onChange.register('listSpy', (S, oldV, newV, env, key) => { changes.push(key); });
  // A stand-in contract: the code alone, or nothing.
  global.PConf.checkWriters.register('gridSpy', (S, key, code, on) => {
    calls.push([key, code, on]);
    S[key] = on ? code : '';
  });
  const tap = (attrs) => clickMatching(r.listeners.click, '[data-check]', attrs);
  tap(tickAttrs(r.scroll.innerHTML, 'k1'));
  assert.deepEqual(calls, [['k1', 'x', true]], 'k1 does not hold x: the writer ticks it in');
  assert.equal(r.getValue('k1'), 'x', 'the writer\'s write stands');
  assert.match(r.scroll.innerHTML, /class="chk-tick on" role="checkbox" aria-checked="true" aria-label="Row 1, L" data-k="k1"/,
    'and the grid redraws from it');
  tap(tickAttrs(r.scroll.innerHTML, 'k1'));
  assert.deepEqual(calls[1], ['k1', 'x', false], 'a second tap asks for it out again');
  tap(tickAttrs(r.scroll.innerHTML, 'k3'));
  assert.deepEqual(calls[2], ['k3', 'x', false], 'k3 holds x: the writer ticks it out');
  assert.equal(r.getValue('k3'), '');
  assert.deepEqual(changes, [], 'no onChange runs: the writer is the lists\' contract');
  // A gated tick ignores the tap, and so does a tick whose writer is not registered.
  tap(Object.assign(tickAttrs(r.scroll.innerHTML, 'k2'), { disabled: '' }));
  tap(Object.assign(tickAttrs(r.scroll.innerHTML, 'k2'), { 'data-write': 'nobody' }));
  assert.equal(calls.length, 3, 'no write for a gated tick or an unknown writer');
  assert.equal(r.getValue('k2'), '');
});

// The tab switch's other way in: a [data-goto-tab] link in copy. Tabs a and b, and h,
// whose showWhen fails (a tab its platform lacks); tab a's card and a sheet link to both.
const tabLink = (tab) => '<button type="button" class="txt-link" data-goto-tab="' + tab + '">' + tab + '</button>';
const TAB_LINK_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [
  { id: 'a', label: 'A', sections: [
    { title: 'Sa', items: [
      { type: 'toggle', messageKey: 'ta', label: 'On A', defaultValue: false },
      { type: 'staticText', text: 'Go to ' + tabLink('b') + ' or ' + tabLink('h') + '.' },
      { type: 'sheet', label: 'Open', sheetId: 'sh' }
    ] },
    { sheetOnly: true, sheetId: 'sh', title: 'Sheet', items: [
      { type: 'staticText', style: 'info', text: 'Set in ' + tabLink('b') + ' or ' + tabLink('h') + '.' }
    ] }
  ] },
  { id: 'b', label: 'B', sections: [{ title: 'Sb', items: [{ type: 'toggle', messageKey: 'tb', label: 'On B', defaultValue: false }] }] },
  { id: 'h', label: 'H', showWhen: { env: 'nope' },
    sections: [{ title: 'Sh', items: [{ type: 'toggle', messageKey: 'th', label: 'On H', defaultValue: false }] }] }
] };
const goTo = (listener, tab) => clickMatching(listener, '[data-goto-tab]', { 'data-goto-tab': tab });
const tapTab = (r, tab) => r.tabsListeners.click({ target: { closest: () => ({ getAttribute: () => tab }) } });

test('boot(): a [data-goto-tab] link in the tab body brings its tab to the front', () => {
  const r = bootWithCapturedListeners(TAB_LINK_SCHEMA, {});
  assert.match(r.scroll.innerHTML, /<button type="button" class="txt-link" data-goto-tab="b">b<\/button>/,
    'the link is the copy\'s own markup');
  goTo(r.listeners.click, 'b');
  assert.equal(r.activeTab(), 'b');
  assert.match(r.tabs.innerHTML, /<button class="tab on" data-tab="b">/, 'the bar marks the new tab');
  assert.match(r.scroll.innerHTML, /data-k="tb"/, 'the new tab\'s body renders');
  assert.doesNotMatch(r.scroll.innerHTML, /data-k="ta"/, 'the old one is gone');
});

test('boot(): after a tab link, focus moves to the new tab\'s button, not <body>', () => {
  const focused = [];
  const bar = { querySelector: (sel) => (sel !== '.tab.on' ? null
    : { focus: () => { focused.push((/class="tab on" data-tab="(\w+)"/.exec(bar.self.innerHTML) || [])[1]); } }) };
  const r = bootWithCapturedListeners(TAB_LINK_SCHEMA, {}, { tabs: bar });
  bar.self = r.tabs;
  goTo(r.listeners.click, 'h');
  assert.deepEqual(focused, [], 'a link to a hidden tab moves nothing');
  goTo(r.listeners.click, 'b');
  assert.deepEqual(focused, ['b'], 'the B tab\'s button takes focus');
  tapTab(r, 'a');
  assert.deepEqual(focused, ['b'], 'a tab-bar tap keeps focus where the tap put it');
});

test('boot(): a link to a tab the bar hides, or to no tab, changes nothing', () => {
  const r = bootWithCapturedListeners(TAB_LINK_SCHEMA, {});
  assert.doesNotMatch(r.tabs.innerHTML, /data-tab="h"/, 'the env-hidden tab is not in the bar');
  goTo(r.listeners.click, 'h');
  assert.equal(r.activeTab(), 'a');
  goTo(r.listeners.click, 'zz');
  assert.equal(r.activeTab(), 'a');
  assert.match(r.scroll.innerHTML, /data-k="ta"/);
});

test('boot(): a link inside an open sheet closes the sheet and switches; a hidden target keeps it open', () => {
  const r = bootWithCapturedListeners(TAB_LINK_SCHEMA, {}, { dialog: true });
  clickMatching(r.listeners.click, '[data-edit-sheet]', { 'data-edit-sheet': 'sh' });
  assert.equal(r.modal.open, true, 'the sheet opens');
  assert.match(r.modal.innerHTML, /data-goto-tab="b"/, 'its box carries the link');
  goTo(r.modalListeners.click, 'h');
  assert.equal(r.modal.open, true, 'a hidden target leaves the sheet open');
  assert.equal(r.activeTab(), 'a');
  goTo(r.modalListeners.click, 'b');
  assert.equal(r.modal.open, false, 'the sheet closes');
  assert.equal(r.modal.innerHTML, '', 'nothing is left drawn in the dialog');
  assert.equal(r.activeTab(), 'b');
  assert.match(r.scroll.innerHTML, /data-k="tb"/);
});

test('boot(): each tab keeps its scroll offset, and a switch scrolls an off-screen tab into the bar', () => {
  // A 360px bar with 18px side padding over tabs at fixed x, less the bar's scrollLeft:
  // A at 18-58 (where it rests), B at 400-460 (off screen to the right).
  const X = { a: [18, 58], b: [400, 460] };
  const bar = { scrollLeft: 0 };
  const onTab = () => (/class="tab on" data-tab="(\w+)"/.exec(bar.self.innerHTML) || [])[1];
  Object.assign(bar, {
    getBoundingClientRect: () => ({ left: 0, right: 360 }),
    querySelector: (sel) => (sel !== '.tab.on' ? null : { getBoundingClientRect: () => ({
      left: X[onTab()][0] - bar.self.scrollLeft, right: X[onTab()][1] - bar.self.scrollLeft }) })
  });
  global.getComputedStyle = () => ({ paddingLeft: '18px' });
  try {
    const r = bootWithCapturedListeners(TAB_LINK_SCHEMA, {}, { tabs: bar });
    bar.self = r.tabs;
    r.scroll.scrollTop = 120;
    goTo(r.listeners.click, 'b');
    assert.equal(r.tabs.scrollLeft, 460 - (360 - 18), 'B comes into view, the bar\'s padding clear of the edge');
    assert.equal(r.scroll.scrollTop, 0, 'a tab not visited yet opens at its top');
    r.scroll.scrollTop = 40;
    tapTab(r, 'a');
    assert.equal(r.activeTab(), 'a');
    assert.equal(r.tabs.scrollLeft, 0, 'the first tab lands where it rests');
    assert.equal(r.scroll.scrollTop, 120, 'A comes back where it was left');
    tapTab(r, 'b');
    assert.equal(r.scroll.scrollTop, 40, 'and so does B');
    tapTab(r, 'b');
    assert.equal(r.tabs.scrollLeft, 118, 'a tab already in view leaves the bar where it is');
  } finally {
    delete global.getComputedStyle;
  }
});

test('readout: label, icon and live hint, no control, no Edit, nothing serialized', () => {
  global.PConf.hintResolvers.register('readoutHint', (S) => 'Now ' + S.level);
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'toggle', messageKey: 'level', defaultValue: false },
    { type: 'readout', label: 'Quiet time', hintFrom: { resolver: 'readoutHint' } }
  ] }] }] };
  const S = E.hydrate(SCH, { level: true });
  const html = E.renderBody(SCH, 't', { S: S, ENV: {}, USERDATA: {}, collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} }) });
  assert.match(html, /<div class="lbl">Quiet time<\/div><div class="hint">Now true<\/div>/);
  assert.doesNotMatch(html.slice(html.indexOf('Quiet time')), /thr-btn|data-edit-sheet|data-k=/,
    'nothing to press');
  assert.deepEqual(Object.keys(E.serialize(SCH, S)), ['level'], 'the readout stores nothing');
});

test('compact: any row can take the status-slot rhythm', () => {
  const plain = E.renderRow({ type: 'select', messageKey: 'm', label: 'M', options: [['On', 'on']] }, { value: 'on' });
  const compact = E.renderRow({ type: 'select', messageKey: 'm', label: 'M', compact: true,
    options: [['On', 'on']] }, { value: 'on' });
  assert.doesNotMatch(plain, /class="row slot"/);
  assert.match(compact, /class="row slot"/);
});

const RCTL = require('../lib/range-control.js');

test('single range: one thumb, a plain value, off-step values shown snapped UP', () => {
  const item = { type: 'range', single: true, messageKey: 'lvl', label: 'Warn level',
    min: 10, max: 30, step: 10, unit: '%', defaultValue: '10' };
  const html = E.renderRange(item, { value: '20' });
  assert.match(html, /class="rng single" data-range="lvl" data-v="20"/);
  assert.match(html, /<div class="rng-val">20%<\/div>/);
  assert.equal((html.match(/data-range-thumb=/g) || []).length, 1, 'exactly one thumb');
  assert.match(html, /data-range-thumb="v" style="left:50%" role="slider" aria-label="Warn level"/);
  assert.match(html, /<div class="rng-ends"><span>10%<\/span><span>30%<\/span><\/div>/);
  // Off the grid: 5 -> 10, 15 -> 20, 25 -> 30; garbage -> the default; out of range clamps.
  [['5', 10], ['15', 20], ['25', 30], ['10', 10], ['30', 30], ['abc', 10], ['0', 10], ['31', 30],
    [undefined, 10]].forEach(([v, want]) => {
    assert.equal(RCTL.parseSingle(v, item), want, JSON.stringify(v));
  });
  const fine = Object.assign({}, item, { min: 5, step: 5 });
  for (let v = 5; v <= 30; v += 5) { assert.equal(RCTL.parseSingle(String(v), fine), v, 'on a 5-grid ' + v); }
  assert.equal(RCTL.snapUpToStep(11, 10, 30, 10), 20, 'up, never to the nearest');
});

test('single range: the dual and threshold variants are untouched', () => {
  assert.equal(RCTL.isSingleItem({ type: 'range', single: true }), true);
  assert.equal(RCTL.isSingleItem({ type: 'range' }), false);
  assert.equal(RCTL.isSingleItem({ type: 'range', single: true, rangeFrom: { resolver: 'x' } }), false);
  const dual = E.renderRange({ type: 'range', messageKey: 'r', min: 0, max: 10 }, { value: '2-8' });
  assert.match(dual, /data-lo="2" data-hi="8"/);
});

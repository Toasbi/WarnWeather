// src/pkjs/config-ui/test/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('serialize: every messageKey incl. showWhen-hidden; staticText skipped; colors stay hex', () => {
  const out = E.serialize(FIXTURE, E.hydrate(FIXTURE, {}));
  ['mode','flag','tint'].forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(out, k), 'dropped ' + k));
  assert.equal(out.tint, '#FF0055');
});

test('blocks registry: register/get; unknown id -> undefined', () => {
  E.blocks.register('demo', (state) => '<b>' + state.mode + '</b>');
  assert.equal(typeof E.blocks.get('demo'), 'function');
  assert.equal(E.blocks.get('nope'), undefined);
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
  const sel = E.renderControl({ type: 'select', messageKey: 'mode', options: [['A','a'],['B','b']] }, { value: 'a' });
  assert.ok(sel.indexOf('<option value="a" selected>A</option>') >= 0);
});

test('renderControl: text value and color display are HTML-escaped', () => {
  const txt = E.renderControl({ type: 'text', messageKey: 'q' }, { value: '"><b>' });
  assert.equal(txt.indexOf('"><b>'), -1, 'raw injection must not survive');
  assert.ok(txt.indexOf('&quot;&gt;&lt;b&gt;') >= 0);
  const col = E.renderControl({ type: 'color', messageKey: 'tint' }, { value: '#FF0055', openColor: null });
  assert.ok(col.indexOf('#FF0055') >= 0 && col.indexOf('sw-wrap') >= 0);
});

test('renderRow: stacked layout for text/radio/open-color, inline otherwise; hintByValue wins', () => {
  const inline = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'Flag', hint: 'h' }, { value: false });
  assert.ok(inline.indexOf('class="row"') >= 0 && inline.indexOf('lft') >= 0);
  const stacked = E.renderRow({ type: 'text', messageKey: 'q', label: 'Q' }, { value: '' });
  assert.ok(stacked.indexOf('class="row stack"') >= 0);
  const byVal = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'F', hint: 'base', hintByValue: { 'on': 'special' } }, { value: 'on' });
  assert.ok(byVal.indexOf('special') >= 0 && byVal.indexOf('base') === -1);
});

test('renderBody: only active tab, showWhen hides items, version footer present', () => {
  const cx = { S: E.hydrate(FIXTURE, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(FIXTURE, {}), { env: { color: true } }) };
  const html = E.renderBody(FIXTURE, 't', cx);
  assert.ok(html.indexOf('data-k="mode"') >= 0, 'visible select rendered');
  assert.equal(html.indexOf('data-toggle'), -1, 'flag hidden because mode!=b');
  assert.ok(html.indexOf('<div class="version">v0</div>') >= 0);
});

test('renderBody: empty section card is suppressed', () => {
  const EMPTY = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { title: 'Gone', items: [ { type: 'toggle', messageKey: 'x', defaultValue: false, showWhen: { key: 'never', eq: 'yes' } } ] }
  ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(EMPTY, 't', cx);
  assert.equal(html.indexOf('Gone'), -1, 'card with only hidden items is omitted');
});

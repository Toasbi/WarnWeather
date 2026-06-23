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

test('renderBody: consecutive inline-grouped items share one row with no internal divider', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'from', label: 'From', defaultValue: '22', options: [['22:00','22'],['07:00','7']], inline: 'sleep' },
    { type: 'select', messageKey: 'to',   label: 'To',   defaultValue: '7',  options: [['22:00','22'],['07:00','7']], inline: 'sleep' }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('data-k="from"') >= 0 && html.indexOf('data-k="to"') >= 0, 'both selects rendered');
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

test('renderBody: empty section card is suppressed', () => {
  const EMPTY = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [
    { title: 'Gone', items: [ { type: 'toggle', messageKey: 'x', defaultValue: false, showWhen: { key: 'never', eq: 'yes' } } ] }
  ] } ] };
  const cx = { S: {}, ENV: { color: true }, USERDATA: {}, openColor: null, collapsed: {}, evalCtx: { env: { color: true } } };
  const html = E.renderBody(EMPTY, 't', cx);
  assert.equal(html.indexOf('Gone'), -1, 'card with only hidden items is omitted');
});

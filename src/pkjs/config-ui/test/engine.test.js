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

test('renderRow: stacked layout for text/radio/open-color, inline otherwise; hintByValue wins', () => {
  const inline = E.renderRow({ type: 'toggle', messageKey: 'flag', label: 'Flag', hint: 'h' }, { value: false });
  assert.ok(inline.indexOf('class="row"') >= 0 && inline.indexOf('lft') >= 0);
  const stacked = E.renderRow({ type: 'text', messageKey: 'q', label: 'Q' }, { value: '' });
  assert.ok(stacked.indexOf('class="row stack"') >= 0);
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
  assert.ok(html.indexOf('<option value="empty" selected>Empty</option>') >= 0, 'snapped option rendered selected');
  assert.equal(html.indexOf('value="a"'), -1, 'the excluded option is not rendered');
});

test('renderBody materializes an optionsFrom select into the right <option>s', () => {
  const schema = { appName: 'X', versionLabel: '', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'select', messageKey: 'iv', defaultValue: '15', options: [['15 minutes','15']] },
    { type: 'select', messageKey: 'gpsCacheMin', defaultValue: '30', optionsFrom: { interval: 'iv', ladder: [30, 60, 1440] } }
  ] } ] } ] };
  const cx = { S: { iv: '15', gpsCacheMin: '30' }, ENV: { color: true }, USERDATA: {},
    openColor: null, collapsed: {}, evalCtx: { iv: '15', gpsCacheMin: '30', env: { color: true } } };
  const html = E.renderBody(schema, 't', cx);
  assert.ok(html.indexOf('<option value="15" selected>15 minutes</option>') >= 0);
  assert.ok(html.indexOf('<option value="30" selected>30 minutes</option>') >= 0);
  assert.ok(html.indexOf('<option value="60">1 hour</option>') >= 0);
  assert.ok(html.indexOf('<option value="1440">1 day</option>') >= 0);
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
  assert.ok(html.indexOf('<option value="60" selected>1 hour</option>') >= 0, 'snapped option rendered selected');
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
  assert.ok(html.indexOf('<option value="120" selected>2 hours</option>') >= 0);
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

test('renderSelectOptions: empty query lists all; current value flagged on', () => {
  const item = { messageKey: 'c', options: [['United States','US'],['Germany','DE'],['Spain','ES']] };
  const all = E.renderSelectOptions(item, 'DE', '');
  assert.ok(all.indexOf('>United States<') >= 0 && all.indexOf('>Germany<') >= 0 && all.indexOf('>Spain<') >= 0, 'all options present');
  assert.ok(all.indexOf('data-select-pick="DE"') >= 0 && all.indexOf('data-k="c"') >= 0, 'pick + key attrs');
  assert.ok(/class="ssel-opt on"[^>]*data-select-pick="DE"/.test(all), 'current value row is .on');
  assert.equal(/class="ssel-opt on"[^>]*data-select-pick="US"/.test(all), false, 'non-current row not .on');
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

test('renderControl searchSelect: closed shows trigger with current label, no search input', () => {
  const item = { type: 'searchSelect', messageKey: 'c', options: [['United States','US'],['Germany','DE']] };
  const html = E.renderControl(item, { value: 'DE', openSelect: null });
  assert.ok(html.indexOf('class="sel-wrap" data-select="c"') >= 0, 'trigger present');
  assert.ok(html.indexOf('>Germany<') >= 0, 'shows current option label');
  assert.equal(html.indexOf('data-select-search'), -1, 'no search input when closed');
});

test('renderControl searchSelect: open shows search input + list of all options', () => {
  const item = { type: 'searchSelect', messageKey: 'c', options: [['United States','US'],['Germany','DE']] };
  const html = E.renderControl(item, { value: 'DE', openSelect: 'c', selectQuery: '' });
  assert.ok(html.indexOf('data-select-search="c"') >= 0, 'search input present');
  assert.ok(html.indexOf('class="ssel-list" data-ssel-list="c"') >= 0, 'list container present');
  assert.ok(html.indexOf('>United States<') >= 0 && html.indexOf('>Germany<') >= 0, 'all options listed');
});

test('renderControl searchSelect: open list reflects the query', () => {
  const item = { type: 'searchSelect', messageKey: 'c', options: [['United States','US'],['Germany','DE']] };
  const html = E.renderControl(item, { value: 'US', openSelect: 'c', selectQuery: 'ger' });
  assert.ok(html.indexOf('>Germany<') >= 0, 'matching option shown');
  assert.equal(html.indexOf('>United States<'), -1, 'non-matching option filtered');
  assert.ok(html.indexOf('value="ger"') >= 0, 'search box keeps the typed query');
});

test('renderRow: an open searchSelect is stacked (full-width)', () => {
  const item = { type: 'searchSelect', messageKey: 'c', label: 'Country', options: [['A','a']] };
  const open = E.renderRow(item, { value: 'a', openSelect: 'c', selectQuery: '' });
  assert.ok(open.indexOf('class="row stack"') >= 0, 'open searchSelect row stacks');
  const closed = E.renderRow(item, { value: 'a', openSelect: null });
  assert.ok(closed.indexOf('class="row"') >= 0 && closed.indexOf('stack') === -1, 'closed searchSelect row is inline');
});

test('renderBody: searchSelect opened via cx.openSelect renders the search input', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
    { type: 'searchSelect', messageKey: 'c', label: 'Country', defaultValue: 'US', options: [['United States','US'],['Germany','DE']] }
  ] } ] } ] };
  const cx = { S: E.hydrate(SCH, {}), ENV: { color: true }, USERDATA: {}, openColor: null, openSelect: 'c', selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, E.hydrate(SCH, {}), { env: { color: true } }) };
  const html = E.renderBody(SCH, 't', cx);
  assert.ok(html.indexOf('data-select-search="c"') >= 0, 'open search input rendered through renderBody');
  assert.ok(html.indexOf('class="row stack"') >= 0, 'row is stacked while open');
});

test('onChange registry: register/get; unknown id -> undefined', () => {
  E.onChange.register('demo', (S, oldV, newV) => { S.touched = [oldV, newV]; });
  assert.equal(typeof E.onChange.get('demo'), 'function');
  assert.equal(E.onChange.get('nope'), undefined);
});

// boot() requires a DOM; drive it with a minimal document shim (same technique as
// statictext-showwhen.test.js) so wireInputs()'s real click/change listeners run.
// scroll.addEventListener here CAPTURES the listener (instead of no-op'ing it) so the
// test can invoke it directly, simulating a real browser event.
function bootWithCapturedListeners(schema, env) {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = fs.readFileSync(path.join(LIB, 'schema-walk.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'color.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'show-when.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(LIB, 'engine.js'), 'utf8')
    + '\nPConf.engine.boot();';
  const listeners = {};
  const scroll = { innerHTML: '', addEventListener: (type, fn) => { listeners[type] = fn; } };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener: () => {} });
  const ids = { scroll, tabs: generic(), save: generic(), appTitle: generic(), toast: generic() };
  const document = { getElementById: (id) => ids[id] || generic() };
  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'module', BUNDLE);
  const mod = { exports: {} };
  fn(document, schema, env, {}, {}, 'pebblejs://close#', mod);
  return { listeners, scroll, onChange: mod.exports.onChange };
}

const THEME_SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'select', messageKey: 'theme', label: 'Theme', defaultValue: 'dark', onChange: 'themeConvert',
      options: [['Dark', 'dark'], ['Light', 'light']] }
  ] }] }]
};

test('boot(): a native <select> change fires the item\'s registered onChange hook (regression: only the segmented [data-v] click path did)', () => {
  const { listeners, onChange } = bootWithCapturedListeners(THEME_SCHEMA, { color: true, round: false, platform: 'basalt' });
  let captured = null;
  onChange.register('themeConvert', (S, oldV, newV) => { captured = { oldV, newV, sTheme: S.theme }; });

  assert.equal(typeof listeners.change, 'function', 'a change listener was wired on #scroll');
  const fakeSelect = { getAttribute: (a) => (a === 'data-k' ? 'theme' : null), value: 'light' };
  listeners.change({ target: { closest: (sel) => (sel === 'select' ? fakeSelect : null) } });

  assert.ok(captured, 'the registered onChange hook fired for a select-driven change');
  assert.equal(captured.oldV, 'dark', 'old value captured before the change');
  assert.equal(captured.newV, 'light', 'new value passed through');
  assert.equal(captured.sTheme, 'light', 'S was updated before the hook ran');
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

// src/pkjs/config-ui/test/disclosure.test.js — the page's progressive disclosure: info
// text in view by default, or (the '?' mode, schema.infoIconsKey) a row's info text behind
// its '?' and a card's intro behind its header's '?'; subheaders
// splitting a section into cards, "More options", nav and link rows, From–To rows,
// panes with a pinned header, page-only (uiOnly) items, and the full-screen dialog's
// header. Pure renders only; the boot-time wiring (taps, the dialog stack and its
// revert) is driven through the real page in test/settings-restructure.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');
const defaults = require('../lib/defaults.js');

function cxFor(S, extra) {
  return Object.assign({
    S: S, ENV: {}, USERDATA: {}, openColor: null, openSelect: null, openDate: null,
    openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} })
  }, extra || {});
}
const ALL_OPEN = new Proxy({}, { get: () => true });
// The '?' mode's render context: info text behind '?' buttons.
const Q = { infoIcons: true };

// ── info text: in view by default ───────────────────────────────────────────

test('by default every info text shows in place and no ? is drawn', () => {
  const item = { type: 'toggle', messageKey: 'flag', label: 'Flag', hint: 'What the flag does.' };
  const row = E.renderRow(item, { value: false });
  assert.ok(row.indexOf('<div class="lbl">Flag</div><div class="hint">What the flag does.</div>') !== -1, row);
  assert.equal(row.indexOf('info-q'), -1);
  const S = E.hydrate(CARDS, {});
  const body = E.renderBody(CARDS, 't', cxFor(S));
  assert.equal(body.indexOf('info-q'), -1, 'no ? on a card either');
  assert.ok(body.indexOf('<span class="ttl">One</span></span></div><div><div class="intro">About one.</div>') !== -1, body);
  assert.ok(body.indexOf('<div class="intro">About two.</div>') !== -1);
  const hours = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'select', messageKey: 'from', label: 'From', groupLabel: 'Night hours', options: [['00:00', '0']], inline: 'h',
      defaultValue: '0', hint: 'Used by all three.' },
    { type: 'select', messageKey: 'to', label: 'To', options: [['00:00', '0']], inline: 'h', defaultValue: '0' }] }] }] };
  const hb = E.renderBody(hours, 't', cxFor(E.hydrate(hours, {})));
  // The hours row's hint runs full width under its label and pickers.
  assert.ok(/<div class="lbl">Night hours<\/div><\/div><div class="rgt hrs">[\s\S]*?<\/div><div class="hint">Used by all three\.<\/div><\/div>/.test(hb), hb);
  const dlg = { tabs: [{ id: 't', label: 'T', sections: [
    { sheetOnly: true, sheetId: 'd1', title: 'Dialog one', intro: 'What it is.', items: [
      { type: 'toggle', messageKey: 'k', label: 'K' }] }] }] };
  const modal = E.renderEditModal(dlg, cxFor({}, { openEdit: 'd1' }));
  assert.ok(modal.indexOf('<div class="dlg-intro">What it is.</div>') !== -1 && modal.indexOf('info-q') === -1, modal);
});

test('the schema\'s infoIconsKey picks the ? mode; without it the page keeps its text', () => {
  const schema = { infoIconsKey: 'hideInfoText', tabs: [] };
  assert.equal(E.infoIconsOn(schema, { hideInfoText: true }), true);
  assert.equal(E.infoIconsOn(schema, { hideInfoText: false }), false);
  assert.equal(E.infoIconsOn(schema, {}), false);
  assert.equal(E.infoIconsOn({ tabs: [] }, { hideInfoText: true }), false, 'no key named: text stays');
});

// ── the '?' mode ────────────────────────────────────────────────────────────

test('a row hint sits behind its ? until the info is open', () => {
  const item = { type: 'toggle', messageKey: 'flag', label: 'Flag', hint: 'What the flag does.' };
  const closed = E.renderRow(item, { value: false, infoIcons: true });
  // The '?' rides the label's last word (span.nw), so a narrow phone never strands it.
  assert.ok(closed.indexOf('<div class="lbl"><span class="nw">Flag<button type="button" class="info-q" data-info="k:flag"'
    + ' aria-expanded="false" aria-label="Info about Flag">?</button></span></div>') !== -1, closed);
  assert.equal(closed.indexOf('What the flag does.'), -1, 'the hint is not rendered while closed');
  const open = E.renderRow(item, { value: false, infoIcons: true, infoOpen: true });
  assert.ok(open.indexOf('class="info-q on" data-info="k:flag" aria-expanded="true" aria-label="Hide info about Flag"') !== -1);
  assert.ok(open.indexOf('<div class="hint">What the flag does.</div>') !== -1, 'open: the hint renders');
});

test('no hint, no ?; a label-less row, a readout and hintShown keep their hint in view', () => {
  assert.equal(E.renderRow({ type: 'toggle', messageKey: 'a', label: 'A' }, { value: true, infoIcons: true }).indexOf('info-q'), -1);
  const bare = E.renderRow({ type: 'range', messageKey: 'r', hint: 'Scale note.', min: 0, max: 10, defaultValue: '1-5' },
    { value: '1-5', infoIcons: true });
  assert.ok(bare.indexOf('Scale note.') !== -1 && bare.indexOf('info-q') === -1, 'no label: hint stays');
  const shown = E.renderRow({ type: 'toggle', messageKey: 'b', label: 'B', hint: 'Summary.', hintShown: true },
    { value: true, infoIcons: true });
  assert.ok(shown.indexOf('Summary.') !== -1 && shown.indexOf('info-q') === -1, 'hintShown: hint stays');
  const S = { x: 1 };
  global.PConf.hintResolvers.register('discReadout', () => 'Live state');
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'readout', label: 'R', hintFrom: { resolver: 'discReadout' } }] }] }] };
  const body = E.renderBody(schema, 't', cxFor(S, Q));
  assert.ok(body.indexOf('<div class="hint">Live state</div>') !== -1 && body.indexOf('info-q') === -1, 'readout');
});

test('renderBody opens exactly the rows the infoOpen map names', () => {
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'toggle', messageKey: 'a', label: 'A', hint: 'Hint A' },
    { type: 'toggle', messageKey: 'b', label: 'B', hint: 'Hint B' }] }] }] };
  const S = E.hydrate(schema, {});
  const body = E.renderBody(schema, 't', cxFor(S, { infoIcons: true, infoOpen: { 'k:b': true } }));
  assert.equal(body.indexOf('Hint A'), -1);
  assert.ok(body.indexOf('Hint B') !== -1);
});

// ── cards: titles, intros, subheaders ──────────────────────────────────────

const CARDS = { tabs: [{ id: 't', label: 'T', sections: [
  { id: 'one', title: 'One', intro: 'About one.', items: [
    { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: false },
    { type: 'subheader', text: 'Two', intro: 'About two.', toggleKey: 'b', labelAction: { action: 'resetTwo', label: 'Reset' } },
    { type: 'toggle', messageKey: 'b', label: 'B', defaultValue: true },
    { type: 'toggle', messageKey: 'c', label: 'C', defaultValue: false },
    { type: 'subheader', text: 'Gone' },
    { type: 'toggle', messageKey: 'd', label: 'D', defaultValue: false, showWhen: { key: 'a', eq: true } }
  ] },
  { intro: 'An untitled intro shows as it is.', items: [{ type: 'toggle', messageKey: 'e', label: 'E', defaultValue: false }] }
] }] };

test('subheaders split a section into cards; titled intros sit behind the header ?', () => {
  const S = E.hydrate(CARDS, {});
  const body = E.renderBody(CARDS, 't', cxFor(S, Q));
  const cards = (body.match(/<div class="card(?: nohdr)?">/g) || []).length;
  assert.equal(cards, 3, 'One, Two and the untitled card (Gone has no row to show)');
  assert.ok(body.indexOf('<div class="cardHdr"><span class="ttlwrap"><span class="ttl">One</span>'
    + '<button type="button" class="info-q" data-info="c:t:one/0"') !== -1, body);
  assert.equal(body.indexOf('About one.'), -1, 'the titled intro waits behind its ?');
  assert.ok(body.indexOf('<span class="ttl">Two</span><button type="button" class="info-q" data-info="c:t:one/1"') !== -1);
  assert.ok(body.indexOf('data-action="resetTwo"') !== -1, 'the subheader reset rides the card header');
  assert.ok(/<span class="ttl">Two<\/span>[\s\S]*?<\/span><button class="sw on" data-k="b" data-toggle="1" aria-label="B">/.test(body),
    'the hosted switch sits in the card header');
  assert.equal(body.indexOf('<div class="lbl">B'), -1, 'and not as a row of its own');
  assert.equal(body.indexOf('>Gone<'), -1, 'a card with no row to show drops out');
  assert.ok(body.indexOf('<div class="intro">An untitled intro shows as it is.</div>') !== -1);
  const open = E.renderBody(CARDS, 't', cxFor(S, { infoIcons: true, infoOpen: { 'c:t:one/0': true } }));
  assert.ok(open.indexOf('<div class="intro">About one.</div>') !== -1, 'open: the intro leads the card');
});

// ── More options ────────────────────────────────────────────────────────────

const MORE = { tabs: [{ id: 't', label: 'T', sections: [{ id: 's', title: 'S', items: [
  { type: 'toggle', messageKey: 'main', label: 'Main', defaultValue: false },
  { type: 'toggle', messageKey: 'x', label: 'X', defaultValue: false, more: true },
  { type: 'segmented', messageKey: 'y', label: 'Y', defaultValue: 'a', options: [['A', 'a'], ['B', 'b']], more: true },
  { type: 'toggle', messageKey: 'z', label: 'Z', defaultValue: false, more: true, showWhen: { key: 'main', eq: true } }
] }] }] };

test('more items wait behind a More options row that counts the ones it would show', () => {
  const S = E.hydrate(MORE, {});
  const moreOpen = {};
  const body = E.renderBody(MORE, 't', cxFor(S, { moreOpen: moreOpen, INITIAL: Object.assign({}, S) }));
  assert.ok(body.indexOf('data-k="main"') !== -1);
  ['x', 'y', 'z'].forEach(k => assert.equal(body.indexOf('data-k="' + k + '"'), -1, k + ' is behind More options'));
  assert.ok(body.indexOf('<button type="button" class="row more-row" data-more="t:s/0#more" aria-expanded="false">'
    + '<span class="more-lbl">More options</span><span class="more-n">2 more</span></button>') !== -1, body);
  assert.equal(moreOpen['t:s/0#more'], false, 'the card seeded its own (closed) entry');
  moreOpen['t:s/0#more'] = true;
  const open = E.renderBody(MORE, 't', cxFor(S, { moreOpen: moreOpen }));
  assert.ok(open.indexOf('data-k="x"') !== -1 && open.indexOf('data-k="y"') !== -1);
  assert.ok(open.indexOf('data-k="y"') < open.indexOf('Fewer options'), 'the rows, then Fewer options last');
  assert.ok(open.indexOf('<span class="more-lbl">Fewer options</span></button>') !== -1);
});

test('a card opens with its More options out when a hidden row was customised', () => {
  const S = E.hydrate(MORE, { y: 'b' });
  const moreOpen = {};
  const body = E.renderBody(MORE, 't', cxFor(S, { moreOpen: moreOpen, INITIAL: Object.assign({}, S) }));
  assert.equal(moreOpen['t:s/0#more'], true);
  assert.ok(body.indexOf('data-k="y"') !== -1, 'the customised row is in view');
});

test('a sheet row behind More options counts its dialog\'s values as its own', () => {
  // A nav row stores nothing: a customised value in the dialog it opens keeps the card's
  // More options out, so the row leading to it stays in view.
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ id: 's', title: 'S', items: [
    { type: 'toggle', messageKey: 'main', label: 'Main', defaultValue: false },
    { type: 'sheet', sheetId: 'dlg', label: 'Dialog', more: true }] },
    { sheetOnly: true, sheetId: 'dlg', title: 'Dialog', items: [{ type: 'toggle', messageKey: 'inner', label: 'I', defaultValue: false }] }
  ] }] };
  const S0 = E.hydrate(schema, {});
  const closed = E.renderBody(schema, 't', cxFor(S0, { moreOpen: {}, INITIAL: Object.assign({}, S0), schema: schema }));
  assert.ok(closed.indexOf('<span class="more-n">1 more</span>') !== -1, 'at its defaults: behind More options');
  const S1 = E.hydrate(schema, { inner: true });
  const open = E.renderBody(schema, 't', cxFor(S1, { moreOpen: {}, INITIAL: Object.assign({}, S1), schema: schema }));
  assert.ok(open.indexOf('data-edit-sheet="dlg"') !== -1 && open.indexOf('Fewer options') !== -1, 'customised: in view');
});

test('a page-only more item counts against its own default', () => {
  global.PConf.displayResolvers.register('discSep', (S) => S.a !== S.b);
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ id: 's', title: 'S', items: [
    { type: 'toggle', messageKey: 'a', label: 'A', defaultValue: false },
    { type: 'toggle', messageKey: 'b', label: 'B', defaultValue: false },
    { type: 'toggle', messageKey: 'sep', label: 'Separate', uiOnly: true, defaultValue: false, more: true,
      initFrom: { resolver: 'discSep' } }] }] }] };
  const S = E.hydrate(schema, { b: true });
  const moreOpen = {};
  E.renderBody(schema, 't', cxFor(S, { moreOpen: moreOpen, INITIAL: Object.assign({}, S), schema: schema }));
  assert.equal(moreOpen['t:s/0#more'], true);
});

// ── nav, link and From–To rows ──────────────────────────────────────────────

test('sheet rows are nav rows: summary in view, swatch and note before the chevron', () => {
  global.PConf.hintResolvers.register('discSummary', () => 'Warn 6 · Danger 8');
  global.PConf.badgeResolvers.register('discBadge', () => ({ label: 'Edit', dots: [{ color: '#FF0000' }] }));
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'sheet', sheetId: 'dlg', label: 'Levels', navNote: 'Alerts', hintFrom: { resolver: 'discSummary' },
      editBadgeFrom: { resolver: 'discBadge' }, summaryFaintFrom: { key: 'off', eq: true } },
    { type: 'button', label: 'Go', gotoTab: 'other', hint: 'To the other tab.' },
    { type: 'button', label: 'Reset all', action: 'resetAll', style: 'link', indent: true }] },
    { sheetOnly: true, sheetId: 'dlg', title: 'Dlg', items: [{ type: 'toggle', messageKey: 'q', label: 'Q' }] }] }] };
  const S = { off: false };
  const body = E.renderBody(schema, 't', cxFor(S));
  assert.ok(body.indexOf('<div class="row nav" data-edit-sheet="dlg" role="button" tabindex="0" style="cursor:pointer">'
    + '<div class="lft"><div class="lbl">Levels</div><div class="hint">Warn 6 · Danger 8</div></div>'
    + '<div class="rgt"><span class="thr-swatch" aria-hidden="true"><span class="pen-dot fill" style="--th-c:#FF0000"></span></span>'
    + '<span class="nav-note">Alerts</span><span class="chev">&#8250;</span></div></div>') !== -1, body);
  assert.equal(body.indexOf('thr-btn'), -1, 'no Edit button on a nav row');
  assert.ok(body.indexOf('data-goto-tab="other" role="button"') !== -1, 'gotoTab: a nav row to a tab');
  assert.ok(body.indexOf('<div class="hint">To the other tab.</div>') !== -1, 'its static hint is the summary');
  assert.ok(body.indexOf('<div class="row linkrow indent"><button type="button" class="txt-link" data-action="resetAll">Reset all</button></div>') !== -1);
  const faint = E.renderBody(schema, 't', cxFor({ off: true }));
  assert.ok(faint.indexOf('<div class="hint faint">Warn 6 · Danger 8</div>') !== -1, 'summaryFaintFrom dims it');
});

test('a nav row says its badge\'s state to a screen reader: the swatch is aria-hidden', () => {
  global.PConf.badgeResolvers.register('discNoteBadge', () => ({ label: 'Edit', ariaNote: '#C8280A',
    dots: [{ color: '#C8280A' }] }));
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'sheet', sheetId: 'dlg', label: 'Color', editBadgeFrom: { resolver: 'discNoteBadge' } }] },
    { sheetOnly: true, sheetId: 'dlg', title: 'Dlg', items: [{ type: 'toggle', messageKey: 'q', label: 'Q' }] }] }] };
  const body = E.renderBody(schema, 't', cxFor({}));
  assert.ok(body.indexOf('<div class="lft"><div class="lbl">Color</div><span class="sr-only">#C8280A</span></div>'
    + '<div class="rgt"><span class="thr-swatch" aria-hidden="true">') !== -1, body);
});

test('an inline group with a groupLabel is one From–To row', () => {
  const HOURS = [['00:00', '0'], ['07:00', '7'], ['22:00', '22']];
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'select', messageKey: 'from', label: 'From', groupLabel: 'Night hours', options: HOURS, inline: 'h',
      defaultValue: '22', hint: 'Used by all three.', indent: true },
    { type: 'select', messageKey: 'to', label: 'To', options: HOURS, inline: 'h', defaultValue: '7' }] }] }] };
  const S = E.hydrate(schema, {});
  const body = E.renderBody(schema, 't', cxFor(S, Q));
  assert.ok(body.indexOf('<div class="row hours indent"><div class="lft"><div class="lbl">Night <span class="nw">hours'
    + '<button type="button" class="info-q" data-info="g:Night hours:from"') !== -1, body);
  assert.ok(/<div class="rgt hrs"><button type="button" class="sel-wrap" data-select="from"[\s\S]*?22:00[\s\S]*?<span class="hrs-dash">–<\/span><button type="button" class="sel-wrap" data-select="to"/.test(body));
  assert.equal(body.indexOf('Used by all three.'), -1);
});

// ── panes and pinned headers ────────────────────────────────────────────────

test('a tab with panes pins its switcher and the active pane\'s block; other panes\' cards stay out', () => {
  global.PConf.blocks.register('discPinA', () => '<i>preview A</i>');
  global.PConf.blocks.register('discPinB', () => '<i>preview B</i>');
  const schema = { tabs: [{ id: 'g', label: 'G', panes: [
    { id: 'a', label: 'Alpha', pinBlock: 'discPinA' }, { id: 'b', label: 'Beta', pinBlock: 'discPinB' },
    { id: 'c', label: 'Gamma', showWhen: { env: 'never' } }], sections: [
    { pane: 'a', items: [{ type: 'toggle', messageKey: 'ka', label: 'KA' }] },
    { pane: 'b', items: [{ type: 'toggle', messageKey: 'kb', label: 'KB' }] }] }] };
  const S = {};
  const activePane = {};
  const body = E.renderBody(schema, 'g', cxFor(S, { activePane: activePane }));
  assert.ok(body.indexOf('<div class="pin"><div class="seg pane-seg" role="tablist">') === 0, body);
  assert.ok(body.indexOf('data-pane="g:a"') !== -1 && body.indexOf('data-pane="g:b"') !== -1);
  assert.equal(body.indexOf('data-pane="g:c"'), -1, 'a gated pane is not offered');
  assert.ok(body.indexOf('<div class="pin-blk"><i>preview A</i></div>') !== -1);
  assert.ok(body.indexOf('data-k="ka"') !== -1 && body.indexOf('data-k="kb"') === -1);
  assert.equal(activePane.g, 'a', 'the first shown pane is remembered');
  const b = E.renderBody(schema, 'g', cxFor(S, { activePane: { g: 'b' } }));
  assert.ok(b.indexOf('preview B') !== -1 && b.indexOf('data-k="kb"') !== -1 && b.indexOf('data-k="ka"') === -1);
});

test('a pinned header lets go while a colour palette is open, on a tab and in a dialog', () => {
  global.PConf.blocks.register('discLoose', () => '<i>preview</i>');
  const schema = { tabs: [{ id: 't', label: 'T', pinBlock: 'discLoose', sections: [
    { items: [{ type: 'color', messageKey: 'c', label: 'C', defaultValue: '#FF0000' }] },
    { sheetOnly: true, sheetId: 'd', title: 'D', pinBlock: 'discLoose', items: [
      { type: 'color', messageKey: 'c2', label: 'C2', defaultValue: '#FF0000' }] }] }] };
  const S = E.hydrate(schema, {});
  assert.ok(E.renderBody(schema, 't', cxFor(S)).indexOf('<div class="pin"><div class="pin-blk">') === 0, 'sticky');
  assert.ok(E.renderBody(schema, 't', cxFor(S, { openColor: 'c' })).indexOf('<div class="pin loose"><div class="pin-blk">') === 0,
    'an open palette: the header scrolls away with the page');
  assert.ok(E.renderEditModal(schema, cxFor(S, { openEdit: 'd' })).indexOf('<div class="pin dlg-pin"><div class="pin-blk">') !== -1);
  assert.ok(E.renderEditModal(schema, cxFor(S, { openEdit: 'd', openColor: 'c2' }))
    .indexOf('<div class="pin dlg-pin loose"><div class="pin-blk">') !== -1, 'and in a dialog');
});

test('a tab pinBlock pins without a switcher; one shown pane has none either', () => {
  global.PConf.blocks.register('discTabPin', () => '<b>tab preview</b>');
  const schema = { tabs: [{ id: 't', label: 'T', pinBlock: 'discTabPin', sections: [{ items: [{ type: 'toggle', messageKey: 'k', label: 'K' }] }] }] };
  const body = E.renderBody(schema, 't', cxFor({}));
  assert.ok(body.indexOf('<div class="pin"><div class="pin-blk"><b>tab preview</b></div></div>') === 0, body);
  assert.equal(body.indexOf('pane-seg'), -1);
});

test('tab.pinThrough scopes the pinned header to the cards up to that section, then it scrolls away', () => {
  global.PConf.blocks.register('discScopePin', () => '<b>scoped preview</b>');
  const card = (id, extra) => Object.assign({ id: id, title: id.toUpperCase(),
    items: [{ type: 'toggle', messageKey: 'k' + id, label: 'K' + id }] }, extra || {});
  const tab = (pinThrough, sections) => ({ tabs: [{ id: 't', label: 'T', pinBlock: 'discScopePin',
    pinThrough: pinThrough, sections: sections }] });
  // Where the scope's own </div> sits: walk the <div / </div> depth from its opening tag.
  const scopeCloseAt = (body) => {
    assert.equal(body.indexOf('<div class="pin-scope"><div class="pin"><div class="pin-blk"><b>scoped preview</b>'), 0, body);
    const re = /<div\b|<\/div>/g;
    let depth = 0, m;
    while ((m = re.exec(body))) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) { return m.index; }
    }
    return -1;
  };
  const at = (body, key) => body.indexOf('data-k="' + key + '"');
  // The cards up to and including 'b' share the scope; 'c' renders after it closes.
  const body = E.renderBody(tab('b', [card('a'), card('b'), card('c')]), 't', cxFor({}));
  let close = scopeCloseAt(body);
  assert.ok(close > at(body, 'kb') && close < at(body, 'kc'), 'the scope closes between b and c');
  assert.equal(body.split('pin-scope').length - 1, 1, 'one scope');
  // A pinThrough section that renders nothing here (sheetOnly, another pane) still ends it.
  const sheet = E.renderBody(tab('b', [card('a'), card('b', { sheetOnly: true, sheetId: 'sb' }), card('c')]), 't', cxFor({}));
  close = scopeCloseAt(sheet);
  assert.ok(close > at(sheet, 'ka') && close < at(sheet, 'kc'), 'closed before c');
  // The last section: the scope runs to the end of the tab, before the version line.
  const last = E.renderBody(tab('c', [card('a'), card('c')]), 't', cxFor({}));
  close = scopeCloseAt(last);
  assert.ok(close > at(last, 'kc') && close < last.indexOf('<div class="version">'), 'closed after c, before the version');
  // No pinThrough: no scope at all (the header pins through the whole tab, as before).
  const plain = E.renderBody(tab(undefined, [card('a')]), 't', cxFor({}));
  assert.equal(plain.indexOf('pin-scope'), -1);
  assert.equal(plain.indexOf('<div class="pin"><div class="pin-blk">'), 0);
});

// ── page-only items ─────────────────────────────────────────────────────────

test('every shown optionsFrom row snaps into its options, wherever it sits; hidden and dormant values stay', () => {
  global.PConf.optionsResolvers.register('discNotA', (S) => [['Off', 'off'], ['B', 'b'], ['C', 'c']]
    .filter((o) => o[1] === 'off' || o[1] !== S.first));
  const schema = { tabs: [{ id: 't', label: 'T', sections: [
    { items: [{ type: 'select', messageKey: 'first', label: 'First', options: [['B', 'b'], ['C', 'c']], defaultValue: 'b' }] },
    { sheetOnly: true, sheetId: 'd', title: 'D', items: [
      { type: 'select', messageKey: 'second', label: 'Second', optionsFrom: { resolver: 'discNotA' }, defaultValue: 'off' },
      { type: 'select', messageKey: 'third', label: 'Third', optionsFrom: { resolver: 'discNotA' }, defaultValue: 'off',
        dormantValues: ['b', 'c'] },
      { type: 'select', messageKey: 'hidden', label: 'Hidden', optionsFrom: { resolver: 'discNotA' }, defaultValue: 'off',
        showWhen: { key: 'never', eq: true } }] }] }] };
  const S = { first: 'c', second: 'c', third: 'c', hidden: 'c' };
  E.snapShownOptions(schema, S, {});
  assert.equal(S.second, 'off', 'a row in a closed dialog snaps to its default, as if it were on screen');
  assert.equal(S.third, 'c', 'a dormant value stays stored');
  assert.equal(S.hidden, 'c', 'a row its showWhen hides keeps its value');
});

test('a uiOnly item hydrates from its initFrom resolver and is never saved or seeded', () => {
  global.PConf.displayResolvers.register('discInit', (S) => S.a === S.b);
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'select', messageKey: 'a', options: [['1', '1'], ['2', '2']], defaultValue: '1' },
    { type: 'select', messageKey: 'b', options: [['1', '1'], ['2', '2']], defaultValue: '1' },
    { type: 'toggle', messageKey: 'same', uiOnly: true, defaultValue: false, initFrom: { resolver: 'discInit' } }] }] }] };
  assert.equal(E.hydrate(schema, {}).same, true);
  assert.equal(E.hydrate(schema, { b: '2' }).same, false);
  assert.equal(E.hydrate(schema, { same: 'stored value is ignored' }).same, true, 'never read from the blob');
  assert.equal(Object.prototype.hasOwnProperty.call(E.serialize(schema, E.hydrate(schema, {})), 'same'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(defaults.deriveDefaults(schema), 'same'), false);
});

// ── the full-screen dialog ──────────────────────────────────────────────────

test('renderEditModal: the dialog header (× or ‹, kicker, title with its ?, Done) and the pinned block', () => {
  global.PConf.blocks.register('discDlgPin', () => '<em>pinned</em>');
  const schema = { tabs: [{ id: 't', label: 'T', sections: [
    { sheetOnly: true, sheetId: 'd1', title: 'Dialog one', intro: 'What it is.', pinBlock: 'discDlgPin', items: [
      { type: 'toggle', messageKey: 'k', label: 'K' },
      { type: 'subheader', text: 'Second card' },
      { type: 'toggle', messageKey: 'k2', label: 'K2' }] }] }] };
  const S = {};
  const root = E.renderEditModal(schema, cxFor(S, { infoIcons: true, openEdit: 'd1', editKicker: 'Status bars' }));
  assert.ok(root.indexOf('<div class="dlg-hdr"><button type="button" class="dlg-x" data-dlg-close aria-label="Close and discard changes">&#215;</button>'
    + '<div class="dlg-ttlwrap"><span class="dlg-kick">Status bars</span><span class="dlg-ttlline">'
    + '<span class="ssel-modal-ttl dlg-ttl" id="esheet-ttl-d1">Dialog <span class="nw">one'
    + '<button type="button" class="info-q" data-info="d:d1"') === 0, root);
  // The title wraps rather than cut off, so its '?' rides the last word (labelWithInfo).
  assert.ok(root.indexOf('<button type="button" class="dlg-done" data-dlg-done>Done</button></div>') !== -1);
  assert.ok(root.indexOf('<div class="ssel-list esheet"><div class="pin dlg-pin"><div class="pin-blk"><em>pinned</em></div></div>') !== -1);
  assert.equal(root.indexOf('What it is.'), -1, 'the intro waits behind the title ?');
  assert.equal((root.match(/<div class="card(?: nohdr)?">/g) || []).length, 2, 'the subheader opens a second card');
  assert.ok(root.indexOf('<span class="ttl">Second card</span>') !== -1);
  const nested = E.renderEditModal(schema, cxFor(S, { infoIcons: true, openEdit: 'd1', editKicker: 'Parent',
    editNested: true, infoOpen: { 'd:d1': true } }));
  assert.ok(nested.indexOf('<button type="button" class="dlg-x" data-dlg-back aria-label="Back">&#8249;</button>') === 0 + '<div class="dlg-hdr">'.length);
  assert.ok(nested.indexOf('<div class="dlg-intro">What it is.</div>') !== -1);
});

test('a checklist with captionsOnly heads its grid with the captions alone', () => {
  global.PConf.optionsResolvers.register('discBars', () => [['Watch bar', 'top', { keys: ['l', 'r'] }],
    ['Radar bar', 'radar', { keys: ['rl', 'rr'], disabled: true, desc: 'Radar view is off' }]]);
  const schema = { tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'checklist', label: 'Shows on', captionsOnly: true, check: 'rain', writeWith: 'w',
      columns: [{ label: 'Left' }, { label: 'Right' }], optionsFrom: { resolver: 'discBars' } }] }] }] };
  const body = E.renderBody(schema, 't', cxFor({ l: 'rain', r: '' }));
  assert.ok(body.indexOf('<div class="chk-list" role="group" aria-label="Shows on"><div class="subhdr grp chk-hdr caps-only"><span></span>'
    + '<span class="chk-caps" aria-hidden="true"><span>Left</span><span>Right</span></span></div>') !== -1, body);
  assert.ok(body.indexOf('<span class="hint">Radar view is off</span>') !== -1, 'an inert row says why');
});

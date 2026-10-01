// src/pkjs/config-ui/test/attention.test.js — three small engine hooks a "something is
// missing here" row is built from:
//   - a badge's `tone: 'warn'` gives the row's Edit button the warn look (.thr-btn.warn);
//   - a staticText's `textFrom` derives its note from the live settings; '' renders nothing
//     at all, and the row above then keeps its divider;
//   - an item's `attentionFrom` (PConf.attentionResolvers) puts a dot on its tab's label
//     and is what the Save button's confirm dialog (renderConfirmModal) is made from.
// The Save flow itself (dialog, "Save anyway", the fix opening its sheet, no <dialog>
// saving at once) is driven through the real page in test/config-key-status.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

/**
 * A render context around a settings object, mirroring boot()'s cx.
 * @param {Object} S Settings state.
 * @param {Object} [env] Platform env.
 * @returns {Object} Render context.
 */
function cxFor(S, env) {
  const ENV = env || {};
  return {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null, openDate: null, openEdit: null,
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: ENV })
  };
}

E.hintResolvers.register('demoNote', (S, env, args) => (S.key ? '' : (S.useStatic ? null : args.text)));
E.attentionResolvers.register('demoAttention', (S, env, args) => (S[args.messageKey] === 'bad'
  ? { note: 'Needs a fix', title: 'Fix <it>', body: 'Because & so.', actionLabel: 'Fix it', sheet: args.sheet }
  : null));

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [
  { id: 'a', label: 'Alpha', sections: [{ title: 'Card', items: [
    { type: 'select', messageKey: 'pick', label: 'Pick', defaultValue: 'ok', options: [['Ok', 'ok'], ['Bad', 'bad']],
      attentionFrom: { resolver: 'demoAttention', args: { sheet: 'fixSheet' } } },
    { type: 'staticText', style: 'info', joinPrevious: true, text: 'STATIC',
      textFrom: { resolver: 'demoNote', args: { text: 'Derived & live' } } },
    { type: 'toggle', messageKey: 'after', label: 'After', defaultValue: false }
  ] }, { sheetOnly: true, sheetId: 'fixSheet', title: 'Fix', items: [
    { type: 'text', messageKey: 'key', label: 'Key', defaultValue: '' }
  ] }] },
  { id: 'b', label: 'Beta', sections: [{ title: 'Other', showWhen: { key: 'hideB', eq: false }, items: [
    { type: 'select', messageKey: 'pickB', label: 'Pick B', defaultValue: 'ok', options: [['Ok', 'ok'], ['Bad', 'bad']],
      attentionFrom: { resolver: 'demoAttention' } }
  ] }, { sheetOnly: true, sheetId: 'bSheet', title: 'B', items: [
    { type: 'select', messageKey: 'pickC', label: 'Pick C', defaultValue: 'ok', showWhen: { key: 'showC', eq: true },
      options: [['Ok', 'ok'], ['Bad', 'bad']], attentionFrom: { resolver: 'demoAttention' } }
  ] }] }
] };

test('a badge\'s tone "warn" gives the Edit button the warn look; no tone, the plain button', () => {
  const item = { type: 'select', messageKey: 'pick', label: 'Pick', options: [['Ok', 'ok']] };
  const warn = E.renderRow(item, { value: 'ok', editSheet: 's', editBadge: { label: 'Add key', tone: 'warn', dots: [] } });
  assert.match(warn, /<button type="button" class="thr-btn warn" data-edit-sheet="s"[^>]*><span>Add key<\/span><\/button>/);
  const plain = E.renderRow(item, { value: 'ok', editSheet: 's', editBadge: { label: 'Edit', dots: [] } });
  assert.match(plain, /<button type="button" class="thr-btn" data-edit-sheet="s"/);
  const odd = E.renderRow(item, { value: 'ok', editSheet: 's', editBadge: { tone: '" onclick="x', dots: [] } });
  assert.match(odd, /class="thr-btn" data-edit-sheet/, 'only the known tone becomes a class');
});

test('textFrom: the derived note, the static text on null, nothing at all on \'\'', () => {
  const live = E.renderBody(SCHEMA, 'a', cxFor({ pick: 'ok', key: '', after: false }));
  assert.match(live, /<div class="static join info"><div class="info-box">Derived & live<\/div><\/div>/,
    'the resolver\'s HTML, printed as is like any staticText\'s text');
  assert.match(live, /<div class="row nb">[\s\S]*?data-select="pick"/, 'the row above joins the note');

  const fallback = E.renderBody(SCHEMA, 'a', cxFor({ pick: 'ok', key: '', useStatic: true }));
  assert.match(fallback, /<div class="info-box">STATIC<\/div>/);

  const gone = E.renderBody(SCHEMA, 'a', cxFor({ pick: 'ok', key: 'k' }));
  assert.doesNotMatch(gone, /info-box|STATIC/, 'an empty derived note renders nothing');
  assert.match(gone, /<div class="row">[\s\S]*?data-select="pick"/, 'and the row above keeps its divider');

  assert.equal(E.resolveStaticText({ text: 'T' }, {}, {}), 'T', 'no textFrom: the text');
  assert.equal(E.resolveStaticText({ text: 'T', textFrom: { resolver: 'nope' } }, {}, {}), 'T',
    'an unregistered resolver falls back to the text');
  assert.equal(E.resolveStaticText({ textFrom: { resolver: 'nope' } }, {}, {}), '');
});

test('attentionFrom: a dot on the tab holding the row, its note in the tab\'s aria-label', () => {
  const fine = E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'ok', pickB: 'ok', hideB: false }));
  assert.doesNotMatch(fine, /tab-dot|aria-label/);
  const bar = E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'bad', pickB: 'ok', hideB: false }));
  assert.equal(bar, '<button class="tab on" data-tab="a" aria-label="Alpha (Needs a fix)">Alpha'
    + '<span class="tab-dot" aria-hidden="true"></span></button><button class="tab" data-tab="b">Beta</button>');
  assert.match(E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'ok', pickB: 'bad', hideB: false })),
    /data-tab="b" aria-label="Beta \(Needs a fix\)">Beta<span class="tab-dot"/, 'another tab\'s row dots that tab');
  assert.doesNotMatch(E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'ok', pickB: 'bad', hideB: true })), /tab-dot/,
    'a row in a hidden section asks for nothing');
  assert.match(E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'ok', pickC: 'bad', showC: true })), /data-tab="b"[^>]*>Beta<span class="tab-dot"/,
    'a row in a sheet counts for the tab the sheet belongs to');
  assert.doesNotMatch(E.renderTabBar(SCHEMA, 'a', cxFor({ pick: 'ok', pickC: 'bad', showC: false })), /tab-dot/,
    'a hidden row asks for nothing');
  assert.doesNotMatch(E.renderTabBar(SCHEMA, 'a'), /tab-dot/, 'no render context, no dots');
});

test('findAttention: the first row in schema order, or the first on one tab', () => {
  const cx = cxFor({ pick: 'bad', pickB: 'bad', hideB: false });
  const first = E.findAttention(SCHEMA, cx);
  assert.equal(first.tab, 'a');
  assert.equal(first.item.messageKey, 'pick');
  assert.deepEqual(first.attention, { note: 'Needs a fix', title: 'Fix <it>', body: 'Because & so.',
    actionLabel: 'Fix it', sheet: 'fixSheet' });
  assert.equal(E.findAttention(SCHEMA, cx, 'b').item.messageKey, 'pickB');
  assert.equal(E.findAttention(SCHEMA, cxFor({ pick: 'ok', pickB: 'ok' })), null);
  assert.equal(E.resolveAttention({ messageKey: 'pick' }, { pick: 'bad' }, {}), null, 'no attentionFrom');
  assert.equal(E.resolveAttention({ messageKey: 'pick', attentionFrom: { resolver: 'nope' } }, { pick: 'bad' }, {}), null);
});

test('renderConfirmModal: the title in the sheet header, the sentence, the fix first, then "Save anyway"', () => {
  assert.equal(E.renderConfirmModal(null), '');
  const html = E.renderConfirmModal({ title: 'Fix <it>', body: 'Because & so.', actionLabel: 'Fix it' });
  assert.match(html, /<span class="ssel-modal-ttl" id="cfm-ttl">Fix &lt;it&gt;<\/span>/);
  assert.match(html, /data-select-close aria-label="Close"/, 'the shared close button');
  assert.match(html, /<p class="cfm-body">Because &amp; so\.<\/p>/);
  assert.match(html, /<button type="button" class="cfm-btn pri" data-confirm="action">Fix it<\/button><button type="button" class="cfm-btn" data-confirm="save">Save anyway<\/button>/);
  const bare = E.renderConfirmModal({ title: 'T', confirmLabel: 'Keep going' });
  assert.doesNotMatch(bare, /data-confirm="action"|cfm-body/, 'no fix offered, no sentence: neither renders');
  assert.match(bare, /data-confirm="save">Keep going<\/button>/);
});

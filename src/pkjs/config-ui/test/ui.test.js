// src/pkjs/config-ui/test/ui.test.js — the page's shared parts (lib/ui.js): one builder per
// piece more than one place draws, and the engine drawing its own rows, cards and dialogs with
// them (its nav rows' red arrow, its folding cards' chevron, its dialogs' header and a Delete
// item under its card). test/repo/config-ui-parts.test.js holds the app's pages to them.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const ui = require('../lib/ui.js');
const E = require('../lib/engine.js');

test('attrs: each value escaped, true a bare attribute, null, undefined and false left out', () => {
  assert.equal(ui.attrs({ 'data-action': 'go', 'data-action-arg': 'a"<b>', on: true, off: false, none: null, gone: undefined }),
    ' data-action="go" data-action-arg="a&quot;&lt;b&gt;" on');
  assert.equal(ui.attrs({ 'data-j': 0 }), ' data-j="0"', 'a zero is a value');
  assert.equal(ui.attrs(null), '');
});

test('the icons: a line drawing in the text colour, hidden from assistive tech; an unknown name draws nothing', () => {
  ['plus', 'pen', 'check', 'x', 'grip'].forEach((name) => {
    assert.match(ui.icon(name), /^<svg class="ui-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M[^"]+"\/><\/svg>$/,
      name);
  });
  assert.equal(ui.icon('nope'), '');
});

test('the red arrow of what opens a screen, and the red ▸/▾ of what folds open in place', () => {
  assert.equal(ui.navArrow(), '<span class="chev nav" aria-hidden="true">&#8250;</span>');
  assert.equal(ui.foldChev(false), '<span class="chev fold" aria-hidden="true">&#9656;</span>', 'folded: ▸');
  assert.equal(ui.foldChev(true), '<span class="chev fold" aria-hidden="true">&#9662;</span>', 'open: ▾');
});

test('Delete, the Undo after it, a list\'s New row, a chip, the pencil, the name field, a note: escaped', () => {
  assert.equal(ui.deleteButton('Delete <b>', { 'data-se': 'delscreen' }),
    '<button type="button" class="ui-del" data-se="delscreen">Delete &lt;b&gt;</button>');
  assert.equal(ui.undoToast('A & B deleted.', { 'data-action': 'undo' }),
    '<div class="ui-toast" role="status"><span>A &amp; B deleted.</span><button type="button" class="ui-undo" data-action="undo">'
    + 'Undo</button></div>');
  assert.equal(ui.newRow('New bar', '4 of 6 bars', { 'data-action': 'newBar' }),
    '<button type="button" class="ui-row ui-new" data-action="newBar">' + ui.icon('plus')
    + '<span class="ui-n">New bar</span><span class="ui-d">4 of 6 bars</span></button>');
  assert.equal(ui.newRow('Add screen', '', { 'data-action': 'addScreen' }).indexOf('ui-d'), -1, 'no count, no line');
  assert.equal(ui.chip('Radar <bar>', { 'data-se': 'add', 'data-k': 'radarbar' }, { icon: 'plus' }),
    '<button type="button" class="ui-chip" data-se="add" data-k="radarbar">' + ui.icon('plus') + 'Radar &lt;bar&gt;</button>');
  assert.equal(ui.chip('Default', { 'aria-pressed': 'true' }, { icon: 'check', on: true }),
    '<button type="button" class="ui-chip on" aria-pressed="true">' + ui.icon('check') + 'Default</button>');
  assert.equal(ui.penButton('Mine "x"', { 'data-action': 'rename' }),
    '<button type="button" class="ui-pen" data-action="rename" aria-label="Rename Mine &quot;x&quot;">' + ui.icon('pen') + '</button>');
  assert.equal(ui.renameField({ at: { 'data-in': true }, okAt: { 'data-ok': true }, label: 'Bar name', maxlength: 24,
    placeholder: 'Bar <4>', value: 'A "b"' }),
  '<input type="text" class="ui-rn-in" data-in maxlength="24" autocomplete="off" aria-label="Bar name" placeholder="Bar &lt;4&gt;"'
    + ' value="A &quot;b&quot;"><button type="button" class="dlg-done" data-ok>OK</button>');
  assert.match(ui.renameField({ at: {}, okAt: {}, label: 'x', value: '' }), / maxlength="40" /, 'the engine\'s cap by default');
  assert.equal(ui.note('Too <tall>'), '<div class="ui-note" role="status">Too &lt;tall&gt;</div>');
});

test('the header of a full-screen view: the way out, the kicker over the title and its pencil, Done; renamed, the field with OK', () => {
  const o = { titleId: 't1', title: 'Flick <1>', kicker: 'Screens', way: { glyph: '&#8249;', label: 'Back', at: { 'data-se': 'close' } },
    pen: { 'data-se': 'rename' }, done: { 'data-se': 'close' }, rename: null };
  assert.equal(ui.header(o), '<div class="dlg-hdr"><button type="button" class="dlg-x" data-se="close" aria-label="Back">&#8249;</button>'
    + '<div class="dlg-ttlwrap"><span class="dlg-kick">Screens</span><span class="dlg-ttlline"><span class="ssel-modal-ttl dlg-ttl" '
    + 'id="t1">Flick &lt;1&gt;</span>' + ui.penButton('Flick <1>', { 'data-se': 'rename' }) + '</span></div>'
    + '<button type="button" class="dlg-done" data-se="close">Done</button></div>');
  const bare = ui.header(Object.assign({}, o, { pen: null, done: null, kicker: '' }));
  assert.equal(bare.indexOf('ui-pen'), -1, 'no pencil');
  assert.equal(bare.indexOf('Done'), -1, 'no Done: a view that only picks');
  assert.equal(bare.indexOf('dlg-kick'), -1, 'no kicker');
  assert.ok(ui.header(Object.assign({}, o, { titleHtml: 'Flick <b>1</b>' })).indexOf('id="t1">Flick <b>1</b></span>') !== -1,
    'titleHtml is markup (the engine glues its \'?\' on)');
  const renaming = ui.header(Object.assign({}, o, { rename: { at: { 'data-se-name': true }, okAt: { 'data-se': 'renameok' },
    label: 'Screen name', maxlength: 24, placeholder: 'Flick 1', value: 'Flick <1>' } }));
  assert.equal(renaming, '<div class="dlg-hdr renaming"><button type="button" class="dlg-x" data-se="close" aria-label="Back">&#8249;'
    + '</button><span class="ssel-modal-ttl sr-only" id="t1">Flick &lt;1&gt;</span>' + ui.renameField({ at: { 'data-se-name': true },
    okAt: { 'data-se': 'renameok' }, label: 'Screen name', maxlength: 24, placeholder: 'Flick 1', value: 'Flick <1>' }) + '</div>');
});

test('a popup\'s header: its title escaped, then the × that closes it, named for assistive tech', () => {
  assert.equal(ui.popupHeader('News & <more>', { 'data-news-close': '1' }),
    '<div class="ui-pop-hdr"><h2>News &amp; &lt;more&gt;</h2><button type="button" class="ui-pop-x" data-news-close="1"'
    + ' aria-label="Close">&#10005;</button></div>');
});

test('flash keeps a message for a while, then repaints without it; a new one replaces it; unflash takes it early', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const box = { v: null, t: null };
  let paints = 0;
  ui.flash(box, 'one', 3000, () => { paints += 1; });
  assert.equal(box.v, 'one');
  t.mock.timers.tick(2000);
  ui.flash(box, 'two', 3000, () => { paints += 1; });
  t.mock.timers.tick(2000);
  assert.equal(box.v, 'two', 'the first one\'s timer gone with it');
  assert.equal(paints, 0);
  t.mock.timers.tick(1000);
  assert.equal(box.v, null);
  assert.equal(box.t, null);
  assert.equal(paints, 1, 'one repaint as it goes');
  ui.flash(box, 'three', 3000, () => { paints += 1; });
  ui.unflash(box);
  t.mock.timers.tick(5000);
  assert.equal(box.v, null);
  assert.equal(paints, 1, 'taken early: no repaint left');
});

// --- the engine draws its own with them ----------------------------------------------

test('the engine: a nav row ends on the red arrow, a folding card\'s header on the ▸/▾', () => {
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'Nav', items: [{ type: 'button', action: 'go', label: 'Go' }] },
    { id: 'fold', title: 'Fold', collapsible: true, items: [{ type: 'toggle', messageKey: 'f', defaultValue: false }] }
  ] }] };
  const S = E.hydrate(SCH, {});
  const cx = (collapsed) => ({ S, ENV: {}, USERDATA: {}, collapsed, evalCtx: Object.assign({}, S, { env: {} }) });
  let html = E.renderBody(SCH, 't', cx({ fold: true }));
  assert.ok(html.indexOf('<div class="rgt">' + ui.navArrow() + '</div></div>') !== -1, 'the nav row\'s red arrow');
  assert.ok(html.indexOf('aria-expanded="false">') !== -1 && html.indexOf(ui.foldChev(false) + '</button>') !== -1, 'folded: ▸');
  html = E.renderBody(SCH, 't', cx({}));
  assert.ok(html.indexOf('aria-expanded="true">') !== -1 && html.indexOf(ui.foldChev(true) + '</button>') !== -1, 'open: ▾');
});

test('the engine: a Delete item (style \'delete\') is drawn under its card, outside it, by its label or labelFrom', () => {
  E.hintResolvers.register('probeDeleteLabel', (S) => 'Delete ' + (S.probeName || 'it'));
  E.whenResolvers.register('probeDeletable', (S) => S.probeName !== 'first');
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
    { title: 'Main', items: [
      { type: 'hidden', messageKey: 'probeName', defaultValue: 'Long' },
      { type: 'toggle', messageKey: 'flag', label: 'Flag', defaultValue: false },
      { type: 'button', style: 'delete', action: 'deleteIt', actionArg: 2, label: 'Delete',
        labelFrom: { resolver: 'probeDeleteLabel' }, showWhen: { when: 'probeDeletable' } }
    ] },
    { sheetOnly: true, sheetId: 'dlg', title: 'Dialog', items: [
      { type: 'subheader', text: 'Slots' },
      { type: 'toggle', messageKey: 'flag2', label: 'Flag 2', defaultValue: false },
      { type: 'button', style: 'delete', action: 'deleteBar', actionArg: 'bar4', label: 'Delete bar' }
    ] }
  ] }] };
  const cx = (S, extra) => Object.assign({ S, ENV: {}, USERDATA: {}, collapsed: {}, evalCtx: Object.assign({}, S, { env: {} }) },
    extra || {});
  let S = E.hydrate(SCH, {});
  let html = E.renderBody(SCH, 't', cx(S));
  const del = '<button type="button" class="ui-del" data-action="deleteIt" data-action-arg="2">Delete Long</button>';
  assert.ok(html.indexOf('</div></div>' + del) !== -1, 'under the card, outside it: ' + html);
  assert.equal(html.split('class="ui-del"').length - 1, 1, 'once');
  assert.equal(html.indexOf('row nav'), -1, 'not a nav row');
  S = E.hydrate(SCH, { probeName: 'first' });
  assert.equal(E.renderBody(SCH, 't', cx(S)).indexOf('ui-del'), -1, 'its showWhen hides it');
  // A dialog: under its last card, as the screen editor's Delete screen.
  const dlg = E.renderEditModal(SCH, cx(E.hydrate(SCH, {}), { openEdit: 'dlg' }));
  assert.ok(dlg.endsWith('</div></div><button type="button" class="ui-del" data-action="deleteBar" data-action-arg="bar4">Delete bar'
    + '</button></div>'), dlg);
});

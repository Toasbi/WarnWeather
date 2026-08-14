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
  assert.ok(/<div class="rgt has-pen"><button[^>]*data-edit-sheet="sheetWind"[\s\S]*?data-select="slot"/.test(withPen),
    'pencil sits in the control cell, LEFT of the select trigger');
  const S2 = E.hydrate(SCHEMA, { slot: 'time' });
  const noPen = E.renderBody(SCHEMA, 't', cxFor(S2));
  assert.equal(noPen.indexOf('data-edit-sheet'), -1, 'time value has no pencil');
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

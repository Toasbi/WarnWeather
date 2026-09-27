// src/pkjs/config-ui/test/hint-resolver.test.js — the hint-resolver hook
// (item.hintFrom + PConf.hintResolvers).
//
// The hook exists for a hint that depends on OTHER keys than the row's own value
// (hintByValue already covers that one): a line-style picker explaining the scale of
// the metric its line draws. What these tests hold down:
//   - an item WITHOUT hintFrom renders bit-for-bit as before (hint / hintByValue);
//   - a hooked row shows the resolver's answer, and it follows a change to a key the
//     resolver reads on the next render — the page re-renders its whole body after
//     every change, so no dependency list is needed;
//   - the resolver sees the row's messageKey and its SHOWN value (after the
//     display-snap) under its own args;
//   - null/undefined falls back to the static hint, '' means "no hint", and an
//     unregistered resolver id falls back too;
//   - the hook reaches a row inside an edit sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'select', messageKey: 'metric', label: 'Metric', defaultValue: 'rain',
      options: [['Rain', 'rain'], ['Wind', 'wind']] },
    { type: 'select', messageKey: 'style', label: 'Style', defaultValue: 'line',
      hint: 'STATIC', hintByValue: { dots: 'STATIC DOTS' },
      hintFrom: { resolver: 'styleScale', args: { metricKey: 'metric' } },
      options: [['Line', 'line'], ['Dots', 'dots']] },
    { type: 'select', messageKey: 'plain', label: 'Plain', defaultValue: 'a',
      hint: 'PLAIN', hintByValue: { b: 'PLAIN B' }, options: [['A', 'a'], ['B', 'b']] }
  ] },
  { sheetOnly: true, sheetId: 'sheetStyle', title: 'Style', items: [
    { type: 'select', messageKey: 'sheetStyle', label: 'Style', defaultValue: 'line',
      hintFrom: { resolver: 'styleScale', args: { metricKey: 'metric' } },
      options: [['Line', 'line'], ['Dots', 'dots']] }
  ] }
] }] };

/** Build a render context around a settings object, mirroring boot()'s cx.
 * @param {Object} S Settings state.
 * @param {Object} [extra] Overrides (openEdit, ...).
 * @returns {Object} Render context.
 */
function cxFor(S, extra) {
  return Object.assign({
    S: S, ENV: { color: true, lineStyles: true }, USERDATA: {}, openColor: null, openSelect: null,
    openDate: null, openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: { color: true, lineStyles: true } })
  }, extra || {});
}

/** @param {string} text Hint text. @returns {string} The hint markup the row prints. */
function hintHtml(text) { return '<div class="hint">' + text + '</div>'; }

/** Register the demo resolver: the metric's scale, per the row's shown style. */
function registerStyleScale() {
  E.hintResolvers.register('styleScale', function (S, env, args) {
    return (S[args.metricKey] === 'wind' ? 'By wind scale' : 'By rain chance')
      + (args.value === 'dots' ? ', dotted' : '');
  });
}

test('hintResolvers registry: register/get; unknown id -> undefined', () => {
  E.hintResolvers.register('demoHint', function () { return 'x'; });
  assert.equal(typeof E.hintResolvers.get('demoHint'), 'function');
  assert.equal(E.hintResolvers.get('nope'), undefined);
});

test('renderRow: a view without a resolved hint renders the static hint as before', () => {
  const item = SCHEMA.tabs[0].sections[0].items[2];
  const before = E.renderRow(item, { value: 'a' });
  assert.ok(before.indexOf(hintHtml('PLAIN')) >= 0, 'plain hint');
  assert.ok(E.renderRow(item, { value: 'b' }).indexOf(hintHtml('PLAIN B')) >= 0, 'hintByValue still wins');
  assert.equal(E.renderRow(item, { value: 'a', hint: undefined }), before, 'an absent view.hint changes nothing');
});

test('renderBody: the hooked row shows the resolver answer and follows the key it reads', () => {
  registerStyleScale();
  const S = E.hydrate(SCHEMA, {});
  let body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By rain chance')) >= 0, 'derived hint shown');
  assert.equal(body.indexOf('STATIC'), -1, 'it replaces the static hint');
  assert.ok(body.indexOf(hintHtml('PLAIN')) >= 0, 'an unhooked row in the same section is unaffected');
  // The page re-renders after every change: a new metric re-words the style row's hint.
  S.metric = 'wind';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By wind scale')) >= 0, 'follows the other key');
  S.style = 'dots';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By wind scale, dotted')) >= 0, 'and its own value');
});

test('resolveHint: args carry the messageKey and shown value UNDER hintFrom.args', () => {
  let seen = null;
  E.hintResolvers.register('spy', function (S, env, args) { seen = { env: env, args: args }; return 'ok'; });
  const item = { type: 'select', messageKey: 'k', hintFrom: { resolver: 'spy', args: { metricKey: 'm', value: 'pinned' } } };
  assert.equal(E.resolveHint(item, { k: 'stored' }, { lineStyles: true }, 'shown'), 'ok');
  assert.equal(seen.args.messageKey, 'k');
  assert.equal(seen.args.metricKey, 'm');
  assert.equal(seen.args.value, 'pinned', 'schema args merge over the defaults');
  assert.equal(seen.env.lineStyles, true, 'env reaches the resolver');
  E.resolveHint({ messageKey: 'k', hintFrom: { resolver: 'spy' } }, { k: 'stored' }, {}, 'shown');
  assert.equal(seen.args.value, 'shown', 'the SHOWN value, not the stored one');
  assert.equal(E.resolveHint({ messageKey: 'k' }, {}, {}, 'x'), undefined, 'no hintFrom -> undefined');
});

test('resolveHint: the shown value is the display-snapped one', () => {
  let got;
  E.hintResolvers.register('snapSpy', function (S, env, args) { got = args.value; return 'h'; });
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'select', messageKey: 'pick', label: 'Pick', defaultValue: 'b',
      optionsFrom: { resolver: 'twoOnly' }, hintFrom: { resolver: 'snapSpy' } }
  ] }] }] };
  E.hydrate(SCH, {});
  global.PConf.optionsResolvers.register('twoOnly', function () { return [['A', 'a'], ['B', 'b']]; });
  const S = { pick: 'gone' };
  E.renderBody(SCH, 't', cxFor(S));
  assert.equal(got, 'b', 'a stored value the options no longer carry is described as what the row shows');
});

test('renderBody: null falls back to the static hint, "" means no hint, a missing resolver falls back', () => {
  const S = E.hydrate(SCHEMA, {});
  E.hintResolvers.register('styleScale', function () { return null; });
  let body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC')) >= 0, 'null -> static hint');
  S.style = 'dots';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC DOTS')) >= 0, 'null -> static hintByValue for the shown value');
  E.hintResolvers.register('styleScale', function () { return ''; });
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.equal(body.indexOf('STATIC'), -1, '"" -> no hint at all, not the static one');
  const SCH = JSON.parse(JSON.stringify(SCHEMA));
  SCH.tabs[0].sections[0].items[1].hintFrom = { resolver: 'missing' };
  body = E.renderBody(SCH, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC DOTS')) >= 0, 'unregistered resolver -> static hint, no crash');
});

test('renderEditModal: the hook reaches a row inside an edit sheet', () => {
  registerStyleScale();
  const S = E.hydrate(SCHEMA, {});
  S.metric = 'wind';
  const sheet = E.renderEditModal(SCHEMA, cxFor(S, { openEdit: 'sheetStyle' }));
  assert.ok(sheet.indexOf(hintHtml('By wind scale')) >= 0, 'sheet row shows the derived hint');
});

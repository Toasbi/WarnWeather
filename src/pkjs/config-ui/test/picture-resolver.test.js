// src/pkjs/config-ui/test/picture-resolver.test.js — the picture-resolver hook
// (item.pictureFrom + PConf.pictureResolvers): a radio drawn as the setup's picker in
// pictures, each option a card of its picture over its name.
//
// What these tests hold down:
//   - a radio WITHOUT pictureFrom, or with an unregistered resolver, renders its plain list;
//   - a hooked radio renders a radiogroup of radio cards: the picked one .on and
//     aria-checked, each card's picture printed as given and its name escaped;
//   - the resolver sees the row's messageKey and each option's value UNDER pictureFrom.args,
//     the page's userData, and only the options a derived list actually offers;
//   - the row reads label, pictures, then the picked option's hint;
//   - a card tap writes through the plain [data-k][data-v] path (no handler of its own).
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'radio', messageKey: 'look', label: 'Look', defaultValue: 'b',
      hintByValue: { a: 'HINT A', b: 'HINT B' },
      optionsFrom: { resolver: 'looks' },
      pictureFrom: { resolver: 'lookPicture', args: { tint: 'red' } } },
    { type: 'radio', messageKey: 'plain', label: 'Plain', defaultValue: 'x',
      options: [['X', 'x'], ['Y', 'y']] },
    { type: 'radio', messageKey: 'orphan', label: 'Orphan', defaultValue: 'p',
      options: [['P', 'p'], ['Q', 'q']], pictureFrom: { resolver: 'nobodyRegisteredThis' } }
  ] }
] }] };

var calls = [];
global.PConf.optionsResolvers.register('looks', function (S) {
  var out = [['A <one>', 'a'], ['B', 'b']];
  if (S.withC) { out.push(['C', 'c']); }
  return out;
});
E.pictureResolvers.register('lookPicture', function (S, env, args, userData) {
  calls.push({ args: args, userData: userData });
  return '<svg data-pic="' + args.value + '-' + args.tint + '"></svg>';
});

/**
 * The tab body for a settings state.
 * @param {Object} S Settings.
 * @returns {string} HTML.
 */
function body(S) {
  return E.renderBody(SCHEMA, 't', { S: S, ENV: {}, USERDATA: { palette: 'P' }, collapsed: {},
    evalCtx: Object.assign({}, S, { env: {} }) });
}

test('pictureResolvers registry: register/get; unknown id -> undefined', () => {
  assert.equal(typeof E.pictureResolvers.get('lookPicture'), 'function');
  assert.equal(E.pictureResolvers.get('nope'), undefined);
});

test('a hooked radio renders a radiogroup of picture cards, the picked one checked', () => {
  const html = body({ look: 'b', plain: 'x', orphan: 'p' });
  assert.match(html, /<div class="pics" role="radiogroup" aria-label="Look">/);
  assert.match(html, /<button type="button" class="pic" role="radio" aria-checked="false" data-k="look" data-v="a">/);
  assert.match(html, /<button type="button" class="pic on" role="radio" aria-checked="true" data-k="look" data-v="b">/);
  assert.ok(html.indexOf('<span class="pic-img" aria-hidden="true"><svg data-pic="a-red"></svg></span>') >= 0,
    'the picture is printed as the resolver gave it');
  assert.ok(html.indexOf('<span class="pic-lbl">A &lt;one&gt;</span>') >= 0, 'the name is escaped');
});

test('the row reads label, pictures, then the picked option\'s hint', () => {
  const html = body({ look: 'a', plain: 'x', orphan: 'p' });
  const row = html.slice(html.lastIndexOf('<div class="row', html.indexOf('class="pics"')));
  assert.match(row, /^<div class="row stack[^"]* picks"><div class="lbl">Look<\/div><div><div class="pics"/);
  const end = row.indexOf('</button></div></div>');
  assert.ok(end > 0, 'the pictures close');
  assert.equal(row.slice(end + '</button></div></div>'.length).indexOf('<div class="hint">HINT A</div></div>'), 0,
    'the hint follows the pictures and closes the row');
});

test('the resolver gets messageKey and value UNDER pictureFrom.args, the userData, and only offered options', () => {
  calls = [];
  body({ look: 'a', plain: 'x', orphan: 'p' });
  assert.deepEqual(calls.map((c) => c.args), [
    { messageKey: 'look', value: 'a', tint: 'red' },
    { messageKey: 'look', value: 'b', tint: 'red' }
  ]);
  assert.deepEqual(calls[0].userData, { palette: 'P' });
  calls = [];
  const html = body({ look: 'a', plain: 'x', orphan: 'p', withC: true });
  assert.deepEqual(calls.map((c) => c.args.value), ['a', 'b', 'c'], 'a derived option gets its picture too');
  assert.match(html, /data-k="look" data-v="c">/);
});

test('without pictureFrom, or with an unregistered resolver, a radio keeps its plain list', () => {
  const html = body({ look: 'a', plain: 'y', orphan: 'q' });
  assert.match(html, /<div class="radio"><button class="" data-k="plain" data-v="x"><span>X<\/span><span class="dot"><\/span><\/button>/);
  assert.match(html, /<div class="radio"><button class="" data-k="orphan" data-v="p"><span>P<\/span>/);
  assert.equal((html.match(/class="pics"/g) || []).length, 1, 'only the hooked radio draws pictures');
});

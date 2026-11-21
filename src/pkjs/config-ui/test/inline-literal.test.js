// src/pkjs/config-ui/test/inline-literal.test.js
// generateUrl writes the schema, the stored values, the env and userData into the page's
// inline <script> as JavaScript literals (index.js inlineScriptLiteral), not as JSON: the
// page travels as one data: URL, where each '"' costs three characters, a "'" one and a bare
// key none. These prove the literal is the same value JSON.stringify would have written,
// whatever the strings hold, that it stays safe inside a <script> element, and that it
// never costs more URL than the JSON did.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const configUi = require('../index.js');

const literal = configUi.inlineScriptLiteral;
const BS = String.fromCharCode(92);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/**
 * What JSON makes of a value: the value the page has always received.
 * @param {*} value Any value.
 * @returns {*} The value after a JSON round trip.
 */
function asJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Evaluate a literal the way the page does: as the right-hand side of an assignment.
 * @param {string} text JavaScript source.
 * @returns {*} Its value, with this realm's prototypes.
 */
function evaluate(text) {
  const ctx = {};
  vm.runInNewContext('V=' + text + ';', ctx);
  return asJson(ctx.V);
}

/**
 * @param {string} text Text bound for the page's URL.
 * @returns {number} The URL characters it costs.
 */
function cost(text) {
  return encodeURIComponent(text).length;
}

test('a literal reads as written: bare keys, single-quoted strings', () => {
  assert.equal(literal({ type: 'select', messageKey: 'configTheme', n: [1, 'x', null, true, 2.5], o: {} }),
    "{type:'select',messageKey:'configTheme',n:[1,'x',null,true,2.5],o:{}}");
  assert.equal(literal('pebblejs://close#'), "'pebblejs://close#'");
  assert.equal(literal(null), 'null');
  assert.equal(literal([]), '[]');
  assert.equal(literal(12), '12');
});

test('a key is bare only where every engine takes it as a name', () => {
  assert.equal(literal({ a1: 1, _b: 2, $c: 3 }), '{a1:1,_b:2,$c:3}');
  // Not identifiers: quoted.
  assert.equal(literal({ 'a-b': 1, '1a': 2, '': 3, 'a b': 4, 7: 5 }), "{'7':5,'a-b':1,'1a':2,'':3,'a b':4}");
  // Reserved words (an ES3 engine refuses them bare), future reserved ones and the literals.
  assert.equal(literal({ 'default': 1, 'class': 2, 'in': 3, 'null': 4, 'true': 5, 'enum': 6, 'int': 7 }),
    "{'default':1,'class':2,'in':3,'null':4,'true':5,'enum':6,'int':7}");
  // A name that only starts like one stays bare.
  assert.equal(literal({ defaultValue: 1, inner: 2, classes: 3 }), '{defaultValue:1,inner:2,classes:3}');
});

test('a string takes the quotes that cost less', () => {
  assert.equal(literal('say "hi"'), "'say \"hi\"'", 'quotes inside need no escape in single quotes');
  assert.equal(literal("it's"), "'it" + BS + "'s'", 'one apostrophe is still cheaper escaped');
  assert.equal(literal("it's Bob's"), '"it\'s Bob\'s"', 'two apostrophes: JSON wrote it cheaper');
  assert.equal(literal('a"b\'c\'d'), "'a\"b" + BS + "'c" + BS + "'d'", 'a quote pays for one more apostrophe');
  ['say "hi"', "it's", "it's Bob's", 'a"b\'c\'d', "''''", '""""', "'\"'\"'", ''].forEach((s) => {
    assert.ok(cost(literal(s)) <= cost(JSON.stringify(s)), JSON.stringify(s));
    assert.equal(evaluate(literal(s)), s);
  });
});

test('backslashes, breaks and escapes keep their value', () => {
  const values = [
    BS, BS + BS, BS + "'", BS + '"', "'" + BS, '"' + BS, BS + BS + '"' + BS + "'" + BS,
    'line\nbreak\ttab\r', 'nul\u0000bell\u0007', 'C:' + BS + 'dir' + BS + "it's", 'café ☃ 😀',
    'ends in a quote"', "ends in an apostrophe'", 'ends in a backslash' + BS
  ];
  values.forEach((s) => {
    assert.equal(evaluate(literal(s)), s, JSON.stringify(s));
    assert.deepEqual(evaluate(literal({ k: s, list: [s, s] })), { k: s, list: [s, s] }, JSON.stringify(s));
    // The same text as a key.
    const o = {};
    o[s] = 1;
    assert.deepEqual(evaluate(literal(o)), o, 'key ' + JSON.stringify(s));
  });
});

test('what JSON.stringify leaves out or rewrites is left out or rewritten the same way', () => {
  const value = {
    gone: undefined, fn: function () {}, nan: NaN, inf: Infinity, when: new Date(Date.UTC(2026, 10, 21)),
    own: { toJSON: function () { return { as: 'json' }; } }, holes: [undefined, function () {}, 1], minusZero: -0
  };
  assert.deepEqual(evaluate(literal(value)), asJson(value));
  assert.equal(literal(value),
    "{nan:null,inf:null,when:'2026-11-21T00:00:00.000Z',own:{as:'json'},holes:[null,null,1],minusZero:0}");
  assert.equal(literal(undefined), 'undefined', 'as inlineScriptJson answers it');
});

test('nothing in a literal can end or derail the page script', () => {
  const hostile = 'a</script><img src=x onerror=alert(1)><!--<script>' + LS + PS + '</SCRIPT >';
  const o = { location: hostile, list: [hostile] };
  o[hostile] = hostile;
  const text = literal(o);
  assert.equal(text.indexOf('<'), -1, "no '<' at all");
  assert.equal(text.indexOf(LS), -1, 'no raw U+2028');
  assert.equal(text.indexOf(PS), -1, 'no raw U+2029');
  assert.equal(text.indexOf('\n'), -1, 'one line');
  assert.deepEqual(evaluate(text), o);
});

test('a schema-shaped value costs less URL than its JSON, and never more', () => {
  const schema = [];
  for (let i = 0; i < 40; i += 1) {
    schema.push({ type: 'select', messageKey: 'key' + i, label: 'The watch\'s "Show" row ' + i, defaultValue: 'percent',
      options: [{ label: 'Percentage', value: 'percent' }, { label: 'Days left', value: 'days' }],
      showWhen: { env: 'plugins' }, hint: "Shows the percentage while Muninn has no estimate." });
  }
  const text = literal(schema);
  assert.deepEqual(evaluate(text), schema);
  assert.ok(cost(text) < cost(configUi.inlineScriptJson(schema)) * 0.85,
    cost(text) + ' against ' + cost(configUi.inlineScriptJson(schema)));
});

test('any mix of awkward characters, as key and as value, round-trips and never costs more', () => {
  const alphabet = ["'", '"', BS, '<', '>', '/', '\n', '\r', '\t', LS, PS, ' ', ':', ',', '{', '}', '[', ']',
    'a', 'Z', '0', '_', '$', '-', 'é', '☃', '\u0000', 'u', 'n', '&', '#', '%', '+', '='];
  let seed = 20261121;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  const word = () => {
    let s = '';
    for (let n = next() % 9; n > 0; n -= 1) { s += alphabet[next() % alphabet.length]; }
    return s;
  };
  for (let round = 0; round < 400; round += 1) {
    const o = {};
    for (let k = 0; k < 6; k += 1) { o[word()] = k % 2 ? word() : [word(), { v: word() }, next() % 100 / 7]; }
    const text = literal(o);
    assert.deepEqual(evaluate(text), asJson(o), 'round ' + round + ': ' + JSON.stringify(o));
    assert.ok(cost(text) <= cost(configUi.inlineScriptJson(o)), 'round ' + round);
  }
});

test('a very long string and a string of nothing but escapes are scanned once', () => {
  const long = { body: new Array(200001).join('x') + '"' + new Array(50001).join(BS + '"' + "'") };
  const started = Date.now();
  const text = literal(long);
  assert.ok(Date.now() - started < 2000, 'linear in the text');
  assert.deepEqual(evaluate(text), long);
});

test('generateUrl writes the page its values as literals, and its return target as JSON', () => {
  const page = '<html><script>var INJECTED_SCHEMA=null,INJECTED_CFG=null,INJECTED_ENV=null,INJECTED_USERDATA=null,'
    + 'INJECTED_RETURN=null;/*__PCONF_INJECT__*/\n/*__PCONF_CONCAT__*/</script></html>';
  const schema = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'toggle', messageKey: 'vibe', label: 'Vibrate', defaultValue: true }] }] }] };
  const store = { getItem: () => JSON.stringify({ vibe: false, note: "it's" }), setItem: () => {} };
  const config = configUi.createConfig({ schema: schema, page: page, options: { storage: store } });
  global.Pebble = { platform: 'basalt' };
  let html;
  try {
    html = decodeURIComponent(config.generateUrl({ watchInfo: { platform: 'basalt' }, userData: { appVersion: '3.3.0' } })
      .slice('data:text/html;charset=utf-8,'.length));
  } finally { delete global.Pebble; }
  assert.ok(html.indexOf("INJECTED_SCHEMA={appName:'X',versionLabel:'v0',tabs:[{id:'t',label:'T',sections:[{title:'S',"
    + "items:[{type:'toggle',messageKey:'vibe',label:'Vibrate',defaultValue:true}]}]}]};") !== -1);
  assert.ok(html.indexOf("INJECTED_CFG={vibe:false,note:'it" + BS + "'s'};") !== -1);
  assert.ok(html.indexOf("INJECTED_USERDATA={appVersion:'3.3.0'};") !== -1);
  assert.ok(html.indexOf('INJECTED_RETURN="pebblejs://close#";') !== -1, 'the emulator helper reads this one as JSON');
});

// test/settings-page-inject.test.js
// The settings page is one inline <script>, and generateUrl splices schema, stored
// values and userData into it as JSON. Plain JSON.stringify leaves '<' and U+2028/2029
// alone, so a stored '</script' (a typed location, a geocoder name, a news body) ended
// the element mid-literal and an unclosed '<!--' pushed the tokenizer past the real
// '</script>' -- boot() never ran, on every open, and the page that could fix the value
// was the dead one. These tests drive the REAL page (page.generated.js, whose comments
// carry the '<script>' literals that make '<!--' fatal) through the real device branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const HOSTILE = 'a</script><img src=x onerror=alert(1)><!--<script>' + LS + PS + '</SCRIPT >';

/**
 * Build the device data: URL the way index.js showConfiguration does and decode it.
 * @param {Object} values Stored settings blob.
 * @param {Object} userData Page userData.
 * @returns {string} The decoded HTML page.
 */
function devicePage(values, userData) {
  global.Pebble = { platform: 'basalt' };  // not pypkjs -> the real device data: branch
  try {
    const settings = require('../src/pkjs/settings/index.js');
    const url = settings.generateUrl({ values: values, watchInfo: { platform: 'basalt' },
      env: { phoneBattery: false }, userData: userData });
    const prefix = 'data:text/html;charset=utf-8,';
    assert.equal(url.indexOf(prefix), 0, 'device branch gives a data: URL');
    return decodeURIComponent(url.slice(prefix.length));
  } finally { delete global.Pebble; }
}

const values = { location: HOSTILE, radarNoRainText: '<!--', owmApiKey: 'k' };
const userData = {
  accountToken: 'T',
  graphsSeed: { lat: 1, lon: 2, name: HOSTILE },
  newsCache: JSON.stringify({ items: [{ id: 1, title: HOSTILE, body_md: HOSTILE }] })
};

test('hostile stored strings cannot end or derail the page script', () => {
  const html = devicePage(values, userData);
  const closes = html.match(/<\/script/gi) || [];
  assert.equal(closes.length, 1, "only the shell's own </script> remains");
  assert.ok(html.search(/<\/script/i) > html.indexOf('PConf.engine.boot();'),
    'the script element closes after boot(), not inside the injected JSON');
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.search(/<\/script/i));
  assert.equal(script.indexOf('<!--'), -1, "no '<!--' to put the tokenizer in escaped state");
  assert.equal(html.indexOf(LS), -1, 'no raw U+2028 (a SyntaxError in pre-ES2019 string literals)');
  assert.equal(html.indexOf(PS), -1, 'no raw U+2029');
  assert.doesNotThrow(() => new vm.Script(script), 'the whole page script still compiles');
});

test('escaped injection round-trips every value exactly', () => {
  const html = devicePage(values, userData);
  const line = html.split('\n').filter((l) => l.indexOf('INJECTED_SCHEMA=') === 0)[0];
  assert.ok(line, 'the injected snippet is one line');
  const ctx = {};
  vm.runInNewContext(line, ctx);
  assert.equal(ctx.INJECTED_CFG.location, HOSTILE);
  assert.equal(ctx.INJECTED_CFG.radarNoRainText, '<!--');
  const plain = (v) => JSON.parse(JSON.stringify(v));  // drop the vm realm's prototypes
  assert.deepEqual(plain(ctx.INJECTED_USERDATA), userData);
  assert.equal(ctx.INJECTED_RETURN, 'pebblejs://close#');
  assert.deepEqual(plain(ctx.INJECTED_SCHEMA), plain(require('../src/pkjs/settings/schema.js')));
});

test('dev preview page escapes its injected JSON the same way', () => {
  const build = require('../src/pkjs/config-ui/scripts/build-page.js');
  const html = build.previewPage({ schema: null, cfg: { location: HOSTILE }, userData: userData });
  assert.equal((html.match(/<\/script/gi) || []).length, 1, 'preview page keeps one </script>');
  assert.equal(html.indexOf(LS), -1, 'preview page has no raw U+2028');
});

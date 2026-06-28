// test/preview-config-page.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const preview = require('../scripts/preview-config-page.js');

test('dev preview page injects the preview palette into userData', () => {
  const html = preview.run({ platform: 'basalt' });
  // Assert the JSON-stringified userData (only present when the palette is injected),
  // NOT a bare substring that also matches the CSS class or the blocks.js fallback source.
  assert.ok(html.indexOf('INJECTED_USERDATA={"palette":{') >= 0,
    'palette object is injected into INJECTED_USERDATA');
  assert.ok(html.indexOf('"precip_prob":{"color":"#55AAFF"') >= 0,
    'injected palette carries the watch precip color in JSON form (not the source fallback literal)');
});

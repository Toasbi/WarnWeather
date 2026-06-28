// test/preview-config-page.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const preview = require('../scripts/preview-config-page.js');

test('dev preview page injects the preview palette (Picton Blue precip)', () => {
  const html = preview.run({ platform: 'basalt' });
  assert.ok(html.indexOf('"palette"') >= 0, 'userData.palette is injected');
  assert.ok(html.indexOf('#55AAFF') >= 0, 'palette carries the watch precip color');
});

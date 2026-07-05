// test/preview-config-page.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const preview = require('../scripts/preview-config-page.js');
const build = require('../scripts/build-config-page.js');

test('dev preview page injects the preview palette into userData', () => {
  const html = preview.run({ platform: 'basalt' });
  // Assert the JSON-stringified userData (only present when the palette is injected),
  // NOT a bare substring that also matches the CSS class or the blocks.js fallback source.
  assert.ok(html.indexOf('INJECTED_USERDATA={"palette":{') >= 0,
    'palette object is injected into INJECTED_USERDATA');
  assert.ok(html.indexOf('"precip_prob":{"color":"#55AAFF"') >= 0,
    'injected palette carries the watch precip color in JSON form (not the source fallback literal)');
});

test('parseArgs treats a lone platform name as the platform, not the output path', () => {
  // The foot-gun: `mise preview-config aplite` used to write a file named "aplite"
  // rendered as basalt. A bare platform name should select the platform and keep the
  // default output path.
  const r = preview.parseArgs(['aplite']);
  assert.equal(r.platform, 'aplite');
  assert.equal(r.out, preview.DEFAULT_OUT);
});

test('parseArgs treats a lone non-platform arg as the output path (basalt default)', () => {
  const r = preview.parseArgs(['preview.html']);
  assert.equal(r.out, 'preview.html');
  assert.equal(r.platform, 'basalt');
});

test('parseArgs accepts the documented [out] [platform] order', () => {
  const r = preview.parseArgs(['preview.html', 'aplite']);
  assert.equal(r.out, 'preview.html');
  assert.equal(r.platform, 'aplite');
});

test('parseArgs is order-independent for [platform] [out]', () => {
  const r = preview.parseArgs(['aplite', 'preview.html']);
  assert.equal(r.out, 'preview.html');
  assert.equal(r.platform, 'aplite');
});

test('parseArgs with no args uses defaults', () => {
  const r = preview.parseArgs([]);
  assert.equal(r.out, preview.DEFAULT_OUT);
  assert.equal(r.platform, 'basalt');
});

// Regression: this file's APP_FILES and build-config-page.js's APP_FILES are two
// independent lists that build the SAME page (dev preview vs. the real shipped page).
// A file (e.g. view-cycle.js) added to one but forgotten in the other renders fine in
// whichever entrypoint got the fix and silently throws in the webview via the other —
// exactly how the Layout tab broke. Keep them identical.
test('preview-config-page.js and build-config-page.js bundle the same app files', () => {
  assert.deepEqual(preview.APP_FILES, build.APP_FILES);
});

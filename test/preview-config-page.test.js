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
  // The graph's line/fill colours are NOT in here any more — preview-forecast.js resolves
  // those live from `state` through line-style.js. The rain-tier ramp still is, and it
  // comes from rain-tier.buildPalette, so pin one of its bands.
  assert.ok(html.indexOf('"rainTiers":[{"from":0,') >= 0,
    'injected palette carries the watch rain-tier ramp in JSON form (not the source fallback literal)');
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

// Regression: these two entrypoints build the SAME page (dev preview vs. the
// real shipped page), and they used to do it from two hand-kept lists. A file
// added to one and forgotten in the other rendered fine through whichever
// entrypoint got the fix and silently threw in the webview through the other —
// exactly how the Layout tab broke, and later how the preview came to load the
// Weather tab's stylesheet before the module whose settle curve it bakes in.
// The preview now READS the build's list, so the fix is structural and the
// assertion is identity: comparing contents would pass against a re-introduced
// copy that merely happens to match today.
test('preview-config-page.js bundles the build\'s own app-file list, not a copy of it', () => {
  assert.ok(Array.isArray(build.APP_FILES) && build.APP_FILES.length > 30,
    'the build has a list to share');
  assert.equal(preview.APP_FILES, build.APP_FILES,
    'the preview re-exports the build\'s array itself — a second list cannot drift '
    + 'because there is no second list');
});

// test/layout-flick-preview.test.js
// Regression: the Layout tab's "After a wrist-flick" section hosts its preview
// (layoutPreviewFlick) via blockBefore on a staticText caption. renderItem must
// render that block — an earlier engine version returned early for staticText and
// silently dropped blockBefore, so the preview never appeared. Render the real
// layout tab through the engine and assert the SVG shows when a flick reveals
// something, and the note (not the preview) shows when it doesn't.
const test = require('node:test');
const assert = require('node:assert/strict');

// The lib modules share global.PConf across separate requires (show-when.js seeds it).
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js'); // registers layoutPreview / layoutPreviewFlick
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');

function afterFlickSection(overrides) {
  const S = Object.assign(eng.hydrate(schema, {}), overrides);
  const ENV = plat.computeEnv({ platform: 'basalt' });
  const cx = {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: ENV }),
  };
  const body = eng.renderBody(schema, 'layout', cx);
  // Slice from the flick section header so the Default view preview (also an <svg>) is excluded.
  return body.slice(body.indexOf('After a wrist-flick'));
}

test('after-flick preview SVG renders when radar is enabled', () => {
  const sec = afterFlickSection({ radarProvider: 'dwd', healthMode: 'off' });
  assert.ok(sec.indexOf('<svg') >= 0, 'flick preview should render when a flick reveals the radar');
});

test('after-flick preview SVG renders when a health view is enabled', () => {
  const sec = afterFlickSection({ radarProvider: 'disabled', healthMode: 'status' });
  assert.ok(sec.indexOf('<svg') >= 0, 'flick preview should render when a flick reveals health');
});

test('after-flick shows the note and no preview when a flick reveals nothing (default off state)', () => {
  const sec = afterFlickSection({ radarProvider: 'disabled', healthMode: 'off' });
  assert.ok(sec.indexOf('Nothing to flick') >= 0, 'note shows when nothing to reveal');
  assert.strictEqual(sec.indexOf('<svg'), -1, 'no preview when nothing to reveal');
});

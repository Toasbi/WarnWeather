// The settings page ships as ONE flat concatenated <script> with no require(), so a module
// that is missing from scripts/build-config-page.js's APP_FILES simply does not exist in the
// webview. Consumers written defensively (window.X || fallback) then degrade to doing nothing
// instead of throwing, which makes an omission invisible: every Node test still passes,
// because Node takes the require() branch. That is exactly how the wizard's defaults policy
// shipped as a production no-op once. These tests read the GENERATED page and assert the
// behaviour-carrying strings are actually in it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERATED = path.join(ROOT, 'src/pkjs/settings/page.generated.js');

/**
 * @returns {string} the generated flat settings page
 */
function page() {
  assert.ok(fs.existsSync(GENERATED),
    'page.generated.js is missing — run `node scripts/build-config-page.js` (mise test does this for you)');
  return fs.readFileSync(GENERATED, 'utf8');
}

test('every defaults-policy rule id reaches the generated settings page', () => {
  const policy = require('../src/pkjs/settings/defaults-policy.js');
  const src = page();
  assert.ok(policy.RULES.length > 0, 'the rule table is empty — nothing to pin');
  policy.RULES.forEach((rule) => {
    assert.ok(src.indexOf(rule.id) !== -1,
      'rule "' + rule.id + '" is not in page.generated.js: defaults-policy.js is probably ' +
      'missing from APP_FILES in scripts/build-config-page.js, which makes the wizard\'s ' +
      'defaults a silent no-op on a real phone');
  });
});

test('the generated page installs the DefaultsPolicy global the wizard reads', () => {
  const src = page();
  assert.ok(src.indexOf('window.DefaultsPolicy') !== -1,
    'nothing assigns window.DefaultsPolicy — the wizard would resolve undefined and apply nothing');
});

test('defaults-policy is bundled BEFORE the wizard that consumes it', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => appFiles.findIndex((f) => f.endsWith(suffix));
  const policyAt = idx('settings/defaults-policy.js');
  const wizardAt = idx('settings/wizard.js');
  assert.notEqual(policyAt, -1, 'defaults-policy.js is not in APP_FILES at all');
  assert.notEqual(wizardAt, -1, 'wizard.js is not in APP_FILES at all');
  assert.ok(policyAt < wizardAt,
    'defaults-policy.js must be concatenated before wizard.js so the global exists when read');
});

// The forecast preview resolves every graph colour through line-style.js (and its two
// deps) instead of re-implementing the colour model. Same silent-no-op hazard as the
// defaults policy above, one step worse: these three must also be in the RIGHT ORDER,
// because each reads the previous one's window global while its own top-level body runs.
test('the graph-colour resolver and its deps reach the generated settings page', () => {
  const src = page();
  ['window.PebbleColors', 'window.ResolveInk', 'window.LineStyle',
    'window.PreviewSvg', 'window.PreviewRain'].forEach((global) => {
    assert.ok(src.indexOf(global) !== -1,
      'nothing assigns ' + global + ' — it is probably missing from APP_FILES in ' +
      'scripts/build-config-page.js, which leaves the forecast preview unable to resolve ' +
      'its colours on a real phone while every Node test passes');
  });
});

// Every preview block is its own file, and each of them reads a window global that a
// file earlier in APP_FILES publishes. Dropping one does not throw: an unregistered
// block id renders nothing and only warns, so the block would silently vanish from a
// real phone's settings page while every Node test still passed through require().
const PREVIEW_BLOCK_FILES = ['settings/preview-forecast.js', 'settings/preview-radar.js',
  'settings/preview-diagnostics.js', 'settings/preview-layout.js'];

test('the graph-colour modules and the preview kit are bundled in dependency order', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  // resolve-ink reads window.PebbleColors and line-style reads both, each at load time,
  // so a wrong order throws at page boot rather than degrading quietly.
  assert.ok(idx('pkjs/pebble-colors.js') < idx('pkjs/resolve-ink.js'),
    'pebble-colors.js must precede resolve-ink.js');
  assert.ok(idx('pkjs/resolve-ink.js') < idx('pkjs/line-style.js'),
    'resolve-ink.js must precede line-style.js');
  assert.ok(idx('pkjs/resolve-ink.js') < idx('settings/preview-svg.js'),
    'resolve-ink.js must precede preview-svg.js, which reads window.ResolveInk at IIFE time');
  assert.ok(idx('settings/preview-svg.js') < idx('settings/preview-rain.js'),
    'preview-svg.js must precede preview-rain.js, which reads window.PreviewSvg at IIFE time');
  PREVIEW_BLOCK_FILES.forEach((file) => {
    assert.ok(idx('pkjs/line-style.js') < idx(file) &&
      idx('settings/preview-svg.js') < idx(file) &&
      idx('settings/preview-rain.js') < idx(file),
      file + ' must follow line-style.js, preview-svg.js and preview-rain.js — it reads ' +
      'their window globals while its own IIFE body runs');
  });
});

// blocks.js builds its fill-key -> night-key map from window.LineStyle while its own
// IIFE body runs, so a wrong order leaves the map empty and the hook a no-op: fill picks
// would keep their old night tint on a real phone with every Node test still green.
test('the night-tint hook is registered in the generated page, after line-style', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/line-style.js') < idx('settings/blocks.js'),
    'line-style.js must precede blocks.js, which reads window.LineStyle at IIFE time');
  const src = page();
  assert.ok(src.indexOf("PConf.onChange.register('graphFillTint'") !== -1,
    'nothing registers the graphFillTint hook — a fill pick would leave its night tint ' +
    'behind on the built-in, and the watch would keep re-shading the night hours in it');
  assert.ok(src.indexOf('graphNightTintFollowsFill') !== -1,
    'line-style.js reaches the page without the predicate the hook calls');
});

test('every preview block reaches the generated settings page', () => {
  const src = page();
  ['forecastPreview', 'radarPreview', 'devStats', 'lastFetch', 'layoutPreviewCombined']
    .forEach((id) => {
      assert.ok(src.indexOf("PConf.blocks.register('" + id + "'") !== -1,
        'nothing registers the ' + id + ' block — its file is probably missing from ' +
        'APP_FILES in scripts/build-config-page.js, which drops the block from the page ' +
        'on a real phone while every Node test passes');
    });
});

// APP_FILES is DUPLICATED — build-config-page.js ships the page, preview-config-page.js
// renders `mise preview-config` — so an addition to one and not the other is silent.
// That lockstep is already guarded, by test/preview-config-page.test.js's last test.

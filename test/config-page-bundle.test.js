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

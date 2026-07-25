'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
// The two color defaults are owned by the contract module (status-thresholds.js),
// which also reads these settings back at pack time — assert against the exported
// constants rather than re-inlining the hex a third time.
const thresholds = require('../src/pkjs/status-thresholds.js');

function itemsByKey() {
  const map = {};
  eachItem(schema, it => {
    if (!it.messageKey) { return; }
    (map[it.messageKey] = map[it.messageKey] || []).push(it);
  });
  return map;
}

const STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance'];
const HEALTH_STEMS = ['Steps', 'Sleep', 'Distance'];

test('every threshold kind has warn/danger text fields wired to the validator', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    ['Warn', 'Danger'].forEach(which => {
      const items = map['thresh' + stem + which];
      assert.ok(items && items.length === 1, 'thresh' + stem + which + ' missing');
      assert.equal(items[0].type, 'text');
      assert.equal(items[0].defaultValue, '');
      assert.equal(items[0].onChange, 'validateThresholdPair');
    });
  });
});

test('threshold color pickers are COLOR-capability + bw-theme gated, int defaults', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    const warn = map['thresh' + stem + 'WarnColor'][0];
    const danger = map['thresh' + stem + 'DangerColor'][0];
    [warn, danger].forEach(it => {
      assert.equal(it.type, 'color');
      assert.deepEqual(it.capabilities, ['COLOR']);
      assert.ok(JSON.stringify(it.showWhen).includes('bw'),
        'bw theme must hide the picker');
    });
    assert.equal(warn.defaultValue, thresholds.DEFAULT_WARN_COLOR);
    assert.equal(danger.defaultValue, thresholds.DEFAULT_DANGER_COLOR);
  });
});

test('health-kind threshold fields are hidden on health-less platforms', () => {
  const map = itemsByKey();
  HEALTH_STEMS.forEach(stem => {
    ['Warn', 'Danger'].forEach(which => {
      const it = map['thresh' + stem + which][0];
      assert.ok(JSON.stringify(it.showWhen).includes('"env":"health"'),
        'thresh' + stem + which + ' must be env-health gated');
    });
  });
});

// The built page is ONE flat <script> with no require() (see build-page.js), so
// threshold-validate.js reaches the contract module through window.StatusThresholds —
// which only exists if status-thresholds.js is bundled BEFORE it. Execute the real
// generated script the way the webview does: dropping either file from APP_FILES, or
// ordering them the other way round, breaks the hook here instead of silently in the
// phone webview.
test('the generated page registers the validator hook without require()', () => {
  const vm = require('vm');
  const html = require('../src/pkjs/config-ui/scripts/build-page.js')
    .buildPage({ appFiles: require('../scripts/build-config-page.js').APP_FILES });
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'page contains a <script> block');
  // boot() reaches into live DOM APIs this sandbox does not stub.
  const src = scriptMatch[1].replace(/PConf\.engine\.boot\(\);\s*$/, '');
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.document = { getElementById: () => ({ addEventListener() {} }), addEventListener() {} };
  sandbox.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
  assert.equal(typeof sandbox.window.StatusThresholds, 'object', 'contract module exposed on window');
  const hook = sandbox.PConf.onChange.get('validateThresholdPair');
  assert.equal(typeof hook, 'function', 'validateThresholdPair hook registered');
  // And it validates for real in that context (not just registered).
  const S = { threshAqiWarn: '200', threshAqiDanger: '100' };
  hook(S, '', '100', {}, 'threshAqiDanger');
  assert.equal(S.threshAqiDanger, '', 'inverted edit reverted inside the webview context');
});

// Defaults ship disabled: every kind starts with both thresholds blank, so
// kindConfig() reports it disabled until the user opts in (no invented numbers).
test('shipped defaults leave every kind disabled', () => {
  const map = itemsByKey();
  const S = {};
  STEMS.forEach(stem => {
    S['thresh' + stem + 'Warn'] = map['thresh' + stem + 'Warn'][0].defaultValue;
    S['thresh' + stem + 'Danger'] = map['thresh' + stem + 'Danger'][0].defaultValue;
  });
  thresholds.KINDS.forEach((kind, index) => {
    assert.equal(thresholds.kindConfig(S, index).enabled, false,
      kind.key + ' must ship disabled');
  });
});

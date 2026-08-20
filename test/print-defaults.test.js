'use strict';
// test/print-defaults.test.js — the defaults overview (`mise defaults`) is only worth
// reading if it cannot drift from the code. These tests pin the two joins that would let
// it lie: every rule in the policy table must reach the printed page, and the columns it
// prints for a finished wizard must equal what the REAL wizard writes on that watch.
const test = require('node:test');
const assert = require('node:assert/strict');

// Same registry boot as test/config-wizard.test.js: blocks.js registers the
// statusSlotDefault resolver the schema's defaultFrom items resolve through.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/reset-status-defaults.js');
const schema = require('../src/pkjs/settings/schema.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');
const { deriveDefaults } = require('../src/pkjs/config-ui/lib/defaults.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
const policy = require('../src/pkjs/settings/defaults-policy.js');
const W = require('../src/pkjs/settings/wizard.js');
const report = require('../scripts/print-defaults.js');

const OUT = report.render();

test('every policy rule reaches the printed overview — id, why and all of its keys', () => {
  assert.ok(policy.RULES.length > 0, 'the policy table is empty; nothing to pin');
  policy.RULES.forEach((rule) => {
    assert.ok(OUT.includes(rule.id), 'rule id missing from the overview: ' + rule.id);
    // The first few words of `why` are enough: the renderer wraps the sentence.
    const whyHead = String(rule.why).split(' ').slice(0, 4).join(' ');
    assert.ok(OUT.includes(whyHead), 'rule why missing from the overview: ' + rule.id);
    Object.keys(rule.set || {}).forEach((key) => {
      assert.ok(OUT.includes(key), 'key ' + key + ' of rule ' + rule.id + ' missing from the overview');
    });
  });
});

test('the wizard columns equal what the real wizard writes, on every platform', () => {
  report.PLATFORMS.forEach((platform) => {
    const env = platformLib.computeEnv({ platform: platform });
    report.SCENARIOS.filter((sc) => sc.wizard).forEach((sc) => {
      // The real code path: hydrate a fresh install of this watch, make the wizard's
      // health pick, then press the finish button.
      const S = eng.hydrate(schema, {}, env);
      S.healthMode = sc.healthMode;
      const written = W.applyWizardDefaults({ S: S, ENV: env, schema: schema }, 'save');
      assert.deepEqual(report.policyOverrides(platform, sc), written,
        'overview disagrees with the wizard on ' + platform + ' / ' + sc.id);
    });
  });
});

test('a fresh install (no wizard) gets no situational overrides at all', () => {
  const fresh = report.SCENARIOS.filter((sc) => !sc.wizard);
  assert.ok(fresh.length > 0, 'there is no non-wizard scenario to compare against');
  report.PLATFORMS.forEach((platform) => {
    fresh.forEach((sc) => {
      assert.deepEqual(report.policyOverrides(platform, sc), {},
        'a rule fires without the wizard on ' + platform + ' / ' + sc.id);
    });
  });
});

test('the unseeded section lists exactly the schema keys deriveDefaults skips', () => {
  const fromSchema = [];
  eachItem(schema, (it) => { if (it.messageKey && it.defaultFrom) { fromSchema.push(it.messageKey); } });
  const listed = report.unseededItems().map((row) => row.key);
  assert.deepEqual(listed.slice().sort(), fromSchema.slice().sort());
  const seeded = deriveDefaults(schema);
  listed.forEach((key) => {
    assert.ok(!Object.prototype.hasOwnProperty.call(seeded, key),
      key + ' is both seeded and listed as unseeded');
    assert.ok(OUT.includes(key), 'unseeded key missing from the printed report: ' + key);
  });
});

test('step and sleep goals stay off in every scenario (they are nobody\'s choice)', () => {
  report.PLATFORMS.forEach((platform) => {
    report.SCENARIOS.forEach((sc) => {
      const state = report.resolveScenario(platform, sc);
      assert.equal(state.threshStepsOn, false, 'step goal switched on: ' + platform + '/' + sc.id);
      assert.equal(state.threshSleepOn, false, 'sleep goal switched on: ' + platform + '/' + sc.id);
    });
  });
});

test('the report reads in a terminal — no line wider than 100 columns', () => {
  OUT.split('\n').forEach((line, i) => {
    assert.ok(line.length <= 100, 'line ' + (i + 1) + ' is ' + line.length + ' cols: ' + line);
  });
});

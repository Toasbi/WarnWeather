'use strict';
// test/defaults-policy.test.js — the conditional-defaults table (settings/defaults-policy.js)
// and its resolver. Node-only (ES6 allowed here; the module under test is ES5).
//
// Two jobs:
//   1. the resolver's semantics — which rules fire for which context, and precedence;
//   2. drift guards on the TABLE itself — every key it writes must still exist in the
//      schema with a matching type/option, and the deliberate omissions (the step/sleep
//      goals) must stay omitted.
const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../src/pkjs/settings/defaults-policy.js');
const schema = require('../src/pkjs/settings/schema.js');
const eachItem = require('../src/pkjs/config-ui/lib/schema-walk.js').eachItem;
const catalog = require('../src/pkjs/status-line-catalog.js');
const contract = require('../src/pkjs/status-thresholds.js');

// --- fixtures --------------------------------------------------------------

const SCHEMA_ITEM = {};
eachItem(schema, (it) => { if (it.messageKey) { SCHEMA_ITEM[it.messageKey] = it; } });

// Shaped like config-ui/lib/platform.js computeEnv().
const ENV_BASALT = { platform: 'basalt', color: true, health: true, radar: true, hr: false, thresholds: true, themePolarity: true };
const ENV_DIORITE = { platform: 'diorite', color: false, health: true, radar: true, hr: true, thresholds: true, themePolarity: true };
const ENV_APLITE = { platform: 'aplite', color: false, health: false, radar: false, hr: false, thresholds: false, themePolarity: false };
const ENV_EMERY = { platform: 'emery', color: true, health: true, radar: true, hr: true, thresholds: true, themePolarity: true };

/**
 * @param {Object} [over] Fields to override on the baseline context.
 * @returns {Object} A resolver context {wizard, env, choices}.
 */
function ctx(over) {
  return Object.assign({ wizard: false, env: ENV_BASALT, choices: { healthMode: 'all' } }, over || {});
}

// The matrix, spelled out once. The tests below assert the resolver reproduces
// exactly this and nothing more. Setup sets no Bold mode (the owner, 2026-11-06: every
// slot keeps its own Bold row's default) and moves no slot (the owner, 2026-11-09: steps
// no longer moves to the top row, nor walked distance into its place).
// The warn box is the kind's warn look, whose platform default already draws one —
// the rule switches the highlight on and nothing else.
const AQI_HIGHLIGHT = { threshAqiOn: true };

// --- ruleApplies: the `when` predicate -------------------------------------

test('a rule with no conditions always applies', () => {
  const bare = { id: 'bare', why: 'x', set: {} };
  assert.equal(policy.ruleApplies(bare, ctx({ wizard: false })), true);
  assert.equal(policy.ruleApplies(bare, ctx({ wizard: true })), true);
  assert.equal(policy.ruleApplies({ id: 'empty-when', when: {}, set: {} }, ctx()), true);
});

test('wizard rules apply only while the wizard is running', () => {
  const rule = { id: 'w', when: { wizard: true }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ wizard: true })), true);
  assert.equal(policy.ruleApplies(rule, ctx({ wizard: false })), false);
  assert.equal(policy.ruleApplies(rule, { env: ENV_BASALT }), false, 'missing wizard flag reads as not-the-wizard');
});

test('when: {wizard: false} is honoured as a real condition, not ignored', () => {
  const rule = { id: 'not-wizard', when: { wizard: false }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ wizard: false })), true);
  assert.equal(policy.ruleApplies(rule, ctx({ wizard: true })), false);
});

test('health rules do not apply when healthMode is off', () => {
  const rule = { id: 'h', when: { health: true }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ choices: { healthMode: 'off' } })), false);
});

test("healthMode 'status', 'all' and 'slot' all count as health-enabled", () => {
  const rule = { id: 'h', when: { health: true }, set: {} };
  ['status', 'all', 'slot'].forEach((mode) => {
    assert.equal(policy.ruleApplies(rule, ctx({ choices: { healthMode: mode } })), true, mode);
  });
  assert.equal(policy.ruleApplies(rule, ctx({ choices: {} })), false,
    "an unset healthMode falls back to the schema default ('off' since 2.6: health follows the screens)");
});

test('health rules also need the platform capability (aplite has no health)', () => {
  const rule = { id: 'h', when: { health: true }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ env: ENV_APLITE })), false);
  assert.equal(policy.ruleApplies(rule, { choices: { healthMode: 'all' } }), false,
    'no env at all reads as no capability — conservative, never places a dead slot');
});

test('when: {health: false} matches the health-off side', () => {
  const rule = { id: 'no-h', when: { health: false }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ choices: { healthMode: 'off' } })), true);
  assert.equal(policy.ruleApplies(rule, ctx({ env: ENV_APLITE })), true);
  assert.equal(policy.ruleApplies(rule, ctx()), false);
});

test('capability conditions read the env flags', () => {
  assert.equal(policy.ruleApplies({ id: 'hr', when: { hr: true }, set: {} }, ctx({ env: ENV_DIORITE })), true);
  assert.equal(policy.ruleApplies({ id: 'hr', when: { hr: true }, set: {} }, ctx()), false);
  assert.equal(policy.ruleApplies({ id: 'r', when: { radar: true }, set: {} }, ctx()), true);
  assert.equal(policy.ruleApplies({ id: 't', when: { thresholds: true }, set: {} }, ctx({ env: ENV_APLITE })), false);
});

test('platform conditions accept one name or a list', () => {
  assert.equal(policy.ruleApplies({ id: 'p', when: { platform: 'basalt' }, set: {} }, ctx()), true);
  assert.equal(policy.ruleApplies({ id: 'p', when: { platform: 'aplite' }, set: {} }, ctx()), false);
  assert.equal(policy.ruleApplies({ id: 'p', when: { platform: ['emery', 'basalt'] }, set: {} }, ctx()), true);
  assert.equal(policy.ruleApplies({ id: 'p', when: { platformNot: 'aplite' }, set: {} }, ctx()), true);
  assert.equal(policy.ruleApplies({ id: 'p', when: { platformNot: ['aplite'] }, set: {} }, ctx({ env: ENV_APLITE })), false);
});

test('choice conditions compare a stored/wizard choice', () => {
  const rule = { id: 'c', when: { choice: { layoutPreset: 'compactCal' } }, set: {} };
  assert.equal(policy.ruleApplies(rule, ctx({ choices: { layoutPreset: 'compactCal' } })), true);
  assert.equal(policy.ruleApplies(rule, ctx({ choices: { layoutPreset: 'noCal' } })), false);
  const list = { id: 'c2', when: { choice: { radarMode: ['status', 'graph'] } }, set: {} };
  assert.equal(policy.ruleApplies(list, ctx({ choices: { radarMode: 'graph' } })), true);
  assert.equal(policy.ruleApplies(list, ctx({ choices: { radarMode: 'off' } })), false);
});

test('an unknown condition key throws instead of silently never matching', () => {
  assert.throws(() => policy.ruleApplies({ id: 'typo', when: { wizzard: true }, set: {} }, ctx()),
    /wizzard/);
});

// --- resolveDefaults -------------------------------------------------------

test('nothing is overridden outside the wizard', () => {
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: false })), {});
});

test('the wizard on a health watch moves no status slot: steps stays in the Health bar', () => {
  [ENV_EMERY, ENV_BASALT, ENV_DIORITE].forEach((env) => {
    assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env })), AQI_HIGHLIGHT, env.platform);
  });
  policy.RULES.forEach((rule) => Object.keys(rule.set).forEach((key) => {
    assert.ok(!/^status(Top|Health)/.test(key), rule.id + ' writes ' + key);
  }));
});

test('the wizard with health off applies the AQI rule only', () => {
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, choices: { healthMode: 'off' } })), AQI_HIGHLIGHT);
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env: ENV_APLITE })), AQI_HIGHLIGHT);
  assert.deepEqual(policy.resolveDefaults({ wizard: true }), AQI_HIGHLIGHT,
    'a bare context must not throw — and an unknown platform is not emery');
  assert.deepEqual(
    policy.resolveDefaults(ctx({ wizard: true, env: ENV_EMERY, choices: { healthMode: 'off' } })), AQI_HIGHLIGHT);
});

test('later rules win when two rules set the same key', () => {
  const rules = [
    { id: 'first', why: 'x', set: { statusTopRight: 'steps', threshAqiBoldMode: 'off' } },
    { id: 'second', when: { wizard: true }, why: 'x', set: { statusTopRight: 'battery' } }
  ];
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true }), rules),
    { statusTopRight: 'battery', threshAqiBoldMode: 'off' });
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: false }), rules),
    { statusTopRight: 'steps', threshAqiBoldMode: 'off' }, 'a non-matching later rule cannot override');
});

test('resolveDefaults returns a fresh object and never mutates the table', () => {
  const first = policy.resolveDefaults(ctx({ wizard: true }));
  first.threshAqiOn = false;
  const second = policy.resolveDefaults(ctx({ wizard: true }));
  assert.equal(second.threshAqiOn, true);
  assert.deepEqual(policy.RULES.find((r) => r.id === 'wizard-aqi-keeps-a-warn-signal').set, { threshAqiOn: true });
});

test('rulesFor exposes the matching rules themselves (ids, why)', () => {
  const ids = policy.rulesFor(ctx({ wizard: true })).map((r) => r.id);
  assert.deepEqual(ids, policy.RULES.filter((r) => policy.ruleApplies(r, ctx({ wizard: true }))).map((r) => r.id));
  assert.deepEqual(policy.rulesFor(ctx({ wizard: false })), []);
});

// --- the table itself ------------------------------------------------------

test('rule ids are unique', () => {
  const ids = policy.RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('every rule explains itself in prose, not by restating its keys', () => {
  policy.RULES.forEach((rule) => {
    assert.equal(typeof rule.why, 'string', rule.id + ' has no why');
    assert.ok(rule.why.length >= 40, rule.id + ": why is too short to be an explanation: '" + rule.why + "'");
    assert.match(rule.why, /[.!]$/, rule.id + ': why should read as a sentence');
    assert.doesNotMatch(rule.why, /\b(thresh|status)[A-Z]/,
      rule.id + ': why restates a settings key instead of the reason');
  });
});

test('every key a rule writes is a real schema setting', () => {
  policy.RULES.forEach((rule) => {
    Object.keys(rule.set).forEach((key) => {
      assert.ok(SCHEMA_ITEM[key], rule.id + ' writes unknown setting ' + key);
    });
  });
});

test('every value a rule writes is one the schema item accepts', () => {
  policy.RULES.forEach((rule) => {
    Object.keys(rule.set).forEach((key) => {
      const item = SCHEMA_ITEM[key];
      const value = rule.set[key];
      if (item.type === 'toggle') {
        assert.equal(typeof value, 'boolean', rule.id + ': ' + key + ' is a toggle, so it stores a boolean');
        return;
      }
      if (item.options) {
        const codes = item.options.map((o) => o[1]);
        assert.ok(codes.indexOf(value) !== -1,
          rule.id + ': ' + key + ' = ' + value + ' is not one of ' + codes.join('/'));
        return;
      }
      // Status slots resolve their options at runtime (optionsFrom) — check the catalog.
      assert.ok(catalog.byCode(value), rule.id + ': ' + key + ' = ' + value + ' is not a catalog item');
    });
  });
});

test('the AQI rule switches the highlight on and pins no levels', () => {
  // The rule used to write threshAqiOn THROUGH the switch's onChange hook, which pinned
  // the seed pair of the AQI scale in effect at setup (the US 100/150 of the default
  // WAQI source) — a pair that then stayed US after a switch to Open-Meteo's European
  // scale. The switch has no hook now and the pair stays blank (= the live seed), so
  // the rule writes the switch alone, exactly as a hand flip does.
  const rule = policy.RULES.find((r) => r.id === 'wizard-aqi-keeps-a-warn-signal');
  assert.deepEqual(rule.set, { threshAqiOn: true });
  assert.equal(SCHEMA_ITEM.threshAqiOn.onChange, undefined, 'the switch runs no hook');
  policy.RULES.forEach((r) => assert.equal(r.seedVia, undefined, r.id + ': no write-through hook'));
});

// --- the matrix's design intent --------------------------------------------

// Setup leaves every slot's Bold as its own row sets it (the owner, 2026-11-06: setup
// made the status bars bold).
test('setup writes no Bold mode, on any watch', () => {
  [ENV_BASALT, ENV_DIORITE, ENV_APLITE, ENV_EMERY].forEach((env) => {
    ['all', 'off'].forEach((healthMode) => {
      const keys = Object.keys(policy.resolveDefaults({ wizard: true, env, choices: { healthMode } }));
      assert.deepEqual(keys.filter((k) => /BoldMode$|^statusBoldAll$/.test(k)), [],
        env.platform + ' health ' + healthMode);
    });
  });
});

// --- deliberate omissions (matrix item D) ----------------------------------

test('the step and sleep goals stay off — no rule may switch them on', () => {
  policy.RULES.forEach((rule) => {
    ['threshStepsOn', 'threshSleepOn', 'threshDistanceOn'].forEach((key) => {
      assert.ok(!Object.prototype.hasOwnProperty.call(rule.set, key),
        rule.id + ' switches on the ' + key + ' goal — goals are opt-in by design');
    });
  });
});

test('the wind arrow is a plain schema default, not a rule in this table', () => {
  // It applies to every fresh install, so it belongs on the schema item rather than
  // here — this table is only for defaults that depend on a situation.
  Object.keys(policy.resolveDefaults(ctx({ wizard: true }))).forEach((k) => {
    assert.notEqual(k, 'windSlotDirection',
      'windSlotDirection is a schema defaultValue; a rule here would be a second home for it');
  });
});

test('dependsOn always names a key of the same rule\'s set — a typo must not silently strand its dependents', () => {
  // The consumer (wizard-finish.js applyWizardDefaults) skips a dependent key whenever its
  // anchor does not hold the rule's value; an anchor name that matches nothing would
  // make the dependents unconditionally dead with no error anywhere. Same philosophy
  // as ruleApplies throwing on an unknown `when` condition.
  policy.RULES.forEach((rule) => {
    const dep = rule.dependsOn || {};
    Object.keys(dep).forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(rule.set || {}, key),
        rule.id + ': dependsOn key "' + key + '" is not in the rule\'s set');
      assert.ok(Object.prototype.hasOwnProperty.call(rule.set || {}, dep[key]),
        rule.id + ': dependsOn anchor "' + dep[key] + '" is not in the rule\'s set');
      assert.notEqual(dep[key], key, rule.id + ': "' + key + '" cannot depend on itself');
      // The wizard applies a rule's keys in ONE pass, in set order — an anchor
      // listed after its dependent would not hold the rule's value when the
      // dependent's turn comes, silently skipping it on a fresh install.
      const order = Object.keys(rule.set);
      assert.ok(order.indexOf(dep[key]) < order.indexOf(key),
        rule.id + ': anchor "' + dep[key] + '" must precede "' + key + '" in set order');
    });
  });
});

test('overrules always names keys of the same rule\'s set — a typo must not silently protect nothing', () => {
  // The consumer (wizard.js policyMayWrite) skips the not-still-default guard for
  // a key the rule declares in `overrules`; a name that matches nothing in `set`
  // would be dead with no error anywhere. Same philosophy as the dependsOn pin.
  policy.RULES.forEach((rule) => {
    (rule.overrules || []).forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(rule.set || {}, key),
        rule.id + ': overrules names "' + key + '", which the rule does not set');
    });
  });
});

// --- applyDefaults: the ONE interpreter of the execution vocabulary ---------
// Custom tables via the third param, so these pin the interpreter's semantics
// independent of the live rules — which the wizard-finish and threshold-reset
// integration tests already exercise end-to-end.

test('applyDefaults writes matching rules onto the live state and reports what it wrote', () => {
  const rules = [
    { id: 'a', when: {}, set: { one: 1, two: 2 } },
    { id: 'b', when: { wizard: true }, set: { three: 3 } }
  ];
  const S = {};
  const written = policy.applyDefaults(ctx({ wizard: false, choices: S }), {}, rules);
  assert.deepEqual(written, { one: 1, two: 2 }, 'the non-matching rule stays out');
  assert.deepEqual(S, { one: 1, two: 2 }, 'values land on the live state');
});

test('applyDefaults flattens later-rules-win: one write, one veto check per key', () => {
  // Applied rule-by-rule, a key two rules set would be written (and vetted) twice —
  // the exact dialect drift the one interpreter exists to prevent.
  const rules = [
    { id: 'general', when: {}, set: { key: 'general' } },
    { id: 'specific', when: {}, set: { key: 'specific' } }
  ];
  const calls = [];
  const S = {};
  const written = policy.applyDefaults(ctx({ choices: S }), {
    mayWrite: (key, meta) => { calls.push([key, meta.value]); return true; }
  }, rules);
  assert.equal(S.key, 'specific', 'the later row wins');
  assert.deepEqual(written, { key: 'specific' });
  assert.deepEqual(calls, [['key', 'specific']],
    'exactly one check — flattening, not per-rule application');
});

test('applyDefaults: a dependent stands down unless its anchor holds the rule value', () => {
  const rules = [{ id: 'swap', when: {},
    set: { anchor: 'promoted', dependent: 'evicted' },
    dependsOn: { dependent: 'anchor' } }];
  // Anchor vetoed (e.g. a customized slot under policyMayWrite) -> the dependent
  // must not run alone.
  const vetoed = {};
  const w1 = policy.applyDefaults(ctx({ choices: vetoed }),
    { mayWrite: (key) => key !== 'anchor' }, rules);
  assert.deepEqual(w1, {}, 'no half-applied swap');
  assert.deepEqual(vetoed, {}, 'the live state is untouched');
  // Anchor already in place from an earlier run -> the dependent may proceed.
  const held = { anchor: 'promoted' };
  const w2 = policy.applyDefaults(ctx({ choices: held }),
    { mayWrite: (key) => key !== 'anchor' }, rules);
  assert.deepEqual(w2, { dependent: 'evicted' });
});

test('applyDefaults hands mayWrite the flattened meta, overrules included', () => {
  const rules = [{ id: 'r', when: {}, set: { a: 1, b: 2 }, overrules: ['b'] }];
  const seen = {};
  policy.applyDefaults(ctx({ choices: {} }), {
    mayWrite: (key, meta) => { seen[key] = meta.overrules; return true; }
  }, rules);
  assert.deepEqual(seen, { a: false, b: true });
});

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
const ENV_BASALT = { platform: 'basalt', color: true, round: false, health: true, radar: true, hr: false, thresholds: true, themePolarity: true };
const ENV_DIORITE = { platform: 'diorite', color: false, round: false, health: true, radar: true, hr: true, thresholds: true, themePolarity: true };
const ENV_APLITE = { platform: 'aplite', color: false, round: false, health: false, radar: false, hr: false, thresholds: false, themePolarity: false };
const ENV_EMERY = { platform: 'emery', color: true, round: false, health: true, radar: true, hr: true, thresholds: true, themePolarity: true };

/**
 * @param {Object} [over] Fields to override on the baseline context.
 * @returns {Object} A resolver context {wizard, env, choices}.
 */
function ctx(over) {
  return Object.assign({ wizard: false, env: ENV_BASALT, choices: { healthMode: 'all' } }, over || {});
}

// The matrix, spelled out once. The tests below assert the resolver reproduces
// exactly this and nothing more. Two halves of it are emery-only: emery is the one
// display whose top strip ships three readings, so it is the only one whose top row
// is bolded and the only one where steps is promoted into the row's RIGHT corner
// (elsewhere that corner is the battery).
const BOLD_FORECAST = {
  threshTempBoldMode: 'always',
  threshCityBoldMode: 'always',
  threshAqiBoldMode: 'always'
};
const BOLD_TOP = {
  threshWeekBoldMode: 'always',
  threshDateBoldMode: 'always',
  threshSunBoldMode: 'always'
};
const AQI_HIGHLIGHT = { threshAqiOn: true, threshAqiWarnOutlineOn: true };
// Steps rides into the top row, so on emery it is bolded with the rest of that row —
// the top-row bold names the row's DEFAULT kinds, and this rule is what changes one.
const HEALTH_SLOTS = {
  statusTopRight: 'steps', statusHealthLeft: 'distance', threshStepsBoldMode: 'always'
};
// The narrow platforms: the left slot instead of the corner, and no bold to match —
// nothing in that strip is bold there.
const HEALTH_SLOTS_COMPACT = { statusTopLeft: 'steps', statusHealthLeft: 'distance' };

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
  assert.equal(policy.ruleApplies(rule, ctx({ choices: {} })), true,
    "an unset healthMode falls back to the schema default ('all'), which is on");
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
  assert.equal(policy.ruleApplies({ id: 'p', when: { platform: ['chalk', 'basalt'] }, set: {} }, ctx()), true);
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

test('the wizard on an emery health watch applies the whole matrix', () => {
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env: ENV_EMERY })),
    Object.assign({}, BOLD_FORECAST, BOLD_TOP, AQI_HIGHLIGHT, HEALTH_SLOTS));
});

test('a narrow health watch bolds the Forecast row only and promotes into the left slot', () => {
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true })),
    Object.assign({}, BOLD_FORECAST, AQI_HIGHLIGHT, HEALTH_SLOTS_COMPACT));
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env: ENV_DIORITE })),
    Object.assign({}, BOLD_FORECAST, AQI_HIGHLIGHT, HEALTH_SLOTS_COMPACT),
    'the split is by display width, not by colour or heart rate');
});

test('the wizard with health off applies the bold/AQI rules only', () => {
  const narrow = Object.assign({}, BOLD_FORECAST, AQI_HIGHLIGHT);
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, choices: { healthMode: 'off' } })), narrow);
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env: ENV_APLITE })), narrow);
  assert.deepEqual(policy.resolveDefaults({ wizard: true }), narrow,
    'a bare context must not throw — and an unknown platform is not emery');
  assert.deepEqual(
    policy.resolveDefaults(ctx({ wizard: true, env: ENV_EMERY, choices: { healthMode: 'off' } })),
    Object.assign({}, BOLD_FORECAST, BOLD_TOP, AQI_HIGHLIGHT),
    'emery still bolds its three-up top row with health off — the row is unchanged');
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
  first.threshTempBoldMode = 'off';
  delete first.statusTopLeft;
  const second = policy.resolveDefaults(ctx({ wizard: true }));
  assert.equal(second.threshTempBoldMode, 'always');
  assert.equal(second.statusTopLeft, 'steps');
});

test('rulesFor exposes the matching rules themselves (ids, why, seedVia)', () => {
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

test('seedVia names the very onChange hook the schema item declares', () => {
  policy.RULES.forEach((rule) => {
    const via = rule.seedVia || {};
    Object.keys(via).forEach((key) => {
      assert.ok(Object.prototype.hasOwnProperty.call(rule.set, key),
        rule.id + ': seedVia lists ' + key + ', which the rule does not set');
      assert.equal(SCHEMA_ITEM[key].onChange, via[key],
        rule.id + ': ' + key + ' is seeded by a different hook than the settings page uses');
    });
  });
});

// --- the matrix's design intent --------------------------------------------

// Health OFF is the case where the rows still hold their shipped defaults, so it is
// the one that pins "the bold rules track the row defaults". With health ON the health
// rule swaps steps into the top row, which the sibling test 'every kind the wizard puts
// in the top or forecast row ends up bold' covers.
const boldKeysFor = (env) => Object.keys(
  policy.resolveDefaults({ wizard: true, env, choices: { healthMode: 'off' } }))
  .filter((k) => /BoldMode$/.test(k)).sort();
/**
 * The bold-mode keys of a line's default kinds on one watch, skipping kinds with no
 * bold cell of their own (Empty, the battery glyph).
 * @param {string} id Catalog line id.
 * @param {Object} env Platform env — slotDefault reads the per-platform flavor off it.
 * @returns {string[]} Sorted thresh<Stem>BoldMode keys.
 */
function lineBoldKeys(id, env) {
  const stemOf = {};
  contract.KINDS.forEach((k) => { stemOf[k.code] = k.key; });
  const line = catalog.LINES.filter((l) => l.id === id)[0];
  return line.slots.map((s) => stemOf[catalog.slotDefault(s, env)])
    .filter(Boolean).map((stem) => 'thresh' + stem + 'BoldMode');
}

test('emery bolds exactly the default kinds of its Watch + Forecast rows', () => {
  assert.deepEqual(boldKeysFor(ENV_EMERY),
    lineBoldKeys('forecast', ENV_EMERY).concat(lineBoldKeys('top', ENV_EMERY)).sort(),
    'the bold rules must track the row defaults — if a row default changes, they follow');
});

test('a narrow watch bolds the Forecast row only, and never the lone date', () => {
  const bolded = boldKeysFor(ENV_BASALT);
  assert.deepEqual(bolded, lineBoldKeys('forecast', ENV_BASALT).sort());
  assert.equal(bolded.indexOf('threshDateBoldMode'), -1,
    'the date is the only reading in that strip here, so bolding it would contrast with nothing');
  assert.deepEqual(lineBoldKeys('top', ENV_BASALT), ['threshDateBoldMode'],
    'guard: the date IS in the narrow top row — the assertion above is not vacuous');
});

test('bolding those kinds cannot leak into the Radar or Health rows (defaults are disjoint)', () => {
  // Every flavor of every row, so a code that is only a default on one platform
  // (emery's week/sun, the narrow battery corner) is still covered.
  const codesOf = (id) => {
    const line = catalog.LINES.filter((l) => l.id === id)[0];
    return line.slots.map((s) => line.defaults[s])
      .concat(line.hrDefaults ? line.slots.map((s) => line.hrDefaults[s]) : [])
      .concat(line.emeryDefaults ? line.slots.map((s) => line.emeryDefaults[s]) : []);
  };
  const bolded = codesOf('forecast').concat(codesOf('top'));
  codesOf('radar').concat(codesOf('health')).forEach((code) => {
    if (code === 'empty') { return; }
    assert.ok(bolded.indexOf(code) === -1, code + ' appears in both a bolded and a non-bolded row default');
  });
});

test('the health slot overrides do not collide with their own row siblings', () => {
  const overrides = policy.resolveDefaults(ctx({ wizard: true }));
  catalog.LINES.forEach((line) => {
    const resolved = line.slots.map((slot) => overrides[slot] || line.defaults[slot]);
    const filled = resolved.filter((code) => code && code !== 'empty');
    assert.equal(new Set(filled).size, filled.length,
      line.id + ' row would hold a duplicate slot: ' + resolved.join(', '));
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

test('the schema still ships the step and sleep goals off', () => {
  assert.equal(SCHEMA_ITEM.threshStepsOn.defaultValue, false);
  assert.equal(SCHEMA_ITEM.threshSleepOn.defaultValue, false);
});

const KIND_BOLD_KEY = {
  temp: 'threshTempBoldMode', city: 'threshCityBoldMode', aqi: 'threshAqiBoldMode',
  week: 'threshWeekBoldMode', date: 'threshDateBoldMode', sun: 'threshSunBoldMode',
  steps: 'threshStepsBoldMode', distance: 'threshDistanceBoldMode',
  sleep: 'threshSleepBoldMode', hr: 'threshHrBoldMode'
};
const TOP_AND_FORECAST = ['statusTopLeft', 'statusTopMid', 'statusTopRight',
  'statusForecastLeft', 'statusForecastMid', 'statusForecastRight'];

/**
 * The bold mode each of the two headline rows ends up with after a finished wizard,
 * keyed by slot: what the rules wrote, or nothing when a slot's kind is left alone.
 * @param {Object} env Platform env.
 * @param {Object} choices Stored/wizard choices, e.g. {healthMode: 'all'}.
 * @returns {Object} slotKey -> {kind, boldKey, bold}; slots whose kind has no bold
 *     cell of its own (Empty, the battery glyph) are omitted.
 */
function headlineRowBolds(env, choices) {
  const applied = policy.resolveDefaults({ wizard: true, env, choices });
  const out = {};
  TOP_AND_FORECAST.forEach((slotKey) => {
    const kind = applied[slotKey] || catalog.slotDefault(slotKey, env);
    const boldKey = KIND_BOLD_KEY[kind];
    if (!boldKey) { return; }
    out[slotKey] = { kind, boldKey, bold: applied[boldKey] };
  });
  return out;
}

test('on emery, every kind the wizard puts in the top or forecast row ends up bold', () => {
  // The bold rules name the kinds those rows show BY DEFAULT, and the health rule
  // then swaps one of them out. Asserting the rules agree — rather than listing six
  // key names again — is what stops the next slot swap re-opening this hole: the
  // promoted slot kept steps' own 'warn' default and sat unbolded between two bold
  // neighbours.
  [{ healthMode: 'all' }, { healthMode: 'off' }].forEach((choices) => {
    const rows = headlineRowBolds(ENV_EMERY, choices);
    Object.keys(rows).forEach((slotKey) => {
      const r = rows[slotKey];
      assert.equal(r.bold, 'always',
        `${slotKey} shows "${r.kind}" after the wizard (healthMode ${choices.healthMode}), ` +
        `so ${r.boldKey} must be 'always' — got ${r.bold === undefined ? 'nothing' : r.bold}`);
    });
  });
});

test('on a narrow watch the same agreement holds inverted: the top strip stays light', () => {
  // The mirror of the emery pin. Here the rules must NOT bold anything in the strip
  // beside the clock — including the steps the health rule promotes into it, which is
  // the half a future edit is most likely to get wrong by copying the emery rule.
  [{ healthMode: 'all' }, { healthMode: 'off' }].forEach((choices) => {
    const rows = headlineRowBolds(ENV_BASALT, choices);
    Object.keys(rows).forEach((slotKey) => {
      const r = rows[slotKey];
      const expected = slotKey.indexOf('statusForecast') === 0 ? 'always' : undefined;
      assert.equal(r.bold, expected,
        `${slotKey} shows "${r.kind}" after the wizard (healthMode ${choices.healthMode}), ` +
        `so ${r.boldKey} must be ${expected === undefined ? 'left alone' : "'always'"}`);
    });
  });
  assert.equal(headlineRowBolds(ENV_BASALT, { healthMode: 'all' }).statusTopLeft.kind, 'steps',
    'guard: steps really is promoted into that strip, so the loop above saw it');
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
  // The consumer (wizard.js applyWizardDefaults) skips a dependent key whenever its
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

test('the health-slot swap declares its coupling: eviction and bold depend on the promotion', () => {
  const rule = policy.RULES.find((r) => r.id === 'wizard-health-slots');
  assert.ok(rule, 'the rule exists');
  assert.deepEqual(rule.dependsOn, {
    statusHealthLeft: 'statusTopRight',
    threshStepsBoldMode: 'statusTopRight'
  }, 'both companion writes hang off the steps promotion');

  const compact = policy.RULES.find((r) => r.id === 'wizard-health-slots-compact');
  assert.ok(compact, 'the narrow-platform sibling exists');
  assert.deepEqual(compact.dependsOn, { statusHealthLeft: 'statusTopLeft' },
    'the eviction hangs off the promotion there too — and there is no bold to couple');
  assert.deepEqual(compact.overrules, ['statusTopLeft']);
  assert.equal(compact.set.threshStepsBoldMode, undefined,
    'nothing in that strip is bold on a narrow watch, so the promoted slot is not either');
});

test('the two health-slot rules are mutually exclusive — never both on one watch', () => {
  // They set overlapping keys (statusHealthLeft) with the same value, so a context
  // matching both would be harmless today; it would stop being harmless the moment
  // either rule's eviction changes. Pin the split instead of trusting it.
  const emeryRule = policy.RULES.find((r) => r.id === 'wizard-health-slots');
  const compact = policy.RULES.find((r) => r.id === 'wizard-health-slots-compact');
  [ENV_EMERY, ENV_BASALT, ENV_DIORITE, ENV_APLITE, { platform: 'chalk', health: true }]
    .forEach((env) => {
      const c = { wizard: true, env, choices: { healthMode: 'all' } };
      assert.notEqual(policy.ruleApplies(emeryRule, c) && policy.ruleApplies(compact, c), true,
        env.platform + ' matches both health-slot rules');
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

test('the health-slot swap declares exactly the promotion an overrule', () => {
  // Completing setup with health on is consent to the promised layout, so the
  // promotion may replace even a hand-picked top-right slot. The eviction and
  // bold are NOT listed: they keep the normal protection, and the row-sibling
  // dedupe guard still stands for the promotion itself.
  const rule = policy.RULES.find((r) => r.id === 'wizard-health-slots');
  assert.deepEqual(rule.overrules, ['statusTopRight']);
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

test('applyDefaults flattens later-rules-win: one write, one hook fire per key', () => {
  // The pre-extraction blocks.js loop applied rule-by-rule, so a key two rules set
  // would have been written (and its hook fired) twice — the exact dialect drift
  // the shared interpreter exists to prevent.
  const rules = [
    { id: 'general', when: {}, set: { key: 'general' }, seedVia: { key: 'hook' } },
    { id: 'specific', when: {}, set: { key: 'specific' }, seedVia: { key: 'hook' } }
  ];
  const calls = [];
  const S = {};
  policy.applyDefaults(ctx({ choices: S }), {
    getHook: () => (state, before, value, env, key) => calls.push([key, before, value])
  }, rules);
  assert.equal(S.key, 'specific', 'the later row wins');
  assert.deepEqual(calls, [['key', undefined, 'specific']],
    'exactly one hook fire — flattening, not per-rule application');
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

test('applyDefaults writes seedVia keys through the resolved hook, against the live state', () => {
  const rules = [{ id: 'r', when: {}, set: { toggleKey: true },
    seedVia: { toggleKey: 'seedCompanion' } }];
  const S = { existing: 'kept' };
  policy.applyDefaults(ctx({ choices: S }), {
    getHook: (name) => name === 'seedCompanion'
      ? (state, before, value, env, key) => { state.companion = key + ':' + value; }
      : null
  }, rules);
  assert.deepEqual(S, { existing: 'kept', toggleKey: true, companion: 'toggleKey:true' });
});

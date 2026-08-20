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

/**
 * @param {Object} [over] Fields to override on the baseline context.
 * @returns {Object} A resolver context {wizard, env, choices}.
 */
function ctx(over) {
  return Object.assign({ wizard: false, env: ENV_BASALT, choices: { healthMode: 'all' } }, over || {});
}

// The matrix, spelled out once. The tests below assert the resolver reproduces
// exactly this and nothing more.
const BOLD_ALWAYS = {
  threshTempBoldMode: 'always',
  threshCityBoldMode: 'always',
  threshAqiBoldMode: 'always',
  threshWeekBoldMode: 'always',
  threshDateBoldMode: 'always',
  threshSunBoldMode: 'always'
};
const AQI_HIGHLIGHT = { threshAqiOn: true, threshAqiWarnOutlineOn: true };
// Steps rides into the top row, so it is bolded with the rest of that row — the
// bold rule above names the row's DEFAULT kinds, and this rule is what changes one.
const HEALTH_SLOTS = {
  statusTopRight: 'steps', statusHealthLeft: 'distance', threshStepsBoldMode: 'always'
};

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

test('the wizard on a health watch applies the whole matrix', () => {
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true })),
    Object.assign({}, BOLD_ALWAYS, AQI_HIGHLIGHT, HEALTH_SLOTS));
});

test('the wizard with health off applies the bold/AQI rules only', () => {
  const expected = Object.assign({}, BOLD_ALWAYS, AQI_HIGHLIGHT);
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, choices: { healthMode: 'off' } })), expected);
  assert.deepEqual(policy.resolveDefaults(ctx({ wizard: true, env: ENV_APLITE })), expected);
  assert.deepEqual(policy.resolveDefaults({ wizard: true }), expected, 'a bare context must not throw');
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
  delete first.statusTopRight;
  const second = policy.resolveDefaults(ctx({ wizard: true }));
  assert.equal(second.threshTempBoldMode, 'always');
  assert.equal(second.statusTopRight, 'steps');
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

test('the bolded kinds are exactly the default kinds of the Watch + Forecast rows', () => {
  const stemOf = {};
  contract.KINDS.forEach((k) => { stemOf[k.code] = k.key; });
  const lineDefaults = (id) => {
    const line = catalog.LINES.filter((l) => l.id === id)[0];
    return line.slots.map((s) => line.defaults[s]);
  };
  // Health OFF is the case where the rows still hold their shipped defaults, so it
  // is the one that pins "the bold rule tracks the row defaults". With health ON the
  // health rule swaps steps into the top row and bolds it too, which the sibling test
  // 'every kind the wizard puts in the top or forecast row ends up bold' covers.
  const expected = lineDefaults('forecast').concat(lineDefaults('top'))
    .map((code) => 'thresh' + stemOf[code] + 'BoldMode').sort();
  const bolded = Object.keys(
    policy.resolveDefaults(ctx({ wizard: true, choices: { healthMode: 'off' } })))
    .filter((k) => /BoldMode$/.test(k)).sort();
  assert.deepEqual(bolded, expected,
    'the bold rule must track the Watch/Forecast row defaults — if a row default changes, this rule follows');
});

test('bolding those kinds cannot leak into the Radar or Health rows (defaults are disjoint)', () => {
  const codesOf = (id) => {
    const line = catalog.LINES.filter((l) => l.id === id)[0];
    return line.slots.map((s) => line.defaults[s])
      .concat(line.hrDefaults ? line.slots.map((s) => line.hrDefaults[s]) : []);
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

test('every kind the wizard puts in the top or forecast row ends up bold', () => {
  // The bold rule names the kinds those rows show BY DEFAULT, and the health rule
  // then swaps one of them out. Asserting the two rules agree — rather than listing
  // six key names again — is what stops the next slot swap re-opening this hole:
  // the promoted slot kept steps' own 'warn' default and sat unbolded between two
  // bold neighbours.
  const KIND_BOLD_KEY = {
    temp: 'threshTempBoldMode', city: 'threshCityBoldMode', aqi: 'threshAqiBoldMode',
    week: 'threshWeekBoldMode', date: 'threshDateBoldMode', sun: 'threshSunBoldMode',
    steps: 'threshStepsBoldMode', distance: 'threshDistanceBoldMode',
    sleep: 'threshSleepBoldMode', hr: 'threshHrBoldMode'
  };
  const TOP_AND_FORECAST = ['statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight'];
  const catalog = require('../src/pkjs/status-line-catalog.js');
  const lineDefault = (slotKey) => {
    const line = catalog.LINES.find((l) => l.slots.indexOf(slotKey) !== -1);
    return line.defaults[slotKey];
  };

  [{ healthMode: 'all' }, { healthMode: 'off' }].forEach((choices) => {
    const applied = policy.resolveDefaults({
      wizard: true,
      env: { platform: 'emery', health: true, hr: true, radar: true, thresholds: true },
      choices
    });
    TOP_AND_FORECAST.forEach((slotKey) => {
      const kind = applied[slotKey] || lineDefault(slotKey);
      const boldKey = KIND_BOLD_KEY[kind];
      if (!boldKey) { return; }   // a kind with no bold cell of its own
      const bold = applied[boldKey];
      assert.equal(bold, 'always',
        `${slotKey} shows "${kind}" after the wizard (healthMode ${choices.healthMode}), ` +
        `so ${boldKey} must be 'always' — got ${bold === undefined ? 'nothing' : bold}`);
    });
  });
});

#!/usr/bin/env node
'use strict';
// scripts/print-defaults.js — `mise defaults`. One readable overview of every settings
// default that is NOT simply "the same everywhere": the ones that depend on the watch,
// on a capability, or on what the user picked in the first-run wizard.
//
// Everything printed here is RENDERED FROM THE CODE THAT DECIDES IT — nothing is
// retyped, so the page cannot drift from behaviour:
//
//   · situational rules  src/pkjs/settings/defaults-policy.js  RULES + resolveDefaults()
//   · static defaults    src/pkjs/settings/schema.js           defaultValue, read through
//                                                              config-ui/lib/defaults.js
//   · per-watch defaults src/pkjs/settings/schema.js           defaultFrom, resolved through
//                                                              engine.resolveDefaultFrom()
//   · capabilities       config-ui/lib/platform.js             computeEnv() — the only place
//                                                              that knows what a watch can do
//   · platform list      package.template.json                 pebble.targetPlatforms
//
// To CHANGE a default: a rule row goes in defaults-policy.js, a flat default in schema.js.
// Never here — this file only reports. test/print-defaults.test.js pins the report against
// the real wizard, so a rule that stops being printed (or starts lying) fails the suite.
//
// Node-only (scripts/ may use ES6); the modules it reads are the ES5 watch/webview ones.

// The config-UI modules attach to a shared global PConf and must be required in this order:
// blocks.js registers the 'statusSlotDefault' resolver that the schema's defaultFrom items
// resolve through. Same boot as test/config-wizard.test.js.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/reset-status-defaults.js');

const eng = require('../src/pkjs/config-ui/lib/engine.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
const { deriveDefaults } = require('../src/pkjs/config-ui/lib/defaults.js');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');
const policy = require('../src/pkjs/settings/defaults-policy.js');

/**
 * Load the settings schema, explaining the one failure mode that isn't obvious: schema.js
 * reads the GENERATED package.json for its version label.
 * @returns {Object} The config schema (tabs/sections/items).
 */
function loadSchema() {
  try {
    return require('../src/pkjs/settings/schema.js');
  } catch (err) {
    if (String(err && err.message).indexOf('package.json') !== -1) {
      err.message += '\n\n  schema.js reads the generated package.json — run `mise prepare-package` first.';
    }
    throw err;
  }
}

const schema = loadSchema();
// The shipped watch platforms, from the manifest template rather than a list typed here.
const PLATFORMS = require('../package.template.json').pebble.targetPlatforms;

// The three situations a default can come out of. `healthMode` is the AXIS of this table,
// not one of its answers, so it is set as an input and excluded from the printed rows.
const SCENARIOS = [
  { id: 'fresh', label: 'fresh install', wizard: false, healthMode: null },
  { id: 'wizard-health-off', label: 'wizard, no health', wizard: true, healthMode: 'off' },
  { id: 'wizard-health-on', label: 'wizard, health on', wizard: true, healthMode: 'all' }
];
const SCENARIO_INPUT_KEYS = ['healthMode'];

const WIDTH = 92;

// --- the three sources of a default -----------------------------------------------

/**
 * @param {string} platform Pebble platform name.
 * @returns {Object} The config-UI env facts for that watch (computeEnv is the SoT).
 */
function envFor(platform) { return platformLib.computeEnv({ platform: platform }); }

/**
 * Every schema item whose default is resolved per watch (`defaultFrom`) instead of stored
 * flat — exactly the items deriveDefaults() skips, which is why they are worth a section.
 * @returns {Array.<{key: string, resolver: string, item: Object}>} One row per such item.
 */
function unseededItems() {
  const out = [];
  eachItem(schema, (it) => {
    if (it.messageKey && it.defaultFrom) {
      out.push({ key: it.messageKey, resolver: it.defaultFrom.resolver, item: it });
    }
  });
  return out;
}

/**
 * A fresh install's settings on one watch: the flat schema defaults plus every per-watch
 * default resolved for it. No wizard, no situational rules.
 * @param {string} platform Pebble platform name.
 * @returns {Object} messageKey -> value.
 */
function baseState(platform) {
  const env = envFor(platform);
  const S = Object.assign({}, deriveDefaults(schema));
  unseededItems().forEach((row) => { S[row.key] = eng.resolveDefaultFrom(row.item, env); });
  return S;
}

/**
 * The situational overrides one scenario earns on one watch — the policy table's answer,
 * which is what the wizard writes onto an untouched config.
 * @param {string} platform Pebble platform name.
 * @param {Object} scenario A SCENARIOS row.
 * @returns {Object} messageKey -> value, empty when no rule applies.
 */
function policyOverrides(platform, scenario) {
  const choices = baseState(platform);
  if (scenario.healthMode) { choices.healthMode = scenario.healthMode; }
  return policy.resolveDefaults({ wizard: scenario.wizard, env: envFor(platform), choices: choices });
}

/**
 * The settings a watch ends up with in one scenario: fresh install, then the overrides.
 * @param {string} platform Pebble platform name.
 * @param {Object} scenario A SCENARIOS row.
 * @returns {Object} messageKey -> value.
 */
function resolveScenario(platform, scenario) {
  const S = baseState(platform);
  if (scenario.healthMode) { S.healthMode = scenario.healthMode; }
  return Object.assign(S, policyOverrides(platform, scenario));
}

// --- formatting helpers -------------------------------------------------------------

/**
 * @param {*} value Any settings value.
 * @returns {string} A short printable form; strings are quoted so '' and 0 stay visible.
 */
function fmt(value) {
  if (typeof value === 'undefined') { return '--'; }
  if (typeof value === 'string') { return "'" + value + "'"; }
  return String(value);
}

/**
 * @param {string} text Text to fit.
 * @param {number} width Maximum columns.
 * @returns {string} The text, truncated with an ellipsis when it would overflow.
 */
function clip(text, width) {
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…';
}

/**
 * Render a plain-text table: columns sized to their content, left-aligned, two spaces apart.
 * @param {Array.<Array.<string>>} rows Rows of cells; the first row is the header.
 * @param {string} [indent] Prefix for every line.
 * @param {number} [cellMax] Maximum width of one cell before it is clipped.
 * @returns {string[]} The rendered lines.
 */
function table(rows, indent, cellMax) {
  const pad = indent || '';
  const max = cellMax || 24;
  const body = rows.map((r) => r.map((c) => clip(String(c), max)));
  const widths = [];
  body.forEach((r) => r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, c.length); }));
  return body.map((r) => (pad + r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ')).trimEnd());
}

/**
 * Wrap prose to a column budget.
 * @param {string} text Text to wrap.
 * @param {number} width Maximum line width including the indent.
 * @param {string} indent Prefix for every line.
 * @returns {string[]} The wrapped lines.
 */
function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach((w) => {
    if (line && (indent + line + ' ' + w).length > width) { lines.push(indent + line); line = w; }
    else { line = line ? line + ' ' + w : w; }
  });
  if (line) { lines.push(indent + line); }
  return lines;
}

/**
 * A labelled paragraph with a hanging indent, so continuation lines line up under the text
 * rather than under the label.
 * @param {string} indent Prefix for the whole block.
 * @param {string} label Field name, e.g. 'why'.
 * @param {string} text The prose.
 * @returns {string[]} The rendered lines.
 */
function field(indent, label, text) {
  const head = indent + label.padEnd(7);
  const hang = ' '.repeat(head.length);
  return wrap(text, WIDTH, hang).map((l, i) => (i === 0 ? head + l.trimStart() : l));
}

/**
 * @param {string} title Section title.
 * @returns {string[]} Title plus its rule line.
 */
function heading(title) { return ['', title, '─'.repeat(Math.min(WIDTH, title.length + 2))]; }

// --- section 1: the situational rules -------------------------------------------------

// Readable phrasing for the `when` vocabulary defaults-policy.js defines. Anything the
// policy adds later still prints (as `key = value`), so a new condition can never go
// missing from this page — it just reads more tersely until it gets a sentence here.
const CONDITION_PROSE = {
  wizard: (v) => (v ? 'the first-run wizard is finishing' : 'outside the first-run wizard'),
  health: (v) => (v ? 'the watch has health AND the user has not switched it off'
    : 'no health on this watch, or it is switched off'),
  hr: (v) => (v ? 'the watch has a heart-rate sensor' : 'no heart-rate sensor'),
  radar: (v) => (v ? 'the watch ships the rain radar' : 'no rain radar on this watch'),
  thresholds: (v) => (v ? 'the watch can draw threshold highlighting' : 'no threshold highlighting'),
  color: (v) => (v ? 'colour display' : 'black-and-white display'),
  round: (v) => (v ? 'round screen' : 'rectangular screen'),
  themePolarity: (v) => (v ? 'the watch ships the light theme' : 'no light theme on this watch')
};

/**
 * @param {string} key Condition name from the rule's `when`.
 * @param {*} value The wanted value.
 * @returns {string} A sentence a reader can disagree with.
 */
function describeCondition(key, value) {
  if (CONDITION_PROSE[key]) { return CONDITION_PROSE[key](value); }
  if (key === 'platform') { return 'watch is ' + [].concat(value).join(' or '); }
  if (key === 'platformNot') { return 'watch is NOT ' + [].concat(value).join(' or '); }
  if (key === 'choice') {
    return Object.keys(value).map((k) => k + ' is ' + [].concat(value[k]).map(fmt).join(' or ')).join(', ');
  }
  return key + ' = ' + JSON.stringify(value);
}

/**
 * @returns {string[]} Section 1: every rule, its conditions, its reason and its keys.
 */
function renderRules() {
  const out = heading('1 · SITUATIONAL RULES — defaults that depend on the moment');
  out.push(...wrap('Each row below applies only when its conditions hold, and later rows win. '
    + 'Add or change one in the RULES table of src/pkjs/settings/defaults-policy.js; nothing '
    + 'applies them on its own — the wizard resolves the table on its finish button. A value '
    + 'marked "via <hook>" is written through the settings page\'s own onChange hook, so the '
    + 'companions it seeds (a threshold pair, an outline colour) are identical to what flipping '
    + 'that control by hand produces.', WIDTH, '  '));
  policy.RULES.forEach((rule, i) => {
    out.push('');
    out.push('  [' + (i + 1) + '] ' + rule.id);
    const conds = Object.keys(rule.when || {});
    out.push(...field('      ', 'when', conds.length
      ? conds.map((k) => describeCondition(k, rule.when[k])).join('  AND  ')
      : 'always (no conditions)'));
    out.push(...field('      ', 'why', rule.why));
    const set = rule.set || {};
    const via = rule.seedVia || {};
    Object.keys(set).forEach((key, n) => {
      const seed = via[key] ? '   via ' + via[key] + ' hook' : '';
      out.push('      ' + (n === 0 ? 'sets   ' : '       ') + key.padEnd(24) + ' '
        + fmt(set[key]).padEnd(8) + seed);
    });
  });
  return out.map((l) => l.trimEnd());
}

// --- section 2: the resolved comparison ------------------------------------------------

/**
 * @returns {string[]} The capability matrix, straight out of computeEnv().
 */
function renderCapabilities() {
  const flags = Object.keys(envFor(PLATFORMS[0])).filter((k) => k !== 'platform');
  const rows = [['platform'].concat(flags)];
  PLATFORMS.forEach((p) => {
    const env = envFor(p);
    rows.push([p].concat(flags.map((f) => (env[f] ? 'yes' : '-'))));
  });
  return table(rows, '    ');
}

/**
 * The keys worth a column comparison: those that are not identical in every
 * platform x scenario state (the axis keys never qualify — they are inputs).
 * @param {Object} states platform -> scenario id -> state.
 * @returns {{keys: string[], omitted: number, total: number}} Differing keys and the count hidden.
 */
function differingKeys(states) {
  const all = Object.keys(states[PLATFORMS[0]][SCENARIOS[0].id]).sort();
  const keys = all.filter((key) => {
    if (SCENARIO_INPUT_KEYS.indexOf(key) !== -1) { return false; }
    const seen = {};
    PLATFORMS.forEach((p) => SCENARIOS.forEach((sc) => { seen[fmt(states[p][sc.id][key])] = true; }));
    return Object.keys(seen).length > 1;
  });
  return { keys: keys, omitted: all.length - keys.length - SCENARIO_INPUT_KEYS.length, total: all.length };
}

/**
 * Group platforms whose whole comparison table is identical, so the report shows one block
 * per DISTINCT answer rather than five near-copies.
 * @param {Object} states platform -> scenario id -> state.
 * @param {string[]} keys The keys being compared.
 * @returns {Array.<{platforms: string[], values: Object}>} One entry per distinct block.
 */
function groupPlatforms(states, keys) {
  const groups = [];
  PLATFORMS.forEach((p) => {
    const sig = JSON.stringify(SCENARIOS.map((sc) => keys.map((k) => fmt(states[p][sc.id][k]))));
    const hit = groups.filter((g) => g.sig === sig)[0];
    if (hit) { hit.platforms.push(p); } else { groups.push({ sig: sig, platforms: [p], sample: p }); }
  });
  return groups;
}

/**
 * @returns {string[]} Section 2: what the settings actually hold, per watch and scenario.
 */
function renderComparison() {
  const states = {};
  PLATFORMS.forEach((p) => {
    states[p] = {};
    SCENARIOS.forEach((sc) => { states[p][sc.id] = resolveScenario(p, sc); });
  });
  const diff = differingKeys(states);
  const unseeded = {};
  unseededItems().forEach((row) => { unseeded[row.key] = true; });

  const out = heading('2 · WHAT A WATCH ENDS UP WITH — by platform and by scenario');
  out.push(...wrap('Only the ' + diff.keys.length + ' settings that differ somewhere are listed. The other '
    + diff.omitted + ' of ' + diff.total + ' read the same in all ' + (PLATFORMS.length * SCENARIOS.length)
    + ' cases: they are plain `defaultValue` entries in src/pkjs/settings/schema.js, which is '
    + 'where you change one (e.g. swapClockStatus). healthMode is the axis of the wizard '
    + 'columns, not a result, so it is not a row. A key marked * is not seeded into the '
    + 'settings blob at all — see section 3.', WIDTH, '  '));
  out.push('');
  out.push('  capabilities per watch (config-ui/lib/platform.js computeEnv):');
  out.push(...renderCapabilities());

  groupPlatforms(states, diff.keys).forEach((group) => {
    out.push('');
    out.push('  ' + group.platforms.join(', ')
      + (group.platforms.length > 1 ? '   (identical answers)' : ''));
    const rows = [['setting'].concat(SCENARIOS.map((sc) => sc.label))];
    diff.keys.forEach((key) => {
      rows.push([key + (unseeded[key] ? ' *' : '')]
        .concat(SCENARIOS.map((sc) => fmt(states[group.sample][sc.id][key]))));
    });
    out.push(...table(rows, '    '));
  });
  return out;
}

// --- section 3: the keys nothing seeds --------------------------------------------------

// One line per defaults-resolver explaining what it reads. A resolver added later simply
// prints without a note — it can never be hidden from the list, only under-explained.
const RESOLVER_PROSE = {
  statusSlotDefault: 'status-line-catalog.js slotDefault(), which picks the hrDefaults flavour on an HR watch',
  todayDate: 'today, resolved when the settings page opens'
};

/**
 * @returns {string[]} Section 3: the defaultFrom keys, which no saved blob contains.
 */
function renderUnseeded() {
  const rows = unseededItems();
  const out = heading('3 · NOT SEEDED INTO THE SETTINGS BLOB — resolved per watch instead');
  out.push(...wrap('deriveDefaults() deliberately skips every `defaultFrom` item, so these '
    + rows.length + ' keys DO NOT EXIST in stored settings until the user saves the settings '
    + 'page. The trap: reading one straight off the blob gives undefined on a watch nobody has '
    + 'configured. Resolve it instead (status-line-catalog.slotDefault / '
    + 'engine.resolveDefaultFrom), which is what the values below are.', WIDTH, '  '));
  const byResolver = {};
  rows.forEach((row) => {
    if (!byResolver[row.resolver]) { byResolver[row.resolver] = []; }
    byResolver[row.resolver].push(row);
  });
  Object.keys(byResolver).forEach((resolver) => {
    out.push('');
    out.push('  via the ' + resolver + ' resolver:');
    if (RESOLVER_PROSE[resolver]) { out.push(...wrap(RESOLVER_PROSE[resolver], WIDTH, '    ')); }
    const head = [['setting'].concat(PLATFORMS)];
    const body = byResolver[resolver].map((row) => [row.key].concat(
      PLATFORMS.map((p) => fmt(eng.resolveDefaultFrom(row.item, envFor(p))))));
    // Rows that read the same on every watch say so once instead of repeating a value
    // five times; only the genuinely per-watch ones earn the full spread.
    const same = body.filter((r) => r.slice(1).every((c) => c === r[1]));
    const varies = body.filter((r) => !r.slice(1).every((c) => c === r[1]));
    if (varies.length) {
      out.push('    differs by watch:');
      out.push(...table(head.concat(varies), '      ', 28));
    }
    if (same.length) {
      if (varies.length) { out.push(''); }
      out.push('    same on every watch:');
      out.push(...table(same.map((r) => [r[0], r[1]]), '      ', 40));
    }
  });
  return out;
}

// --- the page ---------------------------------------------------------------------------

/**
 * Render the whole overview.
 * @returns {string} The report, ready for stdout.
 */
function render() {
  const out = [];
  out.push('='.repeat(WIDTH));
  out.push(' WarnWeather settings defaults — where each one comes from');
  out.push('='.repeat(WIDTH));
  out.push(...wrap('Rendered from the code that decides them, so this page cannot drift: the rules '
    + 'come from defaults-policy.js, the flat defaults from schema.js via deriveDefaults(), the '
    + 'per-watch ones from engine.resolveDefaultFrom(), and the capabilities from computeEnv(). '
    + 'Change a default there, not here, then re-run `mise defaults`.', WIDTH, ' '));
  out.push(...renderRules());
  out.push(...renderComparison());
  out.push(...renderUnseeded());
  out.push('');
  return out.join('\n');
}

module.exports = {
  PLATFORMS: PLATFORMS,
  SCENARIOS: SCENARIOS,
  envFor: envFor,
  unseededItems: unseededItems,
  baseState: baseState,
  policyOverrides: policyOverrides,
  resolveScenario: resolveScenario,
  render: render
};

if (require.main === module) { process.stdout.write(render() + '\n'); }

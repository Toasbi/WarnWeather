// test/helpers/config-schema-golden.js — builds test/config-schema.golden.json, the
// settings page's whole schema surface as data:
//  - `schema`: the schema exactly as the page receives it. generateUrl injects it as
//    JSON (config-ui/index.js inlineScriptJson), and it is ONE object for every
//    platform — the platform facts are showWhen predicates the page evaluates — so its
//    JSON text is everything a builder refactor in schema.js can change. Only the
//    version label is normalised: release-please bumps it, and a dev build tags it.
//  - `levelRows`: what the resolvers behind the level groups' rows make of their args
//    on every platform the config UI knows: each slider's resolved range config
//    (thresholdRange — geometry, colours, chip labels) and each warn look's hint
//    (warnLookHint) for every look under the theme states its copy branches on. These
//    rows' args carry voice copy into the resolvers, so an args reshape shows up in
//    `schema` while this half proves the page still shows the same words.
//
// The golden is a byte-for-byte pin (test/config-schema-golden.test.js). After a
// DELIBERATE schema change, rewrite it with
//     node test/helpers/config-schema-golden.js
// and review its diff like code. Never regenerate it to make an unexplained failure go
// away: a diff there is a change to what users see.
'use strict';
const fs = require('fs');
const path = require('path');

const schema = require('../../src/pkjs/settings/schema.js');
const platform = require('../../src/pkjs/config-ui/lib/platform.js');
const { eachItem } = require('../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../src/pkjs/config-ui/lib/color.js');
require('../../src/pkjs/config-ui/lib/show-when.js');
require('../../src/pkjs/config-ui/lib/engine.js');
require('../../src/pkjs/settings/blocks.js');

const PC = global.PConf;
const GOLDEN_PATH = path.join(__dirname, '..', 'config-schema.golden.json');

// Every platform config-ui/lib/platform.js distinguishes (chalk included: its env is
// round, even though the app does not target it today).
const PLATFORMS = ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint'];

/**
 * The theme states the warn look's hint branches on (blocks.js warnLookHint): a colour
 * day theme, a B&W day theme, a colour day with a B&W night, and each of those two
 * colour cases with Fill's two colours picked the same.
 * @param {string} stem Kind key stem, e.g. 'Wind'.
 * @returns {Object<string, Object>} Settings state per state name.
 */
function hintStates(stem) {
  const same = {};
  same['thresh' + stem + 'WarnColor'] = '#FF0000';
  same['thresh' + stem + 'DangerColor'] = '#FF0000';
  return {
    dark: { theme: 'dark' },
    bw: { theme: 'bw' },
    darkNightBw: { theme: 'dark', themeAuto: true, themeNight: 'bw' },
    sameColor: Object.assign({ theme: 'dark' }, same),
    sameColorNightBw: Object.assign({ theme: 'light', themeAuto: true, themeNight: 'bw-light' }, same)
  };
}

/**
 * What the thresholdRange resolver adds to a slider item: the engine's resolved item
 * minus the schema item's own properties (the args shape lives in `schema`).
 * @param {Object} item A rangeFrom item.
 * @param {Object} env Platform env.
 * @returns {Object} The resolver's contribution.
 */
function resolvedRange(item, env) {
  const full = PC.engine.resolveRangeItem(item, {}, env);
  const out = {};
  Object.keys(full).forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(item, k)) { out[k] = full[k]; }
  });
  return out;
}

/**
 * The warn look's resolved hint for every look under every hint state; null where the
 * resolver defers to the row's own hintByValue.
 * @param {Object} item A warnLookHint item.
 * @param {Object} env Platform env.
 * @returns {Object<string, Object<string, ?string>>} Hint per state, per look.
 */
function resolvedLookHints(item, env) {
  const states = hintStates(item.hintFrom.args.keyStem);
  const out = {};
  Object.keys(states).forEach((name) => {
    out[name] = {};
    item.options.forEach((opt) => {
      const hint = PC.engine.resolveHint(item, states[name], env, opt[1]);
      out[name][opt[1]] = hint === undefined ? null : hint;
    });
  });
  return out;
}

/**
 * Build the snapshot the golden holds.
 * @returns {{schema: Object, levelRows: Object}} The snapshot.
 */
function buildSnapshot() {
  const json = JSON.parse(JSON.stringify(schema));
  json.versionLabel = json.versionLabel.replace(/^v\S+( \(dev\))?/, 'v<version>');
  const levelRows = {};
  PLATFORMS.forEach((p) => {
    const env = platform.computeEnv({ platform: p });
    const rows = {};
    eachItem(schema, (it) => {
      if (it.rangeFrom && it.rangeFrom.resolver === 'thresholdRange') {
        rows[it.messageKey] = resolvedRange(it, env);
      } else if (it.hintFrom && it.hintFrom.resolver === 'warnLookHint') {
        rows[it.messageKey] = resolvedLookHints(it, env);
      }
    });
    levelRows[p] = rows;
  });
  return { schema: json, levelRows: levelRows };
}

/**
 * The golden's text form of one snapshot part (2-space JSON, one value per line, so
 * a diff names the changed line).
 * @param {*} part A snapshot part.
 * @returns {string} Its JSON text.
 */
function stringify(part) {
  return JSON.stringify(part, null, 2);
}

if (require.main === module) {
  fs.writeFileSync(GOLDEN_PATH, stringify(buildSnapshot()) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), GOLDEN_PATH));
}

module.exports = { buildSnapshot: buildSnapshot, stringify: stringify, GOLDEN_PATH: GOLDEN_PATH, PLATFORMS: PLATFORMS };

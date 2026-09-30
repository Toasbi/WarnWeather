// test/helpers/clay-migration-golden.js — the boot scenarios behind
// test/clay-migrations.golden.json. That file holds what the pre-registry runner
// (the hand-threaded clay-migrations.js at c676e1f5) made of each scenario, so the
// registry runner is pinned to the old behaviour: the migrated blob, clayRequired,
// and which markers are set by the run and which by the Clay ACK. The old runner's
// three 1.24.0 dev markers are folded into ALERT_LEVELS_MIGRATION_KEY, whose string
// is the last of them.
//
// The golden must NOT be regenerated from the current runner to make a failure go
// away: a diff there is a behaviour change on real installs. Change a scenario only
// together with a deliberate, reviewed golden update.
'use strict';
const KEYS = require('../../src/pkjs/storage-keys');
const REGISTRY = require('../../src/pkjs/migrations/registry.js');

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF };

// The entries added after the golden was recorded. The golden pins what the
// pre-registry runner did, so every scenario runs with these already marked (they
// never run, and never show among the markers a run sets); their own tests cover them.
const AFTER_GOLDEN = [KEYS.SEED_PAIR_BLANK_MIGRATION_KEY, KEYS.TEMP_SEPARATOR_BAR_MIGRATION_KEY,
  KEYS.ON_DEMAND_MIGRATION_KEY];

// Every marker a 1.23.1 install holds: the whole ledger but the 1.24.0 entries.
const THROUGH_1_23_1 = REGISTRY.map((e) => e.key).filter((k) =>
  k !== KEYS.ALERT_LEVELS_MIGRATION_KEY && AFTER_GOLDEN.indexOf(k) === -1);

// A 1.23.1 blob carrying every shape the 1.24.0 moves convert, plus shapes the
// already-marked older entries would have moved (the no-rain text, the stripe).
const BLOB_1_23_1 = {
  theme: 'dark', radarMode: 'countdown', radarProvider: 'dwd', rainCountdownHorizon: '0',
  radarNoRainText: 'No rain ahead', fifthLine: 'pressure', fifthLineStyle: 'stripeTop',
  threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8', threshUvWarnOutlineOn: false,
  threshUvWarnColor: '', threshUvDangerColor: 0xFFFFFF,
  threshWindOn: true, threshWindWarn: '', threshWindDanger: '', threshWindWarnOutlineOn: true,
  threshWindWarnColor: 0xFFFFFF, threshWindDangerColor: '#000000',
  threshGustOn: true, threshGustWarn: '8', threshGustDanger: '6', threshGustWarnColor: 0x00AAFF,
  threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '150', threshAqiWarnOutlineOn: false,
  threshAqiWarnColor: '', threshAqiDangerColor: 0x5500FF,
  threshPollenWarnColor: null,
  threshSleepOn: true, threshSleepWarn: '7', threshSleepDanger: '', threshSleepWarnOutlineOn: true,
  threshSleepWarnColor: null,
  threshStepsOn: false, threshStepsWarn: '8000', threshStepsDanger: '10000',
  threshStepsWarnOutlineOn: false, threshStepsWarnColor: '', threshStepsDangerColor: 0xFFFFFF,
  threshDistanceOn: false, threshDistanceWarn: '4,5', threshDistanceDanger: '5',
  threshDistanceWarnOutlineOn: true, threshDistanceWarnColor: 0x55FF00
};

// An install from before any marker: every entry runs, in registry order, and the
// ones that interact (weekend colours -> white holiday, carried tint -> re-tune,
// radar mode -> rain window) all fire.
const LEGACY = Object.assign({}, BLOB_1_23_1, {
  theme: 'light', colorSunday: COLORS.white, colorSaturday: COLORS.white, colorUSFederal: COLORS.white,
  holidaysEnabled: true, holidayCountry: 'DE', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA',
  holidayRegion: 'all', statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep',
  statusTopRight: 'empty', radarProvider: 'disabled', rainBarColor: 'multicolor', radarColor: 'multicolor',
  gcPrecipLineLight: 0x00AAFF, gcPrecipNightLight: 0x0000AA, gcWindLineLight: 0xFFFF00,
  gcWindFillLight: 0xAAFF55, gcWindNightLight: 0xAAFF55, gcUvLineLight: 0xFF00FF,
  gcUvNightLight: 0x550055, gcGustNightLight: 0x555555, gcPressureFillLight: 0xFFAA00,
  gcPressureNightLight: 0xAA5500, secondaryLine: 'wind', secondaryLineFill: true,
  thirdLine: 'dew', thirdLineStyle: 'stripeBottom', fifthLine: 'off', fifthLineStyle: 'stripeTop',
  radarNoRainText: '', onboardingDone: false
});
delete LEGACY.radarMode;

const SCENARIOS = [
  { name: 'fresh install, basalt', platform: 'basalt', hadExistingInstall: false, blob: null, marked: [] },
  { name: 'fresh install, emery', platform: 'emery', hadExistingInstall: false, blob: null, marked: [] },
  { name: '1.23.1 upgrade, Rain alert only, window Off', platform: 'basalt', hadExistingInstall: true,
    blob: BLOB_1_23_1, marked: THROUGH_1_23_1 },
  { name: '1.23.1 upgrade, graph, window Off', platform: 'basalt', hadExistingInstall: true,
    blob: Object.assign({}, BLOB_1_23_1, { radarMode: 'graph' }), marked: THROUGH_1_23_1 },
  { name: '1.23.1 upgrade, graph, window 30', platform: 'basalt', hadExistingInstall: true,
    blob: Object.assign({}, BLOB_1_23_1, { radarMode: 'graph', rainCountdownHorizon: '30' }),
    marked: THROUGH_1_23_1 },
  { name: 'legacy install, emery', platform: 'emery', hadExistingInstall: true, blob: LEGACY, marked: [] },
  { name: 'legacy install, basalt, no blob before this boot', platform: 'basalt',
    hadExistingInstall: false, blob: LEGACY, marked: [] },
  { name: 'legacy install on the new weekend colours', platform: 'basalt', hadExistingInstall: true,
    blob: Object.assign({}, LEGACY, {
      colorSunday: COLORS.folly, colorSaturday: COLORS.folly, colorUSFederal: COLORS.holiday }),
    marked: [] },
  { name: 'legacy install with only the holiday white', platform: 'basalt', hadExistingInstall: true,
    blob: Object.assign({}, LEGACY, {
      colorSunday: 0x00FF00, colorSaturday: COLORS.folly, colorUSFederal: COLORS.white }),
    marked: [] }
];

/**
 * Keys whose value the migrations changed, and keys they deleted.
 * @param {Object} pre Blob before the run.
 * @param {Object} post Blob after it.
 * @returns {{changed: Object, deleted: string[]}}
 */
function blobDiff(pre, post) {
  const changed = {};
  Object.keys(post).forEach((k) => {
    if (JSON.stringify(pre[k]) !== JSON.stringify(post[k])) { changed[k] = post[k]; }
  });
  return { changed, deleted: Object.keys(pre).filter((k) => !(k in post)).sort() };
}

/**
 * One boot of a scenario, in the real order: blob stored, seedDefaults, the ledger,
 * then the Clay ACK.
 * @param {Object} store The fake localStorage's backing object (empty).
 * @param {Object} claySettings clay-settings bound to that store.
 * @param {Object} clayMigrations The runner under test, bound to the same.
 * @param {Object} scenario One of SCENARIOS.
 * @returns {Object} The golden record.
 */
function runScenario(store, claySettings, clayMigrations, scenario) {
  const markers = () => Object.keys(store).filter((k) => /_migration$/.test(k)).sort();
  if (scenario.blob) { store['clay-settings'] = JSON.stringify(scenario.blob); }
  scenario.marked.concat(AFTER_GOLDEN).forEach((k) => { store[k] = '1'; });
  claySettings.seedDefaults(COLORS);
  const pre = claySettings.read();
  const before = markers();
  const res = clayMigrations.runMigrations({ platform: scenario.platform, colors: COLORS,
    defaultRadarProvider: 'rainbow', hadExistingInstall: scenario.hadExistingInstall });
  const afterRun = markers();
  res.commitDeferredMarkers();
  const afterAck = markers();
  return Object.assign({ name: scenario.name, clayRequired: res.clayRequired },
    blobDiff(pre, claySettings.read()), {
      markedNow: afterRun.filter((k) => before.indexOf(k) === -1),
      markedOnAck: afterAck.filter((k) => afterRun.indexOf(k) === -1)
    });
}

module.exports = { SCENARIOS, runScenario, BLOB_1_23_1, THROUGH_1_23_1, AFTER_GOLDEN };

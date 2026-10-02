// test/config-radar-rainbow-options.test.js — the Radar tab's picker offers Rainbow twice, one
// option per radar source: "Rainbow (limited)" ('rainbow', the shared proxy) and "Rainbow (own
// key)" ('rainbowkey', the user's own key). The blob stores the pick as radarProvider, the own
// key included; the 1.23.x pair ('rainbow' plus rainbowOwnKey) is the boot migration's to fold
// in (migrations/radar.js, test/clay-migrations.test.js), so the page reads and saves
// radarProvider as it stands. Pinned here against the REAL generated page for a fresh install,
// an install on either Rainbow, a 1.23.2 install booted through the migrations, and for the
// setup wizard's country pick.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const schema = require('../src/pkjs/settings/schema.js');
const OB = require('../src/pkjs/settings/onbuild.js');
const W = require('../src/pkjs/settings/wizard.js');
const { bootGeneratedPage } = require('./helpers/page-harness');
const { loadLedger, COLORS } = require('./helpers/clay-harness.js');
const REGISTRY = require('../src/pkjs/migrations/registry.js');
const KEYS = require('../src/pkjs/storage-keys');

const LIMITED = 'Rainbow (limited)';
const OWN = 'Rainbow (own key)';

/**
 * The open radar picker's option rows, keyed by value.
 * @param {Object} S Settings state (the page's, picker value folded).
 * @returns {Object} value -> the option button's inner HTML.
 */
function openPickerRows(S) {
  const env = { color: true, radar: true, platform: 'basalt' };
  const state = Object.assign({ radarMode: 'graph', radarProvider: 'rainbow' }, S);
  const html = E.renderSelectModal(schema, {
    S: state, ENV: env, openSelect: 'radarProvider', selectQuery: '',
    evalCtx: Object.assign({}, state, { env })
  });
  const rows = {};
  const re = /<button[^>]*data-select-pick="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) { rows[m[1]] = m[2]; }
  return rows;
}

/**
 * The radar picker trigger's shown label and aria-label in the page markup.
 * @param {string} html #scroll markup.
 * @returns {{label: string, aria: string}} What the collapsed trigger says.
 */
function trigger(html) {
  const m = /data-select="radarProvider" aria-label="([^"]*)"[^>]*><span>([^<]*)<\/span>/.exec(html);
  assert.ok(m, 'the radar picker trigger is rendered');
  return { aria: m[1], label: m[2] };
}

/**
 * A stored blob booted on the Radar tab.
 * @param {Object} stored The stored settings.
 * @param {string} [platform] The watch.
 * @returns {Object} The page (page-harness).
 */
function radarPage(stored, platform) {
  const page = bootGeneratedPage(Object.assign({ provider: 'openmeteo', radarMode: 'graph' }, stored), platform);
  page.clickTab('radar');
  return page;
}

// --- the option list -----------------------------------------------------------------------

test('the sheet lists both Rainbow options, each with its own desc', () => {
  const rows = openPickerRows({ holidayCountry: 'DE' });
  assert.deepEqual(Object.keys(rows), ['dwd', 'metno', 'rainbow', 'rainbowkey', 'tomorrowio']);
  assert.match(rows.rainbow, /ssel-opt-name">Rainbow \(limited\)<\/span><span class="ssel-opt-desc">Worldwide satellite \+ radar nowcast · no key, every 30 min</);
  assert.match(rows.rainbowkey, /ssel-opt-name">Rainbow \(own key\)<\/span><span class="ssel-opt-desc">Worldwide satellite \+ radar nowcast · needs a free key</);
});

test('recommended marker: a country\'s Rainbow pick is "Rainbow (limited)", the marker on its desc line', () => {
  const rows = openPickerRows({ holidayCountry: 'US' });
  assert.match(rows.rainbow, /<span class="ssel-opt-name">Rainbow \(limited\)<\/span>/, 'no "(Recommended)" after "(limited)"');
  assert.match(rows.rainbow,
    /<span class="ssel-opt-desc"><b class="ssel-rec">Recommended<\/b> · Worldwide satellite \+ radar nowcast · no key, every 30 min<\/span>/);
  Object.keys(rows).filter((v) => v !== 'rainbow').forEach((v) => {
    assert.doesNotMatch(rows[v], /ssel-rec/, v + ' carries no marker');
  });
  const de = openPickerRows({ holidayCountry: 'DE' });
  assert.match(de.dwd, /<span class="ssel-opt-name">DWD <b class="ssel-rec">\(Recommended\)<\/b><\/span>/);
  ['rainbow', 'rainbowkey'].forEach((v) => assert.doesNotMatch(de[v], /ssel-rec/, v));
});

// --- the page: what it opens on ------------------------------------------------------------

test('a fresh install opens on "Rainbow (limited)": no Edit button, no key rows', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo' });
  page.clickTab('radar');
  const tab = page.scroll.innerHTML;
  assert.deepEqual(trigger(tab), { label: LIMITED, aria: 'Radar provider: ' + LIMITED });
  assert.equal(page.S.radarProvider, 'rainbow');
  assert.ok(!('rainbowOwnKey' in page.S), 'no switch behind the picker');
  assert.doesNotMatch(tab, /data-edit-sheet="radarKeyRainbow"/);
  assert.doesNotMatch(tab, /Needs an API key/);
  assert.doesNotMatch(tab, /Use your own key/, 'the switch is gone as a control');
  assert.doesNotMatch(tab, /data-k="rainbowApiKey"|data-k="rainbowOwnKey"|calls\/month/);
});

test('an install on the own key opens on "Rainbow (own key)"', () => {
  const page = radarPage({ radarProvider: 'rainbowkey', rainbowApiKey: 'saved-key-wxyz' });
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  assert.equal(page.S.radarProvider, 'rainbowkey');
  assert.match(page.scroll.innerHTML, /class="thr-btn" data-edit-sheet="radarKeyRainbow"[^>]*><span>Edit<\/span>/);
});

test('the shared radar with a key kept from earlier stays "Rainbow (limited)": a key alone switches nothing', () => {
  const page = radarPage({ radarProvider: 'rainbow', rainbowApiKey: 'kept' });
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED);
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="radarKeyRainbow"/);
});

// --- Save stores the pick -----------------------------------------------------------------

test('Save: every pick stores itself as radarProvider, with no switch beside it', async () => {
  const cases = [
    // [stored, pick (or null), expected radarProvider, label]
    [{}, null, 'rainbow', 'fresh install, untouched'],
    [{ radarProvider: 'rainbowkey', rainbowApiKey: 'k' }, null, 'rainbowkey', 'own key, untouched'],
    [{ radarProvider: 'rainbow' }, null, 'rainbow', 'limited, untouched'],
    [{ radarProvider: 'rainbow', rainbowApiKey: 'k' }, 'rainbowkey', 'rainbowkey', 'limited -> own key'],
    [{ radarProvider: 'rainbowkey', rainbowApiKey: 'k' }, 'rainbow', 'rainbow', 'own key -> limited'],
    [{ radarProvider: 'rainbowkey', rainbowApiKey: 'k' }, 'dwd', 'dwd', 'own key -> DWD'],
    [{ radarProvider: 'dwd' }, 'rainbow', 'rainbow', 'DWD -> limited'],
    [{ radarProvider: 'tomorrowio', tomorrowioApiKey: 't' }, 'rainbowkey', 'rainbowkey', 'Tomorrow.io -> own key']
  ];
  for (const [stored, pick, provider, label] of cases) {
    const page = radarPage(stored);
    if (pick) {
      page.openSelect('radarProvider');
      page.pickOption('radarProvider', pick);
      assert.equal(page.S.radarProvider, pick, label + ': the pick');
    }
    const saved = await page.save();
    assert.equal(saved.radarProvider, provider, label + ': radarProvider');
    assert.ok(!('rainbowOwnKey' in saved), label + ': no rainbowOwnKey');
  }
});

test('Save keeps the key of either Rainbow option', async () => {
  const page = radarPage({ radarProvider: 'rainbowkey', rainbowApiKey: 'keep-me' });
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  const saved = await page.save();
  assert.equal(saved.rainbowApiKey, 'keep-me', 'limited keeps the key for a later switch back');
});

test('aplite (no Radar tab, radar forced off) keeps a stored own key through a Save', async () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarProvider: 'rainbowkey',
    rainbowApiKey: 'k' }, 'aplite');
  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbowkey');
  assert.ok(!('rainbowOwnKey' in saved));
});

// --- the hooks hold no radar dialect -----------------------------------------------------------

/**
 * An onLoad/onSubmit context over a plain store.
 * @param {Object} store The settings.
 * @returns {{ctx: Object, store: Object}} The context and its store.
 */
function hookCtx(store) {
  return {
    store,
    ctx: { env: { platform: 'basalt' }, get: (k) => store[k], set: (k, v) => { store[k] = v; }, getInitial: (k) => store[k] }
  };
}

test('onLoad and onSubmit pass radarProvider through as stored and write no rainbowOwnKey', () => {
  ['rainbow', 'rainbowkey', 'dwd', 'tomorrowio'].forEach((radarProvider) => {
    const h = hookCtx({ radarProvider: radarProvider, radarMode: 'graph', fetchIntervalMin: '15' });
    OB.onLoad(h.ctx);
    assert.equal(h.store.radarProvider, radarProvider, radarProvider + ': open');
    OB.onSubmit(h.ctx);
    assert.equal(h.store.radarProvider, radarProvider, radarProvider + ': Save');
    assert.ok(!('rainbowOwnKey' in h.store), radarProvider + ': no switch written');
  });
});

// --- the upgrade, end to end ---------------------------------------------------------------

/**
 * A stored blob booted through the whole migration ledger with `marked` set, then the
 * page opened on the result, on the Radar tab.
 * @param {Object} stored The blob the install holds.
 * @param {string[]} marked Markers the install holds.
 * @returns {Object} The page (page-harness).
 */
function upgradedRadarPage(stored, marked) {
  const L = loadLedger(stored);
  marked.forEach((k) => { L.store[k] = '1'; });
  L.claySettings.seedDefaults(COLORS);
  L.run(null, { hadExistingInstall: true });
  const page = bootGeneratedPage(L.read());
  page.clickTab('radar');
  return page;
}

test('upgrade: a 1.23.2 install on its own key opens on "Rainbow (own key)" and saves it as itself', async () => {
  const at = REGISTRY.findIndex((e) => e.key === KEYS.ALERT_LEVELS_MIGRATION_KEY);
  const through123 = REGISTRY.slice(0, at).map((e) => e.key);
  const page = upgradedRadarPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'rainbow',
    rainbowOwnKey: true, rainbowApiKey: 'saved-key-wxyz', onboardingDone: true }, through123);
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbowkey');
  assert.ok(!('rainbowOwnKey' in saved));
  const limited = upgradedRadarPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'rainbow',
    rainbowOwnKey: false, onboardingDone: true }, through123);
  assert.equal(trigger(limited.scroll.innerHTML).label, LIMITED);
});

test('upgrade: the dev phone, every other marker set, opens on the Rainbow its pair ran', () => {
  const others = REGISTRY.map((e) => e.key).filter((k) => k !== KEYS.RAINBOW_OWN_KEY_SOURCE_MIGRATION_KEY);
  const page = upgradedRadarPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'rainbow',
    rainbowOwnKey: true, rainbowApiKey: 'saved-key-wxyz', onboardingDone: true }, others);
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  assert.equal(page.S.radarProvider, 'rainbowkey');
});

// --- the setup wizard -------------------------------------------------------------------------

test('the wizard\'s country pick keeps "Rainbow (own key)" where the country\'s pick is Rainbow', () => {
  const own = { holidayCountry: 'US', radarProvider: 'rainbowkey', provider: 'openmeteo' };
  W.applyDerived(own);
  assert.equal(own.radarProvider, 'rainbowkey', 'the own key stays, as it did as a switch');
  const de = { holidayCountry: 'DE', radarProvider: 'rainbowkey', provider: 'openmeteo' };
  W.applyDerived(de);
  assert.equal(de.radarProvider, 'dwd', 'Germany\'s pick is DWD');
  const fresh = { holidayCountry: 'US', radarProvider: 'dwd', provider: 'dwd' };
  W.applyDerived(fresh);
  assert.equal(fresh.radarProvider, 'rainbow', 'everyone else starts on "Rainbow (limited)"');
});

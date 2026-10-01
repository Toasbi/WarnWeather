// test/config-radar-rainbow-options.test.js — the Radar tab's picker offers Rainbow twice, one
// option per radar source: "Rainbow (limited)" ('rainbow', the shared proxy) and "Rainbow (own
// key)" ('rainbowkey', the user's own key). The blob keeps the shape every release since 1.23.1
// reads — radarProvider 'rainbow' plus rainbowOwnKey — so no new stored value and no migration:
// settings/onbuild.js folds the pair into the picker on open and writes it back on Save. Pinned
// here against the REAL generated page for a fresh install, a 1.23.2 blob (the switch era) and a
// dev phone that ran every 1.24.0 migration (whose blob holds the same pair), and for the setup
// wizard's country pick.
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
  assert.equal(page.S.rainbowOwnKey, false);
  assert.doesNotMatch(tab, /data-edit-sheet="radarKeyRainbow"/);
  assert.doesNotMatch(tab, /Needs an API key/);
  assert.doesNotMatch(tab, /Use your own key/, 'the switch is gone as a control');
  assert.doesNotMatch(tab, /data-k="rainbowApiKey"|data-k="rainbowOwnKey"|calls\/month/);
});

test('a 1.23.2 (or dev-phone) blob on the own key opens on "Rainbow (own key)"', () => {
  const page = radarPage({ radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'saved-key-wxyz' });
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  assert.equal(page.S.radarProvider, 'rainbowkey', 'the page holds the source');
  assert.equal(page.S.rainbowOwnKey, false, 'and reads the switch\'s key as false while open');
  assert.match(page.scroll.innerHTML, /class="thr-btn" data-edit-sheet="radarKeyRainbow"[^>]*><span>Edit<\/span>/);
});

test('the shared radar with a key kept from earlier stays "Rainbow (limited)": a key alone switches nothing', () => {
  const page = radarPage({ radarProvider: 'rainbow', rainbowOwnKey: false, rainbowApiKey: 'kept' });
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED);
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="radarKeyRainbow"/);
});

test('a non-Rainbow radar with the old switch left on opens on that radar', () => {
  const page = radarPage({ radarProvider: 'dwd', rainbowOwnKey: true, rainbowApiKey: 'kept' });
  assert.equal(trigger(page.scroll.innerHTML).label, 'DWD');
  assert.equal(page.S.radarProvider, 'dwd');
});

// --- Save writes the stored pair --------------------------------------------------------------

test('Save: every pick stores the pair the runtime has always read', async () => {
  const cases = [
    // [stored, pick (or null), expected radarProvider, expected rainbowOwnKey, label]
    [{}, null, 'rainbow', false, 'fresh install, untouched'],
    [{ radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'k' }, null, 'rainbow', true, 'own key, untouched'],
    [{ radarProvider: 'rainbow', rainbowOwnKey: false }, null, 'rainbow', false, 'limited, untouched'],
    [{ radarProvider: 'rainbow', rainbowOwnKey: false, rainbowApiKey: 'k' }, 'rainbowkey', 'rainbow', true, 'limited -> own key'],
    [{ radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'k' }, 'rainbow', 'rainbow', false, 'own key -> limited'],
    [{ radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'k' }, 'dwd', 'dwd', false, 'own key -> DWD'],
    [{ radarProvider: 'dwd', rainbowOwnKey: true }, null, 'dwd', false, 'DWD with the old switch left on'],
    [{ radarProvider: 'dwd', rainbowOwnKey: true }, 'rainbow', 'rainbow', false, 'that DWD -> limited stays limited'],
    [{ radarProvider: 'tomorrowio', tomorrowioApiKey: 't' }, 'rainbowkey', 'rainbow', true, 'Tomorrow.io -> own key']
  ];
  for (const [stored, pick, provider, ownKey, label] of cases) {
    const page = radarPage(stored);
    if (pick) {
      page.openSelect('radarProvider');
      page.pickOption('radarProvider', pick);
      assert.equal(page.S.radarProvider, pick, label + ': the pick');
    }
    const saved = await page.save();
    assert.equal(saved.radarProvider, provider, label + ': radarProvider');
    assert.equal(saved.rainbowOwnKey, ownKey, label + ': rainbowOwnKey');
  }
});

test('Save keeps the key of either Rainbow option', async () => {
  const page = radarPage({ radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'keep-me' });
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  const saved = await page.save();
  assert.equal(saved.rainbowApiKey, 'keep-me', 'limited keeps the key for a later switch back');
});

test('aplite (no Radar tab, radar forced off) keeps a stored own key through a Save', async () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarProvider: 'rainbow', rainbowOwnKey: true,
    rainbowApiKey: 'k' }, 'aplite');
  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbow');
  assert.equal(saved.rainbowOwnKey, true);
});

// --- the hooks on their own -------------------------------------------------------------------

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

test('onLoad folds the pair into the picker; onSubmit unfolds it, from either shape', () => {
  const own = hookCtx({ radarProvider: 'rainbow', rainbowOwnKey: true });
  OB.onLoad(own.ctx);
  assert.equal(own.store.radarProvider, 'rainbowkey');
  assert.equal(own.store.rainbowOwnKey, false);
  OB.onSubmit(own.ctx);
  assert.equal(own.store.radarProvider, 'rainbow');
  assert.equal(own.store.rainbowOwnKey, true);

  const truthy = hookCtx({ radarProvider: 'rainbow', rainbowOwnKey: 'true' });
  OB.onLoad(truthy.ctx);
  assert.equal(truthy.store.radarProvider, 'rainbow', 'only a real true is the own key, as at runtime');

  // A context that never folded (a stored blob handed straight to the submit hook).
  const raw = hookCtx({ radarProvider: 'rainbow', rainbowOwnKey: true });
  OB.onSubmit(raw.ctx);
  assert.equal(raw.store.radarProvider, 'rainbow');
  assert.equal(raw.store.rainbowOwnKey, true, 'keeps its meaning');
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

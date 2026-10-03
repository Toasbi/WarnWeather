// test/config-radar-key-status.test.js — "Rainbow (own key)" on the Radar provider row has the
// key status a keyed weather provider has (settings/key-status.js, key-sources.js): the Edit / "Add
// key" button beside the dropdown, the summary line ("Key ••••1234 · ✓ works · ~2,976 of 5,000
// calls a month"), the amber note while the key is missing, the dot on the Radar tab and the Save
// dialog while it is missing or known to be rejected. Its key never rides a weather update, so
// the evidence is the Test button's answer and the radar's last answer to the key
// (userData.keyResults under 'rainbowkey', key-result.js). Module first, then the REAL
// generated page (page-harness). Radar-only Tomorrow.io gets the same, its key shared with the
// Tomorrow.io weather provider (the section at the end).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const keyStatus = require('../src/pkjs/settings/key-status.js');
const { fingerprint } = require('../src/pkjs/key-fingerprint.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const radarTab = schema.tabs.find((t) => t.id === 'radar');
const radarRow = radarTab.sections[0].items.find((i) => i.messageKey === 'radarProvider');
// The keyed sources of both pickers (key-sources.js): the Radar row's resolvers read the
// radarProvider table by the row's messageKey, the Weather provider row's the provider one.
const KEY_SOURCES = require('../src/pkjs/settings/key-sources.js');
const SOURCE = KEY_SOURCES.radarProvider.sources.rainbowkey;
const RBW_KEY = 'rbw-secret-0123wxyz';
// Settings with the radar on "Rainbow (own key)".
const OWN = { radarProvider: 'rainbowkey', radarMode: 'graph', fetchIntervalMin: '15', sleepNightEnabled: false };
// The same, as the phone stores it.
const STORED_OWN = Object.assign({ provider: 'openmeteo' }, OWN);

/**
 * The phone's answers as it stores them (key-result.js) with one source's answer to a key.
 * @param {string} key The key the request carried.
 * @param {number} status The status that answered it.
 * @param {string} [id] The source ('rainbowkey' unless named).
 * @returns {string} The stored JSON (userData.keyResults).
 */
function radarRecord(key, status, id) {
  const map = {};
  map[id || 'rainbowkey'] = { keyHash: fingerprint(key), status };
  return JSON.stringify(map);
}

/**
 * The state of the own key under the live settings and userData.
 * @param {Object} S Settings (the page's shape).
 * @returns {Object} statusOf's answer.
 */
function stateOf(S) {
  return keyStatus.statusOf(SOURCE, 'rainbowkey', S);
}

/**
 * The tab bar button for a tab, as rendered.
 * @param {Object} page The booted page.
 * @param {string} id The tab id.
 * @returns {string} Its markup.
 */
function tabButton(page, id) {
  const m = new RegExp('<button[^>]*data-tab="' + id + '"[^>]*>[\\s\\S]*?</button>').exec(page.tabs.innerHTML);
  assert.ok(m, id + ' tab rendered');
  return m[0];
}

/**
 * Tap an element inside #modal (a dialog button, the close button).
 * @param {Object} page The booted page.
 * @param {string} sel The selector the engine's handler asks closest() for.
 * @param {string} [attr] The attribute it reads.
 * @param {string} [value] Its value.
 * @returns {void}
 */
function tapInModal(page, sel, attr, value) {
  const t = { getAttribute: (n) => (n === attr ? value : null), closest: (s) => (s === sel ? t : null) };
  page.modal.dispatch('click', { target: t });
}

test.beforeEach(() => {
  keyStatus.resetTests();
  delete global.INJECTED_USERDATA;
});
test.after(() => { delete global.INJECTED_USERDATA; });

// --- the module ----------------------------------------------------------------------------

test('missing, then untested: a key the page knows nothing about', () => {
  assert.deepEqual(stateOf(Object.assign({ rainbowApiKey: '  ' }, OWN)), { state: 'missing' });
  assert.deepEqual(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)), { state: 'untested', tail: 'wxyz' });
});

test('the radar\'s last answer to THIS key counts: 2xx and 429 work, 401/403 are refused', () => {
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  const at = (record) => { global.INJECTED_USERDATA = { keyResults: record }; return stateOf(S); };
  assert.deepEqual(at(radarRecord(RBW_KEY, 200)), { state: 'ok', tail: 'wxyz' });
  assert.deepEqual(at(radarRecord(RBW_KEY, 429)), { state: 'ok', tail: 'wxyz' }, 'known, over its allowance');
  assert.deepEqual(at(radarRecord(RBW_KEY, 401)), { state: 'rejected', tail: 'wxyz', status: 401 });
  assert.deepEqual(at(radarRecord(RBW_KEY, 403)), { state: 'rejected', tail: 'wxyz', status: 403 });
  assert.equal(at(radarRecord('another-key', 401)).state, 'untested', 'another key\'s verdict');
  assert.equal(at(radarRecord(RBW_KEY, 401, 'tomorrowio')).state, 'untested', 'another source\'s verdict');
  assert.equal(at(radarRecord(RBW_KEY, 500)).state, 'untested', 'a status that says nothing about the key');
  assert.equal(at('not json').state, 'untested', 'an unreadable record');
  assert.equal(at(null).state, 'untested', 'no record');
});

test('only the own key\'s source speaks for it: no other source\'s answer, and no update record', () => {
  const hash = fingerprint(RBW_KEY);
  global.INJECTED_USERDATA = {
    keyResults: JSON.stringify({ rainbow: { keyHash: hash, status: 401 }, openweathermap: { keyHash: hash, status: 401 } }),
    authBackoff: JSON.stringify({ code: 'status_401', since: 1, provider: 'rainbowkey', keyHash: hash }),
    lastFetchSuccess: JSON.stringify({ id: 'rainbowkey', keyHash: hash })
  };
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'untested');
});

test('a Test answer this page open wins over the phone\'s answer, for the key it tested', () => {
  global.INJECTED_USERDATA = { keyResults: radarRecord(RBW_KEY, 401) };
  keyStatus.recordTest('rainbowApiKey', RBW_KEY, 200);
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'ok');
  assert.equal(stateOf(Object.assign({ rainbowApiKey: 'edited-key' }, OWN)).state, 'untested', 'a key edited since');
  keyStatus.recordTest('rainbowApiKey', RBW_KEY, -1);
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'ok',
    'the proxy\'s "couldn\'t check" keeps the last verdict');
});

test('the summary adds the month\'s calls the settings come to, unless the key is refused', () => {
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · not tested yet · ~2,976 of 5,000 calls a month');
  global.INJECTED_USERDATA = { keyResults: radarRecord(RBW_KEY, 200) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month');
  global.INJECTED_USERDATA = { keyResults: radarRecord(RBW_KEY, 401) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✗ rejected: invalid key (401)');
});

test('the Radar row\'s hint: its own "why" copy for the value, the summary line under it', () => {
  // Through the engine, as the page resolves it: the row's resolvers carry no args, so the
  // copy is the engine's staticHint (the row's hintByValue) and the table is found by the
  // row's messageKey.
  const resolveHint = global.PConf.engine.resolveHint;
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  assert.equal(resolveHint(radarRow, S, {}, 'rainbowkey'),
    radarRow.hintByValue.rainbowkey + '<br>Key ••••wxyz · not tested yet · ~2,976 of 5,000 calls a month');
  assert.equal(resolveHint(radarRow, Object.assign({}, OWN, { radarProvider: 'rainbow' }), {}, 'rainbow'), undefined,
    'the shared Rainbow: no key, the static hintByValue answers');
});

test('the resolvers answer for "Rainbow (own key)" and Tomorrow.io only', () => {
  // The args the engine hands a row resolver: the row's messageKey and value (the row has none
  // of its own).
  const args = (value) => ({ messageKey: 'radarProvider', value });
  ['dwd', 'metno', 'rainbow'].forEach((v) => {
    const S = Object.assign({}, OWN, { radarProvider: v });
    assert.equal(keyStatus.keySheet(S, {}, args(v)), null, v + ': no Edit button');
    assert.equal(keyStatus.keyMissingNote(S, {}, args(v)), '', v + ': no note');
    assert.equal(keyStatus.keyAttention(S, {}, args(v)), null, v + ': no dot, no dialog');
  });
  const S = Object.assign({ rainbowApiKey: '' }, OWN);
  assert.equal(keyStatus.keySheet(S, {}, args('rainbowkey')), 'radarKeyRainbow');
  assert.deepEqual(keyStatus.keyBadge(S, {}, args('rainbowkey')), { label: 'Add key', ariaNote: 'no API key', dots: [] });
  assert.equal(keyStatus.keyMissingNote(S, {}, args('rainbowkey')), 'Needs an API key. Without one, the watch gets no rain radar.');
  assert.deepEqual(keyStatus.keyAttention(S, {}, args('rainbowkey')), { note: 'Rainbow has no API key',
    title: 'Rainbow has no API key', body: 'Without one, the watch gets no rain radar.', actionLabel: 'Add key',
    sheet: 'radarKeyRainbow' });
});

// --- the real page ----------------------------------------------------------------------------

test('page: "Rainbow (own key)" without a key — "Add key", the amber note, a dot on the Radar tab', () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.clickTab('radar');
  const body = page.scroll.innerHTML;
  assert.match(body, /<button type="button" class="thr-btn" data-edit-sheet="radarKeyRainbow"[^>]*><span>Add key<\/span>/);
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no rain radar\.<\/div><\/div>/);
  assert.match(tabButton(page, 'radar'), /aria-label="Radar \(Rainbow has no API key\)">Radar<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'general', 'forecast', 'alerts', 'watch', 'layout', 'more'].forEach((id) =>
    assert.doesNotMatch(tabButton(page, id), /tab-dot/, id));
});

test('page: picking the own key with no key brings the note and the dot at once; limited takes them away', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph' }, 'basalt');
  page.clickTab('radar');
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbowkey');
  assert.match(page.scroll.innerHTML, /Needs an API key\. Without one, the watch gets no rain radar\./);
  assert.match(tabButton(page, 'radar'), /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: Save with no key opens the dialog; "Add key" opens the key sheet on the Radar tab and saves nothing', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  const dlg = page.modal.innerHTML;
  assert.ok(page.modal.open, 'the native dialog opened');
  assert.ok(dlg.indexOf('id="cfm-ttl">Rainbow has no API key</span>') !== -1, dlg);
  assert.ok(dlg.indexOf('<p class="cfm-body">Without one, the watch gets no rain radar.</p>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action">Add key</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="save">Save anyway</button>') !== -1);
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('data-k="rainbowApiKey"') !== -1, 'the Rainbow key sheet is open');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-radarKeyRainbow">Rainbow<') !== -1, 'titled Rainbow');
  assert.match(tabButton(page, 'radar'), /class="tab on"/, 'over the Radar tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: a key typed into the sheet is untested, needs no dialog and saves as the own key', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.clickTab('radar');
  page.openEditSheet('radarKeyRainbow');
  const inp = { value: RBW_KEY, getAttribute: (n) => (n === 'data-k' ? 'rainbowApiKey' : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
  tapInModal(page, '[data-select-close]');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · not tested yet · ~2,976 of 5,000 calls a month') !== -1);
  assert.match(page.scroll.innerHTML, /class="thr-btn" data-edit-sheet="radarKeyRainbow"[^>]*><span>Edit<\/span>/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbowkey');
  assert.equal(blob.rainbowApiKey, RBW_KEY);
});

test('page: "Save anyway" saves the own key without a key, as before', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbowkey');
  assert.equal(blob.rainbowApiKey, '');
});

test('page: a key the radar was last refused with — the summary, the dot and the "rejected" dialog', () => {
  const userData = { keyResults: radarRecord(RBW_KEY, 403) };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData, dialog: true });
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('<br>Key ••••wxyz · ✗ rejected: no access (403)</div>') !== -1);
  assert.match(page.scroll.innerHTML, /data-edit-sheet="radarKeyRainbow"[^>]*\(API key rejected\)[^>]*><span>Edit<\/span>/);
  assert.match(tabButton(page, 'radar'), /Radar \(Rainbow rejected the API key\)/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Rainbow rejected the API key') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('Until it accepts a key, the watch gets no rain radar.') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="action">Edit key</button>') !== -1);
});

test('page: a key the radar last went through with reads "✓ works" and saves without a dialog', async () => {
  const userData = { keyResults: radarRecord(RBW_KEY, 200) };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData, dialog: true });
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month') !== -1);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '', 'no dialog');
  assert.equal((await page.saved()).radarProvider, 'rainbowkey');
});

test('page: the Test button\'s answer (through the proxy\'s envelope) reaches the summary', () => {
  const userData = { rainbowEndpoint: 'https://proxy.example/rainbow' };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData });
  page.clickTab('radar');
  const xhrs = [];
  page.window.XMLHttpRequest = function () {
    this.open = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  const field = { value: RBW_KEY };
  const result = { textContent: '' };
  page.window.document.querySelector = (sel) => (sel === 'input[data-k="rainbowApiKey"]' ? field
    : sel === '[data-action-result="rainbowApiKey"]' ? result : null);
  page.openEditSheet('radarKeyRainbow');
  tapInModal(page, '[data-action]', 'data-action', 'testRainbowKey');
  assert.equal(xhrs.length, 1, 'the Test request went out');
  xhrs[0].status = 200;
  xhrs[0].responseText = '{"status":401}';
  xhrs[0].onload();
  assert.match(result.textContent, /Rejected \(401\)/, 'the verdict line as before');
  tapInModal(page, '[data-select-close]');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · ✗ rejected: invalid key (401)') !== -1);
  assert.match(tabButton(page, 'radar'), /tab-dot/);
});

test('page: radar off — no note, no dot, no dialog, whatever the own key\'s state', async () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_OWN, { radarMode: 'off' }), 'basalt', { dialog: true });
  page.clickTab('radar');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|data-edit-sheet="radarKeyRainbow"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbowkey', 'the pick itself is kept');
});

test('page: a missing weather key and a missing radar key dot both tabs; the dialog asks for the first', () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_OWN, { provider: 'openweathermap', owmApiKey: '' }),
    'basalt', { dialog: true });
  assert.match(tabButton(page, 'general'), /tab-dot/);
  assert.match(tabButton(page, 'radar'), /tab-dot/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('OpenWeatherMap has no API key') !== -1, 'General comes first');
});

test('page: aplite has no Radar tab — no dot and no dialog for a stored own key without a key', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'aplite', { dialog: true });
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).radarProvider, 'rainbowkey');
});

// --- Tomorrow.io on the radar picker ----------------------------------------------------------
// Radar-only, its key lives in the Radar tab's own Tomorrow.io sheet (radarKeyTomorrowio) and
// gets everything "Rainbow (own key)" has. Its key is the Tomorrow.io weather provider's key:
// one key, one verdict. While Tomorrow.io is the weather provider too, the General tab's
// Tomorrow.io sheet (providerKeyTomorrowio) is the one copy of the key, and the Radar row's
// Edit, summary, note, dot and Save dialog all read that key's one state.

const TIO = KEY_SOURCES.radarProvider.sources.tomorrowio;
const WEATHER_TIO = KEY_SOURCES.provider.sources.tomorrowio;
const TIO_KEY = 'tio-secret-0123wxyz';
// A running radar on Tomorrow.io, the weather on DWD (radar-only) or on Tomorrow.io too (both).
const TIO_RADAR_ONLY = { provider: 'dwd', radarProvider: 'tomorrowio', radarMode: 'graph', fetchIntervalMin: '15',
  sleepNightEnabled: false, tomorrowioFitBudget: true };
const TIO_BOTH = Object.assign({}, TIO_RADAR_ONLY, { provider: 'tomorrowio' });

/**
 * Type a key into the open sheet's tomorrow.io field and commit it, the way a browser reports it.
 * @param {Object} page The booted page.
 * @param {string} value The typed text.
 * @returns {void}
 */
function typeTioKey(page, value) {
  assert.ok(page.modal.innerHTML.indexOf('data-k="tomorrowioApiKey"') !== -1, 'the key field is in the open sheet');
  const inp = { value, getAttribute: (n) => (n === 'data-k' ? 'tomorrowioApiKey' : null),
    closest: (sel) => (sel === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
}

test('Tomorrow.io: radar-only its own sheet; while it is the weather provider too, the General tab\'s', () => {
  const args = { messageKey: 'radarProvider', value: 'tomorrowio' };
  const noKey = Object.assign({ tomorrowioApiKey: '' }, TIO_RADAR_ONLY);
  const noKeyBoth = Object.assign({}, noKey, { provider: 'tomorrowio' });
  assert.equal(keyStatus.keySheet(noKey, {}, args), 'radarKeyTomorrowio');
  assert.equal(keyStatus.keySheet(noKeyBoth, {}, args), 'providerKeyTomorrowio');
  assert.equal(keyStatus.sheetOf(TIO, { provider: 'openmeteo' }), 'radarKeyTomorrowio');
  assert.equal(keyStatus.sheetOf(SOURCE, { provider: 'tomorrowio' }), 'radarKeyRainbow', 'Rainbow shares nothing');
  assert.deepEqual(keyStatus.keyBadge(noKey, {}, args), { label: 'Add key', ariaNote: 'no API key', dots: [] });
  assert.equal(keyStatus.keyMissingNote(noKey, {}, args), 'Needs an API key. Without one, the watch gets no rain radar.');
  assert.deepEqual(keyStatus.keyAttention(noKey, {}, args), { note: 'Tomorrow.io has no API key',
    title: 'Tomorrow.io has no API key', body: 'Without one, the watch gets no rain radar.', actionLabel: 'Add key',
    sheet: 'radarKeyTomorrowio' });
  assert.equal(keyStatus.keyAttention(noKeyBoth, {}, args).sheet, 'providerKeyTomorrowio',
    'both: the dialog\'s Add key opens the sheet that holds the key');
});

test('Tomorrow.io: one key, one verdict — the radar row reads exactly the weather provider\'s state', () => {
  const S = Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_BOTH);
  const cases = [
    ['missing', Object.assign({}, S, { tomorrowioApiKey: '  ' }), null, null, 'missing'],
    ['untested', S, null, null, 'untested'],
    ['its last answer served it', S, { keyResults: radarRecord(TIO_KEY, 200, 'tomorrowio') }, null, 'ok'],
    ['its last answer refused it', S, { keyResults: radarRecord(TIO_KEY, 401, 'tomorrowio') }, null, 'rejected'],
    ['another provider\'s answer to the same key', S, { keyResults: radarRecord(TIO_KEY, 200, 'openweathermap') },
      null, 'untested'],
    ['Test: works', S, null, 200, 'ok'],
    ['Test: refused', S, null, 403, 'rejected']
  ];
  cases.forEach(([what, state, userData, tested, expected]) => {
    keyStatus.resetTests();
    if (userData) { global.INJECTED_USERDATA = userData; } else { delete global.INJECTED_USERDATA; }
    if (tested) { keyStatus.recordTest('tomorrowioApiKey', TIO_KEY, tested); }
    // Both, and radar-only: the radar row's state is the weather provider's, word for word.
    [state, Object.assign({}, state, { provider: 'dwd' })].forEach((st) => {
      const radar = keyStatus.statusOf(TIO, 'tomorrowio', st);
      assert.equal(radar.state, expected, what);
      assert.deepEqual(radar, keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', st), what);
      assert.equal(keyStatus.summaryLine(TIO, radar, st), keyStatus.summaryLine(WEATHER_TIO, radar, st), what);
    });
  });
});

// The owner's call (thermo-js-2 PHONE-3): the weather updates and the radar requests keep their
// answers to the Tomorrow.io key under the one id 'tomorrowio', so the newest answer either got is
// the key's verdict on BOTH rows. It used to be "the Weather provider row goes by weather updates
// only": a radar-only refusal left that row "not tested yet", and a weather success outranked a
// newer radar refusal on the Radar row. The phone side (which answer is the newest) is pinned in
// test/fetch-cycle.test.js.
test('Tomorrow.io: the radar\'s answer to the key is its verdict on the Weather provider row too', () => {
  const S = Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY);
  global.INJECTED_USERDATA = { keyResults: radarRecord(TIO_KEY, 401, 'tomorrowio') };
  assert.deepEqual(keyStatus.statusOf(TIO, 'tomorrowio', S), { state: 'rejected', tail: 'wxyz', status: 401 });
  assert.deepEqual(keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', S), { state: 'rejected', tail: 'wxyz', status: 401 },
    'the Weather provider row reads the same answer: the key was refused');
  global.INJECTED_USERDATA = { keyResults: radarRecord(TIO_KEY, 200, 'tomorrowio') };
  assert.deepEqual(keyStatus.statusOf(TIO, 'tomorrowio', S), { state: 'ok', tail: 'wxyz' });
  assert.deepEqual(keyStatus.statusOf(WEATHER_TIO, 'tomorrowio', S), { state: 'ok', tail: 'wxyz' });
  global.INJECTED_USERDATA = { keyResults: radarRecord(TIO_KEY, 401, 'rainbowkey') };
  assert.equal(keyStatus.statusOf(TIO, 'tomorrowio', S).state, 'untested', 'another radar source\'s answer');
  global.INJECTED_USERDATA = { keyResults: radarRecord('another-key', 401, 'tomorrowio') };
  assert.equal(keyStatus.statusOf(TIO, 'tomorrowio', S).state, 'untested', 'another key\'s answer');
});

test('page: radar-only Tomorrow.io refused by the radar — the summary, the dot and the "rejected" dialog', () => {
  const userData = { keyResults: radarRecord(TIO_KEY, 403, 'tomorrowio') };
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY), 'basalt',
    { userData, dialog: true });
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · ✗ rejected: no access to this data (403)') !== -1,
    'not "not tested yet"');
  assert.match(tabButton(page, 'radar'), /Radar \(Tomorrow\.io rejected the API key\)/);
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('Tomorrow.io rejected the API key') !== -1);
});

test('page: radar-only Tomorrow.io without a key — "Add key", the amber note, a dot on the Radar tab only', () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  assert.doesNotMatch(page.scroll.innerHTML, /data-edit-sheet="(providerKey|radarKey)|Needs an API key|Key ••••/,
    'nothing on the Weather provider row (DWD needs no key)');
  page.clickTab('radar');
  const body = page.scroll.innerHTML;
  assert.match(body, /<button type="button" class="thr-btn" data-edit-sheet="radarKeyTomorrowio"[^>]*><span>Add key<\/span>/);
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no rain radar\.<\/div><\/div>/);
  assert.equal(body.indexOf('data-k="tomorrowioApiKey"'), -1, 'the key field left the page for the sheet');
  assert.match(tabButton(page, 'radar'), /aria-label="Radar \(Tomorrow\.io has no API key\)">Radar<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'general', 'forecast', 'watch', 'layout', 'more'].forEach((id) =>
    assert.doesNotMatch(tabButton(page, id), /tab-dot/, id));
});

test('page: picking Tomorrow.io with no key brings the note and the dot at once; Met.no takes them away', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph' }, 'basalt');
  page.clickTab('radar');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'tomorrowio');
  assert.match(page.scroll.innerHTML, /data-edit-sheet="radarKeyTomorrowio"[^>]*><span>Add key<\/span>/);
  assert.match(page.scroll.innerHTML, /Needs an API key\. Without one, the watch gets no rain radar\./);
  assert.match(tabButton(page, 'radar'), /tab-dot/);
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'metno');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key|data-edit-sheet="radarKeyTomorrowio"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: radar-only Tomorrow.io — Save asks; "Add key" opens its sheet on the Radar tab and saves nothing', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.tapSave();
  const dlg = page.modal.innerHTML;
  assert.ok(page.modal.open, 'the native dialog opened');
  assert.ok(dlg.indexOf('id="cfm-ttl">Tomorrow.io has no API key</span>') !== -1, dlg);
  assert.ok(dlg.indexOf('<p class="cfm-body">Without one, the watch gets no rain radar.</p>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="action">Add key</button>') !== -1);
  assert.ok(dlg.indexOf('data-confirm="save">Save anyway</button>') !== -1);
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-radarKeyTomorrowio">Tomorrow.io<') !== -1, 'the Radar tab\'s sheet');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tomorrowioApiKey"') !== -1, 'with the key field');
  assert.match(tabButton(page, 'radar'), /class="tab on"/, 'over the Radar tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: radar-only Tomorrow.io — "Save anyway" saves without a key, as before', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'tomorrowio');
  assert.equal(blob.provider, 'dwd');
  assert.equal(blob.tomorrowioApiKey, '');
});

test('page: a key typed into the Radar tab\'s Tomorrow.io sheet is untested, needs no dialog and saves trimmed', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'basalt', { dialog: true });
  page.clickTab('radar');
  page.openEditSheet('radarKeyTomorrowio');
  typeTioKey(page, '  ' + TIO_KEY + ' ');
  tapInModal(page, '[data-select-close]');
  assert.ok(page.scroll.innerHTML.indexOf('<br>Key ••••wxyz · not tested yet · ~96 of 500 calls a day</div>') !== -1,
    'the summary under the why, with the daily calls the radar comes to');
  assert.match(page.scroll.innerHTML, /class="thr-btn" data-edit-sheet="radarKeyTomorrowio"[^>]*><span>Edit<\/span>/);
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  const blob = await page.saved();
  assert.equal(blob.tomorrowioApiKey, TIO_KEY, 'Save trims it as before (onbuild.js)');
  assert.equal(blob.radarProvider, 'tomorrowio');
});

test('page: the Test button in the Radar tab\'s Tomorrow.io sheet reaches the summary and the dot', () => {
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_RADAR_ONLY), 'basalt');
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · not tested yet') !== -1);
  const xhrs = [];
  page.window.XMLHttpRequest = function () {
    this.open = () => {};
    this.send = () => {};
    xhrs.push(this);
  };
  const field = { value: TIO_KEY };
  const result = { textContent: '' };
  page.window.document.querySelector = (sel) => (sel === 'input[data-k="tomorrowioApiKey"]' ? field
    : sel === '[data-action-result="tomorrowioApiKey"]' ? result : null);
  page.openEditSheet('radarKeyTomorrowio');
  tapInModal(page, '[data-action]', 'data-action', 'testTomorrowioKey');
  assert.equal(xhrs.length, 1, 'the Test request went out');
  xhrs[0].status = 401;
  xhrs[0].onload();
  assert.match(result.textContent, /Rejected \(401\)/, 'the verdict line as before');
  tapInModal(page, '[data-select-close]');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · ✗ rejected: invalid key (401)') !== -1);
  assert.match(page.scroll.innerHTML, /data-edit-sheet="radarKeyTomorrowio"[^>]*\(API key rejected\)[^>]*><span>Edit<\/span>/);
  assert.match(tabButton(page, 'radar'), /Radar \(Tomorrow\.io rejected the API key\)/);
});

test('page: Tomorrow.io as weather provider AND radar — one key in the General tab\'s sheet, both rows agree', () => {
  const page = bootGeneratedPage(TIO_BOTH, 'basalt', { dialog: true });
  // No key: both rows say so, both tabs carry the dot, and both Edit buttons open ONE sheet.
  assert.match(page.scroll.innerHTML, /data-edit-sheet="providerKeyTomorrowio"[^>]*><span>Add key<\/span>/);
  assert.match(tabButton(page, 'general'), /General \(Tomorrow\.io has no API key\)/);
  assert.match(tabButton(page, 'radar'), /Radar \(Tomorrow\.io has no API key\)/);
  page.clickTab('radar');
  const radarTab = page.scroll.innerHTML;
  assert.match(radarTab, /data-select="radarProvider"[^]*?data-edit-sheet="providerKeyTomorrowio"[^>]*><span>Add key<\/span>/,
    'the Radar row\'s Edit opens the General tab\'s Tomorrow.io sheet');
  assert.doesNotMatch(radarTab, /radarKeyTomorrowio/, 'the Radar tab\'s own sheet is closed');
  assert.match(radarTab, /Needs an API key\. Without one, the watch gets no rain radar\./);
  page.openEditSheet('providerKeyTomorrowio');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-providerKeyTomorrowio">Tomorrow.io<') !== -1, 'over the Radar tab');
  typeTioKey(page, TIO_KEY);
  tapInModal(page, '[data-select-close]');
  // The key is in: the same summary on both rows, no note, no dot.
  const line = 'Key ••••wxyz · not tested yet · ~192 of 500 calls a day';
  assert.ok(page.scroll.innerHTML.indexOf('<br>' + line + '</div>') !== -1, 'the Radar row');
  assert.doesNotMatch(page.scroll.innerHTML, /Needs an API key/);
  page.clickTab('general');
  assert.ok(page.scroll.innerHTML.indexOf('<br>' + line + '</div>') !== -1, 'the Weather provider row, word for word');
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
});

test('page: both — Save asks once, for the General tab\'s row, and "Add key" opens the one sheet there', async () => {
  const page = bootGeneratedPage(TIO_BOTH, 'basalt', { dialog: true });
  page.clickTab('radar');
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('id="cfm-ttl">Tomorrow.io has no API key</span>') !== -1);
  assert.ok(page.modal.innerHTML.indexOf('Without one, the watch gets no forecast.') !== -1, 'General comes first');
  tapInModal(page, '[data-confirm]', 'data-confirm', 'action');
  assert.ok(page.modal.innerHTML.indexOf('esheet-ttl-providerKeyTomorrowio">Tomorrow.io<') !== -1);
  assert.match(tabButton(page, 'general'), /class="tab on"/, 'over the General tab');
  assert.equal(await page.saved(), null, 'nothing was saved');
});

test('page: both — a refusal on record reads the same on both rows and dots both tabs', () => {
  const userData = { keyResults: radarRecord(TIO_KEY, 403, 'tomorrowio') };
  const page = bootGeneratedPage(Object.assign({ tomorrowioApiKey: TIO_KEY }, TIO_BOTH), 'basalt', { userData });
  const line = 'Key ••••wxyz · ✗ rejected: no access to this data (403)';
  assert.ok(page.scroll.innerHTML.indexOf('<br>' + line + '</div>') !== -1, 'the Weather provider row');
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('<br>' + line + '</div>') !== -1, 'the Radar row, word for word');
  assert.match(tabButton(page, 'general'), /General \(Tomorrow\.io rejected the API key\)/);
  assert.match(tabButton(page, 'radar'), /Radar \(Tomorrow\.io rejected the API key\)/);
});

test('page: radar off — no Tomorrow.io Edit, note, dot or dialog on the Radar tab', async () => {
  const page = bootGeneratedPage(Object.assign({}, TIO_RADAR_ONLY, { radarMode: 'off' }), 'basalt', { dialog: true });
  page.clickTab('radar');
  assert.doesNotMatch(page.scroll.innerHTML,
    /Needs an API key|data-edit-sheet="(providerKey|radarKey)|data-k="tomorrowioApiKey"/);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).radarProvider, 'tomorrowio', 'the pick itself is kept');
});

test('page: aplite has no Radar tab — no dot and no dialog for a radar-only Tomorrow.io without a key', async () => {
  const page = bootGeneratedPage(TIO_RADAR_ONLY, 'aplite', { dialog: true });
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '');
  assert.equal((await page.saved()).radarProvider, 'tomorrowio');
});

// --- the note under the Radar provider row: a regional source that cannot see the place ---

test('page: DWD picked while the last update\'s location lies outside its area — the amber note under the row', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: true, metno: true }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  page.clickTab('radar');
  const note = '<div class="static join info"><div class="info-box">DWD radar only covers Germany, and your location '
    + 'is outside it. Rainbow covers the whole world.</div></div>';
  assert.ok(page.scroll.innerHTML.indexOf(note) !== -1, 'the note hugs the row');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /only covers/, 'a worldwide source: no note');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'metno');
  assert.match(page.scroll.innerHTML, /Met\.no radar only covers the Nordic countries, and your location is outside it\./);
});

test('page: DWD picked while it sends no radar data for the place (its second 404 in a row) — the general note', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: false, metno: true, misses: { dwd: 2 } }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  page.clickTab('radar');
  const note = '<div class="static join info"><div class="info-box">DWD sends no radar data for your location '
    + 'right now. Rainbow covers the whole world.</div></div>';
  assert.ok(page.scroll.innerHTML.indexOf(note) !== -1, 'the amber note hugs the row');
  assert.doesNotMatch(page.scroll.innerHTML, /only covers/, 'not the out-of-area one');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbow');
  assert.doesNotMatch(page.scroll.innerHTML, /sends no radar data/, 'a worldwide source: no note');
});

test('page: one 404 alone puts no note under the DWD row', () => {
  const userData = { radarCoverage: JSON.stringify({ dwd: false, metno: true, misses: { dwd: 1 } }) };
  const page = bootGeneratedPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' }, 'basalt', { userData });
  page.clickTab('radar');
  assert.doesNotMatch(page.scroll.innerHTML, /sends no radar data|only covers/);
});

test('page: no note while the place is inside, with no record yet, or with radar off', () => {
  const inside = { radarCoverage: JSON.stringify({ dwd: false, metno: true }) };
  const dwd = { provider: 'openmeteo', radarMode: 'graph', radarProvider: 'dwd' };
  [[dwd, inside], [dwd, {}], [Object.assign({}, dwd, { radarMode: 'off' }), { radarCoverage: JSON.stringify({ dwd: true }) }]]
    .forEach(([cfg, userData]) => {
      const page = bootGeneratedPage(cfg, 'basalt', { userData });
      page.clickTab('radar');
      assert.doesNotMatch(page.scroll.innerHTML, /only covers/, JSON.stringify([cfg, userData]));
    });
});

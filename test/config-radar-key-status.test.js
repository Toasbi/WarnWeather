// test/config-radar-key-status.test.js — "Rainbow (own key)" on the Radar provider row has the
// key status a keyed weather provider has (settings/key-status.js, RADAR_KEYS): the Edit / "Add
// key" button beside the dropdown, the summary line ("Key ••••1234 · ✓ works · ~2,976 of 5,000
// calls a month"), the amber note while the key is missing, the dot on the Radar tab and the Save
// dialog while it is missing or known to be rejected. Its key never rides a weather update, so
// the evidence is the Test button's answer and the last radar update's verdict
// (userData.radarKeyResult, weather/radar-key-result.js) — never the weather records. Module
// first, then the REAL generated page (page-harness).
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
const ARGS = radarRow.attentionFrom.args;
const SOURCE = ARGS.keyed.rainbowkey;
const RBW_KEY = 'rbw-secret-0123wxyz';
// The page's state while open: the picker holds the source (onbuild.js folds the stored pair).
const OWN = { radarProvider: 'rainbowkey', radarMode: 'graph', fetchIntervalMin: '15', sleepNightEnabled: false };
// The same, as the phone stores it.
const STORED_OWN = { provider: 'openmeteo', radarProvider: 'rainbow', rainbowOwnKey: true, radarMode: 'graph',
  fetchIntervalMin: '15', sleepNightEnabled: false };

/**
 * A radar verdict record as the phone stores it (radar-key-result.js).
 * @param {string} key The key the request carried.
 * @param {number} status The status that answered it.
 * @param {string} [id] The radar source.
 * @returns {string} The stored JSON.
 */
function radarRecord(key, status, id) {
  return JSON.stringify({ id: id || 'rainbowkey', keyHash: fingerprint(key), status });
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

test('the last radar update\'s verdict on THIS key counts: 2xx and 429 work, 401/403 are refused', () => {
  const S = Object.assign({ rainbowApiKey: RBW_KEY }, OWN);
  const at = (record) => { global.INJECTED_USERDATA = { radarKeyResult: record }; return stateOf(S); };
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

test('the weather update\'s records never speak for the radar key', () => {
  const hash = fingerprint(RBW_KEY);
  global.INJECTED_USERDATA = {
    authBackoff: JSON.stringify({ code: 'status_401', since: 1, provider: 'rainbowkey', keyHash: hash }),
    lastFetchSuccess: JSON.stringify({ id: 'rainbowkey', keyHash: hash })
  };
  assert.equal(stateOf(Object.assign({ rainbowApiKey: RBW_KEY }, OWN)).state, 'untested');
});

test('a Test answer this page open wins over the record, for the key it tested', () => {
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 401) };
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
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 200) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month');
  global.INJECTED_USERDATA = { radarKeyResult: radarRecord(RBW_KEY, 401) };
  assert.equal(keyStatus.summaryLine(SOURCE, stateOf(S), S), 'Key ••••wxyz · ✗ rejected: invalid key (401)');
});

test('the resolvers answer only for "Rainbow (own key)"', () => {
  const args = (value) => Object.assign({ messageKey: 'radarProvider', value }, ARGS);
  ['dwd', 'metno', 'rainbow', 'tomorrowio'].forEach((v) => {
    const S = Object.assign({}, OWN, { radarProvider: v });
    assert.equal(keyStatus.keySheet(S, {}, args(v)), null, v + ': no Edit button');
    assert.equal(keyStatus.keyMissingNote(S, {}, args(v)), '', v + ': no note');
    assert.equal(keyStatus.keyAttention(S, {}, args(v)), null, v + ': no dot, no dialog');
  });
  const S = Object.assign({ rainbowApiKey: '' }, OWN);
  assert.equal(keyStatus.keySheet(S, {}, args('rainbowkey')), 'radarKeyRainbow');
  assert.deepEqual(keyStatus.keyBadge(S, {}, args('rainbowkey')), { label: 'Add key', tone: 'warn', ariaNote: 'no API key', dots: [] });
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
  assert.match(body, /<button type="button" class="thr-btn warn" data-edit-sheet="radarKeyRainbow"[^>]*><span>Add key<\/span>/);
  assert.match(body, /<div class="static join info"><div class="info-box">Needs an API key\. Without one, the watch gets no rain radar\.<\/div><\/div>/);
  assert.match(tabButton(page, 'radar'), /aria-label="Radar \(Rainbow has no API key\)">Radar<span class="tab-dot" aria-hidden="true"><\/span>/);
  ['weather', 'general', 'forecast', 'watch', 'layout', 'more'].forEach((id) =>
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
  assert.equal(blob.radarProvider, 'rainbow');
  assert.equal(blob.rainbowOwnKey, true);
  assert.equal(blob.rainbowApiKey, RBW_KEY);
});

test('page: "Save anyway" saves the own key without a key, as before', async () => {
  const page = bootGeneratedPage(STORED_OWN, 'basalt', { dialog: true });
  page.tapSave();
  tapInModal(page, '[data-confirm]', 'data-confirm', 'save');
  const blob = await page.saved();
  assert.equal(blob.radarProvider, 'rainbow');
  assert.equal(blob.rainbowOwnKey, true);
  assert.equal(blob.rainbowApiKey, '');
});

test('page: a key the last radar update was refused with — the summary, the dot and the "rejected" dialog', () => {
  const userData = { radarKeyResult: radarRecord(RBW_KEY, 403) };
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

test('page: a key the last radar update went through with reads "✓ works" and saves without a dialog', async () => {
  const userData = { radarKeyResult: radarRecord(RBW_KEY, 200) };
  const page = bootGeneratedPage(Object.assign({ rainbowApiKey: RBW_KEY }, STORED_OWN), 'basalt', { userData, dialog: true });
  page.clickTab('radar');
  assert.ok(page.scroll.innerHTML.indexOf('Key ••••wxyz · ✓ works · ~2,976 of 5,000 calls a month') !== -1);
  assert.doesNotMatch(page.tabs.innerHTML, /tab-dot/);
  page.tapSave();
  assert.equal(page.modal.innerHTML, '', 'no dialog');
  assert.equal((await page.saved()).rainbowOwnKey, true);
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
  assert.equal(blob.rainbowOwnKey, true, 'the pick itself is kept');
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
  assert.equal((await page.saved()).rainbowOwnKey, true);
});

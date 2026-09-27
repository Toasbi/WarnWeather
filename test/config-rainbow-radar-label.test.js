// test/config-rainbow-radar-label.test.js — the radar picker names its Rainbow option for
// the key it runs on: "Rainbow" once the user's own key is in use ("Use your own key" on
// AND a non-blank key), "Rainbow (limited)" on the shared key everyone splits (switch
// off, or on with no key yet). blocks.js radarProviderOptions does the naming; the value
// stays 'rainbow' in both states, so the recommend marker, hintByValue and the showWhen
// gates don't notice.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
const schema = require('../src/pkjs/settings/schema.js');
const { bootGeneratedPage } = require('./helpers/page-harness');

const LIMITED = 'Rainbow (limited)';
const OWN = 'Rainbow';

/** @returns {Object} The Radar tab's radarProvider picker item. */
function radarPicker() {
  let found = null;
  schema.tabs.forEach((t) => t.sections.forEach((s) => s.items.forEach((i) => {
    if (i.messageKey === 'radarProvider') { found = i; }
  })));
  return found;
}

/**
 * The Rainbow option's label as the registered resolver names it for a settings state.
 * @param {Object} S Settings state.
 * @returns {string} The label of the 'rainbow' option.
 */
function rainbowLabel(S) {
  const item = radarPicker();
  const resolver = global.PConf.optionsResolvers.get(item.optionsFrom.resolver);
  return resolver(S, {}, item.optionsFrom.args).find((o) => o[1] === 'rainbow')[0];
}

test('the resolver: "Rainbow" only with the switch on AND a non-blank key', () => {
  assert.equal(rainbowLabel({ rainbowOwnKey: false }), LIMITED, 'switch off');
  assert.equal(rainbowLabel({ rainbowOwnKey: false, rainbowApiKey: 'KEY' }), LIMITED,
    'switch off with a key kept from earlier: still the shared radar');
  assert.equal(rainbowLabel({ rainbowOwnKey: true, rainbowApiKey: '' }), LIMITED, 'on, key blank');
  assert.equal(rainbowLabel({ rainbowOwnKey: true, rainbowApiKey: '  \t ' }), LIMITED, 'on, whitespace only');
  assert.equal(rainbowLabel({ rainbowOwnKey: true }), LIMITED, 'on, key never set');
  assert.equal(rainbowLabel({ rainbowOwnKey: true, rainbowApiKey: 'KEY' }), OWN, 'on + key');
  assert.equal(rainbowLabel({ rainbowOwnKey: true, rainbowApiKey: ' KEY ' }), OWN, 'a padded key counts (Save trims it)');
  // Strict true, like radar-source-id.js at runtime: a truthy non-boolean would name the
  // option "Rainbow" while the fetch still runs on the shared key.
  assert.equal(rainbowLabel({ rainbowOwnKey: 1, rainbowApiKey: 'KEY' }), LIMITED, 'only a real true counts (1)');
  assert.equal(rainbowLabel({ rainbowOwnKey: 'true', rainbowApiKey: 'KEY' }), LIMITED, "only a real true counts ('true')");
  assert.equal(rainbowLabel({}), LIMITED, 'a fresh install');
  assert.equal(rainbowLabel(null), LIMITED, 'no state at all');
});

test('the resolver renames only the Rainbow label: values, descs, order and the other options stay', () => {
  const item = radarPicker();
  const resolver = global.PConf.optionsResolvers.get(item.optionsFrom.resolver);
  const statics = item.optionsFrom.args.options;
  [{}, { rainbowOwnKey: true, rainbowApiKey: 'KEY' }].forEach((S) => {
    const out = resolver(S, {}, item.optionsFrom.args);
    assert.deepEqual(out.map((o) => o[1]), statics.map((o) => o[1]), 'same values, same order');
    out.forEach((o, i) => {
      assert.deepEqual(o[2], statics[i][2], o[1] + ' keeps its desc');
      if (o[1] !== 'rainbow') { assert.equal(o[0], statics[i][0], o[1] + ' keeps its label'); }
    });
  });
  assert.equal(statics.find((o) => o[1] === 'rainbow')[0], OWN, 'the schema list holds the plain name');
  assert.equal(resolver({}, {}, item.optionsFrom.args).find((o) => o[1] === 'rainbow')[0], LIMITED);
  assert.equal(statics.find((o) => o[1] === 'rainbow')[0], OWN, 'and the resolver never mutates it');
});

/**
 * The open radar picker's option rows, keyed by value.
 * @param {Object} S Settings state.
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

const OWN_KEY = { rainbowOwnKey: true, rainbowApiKey: 'KEY' };

test('recommended marker, limited: the bracketed name moves "Recommended" onto the desc line', () => {
  const rows = openPickerRows({ holidayCountry: 'US' });
  assert.match(rows.rainbow, /<span class="ssel-opt-name">Rainbow \(limited\)<\/span>/,
    'no "(Recommended)" after "(limited)"');
  assert.match(rows.rainbow,
    /<span class="ssel-opt-desc"><b class="ssel-rec">Recommended<\/b> · Worldwide satellite \+ radar nowcast<\/span>/);
  Object.keys(rows).filter((v) => v !== 'rainbow').forEach((v) => {
    assert.doesNotMatch(rows[v], /ssel-rec/, v + ' carries no marker');
  });
});

test('recommended marker, own key: "Rainbow (Recommended)" inline, desc untouched', () => {
  const rows = openPickerRows(Object.assign({ holidayCountry: 'US' }, OWN_KEY));
  assert.match(rows.rainbow,
    /<span class="ssel-opt-name">Rainbow <b class="ssel-rec">\(Recommended\)<\/b><\/span>/);
  assert.match(rows.rainbow, /<span class="ssel-opt-desc">Worldwide satellite \+ radar nowcast<\/span>/);
  Object.keys(rows).filter((v) => v !== 'rainbow').forEach((v) => {
    assert.doesNotMatch(rows[v], /ssel-rec/, v + ' carries no marker');
  });
});

test('recommended marker elsewhere (DE → DWD): Rainbow is unmarked in both label states', () => {
  [{ holidayCountry: 'DE' }, Object.assign({ holidayCountry: 'DE' }, OWN_KEY)].forEach((S) => {
    const rows = openPickerRows(S);
    assert.match(rows.dwd, /<span class="ssel-opt-name">DWD <b class="ssel-rec">\(Recommended\)<\/b><\/span>/);
    assert.doesNotMatch(rows.rainbow, /ssel-rec/);
    assert.match(rows.rainbow, S.rainbowOwnKey ? /ssel-opt-name">Rainbow</ : /ssel-opt-name">Rainbow \(limited\)</);
  });
});

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

test('the page: the switch flips the label at once, the key field when it commits', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarProvider: 'rainbow', radarMode: 'graph',
    holidayCountry: 'US' });
  page.clickTab('radar');
  assert.deepEqual(trigger(page.scroll.innerHTML), { label: LIMITED, aria: 'Radar provider: ' + LIMITED },
    'switch off: the shared radar');

  page.clickToggle('rainbowOwnKey');
  assert.equal(page.S.rainbowOwnKey, true);
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED, 'switch on, no key yet: still limited');

  const writes = page.scroll.writes;
  page.typeText('rainbowApiKey', '   ');
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED, 'whitespace is no key');
  page.typeText('rainbowApiKey', 'my-key');
  assert.deepEqual(trigger(page.scroll.innerHTML), { label: OWN, aria: 'Radar provider: ' + OWN },
    'the committed key relabels the trigger');
  assert.equal(page.scroll.writes, writes, 'in place — no re-render that would swallow the next tap');
  assert.ok(page.scroll.relabels > 0, 'the trigger was rewritten in place');

  page.openSelect('radarProvider');
  assert.match(page.modal.innerHTML, /data-select-pick="rainbow"[\s\S]*?ssel-opt-name">Rainbow <b class="ssel-rec">\(Recommended\)<\/b>/,
    'the open sheet names it "Rainbow", recommended inline');
  page.pickOption('radarProvider', 'rainbow');   // closes the sheet
  assert.equal(trigger(page.scroll.innerHTML).label, OWN, 'a full render agrees');

  page.typeText('rainbowApiKey', '');
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED, 'clearing the key: limited again');
  page.typeText('rainbowApiKey', 'my-key');
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);

  page.clickToggle('rainbowOwnKey');
  assert.equal(trigger(page.scroll.innerHTML).label, LIMITED, 'switch off: limited, though the key is kept');
  assert.equal(page.S.rainbowApiKey, 'my-key');
});

test('the page: a saved own key opens on "Rainbow"', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarProvider: 'rainbow', radarMode: 'graph',
    rainbowOwnKey: true, rainbowApiKey: 'saved-key' });
  page.clickTab('radar');
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
});

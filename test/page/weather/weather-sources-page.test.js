// test/page/weather/weather-sources-page.test.js — where the weather comes from, on the settings
// page: the Weather row of Setup › Data sources and its second line; the Weather dialog it opens,
// with Open-Meteo's Model under the Provider and the weather calls a day (the plan's count); and
// the dialog's Other sources list: the values picked to another provider, the ones the watch
// draws that the Provider has none of, which come from Open-Meteo (the source plan's fills, by the
// phone's own rules), and the precipitation amount a weather model brings none of; its pickers and
// Use another source; and the graphs' Bars row, which says when the bars stay empty.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
const page = require('../../../src/pkjs/page/weather/weather-sources-page.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const providerFactory = require('../../../src/pkjs/weather/adapter/provider-factory.js');
const providerReadings = require('../../../src/pkjs/weather/domain/provider-readings.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { NOTHING_PLACED, NOTHING_DRAWN } = require('../../helpers/on-demand.js');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');
const ui = require('../../../src/pkjs/config-ui/lib/ui.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
// No slot shows UV (a fresh install's radar bar and Watch bar do) and no alert is placed.
const NONE = NOTHING_DRAWN;
// Open-Meteo on ČHMÚ ALADIN, whose chance is ECMWF's: it brings no precipitation amount.
const ALADIN = { provider: 'openmeteo', openMeteoModel: 'chmi_aladin_seamless' };

/**
 * @param {Object} over Settings over NONE.
 * @returns {Array<string>} The Other sources list's rows on a basalt, as "id kind provider".
 */
function rows(over) {
  return page.sourceRows(Object.assign({}, NONE, over), BASALT).map((o) => [o.id, o.kind, o.provider].join(' '));
}

test('the list\'s rows: what the watch draws that the Provider has none of comes from Open-Meteo', () => {
  assert.deepEqual(rows({ provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' }),
    ['cloud fill openmeteo', 'pressure fill openmeteo']);
  assert.deepEqual(rows({ provider: 'yandex', secondaryLine: 'dew', thirdLine: 'cloud', statusForecastMid: 'pressure' }),
    ['dew fill openmeteo', 'cloud fill openmeteo', 'pressure fill openmeteo'], 'in the pickers\' order');
  assert.deepEqual(rows({ provider: 'dwd', secondaryLine: 'uv' }), ['uv fill openmeteo']);
  assert.deepEqual(rows({ provider: 'yandex', statusTopMid: 'wind', windSlotDirection: true }), ['windDir fill openmeteo']);
});

test('no rows while everything comes from the Provider', () => {
  assert.deepEqual(rows({ provider: 'yandex' }), [], 'nothing it lacks is drawn');
  assert.deepEqual(rows({ provider: 'dwd', secondaryLine: 'cloud' }), [], 'DWD sends cloud cover');
  providerFactory.PROVIDER_IDS.filter((id) => providerReadings.READING_IDS.every((r) => providerReadings.serves(id, r)))
    .forEach((id) => {
      assert.deepEqual(rows({ provider: id, secondaryLine: 'uv', thirdLine: 'cloud', statusForecastMid: 'dew' }), [], id);
    });
  assert.deepEqual(rows({ provider: 'constructor', secondaryLine: 'uv' }), [], 'a stored value the table does not know');
});

test('a value picked to another provider is its row, the one a fill would bring too', () => {
  const S = { provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' };
  assert.deepEqual(rows(Object.assign({ weatherSourceCloud: 'dwd', weatherSourceFeels: 'metno' }, S)),
    ['feels pick metno', 'cloud pick dwd', 'pressure fill openmeteo']);
  assert.deepEqual(rows(Object.assign({ weatherSourceCloud: 'tomorrowio' }, S)),
    ['cloud pick tomorrowio', 'pressure fill openmeteo'], 'a pick without its key keeps its row: it says so');
});

test('a weather model without a precipitation amount: its row until a source is picked for it', () => {
  assert.deepEqual(rows(ALADIN), ['rainAmount none '], 'the amount comes from nowhere');
  assert.deepEqual(rows(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN)), ['rainAmount pick dwd']);
  assert.equal(page.missingAmount(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN)), null);
  assert.equal(page.missingAmount(ALADIN).name, 'ČHMÚ ALADIN');
  ['ecmwf_ifs025', 'ecmwf_ifs', 'ncep_gfs_global', 'meteoswiss_icon_seamless', 'ukmo_seamless', 'retired_model']
    .forEach((model) => {
      assert.deepEqual(rows({ provider: 'openmeteo', openMeteoModel: model }), [], model + ': its own amount');
    });
  assert.deepEqual(rows({ provider: 'dwd', openMeteoModel: 'chmi_aladin_seamless' }), [],
    'a model only while Open-Meteo is the Provider');
  assert.equal(page.missingAmount(null), null);
});

const setupTab = schema.tabs.find((t) => t.id === 'setup');
const card = setupTab.sections.find((s) => s.id === 'dataSources');
const dialog = setupTab.sections.find((s) => s.sheetId === 'weatherSources');
const pickers = setupTab.sections.find((s) => s.sheetId === 'weatherSourcePickers');
const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const OTHER_FOR = 'weatherOtherSourceFor';

test('the Weather row opens Data sources and the Weather dialog, the Provider first', () => {
  assert.deepEqual(card.items[0], { type: 'sheet', sheetId: 'weatherSources', label: 'Weather',
    hintFrom: { resolver: 'weatherSourcesSummary' },
    attentionFrom: { resolver: 'keyAttention', args: { picker: 'provider' } } }, 'the Provider\'s key check rides it');
  assert.equal(card.items.some((i) => i.messageKey === 'provider'), false, 'the Provider is in the dialog');
  assert.equal(dialog.sheetOnly, true);
  assert.equal(dialog.title, 'Weather');
  assert.equal(dialog.block, 'weatherOtherSources', 'the Other sources list ends the dialog');
  const provider = dialog.items[0];
  assert.equal(provider.messageKey, 'provider');
  assert.equal(provider.label, 'Provider');
  assert.deepEqual(dialog.items[dialog.items.length - 1], { type: 'subheader', text: 'Other sources' });
});

test('the pickers: one per reading in the table\'s order, then Use another source\'s, none with a row', () => {
  assert.equal(pickers.sheetOnly, true, 'never opened as a dialog of its own');
  const keys = providerReadings.READING_IDS.map(sourcePlan.choiceKey);
  assert.deepEqual(pickers.items.map((i) => i.messageKey), keys.concat([OTHER_FOR]));
  assert.deepEqual(pickers.items.slice(0, -1).map((r) => r.label), ['Current temperature', 'Current feels-like',
    'Weather condition', 'Temperature', 'Feels-like', 'Dew point', 'Precipitation chance', 'Precipitation amount', 'Wind speed',
    'Wind gusts', 'Wind direction', 'UV index', 'Cloud cover', 'Air pressure']);
  pickers.items.slice(0, -1).forEach((row, i) => {
    assert.equal(row.type, 'select');
    assert.equal(row.defaultValue, '', 'the Provider\'s');
    assert.deepEqual(row.optionsFrom, { resolver: 'weatherValueSources', args: { reading: providerReadings.READING_IDS[i] } });
    assert.equal(row.options, undefined, 'the page builds the list');
    assert.equal(row.uiOnly, undefined, 'stored: the phone reads it (source-plan.js choicesOf)');
  });
  const add = pickers.items[pickers.items.length - 1];
  assert.equal(add.uiOnly, true, 'page-only');
  assert.deepEqual(add.dormantValues, [''], 'it opens with nothing ticked');
  assert.deepEqual(add.optionsFrom, { resolver: 'weatherFreeValues' });
  ['weatherValueSources', 'weatherFreeValues'].forEach((id) => assert.ok(global.PConf.optionsResolvers.get(id), id));
  assert.ok(global.PConf.blocks.get('weatherOtherSources'));
});

test('a value\'s picker: where it comes from without a pick, then the others that send it; a keyed one needs its key', () => {
  providerReadings.READING_IDS.forEach((reading) => {
    const options = page.valueSources({ provider: 'metno' }, BASALT, { reading: reading });
    assert.deepEqual(options[0], ['Met.no', '', { desc: 'Provider' }], reading);
    assert.deepEqual(options.slice(1).map((o) => o[1]),
      ['dwd', 'openmeteo', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex']
        .filter((id) => providerReadings.serves(id, reading)), reading + ': the others that send it');
    options.slice(1).forEach((o) => {
      assert.equal(Boolean(o[2] && o[2].disabled), Boolean(providerReadings.keySetting(o[1])),
        reading + ': ' + o[1] + ' inert without its key');
    });
  });
  const wind = page.valueSources({ provider: 'dwd', tomorrowioApiKey: 'k' }, BASALT, { reading: 'wind' });
  assert.deepEqual(wind.find((o) => o[1] === 'tomorrowio'), ['Tomorrow.io', 'tomorrowio'], 'with its key stored');
  assert.deepEqual(wind.find((o) => o[1] === 'openweathermap'),
    ['OpenWeatherMap', 'openweathermap', { desc: 'Pick it as Provider to add its key', disabled: true }]);
  assert.equal(page.valueSources({ provider: 'dwd' }, BASALT, { reading: 'cloud' }).some((o) => o[1] === 'yandex'), false,
    'Yandex sends no cloud cover');
  const uv = page.valueSources({ provider: 'dwd' }, BASALT, { reading: 'uv' });
  assert.deepEqual(uv[0], ['Open-Meteo', '', { desc: 'DWD sends none' }], 'DWD\'s UV comes from Open-Meteo');
  assert.equal(uv.filter((o) => o[0] === 'Open-Meteo').length, 1, 'so Open-Meteo is offered once');
});

test('the precipitation amount\'s picker with a weather model without one: none without a pick', () => {
  const amount = page.valueSources(ALADIN, BASALT, { reading: 'rainAmount' });
  assert.deepEqual(amount[0], ['None', '', { desc: 'ČHMÚ ALADIN brings none' }], 'no fill brings it');
  assert.deepEqual(amount.slice(1).map((o) => o[1]), ['dwd', 'metno', 'openweathermap', 'tomorrowio', 'wunderground',
    'yandex'], 'every other provider, Open-Meteo itself not');
  assert.deepEqual(page.valueSources({ provider: 'openmeteo', openMeteoModel: 'ukmo_seamless' }, BASALT,
    { reading: 'rainAmount' })[0], ['Open-Meteo', '', { desc: 'Provider' }], 'the Met Office brings its own');
  assert.deepEqual(page.valueSources(ALADIN, BASALT, { reading: 'rainChance' })[0], ['Open-Meteo', '', { desc: 'Provider' }]);
});

test('the readings picked to another provider: a known provider that sends it, not the Provider', () => {
  assert.deepEqual(page.readingPicks({ provider: 'dwd' }), []);
  assert.deepEqual(page.readingPicks({ provider: 'dwd', weatherSourceFeels: 'metno', weatherSourceRainAmount: 'openmeteo',
    weatherSourceWind: 'dwd', weatherSourceGust: 'constructor', weatherSourceCloud: 'yandex', weatherSourceDew: '' }),
  [{ id: 'feels', provider: 'metno' }, { id: 'rainAmount', provider: 'openmeteo' }],
  'the Provider\'s own, an unknown name and Yandex\'s cloud cover (it sends none) are no picks');
  assert.deepEqual(page.readingPicks(null), []);
});

test('the Weather row\'s line: the Provider, then the values from other sources, named while that stays short', () => {
  const line = global.PConf.hintResolvers.get('weatherSourcesSummary');
  const at = (over) => line(Object.assign({ provider: 'dwd' }, over), BASALT);
  assert.equal(at({}), 'DWD');
  assert.equal(at({ weatherSourceFeels: 'metno' }), 'DWD, feels-like from Met.no');
  assert.equal(at({ weatherSourceFeels: 'metno', weatherSourceRainAmount: 'openmeteo' }),
    'DWD, feels-like from Met.no and precipitation amount from Open-Meteo');
  assert.equal(at({ weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceRainAmount: 'metno' }),
    'DWD, feels-like, dew point and precipitation amount from Met.no', 'three from one provider');
  assert.equal(at({ weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceRainAmount: 'openmeteo' }),
    'DWD, 3 values from Met.no and Open-Meteo', 'three from two: counted');
  assert.equal(at({ weatherSourceCurrentTemp: 'metno', weatherSourceFeels: 'metno', weatherSourceDew: 'metno',
    weatherSourceUv: 'metno' }), 'DWD, 4 values from Met.no');
  assert.equal(line({ provider: 'constructor' }, BASALT), '', 'a stored value the table does not know');
  assert.equal(line(null, BASALT), '');
});

test('the Weather row\'s line names a weather model, and in the accent a precipitation amount it goes without', () => {
  const line = global.PConf.hintResolvers.get('weatherSourcesSummary');
  assert.equal(line({ provider: 'openmeteo' }, BASALT), 'Open-Meteo', 'the default: no name');
  assert.equal(line({ provider: 'openmeteo', openMeteoModel: 'ukmo_seamless' }, BASALT), 'Open-Meteo (Met Office UKV)');
  assert.equal(line(ALADIN, BASALT), 'Open-Meteo (ČHMÚ ALADIN), <span class="txt-acc">no precipitation amount</span>');
  assert.equal(line(Object.assign({ weatherSourceFeels: 'metno' }, ALADIN), BASALT),
    'Open-Meteo (ČHMÚ ALADIN), feels-like from Met.no, <span class="txt-acc">no precipitation amount</span>');
  assert.equal(line(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN), BASALT),
    'Open-Meteo (ČHMÚ ALADIN), precipitation amount from DWD');
  assert.equal(line({ provider: 'dwd', openMeteoModel: 'chmi_aladin_seamless' }, BASALT), 'DWD');
});

test('the Weather row says a missing or refused key, as the tab\'s dot does', () => {
  require('../../../src/pkjs/page/weather/keys/key-status.js');
  const line = global.PConf.hintResolvers.get('weatherSourcesSummary');
  assert.equal(line({ provider: 'openweathermap', owmApiKey: '' }, BASALT), 'OpenWeatherMap has no API key');
  assert.equal(line({ provider: 'openweathermap', owmApiKey: 'k', weatherSourceFeels: 'metno' }, BASALT),
    'OpenWeatherMap, feels-like from Met.no', 'an untested key asks for nothing');
});

test('Use another source\'s list: the values that still come from the Provider, Right now then Forecast', () => {
  const free = page.freeValues(Object.assign({ provider: 'dwd' }, NONE), BASALT);
  const child = (id, end) => ({ groupChild: true, groupEnd: end, next: sourcePlan.choiceKey(id) });
  assert.deepEqual(free.slice(0, 4), [['Right now', '', { groupHeader: true }],
    ['Current temperature', 'currentTemp', child('currentTemp', false)],
    ['Current feels-like', 'currentFeels', child('currentFeels', false)],
    ['Weather condition', 'condition', child('condition', true)]], 'each opens its picker next');
  assert.deepEqual(free[4], ['Forecast', '', { groupHeader: true }]);
  assert.equal(free.length, 2 + providerReadings.READING_IDS.length);
  assert.deepEqual(free[free.length - 1], ['Air pressure', 'pressure', child('pressure', true)]);
  const taken = page.freeValues(Object.assign({ provider: 'dwd', weatherSourceCurrentTemp: 'metno',
    weatherSourceCurrentFeels: 'metno', weatherSourceCondition: 'metno', weatherSourcePressure: 'metno' }, NONE), BASALT);
  assert.equal(taken[0][0], 'Forecast', 'no Right now while all three are picked');
  assert.equal(taken.some((o) => o[1] === 'pressure'), false);
  assert.deepEqual(taken[taken.length - 1], ['Cloud cover', 'cloud', child('cloud', true)]);
  const ids = (S) => page.freeValues(Object.assign({}, NONE, S), BASALT).map((o) => o[1]).filter(Boolean);
  assert.equal(ids({ provider: 'dwd', secondaryLine: 'uv' }).indexOf('uv'), -1, 'UV has its row: Open-Meteo\'s');
  assert.equal(ids(ALADIN).indexOf('rainAmount'), -1, 'the amount has its row');
  assert.ok(ids({ provider: 'dwd' }).indexOf('uv') !== -1, 'UV undrawn has no row: it may be picked');
});

test('every provider and reading has its words', () => {
  const words = require('../../../src/pkjs/page/weather/weather-words.js');
  providerFactory.PROVIDER_IDS.forEach((id) => { assert.ok(words.NAMES[id], id); });
  providerReadings.READING_IDS.forEach((id) => { assert.ok(words.WORDS[id], id); });
});

test('the Model and the calls line sit under the Provider, ahead of its key note', () => {
  const at = dialog.items.findIndex((i) => i.messageKey === 'openMeteoModel');
  assert.equal(dialog.items[at - 1].messageKey, 'provider');
  assert.equal(dialog.items[at + 1].textFrom.resolver, 'weatherCallsLine');
  assert.equal(dialog.items[at + 2].textFrom.resolver, 'keyMissingNote');
  assert.equal(dialog.items[at].joinPrevious, 'loose', 'no divider between the Provider and its Model');
  assert.equal(dialog.items[at + 1].joinPrevious, true);
  assert.equal(dialog.items.some((i) => i.textFrom && i.textFrom.resolver === 'weatherFillNote'), false,
    'what the Provider lacks is said by its rows under Other sources');
});

test('the Model row: Open-Meteo\'s only, the worldwide models, then the national ones, the default first', () => {
  const sourcesSchema = require('../../../src/pkjs/page/weather/weather-sources-schema.js');
  const openMeteoModels = require('../../../src/pkjs/weather/domain/open-meteo-models.js');
  const model = dialog.items.find((i) => i.messageKey === 'openMeteoModel');
  assert.equal(model.type, 'select');
  assert.equal(model.label, 'Model');
  assert.equal(model.defaultValue, 'ecmwf_ifs025');
  assert.deepEqual(model.showWhen, { key: 'provider', eq: 'openmeteo' });
  assert.equal(model.uiOnly, undefined, 'stored: the phone reads it (fetch-options.js openMeteoModel)');
  const opts = model.options;
  assert.deepEqual(opts.filter((o) => o[2].groupHeader).map((o) => o[0]), ['Worldwide', 'National']);
  assert.deepEqual(opts.filter((o) => !o[2].groupHeader).map((o) => o[1]), openMeteoModels.IDS, 'every model, in the table\'s order');
  assert.deepEqual(opts[1], ['ECMWF IFS', 'ecmwf_ifs025', { desc: 'Worldwide, 25 km · default', groupChild: true,
    groupEnd: false }]);
  assert.deepEqual(opts[3], ['NOAA GFS', 'ncep_gfs_global', { desc: 'Worldwide, 13 km', groupChild: true, groupEnd: true }]);
  assert.deepEqual(opts.find((o) => o[1] === 'geosphere_seamless')[2].desc, 'Austria, 1 km · no precipitation amount');
  assert.deepEqual(opts.find((o) => o[1] === 'ukmo_seamless'), ['Met Office UKV', 'ukmo_seamless',
    { desc: 'UK and Ireland, 2 km', groupChild: true, groupEnd: true }]);
  opts.filter((o) => !o[2].groupHeader).forEach((o) => {
    assert.equal(/no precipitation amount/.test(o[2].desc), !openMeteoModels.bringsAmount(o[1]), o[1]);
  });
  assert.equal(model.hintByValue.chmi_aladin_seamless, 'Central Europe only; elsewhere the watch uses ECMWF IFS. '
    + 'Its precipitation chance comes from ECMWF and doesn\'t match its amounts, so it brings no precipitation amount.');
  assert.equal(model.hintByValue.meteoswiss_icon_seamless, 'The Alps only; elsewhere the watch uses ECMWF IFS.');
  assert.equal(model.hintByValue.ukmo_seamless, 'Beyond its area it blends into a wider model.');
  assert.match(model.hintByValue.jma_seamless, /no precipitation chance of its own, so the watch takes ECMWF's/);
  assert.match(model.hintByValue.dwd_icon_seamless, /comes from a coarser model/);
  ['ecmwf_ifs025', 'ecmwf_ifs', 'ncep_gfs_global'].forEach((id) => assert.equal(model.hintByValue[id], undefined, id));
  assert.deepEqual(model.hintTailFrom, { resolver: 'weatherAmountPickTail' });
  assert.equal(sourcesSchema.PROVIDER_WHY.openmeteo,
    'Free, no API key. Uses ECMWF\'s global model, or the model you pick under Model.');
  assert.deepEqual(sourcesSchema.PROVIDER_OPTIONS.find((o) => o[1] === 'openmeteo')[2],
    { desc: 'ECMWF or a model you pick · no key' });
});

test('the Model row in the dialog: under Open-Meteo, asking for a source of an amount its model goes without', () => {
  const open = (S) => weatherDialog(S).modal.innerHTML;
  assert.equal(open({}).indexOf('data-select="openMeteoModel"'), -1, 'DWD: no Model');
  const body = open(ALADIN);
  assert.ok(body.indexOf('data-select="openMeteoModel"') !== -1);
  assert.ok(body.indexOf('so it brings no precipitation amount. Pick a source for it below.') !== -1, 'the hint asks');
  assert.ok(body.indexOf('data-select="openMeteoModel"') < body.indexOf('weather calls a day'), 'then the calls line');
  assert.equal(open(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN)).indexOf('Pick a source for it below.'), -1,
    'not once one is picked');
  assert.equal(open({ provider: 'openmeteo' }).indexOf('Pick a source for it below.'), -1, 'ECMWF IFS brings its own');
  assert.equal(page.amountPickTail(ALADIN), 'Pick a source for it below.');
  assert.equal(page.amountPickTail({ provider: 'openmeteo', openMeteoModel: 'ukmo_seamless' }), '');
});

// --- the Other sources list in the Weather dialog ---------------------------------------------

/**
 * The page on a basalt with the Weather dialog open.
 * @param {Object} over Settings over NONE and DWD.
 * @returns {Object} The page.
 */
function weatherDialog(over) {
  const p = bootGeneratedPage(Object.assign({ provider: 'dwd' }, NONE, over), 'basalt');
  p.openTabSheet('setup', 'weatherSources');
  return p;
}

test('a provider the page does not know draws no list', () => {
  const body = weatherDialog({ provider: 'nowhere', weatherSourceFeels: 'metno' }).modal.innerHTML;
  assert.equal(body.indexOf('aria-label="Other sources"'), -1);
  assert.equal(body.indexOf('data-select="' + OTHER_FOR + '"'), -1, 'no Use another source either');
});

/**
 * Use another source as the list draws it.
 * @param {string} rest How many values still come from the Provider, at the row's end.
 * @returns {string} Its markup.
 */
const useAnother = (rest) => ui.newRow('Use another source', rest, { 'data-select': OTHER_FOR, 'aria-haspopup': 'listbox' });

test('the list: Use another source alone while everything comes from the Provider', () => {
  const body = weatherDialog({}).modal.innerHTML;
  assert.ok(body.indexOf('<div class="ui-list">' + useAnother('All from DWD') + '</div>') !== -1,
    'a list\'s New row, as Your status bars draws its own: the plus beside its words, at its end what comes from DWD');
  assert.equal(body.indexOf('aria-label="Other sources"'), -1, 'no rows, so no list of them');
  assert.equal(body.indexOf('data-action="weatherPickRemove"'), -1, 'nothing to give back');
});

test('the list: a value the Provider sends none of names Open-Meteo, and has no ×', () => {
  const body = weatherDialog({ secondaryLine: 'uv' }).modal.innerHTML;
  assert.ok(body.indexOf(ui.listRow({ name: 'UV index', line: 'Open-Meteo · DWD sends none',
    at: { 'data-select': 'weatherSourceUv', 'aria-haspopup': 'listbox' } })) !== -1, 'it opens its picker');
  assert.equal(body.indexOf('data-action="weatherPickRemove"'), -1, 'nothing to give back');
  assert.ok(body.indexOf(useAnother('13 from DWD')) !== -1, 'and it does not come from DWD');
});

test('the list: the amount a weather model goes without, in the accent, until a source is picked for it', () => {
  const body = weatherDialog(ALADIN).modal.innerHTML;
  assert.ok(body.indexOf(ui.listRow({ name: 'Precipitation amount', line: 'None with ČHMÚ ALADIN · pick a source',
    at: { 'data-select': 'weatherSourceRainAmount', 'aria-haspopup': 'listbox' }, accent: true })) !== -1);
  assert.ok(body.indexOf('<span class="ui-d txt-acc">None with ČHMÚ ALADIN · pick a source</span>') !== -1);
  assert.ok(body.indexOf(useAnother('13 from Open-Meteo')) !== -1);
  const picked = weatherDialog(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN)).modal.innerHTML;
  assert.ok(picked.indexOf(ui.listRow({ name: 'Precipitation amount', line: 'DWD',
    at: { 'data-select': 'weatherSourceRainAmount', 'aria-haspopup': 'listbox' },
    x: { 'data-action': 'weatherPickRemove', 'data-action-arg': 'rainAmount',
      'aria-label': 'Precipitation amount back to Open-Meteo' } })) !== -1, 'a pick, with its ×');
  assert.equal(picked.indexOf('txt-acc'), -1);
  assert.ok(picked.indexOf(useAnother('13 from Open-Meteo')) !== -1);
});

test('the list: a row for each value from another provider, which opens its picker, and its ×', () => {
  const body = weatherDialog({ weatherSourceFeels: 'metno', weatherSourceWind: 'tomorrowio' }).modal.innerHTML;
  assert.ok(body.indexOf(ui.listRow({ name: 'Feels-like', line: 'Met.no',
    at: { 'data-select': 'weatherSourceFeels', 'aria-haspopup': 'listbox' },
    x: { 'data-action': 'weatherPickRemove', 'data-action-arg': 'feels', 'aria-label': 'Feels-like back to DWD' } })) !== -1,
  'the kit\'s list row, its × naming where the value goes back to');
  assert.ok(body.indexOf('<span class="ui-n">Wind speed</span><span class="ui-d">Tomorrow.io · no API key</span>') !== -1,
    'a pick without its key says so: the phone asks DWD then');
  assert.ok(body.indexOf('Feels-like') < body.indexOf('Wind speed'), 'in the pickers\' order');
  const list = body.indexOf('<div class="ui-list"><div role="list" aria-label="Other sources">');
  assert.ok(list !== -1 && list < body.indexOf('Feels-like'), 'the rows in a list of their own');
  assert.ok(body.indexOf('</div></div>' + useAnother('12 from DWD') + '</div>') > body.indexOf('Wind speed'),
    'Use another source after it: the other 12 come from DWD');
});

test('Use another source: a value, then its provider; nothing changes until the provider is picked', () => {
  const p = weatherDialog({});
  p.openModalSelect(OTHER_FOR);
  let body = p.modal.innerHTML;
  assert.ok(body.indexOf('psheet-ttl-' + OTHER_FOR + '">Use another source for<') !== -1, 'its list rises over the dialog');
  assert.ok(body.indexOf('Right now') !== -1 && body.indexOf('Forecast') !== -1, 'in its two groups');
  p.pickOption(OTHER_FOR, 'feels');
  body = p.modal.innerHTML;
  assert.ok(body.indexOf('psheet-ttl-weatherSourceFeels">Feels-like<') !== -1, 'the value\'s picker opens straight away');
  assert.equal(p.S[OTHER_FOR], '', 'the value is not stored: it only opens the picker');
  assert.equal(p.S.weatherSourceFeels, '', 'still the Provider\'s');
  assert.match(body, /class="ssel-opt on"[^>]*data-select-pick=""/, 'DWD ticked: where it comes from now');
  p.pickOption('weatherSourceFeels', 'metno');
  body = p.modal.innerHTML;
  assert.equal(p.S.weatherSourceFeels, 'metno');
  assert.equal(body.indexOf('class="psheet"'), -1, 'the sheet closed');
  assert.ok(body.indexOf('data-select="weatherSourceFeels"') !== -1, 'the value has its row');
  assert.ok(body.indexOf('>13 from DWD<') !== -1);
});

test('the ×: the value comes from the Provider again; the dialog\'s × puts every pick back', () => {
  const p = weatherDialog({ weatherSourceFeels: 'metno', weatherSourceRainAmount: 'openmeteo' });
  p.tapAction('weatherPickRemove', 'feels', 'modal');
  assert.equal(p.S.weatherSourceFeels, '');
  assert.equal(p.modal.innerHTML.indexOf('data-select="weatherSourceFeels"'), -1, 'its row is gone');
  assert.ok(p.modal.innerHTML.indexOf('data-select="weatherSourceRainAmount"') !== -1, 'the other stays');
  p.openModalSelect(OTHER_FOR);
  p.pickOption(OTHER_FOR, 'uv');
  p.pickOption('weatherSourceUv', 'metno');
  p.cancelDialog();
  assert.equal(p.S.weatherSourceFeels, 'metno', 'back as it was');
  assert.equal(p.S.weatherSourceUv, '');
  p.openEditSheet('weatherSources');
  p.openModalSelect('weatherSourceRainAmount');
  p.pickOption('weatherSourceRainAmount', 'metno');
  p.doneDialog();
  assert.ok(p.scroll.innerHTML.indexOf('<div class="hint">DWD, feels-like and precipitation amount from Met.no</div>') !== -1,
    'Done keeps it, and the Weather row says it');
});

test('a value picked to what becomes the Provider comes from the Provider', async () => {
  // A pick left at the Provider shows as none, so the dialog lists only Feels-like and Wind.
  const p = weatherDialog({ weatherSourceFeels: 'metno', weatherSourceWind: 'openmeteo', weatherSourceGust: 'dwd' });
  assert.equal(p.modal.innerHTML.indexOf('data-select="weatherSourceGust"'), -1, 'premise: no row for the gusts');
  p.openModalSelect('provider');
  p.pickOption('provider', 'metno');
  assert.equal(p.S.weatherSourceFeels, '', 'no pick left behind to come back with another Provider');
  assert.equal(p.S.weatherSourceGust, '', 'nor one left at the old Provider, which the list showed as none');
  assert.equal(p.S.weatherSourceWind, 'openmeteo');
  p.doneDialog();
  const saved = await p.save();
  assert.equal(saved.weatherSourceFeels, '');
  assert.equal(saved.weatherSourceWind, 'openmeteo');
  assert.equal(saved[OTHER_FOR], undefined, 'Use another source stores nothing');
});

// --- the weather calls line at the end of Data sources ---------------------------------------

/**
 * The line on a basalt, every 15 minutes with no night pause unless `intervalMin` and
 * `pauseHours` say otherwise (a pause from 22:00 when it is 9 hours).
 * @param {Object} over Settings over NONE.
 * @param {number} [intervalMin] The update interval.
 * @param {number} [pauseHours] The Battery saver's window: 0 or 9.
 * @returns {string}
 */
function calls(over, intervalMin, pauseHours) {
  const pause = pauseHours ? { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' }
    : { sleepNightEnabled: false };
  return page.callsLine(Object.assign({ fetchIntervalMin: String(intervalMin || 15) }, pause, NONE, over), BASALT);
}

test('the calls line counts each update\'s requests, and the UV fill every few hours', () => {
  assert.equal(calls({ provider: 'openmeteo' }), 'About 192 weather calls a day.', 'its two requests every update');
  assert.equal(calls({ provider: 'openmeteo', secondaryLine: 'uv' }), 'About 288 weather calls a day.',
    'and its UV request while UV is drawn');
  assert.equal(calls({ provider: 'dwd', secondaryLine: 'uv' }),
    'About 200 weather calls a day: 192 to DWD and 8 to Open-Meteo.');
  assert.equal(calls({ provider: 'dwd', secondaryLine: 'uv' }, 60, 9),
    'About 34 weather calls a day: 30 to DWD and 4 to Open-Meteo.', 'hourly, paused 9 hours a night');
  assert.equal(calls({ provider: 'yandex', yandexApiKey: 'k', secondaryLine: 'cloud' }),
    'About 192 weather calls a day: 96 to Yandex Weather and 96 to Open-Meteo.', 'the gap request every update');
  assert.equal(calls({ provider: 'constructor' }), '', 'a stored value the table does not know');
});

test('the calls line counts what a weather model asks', () => {
  assert.equal(calls({ provider: 'openmeteo', openMeteoModel: 'jma_seamless' }), 'About 288 weather calls a day.',
    'JMA has no chance: ECMWF\'s is asked beside it');
  assert.equal(calls(Object.assign({ weatherSourceRainAmount: 'dwd' }, ALADIN)),
    'About 384 weather calls a day: 192 to Open-Meteo and 192 to DWD.', 'DWD for the amount');
  assert.equal(calls({ provider: 'dwd', openMeteoModel: 'jma_seamless' }), 'About 192 weather calls a day.',
    'a model only while Open-Meteo is the Provider');
});

test('the calls line counts every provider a reading in use comes from', () => {
  assert.equal(calls({ provider: 'metno', weatherSourceTemperature: 'dwd',
    weatherSourceRainAmount: 'openmeteo' }), 'About 480 weather calls a day: 96 to Met.no, 192 to DWD and 192 to Open-Meteo.',
  'the Provider first, then the parts in the readings\' order');
  assert.equal(calls({ provider: 'metno', weatherSourceWind: 'tomorrowio' }),
    'About 96 weather calls a day.', 'a keyed pick without its key follows the Provider');
});

test('the line closes Data sources under the Update interval, at the interval Save stores and the night pause', () => {
  const card = schema.tabs.find((t) => t.id === 'setup').sections.find((s) => s.id === 'dataSources');
  assert.deepEqual(card.items[card.items.length - 1],
    { type: 'staticText', joinPrevious: true, textFrom: { resolver: 'weatherCallsLine' } });
  assert.equal(card.items[card.items.length - 2].messageKey, 'fetchIntervalMin');
  const line = global.PConf.hintResolvers.get('weatherCallsLine');
  const S = Object.assign({}, NONE, { provider: 'tomorrowio', tomorrowioApiKey: 'k', radarProvider: 'tomorrowio',
    radarMode: 'graph', fetchIntervalMin: '5', tomorrowioFitBudget: true, sleepNightEnabled: false });
  assert.equal(line(S, BASALT), 'About 96 weather calls a day.',
    'tomorrow.io\'s weather and radar every 5 minutes break its free plan: Save stores 15');
  assert.equal(line(Object.assign({}, S, { tomorrowioFitBudget: false }), BASALT), 'About 288 weather calls a day.');
  assert.equal(line(Object.assign({}, S, { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' }), BASALT),
    'About 180 weather calls a day.', 'paused 9 hours a night, 5 minutes fits the plan');
  assert.equal(line(Object.assign({}, S, { radarEnabled: false }), BASALT), 'About 288 weather calls a day.',
    'the radar off: Save stores no radar mode that calls tomorrow.io, so 5 minutes fits');
});

test('the ×: focus goes to the × now in its place, else the one before it, else to Use another source', () => {
  const remove = global.PConf.actions.weatherPickRemove;
  const del = (id) => '[data-action="weatherPickRemove"][data-action-arg="' + id + '"]';
  const add = '[data-select="' + OTHER_FOR + '"]';
  const S = { provider: 'dwd', weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceWind: 'metno' };
  assert.deepEqual(remove('dew', S), { focus: [del('wind'), del('feels'), add] }, 'the row after it, else before');
  assert.equal(S.weatherSourceDew, '');
  assert.deepEqual(remove('wind', S), { focus: [del('feels'), add] }, 'the row before, when it was the last');
  assert.deepEqual(remove('feels', S), { focus: [add] }, 'Use another source, when none is left');
});

// --- the graphs' Bars row ---------------------------------------------------------------------

test('the Bars row says the bars stay empty while the weather model goes without a precipitation amount', () => {
  const tail = (S) => page.amountBarsTail(S, BASALT, { messageKey: 'barSource', link: '<L>' });
  assert.equal(tail(Object.assign({ barSource: 'rain' }, ALADIN)),
    'ČHMÚ ALADIN brings no precipitation amount, so there are no bars. Pick a source for it in <L>.');
  assert.equal(tail(Object.assign({ barSource: 'off' }, ALADIN)), '', 'no bars asked for');
  assert.equal(tail(Object.assign({ barSource: 'rain', weatherSourceRainAmount: 'dwd' }, ALADIN)), '', 'DWD\'s amount');
  assert.equal(tail({ barSource: 'rain', provider: 'openmeteo' }), '', 'ECMWF IFS brings its own');
  const bars = schema.tabs.find((t) => t.id === 'graphs').sections.flatMap((s) => s.items || [])
    .find((i) => i.messageKey === 'barSource');
  assert.equal(bars.hintTailFrom.resolver, 'weatherAmountBarsTail');
  assert.equal(bars.hintTailFrom.args.link,
    '<button type="button" class="txt-link" data-goto-tab="setup">Setup › Data sources</button>');
  const p = bootGeneratedPage(Object.assign({ barSource: 'rain' }, NONE, ALADIN), 'basalt');
  p.openTabSheet('graphs', 'graph');
  assert.ok(p.modal.innerHTML.indexOf('ČHMÚ ALADIN brings no precipitation amount, so there are no bars. Pick a source '
    + 'for it in <button type="button" class="txt-link" data-goto-tab="setup">Setup › Data sources</button>.') !== -1,
  'in the graph\'s dialog, after the row\'s own hint');
});

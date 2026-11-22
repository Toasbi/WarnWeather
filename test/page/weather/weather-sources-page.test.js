// test/page/weather/weather-sources-page.test.js — where the weather comes from, on the settings
// page: the Weather row of Setup › Data sources and its second line; the Weather dialog it opens,
// with the note under the Provider (the readings the watch draws that the Provider has none of,
// which come from Open-Meteo: the source plan's fills, by the phone's own rules) and the weather
// calls a day (the plan's count); and the dialog's Other sources list, its pickers and Use
// another source.
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

const BASALT = platform.computeEnv({ platform: 'basalt' });
// No slot shows UV (a fresh install's radar bar and Watch bar do) and no alert is placed.
const NONE = NOTHING_DRAWN;

/**
 * @param {Object} over Settings over NONE.
 * @returns {string} The note on a basalt.
 */
function note(over) { return page.fillNote(Object.assign({}, NONE, over), BASALT); }

test('the note names what the watch draws that the provider has none of', () => {
  assert.equal(note({ provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' }),
    'Yandex Weather sends no cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note({ provider: 'yandex', secondaryLine: 'dew', thirdLine: 'cloud', statusForecastMid: 'pressure' }),
    'Yandex Weather sends no dew point, cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note({ provider: 'dwd', secondaryLine: 'uv' }), 'DWD sends no UV index, so it comes from Open-Meteo.');
  assert.equal(note({ provider: 'yandex', statusTopMid: 'wind', windSlotDirection: true }),
    'Yandex Weather sends no wind direction, so it comes from Open-Meteo.');
});

test('no note while nothing comes from Open-Meteo', () => {
  assert.equal(note({ provider: 'yandex' }), '', 'nothing it lacks is drawn');
  assert.equal(note({ provider: 'dwd', secondaryLine: 'cloud' }), '', 'DWD sends cloud cover');
  providerFactory.PROVIDER_IDS.filter((id) => providerReadings.READING_IDS.every((r) => providerReadings.serves(id, r)))
    .forEach((id) => {
      assert.equal(note({ provider: id, secondaryLine: 'uv', thirdLine: 'cloud', statusForecastMid: 'dew' }), '', id);
    });
  assert.equal(note({ provider: 'constructor', secondaryLine: 'uv' }), '', 'a stored value the table does not know');
  assert.equal(page.fillNote(null, BASALT), '');
});

const setupTab = schema.tabs.find((t) => t.id === 'setup');
const card = setupTab.sections.find((s) => s.id === 'dataSources');
const dialog = setupTab.sections.find((s) => s.sheetId === 'weatherSources');
const pickers = setupTab.sections.find((s) => s.sheetId === 'weatherSourcePickers');
const sourcePlan = require('../../../src/pkjs/weather/domain/source-plan.js');
const OTHER_FOR = 'weatherOtherSourceFor';

test('the Weather row opens Data sources and the Weather dialog, the Provider first', () => {
  assert.deepEqual(card.items[0], { type: 'sheet', sheetId: 'weatherSources', label: 'Weather',
    hintFrom: { resolver: 'weatherSourcesSummary' } });
  assert.equal(card.items.some((i) => i.messageKey === 'provider'), false, 'the Provider is in the dialog');
  assert.equal(dialog.sheetOnly, true);
  assert.equal(dialog.title, 'Weather');
  assert.equal(dialog.block, 'weatherOtherSources', 'the Other sources list ends the dialog');
  const provider = dialog.items[0];
  assert.equal(provider.messageKey, 'provider');
  assert.equal(provider.label, 'Provider');
  assert.equal(provider.bottomSheet, true, 'its list opens as a sheet over the dialog');
  assert.deepEqual(dialog.items[dialog.items.length - 1], { type: 'subheader', text: 'Other sources' });
});

test('the pickers: one per reading in the table\'s order, then Use another source\'s, none with a row', () => {
  assert.equal(pickers.sheetOnly, true, 'never opened as a dialog of its own');
  const keys = providerReadings.READING_IDS.map(sourcePlan.choiceKey);
  assert.deepEqual(pickers.items.map((i) => i.messageKey), keys.concat([OTHER_FOR]));
  assert.deepEqual(pickers.items.slice(0, -1).map((r) => r.label), ['Current temperature', 'Current feels-like',
    'Weather condition', 'Temperature', 'Feels-like', 'Dew point', 'Rain chance', 'Rain amount', 'Wind speed',
    'Wind gusts', 'Wind direction', 'UV index', 'Cloud cover', 'Air pressure']);
  pickers.items.slice(0, -1).forEach((row, i) => {
    assert.equal(row.type, 'select');
    assert.equal(row.bottomSheet, true, row.messageKey + ': a sheet over the dialog');
    assert.equal(row.defaultValue, '', 'the Provider\'s');
    assert.deepEqual(row.optionsFrom, { resolver: 'weatherValueSources', args: { reading: providerReadings.READING_IDS[i] } });
    assert.equal(row.options, undefined, 'the page builds the list');
    assert.equal(row.uiOnly, undefined, 'stored: the phone reads it (source-plan.js choicesOf)');
  });
  const add = pickers.items[pickers.items.length - 1];
  assert.equal(add.uiOnly, true, 'page-only');
  assert.deepEqual(add.dormantValues, [''], 'it opens with nothing ticked');
  assert.deepEqual(add.nextSelectFrom, { resolver: 'weatherValuePicker' });
  assert.equal(add.onChange, 'weatherOtherSourcePicked');
  ['weatherValueSources', 'weatherFreeValues'].forEach((id) => assert.ok(global.PConf.optionsResolvers.get(id), id));
  assert.equal(global.PConf.nextSelectResolvers.get('weatherValuePicker'), page.valuePicker);
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
    'DWD, feels-like from Met.no and rain amount from Open-Meteo');
  assert.equal(at({ weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceRainAmount: 'metno' }),
    'DWD, feels-like, dew point and rain amount from Met.no', 'three from one provider');
  assert.equal(at({ weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceRainAmount: 'openmeteo' }),
    'DWD, 3 values from Met.no and Open-Meteo', 'three from two: counted');
  assert.equal(at({ weatherSourceCurrentTemp: 'metno', weatherSourceFeels: 'metno', weatherSourceDew: 'metno',
    weatherSourceUv: 'metno' }), 'DWD, 4 values from Met.no');
  assert.equal(line({ provider: 'constructor' }, BASALT), '', 'a stored value the table does not know');
  assert.equal(line(null, BASALT), '');
});

test('the Weather row says a missing or refused key, as the tab\'s dot does', () => {
  require('../../../src/pkjs/page/weather/keys/key-status.js');
  const line = global.PConf.hintResolvers.get('weatherSourcesSummary');
  assert.equal(line({ provider: 'openweathermap', owmApiKey: '' }, BASALT), 'OpenWeatherMap has no API key');
  assert.equal(line({ provider: 'openweathermap', owmApiKey: 'k', weatherSourceFeels: 'metno' }, BASALT),
    'OpenWeatherMap, feels-like from Met.no', 'an untested key asks for nothing');
});

test('Use another source\'s list: the values that still come from the Provider, Right now then Forecast', () => {
  const free = page.freeValues({ provider: 'dwd' });
  assert.deepEqual(free.slice(0, 4), [['Right now', '', { groupHeader: true }],
    ['Current temperature', 'currentTemp', { groupChild: true, groupEnd: false }],
    ['Current feels-like', 'currentFeels', { groupChild: true, groupEnd: false }],
    ['Weather condition', 'condition', { groupChild: true, groupEnd: true }]]);
  assert.deepEqual(free[4], ['Forecast', '', { groupHeader: true }]);
  assert.equal(free.length, 2 + providerReadings.READING_IDS.length);
  assert.deepEqual(free[free.length - 1], ['Air pressure', 'pressure', { groupChild: true, groupEnd: true }]);
  const taken = page.freeValues({ provider: 'dwd', weatherSourceCurrentTemp: 'metno', weatherSourceCurrentFeels: 'metno',
    weatherSourceCondition: 'metno', weatherSourcePressure: 'metno' });
  assert.equal(taken[0][0], 'Forecast', 'no Right now while all three are picked');
  assert.equal(taken.some((o) => o[1] === 'pressure'), false);
  assert.deepEqual(taken[taken.length - 1], ['Cloud cover', 'cloud', { groupChild: true, groupEnd: true }]);
  assert.equal(page.valuePicker({}, BASALT, { value: 'feels' }), 'weatherSourceFeels', 'a pick opens its picker');
  assert.equal(page.valuePicker({}, BASALT, { value: '' }), null, 'a group\'s header names none');
});

test('the note names only what comes from the Provider', () => {
  const S = { provider: 'yandex', secondaryLine: 'cloud', statusForecastMid: 'pressure' };
  assert.equal(note(S), 'Yandex Weather sends no cloud cover or air pressure, so they come from Open-Meteo.');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd' })),
    'Yandex Weather sends no air pressure, so it comes from Open-Meteo.', 'DWD brings the cloud cover');
  assert.equal(note(Object.assign({}, S, { weatherSourceCloud: 'dwd', weatherSourcePressure: 'metno' })), '');
});

test('every provider and reading has its words', () => {
  const words = require('../../../src/pkjs/page/weather/weather-words.js');
  providerFactory.PROVIDER_IDS.forEach((id) => { assert.ok(words.NAMES[id], id); });
  providerReadings.READING_IDS.forEach((id) => { assert.ok(words.WORDS[id], id); });
});

test('the note and the calls line sit under the Provider, ahead of its key note, and show in the dialog', () => {
  const at = dialog.items.findIndex((i) => i.textFrom && i.textFrom.resolver === 'weatherFillNote');
  assert.equal(dialog.items[at - 1].messageKey, 'provider');
  assert.equal(dialog.items[at + 1].textFrom.resolver, 'weatherCallsLine');
  assert.equal(dialog.items[at + 2].textFrom.resolver, 'keyMissingNote');
  assert.equal(dialog.items[at].joinPrevious, true);
  assert.equal(dialog.items[at + 1].joinPrevious, true);
  const p = bootGeneratedPage(Object.assign({ provider: 'yandex', yandexApiKey: 'k', secondaryLine: 'cloud' }, NONE),
    'basalt');
  p.clickTab('setup');
  assert.equal(p.scroll.innerHTML.indexOf('Yandex Weather sends no cloud cover'), -1, 'not on the card');
  p.openEditSheet('weatherSources');
  const body = p.modal.innerHTML;
  assert.ok(body.indexOf('Yandex Weather sends no cloud cover, so it comes from Open-Meteo.') !== -1, 'in the dialog');
  assert.ok(body.indexOf('Open-Meteo.') < body.indexOf('weather calls a day'), 'the note, then the calls line');
});

// --- the Other sources list in the Weather dialog ---------------------------------------------

/**
 * The page on a basalt with the Weather dialog open.
 * @param {Object} over Settings over NONE and DWD.
 * @returns {Object} The page.
 */
function weatherDialog(over) {
  const p = bootGeneratedPage(Object.assign({ provider: 'dwd' }, NONE, over), 'basalt');
  p.clickTab('setup');
  p.openEditSheet('weatherSources');
  return p;
}

test('the list: Use another source alone while everything comes from the Provider', () => {
  const body = weatherDialog({}).modal.innerHTML;
  assert.ok(body.indexOf('<div class="ui-list" role="list" aria-label="Other sources">') !== -1);
  assert.equal((body.match(/class="ui-row wo-row"/g) || []).length, 1, 'one row');
  assert.match(body, /data-select="weatherOtherSourceFor" aria-haspopup="listbox"><span class="wo-txt"><span class="ui-n">Use another source<\/span><span class="ui-d">Everything comes from DWD\.<\/span>/);
  assert.equal(body.indexOf('class="wo-del"'), -1, 'nothing to give back');
});

test('the list: a row for each value from another provider, which opens its picker, and its ×', () => {
  const body = weatherDialog({ weatherSourceFeels: 'metno', weatherSourceWind: 'tomorrowio' }).modal.innerHTML;
  assert.ok(body.indexOf('<button type="button" class="wo-open" data-select="weatherSourceFeels" aria-haspopup="listbox">'
    + '<span class="wo-txt"><span class="ui-n">Feels-like</span><span class="ui-d">Met.no</span></span>') !== -1, body);
  assert.ok(body.indexOf('data-action="weatherPickRemove" data-action-arg="feels" aria-label="Feels-like back to DWD"') !== -1);
  assert.ok(body.indexOf('<span class="ui-n">Wind speed</span><span class="ui-d">Tomorrow.io · no API key</span>') !== -1,
    'a pick without its key says so: the phone asks DWD then');
  assert.ok(body.indexOf('Feels-like') < body.indexOf('Wind speed'), 'in the pickers\' order');
  assert.ok(body.indexOf('The other 12 come from DWD.') !== -1);
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
  assert.equal(p.S[OTHER_FOR], '', 'the value only named the picker');
  assert.equal(p.S.weatherSourceFeels, '', 'still the Provider\'s');
  assert.match(body, /class="ssel-opt on"[^>]*data-select-pick=""/, 'DWD ticked: where it comes from now');
  p.pickOption('weatherSourceFeels', 'metno');
  body = p.modal.innerHTML;
  assert.equal(p.S.weatherSourceFeels, 'metno');
  assert.equal(body.indexOf('class="psheet"'), -1, 'the sheet closed');
  assert.ok(body.indexOf('data-select="weatherSourceFeels"') !== -1, 'the value has its row');
  assert.ok(body.indexOf('The other 13 come from DWD.') !== -1);
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
  assert.ok(p.scroll.innerHTML.indexOf('<div class="hint">DWD, feels-like and rain amount from Met.no</div>') !== -1,
    'Done keeps it, and the Weather row says it');
});

test('a value picked to what becomes the Provider comes from the Provider', async () => {
  const p = weatherDialog({ weatherSourceFeels: 'metno', weatherSourceWind: 'openmeteo' });
  p.openModalSelect('provider');
  p.pickOption('provider', 'metno');
  assert.equal(p.S.weatherSourceFeels, '', 'no pick left behind to come back with another Provider');
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

test('the ×: focus goes to the × now in its place, else the last row\'s, else to Use another source', () => {
  const focused = [];
  const button = (name) => ({ focus() { focused.push(name); } });
  const add = button('add');
  let dels = [];
  let renders = 0;
  const saved = global.document;
  global.document = { getElementById: (id) => (id !== 'modal' ? null : {
    querySelectorAll: (sel) => (sel === '.wo-del' ? dels : []),
    querySelector: (sel) => (sel === '[data-select="' + OTHER_FOR + '"]' ? add : null) }) };
  // The page's handle, as boot() hands it over (engine.js PConf.hooks onReady).
  global.PConf.hooks.runReady({ render: () => { renders += 1; } });
  try {
    const remove = global.PConf.actions.weatherPickRemove;
    const S = { provider: 'dwd', weatherSourceFeels: 'metno', weatherSourceDew: 'metno', weatherSourceWind: 'metno' };
    dels = [button('dew'), button('wind')];   // as the repaint leaves them: Feels-like's row gone
    assert.equal(remove('feels', S), false, 'it repainted the page itself');
    assert.equal(S.weatherSourceFeels, '');
    assert.deepEqual(focused, ['dew'], 'the × now in its place');
    dels = [button('dew')];
    remove('wind', S);
    assert.deepEqual(focused, ['dew', 'dew'], 'the last row\'s, when it was the last');
    dels = [];
    remove('dew', S);
    assert.deepEqual(focused, ['dew', 'dew', 'add'], 'Use another source, when none is left');
    assert.equal(renders, 3);
  } finally {
    global.document = saved;
  }
});

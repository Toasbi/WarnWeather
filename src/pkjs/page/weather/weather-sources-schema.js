// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. Where the weather comes
// from, split out of schema.js like alerts-schema.js: the Weather row of Setup › Data sources,
// which opens the Weather dialog (schema.js, its section 'weatherSources'); the Provider picker's
// options and the notes under it (the readings it lacks that come from Open-Meteo, the calls a
// day); and the pickers of the dialog's Other sources list. Their texts and options are
// weather-sources-page.js's. Plain CommonJS: the schema is built in PKJS and reaches the page as
// data.

var providerReadings = require('../../weather/domain/provider-readings.js');
var sourcePlan = require('../../weather/domain/source-plan.js');
// Each reading as a sentence names it; a picker's title is the same words, capitalized.
var WORDS = require('./weather-words.js').WORDS;
var html = require('../../config-ui/lib/html.js');

// The weather providers as the Provider picker lists them, alphabetical by name. The 3rd tuple
// slot's desc is the short "what it's best at" tag shown under each name in the list; DWD
// carries a `short` so the row reads "DWD" while the list keeps the full name.
var PROVIDER_OPTIONS = [
    ['Deutscher Wetterdienst', 'dwd', {desc: 'Best in Germany · no key', short: 'DWD'}],
    ['Met.no', 'metno', {desc: 'Best in the Nordics (behind yr.no) · no key'}],
    ['Open-Meteo', 'openmeteo', {desc: 'Picks the best national model · no key'}],
    ['OpenWeatherMap', 'openweathermap', {desc: 'Popular general-purpose API, worldwide · needs a free key'}],
    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise local forecasts, worldwide · needs a free key'}],
    ['Weather Underground', 'wunderground', {desc: 'Crowd-sourced network of 250,000+ local stations · no key'}],
    ['Yandex Weather', 'yandex', {desc: 'Best across Russia & CIS · needs a key'}]
];

// The Data sources row that opens the Weather dialog. Its second line says where the weather
// comes from: the Provider and each value from another source (weatherSourcesSummary).
var WEATHER_ROW = {
    type: 'sheet',
    sheetId: 'weatherSources',
    label: 'Weather',
    hintFrom: {resolver: 'weatherSourcesSummary'}
};

// The pickers of the Weather dialog's Other sources list, which have no rows of their own: the
// list's rows and its Use another source row open them over the dialog (weather-sources-page.js
// weatherOtherSources). One per value (provider-readings.js READINGS), its provider or '' for the
// Provider's; the phone reads them through source-plan.js choicesOf. Their options come from the
// page (weatherValueSources): the settings URL carries one short line per picker instead of
// fourteen lists. Then Use another source's own (page-only): the values that still come from the
// Provider, each opening that value's picker and storing nothing (its option's `next`:
// weatherFreeValues), so nothing changes until a provider is picked. Its '' is dormant: the list
// opens with nothing ticked.
var SOURCE_PICKERS = providerReadings.READING_IDS.map(function (id) {
    return {
        type: 'select',
        bottomSheet: true,
        messageKey: sourcePlan.choiceKey(id),
        label: html.capitalize(WORDS[id]),
        defaultValue: '',
        optionsFrom: {resolver: 'weatherValueSources', args: {reading: id}}
    };
}).concat([{
    type: 'select',
    bottomSheet: true,
    uiOnly: true,
    messageKey: 'weatherOtherSourceFor',
    label: 'Use another source for',
    defaultValue: '',
    dormantValues: [''],
    optionsFrom: {resolver: 'weatherFreeValues'}
}]);

// The readings the Provider lacks that a screen draws, said under its row: they come from
// Open-Meteo. A plain note joined to the row, like its hint; textFrom answers '' when none do,
// and the note is gone.
var FILL_NOTE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherFillNote'}
};

// The weather calls a day the choices come to (weather-sources-page.js weatherCallsLine): under
// the Provider in the Weather dialog, and under Update interval at the end of Data sources.
var CALLS_LINE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherCallsLine'}
};

module.exports = { PROVIDER_OPTIONS: PROVIDER_OPTIONS, WEATHER_ROW: WEATHER_ROW, SOURCE_PICKERS: SOURCE_PICKERS,
    FILL_NOTE: FILL_NOTE, CALLS_LINE: CALLS_LINE };

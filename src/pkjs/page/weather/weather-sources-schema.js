// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. The rows of Setup › Data
// sources that say where the weather comes from, split out of schema.js like alerts-schema.js:
// the Weather picker's options, the note under it that names what comes from Open-Meteo (its
// text is weather-sources-page.js's weatherFillNote), the reading rows and the weather calls
// line at the section's end. Plain CommonJS: the schema is built in PKJS and reaches the page as
// data.

var providerReadings = require('../../weather/domain/provider-readings.js');
var sourcePlan = require('../../weather/domain/source-plan.js');
// Each reading as a sentence names it; a row's label is the same words, capitalized.
var WORDS = require('./weather-words.js').WORDS;
var html = require('../../config-ui/lib/html.js');

// The weather providers as the Weather picker lists them, alphabetical by name. The 3rd tuple
// slot's desc is the short "what it's best at" tag shown under each name in the dropdown; DWD
// carries a `short` so the trigger reads "DWD" while the list keeps the full name.
var PROVIDER_OPTIONS = [
    ['Deutscher Wetterdienst', 'dwd', {desc: 'Best in Germany · no key', short: 'DWD'}],
    ['Met.no', 'metno', {desc: 'Best in the Nordics (behind yr.no) · no key'}],
    ['Open-Meteo', 'openmeteo', {desc: 'Picks the best national model · no key'}],
    ['OpenWeatherMap', 'openweathermap', {desc: 'Popular general-purpose API, worldwide · needs a free key'}],
    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise local forecasts, worldwide · needs a free key'}],
    ['Weather Underground', 'wunderground', {desc: 'Crowd-sourced network of 250,000+ local stations · no key'}],
    ['Yandex Weather', 'yandex', {desc: 'Best across Russia & CIS · needs a key'}]
];

// The reading rows, one per reading (provider-readings.js READINGS, labelled by weather-words.js
// WORDS), each its provider or Same as Weather (''); the phone reads them through source-plan.js
// choicesOf. A row's options come from the page (weather-sources-page.js weatherReadingOptions):
// the settings URL carries one short line per row instead of fourteen lists.
var READING_ROWS = providerReadings.READING_IDS.map(function (id) {
    return {
        type: 'select',
        messageKey: sourcePlan.choiceKey(id),
        label: html.capitalize(WORDS[id]),
        defaultValue: '',
        optionsFrom: {resolver: 'weatherReadingOptions', args: {reading: id}}
    };
});

// The readings the picked provider lacks that a screen draws, said under the Weather row: they
// come from Open-Meteo. A plain note joined to the row, like its hint; textFrom answers '' when
// none do, and the note is gone.
var FILL_NOTE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherFillNote'}
};

// The weather calls a day the section's choices come to, its last line, joined to the Update
// interval row above it (weather-sources-page.js weatherCallsLine).
var CALLS_LINE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherCallsLine'}
};

module.exports = { PROVIDER_OPTIONS: PROVIDER_OPTIONS, READING_ROWS: READING_ROWS, FILL_NOTE: FILL_NOTE,
    CALLS_LINE: CALLS_LINE };

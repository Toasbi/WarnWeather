// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. The rows of Setup › Data
// sources that say where the weather comes from, split out of schema.js like alerts-schema.js:
// the Weather picker's options, the Weather from row above the picker, the note under it that
// names what comes from Open-Meteo (its text is weather-sources-page.js's weatherFillNote), Per
// reading's rows and the weather calls line at the section's end. Plain CommonJS: the schema is
// built in PKJS and reaches the page as data.

var providerReadings = require('../../weather/domain/provider-readings.js');
var sourcePlan = require('../../weather/domain/source-plan.js');
// Each reading as a sentence names it; a row's label is the same words, capitalized.
var WORDS = require('./weather-sources-page.js').WORDS;

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

// Where the forecast comes from (weatherSourceMode, read by the phone's source plan:
// weather/domain/source-plan.js candidates), the Location row's pattern. One provider is the
// Weather picker's, as before the row; By location asks the place's regional provider first.
// Its hint says what By location does, and that what a provider lacks comes from Open-Meteo,
// which the note under the picker cannot name there: the page does not know the place.
var WEATHER_FROM = {
    type: 'segmented',
    messageKey: 'weatherSourceMode',
    label: 'Weather from',
    defaultValue: 'one',
    hintByValue: {
        auto: 'Uses DWD in Germany, Met.no in the Nordic countries and the Weather provider below everywhere '
            + 'else. When one fails, the next one fills in, with Open-Meteo last. A reading a provider lacks '
            + 'comes from Open-Meteo.',
        reading: 'Each reading below can come from its own provider. Same as Weather uses the Weather '
            + 'provider, which also fills in when a reading\'s provider fails. A reading a provider lacks '
            + 'comes from Open-Meteo.'
    },
    options: [['One provider', 'one'], ['By location', 'auto'], ['Per reading', 'reading']]
};

// Per reading's rows, one per reading (provider-readings.js READINGS, labelled by
// weather-sources-page.js WORDS), each its provider or Same as Weather (''), shown while Weather
// from is Per reading; the phone reads them through source-plan.js choicesOf. A row's options
// come from the page (weather-sources-page.js weatherReadingOptions): the settings URL carries
// one short line per row instead of nine lists. The rows whose reading brings more than its name
// says say what.
var READING_HINTS = {
    temperature: 'Also brings the feels-like temperature. The other readings line up with its hours.',
    rain: 'Brings the chance of rain and the amount.',
    wind: 'Also brings the gusts.'
};
var READING_ROWS = providerReadings.READING_IDS.map(function (id) {
    var row = {
        type: 'select',
        messageKey: sourcePlan.choiceKey(id),
        label: WORDS[id].charAt(0).toUpperCase() + WORDS[id].slice(1),
        defaultValue: '',
        optionsFrom: {resolver: 'weatherReadingOptions', args: {reading: id}},
        showWhen: {key: 'weatherSourceMode', eq: 'reading'}
    };
    if (READING_HINTS[id]) { row.hint = READING_HINTS[id]; }
    return row;
});

// The readings the picked provider lacks that a screen draws, said under the Weather row: they
// come from Open-Meteo. A plain note joined to the row, like its hint; textFrom answers '' when
// none do, and in By location, and the note is gone.
var FILL_NOTE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherFillNote'}
};

// The weather calls a day the section's choices come to, its last line, joined to the Update
// interval row above it (blocks.js weatherCallsLine, worded by weather-sources-page.js callsLine).
var CALLS_LINE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherCallsLine'}
};

module.exports = { PROVIDER_OPTIONS: PROVIDER_OPTIONS, WEATHER_FROM: WEATHER_FROM, READING_ROWS: READING_ROWS,
    FILL_NOTE: FILL_NOTE, CALLS_LINE: CALLS_LINE };

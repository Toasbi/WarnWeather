// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. Where the weather comes
// from, split out of schema.js like alerts-schema.js: the Weather row of Setup › Data sources,
// and the Weather dialog it opens (dialogSections, which schema.js puts after the card): the
// Provider picker with its options and its texts, the notes under it (the readings it lacks that
// come from Open-Meteo, the calls a day), its key row, and the pickers of the dialog's Other
// sources list. The notes' texts and the pickers' options are weather-sources-page.js's. Plain
// CommonJS: the schema is built in PKJS and reaches the page as data.

var providerReadings = require('../../weather/domain/provider-readings.js');
var sourcePlan = require('../../weather/domain/source-plan.js');
// A picker's title: its reading's name (weather-words.js label).
var words = require('./weather-words.js');

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

// Tomorrow.io's credit, which its terms ask for where its data is picked: its rationale below,
// and the Rain radar's (schema.js).
var TOMORROWIO_CREDIT = 'Powered by <a target=\'_blank\' href=\'https://www.tomorrow.io\'>Tomorrow.io</a>.';

// Per-provider "why it's best" note: the Provider's hintByValue, so only the picked provider's
// rationale renders. The hinted-row wrap layout flows it around the trigger and gives it the full
// row width below. The short tags are the options' descs (PROVIDER_OPTIONS).
var PROVIDER_WHY = {
    dwd: 'Germany\'s national weather service, with the most accurate forecasts in Germany and decent ones across Central Europe (ICON model). No API key needed.',
    metno: 'The service behind yr.no. Best in the Nordics, with a 2.5 km model, and solid worldwide. No API key needed.',
    openmeteo: 'Automatically picks the best national model for your location (DWD, NOAA, Météo-France, ECMWF…). Free, no API key.',
    openweathermap: 'A popular general-purpose API with solid worldwide coverage. Needs a free API key on the One Call 3.0 plan.',
    tomorrowio: 'Minute-by-minute forecasts for your exact location, worldwide, from its own machine-learning models and satellites. Needs a free API key. ' + TOMORROWIO_CREDIT,
    wunderground: 'A crowd-sourced network of 250,000+ personal weather stations, with many readings close to you. Strongest in the US and Europe. No API key needed.',
    yandex: 'Best across Russia and the CIS, using the Meteum machine-learning forecast. Needs an API key.'
};

// The Data sources row that opens the Weather dialog. Its second line says where the weather
// comes from: the Provider and each value from another source (weatherSourcesSummary). A key the
// Provider is missing or that is known to be rejected puts a dot on the tab and a dialog in front
// of Save ("Add key" / "Save anyway"); the row says it too. The row sits in the card ahead of the
// Rain radar's, so the Save dialog asks for the weather key first.
var WEATHER_ROW = {
    type: 'sheet',
    sheetId: 'weatherSources',
    label: 'Weather',
    hintFrom: {resolver: 'weatherSourcesSummary'},
    attentionFrom: {resolver: 'keyAttention', args: {picker: 'provider'}}
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
        messageKey: sourcePlan.choiceKey(id),
        label: words.label(id),
        defaultValue: '',
        optionsFrom: {resolver: 'weatherValueSources', args: {reading: id}}
    };
}).concat([{
    type: 'select',
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

/**
 * The Weather dialog's sections. The dialog, opened by the Weather row (WEATHER_ROW): the
 * Provider, which serves the forecast, its notes and its key row; then Other sources, the values
 * that come from another provider (block weatherOtherSources, weather-sources-page.js). Every
 * list opens as a sheet over the dialog (engine renderPickSheet).
 * Then the pickers' own section (SOURCE_PICKERS), which has no rows: the list opens them over
 * the dialog. Never opened as a dialog itself (sheetOnly): the values hydrate and serialize with
 * the blob, as graphStyleKeys does for New graph.
 * @param {function(string, ?Object): Object} keyRow schema.js keyRow: the row under a picker
 *   that opens its key's dialog.
 * @returns {Object[]} Schema sections (sheetOnly).
 */
function dialogSections(keyRow) {
    return [{
        sheetOnly: true,
        sheetId: 'weatherSources',
        title: 'Weather',
        block: 'weatherOtherSources',
        items: [{
            type: 'select',
            messageKey: 'provider',
            label: 'Provider',
            defaultValue: 'wunderground',
            // The pollen source follows the provider (blocks.js); a value picked to the new
            // Provider, or left at the old one, comes from the Provider (weather-sources-page.js).
            onChange: ['clearPollenForProvider', 'weatherProviderPicked'],
            // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no,
            // else→Open-Meteo), reading the same country→provider map the wizard uses. See
            // blocks.js recommend resolvers.
            recommendFrom: 'recommendedWeatherProvider',
            hintByValue: PROVIDER_WHY,
            // A provider that needs a key gets its key row under this one (keyRow), which opens
            // its key dialog: the key field, its Test, the links and any budget guard live there.
            // The missing-key note is the staticText below the calls line.
            options: PROVIDER_OPTIONS
        }, FILL_NOTE, CALLS_LINE, {
            // The keyed provider's empty key, said where it cannot be missed: an amber note
            // hugging the row, only while the picked provider's key is blank (textFrom answers ''
            // otherwise and the note is gone, divider and all).
            type: 'staticText',
            style: 'info',
            joinPrevious: true,
            textFrom: {resolver: 'keyMissingNote', args: {picker: 'provider'}}
        }, keyRow('provider', null), {type: 'subheader', text: 'Other sources'}]
    }, {
        sheetOnly: true,
        sheetId: 'weatherSourcePickers',
        title: 'Other sources',
        items: SOURCE_PICKERS
    }];
}

module.exports = { TOMORROWIO_CREDIT: TOMORROWIO_CREDIT, PROVIDER_OPTIONS: PROVIDER_OPTIONS, PROVIDER_WHY: PROVIDER_WHY,
    WEATHER_ROW: WEATHER_ROW, SOURCE_PICKERS: SOURCE_PICKERS, FILL_NOTE: FILL_NOTE, CALLS_LINE: CALLS_LINE,
    dialogSections: dialogSections };

// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. The rows of Setup › Data
// sources that say where the weather comes from, split out of schema.js like alerts-schema.js:
// the Weather from row above the Weather picker, and the note under the picker that names what
// comes from Open-Meteo (its text is weather-sources-page.js's weatherFillNote). Plain CommonJS:
// the schema is built in PKJS and reaches the page as data.

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
            + 'comes from Open-Meteo.'
    },
    options: [['One provider', 'one'], ['By location', 'auto']]
};

// The readings the picked provider lacks that a screen draws, said under the Weather row: they
// come from Open-Meteo. A plain note joined to the row, like its hint; textFrom answers '' when
// none do, and in By location, and the note is gone.
var FILL_NOTE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherFillNote'}
};

module.exports = { WEATHER_FROM: WEATHER_FROM, FILL_NOTE: FILL_NOTE };

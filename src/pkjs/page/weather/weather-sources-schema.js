// src/pkjs/page/weather/weather-sources-schema.js — ES5, PKJS-parsed. The rows of Setup › Data
// sources that say where the weather comes from, split out of schema.js like alerts-schema.js:
// for now the note under the Weather picker that names what comes from Open-Meteo. Its text is
// weather-sources-page.js's (weatherFillNote). Plain CommonJS: the schema is built in PKJS and
// reaches the page as data.

// The readings the picked provider lacks that a screen draws, said under the Weather row: they
// come from Open-Meteo. A plain note joined to the row, like its hint; textFrom answers '' when
// none do, and the note is gone.
var FILL_NOTE = {
    type: 'staticText',
    joinPrevious: true,
    textFrom: {resolver: 'weatherFillNote'}
};

module.exports = { FILL_NOTE: FILL_NOTE };

// src/pkjs/settings/key-sources.js — ES5, PKJS-parsed. The keyed sources: for each picker
// whose options include sources that need the user's own API key (the Weather provider
// row's OpenWeatherMap, Tomorrow.io and Yandex Weather; the Radar provider row's "Rainbow
// (own key)" and Tomorrow.io), those sources and what goes missing without a working key.
// One table per picker, by the picker's messageKey:
//   {outcome, sources: {<the picker's value>: source}}
// It is the table every key-status resolver on the picker's row reads (settings/
// key-status.js, which defines the key's states) and the key sheets are built from
// (schema.js keySheetSection): schema.js hands it to the row's resolvers in their args.
// A picker value missing from `sources` has no key: its row shows no Edit button and no
// key status.
//
// `outcome` is what goes missing without a working key; it ends the missing-key note's and
// the Save dialog's sentence ("Without one, the watch gets no forecast.").
//
// A source:
//   name           Its name as the dropdown shows it: its key sheet's title and the Save
//                  dialog's.
//   sheetId        The key sheet the Edit button after the dropdown opens.
//   keyField       The field (messageKey) that sheet stores the key in.
//   test           Whether that field has a Test button; the summary then says "not
//                  tested yet" for a key it knows nothing about.
//   reasons?       A refusal's short reason by HTTP status, where key-status.js's default
//                  ("invalid key", "no access") says less.
//   usage?         A usage line the summary appends, by name (blocks.js registers
//                  tomorrow.io's projected calls and Rainbow's monthly projection).
//   updateId?      The provider id the phone's update records name, when it is not the
//                  picker's value (no source sets one today).
//   evidence?      'radar': the key never rides a weather update, so its update evidence
//                  is the last radar update's verdict (userData.radarKeyResult,
//                  weather/radar-key-result.js) instead of the weather update records.
//   radarEvidence? A radar source whose key is a weather provider's too: it reads that
//                  provider's update records, and the verdict of this radar source
//                  (recorded by tomorrowio-radar.js) answers when no weather update says
//                  anything about the key (the radar runs it alone).
//   sharedSheet?   {key, eq, sheetId}: while settings[key] === eq the other picker picks
//                  the source too, its own sheet is gated off, and the key lives in
//                  sheetId, which the Edit button and the Save dialog then open.
// A key two pickers share (the Tomorrow.io key) is one key with one verdict: both sources
// name the same keyField and read the same evidence, so they show one state.
//
// Plain CommonJS, like schema.js: the schema is built in PKJS and reaches the page as data,
// these tables inside the rows' resolver args.

// The weather providers that need an API key, by their `provider` value.
var PROVIDER_SOURCES = {
    openweathermap: {name: 'OpenWeatherMap', sheetId: 'providerKeyOwm', keyField: 'owmApiKey', test: true,
        // OpenWeatherMap answers 401 for a wrong key AND for one not on the One Call 3.0 plan.
        reasons: {401: 'not valid for One Call 3.0'}},
    tomorrowio: {name: 'Tomorrow.io', sheetId: 'providerKeyTomorrowio', keyField: 'tomorrowioApiKey', test: true,
        reasons: {403: 'no access to this data'}, usage: 'tomorrowio'},
    yandex: {name: 'Yandex Weather', sheetId: 'providerKeyYandex', keyField: 'yandexApiKey', test: false}
};

// The radar sources that need the user's own key, by their `radarProvider` value.
// "Rainbow (own key)": its key never rides a weather update, so its status comes from the
// Test button and the last radar update's verdict; its usage line is the monthly
// projection. Tomorrow.io: its key is the Tomorrow.io weather provider's, so its entry IS
// that provider's (name, key field, Test, reasons, the daily usage line and the weather
// updates' evidence) with only the sheet changed, plus the radar's own verdicts. Radar-only,
// the key lives in the Radar tab's own Tomorrow.io sheet; while Tomorrow.io is the weather
// provider too, the General tab's sheet holds it (sharedSheet), so the Radar row's Edit
// button and Save dialog open that one, and its summary and tab dot read the Weather
// provider row's state.
var RADAR_SOURCES = {
    rainbowkey: {name: 'Rainbow', sheetId: 'radarKeyRainbow', keyField: 'rainbowApiKey', test: true,
        usage: 'rainbow', evidence: 'radar'},
    tomorrowio: Object.assign({}, PROVIDER_SOURCES.tomorrowio, {sheetId: 'radarKeyTomorrowio', radarEvidence: 'tomorrowio',
        sharedSheet: {key: 'provider', eq: 'tomorrowio', sheetId: PROVIDER_SOURCES.tomorrowio.sheetId}})
};

module.exports = {
    provider: {outcome: 'the watch gets no forecast', sources: PROVIDER_SOURCES},
    radarProvider: {outcome: 'the watch gets no rain radar', sources: RADAR_SOURCES}
};

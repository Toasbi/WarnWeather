// src/pkjs/settings/key-sources.js — ES5, PKJS + settings webview. The keyed sources: for
// each picker whose options include sources that need the user's own API key (the Weather
// provider row's OpenWeatherMap, Tomorrow.io and Yandex Weather; the Radar provider row's
// "Rainbow (own key)" and Tomorrow.io), those sources and what goes missing without a
// working key. One table per picker, by the picker's messageKey:
//   {outcome, sources: {<the picker's value>: source}}
// It is the table every key-status resolver on the picker's row reads (settings/
// key-status.js, which defines the key's states, looks it up by the row's messageKey, or
// by args.picker for the missing-key note, a staticText without one) and the key sheets
// are built from (schema.js keySheetSection). So the rows' resolvers carry no args of
// their own, and the table reaches the page once, as code, not inside each row's schema.
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
//   sharedSheet?   {key, eq, sheetId}: while settings[key] === eq the other picker picks
//                  the source too, its own sheet is gated off, and the key lives in
//                  sheetId, which the Edit button and the Save dialog then open.
// A key two pickers share (the Tomorrow.io key) is one key with one verdict: both sources
// name the same keyField and the same source id, so they show one state.
//
// Loaded on both sides: schema.js requires it (PKJS builds the schema, the key sheets
// included), and the settings page concatenates it ahead of key-status.js, which reads it
// as window.KeySources (scripts/build-config-page.js).
(function () {
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
    // Test button and the radar's answers to it (kept under 'rainbowkey'); its usage line is
    // the monthly projection. Tomorrow.io: its key is the Tomorrow.io weather provider's, so
    // its entry IS that provider's (name, key field, Test, reasons, the daily usage line)
    // with only the sheet changed; the weather updates and the radar requests keep their
    // answers under the one id 'tomorrowio', so the newest of them is the key's verdict on
    // both rows. Radar-only, the key lives in the Radar tab's own Tomorrow.io sheet; while
    // Tomorrow.io is the weather provider too, the General tab's sheet holds it (sharedSheet),
    // so the Radar row's Edit button and Save dialog open that one, and its summary and tab
    // dot read the Weather provider row's state.
    var RADAR_SOURCES = {
        rainbowkey: {name: 'Rainbow', sheetId: 'radarKeyRainbow', keyField: 'rainbowApiKey', test: true,
            usage: 'rainbow'},
        tomorrowio: Object.assign({}, PROVIDER_SOURCES.tomorrowio, {sheetId: 'radarKeyTomorrowio',
            sharedSheet: {key: 'provider', eq: 'tomorrowio', sheetId: PROVIDER_SOURCES.tomorrowio.sheetId}})
    };

    var api = {
        provider: {outcome: 'the watch gets no forecast', sources: PROVIDER_SOURCES},
        radarProvider: {outcome: 'the watch gets no rain radar', sources: RADAR_SOURCES}
    };

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.KeySources = api; }
})();

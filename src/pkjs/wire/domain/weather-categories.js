/**
 * The weather message's categories: each maps a last-sent cache key to the AppMessage keys
 * it carries, matching one screen area on the watch. The outbox dedupes and sends by them;
 * the status re-bake sends only the 'status' one's keys.
 */

var KEYS = require('../../settings/domain/storage-keys');
var radarDedupe = require('../../weather/domain/radar/radar-dedupe');

var WEATHER_CATEGORIES = [
    {
        name: 'forecast',
        cacheKey: KEYS.LAST_SENT_FORECAST_KEY,
        // Values only: the line colours + fill flag are settings-derived and ride the
        // Clay message (CLAY_LINE_STYLE_UINT8), not this one. SPARE_LINE_TREND_UINT8: the
        // graph styles' spare row (emery, forecast-series.js), present only while the shown
        // graph styles draw five series between them.
        keys: ['TEMP_TREND_UINT8','TEMP_MIN','TEMP_MAX','SECONDARY_LINE_TREND_UINT8','BAR_TREND_UINT8','THIRD_LINE_TREND_UINT8','FOURTH_LINE_TREND_UINT8','FIFTH_LINE_TREND_UINT8','SPARE_LINE_TREND_UINT8','FORECAST_START','NUM_ENTRIES']
    },
    {
        name: 'status',
        cacheKey: KEYS.LAST_SENT_STATUS_KEY,
        // STATUS_LINE_5..7_UINT8: bars 4 to 6's lines (Pebble Time 2, status-lines.js),
        // present only while the bar is made.
        keys: ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8',
               'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8',
               'STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8',
               'STATUS_LEVELS_UINT8', 'ALERT_ENTRIES_UINT8']
    },
    {
        name: 'sun',
        cacheKey: KEYS.LAST_SENT_SUN_KEY,
        keys: ['SUN_EVENTS']
    },
    {
        name: 'radar',
        cacheKey: KEYS.LAST_SENT_RADAR_KEY,
        // RAIN_RADAR_LIMITED (the radar notice's line, radar-wire.js): the limit
        // notice rides without the three arrays, the out-of-coverage one with the
        // clear; the comparator dedupes a repeat of either.
        keys: ['RAIN_RADAR_TREND_UINT8', 'RAIN_RADAR_TREND_AREA_UINT8', 'RAIN_RADAR_START',
               'RAIN_RADAR_LIMITED'],
        comparator: radarDedupe.radarComparator
    },
    {
        // The radar's sky rows (radar-sky.js): an absolute-start blob, so an
        // exact compare is right — it only changes when the sky or its slot does.
        name: 'sky',
        cacheKey: KEYS.LAST_SENT_SKY_KEY,
        keys: ['RADAR_SKY_UINT8']
    },
    {
        name: 'sleep',
        cacheKey: KEYS.LAST_SENT_SLEEP_KEY,
        keys: ['IS_SLEEPING']
    },
    {
        name: 'notice',
        cacheKey: KEYS.LAST_SENT_NOTICE_KEY,
        keys: ['NOTICE_TEXT']
    }
];

module.exports = WEATHER_CATEGORIES;

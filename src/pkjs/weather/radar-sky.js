// src/pkjs/weather/radar-sky.js — ES5. The radar's sky rows: cloud cover,
// sunshine and lightning for the radar's 2-hour window, in 15-minute slots.
//
// A small source family of its own (the radar-factory.js / air-quality.js shape),
// independent of both the forecast provider and the rain-radar source, so more
// sources can join later (a real lightning feed through the rainbow proxy, say).
// The first one is Open-Meteo's `minutely_15` product.
//
// Wire: one RADAR_SKY_UINT8 byte array, its own outbox category — layout in
// src/c/appendix/radar_sky.h, packed here by packSky. It carries an ABSOLUTE
// start epoch, so the watch places the rows by time against whatever radar
// window it holds (the radar category can be deduped out of a send, and the
// watch self-advances the radar between fetches).

var WeatherProvider = require('./provider.js');
var radarWire = require('./radar-wire.js');

var SLOT_SECONDS = 15 * 60;
// Slots that always cover the radar window: 120 min from a 5-min pinned slot 0
// spans at most nine quarter-hours when slot 0 is not itself on a quarter hour.
var NUM_SLOTS = Math.ceil((radarWire.NUM_BARS * radarWire.SLOT_SECONDS + SLOT_SECONDS - radarWire.SLOT_SECONDS)
    / SLOT_SECONDS);
// The stripe wire scale (forecast-series.js permilleToByte's 0..250).
var FULL_SCALE = 250;
// WMO weather codes for a thunderstorm (95 slight/moderate, 96/99 with hail).
var THUNDER_CODES = [95, 96, 99];
// Lightning potential (J/kg) at or above which a slot counts as lightning. Only
// ICON-D2 (Central Europe) reports it; elsewhere it is absent and the weather
// code decides alone. A tunable judgement call, not a published cut-off.
var LIGHTNING_POTENTIAL_MIN = 1;

var OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * The quarter-hour that slot 0 of the sky starts on: the one containing the
 * radar's slot-0 epoch.
 * @param {number} slotZeroEpoch The radar's 5-min pinned slot-0 epoch (seconds).
 * @returns {number} Epoch seconds, a multiple of SLOT_SECONDS.
 */
function skyStartFor(slotZeroEpoch) {
    return Math.floor(slotZeroEpoch / SLOT_SECONDS) * SLOT_SECONDS;
}

/**
 * The Open-Meteo request for the sky rows: 15-minute cloud cover, sunshine,
 * lightning potential and weather code, in unix time. One quarter-hour of the
 * past too, so the current slot is there even just after a boundary.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Request URL.
 */
function buildOpenMeteoSkyUrl(lat, lon) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&minutely_15=cloud_cover,sunshine_duration,lightning_potential,weather_code'
        + '&past_minutely_15=1'
        + '&forecast_minutely_15=' + (NUM_SLOTS + 1)
        + '&timeformat=unixtime'
        + '&timezone=GMT';
}

/**
 * Scale a 0..max reading to the 0..250 stripe wire scale, clamped; a missing
 * reading (null, NaN) is 0.
 * @param {*} v Raw reading.
 * @param {number} max Reading that maps to full scale.
 * @returns {number} Byte 0..250.
 */
function toByte(v, max) {
    var n = Number(v);
    if (v === null || v === undefined || !isFinite(n) || n <= 0) { return 0; }
    return Math.min(FULL_SCALE, Math.round(n / max * FULL_SCALE));
}

/**
 * Whether one 15-minute slot has lightning: a thunderstorm weather code, or a
 * lightning potential at or above LIGHTNING_POTENTIAL_MIN.
 * @param {*} code WMO weather code.
 * @param {*} potential Lightning potential in J/kg (absent outside ICON-D2).
 * @returns {boolean} True for lightning.
 */
function isLightning(code, potential) {
    if (THUNDER_CODES.indexOf(Number(code)) !== -1) { return true; }
    var p = Number(potential);
    return potential !== null && potential !== undefined && isFinite(p) && p >= LIGHTNING_POTENTIAL_MIN;
}

/**
 * Map an Open-Meteo minutely_15 response onto the sky slots, by timestamp:
 * slot k is the bucket stamped start + k * 15 min (Open-Meteo stamps a bucket
 * with its START). A slot the response lacks reads as clear, sunless and calm.
 * @param {Object} json Parsed Open-Meteo response.
 * @param {number} slotZeroEpoch The radar's 5-min pinned slot-0 epoch.
 * @returns {?{start: number, clouds: number[], suns: number[], bolts: boolean[]}}
 *   The sky, or null for a response without a usable minutely_15 block.
 */
function mapOpenMeteoSky(json, slotZeroEpoch) {
    var m = json && json.minutely_15;
    if (!m || !Array.isArray(m.time)) { return null; }
    var start = skyStartFor(slotZeroEpoch);
    var byTime = {};
    for (var i = 0; i < m.time.length; i += 1) { byTime[m.time[i]] = i; }
    var pick = function (field, idx) {
        return Array.isArray(m[field]) ? m[field][idx] : null;
    };
    var sky = { start: start, clouds: [], suns: [], bolts: [] };
    var found = 0;
    for (var k = 0; k < NUM_SLOTS; k += 1) {
        var idx = byTime[start + k * SLOT_SECONDS];
        if (idx === undefined) {
            sky.clouds.push(0);
            sky.suns.push(0);
            sky.bolts.push(false);
            continue;
        }
        found += 1;
        sky.clouds.push(toByte(pick('cloud_cover', idx), 100));
        sky.suns.push(toByte(pick('sunshine_duration', idx), SLOT_SECONDS));
        sky.bolts.push(isLightning(pick('weather_code', idx), pick('lightning_potential', idx)));
    }
    return found > 0 ? sky : null;
}

/**
 * Pack a sky for the wire (src/c/appendix/radar_sky.h's layout): start epoch
 * (uint32 LE), slot count, the cloud bytes, the sun bytes, the lightning
 * bitmask (uint16 LE, bit k = slot k).
 * @param {{start: number, clouds: number[], suns: number[], bolts: boolean[]}} sky Mapped sky.
 * @returns {number[]} RADAR_SKY_UINT8 bytes.
 */
function packSky(sky) {
    var n = sky.clouds.length;
    var out = [sky.start & 0xFF, (sky.start >>> 8) & 0xFF, (sky.start >>> 16) & 0xFF,
        (sky.start >>> 24) & 0xFF, n];
    var k, mask = 0;
    for (k = 0; k < n; k += 1) { out.push(sky.clouds[k]); }
    for (k = 0; k < n; k += 1) { out.push(sky.suns[k]); }
    for (k = 0; k < n; k += 1) { if (sky.bolts[k]) { mask |= (1 << k); } }
    out.push(mask & 0xFF, (mask >>> 8) & 0xFF);
    return out;
}

/**
 * The tuple that removes the sky rows from the watch (the toggle is off, or the
 * radar graph is not shown).
 * @returns {{RADAR_SKY_UINT8: number[]}} An empty blob.
 */
function clearSkyTuple() {
    return { RADAR_SKY_UINT8: [] };
}

var DEFAULT_SKY_ID = 'disabled';

var SKY_FACTORIES = {
    openmeteo: function () {
        return {
            /**
             * Fetch the sky for the radar window. A transport or parse failure is
             * transient (null): the key stays out of the send and the watch keeps
             * the rows it has, which slide out of the window by themselves.
             * @param {number} lat Latitude.
             * @param {number} lon Longitude.
             * @param {number} slotZeroEpoch The radar's slot-0 epoch.
             * @param {function(?Object)} cb Receives {RADAR_SKY_UINT8} or null.
             * @returns {void}
             */
            fetchSkyTupleAt: function (lat, lon, slotZeroEpoch, cb) {
                WeatherProvider.request(buildOpenMeteoSkyUrl(lat, lon), 'GET', function (response) {
                    var sky = null;
                    try {
                        sky = mapOpenMeteoSky(JSON.parse(response), slotZeroEpoch);
                    }
                    catch (ex) {
                        console.log('[!] Open-Meteo sky: response parse error');
                    }
                    cb(sky ? { RADAR_SKY_UINT8: packSky(sky) } : null);
                }, function (error) {
                    console.log('[!] Open-Meteo sky fetch failed: ' + JSON.stringify(error));
                    cb(null);
                });
            }
        };
    },
    disabled: function () {
        return {
            /**
             * Clear the watch's sky rows.
             * @param {number} lat Unused.
             * @param {number} lon Unused.
             * @param {number} slotZeroEpoch Unused.
             * @param {function(?Object)} cb Receives the clearing tuple.
             * @returns {void}
             */
            fetchSkyTupleAt: function (lat, lon, slotZeroEpoch, cb) {
                cb(clearSkyTuple());
            }
        };
    }
};

/**
 * The sky source id a fetch cycle calls: Open-Meteo only when the radar GRAPH is
 * shown (the only radar view that draws the rows) and the toggle is on;
 * otherwise the clearing source, so switching either off removes the rows.
 * @param {Object} settings Clay settings (radarMode, radarSky).
 * @returns {string} 'openmeteo' or 'disabled'.
 */
function skySourceIdFor(settings) {
    var s = settings || {};
    return ((s.radarMode || 'graph') === 'graph' && Boolean(s.radarSky)) ? 'openmeteo' : 'disabled';
}

/**
 * The sky source for an id; an unknown id falls back to the clearing one.
 * @param {string} skyId 'openmeteo' or 'disabled'.
 * @returns {{fetchSkyTupleAt: Function}} The source.
 */
function createSkySource(skyId) {
    var has = Object.prototype.hasOwnProperty.call(SKY_FACTORIES, skyId);
    return (has ? SKY_FACTORIES[skyId] : SKY_FACTORIES[DEFAULT_SKY_ID])();
}

module.exports = {
    SLOT_SECONDS: SLOT_SECONDS,
    NUM_SLOTS: NUM_SLOTS,
    FULL_SCALE: FULL_SCALE,
    LIGHTNING_POTENTIAL_MIN: LIGHTNING_POTENTIAL_MIN,
    skyStartFor: skyStartFor,
    buildOpenMeteoSkyUrl: buildOpenMeteoSkyUrl,
    mapOpenMeteoSky: mapOpenMeteoSky,
    isLightning: isLightning,
    packSky: packSky,
    clearSkyTuple: clearSkyTuple,
    SKY_FACTORIES: SKY_FACTORIES,
    skySourceIdFor: skySourceIdFor,
    createSkySource: createSkySource
};

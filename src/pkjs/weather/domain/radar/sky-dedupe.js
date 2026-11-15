// src/pkjs/weather/domain/radar/sky-dedupe.js — ES5. The outbox's comparator for the
// radar's sky rows (the 'sky' category, wire/domain/weather-categories.js), the
// counterpart of radar-dedupe.js.
//
// A sky starts on the quarter hour holding the radar's slot 0 (radar-sky.js
// skyStartFor), so a new one is built every quarter hour even while the weather in it
// stays the same, and a byte-for-byte compare sent it on every fetch. Its start is
// absolute: the watch places the rows by time against its self-advancing radar window,
// so the sky it holds goes on drawing the window after the window has moved on, as far
// as its slots reach.

var radarSky = require('./radar-sky.js');
var radarWire = require('./radar-wire.js');

/**
 * Whether a candidate sky must go out, against the one last sent. It may stay on the
 * phone (false) when the last-sent sky holds every quarter hour the window reaches until
 * the next refresh (radar-sky.js REFRESH_SECONDS: the next half hour, when the phone
 * asks again), and the candidate's slots over that stretch match it in cloud, sun and
 * lightning. A sky built a quarter hour after the half hour therefore stays when nothing
 * changed; one built on the half hour must reach a full refresh further and goes out.
 * The clear (an empty blob) and a blob that does not unpack are compared byte for byte:
 * a repeat of the clear stays, any change goes out.
 *
 * @param {{RADAR_SKY_UINT8: number[]}} newSubset Candidate sky.
 * @param {?{RADAR_SKY_UINT8: number[]}} cachedSubset Last-sent sky, or null when none.
 * @returns {boolean} True when the sky should be sent.
 */
function skyComparator(newSubset, cachedSubset) {
    if (!cachedSubset) {
        return true;
    }
    var next = radarSky.unpackSky(newSubset.RADAR_SKY_UINT8);
    var last = radarSky.unpackSky(cachedSubset.RADAR_SKY_UINT8);
    if (!next || !last) {
        return JSON.stringify(newSubset.RADAR_SKY_UINT8) !== JSON.stringify(cachedSubset.RADAR_SKY_UINT8);
    }
    var shift = next.start - last.start;
    if (shift < 0 || shift % radarSky.SLOT_SECONDS !== 0) {
        return true;   // the clock went back, or a start off the quarter-hour grid
    }
    var k = shift / radarSky.SLOT_SECONDS;
    // The candidate's window, slot 0 at most a quarter hour after its start, keeps moving
    // until the next refresh; then its last radar slot starts one slot before that refresh.
    var refreshAt = (Math.floor(next.start / radarSky.REFRESH_SECONDS) + 1) * radarSky.REFRESH_SECONDS;
    var reach = refreshAt - radarWire.SLOT_SECONDS + radarWire.NUM_BARS * radarWire.SLOT_SECONDS;
    var needed = Math.ceil((reach - next.start) / radarSky.SLOT_SECONDS);
    if (needed > next.clouds.length || k + needed > last.clouds.length) {
        return true;
    }
    for (var i = 0; i < needed; i += 1) {
        if (next.clouds[i] !== last.clouds[i + k] || next.suns[i] !== last.suns[i + k]
                || next.bolts[i] !== last.bolts[i + k]) {
            return true;
        }
    }
    return false;
}

module.exports = { skyComparator: skyComparator };

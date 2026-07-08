// src/pkjs/weather/radar-factory.js
//
// Data-driven radar-source construction, mirroring provider-factory.js. The
// RADAR_FACTORIES table maps a Clay radarProvider id to a builder that returns
// an adapter exposing the single radar seam:
//
//   fetchRadarTuplesAt(lat, lon, slotZeroEpoch, cb)
//
// where cb receives radar tuples, or null to preserve the watch's existing
// radar (a transient source failure). Per-source config (e.g. the Rainbow
// proxy endpoint) is bound at construction via cfg. 'disabled' is a real
// registered adapter that clears the watch's radar -- no special case -- and any
// unknown/unset id falls back to it (today's default-off behavior). Adding a
// radar source is a new table entry; index.js never learns source names.

var radar = require('./radar.js');
var rainbowRadar = require('./rainbow-radar.js');
var radarWire = require('./radar-wire.js');

var DEFAULT_RADAR_ID = 'disabled';

var RADAR_FACTORIES = {
    dwd: function(cfg) {
        return { fetchRadarTuplesAt: radar.fetchRadarTuplesAt };
    },
    rainbow: function(cfg) {
        return {
            fetchRadarTuplesAt: function(lat, lon, slotZeroEpoch, cb) {
                rainbowRadar.fetchRadarTuplesAt(cfg.rainbowEndpoint, lat, lon, slotZeroEpoch, cb);
            }
        };
    },
    disabled: function(cfg) {
        return {
            fetchRadarTuplesAt: function(lat, lon, slotZeroEpoch, cb) {
                cb(radarWire.clearRadarTuples());
            }
        };
    }
};

/**
 * Whether a Clay radarProvider id has a registered factory.
 *
 * @param {string} radarId Clay radarProvider id.
 * @returns {boolean} True when the id maps to a known radar source.
 */
function isKnownRadarSource(radarId) {
    return Object.prototype.hasOwnProperty.call(RADAR_FACTORIES, radarId);
}

/**
 * Construct the radar source for a Clay radarProvider id. Unknown or unset ids
 * fall back to the 'disabled' source (clears the watch's radar), matching the
 * legacy default-off behavior.
 *
 * @param {string} radarId Clay radarProvider id ('dwd', 'rainbow', 'disabled').
 * @param {Object} cfg Per-source config.
 * @param {string} cfg.rainbowEndpoint Rainbow proxy URL ('' when the build carries none).
 * @returns {{fetchRadarTuplesAt: Function}} Radar-source adapter satisfying the seam.
 */
function createRadarSource(radarId, cfg) {
    var factory = isKnownRadarSource(radarId) ? RADAR_FACTORIES[radarId] : RADAR_FACTORIES[DEFAULT_RADAR_ID];
    return factory(cfg);
}

module.exports = {
    DEFAULT_RADAR_ID: DEFAULT_RADAR_ID,
    RADAR_FACTORIES: RADAR_FACTORIES,
    isKnownRadarSource: isKnownRadarSource,
    createRadarSource: createRadarSource
};

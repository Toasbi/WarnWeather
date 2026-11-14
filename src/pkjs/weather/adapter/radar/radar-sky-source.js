// src/pkjs/weather/adapter/radar/radar-sky-source.js — ES5, watch runtime.
//
// The radar sky rows' sources: Open-Meteo's request for the radar window's sky, and the
// clearing source that removes the rows. What the answer means (the bytes, the sun and
// lightning rules) is in weather/domain/radar/radar-sky.js.

var WeatherProvider = require('../provider.js');
var radarSky = require('../../domain/radar/radar-sky.js');

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
                WeatherProvider.request(radarSky.buildOpenMeteoSkyUrl(lat, lon), 'GET', function (response) {
                    var sky = null;
                    try {
                        sky = radarSky.mapOpenMeteoSky(JSON.parse(response), slotZeroEpoch, lat, lon);
                    }
                    catch (ex) {
                        console.log('[!] Open-Meteo sky: response parse error');
                    }
                    cb(sky ? { RADAR_SKY_UINT8: radarSky.packSky(sky) } : null);
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
                cb(radarSky.clearSkyTuple());
            }
        };
    }
};

/**
 * The sky source for an id; an unknown id falls back to the clearing one.
 * @param {string} skyId 'openmeteo' or 'disabled'.
 * @returns {{fetchSkyTupleAt: Function}} The source.
 */
function createSkySource(skyId) {
    var has = Object.prototype.hasOwnProperty.call(SKY_FACTORIES, skyId);
    return (has ? SKY_FACTORIES[skyId] : SKY_FACTORIES[DEFAULT_SKY_ID])();
}

module.exports = { createSkySource: createSkySource };

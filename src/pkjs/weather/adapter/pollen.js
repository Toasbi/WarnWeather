// src/pkjs/weather/adapter/pollen.js — ES5, watch runtime.
//
// Today's and tomorrow's pollen band for the Pollen slot and the pollen alert, from the pollen
// source the Provider reads (weather/domain/pollen-days.js sourceOf): the DWD's index, or the
// CAMS forecast through Open-Meteo's air quality API. The bands' rules are in pollen-days.js;
// this file asks the source, and keeps the last good answer for a refresh that brings none
// (pollen-store.js).

// Leaf http helper (no provider cycle): call through the module object so
// tests can stub http.request at runtime.
var http = require('./http.js');
var airQuality = require('./air-quality.js');
var pollenStore = require('./pollen-store.js');
var pollenDays = require('../domain/pollen-days.js');

var WFS_URL = 'https://maps.dwd.de/geoserver/dwd/Pollenflug/wfs';
// Each source's name in the log.
var LOG_NAMES = { dwd: 'DWD', cams: 'CAMS' };

/**
 * Build the DWD WFS point lookup URL. EPSG:4326 uses latitude-first axis order
 * for this WFS 2.0 layer.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully formed pollen WFS request URL.
 */
function buildUrl(lat, lon) {
    var cql = 'INTERSECTS(THE_GEOM,POINT(' + lat + ' ' + lon + '))';
    return WFS_URL
        + '?service=WFS'
        + '&version=2.0.0'
        + '&request=GetFeature'
        + '&typeNames=' + encodeURIComponent('dwd:Pollenflug')
        + '&outputFormat=' + encodeURIComponent('application/json')
        + '&srsName=' + encodeURIComponent('EPSG:4326')
        + '&propertyName=' + encodeURIComponent('FORECAST_DATE,POLLENINT')
        + '&CQL_FILTER=' + encodeURIComponent(cql);
}

/**
 * Build the Open-Meteo air quality request for the CAMS forecast's pollen: every type it
 * holds, by the hour, over the place's today and tomorrow.
 * @param {number|string} lat Latitude in decimal degrees.
 * @param {number|string} lon Longitude in decimal degrees.
 * @returns {string} Fully formed request URL.
 */
function buildCamsUrl(lat, lon) {
    return airQuality.AIR_QUALITY_BASE
        + '?latitude=' + pollenDays.roundPlace(lat)
        + '&longitude=' + pollenDays.roundPlace(lon)
        + '&hourly=' + pollenDays.CAMS_TYPES.map(function (type) { return type.field; }).join(',')
        + '&timeformat=unixtime'
        + '&timezone=auto'
        + '&forecast_days=2';
}

/**
 * Fetch today's and tomorrow's pollen band into a weather provider, from the source the
 * Provider reads (options.pollenSource). The CAMS forecast is not asked outside its area. A
 * refresh that brings no band for today, failed or empty, takes the last good answer's bands
 * for both days when it came from the same source at the same place. A band nothing brings
 * leaves its property as it is. Failures are non-fatal; done is always called once.
 * @param {Object} provider Active provider (reads .options.fetchPollen and .pollenSource,
 *     writes .pollenToday and .pollenTomorrow).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Function} done Continuation called exactly once.
 * @returns {void}
 */
function fetchPollenInto(provider, lat, lon, done) {
    var options = provider.options;
    // A provider without options skips the request (fail-safe, like day-peaks' wanted/recall).
    if (!(options && options.fetchPollen)) { done(); return; }
    var source = options.pollenSource;
    var name = LOG_NAMES[source];
    var now = new Date();
    var days = [pollenDays.localDateKey(now), pollenDays.localDateKey(pollenDays.nextLocalDay(now))];
    var completed = false;

    /**
     * Take an answer's bands, or the stand-in's, and hand on.
     * @param {?Object<string, string>} bands The answer's bands; null when none came.
     * @returns {void}
     */
    function complete(bands) {
        if (completed) { return; }
        completed = true;
        if (bands && pollenDays.bandOn(bands, days[0]) !== null) {
            pollenStore.write(pollenDays.recordOf(source, lat, lon, bands, days));
        } else {
            bands = pollenDays.standIn(pollenStore.read(), source, lat, lon);
            if (pollenDays.bandOn(bands, days[0]) !== null) {
                console.log('Pollen: showing the last ' + name + ' answer');
            }
        }
        var today = pollenDays.bandOn(bands, days[0]);
        var tomorrow = pollenDays.bandOn(bands, days[1]);
        if (today !== null) { provider.pollenToday = today; }
        if (tomorrow !== null) { provider.pollenTomorrow = tomorrow; }
        done();
    }

    if (source === 'cams' && !pollenDays.inCamsArea(lat, lon)) {
        complete(null);
        return;
    }
    try {
        http.request(source === 'dwd' ? buildUrl(lat, lon) : buildCamsUrl(lat, lon), 'GET', function(response) {
            if (completed) { return; }
            var bands = null;
            try {
                var json = JSON.parse(response);
                bands = source === 'dwd' ? pollenDays.dwdBands(json) : pollenDays.camsBands(json);
            } catch (ex) {
                console.log('[!] ' + name + ' pollen response parse failed');
            }
            complete(bands);
        }, function(error) {
            if (completed) { return; }
            console.log('[!] ' + name + ' pollen request failed: ' + JSON.stringify(error));
            complete(null);
        });
    } catch (ex) {
        if (!completed) {
            console.log('[!] ' + name + ' pollen request failed before completion');
        }
        complete(null);
    }
}

module.exports = {
    buildUrl: buildUrl,
    buildCamsUrl: buildCamsUrl,
    fetchPollenInto: fetchPollenInto
};

// src/pkjs/weather/adapter/pollen.js — ES5, watch runtime.
//
// Today's and tomorrow's pollen band for the Pollen slot and the pollen alert, from the pollen
// source the Provider reads (weather/domain/pollen-days.js sourceOf): the DWD's index, or the
// CAMS forecast through Open-Meteo's air quality API. The sources and the bands' rules are in
// pollen-days.js; this file asks the source, and keeps the last good answer for a refresh that
// brings none (pollen-store.js).

// Leaf http helper (no provider cycle): call through the module object so
// tests can stub http.request at runtime.
var http = require('./http.js');
var airQuality = require('./air-quality.js');
var pollenStore = require('./pollen-store.js');
var pollenDays = require('../domain/pollen-days.js');

var WFS_URL = 'https://maps.dwd.de/geoserver/dwd/Pollenflug/wfs';

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
 * holds, by the hour, from the place's yesterday to the day after its tomorrow. The hours
 * follow the place's days (timezone=auto) and the bands the phone's (pollen-days.js
 * camsBands), so the day on each side keeps the phone's today and tomorrow whole wherever
 * the place's day begins.
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
        + '&past_days=1'
        + '&forecast_days=3';
}

// Each pollen source's request, by its id (pollen-days.js SOURCES).
var URLS = { dwd: buildUrl, cams: buildCamsUrl };

/**
 * Fetch today's and tomorrow's pollen band into a weather provider, from the source the
 * Provider reads (options.pollenSource). A source is not asked outside its area. A refresh that
 * brings no band for today, failed or empty, takes the last good answer's bands for both days
 * when it came from the same source at the same place (pollen-days.js settle). A band nothing
 * brings leaves its property as it is. Failures are non-fatal; done is always called once.
 * @param {Object} provider Active provider (reads .options.fetchPollen and .pollenSource,
 *     writes .pollenToday and .pollenTomorrow).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Function} done Continuation called exactly once.
 * @returns {void}
 */
function fetchPollenInto(provider, lat, lon, done) {
    var options = provider.options;
    // A provider without options, or with a source pollen-days.js does not know, skips the
    // request (fail-safe, like day-peaks' wanted/recall).
    if (!(options && options.fetchPollen && pollenDays.isSource(options.pollenSource))) { done(); return; }
    var source = options.pollenSource;
    var asked = pollenDays.SOURCES[source];
    var now = new Date();
    var completed = false;

    /**
     * Settle the answer's bands, or the stand-in's, and hand on.
     * @param {Object<string, string>} bands The answer's bands; {} when none came.
     * @returns {void}
     */
    function complete(bands) {
        if (completed) { return; }
        completed = true;
        var day = pollenDays.settle(bands, pollenStore.read, source, lat, lon, now);
        if (day.keep) { pollenStore.write(day.keep); }
        if (day.standsIn) { console.log('Pollen: showing the last ' + asked.name + ' answer'); }
        if (day.today !== null) { provider.pollenToday = day.today; }
        if (day.tomorrow !== null) { provider.pollenTomorrow = day.tomorrow; }
        done();
    }

    if (!pollenDays.covers(source, lat, lon)) {
        complete({});
        return;
    }
    try {
        http.request(URLS[source](lat, lon), 'GET', function(response) {
            if (completed) { return; }
            var bands = {};
            try {
                bands = asked.bands(JSON.parse(response));
            } catch (ex) {
                console.log('[!] ' + asked.name + ' pollen response parse failed');
            }
            complete(bands);
        }, function(error) {
            if (completed) { return; }
            console.log('[!] ' + asked.name + ' pollen request failed: ' + JSON.stringify(error));
            complete({});
        });
    } catch (ex) {
        if (!completed) {
            console.log('[!] ' + asked.name + ' pollen request failed before completion');
        }
        complete({});
    }
}

module.exports = {
    buildUrl: buildUrl,
    buildCamsUrl: buildCamsUrl,
    fetchPollenInto: fetchPollenInto
};

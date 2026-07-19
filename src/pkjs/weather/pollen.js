var WFS_URL = 'https://maps.dwd.de/geoserver/dwd/Pollenflug/wfs';
var POLLEN_DISPLAYS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

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
        + '&CQL_FILTER=' + encodeURIComponent(cql);
}

/**
 * Format a Date using its local calendar components.
 * @param {Date} date Local date to format.
 * @returns {string} Date key in YYYY-MM-DD form.
 */
function localDateKey(date) {
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return date.getFullYear()
        + '-' + (month < 10 ? '0' : '') + month
        + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * Find today's highest valid native DWD pollen ordinal.
 * @param {Object} json Parsed WFS GeoJSON response.
 * @param {string} dateKey Local date key in YYYY-MM-DD form.
 * @returns {string|null} Native DWD display value, or null when unavailable.
 */
function worstToday(json, dateKey) {
    var features = json && json.features;
    if (!Array.isArray(features)) { return null; }

    var worst = -1;
    var i;
    for (i = 0; i < features.length; i += 1) {
        var properties = features[i] && features[i].properties;
        var forecastDate = properties && properties.FORECAST_DATE;
        var pollenInt = properties && properties.POLLENINT;
        if (typeof forecastDate !== 'string'
                || forecastDate.indexOf(dateKey) !== 0
                || typeof pollenInt !== 'number'
                || pollenInt % 1 !== 0
                || pollenInt < 0
                || pollenInt >= POLLEN_DISPLAYS.length) {
            continue;
        }
        if (pollenInt > worst) { worst = pollenInt; }
    }
    return worst < 0 ? null : POLLEN_DISPLAYS[worst];
}

/**
 * Fetch today's worst native DWD pollen severity into a weather provider.
 * Failures and no-data responses are non-fatal; done is always called once.
 * @param {Object} provider Active provider (reads .fetchPollen, writes .pollenToday).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Function} done Continuation called exactly once.
 * @returns {void}
 */
function fetchPollenInto(provider, lat, lon, done) {
    if (!provider.fetchPollen) { done(); return; }

    var request = require('./provider.js').request;
    request(buildUrl(lat, lon), 'GET', function(response) {
        var severity = null;
        try {
            severity = worstToday(JSON.parse(response), localDateKey(new Date()));
        } catch (ex) {
            console.log('[!] DWD pollen response parse failed');
        }
        if (severity !== null) { provider.pollenToday = severity; }
        done();
    }, function(error) {
        console.log('[!] DWD pollen request failed: ' + JSON.stringify(error));
        done();
    });
}

module.exports = {
    buildUrl: buildUrl,
    localDateKey: localDateKey,
    worstToday: worstToday,
    fetchPollenInto: fetchPollenInto
};

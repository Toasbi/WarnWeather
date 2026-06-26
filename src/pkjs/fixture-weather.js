// src/pkjs/fixture-weather.js
//
// Dev-only fixture send path: turn a fixtures/<name>.json weather block into
// the real watch AppMessage payload (weather + radar + palette tuples) and
// send it, bypassing live provider fetch. Pulled out of index.js so the
// orchestrator stays focused on event wiring and live fetch.

var WeatherProvider = require('./weather/provider.js');
var forecastSeries = require('./forecast-series.js');
var wireUnits = require('./wire-units.js');
var paletteWire = require('./weather/palette-wire.js');

/**
 * Convert a fixture weather object into the real watch weather AppMessage payload.
 *
 * @param {Object} fixture Active fixture loaded from fixtures/<name>.json.
 * @param {Object} settings Clay settings used for the forecast-series transform.
 * @returns {Object|null} Pebble weather payload, or null when invalid.
 */
function getFixtureWeatherPayload(fixture, settings) {
    var weather;
    var provider;
    var sunEvents;

    if (!fixture || typeof fixture !== 'object') {
        return null;
    }

    weather = fixture.weather;
    if (!weather || typeof weather !== 'object') {
        console.log('[fixture] Missing weather block');
        return null;
    }

    sunEvents = Array.isArray(weather.sunEvents) ? weather.sunEvents.map(function(event) {
        return {
            type: event.type,
            date: new Date(event.epoch * 1000)
        };
    }) : [];

    provider = new WeatherProvider();
    provider.name = 'Fixture';
    provider.id = 'fixture';
    provider.numEntries = Array.isArray(weather.temps) ? weather.temps.length : 0;
    provider.cityName = weather.city || 'Fixture City';
    provider.currentTemp = weather.currentTemp;
    provider.startTime = weather.startEpoch;
    provider.tempTrend = Array.isArray(weather.temps) ? weather.temps.slice(0) : [];
    provider.precipTrend = Array.isArray(weather.precipPct) ? weather.precipPct.map(function(probabilityPercent) {
        return probabilityPercent / 100.0;
    }) : [];
    provider.rainTrend = Array.isArray(weather.rainMm) ? weather.rainMm.slice(0) : new Array(provider.numEntries);
    if (!Array.isArray(weather.rainMm)) {
        for (var rainFillIdx = 0; rainFillIdx < provider.numEntries; rainFillIdx += 1) {
            provider.rainTrend[rainFillIdx] = 0;
        }
    }
    provider.windTrend = Array.isArray(weather.windKmh) ? weather.windKmh.slice(0) : new Array(provider.numEntries);
    if (!Array.isArray(weather.windKmh)) {
        for (var windFillIdx = 0; windFillIdx < provider.numEntries; windFillIdx += 1) {
            provider.windTrend[windFillIdx] = 0;
        }
    }
    provider.gustTrend = Array.isArray(weather.gustKmh) ? weather.gustKmh.slice(0) : new Array(provider.numEntries);
    if (!Array.isArray(weather.gustKmh)) {
        for (var gustFillIdx = 0; gustFillIdx < provider.numEntries; gustFillIdx += 1) {
            provider.gustTrend[gustFillIdx] = 0;
        }
    }
    provider.uvTrend = Array.isArray(weather.uvIndex) ? weather.uvIndex.slice(0) : [];
    provider.sunEvents = sunEvents;

    if (provider.numEntries <= 0 || sunEvents.length < 2 || !provider.hasValidData()) {
        console.log('[fixture] Invalid weather data in fixture ' + (fixture.name || '(unknown)'));
        return null;
    }

    // getPayload() emits the raw PRECIP_TREND/RAIN_TREND keys; the watch only
    // reads the render-ready series, so run the same transform as the live path
    // (settings already reflects this fixture's claySettings).
    return forecastSeries.applyForecastSeries(provider.getPayload(), settings);
}

/**
 * Read rainRadarExactMm + rainRadarAreaMm from the fixture's weather
 * block and convert to wire tenths (same mm/h * 10 scaling as RAIN_TREND).
 * Returns null when either array is missing — callers ship the weather
 * payload without radar tuples in that case.
 *
 * @param {Object} fixture Active fixture.
 * @returns {Object|null} Object of three radar AppMessage tuples, or null.
 */
function getFixtureRadarTuples(fixture) {
    var weather = fixture && fixture.weather;
    if (!weather || !Array.isArray(weather.rainRadarExactMm) || !Array.isArray(weather.rainRadarAreaMm)) {
        return null;
    }
    var toTenths = function(mmPerHour) {
        return wireUnits.clampByte((mmPerHour || 0) * 10);
    };
    // Align radar start with the fixture clock so the watch's hour-axis labels
    // render relative to fixture time, not real wall-clock time. A fixture may
    // set radarStartEpoch to scroll the radar window independently of the
    // forecast graph's startEpoch (the time-lapse uses this so the radar
    // advances per frame while the forecast now-marker keeps sweeping); absent
    // that, the radar anchors to startEpoch, and falls back to Date.now() if the
    // fixture predates startEpoch.
    var radarStart;
    if (typeof weather.radarStartEpoch === 'number') {
        radarStart = weather.radarStartEpoch;
    } else if (typeof weather.startEpoch === 'number') {
        radarStart = weather.startEpoch;
    } else {
        radarStart = Math.floor(Date.now() / 1000);
    }
    return {
        RAIN_RADAR_TREND_UINT8: weather.rainRadarExactMm.map(toTenths),
        RAIN_RADAR_TREND_AREA_UINT8: weather.rainRadarAreaMm.map(toTenths),
        RAIN_RADAR_START: radarStart
    };
}

/**
 * Send fixture weather directly to the watch, bypassing live provider fetch logic.
 *
 * @param {Object} fixture Active fixture loaded from fixtures/<name>.json.
 * @param {{settings: Object, watchInfo: Object|null}} deps Clay settings + watch info.
 * @returns {void}
 */
function sendFixtureWeather(fixture, deps) {
    var payload = getFixtureWeatherPayload(fixture, deps.settings);
    var radarTuples;
    var radarKey;

    if (!payload) {
        return;
    }

    // Bundle radar tuples into the same AppMessage so they ride the
    // inbox handler's bundled forecast+radar branch. Sending them as a
    // follow-up Pebble.sendAppMessage during startup races on the
    // half-duplex outbox channel.
    radarTuples = getFixtureRadarTuples(fixture);
    if (radarTuples) {
        for (radarKey in radarTuples) {
            if (Object.prototype.hasOwnProperty.call(radarTuples, radarKey)) {
                payload[radarKey] = radarTuples[radarKey];
            }
        }
    }

    // Bundle the rain palette too, so fixture bars honor rainBarColor.
    Object.assign(payload, paletteWire.buildPaletteTuples(deps.watchInfo, deps.settings));

    console.log('[fixture] Sending weather fixture: ' + (fixture.name || '(unknown)'));
    Pebble.sendAppMessage(payload, function() {
        console.log('[fixture] Weather fixture sent successfully');
    }, function(e) {
        console.log('[fixture] Weather fixture failed: ' + JSON.stringify(e));
    });
}

module.exports = {
    getFixtureRadarTuples: getFixtureRadarTuples,
    getFixtureWeatherPayload: getFixtureWeatherPayload,
    sendFixtureWeather: sendFixtureWeather
};

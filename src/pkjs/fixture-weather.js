// src/pkjs/fixture-weather.js
//
// Dev-only fixture send path: turn a fixtures/<name>.json weather block into
// the real watch AppMessage payload (weather + radar + palette tuples) and
// send it, bypassing live provider fetch. Pulled out of index.js so the
// orchestrator stays focused on event wiring and live fetch.

var WeatherProvider = require('./weather/provider.js');
var fetchOptions = require('./weather/fetch-options.js');
var forecastSeries = require('./forecast-series.js');
var wireUnits = require('./wire-units.js');
var paletteWire = require('./weather/palette-wire.js');
var lineStyle = require('./line-style.js');
var radarSky = require('./weather/radar-sky.js');

/**
 * Put a copy of `source` on `mapped[key]` when it is an array; otherwise leave
 * the key off, so adoptMapped applies that field's documented empty value.
 *
 * @param {Object} mapped The mapped forecast being built.
 * @param {string} key Mapped key (from WeatherProvider.MAPPED_KEYS).
 * @param {*} source The fixture's value for it.
 * @returns {void}
 */
function mapArrayIfPresent(mapped, key, source) {
    if (Array.isArray(source)) {
        mapped[key] = source.slice(0);
    }
}

/**
 * Map a fixture's weather block onto the adapter seam's vocabulary
 * (WeatherProvider.MAPPED_KEYS), for WeatherProvider#adoptMapped — the fixture
 * is an adapter like any live provider. Key PRESENCE is part of the contract:
 *
 *  - The four core keys are ALWAYS set, even when the value is undefined. The
 *    committed fixtures/*.json carry no startEpoch (only prepare-fixture adds
 *    one), and hasValidData checks presence, not value — a missing key would
 *    make adopt delete it and the payload come back null.
 *  - feelsTrend is always set ([] without feelsTemps) and currentFeels is set
 *    on its own, so adopt's verbatim branch ships the scalar current feels-like
 *    even for a fixture with no hourly series.
 *  - rain/wind/gust and uv/pressure/dew/wind-direction are set only when the
 *    fixture has them; adopt zero-fills or empties the rest. Never undefined:
 *    getPayload slices those series.
 *
 * @param {Object} weather The fixture's weather block.
 * @returns {Object} The mapped forecast.
 */
function mapFixtureWeather(weather) {
    var mapped = {
        startTime: weather.startEpoch,
        currentTemp: weather.currentTemp,
        tempTrend: Array.isArray(weather.temps) ? weather.temps.slice(0) : [],
        precipTrend: Array.isArray(weather.precipPct) ? weather.precipPct.map(function(probabilityPercent) {
            return probabilityPercent / 100.0;
        }) : [],
        // Feels-like (°F, same internal unit as temps) is a forecast-line metric AND
        // the temp slot's feels/both display source: an hourly array + scalar
        // current, each defaulting to empty ([] / null) so the line stays off and
        // the temp slot renders the actual temp alone (a live provider gap's shape).
        feelsTrend: Array.isArray(weather.feelsTemps) ? weather.feelsTemps.slice(0) : [],
        currentFeels: (typeof weather.currentFeels === 'number') ? weather.currentFeels : null
    };
    mapArrayIfPresent(mapped, 'rainTrend', weather.rainMm);
    mapArrayIfPresent(mapped, 'windTrend', weather.windKmh);
    mapArrayIfPresent(mapped, 'gustTrend', weather.gustKmh);
    mapArrayIfPresent(mapped, 'uvTrend', weather.uvIndex);
    // Sea-level pressure (hPa) is a status-slot value AND a forecast-line metric;
    // absent → [] so the line/slot render as off/'--'.
    mapArrayIfPresent(mapped, 'pressureTrend', weather.pressureHpa);
    // Cloud cover (%) is a forecast-line metric only: an hourly array, or absent so
    // adoptMapped leaves [] and the cloud line renders as off.
    mapArrayIfPresent(mapped, 'cloudTrend', weather.cloudPct);
    // Dew point (°F) and the wind bearing (degrees the wind comes FROM) are
    // status-slot values: absent → [] so the dew slot renders '--' and the
    // wind/gust slots draw no arrow (a provider that does not source them).
    mapArrayIfPresent(mapped, 'dewTrend', weather.dewPoint);
    mapArrayIfPresent(mapped, 'windDirTrend', weather.windDirection);
    return mapped;
}

/**
 * Convert a fixture weather object into the real watch weather AppMessage payload.
 *
 * @param {Object} fixture Active fixture loaded from fixtures/<name>.json.
 * @param {Object} settings Clay settings used for the forecast-series transform.
 * @param {Object} [watchInfo] Pebble watchInfo object; used to resolve platform-aware colours.
 * @returns {Object|null} Pebble weather payload, or null when invalid.
 */
function getFixtureWeatherPayload(fixture, settings, watchInfo) {
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
    // Before adopting: adoptMapped zero-fills an absent rain/wind/gust series to
    // numEntries.
    provider.numEntries = Array.isArray(weather.temps) ? weather.temps.length : 0;
    // A fixture sources every series it carries, whatever the settings select:
    // UV and feels-like always adopt (the fixture's feels ship verbatim, so the
    // feels-like formula never applies).
    provider.options = fetchOptions.defaults({ fetchUv: true, fetchFeels: true });
    provider.adoptMapped(mapFixtureWeather(weather));
    // The chain-stage fields a live fetch fills after the adapter (city lookup,
    // sun events, the AQI and pollen aux fetches) are faked directly.
    provider.cityName = weather.city || 'Fixture City';
    // AQI is a status-slot value, not a forecast line: accept a scalar current
    // index (weather.aqi) — wrapped as a one-element trend, like the WAQI source —
    // or an explicit array. Absent -> [] and the slot renders '--'.
    provider.aqiTrend = (typeof weather.aqi === 'number') ? [weather.aqi]
        : (Array.isArray(weather.aqi) ? weather.aqi.slice(0) : []);
    // Pollen is a status-slot value, not a forecast line: accept the fixture's
    // native DWD display string (weather.pollen, e.g. '1-2'), or leave null so
    // the slot renders '--'.
    provider.pollenToday = (typeof weather.pollen === 'string') ? weather.pollen : null;
    provider.sunEvents = sunEvents;

    if (provider.numEntries <= 0 || sunEvents.length < 2 || !provider.hasValidData()) {
        console.log('[fixture] Invalid weather data in fixture ' + (fixture.name || '(unknown)'));
        return null;
    }

    // getPayload() emits the raw PRECIP_TREND/RAIN_TREND keys; the watch only
    // reads the render-ready series, so run the same transform as the live path
    // (settings already reflects this fixture's claySettings).
    return forecastSeries.applyForecastSeries(provider.getPayload(), settings, watchInfo);
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
    var tuples = {
        RAIN_RADAR_TREND_UINT8: weather.rainRadarExactMm.map(toTenths),
        RAIN_RADAR_TREND_AREA_UINT8: weather.rainRadarAreaMm.map(toTenths),
        RAIN_RADAR_START: radarStart
    };
    // Optional sky rows (radar-sky.js): weather.sky = { cloudPct, sunPct, lightning },
    // one entry per 15-min slot from the quarter-hour holding the radar start.
    var sky = weather.sky;
    if (sky && Array.isArray(sky.cloudPct) && Array.isArray(sky.sunPct)) {
        var pctToByte = function(p) {
            return radarSky.toByte(p, 100);
        };
        tuples.RADAR_SKY_UINT8 = radarSky.packSky({
            start: radarSky.skyStartFor(radarStart),
            clouds: sky.cloudPct.map(pctToByte),
            suns: sky.sunPct.map(pctToByte),
            bolts: sky.cloudPct.map(function(_, k) {
                return Array.isArray(sky.lightning) && Boolean(sky.lightning[k]);
            })
        });
    }
    return tuples;
}

/**
 * Send fixture weather directly to the watch, bypassing live provider fetch logic.
 *
 * @param {Object} fixture Active fixture loaded from fixtures/<name>.json.
 * @param {{settings: Object, watchInfo: Object|null}} deps Clay settings + watch info.
 * @returns {void}
 */
function sendFixtureWeather(fixture, deps) {
    var payload = getFixtureWeatherPayload(fixture, deps.settings, deps.watchInfo);
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

    // Same reason, same trick for the graph's line styling: it rides the Clay
    // settings message in production, and a fixture send bypasses that path
    // entirely, so bundle it here or the fixture renders its lines in whatever
    // colours the last real settings send happened to leave on the watch. The
    // inbox handlers each dict_find their own key, so a Clay tuple is read just
    // as happily off the weather message. Ten bytes — the fixture's claySettings
    // block drives the night colours and their flag (bytes 4..9) too; the layout
    // lives on buildLineStyleBytes in line-style.js.
    payload.CLAY_LINE_STYLE_UINT8 = lineStyle.buildLineStyleBytes(
        deps.settings, deps.watchInfo);

    // Dev: let a fixture exercise sleep mode (the snooze indicator + frozen
    // weather slots). The live path derives IS_SLEEPING from the sleep window;
    // fixtures set it explicitly since the emulator has no real schedule.
    if (fixture.weather.isSleeping) {
        payload.IS_SLEEPING = 1;
    }

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
    mapFixtureWeather: mapFixtureWeather,
    sendFixtureWeather: sendFixtureWeather
};

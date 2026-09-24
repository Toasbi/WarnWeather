var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;
var openmeteo = require('./openmeteo.js');
var feelsLike = require('./feels-like.js');
var feelsLikeF = feelsLike.feelsLikeF;
var feelsLikeFromDewF = feelsLike.feelsLikeFromDewF;

var BRIGHTSKY_BASE = require('./brightsky.js').BASE_URL;
var MAX_DIST_METERS = 500000;
var hourlyWindow = require('./hourly-window.js');
var dayPeaks = require('./day-peaks.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
var PEAK_HOURS = hourlyWindow.PEAK_HOURS;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
var HOUR_MS = HOUR_SECONDS * 1000;
// Shared unit helpers (wire-units.js owns them; local aliases keep call sites).
var celsiusToFahrenheit = require('../wire-units.js').celsiusToFahrenheit;
var normalizeBearing = require('../wire-units.js').normalizeBearing;

/**
 * Steadman feels-like °F for one Brightsky hourly record (temperature °C,
 * wind_speed km/h — no API feels-like field). Moisture comes from
 * relative_humidity when present, else dew_point: Brightsky FORECAST (MOSMIX)
 * records return relative_humidity null on every hour but always carry
 * dew_point (verified live 2026-08-16) — without the dew route the whole
 * series silently fell back to the plain temp and the feels curve rendered
 * invisibly underneath the temp curve. No moisture data at all → plain temp
 * so the series stays numeric; missing wind reads 0 (the windTrend convention).
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number} Feels-like (or actual, as fallback) temperature in °F.
 */
function hourFeels(e) {
    var tempF = celsiusToFahrenheit(e.temperature);
    var windKmh = e.wind_speed || 0;
    var feels = feelsLikeF(tempF, e.relative_humidity, windKmh);
    if (feels === null && typeof e.dew_point === 'number') {
        feels = feelsLikeFromDewF(tempF, celsiusToFahrenheit(e.dew_point), windKmh);
    }
    return feels === null ? tempF : feels;
}

/**
 * Dew point in °F for one Brightsky record, or null when the record omits it.
 * Brightsky reports dew_point in °C; °F is the repo's internal temperature unit
 * (currentTemp/feelsTrend), so convert at this boundary. The value is already in
 * hand — hourFeels leans on it whenever relative_humidity is null — so sourcing
 * the dew slot costs no request and no extra parsing. Null (not NaN) on a record
 * without it, so the slot degrades to '--' instead of rendering garbage.
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number|null} Dew point in °F, or null when unsourced.
 */
function hourDewF(e) {
    return typeof e.dew_point === 'number' ? celsiusToFahrenheit(e.dew_point) : null;
}

/**
 * Wind bearing for one Brightsky hourly record.
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number|null} Bearing in [0, 360), or null when unsourced.
 */
function hourBearing(e) {
    return normalizeBearing(e.wind_direction);
}

/**
 * Wind bearing from the /current_weather record. Like the wind speed, the
 * observation reports no plain `wind_direction` — only 10/30/60-minute means —
 * so walk the same shortest-window-present ladder currentFeelsFrom uses.
 *
 * @param {Object} current Brightsky current_weather `weather` record.
 * @returns {number|null} Bearing in [0, 360), or null when unsourced.
 */
function currentBearingFrom(current) {
    var degrees = typeof current.wind_direction_10 === 'number' ? current.wind_direction_10
        : (typeof current.wind_direction_30 === 'number' ? current.wind_direction_30
            : current.wind_direction_60);
    return normalizeBearing(degrees);
}

/**
 * Feels-like °F from the Brightsky /current_weather record, or null when the
 * inputs are missing (→ FEELS_CURRENT omitted, temp slot degrades). Unlike the
 * hourly feed, current_weather reports wind only as 10/30/60-minute means —
 * take the shortest window present (verified live 2026-08-16).
 *
 * @param {Object} current Brightsky current_weather `weather` record.
 * @returns {number|null} Feels-like temperature in °F, or null.
 */
function currentFeelsFrom(current) {
    if (typeof current.temperature !== 'number') {
        return null;
    }
    var windKmh = typeof current.wind_speed_10 === 'number' ? current.wind_speed_10
        : (typeof current.wind_speed_30 === 'number' ? current.wind_speed_30
            : current.wind_speed_60);
    var tempF = celsiusToFahrenheit(current.temperature);
    var feels = feelsLikeF(tempF, current.relative_humidity, windKmh);
    if (feels === null && typeof current.dew_point === 'number') {
        // Observation records usually carry RH, but degrade the same way the
        // hourly feed does when a station omits it.
        feels = feelsLikeFromDewF(tempF, celsiusToFahrenheit(current.dew_point), windKmh);
    }
    return feels;
}

/**
 * ISO 8601 forecast window starting at the current wall-clock hour and
 * covering FORECAST_HOURS + 1 buckets (or to the end of tomorrow). Brightsky returns `hourly[0]` as the
 * bucket whose timestamp >= `date`, so anchoring `date` at the hour
 * boundary keeps `hourly[0]` on the bucket the user is currently inside.
 * `last_date` is inclusive, so ending it FORECAST_HOURS on returns one record
 * past the window: the one stamped at the last slot's END, which carries that
 * slot's preceding-hour rain, chance and gust (see slotRecords). While a wind
 * or gust slot shows its day max it runs on to the end of local tomorrow
 * instead: only wind and gusts read on (peakTail).
 *
 * @param {boolean} peak Whether a wind or gust slot shows its day max.
 * @returns {{ start: string, end: string }} ISO timestamps.
 */
function forecastWindow(peak) {
    var nowMs = Date.now();
    var startMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    // The day max reads no further than the end of local tomorrow
    // (localDayPeaks), plus the record after it that holds the last gust.
    var endMs = peak
        ? hourlyWindow.localDayStart(startMs / 1000, Math.floor(nowMs / 1000), 2) * 1000 + HOUR_MS
        : startMs + FORECAST_HOURS * HOUR_MS;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString()
    };
}

/**
 * Wind and gusts for the hours after the graph's FORECAST_HOURS slots, out to
 * PEAK_HOURS — what the wind and gust slots' day max reads past the graph.
 * Paired by timestamp like slotRecords (wind from the hour's own record, the
 * gust from the one an hour on), but a record Brightsky does not return reads
 * as null rather than carrying the previous hour forward: past the graph a
 * made-up hour could only invent a peak, and localDayPeaks treats a null tail
 * as the end of the feed.
 *
 * @param {Object} byEpoch Brightsky records by epoch second (recordsByEpoch).
 * @param {number} startEpoch Epoch seconds of slot 0.
 * @returns {{wind: Array.<(number|null)>, gust: Array.<(number|null)>}} km/h.
 */
function peakTail(byEpoch, startEpoch) {
    var wind = [];
    var gust = [];
    var i, own, next;
    for (i = FORECAST_HOURS; i < PEAK_HOURS; i += 1) {
        own = byEpoch[startEpoch + i * HOUR_SECONDS];
        next = byEpoch[startEpoch + (i + 1) * HOUR_SECONDS];
        wind.push(own && typeof own.wind_speed === 'number' ? own.wind_speed : null);
        gust.push(next && typeof next.wind_gust_speed === 'number' ? next.wind_gust_speed : null);
    }
    return { wind: wind, gust: gust };
}

/**
 * Whether a wind or gust slot shows its day max — the only reason to read
 * Brightsky past the graph's window.
 *
 * @param {Object} provider The DWD provider.
 * @returns {boolean}
 */
function windPeaksWanted(provider) {
    return dayPeaks.wanted(provider, 'wind') || dayPeaks.wanted(provider, 'gust');
}

/**
 * Brightsky records keyed by their timestamp's epoch second — the lookup both
 * slotRecords and peakTail pair by, built once per fetch.
 *
 * @param {Object[]} hourly Brightsky `weather` records.
 * @returns {Object} Epoch second -> record.
 */
function recordsByEpoch(hourly) {
    var byEpoch = {};
    for (var i = 0; i < hourly.length; i += 1) {
        byEpoch[Math.floor(Date.parse(hourly[i].timestamp) / 1000)] = hourly[i];
    }
    return byEpoch;
}

/**
 * Each forecast slot's two Brightsky records, both looked up BY TIMESTAMP.
 *
 * `own[i]` is the record stamped startTime + i h: the slot's instants
 * (temperature, wind speed, pressure, dew point, bearing, feels), drawn on
 * tick i.
 *
 * `following[i]` is the record stamped startTime + (i + 1) h: the slot's
 * PRECEDING-HOUR values. Brightsky reports precipitation,
 * precipitation_probability and wind_gust_speed for the 60 minutes BEFORE a
 * record's timestamp, but the watch draws slot i as the hour STARTING at
 * startTime + i h (bar i sits right of tick i). Read from the slot's own
 * record, every shower landed an hour late and the current-hour bar showed the
 * hour that had just ended. (The settings page's Weather tab re-stamps the
 * same fields the same way, weather-tab-model.js's startHourFields, so a tap
 * on 14:00 there reads the hour this slot shows.)
 *
 * Both halves pair by timestamp, not by index, so a record Brightsky skips
 * cannot slide every later hour — and cannot pair one slot's rain with the
 * next hour's temperature. A skipped `own` record carries the previous hour's
 * forward (slot 0's is hourly[0] itself, so there is always one): a null
 * temperature would draw as 0 °F. A missing `following` record — the end of
 * the MOSMIX horizon, a short response, a skip — comes back null, which the
 * caller reads as no rain / no gust.
 *
 * @param {Object[]} hourly Brightsky `weather` records, ascending.
 * @param {Object} byEpoch The same records by epoch second (recordsByEpoch).
 * @param {number} startEpoch Epoch seconds of slot 0 (hourly[0]'s timestamp).
 * @param {number} count Number of slots to pair.
 * @returns {{own: Object[], following: Array.<(Object|null)>}} One record per
 *   slot each (`following` entries may be null).
 */
function slotRecords(hourly, byEpoch, startEpoch, count) {
    var own = [];
    var following = [];
    var i;
    var record;
    for (i = 0; i < count; i += 1) {
        record = byEpoch[startEpoch + i * HOUR_SECONDS] || (i > 0 ? own[i - 1] : hourly[0]);
        own.push(record);
        following.push(byEpoch[startEpoch + (i + 1) * HOUR_SECONDS] || null);
    }
    return { own: own, following: following };
}

var DwdProvider = function() {
    this._super.call(this);
    this.name = 'Brightsky (Deutscher Wetterdienst)';
    this.id = 'dwd';
    // Its UV is Open-Meteo's (openmeteo.fetchUvInto): the UV day record carries
    // across a switch between the two.
    this.uvFeedId = 'openmeteo';
};

DwdProvider.prototype = Object.create(WeatherProvider.prototype);
DwdProvider.prototype.constructor = DwdProvider;
DwdProvider.prototype._super = WeatherProvider;

DwdProvider.prototype.withDwdForecast = function(lat, lon, callback, onFailure) {
    var win = forecastWindow(windPeaksWanted(this));
    var url = BRIGHTSKY_BASE + '/weather'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&date=' + encodeURIComponent(win.start)
        + '&last_date=' + encodeURIComponent(win.end)
        + '&max_dist=' + MAX_DIST_METERS;
    request(url, 'GET', function(response) {
        try {
            callback(JSON.parse(response).weather);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'dwd_forecast_parse_error'));
        }
    }, function(error) {
        console.log('[!] DWD forecast request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'dwd_forecast_' + error.code));
    });
};

DwdProvider.prototype.withDwdCurrent = function(lat, lon, callback, onFailure) {
    var url = BRIGHTSKY_BASE + '/current_weather'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&max_dist=' + MAX_DIST_METERS;
    request(url, 'GET', function(response) {
        var current;
        try {
            current = JSON.parse(response).weather;
            callback(celsiusToFahrenheit(current.temperature), currentFeelsFrom(current),
                     currentBearingFrom(current));
        }
        catch (ex) {
            onFailure(failure('provider_data', 'dwd_current_parse_error'));
        }
    }, function(error) {
        console.log('[!] DWD current request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'dwd_current_' + error.code));
    });
};

DwdProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    this.withDwdForecast(lat, lon, (function(hourly) {
        // Reject an empty/missing forecast before the current-weather call.
        // Otherwise the `hourly[0].timestamp` deref below only fails downstream
        // inside withDwdCurrent's try/catch, mislabeled `dwd_current_parse_error`.
        if (!Array.isArray(hourly) || hourly.length === 0) {
            onFailure(failure('provider_data', 'dwd_forecast_empty'));
            return;
        }
        this.withDwdCurrent(lat, lon, (function(currentTempF, currentFeelsF, currentBearing) {
            var startEpoch = Math.floor(Date.parse(hourly[0].timestamp) / 1000);
            // The window asks for records out to PEAK_HOURS (forecastWindow);
            // the slots themselves stop at FORECAST_HOURS so every series agrees
            // on its length (wind and gusts read on, peakTail below). A response short of that (fewer records than slots)
            // stays short, so hasValidData still rejects it.
            // Instants (temperature, wind speed, pressure, dew point, bearing)
            // read the slot's own record; the preceding-hour totals read the
            // record one hour on (slotRecords).
            var byEpoch = recordsByEpoch(hourly);
            var paired = slotRecords(hourly, byEpoch, startEpoch, Math.min(hourly.length, FORECAST_HOURS));
            var slots = paired.own;
            var following = paired.following;
            // Steadman-computed (no Brightsky feels field): the most expensive
            // feels path of any provider — an exp() per hour — so the arithmetic
            // is skipped when options.fetchFeels is off. That is only a
            // compute-skip; adoptMapped applies the semantic fetchFeels gate on
            // top. No humidityTrend key, so adoptMapped ships this series
            // verbatim under either feelsFormula (the humidity branch would
            // back-fill temp under 'provider' and change DWD's numbers).
            var fetchFeels = this.options.fetchFeels;
            var mapped = {
                tempTrend: slots.map(function(e) { return celsiusToFahrenheit(e.temperature); }),
                precipTrend: following.map(function(e) { return e ? e.precipitation_probability / 100 : 0; }),
                rainTrend: following.map(function(e) { return e ? e.precipitation : 0; }),
                windTrend: slots.map(function(e) { return e.wind_speed || 0; }), // Brightsky wind_speed is km/h
                gustTrend: following.map(function(e) { return (e && e.wind_gust_speed) || 0; }), // Brightsky wind_gust_speed is km/h
                pressureTrend: slots.map(function(e) { return e.pressure_msl || 0; }), // Brightsky pressure_msl is sea-level hPa; 0 → forecast-series rejects the series
                cloudTrend: slots.map(function(e) { return e.cloud_cover || 0; }), // Brightsky cloud_cover is total %
                // Dew point rides along free: Brightsky returns the full field set, so
                // this is the same value hourFeels already reads. Ungated by fetchFeels
                // — the dew slot is independent of the feels curve and costs no math.
                dewTrend: slots.map(hourDewF), // °F, null where unsourced
                windDirTrend: slots.map(hourBearing), // degrees 0-359, "comes from"
                feelsTrend: fetchFeels ? slots.map(hourFeels) : [],
                currentFeels: fetchFeels ? currentFeelsF : null,
                startTime: startEpoch,
                currentTemp: currentTempF
            };
            // MOSMIX can omit the bearing on the hour we are inside (it already
            // omits relative_humidity there); the live observation carries it, so
            // fill just that gap. The forecast wins whenever it has a value: the
            // arrow annotates windTrend[0], which is the forecast, so the speed and
            // the direction it points must come from the same record.
            if (mapped.windDirTrend[0] === null && typeof currentBearing === 'number') {
                mapped.windDirTrend[0] = currentBearing;
            }
            // The day-max series read on past the graph (hourly-window.js
            // PEAK_HOURS) while a wind or gust slot shows its day max (the
            // window reached that far, forecastWindow); getPayload cuts them
            // back to the graph's window. Built on `mapped`, so adoptMapped
            // takes the full series in one step.
            if (slots.length === FORECAST_HOURS
                && windPeaksWanted(this)) {
                var tail = peakTail(byEpoch, startEpoch);
                mapped.windTrend = mapped.windTrend.concat(tail.wind);
                mapped.gustTrend = mapped.gustTrend.concat(tail.gust);
            }
            // Total: no uvTrend key, so adoptMapped leaves uvTrend at [] and the
            // Open-Meteo UV fetch below fills it in when options.fetchUv is on —
            // a failed UV call on a reused instance cannot ship the previous
            // cycle's window against the new startTime.
            this.adoptMapped(mapped);
            openmeteo.fetchUvInto(this, lat, lon, onSuccess);
        }).bind(this), onFailure);
    }).bind(this), onFailure);
};

module.exports = DwdProvider;

var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;

/**
 * Find the index of the hourly bucket at or after the current wall-clock hour.
 *
 * @param {number[]} times Hourly timestamps in epoch seconds (ascending).
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {number} Index of the first bucket >= the floored current hour, or -1.
 */
function anchorIndex(times, nowEpoch) {
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    var i;
    for (i = 0; i < times.length; i += 1) {
        if (times[i] >= hourFloor) {
            return i;
        }
    }
    return -1;
}

/**
 * Map an Open-Meteo forecast response into provider trend fields.
 *
 * Anchors the 24-hour window at the current wall-clock hour and slices each
 * hourly array forward from there (the window naturally spans into the next
 * day). Units pass through unconverted: the request asks Open-Meteo for °F,
 * km/h and mm directly, matching the provider unit convention.
 *
 * @param {Object} json Parsed Open-Meteo /v1/forecast response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {{tempTrend: number[], precipTrend: number[], rainTrend: number[], windTrend: number[], gustTrend: number[], pressureTrend: number[], startTime: number, currentTemp: number}|null}
 *   Mapped fields, or null when the response is malformed or has fewer than
 *   FORECAST_HOURS buckets at/after the current hour.
 */
function mapResponse(json, nowEpoch) {
    var hourly = json && json.hourly;
    var current = json && json.current;
    var times = hourly && hourly.time;
    var anchor;

    if (!hourly || !current || !Array.isArray(times)
        || !Array.isArray(hourly.temperature_2m)
        || !Array.isArray(hourly.precipitation_probability)
        || !Array.isArray(hourly.precipitation)
        || !Array.isArray(hourly.windspeed_10m)
        || !Array.isArray(hourly.windgusts_10m)
        || typeof current.temperature_2m !== 'number') {
        return null;
    }

    anchor = anchorIndex(times, nowEpoch);
    if (anchor < 0 || times.length - anchor < FORECAST_HOURS) {
        return null;
    }

    var end = anchor + FORECAST_HOURS;
    return {
        tempTrend: hourly.temperature_2m.slice(anchor, end),
        precipTrend: hourly.precipitation_probability.slice(anchor, end).map(function(p) {
            return p / 100;
        }),
        rainTrend: hourly.precipitation.slice(anchor, end),
        windTrend: hourly.windspeed_10m.slice(anchor, end),
        gustTrend: hourly.windgusts_10m.slice(anchor, end),
        // Optional, unlike the guarded fields above: an absent series degrades to
        // line-off rather than failing the whole fetch. Verified 2026-08-12 that the
        // pinned ecmwf_ifs025 model does emit pressure_msl (unlike windgusts_10m,
        // which it returns all-null — hence the separate gust call below).
        pressureTrend: Array.isArray(hourly.pressure_msl)
            ? hourly.pressure_msl.slice(anchor, end) : [],
        startTime: times[anchor],
        currentTemp: current.temperature_2m
    };
}

var OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

var OpenMeteoProvider = function() {
    this._super.call(this);
    this.name = 'Open-Meteo';
    this.id = 'openmeteo';
};

OpenMeteoProvider.prototype = Object.create(WeatherProvider.prototype);
OpenMeteoProvider.prototype.constructor = OpenMeteoProvider;
OpenMeteoProvider.prototype._super = WeatherProvider;

/**
 * Build the Open-Meteo forecast request URL. Requests native °F / km/h / mm
 * units and unixtime so the mapper does zero conversion, and forecast_days=2
 * (48 buckets) so a current-hour-anchored 24h window always fits.
 *
 * Pins models=ecmwf_ifs025 rather than the default best_match: best_match
 * blends models and sources precipitation_probability separately from the
 * deterministic precipitation amount, so high-probability hours frequently
 * report 0.0 mm — which makes the (amount-driven) rain bars vanish. ECMWF IFS
 * is a single coherent global model whose amount tracks its probability in
 * every region tested, so the bars show wherever the watch is used.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildForecastUrl(lat, lon) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m,windgusts_10m,pressure_msl'
        + '&current=temperature_2m'
        + '&temperature_unit=fahrenheit'
        + '&windspeed_unit=kmh'
        + '&precipitation_unit=mm'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&models=ecmwf_ifs025'
        + '&forecast_days=2';
}

/**
 * Build a minimal Open-Meteo request for the derived hourly fields: 10m wind
 * gusts, apparent temperature (feels-like), dew point and 10m wind bearing. The
 * main forecast pins models=ecmwf_ifs025 for the rain bars, but ECMWF IFS
 * doesn't output derived fields (they come back all-null), so all four ride this
 * always-fetched best_match call instead — dew point and the bearing cost no
 * extra request, which is why neither needs a fetch gate. temperature_unit is
 * per-request, so the °F ask must repeat here (it governs dew point too, so the
 * dew mapper converts nothing). Mirrors the main request's unixtime/GMT/km-h
 * conventions and forecast_days so the hourly buckets line up with the main
 * window by timestamp.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed aux (gust/feels/dew/bearing) request URL.
 */
function buildGustUrl(lat, lon) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=windgusts_10m,apparent_temperature,dew_point_2m,wind_direction_10m'
        + '&current=apparent_temperature'
        + '&temperature_unit=fahrenheit'
        + '&windspeed_unit=kmh'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&forecast_days=2';
}

/**
 * Extract a FORECAST_HOURS window of one hourly series, aligned to a forecast
 * start time. Indexes the series by timestamp and reads forward from startTime
 * hour by hour, so an auxiliary feed whose array offset differs from the main
 * (ecmwf) forecast still lines up. Missing or non-numeric buckets become null;
 * each caller documents what its own null means.
 *
 * @param {Object} json Parsed Open-Meteo /v1/forecast response.
 * @param {string} field Name of the hourly series to read (e.g. 'dew_point_2m').
 * @param {number} startTime Window start in epoch seconds (the main forecast's startTime).
 * @returns {Array.<(number|null)>|null} FORECAST_HOURS values, or null when the
 *   response carries no usable hourly.time / hourly[field] arrays.
 */
function alignHourly(json, field, startTime) {
    var hourly = json && json.hourly;
    var times = hourly && hourly.time;
    var series = hourly && hourly[field];
    if (!hourly || !Array.isArray(times) || !Array.isArray(series)) {
        return null;
    }

    var byTime = {};
    var i;
    for (i = 0; i < times.length; i += 1) {
        byTime[times[i]] = series[i];
    }

    var out = [];
    var h;
    var value;
    for (h = 0; h < FORECAST_HOURS; h += 1) {
        value = byTime[startTime + h * HOUR_SECONDS];
        out.push(typeof value === 'number' ? value : null);
    }
    return out;
}

/**
 * Extract a FORECAST_HOURS gust window aligned to a forecast start time.
 * Missing or non-numeric buckets become null, which getPayload coerces to 0 —
 * i.e. rendered as no gust for that hour.
 *
 * @param {Object} json Parsed Open-Meteo /v1/forecast response carrying windgusts_10m.
 * @param {number} startTime Window start in epoch seconds (the main forecast's startTime).
 * @returns {Array.<(number|null)>|null} FORECAST_HOURS gust values in km/h (null where
 *   absent), or null when the response is malformed.
 */
function mapGusts(json, startTime) {
    return alignHourly(json, 'windgusts_10m', startTime);
}

/**
 * Extract a FORECAST_HOURS apparent-temperature window aligned to a forecast
 * start time. Missing/non-numeric buckets become null (adoptFeels backfills
 * those from the actual temperature).
 *
 * @param {Object} json Parsed Open-Meteo response carrying hourly.apparent_temperature.
 * @param {number} startTime Window start in epoch seconds.
 * @returns {Array.<(number|null)>|null} Feels values in °F, or null when malformed.
 */
function mapFeels(json, startTime) {
    return alignHourly(json, 'apparent_temperature', startTime);
}

/**
 * Extract a FORECAST_HOURS dew-point window aligned to a forecast start time.
 * No conversion: the aux request asks for temperature_unit=fahrenheit, and °F is
 * the repo's internal temperature unit. Missing/non-numeric buckets stay null —
 * a null head renders the dew slot as '--' rather than lying with a 0.
 *
 * @param {Object} json Parsed Open-Meteo response carrying hourly.dew_point_2m.
 * @param {number} startTime Window start in epoch seconds.
 * @returns {Array.<(number|null)>|null} Dew points in °F, or null when malformed.
 */
function mapDew(json, startTime) {
    return alignHourly(json, 'dew_point_2m', startTime);
}

/**
 * Extract a FORECAST_HOURS wind-bearing window aligned to a forecast start time,
 * normalized into [0, 360). Open-Meteo reports the meteorological "comes from"
 * convention, which is exactly what windDirTrend carries — the downwind flip the
 * arrow draws happens once, later, at bake time. Normalizing here keeps a feed
 * that reports 360 for north out of the sector arithmetic's 17th sector.
 *
 * @param {Object} json Parsed Open-Meteo response carrying hourly.wind_direction_10m.
 * @param {number} startTime Window start in epoch seconds.
 * @returns {Array.<(number|null)>|null} Bearings in degrees 0-359 (null where
 *   absent), or null when malformed.
 */
function mapWindDirection(json, startTime) {
    var raw = alignHourly(json, 'wind_direction_10m', startTime);
    if (!raw) { return null; }
    return raw.map(function(value) {
        return value === null ? null : ((value % 360) + 360) % 360;
    });
}

/**
 * Adopt dew point and wind bearing from the parsed aux (gust/feels) response.
 * Both ride that always-fetched call, so neither costs a request and neither
 * has a fetch gate — the work is one timestamp remap each. A malformed or absent
 * series leaves the provider's empty defaults, so the dew slot degrades to '--'
 * and the wind/gust slots simply draw no arrow. The two series are adopted
 * independently: a feed carrying only one must not block the other.
 *
 * @param {Object} provider Active provider (reads .startTime, writes .dewTrend/.windDirTrend).
 * @param {Object|null} json Parsed aux response, or null on parse failure.
 * @returns {void}
 */
function adoptDewAndDirection(provider, json) {
    if (!json) { return; }
    var dew = mapDew(json, provider.startTime);
    if (dew) { provider.dewTrend = dew; }
    var bearings = mapWindDirection(json, provider.startTime);
    if (bearings) { provider.windDirTrend = bearings; }
}

/**
 * Adopt apparent temperature from the parsed gust-call response into
 * provider.feelsTrend/currentFeels. Always parsed, no fetch gate: the call runs
 * for gusts anyway, so feels is free. Missing hourly buckets fall back to the
 * provider's (already-°F) tempTrend so the series stays numeric; a malformed
 * series or missing current leaves the defaults (line off, slot degrades).
 *
 * @param {Object} provider Active provider (reads .startTime/.tempTrend, writes .feelsTrend/.currentFeels).
 * @param {Object|null} json Parsed gust-call response, or null on parse failure.
 * @returns {void}
 */
function adoptFeels(provider, json) {
    // The request happens regardless (it carries the gusts), so the gate saves only
    // the timestamp-indexed remap — but it keeps "no feels selection" meaning no
    // feels data on every provider, so the temp slot degrades identically.
    if (!provider.fetchFeels) { return; }
    var feels = json ? mapFeels(json, provider.startTime) : null;
    var h;
    if (feels) {
        for (h = 0; h < feels.length; h += 1) {
            if (feels[h] === null) {
                feels[h] = provider.tempTrend[h];
            }
        }
        provider.feelsTrend = feels;
    }
    if (json && json.current && typeof json.current.apparent_temperature === 'number') {
        provider.currentFeels = json.current.apparent_temperature;
    }
}

/**
 * Build a minimal keyless Open-Meteo request for hourly UV index only. Uses the
 * default best_match model (the main forecast's ecmwf_ifs025 pin omits UV, and
 * DWD has no UV at all), mirroring the gust call's unixtime/GMT/forecast_days
 * conventions so buckets align with the main window by timestamp.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed UV request URL.
 */
function buildUvUrl(lat, lon) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=uv_index'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&forecast_days=2';
}

/**
 * Extract a FORECAST_HOURS UV window aligned to a forecast start time, indexing the
 * response's hourly uv_index by timestamp (so a feed whose offset differs still
 * lines up). Missing/non-numeric buckets become null (getPayload coerces to 0).
 * @param {Object} json Parsed Open-Meteo response carrying hourly.uv_index.
 * @param {number} startTime Window start in epoch seconds.
 * @returns {Array.<(number|null)>|null} UV values, or null when malformed.
 */
function mapUv(json, startTime) {
    return alignHourly(json, 'uv_index', startTime);
}

/**
 * Fetch UV from Open-Meteo into provider.uvTrend, but only when provider.fetchUv
 * is set (UV is on a line). Non-fatal: a failed/empty UV call just leaves uvTrend
 * untouched, so the UV line stays off rather than failing the whole forecast.
 * Shared by the Open-Meteo provider and the DWD fallback.
 * @param {Object} provider Active provider (reads .fetchUv/.startTime, writes .uvTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation (always called exactly once).
 * @returns {void}
 */
function fetchUvInto(provider, lat, lon, done) {
    if (!provider.fetchUv) { done(); return; }
    var uvUrl = buildUvUrl(lat, lon);
    request(uvUrl, 'GET', function(resp) {
        var uvs = null;
        try { uvs = mapUv(JSON.parse(resp), provider.startTime); }
        catch (ex) { uvs = null; }
        if (uvs) { provider.uvTrend = uvs; }
        done();
    }, function(err) {
        console.log('[!] Open-Meteo uv request failed: ' + JSON.stringify(err));
        done();
    });
}

OpenMeteoProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    var url = buildForecastUrl(lat, lon);
    request(url, 'GET', (function(response) {
        var json;
        var mapped;
        try {
            json = JSON.parse(response);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'openmeteo_parse_error'));
            return;
        }
        mapped = mapResponse(json, Math.floor(Date.now() / 1000));
        if (mapped === null) {
            onFailure(failure('provider_data', 'openmeteo_missing_fields'));
            return;
        }
        this.tempTrend = mapped.tempTrend;
        this.precipTrend = mapped.precipTrend;
        this.rainTrend = mapped.rainTrend;
        this.windTrend = mapped.windTrend;
        this.gustTrend = mapped.gustTrend; // ecmwf_ifs025 omits gusts (all null); the gust call below overrides when available
        this.pressureTrend = mapped.pressureTrend;
        this.startTime = mapped.startTime;
        this.currentTemp = mapped.currentTemp;
        // Feels rides the aux call below; reset per cycle so an aux failure on a
        // reused provider instance degrades to line-off instead of shipping the
        // previous window's values against the new startTime.
        this.feelsTrend = [];
        this.currentFeels = null;
        // Dew point and the wind bearing ride the same aux call, so they need
        // the same per-cycle reset: on a reused provider instance a stale window
        // would otherwise sit against the new startTime.
        this.dewTrend = [];
        this.windDirTrend = [];
        // ECMWF IFS (pinned for the rain bars) doesn't output 10m gusts,
        // apparent temperature, dew point or the wind bearing, so fetch them all
        // from best_match and align by timestamp. Non-fatal: a failed or empty
        // call just leaves the defaults, so the gust/feels lines stay hidden,
        // the dew slot shows '--' and the wind arrow is omitted rather than
        // failing the whole forecast.
        var gustUrl = buildGustUrl(lat, lon);
        request(gustUrl, 'GET', (function(gustResponse) {
            var aux = null;
            var gusts = null;
            try {
                aux = JSON.parse(gustResponse);
                gusts = mapGusts(aux, this.startTime);
            }
            catch (gustEx) {
                gusts = null;
            }
            if (gusts) {
                this.gustTrend = gusts;
            }
            adoptFeels(this, aux);
            adoptDewAndDirection(this, aux);
            fetchUvInto(this, lat, lon, onSuccess);
        }).bind(this), (function(gustError) {
            console.log('[!] Open-Meteo gust request failed: ' + JSON.stringify(gustError));
            fetchUvInto(this, lat, lon, onSuccess);
        }).bind(this));
    }).bind(this), function(error) {
        console.log('[!] Open-Meteo request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'openmeteo_' + error.code));
    });
};

module.exports = {
    mapResponse: mapResponse,
    buildForecastUrl: buildForecastUrl,
    buildGustUrl: buildGustUrl,
    mapGusts: mapGusts,
    mapFeels: mapFeels,
    adoptFeels: adoptFeels,
    mapDew: mapDew,
    mapWindDirection: mapWindDirection,
    adoptDewAndDirection: adoptDewAndDirection,
    buildUvUrl: buildUvUrl,
    mapUv: mapUv,
    fetchUvInto: fetchUvInto,
    OpenMeteoProvider: OpenMeteoProvider
};

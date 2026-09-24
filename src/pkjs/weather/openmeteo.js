var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var hourlyWindow = require('./hourly-window.js');
var dayPeaks = require('./day-peaks.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;

// hourly-window owns the anchor rule; Open-Meteo times are plain epoch arrays.
function anchorIndex(times, nowEpoch) {
    return hourlyWindow.anchorIndex(times, nowEpoch);
}

/**
 * A PRECEDING-HOUR series read onto the watch's slots: slot i takes the bucket
 * one after its own (anchor + 1 + i), the one stamped at the slot's END. Only
 * the last slot reaches past the instants' window, into the bucket after it;
 * when the response stops right at the window's end (a truncated, stale or
 * skewed one: the 72-bucket response anchored at bucket 48), that one slot
 * degrades to `fill` instead of failing the whole fetch — the degrade DWD
 * applies to a missing trailing record and mapGusts to a missing bucket. A
 * field array shorter than `time` still comes back short, so hasValidData
 * rejects it as before.
 *
 * @param {Array} series The hourly field array.
 * @param {number} anchor Index of slot 0's bucket.
 * @param {number} bucketCount hourly.time.length.
 * @param {*} fill Value for a last slot whose bucket is past the response.
 * @returns {Array} Up to FORECAST_HOURS values.
 */
function precedingHourSlice(series, anchor, bucketCount, fill) {
    var out = series.slice(anchor + 1, anchor + 1 + FORECAST_HOURS);
    if (anchor + FORECAST_HOURS === bucketCount && out.length === FORECAST_HOURS - 1) {
        out.push(fill);
    }
    return out;
}

/**
 * One cloud-cover bucket as a number: a null hour (a gap in the model output)
 * reads as 0 %, the same zero-fill the other providers apply, so the series stays
 * numeric and hour-aligned.
 * @param {*} v Raw bucket value.
 * @returns {number} Cloud cover percent, 0 when absent.
 */
function percentOrZero(v) {
    return typeof v === 'number' ? v : 0;
}

// The ECMWF IFS 0.25° ensemble's forecast step: its buckets fall on 00, 03,
// 06 … UTC.
var ENSEMBLE_STEP_SECONDS = 3 * HOUR_SECONDS;

/**
 * precipitation_probability under models=ecmwf_ifs025, read by 3-hour block.
 * Open-Meteo takes that model's chance from the IFS 0.25° ENSEMBLE, which only
 * has 3-hourly steps: the bucket stamped at a 3-hour UTC boundary T holds the
 * chance of rain in [T-3h, T), and the two stamps between boundaries are a
 * smooth (hermite) blend of the neighbouring blocks, as if each block's value
 * were an instant at its stamp. Read one bucket ahead like the rain, the
 * chance therefore peaked in the last hour of a wet block and trailed two
 * hours past it -- an hour behind the rain bars, which spread the same 3-hour
 * block's total evenly over its three hours. Slot i reads its own block's
 * boundary bucket instead: the first 3-hour boundary at or after the slot's
 * end. A block whose boundary is past the response keeps the one-bucket-ahead
 * value, and a short series stays short so hasValidData still rejects it.
 *
 * @param {Array} series hourly.precipitation_probability.
 * @param {Array.<number>} times hourly.time (epoch seconds, GMT hours).
 * @param {number} anchor Index of slot 0's bucket.
 * @returns {Array} Up to FORECAST_HOURS chances in %.
 */
function ensembleBlockSlice(series, times, anchor) {
    var out = precedingHourSlice(series, anchor, times.length, 0);
    var at = {};
    var i;
    var slotEnd;
    var block;
    for (i = 0; i < times.length; i += 1) {
        at[times[i]] = i;
    }
    for (i = 0; i < out.length; i += 1) {
        slotEnd = times[anchor] + (i + 1) * HOUR_SECONDS;
        block = at[Math.ceil(slotEnd / ENSEMBLE_STEP_SECONDS) * ENSEMBLE_STEP_SECONDS];
        if (block !== undefined && typeof series[block] === 'number') {
            out[i] = series[block];
        }
    }
    return out;
}

/**
 * Map an Open-Meteo forecast response into provider trend fields.
 *
 * Anchors the 24-hour window at the current wall-clock hour and slices each
 * hourly array forward from there (the window naturally spans into the next
 * day). Units pass through unconverted: the request asks Open-Meteo for °F,
 * km/h and mm directly, matching the provider unit convention.
 *
 * Two kinds of field, two offsets. Temperature, wind speed and pressure are
 * instants, read at the anchor. precipitation, precipitation_probability and
 * windgusts_10m are PRECEDING-HOUR values (Open-Meteo documents a sum, a
 * probability and a max "of the preceding hour"): the bucket stamped 16:00 is
 * the 15:00-16:00 hour. The watch draws slot i as the hour STARTING at
 * startTime + i h (bar i sits right of tick i), so those three read one bucket
 * ahead — slot i takes the bucket stamped startTime + (i + 1) h. Read at the
 * anchor, the current-hour bar showed the hour that had just ended and every
 * shower landed an hour late. (The settings page's Weather tab re-stamps the
 * same three fields the same way, weather-tab-model.js's startHourFields, so
 * a tap on 14:00 there reads the hour this slot shows.) The chance goes one
 * step further: the pinned model's comes from a 3-hourly ensemble, so each
 * slot reads its whole 3-hour block (ensembleBlockSlice).
 *
 * @param {Object} json Parsed Open-Meteo /v1/forecast response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {{tempTrend: number[], precipTrend: number[], rainTrend: number[], windTrend: number[], gustTrend: number[], pressureTrend: number[], cloudTrend: number[], startTime: number, currentTemp: number}|null}
 *   Mapped fields, or null when the response is malformed or has fewer than
 *   FORECAST_HOURS buckets at/after the current hour. (The last slot's
 *   preceding-hour values sit in the bucket after the window; a response
 *   without it reads that slot as dry — see precedingHourSlice.)
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
        // Preceding-hour fields: one bucket ahead (see the doc comment), the
        // chance by 3-hour block. forecast_days=3 at GMT is 72 buckets and the
        // anchor is at most 23, so the bucket after the window and the last
        // slot's block boundary are there for a well-formed response.
        precipTrend: ensembleBlockSlice(hourly.precipitation_probability, times, anchor)
            .map(function(p) {
                return p / 100;
            }),
        rainTrend: precedingHourSlice(hourly.precipitation, anchor, times.length, 0),
        // Wind reads on to PEAK_HOURS for the wind slot's day max (the 72
        // buckets always hold it); getPayload cuts it back to the graph's window.
        windTrend: hourly.windspeed_10m.slice(anchor, anchor + hourlyWindow.PEAK_HOURS),
        gustTrend: precedingHourSlice(hourly.windgusts_10m, anchor, times.length, null),
        // Optional, unlike the guarded fields above: an absent series degrades to
        // line-off rather than failing the whole fetch. Verified 2026-08-12 that the
        // pinned ecmwf_ifs025 model does emit pressure_msl (unlike windgusts_10m,
        // which it returns all-null — hence the separate gust call below).
        pressureTrend: Array.isArray(hourly.pressure_msl)
            ? hourly.pressure_msl.slice(anchor, end) : [],
        // Optional like pressure: total cloud cover (%) is an ECMWF IFS output, so it
        // rides the pinned main request. Absent → [] → the cloud line stays off.
        cloudTrend: Array.isArray(hourly.cloud_cover)
            ? hourly.cloud_cover.slice(anchor, end).map(percentOrZero) : [],
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
 * units and unixtime so the mapper does zero conversion, and forecast_days=3
 * (72 buckets) so a current-hour-anchored 24h window always fits along with
 * the bucket after it and the 3-hour ensemble boundary the chance reads for
 * its last slot (up to 00:00 GMT two days on, from a 22:00 or 23:00 anchor).
 *
 * Pins models=ecmwf_ifs025 rather than the default best_match: best_match
 * blends models and sources precipitation_probability separately from the
 * deterministic precipitation amount, so high-probability hours frequently
 * report 0.0 mm — which makes the (amount-driven) rain bars vanish. ECMWF IFS
 * is a single coherent global model whose amount tracks its probability in
 * every region tested, so the bars show wherever the watch is used. (Its
 * chance comes from the same model's ensemble, 3-hourly -- see
 * ensembleBlockSlice.)
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildForecastUrl(lat, lon) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m,windgusts_10m,pressure_msl,cloud_cover'
        + '&current=temperature_2m'
        + '&temperature_unit=fahrenheit'
        + '&windspeed_unit=kmh'
        + '&precipitation_unit=mm'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&models=ecmwf_ifs025'
        + '&forecast_days=3';
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
 * conventions so the hourly buckets line up with the main window by
 * timestamp. Two GMT days hold every bucket the graph's window reads (the gust's
 * startTime + 24 h included); four while the gust slot shows its day max, whose
 * window reads on to PEAK_HOURS (to the end of tomorrow, plus the
 * one-bucket-ahead stamp — in a zone ahead of GMT on a 25 h fall-back day that
 * lands on a fourth GMT day, as it does for UV). The other three fields keep
 * FORECAST_HOURS.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {boolean} [gustPeak] Whether the gust slot shows its day max.
 * @returns {string} Fully-formed aux (gust/feels/dew/bearing) request URL.
 */
function buildGustUrl(lat, lon, gustPeak) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        // The current dew point and wind join apparent_temperature as the Units
        // tab's Steadman "now" inputs (the hourly dew point is already here for
        // the dew slot); km/h and °F per the units below.
        + '&hourly=windgusts_10m,apparent_temperature,dew_point_2m,wind_direction_10m'
        + '&current=apparent_temperature,dew_point_2m,wind_speed_10m'
        + '&temperature_unit=fahrenheit'
        + '&windspeed_unit=kmh'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&forecast_days=' + (gustPeak ? 4 : 2);
}

// hourly-window owns the timestamp-indexed remap (air-quality.js shares it —
// its mapAqi used to be a byte-identical copy of this function).
var alignHourly = hourlyWindow.alignHourly;
// The Units tab's feels-like formula resolvers (provider value vs Steadman).
var feelsLike = require('./feels-like.js');

/**
 * Extract a PEAK_HOURS gust window aligned to a forecast start time — the
 * graph's FORECAST_HOURS plus the rest the gust slot's day max reads (getPayload
 * cuts the graph's part back out). windgusts_10m is the max "of the preceding
 * hour", so slot i (the hour starting at startTime + i h) reads the bucket
 * stamped one hour later — the same one-bucket-ahead rule mapResponse applies.
 * With the gust day max on, the aux call's four GMT days hold every stamp this needs. Missing or
 * non-numeric buckets become null, which getPayload coerces to 0 — i.e.
 * rendered as no gust for that hour.
 *
 * @param {Object} json Parsed Open-Meteo /v1/forecast response carrying windgusts_10m.
 * @param {number} startTime Window start in epoch seconds (the main forecast's startTime).
 * @returns {Array.<(number|null)>|null} PEAK_HOURS gust values in km/h (null where
 *   absent), or null when the response is malformed.
 */
function mapGusts(json, startTime) {
    return alignHourly(json, 'windgusts_10m', startTime + HOUR_SECONDS, hourlyWindow.PEAK_HOURS);
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
    var steadman = provider.feelsFormula === feelsLike.FORMULA_STEADMAN;
    var feels = json ? mapFeels(json, provider.startTime) : null;
    // The Steadman option takes its moisture from this call's dew point (the
    // series adoptDewAndDirection maps for the dew slot), not a relative
    // humidity: the temps are the main call's pinned ECMWF model while this call
    // is best_match, and an RH only means something at the temperature it was
    // computed for, whereas a dew point carries the moisture model's own vapour
    // pressure whichever T it is paired with (feelsLikeFromDewF). Read only
    // under Steadman: under 'provider' a response with a dew point but no
    // apparent_temperature still leaves the line off, as before.
    var dew = (steadman && json) ? mapDew(json, provider.startTime) : null;
    if (feels || dew) {
        // The resolver backfills: Steadman where computable, else the API value,
        // else that hour's (already-°F) temp. windTrend is the main call's km/h.
        provider.feelsTrend = feelsLike.resolveFeelsTrendFromDew(provider.feelsFormula, feels,
            provider.tempTrend, dew, provider.windTrend);
    }
    var current = json && json.current;
    if (current) {
        // km/h and °F: the aux request asks for both units explicitly.
        var currentFeels = feelsLike.resolveCurrentFeelsFromDew(provider.feelsFormula,
            current.apparent_temperature, provider.currentTemp,
            current.dew_point_2m, current.wind_speed_10m);
        if (currentFeels !== null) {
            provider.currentFeels = currentFeels;
        }
    }
}

/**
 * Build a minimal keyless Open-Meteo request for hourly UV index only,
 * mirroring the gust call's unixtime/GMT conventions so buckets align with the
 * main window by timestamp (the main forecast's ecmwf_ifs025 pin omits UV, and
 * DWD has no UV at all). Pins GFS: it is the source of Open-Meteo's UV almost
 * everywhere, and its UV is the MEAN of the hour ending at the stamp (built
 * from GFS's time-averaged UV-B flux) -- but best_match hands the UK and
 * Ireland to the Met Office UKV model, whose UV is an instant at the stamp, so
 * the same stamp meant two different hours depending on where the watch was.
 * With GFS everywhere, mapUv reads one bucket ahead for every location. Four
 * GMT days while the UV slot shows its day max (two hold the graph's window):
 * the UV window reaches PEAK_HOURS ahead so the UV slot can name TOMORROW's peak, the end of the phone's local tomorrow can fall on the
 * third GMT day (far-east zones early in their morning), and the one-bucket-
 * ahead read reaches an hour past that.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {boolean} [dayPeak] Whether the UV slot shows its day max.
 * @returns {string} Fully-formed UV request URL.
 */
function buildUvUrl(lat, lon, dayPeak) {
    return OPEN_METEO_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=uv_index'
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&models=ncep_gfs_global'
        + '&forecast_days=' + (dayPeak ? 4 : 2);
}

/**
 * Extract a PEAK_HOURS UV window aligned to a forecast start time — longer than the
 * forecast window, so the UV slot can place tomorrow's peak (the graph still takes
 * only the first FORECAST_HOURS; getPayload slices) — indexing the
 * response's hourly uv_index by timestamp (so a feed whose offset differs still
 * lines up). GFS UV is the mean of the hour ENDING at its stamp (buildUvUrl), so
 * entry i -- the hour starting at startTime + i h, where the UV slot's current
 * reading and the day peaks put it -- reads the bucket stamped an hour later,
 * the one-bucket-ahead rule the gust and rain follow. Read at its own stamp,
 * the UV and the day-max hold ran an hour late. Missing/non-numeric buckets
 * become null (getPayload coerces to 0).
 * @param {Object} json Parsed Open-Meteo response carrying hourly.uv_index.
 * @param {number} startTime Window start in epoch seconds.
 * @returns {Array.<(number|null)>|null} UV values, or null when malformed.
 */
function mapUv(json, startTime) {
    return alignHourly(json, 'uv_index', startTime + HOUR_SECONDS, hourlyWindow.PEAK_HOURS);
}

/**
 * Fetch UV from Open-Meteo into provider.uvTrend, but only when provider.fetchUv
 * is set (UV is on a line). Non-fatal: uvTrend is reset to [] before the call, so
 * a failed/empty UV call leaves the UV line off and the slot at '--' rather than
 * failing the whole forecast — or, on a reused provider instance, shipping the
 * previous cycle's window against the new startTime.
 * Shared by the Open-Meteo provider and the DWD fallback.
 * @param {Object} provider Active provider (reads .fetchUv/.startTime, writes .uvTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation (always called exactly once).
 * @returns {void}
 */
function fetchUvInto(provider, lat, lon, done) {
    if (!provider.fetchUv) { done(); return; }
    provider.uvTrend = []; // this fetch owns the field (see adoptMapped)
    var uvUrl = buildUvUrl(lat, lon, dayPeaks.wanted(provider, 'uv'));
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
    // requestMapped owns the parse/missing-fields/error-code grammar; adoptMapped
    // assigns the mapped forecast (gustTrend included — ecmwf_ifs025 returns
    // all-null gusts, so the aux call below overrides when available).
    WeatherProvider.requestMapped({
        url: buildForecastUrl(lat, lon), id: 'openmeteo', label: 'Open-Meteo',
        map: function(json) { return mapResponse(json, Math.floor(Date.now() / 1000)); }
    }, (function(mapped) {
        this.adoptMapped(mapped);
        // Feels, dew point and the wind bearing ride the aux call below — the
        // mapped shape lacks their keys, so reset them per cycle here: on a
        // reused provider instance an aux failure must degrade to line-off /
        // '--' / no arrow instead of shipping the previous window's values
        // against the new startTime.
        this.feelsTrend = [];
        this.currentFeels = null;
        this.dewTrend = [];
        this.windDirTrend = [];
        // ECMWF IFS (pinned for the rain bars) doesn't output 10m gusts,
        // apparent temperature, dew point or the wind bearing, so fetch them all
        // from best_match and align by timestamp. Non-fatal: a failed or empty
        // call just leaves the defaults, so the gust/feels lines stay hidden,
        // the dew slot shows '--' and the wind arrow is omitted rather than
        // failing the whole forecast.
        var gustUrl = buildGustUrl(lat, lon, dayPeaks.wanted(this, 'gust'));
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
    }).bind(this), onFailure);
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

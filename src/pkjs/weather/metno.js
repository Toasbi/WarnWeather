var WeatherProvider = require('./provider.js');
var metnoHeaders = require('./metno-headers.js');
var feelsLikeF = require('./feels-like.js').feelsLikeF;
var weightedCloudCover = require('./cloud-cover.js').weightedCloudCover;

var hourlyWindow = require('./hourly-window.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
// Shared unit helpers (wire-units.js owns them; local aliases keep call sites).
var celsiusToFahrenheit = require('../wire-units.js').celsiusToFahrenheit;
var normalizeBearing = require('../wire-units.js').normalizeBearing;
var LOCATIONFORECAST_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

/**
 * Convert metres/second to kilometres/hour, rounded to the nearest integer.
 *
 * @param {number} metersPerSecond Speed in m/s.
 * @returns {number} Speed in km/h, rounded.
 */
function msToKmh(metersPerSecond) {
    return Math.round(metersPerSecond * 3.6);
}

/**
 * Build the Met.no locationforecast request URL. Coordinates are limited to
 * 4 decimals (api.met.no rejects more with 403).
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildForecastUrl(lat, lon) {
    return LOCATIONFORECAST_BASE
        + '?lat=' + metnoHeaders.trunc4(lat)
        + '&lon=' + metnoHeaders.trunc4(lon);
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its time in epoch seconds (NaN when unparsable).
 */
function entryEpoch(entry) {
    return Math.round(Date.parse(entry.time) / 1000);
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {?Object} Its instant details, or null when it has none.
 */
function instantOf(entry) {
    return (entry && entry.data && entry.data.instant && entry.data.instant.details) || null;
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its clear-sky UV index, 0 when unreported.
 */
function entryUv(entry) {
    var instant = instantOf(entry);
    return (instant && typeof instant.ultraviolet_index_clear_sky === 'number')
        ? instant.ultraviolet_index_clear_sky : 0;
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its wind speed in km/h, 0 when unreported.
 */
function entryWindKmh(entry) {
    var instant = instantOf(entry);
    return msToKmh((instant && instant.wind_speed) || 0);
}

/**
 * The gust for the hour STARTING at bucket i. Met.no files wind_speed_of_gust
 * under `instant`, but its values behave as the peak of the hour ENDING at the
 * stamp: in recorded /complete responses the gust at T never falls below the
 * mean wind at T-1h or T, yet falls below the mean wind at T+1h -- which a
 * peak over [T, T+1h] cannot do -- and it tracks the wind's change into T,
 * not out of it. (Open-Meteo, which serves the same MET Nordic field, labels
 * it the maximum of the preceding hour.) So, like the Open-Meteo and DWD
 * gusts, slot i reads the next bucket's value. A next bucket that is missing
 * or not exactly an hour on reads as no gust, the degrade a missing field
 * already gets.
 *
 * @param {Array} timeseries The response's buckets.
 * @param {number} i Index of the slot's own bucket.
 * @returns {number} The gust in m/s, 0 when unreported.
 */
function followingGust(timeseries, i) {
    var next = timeseries[i + 1];
    var details = instantOf(next);
    if (!details || entryEpoch(next) !== entryEpoch(timeseries[i]) + HOUR_SECONDS) {
        return 0;
    }
    return details.wind_speed_of_gust || 0;
}

// The widest step hourlyTail fills: /complete turns 6-hourly past its hourly run.
var TAIL_MAX_STEP_HOURS = 6;

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {boolean} Whether it carries an air temperature.
 */
function hasAirTemp(entry) {
    var instant = instantOf(entry);
    return Boolean(instant) && typeof instant.air_temperature === 'number';
}

/**
 * A bucket's own copy to fill in: `data`, its `instant` and the instant's details are
 * new objects, so the parsed response is never modified.
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {Object} The copy.
 */
function copyBucket(entry) {
    var data = Object.assign({}, entry.data);
    data.instant = Object.assign({}, data.instant, { details: Object.assign({}, instantOf(entry)) });
    return { time: entry.time, data: data };
}

/**
 * The gust / wind ratio hourlyTail scales a 6-hourly hour's wind by: the bucket's own when it
 * has both (wind above 0), else the one carried so far.
 * @param {Object} entry A real locationforecast bucket.
 * @param {?number} carried The ratio of the last real bucket that had both, or null.
 * @returns {?number} The ratio to carry on.
 */
function gustRatio(entry, carried) {
    var instant = instantOf(entry);
    if (instant && typeof instant.wind_speed_of_gust === 'number'
        && typeof instant.wind_speed === 'number' && instant.wind_speed > 0) {
        return instant.wind_speed_of_gust / instant.wind_speed;
    }
    return carried;
}

/**
 * The hour at out[i]'s rain and chance from the 6-hour total covering it: the latest real
 * bucket at or before it whose next_6_hours spans it, spread evenly (amount / 6), its
 * probability as is. Synthesized buckets carry no next_6_hours, so only real ones govern.
 * @param {Array} out The buckets so far, hourly from the anchor.
 * @param {number} i The hour's index in out.
 * @returns {?Object} next_1_hours details, or null when no 6-hour total covers it.
 */
function next1FromSix(out, i) {
    var t = entryEpoch(out[i]);
    var k, at, six;
    for (k = i; k >= 0 && k > i - TAIL_MAX_STEP_HOURS; k -= 1) {
        six = out[k].data && out[k].data.next_6_hours && out[k].data.next_6_hours.details;
        at = entryEpoch(out[k]);
        if (six && at <= t && t < at + TAIL_MAX_STEP_HOURS * HOUR_SECONDS) {
            var details = {};
            if (typeof six.precipitation_amount === 'number') {
                details.precipitation_amount = six.precipitation_amount / TAIL_MAX_STEP_HOURS;
            }
            if (typeof six.probability_of_precipitation === 'number') {
                details.probability_of_precipitation = six.probability_of_precipitation;
            }
            return details;
        }
    }
    return null;
}

/**
 * out[i] with what the 6-hourly part of the feed lacks filled in, as a copy when anything
 * changes: next_1_hours from the 6-hour total (next1FromSix), and past the hourly run
 * (`tail`) the clear-sky UV of the same hour a day earlier (astronomical, so it repeats
 * daily; that hour is always on the hourly part) and the gust as the wind times the last
 * real gust / wind ratio (Nordics only: elsewhere there is no ratio and the gust stays
 * absent).
 * @param {Array} out The buckets so far, hourly from the anchor.
 * @param {number} i The bucket's index in out.
 * @param {boolean} tail Whether the bucket lies past the hourly run.
 * @param {?number} ratio gustRatio's carried ratio.
 * @returns {Object} The bucket, or a filled copy.
 */
function filledBucket(out, i, tail, ratio) {
    var entry = out[i];
    var next1 = entry.data && entry.data.next_1_hours ? null : next1FromSix(out, i);
    var instant = instantOf(entry);
    var dayAgo = out[i - 24];
    var uv = tail && typeof instant.ultraviolet_index_clear_sky !== 'number' && dayAgo
        && entryEpoch(dayAgo) === entryEpoch(entry) - 24 * HOUR_SECONDS ? instantOf(dayAgo) : null;
    var gust = tail && typeof instant.wind_speed_of_gust !== 'number' && ratio !== null
        && typeof instant.wind_speed === 'number';
    if (!next1 && !(uv && typeof uv.ultraviolet_index_clear_sky === 'number') && !gust) {
        return entry;
    }
    var copy = copyBucket(entry);
    var details = copy.data.instant.details;
    if (next1) { copy.data.next_1_hours = { details: next1 }; }
    if (uv && typeof uv.ultraviolet_index_clear_sky === 'number') {
        details.ultraviolet_index_clear_sky = uv.ultraviolet_index_clear_sky;
    }
    if (gust) { details.wind_speed_of_gust = details.wind_speed * ratio; }
    return copy;
}

/**
 * The bucket `k` hours after real bucket a on the way to b, `steps` hours on: every
 * instant number both carry, linear between them; the bearing held at a's (no circular
 * interpolation). UV, gust, rain and chance are left to filledBucket.
 * @param {Object} a The real bucket before.
 * @param {Object} b The real bucket after.
 * @param {number} k Hours after a (1..steps - 1).
 * @param {number} steps Hours from a to b.
 * @returns {Object} A new bucket stamped at a + k hours.
 */
function bucketBetween(a, b, k, steps) {
    var from = instantOf(a);
    var to = instantOf(b);
    var details = {};
    var key;
    for (key in from) {
        if (Object.prototype.hasOwnProperty.call(from, key)
            && typeof from[key] === 'number' && typeof to[key] === 'number') {
            details[key] = from[key] + (to[key] - from[key]) * k / steps;
        }
    }
    if (typeof from.wind_from_direction === 'number') {
        details.wind_from_direction = from.wind_from_direction;
    }
    delete details.ultraviolet_index_clear_sky;
    delete details.wind_speed_of_gust;
    return {
        time: new Date((entryEpoch(a) + k * HOUR_SECONDS) * 1000).toISOString(),
        data: { instant: { details: details } }
    };
}

/**
 * Met.no's /complete buckets from the anchor, made hourly to the long span's end: the
 * hourly run as is, then one bucket per hour synthesized between the 6-hourly ones, up to
 * anchor + hours + 1 (followingGust reads one bucket past the last slot). /complete is
 * hourly only to a fixed model time (57 to 63 hours from the anchor in recorded
 * responses), which would leave the long span short and the watch's pitch wider.
 * Temperatures and the other instants run linearly between the real buckets, rain spreads
 * each 6-hour total evenly over its hours (totals conserved), clear-sky UV repeats the day
 * before and the Nordic gust follows the wind (filledBucket); a real bucket in the window
 * without next_1_hours gets it the same way. Stops at the feed's end, before a real bucket
 * without an air temperature, and at a step that is not a whole 1 to 6 hours.
 * @param {Array} timeseries The response's buckets, ascending.
 * @param {number} anchor Index of entry 0 (a valid anchorIndex result).
 * @param {number} hours The graph's window (windowHours), > PEAK_HOURS.
 * @returns {Array} A new array of buckets, indexed like the input up to the hourly run's
 *   end (the input is not modified).
 */
function hourlyTail(timeseries, anchor, hours) {
    var end = anchor + hours + 1;
    var run = hourlyWindow.hourlyRun(timeseries, anchor, hours + 1, entryEpoch);
    var out = timeseries.slice(0, anchor + run);
    var ratio = null;
    var i, j, k, a, b, steps;
    for (i = anchor; i < out.length; i += 1) {
        ratio = gustRatio(out[i], ratio);
        out[i] = filledBucket(out, i, false, ratio);
    }
    for (j = anchor + run - 1; out.length < end && j + 1 < timeseries.length; j += 1) {
        a = timeseries[j];
        b = timeseries[j + 1];
        steps = (entryEpoch(b) - entryEpoch(a)) / HOUR_SECONDS;
        if (!hasAirTemp(a) || !hasAirTemp(b) || !(steps >= 1 && steps <= TAIL_MAX_STEP_HOURS)
            || Math.floor(steps) !== steps) {
            break;
        }
        for (k = 1; k <= steps && out.length < end; k += 1) {
            out.push(k < steps ? bucketBetween(a, b, k, steps) : b);
            out[out.length - 1] = filledBucket(out, out.length - 1, true, ratio);
        }
        ratio = gustRatio(b, ratio);
    }
    return out;
}

/**
 * Map a Met.no locationforecast response into provider trend fields.
 *
 * Anchors the window (24 hours, or `hours` for emery's long span) at the
 * current wall-clock hour (the series starts at the last full hour, so the
 * anchor scan only guards against a stale response) and converts to the provider unit convention: °F, km/h,
 * mm/h, probability as a 0..1 fraction, wind bearing in "comes from" degrees.
 * probability_of_precipitation and wind_speed_of_gust exist in the Nordics only
 * — missing values read 0, they are not a failure (the "(Nordics only)" label
 * documents the scope). Rain and chance come from next_1_hours, the hour that
 * starts at the stamp, so slot i reads its own bucket; the gust is the peak of
 * the hour ending at the stamp, so it reads the next one (followingGust).
 *
 * Met.no is hourly to about 60 h and 6-hourly after. The long span's window (past
 * PEAK_HOURS: 68) has the 6-hourly part made hourly first (hourlyTail); every
 * other window maps the response as it is. Past the base 24 a window ends early
 * (hourlyRun) at a step that is not the next hour, at the feed's end, or at a
 * bucket without a temperature.
 *
 * @param {Object} json Parsed locationforecast/2.0/complete response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @param {number} [hours] The window to map (hourly-window.js windowHours);
 *   FORECAST_HOURS when absent.
 * @returns {{tempTrend: number[], precipTrend: number[], rainTrend: number[],
 *   windTrend: number[], gustTrend: number[], uvTrend: number[],
 *   pressureTrend: number[], feelsTrend: number[], dewTrend: Array.<?number>,
 *   windDirTrend: Array.<?number>, startTime: number, currentTemp: number,
 *   currentFeels: ?number}|null} Mapped fields, or null when the response is
 *   malformed or has fewer than FORECAST_HOURS hourly buckets at/after the
 *   current hour.
 */
function mapResponse(json, nowEpoch, hours) {
    var timeseries = json && json.properties && json.properties.timeseries;
    if (!Array.isArray(timeseries)) {
        return null;
    }
    // hourly-window owns the anchor rule; an unparsable time yields NaN, which
    // never anchors — the same skip the old inline isFinite check performed.
    var anchor = hourlyWindow.anchorIndex(timeseries, nowEpoch, entryEpoch);
    var i;
    if (anchor < 0 || timeseries.length - anchor < FORECAST_HOURS) {
        return null;
    }
    // The long span only, so every 24 h payload maps the response as it always has.
    if (hours > hourlyWindow.PEAK_HOURS) {
        timeseries = hourlyTail(timeseries, anchor, hours);
    }

    var tempTrend = [];
    var precipTrend = [];
    var rainTrend = [];
    var pressureTrend = [];
    var cloudTrend = [];
    var feelsTrend = [];
    var dewTrend = [];
    var windDirTrend = [];
    var currentFeels = null;
    var entry;
    var instant;
    var next1;
    var tempF;
    var feels;
    var count = hourlyWindow.hourlyRun(timeseries, anchor, hours || FORECAST_HOURS, entryEpoch);
    for (i = anchor; i < anchor + count; i += 1) {
        entry = timeseries[i];
        instant = instantOf(entry);
        next1 = entry.data && entry.data.next_1_hours && entry.data.next_1_hours.details;
        if (!instant || typeof instant.air_temperature !== 'number') {
            // Past the base 24 hours (the long span) a bucket without a temperature
            // ends the window; inside them it fails the fetch, as it always has.
            if (i - anchor >= FORECAST_HOURS) { break; }
            return null;
        }
        tempF = celsiusToFahrenheit(instant.air_temperature);
        tempTrend.push(tempF);
        // Steadman-computed (no Met.no feels field). Wind converts unrounded
        // (m/s × 3.6, not msToKmh's integer round); missing wind reads 0 like
        // windTrend, missing humidity → fall back to the plain temp so the
        // series stays numeric.
        feels = feelsLikeF(tempF, instant.relative_humidity, (instant.wind_speed || 0) * 3.6);
        if (i === anchor) {
            // Anchor bucket doubles as "now" (currentTemp precedent); missing →
            // null so FEELS_CURRENT is omitted rather than echoing the temp.
            currentFeels = feels;
        }
        feelsTrend.push(feels === null ? tempF : feels);
        pressureTrend.push(typeof instant.air_pressure_at_sea_level === 'number'
            ? instant.air_pressure_at_sea_level : 0);
        // Cloud cover, %: the /complete layers weighted by cloud-cover.js (thin
        // high cloud counts half); an hour without them keeps its total, one
        // with neither reads as clear sky.
        cloudTrend.push(weightedCloudCover(instant.cloud_area_fraction_low,
            instant.cloud_area_fraction_medium, instant.cloud_area_fraction_high,
            instant.cloud_area_fraction));
        // Dew point and bearing degrade to null, not 0, and keep their slot so the
        // series stays hour-aligned: 0 is a valid bearing (due north) and 0 °F a
        // plausible dew point, so a fabricated zero would render as a lie. A null
        // head reads as '--' in the dew slot / no arrow on the wind slot.
        dewTrend.push(typeof instant.dew_point_temperature === 'number'
            ? celsiusToFahrenheit(instant.dew_point_temperature) : null);
        // Meteorological "comes from" degrees, as reported; the downwind flip the
        // arrow draws happens once, later, at bake time.
        windDirTrend.push(typeof instant.wind_from_direction === 'number'
            ? normalizeBearing(instant.wind_from_direction) : null);
        // next_1_hours holds the mm falling in this 1-h bucket — i.e. mm/h.
        rainTrend.push((next1 && typeof next1.precipitation_amount === 'number')
            ? next1.precipitation_amount : 0);
        precipTrend.push((next1 && typeof next1.probability_of_precipitation === 'number')
            ? next1.probability_of_precipitation / 100 : 0);
    }

    return {
        tempTrend: tempTrend,
        precipTrend: precipTrend,
        rainTrend: rainTrend,
        // The day-max series (UV, wind, gusts) read on to PEAK_HOURS, or the
        // graph's window when longer (hourly-window.js reachHours). Met.no turns
        // 6-hourly after its first ~2.5 days, which readHourly's next-hour rule
        // stops at (the long span's hourlyTail fills those hours in first).
        windTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.reachHours(hours),
            entryEpoch, entryWindKmh),
        gustTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.reachHours(hours),
            entryEpoch, function(entry, index) { return msToKmh(followingGust(timeseries, index)); }),
        uvTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.reachHours(hours),
            entryEpoch, entryUv),
        pressureTrend: pressureTrend,
        cloudTrend: cloudTrend,
        feelsTrend: feelsTrend,
        dewTrend: dewTrend,
        windDirTrend: windDirTrend,
        startTime: entryEpoch(timeseries[anchor]),
        currentTemp: celsiusToFahrenheit(timeseries[anchor].data.instant.details.air_temperature),
        currentFeels: currentFeels
    };
}

var MetnoProvider = function() {
    this._super.call(this);
    this.name = 'Met.no';
    this.id = 'metno';
};

MetnoProvider.prototype = Object.create(WeatherProvider.prototype);
MetnoProvider.prototype.constructor = MetnoProvider;
MetnoProvider.prototype._super = WeatherProvider;

MetnoProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // requestMapped owns the parse/missing-fields/error-code grammar; adoptMapped
    // owns the field adoption and both aux gates. Everything in the mapped shape
    // rides the one /complete response: dew point and bearing come free (no
    // per-hour arithmetic worth gating), feels costs a Steadman exp() per hour so
    // mapResponse computes it but the gate decides whether it lands, and
    // clear-sky uv is adopted only when something renders it.
    // The graph's window: 24 hours, or emery's 26 or 68 (fetch-options.js).
    var hours = hourlyWindow.windowHours(this.options);
    WeatherProvider.requestMapped({
        url: buildForecastUrl(lat, lon), id: 'metno', label: 'Met.no',
        headers: metnoHeaders.HEADERS,
        map: function(json) { return mapResponse(json, Math.floor(Date.now() / 1000), hours); }
    }, (function(mapped) {
        this.adoptMapped(mapped);
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = {
    mapResponse: mapResponse,
    hourlyTail: hourlyTail,
    buildForecastUrl: buildForecastUrl,
    MetnoProvider: MetnoProvider
};

var storageKeys = require('../storage-keys.js');

var CACHE_KEY = storageKeys.WU_HOURLY_CACHE_KEY;

// Two fetches this close (degrees, on each axis — about 5.5 km of latitude)
// count as the same place: wide enough to absorb the jitter between GPS fixes,
// tight enough that another location's forecast hour is never reused.
var SAME_PLACE_DEGREES = 0.05;

/**
 * Read the persisted bucket cache. Returns a fresh {} on missing/corrupt data
 * (clearing the corrupt value), so callers never see a parse error.
 * @returns {Object<string, Object>} Map of fcst_valid (string) → stored bucket.
 */
function readCache() {
    var raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) {
        return {};
    }
    try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
        return {};
    }
    catch (ex) {
        localStorage.removeItem(CACHE_KEY);
        return {};
    }
}

/**
 * Persist the bucket cache.
 * @param {Object<string, Object>} cache Map of fcst_valid (string) → bucket.
 * @returns {void}
 */
function writeCache(cache) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/**
 * Delete cache entries for hours that have already passed.
 * @param {Object<string, Object>} cache Map of fcst_valid (string) → bucket.
 * @param {number} hourFloor Current wall-clock hour, epoch seconds.
 * @returns {void}
 */
function prunePast(cache, hourFloor) {
    var keys = Object.keys(cache);
    var i;
    for (i = 0; i < keys.length; i += 1) {
        if (Number(keys[i]) < hourFloor) {
            delete cache[keys[i]];
        }
    }
}

/**
 * Copy only the fields the trend mapping consumes, so cached buckets stay small.
 * @param {Object} entry A WU hourly forecast entry.
 * @returns {{fcst_valid: number, temp: *, pop: *, qpf: *, wspd: *, gust: *, uv_index: *, feels_like: *, rh: *, mslp: *, clds: *, dewpt: *, wdir: *}} Picked bucket.
 */
function pickBucket(entry) {
    return {
        fcst_valid: entry.fcst_valid,
        temp: entry.temp,
        pop: entry.pop,
        qpf: entry.qpf,
        wspd: entry.wspd,
        gust: entry.gust,
        uv_index: entry.uv_index,
        feels_like: entry.feels_like,
        // Relative humidity: the Steadman feels-like option's input for the
        // reconstructed current hour (feels-like.js resolveFeelsTrend).
        rh: entry.rh,
        mslp: entry.mslp,
        clds: entry.clds,
        // Whitelist, so anything missing here vanishes from the reconstructed
        // current hour: dewpt feeds the dew slot, wdir the wind-direction arrow.
        dewpt: entry.dewpt,
        wdir: entry.wdir
    };
}

/**
 * Whether a cached bucket was captured at (about) the given coordinates. An
 * entry without numeric coordinates (captured before they were stored) never
 * matches, so it falls back to the cold-start clone rather than risk borrowing
 * another location's hour.
 * @param {Object} stored Cached bucket carrying its capture lat/lon.
 * @param {number} lat Current latitude.
 * @param {number} lon Current longitude.
 * @returns {boolean} True when both axes are within SAME_PLACE_DEGREES.
 */
function capturedNear(stored, lat, lon) {
    if (typeof stored.lat !== 'number' || typeof stored.lon !== 'number') {
        return false;
    }
    var dLat = Math.abs(stored.lat - lat);
    var dLon = Math.abs(stored.lon - lon);
    // NaN (unknown current coordinates) fails both comparisons → no reuse.
    return dLat <= SAME_PLACE_DEGREES && dLon <= SAME_PLACE_DEGREES;
}

/**
 * Build a current-hour bucket: the consumed fields of `source`, stamped
 * with the current hour.
 * @param {Object} source Bucket to clone.
 * @param {number} hourFloor Current wall-clock hour, epoch seconds.
 * @returns {Object} Current-hour bucket.
 */
function currentHourBucket(source, hourFloor) {
    var b = pickBucket(source);
    b.fcst_valid = hourFloor;
    return b;
}

/**
 * Anchor a Wunderground hourly forecast to the current wall-clock hour. Drops
 * past buckets; when WU's rounded-up feed has dropped the in-progress hour, a
 * current-hour bucket is prepended: the real forecast captured for that hour
 * last cycle when it was captured at this location, else a clone of the
 * soonest available bucket.
 * @param {Object[]} rawForecast WU `forecasts` array, ascending by fcst_valid.
 * @param {number} hourFloor Current wall-clock hour floored to epoch seconds.
 * @param {number|string} lat Latitude of this fetch (manual/geocoded ones arrive as strings).
 * @param {number|string} lon Longitude of this fetch.
 * @returns {Object[]} Forecast anchored at the current hour (index 0).
 */
function anchorForecast(rawForecast, hourFloor, lat, lon) {
    var latNum = Number(lat);
    var lonNum = Number(lon);
    var cache = readCache();
    prunePast(cache, hourFloor);

    var filtered = [];
    var i;
    for (i = 0; i < rawForecast.length; i += 1) {
        if (rawForecast[i].fcst_valid >= hourFloor) {
            filtered.push(rawForecast[i]);
        }
    }

    var corrected;
    if (filtered.length === 0 || filtered[0].fcst_valid > hourFloor) {
        // WU dropped the in-progress hour: reuse the real forecast captured for
        // it last cycle — only at the same place, or a location change would
        // show the old location's hour — else clone the soonest bucket as a
        // cold-start fallback.
        var cachedKey = String(hourFloor);
        var cached = Object.prototype.hasOwnProperty.call(cache, cachedKey)
            ? cache[cachedKey] : null;
        var source = (cached && capturedNear(cached, latNum, lonNum))
            ? cached
            : (filtered[0] || rawForecast[0]);
        corrected = [currentHourBucket(source, hourFloor)].concat(filtered);
    }
    else {
        corrected = filtered;
    }

    // Capture the soonest upcoming bucket so it is the cached real forecast for
    // the in-progress hour on a fetch during the next hour, stamped with where
    // it was fetched (currentHourBucket re-picks the fields, so the stamp never
    // reaches the trends).
    for (i = 0; i < rawForecast.length; i += 1) {
        if (rawForecast[i].fcst_valid > hourFloor) {
            var captured = pickBucket(rawForecast[i]);
            captured.lat = latNum;
            captured.lon = lonNum;
            cache[String(rawForecast[i].fcst_valid)] = captured;
            break;
        }
    }

    writeCache(cache);
    return corrected;
}

module.exports = {
    anchorForecast: anchorForecast
};

var storageKeys = require('../storage-keys.js');

var CACHE_KEY = storageKeys.WU_HOURLY_CACHE_KEY;

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
 * @returns {{fcst_valid: number, temp: *, pop: *, qpf: *, wspd: *, gust: *, uv_index: *}} Picked bucket.
 */
function pickBucket(entry) {
    return {
        fcst_valid: entry.fcst_valid,
        temp: entry.temp,
        pop: entry.pop,
        qpf: entry.qpf,
        wspd: entry.wspd,
        gust: entry.gust,
        uv_index: entry.uv_index
    };
}

/**
 * Build a current-hour bucket: the seven consumed fields of `source`, stamped
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
 * current-hour bucket cloned from the soonest available bucket is prepended.
 * @param {Object[]} rawForecast WU `forecasts` array, ascending by fcst_valid.
 * @param {number} hourFloor Current wall-clock hour floored to epoch seconds.
 * @returns {Object[]} Forecast anchored at the current hour (index 0).
 */
function anchorForecast(rawForecast, hourFloor) {
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
        // it last cycle, else clone the soonest bucket as a cold-start fallback.
        var cachedKey = String(hourFloor);
        var source = Object.prototype.hasOwnProperty.call(cache, cachedKey)
            ? cache[cachedKey]
            : (filtered[0] || rawForecast[0]);
        corrected = [currentHourBucket(source, hourFloor)].concat(filtered);
    }
    else {
        corrected = filtered;
    }

    // Capture the soonest upcoming bucket so it is the cached real forecast for
    // the in-progress hour on a fetch during the next hour.
    for (i = 0; i < rawForecast.length; i += 1) {
        if (rawForecast[i].fcst_valid > hourFloor) {
            cache[String(rawForecast[i].fcst_valid)] = pickBucket(rawForecast[i]);
            break;
        }
    }

    writeCache(cache);
    return corrected;
}

module.exports = {
    anchorForecast: anchorForecast
};

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
    var filtered = [];
    var i;
    for (i = 0; i < rawForecast.length; i += 1) {
        if (rawForecast[i].fcst_valid >= hourFloor) {
            filtered.push(rawForecast[i]);
        }
    }

    if (filtered.length === 0 || filtered[0].fcst_valid > hourFloor) {
        var source = filtered[0] || rawForecast[0];
        return [currentHourBucket(source, hourFloor)].concat(filtered);
    }
    return filtered;
}

module.exports = {
    anchorForecast: anchorForecast
};

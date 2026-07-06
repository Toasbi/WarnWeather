/**
 * Radar tuples that clear any existing radar on the watch (empty trend
 * arrays + zero start). Matches the legacy base-provider "send [] to clear"
 * behavior so disabling radar removes it from the watch.
 *
 * @returns {{RAIN_RADAR_TREND_UINT8: number[], RAIN_RADAR_TREND_AREA_UINT8: number[], RAIN_RADAR_START: number}}
 */
function clearRadarTuples() {
    return { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
}

/**
 * Decide which radar tuples to ship based on the configured radar provider,
 * using pre-resolved coordinates (single per-cycle acquisition).
 *
 * @param {string} radarProvider Configured radar source ('dwd', 'rainbow' or 'disabled').
 * @param {Object} deps Dependencies.
 * @param {number} deps.lat Latitude in decimal degrees.
 * @param {number} deps.lon Longitude in decimal degrees.
 * @param {number} deps.slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} deps.fetchDwdAt fetchDwdAt(lat, lon, slotZeroEpoch, cb) -> cb(tuples|null).
 * @param {Function} deps.fetchRainbowAt fetchRainbowAt(endpoint, lat, lon, slotZeroEpoch, cb) -> cb(tuples|null).
 * @param {string} deps.rainbowEndpoint Rainbow proxy URL ('' when the build carries none).
 * @param {Function} callback Receives a radar tuples object, or null to preserve
 *   the watch's existing radar (transient provider failure).
 * @returns {void}
 */
function dispatchRadarTuplesAt(radarProvider, deps, callback) {
    if (radarProvider === 'dwd') {
        deps.fetchDwdAt(deps.lat, deps.lon, deps.slotZeroEpoch, callback);
        return;
    }
    if (radarProvider === 'rainbow') {
        deps.fetchRainbowAt(deps.rainbowEndpoint, deps.lat, deps.lon, deps.slotZeroEpoch, callback);
        return;
    }
    // 'disabled' or any unknown/unset value: clear radar on the watch.
    callback(clearRadarTuples());
}

module.exports = {
    dispatchRadarTuplesAt: dispatchRadarTuplesAt,
    clearRadarTuples: clearRadarTuples
};

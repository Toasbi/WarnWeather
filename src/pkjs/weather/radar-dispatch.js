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
 * independent of the forecast provider.
 *
 * @param {string} radarProvider Configured radar source ('dwd' or 'disabled').
 * @param {Object} deps Dependencies.
 * @param {Object} deps.provider Coordinate source (exposes withCoordinates).
 * @param {number} deps.slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} deps.fetchDwd fetchDwd(provider, slotZeroEpoch, cb) -> cb(tuples|null).
 * @param {Function} callback Receives a radar tuples object, or null to preserve
 *   the watch's existing radar (DWD transient failure).
 * @returns {void}
 */
function dispatchRadarTuples(radarProvider, deps, callback) {
    if (radarProvider === 'dwd') {
        deps.fetchDwd(deps.provider, deps.slotZeroEpoch, callback);
        return;
    }
    // 'disabled' or any unknown/unset value: clear radar on the watch.
    callback(clearRadarTuples());
}

module.exports = {
    dispatchRadarTuples: dispatchRadarTuples,
    clearRadarTuples: clearRadarTuples
};

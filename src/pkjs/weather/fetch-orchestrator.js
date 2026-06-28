// src/pkjs/weather/fetch-orchestrator.js
// Resolve device coordinates ONCE per refresh cycle, then drive radar and
// forecast from that single fix. Keeping this pure (deps injected) makes the
// single-acquisition invariant unit-testable without the Pebble runtime.

/**
 * @param {Object} deps
 * @param {Object} deps.provider Provider exposing withCoordinates + fetchWithCoordinates.
 * @param {Function} deps.fetchRadar fetchRadar(lat, lon, cb) -> cb(radarTuples|null).
 * @param {Function} deps.buildExtras buildExtras(radarTuples|null) -> extra-payload object.
 * @param {Function} deps.onSuccess Forecast success callback.
 * @param {Function} deps.onFailure onFailure(failure) for coordinate or forecast failure.
 * @param {boolean} deps.force Whether to force a provider refetch.
 * @param {Function} [deps.payloadTransform] Optional payload transform.
 * @returns {void}
 */
function runFetchCycle(deps) {
    deps.provider.withCoordinates(function(lat, lon) {
        deps.fetchRadar(lat, lon, function(radarTuples) {
            var extras = deps.buildExtras(radarTuples);
            deps.provider.fetchWithCoordinates(
                lat, lon, deps.onSuccess, deps.onFailure, deps.force, extras, deps.payloadTransform
            );
        });
    }, function(coordinateFailure) {
        deps.onFailure(coordinateFailure || { category: 'coordinates', code: 'unknown_error' });
    });
}

module.exports = {
    runFetchCycle: runFetchCycle
};

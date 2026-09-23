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
 * @param {Function} deps.onFailure onFailure(failure, radarTuples) for coordinate or
 *   forecast failure. radarTuples is this cycle's radar answer (tuples or null) on a
 *   forecast failure — the extras that carried it are never sent then — and
 *   undefined on a coordinate failure (no radar was fetched).
 * @param {boolean} deps.force Whether to force a provider refetch.
 * @param {Function} [deps.payloadTransform] Optional payload transform.
 * @param {function(): boolean} [deps.isCurrent] False once the caller gave up on
 *   this cycle (its watchdog fired): the rest of the chain then stops instead of
 *   spending requests and sending a stale payload.
 * @returns {void}
 */
function runFetchCycle(deps) {
    deps.provider.withCoordinates(function(lat, lon) {
        // A fix that arrives after the caller abandoned the cycle (a geolocation
        // callback minutes late) starts no radar/geocode/provider requests.
        if (typeof deps.isCurrent === 'function' && !deps.isCurrent()) {
            console.log('Dropping coordinates for an abandoned weather fetch.');
            return;
        }
        deps.fetchRadar(lat, lon, function(radarTuples) {
            var extras = deps.buildExtras(radarTuples);
            deps.provider.fetchWithCoordinates(
                lat, lon, deps.onSuccess,
                function(failure) { deps.onFailure(failure, radarTuples); },
                deps.force, extras, deps.payloadTransform, deps.isCurrent
            );
        });
    }, function(coordinateFailure) {
        deps.onFailure(coordinateFailure || { stage: 'coordinates', code: 'unknown_error' });
    });
}

module.exports = {
    runFetchCycle: runFetchCycle
};

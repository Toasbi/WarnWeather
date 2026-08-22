// src/pkjs/weather/http.js — the generic XHR helper and the normalized
// failure shape every fetch stage speaks ({stage, code}). A LEAF module:
// provider.js re-exports request/failure as WeatherProvider statics for the
// adapters, while the auxiliary fetches (air-quality.js, pollen.js) require
// this file directly — they used to lazy-require provider.js from inside
// function bodies to dodge the cycle provider.js's top-level requires of them
// created around its own helper.

var XHR_TIMEOUT_MS = 5000;

/**
 * Perform an HTTP request and return response text.
 *
 * @param {string} url Request URL.
 * @param {string} type HTTP method.
 * @param {Function} onSuccess Callback with response text.
 * @param {Function} onFailure Callback with error details.
 * @param {Object} [headers] Optional request headers ({name: value}). Each one
 *   is set individually in try/catch: some runtimes forbid certain headers
 *   (e.g. User-Agent) and must not abort the request.
 * @param {string} [body] Optional request body (e.g. a GraphQL POST payload).
 *   Omitted/empty → sent as a bodyless request, identical to the prior behavior.
 * @returns {void}
 */
function request(url, type, onSuccess, onFailure, headers, body) {
    var xhr = new XMLHttpRequest();
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            onSuccess(this.responseText);
            return;
        }
        onFailure({
            code: 'status_' + xhr.status,
            detail: 'http_status'
        });
    };
    xhr.onerror = function() {
        onFailure({
            code: 'network_error',
            detail: 'xhr_error'
        });
    };
    xhr.ontimeout = function() {
        onFailure({
            code: 'timeout',
            detail: 'xhr_timeout'
        });
    };
    xhr.open(type, url);
    if (headers) {
        for (var name in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, name)) {
                try {
                    xhr.setRequestHeader(name, headers[name]);
                }
                catch (ex) {
                    // Runtime forbids this header — the others still identify us.
                }
            }
        }
    }
    xhr.send(body || undefined);
}

/**
 * Build a normalized fetch failure payload.
 *
 * @param {string} stage Failure stage identifier.
 * @param {string} code Failure code identifier.
 * @returns {{stage: string, code: string}} Normalized failure object.
 */
function failure(stage, code) {
    return {
        stage: stage,
        code: code
    };
}

module.exports = {
    request: request,
    failure: failure
};

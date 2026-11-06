'use strict';

// JSON over the plugin engine's fetch. A plugin has fetch, not XMLHttpRequest, and only reaches the
// hosts its manifest declares and the user allowed: a refused host rejects with a NotAllowedError,
// which the source reports as PERMISSION_DENIED.

/**
 * GET a URL and parse its JSON body.
 *
 * @param {string} url URL.
 * @returns {Promise<*>} The parsed body. Rejects with an Error carrying `status` for a non-2xx
 *   answer, or with fetch's own error (NotAllowedError for a refused host).
 */
async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * Whether an error means the user hasn't allowed something (a host, or location).
 *
 * @param {*} error Error.
 * @returns {boolean} True for a permission refusal.
 */
function isPermissionError(error) {
  return Boolean(error) && (error.name === 'NotAllowedError' || error.code === 'PERMISSION_DENIED'
    || error.permission === true);
}

/**
 * A short, data-free description of an error for the log: its HTTP status or its name. Never the
 * URL, which carries the place's coordinates.
 *
 * @param {*} error Error.
 * @returns {string} e.g. 'HTTP 503' or 'NotAllowedError'.
 */
function describe(error) {
  if (error && error.status) {
    return 'HTTP ' + error.status;
  }
  if (error && error.permission) {
    return 'location refused';
  }
  return (error && error.name) || 'error';
}

module.exports = { getJson, isPermissionError, describe };

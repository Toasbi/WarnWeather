// test/helpers/rebake-host.js
// The host status-rebake.js init() takes from index.js: the storage of its restart backstop
// and its clock. The storage reads whatever global.localStorage the test has installed.

/** The global localStorage at the time of each call. */
const liveStorage = {
  getItem: (k) => global.localStorage.getItem(k),
  setItem: (k, v) => global.localStorage.setItem(k, v),
  removeItem: (k) => global.localStorage.removeItem(k),
};

/**
 * init() options with the host's storage and clock, overridden by the test's own.
 * @param {Object} [opts] The test's options.
 * @returns {Object} The options to pass to statusRebake.init.
 */
function withHost(opts) {
  return Object.assign({ storage: liveStorage, now: () => Date.now() }, opts || {});
}

module.exports = { liveStorage, withHost };

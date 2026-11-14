// test/helpers/bake-env.js
// The bake's environment that status-lines.js packLine and formatValue take (its BakeEnv),
// for the tests that drive one line or one slot without buildStatusLines.

/**
 * The bake's time and the phone's battery reading, as plain data.
 *
 * @param {Date} now The bake's instant.
 * @param {?Object} [phone] The phone's battery reading ({available, level, charging}), or null.
 * @returns {{now: Date, nowSec: number, phone: ?Object}} The bake's environment.
 */
function bakeEnv(now, phone) {
  return { now: now, nowSec: now.getTime() / 1000, phone: phone || null };
}

module.exports = { bakeEnv };

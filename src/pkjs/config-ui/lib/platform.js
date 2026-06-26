// src/pkjs/config-ui/lib/platform.js — ES5. Pebble platform facts (the only platform->color SoT).
var BW_PLATFORMS = { aplite: true, diorite: true, flint: true };
/**
 * Whether a Pebble platform has a color display (false for the B/W platforms).
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite', 'chalk').
 * @returns {boolean} True if the platform is color.
 */
function isColorPlatform(platform) { return !BW_PLATFORMS[platform]; }
/**
 * Derive the config-UI environment facts from a Pebble watchInfo object.
 * @param {Object} watchInfo Pebble watchInfo; its .platform names the model.
 * @returns {{color: boolean, round: boolean, platform: string}} Env: color display, round (chalk), and platform name.
 */
function computeEnv(watchInfo) {
  var p = watchInfo && watchInfo.platform ? watchInfo.platform : '';
  return { color: isColorPlatform(p), round: p === 'chalk', platform: p };
}
module.exports = { isColorPlatform: isColorPlatform, computeEnv: computeEnv };

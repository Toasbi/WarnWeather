// src/pkjs/config-ui/lib/platform.js — ES5. Pebble platform facts (the only platform->color/health SoT).
var BW_PLATFORMS = { aplite: true, diorite: true, flint: true };
// Platforms whose watch firmware lacks PBL_HEALTH (no health sensors). aplite
// (Pebble Classic/Steel) is the only one; the watch compiles the health view
// out there, so its config toggle must be hidden too. Keep in lockstep with the
// C `#if defined(PBL_HEALTH)` guards.
var NO_HEALTH_PLATFORMS = { aplite: true };
/**
 * Whether a Pebble platform has a color display (false for the B/W platforms).
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite', 'chalk').
 * @returns {boolean} True if the platform is color.
 */
function isColorPlatform(platform) { return !BW_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform has health sensors (PBL_HEALTH). Unknown platforms
 * are treated as health-capable so a missing watchInfo never hides a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform supports the health view.
 */
function isHealthPlatform(platform) { return !NO_HEALTH_PLATFORMS[platform]; }
/**
 * Derive the config-UI environment facts from a Pebble watchInfo object.
 * @param {Object} watchInfo Pebble watchInfo; its .platform names the model.
 * @returns {{color: boolean, round: boolean, platform: string, health: boolean}} Env: color display, round (chalk), platform name, and health support.
 */
function computeEnv(watchInfo) {
  var p = watchInfo && watchInfo.platform ? watchInfo.platform : '';
  return { color: isColorPlatform(p), round: p === 'chalk', platform: p, health: isHealthPlatform(p) };
}
module.exports = { isColorPlatform: isColorPlatform, isHealthPlatform: isHealthPlatform, computeEnv: computeEnv };

// Build the packed palette AppMessage tuples for both channels. Bars follow
// rainBarColor, the rain radar follows radarColor; each is an independent
// GColor8 blob (3 B/stop). Shared by the Clay-settings send and the dev fixture
// path so the two can't drift.

var rainTier = require('./rain-tier.js');
var resolveInk = require('../resolve-ink.js');

/**
 * Build the packed palette tuples for both channels.
 *
 * The absent-key fallback is DEFENSIVE, not a live path: both keys carry a static
 * schema defaultValue, so seedDefaults writes them on first boot, and the light theme
 * is only reachable through a settings save that writes both concretely. It goes
 * through barColorDefault anyway so the dark default is not spelled out a third time,
 * and so an absent key would resolve to the right polarity rather than silently to
 * multicolor if the seeding ever changes.
 *
 * @param {Object|null} watchInfo Active watch info (platform read for packing).
 * @param {Object} settings Clay settings (rainBarColor/radarColor/theme).
 * @returns {{BAR_PALETTE_UINT8: number[], RADAR_PALETTE_UINT8: number[]}} Packed tuples.
 */
function buildPaletteTuples(watchInfo, settings) {
    var platform = watchInfo ? watchInfo.platform : 'basalt';
    var resolved = settings || {};
    var theme = resolved.theme || 'dark';
    var fallback = resolveInk.barColorDefault(theme);
    return {
        BAR_PALETTE_UINT8: rainTier.buildPackedPalette(platform, resolved.rainBarColor || fallback, theme),
        RADAR_PALETTE_UINT8: rainTier.buildPackedPalette(platform, resolved.radarColor || fallback, theme)
    };
}

module.exports = {
    buildPaletteTuples: buildPaletteTuples
};

// Build the packed palette AppMessage tuples for both channels. Bars follow
// rainBarColor, the rain radar follows radarColor; each is an independent
// GColor8 blob (3 B/stop). Shared by the Clay-settings send and the dev fixture
// path so the two can't drift.

var rainTier = require('./rain-tier.js');

/**
 * Build the packed palette tuples for both channels.
 * @param {Object|null} watchInfo Active watch info (platform read for packing).
 * @param {Object} settings Clay settings (rainBarColor/radarColor/theme).
 * @returns {{BAR_PALETTE_UINT8: number[], RADAR_PALETTE_UINT8: number[]}} Packed tuples.
 */
function buildPaletteTuples(watchInfo, settings) {
    var platform = watchInfo ? watchInfo.platform : 'basalt';
    var resolved = settings || {};
    var theme = resolved.theme || 'dark';
    return {
        BAR_PALETTE_UINT8: rainTier.buildPackedPalette(platform, resolved.rainBarColor || 'multicolor', theme),
        RADAR_PALETTE_UINT8: rainTier.buildPackedPalette(platform, resolved.radarColor || 'multicolor', theme)
    };
}

module.exports = {
    buildPaletteTuples: buildPaletteTuples
};

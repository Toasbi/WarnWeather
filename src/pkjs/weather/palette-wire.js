// Build the packed palette AppMessage tuples for both channels. Bars follow
// rainBarColor, the rain radar follows radarColor; each is an independent
// GColor8 blob (3 B/stop). Shared by the Clay-settings send and the dev fixture
// path so the two can't drift.

var rainTier = require('./rain-tier.js');
var resolveInk = require('../resolve-ink.js');
// The platform authority (capsForWatch) and the Bars from reading. line-style.js
// requires rain-tier.js, never this file, so there is no cycle.
var lineStyle = require('../line-style.js');
var drawFrom = require('../draw-from.js');

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
 * Each blob also carries its chart's Bars from: Top (rainBarFrom, radarBarFrom) in bit 7
 * of its byte [1], stop 0's threshold, which buildPackedPalette always starts at 0
 * (draw-from.js markPalette; the watch reads the negative threshold through palette.h
 * palette_from_top). Never on aplite, and with Bottom the blobs are byte-identical to
 * the ones sent before the setting existed.
 *
 * @param {Object|null} watchInfo Active watch info (platform read for packing).
 * @param {Object} settings Clay settings (rainBarColor/radarColor/theme, rainBarFrom/
 *   radarBarFrom).
 * @returns {{BAR_PALETTE_UINT8: number[], RADAR_PALETTE_UINT8: number[]}} Packed tuples.
 */
function buildPaletteTuples(watchInfo, settings) {
    var platform = watchInfo ? watchInfo.platform : 'basalt';
    var resolved = settings || {};
    var theme = resolved.theme || 'dark';
    var fallback = resolveInk.barColorDefault(theme);
    var caps = lineStyle.capsForWatch(watchInfo);
    return {
        BAR_PALETTE_UINT8: drawFrom.markPalette(
            rainTier.buildPackedPalette(platform, resolved.rainBarColor || fallback, theme),
            drawFrom.barsFromTop(resolved, 'rain', caps)),
        RADAR_PALETTE_UINT8: drawFrom.markPalette(
            rainTier.buildPackedPalette(platform, resolved.radarColor || fallback, theme),
            drawFrom.barsFromTop(resolved, 'radar', caps))
    };
}

module.exports = {
    buildPaletteTuples: buildPaletteTuples
};

// src/pkjs/line-style.js — ES5. Graph line styling: the two metric line colours,
// the area-fill colour and the fill flag. Every one of them is derived from the
// SETTINGS blob (plus the target platform's colour/polarity capabilities) and not
// from the weather data, so per AGENTS.md's message-boundary rule they belong on
// the Clay settings message rather than on every weather send. This module is the
// single source of truth shared by the Clay packer and the forecast series
// builder, so the wire and the render can't drift.
var COLORS = require('./pebble-colors');
var configUi = require('./config-ui');   // isColorPlatform — same helper rain-tier/palette-wire use
var rainTier = require('./weather/rain-tier');
var resolveInkLib = require('./resolve-ink.js');
var resolveInk = resolveInkLib.resolveInk;
var isBwTheme = resolveInkLib.isBwTheme;
var isLightPolarity = resolveInkLib.isLightPolarity;
var effectiveTheme = resolveInkLib.effectiveTheme;

// Metric → line stroke colour per platform class. Gust is settings-dependent on colour
// displays, so it is resolved in lineColorFor(), not from this table. `light` is an
// optional light-theme override, consulted by lineColorFor() when the theme is
// light-polarity and the display is effectively colour; a metric without one keeps its
// `color` value in every color-capable theme (see fillColorFor's identical `light`
// convention below). precip has one from the readability feedback round (PictonBlue
// read too bright against the light-theme's white background — VividCerulean is one
// Pebble-palette step darker, same R-channel notch as the fill below); feels has one
// because LightGray is illegible on white.
var LINE_COLORS = {
    precip_prob: { color: COLORS.GColorPictonBlue, light: COLORS.GColorVividCerulean, bw: COLORS.GColorWhite },
    wind:        { color: COLORS.GColorYellow,     bw: COLORS.GColorWhite },
    uv:          { color: COLORS.GColorMagenta,    bw: COLORS.GColorWhite },
    // Orange is the last unclaimed warm hue: precip owns blue, uv magenta, gust the
    // grays. It reads close to wind's yellow at 1px — eyeball on hardware before
    // treating it as final.
    pressure:    { color: COLORS.GColorOrange,     bw: COLORS.GColorWhite },
    // Feels-like shadows the 3px temp curve, so it stays achromatic and dimmer than
    // any hue: LightGray next to temp's white line on dark. On light it goes BLACK,
    // not a gray — at 1px on a white background DarkGray reads as barely-there, and
    // it would also collide with the light theme's white-bar rain colour. Black still
    // separates from the temp curve, which stays red on colour displays. On B&W the
    // width/pattern (1px solid or dots vs the 3px temp curve) tells it apart.
    feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorBlack,         bw: COLORS.GColorWhite }
};
// Metric → area-fill colour per platform class. Every metric can fill; colour-platform
// fills are a darker shade of the line so the line always reads brighter (precip
// PictonBlue→CobaltBlue, wind→ArmyGreen, uv→Purple, gust→DarkGray). B&W has no range,
// so all fills are LightGray. `light` is the light-theme fill: the dark-theme shades read
// too heavy against a white background, so light theme gets a brighter tint of the same
// hue instead (precip→ElectricBlue, wind→Inchworm, uv→ShockingPink, gust→LightGray).
// precip's light tint was Celeste (0xAAFFFF) until the readability feedback round: it
// read too washed-out, so it moved one Pebble-palette step darker to ElectricBlue
// (0x55FFFF — the R channel steps 0xAA -> 0x55, matching the line's PictonBlue ->
// VividCerulean step above). NOTE: 0x55FFFF has no "Cyan"-named constant in
// pebble-colors.js — the real GColorCyan is 0x00FFFF — GColorElectricBlue is the
// correct name for this hex. First pass — the user will tune these further.
var FILL_COLORS = {
    precip_prob: { color: COLORS.GColorCobaltBlue, light: COLORS.GColorElectricBlue, bw: COLORS.GColorLightGray },
    wind:        { color: COLORS.GColorArmyGreen,  light: COLORS.GColorInchworm,     bw: COLORS.GColorLightGray },
    uv:          { color: COLORS.GColorPurple,     light: COLORS.GColorShockingPink, bw: COLORS.GColorLightGray },
    gust:        { color: COLORS.GColorDarkGray,   light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray },
    pressure:    { color: COLORS.GColorWindsorTan, light: COLORS.GColorChromeYellow, bw: COLORS.GColorLightGray },
    // Kept for the wire's shape only: resolveLineStyle forces the secondary fill
    // false for feels (it has no meaningful zero to fill down to), so no AREA layer is
    // ever built and forecast_layer.c's night_area_palette_for_fill never sees this
    // colour. Still LightGray so that if the fill is ever re-enabled it keys the feels
    // night palette correctly rather than rendering the night area precip-blue (the
    // documented pressure bug). Unambiguous vs gust's LightGray light tint because
    // light-polarity fills never reach that C table.
    feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray }
};

// Wire size of the packed line-style tuple: [secondary, fill, third, flags].
var LINE_STYLE_BYTES = 4;
// Flag byte, bit 0: the secondary line's area fill is on.
var FLAG_SECONDARY_FILL = 0x01;

/**
 * Whether the watch has a colour display.
 * @param {Object} watchInfo getActiveWatchInfo() result, or null.
 * @returns {boolean} True on colour platforms; defaults to colour when watchInfo is absent.
 */
function isColorWatch(watchInfo) {
    return configUi.isColorPlatform(watchInfo ? watchInfo.platform : 'basalt');
}

/**
 * Line/dot colour for a metric, resolved for the platform + theme. isColor should
 * already be the EFFECTIVE color flag (isColorWatch(watchInfo) && !isBwTheme(theme)) —
 * see resolveLineStyle. On B&W (or bw/bw-light theme) every line is the theme
 * foreground; gust on colour is settings-dependent so it never matches the rain bars.
 * On a colour display, a light-polarity theme (light or bw-light) swaps in the metric's
 * `light` variant (see LINE_COLORS) when one is defined — mirrors fillColorFor's `light`
 * convention below; a metric without one keeps its dark-theme `color`. isColor is
 * already the EFFECTIVE color flag, so bw/bw-light never reach the light-variant branch
 * — they resolve via the `!isColor` guard above instead. resolveInk flips an exact white
 * to black in light-polarity themes; hues and grays pass through.
 * @param {string} metric precip_prob|wind|gust|uv.
 * @param {Object} settings Clay settings (reads rainBarColor for gust).
 * @param {boolean} isColor Effective colour display?
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (no flip) when omitted.
 * @returns {number} 0xRRGGBB colour.
 */
function lineColorFor(metric, settings, isColor, theme) {
    theme = theme || 'dark';
    var result;
    if (!isColor) {
        result = COLORS.GColorWhite;
    } else if (metric === 'gust') {
        // Gust takes the achromatic slot so it never reads as one of the rain bars.
        // Dark polarity: LightGray over white bars (which are white there), white
        // otherwise. Light polarity: black either way — LightGray is invisible on a
        // white background, and DarkGray is the exact colour the white-bar mode
        // paints its BARS in a light theme (rain-tier.buildPalette), so a DarkGray
        // line would vanish into them. White falls through to resolveInk, which
        // flips it to black on light polarity.
        result = (!isLightPolarity(theme) && settings.rainBarColor === 'white')
            ? COLORS.GColorLightGray
            : COLORS.GColorWhite;
    } else {
        var entry = LINE_COLORS[metric];
        if (!entry) {
            result = COLORS.GColorBlack;
        } else if (isLightPolarity(theme) && entry.hasOwnProperty('light')) {
            // Presence, not truthiness: GColorBlack is 0x000000, so `entry.light &&`
            // silently drops a black light-variant back to the dark colour.
            result = entry.light;
        } else {
            result = entry.color;
        }
    }
    return resolveInk(result, theme);
}

/**
 * Area-fill colour for a metric, resolved for the platform + theme. On a colour display,
 * a light-polarity theme (light or bw-light) swaps in the metric's brighter `light` tint
 * (see FILL_COLORS) instead of the dark-theme shade so the fill reads against a white
 * background; B&W ignores theme (always LightGray). isColor is already the EFFECTIVE
 * color flag, so bw/bw-light never reach the light-tint branch — they resolve via the
 * `!isColor` guard above instead.
 * @param {string} metric precip_prob|wind|gust|uv.
 * @param {boolean} isColor Colour display?
 * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (no light variant) when omitted.
 * @returns {number|undefined} 0xRRGGBB colour, or undefined for an unknown metric.
 */
function fillColorFor(metric, isColor, theme) {
    theme = theme || 'dark';
    var entry = FILL_COLORS[metric];
    if (!entry) { return undefined; }
    if (!isColor) { return entry.bw; }
    return isLightPolarity(theme) ? entry.light : entry.color;
}

/**
 * Resolve the graph's line styling from settings alone (no weather data).
 *
 * Folds the stored theme to what the target platform actually renders: aplite has
 * the light polarity compiled out (theme.h pins theme_is_light() false), so a
 * light / bw-light byte renders as the classic white-on-black there. Without this
 * the light-polarity flip below would send black line/dot colors to aplite, which
 * draws them black-on-black (the reported bug). Every other platform ships the
 * polarity, so effectiveTheme returns the theme unchanged for them.
 *
 * @param {Object} settings Clay settings blob (theme, secondaryLine, thirdLine,
 *   secondaryLineFill, rainBarColor).
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null/undefined
 *   (treated as colour basalt).
 * @returns {{secondary: number, fill: number, third: number, fillOn: boolean}}
 *   Three 0xRRGGBB colours plus the resolved fill flag.
 */
function resolveLineStyle(settings, watchInfo) {
    var platform = watchInfo && watchInfo.platform ? watchInfo.platform : 'basalt';
    var theme = effectiveTheme(settings.theme || 'dark',
                               configUi.isThemePolarityPlatform(platform));
    // Effective color: a color display renders as color only when the theme isn't
    // Black & White — a bw/bw-light theme reuses the exact color model B&W watches
    // get today (bw-light in its light-polarity form).
    var isColor = isColorWatch(watchInfo) && !isBwTheme(theme);
    var secMetric = settings.secondaryLine;
    var thirdMetric = settings.thirdLine;
    var secondary = lineColorFor(secMetric, settings, isColor, theme) || COLORS.GColorBlack;
    return {
        secondary: secondary,
        fill: fillColorFor(secMetric, isColor, theme) || secondary,
        third: lineColorFor(thirdMetric, settings, isColor, theme)
            || resolveInk(COLORS.GColorWhite, theme),
        // Feels-like never fills. Every other metric maps 0..max, so the area under the
        // line is the area above a real zero; feels rides the temp∪feels band, whose floor
        // is just the coldest value on the plot — a fill there would flood the plot to an
        // arbitrary line and swallow the temp curve it is meant to be compared against.
        // The config UI hides the toggle (schema.js) and clears it (blocks.js'
        // 'forecastMetricFill'); this is the authoritative gate, so a settings blob stored
        // before those landed — or any future caller — still cannot turn the fill on.
        fillOn: Boolean(settings.secondaryLineFill) && secMetric !== 'feels'
    };
}

/**
 * Pack the line styling for the Clay wire: three GColor8 bytes + a flag byte.
 * rgbToGColor8 matches Pebble's GColorFromHEX exactly, so the rendered pixel is
 * identical to sending the full 0xRRGGBB value.
 * @param {Object} settings Clay settings blob.
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {number[]} LINE_STYLE_BYTES bytes: [secondary, fill, third, flags].
 */
function buildLineStyleBytes(settings, watchInfo) {
    var s = resolveLineStyle(settings, watchInfo);
    return [
        rainTier.rgbToGColor8(s.secondary),
        rainTier.rgbToGColor8(s.fill),
        rainTier.rgbToGColor8(s.third),
        s.fillOn ? FLAG_SECONDARY_FILL : 0
    ];
}

module.exports = {
    resolveLineStyle: resolveLineStyle,
    buildLineStyleBytes: buildLineStyleBytes,
    LINE_STYLE_BYTES: LINE_STYLE_BYTES,
    FLAG_SECONDARY_FILL: FLAG_SECONDARY_FILL,
    LINE_COLORS: LINE_COLORS,
    FILL_COLORS: FILL_COLORS,
    lineColorFor: lineColorFor,
    fillColorFor: fillColorFor
};

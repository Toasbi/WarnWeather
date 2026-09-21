// src/pkjs/night-light.js — the Nighttime card's "Dim backlight": which colour the
// backlight LED glows at night, and the window it glows it in, packed for the wire.
//
// Settings-derived, never weather-derived, so the tuple rides the Clay settings
// message (CLAY_NIGHT_LIGHT_UINT8, packed by clay-payload.js). Emery is the only
// watch with the RGB LED behind it — light_set_color_rgb888() is a documented no-op
// on every other board — which is why the tuple is sent unconditionally rather than
// gated on a watchInfo that can be missing; see clay-payload.js for that call.
//
// The window follows the conventions the rest of the app already runs on
// (sleep-window.js): the END HOUR IS EXCLUSIVE, the window WRAPS past midnight, and
// START === END MEANS NEVER. That last one is also the feature's off switch on the
// wire — buildNightLightBytes zeroes the whole tuple when the toggle is off, so the
// watch needs no enabled flag of its own.

var parseHour = require('./sleep-window.js').parseHour;   // THE hour-select parse rule

// The three channels, in wire order. 8 bits each: the LED driver takes 0-255 per
// channel and scales it by the watch's own brightness setting, so the value carries
// the hue AND how deep the dim goes (schema.js's backlightDimColor).
var CHANNELS = ['r', 'g', 'b'];
var CHANNEL_MIN = 0, CHANNEL_MAX = 255;

// The schema's BACKLIGHT_COLOR_DEFAULT ('40,10,0' — settings/schema.js), as channels.
// Unparseable storage falls back HERE rather than to black: black is a colour the
// sliders can legitimately produce (backlight off), so falling back to it would turn a
// bruised value into a plausible-looking setting nobody chose.
var DEFAULT_R = 40, DEFAULT_G = 10, DEFAULT_B = 0;

// Fallbacks for an hour that doesn't parse: the schema defaults of the keys being
// read (backlightDimStartHour/backlightDimEndHour, both '0'/'7'). Deliberately NOT
// sleep-window.js's 22/7: those are the battery saver's historical "sane night", kept
// for ITS upgrading installs, and an unparseable value stands in for the default the
// key it came from would have had (theme-schedule.js's rule).
var DEFAULT_START_HOUR = 0;
var DEFAULT_END_HOUR = 7;

// The OFF tuple, all five bytes zeroed. start === end is the established "never"
// window, so 0,0 is what says "don't tint" — a specific pair, not an accident. The
// COLOUR is zeroed with it because the whole Clay payload is ONE change-detector
// category (outbox.sendClay keys it on the whole object): leaving the real colour in
// the bytes would let a colour edit made while the switch is off dirty the message and
// buy a Bluetooth send that changes nothing on the watch.
var OFF_TUPLE = [0, 0, 0, 0, 0];

// Bytes on the wire: [r, g, b, startHour, endHour].
var NIGHT_LIGHT_BYTES = 5;

/**
 * Is the Dim backlight switch on? ABSENT reads as ON — the toggle ships on
 * (schema.js's backlightDim defaultValue), so a blob that predates it, or one a
 * fixture built by hand, must not read as off. Same rule as telemetry.js's
 * boolDefaultOn, which reports the same toggle.
 *
 * @param {Object} settings Clay settings blob (reads backlightDim).
 * @returns {boolean} True when the feature is enabled.
 */
function isDimEnabled(settings) {
    var v = (settings || {}).backlightDim;
    return (v === undefined || v === null) ? true : Boolean(v);
}

/**
 * Clamp one channel into [0, 255]. Only ever fed an integer (parseDimColor regexes
 * first), so there is no rounding to do — mirrors range-control.js's clampChannel.
 *
 * @param {number} n Parsed channel value.
 * @returns {number} Integer in [0, 255].
 */
function clampChannel(n) {
    // <=, not <: parseInt('-0') is NEGATIVE zero, which would otherwise be the one
    // input that leaves the clamp with its sign still on it ('-5' already lands on
    // this branch and comes out +0). It survives the array as -0 all the way to
    // Pebble.sendAppMessage. Nothing downstream is known to mind — the byte goes out
    // as 0 and JSON.stringify writes "0", so even the outbox's change detector is
    // unaffected — but a signed zero is not a byte, and normalising it here costs a
    // character. The clamp's answer for a plain 0 is unchanged: CHANNEL_MIN is 0.
    if (n <= CHANNEL_MIN) { return CHANNEL_MIN; }
    if (n > CHANNEL_MAX) { return CHANNEL_MAX; }
    return n;
}

/**
 * Parse the stored "r,g,b" colour, falling back to the schema default (40,10,0).
 *
 * The parse is the settings page's own, hand-kept: config-ui/lib/range-control.js's
 * parseRgbStrict is what the sliders and the card's swatch read the same string with,
 * and it is a page-bundle file the watch runtime does not load. Exactly three integer
 * channels, whitespace tolerated; an out-of-range channel is CLAMPED (0-255 is fixed by
 * the hardware, so 300 is a bruised value, not a stale one) while anything that is not
 * three integers — a hex string, two channels, a fraction — is rejected whole.
 * test/night-light.test.js pins the two parsers together over an input matrix, so the
 * colour the settings page previews is always the colour the LED gets.
 *
 * @param {Object} settings Clay settings blob (reads backlightDimColor).
 * @returns {{r: number, g: number, b: number}} Channels, each 0..255.
 */
function parseDimColor(settings) {
    var raw = (settings || {}).backlightDimColor;
    var parts = String((raw === undefined || raw === null) ? '' : raw).split(',');
    var fallback = { r: DEFAULT_R, g: DEFAULT_G, b: DEFAULT_B };
    if (parts.length !== 3) { return fallback; }
    var out = {}, i, s;
    for (i = 0; i < 3; i++) {
        s = parts[i].replace(/\s/g, '');
        if (!/^-?\d+$/.test(s)) { return fallback; }
        out[CHANNELS[i]] = clampChannel(parseInt(s, 10));
    }
    return out;
}

/**
 * The (start, end) hour pair the dim window runs on: the feature's OWN
 * backlightDimStartHour/backlightDimEndHour, always. The Nighttime card groups this
 * with the theme switch and the battery saver but shares no window with them, so
 * there is no mode to honour — the From/To under the switch IS the window.
 *
 * Shares sleep-window.js's parse rule, and the conventions with it: callers apply the
 * start === end "never" rule themselves, and the enabled toggle is likewise not read
 * here (buildNightLightBytes applies it).
 *
 * @param {Object} settings Clay settings (backlightDimStartHour/backlightDimEndHour).
 * @returns {{start: number, end: number}} Effective hours, each 0..23.
 */
function resolveDimWindow(settings) {
    var s = settings || {};
    return {
        start: parseHour(s.backlightDimStartHour, DEFAULT_START_HOUR),
        end: parseHour(s.backlightDimEndHour, DEFAULT_END_HOUR)
    };
}

/**
 * Pack the backlight tint for the Clay wire — FIVE bytes:
 *
 *   [0] LED red      0-255  ┐ the colour the backlight glows inside the window; the
 *   [1] LED green    0-255  │ driver scales each channel by the watch's own brightness
 *   [2] LED blue     0-255  ┘ setting, so these carry hue AND depth of dim
 *   [3] window start hour   0-23, INCLUSIVE
 *   [4] window end hour     0-23, EXCLUSIVE; < start wraps past midnight
 *
 * start === end is "never" — and [0,0,0,0,0] is what the switch being OFF sends, so a
 * watch that only checks the window needs no separate enabled flag.
 *
 * Growing this: append bytes and have the watch length-check the new block on its own,
 * never widen the minimum — the rule CLAY_LINE_STYLE_UINT8's tail already follows
 * (line-style.js, ADR-0003 §7).
 *
 * @param {Object} settings Clay settings blob.
 * @returns {number[]} The five bytes above.
 */
function buildNightLightBytes(settings) {
    if (!isDimEnabled(settings)) { return OFF_TUPLE.slice(); }
    var win = resolveDimWindow(settings);
    var color = parseDimColor(settings);
    return [color.r, color.g, color.b, win.start, win.end];
}

module.exports = {
    buildNightLightBytes: buildNightLightBytes,
    isDimEnabled: isDimEnabled,
    parseDimColor: parseDimColor,
    resolveDimWindow: resolveDimWindow,
    NIGHT_LIGHT_BYTES: NIGHT_LIGHT_BYTES
};

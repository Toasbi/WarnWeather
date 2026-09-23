// src/pkjs/theme-schedule.js — phone-side auto day/night theme evaluation.
//
// The watch cannot flip its own theme: every theme-dependent colour is resolved
// phone-side for exactly one polarity before it rides the Clay message
// (line-style.js's renderContextFor, clay-payload.js's CLAY_COLOR_TIME, the
// palette tuples), and a watch-side write of Config.theme would be reverted by
// the next Clay resend anyway. So the flip lives here: sendClaySettings builds
// its payload from effectiveSettings() — a scratch copy carrying the night
// theme while the night window is active — and the channel scheduler's 60 s
// tick resends Clay when effectiveThemeId() crosses a boundary
// (channel-scheduler.js's maybeResendThemeOnFlip). The outbox change detector
// turns every non-transition resend into a no-op, and a missed boundary (BT
// down, PKJS torn down) self-heals on the next successful send.
//
// The stored settings blob is never mutated: `theme` stays the day theme the
// user picked, and the polarity-tracking defaults (time colour, weekend
// colours, auto threshold highlight colours, bar colour modes — in the ints the
// stored blob holds) convert on the scratch copy through the same
// applyThemeConvert a manual theme flip runs in the settings page.

var themeFlip = require('./theme-flip.js');

/**
 * Parse an hour select value ('0'..'23'), clamping garbage to a fallback —
 * the sleep-window parse rule (sleep-window.js).
 *
 * @param {*} value Stored hour value (string from the settings page).
 * @param {number} fallback Hour to use when the value doesn't parse.
 * @returns {number} Hour 0..23.
 */
function parseHour(value, fallback) {
    var h = parseInt(value, 10);
    if (isNaN(h) || h < 0 || h > 23) { return fallback; }
    return h;
}

/**
 * True when `now`'s hour falls inside an hour window, with wrap-around and the
 * sleep window's conventions (sleep-window.js): a window whose start equals its
 * end is "never", not "always", and the end hour is exclusive. The caller passes
 * the fallbacks its OWN keys default to in schema.js, since that is what an
 * unparseable stored value stands in for.
 *
 * @param {Date} now Time to evaluate.
 * @param {*} startValue Stored start hour ('0'..'23').
 * @param {*} endValue Stored end hour ('0'..'23').
 * @param {number} startFallback Hour to use when startValue doesn't parse.
 * @param {number} endFallback Hour to use when endValue doesn't parse.
 * @returns {boolean} True when `now` is inside the window.
 */
function isWithinHourWindow(now, startValue, endValue, startFallback, endFallback) {
    var h = now.getHours();
    var start = parseHour(startValue, startFallback);
    var end = parseHour(endValue, endFallback);
    if (start === end) { return false; }
    if (start < end) { return h >= start && h < end; }
    return h >= start || h < end;
}

/**
 * THE themeAutoMode reader — 'manual' (the switch's own hour window) or 'sun',
 * and 'sun' for anything else at all: absent, and any value the schema's
 * segmented no longer offers.
 *
 * That last clause is load-bearing, not defensive padding. The config engine's
 * hydrate() does NOT coerce a stored value against its item's options — it
 * Object.assigns the saved blob over the defaults verbatim, and only an
 * optionsFrom select ever snaps (engine.js's resolveRowItem) — so a blob
 * holding a retired mode keeps it through hydrate, render and serialize alike.
 * An unreleased dev build could store 'night' (the Nighttime card's shared
 * window, which no longer exists); without this the mode would reach the sun
 * branch with no sun times computed for it and answer "never night", silently
 * turning the switch off for someone who had configured it.
 *
 * ONE mechanism, deliberately: this function, called by every reader of the
 * mode — isNightNow below AND index.js's isNightForTheme, which decides whether
 * to compute sun times at all. Normalising here and in the page's hydration
 * would be two, and the page's would rewrite a stored value nobody touched.
 *
 * @param {Object} settings Clay settings (reads themeAutoMode).
 * @returns {string} 'manual' or 'sun'.
 */
function resolveThemeMode(settings) {
    // 'manual' is the stored value for the switch's OWN hours and predates the
    // control's current "Custom" label — relabelled, never renamed.
    return ((settings || {}).themeAutoMode === 'manual') ? 'manual' : 'sun';
}

/**
 * True when `now` falls inside the configured night window. Manual mode is the
 * switch's own hour window, evaluated by isWithinHourWindow; sun mode is
 * "before today's sunrise or from sunset onward". Unknown sun times (no
 * location fix yet, polar day/night → Invalid Date) answer day, so a fresh
 * install stays on the day theme rather than guessing.
 *
 * @param {Date} now Time to evaluate.
 * @param {Object} settings Clay settings (themeAuto/themeAutoMode/themeAutoStartHour/themeAutoEndHour).
 * @param {?{sunrise: Date, sunset: Date}} sunTimes Today's sun times at the current location, or null.
 * @returns {boolean} True when the night theme should be in effect.
 */
function isNightNow(now, settings, sunTimes) {
    if (!settings || !settings.themeAuto) { return false; }
    // Manual needs no sun times, which is why index.js only computes them for
    // 'sun' — through this same resolver, so the two can never disagree.
    if (resolveThemeMode(settings) === 'manual') {
        return isWithinHourWindow(now, settings.themeAutoStartHour, settings.themeAutoEndHour, 20, 7);
    }
    if (!sunTimes) { return false; }
    var sunrise = sunTimes.sunrise instanceof Date ? sunTimes.sunrise.getTime() : NaN;
    var sunset = sunTimes.sunset instanceof Date ? sunTimes.sunset.getTime() : NaN;
    if (isNaN(sunrise) || isNaN(sunset) || sunrise >= sunset) { return false; }
    var t = now.getTime();
    return t < sunrise || t >= sunset;
}

/**
 * The theme id in effect right now — the night theme inside the night window,
 * the stored (day) theme everywhere else. The scheduler compares this across
 * ticks to detect boundary crossings.
 *
 * @param {Object} settings Clay settings.
 * @param {boolean} isNight Verdict from isNightNow().
 * @returns {string} 'dark' | 'light' | 'bw' | 'bw-light'.
 */
function effectiveThemeId(settings, isNight) {
    if (!settings) { return 'dark'; }
    if (settings.themeAuto && isNight) { return settings.themeNight || 'dark'; }
    return settings.theme || 'dark';
}

/**
 * The settings object wire payloads must be built from. Outside the night
 * window (or with the switch off, or with identical day/night picks) this is
 * the ORIGINAL object, untouched. Inside it, a shallow scratch copy carries
 * the night theme, with the polarity-tracking defaults converted exactly as a
 * manual flip would convert them — an explicit colour pick survives the flip.
 *
 * @param {Object} settings Clay settings (never mutated).
 * @param {boolean} isNight Verdict from isNightNow().
 * @returns {Object} `settings` itself, or the night scratch copy.
 */
function effectiveSettings(settings, isNight) {
    if (!settings || !settings.themeAuto || !isNight) { return settings; }
    var day = settings.theme || 'dark';
    var night = settings.themeNight || 'dark';
    if (night === day) { return settings; }
    var copy = {};
    for (var k in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, k)) { copy[k] = settings[k]; }
    }
    copy.theme = night;
    themeFlip.applyThemeConvert(copy, day, night);
    return copy;
}

module.exports = {
    resolveThemeMode: resolveThemeMode,
    isNightNow: isNightNow,
    effectiveThemeId: effectiveThemeId,
    effectiveSettings: effectiveSettings
};

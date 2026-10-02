// src/pkjs/migrations/line-styles.js
//
// The 1.23.1 forecast line-style migrations. Registry bodies (migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.

var lineStyle = require('../line-style');   // line keys, stripe rule, style resolve

/**
 * The 1.23.1 move of the fourth metric's line style onto its new default, x marks.
 * Until 1.23.1 the fourth line debuted as a top stripe, and seedDefaults wrote that
 * 'stripeTop' into every blob — so on most installs it is the seeded default of a line
 * that was never switched on, not a choice. Where the fourth metric is off (or absent),
 * a stored 'stripeTop' becomes 'x', so switching the line on later starts from the new
 * default like a fresh install. A fourth metric in use keeps its stripe: that one is on
 * screen and may well be picked.
 *
 * Safe after seedDefaults (index.js runs it first — the layoutPreset trap): the backfill
 * can only write an ABSENT fifthLine as 'off' (the same verdict as absent) and an absent
 * fifthLineStyle as the new default 'x' (nothing left to move), so it can neither hide
 * a stripe in use nor invent one to move. A fixed 'x', not LINE_STYLE_DEFAULTS: this is
 * what the 1.23.1 default WAS, whatever it becomes later.
 *
 * No Clay send: the watch never draws a line that is off.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateFifthLineStyleDefault(blob) {
    var fifthLineOff = !blob.fifthLine || blob.fifthLine === 'off';
    if (!fifthLineOff || blob.fifthLineStyle !== 'stripeTop') {
        return { changed: false, send: false };
    }
    blob.fifthLineStyle = 'x';
    console.log('Migrated the unused fourth-line style stripeTop -> x');
    return { changed: true, send: false };
}

/**
 * One-time forced Clay resend for the 1.23.1 stripe rule: a stripe only shows an
 * intensity metric (line-style.js metricAllowsStripe), so a stripe stored on a DRAWN
 * feels-like, dew-point or pressure line now resolves to that line's non-stripe style
 * (lineStyleValue) and its CLAY_LINE_STYLE_UINT8 byte changes — e.g. the fourth metric
 * on pressure with 1.23.0's default 'stripeTop' goes 0x07 -> 0x02. The watch still
 * holds the old byte, and an IN-PLACE upgrade sends no Clay (the handshake reports
 * hasConfig true; see graph-colors.js migrateGraphNightColorsResend), so without this
 * it keeps drawing the stripe until the next day-change or settings save — while the
 * next weather bake already treats the line as no stripe (lineStyleValue).
 *
 * Rewrites nothing: the stored stripe stays a pick (the settings page keeps it dormant
 * and brings it back with an intensity metric). A line that is off or repeats an
 * earlier line's metric (lineStyle.effectiveLineMetric null) is never drawn, so it
 * needs no send.
 *
 * @param {Object} blob Stored settings (read only).
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateStripeMetricRuleResend(blob) {
    for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
        var line = lineStyle.FORECAST_LINES[i];
        var metric = lineStyle.effectiveLineMetric(blob, line.key);
        if (metric && lineStyle.isStripeValue(blob[line.styleKey])
                && !lineStyle.metricAllowsStripe(metric)) {
            console.log('Forcing one Clay resend: a stripe on ' + metric + ' now draws as '
                + lineStyle.lineStyleValue(blob, line.styleKey));
            return { changed: false, send: true };
        }
    }
    return { changed: false, send: false };
}

module.exports = {
    migrateFifthLineStyleDefault: migrateFifthLineStyleDefault,
    migrateStripeMetricRuleResend: migrateStripeMetricRuleResend
};

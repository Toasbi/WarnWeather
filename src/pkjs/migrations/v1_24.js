// src/pkjs/migrations/v1_24.js
//
// The 1.24.0 migrations, two registry entries (migrations/registry.js):
//  - ALERT_LEVELS_MIGRATION_KEY, migrateAlertLevels: the value moves, run as the steps
//    in ALERT_LEVELS_STEPS, in that order (the seed-pairs step lives in seed-pairs.js);
//  - ON_DEMAND_MIGRATION_KEY, migrateOnDemand: the status bars onto On demand.
// A registry body: run(blob, ctx) -> {changed, send}, mutating the blob in place; the
// runner in clay-migrations.js owns the marker, the save and the send. A step is
// step(blob) -> changed and asks for no send: the entry asks for one on every existing
// install.
//
// Every step keys on stored VALUES, never on a key being absent: seedDefaults runs
// before the ledger (index.js; the layoutPreset trap) and has already backfilled every
// new key with its default. Each step is idempotent over its own output, but the entry
// is not, and neither is a re-run over settings saved on the 1.24.0 page: a highlight
// switched off with its pair kept, a seed pair blanked under a switch that is on, a warn
// colour picked under the default Fill look, a goal colour set back to auto all look
// exactly like the 1.23 shapes these steps convert. Hence the marker string
// (storage-keys.js) and resetAll marking it done.

var thresholds = require('../status-thresholds.js');   // KINDS + the pair rules
var onDemand = require('../on-demand.js');               // the side keys and their reading
var seedPairs = require('./seed-pairs.js');              // the seed-pairs step

/**
 * Backfill the Highlight / Goals toggles (thresh<K>On) from their pairs. Until 1.24.0
 * the toggle was page-derived state: every settings open rewrote it as "the stored
 * warn/danger pair is complete and ordered", and the phone packed the blob[0] enable
 * bit from the pair alone. From 1.24.0 on the STORED toggle owns the bit
 * (status-thresholds.js kindConfig: On === true AND an ordered pair) and the pair lives
 * on while it is off, so a blob whose toggle was never re-derived — a pair set in the
 * old text fields and settings not opened since — would silently lose its highlight.
 * For every kind with a pair (bold-only kinds have none): On := the pair is ordered,
 * the last truth the page would have shown.
 *
 * Keyed on the PAIR, never on the toggle being absent: thresh<K>On has had a schema
 * default (false) for releases, so "absent" is not observable. The pair alone tells the
 * three populations apart: highlight on (ordered pair) → true; highlight off (the old
 * OFF blanked the pair) → false; AQI's wizard-seeded highlight (100/150 or 60/80, the
 * seed the 1.23 page's switch pinned) → true. Those pins go back to blank in a later
 * step (seed-pairs.js).
 *
 * A pair that is not ordered but not blank either — half ('7', '') from the old text
 * fields, inverted, junk — is normalised to '' on both keys: the phone and the page
 * already resolve it to the kind's seed as a whole (resolvedPair), while the slider
 * fell back per value and would preview 'Warn 7' against a seed-6 bake. Blank is the
 * one stored form of "the seed" from here on; no numbers are written into any blob.
 *
 * For every install the post-migration enable bit (On && ordered) equals the pre-split
 * one (ordered), which the watch already holds. A fresh install (blank pairs, toggles
 * false) is a no-op.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {boolean} whether the blob changed
 */
function migrateThresholdHighlightToggles(blob) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var onKey = 'thresh' + kind.key + 'On';
        var warnKey = 'thresh' + kind.key + 'Warn';
        var dangerKey = 'thresh' + kind.key + 'Danger';
        var ordered = thresholds.pairOrdered(thresholds.parseThreshold(blob[warnKey]),
            thresholds.parseThreshold(blob[dangerKey]));
        // Write only when the stored value is not already the verdict. An absent
        // toggle already reads as off (kindConfig wants === true), so it is left
        // absent under an unusable pair.
        var on = blob[onKey];
        if (ordered ? on !== true : (on !== false && typeof on !== 'undefined')) {
            blob[onKey] = ordered;
            changed = true;
        }
        if (!ordered) {
            var pairKeys = [warnKey, dangerKey];
            for (var p = 0; p < pairKeys.length; p++) {
                var raw = blob[pairKeys[p]];
                // null/undefined read as blank already (parseThreshold); only a stored
                // non-blank half of an unusable pair is rewritten.
                if (raw !== '' && raw !== null && typeof raw !== 'undefined') {
                    blob[pairKeys[p]] = '';
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        console.log('Migrated threshold highlight toggles from their pairs');
    }
    return changed;
}

/**
 * @param {*} v Stored colour (0xRRGGBB int or '#RRGGBB' string).
 * @returns {boolean} True for black or white — the old auto text colour.
 */
function isTextColor(v) {
    if (typeof v === 'number') { return v === 0x000000 || v === 0xFFFFFF; }
    if (typeof v !== 'string') { return false; }
    var u = v.toUpperCase();
    return u === '#000000' || u === '#FFFFFF';
}

/**
 * Move the retired 'Outline on warn' / 'Outline on close' toggle
 * (thresh<K>WarnOutlineOn) onto the warn look (thresh<K>WarnLook: none / outline /
 * fill). The look has a per-PLATFORM default (status-thresholds.js warnLookDefault:
 * fill on colour watches, outline on B&W, outline for the goal kinds) and stays
 * absent until the user picks a look that differs from it: it is never seeded, and
 * a page save leaves a look equal to the saving watch's default out of the blob
 * (the item's defaultFrom is sticky: false, engine.js serialize). So only the
 * installs whose old box differs from "absent → default" get a stored look:
 *  - a WEATHER kind whose outline was on keeps its outline — the stored toggle true,
 *    or a stored warn colour (an int, or a non-empty '#RRGGBB'): before the toggle
 *    existed, and until the page next re-derived it, the colour alone drew the box.
 *    Every other weather kind stays absent and takes the new default (the owner's
 *    "switch to fill").
 *  - a GOAL kind whose outline was off keeps no box ('none') — the stored toggle
 *    false, or the blank warn colour ('' or the old parseResponse bug's null) that
 *    was the wire's no-outline state.
 * seedDefaults wrote the old toggle's and colour's defaults (weather false / '', goal
 * true / green): both land on "leave absent". A look already stored is the page's own
 * truth and is left alone. The old toggle is not deleted: nothing reads it any more.
 *
 * The same move gives a WEATHER kind's danger the contract's red where it held the
 * old auto text colour (a stored black or white, int or '#RRGGBB'): the page used to
 * write the theme fg there, and with warn now filled in that colour by default the
 * two levels would draw the same box. From here on a stored black or white danger is
 * a pick ("the text colour"), and unset means red (onbuild.js, kindConfig). Goal
 * kinds keep their green.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {boolean} whether the blob changed
 */
function migrateWarnLook(blob) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var dangerKey = 'thresh' + kind.key + 'DangerColor';
        if (!kind.goal && isTextColor(blob[dangerKey])) {
            blob[dangerKey] = typeof blob[dangerKey] === 'number'
                ? thresholds.DEFAULT_DANGER_COLOR : thresholds.DEFAULT_DANGER_HEX;
            changed = true;
        }
        var lookKey = 'thresh' + kind.key + 'WarnLook';
        if (Object.prototype.hasOwnProperty.call(thresholds.WARN_LOOKS, blob[lookKey])) {
            continue;
        }
        var outlineOn = blob['thresh' + kind.key + 'WarnOutlineOn'];
        var rawWarn = blob['thresh' + kind.key + 'WarnColor'];
        var look = null;
        if (kind.goal) {
            if (outlineOn === false || rawWarn === '' || rawWarn === null) { look = 'none'; }
        } else if (outlineOn === true || typeof rawWarn === 'number'
                   || (typeof rawWarn === 'string' && rawWarn !== '')) {
            look = 'outline';
        }
        if (look !== null) {
            blob[lookKey] = look;
            changed = true;
        }
    }
    if (changed) {
        console.log('Migrated the warn outline toggles to warn looks, danger to red');
    }
    return changed;
}

/**
 * Move the rain window's retired Off option. Until 132b577a the Radar tab's rain
 * countdown offered 'Off' (rainCountdownHorizon '0'), and a stored '0' was never moved:
 * the page's Rain row read "Within 60 min" through its fallback while the phone sent
 * horizon 0 and the watch showed no rain. A stored '0' becomes the window's default,
 * with Rain unticked on every side of every bar (on-demand.js untickEverywhere): the
 * same "no rain alert" the watch already draws. Radar mode 'Rain alert only' needs the
 * rain alert, so there Rain stays ticked, now with a working window (the On demand
 * entry places it on a bar that shows, migrateOnDemand).
 *
 * Keyed on the stored WINDOW value. Reads radarMode, which the radar provider -> mode
 * entry (radar.js) wrote earlier in the ledger. The untick needs no side key stored:
 * on-demand.js read() falls back to the defaults, which seedDefaults wrote anyway.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {boolean} whether the blob changed
 */
function migrateRainWindowOff(blob) {
    var h = blob.rainCountdownHorizon;
    if (h === null || typeof h === 'undefined' || String(h) !== '0') { return false; }
    // The window's default, read through the contract that owns it.
    blob.rainCountdownHorizon = String(thresholds.rainAlert({}).horizonMin);
    if (blob.radarMode !== 'countdown') { onDemand.untickEverywhere(blob, 'rain'); }
    console.log('Migrated rain window Off -> ' + blob.rainCountdownHorizon + ' min');
    return true;
}

/**
 * The temperature pair's separator: 1.24.0 moved its default from the slash to the
 * bar ('12|10', status-pair.js DEFAULT_SEPARATOR), and a stored 'slash' moves with it
 * once. Until 1.24.0 the slash was the default and the page stored it on every save,
 * so a stored 'slash' cannot tell a pick from the old default; the owner's call is
 * that everyone gets the bar. Every other value stays: 'custom' (even a custom '/'),
 * 'brackets', 'dot', an already stored 'bar', and the day-max kinds' own separators.
 * The Spaces flag is left alone, so '12 / 10' becomes '12 | 10'.
 *
 * Keyed on the stored VALUE: seedDefaults has already written 'bar' into a fresh
 * install, which is a no-op here. The separator is phone-baked slot text, already in
 * renderSignature, so the next bake (the startup fetch or the settings-close re-bake)
 * shows it.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {boolean} whether the blob changed
 */
function migrateTempSeparatorBar(blob) {
    if (blob.tempSlotSeparator !== 'slash') { return false; }
    blob.tempSlotSeparator = 'bar';
    return true;
}

// The alert-levels steps, in their order. The seed-pairs step blanks the pins the
// highlight toggles have just read as "on".
var ALERT_LEVELS_STEPS = [migrateThresholdHighlightToggles, migrateWarnLook, migrateRainWindowOff,
    seedPairs.migrateSeedPairsToBlank, migrateTempSeparatorBar];

/**
 * The ALERT_LEVELS_MIGRATION_KEY entry: ALERT_LEVELS_STEPS over the one blob.
 *
 * Asks for ONE Clay send on every existing install, even when nothing in storage
 * changes: the watch still holds the pre-1.24 blob without the look bytes, so it would
 * keep drawing the old boxes (no box where the outline was off, a white danger) while
 * the page already shows the new defaults (fill, red). The same send carries a moved
 * rain window or goal pair. A FRESH install (no blob before this boot's seedDefaults)
 * asks for nothing: its boot already sends the whole settings blob.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateAlertLevels(blob, ctx) {
    var changed = false;
    for (var i = 0; i < ALERT_LEVELS_STEPS.length; i++) {
        changed = ALERT_LEVELS_STEPS[i](blob) || changed;
    }
    return { changed: changed, send: Boolean(ctx.hadExistingInstall) };
}

// The development branch's alert keys, which no released version ever stored: the
// per-alert switches, the rain switch and the per-bar alert row placement. On demand's
// side lists replace all of them.
var RETIRED_ALERT_KEYS = ['alertRain', 'alertUv', 'alertWind', 'alertGust', 'alertAqi', 'alertPollen',
    'statusTopAlerts', 'statusForecastAlerts', 'statusRadarAlerts', 'statusHealthAlerts'];

/**
 * The On demand move. seedDefaults has already written the new side lists with their
 * defaults (the Watch Status Bar: Bluetooth, Quiet time, Sleep and Rain left; Battery,
 * Wind gusts, UV index, Air quality and Wind speed right), into every install, upgraded
 * ones included — the owner's call: the weather alerts arrive switched on. This move
 * carries over what a 1.23.2 install said against those defaults, and keys on stored
 * VALUES only:
 *  - 'Show battery below 10%' off (batteryLowOnly false) unticks Battery everywhere;
 *  - 'Show quiet time icon' off (showQt false) unticks Quiet time;
 *  - radar mode 'Rain alert only' with Rain on no visible bar ticks it on the Watch
 *    Status Bar's left (on-demand.js placeRainForCountdown, the rule the settings
 *    page's forceRainOnDemand hook applies too).
 * It never unticks a default weather alert. Then the development branch's alert keys
 * are deleted, untranslated (RETIRED_ALERT_KEYS; no release stored them, so the dev
 * watch lands on the defaults). batteryLowOnly and showQt stay stored: aplite still
 * reads them, and every other watch ignores them. btIcons 'none' unticks nothing: its
 * Show value already says Never.
 *
 * One Clay send on every existing install: the watch needs the 48-B blob (until it lands
 * it reads its compiled defaults). Marked now; the scheduler re-delivers a NACKed send
 * (clay-migrations.js).
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateOnDemand(blob, ctx) {
    var changed = false;
    var i;
    if (blob.batteryLowOnly === false) { changed = onDemand.untickEverywhere(blob, 'battery') || changed; }
    if (blob.showQt === false) { changed = onDemand.untickEverywhere(blob, 'qt') || changed; }
    changed = onDemand.placeRainForCountdown(blob) || changed;
    for (i = 0; i < RETIRED_ALERT_KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(blob, RETIRED_ALERT_KEYS[i])) {
            delete blob[RETIRED_ALERT_KEYS[i]];
            changed = true;
        }
    }
    if (changed) {
        console.log('Migrated the status bars onto On demand');
    }
    return { changed: changed, send: Boolean(ctx.hadExistingInstall) };
}

module.exports = {
    ALERT_LEVELS_STEPS: ALERT_LEVELS_STEPS,
    RETIRED_ALERT_KEYS: RETIRED_ALERT_KEYS,
    migrateOnDemand: migrateOnDemand,
    migrateAlertLevels: migrateAlertLevels,
    migrateThresholdHighlightToggles: migrateThresholdHighlightToggles,
    migrateWarnLook: migrateWarnLook,
    migrateRainWindowOff: migrateRainWindowOff,
    migrateTempSeparatorBar: migrateTempSeparatorBar
};

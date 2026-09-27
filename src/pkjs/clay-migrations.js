// src/pkjs/clay-migrations.js
//
// The marker-gated migration ledger: every one-time fixup that moves an existing
// install's stored Clay blob onto a newer shape, plus runMigrations — the ONE place a
// migration's body, marker key (storage-keys.js) and gating live together.
//
// Split out of clay-settings.js, which owns the blob itself (read/save, defaults, seed,
// dev-config apply, fixture apply). The dependency is one-way: this module reads and
// writes THROUGH clay-settings, and clay-settings knows nothing about it. So the ledger
// can keep growing without the owner module growing with it.
//
// THE RULES, none of which are local style choices:
//   - Marker keys are append-only (storage-keys.js). A shipped marker string is never
//     reused, renamed or renumbered: it is the on-flash record that a migration ran.
//   - The call ORDER inside runMigrations is load-bearing where it says so. Read the
//     comments there before moving anything.
//   - A migration whose result the WATCH must see defers its marker to the Clay ACK, so
//     a NACK retries on the next boot instead of silently marking itself done.

var claySettings = require('./clay-settings.js');
var platformLib = require('./config-ui/lib/platform.js');   // isHrPlatform (emery + diorite)
var lineStyle = require('./line-style');                    // graph-colour keys + built-ins
var resolveInk = require('./resolve-ink.js');               // polarity + its colour defaults
var thresholds = require('./status-thresholds.js');         // KINDS + the pair rules
var KEYS = require('./storage-keys');

var STORAGE_KEY = claySettings.STORAGE_KEY;

/**
 * Persist a migrated blob — clay-settings owns the storage, this module only decides
 * what goes in it.
 *
 * It does NOT insulate against a test reloading clay-settings on its own: the lookup
 * is late-bound on `claySettings`, but that variable still holds the module object
 * captured at require time, so a fresh clay-settings would be a different object this
 * never sees. Reloading the two together is the contract, and
 * test/helpers/clay-harness.js's loadUpgradeModules is where it is kept.
 *
 * @param {Object} obj Settings blob to store.
 * @returns {void}
 */
function save(obj) {
    claySettings.save(obj);
}

/**
 * Shared preamble for the marker-gated migrations: load the stored blob to
 * migrate, or return null to skip when nothing is stored, the migration has
 * already run, or the blob is malformed (logged once, tolerated).
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {string} label Migration name, used in the malformed-blob log line.
 * @returns {Object|null} Parsed settings to migrate, or null to skip.
 */
function loadForMigration(isMigrationDone, label) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);

    if (persistClayString === null || isMigrationDone()) {
        return null;
    }

    try {
        return JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, skipping ' + label);
        return null;
    }
}

/**
 * Run every marker-gated migration, in ship order — the ONE place a migration's
 * body, marker key (storage-keys.js) and gating live together; index.js's ready
 * handler used to thread twelve getItem/setItem closures through six calls.
 *
 * The two Clay-COLOR migrations and the 1.15.0 graph-night-colour and 1.23.1
 * stripe-rule resends defer their marker to the Clay ACK: a migrated blob is only
 * safe once the watch has it, and a NACK must leave the marker unset. The scheduler runs the commit on
 * the first Clay send of the session that is ACKed — the boot send, or a later
 * one carrying the same blob — so only a session in which none lands retries
 * the migration next boot. Their migrate* functions return true for "the Clay
 * resend must carry this" (marking themselves only on their no-op branches — e.g. already-migrated
 * values return true WITHOUT marking); the caller passes commitDeferredMarkers
 * as the scheduler's onClayAck. Everything else marks synchronously inside its
 * migrate* function.
 *
 * @param {{platform: string, colors: Object, defaultRadarProvider: string,
 *   hadExistingInstall: boolean}} opts
 *   platform: watch platform for the status-line health defaults; colors: the
 *   DEFAULT_HOLIDAY_COLORS bundle; defaultRadarProvider: radarMode migration
 *   fallback; hadExistingInstall: whether a settings blob was stored BEFORE this
 *   boot's seedDefaults (claySettings.hasStored()), the onboarding migration's
 *   fresh-vs-existing signal.
 * @returns {{clayRequired: boolean, commitDeferredMarkers: Function}}
 */
function runMigrations(opts) {
    function isDone(key) {
        return function () { return localStorage.getItem(key) !== null; };
    }
    function mark(key) {
        return function () { localStorage.setItem(key, '1'); };
    }
    migrateExistingInstallOnboarded(Boolean(opts.hadExistingInstall),
        isDone(KEYS.ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY),
        mark(KEYS.ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY));
    var wantsClayColors = migrateWeekendHolidayColors(opts.colors,
        isDone(KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY),
        mark(KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY));
    var wantsClayToggle = migrateHolidayWhiteToToggle(opts.colors,
        isDone(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY),
        mark(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY));
    migrateHolidayRegionKeys(
        isDone(KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY),
        mark(KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY));
    migrateStatusLineHealthDefaults(opts.platform,
        isDone(KEYS.STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY),
        mark(KEYS.STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY));
    migrateStatusTopRightBattery(
        isDone(KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY),
        mark(KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY));
    // Slot selections ride the weather bake, not Clay, and the rain look it hands the
    // row defaults to today's text: marks synchronously and asks for no send.
    migrateAlertsTopLeft(opts.platform,
        isDone(KEYS.ALERTS_TOP_LEFT_MIGRATION_KEY),
        mark(KEYS.ALERTS_TOP_LEFT_MIGRATION_KEY));
    migrateRadarProviderToMode(opts.defaultRadarProvider,
        isDone(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY),
        mark(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY));
    // Marks synchronously and asks for no send: the enable bit it now reads from the
    // stored toggle is the one the watch already holds (see the function).
    migrateThresholdHighlightToggles(
        isDone(KEYS.THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY),
        mark(KEYS.THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY));
    // Marks synchronously: if the send it asks for NACKs, the outbox's uncommitted
    // last-sent cache still carries the new text on the next Clay send.
    var wantsClayNoRainText = migrateEmptyNoRainText(
        isDone(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY),
        mark(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY));
    // Ahead of the resend below, so a 1.14 -> now jump (which fires both) sends
    // the healed blob rather than the carried one.
    migrateCarriedGraphNightTints(
        isDone(KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY),
        mark(KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY));
    // MUST run after the carried-tint release above, and the reason is not the obvious
    // one. A carried tint holds the FILL's colour, so the release detects it by
    // `night === fill`. The re-tune rewrites the Fill cell (it holds a superseded value)
    // but NOT the Night cell (which holds the fill's colour, not the Night's superseded
    // one) — breaking that equality. Run second, the release can no longer see the carry
    // and the stale colour survives as a fake pick. Verified for wind with a fill picked
    // to Inchworm, the old light default: carried-first lands Night on the built-in
    // (FFAA55), re-tune-first strands it on AAFF55 reading as a deliberate choice.
    var wantsClayLightRetune = migrateLightGraphColorRetune(
        isDone(KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY));
    var wantsClaySolidBars = migrateLightThemeSolidBars(
        isDone(KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY));
    var wantsClayNightColors = migrateGraphNightColorsResend(
        isDone(KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY));
    // Marks synchronously and asks for no send: it only rewrites the style of a line
    // that is off, which the watch never draws (and whose wire byte already resolves
    // to the new default — line-style.js lineStyleValue). A line that IS drawn and
    // now resolves differently is the stripe-rule resend's job, below.
    migrateFifthLineStyleDefault(
        isDone(KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY),
        mark(KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY));
    var wantsClayStripeRule = migrateStripeMetricRuleResend(
        isDone(KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY),
        mark(KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY));
    return {
        clayRequired: Boolean(wantsClayColors || wantsClayToggle || wantsClayLightRetune
                              || wantsClaySolidBars || wantsClayNightColors || wantsClayNoRainText
                              || wantsClayStripeRule),
        commitDeferredMarkers: function () {
            if (wantsClayColors) { mark(KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY)(); }
            if (wantsClayToggle) { mark(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY)(); }
            if (wantsClayLightRetune) { mark(KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY)(); }
            if (wantsClaySolidBars) { mark(KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY)(); }
            if (wantsClayNightColors) { mark(KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY)(); }
            if (wantsClayStripeRule) { mark(KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY)(); }
        }
    };
}

/**
 * Mark an EXISTING install as onboarded, so the first-run wizard's auto-open
 * (settings/wizard.js shouldShow, gated on onboardingDone) only fires for a
 * genuinely fresh install.
 *
 * The wizard used to treat "the saved config has no keys at all" as fresh, but
 * seedDefaults writes the full defaults blob on the first boot, before any
 * settings page can open — so it never auto-opened. onboardingDone is the
 * signal now, and it cannot be told apart by the key alone: seedDefaults'
 * backfill has already written onboardingDone:false into every existing
 * install's blob, so gating on it without this would push the whole installed
 * base into the wizard (and its country re-derivation) on the next open.
 *
 * The fresh-vs-existing verdict is hadExistingInstall — a blob stored BEFORE
 * this boot's seedDefaults. The marker is committed on EVERY boot that finds
 * it absent, fresh installs included: keyed on hadExistingInstall alone, a
 * fresh install's SECOND boot (blob present by then, settings not yet opened)
 * would read as existing and suppress the wizard it has not seen yet.
 *
 * "Reset watchface" still reopens the wizard: resetAll clears every marker
 * together with the blob, so the next boot is fresh again.
 *
 * No Clay resend: onboardingDone is page-only and never reaches the watch.
 *
 * @param {boolean} hadExistingInstall Whether a settings blob predates this boot.
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {void}
 */
function migrateExistingInstallOnboarded(hadExistingInstall, isMigrationDone, markDone) {
    var persistClay;
    if (isMigrationDone()) { return; }
    if (hadExistingInstall) {
        persistClay = loadForMigration(isMigrationDone, 'onboarding existing-install migration');
        if (persistClay !== null && persistClay.onboardingDone !== true) {
            persistClay.onboardingDone = true;
            save(persistClay);
            console.log('Marked the existing install as onboarded');
        }
    }
    markDone();
}

/**
 * One-time forced Clay resend for the 1.15.0 graph colours. It migrates NO
 * stored value — its only job is to make one Clay send happen on the first boot
 * after the upgrade.
 *
 * 1.15.0 grew CLAY_LINE_STYLE_UINT8 from 4 to 10 bytes and the watch now reads
 * its night-area colours from the persist key that tuple writes (NIGHT_COLORS,
 * absent = the built-in precip triple). An IN-PLACE upgrade keeps the watch's
 * CONFIG persist, so the startup handshake reports hasConfig true and the
 * scheduler queues no Clay send; nothing else heals it either (the legacy
 * holiday migrations are long since marked, the holiday day stamp is already
 * today's, and showConfiguration does not send Clay). Without this, a colour
 * watch on dark polarity with day/night shading + fill on and a
 * wind/uv/gust/pressure main metric paints a precip-blue night area until the
 * settings page is opened and SAVED, or the local day rolls over.
 *
 * The change-detector still transmits when this fires: the phone's last-sent
 * cache holds the OLD 4-byte tuple and the new payload is 10 bytes.
 *
 * Marker-gated, and the marker is DEFERRED to the Clay ACK (see runMigrations),
 * so a NACK retries on the next boot instead of silently marking it done.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @returns {boolean} True when the settings must be sent to the watch.
 */
function migrateGraphNightColorsResend(isMigrationDone) {
    // loadForMigration is used purely as the gate here (marker unset AND a
    // stored blob to send); nothing is read out of the blob and nothing is
    // written back, so there is no save() and no synchronous markDone().
    if (loadForMigration(isMigrationDone, 'graph night-colour resend') === null) {
        return false;
    }
    console.log('Forcing one Clay resend so the watch gets the graph night colours');
    return true;
}

/**
 * Un-carry a graph night tint that the 1.15.0 settings page wrote into the
 * tint key on the user's behalf.
 *
 * 1.15.0 shipped the fill -> tint cascade as a PAGE-SIDE write: its
 * `graphFillTint` onChange hook did `S[gc<Metric>Night<Pol>] = newFill` on every
 * fill pick whose tint was still unclaimed, and line-style.js then recognised
 * the carry by comparing the two stored values ("night equals fill" meant "not a
 * pick"). The cascade has since moved to RESOLVE time (line-style.js'
 * graphNightTint), which makes a stored tint mean exactly one thing — the user
 * chose it — and that is what makes a tint deliberately set equal to its fill
 * answerable at all. Every 1.15.0 install that ever used a metric's fill picker
 * has the carried bytes on flash, and under the new reading they are a pick:
 *
 *   - the wire's night-fill flag (byte [9] bit 0) would flip 0 -> 1, and on a
 *     COLOUR watch with a light theme and the secondary fill on that bit is the
 *     opt-in forecast_layer.c uses to draw the night re-shade 1.15.0 skipped;
 *   - graphNightTint would answer from the tint key forever, so changing the
 *     fill would leave the night hours painted in the fill colour the user just
 *     replaced — the exact failure the cascade exists to prevent;
 *   - telemetry would report those carried colours as picks.
 *
 * So a stored tint that still equals its stored fill goes back to the built-in.
 * The resolve-time cascade then re-derives the same triple from the fill with
 * the flag clear, which is byte-for-byte what 1.15.0 sent. A tint the user set
 * equal to the fill BY HAND is cleared too — indistinguishable by construction,
 * and 1.15.0 painted the two identically anyway, so clearing it is the
 * appearance-preserving choice.
 *
 * One shape is not restored byte-for-byte: a fill picked to the metric's OWN
 * built-in fill colour (e.g. precip + CobaltBlue). 1.15.0 stored that in the
 * tint key too, where it was not precip's night built-in, so it derived a
 * lightened night triple; with the tint cleared both keys read as built-in and
 * the hand-tuned triple stands. The flag still stays 0, and the result is what a
 * fresh install with those same settings paints.
 *
 * No Clay resend is asked for: the healed blob packs the bytes the watch is
 * already holding, so there is nothing to transmit. The narrow shape above does
 * change the tuple, and the change-detector sends that on its own.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {boolean} True when a carried tint was cleared.
 */
function migrateCarriedGraphNightTints(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'carried graph night-tint migration');

    if (persistClay === null) {
        return false;
    }

    var metrics = lineStyle.GRAPH_METRICS;
    var changed = false;
    var polarities = ['Dark', 'Light'];
    var i, j, metric, suffix, nightKey, night, fill;

    for (i = 0; i < metrics.length; i++) {
        metric = metrics[i];
        // feels is Line-only, so it owns neither key (graphColorRoles).
        if (lineStyle.graphColorRoles(metric).indexOf('Night') === -1) { continue; }
        for (j = 0; j < polarities.length; j++) {
            suffix = polarities[j];
            nightKey = lineStyle.graphColorKey(metric, 'Night', suffix);
            night = lineStyle.colorPick(persistClay[nightKey]);
            // Already on the built-in: nothing was carried into it.
            if (night === null
                || lineStyle.graphColorIsDefault(persistClay, metric, 'Night', suffix)) {
                continue;
            }
            fill = lineStyle.colorPick(persistClay[lineStyle.graphColorKey(metric, 'Fill', suffix)]);
            if (fill === null || fill !== night) { continue; }
            // The INT form, like the schema defaults: parseResponse stores ints.
            persistClay[nightKey] = lineStyle.graphColorDefault(metric, 'Night', suffix, persistClay);
            changed = true;
        }
    }

    if (changed) {
        save(persistClay);
        console.log('Released graph night tints the 1.15.0 page carried from their fill');
    }
    markDone();
    return changed;
}

// The LIGHT-polarity graph colours seedDefaults wrote before the hardware re-tune —
// only the cells whose built-in actually moved. An install still holding one of these
// is holding a SEEDED value, not a choice: nobody navigated to a colour sheet to pick
// the colour the page had already put there.
//
// This table is a FROZEN historical record, not a view of the current defaults. It
// must never be re-derived from line-style.js — the whole point is that the built-ins
// have moved away from these. ADR-0003 §4, "Re-tuning a built-in needs a migration of
// its own", which is also where a FUTURE re-tune's own table and marker are specified.
var SUPERSEDED_LIGHT_GRAPH_COLORS = [
    { metric: 'precip_prob', role: 'Line',  was: 0x00AAFF },  // VividCerulean -> DukeBlue
    { metric: 'precip_prob', role: 'Night', was: 0x0000AA },  // DukeBlue      -> Cyan
    { metric: 'wind',        role: 'Line',  was: 0xFFFF00 },  // Yellow        -> ChromeYellow
    { metric: 'wind',        role: 'Fill',  was: 0xAAFF55 },  // Inchworm      -> Yellow
    { metric: 'wind',        role: 'Night', was: 0x555500 },  // ArmyGreen     -> Rajah
    { metric: 'uv',          role: 'Line',  was: 0xFF00FF },  // Magenta       -> Purple
    { metric: 'uv',          role: 'Night', was: 0x550055 },  // ImperialPurple-> ShockingPink
    { metric: 'gust',        role: 'Night', was: 0x555555 },  // DarkGray      -> LightGray
    { metric: 'pressure',    role: 'Fill',  was: 0xFFAA00 },  // ChromeYellow  -> Rajah
    { metric: 'pressure',    role: 'Night', was: 0xAA5500 }   // WindsorTan    -> Rajah
];

/**
 * Move existing installs onto the re-tuned LIGHT-theme graph colours.
 *
 * The graph colours are stored CONCRETE — seedDefaults writes a real colour into
 * every gc* key rather than leaving it absent — so re-tuning a built-in does not
 * reach anyone who is already installed. Their stored colour is the OLD default,
 * which no longer equals the new built-in, so graphColorIsDefault reads it as a
 * deliberate pick and the old colour keeps winning. Observed on a real watch after
 * the re-tune: every light row had to be reset by hand, one at a time.
 *
 * So a stored LIGHT colour that still equals the value the page seeded (the frozen
 * table above) is overwritten with the new built-in. Anything else is left alone —
 * a colour that is neither the old default nor the new one is a colour somebody
 * chose, and a re-tune of the defaults is not a licence to discard it.
 *
 * The one shape this cannot preserve: a user who DELIBERATELY picked a colour that
 * happened to equal the old default gets re-tuned along with everyone else. That is
 * indistinguishable by construction — the stored bytes are identical — and it is the
 * same trade-off migrateCarriedGraphNightTints accepts. They can pick it again.
 *
 * DARK is untouched: its built-ins did not move.
 *
 * A Clay resend IS required, for the reason spelled out on
 * migrateGraphNightColorsResend: an in-place upgrade queues no Clay send of its own,
 * so without this the healed blob would sit on the phone while the watch keeps
 * painting the old colours. The marker is therefore DEFERRED to the Clay ACK (see
 * runMigrations), so a NACK retries next boot.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @returns {boolean} True when the migrated settings must be sent to the watch. There is
 *   no markDone: this one NEVER marks itself, the ACK does (see the tail of the body).
 */
function migrateLightGraphColorRetune(isMigrationDone) {
    var persistClay = loadForMigration(isMigrationDone, 'light graph-colour re-tune');

    if (persistClay === null) {
        return false;
    }

    var changed = false;
    var i, cell, key, stored;

    for (i = 0; i < SUPERSEDED_LIGHT_GRAPH_COLORS.length; i++) {
        cell = SUPERSEDED_LIGHT_GRAPH_COLORS[i];
        key = lineStyle.graphColorKey(cell.metric, cell.role, 'Light');
        stored = lineStyle.colorPick(persistClay[key]);
        // Absent: nothing was seeded, so it already resolves to the new built-in.
        if (stored === null || stored !== cell.was) { continue; }
        // The INT form, like the schema defaults: parseResponse stores ints.
        persistClay[key] = lineStyle.graphColorDefault(cell.metric, cell.role, 'Light',
                                                       persistClay);
        changed = true;
    }

    if (changed) {
        save(persistClay);
        console.log('Re-tuned the seeded light-theme graph colours');
    }
    // ALWAYS ask for the send, rewrite or not, and never mark done here — the marker
    // rides the Clay ACK (runMigrations), so a NACK retries on the next boot.
    //
    // The tempting "nothing to rewrite, so mark done" shortcut is a BUG, and a subtle
    // one: a blob with nothing left to rewrite is also exactly what a run that saved and
    // then NACKed looks like. Marking done there strands that install on the old colours
    // until it opens and saves the settings page, since an in-place upgrade queues no
    // Clay send of its own. Gating on "every cell reads as the built-in" instead does not
    // save it either — one deliberately chosen colour makes that false forever, which is
    // the shape test/clay-migrations.test.js pins.
    //
    // The cost of being unconditional is one redundant Clay message on an install that
    // never held the old defaults. It does not loop: nothing changed means the payload
    // matches the last-sent cache, sendClay calls onSuccess immediately, and the marker
    // commits. migrateGraphNightColorsResend is unconditional for the same reason.
    return true;
}

/**
 * Move an install that is ALREADY on a light-polarity theme onto the light default
 * for the two bar colour modes (rainBarColor, radarColor): Solid, not multicolor.
 *
 * The five multicolor rain tiers are tuned against a black background; on white the
 * two lightest wash out. That is why the light polarity now starts on Solid — but the
 * settings page only converts the pair when the Theme control FLIPS polarity
 * (theme-convert.js), which reaches nobody who picked Light before this shipped. Their
 * stored 'multicolor' is the value seedDefaults wrote, and nothing else heals it: an
 * in-place upgrade keeps the watch's CONFIG persist, so the handshake reports hasConfig
 * true and the scheduler queues no Clay send.
 *
 * A light install that deliberately chose Multicolor is converted too. Nothing in the
 * blob separates that from the seeded value — the same imprecision theme-convert.js
 * carries for the colour pickers, and the price of storing defaults concretely.
 *
 * Polarity, not colour-ness: bw-light is migrated as well, even though its bar palette
 * is B&W and the picker is hidden there. Switching bw-light -> light is not a polarity
 * flip, so the hook would never convert it, and that install would be the one install
 * that still arrived on multicolor.
 *
 * Shape: the same one the two migrations above have — load, rewrite what needs
 * rewriting, ALWAYS return true, never mark itself. The marker rides the Clay ACK
 * (runMigrations), so a NACK retries on the next boot. A dark install rewrites nothing
 * and still asks for the send; that spends one redundant Clay message on its first boot
 * after the upgrade, which is the price of the family having one rule instead of three.
 * It cannot loop: an unchanged payload matches the last-sent cache, sendClay calls
 * onSuccess immediately, and the marker commits.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @returns {boolean} True when the migrated settings must be sent to the watch. There is
 *   no markDone: this one NEVER marks itself, the ACK does.
 */
function migrateLightThemeSolidBars(isMigrationDone) {
    var persistClay = loadForMigration(isMigrationDone, 'light-theme solid bars');

    if (persistClay === null) {
        return false;
    }

    var keys = resolveInk.BAR_COLOR_KEYS;
    var changed = false;
    var wanted, i;

    if (resolveInk.isLightPolarity(persistClay.theme)) {
        wanted = resolveInk.barColorDefault(persistClay.theme);
        for (i = 0; i < keys.length; i++) {
            // Everything that is not already Solid moves: the pair is a two-value
            // vocabulary, so that is 'multicolor' or an absent key. Absent is written out
            // rather than left implicit — the next hydrate would fill it from the
            // schema's dark default, which has no theme to ask.
            if (persistClay[keys[i]] === wanted) { continue; }
            persistClay[keys[i]] = wanted;
            changed = true;
        }
    }

    if (changed) {
        save(persistClay);
        console.log('Moved the light theme onto the solid rain-bar and radar colours');
    }
    return true;
}

/**
 * Move existing installs from the old all-white weekend/holiday defaults to the
 * current highlighted default while preserving any customized color set.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {boolean} True when the migrated settings should be sent to the watch.
 */
function migrateWeekendHolidayColors(colors, isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'weekend/holiday color migration');

    if (persistClay === null) {
        return false;
    }

    if (
        persistClay.colorSunday === colors.white &&
        persistClay.colorSaturday === colors.white &&
        persistClay.colorUSFederal === colors.white
    ) {
        persistClay.colorSunday = colors.folly;
        persistClay.colorSaturday = colors.folly;
        persistClay.colorUSFederal = colors.holiday;
        save(persistClay);
        console.log('Migrated weekend/holiday color defaults to Folly/Blue Moon');
        return true;
    }

    if (
        persistClay.colorSunday === colors.folly &&
        persistClay.colorSaturday === colors.folly &&
        persistClay.colorUSFederal === colors.holiday
    ) {
        return true;
    }

    markDone();
    return false;
}

/**
 * Migrate installs that used white as the holiday "off" flag onto the
 * Holiday highlight toggle. White was the old way to disable holiday
 * highlighting; the toggle now owns on/off and white is no longer a
 * selectable holiday color, so a stored white means "user wanted off".
 * Preserve that intent (holidaysEnabled = false) and reset the color to a
 * valid default for when they re-enable.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {boolean} True when the migrated settings should be sent to the watch.
 */
function migrateHolidayWhiteToToggle(colors, isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'holiday highlight migration');

    if (persistClay === null) {
        return false;
    }

    if (persistClay.colorUSFederal === colors.white) {
        persistClay.holidaysEnabled = false;
        persistClay.colorUSFederal = colors.holiday;
        save(persistClay);
        console.log('Migrated white holiday color to Holiday highlight toggle off');
        return true;
    }

    markDone();
    return false;
}

/**
 * Collapse the six per-country holidayRegion<CC> keys into the single holidayRegion
 * key, adopting the value for the currently-selected country. One-time; marker-gated.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {void}
 */
function migrateHolidayRegionKeys(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'holidayRegion key migration');
    var oldKeys = ['holidayRegionDE', 'holidayRegionAT', 'holidayRegionCH', 'holidayRegionES', 'holidayRegionGB', 'holidayRegionUS'];
    var oldKey;
    var i;

    if (persistClay === null) {
        return;
    }

    oldKey = 'holidayRegion' + persistClay.holidayCountry;
    if (persistClay[oldKey] && (typeof persistClay.holidayRegion === 'undefined' || persistClay.holidayRegion === 'all')) {
        persistClay.holidayRegion = persistClay[oldKey];
    }
    for (i = 0; i < oldKeys.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(persistClay, oldKeys[i])) {
            delete persistClay[oldKeys[i]];
        }
    }
    if (typeof persistClay.holidayRegion === 'undefined') {
        persistClay.holidayRegion = 'all';
    }
    save(persistClay);
    markDone();
}

/**
 * One-time upgrade of the seeded health-line defaults to the HR-capable
 * triple (emery + diorite) (steps/sleep/hr). Only rewrites slots still
 * holding the static defaults, so a user's explicit choice is never clobbered.
 * @param {string} platform watch platform name ('emery', 'basalt', ...)
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 */
function migrateStatusLineHealthDefaults(platform, isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'status line health defaults');
    if (persistClay === null) { return; }
    if (platformLib.isHrPlatform(platform)
            && persistClay.statusHealthLeft === 'steps'
            && persistClay.statusHealthMid === 'empty'
            && persistClay.statusHealthRight === 'sleep') {
        persistClay.statusHealthMid = 'sleep';
        persistClay.statusHealthRight = 'hr';
        save(persistClay);
        console.log('Migrated health status line to HR-capable defaults');
    }
    markDone();
}

/**
 * One-time migration: existing installs stored statusTopRight = 'empty' while
 * old builds always drew the fixed battery corner. The corner is now the
 * top-right slot (default 'battery'), so a stored 'empty' would hide the
 * battery on upgrade — map it to 'battery'. A user's explicit non-empty choice
 * is left alone.
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 * @returns {void}
 */
function migrateStatusTopRightBattery(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'top-right battery slot');
    if (persistClay === null) { return; }
    if (persistClay.statusTopRight === 'empty') {
        persistClay.statusTopRight = 'battery';
        save(persistClay);
        console.log('Migrated top-right slot empty -> battery');
    }
    markDone();
}

/**
 * One-time 1.24.0 placement of the Alerts row in the top strip's left slot — the
 * new fresh-install default (status-line-catalog.js LINES.top) — for installs that
 * still hold a default there. The row replaces the strip's old rain takeover, so an
 * install that does not get it loses the rain countdown it had. Rewrites only:
 *   (a) statusTopLeft 'empty' -> 'alerts', on every platform that has the row (all
 *       but aplite, where the item does not exist). An UNSET slot needs no write:
 *       it already resolves to the new default (slotDefault), so a fresh seeded
 *       blob stays exactly as seeded. On emery 'empty' was not the default, so this
 *       can override a deliberate pick — taken anyway because an idle Alerts row
 *       draws nothing: the slot still looks empty until something alerts
 *       (migrateStatusTopRightBattery made the same call);
 *   (b) 'week' -> 'alerts' on EMERY ONLY, where the calendar week was the shipped
 *       default. Nothing else ever writes 'week' (no wizard rule does), so on every
 *       other platform it is a deliberate pick and stays. The index.js fallback
 *       platform when watchInfo is unreadable is basalt, so an unknown watch keeps
 *       its week — the safe direction;
 *   (c) the 144/180 px wizard-with-health cohort: statusTopLeft 'steps' AND
 *       statusHealthLeft 'distance' (the retired wizard-health-slots-compact rule's
 *       exact footprint) AND healthMode 'status' or 'all' (the health bar is on
 *       screen) -> top-left 'alerts', health-left back to 'steps'. The wizard's
 *       distance filler is dropped and steps stays on the face. Not on emery: its
 *       wizard promoted steps top-RIGHT, so this pair there was picked by hand;
 *   (d) anything else is left alone — the Alerts card nudges those users to place
 *       the row themselves.
 * No Clay resend: slot selections ride the weather bake, and the row's rain look
 * (rainAlertDisplay) defaults to today's text while every metric alert defaults
 * off, so an untouched upgrade renders exactly today's rain-only behaviour.
 * @param {string} platform watch platform name ('emery', 'basalt', ...)
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 * @returns {void}
 */
function migrateAlertsTopLeft(platform, isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'alerts top-left slot');
    if (persistClay === null) { return; }
    // aplite has no Alerts row (the item is notAplite): writing it there would only
    // store a value its slot sheet cannot offer.
    if (platform === 'aplite') { markDone(); return; }
    var left = persistClay.statusTopLeft;
    var emery = platform === 'emery';
    var healthShown = persistClay.healthMode === 'status' || persistClay.healthMode === 'all';
    var moved = false;
    if (left === 'empty' || (emery && left === 'week')) {
        persistClay.statusTopLeft = 'alerts';
        moved = true;
    } else if (!emery && left === 'steps' && persistClay.statusHealthLeft === 'distance'
            && healthShown) {
        persistClay.statusTopLeft = 'alerts';
        persistClay.statusHealthLeft = 'steps';
        moved = true;
    }
    if (moved) {
        save(persistClay);
        console.log('Migrated top-left slot to the Alerts row');
    }
    markDone();
}

/**
 * One-time 1.23.0 migration of the radar no-rain text, to the new default "You're
 * good :)". Two stored values move:
 *  - empty: it used to mean "use the built-in default" (the field's hint said "clear
 *    the field to use the default"); from 1.23.0 on it means "show no message", so an
 *    empty value becomes the default and nobody's radar loses its line on upgrade;
 *  - the old default "No rain ahead": seedDefaults wrote it into every blob, so an
 *    untouched field holds it — those users get the new default like new installs.
 * Returns true when the watch needs the new text sent: it still holds the old
 * default "No rain ahead" (an empty text needs no send — the watch had deleted its
 * slot and already draws the new built-in default).
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 * @returns {boolean} True when the rewritten text must reach the watch (a Clay send).
 */
function migrateEmptyNoRainText(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'empty no-rain text');
    if (persistClay === null) { return; }
    var text = persistClay.radarNoRainText;
    var resend = false;
    if (typeof text === 'string' && (text.trim() === '' || text === 'No rain ahead')) {
        resend = (text === 'No rain ahead');
        persistClay.radarNoRainText = "You're good :)";
        save(persistClay);
        console.log('Migrated no-rain text -> the new default');
    }
    markDone();
    return resend;
}

/**
 * One-time 1.23.1 move of the fourth metric's line style onto its new default, x marks.
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
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 * @returns {void}
 */
function migrateFifthLineStyleDefault(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'fourth-line style default');
    if (persistClay === null) { return; }
    var fifthLineOff = !persistClay.fifthLine || persistClay.fifthLine === 'off';
    if (fifthLineOff && persistClay.fifthLineStyle === 'stripeTop') {
        persistClay.fifthLineStyle = 'x';
        save(persistClay);
        console.log('Migrated the unused fourth-line style stripeTop -> x');
    }
    markDone();
}

/**
 * One-time forced Clay resend for the 1.23.1 stripe rule: a stripe only shows an
 * intensity metric (line-style.js metricAllowsStripe), so a stripe stored on a DRAWN
 * feels-like, dew-point or pressure line now resolves to that line's non-stripe style
 * (lineStyleValue) and its CLAY_LINE_STYLE_UINT8 byte changes — e.g. the fourth metric
 * on pressure with 1.23.0's default 'stripeTop' goes 0x07 -> 0x02. The watch still
 * holds the old byte, and an IN-PLACE upgrade sends no Clay (the handshake reports
 * hasConfig true; see migrateGraphNightColorsResend), so without this it keeps drawing
 * the stripe until the next day-change or settings save — while the next weather bake
 * already drops the top-stripe padding (forecast-series.js topStripeDrawn) under it.
 *
 * Rewrites nothing: the stored stripe stays a pick (the settings page keeps it dormant
 * and brings it back with an intensity metric). A line that is off or repeats an
 * earlier line's metric (lineStyle.effectiveLineMetric null) is never drawn, so it
 * needs no send.
 *
 * Marker-gated; the marker is DEFERRED to the Clay ACK (see runMigrations) when a send
 * is wanted, so a NACK retries on the next boot, and set right away when there is
 * nothing to send.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete (no-send branch only).
 * @returns {boolean} True when the settings must be sent to the watch.
 */
function migrateStripeMetricRuleResend(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'stripe-rule resend');
    if (persistClay === null) { return false; }
    for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
        var line = lineStyle.FORECAST_LINES[i];
        var metric = lineStyle.effectiveLineMetric(persistClay, line.key);
        if (metric && lineStyle.isStripeValue(persistClay[line.styleKey])
                && !lineStyle.metricAllowsStripe(metric)) {
            console.log('Forcing one Clay resend: a stripe on ' + metric + ' now draws as '
                + lineStyle.lineStyleValue(persistClay, line.styleKey));
            return true;
        }
    }
    markDone();
    return false;
}

/**
 * One-time migration onto the radarMode tiered setting. Existing installs that
 * disabled radar via radarProvider:'disabled' map to radarMode:'off' and get
 * their now-invalid provider rewritten to a real default (the Off option was
 * removed from the provider picker). Every other existing install that has no
 * radarMode yet initializes to 'graph' (full radar — the prior default-on
 * behavior). Marker-gated; only touches what needs correcting.
 * @param {string} defaultRadarProvider Provider to adopt when clearing 'disabled' (e.g. 'rainbow').
 * @param {function(): boolean} isMigrationDone marker probe
 * @param {function()} markDone marker setter
 * @returns {void}
 */
function migrateRadarProviderToMode(defaultRadarProvider, isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'radar view mode');
    if (persistClay === null) { return; }
    if (persistClay.radarProvider === 'disabled') {
        persistClay.radarMode = 'off';
        persistClay.radarProvider = defaultRadarProvider;
        save(persistClay);
        console.log('Migrated radarProvider=disabled -> radarMode=off');
    }
    else if (typeof persistClay.radarMode === 'undefined') {
        persistClay.radarMode = 'graph';
        save(persistClay);
        console.log('Initialized radarMode=graph for existing radar install');
    }
    markDone();
}

/**
 * One-time 1.24.0 backfill of the "Highlight on the watch" toggles (thresh<K>On) from
 * their pairs. Until 1.24.0 the toggle was page-derived state: every settings open
 * rewrote it as "the stored warn/danger pair is complete and ordered", and the phone
 * packed the blob[0] enable bit from the pair alone. From 1.24.0 on the STORED toggle
 * owns the bit (status-thresholds.js kindConfig: On === true AND an ordered pair) and
 * the pair lives on while it is off, so a blob whose toggle was never re-derived — a
 * pair set in the old text fields and settings not opened since — would silently lose
 * its highlight. For every kind with a pair (bold-only kinds have none): On := the
 * pair is ordered, the last truth the page would have shown.
 *
 * Keyed on the PAIR, never on the toggle being absent: thresh<K>On has had a schema
 * default (false) for releases, so seedDefaults — which runs before the ledger
 * (index.js; the layoutPreset trap) — has long since written it into every blob and
 * "absent" is not observable. The pair alone tells the three populations apart:
 * highlight on (ordered pair) → true; highlight off (the old OFF blanked the pair) →
 * false; AQI's wizard-seeded highlight (100/150 or 60/80 via the thresholdToggle hook)
 * → true.
 *
 * A pair that is not ordered but not blank either — half ('7', '') from the old text
 * fields, inverted, junk — is normalised to '' on both keys: the phone and the page
 * already resolve it to the kind's seed as a whole (resolvedPair), while the slider
 * fell back per value and would preview 'Warn 7' against a seed-6 hold. Blank is the
 * one stored form of "the seed" from here on; no numbers are written into any blob.
 *
 * No Clay send: for every install the post-migration enable bit (On && ordered) equals
 * the pre-split one (ordered), which the watch already holds. Idempotent; a fresh
 * install (blank pairs, toggles false) is a no-op. "Reset watchface" re-sets this
 * marker (clay-settings.js resetAll), because after a reset the page can save an OFF
 * with its pair kept before the next boot would re-derive it back ON.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {void}
 */
function migrateThresholdHighlightToggles(isMigrationDone, markDone) {
    var persistClay = loadForMigration(isMigrationDone, 'threshold highlight toggles');
    if (persistClay === null) { return; }
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var onKey = 'thresh' + kind.key + 'On';
        var warnKey = 'thresh' + kind.key + 'Warn';
        var dangerKey = 'thresh' + kind.key + 'Danger';
        var ordered = thresholds.pairOrdered(thresholds.parseThreshold(persistClay[warnKey]),
            thresholds.parseThreshold(persistClay[dangerKey]));
        // Write only when the stored value is not already the verdict. An absent
        // toggle already reads as off (kindConfig wants === true), so it is left
        // absent under an unusable pair.
        var on = persistClay[onKey];
        if (ordered ? on !== true : (on !== false && typeof on !== 'undefined')) {
            persistClay[onKey] = ordered;
            changed = true;
        }
        if (!ordered) {
            var pairKeys = [warnKey, dangerKey];
            for (var p = 0; p < pairKeys.length; p++) {
                var raw = persistClay[pairKeys[p]];
                // null/undefined read as blank already (parseThreshold); only a stored
                // non-blank half of an unusable pair is rewritten.
                if (raw !== '' && raw !== null && typeof raw !== 'undefined') {
                    persistClay[pairKeys[p]] = '';
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        save(persistClay);
        console.log('Migrated threshold highlight toggles from their pairs');
    }
    markDone();
}

module.exports = {
    runMigrations: runMigrations,
    migrateExistingInstallOnboarded: migrateExistingInstallOnboarded,
    migrateWeekendHolidayColors: migrateWeekendHolidayColors,
    migrateHolidayWhiteToToggle: migrateHolidayWhiteToToggle,
    migrateHolidayRegionKeys: migrateHolidayRegionKeys,
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery,
    migrateAlertsTopLeft: migrateAlertsTopLeft,
    migrateRadarProviderToMode: migrateRadarProviderToMode,
    migrateThresholdHighlightToggles: migrateThresholdHighlightToggles,
    migrateEmptyNoRainText: migrateEmptyNoRainText,
    migrateFifthLineStyleDefault: migrateFifthLineStyleDefault,
    migrateStripeMetricRuleResend: migrateStripeMetricRuleResend,
    migrateGraphNightColorsResend: migrateGraphNightColorsResend,
    migrateCarriedGraphNightTints: migrateCarriedGraphNightTints,
    migrateLightGraphColorRetune: migrateLightGraphColorRetune,
    migrateLightThemeSolidBars: migrateLightThemeSolidBars
};

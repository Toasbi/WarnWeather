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
 * The two Clay-COLOR migrations and the 1.15.0 graph-night-colour resend defer
 * their marker to the Clay ACK: a migrated blob is only safe once the watch has
 * it, and a NACK must leave the marker unset so the migration retries next
 * boot. Their migrate* functions return true for "the Clay resend must carry
 * this" (marking themselves only on their no-op branches — e.g. already-migrated
 * values return true WITHOUT marking); the caller passes commitDeferredMarkers
 * as the scheduler's onClayAck. Everything else marks synchronously inside its
 * migrate* function.
 *
 * @param {{platform: string, colors: Object, defaultRadarProvider: string}} opts
 *   platform: watch platform for the status-line health defaults; colors: the
 *   DEFAULT_HOLIDAY_COLORS bundle; defaultRadarProvider: radarMode migration
 *   fallback.
 * @returns {{clayRequired: boolean, commitDeferredMarkers: Function}}
 */
function runMigrations(opts) {
    function isDone(key) {
        return function () { return localStorage.getItem(key) !== null; };
    }
    function mark(key) {
        return function () { localStorage.setItem(key, '1'); };
    }
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
    migrateRadarProviderToMode(opts.defaultRadarProvider,
        isDone(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY),
        mark(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY));
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
    return {
        clayRequired: Boolean(wantsClayColors || wantsClayToggle || wantsClayLightRetune
                              || wantsClaySolidBars || wantsClayNightColors),
        commitDeferredMarkers: function () {
            if (wantsClayColors) { mark(KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY)(); }
            if (wantsClayToggle) { mark(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY)(); }
            if (wantsClayLightRetune) { mark(KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY)(); }
            if (wantsClaySolidBars) { mark(KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY)(); }
            if (wantsClayNightColors) { mark(KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY)(); }
        }
    };
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

module.exports = {
    runMigrations: runMigrations,
    migrateWeekendHolidayColors: migrateWeekendHolidayColors,
    migrateHolidayWhiteToToggle: migrateHolidayWhiteToToggle,
    migrateHolidayRegionKeys: migrateHolidayRegionKeys,
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery,
    migrateRadarProviderToMode: migrateRadarProviderToMode,
    migrateGraphNightColorsResend: migrateGraphNightColorsResend,
    migrateCarriedGraphNightTints: migrateCarriedGraphNightTints,
    migrateLightGraphColorRetune: migrateLightGraphColorRetune,
    migrateLightThemeSolidBars: migrateLightThemeSolidBars
};

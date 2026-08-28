// src/pkjs/clay-settings.js
//
// Owner of the 'clay-settings' localStorage blob: read/save, defaults, seed,
// dev-config apply, fixture apply, and the weekend/holiday color migration.
// localStorage is the ambient PKJS global; tests inject a fake before require.

var settings = require('./settings');
var platformLib = require('./config-ui/lib/platform.js');   // isHrPlatform (emery + diorite)
var lineStyle = require('./line-style');                    // graph-colour keys + built-ins
var KEYS = require('./storage-keys');

var STORAGE_KEY = 'clay-settings';

// Credentials "Reset watchface" deliberately KEEPS. The reset is about the face;
// making someone dig out an API key again — one they may have paid for, or waited
// on an activation email for — is a different and far more annoying kind of reset
// than the one they asked for. The Weather Underground key is scraped rather than
// typed and already lives outside the blob (KEYS.WU_API_KEY), so it is preserved
// separately below.
var PRESERVED_SETTING_KEYS = ['owmApiKey', 'yandexApiKey', 'tomorrowioApiKey'];

/**
 * Wipe phone-side PKJS localStorage — the settings blob and every cache /
 * migration-marker key — for a "Reset watchface" fresh start. The next boot then
 * follows the first-install path (defaults seeded, migrations run once, wizard
 * reopens), so there is nothing pre-migrated to double-apply.
 *
 * The exception is PRESERVED_SETTING_KEYS plus the scraped Weather Underground
 * key: see the note there for why credentials survive a reset.
 *
 * @returns {Object} The preserved credentials, so the caller can keep the live
 *   in-memory settings usable until the next boot re-seeds them.
 */
function resetAll() {
    var blob = read() || {};
    var keep = {};
    var kept = false;
    var wuKey = localStorage.getItem(KEYS.WU_API_KEY);
    var i;
    var k;
    for (i = 0; i < PRESERVED_SETTING_KEYS.length; i++) {
        k = PRESERVED_SETTING_KEYS[i];
        if (blob[k]) { keep[k] = blob[k]; kept = true; }
    }
    // Backstop, not the primary path: every wired save runs fillFromPreserved
    // first (index.js webviewclosed), which consumes any parked slot into the
    // blob — so this normally finds nothing. It stands so resetAll ALONE upholds
    // "a reset never destroys the parked keys" for any save path that skips the
    // fill: a second reset in one session would otherwise localStorage.clear()
    // the only remaining copy. Fill-only, so a key in the blob (typed, or filled
    // by the save) wins over its parked predecessor.
    if (restorePreserved(keep)) { kept = true; }
    localStorage.clear();
    // The settings blob itself must stay ABSENT: the wizard only reopens for a
    // config with no keys at all, so putting the kept credentials straight back
    // would silently skip the first-time setup this reset promises. They wait in
    // their own entry instead, and seedDefaults folds them into the fresh blob on
    // the next boot. The WU key never lived in the blob, so it just goes back.
    if (kept) { localStorage.setItem(KEYS.PRESERVED_KEYS_KEY, JSON.stringify(keep)); }
    if (wuKey) { localStorage.setItem(KEYS.WU_API_KEY, wuKey); }
    return keep;
}

/**
 * The credentials parked by resetAll(), or null when none/malformed. Read-only:
 * dropping the slot (good parking after a restore, malformed parking always) is
 * restorePreserved's job — every consumer of the slot goes through it.
 *
 * @returns {?Object} Parked key -> value map.
 */
function readParked() {
    var raw = localStorage.getItem(KEYS.PRESERVED_KEYS_KEY);
    var parsed;
    if (!raw) { return null; }
    try {
        parsed = JSON.parse(raw);
    } catch (ex) {
        return null;
    }
    // Only a plain object is a parking slot the app could have written; a
    // JSON-valid string/array (storage corruption) would otherwise be for-in
    // iterated into junk index keys downstream.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    return parsed;
}

/**
 * Fill a settings blob's EMPTY credential fields from the parked slot — the live
 * session's counterpart to the boot-time restore below. Between a reset and the
 * next boot the page hydrates from an absent blob, so a save from it carries ''
 * for every key the user did not retype; persisting that '' would leave fetches
 * failing on an empty key until the next PKJS boot folds the parked copy back.
 * Fill-only (a typed key always wins), and the slot is CONSUMED: from this save
 * on the blob holds the keys and the reopened page shows them, so an '' arriving
 * later is the user deliberately clearing a field — a still-live slot would
 * refill it and permanently reinstate a removed credential. (A reset-save is
 * safe with that: resetAll parks from the just-filled blob afterwards.)
 *
 * @param {Object} blob Parsed settings response (mutated and returned).
 * @returns {Object} The same blob, empty credential fields filled.
 */
function fillFromPreserved(blob) {
    if (blob) { restorePreserved(blob); }
    return blob;
}

/**
 * Fold any credentials parked by resetAll() into a settings object, and drop the
 * parking slot once they are safely in — THE consumer of the slot: the boot-time
 * seedDefaults restore, the live-session fillFromPreserved, and resetAll's
 * backstop all merge through here. Missing/malformed parking restores nothing
 * (and the malformed slot is dropped).
 *
 * @param {Object} target Settings object to merge into (mutated).
 * @returns {boolean} True when something was restored.
 */
function restorePreserved(target) {
    var parked = readParked();
    var restored = false;
    var i;
    var k;
    if (parked) {
        for (i = 0; i < PRESERVED_SETTING_KEYS.length; i++) {
            k = PRESERVED_SETTING_KEYS[i];
            // FILL ONLY — never overwrite. Between the reset and this merge the user
            // may well have typed a NEW key (that is the likeliest thing to do right
            // after a reset), and clobbering it with the parked one is invisible: the
            // settings page's Test button passes against what they typed, then the
            // next boot restores the old key underneath them and every fetch is
            // rejected.
            if (parked[k] && !target[k]) {
                target[k] = parked[k];
                restored = true;
            }
        }
    }
    localStorage.removeItem(KEYS.PRESERVED_KEYS_KEY);
    return restored;
}

/**
 * Whether a saved-settings response should trigger a full reset. The one-shot
 * "Reset watchface" toggle wipes on Save; the blunt on-Save/undo-warning in its
 * hint is the safeguard, and onbuild.js re-zeroes it each open so it never
 * persists checked.
 *
 * @param {?Object} s Parsed settings (app.settings) from the config response.
 * @returns {boolean} True only when the reset flag is exactly true.
 */
function shouldReset(s) {
    return Boolean(s) && s.reset === true;
}

/**
 * Read and parse the stored Clay settings blob.
 *
 * @returns {Object|null} Parsed settings object, or null when nothing stored
 *   or the blob is malformed.
 */
function read() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (ex) {
        return null;
    }
}

/**
 * Persist a Clay settings object.
 *
 * @param {Object} obj Settings to store.
 * @returns {void}
 */
function save(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/**
 * Whether a settings blob exists in storage. Used as the "had existing install"
 * signal before defaults are seeded; a raw existence check that never parses
 * (so a malformed blob does not throw here).
 *
 * @returns {boolean} True when a clay-settings blob is present.
 */
function hasStored() {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Build the full Clay settings defaults needed to send a complete config payload.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @returns {Object} Default Clay-compatible settings.
 */
function getDefaults(colors) {
    var d = settings.getDefaults();
    d.colorTime = colors.white;
    d.colorSunday = colors.folly;
    d.colorSaturday = colors.folly;
    // Holiday highlight is intentionally decoupled from the weekend accent:
    // weekends stay Folly (red), holidays default to Blue Moon.
    d.colorUSFederal = colors.holiday;
    return d;
}

/**
 * Seed defaults on first run and backfill any missing keys on later runs.
 * Clay only considers `defaultValue` on first startup, but we need defaults
 * set even if the user has not made a custom config.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @returns {void}
 */
function seedDefaults(colors) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var defaults = getDefaults(colors);
    var persistClay;
    var prop;
    if (persistClayString === null) {
        console.log('No clay settings found, setting defaults');
        // Credentials a reset deliberately kept ride back in here, on the first
        // boot after the wipe -- this is the branch that boot takes.
        restorePreserved(defaults);
        save(defaults);
        return;
    }

    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, resetting defaults');
        restorePreserved(defaults);
        save(defaults);
        return;
    }

    for (prop in defaults) {
        if (
            Object.prototype.hasOwnProperty.call(defaults, prop) &&
            !Object.prototype.hasOwnProperty.call(persistClay, prop)
        ) {
            persistClay[prop] = defaults[prop];
        }
    }
    // A settings save between the reset and this boot leaves a non-empty blob, so
    // the branch above never ran; the credentials are still parked and belong here.
    restorePreserved(persistClay);
    save(persistClay);
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
    var wantsClayNightColors = migrateGraphNightColorsResend(
        isDone(KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY));
    return {
        clayRequired: Boolean(wantsClayColors || wantsClayToggle
                              || wantsClayLightRetune || wantsClayNightColors),
        commitDeferredMarkers: function () {
            if (wantsClayColors) { mark(KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY)(); }
            if (wantsClayToggle) { mark(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY)(); }
            if (wantsClayLightRetune) { mark(KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY)(); }
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
    { metric: 'uv',          role: 'Line',  was: 0xFF00FF },  // Magenta       -> ImperialPurple
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
    // the shape test/clay-settings.test.js pins.
    //
    // The cost of being unconditional is one redundant Clay message on an install that
    // never held the old defaults. It does not loop: nothing changed means the payload
    // matches the last-sent cache, sendClay calls onSuccess immediately, and the marker
    // commits. migrateGraphNightColorsResend is unconditional for the same reason.
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

/**
 * Apply values from a dev-config.js file to the stored Clay settings, skipping
 * the local-only dev keys that drive boot behavior rather than watch config.
 *
 * @param {Object} devConfig Parsed dev-config exports.
 * @returns {void}
 */
function applyDevConfig(devConfig) {
    var persistClay;
    var prop;

    // Every dev-config key that is CONSUMED at boot rather than being a Clay
    // setting. A key missing here is copied into the persisted settings blob
    // and stays there forever (four had already leaked: the update-check trio
    // and the phone-battery fake). When adding a boot-only dev key, add it to
    // its consumer AND here — the drift test in clay-settings.test.js pins the
    // known consumers' keys against this list.
    var localOnlyDevConfigKeys = {
        clearPkjsStorageOnBoot: true,
        forceShowReleaseNotificationOnBoot: true,
        maxNotifiedVersion: true,
        resetV134WeekendHolidayColorMigration: true,
        resetV140HolidayRegionKeyMigration: true,
        // index.js's update-check runner (boot/tick only):
        resetUpdateNotifiedVersion: true,
        forceUpdateCheckOnBoot: true,
        overrideLatestStoreVersions: true,
        // phone-battery.js's dev fake reading:
        devPhoneBattery: true
    };

    persistClay = read();
    for (prop in devConfig) {
        if (Object.prototype.hasOwnProperty.call(devConfig, prop)) {
            if (Object.prototype.hasOwnProperty.call(localOnlyDevConfigKeys, prop)) {
                console.log('Found local-only dev setting: ' + prop);
                continue;
            }
            persistClay[prop] = devConfig[prop];
            console.log('Found dev setting: ' + prop + '=' + devConfig[prop]);
        }
    }
    save(persistClay);
}

/**
 * Apply Clay-compatible settings from the active fixture.
 *
 * @param {Object|null} fixture Active fixture, or null when fixtures are disabled.
 * @param {Object} colorMap Map of SDK color names to RGB integers (pebble-colors).
 * @returns {void}
 */
function applyFixtureSettings(fixture, colorMap) {
    var persistClay;
    var settings;
    var prop;

    if (!fixture || !fixture.claySettings || typeof fixture.claySettings !== 'object' || Array.isArray(fixture.claySettings)) {
        return;
    }

    settings = fixture.claySettings;
    persistClay = read();
    for (prop in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, prop)) {
            persistClay[prop] = normalizeFixtureSetting(prop, settings[prop], colorMap);
        }
    }
    save(persistClay);
}

/**
 * Normalize a fixture setting into the same shape Clay stores locally.
 *
 * @param {string} key Clay setting key.
 * @param {*} value Fixture setting value.
 * @param {Object} colorMap Map of SDK color names to RGB integers.
 * @returns {*} Normalized setting value.
 */
function normalizeFixtureSetting(key, value, colorMap) {
    if (isColorSettingKey(key)) {
        return normalizeFixtureColor(value, colorMap);
    }

    return value;
}

/**
 * Determine whether a Clay setting is a color value.
 *
 * @param {string} key Clay setting key.
 * @returns {boolean} True for color settings.
 */
function isColorSettingKey(key) {
    return settings.isColorKey(key);
}

/**
 * Normalize fixture colors from SDK color constant names.
 *
 * @param {*} value Fixture color value.
 * @param {Object} colorMap Map of SDK color names to RGB integers.
 * @returns {number} Clay-compatible RGB integer.
 */
function normalizeFixtureColor(value, colorMap) {
    if (typeof value === 'string') {
        if (Object.prototype.hasOwnProperty.call(colorMap, value)) {
            return colorMap[value];
        }
    }

    return value;
}

module.exports = {
    read: read,
    save: save,
    resetAll: resetAll,
    runMigrations: runMigrations,
    fillFromPreserved: fillFromPreserved,
    shouldReset: shouldReset,
    hasStored: hasStored,
    getDefaults: getDefaults,
    seedDefaults: seedDefaults,
    applyDevConfig: applyDevConfig,
    applyFixtureSettings: applyFixtureSettings,
    migrateWeekendHolidayColors: migrateWeekendHolidayColors,
    migrateHolidayWhiteToToggle: migrateHolidayWhiteToToggle,
    migrateHolidayRegionKeys: migrateHolidayRegionKeys,
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery,
    migrateRadarProviderToMode: migrateRadarProviderToMode,
    migrateGraphNightColorsResend: migrateGraphNightColorsResend,
    migrateCarriedGraphNightTints: migrateCarriedGraphNightTints
};

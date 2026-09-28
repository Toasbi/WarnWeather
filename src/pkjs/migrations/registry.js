// src/pkjs/migrations/registry.js
//
// THE migration ledger: every one-time fixup that moves an installed Clay blob onto a
// newer shape, in RUN order. clay-migrations.js runs it; the bodies live next door,
// one file per release or feature. A new migration is one entry here (append it) plus
// one body.
//
// An entry is { key, markOn, markOnReset, run }:
//   key          Its marker (storage-keys.js). APPEND-ONLY: a shipped marker string is
//                the on-flash record that the entry ran, so it is never reused, renamed
//                or renumbered.
//   markOn       'now': the marker is set right after this boot's save, whether or not
//                the entry asked for a send.
//                'ack': when the entry asks for a send, the marker waits for the Clay
//                ACK (the runner's commitDeferredMarkers, which index.js hands the
//                scheduler as onClayAck), so a session in which no Clay send lands
//                re-runs the entry on the next boot. With no send it is set now.
//   markOnReset  "Reset watchface" marks it done (clay-settings.js resetAll, handed
//                clay-migrations.js RESET_SAFE_MARKERS): the entry would misread a blob
//                the page saves between the reset and the next boot.
//   run          (blob, ctx) -> {changed, send}. Mutates the parsed blob in place and
//                never touches storage; ctx is described on clay-migrations.js
//                runMigrations.
//
// The ORDER is load-bearing where an entry says so. Entries later in the list see the
// blob as the earlier ones left it, exactly as when each one saved before the next read.

var KEYS = require('../storage-keys');
var onboarding = require('./onboarding.js');
var holidays = require('./holidays.js');
var statusSlots = require('./status-slots.js');
var radar = require('./radar.js');
var graphColors = require('./graph-colors.js');
var lightTheme = require('./light-theme.js');
var lineStyles = require('./line-styles.js');
var v124 = require('./v1_24.js');
var seedPairs = require('./seed-pairs.js');

module.exports = [
    // 1.20.0. Marks on every boot that finds it unset, fresh installs included (see the
    // body). resetAll clears it with the blob, so the next boot is fresh and the wizard
    // reopens.
    { key: KEYS.ONBOARDING_EXISTING_INSTALL_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: onboarding.migrateExistingInstallOnboarded },
    // Ahead of the white-to-toggle move: an all-white set is the old DEFAULT, not
    // "holidays off". This move takes the holiday colour off white first, so the next
    // one leaves holidays on.
    { key: KEYS.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: holidays.migrateWeekendHolidayColors },
    { key: KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: holidays.migrateHolidayWhiteToToggle },
    { key: KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: holidays.migrateHolidayRegionKeys },
    { key: KEYS.STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: statusSlots.migrateStatusLineHealthDefaults },
    { key: KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: statusSlots.migrateStatusTopRightBattery },
    { key: KEYS.RADAR_VIEW_MODE_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: radar.migrateRadarProviderToMode },
    // Marks now though it can ask for a send (see clay-migrations.js on the scheduler).
    // Reset-safe: it turns a stored '' into the default because '' used to mean
    // "default"; after a reset the next blob is seeded with the default, so a '' saved
    // before the next boot is a deliberate clear it must not undo.
    { key: KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY, markOn: 'now', markOnReset: true,
      run: radar.migrateEmptyNoRainText },
    { key: KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY, markOn: 'now', markOnReset: false,
      run: graphColors.migrateCarriedGraphNightTints },
    // MUST run after the carried-tint release above, and the reason is not the obvious
    // one. A carried tint holds the FILL's colour, so the release detects it by
    // `night === fill`. The re-tune rewrites the Fill cell (it holds a superseded value)
    // but NOT the Night cell (which holds the fill's colour, not the Night's superseded
    // one) — breaking that equality. Run second, the release can no longer see the carry
    // and the stale colour survives as a fake pick. Verified for wind with a fill picked
    // to Inchworm, the old light default: carried-first lands Night on the built-in
    // (FFAA55), re-tune-first strands it on AAFF55 reading as a deliberate choice.
    { key: KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: lightTheme.migrateLightGraphColorRetune },
    { key: KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: lightTheme.migrateLightThemeSolidBars },
    { key: KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: graphColors.migrateGraphNightColorsResend },
    // Asks for no send: it only rewrites the style of a line that is off, which the
    // watch never draws (and whose wire byte already resolves to the new default —
    // line-style.js lineStyleValue). A line that IS drawn and now resolves differently is
    // the stripe-rule resend's job, below. Reset-safe: the next blob is seeded with the
    // new default 'x', so a 'stripeTop' saved before the next boot was picked.
    { key: KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY, markOn: 'now', markOnReset: true,
      run: lineStyles.migrateFifthLineStyleDefault },
    { key: KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY, markOn: 'ack', markOnReset: false,
      run: lineStyles.migrateStripeMetricRuleResend },
    // 1.24.0. After the radar provider -> mode move: its rain-window step reads
    // radarMode. Marks now though it asks for a send on every existing install (see
    // clay-migrations.js on the scheduler). Reset-safe, three times over. The next blob
    // is seeded with every highlight toggle off and every pair blank, so a toggle saved
    // before the next boot is the page's own truth: unmarked, the wizard seeds AQI ON
    // with its pair, the user switches it OFF (pair kept), and that boot turns it back
    // ON. The page no longer offers the rain window's Off, so there is nothing to move.
    // And a blank warn colour now means auto, so a page save must not be read as the
    // old no-outline state.
    { key: KEYS.ALERT_LEVELS_MIGRATION_KEY, markOn: 'now', markOnReset: true,
      run: v124.migrateAlertLevels },
    // 1.24.0, and MUST run after the alert-levels entry above: that one derives each
    // highlight switch from its pair, and a pair blanked first would read as highlight
    // off. Asks for no send: a pair equal to its seed and a blank one resolve to the
    // same numbers, so nothing the watch receives changes. Reset-safe: the next blob
    // is seeded with blank pairs and the page no longer pins a seed, so a seed-equal
    // pair saved before the next boot was dragged there.
    { key: KEYS.SEED_PAIR_BLANK_MIGRATION_KEY, markOn: 'now', markOnReset: true,
      run: seedPairs.migrateSeedPairsToBlank }
];

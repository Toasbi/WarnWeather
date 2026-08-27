// src/pkjs/line-style.js — ES5. Graph line styling: the two metric line colours, the
// area-fill colour and the fill flag, plus the five night colours and the night flag.
// Every one of them is derived from the SETTINGS blob (plus the target platform's
// colour/polarity capabilities) and not from the weather data, so per AGENTS.md's
// message-boundary rule they belong on the Clay settings message rather than on every
// weather send. This module is the single source of truth shared by the Clay packer and
// the forecast series builder, so the wire and the render can't drift — and, through
// renderContext(), by the telemetry snapshot too, which is the half that drifted once.
//
// It is also what the SETTINGS PAGE's forecast preview draws from, via
// resolveGraphColors() — the same body resolveLineStyle() runs, with the render
// capabilities passed in instead of derived from a watchInfo the page does not have.
// That is why this file is dual-context: a CommonJS module on the phone and in the
// tests, and a plain concatenated <script> in the settings-page webview
// (scripts/build-config-page.js's APP_FILES), which has no require().
(function () {
    // pebble-colors.js and resolve-ink.js are needed the moment this module loads (the
    // tables below are built from them), and both are concatenated BEFORE this file in the
    // page bundle, so they resolve either way.
    var COLORS = (typeof require !== 'undefined')
        ? require('./pebble-colors') : window.PebbleColors;
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('./resolve-ink.js') : window.ResolveInk;
    // Phone-only deps, guarded the way status-thresholds.js guards its own: neither module
    // is in the page bundle, and neither of their consumers here is reachable from the page.
    // configUi backs capsForWatch() (so renderContext/resolveLineStyle are phone-only); the
    // page enters through renderContextFor/resolveGraphColors with explicit capabilities
    // instead. rainTier backs buildLineStyleBytes(), which only the wire packers call.
    var configUi = (typeof require !== 'undefined')
        ? require('./config-ui') : null;   // isColorPlatform — same helper rain-tier/palette-wire use
    var rainTier = (typeof require !== 'undefined')
        ? require('./weather/rain-tier') : null;
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
        // ever built and the night-area triple below is never painted for it. Still
        // LightGray so that if the fill is ever re-enabled the day fill still reads as a
        // dimmer twin of the LightGray line. The night side no longer depends on this
        // value at all — NIGHT_AREA_COLORS.feels is keyed by the METRIC.
        feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray }
    };

    /**
     * Snap one channel onto the Pebble-64 grid. `v >> 6` IS the Pebble level (0x00→0,
     * 0x55→1, 0xAA→2, 0xFF→3 — the same shift rgbToGColor8 uses) and `level * 0x55` is its
     * exact inverse, so a value already on the grid is returned unchanged.
     * @param {number} v 0..255 channel value.
     * @returns {number} The channel as 0x00, 0x55, 0xAA or 0xFF.
     */
    function snapChannel(v) {
        return (v >> 6) * 0x55;
    }

    /**
     * Snap a colour onto the Pebble-64 grid. Applied once, at the parse boundary
     * (colorPick), so everything downstream can assume a resolved colour is a real Pebble
     * value — which is what lighten()'s level arithmetic needs to be exact. It does NOT
     * change the pixel: rgbToGColor8 extracts the same `>> 6` level either way, so this is
     * about the numbers the rest of this module reasons over, not about the wire.
     * @param {number} rgb 0xRRGGBB colour.
     * @returns {number} 0xRRGGBB colour with every channel on the Pebble-64 grid.
     */
    function snapColor(rgb) {
        return (snapChannel((rgb >> 16) & 0xFF) << 16)
             | (snapChannel((rgb >> 8) & 0xFF) << 8)
             | snapChannel(rgb & 0xFF);
    }

    /**
     * One Pebble level brighter per channel, saturating at 0xFF (level 3 has nowhere left
     * to go). Only ever fed grid values — a NIGHT_AREA_COLORS constant or a snapped pick —
     * so the level arithmetic is exact.
     * @param {number} rgb 0xRRGGBB colour.
     * @returns {number} The same colour one Pebble level brighter per channel.
     */
    function lighten(rgb) {
        return (lightenChannel((rgb >> 16) & 0xFF) << 16)
             | (lightenChannel((rgb >> 8) & 0xFF) << 8)
             | lightenChannel(rgb & 0xFF);
    }

    /**
     * @param {number} v 0..255 channel value, expected to be on the Pebble-64 grid.
     * @returns {number} The next Pebble level up, or 0xFF when already at the top.
     */
    function lightenChannel(v) {
        return Math.min((v >> 6) + 1, 3) * 0x55;
    }

    // Night base/hatch/boundary for the FILLED area — the six hand-tuned triples
    // forecast_layer.c owned until this feature. Keyed by METRIC, not by the day fill
    // colour: the C keyed on the fill with gcolor_equal, which is exactly what made an
    // unlisted metric render precip-blue (pressure shipped that way, MEASURED on emery),
    // and a user-selectable fill would send every custom pick down that same fall-through.
    var NIGHT_AREA_COLORS = {
        precip_prob: { base: COLORS.GColorDukeBlue,       hatch: COLORS.GColorBlue,      boundary: COLORS.GColorVividCerulean },
        wind:        { base: COLORS.GColorArmyGreen,      hatch: COLORS.GColorLimerick,  boundary: COLORS.GColorLimerick },
        uv:          { base: COLORS.GColorImperialPurple, hatch: COLORS.GColorPurple,    boundary: COLORS.GColorVividViolet },
        gust:        { base: COLORS.GColorDarkGray,       hatch: COLORS.GColorLightGray, boundary: COLORS.GColorLightGray },
        pressure:    { base: COLORS.GColorWindsorTan,     hatch: COLORS.GColorOrange,    boundary: COLORS.GColorOrange },
        feels:       { base: COLORS.GColorLightGray,      hatch: COLORS.GColorWhite,     boundary: COLORS.GColorWhite }
    };
    // The full-height night hatch / dusk-dawn line the user starts from —
    // forecast_layer.c's NIGHT_HATCH_COLOR and NIGHT_BOUNDARY_COLOR colour arms. The
    // boundary's polarity swap lives in its B&W arm only, so both polarities send DarkGray.
    var NIGHT_HATCH_DEFAULT = COLORS.GColorDarkGray;
    var NIGHT_BOUNDARY_DEFAULT = COLORS.GColorDarkGray;

    // --- The per-metric graph-colour key vocabulary -----------------------------
    //
    // Every graph colour is stored as a CONCRETE per-polarity value under a key named
    // 'gc' + metric slug + role + polarity ('gcPrecipLineDark'), seeded from
    // graphColorDefault below. There is no "auto" sentinel: the settings page shows the
    // stored colour as the highlighted swatch, and "is this still the built-in?" is
    // answered by asking graphColorDefault for the built-in and comparing
    // (graphColorIsDefault), not by a magic value.

    // The graph metrics that can be the main or the second line, in the order the settings
    // page lists them (blocks.js' FORECAST_METRICS).
    var GRAPH_METRICS = ['precip_prob', 'wind', 'uv', 'gust', 'pressure', 'feels'];
    // Metric id -> the CamelCase fragment its keys carry. The ids are snake_case wire
    // values and would make unreadable key names ('gcPrecip_probLineDark').
    var METRIC_SLUG = {
        precip_prob: 'Precip', wind: 'Wind', uv: 'Uv',
        gust: 'Gust', pressure: 'Pressure', feels: 'Feels'
    };
    // The three colours a metric owns. 'Night' is the night FILL TINT — the base of the
    // night-area triple, which nightAreaColorsFor derives the hatch and boundary from.
    var METRIC_ROLES = ['Line', 'Fill', 'Night'];
    // The two colours the full-height night band owns, under the pseudo-scope 'night'.
    var NIGHT_ROLES = ['Hatch', 'Boundary'];

    // Metric-id membership set for graphColorDefault. Built from GRAPH_METRICS so a new
    // metric is a one-line change there and nowhere else.
    var IS_GRAPH_METRIC = {};
    (function () {
        var i;
        for (i = 0; i < GRAPH_METRICS.length; i++) { IS_GRAPH_METRIC[GRAPH_METRICS[i]] = true; }
    }());

    /**
     * Is this scope one of the graph metrics? OWN keys only — a bare object literal answers
     * truthy for every Object.prototype name ('toString', 'constructor'), which would route
     * those down the Fill/Night arms. Note this does NOT make graphColorDefault total for
     * such a name: the fall-through lands in lineColorFor, whose LINE_COLORS[metric] lookup
     * has the same pre-existing hole (as do fillColorFor and nightAreaColorsFor), so it
     * still answers undefined there. Closing that is separate hardening; no reachable input
     * gets near it, since every scope comes from GRAPH_METRICS, 'night', or a metric picker.
     * @param {string} scope Candidate metric id.
     * @returns {boolean} True only for a member of GRAPH_METRICS.
     */
    function isGraphMetric(scope) {
        return Object.prototype.hasOwnProperty.call(IS_GRAPH_METRIC, scope);
    }

    /**
     * The storage key one graph colour lives under.
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night' for the full-height band.
     * @param {string} role 'Line'|'Fill'|'Night' for a metric; 'Hatch'|'Boundary' for 'night'.
     * @param {string} suffix Polarity, 'Dark' or 'Light' (renderContext's `suffix`).
     * @returns {string} e.g. 'gcPrecipLineDark', 'gcNightHatchLight'.
     */
    function graphColorKey(scope, role, suffix) {
        return 'gc' + (scope === 'night' ? 'Night' : (METRIC_SLUG[scope] || scope)) + role + suffix;
    }

    /**
     * The roles one scope actually gets a KEY for — the settings page's row list.
     * feels is Line-only: it never fills (resolveGraphColors pins fillOn false for it), so
     * a Fill or a night-tint row would offer a colour nothing can paint.
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night'.
     * @returns {string[]} The roles, in row order.
     */
    function graphColorRoles(scope) {
        if (scope === 'night') { return NIGHT_ROLES; }
        return scope === 'feels' ? ['Line'] : METRIC_ROLES;
    }

    /**
     * Every graph-colour key, in row order. 36 keys: five metrics x three roles x two
     * polarities, feels' Line pair, and the night band's two pairs.
     *
     * Nothing in the app enumerates these — the schema builds its rows from graphColorRoles
     * per scope, and the reset action takes its key list from the sheet. This exists as the
     * completeness oracle the tests check that coverage against, so a new metric or role
     * cannot be added without something failing.
     * @returns {string[]} The keys.
     */
    function graphColorKeys() {
        var keys = [];
        var scopes = GRAPH_METRICS.concat(['night']);
        var i, j, roles;
        for (i = 0; i < scopes.length; i++) {
            roles = graphColorRoles(scopes[i]);
            for (j = 0; j < roles.length; j++) {
                keys.push(graphColorKey(scopes[i], roles[j], 'Dark'));
                keys.push(graphColorKey(scopes[i], roles[j], 'Light'));
            }
        }
        return keys;
    }

    /**
     * The built-in colour for one (scope, role, polarity) on a COLOUR render — the schema
     * default, and the value graphColorIsDefault compares a stored colour against.
     *
     * DERIVED, never transcribed: every answer comes back out of the same three resolvers
     * the renderer uses (lineColorFor / fillColorFor / nightAreaColorsFor), so a fresh
     * install is pixel-identical to 1.14.1 by construction and a tweak to LINE_COLORS,
     * FILL_COLORS or NIGHT_AREA_COLORS moves the default with it. That is also why gust's
     * dark line needs no special case here: lineColorFor already dodges the rain bars
     * (it reads settings.rainBarColor), and graphColorIsDefault accepts EITHER of the two
     * greys it can answer as "still the built-in".
     *
     * `suffix` alone names the theme here because this is the colour arm: renderContextFor
     * reports isColor true only for the 'dark' and 'light' themes (a bw/bw-light theme folds
     * to !isColor), so Dark <-> 'dark' and Light <-> 'light' exactly.
     *
     * TOTAL: an unknown scope (today thirdLine's 'off', and a settings blob with no
     * secondaryLine at all) falls through to lineColorFor, which is itself total and answers
     * the theme foreground, so no caller needs a `||` fallback — which matters because
     * GColorBlack is 0x000000 and therefore falsy. Total over ROLES too: feels gets no
     * Fill/Night key but resolveGraphColors still resolves both for it.
     *
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night'.
     * @param {string} role See graphColorKey.
     * @param {string} suffix 'Dark' or 'Light'.
     * @param {Object} [settings] Clay settings blob; only rainBarColor is read (gust).
     * @returns {number} 0xRRGGBB colour on the Pebble-64 grid.
     */
    function graphColorDefault(scope, role, suffix, settings) {
        var theme = suffix === 'Light' ? 'light' : 'dark';
        if (scope === 'night' && (role === 'Hatch' || role === 'Boundary')) {
            return role === 'Hatch' ? NIGHT_HATCH_DEFAULT : NIGHT_BOUNDARY_DEFAULT;
        }
        if (isGraphMetric(scope) && role === 'Night') { return nightAreaColorsFor(scope, null).base; }
        if (isGraphMetric(scope) && role === 'Fill') { return fillColorFor(scope, true, theme); }
        return lineColorFor(scope, settings || {}, true, theme);
    }

    /**
     * Is the stored colour for one key still the built-in?
     *
     * True when nothing parseable is stored (a blob the page has never written) and when the
     * stored value equals graphColorDefault. This predicate is what replaced the old ''
     * Auto sentinel: it keeps gust's rainBarColor coupling alive, and it drives the wire's
     * night-fill flag (byte [9] bit 0).
     *
     * gust/Line/Dark answers true for EITHER of its two built-ins (White with multicolour
     * bars, LightGray with solid white bars), so a solid-bar install whose blob was seeded
     * with White keeps resolving through rainBarColor instead of painting white on white.
     *
     * @param {Object} settings Clay settings blob.
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night'.
     * @param {string} role See graphColorKey.
     * @param {string} suffix 'Dark' or 'Light'.
     * @returns {boolean} True when the user has not moved this colour off its built-in.
     */
    function graphColorIsDefault(settings, scope, role, suffix) {
        var stored = colorPick((settings || {})[graphColorKey(scope, role, suffix)]);
        if (stored === null) { return true; }
        if (scope === 'gust' && role === 'Line' && suffix === 'Dark') {
            return stored === COLORS.GColorWhite || stored === COLORS.GColorLightGray;
        }
        return stored === graphColorDefault(scope, role, suffix, settings);
    }

    /**
     * The colour one graph-colour key resolves to on a COLOUR render: the stored colour, or
     * the built-in when the key is unset or still sitting on it. The built-in arm is not
     * redundant with "just return the stored value" — gust/Line/Dark resolves through
     * rainBarColor rather than through whatever White/LightGray the blob happens to hold.
     * @param {Object} settings Clay settings blob.
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night'.
     * @param {string} role See graphColorKey.
     * @param {string} suffix 'Dark' or 'Light'.
     * @returns {number} 0xRRGGBB colour on the Pebble-64 grid.
     */
    function graphColorResolve(settings, scope, role, suffix) {
        var stored = colorPick((settings || {})[graphColorKey(scope, role, suffix)]);
        return (stored === null || graphColorIsDefault(settings, scope, role, suffix))
            ? graphColorDefault(scope, role, suffix, settings)
            : stored;
    }

    /**
     * The night tint for a metric's filled area: the user's own pick, else the fill colour
     * they chose, else null for the metric's hand-tuned built-in triple.
     *
     * The CASCADE lives here, at resolve time, and nowhere else. The watch paints the night
     * band opaquely over the filled area (chart.c's has_underlay loop strokes the underlay
     * from the curve down to the axis), so the tint REPLACES the day fill for the night
     * hours instead of shading it: a tint left on the metric's built-in while the fill moved
     * would paint over a colour the user chose with one they never did. Deriving the carry
     * from the two stored keys — rather than having the settings page write the fill into
     * the tint key — is what keeps "the user picked this" answerable at all. A page-side
     * write makes a claimed tint and a carried one the same bytes, and then nothing
     * downstream can tell a deliberate pick from a hand-me-down (the bug this replaced:
     * a tint deliberately picked equal to its fill read as untouched, so the light-polarity
     * re-shade was skipped and telemetry reported 'default'). The blobs the 1.15.0 page
     * already wrote are healed once, on upgrade, by clay-settings.js'
     * migrateCarriedGraphNightTints — without it a carried tint would read as claimed here
     * and freeze, so the next fill pick would never reach the night hours.
     *
     * Returning null rather than the built-in base is deliberate: nightAreaColorsFor answers
     * null with the hand-tuned triple verbatim, while a concrete base runs the derive recipe.
     *
     * @param {Object} settings Clay settings blob (gc&lt;Metric&gt;Night and gc&lt;Metric&gt;Fill).
     * @param {string} metric A metric id from GRAPH_METRICS.
     * @param {string} suffix 'Dark' or 'Light'.
     * @returns {number|null} 0xRRGGBB tint, or null for the metric's built-in triple.
     */
    function graphNightTint(settings, metric, suffix) {
        if (!graphColorIsDefault(settings, metric, 'Night', suffix)) {
            return graphColorResolve(settings, metric, 'Night', suffix);   // claimed
        }
        if (!graphColorIsDefault(settings, metric, 'Fill', suffix)) {
            return graphColorResolve(settings, metric, 'Fill', suffix);    // carried
        }
        return null;                                                       // built-in
    }

    /**
     * Did the user CHOOSE this colour, as opposed to being handed it?
     *
     * The single authority behind the two consumers that have to agree about intent: the
     * wire's night-fill flag (byte [9] bit 0, the light-polarity opt-in) and telemetry's
     * 'default' vs '#RRGGBB' report, which exists to mine the colours people actually chose.
     * There is exactly ONE way a stored colour is not a choice: being the built-in — which
     * for gust's dark line means either of the two greys rainBarColor can answer (see
     * graphColorIsDefault). A metric's night tint is no longer a second way: the fill cascade
     * is derived at resolve time (graphNightTint) instead of being written into the tint key,
     * so a value sitting in that key got there because someone picked it — once
     * clay-settings.js' migrateCarriedGraphNightTints has cleared the ones the 1.15.0 page
     * wrote there on the user's behalf.
     *
     * @param {Object} settings Clay settings blob.
     * @param {string} scope A metric id from GRAPH_METRICS, or 'night'.
     * @param {string} role See graphColorKey.
     * @param {string} suffix 'Dark' or 'Light'.
     * @returns {boolean} True when the stored colour is the user's own pick.
     */
    function graphColorIsPicked(settings, scope, role, suffix) {
        return !graphColorIsDefault(settings, scope, role, suffix);
    }

    // Line-style flag byte (wire byte [3]), bit 0: the secondary line's area fill is on.
    var FLAG_SECONDARY_FILL = 0x01;
    // NIGHT flag byte (wire byte [9]), bit 0: the night-area tint is an explicit user pick,
    // not the built-in triple. The watch skips the night re-shade on colour + light polarity
    // (user-tuned); this bit is the opt-in that makes a Light night-fill pick paint there.
    // It lives in its OWN byte rather than beside FLAG_SECONDARY_FILL so that wire bytes
    // [4..9] are byte-for-byte the watch's NIGHT_COLORS persist blob (persist.h's
    // NIGHT_FLAG_FILL_EXPLICIT, same bit, same offset) — app_message.c stores the tail
    // straight through with no repacking and no second name for this bit.
    var FLAG_NIGHT_FILL_EXPLICIT = 0x01;

    /**
     * What this watch is ACTUALLY rendering — the one authority every graph-colour consumer
     * asks, instead of re-deriving it. The wire packer here and the telemetry snapshot
     * derived it separately once and diverged: telemetry copied the theme fold but dropped
     * the colour-platform half, so a diorite install reported picks the wire had already
     * resolved away to white. (The settings page asks renderContextFor() instead — same
     * body, capabilities passed in rather than looked up from a watchInfo.)
     *
     * `theme` is the FOLDED theme. aplite has the light polarity compiled out (theme.h pins
     * theme_is_light() false), so a light / bw-light byte renders as the classic
     * white-on-black there; resolving off settings.theme instead would send black line
     * colours to a black background (the reported bug). Every other platform ships the
     * polarity, so effectiveTheme returns the theme unchanged for them.
     *
     * `isColor` is the EFFECTIVE colour flag: colour hardware renders as colour only when
     * the theme isn't Black & White — a bw/bw-light theme reuses the exact colour model B&W
     * watches get today (bw-light in its light-polarity form).
     *
     * `suffix` is the polarity half of every graph-colour key name, derived from the folded
     * theme so the pick that is read is the pick that is painted.
     *
     * @param {Object} settings Clay settings blob; only `theme` is read.
     * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null/undefined
     *   (treated as colour basalt).
     * @returns {{theme: string, isColor: boolean, suffix: string}} The render context.
     */
    function renderContext(settings, watchInfo) {
        return renderContextFor(settings, capsForWatch(watchInfo));
    }

    /**
     * The two render capabilities a target platform decides, looked up from a watchInfo.
     * Phone-only: it is the one place in this module that needs config-ui's platform table,
     * which the settings-page bundle does not carry.
     * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null/undefined
     *   (treated as colour basalt).
     * @returns {{color: boolean, themePolarity: boolean}} Capabilities for renderContextFor.
     */
    function capsForWatch(watchInfo) {
        var platform = watchInfo && watchInfo.platform ? watchInfo.platform : 'basalt';
        return {
            color: configUi.isColorPlatform(platform),
            themePolarity: configUi.isThemePolarityPlatform(platform)
        };
    }

    /**
     * renderContext() with the platform's capabilities supplied directly, for a caller that
     * has no watchInfo to look them up from — the settings page, which is previewing a
     * target described by its own `env` rather than asking a connected watch.
     *
     * `caps.color` is the DISPLAY's colour capability, not the effective flag: the
     * bw/bw-light fold is applied here, exactly as it is for a real watch.
     *
     * @param {Object} settings Clay settings blob; only `theme` is read.
     * @param {{color: boolean, themePolarity: boolean}} caps Whether the target renders in
     *   colour at all, and whether it ships the light polarity (false folds light→dark).
     * @returns {{theme: string, isColor: boolean, suffix: string}} The render context.
     */
    function renderContextFor(settings, caps) {
        var theme = effectiveTheme((settings || {}).theme || 'dark', Boolean(caps.themePolarity));
        return {
            theme: theme,
            isColor: Boolean(caps.color) && !isBwTheme(theme),
            suffix: isLightPolarity(theme) ? 'Light' : 'Dark'
        };
    }

    /**
     * Line/dot colour for a metric, resolved for the platform + theme. isColor and theme
     * should both come from renderContext() — the EFFECTIVE colour flag and the FOLDED
     * theme. On B&W (or bw/bw-light theme) every line is the theme
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
                // TOTAL: an unknown metric (today only thirdLine's 'off') resolves
                // to the theme foreground instead of GColorBlack. Black is 0x00 and
                // therefore falsy, which used to make resolveLineStyle's `||`
                // fallbacks accident-dependent — this file already had to warn
                // itself about that trap once (the light-variant note below).
                result = COLORS.GColorWhite;
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
     * Read one graph-colour setting. The page writes a '#RRGGBB' STRING, but a numeric
     * defaultValue (or a hand-written fixture) can seed an int, so tolerate both the way
     * status-thresholds.js' colorInt does. There is no sentinel value any more: null means
     * "nothing usable is stored here", and every caller answers that with the built-in.
     *
     * The value is snapped onto the Pebble-64 grid HERE, once, so that is an invariant of
     * every colour this module hands out. The snap is DEFENSIVE now — every swatch the page
     * offers is already a Pebble-64 value (engine.js' PALETTE) — but a hand-written fixture
     * or an older blob need not be, and lighten()'s level arithmetic is only exact on grid
     * values. It is invisible on the wire either way: rgbToGColor8 reduces both forms to the
     * same `>> 6` level, so it changes no pixel.
     *
     * @param {*} v Stored setting value.
     * @returns {number|null} 0xRRGGBB on the Pebble-64 grid, or null when nothing parses.
     */
    function colorPick(v) {
        if (typeof v === 'number' && isFinite(v)) { return snapColor(v); }
        if (typeof v === 'string' && /^#?[0-9a-fA-F]{6}$/.test(v)) {
            return snapColor(parseInt(v.charAt(0) === '#' ? v.slice(1) : v, 16));
        }
        return null;
    }

    /**
     * The night base/hatch/boundary for the filled area under the night hours.
     *
     * A tint EQUAL to the metric's built-in base returns the hand-tuned triple verbatim
     * rather than re-deriving it — which matters now that the stored tint defaults to that
     * base instead of to an absent sentinel: running it through the recipe below would give
     * five of the six metrics a new hatch and boundary on a blob nobody has touched.
     *
     * @param {string} metric The secondary line's metric (precip_prob|wind|gust|uv|pressure|feels).
     * @param {number|null} tint The 0xRRGGBB night-fill tint, or null for the built-in.
     * @returns {{base: number, hatch: number, boundary: number}} Three 0xRRGGBB colours.
     */
    function nightAreaColorsFor(metric, tint) {
        // TOTAL: an unknown metric (a blob naming a metric this build dropped) takes the
        // precip triple, which is the arm forecast_layer.c fell through to.
        var builtin = NIGHT_AREA_COLORS[metric] || NIGHT_AREA_COLORS.precip_prob;
        if (tint === null || tint === undefined || tint === builtin.base) { return builtin; }
        // NOT the recipe the six triples above were built with — feed each of their bases
        // back through this and only `feels` comes out matching; the other five were hand-
        // tuned per hue (precip and uv keep a saturated channel at 0x00 instead of lifting
        // it, wind/gust/pressure collapse boundary onto hatch a level earlier). Those six
        // stay verbatim, and this exists for the case they cannot cover: an ARBITRARY pick,
        // which needs a plausible member of the same family rather than a matching one. One
        // Pebble level per layer is the cheapest rule that keeps the stack legible — the
        // hatch reads above its own underlay, the boundary above the hatch — and near the top
        // of the ramp the two saturate together, the way four of the six triples read.
        var hatch = lighten(tint);
        return { base: tint, hatch: hatch, boundary: lighten(hatch) };
    }

    /**
     * Resolve the five night colours (plus the explicit-tint flag) for the wire.
     *
     * There is no B&W arm and no isColor gate: every one of these bytes reaches the render
     * through `theme_pick(colour_arm, bw_arm)` and the underlay through
     * `has_underlay = !theme_is_bw()` (forecast_layer.c), so a B&W watch or a bw/bw-light
     * theme discards all five and paints theme_fg() over a LightGray underlay from its own
     * constants. Sending a "B&W-honest" set was five bytes of ceremony no watch ever read.
     * The consequence, deliberately: on a bw theme these bytes now carry whatever the user
     * picked for that polarity instead of pinned white/LightGray constants. The wire is not
     * lying — it is simply describing colours this render mode ignores.
     *
     * The area triple comes from graphNightTint, so it reads the metric's FILL key too: an
     * unclaimed tint cascades from the fill the user picked. Only `fillExplicit` is on the
     * wire (byte [9]), where it is the light-polarity opt-in: forecast_layer.c:493-494 skips
     * the night re-shade on colour + light polarity unless this bit is set, so it must stay
     * FALSE for a blob whose tint is still the built-in (graphColorIsPicked) — otherwise a
     * light-theme colour install gains a re-shade it does not have today. A tint the CASCADE
     * supplies leaves the bit clear for exactly that reason: it is the fill's colour, not a
     * night choice, and the tint key was never written.
     *
     * That last clause is load-bearing, and is why clay-settings.js'
     * migrateCarriedGraphNightTints exists: the 1.15.0 page wrote the fill INTO the tint key
     * on every pick, so on an un-migrated 1.15.0 blob those bytes read here as a deliberate
     * pick and the bit would flip. The migration clears them back to the built-in before
     * anything packs them.
     *
     * @param {Object} settings Clay settings blob (the gcNightHatch / gcNightBoundary keys
     *   and the gc&lt;Metric&gt;Night / gc&lt;Metric&gt;Fill pair, both polarities).
     * @param {{suffix: string}} cx renderContext() result — the polarity suffix is read from
     *   the FOLDED theme, so an aplite light install looks up the Dark colours it can paint.
     * @param {string} metric The secondary line's metric, which keys the night area.
     * @returns {{hatch: number, boundary: number, areaBase: number, areaHatch: number,
     *   areaBoundary: number, fillExplicit: boolean}} Five 0xRRGGBB colours plus the flag
     *   saying the area tint has been moved off its built-in.
     */
    function resolveNightColors(settings, cx, metric) {
        var area = nightAreaColorsFor(metric, graphNightTint(settings, metric, cx.suffix));
        return {
            hatch: graphColorResolve(settings, 'night', 'Hatch', cx.suffix),
            boundary: graphColorResolve(settings, 'night', 'Boundary', cx.suffix),
            areaBase: area.base,
            areaHatch: area.hatch,
            areaBoundary: area.boundary,
            fillExplicit: graphColorIsPicked(settings, metric, 'Night', cx.suffix)
        };
    }

    /**
     * Resolve the graph's line styling from settings alone (no weather data).
     *
     * Every platform/theme decision comes from renderContext() — the folded theme, the
     * effective colour flag and the polarity suffix — so this function and the telemetry
     * snapshot cannot answer "what is this watch rendering?" differently.
     *
     * A thin adapter over resolveGraphColors(): the only thing a watchInfo adds is the two
     * capability bits capsForWatch() looks up from it.
     *
     * Contract on the colours handed back: each is a 0xRRGGBB value on the Pebble-64 grid.
     * The built-in tables are Pebble constants and colorPick snaps every stored value, so
     * nothing downstream has to quantize again.
     *
     * @param {Object} settings Clay settings blob (theme, secondaryLine, thirdLine,
     *   secondaryLineFill, rainBarColor, and the 36 gc* graph-colour keys).
     * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null/undefined
     *   (treated as colour basalt).
     * @returns {{secondary: number, fill: number, third: number, fillOn: boolean,
     *   night: Object}} Three 0xRRGGBB colours, the resolved fill flag, and the night
     *   colours (see resolveNightColors).
     */
    function resolveLineStyle(settings, watchInfo) {
        return resolveGraphColors(settings, capsForWatch(watchInfo));
    }

    /**
     * resolveLineStyle() for a caller that describes its target by capabilities rather than
     * by a watchInfo — the settings page, which previews a platform it is not connected to.
     * This is the whole body; resolveLineStyle is the watchInfo adapter over it, so the
     * preview and the wire run the SAME resolution rather than two copies of it.
     *
     * @param {Object} settings Clay settings blob — as for resolveLineStyle.
     * @param {{color: boolean, themePolarity: boolean}} caps See renderContextFor.
     * @returns {{secondary: number, fill: number, third: number, fillOn: boolean,
     *   night: Object}} As resolveLineStyle.
     */
    function resolveGraphColors(settings, caps) {
        var cx = renderContextFor(settings, caps);
        var secMetric = settings.secondaryLine;
        var thirdMetric = settings.thirdLine;
        /**
         * One line/fill colour, for the metric that owns it and the polarity this watch
         * actually renders (cx.suffix is read off the FOLDED theme, so an aplite light
         * install can't look up a Light colour it can never paint).
         *
         * A B&W render reads no stored colour at all — these three bytes ARE painted there
         * (unlike the night tail), just from the built-in B&W arms, which is also where
         * resolveInk's exactly-white -> black flip still lives. On a colour render the flip
         * is not needed: the light-polarity built-ins are concrete per-polarity values
         * (gust and feels are Black there, not White), and a colour the user picked for the
         * light polarity is what they want on the light polarity.
         *
         * @param {string} scope The metric this colour belongs to.
         * @param {string} role 'Line' or 'Fill'.
         * @returns {number} 0xRRGGBB colour on the Pebble-64 grid.
         */
        function resolved(scope, role) {
            if (!cx.isColor) {
                // fillColorFor returns undefined for a metric it doesn't know; lineColorFor
                // is TOTAL, so it answers for both roles there. No `||` fallback anywhere —
                // GColorBlack is 0x000000 and therefore falsy.
                var bw = role === 'Fill' ? fillColorFor(scope, false, cx.theme) : undefined;
                return bw === undefined ? lineColorFor(scope, settings, false, cx.theme) : bw;
            }
            return graphColorResolve(settings, scope, role, cx.suffix);
        }
        return {
            secondary: resolved(secMetric, 'Line'),
            fill: resolved(secMetric, 'Fill'),
            third: resolved(thirdMetric, 'Line'),
            night: resolveNightColors(settings, cx, secMetric),
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
     * Pack the line styling for the Clay wire — TEN bytes:
     *
     *   [0] main-metric line colour    (GColor8 argb)
     *   [1] area fill colour           (GColor8 argb)
     *   [2] second-metric line colour  (GColor8 argb)
     *   [3] line flags — bit 0 = fill on
     *   [4] full-height night hatch    (GColor8 argb)  ┐
     *   [5] full-height dusk/dawn line (GColor8 argb)  │ bytes [4..9] are byte-for-byte
     *   [6] night-area underlay base   (GColor8 argb)  │ the watch's NIGHT_COLORS persist
     *   [7] night-area hatch           (GColor8 argb)  │ blob (NIGHT_COLOR_BYTES = 6);
     *   [8] night-area boundary        (GColor8 argb)  │ app_message.c stores the tail
     *   [9] night flags — bit 0 = the tint is an explicit pick  ┘ straight through.
     *
     * The night-fill bit sits in byte [9] rather than beside the fill bit in byte [3] so
     * that block stays a verbatim copy: one bit, one name, one offset on both ends, with no
     * translation step in the C.
     *
     * rgbToGColor8 matches Pebble's GColorFromHEX exactly, so the rendered pixel is
     * identical to sending the full 0xRRGGBB value. The watch's handler treats bytes 4..9 as
     * an optional tail (its length check is a minimum), so an older 4-byte tuple still
     * applies in full and keeps the last good night colours.
     *
     * @param {Object} settings Clay settings blob.
     * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result, or null.
     * @returns {number[]} The ten bytes above.
     */
    function buildLineStyleBytes(settings, watchInfo) {
        var s = resolveLineStyle(settings, watchInfo);
        return [
            rainTier.rgbToGColor8(s.secondary),
            rainTier.rgbToGColor8(s.fill),
            rainTier.rgbToGColor8(s.third),
            s.fillOn ? FLAG_SECONDARY_FILL : 0,
            rainTier.rgbToGColor8(s.night.hatch),
            rainTier.rgbToGColor8(s.night.boundary),
            rainTier.rgbToGColor8(s.night.areaBase),
            rainTier.rgbToGColor8(s.night.areaHatch),
            rainTier.rgbToGColor8(s.night.areaBoundary),
            s.night.fillExplicit ? FLAG_NIGHT_FILL_EXPLICIT : 0
        ];
    }

    var api = {
        renderContext: renderContext,
        renderContextFor: renderContextFor,
        resolveLineStyle: resolveLineStyle,
        resolveGraphColors: resolveGraphColors,
        buildLineStyleBytes: buildLineStyleBytes,
        GRAPH_METRICS: GRAPH_METRICS,
        METRIC_SLUG: METRIC_SLUG,
        METRIC_ROLES: METRIC_ROLES,
        NIGHT_ROLES: NIGHT_ROLES,
        graphColorKey: graphColorKey,
        graphColorRoles: graphColorRoles,
        graphColorKeys: graphColorKeys,
        graphColorDefault: graphColorDefault,
        graphColorIsDefault: graphColorIsDefault,
        graphNightTint: graphNightTint,
        graphColorIsPicked: graphColorIsPicked,
        FLAG_NIGHT_FILL_EXPLICIT: FLAG_NIGHT_FILL_EXPLICIT,
        LINE_COLORS: LINE_COLORS,
        FILL_COLORS: FILL_COLORS,
        colorPick: colorPick,
        lineColorFor: lineColorFor,
        fillColorFor: fillColorFor,
        nightAreaColorsFor: nightAreaColorsFor,
        lighten: lighten
    };

    // Dual-context export — mirrors the tail of src/pkjs/status-thresholds.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.LineStyle = api;
    }
})();

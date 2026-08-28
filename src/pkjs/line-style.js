// src/pkjs/line-style.js — ES5. The graph's colours: two metric lines, the area fill
// and its flag, the five night colours and the night flag. All settings-derived, never
// weather-derived, so they ride the Clay settings message.
//
// DESIGN LOG: docs/adr/0003-graph-colour-model.md — the key vocabulary, why the
// built-ins are derived rather than listed, why the night tint cascades at resolve
// time, the wire layout, and the accepted trade-offs. Comments here are invariants
// only; put the reasoning in the ADR.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (build-config-page.js's APP_FILES), which has
// no require().
(function () {
    // Needed at load time (the tables below are built from them); both are concatenated
    // BEFORE this file in the page bundle, so they resolve either way.
    var COLORS = (typeof require !== 'undefined')
        ? require('./pebble-colors') : window.PebbleColors;
    var resolveInkLib = (typeof require !== 'undefined')
        ? require('./resolve-ink.js') : window.ResolveInk;
    // Phone-only deps — neither is in the page bundle, and neither of their consumers
    // here is reachable from it: configUi backs capsForWatch (so renderContext and
    // resolveLineStyle are phone-only; the page enters through renderContextFor /
    // resolveGraphColors), rainTier backs buildLineStyleBytes, which only wire packers call.
    var configUi = (typeof require !== 'undefined')
        ? require('./config-ui') : null;   // isColorPlatform — same helper rain-tier/palette-wire use
    var rainTier = (typeof require !== 'undefined')
        ? require('./weather/rain-tier') : null;
    var resolveInk = resolveInkLib.resolveInk;
    var isBwTheme = resolveInkLib.isBwTheme;
    var isLightPolarity = resolveInkLib.isLightPolarity;
    var effectiveTheme = resolveInkLib.effectiveTheme;

    // Metric → line stroke colour per platform class. `light` is an OPTIONAL light-polarity
    // override, tested with hasOwnProperty (GColorBlack is falsy); without one a metric
    // keeps its `color` in every colour-capable theme. gust is absent on purpose — its
    // colour depends on rainBarColor, so lineColorFor resolves it. Rationale for each
    // hue, and why feels goes Black on light: ADR-0003 §6.
    var LINE_COLORS = {
        precip_prob: { color: COLORS.GColorPictonBlue, light: COLORS.GColorDukeBlue,       bw: COLORS.GColorWhite },
        wind:        { color: COLORS.GColorYellow,     light: COLORS.GColorChromeYellow,   bw: COLORS.GColorWhite },
        uv:          { color: COLORS.GColorMagenta,    light: COLORS.GColorImperialPurple, bw: COLORS.GColorWhite },
        pressure:    { color: COLORS.GColorOrange,     bw: COLORS.GColorWhite },
        feels:       { color: COLORS.GColorLightGray,  light: COLORS.GColorBlack,          bw: COLORS.GColorWhite }
    };
    // Metric → area-fill colour per platform class. Colour fills are a darker shade of the
    // line so the line always reads brighter; the `light` arm is a BRIGHTER tint instead,
    // since the dark shades read too heavy on white. B&W has no range: always LightGray.
    // (0x55FFFF is GColorElectricBlue — GColorCyan is 0x00FFFF.) ADR-0003 §6.
    var FILL_COLORS = {
        precip_prob: { color: COLORS.GColorCobaltBlue, light: COLORS.GColorElectricBlue, bw: COLORS.GColorLightGray },
        wind:        { color: COLORS.GColorArmyGreen,  light: COLORS.GColorYellow,       bw: COLORS.GColorLightGray },
        uv:          { color: COLORS.GColorPurple,     light: COLORS.GColorShockingPink, bw: COLORS.GColorLightGray },
        gust:        { color: COLORS.GColorDarkGray,   light: COLORS.GColorLightGray,    bw: COLORS.GColorLightGray },
        pressure:    { color: COLORS.GColorWindsorTan, light: COLORS.GColorRajah,        bw: COLORS.GColorLightGray },
        // feels never fills (resolveGraphColors pins fillOn false), so no AREA layer is
        // ever built from this row — it exists so the wire's shape stays total.
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
     * (colorPick), so every colour this module reasons over is a real Pebble value —
     * which is what lighten()'s level arithmetic needs. Changes no pixel (ADR-0003 §5).
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

    // Night base/hatch/boundary for the FILLED area on DARK polarity: six hand-tuned
    // triples, keyed by METRIC. Keying on the day fill colour instead is what made an
    // unlisted metric render precip-blue in the C. Hand-tuned per hue, NOT products of
    // lighten() — ADR-0003 §5. Kept as pure triples: nightAreaColorsFor hands an entry
    // straight back, so an extra key here would ride out into a caller's triple.
    var NIGHT_AREA_COLORS = {
        precip_prob: { base: COLORS.GColorDukeBlue,       hatch: COLORS.GColorBlue,      boundary: COLORS.GColorVividCerulean },
        wind:        { base: COLORS.GColorArmyGreen,      hatch: COLORS.GColorLimerick,  boundary: COLORS.GColorLimerick },
        uv:          { base: COLORS.GColorImperialPurple, hatch: COLORS.GColorPurple,    boundary: COLORS.GColorVividViolet },
        gust:        { base: COLORS.GColorDarkGray,       hatch: COLORS.GColorLightGray, boundary: COLORS.GColorLightGray },
        pressure:    { base: COLORS.GColorWindsorTan,     hatch: COLORS.GColorOrange,    boundary: COLORS.GColorOrange },
        feels:       { base: COLORS.GColorLightGray,      hatch: COLORS.GColorWhite,     boundary: COLORS.GColorWhite }
    };
    // The same night area on LIGHT polarity — a BASE per metric, not a triple, because the
    // hatch and boundary come from deriveNightTriple. That is deliberate: these five were
    // eyeballed on hardware as *stored tints*, which is the path that derives, so deriving
    // is what reproduces what was signed off. A hand-written triple here would repaint it.
    // A metric absent from this table keeps its dark triple in both polarities; feels is
    // absent because it never fills, so no light base of its own is reachable. ADR-0003 §5.
    //
    // ACCEPTED, do not "fix": deriveNightTriple saturates at white, so several of these
    // lose layer separation at the top — gust collapses hatch AND boundary onto white
    // over its LightGray underlay, and wind/uv/pressure land a white boundary. Every one
    // of these five bases was chosen on hardware WITH that consequence on screen, so the
    // collapse is what was signed off, not an oversight in the recipe. Four of the six
    // hand-tuned DARK triples collapse boundary onto hatch too (see the table above), so
    // it is a shape this design already has. Changing a base to separate the layers means
    // changing a colour the user approved — ask first.
    var NIGHT_AREA_LIGHT_BASE = {
        precip_prob: COLORS.GColorCyan,
        wind:        COLORS.GColorRajah,
        uv:          COLORS.GColorShockingPink,
        gust:        COLORS.GColorLightGray,
        pressure:    COLORS.GColorRajah
    };
    // Full-height night hatch / dusk-dawn line. The boundary's polarity swap lives in its
    // B&W arm (forecast_layer.c), so both polarities send DarkGray from here.
    var NIGHT_HATCH_DEFAULT = COLORS.GColorDarkGray;
    var NIGHT_BOUNDARY_DEFAULT = COLORS.GColorDarkGray;

    // --- The graph-colour key vocabulary: 'gc' + slug + role + polarity ---------
    // Concrete per-polarity values, no "auto" sentinel. ADR-0003 §1-§2.

    // Main/second-line metrics, in the order the settings page lists them
    // (blocks.js' FORECAST_METRICS).
    var GRAPH_METRICS = ['precip_prob', 'wind', 'uv', 'gust', 'pressure', 'feels'];
    // Metric id -> the CamelCase key fragment. The ids are snake_case wire values and
    // would make unreadable key names ('gcPrecip_probLineDark').
    var METRIC_SLUG = {
        precip_prob: 'Precip', wind: 'Wind', uv: 'Uv',
        gust: 'Gust', pressure: 'Pressure', feels: 'Feels'
    };
    // 'Night' is the night FILL TINT — the base nightAreaColorsFor derives the triple from.
    var METRIC_ROLES = ['Line', 'Fill', 'Night'];
    // What the full-height band owns, under the pseudo-scope 'night'.
    var NIGHT_ROLES = ['Hatch', 'Boundary'];

    // Metric-id membership set. Built from GRAPH_METRICS so a new metric is a one-line
    // change there and nowhere else.
    var IS_GRAPH_METRIC = {};
    (function () {
        var i;
        for (i = 0; i < GRAPH_METRICS.length; i++) { IS_GRAPH_METRIC[GRAPH_METRICS[i]] = true; }
    }());

    /**
     * Is this scope one of the graph metrics? OWN keys only — a bare object literal answers
     * truthy for every Object.prototype name. This does NOT make graphColorDefault total
     * for such a name; the three colour tables have the same hole (ADR-0003 §3, unreached).
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
     * default, and what graphColorIsDefault compares a stored colour against.
     *
     * DERIVED, never transcribed: every answer comes back out of the three resolvers the
     * renderer itself uses, so editing LINE_COLORS / FILL_COLORS / NIGHT_AREA_COLORS moves
     * the default with it and gust needs no special case (ADR-0003 §3). The appearance
     * contract is pinned in test/line-style.test.js, not by a second table here.
     *
     * `suffix` alone names the theme because this is the colour arm: renderContextFor
     * reports isColor true only for 'dark' and 'light', so Dark <-> 'dark' exactly.
     *
     * TOTAL over scopes and roles — an unknown scope falls through to lineColorFor, which
     * is itself total. Callers must NOT add a `||` fallback: GColorBlack is 0x000000.
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
        if (isGraphMetric(scope) && role === 'Night') { return nightAreaColorsFor(scope, null, theme).base; }
        if (isGraphMetric(scope) && role === 'Fill') { return fillColorFor(scope, true, theme); }
        return lineColorFor(scope, settings || {}, true, theme);
    }

    /**
     * Is the stored colour for one key still the built-in? True when nothing parseable is
     * stored, and when the stored value equals graphColorDefault.
     *
     * gust/Line/Dark answers true for EITHER of its two built-ins (White with multicolour
     * bars, LightGray with solid white ones) so a solid-bar install seeded with White keeps
     * resolving through rainBarColor instead of painting white on white — ADR-0003 §6.
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
     * THE CASCADE LIVES HERE, at resolve time, and nowhere else — the settings page must
     * never write one graph-colour key on behalf of another, or a carried tint and a chosen
     * one become the same bytes and intent stops being answerable (ADR-0003 §4). Blobs the
     * 1.15.0 page already wrote that way are healed on upgrade by clay-settings.js'
     * migrateCarriedGraphNightTints.
     *
     * Returning null rather than the base is deliberate: nightAreaColorsFor answers null
     * with the hand-tuned triple verbatim, while a concrete base runs the derive recipe.
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
     * Did the user CHOOSE this colour, as opposed to being handed it? The single authority
     * behind the two consumers that must agree about intent: the wire's night-fill flag
     * (byte [9] bit 0) and telemetry's 'default' vs '#RRGGBB' report.
     *
     * There is exactly one way a stored colour is not a choice — being the built-in. Now
     * that the cascade resolves rather than writes, a value in a tint key got there because
     * someone picked it (ADR-0003 §4).
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
    // NIGHT flag byte (wire byte [9]), bit 0: the night-area tint is an explicit user pick.
    // It was the light-polarity opt-in for the night re-shade; NO WATCH READS IT any more,
    // since light re-shades unconditionally off NIGHT_AREA_COLORS' light arm. Still sent,
    // because bytes [4..9] are byte-for-byte the watch's NIGHT_COLORS persist blob and
    // dropping it would change that blob's length for one dead byte. ADR-0003 §7.
    var FLAG_NIGHT_FILL_EXPLICIT = 0x01;

    /**
     * What this watch is ACTUALLY rendering — the ONE authority every graph-colour consumer
     * asks instead of re-deriving it. Never re-derive these three: the wire and telemetry
     * did once and diverged (ADR-0003 §8).
     *
     * `theme` is the FOLDED theme (aplite has the light polarity compiled out, so resolving
     * off settings.theme would send black lines to a black background). `isColor` is the
     * EFFECTIVE colour flag — colour hardware only counts when the theme isn't B&W.
     * `suffix` is the polarity half of every key name, off the folded theme, so the pick
     * that is read is the pick that is painted.
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
     * Line/dot colour for a metric, resolved for the platform + theme. Both isColor and
     * theme must come from renderContext() — the EFFECTIVE flag and the FOLDED theme, so
     * bw/bw-light take the `!isColor` arm and never reach the light-variant branch.
     * TOTAL: an unknown metric answers the theme foreground. ADR-0003 §6.
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
            // Gust dodges whichever grey the rain bars use — the one built-in that reads
            // another live setting. Light polarity is black either way (ADR-0003 §6);
            // White falls through to resolveInk, which flips it there.
            result = (!isLightPolarity(theme) && settings.rainBarColor === 'white')
                ? COLORS.GColorLightGray
                : COLORS.GColorWhite;
        } else {
            var entry = LINE_COLORS[metric];
            if (!entry) {
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
     * Area-fill colour for a metric, resolved for the platform + theme. B&W ignores theme
     * (always LightGray); the light-polarity arm is the brighter tint. NOT total — answers
     * undefined for an unknown metric, so callers must handle that explicitly.
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
     * defaultValue or a hand-written fixture can seed an int, so tolerate both. null means
     * "nothing usable stored"; every caller answers that with the built-in.
     *
     * THE snap boundary: every colour this module hands out is on the Pebble-64 grid
     * because it passed through here. Defensive (page swatches already are), but fixtures
     * and older blobs need not be, and lighten() is only exact on grid values.
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
     * A tint equal to the metric's built-in base returns that polarity's built-in triple
     * VERBATIM rather than re-deriving it: five of the six DARK triples do not survive a
     * round-trip through deriveNightTriple, so re-deriving would repaint blobs nobody has
     * touched. (The light built-ins are derived by construction, so there the two agree.)
     *
     * @param {string} metric The secondary line's metric (precip_prob|wind|gust|uv|pressure|feels).
     * @param {number|null} tint The 0xRRGGBB night-fill tint, or null for the built-in.
     * @param {string} [theme] 'dark'|'light'|'bw'|'bw-light'; defaults to 'dark' (the
     *   hand-tuned triples) when omitted.
     * @returns {{base: number, hatch: number, boundary: number}} Three 0xRRGGBB colours.
     */
    function nightAreaColorsFor(metric, tint, theme) {
        // TOTAL: an unknown metric (a blob naming a metric this build dropped) takes the
        // precip entry, which is the arm forecast_layer.c fell through to. OWN keys only —
        // a bare object literal answers truthy for every Object.prototype name.
        var has = Object.prototype.hasOwnProperty;
        var key = has.call(NIGHT_AREA_COLORS, metric) ? metric : 'precip_prob';
        // Presence, not truthiness — a light base of GColorBlack is 0x000000. The light
        // built-in IS deriveNightTriple applied to its base, so the short-circuit below
        // compares against the base the polarity in hand actually paints.
        var builtin = (isLightPolarity(theme || 'dark') && has.call(NIGHT_AREA_LIGHT_BASE, key))
            ? deriveNightTriple(NIGHT_AREA_LIGHT_BASE[key])
            : NIGHT_AREA_COLORS[key];
        if (tint === null || tint === undefined || tint === builtin.base) { return builtin; }
        return deriveNightTriple(tint);
    }

    /**
     * The night triple for an arbitrary tint: one Pebble level per layer, so the hatch
     * reads above its underlay and the boundary above the hatch. This is NOT the recipe
     * the six DARK built-ins came from — five of them do not survive a round-trip through
     * it, which is why nightAreaColorsFor returns those verbatim. ADR-0003 §5.
     * @param {number} tint 0xRRGGBB base, on the Pebble-64 grid.
     * @returns {{base: number, hatch: number, boundary: number}} Three 0xRRGGBB colours.
     */
    function deriveNightTriple(tint) {
        var hatch = lighten(tint);
        return { base: tint, hatch: hatch, boundary: lighten(hatch) };
    }

    /**
     * Resolve the five night colours (plus the explicit-tint flag) for the wire.
     *
     * No B&W arm and no isColor gate, deliberately: a B&W watch or bw/bw-light theme
     * discards all five and paints from its own constants, so a "B&W-honest" set was five
     * bytes no watch ever read. These bytes describe colours that render mode ignores.
     *
     * `fillExplicit` is the only one on the wire (byte [9]). No watch reads it now — see
     * FLAG_NIGHT_FILL_EXPLICIT — but it stays honest rather than pinned true: it is the
     * same "is this a pick?" answer telemetry reports, and the wire and telemetry
     * disagreeing about intent is the bug §8 exists to prevent. ADR-0003 §4, §7.
     *
     * @param {Object} settings Clay settings blob (the gcNightHatch / gcNightBoundary keys
     *   and the gc&lt;Metric&gt;Night / gc&lt;Metric&gt;Fill pair, both polarities).
     * @param {{suffix: string, theme: string}} cx renderContext() result — the polarity
     *   suffix and theme are read from the FOLDED theme, so an aplite light install looks
     *   up the Dark colours it can paint.
     * @param {string} metric The secondary line's metric, which keys the night area.
     * @returns {{hatch: number, boundary: number, areaBase: number, areaHatch: number,
     *   areaBoundary: number, fillExplicit: boolean}} Five 0xRRGGBB colours plus the flag
     *   saying the area tint has been moved off its built-in.
     */
    function resolveNightColors(settings, cx, metric) {
        var area = nightAreaColorsFor(metric, graphNightTint(settings, metric, cx.suffix), cx.theme);
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
     * Resolve the graph's line styling from settings alone (no weather data). A thin
     * watchInfo adapter over resolveGraphColors — the only thing a watchInfo adds is the
     * two capability bits capsForWatch looks up.
     *
     * CONTRACT: every colour handed back is 0xRRGGBB on the Pebble-64 grid, so nothing
     * downstream has to quantize again.
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
         * actually renders. A B&W render reads NO stored colour — these three bytes are
         * still painted there (unlike the night tail), from the built-in B&W arms, which is
         * where resolveInk's white -> black flip lives. A colour render needs no flip: the
         * light-polarity built-ins are already concrete per-polarity values.
         *
         * @param {string} scope The metric this colour belongs to.
         * @param {string} role 'Line' or 'Fill'.
         * @returns {number} 0xRRGGBB colour on the Pebble-64 grid.
         */
        function resolved(scope, role) {
            if (!cx.isColor) {
                // fillColorFor is not total; lineColorFor is, so it answers for both roles.
                // Explicit undefined check, not `||` — GColorBlack is 0x000000.
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
            // THE authoritative gate on feels never filling (ADR-0003 §6) — the config UI
            // also hides and clears the toggle, but a blob stored before that landed, or
            // any future caller, still cannot turn it on.
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
     * rgbToGColor8 matches Pebble's GColorFromHEX exactly, so the pixel is identical to
     * sending the full 0xRRGGBB. The watch treats bytes [4..9] as an OPTIONAL tail (its
     * length check is a minimum), so a shorter tuple from an older sender still applies in
     * full — which is the rule for growing this: append a block plus its own length check,
     * never widen the minimum. ADR-0003 §7.
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

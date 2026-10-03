// src/pkjs/settings/blocks.js — ES5, WebView. WarnWeather's threshold-sheet
// machinery (ranges, auto colors, the warn-look default, the two reset
// actions, the sheet/badge resolvers) and the small option/default/recommend
// resolvers. The BLOCK RENDERERS live one file per concern —
// preview-forecast.js, preview-radar.js, preview-diagnostics.js and
// preview-layout.js, over the shared preview-svg.js / preview-rain.js; under Node
// this file requires the four registering ones, so requiring blocks.js registers
// every block and not just its own (the webview concatenates every file instead —
// see scripts/build-config-page.js APP_FILES). It requires the schema's when resolvers
// (when-resolvers.js) and the Forecast tab's line resolvers (forecast-hints.js: the
// metric and style pickers' options and every forecast line row's hint) the same way,
// and, at its end, the Alerts tab's resolvers (alerts-page.js), which read this file's
// PConf.thresholdLevels.
/* global PConf, COUNTRY_DEFAULTS, INJECTED_USERDATA */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
if (typeof require !== 'undefined') {
    require('./preview-forecast.js');
    require('./preview-radar.js');
    require('./preview-diagnostics.js');
    require('./preview-layout.js');
    require('./when-resolvers.js');
    require('./forecast-hints.js');
}
(function () {
    // Dual-context pattern (see line-style.js): CommonJS under Node, a
    // concatenated <script> global in the webview.
    var statusLineCatalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var tomorrowioBudget = (typeof require !== 'undefined')
        ? require('./tomorrowio-budget.js') : PConf.tomorrowioBudget;
    var rainbowBudget = (typeof require !== 'undefined')
        ? require('./rainbow-budget.js') : PConf.rainbowBudget;
    // The key status under a keyed provider (key-status.js, concatenated ahead of this
    // file): tomorrow.io's usage line registers into it.
    var keyStatus = (typeof require !== 'undefined')
        ? require('./key-status.js') : PConf.keyStatus;
    // The regional radar sources' areas (radar-coverage.js, concatenated ahead of this
    // file): the note under the Radar provider row.
    var radarCoverage = (typeof require !== 'undefined')
        ? require('../weather/radar-coverage.js') : window.RadarCoverage;
    // The update-interval ladder under every active budget guard, shared with onbuild.js's
    // save-time fit so the page and the save clamp can't drift apart.
    var intervalBudget = (typeof require !== 'undefined')
        ? require('./interval-budget.js') : PConf.intervalBudget;
    // Country → recommended-provider mapping (shared with the wizard).
    var CD = (typeof require !== 'undefined') ? require('./country-defaults.js') : COUNTRY_DEFAULTS;
    // The graph-colour vocabulary (key names, per-scope roles, the built-in table) —
    // the same module the watch's wire is packed from, so the row badges below preview
    // exactly what the graph draws. Same dual-context rule as the preview blocks:
    // scripts/build-config-page.js concatenates line-style.js AHEAD of this file, so
    // window.LineStyle exists by the time the page boots.
    var lineStyle = (typeof require !== 'undefined')
        ? require('../line-style.js') : window.LineStyle;
    // The theme vocabulary (polarity, B&W, whether the watch draws colour), concatenated
    // ahead of line-style.js and so of this file.
    var resolveInk = (typeof require !== 'undefined')
        ? require('../resolve-ink.js') : window.ResolveInk;
    // The page bundle's single-source int<->hex (config-ui/lib/color.js, concatenated
    // ahead of every app file), rather than a fourth local copy of the same six digits.
    var intToHex = (typeof require !== 'undefined')
        ? require('../config-ui/lib/color.js').intToHex : PConf.color.intToHex;
    // The rgb control's own value helpers (config-ui/lib/rgb-control.js, likewise
    // concatenated ahead of the app files): a badge previewing an rgb key parses the
    // stored "r,g,b" string with the same parser — fallbacks included — as the sliders
    // behind it, so the dot cannot show a colour the sheet would not open on.
    var rgbControl = (typeof require !== 'undefined')
        ? require('../config-ui/lib/rgb-control.js') : PConf.rgbControl;
    // The threshold contract (status-thresholds.js): the kinds, their seed pairs, the
    // colour and warn-look rules and the alert vocabulary — the module the watch's
    // blob is packed and its alerts baked from, so the sheets, badges and hints read
    // the numbers, colours and switches the watch uses.
    // scripts/build-config-page.js concatenates it AHEAD of this file.
    var thresholds = (typeof require !== 'undefined')
        ? require('../status-thresholds.js') : window.StatusThresholds;
    // The On demand contract (on-demand.js): its bars, sides and side-list keys (BARS,
    // SIDES, itemsKey), which name the eight lists both resets restore (onDemandListKeys)
    // — the phone's own reading, concatenated ahead of this file.
    var onDemand = (typeof require !== 'undefined')
        ? require('../on-demand.js') : window.OnDemand;

        // Slot-dropdown options resolver: derives a status-line slot's option list from the
    // catalog (Tasks 2 + 17) — Empty first, availability-gated, sibling+excludeCodes filtered.
    PConf.optionsResolvers.register('statusSlot', function (S, env, args) {
        return statusLineCatalog.slotOptions(S, env, args);
    });

    // Full-date sample labels for the Date sheet's no-calendar picker, in the
    // user's effective day/month order — the same derivation the wire's Auto
    // format uses (clay-payload effectiveHolidayCountry: the configured holiday
    // country, 'US' when the key is absent). Values are date-format.js'
    // FULL_FORMAT_CODES; samples are a fixed 7 Sep 2026, not today's date — the
    // labels are format examples, and static strings keep the list deterministic
    // under test. ISO is the one order-blind format, so it reads the same in
    // both branches.
    PConf.optionsResolvers.register('dateFullFormatOptions', function (S) {
        var country = (S && Object.prototype.hasOwnProperty.call(S, 'holidayCountry'))
            ? S.holidayCountry : 'US';
        return country === 'US' ? [
            ['09.07.26', 'auto'],
            ['09.07.2026', 'long'],
            ['9.7.', 'noyear'],
            ['9/7/26', 'slash'],
            ['2026-09-07', 'iso'],
            ['Sep 7', 'text'],
            ['Sep 7, 2026', 'textyear']
        ] : [
            ['07.09.26', 'auto'],
            ['07.09.2026', 'long'],
            ['7.9.', 'noyear'],
            ['7/9/26', 'slash'],
            ['2026-09-07', 'iso'],
            ['7 Sep', 'text'],
            ['7. Sep 2026', 'textyear']
        ];
    });

    /**
     * The AQI slot's Day max / Both hint while its source note applies: the row's own
     * by-value hint for the shown mode (args.staticHint, which the engine hands every hint
     * resolver: its hintByValue entry, the schema.js dayMaxHints copy, so the two cannot
     * drift) closed on the source's note — WAQI and Auto have no forecast to take a peak
     * from (args.notes). A non-null answer REPLACES hintByValue (engine renderRow), so
     * this returns the whole text; null for Now and whenever no note applies, so
     * hintByValue answers. Now never reaches staticHint: the row has no Now hint, and
     * staticHint would fall back to its plain hint there.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, staticHint: (string|undefined),
     *   notes: ?{key: string, fallback: string, byValue: Object}}} args The row's shown
     *   mode and its static hint for it + dayMaxRows' source notes.
     * @returns {?string} The hint with its note, or null for "use hintByValue".
     */
    function dayMaxHint(S, env, args) {
        if (args.value !== 'max' && args.value !== 'both') { return null; }
        var notes = args.notes;
        if (!notes || !args.staticHint) { return null; }
        var source = (S || {})[notes.key] || notes.fallback;
        // Own keys only: a stored source like 'constructor' must not print an
        // Object.prototype function.
        var note = (typeof source === 'string'
            && Object.prototype.hasOwnProperty.call(notes.byValue, source)) ? notes.byValue[source] : '';
        return note ? args.staticHint + note : null;
    }
    PConf.hintResolvers.register('dayMaxHint', dayMaxHint);

    // Per-slot edit sheet: the pencil left of a slot dropdown opens the threshold sheet
    // for the slot's CURRENT value, when that value is a threshold kind. The catalog's
    // slot codes and the threshold contract's KINDS codes are the same vocabulary
    // ('wind', 'aqi', 'steps', ...), so the contract IS the mapping — no hand-copied
    // list to drift. env gate mirrors the sheets' own showWhen (aplite compiles the
    // highlight out).
    PConf.sheetResolvers.register('statusSlotEditSheet', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < thresholds.KINDS.length; i++) {
            if (thresholds.KINDS[i].code === code) { return 'thresh' + thresholds.KINDS[i].key; }
        }
        return null;
    });

    // --- threshold sliders (the per-slot edit sheets' controls) ------------------

    /**
     * Normalize a stored color (0xRRGGBB int or '#RRGGBB' string) to '#RRGGBB' —
     * the inline-styled zones/chips/dots must never interpolate an unvetted
     * string into HTML.
     * @param {*} v Stored color value.
     * @param {number} fallbackInt Default 0xRRGGBB when v is unset/garbage.
     * @returns {string} '#RRGGBB' (uppercase).
     */
    function colorHexOf(v, fallbackInt) {
        if (typeof v === 'number' && isFinite(v)) { return intToHex(v); }
        if (typeof v === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(v)) {
            return '#' + v.replace('#', '').toUpperCase();
        }
        return colorHexOf(fallbackInt, 0xFF0000);
    }

    /**
     * @param {string} hex '#RRGGBB'.
     * @returns {{r: number, g: number, b: number}} Channel values.
     */
    function hexRgb(hex) {
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }

    /**
     * Soft glow tint for a knob's shadow (the same .35 alpha the brand knobs use
     * in shell.html).
     * @param {string} hex '#RRGGBB'.
     * @returns {string} rgba() string.
     */
    function glowOf(hex) {
        var c = hexRgb(hex);
        return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.35)';
    }

    /**
     * Readable text color on a chip filled with the given color.
     * @param {string} hex '#RRGGBB'.
     * @returns {string} Dark ink on light fills, white on dark fills.
     */
    function chipTextOn(hex) {
        var c = hexRgb(hex);
        return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 150 ? '#20232A' : '#FFFFFF';
    }

    /**
     * Ceil a value onto a step grid, guarding float-division noise (3 / 0.5
     * landing on 5.999…).
     * @param {number} v Value.
     * @param {number} step Step size (> 0).
     * @returns {number} Smallest step multiple >= v.
     */
    function ceilToStep(v, step) {
        return Math.ceil(Math.round((v / step) * 1e6) / 1e6) * step;
    }

    // Per-kind slider geometry, in the kind's DISPLAY unit (the unit
    // status-thresholds.js compares against at bake/pack time), keyed by the
    // contract's scaleVariant — the same key its seed table uses, so the slider and
    // the seeds cannot read the unit and AQI-scale pickers apart. Looked up per render
    // (rangeOf) so the General-tab unit pickers reshape the scales live. fixedMax
    // marks the naturally-bounded kinds (no inline scale-max editor). The SEED pairs
    // are not here: they live in the contract (status-thresholds.js SEEDS /
    // seedPair) — the one table the phone bake resolves a blank pair against too, so
    // the slider can never preview numbers the watch does not use.
    var THRESHOLD_RANGES = {
        Wind: {
            kph: {min: 0, max: 120, step: 5, unit: 'kph'},
            mph: {min: 0, max: 75, step: 5, unit: 'mph'},
            kn: {min: 0, max: 65, step: 5, unit: 'kn'}
        },
        Gust: {
            kph: {min: 0, max: 160, step: 5, unit: 'kph'},
            mph: {min: 0, max: 100, step: 5, unit: 'mph'},
            kn: {min: 0, max: 85, step: 5, unit: 'kn'}
        },
        Aqi: {
            us: {min: 0, max: 300, step: 10, unit: ''},
            eu: {min: 0, max: 150, step: 5, unit: ''}
        },
        Pollen: {'': {min: 0, max: 3, step: 0.5, unit: '', fixedMax: true}},
        // The slot displays the rounded integer index, so whole steps; 12 covers
        // every real-world reading (extremes clamp against the top like any kind).
        Uv: {'': {min: 0, max: 12, step: 1, unit: '', fixedMax: true}},
        Steps: {'': {min: 0, max: 20000, step: 250, unit: ''}},
        Sleep: {'': {min: 0, max: 12, step: 0.5, unit: 'h', fixedMax: true}},
        Distance: {
            km: {min: 0, max: 20, step: 0.5, unit: 'km'},
            mi: {min: 0, max: 12, step: 0.5, unit: 'mi'}
        }
    };

    /**
     * A kind's slider geometry for the unit and scale the settings select.
     * @param {string} stem Kind key stem with a THRESHOLD_RANGES entry.
     * @param {Object} S Live settings state.
     * @returns {{min: number, max: number, step: number, unit: string,
     *     fixedMax: (boolean|undefined)}} The geometry (shared: read, never mutate).
     */
    function rangeOf(stem, S) {
        return THRESHOLD_RANGES[stem][thresholds.scaleVariant(stem, S)];
    }

    /**
     * Range resolver for the threshold sliders (engine item.rangeFrom): per-kind
     * geometry + fixed direction + live colors. The scale max honors the stored
     * per-kind override and always grows to fit the stored thresholds, so a pair
     * entered under another unit (or by the old text UI) can never strand a thumb
     * off the track.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, chips: ({warn: string, danger: string}|undefined)}} args
     *     Kind key stem, e.g. 'Steps', and the chips' words from the group's voice
     *     (level-rows-schema.js GOAL_VOICE / ALERT_VOICE); without them the slider says Warn /
     *     Danger (range-control.js).
     * @returns {Object} Config the engine merges over the schema item.
     */
    function thresholdRangeCfg(S, env, args) {
        var stem = args.keyStem;
        var base = rangeOf(stem, S || {});
        var max = base.max;
        if (!base.fixedMax) {
            var override = thresholds.parseThreshold(S['thresh' + stem + 'Max']);
            if (override !== null && override > base.min) { max = ceilToStep(override, base.step); }
            var warn = thresholds.parseThreshold(S['thresh' + stem + 'Warn']);
            var danger = thresholds.parseThreshold(S['thresh' + stem + 'Danger']);
            if (warn !== null && warn > max) { max = ceilToStep(warn, base.step); }
            if (danger !== null && danger > max) { max = ceilToStep(danger, base.step); }
            // The pair the phone actually holds on must sit on the scale too
            // (resolvedPair: the stored pair when it is ordered, else the seed).
            // With a blank pair and a stored scale max below the seed — the
            // slider's max editor is live while the highlight is off, and older
            // installs kept a Max from before OFF stopped blanking the pair — the
            // slider would clamp the seed it previews to that max while the bake
            // uses the real seed: two readings of one rule.
            var held = thresholds.resolvedPair(stem, S || {});
            if (held.warn !== null && held.warn > max) { max = ceilToStep(held.warn, base.step); }
            if (held.danger !== null && held.danger > max) { max = ceilToStep(held.danger, base.step); }
        }
        // A null warn color (warn look 'none') draws the slider's warn pieces in a
        // neutral gray: the zone still shows WHERE warn spans, while the copy +
        // warn look make clear the watch draws no box there.
        var warnDisplay = thresholdDisplayColor(S, stem, 'Warn', env);
        var warnColor = warnDisplay === null ? '#8A8E97' : warnDisplay;
        var dangerColor = thresholdDisplayColor(S, stem, 'Danger', env);
        var chips = args.chips || {};
        // Seeds from the contract's table: what a blank pair means on the phone.
        var seed = thresholds.seedPair(stem, S || {});
        return {
            min: base.min, max: max, step: base.step, minSpan: base.step,
            // Direction axis retired (status-thresholds.js): every kind's value
            // rises toward the pair. The engine's 'below' rendering stays a
            // dormant library feature no item sets.
            dir: 'above',
            unit: base.unit,
            seedWarn: seed.warn, seedDanger: seed.danger,
            maxEditable: !base.fixedMax,
            warnColor: warnColor, dangerColor: dangerColor,
            warnGlow: glowOf(warnColor), dangerGlow: glowOf(dangerColor),
            dangerText: chipTextOn(dangerColor),
            // Chip/aria wording, the voice's: goal kinds celebrate (Close / Goal),
            // weather warns.
            warnLabel: chips.warn,
            dangerLabel: chips.danger
        };
    }
    PConf.rangeResolvers.register('thresholdRange', thresholdRangeCfg);

    // Picking feels-like or dew point as the main metric clears "Area fill": both map
    // against the temperature axis, not a 0..max scale, so their "below the line"
    // is the arbitrary joint-band floor rather than a zero the fill can mean anything
    // against. The toggle's showWhen hides the row for them; this writes the stored
    // value false so the settings blob agrees with what the watch renders (and with
    // the preview). Switching to any other metric leaves the value alone — the user
    // re-enables the fill themselves, the same as any other toggle.
    PConf.onChange.register('forecastMetricFill', function (S, oldValue, newValue) {
        if (lineStyle.isTempAxisMetric(newValue)) { S.secondaryLineFill = false; }
    });

    // The night tint follows the fill at RESOLVE time (line-style.js' graphNightTint),
    // so nothing is written into the tint key when a fill is picked — the page stays a
    // pure editor and "did the user pick this tint?" keeps a straight answer. The two
    // display surfaces that have to show the CASCADED colour rather than the stored one
    // are the row badge (graphColorSwatch below) and the in-sheet swatch, which reads
    // the display resolver registered next to it.

    // The temp slot's "Both" mode and its degree sign are mutually exclusive:
    // "-12/-10" is already 7 of an edge slot's 8 bytes and the sign is two more.
    // Whichever the user just picked wins, so neither choice is ever refused --
    // the other simply steps aside. Both rows share this hook; the key says which
    // one moved. status-lines.js gates the pair independently, for a settings blob
    // written before this existed.
    PConf.onChange.register('tempUnitExclusive', function (S, oldValue, newValue, env, key) {
        if (key === 'tempSlotDisplay') {
            if (newValue === 'both') { S.tempSlotUnit = false; }
        } else if (newValue) {
            if (S.tempSlotDisplay === 'both') { S.tempSlotDisplay = 'actual'; }
        }
    });

    // A kind's warn look default (thresh<K>WarnLook's defaultFrom): the contract's
    // warnLookDefault — fill on a colour watch, outline on a B&W one, outline for the
    // goal kinds — so the page shows exactly what the packer resolves an unset key
    // to. The key stays unset in the phone store: defaultFrom items are never
    // seeded, and the item's sticky: false keeps a save from writing this value.
    PConf.defaultsResolvers.register('warnLookDefault', function (env, args) {
        return thresholds.warnLookDefault(args && args.keyStem, env ? env.color : undefined);
    });

    // The warn look's hint (thresh<K>WarnLook's hintFrom), for the SELECTED look,
    // from the group voice's look copy the row passes as `copy` (level-rows-schema.js
    // GOAL_VOICE / ALERT_VOICE `look`):
    //  - a B&W watch or B&W day theme: its `bw` set — the box is drawn in the text
    //    colour, the pickers are hidden, and a fill is the danger (reached-goal) fill;
    //  - a colour day theme with a B&W night theme (Theme switching on): the row's
    //    own hint (`base`, its hintByValue) plus the `night` note for that look — by
    //    day the box is in the picked colour, at night a fill matches danger;
    //  - a colour screen where Fill's two colours resolve to the SAME one (a goal
    //    kind's defaults are both the goal green; a warn pick can equal danger): the
    //    `sameColor` note too — that fill IS the danger / reached-goal box;
    //  - otherwise null — the row's own hintByValue.
    // A look a set has no line for (none) falls back the same way. The watch still
    // draws what was picked (status_row.c).
    PConf.hintResolvers.register('warnLookHint', function (S, env, args) {
        var copy = args && args.copy;
        if (!copy) { return null; }
        var value = args.value;
        var st = S || {};
        // By DAY: the case the colour pickers are hidden for (schema-gates.js
        // COLOR_THEME_WHEN) and every highlight is drawn in the text colour.
        if (!resolveInk.drawsColor(env, st.theme)) {
            var bwText = copy.bw && copy.bw[value];
            return typeof bwText === 'string' ? bwText : null;
        }
        var base = copy.base && copy.base[value];
        if (typeof base !== 'string') { return null; }
        var parts = [base];
        var note = copy.night && copy.night[value];
        if (st.themeAuto === true && resolveInk.isBwTheme(st.themeNight) && typeof note === 'string') {
            parts.push(note);
        }
        if (value === 'fill' && args.keyStem && typeof copy.sameColor === 'string') {
            var warnHex = thresholdDisplayColor(st, args.keyStem, 'Warn', env);
            var dangerHex = thresholdDisplayColor(st, args.keyStem, 'Danger', env);
            if (warnHex && dangerHex && String(warnHex).toUpperCase() === String(dangerHex).toUpperCase()) {
                parts.push(copy.sameColor);
            }
        }
        return parts.length > 1 ? parts.join(' ') : null;
    });

    /**
     * The colour the page DRAWS for a kind's warn/danger pieces (slider zones, badge
     * dots, the colour pickers' swatches) — what the watch draws by day: the theme's
     * text colour on a B&W watch or B&W day theme (every highlight is in the text
     * colour there), else the contract's colour rule (status-thresholds.js
     * thresholdColor — the one the packer and the on-open heal use too). So an unset
     * colour previews its auto value, and a black or white pick previews what the
     * watch turns it into (the text colour; the goal green for a goal kind).
     * @param {Object} S Live settings state.
     * @param {string} stem Kind key stem, e.g. 'Steps'.
     * @param {string} which 'Warn' | 'Danger'.
     * @param {Object} [env] Platform env (env.color false on a B&W watch).
     * @returns {?string} '#RRGGBB', or null for a warn look of 'none'.
     */
    function thresholdDisplayColor(S, stem, which, env) {
        // WARN with the look 'none' draws no box (bold only) — report null so
        // callers render their neutral no-box state instead of a color.
        if (which === 'Warn' && S['thresh' + stem + 'WarnLook'] === 'none') {
            return null;
        }
        return intToHex(resolveInk.drawsColor(env, S.theme)
            ? thresholds.thresholdColor(S, stem, which) : thresholds.textColor(S));
    }
    // The warn and danger pickers paint the same resolution (engine.js' displayFrom
    // hook), not the raw stored value: after a reset stores the schema's unset '', or
    // a pick the watch resolves differently (a goal kind's black or white is its
    // green), the swatch still shows what the watch draws. Clicking a swatch still
    // writes the pick under the picker's own key.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, which: string}} args The picker's kind and colour.
     * @returns {?string} '#RRGGBB' to paint, or null to fall back to the stored value.
     */
    PConf.displayResolvers.register('thresholdColor', function (S, env, args) {
        if (!S || !args || !args.keyStem) { return null; }
        return thresholdDisplayColor(S, args.keyStem, args.which, env);
    });

    // Reset-to-defaults for one threshold kind (the small button beside the slider's
    // label). Returns true so the engine re-renders.
    PConf.actions = PConf.actions || {};
    PConf.actions.resetThresholds = function (stem, S, env, defaultOf) {
        if (!stem || !S || !THRESHOLD_RANGES[stem] || !defaultOf) { return false; }
        var goal = thresholds.isGoalKind(stem);
        // Every key with a schema default lands on it THROUGH the engine's resolver —
        // mirrored literals drift when the schema changes (see resetStatusSlots
        // below). The result is exactly a fresh install: a goal kind's stored
        // toggle OFF (its switch rides this group's header, so resetting the goals
        // switches it off too), the blank pair (= the kind's seed, resolved live — a
        // wind pair follows windUnits again), the cleared Max, the goal-vs-weather
        // colours and the platform's warn look are all schema defaults. A weather
        // colour's default is unset, which the pickers and zones already show as
        // what the watch draws (thresholdDisplayColor), and the next open's heal
        // stores. A weather kind's highlight switch is NOT in this group — it is
        // the slot sheet's Highlight row — so its levels reset leaves it alone, as
        // it leaves Bold.
        var keys = ['Warn', 'Danger', 'Max', 'WarnColor', 'DangerColor', 'WarnLook'];
        if (goal) { keys.unshift('On'); }
        for (var d = 0; d < keys.length; d++) {
            S['thresh' + stem + keys[d]] = defaultOf('thresh' + stem + keys[d]);
        }
        // The first-run wizard's defaults-policy table has no row for any of these
        // keys (its threshold rows are Bold modes and a weather kind's highlight
        // switch, both outside this group), so the schema defaults ARE the
        // out-of-box state and nothing else lands here.
        return true;
    };

    // Reset-to-default for ONE graph-colour sheet (the button on its "Colors"
    // sub-header — one sheet per metric, plus the night band). The KEY LIST comes from
    // the schema through data-action-arg, so this file needs no copy of it and cannot
    // drift; every key lands on its schema default THROUGH the engine's resolver, never
    // a mirrored literal (the drift rule the resetThresholds comment above states) —
    // which is what makes it correct now that a default is a concrete colour rather
    // than a sentinel. Each sheet lists BOTH polarities: leaving the hidden one tuned
    // would resurrect old picks on the next theme switch.
    /**
     * @param {string} arg Comma-separated key list (the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused — the keys are platform-independent).
     * @param {function(string): *} defaultOf The engine's stored-shape schema default
     *     resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetGraphColors = function (arg, S, env, defaultOf) {
        if (!arg || !S || !defaultOf) { return false; }
        var keys = String(arg).split(',');
        for (var i = 0; i < keys.length; i++) {
            if (keys[i]) { S[keys[i]] = defaultOf(keys[i]); }
        }
        return true;
    };

    // The night tint a metric's filled area is actually painted in, as a hex string for
    // the two display surfaces below. line-style.js owns the rule (the user's own pick,
    // else the fill colour they chose, else the metric's hand-tuned built-in) and hands
    // back null for that last arm, so the built-in is filled in here. Written as a
    // fallback ARGUMENT rather than `graphNightTint(...) || default`: GColorBlack is
    // 0x000000 and would fail a truthiness test.
    /**
     * @param {Object} S Live settings state.
     * @param {string} metric A metric id (line-style.js' graphColorKey vocabulary).
     * @param {string} suffix 'Dark'|'Light' — the polarity being edited.
     * @returns {string} '#RRGGBB' (uppercase).
     */
    function graphNightTintHex(S, metric, suffix) {
        return colorHexOf(lineStyle.graphNightTint(S, metric, suffix),
            lineStyle.graphColorDefault(metric, 'Night', suffix, S));
    }

    // The night-tint picker inside a metric's colour sheet paints the CASCADED colour
    // (engine.js' displayFrom hook), not the value stored under its own key: with the
    // page-side carry gone, a tint the user has not claimed sits on its built-in while
    // the graph draws the fill colour, and a picker showing the built-in would be a
    // stale swatch. Clicking the shown swatch still writes it — that pins the tint as a
    // real pick, which is exactly what a deliberate click means.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused — the cascade is platform-independent).
     * @param {Object} args displayFrom.args — {scope, suffix} plus the merged messageKey.
     * @returns {?string} '#RRGGBB' to paint, or null to fall back to the stored value.
     */
    PConf.displayResolvers.register('graphNightTint', function (S, env, args) {
        if (!lineStyle || !S || !args || !args.scope || !args.suffix) { return null; }
        return graphNightTintHex(S, args.scope, args.suffix);
    });

    // Row badge for the Graph-colors card (schema.js' GRAPH_COLOR_ROWS): the preview
    // between a row's label and its Edit button.
    //
    // ONE DOT PER PICKER in that row's sheet — three for a metric (line, fill, night
    // tint), one for feels (which never fills, so line-style hands it no fill or tint
    // key) and two for the night band — so the badge is the row's whole colour state
    // rather than a sample of it, and the dot count also says how many pickers are
    // behind Edit. The threshold badge shows two dots for the same reason: a threshold
    // kind owns exactly two colours.
    //
    // The last dot of a multi-dot row is drawn as a ring purely so several chips read
    // as several colours instead of one bar; unlike the threshold badge's ring — the
    // watch's own outline (a warn look) against its fill — it carries no meaning of
    // its own.
    //
    // Polarity: the sheet's pickers gate on the RAW `theme` value, so the badge must
    // fold nothing either — hence themePolarity true even when a B&W-polarity watch is
    // being previewed (the same choice, for the same reason, as the forecast preview's
    // caps). The env.color guard is belt-and-braces behind the row's COLOR capability.
    /**
     * @param {Object} S Live settings state (colors as '#RRGGBB').
     * @param {Object} env Platform env; env.color gates the whole card.
     * @param {Object} args editBadgeFrom.args — {scope}, the row's identity (a `sheet`
     *     row has no messageKey for the engine to merge in).
     * @returns {?{label: string, dots: Object[]}} The badge, or null to render none.
     */
    PConf.badgeResolvers.register('graphColorSwatch', function (S, env, args) {
        if (!lineStyle || !env || !env.color || !args || !args.scope) { return null; }
        var scope = args.scope;
        var sfx = lineStyle.renderContextFor(S, {color: true, themePolarity: true}).suffix;
        var roles = lineStyle.graphColorRoles(scope);
        var dots = [], i;
        for (i = 0; i < roles.length; i++) {
            dots.push({
                // The colour that row's picker will show as highlighted; the built-in
                // stands in until the key is written. That is the STORED colour for
                // every role but the night tint, which cascades from the fill at resolve
                // time — so it goes through graphNightTintHex above, the same helper the
                // sheet's own swatch reaches via the 'graphNightTint' displayResolver.
                color: roles[i] === 'Night'
                    ? graphNightTintHex(S, scope, sfx)
                    : colorHexOf(S[lineStyle.graphColorKey(scope, roles[i], sfx)],
                        lineStyle.graphColorDefault(scope, roles[i], sfx, S)),
                ring: roles.length > 1 && i === roles.length - 1
            });
        }
        return {label: 'Edit', dots: dots};
    });

    // Row badge for a `sheet` row whose sheet holds ONE rgb control — schema.js'
    // Nighttime card, whose "Color" row opens the dim-backlight sliders. It reports a
    // `chip`, not `dots`: the engine prints that as the full swatch-and-hex readout the
    // sheet itself shows above the sliders (html.js swatchReadout, one builder for both),
    // so the row names the colour it is set to instead of hinting at it with a 9px pip.
    // The graph rows keep dots because each of them previews two or three colours at
    // once and three readouts would not fit a row — chip is the ONE-colour shape.
    //
    // The hex is derived, not stored: the value is the control's "r,g,b" wire string,
    // parsed by rgb-control.js' own parser so an unset or bruised value (blank, two
    // channels, 300) badges exactly the colour the sliders would open on rather than a
    // second reading of the format.
    /**
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env — unused: the row that carries this badge owns
     *     the hardware gate (and the sheet repeats it), so a badge is only ever asked
     *     for where the colour applies.
     * @param {Object} args editBadgeFrom.args — {key, defaultValue}: the rgb key this
     *     row previews (a `sheet` row has no messageKey of its own to merge in) and
     *     that key's schema default, for a value the parser rejects.
     * @returns {?{label: string, ariaNote: string, chip: string}} The badge, or null
     *     when the row named no key to preview.
     */
    PConf.badgeResolvers.register('rgbSwatch', function (S, env, args) {
        if (!rgbControl || !args || !args.key) { return null; }
        var hex = rgbControl.rgbHex(rgbControl.parseRgb(S ? S[args.key] : null,
            {defaultValue: args.defaultValue}));
        // The readout is aria-hidden (it is a preview, and its hex would be read out a
        // character at a time), so ariaNote stays the announcement of the colour — the
        // same string now printed on the row and above the sheet's sliders.
        return {label: 'Edit', ariaNote: hex, chip: hex};
    });

    // Reset-to-defaults for the whole status-bar card (the inline text button closing the
    // Status slots tab's intro — schema-gates.js introAction): every slot of every bar back to its
    // platform-aware default (the same statusSlotDefault seed a fresh install gets,
    // hrDefaults flavor included), and every other covered key back to ITS SCHEMA
    // DEFAULT, resolved through the engine — no value is mirrored here, because
    // mirrored literals drift when the schema changes: the wind arrow's hardcoded
    // false outlived the schema flipping it to true, and the non-uniform "Show
    // unit" defaults only ever escaped the same fate because a test pinned them.
    // Covered alongside the slots: the master Bold row, each kind's Bold mode
    // (their sheets carry no reset of their own), the per-kind display options
    // (the temp slot's Temp/Feels/Both and the day-max kinds' Now/Alert/Both pills
    // with the rows shaping their pair and UV's tomorrow mark, the wind/gust
    // direction arrows), the date formats and the Show-unit toggles
    // (the Alert levels group's own reset deliberately covers only the levels),
    // each weather kind's slot Highlight switch (a slot-sheet row, like Bold — a
    // goal kind's rides its Goals header and that group's reset), each bar's two Alerts
    // sides (on-demand.js DEFAULTS' eight side lists — each bar's read-only Alerts row in
    // this card shows them; the Alerts tab's reset restores them too), and, on aplite
    // only (a watch without On demand), the Watch Status Bar's other rows: 'Show battery
    // below 10%' (batteryLowOnly), the quiet-time icon (showQt), the bluetooth vibration
    // (vibe) and icon (btIcons) — elsewhere those keys belong to the Alert settings card.
    // Deliberately untouched: thresholds, colors, warn looks and scale maxes (every sheet
    // has its own reset button), the On demand items' own settings (the Alert settings
    // card's reset, resetOnDemand below), and the countdown companion dates (inert once a
    // slot leaves 'countdown'). Silent beyond the re-render, like resetThresholds above —
    // the engine has no shared toast for [data-action] buttons.
    /**
     * @param {*} arg Unused (the engine passes the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (env.hr picks the health-bar flavor).
     * @param {function(string): *} defaultOf The engine's stored-shape schema
     *     default resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetStatusSlots = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf) { return false; }
        var slotKeys = statusLineCatalog.allSlotKeys();
        for (var i = 0; i < slotKeys.length; i++) {
            S[slotKeys[i]] = statusLineCatalog.slotDefault(slotKeys[i], env);
        }
        var schemaKeys = ['statusBoldAll', 'tempSlotDisplay',
            // How the temp slot prints its pair in Both mode (separator preset,
            // custom separator text, spacing, which value leads).
            'tempSlotSeparator', 'tempSlotSeparatorCustom', 'tempSlotSeparatorSpaced',
            'tempSlotOrder',
            'dateSlotMonthFormat',
            'windSlotDirection', 'gustSlotDirection']
            // ...and every day-max kind's mode, pair and tomorrow-mark rows (UV,
            // wind, gusts, AQI), from the catalog's one table.
            .concat(statusLineCatalog.dayMaxSettingKeys());
        // The Watch Status Bar's own toggles exist only where On demand does not.
        if (env && env.onDemand === false) {
            schemaKeys.push('batteryLowOnly', 'showQt', 'vibe', 'btIcons');
        }
        // Every bar's On demand sides: the items placed there.
        schemaKeys = schemaKeys.concat(onDemandListKeys());
        // dateSlotFullFormat is the one key here whose fresh-install value is
        // COUNTRY-derived, not the schema default: the wizard writes
        // mapCountry().dateSlotFullFormat ('slash' for US installs). Resetting
        // it through defaultOf would hand a US install the dotted '09.07.26'
        // no fresh install ever shows — so it resets through the same
        // derivation the wizard applies (country-defaults.js, the one home
        // for that rule).
        S.dateSlotFullFormat = CD.mapCountry(S.holidayCountry).dateSlotFullFormat;
        // The six "Show unit" keys come from the catalog's table — the same
        // list the baker and renderSignature derive from.
        for (var u = 0; u < statusLineCatalog.UNIT_TOGGLES.length; u++) {
            schemaKeys.push(statusLineCatalog.UNIT_TOGGLES[u].key);
        }
        for (var k = 0; k < thresholds.KINDS.length; k++) {
            var kd = thresholds.KINDS[k];
            schemaKeys.push('thresh' + kd.key + 'BoldMode');
            if (thresholds.isWeatherKind(kd)) { schemaKeys.push('thresh' + kd.key + 'On'); }
        }
        for (var n = 0; n < schemaKeys.length; n++) {
            S[schemaKeys[n]] = defaultOf(schemaKeys[n]);
        }
        return true;
    };

    /**
     * The eight side lists (on-demand.js itemsKey), in BARS × SIDES order: where each item
     * shows, which both resets restore.
     * @returns {string[]} The keys.
     */
    function onDemandListKeys() {
        var keys = [];
        for (var b = 0; b < onDemand.BARS.length; b++) {
            for (var sd = 0; sd < onDemand.SIDES.length; sd++) {
                keys.push(onDemand.itemsKey(onDemand.BARS[b].bar, onDemand.SIDES[sd]));
            }
        }
        return keys;
    }

    // Reset-to-defaults for the Alert settings card (the inline text button closing its intro
    // on the Alerts tab — alerts-schema.js ON_DEMAND_INTRO): the items' own settings back to their
    // schema defaults, via the engine's resolver like resetStatusSlots above — the Battery
    // item's warn level and Look, the Bluetooth item's Show and vibration, the rain alert's
    // window and look, each metric alert's Look, Days and tomorrow mark (the contract's
    // ALERT_KINDS, the five the card lists) — and where each item shows: the eight side
    // lists its sheets' Shows on grids write (the status card's reset restores those too, as
    // its bars' Alerts rows show them). Deliberately untouched: the levels, warn looks and
    // colours (each sheet's Alert levels header has its own reset, which also serves the
    // slots' highlight).
    /**
     * @param {*} arg Unused (the engine passes the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused).
     * @param {function(string): *} defaultOf The engine's stored-shape schema
     *     default resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetOnDemand = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf) { return false; }
        var keys = ['batteryLowLevel', 'batteryLowDisplay', 'btIcons', 'vibe',
            'rainCountdownHorizon', 'rainAlertDisplay'];
        for (var k = 0; k < thresholds.ALERT_KINDS.length; k++) {
            var stem = thresholds.ALERT_KINDS[k].key;
            keys.push('alert' + stem + 'Display', 'alert' + stem + 'Days',
                'alert' + stem + 'NextDayMark');
        }
        keys = keys.concat(onDemandListKeys());
        for (var n = 0; n < keys.length; n++) {
            S[keys[n]] = defaultOf(keys[n]);
        }
        return true;
    };

    /**
     * The warn pip of a threshold badge, in the watch's own language: the kind's
     * warn look decides the shape — no pip for 'none' (the watch draws no box at
     * warn), a ring for 'outline', a filled dot for 'fill' — painted in the warn
     * colour (the theme text colour while it is auto). The look is the contract's
     * resolution (warnLookFor), so an unset key previews the platform default.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (env.color picks the default look).
     * @param {string} stem Kind key stem, e.g. 'Uv'.
     * @returns {?{color: string, ring: (boolean|undefined)}} The pip, or null for none.
     */
    function warnPip(S, env, stem) {
        var look = thresholds.warnLookFor(S, stem, env ? env.color : undefined);
        if (look === 'none') { return null; }
        var color = thresholdDisplayColor(S, stem, 'Warn', env);
        if (color === null) { return null; }
        return look === 'outline' ? {color: color, ring: true} : {color: color};
    }

    /**
     * The badge dots of an enabled kind: the warn pip (warnPip — absent for the
     * 'none' look) then the danger dot (danger always fills).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {string} stem Kind key stem.
     * @returns {Object[]} Ordered dot list.
     */
    function levelDots(S, env, stem) {
        var pip = warnPip(S, env, stem);
        var danger = {color: thresholdDisplayColor(S, stem, 'Danger', env)};
        return pip ? [pip, danger] : [danger];
    }

    /**
     * The pencil badge of one threshold kind's slot: the warn pip + danger-color
     * dot (levelDots) while the kind's highlight is ENABLED (the contract's
     * kindConfig — the rule the watch actually packs with), plus the bold 'B'.
     * (The Alert settings card's rows badge the alert instead — alerts-page.js
     * alertLevelBadge, with the same levelDots.)
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (callers gate on env.thresholds; env.color
     *     picks the default warn look).
     * @param {number} kindIndex Index into the contract's KINDS.
     * @returns {Object} Badge state for the engine's editBadgeFrom.
     */
    function penStateForKind(S, env, kindIndex) {
        var key = thresholds.KINDS[kindIndex].key;
        var enabled = thresholds.kindConfig(S, kindIndex).enabled;
        // EFFECTIVE always-bold, not the stored ladder alone: the Watch-tab
        // master row packs every kind's bold cell as always at wire time
        // (status-wire.js buildSettingsBlob) without touching the stored
        // per-kind values, and the badge previews what the watch will
        // actually render — so the master lights every slot's B.
        var boldAlways = (S.statusBoldAll === 'all'
            || S['thresh' + key + 'BoldMode'] === 'always');
        var notes = [];
        if (enabled) { notes.push('highlighting on'); }
        if (boldAlways) { notes.push('always bold'); }
        return {
            // The sheet-trigger BUTTON label. The slot sheet configures the whole
            // slot (bold + thresholds), not just the warn/goal pair, so the button
            // says what it does rather than naming one section.
            // A disabled kind still gets the labeled button — it just badges no
            // dots and adds no aria note, since there is no state to preview.
            label: 'Edit',
            ariaNote: notes.join(', '),
            bold: boldAlways,
            // The watch's own language: warn in its look, danger FILLED.
            dots: enabled ? levelDots(S, env, key) : []
        };
    }

    // Pencil badge (engine item.editBadgeFrom): when the slot's current value is an
    // ENABLED threshold kind, the pencil gains a warn-color ring + danger-color dot,
    // and a 'B' when the slot prints always-bold. Same env gate + code→kind mapping
    // as the sheet resolver above.
    PConf.badgeResolvers.register('thresholdPenState', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < thresholds.KINDS.length; i++) {
            if (thresholds.KINDS[i].code === code) { return penStateForKind(S, env, i); }
        }
        return null;
    });

    /**
     * The layout preset's hint for 'Weather only', whose Default view differs per radar
     * mode (view-cycle.js buildViewCycle): the schema's text for the stored radarMode,
     * an absent one read as the radio's default ('graph'). Every other preset answers
     * null, so its row keeps the static hintByValue.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, byRadar: Object}} args The row's shown preset + the
     *     per-radarMode texts (schema.js).
     * @returns {?string} The hint, or null for the static one.
     */
    function weatherOnlyHint(S, env, args) {
        if (!args || args.value !== 'weatherOnly' || !args.byRadar) { return null; }
        var mode = (S && S.radarMode) || 'graph';
        var text = args.byRadar[mode];
        if (!text) { return null; }
        // "Flick to health" only while a Health view exists to flick to: the health
        // bar or graph (healthMode 'status' / 'all', the schema default) on a watch
        // with health sensors. 'slot' puts health in the status slots and adds no view,
        // so the Weather-only cycle is then its Default view alone (view-cycle.js).
        var healthMode = (S && S.healthMode) || 'all';
        var flick = (healthMode === 'status' || healthMode === 'all')
            && !(env && env.health === false);
        return flick ? text + ' Flick to health.' : text;
    }
    PConf.hintResolvers.register('weatherOnlyHint', weatherOnlyHint);

    var viewCycleLib = (typeof require !== 'undefined')
        ? require('../view-cycle.js') : window.VIEW_CYCLE;

    // layoutPreset options resolver: compactDense is offered once EITHER a health
    // status row OR any radar view is capable — the same radarRow/healthRow gates the
    // compiler, the editor and the sheet gates fold by (view-cycle.js capabilities;
    // both radar modes build dense radar cycles since the CAL2_RF_D/CAL2_HR_D fold).
    // Custom is offered on every non-aplite platform (aplite is frozen-lean and folds
    // custom to compactCal on the wire; a stored 'custom' lies dormant there —
    // dormantValues). Unknown platform ('' when watchInfo is missing) is treated as
    // capable, matching the payload's own gate.
    PConf.optionsResolvers.register('layoutPresetOptions', function (S, env) {
        var base = [['Full calendar', 'fullCal'], ['Compact calendar', 'compactCal']];
        var caps = viewCycleLib.capabilities(S);
        if (caps.radarRow || caps.healthRow) {
            base.push(['Compact calendar (dense)', 'compactDense']);
        }
        base.push(['No calendar', 'noCal']);
        // Weather only and Custom need a view without top bar (and Weather only the
        // radar): not on aplite, where a stored value lies dormant (dormantValues).
        if (!env || env.platform !== 'aplite') {
            base.push(['Weather only', 'weatherOnly']);
            base.push(['Custom (Beta)', 'custom']);
        }
        return base;
    });

    // Entering Custom seeds the per-view keys ONCE from the preset being left, so the
    // editor opens showing exactly what the watch shows and an untouched session
    // compiles back byte-identical (nothing transmits). Re-picking a preset later
    // leaves the keys stored (dormant) — re-entering Custom restores the user's work.
    // Seeding is ALL the pick does: the editor opens only through the dedicated Edit
    // row (the schema's data-action="openViewEditor" button), never automatically.
    PConf.onChange.register('layoutPresetChanged', function (S, oldValue, newValue) {
        if (newValue !== 'custom') { return; }
        viewCycleLib.seedCustomKeys(S, oldValue);
    });

    // Platform-aware slot default (Approach A single-source): a status slot's fresh-install
    // default comes from the catalog, HR-aware. Consumed by engine.hydrate / resolveRowItem
    // via item.defaultFrom. Mirrors the statusSlot options resolver above.
    PConf.defaultsResolvers.register('statusSlotDefault', function (env, args) {
        return statusLineCatalog.slotDefault(args.slotKey, env);
    });

    PConf.defaultsResolvers.register('todayDate', function () {
        return PConf.engine.formatDateValue(new Date());
    });

    // ---- rate-limit info blocks (tomorrow.io, Rainbow own key) + budget-guard interval resolver ----

    /**
     * A whole number with thousands commas ("5,000"), formatted by hand:
     * Number.prototype.toLocaleString is unreliable in old Android WebViews.
     *
     * @param {number} n Non-negative integer.
     * @returns {string} The number with a comma every three digits.
     */
    function withThousands(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * The derived sleep->cadence unlock line for a budget module, or ''. Names the
     * fastest ladder step that does NOT fit at the current pause, and the pause that
     * would unlock it — only when some pause can, and it is longer than the current one.
     *
     * @param {Object} B Budget module (INTERVAL_LADDER/fits/minSleepHoursFor).
     * @param {Object} state Settings state.
     * @param {number} sleep Current night pause in hours.
     * @param {string} qualifier Text after "N-minute updates" (e.g. ' with radar'), or ''.
     * @returns {string} '<br>…' or ''.
     */
    function unlockRuleHtml(B, state, sleep, qualifier) {
        for (var i = 0; i < B.INTERVAL_LADDER.length; i += 1) {
            var min = parseInt(B.INTERVAL_LADDER[i][1], 10);
            if (!B.fits(state, min)) {
                var need = B.minSleepHoursFor(state, min);
                if (need !== null && need > sleep) {
                    return '<br>' + min + '-minute updates' + qualifier
                        + ' need a night pause of ≥ ' + need + ' h — widen the pause to unlock faster updates.';
                }
                return '';
            }
        }
        return '';
    }

    /**
     * The interval a budget read-out computes with: the one Save will store (interval-budget.js
     * fitInterval), not the raw stored value. With a "Fit update interval" guard on, a stored
     * interval the budget no longer affords (radar picked on the Radar tab, the interval set on
     * General) is replaced at Save; warning "over budget" about it would contradict the toggle.
     *
     * @param {Object} state Settings state.
     * @returns {number} Minutes.
     */
    function readoutInterval(state) {
        return parseInt(intervalBudget.fitInterval(state, state.fetchIntervalMin), 10) || 15;
    }

    /**
     * Rate-limit info block under the tomorrow.io key field: free-tier limits,
     * the user's projected usage at the current settings, a ✓/✗ verdict, the
     * derived sleep->cadence unlock rule, and (near the hourly ceiling) a
     * same-hour-save heads-up. Recomputes on every render, so it reacts to
     * fetchIntervalMin / sleep window / provider / radarProvider / guard changes.
     *
     * @param {Object} state Settings state.
     * @param {Object} env Platform env (unused).
     * @returns {string} Block HTML, or '' when no tomorrow.io budget is in play.
     */
    function tomorrowioBudgetBlock(state, env) {
        var B = tomorrowioBudget;
        var cpc = B.callsPerCycle(state);
        if (cpc === 0) { return ''; }
        var interval = readoutInterval(state);
        var sleep = B.sleepHours(state);
        var daily = Math.round(B.dailyCalls(state, interval));
        var ok = B.fits(state, interval);
        // radarOn is specifically "does tomorrow.io radar add calls" — NOT whether radar
        // is enabled at all. A user can run weather on tomorrow.io while radar stays on
        // another provider (Rainbow by default), so only mention radar when it actually
        // counts against this budget; never print "radar off" (it reads as "radar disabled").
        var radarOn = state.radarProvider === 'tomorrowio' && (state.radarMode || 'graph') !== 'off';
        var settingsBits = 'every ' + interval + ' min, '
            + (sleep > 0 ? 'night pause ' + sleep + ' h' : 'no night pause')
            + (radarOn ? ', incl. radar' : '');
        var verdict = ok
            ? '<b>~' + daily + ' calls/day ✓</b>'
            : '<b style="color:#FF6A52">~' + daily + ' calls/day ✗ over budget</b>';
        var html = '<b>Free plan: ' + B.LIMIT_DAY + ' calls/day, ' + B.LIMIT_HOUR + '/hour.</b> '
            + 'Your settings: ' + settingsBits + ' → ' + verdict + '.';
        html += unlockRuleHtml(B, state, sleep, radarOn ? ' with radar' : '');
        if (B.hourlyCalls(state, interval) >= B.LIMIT_HOUR - 1) {
            html += '<br>At this rate a settings-save refetch in the same hour may delay one cycle — harmless.';
        }
        // Return bare content: the engine's renderBlock wraps this in .blockrow, which
        // already supplies padding, colour and its own bottom divider. Wrapping in .static
        // here would nest a second bordered/padded row and paint a stray divider line.
        return html;
    }
    PConf.blocks.register('tomorrowioBudget', tomorrowioBudgetBlock);

    /**
     * Tomorrow.io's usage on the key status line under the Weather provider row
     * (key-status.js, the source's `usage`): the calls a day the current settings come to,
     * the read-out's own figure, against the free plan's daily limit — "~96 of 500 calls a
     * day". A projection: the phone does not count the calls it makes.
     * @param {Object} state Settings state.
     * @returns {?string} The line, or null when no tomorrow.io call is made.
     */
    function tomorrowioUsageLine(state) {
        var B = tomorrowioBudget;
        if (B.callsPerCycle(state) === 0) { return null; }
        return '~' + Math.round(B.dailyCalls(state, readoutInterval(state))) + ' of ' + B.LIMIT_DAY + ' calls a day';
    }
    if (keyStatus) { keyStatus.registerUsage('tomorrowio', tomorrowioUsageLine); }

    /**
     * Monthly-usage info block under the Rainbow API key field ("Rainbow (own key)"'s key
     * sheet): the free plan's monthly ceiling, the user's projected month at the
     * current settings, a ✓/✗ verdict and the derived sleep->cadence unlock rule. Unlike tomorrow.io's block
     * there is no "with radar" qualifier (every Rainbow call is a radar call) and no
     * hourly heads-up (Rainbow documents no hourly limit). Recomputes on every render.
     *
     * @param {Object} state Settings state.
     * @param {Object} env Platform env (unused).
     * @returns {string} Block HTML, or '' when no own-key Rainbow budget is in play.
     */
    function rainbowBudgetBlock(state, env) {
        var B = rainbowBudget;
        if (B.callsPerCycle(state) === 0) { return ''; }
        var interval = readoutInterval(state);
        var sleep = B.sleepHours(state);
        var monthly = Math.round(B.monthlyCalls(state, interval));
        var settingsBits = 'every ' + interval + ' min, '
            + (sleep > 0 ? 'night pause ' + sleep + ' h' : 'no night pause');
        // "5,000" like the hints around this read-out (RAINBOW_KEY_HINT, RAINBOW_BUDGET_HINT).
        var verdict = B.fits(state, interval)
            ? '<b>~' + withThousands(monthly) + ' calls/month ✓</b>'
            : '<b style="color:#FF6A52">~' + withThousands(monthly) + ' calls/month ✗ over budget</b>';
        // Bare content, no .static wrapper: same .blockrow rule as tomorrowioBudgetBlock.
        return '<b>Free plan: ' + withThousands(B.LIMIT_MONTH) + ' calls/month.</b> '
            + 'Your settings: ' + settingsBits + ' → ' + verdict + '.'
            + unlockRuleHtml(B, state, sleep, '');
    }
    PConf.blocks.register('rainbowBudget', rainbowBudgetBlock);

    /**
     * Rainbow's usage on the key status line under the Radar provider row (key-status.js,
     * the "Rainbow (own key)" source's `usage`): the calls a month the current settings
     * come to, the read-out's own figure, against the free plan's monthly limit — "~2,976
     * of 5,000 calls a month". A projection: the phone does not count the calls it makes.
     * @param {Object} state Settings state.
     * @returns {?string} The line, or null when no call is billed to the user's key.
     */
    function rainbowUsageLine(state) {
        var B = rainbowBudget;
        if (B.callsPerCycle(state) === 0) { return null; }
        return '~' + withThousands(Math.round(B.monthlyCalls(state, readoutInterval(state))))
            + ' of ' + withThousands(B.LIMIT_MONTH) + ' calls a month';
    }
    if (keyStatus) { keyStatus.registerUsage('rainbow', rainbowUsageLine); }

    // Update-interval ladder for fetchIntervalMin: the entries that fit every active
    // budget guard (tomorrow.io, Rainbow own key) — the intersection. A guard is active
    // while its "Fit update interval" toggle is on and its provider makes calls; with
    // none active (or its toggle off) the full ladder passes through, and the info
    // block shows the red warning instead. If the stored interval drops out, the
    // engine's resolveRowItem snaps it to the item default ('15') — but only while the
    // row renders (General tab), so onbuild.js's onSubmit applies the same fit, from the
    // same interval-budget.js, at save time for a change made on another tab (the radar
    // provider/mode, on the Radar tab).
    PConf.optionsResolvers.register('fetchIntervalBudget', function (S) {
        return intervalBudget.fittingOptions(S || {});
    });

    // "(Recommended)" markers on the weather + radar provider dropdowns: the option matching the
    // country-derived best pick (holidayCountry, the wizard's own source) is flagged. Same mapping
    // the wizard applies on a fresh install, so the dropdown hint and the wizard can't disagree.
    // A country's Rainbow pick is 'rainbow', "Rainbow (limited)": the radar that needs no key.
    PConf.recommendResolvers.register('recommendedWeatherProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).provider;
    });
    PConf.recommendResolvers.register('recommendedRadarProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).radarProvider;
    });

    /**
     * The amber note under the Radar provider row (its staticText's textFrom): the picked
     * source's missing key (key-status.js keyMissingNote), else — for DWD or Met.no — the
     * last update's location outside that source's area, or for DWD inside it with no
     * radar data from DWD (its 404s in a row) (radar-coverage.js note, from the phone's
     * record userData.radarCoverage). '' when neither: no note.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{picker: string}} args The picker's key ('radarProvider'), for keyMissingNote.
     * @returns {string} The note (plain text), or ''.
     */
    function radarProviderNote(S, env, args) {
        var ud = (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
        return keyStatus.keyMissingNote(S, env, args)
            || radarCoverage.note((S || {}).radarProvider, ud.radarCoverage);
    }
    PConf.hintResolvers.register('radarProviderNote', radarProviderNote);

    // What the Alerts tab's resolvers (alerts-page.js, which loads after this file) read
    // from the threshold machinery above: a kind's slider geometry, for the unit a metric
    // alert's levels print in, and the badge dots the slot pencil draws, which an alert's
    // card row draws too.
    PConf.thresholdLevels = {rangeOf: rangeOf, levelDots: levelDots};

    // ---- The Graphs tab's line rows and dialogs ----

    // The graph metrics and line styles in picker order, as the line pickers offer them
    // (forecast-hints.js, which loads ahead of this file in both contexts): a line's
    // summary names its metric and style by the labels its pickers show.
    var FORECAST_METRICS = PConf.forecastLineOptions.metrics;
    var LINE_STYLE_OPTIONS = PConf.forecastLineOptions.styles;

    /**
     * The label a picker shows for a value.
     * @param {Array<Array<string>>} options [label, value] pairs.
     * @param {*} value The value.
     * @returns {?string} Its label, or null when no option carries it.
     */
    function optionLabel(options, value) {
        for (var i = 0; i < (options || []).length; i++) {
            if (options[i][1] === String(value)) { return options[i][0]; }
        }
        return null;
    }

    /**
     * A forecast line's nav-row summary: its metric and style by the labels their pickers
     * show, ", filled" for the Main metric's area fill — "Precipitation % · Thin line,
     * filled" — or "Off". The style is the one the watch draws (line-style.js
     * lineStyleValue: a stored stripe on a metric that cannot be one draws as a line), and
     * a watch without style pickers (env.lineStyles false) names the metric alone.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{lineKey: string, main: boolean}} args The line's picker key; whether it is
     *     the Main metric (the one line that fills).
     * @returns {string} The summary.
     */
    function lineSummary(S, env, args) {
        var st = S || {}, a = args || {};
        var metric = st[a.lineKey];
        if (!metric || metric === 'off') { return 'Off'; }
        var name = optionLabel(FORECAST_METRICS, metric) || String(metric);
        if (env && env.lineStyles === false) { return name; }
        var style = lineStyle.lineStyleValue(st, a.lineKey + 'Style');
        var text = name + ' · ' + (optionLabel(LINE_STYLE_OPTIONS, style) || style);
        var fills = a.main && st.secondaryLineFill !== false && !lineStyle.isTempAxisMetric(metric)
            && !lineStyle.isStripeValue(style);
        return fills ? text + ', filled' : text;
    }
    PConf.hintResolvers.register('lineSummary', lineSummary);

    /**
     * A forecast line's colour swatch. On its nav row: the line colour of its metric in
     * the theme being edited, one dot. On the colours row in its dialog (args.all), which
     * opens the same sheet as the metric's Graph colors row: that row's whole preview, one
     * dot per picker (graphColorSwatch). None for a line that is off, on a B&W watch or
     * theme.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{lineKey: string, all: (boolean|undefined)}} args The line's picker key;
     *     whether to preview every colour of the metric's sheet.
     * @returns {?Object} Badge state, or null.
     */
    function lineSwatch(S, env, args) {
        var st = S || {};
        var metric = st[(args || {}).lineKey];
        if (!lineStyle || !env || !env.color || !metric || metric === 'off') { return null; }
        if (st.theme === 'bw' || st.theme === 'bw-light') { return null; }
        if (args.all) { return PConf.badgeResolvers.get('graphColorSwatch')(st, env, {scope: metric}); }
        var sfx = lineStyle.renderContextFor(st, {color: true, themePolarity: true}).suffix;
        var color = colorHexOf(st[lineStyle.graphColorKey(metric, 'Line', sfx)],
            lineStyle.graphColorDefault(metric, 'Line', sfx, st));
        return {label: 'Edit', dots: [{color: color}]};
    }
    PConf.badgeResolvers.register('lineSwatch', lineSwatch);

    /**
     * The colours row in a line's dialog opens the Graph colors sheet of the metric the
     * line draws (args.sheets: schema.js GRAPH_COLOR_SHEETS); none for a line that is off.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, sheets: Object}} args The line's picker key and the
     *     metric → sheet table.
     * @returns {?string} The sheet id, or null.
     */
    function lineColorSheet(S, env, args) {
        var a = args || {};
        var entry = (a.sheets || {})[(S || {})[a.messageKey]];
        return entry ? entry.sheetId : null;
    }
    PConf.sheetResolvers.register('lineColorSheet', lineColorSheet);

    /**
     * That row's label: "<Metric> colors", the title of the sheet it opens.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{lineKey: string, sheets: Object}} args As lineColorSheet.
     * @returns {?string} The label, or null for the static one.
     */
    function lineColorLabel(S, env, args) {
        var a = args || {};
        var entry = (a.sheets || {})[(S || {})[a.lineKey]];
        return entry ? entry.label + ' colors' : null;
    }
    PConf.hintResolvers.register('lineColorLabel', lineColorLabel);

    /**
     * Whether the page draws in colour: a colour watch under a colour theme.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function colorThemeOn(S, env) {
        var theme = (S || {}).theme;
        return Boolean(env && env.color !== false) && theme !== 'bw' && theme !== 'bw-light';
    }

    /**
     * The Bars row's info text: what the bars show, then how they scale — the colour
     * note on a colour theme, the B&W legend otherwise (args, schema.js SCALE_NOTE /
     * BW_LEGEND). Only while the bars are on; null (the row's hintByValue) otherwise.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{value: string, colorNote: string, bwNote: string}} args The row's value
     *     and the two notes.
     * @returns {?string} The hint, or null.
     */
    function barScaleHint(S, env, args) {
        var a = args || {};
        if (a.value !== 'rain') { return null; }
        return 'Adds bars that represent the rain amount in one hour. '
            + (colorThemeOn(S, env) ? a.colorNote : a.bwNote);
    }
    PConf.hintResolvers.register('barScaleHint', barScaleHint);

    /**
     * The Radar color row's info text: the colour's own words (args.hints), then the bar
     * scale note.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, hints: Object, note: string}} args The row's value, its
     *     per-value hints and the note.
     * @returns {string} The hint.
     */
    function radarColorHint(S, env, args) {
        var a = args || {};
        var own = (a.hints || {})[a.value] || '';
        return own ? own + '<br>' + a.note : a.note;
    }
    PConf.hintResolvers.register('radarColorHint', radarColorHint);

    /**
     * A weather alert's levels slider's info text: its scale hint (args.hint) and the card
     * on its default levels for the unit or AQI scale in effect (args.cards, schema.js
     * ALERT_LEVEL_CARDS: each card's showWhen picks it, the same predicates the cards
     * carried as their own rows).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{hint: string, cards: Array<{text: string, showWhen: (Object|undefined)}>}} args
     * @returns {?string} The hint, or null for the static one.
     */
    function levelInfo(S, env, args) {
        var a = args || {}, ctx = Object.assign({}, S || {}), parts = [], i;
        ctx.env = env || {};
        if (a.hint) { parts.push(a.hint); }
        for (i = 0; i < (a.cards || []).length; i++) {
            if (!a.cards[i].showWhen || PConf.showWhen.evaluate(a.cards[i].showWhen, ctx)) {
                parts.push(a.cards[i].text);
                break;
            }
        }
        return parts.length ? parts.join('<br>') : null;
    }
    PConf.hintResolvers.register('levelInfo', levelInfo);

    // Reset-to-defaults for EVERY graph colour (the Graph colors dialog's link): each
    // metric's sheet keeps its own reset (resetGraphColors, its key list in the button's
    // arg); this one walks the full key set line-style.js hands out, so it cannot miss a
    // row the schema adds. Each key lands on its schema default through the engine.
    /**
     * @param {string} arg Unused.
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused).
     * @param {function(string): *} defaultOf The engine's stored-shape default resolver.
     * @returns {boolean} true so the engine re-renders.
     */
    PConf.actions.resetAllGraphColors = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf || !lineStyle) { return false; }
        var scopes = FORECAST_METRICS.map(function (m) { return m[1]; }).concat(['night']);
        scopes.forEach(function (scope) {
            lineStyle.graphColorRoles(scope).forEach(function (role) {
                ['Dark', 'Light'].forEach(function (sfx) {
                    var key = lineStyle.graphColorKey(scope, role, sfx);
                    var d = defaultOf(key);
                    if (typeof d !== 'undefined') { S[key] = d; }
                });
            });
        });
        return true;
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            radarProviderNote: radarProviderNote,
            lineSummary: lineSummary,
            lineSwatch: lineSwatch,
            lineColorSheet: lineColorSheet,
            lineColorLabel: lineColorLabel,
            barScaleHint: barScaleHint,
            radarColorHint: radarColorHint,
            levelInfo: levelInfo,
            tomorrowioBudgetBlock: tomorrowioBudgetBlock,
            tomorrowioUsageLine: tomorrowioUsageLine,
            rainbowBudgetBlock: rainbowBudgetBlock,
            rainbowUsageLine: rainbowUsageLine,
            thresholdRangeCfg: thresholdRangeCfg
        };
    }
    // Under Node, requiring this file registers the Alerts tab's resolvers too, as it does
    // the preview blocks and the when resolvers (top of the file). Unlike those, they read
    // PConf.thresholdLevels while their own body runs, so they load here, after it is set.
    // The webview concatenates alerts-page.js right after this file instead.
    if (typeof require !== 'undefined') {
        require('./alerts-page.js');
    }
})();

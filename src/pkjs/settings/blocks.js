// src/pkjs/settings/blocks.js — ES5, WebView. WarnWeather's threshold-sheet
// machinery (ranges, auto colors, the toggle/outline hooks, the two reset
// actions, the sheet/badge resolvers) and the small option/default/recommend
// resolvers. The BLOCK RENDERERS live one file per concern —
// preview-forecast.js, preview-radar.js, preview-diagnostics.js and
// preview-layout.js, over the shared preview-svg.js / preview-rain.js; under Node
// this file requires the four registering ones, so requiring blocks.js registers
// every block and not just its own (the webview concatenates every file instead —
// see scripts/build-config-page.js APP_FILES).
/* global PConf, COUNTRY_DEFAULTS */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
if (typeof require !== 'undefined') {
    require('./preview-forecast.js');
    require('./preview-radar.js');
    require('./preview-diagnostics.js');
    require('./preview-layout.js');
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
    // The page bundle's single-source int<->hex (config-ui/lib/color.js, concatenated
    // ahead of every app file), rather than a fourth local copy of the same six digits.
    var intToHex = (typeof require !== 'undefined')
        ? require('../config-ui/lib/color.js').intToHex : PConf.color.intToHex;
    // The rgb control's own value helpers (config-ui/lib/range-control.js, likewise
    // concatenated ahead of the app files): a badge previewing an rgb key parses the
    // stored "r,g,b" string with the same parser — fallbacks included — as the sliders
    // behind it, so the dot cannot show a colour the sheet would not open on.
    var rangeControl = (typeof require !== 'undefined')
        ? require('../config-ui/lib/range-control.js') : PConf.rangeControl;

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

    // The eight graph metrics in picker order — one list feeds every forecast picker.
    var FORECAST_METRICS = [
        ['Precipitation %', 'precip_prob'], ['Cloud cover %', 'cloud'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'],
        ['UV Index', 'uv'], ['Air pressure (hPa)', 'pressure'], ['Feels-like temperature', 'feels'],
        ['Dew point', 'dew']
    ];
    // Metric picker options, shaped by self-describing args from the schema:
    // `off` leads with an Off row, `exclude` names the sibling picker keys
    // whose CURRENT pick is withheld (a collision left in a stored value is
    // display-snapped by the engine — a later pick turns the later line off).
    // Every picker offers the temperature-axis metrics (feels, dew) — each line
    // has its own curve-inset byte — except on aplite: the temp-axis line inset
    // is not compiled there, so they would render misaligned with the
    // temperature curve.
    PConf.optionsResolvers.register('forecastMetric', function (S, env, args) {
        var a = args || {};
        var exclude = a.exclude || [];
        var out = a.off ? [['Off', 'off']] : [];
        for (var i = 0; i < FORECAST_METRICS.length; i += 1) {
            var opt = FORECAST_METRICS[i];
            if (lineStyle.isTempAxisMetric(opt[1])
                && env && env.platform === 'aplite') { continue; }
            var taken = false;
            for (var j = 0; j < exclude.length; j += 1) {
                if (S && opt[1] === S[exclude[j]]) { taken = true; break; }
            }
            if (!taken) { out.push(opt); }
        }
        return out;
    });

    // The six line styles in picker order — line-style.js' LINE_STYLE_KINDS vocabulary.
    var LINE_STYLE_OPTIONS = [
        ['Thin line', 'line'], ['Thick line', 'bold'], ['Square dots', 'dots'], ['× marks', 'x'],
        ['Stripe at top', 'stripeTop'], ['Stripe at bottom', 'stripeBottom']
    ];
    // One line's style options: the two stripes only while the line's metric can be
    // one (line-style.js metricAllowsStripe — the rule the bake resolves by), so the
    // engine's display-snap shows a stored stripe on any other metric as the style the
    // watch actually draws. args.metricKey names the metric picker it sits under.
    PConf.optionsResolvers.register('lineStyleOptions', function (S, env, args) {
        var metric = S ? S[(args || {}).metricKey] : undefined;
        if (lineStyle.metricAllowsStripe(metric)) { return LINE_STYLE_OPTIONS.slice(); }
        var out = [];
        for (var i = 0; i < LINE_STYLE_OPTIONS.length; i += 1) {
            if (!lineStyle.isStripeValue(LINE_STYLE_OPTIONS[i][1])) { out.push(LINE_STYLE_OPTIONS[i]); }
        }
        return out;
    });

    // ---- The forecast line hints: how a metric's value reads on the graph ----
    // The scale lives on the LINE-STYLE picker, because the style decides how a value
    // is shown: a curve or its marks by HEIGHT, a stripe by COLOUR STRENGTH. The
    // metric pickers keep only notes true of the metric whatever its style — except on
    // a watch without style pickers (env.lineStyles false: aplite, the schema's
    // LINE_STYLES_WHEN gate), where the metric picker adds the height wording, so the
    // scale is explained there too. No hint restates a metric's or a style's name, a
    // default look or 'Off'. The wind scale is named, not placed ("below"): with wind
    // and gusts both picked, its row sits under the first of them only; the pressure
    // scale row always sits below its (single) pressure line.
    var HEIGHT_SCALE = {
        precip_prob: 'Half height = 50% chance of rain, full height = 100%.',
        cloud: 'Half height = half the sky covered, full height = overcast.',
        wind: 'Scaled by the Wind graph scale setting.',
        gust: 'Scaled by the Wind graph scale setting.',
        uv: 'Half height = UV 5.5, full height = UV 11 (extreme).',
        pressure: 'Sea-level pressure, scaled by the pressure graph scale below.',
        feels: 'Drawn on the same scale as the temperature curve.',
        dew: 'Drawn on the same scale as the temperature curve.'
    };
    // A stripe cell's colour strength steps with the value (chart_stripe.h: four
    // levels), so the half/full anchors read as colour instead of height. Keyed by
    // exactly the metrics a stripe can show (line-style.js STRIPE_METRIC_IDS — a test
    // holds the two lists equal).
    var STRIPE_SCALE = {
        precip_prob: 'Half-strength colour = 50% chance of rain, full colour = 100%.',
        cloud: 'Half-strength colour = half the sky covered, full colour = overcast.',
        wind: 'Colour strength follows the Wind graph scale setting.',
        gust: 'Colour strength follows the Wind graph scale setting.',
        uv: 'Half-strength colour = UV 5.5, full colour = UV 11 (extreme).'
    };
    // What the metric picker says whatever the style.
    var METRIC_NOTES = {
        cloud: 'Not available with Yandex.',
        gust: 'The hourly peak.',
        dew: 'The closer it runs to the temperature, the more humid it feels.'
    };
    // What the style adds after its line's scale. Thin and Thick say it all.
    var STYLE_NOTES = {
        dots: 'Aligned to the rain bars.',
        x: 'Aligned to the rain bars.',
        stripeTop: 'One cell per hour.',
        stripeBottom: 'One cell per hour. Below the zero line, where bars and lines never cover it.'
    };

    /**
     * One entry of a copy table, OWN keys only — a stored value like 'constructor'
     * must not print an Object.prototype function.
     * @param {Object} table Copy table.
     * @param {*} key Lookup key.
     * @returns {string} The entry, or '' when absent.
     */
    function copyOf(table, key) {
        return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key))
            ? table[key] : '';
    }

    /**
     * Sentences joined with one space, empty ones dropped.
     * @param {string[]} parts Sentences, '' for none.
     * @returns {string} The hint, '' when every part is empty.
     */
    function joinHint(parts) {
        var out = [];
        for (var i = 0; i < parts.length; i += 1) {
            if (parts[i]) { out.push(parts[i]); }
        }
        return out.join(' ');
    }

    /**
     * A metric picker's hint: the metric's own note, and — only on a watch without
     * style pickers — its height scale after it.
     * @param {string} metric The picker's shown metric (or 'off').
     * @param {Object} [env] Platform env; `lineStyles` truthy = style pickers exist
     *   (the same truthy test as the schema's {env: 'lineStyles'} row gate).
     * @returns {string} The hint, '' for none.
     */
    function forecastMetricHint(metric, env) {
        var note = copyOf(METRIC_NOTES, metric);
        if (env && env.lineStyles) { return note; }
        return joinHint([note, copyOf(HEIGHT_SCALE, metric)]);
    }

    /**
     * A line-style picker's hint: its line's scale as this style shows it, then the
     * style's own note.
     * @param {string} metric The metric of the line this picker styles.
     * @param {string} style The picker's shown style.
     * @returns {string} The hint, '' for none.
     */
    function lineStyleHint(metric, style) {
        if (!metric || metric === 'off') { return ''; }
        return joinHint([copyOf(lineStyle.isStripeValue(style) ? STRIPE_SCALE : HEIGHT_SCALE, metric),
            copyOf(STYLE_NOTES, style)]);
    }

    PConf.hintResolvers.register('forecastMetricHint', function (S, env, args) {
        return forecastMetricHint(args.value, env);
    });
    // args.metricKey names the metric picker this style picker sits under.
    PConf.hintResolvers.register('lineStyleHint', function (S, env, args) {
        return lineStyleHint(S ? S[args.metricKey] : undefined, args.value);
    });

    /**
     * A day-max kind's Now / Alert / Both hint, with the hold level as a number: the
     * kind's resolved warn level (the stored pair, else its seed — the very number
     * status-thresholds holdWarn hands the phone's hold rule) in the unit its slider
     * shows. Re-resolved on every render, so it follows the slider, the General-tab
     * unit pickers and the AQI source/scale with no dependency list — and in place
     * after a keyboard nudge on a thumb, which commits without a render
     * (range-control.js). Now mode gets the kind's lead alone: the hold/mark tail
     * describes rows that mode hides. The warn level and the highlight switch it names
     * live in the kind's Alerts sheet (the slot sheet only points there), so the hint
     * sends the reader "under Alerts" for both; the tomorrow mark is still "below".
     * The page's HTML is raw here (engine renderRow),
     * so only numbers and the range table's unit label are interpolated — the rest is
     * schema copy.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, keyStem: string, subject: string, lead: string,
     *   coda: string}} args The row's shown mode + dayMaxRows' copy parts.
     * @returns {?string} The hint, or null (static fallback) without the contract.
     */
    function dayMaxHint(S, env, args) {
        var contract = thresholdContract();
        var stem = args.keyStem;
        if (!contract || !THRESHOLD_RANGES[stem]) { return null; }
        var coda = args.coda || '';
        if (args.value === 'current') { return args.lead + coda; }
        var pair = contract.resolvedPair(stem, S || {});
        if (typeof pair.warn !== 'number') { return null; }
        var unit = THRESHOLD_RANGES[stem](S || {}).unit;
        var on = Boolean(S) && S['thresh' + stem + 'On'] === true;
        return args.lead + ' Today\'s peak stays on screen while it is still ahead, and while '
            + args.subject + ' ' + pair.warn + (unit ? ' ' + unit : '')
            + ' or higher — the warn level set under Alerts. Under that, tomorrow\'s peak shows'
            + ' instead, marked as chosen below. '
            + (on ? 'Highlighting follows the number shown.'
                : 'Highlighting is off — switch it on under Alerts to color it.')
            + coda;
    }
    // THRESHOLD_RANGES / thresholdContract sit further down this file: both are read at
    // render time, long after this file has loaded.
    PConf.hintResolvers.register('dayMaxHint', dayMaxHint);

    // Per-slot edit sheet: the pencil left of a slot dropdown opens the threshold sheet
    // for the slot's CURRENT value, when that value is a threshold kind. The catalog's
    // slot codes and the threshold contract's KINDS codes are the same vocabulary
    // ('wind', 'aqi', 'steps', ...), so the contract IS the mapping — no hand-copied
    // list to drift. env gate mirrors the sheets' own showWhen (aplite compiles the
    // highlight out). Resolved lazily: in the flat page status-thresholds.js is
    // concatenated AFTER this file, so window.StatusThresholds only exists at render
    // time, not at load time (thresholdContract() below wraps exactly that).
    PConf.sheetResolvers.register('statusSlotEditSheet', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var contract = thresholdContract();
        if (!contract) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < contract.KINDS.length; i++) {
            if (contract.KINDS[i].code === code) { return 'thresh' + contract.KINDS[i].key; }
        }
        return null;
    });

    // --- threshold sliders (the per-slot edit sheets' controls) ------------------

    /**
     * The threshold contract module, resolved lazily for the same concat-order
     * reason statusSlotEditSheet documents above.
     * @returns {?Object} status-thresholds API, or null when unavailable.
     */
    function thresholdContract() {
        return (typeof require !== 'undefined')
            ? require('../status-thresholds.js')
            : (typeof window !== 'undefined' ? window.StatusThresholds : null);
    }

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
    // status-thresholds.js compares against at bake/pack time). Resolved per render
    // so the General-tab unit pickers reshape the scales live. fixedMax marks the
    // naturally-bounded kinds (no inline scale-max editor). The SEED pairs are not
    // here: they live in the contract (status-thresholds.js SEEDS / seedPair) — the
    // one table the phone bake and the day-max hold rule resolve a blank pair
    // against too, so the slider can never preview numbers the watch does not use.
    var THRESHOLD_RANGES = {
        Wind: function (S) {
            if (S.windUnits === 'mph') { return {min: 0, max: 75, step: 5, unit: 'mph'}; }
            if (S.windUnits === 'knots') { return {min: 0, max: 65, step: 5, unit: 'kn'}; }
            return {min: 0, max: 120, step: 5, unit: 'kph'};
        },
        Gust: function (S) {
            if (S.windUnits === 'mph') { return {min: 0, max: 100, step: 5, unit: 'mph'}; }
            if (S.windUnits === 'knots') { return {min: 0, max: 85, step: 5, unit: 'kn'}; }
            return {min: 0, max: 160, step: 5, unit: 'kph'};
        },
        Aqi: function (S) {
            // The European scale applies only when Open-Meteo is the AQI source AND the
            // scale picker says so; WAQI (and auto, which prefers it) reports US-style AQI.
            var eu = S.aqiSource === 'openmeteo' && S.aqiScale !== 'us';
            return eu
                ? {min: 0, max: 150, step: 5, unit: ''}
                : {min: 0, max: 300, step: 10, unit: ''};
        },
        Pollen: function () {
            return {min: 0, max: 3, step: 0.5, unit: '', fixedMax: true};
        },
        Uv: function () {
            // The slot displays the rounded integer index, so whole steps; 12 covers
            // every real-world reading (extremes clamp against the top like any kind).
            return {min: 0, max: 12, step: 1, unit: '', fixedMax: true};
        },
        Steps: function () {
            return {min: 0, max: 20000, step: 250, unit: ''};
        },
        Sleep: function () {
            return {min: 0, max: 12, step: 0.5, unit: 'h', fixedMax: true};
        },
        Distance: function (S) {
            return S.distanceUnits === 'imperial'
                ? {min: 0, max: 12, step: 0.5, unit: 'mi'}
                : {min: 0, max: 20, step: 0.5, unit: 'km'};
        }
    };

    /**
     * Range resolver for the threshold sliders (engine item.rangeFrom): per-kind
     * geometry + fixed direction + live colors. The scale max honors the stored
     * per-kind override and always grows to fit the stored thresholds, so a pair
     * entered under another unit (or by the old text UI) can never strand a thumb
     * off the track.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string}} args Kind key stem, e.g. 'Steps'.
     * @returns {Object} Config the engine merges over the schema item.
     */
    function thresholdRangeCfg(S, env, args) {
        var stem = args.keyStem;
        var contract = thresholdContract();
        var base = THRESHOLD_RANGES[stem](S || {});
        var max = base.max;
        if (contract && !base.fixedMax) {
            var override = contract.parseThreshold(S['thresh' + stem + 'Max']);
            if (override !== null && override > base.min) { max = ceilToStep(override, base.step); }
            var warn = contract.parseThreshold(S['thresh' + stem + 'Warn']);
            var danger = contract.parseThreshold(S['thresh' + stem + 'Danger']);
            if (warn !== null && warn > max) { max = ceilToStep(warn, base.step); }
            if (danger !== null && danger > max) { max = ceilToStep(danger, base.step); }
            // The pair the phone actually holds on must sit on the scale too
            // (resolvedPair: the stored pair when it is ordered, else the seed).
            // With a blank pair and a stored scale max below the seed — the
            // slider's max editor is live while the highlight is off, and older
            // installs kept a Max from before OFF stopped blanking the pair — the
            // slider would clamp the seed it previews to that max while the hold
            // rule and the hint use the real seed: three readings of one rule.
            var held = contract.resolvedPair(stem, S || {});
            if (held.warn !== null && held.warn > max) { max = ceilToStep(held.warn, base.step); }
            if (held.danger !== null && held.danger > max) { max = ceilToStep(held.danger, base.step); }
        }
        // A null warn color (no outline configured) draws the slider's warn pieces
        // in a neutral gray: the zone still shows WHERE warn spans, while the copy +
        // outline toggle make clear the watch renders bold text only there.
        var warnDisplay = thresholdDisplayColor(S, stem, 'Warn');
        var warnColor = warnDisplay === null ? '#8A8E97' : warnDisplay;
        var dangerColor = thresholdDisplayColor(S, stem, 'Danger');
        var isGoal = Boolean(contract && contract.isGoalKind
            && contract.isGoalKind(stem));
        // Seeds from the contract's table (what a blank pair means on the phone);
        // without the contract the slider still renders, seeded at its two ends.
        var seed = contract ? contract.seedPair(stem, S || {}) : {warn: base.min, danger: max};
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
            // Chip/aria wording: goal kinds celebrate (Close / Goal), weather warns.
            warnLabel: isGoal ? 'Close' : 'Warn',
            dangerLabel: isGoal ? 'Goal' : 'Danger'
        };
    }
    PConf.rangeResolvers.register('thresholdRange', thresholdRangeCfg);

    // Picking feels-like or dew point as the main metric clears "Fill area below the
    // line": both map against the temperature axis, not a 0..max scale, so their "below the line"
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

    // Flipping "Highlight on the watch" (thresh<K>On). The toggle is STORED state
    // and switches only the highlight — the levels live on without it (the
    // Alert-mode hold keeps using the warn level, and the phone packs every
    // weather kind's level; the watch gates them on the enable bit). So OFF
    // leaves the pair alone: the stored false IS the state. ON pins the kind's
    // seed pair into storage when no ordered pair is stored yet — a blank pair
    // already MEANS the seed (resolvedPair), so this changes nothing the watch
    // sees; it keeps the wizard's AQI rule landing the same numbers a hand flip
    // does.
    PConf.onChange.register('thresholdToggle', function (S, oldValue, newValue, env, key) {
        var m = /^thresh([A-Za-z]+)On$/.exec(key || '');
        if (!m) { return; }
        var stem = m[1];
        if (!newValue) { return; }
        var contract = thresholdContract();
        if (!contract) { return; }
        var warn = contract.parseThreshold(S['thresh' + stem + 'Warn']);
        var danger = contract.parseThreshold(S['thresh' + stem + 'Danger']);
        var ordered = contract.pairOrdered(warn, danger);
        if (ordered) { return; }
        // The contract's seed pair — the same numbers the phone already resolves
        // a blank pair to, so pinning them changes nothing the watch sees.
        var seed = contract.seedPair(stem, S);
        S['thresh' + stem + 'Warn'] = String(seed.warn);
        S['thresh' + stem + 'Danger'] = String(seed.danger);
    });

    // "Warn outline" toggle (thresh<K>WarnOutlineOn): ON seeds the theme's text
    // color so the outline is immediately visible and editable, OFF blanks the
    // color — a blank warn color IS the no-outline wire state (the blob's 0x00
    // sentinel; the watch then renders warn as bold text only). Goal kinds derive
    // the toggle from the stored color on every open; weather kinds' STORED toggle
    // owns the state, with auto colors following it — see onbuild.js.
    PConf.onChange.register('thresholdOutlineToggle', function (S, oldValue, newValue, env, key) {
        var m = /^thresh([A-Za-z]+)WarnOutlineOn$/.exec(key || '');
        if (!m) { return; }
        var contractMod = thresholdContract();
        var goal = Boolean(contractMod && contractMod.isGoalKind && contractMod.isGoalKind(m[1]));
        S['thresh' + m[1] + 'WarnColor'] = newValue
            ? (goal ? contractMod.DEFAULT_GOAL_HEX : thresholdAutoFg(S.theme)) : '';
    });

    // "Auto" threshold colors: a color the user never customized tracks the THEME's
    // text color — outline-vs-fill already carries the warn/danger distinction, and
    // the fg color beats a fixed hue for contrast on the page and the watch
    // (watch-side rendering gets its own calibration pass later). ONLY an unset
    // value or one of the two fg values counts as auto (re-derived on every page
    // open — onbuild.js onLoad); every other color, the contract's orange/red
    // included, is a user pick and is left alone. The contract DEFAULT_*_COLOR
    // constants remain solely the pack-time fallback for a blob built from settings
    // that never passed through this page. Exposed on PConf because the flat page
    // has no require().
    var AUTO_FG_DARK = '#FFFFFF', AUTO_FG_LIGHT = '#000000';
    /**
     * @param {*} theme stored theme setting ('dark'|'light'|'bw'|'bw-light')
     * @returns {string} the theme's text color as '#RRGGBB'
     */
    function thresholdAutoFg(theme) {
        return (theme === 'light' || theme === 'bw-light') ? AUTO_FG_LIGHT : AUTO_FG_DARK;
    }
    /**
     * @param {*} value stored color setting
     * @returns {boolean} true when the value should keep tracking the theme fg
     */
    function thresholdColorIsAuto(value) {
        if (value === null || typeof value === 'undefined' || value === '') { return true; }
        var v = colorHexOf(value, 0x000000);   // garbage normalizes to a pool value
        return v === AUTO_FG_DARK || v === AUTO_FG_LIGHT;
    }
    /**
     * The color the page should DRAW for a kind's warn/danger pieces: the theme fg
     * while the stored value is auto, the user's pick otherwise.
     * @param {Object} S Live settings state.
     * @param {string} stem Kind key stem, e.g. 'Steps'.
     * @param {string} which 'Warn' | 'Danger'.
     * @returns {string} '#RRGGBB'.
     */
    function thresholdDisplayColor(S, stem, which) {
        var raw = S['thresh' + stem + which + 'Color'];
        // WARN: unset means NO OUTLINE (bold only) — report null so callers render
        // their neutral no-outline state instead of a color.
        if (which === 'Warn' && (raw === '' || raw === null || typeof raw === 'undefined')) {
            return null;
        }
        if (thresholdColorIsAuto(raw)) { return thresholdAutoFg(S.theme); }
        return colorHexOf(raw, 0x000000);
    }
    PConf.thresholdAutoColor = { fgFor: thresholdAutoFg, isAuto: thresholdColorIsAuto };

    // Reset-to-defaults for one threshold kind (the small button beside the slider's
    // label). Returns true so the engine re-renders.
    PConf.actions = PConf.actions || {};
    PConf.actions.resetThresholds = function (stem, S, env, defaultOf) {
        if (!stem || !S || !THRESHOLD_RANGES[stem] || !defaultOf) { return false; }
        var fg = thresholdAutoFg(S.theme);
        var contractMod = thresholdContract();
        var goal = Boolean(contractMod && contractMod.isGoalKind && contractMod.isGoalKind(stem));
        // Every key with a schema default lands on it THROUGH the engine's resolver —
        // mirrored literals drift when the schema changes (see resetStatusSlots
        // below). The result is exactly a fresh install: the stored toggle OFF
        // (resetting the levels switches the highlight off too), the blank pair
        // (= the kind's seed, resolved live — a wind pair follows windUnits
        // again), the cleared Max, and the goal-vs-weather outline color/toggle
        // are all schema defaults.
        var keys = ['On', 'Warn', 'Danger', 'Max', 'WarnColor', 'WarnOutlineOn'];
        for (var d = 0; d < keys.length; d++) {
            S['thresh' + stem + keys[d]] = defaultOf('thresh' + stem + keys[d]);
        }
        // The ONE deliberate divergence from the schema: DangerColor's stored
        // default is '' (= auto, re-derived to the theme fg on every page open by
        // onbuild), but the PACK-time fallback for '' is the contract's red — so a
        // reset-then-save would flash red until the next open. Write eagerly what
        // the next onLoad would derive anyway: theme fg for weather, green for goal.
        S['thresh' + stem + 'DangerColor'] = goal ? contractMod.DEFAULT_GOAL_HEX : fg;
        // "Fresh install" is more than the schema: finishing the first-run wizard
        // applies the defaults-policy table, so the reset lands on those rows too —
        // AQI's highlight-on-with-warn-outline, seeded through the very hooks
        // flipping the controls by hand would run. (A wizard-SKIPPED install never
        // got them; converging its reset on the intended out-of-box state is the
        // deliberate choice here.) applyDefaults is the policy module's one
        // interpreter (set order, dependsOn anchoring, seedVia write-through —
        // shared with the wizard finish); this caller contributes only the veto
        // scoping it to THIS kind's threshold-family keys, Bold deliberately
        // excluded (the reset leaves Bold alone — its row sits outside the
        // Thresholds group). Unlike the wizard, no not-still-default guard:
        // reset IS the user discarding their choices for this kind.
        var policy = (typeof require !== 'undefined')
            ? require('./defaults-policy.js')
            : (typeof window !== 'undefined' ? window.DefaultsPolicy : null);
        if (policy) {
            policy.applyDefaults({wizard: true, env: env, choices: S}, {
                mayWrite: function (name) {
                    return name.indexOf('thresh' + stem) === 0
                        && name !== 'thresh' + stem + 'BoldMode';
                },
                getHook: function (name) {
                    return PConf.onChange && PConf.onChange.get
                        ? PConf.onChange.get(name) : null;
                }
            });
        }
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
    // as several colours instead of one bar; unlike the threshold badge's ring — which
    // is the watch's own outline/filled language — it carries no meaning of its own.
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
    // parsed by range-control.js' own parser so an unset or bruised value (blank, two
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
        if (!rangeControl || !args || !args.key) { return null; }
        var hex = rangeControl.rgbHex(rangeControl.parseRgb(S ? S[args.key] : null,
            {defaultValue: args.defaultValue}));
        // The readout is aria-hidden (it is a preview, and its hex would be read out a
        // character at a time), so ariaNote stays the announcement of the colour — the
        // same string now printed on the row and above the sheet's sliders.
        return {label: 'Edit', ariaNote: hex, chip: hex};
    });

    // Reset-to-defaults for the whole status-bar card (the text button in the Watch
    // tab's intro — schema.js watchStatus): every slot of every bar back to its
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
    // and each bar's Alerts placement (BAR_ALERT_KEYS — the select lives in the
    // bar's own sub-section of this card). Deliberately untouched:
    // thresholds, colors, outline toggles and scale maxes (every sheet has its own
    // reset button), the alerts themselves (the Alerts card has its own reset,
    // resetAlerts below), and the countdown companion dates (inert once a slot
    // leaves 'countdown'). Silent beyond the re-render, like resetThresholds above —
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
        var contractMod = thresholdContract();
        if (contractMod) {
            for (var k = 0; k < contractMod.KINDS.length; k++) {
                schemaKeys.push('thresh' + contractMod.KINDS[k].key + 'BoldMode');
            }
            for (var b = 0; b < contractMod.BAR_ALERT_KEYS.length; b++) {
                schemaKeys.push(contractMod.BAR_ALERT_KEYS[b].key);
            }
        }
        for (var n = 0; n < schemaKeys.length; n++) {
            S[schemaKeys[n]] = defaultOf(schemaKeys[n]);
        }
        return true;
    };

    // Reset-to-defaults for the Alerts card (the text button in its intro — schema.js
    // alertCardItems): every alert's switch and look back to its schema default, via
    // the engine's resolver like resetStatusSlots above. The metric alerts are the
    // level kinds that are neither bold-only nor goals — the five the card lists;
    // rain's are alertRain (on) and rainAlertDisplay. Deliberately untouched: the
    // levels and colours (each sheet's Alert levels header has its own reset, which
    // also serves the slots' highlight), the rain time window (a tuning of the radar,
    // not an on/off or a look) and each bar's placement (the status card's reset).
    /**
     * @param {*} arg Unused (the engine passes the button's data-action-arg).
     * @param {Object} S Live settings state (mutated in place).
     * @param {Object} env Platform env (unused).
     * @param {function(string): *} defaultOf The engine's stored-shape schema
     *     default resolver (defaultAsStored).
     * @returns {boolean} true so the engine re-renders with the restored state.
     */
    PConf.actions.resetAlerts = function (arg, S, env, defaultOf) {
        if (!S || !defaultOf) { return false; }
        var keys = ['alertRain', 'rainAlertDisplay'];
        var contractMod = thresholdContract();
        if (contractMod) {
            for (var k = 0; k < contractMod.KINDS.length; k++) {
                var kind = contractMod.KINDS[k];
                if (!kind.boldOnly && !kind.goal) {
                    keys.push('alert' + kind.key, 'alert' + kind.key + 'Display');
                }
            }
        }
        for (var n = 0; n < keys.length; n++) {
            S[keys[n]] = defaultOf(keys[n]);
        }
        return true;
    };

    /**
     * The pencil badge of one threshold kind's slot: a warn-color ring + danger-color
     * dot while the kind's highlight is ENABLED (the contract's kindConfig — the rule
     * the watch actually packs with), plus the bold 'B'. (The Alerts card's rows
     * badge the alert instead — alertLevelBadge.)
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused; callers gate on env.thresholds).
     * @param {number} kindIndex Index into the contract's KINDS.
     * @returns {Object} Badge state for the engine's editBadgeFrom.
     */
    function penStateForKind(S, env, kindIndex) {
        var contract = thresholdContract();
        var key = contract.KINDS[kindIndex].key;
        var enabled = contract.kindConfig(S, kindIndex).enabled;
        // EFFECTIVE always-bold, not the stored ladder alone: the Watch-tab
        // master row packs every kind's bold cell as always at wire time
        // (status-thresholds.js' settings-blob packer — not named here: this
        // comment ships into the flat page, and a page-side occurrence of
        // that name trips the never-called-from-page guard) without touching
        // the stored per-kind values, and the badge previews what the watch
        // will actually render — so the master lights every slot's B.
        var boldAlways = (S.statusBoldAll === 'all'
            || S['thresh' + key + 'BoldMode'] === 'always');
        var notes = [];
        if (enabled) { notes.push('highlighting on'); }
        if (boldAlways) { notes.push('always bold'); }
        var penWarn = thresholdDisplayColor(S, key, 'Warn');
        return {
            // The sheet-trigger BUTTON label. The slot sheet configures the whole
            // slot (bold + thresholds), not just the warn/goal pair, so the button
            // says what it does rather than naming one section.
            // A disabled kind still gets the labeled button — it just badges no
            // dots and adds no aria note, since there is no state to preview.
            label: 'Edit',
            ariaNote: notes.join(', '),
            bold: boldAlways,
            // The watch's own language: warn is an OUTLINE, danger is FILLED.
            // No warn outline configured -> neutral gray ring (the enabled badge
            // still reads; the ring hue just carries no color meaning then).
            dots: enabled ? [
                { color: penWarn === null ? '#8A8E97' : penWarn, ring: true },
                { color: thresholdDisplayColor(S, key, 'Danger') }
            ] : []
        };
    }

    // Pencil badge (engine item.editBadgeFrom): when the slot's current value is an
    // ENABLED threshold kind, the pencil gains a warn-color ring + danger-color dot,
    // and a 'B' when the slot prints always-bold. Same env gate + code→kind mapping
    // as the sheet resolver above.
    PConf.badgeResolvers.register('thresholdPenState', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var contract = thresholdContract();
        if (!contract) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < contract.KINDS.length; i++) {
            if (contract.KINDS[i].code === code) { return penStateForKind(S, env, i); }
        }
        return null;
    });

    /**
     * The KINDS index of a kind that owns levels (a weather or goal kind, not a
     * bold-only one), looked up by key stem.
     * @param {Object} contract The status-thresholds API.
     * @param {string} keyStem Kind key stem, e.g. 'Uv'.
     * @returns {number} The index, or -1 for an unknown or bold-only stem.
     */
    function levelKindIndex(contract, keyStem) {
        for (var i = 0; i < contract.KINDS.length; i++) {
            if (contract.KINDS[i].key === keyStem && !contract.KINDS[i].boldOnly) { return i; }
        }
        return -1;
    }

    /**
     * The Alerts card row's badge (editBadgeFrom, args.keyStem): the colours the
     * watch draws that alert in, while it is ON — a ring in the warn colour (the
     * entry's outline; with no outline colour picked the watch outlines in the theme
     * fg, since an icon has no bold to fall back on) and a dot in the danger colour
     * (the filled box). No 'B': bold is how a SLOT prints, not part of the alert.
     * The alert switch decides, not the highlight switch: the entries take the
     * kind's colours either way. Rain draws in the radar's colours and never boxes,
     * so its row has no dots, only the Edit button every row carries.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string}} args The row's alert: a level kind's stem, or 'Rain'.
     * @returns {?Object} Badge state, or null where the alert cannot exist (aplite,
     *     an unknown or level-less stem).
     */
    function alertLevelBadge(S, env, args) {
        var st = S || {};
        var stem = args && args.keyStem;
        if (stem === 'Rain') {
            var rainOn = st.alertRain !== false;
            return {label: 'Edit', ariaNote: rainOn ? '' : 'off', dots: []};
        }
        if (!env || !env.thresholds) { return null; }
        var contract = thresholdContract();
        if (!contract || levelKindIndex(contract, stem) < 0) { return null; }
        if (st['alert' + stem] !== true) { return {label: 'Edit', ariaNote: 'off', dots: []}; }
        var warn = thresholdDisplayColor(st, stem, 'Warn');
        return {
            label: 'Edit',
            ariaNote: '',
            dots: [
                {color: warn === null ? thresholdAutoFg(st.theme) : warn, ring: true},
                {color: thresholdDisplayColor(st, stem, 'Danger')}
            ]
        };
    }
    PConf.badgeResolvers.register('alertLevelBadge', alertLevelBadge);

    /**
     * The Alerts card row's hint for a metric alert: "Off" while its switch is off,
     * else the kind's levels and whether the slots highlight them, e.g. "Warn 40 kph
     * · Danger 60 kph · Highlight off". The pair is the resolved one (the stored
     * pair, else the seed — what the watch judges with), in the unit the kind's
     * slider shows, so the row reads the numbers its sheet opens on. Only numbers and
     * the range table's unit label are interpolated (the engine prints hints as raw
     * HTML).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string}} args The row's kind key stem, e.g. 'Wind'.
     * @returns {?string} The hint, or null where the levels do not exist (aplite,
     *     an unknown stem) — the engine then falls back to the static hint.
     */
    function alertLevelsHint(S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var contract = thresholdContract();
        var stem = args && args.keyStem;
        if (!contract || !THRESHOLD_RANGES[stem]) { return null; }
        var st = S || {};
        if (st['alert' + stem] !== true) { return 'Off'; }
        var pair = contract.resolvedPair(stem, st);
        if (typeof pair.warn !== 'number' || typeof pair.danger !== 'number') { return null; }
        var unit = THRESHOLD_RANGES[stem](st).unit;
        var suffix = unit ? ' ' + unit : '';
        return 'Warn ' + pair.warn + suffix + ' · Danger ' + pair.danger + suffix
            + ' · Highlight ' + (st['thresh' + stem + 'On'] === true ? 'on' : 'off');
    }
    PConf.hintResolvers.register('alertLevelsHint', alertLevelsHint);

    /**
     * The label of a stored value in a [label, value] option list.
     * @param {Array<Array<string>>} options The list.
     * @param {*} value The stored value.
     * @returns {?string} Its label, or null when the list has no such value.
     */
    function optionLabel(options, value) {
        for (var i = 0; i < (options || []).length; i++) {
            if (options[i][1] === String(value)) { return options[i][0]; }
        }
        return null;
    }

    /**
     * The Alerts card's Rain row hint: "Off" while the rain alert's switch is off,
     * else its time window and look by the labels its sheet offers them under, e.g.
     * "Within 60 min · Text". The lists come from the schema through args (one
     * copy of each); a value outside them reads as the sheet's default.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused: the row itself is platform-gated).
     * @param {{windows: Array<Array<string>>, looks: Array<Array<string>>}} args The
     *     sheet's option lists (schema.js RAIN_WINDOW_OPTIONS, RAIN_LOOK_OPTIONS).
     * @returns {string} The hint.
     */
    function rainAlertHint(S, env, args) {
        var st = S || {};
        if (st.alertRain === false) { return 'Off'; }
        var a = args || {};
        return (optionLabel(a.windows, st.rainCountdownHorizon) || optionLabel(a.windows, '60'))
            + ' · ' + (optionLabel(a.looks, st.rainAlertDisplay) || optionLabel(a.looks, 'text'));
    }
    PConf.hintResolvers.register('rainAlertHint', rainAlertHint);

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
     * Monthly-usage info block under the Rainbow API key field (Rainbow with "Use your
     * own key" on): the free plan's monthly ceiling, the user's projected month at the
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
    PConf.recommendResolvers.register('recommendedWeatherProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).provider;
    });
    PConf.recommendResolvers.register('recommendedRadarProvider', function (S) {
        return CD.mapCountry(S && S.holidayCountry).radarProvider;
    });

    /**
     * Whether the Rainbow radar runs on the user's own key: "Use your own key" on AND a key
     * that isn't blank once trimmed (onbuild.js trims it on Save). The switch on with the
     * field still empty is not "in use" yet, so the option stays the limited one until a
     * key is there.
     *
     * @param {Object} S Settings state (rainbowOwnKey, rainbowApiKey); may be null.
     * @returns {boolean} True when the own key is in use.
     */
    function rainbowOwnKeyInUse(S) {
        return Boolean(S) && S.rainbowOwnKey === true
            && typeof S.rainbowApiKey === 'string' && S.rainbowApiKey.trim() !== '';
    }

    // The radar picker's options (schema.js RADAR_PROVIDER_OPTIONS, handed over as
    // args.options) with the Rainbow entry named for the key it runs on: its schema label
    // ("Rainbow") once the user's own key is in use, "Rainbow (limited)" on the shared key
    // every user splits — switch off, or on with no key yet. Value, desc and order stay
    // as they are, so hintByValue, the showWhen gates and the "(Recommended)" marker key
    // off the same 'rainbow' value in both states (for the bracketed name the marker
    // leads the desc line instead — engine.js renderSelectOptions).
    PConf.optionsResolvers.register('radarProviderOptions', function (S, env, args) {
        var options = (args && args.options) || [];
        if (rainbowOwnKeyInUse(S)) { return options.slice(); }
        return options.map(function (o) {
            return o[1] === 'rainbow' ? [o[0] + ' (limited)'].concat(o.slice(1)) : o;
        });
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            tomorrowioBudgetBlock: tomorrowioBudgetBlock,
            rainbowBudgetBlock: rainbowBudgetBlock,
            thresholdRangeCfg: thresholdRangeCfg,
            forecastMetricHint: forecastMetricHint,
            lineStyleHint: lineStyleHint,
            STRIPE_SCALE: STRIPE_SCALE
        };
    }
})();

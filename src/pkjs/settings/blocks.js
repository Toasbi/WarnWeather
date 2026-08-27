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
    // Country → recommended-provider mapping (shared with the wizard).
    var CD = (typeof require !== 'undefined') ? require('./country-defaults.js') : COUNTRY_DEFAULTS;
    // The graph-colour vocabulary (key names, per-scope roles, the built-in table) —
    // the same module the watch's wire is packed from, so the row badges below preview
    // exactly what the graph draws. Same dual-context rule as the preview blocks:
    // scripts/build-config-page.js concatenates line-style.js AHEAD of this file, so
    // window.LineStyle exists by the time the page boots.
    var lineStyle = (typeof require !== 'undefined')
        ? require('../line-style.js') : window.LineStyle;

        // Slot-dropdown options resolver: derives a status-line slot's option list from the
    // catalog (Tasks 2 + 17) — Empty first, availability-gated, sibling+excludeCodes filtered.
    PConf.optionsResolvers.register('statusSlot', function (S, env, args) {
        return statusLineCatalog.slotOptions(S, env, args);
    });

    // The six graph metrics in picker order — one list feeds both forecast pickers.
    var FORECAST_METRICS = [
        ['Precipitation %', 'precip_prob'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'],
        ['UV Index', 'uv'], ['Air pressure (hPa)', 'pressure'], ['Feels-like temperature', 'feels']
    ];
    // Main/Second metric options. The third line gets Off plus the metrics the
    // secondary line is not using (a collision is display-snapped by the engine).
    // Feels-like is dropped on aplite: the temp-axis line inset is not compiled
    // there and the temp slot's Feels/Both control is threshold-gated off aplite,
    // so the metric would render misaligned with no companion feature.
    PConf.optionsResolvers.register('forecastMetric', function (S, env, args) {
        var third = Boolean(args && args.third);
        var out = third ? [['Off', 'off']] : [];
        for (var i = 0; i < FORECAST_METRICS.length; i += 1) {
            var opt = FORECAST_METRICS[i];
            if (opt[1] === 'feels' && env && env.platform === 'aplite') { continue; }
            if (third && S && opt[1] === S.secondaryLine) { continue; }
            out.push(opt);
        }
        return out;
    });

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
        if (typeof v === 'number' && isFinite(v)) {
            return '#' + ('00000' + (v & 0xFFFFFF).toString(16)).slice(-6).toUpperCase();
        }
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

    // Per-kind slider geometry + seeds, in the kind's DISPLAY unit (the unit
    // status-thresholds.js compares against at bake/pack time). Resolved per render
    // so the General-tab unit pickers reshape the scales live. fixedMax marks the
    // naturally-bounded kinds (no inline scale-max editor).
    var THRESHOLD_RANGES = {
        Wind: function (S) {
            if (S.windUnits === 'mph') { return {min: 0, max: 75, step: 5, seedWarn: 25, seedDanger: 40, unit: 'mph'}; }
            if (S.windUnits === 'knots') { return {min: 0, max: 65, step: 5, seedWarn: 20, seedDanger: 30, unit: 'kn'}; }
            return {min: 0, max: 120, step: 5, seedWarn: 40, seedDanger: 60, unit: 'kph'};
        },
        Gust: function (S) {
            if (S.windUnits === 'mph') { return {min: 0, max: 100, step: 5, seedWarn: 40, seedDanger: 55, unit: 'mph'}; }
            if (S.windUnits === 'knots') { return {min: 0, max: 85, step: 5, seedWarn: 30, seedDanger: 50, unit: 'kn'}; }
            return {min: 0, max: 160, step: 5, seedWarn: 60, seedDanger: 90, unit: 'kph'};
        },
        Aqi: function (S) {
            // The European scale applies only when Open-Meteo is the AQI source AND the
            // scale picker says so; WAQI (and auto, which prefers it) reports US-style AQI.
            var eu = S.aqiSource === 'openmeteo' && S.aqiScale !== 'us';
            return eu
                ? {min: 0, max: 150, step: 5, seedWarn: 60, seedDanger: 80, unit: ''}
                : {min: 0, max: 300, step: 10, seedWarn: 100, seedDanger: 150, unit: ''};
        },
        Pollen: function () {
            return {min: 0, max: 3, step: 0.5, seedWarn: 2, seedDanger: 3, unit: '', fixedMax: true};
        },
        Uv: function () {
            // The slot displays the rounded integer index, so whole steps; 12 covers
            // every real-world reading (extremes clamp against the top like any kind).
            return {min: 0, max: 12, step: 1, seedWarn: 6, seedDanger: 8, unit: '', fixedMax: true};
        },
        // Goal kinds: seedWarn = "close" (~80% of the goal), seedDanger = the goal —
        // ordered upward like the weather kinds since the celebration rework.
        Steps: function () {
            return {min: 0, max: 20000, step: 250, seedWarn: 8000, seedDanger: 10000, unit: ''};
        },
        Sleep: function () {
            return {min: 0, max: 12, step: 0.5, seedWarn: 6.5, seedDanger: 7.5, unit: 'h', fixedMax: true};
        },
        Distance: function (S) {
            return S.distanceUnits === 'imperial'
                ? {min: 0, max: 12, step: 0.5, seedWarn: 2.5, seedDanger: 3, unit: 'mi'}
                : {min: 0, max: 20, step: 0.5, seedWarn: 4, seedDanger: 5, unit: 'km'};
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
        }
        // A null warn color (no outline configured) draws the slider's warn pieces
        // in a neutral gray: the zone still shows WHERE warn spans, while the copy +
        // outline toggle make clear the watch renders bold text only there.
        var warnDisplay = thresholdDisplayColor(S, stem, 'Warn');
        var warnColor = warnDisplay === null ? '#8A8E97' : warnDisplay;
        var dangerColor = thresholdDisplayColor(S, stem, 'Danger');
        var contractMod = thresholdContract();
        var isGoal = Boolean(contractMod && contractMod.isGoalKind
            && contractMod.isGoalKind(stem));
        return {
            min: base.min, max: max, step: base.step, minSpan: base.step,
            // Direction axis retired (status-thresholds.js): every kind's value
            // rises toward the pair. The engine's 'below' rendering stays a
            // dormant library feature no item sets.
            dir: 'above',
            unit: base.unit,
            seedWarn: base.seedWarn, seedDanger: base.seedDanger,
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

    // Picking feels-like as the main metric clears "Fill area below the line": feels
    // maps against the temperature axis, not a 0..max scale, so its "below the line"
    // is the arbitrary joint-band floor rather than a zero the fill can mean anything
    // against. The toggle's showWhen hides the row for feels; this writes the stored
    // value false so the settings blob agrees with what the watch renders (and with
    // the preview). Switching to any other metric leaves the value alone — the user
    // re-enables the fill themselves, the same as any other toggle.
    PConf.onChange.register('forecastMetricFill', function (S, oldValue, newValue) {
        if (newValue === 'feels') { S.secondaryLineFill = false; }
    });

    // Fill key -> the metric + polarity + night-tint key behind it, for the hook below.
    // Built from line-style's own vocabulary so a metric that stops filling (feels has no
    // Fill key at all) drops out of the map instead of naming a key nothing writes.
    var GRAPH_FILL_TINT = (function () {
        var map = {}, polarities = ['Dark', 'Light'], i, j, metric, suffix;
        if (!lineStyle) { return map; }
        for (i = 0; i < lineStyle.GRAPH_METRICS.length; i++) {
            metric = lineStyle.GRAPH_METRICS[i];
            if (lineStyle.graphColorRoles(metric).indexOf('Night') === -1) { continue; }
            for (j = 0; j < polarities.length; j++) {
                suffix = polarities[j];
                map[lineStyle.graphColorKey(metric, 'Fill', suffix)] = {
                    metric: metric,
                    suffix: suffix,
                    nightKey: lineStyle.graphColorKey(metric, 'Night', suffix)
                };
            }
        }
        return map;
    })();

    // Picking a metric's fill colour carries its night tint along, unless the tint has
    // been picked in its own right. The watch re-shades the filled area under the night
    // hours by painting the tint OPAQUELY over it (forecast_layer.c's night_under layer,
    // drawn by chart.c's has_underlay loop), so a tint left behind on the built-in would
    // replace the new fill with the old colour for those hours — the fill looking like it
    // never took. line-style.js owns "has the tint been claimed?" (both ends of the same
    // question: it also decides the wire's night-fill flag from it) and both polarities
    // are tracked separately, so this writes the one that moved.
    PConf.onChange.register('graphFillTint', function (S, oldValue, newValue, env, key) {
        var pair = GRAPH_FILL_TINT[key];
        if (!pair || !S) { return; }
        if (!lineStyle.graphNightTintFollowsFill(S, pair.metric, pair.suffix, oldValue)) { return; }
        S[pair.nightKey] = newValue;
    });

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

    // Flipping "Highlight this value": OFF blanks the pair — a stored blank IS the
    // disabled state, the exact wire contract the old text fields had, so nothing
    // changes watch-side. ON reseeds the kind's defaults unless a valid ordered
    // pair is already stored (the derived toggle landing on an upgraded install).
    PConf.onChange.register('thresholdToggle', function (S, oldValue, newValue, env, key) {
        var m = /^thresh([A-Za-z]+)On$/.exec(key || '');
        if (!m) { return; }
        var stem = m[1];
        if (!newValue) {
            S['thresh' + stem + 'Warn'] = '';
            S['thresh' + stem + 'Danger'] = '';
            return;
        }
        var contract = thresholdContract();
        if (!contract) { return; }
        var warn = contract.parseThreshold(S['thresh' + stem + 'Warn']);
        var danger = contract.parseThreshold(S['thresh' + stem + 'Danger']);
        var ordered = contract.pairOrdered(warn, danger);
        if (ordered) { return; }
        var cfg = thresholdRangeCfg(S, env, {keyStem: stem});
        S['thresh' + stem + 'Warn'] = String(cfg.seedWarn);
        S['thresh' + stem + 'Danger'] = String(cfg.seedDanger);
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
        // below). The blank pair (highlight OFF, exactly a fresh install: seeding
        // real numbers would derive the toggle back ON), the cleared Max, and the
        // goal-vs-weather outline color/toggle are all schema defaults; the On
        // toggle rides along because onLoad re-derives it only on the NEXT open,
        // and the re-rendered sheet must agree with the blanked pair immediately.
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
                // The STORED colour, so the dot matches the swatch the sheet will show
                // as highlighted; the built-in stands in until the key is written.
                color: colorHexOf(S[lineStyle.graphColorKey(scope, roles[i], sfx)],
                    lineStyle.graphColorDefault(scope, roles[i], sfx, S)),
                ring: roles.length > 1 && i === roles.length - 1
            });
        }
        return {label: 'Edit', dots: dots};
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
    // (their sheets carry no reset of their own), the temp slot's Temp/Feels/Both
    // pills, and the wind/gust direction arrows (the threshold sheets' own reset
    // deliberately covers only the thresholds). Deliberately untouched:
    // thresholds, colors, outline toggles and scale maxes (every sheet has its own
    // reset button), and the countdown companion dates (inert once a slot leaves
    // 'countdown'). Silent beyond the re-render, like resetThresholds above — the
    // engine has no shared toast for [data-action] buttons.
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
            'windSlotDirection', 'gustSlotDirection'];
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
        }
        for (var n = 0; n < schemaKeys.length; n++) {
            S[schemaKeys[n]] = defaultOf(schemaKeys[n]);
        }
        return true;
    };

    // Pencil badge (engine item.editBadgeFrom): when the slot's current value is an
    // ENABLED threshold kind, the pencil gains a warn-color ring + danger-color dot.
    // Same env gate + code→kind mapping as the sheet resolver above; enabled comes
    // from the contract's kindConfig — the rule the watch actually packs with.
    PConf.badgeResolvers.register('thresholdPenState', function (S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var contract = thresholdContract();
        if (!contract) { return null; }
        var code = S[args.messageKey];
        for (var i = 0; i < contract.KINDS.length; i++) {
            if (contract.KINDS[i].code !== code) { continue; }
            var enabled = contract.kindConfig(S, i).enabled;
            var penWarn = thresholdDisplayColor(S, contract.KINDS[i].key, 'Warn');
            return {
                // The slot's sheet-trigger BUTTON label. The sheet configures the
                // whole slot now (bold + thresholds), not just the warn/goal pair,
                // so the button says what it does rather than naming one section.
                // A disabled kind still gets the labeled button — it just badges no
                // dots and adds no aria note, since there is no state to preview.
                label: 'Edit',
                ariaNote: enabled ? 'highlighting on' : '',
                // The watch's own language: warn is an OUTLINE, danger is FILLED.
                // No warn outline configured -> neutral gray ring (the enabled badge
                // still reads; the ring hue just carries no color meaning then).
                dots: enabled ? [
                    { color: penWarn === null ? '#8A8E97' : penWarn, ring: true },
                    { color: thresholdDisplayColor(S, contract.KINDS[i].key, 'Danger') }
                ] : []
            };
        }
        return null;
    });

    // layoutPreset options resolver: compactDense is offered once EITHER health shows a
    // status row (status/all) OR radar shows ANY radar view (radarMode status OR graph —
    // both build dense radar cycles since the CAL2_RF_D/CAL2_HR_D fold).
    PConf.optionsResolvers.register('layoutPresetOptions', function (S) {
        var base = [['Full calendar', 'fullCal'], ['Compact calendar', 'compactCal']];
        var dense = (S.radarMode === 'status' || S.radarMode === 'graph'
            || S.healthMode === 'status' || S.healthMode === 'all');
        if (dense) { base.push(['Compact calendar (dense)', 'compactDense']); }
        base.push(['No calendar', 'noCal']);
        return base;
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

    // ---- tomorrow.io rate-limit info block + budget-guard interval resolver ----

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
        var interval = parseInt(state.fetchIntervalMin, 10) || 15;
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
        // Derived unlock rule: name the fastest ladder step that does NOT fit at
        // the current pause, and the pause that would unlock it.
        for (var i = 0; i < B.INTERVAL_LADDER.length; i += 1) {
            var min = parseInt(B.INTERVAL_LADDER[i][1], 10);
            if (!B.fits(state, min)) {
                var need = B.minSleepHoursFor(state, min);
                if (need !== null && need > sleep) {
                    html += '<br>' + min + '-minute updates' + (radarOn ? ' with radar' : '')
                        + ' need a night pause of ≥ ' + need + ' h — widen the pause to unlock faster updates.';
                }
                break;
            }
        }
        if (B.hourlyCalls(state, interval) >= B.LIMIT_HOUR - 1) {
            html += '<br>At this rate a settings-save refetch in the same hour may delay one cycle — harmless.';
        }
        // Return bare content: the engine's renderBlock wraps this in .blockrow, which
        // already supplies padding, colour and its own bottom divider. Wrapping in .static
        // here would nest a second bordered/padded row and paint a stray divider line.
        return html;
    }
    PConf.blocks.register('tomorrowioBudget', tomorrowioBudgetBlock);

    // Update-interval ladder for fetchIntervalMin: guard on -> only entries the
    // tomorrow.io budget affords (full ladder when no tomorrow.io is selected);
    // guard off -> full ladder (the info block shows the red warning instead).
    // If the stored interval drops out, the engine's resolveRowItem snaps it to
    // the item default ('15').
    PConf.optionsResolvers.register('fetchIntervalBudget', function (S, env, args) {
        if (!S || S.tomorrowioFitBudget === false) { return tomorrowioBudget.INTERVAL_LADDER.slice(); }
        return tomorrowioBudget.fittingOptions(S);
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

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            tomorrowioBudgetBlock: tomorrowioBudgetBlock,
            thresholdRangeCfg: thresholdRangeCfg
        };
    }
})();

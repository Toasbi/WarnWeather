// src/pkjs/settings/wizard.js — ES5, WebView. The first-run setup wizard: its steps, the picker they
// share and the overlay they run in. It opens by itself until onboarding is done (shouldShow), and
// again from Setup › Misc › Run setup again. Its parts live beside it: the styles (wizard-css.js),
// the flick demo and health copy (wizard-flick.js), the forecast step's looks and preview
// (wizard-forecast.js), the finishing defaults (wizard-finish.js) and the Tomorrow.io card
// (wizard-upsell.js). Driven in the tests through its real handlers on a fake DOM
// (test/helpers/wizard-dom.js).
//
// Each step is one screen: a progress bar and Back on top, the step in the middle, one primary
// button at the bottom. The layout, health and theme steps share a picker: the watch, large, showing
// the selected option's real screenshot, with the options as a segmented control below it (a radio
// group: tap, swipe the watch, or use the arrow keys). The forecast step's two pickers preview in the
// live graph instead. Nothing is written until the user picks.
/* global PConf, Intl, navigator, document, console, VIEW_CYCLE, COUNTRY_DEFAULTS */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    // Dual-context (see line-style.js): CommonJS modules under Node, the globals of the files
    // concatenated ahead of this one in the page (scripts/build-config-page.js APP_FILES).
    var node = typeof require !== 'undefined';
    var CD = node ? require('./country-defaults.js') : COUNTRY_DEFAULTS;
    var CSS = node ? require('./wizard-css.js') : window.WizardCss;
    var FLICK = node ? require('./wizard-flick.js') : window.WizardFlick;
    var FORECAST = node ? require('./wizard-forecast.js') : window.WizardForecast;
    var FINISH = node ? require('./wizard-finish.js') : window.WizardFinish;
    var UPSELL = node ? require('./wizard-upsell.js') : window.WizardUpsell;
    // The frame every screen picture sits in (the Watchface tab's too): the screen on its own ground.
    var FRAME = node ? require('./screen-frame.js') : window.ScreenFrame;

    /**
     * The steps. `when` names the env fact a step needs: health where the watch has it; the flick
     * demo where there is a second view to flick to (radar, false on aplite, whose single view leaves
     * nothing to demo); the theme where the watch ships the light polarity (themePolarity, compiled
     * out on aplite); the forecast step where it draws the line styles its looks are made of
     * (lineStyles, false on aplite). Layout and health shape the view cycle, so the demo follows
     * both; the forecast step follows the theme, so its preview is drawn in it. `summary` gives the
     * last step's rows.
     */
    var STEPS = [
        { id: 'welcome', title: 'Welcome to WarnWeather', body: stepWelcome, summary: welcomeRows },
        { id: 'layout', title: 'Choose your layout', body: stepLayout, summary: pickerRow('Layout', 'layoutPreset', 'layout') },
        { id: 'health', when: 'health', title: 'Health on your watch', body: stepHealth,
            summary: pickerRow('Health', 'healthMode', 'health') },
        { id: 'flick', when: 'radar', title: 'Flick to switch views', body: stepFlick },
        { id: 'theme', when: 'themePolarity', title: 'Choose a theme', body: stepTheme,
            summary: pickerRow('Theme', 'theme', 'theme') },
        { id: 'forecast', when: 'lineStyles', title: 'Choose your forecast', body: stepForecast, summary: forecastRow },
        { id: 'done', title: 'You’re all set', body: stepDone }
    ];
    var STEP = {};
    STEPS.forEach(function (step) { STEP[step.id] = step; });

    /**
     * The step ids this watch runs, in order.
     * @param {Object} env Config-UI env facts.
     * @returns {Array.<string>}
     */
    function buildSteps(env) {
        return STEPS.filter(function (step) { return !step.when || env[step.when]; })
            .map(function (step) { return step.id; });
    }

    /**
     * Whether the wizard should open by itself: whenever onboarding hasn't been completed. Not "the
     * config has no keys": PKJS seeds the full defaults blob on the first boot, before any settings
     * page can open, so a fresh install never arrives empty. Existing installs are marked onboarded
     * by a one-time phone-side migration (migrations/onboarding.js), so only a fresh install, or one
     * just reset, still reads false here.
     * @param {?Object} cfg Raw injected saved config.
     * @returns {boolean} True to open.
     */
    function shouldShow(cfg) {
        return !(cfg && cfg.onboardingDone);
    }

    var LAYOUT_OPTS = [['Full calendar', 'fullCal'], ['Compact', 'compactCal'], ['No calendar', 'noCal']];
    var LAYOUT_DESC = {
        fullCal: 'A three-row month grid with today highlighted, above the forecast.',
        compactCal: 'A two-row calendar, leaving more room for the forecast.',
        noCal: 'A big clock and date above a full-size forecast.'
    };
    // 'slot' (Status-slots-only) is not offered: a main-settings-only mode with no Health view of
    // its own and no screenshot. The full set lives on the Health tab (schema.js).
    var HEALTH_OPTS = [['Off', 'off'], ['Status bar', 'status'], ['Status bar + graph', 'all']];
    // schema.js' two theme selects: colour watches get four, black-and-white ones dark and light.
    var THEME_OPTS_COLOR = [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W inverted', 'bw-light']];
    var THEME_OPTS_BW = [['Dark', 'dark'], ['Light', 'light']];
    var THEME_DESC = {
        dark: 'White text and lines on black. The default.',
        light: 'Black text and lines on white.',
        bw: 'Drawn like a black-and-white Pebble: white on black, patterns instead of colour.',
        'bw-light': 'Drawn like a black-and-white Pebble: black on white, patterns instead of colour.'
    };

    /**
     * The pickers. `options` and `desc` read the run; `selected` (the forecast look) is read off the
     * settings; `nearest` names the option a stored value the picker lacks shows as (only a highlight:
     * the stored value changes on a real pick alone); `write` replaces the plain write; `graph`
     * previews in the forecast step's graph instead of a screenshot.
     */
    var PICKERS = {
        layoutPreset: {
            options: function () { return LAYOUT_OPTS; },
            desc: function () { return LAYOUT_DESC; },
            nearest: function (v) { return FLICK.NEAREST_LAYOUT[v] || 'compactCal'; }
        },
        healthMode: {
            options: function () { return HEALTH_OPTS; },
            desc: function () { return FLICK.healthDesc(shotsShowHeartRate()); },
            // The health row's hook runs once as setup closes (wizard-finish.js), not per pick.
            write: function (val) { run.ctx.S.healthMode = val; }
        },
        theme: {
            options: function () { return run.env.color ? THEME_OPTS_COLOR : THEME_OPTS_BW; },
            desc: function () { return THEME_DESC; },
            write: pickTheme
        },
        forecastLook: {
            options: function () { return run.looks.map(function (r) { return [r.label, r.id]; }); },
            desc: function () {
                var out = {};
                run.looks.forEach(function (r) { out[r.id] = r.desc; });
                return out;
            },
            selected: function () { return currentLook().id; },
            write: function (id) { writeLook(lookById(id).values); },
            graph: true
        },
        forecastHours: {
            options: function () { return FORECAST.spanOptions(run.ctx.S, run.env); },
            desc: function () { return FORECAST.SPAN_DESC; },
            nearest: function () { return '24'; },
            graph: true
        }
    };

    // Real watch screenshots, base64-inlined by `mise capture-wizard-screenshots` into
    // wizard-screenshots.generated.js (PConf.screenshots, concatenated ahead of this file).
    var SHOTS = PConf.screenshots || {};
    // 1x1 transparent GIF, shown only if a flick stop unexpectedly has no screenshot:
    // scripts/build-config-page.js fails the build on any missing wizard shot.
    var BLANK_SHOT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

    // The page around the wizard: its ready ctx, kept for "Run setup again".
    var page = { ctx: null };
    // One setup run, null while none is open (newRun).
    var run = null;

    /**
     * A setup run's state, every field with its starting value.
     * @param {Object} ctx The page's ready ctx.
     * @param {boolean} fresh Opened by itself on a fresh install (else "Run setup again").
     * @returns {Object} The run.
     */
    function newRun(ctx, fresh) {
        return {
            ctx: ctx, env: ctx.ENV, steps: buildSteps(ctx.ENV), idx: 0, overlay: null,
            // The flick demo's stop (reset whenever its step renders).
            flickIdx: 0,
            // S.healthMode as setup opened (wizard-finish.js applyHealthModeChange).
            healthAtOpen: ctx.S.healthMode,
            // Where a swipe on the picker's preview started; the latest screenshot swap.
            touch: null, shotSeq: 0,
            // The summary has been shown (footer); a Tomorrow.io key was typed in this run.
            reachedDone: false, tioTyped: false,
            // Where focus goes when setup closes onto the page: the row that re-ran it.
            returnFocus: fresh ? null : '[data-action="startWizard"]',
            // The forecast step's looks, and "Your own"'s values (refreshLooks).
            looks: null, own: null
        };
    }

    function esc(s) { return PConf.engine.esc(s); }
    function indexOfCode(opts, code) {
        for (var i = 0; i < opts.length; i += 1) { if (opts[i][1] === code) { return i; } }
        return 0;
    }
    function labelFor(opts, val) {
        for (var i = 0; i < opts.length; i += 1) { if (opts[i][1] === val) { return opts[i][0]; } }
        return '';
    }
    /**
     * A setting's value as the settings page names it (the schema's own option label), so the
     * summary reads like the tabs it points to: the first of the key's items that names it ('theme'
     * has two selects, and only the colour one names bw / bw-light).
     * @param {string} key Setting messageKey.
     * @param {*} value Stored value.
     * @returns {string} The label, or '' when the schema has none for it.
     */
    function settingLabel(key, value) {
        var items = FINISH.itemsOf(run.ctx.schema, key), label = '';
        for (var i = 0; i < items.length && !label; i += 1) {
            label = labelFor(PConf.engine.resolveOptionsFrom(items[i], run.ctx.S) || [], value);
        }
        return label;
    }
    /**
     * A picker's value as the picker named it (the summary repeats what was tapped), or for a stored
     * value the picker doesn't offer (compactDense, custom, slot) the settings page's name.
     * @param {string} group A picker.
     * @returns {string} Label.
     */
    function pickedLabel(group) {
        var v = run.ctx.S[group];
        return labelFor(PICKERS[group].options(), v) || settingLabel(group, v);
    }
    /**
     * Whether the phone asks for less motion: the preview then swaps without its fade.
     * @returns {boolean} True under prefers-reduced-motion.
     */
    function reducedMotion() {
        return Boolean(typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * Derive the country's settings onto the shared state, running the provider's cleanup hook the
     * way the settings control does.
     * @param {Object} S Live settings.
     * @returns {void}
     */
    function applyDerived(S) {
        var m = CD.mapCountry(S.holidayCountry);
        var oldProvider = S.provider;
        S.provider = m.provider;
        PConf.onChange.get('clearPollenForProvider')(S, oldProvider, m.provider);
        // The country's Rainbow pick is "Rainbow (limited)" ('rainbow'); a radar already on
        // "Rainbow (own key)" ('rainbowkey') stays there.
        var ownKey = S.radarProvider === 'rainbowkey' && m.radarProvider === 'rainbow';
        S.radarProvider = ownKey ? 'rainbowkey' : m.radarProvider;
        S.temperatureUnits = m.temperatureUnits;
        S.windUnits = m.windUnits;
        S.distanceUnits = m.distanceUnits;
        S.weekStartDay = m.weekStartDay;
        S.dateSlotFullFormat = m.dateSlotFullFormat;
    }

    // --- screenshots ---
    // Keyed by platform (SHOTS[platform][group][val]). diorite isn't captured separately: a B&W watch
    // with health and radar, the class of flint, so it shows flint's.
    function shotPlatform() {
        var p = run.env.platform || 'basalt';
        return (p === 'diorite') ? 'flint' : p;
    }
    // Whether the health copy may promise heart rate: the watch has the sensor (env.hr) AND its
    // screenshots were captured on it, so the picture above the words shows it too. diorite borrows
    // flint's, which show none (and a Pebble 2 SE, also 'diorite', has no sensor).
    function shotsShowHeartRate() {
        return Boolean(run.env.hr) && shotPlatform() === run.env.platform;
    }
    function shotFor(group, val) { var s = SHOTS[shotPlatform()] || {}; return (s[group] && s[group][val]) || ''; }
    /**
     * A screenshot's ground: the background of the theme it was captured on. The light themes'
     * shots are on white; every other one is captured on Dark (scripts/gen-wizard-fixtures.js).
     * test/wizard-shot-ground.test.js reads each shot's corners against this.
     * @param {string} group SHOTS group.
     * @param {string} val Its value.
     * @returns {string} '#FFFFFF' | '#000000'.
     */
    function shotGround(group, val) {
        return (group === 'theme' && (val === 'light' || val === 'bw-light')) ? '#FFFFFF' : '#000000';
    }
    /**
     * A flick stop's screenshot (SHOTS[platform].radar is a plain data URI).
     * @param {{shotGroup: string, shotVal: string}} stop A wizard-flick.js stop.
     * @returns {string} A data URI.
     */
    function stopShot(stop) {
        var src = (stop.shotGroup === 'radar') ? ((SHOTS[shotPlatform()] || {}).radar || '') : shotFor(stop.shotGroup, stop.shotVal);
        return src || BLANK_SHOT;
    }
    function stopGround(stop) { return stop.shotGroup === 'radar' ? '#000000' : shotGround(stop.shotGroup, stop.shotVal); }
    // The screen the screenshots were captured on: 144 x 168, emery's 200 x 228.
    function shotScreen() { return shotPlatform() === 'emery' ? { w: 200, h: 228 } : { w: 144, h: 168 }; }
    /**
     * One screenshot, at its screen's own size, for watchHtml.
     * @param {string} src The screenshot.
     * @param {string} cls Its class.
     * @param {boolean} [hook] The picker's swappable shot (data-wiz-shot).
     * @returns {string} SVG markup.
     */
    function shotImage(src, cls, hook) {
        var sc = shotScreen();
        return FRAME.image(sc.w, sc.h, esc(src), 'class="' + cls + '"' + (hook ? ' data-wiz-shot' : ''));
    }
    /**
     * The watch: its screen in the frame every screen picture shares (screen-frame.js), a margin of
     * the screenshots' own ground all round, so the card's round corners clip nothing on it.
     * @param {string} shots The screen: one shotImage, or the flick demo's two.
     * @param {string} bg Their ground.
     * @param {string} [label] What it shows, for assistive tech (none: the caption beside it says).
     * @returns {string} HTML.
     */
    function watchHtml(shots, bg, label) {
        var sc = shotScreen();
        return '<div class="wiz-watch" data-wiz-watch' + (label ? ' role="img" aria-label="' + esc(label) + '"' : '') + '>'
            + FRAME.svg(sc.w, sc.h, bg, shots, 'wiz-scr') + '</div>';
    }

    // --- the forecast step ---
    /**
     * The forecast looks for the settings now: their values follow the theme (the bars' colour it
     * starts on), so they are rebuilt when setup opens and when a theme is picked.
     * @returns {void}
     */
    function refreshLooks() {
        var S = run.ctx.S;
        run.looks = FORECAST.looks(S, run.env, PConf.engine.themedDefaults(run.ctx.schema, S, run.env), run.own);
    }
    function lookById(id) {
        for (var i = 0; i < run.looks.length; i += 1) { if (run.looks[i].id === id) { return run.looks[i]; } }
        return run.looks[0];
    }
    /**
     * The look the settings draw now. Setup's own writes always leave one (a theme pick lays the look
     * on again), so the first record answers only a graph changed under it.
     * @returns {Object} The record.
     */
    function currentLook() { return FORECAST.current(run.ctx.S, run.looks, run.env) || run.looks[0]; }
    /**
     * Write a look's values the way the settings page's controls do (their hooks run).
     * @param {Object<string, *>} values messageKey -> value.
     * @returns {void}
     */
    function writeLook(values) {
        Object.keys(values).forEach(function (k) { run.ctx.setValue(k, values[k]); });
    }
    /**
     * Pick a theme: its conversion runs (the colours, and the bars' colour it starts on), "Your own"
     * converts along, and the look picked on the forecast step is laid on again if the conversion
     * moved it off (Stripes' Solid bars back to multicolor on a dark theme).
     * @param {string} theme The theme picked.
     * @returns {void}
     */
    function pickTheme(theme) {
        var S = run.ctx.S, before = run.looks ? currentLook().id : null, oldTheme = S.theme;
        run.ctx.setValue('theme', theme);
        if (!run.looks) { return; }
        if (run.own) { FORECAST.followTheme(run.own, oldTheme, theme); }
        refreshLooks();
        var look = lookById(before);
        if (!FORECAST.same(S, look.values, run.env)) { writeLook(look.values); }
    }
    function forecastLabel() {
        var S = run.ctx.S, look = currentLook().label;
        return run.env.forecastSpan ? look + ', ' + labelFor(PICKERS.forecastHours.options(), highlighted('forecastHours')) : look;
    }
    function graphLabel() { return 'Forecast preview: ' + forecastLabel(); }
    function graphHtml() { return FORECAST.previewSvg(run.ctx.S, run.env, run.ctx.USERDATA); }
    /**
     * Redraw the forecast step's graph, and rename the long length, whose hours follow the look (the
     * high and low on the graph widen its plot).
     * @returns {void}
     */
    function refreshForecast() {
        var graph = run.overlay.querySelector('[data-wiz-graph]');
        if (graph) {
            graph.innerHTML = graphHtml();
            graph.setAttribute('aria-label', graphLabel());
        }
        var opts = PICKERS.forecastHours.options(), segs = run.overlay.querySelectorAll('[data-wiz-group="forecastHours"]');
        for (var i = 0; i < segs.length; i += 1) { segs[i].textContent = labelFor(opts, segs[i].getAttribute('data-wiz-opt')); }
    }
    /**
     * What the forecast graph draws from: its governed settings and its length. A pick that leaves
     * it unchanged redraws nothing.
     * @returns {string}
     */
    function graphState() { return JSON.stringify(FORECAST.snapshot(run.ctx.S, run.env)) + '|' + run.ctx.S.forecastHours; }

    // --- the picker ---
    function optsFor(group) { return PICKERS[group].options(); }
    function descFor(group) { return PICKERS[group].desc(); }
    /**
     * The option a picker shows as selected: the stored value when the picker offers it, else its
     * nearest (or first) option; the forecast look as the settings read.
     * @param {string} group A picker.
     * @returns {string} An option value.
     */
    function highlighted(group) {
        var picker = PICKERS[group];
        if (picker.selected) { return picker.selected(); }
        var opts = picker.options(), stored = run.ctx.S[group];
        if (labelFor(opts, stored)) { return stored; }
        return picker.nearest ? picker.nearest(stored) : opts[0][1];
    }
    function commit(group, val) {
        if (PICKERS[group].write) { PICKERS[group].write(val); } else { run.ctx.setValue(group, val); }
    }
    function optHtml(group, label, val, on) {
        return '<button type="button" class="wiz-opt' + (on ? ' on' : '') + '" role="radio" aria-checked="'
            + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '" data-wiz-group="' + esc(group)
            + '" data-wiz-opt="' + esc(val) + '">' + esc(label) + '</button>';
    }
    /**
     * A picker's options as a segmented radio group, then the selected option's description
     * (announced when it changes).
     * @param {string} group The picker.
     * @param {string} labelledBy The id of the heading that names the group.
     * @returns {string} HTML.
     */
    function optsHtml(group, labelledBy) {
        var opts = optsFor(group), sel = highlighted(group);
        var h = '<div class="wiz-opts" role="radiogroup" aria-labelledby="' + esc(labelledBy) + '" data-wiz-pick="'
            + esc(group) + '">';
        opts.forEach(function (o) { h += optHtml(group, o[0], o[1], o[1] === sel); });
        return h + '</div><p class="wiz-desc" data-wiz-desc="' + esc(group) + '" aria-live="polite">'
            + esc(descFor(group)[sel] || '') + '</p>';
    }
    /**
     * The picker: the watch showing the selected option, then its options.
     * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
     * @returns {string} HTML.
     */
    function pickerHtml(group) {
        var sel = highlighted(group);
        return '<div class="wiz-stage big" data-wiz-preview="' + esc(group) + '">'
            + watchHtml(shotImage(shotFor(group, sel), 'wiz-shot', true), shotGround(group, sel),
                labelFor(optsFor(group), sel) + ' preview')
            + '</div>' + optsHtml(group, 'wiz-title');
    }
    /**
     * Swap the picker's screenshot with a short fade (none under reduced motion). A newer swap wins
     * over one still fading. The ground follows the new shot as it lands (a light theme's is white).
     * The shot is an SVG <image>: its class is an attribute (className is no string on SVG).
     * @param {string} group The picker.
     * @param {string} val The picked option.
     * @returns {void}
     */
    function swapShot(group, val) {
        var watch = run.overlay.querySelector('[data-wiz-watch]'), img = run.overlay.querySelector('[data-wiz-shot]');
        if (!watch || !img) { return; }
        var src = shotFor(group, val), bg = shotGround(group, val);
        watch.setAttribute('aria-label', labelFor(optsFor(group), val) + ' preview');
        run.shotSeq += 1;
        var seq = run.shotSeq;
        function land() {
            FRAME.setImage(img, src);
            FRAME.setGround(watch, bg);
            img.setAttribute('class', 'wiz-shot');
        }
        if (img.getAttribute('href') === src) { img.setAttribute('class', 'wiz-shot'); return; }
        if (reducedMotion()) { land(); return; }
        img.setAttribute('class', 'wiz-shot fade');
        setTimeout(function () {
            if (!run || seq !== run.shotSeq) { return; }
            land();
        }, 140);
    }
    /**
     * Pick an option: commit it, then update its group's segments and description and the preview in
     * place (no re-render, so focus and a swipe in progress are kept).
     * @param {string} group A picker.
     * @param {number} idx Option index (clamped).
     * @param {boolean} focus Move keyboard focus to the picked segment (arrow keys).
     * @returns {void}
     */
    function selectOption(group, idx, focus) {
        var opts = optsFor(group);
        var val = opts[Math.max(0, Math.min(opts.length - 1, idx))][1];
        var graph = PICKERS[group].graph, before = graph ? graphState() : '';
        commit(group, val);
        var segs = run.overlay.querySelectorAll('[data-wiz-group="' + group + '"]');
        for (var i = 0; i < segs.length; i += 1) {
            var on = segs[i].getAttribute('data-wiz-opt') === val;
            segs[i].className = on ? 'wiz-opt on' : 'wiz-opt';
            segs[i].setAttribute('aria-checked', on ? 'true' : 'false');
            segs[i].setAttribute('tabindex', on ? '0' : '-1');
            if (on && focus) { segs[i].focus(); }
        }
        var desc = run.overlay.querySelector('[data-wiz-desc="' + group + '"]');
        if (desc) { desc.textContent = descFor(group)[val] || ''; }
        if (!graph) {
            swapShot(group, val);
        } else if (graphState() !== before) {
            refreshForecast();
        }
    }

    // --- the flick demo: tilt-and-snap through the real cycle ---
    function flickStops() { return FLICK.flickStops(run.ctx.S, shotsShowHeartRate()); }
    /**
     * A stop's caption. Its name is already beside the dots, so only a screen reader hears it again
     * here (the caption is the announced region).
     * @param {{label: string, caption: string}} stop A stop.
     * @returns {string} HTML.
     */
    function flickCaptionHtml(stop) {
        return '<span class="sr-only">' + esc(stop.label) + ': </span>' + esc(stop.caption);
    }
    /**
     * The cycle's dots, the current one highlighted; its name sits beside them, so the position is
     * never told by colour alone.
     * @param {number} count Stops.
     * @param {number} idx Current stop.
     * @returns {string} HTML.
     */
    function flickDotsHtml(count, idx) {
        var h = '';
        for (var i = 0; i < count; i += 1) { h += '<span class="wiz-dot' + (i === idx ? ' on' : '') + '"></span>'; }
        return h;
    }
    /**
     * Swap the demo to a stop: crossfade the two stacked screenshots (the CSS transition fades) and
     * rewrite the dots, name and caption. The step may have changed, or setup closed, by the snap.
     * @param {Object} stop The stop.
     * @param {number} idx Its index.
     * @param {number} count Stops.
     * @returns {void}
     */
    function showFlickStop(stop, idx, count) {
        if (!run || !run.overlay) { return; }
        var imgs = run.overlay.querySelectorAll('.wiz-flick-shot');
        if (imgs.length === 2) {
            var cur = ((imgs[0].getAttribute('class') || '').indexOf(' on') >= 0) ? 0 : 1, nxt = 1 - cur;
            FRAME.setImage(imgs[nxt], stopShot(stop));
            FRAME.setGround(run.overlay.querySelector('[data-wiz-watch]'), stopGround(stop));
            imgs[cur].setAttribute('class', 'wiz-shot wiz-flick-shot');
            imgs[nxt].setAttribute('class', 'wiz-shot wiz-flick-shot on');
        }
        var dots = run.overlay.querySelector('[data-wiz-flick-dots]');
        if (dots) { dots.innerHTML = flickDotsHtml(count, idx); }
        var lbl = run.overlay.querySelector('[data-wiz-flick-label]');
        if (lbl) { lbl.textContent = stop.label; }
        var cap = run.overlay.querySelector('[data-wiz-flick-cap]');
        if (cap) { cap.innerHTML = flickCaptionHtml(stop); }
    }
    /**
     * Advance the demo one stop (wrapping to Default), replay the tilt on the watch and swap the
     * picture on the snap (150 ms into the 450 ms tilt). Under reduced motion the CSS drops the tilt.
     * @returns {void}
     */
    function advanceFlick() {
        var stops = flickStops();
        run.flickIdx = (run.flickIdx + 1) % stops.length;
        var stop = stops[run.flickIdx], idx = run.flickIdx;
        var watch = run.overlay.querySelector('[data-wiz-flick-watch]');
        if (watch) {
            watch.className = 'wiz-flick-watch';    // restart the animation:
            void watch.offsetWidth;                 // force a reflow between the class flips
            watch.className = 'wiz-flick-watch tilt';
        }
        setTimeout(function () { showFlickStop(stop, idx, stops.length); }, 150);
    }

    // --- step bodies ---
    function stepHead(id) {
        return '<h2 class="wiz-title" id="wiz-title" data-wiz-title tabindex="-1">' + esc(STEP[id].title) + '</h2>';
    }
    // The country rows are the settings page's own searchSelects, their options resolved (the region
    // derives from the country), so they look and behave like Settings.
    function selectRow(key) {
        var item = FINISH.findItem(run.ctx.schema, key);
        var withOpts = Object.assign({}, item, { options: PConf.engine.resolveOptionsFrom(item, run.ctx.S) });
        return PConf.engine.renderRow(withOpts, { value: run.ctx.S[key] });
    }
    function stepWelcome() {
        // aplite has no radar: no promise of one there.
        var radar = Boolean(run.env.radar);
        var lead = radar ? 'Forecast, rain radar and your calendar at a glance.' : 'Forecast and your calendar at a glance.';
        var region = FINISH.findItem(run.ctx.schema, 'holidayRegion');
        var layout = highlighted('layoutPreset');
        var h = '<div class="wiz-stage">'
            + watchHtml(shotImage(shotFor('layoutPreset', layout), 'wiz-shot'), shotGround('layoutPreset', layout),
                'WarnWeather on your watch')
            + '</div>'
            + stepHead('welcome')
            + '<p class="wiz-lead">' + lead + ' Setup takes a minute, and you can change everything later.</p>'
            + '<div class="wiz-card"><div class="wiz-card-hd">Your country</div>'
            + selectRow('holidayCountry');
        if (region && PConf.engine.resolveOptionsFrom(region, run.ctx.S).length) { h += selectRow('holidayRegion'); }
        return h + '<p class="wiz-note">Picks the ' + (radar ? 'weather and radar service' : 'weather service')
            + ' for your area, your units, holidays and first day of the week.</p></div>';
    }
    function stepLayout() {
        return stepHead('layout') + pickerHtml('layoutPreset')
            + '<div class="wiz-legend">'
            + '<p><b>Forecast Status Bar</b>: your location, the temperature and air quality.</p>'
            + '<p><b>Forecast</b>: an hourly graph of the temperature, rain and more.</p></div>';
    }
    function stepHealth() { return stepHead('health') + pickerHtml('healthMode'); }
    function stepFlick() {
        // The demo opens on its first stop (the default view) whenever the step renders.
        run.flickIdx = 0;
        var stops = flickStops(), stop = stops[0], src = stopShot(stop);
        return stepHead('flick')
            + '<p class="wiz-lead">Flick your wrist for the next view. It goes back to the default by itself.</p>'
            + '<div class="wiz-flick">'
            + '<div class="wiz-stage big"><div class="wiz-flick-watch" data-wiz-flick-watch data-wiz-flick>'
            + watchHtml(shotImage(src, 'wiz-shot wiz-flick-shot on') + shotImage(src, 'wiz-shot wiz-flick-shot'),
                stopGround(stop))
            + '</div></div>'
            + '<div class="wiz-flick-track">'
            + '<span data-wiz-flick-dots>' + flickDotsHtml(stops.length, 0) + '</span>'
            + '<span class="wiz-flick-label" data-wiz-flick-label>' + esc(stop.label) + '</span>'
            + '</div>'
            + '<button type="button" class="wiz-try" data-wiz-flick>' + CSS.ICON_FLICK + 'Try a flick</button>'
            + '<p class="wiz-desc" data-wiz-flick-cap aria-live="polite">' + flickCaptionHtml(stop) + '</p>'
            + '</div>';
    }
    // Colours can be changed where they draw: a colour watch on a colour theme.
    function colourTheme() { return Boolean(run.env.color) && ['bw', 'bw-light'].indexOf(run.ctx.S.theme) === -1; }
    function stepTheme() {
        return stepHead('theme') + pickerHtml('theme')
            + (run.env.color ? '<p class="wiz-fine">You can fine-tune any colour later in Settings.</p>' : '');
    }
    /**
     * The forecast step: the graph, drawn live in the picked look (a swipe across it steps through the
     * looks), the looks, and on emery the length.
     * @returns {string} HTML.
     */
    function stepForecast() {
        var h = stepHead('forecast')
            + '<div class="wiz-stage" data-wiz-preview="forecastLook">'
            + '<div class="wiz-graph" data-wiz-graph role="img" aria-label="' + esc(graphLabel()) + '">' + graphHtml() + '</div>'
            + '</div>' + optsHtml('forecastLook', 'wiz-title');
        if (run.env.forecastSpan) {
            h += '<h3 class="wiz-sub" id="wiz-span">Forecast length</h3>' + optsHtml('forecastHours', 'wiz-span');
        }
        return h + '<p class="wiz-fine">Every line' + (colourTheme() ? ', its style and its colours' : ' and its style')
            + ' can be changed later in Settings, on the Graphs tab.</p>';
    }
    function welcomeRows() {
        var S = run.ctx.S, country = settingLabel('holidayCountry', S.holidayCountry);
        var region = (S.holidayRegion && S.holidayRegion !== 'all') ? settingLabel('holidayRegion', S.holidayRegion) : '';
        return [{ k: 'Country', v: region ? region + ', ' + country : country, step: 'welcome' },
            { k: 'Weather', v: settingLabel('provider', S.provider), attr: 'data-wiz-sum-weather' }];
    }
    /**
     * A picker step's summary row: the pick as the picker named it, with a Change link to the step.
     * @param {string} k The row's name.
     * @param {string} group The picker.
     * @param {string} step The step it is on.
     * @returns {function(): Array.<Object>} The summary function.
     */
    function pickerRow(k, group, step) {
        return function () { return [{ k: k, v: pickedLabel(group), step: step }]; };
    }
    function forecastRow() { return [{ k: 'Forecast', v: forecastLabel(), step: 'forecast', attr: 'data-wiz-sum-forecast' }]; }
    /**
     * The last step's summary: what setup chose, each with a way back to the step that set it. The
     * picks read as their pickers named them; country, region and weather as the settings tabs do.
     * @returns {string} HTML.
     */
    function summaryHtml() {
        var h = '<ul class="wiz-sum">';
        run.steps.forEach(function (id) {
            if (!STEP[id].summary) { return; }
            STEP[id].summary().forEach(function (row) {
                h += '<li><span class="k">' + esc(row.k) + '</span><span class="v"' + (row.attr ? ' ' + row.attr : '') + '>'
                    + esc(row.v || '—') + '</span>'
                    + (row.step ? '<button type="button" class="chg" data-wiz-goto="' + row.step + '" aria-label="Change '
                        + esc(row.k.toLowerCase()) + '">Change</button>' : '')
                    + '</li>';
            });
        });
        return h + '</ul>';
    }
    function stepDone() {
        var item = FINISH.findItem(run.ctx.schema, 'tomorrowioApiKey');
        return '<div class="wiz-badge">' + CSS.ICON_DONE + '</div>'
            + stepHead('done')
            + '<p class="wiz-lead">Save to send these settings to your watch. To run setup again later: '
            + '<b>Setup&nbsp;›&nbsp;Misc&nbsp;›&nbsp;Run&nbsp;setup&nbsp;again</b>.</p>'
            + summaryHtml()
            + ((item && UPSELL.offered(run.ctx.S)) ? UPSELL.html(item, run.ctx.S) : '')
            + '<p class="wiz-fine">Enjoying WarnWeather? A ♥ on the Pebble appstore helps a lot. Questions or ideas: '
            + 'open an issue on <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>, or use the '
            + 'appstore’s “Message the developer”.</p>';
    }

    // --- top bar and bottom bar ---
    function topHtml() {
        var n = run.steps.length, h;
        h = (run.idx > 0)
            ? '<button type="button" class="wiz-back" data-wiz-nav="back" aria-label="Back">' + CSS.ICON_BACK + '</button>'
            : '<span class="wiz-top-pad"></span>';
        h += '<div class="wiz-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="'
            + n + '" aria-valuenow="' + (run.idx + 1) + '" aria-valuetext="Step ' + (run.idx + 1) + ' of ' + n + '">';
        for (var i = 0; i < n; i += 1) {
            h += '<span class="wiz-seg' + (i < run.idx ? ' done' : (i === run.idx ? ' on' : '')) + '"></span>';
        }
        return h + '</div><span class="wiz-top-pad"></span>';
    }
    function cta(nav, label) {
        return '<button type="button" class="wiz-cta" data-wiz-nav="' + nav + '">' + esc(label) + '</button>';
    }
    function quiet(nav, label) {
        return '<button type="button" class="wiz-link" data-wiz-nav="' + nav + '">' + esc(label) + '</button>';
    }
    function footer(id) {
        // Back from the summary (a Change link, or Back): one tap returns to it, and Skip, which would
        // drop the finishing defaults, is no longer offered.
        if (run.reachedDone && id !== 'done') { return cta('summary', 'Back to summary'); }
        if (id === 'welcome') { return cta('next', 'Get started') + quiet('skip', 'Skip setup'); }
        if (id === 'done') { return cta('save', 'Save to watch') + quiet('tweak', 'Keep customizing'); }
        return cta('next', 'Continue');
    }

    /**
     * Render the current step into the overlay.
     * @param {string} dir 'next' or 'open' (slides in from the right), 'back' (from the left), or 'stay':
     *   re-render in place (a country picked), keeping the scroll position and focus.
     * @returns {void}
     */
    function renderStep(dir) {
        var id = run.steps[run.idx], stay = dir === 'stay';
        if (id === 'done') { run.reachedDone = true; }
        var top = run.overlay.querySelector('[data-wiz-top]');
        if (top) { top.innerHTML = topHtml(); }
        var body = run.overlay.querySelector('[data-wiz-body]');
        body.innerHTML = '<div class="wiz-step' + (dir === 'back' ? ' back' : '') + (stay ? ' still' : '')
            + (id === 'done' ? ' last' : '') + '">' + STEP[id].body() + '</div>';
        run.overlay.querySelector('[data-wiz-foot]').innerHTML = footer(id);
        if (stay) { return; }
        body.scrollTop = 0;
        // A screen reader starts each step at its title.
        var title = run.overlay.querySelector('[data-wiz-title]');
        if (title) { title.focus({ preventScroll: true }); }
    }

    // --- opening and closing ---
    /**
     * The settings page under the overlay: its top bar and its scroll area. Not the #modal sheet the
     * country row opens, which shows above the wizard, nor the #toast.
     * @returns {Array.<Element>} The elements that exist.
     */
    function pageBehind() {
        return [document.querySelector('.topbar'), document.getElementById('scroll')].filter(Boolean);
    }
    /**
     * Hide the page behind the wizard from screen readers and the keyboard (aria-modal alone doesn't
     * in every WebView), or show it again.
     * @param {boolean} hidden True while the wizard is up.
     * @returns {void}
     */
    function hidePageBehind(hidden) {
        pageBehind().forEach(function (node) {
            if (hidden) { node.setAttribute('aria-hidden', 'true'); } else { node.removeAttribute('aria-hidden'); }
            node.inert = hidden;
        });
    }
    function closeWizard() {
        hidePageBehind(false);
        if (run.overlay.parentNode) { run.overlay.parentNode.removeChild(run.overlay); }
        run.overlay = null;
    }
    /**
     * After the wizard closes onto the page, put focus back where it came from: the "Run setup again"
     * row for a re-run, else the active tab at the top of the page.
     * @returns {void}
     */
    function restoreFocus() {
        var el = (run.returnFocus && document.querySelector(run.returnFocus)) || document.querySelector('.tab.on');
        if (el) { el.focus(); }
    }
    // Keep the overlay up: save() flashes a toast then navigates back to the watch, which unloads
    // the page. Removing the overlay first would flash the settings menu before that navigation.
    function finishSave() { run.ctx.set('onboardingDone', true); run.ctx.save(); }
    function finishTweak() { run.ctx.set('onboardingDone', true); closeWizard(); run.ctx.render(); restoreFocus(); }

    function onNav(nav) {
        // Closing reconciles the health pick with the status rows BEFORE the finishing defaults: the
        // policy's health-slot swap reads the health row, which after an off -> on pick must already
        // be back at its defaults. The defaults are applied BEFORE the exit, so they ride the save (or
        // show on the settings page the user is dropped onto); applyWizardDefaults decides which navs
        // finish setup.
        if (FINISH.EXIT_NAVS[nav]) { FINISH.applyHealthModeChange(run.ctx, run.healthAtOpen); }
        FINISH.applyWizardDefaults(run.ctx, nav);
        if (nav === 'back') { run.idx = Math.max(0, run.idx - 1); renderStep('back'); }
        else if (nav === 'next') { run.idx = Math.min(run.steps.length - 1, run.idx + 1); renderStep('next'); }
        // Picks commit as they are made, so returning straight to the summary is safe.
        else if (nav === 'summary') { run.idx = run.steps.indexOf('done'); renderStep('next'); }
        else if (nav === 'save') { finishSave(); }
        // Skip closes onto the live settings page (as "Keep customizing" does) rather than saving.
        else if (nav === 'skip' || nav === 'tweak') { finishTweak(); }
    }

    /**
     * Jump back to a step from the summary's Change links. Walking forward from there returns to the
     * summary, which then shows the new pick.
     * @param {string} id Step id.
     * @returns {void}
     */
    function goToStep(id) {
        var at = run.steps.indexOf(id);
        if (at === -1) { return; }
        run.idx = at;
        renderStep('back');
    }

    /**
     * Open the folded Tomorrow.io card onto its key field, focusing its label so a screen reader
     * starts at the instructions and the keyboard stays down until the field is tapped.
     * @param {Element} button The card's "Add a Tomorrow.io key" button.
     * @returns {void}
     */
    function openUpsell(button) {
        var field = run.overlay.querySelector('[data-wiz-tio-field]');
        if (!field) { return; }
        field.removeAttribute('hidden');
        if (button.parentNode) { button.parentNode.removeChild(button); }
        var label = field.querySelector('.lbl');
        if (label) { label.setAttribute('tabindex', '-1'); label.focus(); }
    }

    function onClick(e) {
        var t;
        if ((t = e.target.closest('[data-wiz-nav]'))) { onNav(t.getAttribute('data-wiz-nav')); return; }
        if ((t = e.target.closest('[data-select]'))) {
            // The shared bottom-sheet dialog (a showModal() top-layer dialog, above this overlay). The
            // engine sets S[key] on pick; a new country resets the region and re-derives the
            // country's settings, then the step re-renders in place.
            var sk = t.getAttribute('data-select'), before = run.ctx.S[sk];
            run.ctx.openSheet(sk, function () {
                if (sk === 'holidayCountry' && run.ctx.S.holidayCountry !== before) {
                    run.ctx.S.holidayRegion = 'all';
                    applyDerived(run.ctx.S);
                    // A key typed in this run keeps Tomorrow.io wherever the new country still offers it.
                    if (run.tioTyped && UPSELL.offered(run.ctx.S)) { onTomorrowioKey(run.ctx.S.tomorrowioApiKey); }
                }
                renderStep('stay');
                var again = run.overlay.querySelector('[data-select="' + sk + '"]');
                if (again) { again.focus(); }
            });
            return;
        }
        if ((t = e.target.closest('[data-wiz-opt]'))) {
            var group = t.getAttribute('data-wiz-group');
            selectOption(group, indexOfCode(optsFor(group), t.getAttribute('data-wiz-opt')), false);
            return;
        }
        if ((t = e.target.closest('[data-wiz-goto]'))) { goToStep(t.getAttribute('data-wiz-goto')); return; }
        if ((t = e.target.closest('[data-wiz-tio-open]'))) { openUpsell(t); return; }
        if ((t = e.target.closest('[data-wiz-flick]'))) { advanceFlick(); return; }
        // The settings row embedded in the Tomorrow.io card: its copy button and Test button live in
        // the overlay, outside #scroll, where the engine's own delegated handlers never see them.
        if ((t = e.target.closest('[data-copy]'))) { PConf.copyText(t.getAttribute('data-copy')); return; }
        if ((t = e.target.closest('[data-action]'))) {
            var act = PConf.actions[t.getAttribute('data-action')];
            if (act) { act(); }
        }
    }

    // A radio group moves its selection with the arrow keys (wrapping), Home and End. Older
    // WebViews name the arrows without the "Arrow" prefix.
    var KEY_STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Right: 1, Down: 1, Left: -1, Up: -1 };
    function onKeydown(e) {
        var t = e.target.closest('[data-wiz-opt]');
        if (!t) { return; }
        var group = t.getAttribute('data-wiz-group'), opts = optsFor(group);
        var at = indexOfCode(opts, t.getAttribute('data-wiz-opt')), to = null;
        if (KEY_STEP[e.key]) { to = (at + KEY_STEP[e.key] + opts.length) % opts.length; }
        else if (e.key === 'Home') { to = 0; }
        else if (e.key === 'End') { to = opts.length - 1; }
        if (to === null) { return; }
        e.preventDefault();
        selectOption(group, to, true);
    }

    // A sideways swipe across the picker's preview steps to the neighbouring option (no wrap).
    // Mostly-vertical drags are scrolls, and left alone.
    var SWIPE_MIN_PX = 40;
    function onTouchStart(e) {
        var t = e.target.closest('[data-wiz-preview]');
        run.touch = (t && e.touches && e.touches.length === 1)
            ? { group: t.getAttribute('data-wiz-preview'), x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }
    function onTouchEnd(e) {
        var start = run.touch;
        run.touch = null;
        if (!start || !e.changedTouches || !e.changedTouches.length) { return; }
        var dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) { return; }
        var to = indexOfCode(optsFor(start.group), highlighted(start.group)) + (dx < 0 ? 1 : -1);
        if (to < 0 || to >= optsFor(start.group).length) { return; }
        selectOption(start.group, to, false);
    }

    // Text typed into the overlay (the Tomorrow.io key field): mirrored into the shared state the way
    // the engine's #scroll input handler does. The country searchSelect's box lives in the top-layer
    // #modal (engine-wired), so this only sees embedded settings fields.
    function onInput(e) {
        var inp = e.target.closest('input[type=text][data-k]');
        if (!inp) { return; }
        var k = inp.getAttribute('data-k');
        run.ctx.S[k] = inp.value;
        if (k === 'tomorrowioApiKey') { run.tioTyped = true; onTomorrowioKey(inp.value); }
    }

    /**
     * A key typed into the Tomorrow.io card: a key makes Tomorrow.io the weather provider, clearing
     * it goes back to the country's (wizard-upsell.js providerFor), written with the provider's own
     * hook (the pollen cleanup). No re-render on keystrokes (focus would drop); the summary's Weather
     * and Forecast lines, whose long span is named by the provider's feed, update in place.
     * @param {*} key The key.
     * @returns {void}
     */
    function onTomorrowioKey(key) {
        var next = UPSELL.providerFor(run.ctx.S, key);
        if (next === run.ctx.S.provider) { return; }
        run.ctx.setValue('provider', next);
        var weather = run.overlay.querySelector('[data-wiz-sum-weather]');
        if (weather) { weather.textContent = settingLabel('provider', next) || '—'; }
        var forecast = run.overlay.querySelector('[data-wiz-sum-forecast]');
        if (forecast) { forecast.textContent = forecastLabel(); }
    }

    function ensureStyle() {
        if (document.getElementById('wiz-style')) { return; }
        var st = document.createElement('style');
        st.id = 'wiz-style';
        st.textContent = CSS.CSS;
        document.head.appendChild(st);
    }

    /**
     * Open setup: a new run over the page's ctx, replacing one already up ("Run setup again" while it
     * shows never stacks two).
     * @param {Object} ctx The page's ready ctx.
     * @param {boolean} fresh Opened by itself on a fresh install: the country is detected and derived.
     * @returns {void}
     */
    function openWizard(ctx, fresh) {
        if (run && run.overlay) { closeWizard(); }
        run = newRun(ctx, fresh);
        if (fresh) {
            // An undetected country, or one the holiday list doesn't offer (IN, AE, …), is 'none', NOT
            // the schema default 'DE', which would derive Germany's DWD weather and radar and German
            // holidays as if detected. mapCountry('none') is the "everyone else" row: Open-Meteo and
            // Rainbow, metric.
            var cc = CD.inferCountry();
            var country = FINISH.findItem(ctx.schema, 'holidayCountry');
            ctx.S.holidayCountry = (cc && labelFor(country.options, cc)) ? cc : 'none';
            ctx.S.holidayRegion = 'all';
            applyDerived(ctx.S);
        }
        if (run.steps.indexOf('forecast') !== -1) {
            // A graph set up in Settings, none of the looks: kept as "Your own", first.
            refreshLooks();
            if (!FORECAST.current(ctx.S, run.looks, run.env)) {
                run.own = FORECAST.snapshot(ctx.S, run.env);
                refreshLooks();
            }
        }
        ensureStyle();
        var overlay = document.createElement('div');
        overlay.id = 'wizard';
        // emery's screenshots are 200 px wide, the others 144: the CSS sizes each by its own width.
        overlay.className = shotPlatform() === 'emery' ? 'w200' : '';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'wiz-title');
        overlay.innerHTML = '<div class="wiz-top" data-wiz-top></div><div class="wiz-body" data-wiz-body></div>'
            + '<div class="wiz-foot" data-wiz-foot></div>';
        document.body.appendChild(overlay);
        run.overlay = overlay;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('input', onInput);
        overlay.addEventListener('keydown', onKeydown);
        overlay.addEventListener('touchstart', onTouchStart);
        overlay.addEventListener('touchend', onTouchEnd);
        renderStep('open');
        // After focus is inside the overlay, so it never sits in a subtree being hidden.
        hidePageBehind(true);
    }

    // Registration (a no-op where the engine isn't loaded).
    if (PConf.hooks && PConf.hooks.onReady) {
        PConf.hooks.onReady(function (ctx) {
            page.ctx = ctx;
            if (shouldShow(ctx.cfg)) { openWizard(ctx, true); }
        });
    }
    PConf.actions = PConf.actions || {};
    PConf.actions.startWizard = function () { if (page.ctx) { openWizard(page.ctx, false); } };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildSteps: buildSteps, shouldShow: shouldShow, applyDerived: applyDerived,
            shotGround: shotGround };
    }
})();

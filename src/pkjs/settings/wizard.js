// src/pkjs/settings/wizard.js — ES5, WebView. The first-run setup wizard: its steps, the picker they
// share and the overlay they run in. It opens by itself until onboarding is done (shouldShow), and
// again from Setup › Misc › Run setup again. Its parts live beside it: the styles (wizard-css.js),
// the Screens step's data (wizard-screens.js), the forecast step's looks and preview
// (wizard-forecast.js), the finishing defaults (wizard-finish.js) and the Tomorrow.io card
// (wizard-upsell.js). Driven in the tests through its real handlers on a fake DOM
// (test/helpers/wizard-dom.js).
//
// Each step is one screen: a progress bar and Back on top, the step in the middle, one primary
// button at the bottom. The layout and theme steps share a picker: the watch, large, showing the
// selected option's real screenshot, with the options as a segmented control below it (a radio
// group: tap, swipe the watch, or use the arrow keys). The Screens and forecast steps draw the
// watch's own screens live instead (preview-watch.js, as the Watchface tab does). Nothing is
// written until the user picks. The layout picks the Default screen and the Screens step the flick
// screens (screens-page.js writes both, as the Watchface tab's screen editor does).
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
    var SCREENS = node ? require('./wizard-screens.js') : window.WizardScreens;
    var FORECAST = node ? require('./wizard-forecast.js') : window.WizardForecast;
    // The screens: their lists (screens.js), their writes and pictures (screens-page.js, the
    // Watchface tab's) and their compile (view-cycle.js).
    var M = node ? require('../screens.js') : window.Screens;
    var SP = node ? require('./screens-page.js') : window.ScreensPage;
    var VC = node ? require('../view-cycle.js') : VIEW_CYCLE;
    var FINISH = node ? require('./wizard-finish.js') : window.WizardFinish;
    var UPSELL = node ? require('./wizard-upsell.js') : window.WizardUpsell;
    // The frame every screen picture sits in (the Watchface tab's too): the screen on its own ground.
    var FRAME = node ? require('./screen-frame.js') : window.ScreenFrame;

    /**
     * The steps. `when` names the env fact a step needs: the Screens step where the watch has a
     * screen to flick to (radar, false on aplite, whose one screen leaves nothing to add); the theme
     * where the watch ships the light polarity (themePolarity, compiled out on aplite); the forecast
     * step where it draws the line styles its looks are made of (lineStyles, false on aplite). The
     * layout makes the Default screen the Screens and forecast steps draw; the forecast step follows
     * the theme, so its preview is drawn in it. `summary` gives the last step's rows.
     */
    var STEPS = [
        { id: 'welcome', title: 'Welcome to WarnWeather', body: stepWelcome, summary: welcomeRows },
        { id: 'layout', title: 'Choose your layout', body: stepLayout, summary: pickerRow('Layout', 'layoutPreset', 'layout') },
        { id: 'screens', when: 'radar', title: 'Flick to switch screens', body: stepScreens, summary: screensRows },
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
     * The pickers. `options` and `desc` read the run; `selected` is read off the settings (the
     * layout from the Default screen, the forecast look from the graph, the length as the phone
     * reads it): only a highlight, the settings change on a real pick alone; `write` replaces the
     * plain write; `graph` previews in the forecast step's screen instead of a screenshot.
     */
    var PICKERS = {
        layoutPreset: {
            options: function () { return LAYOUT_OPTS; },
            desc: function () { return LAYOUT_DESC; },
            selected: currentLayout,
            write: pickLayout
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
            write: pickLook,
            graph: true
        },
        // emery only (the forecast step draws it where env.forecastSpan): the long span named by
        // the hours it shows for the provider and the look.
        forecastHours: {
            options: function () { return FORECAST.spanOptions(run.ctx.S, run.env); },
            desc: function () {
                var hints = FINISH.findItem(run.ctx.schema, 'forecastHours').hintByValue;
                return Object.assign({}, hints, FORECAST.SPAN_DESC);
            },
            selected: function () { return FORECAST.spanOf(run.ctx.S); },
            graph: true
        }
    };

    // Real watch screenshots, base64-inlined by `mise capture-wizard-screenshots` into
    // wizard-screenshots.generated.js (PConf.screenshots, concatenated ahead of this file).
    var SHOTS = PConf.screenshots || {};

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
            // The screen the Screens step shows big (the Default when the step opens), and whether
            // this run turned the rain radar on for the Rain radar screen it added (addTemplate).
            screenIdx: 0, radarOnForScreen: false,
            // Where a swipe on the picker's preview started; the latest screenshot swap.
            touch: null, shotSeq: 0,
            // The summary has been shown (footer); a Tomorrow.io key was typed in this run.
            reachedDone: false, tioTyped: false,
            // Where focus goes when setup closes onto the page: the row that re-ran it.
            returnFocus: fresh ? null : '[data-action="startWizard"]',
            // The forecast step's looks, and "Your own" (its values and length: refreshLooks).
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
     * A picker's value as the picker named it (the summary repeats what was tapped): the option it
     * shows as picked, else, for a stored value it doesn't offer, the settings page's name.
     * @param {string} group A picker.
     * @returns {string} Label.
     */
    function pickedLabel(group) {
        var v = highlighted(group);
        return labelFor(PICKERS[group].options(), v) || settingLabel(group, run.ctx.S[group]);
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
     * @param {string} shots The screen: a shotImage.
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
     * Pick a look: its graph, and on emery, when it is another look than the one the picker marks
     * (currentLook), the length it starts on (its span). The look marked keeps a length picked
     * under it, the first record too where a graph changed under setup draws none.
     * @param {string} id The look.
     * @returns {void}
     */
    function pickLook(id) {
        var look = lookById(id), anew = currentLook().id !== look.id;
        writeLook(look.values);
        if (anew && run.env.forecastSpan) { run.ctx.setValue('forecastHours', look.span); }
    }
    /**
     * Pick a theme: its conversion runs (the colours, and the bars' colour it starts on), "Your own"
     * converts along, and the look picked on the forecast step is laid on again if the conversion
     * moved it off (Weathergraph's Solid bars back to Multicolor on a dark theme).
     * @param {string} theme The theme picked.
     * @returns {void}
     */
    function pickTheme(theme) {
        var S = run.ctx.S, before = run.looks ? currentLook().id : null, oldTheme = S.theme;
        run.ctx.setValue('theme', theme);
        if (!run.looks) { return; }
        if (run.own) { FORECAST.followTheme(run.own.values, oldTheme, theme); }
        refreshLooks();
        var look = lookById(before);
        if (!FORECAST.same(S, look.values, run.env)) { writeLook(look.values); }
    }
    /**
     * The forecast look as its picker names it (the summary, the preview's label), and on emery
     * the length as its picker names it: "Weathergraph, 66 h".
     * @returns {string}
     */
    function forecastLabel() {
        var look = currentLook().label;
        return run.env.forecastSpan ? look + ', ' + pickedLabel('forecastHours') : look;
    }
    /**
     * The forecast step's picture: the first screen holding the forecast graph (the Default,
     * unless a screen of the user's own moved it) as the watch draws it, the look applied; with no
     * screen showing the forecast graph, the graph on its own.
     * @returns {{svg: string, label: string, onScreen: boolean}} Its SVG markup, its spoken name
     *   and whether it is a screen.
     */
    function forecastPicture() {
        var cycle = VC.screensCycle(run.ctx.S, run.env), list = screens(cycle), i = -1;
        for (var j = 0; j < list.length && i < 0; j += 1) { if (M.idxOf(list[j], 'fc') >= 0) { i = j; } }
        return {
            svg: i >= 0 ? screenPic(run.ctx.S, i, 'wf' + i + '-', cycle).svg
                : FORECAST.previewSvg(run.ctx.S, run.env, run.ctx.USERDATA),
            label: 'Forecast preview: ' + forecastLabel() + (i >= 0 ? ', on the ' + SCREENS.nameOf(list[i], i) + ' screen' : ''),
            onScreen: i >= 0
        };
    }
    /**
     * Redraw the forecast step's picture and its length row: the long span's label follows the
     * look (the high and low on the graph widen its plot, so it names more hours), and the
     * length picked is marked (a look picked anew starts on its own: pickLook).
     * @returns {void}
     */
    function refreshForecast() {
        var graph = run.overlay.querySelector('[data-wiz-graph]');
        if (graph) {
            var pic = forecastPicture();
            graph.innerHTML = pic.svg;
            graph.setAttribute('aria-label', pic.label);
        }
        if (!run.env.forecastSpan) { return; }
        var opts = optsFor('forecastHours'), segs = run.overlay.querySelectorAll('[data-wiz-group="forecastHours"]');
        for (var i = 0; i < segs.length; i += 1) { segs[i].textContent = labelFor(opts, segs[i].getAttribute('data-wiz-opt')); }
        markPicked('forecastHours', highlighted('forecastHours'), false);
    }
    /**
     * What the forecast graph draws from: its governed settings and its length. A pick that leaves
     * them unchanged redraws nothing.
     * @returns {string}
     */
    function graphState() { return JSON.stringify(FORECAST.state(run.ctx.S, run.env)); }

    // --- the picker ---
    function optsFor(group) { return PICKERS[group].options(); }
    function descFor(group) { return PICKERS[group].desc(); }
    /**
     * The option a picker shows as selected: what its `selected` reads off the settings, else the
     * stored value when the picker offers it, else its first option.
     * @param {string} group A picker.
     * @returns {string} An option value.
     */
    function highlighted(group) {
        var picker = PICKERS[group];
        if (picker.selected) { return picker.selected(); }
        var opts = picker.options(), stored = run.ctx.S[group];
        return labelFor(opts, stored) ? stored : opts[0][1];
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
     * @param {string} group 'layoutPreset' | 'theme'.
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
        markPicked(group, val, focus);
        if (!graph) {
            swapShot(group, val);
        } else if (graphState() !== before) {
            refreshForecast();
        }
    }
    /**
     * Show a picker's option as picked, in place: its segment on (and focused, for the arrow keys),
     * the others off, and its description.
     * @param {string} group A picker.
     * @param {string} val The option.
     * @param {boolean} focus Move keyboard focus to its segment.
     * @returns {void}
     */
    function markPicked(group, val, focus) {
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
    }

    // --- the layout: the Default screen ---
    /**
     * The layout the Layout picker shows as picked: what the Default screen reads as (its
     * calendar's rows, or none) on a watch with screens; on aplite the stored layout, or the
     * nearest the picker offers.
     * @returns {string} 'fullCal' | 'compactCal' | 'noCal'
     */
    function currentLayout() {
        if (SP.hasScreens(run.env)) { return SCREENS.layoutOf(screens()[0]); }
        var v = run.ctx.S.layoutPreset;
        return labelFor(LAYOUT_OPTS, v) ? v : (SCREENS.NEAREST_LAYOUT[v] || 'compactCal');
    }
    /**
     * Pick a layout. On a watch with screens it makes the Default screen alone (the flick screens
     * are the Screens step's): the preset's own Default view, the one its three-screen cycle starts
     * with, compiled back to the per-view keys of slot 0 (view-cycle.js specToKeys), as a screen
     * edit (screens-page.js editScreens). aplite keeps the preset.
     * @param {string} layout 'fullCal' | 'compactCal' | 'noCal'.
     * @returns {void}
     */
    function pickLayout(layout) {
        var S = run.ctx.S;
        if (!SP.hasScreens(run.env)) { run.ctx.setValue('layoutPreset', layout); return; }
        var keys = VC.specToKeys([VC.buildViewCycle(layout, 'off', 'off', S.swapClockStatus !== false)[0]]);
        SP.editScreens(S, run.env, function () {
            Object.keys(keys).forEach(function (k) { if (k !== 'viewCount') { S[k] = keys[k]; } });
            return true;
        });
    }

    // --- the Screens step: the watch's own screens, drawn live ---
    /**
     * The watch's screens as lists (screens.js screensOf).
     * @param {Array<?Object>} [cycle] VC.screensCycle of the live settings, when the caller has it.
     * @returns {Array<Array<Object>>} The screens, the Default first.
     */
    function screens(cycle) { return M.screensOf(run.ctx.S, run.env, cycle); }
    /**
     * One screen as the screen editor draws it (screens-page.js screenPicture), in the wizard's
     * frame: its <svg> and its bands as spoken. A screen with nothing on it is its bare screen.
     * @param {Object} S The settings it is drawn from (the live ones, or a copy with a screen in).
     * @param {number} i Its slot.
     * @param {string} prefix What its graphs' ids start with, unique on the page.
     * @param {Array<?Object>} [cycle] VC.screensCycle(S), when the caller has it already.
     * @returns {{svg: string, label: string}}
     */
    function screenPic(S, i, prefix, cycle) {
        var pic = SP.screenPicture(S, i, run.env, run.ctx.USERDATA, prefix, cycle);
        // The wizard's frame class, whose widths follow the screenshots' (wizard-css.js).
        return { svg: pic.svg.replace('class="wpv-scr"', 'class="wiz-scr"'), label: pic.label };
    }
    /**
     * The settings with a screen setup offers put in where it would go, to draw it before it is
     * added (and the rain radar on, as adding the Rain radar screen turns it). A shallow copy is
     * enough: putting a screen in writes top-level keys only.
     * @param {string} id A template.
     * @param {Array<Array<Object>>} list The watch's screens.
     * @returns {{S: Object, at: number}} The settings and the screen's slot.
     */
    function withTemplate(id, list) {
        var S = Object.assign({}, run.ctx.S), at = SCREENS.insertAt(list, id);
        if (id === 'radar') { S.radarEnabled = true; }
        SP.insertScreen(S, at, M.copy(SCREENS.byId(id).list), run.env);
        return { S: S, at: at };
    }
    /**
     * The cycle's dots, the current one highlighted; its name sits beside them, so the position is
     * never told by colour alone.
     * @param {number} count Screens.
     * @param {number} idx Current screen.
     * @returns {string} HTML.
     */
    function flickDotsHtml(count, idx) {
        var h = '';
        for (var i = 0; i < count; i += 1) { h += '<span class="wiz-dot' + (i === idx ? ' on' : '') + '"></span>'; }
        return h;
    }
    /**
     * The screen shown big, its dots and name, and Try a flick (off until there is a screen to
     * flick to).
     * @param {Array<Array<Object>>} list The screens.
     * @param {Array<?Object>} cycle Their views (VC.screensCycle).
     * @returns {string} HTML.
     */
    function bigScreenHtml(list, cycle) {
        var i = run.screenIdx, many = list.length > 1, name = SCREENS.nameOf(list[i], i);
        var pic = screenPic(run.ctx.S, i, 'wz' + i + '-', cycle);
        return '<div class="wiz-stage big"><div class="wiz-flick-watch" data-wiz-flick-watch' + (many ? ' data-wiz-flick' : '') + '>'
            + '<div class="wiz-watch" data-wiz-screen role="img" aria-label="' + esc(name + ': ' + pic.label) + '">'
            + pic.svg + '</div></div></div>'
            + '<div class="wiz-flick-track"><span data-wiz-flick-dots>' + flickDotsHtml(list.length, i) + '</span>'
            + '<span class="wiz-flick-label" data-wiz-flick-label aria-live="polite">' + esc(name) + '</span></div>'
            + '<button type="button" class="wiz-try" data-wiz-flick' + (many ? '' : ' disabled') + '>' + CSS.ICON_FLICK
            + 'Try a flick</button>';
    }
    /**
     * Every screen small: each in full, a ✕ on each flick screen; then each screen setup offers
     * that the watch can show and has not got, dimmed, with a + that adds it, while there is room.
     * @param {Array<Array<Object>>} list The screens.
     * @param {Array<?Object>} cycle Their views (VC.screensCycle).
     * @returns {string} HTML.
     */
    function smallScreensHtml(list, cycle) {
        var h = '';
        list.forEach(function (scr, i) {
            var name = SCREENS.nameOf(scr, i), pic = screenPic(run.ctx.S, i, 'ws' + i + '-', cycle);
            h += '<div class="wiz-scr-it"><div class="wiz-watch sm" role="img" aria-label="' + esc(name + ': ' + pic.label)
                + '">' + pic.svg + '</div>'
                + (i > 0 ? '<button type="button" class="wiz-scr-x" data-wiz-scr-rm="' + i + '" aria-label="Remove the '
                    + esc(name) + ' screen">' + CSS.ICON_X + '</button>' : '')
                + '<span class="wiz-scr-n">' + esc(name) + '</span></div>';
        });
        if (list.length >= M.MAX_SCREENS) { return h; }
        SCREENS.offered(run.env).forEach(function (t) {
            if (SCREENS.slotOf(list, t.id) >= 0) { return; }
            var w = withTemplate(t.id, list), pic = screenPic(w.S, w.at, 'wt' + t.id + '-');
            h += '<button type="button" class="wiz-scr-it off" data-wiz-scr-add="' + t.id + '" aria-label="Add the '
                + esc(t.name) + ' screen"><span class="wiz-watch sm" aria-hidden="true">' + pic.svg + '</span>'
                + '<span class="wiz-scr-plus" aria-hidden="true">+</span><span class="wiz-scr-n">' + esc(t.name) + '</span></button>';
        });
        return h;
    }
    /**
     * Repaint the step after a screen went in or out, the one shown big kept where it can be, and
     * put focus on the control a tap there would want next.
     * @param {Array<string>} focus Selectors, the first one rendered wins.
     * @returns {void}
     */
    function repaintScreens(focus) {
        renderStep('stay');
        for (var i = 0; i < focus.length; i += 1) {
            var el = run.overlay.querySelector(focus[i]);
            if (el && !el.disabled) { el.focus(); return; }
        }
    }
    /**
     * Add a screen setup offers, where it goes (screens-page.js insertScreen, as + Add screen
     * writes one), and show it big. The Rain radar screen turns the rain radar on (and taking
     * it out again turns it back off: removeScreen).
     * @param {string} id A template.
     * @returns {void}
     */
    function addTemplate(id) {
        var S = run.ctx.S, at = SCREENS.insertAt(screens(), id);
        var turnOn = id === 'radar' && S.radarEnabled === false;
        if (turnOn) { SP.setRadarEnabled(S, true, run.env); }
        if (SP.insertScreen(S, at, M.copy(SCREENS.byId(id).list), run.env)) {
            run.screenIdx = at;
            if (turnOn) { run.radarOnForScreen = true; }
        } else if (turnOn) {
            SP.setRadarEnabled(S, false, run.env);
        }
        repaintScreens(['[data-wiz-scr-rm="' + at + '"]', '[data-wiz-flick]']);
    }
    /**
     * Remove a flick screen (screens-page.js deleteScreen: the ones after it move up). The Rain
     * radar screen this run added with the rain radar off takes the radar off with it again.
     * @param {number} i Its slot.
     * @returns {void}
     */
    function removeScreen(i) {
        var t = SCREENS.templateOf(screens()[i]);
        if (SP.deleteScreen(run.ctx.S, i, run.env)) {
            if (run.screenIdx === i) { run.screenIdx = 0; } else if (run.screenIdx > i) { run.screenIdx -= 1; }
            if (t && t.id === 'radar' && run.radarOnForScreen) {
                run.radarOnForScreen = false;
                SP.setRadarEnabled(run.ctx.S, false, run.env);
            }
        }
        repaintScreens((t ? ['[data-wiz-scr-add="' + t.id + '"]'] : []).concat(['[data-wiz-flick]', '[data-wiz-title]']));
    }
    /**
     * Show a screen big: its picture, its dots and its name. The step may have changed, or setup
     * closed, by the snap.
     * @param {number} idx Its slot.
     * @returns {void}
     */
    function showScreen(idx) {
        if (!run || !run.overlay || run.steps[run.idx] !== 'screens') { return; }
        var list = screens();
        if (idx >= list.length) { return; }
        var pic = screenPic(run.ctx.S, idx, 'wz' + idx + '-'), name = SCREENS.nameOf(list[idx], idx);
        var scr = run.overlay.querySelector('[data-wiz-screen]');
        if (scr) {
            scr.innerHTML = pic.svg;
            scr.setAttribute('aria-label', name + ': ' + pic.label);
        }
        var dots = run.overlay.querySelector('[data-wiz-flick-dots]');
        if (dots) { dots.innerHTML = flickDotsHtml(list.length, idx); }
        var lbl = run.overlay.querySelector('[data-wiz-flick-label]');
        if (lbl) { lbl.textContent = name; }
    }
    /**
     * Flick to the next screen (wrapping to the Default): replay the tilt on the watch and swap the
     * picture on the snap (150 ms into the 450 ms tilt). Under reduced motion the CSS drops the tilt.
     * @returns {void}
     */
    function advanceFlick() {
        var count = screens().length;
        if (count < 2) { return; }
        run.screenIdx = (run.screenIdx + 1) % count;
        var idx = run.screenIdx;
        var watch = run.overlay.querySelector('[data-wiz-flick-watch]');
        if (watch) {
            watch.className = 'wiz-flick-watch';    // restart the animation:
            void watch.offsetWidth;                 // force a reflow between the class flips
            watch.className = 'wiz-flick-watch tilt';
        }
        setTimeout(function () { showScreen(idx); }, 150);
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
    /**
     * The Screens step: the screen shown big, the flick, then every screen small and the ones setup
     * offers. The rain alert keeps its place on the Watch bar whatever is added.
     * @returns {string} HTML.
     */
    function stepScreens() {
        var cycle = VC.screensCycle(run.ctx.S, run.env), list = screens(cycle);
        if (run.screenIdx >= list.length) { run.screenIdx = 0; }
        return stepHead('screens')
            + '<p class="wiz-lead">Add screens to flick to. The watch goes back to Default by itself.</p>'
            + '<div class="wiz-flick">' + bigScreenHtml(list, cycle) + '</div>'
            + '<div class="wiz-scrs" role="group" aria-label="Your screens">' + smallScreensHtml(list, cycle) + '</div>'
            + '<p class="wiz-fine">Rain alerts show on the Watch bar either way. Change screens later on the Watchface tab.</p>';
    }
    function stepTheme() {
        return stepHead('theme') + pickerHtml('theme')
            + (run.env.color ? '<p class="wiz-fine">You can fine-tune any colour later in Settings.</p>' : '');
    }
    /**
     * The forecast step: the screen with the forecast graph (the Default), drawn live in the picked
     * look (a swipe across it steps through the looks), then the looks, and on emery the length.
     * @returns {string} HTML.
     */
    function stepForecast() {
        var pic = forecastPicture();
        return stepHead('forecast')
            + '<div class="wiz-stage' + (pic.onScreen ? ' big' : '') + '" data-wiz-preview="forecastLook">'
            + '<div class="' + (pic.onScreen ? 'wiz-watch wiz-look' : 'wiz-graph') + '" data-wiz-graph role="img" aria-label="'
            + esc(pic.label) + '">' + pic.svg + '</div>'
            + '</div>' + optsHtml('forecastLook', 'wiz-title')
            + (run.env.forecastSpan ? '<h3 class="wiz-sub" id="wiz-span">Forecast length</h3>' + optsHtml('forecastHours', 'wiz-span') : '')
            + '<p class="wiz-fine">Every line can be changed later on the Graphs tab.</p>';
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
     * The Screens step's summary row: the screens by name.
     * @returns {Array.<Object>} The row.
     */
    function screensRows() {
        var list = screens();
        return [{ k: 'Screens', v: list.map(function (scr, i) { return SCREENS.nameOf(scr, i); }).join(', '), step: 'screens' }];
    }
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
        // The Screens step opens on the Default; a repaint in place keeps the screen shown.
        if (id === 'screens' && !stay) { run.screenIdx = 0; }
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
        // The finishing defaults are applied BEFORE the exit, so they ride the save (or show on the
        // settings page the user is dropped onto); applyWizardDefaults decides which navs finish
        // setup. Their health rule reads the health mode the screens gave (a Health screen added
        // turns it on, screens-page.js applyModes).
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
        if ((t = e.target.closest('[data-wiz-scr-add]'))) { addTemplate(t.getAttribute('data-wiz-scr-add')); return; }
        if ((t = e.target.closest('[data-wiz-scr-rm]'))) { removeScreen(Number(t.getAttribute('data-wiz-scr-rm'))); return; }
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
            refreshLooks();
            if (!FORECAST.current(ctx.S, run.looks, run.env)) {
                if (fresh) {
                    // A fresh install's graph is the defaults, none of the looks on emery (the long
                    // span and the high and low on the graph, without the clouds' stripe): it starts
                    // on the first-run look, nothing set up in Settings to keep as "Your own".
                    pickLook(FORECAST.FIRST_RUN);
                } else {
                    // A graph set up in Settings, none of the looks: kept as "Your own", first.
                    run.own = FORECAST.state(ctx.S, run.env);
                    refreshLooks();
                }
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

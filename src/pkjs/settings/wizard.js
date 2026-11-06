// src/pkjs/settings/wizard.js — ES5, WebView. First-run onboarding wizard.
// Pure helpers (top) are unit-tested via module.exports; the DOM controller (added later)
// registers onReady + PConf.actions.startWizard and is exercised via `mise preview-config`.
/* global PConf, Intl, navigator, document, console, INJECTED_SCHEMA, VIEW_CYCLE, COUNTRY_DEFAULTS */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    // Node (tests): view-cycle.js is a real CommonJS module — require it. Webview: it is
    // concatenated as a plain <script> before this file (scripts/build-config-page.js) and
    // shares the top-level scope as VIEW_CYCLE. Same pattern as settings/blocks.js.
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;

    // Country → recommended providers + locale units. Extracted to settings/country-defaults.js so the
    // wizard's fresh-install picks and the Provider-settings "(Recommended)" dropdown hints share ONE
    // mapping (no drift). Node require()s it; the webview reads the concatenated COUNTRY_DEFAULTS global
    // (same dual-mode pattern as VIEW_CYCLE above). The local aliases keep the rest of this file + the
    // module.exports unchanged.
    var CD = (typeof require !== 'undefined') ? require('./country-defaults.js') : COUNTRY_DEFAULTS;
    var countryFromTimezone = CD.countryFromTimezone;
    var countryFromLocale = CD.countryFromLocale;
    var inferCountry = CD.inferCountry;
    var mapCountry = CD.mapCountry;

    /**
     * Ordered wizard step ids, filtered by platform env: health only where the platform
     * has it, the flick demo only where there is a second view to flick to (env.radar
     * — false on aplite, whose single view leaves nothing to demo), and the theme step
     * only where the watch ships the light polarity (env.themePolarity — false on aplite,
     * where WW_THEME_POLARITY is compiled out and a choice would be a silent no-op).
     * layout and health are the selection steps that shape the cycle, so the demo comes
     * after both and shows the user's real cycle.
     * @param {{radar: boolean, health: boolean, themePolarity: boolean}} env Config-UI env facts.
     * @returns {Array.<string>} Step ids in order.
     */
    function buildSteps(env) {
        env = env || {};
        var steps = ['welcome', 'layout'];
        if (env.health) { steps.push('health'); }
        if (env.radar) { steps.push('flick'); }
        if (env.themePolarity) { steps.push('theme'); }
        steps.push('done');
        return steps;
    }

    // Per-stop demo copy. The Default and radar captions are fixed (the radar copy stays
    // provider-agnostic — no provider named; its "Rain in 15’" is the rain alert's default
    // 'text' look, and Rain is ticked on the Watch Status Bar's left side by default); the
    // health-status and health-graph captions vary with heart-rate availability (emery +
    // diorite hardware) and are built from the shared item helpers below, so the health
    // step and the flick demo can never drift.
    var FLICK_CAPTION_DEFAULT = 'your calendar, the Forecast Status Bar, and the forecast.';
    var FLICK_CAPTION_RADAR = 'a precise short-term rain forecast for the next 2 hours, in 5-minute frames. When rain’s on the way, the Watch Status Bar counts it down at its edge (“Rain in 15’”).';

    /**
     * Health status-line contents, with the heart-rate clause only where the hardware has a
     * heart-rate sensor (emery). Shared by the health step and the flick demo.
     * @param {boolean} hasHeartRate Whether the platform has a heart-rate sensor.
     * @returns {string} e.g. "today’s steps, last night’s sleep and current heart rate".
     */
    function healthStatusItems(hasHeartRate) {
        return hasHeartRate
            ? 'today’s steps, last night’s sleep and current heart rate'
            : 'today’s steps, last night’s sleep and walked distance';
    }
    /**
     * Health-graph contents, with the heart-rate line only where the hardware has a
     * heart-rate sensor (emery). Shared by the health step and the flick demo.
     * @param {boolean} hasHeartRate Whether the platform has a heart-rate sensor.
     * @returns {string} e.g. "step bars, a sleep band and a heart-rate line".
     */
    function healthGraphItems(hasHeartRate) {
        return hasHeartRate ? 'step bars, a sleep band and a heart-rate line' : 'step bars and a sleep band';
    }

    /**
     * Describe one cycle slot as a flick-demo stop: display label, caption, and the
     * SHOTS screenshot key. shotGroup 'radar' flags the string-typed radar shot
     * (SHOTS[platform].radar is a plain data URI, not a {val: uri} map).
     * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}} viewSpec One ViewSpec slot.
     * @param {boolean} isFirst True for cycle index 0 (the default view).
     * @param {Object} state Wizard/Clay settings state.
     * @param {boolean} hasHeartRate Whether the platform has a heart-rate sensor (emery).
     * @returns {{label:string,caption:string,shotGroup:string,shotVal:string}} Stop descriptor.
     */
    function flickStop(viewSpec, isFirst, state, hasHeartRate) {
        state = state || {};
        if (viewSpec.body === VC.BODY_GRAPH) {
            return { label: 'Health graph', caption: 'hourly ' + healthGraphItems(hasHeartRate) + '.', shotGroup: 'healthMode', shotVal: 'all' };
        }
        if (viewSpec.body === VC.BODY_RADAR) {
            return { label: 'Radar', caption: FLICK_CAPTION_RADAR, shotGroup: 'radar', shotVal: '' };
        }
        if (!isFirst && (viewSpec.statusUpper === VC.STATUS_SRC_HEALTH || viewSpec.statusLower === VC.STATUS_SRC_HEALTH)) {
            // Health-status flick stop: BODY_FC carrying a HEALTH status row, in either the
            // upper (single-status) or lower (health-dense default's paired forecast row on
            // top) slot — healthMode.status represents both.
            return { label: 'Health Status Bar', caption: healthStatusItems(hasHeartRate) + ' on the Health Status Bar.', shotGroup: 'healthMode', shotVal: 'status' };
        }
        var pk = VC.resolvePresetKey(state);
        if (pk === 'compactDense') { pk = 'compactCal'; } // no captured shot for compactDense; compactCal is the nearest (same 2-row calendar)
        if (pk === 'weatherOnly') { pk = 'noCal'; }       // no captured shot for Weather only; No calendar is the nearest (no calendar, big forecast)
        return { label: 'Default', caption: FLICK_CAPTION_DEFAULT, shotGroup: 'layoutPreset', shotVal: pk };
    }

    /**
     * The flick-demo stop list for the current settings: the REAL view cycle
     * (view-cycle.js — the same call preview-layout.js's presetContents makes) mapped to
     * stop descriptors. 1–3 entries; radar, when present, is always last.
     * @param {Object} state Wizard/Clay settings state.
     * @param {boolean} hasHeartRate Whether the platform has a heart-rate sensor (emery).
     * @returns {Array.<{label:string,caption:string,shotGroup:string,shotVal:string}>} Stops.
     */
    function flickStops(state, hasHeartRate) {
        state = state || {};
        var radarMode = state.radarMode || 'graph';
        var cycle = VC.buildViewCycle(VC.resolvePresetKey(state), state.healthMode || 'off', radarMode);
        var stops = [], i;
        for (i = 0; i < cycle.length; i += 1) { stops.push(flickStop(cycle[i], i === 0, state, hasHeartRate)); }
        return stops;
    }

    /**
     * Whether the wizard should auto-open: whenever onboarding hasn't been completed.
     * Not "the config has no keys": PKJS seeds the full defaults blob on the first boot,
     * before any settings page can open, so a fresh install never arrives empty. Existing
     * installs are marked onboarded by a one-time phone-side migration
     * (migrations/onboarding.js migrateExistingInstallOnboarded), so only a fresh
     * install — or one just reset — still reads false here. An empty config (a reset,
     * reopened in the same PKJS session) has no onboardingDone and opens it too.
     * @param {?Object} cfg Raw injected saved config.
     * @returns {boolean} True to auto-open.
     */
    function shouldShow(cfg) {
        cfg = cfg || {};
        return !cfg.onboardingDone;
    }

    // ---- DOM controller (webview only; exercised via `mise preview-config` and the fake DOMs in
    // test/config-wizard*.test.js) ----
    //
    // Each step is one screen: a progress bar and Back on top, the step in the middle, one primary
    // button at the bottom. The layout, health and theme steps share a picker: the watch, large,
    // showing the selected option's real screenshot, with the options as a segmented control below
    // it (a radio group: tap, swipe the watch, or use the arrow keys). Nothing is written until the
    // user picks.

    var LAYOUT_OPTS = [['Full calendar', 'fullCal'], ['Compact', 'compactCal'], ['No calendar', 'noCal']];
    // 'slot' (Status-slots-only) is intentionally NOT offered here: it's a main-settings-only mode with
    // no dedicated Health view and no wizard screenshot, so the screenshot-driven picker skips it. The
    // full option set still lives on the Health tab (schema.js).
    var HEALTH_OPTS = [['Off', 'off'], ['Status bar', 'status'], ['Status bar + graph', 'all']];
    // Watchface theme (messageKey 'theme'). Mirrors schema.js's two theme selects: color watches get
    // 4 options, B&W hardware only dark/light. Chosen by env.color at render time.
    var THEME_OPTS_COLOR = [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W inverted', 'bw-light']];
    var THEME_OPTS_BW = [['Dark', 'dark'], ['Light', 'light']];

    // Each step's small label above its title, and the title.
    var STEP_META = {
        welcome: { eyebrow: '', title: 'Welcome to WarnWeather' },
        layout: { eyebrow: 'Layout', title: 'Choose your layout' },
        health: { eyebrow: 'Health', title: 'Health on your watch' },
        flick: { eyebrow: 'Views', title: 'Flick to switch views' },
        theme: { eyebrow: 'Theme', title: 'Choose a theme' },
        done: { eyebrow: '', title: 'You’re all set' }
    };

    // The selected option's description under each picker: one sentence.
    var LAYOUT_DESC = {
        fullCal: 'A three-row month grid with today highlighted, above the forecast.',
        compactCal: 'A slim agenda row, leaving more room for the 24-hour forecast.',
        noCal: 'A big clock and date above a full-size forecast.'
    };
    /**
     * healthMode descriptions, built at READ time so the heart-rate variant follows the live env.
     * @param {boolean} hasHr Whether the platform has a heart-rate sensor.
     * @returns {{off: string, status: string, all: string}} Per-mode descriptions.
     */
    function healthDesc(hasHr) {
        return {
            off: 'No health information on the watchface.',
            status: capitalize(healthStatusItems(hasHr)) + ' on the Health Status Bar.',
            all: 'The Health Status Bar plus an hourly graph: ' + healthGraphItems(hasHr) + '.'
        };
    }
    var THEME_DESC = {
        dark: 'Black background with white text and lines. The default, and the most tuned theme.',
        light: 'White background with black text and lines.',
        bw: 'Black and white only: simple and clean, with good contrast.',
        'bw-light': 'Black and white, inverted: simple and clean, with good contrast.'
    };
    // Real watch screenshots, base64-inlined by `mise capture-wizard-screenshots` into
    // wizard-screenshots.generated.js (which assigns PConf.screenshots when concatenated into the
    // page). Empty {} in the Node harness — the controller runs only in the webview.
    var SHOTS = (PConf && PConf.screenshots) ? PConf.screenshots : {};

    // Line icons, drawn in the text colour.
    var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    var ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var ICON_FLICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';

    // Overlay styles: the app's CSS custom properties, so the wizard follows body.light (theme). The
    // brand red #FA4A35 and its gradient are hardcoded to match .hdr h1 / .saveBtn / .tab.on.
    var ACCENT_FILL = 'linear-gradient(135deg,#FA4A35,#D93A24)';
    var FONT = 'Inter,-apple-system,system-ui,sans-serif';
    var WIZ_CSS =
        '#wizard{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:' + FONT + '}'
        + '#wizard [hidden]{display:none!important}'
        // top bar: Back, the progress bar, and a spacer Back's width so the bar stays centred
        + '#wizard .wiz-top{flex:none;display:flex;align-items:center;padding:10px 12px 2px}'
        + '#wizard .wiz-back,#wizard .wiz-top-pad{flex:none;width:40px;height:40px}'
        + '#wizard .wiz-back{display:flex;align-items:center;justify-content:center;padding:0;border:none;'
        + 'border-radius:12px;background:transparent;color:var(--fg);cursor:pointer}'
        + '#wizard .wiz-back svg{width:22px;height:22px}'
        + '#wizard .wiz-back:active{background:var(--ctl)}'
        + '#wizard .wiz-progress{flex:1;display:flex;margin:0 6px}'
        + '#wizard .wiz-seg{flex:1;height:4px;margin:0 2px;border-radius:2px;background:var(--ctl-line);'
        + 'transition:background .25s}'
        + '#wizard .wiz-seg.done,#wizard .wiz-seg.on{background:#FA4A35}'
        // the step
        + '#wizard .wiz-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 20px 22px}'
        + '#wizard .wiz-step{animation:wiz-in-r .32s cubic-bezier(.2,.7,.3,1) both}'
        + '#wizard .wiz-step.back{animation-name:wiz-in-l}#wizard .wiz-step.still{animation:none}'
        + '#wizard .wiz-eyebrow{margin:8px 0 2px;font:800 12px ' + FONT + ';letter-spacing:.09em;'
        + 'text-transform:uppercase;color:var(--link)}'
        + '#wizard .wiz-title{margin:0 0 8px;font:800 25px/1.2 ' + FONT + ';letter-spacing:-.02em;color:var(--fg);'
        + 'outline:none}'
        + '#wizard .wiz-lead{margin:0 0 6px;font-size:15px;line-height:1.55;color:var(--muted)}'
        + '#wizard p{line-height:1.55}#wizard a{color:var(--link)}'
        // the watch: a dark bezel around a real screenshot, on a soft red glow
        + '#wizard .wiz-stage{display:flex;justify-content:center;padding:14px 0 8px;'
        + 'background:radial-gradient(closest-side,rgba(250,74,53,.2),rgba(250,74,53,0))}'
        + '#wizard .wiz-watch{display:inline-block;padding:9px;border-radius:24px;'
        + 'background:linear-gradient(160deg,#34353A,#141518);'
        + 'box-shadow:0 14px 34px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08)}'
        + 'body.light #wizard .wiz-watch{box-shadow:0 12px 28px rgba(0,0,0,.24),inset 0 0 0 1px rgba(255,255,255,.08)}'
        + '#wizard .wiz-shot{display:block;width:150px;height:auto;border-radius:5px;image-rendering:pixelated;'
        + 'transition:opacity .16s}'
        + '#wizard .wiz-stage.big .wiz-shot{width:230px;width:min(62vw,252px)}'
        + '#wizard .wiz-shot.fade{opacity:0}'
        // the options: a segmented control under the watch (a radio group), one row whatever the count;
        // a long label wraps inside its own segment
        + '#wizard .wiz-opts{display:flex;margin:16px 0 0;padding:4px;border:1px solid var(--ctl-line);'
        + 'border-radius:14px;background:var(--ctl)}'
        + '#wizard .wiz-opt{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;'
        + 'min-height:44px;padding:6px 8px;border:none;border-radius:10px;background:transparent;color:var(--muted);'
        + 'font:600 13.5px/1.25 ' + FONT + ';text-align:center;cursor:pointer;'
        + 'transition:background .15s,color .15s,box-shadow .15s}'
        + '#wizard .wiz-opt+.wiz-opt{margin-left:4px}'
        + '#wizard .wiz-opt.on{background:' + ACCENT_FILL + ';color:#FFFFFF;box-shadow:0 3px 10px rgba(250,74,53,.35)}'
        + '#wizard .wiz-desc{min-height:3.1em;margin:12px 0 0;text-align:center;font-size:14.5px;line-height:1.5;'
        + 'color:var(--fg)}'
        + '#wizard button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}'
        // cards: the country on the welcome step, the layout legend, the summary, the upsell
        + '#wizard .wiz-card,#wizard .wiz-legend,#wizard .wiz-sum,#wizard .wiz-tio{margin:18px 0 0;'
        + 'border:1px solid var(--card-line);border-radius:16px;background:var(--card);overflow:hidden}'
        + '#wizard .wiz-card-hd{padding:14px 16px 0;font:800 11.5px ' + FONT + ';letter-spacing:.1em;'
        + 'text-transform:uppercase;color:var(--ttl)}'
        + '#wizard .wiz-note{margin:0;padding:10px 16px 14px;font-size:13px;line-height:1.5;color:var(--hint)}'
        + '#wizard .wiz-legend{padding:2px 16px}'
        + '#wizard .wiz-legend p{margin:12px 0;font-size:13.5px;color:var(--muted)}'
        + '#wizard .wiz-legend b{color:var(--fg)}'
        // the flick demo
        + '#wizard .wiz-flick{text-align:center}'
        + '#wizard .wiz-flick-watch{display:inline-block;cursor:pointer;transform-origin:50% 100%}'
        + '#wizard .wiz-flick-watch.tilt{animation:wiz-tilt .45s ease-in-out}'
        + '#wizard .wiz-flick-stack{position:relative}'
        + '#wizard .wiz-flick-shot{opacity:0;transition:opacity .18s}'
        + '#wizard .wiz-flick-shot.on{opacity:1}'
        + '#wizard .wiz-flick-shot+.wiz-flick-shot{position:absolute;top:0;left:0}'
        + '#wizard .wiz-flick-track{display:flex;align-items:center;justify-content:center;margin:12px 0 0}'
        + '#wizard .wiz-dot{display:inline-block;width:7px;height:7px;margin:0 3px;border-radius:50%;'
        + 'background:var(--muted);opacity:.35;vertical-align:middle;transition:opacity .2s,background .2s}'
        + '#wizard .wiz-dot.on{background:#FA4A35;opacity:1}'
        + '#wizard .wiz-flick-label{margin-left:8px;font:700 13px ' + FONT + '}'
        + '#wizard .wiz-try{display:inline-flex;align-items:center;min-height:44px;margin:14px 0 0;padding:10px 20px;'
        + 'border:1px solid var(--ctl-line);border-radius:999px;background:var(--ctl);color:var(--fg);'
        + 'font:700 14px ' + FONT + ';cursor:pointer}'
        + '#wizard .wiz-try svg{width:18px;height:18px;margin-right:8px}'
        // the last step
        + '#wizard .wiz-step.last .wiz-title,#wizard .wiz-step.last .wiz-lead{text-align:center}'
        + '#wizard .wiz-badge{display:flex;align-items:center;justify-content:center;width:68px;height:68px;'
        + 'margin:20px auto 14px;border-radius:50%;background:' + ACCENT_FILL + ';'
        + 'box-shadow:0 10px 26px rgba(250,74,53,.4);animation:wiz-pop .5s cubic-bezier(.2,.9,.3,1.25) both}'
        + '#wizard .wiz-badge svg{width:34px;height:34px}'
        + '#wizard .wiz-sum{margin-top:20px;padding:0;list-style:none}'
        + '#wizard .wiz-sum li{display:flex;align-items:center;min-height:50px;padding:4px 6px 4px 16px;'
        + 'border-bottom:1px solid var(--row-line)}'
        + '#wizard .wiz-sum li:last-child{border-bottom:none}'
        + '#wizard .wiz-sum .k{flex:none;width:84px;font-size:13px;color:var(--muted)}'
        + '#wizard .wiz-sum .v{flex:1;min-width:0;font-size:14.5px;font-weight:600;overflow:hidden;'
        + 'text-overflow:ellipsis;white-space:nowrap}'
        + '#wizard .wiz-sum .chg{flex:none;min-height:40px;padding:0 10px;border:none;border-radius:10px;background:none;'
        + 'color:var(--link);font:700 13.5px ' + FONT + ';cursor:pointer}'
        // the optional Tomorrow.io key: a card that opens onto the settings page's own key row
        + '#wizard .wiz-tio{padding:14px 16px}'
        + '#wizard .wiz-tio-hd{display:flex;align-items:center;justify-content:space-between;font-weight:700}'
        + '#wizard .wiz-tag{margin-left:10px;padding:3px 8px;border-radius:999px;background:var(--ctl);'
        + 'color:var(--muted);font:700 11px ' + FONT + ';letter-spacing:.04em;text-transform:uppercase}'
        + '#wizard .wiz-tio>p{margin:6px 0 12px;font-size:13.5px;color:var(--muted)}'
        + '#wizard .wiz-tio-open{min-height:40px;padding:8px 14px;border:1px solid var(--ctl-line);border-radius:11px;'
        + 'background:var(--ctl);color:var(--fg);font:700 13.5px ' + FONT + ';cursor:pointer}'
        + '#wizard .wiz-tio-field{margin:0 -16px -14px}'
        + '#wizard .wiz-tio-field .row{border-bottom:none}'
        + '#wizard .wiz-fine{margin:16px 0 0;text-align:center;font-size:12.5px;line-height:1.55;color:var(--hint)}'
        // the bottom bar: one primary button, sometimes a quiet second one
        + '#wizard .wiz-foot{flex:none;display:flex;flex-direction:column;padding:12px 20px 14px;'
        + 'padding-bottom:calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--card-line);'
        + 'background:var(--bg)}'
        + '#wizard .wiz-cta{width:100%;min-height:50px;border:none;border-radius:14px;background:' + ACCENT_FILL + ';'
        + 'color:#FFFFFF;font:700 16px ' + FONT + ';cursor:pointer;box-shadow:0 6px 18px rgba(250,74,53,.35)}'
        + '#wizard .wiz-cta:active{transform:translateY(1px)}'
        + '#wizard .wiz-link{min-height:40px;margin-top:6px;border:none;border-radius:10px;background:none;'
        + 'color:var(--muted);font:600 14px ' + FONT + ';cursor:pointer}'
        + '@keyframes wiz-in-r{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-in-l{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-tilt{0%{transform:rotate(0)}30%{transform:rotate(14deg)}55%{transform:rotate(-5deg)}'
        + '75%{transform:rotate(2deg)}100%{transform:rotate(0)}}'
        // short screens (small phones, a keyboard up): a smaller watch keeps the options in view
        + '@media (max-height:700px){#wizard .wiz-stage.big .wiz-shot{width:190px;width:min(50vw,200px)}'
        + '#wizard .wiz-shot{width:120px}#wizard .wiz-title{font-size:22px}}'
        + '@media (prefers-reduced-motion:reduce){#wizard .wiz-step,#wizard .wiz-badge,#wizard .wiz-flick-watch.tilt'
        + '{animation:none}#wizard .wiz-shot,#wizard .wiz-seg,#wizard .wiz-flick-shot{transition:none}}';

    // Live wizard state, captured from the onReady ctx when the wizard opens.
    // flickIdx = current stop of the flick demo (reset to 0 whenever stepFlick renders).
    // healthAtOpen = S.healthMode as the wizard opened (applyHealthModeChange).
    // touch = where a swipe on the picker's watch started; shotSeq = the latest preview swap.
    var W = { ctx: null, steps: [], idx: 0, overlay: null, flickIdx: 0, healthAtOpen: null, touch: null, shotSeq: 0 };

    function esc(s) { return (PConf.engine && PConf.engine.esc) ? PConf.engine.esc(s) : String(s); }
    function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

    function findItem(schema, key) {
        var found = null;
        if (PConf.schemaWalk && PConf.schemaWalk.eachItem) {
            PConf.schemaWalk.eachItem(schema, function (it) { if (it.messageKey === key) { found = it; } });
        }
        return found;
    }
    function optionsFor(schema, key) { var it = findItem(schema, key); return (it && it.options) || []; }
    function optionHasCode(opts, code) {
        var i; for (i = 0; i < opts.length; i += 1) { if (opts[i][1] === code) { return true; } }
        return false;
    }
    function indexOfCode(opts, code) {
        var i; for (i = 0; i < opts.length; i += 1) { if (opts[i][1] === code) { return i; } }
        return 0;
    }
    function labelFor(opts, val) {
        var i; for (i = 0; i < opts.length; i += 1) { if (opts[i][1] === val) { return opts[i][0]; } }
        return '';
    }
    /**
     * A setting's value as the settings page names it (the schema's own option label), so the
     * summary on the last step reads exactly like the tabs it points to.
     * @param {string} key Setting messageKey.
     * @param {*} value Stored value.
     * @returns {string} The option's label, or '' when the schema has none for it.
     */
    function settingLabel(key, value) {
        var item = findItem(W.ctx.schema, key);
        if (!item) { return ''; }
        var opts = (PConf.engine && PConf.engine.resolveOptionsFrom)
            ? PConf.engine.resolveOptionsFrom(item, W.ctx.S) : item.options;
        return labelFor(opts || [], value);
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
     * Derive country-dependent settings onto the shared state and run the
     * provider cleanup hook just like the settings control does.
     * @param {Object} S live settings state
     * @returns {void}
     */
    function applyDerived(S) {
        var m = mapCountry(S.holidayCountry);
        var oldProvider = S.provider;
        S.provider = m.provider;
        var cleanup = (PConf.onChange && PConf.onChange.get)
            ? PConf.onChange.get('clearPollenForProvider') : null;
        if (cleanup) { cleanup(S, oldProvider, m.provider); }
        // The country's Rainbow pick is "Rainbow (limited)" ('rainbow'); a radar already on
        // "Rainbow (own key)" ('rainbowkey') stays there, as it did when the own key was a
        // switch beside the one Rainbow option.
        var ownKey = S.radarProvider === 'rainbowkey' && m.radarProvider === 'rainbow';
        S.radarProvider = ownKey ? 'rainbowkey' : m.radarProvider;
        S.temperatureUnits = m.temperatureUnits;
        S.windUnits = m.windUnits;
        S.distanceUnits = m.distanceUnits;
        S.weekStartDay = m.weekStartDay;
        S.dateSlotFullFormat = m.dateSlotFullFormat;
    }

    // --- the welcome step reuses the real settings searchSelect for country/region ---
    // A clone of the schema item with its concrete options resolved (region derives from country),
    // rendered through the engine's own row/control renderers so it looks + behaves like Settings.
    function selectRow(schema, key) {
        var item = findItem(schema, key);
        if (!item) { return ''; }
        var withOpts = Object.assign({}, item, { options: PConf.engine.resolveOptionsFrom(item, W.ctx.S) });
        return PConf.engine.renderRow(withOpts, { value: W.ctx.S[key] });
    }
    function regionHasOptions(schema) {
        var item = findItem(schema, 'holidayRegion');
        return Boolean(item && PConf.engine.resolveOptionsFrom(item, W.ctx.S).length);
    }

    // --- screenshots ---
    // Keyed by platform (SHOTS[platform][group][val]) so each watch sees its own rendering. diorite
    // isn't captured separately — it's a B&W watch with health+radar, same class as flint, so it
    // reuses flint's shots.
    function shotPlatform() {
        var p = (W.ctx && W.ctx.ENV && W.ctx.ENV.platform) || 'basalt';
        return (p === 'diorite') ? 'flint' : p;
    }
    // Heart rate is available on emery (Time 2) and diorite (Pebble 2); env.hr (platform.js)
    // is the single source. Other platforms lack the sensor, so the health copy drops the
    // heart-rate clause there.
    function hasHeartRate() {
        return Boolean(W.ctx && W.ctx.ENV && W.ctx.ENV.hr);
    }
    function shotSet() { return SHOTS[shotPlatform()] || {}; }
    function shotFor(group, val) { var s = shotSet(); return (s[group] && s[group][val]) || ''; }
    /**
     * A screenshot in the watch bezel.
     * @param {string} inner The bezel's content (an <img>, or the flick demo's stack of two).
     * @returns {string} HTML.
     */
    function watchHtml(inner) { return '<div class="wiz-watch">' + inner + '</div>'; }

    // --- the picker: layout, health and theme ---
    function optsFor(group) {
        if (group === 'layoutPreset') { return LAYOUT_OPTS; }
        if (group === 'healthMode') { return HEALTH_OPTS; }
        return (W.ctx.ENV && W.ctx.ENV.color) ? THEME_OPTS_COLOR : THEME_OPTS_BW;   // 'theme'
    }
    function descFor(group) {
        if (group === 'layoutPreset') { return LAYOUT_DESC; }
        if (group === 'healthMode') { return healthDesc(hasHeartRate()); }
        return THEME_DESC;   // 'theme'
    }
    /**
     * The option a picker shows as selected: the stored value when the picker offers it, else the
     * nearest one. Only a highlight — the stored value changes on a real pick alone. A stored
     * compactDense or weatherOnly (set in full Settings) shows as Compact, the nearest same-calendar
     * layout; a health mode the picker lacks (e.g. 'slot', from the Health tab) as Off.
     * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
     * @returns {string} An option value of the picker.
     */
    function highlighted(group) {
        var opts = optsFor(group), stored = W.ctx.S[group];
        if (labelFor(opts, stored)) { return stored; }
        return group === 'layoutPreset' ? 'compactCal' : opts[0][1];
    }
    function optHtml(group, label, val, on) {
        return '<button type="button" class="wiz-opt' + (on ? ' on' : '') + '" role="radio" aria-checked="'
            + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '" data-wiz-group="' + esc(group)
            + '" data-wiz-opt="' + esc(val) + '">' + esc(label) + '</button>';
    }
    /**
     * The picker: the watch showing the selected option, the options as a segmented radio group, and
     * the selected option's description (announced when it changes).
     * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
     * @returns {string} HTML.
     */
    function pickerHtml(group) {
        var opts = optsFor(group), sel = highlighted(group), i;
        var h = '<div class="wiz-stage big" data-wiz-preview="' + esc(group) + '">'
            + watchHtml('<img class="wiz-shot" data-wiz-shot src="' + esc(shotFor(group, sel)) + '" alt="'
                + esc(labelFor(opts, sel) + ' preview') + '">')
            + '</div><div class="wiz-opts" role="radiogroup" aria-labelledby="wiz-title" data-wiz-pick="'
            + esc(group) + '">';
        for (i = 0; i < opts.length; i += 1) { h += optHtml(group, opts[i][0], opts[i][1], opts[i][1] === sel); }
        return h + '</div><p class="wiz-desc" data-wiz-desc aria-live="polite">' + esc(descFor(group)[sel] || '') + '</p>';
    }
    /**
     * Write a picked option to the live state, the way the settings control would.
     * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
     * @param {string} val The option's value.
     * @returns {void}
     */
    function commit(group, val) {
        if (group === 'theme') {
            var oldTheme = W.ctx.S.theme;
            W.ctx.S.theme = val;
            var conv = (PConf.onChange && PConf.onChange.get) ? PConf.onChange.get('themeConvert') : null;
            if (conv) { conv(W.ctx.S, oldTheme, val); }
        } else {
            W.ctx.S[group] = val;
        }
    }
    /**
     * Swap the picker's screenshot with a short fade (none under reduced motion). A newer swap wins
     * over one still fading.
     * @param {?Element} img The preview image.
     * @param {string} src New screenshot.
     * @param {string} alt Its alt text.
     * @returns {void}
     */
    function swapShot(img, src, alt) {
        if (!img) { return; }
        img.alt = alt;
        if (img.getAttribute && img.getAttribute('src') === src) { return; }
        W.shotSeq += 1;
        var seq = W.shotSeq;
        if (reducedMotion()) { img.src = src; return; }
        img.className = 'wiz-shot fade';
        setTimeout(function () {
            if (seq !== W.shotSeq) { return; }
            img.src = src;
            img.className = 'wiz-shot';
        }, 140);
    }
    /**
     * Pick an option: commit it, then update the segments, the description and the watch in place (no
     * re-render, so focus and a swipe in progress are kept).
     * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
     * @param {number} idx Option index (clamped).
     * @param {boolean} focus Move keyboard focus to the picked segment (arrow keys).
     * @returns {void}
     */
    function selectOption(group, idx, focus) {
        var opts = optsFor(group);
        idx = Math.max(0, Math.min(opts.length - 1, idx));
        var val = opts[idx][1];
        commit(group, val);
        if (!W.overlay) { return; }
        var segs = W.overlay.querySelectorAll('[data-wiz-opt]'), i, on;
        for (i = 0; i < segs.length; i += 1) {
            on = segs[i].getAttribute('data-wiz-opt') === val;
            segs[i].className = on ? 'wiz-opt on' : 'wiz-opt';
            segs[i].setAttribute('aria-checked', on ? 'true' : 'false');
            segs[i].setAttribute('tabindex', on ? '0' : '-1');
            if (on && focus && segs[i].focus) { segs[i].focus(); }
        }
        var desc = W.overlay.querySelector('[data-wiz-desc]');
        if (desc) { desc.textContent = descFor(group)[val] || ''; }
        swapShot(W.overlay.querySelector('[data-wiz-shot]'), shotFor(group, val), opts[idx][0] + ' preview');
    }

    // --- flick demo (step 'flick'): interactive tilt-and-snap through the real cycle ---
    // 1x1 transparent GIF, shown only if a stop unexpectedly has no screenshot. Stays unreachable
    // because the Default stop clamps compactDense (the one preset with no captured shot) to
    // compactCal, and scripts/build-config-page.js hard-fails the build on any other missing wizard
    // shot.
    var BLANK_SHOT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

    /**
     * Resolve a stop descriptor to its screenshot data URI. SHOTS[platform].radar is a
     * plain string (no {val: uri} map), so the 'radar' group bypasses shotFor().
     * @param {{shotGroup:string,shotVal:string}} stop Stop descriptor from flickStops().
     * @returns {string} data: URI (BLANK_SHOT if missing).
     */
    function stopShot(stop) {
        var src = (stop.shotGroup === 'radar') ? (shotSet().radar || '') : shotFor(stop.shotGroup, stop.shotVal);
        return src || BLANK_SHOT;
    }
    // The selected option's name in bold, then its description: the flick demo's caption.
    function cardHintHtml(label, body) { return '<b>' + esc(label) + '</b> — ' + esc(body || ''); }
    /**
     * Cycle-position dots: one span per stop, the current one highlighted. A text label
     * sits beside the dots in the markup, so position is never conveyed by color alone.
     * @param {number} count Number of stops in the cycle.
     * @param {number} idx Current stop index.
     * @returns {string} HTML.
     */
    function flickDotsHtml(count, idx) {
        var h = '', i;
        for (i = 0; i < count; i += 1) { h += '<span class="wiz-dot' + (i === idx ? ' on' : '') + '"></span>'; }
        return h;
    }
    /**
     * Swap the demo to a stop: crossfade the screenshot (two stacked imgs; the CSS opacity
     * transition does the fade), and rewrite dots, label and caption. Every lookup is
     * guarded — the step may have been re-rendered or the wizard closed between the flick
     * and the snap timeout.
     * @param {{label:string,caption:string,shotGroup:string,shotVal:string}} stop Target stop.
     * @param {number} idx The stop's index in the cycle.
     * @param {number} count Total stops.
     * @returns {undefined}
     */
    function showFlickStop(stop, idx, count) {
        if (!W.overlay) { return; }
        var imgs = W.overlay.querySelectorAll('.wiz-flick-shot');
        if (imgs.length === 2) {
            var cur = (imgs[0].className.indexOf(' on') >= 0) ? 0 : 1, nxt = 1 - cur;
            imgs[nxt].src = stopShot(stop);
            imgs[cur].className = 'wiz-shot wiz-flick-shot';
            imgs[nxt].className = 'wiz-shot wiz-flick-shot on';
        }
        var dots = W.overlay.querySelector('[data-wiz-flick-dots]');
        if (dots) { dots.innerHTML = flickDotsHtml(count, idx); }
        var lbl = W.overlay.querySelector('[data-wiz-flick-label]');
        if (lbl) { lbl.textContent = stop.label; }
        var cap = W.overlay.querySelector('[data-wiz-flick-cap]');
        if (cap) { cap.innerHTML = cardHintHtml(stop.label, stop.caption); }
    }
    /**
     * Advance the demo one stop (wrapping past the last back to Default), replay the
     * tilt-and-snap animation on the watch, and swap the content on the snap (~150 ms in,
     * mid-tilt of the 450 ms keyframe). Under prefers-reduced-motion the CSS suppresses
     * the tilt and only the crossfade shows — no JS branch needed.
     * @returns {undefined}
     */
    function advanceFlick() {
        var stops = flickStops(W.ctx.S, hasHeartRate());
        if (!stops.length) { return; }
        W.flickIdx = (W.flickIdx + 1) % stops.length;
        var stop = stops[W.flickIdx], idx = W.flickIdx;
        var watch = W.overlay.querySelector('[data-wiz-flick-watch]');
        if (watch) {
            watch.className = 'wiz-flick-watch';    // restart the animation:
            void watch.offsetWidth;                 // force a reflow between the class flips
            watch.className = 'wiz-flick-watch tilt';
        }
        setTimeout(function () { showFlickStop(stop, idx, stops.length); }, 150);
    }

    // --- step bodies ---
    function stepHead(id) {
        var meta = STEP_META[id] || {};
        return (meta.eyebrow ? '<p class="wiz-eyebrow">' + esc(meta.eyebrow) + '</p>' : '')
            + '<h2 class="wiz-title" id="wiz-title" data-wiz-title tabindex="-1">' + esc(meta.title || '') + '</h2>';
    }
    function stepWelcome() {
        var schema = W.ctx.schema;
        // aplite has no radar: don't promise one there.
        var lead = (W.ctx.ENV && W.ctx.ENV.radar)
            ? 'Forecast, rain radar and your calendar at a glance.' : 'Forecast and your calendar at a glance.';
        var h = '<div class="wiz-stage">'
            + watchHtml('<img class="wiz-shot" src="' + esc(shotFor('layoutPreset', highlighted('layoutPreset')))
                + '" alt="WarnWeather on your watch">')
            + '</div>'
            + stepHead('welcome')
            + '<p class="wiz-lead">' + lead + ' Setup takes a minute, and you can change everything later.</p>'
            + '<div class="wiz-card"><div class="wiz-card-hd">Your country</div>'
            + selectRow(schema, 'holidayCountry');
        if (regionHasOptions(schema)) { h += selectRow(schema, 'holidayRegion'); }
        return h + '<p class="wiz-note">Picks the weather and radar service for your area, your units, '
            + 'holidays and first day of the week.</p></div>';
    }
    function stepLayout() {
        return stepHead('layout') + pickerHtml('layoutPreset')
            + '<div class="wiz-legend">'
            + '<p><b>Forecast Status Bar</b>: your location, the temperature and air quality.</p>'
            + '<p><b>Forecast</b>: a 24-hour graph of temperature, chance of rain, rain and UV.</p></div>';
    }
    function stepHealth() { return stepHead('health') + pickerHtml('healthMode'); }
    function stepFlick() {
        // Render always opens on stop 0 (the default view), so re-entering the step resets
        // the demo — keeps W.flickIdx and the DOM trivially in sync.
        W.flickIdx = 0;
        var stops = flickStops(W.ctx.S, hasHeartRate());
        var stop = stops[0];
        var src = esc(stopShot(stop));
        return stepHead('flick')
            + '<p class="wiz-lead">Your watch shows one view at a time. Flick your wrist to see the next; '
            + 'it goes back to your default view by itself.</p>'
            + '<div class="wiz-flick">'
            + '<div class="wiz-stage big"><div class="wiz-flick-watch" data-wiz-flick-watch data-wiz-flick>'
            + watchHtml('<div class="wiz-flick-stack">'
                + '<img class="wiz-shot wiz-flick-shot on" src="' + src + '" alt="">'
                + '<img class="wiz-shot wiz-flick-shot" src="' + src + '" alt=""></div>')
            + '</div></div>'
            + '<div class="wiz-flick-track">'
            + '<span data-wiz-flick-dots>' + flickDotsHtml(stops.length, 0) + '</span>'
            + '<span class="wiz-flick-label" data-wiz-flick-label>' + esc(stop.label) + '</span>'
            + '</div>'
            + '<button type="button" class="wiz-try" data-wiz-flick>' + ICON_FLICK + 'Try a flick</button>'
            + '<p class="wiz-desc" data-wiz-flick-cap aria-live="polite">' + cardHintHtml(stop.label, stop.caption) + '</p>'
            + '</div>';
    }
    function stepTheme() {
        return stepHead('theme') + pickerHtml('theme')
            + '<p class="wiz-fine">You can fine-tune any colour later in Settings.</p>';
    }
    // The tomorrow.io upsell, shown on the last step when the resulting weather provider isn't DWD or
    // Met.no (i.e. outside their strong regions): a free tomorrow.io key unlocks the precise worldwide
    // forecast. Folded to one line until asked for; it then opens onto the real settings field
    // (renderRow) so the signup instructions, key input and Test button match the Tomorrow.io key
    // sheets exactly. Entering a key switches the weather provider to tomorrow.io (onTomorrowioKey).
    // Both copies of the key's row (the weather provider's Tomorrow.io sheet and the radar-only one)
    // are labelled just "API key" under a sheet titled "Tomorrow.io"; any copy will do (same hint,
    // same Test), and the row here, with no sheet title above it, names the provider itself.
    var TOMORROWIO_UPSELL_LABEL = 'Tomorrow.io API key';
    function tomorrowioUpsell() {
        var item = findItem(W.ctx.schema, 'tomorrowioApiKey');
        if (!item) { return ''; }
        var key = W.ctx.S.tomorrowioApiKey || '';
        var field = PConf.engine.renderRow(Object.assign({}, item, { label: TOMORROWIO_UPSELL_LABEL }), { value: key });
        // Already holding a key (a re-run): open, so the key shows.
        var open = Boolean(String(key).replace(/\s/g, ''));
        return '<div class="wiz-tio">'
            + '<div class="wiz-tio-hd"><span>More precise forecasts</span><span class="wiz-tag">Optional</span></div>'
            + '<p>For your region, a free Tomorrow.io account unlocks a hyperlocal forecast anywhere in the world.</p>'
            + (open ? '' : '<button type="button" class="wiz-tio-open" data-wiz-tio-open aria-expanded="false">'
                + 'Add a Tomorrow.io key</button>')
            + '<div class="wiz-tio-field" data-wiz-tio-field' + (open ? '' : ' hidden') + '>' + field + '</div>'
            + '</div>';
    }
    /**
     * The last step's summary: what setup chose, each with a way back to the step that set it.
     * Labels come from the schema, so each reads as it does on the settings tabs.
     * @returns {string} HTML.
     */
    function summaryHtml() {
        var S = W.ctx.S, rows = [], h = '<ul class="wiz-sum">', i, country, region;
        country = settingLabel('holidayCountry', S.holidayCountry);
        region = (S.holidayRegion && S.holidayRegion !== 'all') ? settingLabel('holidayRegion', S.holidayRegion) : '';
        rows.push(['Country', region ? region + ', ' + country : country, 'welcome', '']);
        rows.push(['Weather', settingLabel('provider', S.provider), '', ' data-wiz-sum-weather']);
        rows.push(['Layout', settingLabel('layoutPreset', S.layoutPreset), 'layout', '']);
        if (W.steps.indexOf('health') !== -1) { rows.push(['Health', settingLabel('healthMode', S.healthMode), 'health', '']); }
        if (W.steps.indexOf('theme') !== -1) { rows.push(['Theme', settingLabel('theme', S.theme), 'theme', '']); }
        for (i = 0; i < rows.length; i += 1) {
            h += '<li><span class="k">' + esc(rows[i][0]) + '</span><span class="v"' + rows[i][3] + '>'
                + esc(rows[i][1] || '—') + '</span>'
                + (rows[i][2] ? '<button type="button" class="chg" data-wiz-goto="' + rows[i][2] + '" aria-label="Change '
                    + esc(rows[i][0].toLowerCase()) + '">Change</button>' : '')
                + '</li>';
        }
        return h + '</ul>';
    }
    function stepDone() {
        // Show the tomorrow.io upsell only where DWD / Met.no don't apply — a REGION question, keyed off
        // the selected country's recommended provider. NOT the current S.provider: that may not have been
        // derived to dwd/metno yet (re-run wizard, undetected locale) and the upsell itself flips it to
        // tomorrow.io once a key is entered, which must not change whether the upsell shows.
        var countryProvider = mapCountry(W.ctx.S.holidayCountry).provider;
        var upsell = (countryProvider !== 'dwd' && countryProvider !== 'metno') ? tomorrowioUpsell() : '';
        return '<div class="wiz-badge">' + ICON_DONE + '</div>'
            + stepHead('done')
            + '<p class="wiz-lead">Save to send it to your watch. You can change anything later, or run this '
            + 'setup again from <b>Setup&nbsp;›&nbsp;Misc</b>.</p>'
            + summaryHtml()
            + upsell
            + '<p class="wiz-fine">Enjoying WarnWeather? A ♥ on the Pebble appstore helps a lot. Questions or ideas: '
            + 'open an issue on <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>, or use the '
            + 'appstore’s “Message the developer”.</p>';
    }
    function stepBody(id) {
        if (id === 'welcome') { return stepWelcome(); }
        if (id === 'layout') { return stepLayout(); }
        if (id === 'health') { return stepHealth(); }
        if (id === 'flick') { return stepFlick(); }
        if (id === 'theme') { return stepTheme(); }
        return stepDone();
    }

    // --- top bar and bottom bar ---
    function topHtml() {
        var n = W.steps.length, h, i;
        h = (W.idx > 0)
            ? '<button type="button" class="wiz-back" data-wiz-nav="back" aria-label="Back">' + ICON_BACK + '</button>'
            : '<span class="wiz-top-pad"></span>';
        h += '<div class="wiz-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="'
            + n + '" aria-valuenow="' + (W.idx + 1) + '" aria-valuetext="Step ' + (W.idx + 1) + ' of ' + n + '">';
        for (i = 0; i < n; i += 1) {
            h += '<span class="wiz-seg' + (i < W.idx ? ' done' : (i === W.idx ? ' on' : '')) + '"></span>';
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
        var id = W.steps[W.idx];
        var top = W.overlay.querySelector('[data-wiz-top]');
        if (top) { top.innerHTML = topHtml(); }
        var body = W.overlay.querySelector('[data-wiz-body]');
        var stay = dir === 'stay';
        body.innerHTML = '<div class="wiz-step' + (dir === 'back' ? ' back' : '') + (stay ? ' still' : '')
            + (id === 'done' ? ' last' : '') + '">' + stepBody(id) + '</div>';
        W.overlay.querySelector('[data-wiz-foot]').innerHTML = footer(id);
        if (stay) { return; }
        if (typeof body.scrollTop === 'number') { body.scrollTop = 0; }
        // A screen reader starts each step at its title.
        var title = W.overlay.querySelector('[data-wiz-title]');
        if (title && title.focus) { title.focus({ preventScroll: true }); }
    }

    // --- finishing: the situational defaults (settings/defaults-policy.js) ---
    //
    // applyDerived above answers "what suits this COUNTRY"; this answers "what suits a watch
    // whose owner just finished setup". The rules — which slots, which bold modes and why —
    // live in the policy table, not here; this code only decides whether a value may land on
    // the live state, and writes it the way the settings page would.

    // "Save & close" and "Continue tweaking" are the two buttons of the LAST step, so both
    // mean the wizard was walked to the end. "Skip" (welcome step) means the user answered
    // nothing, so nothing is derived for them.
    var COMPLETING_NAVS = {save: true, tweak: true};

    /**
     * The conditional-defaults table. Resolved lazily, on purpose, so the flat settings
     * page's file order never matters (unlike blocks.js, which binds the status-thresholds
     * contract once at load and has its bundle position pinned by a test).
     * WEBVIEW REQUIREMENT: the flat page has no require(), so settings/defaults-policy.js must
     * be listed in scripts/build-config-page.js's APP_FILES for window.DefaultsPolicy to exist
     * at all. Without it the wizard simply derives nothing — Node tests take the require()
     * branch and would not notice, hence the log line in applyWizardDefaults.
     * @returns {?Object} The defaults-policy module, or null when it isn't on the page.
     */
    function defaultsPolicy() {
        return (typeof require !== 'undefined')
            ? require('./defaults-policy.js')
            : (typeof window !== 'undefined' ? window.DefaultsPolicy : null);
    }
    /**
     * The status-line catalog, resolved the same lazy dual-context way.
     * @returns {?Object} The catalog module, or null when it isn't on the page.
     */
    function statusCatalog() {
        return (typeof require !== 'undefined')
            ? require('../status-line-catalog.js')
            : (typeof window !== 'undefined' ? window.StatusLineCatalog : null);
    }

    /**
     * Whether another slot of `key`'s own status row already shows `value` —
     * the catalog's canonical siblingHolds, resolved dual-context.
     * @param {Object} S Live settings state.
     * @param {string} key Setting messageKey.
     * @param {*} value The value the policy wants to write.
     * @returns {boolean} True when a sibling slot of the same row already holds it.
     */
    function rowSiblingHolds(S, key, value) {
        var cat = statusCatalog();
        return Boolean(cat && cat.siblingHolds && cat.siblingHolds(S, key, value));
    }

    /**
     * Whether the policy may write `key` — two conservative clauses, both spelling out
     * "the user has not spoken here":
     *   1. the stored value is still the one a fresh install of THIS watch resolves (the
     *      schema's defaultValue, or its env-aware defaultFrom resolver). Anything else is
     *      a deliberate choice — made in the wizard, or in Settings before re-running it —
     *      and a first-run default must never overrule it. EXCEPT a key its rule declares
     *      in `overrules`: there, finishing the wizard is itself the consent (the
     *      health-slot promotion — see the rule), so the customized value gives way.
     *   2. for a status slot, no sibling slot of the same row already shows the value. The
     *      row already carries what the rule wanted to put there, so writing it would either
     *      duplicate the reading or (through the page's dedupe hook) blank the slot the user
     *      chose. Skipping is both safe and what the rule was after. This clause has no
     *      overrules exemption — a duplicate reading is never what a rule was after.
     * @param {Object} ctx onReady ctx ({S, ENV, schema}).
     * @param {string} key Setting messageKey.
     * @param {Object} meta The key's flattened rule meta from applyDefaults
     *     ({value, dependsOn, overrules}).
     * @returns {boolean} True when writing is safe.
     */
    function policyMayWrite(ctx, key, meta) {
        var item = findItem(ctx.schema, key);
        if (!item) { return false; }   // not a setting on this page — never invent one
        if (!meta.overrules && ctx.S[key] !== resolvedDefaultAsStored(item, ctx.ENV)) { return false; }
        return !rowSiblingHolds(ctx.S, key, meta.value);
    }

    /**
     * A schema item's default in the SAME representation hydrate() stores it in. Colour items
     * declare a number but are stored as '#RRGGBB', so comparing the raw default against the
     * stored value would report "the user changed this" on a completely untouched install --
     * and a policy rule setting a colour would then silently never fire, with no test failing
     * (no rule writes a colour today). Normalising here keeps the guard honest for the rules
     * this table is meant to grow.
     * @param {Object} item Schema item.
     * @param {Object} env Platform env.
     * @returns {*} The default, as it would be stored.
     */
    function resolvedDefaultAsStored(item, env) {
        var dv = PConf.engine.resolveDefaultFrom(item, env);
        return (item.type === 'color' && typeof dv === 'number') ? PConf.color.intToHex(dv) : dv;
    }

    /**
     * Write the situational defaults a FINISHED wizard earns onto the live state, so the
     * existing save path persists them alongside everything else the wizard derived. A nav
     * that doesn't finish the wizard (Skip, Back, Next) writes nothing.
     *
     * The execution semantics — flattening, `set` order, dependsOn anchoring — live in the
     * policy module's applyDefaults, its one interpreter; this caller only contributes the
     * guard deciding whether a value may land (policyMayWrite).
     *
     * @param {Object} ctx onReady ctx ({S, ENV, schema}).
     * @param {string} nav The footer button pressed ('save'|'tweak'|'skip'|'next'|'back').
     * @returns {Object} The messageKey -> value pairs actually written (empty when none).
     */
    function applyWizardDefaults(ctx, nav) {
        if (!COMPLETING_NAVS[nav] || !ctx) { return {}; }
        var policy = defaultsPolicy();
        if (!policy) {
            // Guarded: no other settings-page file assumes a console, and a missing one must
            // not turn "no defaults derived" into a thrown error on the finish button.
            if (typeof console !== 'undefined' && console.log) {
                console.log('wizard: defaults-policy missing from the page — no setup defaults derived');
            }
            return {};
        }
        // The whole live state doubles as `choices`: every wizard pick and every stored
        // setting is already in it, so a future rule keyed on any of them just works.
        return policy.applyDefaults({wizard: true, env: ctx.ENV, choices: ctx.S}, {
            mayWrite: function (key, meta) { return policyMayWrite(ctx, key, meta); }
        });
    }

    function closeWizard() {
        if (W.overlay && W.overlay.parentNode) { W.overlay.parentNode.removeChild(W.overlay); }
        W.overlay = null;
    }
    // Keep the overlay up: save() flashes a toast then navigates back to the watch, which unloads
    // the page. Removing the overlay first would flash the settings menu before that navigation.
    function finishSave() { W.ctx.set('onboardingDone', true); W.ctx.save(); }
    function finishTweak() { W.ctx.set('onboardingDone', true); closeWizard(); W.ctx.render(); }

    // The navs that close the wizard and hand its state to the page (and so to a save).
    var EXIT_NAVS = {save: true, tweak: true, skip: true};

    /**
     * Run healthMode's own onChange hook (resetStatusHealth, declared on the schema item)
     * ONCE, from the value the wizard opened with to the one it closes on — the same call
     * the Health tab makes on every change. The carousel writes S.healthMode directly, and
     * an off <-> on flip that skips the hook leaves the health row as the off state left it
     * (all Empty: a blank Health Status Bar) or keeps health items stored in other rows
     * after picking Off (blank slots). Deliberately not per selection: carousel swipes
     * commit every card they pass, and resetting the row on a mere peek at "Off" would
     * throw away a customized health row. A no-op when the enable state didn't flip.
     * @param {Object} ctx onReady ctx ({S, ENV, schema}).
     * @param {*} openedWith S.healthMode when the wizard opened.
     * @returns {void}
     */
    function applyHealthModeChange(ctx, openedWith) {
        var item = findItem(ctx.schema, 'healthMode');
        var hook = (item && item.onChange && PConf.onChange && PConf.onChange.get)
            ? PConf.onChange.get(item.onChange) : null;
        if (!hook || openedWith === ctx.S.healthMode) { return; }
        hook(ctx.S, openedWith, ctx.S.healthMode, ctx.ENV, 'healthMode');
    }

    function onNav(nav) {
        // Closing the wizard first reconciles the health pick with the status rows, BEFORE
        // the finishing defaults: the policy's health-slot swap reads the health row, and
        // after an off -> on pick that row must already be back at its defaults.
        if (EXIT_NAVS[nav]) { applyHealthModeChange(W.ctx, W.healthAtOpen); }
        // Every exit runs the situational defaults first — applyWizardDefaults itself decides
        // which navs count as finishing the wizard, so the rule lives in one place — and does
        // it BEFORE the exit, so the values ride the save (or show up on the settings page the
        // user is dropped onto).
        applyWizardDefaults(W.ctx, nav);
        if (nav === 'back') { W.idx = Math.max(0, W.idx - 1); renderStep('back'); }
        else if (nav === 'next') { W.idx = Math.min(W.steps.length - 1, W.idx + 1); renderStep('next'); }
        else if (nav === 'save') { finishSave(); }
        // Skip closes the wizard onto the live settings page (same as "Keep customizing"),
        // rather than saving and navigating back to the watch.
        else if (nav === 'skip' || nav === 'tweak') { finishTweak(); }
    }

    /**
     * Jump back to a step from the summary's Change links. Walking forward from there returns to
     * the summary, which then shows the new pick.
     * @param {string} id Step id.
     * @returns {void}
     */
    function goToStep(id) {
        var at = W.steps.indexOf(id);
        if (at === -1) { return; }
        W.idx = at;
        renderStep('back');
    }

    /**
     * Open the folded Tomorrow.io card onto its key field.
     * @param {?Element} button The card's "Add a Tomorrow.io key" button.
     * @returns {void}
     */
    function openUpsell(button) {
        var field = W.overlay && W.overlay.querySelector('[data-wiz-tio-field]');
        if (!field) { return; }
        field.removeAttribute('hidden');
        if (button && button.parentNode) { button.parentNode.removeChild(button); }
        var input = field.querySelector('input[type=text]');
        if (input && input.focus) { input.focus(); }
    }

    function onClick(e) {
        if (!e.target || !e.target.closest) { return; }
        var t;
        if ((t = e.target.closest('[data-wiz-nav]'))) { onNav(t.getAttribute('data-wiz-nav')); return; }
        if ((t = e.target.closest('[data-select]'))) {
            // Open the shared bottom-sheet dialog (a showModal() top-layer dialog, so it renders
            // above this overlay). The engine sets S[key] on pick; when a country was newly chosen,
            // reset the region and re-derive the country defaults, then re-render the step in place.
            var sk = t.getAttribute('data-select'), before = W.ctx.S[sk];
            W.ctx.openSheet(sk, function () {
                if (sk === 'holidayCountry' && W.ctx.S.holidayCountry !== before) {
                    W.ctx.S.holidayRegion = 'all'; applyDerived(W.ctx.S);
                }
                renderStep('stay');
                var again = W.overlay && W.overlay.querySelector('[data-select="' + sk + '"]');
                if (again && again.focus) { again.focus(); }
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
        // Embedded settings-field controls (the tomorrow.io upsell on the last step): the copy
        // button in the key hint and the Test button both live in the overlay, outside #scroll, so
        // the engine's own delegated handlers never see them — dispatch them here instead.
        if ((t = e.target.closest('[data-copy]'))) { if (PConf.copyText) { PConf.copyText(t.getAttribute('data-copy')); } return; }
        if ((t = e.target.closest('[data-action]'))) { var act = t.getAttribute('data-action'); if (PConf.actions[act]) { PConf.actions[act](); } return; }
    }

    // The picker's keys: a radio group moves its selection with the arrow keys (wrapping), Home and
    // End. Older WebViews name the arrows without the "Arrow" prefix.
    var KEY_STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Right: 1, Down: 1, Left: -1, Up: -1 };
    function onKeydown(e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-wiz-opt]') : null;
        if (!t) { return; }
        var group = t.getAttribute('data-wiz-group'), opts = optsFor(group);
        var at = indexOfCode(opts, t.getAttribute('data-wiz-opt')), to = null;
        if (KEY_STEP[e.key]) { to = (at + KEY_STEP[e.key] + opts.length) % opts.length; }
        else if (e.key === 'Home') { to = 0; }
        else if (e.key === 'End') { to = opts.length - 1; }
        if (to === null) { return; }
        if (e.preventDefault) { e.preventDefault(); }
        selectOption(group, to, true);
    }

    // A swipe across the picker's watch steps to the neighbouring option (no wrap): the gesture the
    // old carousel taught. Mostly-vertical drags are scrolls, and left alone.
    var SWIPE_MIN_PX = 40;
    function onTouchStart(e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-wiz-preview]') : null;
        W.touch = (t && e.touches && e.touches.length === 1)
            ? { group: t.getAttribute('data-wiz-preview'), x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }
    function onTouchEnd(e) {
        var start = W.touch;
        W.touch = null;
        if (!start || !e.changedTouches || !e.changedTouches.length) { return; }
        var dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) { return; }
        var opts = optsFor(start.group);
        var to = indexOfCode(opts, highlighted(start.group)) + (dx < 0 ? 1 : -1);
        if (to < 0 || to >= opts.length) { return; }
        selectOption(start.group, to, false);
    }

    // Text input inside the overlay (the tomorrow.io key field). Mirror the value into shared state
    // like the engine's #scroll input handler does; the country searchSelect's search box lives in the
    // top-layer #modal (engine-wired), not here, so this only ever sees embedded settings fields.
    function onInput(e) {
        var inp = e.target && e.target.closest && e.target.closest('input[type=text][data-k]');
        if (!inp) { return; }
        var k = inp.getAttribute('data-k');
        W.ctx.S[k] = inp.value;
        if (k === 'tomorrowioApiKey') { onTomorrowioKey(inp.value); }
    }

    // A non-empty key makes tomorrow.io the weather provider (the upsell's whole point); clearing it
    // reverts to the country-derived provider. We don't re-render on keystrokes (would drop input
    // focus), and it isn't needed: the upsell's visibility gate is the COUNTRY's recommended provider
    // (see stepDone), so flipping S.provider here never changes whether the upsell shows. Runs the same
    // pollen cleanup the provider picker + applyDerived do, and updates the summary's Weather line.
    function onTomorrowioKey(val) {
        var oldProvider = W.ctx.S.provider;
        var hasKey = Boolean(String(val || '').replace(/\s/g, ''));
        var next = hasKey ? 'tomorrowio' : mapCountry(W.ctx.S.holidayCountry).provider;
        if (next === oldProvider) { return; }
        W.ctx.S.provider = next;
        var cleanup = PConf.onChange && PConf.onChange.get && PConf.onChange.get('clearPollenForProvider');
        if (cleanup) { cleanup(W.ctx.S, oldProvider, next); }
        var weather = W.overlay && W.overlay.querySelector('[data-wiz-sum-weather]');
        if (weather) { weather.textContent = settingLabel('provider', next) || '—'; }
    }

    function ensureStyle() {
        if (document.getElementById('wiz-style')) { return; }
        var st = document.createElement('style');
        st.id = 'wiz-style';
        st.textContent = WIZ_CSS;
        document.head.appendChild(st);
    }

    function openWizard(ctx, fresh) {
        if (W.overlay) { closeWizard(); }   // "Run setup again" while one is up: start over, never stack two
        W.ctx = ctx; W.steps = buildSteps(ctx.ENV); W.idx = 0;
        W.healthAtOpen = ctx.S.healthMode;   // see applyHealthModeChange
        if (fresh) {
            // An undetected country, or one the holiday list doesn't offer (IN, AE, …), is
            // 'none' — NOT the schema default 'DE', which would derive the Germany-only DWD
            // weather + radar and German holidays and show "Germany" as if it were detected.
            // mapCountry('none') is the "everyone else" row: Open-Meteo + Rainbow, metric.
            var cc = inferCountry();
            var cOpts = optionsFor(ctx.schema, 'holidayCountry');
            ctx.S.holidayCountry = (cc && optionHasCode(cOpts, cc)) ? cc : 'none';
            ctx.S.holidayRegion = 'all';
            applyDerived(ctx.S);
        }
        ensureStyle();
        var overlay = document.createElement('div');
        overlay.id = 'wizard';
        if (overlay.setAttribute) {
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'wiz-title');
        }
        overlay.innerHTML =
            '<div class="wiz-top" data-wiz-top></div>'
            + '<div class="wiz-body" data-wiz-body></div>'
            + '<div class="wiz-foot" data-wiz-foot></div>';
        document.body.appendChild(overlay);
        W.overlay = overlay;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('input', onInput);
        overlay.addEventListener('keydown', onKeydown);
        overlay.addEventListener('touchstart', onTouchStart);
        overlay.addEventListener('touchend', onTouchEnd);
        renderStep('open');
    }

    // Registration (guarded so requiring this file in Node tests is a no-op).
    if (PConf.hooks && PConf.hooks.onReady) {
        PConf.hooks.onReady(function (ctx) {
            W.ctx = ctx;
            if (shouldShow(ctx.cfg)) { openWizard(ctx, true); }
        });
    }
    PConf.actions = PConf.actions || {};
    PConf.actions.startWizard = function () { if (W.ctx) { openWizard(W.ctx, false); } };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            countryFromTimezone: countryFromTimezone, countryFromLocale: countryFromLocale,
            inferCountry: inferCountry, mapCountry: mapCountry, applyDerived: applyDerived,
            applyWizardDefaults: applyWizardDefaults,
            buildSteps: buildSteps, shouldShow: shouldShow,
            flickStops: flickStops
        };
    }
})();

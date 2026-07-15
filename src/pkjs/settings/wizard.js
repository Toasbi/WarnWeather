// src/pkjs/settings/wizard.js — ES5, WebView. First-run onboarding wizard.
// Pure helpers (top) are unit-tested via module.exports; the DOM controller (added later)
// registers onReady + PConf.actions.startWizard and is exercised via `mise preview-config`.
/* global PConf, Intl, navigator, document, INJECTED_SCHEMA, VIEW_CYCLE */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    // Node (tests): view-cycle.js is a real CommonJS module — require it. Webview: it is
    // concatenated as a plain <script> before this file (scripts/build-config-page.js) and
    // shares the top-level scope as VIEW_CYCLE. Same pattern as settings/blocks.js.
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;

    // Compact IANA-timezone -> ISO-3166-1 alpha-2 table. Covers DE + the Nordic metno
    // zones (the countries that change the derived provider) plus common others; anything
    // absent falls through to the navigator.language region subtag.
    var TZ_COUNTRY = {
        'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE',
        'Europe/Oslo': 'NO', 'Europe/Stockholm': 'SE', 'Europe/Copenhagen': 'DK',
        'Europe/Helsinki': 'FI', 'Atlantic/Reykjavik': 'IS',
        'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Paris': 'FR',
        'Europe/London': 'GB', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
        'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Warsaw': 'PL',
        'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
        'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'Australia/Sydney': 'AU'
    };
    // Countries served by the metno (MET Norway) 2.5 km model — the "Nordics only" set.
    var METNO_COUNTRIES = { NO: true, SE: true, DK: true, FI: true, IS: true };
    // Countries that use Fahrenheit. Realistically the inference table only yields US here;
    // kept as a set so it's trivially extensible (Liberia, some Caribbean territories, …).
    var FAHRENHEIT_COUNTRIES = { US: true };

    /**
     * Map an IANA timezone id to an ISO country code.
     * @param {?string} tz IANA timezone id (e.g. 'Europe/Berlin').
     * @returns {?string} ISO alpha-2 code, or null if unknown.
     */
    function countryFromTimezone(tz) {
        return (tz && TZ_COUNTRY[tz]) || null;
    }

    /**
     * Extract the ISO country from a BCP-47 locale's region subtag.
     * @param {?string} lang Locale tag (e.g. 'de-DE').
     * @returns {?string} ISO alpha-2 code, or null if absent.
     */
    function countryFromLocale(lang) {
        if (!lang) { return null; }
        var parts = String(lang).split('-');
        return (parts.length > 1 && parts[1].length === 2) ? parts[1].toUpperCase() : null;
    }

    /**
     * Best-effort country inference: timezone first, then locale region subtag.
     * @returns {?string} ISO alpha-2 code, or null if it can't be determined.
     */
    function inferCountry() {
        var tz = null, lang = null;
        try {
            if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            }
        } catch (e) { tz = null; }
        var fromTz = countryFromTimezone(tz);
        if (fromTz) { return fromTz; }
        try {
            lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : null;
        } catch (e2) { lang = null; }
        return countryFromLocale(lang);
    }

    /**
     * Derive the weather + radar provider AND temperature unit from a country code.
     * @param {?string} cc ISO alpha-2 country code.
     * @returns {{provider: string, radarProvider: string, temperatureUnits: string}} Derived settings.
     */
    function mapCountry(cc) {
        var units = (cc && FAHRENHEIT_COUNTRIES[cc]) ? 'f' : 'c';
        if (cc === 'DE') { return { provider: 'dwd', radarProvider: 'dwd', temperatureUnits: units }; }
        if (cc && METNO_COUNTRIES[cc]) { return { provider: 'metno', radarProvider: 'metno', temperatureUnits: units }; }
        return { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: units };
    }

    /**
     * Ordered wizard step ids, filtered by platform env: health only where the platform
     * has it, and the flick demo only where there is a second view to flick to (env.radar
     * — false on aplite, whose single view leaves nothing to demo). layout and health are
     * the selection steps that shape the cycle, so the demo comes after both and shows the
     * user's real cycle.
     * @param {{radar: boolean, health: boolean}} env Config-UI env facts.
     * @returns {Array.<string>} Step ids in order.
     */
    function buildSteps(env) {
        env = env || {};
        var steps = ['welcome', 'layout'];
        if (env.health) { steps.push('health'); }
        if (env.radar) { steps.push('flick'); }
        steps.push('theme');
        steps.push('done');
        return steps;
    }

    /**
     * Whether the radar step should show the DWD "nearby (~2 km)" note.
     * @param {?string} radarProvider Selected radar provider id.
     * @returns {boolean} True only for DWD.
     */
    function radarNearby(radarProvider) { return radarProvider === 'dwd'; }

    // Fixed per-stop demo copy (spec 2026-07-15). The Default caption is intentionally
    // preset-independent; the radar caption gains the DWD "nearby" sentence via radarNearby().
    var FLICK_CAPTION_DEFAULT = 'your calendar, weather status and forecast.';
    var FLICK_CAPTION_GRAPH = 'hourly step bars, a sleep band and a heart-rate line.';
    var FLICK_CAPTION_STATUS = 'today’s steps, last night’s sleep and current heart rate on the status line.';
    var FLICK_CAPTION_RADAR = 'a precise short-term rain forecast for the next 2 hours, in 5-minute frames. When rain’s on the way, the status strip counts it down (“Rain in 15’”).';
    var FLICK_CAPTION_RADAR_NEARBY = ' DWD also shows rain nearby (~2 km), not just at your exact spot.';

    /**
     * Describe one cycle slot as a flick-demo stop: display label, caption, and the
     * SHOTS screenshot key. shotGroup 'radar' flags the string-typed radar shot
     * (SHOTS[platform].radar is a plain data URI, not a {val: uri} map).
     * @param {{tier:number,top:number,body:number,status:number}} viewSpec One ViewSpec slot.
     * @param {boolean} isFirst True for cycle index 0 (the default view).
     * @param {Object} state Wizard/Clay settings state.
     * @returns {{label:string,caption:string,shotGroup:string,shotVal:string}} Stop descriptor.
     */
    function flickStop(viewSpec, isFirst, state) {
        state = state || {};
        if (viewSpec.body === VC.BODY_GRAPH) {
            return { label: 'Health graph', caption: FLICK_CAPTION_GRAPH, shotGroup: 'healthMode', shotVal: 'all' };
        }
        if (viewSpec.body === VC.BODY_RADAR) {
            var cap = FLICK_CAPTION_RADAR;
            if (radarNearby(state.radarProvider)) { cap += FLICK_CAPTION_RADAR_NEARBY; }
            return { label: 'Radar', caption: cap, shotGroup: 'radar', shotVal: '' };
        }
        if (!isFirst && (viewSpec.status === VC.ST_H || viewSpec.status === VC.ST_D)) {
            // Health-status flick stop: BODY_FC carrying the health status row. ST_D is the
            // fullCal/status dual-status variant — healthMode.status represents both.
            return { label: 'Health status', caption: FLICK_CAPTION_STATUS, shotGroup: 'healthMode', shotVal: 'status' };
        }
        var pk = VC.resolvePresetKey(state);
        if (pk === 'compactDense') { pk = 'compactCal'; } // no captured shot for compactDense; compactCal is the nearest (same 2-row calendar)
        return { label: 'Default', caption: FLICK_CAPTION_DEFAULT, shotGroup: 'layoutPreset', shotVal: pk };
    }

    /**
     * The flick-demo stop list for the current settings: the REAL view cycle
     * (view-cycle.js — the same call blocks.js's presetContents makes) mapped to
     * stop descriptors. 1–3 entries; radar, when present, is always last.
     * @param {Object} state Wizard/Clay settings state.
     * @returns {Array.<{label:string,caption:string,shotGroup:string,shotVal:string}>} Stops.
     */
    function flickStops(state) {
        state = state || {};
        var radarEnabled = state.radarProvider !== 'disabled';
        var cycle = VC.buildViewCycle(VC.resolvePresetKey(state), state.healthMode || 'off', radarEnabled);
        var stops = [], i;
        for (i = 0; i < cycle.length; i += 1) { stops.push(flickStop(cycle[i], i === 0, state)); }
        return stops;
    }

    /**
     * Whether the wizard should auto-open: only on a fresh install (no saved keys) that
     * hasn't completed onboarding.
     * @param {?Object} cfg Raw injected saved config.
     * @returns {boolean} True to auto-open.
     */
    function shouldShow(cfg) {
        cfg = cfg || {};
        if (cfg.onboardingDone) { return false; }
        var k;
        for (k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) { return false; } }
        return true;
    }

    // ---- DOM controller (webview only; exercised via `mise preview-config`, not Node) ----
    var LAYOUT_OPTS = [['Full calendar', 'fullCal'], ['Compact', 'compactCal'], ['No calendar', 'noCal']];
    var HEALTH_OPTS = [['Off', 'off'], ['Status bar', 'status'], ['Status + graph', 'all']];
    var STEP_TITLES = {
        welcome: 'Welcome to WarnWeather', layout: 'Choose your layout',
        health: 'Health', flick: 'Flick to explore',
        theme: 'Choose your theme', done: 'All set'
    };
    // Per-option copy shown under the carousel for the centered selection (fixes "text doesn't update").
    // Bodies only — the carousel prepends the option's own label in bold (see cardHintHtml).
    var LAYOUT_DESC = {
        fullCal: 'a three-row month grid with today highlighted, above the weather status and forecast.',
        compactCal: 'a slim agenda row, leaving more room for the 24-hour forecast graph.',
        noCal: 'a big clock and date with the weather status and full-screen forecast.'
    };
    var HEALTH_DESC = {
        off: 'no health information on the watchface.',
        status: 'today’s steps, last night’s sleep and current heart rate on the status line.',
        all: 'the status line plus a flick-away graph: hourly step bars, a sleep band and a heart-rate line.'
    };
    // Watchface theme (messageKey 'theme'). Mirrors schema.js's two theme selects: color watches get
    // 4 options, B&W hardware only dark/light. Chosen by env.color at render time.
    var THEME_OPTS_COLOR = [['Dark', 'dark'], ['Light (Alpha)', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']];
    var THEME_OPTS_BW = [['Dark', 'dark'], ['Light (Alpha)', 'light']];
    var THEME_DESC = {
        dark: 'black background, white text and lines (the default).',
        light: 'white background, black text and lines.',
        bw: 'renders like a Black & White watch — the same drawing, on your color display.',
        'bw-light': 'like a Black & White watch in its light theme — black on white.'
    };
    // Real watch screenshots, base64-inlined by `mise capture-wizard-screenshots` into
    // wizard-screenshots.generated.js (which assigns PConf.screenshots when concatenated into the
    // page). Empty {} in the Node harness — the controller runs only in the webview.
    var SHOTS = (PConf && PConf.screenshots) ? PConf.screenshots : {};

    // Overlay styles: use the app's CSS custom properties so the wizard follows body.light (theme).
    // Brand red #FA4A35 / its gradient are intentionally hardcoded to match .hdr h1 / .saveBtn / .tab.on.
    var WIZ_CSS =
        '#wizard{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,sans-serif}'
        + '#wizard .wiz-hd{padding:16px 18px 6px;flex:none}'
        + '#wizard .wiz-hd h2{margin:0;color:#FA4A35;font-size:19px;font-weight:800}'
        + '#wizard .wiz-body{flex:1;min-height:0;overflow-y:auto;padding:4px 18px 16px}'
        + '#wizard .wiz-foot{flex:none;display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--card-line)}'
        + '#wizard .wiz-head{font:700 12px Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:6px 0 8px}'
        + '#wizard p{line-height:1.55}#wizard a{color:var(--link)}'
        + '#wizard .wiz-car{position:relative;display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;'
        + '-webkit-overflow-scrolling:touch;padding:6px calc(50% - 75px) 14px;scrollbar-width:none}'
        + '#wizard .wiz-car::-webkit-scrollbar{display:none}'
        + '#wizard .wiz-card{scroll-snap-align:center;flex:none;width:150px;background:var(--card);'
        + 'border:1px solid var(--screen-line);border-radius:10px;padding:0;overflow:hidden;cursor:pointer;'
        + 'opacity:.5;transform:scale(.94);transition:opacity .15s,border-color .15s,transform .15s}'
        + '#wizard .wiz-card.on{opacity:1;border:2px solid #FA4A35;transform:scale(1)}'
        + '#wizard .wiz-shot{display:block;max-width:100%;height:auto;margin:0 auto;image-rendering:pixelated}'
        + '#wizard .wiz-card .cap{font:700 12px Inter,sans-serif;color:var(--muted);padding:7px 4px}'
        + '#wizard .wiz-cardhint{line-height:1.5;color:var(--fg);min-height:2.6em;margin:2px 0 10px}'
        + '#wizard .wiz-radar{display:table;max-width:100%;margin:0 auto;border:1px solid var(--screen-line);border-radius:10px;overflow:hidden;background:var(--card)}'
        + '#wizard .wiz-nav{flex:1;padding:12px;border-radius:11px;font:700 14px Inter,sans-serif;cursor:pointer}'
        + '#wizard .wiz-nav.pri{border:none;background:linear-gradient(135deg,#FA4A35,#D93A24);color:#fff}'
        + '#wizard .wiz-nav.sec{border:1px solid var(--ctl-line);background:var(--ctl);color:var(--fg)}'
        // Flick demo: watch bezel (reuses the screen-framing tokens: var(--screen-line) border,
        // rounded corners, var(--card) background), tilt-and-snap keyframes with a faint motion
        // arc (::after), cycle dots + label, primary button.
        + '#wizard .wiz-flick{text-align:center;margin-top:14px}'
        + '#wizard .wiz-flick-watch{position:relative;display:inline-block;cursor:pointer;transform-origin:50% 100%}'
        + '#wizard .wiz-flick-watch.tilt{animation:wiz-tilt .45s ease-in-out}'
        + '#wizard .wiz-flick-watch::after{content:"";position:absolute;top:-16px;left:50%;width:70px;height:34px;'
        + 'margin-left:-35px;border:2px solid transparent;border-top-color:var(--muted);'
        + 'border-radius:50% 50% 0 0/100% 100% 0 0;opacity:0;pointer-events:none}'
        + '#wizard .wiz-flick-watch.tilt::after{animation:wiz-arc .45s ease-out}'
        + '#wizard .wiz-flick-bezel{position:relative;width:150px;min-height:90px;border:1px solid var(--screen-line);'
        + 'border-radius:12px;overflow:hidden;background:var(--card)}'
        + '#wizard .wiz-flick-shot{opacity:0;transition:opacity .18s}'
        + '#wizard .wiz-flick-shot.on{opacity:1}'
        + '#wizard .wiz-flick-shot+.wiz-flick-shot{position:absolute;top:0;left:0;right:0}'
        + '#wizard .wiz-flick-strap{width:96px;height:10px;margin:3px auto 0;background:var(--ctl);'
        + 'border:1px solid var(--ctl-line);border-radius:5px}'
        + '#wizard .wiz-flick-track{display:flex;align-items:center;justify-content:center;gap:9px;margin:12px 0 2px}'
        + '#wizard .wiz-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);'
        + 'opacity:.35;margin:0 2px;vertical-align:middle}'
        + '#wizard .wiz-dot.on{background:#FA4A35;opacity:1}'
        + '#wizard .wiz-flick-label{font:700 13px Inter,sans-serif;color:var(--fg)}'
        + '#wizard .wiz-flick-btn{display:block;margin:10px auto 2px;padding:11px 26px;border:none;border-radius:11px;'
        + 'background:linear-gradient(135deg,#FA4A35,#D93A24);color:#fff;font:700 14px Inter,sans-serif;cursor:pointer}'
        + '#wizard .wiz-flick-btn:focus-visible{outline:2px solid #FA4A35;outline-offset:2px}'
        + '#wizard .wiz-flick-cap{margin-top:10px;text-align:left}'
        + '@keyframes wiz-tilt{0%{transform:rotate(0)}30%{transform:rotate(14deg)}55%{transform:rotate(-5deg)}'
        + '75%{transform:rotate(2deg)}100%{transform:rotate(0)}}'
        + '@keyframes wiz-arc{0%{opacity:0}30%{opacity:.7}100%{opacity:0}}'
        + '@media (prefers-reduced-motion:reduce){#wizard .wiz-flick-watch.tilt{animation:none}'
        + '#wizard .wiz-flick-watch.tilt::after{animation:none}}';

    // Live wizard state, captured from the onReady ctx when the wizard opens.
    // flickIdx = current stop of the flick demo (reset to 0 whenever stepFlick renders).
    var W = { ctx: null, steps: [], idx: 0, overlay: null, openSelect: null, selectQuery: '', flickIdx: 0 };

    function esc(s) { return (PConf.engine && PConf.engine.esc) ? PConf.engine.esc(s) : String(s); }

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

    // Country → provider + radar provider + temperature unit, written onto shared state.
    function applyDerived() {
        var m = mapCountry(W.ctx.S.holidayCountry);
        W.ctx.S.provider = m.provider;
        W.ctx.S.radarProvider = m.radarProvider;
        W.ctx.S.temperatureUnits = m.temperatureUnits;
    }

    // --- screen 1: reuse the real settings searchSelect for country/region ---
    // A clone of the schema item with its concrete options resolved (region derives from country),
    // rendered through the engine's own row/control renderers so it looks + behaves like Settings.
    function selectRow(schema, key) {
        var item = findItem(schema, key);
        if (!item) { return ''; }
        var withOpts = Object.assign({}, item, { options: PConf.engine.resolveOptionsFrom(item, W.ctx.S) });
        return PConf.engine.renderRow(withOpts, { value: W.ctx.S[key], openSelect: W.openSelect, selectQuery: W.selectQuery });
    }
    function regionHasOptions(schema) {
        var item = findItem(schema, 'holidayRegion');
        return Boolean(item && PConf.engine.resolveOptionsFrom(item, W.ctx.S).length);
    }
    // Rebuild only the open list (sibling of the search box) so typing keeps input focus + cursor.
    function refilter(key) {
        var item = findItem(W.ctx.schema, key);
        if (!item) { return; }
        var withOpts = Object.assign({}, item, { options: PConf.engine.resolveOptionsFrom(item, W.ctx.S) });
        var list = W.overlay.querySelector('[data-ssel-list="' + key + '"]');
        if (list) { list.innerHTML = PConf.engine.renderSelectOptions(withOpts, W.ctx.S[key], W.selectQuery); }
    }
    function focusOverlaySearch() {
        var el = W.overlay.querySelector('[data-select-search]');
        if (el) { el.focus(); }
    }

    // --- screens 2 & 4: carousel of real screenshots ---
    // Screenshots are keyed by platform (SHOTS[platform][group][val]) so each watch sees its own
    // rendering. diorite isn't captured separately — it's a B&W watch with health+radar, same class
    // as flint, so it reuses flint's shots.
    function shotPlatform() {
        var p = (W.ctx && W.ctx.ENV && W.ctx.ENV.platform) || 'basalt';
        return (p === 'diorite') ? 'flint' : p;
    }
    function shotSet() { return SHOTS[shotPlatform()] || {}; }
    function shotFor(group, val) { var s = shotSet(); return (s[group] && s[group][val]) || ''; }
    function carCard(group, label, val, on) {
        return '<button class="wiz-card' + (on ? ' on' : '') + '" data-wiz-idx-val="' + esc(val) + '">'
            + '<img class="wiz-shot" src="' + esc(shotFor(group, val)) + '" alt="">'
            + '<div class="cap">' + esc(label) + '</div></button>';
    }
    function labelFor(opts, val) {
        var i; for (i = 0; i < opts.length; i += 1) { if (opts[i][1] === val) { return opts[i][0]; } }
        return '';
    }
    // The selected option's name in bold, then its description — matching the bold-label bullets
    // used elsewhere in the steps.
    function cardHintHtml(label, body) { return '<b>' + esc(label) + '</b> — ' + esc(body || ''); }
    function carousel(group, opts, selVal, desc) {
        var h = '<div class="wiz-car" data-wiz-car="' + esc(group) + '">', i;
        for (i = 0; i < opts.length; i += 1) { h += carCard(group, opts[i][0], opts[i][1], opts[i][1] === selVal); }
        h += '</div><p class="wiz-cardhint">' + cardHintHtml(labelFor(opts, selVal), desc[selVal]) + '</p>';
        return h;
    }
    function optsFor(group) {
        if (group === 'layoutPreset') { return LAYOUT_OPTS; }
        if (group === 'healthMode') { return HEALTH_OPTS; }
        return (W.ctx.ENV && W.ctx.ENV.color) ? THEME_OPTS_COLOR : THEME_OPTS_BW;   // 'theme'
    }
    function descFor(group) {
        if (group === 'layoutPreset') { return LAYOUT_DESC; }
        if (group === 'healthMode') { return HEALTH_DESC; }
        return THEME_DESC;   // 'theme'
    }
    // Scroll the selected card to the horizontal center (offsetParent is the position:relative .wiz-car).
    function centerCar() {
        var car = W.overlay.querySelector('.wiz-car'); if (!car) { return; }
        var on = car.querySelector('.wiz-card.on'); if (!on) { return; }
        car.scrollLeft = on.offsetLeft + on.offsetWidth / 2 - car.clientWidth / 2;
    }
    // Commit a carousel selection: update state, the .on highlight, and the description text in place
    // (no full re-render, so a swipe isn't interrupted). recenter=true also scrolls it to center.
    function selectCar(group, idx, recenter) {
        var opts = optsFor(group);
        idx = Math.max(0, Math.min(opts.length - 1, idx));
        var newVal = opts[idx][1];
        if (group === 'theme') {
            var oldTheme = W.ctx.S.theme;
            W.ctx.S.theme = newVal;
            var conv = (PConf.onChange && PConf.onChange.get) ? PConf.onChange.get('themeConvert') : null;
            if (conv) { conv(W.ctx.S, oldTheme, newVal); }
        } else {
            W.ctx.S[group] = newVal;
        }
        var car = W.overlay.querySelector('[data-wiz-car="' + group + '"]'); if (!car) { return; }
        var cards = car.querySelectorAll('.wiz-card'), i;
        for (i = 0; i < cards.length; i += 1) { cards[i].className = (i === idx) ? 'wiz-card on' : 'wiz-card'; }
        var hint = car.parentNode.querySelector('.wiz-cardhint');
        if (hint) { hint.innerHTML = cardHintHtml(opts[idx][0], descFor(group)[opts[idx][1]]); }
        if (recenter && cards[idx]) { car.scrollLeft = cards[idx].offsetLeft + cards[idx].offsetWidth / 2 - car.clientWidth / 2; }
    }
    function nearestCard(car) {
        var cards = car.querySelectorAll('.wiz-card'), mid = car.scrollLeft + car.clientWidth / 2;
        var best = 0, bestd = 1e9, i, cc;
        for (i = 0; i < cards.length; i += 1) {
            cc = cards[i].offsetLeft + cards[i].offsetWidth / 2;
            if (Math.abs(cc - mid) < bestd) { bestd = Math.abs(cc - mid); best = i; }
        }
        return best;
    }
    // On free scroll (swipe), select the card nearest the center without re-centering (don't fight the drag).
    function wireCar() {
        var car = W.overlay.querySelector('.wiz-car'); if (!car) { return; }
        var group = car.getAttribute('data-wiz-car'), pending = false;
        car.addEventListener('scroll', function () {
            if (pending) { return; }
            pending = true;
            setTimeout(function () { pending = false; selectCar(group, nearestCard(car), false); }, 90);
        });
    }

    // --- flick demo (step 'flick'): interactive tilt-and-snap through the real cycle ---
    // 1x1 transparent GIF, shown only if a stop unexpectedly has no screenshot. Stays unreachable
    // because the Default stop clamps compactDense (the one preset with no captured shot) to
    // compactCal, and scripts/build-config-page.js hard-fails the build on any other missing wizard
    // shot — so the fallback stays a blank watch face (padded out by the bezel's min-height rather
    // than collapsing to a sliver); the dots label + caption below still identify the stop.
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
        var stops = flickStops(W.ctx.S);
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
    function stepWelcome() {
        var schema = W.ctx.schema;
        var h = '<p>Thanks for trying WarnWeather! We’ll apply the best settings for your country — you can change anything later. This quick setup is optional; skip it any time.</p>'
            + '<div class="wiz-head">Choose your country</div>'
            + selectRow(schema, 'holidayCountry');
        if (regionHasOptions(schema)) { h += selectRow(schema, 'holidayRegion'); }
        return h;
    }
    function stepLayout() {
        return carousel('layoutPreset', LAYOUT_OPTS, W.ctx.S.layoutPreset, LAYOUT_DESC)
            + '<div>'
            + '<p><b>Weather status</b> — the top strip shows your location, current conditions and sunset.</p>'
            + '<p><b>Forecast</b> — a 24-hour graph: temperature, the precipitation-% line, UV dots and rain bars.</p></div>';
    }
    function stepHealth() {
        return carousel('healthMode', HEALTH_OPTS, W.ctx.S.healthMode, HEALTH_DESC);
    }
    function stepFlick() {
        // Render always opens on stop 0 (the default view), so re-entering the step resets
        // the demo — keeps W.flickIdx and the DOM trivially in sync.
        W.flickIdx = 0;
        var stops = flickStops(W.ctx.S);
        var stop = stops[0];
        var src = esc(stopShot(stop));
        return '<p>Your watch shows one view at a time. Flick your wrist to peek at the rest — it returns to your default view on its own.</p>'
            + '<div class="wiz-flick">'
            + '<div class="wiz-flick-watch" data-wiz-flick-watch data-wiz-flick>'
            + '<div class="wiz-flick-bezel">'
            + '<img class="wiz-shot wiz-flick-shot on" src="' + src + '" alt="">'
            + '<img class="wiz-shot wiz-flick-shot" src="' + src + '" alt="">'
            + '</div>'
            + '<div class="wiz-flick-strap"></div>'
            + '</div>'
            + '<div class="wiz-flick-track">'
            + '<span data-wiz-flick-dots>' + flickDotsHtml(stops.length, 0) + '</span>'
            + '<span class="wiz-flick-label" data-wiz-flick-label>' + esc(stop.label) + '</span>'
            + '</div>'
            + '<button class="wiz-flick-btn" data-wiz-flick>⟳&nbsp;&nbsp;Flick wrist</button>'
            + '<p class="wiz-cardhint wiz-flick-cap" data-wiz-flick-cap>' + cardHintHtml(stop.label, stop.caption) + '</p>'
            + '</div>';
    }
    function stepTheme() {
        return carousel('theme', optsFor('theme'), W.ctx.S.theme, THEME_DESC)
            + '<div><p>The theme sets your watchface’s colours. You can fine-tune individual colours later in Settings.</p></div>';
    }
    function stepDone() {
        return '<p><b>You’re all set!</b> Everything is editable later in the settings tabs, and you can run this setup again any time from <b>More → Misc → Run setup again</b>.</p>'
            + '<p>If you enjoy WarnWeather, please ♥ it on the Pebble appstore — it really helps.</p>'
            + '<p>Need help or have feedback? Open an issue on <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>, or use the appstore’s “Message the developer” to reach me directly.</p>';
    }
    function stepBody(id) {
        if (id === 'welcome') { return stepWelcome(); }
        if (id === 'layout') { return stepLayout(); }
        if (id === 'health') { return stepHealth(); }
        if (id === 'flick') { return stepFlick(); }
        if (id === 'theme') { return stepTheme(); }
        return stepDone();
    }

    // --- footer buttons ---
    function navBtn(nav, label, primary) {
        return '<button class="wiz-nav ' + (primary ? 'pri' : 'sec') + '" data-wiz-nav="' + nav + '">' + esc(label) + '</button>';
    }
    function footer(id) {
        if (id === 'welcome') { return navBtn('skip', 'Skip', false) + navBtn('next', 'Get started', true); }
        if (id === 'done') { return navBtn('tweak', 'Continue tweaking', false) + navBtn('save', 'Save & close', true); }
        return navBtn('back', 'Back', false) + navBtn('next', 'Next', true);
    }

    function renderStep() {
        var id = W.steps[W.idx];
        W.overlay.querySelector('[data-wiz-title]').textContent = STEP_TITLES[id] || '';
        W.overlay.querySelector('[data-wiz-body]').innerHTML = stepBody(id);
        W.overlay.querySelector('[data-wiz-foot]').innerHTML = footer(id);
        if (W.openSelect) { focusOverlaySearch(); }
        wireCar();
        centerCar();
    }

    function closeWizard() {
        if (W.overlay && W.overlay.parentNode) { W.overlay.parentNode.removeChild(W.overlay); }
        W.overlay = null;
    }
    // Keep the overlay up: save() flashes a toast then navigates back to the watch, which unloads
    // the page. Removing the overlay first would flash the settings menu before that navigation.
    function finishSave() { W.ctx.set('onboardingDone', true); W.ctx.save(); }
    function finishTweak() { W.ctx.set('onboardingDone', true); closeWizard(); W.ctx.render(); }

    function onNav(nav) {
        if (nav === 'back') { W.idx = Math.max(0, W.idx - 1); W.openSelect = null; renderStep(); }
        else if (nav === 'next') { W.idx = Math.min(W.steps.length - 1, W.idx + 1); W.openSelect = null; renderStep(); }
        else if (nav === 'save') { finishSave(); }
        // Skip closes the wizard onto the live settings page (same as "Continue tweaking"),
        // rather than saving and navigating back to the watch.
        else if (nav === 'skip' || nav === 'tweak') { finishTweak(); }
    }

    function onClick(e) {
        if (!e.target || !e.target.closest) { return; }
        var t;
        if ((t = e.target.closest('[data-wiz-nav]'))) { onNav(t.getAttribute('data-wiz-nav')); return; }
        if ((t = e.target.closest('[data-select-pick]'))) {
            var pk = t.getAttribute('data-k'); W.ctx.S[pk] = t.getAttribute('data-select-pick');
            if (pk === 'holidayCountry') { W.ctx.S.holidayRegion = 'all'; applyDerived(); }
            W.openSelect = null; renderStep(); return;
        }
        if ((t = e.target.closest('[data-select]'))) {
            var sk = t.getAttribute('data-select'); W.openSelect = (W.openSelect === sk ? null : sk); W.selectQuery = '';
            renderStep(); focusOverlaySearch(); return;
        }
        if ((t = e.target.closest('[data-wiz-idx-val]'))) {
            var group = t.parentNode.getAttribute('data-wiz-car');
            selectCar(group, indexOfCode(optsFor(group), t.getAttribute('data-wiz-idx-val')), true); return;
        }
        if ((t = e.target.closest('[data-wiz-flick]'))) { advanceFlick(); return; }
    }
    function onInput(e) {
        var sb = e.target.closest ? e.target.closest('[data-select-search]') : null;
        if (!sb) { return; }
        W.selectQuery = sb.value;
        refilter(sb.getAttribute('data-select-search'));
    }

    function ensureStyle() {
        if (document.getElementById('wiz-style')) { return; }
        var st = document.createElement('style');
        st.id = 'wiz-style';
        st.textContent = WIZ_CSS;
        document.head.appendChild(st);
    }

    function openWizard(ctx, fresh) {
        W.ctx = ctx; W.steps = buildSteps(ctx.ENV); W.idx = 0; W.openSelect = null; W.selectQuery = '';
        if (fresh) {
            var cc = inferCountry();
            var cOpts = optionsFor(ctx.schema, 'holidayCountry');
            if (cc && optionHasCode(cOpts, cc)) { ctx.S.holidayCountry = cc; ctx.S.holidayRegion = 'all'; }
            applyDerived();
        }
        ensureStyle();
        var overlay = document.createElement('div');
        overlay.id = 'wizard';
        overlay.innerHTML =
            '<div class="wiz-hd"><h2 data-wiz-title></h2></div>'
            + '<div class="wiz-body" data-wiz-body></div>'
            + '<div class="wiz-foot" data-wiz-foot></div>';
        document.body.appendChild(overlay);
        W.overlay = overlay;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('input', onInput);
        renderStep();
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
            inferCountry: inferCountry, mapCountry: mapCountry,
            buildSteps: buildSteps, radarNearby: radarNearby, shouldShow: shouldShow,
            flickStops: flickStops
        };
    }
})();

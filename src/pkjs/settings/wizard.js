// src/pkjs/settings/wizard.js — ES5, WebView. First-run onboarding wizard.
// Pure helpers (top) are unit-tested via module.exports; the DOM controller (added later)
// registers onReady + PConf.actions.startWizard and is exercised via `mise preview-config`.
/* global PConf, Intl, navigator, document, INJECTED_SCHEMA */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
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
     * Derive the weather + radar provider from a country code.
     * @param {?string} cc ISO alpha-2 country code.
     * @returns {{provider: string, radarProvider: string}} Derived provider ids.
     */
    function mapCountry(cc) {
        if (cc === 'DE') { return { provider: 'dwd', radarProvider: 'dwd' }; }
        if (cc && METNO_COUNTRIES[cc]) { return { provider: 'metno', radarProvider: 'metno' }; }
        return { provider: 'openmeteo', radarProvider: 'rainbow' };
    }

    /**
     * Ordered wizard step ids, filtered by platform env (radar/health absent on aplite).
     * @param {{radar: boolean, health: boolean}} env Config-UI env facts.
     * @returns {Array.<string>} Step ids in order.
     */
    function buildSteps(env) {
        env = env || {};
        var steps = ['welcome', 'layout'];
        if (env.radar) { steps.push('radar'); }
        if (env.health) { steps.push('health'); }
        steps.push('done');
        return steps;
    }

    /**
     * Whether the radar step should show the DWD "nearby (~2 km)" note.
     * @param {?string} radarProvider Selected radar provider id.
     * @returns {boolean} True only for DWD.
     */
    function radarNearby(radarProvider) { return radarProvider === 'dwd'; }

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
        radar: 'Rain radar', health: 'Health', done: 'All set'
    };

    // Live wizard state, captured from the onReady ctx when the wizard opens.
    var W = { ctx: null, steps: [], idx: 0, overlay: null };

    function esc(s) { return (PConf.engine && PConf.engine.esc) ? PConf.engine.esc(s) : String(s); }

    function findItem(schema, key) {
        var found = null;
        if (PConf.schemaWalk && PConf.schemaWalk.eachItem) {
            PConf.schemaWalk.eachItem(schema, function (it) { if (it.messageKey === key) { found = it; } });
        }
        return found;
    }
    function optionsFor(schema, key) { var it = findItem(schema, key); return (it && it.options) || []; }
    function regionMap(schema) { var it = findItem(schema, 'holidayRegion'); return (it && it.optionsFrom && it.optionsFrom.map) || {}; }
    function optionHasCode(opts, code) {
        var i; for (i = 0; i < opts.length; i += 1) { if (opts[i][1] === code) { return true; } }
        return false;
    }

    function applyProviders() {
        var m = mapCountry(W.ctx.S.holidayCountry);
        W.ctx.S.provider = m.provider;
        W.ctx.S.radarProvider = m.radarProvider;
    }

    // --- small HTML builders (inline styles; no shell.html CSS needed) ---
    function selectHtml(id, opts, val) {
        var h = '<select data-wiz-select="' + esc(id) + '" style="-webkit-appearance:none;appearance:none;background:#46474C;color:#ECEEF3;border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:8px 12px;font:600 13.5px Inter,sans-serif;max-width:200px">', i;
        for (i = 0; i < opts.length; i += 1) {
            h += '<option value="' + esc(opts[i][1]) + '"' + (opts[i][1] === val ? ' selected' : '') + '>' + esc(opts[i][0]) + '</option>';
        }
        return h + '</select>';
    }
    function fieldRow(label, control) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">'
            + '<div style="font-weight:600">' + esc(label) + '</div><div>' + control + '</div></div>';
    }
    function galleryCard(val, label, svg, on, key) {
        var border = on ? '2px solid #FA4A35' : '1px solid rgba(255,255,255,0.14)';
        return '<button data-wiz-pick="' + esc(val) + '" data-wiz-key="' + esc(key) + '" style="flex:none;width:150px;background:#000;border:' + border + ';border-radius:10px;padding:0;overflow:hidden;cursor:pointer">'
            + '<div style="width:100%">' + svg + '</div>'
            + '<div style="color:#B6BAC2;font:700 12px Inter,sans-serif;padding:7px 4px">' + esc(label) + '</div></button>';
    }
    function gallery(opts, currentVal, key, blockId, overrideKey) {
        var block = PConf.blocks.get(blockId), h = '<div style="display:flex;gap:10px;overflow-x:auto;padding:6px 0 12px">', i, val, over, svg;
        for (i = 0; i < opts.length; i += 1) {
            val = opts[i][1];
            over = {}; over[overrideKey] = val;
            svg = block ? block(Object.assign({}, W.ctx.S, over), W.ctx.ENV, W.ctx.USERDATA) : '';
            h += galleryCard(val, opts[i][0], svg, currentVal === val, key);
        }
        return h + '</div>';
    }

    // --- step bodies ---
    function stepWelcome() {
        var schema = W.ctx.schema, S = W.ctx.S;
        var cOpts = optionsFor(schema, 'holidayCountry');
        var rOpts = regionMap(schema)[S.holidayCountry] || null;
        var h = '<p style="line-height:1.55">Thanks for trying WarnWeather! We’ll apply the best settings for your country/region — you can change anything later. This quick setup is optional; skip it any time.</p>'
            + fieldRow('Country', selectHtml('country', cOpts, S.holidayCountry));
        if (rOpts) { h += fieldRow('Region', selectHtml('region', rOpts, S.holidayRegion)); }
        return h;
    }
    function stepLayout() {
        return gallery(LAYOUT_OPTS, W.ctx.S.layoutPreset, 'layoutPreset', 'layoutPreviewCombined', 'layoutPreset')
            + '<div style="line-height:1.55;color:#D2D5DC">'
            + '<p><b>Weather status</b> — the top strip shows your location, current conditions and sunset.</p>'
            + '<p><b>Forecast</b> — a 24-hour graph: temperature, the precipitation-% line, UV shown as dots, and rain-amount bars.</p></div>';
    }
    function stepRadar() {
        var block = PConf.blocks.get('radarPreview');
        var svg = block ? block(W.ctx.S, W.ctx.ENV, W.ctx.USERDATA) : '';
        var h = '<div style="border:1px solid rgba(255,255,255,0.14);border-radius:10px;overflow:hidden;background:#000">' + svg + '</div>'
            + '<div style="line-height:1.55;color:#D2D5DC">'
            + '<p><b>Rain radar</b> — a precise short-term rain forecast for the next 2 hours, in 5-minute frames.</p>'
            + '<p><b>Rain countdown</b> — when rain is heading your way, the status strip shows how soon it starts (e.g. “Rain in 15’”).</p>';
        if (radarNearby(W.ctx.S.radarProvider)) {
            h += '<p><b>Nearby</b> — DWD also shows rain around you (~2 km), not just at your exact spot.</p>';
        }
        return h + '</div>';
    }
    function stepHealth() {
        return gallery(HEALTH_OPTS, W.ctx.S.healthMode, 'healthMode', 'layoutPreviewCombined', 'healthMode')
            + '<div style="line-height:1.55;color:#D2D5DC">'
            + '<p><b>Health</b> — today’s steps, last night’s sleep and current heart rate. The graph adds hourly step bars, a sleep band and a heart-rate line.</p></div>';
    }
    function stepDone() {
        return '<p style="line-height:1.55"><b>You’re all set!</b> Everything is editable later in the settings tabs.</p>'
            + '<p style="line-height:1.55">If you enjoy WarnWeather, please ♥ it on the Pebble appstore — it really helps.</p>'
            + '<p style="line-height:1.55">Need help or have feedback? Open an issue on <a href="https://github.com/Toasbi/WarnWeather/issues" style="color:#FF6A52">GitHub</a>, or use the appstore’s “Message the developer” to reach me directly.</p>';
    }
    function stepBody(id) {
        if (id === 'welcome') { return stepWelcome(); }
        if (id === 'layout') { return stepLayout(); }
        if (id === 'radar') { return stepRadar(); }
        if (id === 'health') { return stepHealth(); }
        return stepDone();
    }

    // --- footer buttons ---
    function navBtn(nav, label, primary) {
        var s = primary
            ? 'flex:1;padding:12px;border:none;border-radius:11px;background:linear-gradient(135deg,#FA4A35,#D93A24);color:#fff;font:700 14px Inter,sans-serif;cursor:pointer'
            : 'flex:1;padding:12px;border:1px solid rgba(255,255,255,0.14);border-radius:11px;background:#3D3E42;color:#B6BAC2;font:700 14px Inter,sans-serif;cursor:pointer';
        return '<button data-wiz-nav="' + nav + '" style="' + s + '">' + esc(label) + '</button>';
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
    }

    function closeWizard() {
        if (W.overlay && W.overlay.parentNode) { W.overlay.parentNode.removeChild(W.overlay); }
        W.overlay = null;
    }
    function finishSave() { W.ctx.set('onboardingDone', true); closeWizard(); W.ctx.save(); }
    function finishTweak() { W.ctx.set('onboardingDone', true); closeWizard(); W.ctx.render(); }

    function onNav(nav) {
        if (nav === 'back') { W.idx = Math.max(0, W.idx - 1); renderStep(); }
        else if (nav === 'next') { W.idx = Math.min(W.steps.length - 1, W.idx + 1); renderStep(); }
        else if (nav === 'skip' || nav === 'save') { finishSave(); }
        else if (nav === 'tweak') { finishTweak(); }
    }

    function openWizard(ctx, fresh) {
        W.ctx = ctx;
        W.steps = buildSteps(ctx.ENV);
        W.idx = 0;
        if (fresh) {
            var cc = inferCountry();
            var cOpts = optionsFor(ctx.schema, 'holidayCountry');
            if (cc && optionHasCode(cOpts, cc)) { ctx.S.holidayCountry = cc; ctx.S.holidayRegion = 'all'; }
            applyProviders();
        }
        var overlay = document.createElement('div');
        overlay.id = 'wizard';
        overlay.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;background:#333;color:#F0F2F6;display:flex;flex-direction:column;max-width:460px;margin:0 auto;font-family:Inter,system-ui,sans-serif');
        overlay.innerHTML =
            '<div style="padding:16px 18px 6px;flex:none"><h2 data-wiz-title style="margin:0;color:#FA4A35;font-size:19px;font-weight:800"></h2></div>'
            + '<div data-wiz-body style="flex:1;min-height:0;overflow-y:auto;padding:4px 18px 16px"></div>'
            + '<div data-wiz-foot style="flex:none;display:flex;gap:10px;padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08)"></div>';
        document.body.appendChild(overlay);
        W.overlay = overlay;

        overlay.addEventListener('click', function (e) {
            if (!e.target || !e.target.closest) { return; }
            var t = e.target.closest('[data-wiz-nav]');
            if (t) { onNav(t.getAttribute('data-wiz-nav')); return; }
            var p = e.target.closest('[data-wiz-pick]');
            if (p) { W.ctx.S[p.getAttribute('data-wiz-key')] = p.getAttribute('data-wiz-pick'); renderStep(); return; }
        });
        overlay.addEventListener('change', function (e) {
            if (!e.target || !e.target.closest) { return; }
            var sel = e.target.closest('[data-wiz-select]');
            if (!sel) { return; }
            var id = sel.getAttribute('data-wiz-select');
            if (id === 'country') { W.ctx.S.holidayCountry = sel.value; W.ctx.S.holidayRegion = 'all'; applyProviders(); renderStep(); }
            else if (id === 'region') { W.ctx.S.holidayRegion = sel.value; }
        });
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
            buildSteps: buildSteps, radarNearby: radarNearby, shouldShow: shouldShow
        };
    }
})();

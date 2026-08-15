// src/pkjs/settings/onbuild.js — ES5, WebView. Registers WarnWeather's onBuild hooks.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { hooks: { onLoad: function () {}, onSubmit: function () {} } };

(function () {
    /**
     * The "Highlight this value" toggles are DERIVED state, recomputed on every
     * open: on = the stored warn/danger pair is complete and ordered — the exact
     * rule kindConfig() applies at pack time — so the toggle can never disagree
     * with what the watch actually highlights (locationMode pattern below).
     * Flipping it live is the thresholdToggle onChange hook in blocks.js.
     * @param {{ get: function, set: function }} ctx onLoad context
     * @returns {void}
     */
    function deriveThresholdToggles(ctx) {
        // Node (tests): CommonJS require. Webview: the flat page exposes
        // window.StatusThresholds (resolved lazily at boot, after all scripts loaded).
        var contract = (typeof require !== 'undefined')
            ? require('../status-thresholds.js')
            : (typeof window !== 'undefined' ? window.StatusThresholds : null);
        if (!contract) { return; }
        // Auto colors (see blocks.js thresholdAutoColor): a never-customized color
        // tracks the current theme's text color, re-derived on every open so a theme
        // switch updates it. blocks.js is bundled/required before this hook runs.
        var auto = PConf.thresholdAutoColor;
        var fg = auto ? auto.fgFor(ctx.get('theme')) : null;
        for (var i = 0; i < contract.KINDS.length; i++) {
            var kind = contract.KINDS[i];
            var warn = contract.parseThreshold(ctx.get('thresh' + kind.key + 'Warn'));
            var danger = contract.parseThreshold(ctx.get('thresh' + kind.key + 'Danger'));
            ctx.set('thresh' + kind.key + 'On', warn !== null && danger !== null
                && (kind.belowIsWorse ? danger <= warn : danger >= warn));
            if (auto) {
                // WARN, weather kinds: the default is NO outline (bold text only) — an
                // unset color stays '' and a legacy auto-fg value converts back to ''.
                // GOAL kinds: the green "close" outline is the default — never-touched
                // and legacy-fg values seed DEFAULT_GOAL_COLOR; only an explicit ''
                // (their outline toggle turned off) stays off. A user pick survives
                // either way and means "outline on".
                var goalHex = '#55FF00';   // contract DEFAULT_GOAL_COLOR
                var rawWarn = ctx.get('thresh' + kind.key + 'WarnColor');
                if (kind.goal) {
                    if (rawWarn !== '' && auto.isAuto(rawWarn)) {
                        ctx.set('thresh' + kind.key + 'WarnColor', goalHex);
                        rawWarn = goalHex;
                    }
                } else if (auto.isAuto(rawWarn)) {
                    ctx.set('thresh' + kind.key + 'WarnColor', '');
                    rawWarn = '';
                }
                ctx.set('thresh' + kind.key + 'WarnOutlineOn',
                        rawWarn !== '' && rawWarn !== null && typeof rawWarn !== 'undefined');
                var rawDanger = ctx.get('thresh' + kind.key + 'DangerColor');
                if (auto.isAuto(rawDanger)) {
                    ctx.set('thresh' + kind.key + 'DangerColor', kind.goal ? goalHex : fg);
                }
            }
        }
    }

    /**
     * onLoad: reset transient toggles so they never persist across open/close, and
     * mirror the stored location into the GPS/Manual picker (locationMode has no
     * watch-side meaning — an empty vs set location is the real GPS/manual contract,
     * see index.js). Deriving it here makes an existing manual location preselect
     * Manual instead of defaulting to GPS, which would silently clear it on save.
     * @param {{ env: Object, get: function, set: function, getInitial: function }} ctx
     */
    function onLoad(ctx) {
        ctx.set('fetch', false);
        ctx.set('devStatsClear', false);
        // fetchNoticeAck is a one-shot dismiss signal consumed on webviewclosed;
        // never let a stored true survive to the next open (would auto-dismiss).
        ctx.set('fetchNoticeAck', false);
        // "Reset watchface" is one-shot and destructive: never let a prior save
        // leave it pre-checked on the next open.
        ctx.set('reset', false);
        ctx.set('locationMode', ctx.get('location') ? 'manual' : 'gps');
        deriveThresholdToggles(ctx);
        if (ctx.env && ctx.env.platform === 'aplite') {
            ctx.set('radarMode', 'off');
            ctx.set('healthMode', 'off');
        }
    }

    /**
     * onSubmit: keep the location consistent with the picker, then force a re-fetch when
     * any provider-identity field changed. GPS mode must leave location empty so the
     * watch falls back to GPS; clearing it before the change check also means flipping
     * Manual to GPS is correctly detected as a location change.
     * @param {{ get: function, set: function, getInitial: function }} ctx
     */
    function onSubmit(ctx) {
        if (ctx.get('locationMode') === 'gps') {
            ctx.set('location', '');
        }
        if (
            ctx.get('provider') !== ctx.getInitial('provider') ||
            ctx.get('owmApiKey') !== ctx.getInitial('owmApiKey') ||
            ctx.get('yandexApiKey') !== ctx.getInitial('yandexApiKey') ||
            ctx.get('tomorrowioApiKey') !== ctx.getInitial('tomorrowioApiKey') ||
            ctx.get('location') !== ctx.getInitial('location')
        ) {
            ctx.set('fetch', true);
        }
        // GPS cache must never be shorter than the update interval: re-acquiring GPS more often
        // than we fetch wastes battery for no benefit. Raise a stale-low (or missing) value up.
        var cacheMin = parseInt(ctx.get('gpsCacheMin'), 10);
        var intervalMin = parseInt(ctx.get('fetchIntervalMin'), 10);
        if (!isNaN(intervalMin) && (isNaN(cacheMin) || cacheMin < intervalMin)) {
            ctx.set('gpsCacheMin', String(intervalMin));
        }
    }

    PConf.hooks.onLoad(onLoad);
    PConf.hooks.onSubmit(onSubmit);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { onLoad: onLoad, onSubmit: onSubmit };
    }
})();

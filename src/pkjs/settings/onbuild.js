// src/pkjs/settings/onbuild.js — ES5, WebView. Registers WarnWeather's onBuild hooks.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { hooks: { onLoad: function () {}, onSubmit: function () {} } };

(function () {
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

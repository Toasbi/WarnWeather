// src/pkjs/settings/onbuild.js — ES5, WebView. Registers WarnWeather's onBuild hooks.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { hooks: { onLoad: function () {}, onSubmit: function () {} } };

(function () {
    /**
     * onLoad: reset transient toggles so they never persist across open/close.
     * @param {{ get: function, set: function, getInitial: function }} ctx
     */
    function onLoad(ctx) {
        ctx.set('fetch', false);
        ctx.set('devStatsClear', false);
    }

    /**
     * onSubmit: force a re-fetch when any of the provider identity fields changed.
     * @param {{ get: function, set: function, getInitial: function }} ctx
     */
    function onSubmit(ctx) {
        if (
            ctx.get('provider') !== ctx.getInitial('provider') ||
            ctx.get('owmApiKey') !== ctx.getInitial('owmApiKey') ||
            ctx.get('location') !== ctx.getInitial('location')
        ) {
            ctx.set('fetch', true);
        }
    }

    PConf.hooks.onLoad(onLoad);
    PConf.hooks.onSubmit(onSubmit);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { onLoad: onLoad, onSubmit: onSubmit };
    }
})();

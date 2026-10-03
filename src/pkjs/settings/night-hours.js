// src/pkjs/settings/night-hours.js — ES5, WebView (+ Node for tests). The Watchface tab's
// shared Night hours (schema.js, Theme & night card).
//
// Three night features keep hours of their own — Dim backlight (backlightDimStart/
// EndHour, emery), the Night theme's custom hours (themeAutoStart/EndHour) and the Battery
// saver (sleepStart/EndHour) — and the watch and phone read each pair as before. The page
// shows ONE "Night hours" From–To for all three (two page-only selects, nightHoursFrom /
// nightHoursTo) unless "Separate hours" (page-only nightHoursSeparate) is on, which brings
// back one From–To per feature. Nothing here is stored under a key of its own: the page
// derives the three page-only values from the stored pairs as it opens, and every write
// lands on the stored pairs.
//
//   nightHoursValue    (displayResolvers, initFrom) the Night hours a page opens on: the
//                      first pair a feature in use reads (else the Battery saver's);
//   nightHoursSeparate (displayResolvers, initFrom) on when the features in use keep
//                      different hours (features that are off, absent from this watch, or
//                      — the Night theme — following the sun do not count);
//   nightHoursSync     (onChange) a Night hours pick writes that end of all three pairs;
//   nightHoursMode     (onChange) Separate hours off: the Night hours become the first
//                      in-use pair's, written into all three;
//   nightHoursHint, nightFeatureHint (hintResolvers) the rows' info text for the mode;
//   onSubmit           in shared mode, once the user touched the night rows, all three
//                      pairs carry the Night hours (a feature switched on after the pick
//                      still lands on them).
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;

    // The three pairs, in the card's order, with the defaults a missing key reads as (the
    // schema's) and when the feature reads its pair at all.
    var PAIRS = [
        {name: 'Dim backlight', start: 'backlightDimStartHour', end: 'backlightDimEndHour', from: '0', to: '7',
            inUse: function (S, env) { return Boolean(env && env.colorBacklight) && S.backlightDim !== false; },
            exists: function (env) { return Boolean(env && env.colorBacklight); }},
        {name: 'Night theme', start: 'themeAutoStartHour', end: 'themeAutoEndHour', from: '20', to: '7',
            inUse: function (S, env) {
                return (!env || env.themePolarity !== false) && S.themeAuto === true && S.themeAutoMode === 'manual';
            },
            exists: function (env) { return !env || env.themePolarity !== false; }},
        {name: 'Battery saver', start: 'sleepStartHour', end: 'sleepEndHour', from: '0', to: '7',
            inUse: function (S) { return S.sleepNightEnabled !== false; },
            exists: function () { return true; }}
    ];
    // The page's own keys and the rows whose change counts as touching the night card.
    var TOUCH_KEYS = ['nightHoursFrom', 'nightHoursTo', 'nightHoursSeparate', 'backlightDim', 'themeAuto',
        'themeAutoMode', 'sleepNightEnabled'];

    /**
     * A pair's stored hours, its defaults for a missing key.
     * @param {Object} S Settings.
     * @param {Object} pair A PAIRS entry.
     * @returns {{from: string, to: string}} The hours as stored strings.
     */
    function hoursOf(S, pair) {
        var a = S[pair.start], b = S[pair.end];
        return {from: a == null || a === '' ? pair.from : String(a), to: b == null || b === '' ? pair.to : String(b)};
    }

    /**
     * The pair the Night hours stand for: the first one in use, else the Battery saver's.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {Object} A PAIRS entry.
     */
    function leadPair(S, env) {
        for (var i = 0; i < PAIRS.length; i++) { if (PAIRS[i].inUse(S, env)) { return PAIRS[i]; } }
        return PAIRS[PAIRS.length - 1];
    }

    /**
     * nightHoursValue (initFrom): one end of the Night hours the page opens on.
     * @param {Object} S Hydrated settings.
     * @param {Object} env Platform env.
     * @param {{end: boolean}} args Which end.
     * @returns {string} The hour, e.g. '22'.
     */
    function nightHoursValue(S, env, args) {
        var h = hoursOf(S || {}, leadPair(S || {}, env));
        return args && args.end ? h.to : h.from;
    }

    /**
     * nightHoursSeparate (initFrom): whether the features in use keep different hours.
     * @param {Object} S Hydrated settings.
     * @param {Object} env Platform env.
     * @returns {boolean} True when two in-use pairs differ.
     */
    function nightHoursSeparate(S, env) {
        var st = S || {}, seen = null, i, h;
        for (i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].inUse(st, env)) { continue; }
            h = hoursOf(st, PAIRS[i]);
            if (seen && (seen.from !== h.from || seen.to !== h.to)) { return true; }
            seen = h;
        }
        return false;
    }

    /**
     * Write the Night hours into every pair this watch has.
     * @param {Object} S Settings (mutated).
     * @param {Object} env Platform env.
     * @returns {void}
     */
    function writeAll(S, env) {
        for (var i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].exists(env)) { continue; }
            if (S.nightHoursFrom != null) { S[PAIRS[i].start] = String(S.nightHoursFrom); }
            if (S.nightHoursTo != null) { S[PAIRS[i].end] = String(S.nightHoursTo); }
        }
    }

    /**
     * nightHoursSync (onChange of the Night hours pickers): in shared mode, the picked end
     * lands on every pair.
     * @param {Object} S Settings (mutated).
     * @param {*} oldV The previous hour.
     * @param {*} newV The picked hour.
     * @param {Object} env Platform env.
     * @returns {void}
     */
    function nightHoursSync(S, oldV, newV, env) {
        if (S.nightHoursSeparate === true) { return; }
        writeAll(S, env);
    }

    /**
     * nightHoursMode (onChange of Separate hours): switched off, the Night hours become
     * the first in-use pair's hours and every pair takes them.
     * @param {Object} S Settings (mutated).
     * @param {*} oldV The previous value.
     * @param {*} newV The new value.
     * @param {Object} env Platform env.
     * @returns {void}
     */
    function nightHoursMode(S, oldV, newV, env) {
        if (newV) { return; }
        var h = hoursOf(S, leadPair(S, env));
        S.nightHoursFrom = h.from;
        S.nightHoursTo = h.to;
        writeAll(S, env);
    }

    /**
     * nightHoursHint (hintFrom): which features the Night hours drive on this watch.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function nightHoursHint(S, env) {
        var names = [], i;
        for (i = 0; i < PAIRS.length; i++) { if (PAIRS[i].exists(env)) { names.push(PAIRS[i].name); } }
        var list = names.length > 1
            ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
        return 'Used by ' + list + '.';
    }

    /**
     * nightFeatureHint (hintFrom): a night feature's hint in shared mode (args.shared,
     * "during Night hours"); null with Separate hours on, so the row's own hint ("between
     * the hours below") stands.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{shared: string}} args The shared-mode copy.
     * @returns {?string} The hint, or null.
     */
    function nightFeatureHint(S, env, args) {
        return (S && S.nightHoursSeparate === true) ? null : (args && args.shared) || null;
    }

    /**
     * On Save, in shared mode: once any night row changed, all three pairs carry the Night
     * hours (a feature switched on after the pick lands on them too). Untouched, nothing is
     * written — a page opened and saved changes no stored hour.
     * @param {Object} ctx The hook context (get, set, getInitial, env).
     * @returns {void}
     */
    function onSubmit(ctx) {
        if (ctx.get('nightHoursSeparate') === true) { return; }
        var touched = false, i;
        for (i = 0; i < TOUCH_KEYS.length; i++) {
            if (ctx.get(TOUCH_KEYS[i]) !== ctx.getInitial(TOUCH_KEYS[i])) { touched = true; }
        }
        if (!touched) { return; }
        for (i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].exists(ctx.env)) { continue; }
            ctx.set(PAIRS[i].start, String(ctx.get('nightHoursFrom')));
            ctx.set(PAIRS[i].end, String(ctx.get('nightHoursTo')));
        }
    }

    var api = {
        PAIRS: PAIRS,
        nightHoursValue: nightHoursValue,
        nightHoursSeparate: nightHoursSeparate,
        nightHoursSync: nightHoursSync,
        nightHoursMode: nightHoursMode,
        nightHoursHint: nightHoursHint,
        nightFeatureHint: nightFeatureHint,
        onSubmit: onSubmit
    };
    if (PConf && PConf.displayResolvers) {
        PConf.displayResolvers.register('nightHoursValue', nightHoursValue);
        PConf.displayResolvers.register('nightHoursSeparate', nightHoursSeparate);
        PConf.onChange.register('nightHoursSync', nightHoursSync);
        PConf.onChange.register('nightHoursMode', nightHoursMode);
        PConf.hintResolvers.register('nightHoursHint', nightHoursHint);
        PConf.hintResolvers.register('nightFeatureHint', nightFeatureHint);
        PConf.hooks.onSubmit(onSubmit);
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

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
// lands on the stored pairs — only on the pairs of features IN USE: a feature that is off
// (or the Night theme following the sun) keeps the hours it has stored, as it did before
// the shared row existed.
//
//   nightHoursValue    (displayResolvers, initFrom) the Night hours a page opens on: the
//                      first pair a feature in use reads (else the Battery saver's);
//   nightHoursSeparate (displayResolvers, initFrom) on when the features in use keep
//                      different hours (features that are off, absent from this watch, or
//                      — the Night theme — following the sun do not count);
//   nightHoursSync     (onChange) a Night hours pick writes that end of every pair in use;
//   nightHoursMode     (onChange) Separate hours off: the Night hours become the first
//                      in-use pair's, written into every pair in use;
//   nightFeatureOn     (onChange of the feature rows) a feature switched on in shared mode
//                      whose own stored hours were set by the user (not its defaults) and
//                      differ from the Night hours turns Separate hours on, so its hours
//                      show and are kept instead of being overwritten;
//   nightHoursHint, nightFeatureHint (hintResolvers) the rows' info text for the mode;
//   onSubmit           in shared mode, once the user touched the night rows, every pair
//                      in use carries the Night hours (a feature switched on after the pick
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
     * Write the Night hours into every pair in use. A feature that is off keeps the hours
     * it has stored.
     * @param {Object} S Settings (mutated).
     * @param {Object} env Platform env.
     * @returns {void}
     */
    function writeAll(S, env) {
        for (var i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].inUse(S, env)) { continue; }
            if (S.nightHoursFrom != null) { S[PAIRS[i].start] = String(S.nightHoursFrom); }
            if (S.nightHoursTo != null) { S[PAIRS[i].end] = String(S.nightHoursTo); }
        }
    }

    /**
     * nightHoursSync (onChange of the Night hours pickers): in shared mode, the picked end
     * lands on every pair in use.
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
     * the first in-use pair's hours and every pair in use takes them.
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
     * Whether a pair's stored hours are ones the user set: not the feature's defaults.
     * @param {Object} S Settings.
     * @param {Object} pair A PAIRS entry.
     * @returns {boolean}
     */
    function customised(S, pair) {
        var h = hoursOf(S, pair);
        return h.from !== pair.from || h.to !== pair.to;
    }

    /**
     * nightFeatureOn (onChange of Dim backlight, Night theme, its Hours and Battery saver):
     * in shared mode, every feature in use follows the Night hours, so one just switched on
     * would take them on Save. When its own stored hours are the user's (not its defaults)
     * and differ, Separate hours turns on instead: the card shows that feature's From–To
     * with the hours it kept, and nothing the user set is overwritten.
     * @param {Object} S Settings (mutated).
     * @param {*} oldV The previous value.
     * @param {*} newV The new value.
     * @param {Object} env Platform env.
     * @returns {void}
     */
    function nightFeatureOn(S, oldV, newV, env) {
        if (S.nightHoursSeparate === true) { return; }
        var from = String(S.nightHoursFrom), to = String(S.nightHoursTo), i, h;
        for (i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].inUse(S, env) || !customised(S, PAIRS[i])) { continue; }
            h = hoursOf(S, PAIRS[i]);
            if (h.from !== from || h.to !== to) { S.nightHoursSeparate = true; return; }
        }
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
     * On Save, in shared mode: once any night row changed, every pair in use carries the
     * Night hours (a feature switched on after the pick lands on them too); a feature that
     * is off keeps its own. Untouched, nothing is written — a page opened and saved changes
     * no stored hour.
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
        var st = {};
        for (i = 0; i < TOUCH_KEYS.length; i++) { st[TOUCH_KEYS[i]] = ctx.get(TOUCH_KEYS[i]); }
        for (i = 0; i < PAIRS.length; i++) {
            if (!PAIRS[i].inUse(st, ctx.env)) { continue; }
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
        nightFeatureOn: nightFeatureOn,
        nightHoursHint: nightHoursHint,
        nightFeatureHint: nightFeatureHint,
        onSubmit: onSubmit
    };
    if (PConf && PConf.displayResolvers) {
        PConf.displayResolvers.register('nightHoursValue', nightHoursValue);
        PConf.displayResolvers.register('nightHoursSeparate', nightHoursSeparate);
        PConf.onChange.register('nightHoursSync', nightHoursSync);
        PConf.onChange.register('nightHoursMode', nightHoursMode);
        PConf.onChange.register('nightFeatureOn', nightFeatureOn);
        PConf.hintResolvers.register('nightHoursHint', nightHoursHint);
        PConf.hintResolvers.register('nightFeatureHint', nightFeatureHint);
        PConf.hooks.onSubmit(onSubmit);
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

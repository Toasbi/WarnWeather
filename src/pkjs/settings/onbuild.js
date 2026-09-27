// src/pkjs/settings/onbuild.js — ES5, WebView. Registers WarnWeather's onBuild hooks.
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { hooks: { onLoad: function () {}, onSubmit: function () {} } };

(function () {
    /**
     * Heal each threshold kind's highlight colours on every open. The
     * highlight toggle itself (thresh<K>On — a weather kind's slot-sheet
     * 'Highlight' row, a goal kind's Goals switch) is STORED state and
     * hydrates as-is: kindConfig() packs the enable bit from it (AND an ordered
     * pair), and the levels live on while it is off, so deriving it from the
     * pair here would undo a user's OFF on the next open. The one-time
     * pair-derived backfill for blobs saved before the split is
     * clay-migrations.js migrateThresholdHighlightToggles, which runs on the
     * phone before the page can open. Flipping it live is the thresholdToggle
     * onChange hook in blocks.js.
     * @param {{ get: function, set: function }} ctx onLoad context
     * @returns {void}
     */
    function healThresholdColors(ctx) {
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
            if (auto) {
                // WARN, weather kinds: the default is NO outline (bold text only) — an
                // unset color stays '' and a legacy auto-fg value converts back to ''.
                // GOAL kinds: the green "close" outline is the default — never-touched
                // and legacy-fg values seed DEFAULT_GOAL_COLOR; only an explicit ''
                // (their outline toggle turned off) stays off. A user pick survives
                // either way and means "outline on".
                var goalHex = contract.DEFAULT_GOAL_HEX;
                var rawWarn = ctx.get('thresh' + kind.key + 'WarnColor');
                if (kind.goal) {
                    if (rawWarn === null) {
                        // The old parseResponse bug's footprint for an explicitly
                        // turned-off outline (hexToInt('') = NaN, persisted as
                        // null; never-touched keys are absent, not null — see
                        // status-thresholds.js). Heal to the off-sentinel the
                        // user meant, so the next save stores a durable ''.
                        ctx.set('thresh' + kind.key + 'WarnColor', '');
                        rawWarn = '';
                    } else if (rawWarn !== '' && auto.isAuto(rawWarn)) {
                        ctx.set('thresh' + kind.key + 'WarnColor', goalHex);
                        rawWarn = goalHex;
                    }
                } else if (auto.isAuto(rawWarn)) {
                    // WEATHER kinds: the STORED toggle owns the on/off state and
                    // rides every save; the color is its detail. A custom pick
                    // survives untouched (this branch not taken — outline on in
                    // that color); an auto-valued color — blank, the old NaN
                    // bug's null, or an fg seed/legacy residue — resolves by the
                    // toggle: stored ON keeps tracking the theme fg (re-derived
                    // each open, and on B&W the fg seed is the only on-state
                    // there is), stored OFF or a pre-toggle legacy blob with no
                    // stored toggle reads as no outline.
                    var storedOn = ctx.get('thresh' + kind.key + 'WarnOutlineOn') === true;
                    ctx.set('thresh' + kind.key + 'WarnColor', storedOn ? fg : '');
                    rawWarn = storedOn ? fg : '';
                }
                // Both branches above normalize null/undefined away, so blank is
                // the one remaining off-state.
                ctx.set('thresh' + kind.key + 'WarnOutlineOn', rawWarn !== '');
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
        healThresholdColors(ctx);
        if (ctx.env && ctx.env.platform === 'aplite') {
            ctx.set('radarMode', 'off');
            ctx.set('healthMode', 'off');
        }
    }

    /**
     * Keep the saved update interval inside every free-tier budget whose "Fit update
     * interval to rate limit" guard is on — tomorrow.io's (500 calls/day, 25/hour) and
     * own-key Rainbow's (5000 calls/month). The page enforces it by snapping
     * fetchIntervalMin into its fetchIntervalBudget option list (blocks.js), but only when
     * that row RENDERS — and the row lives on the General tab while what it depends on
     * (the radar provider, Rainbow's "Use your own key" and the mode) is edited on the
     * Radar tab. Picking a keyed radar (Tomorrow.io, Rainbow on your own key) and saving
     * without revisiting General used to store an interval the added calls no longer
     * afford, and the free tier ran out every evening.
     * Same list as that snap and the same rule (interval-budget.js fitInterval, shared
     * with the resolver and the budget read-outs): keep a value the list still offers,
     * else the item's schema default '15' when it fits, else the first (shortest) fitting
     * interval.
     * @param {{ get: function, set: function }} ctx onSubmit context
     * @returns {void}
     */
    function fitIntervalToBudget(ctx) {
        // Node (tests): CommonJS require. Webview: interval-budget.js is concatenated into
        // the flat page and publishes itself on PConf (resolved here, at submit time).
        var ib = (typeof require !== 'undefined') ? require('./interval-budget.js') : PConf.intervalBudget;
        if (!ib) { return; }
        var S = {};
        for (var i = 0; i < ib.STATE_KEYS.length; i++) {
            S[ib.STATE_KEYS[i]] = ctx.get(ib.STATE_KEYS[i]);
        }
        var stored = String(ctx.get('fetchIntervalMin'));
        var fitted = ib.fitInterval(S, stored);   // no guarded call: stored as-is
        if (fitted !== stored) { ctx.set('fetchIntervalMin', fitted); }
    }

    /**
     * onSubmit: keep the location consistent with the picker, trim paste whitespace off the
     * API keys, then force a re-fetch when
     * any provider-identity field or API key changed. GPS mode must leave location empty so the
     * watch falls back to GPS; clearing it before the change check also means flipping
     * Manual to GPS is correctly detected as a location change.
     * @param {{ get: function, set: function, getInitial: function }} ctx
     */
    function onSubmit(ctx) {
        // First: the gpsCacheMin raise below must see the interval this may raise.
        fitIntervalToBudget(ctx);
        if (ctx.get('locationMode') === 'gps') {
            ctx.set('location', '');
        }
        // A pasted key often carries a trailing space. The Test buttons trim it, so
        // the key tests fine and then 401s on the watch. Store it trimmed, and do it
        // before the change check so a key that only lost its whitespace still refetches.
        ['owmApiKey', 'yandexApiKey', 'tomorrowioApiKey', 'rainbowApiKey'].forEach(function (k) {
            var v = ctx.get(k);
            if (typeof v === 'string' && v !== v.trim()) {
                ctx.set(k, v.trim());
            }
        });
        if (
            ctx.get('provider') !== ctx.getInitial('provider') ||
            ctx.get('owmApiKey') !== ctx.getInitial('owmApiKey') ||
            ctx.get('yandexApiKey') !== ctx.getInitial('yandexApiKey') ||
            ctx.get('tomorrowioApiKey') !== ctx.getInitial('tomorrowioApiKey') ||
            ctx.get('rainbowApiKey') !== ctx.getInitial('rainbowApiKey') ||
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

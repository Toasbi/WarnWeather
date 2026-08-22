// src/pkjs/settings/defaults-policy.js — ES5, WebView + Node. The one place that
// answers "what does this setting default to when the answer depends on something?".
//
// A default has three possible homes, and only the third one is here:
//
//   1. schema.js `defaultValue` — the same on every install and every watch
//      (swapClockStatus, the bold modes, the threshold toggles). Nothing to
//      decide, so nothing to write down here: edit the schema item.
//   2. schema.js `defaultFrom` — resolved per watch at hydrate/bake time by a
//      named resolver. The status slots use this: the catalog knows which watch
//      has a heart-rate sensor, so the slot asks it instead of guessing.
//      config-ui/lib/defaults.js deliberately never seeds these.
//   3. THIS TABLE — a default that only applies in a SITUATION: first-time setup
//      finishing, a capability the watch has, an option the user just picked.
//      None of that can be read off a schema item, so it is written down once,
//      declaratively, in one list you can scroll through.
//
// The table is data, not logic. Every row says WHEN it applies, WHAT it sets, and
// — the part that makes the file worth opening — WHY, in a sentence you can
// disagree with. Adding a conditional default is adding a row, never adding an
// `if` somewhere else. Nothing here is applied on its own: a caller reads its
// context's values (resolveDefaults) or has them written onto live state through
// applyDefaults — the ONE interpreter of the execution vocabulary below, shared
// by the wizard finish and the threshold reset so the semantics cannot fork.
//
// THE `when` VOCABULARY (an unlisted key throws — a typo must not read as a
// condition that quietly never matches):
//
//   wizard: true|false   the first-run wizard is finishing. `false` is a real
//                        condition, not "don't care": omit the key for that.
//   health: true|false   the watch HAS health (env.health) AND the user has not
//                        switched it off (choices.healthMode !== 'off'). Both
//                        halves matter — aplite cannot do health at all, and on a
//                        watch that can, 'off' means the slots would be dead.
//   hr / radar /         plain env capability flags, as computeEnv reports them
//   thresholds /         (config-ui/lib/platform.js). Missing env reads as
//   color / round /      "not capable", which is the safe direction: it can only
//   themePolarity        withhold a default, never place a dead one.
//   platform: 'basalt' | ['chalk', 'basalt']      one name or a list
//   platformNot: 'aplite' | ['aplite']            the complement of the above
//   choice: {key: 'value'} | {key: ['a', 'b']}    what the user picked/stored;
//                        an unset choice matches nothing (except via `health`,
//                        which knows healthMode's schema default).
//
// A row may also carry `seedVia` — see the wizard AQI row for what it is for —
// `dependsOn` (dependent key -> anchor key of the same set), which couples
// writes that only make sense together — see the health-slots row — and
// `overrules` (a list of the rule's own set keys), which exempts a key from the
// consumer's "the user has not spoken here" guard: the rule's value replaces
// even a hand-customized stored one. applyDefaults below is the one interpreter
// of all three. Tests pin that every dependsOn/overrules name references the
// same rule's set, so a typo fails loudly instead of silently stranding a
// dependent or protecting nothing.
(function () {
    // healthMode's schema default (schema.js). Repeated here because an unset
    // healthMode means "the user never touched it", which is health ON, and a
    // rule asking `health: true` must agree with the settings page about that.
    var HEALTH_MODE_DEFAULT = 'all';

    var RULES = [
        {
            id: 'wizard-bold-headline-rows',
            when: {wizard: true},
            // The six kinds below are exactly the default contents of those two
            // rows (status-line-catalog.js LINES: temp/city/aqi and week/date/sun),
            // and the four rows' defaults are disjoint — so on a default config
            // this bolds those two rows and reaches no further. No capability
            // gate: on a watch that cannot render highlighting the values are
            // inert, and gating them would make the stored config depend on which
            // watch happened to run setup.
            why: 'The Watch and Forecast rows are the two a wearer reads first — the '
                + 'row beside the clock and the one under the graph — so setup prints '
                + 'their values in the heavier weight from the start. The Radar and '
                + 'Health rows keep the lighter weight, which is what leaves the '
                + 'contrast meaning something.',
            set: {
                threshTempBoldMode: 'always',
                threshCityBoldMode: 'always',
                threshAqiBoldMode: 'always',
                threshWeekBoldMode: 'always',
                threshDateBoldMode: 'always',
                threshSunBoldMode: 'always'
            }
        },
        {
            id: 'wizard-aqi-keeps-a-warn-signal',
            when: {wizard: true},
            why: 'Permanent bold costs air quality its alarm: a reading that is always '
                + 'heavy cannot get heavier when the air turns bad. Switching its '
                + 'highlight on with the warn outline hands that reading back a signal '
                + 'the weight can no longer carry.',
            set: {threshAqiOn: true, threshAqiWarnOutlineOn: true},
            // Both keys are the visible half of a pair: the stored warn/danger
            // numbers and the outline colour come from the settings page's own
            // onChange hooks (blocks.js). Write these two THROUGH those hooks
            // rather than storing them directly, and the seeded companions are
            // identical to what flipping the toggle by hand produces — no
            // hand-picked threshold numbers living in a second place.
            seedVia: {
                threshAqiOn: 'thresholdToggle',
                threshAqiWarnOutlineOn: 'thresholdOutlineToggle'
            }
        },
        {
            id: 'wizard-health-slots',
            when: {wizard: true, health: true},
            // Steps vacates the health row's left slot, distance fills it, and no
            // row ends up holding the same item twice — on a heart-rate watch too,
            // where that row reads distance / sleep / heart rate.
            why: 'Steps is the health number people glance at most, and the top row is '
                + 'on screen in every view, so setup promotes steps into its right-hand '
                + 'corner and sunrise/sunset gives up the spot. Walked distance takes '
                + 'the place steps left in the health row, so no reading is lost. Steps '
                + 'is bolded with the rest of that row: the row above bolds the kinds '
                + 'the top row shows BY DEFAULT, and this rule is what changes one of '
                + 'them — without it the promoted slot keeps its own default of "warn" '
                + 'and sits unbolded between two bold neighbours.',
            set: {
                statusTopRight: 'steps',
                statusHealthLeft: 'distance',
                threshStepsBoldMode: 'always'
            },
            // These three writes are ONE move, not three: evicting steps from the
            // health row is only safe while the top row actually shows it, and the
            // bold exists to match the promoted slot to its row. Each key is still
            // permission-checked on its own (policyMayWrite), so without this the
            // eviction could run while the promotion was blocked by a customized
            // top-right slot — deleting the steps reading from the face, the exact
            // loss the why-text above forbids. dependsOn: a key applies only while
            // the named sibling HOLDS this rule's value for it when its turn comes
            // (written this run, or already there from an earlier one).
            dependsOn: {
                statusHealthLeft: 'statusTopRight',
                threshStepsBoldMode: 'statusTopRight'
            },
            // The promotion alone is exempt from the not-still-default guard:
            // completing setup with health on IS the consent to the layout this
            // rule promises, so steps takes the top-right slot even from a slot
            // the user picked by hand (observed live: a phone-battery slot
            // parked top-right silently blocked the whole swap). The row-sibling
            // dedupe guard still stands — steps already placed elsewhere in the
            // top row stops the promotion, and the dependents with it — and the
            // eviction and bold keep the normal protection: a customized health
            // row or bold choice survives.
            overrules: ['statusTopRight']
        }

        // Deliberately NOT here: the step, sleep and distance GOALS. They stay off
        // until the wearer sets one — a goal nobody chose is a number nobody meant,
        // and it would celebrate on the watch face for it. test/defaults-policy.test.js
        // pins that omission so a future row cannot switch them on by accident.
    ];

    // --- the `when` vocabulary -------------------------------------------------

    /**
     * Build the predicate for a plain env capability flag.
     * @param {string} name Env field name, e.g. 'hr'.
     * @returns {function(*, Object): boolean} Predicate (wanted, ctx).
     */
    function envFlag(name) {
        return function (wanted, ctx) {
            return Boolean(ctx && ctx.env && ctx.env[name]) === Boolean(wanted);
        };
    }

    /**
     * @param {*} value Value to look for.
     * @param {*} wanted One acceptable value, or a list of them.
     * @returns {boolean} True when value is (or is among) wanted.
     */
    function matchesOneOf(value, wanted) {
        if (Array.isArray(wanted)) { return wanted.indexOf(value) !== -1; }
        return value === wanted;
    }

    /**
     * Whether health items may be placed at all: the watch can report health AND
     * the user has not switched it off. An unset healthMode is health ON, matching
     * the settings page's own default.
     * @param {Object} ctx Resolver context.
     * @returns {boolean} True when a health slot would show a live reading.
     */
    function healthEnabled(ctx) {
        if (!ctx || !ctx.env || !ctx.env.health) { return false; }
        var mode = (ctx.choices && ctx.choices.healthMode) || HEALTH_MODE_DEFAULT;
        return mode !== 'off';
    }

    // Condition key -> predicate. The keys of this object ARE the vocabulary
    // ruleApplies accepts; anything else is treated as a typo and throws.
    var CONDITIONS = {
        wizard: function (wanted, ctx) {
            return Boolean(ctx && ctx.wizard) === Boolean(wanted);
        },
        health: function (wanted, ctx) { return healthEnabled(ctx) === Boolean(wanted); },
        hr: envFlag('hr'),
        radar: envFlag('radar'),
        thresholds: envFlag('thresholds'),
        color: envFlag('color'),
        round: envFlag('round'),
        themePolarity: envFlag('themePolarity'),
        platform: function (wanted, ctx) {
            return matchesOneOf(ctx && ctx.env ? ctx.env.platform : undefined, wanted);
        },
        platformNot: function (wanted, ctx) {
            return !matchesOneOf(ctx && ctx.env ? ctx.env.platform : undefined, wanted);
        },
        choice: function (wanted, ctx) {
            var keys = Object.keys(wanted || {});
            for (var i = 0; i < keys.length; i++) {
                var stored = ctx && ctx.choices ? ctx.choices[keys[i]] : undefined;
                if (!matchesOneOf(stored, wanted[keys[i]])) { return false; }
            }
            return true;
        }
    };

    // --- resolving -------------------------------------------------------------

    /**
     * Evaluate one rule's `when` clause. A rule with no conditions always applies.
     * @param {Object} rule Rule row (from RULES or a caller's own table).
     * @param {Object} ctx {wizard: boolean, env: Object, choices: Object}; any part
     *     may be missing, and a missing part reads as "not so" for every condition.
     * @returns {boolean} True when every condition in `when` holds.
     * @throws {Error} When `when` names a condition this module does not define.
     */
    function ruleApplies(rule, ctx) {
        var when = (rule && rule.when) || {};
        var keys = Object.keys(when);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (!Object.prototype.hasOwnProperty.call(CONDITIONS, key)) {
                throw new Error('defaults-policy: rule "' + (rule && rule.id)
                    + '" uses unknown condition "' + key + '" (known: '
                    + Object.keys(CONDITIONS).join(', ') + ')');
            }
            if (!CONDITIONS[key](when[key], ctx)) { return false; }
        }
        return true;
    }

    /**
     * The rules that apply to a context, in table order. Callers that need more
     * than the values — an overview page, a log line explaining a seeded setting —
     * read `id`, `why` and `seedVia` off these.
     * @param {Object} ctx {wizard, env, choices}.
     * @param {Object[]} [rules] Table to evaluate; defaults to RULES.
     * @returns {Object[]} The matching rule rows (the rows themselves, not copies).
     */
    function rulesFor(ctx, rules) {
        var table = rules || RULES;
        var out = [];
        for (var i = 0; i < table.length; i++) {
            if (ruleApplies(table[i], ctx)) { out.push(table[i]); }
        }
        return out;
    }

    /**
     * Collect the setting overrides a context earns.
     *
     * PRECEDENCE: rules apply in table order and LATER ROWS WIN — when two
     * matching rules set the same key, the value of the row further DOWN the table
     * is the one returned. So order the table general first, specific last, and put
     * a row meant to override another below it.
     *
     * @param {Object} ctx {wizard: boolean, env: Object, choices: Object}.
     * @param {Object[]} [rules] Table to resolve; defaults to RULES.
     * @returns {Object} A fresh settingKey -> value map, empty when nothing matches.
     *     The caller decides what to do with it (the wizard writes it; nothing here
     *     touches stored settings).
     */
    function resolveDefaults(ctx, rules) {
        var matching = rulesFor(ctx, rules);
        var out = {};
        for (var i = 0; i < matching.length; i++) {
            var set = matching[i].set || {};
            var keys = Object.keys(set);
            for (var k = 0; k < keys.length; k++) { out[keys[k]] = set[keys[k]]; }
        }
        return out;
    }

    /**
     * Flatten the rules matching a context into one key -> meta map, with later
     * rules winning (the precedence resolveDefaults documents) and first-seen key
     * order preserved so a rule's own `set` order still decides who seeds first.
     *
     * @param {Object} ctx {wizard, env, choices}.
     * @param {Object[]} [rules] Table to resolve; defaults to RULES.
     * @returns {{keys: Array.<string>, by: Object}} Ordered keys + their
     *     {value, seedVia, dependsOn, overrules}.
     */
    function pendingDefaults(ctx, rules) {
        var matching = rulesFor(ctx, rules);
        var keys = [], by = {}, i, k, set, via, dep, ov, names;
        for (i = 0; i < matching.length; i += 1) {
            set = matching[i].set || {};
            via = matching[i].seedVia || {};
            dep = matching[i].dependsOn || {};
            ov = matching[i].overrules || [];
            names = Object.keys(set);
            for (k = 0; k < names.length; k += 1) {
                if (!Object.prototype.hasOwnProperty.call(by, names[k])) { keys.push(names[k]); }
                by[names[k]] = {value: set[names[k]], seedVia: via[names[k]] || null,
                    dependsOn: dep[names[k]] || null,
                    overrules: ov.indexOf(names[k]) !== -1};
            }
        }
        return {keys: keys, by: by};
    }

    /**
     * Write the matching rules' values onto a live settings state — THE one
     * interpreter of the table's execution vocabulary (later-rules-win
     * flattening, `set`-order application, dependsOn anchoring, seedVia
     * write-through, per-key veto). Both consumers go through here — the
     * wizard's finish (wizard.js applyWizardDefaults) and the per-kind
     * threshold reset (blocks.js resetThresholds) — so the vocabulary cannot
     * drift into two dialects.
     *
     * ctx.choices doubles as the live state: values are written into it and
     * seedVia hooks run against it. Both consumers already work that way —
     * every stored setting (and wizard pick) is in it, so a rule keyed on any
     * of them just works.
     *
     * @param {Object} ctx Resolver context ({wizard, env, choices}); `choices`
     *     is mutated.
     * @param {Object} [opts]
     * @param {function(string, Object): boolean} [opts.mayWrite] Per-key veto,
     *     called as (key, meta) with meta = {value, seedVia, dependsOn,
     *     overrules}; omitted allows every key. A vetoed ANCHOR still blocks
     *     its dependents — they check the live state, not the veto.
     * @param {function(string): ?Function} [opts.getHook] Resolves a seedVia
     *     hook name to the onChange hook to write through, invoked as
     *     (S, before, value, env, key); omitted writes values directly.
     * @param {Object[]} [rules] Table to apply; defaults to RULES.
     * @returns {Object} The key -> value pairs actually written (empty when none).
     */
    function applyDefaults(ctx, opts, rules) {
        var S = (ctx && ctx.choices) || {};
        var mayWrite = (opts && opts.mayWrite) || null;
        var getHook = (opts && opts.getHook) || null;
        var pending = pendingDefaults(ctx, rules);
        var written = {};
        var i, key, meta, anchor, hook, before;
        for (i = 0; i < pending.keys.length; i += 1) {
            key = pending.keys[i];
            meta = pending.by[key];
            // dependsOn (a rule's coupling, e.g. the health-slot swap): a
            // dependent key stands down unless its anchor HOLDS the rule's value
            // by now — written earlier this pass (set order puts anchors first)
            // or already in place from an earlier run. A blocked promotion must
            // not leave the eviction half of a swap running alone.
            anchor = meta.dependsOn;
            if (anchor && (!Object.prototype.hasOwnProperty.call(pending.by, anchor)
                || S[anchor] !== pending.by[anchor].value)) { continue; }
            if (mayWrite && !mayWrite(key, meta)) { continue; }
            before = S[key];
            S[key] = meta.value;
            hook = meta.seedVia && getHook ? getHook(meta.seedVia) : null;
            if (hook) { hook(S, before, meta.value, ctx.env, key); }
            written[key] = meta.value;
        }
        return written;
    }

    var api = {
        RULES: RULES,
        CONDITIONS: CONDITIONS,
        ruleApplies: ruleApplies,
        rulesFor: rulesFor,
        resolveDefaults: resolveDefaults,
        applyDefaults: applyDefaults
    };

    // Dual-context export — mirrors status-line-catalog.js: Node (tests, and the
    // pkjs runtime) gets CommonJS, the flat concatenated settings page has no
    // require() and reads the global.
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.DefaultsPolicy = api; }
})();

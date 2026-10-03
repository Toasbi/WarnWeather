// src/pkjs/settings/key-status.js — ES5, WebView + Node. The key status of a picker
// whose options include sources that need the user's own API key (the Weather provider
// row's OpenWeatherMap, Tomorrow.io and Yandex Weather, and the Radar provider row's
// "Rainbow (own key)" and Tomorrow.io): which state that key is in, and the resolvers
// that show it.
//
// Each picker's keyed sources are ONE table in settings/key-sources.js, by the picker's
// messageKey: {outcome, sources: {<the picker's value>: {name, sheetId, keyField, test,
// reasons?, usage?, sharedSheet?}}}; what each field means is documented
// there. Every resolver below looks its row's table up by the picker: the row's own
// messageKey (the engine merges it into the args of every row resolver), or args.picker
// for the missing-key note (a staticText has no messageKey), so a row hands them nothing
// else. A key two pickers share (the Tomorrow.io key: the weather provider's and the
// radar's) is one key with one verdict: both sources name the same keyField and the same
// source id, so they read one state. `outcome` is what goes missing without a working
// key ("the watch gets no forecast").
//
// The states of the picked source's key:
//   missing   — the key field is blank (once trimmed, as onbuild.js stores it);
//   ok        — this exact key answered the Test button (2xx, or 429: known but over
//               its allowance), or the source's last answer to it on the phone did;
//   rejected  — this exact key got a 401/403 from the Test button, or the source's last
//               answer to it on the phone was one;
//   untested  — anything else: a key the page knows nothing about yet.
// "This exact key" is its fingerprint (key-fingerprint.js): the Test result is kept per
// key field with the fingerprint of the key it tested, and the phone keeps each source's
// last answer with the fingerprint of the key it sent (userData.keyResults, key-result.js:
// weather updates and radar requests alike, by the source id: the picker's value). A key
// edited since — even one character — matches neither and reads as untested until it is
// tested or used. What a status says about a key is key-result.js's classify, for the
// Test button and the phone's answers alike.
//
// What the page shows from it:
//   keySheet         (sheetResolvers)     the Edit button: the sheet holding the picked
//                                         source's key (sheetOf);
//   keyBadge         (badgeResolvers)     "Add key" (the page's normal button) while the
//                                         key is missing, "Edit" otherwise;
//   keySummaryHint   (hintResolvers)      the row's own hint for its value (the engine's
//                                         args.staticHint: its hintByValue copy) and the
//                                         summary line "Key ••••1234 · ✓ works";
//   keyMissingNote   (hintResolvers, a staticText's textFrom) the amber note while the
//                                         key is missing;
//   keyAttention     (attentionResolvers) missing or rejected: the tab's dot and the Save
//                                         dialog ("<Name> has no API key", Add key /
//                                         Save anyway).
// Test results live for this page open only; the phone's answers come with each open.
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    // The keyed sources, one table per picker (window.KeySources in the page, concatenated
    // ahead of this file).
    var keySources = (typeof require !== 'undefined')
        ? require('./key-sources.js') : window.KeySources;
    var keyFingerprint = (typeof require !== 'undefined')
        ? require('../key-fingerprint.js') : window.KeyFingerprint;
    // The phone's answers to each key, and what a status says about a key (window.KeyResult
    // in the page, concatenated ahead of this file).
    var keyResult = (typeof require !== 'undefined')
        ? require('../key-result.js') : window.KeyResult;
    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app
    // file): the key's last characters are user input, and hints print as raw HTML.
    var esc = (typeof require !== 'undefined')
        ? require('../config-ui/lib/html.js').esc : PConf.html.esc;

    // A refusal's short reason by HTTP status, unless a source names its own.
    var DEFAULT_REASONS = { 401: 'invalid key', 403: 'no access' };

    // The Test button's last conclusive verdict per key field, this page open:
    // {hash, state, status}. Keyed by field, so a key shared by two pickers (the
    // tomorrow.io key, weather and radar) shares its result.
    var tests = {};

    // Usage lines a source can append (source.usage names one), registered by the page
    // code that owns the numbers (blocks.js: tomorrow.io's projected calls).
    var usageLines = {};

    /**
     * Remember a finished key test (key-test.js calls this for the test whose verdict it
     * shows): a conclusive one replaces the field's last result; one that says nothing
     * about the key (key-result.js classify null) leaves it as it was.
     * @param {string} keyField The key's messageKey.
     * @param {string} key The key as tested.
     * @param {number} status The status the test read.
     * @returns {void}
     */
    function recordTest(keyField, key, status) {
        var state = keyResult.classify(status);
        var hash = keyFingerprint.fingerprint(key);
        if (!state || !hash) { return; }
        tests[keyField] = { hash: hash, state: state, status: status };
    }

    /**
     * Forget every recorded test (tests: a fresh page open).
     * @returns {void}
     */
    function resetTests() {
        tests = {};
    }

    /**
     * Register a usage line a source names in its `usage`.
     * @param {string} name The name.
     * @param {function(Object): ?string} fn Settings state -> the line (plain text), or
     *   null/'' when there is nothing to say.
     * @returns {void}
     */
    function registerUsage(name, fn) {
        usageLines[name] = fn;
    }

    /**
     * The phone's userData (INJECTED_USERDATA, a page global set before the scripts run;
     * Node tests set global.INJECTED_USERDATA), read at call time.
     * @returns {Object} userData, {} when there is none.
     */
    function userData() {
        return (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
    }

    /**
     * The table of the row's picker (key-sources.js): by args.picker, else the row's own
     * messageKey; null for a picker without one.
     * @param {Object} args The row's args ({picker} and/or the engine's messageKey).
     * @returns {?{outcome: string, sources: Object}} The table, or null.
     */
    function tableOf(args) {
        var picker = args && (args.picker || args.messageKey);
        return (typeof picker === 'string' && Object.prototype.hasOwnProperty.call(keySources, picker))
            ? keySources[picker] : null;
    }

    /**
     * The keyed source a picker value picks, from the table of the row's picker, or null.
     * @param {Object} args The row's args ({picker} and/or the engine's messageKey).
     * @param {*} value A picker value.
     * @returns {?Object} The source, or null for a source without a key.
     */
    function sourceOf(args, value) {
        var keyed = (tableOf(args) || {}).sources || {};
        return (typeof value === 'string' && Object.prototype.hasOwnProperty.call(keyed, value))
            ? keyed[value] : null;
    }

    /**
     * The sheet that holds a source's key under the live settings: its own sheet, or —
     * while the settings pick the source that shares its key in the other picker too
     * (source.sharedSheet {key, eq, sheetId}: settings[key] === eq) — that picker's sheet,
     * the one copy of the key on the page then (its own is gated off).
     * @param {Object} source The source ({sheetId, sharedSheet?}).
     * @param {Object} S Live settings state.
     * @returns {string} The sheetId.
     */
    function sheetOf(source, S) {
        var shared = source.sharedSheet;
        return (shared && (S || {})[shared.key] === shared.eq) ? shared.sheetId : source.sheetId;
    }

    /**
     * The picker value a row resolver reads: args.value when the engine handed the row's
     * shown value over, else the picker's stored value.
     * @param {Object} S Live settings state.
     * @param {Object} args The row's args ({picker} and/or the engine's messageKey/value).
     * @returns {*} The picker value.
     */
    function pickedValue(S, args) {
        if (args && typeof args.value === 'string') { return args.value; }
        return (S || {})[(args && (args.picker || args.messageKey)) || ''];
    }

    /**
     * The status of a source's key in the live settings: this page open's Test answer for
     * this exact key, else the source's last answer to it on the phone
     * (userData.keyResults), else untested.
     * @param {Object} source The source ({keyField}).
     * @param {string} id The picker value that picks it: the source id the phone keeps its
     *   answers to the key under.
     * @param {Object} S Live settings state.
     * @returns {{state: string, tail: (string|undefined), status: (number|undefined)}}
     *   state is 'missing', 'ok', 'rejected' or 'untested'; tail the key's last four
     *   characters; status the HTTP status behind a rejection (or a test's verdict).
     */
    function statusOf(source, id, S) {
        var raw = (S || {})[source.keyField];
        var key = typeof raw === 'string' ? raw.trim() : '';
        if (!key) { return { state: 'missing' }; }
        var hash = keyFingerprint.fingerprint(key);
        var tail = key.slice(-4);
        var t = tests[source.keyField];
        if (t && t.hash === hash) { return { state: t.state, tail: tail, status: t.status }; }
        var v = keyResult.verdictOf(userData().keyResults, id, hash);
        if (!v) { return { state: 'untested', tail: tail }; }
        return v.state === 'rejected' ? { state: v.state, tail: tail, status: v.status }
            : { state: v.state, tail: tail };
    }

    /**
     * A refusal's short reason: the source's own for the status, else the default, with
     * the status in brackets ("invalid key (401)").
     * @param {Object} source The source ({reasons?}).
     * @param {number} [status] The HTTP status.
     * @returns {string} The reason.
     */
    function reasonOf(source, status) {
        var own = (source.reasons || {})[status];
        var text = own || DEFAULT_REASONS[status] || 'refused';
        return status ? text + ' (' + status + ')' : text;
    }

    /**
     * The summary line for a source whose key is in: "Key ••••1234", then the state —
     * "✓ works", "✗ rejected: invalid key (401)", or "not tested yet" for a source with a
     * Test button (nothing for one without) — then its usage line, if any, unless the key
     * is rejected. '' while the key is missing: the amber note says so instead.
     * @param {Object} source The source.
     * @param {{state: string, tail: string, status: number}} st Its statusOf.
     * @param {Object} S Live settings state.
     * @returns {string} The line (HTML-safe), or ''.
     */
    function summaryLine(source, st, S) {
        if (st.state === 'missing') { return ''; }
        var parts = ['Key ••••' + esc(st.tail)];
        if (st.state === 'ok') { parts.push('✓ works'); }
        else if (st.state === 'rejected') { parts.push('✗ rejected: ' + esc(reasonOf(source, st.status))); }
        else if (source.test) { parts.push('not tested yet'); }
        var usage = (st.state !== 'rejected' && source.usage && usageLines[source.usage])
            ? usageLines[source.usage](S || {}) : '';
        if (usage) { parts.push(esc(usage)); }
        return parts.join(' · ');
    }

    /**
     * keySheet (editSheetFrom): the sheet holding the picked source's key (sheetOf), null
     * (no Edit button) for a source without a key.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string}} args The row's key: the picker.
     * @returns {?string} The sheetId, or null.
     */
    function keySheet(S, env, args) {
        var source = sourceOf(args, (S || {})[args.messageKey]);
        return source ? sheetOf(source, S) : null;
    }

    /**
     * keyBadge (editBadgeFrom): the Edit button reads "Add key" while the picked source's
     * key is missing; "Edit" otherwise. Both are the page's normal grey button (the
     * owner, 2026-10-01): the amber note under the row and the tab's dot say the key is
     * missing. Only consulted while keySheet offers a sheet.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string}} args The row's key: the picker.
     * @returns {Object} Badge state.
     */
    function keyBadge(S, env, args) {
        var id = (S || {})[args.messageKey];
        var source = sourceOf(args, id);
        var st = source ? statusOf(source, id, S) : null;
        if (st && st.state === 'missing') {
            return { label: 'Add key', ariaNote: 'no API key', dots: [] };
        }
        return { label: 'Edit', ariaNote: (st && st.state === 'rejected') ? 'API key rejected' : '', dots: [] };
    }

    /**
     * keySummaryHint (hintFrom): for a keyed source, the row's own hint for the value
     * (args.staticHint, which the engine hands every hint resolver: the row's hintByValue
     * copy for the value it shows) with the summary line under it; null otherwise, so
     * hintByValue answers.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, value: string, staticHint: (string|undefined)}} args
     *   The row's key (the picker), its shown value and its static hint for that value.
     * @returns {?string} The hint, or null.
     */
    function keySummaryHint(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source) { return null; }
        var why = args.staticHint || '';
        var line = summaryLine(source, statusOf(source, id, S), S);
        if (!line) { return why; }
        return why ? why + '<br>' + line : line;
    }

    /**
     * keyRowLabel (labelFrom of the key row under a picker): "<Name> API key" for the
     * picked source; null (the row's own label) for a source without a key — the row is
     * hidden then anyway (keySheet answers no sheet).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{picker: string, keyed: Object}} args The picker's key and table.
     * @returns {?string} The label, or null.
     */
    function keyRowLabel(S, env, args) {
        var source = sourceOf(args, pickedValue(S, args));
        return source ? source.name + ' API key' : null;
    }

    /**
     * keyRowSummary (hintFrom of the key row): the key's status line — "Key ••••1234 · ✓
     * works", its usage, a refusal's reason — or "No key" (dimmed) while it is missing.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{picker: string, keyed: Object}} args The picker's key and table.
     * @returns {?string} The summary (HTML-safe), or null for a source without a key.
     */
    function keyRowSummary(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source) { return null; }
        var st = statusOf(source, id, S);
        if (st.state === 'missing') { return '<span class="hint-faint">No key</span>'; }
        return summaryLine(source, st, S);
    }

    /**
     * keyMissingNote (a staticText's textFrom, under the picker row): "Needs an API key.
     * Without one, <outcome>." while the picked source's key is missing, '' (no note)
     * otherwise.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{picker: string}} args The picker's key (the note has no messageKey).
     * @returns {string} The note, or ''.
     */
    function keyMissingNote(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source || statusOf(source, id, S).state !== 'missing') { return ''; }
        return 'Needs an API key. Without one, ' + tableOf(args).outcome + '.';
    }

    /**
     * keyAttention (attentionFrom): the picked source's key is missing or known to be
     * rejected — the tab's dot and the Save dialog. An untested key asks for nothing.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, value: *}} args The row's key (the picker) and its
     *   stored value.
     * @returns {?Object} The attention (engine.js PConf.attentionResolvers), or null.
     */
    function keyAttention(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source) { return null; }
        var outcome = tableOf(args).outcome;
        var state = statusOf(source, id, S).state;
        var title;
        if (state === 'missing') {
            title = source.name + ' has no API key';
            return { note: title, title: title, body: 'Without one, ' + outcome + '.',
                actionLabel: 'Add key', sheet: sheetOf(source, S) };
        }
        if (state === 'rejected') {
            title = source.name + ' rejected the API key';
            return { note: title, title: title, body: 'Until it accepts a key, ' + outcome + '.',
                actionLabel: 'Edit key', sheet: sheetOf(source, S) };
        }
        return null;
    }

    var api = {
        recordTest: recordTest,
        resetTests: resetTests,
        registerUsage: registerUsage,
        statusOf: statusOf,
        sheetOf: sheetOf,
        summaryLine: summaryLine,
        keySheet: keySheet,
        keyBadge: keyBadge,
        keySummaryHint: keySummaryHint,
        keyRowLabel: keyRowLabel,
        keyRowSummary: keyRowSummary,
        keyMissingNote: keyMissingNote,
        keyAttention: keyAttention
    };

    // The registries are the engine's (config-ui/lib/engine.js, ahead of every app file in
    // the page; under Node a test loads it first, or only uses the module's exports).
    if (PConf) { PConf.keyStatus = api; }
    if (PConf && PConf.attentionResolvers) {
        PConf.sheetResolvers.register('keySheet', keySheet);
        PConf.badgeResolvers.register('keyBadge', keyBadge);
        PConf.hintResolvers.register('keySummaryHint', keySummaryHint);
        PConf.hintResolvers.register('keyRowLabel', keyRowLabel);
        PConf.hintResolvers.register('keyRowSummary', keyRowSummary);
        PConf.hintResolvers.register('keyMissingNote', keyMissingNote);
        PConf.attentionResolvers.register('keyAttention', keyAttention);
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

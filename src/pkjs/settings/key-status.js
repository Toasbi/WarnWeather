// src/pkjs/settings/key-status.js — ES5, WebView + Node. The key status of a picker
// whose options include sources that need the user's own API key (the Weather provider
// row's OpenWeatherMap, Tomorrow.io and Yandex Weather, and the Radar provider row's
// "Rainbow (own key)" and Tomorrow.io): which state that key is in, and the resolvers
// that show it.
//
// A picker row describes its keyed sources in ONE table, handed to every resolver below
// as args.keyed — by the picker's value: {name, sheetId, keyField, test, reasons?,
// usage?, updateId?, evidence?, radarEvidence?, sharedSheet?}. The tables and what each
// field means live in settings/key-sources.js, one per picker. A key two pickers share
// (the Tomorrow.io key: the weather provider's and the radar's) is one key with one
// verdict: both sources name the same keyField and evidence, so they read one state. The
// row's other args: `picker`, the picker's messageKey (row resolvers get it as their own
// messageKey too), and `outcome`, what goes missing without a working key ("the watch
// gets no forecast").
//
// The states of the picked source's key:
//   missing   — the key field is blank (once trimmed, as onbuild.js stores it);
//   ok        — this exact key answered the Test button (2xx, or 429: known but over
//               its allowance), or the last weather update went through with it;
//   rejected  — this exact key got a 401/403 from the Test button, or the last weather
//               update was refused with it (the auth backoff, auth-backoff.js);
//   untested  — anything else: a key the page knows nothing about yet.
// "This exact key" is its fingerprint (key-fingerprint.js): the Test result is kept per
// key field with the fingerprint of the key it tested, and the phone stamps the
// fingerprint of the key it sent on the last success (userData.lastFetchSuccess) and on
// the auth backoff (userData.authBackoff). A key edited since — even one character —
// matches none of them and reads as untested until it is tested or used.
// A radar source's key (`evidence: 'radar'`) is never sent with a weather update, so the
// update records above say nothing about it: its evidence is the last radar update's
// verdict instead (userData.radarKeyResult, weather/radar-key-result.js — the source id,
// the key's fingerprint and the HTTP status that answered it, ok or rejected by
// classify below). A radar source whose key is a weather provider's too (Tomorrow.io)
// sets no `evidence`: it reads that provider's update records, so the two agree, and
// names its radar source as `radarEvidence`, whose radar verdict answers when no weather
// update says anything about the key (the radar runs it alone).
//
// What the page shows from it:
//   keySheet         (sheetResolvers)     the Edit button: the sheet holding the picked
//                                         source's key (sheetOf);
//   keyBadge         (badgeResolvers)     "Add key" (the page's normal button) while the
//                                         key is missing, "Edit" otherwise;
//   keySummaryHint   (hintResolvers)      the row's hint (args.hints, its hintByValue copy)
//                                         and the summary line "Key ••••1234 · ✓ works";
//   keyMissingNote   (hintResolvers, a staticText's textFrom) the amber note while the
//                                         key is missing;
//   keyAttention     (attentionResolvers) missing or rejected: the tab's dot and the Save
//                                         dialog ("<Name> has no API key", Add key /
//                                         Save anyway).
// Test results live for this page open only; the update evidence comes from the phone.
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var keyFingerprint = (typeof require !== 'undefined')
        ? require('../key-fingerprint.js') : window.KeyFingerprint;
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
     * The verdict a key test's HTTP status gives about the KEY: 'ok' when the provider
     * served it (2xx) or knows it but is rate-limiting it (429), 'rejected' for a
     * 401/403, null for anything that says nothing about the key (no answer, a timeout,
     * a server error, an unexpected status).
     * @param {number} status The status the test read (key-test.js).
     * @returns {?string} 'ok', 'rejected' or null.
     */
    function classify(status) {
        if ((status >= 200 && status < 300) || status === 429) { return 'ok'; }
        if (status === 401 || status === 403) { return 'rejected'; }
        return null;
    }

    /**
     * Remember a finished key test (key-test.js calls this for the test whose verdict it
     * shows): a conclusive one replaces the field's last result; one that says nothing
     * about the key (classify null) leaves it as it was.
     * @param {string} keyField The key's messageKey.
     * @param {string} key The key as tested.
     * @param {number} status The status the test read.
     * @returns {void}
     */
    function recordTest(keyField, key, status) {
        var state = classify(status);
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
     * A JSON record the phone injected as a string (userData), or null.
     * @param {*} raw The stored string.
     * @returns {?Object} The record, or null when absent or unreadable.
     */
    function parseRecord(raw) {
        if (typeof raw !== 'string' || !raw) { return null; }
        try {
            var r = JSON.parse(raw);
            return (r && typeof r === 'object') ? r : null;
        } catch (e) {
            return null;
        }
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
     * The keyed source a picker value picks, from the row's table, or null.
     * @param {Object} args The row's args ({keyed}).
     * @param {*} value A picker value.
     * @returns {?Object} The source, or null for a source without a key.
     */
    function sourceOf(args, value) {
        var keyed = (args && args.keyed) || {};
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
     * The status of a source's key in the live settings.
     * @param {Object} source The source ({keyField, updateId?, evidence?, radarEvidence?}).
     * @param {string} id The picker value that picks it (the phone's provider id, unless
     *   the source names another as updateId).
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
        var ud = userData();
        var updateId = source.updateId || id;
        if (source.evidence === 'radar') {
            return radarVerdict(ud, updateId, hash, tail) || { state: 'untested', tail: tail };
        }
        // A success clears the backoff (fetch-cycle.js), so a backoff on record is the
        // newer of the two.
        var refused = parseRecord(ud.authBackoff);
        if (refused && refused.keyHash === hash && refused.provider === updateId) {
            var m = /status_(\d+)$/.exec(String(refused.code || ''));
            return { state: 'rejected', tail: tail, status: m ? parseInt(m[1], 10) : undefined };
        }
        var served = parseRecord(ud.lastFetchSuccess);
        if (served && served.keyHash === hash && served.id === updateId) {
            return { state: 'ok', tail: tail };
        }
        // A key the radar uses too (Tomorrow.io): with no weather update to go by (the radar
        // runs it alone), the last radar update's verdict on it.
        if (source.radarEvidence) {
            return radarVerdict(ud, source.radarEvidence, hash, tail) || { state: 'untested', tail: tail };
        }
        return { state: 'untested', tail: tail };
    }

    /**
     * The last radar update's verdict on a key (userData.radarKeyResult: one record, the
     * newest radar source's), when it is about this source and this exact key.
     * @param {Object} ud The phone's userData.
     * @param {string} radarId The radar source id the record must name.
     * @param {string} hash The key's fingerprint.
     * @param {string} tail The key's last four characters.
     * @returns {?{state: string, tail: string, status: (number|undefined)}} The status, or
     *   null when the record says nothing about this key.
     */
    function radarVerdict(ud, radarId, hash, tail) {
        var radar = parseRecord(ud.radarKeyResult);
        var verdict = (radar && radar.id === radarId && radar.keyHash === hash)
            ? classify(radar.status) : null;
        if (!verdict) { return null; }
        return verdict === 'rejected' ? { state: verdict, tail: tail, status: radar.status }
            : { state: verdict, tail: tail };
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
     * @param {{messageKey: string, keyed: Object}} args The row's key and table.
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
     * @param {{messageKey: string, keyed: Object}} args The row's key and table.
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
     * (args.hints, its hintByValue table) with the summary line under it; null otherwise,
     * so hintByValue answers.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{value: string, keyed: Object, hints: Object<string, string>}} args The
     *   row's shown value, table and hint copy.
     * @returns {?string} The hint, or null.
     */
    function keySummaryHint(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source) { return null; }
        var hints = (args && args.hints) || {};
        var why = Object.prototype.hasOwnProperty.call(hints, id) ? hints[id] : '';
        var line = summaryLine(source, statusOf(source, id, S), S);
        if (!line) { return why; }
        return why ? why + '<br>' + line : line;
    }

    /**
     * keyMissingNote (a staticText's textFrom, under the picker row): "Needs an API key.
     * Without one, <outcome>." while the picked source's key is missing, '' (no note)
     * otherwise.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{picker: string, keyed: Object, outcome: string}} args The picker's key, the
     *   table and what goes missing.
     * @returns {string} The note, or ''.
     */
    function keyMissingNote(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source || statusOf(source, id, S).state !== 'missing') { return ''; }
        return 'Needs an API key. Without one, ' + args.outcome + '.';
    }

    /**
     * keyAttention (attentionFrom): the picked source's key is missing or known to be
     * rejected — the tab's dot and the Save dialog. An untested key asks for nothing.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, keyed: Object, outcome: string}} args The row's key,
     *   table and what goes missing.
     * @returns {?Object} The attention (engine.js PConf.attentionResolvers), or null.
     */
    function keyAttention(S, env, args) {
        var id = pickedValue(S, args);
        var source = sourceOf(args, id);
        if (!source) { return null; }
        var state = statusOf(source, id, S).state;
        var title;
        if (state === 'missing') {
            title = source.name + ' has no API key';
            return { note: title, title: title, body: 'Without one, ' + args.outcome + '.',
                actionLabel: 'Add key', sheet: sheetOf(source, S) };
        }
        if (state === 'rejected') {
            title = source.name + ' rejected the API key';
            return { note: title, title: title, body: 'Until it accepts a key, ' + args.outcome + '.',
                actionLabel: 'Edit key', sheet: sheetOf(source, S) };
        }
        return null;
    }

    var api = {
        classify: classify,
        recordTest: recordTest,
        resetTests: resetTests,
        registerUsage: registerUsage,
        statusOf: statusOf,
        sheetOf: sheetOf,
        summaryLine: summaryLine,
        keySheet: keySheet,
        keyBadge: keyBadge,
        keySummaryHint: keySummaryHint,
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
        PConf.hintResolvers.register('keyMissingNote', keyMissingNote);
        PConf.attentionResolvers.register('keyAttention', keyAttention);
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

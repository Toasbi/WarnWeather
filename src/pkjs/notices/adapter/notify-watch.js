// src/pkjs/notices/adapter/notify-watch.js — a notification on the watch (Pebble.showSimpleNotificationOnPebble),
// as far as the phone app's permissions let it show. ES5 only (aplite PKJS).
//
// With the Pebble app's permissions preview on (app 1.18.0 and later), a notification needs
// ShowNotifications (package.template.json usesPermissions). While the user has not answered
// yet, the phone drops the notification and asks them instead; once they turned it off, it drops
// every one. The callers remember what they have shown (the release toast's and the update
// notice's version keys), so a notification the phone dropped while it asked must stay
// unremembered, to show on a later run. The phone is asked once: a user who dismisses the
// question without answering is not asked again on every run, and the notification then counts
// as shown. Pebble.permissions.query (app 1.17.0 and later) tells the three apart; an app without
// it, or with the preview off, shows everything.
var NOTIFY_ASKED_KEY = require('../../settings/domain/storage-keys.js').NOTIFY_ASKED_KEY;

/**
 * Show `title` and `body` on the watch unless the user turned notifications off for the app, and
 * say whether the user has decided.
 * @param {string} title The notification's title.
 * @param {string} body Its text.
 * @param {function(boolean)} [done] Called once: true when the user has decided (it showed, they
 *   turned notifications off for the app, or they left the phone's question unanswered), false
 *   while the phone asks them the first time (it dropped this one: show it again on a later run).
 * @returns {void}
 */
function notifyWatch(title, body, done) {
    var answered = false;
    /**
     * Show the notification as the permission's state allows, once, and tell the caller.
     * @param {string} state 'granted', 'denied' or 'prompt'.
     * @returns {void}
     */
    function finish(state) {
        if (answered) { return; }
        answered = true;
        // 'prompt' shows too, the first time: the call is what makes the phone ask. Asked
        // before and still unanswered, the user dismissed the question: no new one.
        var askedBefore = state === 'prompt' && localStorage.getItem(NOTIFY_ASKED_KEY) === '1';
        if (state === 'prompt' && !askedBefore) { localStorage.setItem(NOTIFY_ASKED_KEY, '1'); }
        if (state !== 'denied' && !askedBefore) { Pebble.showSimpleNotificationOnPebble(title, body); }
        if (done) { done(state !== 'prompt' || askedBefore); }
    }
    var permissions = (typeof Pebble !== 'undefined' && Pebble.permissions) || null;
    if (!permissions || typeof permissions.query !== 'function') {
        finish('granted');
        return;
    }
    try {
        var answer = permissions.query('ShowNotifications');
        if (answer && typeof answer.then === 'function') {
            answer.then(finish, function () { finish('granted'); });
        } else {
            finish(typeof answer === 'string' ? answer : 'granted');
        }
    } catch (e) {
        finish('granted');
    }
}

module.exports = {
    notifyWatch: notifyWatch
};

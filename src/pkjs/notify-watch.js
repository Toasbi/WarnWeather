// src/pkjs/notify-watch.js — a notification on the watch (Pebble.showSimpleNotificationOnPebble),
// as far as the phone app's permissions let it show. ES5 only (aplite PKJS).
//
// With the Pebble app's permissions preview on (app 1.18.0 and later), a notification needs
// ShowNotifications (package.template.json usesPermissions). While the user has not answered
// yet, the phone drops the notification and asks them instead; once they turned it off, it drops
// every one. The callers remember what they have shown (the release toast's and the update
// notice's version keys), so a notification the phone dropped while it asked must stay
// unremembered, to show on a later run. Pebble.permissions.query (app 1.17.0 and later) tells the
// three apart; an app without it, or with the preview off, shows everything.

/**
 * Show `title` and `body` on the watch unless the user turned notifications off for the app, and
 * say whether the user has decided.
 * @param {string} title The notification's title.
 * @param {string} body Its text.
 * @param {function(boolean)} [done] Called once: true when the user has decided (it showed, or
 *   they turned notifications off for the app), false while the phone asks them first (it dropped
 *   this one: show it again on a later run).
 * @returns {void}
 */
function notifyWatch(title, body, done) {
    var answered = false;
    function finish(state) {
        if (answered) { return; }
        answered = true;
        // 'prompt' shows too: the call is what makes the phone ask.
        if (state !== 'denied') { Pebble.showSimpleNotificationOnPebble(title, body); }
        if (done) { done(state !== 'prompt'); }
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

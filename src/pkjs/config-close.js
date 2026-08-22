// src/pkjs/config-close.js — the settings-close decision, pure.
//
// index.js's webviewclosed handler feeds this the facts it captured (what
// changed, what the user acknowledged, whether an auth backoff is active) and
// performs the side effects the returned decision names. Extracted in the
// house decide* style (release-notifications.js, update-check.js) so the
// interacting special cases below are unit-testable — this exact handler is
// where the 1.13.x reset/ack bugs lived, with no test able to reach it.

/**
 * Decide what closing the settings page does.
 *
 * The rules, in one place:
 * - Any provider/location, radar-provider/mode, or render-signature change
 *   makes the watch's current data (or chart) wrong: drop the last-sent
 *   weather caches (needsRefetch) and force a fetch.
 * - The "Force weather fetch" toggle forces a fetch on its own.
 * - An ACTIVE auth backoff also forces one: closing the config is an explicit
 *   user action (they likely just fixed the key/subscription), and a forced
 *   fetch clears the backoff — EXCEPT on a pure ack. A pure ack (notice
 *   dismissed, nothing render-relevant changed, no Force toggle) means "I saw
 *   it, I'm not fixing it now", and forcing a doomed retry would just re-raise
 *   the notice the user dismissed.
 * - clearNotice pushes the watch's overlay clear for a dismissed error notice.
 *   It simply carries hadWatchNotice: the scheduler already owns the
 *   forceFetch-over-clearNotice precedence (channel-scheduler.js runs the
 *   clear only when no fetch is forced — a successful forced fetch clears
 *   errors and self-heals the overlay), so this module does NOT encode it a
 *   second time.
 *
 * @param {Object} input Captured caller-side, in order:
 *   {boolean} providerOrLocationChanged refreshProvider()'s verdict.
 *   {boolean} radarProviderChanged radarProvider or radarMode changed.
 *   {boolean} renderSettingsChanged renderSignature() differs across the save.
 *   {boolean} fetchToggle The one-shot "Force weather fetch" toggle.
 *   {boolean} acked The notice-ack flag rode the save.
 *   {boolean} hadWatchNotice An error notice had text ON THE WATCH — captured
 *     BEFORE notices.dismissAll() empties the list.
 *   {boolean} authBackoffActive authBackoff.isActive().
 * @returns {{needsRefetch: boolean, pureAck: boolean, forceFetch: boolean,
 *   clearNotice: boolean}} needsRefetch: drop the weather caches; forceFetch/
 *   clearNotice: the scheduler.onConfigClosed arguments.
 */
function decideConfigClose(input) {
    var needsRefetch = Boolean(input.providerOrLocationChanged
        || input.radarProviderChanged || input.renderSettingsChanged);
    var pureAck = Boolean(input.acked) && !needsRefetch && !input.fetchToggle;
    var forceFetch = Boolean(input.fetchToggle) || needsRefetch
        || (Boolean(input.authBackoffActive) && !pureAck);
    return {
        needsRefetch: needsRefetch,
        pureAck: pureAck,
        forceFetch: forceFetch,
        clearNotice: Boolean(input.hadWatchNotice)
    };
}

module.exports = { decideConfigClose: decideConfigClose };

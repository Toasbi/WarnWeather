// src/pkjs/migrations/onboarding.js
//
// The 1.20.0 first-run wizard migration. A registry body (migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.

/**
 * Mark an EXISTING install as onboarded, so the first-run wizard's auto-open
 * (settings/wizard.js shouldShow, gated on onboardingDone) only fires for a
 * genuinely fresh install.
 *
 * The wizard used to treat "the saved config has no keys at all" as fresh, but
 * seedDefaults writes the full defaults blob on the first boot, before any
 * settings page can open — so it never auto-opened. onboardingDone is the
 * signal now, and it cannot be told apart by the key alone: seedDefaults'
 * backfill has already written onboardingDone:false into every existing
 * install's blob, so gating on it without this would push the whole installed
 * base into the wizard (and its country re-derivation) on the next open.
 *
 * The fresh-vs-existing verdict is hadExistingInstall — a blob stored BEFORE
 * this boot's seedDefaults. The marker is committed on EVERY boot that finds
 * it absent, fresh installs included: keyed on hadExistingInstall alone, a
 * fresh install's SECOND boot (blob present by then, settings not yet opened)
 * would read as existing and suppress the wizard it has not seen yet.
 *
 * "Reset watchface" still reopens the wizard: resetAll clears this marker
 * together with the blob, so the next boot is fresh again.
 *
 * No Clay resend: onboardingDone is page-only and never reaches the watch.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateExistingInstallOnboarded(blob, ctx) {
    if (!ctx.hadExistingInstall || blob.onboardingDone === true) {
        return { changed: false, send: false };
    }
    blob.onboardingDone = true;
    console.log('Marked the existing install as onboarded');
    return { changed: true, send: false };
}

module.exports = {
    migrateExistingInstallOnboarded: migrateExistingInstallOnboarded
};

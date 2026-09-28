// src/pkjs/migrations/light-theme.js
//
// The 1.16.0 light-theme migrations. Registry bodies (migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.
//
// Both ALWAYS ask for the send, rewrite or not, and their marker rides the Clay ACK
// (registry markOn 'ack'), so a NACK retries on the next boot. The tempting "nothing
// to rewrite, so no send" shortcut is a BUG, and a subtle one: a blob with nothing
// left to rewrite is also exactly what a run that saved and then NACKed looks like.
// Dropping the send there marks the migration done and strands that install on the
// old values until it opens and saves the settings page, since an in-place upgrade
// queues no Clay send of its own. Gating on "every cell reads as the built-in"
// instead does not save it either — one deliberately chosen colour makes that false
// forever, which is the shape test/clay-migrations.test.js pins.
//
// The cost of being unconditional is one redundant Clay message on an install that
// never held the old values. It does not loop: nothing changed means the payload
// matches the last-sent cache, sendClay calls onSuccess immediately, and the marker
// commits. migrateGraphNightColorsResend (graph-colors.js) is unconditional for the
// same reason.

var lineStyle = require('../line-style');       // graph-colour keys + built-ins
var resolveInk = require('../resolve-ink.js');  // polarity + its colour defaults

// The LIGHT-polarity graph colours seedDefaults wrote before the hardware re-tune —
// only the cells whose built-in actually moved. An install still holding one of these
// is holding a SEEDED value, not a choice: nobody navigated to a colour sheet to pick
// the colour the page had already put there.
//
// This table is a FROZEN historical record, not a view of the current defaults. It
// must never be re-derived from line-style.js — the whole point is that the built-ins
// have moved away from these. ADR-0003 §4, "Re-tuning a built-in needs a migration of
// its own", which is also where a FUTURE re-tune's own table and marker are specified.
var SUPERSEDED_LIGHT_GRAPH_COLORS = [
    { metric: 'precip_prob', role: 'Line',  was: 0x00AAFF },  // VividCerulean -> DukeBlue
    { metric: 'precip_prob', role: 'Night', was: 0x0000AA },  // DukeBlue      -> Cyan
    { metric: 'wind',        role: 'Line',  was: 0xFFFF00 },  // Yellow        -> ChromeYellow
    { metric: 'wind',        role: 'Fill',  was: 0xAAFF55 },  // Inchworm      -> Yellow
    { metric: 'wind',        role: 'Night', was: 0x555500 },  // ArmyGreen     -> Rajah
    { metric: 'uv',          role: 'Line',  was: 0xFF00FF },  // Magenta       -> Purple
    { metric: 'uv',          role: 'Night', was: 0x550055 },  // ImperialPurple-> ShockingPink
    { metric: 'gust',        role: 'Night', was: 0x555555 },  // DarkGray      -> LightGray
    { metric: 'pressure',    role: 'Fill',  was: 0xFFAA00 },  // ChromeYellow  -> Rajah
    { metric: 'pressure',    role: 'Night', was: 0xAA5500 }   // WindsorTan    -> Rajah
];

/**
 * Move existing installs onto the re-tuned LIGHT-theme graph colours.
 *
 * The graph colours are stored CONCRETE — seedDefaults writes a real colour into
 * every gc* key rather than leaving it absent — so re-tuning a built-in does not
 * reach anyone who is already installed. Their stored colour is the OLD default,
 * which no longer equals the new built-in, so graphColorIsDefault reads it as a
 * deliberate pick and the old colour keeps winning. Observed on a real watch after
 * the re-tune: every light row had to be reset by hand, one at a time.
 *
 * So a stored LIGHT colour that still equals the value the page seeded (the frozen
 * table above) is overwritten with the new built-in. Anything else is left alone —
 * a colour that is neither the old default nor the new one is a colour somebody
 * chose, and a re-tune of the defaults is not a licence to discard it.
 *
 * The one shape this cannot preserve: a user who DELIBERATELY picked a colour that
 * happened to equal the old default gets re-tuned along with everyone else. That is
 * indistinguishable by construction — the stored bytes are identical — and it is the
 * same trade-off migrateCarriedGraphNightTints accepts. They can pick it again.
 *
 * DARK is untouched: its built-ins did not move.
 *
 * A Clay resend IS required, for the reason spelled out on
 * migrateGraphNightColorsResend: an in-place upgrade queues no Clay send of its own,
 * so without this the healed blob would sit on the phone while the watch keeps
 * painting the old colours.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}} Always a send (see the file header).
 */
function migrateLightGraphColorRetune(blob) {
    var changed = false;
    var i, cell, key, stored;

    for (i = 0; i < SUPERSEDED_LIGHT_GRAPH_COLORS.length; i++) {
        cell = SUPERSEDED_LIGHT_GRAPH_COLORS[i];
        key = lineStyle.graphColorKey(cell.metric, cell.role, 'Light');
        stored = lineStyle.colorPick(blob[key]);
        // Absent: nothing was seeded, so it already resolves to the new built-in.
        if (stored === null || stored !== cell.was) { continue; }
        // The INT form, like the schema defaults: parseResponse stores ints.
        blob[key] = lineStyle.graphColorDefault(cell.metric, cell.role, 'Light', blob);
        changed = true;
    }

    if (changed) {
        console.log('Re-tuned the seeded light-theme graph colours');
    }
    return { changed: changed, send: true };
}

/**
 * Move an install that is ALREADY on a light-polarity theme onto the light default
 * for the two bar colour modes (rainBarColor, radarColor): Solid, not multicolor.
 *
 * The five multicolor rain tiers are tuned against a black background; on white the
 * two lightest wash out. That is why the light polarity now starts on Solid — but the
 * settings page only converts the pair when the Theme control FLIPS polarity
 * (theme-convert.js), which reaches nobody who picked Light before this shipped. Their
 * stored 'multicolor' is the value seedDefaults wrote, and nothing else heals it: an
 * in-place upgrade keeps the watch's CONFIG persist, so the handshake reports hasConfig
 * true and the scheduler queues no Clay send.
 *
 * A light install that deliberately chose Multicolor is converted too. Nothing in the
 * blob separates that from the seeded value — the same imprecision theme-convert.js
 * carries for the colour pickers, and the price of storing defaults concretely.
 *
 * Polarity, not colour-ness: bw-light is migrated as well, even though its bar palette
 * is B&W and the picker is hidden there. Switching bw-light -> light is not a polarity
 * flip, so the hook would never convert it, and that install would be the one install
 * that still arrived on multicolor.
 *
 * A dark install rewrites nothing and still asks for the send (see the file header);
 * that spends one redundant Clay message on its first boot after the upgrade, which is
 * the price of the family having one rule instead of three.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}} Always a send (see the file header).
 */
function migrateLightThemeSolidBars(blob) {
    var keys = resolveInk.BAR_COLOR_KEYS;
    var changed = false;
    var wanted, i;

    if (resolveInk.isLightPolarity(blob.theme)) {
        wanted = resolveInk.barColorDefault(blob.theme);
        for (i = 0; i < keys.length; i++) {
            // Everything that is not already Solid moves: the pair is a two-value
            // vocabulary, so that is 'multicolor' or an absent key. Absent is written out
            // rather than left implicit — the next hydrate would fill it from the
            // schema's dark default, which has no theme to ask.
            if (blob[keys[i]] === wanted) { continue; }
            blob[keys[i]] = wanted;
            changed = true;
        }
    }

    if (changed) {
        console.log('Moved the light theme onto the solid rain-bar and radar colours');
    }
    return { changed: changed, send: true };
}

module.exports = {
    migrateLightGraphColorRetune: migrateLightGraphColorRetune,
    migrateLightThemeSolidBars: migrateLightThemeSolidBars
};

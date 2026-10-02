// src/pkjs/settings/level-rows-schema.js — ES5, PKJS-parsed. A threshold kind's level
// group in the settings schema, split out of schema.js: the group's two halves (levelLead:
// the header, the slider and its cards; levelLook: the warn look and the two colours),
// levelRows (both back to back, a goal kind's whole group), the two voices every word of
// the group comes from, and the next-day mark options. Shared by schema.js (the goal
// kinds' slot sheets, the day-max slots' Tomorrow's peak mark, the slot sheets' Bold row,
// which speaks in the same voices) and the Alerts tab's alert sheets, so neither has to
// require the other. Plain CommonJS with an unguarded require(), like schema.js itself:
// the schema is built in PKJS and reaches the page as data.
var STATUS_THRESHOLDS = require('../status-thresholds.js');
// The next-day marks, from the module that PRINTS them into the slot and alert text.
var STATUS_PAIR = require('../status-pair.js');
var gates = require('./schema-gates.js');
var gateAll = gates.gateAll;
var COLOR_THEME_WHEN = gates.COLOR_THEME_WHEN;

// A kind's level group speaks in one of two voices, and the CALLER picks it: the
// weather kinds rise to ALERT LEVELS (ALERT_VOICE, in the kind's alert sheet in the
// Alert settings card); the health kinds work toward GOALS (GOAL_VOICE, in their slot
// sheet) — same rises-toward-the-pair machinery, friendlier words. A voice record
// carries every word the group, its slider's chips (the thresholdRange resolver,
// blocks.js) and the slot's Bold row (schema.js boldRow) say, so the builders hold no
// copy and never ask which kind they build.
// The contract's goal flag (status-thresholds.js isGoalKind) packs the same three
// kinds; test/config-thresholds.test.js pins the labels to it.
//
// The intros are the only place the levels are explained now that the Watch-tab card
// is gone. Both lead with what the pair IS: the slider is always live (the weather pair
// also sets when the alert icon shows, highlighting or not), so the intro must not read
// as if the numbers were the highlight's alone. The weather group has NO switch of its own
// — it sits in the kind's Alert sheet, whose 'Alert' switch shows the icon, while the
// slot's 'Alert highlighting' switch lives in the slot sheet — so its intro says the look
// applies to the alert icon always and to the slot only while that switch is on. The
// goal group keeps its switch (goal kinds have no alert). Neither claims the warn level
// bolds the value — Bold is its own setting, so saying so here could simply be false.
// The warn box is the group's warn look (thresh<K>WarnLook — none / outline / fill;
// status_threshold.h ThreshWarnLook), so the intro points at that row rather than
// naming one of its looks.
//
// `look` is the warn look's hints — the SELECTED look only. `base` is the row's own
// hintByValue; 'none' adds where the remaining signal comes from (the Bold row, which
// lives in the slot sheet for a weather kind and above the Goals group for a goal
// kind). The warnLookHint resolver (blocks.js) answers from the rest: on a B&W watch
// or a B&W day theme from `bw` — there the box is drawn in the text colour, the pickers
// are hidden, and a fill is the danger (or reached-goal) fill; with only the NIGHT
// theme B&W (Theme switching on) the day hint stands and the `night` note is appended —
// by day the box is in the picked colour; and `sameColor` is appended to the colour
// screen's Fill hint when the two colours resolve to the same one (a goal kind's
// defaults are both the goal green; a warn pick can equal danger): then the fill IS
// the danger / reached-goal box. The watch still draws what was picked (status_row.c).
//
// `boldHints` explain the Bold row's SELECTED step only, in the sheet's voice (alert
// levels reached vs goals reached). The level-driven bold — danger / a reached goal,
// and the middle step — reads the kind's level, which the watch zeroes while the kind's
// Highlight (Goals) switch is off (status_threshold_slot_level), so the hints say "while …
// is on". 'Always' needs no levels, so its note is the per-kind scope, shared with the
// level-less kinds' Bold rows (schema.js boldSection).
var BOLD_ALWAYS_HINT = 'Every status slot showing this value prints it in heavier text.';
var ALERT_VOICE = {
    header: 'Alert levels',
    // No switch on the group: a weather kind's highlight switch is the slot sheet's
    // 'Alert highlighting' row (schema.js highlightToggle), and its alert's switch heads the
    // Alert sheet.
    switchLabel: null,
    intro: 'Warn and danger levels for this value: reaching warn ' +
        'draws the warn look below, reaching danger fills the alert icon — and the status ' +
        'slot, while its Alert highlighting is on.',
    lookLabel: 'Warn look',
    colorLabels: {warn: 'Warn color', danger: 'Danger color'},
    // Unset = AUTO: the theme fg for warn, the contract's red for danger (see the
    // colour rows in levelRows).
    colorDefault: '',
    boldWarnLabel: 'Warn',
    // A weather kind's Bold row also sets the weight of its alert's value, the one
    // the 'Icon + value' look prints next to the alert icon (status_on_demand.c bolds an
    // entry on the kind's ladder at its real level, Highlight or not).
    boldHints: {
        off: 'Danger still prints bold: in the slot while Alert highlighting is on, and in the value next to the alert icon.',
        warn: 'Heavier text from the warn level on: in the slot while Alert highlighting is on, and in the value next to the alert icon.',
        always: BOLD_ALWAYS_HINT
    },
    chips: {warn: 'Warn', danger: 'Danger'},
    look: {
        base: {
            none: 'No box at warn — bold text still follows the Bold row in the slot’s sheet.',
            outline: 'A thin frame in the warn color.',
            fill: 'A solid box in the warn color, with the value in a contrasting color.'
        },
        bw: {
            outline: 'A thin frame in the text color.',
            fill: 'A solid box in the text color, with the value in the background color. On ' +
                'black-and-white screens this looks the same as danger.'
        },
        night: {
            fill: 'At night (black-and-white theme) this looks the same as danger.'
        },
        sameColor: 'Warn and danger use the same color, so this looks like ' +
            'danger — pick a different warn color.'
    }
};
var GOAL_VOICE = {
    header: 'Goals',
    // Aria-only: the switch rides the group header, whose intro carries the meaning.
    switchLabel: 'Goals',
    // "On color watches": on B&W the looks are drawn in the theme's ink and the color
    // pickers below are hidden.
    intro: 'Close and goal levels for this value. The switch ' +
        'celebrates them on the watch: getting close draws the close look below, reaching ' +
        'the goal fills the slot. On color watches the colors are yours to change below.',
    lookLabel: 'Close look',
    colorLabels: {warn: 'Close color', danger: 'Goal fill color'},
    // Green = the celebration look, for both levels.
    colorDefault: STATUS_THRESHOLDS.DEFAULT_GOAL_HEX,
    // Relabels the middle option only; the stored value stays 'warn' so the wire keeps
    // one vocabulary.
    boldWarnLabel: 'Close',
    boldHints: {
        off: 'A reached goal still prints bold while Goals are on.',
        warn: 'Heavier text once you get close to the goal, while Goals are on.',
        always: BOLD_ALWAYS_HINT
    },
    chips: {warn: 'Close', danger: 'Goal'},
    look: {
        base: {
            none: 'No box when close — bold text still follows the Bold row above.',
            outline: 'A thin frame in the close color.',
            fill: 'A solid box in the close color, with the value in a contrasting color.'
        },
        bw: {
            outline: 'A thin frame in the text color.',
            fill: 'A solid box in the text color, with the value in the background color. On ' +
                'black-and-white screens this looks the same as a reached goal.'
        },
        night: {
            fill: 'At night (black-and-white theme) this looks the same as a reached goal.'
        },
        sameColor: 'Close and goal use the same color, so this looks like ' +
            'a reached goal — pick a different close color.'
    }
};
/**
 * The next-day mark options — the day-max slots' "Tomorrow's peak mark" and each metric
 * alert's "Tomorrow's mark", one list so the two cannot drift — labelled on a sample
 * peak of 6 from the formatter's own table, so each label shows where its mark lands
 * (three lead the number, the star trails it). 'none' would print a bare 6, which
 * reads as no choice at all, so it is spelled out.
 * @returns {Array<Array<string>>} [label, value] pairs, the formatter's order.
 */
function nextDayMarkOptions() {
    var marks = STATUS_PAIR.NEXT_DAY_MARKS;
    return Object.keys(marks).map(function (value) {
        return [value === 'none' ? 'No mark' : marks[value].pre + '6' + marks[value].post, value];
    });
}
// A kind's Alert levels (or Goals) group — the part of a level edit sheet that
// configures the levels and their look, not the slot: the group sub-header (title,
// reset — and, in the goal voice only, the Goals switch), a zoned
// dual-thumb slider for the warn/danger pair, and the warn look + two color
// pickers. A weather kind's group has no switch: its highlight switch is the slot
// sheet's 'Alert highlighting' row (schema.js highlightToggle), and its warn look + colors style the alert
// icon whether or not that is on, so they are always live. Values live in the kind's
// DISPLAYED unit (wind unit / km-mi / hours); a blank pair means the kind's seed
// pair (status-thresholds.js resolvedPair), and toggling off keeps the pair — the
// switch alone is the highlight's on/off. The slider's geometry, direction and
// live colors come from the thresholdRange resolver (blocks.js), which reads the
// contract module (status-thresholds.js) — the same source the watch packs with,
// so the UI can never disagree about which way is worse.
// `gate` (optional showWhen) hides kinds that can't appear in any slot (health
// on aplite / with health off); color pickers additionally hide on B&W
// (capability + bw theme).
// The group has ONE home per kind: the goal kinds' slot pencil sheet
// (schema.js goalSlotSheet, below the slot's Bold row), and for the five alert kinds the
// alert sheet the Alert settings card opens (alertSheet, the Alerts tab) — their slot
// sheets carry a pointer there instead (schema.js alertSlotSheet's alertLevelsNote), so every key
// renders in exactly one place.
// It is built in two halves: levelLead (the header, the slider, the cards and the hidden
// companions) and levelLook (the warn look and the two colours). A goal sheet runs them
// back to back (levelRows); an alert sheet puts its Look, Days and mark between them (the
// owner's order, 2026-10-01: the levels, the info card, the Look row, then the rest).
/**
 * The levels half of a kind's group: sub-header, (a voice with a switch) the switch, the
 * slider, (an alert) its level cards, then the slider's two hidden companions.
 * @param {string} keyStem Kind key stem, e.g. 'Steps' (thresh<Stem>Warn/...).
 * @param {Object} voice GOAL_VOICE or ALERT_VOICE: every word the group says, and
 *     whether it carries a switch of its own.
 * @param {string} hint Per-kind unit/scale hint under the slider (HTML allowed; '' for
 *     none).
 * @param {?Object} gate Extra showWhen for the whole group, or null.
 * @param {Array<{text: string, showWhen: (Object|undefined)}>} [why] An alert group's
 *     cards on its default levels (ALERT_LEVEL_CARDS), one per unit or scale; absent
 *     for a goal group.
 * @returns {Object[]} Those items, in order.
 */
function levelLead(keyStem, voice, hint, gate, why) {
    // The slider is ALWAYS live: the warn level is not the highlight's alone — a
    // weather kind's alert icon shows from it whether or not the slot is coloured
    // (status-wire bakeAlerts), so it must stay editable with the switch off.
    // For a GOAL kind the highlight-only rows below (warn look + color pickers) go
    // VISIBLE but disabled (muted, inert — the sheet shows what turning it on
    // offers) while its switch is off. A weather
    // kind's rows never do: they style its alert icon too, which the slot's switch
    // does not touch. The toggle itself is STORED state — the one source of
    // "highlight on" (kindConfig's enable bit); pre-split blobs were backfilled from
    // their pair by migrations/v1_24.js. It writes no numbers: a blank pair already
    // means the kind's seed, which follows the unit and AQI-scale pickers.
    var switchKey = voice.switchLabel ? 'thresh' + keyStem + 'On' : undefined;
    // The group header: title, reset-to-defaults, and (goal voice) the master on/off
    // switch that used to ride the sheet's title row. The intro hangs off it because
    // it describes the LEVELS, not the rows above them in the sheet.
    var lead = [{
        type: 'subheader',
        text: voice.header,
        toggleKey: switchKey,
        intro: voice.intro,
        // Reverts pair + colors + scale max to the kind's defaults (blocks.js
        // action) — deliberately NOT the pencil sheet's Bold row, which is not part
        // of the group.
        labelAction: {action: 'resetThresholds', arg: keyStem, label: 'Reset to defaults'}
    }];
    if (switchKey) {
        lead.push({
            type: 'toggle',
            messageKey: switchKey,
            label: voice.switchLabel,
            defaultValue: false
        });
    }
    lead.push({
        type: 'range',
        messageKey: 'thresh' + keyStem + 'Warn',
        dangerKey: 'thresh' + keyStem + 'Danger',
        maxKey: 'thresh' + keyStem + 'Max',
        // Title + reset live on the group's sub-header now, so the row itself is
        // label-less: repeating "Alert levels" directly under the header read as a
        // stutter. No disabledWhen: see the top of this function.
        defaultValue: '',
        hint: hint,
        joinPrevious: true,
        // The chips' words ride the args: the resolver owns the numbers, the voice
        // the wording.
        rangeFrom: {resolver: 'thresholdRange', args: {keyStem: keyStem, chips: voice.chips}}
    });
    // An alert group's cards on its default levels, right after the slider whose numbers
    // they explain: amber info boxes that stand off (not joined), each shown while its
    // unit or scale is in effect. Their own gate layers under the group's.
    (why || []).forEach(function (card) {
        var item = {type: 'staticText', style: 'info', text: card.text};
        if (card.showWhen) { item.showWhen = gate ? {all: [gate, card.showWhen]} : card.showWhen; }
        lead.push(item);
    });
    // Every plain item in the group carries the same gate; applying it in one pass
    // (gateAll) means an item added above cannot forget its gate line. (The warn
    // look and color pickers — levelLook — set showWhen inline instead: they layer the
    // B&W/look rules on top of the gate.)
    gateAll(lead, gate);
    return lead.concat([{
        // Companion storage for the slider's second thumb and its editable scale
        // max: hydrated + serialized but never drawn (the range row renders both).
        type: 'hidden',
        messageKey: 'thresh' + keyStem + 'Danger',
        defaultValue: ''
    }, {
        type: 'hidden',
        messageKey: 'thresh' + keyStem + 'Max',
        defaultValue: ''
    }]);
}
/**
 * The look half of a kind's group: the warn look, then the warn and danger colour pickers
 * joined under it.
 * @param {string} keyStem Kind key stem, e.g. 'Steps'.
 * @param {Object} voice GOAL_VOICE or ALERT_VOICE.
 * @param {?Object} gate Extra showWhen for the whole group, or null.
 * @param {Object} [offWhen] When these highlight-only rows go inert: a goal group's own
 *     switch being off. Absent for an alert group, whose rows style the alert icon too
 *     and so are always live.
 * @param {boolean} joinsAbove Whether the warn look keeps its joinPrevious. In a goal
 *     sheet it follows the hidden companions, which the engine's join look-ahead counts as
 *     a row, so the join has never shown there; in an alert sheet it follows Tomorrow's
 *     mark or Days, and a join would glue it to them, so it starts its own group.
 * @returns {Object[]} The warn look, warn color and danger color rows.
 */
function levelLook(keyStem, voice, gate, offWhen, joinsAbove) {
    var colorWhen = gate ? {all: [gate, COLOR_THEME_WHEN]} : COLOR_THEME_WHEN;
    var warnLook = {
        // The warn look — the box drawn at the warn level (a goal kind's "close"),
        // for the slot while its highlight is on AND for the kind's alert icon.
        // It replaced the 'Outline on warn' toggle (thresh<K>WarnOutlineOn, read
        // once by migrations/v1_24.js migrateWarnLook). The default is per
        // PLATFORM (status-thresholds.js warnLookDefault through the blocks.js
        // defaultFrom resolver): fill on a colour watch, outline on a B&W one —
        // a B&W warn fill would be the danger fill — and outline for goal kinds.
        // The key stays ABSENT unless the user picks a look other than the saving
        // watch's default: defaultFrom items are never seeded, and sticky: false
        // keeps a save from writing the hydrated default back (engine.js
        // serialize). So one phone driving a colour and a B&W watch packs each
        // its own default, through the same resolver phone-side
        // (status-wire buildSettingsBlob, with the watch's env).
        // Shown on B&W too: none vs outline is meaningful without colour choice.
        // A weather kind's row is always live (it styles the alert icon too); a
        // goal kind's goes inert with its Goals switch, like its colours.
        type: 'segmented',
        messageKey: 'thresh' + keyStem + 'WarnLook',
        label: voice.lookLabel,
        options: [['None', 'none'], ['Outline', 'outline'], ['Fill', 'fill']],
        defaultFrom: {resolver: 'warnLookDefault', args: {keyStem: keyStem}, sticky: false},
        hintByValue: voice.look.base,
        hintFrom: {resolver: 'warnLookHint', args: {keyStem: keyStem, copy: voice.look}},
        joinPrevious: true,
        showWhen: gate || undefined,
        disabledWhen: offWhen
    };
    // Deleted rather than built without it, so a goal sheet's warn look keeps its key
    // order (the golden pins goal sheets byte for byte).
    if (!joinsAbove) { delete warnLook.joinPrevious; }
    return [warnLook, {
        // An unset (or black / white) colour is AUTO — status-thresholds.js
        // thresholdColor, the one rule for the packer, the page and the on-open heal
        // (onbuild.js): the warn colour the theme fg (weather) or the goal green
        // (goal), the danger colour the contract's red (weather; DEFAULT_DANGER_HEX)
        // or the goal green. The heal writes that resolution on open, and the two
        // pickers paint it (displayFrom) until then.
        type: 'color',
        messageKey: 'thresh' + keyStem + 'WarnColor',
        label: voice.colorLabels.warn,
        defaultValue: voice.colorDefault,
        displayFrom: {resolver: 'thresholdColor', args: {keyStem: keyStem, which: 'Warn'}},
        joinPrevious: true,
        capabilities: ['COLOR'],
        // colorWhen (gate + color-capable theme) composed with the warn look — a
        // look of 'none' draws no box to colour.
        showWhen: {all: [colorWhen, {not: {key: 'thresh' + keyStem + 'WarnLook', eq: 'none'}}]},
        disabledWhen: offWhen
    }, {
        type: 'color',
        messageKey: 'thresh' + keyStem + 'DangerColor',
        label: voice.colorLabels.danger,
        defaultValue: voice.colorDefault,
        displayFrom: {resolver: 'thresholdColor', args: {keyStem: keyStem, which: 'Danger'}},
        joinPrevious: true,
        capabilities: ['COLOR'],
        showWhen: colorWhen,
        disabledWhen: offWhen
    }];
}
/**
 * A goal kind's whole group, the two halves back to back.
 * @param {string} keyStem Kind key stem, e.g. 'Steps' (thresh<Stem>Warn/...).
 * @param {Object} voice GOAL_VOICE (ALERT_VOICE builds its sheet from the halves).
 * @param {string} hint Per-kind unit/scale hint under the slider (HTML allowed; '' for
 *     none).
 * @param {?Object} gate Extra showWhen for the whole group, or null.
 * @param {Object} [offWhen] When the highlight-only rows (warn look + color pickers)
 *     go inert: the group's own switch being off.
 * @returns {Object[]} The group's items: sub-header, (a voice with a switch) the
 *     switch, slider, the two hidden companions, warn look, warn color, danger color.
 */
function levelRows(keyStem, voice, hint, gate, offWhen) {
    return levelLead(keyStem, voice, hint, gate).concat(levelLook(keyStem, voice, gate, offWhen, true));
}

module.exports = {
    BOLD_ALWAYS_HINT: BOLD_ALWAYS_HINT,
    ALERT_VOICE: ALERT_VOICE,
    GOAL_VOICE: GOAL_VOICE,
    nextDayMarkOptions: nextDayMarkOptions,
    levelLead: levelLead,
    levelLook: levelLook,
    levelRows: levelRows
};

// src/pkjs/settings/alerts-schema.js — ES5, PKJS-parsed. The Alerts tab's part of the
// settings schema, split out of schema.js: the About alerts card (its intro, its reset
// link row and the Default view note) and the item rows under it, the sheet behind every
// row (Battery, Bluetooth, Quiet time, Sleep, Rain and the five metric alerts, each leading
// with its Shows on grid), the alert-level cards, the eight side lists' hidden items, and
// the pieces the other tabs show: a bar's Alerts row (Status bars tab), the rain alert's
// 'Rain alert only' note (Watchface › Views), and the Bluetooth icon's choices (aplite's
// Watch Status Bar). schema.js's alert slot sheets
// read the kinds, their contract codes and the placement leaf from here.
// It reads the shared gates (schema-gates.js) and the level group (level-rows-schema.js),
// never schema.js, so the dependency points one way. Plain CommonJS with an unguarded
// require(), like schema.js itself: the schema is built in PKJS and reaches the page as
// data.
var STATUS_THRESHOLDS = require('../status-thresholds.js');
// On demand: the items, the side keys and their defaults (the phone's reading too).
var ON_DEMAND = require('../on-demand.js');
var gates = require('./schema-gates.js');
var ON_DEMAND_WHEN = gates.ON_DEMAND_WHEN;
var FINE_BATTERY_WHEN = gates.FINE_BATTERY_WHEN;
var tabLink = gates.tabLink;
var linkRow = gates.linkRow;
var levelRowsSchema = require('./level-rows-schema.js');
var ALERT_VOICE = levelRowsSchema.ALERT_VOICE;
var nextDayMarkOptions = levelRowsSchema.nextDayMarkOptions;
var levelLead = levelRowsSchema.levelLead;
var levelLook = levelRowsSchema.levelLook;

// The rain alert's two choices, named once: the Rain sheet's rows offer them and the
// card row's hint (alerts-page.js rainAlertHint) prints the picked ones by these labels. The
// window's segmented control uses the short labels; the card row keeps the long ones.
var RAIN_WINDOW_OPTIONS = [['Within 30 min', '30'], ['Within 60 min', '60'], ['Within 2 hours', '120']];
var RAIN_WINDOW_SEGMENTS = [['30 min', '30'], ['60 min', '60'], ['2 hours', '120']];
var RAIN_LOOK_OPTIONS = [['Icon', 'icon'], ['Icon + minutes', 'minutes'], ['Text', 'text']];

// On demand (the Alerts): each status bar's two sides and the items on them
// (src/pkjs/on-demand.js, the one reading the phone and this page share). The bars' names
// as their sub-headers print them.
var OD_BAR_NAMES = {top: 'Watch bar', forecast: 'Forecast bar',
    radar: 'Radar bar', health: 'Health bar'};
// The bars in the page's order, the Status bars tab's (the owner, 2026-10-01): the rows
// of every Shows on grid. on-demand.js BARS keeps the wire's ThreshBar order.
var OD_PAGE_BARS = ['top', 'forecast', 'health', 'radar'];
// The note under every Shows on grid: the two side rules a user can act on (one side per
// bar; the make-room order drops the lowest-priority item first, and on-demand.js ITEMS
// priority is the Alerts tab's row order). The per-bar Alerts sheet's intro said
// them until the grids replaced it.
var SHOWS_ON_NOTE = 'One side per bar. On a crowded bar, the items lower in the Alerts tab’s list drop first.';
/**
 * An item's Shows on grid and its note, the first rows of its sheet (under the sheet's
 * intro): one row per status bar the watch draws, each with a Left and a Right tick
 * for that side's list (alerts-page.js onDemandBars; a checklist, config-ui lib/checklist.js).
 * A tap goes to on-demand.js through the grid's writer (reset-status-defaults.js
 * onDemandTick: tickOn / untickFrom), which keeps the list in priority order and the item
 * on one side of the bar. The grid has no messageKey: it stores nothing of its own.
 * @param {string} code An on-demand.js ITEMS code.
 * @param {string} [merge] A metric alert's value as its intro names it (e.g. 'the UV
 *     index'): the note then adds the merge into the slot that shows that value
 *     (status_on_demand.c). Rain and the System info items never merge.
 * @returns {Object[]} The grid and its note.
 */
function showsOnRows(code, merge, notes) {
    // The dialog's Shows on card: its title is the grid's name, the side rules its info
    // text (the card's intro), the grid itself under the Left / Right captions, then
    // any boxed notes on why the item may not show (the caller's, and the Default view's).
    return [{
        type: 'subheader',
        text: 'Shows on',
        intro: SHOWS_ON_NOTE + (merge ? ' Where the status slot on that side shows ' + merge
            + ', the alert goes into that slot, with its colors, instead of adding its alert icon.' : '')
    }].concat(notes || [], [{
        type: 'checklist',
        label: 'Shows on',
        captionsOnly: true,
        check: code,
        writeWith: 'onDemandTick',
        columns: [{label: 'Left'}, {label: 'Right'}],
        optionsFrom: {resolver: 'onDemandBars', args: {code: code, bars: OD_PAGE_BARS, names: OD_BAR_NAMES}}
    }, defaultViewNote()]);
}
/**
 * Under a Shows on grid while the Default view shows no bar with Alerts on it
 * (when-resolvers.js defaultViewLacksOnDemand): where the fix is. A fresh object per call.
 * @returns {Object} The info-box staticText.
 */
function defaultViewNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'Your Default view has no Watch Status Bar. Tick another bar below.',
        showWhen: {when: 'defaultViewLacksOnDemand'}
    };
}
/**
 * The when-leaf "the item shows on a status bar" (settings/when-resolvers.js
 * onDemandPlaced: on-demand.js placedAnywhere, the reading the wire packs).
 * @param {string} code An on-demand.js ITEMS code.
 * @returns {Object} The showWhen predicate.
 */
function onDemandPlacedWhen(code) {
    return {when: 'onDemandPlaced', args: {code: code}};
}
/**
 * The note under the Rain radar row (Watchface › Views) in radar mode 'Rain alert only',
 * the mode that fetches the radar for the rain icon alone, while no side of a bar that
 * exists in it holds Rain, with a link to the Alerts tab, where the Rain sheet's Shows
 * on grid places it. Not in 'Status' or 'Graph' mode: a user there who took Rain off
 * every bar chose that. The radar bar
 * never shows in this mode, so on-demand.js placedAnywhere (onDemandPlacedWhen) leaves a
 * Rain ticked there out, as placeRainForCountdown does. The Rain sheet needs no note of
 * its own: its Shows on grid shows where Rain is. A fresh object per call, like every
 * item.
 * @returns {Object} The info-box staticText.
 */
function rainAlertUnshownNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: '‘Rain alert only’ fetches the radar for the rain icon, but Rain isn’t on any status bar ('
            + tabLink('alerts', 'Alerts › Rain') + ').',
        showWhen: {all: [{key: 'radarMode', eq: 'countdown'}, ON_DEMAND_WHEN, {not: onDemandPlacedWhen('rain')}]}
    };
}
/**
 * The Rain sheet's box while the radar is off, right under its Shows on note: the rain
 * alert cannot show then (alerts-page.js onDemandBlocked), so the grid's rows go inert and
 * keep their ticks, and this says why. A fresh object per call, like every item.
 * @returns {Object} The info-box staticText.
 */
function rainRadarOffNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'The rain alert needs the rain radar. Turn it on in ' + tabLink('watchface', 'Watchface › Views') + '.',
        showWhen: {key: 'radarMode', eq: 'off'}
    };
}
/**
 * The rain alert's sheet (sheetId alertRain), opened from the Rain row in the Alerts tab's
 * Weather alerts card: its Shows on grid and notes, the radar-off box, then its Alert card:
 * the time window, then the Look. It has no switch: a tick in its Shows on grid is the
 * switch. The time window is set here alone (the owner, 2026-10-02: the old Radar tab's
 * copy went, "Alerts is enough"). The look's
 * and the window's defaults are the contract's (status-thresholds.js rainAlert), so the
 * page hydrating a key and the packer reading it absent never disagree.
 * @returns {Object} Schema section (sheetOnly).
 */
function rainAlertSheet() {
    return {
        sheetOnly: true,
        sheetId: 'alertRain',
        showWhen: ON_DEMAND_WHEN,
        title: 'Rain alert',
        // The watch shows it while rain falls now, whatever the window, and hides it while
        // the radar is snoozed for the Battery saver hours (rain_countdown.c). The colour
        // follows rain_tint (status_on_demand.c): the radar's tier colour only on a colour
        // watch under a colour theme.
        intro: 'Shows the rain icon at the edge of a status bar while it rains at your location or rain is due '
            + 'within the time window. On a color watch the rain icon takes the radar’s rain color, except with a '
            + 'B&W theme. Hidden during the Battery saver hours.',
        // Two cards: Shows on (with the boxes on why the icon cannot show yet: the radar
        // off, or Rain on no bar), then the alert's own rows, its time window first.
        items: showsOnRows('rain', null, [rainRadarOffNote(), rainNotPlacedNote()]).concat([
            {type: 'subheader', text: 'Alert'}, {
            type: 'segmented',
            messageKey: 'rainCountdownHorizon',
            label: 'Time window',
            defaultValue: String(STATUS_THRESHOLDS.rainAlert(null).horizonMin),
            options: RAIN_WINDOW_SEGMENTS,
            hint: 'Rain due further out doesn’t show the icon. Radar forecasts change often, so a shorter window gives fewer false alarms.'
        }, {
            // How the rain alert draws. 'text' is the "Rain in 12′" the strip always
            // showed. The watch resolves the rain entry itself, so this rides the Clay
            // message (thresholds blob byte 34), not the phone's bake.
            type: 'segmented',
            messageKey: 'rainAlertDisplay',
            label: 'Look',
            defaultValue: STATUS_THRESHOLDS.rainAlert(null).look,
            options: RAIN_LOOK_OPTIONS,
            // The icon alone describes itself. The two longer looks say what they print
            // and when they shrink on a crowded bar (the make-room order, the owner's of
            // 2026-09-30: the status slot on the item's side and the middle one shorten
            // and hide first, then Text → minutes → the icon alone). While it rains the
            // '+' number counts the minutes until the rain stops.
            hintByValue: {
                minutes: 'The rain icon with the minutes until the rain starts or, while it rains, + the minutes until it stops. On a crowded bar, the status slot on its side and the middle slot shorten and hide first; only then is it just the icon.',
                text: 'On a crowded bar, the status slot on its side and the middle slot shorten and hide first; only then does it shorten to the minutes, then to the rain icon alone.'
            }
        }])
    };
}
/**
 * The Rain dialog's box while the radar runs but Rain is ticked on no bar: the icon has
 * nowhere to show, and the grid right below is the fix. A fresh object per call.
 * @returns {Object} The info-box staticText.
 */
function rainNotPlacedNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'Rain isn’t on any status bar yet, so the rain icon won’t show. Tick a side below.',
        showWhen: {all: [{key: 'radarMode', ne: 'off'}, {not: onDemandPlacedWhen('rain')}]}
    };
}
// A metric alert's Days, named once: the sheet's row offers them and the card row's hint
// (alerts-page.js alertLevelsHint) prints a pick other than the default by its label. The
// values are the contract's (status-thresholds.js ALERT_DAYS — pinned by a test);
// 'tomorrow' is "Today + tomorrow", never tomorrow alone: today always wins.
var ALERT_DAYS_OPTIONS = [['Today', 'today'], ['Today + tomorrow', 'tomorrow']];
/**
 * A metric alert's contract code, found by its key stem (status-thresholds.js
 * ALERT_KINDS), so the sheet reads its defaults through the contract's own readers.
 * @param {string} keyStem Kind key stem, e.g. 'Uv'.
 * @returns {string} The alert's code, e.g. 'uv'.
 */
function alertCodeOf(keyStem) {
    for (var i = 0; i < STATUS_THRESHOLDS.ALERT_KINDS.length; i++) {
        if (STATUS_THRESHOLDS.ALERT_KINDS[i].key === keyStem) { return STATUS_THRESHOLDS.ALERT_KINDS[i].code; }
    }
    // Runs once at load: a stem the contract lacks fails the build/tests here rather
    // than shipping a sheet whose defaults read another alert's.
    throw new Error('alertSheet: no contract alert for ' + keyStem);
}
/**
 * "This alert looks ahead to tomorrow" as a showWhen predicate that resolves exactly
 * as status-thresholds.js alertDays does. With "Today + tomorrow" the default,
 * anything but a stored 'today' — absent or unknown — reads as looking ahead; were
 * 'today' the default, only a stored 'tomorrow' would. The default is read from the
 * contract, not restated here.
 * @param {string} daysKey The alert's Days key, e.g. 'alertUvDays'.
 * @returns {Object} The showWhen predicate.
 */
function alertLooksAheadWhen(daysKey) {
    return STATUS_THRESHOLDS.ALERT_DAYS_DEFAULT === 'tomorrow'
        ? {key: daysKey, ne: 'today'} : {key: daysKey, eq: 'tomorrow'};
}
/**
 * One metric alert's sheet (sheetId alert<Stem>), opened from its row in the Alerts tab's
 * Weather alerts card, in the owner's order (2026-10-01): its intro card (with the note on
 * the default levels for the unit or scale in effect), its Shows on grid and note, the
 * Alert levels (header, slider), the Look,
 * then everything else (the Days with the tomorrow mark, the warn look and its colours) —
 * the levels' ONE home (the slot sheet points here). It has no switch: a tick in its Shows
 * on grid is the switch. The phone bakes an entry into the ALERT_ENTRIES_UINT8 tuple
 * only for a kind placed on a bar whose day — today, or with Days "Today + tomorrow"
 * tomorrow — reaches its warn level (status-wire.js bakeAlerts), so the Look, the
 * Days and the mark ride renderSignature(), not the Clay message.
 * @param {string} keyStem Kind key stem, e.g. 'Uv' (alert<Stem>Display,
 *     alert<Stem>Days, alert<Stem>NextDayMark).
 * @param {string} title The kind's sheet title, e.g. 'UV index'.
 * @param {string} subject The value the intro names, e.g. 'the UV index'.
 * @param {string} iconName The kind's alert icon as the intro names it, e.g. 'UV'.
 * @param {string} hint The levels slider's scale note ('' for none).
 * @param {string} [coda] A closing sentence for the intro (leading space), '' for none.
 * @param {Array<{text: string, showWhen: (Object|undefined)}>} [why] The kind's notes on
 *     its default levels (ALERT_LEVEL_CARDS), under the dialog's intro.
 * @returns {Object} Schema section (sheetOnly).
 */
function alertSheet(keyStem, title, subject, iconName, hint, coda, why) {
    var key = 'alert' + keyStem;
    var code = alertCodeOf(keyStem);
    return {
        sheetOnly: true,
        sheetId: key,
        showWhen: ON_DEMAND_WHEN,
        title: title + ' alert',
        // "reaches … today": the entry fires on the highest value left today, so the
        // morning icon for an afternoon peak is by design (status-wire alertReading).
        // `coda` closes it for a kind whose look-ahead depends on its source (AQI).
        intro: 'Shows the ' + iconName + ' icon at the edge of a status bar when ' + subject
            + ' reaches your warn level at any point left today, so an afternoon peak shows from the morning on.'
            + (coda || ''),
        // The note on the default levels for the unit or AQI scale in effect, under the intro
        // in the dialog's intro card (engine dialogIntroHtml; owner, 2026-10-04).
        introNotes: why || [],
        // The two hidden companions close levelLead, so the Look below keeps the divider
        // the cards draw; the warn look starts its own group (levelLook, joinsAbove
        // false) rather than gluing itself under Tomorrow's mark or Days.
        items: showsOnRows(code, subject).concat(levelLead(keyStem, ALERT_VOICE, hint, null), [{
            type: 'segmented',
            messageKey: key + 'Display',
            label: 'Look',
            // Icon + value by default (the owner, 2026-10-04; status-thresholds.js
            // enabledAlerts reads an absent key the same way, and migrations/
            // alert-defaults.js moves the stored 'icon' of every earlier install).
            defaultValue: 'value',
            options: [['Icon', 'icon'], ['Icon + value', 'value']],
            // The icon-only look needs no hint; the value look says when it gives way on a
            // crowded bar (the make-room order drops the values only after the status
            // slot on the item's side and the middle one have hidden).
            hintByValue: {
                value: 'Adds the value the alert fires on after the icon. On a crowded bar, the status slot on its side and the middle slot shorten and hide first; only then does the alert drop to just the icon.'
            }
        }, {
            // Whether tomorrow's peak may make the alert active once nothing left today
            // reaches warn (bakeAlerts: today always wins, one entry per alert, drawn at
            // tomorrow's own level). The default is the contract's reading of an absent
            // key, so the page hydrating the key and the phone reading it absent never
            // disagree. Today gets no hint: the intro above already says what it judges.
            type: 'segmented',
            messageKey: key + 'Days',
            label: 'Days',
            defaultValue: STATUS_THRESHOLDS.alertDays(null, code),
            options: ALERT_DAYS_OPTIONS,
            more: true,
            hintByValue: {
                tomorrow: 'When nothing left today reaches your warn level but tomorrow does, the alert is active for tomorrow and its icon carries its Tomorrow’s mark.'
            }
        }, {
            // How a tomorrow entry marks its day: the slot's "Tomorrow's peak mark"
            // choices (nextDayMarkOptions — the contract's ALERT_NEXT_DAY_MARKS are
            // pinned to them), the watch drawing it before the value or after the
            // icon alone. Only a look-ahead alert reads it, so it shows only then.
            type: 'select',
            messageKey: key + 'NextDayMark',
            label: 'Tomorrow\'s mark',
            defaultValue: STATUS_THRESHOLDS.alertNextDayMark(null, code),
            options: nextDayMarkOptions(),
            hintByValue: {
                none: 'An alert for tomorrow then looks just like one for today.'
            },
            joinPrevious: true,
            more: true,
            showWhen: alertLooksAheadWhen(key + 'Days')
        }], levelLook(keyStem, ALERT_VOICE, null, undefined, false, true))
    };
}
/**
 * "This unit or AQI scale is in effect" as a showWhen predicate that resolves exactly
 * as status-thresholds.js scaleVariant does, its fallbacks included: any wind unit but
 * mph or knots (none stored too) reads as kph, and the European AQI scale needs the
 * Open-Meteo source AND a scale other than US. A fresh object per call, like every item.
 * @param {string} variant 'kph' | 'mph' | 'kn' (wind and gusts) or 'us' | 'eu' (AQI).
 * @returns {Object} The showWhen predicate.
 */
function scaleVariantWhen(variant) {
    if (variant === 'mph') { return {key: 'windUnits', eq: 'mph'}; }
    if (variant === 'kn') { return {key: 'windUnits', eq: 'knots'}; }
    if (variant === 'kph') { return {all: [{key: 'windUnits', ne: 'mph'}, {key: 'windUnits', ne: 'knots'}]}; }
    var eu = {all: [{key: 'aqiSource', eq: 'openmeteo'}, {key: 'aqiScale', ne: 'us'}]};
    if (variant === 'eu') { return eu; }
    if (variant === 'us') { return {not: eu}; }
    // Runs once at load: a variant scaleVariant never answers fails the build/tests here.
    throw new Error('scaleVariantWhen: no gate for ' + variant);
}
/**
 * A reference link in an alert-level card: opens outside the settings page, like the
 * key hints' links.
 * @param {string} href The page (HTML-escaped: &amp; between query parameters).
 * @param {string} text The link text.
 * @returns {string} The anchor's HTML.
 */
function refLink(href, text) {
    return '<a target=\'_blank\' href=\'' + href + '\'>' + text + '</a>';
}
// The published levels the alert-level cards cite (the owner's choice keeps the DWD's
// German pages: the warnings table also lists kn and Bft, the glossary gives Beaufort in
// km/h).
var DWD_GUST_WARNINGS = 'https://www.dwd.de/DE/wetter/warnungen_aktuell/kriterien/warnkriterien.html';
// Each weather alert's reasons for its default levels: notes under its dialog's intro
// (alertSheet introNotes), one per unit or AQI scale its seed pair varies by
// (status-thresholds.js scaleVariant), each shown only while that one is in effect
// (scaleVariantWhen), so a sheet always shows exactly one. Always shown, stored levels or
// not: they speak of the defaults ("By default, …"), the reference for picking others.
// The numbers are the seeds (status-thresholds.js SEEDS) next to the published level
// they sit on, written out because the reference words belong to them;
// test/config-alert-level-cards.test.js holds every card to its variant's seed pair.
// One link each, to the reference the numbers sit on.
var ALERT_LEVEL_CARDS = {
    Gust: [{
        showWhen: scaleVariantWhen('kph'),
        text: 'The ' + refLink(DWD_GUST_WARNINGS, 'German Weather Service (DWD)') + ' warns of storm gusts '
            + 'from 65 kph and of severe storm gusts from 90 kph. By default, warn and danger sit at those '
            + 'two levels.'
    }, {
        showWhen: scaleVariantWhen('mph'),
        text: 'The ' + refLink(DWD_GUST_WARNINGS, 'German Weather Service (DWD)') + ' warns of storm gusts '
            + 'from 65 kph (about 40 mph) and of severe storm gusts from 90 kph (about 56 mph). By default, '
            + 'warn sits at 40 mph and danger at 55 mph, the nearest steps.'
    }, {
        showWhen: scaleVariantWhen('kn'),
        text: 'The ' + refLink(DWD_GUST_WARNINGS, 'German Weather Service (DWD)') + ' warns of storm gusts '
            + 'from 34 kn and of severe storm gusts from 48 kn. By default, warn sits at 35 kn and danger at '
            + '50 kn, the nearest steps.'
    }],
    Uv: [{
        text: 'By default, warn sits at 6, where the '
            + refLink('https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-%28uv%29-index',
                'WHO’s UV index scale')
            + ' starts High, and danger at 8, where Very high starts and the WHO advises staying out of the '
            + 'midday sun. The WHO advises sun protection from UV 3 on.'
    }],
    Aqi: [{
        showWhen: scaleVariantWhen('us'),
        text: 'By default, warn sits at 100, which equals the '
            + refLink('https://www.airnow.gov/aqi/aqi-basics/', 'US health standard for short-term exposure')
            + ': above it, the US EPA rates the air unhealthy for sensitive groups, such as children, older '
            + 'adults and people with heart or lung disease. Danger sits at 150: above it, the air is rated '
            + 'unhealthy and the general public can be affected too.'
    }, {
        showWhen: scaleVariantWhen('eu'),
        text: 'By default, warn sits at 60, where the '
            + refLink('https://airindex.eea.europa.eu/AQI/index.html', 'European Air Quality Index')
            + ' rates the air Poor, and danger at 80, where it rates it Very poor. At Poor, the European '
            + 'Environment Agency advises cutting back on intense outdoor activity if you get sore eyes or a '
            + 'cough; at Very poor, sensitive people should reduce outdoor activity.'
    }],
    Pollen: [{
        text: 'By default, warn sits at 2 (medium load) and danger at 3 (high load) on the '
            + refLink('https://www.dwd.de/DE/leistungen/gefahrenindizespollen/erklaerungen.html',
                'German Weather Service’s (DWD) pollen index')
            + '. High means, for example, more than 50 birch or 30 grass pollen grains per cubic meter of air. '
            + 'The DWD notes that very sensitive people can react strongly at low levels too.'
    }],
    Wind: [{
        showWhen: scaleVariantWhen('kph'),
        text: 'By default, warn sits at 40 kph, Beaufort 6 on the '
            + refLink('https://www.dwd.de/DE/service/lexikon/Functions/glossar.html?lv2=100310&amp;lv3=100390',
                'wind scale')
            + ': large branches sway and umbrellas are hard to hold. Danger sits at 60 kph, the top of '
            + 'Beaufort 7 and just below gale force: whole trees move and walking against the wind is hard.'
    }, {
        showWhen: scaleVariantWhen('mph'),
        text: 'By default, warn sits at 25 mph, where Beaufort 6 starts on the wind scale: large branches sway '
            + 'and umbrellas are hard to hold. Danger sits at 40 mph, gale force (Beaufort 8) and the '
            + refLink('https://www.weather.gov/lwx/WarningsDefined',
                'US National Weather Service’s High Wind Warning')
            + ' level for wind that blows that hard for an hour or more.'
    }, {
        showWhen: scaleVariantWhen('kn'),
        text: 'By default, warn sits at 20 kn, just below a strong breeze (Beaufort 6, from 22 kn) on the '
            + refLink('https://weather.metoffice.gov.uk/guides/coast-and-sea/beaufort-scale', 'Beaufort scale')
            + '. Danger sits at 35 kn, gale force (Beaufort 8): twigs break off trees and walking is hard going.'
    }]
};
// The weather alerts' rows and sheets, in the card's order. `title` names both of a kind's
// sheets (its alert sheet here, its slot sheet — schema.js alertSlotSheet); `subject` and
// `iconName` feed the alert sheet's intro; Pollen is DWD's alone, like the pollen slot
// itself; `why` is the kind's alert-level cards (ALERT_LEVEL_CARDS). The page's
// presentation of the contract's metric alerts (status-thresholds.js ALERT_KINDS, which
// owns which alerts exist and their order): test/config-schema.test.js pins this list's
// stems to that order.
var ALERT_KINDS = [
    {keyStem: 'Gust', label: 'Wind gusts', title: 'Wind gusts', subject: 'the gust speed', iconName: 'gust',
        icon: 'gust', why: ALERT_LEVEL_CARDS.Gust},
    {keyStem: 'Uv', label: 'UV index', title: 'UV index', subject: 'the UV index', iconName: 'UV',
        icon: 'uv', why: ALERT_LEVEL_CARDS.Uv},
    // AQI looks ahead — later today AND tomorrow — only on an hourly forecast
    // (AQI_DAY_PEAKS): WAQI — the default source, and Auto whenever a station answers
    // — has none, so alertReading judges the current reading and no tomorrow entry is
    // ever baked (wire-units dayMaxTomorrow reads null). The coda mirrors the slot
    // sheet's source note, in Setup › Weather data's own labels ('AQI provider', 'Open-Meteo').
    {keyStem: 'Aqi', label: 'Air quality', title: 'Air quality (AQI)', subject: 'the air quality index',
        iconName: 'air quality', icon: 'aqi', why: ALERT_LEVEL_CARDS.Aqi,
        coda: ' Looking ahead — later today and tomorrow — needs the Open-Meteo AQI provider (Setup › Weather data): '
            + 'WAQI, which Auto mostly reads, has no forecast, so the alert then judges the current reading.'},
    {keyStem: 'Pollen', label: 'Pollen', title: 'Pollen', subject: 'the pollen index', iconName: 'pollen',
        icon: 'pollen', gate: {key: 'provider', eq: 'dwd'}, why: ALERT_LEVEL_CARDS.Pollen,
        hint: 'DWD pollen index 0–3 (half-levels like "2-3" count as 2.5); DWD provider only.'},
    {keyStem: 'Wind', label: 'Wind speed', title: 'Wind speed', subject: 'the wind speed', iconName: 'wind',
        icon: 'wind', why: ALERT_LEVEL_CARDS.Wind}
];
/**
 * A bar's Alerts row, after its three slots: a nav row to the Alerts tab, storing nothing
 * (the owner, 2026-10-01). Its summary shows the icons of the items placed on each side
 * ("Left" + icons, "Right" + icons; alerts-page.js onDemandBarIcons), or "None". No key and no
 * Edit button: each item's sheet on the Alerts tab places it.
 * @param {string} prefix The bar's key prefix, e.g. 'statusTop'.
 * @param {?Object} barWhen The bar's gate (RADAR_BAR_WHEN …), or null.
 * @returns {Object} The row.
 */
function onDemandRow(prefix, barWhen) {
    var bar = null;
    ON_DEMAND.BARS.forEach(function (b) { if (b.prefix === prefix) { bar = b.bar; } });
    // A nav row: its summary shows the icons of the alerts placed on each side, and a tap
    // brings the Alerts tab, where each alert's dialog places it, to the front.
    return {
        type: 'button',
        label: 'Alerts',
        gotoTab: 'alerts',
        navNote: 'Alerts',
        hintFrom: {resolver: 'onDemandBarIcons', args: {bar: bar, where: 'None'}},
        showWhen: barWhen ? {all: [ON_DEMAND_WHEN, barWhen]} : ON_DEMAND_WHEN
    };
}
/**
 * The eight side lists (status<Bar>OnDemand<Left|Right>Items), never drawn: the ONE item
 * per key, which hydrates and serializes it. The Shows on grids write the lists through
 * on-demand.js (showsOnRows), not through these items. In BARS order, left then right.
 * A section of their own: the engine's join look-ahead counts a hidden item as a row, so
 * hidden items between drawn rows would change their dividers.
 * @returns {Object} Schema section (sheetOnly, never opened).
 */
function onDemandListsSection() {
    var items = [];
    ON_DEMAND.BARS.forEach(function (b) {
        ON_DEMAND.SIDES.forEach(function (side) {
            var key = ON_DEMAND.itemsKey(b.bar, side);
            items.push({type: 'hidden', messageKey: key, defaultValue: ON_DEMAND.DEFAULTS[key]});
        });
    });
    return {sheetOnly: true, sheetId: 'odLists', showWhen: ON_DEMAND_WHEN, items: items};
}
/**
 * The Battery item's warn level on one platform family: a one-thumb slider in the watch's
 * charge steps (5 % on emery, which reports the charge that finely, 10 % elsewhere). The
 * two rows share the key and are gated apart; a stored 5/15/25 shows on the 10 % slider at
 * the next step up (the `single` snap-up — on-demand.js batteryLevel, what the phone sends).
 * The slider and batteryLevel agree only inside 5..30: a level outside it, which only a
 * hand-edited blob can hold, shows at the nearest bound (the slider's clamp: '31' as 30,
 * '0' on emery as 5) but is sent as 10 (batteryLevel's fallback) until the thumb moves.
 * @param {number} step 5 | 10.
 * @param {Object} showWhen The row's platform gate.
 * @returns {Object} Schema item.
 */
function batteryLevelRow(step, showWhen) {
    return {
        type: 'range',
        single: true,
        messageKey: 'batteryLowLevel',
        label: 'Warn level',
        min: step,
        max: ON_DEMAND.BATTERY_LEVEL_MAX,
        step: step,
        unit: '%',
        defaultValue: ON_DEMAND.DEFAULTS.batteryLowLevel,
        hint: 'The icon shows at this charge or below.',
        showWhen: showWhen
    };
}
/**
 * The Battery item's sheet (sheetId odBattery): its Shows on grid and note, its warn level
 * and its Look. No colours: the icon's fill follows the charge like the Watch battery
 * slot's.
 * @returns {Object} Schema section (sheetOnly).
 */
function batterySheet() {
    return {
        sheetOnly: true,
        sheetId: 'odBattery',
        showWhen: ON_DEMAND_WHEN,
        title: 'Battery',
        // The stand-in rule (status_on_demand.c battery_slots): a bar that shows the
        // watch battery in any slot leaves the item out until the make-room order has
        // hidden that slot, whatever the item's Look.
        intro: 'Shows the battery icon at the edge of a status bar while the watch battery is at or below the '
            + 'warn level. A bar that already shows the battery in a slot (Watch battery or Watch battery '
            + 'percentage) leaves the icon out, and draws it only when that slot is hidden to make room.',
        items: showsOnRows('battery').concat([
            {type: 'subheader', text: 'Alert'},
            batteryLevelRow(5, FINE_BATTERY_WHEN),
            batteryLevelRow(10, {not: FINE_BATTERY_WHEN}),
            {
                type: 'segmented',
                messageKey: 'batteryLowDisplay',
                label: 'Look',
                defaultValue: ON_DEMAND.DEFAULTS.batteryLowDisplay,
                options: [['Icon', 'icon'], ['Icon + value', 'value']],
                // Its value gives way where an alert's does (the make-room order drops the
                // values only after the status slot on its side and the middle one have
                // hidden), so the hint says it in the alert Look's words.
                hintByValue: {
                    value: 'Adds the charge after the icon, like 8%. On a crowded bar, the status slot on its side and the middle slot shorten and hide first; only then does it drop to just the icon.'
                }
            }
        ])
    };
}
/**
 * The Bluetooth item's sheet (sheetId odBluetooth): its Shows on grid and note, when the
 * icon shows, and the vibration on disconnect. The keys are the ones the Watch Status Bar
 * held (aplite keeps its own copies of both rows there).
 *
 * Both rows carry ON_DEMAND_WHEN on the ITEM as well as the section: the engine finds a
 * key's shown copy (findShownItem: the select modal's title, a trigger's relabel) by the
 * item's own gate alone, so without it aplite's Watch Status Bar "Show icon for
 * bluetooth" picker would open under this sheet's "Show" label. Gated at item level, the
 * two copies are mutually exclusive (the tomorrowioApiKey precedent).
 * @returns {Object} Schema section (sheetOnly).
 */
function bluetoothSheet() {
    return {
        sheetOnly: true,
        sheetId: 'odBluetooth',
        showWhen: ON_DEMAND_WHEN,
        title: 'Bluetooth',
        intro: 'Shows the Bluetooth icon at the edge of a status bar.',
        items: showsOnRows('bt').concat([{type: 'subheader', text: 'Alert'}, {
            type: 'select',
            messageKey: 'btIcons',
            label: 'Show',
            defaultValue: 'disconnected',
            options: BT_ICON_OPTIONS,
            hintByValue: {
                both: 'The icon while connected, crossed out while disconnected.',
                none: 'The icon never shows. Vibrate on disconnect still works.'
            },
            showWhen: ON_DEMAND_WHEN
        }, {
            type: 'toggle',
            messageKey: 'vibe',
            label: 'Vibrate on disconnect',
            // ON out of the box (2.2.0), as aplite's Watch Status Bar copy: the buzz is
            // how a lost phone link gets noticed. Fresh installs and a reset only.
            defaultValue: true,
            joinPrevious: 'loose',
            showWhen: ON_DEMAND_WHEN
        }])
    };
}
// The Bluetooth icon's choices, shared by the Bluetooth sheet and aplite's Watch Status
// Bar row.
var BT_ICON_OPTIONS = [['Disconnected', 'disconnected'], ['Connected', 'connected'], ['Both', 'both'], ['None', 'none']];
/**
 * A settings-less item's sheet (Quiet time, Sleep): its Shows on grid and note alone, the
 * item's position and nothing else (the owner, 2026-10-02: "only position here, no other
 * settings"). Quiet time follows the watch's Quiet Time, Sleep the Battery saver hours.
 * @param {string} sheetId The sheet, e.g. 'odQuiet'.
 * @param {string} title The sheet's title, the card row's label.
 * @param {string} code The item's on-demand.js ITEMS code.
 * @param {string} intro The sheet's intro: what the item shows and when.
 * @returns {Object} Schema section (sheetOnly).
 */
function placementSheet(sheetId, title, code, intro) {
    return {
        sheetOnly: true,
        sheetId: sheetId,
        showWhen: ON_DEMAND_WHEN,
        title: title,
        intro: intro,
        items: showsOnRows(code)
    };
}
/**
 * One Alerts-tab nav row that opens a sheet: a badged `sheet` row (icon + label, the
 * item's live state under the label, its colours as dots where it has any, a chevron).
 * @param {string} sheetId The item's sheet, e.g. 'alertUv'.
 * @param {string} label Row label.
 * @param {string} icon Registered PConf.icons id (status-slot-icons.js).
 * @param {?Object} showWhen The row's own gate, or null.
 * @param {Object} hintFrom The live-state hint resolver ({resolver, args}).
 * @param {Object} editBadgeFrom The badge resolver ({resolver, args}).
 * @returns {Object} Schema item.
 */
function onDemandSheetRow(sheetId, label, icon, showWhen, hintFrom, editBadgeFrom) {
    var row = {type: 'sheet', sheetId: sheetId, label: label, icon: icon, hintFrom: hintFrom};
    if (editBadgeFrom) { row.editBadgeFrom = editBadgeFrom; }
    // A row whose alert is on no bar reads dimmed (its summary says so).
    row.summaryFaintFrom = {not: onDemandPlacedWhen(ON_DEMAND_CODES[sheetId])};
    if (showWhen) { row.showWhen = showWhen; }
    return row;
}
// Each Alerts-tab row's on-demand.js ITEMS code, by the sheet it opens.
var ON_DEMAND_CODES = {odBattery: 'battery', odBluetooth: 'bt', odQuiet: 'qt', odSleep: 'snooze',
    alertRain: 'rain', alertGust: 'gust', alertUv: 'uv', alertAqi: 'aqi', alertPollen: 'pollen',
    alertWind: 'wind'};
/**
 * The Alerts tab's item rows, under the About alerts card: System info (Battery,
 * Bluetooth, Quiet time and Sleep) and Weather alerts (Rain, then the five metric alerts),
 * every row opening its item's sheet, which leads with where the item shows (its Shows on
 * grid). Every row prints its item's live state. Each sub-header opens a card of its own
 * (engine.js splits the section at it), so each group is one card.
 * @returns {Object[]} The section's items, in order.
 */
function onDemandCardItems() {
    // Every row's summary ends on where its alert shows ("Watch bar, left"), or reads
    // "Not in any status bar" (dimmed) — alerts-page.js appends it to each resolver's text.
    return [
        {type: 'subheader', text: 'System info'},
        onDemandSheetRow('odBattery', 'Battery', 'battery', null,
            {resolver: 'onDemandBatteryText'}, null),
        onDemandSheetRow('odBluetooth', 'Bluetooth', 'bluetooth', null,
            {resolver: 'onDemandBluetoothText'}, null),
        // Quiet time and Sleep have no settings of their own; their sheets place them
        // (the owner, 2026-10-02: "you need a sheet for them then too").
        onDemandSheetRow('odQuiet', 'Quiet time', 'quiet', null,
            {resolver: 'onDemandPlainText', args: {code: 'qt', text: 'While Quiet Time is on'}}, null),
        onDemandSheetRow('odSleep', 'Sleep', 'snooze', null,
            {resolver: 'onDemandSleepText'}, null),
        {type: 'subheader', text: 'Weather alerts'},
        onDemandSheetRow('alertRain', 'Rain', 'rain', null,
            {resolver: 'rainAlertHint', args: {windows: RAIN_WINDOW_OPTIONS, looks: RAIN_LOOK_OPTIONS}}, null)
    ].concat(ALERT_KINDS.map(function (k) {
        return onDemandSheetRow('alert' + k.keyStem, k.label, k.icon, k.gate || null,
            {resolver: 'alertLevelsHint', args: {keyStem: k.keyStem, days: ALERT_DAYS_OPTIONS}},
            {resolver: 'alertLevelBadge', args: {keyStem: k.keyStem}});
    }));
}
// The About alerts card's intro (the owner's wording, 2026-10-01; its last sentence the
// owner's of 2026-10-02): when an alert shows, then examples, then where they are placed
// (each item's sheet opens on its Shows on grid), with the card's reset (the items'
// settings and where each shows; blocks.js resetOnDemand). Its second paragraph (the
// owner, 2026-10-04) carries the warn level onto the graph: a wind, gust or UV line's
// Visible values: Alert (forecast-lines-schema.js), set in the Graphs tab's metric dialogs.
var ON_DEMAND_INTRO = 'An alert shows at the edge of a status bar only when it reaches its warn level or is '
    + 'active right now, and stays hidden the rest of the time, so the watchface only shows what matters. '
    + 'For example: the battery low, Bluetooth disconnected, rain coming, a UV or wind forecast at its warn '
    + 'level. Open an alert to choose which status bars show it, left or right.'
    + '<p class="intro-more">The warn level works on the graph too: set a wind, gust or UV line’s Visible '
    + 'values to Alert (' + tabLink('graphs', 'Graphs › Forecast', 'forecast') + ') and it shows only the hours that '
    + 'reach it, so the graph stays empty until it matters.</p>';
/**
 * The Alerts tab's cards: About alerts (the intro behind its '?', the card's reset — the
 * items' settings and where each shows, blocks.js resetOnDemand — and the note while the
 * Default view shows no bar with Alerts on it), then the rows (onDemandCardItems), each
 * subheader a card of its own (System info, Weather alerts). They store nothing; the rows
 * open the sheets sheetSections builds.
 * @returns {Object[]} Schema sections.
 */
function cardSections() {
    return [{
        id: 'onDemand',
        title: 'About alerts',
        showWhen: ON_DEMAND_WHEN,
        intro: ON_DEMAND_INTRO,
        items: [linkRow('resetOnDemand', 'Reset alert settings to defaults'), {
            // The Default view the watch runs has no Watch Status Bar and none of the bars
            // it does show carries an item, so no item is drawn there (settings/
            // when-resolvers.js defaultViewLacksOnDemand). Nothing moves the items for the
            // user: the note names the gap and the fix.
            type: 'staticText',
            style: 'info',
            text: 'Your Default view has no Watch Status Bar, so Alerts won’t show there. Open an alert and, '
                + 'under Shows on, pick another status bar that view shows.',
            showWhen: {when: 'defaultViewLacksOnDemand'}
        }]
    }, {
        // System info, then Weather alerts: each subheader opens a card of its own.
        id: 'onDemandItems',
        showWhen: ON_DEMAND_WHEN,
        items: onDemandCardItems()
    }];
}
/**
 * The sections behind the card's rows, in the card's order: the eight side lists' hidden
 * items (onDemandListsSection), then one sheet per item: Battery, Bluetooth, Quiet time,
 * Sleep, Rain, then one per metric alert kind (ALERT_KINDS) holding its Shows on grid,
 * levels, Look and Days (the levels' one home). schema.js ends the Alerts tab's section
 * list with them, after the cards (cardSections).
 * @returns {Object[]} Schema sections (sheetOnly).
 */
function sheetSections() {
    return [onDemandListsSection(), batterySheet(), bluetoothSheet(),
        placementSheet('odQuiet', 'Quiet time', 'qt',
            'Shows the quiet time icon at the edge of a status bar while Quiet Time is on.'),
        placementSheet('odSleep', 'Sleep', 'snooze',
            'Shows the sleep icon at the edge of a status bar during the Battery saver hours (Watchface › Theme & night).'),
        rainAlertSheet()].concat(ALERT_KINDS.map(function (k) {
        return alertSheet(k.keyStem, k.title, k.subject, k.iconName, k.hint || '', k.coda || '', k.why);
    }));
}

module.exports = {
    ALERT_KINDS: ALERT_KINDS,
    ALERT_DAYS_OPTIONS: ALERT_DAYS_OPTIONS,
    BT_ICON_OPTIONS: BT_ICON_OPTIONS,
    alertCodeOf: alertCodeOf,
    onDemandPlacedWhen: onDemandPlacedWhen,
    onDemandRow: onDemandRow,
    rainAlertUnshownNote: rainAlertUnshownNote,
    cardSections: cardSections,
    sheetSections: sheetSections
};

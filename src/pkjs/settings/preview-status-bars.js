// src/pkjs/settings/preview-status-bars.js — ES5, WebView (+ Node for tests). The Status
// bars tab's pinned preview (block 'statusBarsPreview'): every bar the watch draws right
// now, one line each, its three slots as sample values — left, middle and right — so a
// slot pick shows where it lands before the main Save. Also pinned above every slot dialog.
//
// The values are SAMPLES (a fixed afternoon: 18°, gusts 20/45, UV 3 …), shaped by the
// settings that change how a slot prints (Temp / Feels / Both, the day-max pairs, the
// units); the watch draws the real ones with its own icons. Which item a slot holds is
// the catalog's own resolution (status-line-catalog.js resolveSelection — defaults and
// availability included), and which bars exist is on-demand.js barExists, the rule the
// Status bars tab gates its cards by.
/* global PConf */
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var catalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var onDemand = (typeof require !== 'undefined')
        ? require('../on-demand.js') : window.OnDemand;
    var esc = (typeof require !== 'undefined')
        ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    var previewInk = ((typeof require !== 'undefined')
        ? require('./preview-svg.js') : window.PreviewSvg).previewInk;

    // The bars in the page's order, their slot-key prefixes and names.
    var BARS = [
        {bar: 'top', prefix: 'statusTop', name: 'Watch'},
        {bar: 'forecast', prefix: 'statusForecast', name: 'Forecast'},
        {bar: 'health', prefix: 'statusHealth', name: 'Health'},
        {bar: 'radar', prefix: 'statusRadar', name: 'Radar'}
    ];
    var POSITIONS = [['Left', 'left'], ['Mid', 'mid'], ['Right', 'right']];

    /**
     * A day-max kind's sample as its Value selection prints it: the reading, the day's
     * peak, or both in the Order picked ('20/45').
     * @param {Object} S Settings.
     * @param {string} prefix 'uv' | 'wind' | 'gust' | 'aqi'.
     * @param {string} now The sample reading.
     * @param {string} max The sample peak.
     * @returns {string} The text.
     */
    function dayMax(S, prefix, now, max) {
        var mode = S[prefix + 'SlotDisplay'];
        if (mode === 'max') { return max; }
        if (mode !== 'both') { return now; }
        return S[prefix + 'SlotOrder'] === 'max' ? max + '/' + now : now + '/' + max;
    }

    /**
     * A wind speed's unit label, while the slot prints its unit.
     * @param {Object} S Settings.
     * @param {string} key The kind's Show unit key.
     * @returns {string} ' kph' | ' mph' | ' kn' | ''.
     */
    function windUnit(S, key) {
        if (S[key] === false) { return ''; }
        return S.windUnits === 'mph' ? ' mph' : S.windUnits === 'knots' ? ' kn' : ' kph';
    }

    /**
     * One slot's sample text.
     * @param {string} code The catalog item the slot shows.
     * @param {Object} S Settings.
     * @returns {string} Plain text ('' for an empty slot).
     */
    function sample(code, S) {
        var deg = function (key, v) { return S[key] === true ? v + '°' : v; };
        switch (code) {
        case 'temp':
            if (S.tempSlotDisplay === 'feels') { return deg('tempSlotUnit', '16'); }
            if (S.tempSlotDisplay === 'both') {
                return S.tempSlotOrder === 'feels' ? '16|18' : '18|16';
            }
            return deg('tempSlotUnit', '18');
        case 'wind': return dayMax(S, 'wind', '12', '30') + windUnit(S, 'windSlotUnit');
        case 'gust': return dayMax(S, 'gust', '20', '45') + windUnit(S, 'gustSlotUnit');
        case 'uv': return 'UV ' + dayMax(S, 'uv', '3', '7');
        case 'aqi': return 'AQI ' + dayMax(S, 'aqi', '42', '58');
        case 'pollen': return 'Pollen 1';
        case 'pressure': return S.pressureSlotUnit === false ? '1013' : '1013hPa';
        case 'dew': return deg('dewSlotUnit', '9');
        case 'sun': return '19:14';
        case 'date': return 'Thu 2';
        case 'week': return 'W40';
        case 'city': return 'Berlin';
        case 'countdown': return S.countdownSlotUnit === false ? '5' : '5d';
        case 'steps': return '6,214';
        case 'distance': return S.distanceUnits === 'imperial' ? '2.6 mi' : '4.2 km';
        case 'hr': return '64';
        case 'sleep': return '7h 12m';
        case 'battery': return '80%';
        case 'batteryPct': return '80%';
        case 'phoneBattery': return '72%';
        case 'phoneBatteryPlain': return '72%';
        default: return '';
        }
    }

    /**
     * The block: one row per bar the watch draws now, its name and three sample slots.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} HTML ('' when no bar exists).
     */
    function statusBarsPreview(S, env) {
        var st = S || {}, rows = '';
        BARS.forEach(function (b) {
            if ((b.bar === 'radar' || b.bar === 'health') && !onDemand.barExists(st, b.bar, env)) { return; }
            var cells = POSITIONS.map(function (p) {
                var key = b.prefix + p[0];
                var code = catalog.resolveSelection(st[key], st, env, {slotKey: key, position: p[1]});
                return '<span class="sbp-v sbp-' + p[1] + '">' + esc(sample(code, st)) + '</span>';
            }).join('');
            rows += '<div class="sbp-row"><span class="sbp-n">' + esc(b.name) + '</span>' + cells + '</div>';
        });
        if (!rows) { return ''; }
        ensureStyle();
        // The watch draws the bars in its theme's ink (status_row.c: theme_fg() on the
        // theme's background), so a light theme previews black on white.
        var ink = previewInk(st.theme);
        return '<div class="sbp" role="img" aria-label="Status bars preview" style="--sbp-bg:' + ink.bg
            + ';--sbp-fg:' + ink.fg + ';--sbp-dim:' + ink.rgba('0.5') + ';--sbp-line:' + ink.rgba('0.12') + '">'
            + rows + '</div>';
    }

    // The preview's look, injected once: the watch's screen in its theme's ink (the
    // --sbp-* properties the block sets inline; the dark theme's as the fallback), rows
    // split by a hairline.
    // It sits in a pinned frame that carries a preview's padding (shell.html .pin-blk),
    // which the negative margins cancel, as a preview SVG's do (preview-svg.js svgFrame).
    var CSS = '.sbp{background:#000;background:var(--sbp-bg,#000);padding:4px 12px;margin:-12px -16px -14px}'
        + '.sbp-row{display:grid;grid-template-columns:70px 1fr 1fr 1fr;align-items:center;padding:7px 0;'
        + 'border-top:1px solid #1C1C1E;border-top-color:var(--sbp-line,#1C1C1E)}'
        + '.sbp-row:first-child{border-top:none}'
        + '.sbp-n{font:700 10.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7C808A;'
        + 'color:var(--sbp-dim,#7C808A)}'
        + '.sbp-v{font:700 14px Inter,sans-serif;color:#FFFFFF;color:var(--sbp-fg,#FFFFFF);white-space:nowrap;'
        + 'overflow:hidden;text-overflow:ellipsis}'
        + '.sbp-left{text-align:left}.sbp-mid{text-align:center}.sbp-right{text-align:right}';
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('sbp-style')) { return; }
        var el = document.createElement('style');
        el.id = 'sbp-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    if (PConf && PConf.blocks) { PConf.blocks.register('statusBarsPreview', statusBarsPreview); }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {statusBarsPreview: statusBarsPreview, sample: sample};
    }
})();

// src/pkjs/settings/notices-panel.js — config UI (phone webview) + Node-testable.
//
// Renders the General-tab alert panel from the phone-injected notice list
// (USERDATA.notices; see ../notices.js). A scrollable, fixed-max-height list
// differentiating error vs info, with a single "Understood" button that flips the
// transient fetchNoticeAck flag (the devStatsClear pattern) — PKJS reads it on
// webviewclosed to dismiss the notices. Pure renderNoticesPanelHtml is exported
// for tests; the block registration is guarded like reset-status-defaults.js.
/* global PConf */
(function () {
    /**
     * @param {string} s Raw text.
     * @returns {string} HTML-escaped text.
     */
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Relative "since" label from a timestamp.
     * @param {number} since ms epoch.
     * @param {number} now ms epoch (Date.now()).
     * @returns {string} e.g. "2h ago", "just now".
     */
    function sinceLabel(since, now) {
        var secs = Math.max(0, Math.floor((now - since) / 1000));
        if (secs < 60) { return 'just now'; }
        var mins = Math.floor(secs / 60);
        if (mins < 60) { return mins + 'm ago'; }
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) { return hrs + 'h ago'; }
        return Math.floor(hrs / 24) + 'd ago';
    }

    /**
     * Build the panel HTML from a notice list. Empty list → '' (block renders
     * nothing). Notice `html` is authored phone-side (trusted markup); `since`
     * label and type class are escaped/fixed.
     * @param {Array<{type: string, html: string, since: number}>|null} list Notices.
     * @param {number} [now] Timestamp for since labels (defaults to Date.now()).
     * @returns {string} Panel HTML, or ''.
     */
    function renderNoticesPanelHtml(list, now) {
        if (!list || !list.length) { return ''; }
        var t = (typeof now === 'number') ? now : Date.now();
        var rows = '';
        for (var i = 0; i < list.length; i++) {
            var n = list[i];
            var cls = n.type === 'error' ? 'error' : 'info';
            rows += '<div class="notice-item ' + cls + '">'
                + '<div class="notice-body">' + (n.html || '') + '</div>'
                + '<div class="notice-since">' + esc(sinceLabel(n.since || t, t)) + '</div>'
                + '</div>';
        }
        return '<div class="notice-panel">'
            + '<div class="notice-list">' + rows + '</div>'
            + '<button type="button" class="notice-ack" data-k="fetchNoticeAck" data-toggle="1">Understood</button>'
            + '</div>';
    }

    // Scoped styles injected once; scroll + fixed max-height + type differentiation.
    var NOTICE_CSS =
        '.notice-panel{border:1px solid #FF6A52;border-radius:8px;padding:8px;margin:4px 0}'
        + '.notice-list{max-height:180px;overflow-y:auto}'
        + '.notice-item{padding:6px 8px;border-radius:6px;margin-bottom:6px}'
        + '.notice-item.error{background:rgba(255,106,82,0.12);border-left:3px solid #FF6A52}'
        + '.notice-item.info{background:rgba(90,140,255,0.12);border-left:3px solid #5A8CFF}'
        + '.notice-since{font-size:11px;opacity:0.6;margin-top:2px}'
        + '.notice-ack{margin-top:6px;width:100%}';

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;

    if (PConf && PConf.blocks && typeof PConf.blocks.register === 'function') {
        var stylesInjected = false;
        PConf.blocks.register('noticesPanel', function (S, ENV, USERDATA) {
            // Hidden once acknowledged this session (the toggle flips fetchNoticeAck).
            if (S && S.fetchNoticeAck) { return ''; }
            var list = [];
            try {
                list = JSON.parse((USERDATA && USERDATA.notices) || '[]') || [];
            } catch (ex) { list = []; }
            var html = renderNoticesPanelHtml(list);
            if (html && !stylesInjected && typeof document !== 'undefined') {
                var style = document.createElement('style');
                style.appendChild(document.createTextNode(NOTICE_CSS));
                document.head.appendChild(style);
                stylesInjected = true;
            }
            return html;
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { renderNoticesPanelHtml: renderNoticesPanelHtml, sinceLabel: sinceLabel };
    }
}());

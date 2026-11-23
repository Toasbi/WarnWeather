// src/pkjs/page/notices/notices-panel.js — config UI (phone webview) + Node-testable.
//
// Renders the General-tab alert panel from the phone-injected notice list
// (USERDATA.notices; see ../notices.js). A scrollable, fixed-max-height list with a
// single "Understood" button that flips the transient fetchNoticeAck flag (the
// devStatsClear pattern) — PKJS reads it on webviewclosed to dismiss the notices. The
// card is the note: an error note while any notice is an error, else an info note (its
// section's styleFrom, noticesCardStyle; shell.html .card.error / .card.info). In an error
// note an info notice keeps a mark of its own. Pure renderNoticesPanelHtml is exported for
// tests; the block registration is guarded like reset-status-defaults.js. The display
// resolver reads the page's userData (INJECTED_USERDATA) at call time, as the page's other
// resolvers do (Node tests set global.INJECTED_USERDATA).
/* global PConf, INJECTED_USERDATA */
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
            + '<button type="button" class="txt-act-btn notice-ack" data-k="fetchNoticeAck" data-toggle="1">Understood</button>'
            + '</div>';
    }

    /**
     * Build the panel HTML for the config engine: '' when acknowledged this
     * session or when there are no notices, else the rendered list.
     * @param {Object} S engine settings state
     * @param {Object} USERDATA injected userData ({notices: JSON string})
     * @returns {string} panel HTML or ''
     */
    function buildNoticesPanel(S, USERDATA) {
        if (S && S.fetchNoticeAck) { return ''; }
        return renderNoticesPanelHtml(noticesOf(USERDATA));
    }

    // The list parsed last and the text it came from: the block and the card's look read
    // the same list in a render, and it does not change while the page is open.
    var parsedFrom = null;
    var parsed = [];

    /**
     * @param {Object} USERDATA Injected userData ({notices: JSON string}).
     * @returns {Array<Object>} The notices it lists; [] for none or a malformed list.
     */
    function noticesOf(USERDATA) {
        var raw = (USERDATA && USERDATA.notices) || '[]';
        var list;
        if (raw === parsedFrom) { return parsed; }
        try {
            list = JSON.parse(raw);
        } catch (ex) { list = null; }
        parsedFrom = raw;
        parsed = Object.prototype.toString.call(list) === '[object Array]' ? list : [];
        return parsed;
    }

    /**
     * The card's look (its section's styleFrom, a display resolver): an error note while any
     * notice is an error, else an info note.
     * @returns {string} 'error' or 'info'.
     */
    function noticesCardStyle() {
        var userData = typeof INJECTED_USERDATA !== 'undefined' ? INJECTED_USERDATA : null;
        return noticesOf(userData).some(function (n) { return n && n.type === 'error'; }) ? 'error' : 'info';
    }

    // Scoped styles injected once: the list scrolls past a fixed height. The card is the note
    // (shell.html .card.error / .card.info), so the notices sit on it with no box of their
    // own, the note's soft line between them; in an error note an info notice keeps the info
    // amber's rule beside it. Understood is the page's neutral button (.txt-act-btn), the
    // card's width.
    var NOTICE_CSS =
        '.notice-list{max-height:180px;overflow-y:auto}'
        + '.notice-item{padding:4px 0 10px;font-size:13.5px;line-height:1.5}'
        + '.notice-item+.notice-item{border-top:1px solid var(--note-line-soft);padding-top:10px}'
        + '.card.error .notice-item.info{border-left:3px solid var(--info-rule);padding-left:9px}'
        + '.notice-since{font-size:11.5px;opacity:.75;margin-top:2px}'
        + '.notice-panel .notice-ack{display:block;width:100%;margin-top:8px;padding:9px 14px}';

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;

    if (PConf && PConf.blocks && typeof PConf.blocks.register === 'function') {
        var stylesInjected = false;
        if (PConf.displayResolvers) { PConf.displayResolvers.register('noticesCardStyle', noticesCardStyle); }
        PConf.blocks.register('noticesPanel', function (S, ENV, USERDATA) {
            var html = buildNoticesPanel(S, USERDATA);
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
        module.exports = {
            renderNoticesPanelHtml: renderNoticesPanelHtml,
            sinceLabel: sinceLabel,
            buildNoticesPanel: buildNoticesPanel,
            noticesCardStyle: noticesCardStyle,
            NOTICE_CSS: NOTICE_CSS
        };
    }
}());

// src/pkjs/page/notices/feature-tips-panel.js — config UI (phone webview) + Node-testable.
//
// The card of new features to try, first on the tab the page opens on: one entry per tip
// the phone hands over (USERDATA.featureTips; notices/domain/feature-tips.js), each with
// how to switch it on and a Show me button beside its title that opens the dialog or the
// tab it is set in (the engine's [data-edit-sheet] and [data-goto-tab] paths). The card is
// an info note (its section's style, shell.html .card.info). Got it flips the transient
// featureTipsAck flag, the notices panel's pattern: the card goes, and PKJS marks the tips
// seen when the page is saved. The pure renderFeatureTipsHtml is exported for tests; the
// block registration is guarded like notices-panel.js'.
(function () {
    var NODE = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var esc = NODE ? require('../../config-ui/lib/html.js').esc : PConf.html.esc;

    /**
     * A tip's Show me button: it opens the tip's dialog, or brings its tab to the front.
     * None for a tip that names neither.
     * @param {{sheet: ?string, tab: ?string}} tip The tip.
     * @returns {string} HTML, or ''.
     */
    function showMeHtml(tip) {
        var target = tip.sheet ? 'data-edit-sheet="' + esc(tip.sheet) + '"'
            : tip.tab ? 'data-goto-tab="' + esc(tip.tab) + '"' : '';
        if (!target) { return ''; }
        return '<button type="button" class="txt-act-btn" ' + target + '>Show me</button>';
    }

    /**
     * Build the card from the tips. Titles are escaped; a tip's `html` is authored
     * phone-side (trusted markup, like a notice's).
     * @param {?Array<{id: string, title: string, html: string, sheet: ?string, tab: ?string}>} tips
     *   The tips to show.
     * @returns {string} The card's HTML, or '' for none.
     */
    function renderFeatureTipsHtml(tips) {
        if (!tips || !tips.length) { return ''; }
        var rows = '';
        for (var i = 0; i < tips.length; i++) {
            var tip = tips[i];
            rows += '<div class="tip">'
                + '<div class="tip-head"><div class="tip-ttl">' + esc(tip.title) + '</div>' + showMeHtml(tip) + '</div>'
                + '<div class="tip-body">' + (tip.html || '') + '</div>'
                + '</div>';
        }
        return '<div class="tips">'
            + '<div class="tips-hdr">New in this update</div>'
            + '<div class="tips-list">' + rows + '</div>'
            + '<button type="button" class="txt-act-btn tips-ack" data-k="featureTipsAck" data-toggle="1">Got it</button>'
            + '</div>';
    }

    /**
     * The card for the config engine: '' once Got it was tapped this session or when the
     * phone handed over no tips, else the rendered card.
     * @param {Object} S Engine settings state.
     * @param {Object} USERDATA Injected userData ({featureTips: ?Array}).
     * @returns {string} The card's HTML or ''.
     */
    function buildFeatureTips(S, USERDATA) {
        if (S && S.featureTipsAck) { return ''; }
        var tips = USERDATA && USERDATA.featureTips;
        return renderFeatureTipsHtml(Object.prototype.toString.call(tips) === '[object Array]' ? tips : null);
    }

    // Scoped styles, injected once. The card is the note (shell.html .card.info), so the tips
    // sit on it with no box of their own: the header and the lines between the tips in the
    // info colours, each Show me beside its tip's title. The buttons are the page's neutral
    // ones (shell.html .txt-act-btn), at a card's size.
    var TIPS_CSS =
        '.tips-hdr{font:700 11px \'Inter\',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--info-rule);margin:2px 0 4px}'
        + '.tip{padding:8px 0 10px}'
        + '.tip+.tip{border-top:1px solid var(--info-line-soft);padding-top:12px}'
        + '.tip-head{display:flex;align-items:center}'
        + '.tip-ttl{flex:1;min-width:0;font-weight:700;font-size:15px;color:var(--lbl)}'
        + '.tip-head .txt-act-btn{flex:none;margin-left:12px;padding:6px 12px;font-size:13px}'
        + '.tip-body{font-size:13.5px;line-height:1.5;margin:4px 0 0}'
        + '.tip-body a{color:var(--link)}'
        + '.tips .tips-ack{display:block;width:100%;margin-top:6px;padding:8px 14px}';

    if (PConf && PConf.blocks && typeof PConf.blocks.register === 'function') {
        var stylesInjected = false;
        PConf.blocks.register('featureTips', function (S, ENV, USERDATA) {
            var html = buildFeatureTips(S, USERDATA);
            if (html && !stylesInjected && typeof document !== 'undefined') {
                var style = document.createElement('style');
                style.appendChild(document.createTextNode(TIPS_CSS));
                document.head.appendChild(style);
                stylesInjected = true;
            }
            return html;
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            renderFeatureTipsHtml: renderFeatureTipsHtml,
            buildFeatureTips: buildFeatureTips,
            TIPS_CSS: TIPS_CSS
        };
    }
}());

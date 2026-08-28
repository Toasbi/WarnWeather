// src/pkjs/settings/support.js — config UI (phone webview) + Node-testable.
//
// "Support me" coffee mug in the settings header, right of the News bell, and
// the popup it opens. Same shape as news.js: pure render helpers exported for
// unit tests, webview wiring at the bottom guarded on PConf + document.
//
// The More → Links tab keeps the official BMC button badge; this file does NOT
// reuse bmc-badge.js, which schema.js bakes into the injected schema JSON and
// which is absent from the flat concatenated page.
(function () {
    var BMC_URL = 'https://buymeacoffee.com/toaster2';

    // A CSS transform on an SVG child is expressed in that element's USER
    // coordinate system, so the keyframes' translateY moves the wisps this many
    // viewBox UNITS, not pixels. The viewBox reserves headroom above them for
    // the whole rise (its negative min-y) or their tips clip every cycle — an
    // svg clips to its viewport. Exported so the tests can hold the drawing and
    // the animation to each other.
    var VIEW_BOX = '0 -4 24 28';
    var STEAM_RISE_UNITS = 3;
    var STEAM_STROKE = 1.5;
    var STEAM_PATHS = [
        'M9 4c1.3-1.1-1.3-2.2 0-3.3',
        'M13 4.3c1.3-1.1-1.3-2.2 0-3.3'
    ];

    /**
     * Render the mug: cup, handle, base, and the steam wisps the CSS animation
     * targets. Carries no label of its own.
     *
     * @returns {string} SVG markup.
     */
    function renderCoffeeSvgHtml() {
        var i, html = '<svg class="bmc-cup" viewBox="' + VIEW_BOX
            + '" aria-hidden="true" focusable="false">'
            + '<path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5'
            +   'v6.5a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z"/>'
            + '<path d="M18 9.5h1a2.5 2.5 0 0 1 0 5h-1"/>'
            + '<path d="M3 22h16"/>'
            + '<g class="bmc-steam">';
        for (i = 0; i < STEAM_PATHS.length; i += 1) {
            html += '<path d="' + STEAM_PATHS[i] + '"/>';
        }
        return html + '</g></svg>';
    }

    /**
     * Render the accessible contents of the icon-only header button.
     *
     * @returns {string} Mug markup behind a screen-reader label.
     */
    function renderCoffeeIconHtml() {
        return '<span class="sr-only">Support me</span>' + renderCoffeeSvgHtml();
    }

    /**
     * Render the popup's inner HTML. All copy is authored here, so the only
     * escaping needed is the literal "<3".
     *
     * @returns {string} Modal HTML.
     */
    function renderSupportModalHtml() {
        return '<div class="bmc-modal-hdr"><h2>Support me</h2>'
            + '<button class="bmc-close" data-bmc-close="1" aria-label="Close">✕</button></div>'
            + '<div class="bmc-body">'
            + '<p>Thank you for using my watchface WarnWeather - it means a lot to me! '
            + 'If you want to support me, you can send me a cup of coffee through '
            // No target="_blank": a plain Android WebView with no onCreateWindow
            // hook discards _blank navigations, leaving the link inert on a phone.
            + 'this link: <a href="' + BMC_URL + '">' + BMC_URL + '</a></p>'
            + '<p>Besides making me very thankful, you also help me cover the API costs.</p>'
            + '<p class="bmc-signoff">Thank you &lt;3<br>'
            + 'Caffeinated greetings from Berlin,<br>Tobi</p>'
            + '</div>';
    }

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;

    if (PConf && typeof document !== 'undefined') {
        var supportOverlay = null;

        var injectSupportStyles = function () {
            var css = ''
                + '.bmc-hdr-left { display: flex; align-items: center; }'
                // 0.65 is news.js's #newsHint.muted — the mug has no unread state
                // to announce, so it holds the bell's resting grey permanently.
                + '#bmcHint { box-sizing: border-box; width: 23px; height: 23px; margin: 0 0 0 10px;'
                +   ' padding: 0; border: none; background: none; color: var(--fg);'
                +   ' line-height: 1; cursor: pointer; opacity: 0.65; }'
                // All three numbers follow from the 23px width (a 23/24 scale on
                // the viewBox) and have to be re-derived together if it changes:
                // 26.8px keeps the 24×28 ratio; -6.2px lifts the taller-than-the-
                // bell svg so the CUP's ink centres level with the bell instead of
                // hanging low (the steam floats into the header's top padding,
                // which nothing clips); 1.75 renders the same 1.67px stroke the
                // bell's width-2-at-20px does, so both icons carry equal ink.
                + '#bmcHint .bmc-cup { position: relative; top: -6.2px;'
                +   ' width: 23px; height: 26.8px; stroke-width: 1.75; }'
                + '.bmc-cup { display: block; fill: none; stroke: currentColor; stroke-width: 2;'
                +   ' stroke-linecap: round; stroke-linejoin: round; }'
                // translateY only, no scale: that needs no transform-box, which
                // old Android WebViews lack. Where CSS transforms on SVG children
                // are unsupported outright, the opacity half still reads as steam.
                + '.bmc-steam path { stroke-width: ' + STEAM_STROKE + '; opacity: 0.8;'
                +   ' animation: bmc-steam-rise 3.2s ease-in-out infinite; }'
                + '.bmc-steam path:nth-child(2) { animation-delay: 1.6s; }'
                + '@keyframes bmc-steam-rise {'
                +   ' 0% { opacity: 0; transform: translateY(1px); }'
                +   ' 30% { opacity: 0.95; }'
                +   ' 70% { opacity: 0.6; }'
                +   ' 100% { opacity: 0; transform: translateY(-' + STEAM_RISE_UNITS + 'px); } }'
                + '@media (prefers-reduced-motion: reduce) {'
                +   ' .bmc-steam path { animation: none; } }'
                + '.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;'
                +   ' overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }'
                + '.bmc-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 60;'
                +   ' background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }'
                + '.bmc-modal { background: var(--card); color: var(--fg); border: 1px solid var(--card-line);'
                +   ' border-radius: 14px; width: calc(100% - 32px); max-width: 420px; max-height: 80vh;'
                +   ' display: flex; flex-direction: column; overflow: hidden; }'
                + '.bmc-modal-hdr { flex: 0 0 auto; display: flex; align-items: center;'
                +   ' justify-content: space-between; padding: 4px 16px 0; }'
                + '.bmc-modal-hdr h2 { font-size: 17px; margin: 12px 0 4px; }'
                + '.bmc-close { border: none; background: none; color: var(--muted); font-size: 20px;'
                +   ' cursor: pointer; padding: 8px 0 0 8px; }'
                + '.bmc-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 16px 18px;'
                +   ' font-size: 13px; line-height: 1.5; }'
                + '.bmc-body p { margin: 0 0 14px; }'
                + '.bmc-body a { color: #FA4A35; text-decoration: underline;'
                +   ' overflow-wrap: break-word; }'
                + '.bmc-signoff { color: var(--muted); }';
            var style = document.createElement('style');
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        };

        var closeSupportPopup = function () {
            if (supportOverlay) { supportOverlay.style.display = 'none'; }
        };

        var injectOverlay = function () {
            supportOverlay = document.createElement('div');
            supportOverlay.className = 'bmc-overlay';
            supportOverlay.innerHTML = '<div class="bmc-modal">' + renderSupportModalHtml() + '</div>';
            supportOverlay.addEventListener('click', function (e) {
                if (e.target === supportOverlay || e.target.closest('[data-bmc-close]')) {
                    closeSupportPopup();
                }
            });
            document.body.appendChild(supportOverlay);
        };

        var openSupportPopup = function () {
            if (!supportOverlay) { injectOverlay(); }
            supportOverlay.style.display = 'flex';
        };

        var injectSupportPill = function () {
            var hdr = document.querySelector('.hdr');
            var saveBtn = document.getElementById('save');
            if (!hdr || !saveBtn) { return; }
            injectSupportStyles();
            var pill = document.createElement('button');
            pill.id = 'bmcHint';
            pill.type = 'button';
            pill.setAttribute('aria-label', 'Support me');
            pill.title = 'Support me';
            pill.innerHTML = renderCoffeeIconHtml();
            pill.onclick = openSupportPopup;
            // news.js runs first and builds this left group when the news feature
            // is configured; build an equivalent when it isn't, so the header's
            // space-between still keeps Save on the right.
            var left = hdr.querySelector('.news-hdr-left');
            if (!left) {
                var titleEl = hdr.querySelector('h1');
                if (!titleEl) {
                    hdr.insertBefore(pill, saveBtn);
                    return;
                }
                left = document.createElement('div');
                left.className = 'bmc-hdr-left';
                hdr.insertBefore(left, titleEl);
                left.appendChild(titleEl);
            }
            left.appendChild(pill);
        };

        injectSupportPill();
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            VIEW_BOX: VIEW_BOX,
            STEAM_RISE_UNITS: STEAM_RISE_UNITS,
            STEAM_STROKE: STEAM_STROKE,
            STEAM_PATHS: STEAM_PATHS,
            renderCoffeeSvgHtml: renderCoffeeSvgHtml,
            renderCoffeeIconHtml: renderCoffeeIconHtml,
            renderSupportModalHtml: renderSupportModalHtml
        };
    }
}());

// src/pkjs/page/settings/wizard/wizard-css.js — ES5, WebView. The setup wizard's styles and line icons
// (wizard.js injects CSS once, as <style id="wiz-style">). The app's CSS custom properties, so
// the wizard follows body.light; the brand red #FA4A35 and its gradient are hardcoded to match
// .hdr h1 / .saveBtn / .tab.on. Reads nothing.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, ahead of wizard.js), which has no require().
(function () {
    // Line icons, drawn in the text colour.
    var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    var ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var ICON_FLICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';
    var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" '
        + 'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    // Overlay styles.
    var ACCENT_FILL = 'linear-gradient(135deg,#FA4A35,#D93A24)';
    var FONT = 'Inter,-apple-system,system-ui,sans-serif';
    var WIZ_CSS =
        '#wizard{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;'
        + 'max-width:460px;margin:0 auto;background:var(--bg);color:var(--fg);font-family:' + FONT + '}'
        + '#wizard [hidden]{display:none!important}'
        // top bar: Back, the progress bar, and a spacer Back's width so the bar stays centred
        + '#wizard .wiz-top{flex:none;display:flex;align-items:center;padding:10px 12px 2px}'
        + '#wizard .wiz-back,#wizard .wiz-top-pad{flex:none;width:40px;height:40px}'
        + '#wizard .wiz-back{display:flex;align-items:center;justify-content:center;padding:0;border:none;'
        + 'border-radius:12px;background:transparent;color:var(--fg);cursor:pointer}'
        + '#wizard .wiz-back svg{width:22px;height:22px}'
        + '#wizard .wiz-back:active{background:var(--ctl)}'
        + '#wizard .wiz-progress{flex:1;display:flex;margin:0 6px}'
        + '#wizard .wiz-seg{flex:1;height:4px;margin:0 2px;border-radius:2px;background:var(--ctl-line);'
        + 'transition:background .25s}'
        + '#wizard .wiz-seg.done,#wizard .wiz-seg.on{background:#FA4A35}'
        // the step
        + '#wizard .wiz-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 20px 22px}'
        + '#wizard .wiz-step{animation:wiz-in-r .32s cubic-bezier(.2,.7,.3,1) both}'
        + '#wizard .wiz-step.back{animation-name:wiz-in-l}#wizard .wiz-step.still{animation:none}'
        + '#wizard .wiz-title{margin:8px 0 8px;font:800 25px/1.2 ' + FONT + ';letter-spacing:-.02em;color:var(--fg);'
        + 'outline:none}'
        + '#wizard .wiz-lead{margin:0 0 6px;font-size:15px;line-height:1.55;color:var(--muted)}'
        + '#wizard p{line-height:1.55}#wizard a{color:var(--link)}'
        // the watch, on a soft red glow: a card of its real screenshot in the frame every screen
        // picture shares (screen-frame.js, as on the Watchface tab), a margin of the screen's own
        // black or white all round, so the card's corners clip only that margin
        + '#wizard .wiz-stage{display:flex;justify-content:center;padding:14px 0 8px;'
        + 'background:radial-gradient(closest-side,rgba(250,74,53,.2),rgba(250,74,53,0))}'
        + '#wizard .wiz-watch{display:inline-block;border-radius:20px;overflow:hidden;'
        + 'box-shadow:0 14px 34px rgba(0,0,0,.45),0 0 0 1px var(--card-line)}'
        + 'body.light #wizard .wiz-watch{box-shadow:0 12px 28px rgba(0,0,0,.24),0 0 0 1px var(--card-line)}'
        // The frame is the screen plus its margin (162 px wide for a 144 px screen, 224 for emery's
        // 200, #wizard.w200), and the screen is never drawn smaller than it is, so its text stays
        // on whole pixels. So each width below is the screen's width x 1.125 (emery 1.12): its own
        // size, or 252 px (emery 260) on the big stage.
        + '#wizard .wiz-scr{display:block;width:162px;height:auto}'
        + '#wizard.w200 .wiz-scr{width:224px}'
        + '#wizard .wiz-stage.big .wiz-scr{width:283.5px;width:min(69.75vw,283.5px)}'
        + '#wizard.w200 .wiz-stage.big .wiz-scr{width:291px;width:min(85vw,291px)}'
        // a pick redraws the picker's screen: the old one fades out, the new one in (wizard.js swapPicture)
        + '#wizard [data-wiz-watch] .wiz-scr{transition:opacity .16s}'
        + '#wizard [data-wiz-watch] .wiz-scr.fade{opacity:0}'
        // the options: a segmented control under the watch (a radio group), one row whatever the count;
        // a long label wraps inside its own segment
        + '#wizard .wiz-opts{display:flex;margin:16px 0 0;padding:4px;border:1px solid var(--ctl-line);'
        + 'border-radius:14px;background:var(--ctl)}'
        + '#wizard .wiz-opt{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;'
        + 'min-height:44px;padding:6px 8px;border:none;border-radius:10px;background:transparent;color:var(--muted);'
        + 'font:600 13.5px/1.25 ' + FONT + ';text-align:center;cursor:pointer;'
        + 'transition:background .15s,color .15s,box-shadow .15s}'
        + '#wizard .wiz-opt+.wiz-opt{margin-left:4px}'
        + '#wizard .wiz-opt.on{background:' + ACCENT_FILL + ';color:#FFFFFF;box-shadow:0 3px 10px rgba(250,74,53,.35)}'
        + '#wizard .wiz-desc{min-height:3.1em;margin:12px 0 0;text-align:center;font-size:14.5px;line-height:1.5;'
        + 'color:var(--fg)}'
        // the forecast step: the settings page's own graph preview, drawn live from sample weather, as a
        // rounded card of it in the screen pictures' frame (a margin of its own ground, so the corners
        // clip none of it), and the second picker's heading. The preview draws one frame height for
        // every look (wizard-forecast.js FRAME_H), so a look never moves the controls under it.
        + '#wizard .wiz-graph-scr{display:block;width:100%;height:auto}'
        + '#wizard .wiz-graph{width:100%;max-width:380px;border-radius:18px;overflow:hidden;'
        + 'box-shadow:0 14px 34px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)}'
        + 'body.light #wizard .wiz-graph{box-shadow:0 12px 28px rgba(0,0,0,.24),0 0 0 1px rgba(0,0,0,.08)}'
        + '#wizard .wiz-graph svg,#wizard .wiz-look svg{animation:wiz-fade .22s ease both}'
        + '#wizard .wiz-sub{margin:26px 0 0;text-align:center}'
        + '#wizard .wiz-sub+.wiz-opts{margin-top:10px}'
        + '#wizard button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}'
        // cards: the country on the welcome step, the layout legend, the summary, the upsell
        + '#wizard .wiz-card,#wizard .wiz-legend,#wizard .wiz-sum,#wizard .wiz-tio{margin:18px 0 0;'
        + 'border:1px solid var(--card-line);border-radius:16px;background:var(--card);overflow:hidden}'
        // the small-caps headings: a card's, and a step's second picker's (wiz-sub)
        + '#wizard .wiz-card-hd,#wizard .wiz-sub{font:800 11.5px ' + FONT + ';letter-spacing:.1em;'
        + 'text-transform:uppercase;color:var(--ttl)}'
        + '#wizard .wiz-card-hd{padding:14px 16px 0}'
        + '#wizard .wiz-note{margin:0;padding:10px 16px 14px;font-size:13px;line-height:1.5;color:var(--hint)}'
        + '#wizard .wiz-legend{padding:2px 16px}'
        + '#wizard .wiz-legend p{margin:12px 0;font-size:13.5px;color:var(--muted)}'
        + '#wizard .wiz-legend b{color:var(--fg)}'
        // the Screens step: the screen shown, big, its dots and name, Try a flick
        + '#wizard .wiz-flick{text-align:center}'
        + '#wizard .wiz-flick-watch{display:inline-block;transform-origin:50% 100%}'
        + '#wizard .wiz-flick-watch[data-wiz-flick]{cursor:pointer}'
        + '#wizard .wiz-flick-watch.tilt{animation:wiz-tilt .45s ease-in-out}'
        + '#wizard .wiz-flick-track{display:flex;align-items:center;justify-content:center;margin:12px 0 0}'
        + '#wizard .wiz-dot{display:inline-block;width:7px;height:7px;margin:0 3px;border-radius:50%;'
        + 'background:var(--muted);opacity:.35;vertical-align:middle;transition:opacity .2s,background .2s}'
        + '#wizard .wiz-dot.on{background:#FA4A35;opacity:1}'
        + '#wizard .wiz-flick-label{margin-left:8px;font:700 13px ' + FONT + '}'
        + '#wizard .wiz-try{display:inline-flex;align-items:center;min-height:44px;margin:14px 0 0;padding:10px 20px;'
        + 'border:1px solid var(--ctl-line);border-radius:999px;background:var(--ctl);color:var(--fg);'
        + 'font:700 14px ' + FONT + ';cursor:pointer}'
        + '#wizard .wiz-try svg{width:18px;height:18px;margin-right:8px}'
        + '#wizard .wiz-try:disabled{opacity:.45;cursor:default}'
        // ...then every screen small: each added one in full with a ✕, each one setup offers
        // and the watch has not got dimmed, with a + that adds it
        + '#wizard .wiz-scrs{display:flex;justify-content:center;align-items:flex-start;gap:14px;margin:22px 0 6px}'
        + '#wizard .wiz-scr-it{position:relative;display:flex;flex-direction:column;align-items:center;'
        + 'flex:0 1 96px;min-width:0;margin:0;padding:0;border:none;background:none;color:inherit;font:inherit}'
        + '#wizard button.wiz-scr-it{cursor:pointer}'
        + '#wizard .wiz-watch.sm{display:block;border-radius:11px;'
        + 'box-shadow:0 6px 16px rgba(0,0,0,.35),0 0 0 1px var(--card-line)}'
        + 'body.light #wizard .wiz-watch.sm{box-shadow:0 4px 12px rgba(0,0,0,.16),0 0 0 1px var(--card-line)}'
        + '#wizard .wiz-watch.sm .wiz-scr{width:100%}'
        + '#wizard .wiz-scr-it.off .wiz-watch{opacity:.38}'
        + '#wizard .wiz-scr-plus{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);display:flex;'
        + 'align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:'
        + ACCENT_FILL + ';color:#FFFFFF;font:800 24px/1 ' + FONT + ';box-shadow:0 4px 12px rgba(250,74,53,.45)}'
        + '#wizard .wiz-scr-x{position:absolute;top:-10px;right:-10px;display:flex;align-items:center;'
        + 'justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--ctl-line);border-radius:50%;'
        + 'background:var(--ctl);color:var(--fg);cursor:pointer}'
        + '#wizard .wiz-scr-x svg{width:14px;height:14px}'
        + '#wizard .wiz-scr-n{margin-top:8px;font:700 12px ' + FONT + ';color:var(--muted);text-align:center}'
        // the last step
        + '#wizard .wiz-step.last .wiz-title,#wizard .wiz-step.last .wiz-lead{text-align:center}'
        + '#wizard .wiz-badge{display:flex;align-items:center;justify-content:center;width:68px;height:68px;'
        + 'margin:20px auto 14px;border-radius:50%;background:' + ACCENT_FILL + ';'
        + 'box-shadow:0 10px 26px rgba(250,74,53,.4);animation:wiz-pop .5s cubic-bezier(.2,.9,.3,1.25) both}'
        + '#wizard .wiz-badge svg{width:34px;height:34px}'
        + '#wizard .wiz-sum{margin-top:20px;padding:0;list-style:none}'
        + '#wizard .wiz-sum li{display:flex;align-items:center;min-height:50px;padding:4px 6px 4px 16px;'
        + 'border-bottom:1px solid var(--row-line)}'
        + '#wizard .wiz-sum li:last-child{border-bottom:none}'
        + '#wizard .wiz-sum .k{flex:none;width:84px;font-size:13px;color:var(--muted)}'
        + '#wizard .wiz-sum .v{flex:1;min-width:0;padding:6px 0;font-size:14.5px;font-weight:600;'
        + 'overflow-wrap:break-word}'
        + '#wizard .wiz-sum .chg{flex:none;min-height:40px;padding:0 10px;border:none;border-radius:10px;background:none;'
        + 'color:var(--link);font:700 13.5px ' + FONT + ';cursor:pointer}'
        // the optional Tomorrow.io key: a card that opens onto the settings page's own key row
        + '#wizard .wiz-tio{padding:14px 16px}'
        + '#wizard .wiz-tio-hd{display:flex;align-items:center;justify-content:space-between;font-weight:700}'
        + '#wizard .wiz-tag{margin-left:10px;padding:3px 8px;border-radius:999px;background:var(--ctl);'
        + 'color:var(--muted);font:700 11px ' + FONT + ';letter-spacing:.04em;text-transform:uppercase}'
        + '#wizard .wiz-tio>p{margin:6px 0 12px;font-size:13.5px;color:var(--muted)}'
        + '#wizard .wiz-tio-open{min-height:40px;padding:8px 14px;border:1px solid var(--ctl-line);border-radius:11px;'
        + 'background:var(--ctl);color:var(--fg);font:700 13.5px ' + FONT + ';cursor:pointer}'
        + '#wizard .wiz-tio-field{margin:0 -16px -14px}'
        + '#wizard .wiz-tio-field .row{border-bottom:none}#wizard .wiz-tio-field .lbl{outline:none}'
        + '#wizard .wiz-fine{margin:16px 0 0;text-align:center;font-size:12.5px;line-height:1.55;color:var(--hint)}'
        // the bottom bar: one primary button, sometimes a quiet second one
        + '#wizard .wiz-foot{flex:none;display:flex;flex-direction:column;padding:12px 20px 14px;'
        + 'padding-bottom:calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--card-line);'
        + 'background:var(--bg)}'
        + '#wizard .wiz-cta{width:100%;min-height:50px;border:none;border-radius:14px;background:' + ACCENT_FILL + ';'
        + 'color:#FFFFFF;font:700 16px ' + FONT + ';cursor:pointer;box-shadow:0 6px 18px rgba(250,74,53,.35)}'
        + '#wizard .wiz-cta:active{transform:translateY(1px)}'
        + '#wizard .wiz-link{min-height:40px;margin-top:6px;border:none;border-radius:10px;background:none;'
        + 'color:var(--muted);font:600 14px ' + FONT + ';cursor:pointer}'
        + '@keyframes wiz-in-r{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-in-l{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}'
        + '@keyframes wiz-fade{from{opacity:.4}to{opacity:1}}'
        + '@keyframes wiz-tilt{0%{transform:rotate(0)}30%{transform:rotate(14deg)}55%{transform:rotate(-5deg)}'
        + '75%{transform:rotate(2deg)}100%{transform:rotate(0)}}'
        // short screens (small phones, a keyboard up): a smaller watch keeps the options in view
        // (the screen at 180 px; at its own size on emery and on the Screens step, emery last: same specificity)
        + '@media (max-height:700px){#wizard .wiz-stage.big .wiz-scr{width:202.5px}'
        + '#wizard .wiz-flick .wiz-stage.big .wiz-scr{width:162px}#wizard.w200 .wiz-stage.big .wiz-scr{width:224px}'
        + '#wizard .wiz-graph{max-width:290px}#wizard .wiz-title{font-size:22px}}'
        + '@media (prefers-reduced-motion:reduce){#wizard .wiz-step,#wizard .wiz-badge,#wizard .wiz-flick-watch.tilt,'
        + '#wizard .wiz-graph svg,#wizard .wiz-look svg{animation:none}#wizard [data-wiz-watch] .wiz-scr,#wizard .wiz-seg{transition:none}}';

    var api = { CSS: WIZ_CSS, ICON_BACK: ICON_BACK, ICON_DONE: ICON_DONE, ICON_FLICK: ICON_FLICK, ICON_X: ICON_X };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardCss = api;
    }
})();

// src/pkjs/settings/weather-tab-css.js — the Weather tab's stylesheet
// strings: the tab's own classes (chips, panels, viewport, tiles, tip,
// sticky axis, pull pill) and the city-search overlay. Injected once by
// weather-tab.js's onReady hook; kept as JS strings because the settings
// page is a single generated document with no separate stylesheet.
// ES5, WebView.
(function () {
    'use strict';

    var OVERLAY_CSS = ''
        + '#wxloc{position:fixed;top:0;left:0;right:0;bottom:0;z-index:60;background:var(--bg);display:flex;flex-direction:column;}'
        + '#wxloc .hd{display:flex;align-items:center;gap:10px;padding:14px 16px;}'
        + '#wxloc .hd b{font-size:17px;flex:1;}'
        + '#wxloc .hd button{background:var(--ctl);color:var(--fg);border:none;border-radius:10px;padding:8px 14px;font:inherit;}'
        + '#wxloc .bd{padding:0 16px 16px;overflow-y:auto;}'
        + '#wxloc input{width:100%;box-sizing:border-box;background:var(--ctl);color:var(--fg);border:none;border-radius:10px;'
        + 'padding:12px;font:inherit;font-size:15px;outline:none;}'
        + '#wxloc .res{margin-top:10px;}'
        + '#wxloc .res button{display:block;width:100%;text-align:left;background:var(--card);color:var(--fg);'
        + 'border:1px solid var(--card-line);border-radius:12px;padding:12px;margin-bottom:8px;font:inherit;}'
        + '#wxloc .res button small{color:var(--muted);display:block;}'
        + '#wxloc .note{color:var(--hint);font-size:13px;padding:10px 2px;}';

    var WX_CSS = ''
        + '.wx-chips{display:flex;flex-wrap:wrap;gap:8px;}'
        + '.wx-chip{background:var(--ctl);color:var(--fg);border:none;border-radius:999px;padding:7px 13px;font:inherit;font-size:13px;}'
        + '.wx-chip.on{background:linear-gradient(135deg,#FA4A35,#D93A24);color:#fff;font-weight:600;}'
        + '.wx-chip.add{color:var(--muted);}'
        + '.wx-chip:disabled{opacity:0.45;}'
        + '.wx-chip-tools{margin-top:8px;display:flex;gap:14px;}'
        + '.wx-chip-tools button{background:none;border:none;padding:0;color:var(--link);font:inherit;font-size:13px;}'
        + '.wx-hint{color:var(--hint);font-size:13px;margin-top:8px;}'
        + '.wx-panel{margin:2px 0 10px;}'
        // align-items:center — the legend keys carry inline swatch blocks,
        // so baseline alignment set them visibly lower than the title.
        + '.wx-panel-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 2px;}'
        + '.wx-panel-title{font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ttl);flex:1;}'
        + '.wx-key{font-size:11px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;}'
        + '.wx-key-line{display:inline-block;width:12px;height:2px;border-radius:1px;}'
        + '.wx-key-rect{display:inline-block;width:8px;height:8px;border-radius:2px;}'
        + '.wx-readout{font-size:12px;color:var(--muted);margin:2px 0 4px;font-variant-numeric:tabular-nums;}'
        + '.wx-status{color:var(--hint);font-size:14px;padding:10px 0;}'
        + '.wx-retry{background:var(--ctl);color:var(--fg);border:none;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;}'
        // The pannable chart viewport: edge-to-edge in the card via a
        // SEPARATE bleed wrapper (-16px matches .blockrow's side padding).
        // The aspect padding-bottom must NOT share an element with the
        // negative margins — percentage padding resolves against the
        // containing block, so the combined box would be ~10% wider than
        // 360:H and stretch every label (see viewportHtml).
        + '.wx-bleed{margin:8px -16px 0;}'
        + '.wx-vp{position:relative;overflow:hidden;height:0;touch-action:pan-y;}'
        + '.wx-pan{position:absolute;top:0;left:0;height:100%;}'
        + '.wx-ax{position:absolute;top:0;left:0;pointer-events:none;}'
        // The floating value tip over the crosshair (filled/placed by
        // paintScrub: anchored above the hour's topmost point, centered on
        // the crosshair, both clamped into the viewport; without room
        // above, it steps BESIDE the crosshair at the top edge, then
        // BELOW all the hour's marks — it avoids sitting between them,
        // though paintScrub's truly-last resort (a wide tip mid-viewport
        // with a bar blocking below) may still cover the top mark).
        // z-index 5, deliberately UNDER the pinned hour axis (z-index 15):
        // scrolling panels carry their tips beneath the sticky strip's
        // opaque backdrop instead of drawing over it.
        + '.wx-tip{display:none;position:absolute;top:4px;z-index:5;pointer-events:none;'
        + '-webkit-transform:translateX(-50%);transform:translateX(-50%);'
        + 'background:var(--card);border:1px solid var(--card-line);border-radius:8px;'
        + 'padding:4px 8px;color:var(--fg);white-space:nowrap;'
        + 'font-variant-numeric:tabular-nums;box-shadow:0 2px 6px rgba(0,0,0,0.18);}'
        // Title-over-value columns, table-aligned (the app's tooltip).
        + '.wx-tip-c{display:inline-block;vertical-align:top;text-align:left;margin:0 5px;}'
        + '.wx-tip-c b{display:block;font-size:9px;font-weight:600;color:var(--muted);'
        + 'letter-spacing:0.02em;}'
        + '.wx-tip-c i{display:block;font-style:normal;font-size:12px;font-weight:600;}'
        // The sticky time axis: pins below the tab bar while the panels
        // scroll. The card wrapper clips with overflow:clip, which (unlike
        // hidden) does not trap descendant sticky; engines that only know
        // overflow:hidden (Android WebView <90, iOS <16) simply scroll it
        // normally — the accepted floor for the pin. The sticky box carries
        // the full-bleed margin ITSELF (its inner .wx-bleed is zeroed) so
        // the opaque backdrop covers the whole bled strip — on the wrapper
        // alone it is 32px narrower and panel ink shows through the side
        // slivers. translateZ(0) forces a compositing layer, the same
        // leak-through fix .blockrow.sticky documents in shell.html.
        + '.wx-sticky{position:-webkit-sticky;position:sticky;top:0;z-index:15;background:var(--card);'
        + 'margin:8px -16px 0;-webkit-transform:translateZ(0);transform:translateZ(0);}'
        + '.wx-sticky .wx-bleed{margin:4px 0 0;}'
        // The 5-day tile row rides in the pinned box too, above the hour
        // strip; its own side bleed is zeroed the same way (the sticky box
        // already carries the -16px margins).
        + '.wx-sticky .wx-days{margin:0;}'
        // Day tiles are the day selector: tap jumps the panels to that day.
        // App-style wide tiles in a horizontally scrollable row (~2.5 tiles
        // per viewport); position:relative makes the row the tiles'
        // offsetParent so scrollDayStrip can center the selection.
        // Full bleed like the charts (-16px matches .blockrow's side
        // padding): the row runs edge to edge and tiles cut off at the
        // section border. The first/last tiles carry a small edge margin
        // so the row's resting ends don't touch the border.
        + '.wx-days{display:flex;gap:6px;margin:6px -16px 0;position:relative;'
        + 'overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}'
        + '.wx-days::-webkit-scrollbar{display:none;}'
        + '.wx-days .wx-day:first-child{margin-left:8px;}'
        + '.wx-days .wx-day:last-child{margin-right:8px;}'
        // Every tile carries a transparent border so selecting one (border
        // turns accent-colored) never shifts the row's layout. A full accent
        // fill read too heavy next to the charts — the border is the marker.
        // Slim side padding: the meta rows need the width, and the border
        // itself already separates tiles.
        + '.wx-day{flex:0 0 auto;width:28%;min-width:100px;box-sizing:border-box;'
        + 'display:block;background:var(--ctl);'
        + 'border:1.5px solid transparent;border-radius:12px;'
        + 'padding:5px 4px;text-align:center;font:inherit;color:var(--fg);cursor:pointer;}'
        // Inset ring, not outline: the row is a scroll container now, and it
        // clips ink drawn OUTSIDE the tile's box (an outline) at its edges.
        + '.wx-day.today{box-shadow:inset 0 0 0 1px var(--card-line);}'
        + '.wx-day.sel{border-color:var(--link);}'
        + '.wx-day.sel .wx-day-name{color:var(--link);}'
        + '.wx-day.off{opacity:0.4;cursor:default;}'
        // Tile text runs at full contrast throughout (--fg: white on the
        // dark theme) — the muted steps read too dim on the tinted tile
        // fill; hierarchy comes from the weights, not from graying out.
        + '.wx-day-head{display:block;font-size:11px;}'
        + '.wx-day-name{font-weight:600;color:var(--fg);}'
        + '.wx-day-date{color:var(--fg);}'
        + '.wx-day-icon{display:block;margin:2px 0 1px;min-height:24px;}'
        + '.wx-day-temp{display:block;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}'
        + '.wx-day-temp span{color:var(--fg);font-weight:400;}'
        // TWO fixed meta rows (rain mm | sun icon, then chance | sun
        // hours): every value in its own cell, min-height holding empty
        // cells, so the sun column never jumps with the text length.
        + '.wx-day-meta{display:flex;justify-content:space-between;gap:6px;padding:0 2px;'
        + 'font-size:10px;color:var(--fg);margin-top:2px;min-height:12px;font-variant-numeric:tabular-nums;}'
        + '.wx-day-sun{color:var(--fg);}'
        + '.wx-foot{color:var(--hint);font-size:11px;margin-top:2px;}'
        + '.wx-refresh{background:none;border:none;padding:0;font:inherit;font-size:11px;'
        + 'color:var(--link);cursor:pointer;}'
        // Pull-to-refresh pill: fixed under the tab bar, shown only while a
        // downward pull from the page top is in progress on the Weather tab.
        // Transform and opacity track the finger directly (no transition —
        // it would lag the drag); only the armed color flip animates.
        + '#wx-ptr{display:none;position:fixed;top:56px;left:50%;'
        + '-webkit-transform:translateX(-50%);transform:translateX(-50%);z-index:80;'
        + 'padding:7px 14px;border-radius:16px;background:var(--card);'
        + 'border:1px solid var(--card-line);color:var(--muted);font-size:12px;font-weight:600;'
        + 'opacity:0;transition:color 0.15s ease,border-color 0.15s ease;'
        + 'will-change:transform,opacity;}'
        + '#wx-ptr.on{color:var(--link);border-color:var(--link);}';

    var api = { WX_CSS: WX_CSS, OVERLAY_CSS: OVERLAY_CSS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabCss = api;
    }
})();

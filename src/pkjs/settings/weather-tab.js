// src/pkjs/settings/weather-tab.js — the Weather tab's glue: the location
// chip row + saved-location editor overlay, the tab-local provider select,
// the graphs/daily-strip block, in-page fetch orchestration, and the pan +
// crosshair gestures. ES5, WebView.
//
// DISPLAY-ONLY contract: nothing in this tab reads or writes the watch's
// `provider`/`location`/`locationMode` keys. The tab's own keys
// (graphsProvider, graphsLocation, savedLocation1..3) are blob-only and never
// ride an AppMessage — they exist so the graphs remember the user's picks,
// and as the storage base a future multi-location watch feature can build on.
//
// Async shape: block renderers are synchronous string-returners re-run on
// every settings change, so the weather data lives in module state; a fetch
// completion patches state and asks the engine for a repaint via the ctx
// captured at onReady (the news.js/view-editor.js pattern).
//
// Gesture shape (the app's): a horizontal drag on any chart pans EVERY
// panel together, one day per viewport, snapping to day boundaries on
// release (flicks advance one day); a tap sets the shared crosshair; a
// day tile jumps straight to that day. Pans and taps are direct DOM writes
// (transform / attribute updates) — never a re-render mid-gesture.
/* global PConf, WeatherTabModel, WeatherTabData, WeatherTabCharts, SunCalc */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};

(function () {
    'use strict';

    var model = (typeof require !== 'undefined')
        ? require('./weather-tab-model.js') : window.WeatherTabModel;
    var data = (typeof require !== 'undefined')
        ? require('./weather-tab-data.js') : window.WeatherTabData;
    var charts = (typeof require !== 'undefined')
        ? require('./weather-tab-charts.js') : window.WeatherTabCharts;

    // Module state: the engine re-renders blocks wholesale, so everything
    // async or cross-render lives here.
    var ctx = null;                 // engine context from onReady
    var fetchState = { key: null, status: 'idle', data: null, error: null, view: null };
    var inFlight = null;            // key currently being fetched
    var scrubIndex = null;          // crosshair index shared by all panels
    var panDay = 0;                 // day currently in the viewport (0-based)
    var editingSlot = null;         // overlay target: 1..3
    var gpsSeed = null;             // {lat, lon, name}: a page-acquired fix fresher than the injected seed
    var stripKeep = null;           // .wx-days scrollLeft carried across a render (null = center the selection)
    var stripPending = false;       // an applyStripScroll is scheduled for the render being built
    var stripFresh = false;         // a NEW location's tiles just arrived — center instead of restoring
    var panelMarks = null;          // per-panel scale metadata from the last render (dots/bars/tips)
    var litBars = {};               // panel id → bar index currently lit by the crosshair
    var PANEL_IDS = ['temp', 'wind', 'hum', 'press'];

    /**
     * The effective current-location seed: a fix this page acquired itself
     * (manual refresh re-reads the phone GPS, so the Current chip follows
     * the user around after the page has been open a while), else the seed
     * the phone injected at page open, else null.
     * @param {Object} userData Injected userData.
     * @returns {?{lat: number, lon: number, name: string}} Seed or null.
     */
    function seedOf(userData) {
        var s = userData && userData.graphsSeed;
        var base = (!s || !isFinite(Number(s.lat)) || !isFinite(Number(s.lon)))
            ? null
            : { lat: Number(s.lat), lon: Number(s.lon), name: s.name || 'Current location' };
        if (gpsSeed) {
            return { lat: gpsSeed.lat, lon: gpsSeed.lon, name: gpsSeed.name || (base && base.name) || 'Current location' };
        }
        return base;
    }

    /**
     * Kick (or reuse) the fetch for the active provider+location. Never
     * fetches twice for the same key; repaints through ctx when data lands.
     * @param {Object} state Live settings state.
     * @param {Object} userData Injected userData.
     * @returns {void}
     */
    function ensureFetch(state, userData) {
        var loc = model.activeLocation(state, seedOf(userData));
        if (!loc) { return; }
        var provider = model.resolveGraphsProvider(state);
        var key = provider + '|' + loc.lat.toFixed(3) + '|' + loc.lon.toFixed(3);
        // Same key: whatever the outcome was (ok, loading, error), don't fire
        // again from a render — errors retry only through the Retry action, or
        // this would XHR-loop (each failure repaints, each repaint refetches).
        if (fetchState.key === key && fetchState.status !== 'idle') { return; }
        if (inFlight === key) { return; }
        var isNewKey = fetchState.key !== key;
        inFlight = key;
        // Refetch keeps the frame: hold the previous view (dimmed by the
        // renderer) instead of flashing a skeleton.
        fetchState = { key: key, status: 'loading', data: fetchState.data, error: null, view: fetchState.view };
        // A cache hit answers on the SAME tick, while this very call sits
        // inside an engine render — repainting then would re-enter render().
        // The synchronous flag skips it; the block reads the updated state
        // as it continues.
        var sync = true;
        data.fetchWeather(provider, loc.lat, loc.lon, state, function (result, err) {
            if (inFlight !== key) { return; }  // superseded by a newer pick
            inFlight = null;
            if (err) {
                fetchState = { key: key, status: 'error', data: null, error: err, view: null };
            } else {
                var view = charts.prepareView(result, Date.now());
                fetchState = { key: key, status: view ? 'ok' : 'error', data: result, error: view ? null : 'empty', view: view };
                scrubIndex = null;
                if (isNewKey) {
                    panDay = 0;
                    stripFresh = true;
                }
            }
            if (ctx && !sync) { ctx.render(); }
        });
        sync = false;
    }

    /**
     * Options for the tab's provider select: Auto (resolving to the watch
     * provider when the page can fetch it, else Open-Meteo) + every provider
     * whose key, if any, is present.
     * @param {Object} state Live settings state.
     * @returns {Array<Array<string>>} [label, value] pairs.
     */
    function graphsProviderOptions(state) {
        // No Object.assign here: the page bundle carries no polyfills (they are
        // PKJS-side), so ancient Android WebViews would throw.
        var probe = {};
        for (var k in state) {
            if (Object.prototype.hasOwnProperty.call(state, k)) { probe[k] = state[k]; }
        }
        probe.graphsProvider = 'auto';
        var resolved = model.resolveGraphsProvider(probe);
        var label = 'Auto';
        var avail = model.availableProviders(state);
        for (var i = 0; i < avail.length; i += 1) {
            if (avail[i].id === resolved) { label = 'Auto (' + avail[i].label + ')'; }
        }
        var out = [[label, 'auto']];
        for (i = 0; i < avail.length; i += 1) {
            out.push([avail[i].label, avail[i].id]);
        }
        return out;
    }

    /**
     * The collapsed Provider card's header value: the label of the current
     * graphsProvider pick ("Auto (DWD)", "Open-Meteo", …). Falls back to the
     * Auto label when the stored pick is no longer offered (key removed).
     * @param {Object} state Live settings state.
     * @returns {string} Display label for the section header.
     */
    function graphsProviderHeader(state) {
        var opts = graphsProviderOptions(state);
        var v = (state && state.graphsProvider) || 'auto';
        for (var i = 0; i < opts.length; i += 1) {
            if (opts[i][1] === v) { return opts[i][0]; }
        }
        return opts[0][0];
    }

    // --- location chips ---------------------------------------------------------

    /**
     * The location chip row block: Current + up to three saved slots + Add,
     * with Edit/Remove links for the active saved slot.
     * @param {Object} state Live settings state.
     * @param {Object} env Env facts.
     * @param {Object} userData Injected userData.
     * @returns {string} HTML.
     */
    function weatherLocationsBlock(state, env, userData) {
        var seed = seedOf(userData);
        var active = model.activeLocation(state, seed);
        var activeKey = active ? active.key : 'current';
        var h = '<div class="wx-chips">';
        var chip = function (key, label, disabled) {
            return '<button type="button" class="wx-chip' + (key === activeKey ? ' on' : '') + '"'
                + (disabled ? ' disabled' : '')
                + ' data-action="wxSelectLocation" data-action-arg="' + key + '">' + charts.esc(label) + '</button>';
        };
        h += chip('current', seed ? seed.name : 'Current', !seed);
        var slotCount = 0;
        for (var i = 1; i <= 3; i += 1) {
            var slot = model.parseSlot(state[model.SLOT_KEYS[i - 1]]);
            if (!slot) { continue; }
            slotCount += 1;
            h += chip(String(i), slot.name, false);
        }
        if (slotCount < 3) {
            h += '<button type="button" class="wx-chip add" data-action="wxEditLocation" data-action-arg="new">+ Add</button>';
        }
        h += '</div>';
        if (activeKey !== 'current') {
            h += '<div class="wx-chip-tools">'
                + '<button type="button" data-action="wxEditLocation" data-action-arg="' + activeKey + '">Replace</button>'
                + '<button type="button" data-action="wxRemoveLocation" data-action-arg="' + activeKey + '">Remove</button>'
                + '</div>';
        }
        if (!seed && slotCount === 0) {
            h += '<div class="wx-hint">No location yet — the watch hasn’t fetched weather on this phone. Add a city to see its graphs.</div>';
        }
        return h;
    }

    // --- graphs block -------------------------------------------------------------

    /**
     * One panel wrapper: title, legend keys, readout row, chart body.
     * @param {string} id Panel id.
     * @param {string} title Panel title.
     * @param {Array<Array<string>>} legend [label, color, kind('line'|'rect')] triples.
     * @param {string} readoutText Default readout (the "now" values).
     * @param {string} body Chart viewport markup.
     * @returns {string} HTML.
     */
    function panelHtml(id, title, legend, readoutText, body) {
        var h = '<div class="wx-panel">';
        h += '<div class="wx-panel-head"><span class="wx-panel-title">' + charts.esc(title) + '</span>';
        for (var i = 0; i < legend.length; i += 1) {
            var mark = legend[i][2] === 'rect'
                ? '<span class="wx-key-rect" style="background:' + legend[i][1] + '"></span>'
                : '<span class="wx-key-line" style="background:' + legend[i][1] + '"></span>';
            h += '<span class="wx-key">' + mark + charts.esc(legend[i][0]) + '</span>';
        }
        h += '</div>';
        if (readoutText) {
            h += '<div class="wx-readout" id="wx-read-' + id + '">' + charts.esc(readoutText) + '</div>';
        }
        return h + body + '</div>';
    }

    /**
     * The graphs block: fetch status, the 5-day selector strip, the shared
     * hour strip, and the five pannable panels.
     * @param {Object} state Live settings state.
     * @param {Object} env Env facts.
     * @param {Object} userData Injected userData.
     * @returns {string} HTML.
     */
    function weatherGraphsBlock(state, env, userData) {
        var seed = seedOf(userData);
        var loc = model.activeLocation(state, seed);
        if (!loc) { return ''; }
        ensureFetch(state, userData);
        var isLight = pageIsLight(state);
        var pal = charts.palette(isLight);
        if (fetchState.status === 'loading' && !fetchState.view) {
            return '<div class="wx-status">Loading ' + charts.esc(loc.name) + '…</div>';
        }
        if (fetchState.status === 'error') {
            return '<div class="wx-status">Couldn’t load weather (' + charts.esc(fetchState.error || 'error') + ').'
                + ' <button type="button" class="wx-retry" data-action="wxRetryWeather">Retry</button></div>';
        }
        if (!fetchState.view) { return ''; }
        var refetching = fetchState.status === 'loading';
        var view = fetchState.view;
        var settings = state;
        if (panDay > view.days - 1) { panDay = view.days - 1; }
        var idx = scrubIndex === null ? dayAnchorIndex(view, panDay) : scrubIndex;
        var sunCalcLib = (typeof require !== 'undefined') ? require('./vendor-suncalc.js') : window.SunCalc;
        var vp = function (id, spec) { return charts.viewportHtml(id, spec, view, panDay); };
        var specs = {
            temp: charts.tempPanelSvg(view, settings, pal),
            wind: charts.windPanelSvg(view, settings, pal),
            hum: charts.humidityPanelSvg(view, settings, pal),
            press: charts.pressurePanelSvg(view, settings, pal)
        };
        // The specs' scale metadata is what paintScrub places dots, bars
        // and tips with; the render replaces the DOM, so drop the lit-bar
        // memory with it.
        panelMarks = { temp: specs.temp.marks, wind: specs.wind.marks, hum: specs.hum.marks, press: specs.press.marks };
        litBars = {};
        var h = '';
        // The 5-day strip leads (the app's layout) and doubles as the day
        // selector for everything below it.
        h += '<div class="wx-panel"><div class="wx-panel-head"><span class="wx-panel-title">5-day forecast</span></div>'
            + charts.dailyStripHtml(view.daily, settings, pal, view.offsetSec, Date.now(), panDay, view.days)
            + '</div>';
        // The shared time axis: hour ruler + condition icons + night shading
        // + the highlighted hour's chip.
        h += vp('strip', charts.timeStripSvg(view, loc, pal, sunCalcLib, idx));
        h += panelHtml('temp', 'Temperature & precipitation',
            [['Temp', pal.temp, 'line'], ['Rain', pal.water, 'rect']],
            charts.readout('temp', view, idx, settings),
            vp('temp', specs.temp));
        h += panelHtml('wind', 'Wind & gusts · ' + model.windUnitLabel(settings),
            [['Wind', pal.water, 'line'], ['Gusts', pal.gust, 'line']],
            charts.readout('wind', view, idx, settings),
            vp('wind', specs.wind));
        h += panelHtml('hum', 'Humidity & dew point',
            [['Humidity', pal.water, 'rect'], ['Temp', pal.temp, 'line'], ['Dew point', pal.dew, 'line']],
            charts.readout('hum', view, idx, settings),
            vp('hum', specs.hum));
        h += panelHtml('press', 'Pressure · hPa', [],
            charts.readout('press', view, idx, settings),
            vp('press', specs.press));
        if (sunCalcLib) {
            h += panelHtml('sun', 'Sun & moon',
                [['Sun', pal.sun, 'line'], ['Moon', pal.faint, 'line']],
                '',
                vp('sun', charts.sunMoonPanelSvg(view, loc, pal, sunCalcLib)));
        }
        var providerLabel = fetchState.data && fetchState.data.meta ? fetchState.data.meta.provider : '';
        for (var i = 0; i < model.GRAPH_PROVIDERS.length; i += 1) {
            if (model.GRAPH_PROVIDERS[i].id === providerLabel) { providerLabel = model.GRAPH_PROVIDERS[i].label; }
        }
        var meta = fetchState.data && fetchState.data.meta;
        var age = meta ? Math.max(0, Math.round((Date.now() - meta.fetchedAt) / 60000)) : 0;
        h += '<div class="wx-foot">' + charts.esc(loc.name) + ' · ' + charts.esc(providerLabel)
            + ' · ' + (refetching ? 'updating…' : (age === 0 ? 'just now' : age + ' min ago'))
            // Manual refresh only: no timer refetches. Pull-to-refresh is the
            // touch path; this link is the visible (and mouse) affordance.
            + (refetching ? '' : ' · <button type="button" class="wx-refresh" data-action="wxRefreshWeather">Refresh</button>')
            + '</div>';
        // A render rebuilds the scrollable day strip at scrollLeft 0. The OLD
        // strip is still in the DOM while this string is being built, so
        // capture the user's scroll here and put the rebuilt row back there
        // (or center the selection when there's nothing to keep). Only the
        // FIRST render before the timeout fires may capture — a back-to-back
        // second render would otherwise read the fresh row's zero.
        if (typeof document !== 'undefined' && typeof setTimeout !== 'undefined') {
            if (!stripPending) {
                var prevRow = document.querySelector ? document.querySelector('.wx-days') : null;
                stripKeep = (prevRow && !stripFresh) ? prevRow.scrollLeft : null;
                stripPending = true;
            }
            stripFresh = false;
            setTimeout(applyStripScroll, 0);
            // The rendered string parks the crosshair extras (dots, bars,
            // tip); if a scrub was active, put them back once the new DOM
            // stands.
            setTimeout(repaintScrub, 0);
        }
        // Refetch keeps the frame: the previous charts stay up, dimmed, while
        // the new location/provider loads — never a skeleton flash.
        return refetching ? '<div style="opacity:0.55">' + h + '</div>' : h;
    }

    /**
     * Whether the page currently renders its light chrome (the charts pick
     * their validated palette per surface).
     * @param {Object} state Live settings state (configTheme).
     * @returns {boolean} True for the light page theme.
     */
    function pageIsLight(state) {
        var prefersLight = false;
        if (typeof window !== 'undefined' && window.matchMedia) {
            try {
                prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
            } catch (ex) { /* keep false */ }
        }
        // The engine owns theme resolution (applyTheme uses the same call);
        // reuse it so the chart palette tracks the page chrome exactly. The
        // fallback covers the first render (before onReady hands us ctx) and
        // the Node tests.
        if (ctx && ctx.schema && PConf.engine && PConf.engine.resolveTheme) {
            return PConf.engine.resolveTheme(ctx.schema, state, prefersLight) === 'light';
        }
        var pick = state && state.configTheme;
        if (pick === 'light') { return true; }
        if (pick === 'dark') { return false; }
        return prefersLight;
    }

    // --- overlay: city search ------------------------------------------------------

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
        // paintScrub; left is a % of the viewport, the transform centers).
        + '.wx-tip{display:none;position:absolute;top:4px;z-index:5;pointer-events:none;'
        + '-webkit-transform:translateX(-50%);transform:translateX(-50%);'
        + 'background:var(--card);border:1px solid var(--card-line);border-radius:8px;'
        + 'padding:3px 8px;font-size:11px;font-weight:600;color:var(--fg);white-space:nowrap;'
        + 'font-variant-numeric:tabular-nums;box-shadow:0 2px 6px rgba(0,0,0,0.18);}'
        // Day tiles are the day selector: tap jumps the panels to that day.
        // App-style wide tiles in a horizontally scrollable row (~2.5 tiles
        // per viewport); position:relative makes the row the tiles'
        // offsetParent so scrollDayStrip can center the selection.
        // Full bleed like the charts (-16px matches .blockrow's side
        // padding): the row runs edge to edge and tiles cut off at the
        // section border, no lead-in padding.
        + '.wx-days{display:flex;gap:6px;margin:6px -16px 0;position:relative;'
        + 'overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}'
        + '.wx-days::-webkit-scrollbar{display:none;}'
        // Every tile carries a transparent border so selecting one (border
        // turns accent-colored) never shifts the row's layout. A full accent
        // fill read too heavy next to the charts — the border is the marker.
        + '.wx-day{flex:0 0 auto;width:31%;min-width:110px;box-sizing:border-box;'
        + 'display:block;background:var(--ctl);'
        + 'border:1.5px solid transparent;border-radius:12px;'
        + 'padding:8px 6px;text-align:center;font:inherit;color:var(--fg);cursor:pointer;}'
        // Inset ring, not outline: the row is a scroll container now, and it
        // clips ink drawn OUTSIDE the tile's box (an outline) at its edges.
        + '.wx-day.today{box-shadow:inset 0 0 0 1px var(--card-line);}'
        + '.wx-day.sel{border-color:var(--link);}'
        + '.wx-day.sel .wx-day-name{color:var(--link);}'
        + '.wx-day.off{opacity:0.4;cursor:default;}'
        + '.wx-day-head{display:block;font-size:11px;}'
        + '.wx-day-name{font-weight:600;color:var(--lbl);}'
        + '.wx-day-date{color:var(--muted);}'
        + '.wx-day-icon{display:block;margin:4px 0 2px;min-height:26px;}'
        + '.wx-day-temp{display:block;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}'
        + '.wx-day-temp span{color:var(--muted);font-weight:400;}'
        // One meta row: precipitation (mm · %) left, sun hours right.
        + '.wx-day-meta{display:flex;justify-content:space-between;gap:6px;padding:0 4px;'
        + 'font-size:10px;color:var(--muted);margin-top:2px;min-height:12px;font-variant-numeric:tabular-nums;}'
        + '.wx-day-sun{color:var(--hint);}'
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

    /**
     * Open the city-search overlay targeting a slot (1..3).
     * @param {number} slotIndex Slot to write.
     * @returns {void}
     */
    function openOverlay(slotIndex) {
        if (typeof document === 'undefined') { return; }
        editingSlot = slotIndex;
        var el = document.createElement('div');
        el.id = 'wxloc';
        el.innerHTML = '<div class="hd"><b>Add location</b><button type="button" id="wxloc-cancel">Cancel</button></div>'
            + '<div class="bd"><input id="wxloc-q" type="text" placeholder="Search city…" autocomplete="off">'
            + '<div class="res" id="wxloc-res"><div class="note">Type at least two letters.</div></div></div>';
        document.body.appendChild(el);
        var input = document.getElementById('wxloc-q');
        var res = document.getElementById('wxloc-res');
        var timer = null;
        var closeOverlay = function () {
            editingSlot = null;
            if (el.parentNode) { el.parentNode.removeChild(el); }
        };
        document.getElementById('wxloc-cancel').onclick = closeOverlay;
        var renderResults = function (list, err) {
            if (err) {
                res.innerHTML = '<div class="note">Search failed (' + charts.esc(err) + '). Check your connection.</div>';
                return;
            }
            if (!list.length) {
                res.innerHTML = '<div class="note">No matches.</div>';
                return;
            }
            var h = '';
            for (var i = 0; i < list.length; i += 1) {
                var c = list[i];
                var sub = [c.admin, c.country].join(c.admin && c.country ? ' · ' : '');
                h += '<button type="button" data-i="' + i + '">' + charts.esc(c.name)
                    + '<small>' + charts.esc(sub) + '</small></button>';
            }
            res.innerHTML = h;
            var buttons = res.getElementsByTagName('button');
            var pick = function (c) {
                return function () {
                    if (ctx) {
                        ctx.set(model.SLOT_KEYS[slotIndex - 1], model.serializeSlot({
                            name: c.name, lat: c.lat, lon: c.lon, country: c.country
                        }));
                        ctx.set('graphsLocation', String(slotIndex));
                    }
                    closeOverlay();
                    fetchState.key = null;   // force a refetch for the new pick
                    if (ctx) { ctx.render(); }
                };
            };
            for (i = 0; i < buttons.length; i += 1) {
                buttons[i].onclick = pick(list[Number(buttons[i].getAttribute('data-i'))]);
            }
        };
        input.oninput = function () {
            var q = input.value;
            if (timer) { clearTimeout(timer); }
            if (!q || q.length < 2) {
                res.innerHTML = '<div class="note">Type at least two letters.</div>';
                return;
            }
            timer = setTimeout(function () {
                res.innerHTML = '<div class="note">Searching…</div>';
                data.geocodeSearch(q, function (list, err) {
                    if (input.value !== q) { return; }
                    renderResults(list || [], err);
                });
            }, 350);
        };
        try { input.focus(); } catch (ex) { /* some webviews refuse */ }
    }

    /**
     * The first empty slot index, or null when all three are taken.
     * @param {Object} S Live settings state.
     * @returns {?number} 1..3 or null.
     */
    function firstFreeSlot(S) {
        for (var i = 0; i < model.SLOT_KEYS.length; i += 1) {
            if (!model.parseSlot(S[model.SLOT_KEYS[i]])) { return i + 1; }
        }
        return null;
    }

    /**
     * Straight-line distance between two coordinates, equirectangular with
     * the longitude difference wrapped across the antimeridian — plenty at
     * the "did the phone leave town?" scale this gates.
     * @param {number} aLat First latitude.
     * @param {number} aLon First longitude.
     * @param {number} bLat Second latitude.
     * @param {number} bLon Second longitude.
     * @returns {number} Kilometres.
     */
    function moveKm(aLat, aLon, bLat, bLon) {
        var dLonDeg = bLon - aLon;
        if (dLonDeg > 180) { dLonDeg -= 360; }
        if (dLonDeg < -180) { dLonDeg += 360; }
        var dLat = (bLat - aLat) * 111.32;
        var dLon = dLonDeg * 111.32 * Math.cos((aLat + bLat) * Math.PI / 360);
        return Math.sqrt(dLat * dLat + dLon * dLon);
    }

    // Beyond this, the seed's city name is presumed stale along with its coords.
    var NAME_STALE_KM = 2;
    var GENERIC_NAME = 'Current location';
    var revFor = null;   // the gpsSeed a city lookup is in flight for

    /**
     * One in-flight city lookup for an adopted fix (the phone side's own
     * ArcGIS endpoint): relabels the Current chip in place when it answers.
     * The seed's OBJECT IDENTITY is the token — a later far move replaces
     * the object, so a stale answer can never label the wrong place, while
     * same-place refreshes keep the object and the pending answer still
     * lands.
     * @param {{lat: number, lon: number, name: string}} seed The gpsSeed to label.
     * @returns {void}
     */
    function requestCityName(seed) {
        revFor = seed;
        data.reverseGeocode(seed.lat, seed.lon, function (city) {
            if (revFor === seed) { revFor = null; }
            if (city && gpsSeed === seed) {
                seed.name = city;
                if (ctx) { ctx.render(); }
            }
        });
    }

    /**
     * Adopt a fresh device fix as the Current seed — but only a REAL move
     * (beyond NAME_STALE_KM). Metres of GPS jitter neither move the seed nor
     * rename it: keeping the previous coordinates keeps the fetch key stable
     * (the refetch stays same-key, so the viewed day survives a stationary
     * refresh) and pins the staleness baseline to the last adopted position
     * instead of letting it creep fix by fix. A far move resets the name to
     * the generic label and asks the reverse geocoder for the city; if that
     * one lookup failed, the next same-place refresh retries it — the
     * placeholder never sticks for the whole page session.
     * @param {{lat: number, lon: number}} fix Device coordinates.
     * @returns {void}
     */
    function applyGpsFix(fix) {
        var prev = seedOf(ctx && ctx.USERDATA);
        if (prev && moveKm(prev.lat, prev.lon, fix.lat, fix.lon) <= NAME_STALE_KM) {
            if (gpsSeed && gpsSeed.name === GENERIC_NAME && revFor !== gpsSeed) {
                requestCityName(gpsSeed);
            }
            return;
        }
        gpsSeed = { lat: fix.lat, lon: fix.lon, name: GENERIC_NAME };
        requestCityName(gpsSeed);
    }

    /**
     * Force a refetch of the CURRENT provider+location. Manual only — this
     * tab never refetches on a timer; data updates when the tab first opens
     * (per page open), when the pick changes, and through this (the footer
     * Refresh link and pull-to-refresh). Keeps fetchState.key and .view, so
     * ensureFetch refires for the same key and the charts stay up (dimmed)
     * on the day the user was viewing.
     *
     * When the Current chip is the active location, the refresh first re-reads
     * the phone's GPS so the charts follow the user, not the fix from page
     * open: fetchState holds 'loading' (dimmed charts, ensureFetch off) until
     * the fix answers — one fetch, at the right place — then goes idle so the
     * next render fetches. Every failure shape (no API, denied, timeout)
     * degrades to a plain refresh of the previous coordinates.
     * @returns {boolean} True when a refetch was kicked off (re-render due).
     */
    function refreshWeather() {
        if (fetchState.status === 'loading') { return false; }
        data.clearCache();
        var active = ctx && ctx.S ? model.activeLocation(ctx.S, seedOf(ctx.USERDATA)) : null;
        if (active && active.key === 'current') {
            fetchState.status = 'loading';
            data.getGpsFix(function (fix) {
                if (fix) { applyGpsFix(fix); }
                // Release only the hold WE placed: a pick switched mid-wait
                // already has its own fetch in flight — leave it alone.
                if (!inFlight && fetchState.status === 'loading') { fetchState.status = 'idle'; }
                if (ctx) { ctx.render(); }
            });
        } else {
            fetchState.status = 'idle';
        }
        return true;
    }

    // --- gestures: drag pans the day window, tap scrubs the crosshair --------

    /**
     * The nearest ancestor (self included) carrying an attribute.
     * @param {?Node} node Event target.
     * @param {string} attr Attribute name.
     * @returns {?Element} The carrier, or null.
     */
    function findAttr(node, attr) {
        while (node && node.getAttribute) {
            if (node.getAttribute(attr)) { return node; }
            node = node.parentNode;
        }
        return null;
    }

    /**
     * The pan transform (percent of the wide inner element) for a day.
     * @param {number} day Day index.
     * @param {number} days Timeline day count.
     * @returns {number} translateX percentage (negative).
     */
    function panPct(day, days) {
        return -(day * 100 / days);
    }

    /**
     * Apply the shared pan transform to EVERY panel's inner element — the
     * whole tab below the day selector moves as one.
     * @param {number} pct translateX percentage.
     * @param {boolean} animated Whether to ease (the day snap).
     * @returns {void}
     */
    function setPan(pct, animated) {
        if (typeof document === 'undefined' || !document.querySelectorAll) { return; }
        var els = document.querySelectorAll('.wx-pan');
        var val = 'translateX(' + pct + '%)';
        for (var i = 0; i < els.length; i += 1) {
            var st = els[i].style;
            st.webkitTransition = animated ? '-webkit-transform 0.22s ease-out' : 'none';
            st.transition = animated ? 'transform 0.22s ease-out' : 'none';
            st.webkitTransform = val;
            st.transform = val;
        }
    }

    /**
     * Which day a released drag snaps to: a quick flick advances one day,
     * anything else rounds to the nearest day boundary.
     * @param {number} baseDay Day when the drag started.
     * @param {number} dxPx Horizontal drag distance (px, right = positive).
     * @param {number} vw Viewport width (px).
     * @param {number} days Timeline day count.
     * @param {number} dtMs Drag duration.
     * @returns {number} Target day, clamped to the timeline.
     */
    function snapTargetDay(baseDay, dxPx, vw, days, dtMs) {
        var target;
        if (dtMs < 300 && Math.abs(dxPx) > vw * 0.12) {
            target = baseDay + (dxPx < 0 ? 1 : -1);
        } else {
            target = Math.round(baseDay - dxPx / vw);
        }
        if (target < 0) { target = 0; }
        if (target > days - 1) { target = days - 1; }
        return target;
    }

    /**
     * The readout index a freshly shown day rests on: "now" while today is
     * in the viewport, that day's noon otherwise.
     * @param {Object} view Prepared view.
     * @param {number} day Day index in the viewport.
     * @returns {number} Hour index into the view arrays.
     */
    function dayAnchorIndex(view, day) {
        var i = (view.nowIndex >= day * 24 && view.nowIndex < (day + 1) * 24)
            ? view.nowIndex : day * 24 + 12;
        if (i > view.times.length - 1) { i = view.times.length - 1; }
        return i;
    }

    /**
     * Paint the shared crosshair state at one hour by direct DOM writes (no
     * re-render): every panel's guideline and readout, a highlight dot on
     * every line series (at the same y its path used — the scale comes from
     * the panel's marks), the touched hour's bar lit, the floating value
     * tip, and the hour strip's chip (moved to the hour, relabeled, its
     * icon swapped to that hour's own glyph). `active` false is the parked
     * state: guides, dots, lit bars and tips withdraw; readouts and the
     * chip rest on the anchor hour.
     * @param {number} i Hour index into the view.
     * @param {boolean} active True while a crosshair scrub is showing.
     * @returns {void}
     */
    function paintScrub(i, active) {
        var view = fetchState.view;
        if (!view || !ctx || typeof document === 'undefined' || !document.getElementById) { return; }
        if (i < 0) { i = 0; }
        if (i > view.times.length - 1) { i = view.times.length - 1; }
        var x = charts.xAt(view, i);
        for (var k = 0; k < PANEL_IDS.length; k += 1) {
            var id = PANEL_IDS[k];
            var line = document.getElementById('wx-scrub-' + id);
            if (line) {
                line.setAttribute('x1', active ? x : -10);
                line.setAttribute('x2', active ? x : -10);
            }
            var read = document.getElementById('wx-read-' + id);
            if (read) { read.textContent = charts.readout(id, view, i, ctx.S); }
            var marks = panelMarks && panelMarks[id];
            if (!marks) { continue; }
            for (var m = 0; m < marks.lines.length; m += 1) {
                var ln = marks.lines[m];
                var dot = document.getElementById('wx-dot-' + id + '-' + ln.key);
                if (!dot) { continue; }
                var v = ln.vals[i];
                if (active && v !== null && v !== undefined && ln.max > ln.min) {
                    dot.setAttribute('cx', x);
                    dot.setAttribute('cy',
                        (marks.bottom - (v - ln.min) / (ln.max - ln.min) * (marks.bottom - marks.top)).toFixed(1));
                } else {
                    dot.setAttribute('cx', -10);
                    dot.setAttribute('cy', -10);
                }
            }
            if (marks.bar) {
                if (litBars[id] !== undefined && litBars[id] !== null && litBars[id] !== i) {
                    var prev = document.getElementById(marks.bar.prefix + '-' + litBars[id]);
                    if (prev) { prev.setAttribute('opacity', marks.bar.dim); }
                    litBars[id] = null;
                }
                if (active) {
                    var bar = document.getElementById(marks.bar.prefix + '-' + i);
                    if (bar) {
                        bar.setAttribute('opacity', 1);
                        litBars[id] = i;
                    }
                } else if (litBars[id] === i) {
                    var lit = document.getElementById(marks.bar.prefix + '-' + i);
                    if (lit) { lit.setAttribute('opacity', marks.bar.dim); }
                    litBars[id] = null;
                }
            }
            var tip = document.getElementById('wx-tip-' + id);
            if (tip) {
                var text = active ? charts.tipText(id, view, i, ctx.S) : '';
                if (text) {
                    // Fill and show first, THEN measure: the clamp needs the
                    // tip's real width, or the centered tip clips against
                    // the viewport's overflow:hidden near the edges.
                    tip.textContent = text;
                    tip.style.display = 'block';
                    var vpEl = tip.parentNode;
                    var vw = vpEl && vpEl.clientWidth;
                    var left = (x - panDay * charts.DAY_W) / charts.DAY_W * (vw || 0);
                    if (vw) {
                        var half = tip.offsetWidth / 2 + 4;
                        if (left < half) { left = half; }
                        if (left > vw - half) { left = vw - half; }
                        tip.style.left = Math.round(left) + 'px';
                    } else {
                        tip.style.left = '50%';
                    }
                } else {
                    tip.style.display = 'none';
                }
            }
        }
        var chip = document.getElementById('wx-strip-hi');
        if (chip) {
            // The chip takes the renderer's clamped x (nudged off the day
            // seams), not the crosshair's raw x.
            chip.setAttribute('transform', 'translate(' + charts.stripChipX(view, i) + ' 0)');
        }
        var chipText = document.getElementById('wx-strip-hi-text');
        if (chipText) {
            var hh = model.localHour(view.times[i], view.offsetSec);
            chipText.textContent = (hh < 10 ? '0' + hh : String(hh)) + ':00';
        }
        var chipIcon = document.getElementById('wx-strip-hi-icon');
        if (chipIcon) {
            // Both href flavors, like the renderer (old WebViews read
            // xlink). A data-less hour gets the renderer's blank
            // placeholder — never the previous hour's stale glyph.
            var ref = view.icon[i] ? '#wxi-h' + view.icon[i] : '#wxi-hnone';
            chipIcon.setAttribute('href', ref);
            try {
                chipIcon.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', ref);
            } catch (ex) { /* pre-namespace DOM: href alone has to do */ }
        }
    }

    /**
     * Re-establish the crosshair paint after a render replaced the DOM
     * (the rendered string parks all the crosshair extras).
     * @returns {void}
     */
    function repaintScrub() {
        var view = fetchState.view;
        if (!view) { return; }
        paintScrub(scrubIndex === null ? dayAnchorIndex(view, panDay) : scrubIndex, scrubIndex !== null);
    }

    /**
     * After the viewed day changes, drop the crosshair (its hour belongs to
     * the previous day) and re-anchor every readout to the new day — direct
     * DOM, like the pan itself.
     * @returns {void}
     */
    function syncReadouts() {
        scrubIndex = null;
        var view = fetchState.view;
        if (!view) { return; }
        paintScrub(dayAnchorIndex(view, panDay), false);
    }

    /**
     * Center the selected day tile in the strip's scroll window — called on
     * an actual DAY CHANGE (tile tap, pan snap onto a new day), never on a
     * spring-back to the same day, which must not discard a scroll the user
     * made themselves.
     * @returns {void}
     */
    function scrollDayStrip() {
        if (typeof document === 'undefined' || !document.querySelector) { return; }
        var row = document.querySelector('.wx-days');
        if (!row) { return; }
        var sel = row.querySelector('.wx-day.sel') || row.querySelector('.wx-day.today');
        if (!sel || !row.clientWidth) { return; }
        var target = sel.offsetLeft - (row.clientWidth - sel.offsetWidth) / 2;
        if (target < 0) { target = 0; }
        row.scrollLeft = target;
    }

    /**
     * Put the rebuilt strip back where the user had it after a render (the
     * engine replaces #scroll.innerHTML wholesale, which resets the row to
     * scrollLeft 0): restore the captured offset, or center the selection
     * when there is nothing to restore (first paint, or a new location's
     * tiles just arrived).
     * @returns {void}
     */
    function applyStripScroll() {
        if (!stripPending) { return; }   // a queued duplicate already ran
        stripPending = false;
        if (stripKeep === null) { scrollDayStrip(); return; }
        var keep = stripKeep;
        stripKeep = null;
        if (typeof document === 'undefined' || !document.querySelector) { return; }
        var row = document.querySelector('.wx-days');
        if (row) { row.scrollLeft = keep; }
    }

    /**
     * Re-mark the day tiles after a pan (direct DOM — no re-render).
     * @returns {void}
     */
    function syncDayCards() {
        if (typeof document === 'undefined' || !document.querySelectorAll) { return; }
        var tiles = document.querySelectorAll('.wx-day');
        for (var i = 0; i < tiles.length; i += 1) {
            var el = tiles[i];
            var on = Number(el.getAttribute('data-action-arg')) === panDay && !el.disabled;
            var name = ' ' + el.className + ' ';
            var has = name.indexOf(' sel ') !== -1;
            if (on && !has) { el.className = el.className + ' sel'; }
            if (!on && has) { el.className = name.replace(' sel ', ' ').replace(/^\s+|\s+$/g, ''); }
        }
    }

    var gesture = null;

    /**
     * Start tracking a pointer that landed on a chart viewport.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Node} target Event target.
     * @returns {void}
     */
    function beginGesture(x, y, target) {
        var vpEl = findAttr(target, 'data-wxvp');
        if (!vpEl || !fetchState.view || !vpEl.getBoundingClientRect) { return; }
        var w = vpEl.getBoundingClientRect().width;
        if (!w) { return; }
        gesture = {
            x0: x, y0: y, t0: Date.now(), vw: w, mode: null,
            base: panDay, days: fetchState.view.days, target: target
        };
    }

    /**
     * Track movement: decide pan vs vertical scroll once, then drag the
     * canvas live (with rubber-banding past the ends).
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Event} e The move event (preventDefault while panning).
     * @returns {void}
     */
    function moveGesture(x, y, e) {
        if (!gesture) { return; }
        var dx = x - gesture.x0;
        var dy = y - gesture.y0;
        if (gesture.mode === null) {
            if (Math.abs(dx) < 7 && Math.abs(dy) < 7) { return; }
            gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll';
        }
        if (gesture.mode !== 'pan') { return; }
        if (e && e.preventDefault) { e.preventDefault(); }
        var f = gesture.base - dx / gesture.vw;
        if (f < 0) { f = f * 0.35; }
        if (f > gesture.days - 1) { f = (gesture.days - 1) + (f - (gesture.days - 1)) * 0.35; }
        setPan(-(f * 100 / gesture.days), false);
    }

    /**
     * Finish: snap a pan to its day, or treat an unmoved press as a
     * crosshair tap.
     * @param {number} x Client x at release.
     * @returns {void}
     */
    function endGesture(x) {
        if (!gesture) { return; }
        var g = gesture;
        gesture = null;
        if (g.mode === 'pan') {
            // A refetch can land mid-gesture and shrink/grow the timeline;
            // snap against the CURRENT day count, not the one at touch-down.
            var days = fetchState.view ? fetchState.view.days : g.days;
            var before = panDay;
            panDay = snapTargetDay(g.base, x - g.x0, g.vw, days, Date.now() - g.t0);
            setPan(panPct(panDay, days), true);
            syncDayCards();
            if (panDay !== before) {
                syncReadouts();
                scrollDayStrip();
            }
            return;
        }
        if (g.mode === null) {
            var chart = findAttr(g.target, 'data-wxchart');
            if (chart) { scrubTo(chart, x); }
        }
    }

    /**
     * Abort (touchcancel): ease back to the resting day.
     * @returns {void}
     */
    function cancelGesture() {
        if (!gesture) { return; }
        var g = gesture;
        gesture = null;
        if (g.mode === 'pan') { setPan(panPct(panDay, g.days), true); }
    }

    /**
     * Move the shared crosshair to the tapped hour and repaint every
     * panel's scrub state (guideline, readout, dots, lit bar, value tip,
     * strip chip) by direct DOM writes — no re-render. Values remain
     * reachable without it — the readout defaults to "now" and the in-plot
     * axes carry the scale.
     * @param {Element} svg The panel SVG under the pointer (the WIDE one).
     * @param {number} clientX Pointer x.
     * @returns {void}
     */
    function scrubTo(svg, clientX) {
        var view = fetchState.view;
        if (!view || !ctx) { return; }
        var rect = svg.getBoundingClientRect();
        if (!rect.width) { return; }
        var vx = (clientX - rect.left) / rect.width * (view.days * charts.DAY_W);
        var i = Math.round(vx / charts.HOUR_W);
        if (i < 0) { i = 0; }
        if (i > view.times.length - 1) { i = view.times.length - 1; }
        scrubIndex = i;
        paintScrub(i, true);
    }

    // --- pull-to-refresh: a downward pull from the page top on the Weather
    // tab refetches manually (the only refresh path besides the footer link
    // and reopening the tab — no timers, to spare keyed APIs).

    var PULL_TRIGGER_PX = 70;
    var pull = null;   // {x0, y0, engaged, armed}

    /**
     * The page's current scroll offset (whichever element scrolls).
     * @returns {number} Pixels scrolled from the top.
     */
    function pageScrollTop() {
        var sc = document.getElementById('scroll');
        var a = sc ? sc.scrollTop : 0;
        var de = document.documentElement;
        var b = (typeof window !== 'undefined' && window.pageYOffset)
            || (de && de.scrollTop) || (document.body && document.body.scrollTop) || 0;
        return a > b ? a : b;
    }

    /**
     * Show/update the pull indicator pill (created lazily). The pill rides
     * the drag: damped translateY and a fade tied to the pull distance,
     * both written every move — but the TEXT and class only when the armed
     * state actually flips. Rewriting them per touchmove re-laid the pill
     * out every frame, which is what made it stutter.
     * @param {boolean} armed Past the release threshold.
     * @param {number} dy Current downward pull distance (px).
     * @returns {void}
     */
    function showPullPill(armed, dy) {
        var el = document.getElementById('wx-ptr');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wx-ptr';
            document.body.appendChild(el);
        }
        el.style.display = 'block';
        if (el.getAttribute('data-armed') !== String(armed)) {
            el.setAttribute('data-armed', String(armed));
            el.className = armed ? 'on' : '';
            el.textContent = armed ? 'Release to refresh' : 'Pull to refresh';
        }
        var travel = dy * 0.35;
        if (travel > 46) { travel = 46; }
        var fade = dy / 56;
        if (fade > 1) { fade = 1; }
        el.style.opacity = String(fade);
        var t = 'translateX(-50%) translateY(' + travel.toFixed(1) + 'px)';
        el.style.webkitTransform = t;
        el.style.transform = t;
    }

    /** @returns {void} Hide the pull indicator pill. */
    function hidePullPill() {
        var el = document.getElementById('wx-ptr');
        if (el) { el.style.display = 'none'; }
    }

    /**
     * Start tracking a possible pull: Weather tab rendered, no overlay or
     * sheet open, and the page at its top.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @returns {void}
     */
    function beginPull(x, y) {
        pull = null;
        if (!ctx || !document.querySelector) { return; }
        if (!document.querySelector('.wx-days')) { return; }
        if (document.getElementById('wxloc')) { return; }
        var modal = document.getElementById('modal');
        if (modal && modal.open) { return; }
        if (pageScrollTop() > 0) { return; }
        pull = { x0: x, y0: y, engaged: false, armed: false };
    }

    /**
     * Track a pull in progress; engages on a clearly-vertical downward drag
     * and hands off to the chart pan when that gesture claims the pointer.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @param {?Event} e The move event (preventDefault while engaged).
     * @returns {void}
     */
    function movePull(x, y, e) {
        if (!pull) { return; }
        if (gesture && gesture.mode === 'pan') { pull = null; hidePullPill(); return; }
        var dy = y - pull.y0;
        var dx = x - pull.x0;
        if (!pull.engaged) {
            if (dy < -8) { pull = null; return; }
            if (dy < 14 || Math.abs(dx) > dy) { return; }
            pull.engaged = true;
        }
        if (dy < 0) { pull.engaged = false; pull.armed = false; hidePullPill(); return; }
        if (e && e.preventDefault) { e.preventDefault(); }
        pull.armed = dy >= PULL_TRIGGER_PX;
        showPullPill(pull.armed, dy);
    }

    /**
     * Release: past the threshold → refetch; either way, clean up.
     * @returns {void}
     */
    function endPull() {
        var p = pull;
        pull = null;
        hidePullPill();
        if (p && p.armed && refreshWeather() && ctx) { ctx.render(); }
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('touchstart', function (e) {
            var t = e.touches && e.touches[0];
            if (t && e.touches.length === 1) {
                beginGesture(t.clientX, t.clientY, e.target);
                beginPull(t.clientX, t.clientY);
            }
        }, true);
        // {passive:false}: modern webviews default document-level touchmove
        // to passive, which would ignore the pan's preventDefault; ancient
        // ones read the object as a truthy capture flag, which is also fine.
        document.addEventListener('touchmove', function (e) {
            var t = e.touches && e.touches[0];
            if (t) {
                moveGesture(t.clientX, t.clientY, e);
                movePull(t.clientX, t.clientY, e);
            }
        }, { passive: false, capture: true });
        document.addEventListener('touchend', function (e) {
            // A second finger lifting must not end the primary gesture at
            // its x — only the LAST finger ends the interaction.
            if (e.touches && e.touches.length) { return; }
            var t = e.changedTouches && e.changedTouches[0];
            if (t) { endGesture(t.clientX); } else { cancelGesture(); }
            endPull();
        }, true);
        document.addEventListener('touchcancel', function () {
            cancelGesture();
            pull = null;
            hidePullPill();
        }, true);
        document.addEventListener('mousedown', function (e) {
            beginGesture(e.clientX, e.clientY, e.target);
            beginPull(e.clientX, e.clientY);
        }, true);
        document.addEventListener('mousemove', function (e) {
            // e.buttons is authoritative where it exists (0 = no button —
            // e.which stays 1 on plain moves in WebKit, so `buttons||which`
            // would treat every hover as a drag); which is the old-engine
            // fallback only when buttons is genuinely undefined.
            var down = e.buttons !== undefined ? e.buttons : e.which;
            if (down) {
                moveGesture(e.clientX, e.clientY, e);
                movePull(e.clientX, e.clientY, e);
            }
        }, true);
        document.addEventListener('mouseup', function (e) {
            endGesture(e.clientX);
            endPull();
        }, true);
    }

    // --- registrations ------------------------------------------------------------

    if (PConf.blocks && PConf.blocks.register) {
        PConf.blocks.register('weatherLocations', weatherLocationsBlock);
        PConf.blocks.register('weatherGraphs', weatherGraphsBlock);
    }

    if (PConf.optionsResolvers && PConf.optionsResolvers.register) {
        PConf.optionsResolvers.register('graphsProviderOptions', function (S) {
            return graphsProviderOptions(S);
        });
    }

    if (PConf.displayResolvers && PConf.displayResolvers.register) {
        PConf.displayResolvers.register('graphsProviderHeader', function (S) {
            return graphsProviderHeader(S);
        });
    }

    if (PConf.actions) {
        PConf.actions.wxSelectLocation = function (arg, S) {
            S.graphsLocation = String(arg);
            scrubIndex = null;
            return true;
        };
        PConf.actions.wxEditLocation = function (arg, S) {
            var slot = arg === 'new' ? firstFreeSlot(S) : parseInt(arg, 10);
            if (!slot) { return false; }
            openOverlay(slot);
            return false;
        };
        PConf.actions.wxRemoveLocation = function (arg, S) {
            var idx = parseInt(arg, 10);
            if (!(idx >= 1 && idx <= 3)) { return false; }
            S[model.SLOT_KEYS[idx - 1]] = '';
            if (S.graphsLocation === String(idx)) { S.graphsLocation = 'current'; }
            fetchState.key = null;
            return true;
        };
        PConf.actions.wxShowDay = function (arg) {
            var view = fetchState.view;
            if (!view) { return false; }
            var d = parseInt(arg, 10);
            if (!(d >= 0)) { return false; }
            if (d > view.days - 1) { d = view.days - 1; }
            var before = panDay;
            panDay = d;
            setPan(panPct(d, view.days), true);
            syncDayCards();
            if (d !== before) {
                syncReadouts();
                scrollDayStrip();
            }
            return false;
        };
        PConf.actions.wxRetryWeather = function () {
            data.clearCache();
            fetchState = { key: null, status: 'idle', data: null, error: null, view: null };
            return true;
        };
        PConf.actions.wxRefreshWeather = function () {
            return refreshWeather();
        };
    }

    if (PConf.hooks && PConf.hooks.onReady) {
        PConf.hooks.onReady(function (engineCtx) {
            ctx = engineCtx;
            if (typeof document !== 'undefined' && !document.getElementById('wx-style')) {
                var style = document.createElement('style');
                style.id = 'wx-style';
                style.textContent = WX_CSS + OVERLAY_CSS;
                document.head.appendChild(style);
            }
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            weatherLocationsBlock: weatherLocationsBlock,
            weatherGraphsBlock: weatherGraphsBlock,
            graphsProviderOptions: graphsProviderOptions,
            graphsProviderHeader: graphsProviderHeader,
            firstFreeSlot: firstFreeSlot,
            snapTargetDay: snapTargetDay,
            panPct: panPct,
            refreshWeather: refreshWeather,
            // Test seams.
            _setCtx: function (c) { ctx = c; },
            _fetchState: function () { return fetchState; },
            _panDay: function () { return panDay; },
            _gpsSeed: function () { return gpsSeed; },
            _resetState: function () {
                ctx = null;
                fetchState = { key: null, status: 'idle', data: null, error: null, view: null };
                inFlight = null;
                scrubIndex = null;
                panDay = 0;
                gpsSeed = null;
                revFor = null;
                stripKeep = null;
                stripPending = false;
                stripFresh = false;
                panelMarks = null;
                litBars = {};
            }
        };
    }
})();

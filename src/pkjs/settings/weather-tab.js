// src/pkjs/settings/weather-tab.js — the Weather tab's glue: the location
// chip row + saved-location editor overlay, the tab-local provider select,
// the graphs/daily-strip block, in-page fetch orchestration, and the
// crosshair scrub. ES5, WebView.
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
    var editingSlot = null;         // overlay target: 1..3

    /**
     * The phone-injected current-location seed, if any.
     * @param {Object} userData Injected userData.
     * @returns {?{lat: number, lon: number, name: string}} Seed or null.
     */
    function seedOf(userData) {
        var s = userData && userData.graphsSeed;
        if (!s || !isFinite(Number(s.lat)) || !isFinite(Number(s.lon))) { return null; }
        return { lat: Number(s.lat), lon: Number(s.lon), name: s.name || 'Current location' };
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
     * @param {string} body SVG markup.
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
     * The graphs block: fetch status, five panels, and the 5-day strip.
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
        var idx = scrubIndex === null ? view.nowIndex : scrubIndex;
        var h = '';
        // The 5-day strip leads, above the hourly graphs — the WarnWeather
        // app's layout (day tiles first, detail below).
        h += '<div class="wx-panel"><div class="wx-panel-head"><span class="wx-panel-title">5-day forecast</span></div>'
            + charts.dailyStripHtml(view.daily, settings, pal, view.offsetSec, Date.now()) + '</div>';
        h += panelHtml('temp', 'Temperature & precipitation',
            [['Temp', pal.temp, 'line'], ['Rain', pal.water, 'rect']],
            charts.readout('temp', view, idx, settings),
            charts.tempPanelSvg(view, settings, pal));
        h += panelHtml('wind', 'Wind & gusts · ' + model.windUnitLabel(settings),
            [['Wind', pal.water, 'line'], ['Gusts', pal.gust, 'line']],
            charts.readout('wind', view, idx, settings),
            charts.windPanelSvg(view, settings, pal));
        h += panelHtml('hum', 'Humidity & dew point',
            [['Humidity', pal.water, 'rect'], ['Temp', pal.temp, 'line'], ['Dew point', pal.dew, 'line']],
            charts.readout('hum', view, idx, settings),
            charts.humidityPanelSvg(view, settings, pal));
        h += panelHtml('press', 'Pressure · hPa', [],
            charts.readout('press', view, idx, settings),
            charts.pressurePanelSvg(view, settings, pal));
        var sunCalcLib = (typeof require !== 'undefined') ? require('./vendor-suncalc.js') : window.SunCalc;
        if (sunCalcLib) {
            h += panelHtml('sun', 'Sun & moon',
                [['Sun', pal.sun, 'line'], ['Moon', pal.faint, 'line']],
                '',
                charts.sunMoonPanelSvg(loc, Date.now(), pal, sunCalcLib, view.offsetSec));
        }
        var providerLabel = fetchState.data && fetchState.data.meta ? fetchState.data.meta.provider : '';
        for (var i = 0; i < model.GRAPH_PROVIDERS.length; i += 1) {
            if (model.GRAPH_PROVIDERS[i].id === providerLabel) { providerLabel = model.GRAPH_PROVIDERS[i].label; }
        }
        var meta = fetchState.data && fetchState.data.meta;
        var age = meta ? Math.max(0, Math.round((Date.now() - meta.fetchedAt) / 60000)) : 0;
        h += '<div class="wx-foot">' + charts.esc(loc.name) + ' · ' + charts.esc(providerLabel)
            + ' · ' + (refetching ? 'updating…' : (age === 0 ? 'just now' : age + ' min ago')) + '</div>';
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
        + '.wx-panel-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:10px 0 2px;}'
        + '.wx-panel-title{font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ttl);flex:1;}'
        + '.wx-key{font-size:11px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;}'
        + '.wx-key-line{display:inline-block;width:12px;height:2px;border-radius:1px;}'
        + '.wx-key-rect{display:inline-block;width:8px;height:8px;border-radius:2px;}'
        + '.wx-readout{font-size:12px;color:var(--muted);margin:2px 0 4px;font-variant-numeric:tabular-nums;}'
        + '.wx-status{color:var(--hint);font-size:14px;padding:10px 0;}'
        + '.wx-retry{background:var(--ctl);color:var(--fg);border:none;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;}'
        + '.wx-days{display:flex;gap:6px;margin-top:6px;}'
        + '.wx-day{flex:1;background:var(--ctl);border-radius:12px;padding:8px 4px;text-align:center;}'
        + '.wx-day.today{outline:1px solid var(--card-line);}'
        + '.wx-day-name{font-size:11px;font-weight:600;color:var(--lbl);}'
        + '.wx-day-icon{margin:4px 0 2px;min-height:26px;}'
        + '.wx-day-temp{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}'
        + '.wx-day-temp span{color:var(--muted);font-weight:400;}'
        + '.wx-day-meta{font-size:10px;color:var(--muted);margin-top:2px;min-height:12px;font-variant-numeric:tabular-nums;}'
        + '.wx-day-meta span{color:var(--hint);}'
        + '.wx-foot{color:var(--hint);font-size:11px;margin-top:2px;}';

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

    // --- scrub (crosshair) ----------------------------------------------------------

    /**
     * Move the shared crosshair to the pointer's hour and refresh every
     * panel's guideline + readout by direct DOM writes (no re-render, so the
     * gesture stays smooth in old webviews). Values remain reachable without
     * it — the readout defaults to "now" and the axes carry the scale.
     * @param {Element} svg The panel SVG under the pointer.
     * @param {number} clientX Pointer x.
     * @returns {void}
     */
    function scrubTo(svg, clientX) {
        var view = fetchState.view;
        if (!view || !ctx) { return; }
        var rect = svg.getBoundingClientRect();
        if (!rect.width) { return; }
        var vx = (clientX - rect.left) / rect.width * charts.W;
        var n = view.times.length;
        var frac = (vx - charts.PAD_L) / (charts.W - charts.PAD_L - charts.PAD_R);
        var i = Math.round(frac * (n - 1));
        if (i < 0) { i = 0; }
        if (i > n - 1) { i = n - 1; }
        scrubIndex = i;
        var x = charts.xAt(view, i);
        var ids = ['temp', 'wind', 'hum', 'press'];
        for (var k = 0; k < ids.length; k += 1) {
            var line = document.getElementById('wx-scrub-' + ids[k]);
            if (line) {
                line.setAttribute('x1', x);
                line.setAttribute('x2', x);
            }
            var read = document.getElementById('wx-read-' + ids[k]);
            if (read) {
                read.textContent = charts.readout(ids[k], view, i, ctx.S);
            }
        }
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
        var onScrub = function (e) {
            var t = e.target;
            while (t && t.getAttribute && !t.getAttribute('data-wxchart')) { t = t.parentNode; }
            if (!t || !t.getAttribute) { return; }
            var touch = e.touches && e.touches[0];
            scrubTo(t, touch ? touch.clientX : e.clientX);
        };
        document.addEventListener('mousedown', onScrub, true);
        document.addEventListener('mousemove', function (e) {
            if (e.buttons || e.which) { onScrub(e); }
        }, true);
        document.addEventListener('touchstart', onScrub, true);
        document.addEventListener('touchmove', onScrub, true);
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
        PConf.actions.wxRetryWeather = function () {
            data.clearCache();
            fetchState = { key: null, status: 'idle', data: null, error: null, view: null };
            return true;
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
            firstFreeSlot: firstFreeSlot,
            // Test seams.
            _setCtx: function (c) { ctx = c; },
            _fetchState: function () { return fetchState; },
            _resetState: function () {
                ctx = null;
                fetchState = { key: null, status: 'idle', data: null, error: null, view: null };
                inFlight = null;
                scrubIndex = null;
            }
        };
    }
})();

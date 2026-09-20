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
    var stripIcons = null;          // night-resolved per-hour icon ids from the last render (the chip swap)
    var litBars = {};               // panel id → bar index currently lit by the crosshair
    var settleTimer = null;         // pending re-show of tips that rode a pan off-viewport
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
     * One panel wrapper: title, legend keys, chart body. No readout line
     * under the title — the floating tip is the value surface, and the
     * in-plot axes carry the scale.
     * @param {string} title Panel title.
     * @param {Array<Array<string>>} legend [label, color, kind('line'|'rect')] triples.
     * @param {string} body Chart viewport markup.
     * @returns {string} HTML.
     */
    function panelHtml(title, legend, body) {
        var h = '<div class="wx-panel">';
        h += '<div class="wx-panel-head"><span class="wx-panel-title">' + charts.esc(title) + '</span>';
        for (var i = 0; i < legend.length; i += 1) {
            var mark = legend[i][2] === 'rect'
                ? '<span class="wx-key-rect" style="background:' + legend[i][1] + '"></span>'
                : '<span class="wx-key-line" style="background:' + legend[i][1] + '"></span>';
            h += '<span class="wx-key">' + mark + charts.esc(legend[i][0]) + '</span>';
        }
        h += '</div>';
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
        // The chip swaps hour icons by href while scrubbing; it has to
        // agree with the strip's night resolution, so stash the same
        // resolved ids the renderer uses.
        stripIcons = charts.stripIconIds(view, loc, sunCalcLib);
        var h = '';
        // The 5-day strip leads (the app's layout) and doubles as the day
        // selector for everything below it; only its TITLE stays behind
        // when the pinned block below takes off.
        h += '<div class="wx-panel"><div class="wx-panel-head"><span class="wx-panel-title">5-day forecast</span></div></div>';
        // The pinned block: the day tiles AND the shared time axis (hour
        // ruler + condition icons + night shading + the highlighted hour's
        // chip) pin together below the tab bar while the panels scroll
        // (the card wrapper uses overflow:clip precisely so descendant
        // sticky survives; engines that only know overflow:hidden degrade
        // to normal scrolling).
        h += '<div class="wx-sticky">'
            + charts.dailyStripHtml(view.daily, settings, pal, view.offsetSec, Date.now(), panDay, view.days)
            + vp('strip', charts.timeStripSvg(view, loc, pal, sunCalcLib, idx)) + '</div>';
        h += panelHtml('Temperature & precipitation',
            [['Temp', pal.temp, 'line'], ['Rain', pal.water, 'rect']],
            vp('temp', specs.temp));
        h += panelHtml('Wind & gusts · ' + model.windUnitLabel(settings),
            [['Wind', pal.water, 'line'], ['Gusts', pal.gust, 'line']],
            vp('wind', specs.wind));
        h += panelHtml('Humidity & dew point',
            [['Humidity', pal.water, 'rect'], ['Temp', pal.temp, 'line'], ['Dew point', pal.dew, 'line']],
            vp('hum', specs.hum));
        h += panelHtml('Pressure · hPa', [],
            vp('press', specs.press));
        if (sunCalcLib) {
            h += panelHtml('Sun & moon',
                [['Sun', pal.sun, 'line'], ['Moon', pal.faint, 'line']],
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

    // The tab's stylesheet strings live in weather-tab-css.js; injected
    // below in the onReady hook.
    var css = (typeof require !== 'undefined')
        ? require('./weather-tab-css.js') : window.WeatherTabCss;

    // The pointer mechanics (pan gesture, tap-to-scrub handoff,
    // pull-to-refresh) live in weather-tab-interact.js; the wire() call at
    // the bottom hands it this tab's state hooks.
    var interact = (typeof require !== 'undefined')
        ? require('./weather-tab-interact.js') : window.WeatherTabInteract;

    /**
     * Land the viewport on a day: apply the pan, re-mark the tiles, and —
     * only when the day actually changed — re-anchor the crosshair chip and
     * center the day strip (a same-day spring-back must not touch either).
     * Shared by the pan gesture's snap and the day-tile tap.
     * @param {number} d Target day (already clamped by the caller).
     * @returns {void}
     */
    function commitDay(d) {
        var view = fetchState.view;
        var days = view ? view.days : 1;
        var before = panDay;
        panDay = d;
        interact.setPan(interact.panPct(d, days), true);
        syncDayCards();
        if (d !== before) {
            syncAnchors();
            scrollDayStrip();
        } else {
            // Spring-back to the same day: the crosshair survives, so the
            // tips that rode the drag have to land back on their values —
            // on the same eased curve setPan just gave the panels.
            panTips(d, true);
        }
    }

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



    /**
     * The anchor index a freshly shown day rests on: "now" while today is
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
     * Place a filled value tip horizontally for its hour at a (possibly
     * fractional) day offset, and HIDE it once that hour has left the
     * visible day window. A swipe must not leave the overlay floating
     * over a value the viewport no longer shows — so the tip rides its
     * value out of frame and goes with it. Only the horizontal half
     * moves with a pan; paintScrub owns the vertical anchor.
     * @param {Element} tip The tip element (already filled).
     * @param {number} i Hour index the tip describes.
     * @param {number} dayOff Day offset — fractional while a drag is live.
     * @returns {void}
     */
    function placeTipX(tip, i, dayOff) {
        var view = fetchState.view;
        if (!view) { return; }
        var boxEl = tip.parentNode;
        var vw = boxEl && boxEl.clientWidth;
        var crossPx = (charts.xAt(view, i) - dayOff * charts.DAY_W) / charts.DAY_W * (vw || 0);
        // Half a pixel of slack at both edges: a tap's release slop can
        // round to the hour sitting exactly ON the day seam (scrubTo
        // clamps i to the timeline, not the day), which lands crossPx on
        // the boundary — visible, not gone.
        if (vw && (crossPx < -0.5 || crossPx > vw + 0.5)) {
            tip.style.display = 'none';
            return;
        }
        tip.style.display = 'block';
        if (crossPx < 0) { crossPx = 0; }
        if (vw && crossPx > vw) { crossPx = vw; }
        var left = crossPx;
        var half = tip.offsetWidth / 2 + 4;
        if (vw) {
            if (left < half) { left = half; }
            if (left > vw - half) { left = vw - half; }
        }
        tip.style.left = vw ? Math.round(left) + 'px' : '50%';
    }

    /**
     * Put a tip on (or off) the pan's settle curve, so an animated snap
     * carries it at exactly the speed of the values it floats over.
     * @param {Element} tip The tip element.
     * @param {boolean} on Whether its next move should ease.
     * @returns {void}
     */
    function easeTip(tip, on) {
        var css = on ? 'left ' + interact.SETTLE_CSS : '';
        tip.style.webkitTransition = css;
        tip.style.transition = css;
    }

    /**
     * Carry every live value tip along with a pan: each rides its own hour
     * and vanishes the moment that hour scrolls out of the viewport.
     * Called per drag frame with the gesture's fractional day, and on
     * release with the day it settles on.
     *
     * A release is ANIMATED — the panels ease home over SETTLE_MS — so the
     * tips have to be too, or they arrive at their resting x while the
     * values are still sliding and briefly float over nothing. A tip that
     * is still on screen simply eases along the same curve. One that has
     * already gone with its value off-viewport waits out the settle
     * instead: showing it now would park it over a value that has not
     * arrived yet, and it is already invisible, so nothing flickers.
     * @param {number} dayOff Day offset — fractional mid-drag.
     * @param {boolean} animated True when the pan is easing home.
     * @returns {void}
     */
    function panTips(dayOff, animated) {
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        if (scrubIndex === null || !fetchState.view) { return; }
        if (typeof document === 'undefined' || !document.getElementById) { return; }
        var waiting = [];
        for (var k = 0; k < PANEL_IDS.length; k += 1) {
            var tip = document.getElementById('wx-tip-' + PANEL_IDS[k]);
            if (!tip || !tip.innerHTML) { continue; }
            if (animated && tip.style.display === 'none') {
                waiting.push(tip);
                continue;
            }
            easeTip(tip, Boolean(animated));
            placeTipX(tip, scrubIndex, dayOff);
        }
        if (waiting.length) {
            var at = scrubIndex;
            settleTimer = setTimeout(function () {
                settleTimer = null;
                // A fresh scrub while the pan eased owns the tips now —
                // paintScrub has already placed them.
                if (scrubIndex !== at) { return; }
                for (var w = 0; w < waiting.length; w += 1) {
                    easeTip(waiting[w], false);
                    placeTipX(waiting[w], at, dayOff);
                }
            }, interact.SETTLE_MS);
        }
    }

    /**
     * Paint the shared crosshair state at one hour by direct DOM writes (no
     * re-render): every panel's guideline, a highlight dot on every line
     * series (at the same y its path used — the scale comes from the
     * panel's marks), the touched hour's bar lit, the floating value tip,
     * and the hour strip's chip (moved to the hour, relabeled, its icon
     * swapped to that hour's own glyph). `active` false is the parked
     * state: guides, dots, lit bars and tips withdraw; the chip rests on
     * the anchor hour.
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
                var html = active ? charts.tipHtml(id, view, i, ctx.S) : '';
                if (html) {
                    // Fill and show first, THEN measure: the placement
                    // below needs the tip's real rendered size.
                    tip.innerHTML = html;
                    tip.style.display = 'block';
                    // The tip lives in the panel's .wx-bleed — the same
                    // box as the viewport, but unclipped — so a negative
                    // top simply hangs above the plot.
                    var boxEl = tip.parentNode;
                    var vh = boxEl && boxEl.clientHeight;
                    // ALWAYS just above the hour's topmost mark — the
                    // highest dot or bar top (viewBox units → px via the
                    // panel height the marks carry). Near the plot top
                    // the tip overflows the graph upward, over the title
                    // row — allowed by design: it beats dodging sideways
                    // or below, where it read as detached from the value.
                    var topSvg = null;
                    for (var t = 0; t < marks.lines.length; t += 1) {
                        var lt = marks.lines[t];
                        var lv = lt.vals[i];
                        if (lv !== null && lv !== undefined && lt.max > lt.min) {
                            var cy = marks.bottom - (lv - lt.min) / (lt.max - lt.min) * (marks.bottom - marks.top);
                            if (topSvg === null || cy < topSvg) { topSvg = cy; }
                        }
                    }
                    var barTop = (marks.bar && marks.bar.tops
                        && marks.bar.tops[i] !== null && marks.bar.tops[i] !== undefined)
                        ? marks.bar.tops[i] : null;
                    if (barTop !== null && (topSvg === null || barTop < topSvg)) {
                        topSvg = barTop;
                    }
                    var topPx = 4;
                    if (vh && topSvg !== null && marks.H) {
                        topPx = Math.round(topSvg / marks.H * vh - tip.offsetHeight - 8);
                    }
                    tip.style.top = topPx + 'px';
                    // The horizontal half rides the pan, so it lives in
                    // its own function — this resting call and every drag
                    // frame place the tip the same way. A scrub lands at
                    // once: any settle curve left on the tip by an earlier
                    // pan would drag its jump out over SETTLE_MS.
                    easeTip(tip, false);
                    placeTipX(tip, i, panDay);
                } else {
                    tip.style.display = 'none';
                    // Clear the markup too: a filled tip is exactly a LIVE
                    // tip, which is what panTips reads to tell which ones
                    // to carry along with a drag.
                    tip.innerHTML = '';
                }
            }
        }
        var chip = document.getElementById('wx-strip-hi');
        if (chip) {
            // The chip takes the renderer's clamped x (nudged off the day
            // seams), not the crosshair's raw x.
            chip.setAttribute('transform', 'translate(' + charts.stripChipX(view, i) + ' 0)');
        }
        var tick = document.getElementById('wx-strip-hi-tick');
        if (tick) {
            // The ruler tick under the chip stays on the (near-)true hour
            // x — the renderer's seam nudge, not the chip's wide clamp.
            var tx = charts.stripTickX(view, i);
            tick.setAttribute('x1', tx);
            tick.setAttribute('x2', tx);
        }
        var chipText = document.getElementById('wx-strip-hi-text');
        if (chipText) {
            var hh = model.localHour(view.times[i], view.offsetSec);
            chipText.textContent = (hh < 10 ? '0' + hh : String(hh)) + ':00';
        }
        var chipIcon = document.getElementById('wx-strip-hi-icon');
        if (chipIcon) {
            // Both href flavors, like the renderer (old WebViews read
            // xlink). The night-resolved id from the render, so a 2am
            // scrub wears the moon like the strip does; a data-less hour
            // gets the renderer's blank placeholder — never the previous
            // hour's stale glyph.
            var icId = stripIcons ? stripIcons[i] : view.icon[i];
            var ref = icId ? '#wxi-h' + icId : '#wxi-hnone';
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
     * the previous day) and park the chip on the new day's anchor hour —
     * direct DOM, like the pan itself.
     * @returns {void}
     */
    function syncAnchors() {
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


    /**
     * Move the shared crosshair to the tapped hour and repaint every
     * panel's scrub state (guideline, dots, lit bar, value tip, strip
     * chip) by direct DOM writes — no re-render. The in-plot axes carry
     * the scale, so the charts stay readable without a scrub.
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
            commitDay(d);
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
                style.textContent = css.WX_CSS + css.OVERLAY_CSS;
                document.head.appendChild(style);
            }
        });
    }

    // Hand the interaction module this tab's state hooks; it attaches the
    // document listeners once.
    interact.wire({
        view: function () { return fetchState.view; },
        day: function () { return panDay; },
        commitDay: commitDay,
        scrub: scrubTo,
        panTips: panTips,
        canPull: function () { return Boolean(ctx); },
        refresh: function () {
            if (refreshWeather() && ctx) { ctx.render(); }
        }
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            weatherLocationsBlock: weatherLocationsBlock,
            weatherGraphsBlock: weatherGraphsBlock,
            graphsProviderOptions: graphsProviderOptions,
            graphsProviderHeader: graphsProviderHeader,
            firstFreeSlot: firstFreeSlot,
            // The pan mechanics live in weather-tab-interact.js; re-exported
            // for the existing tests.
            snapTargetDay: interact.snapTargetDay,
            panPct: interact.panPct,
            refreshWeather: refreshWeather,
            // Test seams.
            _scrubTo: scrubTo,
            _panTips: panTips,
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
                stripIcons = null;
                litBars = {};
                if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            }
        };
    }
})();

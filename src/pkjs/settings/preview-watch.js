// src/pkjs/settings/preview-watch.js — ES5, WebView (+ Node for tests). The Watchface tab's
// pinned preview (block 'watchPreview'): each view of the cycle — Default, then the flicks —
// drawn as the watch shows it, on its screen's own grid (144×168, emery 200×228) with every
// band on the seat the watch gives it (view-cycle.js stackSeats: the walk layout.c's
// compute_layout makes, presets in their tier's legacy order), in the theme's colours.
// What fills the bands: the top bar and the status bars with the Status bars tab's sample
// slots (preview-status-bars.js barSlots), the calendar around today in its weekday and
// today colours, the clock at the samples' 15:00 in the picked face's weight, and the
// forecast, radar and health graphs as the Graphs tab's previews draw them, laid into the
// band. It is a picture of the layout and the look, not a pixel copy: the watch's own
// fonts, holidays and the clock's anti-aliased glyphs are not modelled. The Layout card's
// preset picker draws each preset's Default view the same way (picture resolver
// 'layoutPresetPicture').
/* global VIEW_CYCLE */
(function () {
    var NODE = typeof require !== 'undefined';
    var PC = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var VC = NODE ? require('../view-cycle.js') : VIEW_CYCLE;
    var svgLib = NODE ? require('./preview-svg.js') : window.PreviewSvg;
    var resolveInk = NODE ? require('../resolve-ink.js') : window.ResolveInk;
    var statusBars = NODE ? require('./preview-status-bars.js') : window.PreviewStatusBars;
    var previewForecast = NODE ? require('./preview-forecast.js') : window.PreviewForecast;
    var forecastSample = NODE ? require('./forecast-sample.js') : window.ForecastSample;
    var spanHours = NODE ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    var esc = NODE ? require('../config-ui/lib/html.js').esc : PC.html.esc;

    /**
     * The radar and health previews, which register as blocks only.
     * @param {string} id 'radarPreview' | 'healthPreview'.
     * @returns {?function} The block function.
     */
    function previewBlock(id) {
        if (NODE) {
            return id === 'radarPreview' ? require('./preview-radar.js').radarPreview
                : require('./preview-health.js').healthPreview;
        }
        return PC && PC.blocks ? PC.blocks.get(id) : null;
    }

    // Each screen family (view-cycle.js FIT_PX's index): its grid, and the row the top bar
    // ends on (the stack's cursor start under it, floor minus the rows a stack has).
    var SCREEN = [
        { w: 144, h: 168, floor: 168 },
        { w: 200, h: 228, floor: 222 }
    ];
    // The views' names, as the Layout card calls them.
    var NAMES = ['Default', 'Flick 1', 'Flick 2'];
    // The watch's text in the page: a narrow system sans stands in for the watch's Gothic.
    var FONT = "Roboto, 'Helvetica Neue', Arial, sans-serif";
    // The clock's three faces, by weight and spacing (the watch's own glyphs are bitmaps).
    var CLOCK_FACE = {
        roboto: { family: FONT, weight: 700, spacing: 0 },
        leco: { family: FONT, weight: 300, spacing: 1 },
        bitham: { family: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", weight: 900, spacing: 0 }
    };
    // The samples' time: the forecast and the status bars' readings are a fixed afternoon.
    var CLOCK_TEXT = '15:00';
    var BAR_OF_SRC = {};
    BAR_OF_SRC[VC.STATUS_SRC_FORECAST] = 'forecast';
    BAR_OF_SRC[VC.STATUS_SRC_HEALTH] = 'health';
    BAR_OF_SRC[VC.STATUS_SRC_RADAR] = 'radar';
    // What a band is called in a view's spoken description, in the Layout card's words.
    var STATUS_NAME = { forecast: 'Forecast Status', health: 'Health Status', radar: 'Radar Status' };
    var GRAPH_NAME = { forecast: 'Forecast', radar: 'Radar', health: 'Health graph' };

    /**
     * A Pebble colour setting as CSS: the stored 0xRRGGBB int, or a hex string as is.
     * @param {*} v The stored value.
     * @param {string} fallback The colour when it is unset.
     * @returns {string} '#RRGGBB'.
     */
    function hex(v, fallback) {
        if (typeof v === 'number' && isFinite(v)) { return '#' + ('000000' + (v >>> 0).toString(16)).slice(-6).toUpperCase(); }
        if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) { return (v.charAt(0) === '#' ? v : '#' + v).toUpperCase(); }
        return fallback;
    }

    /**
     * Black or white, whichever reads over a fill (the watch's gcolor_legible_over).
     * @param {string} fill '#RRGGBB'.
     * @returns {string} '#000000' | '#FFFFFF'.
     */
    function legibleOver(fill) {
        var n = parseInt(fill.slice(1), 16);
        var lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
        return lum > 140 ? '#000000' : '#FFFFFF';
    }

    /**
     * One line of the watch's text.
     * @param {number} x Anchor x.
     * @param {number} y Baseline.
     * @param {number} size Font size.
     * @param {string} fill Colour.
     * @param {string} anchor 'start' | 'middle' | 'end'.
     * @param {number} weight Font weight.
     * @param {string} s The text (escaped here).
     * @param {Object} [face] A CLOCK_FACE entry (family, letter spacing).
     * @returns {string} SVG markup.
     */
    function text(x, y, size, fill, anchor, weight, s, face) {
        var fam = face ? face.family : FONT;
        return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + size + '" fill="' + fill
            + '" text-anchor="' + anchor + '" font-weight="' + weight + '" font-family="' + esc(fam) + '"'
            + (face && face.spacing ? ' letter-spacing="' + face.spacing + '"' : '') + '>' + esc(s) + '</text>';
    }

    function r1(v) { return Math.round(v * 10) / 10; }

    var measureCtx = null;
    /**
     * How wide a line of the watch's text draws: the page's own measure (a canvas, in the
     * font the preview draws with), else an average glyph's width (Node, old webviews).
     * @param {string} s The text.
     * @param {number} size Font size.
     * @param {number} weight Font weight.
     * @returns {number} Width in the screen's units.
     */
    function measure(s, size, weight) {
        try {
            if (!measureCtx && typeof document !== 'undefined' && document.createElement) {
                var c = document.createElement('canvas');
                measureCtx = (c && c.getContext && c.getContext('2d')) || null;
            }
            if (measureCtx && measureCtx.measureText) {
                measureCtx.font = weight + ' ' + size + 'px ' + FONT;
                var w = measureCtx.measureText(s).width;
                if (typeof w === 'number' && w > 0) { return w; }
            }
        } catch (err) { measureCtx = null; }
        return s.length * size * 0.56;
    }

    /**
     * The theme the watch draws: the picked one, or dark on a watch without the light
     * polarity (aplite), as the Status bars preview reads it.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} 'dark' | 'light' | 'bw' | 'bw-light'.
     */
    function themeOf(S, env) {
        return env && env.themePolarity === false ? 'dark' : (S.theme || 'dark');
    }

    /**
     * Where each band of one view sits on its screen: the walk stackSeats makes (a preset
     * in its tier's legacy order: COMPACT top-row-clock, FULL and NONE top-clock-rows), the
     * band that fills taking what the stack leaves, else the whole block moved by the
     * view's Position (layout.c stack_align_offset).
     * @param {!Object} spec One ViewSpec of the cycle.
     * @param {number} f Screen family (0 = 144 px, 1 = emery).
     * @returns {{strip: number, tier: number, bands: !Array<{band: string, y: number, h: number}>}}
     *     The top bar's height (0 without one), the status rows' tier and each band's rows.
     */
    function layoutView(spec, f) {
        var sc = SCREEN[f];
        var walk = spec;
        if (!VC.isStacked(spec)) {
            walk = VC.cloneSpec(spec);
            walk.order = spec.tier === VC.TIER_COMPACT ? 0 : 1;
        }
        var st = VC.stackSeats(walk, f);
        var strip = spec.stripOff ? 0 : sc.floor - VC.FIT_PX.availStrip[f];
        var slack = st.avail - st.need, fillAt = -1, i;
        for (i = 0; i < st.seats.length; i++) { if (st.seats[i].fill) { fillAt = i; } }
        var bands = [], y = (spec.stripOff ? sc.floor - VC.FIT_PX.availNoStrip[f] : strip) + st.lead, clock = null;
        for (i = 0; i < st.seats.length; i++) {
            var seat = st.seats[i];
            var h = seat.pitch + (i === fillAt && slack > 0 ? slack : 0);
            bands.push({ band: seat.band, y: y, h: h });
            if (seat.band === 'C') { clock = bands[i]; }
            y += h + seat.gap;
        }
        if (fillAt >= 0) {
            // The filling band runs to the screen's bottom edge (emery's floor keeps 6 rows the
            // graph's hour labels sit in).
            var last = bands[bands.length - 1];
            if (fillAt === bands.length - 1) { last.h = sc.h - last.y; }
        } else if (slack > 0) {
            var off = alignOffset(spec.align || 0, slack, clock, sc.h);
            for (i = 0; i < bands.length; i++) { bands[i].y += off; }
        }
        return { strip: strip, tier: st.tier, bands: bands };
    }

    /**
     * How far a stack that fills nothing moves down (layout.c stack_align_offset): Top 0,
     * Bottom all the slack, Centre half; the default seats the clock's middle on the
     * screen's midline, clamped into the slack (Centre without a clock).
     * @param {number} align ALIGN_* code.
     * @param {number} slack Free rows under the stack.
     * @param {?{y: number, h: number}} clock The clock's band, if any.
     * @param {number} screenH The screen's height.
     * @returns {number} Rows to move.
     */
    function alignOffset(align, slack, clock, screenH) {
        if (align === VC.ALIGN_TOP) { return 0; }
        if (align === VC.ALIGN_BOTTOM) { return slack; }
        if (align === VC.ALIGN_CENTER || !clock) { return Math.floor(slack / 2); }
        var off = Math.round(screenH / 2 - (clock.y + clock.h / 2));
        return off < 0 ? 0 : (off > slack ? slack : off);
    }

    /**
     * The calendar: its rows of seven days around today (the previous week first on a
     * three-row calendar that starts there), today on a rounded cell in the today colour
     * (Auto: its weekday's), Saturdays and Sundays in theirs and bold where they differ
     * from the ink — all in the ink on a black-and-white watch or theme (calendar_layer.c).
     * @param {Object} S Settings.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {number} rows 2 | 3.
     * @param {{fg: string, color: boolean, f: number, now: Date}} cx Draw context.
     * @returns {string} SVG markup.
     */
    function calendarBand(S, box, rows, cx) {
        var cw = box.w / 7, rh = box.h / rows, e = '', i;
        var startMon = S.weekStartDay !== 'sun';
        var col = startMon ? (cx.now.getDay() + 6) % 7 : cx.now.getDay();
        var todayAt = col + (rows === 3 && S.firstWeek !== 'curr' ? 7 : 0);
        var sun = hex(S.colorSunday, '#FF0055'), sat = hex(S.colorSaturday, '#FF0055');
        var size = cx.f ? 17 : 13;
        /** @param {number} dow @returns {string} */
        function dayColor(dow) {
            if (!cx.color) { return cx.fg; }
            return dow === 0 ? sun : dow === 6 ? sat : cx.fg;
        }
        for (i = 0; i < rows * 7; i++) {
            var d = new Date(cx.now.getFullYear(), cx.now.getMonth(), cx.now.getDate() + (i - todayAt));
            var dow = d.getDay(), x = box.x + (i % 7) * cw, y = box.y + Math.floor(i / 7) * rh;
            var ink = dayColor(dow);
            var bold = (dow === 0 && sun !== cx.fg) || (dow === 6 && sat !== cx.fg);
            if (i === todayAt) {
                // Black is the Auto sentinel: today's cell takes its weekday's colour.
                var pick = hex(S.colorToday, '#000000');
                var fill = !cx.color ? cx.fg : (pick === '#000000' ? ink : pick);
                e += '<rect x="' + r1(x + 1) + '" y="' + r1(y + 1) + '" width="' + r1(cw - 2) + '" height="' + r1(rh - 2)
                    + '" rx="2" fill="' + fill + '"></rect>';
                ink = legibleOver(fill);
                bold = true;
            }
            e += text(x + cw / 2, y + rh / 2 + size * 0.36, size, ink, 'middle', bold ? 700 : 400, String(d.getDate()));
        }
        return e;
    }

    /**
     * The clock: the samples' time, centred in its band in the time colour (the ink on a
     * black-and-white watch or theme), in the picked face's weight.
     * @param {Object} S Settings.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {{fg: string, color: boolean, f: number}} cx Draw context.
     * @returns {string} SVG markup.
     */
    function clockBand(S, box, cx) {
        var face = CLOCK_FACE[S.timeFont] || CLOCK_FACE.roboto;
        var size = cx.f ? 60 : 45;
        var fill = cx.color ? hex(S.colorTime, cx.fg) : cx.fg;
        return text(box.x + box.w / 2, box.y + box.h / 2 + size * 0.36, size, fill, 'middle', face.weight,
            CLOCK_TEXT, face);
    }

    /**
     * A small battery glyph (the Battery item is its glyph alone): an outline, a nub and
     * the sample's 80 % charge.
     * @param {number} x Its left edge.
     * @param {number} mid The row's middle.
     * @param {number} size The row's font size.
     * @param {string} fg Ink.
     * @returns {string} SVG markup.
     */
    function batteryGlyph(x, mid, size, fg) {
        var w = size * 1.25, h = size * 0.6, y = mid - h / 2;
        return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h)
            + '" rx="1.2" fill="none" stroke="' + fg + '" stroke-width="1"></rect>'
            + '<rect x="' + r1(x + w) + '" y="' + r1(mid - h / 5) + '" width="1.4" height="' + r1(h * 0.4) + '" fill="' + fg + '"></rect>'
            + '<rect x="' + r1(x + 1.6) + '" y="' + r1(y + 1.6) + '" width="' + r1((w - 3.2) * 0.8) + '" height="' + r1(h - 3.2)
            + '" fill="' + fg + '"></rect>';
    }

    /**
     * A slot's icon (status-slot-icons.js' copy of the watch's), placed on the row.
     * @param {string} code The slot's item.
     * @param {number} x Left edge.
     * @param {number} mid The row's middle.
     * @param {number} size Icon size.
     * @param {string} fg Ink.
     * @returns {string} SVG markup, '' for an item without one.
     */
    function iconAt(code, x, mid, size, fg) {
        var svg = PC && PC.icons && PC.icons.get ? PC.icons.get(code) : null;
        if (!svg || svg.indexOf('<svg ') !== 0) { return ''; }
        return '<svg x="' + r1(x) + '" y="' + r1(mid - size / 2) + '" width="' + r1(size) + '" height="' + r1(size)
            + '" color="' + fg + '" ' + svg.slice(5);
    }

    /**
     * One bar's row: its three slots' sample text (preview-status-bars.js barSlots), the
     * left one from the left edge, the middle centred, the right one to the right edge,
     * each after its icon where the page has one; the battery item as its glyph.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} bar 'top' | 'forecast' | 'health' | 'radar'.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {number} size Font size.
     * @param {{fg: string, f: number, now: Date, fullDate: boolean}} cx Draw context.
     * @returns {string} SVG markup.
     */
    function rowBand(S, env, bar, box, size, cx) {
        var pad = cx.f ? 3 : 2, e = '';
        var items = statusBars.barSlots(S, env, bar, cx.fullDate, cx.now).filter(function (c) {
            return c.code !== 'empty';
        }).map(function (c) {
            var label = c.text + (c.arrow ? '↗' : '');
            var glyph = c.code === 'battery' && !label;
            var hasIcon = !glyph && Boolean(PC && PC.icons && PC.icons.get && PC.icons.get(c.code));
            return { pos: c.pos, code: c.code, label: label, glyph: glyph, hasIcon: hasIcon };
        });
        /** @param {Object} it @param {number} sz @returns {number} the item's ink width */
        function widthOf(it, sz) {
            var ico = it.glyph ? sz * 1.45 : (it.hasIcon ? sz + 1 : 0);
            return ico + (it.label ? measure(it.label, sz, 700) : 0);
        }
        // A row whose slots would run into each other draws smaller, as far as three
        // quarters of its size (the watch's narrower font fits what the page's cannot).
        var total = 0;
        items.forEach(function (it) { total += widthOf(it, size); });
        var room = box.w - 2 * pad - Math.max(0, items.length - 1) * 4;
        if (total > room) { size = Math.max(size * 0.75, size * room / total); }
        var mid = box.y + box.h / 2, base = mid + size * 0.36;
        items.forEach(function (it) {
            var ico = it.glyph ? size * 1.45 : (it.hasIcon ? size + 1 : 0);
            var w = widthOf(it, size), x0;
            if (it.pos === 'left') { x0 = box.x + pad; }
            else if (it.pos === 'right') { x0 = box.x + box.w - pad - w; }
            else { x0 = box.x + (box.w - w) / 2; }
            if (it.glyph) { e += batteryGlyph(x0, mid, size, cx.fg); }
            else if (it.hasIcon) { e += iconAt(it.code, x0, mid, size, cx.fg); }
            if (it.label) { e += text(x0 + ico, base, size, cx.fg, 'start', 700, it.label); }
        });
        return e;
    }

    /**
     * A graph band: the Graphs tab's own preview of the forecast (drawn over the hours the
     * watch shows, its plot as tall as the band), the radar or the health graph, laid
     * into the band. Its ids take the band's suffix, so two graphs on the page never
     * share a pattern or a clip.
     * @param {string} kind 'forecast' | 'radar' | 'health'.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {Object} userData Page userData (the palette).
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {string} tag The band's id suffix.
     * @returns {string} SVG markup.
     */
    function graphBand(kind, S, env, userData, box, tag) {
        var frame;
        if (kind === 'forecast') {
            var hours = spanHours.shownHours(S, env);
            var frameH = Math.round(200 * box.h / box.w);
            frame = previewForecast.forecastPreview(S, env, userData, {
                sample: forecastSample.sample(hours + 1, S.temperatureUnits),
                bare: true, axisY: Math.max(24, frameH - 13), bleed: false });
        } else {
            var fn = previewBlock(kind === 'radar' ? 'radarPreview' : 'healthPreview');
            frame = fn ? fn(S, env, userData, { bare: true }) : '';
        }
        var u = svgLib.unframe(frame);
        if (!u) { return ''; }
        var inner = u.inner.replace(/id="([^"]+)"/g, 'id="$1-' + tag + '"')
            .replace(/url\(#([^)]+)\)/g, 'url(#$1-' + tag + ')')
            .replace(/href="#([^"]+)"/g, 'href="#$1-' + tag + '"');
        return '<svg x="' + r1(box.x) + '" y="' + r1(box.y) + '" width="' + r1(box.w) + '" height="' + r1(box.h)
            + '" viewBox="0 0 200 ' + u.h + '" preserveAspectRatio="none">' + inner + '</svg>';
    }

    /**
     * The graph a top area or body draws, if it is one.
     * @param {!Object} spec The view.
     * @param {string} band 'T' | 'G'.
     * @returns {?string} 'forecast' | 'radar' | 'health', or null (a calendar or nothing).
     */
    function graphKind(spec, band) {
        if (band === 'T') {
            if (spec.top === VC.TOP_RADAR) { return 'radar'; }
            if (spec.top === VC.TOP_GRAPH) { return spec.topKind === VC.TOP_KIND_HEALTH ? 'health' : 'forecast'; }
            return null;
        }
        return spec.body === VC.BODY_RADAR ? 'radar' : spec.body === VC.BODY_GRAPH ? 'health'
            : spec.body === VC.BODY_NONE ? null : 'forecast';
    }

    /**
     * A view's bands, top to bottom, as a screen reader hears the picture.
     * @param {!Object} spec The view.
     * @param {{strip: number, bands: !Array}} lay Its layout (layoutView).
     * @returns {string} e.g. 'Watch Status, Calendar (2 rows), Clock, Forecast Status, Forecast'.
     */
    function describe(spec, lay) {
        var out = lay.strip ? ['Watch Status'] : [];
        lay.bands.forEach(function (b) {
            if (b.band === 'C') { out.push('Clock'); return; }
            if (b.band === 'A' || b.band === 'B') {
                var bar = BAR_OF_SRC[b.band === 'A' ? spec.statusUpper : spec.statusLower];
                if (bar) { out.push(STATUS_NAME[bar]); }
                return;
            }
            var kind = graphKind(spec, b.band);
            if (kind) { out.push(GRAPH_NAME[kind]); }
            else if (b.band === 'T' && spec.top === VC.TOP_CAL) {
                out.push(spec.tier === VC.TIER_FULL ? 'Calendar (3 rows)' : 'Calendar (2 rows)');
            }
        });
        return out.join(', ');
    }

    /**
     * One view's screen.
     * @param {!Object} spec Its ViewSpec.
     * @param {number} vi Its place in the cycle.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {Object} userData Page userData.
     * @param {number} f Screen family.
     * @param {Date} now Today.
     * @param {string} [idPrefix] What its graphs' ids start with ('w' + vi by default), so
     *     two screens on the page never share one.
     * @returns {{svg: string, label: string}} The <svg>, and its bands as spoken (describe).
     */
    function screenSvg(spec, vi, S, env, userData, f, now, idPrefix) {
        var sc = SCREEN[f], theme = themeOf(S, env), ink = svgLib.previewInk(theme);
        var cx = { fg: ink.fg, color: resolveInk.drawsColor(env, theme), f: f, now: now,
                   fullDate: !statusBars.calendarShown(spec) };
        var lay = layoutView(spec, f), e = '<rect width="' + sc.w + '" height="' + sc.h + '" fill="' + ink.bg + '"></rect>';
        // The rows' tier (layout.c status_tier_for): the squeezed font on a FULL view.
        var rowFull = lay.tier === VC.TIER_FULL;
        if (lay.strip) {
            e += rowBand(S, env, 'top', { x: 0, y: 0, w: sc.w, h: lay.strip }, f ? 16 : 12, cx);
        }
        lay.bands.forEach(function (b, bi) {
            var box = { x: 0, y: b.y, w: sc.w, h: b.h }, tag = (idPrefix || 'w' + vi) + bi;
            if (b.band === 'C') {
                e += clockBand(S, box, cx);
            } else if (b.band === 'A' || b.band === 'B') {
                var bar = BAR_OF_SRC[b.band === 'A' ? spec.statusUpper : spec.statusLower];
                if (bar) { e += rowBand(S, env, bar, box, f ? (rowFull ? 16 : 18) : (rowFull ? 12 : 13.5), cx); }
            } else {
                var kind = graphKind(spec, b.band);
                if (kind) { e += graphBand(kind, S, env, userData, box, tag); }
                else if (b.band === 'T' && spec.top === VC.TOP_CAL) {
                    e += calendarBand(S, box, spec.tier === VC.TIER_FULL ? 3 : 2, cx);
                }
            }
        });
        return { svg: '<svg class="wpv-scr" viewBox="0 0 ' + sc.w + ' ' + sc.h + '" aria-hidden="true" focusable="false">'
            + e + '</svg>', label: describe(spec, lay) };
    }

    // One card per view, on the page (the tab pins the block bare, schema pinBare): the card is
    // its screen, edge to edge on the screen's own background, so no grey shows round the black
    // or white (its round corners clip the screen a little), and its name under it.
    var CSS = '.wpv{display:flex;justify-content:center;align-items:flex-start}'
        + '.wpv-v{flex:1 1 0;min-width:0;max-width:150px;text-align:center}'
        + '.wpv-v+.wpv-v{margin-left:10px}'
        + '.wpv-card{display:block;border-radius:12px;overflow:hidden;'
        + 'box-shadow:0 6px 16px rgba(0,0,0,.35),0 0 0 1px var(--card-line)}'
        + 'body.light .wpv-card{box-shadow:0 4px 12px rgba(0,0,0,.16),0 0 0 1px var(--card-line)}'
        + '.wpv-scr{display:block;width:100%;height:auto}'
        + '.wpv-cap{display:block;margin-top:7px;font:700 11.5px Inter,-apple-system,system-ui,sans-serif;color:var(--muted)}';

    /**
     * Put the block's styles on the page once.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('wpv-style')) { return; }
        var el = document.createElement('style');
        el.id = 'wpv-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    /**
     * The block: every view of the cycle as the watch draws it, side by side and named.
     * @param {Object} S Live settings.
     * @param {Object} env Platform env.
     * @param {Object} [userData] Page userData.
     * @returns {string} HTML.
     */
    function watchPreview(S, env, userData) {
        var st = S || {};
        var views = VC.resolveViewCycle(st, env);
        var f = env && env.platform === 'emery' ? 1 : 0, now = new Date();
        var bg = svgLib.previewInk(themeOf(st, env)).bg;
        var n = 0, figs = '';
        views.forEach(function (spec, i) {
            if (!spec) { return; }
            var name = NAMES[i] || 'View ' + (i + 1), scr = screenSvg(spec, i, st, env, userData || {}, f, now);
            n += 1;
            figs += '<div class="wpv-v" role="img" aria-label="' + esc(name + ': ' + scr.label) + '">'
                + '<div class="wpv-card" style="background:' + bg + '">' + scr.svg + '</div>'
                + '<span class="wpv-cap" aria-hidden="true">' + esc(name) + '</span></div>';
        });
        if (!figs) { return ''; }
        ensureStyle();
        return '<div class="wpv n' + n + '" role="group" aria-label="Your watch">' + figs + '</div>';
    }

    /**
     * The Layout preset picker's picture of one preset (picture resolver
     * 'layoutPresetPicture'): the Default view the preset gives with the settings as they
     * are, drawn as the pinned preview draws it. Custom shows the custom Default view or,
     * until a first pick of Custom has seeded the custom views, the one that pick would seed
     * from the preset in use (view-cycle.js seedCustomKeys).
     * @param {Object} S Live settings.
     * @param {Object} env Platform env.
     * @param {{value: string}} args The option's preset.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {string} The <svg>, '' when the preset has no view to draw.
     */
    function presetPicture(S, env, args, userData) {
        var custom = args.value === 'custom';
        var st = Object.assign({}, S || {}, { layoutPreset: args.value });
        if (custom && !st.customLayoutSeeded) { VC.seedCustomKeys(st, S && S.layoutPreset); }
        var spec = VC.resolveViewCycle(st, env)[0];
        if (!spec) { return ''; }
        var f = env && env.platform === 'emery' ? 1 : 0;
        var svg = screenSvg(spec, 0, st, env, userData || {}, f, new Date(),
            'lp' + String(args.value).replace(/[^A-Za-z0-9]/g, '') + '-').svg;
        // Custom's card carries a pencil: until views of your own are built it shows the
        // preset in use, which would otherwise read as a second copy of that card.
        return custom ? svg.replace(/<\/svg>$/, pencilBadge(SCREEN[f]) + '</svg>') : svg;
    }

    /**
     * A round accent badge with a pencil, in a screen's bottom-right corner.
     * @param {{w: number, h: number}} sc The screen.
     * @returns {string} SVG markup.
     */
    function pencilBadge(sc) {
        var r = sc.w > 150 ? 16 : 12, x = sc.w - r - 4, y = sc.h - r - 4, k = r / 20;
        return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#FA4A35" stroke="#FFFFFF" stroke-width="1.5"></circle>'
            + '<path transform="translate(' + r1(x - 12 * k) + ' ' + r1(y - 12 * k) + ') scale(' + k + ')"'
            + ' d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8.5 18.5 4 20l1.5-4.5Z" fill="none" stroke="#FFFFFF" stroke-width="2.4"'
            + ' stroke-linecap="round" stroke-linejoin="round"></path>';
    }

    if (PC && PC.blocks) { PC.blocks.register('watchPreview', watchPreview); }
    if (PC && PC.pictureResolvers) { PC.pictureResolvers.register('layoutPresetPicture', presetPicture); }
    var api = { watchPreview: watchPreview, layoutView: layoutView, screenSvg: screenSvg, presetPicture: presetPicture,
                SCREEN: SCREEN };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PreviewWatch = api; }
})();

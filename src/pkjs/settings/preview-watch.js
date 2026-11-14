// src/pkjs/settings/preview-watch.js — ES5, WebView (+ Node for tests). The Watchface tab's
// pinned preview (block 'watchPreview'): each view of the cycle — Default, then the flicks —
// drawn as the watch shows it, on its screen's own grid (144×168, emery 200×228) with every
// band on the seat the watch gives it (view-cycle.js stackSeats: the walk layout.c's
// compute_layout makes, presets in their tier's legacy order), in the theme's colours.
// What fills the bands: the top bar and the status bars with the Status bars tab's sample
// slots (preview-status-bars.js barSlots), the calendar around today in its weekday and
// today colours, the clock at the samples' 15:00 in the watch's own digits, and the
// forecast, radar and health graphs as the
// Graphs tab's previews draw them, laid into the band. It is a picture of the layout and
// the look, not a pixel copy: the watch's Gothic text is the page's sans. Holidays are the
// ones the phone has cached for the picked country (userData.holidays). The Time card's
// Clock font picker draws each face's clock the same way (picture resolver
// 'timeFontPicture').
/* global VIEW_CYCLE */
(function () {
    var NODE = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var VC = NODE ? require('../view-cycle.js') : VIEW_CYCLE;
    var svgLib = NODE ? require('./preview-svg.js') : window.PreviewSvg;
    var resolveInk = NODE ? require('../resolve-ink.js') : window.ResolveInk;
    var statusBars = NODE ? require('./preview-status-bars.js') : window.PreviewStatusBars;
    var previewForecast = NODE ? require('./preview-forecast.js') : window.PreviewForecast;
    var forecastSample = NODE ? require('./forecast-sample.js') : window.ForecastSample;
    var spanHours = NODE ? require('../forecast-span-hours.js') : window.ForecastSpanHours;
    // Graph styles (Pebble Time 2): a screen's forecast graph draws its own style's settings
    // (graph-styles-page.js screenSettings).
    var graphStylesPage = NODE ? require('./graph-styles-page.js') : window.GraphStylesPage;
    // The watch's own clock digits (scripts/gen-clock-glyphs-page.js): Roboto and Bitham.
    var clockGlyphs = NODE ? require('./clock-glyphs.generated.js') : window.ClockGlyphs;
    var WT = NODE ? require('./watch-text.js') : window.WatchText;
    var dateFormat = NODE ? require('../date-format.js') : window.DateFormat;
    var esc = NODE ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    // The frame every screen picture sits in: the screen on its own ground, with a margin of it.
    var screenFrame = NODE ? require('./screen-frame.js') : window.ScreenFrame;

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
        return PConf && PConf.blocks ? PConf.blocks.get(id) : null;
    }

    // Each screen family's grid (view-cycle.js FIT_PX's index).
    var SCREEN = [
        { w: 144, h: 168 },
        { w: 200, h: 228 }
    ];
    // A screen's name (screens.js nameOf), the caption under its picture.
    var screens = NODE ? require('../screens.js') : window.Screens;
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
    // What a band is called in a screen's spoken description (a status bar by its name,
    // screens.js barName).
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
     * Where each band of one view sits on its screen: where the watch places it
     * (view-cycle.js stackLayout, layout.c compute_layout, kept in lockstep with it), the
     * clock's ink centred between its neighbours' for the time font drawn. A band that fills
     * the stack and ends it runs on to the screen's bottom edge (emery's floor keeps 4 rows the
     * forecast's hour labels end in: graphBand's foot).
     * @param {!Object} spec One ViewSpec of the cycle.
     * @param {number} f Screen family (0 = 144 px, 1 = emery).
     * @param {{centreOff: number, inkH: number}} [ink] The time font's ink (clockInk), Roboto's
     *     by default.
     * @returns {{strip: number, tier: number, bands: !Array<{band: string, y: number, h: number}>}}
     *     The top bar's height (0 without one), the status rows' tier and each band's rows.
     */
    function layoutView(spec, f, ink) {
        var lay = VC.stackLayout(spec, f, ink || clockInk(null, f, false));
        var last = lay.bands[lay.bands.length - 1];
        if (last && last.band === lay.fill) { last.h = SCREEN[f].h - last.y; }
        return { strip: spec.stripOff ? 0 : STRIP[f].h, tier: lay.tier, bands: lay.bands };
    }

    /**
     * The time font's ink as the watch seats its clock with it (clock_ink.c): its centre's
     * offset in the band and the digits' ink height (clockSet's).
     * @param {?Object} S Settings (timeFont), null for Roboto.
     * @param {number} f Screen family.
     * @param {boolean} bw A black-and-white watch or theme (the 1-bit faces).
     * @returns {{centreOff: number, inkH: number}}
     */
    function clockInk(S, f, bw) {
        var font = S && (S.timeFont === 'leco' || S.timeFont === 'bitham') ? S.timeFont : 'roboto';
        var row = clockGlyphs ? clockGlyphs.ink[f][font] : null, set = clockSet(font, { f: f, bw: bw });
        return { centreOff: row ? row.centreOff : 0, inkH: set ? set.inkH : (f ? 46 : 35) };
    }

    /**
     * Whether the watch marks a day as a holiday: Holiday highlight on, and the phone's
     * cached holidays (userData.holidays, nager-source.js forPage) are those of the country
     * the page has picked, with a nationwide entry that day or one for the picked region
     * (nager-source.js isHoliday). A country the phone holds nothing for marks no day.
     * @param {Object} S Settings.
     * @param {?{country: string, years: Object}} holidays userData.holidays.
     * @param {Date} d The day.
     * @returns {boolean}
     */
    function isHoliday(S, holidays, d) {
        if (S.holidaysEnabled === false || !holidays || !holidays.years) { return false; }
        if (dateFormat.effectiveHolidayCountry(S) !== holidays.country) { return false; }
        var list = holidays.years[d.getFullYear()] || [], region = S.holidayRegion || 'all', i;
        var md = ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        for (i = 0; i < list.length; i++) {
            if (list[i][0] !== md) { continue; }
            if (list[i][1] === null) { return true; }
            if (region !== 'all' && list[i][1] && list[i][1].indexOf(region) !== -1) { return true; }
        }
        return false;
    }

    /**
     * C's integer division (truncating toward zero), for the watch's own arithmetic.
     * @param {number} a Dividend.
     * @param {number} b Divisor.
     * @returns {number}
     */
    function cdiv(a, b) {
        var q = a / b;
        return q < 0 ? Math.ceil(q) : Math.floor(q);
    }

    /**
     * The calendar: its rows of seven days around today (the previous week first on a
     * three-row calendar that starts there), today on a rounded cell in the today colour
     * (Auto: its day's), holidays in the holiday colour and Saturdays and Sundays in theirs
     * — all in the ink on a black-and-white watch or theme — and bold: today, a holiday,
     * and a weekend day whose colour differs from the ink (calendar_layer.c). Cells and the
     * digits' seat are the watch's (calendar_cell_rect, calendar_text_top): Gothic 18, 24 on
     * emery, each date centred in its cell, its box 5 rows over the cell's top (emery: the
     * line centred in the cell, then lifted 5, a two-digit date starting with 1 a column left).
     * @param {Object} S Settings.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {number} rows 2 | 3.
     * @param {{fg: string, color: boolean, f: number, now: Date, holidays: ?Object}} cx Draw context.
     * @returns {string} SVG markup.
     */
    function calendarBand(S, box, rows, cx) {
        var cw = cdiv(box.w, 7), rh = cdiv(box.h, rows), e = '', i;
        var startMon = S.weekStartDay !== 'sun';
        var col = startMon ? (cx.now.getDay() + 6) % 7 : cx.now.getDay();
        var todayAt = col + (rows === 3 && S.firstWeek !== 'curr' ? 7 : 0);
        var sun = hex(S.colorSunday, '#FF0055'), sat = hex(S.colorSaturday, '#FF0055');
        var holidayInk = hex(S.colorUSFederal, '#0055FF');
        var size = cx.f ? 24 : 18;
        /** @param {number} dow @param {boolean} holiday @returns {string} */
        function dayColor(dow, holiday) {
            if (!cx.color) { return cx.fg; }
            return holiday ? holidayInk : dow === 0 ? sun : dow === 6 ? sat : cx.fg;
        }
        for (i = 0; i < rows * 7; i++) {
            var d = new Date(cx.now.getFullYear(), cx.now.getMonth(), cx.now.getDate() + (i - todayAt));
            var dow = d.getDay(), x = box.x + cdiv((i % 7) * box.w, 7), y = box.y + cdiv(Math.floor(i / 7) * box.h, rows);
            var holiday = isHoliday(S, cx.holidays, d);
            var ink = dayColor(dow, holiday);
            var bold = holiday || (dow === 0 && sun !== cx.fg) || (dow === 6 && sat !== cx.fg);
            if (i === todayAt) {
                // Black is the Auto sentinel: today's cell takes its weekday's colour.
                var pick = hex(S.colorToday, '#000000');
                var fill = !cx.color ? cx.fg : (pick === '#000000' ? ink : pick);
                e += '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + rh + '" rx="1" fill="' + fill + '"></rect>';
                ink = legibleOver(fill);
                bold = true;
            }
            var day = String(d.getDate());
            var top = cx.f ? y + cdiv(rh - size, 2) - 5 : y - 5;
            var shift = cx.f && day.length === 2 && day.charAt(0) === '1' ? 1 : 0;
            e += WT.inBox(size, bold, { x: x - shift, y: top, w: cw }, 'center', ink, day);
        }
        return e;
    }

    // The system font each time font draws from where the watch has no anti-aliased glyphs
    // (clock_ink.h's table): LECO on every watch, and all three faces on the 144 px
    // black-and-white ones.
    var SYSTEM_CLOCK_FONT = {
        0: { leco: 'LECO_42_NUMBERS' },
        1: { leco: 'LECO_60_NUMBERS_AM_PM' },
        bw: { roboto: 'ROBOTO_BOLD_SUBSET_49', leco: 'LECO_42_NUMBERS', bitham: 'BITHAM_42_MEDIUM_NUMBERS' }
    };

    /**
     * The clock's digits for a time font on this watch: the anti-aliased glyph images where the
     * watch has them, else its system font's 1-bit digits, in one shape — each glyph [width,
     * height, left bearing, top (rows below the set's line top), advance, PNG base64], and the
     * digits' union ink rows (inkTop, inkH: the ink height the band seats, clock_ink.c's).
     * @param {string} font 'roboto' | 'leco' | 'bitham'.
     * @param {{bw: boolean, f: number}} cx Draw context.
     * @returns {?{glyphs: !Array, inkTop: number, inkH: number}}
     */
    function clockSet(font, cx) {
        if (!clockGlyphs) { return null; }
        var name = (cx.bw ? SYSTEM_CLOCK_FONT.bw : SYSTEM_CLOCK_FONT[cx.f])[font];
        if (name) { return clockGlyphs.system[name] || null; }
        var aa = clockGlyphs.faces[cx.f] ? clockGlyphs.faces[cx.f][font] : null;
        return aa ? { inkTop: 0, inkH: aa.inkH, glyphs: aa.glyphs.map(function (g) {
            return [g[0], aa.inkH, g[1], 0, g[2], g[3]];
        }) } : null;
    }

    /**
     * The clock: the samples' time in the time colour (the ink on a black-and-white watch or
     * theme), in the watch's own digits (clockSet), seated as time_layer.c seats them: the
     * digits centred on the band by their advances (layout.h clock_seat_x), their first inked
     * row where the band's ClockInk puts it (clock_ink_top_in_band), each glyph at its pen plus
     * its left bearing. A filter tints them, the time colour flooded through each glyph's
     * alpha, as the watch recolours the glyphs' palettes; a black-and-white theme or watch
     * takes them crisp, every alpha cut at half coverage (clock_glyphs.c).
     * @param {Object} S Settings.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {{fg: string, color: boolean, bw: boolean, f: number}} cx Draw context.
     * @param {string} tag The band's id suffix.
     * @returns {string} SVG markup.
     */
    function clockBand(S, box, cx, tag) {
        var font = S.timeFont === 'leco' || S.timeFont === 'bitham' ? S.timeFont : 'roboto';
        var fill = cx.color ? hex(S.colorTime, cx.fg) : cx.fg;
        var set = clockSet(font, cx);
        if (!set) {
            var face = CLOCK_FACE[font], size = cx.f ? 60 : 45;
            return text(box.x + box.w / 2, box.y + box.h / 2 + size * 0.36, size, fill, 'middle', face.weight,
                CLOCK_TEXT, face);
        }
        var ink = clockGlyphs.ink[cx.f][font], advance = 0, i;
        var idx = CLOCK_TEXT.split('').map(function (c) { return c === ':' ? 10 : c.charCodeAt(0) - 48; });
        for (i = 0; i < idx.length; i++) { advance += set.glyphs[idx[i]][4]; }
        var pen = box.x + Math.floor(box.w / 2) - Math.floor(advance / 2);
        var top = box.y + Math.floor(box.h / 2) + ink.centreOff - Math.floor(set.inkH / 2);
        var id = 'ck-' + tag, imgs = '';
        for (i = 0; i < idx.length; i++) {
            var g = set.glyphs[idx[i]], uri = 'data:image/png;base64,' + g[5];
            imgs += '<image x="' + (pen + g[2]) + '" y="' + (top + g[3] - set.inkTop) + '" width="' + g[0]
                + '" height="' + g[1] + '" preserveAspectRatio="none" href="' + uri + '" xlink:href="' + uri + '"></image>';
            pen += g[4];
        }
        var alpha = cx.color ? 'SourceAlpha' : 'cut';
        return '<filter id="' + id + '" color-interpolation-filters="sRGB">'
            + (cx.color ? '' : '<feComponentTransfer in="SourceAlpha" result="cut">'
                + '<feFuncA type="discrete" tableValues="0 0 1 1"></feFuncA></feComponentTransfer>')
            + '<feFlood flood-color="' + fill + '"></feFlood><feComposite in2="' + alpha + '" operator="in"></feComposite>'
            + '</filter><g filter="url(#' + id + ')">' + imgs + '</g>';
    }

    // A status row as status_row.c lays it out (status_row_layout.c, status_metrics.h): a slot
    // is its icon, STATUS_ROW_ICON_TEXT_GAP, its text and, for a wind reading, the direction
    // arrow after another gap; the edge slots take their full width first, from
    // STATUS_ROW_MARGIN in, and the middle one is centred on the row in what they leave,
    // STATUS_ROW_GROUP_GAP from each. Icons are 6/9 of the line's height (the top strip's 5/9).
    var ROW_MARGIN = 2, ICON_GAP = 3, GROUP_GAP = 4;
    // The top strip's band (layout.c L.top_status): from the window's top pad, as tall as a
    // clamp-free line of its font (STATUS_LARGE_BAND_H, status_min_band_h) — taller than the
    // rows it reserves above the next band, so its line's tails run on into them. calY: where a
    // top area leading under it starts, on the strip's ink (strip_calendar_seat: the pad, the
    // band less STATUS_TOP_STRIP_LIFT, and emery's STATUS_STRIP_CAL_GAP).
    var STRIP = [{ y: 0, h: 17, calY: 15 }, { y: 2, h: 21, calY: 23 }];
    // The Watch battery glyph (battery_glyph.h): the charging bolt's lane (empty while the
    // watch is not charging), a 17 × 10 body, a 2-column nub.
    var BATTERY = { w: 29, h: 10, lane: 10, nub: 2 };

    // status_metrics.h's seat of a line in a band (view-cycle.js, the placement's own copy).
    var seatY = VC.statusSeatY, glyphBelow = VC.statusGlyphBelow;

    /**
     * The Watch battery glyph at the sample's 80 % charge: its body outlined, the charge filled,
     * the nub past its right edge, the bolt's lane empty.
     * @param {number} x The glyph's left edge (its lane's).
     * @param {number} mid The row's cap centre.
     * @param {string} fg Ink.
     * @returns {string} SVG markup.
     */
    function batteryGlyph(x, mid, fg) {
        var bx = x + BATTERY.lane, bw = BATTERY.w - BATTERY.lane - BATTERY.nub, y = mid - BATTERY.h / 2;
        return '<rect x="' + (bx + 0.5) + '" y="' + (y + 0.5) + '" width="' + (bw - 1) + '" height="' + (BATTERY.h - 1)
            + '" fill="none" stroke="' + fg + '" stroke-width="1"></rect>'
            + '<rect x="' + (bx + bw) + '" y="' + (y + 3) + '" width="' + BATTERY.nub + '" height="' + (BATTERY.h - 6)
            + '" fill="' + fg + '"></rect>'
            + '<rect x="' + (bx + 2) + '" y="' + (y + 2) + '" width="' + Math.round((bw - 4) * 0.8) + '" height="'
            + (BATTERY.h - 4) + '" fill="' + fg + '"></rect>';
    }

    /**
     * A slot's icon (status-slot-icons.js' copy of the watch's), placed on the row.
     * @param {?string} svg The glyph (preview-status-bars.js slotIcon), null for none.
     * @param {number} x Left edge.
     * @param {number} mid The row's cap centre.
     * @param {number} size Icon size.
     * @param {string} fg Ink.
     * @returns {string} SVG markup, '' for an item without one.
     */
    function iconAt(svg, x, mid, size, fg) {
        if (!svg || svg.indexOf('<svg ') !== 0) { return ''; }
        return '<svg x="' + r1(x) + '" y="' + r1(mid - size / 2) + '" width="' + r1(size) + '" height="' + r1(size)
            + '" color="' + fg + '" ' + svg.slice(5);
    }

    /**
     * The wind reading's direction arrow (status_row.c's turned sun arrow), up and to the right.
     * @param {number} x Left edge.
     * @param {number} mid The row's cap centre.
     * @param {number} w Its width (ARROW_W).
     * @param {string} fg Ink.
     * @returns {string} SVG markup.
     */
    function arrowAt(x, mid, w, fg) {
        var c = x + w / 2, r = w / 2;
        return '<path d="M' + r1(c - r) + ' ' + r1(mid + r) + 'L' + r1(c + r) + ' ' + r1(mid - r) + 'M' + r1(c) + ' '
            + r1(mid - r) + 'H' + r1(c + r) + 'V' + r1(mid) + '" fill="none" stroke="' + fg
            + '" stroke-width="1.2" stroke-linecap="square"></path>';
    }

    /**
     * A slot's width with a text this wide (status_row_layout.c status_group_w).
     * @param {number} iw Icon width.
     * @param {number} tw Text width.
     * @param {number} sw Suffix (arrow) width.
     * @returns {number}
     */
    function groupW(iw, tw, sw) {
        return iw + (tw > 0 ? (iw > 0 ? ICON_GAP : 0) + tw : 0) + (sw > 0 ? sw + (tw > 0 ? ICON_GAP : 0) : 0);
    }

    /**
     * A slot fitted into a width (status_row_layout.c fit_group): its text shrinks first, the
     * icon and arrow kept; nothing when they alone do not fit.
     * @param {?{iw: number, tw: number, sw: number}} m The slot's measures.
     * @param {number} maxW The room.
     * @returns {?{tw: number, w: number}} The text's width and the slot's, or null.
     */
    function fitSlot(m, maxW) {
        if (!m || maxW <= 0 || m.iw + m.sw > maxW) { return null; }
        var tw = m.tw;
        var room = maxW - m.iw - (m.iw > 0 && tw > 0 ? ICON_GAP : 0) - (m.sw > 0 ? m.sw + (tw > 0 ? ICON_GAP : 0) : 0);
        if (tw > room) { tw = Math.max(0, room); }
        if (m.iw === 0 && tw === 0) { return null; }
        return { tw: tw, w: groupW(m.iw, tw, m.sw) };
    }

    /**
     * Where a row's three slots go (status_row_layout.c status_row_layout).
     * @param {number} cw The row's content width.
     * @param {!Array<?Object>} m Left, middle and right slots' measures (null: empty).
     * @returns {!Array<?{x: number, tw: number}>} Each slot's left edge and text width.
     */
    function placeSlots(cw, m) {
        /** @param {?Object} q @returns {number} */
        function desired(q) { return q && (q.iw > 0 || q.tw > 0) ? groupW(q.iw, q.tw, q.sw) : 0; }
        var d0 = desired(m[0]), d2 = desired(m[2]), b0, b2;
        if (d0 > 0 && d2 > 0) {
            if (d0 + d2 <= cw) { b0 = d0; b2 = d2; }
            else {
                var half = cdiv(cw, 2);
                if (d0 <= d2) { b0 = d0 < half ? d0 : half; b2 = cw - b0; }
                else { b2 = d2 < half ? d2 : half; b0 = cw - b2; }
            }
        } else { b0 = d0 > 0 ? cw : 0; b2 = d2 > 0 ? cw : 0; }
        var left = fitSlot(m[0], b0), right = fitSlot(m[2], b2);
        var x0 = left ? left.w + GROUP_GAP : 0, x1 = right ? cw - right.w - GROUP_GAP : cw;
        var mid = fitSlot(m[1], x1 - x0), midX = 0;
        if (mid) { midX = Math.min(Math.max(cdiv(cw - mid.w, 2), x0), x1 - mid.w); }
        return [left ? { x: 0, tw: left.tw } : null, mid ? { x: midX, tw: mid.tw } : null,
            right ? { x: cw - right.w, tw: right.tw } : null];
    }

    /**
     * @param {boolean} top The Watch bar's strip. @param {number} ch The row's Gothic size.
     * @param {number} h The band's height.
     * @returns {number} The row's icon height.
     */
    function rowIconH(top, ch, h) {
        return Math.min(cdiv(ch * (top ? 5 : 6), 9), h - 2);
    }

    /**
     * A row's three slots measured in the watch's Gothic and laid out as the watch does both:
     * a slot that brought a short form draws it where the row would cut a text, an edge's
     * whole name giving way whenever any text is cut, the wider name first, then the middle
     * where its own is cut, each swap laid out again (status_row.c swap_in_short_forms).
     * @param {Array<Object>} bars The bar's slots (preview-status-bars.js barSlots).
     * @param {number} cw The row's content width. @param {number} ch Its Gothic size.
     * @param {number} iconH Its icon height. @param {number} f Screen family.
     * @returns {{slots: Array<?Object>, placed: Array<?Object>}} Left, middle and right: each
     *     slot's measures and final label, and where it goes (placeSlots).
     */
    function rowLayout(bars, cw, ch, iconH, f) {
        var arrowW = f ? 8 : 6;
        var slots = [null, null, null], at = { left: 0, mid: 1, right: 2 };
        bars.forEach(function (c) {
            if (c.code === 'empty' || !(c.pos in at)) { return; }
            var glyph = c.code === 'battery' && !c.text;
            var icon = glyph ? null : c.icon;
            slots[at[c.pos]] = { label: c.text || '', alt: c.alt, glyph: glyph, icon: icon,
                iw: glyph ? BATTERY.w : (icon ? iconH : 0), tw: c.text ? WT.width(ch, false, c.text) : 0,
                sw: c.arrow ? arrowW : 0 };
        });
        var placed = placeSlots(cw, slots);
        var cut = function (it, p) { return Boolean(it) && it.tw > 0 && !(p && p.tw >= it.tw); };
        for (var round = 0; round < 3; round++) {
            if (!slots.some(function (it, i) { return cut(it, placed[i]); })) { break; }
            var pick = -1;
            [0, 2].forEach(function (i) {
                if (slots[i] && slots[i].alt && (pick < 0 || slots[i].tw > slots[pick].tw)) { pick = i; }
            });
            if (pick < 0 && slots[1] && slots[1].alt && cut(slots[1], placed[1])) { pick = 1; }
            if (pick < 0) { break; }
            slots[pick].label = slots[pick].alt;
            slots[pick].tw = WT.width(ch, false, slots[pick].alt);
            slots[pick].alt = '';
            placed = placeSlots(cw, slots);
        }
        return { slots: slots, placed: placed };
    }

    /**
     * The text each slot of a bar shows on the watch, short forms swapped in where the watch
     * swaps them: on the first screen showing the bar (spec), in its row's font and width.
     * The status bar pictures on the Status bars tab print these.
     * @param {Object} S Settings. @param {Object} env Platform env.
     * @param {string} bar The bar. @param {?Object} spec The screen showing it (null: none).
     * @param {Array<Object>} bars Its slots (preview-status-bars.js barSlots).
     * @returns {{left: string, mid: string, right: string}} Each slot's text.
     */
    function barLabels(S, env, bar, spec, bars) {
        var f = env && env.platform === 'emery' ? 1 : 0, sc = SCREEN[f], pad = f ? 2 : 0, ch;
        if (bar === 'top') { ch = f ? 24 : 18; }
        else {
            var rowFull = Boolean(spec)
                && layoutView(spec, f, clockInk(S, f, Boolean(env && env.color === false))).tier === VC.TIER_FULL;
            ch = f ? (rowFull ? 18 : 24) : (rowFull ? 14 : 18);
        }
        var slots = rowLayout(bars, sc.w - 2 * pad - 2 * ROW_MARGIN, ch, rowIconH(bar === 'top', ch, Infinity), f).slots;
        var out = { left: '', mid: '', right: '' };
        ['left', 'mid', 'right'].forEach(function (pos, i) { if (slots[i]) { out[pos] = slots[i].label; } });
        return out;
    }

    /**
     * One bar's row: its three slots' sample text (preview-status-bars.js barSlots) in the
     * watch's Gothic, each after its icon where the page has one, the battery item as its
     * glyph; seated (status_seat_y, the top strip 2 rows higher) and laid out as the watch
     * does both.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} bar 'top' | 'forecast' | 'health' | 'radar'.
     * @param {{x: number, y: number, w: number, h: number}} box The band.
     * @param {number} ch The row's Gothic size (14 | 18 | 24).
     * @param {{fg: string, f: number, now: Date, fullDate: boolean}} cx Draw context.
     * @returns {string} SVG markup.
     */
    function rowBand(S, env, bar, box, ch, cx) {
        var top = bar === 'top', e = '';
        var lineTop = box.y + seatY(box.h, ch) - (top ? 2 : 0);
        var mid = lineTop + ch - glyphBelow(ch);
        var iconH = rowIconH(top, ch, box.h);
        var row = rowLayout(statusBars.barSlots(S, env, bar, cx.fullDate, cx.now), box.w - 2 * ROW_MARGIN,
            ch, iconH, cx.f);
        var slots = row.slots, placed = row.placed, x0 = box.x + ROW_MARGIN;
        placed.forEach(function (p, i) {
            if (!p) { return; }
            var it = slots[i], x = x0 + p.x;
            if (it.glyph) { e += batteryGlyph(x, mid, cx.fg); }
            else if (it.icon) { e += iconAt(it.icon, x, mid, iconH, cx.fg); }
            var tx = x + it.iw + (it.iw > 0 && p.tw > 0 ? ICON_GAP : 0);
            if (p.tw > 0) { e += WT.line(ch, false, tx, lineTop, cx.fg, WT.fit(ch, false, it.label, p.tw)); }
            if (it.sw > 0 && p.tw > 0) { e += arrowAt(tx + p.tw + ICON_GAP, mid, it.sw, cx.fg); }
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
            // The band at the watch's own scale (forecastPreview opts.watch): u frame units a
            // watch pixel, its hour axis BOTTOM_VIEW_AXIS_H over the band's foot (emery's 10 more
            // for its labels, BOTTOM_VIEW_BOTTOM_PAD, over the window's bottom pad).
            var f = box.w === SCREEN[1].w ? 1 : 0, unit = 200 / box.w;
            var foot = Math.min(box.y + box.h, SCREEN[f].h - (f ? 4 : 0)) - box.y;
            frame = previewForecast.forecastPreview(S, env, userData, {
                sample: forecastSample.sample(hours + 1, S.temperatureUnits),
                bare: true, axisY: Math.max(12, foot - (f ? 20 : 10)) * unit, bleed: false,
                watch: { u: unit, f: f, w: box.w, h: box.h * unit, pad: f ? 2 : 0,
                    large: Boolean(f) && S.largeGraphFont !== false } });
        } else {
            var fn = previewBlock(kind === 'radar' ? 'radarPreview' : 'healthPreview');
            frame = fn ? fn(S, env, userData, { bare: true }) : '';
        }
        var u = svgLib.unframe(frame);
        if (!u) { return ''; }
        var inner = svgLib.tagIds(u.inner, tag);
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
     * The graphs a view draws, top to bottom (its layout's bands): what a legend of it lists
     * (screen-legend.js).
     * @param {?Object} spec The view.
     * @param {number} f Screen family (0 = 144 px, 1 = emery).
     * @returns {string[]} 'forecast' | 'radar' | 'health' each
     */
    function graphKinds(spec, f) {
        var out = [];
        if (!spec) { return out; }
        layoutView(spec, f).bands.forEach(function (b) {
            var kind = b.band === 'T' || b.band === 'G' ? graphKind(spec, b.band) : null;
            if (kind) { out.push(kind); }
        });
        return out;
    }

    /**
     * A view's bands, top to bottom, as a screen reader hears the picture: a status bar by its
     * name (screens.js barName).
     * @param {!Object} spec The view.
     * @param {{strip: number, bands: !Array}} lay Its layout (layoutView).
     * @param {Object} S Settings (the bars' names).
     * @returns {string} e.g. 'Watch bar, Calendar (2 rows), Clock, Forecast bar, Forecast'.
     */
    function describe(spec, lay, S) {
        var out = lay.strip ? [screens.barName(S, 'top')] : [];
        lay.bands.forEach(function (b) {
            if (b.band === 'C') { out.push('Clock'); return; }
            if (b.band === 'A' || b.band === 'B') {
                var bar = VC.barOfSource(b.band === 'A' ? spec.statusUpper : spec.statusLower);
                if (bar) { out.push(screens.barName(S, bar)); }
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
     * A screen picture's <svg>: the screen's grid in the frame every screen picture shares
     * (screen-frame.js), the watch's ground all round it, so the card's round corners clip only
     * that margin.
     * @param {number} w The drawing's width (the screen's).
     * @param {number} h Its height (the screen's, or a band's).
     * @param {string} bg The watch's background.
     * @param {string} inner What is drawn on it, in the screen's coordinates.
     * @returns {string} SVG markup.
     */
    function framedSvg(w, h, bg, inner) {
        return screenFrame.svg(w, h, bg, inner, 'wpv-scr');
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
     * @returns {{svg: string, label: string, bg: string}} The <svg> (framed: framedSvg), its bands
     *     as spoken (describe), and the watch's background it is drawn on.
     */
    function screenSvg(spec, vi, S, env, userData, f, now, idPrefix) {
        var sc = SCREEN[f], theme = themeOf(S, env), ink = svgLib.previewInk(theme);
        var cx = { fg: ink.fg, color: resolveInk.drawsColor(env, theme), bw: Boolean(env && env.color === false),
                   f: f, now: now, fullDate: !statusBars.calendarShown(spec),
                   holidays: (userData && userData.holidays) || null };
        var lay = layoutView(spec, f, clockInk(S, f, cx.bw)), e = '';
        // The forecast graph draws the screen's graph style, as the watch does (the view's
        // style, where the watch has styles and the style exists); every other band the
        // settings as they are.
        var graphS = graphStylesPage.screenSettings(S, env, spec);
        // The rows' tier (layout.c status_tier_for): the squeezed font on a FULL view.
        var rowFull = lay.tier === VC.TIER_FULL;
        // emery's window keeps LAYOUT_PAD_X columns clear at each side of its text bands (layout.c).
        var pad = f ? 2 : 0;
        if (lay.strip) {
            e += rowBand(S, env, 'top', { x: pad, y: STRIP[f].y, w: sc.w - 2 * pad, h: STRIP[f].h }, f ? 24 : 18, cx);
        }
        lay.bands.forEach(function (b, bi) {
            var box = { x: 0, y: b.y, w: sc.w, h: b.h }, tag = (idPrefix || 'w' + vi) + bi;
            var inset = { x: pad, y: b.y, w: sc.w - 2 * pad, h: b.h };
            if (b.band === 'C') {
                e += clockBand(S, box, cx, tag);
            } else if (b.band === 'A' || b.band === 'B') {
                var bar = VC.barOfSource(b.band === 'A' ? spec.statusUpper : spec.statusLower);
                if (bar) { e += rowBand(S, env, bar, inset, f ? (rowFull ? 18 : 24) : (rowFull ? 14 : 18), cx); }
            } else {
                var kind = graphKind(spec, b.band);
                if (kind) { e += graphBand(kind, kind === 'forecast' ? graphS : S, env, userData, box, tag); }
                else if (b.band === 'T' && spec.top === VC.TOP_CAL) {
                    e += calendarBand(S, inset, spec.tier === VC.TIER_FULL ? 3 : 2, cx);
                }
            }
        });
        return { svg: framedSvg(sc.w, sc.h, ink.bg, e), label: describe(spec, lay, S), bg: ink.bg };
    }

    // One card per view, on the page (the tab pins the block bare, schema pinBare): the card is
    // its screen on the screen's own background, black or white throughout, so no grey shows
    // round it; the screen keeps a margin of that ground (framedSvg), so the card's round
    // corners clip nothing on it. Its name under it.
    var CSS = '.wpv{display:flex;justify-content:center;align-items:flex-start}'
        + '.wpv-v{flex:1 1 0;min-width:0;max-width:150px;text-align:center}'
        + '.wpv-v+.wpv-v{margin-left:10px}'
        + '.wpv-card{display:block;border-radius:12px;overflow:hidden;'
        + 'box-shadow:0 6px 16px rgba(0,0,0,.35),0 0 0 1px var(--card-line)}'
        + 'body.light .wpv-card{box-shadow:0 4px 12px rgba(0,0,0,.16),0 0 0 1px var(--card-line)}'
        + '.wpv-scr{display:block;width:100%;height:auto}'
        + '.wpv-cap{display:block;margin-top:7px;font:700 11.5px Inter,-apple-system,system-ui,sans-serif;color:var(--muted)}'
        // A screen is a button that opens its editor (screens-page.js), on every watch but aplite.
        + '.wpv-btn{border:none;background:none;padding:0;margin:0;cursor:pointer;font:inherit;color:inherit}'
        + '.wpv-btn:focus-visible .wpv-card{box-shadow:0 0 0 2px var(--link)}'
        + '.wpv-tap{display:block;margin-top:8px;text-align:center;font:500 11px Inter,-apple-system,system-ui,sans-serif;color:var(--faint)}';

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
     * The block: every screen as the watch draws it, side by side and named. On every watch
     * but aplite each is a button that opens its editor (screens-page.js openScreen), a
     * screen with nothing on it too (its bare screen: the watch skips it); aplite draws its
     * one screen.
     * @param {Object} S Live settings.
     * @param {Object} env Platform env.
     * @param {Object} [userData] Page userData.
     * @returns {string} HTML.
     */
    function watchPreview(S, env, userData) {
        var st = S || {};
        var views = VC.resolveViewCycle(st, env);
        var editable = !(env && env.platform === 'aplite');
        var f = env && env.platform === 'emery' ? 1 : 0, now = new Date();
        var bg = svgLib.previewInk(themeOf(st, env)).bg;
        var n = 0, figs = '';
        views.forEach(function (spec, i) {
            if (!spec && !editable) { return; }
            var name = screens.nameOf(st, i) || 'View ' + (i + 1);
            var scr = spec ? screenSvg(spec, i, st, env, userData || {}, f, now) : viewScreen(st, env, i, userData);
            var inner = '<div class="wpv-card" style="background:' + bg + '">' + scr.svg + '</div>'
                + '<span class="wpv-cap" aria-hidden="true">' + esc(name) + '</span>';
            n += 1;
            figs += editable
                ? '<button type="button" class="wpv-v wpv-btn" data-action="openScreen" data-action-arg="' + i
                    + '" aria-label="' + esc('Edit ' + name + ': ' + scr.label) + '">' + inner + '</button>'
                : '<div class="wpv-v" role="img" aria-label="' + esc(name + ': ' + scr.label) + '">' + inner + '</div>';
        });
        if (!figs) { return ''; }
        ensureStyle();
        return '<div class="wpv n' + n + '" role="group" aria-label="Your watch">' + figs + '</div>'
            + (editable ? '<span class="wpv-tap">Tap a screen to edit it</span>' : '');
    }

    /**
     * One view of the cycle on its own, drawn as the pinned preview draws it (the screen
     * editor's picture of a screen with nothing on it, screens-page.js). A view with
     * nothing left on it (a disabled slot, which the watch skips) is its bare screen with a
     * note.
     * @param {Object} S Live settings.
     * @param {Object} env Platform env.
     * @param {number} i The view's place in the cycle (0 = Default).
     * @param {Object} [userData] Page userData (the palette).
     * @returns {{svg: string, label: string, bg: string}} The <svg>, its bands as spoken, and the
     *     watch's background.
     */
    function viewScreen(S, env, i, userData) {
        var st = S || {}, f = env && env.platform === 'emery' ? 1 : 0, sc = SCREEN[f];
        var spec = VC.resolveViewCycle(st, env)[i] || null;
        if (spec) { return screenSvg(spec, i, st, env, userData || {}, f, new Date(), 've' + i + '-'); }
        var ink = svgLib.previewInk(themeOf(st, env));
        return { svg: framedSvg(sc.w, sc.h, ink.bg,
            text(sc.w / 2, sc.h / 2 + 4, f ? 15 : 12, ink.rgba('0.6'), 'middle', 600, 'Nothing to show')),
            bg: ink.bg,
            label: 'Nothing to show' };
    }

    /**
     * The Time card's Clock font picker's picture of one face (picture resolver
     * 'timeFontPicture'): the clock band alone, the samples' time in that face as the watch
     * draws it (clockBand), on the watch's ground in the time colour — so a face shows where
     * it is picked, below the pinned preview's reach.
     * @param {Object} S Live settings.
     * @param {Object} env Platform env.
     * @param {{value: string}} args The option's face.
     * @returns {string} The <svg>.
     */
    function fontPicture(S, env, args) {
        var st = Object.assign({}, S || {}, { timeFont: args.value });
        var theme = themeOf(st, env), ink = svgLib.previewInk(theme);
        var f = env && env.platform === 'emery' ? 1 : 0, w = SCREEN[f].w, h = f ? 64 : 49;
        var cx = { fg: ink.fg, color: resolveInk.drawsColor(env, theme), bw: Boolean(env && env.color === false), f: f };
        return framedSvg(w, h, ink.bg,
            clockBand(st, { x: 0, y: 0, w: w, h: h }, cx, 'tf' + String(args.value).replace(/[^A-Za-z0-9]/g, '') + '-'));
    }

    if (PConf && PConf.blocks) { PConf.blocks.register('watchPreview', watchPreview); }
    if (PConf && PConf.pictureResolvers) { PConf.pictureResolvers.register('timeFontPicture', fontPicture); }
    var api = { watchPreview: watchPreview, layoutView: layoutView, clockInk: clockInk, screenSvg: screenSvg,
        barLabels: barLabels,
        graphKinds: graphKinds,
                fontPicture: fontPicture, viewScreen: viewScreen, SCREEN: SCREEN };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PreviewWatch = api; }
})();

//
// Builds the anchored 28-bit holiday bitmask the watch reads. The mask covers
// 4 weeks starting at the displayed grid's top-left cell (cell-0); the extra
// week beyond the visible 21 cells is forward headroom so a week rollover with
// no resend never runs off the end of the data. ES5 only (reaches the watch).

var daysFromCivil = require('./serial-day.js');
// One holiday source in the codebase's lifetime — call it directly (the old
// registry.js was an identity curry over it; reintroduce a registry when a
// SECOND source actually lands).
var nagerSource = require('./nager-source.js');

var WINDOW_DAYS = 28; // 4 weeks; 21 visible cells + 1 week headroom.

/**
 * Index of today's calendar cell — mirrors config_n_today() on the watch.
 *
 * @param {Date} now Current local date/time.
 * @param {boolean} startMon Week starts on Monday when true.
 * @param {boolean} prevWeek Grid leads with the previous week when true.
 * @returns {number} Cell index (0-20) holding today.
 */
function todayCellIndex(now, startMon, prevWeek) {
    var wday = now.getDay(); // 0=Sun .. 6=Sat
    var adj = startMon ? (wday + 6) % 7 : wday;
    return prevWeek ? adj + 7 : adj;
}

/**
 * The displayed grid's cell-0 (top-left) date — THE window anchor. One
 * definition, shared by build() and windowYears(): if these ever diverged,
 * the prefetched years would silently desynchronize from the days the mask
 * scans at a year boundary.
 *
 * @param {{startMon: boolean, prevWeek: boolean}} opts Calendar layout.
 * @param {Date} now Current local date/time.
 * @returns {Date} The cell-0 date.
 */
function windowStart(opts, now) {
    var iToday = todayCellIndex(now, opts.startMon, opts.prevWeek);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - iToday);
}

/**
 * Build the anchored holiday bitmask for the visible calendar window.
 *
 * @param {{startMon: boolean, prevWeek: boolean, country: string, region: string, enabled: boolean}} opts
 *   Calendar layout, selected holiday country/region, and enable flag.
 * @param {Date} now Current local date/time.
 * @returns {{anchor: number, mask: number}} Serial-day anchor and 28-bit mask (0 when disabled or no provider).
 */
function build(opts, now) {
    var cell0 = windowStart(opts, now);
    var anchor = daysFromCivil(cell0.getFullYear(), cell0.getMonth() + 1, cell0.getDate());

    var mask = 0;
    // 'none' and an empty country leave the mask empty with a still-valid
    // anchor (the same null the old registry resolved for them).
    if (opts.enabled && opts.country && opts.country !== 'none') {
        var i;
        var day;
        for (i = 0; i < WINDOW_DAYS; i++) {
            day = new Date(cell0.getFullYear(), cell0.getMonth(), cell0.getDate() + i);
            if (nagerSource.isHoliday(opts.country, opts.region, day)) {
                mask |= (1 << i);
            }
        }
    }

    return { anchor: anchor, mask: mask >>> 0 };
}

/**
 * Years the 28-day window touches, for prefetching holiday data.
 *
 * @param {{startMon: boolean, prevWeek: boolean}} opts Calendar layout.
 * @param {Date} now Current local date/time.
 * @returns {number[]} [year] normally, [y0, y1] when the window crosses a year boundary.
 */
function windowYears(opts, now) {
    var cell0 = windowStart(opts, now);
    var last = new Date(cell0.getFullYear(), cell0.getMonth(), cell0.getDate() + (WINDOW_DAYS - 1));
    var y0 = cell0.getFullYear();
    var y1 = last.getFullYear();
    return y0 === y1 ? [y0] : [y0, y1];
}

/**
 * Pack anchor + mask into 8 little-endian bytes for the HOLIDAYS AppMessage key.
 *
 * @param {number} anchor int32 serial-day anchor.
 * @param {number} mask uint32 holiday bitmask.
 * @returns {number[]} 8 byte values (0-255), LE: [anchor x4, mask x4].
 */
function pack(anchor, mask) {
    return [
        anchor & 0xFF, (anchor >>> 8) & 0xFF, (anchor >>> 16) & 0xFF, (anchor >>> 24) & 0xFF,
        mask & 0xFF, (mask >>> 8) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 24) & 0xFF
    ];
}

module.exports = { build: build, pack: pack, windowYears: windowYears };

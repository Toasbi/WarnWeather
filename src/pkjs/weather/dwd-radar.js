// src/pkjs/weather/dwd-radar.js — the DWD/Brightsky composite radar source
// (renamed from radar.js: the generic-sounding name implied a base layer that
// never existed — every source is <id>-radar.js behind radar-factory's table).
// Unlike the point sources it samples a real composite, so the area
// ("nearby") array carries data and the wire triple is built here, not via
// radar-wire.pointRadarTuples.
var radarFetch = require('./radar-fetch.js');
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;
var radarWire = require('./radar-wire.js');
var NUM_BARS = radarWire.NUM_BARS;         // shared wire invariant (24 frames)
var SLOT_SECONDS = radarWire.SLOT_SECONDS; // shared wire invariant (300 s/slot)

var BRIGHTSKY_BASE = require('./brightsky.js').BASE_URL;
var DISTANCE_METERS = 2000;   // must match NEARBY_RADIUS_KM * 1000; Brightsky returns all cells within this radius
var NEARBY_RADIUS_KM = 2;      // disk radius for the "nearby" max signal; radar grid is ~1 km/cell

/**
 * Build the URL for the Brightsky /radar request.
 *
 * Anchors `date` at slotZeroEpoch and `last_date` one second short of
 * slotZeroEpoch + NUM_BARS * SLOT_SECONDS, so Brightsky returns exactly
 * NUM_BARS forward-looking nowcast frames in order.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch Slot-0 wall-clock epoch seconds.
 * @returns {string} Fully-formed request URL.
 */
function buildRadarUrl(lat, lon, slotZeroEpoch) {
    var windowSeconds = NUM_BARS * SLOT_SECONDS;
    var startIso = new Date(slotZeroEpoch * 1000).toISOString();
    var endIso = new Date((slotZeroEpoch + windowSeconds - 1) * 1000).toISOString();
    return BRIGHTSKY_BASE + '/radar'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&distance=' + DISTANCE_METERS
        + '&date=' + encodeURIComponent(startIso)
        + '&last_date=' + encodeURIComponent(endIso)
        + '&format=plain';
}

/**
 * Clamp `value` to the integer range [min, max].
 *
 * @param {number} value Value.
 * @param {number} min Lower bound (inclusive).
 * @param {number} max Upper bound (inclusive).
 * @returns {number} Clamped value.
 */
function clampInt(value, min, max) {
    if (value < min) { return min; }
    if (value > max) { return max; }
    return value;
}

/**
 * Bilinear-sample a 2-D grid at sub-pixel coordinates (xy.x, xy.y).
 *
 * `grid` is indexed `grid[row][col]` (outer = rows = y, inner = cols = x).
 * Coordinates outside the grid are clamped so the 2x2 neighbourhood always
 * lies fully inside.
 *
 * @param {number[][]} grid Rectangular 2-D array of numbers.
 * @param {{x: number, y: number}} xy Sub-pixel position.
 * @returns {number} Bilinearly interpolated value.
 */
function sampleBilinear(grid, xy) {
    var rows = grid.length;
    var cols = grid[0].length;
    var ix = Math.floor(xy.x);
    var iy = Math.floor(xy.y);
    var fx = xy.x - ix;
    var fy = xy.y - iy;
    var ix0 = clampInt(ix, 0, cols - 1);
    var ix1 = clampInt(ix + 1, 0, cols - 1);
    var iy0 = clampInt(iy, 0, rows - 1);
    var iy1 = clampInt(iy + 1, 0, rows - 1);
    var v00 = grid[iy0][ix0];
    var v10 = grid[iy0][ix1];
    var v01 = grid[iy1][ix0];
    var v11 = grid[iy1][ix1];
    return v00 * (1 - fx) * (1 - fy)
         + v10 * fx       * (1 - fy)
         + v01 * (1 - fx) * fy
         + v11 * fx       * fy;
}

/**
 * Find the maximum value among all grid cells whose centre lies at or
 * within `radius` grid units of the sub-pixel position (cx, cy)
 * (boundary inclusive — matches the `<=` comparison below).
 *
 * Distance is computed in squared form to avoid a sqrt per cell. The
 * helper is O(rows * cols) — fine on the small grids Brightsky returns
 * (typically 3x3 for distance=1000).
 *
 * @param {number[][]} grid Rectangular 2-D array of cell values.
 * @param {number} cx User sub-pixel column (Brightsky's latlon_position.x).
 * @param {number} cy User sub-pixel row    (Brightsky's latlon_position.y).
 * @param {number} radius Disk radius in grid units (1 grid unit ≈ 1 km).
 * @returns {number} Max cell value among cells inside the disk; 0 if none qualify.
 */
function maxOverDisk(grid, cx, cy, radius) {
    var rows = grid.length;
    var cols = grid[0].length;
    var r2 = radius * radius;
    var best = 0;
    var j;
    var i;
    var dx;
    var dy;
    var v;
    for (j = 0; j < rows; j += 1) {
        for (i = 0; i < cols; i += 1) {
            dx = i - cx;
            dy = j - cy;
            if (dx * dx + dy * dy <= r2) {
                v = grid[j][i];
                if (v > best) {
                    best = v;
                }
            }
        }
    }
    return best;
}

/**
 * Convert a radar cell value (0.01 mm per 5 min) into the watch's wire
 * format for rain bars: uint8 representing mm/h * 10.
 *
 * Factor: 0.01 mm/5min * 12 (5min/h) * 10 = v * 1.2.
 * Saturates at 255 (= 25.5 mm/h).
 *
 * @param {number} v Radar cell value in 0.01 mm / 5 min.
 * @returns {number} Integer in [0, 255].
 */
function scaleToWireUnits(v) {
    return clampByte(v * 1.2);
}

/**
 * Default sub-pixel position when the response omits latlon_position.
 * Falls back to the geometric centre of the supplied grid so we still
 * return a sensible value rather than failing the whole fetch.
 *
 * @param {number[][]} grid Reference grid (used only for its dimensions).
 * @returns {{x: number, y: number}} Centre sub-pixel coordinates.
 */
function gridCentre(grid) {
    var rows = grid.length;
    var cols = grid[0].length;
    return {
        x: (cols - 1) / 2,
        y: (rows - 1) / 2
    };
}

/**
 * Sample one radar frame's precipitation grid into an (exact, nearby) pair in
 * wire units (uint8, mm/h * 10). Returns null for a missing/malformed frame so
 * the caller can leave that slot at its (0, 0) default instead of aborting.
 *
 * @param {Object} frame One body.radar frame (carries the precipitation_5 grid).
 * @param {{x: number, y: number}} xy Cell position from latlon_position.
 * @param {boolean} hasXy Whether xy is usable; falls back to the grid centre.
 * @returns {{exact: number, nearby: number}|null} Wire-unit pair, or null to skip.
 */
function sampleFrame(frame, xy, hasXy) {
    if (!frame) {
        return null;
    }
    var grid = frame.precipitation_5;
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) {
        return null;
    }
    var samplePos = hasXy ? xy : gridCentre(grid);
    var exactRaw = sampleBilinear(grid, samplePos);
    var nearbyRaw = maxOverDisk(grid, samplePos.x, samplePos.y, NEARBY_RADIUS_KM);
    // Invariant guard. A pure disk-max can fall below the bilinear sample at
    // corner sub-pixel positions, where the bilinear's diagonal neighbour sits
    // ~sqrt(2) km away (outside the 1 km disk) yet still carries a small weight.
    // Folding exactRaw into nearbyRaw keeps the UI invariant `nearby >= exact`
    // true for every frame.
    if (exactRaw > nearbyRaw) {
        nearbyRaw = exactRaw;
    }
    return { exact: scaleToWireUnits(exactRaw), nearby: scaleToWireUnits(nearbyRaw) };
}

/**
 * Fetch 2-hour DWD rain-radar tuples for pre-resolved coordinates — the one
 * seam every radar source exports (radar-factory). Coordinates come from the
 * single per-cycle acquisition in the orchestrator. A parse/transport failure
 * or missing fields calls back null (preserves the watch's existing radar);
 * an out-of-coverage answer ships the flat 24-zero signal.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null.
 * @returns {void}
 */
function fetchRadarTuplesAt(lat, lon, slotZeroEpoch, callback) {
    radarFetch.fetchRadarJson({
        url: buildRadarUrl(lat, lon, slotZeroEpoch),
        label: 'DWD'
    }, function (body) {
        if (!body || !Array.isArray(body.radar)) {
            console.log('[!] DWD radar: missing fields');
            return null;
        }
        if (body.radar.length === 0) {
            // Out of DWD coverage — a flat signal rather than a failure.
            return radarWire.flatRadarTuples(slotZeroEpoch);
        }
        var frames = body.radar;
        var xy = body.latlon_position;
        var hasXy = Boolean(xy && isFinite(xy.x) && isFinite(xy.y));
        var exactOut = zeroFilledArray(NUM_BARS);
        var nearbyOut = zeroFilledArray(NUM_BARS);
        var i;
        var sampled;
        for (i = 0; i < NUM_BARS && i < frames.length; i += 1) {
            sampled = sampleFrame(frames[i], xy, hasXy);
            // A malformed frame contributes a (0, 0) pair (the zero-filled
            // default) rather than aborting the whole fetch.
            if (sampled === null) {
                continue;
            }
            exactOut[i] = sampled.exact;
            nearbyOut[i] = sampled.nearby;
        }
        return {
            RAIN_RADAR_TREND_UINT8: exactOut,
            RAIN_RADAR_TREND_AREA_UINT8: nearbyOut,
            RAIN_RADAR_START: slotZeroEpoch
        };
    }, callback);
}

module.exports = {
    fetchRadarTuplesAt: fetchRadarTuplesAt
};

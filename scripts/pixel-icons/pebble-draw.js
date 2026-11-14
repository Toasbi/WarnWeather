/**
 * The watch's own drawing of a status icon, for the icon tools (README.md in this folder): a
 * PDC image of 1 px precise paths, stroked the way PebbleOS strokes them. Ported from PebbleOS
 * (Apache-2.0; pebble/applib/graphics: gdraw_command.c prv_draw_precise_path, gpath.c
 * gpath_draw_outline_precise_internal, graphics_line.c graphics_line_draw_precise_stroked,
 * graphics_line_draw_1px_aa and _non_aa, graphics_private.c graphics_private_plot_pixel,
 * gtypes.c gcolor_blend) and checked pixel for pixel against the emulator (test/pixel-draw.test.js).
 *
 * What the firmware does with a 1 px precise path: each segment's ends are floored to whole
 * pixels (GPointFromGPointPrecise, raw >> 3), so a point's eighths only decide which pixel it
 * lands on, and the segment is drawn between those pixels. With smoothing on (the colour
 * watches) that is Wu's line: level, upright and 45-degree segments solid, any other a pair of
 * pixels per step whose shares of the colour come in quarters, blended in the order drawn.
 * Without it (the black and white watches) it is Bresenham's line. A path of one point draws
 * nothing.
 *
 * Works in node (require) and in a page (window.PebbleDraw).
 */
(function (root) {
    'use strict';

    // GColor8: 2 bits each of alpha, red, green and blue.
    const BLACK = 0xC0, WHITE = 0xFF;
    // A channel's 2 bits as the emulator's screenshots show them.
    const LEVEL = [0, 84, 171, 255];

    /**
     * gcolor_blend: factor 0 keeps dst, 3 is src, 1 and 2 mix a third or two thirds of src into
     * each 2-bit channel. The firmware looks these up in a 64 x 64 table (gtypes.c
     * s_blending_lookup_33_percent, mirrored for two thirds); per channel every entry is
     * (src + 2 dst) / 3 rounded to the nearest (test/pixel-draw.test.js).
     * @param {number} src @param {number} dst @param {number} factor 0..3
     * @returns {number} The blended GColor8.
     */
    function blend(src, dst, factor) {
        if (factor === 0) return dst;
        if (factor === 3) return src;
        let out = 0xC0;
        for (let i = 0; i < 3; i++) {
            const s = (src >> (2 * i)) & 3, d = (dst >> (2 * i)) & 3;
            const v = factor === 1 ? Math.round((s + 2 * d) / 3) : Math.round((2 * s + d) / 3);
            out |= v << (2 * i);
        }
        return out;
    }

    /**
     * A framebuffer of GColor8 values.
     * @param {number} w @param {number} h @param {number} bg Its colour.
     * @returns {{w: number, h: number, px: !Uint8Array}}
     */
    function framebuffer(w, h, bg) {
        return { w, h, px: new Uint8Array(w * h).fill(bg) };
    }

    /**
     * graphics_private_plot_pixel: blend `color` in with alpha 3 - opacity, inside the buffer.
     * @param {!Object} fb @param {number} x @param {number} y @param {number} opacity 0 (full) .. 3
     * @param {number} color
     * @returns {void}
     */
    function plot(fb, x, y, opacity, color) {
        if (x < 0 || y < 0 || x >= fb.w || y >= fb.h) return;
        const i = y * fb.w + x;
        fb.px[i] = blend(color, fb.px[i], 3 - opacity);
    }

    /**
     * graphics_line_draw_1px_aa: Wu-Xiang's line between two whole pixels.
     * @param {!Object} fb @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @param {number} color
     * @returns {void}
     */
    function lineAA(fb, x1, y1, x2, y2, color) {
        if (y1 > y2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
        plot(fb, x1, y1, 0, color);
        let dx = x2 - x1, xi = 1;
        if (dx < 0) { xi = -1; dx = -dx; }
        let dy = y2 - y1;
        if (dy === 0) {
            for (let x = Math.min(x1, x1 + dx * xi); x <= Math.max(x1, x1 + dx * xi); x++) plot(fb, x, y1, 0, color);
            return;
        }
        if (dx === 0) {
            for (let y = y1; y <= y1 + dy; y++) plot(fb, x1, y, 0, color);
            return;
        }
        if (dx === dy) {
            while (dy-- !== 0) { x1 += xi; y1++; plot(fb, x1, y1, 0, color); }
            return;
        }
        let acc = 0;
        if (dy > dx) {
            const adj = Math.floor(dx * 65536 / dy) & 0xFFFF;
            while (--dy) {
                const before = acc;
                acc = (acc + adj) & 0xFFFF;
                if (acc <= before) x1 += xi;
                y1++;
                const w = acc >> 14;
                plot(fb, x1, y1, w, color);
                plot(fb, x1 + xi, y1, w ^ 3, color);
            }
        } else {
            const adj = Math.floor(dy * 65536 / dx) & 0xFFFF;
            while (--dx) {
                const before = acc;
                acc = (acc + adj) & 0xFFFF;
                if (acc <= before) y1++;
                x1 += xi;
                const w = acc >> 14;
                plot(fb, x1, y1, w, color);
                plot(fb, x1, y1 + 1, w ^ 3, color);
            }
        }
        plot(fb, x2, y2, 0, color);
    }

    /**
     * graphics_line_draw_1px_non_aa: Bresenham's line between two whole pixels.
     * @param {!Object} fb @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
     * @param {number} color
     * @returns {void}
     */
    function lineHard(fb, x0, y0, x1, y1, color) {
        const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
        if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
        if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
        const dx = x1 - x0, dy = Math.abs(y1 - y0), ystep = y0 < y1 ? 1 : -1;
        let err = Math.trunc(dx / 2);
        for (; x0 <= x1; x0++) {
            if (steep) plot(fb, y0, x0, 0, color); else plot(fb, x0, y0, 0, color);
            err -= dy;
            if (err < 0) { y0 += ystep; err += dx; }
        }
    }

    /**
     * A PDC image's view box and precise paths: [{pts: [[rawX, rawY], ...], open}] in 1/8 px.
     * @param {!Uint8Array} buf A .pdc file.
     * @returns {{w: number, h: number, paths: !Array<{pts: !Array<!Array<number>>, open: boolean}>}}
     */
    function readPdc(buf) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const w = dv.getInt16(10, true), h = dv.getInt16(12, true), n = dv.getUint16(14, true);
        const paths = [];
        let at = 16;
        for (let i = 0; i < n; i++) {
            const type = dv.getUint8(at), open = dv.getUint16(at + 5, true) === 1, np = dv.getUint16(at + 7, true);
            if (type !== 3) throw new Error('readPdc: only precise paths');
            const pts = [];
            for (let k = 0; k < np; k++) pts.push([dv.getInt16(at + 9 + 4 * k, true), dv.getInt16(at + 11 + 4 * k, true)]);
            paths.push({ pts, open });
            at += 9 + 4 * np;
        }
        return { w, h, paths };
    }

    /**
     * Draw an image's paths at a whole-pixel offset, as gdraw_command_image_draw does with its
     * strokes recoloured to `color` (the status row's theme ink).
     * @param {!Object} fb A framebuffer.
     * @param {!Array<{pts: !Array<!Array<number>>, open: boolean}>} paths readPdc's.
     * @param {number} ox @param {number} oy The offset.
     * @param {number} color GColor8.
     * @param {boolean} smooth Smoothing on (a colour watch).
     * @returns {void}
     */
    function drawPaths(fb, paths, ox, oy, color, smooth) {
        for (const { pts, open } of paths) {
            if (pts.length <= 1) continue;
            const segs = open ? pts.length - 1 : pts.length;
            for (let i = 0; i < segs; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                const args = [fb, (a[0] >> 3) + ox, (a[1] >> 3) + oy, (b[0] >> 3) + ox, (b[1] >> 3) + oy, color];
                if (smooth) lineAA(...args); else lineHard(...args);
            }
        }
    }

    /**
     * An image drawn on a watch background, a pixel of margin all round, as RGB bytes (the
     * emulator's screenshot levels).
     * @param {!Uint8Array} pdc A .pdc file.
     * @param {{light: boolean, smooth: (boolean|undefined)}} opts The light theme (black ink on
     *     white) or the dark one; smoothing on unless false.
     * @returns {{w: number, h: number, rgb: !Uint8Array}}
     */
    function render(pdc, opts) {
        const img = readPdc(pdc);
        const fb = framebuffer(img.w + 2, img.h + 2, opts.light ? WHITE : BLACK);
        drawPaths(fb, img.paths, 1, 1, opts.light ? BLACK : WHITE, opts.smooth !== false);
        const rgb = new Uint8Array(fb.w * fb.h * 3);
        fb.px.forEach((c, i) => {
            rgb[3 * i] = LEVEL[(c >> 4) & 3];
            rgb[3 * i + 1] = LEVEL[(c >> 2) & 3];
            rgb[3 * i + 2] = LEVEL[c & 3];
        });
        return { w: fb.w, h: fb.h, rgb };
    }

    const api = { BLACK, WHITE, LEVEL, blend, framebuffer, plot, lineAA, lineHard, readPdc, drawPaths, render };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PebbleDraw = api;
})(typeof window !== 'undefined' ? window : this);

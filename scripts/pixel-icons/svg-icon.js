/**
 * An SVG icon made into a status icon the old way, at any size (README.md in this folder, "An
 * icon from an SVG"): the SVG becomes a PDC the way scripts/svg2pdc.py makes one (curves cut into
 * chords about 2.5 units long, a circle an eight-sided flat-top polygon, the ink fitted into the
 * 24-unit box with a 2-unit margin, points on the 1/8 grid), then each size scales it the way the
 * watch scaled an icon before the pixel drawings (watch_icons.py icon_load: the ink's height to
 * the size, every point on a pixel centre). The result is the size's lines, which the watch
 * draws smoothed (pebble-draw.js shows them exactly).
 *
 * No SVG transforms, as svg2pdc.py: draw the icon without them (Lucide and Tabler icons have none).
 *
 * Works in node (require) and in a page (window.SvgIcon).
 *   node scripts/pixel-icons/svg-icon.js bake <icon.svg> <h>   prints the lines of size h as JSON
 */
(function (root) {
    'use strict';

    const VIEWBOX = 24, MARGIN = 2, SUBPX = 8, PU = 8;
    const CURVE_SPACING = 2.5, CURVE_MIN_STEPS = 2, CIRCLE_FACETS = 8;

    /** Python's round(): halves to even. @param {number} v @returns {number} */
    function roundEven(v) {
        const f = Math.floor(v), d = v - f;
        if (d > 0.5) return f + 1;
        if (d < 0.5) return f;
        return f % 2 === 0 ? f : f + 1;
    }

    // ---- SVG elements -------------------------------------------------------------------------
    /**
     * The drawable elements of an SVG, in document order: [{tag, attrs}]. A small reader for icon
     * files (no entities, comments and CDATA skipped), the same in node and a page.
     * @param {string} text The SVG.
     * @returns {!Array<{tag: string, attrs: !Object<string, string>}>}
     */
    function elements(text) {
        const out = [];
        const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
        const tagRe = /<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
        let m;
        while ((m = tagRe.exec(src))) {
            const attrs = {};
            const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
            let a;
            while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3];
            out.push({ tag: m[1].replace(/^.*:/, ''), attrs });
        }
        return out;
    }

    // ---- Path data ----------------------------------------------------------------------------
    /**
     * A path's `d` as absolute segments: {type: 'M'|'L'|'C'|'Q'|'A'|'Z', ...points}.
     * @param {string} d
     * @returns {!Array<!Object>}
     */
    function segments(d) {
        const out = [];
        let at = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, lastCtrl = null, lastCmd = '';
        const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
        const skip = () => { while (at < d.length && /[\s,]/.test(d[at])) at++; };
        const isNum = () => { skip(); return at < d.length && /[-+.\d]/.test(d[at]); };
        const num = () => {
            skip();
            NUM.lastIndex = at;
            const m = NUM.exec(d);
            if (!m) throw new Error('a number is missing in the path data');
            at = NUM.lastIndex;
            return Number(m[0]);
        };
        // An arc's flags are one digit each and may run into what follows ("a5 5 0 016 0").
        const flag = () => {
            skip();
            if (d[at] !== '0' && d[at] !== '1') throw new Error('an arc flag is missing in the path data');
            return d[at++] === '1';
        };
        for (;;) {
            skip();
            if (at >= d.length) break;
            const fresh = /[A-Za-z]/.test(d[at]);
            if (fresh) {
                cmd = d[at++];
                if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(cmd)) throw new Error('unknown path command ' + cmd);
            } else if (cmd === null) throw new Error('path data must start with a command');
            const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
            const ox = rel ? cx : 0, oy = rel ? cy : 0;
            if (C === 'Z') {
                if (!fresh) throw new Error('numbers after Z in the path data');
                out.push({ type: 'Z' });
                cx = sx; cy = sy; lastCtrl = null; lastCmd = 'Z';
                continue;
            }
            if (!isNum()) throw new Error('missing numbers after ' + cmd);
            if (C === 'M') {
                cx = ox + num(); cy = oy + num(); sx = cx; sy = cy;
                out.push({ type: 'M', x: cx, y: cy });
                cmd = rel ? 'l' : 'L';   // further pairs are lines
                lastCtrl = null; lastCmd = 'M';
            } else if (C === 'L' || C === 'H' || C === 'V') {
                const x = C === 'V' ? cx : ox + num();
                const y = C === 'H' ? cy : (C === 'V' ? oy + num() : oy + num());
                out.push({ type: 'L', x0: cx, y0: cy, x, y });
                cx = x; cy = y; lastCtrl = null; lastCmd = 'L';
            } else if (C === 'C' || C === 'S') {
                let x1, y1;
                if (C === 'S') {
                    if (lastCmd === 'C' && lastCtrl) { x1 = 2 * cx - lastCtrl[0]; y1 = 2 * cy - lastCtrl[1]; } else { x1 = cx; y1 = cy; }
                } else { x1 = ox + num(); y1 = oy + num(); }
                const x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
                out.push({ type: 'C', x0: cx, y0: cy, x1, y1, x2, y2, x, y });
                lastCtrl = [x2, y2]; cx = x; cy = y; lastCmd = 'C';
            } else if (C === 'Q' || C === 'T') {
                let x1, y1;
                if (C === 'T') {
                    if (lastCmd === 'Q' && lastCtrl) { x1 = 2 * cx - lastCtrl[0]; y1 = 2 * cy - lastCtrl[1]; } else { x1 = cx; y1 = cy; }
                } else { x1 = ox + num(); y1 = oy + num(); }
                const x = ox + num(), y = oy + num();
                out.push({ type: 'Q', x0: cx, y0: cy, x1, y1, x, y });
                lastCtrl = [x1, y1]; cx = x; cy = y; lastCmd = 'Q';
            } else if (C === 'A') {
                const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
                const x = ox + num(), y = oy + num();
                out.push({ type: 'A', x0: cx, y0: cy, rx, ry, rot, large, sweep, x, y });
                cx = x; cy = y; lastCtrl = null; lastCmd = 'A';
            }
        }
        return out;
    }

    // Python's math.radians and math.degrees: one multiplication by a constant each.
    const RADIANS = Math.PI / 180, DEGREES = 180 / Math.PI;

    /** Python's float %: the result takes the divisor's sign. @param {number} a @param {number} b @returns {number} */
    function pyMod(a, b) {
        const m = a % b;
        if (m === 0) return b < 0 ? -0 : 0;
        return (m < 0) !== (b < 0) ? m + b : m;
    }

    /**
     * An arc's centre form, as svg.path's Arc works it out (_parameterize, after the SVG
     * implementation notes F.6.5), or null when it is a line (a zero radius) or nothing (the
     * ends coincide).
     * @param {!Object} s An 'A' segment.
     * @returns {?{cx: number, cy: number, rx: number, ry: number, cosr: number, sinr: number, theta: number, delta: number, circle: boolean}}
     */
    function arcCentre(s) {
        if (s.x0 === s.x && s.y0 === s.y) return null;
        if (s.rx === 0 || s.ry === 0) return null;
        const cosr = Math.cos(s.rot * RADIANS), sinr = Math.sin(s.rot * RADIANS);
        const dx = (s.x0 - s.x) / 2, dy = (s.y0 - s.y) / 2;
        const x1p = cosr * dx + sinr * dy, y1p = -sinr * dx + cosr * dy;
        const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
        let rx = s.rx, ry = s.ry, rxSq = rx * rx, rySq = ry * ry;
        const scale = (x1pSq / rxSq) + (y1pSq / rySq);
        if (scale > 1) {
            const k = Math.sqrt(scale);
            rx *= k; ry *= k; rxSq = rx * rx; rySq = ry * ry;
        }
        const t1 = rxSq * y1pSq, t2 = rySq * x1pSq;
        let c = Math.sqrt(Math.abs((rxSq * rySq - t1 - t2) / (t1 + t2)));
        if (s.large === s.sweep) c = -c;
        const cxp = c * rx * y1p / ry, cyp = -c * ry * x1p / rx;
        const cx = (cosr * cxp - sinr * cyp) + ((s.x0 + s.x) / 2), cy = (sinr * cxp + cosr * cyp) + ((s.y0 + s.y) / 2);
        const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry, vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
        let theta = Math.acos(ux / Math.sqrt(ux * ux + uy * uy)) * DEGREES;
        if (uy < 0) theta = -theta;
        theta = pyMod(theta, 360);
        let dd = (ux * vx + uy * vy) / Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        if (dd > 1) dd = 1; else if (dd < -1) dd = -1;
        let delta = Math.acos(dd) * DEGREES;
        if ((ux * vy - uy * vx) < 0) delta = -delta;
        delta = pyMod(delta, 360);
        if (!s.sweep) delta -= 360;
        return { cx, cy, rx, ry, cosr, sinr, theta, delta, circle: s.rx === s.ry };
    }

    /**
     * A curved segment's point at t (0..1).
     * @param {!Object} s A 'C', 'Q' or 'A' segment (an 'A' with its centre form in s.arc).
     * @param {number} t
     * @returns {!Array<number>}
     */
    function pointAt(s, t) {
        // svg.path's point(), term for term, so the points round the way svg2pdc.py's do.
        const u = 1 - t;
        if (s.type === 'C') {
            const k0 = Math.pow(u, 3), k1 = 3 * Math.pow(u, 2) * t, k2 = 3 * u * Math.pow(t, 2), k3 = Math.pow(t, 3);
            return [(k0 * s.x0) + (k1 * s.x1) + (k2 * s.x2) + (k3 * s.x), (k0 * s.y0) + (k1 * s.y1) + (k2 * s.y2) + (k3 * s.y)];
        }
        if (s.type === 'Q') {
            const k0 = Math.pow(u, 2), k1 = 2 * u * t, k2 = Math.pow(t, 2);
            return [k0 * s.x0 + k1 * s.x1 + k2 * s.x, k0 * s.y0 + k1 * s.y1 + k2 * s.y];
        }
        const a = s.arc;
        if (!a) return [s.x0 + (s.x - s.x0) * t, s.y0 + (s.y - s.y0) * t];   // a line, or a point
        const ang = (a.theta + (a.delta * t)) * RADIANS;
        return [a.cosr * Math.cos(ang) * a.rx - a.sinr * Math.sin(ang) * a.ry + a.cx,
            a.sinr * Math.cos(ang) * a.rx + a.cosr * Math.sin(ang) * a.ry + a.cy];
    }

    /**
     * svg.path segment_length: the curve's length by halving it into chords until a halving
     * adds no more than `error`, at least five halvings deep.
     * @returns {number}
     */
    function segmentLength(s, start, end, sp, ep, error, depth) {
        const mid = (start + end) / 2, mp = pointAt(s, mid);
        const length = Math.hypot(ep[0] - sp[0], ep[1] - sp[1]);
        const length2 = Math.hypot(mp[0] - sp[0], mp[1] - sp[1]) + Math.hypot(ep[0] - mp[0], ep[1] - mp[1]);
        if ((length2 - length > error) || (depth < 5)) {
            return segmentLength(s, start, mid, sp, mp, error, depth + 1) + segmentLength(s, mid, end, mp, ep, error, depth + 1);
        }
        return length2;
    }

    /**
     * A curved segment's length as svg2pdc.py measures it (svg.path's length(error=1e-3)): a
     * quadratic's exactly, a circle's arc exactly, the rest by segmentLength.
     * @param {!Object} s A 'C', 'Q' or 'A' segment.
     * @returns {number}
     */
    function curveLength(s) {
        const ERROR = 1e-3;
        if (s.type === 'Q') {
            const ax = s.x0 - 2 * s.x1 + s.x, ay = s.y0 - 2 * s.y1 + s.y;
            const bx = 2 * (s.x1 - s.x0), by = 2 * (s.y1 - s.y0);
            const A = 4 * (ax * ax + ay * ay), B = 4 * (ax * bx + ay * by), C = bx * bx + by * by;
            const sum = A + B + C, A2 = Math.sqrt(A), A32 = 2 * A * A2, C2 = 2 * Math.sqrt(C);
            // Where Python's formula would divide by zero or take the log of a non-positive number,
            // svg.path falls back to these.
            if (sum >= 0 && A2 !== 0 && A32 !== 0) {
                const Sabc = 2 * Math.sqrt(sum), BA = B / A2, den = BA + C2;
                const q = den !== 0 ? (2 * A2 + BA + Sabc) / den : NaN;
                if (q > 0) return (A32 * Sabc + A2 * B * (Sabc - C2) + (4 * C * A - B * B) * Math.log(q)) / (4 * A32);
            }
            const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
            if (na < 1e-10) return nb;
            const k = nb / na;
            return k >= 2 ? nb - na : na * (Math.pow(k, 2) / 2 - k + 1);
        }
        if (s.type === 'A') {
            if (!s.arc) return Math.hypot(s.x - s.x0, s.y - s.y0);   // a line (0 for a point)
            if (s.arc.circle) return Math.abs(s.arc.rx * s.arc.delta * Math.PI / 180);
        }
        return segmentLength(s, 0, 1, pointAt(s, 0), pointAt(s, 1), ERROR, 0);
    }

    /**
     * A path's subpaths as points (svg2pdc.py flatten_path): a curve cut into chords about
     * CURVE_SPACING long, never fewer than CURVE_MIN_STEPS; a closed subpath ends before its start.
     * @param {string} d
     * @returns {!Array<{pts: !Array<!Array<number>>, closed: boolean}>}
     */
    function flattenPath(d) {
        const subs = [];
        let cur = null;
        for (const s of segments(d)) {
            if (s.type === 'M') {
                if (cur) subs.push(cur);
                cur = { pts: [[s.x, s.y]], closed: false };
            } else if (s.type === 'Z') {
                if (cur) { cur.closed = true; subs.push(cur); cur = null; }
            } else {
                if (!cur) cur = { pts: [[s.x0, s.y0]], closed: false };
                // An arc of radius 0 is sampled along its chord, one whose ends meet at its start
                // (svg.path's Arc): still cut like a curve.
                if (s.type === 'A') s.arc = arcCentre(s);
                if (s.type === 'L') {
                    cur.pts.push([s.x, s.y]);
                } else {
                    const steps = Math.max(roundEven(curveLength(s) / CURVE_SPACING), CURVE_MIN_STEPS);
                    for (let i = 1; i <= steps; i++) cur.pts.push(pointAt(s, i / steps));
                }
            }
        }
        if (cur) subs.push(cur);
        return subs;
    }

    /** svg2pdc.py circle_pts: a flat-top polygon. @returns {!Array<!Array<number>>} */
    function circlePts(cx, cy, rx, ry) {
        const phase = Math.PI / CIRCLE_FACETS, out = [];
        for (let i = 0; i < CIRCLE_FACETS; i++) {
            const a = 2 * Math.PI * i / CIRCLE_FACETS + phase;
            out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
        return out;
    }

    /**
     * An SVG's strokes as subpaths (svg2pdc.py parse_svg): paths, circles, ellipses, rectangles,
     * lines, polylines and polygons, skipping anything drawn with stroke="none"; a subpath of one
     * point is dropped.
     * @param {string} text The SVG.
     * @returns {!Array<{pts: !Array<!Array<number>>, closed: boolean}>}
     */
    function strokes(text) {
        const f = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
        const out = [];
        for (const { tag, attrs: a } of elements(text)) {
            if (a.stroke === 'none') continue;
            let subs = [];
            if (tag === 'path' && a.d) subs = flattenPath(a.d);
            else if (tag === 'circle') subs = [{ pts: circlePts(f(a.cx), f(a.cy), f(a.r), f(a.r)), closed: true }];
            else if (tag === 'ellipse') subs = [{ pts: circlePts(f(a.cx), f(a.cy), f(a.rx), f(a.ry)), closed: true }];
            else if (tag === 'rect') {
                const x = f(a.x), y = f(a.y), w = f(a.width), h = f(a.height);
                subs = [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
            } else if (tag === 'line') subs = [{ pts: [[f(a.x1), f(a.y1)], [f(a.x2), f(a.y2)]], closed: false }];
            else if (tag === 'polyline' || tag === 'polygon') {
                const n = (a.points || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
                const pts = [];
                for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
                subs = [{ pts, closed: tag === 'polygon' }];
            }
            subs.forEach((s) => { if (s.pts.length >= 2) out.push(s); });
        }
        return out;
    }

    /**
     * The SVG as a PDC's precise paths (svg2pdc.py fit_to_viewbox and encode): the ink fitted
     * into the 24-unit box with a 2-unit margin, centred, its points on the 1/8 grid.
     * @param {string} text The SVG.
     * @returns {!Array<{pts: !Array<!Array<number>>, closed: boolean}>} Points in 1/8 units.
     */
    function toPdcPaths(text) {
        const subs = strokes(text);
        if (!subs.length) throw new Error('no strokes found: the SVG needs paths, circles, lines or shapes');
        const xs = [], ys = [];
        subs.forEach((s) => s.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
        const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
        const w = maxx - minx, h = maxy - miny, avail = VIEWBOX - 2 * MARGIN;
        if (!(Math.max(w, h) > 0)) throw new Error('the strokes have no size');
        const scale = avail / Math.max(w, h);
        const ox = MARGIN + (avail - w * scale) / 2, oy = MARGIN + (avail - h * scale) / 2;
        return subs.map((s) => ({
            closed: s.closed,
            pts: s.pts.map(([x, y]) => [roundEven((ox + (x - minx) * scale) * SUBPX), roundEven((oy + (y - miny) * scale) * SUBPX)]),
        }));
    }

    // ---- The old scaling ----------------------------------------------------------------------
    /** watch_icons.py div_round. @param {number} a @param {number} b @returns {number} */
    function divRound(a, b) {
        return a >= 0 ? Math.floor((a + Math.floor(b / 2)) / b) : -Math.floor((-a + Math.floor(b / 2)) / b);
    }

    /** watch_icons.py snap_off. @param {number} d @param {number} num @param {number} den @returns {number} */
    function snapOff(d, num, den) {
        return divRound(d * num, 2 * PU * den) * PU;
    }

    /**
     * watch_icons.py icon_load: the paths (precise, 1/8 units) scaled so their ink is h tall,
     * every point on a pixel centre; then the lines of that size as old_version keeps them: the ink
     * at (0, 0), a closed path ending where it began.
     * @param {!Array<{pts: !Array<!Array<number>>, closed: boolean}>} paths
     * @param {number} h The size's request height (h + 1 rows painted when even, h + 2 when odd).
     * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
     */
    function scaled(paths, h) {
        const xs = [], ys = [];
        paths.forEach((p) => p.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
        const glyphH = Math.max(...ys) - Math.min(...ys), glyphW = Math.max(...xs) - Math.min(...xs);
        const num = h * PU, den = glyphH;
        if (!den) throw new Error('the strokes have no height');
        const sumX = Math.min(...xs) + Math.max(...xs), sumY = Math.min(...ys) + Math.max(...ys);
        const baseX = PU / 2 + snapOff(glyphW, num, den), baseY = PU / 2 + snapOff(glyphH, num, den);
        const pix = paths.map((p) => ({
            closed: p.closed,
            pts: p.pts.map(([x, y]) => [(baseX + snapOff(2 * x - sumX, num, den) - PU / 2) / PU,
                (baseY + snapOff(2 * y - sumY, num, den) - PU / 2) / PU]),
        }));
        const all = [].concat(...pix.map((p) => p.pts));
        const x0 = Math.min(...all.map((q) => q[0])), y0 = Math.min(...all.map((q) => q[1]));
        const lines = pix.map((p) => {
            const q = p.pts.map(([x, y]) => [x - x0, y - y0]);
            if (p.closed && q.length > 2) q.push(q[0]);
            return q;
        });
        return { lines, w: Math.max(...all.map((q) => q[0])) - x0 + 1, h: Math.max(...all.map((q) => q[1])) - y0 + 1 };
    }

    /**
     * An SVG at one size: its lines, as the watch would draw them.
     * @param {string} text The SVG. @param {number} h The size's request height.
     * @returns {{lines: !Array<!Array<!Array<number>>>, w: number, h: number}}
     */
    function atSize(text, h) {
        return scaled(toPdcPaths(text), h);
    }

    /**
     * Lines (whole pixels) as pebble-draw.js paths: each point on its pixel's centre in 1/8 units.
     * @param {!Array<!Array<!Array<number>>>} lines @returns {!Array<{pts: !Array, open: boolean}>}
     */
    function asPaths(lines) {
        return lines.map((l) => ({ pts: (l.length === 1 ? [l[0], l[0]] : l).map(([x, y]) => [x * PU + PU / 2, y * PU + PU / 2]), open: true }));
    }

    const api = { roundEven, elements, segments, flattenPath, strokes, toPdcPaths, divRound, snapOff, scaled, atSize, asPaths };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
        if (require.main === module && process.argv[2] === 'bake') {
            const text = require('fs').readFileSync(process.argv[3], 'utf8');
            process.stdout.write(JSON.stringify(atSize(text, Number(process.argv[4]))));
        }
    } else {
        root.SvgIcon = api;
    }
})(typeof window !== 'undefined' ? window : this);

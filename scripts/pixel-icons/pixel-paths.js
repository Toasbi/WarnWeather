/**
 * A pixel drawing as PDC paths in as few bytes as this finds (gen_watch_icons.js writes them;
 * docs/adr/0008-status-icons-in-fewer-bytes.md). The watch holds a shown icon's file on its heap,
 * so every byte here is a byte of heap: a command costs 9 bytes and each of its points 4.
 *
 * A drawing's pixels each have a class: 0 its ink, 1 and 2 a faded pixel's thirds. Each class is
 * drawn as 1 px paths through pixel centres, level, upright and 45-degree runs, which light exactly
 * the pixels on them with smoothing on or off, and a dot as a point twice. The classes are drawn one
 * after another, so a path may cross the pixels of its own class and of every class drawn after it:
 * they are painted over. Every order of the classes is tried, and two ways of picking the runs,
 * and the cheapest kept. Then a class's paths are merged where a straight run, or one or two
 * corners, over the pixels they may cross joins one's end to another's start, while that saves
 * bytes. Drawn in order, the commands must paint exactly the drawing: commands() throws otherwise.
 */
'use strict';

/** The four directions a run is looked for in, and all eight a path goes on in from a pixel. */
const RUN_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const ALL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * A pixel's number in the sets and maps below, with room for a faded pixel left of or above the
 * view box.
 * @param {number} x Its column.
 * @param {number} y Its row.
 * @returns {number} Its number.
 */
const at = (x, y) => (y + 64) * 512 + (x + 64);

/**
 * A command's bytes: 9, and 4 a point.
 * @param {!Array<!Array<number>>} pts Its points.
 * @returns {number} Its bytes in the file.
 */
const cost = (pts) => 9 + 4 * pts.length;

/**
 * The pixels as runs: level, upright and 45-degree lines through pixel centres over `over`'s pixels
 * only, chosen greedily (the run that draws the most of `px`'s pixels not yet drawn first) until
 * every pixel of `px` is drawn. A pixel no run of two reaches is a dot (both ends the same). A run
 * either goes on as far as `over` lets it, the longest first among equals, so more runs meet end to
 * end; or, trimmed, ends at its first and last pixel still to draw, the shortest first.
 * @param {!Array<!Array<number>>} px [x, y] of each pixel to draw.
 * @param {!Array<!Array<number>>=} over [x, y] of each pixel a run may cross, px's among them:
 *     px's alone by default, so the runs light exactly px.
 * @param {boolean=} trim Whether a run ends at its first and last pixel still to draw.
 * @returns {!Array<!Array<!Array<number>>>} [[x0, y0], [x1, y1]] per run.
 */
function runs(px, over = px, trim = false) {
    const lit = new Set(over.map(([x, y]) => at(x, y)));
    const todo = new Set(px.map(([x, y]) => at(x, y)));
    // Every longest line over `over` through a pixel to draw, once: its pixels, from its first.
    const lines = new Map();
    for (const [x, y] of px.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
        RUN_DIRS.forEach(([dx, dy], d) => {
            let ax = x, ay = y;
            while (lit.has(at(ax - dx, ay - dy))) { ax -= dx; ay -= dy; }
            if (lines.has(at(ax, ay) * 4 + d)) return;
            const cells = [];
            for (let cx = ax, cy = ay; lit.has(at(cx, cy)); cx += dx, cy += dy) cells.push([cx, cy]);
            lines.set(at(ax, ay) * 4 + d, cells);
        });
    }
    const out = [];
    while (todo.size) {
        let best = null;
        for (const cells of lines.values()) {
            let gain = 0, first = -1, last = -1;
            cells.forEach(([x, y], i) => {
                if (!todo.has(at(x, y))) return;
                gain++;
                if (first < 0) first = i;
                last = i;
            });
            if (!gain) continue;
            const from = trim ? first : 0, span = trim ? last - first + 1 : cells.length;
            if (!best || gain > best.gain || (gain === best.gain && (trim ? span < best.span : span > best.span))) {
                best = { gain, span, run: cells.slice(from, from + span) };
            }
        }
        best.run.forEach(([x, y]) => todo.delete(at(x, y)));
        out.push([best.run[0], best.run[best.run.length - 1]]);
    }
    return out;
}

/**
 * The runs joined end to end into open paths: a run that starts where another ends continues it.
 * The pixels stay the same: a path is drawn as its runs, one after another.
 * @param {!Array<!Array<!Array<number>>>} segs runs() of the drawing.
 * @returns {!Array<!Array<!Array<number>>>} The paths' points, [x, y] each.
 */
function paths(segs) {
    const ends = new Map();
    segs.forEach((s, i) => s.forEach(([x, y]) => {
        if (!ends.has(at(x, y))) ends.set(at(x, y), []);
        ends.get(at(x, y)).push(i);
    }));
    const used = segs.map(() => false);
    const same = (p, q) => p[0] === q[0] && p[1] === q[1];
    const out = [];
    segs.forEach((seg, i) => {
        if (used[i]) return;
        used[i] = true;
        const pts = seg.slice();
        for (const tail of [true, false]) {
            for (;;) {
                const end = tail ? pts[pts.length - 1] : pts[0];
                const j = ends.get(at(end[0], end[1])).find(q => !used[q]);
                if (j === undefined) break;
                used[j] = true;
                const next = same(segs[j][0], end) ? segs[j][1] : segs[j][0];
                if (tail) pts.push(next); else pts.unshift(next);
            }
        }
        out.push(pts);
    });
    return out;
}

/**
 * A path without the points that draw nothing of their own: a point repeated, and one in the
 * middle of a straight stretch. A dot stays a point twice.
 * @param {!Array<!Array<number>>} pts The path's points.
 * @returns {!Array<!Array<number>>} The points left.
 */
function tidy(pts) {
    const once = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]);
    if (once.length === 1) return [once[0], once[0]];
    const out = [once[0]];
    for (let k = 1; k < once.length - 1; k++) {
        const a = out[out.length - 1], b = once[k], c = once[k + 1];
        const straight = Math.sign(b[0] - a[0]) === Math.sign(c[0] - b[0]) && Math.sign(b[1] - a[1]) === Math.sign(c[1] - b[1]);
        if (!straight) out.push(b);
    }
    out.push(once[once.length - 1]);
    return out;
}

/**
 * Where a path may go over `over`'s pixels: for each of them, the pixels a level, upright or
 * 45-degree run from it reaches without leaving `over`, itself among them; and the ways found so
 * far between two pixels (corners()).
 * @param {!Array<!Array<number>>} over [x, y] of each pixel a path may cross.
 * @returns {{over: !Array<!Array<number>>, reach: !Map<number, !Map<number, !Array<number>>>,
 *     ways: !Map<number, !Array>}}
 */
function ground(over) {
    const lit = new Set(over.map(([x, y]) => at(x, y)));
    const reach = new Map();
    for (const [x, y] of over) {
        const r = new Map([[at(x, y), [x, y]]]);
        for (const [dx, dy] of ALL_DIRS) {
            for (let cx = x + dx, cy = y + dy; lit.has(at(cx, cy)); cx += dx, cy += dy) r.set(at(cx, cy), [cx, cy]);
        }
        reach.set(at(x, y), r);
    }
    return { over, reach, ways: new Map() };
}

/**
 * Every way with the fewest corners (none, one or two) a path takes from a to b over the
 * ground's pixels: each its corners, [x, y] each. None when it takes more.
 * @param {!Array<number>} a Where the path is.
 * @param {!Array<number>} b Where it goes.
 * @param {{reach: !Map, ways: !Map}} g ground() of the pixels it may cross.
 * @returns {!Array<!Array<!Array<number>>>} The ways.
 */
function corners(a, b, g) {
    const ia = at(a[0], a[1]), ib = at(b[0], b[1]);
    const id = ia * 1048576 + ib;
    if (g.ways.has(id)) return g.ways.get(id);
    const from = g.reach.get(ia), to = g.reach.get(ib);
    let out = [];
    if (from.has(ib)) {
        out = [[]];
    } else {
        for (const [k, c] of from) if (to.has(k)) out.push([c]);
        if (!out.length) {
            for (const [k, c] of from) for (const [k2, e] of g.reach.get(k)) if (to.has(k2)) out.push([c, e]);
        }
    }
    g.ways.set(id, out);
    return out;
}

/**
 * The cheapest merge of two paths: one's end to the other's start, either way round each, by
 * corners() over the ground's pixels. Only the points round where they meet can tidy away, so the
 * merged path's length is counted from those alone.
 * @param {!Array<!Array<number>>} p A tidy path.
 * @param {!Array<!Array<number>>} q Another.
 * @param {{reach: !Map, ways: !Map}} g ground() of the pixels they may cross.
 * @returns {?{saving: number, pts: !Array<!Array<number>>}} The merged path and the bytes it
 *     saves; null when no merge saves any.
 */
function merge(p, q, g) {
    let best = null;
    for (const pp of [p, p.slice().reverse()]) {
        for (const qq of [q, q.slice().reverse()]) {
            for (const mid of corners(pp[pp.length - 1], qq[0], g)) {
                const n = pp.length + qq.length - 4 + tidy(pp.slice(-2).concat(mid, qq.slice(0, 2))).length;
                const saving = cost(p) + cost(q) - (9 + 4 * n);
                if (saving > 0 && (!best || saving > best.saving)) best = { saving, pp, mid, qq };
            }
        }
    }
    return best && { saving: best.saving, pts: tidy(best.pp.concat(best.mid, best.qq)) };
}

/**
 * The paths merged (merge()), the merge that saves the most bytes first, while one saves any.
 * @param {!Array<!Array<!Array<number>>>} list Tidy paths of one class.
 * @param {{reach: !Map, ways: !Map}} g ground() of the pixels they may cross.
 * @returns {!Array<!Array<!Array<number>>>} The paths left.
 */
function bridged(list, g) {
    const live = new Map(list.map((p, i) => [i, p]));
    let merges = [];
    const consider = (i, j) => {
        const m = merge(live.get(i), live.get(j), g);
        if (m) merges.push({ i, j, ...m });
    };
    const ids = [...live.keys()];
    ids.forEach((i, n) => ids.slice(n + 1).forEach((j) => consider(i, j)));
    for (let next = list.length; ; next++) {
        const top = merges.reduce((best, m) => (!best || m.saving > best.saving ? m : best), null);
        if (!top) return [...live.values()];
        live.delete(top.i);
        live.delete(top.j);
        merges = merges.filter((m) => m.i !== top.i && m.i !== top.j && m.j !== top.i && m.j !== top.j);
        live.set(next, top.pts);
        for (const i of live.keys()) if (i !== next) consider(i, next);
    }
}

/**
 * Every order of a list.
 * @param {!Array<number>} xs The list.
 * @returns {!Array<!Array<number>>} Its orders.
 */
function orders(xs) {
    if (xs.length < 2) return [xs];
    return [].concat(...xs.map((x, i) => orders(xs.filter((_, j) => j !== i)).map((rest) => [x].concat(rest))));
}

/**
 * Each pixel's class once the commands are drawn in order: the last one's over it.
 * @param {!Array<{thirds: number, pts: !Array<!Array<number>>}>} cmds The commands.
 * @returns {!Map<string, number>} By "x,y".
 * @throws {Error} On a run that is not level, upright or at 45 degrees, which no 1 px line draws
 *     the same with smoothing on and off.
 */
function painted(cmds) {
    const out = new Map();
    for (const { thirds, pts } of cmds) {
        for (let k = 1; k < pts.length; k++) {
            const [a, b] = [pts[k - 1], pts[k]];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) throw new Error('a run that is not level, upright or at 45 degrees');
            for (let i = 0; i <= Math.max(Math.abs(dx), Math.abs(dy)); i++) {
                out.set((a[0] + i * Math.sign(dx)) + ',' + (a[1] + i * Math.sign(dy)), thirds);
            }
        }
    }
    return out;
}

/**
 * The pixels lines light, where they light exact pixels: every point a pixel's centre and every
 * run level, upright or at 45 degrees, which a 1 px line draws the same with smoothing on and off.
 * @param {!Array<!Array<!Array<number>>>} lines The lines' points, [x, y] each, a dot a point twice.
 * @returns {?Array<!Array<number>>} [x, y] of each pixel they light; null when one is smoothed.
 */
function exactPixels(lines) {
    const whole = (p) => Number.isInteger(p[0]) && Number.isInteger(p[1]);
    const straight = (a, b) => a[0] === b[0] || a[1] === b[1] || Math.abs(b[0] - a[0]) === Math.abs(b[1] - a[1]);
    if (!lines.every((pts) => pts.every((p, k) => whole(p) && (k === 0 || straight(pts[k - 1], p))))) return null;
    return [...painted(lines.map((pts) => ({ thirds: 0, pts }))).keys()].map((k) => k.split(',').map(Number));
}

/**
 * A drawing's pixels by class: its ink (0), and each faded pixel's thirds (1 or 2) over it.
 * @param {!Array<!Array<number>>} ink [x, y] of each ink pixel.
 * @param {!Array<!Array<number>>=} faded [x, y, thirds] of each faded pixel.
 * @returns {!Map<string, number>} Each pixel's class by "x,y".
 */
function classesOf(ink, faded = []) {
    const out = new Map(ink.map(([x, y]) => [x + ',' + y, 0]));
    faded.forEach(([x, y, thirds]) => out.set(x + ',' + y, thirds));
    return out;
}

// The commands each drawing was given, by its pixels and classes: a caller that builds the same
// drawings again (the icon creator's watch test builds the app's and its own) finds them here.
const found = new Map();

/**
 * A drawing's commands, in as few bytes as this finds: each class's paths in turn, in the order
 * of the classes that costs least, a path crossing only pixels of its own class and of the classes
 * after it. Drawn in order, they paint exactly `classes`.
 * @param {!Map<string, number>} classes Each pixel's class by "x,y" (classesOf()).
 * @param {string=} where The drawing, for the error.
 * @returns {!Array<{thirds: number, pts: !Array<!Array<number>>}>} The commands, in order: thirds
 *     0 for the ink.
 * @throws {Error} When they would paint any pixel otherwise (a fault here, never the drawing's).
 */
function commands(classes, where = 'a drawing') {
    const id = [...classes].join(';');
    if (!found.has(id)) found.set(id, cheapest(classes, where));
    return found.get(id).map(({ thirds, pts }) => ({ thirds, pts: pts.map((p) => p.slice()) }));
}

/**
 * commands(), worked out.
 * @param {!Map<string, number>} classes Each pixel's class by "x,y".
 * @param {string} where The drawing, for the error.
 * @returns {!Array<{thirds: number, pts: !Array<!Array<number>>}>} The commands, in order.
 */
function cheapest(classes, where) {
    const px = new Map();
    for (const [k, c] of classes) {
        if (!px.has(c)) px.set(c, []);
        px.get(c).push(k.split(',').map(Number));
    }
    // A class's paths cross the pixels of the classes from it on: one ground, and one set of paths
    // for each way of picking runs, for every order that leaves the same classes to draw.
    const grounds = new Map(), drawn = new Map();
    const pathsOf = (c, left, trim) => {
        const id = left.slice().sort().join();
        if (!grounds.has(id)) grounds.set(id, ground([].concat(...left.map((d) => px.get(d)))));
        const g = grounds.get(id);
        const key = c + '|' + id + '|' + trim;
        if (!drawn.has(key)) drawn.set(key, bridged(paths(runs(px.get(c), g.over, trim)).map(tidy), g));
        return drawn.get(key);
    };
    let best = null;
    for (const order of orders([...px.keys()].sort())) {
        for (const trim of [false, true]) {
            const cmds = [];
            order.forEach((c, k) => pathsOf(c, order.slice(k), trim).forEach((pts) => cmds.push({ thirds: c, pts })));
            const bytes = cmds.reduce((sum, cmd) => sum + cost(cmd.pts), 0);
            if (!best || bytes < best.bytes) best = { bytes, cmds };
        }
    }
    const got = painted(best.cmds);
    if (got.size !== classes.size || [...classes].some(([k, c]) => got.get(k) !== c)) {
        throw new Error(where + ': its commands paint other pixels than its drawing');
    }
    return best.cmds;
}

module.exports = { runs, paths, tidy, commands, classesOf, painted, exactPixels };

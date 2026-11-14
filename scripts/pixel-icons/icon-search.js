/**
 * The icon picker's chooser of library icons (README.md in this folder, "An icon from an SVG"):
 * Lucide's and Tabler's outline icons, which build_picker.py writes as icons-<set>.js beside the
 * page, searched by name and by the library's own tags, and each made into the SVG that Add SVG
 * takes, as if its file had been chosen.
 *
 * A set: {id, name, version, home, licence, icons: [[name, body, tags], ...]}, where body is the
 * icon's shapes alone (path, circle, ellipse, line, polyline, polygon, rect with their geometry,
 * nothing else; build_picker.py icon_body) and tags the library's words for it, space-separated.
 *
 * Works in node (require) and in a page (window.IconSearch).
 */
(function (root) {
    'use strict';

    // The outline icons' own drawing attributes: both libraries draw every icon with these.
    const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    /**
     * The words of a search: lower case, split at spaces and hyphens.
     * @param {string} query @returns {Array<string>}
     */
    function words(query) {
        return String(query || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
    }

    /**
     * How well an icon answers a search, lower is better, or -1 when it does not: 0 its name is
     * the search, 1 every word is a whole word of its name (cloud-rain for "rain"), 2 its name
     * starts with the search (rainbow), 3 every word starts a word of its name, 4 every word is
     * in its name (brain), 5 a word is only in its tags.
     * @param {Array} icon [name, body, tags]. @param {Array<string>} ws The search's words.
     * @returns {number}
     */
    function rank(icon, ws) {
        const name = icon[0], joined = ws.join('-'), nameWords = name.split('-');
        const starts = (w, list) => list.some((x) => x.indexOf(w) === 0);
        if (name === joined) return 0;
        if (ws.every((w) => nameWords.indexOf(w) >= 0)) return 1;
        if (name.indexOf(joined) === 0) return 2;
        if (ws.every((w) => starts(w, nameWords))) return 3;
        if (ws.every((w) => name.indexOf(w) >= 0)) return 4;
        const tagWords = String(icon[2] || '').split(' ');
        if (ws.every((w) => name.indexOf(w) >= 0 || starts(w, tagWords))) return 5;
        return -1;
    }

    /**
     * A set's icons that answer a search, the best first (rank, then the shorter name, then A to Z).
     * @param {Object} set An icon set. @param {string} query The search.
     * @param {number} [limit] At most this many (default 48).
     * @returns {{icons: Array, total: number}} The first icons and how many answer in all; none
     *   for an empty search.
     */
    function findIcons(set, query, limit) {
        const ws = words(query), max = limit || 48;
        if (!ws.length || !set || !set.icons) return { icons: [], total: 0 };
        const hits = [];
        set.icons.forEach((icon) => {
            const r = rank(icon, ws);
            if (r >= 0) hits.push([r, icon]);
        });
        hits.sort((a, b) => a[0] - b[0] || a[1][0].length - b[1][0].length || (a[1][0] < b[1][0] ? -1 : 1));
        return { icons: hits.slice(0, max).map((h) => h[1]), total: hits.length };
    }

    /**
     * An icon as the SVG Add SVG takes: the 24-unit box, the outline drawing attributes and a
     * comment naming where it came from (svg-icon.js skips comments).
     * @param {Object} set Its set. @param {Array} icon [name, body, tags].
     * @returns {string}
     */
    function svgText(set, icon) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' + STROKE + '><!-- '
            + set.name + ' ' + set.version + ': ' + icon[0] + ' -->' + icon[1] + '</svg>';
    }

    /**
     * An icon drawn for the chooser's grid: the library's own vector drawing, size px square.
     * @param {Array} icon [name, body, tags]. @param {number} size @returns {string}
     */
    function preview(icon, size) {
        return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" ' + STROKE
            + ' aria-hidden="true" focusable="false">' + icon[1] + '</svg>';
    }

    const api = { words, rank, findIcons, svgText, preview };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.IconSearch = api;
    }
})(typeof window !== 'undefined' ? window : this);

// src/pkjs/settings/news-protocol.js — ES5, WebView + Node. The news WIRE
// protocol: the edge function's request payload shapes (list/seen/reply/vote)
// and the cache parse + unread arithmetic both sides share. Split out of
// news.js so the PHONE bundle (news-cache.js rides index.js's require graph)
// stops parsing the ~500-line webview widget — markdown renderer, modal HTML,
// CSS — just to build a list payload and count unread items. Each side keeps
// its own XHR poster (different contexts and signatures); the payload SHAPES
// live here, in lockstep with supabase/functions news handling.
(function () {
    /**
     * Count items newer than the seen watermark. A null/undefined watermark
     * (no account token → server returned lastSeenId: null) means unread is
     * unknowable — show no badge.
     *
     * @param {Array<{id: number}>} items News items.
     * @param {?number} lastSeenId Watermark or null.
     * @returns {number} Unread count.
     */
    function countUnread(items, lastSeenId) {
        if (lastSeenId === null || lastSeenId === undefined) { return 0; }
        var n = 0, i;
        for (i = 0; i < items.length; i += 1) {
            if (items[i].id > lastSeenId) { n += 1; }
        }
        return n;
    }

    /**
     * Highest item id, 0 for an empty list — the value `seen` reports.
     *
     * @param {Array<{id: number}>} items News items.
     * @returns {number} Max id.
     */
    function maxId(items) {
        var m = 0, i;
        for (i = 0; i < items.length; i += 1) {
            if (items[i].id > m) { m = items[i].id; }
        }
        return m;
    }

    /**
     * Parse the injected news cache (the raw `list` response text the phone
     * cached for an hour). Anything absent or malformed degrades to the empty
     * state so the pill still renders.
     *
     * @param {?string} text Raw cached response text ('' or null when absent).
     * @returns {{items: Array<Object>, lastSeenId: ?number}} Items + watermark.
     */
    function parseNewsCache(text) {
        var data = null;
        if (text) {
            try { data = JSON.parse(text); } catch (e) { data = null; }
        }
        if (!data || !Array.isArray(data.items)) {
            return { items: [], lastSeenId: null };
        }
        return {
            items: data.items,
            lastSeenId: (data.lastSeenId === undefined) ? null : data.lastSeenId
        };
    }

    /**
     * @param {{appVersion: string, accountToken: string}} userData Injected userData.
     * @returns {Object} list request body.
     */
    function buildListPayload(userData) {
        return {
            op: 'list',
            accountToken: (userData && userData.accountToken) || '',
            version: (userData && userData.appVersion) || ''
        };
    }

    /**
     * @param {{accountToken: string}} userData Injected userData.
     * @param {number} seenId Highest fetched news id.
     * @returns {Object} seen request body.
     */
    function buildSeenPayload(userData, seenId) {
        return {
            op: 'seen',
            accountToken: (userData && userData.accountToken) || '',
            maxSeenId: seenId
        };
    }

    /**
     * @param {{appVersion: string, accountToken: string}} userData Injected userData.
     * @param {number} newsId Target news item id.
     * @param {string} message Reply text.
     * @returns {Object} reply request body.
     */
    function buildReplyPayload(userData, newsId, message) {
        return {
            op: 'reply',
            accountToken: (userData && userData.accountToken) || '',
            version: (userData && userData.appVersion) || '',
            newsId: newsId,
            message: message
        };
    }

    /**
     * @param {{accountToken: string}} userData Injected userData.
     * @param {number} newsId Target news item id.
     * @param {number} choiceIndex Index into the item's choices array.
     * @returns {Object} vote request body.
     */
    function buildVotePayload(userData, newsId, choiceIndex) {
        return {
            op: 'vote',
            accountToken: (userData && userData.accountToken) || '',
            newsId: newsId,
            choiceIndex: choiceIndex
        };
    }

    var api = {
        countUnread: countUnread,
        maxId: maxId,
        parseNewsCache: parseNewsCache,
        buildListPayload: buildListPayload,
        buildSeenPayload: buildSeenPayload,
        buildReplyPayload: buildReplyPayload,
        buildVotePayload: buildVotePayload
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.NewsProtocol = api; }
})();

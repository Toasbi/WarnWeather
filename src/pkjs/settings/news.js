// src/pkjs/settings/news.js — config UI (phone webview) + Node-testable.
//
// News pill + popup for the settings header: fetches announcements from the
// `news` Supabase edge function (general + exact-version-targeted), shows an
// unread badge against a server-side per-account watermark, renders a small
// escaped-first markdown subset, and sends private per-item replies
// (rate-limited server-side to 10/day). Pure helpers are exported for unit
// tests; the webview wiring lives at the bottom, guarded like owm-key-test.js.
(function () {
    /**
     * Escape the HTML metacharacters. Runs BEFORE any markdown transform so
     * authored (or mis-authored) markup can never reach the DOM live.
     *
     * @param {string} s Raw text.
     * @returns {string} Escaped text.
     */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Inline markdown on one already-escaped line: links (http/https only),
     * then bold, then italic. Anything else stays literal text.
     *
     * @param {string} line Escaped line.
     * @returns {string} Line with inline HTML.
     */
    function renderInline(line) {
        return line
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/\*([^*]+)\*/g, '<i>$1</i>');
    }

    /**
     * Render the supported markdown subset to HTML. Escapes first; supports
     * **bold**, *italic*, [text](http(s)://url), `- ` bullet lists, and line
     * breaks. Unknown syntax degrades to plain text.
     *
     * @param {string} md Markdown source.
     * @returns {string} HTML.
     */
    function renderMarkdown(md) {
        var lines = escapeHtml(md).split(/\r?\n/);
        var out = [], list = null, i, line, prev;
        for (i = 0; i < lines.length; i += 1) {
            line = lines[i];
            if (line.indexOf('- ') === 0) {
                if (!list) {
                    // A list block carries no leading <br>: drop the trailing
                    // <br> the previous text line appended before it opens.
                    list = [];
                    prev = out.length - 1;
                    if (prev >= 0 && out[prev].slice(-4) === '<br>') {
                        out[prev] = out[prev].slice(0, -4);
                    }
                }
                list.push('<li>' + renderInline(line.slice(2)) + '</li>');
            } else {
                if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
                out.push(renderInline(line) + '<br>');
            }
        }
        if (list) { out.push('<ul>' + list.join('') + '</ul>'); }
        var html = out.join('');
        // Strip every trailing <br> (a trailing newline emits an empty line).
        while (html.length >= 4 && html.lastIndexOf('<br>') === html.length - 4) {
            html = html.slice(0, -4);
        }
        return html;
    }

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
     * Interpret the reply XHR status into a user-facing verdict.
     *
     * @param {number} status XHR status (0 for network/timeout failures).
     * @returns {{ok: boolean, message: string}} Verdict + message.
     */
    function interpretReplyStatus(status) {
        if (status >= 200 && status < 300) {
            return { ok: true, message: 'Sent ✓' };
        }
        if (status === 429) {
            return { ok: false, message: 'Daily limit reached (10 replies/day) — try again tomorrow.' };
        }
        if (!status) {
            return { ok: false, message: 'Couldn’t send — check your connection.' };
        }
        return { ok: false, message: 'Unexpected response (' + status + ').' };
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

    /**
     * Render a poll's option buttons plus its status line for one news item.
     * Labels are escaped; the account's current vote carries the "on" class.
     *
     * @param {{id: number, choices: ?Array<string>, myChoice: ?number}} item News item.
     * @returns {string} HTML, or '' when the item has no poll.
     */
    function renderChoicesHtml(item) {
        var choices = item && item.choices;
        if (!choices || !choices.length) { return ''; }
        var html = '<div class="news-choices">', i, on;
        for (i = 0; i < choices.length; i += 1) {
            on = (item.myChoice === i);
            html += '<button class="news-choice' + (on ? ' on' : '') + '"'
                + ' data-news-vote="' + item.id + '" data-choice-index="' + i + '">'
                + escapeHtml(String(choices[i])) + '</button>';
        }
        html += '</div><div class="news-vote-status" data-news-vote-status="' + item.id + '"></div>';
        return html;
    }

    /* __NEWS_DOM_WIRING__ (filled by the DOM-wiring task) */

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            renderMarkdown: renderMarkdown,
            countUnread: countUnread,
            maxId: maxId,
            interpretReplyStatus: interpretReplyStatus,
            buildListPayload: buildListPayload,
            buildSeenPayload: buildSeenPayload,
            buildReplyPayload: buildReplyPayload,
            buildVotePayload: buildVotePayload,
            renderChoicesHtml: renderChoicesHtml
        };
    }
}());

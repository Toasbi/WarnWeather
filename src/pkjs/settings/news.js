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

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;

    if (PConf && typeof document !== 'undefined') {
        var USERDATA = (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
        var newsItems = [];
        var newsLastSeenId = null;
        var newsOverlay = null;
        var newsPill = null;
        var newsSeenSent = false;

        /**
         * POST a JSON payload to the news edge function.
         *
         * @param {Object} payload Request body.
         * @param {number} timeoutMs XHR timeout.
         * @param {function(number, string)} cb Called with (status, responseText); status 0 on network/timeout failure.
         */
        var postNews = function (payload, timeoutMs, cb) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', USERDATA.newsEndpoint);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = timeoutMs;
            xhr.onload = function () { cb(xhr.status, xhr.responseText || ''); };
            xhr.onerror = function () { cb(0, ''); };
            xhr.ontimeout = function () { cb(0, ''); };
            xhr.send(JSON.stringify(payload));
        };

        var injectNewsStyles = function () {
            var css = ''
                + '#newsHint { position: relative; margin-left: auto; margin-right: 10px; padding: 5px 9px;'
                +   ' border: 1px solid var(--ctl-line); border-radius: 11px; background: var(--ctl);'
                +   ' font-size: 15px; line-height: 1; cursor: pointer; }'
                + '#newsHint .news-badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px;'
                +   ' border-radius: 8px; background: #FA4A35; color: #FFFFFF; font: 700 11px \'Inter\', sans-serif;'
                +   ' line-height: 16px; text-align: center; padding: 0 3px; }'
                + '.news-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 60;'
                +   ' background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }'
                + '.news-modal { background: var(--card); color: var(--fg); border: 1px solid var(--card-line);'
                +   ' border-radius: 14px; width: calc(100% - 32px); max-width: 420px; max-height: 80vh;'
                +   ' overflow-y: auto; padding: 4px 16px 16px; }'
                + '.news-modal-hdr { display: flex; align-items: center; justify-content: space-between; }'
                + '.news-modal-hdr h2 { font-size: 17px; margin: 12px 0 4px; }'
                + '.news-close { border: none; background: none; color: var(--muted); font-size: 20px; cursor: pointer; padding: 8px 0 0 8px; }'
                + '.news-item { border-top: 1px solid var(--row-line); padding: 10px 0 12px; }'
                + '.news-item:first-of-type { border-top: none; }'
                + '.news-title { font-weight: 700; }'
                + '.news-date { color: var(--muted); font-size: 11px; margin: 2px 0 6px; }'
                + '.news-body { font-size: 13px; line-height: 1.45; }'
                + '.news-body a { color: var(--link); }'
                + '.news-body ul { margin: 4px 0; padding-left: 20px; }'
                + '.news-choices { margin-top: 8px; }'
                + '.news-choice { border: 1px solid var(--ctl-line); border-radius: 9px; background: var(--ctl);'
                +   ' color: var(--fg); font: 600 12px \'Inter\', sans-serif; padding: 5px 10px; cursor: pointer;'
                +   ' margin: 0 6px 6px 0; }'
                + '.news-choice.on { border-color: #FA4A35; box-shadow: 0 0 0 1px #FA4A35; }'
                + '.news-vote-status { color: var(--muted); font-size: 12px; min-height: 14px; }'
                + '.news-reply-toggle { margin-top: 8px; border: 1px solid var(--ctl-line); border-radius: 9px;'
                +   ' background: var(--ctl); color: var(--fg); font: 600 12px \'Inter\', sans-serif; padding: 5px 10px; cursor: pointer; }'
                + '.news-reply-box { margin-top: 8px; }'
                + '.news-reply-box textarea { width: 100%; border: 1px solid var(--ctl-line); border-radius: 9px;'
                +   ' background: var(--ctl); color: var(--fg); font: 400 13px \'Inter\', sans-serif; padding: 8px; resize: vertical; }'
                + '.news-reply-status { color: var(--muted); font-size: 12px; margin-top: 4px; min-height: 14px; }';
            var style = document.createElement('style');
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        };
        /**
         * Render the popup's inner HTML from the fetched items. Titles are
         * escaped; bodies go through renderMarkdown (which escapes first).
         * Reply UI is omitted entirely when no account token is available.
         *
         * @param {Array<Object>} items News items.
         * @returns {string} Modal HTML.
         */
        var renderNewsListHtml = function (items) {
            var canReply = Boolean(USERDATA.accountToken);
            var html = '<div class="news-modal-hdr"><h2>News</h2>'
                + '<button class="news-close" data-news-close="1">✕</button></div>';
            var i, it;
            for (i = 0; i < items.length; i += 1) {
                it = items[i];
                html += '<div class="news-item">'
                    + '<div class="news-title">' + escapeHtml(it.title) + '</div>'
                    + '<div class="news-date">' + escapeHtml(String(it.created_at).slice(0, 10)) + '</div>'
                    + '<div class="news-body">' + renderMarkdown(it.body_md) + '</div>';
                if (canReply) {
                    html += renderChoicesHtml(it);
                    html += '<button class="news-reply-toggle" data-news-reply="' + it.id + '">Reply</button>'
                        + '<div class="news-reply-box" data-news-reply-box="' + it.id + '" style="display:none">'
                        + '<textarea maxlength="1000" rows="3" data-news-reply-text="' + it.id + '"></textarea>'
                        + '<button class="news-reply-toggle" data-news-send="' + it.id + '">Send</button>'
                        + '<div class="news-reply-status" data-news-reply-status="' + it.id + '"></div>'
                        + '</div>';
                }
                html += '</div>';
            }
            return html;
        };

        var sendNewsReply = function (id) {
            var ta = newsOverlay.querySelector('[data-news-reply-text="' + id + '"]');
            var statusEl = newsOverlay.querySelector('[data-news-reply-status="' + id + '"]');
            var btn = newsOverlay.querySelector('[data-news-send="' + id + '"]');
            var msg = ta ? ta.value : '';
            if (!statusEl || !btn) { return; }
            if (!msg || !msg.replace(/\s/g, '')) {
                statusEl.textContent = 'Write a message first.';
                return;
            }
            btn.disabled = true;
            statusEl.textContent = 'Sending…';
            postNews(buildReplyPayload(USERDATA, Number(id), msg), 8000, function (status) {
                var verdict = interpretReplyStatus(status);
                statusEl.textContent = verdict.message;
                btn.disabled = false;
                if (verdict.ok && ta) { ta.value = ''; }
            });
        };

        var sendNewsVote = function (btn) {
            var id = btn.getAttribute('data-news-vote');
            var idx = Number(btn.getAttribute('data-choice-index'));
            var statusEl = newsOverlay.querySelector('[data-news-vote-status="' + id + '"]');
            btn.disabled = true;
            if (statusEl) { statusEl.textContent = 'Sending…'; }
            postNews(buildVotePayload(USERDATA, Number(id), idx), 8000, function (status) {
                var verdict = interpretReplyStatus(status);
                btn.disabled = false;
                if (statusEl) { statusEl.textContent = verdict.message; }
                if (verdict.ok) {
                    var all = newsOverlay.querySelectorAll('[data-news-vote="' + id + '"]');
                    var i;
                    for (i = 0; i < all.length; i += 1) { all[i].className = 'news-choice'; }
                    btn.className = 'news-choice on';
                }
            });
        };

        var openNewsPopup = function () {
            if (!newsOverlay) {
                injectOverlay();
            }
            newsOverlay.style.display = 'flex';
            // Advance the server-side watermark once per page load; failure is
            // silent — the badge just reappears next open and heals then.
            if (USERDATA.accountToken && !newsSeenSent && maxId(newsItems) > (newsLastSeenId || 0)) {
                newsSeenSent = true;
                postNews(buildSeenPayload(USERDATA, maxId(newsItems)), 6000, function () {});
            }
            var badge = newsPill.querySelector('.news-badge');
            if (badge) { badge.parentNode.removeChild(badge); }
        };
        var injectOverlay = function () {
            newsOverlay = document.createElement('div');
            newsOverlay.className = 'news-overlay';
            newsOverlay.innerHTML = '<div class="news-modal">' + renderNewsListHtml(newsItems) + '</div>';
            newsOverlay.addEventListener('click', function (e) {
                var t;
                if (e.target === newsOverlay || e.target.closest('[data-news-close]')) {
                    newsOverlay.style.display = 'none';
                    return;
                }
                if ((t = e.target.closest('[data-news-reply]'))) {
                    var box = newsOverlay.querySelector('[data-news-reply-box="' + t.getAttribute('data-news-reply') + '"]');
                    if (box) { box.style.display = box.style.display === 'none' ? 'block' : 'none'; }
                    return;
                }
                if ((t = e.target.closest('[data-news-send]'))) {
                    sendNewsReply(t.getAttribute('data-news-send'));
                    return;
                }
                if ((t = e.target.closest('[data-news-vote]'))) {
                    sendNewsVote(t);
                }
            });
            document.body.appendChild(newsOverlay);
        };

        var injectNewsPill = function () {
            var hdr = document.querySelector('.hdr');
            var saveBtn = document.getElementById('save');
            if (!hdr || !saveBtn) { return; }
            injectNewsStyles();
            newsPill = document.createElement('button');
            newsPill.id = 'newsHint';
            newsPill.type = 'button';
            var unread = countUnread(newsItems, newsLastSeenId);
            newsPill.innerHTML = '📰' + (unread > 0 ? '<span class="news-badge">' + unread + '</span>' : '');
            newsPill.onclick = openNewsPopup;
            hdr.insertBefore(newsPill, saveBtn);
        };

        var initNews = function () {
            if (!USERDATA.newsEndpoint) { return; }
            postNews(buildListPayload(USERDATA), 6000, function (status, text) {
                if (status < 200 || status >= 300) {
                    console.log('news: list failed status=' + status);
                    return;
                }
                var data;
                try { data = JSON.parse(text); } catch (e) { return; }
                if (!data || !data.items || !data.items.length) { return; }
                newsItems = data.items;
                newsLastSeenId = data.lastSeenId;
                injectNewsPill();
            });
        };

        initNews();
    }

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

const test = require('node:test');
const assert = require('node:assert/strict');

const news = require('../src/pkjs/settings/news');

// --- renderMarkdown ---

test('renderMarkdown escapes HTML before anything else', () => {
  const html = news.renderMarkdown('<script>alert(1)</script> & "x"');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;x&quot;/);
});

test('renderMarkdown: bold, italic, and both on one line', () => {
  assert.equal(news.renderMarkdown('**b**'), '<b>b</b>');
  assert.equal(news.renderMarkdown('*i*'), '<i>i</i>');
  assert.equal(news.renderMarkdown('**b** and *i*'), '<b>b</b> and <i>i</i>');
});

test('renderMarkdown: http(s) links become anchors, others stay literal', () => {
  assert.equal(
    news.renderMarkdown('[repo](https://example.com/x)'),
    '<a href="https://example.com/x" target="_blank" rel="noopener">repo</a>');
  // javascript: URL does not match the http(s) pattern -> literal text
  const html = news.renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /javascript:alert/);
});

test('renderMarkdown: consecutive dash lines form one list', () => {
  assert.equal(
    news.renderMarkdown('intro\n- one\n- **two**\noutro'),
    'intro<ul><li>one</li><li><b>two</b></li></ul>outro');
});

test('renderMarkdown: plain newlines become <br>, no trailing <br>', () => {
  assert.equal(news.renderMarkdown('a\nb'), 'a<br>b');
  assert.equal(news.renderMarkdown('a\n'), 'a');
});

// --- countUnread / maxId ---

test('countUnread counts ids above the watermark', () => {
  const items = [{ id: 3 }, { id: 2 }, { id: 1 }];
  assert.equal(news.countUnread(items, 1), 2);
  assert.equal(news.countUnread(items, 3), 0);
  assert.equal(news.countUnread(items, 0), 3);
  assert.equal(news.countUnread([], 0), 0);
});

test('countUnread: null/undefined watermark (no account token) means no badge', () => {
  assert.equal(news.countUnread([{ id: 5 }], null), 0);
  assert.equal(news.countUnread([{ id: 5 }], undefined), 0);
});

test('maxId returns the highest id, 0 for empty', () => {
  assert.equal(news.maxId([{ id: 3 }, { id: 7 }, { id: 1 }]), 7);
  assert.equal(news.maxId([]), 0);
});

// --- interpretReplyStatus ---

test('interpretReplyStatus maps 2xx/429/0/other', () => {
  assert.equal(news.interpretReplyStatus(202).ok, true);
  assert.equal(news.interpretReplyStatus(202).message, 'Sent ✓');
  const limited = news.interpretReplyStatus(429);
  assert.equal(limited.ok, false);
  assert.match(limited.message, /10 replies\/day/);
  assert.match(news.interpretReplyStatus(0).message, /connection/i);
  assert.match(news.interpretReplyStatus(500).message, /500/);
});

// --- payload builders ---

test('payload builders mirror the edge-function contract', () => {
  const ud = { newsEndpoint: 'https://x/functions/v1/news', appVersion: '1.8.0', accountToken: 'tok' };
  assert.deepEqual(news.buildListPayload(ud),
    { op: 'list', accountToken: 'tok', version: '1.8.0' });
  assert.deepEqual(news.buildSeenPayload(ud, 7),
    { op: 'seen', accountToken: 'tok', maxSeenId: 7 });
  assert.deepEqual(news.buildReplyPayload(ud, 3, 'hello'),
    { op: 'reply', accountToken: 'tok', version: '1.8.0', newsId: 3, message: 'hello' });
});

test('payload builders tolerate missing userData fields', () => {
  assert.deepEqual(news.buildListPayload({}),
    { op: 'list', accountToken: '', version: '' });
});

test('buildVotePayload mirrors the vote contract', () => {
  const ud = { newsEndpoint: 'https://x/functions/v1/news', appVersion: '1.8.0', accountToken: 'tok' };
  assert.deepEqual(news.buildVotePayload(ud, 3, 1),
    { op: 'vote', accountToken: 'tok', newsId: 3, choiceIndex: 1 });
});

// --- renderChoicesHtml ---

test('renderChoicesHtml renders escaped option buttons with the vote highlighted', () => {
  const html = news.renderChoicesHtml({ id: 3, choices: ['Yes', '<b>No</b>'], myChoice: 1 });
  assert.match(html, /<button class="news-choice" data-news-vote="3" data-choice-index="0">Yes<\/button>/);
  // option 1 is the current vote -> "on" class; its label is escaped, never live HTML
  assert.match(html, /<button class="news-choice on" data-news-vote="3" data-choice-index="1">&lt;b&gt;No&lt;\/b&gt;<\/button>/);
  assert.doesNotMatch(html, /<b>No<\/b>/);
  assert.match(html, /data-news-vote-status="3"/);
});

test('renderChoicesHtml: unvoted poll has no "on" class', () => {
  const html = news.renderChoicesHtml({ id: 2, choices: ['A', 'B'], myChoice: null });
  assert.doesNotMatch(html, /news-choice on/);
});

test('renderChoicesHtml: no/empty choices -> empty string', () => {
  assert.equal(news.renderChoicesHtml({ id: 1, choices: null }), '');
  assert.equal(news.renderChoicesHtml({ id: 1 }), '');
  assert.equal(news.renderChoicesHtml({ id: 1, choices: [] }), '');
});

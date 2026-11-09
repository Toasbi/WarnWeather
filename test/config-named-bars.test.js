// test/config-named-bars.test.js — 2.7.0's named status bars on the settings page: a bar's
// name (screens.js barName, the page-only <prefix>Name keys), the Status bars tab's Name rows
// and titles, the screen editor's bar rows (Also on, the Bar card, the picker of your bars),
// and the names wherever the page speaks of a bar (the slot pickers, the Alerts tab, the
// previews).
const test = require('node:test');
const assert = require('node:assert/strict');

// clay-payload's holiday mask reads localStorage: a store before any module loads.
const STORE = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); },
  removeItem: (k) => { delete STORE[k]; }
};

const { bootGeneratedPage } = require('./helpers/page-harness.js');
const { rowOf, editorBody: body } = require('./helpers/page-rows.js');
const M = require('../src/pkjs/screens.js');
const VC = require('../src/pkjs/view-cycle.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { buildClayPayload } = require('../src/pkjs/clay-payload.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
// An upgraded install's three screens: Default (Forecast bar), Flick 1 (Health bar), Flick 2
// (Radar bar).
const THREE = { provider: 'dwd', radarMode: 'graph', healthMode: 'all' };

/**
 * The open select sheet's title.
 * @param {Object} page bootGeneratedPage handle.
 * @param {string} key The select's key.
 * @returns {string}
 */
function sheetTitle(page, key) {
  const m = new RegExp('id="ssel-ttl-' + key + '"[^>]*>([^<]*)<').exec(page.modal.innerHTML);
  return m ? m[1] : '';
}

/**
 * The editor's rows, top to bottom: each row's name and its value ('' for none).
 * @param {string} html The editor's body.
 * @returns {Array<string>}
 */
function editorRows(html) {
  const out = [];
  const re = /<div class="se-row" role="listitem" data-j="\d+">[\s\S]*?<span>([^<]*)<\/span>(?:<span class="se-val">([^<]*)<\/span>)?/g;
  let m;
  while ((m = re.exec(html))) { out.push(m[2] ? m[1] + ' · ' + m[2] : m[1]); }
  return out;
}

/**
 * The text a card's header shows, by its card's first row key.
 * @param {string} html The tab's markup.
 * @param {string} key A messageKey the card holds.
 * @returns {string} The title of the last card header before that row.
 */
function titleBefore(html, key) {
  const at = html.indexOf('data-k="' + key + '"');
  assert.ok(at !== -1, key + ' renders');
  const head = html.lastIndexOf('<span class="ttl"', at);
  return html.slice(html.indexOf('>', head) + 1, html.indexOf('</span>', head));
}

// --- the names --------------------------------------------------------------------

test('a bar\'s name: its own, trimmed and at most 24 characters, else its kind\'s; the Watch bar keeps its own', () => {
  assert.equal(M.barName({}, 'forecast'), 'Forecast bar');
  assert.equal(M.barName({}, 'radar'), 'Radar bar');
  assert.equal(M.barName(null, 'health'), 'Health bar');
  assert.equal(M.barName({ statusForecastName: '  Morning  ' }, 'forecast'), 'Morning');
  assert.equal(M.barName({ statusRadarName: 'A very long name for a bar, too long' }, 'radar'), 'A very long name for a b');
  assert.equal(M.barName({ statusHealthName: '   ' }, 'health'), 'Health bar', 'blank is no name');
  assert.equal(M.barName({ statusTopName: 'Mine' }, 'top'), 'Watch bar', 'one for every screen, never renamed');
  assert.equal(M.barNameKey('forecast'), 'statusForecastName');
  assert.equal(M.barNameKey('top'), null);
  assert.equal(M.blockName({ k: 'healthbar' }, { statusHealthName: 'Fitness' }), 'Fitness');
  assert.equal(M.blockName({ k: 'clock' }, { statusHealthName: 'Fitness' }), 'Clock');
  assert.equal(M.blockName({ k: 'strip' }, {}), 'Watch bar');
});

test('the names are the page\'s own: the watch is sent the same message with or without them', () => {
  const S = Object.assign({ layoutPreset: 'custom', viewCount: '1', viewUpper0: 'weather' }, THREE);
  const named = Object.assign({ statusForecastName: 'Morning', statusRadarName: 'Wind', statusHealthName: 'Fit' }, S);
  assert.deepEqual(buildClayPayload(named, { platform: 'basalt' }, new Date(0)),
    buildClayPayload(S, { platform: 'basalt' }, new Date(0)));
  assert.deepEqual(VC.resolveViewCycle(named, BASALT), VC.resolveViewCycle(S, BASALT));
});

// --- the Status bars tab ------------------------------------------------------------

test('the Status bars tab: each of your bars opens on its Name row, saying where it shows; the Watch bar has none', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  [['statusForecastName', 'Forecast bar', 'On Default'], ['statusHealthName', 'Health bar', 'On Flick 1'],
    ['statusRadarName', 'Radar bar', 'On Flick 2']].forEach(([key, name, where]) => {
    assert.equal(titleBefore(html, key), name, key + ': its card is titled by the name');
    const row = rowOf(html, 'data-k="' + key + '"');
    assert.ok(row.startsWith('<div class="row stack nb"><div class="lbl">Name</div><div class="hint" data-hint-for="'
      + key + '">' + where + '</div>'), key + ': a Name row, its hint ' + where);
    assert.ok(row.indexOf('placeholder="' + name + '"') !== -1, key + ': the default name as its placeholder');
    assert.ok(row.indexOf('maxlength="24"') !== -1, key + ': 24 characters');
    assert.ok(html.indexOf('data-k="' + key + '"')
      < html.indexOf('class="sel-wrap" data-select="' + key.replace('Name', 'Left') + '"'), key + ': above the bar\'s slots');
  });
  assert.equal(html.indexOf('data-k="statusTopName"'), -1, 'the Watch bar keeps its name');
});

test('a bar no screen shows is still one of your bars: listed, and it says so', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });   // a new install: the Default screen alone
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  ['statusHealthName', 'statusRadarName'].forEach((key) => {
    assert.ok(html.indexOf('<div class="hint" data-hint-for="' + key + '">On no screen</div>') !== -1,
      key + ': listed, On no screen');
  });
});

test('a name typed on the Status bars tab titles its card and its slot pickers, escaped', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  const writes = page.scroll.writes;
  page.typeText('statusForecastName', 'Morning <b>');
  assert.equal(page.S.statusForecastName, 'Morning <b>');
  const html = page.scroll.innerHTML;
  assert.equal(titleBefore(html, 'statusForecastName'), 'Morning &lt;b&gt;', 'the card\'s title, escaped');
  assert.equal(html.indexOf('Morning <b>'), -1, 'never raw');
  assert.equal(page.scroll.writes, writes, 'retitled in place: the tab is not drawn again');
  assert.equal(page.scroll.retitles, 1, 'the one card');
  page.openSelect('statusForecastLeft');
  assert.equal(sheetTitle(page, 'statusForecastLeft'), 'Morning &lt;b&gt; · Left slot', 'the slot picker names it');
  // Unnamed, a picker reads its bar's own name.
  page.pickOption('statusForecastLeft', 'temp');
  page.openSelect('statusRadarMid');
  assert.equal(sheetTitle(page, 'statusRadarMid'), 'Radar bar · Middle slot');
});

// --- the screen editor ----------------------------------------------------------------

test('the editor: a bar row reads by its name, with the other screens that show it beside it', () => {
  const S = Object.assign({ statusForecastName: 'Morning' }, THREE);
  const page = bootGeneratedPage(S);
  page.tapAction('openScreen', 0);
  assert.deepEqual(editorRows(body(page)), ['Watch bar', 'Calendar · 2 rows', 'Clock', 'Morning', 'Forecast graph · Fill'],
    'this screen alone shows it: nothing beside it');
  assert.ok(body(page).indexOf('aria-label="Remove Morning"') !== -1);
  page.tapEditor({ se: 'close' });
  // The same bar on Flick 1 too.
  page.tapAction('openScreen', 1);
  page.tapEditor({ se: 'add', k: 'fcbar' });
  assert.ok(editorRows(body(page)).indexOf('Morning · Also on Default') !== -1, editorRows(body(page)).join(' | '));
  page.tapEditor({ se: 'close' });
  page.tapAction('openScreen', 0);
  assert.ok(editorRows(body(page)).indexOf('Morning · Also on Flick 1') !== -1);
  // "+ Add" offers each bar by its name.
  page.tapEditor({ se: 'rm', j: 3 });
  assert.match(body(page), /data-se="add" data-k="fcbar">\+ Morning</);
});

test('the editor: an open bar row shows its Bar card; a tap picks another of your bars; the link opens the Status bars tab', () => {
  const page = bootGeneratedPage(Object.assign({ statusRadarName: 'Wind' }, THREE));
  page.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(page.S, BASALT)[1], 'healthbar');
  page.tapEditor({ se: 'expand', j });
  let html = body(page);
  assert.match(html, /<span class="se-cap">Bar<\/span><button type="button" class="se-graph" data-se="bar" data-j="\d+" aria-haspopup="dialog">/);
  assert.match(html, /<span class="se-gname">Health bar<\/span><span class="se-ghold">Steps · Sleep<\/span>/,
    'its name and what it holds');
  assert.match(html, /data-se="editbar" data-j="\d+">Edit Health bar on the Status bars tab ›</);
  // The picker: your bars by name, what each holds and where it shows.
  page.tapEditor({ se: 'bar', j });
  const sheet = page.modal.innerHTML;
  assert.equal(sheetTitle(page, 'screenBar'), 'Bar on this screen');
  assert.match(sheet, /Your bars, by name\. Fill them on the Status bars tab\./);
  assert.match(sheet, />Forecast bar<[\s\S]*Temperature[\s\S]*on Default/);
  assert.match(sheet, />Health bar<[\s\S]*Steps · Sleep · on Flick 1/);
  assert.match(sheet, />Wind<[\s\S]*UV index[\s\S]*on Flick 2/);
  // A pick shows that bar in the row instead.
  page.pickOption('screenBar', 'radarbar');
  assert.deepEqual(M.screensOf(page.S, BASALT)[1].map((b) => b.k), ['strip', 'clock', 'radarbar', 'health']);
  html = body(page);
  assert.ok(editorRows(html).indexOf('Wind · Also on Flick 2') !== -1, editorRows(html).join(' | '));
  // The link: the editor closes, the Status bars tab opens.
  page.tapEditor({ se: 'editbar', j });
  assert.equal(page.editor(), null);
  assert.match(page.tabs.innerHTML, /<button class="tab on" data-tab="watch"/);
});

test('the bar picker greys out a bar this screen shows already', () => {
  const page = bootGeneratedPage(THREE);
  page.tapAction('openScreen', 1);
  page.tapEditor({ se: 'add', k: 'fcbar' });
  const list = M.screensOf(page.S, BASALT)[1];
  page.tapEditor({ se: 'bar', j: M.idxOf(list, 'healthbar') });
  const sheet = page.modal.innerHTML;
  const opt = (name) => {
    const at = sheet.indexOf('<span class="ssel-opt-name">' + name + '</span>');
    assert.ok(at !== -1, name + ' offered');
    return sheet.slice(sheet.lastIndexOf('<button', at), sheet.indexOf('</button>', at));
  };
  assert.match(opt('Forecast bar'), / disabled aria-disabled="true"/, 'the Forecast bar is on this screen already');
  assert.match(opt('Forecast bar'), /Already on this screen/);
  assert.match(opt('Radar bar'), /data-select-pick="radarbar"/);
  assert.match(opt('Health bar'), /data-select-pick="healthbar"/, 'the row\'s own bar stays pickable');
  // A pick of a bar the screen shows changes nothing.
  page.pickOption('screenBar', 'fcbar');
  assert.deepEqual(M.screensOf(page.S, BASALT)[1].map((b) => b.k), list.map((b) => b.k));
});

// --- the names elsewhere --------------------------------------------------------------

test('the Alerts tab and the previews speak a bar by its name, escaped', () => {
  const S = Object.assign({ statusForecastName: 'Fc <i>', statusForecastOnDemandRightItems: 'uv',
    statusTopOnDemandRightItems: 'battery,gust,aqi,wind' }, THREE);
  const page = bootGeneratedPage(S);
  page.clickTab('alerts');
  const html = page.scroll.innerHTML;
  assert.ok(html.indexOf('Fc &lt;i&gt;, right') !== -1, 'the UV row ends on where it shows, by name');
  assert.equal(html.indexOf('Fc <i>'), -1, 'never raw');
  // The pinned watch: each screen spoken by its bars' names.
  page.clickTab('watchface');
  assert.ok(page.scroll.innerHTML.indexOf('Edit Default: Watch bar, Calendar (2 rows), Clock, Fc &lt;i&gt;, Forecast')
    !== -1, 'the screen\'s picture');
});

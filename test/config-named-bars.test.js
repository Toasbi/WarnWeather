// test/config-named-bars.test.js — 2.7.0's named status bars on the settings page: a bar's
// name (screens.js barName, the page-only <prefix>Name keys), the Status bars tab's Your status bars
// card and each bar's dialog, whose title renames it (a pencil, then a field and OK), the
// screen editor's bar rows (Also on, the Bar picker and Edit, the picker of your bars), and the
// names wherever the page speaks of a bar (the slot pickers, the Alerts tab, the previews).
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
const ui = require('../src/pkjs/config-ui/lib/ui.js');
const { editorBody: body } = require('./helpers/page-rows.js');
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

/**
 * One bar's line on the Your status bars card: its name button and its picture.
 * @param {string} html The tab's markup.
 * @param {string} bar An on-demand.js BARS bar.
 * @returns {string}
 */
function barLine(html, bar) {
  const at = html.indexOf('data-edit-sheet="bar-' + bar + '"');
  assert.ok(at !== -1, bar + ' is listed');
  const start = html.lastIndexOf('<div class="ui-row bl-bar">', at);
  // Its end: the red arrow's column closes the row.
  const go = html.indexOf('<button type="button" class="bl-go" data-edit-sheet="bar-' + bar + '"', at);
  return html.slice(start, html.indexOf('</button></div>', go) + '</button></div>'.length);
}

test('the Your status bars card prints the screens\' names as text, not markup', () => {
  const page = bootGeneratedPage(Object.assign({}, THREE, { viewName0: '<i>Mine</i>' }));
  page.clickTab('watch');
  const line = barLine(page.scroll.innerHTML, 'forecast');
  assert.ok(line.indexOf('<span class="ui-d">&lt;i&gt;Mine&lt;/i&gt;</span>') !== -1, line);
  assert.equal(line.indexOf('<i>Mine</i>'), -1);
});

test('the Your status bars card: every bar by its name, where it shows and its slots; a tap on a name opens its dialog', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  assert.ok(html.indexOf('>Your status bars</span>') !== -1, 'the card');
  assert.ok(html.indexOf('Tap a slot to change it, or tap a bar’s name for the rest of its settings.') !== -1, 'its lead');
  [['forecast', 'Forecast bar', 'Default', 'statusForecast'], ['health', 'Health bar', 'Flick 1', 'statusHealth'],
    ['radar', 'Radar bar', 'Flick 2', 'statusRadar']].forEach(([bar, name, where, prefix]) => {
    const line = barLine(html, bar);
    // Its name line: the name and where it shows (no alerts placed on it: no alerts line).
    assert.ok(line.indexOf('<button type="button" class="bl-name" data-edit-sheet="bar-' + bar + '"><span class="bl-line">'
      + '<span class="ui-n">' + name + '</span><span class="ui-d">' + where + '</span></span></button>') !== -1,
    bar + ': its name, where it shows');
    // The red arrow of a row that opens a screen, in a column of its own: the middle of the row.
    assert.ok(line.endsWith('<button type="button" class="bl-go" data-edit-sheet="bar-' + bar + '" tabindex="-1" aria-hidden="true">'
      + ui.navArrow() + '</button></div>'), bar + ': the red arrow closes the row');
    ['Left', 'Mid', 'Right'].forEach((pos) => {
      assert.ok(line.indexOf('data-select="' + prefix + pos + '"') !== -1, bar + ': its ' + pos + ' slot opens its picker');
    });
    assert.equal(line.indexOf(' dim"'), -1, bar + ': on a screen, not dimmed');
  });
  assert.ok(barLine(html, 'top').indexOf('<span class="ui-n">Watch bar</span>') !== -1, 'the Watch bar first');
  assert.ok(html.indexOf('data-edit-sheet="bar-top"') < html.indexOf('data-edit-sheet="bar-forecast"'));
  // A name opens the bar's dialog: titled by it, its picture and where it shows on top, its slots.
  page.openEditSheet('bar-forecast');
  const dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-bar-forecast">Forecast bar</span>') !== -1, 'titled by the bar\'s name');
  assert.ok(dlg.indexOf('data-dlg-rename aria-label="Rename Forecast bar"') !== -1, 'its pencil');
  assert.ok(dlg.indexOf('class="sbp one big"') !== -1, 'the bar, large');
  assert.ok(dlg.indexOf('<div class="ui-d">On Default</div>') !== -1, 'where it shows');
  assert.ok(dlg.indexOf('<span class="ttl">Slots</span>') !== -1, 'the Slots card');
  ['Left', 'Mid', 'Right'].forEach((pos) => {
    assert.ok(dlg.indexOf('data-select="statusForecast' + pos + '"') !== -1, pos + ' slot in the dialog');
  });
  page.doneDialog();
  // The Watch bar's dialog: no pencil, it keeps its name.
  page.openEditSheet('bar-top');
  assert.ok(page.modal.innerHTML.indexOf('>Watch bar</span>') !== -1);
  assert.equal(page.modal.innerHTML.indexOf('data-dlg-rename'), -1, 'the Watch bar is never renamed');
});

test('a bar no screen shows is still one of your bars: listed, dimmed, and it says so', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });   // a new install: the Default screen alone
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  ['health', 'radar'].forEach((bar) => {
    const line = barLine(html, bar);
    assert.ok(line.indexOf('<span class="ui-d">No screen</span>') !== -1, bar + ': No screen');
    assert.ok(line.indexOf('class="sbp one tap dim"') !== -1, bar + ': its picture dimmed');
  });
  page.openEditSheet('bar-health');
  assert.ok(page.modal.innerHTML.indexOf('<div class="ui-d">On no screen</div>') !== -1);
});

test('aplite lists its two bars without screens, each with its dialog; no New status bar', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'aplite');
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  assert.deepEqual((html.match(/class="bl-name" data-edit-sheet="bar-[a-z0-9]+"/g) || []), ['class="bl-name" data-edit-sheet="bar-top"',
    'class="bl-name" data-edit-sheet="bar-forecast"'], 'the Watch and Forecast bars');
  assert.equal(html.indexOf('class="ui-d'), -1, 'one screen: no screens named; no alerts on aplite');
  assert.equal((html.match(/<span class="chev nav" aria-hidden="true">&#8250;<\/span><\/button><\/div>/g) || []).length, 2,
    'each bar\'s row ends on the red arrow');
  assert.equal(html.indexOf('data-action="newBar"'), -1);
  page.openEditSheet('bar-top');
  const dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('<span class="ttl">Icons and vibration</span>') !== -1, 'the Watch bar keeps its own rows');
  ['batteryLowOnly', 'showQt', 'vibe'].forEach((k) => assert.ok(dlg.indexOf('data-k="' + k + '"') !== -1, k));
  assert.equal(dlg.indexOf('<div class="ui-d">On'), -1, 'one screen: where it shows goes unsaid');
});

test('a name typed in a bar\'s dialog title: OK stores it, and the title, the list and the slot pickers say it, escaped', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  page.openEditSheet('bar-forecast');
  page.renameDialog();
  let dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('data-dlg-rename-in maxlength="24" autocomplete="off" aria-label="Status bar name" '
    + 'placeholder="Forecast bar" value="Forecast bar">') !== -1, 'the field holds the name');
  assert.ok(dlg.indexOf('data-dlg-rename-ok>OK</button>') !== -1, 'OK');
  page.typeName('[data-dlg-rename-in]', 'Morning <b>');
  page.okRename();
  assert.equal(page.S.statusForecastName, 'Morning <b>');
  dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('id="esheet-ttl-bar-forecast">Morning &lt;b&gt;</span>') !== -1, 'the title, escaped');
  assert.equal(dlg.indexOf('data-dlg-rename-in'), -1, 'the field gone');
  assert.equal(dlg.indexOf('Morning <b>'), -1, 'never raw');
  page.doneDialog();
  const html = page.scroll.innerHTML;
  assert.ok(barLine(html, 'forecast').indexOf('<span class="ui-n">Morning &lt;b&gt;</span>') !== -1, 'the list');
  page.openSelect('statusForecastLeft');
  assert.equal(sheetTitle(page, 'statusForecastLeft'), 'Morning &lt;b&gt; · Left slot', 'the slot picker names it');
  // Unnamed, a picker reads its bar's own name.
  page.pickOption('statusForecastLeft', 'temp');
  page.openSelect('statusRadarMid');
  assert.equal(sheetTitle(page, 'statusRadarMid'), 'Radar bar · Middle slot');
});

test('a bar\'s name: trimmed and cut, its own name stores none, another bar\'s takes a number; Enter, Escape and leaving the field', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  page.openEditSheet('bar-radar');
  page.renameDialog();
  page.enterRename('   A very long name for a bar, too long  ');
  assert.equal(page.S.statusRadarName, 'A very long name for a b', 'Enter stores it, as names are kept');
  assert.equal(page.modal.innerHTML.indexOf('data-dlg-rename-in'), -1, 'and ends the rename');
  page.renameDialog();
  page.enterRename('Radar bar');
  assert.equal(page.S.statusRadarName, '', 'its own name: none stored');
  page.renameDialog();
  page.enterRename('Health bar');
  assert.equal(page.S.statusRadarName, 'Health bar 2', 'another bar\'s name takes a number');
  page.renameDialog();
  page.enterRename('Watch bar');
  assert.equal(page.S.statusRadarName, 'Watch bar 2', 'the Watch bar\'s too');
  // Escape keeps the name and the dialog.
  page.renameDialog();
  page.escapeDialog();
  assert.equal(page.S.statusRadarName, 'Watch bar 2');
  assert.ok(page.modal.innerHTML.indexOf('data-dlg-rename aria-label="Rename Watch bar 2"') !== -1, 'the title is back');
  // Leaving the field stores it, without a repaint (the tap that took the focus lands).
  page.renameDialog();
  const writes = page.modal.writes;
  page.leaveRename('Wind');
  assert.equal(page.S.statusRadarName, 'Wind');
  assert.equal(page.modal.writes, writes, 'no repaint');
  // × puts back every name the dialog stored.
  page.cancelDialog();
  assert.equal(page.S.statusRadarName, '', 'back to its own name');
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
  // Added, the row is open: what it shows goes under its Bar picker (a folded row says it
  // beside its name, as a folded card's header says its pick).
  assert.ok(editorRows(body(page)).indexOf('Morning') !== -1, editorRows(body(page)).join(' | '));
  assert.ok(body(page).indexOf('aria-label="Edit Morning"><span>Edit</span></button></div><div class="ui-d">Also on Default</div>')
    !== -1, 'open: the other screens under the picker');
  page.tapEditor({ se: 'close' });
  page.tapAction('openScreen', 0);
  assert.ok(editorRows(body(page)).indexOf('Morning · Also on Flick 1') !== -1);
  // "Add" offers each bar by its name, a calm chip with a plus.
  page.tapEditor({ se: 'rm', j: 3 });
  assert.match(body(page), /<button type="button" class="ui-chip" data-se="add" data-k="fcbar"><svg class="ui-ic"[^>]*>[\s\S]*?<\/svg>Morning<\/button>/);
});

test('the editor: an open bar row shows its Bar picker and Edit; a pick shows another bar; Edit opens the bar\'s dialog over the editor', () => {
  const page = bootGeneratedPage(Object.assign({ statusRadarName: 'Wind' }, THREE));
  page.tapAction('openScreen', 1);
  const j = M.idxOf(M.screensOf(page.S, BASALT)[1], 'healthbar');
  page.tapEditor({ se: 'expand', j });
  let html = body(page);
  assert.ok(html.indexOf('<div class="se-opt"><span class="se-cap">Status bar</span><button type="button" class="sel-wrap" data-se="bar" '
    + 'data-j="' + j + '" aria-haspopup="dialog" aria-label="Status bar: Health bar"><span>Health bar</span><i class="sel-chev"></i></button>'
    + '<button type="button" class="thr-btn" data-se="editbar" data-j="' + j + '" aria-label="Edit Health bar"><span>Edit</span>'
    + '</button></div>') !== -1, 'the picker names the bar; Edit beside it');
  // The picker: your bars by name, what each holds and where it shows.
  page.tapEditor({ se: 'bar', j });
  const sheet = page.modal.innerHTML;
  assert.equal(sheetTitle(page, 'screenBar'), 'Bar on this screen');
  assert.match(sheet, /Pick the bar this screen shows\. Its Edit button changes what the bar shows\./);
  assert.match(sheet, />Forecast bar<[\s\S]*Temperature[\s\S]*on Default/);
  assert.match(sheet, />Health bar<[\s\S]*Steps · Sleep · on Flick 1/);
  assert.match(sheet, />Wind<[\s\S]*UV index[\s\S]*on Flick 2/);
  assert.equal(sheet.indexOf('New status bar'), -1, 'no New status bar on a watch without bars 4 to 6');
  // A pick shows that bar in the row instead.
  page.pickOption('screenBar', 'radarbar');
  assert.deepEqual(M.screensOf(page.S, BASALT)[1].map((b) => b.k), ['strip', 'clock', 'radarbar', 'health']);
  html = body(page);
  assert.ok(editorRows(html).indexOf('Wind') !== -1, editorRows(html).join(' | '));
  assert.ok(html.indexOf('<div class="ui-d">Also on Flick 2</div>') !== -1, 'the row stays open, the other screens under it');
  page.tapEditor({ se: 'expand', j });
  assert.ok(editorRows(body(page)).indexOf('Wind · Also on Flick 2') !== -1, 'folded: beside its name');
  // Edit: the bar's dialog over the editor, which stays open under it.
  page.tapEditor({ se: 'editbar', j });
  assert.ok(page.editor(), 'the editor stays');
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-bar-radar">Wind</span>') !== -1, 'the bar\'s dialog');
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">Flick 1</span>') !== -1, 'opened from the screen');
  page.doneDialog();
  assert.ok(page.editor(), 'Done: back in the editor');
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

// test/page/status-bars/config-named-bars.test.js — 3.0.0's named status bars on the settings page: a bar's
// name (screens.js barName, the page-only <prefix>Name keys), the Status bars tab's Your status bars
// card and each bar's dialog, whose title renames it (a pencil, then a field and OK), the
// screen editor's bar rows and Add chips (the bar's name), and the names wherever the page
// speaks of a bar (the slot pickers, the Alerts tab, the previews).
const test = require('node:test');
const assert = require('node:assert/strict');

// clay-payload's holiday mask reads localStorage: a store before any module loads.
const STORE = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); },
  removeItem: (k) => { delete STORE[k]; }
};

const { bootGeneratedPage } = require('../../helpers/page-harness.js');
const ui = require('../../../src/pkjs/config-ui/lib/ui.js');
const { editorBody: body, editorRows, editorAddChips } = require('../../helpers/page-rows.js');
const M = require('../../../src/pkjs/layout/domain/screens.js');
const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { buildClayPayload } = require('../../../src/pkjs/settings/domain/clay-payload.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
// An upgraded install's three screens: Default (Forecast bar), Flick 1 (Health bar), Flick 2
// (Radar bar).
const THREE = { provider: 'dwd', radarMode: 'graph', healthMode: 'all' };

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
 * The title of the list a select opens from the bottom of a dialog (engine renderPickSheet).
 * @param {Object} page A bootGeneratedPage handle.
 * @param {string} key The select's key.
 * @returns {string} '' when none is open.
 */
function pickTitle(page, key) {
  const m = new RegExp('id="psheet-ttl-' + key + '"[^>]*>([^<]*)<').exec(page.modal.innerHTML);
  return m ? m[1] : '';
}

/**
 * One bar's line on the Your status bars card: its one button, its name and its picture.
 * @param {string} html The tab's markup.
 * @param {string} bar An on-demand.js BARS bar.
 * @returns {string}
 */
function barLine(html, bar) {
  const at = html.indexOf('data-edit-sheet="bar-' + bar + '"');
  assert.ok(at !== -1, bar + ' is listed');
  const start = html.lastIndexOf('<div class="ui-row bl-bar">', at);
  // Its end: the red arrow's column closes the row's one button.
  const go = html.indexOf('<span class="bl-go" aria-hidden="true">', at);
  return html.slice(start, html.indexOf('</button></div>', go) + '</button></div>'.length);
}

test('the Your status bars card prints the screens\' names as text, not markup', () => {
  const page = bootGeneratedPage(Object.assign({}, THREE, { viewName0: '<i>Mine</i>' }));
  page.clickTab('watch');
  const line = barLine(page.scroll.innerHTML, 'forecast');
  assert.ok(line.indexOf('<span class="ui-d">&lt;i&gt;Mine&lt;/i&gt;</span>') !== -1, line);
  assert.equal(line.indexOf('<i>Mine</i>'), -1);
});

test('the Your status bars card: every bar by its name, where it shows and its slots; a tap anywhere on a bar opens its dialog', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  assert.ok(html.indexOf('>Your status bars</span>') !== -1, 'the card');
  assert.ok(html.indexOf('Tap a bar to change its slots and the rest of its settings.') !== -1, 'its lead');
  [['forecast', 'Forecast bar', 'Default'], ['health', 'Health bar', 'Flick 1'],
    ['radar', 'Radar bar', 'Flick 2']].forEach(([bar, name, where]) => {
    const line = barLine(html, bar);
    // The whole row is one button that opens the bar's dialog (the owner's, 2026-11-14): its name
    // line (the name and where it shows; no alerts placed on it, no alerts line) over its picture.
    assert.ok(line.startsWith('<div class="ui-row bl-bar"><button type="button" class="bl-open" data-edit-sheet="bar-'
      + bar + '"><span class="bl-main"><span class="bl-name"><span class="bl-line"><span class="ui-n">' + name
      + '</span><span class="ui-d">' + where + '</span></span></span><span class="sbp one"'), bar + ': one button, name first');
    assert.equal((line.match(/<button/g) || []).length, 1, bar + ': nothing else to tap in the row');
    assert.equal(line.indexOf('data-select='), -1, bar + ': no slot opens a picker of its own');
    // The red arrow of a row that opens a screen, in a column of its own: the middle of the row.
    assert.ok(line.endsWith('<span class="bl-go" aria-hidden="true">' + ui.navArrow() + '</span></button></div>'),
      bar + ': the red arrow closes the row');
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
    assert.ok(line.indexOf('class="sbp one dim"') !== -1, bar + ': its picture dimmed');
  });
  page.openEditSheet('bar-health');
  assert.ok(page.modal.innerHTML.indexOf('<div class="ui-d">On no screen</div>') !== -1);
});

test('aplite lists its two bars without screens, each with its dialog; no New status bar', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'aplite');
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  assert.deepEqual((html.match(/class="bl-open" data-edit-sheet="bar-[a-z0-9]+"/g) || []), ['class="bl-open" data-edit-sheet="bar-top"',
    'class="bl-open" data-edit-sheet="bar-forecast"'], 'the Watch and Forecast bars');
  assert.equal(html.indexOf('class="ui-d'), -1, 'one screen: no screens named; no alerts on aplite');
  assert.equal((html.match(/<span class="chev nav" aria-hidden="true">&#8250;<\/span><\/span><\/button><\/div>/g) || []).length, 2,
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
  // In the bar's dialog a slot's list rises from the bottom, its title naming the bar.
  page.openEditSheet('bar-forecast');
  page.openModalSelect('statusForecastLeft');
  assert.equal(pickTitle(page, 'statusForecastLeft'), 'Morning &lt;b&gt; · Left slot', 'the slot picker names it');
  page.pickOption('statusForecastLeft', 'temp');
  assert.equal(page.S.statusForecastLeft, 'temp');
  assert.equal(page.modal.innerHTML.indexOf('psheet'), -1, 'a pick closes the list');
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-bar-forecast"') !== -1, 'and keeps the bar\'s dialog');
  page.doneDialog();
  // Unnamed, a picker reads its bar's own name.
  page.openEditSheet('bar-radar');
  page.openModalSelect('statusRadarMid');
  assert.equal(pickTitle(page, 'statusRadarMid'), 'Radar bar · Middle slot');
});

test('a bar\'s dialog: each slot\'s list rises from the bottom over the dialog, never in place under its row', () => {
  const page = bootGeneratedPage(THREE);
  page.clickTab('watch');
  page.openEditSheet('bar-forecast');
  ['Left', 'Mid', 'Right'].forEach((pos) => {
    const key = 'statusForecast' + pos;
    page.openModalSelect(key);
    const dlg = page.modal.innerHTML;
    const sheetAt = dlg.indexOf('<div class="psheet" role="group" aria-labelledby="psheet-ttl-' + key + '">');
    assert.ok(sheetAt !== -1, pos + ': the sheet');
    assert.ok(dlg.indexOf('<div id="ssel-list-' + key + '" class="isel-list"') > sheetAt, pos + ': its list in it');
    assert.equal(dlg.indexOf('isel-open'), -1, pos + ': no row opens in place');
    page.escapeDialog();
    assert.equal(page.modal.innerHTML.indexOf('psheet'), -1, pos + ': Escape closes the list');
    assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-bar-forecast"') !== -1, pos + ': and keeps the dialog');
  });
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

test('the editor: a bar\'s row and its Add chip read by its name; the row has its Edit beside it', () => {
  const S = Object.assign({ statusForecastName: 'Morning' }, THREE);
  const page = bootGeneratedPage(S);
  page.tapAction('openScreen', 0);
  assert.deepEqual(editorRows(body(page)), ['Watch bar', 'Calendar · 2 rows', 'Clock', 'Morning', 'Forecast graph · Fill']);
  assert.ok(body(page).indexOf('<div class="se-mid"><span class="se-name">Morning</span><span class="se-ctl">'
    + ui.editButton('Edit', { 'data-se': 'editbar', 'data-j': 3, 'aria-haspopup': 'dialog', 'aria-label': 'Edit Morning' })
    + '</span></div>') !== -1, 'its Edit, named by the bar (the owner\'s pick, 2026-11-10)');
  assert.ok(body(page).indexOf('aria-label="Remove Morning"') !== -1);
  page.tapEditor({ se: 'close' });
  // The same bar on Flick 1 too, by its chip: where else it shows is the Status bars tab's to
  // say, not the row's.
  page.tapAction('openScreen', 1);
  assert.deepEqual(editorAddChips(body(page)), ['Morning', 'Radar bar', 'Forecast graph', 'Rain radar', 'Calendar']);
  page.tapEditor({ se: 'add', k: 'fcbar' });
  assert.ok(editorRows(body(page)).indexOf('Morning') !== -1, editorRows(body(page)).join(' | '));
  assert.equal(body(page).indexOf('Also on'), -1);
  page.tapEditor({ se: 'close' });
  page.tapAction('openScreen', 0);
  assert.equal(body(page).indexOf('Also on'), -1);
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

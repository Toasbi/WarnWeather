// src/pkjs/config-ui/test/hint-resolver.test.js — the hint-resolver hook
// (item.hintFrom + PConf.hintResolvers).
//
// The hook exists for a hint that depends on OTHER keys than the row's own value
// (hintByValue already covers that one): a line-style picker explaining the scale of
// the metric its line draws. What these tests hold down:
//   - an item WITHOUT hintFrom renders bit-for-bit as before (hint / hintByValue);
//   - a hooked row shows the resolver's answer, and it follows a change to a key the
//     resolver reads on the next render — the page re-renders its whole body after
//     every change, so no dependency list is needed;
//   - the resolver sees the row's messageKey and its SHOWN value (after the
//     display-snap) under its own args;
//   - null/undefined falls back to the static hint, '' means "no hint", and an
//     unregistered resolver id falls back too;
//   - the hook reaches a row inside an edit sheet;
//   - a derived hint carries its row's key (data-hint-for), and an arrow-key nudge on a
//     range thumb — a commit that skips render() to keep the thumb focused —
//     re-resolves it in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'select', messageKey: 'metric', label: 'Metric', defaultValue: 'rain',
      options: [['Rain', 'rain'], ['Wind', 'wind']] },
    { type: 'select', messageKey: 'style', label: 'Style', defaultValue: 'line',
      hint: 'STATIC', hintByValue: { dots: 'STATIC DOTS' },
      hintFrom: { resolver: 'styleScale', args: { metricKey: 'metric' } },
      options: [['Line', 'line'], ['Dots', 'dots']] },
    { type: 'select', messageKey: 'plain', label: 'Plain', defaultValue: 'a',
      hint: 'PLAIN', hintByValue: { b: 'PLAIN B' }, options: [['A', 'a'], ['B', 'b']] }
  ] },
  { sheetOnly: true, sheetId: 'sheetStyle', title: 'Style', items: [
    { type: 'select', messageKey: 'sheetStyle', label: 'Style', defaultValue: 'line',
      hintFrom: { resolver: 'styleScale', args: { metricKey: 'metric' } },
      options: [['Line', 'line'], ['Dots', 'dots']] }
  ] }
] }] };

/** Build a render context around a settings object, mirroring boot()'s cx.
 * @param {Object} S Settings state.
 * @param {Object} [extra] Overrides (openEdit, ...).
 * @returns {Object} Render context.
 */
function cxFor(S, extra) {
  return Object.assign({
    S: S, ENV: { color: true, lineStyles: true }, USERDATA: {}, openColor: null, openSelect: null,
    openDate: null, openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: { color: true, lineStyles: true } })
  }, extra || {});
}

/**
 * @param {string} text Hint text.
 * @param {string} [key] The row's messageKey — set for a hintFrom row, whose hint
 *   element carries it (data-hint-for) for the in-place repaint.
 * @returns {string} The hint markup the row prints.
 */
function hintHtml(text, key) {
  return '<div class="hint"' + (key ? ' data-hint-for="' + key + '"' : '') + '>' + text + '</div>';
}

/** Register the demo resolver: the metric's scale, per the row's shown style. */
function registerStyleScale() {
  E.hintResolvers.register('styleScale', function (S, env, args) {
    return (S[args.metricKey] === 'wind' ? 'By wind scale' : 'By rain chance')
      + (args.value === 'dots' ? ', dotted' : '');
  });
}

test('hintResolvers registry: register/get; unknown id -> undefined', () => {
  E.hintResolvers.register('demoHint', function () { return 'x'; });
  assert.equal(typeof E.hintResolvers.get('demoHint'), 'function');
  assert.equal(E.hintResolvers.get('nope'), undefined);
});

test('renderRow: a view without a resolved hint renders the static hint as before', () => {
  const item = SCHEMA.tabs[0].sections[0].items[2];
  const before = E.renderRow(item, { value: 'a' });
  assert.ok(before.indexOf(hintHtml('PLAIN')) >= 0, 'plain hint');
  assert.ok(E.renderRow(item, { value: 'b' }).indexOf(hintHtml('PLAIN B')) >= 0, 'hintByValue still wins');
  assert.equal(E.renderRow(item, { value: 'a', hint: undefined }), before, 'an absent view.hint changes nothing');
});

test('renderBody: the hooked row shows the resolver answer and follows the key it reads', () => {
  registerStyleScale();
  const S = E.hydrate(SCHEMA, {});
  let body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By rain chance', 'style')) >= 0, 'derived hint shown');
  assert.equal(body.indexOf('STATIC'), -1, 'it replaces the static hint');
  assert.ok(body.indexOf(hintHtml('PLAIN')) >= 0, 'an unhooked row in the same section is unaffected');
  // The page re-renders after every change: a new metric re-words the style row's hint.
  S.metric = 'wind';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By wind scale', 'style')) >= 0, 'follows the other key');
  S.style = 'dots';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('By wind scale, dotted', 'style')) >= 0, 'and its own value');
});

test('resolveHint: args carry the messageKey and shown value UNDER hintFrom.args', () => {
  let seen = null;
  E.hintResolvers.register('spy', function (S, env, args) { seen = { env: env, args: args }; return 'ok'; });
  const item = { type: 'select', messageKey: 'k', hintFrom: { resolver: 'spy', args: { metricKey: 'm', value: 'pinned' } } };
  assert.equal(E.resolveHint(item, { k: 'stored' }, { lineStyles: true }, 'shown'), 'ok');
  assert.equal(seen.args.messageKey, 'k');
  assert.equal(seen.args.metricKey, 'm');
  assert.equal(seen.args.value, 'pinned', 'schema args merge over the defaults');
  assert.equal(seen.env.lineStyles, true, 'env reaches the resolver');
  E.resolveHint({ messageKey: 'k', hintFrom: { resolver: 'spy' } }, { k: 'stored' }, {}, 'shown');
  assert.equal(seen.args.value, 'shown', 'the SHOWN value, not the stored one');
  assert.equal(E.resolveHint({ messageKey: 'k' }, {}, {}, 'x'), undefined, 'no hintFrom -> undefined');
});

test('resolveHint: the shown value is the display-snapped one', () => {
  let got;
  E.hintResolvers.register('snapSpy', function (S, env, args) { got = args.value; return 'h'; });
  const SCH = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [{ items: [
    { type: 'select', messageKey: 'pick', label: 'Pick', defaultValue: 'b',
      optionsFrom: { resolver: 'twoOnly' }, hintFrom: { resolver: 'snapSpy' } }
  ] }] }] };
  E.hydrate(SCH, {});
  global.PConf.optionsResolvers.register('twoOnly', function () { return [['A', 'a'], ['B', 'b']]; });
  const S = { pick: 'gone' };
  E.renderBody(SCH, 't', cxFor(S));
  assert.equal(got, 'b', 'a stored value the options no longer carry is described as what the row shows');
});

test('renderBody: null falls back to the static hint, "" means no hint, a missing resolver falls back', () => {
  const S = E.hydrate(SCHEMA, {});
  E.hintResolvers.register('styleScale', function () { return null; });
  let body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC', 'style')) >= 0, 'null -> static hint');
  S.style = 'dots';
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC DOTS', 'style')) >= 0, 'null -> static hintByValue for the shown value');
  E.hintResolvers.register('styleScale', function () { return ''; });
  body = E.renderBody(SCHEMA, 't', cxFor(S));
  assert.equal(body.indexOf('STATIC'), -1, '"" -> no hint at all, not the static one');
  const SCH = JSON.parse(JSON.stringify(SCHEMA));
  SCH.tabs[0].sections[0].items[1].hintFrom = { resolver: 'missing' };
  body = E.renderBody(SCH, 't', cxFor(S));
  assert.ok(body.indexOf(hintHtml('STATIC DOTS', 'style')) >= 0, 'unregistered resolver -> static hint, no crash');
});

test('renderEditModal: the hook reaches a row inside an edit sheet', () => {
  registerStyleScale();
  const S = E.hydrate(SCHEMA, {});
  S.metric = 'wind';
  const sheet = E.renderEditModal(SCHEMA, cxFor(S, { openEdit: 'sheetStyle' }));
  assert.ok(sheet.indexOf(hintHtml('By wind scale', 'sheetStyle')) >= 0, 'sheet row shows the derived hint');
});

// --- the in-place repaint after a keyboard nudge ------------------------------------
// The range keydown path commits WITHOUT render() (a render rebuilds the host and drops
// focus from the thumb being arrowed), so a hint that reads the slider's value is
// re-resolved in place instead. Proven through a real boot: the wiring is boot-local.

const NUDGE_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'segmented', messageKey: 'mode', label: 'Mode', defaultValue: 'a',
      hint: 'STATIC', hintFrom: { resolver: 'bandHint' }, options: [['A', 'a'], ['B', 'b']] },
    { type: 'segmented', messageKey: 'other', label: 'Other', defaultValue: 'x',
      hint: 'PLAIN', options: [['X', 'x'], ['Y', 'y']] },
    { type: 'range', messageKey: 'band', label: 'Band', defaultValue: '40-180',
      min: 30, max: 220, step: 5, minSpan: 50, unit: 'BPM' }
  ] }
] }] };

const HINT_RE = /(<div class="hint" data-hint-for=")([^"]*)(">)([\s\S]*?)(<\/div>)/g;

/**
 * Boot the engine bundle against a DOM shim whose #scroll counts full innerHTML writes
 * (renders) apart from in-place hint repaints, which it splices into the markup.
 * @param {Object} [schema] The schema to boot (NUDGE_SCHEMA by default).
 * @param {Object} [env] The platform env (a colour watch by default).
 * @returns {{scroll: Object, dispatch: function(string, Object): void}} Harness knobs.
 */
function bootNudgePage(schema, env) {
  const LIB = path.join(__dirname, '..', 'lib');
  const BUNDLE = ['schema-walk.js', 'color.js', 'show-when.js', 'html.js', 'date-picker.js',
    'range-control.js', 'engine.js']
    .map((f) => fs.readFileSync(path.join(LIB, f), 'utf8')).join('\n')
    + '\nPConf.engine.boot();';
  const listeners = {};
  let raw = '';
  /** @param {string} key data-hint-for. @returns {Object} A hint element stub. */
  function hintStub(key) {
    const find = () => {
      HINT_RE.lastIndex = 0;
      let m;
      while ((m = HINT_RE.exec(raw))) { if (m[2] === key) { return m; } }
      return null;
    };
    const stub = { getAttribute: (n) => (n === 'data-hint-for' ? key : null) };
    Object.defineProperty(stub, 'innerHTML', {
      get() { const m = find(); return m ? m[4] : ''; },
      set(v) {
        const m = find();
        raw = raw.slice(0, m.index) + m[1] + m[2] + m[3] + v + m[5] + raw.slice(m.index + m[0].length);
        scroll.repaints += 1;
      }
    });
    return stub;
  }
  const scroll = { className: '', scrollTop: 0, writes: 0, repaints: 0,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    querySelectorAll(sel) {
      if (sel !== '.hint[data-hint-for]') { return []; }
      const keys = [];
      HINT_RE.lastIndex = 0;
      let m;
      while ((m = HINT_RE.exec(raw))) { keys.push(m[2]); }
      return keys.map(hintStub);
    } };
  Object.defineProperty(scroll, 'innerHTML', {
    get() { return raw; },
    set(v) { raw = v; scroll.writes += 1; }
  });
  const modal = { innerHTML: '', style: {}, open: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [] };
  const generic = () => ({ innerHTML: '', textContent: '', addEventListener() {} });
  const ids = { scroll, modal, tabs: generic(), save: generic(), appTitle: generic(), toast: generic() };
  const document = { getElementById: (id) => ids[id] || generic(), addEventListener() {},
    querySelector: () => null };
  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'requestAnimationFrame', 'setTimeout', 'clearTimeout',
    BUNDLE);
  fn(document, schema || NUDGE_SCHEMA, env || { color: true }, {}, {}, 'pebblejs://close#', () => 0, () => 0,
    () => {});
  return {
    scroll,
    dispatch(type, ev) { (listeners[type] || []).forEach((l) => l(ev)); }
  };
}

/**
 * A focused thumb inside a plain range root, as the keydown handler reads them.
 * @param {string} key data-range messageKey.
 * @param {number} lo data-lo.
 * @param {number} hi data-hi.
 * @param {string} which 'lo' | 'hi'.
 * @returns {Object} The thumb stub.
 */
function rangeThumb(key, lo, hi, which) {
  const attrs = { 'data-range': key, 'data-lo': String(lo), 'data-hi': String(hi) };
  const node = () => ({ style: {}, setAttribute() {}, innerHTML: '' });
  const nodes = { '.rng-val': node(), '.rng-fill': node(),
    '[data-range-thumb=lo]': node(), '[data-range-thumb=hi]': node() };
  const root = { getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute(n, v) { attrs[n] = String(v); }, querySelector: (sel) => nodes[sel] || null };
  const th = { getAttribute: (n) => (n === 'data-range-thumb' ? which : null),
    closest: (sel) => (sel === '[data-range-thumb]' ? th : (sel === '.rng' ? root : null)) };
  return th;
}

test('boot: an arrow-key nudge re-resolves the derived hints in place, without a render', () => {
  const h = bootNudgePage();
  // The bundle installs its own registries over global.PConf: register after boot, then
  // render once (a pill tap on the other row) so the hooked row sees the resolver.
  global.PConf.hintResolvers.register('bandHint', function (S, env, args) {
    return 'Band starts at ' + String(S.band).split('-')[0] + (args.value === 'b' ? ' (B)' : '');
  });
  const pill = { getAttribute: (n) => ({ 'data-k': 'other', 'data-v': 'y' })[n] || null };
  h.dispatch('click', { target: { closest: (sel) => (sel === '[data-v]' ? pill : null) } });
  assert.ok(h.scroll.innerHTML.indexOf(hintHtml('Band starts at 40', 'mode')) >= 0,
    'the derived hint is marked with its row key');
  assert.ok(h.scroll.innerHTML.indexOf(hintHtml('PLAIN')) >= 0, 'a static hint stays unmarked');
  const writes = h.scroll.writes;
  let prevented = false;
  h.dispatch('keydown', { target: rangeThumb('band', 40, 180, 'lo'), key: 'ArrowRight',
    preventDefault() { prevented = true; } });
  assert.ok(prevented, 'the nudge was handled');
  assert.ok(h.scroll.innerHTML.indexOf(hintHtml('Band starts at 45', 'mode')) >= 0,
    'the hint follows the nudged value');
  assert.equal(h.scroll.writes, writes, 'no full render — the focused thumb survives');
  assert.equal(h.scroll.repaints, 1, 'one hint element rewritten in place');
  // An unchanged answer writes nothing: a nudge on a value no hint reads is free.
  global.PConf.hintResolvers.register('bandHint', function () { return 'Fixed'; });
  h.dispatch('keydown', { target: rangeThumb('band', 45, 180, 'hi'), key: 'ArrowLeft',
    preventDefault() {} });
  h.dispatch('keydown', { target: rangeThumb('band', 45, 175, 'hi'), key: 'ArrowLeft',
    preventDefault() {} });
  assert.equal(h.scroll.repaints, 2, 'rewritten once to the new answer, then left alone');
  // A null answer falls back to the static hint, as a render would.
  global.PConf.hintResolvers.register('bandHint', function () { return null; });
  h.dispatch('keydown', { target: rangeThumb('band', 45, 170, 'hi'), key: 'ArrowLeft',
    preventDefault() {} });
  assert.ok(h.scroll.innerHTML.indexOf(hintHtml('STATIC', 'mode')) >= 0, 'null -> the static hint');
  assert.equal(h.scroll.writes, writes, 'still no render');
});

// Two one-thumb sliders may share a key under mutually exclusive gates (the Battery warn
// level: 5 % steps on emery, 10 % elsewhere). A nudge must move by the step of the row
// on screen — findItem's last match alone would hand every watch the other row's step.
const SHARED_SCHEMA = { appName: 'X', versionLabel: 'v0', tabs: [{ id: 't', label: 'T', sections: [
  { title: 'Body', items: [
    { type: 'range', single: true, messageKey: 'lvl', label: 'Warn level', min: 10, max: 30, step: 10,
      unit: '%', defaultValue: '10', showWhen: { not: { env: 'fine' } } },
    { type: 'range', single: true, messageKey: 'lvl', label: 'Warn level', min: 5, max: 30, step: 5,
      unit: '%', defaultValue: '10', showWhen: { env: 'fine' } }
  ] }
] }] };

/**
 * A focused thumb inside a one-thumb range root, as the keydown handler reads them.
 * @param {string} key data-range messageKey.
 * @param {number} v data-v.
 * @returns {{thumb: Object, attrs: Object}} The thumb stub and its root's attributes.
 */
function singleThumb(key, v) {
  const attrs = { 'data-range': key, 'data-v': String(v) };
  const node = () => ({ style: {}, setAttribute() {}, textContent: '' });
  const nodes = { '.rng-val': node(), '.rng-fill': node(), '[data-range-thumb=v]': node() };
  const root = { getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute(n, val) { attrs[n] = String(val); }, querySelector: (sel) => nodes[sel] || null };
  const th = { getAttribute: (n) => (n === 'data-range-thumb' ? 'v' : null),
    closest: (sel) => (sel === '[data-range-thumb]' ? th : (sel === '.rng' ? root : null)) };
  return { thumb: th, attrs };
}

test('boot: a nudge on a key two gated sliders share moves by the visible slider\'s step', () => {
  [[{ color: true }, '20', 'a 10 % watch'], [{ color: true, fine: true }, '15', 'a 5 % watch']]
    .forEach(([env, want, who]) => {
      const h = bootNudgePage(SHARED_SCHEMA, env);
      const t = singleThumb('lvl', 10);
      h.dispatch('keydown', { target: t.thumb, key: 'ArrowRight', preventDefault() {} });
      assert.equal(t.attrs['data-v'], want, who);
    });
});

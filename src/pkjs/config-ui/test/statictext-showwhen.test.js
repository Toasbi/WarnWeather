// src/pkjs/config-ui/test/statictext-showwhen.test.js
// render() must honor showWhen on staticText so a static note can be platform-gated.
// The lib files share one PConf only when concatenated (as build-page does), so we eval
// show-when + engine together in a single scope with a minimal DOM shim and drive boot().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'lib');
const BUNDLE = fs.readFileSync(path.join(LIB, 'schema-walk.js'), 'utf8')
  + '\n' + fs.readFileSync(path.join(LIB, 'color.js'), 'utf8')
  + '\n' + fs.readFileSync(path.join(LIB, 'show-when.js'), 'utf8')
  + '\n' + fs.readFileSync(path.join(LIB, 'engine.js'), 'utf8')
  + '\nPConf.engine.boot();';

function renderScroll(schema, env) {
  const scroll = { innerHTML: '', addEventListener: function () {} };
  const generic = function () { return { innerHTML: '', textContent: '', addEventListener: function () {} }; };
  const ids = { scroll: scroll, tabs: generic(), save: generic(), appTitle: generic(), toast: generic() };
  const document = { getElementById: function (id) { return ids[id] || generic(); } };
  // INJECTED_* are free identifiers inside boot(); pass them as bundle params.
  const fn = new Function('document', 'INJECTED_SCHEMA', 'INJECTED_ENV', 'INJECTED_CFG',
    'INJECTED_USERDATA', 'INJECTED_RETURN', 'module', BUNDLE);
  fn(document, schema, env, {}, {}, 'pebblejs://close#', { exports: {} });
  return scroll.innerHTML;
}

const SCHEMA = {
  appName: 'X', versionLabel: 'v0',
  tabs: [{ id: 't', label: 'T', sections: [{ title: 'S', items: [
    { type: 'toggle', messageKey: 'flag', defaultValue: false },
    { type: 'staticText', text: 'BWONLY', showWhen: { not: { env: 'color' } } },
    { type: 'staticText', text: 'ALWAYS' }
  ] }] }]
};

test('staticText with showWhen is hidden on color, shown on B/W; ungated staticText always shows', () => {
  const colorHtml = renderScroll(SCHEMA, { color: true, round: false, platform: 'basalt' });
  const bwHtml    = renderScroll(SCHEMA, { color: false, round: false, platform: 'aplite' });
  assert.equal(colorHtml.indexOf('BWONLY'), -1, 'gated note hidden on color watch');
  assert.ok(bwHtml.indexOf('BWONLY') >= 0, 'gated note shown on B/W watch');
  assert.ok(colorHtml.indexOf('ALWAYS') >= 0 && bwHtml.indexOf('ALWAYS') >= 0, 'ungated note always shown');
});

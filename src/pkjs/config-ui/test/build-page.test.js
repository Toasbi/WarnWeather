const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const build = require('../scripts/build-page.js');

test('buildPage concatenates lib + app files, boot last, markers handled', () => {
  const appFile = path.join(os.tmpdir(), 'pconf-fixture-blocks.js');
  fs.writeFileSync(appFile, "PConf.blocks.register('demo', function () { return '<i>x</i>'; });\n");
  const html = build.buildPage({ appFiles: [appFile] });
  assert.equal(html.indexOf('/*__PCONF_CONCAT__*/'), -1, 'concat marker consumed');
  assert.ok(html.indexOf('/*__PCONF_INJECT__*/') !== -1, 'inject marker preserved');
  ['PConf.showWhen', 'PConf.engine', "PConf.blocks.register('demo'", 'PConf.engine.boot();']
    .forEach((s) => assert.ok(html.indexOf(s) !== -1, 'missing ' + s));
  assert.ok(html.indexOf('PConf.engine.boot();') > html.indexOf("PConf.blocks.register('demo'"), 'boot after app registration');
});

// src/pkjs/config-ui/scripts/build-page.js — plain node, no deps.
var fs = require('fs');
var path = require('path');
var LIB = path.join(__dirname, '..', 'lib');
var LIB_PAGE_FILES = ['schema-walk.js', 'color.js', 'show-when.js', 'engine.js'];

function buildPage(opts) {
  opts = opts || {};
  var shell = fs.readFileSync(path.join(LIB, 'shell.html'), 'utf8');
  if (shell.indexOf('/*__PCONF_CONCAT__*/') === -1) { throw new Error('shell.html missing /*__PCONF_CONCAT__*/'); }
  var parts = LIB_PAGE_FILES.map(function (f) { return '/* ' + f + ' */\n' + fs.readFileSync(path.join(LIB, f), 'utf8'); });
  (opts.appFiles || []).forEach(function (f) {
    var abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    parts.push('/* app: ' + path.basename(f) + ' */\n' + fs.readFileSync(abs, 'utf8'));
  });
  parts.push('\nPConf.engine.boot();');
  return shell.replace('/*__PCONF_CONCAT__*/', function () { return parts.join('\n'); });
}

function writeGenerated(opts) {
  var html = buildPage(opts);
  // Write to a per-process temp file then rename into place. rename(2) is atomic,
  // so a concurrent reader — e.g. another parallel `node --test` worker requiring
  // page.generated.js while config-integration-build.test.js regenerates it — always
  // sees a complete file, never a half-written one that fails to parse (SyntaxError).
  // The plain O_TRUNC writeFileSync exposed that truncation window and flaked the build.
  var tmp = opts.out + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, 'module.exports = ' + JSON.stringify(html) + ';\n');
  fs.renameSync(tmp, opts.out);
  return opts.out;
}

// Build the page and fill the INJECTED_* runtime markers, yielding a standalone HTML page that
// renders itself in a browser (no watch / Clay host needed). schema/cfg/env/userData are inlined
// as JSON — the same contract config-ui/index.js fills at runtime. For dev preview, not shipping.
function previewPage(opts) {
  opts = opts || {};
  var page = buildPage({ appFiles: opts.appFiles });
  if (page.indexOf('/*__PCONF_INJECT__*/') === -1) { throw new Error('shell.html missing /*__PCONF_INJECT__*/'); }
  var snippet =
    'INJECTED_SCHEMA='   + JSON.stringify(opts.schema || null)  + ';' +
    'INJECTED_CFG='      + JSON.stringify(opts.cfg || {})       + ';' +
    'INJECTED_ENV='      + JSON.stringify(opts.env || null)     + ';' +
    'INJECTED_USERDATA=' + JSON.stringify(opts.userData || {})  + ';' +
    'INJECTED_RETURN='   + JSON.stringify(opts.returnTo || '#') + ';';
  return page.replace('/*__PCONF_INJECT__*/', function () { return snippet; });
}

if (require.main === module) {
  // CLI: node build-page.js <out> <appFile...>
  var out = process.argv[2], appFiles = process.argv.slice(3);
  console.log('wrote ' + writeGenerated({ out: out, appFiles: appFiles }));
}
module.exports = { buildPage: buildPage, writeGenerated: writeGenerated, previewPage: previewPage };

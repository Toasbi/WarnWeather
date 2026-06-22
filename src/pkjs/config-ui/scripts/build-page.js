// src/pkjs/config-ui/scripts/build-page.js — plain node, no deps.
var fs = require('fs');
var path = require('path');
var LIB = path.join(__dirname, '..', 'lib');
var LIB_PAGE_FILES = ['show-when.js', 'engine.js'];

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
  fs.writeFileSync(opts.out, 'module.exports = ' + JSON.stringify(html) + ';\n');
  return opts.out;
}

if (require.main === module) {
  // CLI: node build-page.js <out> <appFile...>
  var out = process.argv[2], appFiles = process.argv.slice(3);
  console.log('wrote ' + writeGenerated({ out: out, appFiles: appFiles }));
}
module.exports = { buildPage: buildPage, writeGenerated: writeGenerated };

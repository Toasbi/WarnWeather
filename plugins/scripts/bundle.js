'use strict';

// Bundle a plugin's entry module, and every module it requires, into one script: the Pebble app
// loads a plugin from the single file its manifest names. Only relative requires are followed;
// anything else fails the build, which keeps the plugins free of npm dependencies.

const fs = require('fs');
const path = require('path');

/**
 * The file a relative require names.
 *
 * @param {string} from The requiring file.
 * @param {string} request The require's argument.
 * @returns {string} Absolute path.
 */
function resolveRequest(from, request) {
  if (request.indexOf('./') !== 0 && request.indexOf('../') !== 0) {
    throw new Error(from + ": only relative requires can be bundled, not '" + request + "'");
  }
  let file = path.resolve(path.dirname(from), request);
  if (!/\.js$/.test(file)) {
    file += '.js';
  }
  if (!fs.existsSync(file)) {
    throw new Error(from + ": cannot find '" + request + "'");
  }
  return file;
}

/**
 * The requests a module's source makes, in order of appearance.
 *
 * @param {string} source Module source.
 * @returns {string[]} The string arguments of its require() calls.
 */
function requestsIn(source) {
  const pattern = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
  const out = [];
  let match = pattern.exec(source);
  while (match) {
    out.push(match[2]);
    match = pattern.exec(source);
  }
  return out;
}

/**
 * Bundle an entry module.
 *
 * @param {string} entry Path of the entry module.
 * @param {Object} options {root: directory the module comments are relative to, banner: first line}.
 * @returns {{script: string, files: string[]}} The script, and the files it holds (entry first).
 */
function bundle(entry, options) {
  const modules = [];
  const ids = new Map();
  const add = (file) => {
    if (ids.has(file)) {
      return ids.get(file);
    }
    const record = { id: modules.length, file, source: fs.readFileSync(file, 'utf8'), deps: {} };
    ids.set(file, record.id);
    modules.push(record);
    requestsIn(record.source).forEach((request) => {
      record.deps[request] = add(resolveRequest(file, request));
    });
    return record.id;
  };
  add(path.resolve(entry));

  const lines = [];
  if (options.banner) {
    lines.push(options.banner);
  }
  lines.push('(function () {');
  lines.push('var definitions = [');
  modules.forEach((record) => {
    lines.push('// ' + path.relative(options.root, record.file).split(path.sep).join('/'));
    lines.push('[function (module, exports, require) {');
    lines.push(record.source.replace(/\s+$/, ''));
    lines.push('}, ' + JSON.stringify(record.deps) + '],');
  });
  lines.push('];');
  lines.push('var cache = [];');
  lines.push('function load(id) {');
  lines.push('  if (cache[id]) { return cache[id].exports; }');
  lines.push('  var module = cache[id] = { exports: {} };');
  lines.push('  var definition = definitions[id];');
  lines.push('  definition[0].call(module.exports, module, module.exports, function (request) {');
  lines.push('    if (!Object.prototype.hasOwnProperty.call(definition[1], request)) {');
  lines.push("      throw new Error('Cannot find module ' + request);");
  lines.push('    }');
  lines.push('    return load(definition[1][request]);');
  lines.push('  });');
  lines.push('  return module.exports;');
  lines.push('}');
  lines.push('load(0);');
  lines.push('})();');
  return { script: lines.join('\n') + '\n', files: modules.map((record) => record.file) };
}

module.exports = { bundle, requestsIn, resolveRequest };

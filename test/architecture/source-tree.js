// The architecture tests' shared reading of a source tree: its files, their text with comments
// and strings blanked, and the cycles of a dependency graph between them.
const fs = require('node:fs');
const path = require('node:path');

// Comments and string literals, matched in one pass so a "//" inside a string never hides the
// code after it. C, JavaScript and TypeScript share the syntax this needs. A quote inside a
// regex literal reads as the start of a string to the end of its line; the code has none that
// hide a rule's call.
const TOKENS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/**
 * A file's code with every comment replaced by a space and every string literal by an empty
 * one of the same quote.
 * @param {string} file absolute path
 * @returns {string}
 */
function codeOf(file) {
  return fs.readFileSync(file, 'utf8').replace(TOKENS, (t) => {
    const q = t[0];
    return q === '"' || q === "'" || q === '`' ? q + q : ' ';
  });
}

/**
 * A file's text with only its comments blanked: string literals stay, for reading the paths
 * of #include and require().
 * @param {string} file absolute path
 * @returns {string}
 */
function withoutComments(file) {
  return fs.readFileSync(file, 'utf8').replace(TOKENS, (t) => (t[0] === '/' ? ' ' : t));
}

/**
 * A path relative to a root, with forward slashes on every OS.
 * @param {string} root absolute root
 * @param {string} file absolute path under it
 * @returns {string}
 */
function relPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * Every file under a root whose name matches, as sorted forward-slash paths relative to it.
 * @param {string} root absolute root
 * @param {{name: RegExp, skipDirs?: string[], skipFiles?: string[]}} opts which files: a name
 *   pattern, folder names never entered, and relative paths left out
 * @returns {string[]}
 */
function listFiles(root, opts) {
  const skipDirs = opts.skipDirs || [];
  const skipFiles = opts.skipFiles || [];
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.indexOf(e.name) === -1) { walk(p); }
        return;
      }
      const rel = relPath(root, p);
      if (opts.name.test(e.name) && skipFiles.indexOf(rel) === -1) { out.push(rel); }
    });
  })(root);
  return out.sort();
}

/**
 * The cycles of a dependency graph: its strongly connected components of two or more nodes
 * (Tarjan), each sorted, the list sorted.
 * @param {Map<string, string[]>} graph node -> the nodes it depends on
 * @returns {string[][]}
 */
function cyclesOf(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  /**
   * Tarjan's visit: number v, walk its edges, and pop a component when v is its root.
   * @param {string} v
   */
  const connect = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    (graph.get(v) || []).forEach((w) => {
      if (!idx.has(w)) { connect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), idx.get(w))); }
    });
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) { cycles.push(comp.sort()); }
    }
  };
  graph.forEach((_, v) => { if (!idx.has(v)) { connect(v); } });
  return cycles.sort();
}

module.exports = { codeOf, withoutComments, relPath, listFiles, cyclesOf };

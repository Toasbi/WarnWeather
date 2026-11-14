// Source text for the architecture tests: comments and string contents blanked in one pass,
// so prose and literals never read as code, and a "//" inside a string never hides the code
// after it. C, JavaScript and TypeScript share the syntax this needs.
const fs = require('node:fs');

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

module.exports = { codeOf, withoutComments };

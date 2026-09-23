// test/helpers/es5-lint.js — a dependency-free ES5 guard for the shipped PKJS and
// settings-page sources (test/config-es5.test.js). It replaces a list of source
// regexes that only saw `=>`, const/let, backticks, class, for…of and ten named
// built-ins: optional chaining, `??`, spread, destructuring, default parameters,
// shorthand/computed object members, `**`, generators, async functions, 0b/0o
// literals and u/s regex flags all went through it, and each one is a parse-time
// SyntaxError that kills the WHOLE bundle on aplite's pre-ES6 JavaScriptCore (or
// the whole settings page on an old WebView) while every Node test stays green.
//
// It tokenizes (comments, strings, regex literals and templates are real tokens,
// so nothing inside them can false-positive) and then checks the token stream:
//   - ES2015+ punctuators and literal forms, flagged as they are lexed;
//   - ES6-only keywords (const, let, class, import/export, super, async function,
//     function*, new.target) outside property-name position;
//   - object literals member by member (shorthand properties and methods,
//     computed keys and generator methods are ES6; get/set accessors are ES5);
//   - parameter lists (defaults, destructuring) and trailing commas in calls;
//   - call-shaped uses of ES2015+ built-ins that polyfills.js does NOT supply.
// It is not a parser: a construct it cannot see (destructuring ASSIGNMENT,
// `[a, b] = c`) passes, and String#includes stays allowed because a token stream
// cannot tell a string receiver from a polyfilled Array one. The self-test in
// config-es5.test.js pins what it catches and what ES5 it must leave alone.
'use strict';

// Longest first, so '>>>=' wins over '>>' and '...' over '.'.
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|',
  '^', '!', '~', '?', ':', '=', '.', '@', '#',
];

const ES6_PUNCTUATORS = {
  '=>': 'arrow function',
  '...': 'spread/rest',
  '**': 'exponent operator',
  '**=': 'exponent operator',
  '?.': 'optional chaining',
  '??': 'nullish coalescing',
  '??=': 'logical assignment',
  '&&=': 'logical assignment',
  '||=': 'logical assignment',
  '#': 'private class member',
  '@': 'decorator',
};

// A `/` after these names starts a regex literal, not a division.
const REGEX_AFTER_NAME = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

// A `{` after these names opens an object literal (an expression follows them);
// after any other name (else, do, try, finally, …) it opens a block.
const EXPRESSION_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'new', 'delete', 'void', 'throw', 'case',
]);

// ES2015+ statics that nothing polyfills (Object.assign and Math.trunc ARE
// polyfilled, in polyfills.js for PKJS and shell.html for the settings page).
const DENIED_STATICS = {
  Number: ['isNaN', 'isFinite', 'isInteger', 'isSafeInteger', 'parseFloat', 'parseInt'],
  Array: ['from', 'of'],
  Object: ['values', 'entries', 'is', 'fromEntries', 'getOwnPropertySymbols',
    'getOwnPropertyDescriptors', 'setPrototypeOf'],
  Math: ['sign', 'log10', 'log2', 'log1p', 'expm1', 'cbrt', 'hypot', 'clz32', 'fround',
    'imul', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'],
  String: ['fromCodePoint', 'raw'],
};
// Whole ES2015+ namespaces: any `X.` or `X(` use (a `typeof X` guard stays legal).
const DENIED_NAMESPACES = new Set(['Promise', 'Reflect', 'Symbol']);
// ES2015+ methods, flagged when CALLED (`s.fill` as a property read is fine).
const DENIED_METHODS = new Set([
  'padStart', 'padEnd', 'startsWith', 'endsWith', 'repeat', 'codePointAt', 'normalize',
  'trimStart', 'trimEnd', 'flat', 'flatMap', 'fill', 'copyWithin', 'findLast',
  'findLastIndex', 'at', 'matchAll', 'replaceAll',
]);
// Array iterators: `.keys()` etc. — `Object.keys(o)` is ES5 and stays allowed.
const DENIED_ITERATORS = new Set(['keys', 'values', 'entries']);
const DENIED_CONSTRUCTORS = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Promise', 'Symbol', 'URLSearchParams',
  'TextEncoder', 'TextDecoder',
]);
const DENIED_GLOBAL_CALLS = new Set(['fetch']);
// Reserved in ES5 (FutureReservedWord) or ES6-only statements.
const ES6_KEYWORDS = {
  const: 'const', class: 'class', import: 'import', export: 'export', super: 'super',
  extends: 'class', enum: 'enum',
};

/**
 * Lex a source into tokens, collecting lexical ES2015+ violations on the way.
 * @param {string} src JavaScript source.
 * @param {function(number, string): void} report Violation sink (offset, message).
 * @returns {Array<{type: string, value: string, pos: number}>} Tokens.
 */
function tokenize(src, report) {
  const tokens = [];
  const n = src.length;
  let i = 0;

  const regexAllowed = () => {
    const t = tokens[tokens.length - 1];
    if (!t) return true;
    if (t.type === 'name') return REGEX_AFTER_NAME.has(t.value);
    if (t.type === 'punct') return t.value !== ')' && t.value !== ']';
    return false;
  };

  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && !/[\n\r\u2028\u2029]/.test(src[i])) i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) { report(i, 'unterminated block comment'); break; }
      i = end + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') {
          if (src[j + 1] === 'u' && src[j + 2] === '{') report(j, 'unicode code point escape \\u{…}');
          j += 2;
          continue;
        }
        if (src[j] === '\n') { report(i, 'unterminated string'); break; }
        j += 1;
      }
      tokens.push({ type: 'str', value: src.slice(i, j + 1), pos: i });
      i = j + 1;
      continue;
    }

    if (c === '`') {
      report(i, 'template literal');
      let j = i + 1;
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      tokens.push({ type: 'str', value: src.slice(i, j + 1), pos: i });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bBoO][0-9_]+|(?:[0-9][0-9_]*\.?[0-9_]*|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?)n?/
        .exec(src.slice(i, i + 64));
      const lit = m[0];
      if (/^0[bBoO]/.test(lit)) report(i, 'binary/octal literal (0b/0o)');
      if (lit.indexOf('_') !== -1) report(i, 'numeric separator');
      if (/n$/.test(lit)) report(i, 'BigInt literal');
      tokens.push({ type: 'num', value: lit, pos: i });
      i += lit.length;
      continue;
    }

    if (/[A-Za-z_$\\]/.test(c) || c.charCodeAt(0) > 127) {
      const m = /^(?:[A-Za-z_$\u0080-\uffff]|\\u[0-9a-fA-F]{4})(?:[\w$\u0080-\uffff]|\\u[0-9a-fA-F]{4})*/
        .exec(src.slice(i, i + 256));
      if (!m) { report(i, 'unexpected character ' + JSON.stringify(c)); i += 1; continue; }
      tokens.push({ type: 'name', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') { report(i, 'unterminated regex literal'); break; }
        if (inClass) {
          if (ch === ']') inClass = false;
        } else if (ch === '[') {
          inClass = true;
        } else if (ch === '/') {
          break;
        }
        j += 1;
      }
      const body = src.slice(i + 1, j);
      j += 1;
      let flags = '';
      while (j < n && /[A-Za-z]/.test(src[j])) { flags += src[j]; j += 1; }
      const bad = flags.replace(/[gim]/g, '');
      if (bad) report(i, 'regex flag(s) "' + bad + '"');
      if (/\(\?<[=!]/.test(body)) report(i, 'regex lookbehind');
      if (/\(\?<[A-Za-z_$]/.test(body)) report(i, 'regex named group');
      tokens.push({ type: 'regex', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    let p = PUNCTUATORS.find((cand) => src.startsWith(cand, i));
    // `a ? .5 : 1` is a conditional and a number, not optional chaining.
    if (p === '?.' && /[0-9]/.test(src[i + 2] || '')) p = '?';
    if (!p) { report(i, 'unexpected character ' + JSON.stringify(c)); i += 1; continue; }
    if (ES6_PUNCTUATORS[p]) report(i, ES6_PUNCTUATORS[p]);
    tokens.push({ type: 'punct', value: p, pos: i });
    i += p.length;
  }
  return tokens;
}

/**
 * Find ES2015+ syntax and unpolyfilled built-in calls in an ES5 source.
 * @param {string} src JavaScript source.
 * @returns {Array<{line: number, message: string}>} Violations, in source order.
 */
function es5Violations(src) {
  const out = [];
  const lineAt = (pos) => src.slice(0, pos).split('\n').length;
  const report = (pos, message) => out.push({ line: lineAt(pos), message: message });
  const tokens = tokenize(src, report);

  const tok = (k) => tokens[k] || { type: 'eof', value: '', pos: src.length };
  const isName = (k, value) => tok(k).type === 'name' && (value === undefined || tok(k).value === value);
  const isPunct = (k, value) => tok(k).type === 'punct' && tok(k).value === value;
  const isKey = (k) => tok(k).type === 'name' || tok(k).type === 'str' || tok(k).type === 'num';

  // Bracket frames: kind is 'block' | 'object' | 'params' | 'for' | 'paren' | 'array'.
  // `ternary` counts open `?` so a `:` can be told from a case/label colon.
  // Names the file declares itself (index.js has its own `function fetch`): a
  // call to one of those is not the ES2015+ global of the same name.
  const declared = new Set();
  tokens.forEach((t, k) => {
    if (t.type === 'name' && (isName(k - 1, 'function') || isName(k - 1, 'var'))) declared.add(t.value);
  });

  const stack = [{ kind: 'block', ternary: 0 }];
  const top = () => stack[stack.length - 1];

  /**
   * What a `{` at token k opens, from the token before it.
   * @param {number} k Token index of the `{`.
   * @returns {string} 'object' or 'block'.
   */
  const braceKind = (k) => {
    const prev = tok(k - 1);
    if (prev.type === 'eof' || k === 0) return 'block';
    if (prev.type === 'name') return EXPRESSION_KEYWORDS.has(prev.value) ? 'object' : 'block';
    if (prev.type !== 'punct') return 'block';
    if (prev.value === ')' || prev.value === ';' || prev.value === '{' || prev.value === '}' ||
        prev.value === ']' || prev.value === '=>') {
      return 'block';
    }
    if (prev.value === ':') {
      // A value colon (object member or conditional) → expression; a case/label
      // colon in statement position → block. The ':' case below tags which.
      return prev.colonKind === 'statement' ? 'block' : 'object';
    }
    return 'object';
  };

  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    const frame = top();
    const afterDot = isPunct(k - 1, '.');

    // --- object literal members, checked at each member start ---
    if (frame.kind === 'object' && frame.expectKey) {
      frame.expectKey = false;
      if (isPunct(k, '}')) {
        // empty object or trailing comma — fall through to the close below
      } else if (isPunct(k, '[')) {
        report(t.pos, 'computed property key');
      } else if (isPunct(k, '*')) {
        report(t.pos, 'generator method');
        continue;
      } else if (isPunct(k, '...')) {
        continue;   // already reported as spread
      } else if (isKey(k)) {
        if ((t.value === 'get' || t.value === 'set') && t.type === 'name' &&
            isKey(k + 1) && isPunct(k + 2, '(')) {
          frame.accessor = true;   // ES5 accessor: its '(' opens a parameter list
          continue;
        }
        if (isPunct(k + 1, ':')) { k += 1; continue; }
        if (isPunct(k + 1, '(')) report(t.pos, 'shorthand method');
        else if (isPunct(k + 1, ',') || isPunct(k + 1, '}')) report(t.pos, 'shorthand property');
        else if (isPunct(k + 1, '=')) report(t.pos, 'shorthand property with default');
        else report(t.pos, 'non-ES5 object member');
        continue;
      } else {
        report(t.pos, 'non-ES5 object member');
      }
    }

    if (t.type === 'punct') {
      switch (t.value) {
        case '{': {
          let kind;
          if (frame.kind === 'params') {
            report(t.pos, 'destructuring parameter');
            kind = 'object';
          } else if (isName(k - 1, 'var')) {
            report(t.pos, 'destructuring declaration');
            kind = 'object';
          } else {
            kind = braceKind(k);
          }
          stack.push({ kind: kind, ternary: 0, expectKey: kind === 'object' });
          break;
        }
        case '(': {
          let kind = 'paren';
          if (isName(k - 1, 'function') || (isName(k - 2, 'function') && isName(k - 1))) {
            kind = 'params';
          } else if (frame.kind === 'object' && frame.accessor) {
            kind = 'params';
            frame.accessor = false;
          } else if (isName(k - 1, 'for')) {
            kind = 'for';
          }
          stack.push({ kind: kind, ternary: 0 });
          break;
        }
        case '[': {
          if (frame.kind === 'params') report(t.pos, 'destructuring parameter');
          if (isName(k - 1, 'var')) report(t.pos, 'destructuring declaration');
          stack.push({ kind: 'array', ternary: 0 });
          break;
        }
        case '}': case ')': case ']':
          if (stack.length > 1) stack.pop();
          break;
        case ',':
          if (isPunct(k + 1, ')')) report(t.pos, 'trailing comma in call or parameter list');
          if (frame.kind === 'object') frame.expectKey = true;
          break;
        case '?':
          frame.ternary += 1;
          break;
        case ':':
          if (frame.ternary > 0) {
            frame.ternary -= 1;
            t.colonKind = 'value';
          } else {
            t.colonKind = frame.kind === 'block' ? 'statement' : 'value';
          }
          break;
        case '=':
          if (frame.kind === 'params') report(t.pos, 'default parameter');
          break;
        case '*':
          if (isName(k - 1, 'function')) report(t.pos, 'generator function');
          break;
        case '.':
          if (isName(k - 1, 'new') && isName(k + 1, 'target')) report(t.pos, 'new.target');
          break;
        default:
          break;
      }
      continue;
    }

    if (t.type !== 'name' || afterDot) continue;
    const v = t.value;

    // --- ES6-only keywords (property names after `.` and member keys excluded above) ---
    if (Object.prototype.hasOwnProperty.call(ES6_KEYWORDS, v)) {
      report(t.pos, ES6_KEYWORDS[v]);
    } else if (v === 'let' && (isName(k + 1) || isPunct(k + 1, '[') || isPunct(k + 1, '{'))) {
      report(t.pos, 'let');
    } else if (v === 'async' && isName(k + 1, 'function')) {
      report(t.pos, 'async function');
    } else if (v === 'of' && frame.kind === 'for' &&
               (isName(k - 1) || isPunct(k - 1, ']') || isPunct(k - 1, '}'))) {
      report(t.pos, 'for…of');
    }

    // --- ES2015+ built-ins that nothing polyfills ---
    if (declared.has(v)) continue;
    if (DENIED_NAMESPACES.has(v) && (isPunct(k + 1, '.') || isPunct(k + 1, '('))) {
      report(t.pos, v);
    }
    if (Object.prototype.hasOwnProperty.call(DENIED_STATICS, v) && isPunct(k + 1, '.') &&
        isName(k + 2) && DENIED_STATICS[v].indexOf(tok(k + 2).value) !== -1 && isPunct(k + 3, '(')) {
      report(t.pos, v + '.' + tok(k + 2).value);
    }
    if (DENIED_CONSTRUCTORS.has(v) && isName(k - 1, 'new')) report(t.pos, 'new ' + v);
    if (DENIED_GLOBAL_CALLS.has(v) && isPunct(k + 1, '(') && !isName(k - 1, 'function')) {
      report(t.pos, v + '()');
    }
  }

  // Method calls: `.name(` — scanned separately so property names after `.` count.
  for (let k = 1; k < tokens.length - 1; k += 1) {
    if (!isPunct(k - 1, '.') || !isName(k) || !isPunct(k + 1, '(')) continue;
    const m = tokens[k].value;
    if (DENIED_METHODS.has(m)) report(tokens[k].pos, '.' + m + '()');
    if (DENIED_ITERATORS.has(m) && !isName(k - 2, 'Object')) report(tokens[k].pos, '.' + m + '()');
  }

  return out.sort((a, b) => a.line - b.line);
}

/**
 * The bodies of every inline <script> in an HTML file (src-less scripts only).
 * @param {string} html HTML source.
 * @returns {string[]} Script bodies.
 */
function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!/\bsrc\s*=/.test(m[1])) out.push(m[2]);
  }
  return out;
}

module.exports = { es5Violations: es5Violations, inlineScripts: inlineScripts, tokenize: tokenize };

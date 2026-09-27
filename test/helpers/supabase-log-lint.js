// test/helpers/supabase-log-lint.js — the static half of AGENTS.md's "Privacy in Supabase
// requests and logs" rule for the edge functions (supabase/functions/**), used by
// test/supabase-log-hygiene.test.js. Supabase keeps every line a function prints
// (function_logs), the Deno runtime prints an uncaught error's message and stack there, and the
// gateway logs the full URL of every PostgREST call a function makes. So a function logs only
// through its log.ts (a fixed tag plus at most a machine code), nothing it throws carries
// request data in its message, and no query filter names a personal column.
//
// It tokenizes (comments, strings, templates and regex literals are real tokens, so nothing
// inside them can false-positive) and then checks the token stream:
//   - `console` (a call, globalThis.console, a destructure: any use), `reportError` and
//     Deno.stdout/Deno.stderr appear only in a log.ts;
//   - a console call in log.ts builds its line from string literals and names that are a
//     LogTag or a safeCode() result: no template substitution, no member or element access
//     (error.message, body[k]), no call;
//   - the built-in Error constructors, and super() in a class extending an *Error, take string
//     literals only: no concatenation, no template substitution, no variable;
//   - `throw` throws an Error, never a string;
//   - logEvent/logCaught arguments carry no concatenation or template substitution;
//   - supabase-js: rpc() takes no options argument ({ head: true } / { get: true } move its
//     params into the URL), no `head: true` count, and no filter (.eq, .or, .match, …) names a
//     token, hash, IP, key or coordinate column (those go through an RPC's POST body).
// It is not a type checker: it trusts a name declared `: LogTag` or `= safeCode(…)` in the same
// file. The Deno suites pin the runtime half (log lines are 'tag[ code]'; a throw logs
// 'unhandled'; no personal data in any URL supabase-js builds). The self-test in
// test/supabase-log-hygiene.test.js pins what this catches and what it must leave alone.
'use strict';

// Longest first, so '>>>=' wins over '>>' and '...' over '.'.
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|',
  '^', '!', '~', '?', ':', '=', '.', '@', '#',
];

// A `/` after these names starts a regex literal, not a division.
const REGEX_AFTER_NAME = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

// Constructors whose first argument becomes a message the runtime prints when uncaught.
const ERROR_CONSTRUCTORS = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'AggregateError', 'DOMException',
]);

// The names a log line may only come from.
const LOG_HELPERS = new Set(['logEvent', 'logCaught']);

// supabase-js / PostgREST filter methods: each one's arguments become a URL query parameter.
const FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'likeAllOf', 'likeAnyOf', 'ilike',
  'ilikeAllOf', 'ilikeAnyOf', 'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte',
  'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps', 'textSearch', 'match', 'not', 'or',
  'filter',
]);
// A column (or a value's name) that holds personal data: account/watch tokens and their hashes,
// IPs and the IP buckets, API keys, cache keys (a place), coordinates, contact details.
const PERSONAL_COLUMN = /token|hash|(?:^|_)ip(?:_|$)|ip_?hour|api_?key|cache_?key|^lat(?:itude)?$|^lon(?:gitude)?$|^lng$|email|address/i;

const EOF = { type: 'eof', value: '', pos: -1 };

/**
 * Lex a TypeScript/JavaScript source into tokens.
 * @param {string} src Source text.
 * @returns {Array<{type: string, value: string, pos: number, subst?: boolean}>} Tokens: name,
 *   num, str, template (subst: it has a ${…}), regex, punct.
 */
function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;

  /**
   * End (exclusive) of the quoted string opening at `at`.
   * @param {number} at Index of the opening quote.
   * @returns {number} Index just past the closing quote.
   */
  function skipString(at) {
    const quote = src[at];
    let j = at + 1;
    while (j < n && src[j] !== quote && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  }

  /**
   * End (exclusive) of a comment opening at `at`, or -1 when none opens there.
   * @param {number} at Index of a '/'.
   * @returns {number} Index just past the comment, or -1.
   */
  function skipComment(at) {
    if (src[at] !== '/') return -1;
    if (src[at + 1] === '/') {
      let j = at + 2;
      while (j < n && src[j] !== '\n') j += 1;
      return j;
    }
    if (src[at + 1] === '*') {
      const end = src.indexOf('*/', at + 2);
      return end === -1 ? n : end + 2;
    }
    return -1;
  }

  /**
   * End (exclusive) of the ${…} substitution whose body starts at `at`.
   * @param {number} at Index just past '${'.
   * @returns {number} Index just past the closing '}'.
   */
  function skipSubstitution(at) {
    let depth = 0;
    let j = at;
    while (j < n) {
      const ch = src[j];
      const afterComment = skipComment(j);
      if (afterComment !== -1) { j = afterComment; continue; }
      if (ch === '"' || ch === "'") { j = skipString(j); continue; }
      if (ch === '`') { j = skipTemplate(j).end; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        if (depth === 0) return j + 1;
        depth -= 1;
      }
      j += 1;
    }
    return n;
  }

  /**
   * The template literal opening at `at`.
   * @param {number} at Index of the opening backtick.
   * @returns {{end: number, subst: boolean}} Index just past it; whether it has a ${…}.
   */
  function skipTemplate(at) {
    let j = at + 1;
    let subst = false;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return { end: j + 1, subst: subst };
      if (src[j] === '$' && src[j + 1] === '{') {
        subst = true;
        j = skipSubstitution(j + 2);
        continue;
      }
      j += 1;
    }
    return { end: n, subst: subst };
  }

  const regexAllowed = () => {
    const t = tokens[tokens.length - 1];
    if (!t) return true;
    if (t.type === 'name') return REGEX_AFTER_NAME.has(t.value);
    if (t.type === 'punct') return t.value !== ')' && t.value !== ']' && t.value !== '}';
    return false;
  };

  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }

    const afterComment = skipComment(i);
    if (afterComment !== -1) { i = afterComment; continue; }

    if (c === '"' || c === "'") {
      const end = skipString(i);
      tokens.push({ type: 'str', value: src.slice(i, end), pos: i });
      i = end;
      continue;
    }

    if (c === '`') {
      const t = skipTemplate(i);
      tokens.push({ type: 'template', value: src.slice(i, t.end), pos: i, subst: t.subst });
      i = t.end;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xXbBoO][0-9a-fA-F_]+|(?:[0-9][0-9_]*\.?[0-9_]*|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?)n?/
        .exec(src.slice(i, i + 64));
      tokens.push({ type: 'num', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) {
      const m = /^[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/.exec(src.slice(i, i + 256));
      tokens.push({ type: 'name', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (inClass) {
          if (ch === ']') inClass = false;
        } else if (ch === '[') {
          inClass = true;
        } else if (ch === '/') {
          break;
        }
        j += 1;
      }
      j += 1;
      while (j < n && /[A-Za-z]/.test(src[j])) j += 1;
      tokens.push({ type: 'regex', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const p = PUNCTUATORS.find((cand) => src.startsWith(cand, i)) || c;
    tokens.push({ type: 'punct', value: p, pos: i });
    i += p.length;
  }
  return tokens;
}

/**
 * Index of the bracket closing the one at `open`.
 * @param {Array<{type: string, value: string}>} tokens Token stream.
 * @param {number} open Index of a '(', '[' or '{' token.
 * @returns {number} Index of its matching closer (tokens.length when unbalanced).
 */
function matchClose(tokens, open) {
  let depth = 0;
  for (let k = open; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.type !== 'punct') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{') depth += 1;
    if (t.value === ')' || t.value === ']' || t.value === '}') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return tokens.length;
}

/**
 * The arguments of a call, split at its top-level commas.
 * @param {Array<{type: string, value: string}>} tokens Token stream.
 * @param {number} open Index of the call's '('.
 * @returns {Array<Array<number>>} Token indexes of each argument (a trailing comma adds none).
 */
function callArgs(tokens, open) {
  const close = matchClose(tokens, open);
  const args = [];
  let current = [];
  let depth = 0;
  for (let k = open + 1; k < close; k += 1) {
    const t = tokens[k];
    if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) depth += 1;
    if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) depth -= 1;
    if (depth === 0 && t.type === 'punct' && t.value === ',') {
      args.push(current);
      current = [];
      continue;
    }
    current.push(k);
  }
  if (current.length) args.push(current);
  return args;
}

/**
 * The text a string or template token holds (quotes dropped, escapes left as written).
 * @param {{value: string}} t A str or template token.
 * @returns {string} Its body.
 */
function literalBody(t) {
  return t.value.slice(1, -1);
}

/**
 * Find logging and error-message patterns that could put request data into Supabase's logs.
 * @param {string} src Source of one edge-function module (TypeScript or JavaScript).
 * @param {{logFile?: boolean}} [opts] logFile: the module is a function's log.ts, the one place
 *   console may be used.
 * @returns {Array<{line: number, message: string}>} Violations, in source order.
 */
function logViolations(src, opts) {
  const logFile = Boolean(opts && opts.logFile);
  const tokens = tokenize(src);
  const out = [];
  const lineAt = (pos) => src.slice(0, pos).split('\n').length;
  const report = (k, message) => out.push({ line: lineAt(tokens[k].pos), message: message });

  const tok = (k) => tokens[k] || EOF;
  const isPunct = (k, value) => tok(k).type === 'punct' && tok(k).value === value;
  const isName = (k, value) => tok(k).type === 'name' && (value === undefined || tok(k).value === value);
  const isMember = (k) => isPunct(k - 1, '.') || isPunct(k - 1, '?.');
  const isLiteral = (k) => tok(k).type === 'str' || (tok(k).type === 'template' && !tok(k).subst);

  // Names a console line in log.ts may use: `<name>: LogTag` (a tag parameter or field) and
  // `const|let <name> = safeCode(…)` (a code that passed the filter).
  const logSafe = new Set();
  tokens.forEach((t, k) => {
    if (t.type === 'name' && isPunct(k + 1, ':') && isName(k + 2, 'LogTag')) logSafe.add(t.value);
    if ((isName(k, 'const') || isName(k, 'let')) && isName(k + 1) && isPunct(k + 2, '=') &&
        isName(k + 3, 'safeCode') && isPunct(k + 4, '(')) {
      logSafe.add(tok(k + 1).value);
    }
  });

  /**
   * Report every argument of the call opening at `open` that is not one string literal.
   * @param {number} open Index of the call's '('.
   * @param {string} what The callee, for the message.
   * @returns {void}
   */
  const literalArgsOnly = (open, what) => {
    callArgs(tokens, open).forEach((arg) => {
      if (arg.length === 1 && isLiteral(arg[0])) return;
      report(arg[0], what + ' message must be one string literal (no variable, concatenation ' +
        'or ${…}): the runtime prints it when uncaught');
    });
  };

  // Class bodies extending an *Error: their super(…) is the message.
  const errorClassBodies = [];
  tokens.forEach((t, k) => {
    if (!isName(k, 'extends')) return;
    let j = k + 1;
    while (j < tokens.length && !isPunct(j, '{')) j += 1;
    const base = tok(j - 1);
    if (base.type === 'name' && /Error$/.test(base.value)) errorClassBodies.push([j, matchClose(tokens, j)]);
  });
  const inErrorClass = (k) => errorClassBodies.some((b) => k > b[0] && k < b[1]);

  tokens.forEach((t, k) => {
    if (t.type === 'name') {
      // ── Where a line may be printed ──────────────────────────────────────────
      if ((t.value === 'console' || t.value === 'reportError') && !logFile) {
        report(k, t.value + ' outside log.ts: log through the function\'s log.ts logEvent(tag, code)');
      }
      if (t.value === 'Deno' && isPunct(k + 1, '.') && (isName(k + 2, 'stdout') || isName(k + 2, 'stderr'))) {
        report(k, 'Deno.' + tok(k + 2).value + ' writes straight to the function logs: log through log.ts');
      }

      // ── What a console line in log.ts may carry ──────────────────────────────
      if (t.value === 'console' && logFile) {
        if (!(isPunct(k + 1, '.') && isName(k + 2) && isPunct(k + 3, '('))) {
          report(k, 'console used other than as a console.<method>(…) call');
        } else {
          const close = matchClose(tokens, k + 3);
          for (let j = k + 4; j < close; j += 1) {
            const a = tok(j);
            if (a.type === 'template' && a.subst) report(j, '${…} in a console line');
            if (a.type === 'punct' && (a.value === '.' || a.value === '?.' || a.value === '[')) {
              report(j, 'member access in a console line (error.message, a request field)');
            }
            if (a.type === 'name' && isPunct(j + 1, '(')) report(j, 'call in a console line: ' + a.value + '(…)');
            else if (a.type === 'name' && !logSafe.has(a.value) && !isMember(j)) {
              report(j, a.value + ' in a console line is neither a LogTag nor a safeCode() result');
            }
          }
        }
      }

      // ── Error messages ───────────────────────────────────────────────────────
      if (ERROR_CONSTRUCTORS.has(t.value) && !isMember(k) && isPunct(k + 1, '(')) {
        literalArgsOnly(k + 1, t.value);
      }
      if (t.value === 'super' && isPunct(k + 1, '(') && inErrorClass(k)) {
        literalArgsOnly(k + 1, 'An Error subclass\'s super(…)');
      }
      if (t.value === 'throw' && (tok(k + 1).type === 'str' || tok(k + 1).type === 'template')) {
        report(k, 'throw a string: throw an Error with a literal message instead');
      }

      // ── The log helpers' arguments ───────────────────────────────────────────
      if (LOG_HELPERS.has(t.value) && isPunct(k + 1, '(') && !isName(k - 1, 'function')) {
        const close = matchClose(tokens, k + 1);
        for (let j = k + 2; j < close; j += 1) {
          if (tok(j).type === 'template' && tok(j).subst) report(j, '${…} in a ' + t.value + ' argument');
          if (isPunct(j, '+')) report(j, 'concatenation in a ' + t.value + ' argument');
        }
      }

      // ── supabase-js calls whose values would land in a URL ───────────────────
      if (t.value === 'rpc' && isMember(k) && isPunct(k + 1, '(') && callArgs(tokens, k + 1).length > 2) {
        report(k, 'rpc(…) with options: { head: true } / { get: true } move its params into the URL');
      }
      if (t.value === 'head' && isPunct(k + 1, ':') && isName(k + 2, 'true')) {
        report(k, 'a head: true count sends its filters in the URL: count in an RPC');
      }
      if (FILTER_METHODS.has(t.value) && isMember(k) && isPunct(k + 1, '(')) {
        const close = matchClose(tokens, k + 1);
        for (let j = k + 2; j < close; j += 1) {
          const a = tok(j);
          const text = a.type === 'name' ? a.value
            : (a.type === 'str' || a.type === 'template') ? literalBody(a) : '';
          const personal = text.split(/[^A-Za-z0-9_]+/).find((w) => w && PERSONAL_COLUMN.test(w));
          if (personal) {
            report(j, '.' + t.value + '(…) on ' + personal + ': a query filter lands in the logged ' +
              'URL; pass personal data in an RPC\'s POST body');
          }
        }
      }
    }
  });
  return out;
}

/**
 * Whether a module catches a throw and logs it as 'unhandled' (the top-level catch every
 * Deno.serve handler needs: an uncaught error's message and stack reach the function logs).
 * @param {string} src Module source.
 * @returns {boolean} True when some `catch` block calls logCaught(…) or logEvent("unhandled").
 */
function catchesUnhandled(src) {
  const tokens = tokenize(src);
  const tok = (k) => tokens[k] || EOF;
  const isPunct = (k, value) => tok(k).type === 'punct' && tok(k).value === value;
  return tokens.some((t, k) => {
    if (t.type !== 'name' || t.value !== 'catch' || isPunct(k - 1, '.') || isPunct(k - 1, '?.')) return false;
    let open = k + 1;
    if (isPunct(open, '(')) open = matchClose(tokens, open) + 1;
    if (!isPunct(open, '{')) return false;
    const close = matchClose(tokens, open);
    for (let j = open + 1; j < close; j += 1) {
      if (tok(j).type !== 'name' || !isPunct(j + 1, '(')) continue;
      if (tok(j).value === 'logCaught') return true;
      if (tok(j).value === 'logEvent' && tok(j + 2).type === 'str' && literalBody(tok(j + 2)) === 'unhandled') {
        return true;
      }
    }
    return false;
  });
}

module.exports = { tokenize: tokenize, logViolations: logViolations, catchesUnhandled: catchesUnhandled };

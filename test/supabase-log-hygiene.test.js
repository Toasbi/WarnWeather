'use strict';
// Supabase keeps every line an edge function prints (function_logs), the Deno runtime prints an
// uncaught error's message and stack there, and the gateway logs the full URL of every PostgREST
// call a function makes. AGENTS.md ("Privacy in Supabase requests and logs") therefore has each
// function log through its log.ts only (a fixed tag plus at most a machine code), throw literal
// messages, catch everything at the top and log it as 'unhandled', and never filter a query on a
// personal column. This is the static guard for that, over every module in supabase/functions/**
// (a new function or file is covered automatically). The Deno suites (`mise test-deno`) pin the
// runtime half. It runs here, in `mise test`, because that is the suite CI runs on every PR.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { logViolations, catchesUnhandled } = require('./helpers/supabase-log-lint.js');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'supabase', 'functions');

/**
 * Every deployed module under a directory: .ts/.js/.mjs, minus the Deno tests (*_test.ts,
 * *.test.ts), which never run in a deployed function.
 * @param {string} dir Directory to walk.
 * @returns {Array<string>} Absolute paths.
 */
function walk(dir) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') out = out.concat(walk(full));
      return;
    }
    if (!/\.(ts|js|mjs)$/.test(ent.name)) return;
    if (/(_test|\.test)\.(ts|js|mjs)$/.test(ent.name)) return;
    out.push(full);
  });
  return out;
}

const SOURCES = walk(FUNCTIONS);
// A function is a directory with an index.ts (Supabase's '_shared'-style dirs hold modules only).
const FUNCTION_DIRS = fs.readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((ent) => ent.isDirectory() && fs.existsSync(path.join(FUNCTIONS, ent.name, 'index.ts')))
  .map((ent) => ent.name);

/**
 * Lint one snippet.
 * @param {string} src Source.
 * @param {boolean} [logFile] Lint it as a log.ts.
 * @returns {Array<string>} The violation messages.
 */
function lint(src, logFile) {
  return logViolations(src, { logFile: Boolean(logFile) }).map((v) => v.message);
}

test('every edge function and module is scanned', () => {
  ['news', 'rainbow-nowcast', 'telemetry-ingest'].forEach((fn) => {
    assert.ok(FUNCTION_DIRS.indexOf(fn) !== -1, fn + ' should be found as a function');
  });
  assert.ok(SOURCES.length >= 15, 'expected every function module, got ' + SOURCES.length);
  assert.ok(!SOURCES.some((f) => /_test\.ts$/.test(f)), 'Deno tests are not deployed code');
});

test('no function logs, throws or filters on request data', () => {
  SOURCES.forEach((file) => {
    const found = logViolations(fs.readFileSync(file, 'utf8'), { logFile: path.basename(file) === 'log.ts' })
      .map((v) => 'line ' + v.line + ': ' + v.message);
    assert.deepEqual(found, [], path.relative(ROOT, file));
  });
});

test('every function has a log.ts and catches what its handler throws as unhandled', () => {
  FUNCTION_DIRS.forEach((fn) => {
    const dir = path.join(FUNCTIONS, fn);
    const log = path.join(dir, 'log.ts');
    assert.ok(fs.existsSync(log), fn + ' needs a log.ts (logEvent: a fixed tag plus at most a code)');
    assert.match(fs.readFileSync(log, 'utf8'), /"unhandled"/, fn + '/log.ts needs an "unhandled" tag');
    const catches = walk(dir).some((f) => catchesUnhandled(fs.readFileSync(f, 'utf8')));
    assert.ok(catches, fn + ' needs a top-level catch that logs "unhandled": the runtime would ' +
      'print an uncaught error\'s message and stack');
  });
});

// ── Self-test: what the lint catches, and what it must leave alone ────────────────────────────

test('lint: console, reportError and Deno.stderr are flagged outside log.ts', () => {
  [
    'console.log("x");',
    'console.error("news: list failed", error);',
    'globalThis.console.warn("x");',
    'const { error: e } = console;',
    'promise.catch(console.error);',
    'reportError(e);',
    'Deno.stderr.writeSync(bytes);',
  ].forEach((src) => assert.ok(lint(src).length > 0, 'should flag: ' + src));
});

test('lint: a log.ts console line carries only a LogTag and a safeCode() result', () => {
  const head = 'export function logEvent(tag: LogTag, code?: unknown): void {\n  const c = safeCode(code);\n';
  [
    'console.error(error);',
    'console.error("news " + tag, error);',
    'console.error(`news ${tag} ${c}`);',
    'console.error("news " + tag + " " + error.message);',
    'console.error("news " + tag + " " + String(code));',
    'console.error("news " + tag + " " + body["lat"]);',
    'console.error("news " + tag + " " + code);',
    'const log = console.log;',
  ].forEach((line) => assert.ok(lint(head + '  ' + line + '\n}', true).length > 0, 'should flag: ' + line));

  assert.deepEqual(lint(head + '  console.error(c ? "news " + tag + " " + c : "news " + tag);\n}', true), []);
});

test('lint: Error messages must be one string literal', () => {
  [
    'throw new Error("insert failed: " + error.message);',
    'throw new Error(`insert failed: ${error.message}`);',
    'throw new Error(message);',
    'throw Error(error.message);',
    'throw new TypeError("bad " + x);',
    'return Promise.reject(new RangeError(String(n)));',
    'class StoreError extends Error { constructor(m: string) { super(m); } }',
    'class StoreError extends Error { constructor(t: string) { super("store " + t); } }',
    'throw "failed";',
    'throw `failed ${x}`;',
  ].forEach((src) => assert.ok(lint(src).length > 0, 'should flag: ' + src));

  [
    'throw new Error("SUPABASE_URL is not set");',
    'throw new Error(`no hashing pepper`);',
    'throw new Error();',
    'if (e instanceof Error) throw e;',
    // A custom Error's arguments are its own business: its super(…) is what is checked.
    'class StoreError extends Error {\n  constructor(tag: LogTag, code?: unknown) {\n' +
      '    super("store call failed");\n    this.code = safeCode(code);\n  }\n}\n' +
      'throw new StoreError("cache_write_failed", error.code);',
    'class Box extends Base { constructor(v: string) { super(v); } }',
  ].forEach((src) => assert.deepEqual(lint(src), [], 'should allow: ' + src));
});

test('lint: logEvent/logCaught arguments carry no concatenation or ${…}', () => {
  [
    'logEvent("list_failed", "PG" + error.code);',
    'logEvent(`list_failed_${op}`);',
    'logCaught(error + "");',
  ].forEach((src) => assert.ok(lint(src).length > 0, 'should flag: ' + src));

  [
    'logEvent("list_failed", error.code);',
    'logEvent(error.tag, error.code);',
    'logCaught(error);',
    'export function logEvent(tag: LogTag, code?: unknown): void {}',
  ].forEach((src) => assert.deepEqual(lint(src), [], 'should allow: ' + src));
});

test('lint: supabase-js calls keep personal data out of the URL', () => {
  [
    'await client.from("news_seen").select("last_seen_news_id").eq("account_token_hash", hash);',
    'await client.from("news_votes").select("id").in("account_token_hash", hashes);',
    'await client.from("t").select("id", { count: "exact", head: true });',
    'await client.rpc("news_list", { p_hash: hash }, { get: true });',
    'await client.from("news").select("*").or(`target_version.is.null,account_token_hash.eq.${h}`);',
    'await client.from("t").select("*").match({ ip_hour: key });',
    'await supabase.from("rainbow_nowcast_cache").select("payload").eq("cache_key", key);',
    'await client.from("t").delete().eq("id", tokenHash);',
  ].forEach((src) => assert.ok(lint(src).length > 0, 'should flag: ' + src));

  [
    'await client.rpc("news_list", { p_hash: hash, p_version: v });',
    'await client.from("news").select("choices").eq("id", payload.newsId).maybeSingle();',
    'await supabase.from("rainbow_upstream_usage").select("upstream_calls").eq("period", period);',
    'await client.from("news_votes").upsert({ account_token_hash: hash }, { onConflict: "news_id,account_token_hash" });',
    'const parts = pathname.split("/").filter((p) => p !== "");',
  ].forEach((src) => assert.deepEqual(lint(src), [], 'should allow: ' + src));
});

test('lint: comments, strings, templates and regex literals never false-positive', () => {
  [
    '// console.error(error) would log the message\nconst x = 1;',
    '/* throw new Error(msg) */\nconst x = 1;',
    'const s = "console.log(error.message)";',
    'const t = `console.error(${"x"})`;',
    'const CODE = /^[A-Z0-9_]{1,16}$/;\nconst ok = CODE.test(code);',
    'const u = `${base}/${lon}/${lat}?start_timestamp=${start}`;',
  ].forEach((src) => assert.deepEqual(lint(src), [], 'should allow: ' + src));
});

test('lint: a catch that logs "unhandled" is recognised; a silent one or a promise .catch is not', () => {
  assert.ok(catchesUnhandled('try { a(); } catch (_error) {\n  logEvent("unhandled");\n  return r;\n}'));
  assert.ok(catchesUnhandled('try { a(); } catch (error) { logCaught(error); }'));
  assert.ok(!catchesUnhandled('try { a(); } catch { return null; }'));
  assert.ok(!catchesUnhandled('try { a(); } catch (e) { logEvent("list_failed"); }'));
  assert.ok(!catchesUnhandled('p.catch(() => logEvent("unhandled"));'));
});

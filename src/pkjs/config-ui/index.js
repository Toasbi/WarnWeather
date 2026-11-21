// src/pkjs/config-ui/index.js (library entry)
var color    = require('../lib/color.js');     // intToHex, hexToInt, PALETTE
var platform = require('../config-ui/lib/platform.js');  // isColorPlatform, computeEnv
var defaults = require('./lib/defaults.js');  // deriveDefaults(schema), deriveColorKeys(schema)
require('../lib/polyfills.js');                    // Object.assign / Array.find on aplite

/**
 * JSON for splicing into the page's only inline <script>. Plain JSON.stringify
 * escapes neither '<' nor U+2028/U+2029, so a stored or third-party string holding
 * '</script' ends the element mid-literal and an unclosed '<!--' derails the HTML
 * tokenizer past the real '</script>' -- either way boot() never runs, on every open,
 * and the page that could fix the value is the one that is dead. A raw U+2028/2029
 * inside a string literal is a SyntaxError before ES2019 (old Android WebViews).
 * '<' and both separators can only occur inside JSON strings, where the \uXXXX
 * escapes decode to the identical value, so the result stays valid JSON and JS.
 * Keep the regexes as escapes: a literal U+2028 in a regex is a SyntaxError that
 * would kill the whole PKJS bundle.
 *
 * @param {*} value Any JSON-serialisable value.
 * @returns {string} JSON text safe inside an HTML <script> element.
 */
function inlineScriptJson(value) {
  return String(JSON.stringify(value)).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// The names inlineScriptLiteral never writes bare: ES3's keywords and future reserved words
// (an ES3 engine, as the oldest Android WebViews have, takes none of them as a bare property
// name), ES5's additions and the three literals.
var RESERVED_NAMES = {};
('abstract boolean break byte case catch char class const continue debugger' +
  ' default delete do double else enum export extends false final finally float for function' +
  ' goto if implements import in instanceof int interface let long native new null package' +
  ' private protected public return short static super switch synchronized this throw throws' +
  ' transient true try typeof var void volatile while with yield').split(' ')
  .forEach(function (name) { RESERVED_NAMES[name] = true; });

/**
 * One JSON string token as the JavaScript string literal that costs the fewest URL
 * characters. Single quotes cost one character each in the page's URL where a double quote
 * costs three ('%22'), so the token is requoted with them; a string with more apostrophes
 * than that pays for stays as JSON wrote it.
 *
 * @param {string} body The token's text between its quotes, still JSON-escaped.
 * @returns {string} A string literal of the same value.
 */
function leanString(body) {
  var hasApostrophe = body.indexOf("'") !== -1;
  // Every '"' inside a token is one JSON escaped ('\"'): a bare one would have ended it.
  var hasQuote = body.indexOf('"') !== -1;
  if (!hasApostrophe && !hasQuote) { return "'" + body + "'"; }   // most tokens: nothing to count
  var apostrophes = hasApostrophe ? body.split("'").length - 1 : 0;
  var quotes = hasQuote ? body.split('"').length - 1 : 0;
  // In the URL a single-quoted literal costs 2, plus 4 per apostrophe (it needs a backslash)
  // and 3 per quote; a double-quoted one costs 6, plus 1 per apostrophe and 6 per quote.
  if (apostrophes > quotes + 1) { return '"' + body + '"'; }
  return "'" + body.split('\\"').join('"').split("'").join("\\'") + "'";
}

/**
 * One JSON object key as a property name: bare where it is a plain identifier (no quotes
 * to pay for), a string literal otherwise.
 *
 * @param {string} body The key's text between its quotes, still JSON-escaped.
 * @returns {string} The property name.
 */
function leanKey(body) {
  // `=== true`: a name Object.prototype has (constructor, toString) is not a reserved one.
  var bare = RESERVED_NAMES[body] !== true && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(body);
  return bare ? body : leanString(body);
}

/**
 * A value as a JavaScript literal for the page's inline <script>, written to cost as few URL
 * characters as it can. The page travels as one data: URL that Android's WebView refuses
 * past 2 MiB, and in it every '"' of JSON costs three characters: the schema alone holds
 * 28,000 of them. This is JSON.stringify's own text (so what it leaves out, how it prints a
 * number and what toJSON answers are all its doing) with only its string tokens rewritten:
 * a key becomes a bare name, a string takes single quotes. The page assigns the text to a
 * variable and never parses it as JSON, and it evaluates to the same value.
 *
 * The scan is by indexOf, not by a regex over each token: a stored string can be tens of
 * thousands of characters long (the news cache), which a repeated group does not survive on
 * every engine. '<' and U+2028/2029 are escaped as inlineScriptJson escapes them; they can
 * only stand inside a string here too.
 *
 * @param {*} value Any JSON-serialisable value.
 * @returns {string} JavaScript source for the value, safe inside an HTML <script> element.
 */
function inlineScriptLiteral(value) {
  var json = String(JSON.stringify(value));
  var out = [];
  var at = 0;
  var open = json.indexOf('"');
  // The next backslash from where the scan stands (-1: none is left). Looked up again only
  // once the scan has passed it, so the whole text is searched for them once, not per token.
  var slash = json.indexOf('\\');
  var close, from, quote;
  while (open !== -1) {
    // The token's closing quote: the first '"' no backslash escapes.
    from = open + 1;
    for (;;) {
      quote = json.indexOf('"', from);
      if (slash !== -1 && slash < from) { slash = json.indexOf('\\', from); }
      if (quote === -1 || slash === -1 || slash > quote) { break; }
      from = slash + 2;
    }
    close = quote;
    if (close === -1) { break; }                          // not JSON.stringify's text: left as it is
    out.push(json.slice(at, open));
    // JSON.stringify writes no blanks, so a key is the string a ':' follows.
    out.push(json.charAt(close + 1) === ':' ? leanKey(json.slice(open + 1, close))
      : leanString(json.slice(open + 1, close)));
    at = close + 1;
    open = json.indexOf('"', at);
  }
  out.push(json.slice(at));
  return out.join('').replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function createConfig(cfg) {
  var schema    = cfg.schema;
  var options   = cfg.options || {};
  var storage   = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  var storeKey  = options.storageKey || 'clay-settings';  // Clay's key by default (drop-in)
  var emulatorConfigUrl = options.emulatorConfigUrl || null;  // hosted helper for emulator testing
  var colorKeys = defaults.deriveColorKeys(schema);     // schema items with type 'color'
  function isColorKey(k) { return colorKeys.indexOf(k) >= 0; }

  var instance = { meta: { userData: {} } };  // meta.userData: Clay-compatible

  function readStore()  { return storage ? JSON.parse(storage.getItem(storeKey) || '{}') : {}; }
  function writeStore(b) { if (storage) { storage.setItem(storeKey, JSON.stringify(b)); } }

  function getDefaults() { return defaults.deriveDefaults(schema); }   // colors as ints

  function parseResponse(responseStr) {                  // raw response -> blob (colors hex->int)
    // Clay's guard: some hosts hand webviewclosed an already-decoded response (Core
    // Devices' app runs decodeURLPart on the pebblejs://close# fragment). Decoding that
    // again throws on a lone '%' ("Rain 0%") -- the whole save is lost -- or silently
    // rewrites a '%41' in user text. The page's encoded blob always starts '%7B', the
    // decoded one '{', so the check cannot misfire.
    var json = /^\s*\{/.test(responseStr) ? responseStr : decodeURIComponent(responseStr);
    var raw = JSON.parse(json), out = {}, k;
    for (k in raw) { if (Object.prototype.hasOwnProperty.call(raw, k)) {
      // '' passes through: it is an app-level "no color" sentinel, and
      // hexToInt('') is NaN — which JSON persistence would turn into null.
      out[k] = isColorKey(k) && raw[k] !== '' ? color.hexToInt(raw[k]) : raw[k]; } }
    return out;
  }

  function injectIntoPage(pageStr, opts) {               // pure; colors int->hex; fills markers
    var valuesHex = Object.assign({}, opts.values), i, ck;
    for (i = 0; i < colorKeys.length; i += 1) { ck = colorKeys[i];
      if (typeof valuesHex[ck] === 'number') { valuesHex[ck] = color.intToHex(valuesHex[ck]); } }
    // inlineScriptLiteral: see its doc. The return target stays JSON text: the emulator
    // helper finds its placeholder there, and it is a few characters either way.
    var snippet =
      'INJECTED_SCHEMA='   + inlineScriptLiteral(schema)               + ';' +
      'INJECTED_CFG='      + inlineScriptLiteral(valuesHex)            + ';' +
      'INJECTED_ENV='      + inlineScriptLiteral(opts.env || null)     + ';' +
      'INJECTED_USERDATA=' + inlineScriptLiteral(opts.userData || null)+ ';' +
      'INJECTED_RETURN='   + inlineScriptJson(opts.returnTo || 'pebblejs://close#') + ';';
    return pageStr.replace('/*__PCONF_INJECT__*/', function () { return snippet; });
  }

  function isEmulator() {                                 // matches Clay's pypkjs check
    return typeof Pebble === 'undefined' || Pebble.platform === 'pypkjs';
  }

  function generateUrl(opts) {                            // Clay.generateUrl analog (opts optional)
    opts = opts || {};
    var watchInfo = opts.watchInfo ||
      (typeof Pebble !== 'undefined' && Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null);
    // In the emulator a desktop browser blocks navigating the top frame to a data: URL, so
    // (when the app supplies a hosted helper) route through it: the page goes in the #hash and
    // its return target is the $$RETURN_TO$$ placeholder the helper substitutes. Real devices
    // keep the offline data: URL + pebblejs://close#.
    var useEmulatorHelper = Boolean(emulatorConfigUrl) && isEmulator();
    var returnTo = typeof opts.returnTo !== 'undefined' ? opts.returnTo
      : (useEmulatorHelper ? '$$RETURN_TO$$' : 'pebblejs://close#');
    var html = injectIntoPage(cfg.page, {
      values:   typeof opts.values !== 'undefined' ? opts.values : readStore(),
      // opts.env is an OVERLAY, not a replacement: the library owns every fact it can
      // derive from watchInfo, and the app contributes the ones it can't. Some env
      // facts are properties of the PHONE, not of the watch -- e.g. whether this PKJS
      // host exposes the Battery Status API (Android's Chromium WebView only) -- and
      // the library must not go looking for them itself (no inbound app coupling; see
      // README "Packaging"). Merging keeps the app's line to a single key instead of a
      // hand-assembled full env that would silently rot as platform.js grows facts.
      env:      Object.assign(platform.computeEnv(watchInfo), opts.env || {}),
      userData: typeof opts.userData !== 'undefined' ? opts.userData : instance.meta.userData,
      returnTo: returnTo });
    if (useEmulatorHelper) {
      return emulatorConfigUrl + '#' + encodeURIComponent(html);
    }
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  // --- Layer-1 Clay-compatible methods (drop-in host wiring; see §17) ---
  function getSettings(responseStr) {                    // Clay.getSettings: parse + persist + return
    var blob = parseResponse(responseStr); writeStore(blob); return blob;
  }
  function setSettings(keyOrObj, val) {                   // Clay.setSettings(key,val) | (obj)
    var blob = readStore(), k;
    if (typeof keyOrObj === 'string') { blob[keyOrObj] = val; }
    else { for (k in keyOrObj) { if (Object.prototype.hasOwnProperty.call(keyOrObj, k)) { blob[k] = keyOrObj[k]; } } }
    writeStore(blob); return blob;
  }

  instance.generateUrl = generateUrl; instance.parseResponse = parseResponse;
  instance.getDefaults = getDefaults; instance.isColorKey = isColorKey;
  instance.getSettings = getSettings; instance.setSettings = setSettings;
  return instance;
}

module.exports = {                                        // factory + reusable pure helpers
  createConfig: createConfig,
  isColorPlatform: platform.isColorPlatform, computeEnv: platform.computeEnv,
  isThemePolarityPlatform: platform.isThemePolarityPlatform,
  // telemetry-settings.js gates the Dim backlight fields on this: the LED is emery's alone.
  isColorBacklightPlatform: platform.isColorBacklightPlatform,
  // forecast-series.js gates the fourth-line trend key on this: aplite has no
  // SERIES_FOURTH (WW_LINE_STYLE).
  isLineStylePlatform: platform.isLineStylePlatform,
  intToHex: color.intToHex, hexToInt: color.hexToInt,
  deriveDefaults: defaults.deriveDefaults, deriveColorKeys: defaults.deriveColorKeys,
  // scripts/build-page.js previewPage fills the same markers for the dev preview.
  inlineScriptJson: inlineScriptJson, inlineScriptLiteral: inlineScriptLiteral
};

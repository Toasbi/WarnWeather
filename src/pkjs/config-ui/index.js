// src/pkjs/config-ui/index.js (library entry)
var color    = require('./lib/color.js');     // intToHex, hexToInt, PALETTE
var platform = require('./lib/platform.js');  // isColorPlatform, computeEnv
var defaults = require('./lib/defaults.js');  // deriveDefaults(schema), deriveColorKeys(schema)
require('../polyfills.js');                    // Object.assign / Array.find on aplite

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

function createConfig(cfg) {
  var schema    = cfg.schema;
  var options   = cfg.options || {};
  var storage   = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  var storeKey  = options.storageKey || 'clay-settings';  // Clay's key by default (drop-in)
  var emulatorConfigUrl = options.emulatorConfigUrl || null;  // hosted helper for emulator testing
  var colorKeys = defaults.deriveColorKeys(schema);     // schema items with type 'color'
  function isColorKey(k) { return colorKeys.indexOf(k) >= 0; }

  var instance = { meta: { userData: {} }, colorKeys: colorKeys };  // meta.userData: Clay-compatible

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
    var snippet =                                        // inlineScriptJson: see its doc
      'INJECTED_SCHEMA='   + inlineScriptJson(schema)               + ';' +
      'INJECTED_CFG='      + inlineScriptJson(valuesHex)            + ';' +
      'INJECTED_ENV='      + inlineScriptJson(opts.env || null)     + ';' +
      'INJECTED_USERDATA=' + inlineScriptJson(opts.userData || null)+ ';' +
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
  // telemetry.js gates the Dim backlight fields on this: the LED is emery's alone.
  isColorBacklightPlatform: platform.isColorBacklightPlatform,
  intToHex: color.intToHex, hexToInt: color.hexToInt,
  deriveDefaults: defaults.deriveDefaults, deriveColorKeys: defaults.deriveColorKeys,
  // scripts/build-page.js previewPage fills the same markers for the dev preview.
  inlineScriptJson: inlineScriptJson
};

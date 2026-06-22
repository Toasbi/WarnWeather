// src/pkjs/config-ui/index.js (library entry)
var color    = require('./lib/color.js');     // intToHex, hexToInt, PALETTE
var platform = require('./lib/platform.js');  // isColorPlatform, computeEnv
var defaults = require('./lib/defaults.js');  // deriveDefaults(schema), deriveColorKeys(schema)
require('../polyfills.js');                    // Object.assign / Array.find on aplite

function createConfig(cfg) {
  var schema    = cfg.schema;
  var options   = cfg.options || {};
  var storage   = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  var storeKey  = options.storageKey || 'clay-settings';  // Clay's key by default (drop-in)
  var colorKeys = defaults.deriveColorKeys(schema);     // schema items with type 'color'
  function isColorKey(k) { return colorKeys.indexOf(k) >= 0; }

  var instance = { meta: { userData: {} }, colorKeys: colorKeys };  // meta.userData: Clay-compatible

  function readStore()  { return storage ? JSON.parse(storage.getItem(storeKey) || '{}') : {}; }
  function writeStore(b) { if (storage) { storage.setItem(storeKey, JSON.stringify(b)); } }

  function getDefaults() { return defaults.deriveDefaults(schema); }   // colors as ints

  function parseResponse(responseStr) {                  // raw response -> blob (colors hex->int)
    var raw = JSON.parse(decodeURIComponent(responseStr)), out = {}, k;
    for (k in raw) { if (Object.prototype.hasOwnProperty.call(raw, k)) {
      out[k] = isColorKey(k) ? color.hexToInt(raw[k]) : raw[k]; } }
    return out;
  }

  function injectIntoPage(pageStr, opts) {               // pure; colors int->hex; fills markers
    var valuesHex = Object.assign({}, opts.values), i, ck;
    for (i = 0; i < colorKeys.length; i += 1) { ck = colorKeys[i];
      if (typeof valuesHex[ck] === 'number') { valuesHex[ck] = color.intToHex(valuesHex[ck]); } }
    var snippet =
      'INJECTED_SCHEMA='   + JSON.stringify(schema)               + ';' +
      'INJECTED_CFG='      + JSON.stringify(valuesHex)            + ';' +
      'INJECTED_ENV='      + JSON.stringify(opts.env || null)     + ';' +
      'INJECTED_USERDATA=' + JSON.stringify(opts.userData || null)+ ';' +
      'INJECTED_RETURN='   + JSON.stringify(opts.returnTo || 'pebblejs://close#') + ';';
    return pageStr.replace('/*__PCONF_INJECT__*/', function () { return snippet; });
  }

  function generateUrl(opts) {                            // Clay.generateUrl analog (opts optional)
    opts = opts || {};
    var watchInfo = opts.watchInfo ||
      (typeof Pebble !== 'undefined' && Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null);
    var html = injectIntoPage(cfg.page, {
      values:   typeof opts.values !== 'undefined' ? opts.values : readStore(),
      env:      opts.env || platform.computeEnv(watchInfo),
      userData: typeof opts.userData !== 'undefined' ? opts.userData : instance.meta.userData,
      returnTo: opts.returnTo });
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
  intToHex: color.intToHex, hexToInt: color.hexToInt,
  deriveDefaults: defaults.deriveDefaults, deriveColorKeys: defaults.deriveColorKeys
};

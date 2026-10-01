/**
 * A short fingerprint of an API key, so the phone can say WHICH key a weather update
 * used without storing the key a second time, and the settings page can tell whether
 * that is still the key in its field. Loaded on the phone (require: the fetch cycle
 * stamps it on its records, fetch-cycle.js) and in the settings page
 * (window.KeyFingerprint: the key status, settings/key-status.js), so both sides hash
 * the same way.
 *
 * FNV-1a over the trimmed key's UTF-16 code units, 32 bits, as 8 hex digits. Not a
 * secret and not a security measure: it only ever sits next to the key itself (the
 * phone's own storage, the page the phone opens), never in a URL, a log or telemetry.
 * A different key matching by chance is a 1-in-4-billion event, and the worst it can do
 * is show another key's last result. ES5 only (aplite PKJS and the settings webview).
 */
(function () {
  /**
   * The fingerprint of a key as the watch would send it: trimmed (onbuild.js stores it
   * trimmed, the providers trim it again), '' for a missing or blank one.
   * @param {*} key The API key.
   * @returns {string} 8 lowercase hex digits, or '' for no key.
   */
  function fingerprint(key) {
    var k = typeof key === 'string' ? key.trim() : '';
    if (!k) { return ''; }
    var h = 0x811c9dc5;
    for (var i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      // h * 16777619 (the FNV prime) mod 2^32, without Math.imul (ES6).
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  var api = { fingerprint: fingerprint };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.KeyFingerprint = api; }
})();

// src/pkjs/config-ui/lib/links.js — the page's links to other sites, opened through the Pebble
// app where it asks for that. ES5 (README "ES5 constraint").
//
// With the Pebble app's permissions preview on (app 1.18.0 and later), a settings page loads only
// the domains the app declares in Internet and the user allowed, links included, so a tap on a
// link anywhere else (a sign-up page, a reference, GitHub) opens nothing. The app gives the page
// Pebble.openUrl instead, which shows the user the address and opens it in their browser
// (https://developer.repebble.com/guides/plugins/preview/, Settings pages). Without it (the
// preview off, an older app, the emulator, a desktop browser) a link works as it always did, so
// this steps in only where the page has Pebble.openUrl. A leaf: loaded before engine.js in the
// page concat (build-page.js LIB_PAGE_FILES), whose boot wires it; required under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};

(function () {
  /**
   * The address a tap on `target` follows to another site: the href of the link it is in (or
   * is), when that is an absolute http(s) URL; null for anything else (no link, an in-page
   * '#', a javascript: or data: address).
   * @param {?Object} target The tapped element.
   * @returns {?string} The URL, or null.
   */
  function externalHref(target) {
    var a = target && target.closest ? target.closest('a[href]') : null;
    if (!a) { return null; }
    var href = a.getAttribute('href') || '';
    return /^https?:\/\//i.test(href) ? href : null;
  }

  /**
   * The page's click hook: a tap on a link to another site opens it through Pebble.openUrl
   * where the page has it, instead of the page following it. A click a control already
   * handled (defaultPrevented) is left alone.
   * @param {Object} e The click event.
   * @param {?Object} pebble The page's Pebble global, or null.
   * @returns {boolean} true when the app was asked to open the link.
   */
  function openThroughApp(e, pebble) {
    if (!pebble || typeof pebble.openUrl !== 'function' || e.defaultPrevented) { return false; }
    var href = externalHref(e.target);
    if (!href) { return false; }
    e.preventDefault();
    try {
      // It answers whether the user opened it; nothing here depends on that.
      var answer = pebble.openUrl(href);
      if (answer && typeof answer.then === 'function') { answer.then(null, function () {}); }
    } catch (err) {
      // The link stays where it is: nothing to recover.
    }
    return true;
  }

  /**
   * Hook the page's clicks, once, at boot (engine.js). The Pebble global is read per tap, as
   * the app may hand it to the page after its scripts ran.
   * @param {Object} doc The document.
   * @param {?Object} win The window, or null.
   * @returns {void}
   */
  function wireLinks(doc, win) {
    doc.addEventListener('click', function (e) {
      openThroughApp(e, win && win.Pebble ? win.Pebble : null);
    }, false);
  }

  PConf.links = { externalHref: externalHref, openThroughApp: openThroughApp, wireLinks: wireLinks };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.links; }
})();

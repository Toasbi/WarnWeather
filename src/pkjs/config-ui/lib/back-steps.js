// src/pkjs/config-ui/lib/back-steps.js — the phone's Back closes the page's top layer. ES5 (README
// "ES5 constraint").
//
// The Pebble app shows the settings page in a WebView whose Back (Android's Back button or gesture,
// the iPhone's edge swipe) goes back in the page's history while it has any, and closes the
// settings screen otherwise, dropping every change not saved yet. So the page keeps a history
// entry for each layer it has open (an option list, a date's wheels, the Save dialog, a full-screen
// dialog, a page module's overlay and its steps): Back lands on an entry below, and the page closes
// its top layer, keeping what was changed there. With nothing open the page is on its first entry,
// and Back leaves the page as it always did, unless the page has a base (below).
//
// Every part of the page with layers says how many it has open and how to close the top one
// (add), and calls sync() after it opened or closed one itself. The rules:
//  - An entry is added only while a tap or key press is handled, one per tap: Chromium marks the
//    entry before one added without a user activation, and Back skips a marked entry. A tap that
//    opens two layers at once (a new bar's dialog with its name field) gets one, and Back closes
//    both. pushState gets no URL: a data: document may change no more than its fragment.
//  - Every entry carries the page's whole data: URL, so adding one, or moving between two, costs
//    the WebView tens of milliseconds and holds megabytes. The page's own closes (Done, ‹, ×, a
//    pick, Escape) leave the entries where they are while a layer stays open: the next layer opened
//    takes the entry above, and Back closes the top layer whichever entry it lands on. Once no
//    layer is open (Done on the last dialog, a tab switch, the Save dialog's buttons), the page
//    goes back to its first entry, so that Back leaves the page; a page with a base stays put.
//  - history.go() lands later. Chromium puts an entry added before it lands above the entry the
//    page was on, then lands below both, so no entry is added while one is under way: once it
//    lands, the page goes forward over the entries it left, as far as it has layers open then.
//  - A popstate the page did not ask for (Back) closes layers, the top one first, until the page
//    has no more open than the entry stands for, and at least one.
//  - The page itself can be a part too, its base (add with base: true, a depth of 1 while open). It
//    counts as no layer, but while it is open the page keeps at least one entry above its first,
//    so that Back with nothing else open still lands in the page (the engine's base: another tab
//    goes back to the one the page opened on, changes not saved ask first). Back reaches the base
//    only with nothing else open; while it stays open after a Back that landed on the first entry,
//    the page goes forward again.
//  - Once the page is leaving (stop: a save, or the page closing itself), it takes no step of its
//    own and Back closes nothing: a history.go() would cancel the navigation that closes the page.
// A page without history.pushState works as before. Loaded before engine.js in the page concat
// (build-page.js LIB_PAGE_FILES), whose boot adds its own layers; required under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};

(function () {
  // The events a tap or a key press arrives as: an entry may be added while one is handled.
  var INPUT = { click: true, keydown: true, keyup: true, mousedown: true, mouseup: true,
    pointerdown: true, pointerup: true, touchend: true };
  // How long a history.go() the page asked for may take to land before the page stops waiting for
  // it (a WebView that dropped it would hold every entry back for the rest of the session).
  var LANDS_WITHIN_MS = 3000;

  /**
   * How many layers a history state stands for (its pconfLayers): 0 for a state that is not ours.
   * @param {*} state A history.state.
   * @returns {number}
   */
  function layersOf(state) {
    var n = state ? state.pconfLayers : 0;
    return typeof n === 'number' && n > 0 ? n : 0;
  }

  /**
   * Back steps over a window's history.
   * @param {?Object} win The window: its history, navigator and popstate. Null under Node.
   * @returns {{add: function(Object): void, sync: function(): void, stop: function(): void}}
   */
  function create(win) {
    var hist = win ? win.history : null;
    var on = Boolean(hist && typeof hist.pushState === 'function' && typeof hist.go === 'function'
      && typeof win.addEventListener === 'function');
    // The parts with layers: {depth(): number, close(): void, rank?: number}.
    var parts = [];
    // The layers the entry the page is on stands for (as of its last entry added or popstate), and
    // those the last entry stands for: the entries above the one shown run up to it. A page the
    // WebView reloaded on one of its entries opens with nothing open, so its first sync goes back
    // to the first entry.
    var here = on ? layersOf(hist.state) : 0, top = here;
    // A history.go() the page asked for has not landed (since travelledAt); a Back's closes are
    // running; an entry was added in this task; the page is leaving (stop).
    var travelling = false, travelledAt = 0, closing = false, added = false, stopped = false;

    /** @returns {number} The layers the entry shown stands for. */
    function shown() { return layersOf(hist.state); }

    /** @returns {number} The layers open now, every part's together but the base's. */
    function open() {
      var n = 0;
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i].base) { n += parts[i].depth(); }
      }
      return n;
    }

    /** @returns {boolean} Whether the page's base is open (see the header). */
    function baseOpen() {
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].base && parts[i].depth() > 0) { return true; }
      }
      return false;
    }

    /**
     * How many entries above its first the page wants: one per layer open, and one at least while
     * its base is open.
     * @returns {number}
     */
    function wanted() {
      return Math.max(open(), baseOpen() ? 1 : 0);
    }

    /**
     * The part whose layer is on top: of those with one open, the highest rank (the shared dialog
     * shows above every overlay), the last added among equals; the base only with no other open.
     * @returns {?Object} The part, or null with nothing open.
     */
    function topPart() {
      var best = null, base = null;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].depth() <= 0) { continue; }
        if (parts[i].base) { base = parts[i]; continue; }
        if (!best || (parts[i].rank || 0) >= (best.rank || 0)) { best = parts[i]; }
      }
      return best || base;
    }

    /**
     * Move over `delta` entries (back below 0, forward above it); the popstate it brings is the
     * page's own.
     * @param {number} delta Entries to move, never 0 (history.go(0) reloads the page).
     * @returns {void}
     */
    function travel(delta) {
      travelling = true;
      travelledAt = Date.now();
      hist.go(delta);
    }

    /**
     * Whether an entry may be added now: while a tap or key press is handled (window.event, where
     * the WebView has it; a timer or a promise callback runs without one, though
     * navigator.userActivation stays active for seconds after a tap), in a task that added none,
     * with a user activation where the WebView tells.
     * @returns {boolean}
     */
    function mayAdd() {
      var ua = win.navigator && win.navigator.userActivation;
      var tapping = !('event' in win) || Boolean(win.event && INPUT[win.event.type]);
      return tapping && !added && (!ua || Boolean(ua.isActive));
    }

    /**
     * Add the entry for one more layer above the entry shown (the ones above it go).
     * @param {number} at The layers the entry shown stands for.
     * @returns {void}
     */
    function addEntry(at) {
      try {
        hist.pushState({ pconfLayers: at + 1 }, '');
      } catch (err) {
        on = false;   // a WebView that refuses it: Back leaves the page, as before
        return;
      }
      here = top = at + 1;
      added = true;
      setTimeout(function () { added = false; }, 0);
    }

    /**
     * Bring the history in step with the layers open: with none open, back to the first entry;
     * with more open than the entry shown stands for, one new entry while a tap is handled, else
     * forward over entries left above. Entries above the layers open stay for the next layers.
     * @param {boolean} mayPush Whether an entry may be added.
     * @returns {void}
     */
    function align(mayPush) {
      var want = wanted(), at = shown();
      if (!want) {
        if (at) { travel(-at); }
        return;
      }
      if (want <= at) { return; }
      if (mayPush && mayAdd()) { addEntry(at); return; }
      if (top > at) { travel(Math.min(want, top) - at); }
    }

    /**
     * A popstate: the page's own history.go() landing (align); or Back, which closes layers, the top
     * one first, until no more are open than the entry it lands on stands for, and at least one (an
     * entry the page left above stands for a layer it closed itself). The base closes on a Back of
     * its own only, and while it stays open after one the page goes forward to its entry again.
     * With none left open, back to the first entry, after a forward swipe too; a part that closes
     * nothing leaves the history where Back put it.
     * @returns {void}
     */
    function onPopstate() {
      if (stopped) { return; }
      var from = here, acted = false;
      here = shown();
      if (travelling) { travelling = false; align(false); return; }
      if (here < from) {
        closing = true;
        try {
          for (var closed = false; open() > here || !closed; closed = true) {
            var part = topPart(), before = open();
            if (!part) { break; }
            part.close();
            // The base answers a Back with nothing else open, and that is all the Back does.
            if (part.base) { acted = true; break; }
            if (open() >= before) { break; }
            acted = true;
          }
        } finally {
          closing = false;
        }
      }
      // A close that left the page takes no step after it.
      if (stopped) { return; }
      if (acted && !here && baseOpen()) {
        align(false);
      } else if (!wanted() && here) {
        travel(-here);
      }
    }

    if (on) {
      // A traversal between entries of this one page moves nothing: the page scrolls itself.
      if ('scrollRestoration' in hist) { hist.scrollRestoration = 'manual'; }
      win.addEventListener('popstate', onPopstate);
    }

    return {
      /**
       * A part of the page with layers of its own.
       * @param {{depth: function(): number, close: function(): void, rank: (number|undefined),
       *   base: (boolean|undefined)}} part depth: how many of its layers are open; close: close the
       *   top one, keeping what was changed there; rank: higher shows above lower (the shared
       *   dialog: 1); base: the page itself, one layer below every other part's (see the header).
       * @returns {void}
       */
      add: function (part) { parts.push(part); },
      /**
       * After the page opened or closed a layer itself: bring the history in step.
       * @returns {void}
       */
      sync: function () {
        if (travelling && Date.now() - travelledAt > LANDS_WITHIN_MS) { travelling = false; }
        if (on && !stopped && !travelling && !closing) { align(true); }
      },
      /**
       * The page is leaving (a save, or the page closing itself): no more steps of its own, and Back
       * closes nothing, so no history.go() comes between the page and the navigation that closes it.
       * @returns {void}
       */
      stop: function () { stopped = true; }
    };
  }

  var api = create(typeof window !== 'undefined' ? window : null);
  api.create = create;
  PConf.backSteps = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

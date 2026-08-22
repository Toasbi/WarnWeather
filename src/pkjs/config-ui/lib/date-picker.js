// src/pkjs/config-ui/lib/date-picker.js — the date control, whole: the
// YYYY-MM-DD value helpers, the trigger/wheel/sheet renderers, and (via
// createDateWiring) the scroll-settle machinery that commits a wheel spin.
// Extracted from engine.js, which had grown two complete widget subsystems;
// the engine keeps only the dispatch entries and re-exports the helper names
// its consumers already import. Dual-context like the other lib files: PConf
// bridge in the concatenated page/test bundle, module.exports under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  var htmlLib = (typeof require !== 'undefined') ? require('./html.js') : PConf.html;
  var esc = htmlLib.esc;
  var sheetHeader = htmlLib.sheetHeader;
  var eachItem = (typeof require !== 'undefined')
    ? require('./schema-walk.js').eachItem : PConf.schemaWalk.eachItem;

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var MONTH_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  /**
   * @param {number} n Number to pad.
   * @returns {string} Two digits.
   */
  function datePad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * @param {Date} date Local date.
   * @returns {string} Local YYYY-MM-DD.
   */
  function formatDateValue(date) {
    return date.getFullYear() + '-' + datePad2(date.getMonth() + 1)
      + '-' + datePad2(date.getDate());
  }

  /**
   * @param {number} year Full year.
   * @param {number} month One-based month.
   * @returns {number} Real day count for the month.
   */
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /**
   * @param {*} value YYYY-MM-DD candidate.
   * @param {Date} [now] Local fallback date.
   * @returns {{year:number, month:number, day:number}} Valid parts.
   */
  function parseDateParts(value, now) {
    var fallback = now || new Date();
    var parts = typeof value === 'string' ? value.split('-') : [];
    if (parts.length === 3 && /^\d{4}$/.test(parts[0])
        && /^\d{2}$/.test(parts[1]) && /^\d{2}$/.test(parts[2])) {
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10);
      var day = parseInt(parts[2], 10);
      if (month >= 1 && month <= 12 && day >= 1
          && day <= daysInMonth(year, month)) {
        return { year: year, month: month, day: day };
      }
    }
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate()
    };
  }

  /**
   * Clamp a date-part object and serialize it.
   *
   * @param {{year:number, month:number, day:number}} parts Date parts.
   * @returns {string} Valid YYYY-MM-DD.
   */
  function dateValueFromParts(parts) {
    var month = Math.max(1, Math.min(12, parseInt(parts.month, 10) || 1));
    var year = parseInt(parts.year, 10) || new Date().getFullYear();
    var day = Math.max(1, parseInt(parts.day, 10) || 1);
    day = Math.min(day, daysInMonth(year, month));
    return year + '-' + datePad2(month) + '-' + datePad2(day);
  }

  /**
   * @param {Object} item Date schema item.
   * @param {{value:*, openDate:?string}} view Render state.
   * @returns {string} Whole-row date trigger.
   */
  function renderDateTrigger(item, view) {
    var p = parseDateParts(view.value);
    var label = p.day + ' ' + MONTH_SHORT[p.month - 1] + ' ' + p.year;
    var key = esc(item.messageKey);
    return '<button type="button" class="date-wrap" data-date="' + key
      + '" aria-label="' + esc(String(item.label || 'Date') + ': ' + label)
      + '" aria-haspopup="dialog" aria-expanded="'
      + (view.openDate === item.messageKey ? 'true' : 'false') + '"><span>'
      + esc(label) + '</span><svg viewBox="0 0 24 24" fill="none"'
      + ' stroke="currentColor" stroke-width="2" aria-hidden="true">'
      + '<rect x="3" y="5" width="18" height="16" rx="2"/>'
      + '<path d="M16 3v4M8 3v4M3 10h18"/></svg></button>';
  }

  /**
   * @param {string} part day|month|year.
   * @param {Array} values Numeric values.
   * @param {number} selected Selected numeric value.
   * @returns {string} One scroll-snap wheel.
   */
  function renderDateWheel(part, values, selected) {
    var h = '<div class="date-wheel" data-date-wheel="' + part + '">';
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      var label = part === 'month' ? MONTH_NAMES[value - 1] : String(value);
      h += '<button type="button" class="date-opt'
        + (value === selected ? ' on' : '') + '" data-date-value="' + value
        + '">' + esc(label) + '</button>';
    }
    return h + '</div>';
  }

  /**
   * @param {Object} schema Config schema.
   * @param {{S:Object, openDate:?string}} cx Render context.
   * @returns {string} Date sheet inner HTML or empty string.
   */
  function renderDateModal(schema, cx) {
    if (!cx.openDate) { return ''; }
    var found = null;
    eachItem(schema, function (it) {
      if (it.type === 'date' && it.messageKey === cx.openDate) { found = it; }
    });
    if (!found) { return ''; }
    var p = parseDateParts(cx.S[found.messageKey]);
    var days = [], months = [], years = [], i;
    for (i = 1; i <= daysInMonth(p.year, p.month); i++) { days.push(i); }
    for (i = 1; i <= 12; i++) { months.push(i); }
    var currentYear = new Date().getFullYear();
    var firstYear = Math.min(currentYear, p.year);
    var lastYear = Math.max(currentYear + 10, p.year);
    for (i = firstYear; i <= lastYear; i++) { years.push(i); }
    var key = esc(found.messageKey);
    var titleId = 'date-ttl-' + key;
    return sheetHeader(titleId, esc(found.label || 'Date'))
      + '<div class="date-picker"'
      + ' data-date-picker="' + key + '"><div class="date-band"></div>'
      + renderDateWheel('day', days, p.day)
      + renderDateWheel('month', months, p.month)
      + renderDateWheel('year', years, p.year) + '</div>';
  }

  /**
   * The boot-scoped half: the wheel scroll-settle machinery. One instance per
   * page boot; the ctx hands in the live accessors the glue needs — the engine
   * calls in (closeModal/open-trigger flushes, syncDialog's align, the modal
   * scroll listener), and nothing here reaches back except through ctx.
   *
   * @param {Object} ctx
   *   {Object} ctx.S Live settings state.
   *   {function(): ?string} ctx.getOpenDateKey The open date sheet's messageKey.
   *   {function(): void} ctx.render Full re-render.
   * @returns {{flushPending: Function, scheduleAlign: Function, onModalScroll: Function}}
   */
  function createDateWiring(ctx) {
    var S = ctx.S;
    // One pending settled-scroll sample per date wheel part. Separate entries prevent activity
    // in one wheel from canceling another wheel's still-pending selection.
    var pendingDateScrolls = {};
    // True while alignDateWheels() is programmatically writing wheel.scrollTop. Writing scrollTop
    // dispatches a 'scroll' event, which the wheel scroll handler would otherwise mistake for a user
    // scroll and answer with a settle -> render -> re-align, dispatching another scroll: an infinite
    // flicker loop. The handler bails while this is set; alignDateWheels clears it once the scroll
    // events its writes emit have flushed.
    var suppressWheelScroll = false;
    
    /**
     * Center each date wheel on its selected option.
     *
     * @param {Object} dlg Shared dialog element.
     * @returns {void}
     */
    function alignDateWheels(dlg) {
      var wheels = dlg.querySelectorAll('[data-date-wheel]');
      // Guard the scroll handler against the 'scroll' events these writes emit (see
      // suppressWheelScroll). Programmatic scrolls dispatch their scroll events before the next
      // animation frame, so clearing the flag one rAF later lets real user scrolls through again.
      suppressWheelScroll = true;
      for (var i = 0; i < wheels.length; i++) {
        var selected = wheels[i].querySelector('.date-opt.on');
        if (selected) {
          wheels[i].scrollTop = selected.offsetTop
            - (wheels[i].clientHeight - selected.offsetHeight) / 2;
        }
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { suppressWheelScroll = false; });
      } else {
        suppressWheelScroll = false;
      }
    }
    
    /**
     * Align after layout, and once after the opening animation when first shown.
     *
     * @param {Object} dlg Shared dialog element.
     * @param {boolean} opening Whether this render opened the dialog.
     * @returns {void}
     */
    function scheduleDateWheelAlign(dlg, opening) {
      // Center synchronously, before paint: render() rebuilds the wheels at scrollTop 0, and a
      // deferred (rAF) align let them paint top-aligned for a frame or two and then jump — the
      // reset "flash" seen on open and after every scroll settle. Reading offsetTop forces layout,
      // so the wheels are measurable here even though showModal() just displayed the dialog.
      alignDateWheels(dlg);
      // One post-layout re-align as a safety net for webviews that lay the freshly shown dialog out
      // a frame late; idempotent, so a no-op once the synchronous pass already landed.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { alignDateWheels(dlg); });
      }
      if (!opening) { return; }
      dlg.addEventListener('animationend', function once() {
        dlg.removeEventListener('animationend', once);
        alignDateWheels(dlg);
      });
    }
    
    /**
     * Find the wheel option nearest the visible center.
     *
     * @param {Object} wheel Date wheel element.
     * @returns {?number} Nearest numeric option value.
     */
    function nearestDateWheelValue(wheel) {
      var options = wheel.querySelectorAll('.date-opt');
      var center = wheel.scrollTop + wheel.clientHeight / 2;
      var nearest = null, distance = Infinity;
      for (var i = 0; i < options.length; i++) {
        var optionCenter = options[i].offsetTop + options[i].offsetHeight / 2;
        var candidate = Math.abs(optionCenter - center);
        if (candidate < distance) {
          distance = candidate;
          nearest = options[i];
        }
      }
      return nearest
        ? parseInt(nearest.getAttribute('data-date-value'), 10) : null;
    }
    
    /**
     * Commit and cancel every pending date wheel before a date render or close.
     * All selected parts are combined before clamping so the caller renders once.
     *
     * @returns {void}
     */
    function flushPendingDateScrolls() {
      var dateKey = ctx.getOpenDateKey();
      var parts = dateKey ? parseDateParts(S[dateKey]) : null;
      var names = ['day', 'month', 'year'];
      var hasSelection = false;
      for (var i = 0; i < names.length; i++) {
        var part = names[i];
        var pending = pendingDateScrolls[part];
        if (!pending) { continue; }
        clearTimeout(pending.timer);
        delete pendingDateScrolls[part];
        if (!parts || pending.dateKey !== dateKey) { continue; }
        var selected = nearestDateWheelValue(pending.wheel);
        if (selected != null) {
          parts[part] = selected;
          hasSelection = true;
        }
      }
      if (hasSelection) { S[dateKey] = dateValueFromParts(parts); }
    }

    /**
     * The #modal scroll listener (capture phase): arm a settle per wheel; the
     * settle commits the nearest value and re-renders.
     * @param {Event} e Scroll event.
     * @returns {void}
     */
    function onModalScroll(e) {
      if (suppressWheelScroll) { return; }   // ignore our own alignment scrolls; see the flag's decl
      var wheel = e.target.closest && e.target.closest('[data-date-wheel]');
      if (!wheel || !ctx.getOpenDateKey()) { return; }
      var part = wheel.getAttribute('data-date-wheel');
      if (part !== 'day' && part !== 'month' && part !== 'year') { return; }
      var dateKey = ctx.getOpenDateKey();
      var previous = pendingDateScrolls[part];
      if (previous) { clearTimeout(previous.timer); }
      var pending = { dateKey: dateKey, wheel: wheel, timer: null };
      pendingDateScrolls[part] = pending;
      pending.timer = setTimeout(function () {
        if (pendingDateScrolls[part] !== pending
            || ctx.getOpenDateKey() !== pending.dateKey) { return; }
        flushPendingDateScrolls();
        ctx.render();
      }, 120);
    }

    return {
      flushPending: flushPendingDateScrolls,
      scheduleAlign: scheduleDateWheelAlign,
      onModalScroll: onModalScroll
    };
  }

  PConf.datePicker = {
    MONTH_NAMES: MONTH_NAMES,
    formatDateValue: formatDateValue,
    parseDateParts: parseDateParts,
    dateValueFromParts: dateValueFromParts,
    renderDateTrigger: renderDateTrigger,
    renderDateWheel: renderDateWheel,
    renderDateModal: renderDateModal,
    createDateWiring: createDateWiring
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.datePicker; }
})();

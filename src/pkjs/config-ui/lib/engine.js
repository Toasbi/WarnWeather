// src/pkjs/config-ui/lib/engine.js — ES5. PConf.engine/blocks/hooks + module.exports.
var PConf = (typeof PConf !== 'undefined') ? PConf : {};
(function () {
  function intToHex(n) { return '#' + ('000000' + (n & 0xFFFFFF).toString(16)).slice(-6).toUpperCase(); }
  function eachItem(schema, fn) {
    schema.tabs.forEach(function (t) { t.sections.forEach(function (sec) { sec.items.forEach(function (it) { fn(it, sec, t); }); }); });
  }

  // --- block registry ---
  var blockMap = {};
  PConf.blocks = {
    register: function (id, fn) { blockMap[id] = fn; },
    get: function (id) { return blockMap[id]; }
  };

  // --- hook registry ---
  var loadFns = [], submitFns = [];
  PConf.hooks = {
    onLoad: function (fn) { loadFns.push(fn); },
    onSubmit: function (fn) { submitFns.push(fn); },
    runLoad: function (ctx) { loadFns.forEach(function (fn) { fn(ctx); }); },
    runSubmit: function (ctx) { submitFns.forEach(function (fn) { fn(ctx); }); }
  };

  function hydrate(schema, injected) {
    var S = {};
    eachItem(schema, function (it) {
      if (!it.messageKey || typeof it.defaultValue === 'undefined') { return; }
      S[it.messageKey] = (it.type === 'color' && typeof it.defaultValue === 'number') ? intToHex(it.defaultValue) : it.defaultValue;
    });
    return Object.assign(S, injected || {});
  }
  function serialize(schema, S) {
    var out = {};
    eachItem(schema, function (it) { if (it.messageKey && it.type !== 'staticText') { out[it.messageKey] = S[it.messageKey]; } });
    return out;
  }

  // 64-color Pebble palette (lifted from docs/superpowers/pebble-config/index.html:152)
  var PALETTE = (function () {
    var raw = ["000000","000055","0000AA","0000FF","005500","005555","0055AA","0055FF","00AA00","00AA55","00AAAA","00AAFF","00FF00","00FF55","00FFAA","00FFFF","550000","550055","5500AA","5500FF","555500","555555","5555AA","5555FF","55AA00","55AA55","55AAAA","55AAFF","55FF00","55FF55","55FFAA","55FFFF","AA0000","AA0055","AA00AA","AA00FF","AA5500","AA5555","AA55AA","AA55FF","AAAA00","AAAA55","AAAAAA","AAAAFF","AAFF00","AAFF55","AAFFAA","AAFFFF","FF0000","FF0055","FF00AA","FF00FF","FF5500","FF5555","FF55AA","FF55FF","FFAA00","FFAA55","FFAAAA","FFAAFF","FFFF00","FFFF55","FFFFAA","FFFFFF"];
    var out = [];
    for (var i = 0; i < raw.length; i++) { out.push('#' + raw[i]); }
    return out;
  })();

  function boot() {
    var SCHEMA = INJECTED_SCHEMA, ENV = INJECTED_ENV || { color: true, round: false, platform: '' };
    var USERDATA = INJECTED_USERDATA || {}, RETURN_TO = INJECTED_RETURN || 'pebblejs://close#';
    var S = hydrate(SCHEMA, INJECTED_CFG), INITIAL = Object.assign({}, S);
    var activeTab = SCHEMA.tabs[0].id, openColor = null, collapsed = {};
    function ctx() { var c = Object.assign({}, S); c.env = ENV; return c; }
    var hookCtx = { get: function (k) { return S[k]; }, set: function (k, v) { S[k] = v; }, getInitial: function (k) { return INITIAL[k]; } };

    // ctrl(item): build the HTML control for one schema item.
    // Maps schema type to the control markup from index.html:339-351.
    // options are [label, value] pairs; read o[0]=label, o[1]=value.
    function ctrl(item) {
      var v = S[item.messageKey], h = '', i, o;
      if (item.type === 'toggle') {
        return '<button class="sw' + (v ? ' on' : '') + '" data-k="' + item.messageKey + '" data-toggle="1"><i></i></button>';
      }
      if (item.type === 'segmented') {
        h = '<div class="seg">';
        for (i = 0; i < item.options.length; i++) {
          o = item.options[i];
          h += '<button class="' + (v === o[1] ? 'on' : '') + '" data-k="' + item.messageKey + '" data-v="' + o[1] + '">' + o[0] + '</button>';
        }
        return h + '</div>';
      }
      if (item.type === 'radio') {
        h = '<div class="radio">';
        for (i = 0; i < item.options.length; i++) {
          o = item.options[i];
          h += '<button class="' + (v === o[1] ? 'on' : '') + '" data-k="' + item.messageKey + '" data-v="' + o[1] + '"><span>' + o[0] + '</span><span class="dot"></span></button>';
        }
        return h + '</div>';
      }
      if (item.type === 'select') {
        h = '<select data-k="' + item.messageKey + '">';
        for (i = 0; i < item.options.length; i++) {
          o = item.options[i];
          h += '<option value="' + o[1] + '"' + (v === o[1] ? ' selected' : '') + '>' + o[0] + '</option>';
        }
        return h + '</select>';
      }
      if (item.type === 'text') {
        var ph = (item.attributes && item.attributes.placeholder) ? item.attributes.placeholder : '';
        return '<input type="text" data-k="' + item.messageKey + '" value="' + (v || '').replace(/"/g, '&quot;') + '" placeholder="' + ph + '">';
      }
      if (item.type === 'color') {
        h = '<div class="sw-wrap" data-color="' + item.messageKey + '"><b style="background:' + v + '"></b><span>' + String(v).toUpperCase() + '</span></div>';
        if (openColor === item.messageKey) {
          h += '<div class="palette">';
          for (i = 0; i < PALETTE.length; i++) {
            var hex = PALETTE[i];
            h += '<button class="' + (String(v).toUpperCase() === hex.toUpperCase() ? 'on' : '') + '" style="background:' + hex + '" data-k="' + item.messageKey + '" data-color-pick="' + hex + '"></button>';
          }
          h += '</div>';
        }
        return h;
      }
      return '';
    }

    // rowEl(item): wrap ctrl() in a row div with label/hint chrome.
    // Stacked layout for text, radio, color-open (index.html:355-362).
    function rowEl(item) {
      var hint = item.hintByValue ? (item.hintByValue[S[item.messageKey]] || item.hint) : item.hint;
      var stacked = item.type === 'text' || item.type === 'radio' || (item.type === 'color' && openColor === item.messageKey);
      var cls = 'row' + (stacked ? ' stack' : '');
      if (stacked) {
        return '<div class="' + cls + '"><div class="lbl">' + item.label + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '<div>' + ctrl(item) + '</div></div>';
      }
      return '<div class="' + cls + '"><div class="lft"><div class="lbl">' + item.label + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div><div class="rgt">' + ctrl(item) + '</div></div>';
    }

    // render(): rebuild tabs + body from SCHEMA state.
    // Adapted from index.html:364-380 but SCHEMA-driven.
    function render() {
      // tabs from SCHEMA.tabs
      var tabsEl = document.getElementById('tabs');
      var tabHtml = '';
      for (var tabi = 0; tabi < SCHEMA.tabs.length; tabi++) {
        var tab = SCHEMA.tabs[tabi];
        tabHtml += '<button class="tab' + (activeTab === tab.id ? ' on' : '') + '" data-tab="' + tab.id + '">' + tab.label + '</button>';
      }
      tabsEl.innerHTML = tabHtml;

      // collect sections for active tab
      var bodyHtml = '';
      for (var seci = 0; seci < SCHEMA.tabs.length; seci++) {
        var t = SCHEMA.tabs[seci];
        if (t.id !== activeTab) { continue; }
        for (var si = 0; si < t.sections.length; si++) {
          var sec = t.sections[si];
          var secId = sec.id || sec.title;

          // build section body
          var body = '';
          if (sec.intro) { body += '<div class="intro">' + sec.intro + '</div>'; }

          // render visible items
          var visibleCount = 0;
          var staticTextCount = 0;
          var ctxNow = ctx();
          for (var ii = 0; ii < sec.items.length; ii++) {
            var item = sec.items[ii];
            // staticText: emit verbatim text, wrapped for consistent padding
            // (still honor showWhen so a static note can be platform/state-gated)
            if (item.type === 'staticText') {
              if (!PConf.showWhen.isVisible(item, ctxNow)) { continue; }
              body += '<div class="static">' + (item.text || '') + '</div>';
              staticTextCount++;
              continue;
            }
            // skip hidden items
            if (!PConf.showWhen.isVisible(item, ctxNow)) { continue; }
            visibleCount++;
            // item-level blockBefore: render its data inline, directly above this control
            if (item.blockBefore) {
              var pbfn = PConf.blocks.get(item.blockBefore);
              var pbHtml = pbfn ? pbfn(S, ENV, USERDATA) : '';
              if (pbHtml) { body += '<div class="blockrow">' + pbHtml + '</div>'; }
            }
            body += rowEl(item);
            // item-level block: render its data inline, directly under this control
            if (item.block) {
              var ibfn = PConf.blocks.get(item.block);
              var ibHtml = ibfn ? ibfn(S, ENV, USERDATA) : '';
              if (ibHtml) { body += '<div class="blockrow">' + ibHtml + '</div>'; }
            }
          }

          // block injection
          var blockHtml = '';
          if (sec.block) {
            var bfn = PConf.blocks.get(sec.block);
            blockHtml = bfn ? bfn(S, ENV, USERDATA) : '';
            body += blockHtml;
          }

          // skip section card if genuinely empty: no intro, no visible control items,
          // no staticText content, and block returned ''
          if (!sec.intro && visibleCount === 0 && staticTextCount === 0 && blockHtml === '') { continue; }

          // section header
          var isCollapsible = Boolean(sec.collapsible);
          var isOpen = isCollapsible ? !collapsed[secId] : true;
          var hdr = '<button class="cardHdr' + (isCollapsible ? ' coll' : '') + '"' + (isCollapsible ? ' data-coll="' + secId + '"' : '') + '><span class="ttl">' + sec.title + '</span>' + (isCollapsible ? '<span class="chev">' + (isOpen ? '&#9662;' : '&#9656;') + '</span>' : '') + '</button>';

          bodyHtml += '<div class="card">' + hdr + (isOpen ? '<div>' + body + '</div>' : '') + '</div>';
        }
      }

      // version label at bottom
      bodyHtml += '<div class="version">' + (SCHEMA.versionLabel || '') + '</div>';

      document.getElementById('scroll').innerHTML = bodyHtml;
    }

    // set appName into #appTitle
    if (typeof document !== 'undefined' && document.getElementById('appTitle')) {
      document.getElementById('appTitle').textContent = SCHEMA.appName;
    }
    PConf.hooks.runLoad(hookCtx);

    // event delegation — tabs
    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { activeTab = b.getAttribute('data-tab'); openColor = null; render(); }
    });

    // event delegation — scroll (click)
    document.getElementById('scroll').addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-toggle]'))) { S[t.getAttribute('data-k')] = !S[t.getAttribute('data-k')]; render(); return; }
      if ((t = e.target.closest('[data-color-pick]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-color-pick'); openColor = null; render(); return; }
      if ((t = e.target.closest('[data-color]'))) { var k = t.getAttribute('data-color'); openColor = (openColor === k ? null : k); render(); return; }
      if ((t = e.target.closest('[data-v]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-v'); render(); return; }
      if ((t = e.target.closest('[data-coll]'))) { var sid = t.getAttribute('data-coll'); collapsed[sid] = !collapsed[sid]; render(); return; }
    });

    // event delegation — scroll (change: select)
    document.getElementById('scroll').addEventListener('change', function (e) {
      var sel = e.target.closest('select');
      if (sel) { S[sel.getAttribute('data-k')] = sel.value; render(); }
    });

    // event delegation — scroll (input: text)
    document.getElementById('scroll').addEventListener('input', function (e) {
      var inp = e.target.closest('input[type=text]');
      if (inp) { S[inp.getAttribute('data-k')] = inp.value; }
    });

    // save button
    document.getElementById('save').addEventListener('click', function () {
      PConf.hooks.runSubmit(hookCtx);
      var blob = serialize(SCHEMA, S);
      document.getElementById('toast').classList.add('show');
      setTimeout(function () { location.href = RETURN_TO + encodeURIComponent(JSON.stringify(blob)); }, 300);
    });

    render();
  }

  PConf.engine = { serialize: serialize, hydrate: hydrate, boot: boot };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { serialize: PConf.engine.serialize, hydrate: PConf.engine.hydrate, boot: PConf.engine.boot, blocks: PConf.blocks, hooks: PConf.hooks };
}

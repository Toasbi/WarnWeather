// src/pkjs/config-ui/lib/engine.js — ES5. PConf.engine/blocks/hooks + module.exports.
// Pure render helpers live at module scope (unit-testable); boot() owns live state + DOM wiring.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  // Shared single-source helpers: PConf.color / PConf.schemaWalk are concatenated before this
  // file in the page, and required first by the Node tests. No local re-implementation.
  var intToHex = PConf.color.intToHex;
  var eachItem = PConf.schemaWalk.eachItem;

  // HTML-escape author/user text interpolated into innerHTML. NOT applied to fields documented as
  // HTML (intro, hint, staticText.text, versionLabel) — those are intentional markup.
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  // ---- control renderers: each takes (item, value[, openColor]) -> HTML string.
  // options are [label, value] pairs; read o[0]=label, o[1]=value.
  function optionButtons(item, v, isRadio) {
    var h = '', i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      var inner = isRadio ? '<span>' + esc(o[0]) + '</span><span class="dot"></span>' : esc(o[0]);
      h += '<button class="' + (v === o[1] ? 'on' : '') + '" data-k="' + item.messageKey + '" data-v="' + esc(o[1]) + '">' + inner + '</button>';
    }
    return h;
  }
  function renderToggle(item, v) {
    return '<button class="sw' + (v ? ' on' : '') + '" data-k="' + item.messageKey + '" data-toggle="1"><i></i></button>';
  }
  function renderSegmented(item, v) { return '<div class="seg">' + optionButtons(item, v, false) + '</div>'; }
  function renderRadio(item, v) { return '<div class="radio">' + optionButtons(item, v, true) + '</div>'; }
  function renderSelect(item, v) {
    var h = '<select data-k="' + item.messageKey + '">', i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      h += '<option value="' + esc(o[1]) + '"' + (v === o[1] ? ' selected' : '') + '>' + esc(o[0]) + '</option>';
    }
    return h + '</select>';
  }
  // Filtered option rows for an open searchSelect list. Case-insensitive substring match on the
  // option label OR its value code; '' query -> all. The current value's row gets .on + a check.
  function renderSelectOptions(item, value, query) {
    var q = String(query || '').toLowerCase(), h = '', i, o, hay, shown = 0;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      hay = (o[0] + ' ' + o[1]).toLowerCase();
      if (q && hay.indexOf(q) === -1) { continue; }
      h += '<button class="ssel-opt' + (value === o[1] ? ' on' : '') + '" data-select-pick="' + esc(o[1]) + '" data-k="' + esc(item.messageKey) + '">'
        + '<span>' + esc(o[0]) + '</span>' + (value === o[1] ? '<span class="ssel-chk">&#10003;</span>' : '') + '</button>';
      shown++;
    }
    return shown ? h : '<div class="ssel-none">No matches</div>';
  }
  function renderText(item, v) {
    var ph = (item.attributes && item.attributes.placeholder) ? esc(item.attributes.placeholder) : '';
    return '<input type="text" data-k="' + item.messageKey + '" value="' + esc(v || '') + '" placeholder="' + ph + '">';
  }
  function renderColor(item, v, openColor) {
    var disp = String(v).toUpperCase();
    var h = '<div class="sw-wrap" data-color="' + item.messageKey + '"><b style="background:' + esc(v) + '"></b><span>' + esc(disp) + '</span></div>';
    if (openColor === item.messageKey) {
      h += '<div class="palette">';
      for (var i = 0; i < PALETTE.length; i++) {
        var hex = PALETTE[i];
        h += '<button class="' + (disp === hex.toUpperCase() ? 'on' : '') + '" style="background:' + hex + '" data-k="' + item.messageKey + '" data-color-pick="' + hex + '"></button>';
      }
      h += '</div>';
    }
    return h;
  }
  var CONTROLS = {
    toggle: function (item, view) { return renderToggle(item, view.value); },
    segmented: function (item, view) { return renderSegmented(item, view.value); },
    radio: function (item, view) { return renderRadio(item, view.value); },
    select: function (item, view) { return renderSelect(item, view.value); },
    text: function (item, view) { return renderText(item, view.value); },
    color: function (item, view) { return renderColor(item, view.value, view.openColor); }
  };
  // view = { value, openColor }
  function renderControl(item, view) {
    var fn = CONTROLS[item.type];
    return fn ? fn(item, view) : '';
  }

  // Wrap a control in a row with label/hint chrome. Stacked for text/radio/open-color.
  // noDivider appends the nb modifier so the row paints no bottom divider (used by joinPrevious).
  function renderRow(item, view, noDivider) {
    var hint = item.hintByValue ? (item.hintByValue[view.value] || item.hint) : item.hint;
    var stacked = item.type === 'text' || item.type === 'radio' || (item.type === 'color' && view.openColor === item.messageKey);
    var hintHtml = hint ? '<div class="hint">' + hint + '</div>' : '';
    var label = '<div class="lbl">' + esc(item.label) + '</div>';
    var rowCls = 'row' + (stacked ? ' stack' : '') + (noDivider ? ' nb' : '');
    if (stacked) {
      return '<div class="' + rowCls + '">' + label + hintHtml + '<div>' + renderControl(item, view) + '</div></div>';
    }
    return '<div class="' + rowCls + '"><div class="lft">' + label + hintHtml + '</div><div class="rgt">' + renderControl(item, view) + '</div></div>';
  }

  // Render a registered block by id, wrapped in .blockrow ('.blockrow sticky' when sticky).
  // '' if unregistered or empty.
  function renderBlock(id, S, ENV, USERDATA, sticky) {
    if (!id) { return ''; }
    var fn = PConf.blocks.get(id);
    var html = fn ? fn(S, ENV, USERDATA) : '';
    return html ? '<div class="blockrow' + (sticky ? ' sticky' : '') + '">' + html + '</div>' : '';
  }

  // Render one schema item honoring showWhen. Returns { html, kind } with kind in
  // 'control' | 'static' | 'hidden' so the section can decide if the card is empty.
  function renderItem(item, view, cx, noDivider) {
    if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { return { html: '', kind: 'hidden' }; }
    if (item.type === 'staticText') {
      // a joinPrevious static acts as the control's description, so the join modifier tightens its
      // top spacing to hug the row above (like a hint) instead of standing off as a separate block.
      var staticCls = 'static' + (item.joinPrevious ? ' join' : '') + (noDivider ? ' nb' : '');
      return { html: '<div class="' + staticCls + '">' + (item.text || '') + '</div>', kind: 'static' };
    }
    var html = renderBlock(item.blockBefore, cx.S, cx.ENV, cx.USERDATA, item.blockBeforeSticky)
      + renderRow(item, view, noDivider)
      + renderBlock(item.block, cx.S, cx.ENV, cx.USERDATA);
    return { html: html, kind: 'control' };
  }

  // Render a run of consecutive items sharing the same inline group id as a single side-by-side
  // row (one bottom divider, no internal dividers). Each visible member becomes a compact
  // label+control cell. Inline members don't carry hints/blocks. Returns { html, controlCount };
  // controlCount is the number of visible cells (0 -> nothing rendered, group hidden).
  function renderInlineGroup(items, cx, noDivider) {
    var cells = '', visible = 0, i, item, view;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { continue; }
      view = { value: cx.S[item.messageKey], openColor: cx.openColor };
      cells += '<div class="icell"><div class="lbl">' + esc(item.label) + '</div>' + renderControl(item, view) + '</div>';
      visible++;
    }
    if (!visible) { return { html: '', controlCount: 0 }; }
    return { html: '<div class="row inline' + (noDivider ? ' nb' : '') + '">' + cells + '</div>', controlCount: visible };
  }

  // Look-ahead from index "from": does the next *visible* item carry joinPrevious? Such an item
  // wants no divider between it and the row above, so the preceding visible row drops its divider.
  // Skips hidden items so the divider returns automatically when the joining group is hidden.
  function nextVisibleJoins(items, from, cx) {
    var j;
    for (j = from; j < items.length; j++) {
      if (PConf.showWhen.isVisible(items[j], cx.evalCtx)) { return Boolean(items[j].joinPrevious); }
    }
    return false;
  }

  function renderCardHeader(sec, secId, isCollapsible, isOpen) {
    if (!(sec.title || isCollapsible)) { return ''; }
    var chev = isCollapsible ? '<span class="chev">' + (isOpen ? '&#9662;' : '&#9656;') + '</span>' : '';
    var collAttr = isCollapsible ? ' data-coll="' + esc(secId) + '"' : '';
    return '<button class="cardHdr' + (isCollapsible ? ' coll' : '') + '"' + collAttr + '>'
      + '<span class="ttl">' + esc(sec.title || '') + '</span>' + chev + '</button>';
  }

  // Render one section card. '' when empty (no intro, no visible control/static items, no block).
  function renderSection(sec, cx) {
    var secId = sec.id || sec.title;
    var body = sec.intro ? '<div class="intro">' + sec.intro + '</div>' : '';
    var controlCount = 0, staticCount = 0, i;
    for (i = 0; i < sec.items.length; i++) {
      var item = sec.items[i];
      if (item.inline) {
        // gather the consecutive run sharing this inline group id, render it as one row
        var run = [item];
        while (i + 1 < sec.items.length && sec.items[i + 1].inline === item.inline) { run.push(sec.items[i + 1]); i++; }
        var g = renderInlineGroup(run, cx, nextVisibleJoins(sec.items, i + 1, cx));
        controlCount += g.controlCount;
        body += g.html;
        continue;
      }
      var view = { value: cx.S[item.messageKey], openColor: cx.openColor };
      var r = renderItem(item, view, cx, nextVisibleJoins(sec.items, i + 1, cx));
      if (r.kind === 'control') { controlCount++; }
      else if (r.kind === 'static') { staticCount++; }
      body += r.html;
    }
    var blockHtml = renderBlock(sec.block, cx.S, cx.ENV, cx.USERDATA);
    body += blockHtml;
    if (!sec.intro && controlCount === 0 && staticCount === 0 && blockHtml === '') { return ''; }
    var isCollapsible = Boolean(sec.collapsible);
    var isOpen = isCollapsible ? !cx.collapsed[secId] : true;
    var hdr = renderCardHeader(sec, secId, isCollapsible, isOpen);
    return '<div class="card' + (hdr ? '' : ' nohdr') + '">' + hdr + (isOpen ? '<div>' + body + '</div>' : '') + '</div>';
  }

  // Seed the collapsed-state map so collapsible sections start collapsed by default. The toggle
  // handler flips entries (true->open->true), so seeding true means the first click expands.
  function initialCollapsed(schema) {
    var map = {}, ti, si, sec, tabs = schema.tabs || [];
    for (ti = 0; ti < tabs.length; ti++) {
      for (si = 0; si < tabs[ti].sections.length; si++) {
        sec = tabs[ti].sections[si];
        if (sec.collapsible) { map[sec.id || sec.title] = true; }
      }
    }
    return map;
  }

  function renderTabBar(schema, activeTab) {
    var h = '', i, tab;
    for (i = 0; i < schema.tabs.length; i++) {
      tab = schema.tabs[i];
      h += '<button class="tab' + (activeTab === tab.id ? ' on' : '') + '" data-tab="' + esc(tab.id) + '">' + esc(tab.label) + '</button>';
    }
    return h;
  }

  // Pure: full scroll-body HTML for the active tab.
  // cx = { S, ENV, USERDATA, openColor, collapsed, evalCtx }
  function renderBody(schema, activeTab, cx) {
    var h = '', ti, si;
    for (ti = 0; ti < schema.tabs.length; ti++) {
      var t = schema.tabs[ti];
      if (t.id !== activeTab) { continue; }
      for (si = 0; si < t.sections.length; si++) { h += renderSection(t.sections[si], cx); }
    }
    return h + '<div class="version">' + (schema.versionLabel || '') + '</div>';
  }

  function boot() {
    var SCHEMA = INJECTED_SCHEMA, ENV = INJECTED_ENV || { color: true, round: false, platform: '' };
    var USERDATA = INJECTED_USERDATA || {}, RETURN_TO = INJECTED_RETURN || 'pebblejs://close#';
    var S = hydrate(SCHEMA, INJECTED_CFG), INITIAL = Object.assign({}, S);
    var activeTab = SCHEMA.tabs[0].id, openColor = null, collapsed = initialCollapsed(SCHEMA);
    // evalCtx(): the {settings..., env} object showWhen predicates evaluate against.
    function evalCtx() { var c = Object.assign({}, S); c.env = ENV; return c; }
    var hookCtx = { get: function (k) { return S[k]; }, set: function (k, v) { S[k] = v; }, getInitial: function (k) { return INITIAL[k]; } };

    // boot() requires the DOM; it is never called from Node tests (which exercise the pure
    // helpers above), so DOM access here is unguarded by design.
    function render() {
      var cx = { S: S, ENV: ENV, USERDATA: USERDATA, openColor: openColor, collapsed: collapsed, evalCtx: evalCtx() };
      document.getElementById('tabs').innerHTML = renderTabBar(SCHEMA, activeTab);
      document.getElementById('scroll').innerHTML = renderBody(SCHEMA, activeTab, cx);
    }

    document.getElementById('appTitle').textContent = SCHEMA.appName;
    PConf.hooks.runLoad(hookCtx);

    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { activeTab = b.getAttribute('data-tab'); openColor = null; render(); }
    });
    document.getElementById('scroll').addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-toggle]'))) { S[t.getAttribute('data-k')] = !S[t.getAttribute('data-k')]; render(); return; }
      if ((t = e.target.closest('[data-color-pick]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-color-pick'); openColor = null; render(); return; }
      if ((t = e.target.closest('[data-color]'))) { var k = t.getAttribute('data-color'); openColor = (openColor === k ? null : k); render(); return; }
      if ((t = e.target.closest('[data-v]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-v'); render(); return; }
      if ((t = e.target.closest('[data-coll]'))) { var sid = t.getAttribute('data-coll'); collapsed[sid] = !collapsed[sid]; render(); return; }
    });
    document.getElementById('scroll').addEventListener('change', function (e) {
      var sel = e.target.closest('select');
      if (sel) { S[sel.getAttribute('data-k')] = sel.value; render(); }
    });
    document.getElementById('scroll').addEventListener('input', function (e) {
      var inp = e.target.closest('input[type=text]');
      if (inp) { S[inp.getAttribute('data-k')] = inp.value; }
    });
    document.getElementById('save').addEventListener('click', function () {
      PConf.hooks.runSubmit(hookCtx);
      var blob = serialize(SCHEMA, S);
      document.getElementById('toast').classList.add('show');
      setTimeout(function () { location.href = RETURN_TO + encodeURIComponent(JSON.stringify(blob)); }, 300);
    });

    render();
  }

  PConf.engine = {
    serialize: serialize, hydrate: hydrate, boot: boot, initialCollapsed: initialCollapsed,
    esc: esc, renderControl: renderControl, renderRow: renderRow, renderSelectOptions: renderSelectOptions,
    renderTabBar: renderTabBar, renderBody: renderBody
  };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    serialize: PConf.engine.serialize, hydrate: PConf.engine.hydrate, boot: PConf.engine.boot,
    initialCollapsed: PConf.engine.initialCollapsed,
    blocks: PConf.blocks, hooks: PConf.hooks,
    esc: PConf.engine.esc, renderControl: PConf.engine.renderControl, renderRow: PConf.engine.renderRow,
    renderSelectOptions: PConf.engine.renderSelectOptions,
    renderTabBar: PConf.engine.renderTabBar, renderBody: PConf.engine.renderBody
  };
}

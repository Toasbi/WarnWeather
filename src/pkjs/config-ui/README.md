# pebble-config-ui

A declarative, extensible config-UI library for Pebble apps — a modern, reusable Clay replacement.

Renders a tabbed settings page from a declarative schema, with full Clay feature parity (all
control types, COLOR-capability filtering, defaults, conditional visibility) plus an extension model
based on registries rather than imperative hooks. The library carries zero app-specific knowledge;
each consuming app supplies its schema, custom blocks, and hooks.

---

## Contents

1. [Installation](#installation)
2. [Using it in your app](#using-it-in-your-app)
3. [Public API](#public-api)
   - [createConfig](#createconfig)
   - [Re-exported helpers](#re-exported-helpers)
4. [Schema format](#schema-format)
   - [Top level](#top-level)
   - [Tabs, sections, items](#tabs-sections-items)
   - [Item types](#item-types)
   - [Section and item fields](#section-and-item-fields)
   - [showWhen predicate grammar](#showwhen-predicate-grammar)
   - [Environment facts (env)](#environment-facts-env)
   - [Hidden-item serialization rule](#hidden-item-serialization-rule)
5. [Registries and hooks](#registries-and-hooks)
   - [Block registry — PConf.blocks](#block-registry--pconfblocks)
   - [Icon registry — PConf.icons](#icon-registry--pconficons)
   - [Options-resolver registry — PConf.optionsResolvers](#options-resolver-registry--pconfoptionsresolvers)
   - [Defaults-resolver registry — PConf.defaultsResolvers](#defaults-resolver-registry--pconfdefaultsresolvers)
   - [Display-resolver registry — PConf.displayResolvers](#display-resolver-registry--pconfdisplayresolvers)
   - [Hint-resolver registry — PConf.hintResolvers](#hint-resolver-registry--pconfhintresolvers)
   - [Attention-resolver registry — PConf.attentionResolvers](#attention-resolver-registry--pconfattentionresolvers)
   - [When-resolver registry — PConf.whenResolvers](#when-resolver-registry--pconfwhenresolvers)
   - [Action registry — PConf.actions](#action-registry--pconfactions)
   - [Hook registry — PConf.hooks](#hook-registry--pconfhooks)
6. [Build step — buildPage](#build-step--buildpage)
7. [Clay compatibility](#clay-compatibility)
8. [Lift-out / extraction note](#lift-out--extraction-note)
9. [ES5 constraint](#es5-constraint)

---

## Installation

Currently consumed locally (not yet published to npm — see [Lift-out](#lift-out--extraction-note)).

```js
var configUi = require('../config-ui');
```

---

## Using it in your app

Three files are your side of the boundary: a schema, a set of registered blocks/hooks, and one
index that creates the singleton instance.

```js
// src/pkjs/settings/index.js
var configUi = require('../config-ui');
var schema   = require('./schema.js');
var page     = require('./page.generated.js');   // built artifact (see Build step)

module.exports = configUi.createConfig({ schema: schema, page: page, options: {} });
```

```js
// src/pkjs/index.js — showing configuration
var settings = require('./settings');

Pebble.addEventListener('showConfiguration', function () {
  var userData = {
    lastFetchSuccess: localStorage.getItem('lastFetchSuccess'),
    lastFetchAttempt: localStorage.getItem('lastFetchAttempt')
  };
  Pebble.openURL(
    settings.generateUrl({
      values:    JSON.parse(localStorage.getItem('clay-settings') || '{}'),
      watchInfo: Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null,
      userData:  userData,
      returnTo:  'pebblejs://close#'
    })
  );
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) { return; }
  var blob = settings.getSettings(e.response);
  // use blob …
});
```

Register your custom blocks and hooks in browser-side files (concatenated into the page at build
time — see [Build step](#build-step--buildpage)):

```js
// src/pkjs/settings/preview-forecast.js  (runs in the phone WebView)
PConf.blocks.register('forecastPreview', function (state, env, userData) {
  return '<svg …>' + /* render from state */ + '</svg>';
});

PConf.blocks.register('devStats', function (state, env, userData) {
  if (!state.devStatsEnabled) { return ''; }
  return '<table …>' + /* render events from userData.devStats */ + '</table>';
});
```

```js
// src/pkjs/settings/onbuild.js  (runs in the phone WebView)
PConf.hooks.onLoad(function (ctx) {
  ctx.set('fetch', false);
  ctx.set('devStatsClear', false);
});

PConf.hooks.onSubmit(function (ctx) {
  if (ctx.get('provider') !== ctx.getInitial('provider') ||
      ctx.get('location') !== ctx.getInitial('location')) {
    ctx.set('fetch', true);
  }
});
```

---

## Public API

### createConfig

```js
var instance = configUi.createConfig({ schema, page, options });
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | Object | The app's declarative schema (tabs/sections/items). See [Schema format](#schema-format). |
| `page` | String | The built HTML page string (output of `buildPage`). Required; loaded lazily inside `generateUrl`. |
| `options` | Object | Optional instance-level overrides (see below). |

**`options` fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `storage` | ambient `localStorage` | Storage object implementing `getItem`/`setItem`. Override for testing or non-browser hosts. |
| `storageKey` | `'clay-settings'` | localStorage key for the settings blob. Matches Clay's default. |
| `emulatorConfigUrl` | `null` | Hosted helper URL for emulator testing. When set and running under the pypkjs emulator, `generateUrl` routes through it (page in the URL `#hash`, `$$RETURN_TO$$` placeholder) instead of a `data:` URL, since a desktop browser blocks navigating the top frame to `data:`. See `test/emulator-url.test.js`. |

**Returns** an instance object:

```
{
  generateUrl(opts)        → string          // data: URL to pass to Pebble.openURL
  parseResponse(str)       → Object          // raw webviewclosed response → flat blob (colors as ints)
  getDefaults()            → Object          // schema default values (colors as ints)
  isColorKey(key)          → boolean         // true if the key maps to a color item
  getSettings(str)         → Object          // parseResponse + persist to storage + return blob
  setSettings(key, value)                    // read-modify-write the stored blob
  setSettings(object)                        // merge an object into the stored blob
  meta: { userData: {} }                     // mutable; populated by the app before generateUrl
}
```

**`generateUrl(opts)` — options:**

| Field | Default | Description |
|-------|---------|-------------|
| `values` | read from storage | Flat settings blob to inject into the page (colors as ints). |
| `watchInfo` | `Pebble.getActiveWatchInfo()` | Raw watch info; the library computes `env` from it. |
| `userData` | `instance.meta.userData` | Passed to block renderers and hooks. |
| `returnTo` | `'pebblejs://close#'` | URL the page navigates to on save. |
| `env` | computed from `watchInfo` | Extra env facts, **merged over** the computed env. For facts the library cannot derive from `watchInfo` (phone-runtime capabilities), and for test overrides. |

Color conversion (`int ↔ hex`) is handled internally. The app always works in int-valued blobs;
the page always works in hex strings; the library converts at the boundary.

### Re-exported helpers

These pure functions are re-exported at the library's top level for use by PKJS-parsed app code
that needs them without creating a full config instance.

```js
var configUi = require('../config-ui');

// Platform facts
configUi.isColorPlatform(platform)          // boolean — false for aplite/diorite/flint
configUi.isThemePolarityPlatform(platform)  // boolean — false for aplite (no light/B&W-Inv theme)
configUi.computeEnv(watchInfo)              // { color, round, platform, … } — null-safe

// Color conversion (ES5-safe; no padStart)
configUi.intToHex(n)                 // 0xFFFFFF → '#FFFFFF'
configUi.hexToInt(h)                 // '#FFFFFF' → 16777215

// Schema introspection
configUi.deriveDefaults(schema)      // { messageKey: defaultValue, … } — colors as ints;
                                     // `defaultFrom` items are left out (resolved per watch)
configUi.deriveColorKeys(schema)     // ['key', …] — all type:'color' messageKeys

// Page injection
configUi.inlineScriptJson(value)     // JSON.stringify with '<', U+2028/2029 escaped — safe to
                                     // splice into the page's inline <script> (generateUrl and
                                     // scripts/build-page.js previewPage both use it)
```

---

## Schema format

### Top level

```js
module.exports = {
  appName:      "MyApp",
  versionLabel: "v1.0.0",
  themeKey:     "configTheme",   // optional: messageKey of an 'auto'|'light'|'dark' setting
  infoIconsKey: "hideInfoText",  // optional: messageKey of a toggle that puts info text behind '?'
  tabs: [ /* Tab, … */ ]
};
```

`themeKey` (optional) names a setting whose value (`'auto' | 'light' | 'dark'`) drives the page
theme. `'auto'` follows `prefers-color-scheme`; a missing `matchMedia` or `var()` support falls
back to dark. Omit `themeKey` and the page stays dark (base theme). Support floor: correct
rendering ~Chromium 84+, theming from Chromium 49; below that the page stays dark and readable
via literal fallbacks.

`infoIconsKey` (optional) names a page-only toggle: while it is `true`, row hints and card and
dialog intros sit behind small '?' buttons (see *Info text, in view or behind '?'* below); off or
omitted, they show in place.

### Tabs, sections, items

```
Schema
  └─ tabs[]
       ├─ id            string  (unique)
       ├─ label         string  (tab bar text)
       ├─ showWhen      Predicate (false: no tab button, no body, no tab link lands there)
       ├─ pinBlock      string  (block id pinned at the top of the tab while its cards scroll)
       ├─ panes         [{id, label, showWhen?, pinBlock?}] (a segmented switcher; see Panes)
       └─ sections[]
            ├─ title        string
            ├─ intro        string  (HTML — the card's info text; behind its header's '?' in the '?' mode)
            ├─ block        string  (custom-block id — rendered below the items)
            ├─ collapsible  boolean (renders section as a collapsible card)
            ├─ titleFrom    {resolver, args?} (collapsed-header value; see Section fields)
            ├─ groupCard    string  (consecutive sections sharing an id merge into one card)
            ├─ pane         string  (renders only while its tab shows that pane)
            ├─ sheetOnly / sheetId  (a full-screen dialog, not a card; see Dialogs)
            ├─ pinBlock     string  (sheetOnly only: block pinned under the dialog's header)
            └─ items[]
                 └─ (see Item fields below; blockBefore is ITEM-level)
```

A section renders as one or more **cards**: every visible `subheader` item opens a new card
titled by its text (see Progressive disclosure), so one section can hold a card per group.

### Item types

| `type` | UI element | Wire format | Clay equivalent |
|--------|-----------|-------------|-----------------|
| `toggle` | Switch | `true`/`false` | `toggle` |
| `select` | Dropdown | string | `select` |
| `segmented` | Pill-row (new) | string | `select` (visual variant) |
| `radio` | Stacked radio buttons | string | `radiogroup` |
| `color` | Color palette — the 64 Pebble swatches | hex string on wire; **int** in the persisted blob | `color` |
| `text` | Text input | string | `input` |
| `staticText` | Static HTML block; no key | — (not serialized) | `text` |
| `searchSelect` | Dropdown sheet with a search box | string | — |
| `range` | Dual-thumb slider (one thumb with `single: true`) | `"lo-hi"` string (`single`: a plain integer string, `"10"`) | — |
| `rgb` | Three channel sliders (R/G/B) + live swatch | `"r,g,b"` string, each channel 0-255 | — |
| `date` | Date-wheel sheet (day/month/year) | `"YYYY-MM-DD"` string | — |
| `hidden` | none — never rendered | any (serialized like any keyed item) | — |
| `button` | Tappable action row; no key | — (not serialized) | — |
| `subheader` | In-section group header; no key | — (not serialized) | — |
| `sheet` | Tappable row that opens a `sheetOnly` section; no key | — (not serialized) | — |
| `checklist` | A grid of ticks for one code (`check`): a plain row per option, a tick per column, joined under one sub-header; a tap goes to the `writeWith` writer | — (not serialized: the ticks show other items' lists) | — |
| `readout` | Label (+ `icon`) and a live hint; no control, no key | — (not serialized) | — |

A `sheet` item is a **nav row**: the whole row is the tap target (`role="button"`, Enter and
Space tap it) and opens its dialog; its label leads, its summary sits under the label and a
chevron (›) closes the row on the right. The summary is the row's static `hint` or a
`hintFrom` resolver's answer — the live state of the settings behind it ("Off", or their
current levels) — and, unlike a value row's hint, it is always in view (no '?'). The resolver
gets no row value (`args.value` is `undefined` — the row stores nothing) and reads whatever it
describes from `S`. `summaryFaintFrom` (a showWhen predicate) dims the summary while it holds
(e.g. "Not in any status bar"). `navNote` prints a short muted note before the chevron ("Alerts",
a count). `labelFrom: {resolver, args}` (a hint resolver) derives the label from the settings
("Tomorrow.io API key" for the picked provider). The dialog comes from `sheetId`, or from
`editSheetFrom` (a sheet resolver — the row hides itself while it answers none). Give it an
`editBadgeFrom: { resolver, args }` — a named resolver `fn(S, env, args)` returning `null` or
`{label?, ariaNote?, chip?, dots: [{color, ring?}]}`, registered on `PConf.badgeResolvers` — and
the badge's colour preview leads the chevron. Because the row has no `messageKey`, whatever a
resolver needs to identify the row must be passed in its args. A summary is not repainted in
place after a range nudge (it has no key to be found by); the dialog the nudge happens in
re-renders the page when it closes.

A `button` item is the same nav row, dispatching `action` (or, with `gotoTab: '<tab id>'`,
bringing that tab to the front like a tab link); with `style: 'link'` it is a single line of
link-coloured text instead (a reset). A status-slot select keeps its own per-value dialog
behind an **Edit** button beside the dropdown (`editSheetFrom` on a value row).

The preview comes in two shapes, chosen by how many colours the row owns. `chip` is ONE
`'#RRGGBB'`, printed as the full swatch-and-hex readout an `rgb` control shows above its
sliders — the same fragment, from the same builder (`lib/html.js` `swatchReadout`), so a row
and the sheet it opens name a colour identically. `dots` are small pips, outlined when the
entry sets `ring` and filled otherwise, for a row previewing several colours at once where
several readouts would not fit. Both preview lanes are `aria-hidden`, so `ariaNote` is what
actually announces the state: on a value row it is appended to the Edit button's `aria-label`
in parentheses, and on a nav row it follows the summary as visually hidden text. The Edit
button itself always has the one look; a badge's `label` only renames it. (A missing API key
is not shown that way: WarnWeather's provider pickers each have a key row, "<Name> API key",
whose summary reads "No key", and a `textFrom` note under the picker and its
`attentionFrom` tab dot say why.)

Rows inside an open sheet behave as they do in a card (a text row's `suffixAction` button and
its verdict line, and a hint's tap-to-copy `[data-copy]` button, included), with one
difference: a `select` row there expands its option list IN PLACE, under the row inside the
sheet (the colour palette's pattern), instead of opening the select modal. The trigger stays where it was and reads as
open (`aria-expanded="true"`, the row gains `isel-open`); the list reuses the modal's option
rows, so the current value's check, a recommended option and gated (`meta.disabled` /
`optionDisabledWhen`) options look and behave the same. A pick stores the value, fires the
item's `onChange` once and collapses the list, leaving the sheet open with focus back on the
trigger; a second tap on the trigger collapses it without a pick. One expander is open at a
time: opening a list collapses an open palette and vice versa. Escape first collapses an open
list or palette and only closes the sheet on the next press; the close button, the backdrop
and a swipe-down close the sheet, which reopens collapsed. A touch that starts inside the
list never arms the swipe-down. A list stays open only while its row renders live: when
another control in the sheet hides the row (`showWhen`) or mutes it (`disabledWhen`), the
list collapses with it, and the row comes back collapsed. `searchSelect` has no in-sheet
form: keep it out of `sheetOnly` sections (a schema test enforces it). A select in the tab
body, and one opened through `openSheet()`, still opens the modal.

A `checklist` is a grid of ticks for ONE code (`check`), ticked in or out of several lists: one
row per option and, within a row, one list per column. Each option names the lists its ticks
read and write in `meta.keys`, one key per column, left to right; `columns` carries the
captions, and `label` the grid's one sub-header (in the `.subhdr.grp` look, the captions over
the ticks), which also names the grid for assistive tech (its `aria-label`):

```js
{ type: 'checklist', label: 'Shows on', check: 'rain', writeWith: 'sideTick',
  columns: [{label: 'Left'}, {label: 'Right'}],
  options: [['Top bar',    'top',    {keys: ['topLeftItems', 'topRightItems']}],
            ['Bottom bar', 'bottom', {keys: ['bottomLeftItems', 'bottomRightItems']}]] }
```

Every tick shows whether its list (a comma list, `'bt,qt,snooze'`, `''` when empty) holds the
code. The checklist has no `messageKey` and stores nothing, and the engine writes nothing for
it: a tap calls the writer `writeWith` names, a function registered on `PConf.checkWriters`
as `fn(S, key, code, on)`, which ticks `code` into the list at `S[key]` (`on`) or out of it,
the opposite of what the tick showed. The writer is the lists' own contract, so it decides
their order and anything else a tick moves (WarnWeather's `onDemandTick` stores through
on-demand.js, which keeps an item on one side of a bar); no `onChange` runs. Every key a grid
shows still needs an item of its own (a `hidden` one is enough) for its default and its save.
The options are `[label, value, meta]` like a select's (`optionsFrom` is materialized as for a
select, but never snapped); each is a plain row (no card), its name the label and `meta.desc`
its hint, and the rows are joined as by `joinPrevious: true`. `meta.disabled` renders a row
inert **with its ticks**, so a gate never rewrites a stored list. Each tick is named
"<option>, <column>" for assistive tech, and focus returns to it after a tap; it is found again
by its key and its code, so keep one grid per sheet.

A `readout` row is a badged `sheet` row with nothing to open: its label (and `icon`) on the left
and a live `hint`/`hintFrom` line under it, for a setting summary that has no settings of its own.

A `range` with `single: true` has one thumb and stores a plain integer string. `min`, `max`,
`step` and `unit` work as on the dual range (a `%` unit hugs the number, "10%"); `dangerKey` and
`minSpan` do not apply. A stored value off the step grid is SHOWN snapped UP to the next step
(`min + ceil((v − min) / step) · step`, clamped to `[min, max]`) and is written back only when
the user moves the thumb.

The seventeen types above are the complete built-in set. Anything bespoke belongs in a custom block
registered via `PConf.blocks.register` — the control-type dispatch itself is not pluggable from
app code.

`subheader` items split ONE section into several cards — use them when a section holds rows
that answer to different scopes (a slot dialog keeps its `Bold` row in one card and its Alert
highlighting in the next). Each visible subheader opens a card titled by its `text`; its
optional `intro` is that card's info text (behind the header's '?' in the '?' mode), its optional
`labelAction` sits beside the title, and its optional `toggleKey` names a `toggle` item **in the
same section**, which then renders as a switch on the card header instead of as a row of its
own — while keeping its normal place in `items`, so hydrate/serialize/`onChange` are
unaffected. The hosted toggle's `disabledWhen` still applies there: while it holds, the
header's switch renders `disabled` (dimmed, showing the held value) and a tap on it changes
nothing. A card with no row to show drops out. Only sections merged by `groupCard` keep their
subheaders as in-card headers.

`staticText` items carry their HTML in a `text` field and are emitted verbatim without control
chrome. They are not serialized (no `messageKey`). `style: 'info'` boxes the note — the
tinted, left-ruled look of the Watchface tab's fetch-notice items, in the page's info amber
(`--info-tint` / `--info-rule` in `shell.html`, shared with those notice items and flipped by
the light theme; error boxes stay red) — for a pointer the reader should not skim past as
body copy ("this is set on another tab"). A boxed note keeps the row padding (14px) to
whatever sits above and below it. A `joinPrevious` drops the divider next to it, never that
gap, and the box does not hug the row above the way a plain joined note does. The same holds
for a box right under an intro (`shell.html`, the `.static.info` standoff rules).
`textFrom: { resolver, args }` derives the note from the live settings through a named
[hint resolver](#hint-resolver-registry--pconfhintresolvers), for a note whose words, or
whether it shows at all, depend on more than a `showWhen` can test (WarnWeather's "Needs an
API key" note, where a key of only spaces counts as empty). The resolver gets `textFrom.args`
as they are (no messageKey or value: a staticText has none); `null`/`undefined` falls back to
`text`, and `''` means "no note now": the item renders nothing, blocks included, and the row
above keeps its divider even when the note would `joinPrevious` it.

`color` items offer all 64 Pebble swatches; `excludeColors` subtracts specific ones (e.g.
white from the holiday picker, where white means "no highlight" rather than a real color). A
`color` item may also take its DISPLAYED value from a named
[display resolver](#display-resolver-registry--pconfdisplayresolvers) (`displayFrom`) — the chip
and the palette's current-swatch marker both follow it, the stored value is untouched, and
picking the shown swatch is what writes it.

### Section and item fields

**Section fields:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Section heading |
| `intro` | string | HTML rendered above items |
| `block` | string | Custom-block id rendered BELOW the items (see [Registries](#registries-and-hooks)). A block ABOVE the items is the item-level `blockBefore` on the section's first item — the engine has no section-level `blockBefore`; for a card that stacks several blocks, share a `groupCard` id across consecutive sections instead. |
| `collapsible` | boolean | Collapses the section into an expandable card (collapsed by default; state is per page open) |
| `titleFrom` | `{resolver, args?}` | Collapsible sections only: a `PConf.displayResolvers` id whose `fn(S, env, args)` result is painted next to the title while the card is COLLAPSED (e.g. the current pick of a select inside), so a closed card still says what's selected. Open cards show the plain `title`. `args` pass through verbatim (no messageKey merge — sections have none). |
| `groupCard` | string | Consecutive sections sharing a `groupCard` id render into ONE card: titles become in-card sub-headers, and each section's intro/items/`block` stack inside it. Empty sub-sections drop out cleanly. |
| `items` | Item[] | The items to render |

**Item fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | One of the seventeen types above |
| `messageKey` | string | Serialization key — must match the AppMessage/C key |
| `defaultValue` | any | Default value. Color defaults are ints (e.g. `0xFFFFFF`). |
| `defaultFrom` | `{ resolver, args?, sticky? }` | A per-watch default from a named [defaults resolver](#defaults-resolver-registry--pconfdefaultsresolvers), used instead of `defaultValue`. Never seeded by `deriveDefaults`. `sticky: false` leaves the key out of the save blob while it holds that default. |
| `options` | `[label, value][]` | Choices for `select`, `segmented`, `radio` |
| `optionDisabledWhen` | `{ value: showWhen }` | Renders individual `segmented`/`radio` options inert while their condition holds. Prefer this over gating the list itself with `optionsFrom`: an option that disappears is snapped away, silently rewriting a stored value the user never touched. |
| `displayFrom` | `{ resolver, args }` | Paints a DERIVED value from a named [display resolver](#display-resolver-registry--pconfdisplayresolvers) while the stored value stays untouched. Read by `color` only; ignored on an `inline` item. |
| `description` | string | HTML description rendered below the label |
| `hint` | string | HTML hint rendered below the control |
| `hintByValue` | `{ value: string }` | Per-value hints; overrides `hint` for the current value |
| `attentionFrom` | `{ resolver, args }` | The row needs fixing before a save, per a named [attention resolver](#attention-resolver-registry--pconfattentionresolvers): its tab's label gets a dot, and Save asks first. |
| `hintFrom` | `{ resolver, args }` | A DERIVED hint from a named [hint resolver](#hint-resolver-registry--pconfhintresolvers), for a hint that depends on other keys than the row's own value; overrides `hintByValue`/`hint` unless the resolver answers `null`/`undefined`. Value rows and badged `sheet` rows (`editBadgeFrom`, see above) — not `button`/chevron `sheet` rows or `inline` cells. On value rows also re-resolved in place after a keyboard nudge on a range thumb. |
| `icon` | string | Id of a glyph in the [icon registry](#icon-registry--pconficons), printed before the label text on a value row and on a `button`/`sheet` row alike. An unregistered id prints nothing. |
| `attributes.placeholder` | string | Placeholder text for `text` items |
| `capabilities` | `["COLOR"]` | Clay-compatible sugar: hides the item on b&w platforms |
| `showWhen` | Predicate | Conditional-visibility predicate (see grammar below) |
| `text` | string | HTML body for `staticText` items |
| `textFrom` | `{ resolver, args }` | `staticText` only: the body derived by a named hint resolver; `''` renders nothing (see above) |
| `style` | `'info'` | `staticText` only: render the note as a boxed info note (see above) |
| `compact` | boolean | Gives any row the tight vertical rhythm of the status-slot rows (`.slot`). |
| `more` | boolean | The row renders behind its card's "More options · N more" row (see Progressive disclosure). |
| `indent` | boolean | Indents the row (32px) — a child of the row above. |
| `hintShown` | boolean | Keeps the row's hint in view even in the '?' mode (a live summary, not info text). |
| `infoId` | string | The id the row's '?' is remembered under (default: `k:<messageKey>`, `s:<sheetId>`, `a:<action>`, `l:<label>`). |
| `uiOnly` | boolean | A page-only control: hydrated from `initFrom`, never read from or written to the save blob, never seeded. |
| `initFrom` | `{resolver, args?}` | `uiOnly` only: a display resolver `fn(S, env, args)` giving the value the page opens on (else `defaultValue`). |
| `groupLabel` | string | On the first member of an `inline` group: renders the group as ONE labelled row, the members side by side joined by a dash (a From–To row). |
| `gotoTab` | string | `button` only: the row brings that tab to the front. |
| `style` | `'link'` | `button` only: a line of link text instead of a nav row. |
| `navNote`, `labelFrom`, `summaryFaintFrom` | | `sheet`/`button` nav rows only (see the `sheet` type above). |
| `captionsOnly` | boolean | `checklist` only: its header row shows only the column captions (the card's title already names the grid). |
| `columns` | `[{label}]` | `checklist` only: the columns' captions, left to right (see above). |
| `check` | string | `checklist` only: the one code the grid ticks in its rows' lists (`meta.keys`; see above). |
| `writeWith` | string | `checklist` only: the `PConf.checkWriters` id that stores a tap (see above). |
| `single` | boolean | `range` only: one thumb, a plain integer string (see above). |

### Progressive disclosure

The page shows each card as its labels and controls; explanations and rarely-changed rows wait
one tap away. Every piece of this state is UI-only (per page open, never saved).

- **Info text, in view or behind '?'.** A value row's hint (`hint`, `hintByValue`, `hintFrom`),
  a card's `intro` and a dialog's `intro` are the page's info text. By default it all shows in
  place. The schema's top-level `infoIconsKey` names a page-only toggle (WarnWeather:
  `hideInfoText`, *Hide info text* in Setup › Misc); while that is on, each one renders only
  while its info is open: the label carries a small '?' button (`.info-q`, `data-info="<id>"`,
  `aria-expanded`) and a tap shows the hint under the label (or hides it again). A row with no
  label, a `readout`, a nav row and a row with `hintShown: true` keep theirs in view. A titled
  card's `intro` (a section's, or a subheader's) goes behind a '?' beside the card title
  (`data-info="c:<cardId>"`, where cardId is `<tabId>:<section id or index>/<card index>`); an
  untitled card's intro stays in view. A dialog's intro goes behind a '?' beside the dialog
  title (`data-info="d:<sheetId>"`).
- **More options.** Items flagged `more: true` render after the card's other rows, only while its
  "More options · N more" row is open (N counts the ones that would show); open, the rows come
  first and a "Fewer options" row closes the card. A card opens with them out when one of its
  `more` items (a nav row's: one of its dialog's) held a non-default value as the page opened,
  so a customised setting is never tucked away.
- **Panes.** A tab with `panes` shows a segmented switcher at its top; a section with `pane`
  renders only while that pane is picked (the first shown pane by default). The switcher and
  the active pane's `pinBlock` (else the tab's `pinBlock`) form one sticky header (`.pin`) the
  cards scroll under.

### Dialogs

A `sheetOnly` section opens as a **full-screen dialog** on the page ground: the header holds ×
(close and put back every setting as it was when the dialog opened — changes made in dialogs
opened from it included), the kicker (where it was opened from: the tapped row's card title,
else the tab label) over the title with the dialog's '?' and `labelAction` beside it, and
**Done** (keep the changes). A dialog opened from inside another (a `sheet` row in a dialog)
stacks on top with ‹ instead of ×, stepping back to its parent and keeping its changes; Escape
steps back like Done. The section's `pinBlock` stays pinned under the header; its items render
as cards like a tab's. Edits only reach the watch with the main Save. Select pickers, the date
wheel and the Save confirm stay bottom sheets.

### showWhen predicate grammar

A predicate evaluates against a context of `{ <all current settings>, env }`.

```js
// Leaf forms
{ key: "secondaryLine", eq: "precip_prob" }   // setting value equality
{ key: "provider",      ne: "dwd" }           // inequality
{ key: "sleepStart",    in:  ["22","23"] }    // membership
{ key: "sleepStart",    nin: ["0","1"] }      // non-membership
{ env: "color",  eq: true }                   // environment fact with operator
{ env: "color" }                              // environment fact — truthy shorthand
{ when: "lineRow", args: { picker: "thirdLine", metrics: ["uv"] } }  // a named resolver's answer

// Compound forms
{ all: [ <pred>, <pred>, … ] }               // AND
{ any: [ <pred>, <pred>, … ] }               // OR
{ not: <pred> }                              // negation
[ <pred>, <pred>, … ]                        // shorthand for all:[…]  (AND)
```

Operators supported on `key` and `env`: `eq`, `ne`, `in`, `nin`, and bare truthy (no operator key).
A `when` leaf asks a [when resolver](#when-resolver-registry--pconfwhenresolvers) by name; an
unregistered name reads false.

`capabilities: ["COLOR"]` is Clay-compatible sugar internally translated to
`{ env: "color", eq: true }` ANDed with any existing `showWhen`.

### Environment facts (env)

Populated by the library from `Pebble.getActiveWatchInfo()` at `generateUrl` time:

```js
env = {
  color:         true,       // false for aplite, diorite, flint (known 1-bit platforms)
  round:         false,      // true only for chalk
  platform:      "basalt",   // raw platform string
  health:        true,       // false for aplite (no PBL_HEALTH sensors)
  radar:         true,       // false for aplite (no WW_RAIN_RADAR)
  themePolarity: true,       // false for aplite (no WW_THEME_POLARITY — light/B&W-Inv theme)
  hr:            false,      // true only for emery, diorite (heart-rate sensor)
  thresholds:    true,       // false for aplite (no WW_THRESHOLD_HIGHLIGHT)
  colorBacklight: false,     // true only for emery (RGB backlight LED)
  lineStyles:    true,       // false for aplite (no WW_LINE_STYLE — third metric line + per-line marker styles)
  onDemand:      true,       // false for aplite (no WW_ON_DEMAND — the Alerts at the status bars' edges)
  fineBattery:   false,      // true only for emery (battery charge reported in 5 % steps)
  forecastSpan:  false       // true only for emery (the 12 / 24 / 48 h forecast time span)
}
// Fallback when watchInfo is unavailable:
// { color: true, round: false, platform: '', health: true, radar: true,
//   themePolarity: true, hr: false, thresholds: true, colorBacklight: false,
//   lineStyles: true, onDemand: true, fineBattery: false, forecastSpan: false }
```

The host app may contribute additional facts by passing them as `generateUrl`'s `env`: the
value is merged **over** the computed env, so the app supplies only the keys the library cannot
know. That is the seam for *phone*-runtime capabilities — WarnWeather passes `phoneBattery`
(whether this PKJS host exposes the Battery Status API, which only Android's Chromium WebView
does) — because the library derives env from `watchInfo` alone and never reads app storage.

The set of known 1-bit platforms (`aplite`, `diorite`, `flint`), the no-health/no-radar/
no-theme-polarity/no-threshold/no-on-demand platform (`aplite`), the heart-rate-capable platforms
(`emery`, `diorite`), the colour-backlight platform (`emery`), the 5 %-battery-step platform
(`emery`) and the forecast-time-span platform (`emery`) are Pebble facts owned by the library in
`lib/platform.js`. Every fallback except `hr`, `colorBacklight`, `fineBattery` and `forecastSpan`
is conservative (show the controls if the platform is unknown); those four default to `false` so
an unrecognized watch isn't offered a permanently-empty slot, hardware (the RGB backlight LED) it
probably doesn't have, a battery warn level its firmware cannot resolve, or a 48 h forecast its
AppMessage inbox would drop. `colorBacklight` is a fact about the BACKLIGHT, not the screen: basalt and chalk
are `color: true` but `colorBacklight: false`, because only emery's board carries the LED driver
`light_set_color_rgb888()` needs. `env.round` is exposed for forward-compatibility; the rest are
load-bearing values gating real shipped features.

### Hidden-item serialization rule

An item hidden by `showWhen` or `capabilities` **retains its current value and is still serialized**
— exactly like Clay's `inject.js` `.hide()`. The serializer walks the full schema regardless of
visibility, so the output blob stays complete and the C side is not affected. The one key it
leaves out on purpose is a `defaultFrom` item marked `sticky: false` that still holds its
default (see [Defaults-resolver registry](#defaults-resolver-registry--pconfdefaultsresolvers)).

---

## Registries and hooks

Block renderers and hook callbacks are browser-side code. They are written in plain top-level ES5
(no module wrappers) in the app's own files, then concatenated into the page at build time (see
[Build step](#build-step--buildpage)). The `PConf` global is available at registration time.

### Block registry — PConf.blocks

A section with a `block` field triggers a call to the registered renderer. All renderers share one
signature:

```js
// Returns an HTML string (or '' to render nothing)
PConf.blocks.register(id, function (state, env, userData) {
  // state    — current settings object (all keys; colors as hex strings)
  // env      — { color, round, platform }
  // userData — the object the app set on instance.meta.userData (or passed to generateUrl)
  return '<div …>…</div>';
});
```

Registering to the same `id` twice overwrites the first registration. Requesting an unregistered
`block` id renders nothing and emits a console warning — it never crashes the page.

`userData` carries whatever the app puts there — typically last-fetch timestamps, connection stats,
or any other data that must travel from PKJS into the page without going through settings storage.

### Icon registry — PConf.icons

An item with an `icon: id` field gets a small glyph in front of its label. The registry holds
the markup itself, not a renderer:

```js
PConf.icons.register('rain', '<svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>');
```

The engine wraps the fragment in `<span class="lbl-ico" aria-hidden="true">` (the label beside
it names the row) and sizes it to 16 px. Draw in `currentColor` — stroke, fill or both — so the
glyph takes the label chrome's muted colour and follows the theme flip; a hard-coded colour
stays put when the page turns light.

The fragment is printed **unescaped**, exactly like a block's HTML: register only markup your
page code owns, never a string built from settings, `userData` or anything fetched. As with
blocks, registering an id twice overwrites it, and an unregistered id renders nothing.

### Options-resolver registry — PConf.optionsResolvers

A `select`, `searchSelect`, or `radio` item with an `optionsFrom: { resolver: id, args }` field
resolves its option list dynamically instead of using a static `options` array — mirrors the block
registry above:

```js
// Returns [[label, value], …]
PConf.optionsResolvers.register('statusSlot', function (state, env, args) {
  return [['None', ''], ['Temperature', 'temp'], /* … */];
});
```

The resolver runs on every render, so the list — labels included — follows any key it reads.
A resolver can therefore RENAME an option from the live settings as well as filter the list —
say, an option named for whether a toggle is on and a key is typed into a text field. When that
happens depends on the control that changed:

- **Toggle, select/searchSelect pick, radio, segmented, colour** — the page re-renders at once
  (an action button when its handler returns `true`).
- **Text field** — typing writes the state per keystroke but repaints nothing (a re-render would
  swallow the user's next tap). When the field **commits** (`change`: blur or Enter), the engine
  relabels every rendered `select`/`searchSelect` trigger IN PLACE — only the trigger's label
  text and `aria-label` change, so the tap still lands — from its freshly resolved option list.
  A trigger whose stored value is no longer among its options is left alone until the next full
  render snaps it. The option sheet is rebuilt whenever it opens, so it is always current.
  Anything else a text key feeds (hints, `showWhen`, blocks) catches up at the next full render.

A stored value that is no longer among its item's options snaps to the item's default (when
still offered) or the first option — a `dormantValues` value excepted, which stays stored. Every
full render and every Save does this for EVERY shown `optionsFrom` row (`snapShownOptions`), in
schema order, wherever the row sits: on another tab, in a dialog, behind More options. So a pick
in one row that takes an option away from another (one forecast line taking the metric a later
line showed) clears it at once, and what is saved never depends on which rows were drawn. A row
hidden by its own, its section's, its pane's or its tab's `showWhen` keeps its value.

### Defaults-resolver registry — PConf.defaultsResolvers

A keyed item with a `defaultFrom: { resolver: id, args, sticky }` field takes its default from a
named resolver instead of a static `defaultValue`, for a default that depends on the watch (a
heart-rate slot on an HR watch, a look that only reads well on a colour screen):

```js
// Returns the default VALUE for this watch (one value, not a list).
PConf.defaultsResolvers.register('warnLookDefault', function (env, args) {
  return (env && env.color === false) ? 'outline' : 'fill';
});
```

The resolver gets the page's `env` and `defaultFrom.args`, never the settings state. It runs at
hydrate (a key the saved blob lacks takes it), at the display-snap (a select value that fell out
of its option list lands on it) and for the `defaultOf` handed to actions. `deriveDefaults`
skips every `defaultFrom` item, so a seeded store never holds one. An unregistered id resolves
to `undefined`: the key stays unset.

`sticky` decides what a save does with a key that still holds its default:

- **omitted or `true`**: hydrate put the resolved default into the state, and `serialize` writes
  it back like any value. After the first save the key is stored, so the saving watch's default
  is frozen as a value, and another watch sharing the phone's store reads it too. Fine for a
  default that only has to be sensible on first open (WarnWeather's status slots).
- **`false`**: `serialize` leaves the key out while its value equals the default resolved for
  the page's `env` (strict equality in the page's shape, so a colour default compares as
  `'#RRGGBB'`). The key stays absent, as long as the host saves the blob whole (as
  `getSettings` does) and does not seed it, so it keeps resolving per watch. A different value
  is a pick and is saved as usual. The flip side: a pick that equals the saving watch's default
  is not remembered, and follows each watch's default like an untouched key. Use it when
  "absent" is itself the contract, e.g. an app packer that resolves an unset key per platform
  (WarnWeather's warn looks).

### Display-resolver registry — PConf.displayResolvers

An item with a `displayFrom: { resolver: id, args }` field PAINTS a derived value while its
stored value stays untouched — for a key whose effective value is computed elsewhere (a colour
that cascades from a sibling key until the user pins it). Two consumers read the registry
today: `color` items via `displayFrom` (args get the item's messageKey merged under them),
and collapsible sections via `titleFrom` (the collapsed card header's value — args pass
through verbatim, with NO messageKey merged in, since sections have none).

```js
// Returns the value to display; return null/undefined for "use the stored value".
PConf.displayResolvers.register('graphNightTint', function (state, env, args) {
  // args carries the item's own messageKey, merged UNDER displayFrom.args
  return cascadedHexFor(state, args.scope);   // '#RRGGBB'
});
```

The write path is unaffected: the control still stores under its own `messageKey`, so picking
the shown value is what pins it. An unregistered resolver id falls back to the stored value.

### Hint-resolver registry — PConf.hintResolvers

An item with a `hintFrom: { resolver: id, args }` field shows a hint DERIVED from the live
settings — for a hint that depends on keys other than the row's own value (`hintByValue` covers
that one). WarnWeather's line-style pickers use it: each explains the scale of the metric its
own line draws, which lives in a sibling key.

```js
// Returns the hint HTML; null/undefined = "use the row's static hint"; '' = no hint.
PConf.hintResolvers.register('lineStyleHint', function (state, env, args) {
  // args carries the row's messageKey, the value the row SHOWS (after the
  // display-snap) and the row's static hint for that value (staticHint), all merged
  // UNDER hintFrom.args
  return scaleFor(state[args.metricKey], args.value);
});
```

`args.staticHint` is what the row would show without the resolver: its `hintByValue` entry for
the shown value, else its `hint` (undefined when it has neither). A resolver that only adds to
that copy — WarnWeather's key-status summary appends "Key ••••1234 · ✓ works" under the
provider's "why" text, and the AQI slot's Day max hint closes on its source's note — builds on
it instead of carrying a second copy of the table in its args.

The resolver runs at render time, after the display-snap. The page re-renders its whole body
after every change but a text edit (that one waits for the next full render — see the
options-resolver registry above), so the hint follows every key the resolver reads with no dependency list
to declare — the same reason `optionsFrom` lists and `showWhen` gates stay current. An
unregistered resolver id, or a `null`/`undefined` answer, falls back to `hintByValue` for the
shown value, then `hint`; an empty string is honoured as "no hint here".

One commit skips the render on purpose: an arrow-key nudge on a range thumb paints the slider in
place so the thumb keeps focus (range-control.js). So a derived hint is re-resolved in place
after it instead — `renderRow` marks every derived hint element with `data-hint-for="<messageKey>"`,
and the engine rewrites just that element's markup, replacing no node. No WarnWeather hint
relies on it today: the hints that quote a slider's value (the Alerts card's `alertLevelsHint`,
the Battery row's `onDemandBatteryText`) sit on keyless rows outside the sheet and refresh on the
render that closes it. The library keeps it for a hint that reads a slider in its own sheet
(`test/hint-resolver.test.js` pins it). A hint that rendered empty (no element) and the row's
wrap layout wait for the next full render.

### Attention-resolver registry — PConf.attentionResolvers

An item with an `attentionFrom: { resolver: id, args }` field can say that it needs fixing
before the user saves — WarnWeather's Weather provider row, while the picked provider's API
key is missing or the provider is known to have rejected it:

```js
// Returns null (nothing to fix) or what to say about it.
PConf.attentionResolvers.register('keyAttention', function (state, env, args) {
  // args carries the row's messageKey and its stored value, merged UNDER attentionFrom.args
  if (state.owmApiKey) { return null; }
  return {
    note: 'OpenWeatherMap has no API key',        // appended to the tab's aria-label
    title: 'OpenWeatherMap has no API key',       // the Save dialog's title
    body: 'Without one, the watch gets no forecast.',
    actionLabel: 'Add key',                       // the fix; omit for "Save anyway" alone
    sheet: 'providerKeyOwm'                       // optional; see below
    // confirmLabel: 'Save anyway' is the default
  };
});
```

The engine reads it in two places, every render:

- **The tab bar.** The label of a tab holding a visible row that needs attention (in a
  visible section, a `sheetOnly` one included) ends in a small dot in the info amber
  (`.tab-dot`, `aria-hidden`), and the first such row's `note` joins the tab's
  `aria-label` in parentheses.
- **The Save button.** It first walks the visible tabs in order; the first row that needs
  attention and has a `title` opens a confirm dialog in the shared sheet instead of saving:
  the title in the sheet header, `body` (plain text, escaped) and two buttons. `actionLabel`
  closes the dialog WITHOUT saving, brings the row's tab to the front and opens the fix:
  `sheet`, else the row's `editSheetFrom` sheet, else the `sheetOnly` section the row sits
  in. `confirmLabel` ("Save anyway") saves exactly as Save does. The close button, the
  backdrop and Escape close it and save nothing.

It never stands between the user and a save: with nothing to fix, an attention without a
`title`, a resolver that throws, or a webview that cannot open a `<dialog>`
(`showModal` missing), Save saves at once. Only the Save button asks — `runReady`'s
`save()` (the setup wizard's finish) saves directly. The dialog's buttons sit side by side
with a margin, not a flex `gap`, which old Android WebViews do not lay out.

### When-resolver registry — PConf.whenResolvers

A `{ when: id, args }` leaf in a `showWhen`, `disabledWhen` or `optionDisabledWhen` predicate
asks a named resolver whether it holds, for a rule the app already answers in one of its own
modules: the schema asks that module instead of rebuilding the rule as a tree of `key` leaves
that tests then have to keep equal to it. WarnWeather's Forecast tab rows ask which picker's
line draws their metric, and its Alerts gates ask whether an item shows on a status bar.

```js
// fn(state, env, args): a truthy answer holds. `state` is the evaluation context, the
// settings with `env` on it; args is the leaf's args ({} when it has none).
PConf.whenResolvers.register('lineRow', function (state, env, args) {
  return hostLine(state, env, args) === args.picker;
});
```

The page re-renders its whole body after every change, so the leaf follows every key the
resolver reads with no dependency list, as a hint resolver does. An unregistered id reads
false, as an `env` fact the host never supplied does.

### Action registry — PConf.actions

A `button` item dispatches to the registered action by its `action` id when tapped. Actions are
assigned directly (no `.register()` helper):

```js
// Receives (arg, state, env, defaultOf). Return true to trigger a re-render; anything
// else no-ops. `defaultOf(key)` is the engine's stored-shape schema-default resolver
// (env-aware defaultFrom resolution, number color defaults as '#RRGGBB'; undefined for
// a key with no schema item) — use it for reset-style actions instead of mirroring
// schema defaults as literals, which drift when the schema changes.
PConf.actions.resetThresholds = function (arg, state, env, defaultOf) {
  // mutate state …
  return true;
};
```

Copy can carry the same dispatch inline: a section `intro`, a hint or a `staticText` may hold
`<button type="button" class="txt-link" data-action="resetThresholds">…</button>`, drawn as a
link in the copy's own font (`.txt-link`). A tab link has the same markup with
`data-goto-tab="<tab id>"` instead: a tap brings that tab to the front, as a tab-bar tap does.
Each tab keeps its scroll offset, and the tab bar scrolls sideways until the new tab shows.
From inside an open sheet, the sheet closes first, and focus lands on the new tab's button in
the tab bar. A tab whose `showWhen` hides it is never opened that way: the tap changes nothing,
so link only to a tab that exists wherever the copy shows (gate the copy with the tab). Keep
both kinds of link out of copy that sits inside a tap target of its own. Which tap wins
depends on the target: a chevron `sheet` row, a select or date trigger and a card header are
matched before the shared controls, so they take the tap and the link never fires; inside a
`button` row (`data-action`) the link wins instead (`controlClick` checks `[data-goto-tab]`
before `[data-action]`, and an inline action link is the nearer `[data-action]`), so the
row's own action never runs.

### Hook registry — PConf.hooks

Hooks fire at page lifecycle events. The context object exposes `get`/`set` for reading and writing
the live settings state, plus `getInitial` for the values that were present when the page loaded.

```js
PConf.hooks.onLoad(function (ctx) {
  // Fires after the page finishes rendering with the initial values.
  // Use to reset transient toggles that should start false each time the page opens.
  ctx.set('fetch', false);
});

PConf.hooks.onSubmit(function (ctx) {
  // Fires immediately before the page serializes and navigates to returnTo.
  // Use to set derived values or trigger side effects based on what changed.
  if (ctx.get('provider') !== ctx.getInitial('provider')) {
    ctx.set('fetch', true);
  }
});
```

`ctx` fields:

| Method | Description |
|--------|-------------|
| `ctx.get(key)` | Current value of `key` in the live settings state |
| `ctx.set(key, value)` | Write `key` into the live settings state (triggers a re-render) |
| `ctx.getInitial(key)` | Value of `key` as it was when the page loaded (before any changes) |

Multiple `onLoad`/`onSubmit` registrations are allowed and fire in registration order.

---

## Build step — buildPage

The page is a self-contained HTML string built once, before `pebble build`. The build step
concatenates the library's WebView files and the app's own browser-side files into
`lib/shell.html`, then emits the result as a `module.exports` string.

```js
// scripts/build-config-page.js  (app-side wrapper; no new dependencies)
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

function run() {
  assertScreenshots();   // app-specific guard: fails if required screenshots are missing
  return build.writeGenerated({
    appFiles: [
      'src/pkjs/settings/blocks.js',
      'src/pkjs/settings/onbuild.js'
    ],
    out: 'src/pkjs/settings/page.generated.js'
  });
}
```

`writeGenerated({ appFiles, out })` calls `buildPage({ appFiles })` (below), writes the result to
`out` as `module.exports = <JSON-stringified HTML string>` (via a per-process temp file + atomic
rename, so a concurrent reader never sees a half-written file), and returns `out`.

`buildPage({ appFiles })`:

1. Reads `lib/shell.html` (page skeleton, `Object.assign` polyfill, `INJECTED_*` variable
   declarations, and two markers).
2. At the `/*__PCONF_CONCAT__*/` marker, concatenates in order:
   - `lib/schema-walk.js` — single-source schema traversal (`PConf.schemaWalk`)
   - `lib/color.js` — int↔hex color conversion (`PConf.color`)
   - `lib/show-when.js` — predicate evaluator (`PConf.showWhen`)
   - `lib/html.js` — the escape helper, the shared sheet header, the swatch+hex
     colour readout the `rgb` control and a `chip` badge both print, and a joined row's
     no-divider class (`PConf.html`)
   - `lib/date-picker.js` — the date control: value helpers, wheel renderers, scroll-settle wiring (`PConf.datePicker`)
   - `lib/range-control.js` — the dual-thumb, one-thumb and threshold sliders: numeric rules, renderers,
     the single-thumb track, and the drag wiring every slider and the `rgb` control share (`PConf.rangeControl`)
   - `lib/rgb-control.js` — the `rgb` control: the `"r,g,b"` value rules, the swatch readout above three
     single-thumb channel tracks, and its in-place repaint (`PConf.rgbControl`)
   - `lib/checklist.js` — the `checklist` control's renderer: the grid of ticks and the
     list codes it reads (`PConf.checklist`); a tap stays with the engine
   - `lib/engine.js` — render engine, registries, hooks, modal shell, event wiring
   - each file in `appFiles` — the app's blocks and hooks
   - `PConf.engine.boot();` — boot runs last, after all registrations
3. Preserves the `/*__PCONF_INJECT__*/` marker for runtime injection inside `generateUrl`.

Run this step (wired into `scripts/build.sh` before `pebble build`) whenever `blocks.js`,
`onbuild.js`, or any library WebView file changes. `page.generated.js` is a build artifact;
never hand-edit it.

---

## Clay compatibility

"Drop-in for Clay" has three independent layers. The decision is: **Layer 1 built, Layer 2
documented future adapter, Layer 3 declined** — plus the data layer, which is already drop-in.

### Data layer — already drop-in (no work)

The persisted blob (`clay-settings` localStorage key), the `CLAY_*` AppMessage mapping, and int
color values are byte-for-byte identical to what Clay produced. The C side cannot distinguish the
library from Clay.

### Layer 1 — Clay-shaped instance API (built)

The `createConfig` instance carries Clay-compatible methods so a consuming app's host wiring needs
no changes:

- `generateUrl([opts])` — with no args, reads `values` from storage and `watchInfo` from
  `Pebble.getActiveWatchInfo()`, exactly like `clay.generateUrl()`.
- `getSettings(responseStr)` — parses the `webviewclosed` response, persists to
  `options.storageKey` (default `'clay-settings'`), and returns the blob — like `clay.getSettings`.
  Note: Clay's second "auto-send" argument is intentionally absent; the library never sends
  AppMessages; the app owns that. Like Clay, `parseResponse` accepts the response either still
  URI-encoded or already decoded by the host (a leading `{` means decoded), so a `%` in user
  text survives hosts that decode the `pebblejs://close#` fragment themselves.
- `setSettings(key, value)` / `setSettings(object)` — read-modify-write the stored blob.
- `meta.userData` — a mutable object the app populates before calling `generateUrl()`.

Storage is injectable via `options.storage` (default: ambient `localStorage`) so the library stays
testable and host-agnostic.

### Layer 2 — Clay config-format normalizer (documented future adapter, NOT built)

A future `compat/clay.js` would export a `Clay`-shaped constructor:

```js
// hypothetical — not yet implemented
var Clay = require('pebble-config-ui/compat/clay');
var clay = new Clay(clayConfigArray, customFn, options);
```

It would normalize a literal Clay config array (flat sections, `options:[{label,value}]`,
`type:'input'/'radiogroup'/'heading'/'submit'`, `description`, hex color defaults) into this
library's schema and return a `createConfig` instance. This gives existing Clay apps an on-ramp:
swap the `require`, keep `config.js`, it renders. Tabs, `segmented`, and blocks can be adopted
incrementally by migrating the schema.

This is an edge adapter over the clean core. It can be added when a second project needs it
without touching the engine. Out of scope this round (YAGNI — WarnWeather authors the new schema
directly for the richer UI).

The format mapping for a future implementor:

| Clay type | This library type |
|-----------|-----------------|
| `toggle` | `toggle` |
| `select` | `select` |
| `radiogroup` | `radio` |
| `color` | `color` (default converted hex → int) |
| `input` | `text` |
| `text` / `heading` | `staticText` |
| `submit` | (omit — boot handles submit) |

### Layer 3 — Clay imperative custom-code hook (declined)

Clay's `clayConfig.on(EVENTS.AFTER_BUILD, fn)` with
`getItemByMessageKey().get/.set/.show/.hide/.on('change')`, `clayConfig.serialize()`, and the
bundled `minified.$` micro-DOM library is exactly the imperative model this library replaces with
declarative `showWhen` and the block/hook registries. Reproducing it would re-import that complexity
and pin the engine's internal HTML as a public contract.

**Even a future Layer-2 adapter does not execute a Clay `customFn`** — dynamic behavior must be
re-expressed declaratively. `showWhen` handles all conditional visibility; `PConf.hooks.onLoad`/
`onSubmit` handle transient resets and derived changes; `PConf.blocks` handles arbitrary HTML/SVG.

This is the one place "drop-in" deliberately stops. Adopters migrating from Clay's imperative
hooks should translate them to `showWhen` predicates and hook callbacks.

---

## Lift-out / extraction note

`src/pkjs/config-ui/` is the self-contained lift-out unit. It is structured so that extraction to
the `pebble-config-ui` npm package is a folder move, not a rewrite:

- **Self-contained:** own `package.json`, `README.md`, `test/` with only incidental WarnWeather
  references (a fixture URL in `emulator-url.test.js`, a code comment in `engine.test.js`) — worth
  a scrub before extraction, not a blocker.
- **No inbound app coupling:** the library never `require`s `../settings` or any app module. It
  receives the schema and the built page as arguments.
- **Shared polyfill:** the library currently leans on `../polyfills.js` (the repo's shared
  `Object.assign` / `Array.find/findIndex/includes` guards). On extraction, inline those guards
  into the library's own `index.js` or a `lib/polyfills.js` — the package becomes dependency-free.
- **`"private": true`** is set now (not yet published). The publish step flips this and sets the
  npm org/scope.

Deferred to the publish step: npm org/scope, CI for the package, a versioning policy, and
replacing WarnWeather's local `require('../config-ui')` with a `node_modules` dependency. None of
these change the code authored now.

When a second project is ready:

```sh
cp -r src/pkjs/config-ui ../pebble-config-ui
# flip "private", set name/scope, then:
npm publish
```

---

## ES5 constraint

All library files under `lib/` and `index.js` must be authored in **ES5**:

- Use `var`, `function` declarations, and string concatenation.
- No arrow functions, `const`/`let`, template literals, `class`, `for…of`, spread,
  destructuring, default parameters, shorthand or computed object members, `?.`/`??`, `**`,
  or a trailing comma in a call.
- No unpolyfilled ES6 built-ins: no `padStart`/`padEnd`, `Object.values`/`entries`,
  `Array.from`, `Promise`, `Map`, `Set`, or `String.prototype.includes`/`startsWith`.
- `Object.assign`, `Math.trunc` and `Array.prototype.find`/`findIndex`/`includes` are safe: the
  PKJS runtime gets them from the repo's `src/pkjs/polyfills.js` (required first), and the
  webview page, which never loads that file, from the guarded shims at the top of
  `lib/shell.html`'s inline script, which runs before every lib and app file.
  `String.prototype.includes` is not polyfilled anywhere.

PKJS-parsed files (`index.js`, `lib/color.js`, `lib/platform.js`, `lib/defaults.js`) must be ES5
because aplite runs the PKJS phone-side JS on a pre-ES6 JavaScriptCore. WebView-only files
(`lib/show-when.js`, `lib/engine.js`) must be ES5 to protect ancient Android WebViews. The SDK
build does not catch stray ES6 — failures are silent until runtime.

An automated guardrail in the test suite (`test/config-es5.test.js`) tokenizes every shipped ES5
file and fails on ES2015+ syntax and on calls to ES2015+ built-ins that nothing polyfills. It also
fails on the ES5 strict-mode errors ES2015 dropped (so Node never reports them): duplicate object
keys and function declarations inside a block. The whole page is one `"use strict"` script, so
either one in any page file stops the page on an old WebView. It is not a full parser:
`String.prototype.includes` (indistinguishable from the polyfilled Array one) still gets past it.

**Test files** run in Node and may use modern JS — the ES5 rule applies only to shipped files.

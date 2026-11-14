# pebble-config-ui

pebble-config-ui is a declarative config-UI library for Pebble apps that replaces Clay.

It renders a tabbed settings page from a declarative schema. It has every Clay feature (all
control types, COLOR-capability filtering, defaults, conditional visibility) and extends through
registries instead of imperative hooks. The library has no app-specific knowledge: each app that
uses it supplies its schema, custom blocks and hooks.

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
   - [Progressive disclosure](#progressive-disclosure)
   - [Dialogs](#dialogs)
   - [showWhen predicate grammar](#showwhen-predicate-grammar)
   - [Environment facts (env)](#environment-facts-env)
   - [Hidden-item serialization rule](#hidden-item-serialization-rule)
5. [Registries and hooks](#registries-and-hooks)
   - [Block registry (PConf.blocks)](#block-registry-pconfblocks)
   - [Icon registry (PConf.icons)](#icon-registry-pconficons)
   - [Options-resolver registry (PConf.optionsResolvers)](#options-resolver-registry-pconfoptionsresolvers)
   - [Defaults-resolver registry (PConf.defaultsResolvers)](#defaults-resolver-registry-pconfdefaultsresolvers)
   - [Display-resolver registry (PConf.displayResolvers)](#display-resolver-registry-pconfdisplayresolvers)
   - [Hint-resolver registry (PConf.hintResolvers)](#hint-resolver-registry-pconfhintresolvers)
   - [Picture-resolver registry (PConf.pictureResolvers)](#picture-resolver-registry-pconfpictureresolvers)
   - [Attention-resolver registry (PConf.attentionResolvers)](#attention-resolver-registry-pconfattentionresolvers)
   - [When-resolver registry (PConf.whenResolvers)](#when-resolver-registry-pconfwhenresolvers)
   - [Action registry (PConf.actions)](#action-registry-pconfactions)
   - [Hook registry (PConf.hooks)](#hook-registry-pconfhooks)
6. [Shared parts (PConf.ui)](#shared-parts-pconfui)
7. [Build step (buildPage)](#build-step-buildpage)
8. [Clay compatibility](#clay-compatibility)
9. [Extraction to an npm package](#extraction-to-an-npm-package)
10. [ES5 constraint](#es5-constraint)

## Installation

The library is used locally and is not published to npm (see
[Extraction](#extraction-to-an-npm-package)).

```js
var configUi = require('../config-ui');
```

## Using it in your app

The app's side of the boundary is three files: a schema, a set of registered blocks and hooks,
and one index that creates the singleton instance.

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

Custom blocks and hooks are registered in browser-side files, which the build concatenates into
the page (see [Build step](#build-step-buildpage)):

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

## Public API

### createConfig

```js
var instance = configUi.createConfig({ schema, page, options });
```

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | Object | The app's declarative schema (tabs/sections/items). See [Schema format](#schema-format). |
| `page` | String | The built HTML page string (output of `buildPage`). Required; loaded lazily inside `generateUrl`. |
| `options` | Object | Optional instance-level overrides (see below). |

`options` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `storage` | ambient `localStorage` | Storage object implementing `getItem`/`setItem`. Override for testing or non-browser hosts. |
| `storageKey` | `'clay-settings'` | localStorage key for the settings blob. Matches Clay's default. |
| `emulatorConfigUrl` | `null` | Hosted helper URL for emulator testing. When it is set and the page runs under the pypkjs emulator, `generateUrl` routes through it (page in the URL `#hash`, `$$RETURN_TO$$` placeholder) instead of a `data:` URL, because a desktop browser blocks navigating the top frame to `data:`. See `test/emulator-url.test.js`. |

It returns an instance object:

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

`generateUrl(opts)` options:

| Field | Default | Description |
|-------|---------|-------------|
| `values` | read from storage | Flat settings blob to inject into the page (colors as ints). |
| `watchInfo` | `Pebble.getActiveWatchInfo()` | Raw watch info; the library computes `env` from it. |
| `userData` | `instance.meta.userData` | Passed to block renderers and hooks. |
| `returnTo` | `'pebblejs://close#'` | URL the page navigates to on save. |
| `env` | computed from `watchInfo` | Extra env facts, merged over the computed env. For facts the library cannot derive from `watchInfo` (phone-runtime capabilities), and for test overrides. |

The library converts colours (`int ↔ hex`) at the boundary: the app always works in int-valued
blobs, the page always in hex strings.

### Re-exported helpers

The library's top level re-exports these pure functions for PKJS-parsed app code that needs them
without creating a config instance.

```js
var configUi = require('../config-ui');

// Platform facts
configUi.isColorPlatform(platform)          // boolean — false for aplite/diorite/flint
configUi.isThemePolarityPlatform(platform)  // boolean — false for aplite (no light/B&W-Inv theme)
configUi.computeEnv(watchInfo)              // { color, platform, … } — null-safe

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

`themeKey` (optional) names a setting whose value (`'auto' | 'light' | 'dark'`) sets the page
theme. `'auto'` follows `prefers-color-scheme`; without `matchMedia` or `var()` support the page
falls back to dark. Without `themeKey` the page stays dark (the base theme). Support floor:
correct rendering from about Chromium 84, theming from Chromium 49; below that the page stays
dark and readable through literal fallbacks.

`infoIconsKey` (optional) names a page-only toggle. While it is `true`, row hints and card and
dialog intros sit behind small '?' buttons (see [Progressive disclosure](#progressive-disclosure));
off or omitted, they show in place.

### Tabs, sections, items

```
Schema
  └─ tabs[]
       ├─ id            string  (unique)
       ├─ label         string  (tab bar text)
       ├─ short         string  (the bar's label on a phone too narrow for `label`, ≤ 340 px)
       ├─ icon          string  (a registered icon id drawn over the label in the bar)
       ├─ showWhen      Predicate (false: no tab button, no body, no tab link lands there)
       ├─ pinBlock      string  (block id pinned at the top of the tab while its cards scroll)
       ├─ pinBare       boolean (the pinned block draws its own cards: no card around it)
       ├─ panes         [{id, label, showWhen?, pinBlock?}] (a segmented switcher; see Panes)
       └─ sections[]
            ├─ title        string
            ├─ intro        string  (HTML — the card's info text; behind its header's '?' in the '?' mode)
            ├─ block        string  (custom-block id — rendered below the items)
            ├─ collapsible  boolean (renders section as a collapsible card)
            ├─ titleBy      {resolver, args?} (the header's title from the settings; see Section fields)
            ├─ titleFrom    {resolver, args?} (collapsed-header value; see Section fields)
            ├─ noteFrom     {resolver, args?} (a short note on the header's right, its '?'; see Section fields)
            ├─ groupCard    string  (consecutive sections sharing an id merge into one card)
            ├─ pane         string  (renders only while its tab shows that pane)
            ├─ beforePin    boolean (renders first in the tab, above its pinned header; scrolls away)
            ├─ sheetOnly / sheetId  (a full-screen dialog, not a card; see Dialogs)
            ├─ pinBlock     string  (sheetOnly only: block pinned under the dialog's header)
            ├─ rename       {key, label, placeholder?, placeholderBy?, maxlength?, showWhen?} (sheetOnly only: the title renames a setting; see Dialogs)
            └─ items[]
                 └─ (see Item fields below; blockBefore is ITEM-level)
```

A section renders as one or more cards: every visible `subheader` item opens a new card titled
by its text, so one section can hold a card per group (see the `subheader` notes below).

### Item types

| `type` | UI element | Wire format | Clay equivalent |
|--------|-----------|-------------|-----------------|
| `toggle` | Switch | `true`/`false` | `toggle` |
| `select` | Dropdown | string | `select` |
| `segmented` | Pill row (new) | string | `select` (visual variant) |
| `radio` | Stacked radio buttons, or picture cards with `pictureFrom` | string | `radiogroup` |
| `color` | Color palette of the 64 Pebble swatches | hex string on wire; int in the persisted blob | `color` |
| `text` | Text input | string | `input` |
| `staticText` | Static HTML block; no key | — (not serialized) | `text` |
| `searchSelect` | Dropdown sheet with a search box | string | — |
| `range` | Dual-thumb slider (one thumb with `single: true`) | `"lo-hi"` string (`single`: a plain integer string, `"10"`) | — |
| `rgb` | Three channel sliders (R/G/B) and a live swatch | `"r,g,b"` string, each channel 0-255 | — |
| `date` | Date-wheel sheet (day/month/year) | `"YYYY-MM-DD"` string | — |
| `hidden` | None; never rendered | any (serialized like any keyed item) | — |
| `button` | Tappable action row; no key | — (not serialized) | — |
| `subheader` | In-section group header; no key | — (not serialized) | — |
| `sheet` | Tappable row that opens a `sheetOnly` section; no key | — (not serialized) | — |
| `checklist` | A grid of ticks for one code (`check`): a plain row per option, a tick per column, joined under one sub-header; a tap goes to the `writeWith` writer | — (not serialized: the ticks show other items' lists) | — |
| `readout` | Label (and `icon`) with a live hint; no control, no key | — (not serialized) | — |

A `sheet` item is a nav row. The whole row is the tap target (`role="button"`, Enter and Space
tap it) and opens its dialog. Its label leads, its summary sits under the label, and the red
arrow (›, [`ui.navArrow`](#shared-parts-pconfui)) closes the row on the right, as it ends
everything that opens a screen of its own. The summary is the row's static `hint` or a
`hintFrom` resolver's answer, which gives the live state of the settings behind it ("Off", or
their current levels). Unlike a value row's hint, it is always in view (no '?'). The resolver
gets no row value (`args.value` is `undefined`, since the row stores nothing) and reads whatever
it describes from `S`. `summaryFaintFrom` (a showWhen predicate) dims the summary while it holds
(e.g. "Not in any status bar"). `navNote` prints a short muted note before the chevron
("Alerts", a count). `labelFrom: {resolver, args}` (a hint resolver) derives the label from the
settings ("Tomorrow.io API key" for the picked provider). The dialog comes from `sheetId`, or
from `editSheetFrom` (a sheet resolver; the row hides itself while it answers none).

A row can also have `editBadgeFrom: { resolver, args }`, a named resolver `fn(S, env, args)`
registered on `PConf.badgeResolvers` that returns `null` or
`{label?, ariaNote?, chip?, dots: [{color, ring?}]}`; the badge's colour preview then leads the
chevron. Because the row has no `messageKey`, a resolver gets whatever it needs to identify the
row from its args. A summary is not repainted in place after a range nudge (it has no key to be
found by); the dialog the nudge happens in re-renders the page when it closes.

A `button` item is the same nav row. It dispatches `action`, or, with `gotoTab: '<tab id>'`,
brings that tab to the front like a tab link. With `style: 'link'` it is a single line of
link-coloured text instead (a reset). With `style: 'delete'` it is Delete
([`ui.deleteButton`](#shared-parts-pconfui)): drawn under its card, outside it, centred in the
accent, the last thing under what it deletes (a status bar's *Delete status bar* under its
dialog's last card, Graphs' *Delete Graph 2* under Your graphs). `labelFrom` names it and
`showWhen` hides it where there is nothing to delete; its card still needs another row to show.
A status-slot select keeps its own per-value dialog behind an Edit button beside the dropdown
(`editSheetFrom` on a value row).

The badge preview has two shapes, chosen by how many colours the row owns. `chip` is one
`'#RRGGBB'`, printed as the full swatch-and-hex readout an `rgb` control shows above its
sliders. It is the same fragment from the same builder (`lib/html.js` `swatchReadout`), so a row
and the sheet it opens name a colour identically. `dots` are small pips, outlined when the entry
sets `ring` and filled otherwise, for a row that previews several colours where several readouts
would not fit. Both preview lanes are `aria-hidden`, so `ariaNote` is what announces the state:
on a value row it is appended to the Edit button's `aria-label` in parentheses, and on a nav row
it follows the summary as visually hidden text. The Edit button always has the same look; a
badge's `label` only renames it. A missing API key is not shown with a badge: WarnWeather's
provider pickers each have a key row, "<Name> API key", whose summary reads "No key", and a
`textFrom` note under the picker and its `attentionFrom` tab dot say why.

Rows inside an open sheet behave as they do in a card (including a text row's `suffixAction`
button and its verdict line, and a hint's tap-to-copy `[data-copy]` button), with one
difference: a `select` row there expands its option list in place, under the row inside the
sheet (the colour palette's pattern), instead of opening the select modal. The trigger stays
where it was and reads as open (`aria-expanded="true"`, the row gains `isel-open`). The list
reuses the modal's option rows, so the current value's check, a recommended option and gated
(`meta.disabled` / `optionDisabledWhen`) options look and behave the same. A pick stores the
value, fires the item's `onChange` once and collapses the list, leaving the sheet open with
focus back on the trigger; a second tap on the trigger collapses it without a pick. One expander
is open at a time: opening a list collapses an open palette and vice versa. Escape first
collapses an open list or palette and closes the sheet only on the next press; the close button,
the backdrop and a swipe-down close the sheet, which reopens collapsed. A touch that starts
inside the list never arms the swipe-down. A list stays open only while its row renders live:
when another control in the sheet hides the row (`showWhen`) or mutes it (`disabledWhen`), the
list collapses with it, and the row comes back collapsed. `searchSelect` has no in-sheet form,
so keep it out of `sheetOnly` sections (a schema test enforces this). A select in the tab body,
and one opened through `openSheet()`, still opens the modal.

A `checklist` is a grid of ticks for one code (`check`), ticked in or out of several lists: one
row per option and, within a row, one list per column. Each option names the lists its ticks
read and write in `meta.keys`, one key per column, left to right. `columns` has the captions,
and `label` the grid's one sub-header (in the `.subhdr.grp` look, the captions over the ticks),
which also names the grid for assistive tech (its `aria-label`):

```js
{ type: 'checklist', label: 'Shows on', check: 'rain', writeWith: 'sideTick',
  columns: [{label: 'Left'}, {label: 'Right'}],
  options: [['Top bar',    'top',    {keys: ['topLeftItems', 'topRightItems']}],
            ['Bottom bar', 'bottom', {keys: ['bottomLeftItems', 'bottomRightItems']}]] }
```

Every tick shows whether its list (a comma list, `'bt,qt,snooze'`, `''` when empty) holds the
code. The checklist has no `messageKey`, stores nothing, and the engine writes nothing for it. A
tap calls the writer `writeWith` names, a function registered on `PConf.checkWriters` as
`fn(S, key, code, on)`, which ticks `code` into the list at `S[key]` (`on`) or out of it, the
opposite of what the tick showed. The writer is the lists' own contract, so it decides their
order and anything else a tick moves (WarnWeather's `onDemandTick` stores through on-demand.js,
which keeps an item on one side of a bar); no `onChange` runs. Every key a grid shows still
needs an item of its own (a `hidden` one is enough) for its default and its save. The options
are `[label, value, meta]` like a select's (`optionsFrom` is materialized as for a select, but
never snapped). Each is a plain row (no card), its name the label and `meta.desc` its hint, and
the rows are joined as by `joinPrevious: true`. `meta.disabled` renders a row inert together
with its ticks, so a gate never rewrites a stored list. Each tick is named "<option>, <column>"
for assistive tech, and focus returns to it after a tap. It is found again by its key and its
code, so keep one grid per sheet.

A `readout` row is a badged `sheet` row with nothing to open: its label (and `icon`) on the left
and a live `hint`/`hintFrom` line under it, for a setting summary that has no settings of its own.

A `range` with `single: true` has one thumb and stores a plain integer string. `min`, `max`,
`step` and `unit` work as on the dual range (a `%` unit hugs the number, "10%"); `dangerKey` and
`minSpan` do not apply. A stored value off the step grid is shown snapped up to the next step
(`min + ceil((v − min) / step) · step`, clamped to `[min, max]`) and is written back only when
the user moves the thumb.

These seventeen types are the complete built-in set. Anything bespoke belongs in a custom block
registered through `PConf.blocks.register`; app code cannot plug into the control-type dispatch.

`subheader` items split one section into several cards. Use them when a section holds rows that
answer to different scopes (a slot dialog keeps its `Bold` row in one card and its Alert
highlighting in the next). Each visible subheader opens a card titled by its `text`. Its
optional `intro` is that card's info text (behind the header's '?' in the '?' mode), and its
optional `labelAction` sits beside the title. Its optional `toggleKey` names a `toggle` item in
the same section, which then renders as a switch on the card header instead of as a row of its
own. The toggle keeps its normal place in `items`, so hydrate, serialize and `onChange` are
unaffected. The hosted toggle's `disabledWhen` still applies there: while it holds, the header's
switch renders `disabled` (dimmed, showing the held value) and a tap on it changes nothing. A
card with no row to show drops out. Only sections merged by `groupCard` keep their subheaders as
in-card headers.

`staticText` items carry their HTML in a `text` field, emitted verbatim without control chrome.
They are not serialized (no `messageKey`). `style: 'info'` boxes the note in the tinted,
left-ruled look of the Watchface tab's fetch-notice items, in the page's info amber
(`--info-tint` / `--info-rule` in `shell.html`, shared with those notice items and flipped by
the light theme; error boxes stay red). It is for a pointer the reader should not skim past as
body copy ("this is set on another tab"). A boxed note keeps the row padding (14px) to whatever
sits above and below it. A `joinPrevious` drops the divider next to it but never that gap, and
the box does not hug the row above the way a plain joined note does. The same holds for a box
right under an intro (`shell.html`, the `.static.info` standoff rules).

`textFrom: { resolver, args }` derives the note from the live settings through a named
[hint resolver](#hint-resolver-registry-pconfhintresolvers). It is for a note whose words, or
whether it shows at all, depend on more than a `showWhen` can test (WarnWeather's "Needs an API
key" note, where a key of only spaces counts as empty). The resolver gets `textFrom.args` as
they are (no messageKey or value, since a staticText has none). `null`/`undefined` falls back to
`text`, and `''` means "no note now": the item renders nothing, blocks included, and the row
above keeps its divider even when the note would `joinPrevious` it.

`color` items offer all 64 Pebble swatches. `excludeColors` removes specific ones (e.g. white
from the holiday picker, where white means "no highlight" and is not a real color). A `color`
item may also take its displayed value from a named
[display resolver](#display-resolver-registry-pconfdisplayresolvers) (`displayFrom`). The chip
and the palette's current-swatch marker both follow it, the stored value is untouched, and
picking the shown swatch is what writes it.

### Section and item fields

Section fields:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Section heading |
| `intro` | string | HTML rendered above items |
| `block` | string | Custom-block id rendered below the items (see [Registries](#registries-and-hooks)). A block above the items is the item-level `blockBefore` on the section's first item; the engine has no section-level `blockBefore`. For a card that stacks several blocks, share a `groupCard` id across consecutive sections instead. |
| `collapsible` | boolean | Collapses the section into an expandable card (collapsed by default; state is per page open). Its header ends on the red ▸, ▾ while open ([`ui.foldChev`](#shared-parts-pconfui)). |
| `titleBy` | `{resolver, args?}` | The card header's title follows the settings: a `PConf.displayResolvers` id whose `fn(S, env, args)` answer replaces `title` (escaped); `''` or no answer keeps `title`. The header marks it (`data-title-by`), so a text commit that skips the re-render retitles it in place. A dialog's title follows it too (e.g. a status bar's name titling the bar's dialog). |
| `titleFrom` | `{resolver, args?}` | Collapsible sections only: a `PConf.displayResolvers` id whose `fn(S, env, args)` result is painted next to the title while the card is collapsed (e.g. the current pick of a select inside), so a closed card still says what is selected. Open cards show the plain `title`. `args` pass through verbatim (no messageKey merge, since sections have none). |
| `noteFrom` | `{resolver, args?}` | A short note on the right of the card's header (the Your graphs card's "4/5 metrics active"): a `PConf.displayResolvers` id whose `fn(S, env, args)` answers `{text, label?, info?}`, or null for none. `text` shows (escaped), `label` is what a screen reader says instead (else `text`), and `info` (HTML, like `intro`) waits behind a '?' after the note and shows first in the card while it is open. The '?' is drawn whatever the page's info mode, so the note asks for little attention and its meaning is always a tap away. Not on a collapsible card, whose header is one button. `args` pass through verbatim. |
| `rename` | `{key, label, placeholder?, placeholderBy?, maxlength?, showWhen?}` | `sheetOnly` only: a pencil beside the dialog's title turns it into a text field for the setting `key` (`label` its accessible name, `placeholder` the name an empty field stands for, `maxlength` 40 unless given), with an OK button in Done's place. OK or Enter stores the text and fires the key's item `onChange`; Escape or × puts the title back. `placeholderBy` (`{resolver, args?}`, a `PConf.displayResolvers` id) answers the placeholder from the settings as `titleBy` answers the title (a graph's default name); `showWhen` gates the pencil (a predicate, as on an item). See [Dialogs](#dialogs). |
| `groupCard` | string | Consecutive sections sharing a `groupCard` id render into one card: titles become in-card sub-headers, and each section's intro, items and `block` stack inside it. Empty sub-sections drop out. |
| `items` | Item[] | The items to render |

Item fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | One of the seventeen types above |
| `messageKey` | string | Serialization key; must match the AppMessage/C key |
| `defaultValue` | any | Default value. Color defaults are ints (e.g. `0xFFFFFF`). |
| `defaultFrom` | `{ resolver, args?, sticky? }` | A per-watch default from a named [defaults resolver](#defaults-resolver-registry-pconfdefaultsresolvers), used instead of `defaultValue`. Never seeded by `deriveDefaults`. `sticky: false` leaves the key out of the save blob while it holds that default. |
| `options` | `[label, value][]` | Choices for `select`, `segmented`, `radio` |
| `optionDisabledWhen` | `{ value: showWhen }` | Renders individual `segmented`/`radio` options inert while their condition holds. Prefer this to gating the list itself with `optionsFrom`: an option that disappears is snapped away, which silently rewrites a stored value the user never touched. |
| `displayFrom` | `{ resolver, args }` | Paints a derived value from a named [display resolver](#display-resolver-registry-pconfdisplayresolvers) while the stored value stays untouched. Read by `color` only; ignored on an `inline` item. |
| `description` | string | HTML description rendered below the label |
| `hint` | string | HTML hint rendered below the control |
| `hintByValue` | `{ value: string }` | Per-value hints; overrides `hint` for the current value |
| `attentionFrom` | `{ resolver, args }` | The row needs fixing before a save, per a named [attention resolver](#attention-resolver-registry-pconfattentionresolvers): its tab's label gets a dot, and Save asks first. |
| `hintFrom` | `{ resolver, args }` | A derived hint from a named [hint resolver](#hint-resolver-registry-pconfhintresolvers), for a hint that depends on keys other than the row's own value; overrides `hintByValue`/`hint` unless the resolver answers `null`/`undefined`. Value rows and badged `sheet` rows (`editBadgeFrom`, see above); not `button`/chevron `sheet` rows or `inline` cells. On value rows it is also re-resolved in place after a keyboard nudge on a range thumb. |
| `icon` | string | Id of a glyph in the [icon registry](#icon-registry-pconficons), printed before the label text on a value row and on a `button`/`sheet` row alike. An unregistered id prints nothing. |
| `attributes.placeholder` | string | Placeholder text for `text` items |
| `capabilities` | `["COLOR"]` | Clay-compatible sugar: hides the item on b&w platforms |
| `showWhen` | Predicate | Conditional-visibility predicate (see grammar below) |
| `text` | string | HTML body for `staticText` items |
| `textFrom` | `{ resolver, args }` | `staticText` only: the body derived by a named hint resolver; `''` renders nothing (see above) |
| `style` | `'info'` | `staticText` only: render the note as a boxed info note (see above) |
| `compact` | boolean | Gives any row the tight vertical rhythm of the status-slot rows (`.slot`). |
| `more` | boolean | The row renders behind its card's "More options · N more" row (see Progressive disclosure). |
| `indent` | boolean | Indents the row (32px), as a child of the row above. |
| `hintShown` | boolean | Keeps the row's hint in view even in the '?' mode (for a live summary, not info text). |
| `infoId` | string | The id the row's '?' is remembered under (default: `k:<messageKey>`, `s:<sheetId>`, `a:<action>`, `l:<label>`). |
| `uiOnly` | boolean | A page-only control: hydrated from `initFrom`, never read from or written to the save blob, never seeded. |
| `stamp` | boolean | A value the page writes on its own (the Weather tab's last-opened time). It is saved like any other, but its change never lights Save or shows Revert, and Revert leaves it as it is. |
| `full` | boolean | `segmented` only: one equal segment per option across the row, a long label wrapping inside its own segment, the picked option's hint under it (the setup's pickers). |
| `sheetTitle` | string | `select`/`searchSelect` only: the picker sheet's title, where the row's label alone would not name it (a row whose picker also opens from a preview). Default: the label. |
| `sheetTitleBy` | `{resolver, args?}` | `select` only: a `PConf.displayResolvers` id whose answer titles the picker sheet instead of `sheetTitle` (a slot picker named by its bar's name); `''` keeps `sheetTitle`. |
| `sheetLead` | string | `select`/`searchSelect` only: one plain line under the picker sheet's title that says what the picker does (escaped). |
| `bottomSheet` | boolean | `select` only: in a dialog (a `sheetOnly` section) its list rises from the bottom over the dialog, titled as the picker sheet is (`sheetTitleBy`, `sheetTitle`), instead of opening in place under the row (engine `renderPickSheet`; the status bar slots). A tap beside it, its × or Escape closes it. On a tab it opens the select sheet as every select does. |
| `pictureFrom` | `{ resolver, args }` | `radio`: each option drawn as a card of its picture (from a named [picture resolver](#picture-resolver-registry-pconfpictureresolvers)) over its name, three to a line, the picked option's hint under them (the setup's pickers in pictures). `select`/`searchSelect`: each option's picture at the start of its row in the picker sheet. |
| `initFrom` | `{resolver, args?}` | `uiOnly` only: a display resolver `fn(S, env, args)` giving the value the page opens on (else `defaultValue`). |
| `groupLabel` | string | On the first member of an `inline` group: renders the group as one labelled row, the members side by side joined by a dash (a From/To row). |
| `gotoTab` | string | `button` only: the row brings that tab to the front. |
| `style` | `'link'` \| `'delete'` | `button` only: a line of link text instead of a nav row (`'link'`), or Delete under its card (`'delete'`, see the `button` type above). |
| `navNote`, `labelFrom`, `summaryFaintFrom` | | `sheet`/`button` nav rows only (see the `sheet` type above). |
| `captionsOnly` | boolean | `checklist` only: its header row shows only the column captions (the card's title already names the grid). |
| `columns` | `[{label}]` | `checklist` only: the columns' captions, left to right (see above). |
| `check` | string | `checklist` only: the one code the grid ticks in its rows' lists (`meta.keys`; see above). |
| `writeWith` | string | `checklist` only: the `PConf.checkWriters` id that stores a tap (see above). |
| `single` | boolean | `range` only: one thumb, a plain integer string (see above). |

### Progressive disclosure

The page shows each card as its labels and controls; explanations and rarely changed rows are
one tap away. All of this state is UI-only (per page open, never saved).

#### Info text, in view or behind '?'

A value row's hint (`hint`, `hintByValue`, `hintFrom`), a card's `intro` and a dialog's `intro`
are the page's info text. By default all of it shows in place. The schema's top-level
`infoIconsKey` names a page-only toggle (WarnWeather: `hideInfoText`, *Hide info text* in
Setup › Misc). While that toggle is on, each piece renders only while its info is open: the
label carries a small '?' button (`.info-q`, `data-info="<id>"`, `aria-expanded`), and a tap
shows the hint under the label or hides it again. A row with no label, a `readout`, a nav row
and a row with `hintShown: true` keep theirs in view. A titled card's `intro` (a section's or a
subheader's) goes behind a '?' beside the card title (`data-info="c:<cardId>"`, where cardId is
`<tabId>:<section id or index>/<card index>`); an untitled card's intro stays in view. A
dialog's intro goes behind a '?' beside the dialog title (`data-info="d:<sheetId>"`).

#### More options

Items flagged `more: true` render after the card's other rows, only while its
"More options · N more" row is open (N counts the ones that would show). When it is open, the
rows come first and a "Fewer options" row closes the card. A card opens with them out when one
of its `more` items (for a nav row, one of its dialog's) held a non-default value as the page
opened, so a customised setting is never tucked away.

#### Panes

A tab with `panes` shows a segmented switcher at its top. A section with `pane` renders only
while that pane is picked (the first shown pane by default). The switcher and the active pane's
`pinBlock` (else the tab's `pinBlock`) form one sticky header (`.pin`) the cards scroll under.

### Dialogs

A `sheetOnly` section opens as a full-screen dialog on the page ground. The header
([`ui.header`](#shared-parts-pconfui), which an app's own full-screen views share) holds ×, the
kicker over the title, and Done. × closes the dialog and puts back every setting as it was when
the dialog opened, including changes made in dialogs opened from it. The kicker says where the
dialog was opened from (the tapped row's card title, else the tab label), and the dialog's '?'
and `labelAction` sit beside the title. Done keeps the changes. A dialog opened from inside
another (a `sheet` row in a dialog) stacks on top with ‹ instead of ×, which steps back to its
parent and keeps its changes; Escape steps back like Done. The section's `pinBlock` stays pinned
under the header, and its items render as cards like a tab's. Edits reach the watch only with
the main Save. Select pickers, the date wheel and the Save confirm stay bottom sheets. A dialog
whose section renders nothing (its `showWhen` turned false, e.g. after a Delete inside it)
closes itself, and the focus goes to the Undo the Delete left in the tab body (`kit.undoToast`),
if one shows.

A section with `rename` titles its dialog by a setting (`titleBy`) and lets the title rename it.
The pencil opens a text field in the title's place and an OK button in Done's. OK, Enter or
leaving the field stores the text (through the item's `onChange`, which may clean it), and
Escape puts the old title back.

A page module opens a dialog itself with the ready ctx's
`openDialog(id, {rename, kicker, onClose, focusBack, overlay})`. `rename` opens it with the
field ready, `kicker` names where it opened from, and `onClose` runs after it closes.
`focusBack` (a selector) names the module's own trigger the focus goes back to (a graph's row),
and `overlay` marks a dialog opened over the module's own overlay, so focus goes back to nothing
on the page. These hold however the dialog closes, even with a dialog opened from inside it in
between. `openSheet(key, onClose, focusSel)` opens a select's options the same way, with the
focus going back to `focusSel` when given. An action that removes what a dialog is about (a
graph's Delete) turns its section's `showWhen` false, and the dialog closes itself. The render
hook (`PConf.hooks.onRender`) is told the dialog on screen (`dialog`: the root of the open
dialogs, null for none) along with the tab and the pane.

### showWhen predicate grammar

A predicate is evaluated against a context of `{ <all current settings>, env }`.

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

Operators on `key` and `env`: `eq`, `ne`, `in`, `nin`, and bare truthy (no operator key). A
`when` leaf asks a [when resolver](#when-resolver-registry-pconfwhenresolvers) by name; an
unregistered name reads false.

`capabilities: ["COLOR"]` is Clay-compatible sugar, translated internally to
`{ env: "color", eq: true }` and ANDed with any existing `showWhen`.

### Environment facts (env)

The library fills these from `Pebble.getActiveWatchInfo()` when `generateUrl` runs:

```js
env = {
  color:         true,       // false for aplite, diorite, flint (known 1-bit platforms)
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
  forecastSpan:  false       // true only for emery (the 12 h / 24 h / long forecast time span)
}
// Fallback when watchInfo is unavailable:
// { color: true, platform: '', health: true, radar: true,
//   themePolarity: true, hr: false, thresholds: true, colorBacklight: false,
//   lineStyles: true, onDemand: true, fineBattery: false, forecastSpan: false }
```

The host app may add facts by passing them as `generateUrl`'s `env`. The value is merged over
the computed env, so the app supplies only the keys the library cannot know. This is how
phone-runtime capabilities get in, because the library derives env from `watchInfo` alone and
never reads app storage. WarnWeather passes `phoneBattery`: whether this PKJS host exposes the
Battery Status API, which only Android's Chromium WebView does.

The library owns these Pebble facts in `lib/platform.js`: the known 1-bit platforms (`aplite`,
`diorite`, `flint`), the platform without health, radar, theme polarity, thresholds and on
demand (`aplite`), the heart-rate platforms (`emery`, `diorite`), the colour-backlight platform
(`emery`), the 5 % battery-step platform (`emery`) and the forecast-time-span platform
(`emery`). Every fallback except `hr`, `colorBacklight`, `fineBattery` and `forecastSpan` is
conservative (show the controls if the platform is unknown). Those four default to `false`, so
an unrecognized watch is not offered a slot that stays empty, hardware it probably does not have
(the RGB backlight LED), a battery warn level its firmware cannot resolve, or a long forecast its
AppMessage inbox would drop. `colorBacklight` is a fact about the backlight, not the screen:
basalt is `color: true` but `colorBacklight: false`, because only emery's board has the LED
driver that `light_set_color_rgb888()` needs. Each of these values gates a shipped feature.

### Hidden-item serialization rule

An item hidden by `showWhen` or `capabilities` keeps its current value and is still serialized,
as with Clay's `inject.js` `.hide()`. The serializer walks the full schema regardless of
visibility, so the output blob stays complete and the C side is not affected. The one key it
leaves out on purpose is a `defaultFrom` item marked `sticky: false` that still holds its
default (see [Defaults-resolver registry](#defaults-resolver-registry-pconfdefaultsresolvers)).

## Registries and hooks

Block renderers and hook callbacks are browser-side code. They are written in plain top-level
ES5 (no module wrappers) in the app's own files, then concatenated into the page at build time
(see [Build step](#build-step-buildpage)). The `PConf` global is available at registration time.

### Block registry (PConf.blocks)

A section with a `block` field calls the registered renderer. All renderers share one signature:

```js
// Returns an HTML string (or '' to render nothing)
PConf.blocks.register(id, function (state, env, userData) {
  // state    — current settings object (all keys; colors as hex strings)
  // env      — { color, platform, … }
  // userData — the object the app set on instance.meta.userData (or passed to generateUrl)
  return '<div …>…</div>';
});
```

Registering the same `id` twice overwrites the first registration. An unregistered `block` id
renders nothing and logs a console warning; it never crashes the page.

`userData` carries whatever the app puts there, usually last-fetch timestamps, connection stats
or other data that must travel from PKJS into the page without going through settings storage.

A block pinned above a dialog (a `sheetOnly` section's `pinBlock`) gets a fourth argument,
`{ dialog: true, sheet, from }`: the open dialog's id, and the id of the dialog it was opened
from (`null` for one opened from a tab). One block can then draw what its dialog is about (e.g.
the bar a slot's dialog was opened from). A block whose parts open a sheet themselves (a
`[data-select]` that opens a select's picker) draws them inert there, because the dialog is the
page's one sheet and a picker cannot open over it. Everywhere else the fourth argument is absent.

### Icon registry (PConf.icons)

An item with an `icon: id` field gets a small glyph in front of its label. The registry holds the
markup itself, not a renderer:

```js
PConf.icons.register('rain', '<svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>');
```

The engine wraps the fragment in `<span class="lbl-ico" aria-hidden="true">` (the label beside it
names the row) and sizes it to 16 px. Draw in `currentColor` (stroke, fill or both) so the glyph
takes the label chrome's muted colour and follows the theme flip; a hard-coded colour stays put
when the page turns light.

The fragment is printed **unescaped**, like a block's HTML: register only markup your page code
owns, never a string built from settings, `userData` or anything fetched. As with blocks,
registering an id twice overwrites it, and an unregistered id renders nothing.

### Options-resolver registry (PConf.optionsResolvers)

A `select`, `searchSelect`, `radio` or `segmented` item with an
`optionsFrom: { resolver: id, args }` field resolves its option list at render time instead of
using a static `options` array, in the same way as the block registry:

```js
// Returns [[label, value], …]
PConf.optionsResolvers.register('statusSlot', function (state, env, args) {
  return [['None', ''], ['Temperature', 'temp'], /* … */];
});
```

The resolver runs on every render, so the list, labels included, follows any key it reads. A
resolver can rename an option from the live settings as well as filter the list, for example an
option named for whether a toggle is on and a key is typed into a text field. When the list
updates depends on the control that changed:

- After a toggle, a select/searchSelect pick, a radio, a segmented control or a colour, the page
  re-renders at once (after an action button, when its handler returns `true`).
- A text field writes the state on each keystroke but repaints nothing (a re-render would
  swallow the user's next tap). When the field commits (`change`: blur or Enter), the engine
  relabels every rendered `select`/`searchSelect` trigger in place from its freshly resolved
  option list. Only the trigger's label text and `aria-label` change, so the tap still lands. A
  trigger whose stored value is no longer among its options is left alone until the next full
  render snaps it. The option sheet is rebuilt whenever it opens, so it is always current.
  Anything else a text key feeds (hints, `showWhen`, blocks) catches up at the next full render.

A stored value that is no longer among its item's options snaps to the item's default (when
still offered) or the first option. A `dormantValues` value is the exception and stays stored.
Every full render and every Save does this for every shown `optionsFrom` row
(`snapShownOptions`), in schema order, wherever the row sits: on another tab, in a dialog,
behind More options. A pick in one row that takes an option away from another (one forecast
line taking the metric a later line showed) therefore clears it at once, and what is saved
never depends on which rows were drawn. A row hidden by its own, its section's, its pane's or
its tab's `showWhen` keeps its value.

### Defaults-resolver registry (PConf.defaultsResolvers)

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
to `undefined`, and the key stays unset.

`sticky` decides what a save does with a key that still holds its default:

- With `sticky` omitted or `true`, hydrate puts the resolved default into the state, and
  `serialize` writes it back like any value. After the first save the key is stored, so the
  saving watch's default is frozen as a value, and another watch sharing the phone's store reads
  it too. This suits a default that only has to be sensible on first open (WarnWeather's status
  slots).
- With `sticky: false`, `serialize` leaves the key out while its value equals the default
  resolved for the page's `env` (strict equality in the page's shape, so a colour default
  compares as `'#RRGGBB'`). The key stays absent as long as the host saves the blob whole (as
  `getSettings` does) and does not seed it, so it keeps resolving per watch. A different value
  is a pick and is saved as usual. In turn, a pick that equals the saving watch's default is not
  remembered and follows each watch's default like an untouched key. Use it when "absent" is
  itself the contract, e.g. an app packer that resolves an unset key per platform (WarnWeather's
  warn looks).

### Display-resolver registry (PConf.displayResolvers)

An item with a `displayFrom: { resolver: id, args }` field paints a derived value while its
stored value stays untouched. It is for a key whose effective value is computed elsewhere (a
colour that cascades from a sibling key until the user pins it). These read the registry:

- `color` items through `displayFrom` (args get the item's messageKey merged under them).
- Collapsible sections through `titleFrom`, the collapsed card header's value. Args pass through
  verbatim, with no messageKey merged in, since sections have none.
- Titles through a section's `titleBy` and a select's `sheetTitleBy` (args verbatim too).
- A section's header note through `noteFrom` (an object, `{text, label?, info?}`; args verbatim).

```js
// Returns the value to display; return null/undefined for "use the stored value".
PConf.displayResolvers.register('graphNightTint', function (state, env, args) {
  // args carries the item's own messageKey, merged UNDER displayFrom.args
  return cascadedHexFor(state, args.scope);   // '#RRGGBB'
});
```

The write path is unaffected: the control still stores under its own `messageKey`, so picking
the shown value is what pins it. An unregistered resolver id falls back to the stored value.

### Hint-resolver registry (PConf.hintResolvers)

An item with a `hintFrom: { resolver: id, args }` field shows a hint derived from the live
settings, for a hint that depends on keys other than the row's own value (`hintByValue` covers
the row's own value). WarnWeather's line-style pickers use it: each explains the scale of the
metric its own line draws, which lives in a sibling key.

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
that copy builds on it instead of carrying a second copy of the table in its args. WarnWeather's
key-status summary appends "Key ••••1234 · ✓ works" under the provider's "why" text, and the AQI
slot's Day max hint ends on its source's note.

The resolver runs at render time, after the display-snap. The page re-renders its whole body
after every change except a text edit (which waits for the next full render; see the
options-resolver registry above), so the hint follows every key the resolver reads with no
dependency list to declare. `optionsFrom` lists and `showWhen` gates stay current for the same
reason. An unregistered resolver id, or a `null`/`undefined` answer, falls back to `hintByValue`
for the shown value, then `hint`; an empty string means "no hint here".

One commit skips the render on purpose: an arrow-key nudge on a range thumb paints the slider in
place so the thumb keeps focus (range-control.js). A derived hint is therefore re-resolved in
place after it: `renderRow` marks every derived hint element with
`data-hint-for="<messageKey>"`, and the engine rewrites only that element's markup, replacing no
node. No WarnWeather hint uses this: the hints that quote a slider's value (the Alerts card's
`alertLevelsHint`, the Battery row's `onDemandBatteryText`) sit on keyless rows outside the
sheet and refresh on the render that closes it. The library keeps it for a hint that reads a
slider in its own sheet (`test/hint-resolver.test.js` pins it). A hint that rendered empty (no
element) and the row's wrap layout wait for the next full render.

### Picture-resolver registry (PConf.pictureResolvers)

A `radio` item with a `pictureFrom: { resolver: id, args }` field draws its options as picture
cards instead of a list: a radiogroup of cards, each its picture over its name, the picked one
ringed in the accent with its name on the accent fill, and the picked option's hint under them.
WarnWeather's Layout preset uses it: each preset is a card of the Default view it gives.

```js
// Returns ONE option's picture markup; '' draws the card without one.
PConf.pictureResolvers.register('layoutPresetPicture', function (state, env, args, userData) {
  // args carries the row's messageKey and the option's value, merged UNDER pictureFrom.args;
  // userData is the page's (what a block gets)
  return drawDefaultView(state, env, args.value, userData);
});
```

A `select` with `pictureFrom` keeps its trigger and its sheet; the sheet draws each option's
picture at the start of its row, with its name and `desc` beside it (WarnWeather's graph
pickers: each graph and template as it draws). An option whose picture is `''` keeps the plain
row.

The resolver runs once per option the row offers (an `optionsFrom` list is resolved first), at
render time, like the hint resolver. Its markup is printed unescaped inside the card, so only
page code registers here, as for a block. An unregistered resolver id leaves the radio as its
plain list. A tap goes through the radio's own `[data-k][data-v]` path, so `onChange`,
`dormantValues` and Save behave as they do for the list.

### Attention-resolver registry (PConf.attentionResolvers)

An item with an `attentionFrom: { resolver: id, args }` field can say that it needs fixing
before the user saves. WarnWeather's Weather provider row uses it while the picked provider's
API key is missing or the provider is known to have rejected it:

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

The engine reads it in two places on every render:

- In the tab bar, the label of a tab holding a visible row that needs attention (in a visible
  section, a `sheetOnly` one included) ends in a small dot in the info amber (`.tab-dot`,
  `aria-hidden`), and the first such row's `note` joins the tab's `aria-label` in parentheses.
- The Save button first walks the visible tabs in order. The first row that needs attention and
  has a `title` opens a confirm dialog in the shared sheet instead of saving: the title in the
  sheet header, `body` (plain text, escaped) and two buttons. `actionLabel` closes the dialog
  without saving, brings the row's tab to the front and opens the fix: `sheet`, else the row's
  `editSheetFrom` sheet, else the `sheetOnly` section the row sits in. `confirmLabel`
  ("Save anyway") saves exactly as Save does. The close button, the backdrop and Escape close it
  and save nothing.

The check never stands between the user and a save. With nothing to fix, an attention without a
`title`, a resolver that throws, or a webview that cannot open a `<dialog>` (`showModal`
missing), Save saves at once. Only the Save button asks: `runReady`'s `save()` (the setup
wizard's finish) saves directly. The dialog's buttons sit side by side with a margin instead of
a flex `gap`, which old Android WebViews do not lay out.

### When-resolver registry (PConf.whenResolvers)

A `{ when: id, args }` leaf in a `showWhen`, `disabledWhen` or `optionDisabledWhen` predicate
asks a named resolver whether it holds. It is for a rule the app already answers in one of its
own modules: the schema asks that module instead of rebuilding the rule as a tree of `key`
leaves that tests then have to keep equal to it. WarnWeather's Forecast tab rows ask which
picker's line draws their metric, and its Alerts gates ask whether an item shows on a status
bar.

```js
// fn(state, env, args): a truthy answer holds. `state` is the evaluation context, the
// settings with `env` on it; args is the leaf's args ({} when it has none).
PConf.whenResolvers.register('lineRow', function (state, env, args) {
  return hostLine(state, env, args) === args.picker;
});
```

The page re-renders its whole body after every change, so the leaf follows every key the
resolver reads with no dependency list, as a hint resolver does. An unregistered id reads false,
as an `env` fact the host never supplied does.

### Action registry (PConf.actions)

A tapped `button` item dispatches to the registered action by its `action` id. Actions are
assigned directly (there is no `.register()` helper):

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
`data-goto-tab="<tab id>"` instead, and a tap brings that tab to the front, as a tab-bar tap
does. Each tab keeps its scroll offset, and the tab bar scrolls sideways until the new tab
shows. From inside an open sheet, the sheet closes first, and focus lands on the new tab's
button in the tab bar. A tab whose `showWhen` hides it is never opened this way (the tap changes
nothing), so link only to a tab that exists wherever the copy shows (gate the copy with the
tab).

Keep both kinds of link out of copy that sits inside a tap target of its own. Which tap wins
depends on the target. A chevron `sheet` row, a select or date trigger and a card header are
matched before the shared controls, so they take the tap and the link never fires. Inside a
`button` row (`data-action`) the link wins instead (`controlClick` checks `[data-goto-tab]`
before `[data-action]`, and an inline action link is the nearer `[data-action]`), so the row's
own action never runs.

### Hook registry (PConf.hooks)

Hooks fire at page lifecycle events. The context object has `get`/`set` to read and write the
live settings state, and `getInitial` for the values present when the page loaded.

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

Several `onLoad`/`onSubmit` registrations are allowed; they fire in registration order.

## Shared parts (PConf.ui)

`lib/ui.js` has one builder for each piece that more than one place draws, so a tab's rows, a
block's list, a dialog and an app's own full-screen view look the same. The markup is built
there and nowhere else. The look is in `shell.html` (the `.ui-*` rules, and the `.chev` and
`.dlg-*` rules the engine's own parts share). The engine draws its nav rows, folding cards,
dropdowns, Edit buttons, dialog headers and their Delete with it. An app's page modules call it
as `PConf.ui` in the page (`require('…/config-ui/lib/ui.js')` under Node). WarnWeather's
`test/config-ui-parts.test.js` fails on a page file that writes one of these out by hand.

| Builder | Draws |
|---------|-------|
| `navArrow()` | The red arrow (›) at the end of anything that opens a screen of its own: a nav row, a list row that opens a dialog or an editor. |
| `foldChev(open)` | The red ▸ of anything that folds open in place, ▾ while open: a collapsible card's header. The button that carries it sets `aria-expanded`. |
| `deleteButton(label, at)` | Delete: centred in the accent, under (outside) what it deletes. The `style: 'delete'` button item is this. |
| `undoToast(text, at)` | The Undo after a delete, in the list the thing went from. `flash(box, v, ms, repaint)` keeps its text in `box` for `ms`, then repaints without it; `unflash(box)` removes it early. |
| `newRow(label, note, at)` | A list's New row at its foot: the plus and what it makes in the accent, how many there are on the right. |
| `chip(label, at, {icon, on})` | A chip: an Add chip (the plus first) or a toggle chip (tinted and ticked while on). |
| `dropdown(label, at)` | A dropdown: what is picked, then the ▾ that opens its picker. A `select` row's trigger is this, and so is a value an app's own view picks through a sheet (`ctx.openSheet`). |
| `editButton(label, at)` | An Edit button: the outlined text button beside a value that opens what changes it (a row's edit sheet, a dialog an app's own view opens). |
| `penButton(name, at)`, `renameField(o)` | The pencil after a name that renames it, and the name field with OK beside it. |
| `header(o)` | A full-screen view's header: the way out (× or ‹), the kicker over the title with its pencil, Done; while renaming, the name field with OK. |
| `popupHeader(title, closeAt)` | A popup over the page: its title and the × that closes it, in a `.ui-pop` holding a `.ui-pop-card`. |
| `note(text)`, `icon(name)`, `attrs(map)` | A note in the page's info look; a line icon (plus, pen, check, x, grip); a tag's attributes, each escaped. |

`at` is always a tag's attributes as a map (what a tap does, `aria-*`), escaped by `attrs`.
`true` gives a bare attribute, and `null`, `undefined` and `false` leave it out.

## Build step (buildPage)

The page is a self-contained HTML string built once, before `pebble build`. The build step
concatenates the library's WebView files and the app's own browser-side files into
`lib/shell.html`, then emits the result as a `module.exports` string.

```js
// scripts/build-config-page.js  (app-side wrapper; no new dependencies)
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

function run() {
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
`out` as `module.exports = <JSON-stringified HTML string>` and returns `out`. It writes through a
per-process temp file and an atomic rename, so a concurrent reader never sees a half-written
file.

`buildPage({ appFiles })`:

1. Reads `lib/shell.html` (page skeleton, `Object.assign` polyfill, `INJECTED_*` variable
   declarations and two markers) and fills in the page's own font: Inter's Latin variable face
   (`lib/fonts`, from `@fontsource-variable/inter` 5.3.0) as a base64 data URI in its
   `@font-face`, with its licence (SIL OFL 1.1, `lib/fonts/OFL.txt`) as a comment beside it. The
   page requests no font, so it needs no font host in the app's permissions and draws the same
   offline. A letter outside the Latin range falls back to the system font.
2. At the `/*__PCONF_CONCAT__*/` marker, concatenates in order:
   - `lib/schema-walk.js`: single-source schema traversal (`PConf.schemaWalk`)
   - `lib/color.js`: int↔hex color conversion (`PConf.color`)
   - `lib/show-when.js`: predicate evaluator (`PConf.showWhen`)
   - `lib/html.js`: the escape helper, the shared sheet header, the swatch+hex colour readout
     that the `rgb` control and a `chip` badge both print, and a joined row's no-divider class
     (`PConf.html`)
   - `lib/ui.js`: the [shared parts](#shared-parts-pconfui) (`PConf.ui`), after `html.js`, whose
     escape it reads, and before `engine.js`, which draws its own parts with it
   - `lib/date-picker.js`: the date control's value helpers, wheel renderers and scroll-settle
     wiring (`PConf.datePicker`)
   - `lib/range-control.js`: the dual-thumb, one-thumb and threshold sliders: numeric rules,
     renderers, the single-thumb track, and the drag wiring every slider and the `rgb` control
     share (`PConf.rangeControl`)
   - `lib/rgb-control.js`: the `rgb` control's `"r,g,b"` value rules, the swatch readout above
     three single-thumb channel tracks, and its in-place repaint (`PConf.rgbControl`)
   - `lib/checklist.js`: the `checklist` control's renderer, the grid of ticks and the list
     codes it reads (`PConf.checklist`); a tap stays with the engine
   - `lib/links.js`: the page's links to other sites, opened through the Pebble app's
     `Pebble.openUrl` where the page has it (`PConf.links`); `engine.js`'s boot wires it
   - `lib/engine.js`: render engine, registries, hooks, modal shell, event wiring
   - each file in `appFiles`: the app's blocks and hooks
   - `PConf.engine.boot();`, which runs last, after all registrations
3. Keeps the `/*__PCONF_INJECT__*/` marker for runtime injection inside `generateUrl`.

Run this step (wired into `scripts/build.sh` before `pebble build`) whenever `blocks.js`,
`onbuild.js` or any library WebView file changes. `page.generated.js` is a build artifact;
never hand-edit it.

## Clay compatibility

Being a drop-in for Clay has three independent layers, plus the data layer, which is already
drop-in. Layer 1 is built, Layer 2 is a documented adapter that is not built, and Layer 3 is
declined.

### Data layer (already drop-in)

The persisted blob (`clay-settings` localStorage key), the `CLAY_*` AppMessage mapping and the
int color values are byte-for-byte identical to what Clay produced. The C side cannot tell the
library from Clay.

### Layer 1: Clay-shaped instance API (built)

The `createConfig` instance has Clay-compatible methods, so an app's host wiring needs no
changes:

- `generateUrl([opts])`: with no args, reads `values` from storage and `watchInfo` from
  `Pebble.getActiveWatchInfo()`, like `clay.generateUrl()`.
- `getSettings(responseStr)`: parses the `webviewclosed` response, persists it to
  `options.storageKey` (default `'clay-settings'`) and returns the blob, like
  `clay.getSettings`. Clay's second "auto-send" argument is left out on purpose: the library
  never sends AppMessages, the app does. Like Clay, `parseResponse` accepts the response either
  still URI-encoded or already decoded by the host (a leading `{` means decoded), so a `%` in
  user text survives hosts that decode the `pebblejs://close#` fragment themselves.
- `setSettings(key, value)` / `setSettings(object)`: read-modify-write the stored blob.
- `meta.userData`: a mutable object the app fills before calling `generateUrl()`.

Storage is injectable through `options.storage` (default: ambient `localStorage`), so the
library stays testable and independent of the host.

### Layer 2: Clay config-format normalizer (not built)

A `compat/clay.js` would export a `Clay`-shaped constructor:

```js
// hypothetical — not yet implemented
var Clay = require('pebble-config-ui/compat/clay');
var clay = new Clay(clayConfigArray, customFn, options);
```

It would normalize a literal Clay config array (flat sections, `options:[{label,value}]`,
`type:'input'/'radiogroup'/'heading'/'submit'`, `description`, hex color defaults) into this
library's schema and return a `createConfig` instance. An existing Clay app could then swap the
`require`, keep its `config.js`, and have it render. Tabs, `segmented` and blocks could be
adopted later by migrating the schema.

It would be an edge adapter over the core and can be added without touching the engine when a
second project needs it. It is not built because WarnWeather writes the new schema directly for
its richer UI.

The format mapping for an implementor:

| Clay type | This library type |
|-----------|-----------------|
| `toggle` | `toggle` |
| `select` | `select` |
| `radiogroup` | `radio` |
| `color` | `color` (default converted hex → int) |
| `input` | `text` |
| `text` / `heading` | `staticText` |
| `submit` | (omit; boot handles submit) |

### Layer 3: Clay imperative custom-code hook (declined)

Clay's `clayConfig.on(EVENTS.AFTER_BUILD, fn)` with
`getItemByMessageKey().get/.set/.show/.hide/.on('change')`, `clayConfig.serialize()` and the
bundled `minified.$` micro-DOM library is the imperative model this library replaces with
declarative `showWhen` and the block and hook registries. Reproducing it would bring that
complexity back and make the engine's internal HTML a public contract.

A Layer 2 adapter would not execute a Clay `customFn` either; dynamic behavior has to be
rewritten declaratively. `showWhen` handles all conditional visibility, `PConf.hooks.onLoad`/
`onSubmit` handle transient resets and derived changes, and `PConf.blocks` handles arbitrary
HTML/SVG. Apps migrating from Clay's imperative hooks translate them to `showWhen` predicates
and hook callbacks.

## Extraction to an npm package

`src/pkjs/config-ui/` is a self-contained unit, structured so that moving it to the
`pebble-config-ui` npm package is a folder move and needs no rewrite:

- It has its own `package.json`, `README.md` and `test/`. The tests have a few incidental
  WarnWeather references (a fixture URL in `emulator-url.test.js`, a code comment in
  `engine.test.js`) worth removing before extraction; they do not block it.
- The library never `require`s `../settings` or any app module. It receives the schema and the
  built page as arguments.
- The library uses `../polyfills.js`, the repo's shared `Object.assign` /
  `Array.find/findIndex/includes` guards. On extraction, inline those guards into the library's
  own `index.js` or a `lib/polyfills.js`, so the package has no dependencies.
- `"private": true` is set, because the package is not published. The publish step removes it
  and sets the npm org/scope.

Left for the publish step: the npm org/scope, CI for the package, a versioning policy, and
replacing WarnWeather's local `require('../config-ui')` with a `node_modules` dependency. None
of these change the library's code.

When a second project is ready:

```sh
cp -r src/pkjs/config-ui ../pebble-config-ui
# flip "private", set name/scope, then:
npm publish
```

## ES5 constraint

All library files under `lib/` and `index.js` must be written in ES5:

- Use `var`, `function` declarations and string concatenation.
- No arrow functions, `const`/`let`, template literals, `class`, `for…of`, spread,
  destructuring, default parameters, shorthand or computed object members, `?.`/`??`, `**`,
  or a trailing comma in a call.
- No unpolyfilled ES6 built-ins: no `padStart`/`padEnd`, `Object.values`/`entries`,
  `Array.from`, `Promise`, `Map`, `Set`, or `String.prototype.includes`/`startsWith`.
- `Object.assign`, `Math.trunc` and `Array.prototype.find`/`findIndex`/`includes` are safe. The
  PKJS runtime gets them from the repo's `src/pkjs/polyfills.js` (required first). The webview
  page never loads that file and gets them from the guarded shims at the top of
  `lib/shell.html`'s inline script, which runs before every lib and app file.
  `String.prototype.includes` is not polyfilled anywhere.

PKJS-parsed files (`index.js`, `lib/color.js`, `lib/platform.js`, `lib/defaults.js`) must be ES5
because aplite runs the PKJS phone-side JS on a pre-ES6 JavaScriptCore. WebView-only files
(`lib/show-when.js`, `lib/engine.js`) must be ES5 to protect old Android WebViews. The SDK build
does not catch stray ES6, so failures stay silent until runtime.

A test in the suite (`test/config-es5.test.js`) tokenizes every shipped ES5 file and fails on
ES2015+ syntax and on calls to ES2015+ built-ins that nothing polyfills. It also fails on the
ES5 strict-mode errors that ES2015 dropped, which Node therefore never reports: duplicate object
keys and function declarations inside a block. The whole page is one `"use strict"` script, so
either one in any page file stops the page on an old WebView. The test is not a full parser:
`String.prototype.includes` (indistinguishable from the polyfilled Array one) still gets past it.

Test files run in Node and may use modern JS; the ES5 rule applies only to shipped files.

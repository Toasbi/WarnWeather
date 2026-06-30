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
// src/pkjs/settings/blocks.js  (runs in the phone WebView)
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
| `env` | computed from `watchInfo` | Override the computed env (testing only). |

Color conversion (`int ↔ hex`) is handled internally. The app always works in int-valued blobs;
the page always works in hex strings; the library converts at the boundary.

### Re-exported helpers

These pure functions are re-exported at the library's top level for use by PKJS-parsed app code
that needs them without creating a full config instance.

```js
var configUi = require('../config-ui');

// Platform facts
configUi.isColorPlatform(platform)   // boolean — false for aplite/diorite/flint
configUi.computeEnv(watchInfo)       // { color, round, platform } — null-safe

// Color conversion (ES5-safe; no padStart)
configUi.intToHex(n)                 // 0xFFFFFF → '#FFFFFF'
configUi.hexToInt(h)                 // '#FFFFFF' → 16777215

// Schema introspection
configUi.deriveDefaults(schema)      // { messageKey: defaultValue, … } — colors as ints
configUi.deriveColorKeys(schema)     // ['key', …] — all type:'color' messageKeys
```

---

## Schema format

### Top level

```js
module.exports = {
  appName:      "MyApp",
  versionLabel: "v1.0.0",
  tabs: [ /* Tab, … */ ]
};
```

### Tabs, sections, items

```
Schema
  └─ tabs[]
       ├─ id            string  (unique)
       ├─ label         string  (tab bar text)
       └─ sections[]
            ├─ title        string
            ├─ intro        string  (HTML — displayed above items)
            ├─ block        string  (custom-block id — see Registries)
            ├─ collapsible  boolean (renders section as a collapsible card)
            └─ items[]
                 └─ (see Item fields below)
```

### Item types

| `type` | UI element | Wire format | Clay equivalent |
|--------|-----------|-------------|-----------------|
| `toggle` | Switch | `true`/`false` | `toggle` |
| `select` | Dropdown | string | `select` |
| `segmented` | Pill-row (new) | string | `select` (visual variant) |
| `radio` | Stacked radio buttons | string | `radiogroup` |
| `color` | 64-swatch color palette | hex string on wire; **int** in the persisted blob | `color` |
| `text` | Text input | string | `input` |
| `staticText` | Static HTML block; no key | — (not serialized) | `text` |

The seven types above are the complete built-in set. Anything bespoke belongs in a custom block
registered via `PConf.blocks.register` — there are no pluggable control types.

`staticText` items carry their HTML in a `text` field and are emitted verbatim without control
chrome. They are not serialized (no `messageKey`).

### Section and item fields

**Section fields:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Section heading |
| `intro` | string | HTML rendered above items |
| `block` | string | Custom-block id (see [Registries](#registries-and-hooks)) |
| `collapsible` | boolean | Collapses the section into an expandable card |
| `items` | Item[] | The items to render |

**Item fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | One of the seven types above |
| `messageKey` | string | Serialization key — must match the AppMessage/C key |
| `defaultValue` | any | Default value. Color defaults are ints (e.g. `0xFFFFFF`). |
| `options` | `[label, value][]` | Choices for `select`, `segmented`, `radio` |
| `description` | string | HTML description rendered below the label |
| `hint` | string | HTML hint rendered below the control |
| `hintByValue` | `{ value: string }` | Per-value hints; overrides `hint` for the current value |
| `attributes.placeholder` | string | Placeholder text for `text` items |
| `capabilities` | `["COLOR"]` | Clay-compatible sugar: hides the item on b&w platforms |
| `showWhen` | Predicate | Conditional-visibility predicate (see grammar below) |
| `text` | string | HTML body for `staticText` items (only field besides `type`) |

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

// Compound forms
{ all: [ <pred>, <pred>, … ] }               // AND
{ any: [ <pred>, <pred>, … ] }               // OR
{ not: <pred> }                              // negation
[ <pred>, <pred>, … ]                        // shorthand for all:[…]  (AND)
```

Operators supported on `key` and `env`: `eq`, `ne`, `in`, `nin`, and bare truthy (no operator key).

`capabilities: ["COLOR"]` is Clay-compatible sugar internally translated to
`{ env: "color", eq: true }` ANDed with any existing `showWhen`.

### Environment facts (env)

Populated by the library from `Pebble.getActiveWatchInfo()` at `generateUrl` time:

```js
env = {
  color:    true,       // false for aplite, diorite, flint (known 1-bit platforms)
  round:    false,      // true only for chalk
  platform: "basalt",   // raw platform string
  health:   true        // false for aplite (no PBL_HEALTH sensors)
}
// Fallback when watchInfo is unavailable: { color: true, round: false, platform: '', health: true }
```

The set of known 1-bit platforms (`aplite`, `diorite`, `flint`) and the no-health platform
(`aplite`) are Pebble facts owned by the library in `lib/platform.js`. The `color = true` and
`health = true` fallbacks are conservative (show the controls if the platform is unknown). `env.round`
is exposed for forward-compatibility; `env.color` and `env.health` are the load-bearing values.

### Hidden-item serialization rule

An item hidden by `showWhen` or `capabilities` **retains its current value and is still serialized**
— exactly like Clay's `inject.js` `.hide()`. The serializer walks the full schema regardless of
visibility, so the output blob stays complete and the C side is not affected.

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
var buildPage = require('./src/pkjs/config-ui/scripts/build-page.js');

buildPage({
  appFiles: [
    'src/pkjs/settings/blocks.js',
    'src/pkjs/settings/onbuild.js'
  ],
  out: 'src/pkjs/settings/page.generated.js'
});
```

`buildPage({ appFiles, out })`:

1. Reads `lib/shell.html` (page skeleton, `Object.assign` polyfill, `INJECTED_*` variable
   declarations, and two markers).
2. At the `/*__PCONF_CONCAT__*/` marker, concatenates in order:
   - `lib/show-when.js` — predicate evaluator (`PConf.showWhen`)
   - `lib/engine.js` — render engine, block registry, hook registry
   - each file in `appFiles` — the app's blocks and hooks
   - `PConf.engine.boot();` — boot runs last, after all registrations
3. Preserves the `/*__PCONF_INJECT__*/` marker for runtime injection inside `generateUrl`.
4. Writes `out` as `module.exports = <JSON-stringified HTML string>`.

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
library from Clay. Pinned by the golden-blob acceptance test.

### Layer 1 — Clay-shaped instance API (built)

The `createConfig` instance carries Clay-compatible methods so a consuming app's host wiring needs
no changes:

- `generateUrl([opts])` — with no args, reads `values` from storage and `watchInfo` from
  `Pebble.getActiveWatchInfo()`, exactly like `clay.generateUrl()`.
- `getSettings(responseStr)` — parses the `webviewclosed` response, persists to
  `options.storageKey` (default `'clay-settings'`), and returns the blob — like `clay.getSettings`.
  Note: Clay's second "auto-send" argument is intentionally absent; the library never sends
  AppMessages; the app owns that.
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

- **Self-contained:** own `package.json`, `README.md`, `test/` with zero WarnWeather references.
- **No inbound app coupling:** the library never `require`s `../settings` or any app module. It
  receives the schema and the built page as arguments. A grep check enforces this.
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
- No arrow functions, `const`/`let`, template literals, `class`, `for…of`, spread, or
  destructuring.
- No unpolyfilled ES6 built-ins: no `padStart`/`padEnd`, `Object.values`/`entries`,
  `Array.from`, `Promise`, `Map`, `Set`, or `String.prototype.includes`/`startsWith`.
- `Object.assign`, `Array.prototype.find`/`findIndex`/`includes` are safe (polyfilled in the
  repo's `src/pkjs/polyfills.js`, required first).

PKJS-parsed files (`index.js`, `lib/color.js`, `lib/platform.js`, `lib/defaults.js`) must be ES5
because aplite runs the PKJS phone-side JS on a pre-ES6 JavaScriptCore. WebView-only files
(`lib/show-when.js`, `lib/engine.js`) must be ES5 to protect ancient Android WebViews. The SDK
build does not catch stray ES6 — failures are silent until runtime.

An automated regex guardrail in the test suite scans all shipped ES5 files and fails on any
detected ES6 syntax or known-unsafe built-ins.

**Test files** run in Node and may use modern JS — the ES5 rule applies only to shipped files.

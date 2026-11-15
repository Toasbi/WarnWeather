# The settings page

The settings page is WarnWeather's own use of the page engine in `src/pkjs/config-ui/`. The
engine renders tabs, controls and dialogs from a schema and knows nothing about weather; this
folder holds the schema, the custom blocks, the hooks and the previews that make it
WarnWeather's settings. The engine's own reference is `src/pkjs/config-ui/README.md`.

## Where things are

The files sit in one folder per domain context (`docs/adr/0005-architecture-rules.md`), the
same contexts as the phone app:

| Folder | What it holds |
| --- | --- |
| `settings/` | the page's entry (`index.js`, which calls `createConfig`), the schema (`schema.js`), the custom blocks (`blocks.js`), the build-time hook (`onbuild.js`), the defaults policy, the setup wizard (`wizard/`) and the shared SVG helpers |
| `weather/` | the provider and radar rows, the key status and Test buttons (`keys/`), the request budgets (`budgets/`), the Weather tab (`weather-tab/`), the radar preview and the weather condition icons (`condition-icons.js`) |
| `forecast-graphs/` | the graph styles page, the line and metric rows, the forecast, axis, rain and stripe previews |
| `status-bars/` | the status bar preview, the slot icons and the reset to defaults |
| `alerts/` | the Alerts tab and its level rows |
| `layout/` | the screens page, the watch preview, the presets, the clock glyphs and the watch's text fonts |
| `calendar/`, `theme/`, `health/`, `notices/`, `telemetry/` | each context's rows and previews |

A module the page and the phone app both use (a palette, the news protocol, the weather tab's
model) is domain code of its context and lives in `src/pkjs/<context>/domain/`, not here.

## How the page is built

`scripts/build-config-page.js` concatenates the engine's files and this folder's files into
one script inside the engine's HTML shell and writes `src/pkjs/settings/page.generated.js`
(a build artifact, never edited by hand). `mise build` and `mise test` run it.

The page runs in the phone's webview as one flat script, so its files find each other
through `window` globals there, and through `require()` under Node. Many files read another
file's global while their own body runs, so the order of `APP_FILES` in
`scripts/build-config-page.js` matters. `test/page/settings/config-page-bundle.test.js` pins
it, because a wrong order throws only on a real phone.

## Rules for page code

- ES5 only, like all of `src/pkjs`: old Android webviews run it (`test/repo/config-es5.test.js`).
- Previews draw what the watch draws by calling the phone app's domain modules, never by
  copying their rules.
- The page requires no phone adapter or shell code. The one exception, the Weather tab's own
  data layer (`weather/adapter/weather-tab-data.js`, which the phone also uses to prefetch),
  is listed in `test/architecture/pkjs-graph.test.js`.
- To see the page without an emulator, run `mise preview-config`
  ([DEV.md](../../../DEV.md#config-ui-preview-no-emulator)).

## Tests

The page's tests mirror this folder under `test/page/<context>/`. Most drive the real
generated page against a fake DOM (`test/helpers/page-harness.js`).

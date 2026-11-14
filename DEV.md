# Developer reference

DEV.md is the reference for ForecasWetter's commands, scripts and config. The setup walkthrough is in [CONTRIBUTING.md](CONTRIBUTING.md), and the release-time steps are in [RELEASE.md](RELEASE.md).

## Prerequisites

Install the toolchain (Python, pebble-tool and the uv it builds the SDK with, Deno, Supabase CLI, resvg):
```bash
mise install
```

Install JS dependencies:
```bash
npm install
```

Create the local env file, then fill in the values:
```bash
cp .env.example .env
```

## mise tasks

Build `.pbw` (dev profile):
```bash
mise build
```

Clean and rebuild:
```bash
mise rebuild
```

Remove build artifacts:
```bash
mise clean
```

Build the weather plugins' pbws (plugin-only, no Pebble SDK needed; see
`plugins/README.md`). Name plugin folders to build only those, e.g. `mise build-plugins -- dwd`:
```bash
mise build-plugins
```

`mise test-c` runs the host-compiled C tests (layout golden rects); `mise test` runs
them too. `mise test-c -- dump` prints the actual rects for deliberate golden updates.

Regenerate `package.json` from the template and profile:
```bash
mise prepare-package
```

Build and install on a physical Pebble (reads `IP` from `.env`):
```bash
mise install-phone
```

Build and install via CloudPebble:
```bash
mise install-cloud
```

Build and install on the emulator (default: basalt):
```bash
mise install-emulator
```

Open the running emulator app's config (settings) page in a browser (default: basalt):
```bash
mise config-emulator
```

Render a static preview of the config (settings) page to `build/` without an emulator
(default: basalt):
```bash
mise preview-config
```

Stop the running emulator and phone simulator:
```bash
mise kill-emulator
```

Take a screenshot from the emulator (default: basalt):
```bash
mise screenshot-emulator
```

Take a screenshot from the phone (reads `IP` from `.env`):
```bash
mise screenshot-phone
```

Capture screenshots for all platforms (replace `v1.4.1` with the version):
```bash
mise capture-screenshots v1.4.1
```

Capture the curated store configs on every platform (5 configs × 5 platforms):
```bash
scripts/capture-store-shots.sh v1.4.1
```

Capture two-phase (forecast + radar/wind) time-lapse frames on all five platforms:
```bash
mise capture-timelapse v1.4.1
```

Assemble a time-lapse GIF from captured frames (args: version platform [fps]):
```bash
mise gif v1.4.1 basalt
```

Composite the README hero shots (from the store captures) into framed PNGs:
```bash
mise composite v1.4.1
```

Composite a single screenshot PNG into an SVG Pebble frame:
```bash
mise composite-screenshot
```

Regenerate `resources/banner-*.png` (README and store banners) from a showcase scene
and a phone settings-UI screenshot. It rebuilds the gradient background, the tagline and
the phone and watch mockups (needs Pillow: `pip install pillow`):
```bash
mise gen-banner v1.6.2 3 "resources/app screenshot.jpeg"
```

Serve the `telemetry-ingest` edge function locally:
```bash
mise telemetry-serve
```

Type-check each edge function's `index.ts` and run its Deno test suite (rainbow-nowcast, news and
telemetry-ingest). This is a separate runner from `mise test`, and CI runs it before
`supabase functions deploy`:
```bash
mise test-deno
```

Build and print the aplite image footprint (text+data+bss, the leading indicator for heap):
```bash
mise aplite-size
```

Fail when the aplite image exceeds the launch-safety ceiling (~22.06 KB). Run it
before shipping aplite changes:
```bash
mise check-aplite-size
```

Fail when a 64 KB watch's image (basalt, diorite, flint) grows past its recorded
ceiling. Their heap comes out of the same 64 KB, so image bytes are heap bytes;
the ceilings and the open heap gate are explained in `scripts/check-64k-size.sh`.
Run it after C changes:
```bash
mise check-64k-size
```

### Build

Dev profile (default):
```bash
mise build
```

Release profile:
```bash
mise build release
```

Clean then build (dev):
```bash
mise rebuild
```

### Install on phone

IP from `.env`:
```bash
mise install-phone
```

Explicit IP:
```bash
mise install-phone <IP>
```

Explicit IP, release build:
```bash
mise install-phone <IP> release
```

Stream logs after install (pebble install flags pass through, also in the separator form
`mise install-phone -- --logs`):
```bash
mise install-phone --logs
```

Install through CloudPebble, dev build (default) or release build:
```bash
mise install-cloud
mise install-cloud release
```

### Install on emulator

Platforms: `aplite` · `basalt` · `diorite` · `emery` · `flint`

Dev build, basalt (defaults):
```bash
mise install-emulator
```

Choose platform:
```bash
mise install-emulator basalt
```

Release build:
```bash
mise install-emulator release
```

Release build on specific platform:
```bash
mise install-emulator release basalt
```

Platform from env var:
```bash
PEBBLE_EMULATOR=basalt mise install-emulator
```

Stream logs after install (pebble install flags pass through, also in the separator form
`mise install-emulator -- --logs`):
```bash
mise install-emulator --logs
```

### Config page (emulator)

Open the live config (settings) page of the app running in the emulator in your browser.
This is the real page PKJS serves. Install the app on that platform first (e.g.
`mise install-emulator aplite`), since the config URL comes from the running app.

Default (basalt):
```bash
mise config-emulator
```

Specific platform (positional, as in `install-emulator` and `screenshot-emulator`):
```bash
mise config-emulator aplite
```

Platform from env var:
```bash
PEBBLE_EMULATOR=aplite mise config-emulator
```

`mise preview-config` (below) renders a static HTML snapshot of the config UI to `build/`
without the emulator; `mise config-emulator` opens the live page the running app serves.

### Config UI preview (no emulator)

`mise preview-config` renders a static HTML snapshot of the config UI to
`build/config-ui-preview.html`, with the real schema, blocks and onBuild hooks injected.
Open it in a desktop browser to look at and use the settings UI (tabs, toggles, color
picker) without the emulator. It reads the source (`shell.html`, `blocks.js`) fresh each run,
so it always reflects the current page. Args are `[out] [platform]`,
parsed order-independently: a bare platform name picks the platform and keeps the
default output path. Alias: `mise preview`.

Default (`build/config-ui-preview.html`, basalt):
```bash
mise preview-config
```

Choose platform, default output path (aplite gives the B/W rendering):
```bash
mise preview-config -- aplite
```

Explicit output path and platform:
```bash
mise preview-config -- preview.html aplite
```

### Kill emulator

Stop the running emulator and phone simulator:
```bash
mise kill-emulator
```

### Screenshots

Emulator screenshot, basalt (default), saved to `screenshot/tmp/<timestamp>-<platform>.png`:
```bash
mise screenshot-emulator
```

Emulator screenshot, specific platform:
```bash
mise screenshot-emulator basalt
```

Emulator screenshot, flag form:
```bash
mise screenshot-emulator -- --emulator flint
```

Emulator screenshot with platform from env var:
```bash
PEBBLE_EMULATOR=emery mise screenshot-emulator
```

Emulator screenshot to an explicit output path, with extra screenshot args:
```bash
mise screenshot-emulator -- screenshot/my-capture.png --no-open --no-correction
```

Phone screenshot (IP from `.env`), saved to `screenshot/tmp/<timestamp>.png`:
```bash
mise screenshot-phone
```

Phone screenshot with explicit IP:
```bash
mise screenshot-phone <IP>
```

Phone screenshot to an explicit output path:
```bash
mise screenshot-phone -- screenshot/my-capture.png
```

Capture screenshots for all platforms, no fixture:
```bash
mise capture-screenshots v1.4.1
```

Capture screenshots for all platforms with a fixture:
```bash
mise capture-screenshots v1.4.1 berlin
```

#### Store screenshots

Capture all five curated store configs on every platform and file them per platform
under `screenshot/<version>/store/<platform>/<config>.png` (the appstore wants at least one
screenshot per supported platform):
```bash
scripts/capture-store-shots.sh v1.4.1
```

Resume from a given round if a run crashed partway (e.g. round 4):
```bash
scripts/capture-store-shots.sh v1.4.1 4
```

The five configs come from fixtures: `1-calendar` (`store-calendar`),
`2-radar-multicolor` (`berlin`), `3-wind-gust` (`windy`), `4-radar-white-wind`
(`store-wind-radar`) and `5-precip-uv` (`precip-uv`). Upload each platform's five raw
frames to the store as they are.

#### README hero shots

Composite the README hero shots from the store captures into framed PNGs. `mise composite`
reads the chosen config per device from `screenshot/<version>/store/<platform>/<config>.png`
(Pebble Time from flint/calendar, Pebble 2 Duo from flint/wind and Pebble Time 2 from
emery/radar) and writes them to `screenshot/<version>/composite/`:
```bash
mise composite v1.4.1
```

Composite a single screenshot into a device frame:
```bash
mise composite-screenshot <pebble-time-red|pebble2-duo-white|pebble-time2-red> <screenshot.png> <output.png>
```

The device frames and banner templates come from
[Appstore Assets](https://developer.rebble.io/guides/appstore-publishing/appstore-assets/) in
the Pebble docs. Its download links are broken (see
https://github.com/pebble-dev/developer.rebble.io/issues/37); the files are on the Wayback
Machine (e.g. [banner templates](https://web.archive.org/web/20161207160612/https://s3.amazonaws.com/developer.getpebble.com/assets/other/banner-templates-design.zip)).
Some downloaded frame assets have other device names. Rename them: `core-time2-red.svg`
becomes `pebble-time2-red.svg`, and `pebble2-white.svg` becomes `pebble2-duo-white.svg`.

#### Showcase GIF (README hero)

The README's animated hero is the showcase GIF: a handful of curated scenes (different
layouts and functions) captured per platform and cross-faded into one looping GIF. Scenes
live in `scripts/gen-showcase-fixtures.js` (regenerated into `fixtures/showcase-N.json`
on every capture) and are guarded by `test/showcase-fixtures.test.js`. Most are built on
the Berlin base; a scene with `fixture` copies a fixture of its own (the Miami scenes).
The table's row order is the GIF and reel order. Ids only name the frames
(`scene_<id>.png`), so moving a scene never renames its frame. A scene with `platforms`
is captured, shown and put in the reel intro only there. A scene with `inShowcase: false` is
captured with the rest but left out of the GIF and the reel intro (the Light-theme Miami
scenes 10-12, for the store); a fixture-backed scene's `clay` layers on its fixture's
settings (their `theme: 'light'`).

Health readings and the rain alert are read live on the watch and don't reproduce in a
static compile-time fixture, so screenshot builds swap in two canned twins (wired in
`wscript`, never shipped in a normal build):

- `WW_HEALTH_FIXTURE=1` selects `src/c/services/health_fixture.c`: canned steps, sleep and
  heart rate. `WW_HEALTH_FIXTURE=low` swaps in the same twin with a quiet day's hourly steps
  (every hour under 100), which puts the health graph on its lowest step scale (0.1k).
- A fixture `countdown` block selects `src/c/appendix/rain_countdown_fixture.c`: the rain alert
  on every side Rain is placed on (the Watch Status Bar's left side by default; the Rain
  alert's Shows on grid, Alerts tab, puts it Left or Right on any bar). The block is
  `{ mins, raining, tier }`, where `tier` (1-5) picks the drops, their colour and the noun.
  `{ mins: 15, raining: false, tier: 3 }` prints "Rain in 15'" with the 'text' rain look
  and `15'` with the 'minutes' one; `{ mins: 20, raining: true, tier: 3 }` prints
  "Rain for 20'" or `+20'`. Tier 1-2 reads "Drizzle", and `mins: 100` is past the 99-minute cap.
  Like the real alert, it shows nothing while the fixture's settings place Rain on no side
  (or switch the radar off) or the radar is snoozed. The minutes are canned, so a time
  window shorter than them does not hide the alert.

Capture the default platforms (aplite, basalt, flint, emery), or a subset via `PLATFORMS`,
and only some scenes via `SCENE_IDS` (the other frames stay as they are):
```bash
scripts/capture-showcase.sh <version>                    # aplite basalt flint emery
PLATFORMS=basalt scripts/capture-showcase.sh <version>   # one platform
SCENE_IDS="10 11 12" scripts/capture-showcase.sh <version>   # just those scenes
```
It is a thin wrapper over `capture-screenshots.sh`, like `capture-store-shots.sh`. Per scene
it exports `WW_HEALTH_FIXTURE=1` and `FLICKS=<scene flicks>`, shoots the platforms and files
each frame to `screenshot/<version>/showcase/frames/<platform>/scene_N.png`. A fresh build
runs per scene, so after changing watch C code just run it again; run `mise clean` first if a
stale waf cache would skip the recompile.

Scenes that need per-platform slots declare a `variants` map in `gen-showcase-fixtures.js`
(as `gen-reel-fixtures.js` does). Each entry writes a platform variant fixture
(`showcase-N-<platform>.json`) that layers its overrides on the scene clay, and the wrapper
shoots that platform from it while the rest share the base fixture. Emery uses this because
it is the only HR platform in the set and would otherwise bake the base health-right default
(walked distance) instead of the heart rate a real Pebble Time 2 renders. Aplite uses it
because it has no health slots and falls back to weather and date slots.

Assemble one platform's frames into the looping, cross-faded GIF
(`screenshot/<version>/showcase/<platform>-showcase.gif`):
```bash
scripts/assemble-showcase-gif.sh <version> <platform> [hold_secs] [fade_secs] [fps]
# defaults: hold=1, fade=0.55, fps=15

# MAX_SCENES=N  keep only the first N scenes (default 2; 0 = all captured scenes)
# EXCLUDE_SCENES="2 3 4"  drop specific scene ids (applied before the MAX_SCENES cap)
```
The health-graph scene (5) and the Miami scenes (7-9: stripes, radar, custom layout) are
limited to the colour platforms in the table, so aplite captures and shows only its own
scenes (1, 2, 4, 6) with no flags. `EXCLUDE_SCENES` still drops further ids by hand.

#### Promo reel (Pebble-store asset)

The reel is a separate, self-contained per-platform GIF for manual app-store upload: the
intro showcase scenes, then three captioned chapters (Themes, Graph, Status), each filtered
to the platform's capabilities. It never touches the README hero.

- The chapters, the text-card copy and the capability matrix live in
  `scripts/gen-reel-fixtures.js` (guarded by `test/reel-fixtures.test.js`).
  `scripts/gen-text-cards.py` (Pillow) renders the text cards.
- Intro frames are reused from the hero capture, so run `capture-showcase.sh <version>`
  first. The intro scene set and order come from the showcase table in
  `gen-showcase-fixtures.js` (scenes flagged `reelIntro: false` are skipped), so reordering
  the showcase reorders the reel intro.

```bash
scripts/capture-showcase.sh <version>   # once, for the intro frames
scripts/capture-reel.sh <version>        # captures chapters + assembles per-platform reels
```

Output: `screenshot/<version>/promo/<platform>-reel.gif`. Per-platform differences are
automatic: aplite has no themes chapter and no radar or health frames, flint shows 2 themes
(dark and light) and no HR, and emery shows 4 themes and heart rate. Reels stay on disk
(not committed) for manual upload. Re-assemble a single reel without recapturing with
`scripts/assemble-reel.sh <version> <platform> [fps]`.

### Pixel icons

The status icons are drawn pixel by pixel, once per size, in the pixel icon editor:

```bash
python3 scripts/pixel-icons/build_editor.py          # -> build/pixel-icons/editor.html
python3 scripts/pixel-icons/import_pixels.py --export editor-export.json
node scripts/pixel-icons/gen_watch_icons.js          # the icons marked done, into the watch
```

The whole process, the sizes and the file formats: `scripts/pixel-icons/README.md`.

### Package generation

`package.json` is generated from `package.template.json` and a profile in `profiles/`
(`profiles/package.dev.json` or `profiles/package.release.json`). `mise build` and
`mise build release` generate it before they build; `mise prepare-package` regenerates it
without building.

Dev profile (default):
```bash
mise prepare-package
```

Release profile:
```bash
mise prepare-package release
```

## Environment variables (`.env`)

| Variable | Description |
|----------|-------------|
| `IP` | Pebble phone IP address for install and screenshots |
| `FIXTURE` | Fixture name to load (e.g. `berlin`). Fixture files: `fixtures/<name>.json` |
| `ENABLE_MEMORY_LOGGING` | Set to `1` to enable the extra Pebble heap debug logs in the build, with either package profile. It does not build on aplite (the `MEM\|` logging overflows `.bss`), so capture heap logs on diorite or another platform. On the 64 KB watches it costs about 3.1 KB of heap and links only while the release image leaves that much room; `scripts/check-64k-size.sh` has the numbers |
| `PEBBLE_EMULATOR` | Default emulator platform (e.g. `basalt`) |
| `TELEMETRY_ENDPOINT` | Telemetry function URL. It ships commented out in `.env.example`, and telemetry is off without it. Local stack: `http://127.0.0.1:54321/functions/v1/telemetry-ingest`. Set for release/CI builds via the `TELEMETRY_ENDPOINT_RELEASE`/`_PREVIEW` repo secrets (`https://<your-project-ref>.supabase.co/functions/v1/telemetry-ingest`) |
| `TELEMETRY_HASH_SECRET` | Secret for server-side HMAC hashing of IDs. Generate one with `openssl rand -hex 32` |
| `RAINBOW_PROXY_ENDPOINT` | Rainbow nowcast proxy URL baked into the bundle. Set for release/CI builds via the `RAINBOW_PROXY_ENDPOINT_RELEASE`/`_PREVIEW` repo secrets. A release build hard-fails if it is empty: Rainbow is the default radar provider, and an empty endpoint still shows the option but makes every Rainbow radar fetch fail soft, so no radar reaches the watch. Dev and fork builds may leave it empty on purpose. It also reaches the settings page (userData `rainbowEndpoint`) for the Rainbow API key's Test button (Graphs tab › Rain radar, the key dialog of *Rainbow (own key)*); when it is empty, the button says the test isn't available |
| `NEWS_ENDPOINT` | News edge-function URL baked into the bundle. Set for release/CI builds via the `NEWS_ENDPOINT_RELEASE`/`_PREVIEW` repo secrets. A release build hard-fails if it is empty, since the config page's news pill would otherwise be silently disabled for every user |
| `AQICN_TOKEN` | Shared WAQI (aqicn.org) token baked into the bundle. Set for release/CI builds via the `AQICN_TOKEN_RELEASE`/`_PREVIEW` repo secrets. A release build hard-fails if it is empty: WAQI is the default AQI source, so every device would otherwise silently fall back to Open-Meteo |

## Fixtures

A fixture is a deterministic UI state for emulator builds. Set `FIXTURE=<name>` in `.env`
before building or installing. Fixture data is committed in `fixtures/<name>.json`. Fixture
time and battery state are compiled into the app through `watch.now` and `watch.battery`;
`scripts/install-emulator.sh` does not call Pebble's emulator setting controls. While a
fixture is active, put Clay values that change the rendering in its `claySettings`.

Fields supported in `fixtures/<name>.json`:
- `watch.now`: date and time for the C-rendered time and date UI
- `watch.battery.percent` / `watch.battery.charging`
- `watchSettings.timeFormat`: `"12h"` or `"24h"`
- `claySettings`: Clay settings by `messageKey` (colors use Pebble SDK constants like `"GColorFolly"`; see the [Rebble color definitions](https://developer.rebble.io/docs/c/Graphics/Graphics_Types/Color_Definitions/))
- `weather.city`, `weather.currentTemp`: status-row city label and current temperature (°F)
- `weather.startHour`: local hour (0 to 23) of the first forecast entry; fixture prep converts it to a runtime epoch
- `weather.startDayOffset`: optional day offset added to `watch.now.day` for the forecast start (default 0; pairs with `startHour`)
- `weather.temps`: hourly Fahrenheit forecast array. Its length (and the other hourly arrays') is the feed's: a watch is sent at most the hours its stored time span sends (`src/pkjs/forecast-span.js` `hours()`: 14, 24 (26 with no left axis) or 68 on emery, 24 everywhere else). `forecast-long` is a full 68-hour feed for emery's long span. `forecast-48h` is a 48-hour one (OpenWeatherMap's; Weather Underground's is 49, the hour in progress and its 48), drawn at a wider, fractional pitch that fills the plot (`src/c/appendix/forecast_span.h`)
- `weather.precipPct`: hourly precipitation-probability array (0 to 100)
- `weather.cloudPct`: optional hourly cloud-cover array (0 to 100) for the cloud-cover metric; without it that line stays off
- `weather.rainMm`: hourly rain-amount array (mm) for the optional rain bars
- `weather.windKmh` / `weather.gustKmh`: hourly wind and gust speed arrays (km/h); a non-zero gust array turns the gust line on
- `weather.rainRadarExactMm` / `weather.rainRadarAreaMm`: radar rain per 5-minute frame (mm/h): rain at the exact location, and the strongest rain within 2 km. Supply both or radar is skipped
- `weather.sky`: optional radar sky rows, `{ cloudPct, sunPct, lightning }`, one entry per 15-minute slot from the quarter hour holding the radar start. The percentages are cloud cover and sun strength against a clear sky, each shaded on its row's own scale in `src/pkjs/stripe-levels.js`: under 10 % draws nothing, 10 to 29, 30 to 59 and 60 to 89 % draw the three lighter steps, and 90 % and up draws full colour. Lightning is 0 or 1. Sent as `RADAR_SKY_UINT8` with the radar
- `weather.radarStartEpoch`: optional Unix-seconds anchor for the radar window (defaults to the forecast start; the time-lapse uses it to scroll radar independently of the forecast)
- `weather.sunEvents`: next two sun events, authored as local fields `{ type, dayOffset, hour, minute }` and normalized to `{ type, epoch }`

## Debug flags (`src/pkjs/dev-config.js`)

| Key | Type | Effect |
|-----|------|--------|
| `clearPkjsStorageOnBoot` | `true/false` | Forces PKJS `localStorage` reset on each boot. Keep it `true` only while testing first-install behavior, and set it back to `false` before testing upgrade-notification behavior |
| `forceShowReleaseNotificationOnBoot` | `'1.26.0'` | Shows the release notification for that version key on every boot, whatever the upgrade state. The string must match a key in `release-notifications.json` exactly. Use it to work on the next entry's copy while `package.json` is still on an older version; remove it (or comment it out) when testing normal upgrade behavior |
| `owmApiKey` | `'abc123'` | Preloads OpenWeatherMap API key |
| `maxNotifiedVersion` | `'1.26.0'` | Seeds the release-notification "max notified version" marker (simulate skipped-version upgrades) |
| `resetV134WeekendHolidayColorMigration` | `true/false` | Clears the v1.34.0 weekend/holiday color migration marker so it re-runs on next boot |
| `resetV140HolidayRegionKeyMigration` | `true/false` | Clears the v1.4.0 holiday-region-key migration marker so it re-runs on next boot |
| `resetUpdateNotifiedVersion` | `true/false` | Clears the update-notification "already notified" version marker and the last-check timestamp, so the daily update check re-runs on next boot |

These flags are local only: they are not committed or written to Clay settings. Set one as
an export, e.g. `module.exports.clearPkjsStorageOnBoot = true;`.

## Logging

C:
```c
APP_LOG(APP_LOG_LEVEL_DEBUG, "msg %d", value);
MEMORY_LOG_HEAP("tag");
```

JS:
```js
console.log("msg");
```

## Supabase (telemetry and Rainbow proxy)

Telemetry runs on Supabase Edge Functions and Postgres. `mise install` installs and updates
the Supabase CLI through its aqua backend (pinned in `mise.toml`); check it with
`supabase --version`.

Start the local Supabase stack (from the repo root):
```bash
supabase start
```

Serve the telemetry edge function locally:
```bash
mise telemetry-serve
```

Stop the local Supabase stack:
```bash
supabase stop
```

Local Studio is at http://127.0.0.1:54323; inspect `public.telemetry_weather_fetch` there.
For the local stack, set `TELEMETRY_ENDPOINT` in `.env` to the local URL in the
[env var table](#environment-variables-env).

### Migrations

Never write `migrations/` files by hand. Edit `schemas/` and generate a migration from the changes:
```bash
supabase db diff -f <label>
```

### Deploy (hosted)

`.github/workflows/supabase-deploy.yml` deploys on every push to `main` that touches
`supabase/**`: it runs `supabase db push --yes` and a bare `supabase functions deploy`,
which with no function name deploys all edge functions (telemetry-ingest, rainbow-nowcast
and news). The commands below are for manual or local deploys.

With Supabase's GitHub sync and branching (optional), Supabase applies migrations and deploys
functions from `supabase/` when a branch or PR updates. Enable it in Supabase Dashboard >
Project Settings > Integrations.

Authenticate with Supabase:
```bash
supabase login
```

Link the repo to the hosted project:
```bash
supabase link --project-ref <project-ref>
```

Set a function secret (generate the value with `openssl rand -hex 32`):
```bash
supabase secrets set TELEMETRY_HASH_SECRET=<value>
```

Dry-run the database migration:
```bash
supabase db push --dry-run
```

Apply the database migration:
```bash
supabase db push
```

Deploy the telemetry edge function:
```bash
supabase functions deploy telemetry-ingest
```

telemetry-ingest never puts the account-token hash in a URL the gateway logs: its hourly rate
check is the `telemetry_recent_insert_count` RPC in `supabase/schemas/telemetry.sql` (arguments in
the POST body, service role only), and the insert carries both hashes in its row bodies. Its logs
carry a fixed tag plus at most a Postgres/PostgREST code (`log.ts`). The function needs that RPC,
so the migration goes out first (CI runs `db push` before `functions deploy`); until it exists,
every post is a `500 rate_check_failed`, which the phone retries.

Serve the rainbow-nowcast edge function locally:
```bash
supabase functions serve rainbow-nowcast --env-file .env
```

Set the Rainbow proxy secrets (hosted):
```bash
supabase secrets set RAINBOW_API_KEY=<key from https://developer.rainbow.ai/profile>
supabase secrets set RAINBOW_MONTHLY_BUDGET=5000   # optional; default 5000 upstream calls per UTC month (raise to accept paid overage — no redeploy needed)
supabase secrets set RAINBOW_IP_HOURLY_CAP=30      # optional; default 30 cache-miss requests per IP per hour
supabase secrets set RAINBOW_IP_HASH_KEY=$(openssl rand -hex 32)   # optional; pepper for the stored keys (below), else the service-role key
```

The nowcast (the endpoint's root) takes a POST of `{"lat", "lon", "start"}` (sent as `text/plain`, a
CORS simple request; the body is read whatever the content type) and answers `{"forecast": [...]}`.
Coordinates are rounded to 3 decimals (~110 m) on the phone and again on the proxy, so no URL the
gateway logs carries a position. A `GET ?lat&lon&start` is also accepted, for app versions that
send it (remove once telemetry shows none). The proxy stores no place and no IP: the cache key and
the per-IP hourly bucket are HMAC-SHA-256 under keys derived from the pepper (`keys.ts`), the cache
read and both counters are RPCs (keys in the POST body), the cached payload is the forecast only,
and function logs carry a fixed tag plus at most a Postgres/PostgREST code (`log.ts`).
```bash
curl -s -X POST --data '{"lat":52.52,"lon":13.405,"start":'$(( $(date +%s) / 300 * 300 ))'}' "$RAINBOW_PROXY_ENDPOINT"
```

Deploy the rainbow-nowcast edge function:
```bash
supabase functions deploy rainbow-nowcast
```

Key-check mode is on the endpoint's `/key-check` path. It backs the settings page's *Test*
button beside the Rainbow API key, in the key dialog of *Rainbow (own key)* (Graphs tab › Rain
radar). A POST of `{"key":"..."}` as `text/plain` makes one Rainbow call with that key at a fixed,
always-covered point (Berlin) and answers HTTP 200 `{"status": <Rainbow status>}`. Any other
HTTP status is the proxy's own error, never a key verdict: 400 (missing key, or not shaped like
a Rainbow key), 413 (body over 1 KB), 429 (more than 5 checks per IP per minute) and 504
(Rainbow didn't answer within 5 s). It touches no DB, cache or shared wallet, logs nothing, and
costs one call on the tested key (none on the project's):
```bash
curl -s -X POST --data '{"key":"<your key>"}' "$RAINBOW_PROXY_ENDPOINT/key-check"
```

Accepted risk: `/key-check` is an unauthenticated relay. Anyone who knows the endpoint can have
the project's egress make one Rainbow call per POST with a key of their choosing (probing keys,
or wearing down the standing with Rainbow that the shared radar also runs on), and every POST
costs an edge invocation. The only limit is a best-effort in-memory counter in `key-check.ts`: 5
checks per IP per minute, per isolate, reset on every cold start and not shared across isolates,
so a caller hitting several isolates gets more. If abuse shows in `function_edge_logs` (a run of
POSTs to `rainbow-nowcast/key-check`), harden it in `key-check.ts`: either count key checks in
the DB-backed hashed per-IP bucket the nowcast's hourly cap uses (`keys.ts` `ipHourKey` +
`increment_rainbow_ip_usage`, under a separate key prefix so checks don't eat the radar's cap),
or require a header only the settings page sends (it then preflights, so add the header to the
CORS `Access-Control-Allow-Headers`).

Deploy the news edge function:
```bash
supabase functions deploy news
```

The news function never puts the account-token hash in a URL the gateway logs: the list (items,
seen watermark and the caller's votes in one call), the seen upsert and the rate-limit counts are
RPCs in `supabase/schemas/news.sql` (arguments in the POST body, service role only), and the vote
upsert and reply insert carry it in their row bodies. Its logs carry a fixed tag plus at most a
Postgres/PostgREST code (`log.ts`). The function needs those RPCs, so the migration goes out first
(CI runs `db push` before `functions deploy`).

## Upgrading pebble-tool

`mise.toml` pins `pipx:pebble-tool` to an exact version, fully resolved in `mise.lock`.

Bump the pinned version in `mise.toml`:
```bash
mise upgrade "pipx:pebble-tool" --bump
```

Re-install toolchain after bump:
```bash
mise install
```

## Key files

| Path | Purpose |
|------|---------|
| `mise.toml` | Tool versions and task definitions |
| `package.template.json` | Pebble config template |
| `profiles/` | Dev and release profile overrides |
| `fixtures/` | Deterministic emulator state files |
| `scripts/` | Shell and JS helper scripts |
| `src/pkjs/dev-config.js` | Local-only dev behavior switches |
| `release-notifications.json` | "What's new" toast copy keyed by version |
| `supabase/schemas/` | Declarative DB schemas (source of truth) |
| `supabase/functions/` | Edge functions |
| `plugins/` | Weather plugins for the Pebble app, released separately from the watchface |
| `screenshot/<version>/raw/` | Raw platform screenshots (last capture run) |
| `screenshot/<version>/store/` | Per-platform store screenshots (5 configs each) |
| `screenshot/<version>/composite/` | Composited README hero screenshots |

# Developer Reference

Quick-reference for commands, scripts, and config. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and walkthrough prose.

## Prerequisites

Install all toolchain (Python, pebble-tool, Deno, Supabase CLI, resvg):
```bash
mise install
```

Install JS dependencies:
```bash
npm install
```

Create local env file (then fill in values):
```bash
cp .env.example .env
```

## mise Tasks

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

- `mise test-c` — host-compiled C tests (layout golden rects). Also runs inside
  `mise test`. `mise test-c -- dump` prints the actual rects for deliberate
  golden updates.

Regenerate `package.json` from template + profile:
```bash
mise prepare-package
```

Build and install on physical Pebble (reads `IP` from `.env`):
```bash
mise install-phone
```

Build and install via CloudPebble:
```bash
mise install-cloud
```

Build and install on emulator (default: basalt):
```bash
mise install-emulator
```

Open the running emulator app's config (settings) page in a browser (default: basalt):
```bash
mise config-emulator
```

Stop running emulator and phone simulator:
```bash
mise kill-emulator
```

Take a screenshot from emulator (default: basalt):
```bash
mise screenshot-emulator
```

Take a screenshot from phone (reads `IP` from `.env`):
```bash
mise screenshot-phone
```

Capture screenshots for all platforms (replace `v1.4.1` with version):
```bash
mise capture-screenshots v1.4.1
```

Capture the curated store configs on every platform (4 configs × 5 platforms):
```bash
scripts/capture-store-shots.sh v1.4.1
```

Composite the README hero shots (from the store captures) into framed PNGs:
```bash
mise composite v1.4.1
```

Composite a single screenshot PNG into an SVG Pebble frame:
```bash
mise composite-screenshot
```

Regenerate `resources/banner-*.png` (README/store banners) from a showcase scene
and a phone settings-UI screenshot — rebuilds the gradient background, tagline, and
phone/watch mockups (needs Pillow: `pip install pillow`):
```bash
mise gen-banner v1.6.2 3 "resources/app screenshot.jpeg"
```

Serve `telemetry-ingest` edge function locally:
```bash
mise telemetry-serve
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

Stream logs after install:
```bash
mise install-phone --logs
```

### Install on emulator

Platforms: `basalt` · `diorite` · `emery` · `flint`

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

Stream logs after install:
```bash
mise install-emulator --logs
```

### Config page (emulator)

Open the running emulator app's live config (settings) page in your browser — drives
the real PKJS-served page from the running emulator. Install the app on that platform
first (e.g. `mise install-emulator aplite`), since the config URL comes from the running
app.

Default (basalt):
```bash
mise config-emulator
```

Specific platform (positional, like `install-emulator`/`screenshot-emulator`):
```bash
mise config-emulator aplite
```

Platform from env var:
```bash
PEBBLE_EMULATOR=aplite mise config-emulator
```

Unlike `mise preview-config`, which renders a *static* HTML snapshot of the config UI to
`build/` without the emulator, this opens the live page the running app serves.

### Kill emulator

Stop running emulator and phone simulator:
```bash
mise kill-emulator
```

### Screenshots

Emulator screenshot, basalt (default), saved to `screenshot/tmp/`:
```bash
mise screenshot-emulator
```

Emulator screenshot, specific platform:
```bash
mise screenshot-emulator basalt
```

Emulator screenshot with platform from env var:
```bash
PEBBLE_EMULATOR=emery mise screenshot-emulator
```

Phone screenshot (IP from `.env`), saved to `screenshot/tmp/`:
```bash
mise screenshot-phone
```

Phone screenshot with explicit IP:
```bash
mise screenshot-phone <IP>
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

Capture all four curated store configs on every platform and file them per platform
under `screenshot/<version>/store/<platform>/<config>.png` (the appstore wants ≥1
screenshot per supported platform):
```bash
scripts/capture-store-shots.sh v1.4.1
```

Resume from a given round if a run crashed mid-way (e.g. round 4):
```bash
scripts/capture-store-shots.sh v1.4.1 4
```

The four configs come from fixtures — `1-calendar` (`store-calendar`),
`2-radar-multicolor` (`berlin`), `3-wind-gust` (`windy`), `4-radar-white-wind`
(`store-wind-radar`). Upload each platform's four raw frames to the store as-is.

Composite the README hero shots from the store captures into framed PNGs
(`screenshot/v1.4.1/composite/`) — Pebble Time←flint/calendar,
Pebble 2 Duo←flint/wind, Pebble Time 2←emery/radar:
```bash
mise composite v1.4.1
```

#### Showcase GIF (README hero)

The README's animated hero is a **showcase GIF**: a handful of curated scenes (different
layouts + functions, all Berlin) captured per platform and cross-faded into one looping
GIF. Scenes live in `scripts/gen-showcase-fixtures.js` (regenerated into
`fixtures/showcase-N.json` on every capture) and are guarded by
`test/showcase-fixtures.test.js`.

Health readings and the rain-countdown strip are read live on the watch and don't
reproduce in a static compile-time fixture, so screenshot builds swap in two canned twins
(wired in `wscript`, never shipped in a normal build):

- `WW_HEALTH_FIXTURE=1` → `src/c/services/health_fixture.c` — canned steps / sleep / heart rate.
- a fixture `countdown` block → `src/c/appendix/rain_countdown_fixture.c` — the exact
  "Rain in 15'" / "Drizzle in 15'" / "Rain for 20'" strip.

Capture the default platforms (aplite, basalt, flint, emery), or a subset via `PLATFORMS`:
```bash
scripts/capture-showcase.sh <version>                    # aplite basalt flint emery
PLATFORMS=basalt scripts/capture-showcase.sh <version>   # one platform
```
It's a thin wrapper over `capture-screenshots.sh` (same pattern as `capture-store-shots.sh`):
per scene it exports `WW_HEALTH_FIXTURE=1` + `FLICKS=<scene flicks>`, shoots the platforms,
and files each frame to `screenshot/<version>/showcase/frames/<platform>/scene_N.png`. A
fresh build runs per scene, so after changing watch C code just re-run — use `mise clean`
first if a stale waf cache would skip the recompile.

Scenes that draw the health status row (marked `hrEmery` in `gen-showcase-fixtures.js`)
get an **emery HR variant** fixture (`showcase-N-emery.json`) that pins the sleep + heart-rate
slots. The fixtures don't pin status slots, so `packLine` bakes the base health-right default
(walked distance) on every platform; without the variant, emery — the only HR platform in the
set — would show distance instead of the heart rate a real Pebble Time 2 renders. The wrapper
shoots emery from the variant and the other (non-HR) platforms from the base fixture. Mirrors
the wizard split (`gen-wizard-fixtures.js`).

Assemble one platform's frames into the looping, cross-faded GIF
(`screenshot/<version>/showcase/<platform>-showcase.gif`):
```bash
scripts/assemble-showcase-gif.sh <version> <platform> [hold_secs] [fade_secs] [fps]
# defaults: hold=1, fade=0.55, fps=15

# MAX_SCENES=N  keep only the first N scenes (default 2; 0 = all captured scenes)
# EXCLUDE_SCENES="2 3 4"  drop specific scene ids (applied before the MAX_SCENES cap)
```
aplite has no `PBL_HEALTH`, so scene 4 (the health graph, reached by a flick that lands on a
view aplite doesn't have) is broken there — exclude it. Scenes 2 & 3 keep their weather
layouts (the health status row is simply absent), so aplite ships scenes 1, 2, 3, 5:
```bash
EXCLUDE_SCENES="4" MAX_SCENES=0 scripts/assemble-showcase-gif.sh <version> aplite
```

#### Promo reel (Pebble-store asset)

A separate, self-contained per-platform **reel** for manual app-store upload — the intro
showcase scenes followed by three captioned chapters (Themes, Graph, Status), each
filtered to the platform's capabilities. It never touches the README hero.

- Chapters + text-card copy + the capability matrix live in `scripts/gen-reel-fixtures.js`
  (guarded by `test/reel-fixtures.test.js`); text cards are rendered by
  `scripts/gen-text-cards.py` (Pillow).
- Intro frames are reused from the hero capture, so run `capture-showcase.sh <version>`
  first.

```bash
scripts/capture-showcase.sh <version>   # once, for the intro frames
scripts/capture-reel.sh <version>        # captures chapters + assembles per-platform reels
```

Output: `screenshot/<version>/promo/<platform>-reel.gif`. Per-platform differences are
automatic: aplite has no themes chapter and no radar/health frames; flint shows 2 themes
(dark/light) and no HR; emery shows 4 themes and heart rate. Reels are left on disk (not
committed) for manual upload. Re-assemble a single reel without recapturing with
`scripts/assemble-reel.sh <version> <platform> [fps]`.

### Package generation

`package.json` is generated from `package.template.json` + profile in `profiles/`.

Dev profile (default):
```bash
mise prepare-package
```

Release profile:
```bash
mise prepare-package release
```

## Environment Variables (`.env`)

| Variable | Description |
|----------|-------------|
| `IP` | Pebble phone IP address for install/screenshot |
| `FIXTURE` | Fixture name to load (e.g. `berlin`). Fixture files: `fixtures/<name>.json` |
| `ENABLE_MEMORY_LOGGING` | Set to `1` to enable heap debug logs in the build |
| `PEBBLE_EMULATOR` | Default emulator platform (e.g. `basalt`) |
| `TELEMETRY_ENDPOINT` | Telemetry function URL (set for release/CI builds) |
| `TELEMETRY_HASH_SECRET` | Secret for server-side HMAC hashing of IDs |
| `RAINBOW_PROXY_ENDPOINT` | Rainbow nowcast proxy URL baked into the bundle (set for release/CI builds via the `RAINBOW_PROXY_ENDPOINT_RELEASE`/`_PREVIEW` repo secrets; empty hides the Rainbow radar option) |

## Fixtures

Deterministic UI state for emulator builds. Set `FIXTURE=<name>` in `.env`.

Fields supported in `fixtures/<name>.json`:
- `watch.now` — date/time for C-rendered time/date UI
- `watch.battery.percent` / `watch.battery.charging`
- `watchSettings.timeFormat` — `"12h"` or `"24h"`
- `claySettings` — Clay settings by `messageKey` (colors use Pebble SDK constants like `"GColorFolly"` — see the [Rebble color definitions](https://developer.rebble.io/docs/c/Graphics/Graphics_Types/Color_Definitions/))
- `weather.city`, `weather.currentTemp` — status-row city label and current temperature (°F)
- `weather.startHour` — local hour (0–23) of the first forecast entry; fixture prep converts it to a runtime epoch
- `weather.startDayOffset` — optional day offset added to `watch.now.day` for the forecast start (default 0; pairs with `startHour`)
- `weather.temps` — hourly Fahrenheit forecast array
- `weather.precipPct` — hourly precipitation-probability array (0–100)
- `weather.rainMm` — hourly rain-amount array (mm); drives the optional rain bars
- `weather.windKmh` / `weather.gustKmh` — hourly wind / gust speed arrays (km/h); a non-zero gust array turns the gust line on
- `weather.rainRadarExactMm` / `weather.rainRadarAreaMm` — radar rain per 5-minute frame (mm/h): rain at the exact location, and the strongest rain within 2 km. Supply both or radar is skipped
- `weather.radarStartEpoch` — optional Unix-seconds anchor for the radar window (defaults to the forecast start; the time-lapse uses it to scroll radar independently of the forecast)
- `weather.sunEvents` — next two sun events, authored as local fields `{ type, dayOffset, hour, minute }` and normalized to `{ type, epoch }`

## Debug Flags (`src/pkjs/dev-config.js`)

| Key | Type | Effect |
|-----|------|--------|
| `clearPkjsStorageOnBoot` | `true/false` | Forces PKJS `localStorage` reset on each boot (first-install testing) |
| `forceShowReleaseNotificationOnBoot` | `'1.26.0'` | Always shows release notification for that version key |
| `owmApiKey` | `'abc123'` | Preloads OpenWeatherMap API key |
| `maxNotifiedVersion` | `'1.26.0'` | Seeds the release-notification "max notified version" marker (simulate skipped-version upgrades) |
| `resetV134WeekendHolidayColorMigration` | `true/false` | Clears the v1.34.0 weekend/holiday color migration marker so it re-runs on next boot |

These are local-only; not committed or written to Clay settings.

## Logging

**C:**
```c
APP_LOG(APP_LOG_LEVEL_DEBUG, "msg %d", value);
MEMORY_LOG_HEAP("tag");
```

**JS:**
```js
console.log("msg");
```

## Supabase (telemetry & rainbow proxy)

Start local Supabase stack:
```bash
supabase start
```

Serve telemetry edge function locally:
```bash
mise telemetry-serve
```

Stop local Supabase stack:
```bash
supabase stop
```

Local Studio: http://127.0.0.1:54323 — inspect `public.telemetry_weather_fetch`

### Migrations

Never write `migrations/` files manually — edit `schemas/` and generate:

Generate migration from schema changes:
```bash
supabase db diff -f <label>
```

### Deploy (hosted)

Authenticate with Supabase:
```bash
supabase login
```

Link repo to hosted project:
```bash
supabase link --project-ref <project-ref>
```

Set function secret:
```bash
supabase secrets set TELEMETRY_HASH_SECRET=<value>
```

Dry-run database migration:
```bash
supabase db push --dry-run
```

Apply database migration:
```bash
supabase db push
```

Deploy telemetry edge function:
```bash
supabase functions deploy telemetry-ingest
```

Serve the rainbow-nowcast edge function locally:
```bash
supabase functions serve rainbow-nowcast --env-file .env
```

Set the Rainbow proxy secrets (hosted):
```bash
supabase secrets set RAINBOW_API_KEY=<key from https://developer.rainbow.ai/profile>
supabase secrets set RAINBOW_MONTHLY_BUDGET=5000   # optional; default 5000 upstream calls per UTC month (raise to accept paid overage — no redeploy needed)
supabase secrets set RAINBOW_IP_HOURLY_CAP=30      # optional; default 30 cache-miss requests per IP per hour
```

Deploy the rainbow-nowcast edge function:
```bash
supabase functions deploy rainbow-nowcast
```

## Upgrading pebble-tool

Bump the pinned version in `mise.toml`:
```bash
mise upgrade "pipx:pebble-tool" --bump
```

Re-install toolchain after bump:
```bash
mise install
```

## Key Files

| Path | Purpose |
|------|---------|
| `mise.toml` | Tool versions + task definitions |
| `package.template.json` | Pebble config template |
| `profiles/` | Dev and release profile overrides |
| `fixtures/` | Deterministic emulator state files |
| `scripts/` | Shell + JS helper scripts |
| `src/pkjs/dev-config.js` | Local-only dev behavior switches |
| `release-notifications.json` | "What's new" toast copy keyed by version |
| `supabase/schemas/` | Declarative DB schemas (source of truth) |
| `supabase/functions/` | Edge functions |
| `screenshot/<version>/raw/` | Raw platform screenshots (last capture run) |
| `screenshot/<version>/store/` | Per-platform store screenshots (4 configs each) |
| `screenshot/<version>/composite/` | Composited README hero screenshots |

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

Capture screenshots for all platforms (replace `v1.0.0` with version):
```bash
mise capture-screenshots v1.0.0
```

Composite all raw screenshots for a version into framed PNGs:
```bash
mise composite v1.0.0
```

Composite a single screenshot PNG into an SVG Pebble frame:
```bash
mise composite-screenshot
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
mise capture-screenshots v1.0.0
```

Capture screenshots for all platforms with a fixture:
```bash
mise capture-screenshots v1.0.0 berlin
```

Composite raw screenshots into framed PNGs (`screenshot/v1.0.0/composite/`):
```bash
mise composite v1.0.0
```

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

## Fixtures

Deterministic UI state for emulator builds. Set `FIXTURE=<name>` in `.env`.

Fields supported in `fixtures/<name>.json`:
- `watch.now` — date/time for C-rendered time/date UI
- `watch.battery.percent` / `watch.battery.charging`
- `watchSettings.timeFormat` — `"12h"` or `"24h"`
- `claySettings` — Clay settings by `messageKey` (colors use Pebble SDK constants, e.g. `"GColorFolly"`)
- `weather.city`, `weather.currentTemp`, `weather.startHour`
- `weather.temps` — hourly Fahrenheit forecast array
- `weather.precipPct` — hourly precipitation % array (0–100)
- `weather.sunEvents` — next two sun events: `{ type, dayOffset, hour, minute }`

## Debug Flags (`src/pkjs/dev-config.js`)

| Key | Type | Effect |
|-----|------|--------|
| `clearPkjsStorageOnBoot` | `true/false` | Forces PKJS `localStorage` reset on each boot (first-install testing) |
| `forceShowReleaseNotificationOnBoot` | `'1.26.0'` | Always shows release notification for that version key |
| `owmApiKey` | `'abc123'` | Preloads OpenWeatherMap API key |

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

## Supabase (telemetry)

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
| `screenshot/<version>/raw/` | Raw platform screenshots |
| `screenshot/<version>/composite/` | Composited screenshots |
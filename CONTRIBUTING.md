# Contributing

This guide is the setup walkthrough for WarnWeather: building the watchface, running the Supabase telemetry backend locally and in the cloud, installing builds, and the local dev config. The `mise` task reference is in [DEV.md](DEV.md).

## Building

Prerequisites: [Node.js](https://nodejs.org/en/) and [mise](https://mise.jdx.dev/)

```bash
# Install toolchain from mise.toml
mise install

# Install JS dependencies
npm install

# Build dev (default)
mise build

# Build release
mise build release
```

The build uses the Pebble SDK version pinned in `pebble-sdk-version`, which the repo scripts provision. The `.pbw` lands in `build/`.

`mise build release` needs `RAINBOW_PROXY_ENDPOINT` in the environment; the release profile fails without it (see the env var table in [DEV.md](DEV.md#environment-variables-env)).

## Supabase (telemetry)

Telemetry runs on Supabase Edge Functions and Postgres.

mise installs and updates the Supabase CLI through its aqua backend (pinned in `mise.toml`):

```bash
mise install
supabase --version
```

Generate a value for the telemetry hash secret, `TELEMETRY_HASH_SECRET`:

```bash
openssl rand -hex 32
```

### Local stack and emulator testing

Start the local Supabase stack from the repo root:

```bash
supabase start
```

Copy `.env.example` to `.env` and fill in the telemetry keys there:

```bash
cp .env.example .env
```

`TELEMETRY_ENDPOINT` ships commented out, and telemetry is off without it. Uncomment it in `.env` and set it to `http://127.0.0.1:54321/functions/v1/telemetry-ingest`.

Serve the telemetry edge function locally, from the repo root:

```bash
mise telemetry-serve
```

To check it in the emulator, run:

```bash
mise install-emulator --logs
```

To check the inserts, open Supabase Studio at `http://127.0.0.1:54323` and look at `public.telemetry_weather_fetch`.

### Hosted deployment (Supabase cloud)

Authenticate and link the repo to your Supabase project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

Set function secrets in the hosted project:

```bash
supabase secrets set \
  TELEMETRY_HASH_SECRET=<paste-openssl-value>
```

Apply database migrations:

```bash
supabase db push --dry-run
supabase db push
```

Deploy the telemetry function:

```bash
supabase functions deploy telemetry-ingest
```

Release and preview builds reach hosted telemetry through these repository secrets, which the CI workflows read:

- `TELEMETRY_ENDPOINT_RELEASE=https://<your-project-ref>.supabase.co/functions/v1/telemetry-ingest`
- `TELEMETRY_ENDPOINT_PREVIEW=https://<your-project-ref>.supabase.co/functions/v1/telemetry-ingest`

### Optional: Supabase GitHub integration

With Supabase's GitHub sync and branching, Supabase applies migrations and deploys functions from `supabase/` when a branch or PR updates. Enable it in Supabase Dashboard > Project Settings > Integrations.

## Package profiles and local build options

`package.json` is generated from `package.template.json` and the profile data in `profiles/`:

- Release profile: `profiles/package.release.json`
- Dev profile: `profiles/package.dev.json`

`mise build` and `mise build release` generate `package.json` from the template and profile before they build.

For the extra Pebble heap debug logs, set `ENABLE_MEMORY_LOGGING=1` in `.env` before building or installing. It works with either package profile. It does not build on aplite (the `MEM|` logging overflows `.bss`), so capture heap logs on diorite or another platform. On the 64 KB watches it costs about 3.1 KB of heap and links only while the release image leaves that much room; `scripts/check-64k-size.sh` has the numbers.

For a deterministic emulator UI, set `FIXTURE=<name>` in `.env` before building or installing. Fixture files are `fixtures/<name>.json` and define the watch facts and weather payload of local builds.

The copy of the release notification (the optional "what's new" toast on upgrade) is in `release-notifications.json`, keyed by the exact `version` string from the template (e.g. `"1.26.0"`). To simulate an upgrade that skipped versions locally, set `maxNotifiedVersion` in `dev-config.js`.

To regenerate `package.json` without building:

```bash
mise prepare-package           # dev profile (default)
mise prepare-package release   # release profile
```

You can run Pebble CLI commands directly, or use the install tasks, which build and install in one command:

```bash
# Option 1: set once in .env
cp .env.example .env
# then edit .env and set IP=<PHONE_IP>
# this installs the dev build by default
mise install-phone

# Option 2: pass IP explicitly
mise install-phone <PHONE_IP>

# Explicit release install
mise install-phone <PHONE_IP> release

# Pass through pebble install flags
mise install-phone --logs

# Pass-through separator form
mise install-phone -- --logs

# Install dev build via CloudPebble (default profile)
mise install-cloud

# Explicit release install via CloudPebble
mise install-cloud release

# Install dev build to emulator (defaults: profile=dev, emulator=basalt)
mise install-emulator

# Choose emulator platform
mise install-emulator basalt

# Choose emulator build type
mise install-emulator release

# Choose emulator platform and build type
mise install-emulator release basalt

# Pass through pebble install flags
mise install-emulator --logs

# Set default emulator in environment
PEBBLE_EMULATOR=basalt mise install-emulator

# Pass-through separator form
mise install-emulator -- --logs

# Stop running emulator and phone simulator
mise kill-emulator

# Take a screenshot from emulator (default platform: basalt)
mise screenshot-emulator

# Choose emulator platform
mise screenshot-emulator basalt

# Flag form
mise screenshot-emulator -- --emulator flint

# Set default emulator in environment
PEBBLE_EMULATOR=basalt mise screenshot-emulator

# Default output goes to screenshot/tmp/<timestamp>-<platform>.png

# Provide explicit output path / additional screenshot args
mise screenshot-emulator -- screenshot/my-capture.png --no-open --no-correction

# Take a screenshot from phone
mise screenshot-phone

# Or pass IP explicitly
mise screenshot-phone <PHONE_IP>

# Default output goes to screenshot/tmp/<timestamp>.png

# Provide explicit output path / additional screenshot args
mise screenshot-phone -- screenshot/my-capture.png
```

## Config

Local dev config has three layers:

- `.env` picks the local mode or scenario, such as `FIXTURE=berlin`.
- `fixtures/*.json` hold committed, deterministic UI state that makes emulator screenshots reproducible: watch facts, Clay render settings, weather payloads and similar data.
- `src/pkjs/dev-config.js` is for uncommitted behavior testing, including preloaded Clay settings when you exercise real app flows instead of a fixture's UI.

While a fixture is active, put Clay values that change the rendering in the fixture's `claySettings`. `dev-config.js` is for local-only behavior switches and testing without a fixture.

Example:

```javascript
module.exports.owmApiKey = 'abc123';
```

### PKJS storage reset (dev)

This key in `src/pkjs/dev-config.js` resets PKJS `localStorage` on every app boot while it is set:

- `clearPkjsStorageOnBoot = true`

Example:

```javascript
module.exports.clearPkjsStorageOnBoot = true;
```

Notes:

- Keep this set to `true` only while testing first-install behavior.
- Set it back to `false` before testing upgrade-notification behavior.
- It is local-only dev behavior and is not written into Clay settings.

### Release notification preview (dev)

This key in `src/pkjs/dev-config.js` shows the notification for one version key from `release-notifications.json` on every app boot, whatever the upgrade state:

- `forceShowReleaseNotificationOnBoot = '1.26.0'` (string must match a key in `release-notifications.json` exactly)

Example:

```javascript
module.exports.forceShowReleaseNotificationOnBoot = '1.26.0';
```

Notes:

- Use it to work on the next release entry's copy while `package.json` is still on an older version.
- Remove the key (or comment it out) when testing normal upgrade behavior.
- It is local-only dev behavior and is not written into Clay settings.

### Fixtures (emulator/dev)

Set `FIXTURE=<name>` in `.env` to load deterministic app state from `fixtures/<name>.json`.
[DEV.md](DEV.md#fixtures) lists every supported fixture field (`watch.now`,
`watch.battery`, `watchSettings`, `claySettings`, and the `weather.*` forecast / wind /
radar arrays).

Minimal `.env`:

```bash
FIXTURE=berlin
```

Fixture data is committed in `fixtures/`.

### Fixture emulator installs

Fixture time and battery state are compiled into the app through `watch.now` and `watch.battery`; `scripts/install-emulator.sh` does not call Pebble's emulator setting controls.

```bash
mise install-emulator --logs
```

## Upgrading pebble-tool

`mise.toml` pins `pipx:pebble-tool` to an exact version, fully resolved in `mise.lock`.

To bump the pinned version:

```bash
mise upgrade "pipx:pebble-tool" --bump
mise install
```

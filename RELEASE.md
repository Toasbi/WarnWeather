## Automatic GitHub releases (Release Please)

Releases are managed by `.github/workflows/release-please.yml`.

Flow:

1. Merge conventional commits into `main`.
2. Release Please opens or updates a release PR with version bumps.
3. Merge the release PR.
4. The workflow creates a GitHub release and uploads `build/warnweather.pbw`.

## Release notification requirements

Every release needs two things beyond the code, or the release PR fails CI:

- A `release-notifications.json` entry keyed by the exact new version string, with
  non-empty `title` + `body` — the upgrade "what's new" toast. The *Release
  Notification Required* workflow (`.github/workflows/release-notification-required.yml`,
  running `scripts/check-release-notification.js`) fails the release PR without it.
- A row in the `public.news` Supabase table with `target_version` set to the exact
  new version string — the longer changelog shown in the settings screen's News &
  Feedback section. See `AGENTS.md`'s "Commits & releases" section for the full
  requirements and style guide for both.

## Developer portals

- [Rebble Developer Portal](https://dev-portal.rebble.io/
)
- [Pebble Developer Dashboard (RePebble)](https://developer.repebble.com/dashboard)

## Screenshots & store assets

Store listing copy lives in [STORE_LISTING.md](STORE_LISTING.md).

### Capture the store screenshots

Capture the five curated configs on every platform, filed per platform under
`screenshot/<version>/store/<platform>/<config>.png`:

```sh
scripts/capture-store-shots.sh <version>        # all five rounds
scripts/capture-store-shots.sh <version> 5      # resume from round 5 (after a crash)
```

The appstore wants at least one screenshot per supported platform, so upload each
platform's five raw PNGs from `screenshot/<version>/store/<platform>/` to that platform.

### Composite the README hero shots

Device frames and banner templates were originally obtained from [Appstore Assets](https://developer.rebble.io/guides/appstore-publishing/appstore-assets/) in Pebble docs.

Those download links are since broken (see https://github.com/pebble-dev/developer.rebble.io/issues/37), but you can still download from the wayback machine (e.g. [banner templates](https://web.archive.org/web/20161207160612/https://s3.amazonaws.com/developer.getpebble.com/assets/other/banner-templates-design.zip)).

Composite the README hero shots from the store captures with:

```sh
mise composite <version>
mise composite-screenshot <pebble-time-red|pebble2-duo-white|pebble-time2-red> <screenshot.png> <output.png>
```

`mise composite <version>` reads the chosen config per device from
`screenshot/<version>/store/<platform>/<config>.png` (Pebble Time←flint/calendar,
Pebble 2 Duo←flint/wind, Pebble Time 2←emery/radar) and writes the framed PNGs to
`screenshot/<version>/composite/`.

Some downloaded frame assets used older names. Track them with the modern device names: `core-time2-red.svg` becomes `pebble-time2-red.svg`, and `pebble2-white.svg` becomes `pebble2-duo-white.svg`. The Pebble Time 2 rename is noted in Eric Migicovsky's July Pebble update: https://ericmigi.com/blog/july-pebble-update/

### Refresh the README showcase GIF

The README's animated hero is a multi-scene showcase captured per platform and
cross-faded into one looping GIF. Regenerate it when the UI or the scene set changes:

```sh
scripts/capture-showcase.sh <version>                    # aplite basalt flint emery
scripts/assemble-showcase-gif.sh <version> <platform>    # per platform → *-showcase.gif
```

Then point the README's three `screenshot/<version>/showcase/*-showcase.gif` links at the
new version, and commit the GIFs. The scene set and the deterministic health /
rain-countdown twins are documented in [DEV.md](DEV.md#showcase-gif-readme-hero).

## Automatic GitHub releases (Release Please)

Releases are managed by `.github/workflows/release-please.yml`.

Flow:

1. Merge conventional commits into `main`.
2. Release Please opens or updates a release PR with version bumps.
3. Merge the release PR.
4. The workflow creates a GitHub release and uploads `build/warnweather.pbw`.

## Release notification requirements

### Boot toast — feature releases only

A `release-notifications.json` entry keyed by the exact new version string, with
non-empty `title` + `body`. The toast interrupts the user on first launch after an
upgrade, so it is spent on releases that give them something to do:

| Release | Version shape | Toast entry |
|---------|---------------|-------------|
| Feature (`feat:`) | `x.y.0` | **Required** — the release PR fails CI without one |
| Fix-only (`fix:`) | `x.y.z`, z > 0 | **Optional** — omit it and nothing shows |

The *Release Notification Required* workflow
(`.github/workflows/release-notification-required.yml`, running
`scripts/check-release-notification.js`) enforces exactly that. An entry that IS
present is validated at any version — a half-filled one still fails, because
`prepare-package.sh` throws on it.

Skipping it on a patch is safe by construction: `prepare-package.sh` injects
`pkg.releaseNotification` only when the manifest holds the version being built, and
the watch shows the newest *unseen* entry at or below the running version. So
1.13.1 → 1.13.2 shows nothing, while 1.13.0 → 1.13.2 still shows the 1.13.1 toast
that user never saw.

**Watch for `Release-As:`** pinning a *feature* to a patch version (1.13.1 did
exactly this). The check reads the version, not the commits, so it will not ask for a
toast on the release that most wants one — add it by hand in that case.

### News row — every release

A row in the `public.news` Supabase table with `target_version` left `NULL` — the
longer changelog shown in the settings screen's News & Feedback section. `NULL`
shows the row to **every** watch regardless of version, so release news doubles as
the nudge to update; an exact version string is reserved for version-specific
notices. This has **no feature/patch exemption**, and **nothing in CI enforces
it**, so it is on you at release time.

See `AGENTS.md`'s "Commits & releases" section for the style guide for both.

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

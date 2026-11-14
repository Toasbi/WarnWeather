# Releasing

This is the release checklist for WarnWeather: how a release is cut, what each release needs besides the code, and how to refresh the store assets.

## Automatic GitHub releases (Release Please)

`.github/workflows/release-please.yml` manages releases:

1. Merge conventional commits into `main`.
2. Release Please opens or updates a release PR with the version bumps.
3. Merge the release PR.
4. The workflow creates a GitHub release and uploads `build/warnweather.pbw`.

If the `.pbw` build fails after the tag is cut, the release is published without its `.pbw`,
and running the failed job again builds nothing, because release-please has already tagged it. Merge the
fix to `main`, then run *Release Please* by hand on `main` (Actions → Release Please → Run
workflow) with the release's tag, e.g. `v2.6.0`. That run builds `main`, uploads its `.pbw` to
that release, and stops if `main` is at another version.

Supabase goes out before the app. The app POSTs to the rainbow-nowcast proxy, so any `supabase/`
change a release depends on must be merged and deployed (the *Deploy Supabase* run on `main` green)
before the `.pbw` is uploaded, whether by merging the release PR or to the appstore.

## Release notification requirements

### Boot toast (feature releases only)

A feature release needs a `release-notifications.json` entry keyed by the exact new version
string, with a non-empty `title` and `body`. The toast interrupts the user on first launch after
an upgrade, so it is kept for releases that give them something to do:

| Release | Version shape | Toast entry |
|---------|---------------|-------------|
| Feature (`feat:`) | `x.y.0` | **Required**: the release PR fails CI without one |
| Fix-only (`fix:`) | `x.y.z`, z > 0 | **Optional**: omit it and nothing shows |

The *Release Notification Required* workflow
(`.github/workflows/release-notification-required.yml`, running
`scripts/check-release-notification.js`) enforces this. It validates an entry that is
present at any version: a half-filled one fails, because `prepare-package.sh` throws on it.

Leaving the entry out of a patch is safe: `prepare-package.sh` injects
`pkg.releaseNotification` only when the manifest holds the version being built, and
the watch shows the newest *unseen* entry at or below the running version. So
1.13.1 → 1.13.2 shows nothing, while 1.13.0 → 1.13.2 still shows the 1.13.1 toast
that user never saw.

Watch for `Release-As:` pinning a feature to a patch version. The check reads the version,
not the commits, so it does not ask for a toast on that release, which needs one most. Add
the entry by hand then.

### News row (every release)

Every release needs a row in the `public.news` Supabase table with `target_version` left
`NULL`. It is the short changelog in the News & Feedback section of the settings screen.
`NULL` shows the row to every watch whatever version it runs, so release news is also the
nudge to update; an exact version string is for version-specific notices only. Patches need
the row too, and **nothing in CI enforces it**, so check it yourself at release time.

The style guide for both is in the "Commits & releases" section of `AGENTS.md`.

## Developer portals

- [Rebble Developer Portal](https://dev-portal.rebble.io/
)
- [Pebble Developer Dashboard (RePebble)](https://developer.repebble.com/dashboard)

## Screenshots & store assets

The store listing copy is in [STORE_LISTING.md](STORE_LISTING.md).

### Capture the store screenshots

Capture the five chosen configs on every platform. The script files them per platform under
`screenshot/<version>/store/<platform>/<config>.png`:

```sh
scripts/capture-store-shots.sh <version>        # all five rounds
scripts/capture-store-shots.sh <version> 5      # resume from round 5 (after a crash)
```

The appstore wants at least one screenshot per supported platform, so upload each
platform's five raw PNGs from `screenshot/<version>/store/<platform>/` to that platform.

### Composite the README hero shots

The device frames and banner templates come from [Appstore Assets](https://developer.rebble.io/guides/appstore-publishing/appstore-assets/) in the Pebble docs.

Its download links are broken (see https://github.com/pebble-dev/developer.rebble.io/issues/37); the files are on the Wayback Machine (e.g. [banner templates](https://web.archive.org/web/20161207160612/https://s3.amazonaws.com/developer.getpebble.com/assets/other/banner-templates-design.zip)).

Composite the README hero shots from the store captures with:

```sh
mise composite <version>
mise composite-screenshot <pebble-time-red|pebble2-duo-white|pebble-time2-red> <screenshot.png> <output.png>
```

`mise composite <version>` reads the chosen config per device from
`screenshot/<version>/store/<platform>/<config>.png` (Pebble Time←flint/calendar,
Pebble 2 Duo←flint/wind, Pebble Time 2←emery/radar) and writes the framed PNGs to
`screenshot/<version>/composite/`.

Some downloaded frame assets have other device names. Rename them: `core-time2-red.svg` becomes `pebble-time2-red.svg`, and `pebble2-white.svg` becomes `pebble2-duo-white.svg`.

### Refresh the README showcase GIF

The README's animated hero is a showcase of several scenes, captured per platform and
cross-faded into one looping GIF. Regenerate it when the UI or the scene set changes:

```sh
scripts/capture-showcase.sh <version>                    # aplite basalt flint emery
scripts/assemble-showcase-gif.sh <version> <platform>    # per platform → *-showcase.gif
```

Then point the README's three `screenshot/<version>/showcase/*-showcase.gif` links at the
new version, and commit the GIFs. [DEV.md](DEV.md#showcase-gif-readme-hero) describes the scene set and the
deterministic health and rain-countdown twins.

# Releasing

RELEASE.md is the release checklist for WarnWeather that covers how a release is cut, what each release needs besides the code, and how to refresh the store assets.

## Automatic GitHub releases (Release Please)

`.github/workflows/release-please.yml` manages releases:

1. Merge conventional commits into `main`.
2. Release Please opens or updates a release PR that bumps the version in
   `package.template.json` (`$.version`).
3. Merge the release PR. That tags the release.
4. The workflow creates a GitHub release and uploads `build/warnweather.pbw`.

The commit prefixes decide the version bump, so they matter. The weather plugins are
versioned on their own: release-please skips commits that touch only `plugins/` (see
`plugins/README.md`).

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
string (e.g. `"1.4.0"`), with a non-empty `title` and `body`. It is the upgrade "what's new"
toast. The toast interrupts the user on first launch after
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

Preview the copy locally with `forceShowReleaseNotificationOnBoot` in `src/pkjs/dev-config.js`
([DEV.md](DEV.md#debug-flags-srcpkjsdev-configjs)).

### News row (every release)

Every release needs a row in the `public.news` Supabase table, the hosted news backend behind
the News popup (the bell) of the settings screen. It is separate from the boot toast and has no
feature/patch exemption: patches need the row too, and **nothing in CI enforces it**, so check
it yourself at release time.

Leave `target_version` `NULL`. `NULL` shows the row to every watch whatever version it runs,
so release news is also the nudge to update. An exact version string like `'1.9.2'` limits a
row to watches on that build; use it only for version-specific notices, e.g. "this build
broke X, update".

The toast is a one-line summary; the news `body_md` is a short changelog, one step longer.
Title it `"What's new in <version>"` and use only the supported markdown subset (`**bold**`
section headers, `- ` bullets, `*italic*`, `[text](https://…)` links; see
`src/pkjs/settings/news.js`). The schema is in `supabase/schemas/news.sql`.

To add it (Supabase project `uorytkglrxbafryiugpu`): insert one row per release with
`execute_sql`, title `What's new in <version>`, `target_version` NULL, and the body in dollar
quotes (`$b$…$b$`) with plain `\n` line breaks. Select the row back to check it. Write the
body from that version's appstore changelog, as the changelog style below describes.

### Changelog style

The appstore changelog and the news body follow Keep a Changelog 1.1.0
(https://keepachangelog.com/en/1.1.0/, summarized here so every session works from it).

- Its principles: a changelog is for humans, not machines; every version gets an entry;
  changes of the same type are grouped; the latest version comes first; it lists the
  noteworthy differences for the user, not the commit log.
- Its types, in this order and only those that apply: `Added` for new features, `Changed` for
  changes in existing functionality, `Deprecated` for soon-to-be removed features, `Removed`
  for now removed features, `Fixed` for bug fixes and `Security` for vulnerabilities.
- Changes count against the previous release users had: `Changed`, `Removed` and `Fixed` name
  only what that release already had. A feature new in this release goes under `Added` once,
  with everything about it (its icons turning to the moon at sunset are part of the new slot,
  not a `Changed` item), and a bug in something that never shipped is no `Fixed` item. When a
  release replaces one that users barely had (3.2.1 for 3.2.0), its notes cover everything
  since the release before and leave the skipped one out.
- Each item is one line without a full stop, naming the feature the way the user sees it;
  `Fixed` items say what was wrong or what works again. No marketing words, exclamation marks,
  settings path, how-to or second sentence. Small fixes and settings-screen polish are one
  last `Minor fixes` line in `Fixed`.

The appstore changelog has the terse form Keep a Changelog's own examples use: plain-line
headings, items of two to eight words, no platform notes and no explanation (the news body
has those). The shape to match:

```
Added
- Weather condition status slot
- Weather icon option for the City slot
- Date formats 09.26 and Sep

Changed
- New rain alert icons
- Tap a status bar to edit it

Removed
- Message form in the News popup

Fixed
- Minor fixes
```

The news body has the same items and groups as that version's appstore changelog, each
explained a little more (what it is and what it does for the user), in about eight to
eighteen words. It has bold headings with a blank line between the groups and flat `- `
bullets: `news.js` renders `**bold**`, `*italic*`, `[text](https://…)` links and `- ` bullets
only, so no `#` headings and no sub-bullets. An item not on Pebble Classic or Steel ends with
`*`, a Pebble Time 2 only item with `**`, and the body ends with a blank line and only the
footnotes it used: `* Not on Pebble Classic or Steel` and `** Pebble Time 2 only` (a lone `*`
or `**` prints as is). Other limits stay in parentheses: `(color watches)`, `(Android)`,
`(Pebble Classic and Steel: text only)`. The shape to match:

```
**Added**
- Change layout in a screen's editor gives the screen another layout and keeps its name and place*

**Changed**
- Edit on a screen's forecast graph row opens the settings of that graph**

**Fixed**
- Visible values set on one graph no longer change the same metric on your other graphs**

* Not on Pebble Classic or Steel
** Pebble Time 2 only
```

Write the changelog (both the toast and the news body) for users, not from the diff. List
individually only what a user can act on: a feature they can use, or a bug that affected the
watchface itself. Group everything else (settings-screen polish, internal refactors, small
fixes) into one `Minor fixes` line, or leave it out. A polish-only patch gets that one line,
not an itemized list of cosmetic tweaks. Keep the tone factual and short: no filler
reassurances ("nothing you need to change on your end") and no generic sign-offs ("more on
the way", "message me anytime").

## Developer portals

- [Rebble Developer Portal](https://dev-portal.rebble.io/
)
- [Pebble Developer Dashboard (RePebble)](https://developer.repebble.com/dashboard)

## Screenshots and store assets

The store listing copy is in [STORE_LISTING.md](STORE_LISTING.md). The commands, their
arguments and the scene set are in [DEV.md](DEV.md#store-screenshots).

1. Capture the five chosen store configs on every platform with
   `scripts/capture-store-shots.sh <version>` ([DEV.md](DEV.md#store-screenshots)).
2. Upload each platform's five raw PNGs from `screenshot/<version>/store/<platform>/` to that
   platform in the appstore, which wants at least one screenshot per supported platform.
3. Composite the README hero shots from the store captures with `mise composite <version>`
   ([DEV.md](DEV.md#readme-hero-shots), which also says where the device frames come from).
4. When the UI or the scene set changed, refresh the README showcase GIF: run
   `scripts/capture-showcase.sh <version>`, then `scripts/assemble-showcase-gif.sh <version> <platform>`
   per platform ([DEV.md](DEV.md#showcase-gif-readme-hero)). Point the README's three
   `screenshot/<version>/showcase/*-showcase.gif` links at the new version and commit the GIFs.

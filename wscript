#
# This file is the default set of rules to compile a Pebble application.
#
# Feel free to customize this to your needs.
#
import os.path
import json
import re

top = '.'
out = 'build'


def options(ctx):
    ctx.load('pebble_sdk')


def configure(ctx):
    """
    This method is used to configure your build. ctx.load(`pebble_sdk`) automatically configures
    a build for each valid platform in `targetPlatforms`. Platform-specific configuration: add your
    change after calling ctx.load('pebble_sdk') and make sure to set the correct environment first.
    Universal configuration: add your change prior to calling ctx.load('pebble_sdk').
    """
    ctx.load('pebble_sdk')


def build(ctx):
    ctx.load('pebble_sdk')

    with open('package.json') as package_file:
        package = json.load(package_file)

    enable_memory_logging = os.environ.get('ENABLE_MEMORY_LOGGING', '').strip().lower() in ('1', 'true', 'yes', 'on')
    # Screenshot/showcase builds set WW_HEALTH_FIXTURE to swap the live HealthService
    # wrapper (services/health.c) for a canned twin (services/health_fixture.c) so the
    # health view renders deterministic numbers. Off for every normal/dev/store build.
    health_fixture = os.environ.get('WW_HEALTH_FIXTURE', '').strip().lower() in ('1', 'true', 'yes', 'on')
    fixture_name = os.environ.get('FIXTURE', '').strip()
    fixture_now = None
    fixture_clock_24h = None
    fixture_battery = None
    fixture_countdown = None
    if fixture_name:
        if not re.match(r'^[a-z0-9][a-z0-9-]*$', fixture_name):
            ctx.fatal('FIXTURE must be a fixture slug like "readme" or "rainy-night"')
        fixture_path = os.path.join('fixtures', '{}.json'.format(fixture_name))
        if not os.path.exists(fixture_path):
            ctx.fatal('Fixture not found: {}'.format(fixture_path))
        with open(fixture_path) as fixture_file:
            fixture = json.load(fixture_file)
        watch_fixture = fixture.get('watch', {})
        fixture_now = watch_fixture.get('now')
        if not isinstance(fixture_now, dict):
            ctx.fatal('Fixture {} must define watch.now'.format(fixture_path))
        for field in ('year', 'month', 'day', 'hour', 'minute', 'second'):
            if field not in fixture_now:
                ctx.fatal('Fixture {} must define watch.now.{}'.format(fixture_path, field))
            try:
                fixture_now[field] = int(fixture_now[field])
            except (TypeError, ValueError):
                ctx.fatal('Fixture watch.now.{} must be an integer'.format(field))
        if not (1 <= fixture_now['month'] <= 12):
            ctx.fatal('Fixture watch.now.month must be 1-12')
        if not (1 <= fixture_now['day'] <= 31):
            ctx.fatal('Fixture watch.now.day must be 1-31')
        if not (0 <= fixture_now['hour'] <= 23):
            ctx.fatal('Fixture watch.now.hour must be 0-23')
        if not (0 <= fixture_now['minute'] <= 59):
            ctx.fatal('Fixture watch.now.minute must be 0-59')
        if not (0 <= fixture_now['second'] <= 59):
            ctx.fatal('Fixture watch.now.second must be 0-59')
        watch_settings = fixture.get('watchSettings', {})
        time_format = watch_settings.get('timeFormat')
        if time_format:
            if time_format not in ('12h', '24h'):
                ctx.fatal('Fixture watchSettings.timeFormat must be "12h" or "24h"')
            fixture_clock_24h = '1' if time_format == '24h' else '0'
        battery_fixture = watch_fixture.get('battery')
        if battery_fixture is not None:
            if not isinstance(battery_fixture, dict):
                ctx.fatal('Fixture watch.battery must be an object')
            fixture_battery = {}
            if 'percent' not in battery_fixture:
                ctx.fatal('Fixture watch.battery.percent is required when watch.battery is defined')
            try:
                fixture_battery['percent'] = int(battery_fixture['percent'])
            except (TypeError, ValueError):
                ctx.fatal('Fixture watch.battery.percent must be an integer')
            if not (0 <= fixture_battery['percent'] <= 100):
                ctx.fatal('Fixture watch.battery.percent must be 0-100')
            charging = battery_fixture.get('charging', False)
            if isinstance(charging, bool):
                fixture_battery['charging'] = '1' if charging else '0'
            else:
                ctx.fatal('Fixture watch.battery.charging must be true or false')
        # Optional top-level "countdown" block: a pre-formatted rain-countdown string +
        # peak tier baked into the build via the rain_countdown_fixture.c twin, so a
        # screenshot fixture shows a deterministic alert strip (see that file).
        countdown_fixture = fixture.get('countdown')
        if countdown_fixture is not None:
            if not isinstance(countdown_fixture, dict):
                ctx.fatal('Fixture countdown must be an object')
            text = countdown_fixture.get('text')
            if not isinstance(text, str) or text == '':
                ctx.fatal('Fixture countdown.text must be a non-empty string')
            try:
                tier = int(countdown_fixture.get('tier', 0))
            except (TypeError, ValueError):
                ctx.fatal('Fixture countdown.tier must be an integer')
            fixture_countdown = {'text': text, 'tier': tier}

    build_worker = os.path.exists('worker_src')
    binaries = []

    cached_env = ctx.env
    for platform in ctx.env.TARGET_PLATFORMS:
        ctx.env = ctx.all_envs[platform]
        # Suppress SDK linker-script RWX segment noise.
        # Pebble's single APP region is expected: https://sourceware.org/binutils/docs/ld/Options.html#index-_002d_002dwarn_002drwx_002dsegments
        ctx.env.LINKFLAGS += ['-Wl,--no-warn-rwx-segments']
        # Rain radar is a rich feature aplite cannot afford: on the 24 KB Pebble
        # Classic the extra layer + drawing code starved the boot heap and the
        # watchface OOM-faulted before first paint. Every other platform defines
        # WW_RAIN_RADAR; aplite lacks it, so the guarded call sites drop out and
        # --gc-sections reaps rain_radar_layer.c from the image (frozen-lean fork,
        # docs/adr/0001; parallels PBL_HEALTH gating the health subsystem).
        if platform != 'aplite':
            ctx.env.CFLAGS += ['-DWW_RAIN_RADAR=1']
        if enable_memory_logging:
            ctx.env.CFLAGS += ['-DWW_ENABLE_MEMORY_LOGGING=1']
        if fixture_now:
            ctx.env.CFLAGS += [
                '-DWW_FIXTURE_NOW_YEAR={}'.format(fixture_now['year']),
                '-DWW_FIXTURE_NOW_MONTH={}'.format(fixture_now['month']),
                '-DWW_FIXTURE_NOW_DAY={}'.format(fixture_now['day']),
                '-DWW_FIXTURE_NOW_HOUR={}'.format(fixture_now['hour']),
                '-DWW_FIXTURE_NOW_MINUTE={}'.format(fixture_now['minute']),
                '-DWW_FIXTURE_NOW_SECOND={}'.format(fixture_now['second']),
            ]
        if fixture_clock_24h is not None:
            ctx.env.CFLAGS += ['-DWW_FIXTURE_CLOCK_24H={}'.format(fixture_clock_24h)]
        if fixture_battery is not None:
            ctx.env.CFLAGS += [
                '-DWW_FIXTURE_BATTERY_PERCENT={}'.format(fixture_battery['percent']),
                '-DWW_FIXTURE_BATTERY_CHARGING={}'.format(fixture_battery['charging']),
            ]
        if fixture_countdown is not None:
            ctx.env.CFLAGS += [
                '-DWW_FIXTURE_COUNTDOWN_TEXT="{}"'.format(fixture_countdown['text']),
                '-DWW_FIXTURE_COUNTDOWN_TIER={}'.format(fixture_countdown['tier']),
            ]
        ctx.set_group(ctx.env.PLATFORM_NAME)
        app_elf = '{}/pebble-app.elf'.format(ctx.env.BUILD_DIR)
        # Per-platform source selection for the aplite lean-twin convention
        # (docs/adr/0001-aplite-frozen-lean-fork.md). Aplite compiles foo_aplite.c
        # and drops the same-directory base foo.c; every other platform drops all
        # *_aplite.c. Matching is by same-directory sibling, never bare basename.
        all_c = ctx.path.ant_glob('src/c/**/*.c')
        if platform == 'aplite':
            shadowed = set()
            for node in all_c:
                if node.name.endswith('_aplite.c'):
                    base = node.parent.find_node(node.name[:-len('_aplite.c')] + '.c')
                    if base is not None:
                        shadowed.add(base.abspath())
            app_sources = [n for n in all_c if n.abspath() not in shadowed]
        else:
            app_sources = [n for n in all_c if not n.name.endswith('_aplite.c')]
        # health_fixture.c is the canned screenshot twin of services/health.c. It never
        # ships in a normal build (dropped here to avoid a duplicate-symbol clash), and
        # only a WW_HEALTH_FIXTURE build on a health platform swaps it IN and drops the
        # real health.c. aplite has no PBL_HEALTH (both compile to nothing), so it keeps
        # health.c and never the twin.
        if health_fixture and platform != 'aplite':
            app_sources = [n for n in app_sources
                           if not (n.name == 'health.c' and n.parent.name == 'services')]
        else:
            app_sources = [n for n in app_sources
                           if not (n.name == 'health_fixture.c' and n.parent.name == 'services')]
        # rain_countdown_fixture.c is the canned screenshot twin of appendix/rain_countdown.c.
        # It ships only for a fixture that declares a countdown block, and never on aplite
        # (which gc-sections the rain alert out); every other build drops the twin to avoid a
        # duplicate-symbol clash with rain_countdown.c.
        if fixture_countdown is not None and platform != 'aplite':
            app_sources = [n for n in app_sources
                           if not (n.name == 'rain_countdown.c' and n.parent.name == 'appendix')]
        else:
            app_sources = [n for n in app_sources
                           if not (n.name == 'rain_countdown_fixture.c' and n.parent.name == 'appendix')]
        ctx.pbl_build(source=app_sources, target=app_elf, bin_type='app')

        if build_worker:
            worker_elf = '{}/pebble-worker.elf'.format(ctx.env.BUILD_DIR)
            binaries.append({'platform': platform, 'app_elf': app_elf, 'worker_elf': worker_elf})
            ctx.pbl_build(source=ctx.path.ant_glob('worker_src/c/**/*.c'),
                          target=worker_elf,
                          bin_type='worker')
        else:
            binaries.append({'platform': platform, 'app_elf': app_elf})
    ctx.env = cached_env

    ctx.set_group('bundle')
    ctx.pbl_bundle(binaries=binaries,
                   js=ctx.path.ant_glob(['src/pkjs/**/*.js',
                                         'src/pkjs/**/*.json',
                                         'src/common/**/*.js',
                                         'package.json',
                                         'release-notifications.json']),
                   js_entry_file='src/pkjs/index.js')

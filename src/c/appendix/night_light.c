#include "night_light.h"

// UNGUARDED ON PURPOSE, and it must stay that way. waf decides build order by
// scanning includes, and it does not evaluate a -D macro while scanning: an
// `#include <pebble.h>` sitting inside `#if defined(WW_COLOR_BACKLIGHT)` is
// invisible to it, so this file never picks up its dependency on the generated
// src/resource_ids.auto.h that pebble.h pulls in — and on emery, the one platform
// that lights the guard, it can be compiled before that header is generated:
//   pebble.h:5:10: fatal error: src/resource_ids.auto.h: No such file or directory
// The platforms that gate the feature out never noticed, because the guard also
// hid the include from the compiler. Every other translation unit here includes
// <pebble.h> unconditionally at top level; so does this one. Including a header
// emits no code, so the gated-out platforms still compile to an empty object.
#include <pebble.h>

#if defined(WW_COLOR_BACKLIGHT)

#include "persist.h"
#include "c/services/watch_services.h"

// wscript lights WW_COLOR_BACKLIGHT for emery alone, and persist.h lights
// NIGHT_LIGHT_SUPPORTED for the SDK's PBL_RGB_BACKLIGHT capability (emery alone) or
// the emery platform macro — so on every real build the first implies the second.
// If that ever stops being true the persist accessors below are declared away and
// this file would fail to LINK, one platform at a time, with no hint as to why. Say
// it here instead, naming both macros.
#if !defined(NIGHT_LIGHT_SUPPORTED)
#error "WW_COLOR_BACKLIGHT is set but persist.h's NIGHT_LIGHT_SUPPORTED is not — the night-light persist accessors are not declared on this build"
#endif

// What we last told the firmware, so the minute tick can stay silent on all but the
// two ticks a day the answer actually moves. The SDK calls are cheap but they are
// syscalls into the light service, which takes a mutex and re-drives the LED
// driver; this is the same "only write when the value actually changed" discipline
// the persist setters follow.
typedef enum {
    NIGHT_LIGHT_UNAPPLIED = 0,  // nothing issued yet, or the system took the LED back
    NIGHT_LIGHT_SYSTEM,         // light_set_system_color() issued
    NIGHT_LIGHT_TINTED,         // light_set_color_rgb888(s_applied_rgb) issued
} NightLightApplied;

static NightLightApplied s_applied;
static uint32_t s_applied_rgb;   // meaningful only while s_applied == NIGHT_LIGHT_TINTED

// Are we the window the user is actually looking at? The firmware hands the LED to
// the system while a notification covers us (applib/app_light.h: the override is
// "reset to the user's default when the app exits or is preempted by a system
// notification"), so while covered we neither drive it nor believe anything about
// its state.
static bool s_focused = true;

/**
 * App-focus callback, wired to did_focus only. See night_light_init() for why that
 * is the half of AppFocusHandlers this feature wants.
 *
 * @param in_focus True once the watchface is fully in focus again, false once
 *                 something (a notification) has finished covering it.
 */
static void focus_handler(bool in_focus) {
    s_focused = in_focus;
    if (!in_focus) {
        // Covered: the system owns the LED and our override is documented as reset.
        // Forget what we applied so the re-apply below cannot short-circuit on a
        // state the firmware has since thrown away — this, not the SDK call, is the
        // load-bearing half of handling the un-focus edge.
        s_applied = NIGHT_LIGHT_UNAPPLIED;
        return;
    }
    // Uncovered again: re-tint NOW rather than at the next minute boundary, which
    // could be 59 seconds of white light after dismissing a 03:00 notification —
    // the exact moment this feature exists for.
    night_light_refresh();
}

void night_light_refresh(void) {
    if (!s_focused) { return; }

    uint8_t settings[NIGHT_LIGHT_BYTES];
    persist_get_night_light(settings);   // always fills; all-zero = never (see persist.h)

    // watch_services_localtime(), not localtime(time(NULL)): a fixture build freezes
    // the whole face to the fixture clock, and the backlight must agree with the
    // hour the screenshot shows.
    const struct tm now = watch_services_localtime();

    if (night_light_hour_in_window(now.tm_hour, settings[3], settings[4])) {
        const uint32_t rgb = night_light_rgb888(settings[0], settings[1], settings[2]);
        if (s_applied == NIGHT_LIGHT_TINTED && s_applied_rgb == rgb) { return; }
        light_set_color_rgb888(rgb);
        s_applied = NIGHT_LIGHT_TINTED;
        s_applied_rgb = rgb;
        return;
    }

    if (s_applied == NIGHT_LIGHT_SYSTEM) { return; }
    // Also runs once on the first daytime refresh (s_applied == UNAPPLIED), which is
    // what hands the LED back after a relaunch inside the window; the light service
    // ignores it when no override is live, so the cost is one syscall per boot.
    light_set_system_color();
    s_applied = NIGHT_LIGHT_SYSTEM;
}

void night_light_init(void) {
    s_focused = true;    // the window is being loaded to be shown
    s_applied = NIGHT_LIGHT_UNAPPLIED;

    // did_focus, NOT will_focus — the two differ in exactly the way that matters here
    // (applib/app_focus_service.h enumerates the five events):
    //  - will_focus(true) fires when the covering window is only ABOUT to close, so
    //    the notification still holds the LED and still has its own teardown to run;
    //    a tint issued there is one the modal's exit path may still take back.
    //    did_focus(true) fires after the animation completes, once nothing is left to
    //    undo it.
    //  - will_focus(true) also fires for a return that never completes (a second
    //    notification arrives mid-animation), which would tint the LED while the face
    //    is still covered.
    //  - did_focus(true) additionally fires at app LAUNCH, where will_focus does not,
    //    so this one handler covers "we just became visible" as well as "we are
    //    visible again" — no second code path.
    // The un-focus side is handled by the same callback (did_focus(false)); losing
    // focus needs no SDK call at all, only forgetting our cached state, so the
    // slightly earlier will_focus(false) would buy nothing.
    app_focus_service_subscribe_handlers((AppFocusHandlers) {
        .did_focus = focus_handler,
    });

    // Apply straight away: did_focus(true) only arrives once the launch animation
    // finishes, and the backlight may well be lit for the wrist-raise that started
    // the app. That later event then finds the state already applied and does
    // nothing.
    night_light_refresh();
}

void night_light_deinit(void) {
    app_focus_service_unsubscribe();
    // Unconditional, NOT gated on s_applied == NIGHT_LIGHT_TINTED, which is the one
    // place that shortcut would be wrong: losing focus clears s_applied while the
    // override may well still be live in the light service, so a window unloaded
    // while covered would hand back a tint we no longer believe we set. The firmware
    // resets the override when the process exits, but a watchface window can unload
    // without the process dying, and leaving a tint nothing will ever clear is not
    // ours to risk. Costs one syscall, which the service ignores when no override is
    // live.
    light_set_system_color();
    s_applied = NIGHT_LIGHT_UNAPPLIED;
}

#else
// No colour backlight on this platform (WW_COLOR_BACKLIGHT undefined — wscript sets
// it for emery only). Every call site is guarded, so nothing here is defined at all
// and --gc-sections has nothing left to reap. Keep the translation unit non-empty so
// a -pedantic build never warns on an empty TU — quick_view.c's convention.
typedef int night_light_excluded_without_color_backlight;
#endif  // WW_COLOR_BACKLIGHT

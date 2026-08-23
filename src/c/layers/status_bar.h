#pragma once

#include <pebble.h>
#include "../windows/layout.h"        // LayoutTier, ViewSpec, MainLayout, LayerVisibility, StatusSource
#include "../appendix/status_line.h"  // StatusLineId

// ── The band status rows ─────────────────────────────────────────────────────
//
// One owner for every status row that rides a LAYOUT BAND: the forecast row, the
// radar row and the health row. Each is a Layer + StatusRow pair; this module owns
// the pair, the per-view facts pushed into it (render tier, full-date, the health
// row's full-mode) and its band frame.
//
// This replaced three near-identical modules — weather_status_layer.c,
// radar_status_layer.c and health_status_layer.c — which differed only in a fixed
// STATUS_LINE_* id, a comment, and (a real bug) a missing uses-live-health
// accessor on the radar copy, which left a live health slot on the radar row
// frozen for an unbounded time. Collapsing them makes that class of drift
// unrepresentable.
//
// THE TOP STRIP IS DELIBERATELY NOT HERE. top_status_layer.c owns two service
// subscriptions, three lazily-loaded indicator bitmaps, a scaled PDC rain glyph
// cache and the rain-alert state machine; it carves its own content rect around
// the indicator slots instead of taking the band's full bounds, has no render
// tier, no band assignment and no visibility toggle, ticks on the minute, and has
// a full aplite lean twin. The abstraction those four rows genuinely share is
// StatusRow, and that seam is already in place.
//
// WHY THE API IS COLLECTIVE. Every entry point acts on ALL bars and takes no bar
// id. That is not stylistic: aplite has neither radar nor health, so
// STATUS_BAR_COUNT is 1 there and every loop below folds to today's single-row
// code — but a per-id API would leave one `movs r0, #0` at each of ~10 aplite call
// sites, roughly +20 B against an image ceiling this watchface sits close to,
// while reclaiming nothing (the radar and health translation units already
// preprocess to empty on aplite). Keeping the loops behind the seam is also the
// deeper module: the window stops knowing how many bars exist.

typedef enum {
    STATUS_BAR_FORECAST = 0,
#if defined(WW_RAIN_RADAR)
    STATUS_BAR_RADAR,
#endif
#if defined(PBL_HEALTH)
    STATUS_BAR_HEALTH,
#endif
    STATUS_BAR_COUNT
} StatusBarId;

// Create every bar as a child of `parent`, each framed to the band its source
// occupies, with tier / full-date / full-mode seeded from `spec` so the FIRST
// paint is already correct.
//
// CALL-ORDER IS LOAD-BEARING: the bands overlap. On the 144 px watches at compact
// tier the calendar band is [15,45) and the upper status band [29,46) — 16 rows —
// and BOTH sides paint opaque fills (the calendar's today/weekend rect, a slot's
// threshold-highlight fill). Pebble draws children in add order, so this group
// must be created BEFORE calendar_layer / time_layer / rain_radar_layer /
// top_status_layer and AFTER the body graphs. Order among the bars themselves is
// provably irrelevant: a bar rides L->status_lower only when it IS the lower
// source, so two VISIBLE bars can never land on the same rect.
void status_bar_create_all(Layer *parent, const ViewSpec *spec, const MainLayout *L);

void status_bar_destroy_all(void);

// Re-push the per-view facts to every bar, reseat it in its band, and set its
// visibility. Replaces the window's per-source fan-outs for render tier,
// full-date, the health full-mode, band assignment and hiding. Hidden bars are
// framed too, so a later un-hide lands correctly.
void status_bar_apply_view(const ViewSpec *spec, const MainLayout *L);

// Re-resolve and repaint every bar — the settings / weather / flick checkpoint.
void status_bar_refresh_all(void);

// True when any VISIBLE bar's active packed line holds a live health slot. Gates
// the minute handler's health work — visibility matters: the health bar's default
// line is all live-health slots, so an any-bar scan would be ~always true for
// every health-enabled user and put HealthService reads on every minute tick even
// with no health content on screen. A hidden bar can't show a stale value, and
// every path that unhides one (status_bar_apply_view is the only visibility
// writer, and each of its callers pairs it with main_window_refresh() ->
// status_bar_refresh_all()) re-resolves the row then. Constant-false on aplite.
bool status_bar_any_visible_uses_live_health(const ViewSpec *spec);

// Repaint the VISIBLE bars whose content depends on live health: those whose
// packed line holds a live health slot, plus the health-source bar itself (its
// slots are health by construction, but may be configured to anything). Hidden
// bars are skipped on purpose — refreshing one spends persist + threshold flash
// reads on a row nobody can see, and the refresh_all that accompanies every
// visibility change re-resolves it before it comes back on screen; the flick and
// auto-return transitions also refresh the SUMMARY for an incoming live-health
// view first (main_window's health_warm_for_incoming_view), so that unhide
// paints fresh values, not the gate-skipped statics.
void status_bar_refresh_live_health(const ViewSpec *spec);

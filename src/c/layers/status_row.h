#pragma once

#include <pebble.h>
#include "../appendix/status_line.h"

typedef struct StatusRow StatusRow;

StatusRow *status_row_create(uint8_t line_id);
void status_row_destroy(StatusRow *row);
// The view facts the row renders with, pushed window -> owner -> row; the resolver reads
// only row state. The top strip pushes them at create, on a date density change and before
// each draw (top_status_layer.c seat_row); a band bar before each refresh (status_bar.c
// refresh_row), so a bar no configured view shows gets them when it joins. `bounds` is the
// row's band, `tier` a LayoutTier value (appendix/view_spec.h), the font tier it renders
// at, and `full_date` says no calendar is on screen (layout_full_date in
// appendix/view_spec.h: a none-tier view, a radar or graph top, or a quick-view peek), so
// the row's SLOT_LIVE_DATE renders the full date ("Jul 4. 2026") instead of month-year
// ("Jul 2026").
void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, bool full_date);
bool status_row_refresh(StatusRow *row);
#if defined(PBL_HEALTH)
// The health readings the row's slots show (services/health_summary.h HEALTH_SUMMARY_*),
// as of its last refresh; 0 when it shows none. Health watches only: aplite's lean twin
// need not answer it.
uint8_t status_row_live_health(const StatusRow *row);
#endif
#if !defined(WW_ON_DEMAND)
// Aplite only (its lean twin, status_row_aplite.c): when active, the row's right
// slot (index 2) draws the battery glyph in place of its packed content — the top
// strip's low-battery takeover. Every other platform shows a low charge through the
// On demand Battery item instead.
void status_row_set_battery_override(StatusRow *row, bool active);
#else
// Declared only where On demand exists: aplite has none, so its lean twin need not
// answer it.
//
// Every refresh reads which On demand items sit on the row's bar — its cells in the
// thresholds blob (status_threshold_on_demand_side; the compiled defaults, Bluetooth,
// Quiet time and Sleep left and Battery plus the weather alerts right on the Watch
// Status Bar, until the phone sends them). While an assigned item is active, the
// row draws it at its bar's edge and the slots make room (appendix/on_demand.c);
// with none active the bar draws exactly as without the feature. A refresh that
// finds nothing assigned frees the glyph cache.
//
// True while an item sits on this row's bar (as of its last refresh) that is refreshed on
// the minute tick: every item but the Moon phase. The items' states — Quiet time, the rain
// countdown — are re-derived on every refresh and have no event of their own, so the owner
// of a row that answers true refreshes it on the minute tick and after a radar rescan
// (status_bar_tick_on_demand; the top strip's own tick). The Moon phase's moon changes
// only with the levels word, which refreshes every bar as it arrives (app_message.c).
bool status_row_ticks_on_demand(const StatusRow *row);

// A slot text's width in `font`, measured as the row measures its slots: in a
// content_w x h box with the trailing ellipsis; 0 for "" or an empty box. On demand
// measures the slots' short members through it, so a member and the full form
// compare like for like.
int16_t status_row_text_w(const char *text, GFont font, int16_t content_w, int16_t h);
#endif
void status_row_draw(StatusRow *row, GContext *ctx);

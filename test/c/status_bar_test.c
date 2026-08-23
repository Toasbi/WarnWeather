// Host test for src/c/layers/status_bar.c — the single owner of the band status
// rows. Replaces the separate weather_status_layer / health_status_layer tests,
// which pinned the same lifecycle twice and (because the radar copy had no test at
// all) missed the missing-accessor bug that collapse fixes.
//
// Built TWICE by scripts/test-c.sh:
//   - evolving:  -DPBL_HEALTH -DWW_RAIN_RADAR   => STATUS_BAR_COUNT == 3
//   - aplite:    neither                        => STATUS_BAR_COUNT == 1
// The second build is what pins the compact-enum contract: it is the only place a
// stray unguarded STATUS_BAR_RADAR / STATUS_BAR_HEALTH becomes a compile error,
// because the shared CFLAGS force -DPBL_HEALTH for every other host test.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "c/windows/layout.h"
#include "c/appendix/status_line.h"
#include "c/layers/status_row.h"
#include "c/layers/status_bar.h"

struct GContext { int unused; };
struct Layer {
    GRect frame;
    LayerUpdateProc update_proc;
    bool hidden;
};
struct StatusRow { uint8_t line_id; };

static int s_failures;
static int s_sequence;

// Per-line-id records, so the assertions stay meaningful whatever
// STATUS_BAR_COUNT is in this build.
static int s_layer_create_seq[STATUS_LINE_COUNT];
static int s_add_seq[STATUS_LINE_COUNT];
static int s_row_create_seq[STATUS_LINE_COUNT];
static int s_apply_seq[STATUS_LINE_COUNT];
static int s_refresh_seq[STATUS_LINE_COUNT];
static int s_row_destroy_seq[STATUS_LINE_COUNT];
static int s_layer_destroy_seq[STATUS_LINE_COUNT];
static int s_apply_count[STATUS_LINE_COUNT];
static int s_refresh_count[STATUS_LINE_COUNT];
static int s_dirty_count[STATUS_LINE_COUNT];
static int s_draw_count[STATUS_LINE_COUNT];
static GRect s_last_bounds[STATUS_LINE_COUNT];
static uint8_t s_last_tier[STATUS_LINE_COUNT];
static bool s_last_full_date[STATUS_LINE_COUNT];

// Layer* -> line id, so the layer stubs can attribute a call. A bar's Layer is
// created and parented BEFORE its StatusRow exists, so those two sequence numbers
// are captured live into the pending slots and transferred when the row arrives —
// otherwise the ordering assertions would be testing the stub, not the module.
static Layer *s_layer_of[STATUS_LINE_COUNT];
static Layer *s_pending_layer;
static int s_pending_create_seq;
static int s_pending_add_seq;

static bool s_refresh_changed;
static bool s_live_health[STATUS_LINE_COUNT];

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

static int line_of_layer(const Layer *layer) {
    for (int i = 0; i < STATUS_LINE_COUNT; i++) {
        if (s_layer_of[i] == layer) { return i; }
    }
    return -1;
}

// --- SDK stubs ---------------------------------------------------------------

Layer *layer_create(GRect frame) {
    Layer *layer = malloc(sizeof(*layer));
    layer->frame = frame;
    layer->update_proc = NULL;
    layer->hidden = false;
    s_pending_layer = layer;
    s_pending_create_seq = ++s_sequence;
    return layer;
}

void layer_set_update_proc(Layer *layer, LayerUpdateProc update_proc) {
    layer->update_proc = update_proc;
}

void layer_add_child(Layer *parent, Layer *child) {
    (void) parent;
    s_pending_layer = child;
    s_pending_add_seq = ++s_sequence;
}

GRect layer_get_bounds(const Layer *layer) {
    return GRect(0, 0, layer->frame.size.w, layer->frame.size.h);
}

void layer_mark_dirty(Layer *layer) {
    int id = line_of_layer(layer);
    if (id >= 0) { s_dirty_count[id]++; }
}

void layer_destroy(Layer *layer) {
    int id = line_of_layer(layer);
    if (id >= 0) { s_layer_destroy_seq[id] = ++s_sequence; s_layer_of[id] = NULL; }
    free(layer);
}

void layer_set_frame(Layer *layer, GRect frame) {
    // The real SDK marks a layer dirty when its frame actually changes; the health
    // nudge (folded into layout_status_band) relies on exactly that for its
    // repaint, so the stub reproduces it.
    if (frame.origin.x != layer->frame.origin.x || frame.origin.y != layer->frame.origin.y
            || frame.size.w != layer->frame.size.w || frame.size.h != layer->frame.size.h) {
        int id = line_of_layer(layer);
        if (id >= 0) { s_dirty_count[id]++; }
    }
    layer->frame = frame;
}

GRect layer_get_frame(const Layer *layer) { return layer->frame; }

void layer_set_hidden(Layer *layer, bool hidden) { layer->hidden = hidden; }

// --- StatusRow stubs ---------------------------------------------------------

StatusRow *status_row_create(uint8_t line_id) {
    StatusRow *row = malloc(sizeof(*row));
    row->line_id = line_id;
    // Bind the pending layer to this line and transfer the sequence numbers that
    // were captured when it was actually created and parented.
    s_layer_of[line_id] = s_pending_layer;
    s_layer_create_seq[line_id] = s_pending_create_seq;
    s_add_seq[line_id] = s_pending_add_seq;
    s_row_create_seq[line_id] = ++s_sequence;
    return row;
}

void status_row_destroy(StatusRow *row) {
    if (!row) { return; }
    s_row_destroy_seq[row->line_id] = ++s_sequence;
    free(row);
}

void status_row_apply(StatusRow *row, GRect bounds, uint8_t tier, uint8_t line_id) {
    (void) row;
    s_last_bounds[line_id] = bounds;
    s_last_tier[line_id] = tier;
    s_apply_count[line_id]++;
    s_apply_seq[line_id] = ++s_sequence;
}

bool status_row_refresh(StatusRow *row) {
    if (!row) { return false; }
    s_refresh_count[row->line_id]++;
    s_refresh_seq[row->line_id] = ++s_sequence;
    return s_refresh_changed;
}

void status_row_draw(StatusRow *row, GContext *ctx) {
    if (row && ctx) { s_draw_count[row->line_id]++; }
}

void status_row_set_full_date(StatusRow *row, bool full_date) {
    if (row) { s_last_full_date[row->line_id] = full_date; }
}

bool status_row_uses_live_health(const StatusRow *row) {
    return row && s_live_health[row->line_id];
}

// --- helpers -----------------------------------------------------------------

static ViewSpec spec_of(uint8_t rows, uint8_t upper, uint8_t lower, uint8_t tier) {
    ViewSpec s;
    memset(&s, 0, sizeof(s));
    s.calendar_rows = rows;
    s.top = (rows > 0) ? TOP_BAND_CALENDAR : TOP_BAND_EMPTY;
    s.body = BODY_FORECAST;
    s.status_upper = upper;
    s.status_lower = lower;
    s.status_tier = tier;
    return s;
}

static MainLayout layout_of(GRect upper, GRect lower) {
    MainLayout L;
    memset(&L, 0, sizeof(L));
    L.status = upper;
    L.status_lower = lower;
    return L;
}

static void reset_records(void) {
    memset(s_apply_count, 0, sizeof(s_apply_count));
    memset(s_refresh_count, 0, sizeof(s_refresh_count));
    memset(s_dirty_count, 0, sizeof(s_dirty_count));
}

// --- tests -------------------------------------------------------------------

// The forecast bar exists on every platform, so lifecycle is pinned on it.
static void create_wires_every_bar_in_order(void) {
    Layer parent = {0};
    GContext ctx = {0};
    s_refresh_changed = true;

    ViewSpec spec = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    const int fc = STATUS_LINE_FORECAST;
    expect_int("create.layer_before_add", s_layer_create_seq[fc] < s_add_seq[fc], 1);
    expect_int("create.add_before_row", s_add_seq[fc] < s_row_create_seq[fc], 1);
    expect_int("create.row_before_apply", s_row_create_seq[fc] < s_apply_seq[fc], 1);
    expect_int("create.apply_before_refresh", s_apply_seq[fc] < s_refresh_seq[fc], 1);
    // One seat only: create_all leans on refresh_row, whose first act is apply_row.
    expect_int("create.apply_count", s_apply_count[fc], 1);
    expect_int("create.refresh_count", s_refresh_count[fc], 1);
    expect_int("create.dirty", s_dirty_count[fc], 1);
    expect_int("create.tier", s_last_tier[fc], LAYOUT_TIER_COMPACT);
    // calendar_rows 2 => a calendar is shown => the date slot is NOT the full date.
    expect_int("create.full_date", s_last_full_date[fc], 0);
    // The forecast is the UPPER source here, so it takes L.status.
    expect_int("create.band.y", s_last_bounds[fc].origin.y, 0);
    expect_int("create.band.h", s_last_bounds[fc].size.h, 20);

    Layer *root = s_layer_of[fc];
    expect_int("create.has_layer", root != NULL, 1);
    root->update_proc(root, &ctx);
    expect_int("draw.delegated", s_draw_count[fc], 1);

    status_bar_destroy_all();
    expect_int("destroy.row_before_layer",
               s_row_destroy_seq[fc] < s_layer_destroy_seq[fc], 1);
}

// A source in the LOWER slot must be framed to L.status_lower, and a source in
// neither slot must be hidden. This is the rule the six duplicated ternaries in
// main_window.c used to express one bar at a time.
static void apply_view_assigns_bands_and_visibility(void) {
    Layer parent = {0};
    s_refresh_changed = false;

    ViewSpec spec = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    const int fc = STATUS_LINE_FORECAST;

    // Swap the forecast into the LOWER slot: same content, different band.
    ViewSpec swapped = spec_of(2, STATUS_SRC_NONE, STATUS_SRC_FORECAST, LAYOUT_TIER_COMPACT);
    status_bar_apply_view(&swapped, &L);
    expect_int("swap.forecast_takes_lower", s_layer_of[fc]->frame.origin.y, 90);
    expect_int("swap.forecast_visible", s_layer_of[fc]->hidden, 0);

    // A view with no forecast source at all hides the bar but still frames it.
    ViewSpec none = spec_of(2, STATUS_SRC_NONE, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    status_bar_apply_view(&none, &L);
    expect_int("nosrc.forecast_hidden", s_layer_of[fc]->hidden, 1);
    expect_int("nosrc.still_framed", s_layer_of[fc]->frame.size.w, 144);

    status_bar_destroy_all();
}

static void tier_and_full_date_are_change_gated(void) {
    Layer parent = {0};
    s_refresh_changed = true;

    ViewSpec spec = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    const int fc = STATUS_LINE_FORECAST;
    reset_records();

    // Same spec => no re-apply, no refresh, no repaint.
    status_bar_apply_view(&spec, &L);
    expect_int("same_spec.no_apply", s_apply_count[fc], 0);
    expect_int("same_spec.no_refresh", s_refresh_count[fc], 0);
    expect_int("same_spec.no_dirty", s_dirty_count[fc], 0);

    // Changed tier => applies and refreshes.
    ViewSpec full = spec_of(3, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_FULL);
    reset_records();
    status_bar_apply_view(&full, &L);
    expect_int("new_tier.applied", s_last_tier[fc], LAYOUT_TIER_FULL);
    expect_int("new_tier.refreshed", s_refresh_count[fc] >= 1, 1);
    expect_int("new_tier.dirty", s_dirty_count[fc] >= 1, 1);

    // Changed tier with UNCHANGED content => applies + refreshes but must not
    // repaint (the forecast bar has no geometry tracking; the SDK's own
    // layer_set_frame dirty covers a real band move).
    s_refresh_changed = false;
    reset_records();
    ViewSpec compact = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    status_bar_apply_view(&compact, &L);
    expect_int("tier_change_same_content.applied", s_last_tier[fc], LAYOUT_TIER_COMPACT);
    expect_int("tier_change_same_content.refreshed", s_refresh_count[fc] >= 1, 1);
    expect_int("tier_change_same_content.no_dirty", s_dirty_count[fc], 0);

    // No calendar => the date slot renders the full date.
    ViewSpec nocal = spec_of(0, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_NONE);
    status_bar_apply_view(&nocal, &L);
    expect_int("nocal.full_date", s_last_full_date[fc], 1);

    status_bar_destroy_all();
}

static void live_health_gate(void) {
    Layer parent = {0};
    s_refresh_changed = true;
    memset(s_live_health, 0, sizeof(s_live_health));

    ViewSpec spec = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    expect_int("health.none_initially", status_bar_any_visible_uses_live_health(&spec), 0);

    // A live health slot on the FORECAST bar must be seen. Before the collapse the
    // radar bar had no accessor at all, so the same slot there went unnoticed —
    // this gate now covers every bar by construction.
    s_live_health[STATUS_LINE_FORECAST] = true;
    expect_int("health.forecast_seen", status_bar_any_visible_uses_live_health(&spec), 1);

    reset_records();
    status_bar_refresh_live_health(&spec);
    expect_int("health.forecast_refreshed", s_refresh_count[STATUS_LINE_FORECAST] >= 1, 1);

    // The same live slot on a bar the SPEC does not show must gate nothing: the
    // minute handler asks about the view on screen, not about configured lines,
    // and a hidden bar is re-resolved by the refresh_all that unhides it.
    ViewSpec hidden = spec_of(2, STATUS_SRC_NONE, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    expect_int("health.hidden_not_seen", status_bar_any_visible_uses_live_health(&hidden), 0);
    reset_records();
    status_bar_refresh_live_health(&hidden);
    expect_int("health.hidden_not_refreshed", s_refresh_count[STATUS_LINE_FORECAST], 0);

    s_live_health[STATUS_LINE_FORECAST] = false;
    reset_records();
    status_bar_refresh_live_health(&spec);
    expect_int("health.no_slot_no_refresh", s_refresh_count[STATUS_LINE_FORECAST], 0);

    status_bar_destroy_all();
    memset(s_live_health, 0, sizeof(s_live_health));
    expect_int("destroy.live_health_false", status_bar_any_visible_uses_live_health(&spec), 0);
}

#if defined(WW_RAIN_RADAR)
// The radar bar is the one that had no test before — and the one carrying the bug.
static void radar_bar_is_a_first_class_bar(void) {
    Layer parent = {0};
    s_refresh_changed = true;
    memset(s_live_health, 0, sizeof(s_live_health));

    ViewSpec spec = spec_of(2, STATUS_SRC_RADAR, STATUS_SRC_FORECAST, LAYOUT_TIER_FULL);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    const int rd = STATUS_LINE_RADAR;
    const int fc = STATUS_LINE_FORECAST;
    expect_int("radar.created", s_layer_of[rd] != NULL, 1);
    expect_int("radar.line", s_last_tier[rd], LAYOUT_TIER_FULL);
    // radar is UPPER, forecast is LOWER: they must land on different bands.
    expect_int("dense.radar_upper", s_last_bounds[rd].size.h, 20);
    expect_int("dense.forecast_lower", s_last_bounds[fc].size.h, 16);
    expect_int("dense.both_visible",
               s_layer_of[rd]->hidden == false && s_layer_of[fc]->hidden == false, 1);

    // THE BUG THIS COLLAPSE FIXES: a live health slot on the RADAR line must put
    // the radar bar into the health-refresh set. The old radar owner had no
    // uses-live-health accessor, so it never refreshed on a health update and a
    // Steps slot there froze for an unbounded time.
    s_live_health[rd] = true;
    expect_int("radar.live_health_seen", status_bar_any_visible_uses_live_health(&spec), 1);
    reset_records();
    status_bar_refresh_live_health(&spec);
    expect_int("radar.live_health_refreshed", s_refresh_count[rd] >= 1, 1);

    status_bar_destroy_all();
    memset(s_live_health, 0, sizeof(s_live_health));
}
#endif

#if defined(PBL_HEALTH)
// The health bar's dual-row nudge lives in layout_status_band() now, so the band
// FRAME itself drops — the SDK's own frame-change dirty (emulated by the stub's
// layer_set_frame) is what repaints a nudge-only change, and the derived row
// bounds are exactly layer_get_bounds() again.
static void health_nudge_moves_the_band_frame(void) {
    Layer parent = {0};
    s_refresh_changed = true;

    // calendar_rows 3 => full mode => NO nudge, even at FULL tier on a tall band.
    ViewSpec full = spec_of(3, STATUS_SRC_HEALTH, STATUS_SRC_NONE, LAYOUT_TIER_FULL);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &full, &L);

    const int hl = STATUS_LINE_HEALTH;
    expect_int("health.fullmode.no_nudge.y", s_layer_of[hl]->frame.origin.y, 4);
    expect_int("health.fullmode.no_nudge.h", s_last_bounds[hl].size.h, 20);

    // Dual-row compact: calendar_rows 2 but status_tier FULL => the frame nudges,
    // and that frame move is what dirties the layer (content unchanged).
    s_refresh_changed = false;
    reset_records();
    ViewSpec dense = spec_of(2, STATUS_SRC_HEALTH, STATUS_SRC_FORECAST, LAYOUT_TIER_FULL);
    status_bar_apply_view(&dense, &L);
    expect_int("health.nudge.frame_y", s_layer_of[hl]->frame.origin.y, 6);
    expect_int("health.nudge.bounds_h", s_last_bounds[hl].size.h, 18);
    expect_int("health.nudge.dirties", s_dirty_count[hl] >= 1, 1);

    // Re-applying the same view must not repaint — or even re-seat — again.
    reset_records();
    status_bar_apply_view(&dense, &L);
    expect_int("health.same_view.no_dirty", s_dirty_count[hl], 0);
    expect_int("health.same_view.no_apply", s_apply_count[hl], 0);

    // A band at exactly HEALTH_TALL_BAND_MIN (16) is too short to nudge.
    MainLayout shortL = layout_of(GRect(0, 4, 144, 16), GRect(0, 90, 144, 16));
    status_bar_apply_view(&dense, &shortL);
    expect_int("health.short_band.no_nudge.y", s_layer_of[hl]->frame.origin.y, 4);
    expect_int("health.short_band.no_nudge.h", s_last_bounds[hl].size.h, 16);

    // One px taller and the nudge is back.
    MainLayout tallL = layout_of(GRect(0, 4, 144, 17), GRect(0, 90, 144, 16));
    status_bar_apply_view(&dense, &tallL);
    expect_int("health.17px.nudge.y", s_layer_of[hl]->frame.origin.y, 6);
    expect_int("health.17px.nudge.h", s_last_bounds[hl].size.h, 15);

    // At COMPACT tier the nudge never applies, so a full-mode flip cannot move
    // the band and must not force a repaint on its own.
    ViewSpec compact = spec_of(2, STATUS_SRC_HEALTH, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    status_bar_apply_view(&compact, &L);
    reset_records();
    ViewSpec compact_full = spec_of(3, STATUS_SRC_HEALTH, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    status_bar_apply_view(&compact_full, &L);
    expect_int("health.compact_fullmode.no_dirty", s_dirty_count[hl], 0);

    status_bar_destroy_all();
}

// The health-source bar refreshes on VISIBILITY alone (its line is health by
// construction but may be configured to anything); hidden it must not spend the
// persist reads — the refresh_all that unhides it re-resolves it then.
static void health_bar_refreshes_on_visibility(void) {
    Layer parent = {0};
    s_refresh_changed = true;
    memset(s_live_health, 0, sizeof(s_live_health));

    ViewSpec spec = spec_of(2, STATUS_SRC_HEALTH, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    MainLayout L = layout_of(GRect(0, 4, 144, 20), GRect(0, 90, 144, 16));
    status_bar_create_all(&parent, &spec, &L);

    const int hl = STATUS_LINE_HEALTH;
    reset_records();
    status_bar_refresh_live_health(&spec);
    expect_int("health_bar.visible_refreshed", s_refresh_count[hl] >= 1, 1);

    ViewSpec off = spec_of(2, STATUS_SRC_FORECAST, STATUS_SRC_NONE, LAYOUT_TIER_COMPACT);
    reset_records();
    status_bar_refresh_live_health(&off);
    expect_int("health_bar.hidden_not_refreshed", s_refresh_count[hl], 0);

    status_bar_destroy_all();
}
#endif

// The compact enum is the whole aplite story: without radar and health there is
// exactly ONE bar, and every loop in status_bar.c folds to today's single-row code.
static void bar_count_matches_platform(void) {
#if defined(WW_RAIN_RADAR) && defined(PBL_HEALTH)
    expect_int("bar_count.evolving", STATUS_BAR_COUNT, 3);
#elif !defined(WW_RAIN_RADAR) && !defined(PBL_HEALTH)
    expect_int("bar_count.aplite", STATUS_BAR_COUNT, 1);
#endif
}

int main(void) {
    bar_count_matches_platform();
    create_wires_every_bar_in_order();
    apply_view_assigns_bands_and_visibility();
    tier_and_full_date_are_change_gated();
    live_health_gate();
#if defined(WW_RAIN_RADAR)
    radar_bar_is_a_first_class_bar();
#endif
#if defined(PBL_HEALTH)
    health_nudge_moves_the_band_frame();
    health_bar_refreshes_on_visibility();
#endif
    if (s_failures) {
        printf("%d status_bar failure(s)\n", s_failures);
        return 1;
    }
    printf("status_bar OK\n");
    return 0;
}

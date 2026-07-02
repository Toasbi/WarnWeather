#include "health_status_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/services/health.h"

// Compiled only on health-capable hardware; see health_graph_layer.c and
// main_window.c for the platform gating rationale.
#if defined(PBL_HEALTH)

// Mirror weather_status_layer.c font/offset constants exactly so this row
// occupies the same height as the weather status line (Task 7 places them
// in the same band).
#define FONT_18_OFFSET 7
#define FONT_14_OFFSET 3
#define MARGIN 2

// emery: use larger text to match weather_status_layer emery sizing
#ifdef PBL_PLATFORM_EMERY
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_18
#define SLOT_Y_OFFSET FONT_18_OFFSET
#define COMPACT_STATUS_FONT_KEY FONT_KEY_GOTHIC_24
// Match weather_status_layer's COMPACT_LABEL_OFFSET (6) so this row seats at the
// same height as the weather status line instead of crowding the row above it.
#define COMPACT_SLOT_Y_OFFSET 6
#else
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_14
#define SLOT_Y_OFFSET FONT_14_OFFSET
#define COMPACT_STATUS_FONT_KEY FONT_KEY_GOTHIC_18
// Match weather_status_layer's COMPACT_LABEL_OFFSET (4). FONT_18_OFFSET (7) sat the
// text 3px higher than the weather row, crowding the element above it in compact mode.
#define COMPACT_SLOT_Y_OFFSET 4
#endif

#define STATUS_TEXT_OVERFLOW GTextOverflowModeTrailingEllipsis

// Buffer sizing — values are clamped before snprintf to keep the compiler's
// format-truncation analysis from flagging theoretical int-max overflows:
//  s_steps_buf: clamped to 6 digits (999999 steps max display) + NUL = 7
//  s_sleep_buf: clamped to "99h59" (5 chars) + NUL = 6; padded to 8 for safety
//  s_hr_buf:    clamped to 3 digits (999 bpm) + NUL = 4; padded to 8 for safety.
//  Each slot is prefixed by its own PDC glyph (steps / sleep / heart), so the value
//  text carries no unit suffix — the heart glyph conveys "bpm".
static char s_steps_buf[8];
static char s_sleep_buf[8];
static char s_hr_buf[8];

// Clamp helpers — avoids format-truncation warnings and limits display to sane ranges.
#define STEPS_MAX 999999
#define SLEEP_HOURS_MAX 99
#define HR_MAX 999

// Draw rects in the layer's local coordinate space, one per slot (the value text).
static GRect frame_steps;
static GRect frame_sleep;
static GRect frame_hr;

// Per-slot metric glyphs (PDC vector), created in _create and recolored white so
// they always read on the black status band and on 1-bit displays. Each is drawn
// from its top-left GPoint, just left of the slot's value text.
static GDrawCommandImage *s_icon_steps;
static GDrawCommandImage *s_icon_sleep;
static GDrawCommandImage *s_icon_hr;
static GPoint icon_pt_steps;
static GPoint icon_pt_sleep;
static GPoint icon_pt_hr;

// Gap between a slot's glyph and its value text.
#define ICON_GAP 2

static Layer *s_health_status_layer;

static bool status_compact(void) { return g_config->top_view_mode != TOP_VIEW_FULL; }

static GFont status_font(void) {
    return fonts_get_system_font(status_compact() ? COMPACT_STATUS_FONT_KEY : STATUS_FONT_KEY);
}

// Force every draw command white so the glyph reads regardless of the colors baked
// into the PDC (and so it maps to white on 1-bit displays).
static bool icon_recolor_white(GDrawCommand *command, uint32_t index, void *context) {
    gdraw_command_set_stroke_color(command, GColorWhite);
    gdraw_command_set_fill_color(command, GColorWhite);
    return true;
}

static GDrawCommandImage *icon_load(uint32_t resource_id) {
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (image) {
        gdraw_command_list_iterate(gdraw_command_image_get_command_list(image),
                                   icon_recolor_white, NULL);
    }
    return image;
}

static GSize icon_size(GDrawCommandImage *image) {
    return image ? gdraw_command_image_get_bounds_size(image) : GSizeZero;
}

// ---------------------------------------------------------------------------
// Slot refresh helpers
// ---------------------------------------------------------------------------

static void steps_slot_refresh(void) {
    int steps = health_steps_today();
    if (steps > STEPS_MAX) { steps = STEPS_MAX; }
    if (steps < 0)         { steps = 0; }
    snprintf(s_steps_buf, sizeof(s_steps_buf), "%d", steps);
}

static void sleep_slot_refresh(void) {
    int secs = health_sleep_recent_seconds();
    if (secs <= 0) {
        snprintf(s_sleep_buf, sizeof(s_sleep_buf), "--");
    } else {
        int hours = secs / 3600;
        int mins  = (secs % 3600) / 60;
        if (hours > SLEEP_HOURS_MAX) { hours = SLEEP_HOURS_MAX; }
        snprintf(s_sleep_buf, sizeof(s_sleep_buf), "%dh%02d", hours, mins);
    }
}

static void hr_slot_refresh(void) {
    if (health_hr_available()) {
        int bpm = health_hr_current();
        if (bpm > 0) {
            if (bpm > HR_MAX) { bpm = HR_MAX; }
            snprintf(s_hr_buf, sizeof(s_hr_buf), "%d", bpm);
        } else {
            snprintf(s_hr_buf, sizeof(s_hr_buf), "--");
        }
    } else {
        snprintf(s_hr_buf, sizeof(s_hr_buf), "--");
    }
}

// ---------------------------------------------------------------------------
// Layout — recomputed on every refresh so it tracks dynamic bounds
// ---------------------------------------------------------------------------

static void health_status_layout(void) {
    GRect bounds = layer_get_bounds(s_health_status_layer);
    int w = bounds.size.w;
    int h = bounds.size.h;
    int off = status_compact() ? COMPACT_SLOT_Y_OFFSET : SLOT_Y_OFFSET;
    int y = -off;
    GFont font = status_font();

    GSize steps_isz = icon_size(s_icon_steps);
    GSize sleep_isz = icon_size(s_icon_sleep);
    GSize hr_isz    = icon_size(s_icon_hr);

    // Steps: flush left — [glyph][gap][value], glyph vertically centred in the band.
    GSize steps_tsz = graphics_text_layout_get_content_size(
        s_steps_buf, font, GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    icon_pt_steps = GPoint(MARGIN, (h - steps_isz.h) / 2);
    frame_steps = GRect(MARGIN + steps_isz.w + ICON_GAP, y, steps_tsz.w, steps_tsz.h);

    // HR: flush right — the whole [glyph][gap][value] group is right-aligned.
    GSize hr_tsz = graphics_text_layout_get_content_size(
        s_hr_buf, font, GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    int hr_group_x = w - MARGIN - hr_isz.w - ICON_GAP - hr_tsz.w;
    icon_pt_hr = GPoint(hr_group_x, (h - hr_isz.h) / 2);
    frame_hr = GRect(hr_group_x + hr_isz.w + ICON_GAP, y, hr_tsz.w, hr_tsz.h);

    // Sleep: [glyph][gap][value] group centred in the space between steps and HR.
    int region_l = frame_steps.origin.x + frame_steps.size.w + MARGIN * 2;
    int region_r = hr_group_x - MARGIN * 2;
    int region_w = region_r - region_l;
    if (region_w < 0) { region_w = 0; }
    GSize sleep_tsz = graphics_text_layout_get_content_size(
        s_sleep_buf, font, GRect(0, 0, region_w, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    int sleep_group_w = sleep_isz.w + ICON_GAP + sleep_tsz.w;
    int sleep_group_x = region_l + (region_w - sleep_group_w) / 2;
    if (sleep_group_x < region_l) { sleep_group_x = region_l; }
    icon_pt_sleep = GPoint(sleep_group_x, (h - sleep_isz.h) / 2);
    frame_sleep = GRect(sleep_group_x + sleep_isz.w + ICON_GAP, y,
                        sleep_tsz.w, sleep_tsz.h + off);
}

// ---------------------------------------------------------------------------
// Update proc
// ---------------------------------------------------------------------------

static void health_status_update_proc(Layer *layer, GContext *ctx) {
    MEMORY_LOG_HEAP("health_status_update:enter");
    // Metric glyphs first (already recolored white), then the value text.
    if (s_icon_steps) { gdraw_command_image_draw(ctx, s_icon_steps, icon_pt_steps); }
    if (s_icon_sleep) { gdraw_command_image_draw(ctx, s_icon_sleep, icon_pt_sleep); }
    if (s_icon_hr)    { gdraw_command_image_draw(ctx, s_icon_hr, icon_pt_hr); }

    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, s_steps_buf, status_font(), frame_steps,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    graphics_draw_text(ctx, s_sleep_buf, status_font(), frame_sleep,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    graphics_draw_text(ctx, s_hr_buf, status_font(), frame_hr,
                       STATUS_TEXT_OVERFLOW, GTextAlignmentLeft, NULL);
    MEMORY_LOG_HEAP("health_status_update:exit");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void health_status_layer_create(Layer *parent_layer, GRect frame) {
    s_health_status_layer = layer_create(frame);

    // Load the metric glyphs before the first layout — it reads their sizes.
    s_icon_steps = icon_load(RESOURCE_ID_HEALTH_STEPS);
    s_icon_sleep = icon_load(RESOURCE_ID_HEALTH_SLEEP);
    s_icon_hr    = icon_load(RESOURCE_ID_HEALTH_HEART);

    steps_slot_refresh();
    sleep_slot_refresh();
    hr_slot_refresh();
    health_status_layout();

    layer_set_update_proc(s_health_status_layer, health_status_update_proc);
    layer_add_child(parent_layer, s_health_status_layer);
    MEMORY_LOG_HEAP("after_health_status_layer_create");
}

Layer *health_status_layer_get_root(void) {
    return s_health_status_layer;
}

void health_status_layer_refresh(void) {
    steps_slot_refresh();
    sleep_slot_refresh();
    hr_slot_refresh();
    health_status_layout();
    layer_mark_dirty(s_health_status_layer);
    MEMORY_LOG_HEAP("after_health_status_refresh");
}

void health_status_layer_destroy(void) {
    MEMORY_LOG_HEAP("health_status_layer_destroy:before");
    if (s_icon_steps) { gdraw_command_image_destroy(s_icon_steps); s_icon_steps = NULL; }
    if (s_icon_sleep) { gdraw_command_image_destroy(s_icon_sleep); s_icon_sleep = NULL; }
    if (s_icon_hr)    { gdraw_command_image_destroy(s_icon_hr); s_icon_hr = NULL; }
    layer_destroy(s_health_status_layer);
    MEMORY_LOG_HEAP("health_status_layer_destroy:after");
}

#endif  // PBL_HEALTH

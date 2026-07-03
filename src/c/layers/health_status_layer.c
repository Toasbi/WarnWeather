#include "health_status_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/layers/layer_util.h"
#include "c/services/health.h"

// Compiled only on health-capable hardware; see health_graph_layer.c and
// main_window.c for the platform gating rationale.
#if defined(PBL_HEALTH)

#define MARGIN 2

// Only the font KEY differs per tier — the value text's vertical position and the metric
// glyphs' size derive from that font (+ the band height) at runtime, in health_status_layout
// and icons_rebuild, so a given tier fits whatever band it lands in without per-band tuning.
// emery renders one notch larger to match weather_status_layer's emery sizing.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_18
#define COMPACT_STATUS_FONT_KEY FONT_KEY_GOTHIC_24
// none now matches the weather row's uniform Gothic 24 (was 28) so the two bars line up.
#define NONE_STATUS_FONT_KEY FONT_KEY_GOTHIC_24
#else
#define STATUS_FONT_KEY FONT_KEY_GOTHIC_14
#define COMPACT_STATUS_FONT_KEY FONT_KEY_GOTHIC_18
// none now matches the weather row's uniform Gothic 18 (was 24) so the two bars line up.
#define NONE_STATUS_FONT_KEY FONT_KEY_GOTHIC_18
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

// Gap between a slot's glyph and its value text. emery's larger glyphs/text carry a touch
// more so the number doesn't crowd the icon.
#ifdef PBL_PLATFORM_EMERY
#define ICON_GAP 4
#else
#define ICON_GAP 2
#endif

// The metric PDCs are authored as ~25px precise-path glyphs that fill their viewboxes by
// different amounts (heart nearly full-height, shoe much less), so a uniform viewbox scale
// gives mismatched on-screen heights. Instead each glyph is normalized to its OWN bounding
// box (see icon_load) and scaled so that box's height equals a target derived from the tier
// font — matching the value text's cap height so the glyph reads at the same top/bottom as
// the number beside it. Precise-path points are in 1/8-pixel units.
#define PRECISE_UNITS_PER_PX 8

// Icon target height = value-font content height × ICON_RATIO (≈ its cap height), so the
// glyph tracks the font across tiers/platforms. content height is the (padded) font line
// height; ~5/9 of it reproduces the cap heights we previously hand-tuned per tier.
#define ICON_RATIO_NUM 5
#define ICON_RATIO_DEN 9
// Breathing room kept when clamping the icon to a short band (e.g. the full-mode 14px slot).
#define ICON_BAND_MARGIN 2

// The shoe glyph is wider and visually heavier than the heart/sleep marks, so at an equal
// height it reads oversized; render it a notch shorter — this fraction of the icon target.
#define STEPS_ICON_NUM 6
#define STEPS_ICON_DEN 7

// The value text's vertical position comes from status_text_y() in layer_util.h — the same
// helper the weather row uses — so the two status bars land at the same height in a shared
// band. The one exception: in the taller dual+compact band the whole row (text + icons) drops
// a few px so it isn't tight against the calendar/radar above it. Gated on band height so the
// short full-topview band, none, and non-emery's short compact band are untouched.
#define HEALTH_TALL_BAND_MIN 16
#define HEALTH_SECTION_DROP 2

static Layer *s_health_status_layer;

// The render tier (a TopViewMode value) whose fonts and offsets fit this layer's
// band. The window sets it via health_status_layer_set_render_tier(); the layer
// never derives it from g_config, so the tier can't desync from the band the window
// carved — in dual-status + compact top view the window passes TOP_VIEW_FULL so the
// health row uses the same smaller font as the weather row (mirrors weather_status_layer).
// Defaults to the config default; always overwritten before the first paint.
static uint8_t s_render_tier = TOP_VIEW_COMPACT;

void health_status_layer_set_render_tier(uint8_t tier) {
    s_render_tier = tier;
}

static GFont status_font(void) {
    switch (s_render_tier) {
        case TOP_VIEW_NONE:    return fonts_get_system_font(NONE_STATUS_FONT_KEY);
        case TOP_VIEW_COMPACT: return fonts_get_system_font(COMPACT_STATUS_FONT_KEY);
        default:               return fonts_get_system_font(STATUS_FONT_KEY);
    }
}

// Content height (px) of the active tier's value font — the padded line height, measured
// off a representative digit. Drives both the icon target size and the text centring.
static int font_content_h(void) {
    return graphics_text_layout_get_content_size(
        "0", status_font(), GRect(0, 0, 100, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft).h;
}

// Glyph bounding box (in the PDC's point units) plus the scale ratio to apply.
typedef struct {
    int16_t min_x, min_y, max_x, max_y;
    int16_t num, den;   // transform each point: (p - min) * num / den
} IconNorm;

// First pass: accumulate the glyph's bounding box across every command's points.
static bool icon_bbox_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        if (p.x < b->min_x) { b->min_x = p.x; }
        if (p.y < b->min_y) { b->min_y = p.y; }
        if (p.x > b->max_x) { b->max_x = p.x; }
        if (p.y > b->max_y) { b->max_y = p.y; }
    }
    return true;
}

// Second pass: recolor to white line-art (stroke white, fill cleared → light outlines;
// the sleep glyph's "Z" strokes then read white inside the unfilled pillow outline), and
// normalize each point to the origin-anchored, target-sized box (translate the bbox to
// 0,0, then scale by num/den — the same ratio scales width and stroke width).
static bool icon_normalize_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    gdraw_command_set_stroke_color(command, GColorWhite);
    gdraw_command_set_fill_color(command, GColorClear);
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        p.x = (int16_t)(((p.x - b->min_x) * b->num) / b->den);
        p.y = (int16_t)(((p.y - b->min_y) * b->num) / b->den);
        gdraw_command_set_point(command, i, p);
    }
    uint8_t sw = gdraw_command_get_stroke_width(command);
    if (sw > 1) {
        int nw = (sw * b->num) / b->den;
        gdraw_command_set_stroke_width(command, (uint8_t)(nw < 1 ? 1 : nw));
    }
    return true;
}

static GDrawCommandImage *icon_load(uint32_t resource_id, int target_h) {
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (!image) { return NULL; }
    GDrawCommandList *list = gdraw_command_image_get_command_list(image);
    IconNorm b = { .min_x = INT16_MAX, .min_y = INT16_MAX, .max_x = INT16_MIN, .max_y = INT16_MIN };
    gdraw_command_list_iterate(list, icon_bbox_cb, &b);
    int glyph_h = b.max_y - b.min_y;
    if (glyph_h <= 0) { return image; }   // degenerate glyph; leave untouched
    int glyph_w = b.max_x - b.min_x;
    // Scale so the glyph's height maps to target_h px. Points are in 1/8-px units, so the
    // numerator carries the ×8; the max point then lands at target_h * 8 units == target_h px.
    b.num = (int16_t)(target_h * PRECISE_UNITS_PER_PX);
    b.den = (int16_t)glyph_h;
    gdraw_command_list_iterate(list, icon_normalize_cb, &b);
    // Tight bounds: height == target_h px; width scaled by the same ratio so the layout
    // reserves the glyph's real footprint (width + gap before the value).
    gdraw_command_image_set_bounds_size(image, GSize((glyph_w * target_h) / glyph_h, target_h));
    return image;
}

// (Re)load all three glyphs at the current tier's target size. Called at create and again
// whenever the render tier changes (a live settings switch), since the glyph geometry is
// baked in at load time. The initial NULL checks make it safe on the first call.
static uint8_t s_icons_tier;

static void icons_rebuild(void) {
    if (s_icon_steps) { gdraw_command_image_destroy(s_icon_steps); }
    if (s_icon_sleep) { gdraw_command_image_destroy(s_icon_sleep); }
    if (s_icon_hr)    { gdraw_command_image_destroy(s_icon_hr); }
    // Icon height ≈ the value font's cap height, clamped so it always fits the band.
    int t = (font_content_h() * ICON_RATIO_NUM) / ICON_RATIO_DEN;
    int band_h = layer_get_bounds(s_health_status_layer).size.h;
    if (t > band_h - ICON_BAND_MARGIN) { t = band_h - ICON_BAND_MARGIN; }
    if (t < 1) { t = 1; }
    s_icon_steps = icon_load(RESOURCE_ID_HEALTH_STEPS, (t * STEPS_ICON_NUM) / STEPS_ICON_DEN);
    s_icon_sleep = icon_load(RESOURCE_ID_HEALTH_SLEEP, t);
    s_icon_hr    = icon_load(RESOURCE_ID_HEALTH_HEART, t);
    s_icons_tier = s_render_tier;
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
    int secs = health_sleep_today_seconds();
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
    // Read the last measured value straight from health_hr_current() (a raw-BPM peek,
    // guarded on raw accessibility) — the same source the graph's in-progress bar uses.
    // Don't gate on health_hr_available(): it checks the *filtered* HeartRateBPM (at most
    // 15 min old), which lags the raw sample, so the row showed "--" until that filtered
    // value materialised even though the last-measured BPM was already available.
    int bpm = health_hr_current();
    if (bpm > 0) {
        if (bpm > HR_MAX) { bpm = HR_MAX; }
        snprintf(s_hr_buf, sizeof(s_hr_buf), "%d", bpm);
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
    GFont font = status_font();
    // Value text and icons both band-centre via the shared helper (see status_text_y in
    // layer_util.h). In the taller dual+compact band, drop the whole row (text + icons) so it
    // clears the calendar/radar above — applied uniformly so their alignment is preserved.
    int section_drop = (s_render_tier == TOP_VIEW_FULL && h > HEALTH_TALL_BAND_MIN)
                           ? HEALTH_SECTION_DROP : 0;
    int y = status_text_y(h, font) + section_drop;
    // Centre the icons on the value-text glyph (content-box centre + the low-seat bias), so
    // they track the text in every band — including the short band where the text sits high.
    int content_h = font_content_h();
    int glyph_c = y + content_h / 2 + (content_h * STATUS_TEXT_BIAS_NUM) / STATUS_TEXT_BIAS_DEN;

    GSize steps_isz = icon_size(s_icon_steps);
    GSize sleep_isz = icon_size(s_icon_sleep);
    GSize hr_isz    = icon_size(s_icon_hr);

    // One shared icon centre for all three, clamped by the TALLEST icon so none clips. Using a
    // common centre (not a per-icon clamp) keeps the shorter shoe co-centred with sleep/heart
    // instead of riding high when the taller two hit the clamp.
    int tallest = steps_isz.h;
    if (sleep_isz.h > tallest) { tallest = sleep_isz.h; }
    if (hr_isz.h > tallest)    { tallest = hr_isz.h; }
    int icon_c = glyph_c;
    if (icon_c < tallest / 2)     { icon_c = tallest / 2; }
    if (icon_c > h - tallest / 2) { icon_c = h - tallest / 2; }

    // Steps: flush left — [glyph][gap][value], glyph vertically centred in the band.
    GSize steps_tsz = graphics_text_layout_get_content_size(
        s_steps_buf, font, GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    icon_pt_steps = GPoint(MARGIN, icon_c - steps_isz.h / 2);
    frame_steps = GRect(MARGIN + steps_isz.w + ICON_GAP, y, steps_tsz.w, steps_tsz.h);

    // HR: flush right — the whole [glyph][gap][value] group is right-aligned.
    GSize hr_tsz = graphics_text_layout_get_content_size(
        s_hr_buf, font, GRect(0, 0, w / 3, 100),
        STATUS_TEXT_OVERFLOW, GTextAlignmentLeft);
    int hr_group_x = w - MARGIN - hr_isz.w - ICON_GAP - hr_tsz.w;
    icon_pt_hr = GPoint(hr_group_x, icon_c - hr_isz.h / 2);
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
    icon_pt_sleep = GPoint(sleep_group_x, icon_c - sleep_isz.h / 2);
    frame_sleep = GRect(sleep_group_x + sleep_isz.w + ICON_GAP, y,
                        sleep_tsz.w, sleep_tsz.h);
}

// ---------------------------------------------------------------------------
// Update proc
// ---------------------------------------------------------------------------

static void health_status_update_proc(Layer *layer, GContext *ctx) {
    MEMORY_LOG_HEAP("health_status_update:enter");
    // Metric glyphs first (recolored to white line-art at load), then the value text.
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

    // Load the metric glyphs before the first layout — it reads their sizes. The window
    // sets the render tier before create(), so they load at the right size immediately.
    icons_rebuild();

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
    // A live tier switch (e.g. toggling dual-status / top-view in settings) changes the
    // target glyph size, which is baked in at load — so rebuild the glyphs when it moves.
    if (s_icons_tier != s_render_tier) { icons_rebuild(); }
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

// Includes above the guard, on purpose: waf's dependency scanner does not evaluate -D
// macros (night_light.c), and an include emits no code.
#include "hr_alert.h"
#include "persist.h"

#if defined(PBL_PLATFORM_EMERY)
// emery: the heart-rate alert's decoders and RAM cache (layout in hr_alert.h). Every
// other platform compiles this file to an empty object.

OdSide hr_alert_side(const uint8_t b[HR_ALERT_BYTES], int bar) {
    if (bar < 0 || bar >= THRESH_BAR_COUNT) { return OD_SIDE_NONE; }
    int cell = (b[HR_ALERT_CELLS_OFFSET] >> (2 * bar)) & 3;
    return cell == 3 ? OD_SIDE_NONE : (OdSide)cell;
}

int hr_alert_level(const uint8_t b[HR_ALERT_BYTES]) {
    int v = b[HR_ALERT_LEVEL_OFFSET];
    return (v < HR_ALERT_BPM_MIN || v > HR_ALERT_BPM_MAX) ? HR_ALERT_LEVEL_DEFAULT : v;
}

int hr_alert_slot_level(const uint8_t b[HR_ALERT_BYTES], int bpm) {
    const int warn = b[HR_ALERT_WARN_OFFSET], danger = b[HR_ALERT_DANGER_OFFSET];
    if (!(b[HR_ALERT_FLAGS_OFFSET] & HR_ALERT_HIGHLIGHT_BIT) || bpm <= 0
            || warn < HR_ALERT_BPM_MIN || danger < warn) {
        return THRESH_LEVEL_NORMAL;
    }
    return bpm >= danger ? THRESH_LEVEL_DANGER : bpm >= warn ? THRESH_LEVEL_WARN : THRESH_LEVEL_NORMAL;
}

// THRESH_HR is unpaired in the blob, so status_threshold_look answers the box (none at
// NORMAL, filled at DANGER) and the bold verdict from its Bold cell, with the auto
// accent 0xFF; the tuple supplies the warn look's box and both accents.
ThreshLook hr_alert_look(const uint8_t blob[THRESH_SETTINGS_BYTES], const uint8_t b[HR_ALERT_BYTES],
                         int level) {
    ThreshLook look = status_threshold_look(blob, THRESH_HR, level);
    if (level == THRESH_LEVEL_WARN) {
        int wl = (b[HR_ALERT_FLAGS_OFFSET] >> HR_ALERT_LOOK_SHIFT) & 3;
        look.box = (uint8_t)(wl == 3 ? THRESH_BOX_OUTLINE : wl);
        look.color8 = b[HR_ALERT_WARN_COLOR_OFFSET];
    } else if (level == THRESH_LEVEL_DANGER) {
        look.color8 = b[HR_ALERT_DANGER_COLOR_OFFSET];
    }
    return look;
}

static uint8_t s_hr_alert[HR_ALERT_BYTES];
static bool s_hr_alert_loaded;

const uint8_t *hr_alert_get(void) {
    if (!s_hr_alert_loaded) {
        persist_get_hr_alert(s_hr_alert);
        s_hr_alert_loaded = true;
    }
    return s_hr_alert;
}

void hr_alert_reload(void) { s_hr_alert_loaded = false; }

#endif  // PBL_PLATFORM_EMERY

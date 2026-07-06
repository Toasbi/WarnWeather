#include "math.h"
#include <pebble.h>

int f_to_c(int temp_f) {
    // Convert a fahrenheit temperature to celsius, rounded to nearest.
    // Integer-only per the project's no-floating-point constraint;
    // +4/-4 reproduces round-half away from zero over /9.
    const int num = (temp_f - 32) * 5;
    return num >= 0 ? (num + 4) / 9 : (num - 4) / 9;
}
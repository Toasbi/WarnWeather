// src/pkjs/weather/sun-events.js
/**
 * Select the next (up to) two sun events after `now`, preserving order.
 * Both providers gather a 4-event window (today + tomorrow) and need the
 * next 24 hours' worth — i.e. the first two still in the future.
 *
 * @param {{type: string, date: Date}[]} events Candidate sun events.
 * @param {Date} now Reference time.
 * @returns {{type: string, date: Date}[]} At most two future events.
 */
function pickNext24hSunEvents(events, now) {
    return events.filter(function(sunEvent) {
        return sunEvent.date > now;
    }).slice(0, 2);
}

module.exports = { pickNext24hSunEvents: pickNext24hSunEvents };

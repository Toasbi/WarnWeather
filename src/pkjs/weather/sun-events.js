// src/pkjs/weather/sun-events.js
/**
 * Whether a sun event carries a real date. SunCalc answers Invalid Date for
 * the sunrise/sunset of a polar day or night, and a provider may omit one.
 *
 * @param {{type: string, date: Date}} sunEvent Candidate sun event.
 * @returns {boolean} True when the event's date is a finite time.
 */
function isValidSunEvent(sunEvent) {
    return Boolean(sunEvent) && sunEvent.date instanceof Date && !isNaN(sunEvent.date.getTime());
}

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
        return isValidSunEvent(sunEvent) && sunEvent.date > now;
    }).slice(0, 2);
}

module.exports = {
    isValidSunEvent: isValidSunEvent,
    pickNext24hSunEvents: pickNext24hSunEvents
};

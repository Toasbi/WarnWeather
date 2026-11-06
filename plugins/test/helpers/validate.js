'use strict';

// The Pebble app's check of every source update, ported from libpebble3's ShapeValidation.kt
// (coredevices/mobileapp): a shape the source doesn't declare, or a payload that doesn't match its
// shape, is dropped before any watchface sees it. A test that runs a plugin's answer through this
// catches what the app would silently drop.

const SHORT_TEXT_GUIDE_LENGTH = 7;
const MAX_PALETTE_SIZE = 16;

/**
 * @param {*} value Candidate.
 * @returns {boolean} True for a plain object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value Candidate.
 * @returns {boolean} True for a whole number (what kotlinx's longOrNull accepts from a JS number).
 */
function isWhole(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * The problem with one reading of a shape, or null.
 *
 * @param {string} shape Shape name.
 * @param {*} reading The reading: a shape's own field, or one entry of a series' values.
 * @param {Function} warn Receives a warning that doesn't drop anything.
 * @returns {string|null} Problem.
 */
function pointProblem(shape, reading, warn) {
  switch (shape) {
    case 'shortText':
    case 'longText':
      if (typeof reading !== 'string') {
        return shape + ' needs its text as a string';
      }
      if (shape === 'shortText' && reading.length > SHORT_TEXT_GUIDE_LENGTH) {
        warn('shortText is longer than ~' + SHORT_TEXT_GUIDE_LENGTH + ' characters: ' + reading);
      }
      return null;
    case 'numericValue':
      return typeof reading === 'number' && isFinite(reading) ? null : 'numericValue needs a number';
    case 'timestamp':
      return isWhole(reading) ? null : 'timestamp needs whole epoch seconds';
    case 'boolean':
      return typeof reading === 'boolean' ? null : 'boolean needs true or false';
    case 'icon':
    case 'image':
      return isObject(reading) ? bitmapProblem(shape, reading) : shape + " isn't an object";
    default:
      return null;
  }
}

/**
 * What a numericValue (or a series of them) shares: a string unit, and min/max as a pair of numbers.
 *
 * @param {Object} fields The payload.
 * @returns {string|null} Problem.
 */
function sharedNumericProblem(fields) {
  if (fields.unit !== undefined && typeof fields.unit !== 'string') {
    return "numericValue's unit must be a string";
  }
  if ((fields.min === undefined) !== (fields.max === undefined)) {
    return "numericValue's min and max come as a pair";
  }
  if (fields.min !== undefined && (typeof fields.min !== 'number' || typeof fields.max !== 'number')) {
    return "numericValue's min and max must be numbers";
  }
  return null;
}

/**
 * @param {string} shape icon or image.
 * @param {Object} fields The payload.
 * @returns {string|null} Problem.
 */
function bitmapProblem(shape, fields) {
  if (!isWhole(fields.width) || !isWhole(fields.height) || fields.width <= 0 || fields.height <= 0) {
    return shape + ' needs a positive width and height';
  }
  const decode = (text) => (typeof text === 'string' ? Buffer.from(text, 'base64') : null);
  const pixels = decode(fields.pixels);
  const palette = decode(fields.palette);
  if (!pixels) {
    return shape + "'s pixels aren't base64";
  }
  if (!palette) {
    return shape + "'s palette isn't base64";
  }
  const expected = Math.floor((fields.width + 1) / 2) * fields.height;
  if (pixels.length !== expected) {
    return shape + ' has ' + pixels.length + ' pixel bytes, not ' + expected;
  }
  if (!palette.length || palette.length > MAX_PALETTE_SIZE) {
    return shape + "'s palette has " + palette.length + ' colours';
  }
  return null;
}

/**
 * The problem with one non-series shape's payload, or null.
 *
 * @param {string} shape Shape name.
 * @param {*} payload Payload.
 * @param {Function} warn Warning sink.
 * @returns {string|null} Problem.
 */
function shapeProblem(shape, payload, warn) {
  if (!isObject(payload)) {
    return shape + " isn't an object";
  }
  if (shape === 'icon' || shape === 'image') {
    return bitmapProblem(shape, payload);
  }
  const reading = shape === 'shortText' || shape === 'longText' ? payload.text : payload.value;
  const problem = pointProblem(shape, reading, warn);
  if (problem) {
    return problem;
  }
  return shape === 'numericValue' ? sharedNumericProblem(payload) : null;
}

/**
 * The problem with a series payload, or null.
 *
 * @param {*} payload The series payload.
 * @param {string[]} declared Its declared series shapes (without the `series.` prefix).
 * @param {Function} warn Warning sink.
 * @returns {string|null} Problem.
 */
function seriesProblem(payload, declared, warn) {
  if (!isObject(payload)) {
    return "series isn't an object";
  }
  if (!declared.length) {
    return "series isn't declared";
  }
  if ((payload.start === undefined) !== (payload.stepSec === undefined)) {
    return "series' start and stepSec come as a pair";
  }
  if (payload.start !== undefined && !isWhole(payload.start)) {
    return "series' start needs whole epoch seconds";
  }
  if (payload.stepSec !== undefined && !(isWhole(payload.stepSec) && payload.stepSec > 0)) {
    return "series' stepSec needs to be a positive whole number";
  }
  const shapes = Object.keys(payload).filter((key) => key !== 'start' && key !== 'stepSec');
  if (!shapes.length) {
    return 'series has no shapes';
  }
  let length = null;
  for (const shape of shapes) {
    if (declared.indexOf(shape) === -1) {
      return 'series.' + shape + " isn't declared";
    }
    const series = payload[shape];
    if (!isObject(series)) {
      return 'series.' + shape + " isn't an object";
    }
    if (!Array.isArray(series.values)) {
      return 'series.' + shape + ' needs values';
    }
    if (length !== null && series.values.length !== length) {
      return "series' values aren't all the same length";
    }
    length = series.values.length;
    for (const point of series.values) {
      if (point === null) {
        continue;
      }
      const problem = pointProblem(shape, point, warn);
      if (problem) {
        return 'series.' + shape + ': ' + problem;
      }
    }
    if (shape === 'numericValue') {
      const problem = sharedNumericProblem(series);
      if (problem) {
        return 'series.' + shape + ': ' + problem;
      }
    }
  }
  return null;
}

/**
 * Validate an envelope against a source's declared properties.
 *
 * @param {Object} envelope {instances: [{instanceId, properties}]}.
 * @param {Object<string, string[]>} declaredProperties The manifest's properties block.
 * @returns {{dropped: string[], warnings: string[]}} What the app would drop, and its warnings.
 */
function validateEnvelope(envelope, declaredProperties) {
  const dropped = [];
  const warnings = [];
  (envelope.instances || []).forEach((instance) => {
    Object.keys(instance.properties || {}).forEach((property) => {
      const declared = declaredProperties[property] || [];
      const shapes = instance.properties[property];
      const where = instance.instanceId + '/' + property;
      const warn = (message) => warnings.push(where + ': ' + message);
      Object.keys(shapes).forEach((shape) => {
        let problem;
        if (shape === 'series') {
          const seriesShapes = declared.filter((name) => name.indexOf('series.') === 0)
            .map((name) => name.slice('series.'.length));
          problem = seriesProblem(shapes.series, seriesShapes, warn);
        } else if (declared.indexOf(shape) === -1) {
          problem = shape + " isn't declared";
        } else {
          problem = shapeProblem(shape, shapes[shape], warn);
        }
        if (problem) {
          dropped.push(where + ': ' + problem);
        }
      });
    });
  });
  return { dropped, warnings };
}

module.exports = { validateEnvelope, SHORT_TEXT_GUIDE_LENGTH };

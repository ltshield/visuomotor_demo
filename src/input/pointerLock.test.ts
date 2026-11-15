import { describe, expect, it } from 'vitest';
import { sanitizeTimestamp, splitMovement, toWorkspaceDelta, type MovementSample } from './pointerLock';

const sample = (movementX: number, movementY: number, timeStamp: number): MovementSample => ({
  movementX,
  movementY,
  timeStamp,
});

describe('toWorkspaceDelta', () => {
  it('keeps x and flips y (browser y is down, workspace y is up)', () => {
    expect(toWorkspaceDelta(5, -3, 1)).toEqual({ dx: 5, dy: 3 });
    expect(toWorkspaceDelta(-2, 7, 1)).toEqual({ dx: -2, dy: -7 });
  });

  it('applies the input gain to both axes', () => {
    expect(toWorkspaceDelta(10, 4, 0.5)).toEqual({ dx: 5, dy: -2 });
  });

  it('never produces negative zero', () => {
    const d = toWorkspaceDelta(3, 0, 1);
    expect(Object.is(d.dy, 0)).toBe(true);
  });
});

describe('sanitizeTimestamp', () => {
  it('keeps an event timestamp that is on the same timeline as the clock', () => {
    expect(sanitizeTimestamp(5000.25, 5003)).toBe(5000.25);
    expect(sanitizeTimestamp(5004, 5003)).toBe(5004);
  });

  it('falls back to the current time for a wildly different or invalid timestamp', () => {
    // e.g. a browser reporting wall-clock milliseconds instead of time since page load
    expect(sanitizeTimestamp(1_794_000_000_000, 5003)).toBe(5003);
    expect(sanitizeTimestamp(NaN, 5003)).toBe(5003);
    expect(sanitizeTimestamp(0, 60_000)).toBe(60_000);
  });
});

describe('splitMovement', () => {
  it('uses the hardware sub-samples when they add up to the event total', () => {
    const event = sample(9, -6, 116);
    const parts = [sample(3, -2, 102), sample(4, -3, 108), sample(2, -1, 114)];
    expect(splitMovement(event, parts)).toEqual(parts);
  });

  it('falls back to the single event when the sub-samples disagree with its total', () => {
    const event = sample(9, -6, 116);
    const parts = [sample(0, 0, 102), sample(0, 0, 108)];
    expect(splitMovement(event, parts)).toEqual([event]);
  });

  it('falls back to the single event when there are no or only one sub-sample', () => {
    const event = sample(4, 4, 50);
    expect(splitMovement(event, [])).toEqual([event]);
    expect(splitMovement(event, [sample(4, 4, 49)])).toEqual([event]);
  });

  it('never changes the total movement that gets recorded', () => {
    const event = sample(12, 5, 200);
    for (const parts of [[], [sample(6, 2, 190), sample(6, 3, 198)], [sample(1, 1, 190), sample(1, 1, 198)]]) {
      const used = splitMovement(event, parts);
      const sumX = used.reduce((a, s) => a + s.movementX, 0);
      const sumY = used.reduce((a, s) => a + s.movementY, 0);
      expect(Math.abs(sumX - 12)).toBeLessThanOrEqual(1);
      expect(Math.abs(sumY - 5)).toBeLessThanOrEqual(1);
    }
  });

  it('rejects sub-samples containing non-finite values', () => {
    const event = sample(2, 2, 10);
    expect(splitMovement(event, [sample(NaN, 1, 8), sample(1, 1, 9)])).toEqual([event]);
  });
});

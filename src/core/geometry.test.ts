import { describe, expect, it } from 'vitest';
import {
  applyCursorTransform,
  clampToSquare,
  cross,
  dot,
  lerp,
  norm,
  rotate,
  segmentCircleCrossing,
  signedAngleDeg,
  targetPosition,
  unitFromAngleDeg,
} from './geometry';

const EIGHT_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const SQRT_HALF = Math.SQRT1_2;

describe('rotate', () => {
  it('+45° turns +x counterclockwise toward +y (y-up frame)', () => {
    const v = rotate({ x: 1, y: 0 }, 45);
    expect(v.x).toBeCloseTo(SQRT_HALF, 12);
    expect(v.y).toBeCloseTo(SQRT_HALF, 12);
  });

  it('+90° maps +x to +y and +y to −x', () => {
    const a = rotate({ x: 1, y: 0 }, 90);
    expect(a.x).toBeCloseTo(0, 12);
    expect(a.y).toBeCloseTo(1, 12);
    const b = rotate({ x: 0, y: 1 }, 90);
    expect(b.x).toBeCloseTo(-1, 12);
    expect(b.y).toBeCloseTo(0, 12);
  });

  it('0° is an exact identity', () => {
    const v = { x: 12.345, y: -6.789 };
    expect(rotate(v, 0)).toEqual(v);
  });

  it('a negative angle rotates clockwise and undoes the positive rotation', () => {
    const v = { x: 3, y: 4 };
    const back = rotate(rotate(v, 45), -45);
    expect(back.x).toBeCloseTo(3, 12);
    expect(back.y).toBeCloseTo(4, 12);
  });

  it('preserves length for any angle (rotation is rigid)', () => {
    const v = { x: 123.4, y: -56.7 };
    for (const theta of [0, 5.625, 45 / 7, 30, 45, 90, 137, 180, 270, -45]) {
      expect(norm(rotate(v, theta))).toBeCloseTo(norm(v), 9);
    }
  });
});

describe('applyCursorTransform: cursor = start + R(θ)·(hand − start)', () => {
  it('leaves the cursor on the hand when θ = 0', () => {
    const hand = { x: 80, y: -20 };
    expect(applyCursorTransform(hand, { x: 0, y: 0 }, 0)).toEqual(hand);
  });

  it('rotates the displacement, not the absolute position', () => {
    const start = { x: 10, y: 20 };
    const hand = { x: 110, y: 20 }; // 100 wu to the right of the start
    const cursor = applyCursorTransform(hand, start, 45);
    expect(cursor.x).toBeCloseTo(10 + 100 * SQRT_HALF, 9);
    expect(cursor.y).toBeCloseTo(20 + 100 * SQRT_HALF, 9);
  });

  it('hand and cursor coincide at the start for every rotation', () => {
    const start = { x: -5, y: 7 };
    for (const theta of [0, 6.43, 45, 90]) {
      const cursor = applyCursorTransform(start, start, theta);
      expect(cursor.x).toBeCloseTo(start.x, 12);
      expect(cursor.y).toBeCloseTo(start.y, 12);
    }
  });

  it('with +45°, aiming the hand 45° clockwise of a target sends the cursor straight at it (all 8 directions)', () => {
    for (const targetAngle of EIGHT_DIRECTIONS) {
      const hand = targetPosition(targetAngle - 45, 240);
      const cursor = applyCursorTransform(hand, { x: 0, y: 0 }, 45);
      const target = targetPosition(targetAngle, 240);
      expect(cursor.x).toBeCloseTo(target.x, 9);
      expect(cursor.y).toBeCloseTo(target.y, 9);
    }
  });

  it('with +45°, a hand aimed AT the target produces a cursor error of +45° (counterclockwise)', () => {
    for (const targetAngle of EIGHT_DIRECTIONS) {
      const u = unitFromAngleDeg(targetAngle);
      const cursor = applyCursorTransform(targetPosition(targetAngle, 100), { x: 0, y: 0 }, 45);
      expect(signedAngleDeg(u, cursor)).toBeCloseTo(45, 9);
    }
  });
});

describe('signedAngleDeg / cross / dot', () => {
  it('is positive for counterclockwise and negative for clockwise', () => {
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 12);
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(-90, 12);
    expect(signedAngleDeg({ x: 0, y: 1 }, { x: -1, y: 0 })).toBeCloseTo(90, 12);
  });

  it('is zero for parallel vectors and 180 for opposite ones', () => {
    expect(signedAngleDeg({ x: 2, y: 2 }, { x: 5, y: 5 })).toBeCloseTo(0, 12);
    expect(Math.abs(signedAngleDeg({ x: 1, y: 0 }, { x: -1, y: 0 })!)).toBeCloseTo(180, 12);
  });

  it('returns null for a zero-length vector', () => {
    expect(signedAngleDeg({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('cross(u, r) is the signed lateral offset and dot(u, r) the progress', () => {
    const u = unitFromAngleDeg(90); // target straight up
    const r = { x: -3, y: 50 }; // 50 along the axis, 3 to its left (CCW side)
    expect(cross(u, r)).toBeCloseTo(3, 12);
    expect(dot(u, r)).toBeCloseTo(50, 12);
  });
});

describe('targetPosition', () => {
  it('places eight targets on a circle at the expected screen directions', () => {
    const right = targetPosition(0, 240);
    const up = targetPosition(90, 240);
    const left = targetPosition(180, 240);
    const down = targetPosition(270, 240);
    expect(right.x).toBeCloseTo(240, 9);
    expect(right.y).toBeCloseTo(0, 9);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(240, 9); // +y is up
    expect(left.x).toBeCloseTo(-240, 9);
    expect(down.y).toBeCloseTo(-240, 9);
    for (const a of EIGHT_DIRECTIONS) expect(norm(targetPosition(a, 240))).toBeCloseTo(240, 9);
  });
});

describe('segmentCircleCrossing', () => {
  it('finds the fraction along a radial segment', () => {
    expect(segmentCircleCrossing({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)).toBeCloseTo(0.5, 12);
  });

  it('finds the crossing of an oblique segment exactly on the circle', () => {
    const a = { x: 30, y: 10 };
    const b = { x: 90, y: 70 };
    const f = segmentCircleCrossing(a, b, 60)!;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    expect(norm(lerp(a, b, f))).toBeCloseTo(60, 9);
  });

  it('returns 1 when the segment ends exactly on the circle', () => {
    expect(segmentCircleCrossing({ x: 0, y: 0 }, { x: 0, y: 5 }, 5)).toBeCloseTo(1, 12);
  });

  it('returns null when the segment stays inside or starts outside', () => {
    expect(segmentCircleCrossing({ x: 0, y: 0 }, { x: 3, y: 0 }, 5)).toBeNull();
    expect(segmentCircleCrossing({ x: 6, y: 0 }, { x: 9, y: 0 }, 5)).toBeNull();
    expect(segmentCircleCrossing({ x: 5, y: 0 }, { x: 9, y: 0 }, 5)).toBeNull();
  });
});

describe('clampToSquare', () => {
  it('limits each coordinate independently', () => {
    expect(clampToSquare({ x: 500, y: -500 }, 100)).toEqual({ x: 100, y: -100 });
    expect(clampToSquare({ x: 20, y: -30 }, 100)).toEqual({ x: 20, y: -30 });
  });
});

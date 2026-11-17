import { describe, expect, it } from 'vitest';
import { TrialEngine, type EngineConfig, type EngineTrial } from './engine';
import { norm, targetPosition, type Vec2 } from './geometry';
import { SUDDEN_45_V2, arrivalRadius } from './presets';
import { generateSchedule, type TrialSpec } from './schedule';
import { EngineDriver, engineConfigFor, runScriptedSession } from './testUtils';

const preset = SUDDEN_45_V2;
const baseConfig = engineConfigFor(preset);
const D = preset.geometry.targetDistance;
const TARGET_R = preset.geometry.targetRadius;
/** Arrival radius with a target hold: the near edge of the target. */
const R = arrivalRadius(preset.geometry, preset.timing);
const { holdMs, reachTimeoutMs, feedbackHoldMs } = preset.timing;
const targetHoldMs = preset.timing.targetHoldMs!;
const SQRT_HALF = Math.SQRT1_2;

function trial(overrides: Partial<EngineTrial> = {}): EngineTrial {
  return { targetIndex: 0, targetAngleDeg: 0, rotationDeg: 0, feedback: 'visible', ...overrides };
}

function setup(
  trials: EngineTrial[],
  opts: { initialCursor?: Vec2; repeatOnTimeout?: boolean; timing?: Partial<EngineConfig['timing']> } = {},
) {
  const config: EngineConfig = {
    ...baseConfig,
    timing: { ...baseConfig.timing, ...opts.timing },
    repeatOnTimeout: opts.repeatOnTimeout ?? false,
  };
  const engine = new TrialEngine(trials, config, {
    startTimeMs: 0,
    initialCursor: opts.initialCursor ?? { x: 50, y: 50 },
  });
  return { engine, driver: new EngineDriver(engine, config, 0, trials), config };
}

describe('the v2 preset asks for a target hold', () => {
  it('uses a 400 ms hold and an arrival radius at the near edge of the target', () => {
    expect(targetHoldMs).toBe(400);
    expect(R).toBe(D - TARGET_R);
    expect(R).toBe(222);
  });
});

describe('centre acquisition and hold', () => {
  it('starts by waiting for the cursor to be brought to the centre, with the cursor visible and no target lit', () => {
    const { engine } = setup([trial()]);
    const view = engine.getView();
    expect(view.phase).toBe('acquire');
    expect(view.cursorVisible).toBe(true);
    expect(view.activeTargetIndex).toBeNull();
    expect(view.cursor).toEqual({ x: 50, y: 50 });
  });

  it('uses the identity mapping between reaches: the cursor follows the hand exactly', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 })]);
    driver.move(-20, 10, 40);
    const { cursor } = engine.getView();
    expect(cursor.x).toBeCloseTo(30, 9);
    expect(cursor.y).toBeCloseTo(60, 9);
  });

  it('enters the hold when the cursor is inside the start circle and lights the target only after holdMs', () => {
    const { engine, driver } = setup([trial({ targetIndex: 3 })]);
    driver.move(-50, -50, 100);
    expect(engine.getView().phase).toBe('hold');
    driver.wait(holdMs - 40);
    expect(engine.getView().phase).toBe('hold');
    expect(engine.getView().activeTargetIndex).toBeNull();
    driver.wait(80);
    expect(engine.getView().phase).toBe('reach');
    expect(engine.getView().activeTargetIndex).toBe(3);
  });

  it('restarts the hold if the cursor leaves the start circle early', () => {
    const { engine, driver } = setup([trial()]);
    driver.move(-50, -50, 100);
    driver.wait(holdMs - 100);
    driver.move(40, 0, 20); // drift out
    expect(engine.getView().phase).toBe('acquire');
    driver.move(-40, 0, 20); // back in: the clock starts again
    expect(engine.getView().phase).toBe('hold');
    driver.wait(holdMs - 100);
    expect(engine.getView().phase).toBe('hold');
    driver.wait(150);
    expect(engine.getView().phase).toBe('reach');
  });

  it('recognises a cursor that is already centred without needing any movement', () => {
    const { engine, driver } = setup([trial()], { initialCursor: { x: 2, y: -3 } });
    driver.wait(32);
    expect(engine.getView().phase).toBe('hold');
    driver.wait(holdMs + 32);
    expect(engine.getView().phase).toBe('reach');
  });

  it('reports hold progress between 0 and 1', () => {
    const { engine, driver } = setup([trial()], { initialCursor: { x: 0, y: 0 } });
    driver.wait(16);
    driver.wait(holdMs / 2);
    const f = engine.getView().holdFraction;
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(0.8);
  });

  it('keeps the cursor inside the workspace between reaches', () => {
    const { engine, driver } = setup([trial()]);
    driver.move(100000, -100000, 50);
    const limit = preset.geometry.boundsHalfExtent - preset.geometry.cursorRadius;
    expect(engine.getView().cursor).toEqual({ x: limit, y: -limit });
  });
});

describe('anchoring at the go cue', () => {
  it('snaps both hand and cursor to the exact start and records the removed offset', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 })]);
    driver.move(-45, -44, 100); // ends at (5, 6), inside the start circle
    driver.wait(holdMs + 32);
    expect(engine.getView().phase).toBe('reach');
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 });

    engine.interrupt('window-blur', driver.t + 5); // close the record so it can be inspected
    const record = engine.getRecords()[0];
    expect(record.startAnchorOffset.x).toBeCloseTo(5, 9);
    expect(record.startAnchorOffset.y).toBeCloseTo(6, 9);
    // First reach sample is the anchored start, stamped with the go-cue time.
    expect(record.reach.handX[0]).toBe(0);
    expect(record.reach.handY[0]).toBe(0);
    expect(record.reach.cursorX![0]).toBe(0);
    expect(record.reach.cursorY![0]).toBe(0);
    expect(record.reach.tMs[0]).toBe(record.times.goCueMs);
  });
});

describe('cursor transformation during the outward reach', () => {
  it('+45°: the cursor is the hand displacement rotated counterclockwise', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 })]);
    driver.center();
    driver.move(100, 0, 40);
    const { cursor, cursorVisible } = engine.getView();
    expect(cursorVisible).toBe(true);
    expect(cursor.x).toBeCloseTo(100 * SQRT_HALF, 9);
    expect(cursor.y).toBeCloseTo(100 * SQRT_HALF, 9);
  });

  it('0°: the cursor coincides with the hand', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 0 })]);
    driver.center();
    driver.move(60, -80, 40);
    const { cursor } = engine.getView();
    expect(cursor.x).toBeCloseTo(60, 9);
    expect(cursor.y).toBeCloseTo(-80, 9);
  });

  it('records hand and cursor separately, related by the applied rotation on every sample', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45, targetAngleDeg: 90, targetIndex: 2 })]);
    driver.trial(45);
    const r = engine.getRecords()[0];
    expect(r.appliedRotationDeg).toBe(45);
    expect(r.reach.cursorX).not.toBeNull();
    for (let i = 0; i < r.reach.tMs.length; i++) {
      const hx = r.reach.handX[i];
      const hy = r.reach.handY[i];
      expect(r.reach.cursorX![i]).toBeCloseTo(SQRT_HALF * hx - SQRT_HALF * hy, 9);
      expect(r.reach.cursorY![i]).toBeCloseTo(SQRT_HALF * hx + SQRT_HALF * hy, 9);
    }
    // Hand positions are the running sum of the recorded deltas (start anchored at 0,0).
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < r.reach.tMs.length; i++) {
      sx += r.reach.dx[i];
      sy += r.reach.dy[i];
      expect(r.reach.handX[i]).toBeCloseTo(sx, 9);
      expect(r.reach.handY[i]).toBeCloseTo(sy, 9);
    }
  });

  it('uses the rotation of the CURRENT trial only (a catch trial is unrotated, the next is rotated again)', () => {
    const { engine, driver } = setup([
      trial({ rotationDeg: 45 }),
      trial({ rotationDeg: 0 }),
      trial({ rotationDeg: 45 }),
    ]);
    const cursorAfter100 = () => {
      driver.center();
      driver.move(100, 0, 40);
      const c = engine.getView().cursor;
      driver.settle();
      driver.finishFeedback();
      return c;
    };
    const a = cursorAfter100();
    const b = cursorAfter100();
    const c = cursorAfter100();
    expect(a.y).toBeCloseTo(100 * SQRT_HALF, 9);
    expect(b.x).toBeCloseTo(100, 9);
    expect(b.y).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(100 * SQRT_HALF, 9);
    expect(engine.getRecords().map((r) => r.appliedRotationDeg)).toEqual([45, 0, 45]);
  });
});

describe('hold-to-complete with a visible cursor', () => {
  it('registers at EXACTLY targetHoldMs after the cursor enters the target and stays', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    engine.handleMove(D, 0, t0 + 100); // one movement straight onto the target's centre
    driver.t = t0 + 100;
    const entered = t0 + 100;

    driver.wait(targetHoldMs - 20);
    expect(engine.getView().phase).toBe('reach'); // 20 ms short of the hold
    driver.wait(60);
    expect(engine.getView().phase).toBe('feedback');
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.holdCompleted).toBe(true);
    // Exactly the hold duration after entry, although frame ticks are 16 ms apart
    // and the tick that noticed came a little later.
    expect(r.times.holdCompletionMs).toBe(entered + targetHoldMs);
    expect(r.times.reachEndMs!).toBeGreaterThanOrEqual(entered + targetHoldMs);
    expect(r.times.reachEndMs! - (entered + targetHoldMs)).toBeLessThan(17);
  });

  it('registers at exactly targetHoldMs even when the next thing to happen is a late mouse movement', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    engine.handleMove(D, 0, t0 + 100);
    // No frame tick in between: the very next input is a movement well after the hold was up.
    engine.handleMove(60, 0, t0 + 100 + targetHoldMs + 250);
    expect(engine.getView().phase).toBe('feedback');
    driver.t = t0 + 100 + targetHoldMs + 250;
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.times.holdCompletionMs).toBe(t0 + 100 + targetHoldMs);
    // That late movement came after the reach had registered, so it is not part of the reach.
    expect(r.reach.tMs).toHaveLength(2);
    expect(r.reach.handX[1]).toBe(D);
  });

  it('RESETS the hold timer when the cursor leaves the target, and counts again from re-entry', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    engine.handleMove(D, 0, t0 + 100); // enters the target
    driver.t = t0 + 100;

    driver.wait(300); // 300 ms inside: three quarters of the hold
    expect(engine.getView().phase).toBe('reach');
    expect(engine.getView().targetHoldFraction).toBeCloseTo(0.75, 6);

    engine.handleMove(40, 0, driver.t + 10); // drifts out: 40 wu past the centre, the circle's radius is 18
    driver.t += 10;
    expect(engine.getView().targetHoldFraction).toBe(0);

    // By now more than targetHoldMs has passed since FIRST entering, but not continuously inside.
    driver.wait(200);
    expect(driver.t - (t0 + 100)).toBeGreaterThan(targetHoldMs);
    expect(engine.getView().phase).toBe('reach');

    const reentry = driver.t + 10;
    engine.handleMove(-40, 0, reentry); // back onto the target
    driver.t = reentry;
    driver.wait(targetHoldMs - 20);
    expect(engine.getView().phase).toBe('reach'); // the earlier 300 ms did not count
    driver.wait(60);
    expect(engine.getView().phase).toBe('feedback');
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.holdCompleted).toBe(true);
    expect(r.times.holdCompletionMs).toBe(reentry + targetHoldMs);
    // Arrival is still the FIRST time the hand reached the arrival radius.
    expect(r.times.completionMs).toBeCloseTo(t0 + (100 * R) / D, 9);
    expect(r.crossing!.sampleIndex).toBe(1);
  });

  it('passing straight through the target does not register', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    driver.reach(0, { distance: D * 1.5, durationMs: 200 }); // in one side and out the other
    expect(engine.getView().phase).toBe('reach');
    driver.wait(targetHoldMs + 100);
    expect(engine.getView().phase).toBe('reach');
    expect(engine.getView().targetHoldFraction).toBe(0);
  });

  it('reaching the target distance in the wrong place does not register until the cursor is steered onto the target', () => {
    const { engine, driver } = setup([trial({ targetAngleDeg: 0 })]);
    driver.center();
    driver.reach(30); // 30° off: far enough out, but nowhere near the target circle
    driver.wait(targetHoldMs + 200);
    expect(engine.getView().phase).toBe('reach');
    driver.settle();
    expect(engine.getView().phase).toBe('feedback');
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    // The outward reach is still described by where it first arrived: 30° off.
    expect((Math.atan2(r.crossing!.handY, r.crossing!.handX) * 180) / Math.PI).toBeCloseTo(30, 6);
  });

  it('it is the CURSOR that must be in the target, not the hand', () => {
    // Hand moved straight at the target's location under a 45° rotation: the cursor is 45° away.
    const a = setup([trial({ rotationDeg: 45 })]);
    a.driver.center();
    a.driver.reach(0);
    a.driver.wait(targetHoldMs + 200);
    expect(a.engine.getView().phase).toBe('reach');

    // Hand moved 45° clockwise of the target: the rotated cursor lands on it.
    const b = setup([trial({ rotationDeg: 45 })]);
    b.driver.center();
    b.driver.reach(-45);
    b.driver.wait(targetHoldMs + 50);
    expect(b.engine.getView().phase).toBe('feedback');
    expect(b.engine.getView().cursor.x).toBeCloseTo(D * 1.04, 6);
    expect(b.engine.getView().cursor.y).toBeCloseTo(0, 6);
  });

  it('counts the cursor as inside right up to the edge of the target circle', () => {
    const inside = setup([trial()]);
    inside.driver.center();
    inside.engine.handleMove(D, TARGET_R - 0.5, inside.driver.t + 50);
    inside.driver.t += 50;
    inside.driver.wait(targetHoldMs + 40);
    expect(inside.engine.getView().phase).toBe('feedback');

    const outside = setup([trial()]);
    outside.driver.center();
    outside.engine.handleMove(D, TARGET_R + 0.5, outside.driver.t + 50);
    outside.driver.t += 50;
    outside.driver.wait(targetHoldMs + 40);
    expect(outside.engine.getView().phase).toBe('reach');
  });

  it('keeps the target lit and reports "confirmed" through the pause, with the cursor staying where it was held', () => {
    const { engine, driver } = setup([trial({ targetIndex: 2, targetAngleDeg: 90 })]);
    driver.center();
    driver.reach(90);
    expect(engine.getView().confirmed).toBe(false);
    driver.settle();
    const view = engine.getView();
    expect(view.phase).toBe('feedback');
    expect(view.confirmed).toBe(true);
    expect(view.activeTargetIndex).toBe(2);
    expect(view.cursorVisible).toBe(true);
    const held = view.cursor;

    // Movement during the pause changes nothing and is not recorded.
    driver.move(40, -25, 40);
    expect(engine.getView().cursor).toEqual(held);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.postReach.tMs).toHaveLength(0);
    expect(r.reach.tMs[r.reach.tMs.length - 1]).toBeLessThanOrEqual(r.times.holdCompletionMs!);
  });

  it(`holds the pause for ${feedbackHoldMs} ms before moving on`, () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.reach(0);
    driver.settle();
    const noticed = driver.t;
    driver.wait(feedbackHoldMs - 40);
    expect(engine.getView().phase).toBe('feedback');
    driver.wait(80);
    expect(engine.getView().phase).not.toBe('feedback');
    expect(engine.getRecords()[0].times.attemptEndMs - noticed).toBeGreaterThanOrEqual(feedbackHoldMs);
  });
});

describe('hold-to-complete with the cursor hidden', () => {
  const hidden = (overrides: Partial<EngineTrial> = {}) => trial({ feedback: 'hidden', ...overrides });

  it('registers once the unseen hand has stayed at the target distance for targetHoldMs', () => {
    const { engine, driver } = setup([hidden({ targetAngleDeg: 90, targetIndex: 2 })]);
    driver.center();
    expect(engine.getView().cursorVisible).toBe(false);
    driver.reach(90);
    expect(engine.getView().phase).toBe('reach'); // arrived, but not yet held
    driver.settle();
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getView().cursorVisible).toBe(false);
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.holdCompleted).toBe(true);
    expect(r.cursorVisibleDuringReach).toBe(false);
    expect(r.reach.cursorX).toBeNull(); // no cursor was displayed, so none is recorded
    expect(r.reach.handX.length).toBeGreaterThan(10); // ...but the hand was tracked throughout
    expect(norm({ x: r.crossing!.handX, y: r.crossing!.handY })).toBeCloseTo(R, 6);
    expect(r.crossing!.cursorX).toBeNull();
    expect(r.crossing!.radius).toBe(R);
  });

  it('registers WHATEVER the direction: a reach 140° away from the target still completes', () => {
    // Direction is what a hidden reach measures, so it must never decide whether the reach registers.
    for (const offset of [-140, -45, -20, 20, 45, 140, 180]) {
      const { engine, driver } = setup([hidden({ targetAngleDeg: 0 })]);
      driver.trial(offset);
      const r = engine.getRecords()[0];
      expect(r.outcome).toBe('completed');
      expect(r.holdCompleted).toBe(true);
      const arrivedAt = (Math.atan2(r.crossing!.handY, r.crossing!.handX) * 180) / Math.PI;
      expect(Math.abs(arrivedAt)).toBeCloseTo(Math.abs(offset), 6);
    }
  });

  it('registers at exactly targetHoldMs after the hand first gets far enough', () => {
    const { engine, driver } = setup([hidden()]);
    driver.center();
    const t0 = driver.t;
    engine.handleMove(0, -D, t0 + 80); // any direction will do
    driver.t = t0 + 80;
    driver.wait(targetHoldMs + 40);
    driver.finishFeedback();
    expect(engine.getRecords()[0].times.holdCompletionMs).toBe(t0 + 80 + targetHoldMs);
  });

  it('restarts the hold if the hand comes back inside the arrival radius', () => {
    const { engine, driver } = setup([hidden()]);
    driver.center();
    const t0 = driver.t;
    engine.handleMove(D, 0, t0 + 100);
    driver.t = t0 + 100;
    driver.wait(300);
    engine.handleMove(-100, 0, driver.t + 10); // pulls back to 140 wu: no longer far enough
    driver.t += 10;
    driver.wait(300);
    expect(engine.getView().phase).toBe('reach');
    const reentry = driver.t + 10;
    engine.handleMove(100, 0, reentry);
    driver.t = reentry;
    driver.wait(targetHoldMs + 40);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.times.holdCompletionMs).toBe(reentry + targetHoldMs);
    expect(r.times.completionMs).toBeCloseTo(t0 + (100 * R) / D, 9); // arrival = the first crossing
  });

  it('an out-and-back movement that does not stay out does not register', () => {
    const { engine, driver } = setup([hidden()]);
    driver.center();
    driver.reach(0, { durationMs: 150 });
    driver.move(-D, 0, 150); // straight back before the hold is up
    driver.wait(targetHoldMs + 200);
    expect(engine.getView().phase).toBe('reach');
  });

  it('never reports hold progress, so the screen cannot hint at how an unseen reach is going', () => {
    const { engine, driver } = setup([hidden()]);
    driver.center();
    driver.reach(0);
    driver.wait(targetHoldMs / 2);
    const view = engine.getView();
    expect(view.phase).toBe('reach');
    expect(view.targetHoldFraction).toBe(0);
    expect(view.confirmed).toBe(false);
  });

  it('gives the same "registered" signal as a visible reach, wherever the hand ended', () => {
    const { engine, driver } = setup([hidden({ targetIndex: 4, targetAngleDeg: 180 })]);
    driver.center();
    driver.reach(120); // 60° off target
    driver.settle();
    const view = engine.getView();
    expect(view.confirmed).toBe(true);
    expect(view.activeTargetIndex).toBe(4);
    expect(view.cursorVisible).toBe(false);
  });
});

describe('arrival: the point every reach metric is measured to', () => {
  it('interpolates the arrival point and time between the two bracketing samples', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    // One coarse sample of 200 wu, then one of 40 wu: the arrival radius (222) is crossed 55% into the second.
    engine.handleMove(200, 0, t0 + 100);
    engine.handleMove(40, 0, t0 + 150);
    driver.t = t0 + 150;
    driver.settle();
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.crossing!.handX).toBeCloseTo(R, 9);
    expect(r.crossing!.handY).toBeCloseTo(0, 9);
    expect(r.crossing!.tMs).toBeCloseTo(t0 + 100 + 50 * ((R - 200) / 40), 9);
    expect(r.times.completionMs).toBe(r.crossing!.tMs);
    expect(r.crossing!.sampleIndex).toBe(2);
    expect(r.crossing!.radius).toBe(R);
    // The raw sample beyond the radius is kept as recorded.
    expect(r.reach.handX[2]).toBeCloseTo(240, 9);
  });

  it('registers movement onset at 5% of the target distance and arrival at the arrival radius, both interpolated', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    const distance = D * 1.04;
    driver.reach(0, { distance, durationMs: 300 }); // constant speed
    driver.settle();
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    const speed = distance / 300; // wu per ms
    expect(r.times.movementOnsetMs).toBeCloseTo(t0 + (0.05 * D) / speed, 6);
    expect(r.times.completionMs).toBeCloseTo(t0 + R / speed, 6);
    expect(r.times.goCueMs).toBe(t0);
    // Arrival comes first; the reach registers one hold later.
    expect(r.times.holdCompletionMs!).toBeGreaterThan(r.times.completionMs! + targetHoldMs - 1);
  });

  it('is noted once: wandering in and out afterwards does not move it', () => {
    const { engine, driver } = setup([trial({ targetAngleDeg: 0 })]);
    driver.center();
    driver.reach(60); // arrives 60° off target
    driver.move(-150, -100, 100); // back toward the middle
    driver.settle(); // and out again onto the target
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect((Math.atan2(r.crossing!.handY, r.crossing!.handX) * 180) / Math.PI).toBeCloseTo(60, 6);
    expect(r.crossing!.sampleIndex).toBeLessThan(r.reach.tMs.length - 20);
  });

  it('a cursor resting anywhere in the target has arrived, including short of the target centre', () => {
    // The v1 rule (cross the target distance itself) missed about half of such reaches.
    const { engine, driver } = setup([trial()]);
    driver.center();
    driver.reach(0, { distance: D - 12 }); // stops 12 wu short of the centre, inside the circle
    driver.settle();
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.crossing).not.toBeNull();
    expect(Math.max(...r.reach.handX)).toBeLessThan(D);
  });
});

describe('targetHoldMs = 0 collapses to the original crossing rule', () => {
  const noHold = { timing: { targetHoldMs: 0 } };

  it('registers the instant the hand crosses the target distance itself', () => {
    const { engine, driver } = setup([trial()], noHold);
    driver.center();
    const t0 = driver.t;
    // One coarse sample of 200 wu, then one of 100 wu: the ring (240) is crossed 40% into the second.
    engine.handleMove(200, 0, t0 + 100);
    expect(engine.getView().phase).toBe('reach');
    engine.handleMove(100, 0, t0 + 150);
    expect(engine.getView().phase).toBe('feedback'); // no waiting, no hold
    driver.t = t0 + 150;
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.crossing!.radius).toBe(D); // the target distance, not the target's near edge
    expect(r.crossing!.handX).toBeCloseTo(240, 9);
    expect(r.crossing!.tMs).toBeCloseTo(t0 + 120, 9);
    expect(r.times.completionMs).toBeCloseTo(t0 + 120, 9);
    // With no hold, "registered" and "arrived" are the same instant.
    expect(r.holdCompleted).toBe(true);
    expect(r.times.holdCompletionMs).toBe(r.times.completionMs);
    expect(r.times.reachEndMs).toBe(t0 + 150);
    // The crossing sample is the last one: the reach ended there.
    expect(r.crossing!.sampleIndex).toBe(r.reach.tMs.length - 1);
    expect(r.reach.handX[r.reach.handX.length - 1]).toBeCloseTo(300, 9);
  });

  it('does not need the target at all: a reach in the opposite direction registers', () => {
    const { engine, driver } = setup([trial({ targetAngleDeg: 0 })], noHold);
    driver.center();
    driver.reach(180, { distance: D * 1.08 });
    expect(engine.getView().phase).toBe('feedback');
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.crossing!.handX).toBeCloseTo(-D, 6);
  });

  it('registers a reach that lands exactly on the target distance', () => {
    const { engine, driver } = setup([trial()], noHold);
    driver.center();
    // A single delta of exactly D (summing many small steps would fall short by float error).
    engine.handleMove(0, D, driver.t + 50);
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getRecords()).toHaveLength(0); // record closes when the pause ends
    driver.t += 50;
    driver.finishFeedback();
    expect(engine.getRecords()[0].crossing!.handY).toBeCloseTo(D, 9);
  });

  it('shows the visible cursor exactly on the ring where it crossed', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 })], noHold);
    driver.center();
    driver.reach(0, { distance: D * 1.08 });
    const view = engine.getView();
    expect(view.phase).toBe('feedback');
    expect(view.cursorVisible).toBe(true);
    expect(view.cursor.x).toBeCloseTo(D * SQRT_HALF, 6);
    expect(view.cursor.y).toBeCloseTo(D * SQRT_HALF, 6);
    driver.finishFeedback();
    expect(engine.getRecords()[0].crossing!.cursorX).toBeCloseTo(D * SQRT_HALF, 6);
  });

  it('works the same with the cursor hidden', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden', targetAngleDeg: 90 })], noHold);
    driver.center();
    driver.reach(90, { distance: D * 1.08 });
    expect(engine.getView().phase).toBe('feedback');
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(norm({ x: r.crossing!.handX, y: r.crossing!.handY })).toBeCloseTo(D, 6);
  });

  it('shows why the rule was replaced: a cursor stopped inside the target, short of its centre, never registers', () => {
    const { engine, driver } = setup([trial()], noHold);
    driver.center();
    driver.reach(0, { distance: D - 5 }); // on the target, 5 wu short of the 240 wu ring
    driver.wait(1000);
    expect(engine.getView().phase).toBe('reach');
    driver.wait(reachTimeoutMs);
    driver.finishFeedback();
    expect(engine.getRecords()[0].outcome).toBe('timeout');
  });
});

describe('timeouts', () => {
  it('times out when no movement is made, records it, and moves on', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden' }), trial()]);
    driver.center();
    driver.wait(reachTimeoutMs - 50);
    expect(engine.getView().phase).toBe('reach');
    driver.wait(100);
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getView().notice).toBe('timeout');
    // No confirmation after a timeout: the target simply goes dark.
    expect(engine.getView().confirmed).toBe(false);
    expect(engine.getView().activeTargetIndex).toBeNull();
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.holdCompleted).toBe(false);
    expect(r.crossing).toBeNull();
    expect(r.times.completionMs).toBeNull();
    expect(r.times.holdCompletionMs).toBeNull();
    expect(r.times.movementOnsetMs).toBeNull();
    expect(engine.getView().trialsCompleted).toBe(1);
  });

  it('times out when the movement stops short of the arrival radius, keeping the partial path', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden' })]);
    driver.center();
    driver.move(120, 0, 200);
    driver.wait(reachTimeoutMs);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.crossing).toBeNull();
    expect(r.times.movementOnsetMs).not.toBeNull();
    expect(r.reach.handX[r.reach.handX.length - 1]).toBeCloseTo(120, 9);
  });

  it('a reach that arrived but never held keeps its arrival point when it times out', () => {
    const { engine, driver } = setup([trial({ targetAngleDeg: 0 })]);
    driver.center();
    driver.reach(-40); // arrives 40° clockwise of the target and stays there
    driver.wait(reachTimeoutMs);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.holdCompleted).toBe(false);
    expect(r.times.holdCompletionMs).toBeNull();
    expect(r.crossing).not.toBeNull();
    expect(r.times.completionMs).not.toBeNull();
    expect((Math.atan2(r.crossing!.handY, r.crossing!.handX) * 180) / Math.PI).toBeCloseTo(-40, 6);
  });

  it('the time limit wins when the hold would have finished after it', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    driver.wait(reachTimeoutMs - 200);
    engine.handleMove(D, 0, driver.t + 10); // onto the target with 190 ms to go: less than the hold
    driver.t += 10;
    driver.wait(targetHoldMs + 100);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.holdCompleted).toBe(false);
    expect(r.times.reachEndMs!).toBeGreaterThanOrEqual(t0 + reachTimeoutMs);
  });

  it('clears the timeout notice at the next go cue', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.wait(reachTimeoutMs + 50);
    driver.finishFeedback();
    expect(engine.getView().notice).toBe('timeout');
    driver.center();
    expect(engine.getView().notice).toBeNull();
  });

  it('practice mode repeats a timed-out reach instead of skipping it', () => {
    const { engine, driver } = setup([trial(), trial()], { repeatOnTimeout: true });
    driver.center();
    driver.wait(reachTimeoutMs + 50);
    driver.finishFeedback();
    expect(engine.getView().trialsCompleted).toBe(0);
    driver.trial(0);
    expect(engine.getView().trialsCompleted).toBe(1);
    expect(engine.getRecords().map((r) => [r.trialPosition, r.attempt, r.outcome])).toEqual([
      [0, 1, 'timeout'],
      [0, 2, 'completed'],
    ]);
  });
});

describe('the jump home: no return movement', () => {
  it('puts the cursor exactly on the centre, visible, the moment the pause ends', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 }), trial({ rotationDeg: 45 })]);
    driver.center();
    driver.reach(-45);
    driver.settle();
    const held = engine.getView().cursor;
    expect(norm(held)).toBeGreaterThan(R); // out at the target
    driver.finishFeedback();

    const view = engine.getView();
    expect(view.cursor).toEqual({ x: 0, y: 0 });
    expect(view.cursorVisible).toBe(true);
    expect(view.activeTargetIndex).toBeNull();
    expect(view.confirmed).toBe(false);
  });

  it('starts the next trial’s dwell immediately, with no movement needed', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.trial(0);
    // Already holding at the centre: there was never an 'acquire' phase to get through.
    expect(engine.getView().phase).toBe('hold');
    const closedAt = engine.getRecords()[0].times.attemptEndMs;
    driver.wait(holdMs - 40);
    expect(engine.getView().phase).toBe('hold');
    driver.wait(80);
    expect(engine.getView().phase).toBe('reach');

    driver.reach(0);
    driver.settle();
    driver.finishFeedback();
    const second = engine.getRecords()[1];
    expect(second.times.acquireStartMs).toBe(closedAt);
    expect(second.times.holdStartMs).toBe(closedAt); // the dwell began at the jump itself
    expect(second.times.goCueMs! - closedAt).toBeGreaterThanOrEqual(holdMs);
    expect(second.times.goCueMs! - closedAt).toBeLessThan(holdMs + 17);
  });

  it('records no movement after a reach and none before the next one when the mouse stays still', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.trial(0);
    driver.trial(0);
    const [first, second] = engine.getRecords();
    expect(first.postReach).toEqual({ tMs: [], dx: [], dy: [], x: [], y: [] });
    expect(second.postReach.tMs).toHaveLength(0);
    expect(second.preReach.tMs).toHaveLength(0);
    // Reach samples run from the go cue to no later than the moment the reach registered.
    expect(first.reach.tMs[0]).toBe(first.times.goCueMs);
    expect(first.reach.tMs[first.reach.tMs.length - 1]).toBeLessThanOrEqual(first.times.holdCompletionMs!);
  });

  it('a hidden-cursor reach never shows where it ended', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden' }), trial()]);
    driver.center();
    driver.reach(30);
    driver.settle();
    // Hidden for the whole reach and the pause...
    expect(engine.getView().cursorVisible).toBe(false);
    driver.finishFeedback();
    // ...and when the cursor comes back it is at the centre, not out where the hand was.
    expect(engine.getView().cursorVisible).toBe(true);
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 });
    expect(norm(targetPosition(30, D))).toBeCloseTo(D, 9); // (the hand really was far from the centre)
  });

  it('carries no offset into the next reach: it starts again from exactly (0, 0) with the new rotation', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 }), trial({ rotationDeg: 45 })]);
    driver.trial(-45);
    driver.center();
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 });
    driver.move(50, 0, 20);
    expect(engine.getView().cursor.x).toBeCloseTo(50 * SQRT_HALF, 9);
    expect(engine.getView().cursor.y).toBeCloseTo(50 * SQRT_HALF, 9);
  });

  it('a drift away from the centre after the jump restarts the dwell and is recorded as pre-reach movement', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.trial(0);
    driver.wait(holdMs - 100);
    driver.move(30, 0, 20); // leaves the start circle (radius 14)
    expect(engine.getView().phase).toBe('acquire');
    driver.move(-30, 0, 20);
    expect(engine.getView().phase).toBe('hold');
    driver.wait(holdMs - 100);
    expect(engine.getView().phase).toBe('hold'); // counting again from the return
    driver.trial(0);
    expect(engine.getRecords()[1].preReach.tMs.length).toBeGreaterThan(0);
  });

  it('jumps home after a timeout too', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.reach(70);
    driver.wait(reachTimeoutMs);
    driver.finishFeedback();
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 });
    expect(engine.getView().phase).toBe('hold');
  });
});

describe('interruptions (pointer-lock or focus loss)', () => {
  it('mid-reach: saves the partial attempt as interrupted and repeats the same trial', () => {
    const { engine, driver } = setup([trial({ targetIndex: 5, targetAngleDeg: 225, rotationDeg: 45 }), trial()]);
    driver.center();
    driver.move(90, 0, 80);
    engine.interrupt('pointer-lock-lost', driver.t);

    expect(engine.getView().phase).toBe('paused');
    expect(engine.getView().trialsCompleted).toBe(0);
    const partial = engine.getRecords()[0];
    expect(partial.outcome).toBe('interrupted');
    expect(partial.holdCompleted).toBe(false);
    expect(partial.attempt).toBe(1);
    expect(partial.reach.handX.length).toBeGreaterThan(5); // data kept, not dropped
    expect(partial.crossing).toBeNull();

    engine.resume(driver.t + 2000);
    driver.t += 2000;
    expect(engine.getView().phase).toBe('acquire');
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 }); // resumes from the centre
    driver.trial(180);

    const records = engine.getRecords();
    expect(records).toHaveLength(2);
    expect(records[1].trialPosition).toBe(0);
    expect(records[1].attempt).toBe(2);
    expect(records[1].outcome).toBe('completed');
    expect(records[1].trial.targetIndex).toBe(5);
    expect(records[1].appliedRotationDeg).toBe(45);
    expect(engine.getView().trialsCompleted).toBe(1);

    const log = engine.getInterruptions();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ reason: 'pointer-lock-lost', trialPosition: 0, attempt: 1, phase: 'reach' });
    expect(log[0].resumedAtMs).not.toBeNull();
  });

  it('while holding on the target: the reach is cut off before it registers and is repeated', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.reach(0);
    driver.wait(targetHoldMs / 2);
    engine.interrupt('window-blur', driver.t);
    const partial = engine.getRecords()[0];
    expect(partial.outcome).toBe('interrupted');
    expect(partial.holdCompleted).toBe(false);
    expect(partial.crossing).not.toBeNull(); // the arrival that did happen is kept
    engine.resume(driver.t + 500);
    driver.t += 500;
    driver.trial(0);
    expect(engine.getRecords()[1]).toMatchObject({ trialPosition: 0, attempt: 2, outcome: 'completed' });
  });

  it('while centring or holding: pauses without creating a record, then continues the same attempt', () => {
    const { engine, driver } = setup([trial()]);
    driver.move(-50, -50, 100);
    expect(engine.getView().phase).toBe('hold');
    engine.interrupt('window-blur', driver.t);
    expect(engine.getView().phase).toBe('paused');
    expect(engine.getRecords()).toHaveLength(0);

    driver.wait(5000); // time passing while paused changes nothing
    expect(engine.getView().phase).toBe('paused');
    engine.resume(driver.t);
    driver.trial(0);
    expect(engine.getRecords()).toHaveLength(1);
    expect(engine.getRecords()[0].attempt).toBe(1);
    expect(engine.getRecords()[0].outcome).toBe('completed');
  });

  it('during the post-reach pause: the finished reach is kept as completed', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.reach(0);
    driver.settle();
    expect(engine.getView().phase).toBe('feedback');
    engine.interrupt('tab-hidden', driver.t);
    expect(engine.getView().phase).toBe('paused');
    expect(engine.getRecords()[0].outcome).toBe('completed');
    expect(engine.getView().trialsCompleted).toBe(1);
  });

  it('ignores movement while paused', () => {
    const { engine, driver } = setup([trial()]);
    engine.interrupt('pointer-lock-lost', 10);
    const before = engine.getView().cursor;
    driver.move(100, 100, 50);
    expect(engine.getView().cursor).toEqual(before);
  });

  it('logs only the first cause of a single pause', () => {
    const { engine } = setup([trial()]);
    engine.interrupt('window-blur', 10);
    engine.interrupt('pointer-lock-lost', 11);
    engine.interrupt('tab-hidden', 12);
    expect(engine.getInterruptions()).toHaveLength(1);
    expect(engine.getInterruptions()[0].reason).toBe('window-blur');
  });

  it('an interrupted final-trial pause still finishes the session cleanly', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    driver.reach(0);
    driver.settle();
    engine.interrupt('window-blur', driver.t);
    expect(engine.isFinished()).toBe(true);
    expect(engine.getView().phase).toBe('finished');
  });
});

describe('timestamps', () => {
  it('stamps samples with the input event time, independent of frame ticks', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    const times = [t0 + 1.25, t0 + 3.5, t0 + 9.75, t0 + 10.125];
    for (const t of times) engine.handleMove(5, 0, t); // several samples, no tick in between
    engine.interrupt('window-blur', t0 + 11);
    const r = engine.getRecords()[0];
    expect(r.reach.tMs.slice(1)).toEqual(times);
  });

  it('never lets recorded time run backwards when an event carries a slightly older timestamp', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    engine.tick(t0 + 20);
    engine.handleMove(5, 0, t0 + 14); // event older than the tick already processed
    engine.handleMove(5, 0, t0 + 26);
    engine.interrupt('window-blur', t0 + 30);
    const t = engine.getRecords()[0].reach.tMs;
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    expect(t[1]).toBe(t0 + 20);
  });
});

describe('session flow', () => {
  it('counts completed trials and finishes after the last one', () => {
    const { engine, driver } = setup([trial(), trial({ feedback: 'hidden' }), trial()]);
    expect(engine.getView().trialsTotal).toBe(3);
    driver.trial(0);
    expect(engine.getView().trialsCompleted).toBe(1);
    driver.trial(0);
    driver.trial(0);
    expect(engine.isFinished()).toBe(true);
    const view = engine.getView();
    expect(view.phase).toBe('finished');
    expect(view.trialsCompleted).toBe(3);
    expect(view.cursorVisible).toBe(false);
    expect(view.activeTargetIndex).toBeNull();
    // Further input is harmless.
    engine.handleMove(10, 10, driver.t + 10);
    engine.tick(driver.t + 20);
    expect(engine.getRecords()).toHaveLength(3);
  });

  it('an empty trial list is finished immediately', () => {
    const { engine } = setup([]);
    expect(engine.isFinished()).toBe(true);
  });
});

describe('concealment: what the renderer is told', () => {
  it('the view exposes only neutral fields', () => {
    const { engine } = setup([trial()]);
    expect(Object.keys(engine.getView()).sort()).toEqual(
      [
        'activeTargetIndex',
        'confirmed',
        'cursor',
        'cursorVisible',
        'holdFraction',
        'notice',
        'phase',
        'targetHoldFraction',
        'trialsCompleted',
        'trialsTotal',
      ].sort(),
    );
  });

  it('runs a full 40-trial session and never leaks design words or announces a phase change', () => {
    const schedule = generateSchedule(SUDDEN_45_V2, 5);
    const config = engineConfigFor(SUDDEN_45_V2);
    const engine = new TrialEngine<TrialSpec>(schedule, config, { startTimeMs: 0 });
    const driver = new EngineDriver(engine, config, 0, schedule);
    const atGo: Array<{ trialNumber: number; snapshot: string }> = [];
    const atPause: string[] = [];

    for (const spec of schedule) {
      driver.center();
      const view = engine.getView();
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/baseline|adaptation|aftereffect|catch|rotation|45/i);
      expect(view.notice).toBeNull();
      // What the renderer knows at the go cue, minus the target identity.
      atGo.push({
        trialNumber: spec.trialNumber,
        snapshot: JSON.stringify({ ...view, activeTargetIndex: 'x', trialsCompleted: 'n' }),
      });
      driver.reach(spec.targetAngleDeg);
      driver.settle();
      // ...and during the pause, minus the target identity and where the cursor was held.
      atPause.push(JSON.stringify({ ...engine.getView(), activeTargetIndex: 'x', trialsCompleted: 'n', cursor: 'c' }));
      driver.finishFeedback();
    }
    expect(engine.isFinished()).toBe(true);

    // The first aftereffect trial (33) looks exactly like a baseline trial (1)
    // to the renderer: nothing marks the transition.
    expect(atGo[32].snapshot).toBe(atGo[0].snapshot);
    expect(atPause[32]).toBe(atPause[0]);
    // A catch trial (20) looks exactly like any other adaptation trial (19).
    expect(atGo[19].snapshot).toBe(atGo[18].snapshot);
    expect(atPause[19]).toBe(atPause[18]);
  });

  it('applies and records the scheduled rotation on every trial of a full session', () => {
    const schedule = generateSchedule(SUDDEN_45_V2, 8);
    const { engine } = runScriptedSession(SUDDEN_45_V2, schedule, () => 0);
    const records = engine.getRecords();
    expect(records).toHaveLength(40);
    records.forEach((r, i) => {
      expect(r.trial).toBe(schedule[i]);
      expect(r.appliedRotationDeg).toBe(schedule[i].rotationDeg);
      expect(r.cursorVisibleDuringReach).toBe(schedule[i].feedback === 'visible');
      expect(r.outcome).toBe('completed');
      expect(r.holdCompleted).toBe(true);
    });
    // Aftereffect block: zero rotation, hidden cursor, hand still recorded.
    for (const r of records.slice(32)) {
      expect(r.appliedRotationDeg).toBe(0);
      expect(r.reach.cursorX).toBeNull();
      expect(r.reach.handX.length).toBeGreaterThan(10);
    }
  });

  it('a participant with a large aftereffect completes every hidden-cursor reach', () => {
    // 40° clockwise of every target with the cursor hidden: exactly the case the
    // direction-free hidden zone exists for.
    const schedule = generateSchedule(SUDDEN_45_V2, 12);
    const aim = (t: TrialSpec) => (t.phase === 'adaptation' ? -45 : -40);
    const { engine } = runScriptedSession(SUDDEN_45_V2, schedule, aim);
    const hiddenRecords = engine.getRecords().filter((r) => !r.cursorVisibleDuringReach);
    expect(hiddenRecords).toHaveLength(16);
    for (const r of hiddenRecords) {
      expect(r.outcome).toBe('completed');
      expect(r.holdCompleted).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { TrialEngine, type EngineTrial } from './engine';
import { norm, targetPosition, type Vec2 } from './geometry';
import { SUDDEN_45_V1 } from './presets';
import { generateSchedule, type TrialSpec } from './schedule';
import { EngineDriver, engineConfigFor, runScriptedSession } from './testUtils';

const preset = SUDDEN_45_V1;
const baseConfig = engineConfigFor(preset);
const D = preset.geometry.targetDistance;
const { holdMs, reachTimeoutMs, feedbackHoldMs } = preset.timing;
const SQRT_HALF = Math.SQRT1_2;

function trial(overrides: Partial<EngineTrial> = {}): EngineTrial {
  return { targetIndex: 0, targetAngleDeg: 0, rotationDeg: 0, feedback: 'visible', ...overrides };
}

function setup(trials: EngineTrial[], opts: { initialCursor?: Vec2; repeatOnTimeout?: boolean } = {}) {
  const config = { ...baseConfig, repeatOnTimeout: opts.repeatOnTimeout ?? false };
  const engine = new TrialEngine(trials, config, {
    startTimeMs: 0,
    initialCursor: opts.initialCursor ?? { x: 50, y: 50 },
  });
  return { engine, driver: new EngineDriver(engine, config, 0) };
}

describe('centre acquisition and hold', () => {
  it('starts by waiting for the cursor to be brought to the centre, with the cursor visible and no target lit', () => {
    const { engine } = setup([trial()]);
    const view = engine.getView();
    expect(view.phase).toBe('acquire');
    expect(view.cursorVisible).toBe(true);
    expect(view.activeTargetIndex).toBeNull();
    expect(view.cursor).toEqual({ x: 50, y: 50 });
  });

  it('uses the identity mapping while returning: the cursor follows the hand exactly', () => {
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

    driver.reach(0);
    driver.finishFeedback();
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
      driver.reach(0);
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

describe('reach completion', () => {
  it('completes when the HAND crosses the target distance, with the cursor hidden', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden', targetAngleDeg: 90, targetIndex: 2 })]);
    driver.center();
    expect(engine.getView().cursorVisible).toBe(false);
    driver.reach(90);
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getView().cursorVisible).toBe(false);
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.cursorVisibleDuringReach).toBe(false);
    expect(r.reach.cursorX).toBeNull(); // no cursor was displayed, so none is recorded
    expect(r.reach.handX.length).toBeGreaterThan(10); // ...but the hand was tracked throughout
    expect(norm({ x: r.crossing!.handX, y: r.crossing!.handY })).toBeCloseTo(D, 6);
    expect(r.crossing!.cursorX).toBeNull();
  });

  it('does not require hitting the target: a reach in the opposite direction still completes', () => {
    const { engine, driver } = setup([trial({ targetAngleDeg: 0 })]);
    driver.trial(180);
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    expect(r.crossing!.handX).toBeCloseTo(-D, 6);
  });

  it('completes a reach that lands exactly on the target distance', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    // A single delta of exactly D (summing many small steps would fall short by float error).
    engine.handleMove(0, D, driver.t + 50);
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getRecords()).toHaveLength(0); // record closes when the pause ends
    driver.t += 50;
    driver.finishFeedback();
    expect(engine.getRecords()[0].crossing!.handY).toBeCloseTo(D, 9);
  });

  it('interpolates the crossing point and time between the two bracketing samples', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    // One coarse sample of 200 wu, then one of 100 wu: the ring (240) is crossed 40% into the second.
    engine.handleMove(200, 0, t0 + 100);
    engine.handleMove(100, 0, t0 + 150);
    const r0 = engine.getView();
    expect(r0.phase).toBe('feedback');
    driver.t = t0 + 150;
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.crossing!.handX).toBeCloseTo(240, 9);
    expect(r.crossing!.tMs).toBeCloseTo(t0 + 120, 9);
    expect(r.times.completionMs).toBeCloseTo(t0 + 120, 9);
    expect(r.times.reachEndMs).toBe(t0 + 150);
    // The raw final sample (beyond the ring) is kept as recorded.
    expect(r.reach.handX[r.reach.handX.length - 1]).toBeCloseTo(300, 9);
  });

  it('registers movement onset at 5% of the target distance and completion at 100%, both interpolated', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    const t0 = driver.t;
    const distance = D * 1.08;
    driver.reach(0, { distance, durationMs: 300 }); // constant speed
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    const speed = distance / 300; // wu per ms
    expect(r.times.movementOnsetMs).toBeCloseTo(t0 + (0.05 * D) / speed, 6);
    expect(r.times.completionMs).toBeCloseTo(t0 + D / speed, 6);
    expect(r.times.goCueMs).toBe(t0);
  });

  it('freezes the visible cursor exactly on the ring where it crossed', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 })]);
    driver.center();
    driver.reach(0);
    const view = engine.getView();
    expect(view.phase).toBe('feedback');
    expect(view.cursorVisible).toBe(true);
    expect(view.activeTargetIndex).toBe(0); // target stays lit so the error is visible
    expect(view.cursor.x).toBeCloseTo(D * SQRT_HALF, 6);
    expect(view.cursor.y).toBeCloseTo(D * SQRT_HALF, 6);

    // Overshoot during the pause moves the hand but not the frozen cursor.
    driver.move(40, 0, 40);
    expect(engine.getView().cursor.x).toBeCloseTo(D * SQRT_HALF, 6);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.postReach.tMs.length).toBeGreaterThan(0);
    expect(r.crossing!.cursorX).toBeCloseTo(D * SQRT_HALF, 6);
  });

  it('switches the target off at completion on hidden trials (neutral "reach registered" signal)', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden' })]);
    driver.center();
    expect(engine.getView().activeTargetIndex).toBe(0);
    driver.reach(10);
    expect(engine.getView().phase).toBe('feedback');
    expect(engine.getView().activeTargetIndex).toBeNull();
  });

  it(`holds the feedback pause for ${feedbackHoldMs} ms before the return begins`, () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.center();
    driver.reach(0);
    driver.wait(feedbackHoldMs - 60);
    expect(engine.getView().phase).toBe('feedback');
    driver.wait(120);
    expect(engine.getView().phase).toBe('acquire');
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
    driver.finishFeedback();

    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.crossing).toBeNull();
    expect(r.times.completionMs).toBeNull();
    expect(r.times.movementOnsetMs).toBeNull();
    expect(engine.getView().trialsCompleted).toBe(1);
    expect(engine.getView().phase).toBe('acquire');
  });

  it('times out when the movement stops short of the target distance, keeping the partial path', () => {
    const { engine, driver } = setup([trial()]);
    driver.center();
    driver.move(120, 0, 200);
    driver.wait(reachTimeoutMs);
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('timeout');
    expect(r.times.movementOnsetMs).not.toBeNull();
    expect(r.reach.handX[r.reach.handX.length - 1]).toBeCloseTo(120, 9);
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

describe('return to centre', () => {
  it('resumes the visible cursor from where it froze (no jump) and uses the identity mapping', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 }), trial({ rotationDeg: 45 })]);
    driver.center();
    driver.reach(0);
    const frozen = engine.getView().cursor;
    driver.move(25, 5, 40); // overshoot during the pause is not carried into the return
    driver.finishFeedback();

    expect(engine.getView().phase).toBe('acquire');
    expect(engine.getView().cursorVisible).toBe(true);
    expect(engine.getView().cursor.x).toBeCloseTo(frozen.x, 9);
    expect(engine.getView().cursor.y).toBeCloseTo(frozen.y, 9);

    // Identity mapping: a pure −x hand movement moves the cursor in pure −x, unrotated.
    driver.move(-10, 0, 20);
    expect(engine.getView().cursor.x).toBeCloseTo(frozen.x - 10, 9);
    expect(engine.getView().cursor.y).toBeCloseTo(frozen.y, 9);
  });

  it('after a hidden reach the cursor reappears at the hand’s crossing point', () => {
    const { engine, driver } = setup([trial({ feedback: 'hidden' }), trial()]);
    driver.trial(30);
    const expected = targetPosition(30, D);
    expect(engine.getView().cursorVisible).toBe(true);
    expect(engine.getView().cursor.x).toBeCloseTo(expected.x, 6);
    expect(engine.getView().cursor.y).toBeCloseTo(expected.y, 6);
  });

  it('a hidden trial never re-anchors to a rotated position, even if one were configured', () => {
    // Not used by the shipped presets, but pins the rule: with no cursor shown,
    // the return starts from the real hand position.
    const { engine, driver } = setup([trial({ feedback: 'hidden', rotationDeg: 45 }), trial()]);
    driver.trial(0);
    expect(engine.getView().cursor.x).toBeCloseTo(D, 6);
    expect(engine.getView().cursor.y).toBeCloseTo(0, 6);
  });

  it('carries no offset into the next reach: it starts again from exactly (0, 0)', () => {
    const { engine, driver } = setup([trial({ rotationDeg: 45 }), trial({ rotationDeg: 45 })]);
    driver.trial(-45);
    driver.center();
    expect(engine.getView().cursor).toEqual({ x: 0, y: 0 });
    driver.move(50, 0, 20);
    expect(engine.getView().cursor.x).toBeCloseTo(50 * SQRT_HALF, 9);
    expect(engine.getView().cursor.y).toBeCloseTo(50 * SQRT_HALF, 9);
  });

  it('keeps return movement out of the reach samples', () => {
    const { engine, driver } = setup([trial(), trial()]);
    driver.trial(0);
    driver.center(); // return for trial 2
    driver.reach(0);
    driver.finishFeedback();
    const [first, second] = engine.getRecords();
    // Reach samples span go cue → completing sample only.
    expect(first.reach.tMs[0]).toBe(first.times.goCueMs);
    expect(first.reach.tMs[first.reach.tMs.length - 1]).toBe(first.times.reachEndMs);
    // The return path belongs to the NEXT trial's pre-reach segment.
    expect(second.preReach.tMs.length).toBeGreaterThan(0);
    expect(second.preReach.tMs[0]).toBeGreaterThanOrEqual(first.times.attemptEndMs);
    expect(second.preReach.tMs[second.preReach.tMs.length - 1]).toBeLessThanOrEqual(second.times.goCueMs!);
  });
});

describe('interruptions (pointer-lock or focus loss)', () => {
  it('mid-reach: saves the partial attempt as interrupted and repeats the same trial', () => {
    const { engine, driver } = setup([trial({ targetIndex: 5, rotationDeg: 45 }), trial()]);
    driver.center();
    driver.move(90, 0, 80);
    engine.interrupt('pointer-lock-lost', driver.t);

    expect(engine.getView().phase).toBe('paused');
    expect(engine.getView().trialsCompleted).toBe(0);
    const partial = engine.getRecords()[0];
    expect(partial.outcome).toBe('interrupted');
    expect(partial.attempt).toBe(1);
    expect(partial.reach.handX.length).toBeGreaterThan(5); // data kept, not dropped
    expect(partial.crossing).toBeNull();

    engine.resume(driver.t + 2000);
    driver.t += 2000;
    expect(engine.getView().phase).toBe('acquire');
    driver.trial(-45);

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

  it('while returning or holding: pauses without creating a record, then continues the same attempt', () => {
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
      ['activeTargetIndex', 'cursor', 'cursorVisible', 'holdFraction', 'notice', 'phase', 'trialsCompleted', 'trialsTotal'].sort(),
    );
  });

  it('runs a full 40-trial session and never leaks design words or announces a phase change', () => {
    const schedule = generateSchedule(SUDDEN_45_V1, 5);
    const config = engineConfigFor(SUDDEN_45_V1);
    const engine = new TrialEngine<TrialSpec>(schedule, config, { startTimeMs: 0 });
    const driver = new EngineDriver(engine, config, 0);
    const atGo: Array<{ trialNumber: number; snapshot: string }> = [];

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
      driver.finishFeedback();
    }
    expect(engine.isFinished()).toBe(true);

    // The first aftereffect trial (33) looks exactly like a baseline trial (1)
    // to the renderer: nothing marks the transition.
    expect(atGo[32].snapshot).toBe(atGo[0].snapshot);
    // A catch trial (20) looks exactly like any other adaptation trial (19).
    expect(atGo[19].snapshot).toBe(atGo[18].snapshot);
  });

  it('applies and records the scheduled rotation on every trial of a full session', () => {
    const schedule = generateSchedule(SUDDEN_45_V1, 8);
    const { engine } = runScriptedSession(SUDDEN_45_V1, schedule, () => 0);
    const records = engine.getRecords();
    expect(records).toHaveLength(40);
    records.forEach((r, i) => {
      expect(r.trial).toBe(schedule[i]);
      expect(r.appliedRotationDeg).toBe(schedule[i].rotationDeg);
      expect(r.cursorVisibleDuringReach).toBe(schedule[i].feedback === 'visible');
      expect(r.outcome).toBe('completed');
    });
    // Aftereffect block: zero rotation, hidden cursor, hand still recorded.
    for (const r of records.slice(32)) {
      expect(r.appliedRotationDeg).toBe(0);
      expect(r.reach.cursorX).toBeNull();
      expect(r.reach.handX.length).toBeGreaterThan(10);
    }
  });
});

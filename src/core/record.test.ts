import { describe, expect, it } from 'vitest';
import { assignPreset } from './assignment';
import { TrialEngine } from './engine';
import { norm } from './geometry';
import { GRADUAL_45_V1, SUDDEN_45_V1 } from './presets';
import { SCHEMA_VERSION, buildSessionRecord, finalAttempts, reachDataOf, withReflection } from './record';
import { generateSchedule, type TrialSpec } from './schedule';
import { createSessionPlan, type SessionPlan } from './session';
import { EngineDriver, engineConfigFor, runScriptedSession, taskResultFrom } from './testUtils';

const now = new Date('2026-11-14T15:30:00.000Z');

function planFor(linkCode: 'k7m2' | 'p4x9', seed = 77): SessionPlan {
  return createSessionPlan({
    assignment: assignPreset(linkCode, () => 0),
    seed,
    sessionId: 'test-session',
    previousPresetIds: [],
    now,
  });
}

/** A clean scripted session: aim straight at every target. */
function cleanSession(linkCode: 'k7m2' | 'p4x9' = 'k7m2') {
  const plan = planFor(linkCode);
  const { engine, driver } = runScriptedSession(plan.preset, plan.schedule, () => 0);
  return buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);
}

describe('buildSessionRecord: session-level fields', () => {
  const session = cleanSession();

  it('identifies the app, schema, preset and assignment', () => {
    expect(session.schemaVersion).toBe(SCHEMA_VERSION);
    expect(session.app).toEqual({ name: 'visuomotor-learning-lab', version: '1.0.0' });
    expect(session.sessionId).toBe('test-session');
    expect(session.preset).toEqual(SUDDEN_45_V1);
    expect(session.preset.id).toBe('rotation-sudden-45-v1');
    expect(session.preset.version).toBe(1);
    expect(session.assignment).toMatchObject({ method: 'direct-link', presetId: 'rotation-sudden-45-v1' });
    expect(session.runNumber).toBe(1);
    expect(session.previousPresetIds).toEqual([]);
  });

  it('saves the seed and the exact schedule it produced', () => {
    expect(session.seed).toBe(77);
    expect(session.schedule).toEqual(generateSchedule(SUDDEN_45_V1, 77));
    expect(session.schedule.map((t) => t.targetIndex)).toEqual(finalAttempts(session).map((t) => t.targetIndex));
  });

  it('documents its own units and sign conventions', () => {
    expect(session.conventions.rotation).toMatch(/cursor = start \+ R\(theta\)/);
    expect(session.conventions.directionError).toMatch(/counterclockwise/);
    expect(session.conventions.coordinates).toMatch(/\+y up/);
  });

  it('reports durations and wall-clock times', () => {
    expect(session.createdAtIso).toBe('2026-11-14T15:30:00.000Z');
    expect(session.durations.experimentMs).toBeCloseTo(session.timing.experimentEndedMs - 1000, 6);
    expect(session.durations.totalTaskMs).toBeCloseTo(session.durations.experimentMs + 30000, 6);
    expect(session.durations.practiceMs).toBe(25000);
    expect(Date.parse(session.completedAtIso)).toBeGreaterThan(Date.parse(session.createdAtIso));
  });

  it('starts with no reflection and can have one attached', () => {
    expect(session.reflection).toBeNull();
    const answered = withReflection(session, { skipped: false, noticed: 'It drifted.', changedAim: 'yes', device: 'mouse' });
    expect(answered.reflection).toEqual({ skipped: false, noticed: 'It drifted.', changedAim: 'yes', device: 'mouse' });
    expect(session.reflection).toBeNull(); // original untouched
  });

  it('includes a descriptive summary of the participant’s own trials', () => {
    expect(session.summary.trialsScheduled).toBe(40);
    expect(session.summary.trialsValid).toBe(40);
    expect(session.summary.catchTrials.map((c) => c.trialNumber)).toEqual([20, 28]);
  });
});

describe('buildSessionRecord: every trial records the required data', () => {
  for (const code of ['k7m2', 'p4x9'] as const) {
    const session = cleanSession(code);
    const preset = code === 'k7m2' ? SUDDEN_45_V1 : GRADUAL_45_V1;

    it(`${preset.id}: one final attempt per scheduled trial, matching the schedule`, () => {
      expect(session.trials).toHaveLength(40);
      session.trials.forEach((t, i) => {
        const spec = session.schedule[i];
        expect(t).toMatchObject({
          trialNumber: i + 1,
          trialIndex: i,
          attempt: 1,
          isFinalAttempt: true,
          phase: spec.phase,
          slotInPhase: spec.slotInPhase,
          isCatch: spec.isCatch,
          perturbedReachNumber: spec.perturbedReachNumber,
          targetIndex: spec.targetIndex,
          targetAngleDeg: spec.targetAngleDeg,
          configuredRotationDeg: spec.rotationDeg,
          appliedRotationDeg: spec.rotationDeg,
          feedback: spec.feedback,
          cursorVisibleDuringReach: spec.feedback === 'visible',
          outcome: 'completed',
          valid: true,
          invalidReason: null,
        });
        // Target position agrees with its direction and distance.
        expect(norm({ x: t.targetX, y: t.targetY })).toBeCloseTo(preset.geometry.targetDistance, 9);
        expect((Math.atan2(t.targetY, t.targetX) * 180) / Math.PI).toBeCloseTo(
          spec.targetAngleDeg > 180 ? spec.targetAngleDeg - 360 : spec.targetAngleDeg,
          9,
        );
      });
    });

    it(`${preset.id}: timestamps, deltas, hand path and (when shown) cursor path are all present`, () => {
      for (const t of session.trials) {
        const { reach, preReach } = t.samples;
        const n = reach.tMs.length;
        expect(n).toBeGreaterThan(10);
        for (const column of [reach.dx, reach.dy, reach.handX, reach.handY]) expect(column).toHaveLength(n);
        if (t.cursorVisibleDuringReach) {
          expect(reach.cursorX).toHaveLength(n);
          expect(reach.cursorY).toHaveLength(n);
        } else {
          expect(reach.cursorX).toBeNull();
          expect(reach.cursorY).toBeNull();
        }
        // Monotonic timestamps, starting at the go cue.
        expect(reach.tMs[0]).toBe(t.times.goCueMs);
        for (let i = 1; i < n; i++) expect(reach.tMs[i]).toBeGreaterThanOrEqual(reach.tMs[i - 1]);
        expect(preReach.tMs.length).toBeGreaterThan(0);

        expect(t.times.movementOnsetMs).not.toBeNull();
        expect(t.times.completionMs).not.toBeNull();
        expect(t.times.movementOnsetMs!).toBeGreaterThanOrEqual(t.times.goCueMs!);
        expect(t.times.completionMs!).toBeGreaterThan(t.times.movementOnsetMs!);
        expect(t.crossing).not.toBeNull();
        expect(t.metrics.hand).not.toBeNull();
        expect(t.metrics.cursor === null).toBe(!t.cursorVisibleDuringReach);
      }
    });
  }

  it('records the exact gradual angle applied on each trial', () => {
    const session = cleanSession('p4x9');
    const applied = session.trials.filter((t) => t.phase === 'adaptation' && !t.isCatch).map((t) => t.appliedRotationDeg);
    expect(applied[0]).toBe(0);
    expect(applied[1]).toBeCloseTo(45 / 7, 12);
    expect(applied[7]).toBe(45);
    expect(applied.slice(8).every((a) => a === 45)).toBe(true);
    for (const t of session.trials.filter((x) => x.isCatch)) expect(t.appliedRotationDeg).toBe(0);
  });

  it('metrics in the record reflect the recorded movement', () => {
    const plan = planFor('k7m2');
    // Hand aimed 45° clockwise during adaptation (full compensation), 20° clockwise afterwards.
    const aim = (t: TrialSpec) => (t.phase === 'adaptation' ? -45 : t.phase === 'aftereffect' ? -20 : 0);
    const { engine, driver } = runScriptedSession(plan.preset, plan.schedule, aim);
    const session = buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);

    for (const t of session.trials) {
      expect(t.metrics.hand!.initialDirectionErrorDeg).toBeCloseTo(aim(session.schedule[t.trialIndex]), 4);
      if (t.metrics.cursor) {
        // Cursor error = hand error + applied rotation.
        expect(t.metrics.cursor.initialDirectionErrorDeg).toBeCloseTo(
          t.metrics.hand!.initialDirectionErrorDeg + t.appliedRotationDeg,
          4,
        );
      }
    }
    // Catch trials: rotation off, hand still 45° clockwise, so the visible cursor misses by −45°.
    for (const t of session.trials.filter((x) => x.isCatch)) {
      expect(t.metrics.cursor!.endpointDirectionErrorDeg).toBeCloseTo(-45, 4);
    }
    expect(session.summary.firstAftereffect.valueDeg).toBeCloseTo(-20, 4);
  });
});

describe('buildSessionRecord: invalid attempts are kept and flagged', () => {
  const plan = planFor('k7m2', 5);
  const config = engineConfigFor(plan.preset);
  const engine = new TrialEngine<TrialSpec>(plan.schedule, config, { startTimeMs: 1000 });
  const driver = new EngineDriver(engine, config, 1000);

  for (const spec of plan.schedule) {
    if (spec.trialNumber === 5) {
      // Pointer lock lost halfway through the reach; the trial is then repeated.
      driver.center();
      driver.move(100, 0, 100);
      engine.interrupt('pointer-lock-lost', driver.t);
      driver.t += 1500;
      engine.resume(driver.t);
      driver.trial(spec.targetAngleDeg);
    } else if (spec.trialNumber === 10) {
      // No movement at all: timeout.
      driver.center();
      driver.wait(plan.preset.timing.reachTimeoutMs + 50);
      driver.finishFeedback();
    } else {
      driver.trial(spec.targetAngleDeg);
    }
  }
  const session = buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);

  it('keeps the interrupted attempt alongside its repeat', () => {
    expect(session.trials).toHaveLength(41);
    const attempts = session.trials.filter((t) => t.trialNumber === 5);
    expect(attempts.map((t) => [t.attempt, t.outcome, t.isFinalAttempt, t.valid, t.invalidReason])).toEqual([
      [1, 'interrupted', false, false, 'interrupted'],
      [2, 'completed', true, true, null],
    ]);
    expect(attempts[0].samples.reach.handX.length).toBeGreaterThan(5); // partial movement preserved
    expect(attempts[0].metrics.hand).toBeNull();
  });

  it('flags the timeout as invalid with null metrics, and does not repeat it', () => {
    const attempts = session.trials.filter((t) => t.trialNumber === 10);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'timeout', valid: false, invalidReason: 'timeout', isFinalAttempt: true });
    expect(attempts[0].metrics).toMatchObject({ valid: false, nullReason: 'timeout', hand: null, cursor: null });
    expect(attempts[0].crossing).toBeNull();
  });

  it('logs the interruption with the trial it hit', () => {
    expect(session.interruptions).toHaveLength(1);
    expect(session.interruptions[0]).toMatchObject({
      reason: 'pointer-lock-lost',
      trialNumber: 5,
      attempt: 1,
      enginePhase: 'reach',
    });
    expect(session.interruptions[0].resumedAtMs).not.toBeNull();
  });

  it('finalAttempts gives exactly one attempt per scheduled trial, in order', () => {
    const finals = finalAttempts(session);
    expect(finals.map((t) => t.trialNumber)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(finals[4].attempt).toBe(2);
  });

  it('counts valid and invalid trials in the summary', () => {
    expect(session.summary.trialsScheduled).toBe(40);
    expect(session.summary.trialsValid).toBe(39);
    expect(session.summary.trialsTimedOut).toBe(1);
  });

  it('reachDataOf exposes what path analysis needs', () => {
    const data = reachDataOf(session.trials[0]);
    expect(data.outcome).toBe('completed');
    expect(data.reach).toBe(session.trials[0].samples.reach);
    expect(data.crossing).toEqual(session.trials[0].crossing);
  });
});

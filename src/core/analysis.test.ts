import { describe, expect, it } from 'vitest';
import {
  alignPath,
  catchNeighbours,
  computePathMetrics,
  computeTrialMetrics,
  groupTrials,
  outwardPath,
  summarizeSession,
  type MetricsInput,
  type Path,
  type SummaryTrial,
} from './analysis';
import { TrialEngine, type AttemptRecord, type EngineTrial } from './engine';
import { norm, targetPosition } from './geometry';
import { GRADUAL_45_V1, QUICK_DEMO_45_V1, SUDDEN_45_V1 } from './presets';
import { generateSchedule, type TrialSpec } from './schedule';
import { EngineDriver, engineConfigFor, runScriptedSession, type ReachOptions } from './testUtils';

const preset = SUDDEN_45_V1;
const { geometry, criteria } = preset;
const D = geometry.targetDistance;
const EIGHT_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);

const asInput = (r: AttemptRecord): MetricsInput => ({
  outcome: r.outcome,
  crossing: r.crossing,
  reach: r.reach,
  targetAngleDeg: r.trial.targetAngleDeg,
  cursorVisibleDuringReach: r.cursorVisibleDuringReach,
  times: r.times,
});

/** Run one trial through the real engine and return its record. */
function recordReach(trial: Partial<EngineTrial>, handAngleDeg: number, options: ReachOptions = {}): AttemptRecord {
  const config = engineConfigFor(preset);
  const spec: EngineTrial = { targetIndex: 0, targetAngleDeg: 0, rotationDeg: 0, feedback: 'visible', ...trial };
  const engine = new TrialEngine([spec], config, { startTimeMs: 0 });
  const driver = new EngineDriver(engine, config, 0);
  driver.trial(handAngleDeg, options);
  return engine.getRecords()[0];
}

const metricsOf = (r: AttemptRecord) => computeTrialMetrics(asInput(r), geometry, criteria);

describe('signed error across all eight target directions', () => {
  const offsets = [-45, -20, -5, 0, 5, 20, 45];

  for (const targetAngleDeg of EIGHT_DIRECTIONS) {
    it(`target at ${targetAngleDeg}°: direction error equals the hand's angular offset, with the right sign`, () => {
      for (const offset of offsets) {
        const m = metricsOf(recordReach({ targetAngleDeg }, targetAngleDeg + offset));
        expect(m.valid).toBe(true);
        // + offset = hand counterclockwise of the target = positive error.
        expect(m.hand!.initialDirectionErrorDeg).toBeCloseTo(offset, 6);
        expect(m.hand!.endpointDirectionErrorDeg).toBeCloseTo(offset, 6);
        // Lateral deviation carries the same sign and the expected size.
        expect(m.hand!.maxAbsLateralDeviation).toBeCloseTo(D * Math.abs(sinDeg(offset)), 4);
        if (offset !== 0) {
          expect(Math.sign(m.hand!.signedLateralDeviationAtMax)).toBe(Math.sign(offset));
        }
      }
    });
  }

  it('counterclockwise is positive regardless of which way the target points', () => {
    // A hand path 10° counterclockwise of the target: for a rightward target
    // that is "above" it, for a leftward target "below" it — both must be +10.
    expect(metricsOf(recordReach({ targetAngleDeg: 0 }, 10)).hand!.initialDirectionErrorDeg).toBeCloseTo(10, 6);
    expect(metricsOf(recordReach({ targetAngleDeg: 180 }, 190)).hand!.initialDirectionErrorDeg).toBeCloseTo(10, 6);
    expect(metricsOf(recordReach({ targetAngleDeg: 270 }, 260)).hand!.initialDirectionErrorDeg).toBeCloseTo(-10, 6);
  });
});

describe('hand versus cursor under rotation', () => {
  for (const targetAngleDeg of EIGHT_DIRECTIONS) {
    it(`target at ${targetAngleDeg}°: with +45° the cursor error is the hand error plus 45°`, () => {
      // Naive reach straight at the target: hand error 0, cursor error +45.
      const naive = metricsOf(recordReach({ targetAngleDeg, rotationDeg: 45 }, targetAngleDeg));
      expect(naive.hand!.initialDirectionErrorDeg).toBeCloseTo(0, 6);
      expect(naive.cursor!.initialDirectionErrorDeg).toBeCloseTo(45, 6);
      expect(naive.cursor!.endpointDirectionErrorDeg).toBeCloseTo(45, 6);

      // Full compensation: hand 45° clockwise, cursor on target.
      const adapted = metricsOf(recordReach({ targetAngleDeg, rotationDeg: 45 }, targetAngleDeg - 45));
      expect(adapted.hand!.initialDirectionErrorDeg).toBeCloseTo(-45, 6);
      expect(adapted.cursor!.initialDirectionErrorDeg).toBeCloseTo(0, 6);
      expect(adapted.cursor!.maxAbsLateralDeviation).toBeCloseTo(0, 4);
    });
  }

  it('an aftereffect-like reach (no rotation, hidden cursor, hand still 30° clockwise) is −30° with no cursor metrics', () => {
    const m = metricsOf(recordReach({ targetAngleDeg: 135, feedback: 'hidden' }, 105));
    expect(m.valid).toBe(true);
    expect(m.hand!.initialDirectionErrorDeg).toBeCloseTo(-30, 6);
    expect(m.cursor).toBeNull();
  });
});

describe('initial direction is not the same thing as endpoint error', () => {
  // A corrected movement: sets off 30° counterclockwise, then bends back to the target.
  const bend = targetPosition(30, 100);
  const curved: Path = { x: [0, bend.x, D], y: [0, bend.y, 0], tMs: [0, 100, 300] };

  it('reports the early heading at 25% of the distance and the final error separately', () => {
    const m = computePathMetrics(curved, 0, geometry, criteria)!;
    expect(m.initialDirectionErrorDeg).toBeCloseTo(30, 6);
    expect(m.endpointDirectionErrorDeg).toBeCloseTo(0, 6);
  });

  it('measures the bend as lateral deviation with the correct side', () => {
    const m = computePathMetrics(curved, 0, geometry, criteria)!;
    expect(m.maxAbsLateralDeviation).toBeCloseTo(100 * sinDeg(30), 6);
    expect(m.signedLateralDeviationAtMax).toBeCloseTo(50, 6);
    const mirrored: Path = { x: curved.x, y: curved.y.map((y) => -y), tMs: curved.tMs };
    expect(computePathMetrics(mirrored, 0, geometry, criteria)!.signedLateralDeviationAtMax).toBeCloseTo(-50, 6);
  });

  it('computes path length and efficiency from the actual path', () => {
    const m = computePathMetrics(curved, 0, geometry, criteria)!;
    const second = norm({ x: D - bend.x, y: -bend.y });
    expect(m.pathLength).toBeCloseTo(100 + second, 6);
    expect(m.pathEfficiency).toBeCloseTo(D / (100 + second), 6);
    expect(m.pathEfficiency).toBeLessThan(1);
  });

  it('uses the FIRST time the path reaches the early radius, even if it wanders back', () => {
    const p: Path = { x: [0, 70, 20, D], y: [0, 0, 5, 0], tMs: [0, 50, 100, 300] };
    expect(computePathMetrics(p, 0, geometry, criteria)!.initialDirectionErrorDeg).toBeCloseTo(0, 6);
  });

  it('returns null for a path that never reaches the early radius', () => {
    const p: Path = { x: [0, 10, 20], y: [0, 0, 0], tMs: [0, 10, 20] };
    expect(computePathMetrics(p, 0, geometry, criteria)).toBeNull();
  });
});

describe('straight-reach reference values', () => {
  it('a perfectly straight reach to the target has zero error, zero deviation and efficiency 1', () => {
    const m = metricsOf(recordReach({ targetAngleDeg: 225 }, 225));
    expect(m.hand!.initialDirectionErrorDeg).toBeCloseTo(0, 6);
    expect(m.hand!.maxAbsLateralDeviation).toBeCloseTo(0, 6);
    expect(m.hand!.meanAbsLateralDeviation).toBeCloseTo(0, 6);
    expect(m.hand!.pathLength).toBeCloseTo(D, 6);
    expect(m.hand!.pathEfficiency).toBeCloseTo(1, 6);
  });

  it('a straight but misdirected reach has mean |lateral| of half its maximum', () => {
    const m = metricsOf(recordReach({ targetAngleDeg: 90 }, 120));
    expect(m.hand!.maxAbsLateralDeviation).toBeCloseTo(D * sinDeg(30), 4);
    expect(m.hand!.meanAbsLateralDeviation).toBeCloseTo((D * sinDeg(30)) / 2, 4);
    expect(m.hand!.pathEfficiency).toBeCloseTo(1, 6); // straight, just aimed elsewhere
  });

  it('reaction time and movement duration come from onset and crossing times', () => {
    const r = recordReach({}, 0, { distance: D * 1.08, durationMs: 300 });
    const m = metricsOf(r);
    const speed = (D * 1.08) / 300;
    expect(m.reactionTimeMs).toBeCloseTo((0.05 * D) / speed, 6);
    expect(m.movementDurationMs).toBeCloseTo((0.95 * D) / speed, 6);
    expect(m.reactionTimeMs! + m.movementDurationMs!).toBeCloseTo(r.times.completionMs! - r.times.goCueMs!, 6);
  });

  it('results do not depend on the mouse sampling rate', () => {
    const fine = metricsOf(recordReach({ targetAngleDeg: 45, rotationDeg: 45 }, 20, { sampleMs: 1 }));
    const coarse = metricsOf(recordReach({ targetAngleDeg: 45, rotationDeg: 45 }, 20, { sampleMs: 16 }));
    expect(coarse.hand!.initialDirectionErrorDeg).toBeCloseTo(fine.hand!.initialDirectionErrorDeg, 6);
    expect(coarse.hand!.endpointDirectionErrorDeg).toBeCloseTo(fine.hand!.endpointDirectionErrorDeg, 6);
    expect(coarse.cursor!.endpointDirectionErrorDeg).toBeCloseTo(fine.cursor!.endpointDirectionErrorDeg, 6);
    expect(coarse.hand!.pathLength).toBeCloseTo(fine.hand!.pathLength, 6);
  });
});

describe('outwardPath and alignPath', () => {
  it('ends exactly on the target circle and drops the overshoot sample', () => {
    const r = recordReach({ rotationDeg: 45 }, 10);
    const hand = outwardPath(asInput(r), 'hand')!;
    const cursor = outwardPath(asInput(r), 'cursor')!;
    const last = hand.x.length - 1;
    expect(norm({ x: hand.x[last], y: hand.y[last] })).toBeCloseTo(D, 6);
    expect(norm({ x: cursor.x[last], y: cursor.y[last] })).toBeCloseTo(D, 6);
    expect(hand.x.length).toBe(r.reach.tMs.length);
    expect(hand.tMs[last]).toBe(r.crossing!.tMs);
    // Starts at the anchored start.
    expect([hand.x[0], hand.y[0]]).toEqual([0, 0]);
  });

  it('has no cursor path when the cursor was hidden', () => {
    const r = recordReach({ feedback: 'hidden' }, 0);
    expect(outwardPath(asInput(r), 'cursor')).toBeNull();
    expect(outwardPath(asInput(r), 'hand')).not.toBeNull();
  });

  it('never includes return or post-reach movement', () => {
    const r = recordReach({}, 0);
    const hand = outwardPath(asInput(r), 'hand')!;
    expect(hand.tMs[0]).toBe(r.times.goCueMs);
    expect(hand.tMs[hand.tMs.length - 1]).toBeLessThanOrEqual(r.times.reachEndMs!);
  });

  it('aligns to the target axis: progress is the dot product, lateral the cross product', () => {
    const a = alignPath({ x: [0, -3], y: [0, 50], tMs: [0, 1] }, 90); // target straight up
    expect(a.progress[1]).toBeCloseTo(50, 9);
    expect(a.lateral[1]).toBeCloseTo(3, 9); // to the left of an upward axis = counterclockwise = +
    const b = alignPath({ x: [0, 50], y: [0, 3], tMs: [0, 1] }, 0); // target to the right
    expect(b.progress[1]).toBeCloseTo(50, 9);
    expect(b.lateral[1]).toBeCloseTo(3, 9);
  });

  it('aligned straight reaches to any target land on (D, 0)', () => {
    for (const targetAngleDeg of EIGHT_DIRECTIONS) {
      const r = recordReach({ targetAngleDeg }, targetAngleDeg);
      const a = alignPath(outwardPath(asInput(r), 'hand')!, targetAngleDeg);
      const last = a.progress.length - 1;
      expect(a.progress[last]).toBeCloseTo(D, 6);
      expect(a.lateral[last]).toBeCloseTo(0, 6);
    }
  });
});

describe('invalid and degenerate trials produce nulls with a reason', () => {
  const config = engineConfigFor(preset);
  const spec: EngineTrial = { targetIndex: 0, targetAngleDeg: 0, rotationDeg: 45, feedback: 'visible' };

  it('timeout', () => {
    const engine = new TrialEngine([spec], config, { startTimeMs: 0 });
    const driver = new EngineDriver(engine, config, 0);
    driver.center();
    driver.move(120, 30, 150);
    driver.wait(preset.timing.reachTimeoutMs + 50);
    driver.finishFeedback();
    const m = metricsOf(engine.getRecords()[0]);
    expect(m).toMatchObject({
      valid: false,
      nullReason: 'timeout',
      hand: null,
      cursor: null,
      reactionTimeMs: null,
      movementDurationMs: null,
    });
    expect(m.reachSampleCount).toBeGreaterThan(10); // the samples themselves are kept
  });

  it('interrupted', () => {
    const engine = new TrialEngine([spec], config, { startTimeMs: 0 });
    const driver = new EngineDriver(engine, config, 0);
    driver.center();
    driver.move(100, 0, 100);
    engine.interrupt('pointer-lock-lost', driver.t);
    const m = metricsOf(engine.getRecords()[0]);
    expect(m).toMatchObject({ valid: false, nullReason: 'interrupted', hand: null, cursor: null });
  });

  it('too few samples (a single enormous jump across the workspace)', () => {
    const engine = new TrialEngine([spec], config, { startTimeMs: 0 });
    const driver = new EngineDriver(engine, config, 0);
    driver.center();
    engine.handleMove(400, 0, driver.t + 20);
    driver.t += 20;
    driver.finishFeedback();
    const r = engine.getRecords()[0];
    expect(r.outcome).toBe('completed');
    const m = metricsOf(r);
    expect(m).toMatchObject({ valid: false, nullReason: 'too-few-samples', hand: null, cursor: null });
    expect(m.reachSampleCount).toBe(2);
  });
});

describe('grouping trials', () => {
  const schedule = generateSchedule(SUDDEN_45_V1, 4);

  it('splits the standard schedule into the expected groups', () => {
    const g = groupTrials(schedule);
    expect(g.baseline).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(g.perturbed).toHaveLength(22);
    expect(g.perturbed).not.toContain(20);
    expect(g.perturbed).not.toContain(28);
    expect(g.earlyPerturbed).toEqual([9, 10, 11, 12]);
    expect(g.latePerturbed).toEqual([29, 30, 31, 32]);
    expect(g.catches).toEqual([20, 28]);
    expect(g.aftereffect).toEqual([33, 34, 35, 36, 37, 38, 39, 40]);
    expect(g.firstAftereffect).toBe(33);
  });

  it('keeps early and late windows from overlapping in the short demo', () => {
    const g = groupTrials(generateSchedule(QUICK_DEMO_45_V1, 4));
    expect(g.perturbed).toHaveLength(7);
    expect(g.earlyPerturbed).toHaveLength(3);
    expect(g.latePerturbed).toHaveLength(3);
    expect(g.earlyPerturbed.some((n) => g.latePerturbed.includes(n))).toBe(false);
  });

  it('finds the perturbed trials on either side of each catch trial', () => {
    expect(catchNeighbours(schedule, 20)).toEqual({ before: 19, after: 21 });
    expect(catchNeighbours(schedule, 28)).toEqual({ before: 27, after: 29 });
  });
});

describe('per-participant summary', () => {
  /** A scripted participant with a known aim offset in each part of the session. */
  const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 2 : t.phase === 'adaptation' ? -40 : -15);

  const summaryFor = (presetConfig: typeof SUDDEN_45_V1) => {
    const schedule = generateSchedule(presetConfig, 21);
    const { engine } = runScriptedSession(presetConfig, schedule, aim);
    const trials: SummaryTrial[] = engine.getRecords().map((r) => ({
      trialNumber: r.trial.trialNumber,
      phase: r.trial.phase,
      isCatch: r.trial.isCatch,
      appliedRotationDeg: r.appliedRotationDeg,
      metrics: computeTrialMetrics(asInput(r), presetConfig.geometry, presetConfig.criteria),
    }));
    return summarizeSession(trials);
  };

  it('recovers the scripted aim in each part of a sudden session', () => {
    const s = summaryFor(SUDDEN_45_V1);
    expect(s.metric).toBe('hand.initialDirectionErrorDeg');
    expect(s.trialsScheduled).toBe(40);
    expect(s.trialsValid).toBe(40);
    expect(s.baseline).toMatchObject({ n: 8, meanRotationDeg: 0 });
    expect(s.baseline.meanDeg).toBeCloseTo(2, 4);
    expect(s.earlyPerturbed).toMatchObject({ n: 4, meanRotationDeg: 45, trialNumbers: [9, 10, 11, 12] });
    expect(s.latePerturbed.meanDeg).toBeCloseTo(-40, 4);
    expect(s.catchTrials.map((c) => c.trialNumber)).toEqual([20, 28]);
    for (const c of s.catchTrials) expect(c.valueDeg).toBeCloseTo(-40, 4);
    expect(s.catchTrials[0]).toMatchObject({ neighbourBefore: 19, neighbourAfter: 21 });
    expect(s.firstAftereffect.trialNumber).toBe(33);
    expect(s.firstAftereffect.valueDeg).toBeCloseTo(-15, 4);
    expect(s.aftereffect.n).toBe(8);
    expect(s.aftereffect.meanDeg).toBeCloseTo(-15, 4);
  });

  it('reports the mean rotation actually applied in the early window of a gradual session', () => {
    const s = summaryFor(GRADUAL_45_V1);
    const step = 45 / 7;
    expect(s.earlyPerturbed.meanRotationDeg).toBeCloseTo((0 + step + 2 * step + 3 * step) / 4, 9);
    expect(s.latePerturbed.meanRotationDeg).toBe(45);
  });

  it('leaves invalid trials out of the means and counts them', () => {
    const schedule = generateSchedule(SUDDEN_45_V1, 21);
    const { engine } = runScriptedSession(SUDDEN_45_V1, schedule, aim);
    const trials: SummaryTrial[] = engine.getRecords().map((r, i) => {
      const metrics = computeTrialMetrics(asInput(r), geometry, criteria);
      return {
        trialNumber: r.trial.trialNumber,
        phase: r.trial.phase,
        isCatch: r.trial.isCatch,
        appliedRotationDeg: r.appliedRotationDeg,
        // Pretend baseline trial 3 timed out and the first aftereffect trial was degenerate.
        metrics:
          i === 2
            ? { ...metrics, valid: false, nullReason: 'timeout', hand: null, cursor: null }
            : i === 32
              ? { ...metrics, valid: false, nullReason: 'too-few-samples', hand: null, cursor: null }
              : metrics,
      };
    });
    const s = summarizeSession(trials);
    expect(s.trialsValid).toBe(38);
    expect(s.trialsTimedOut).toBe(1);
    expect(s.trialsDegenerate).toBe(1);
    expect(s.baseline.n).toBe(7);
    expect(s.baseline.meanDeg).toBeCloseTo(2, 4);
    expect(s.firstAftereffect).toEqual({ trialNumber: 33, valueDeg: null });
    expect(s.aftereffect.n).toBe(7);
  });
});

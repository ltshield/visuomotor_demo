/**
 * The results charts draw exactly what these functions return, so these tests
 * are the check that "the revealed graphs faithfully represent recorded
 * movement": a scripted participant with known aim must come back out of the
 * chart data unchanged.
 */
import { describe, expect, it } from 'vitest';
import { arrivalRadius } from '../../core/presets';
import { finalAttempts, type SessionRecord } from '../../core/record';
import type { TrialSpec } from '../../core/schedule';
import { scriptedSessionRecord } from '../../core/testUtils';
import {
  PROGRESS_LEVELS_PCT,
  catchCallout,
  catchComparisons,
  describeDirection,
  formatDuration,
  groupAverages,
  initialErrorFor,
  normalizedPath,
  pathPanels,
  phaseBands,
  resampleByProgress,
  signedWithDirection,
  trialPoints,
  unavailableReason,
} from './model';

const toDeg = (rad: number) => (rad * 180) / Math.PI;
const tanDeg = (d: number) => Math.tan((d * Math.PI) / 180);
const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);

/** Known behaviour: slight baseline bias, strong compensation while rotated, a partial aftereffect. */
const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);

const sudden = scriptedSessionRecord('k7m2', aim);
const gradual = scriptedSessionRecord('p4x9', aim);
const demo = scriptedSessionRecord('demo', aim);
const D = sudden.preset.geometry.targetDistance;
/** Where outward paths end, as a fraction of the target distance (the near edge of the target). */
const ARRIVAL = arrivalRadius(sudden.preset.geometry, sudden.preset.timing) / D;

/** Copy of a session in which one trial has been turned into a timeout. */
function withTimeout(session: SessionRecord, trialNumber: number): SessionRecord {
  return {
    ...session,
    trials: session.trials.map((t) =>
      t.trialNumber === trialNumber
        ? {
            ...t,
            outcome: 'timeout' as const,
            valid: false,
            invalidReason: 'timeout',
            crossing: null,
            metrics: { ...t.metrics, valid: false, nullReason: 'timeout' as const, hand: null, cursor: null },
          }
        : t,
    ),
  };
}

describe('phaseBands', () => {
  it('marks the three blocks of the standard protocol with their cursor visibility', () => {
    expect(phaseBands(sudden)).toEqual([
      { phase: 'baseline', label: 'Baseline', note: 'cursor hidden', firstTrial: 1, lastTrial: 8 },
      { phase: 'adaptation', label: 'Rotation block', note: 'cursor visible', firstTrial: 9, lastTrial: 32 },
      { phase: 'aftereffect', label: 'Aftereffect block', note: 'cursor hidden', firstTrial: 33, lastTrial: 40 },
    ]);
  });

  it('follows the shorter Quick Demo schedule', () => {
    expect(phaseBands(demo).map((b) => [b.firstTrial, b.lastTrial])).toEqual([
      [1, 4],
      [5, 12],
      [13, 16],
    ]);
  });
});

describe('trialPoints', () => {
  const points = trialPoints(sudden);

  it('has one point per scheduled trial, in order', () => {
    expect(points.map((p) => p.trialNumber)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('plots the rotation that was actually applied', () => {
    points.forEach((p, i) => {
      expect(p.rotationDeg).toBe(sudden.schedule[i].rotationDeg);
      expect(p.rotationDeg).toBe(finalAttempts(sudden)[i].appliedRotationDeg);
      expect(p.isCatch).toBe(sudden.schedule[i].isCatch);
    });
    expect(points.filter((p) => p.isCatch).map((p) => [p.trialNumber, p.rotationDeg])).toEqual([
      [20, 0],
      [28, 0],
    ]);
  });

  it('shows the gradual ramp reaching exactly 45° on the eighth rotated reach', () => {
    const rotated = trialPoints(gradual).filter((p) => p.phase === 'adaptation' && !p.isCatch);
    expect(rotated[0].rotationDeg).toBe(0);
    expect(rotated[1].rotationDeg).toBeCloseTo(45 / 7, 12);
    expect(rotated[7].rotationDeg).toBe(45);
  });

  it('plots the participant’s recorded hand direction on every trial', () => {
    points.forEach((p, i) => {
      expect(p.valid).toBe(true);
      expect(p.handInitialDeg).toBeCloseTo(aim(sudden.schedule[i]), 4);
      expect(p.handEndpointDeg).toBeCloseTo(aim(sudden.schedule[i]), 4);
    });
  });

  it('has cursor values only where the cursor was shown, equal to hand + rotation', () => {
    for (const p of points) {
      if (p.cursorShown) {
        expect(p.cursorInitialDeg).toBeCloseTo(p.handInitialDeg! + p.rotationDeg, 4);
      } else {
        expect(p.cursorInitialDeg).toBeNull();
        expect(p.cursorEndpointDeg).toBeNull();
      }
      expect(initialErrorFor(p, 'hand')).toBe(p.handInitialDeg);
      expect(initialErrorFor(p, 'cursor')).toBe(p.cursorInitialDeg);
    }
  });

  it('gives the full-compensation reference as the opposite of the rotation, never −0', () => {
    for (const p of points) {
      expect(p.compensationDeg).toBe(p.rotationDeg === 0 ? 0 : -p.rotationDeg);
      expect(Object.is(p.compensationDeg, -0)).toBe(false);
    }
  });

  it('leaves a gap (nulls and a reason) for an invalid trial instead of a made-up value', () => {
    const p = trialPoints(withTimeout(sudden, 5))[4];
    expect(p).toMatchObject({
      trialNumber: 5,
      valid: false,
      invalidReason: 'timeout',
      handInitialDeg: null,
      handEndpointDeg: null,
      cursorInitialDeg: null,
    });
  });
});

describe('normalizedPath', () => {
  const finals = finalAttempts(sudden);

  it('starts at the origin and ends on the arrival radius at the reach’s direction error', () => {
    expect(ARRIVAL).toBeCloseTo(0.925, 9);
    for (const t of finals) {
      const path = normalizedPath(t, 'hand', D)!;
      expect(path[0]).toEqual({ progress: 0, lateral: 0 });
      const end = path[path.length - 1];
      expect(Math.hypot(end.progress, end.lateral)).toBeCloseTo(ARRIVAL, 6);
      expect(toDeg(Math.atan2(end.lateral, end.progress))).toBeCloseTo(aim(sudden.schedule[t.trialIndex]), 4);
    }
  });

  it('gives the cursor path rotated by the applied rotation, and null when the cursor was hidden', () => {
    for (const t of finals) {
      const path = normalizedPath(t, 'cursor', D);
      if (!t.cursorVisibleDuringReach) {
        expect(path).toBeNull();
        expect(unavailableReason(t, 'cursor')).toBe('cursor was hidden');
        continue;
      }
      const end = path![path!.length - 1];
      expect(toDeg(Math.atan2(end.lateral, end.progress))).toBeCloseTo(
        aim(sudden.schedule[t.trialIndex]) + t.appliedRotationDeg,
        4,
      );
    }
  });

  it('is null for a reach that never arrived', () => {
    const t = finalAttempts(withTimeout(sudden, 9))[8];
    expect(normalizedPath(t, 'hand', D)).toBeNull();
    expect(unavailableReason(t, 'hand')).toBe('timed out');
  });

  it('still draws a reach that arrived but ran out of time before its hold registered', () => {
    const original = finals[8];
    const t = { ...original, outcome: 'timeout' as const, holdCompleted: false };
    expect(normalizedPath(t, 'hand', D)).toEqual(normalizedPath(original, 'hand', D));
    // In cursor view on a hidden trial the reason is the hidden cursor, not the timeout.
    const hiddenTimeout = { ...finals[0], outcome: 'timeout' as const, holdCompleted: false };
    expect(normalizedPath(hiddenTimeout, 'cursor', D)).toBeNull();
    expect(unavailableReason(hiddenTimeout, 'cursor')).toBe('cursor was hidden');
  });
});

describe('resampleByProgress', () => {
  const line = [
    { progress: 0, lateral: 0 },
    { progress: 0.5, lateral: 0.1 },
    { progress: 0.8, lateral: -0.2 },
  ];

  it('interpolates linearly between path points', () => {
    const [a, b, c] = resampleByProgress(line, [0.25, 0.5, 0.65]) as number[];
    expect(a).toBeCloseTo(0.05, 12);
    expect(b).toBeCloseTo(0.1, 12);
    expect(c).toBeCloseTo(-0.05, 12);
  });

  it('is 0 at the start and null beyond the furthest progress reached', () => {
    expect(resampleByProgress(line, [0, 0.9, 1])).toEqual([0, null, null]);
  });

  it('uses the first time each level is reached when a path doubles back', () => {
    const wobble = [
      { progress: 0, lateral: 0 },
      { progress: 0.6, lateral: 0.3 },
      { progress: 0.4, lateral: 0.5 },
      { progress: 1, lateral: 0 },
    ];
    expect(resampleByProgress(wobble, [0.5])[0]).toBeCloseTo(0.25, 12);
  });

  it('handles an empty path', () => {
    expect(resampleByProgress([], [0, 0.5])).toEqual([null, null]);
  });
});

describe('pathPanels', () => {
  const panels = pathPanels(sudden, 'hand');
  const byKey = Object.fromEntries(panels.map((p) => [p.key, p]));
  const roles = (key: string) => byKey[key].paths.map((p) => [p.trialNumber, p.role]);

  it('provides the required comparisons in a fixed order', () => {
    expect(panels.map((p) => p.key)).toEqual(['baseline', 'early', 'late', 'catch-20', 'catch-28', 'aftereffect']);
  });

  it('puts the right trials in each panel', () => {
    expect(roles('baseline')).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 'primary']));
    expect(roles('early')).toEqual([9, 10, 11, 12].map((n) => [n, 'primary']));
    expect(roles('late')).toEqual([29, 30, 31, 32].map((n) => [n, 'primary']));
    expect(roles('catch-20')).toEqual([
      [19, 'context'],
      [21, 'context'],
      [20, 'catch'],
    ]);
    expect(roles('catch-28')).toEqual([
      [27, 'context'],
      [29, 'context'],
      [28, 'catch'],
    ]);
    expect(roles('aftereffect')).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 'context']),
      [33, 'primary'],
    ]);
  });

  it('describes each panel with the trials and rotation it shows', () => {
    expect(byKey.baseline.caption).toBe('Trials 1–8 · no rotation');
    expect(byKey.early.caption).toBe('Trials 9–12 · rotation +45°');
    expect(byKey['catch-20'].caption).toBe('Trial 20 (rotation off), with rotated trials 19 and 21 in gray');
    const gradualEarly = pathPanels(gradual, 'hand').find((p) => p.key === 'early')!;
    expect(gradualEarly.caption).toBe('Trials 9–12 · rotation 0° to +19.3°');
  });

  it('draws the recorded path: each path ends at that trial’s direction error', () => {
    for (const panel of panels) {
      for (const path of panel.paths) {
        const end = path.points[path.points.length - 1];
        const spec = sudden.schedule[path.trialNumber - 1];
        expect(toDeg(Math.atan2(end.lateral, end.progress))).toBeCloseTo(aim(spec), 4);
      }
    }
  });

  it('in cursor view, lists hidden-cursor trials as unavailable instead of drawing anything', () => {
    const cursorPanels = Object.fromEntries(pathPanels(sudden, 'cursor').map((p) => [p.key, p]));
    expect(cursorPanels.baseline.paths).toHaveLength(0);
    expect(cursorPanels.baseline.unavailable).toHaveLength(8);
    expect(cursorPanels.baseline.unavailable.every((u) => u.reason === 'cursor was hidden')).toBe(true);
    expect(cursorPanels.late.paths).toHaveLength(4);
    expect(cursorPanels['catch-20'].paths).toHaveLength(3);
    expect(cursorPanels.aftereffect.paths).toHaveLength(0);
  });

  it('leaves out a timed-out trial and says so', () => {
    const p = pathPanels(withTimeout(sudden, 3), 'hand').find((x) => x.key === 'baseline')!;
    expect(p.paths.map((x) => x.trialNumber)).toEqual([1, 2, 4, 5, 6, 7, 8]);
    expect(p.unavailable).toEqual([{ trialNumber: 3, reason: 'timed out' }]);
  });

  it('adapts to the Quick Demo (one catch trial)', () => {
    const keys = pathPanels(demo, 'hand').map((p) => p.key);
    expect(keys).toEqual(['baseline', 'early', 'late', 'catch-10', 'aftereffect']);
    expect(pathPanels(demo, 'hand').find((p) => p.key === 'catch-10')!.title).toBe('Catch trial');
  });
});

describe('catchComparisons (lateral deviation against progress)', () => {
  const comparisons = catchComparisons(sudden, 'hand');

  it('compares each catch trial with the rotated reach before and after it', () => {
    expect(comparisons.map((c) => c.catchTrialNumber)).toEqual([20, 28]);
    expect(comparisons[0].series.map((s) => [s.trialNumber, s.role, s.dataKey])).toEqual([
      [19, 'before', 't19'],
      [20, 'catch', 't20'],
      [21, 'after', 't21'],
    ]);
    expect(comparisons[0].series.map((s) => s.rotationDeg)).toEqual([45, 0, 45]);
    expect(comparisons[0].series.every((s) => s.available)).toBe(true);
  });

  it('samples every reach at the same progress levels from 0 to 100%', () => {
    expect(PROGRESS_LEVELS_PCT[0]).toBe(0);
    expect(PROGRESS_LEVELS_PCT[PROGRESS_LEVELS_PCT.length - 1]).toBe(100);
    for (const c of comparisons) {
      expect(c.rows.map((r) => r.progressPct)).toEqual([...PROGRESS_LEVELS_PCT]);
    }
  });

  it('plots the signed lateral deviation of the recorded hand path', () => {
    // The scripted hand moves in a straight line 35° clockwise of the target,
    // so lateral = progress × tan(−35°), and the outward reach ends where it
    // arrives: at 92.5% of the target distance, i.e. 0.925 × cos(35°) ≈ 76% progress.
    for (const c of comparisons) {
      for (const s of c.series) {
        for (const row of c.rows) {
          const p = row.progressPct as number;
          const value = row[s.dataKey];
          if (p <= cosDeg(35) * ARRIVAL * 100 - 0.01) expect(value).toBeCloseTo(p * tanDeg(-35), 4);
          else expect(value).toBeNull();
        }
      }
    }
  });

  it('in cursor view the catch trial stands apart from its rotated neighbours', () => {
    // Neighbours: cursor error = −35 + 45 = +10°. Catch (rotation off): cursor error = −35°.
    const c = catchComparisons(sudden, 'cursor')[0];
    const at50 = c.rows.find((r) => r.progressPct === 50)!;
    expect(at50.t19).toBeCloseTo(50 * tanDeg(10), 4);
    expect(at50.t20).toBeCloseTo(50 * tanDeg(-35), 4);
    expect(at50.t21).toBeCloseTo(50 * tanDeg(10), 4);
  });

  it('flags that the compared reaches went to different targets', () => {
    for (const c of comparisons) {
      const targets = new Set(c.series.map((s) => s.targetAngleDeg));
      expect(c.sameTarget).toBe(targets.size === 1);
    }
    // Neighbouring trials never share a target in a balanced, no-repeat schedule.
    expect(comparisons[0].sameTarget).toBe(false);
  });

  it('marks a neighbour that cannot be drawn rather than inventing a line', () => {
    const c = catchComparisons(withTimeout(sudden, 19), 'hand')[0];
    expect(c.series[0]).toMatchObject({ trialNumber: 19, available: false, reason: 'timed out' });
    expect(c.rows.every((r) => !('t19' in r))).toBe(true);
    expect(c.rows[10].t20).not.toBeNull();
  });

  it('has a single comparison for the Quick Demo', () => {
    expect(catchComparisons(demo, 'hand').map((c) => c.catchTrialNumber)).toEqual([10]);
  });
});

describe('catchCallout', () => {
  /** A session whose catch trials (20 and 28) have the given initial directions; null = no usable value. */
  function withCatchValues(session: SessionRecord, values: Array<number | null>): SessionRecord {
    const numbers = session.summary.catchTrials.map((c) => c.trialNumber);
    return {
      ...session,
      summary: {
        ...session.summary,
        catchTrials: session.summary.catchTrials.map((c, i) => ({ ...c, valueDeg: values[i] })),
      },
      trials: session.trials.map((t) => {
        const i = numbers.indexOf(t.trialNumber);
        if (i < 0 || values[i] !== null) return t;
        return { ...t, valid: false, invalidReason: 'timeout', metrics: { ...t.metrics, valid: false, nullReason: 'timeout' as const, hand: null, cursor: null } };
      }),
    };
  }

  it('reports the FIRST catch trial, with the rotation it followed and the participant’s baseline', () => {
    const c = catchCallout(sudden)!;
    expect(c.trialNumber).toBe(20);
    expect(c.valueDeg).toBeCloseTo(-35, 4);
    expect(c.skippedTrialNumbers).toEqual([]);
    expect(c.rotationDeg).toBe(45); // trial 19, the rotated reach just before it
    expect(c.baselineMeanDeg).toBeCloseTo(3, 4);
    // Shift from baseline = −38°; cancelling +45° exactly needs −45°.
    expect(c.compensation).toBeCloseTo(38 / 45, 4);
    expect(c.level).toBe('full');
  });

  it('falls back to the second catch trial when the first has no usable value', () => {
    const c = catchCallout(withCatchValues(sudden, [null, -30]))!;
    expect(c.trialNumber).toBe(28);
    expect(c.valueDeg).toBe(-30);
    expect(c.skippedTrialNumbers).toEqual([20]);
  });

  it('is omitted when every catch trial is invalid', () => {
    expect(catchCallout(withCatchValues(sudden, [null, null]))).toBeNull();
  });

  it('is omitted for a session with no catch trials at all', () => {
    const none: SessionRecord = { ...sudden, summary: { ...sudden.summary, catchTrials: [] } };
    expect(catchCallout(none)).toBeNull();
  });

  it('uses the single catch trial of the Quick Demo', () => {
    expect(catchCallout(demo)!.trialNumber).toBe(10);
  });

  it('grades the reach from the data instead of assuming an effect', () => {
    // Baseline aim is +3°, rotation +45°: the levels are judged on (value − 3) against −45.
    const level = (value: number) => catchCallout(withCatchValues(sudden, [value, 0]))!.level;
    expect(level(-48.5)).toBe('full');
    expect(level(-31)).toBe('full'); // 34/45 = 0.76
    expect(level(-30)).toBe('partial'); // 33/45 = 0.73
    expect(level(-9)).toBe('partial'); // 12/45 = 0.27
    expect(level(-8)).toBe('little'); // 11/45 = 0.24
    expect(level(3)).toBe('little'); // exactly the baseline aim: no carry-over at all
    expect(level(12)).toBe('little'); // 9° the other way: within ordinary scatter
    expect(level(20)).toBe('opposite');
  });

  it('judges against the participant’s own baseline, so a habitual bias is not read as compensation', () => {
    // Someone who always aims 14° clockwise, and does so again on the catch trial, has carried nothing over.
    const biased: SessionRecord = {
      ...withCatchValues(sudden, [-14, -14]),
      summary: {
        ...withCatchValues(sudden, [-14, -14]).summary,
        baseline: { ...sudden.summary.baseline, meanDeg: -14 },
      },
    };
    const c = catchCallout(biased)!;
    expect(c.compensation).toBeCloseTo(0, 9);
    expect(c.level).toBe('little');
  });

  it('gives no level when there was no rotation to carry over', () => {
    // In the gradual session the catch trials follow full-size rotation; force a 0° neighbour to check the guard.
    const flat: SessionRecord = {
      ...sudden,
      trials: sudden.trials.map((t) => (t.trialNumber === 19 ? { ...t, appliedRotationDeg: 0 } : t)),
    };
    const c = catchCallout(flat)!;
    expect(c.rotationDeg).toBe(0);
    expect(c.compensation).toBeNull();
    expect(c.level).toBeNull();
  });
});

describe('groupAverages', () => {
  it('averages path efficiency and movement time over valid reaches only', () => {
    const finals = finalAttempts(sudden);
    const a = groupAverages(sudden, [1, 2, 3]);
    const expectedEfficiency = (finals[0].metrics.hand!.pathEfficiency + finals[1].metrics.hand!.pathEfficiency + finals[2].metrics.hand!.pathEfficiency) / 3;
    expect(a.pathEfficiency).toBeCloseTo(expectedEfficiency, 12);
    expect(a.pathEfficiency).toBeCloseTo(1, 6); // the scripted reaches are straight
    const expectedTime = (finals[0].metrics.movementDurationMs! + finals[1].metrics.movementDurationMs! + finals[2].metrics.movementDurationMs!) / 3;
    expect(a.movementTimeMs).toBeCloseTo(expectedTime, 9);

    const withGap = groupAverages(withTimeout(sudden, 2), [1, 2, 3]);
    expect(withGap.movementTimeMs).toBeCloseTo((finals[0].metrics.movementDurationMs! + finals[2].metrics.movementDurationMs!) / 2, 9);
  });

  it('is null for an empty group or one with no valid reach', () => {
    expect(groupAverages(sudden, [])).toEqual({ pathEfficiency: null, movementTimeMs: null });
    expect(groupAverages(withTimeout(sudden, 5), [5])).toEqual({ pathEfficiency: null, movementTimeMs: null });
  });
});

describe('formatting helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(372000)).toBe('6 min 12 s');
    expect(formatDuration(59400)).toBe('59 s');
    expect(formatDuration(120000)).toBe('2 min 0 s');
  });

  it('describes signed angles in words', () => {
    expect(describeDirection(-12.34)).toBe('12.3° clockwise');
    expect(describeDirection(7)).toBe('7° counterclockwise');
    expect(describeDirection(0.01)).toBe('0°');
  });

  it('writes a signed angle with its direction in plain words', () => {
    expect(signedWithDirection(-48.52)).toBe('−48.5° (clockwise)');
    expect(signedWithDirection(12)).toBe('+12° (counterclockwise)');
    expect(signedWithDirection(0.02)).toBe('0°');
    expect(signedWithDirection(-0.04)).toBe('0°');
  });
});

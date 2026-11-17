/**
 * analysis.ts — metrics computed from recorded reaches. DOM-free and pure.
 *
 * Everything is expressed relative to the straight line from the start
 * position to the target ("the target axis"):
 *
 *   u = unit vector toward the target        r = position − start
 *
 *   progress          = u · r                 distance travelled ALONG the axis
 *   lateral deviation = u_x·r_y − u_y·r_x     signed distance to the SIDE of it
 *   direction error   = atan2(lateral, progress), in degrees
 *
 * SIGN CONVENTION (the same one used for rotations): positive means
 * counterclockwise on screen — the path lies to the left of the target axis
 * when looking from the start toward the target. With a +45° cursor rotation,
 * a hand that fully compensates has a direction error of −45°.
 *
 * WHICH PART OF THE MOVEMENT. Only the OUTWARD REACH is analysed: from the go
 * cue to ARRIVAL, the interpolated point where the hand first reached the
 * arrival radius (`presets.arrivalRadius`: the near edge of the target when a
 * target hold is required, the target distance itself otherwise). What comes
 * after arrival — steering onto the target and holding there — is recorded but
 * never enters a metric, so path length, endpoint error and movement time do
 * not depend on how long someone took to settle.
 *
 * NULLS, NOT GUESSES. A reach that never arrived (timed out short of the
 * arrival radius), was interrupted, or has too few samples gets
 * `valid: false`, a `nullReason`, and null metrics. A reach that DID arrive is
 * analysed even if its hold never registered before the time limit: its
 * outward movement is complete and perfectly measurable.
 *
 * Key exports: `computeTrialMetrics`, `outwardPath`, `settlePath`, `alignPath`,
 * `groupTrials`, `catchNeighbours`, `summarizeSession`, and their types.
 */

import type { CrossingPoint, ReachOutcome, ReachSamples } from './engine';
import { cross, dot, lerp, norm, segmentCircleCrossing, signedAngleDeg, sub, unitFromAngleDeg, type Vec2 } from './geometry';
import type { MovementCriteria, PhaseName, TaskGeometry } from './presets';

/**
 * Why a trial has no metrics.
 * 'timeout' here means the time limit came before the hand ARRIVED. (A reach
 * that arrived but whose hold never registered is analysed normally.)
 */
export type MetricsNullReason = 'timeout' | 'interrupted' | 'too-few-samples';

/** Metrics of one path (the hand's, or the displayed cursor's). Lengths are in workspace units. */
export interface PathMetrics {
  /**
   * Direction of the path, relative to the target direction, measured at the
   * point where it first reaches `criteria.initialDirectionFraction` (25%) of
   * the target distance. Reflects the planned movement before most visual
   * corrections can act. Degrees, + = counterclockwise.
   */
  initialDirectionErrorDeg: number;
  /** Direction error at arrival, the point where the path first reached the arrival radius. Degrees, + = counterclockwise. */
  endpointDirectionErrorDeg: number;
  /** Largest distance of the path from the target axis. */
  maxAbsLateralDeviation: number;
  /** The signed lateral deviation at that point (its sign tells which side). */
  signedLateralDeviationAtMax: number;
  /** Mean distance of the path from the target axis, averaged along the path's length. */
  meanAbsLateralDeviation: number;
  /** Length of the path from the start to the crossing. */
  pathLength: number;
  /** Straight-line distance from start to crossing divided by path length; 1 = perfectly straight. */
  pathEfficiency: number;
}

export interface TrialMetrics {
  /** True when the hand arrived and metrics could be computed. */
  valid: boolean;
  nullReason: MetricsNullReason | null;
  /**
   * Number of recorded samples in the outward reach: the go-cue sample through
   * the first sample at or beyond the arrival radius. (All recorded samples
   * when the hand never arrived.)
   */
  reachSampleCount: number;
  /** Go cue → movement onset (ms). */
  reactionTimeMs: number | null;
  /** Movement onset → arrival (ms). Does not include settling or the hold. */
  movementDurationMs: number | null;
  hand: PathMetrics | null;
  /** Null when the cursor was hidden during the reach. */
  cursor: PathMetrics | null;
}

/** A polyline with a timestamp per point. */
export interface Path {
  x: number[];
  y: number[];
  tMs: number[];
}

/** A path expressed in target-aligned coordinates. */
export interface AlignedPath {
  /** Distance along the target axis (wu); the target is at `targetDistance`. */
  progress: number[];
  /** Signed distance from the target axis (wu), + = counterclockwise side. */
  lateral: number[];
  tMs: number[];
}

/** The parts of a recorded attempt that path analysis needs. */
export interface ReachData {
  outcome: ReachOutcome;
  crossing: CrossingPoint | null;
  reach: ReachSamples;
}

/**
 * Index of the first reach sample at or beyond the arrival radius, or null if
 * the hand never arrived. Files written before schema 2 have no `sampleIndex`;
 * there the reach ended at the crossing, so it is the last sample.
 */
function arrivalIndex(data: ReachData): number | null {
  const n = data.reach.tMs.length;
  if (!data.crossing || data.outcome === 'interrupted' || n < 2) return null;
  const index = (data.crossing as Partial<CrossingPoint>).sampleIndex ?? n - 1;
  return Math.min(n - 1, Math.max(1, index));
}

/**
 * The OUTWARD path of the hand or the displayed cursor: go cue → arrival.
 *
 * When the hand arrived, the first sample at or beyond the arrival radius is
 * replaced by the interpolated arrival point, so the path ends exactly on the
 * arrival radius; everything after it (settling and holding) is left out.
 * When the hand never arrived, or the reach was interrupted, the recorded
 * samples are returned as they are (for display only).
 * Returns null for the cursor when it was hidden.
 */
export function outwardPath(data: ReachData, which: 'hand' | 'cursor'): Path | null {
  const { reach, crossing } = data;
  const xs = which === 'hand' ? reach.handX : reach.cursorX;
  const ys = which === 'hand' ? reach.handY : reach.cursorY;
  if (!xs || !ys) return null;

  const end = arrivalIndex(data);
  if (end !== null && crossing) {
    const endX = which === 'hand' ? crossing.handX : crossing.cursorX;
    const endY = which === 'hand' ? crossing.handY : crossing.cursorY;
    if (endX === null || endY === null) return null;
    return {
      x: [...xs.slice(0, end), endX],
      y: [...ys.slice(0, end), endY],
      tMs: [...reach.tMs.slice(0, end), crossing.tMs],
    };
  }
  return { x: xs.slice(), y: ys.slice(), tMs: reach.tMs.slice() };
}

/**
 * What happened AFTER arrival: steering onto the target and holding there (or
 * running out of time). Starts at the arrival point, so it joins the end of
 * `outwardPath`. For display only; no metric uses it. Null when the hand never
 * arrived, when nothing was recorded after arrival, or for a hidden cursor.
 */
export function settlePath(data: ReachData, which: 'hand' | 'cursor'): Path | null {
  const { reach, crossing } = data;
  const xs = which === 'hand' ? reach.handX : reach.cursorX;
  const ys = which === 'hand' ? reach.handY : reach.cursorY;
  const start = arrivalIndex(data);
  if (!xs || !ys || start === null || !crossing) return null;
  const startX = which === 'hand' ? crossing.handX : crossing.cursorX;
  const startY = which === 'hand' ? crossing.handY : crossing.cursorY;
  if (startX === null || startY === null) return null;
  return {
    x: [startX, ...xs.slice(start)],
    y: [startY, ...ys.slice(start)],
    tMs: [crossing.tMs, ...reach.tMs.slice(start)],
  };
}

/** Rotate a path into target-aligned coordinates (progress along the axis, signed lateral deviation). */
export function alignPath(path: Path, targetAngleDeg: number): AlignedPath {
  const u = unitFromAngleDeg(targetAngleDeg);
  const progress: number[] = [];
  const lateral: number[] = [];
  for (let i = 0; i < path.x.length; i++) {
    const r = { x: path.x[i], y: path.y[i] };
    // `+ 0` turns a negative zero (e.g. −1 × 0 at the start point) into plain 0.
    progress.push(dot(u, r) + 0);
    lateral.push(cross(u, r) + 0);
  }
  return { progress, lateral, tMs: path.tMs.slice() };
}

/**
 * Metrics of one outward path that starts at the origin. Returns null if the
 * path never reaches the early-movement radius (it cannot be characterised).
 */
export function computePathMetrics(
  path: Path,
  targetAngleDeg: number,
  geometry: TaskGeometry,
  criteria: MovementCriteria,
): PathMetrics | null {
  const n = path.x.length;
  if (n < 2) return null;
  const u = unitFromAngleDeg(targetAngleDeg);
  const points: Vec2[] = path.x.map((x, i) => ({ x, y: path.y[i] }));

  // Initial direction: where the path FIRST reaches 25% of the target distance,
  // interpolated between samples so it does not depend on the sampling rate.
  const earlyRadius = criteria.initialDirectionFraction * geometry.targetDistance;
  let earlyPoint: Vec2 | null = null;
  for (let i = 1; i < n; i++) {
    const f = segmentCircleCrossing(points[i - 1], points[i], earlyRadius);
    if (f !== null) {
      earlyPoint = lerp(points[i - 1], points[i], f);
      break;
    }
  }
  if (!earlyPoint) return null;
  const initial = signedAngleDeg(u, earlyPoint);
  const end = points[n - 1];
  const endpoint = signedAngleDeg(u, end);
  if (initial === null || endpoint === null) return null;

  // Lateral deviation is linear along each straight segment, so its extreme
  // values occur at sample points.
  let maxAbs = 0;
  let signedAtMax = 0;
  const lateral = points.map((p) => cross(u, p));
  for (const value of lateral) {
    if (Math.abs(value) > maxAbs) {
      maxAbs = Math.abs(value);
      signedAtMax = value;
    }
  }

  // Path length, and |lateral| averaged along it (trapezoid rule per segment).
  let pathLength = 0;
  let weighted = 0;
  for (let i = 1; i < n; i++) {
    const segment = norm(sub(points[i], points[i - 1]));
    pathLength += segment;
    weighted += (segment * (Math.abs(lateral[i - 1]) + Math.abs(lateral[i]))) / 2;
  }
  if (pathLength <= 0) return null;

  return {
    initialDirectionErrorDeg: initial,
    endpointDirectionErrorDeg: endpoint,
    maxAbsLateralDeviation: maxAbs,
    signedLateralDeviationAtMax: signedAtMax,
    meanAbsLateralDeviation: weighted / pathLength,
    pathLength,
    pathEfficiency: norm(end) / pathLength,
  };
}

export interface MetricsInput extends ReachData {
  targetAngleDeg: number;
  cursorVisibleDuringReach: boolean;
  times: { goCueMs: number | null; movementOnsetMs: number | null; completionMs: number | null };
}

/** All metrics for one attempt, or nulls with the reason when the attempt cannot be analysed. */
export function computeTrialMetrics(
  attempt: MetricsInput,
  geometry: TaskGeometry,
  criteria: MovementCriteria,
): TrialMetrics {
  // Samples that make up the outward reach: up to and including the first one
  // at or beyond the arrival radius. Settling and holding are not counted.
  const arrivedAt = arrivalIndex(attempt);
  const reachSampleCount = arrivedAt !== null ? arrivedAt + 1 : attempt.reach.tMs.length;
  const invalid = (nullReason: MetricsNullReason): TrialMetrics => ({
    valid: false,
    nullReason,
    reachSampleCount,
    reactionTimeMs: null,
    movementDurationMs: null,
    hand: null,
    cursor: null,
  });

  // An interrupted reach is repeated; its partial movement is never analysed.
  if (attempt.outcome === 'interrupted') return invalid('interrupted');
  // A reach that never arrived has no defined endpoint; describing its shape
  // with the same numbers as a finished reach would mislead. (A reach that
  // arrived and then ran out of time while settling IS analysed: see the header.)
  if (arrivedAt === null) return invalid(attempt.outcome === 'timeout' ? 'timeout' : 'too-few-samples');
  // Too few samples to describe a trajectory (e.g. one enormous mouse jump).
  if (reachSampleCount < criteria.minReachSamples) return invalid('too-few-samples');

  const handPath = outwardPath(attempt, 'hand');
  const hand = handPath ? computePathMetrics(handPath, attempt.targetAngleDeg, geometry, criteria) : null;
  if (!hand) return invalid('too-few-samples');

  let cursor: PathMetrics | null = null;
  if (attempt.cursorVisibleDuringReach) {
    const cursorPath = outwardPath(attempt, 'cursor');
    cursor = cursorPath ? computePathMetrics(cursorPath, attempt.targetAngleDeg, geometry, criteria) : null;
  }

  const { goCueMs, movementOnsetMs, completionMs } = attempt.times;
  return {
    valid: true,
    nullReason: null,
    reachSampleCount,
    reactionTimeMs: goCueMs !== null && movementOnsetMs !== null ? movementOnsetMs - goCueMs : null,
    movementDurationMs: movementOnsetMs !== null && completionMs !== null ? completionMs - movementOnsetMs : null,
    hand,
    cursor,
  };
}

// ---------------------------------------------------------------------------
// Grouping trials for summaries and plots
// ---------------------------------------------------------------------------

/** The scheduling facts needed to group trials. `TrialSpec` satisfies this. */
export interface TrialLabel {
  trialNumber: number;
  phase: PhaseName;
  isCatch: boolean;
}

export interface TrialGroups {
  /** Trial numbers (1-based), in session order. */
  baseline: number[];
  /** Every non-catch adaptation reach. */
  perturbed: number[];
  /** The first few and last few perturbed reaches. */
  earlyPerturbed: number[];
  latePerturbed: number[];
  catches: number[];
  aftereffect: number[];
  firstAftereffect: number | null;
}

/** How many reaches make up the "early" and "late" perturbation windows. */
export const EARLY_LATE_WINDOW = 4;

export function groupTrials(schedule: readonly TrialLabel[], windowSize = EARLY_LATE_WINDOW): TrialGroups {
  const numbers = (keep: (t: TrialLabel) => boolean) => schedule.filter(keep).map((t) => t.trialNumber);
  const perturbed = numbers((t) => t.phase === 'adaptation' && !t.isCatch);
  // Never let the early and late windows overlap in very short protocols.
  const size = Math.min(windowSize, Math.floor(perturbed.length / 2));
  const aftereffect = numbers((t) => t.phase === 'aftereffect');
  return {
    baseline: numbers((t) => t.phase === 'baseline'),
    perturbed,
    earlyPerturbed: perturbed.slice(0, size),
    latePerturbed: size > 0 ? perturbed.slice(-size) : [],
    catches: numbers((t) => t.isCatch),
    aftereffect,
    firstAftereffect: aftereffect.length > 0 ? aftereffect[0] : null,
  };
}

/** The nearest perturbed (non-catch adaptation) trials before and after a catch trial. */
export function catchNeighbours(
  schedule: readonly TrialLabel[],
  catchTrialNumber: number,
): { before: number | null; after: number | null } {
  const perturbed = schedule.filter((t) => t.phase === 'adaptation' && !t.isCatch).map((t) => t.trialNumber);
  const before = perturbed.filter((n) => n < catchTrialNumber);
  const after = perturbed.filter((n) => n > catchTrialNumber);
  return {
    before: before.length > 0 ? before[before.length - 1] : null,
    after: after.length > 0 ? after[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Per-participant descriptive summary
// ---------------------------------------------------------------------------

/** One trial's contribution to the summary: its label, applied rotation and metrics. */
export interface SummaryTrial extends TrialLabel {
  appliedRotationDeg: number;
  metrics: TrialMetrics;
}

export interface GroupMean {
  /** Trials in the group. */
  trialNumbers: number[];
  /** How many of them had valid metrics. */
  n: number;
  /** Mean initial hand direction error over the valid trials (deg); null if none. */
  meanDeg: number | null;
  /** Mean rotation applied over the group's trials (deg). */
  meanRotationDeg: number | null;
}

export interface CatchSummary {
  trialNumber: number;
  /** Initial hand direction error on the catch trial (deg); null if invalid. */
  valueDeg: number | null;
  /** Nearest perturbed trials, for side-by-side comparison. */
  neighbourBefore: number | null;
  neighbourAfter: number | null;
}

/**
 * Descriptive statistics of ONE participant's initial hand direction error.
 * These describe what this person did; they are not inferential statistics.
 */
export interface SessionSummary {
  metric: 'hand.initialDirectionErrorDeg';
  trialsScheduled: number;
  trialsValid: number;
  trialsTimedOut: number;
  trialsDegenerate: number;
  baseline: GroupMean;
  earlyPerturbed: GroupMean;
  latePerturbed: GroupMean;
  catchTrials: CatchSummary[];
  firstAftereffect: { trialNumber: number | null; valueDeg: number | null };
  aftereffect: GroupMean;
}

const mean = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Summarise the final attempt of every scheduled trial.
 * @param trials one entry per scheduled trial (the attempt that counted), in session order
 */
export function summarizeSession(trials: readonly SummaryTrial[]): SessionSummary {
  const groups = groupTrials(trials);
  const byNumber = new Map(trials.map((t) => [t.trialNumber, t]));
  const value = (trialNumber: number): number | null => {
    const t = byNumber.get(trialNumber);
    return t && t.metrics.valid && t.metrics.hand ? t.metrics.hand.initialDirectionErrorDeg : null;
  };
  const groupMean = (trialNumbers: number[]): GroupMean => {
    const values = trialNumbers.map(value).filter((v): v is number => v !== null);
    return {
      trialNumbers,
      n: values.length,
      meanDeg: mean(values),
      meanRotationDeg: mean(trialNumbers.map((n) => byNumber.get(n)!.appliedRotationDeg)),
    };
  };

  return {
    metric: 'hand.initialDirectionErrorDeg',
    trialsScheduled: trials.length,
    trialsValid: trials.filter((t) => t.metrics.valid).length,
    trialsTimedOut: trials.filter((t) => t.metrics.nullReason === 'timeout').length,
    trialsDegenerate: trials.filter((t) => t.metrics.nullReason === 'too-few-samples').length,
    baseline: groupMean(groups.baseline),
    earlyPerturbed: groupMean(groups.earlyPerturbed),
    latePerturbed: groupMean(groups.latePerturbed),
    catchTrials: groups.catches.map((trialNumber) => {
      const { before, after } = catchNeighbours(trials, trialNumber);
      return { trialNumber, valueDeg: value(trialNumber), neighbourBefore: before, neighbourAfter: after };
    }),
    firstAftereffect: {
      trialNumber: groups.firstAftereffect,
      valueDeg: groups.firstAftereffect !== null ? value(groups.firstAftereffect) : null,
    },
    aftereffect: groupMean(groups.aftereffect),
  };
}

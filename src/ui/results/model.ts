/**
 * results/model.ts — turns a SessionRecord into exactly the numbers each
 * results chart draws. Pure and DOM-free, so "the graphs faithfully represent
 * the recorded movement" can be checked by unit tests (model.test.ts) rather
 * than by eye.
 *
 * Every function here uses only the FINAL attempt of each trial, and reads the
 * same metrics that are written to the downloadable files.
 *
 * Key exports: `phaseBands`, `trialPoints`, `seenPathError`, `pathPanels`,
 * `catchComparisons`, `catchCallout`, `groupAverages`, `normalizedPath`,
 * `resampleByProgress`, and their types.
 */

import { alignPath, catchNeighbours, groupTrials, outwardPath } from '../../core/analysis';
import type { PhaseName } from '../../core/presets';
import { finalAttempts, reachDataOf, seenPathErrorPct, type SessionRecord, type TrialExport } from '../../core/record';
import { formatSignedDeg } from '../presetText';

/** Which path a chart shows: the hand (mouse) or the cursor as it was displayed. */
export type PathKind = 'hand' | 'cursor';

// ---------------------------------------------------------------------------
// Phase bands (the shaded, labelled blocks behind the per-trial charts)
// ---------------------------------------------------------------------------

export interface PhaseBand {
  phase: PhaseName;
  label: string;
  /** What the cursor did during reaches in this block. */
  note: string;
  firstTrial: number;
  lastTrial: number;
}

const PHASE_LABELS: Record<PhaseName, string> = {
  baseline: 'Baseline',
  adaptation: 'Rotation block',
  aftereffect: 'Aftereffect block',
};

export function phaseBands(session: SessionRecord): PhaseBand[] {
  const bands: PhaseBand[] = [];
  for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
    const trials = session.schedule.filter((t) => t.phase === phase);
    if (trials.length === 0) continue;
    bands.push({
      phase,
      label: PHASE_LABELS[phase],
      note: session.preset.structure[phase].feedback === 'hidden' ? 'cursor hidden' : 'cursor visible',
      firstTrial: trials[0].trialNumber,
      lastTrial: trials[trials.length - 1].trialNumber,
    });
  }
  return bands;
}

// ---------------------------------------------------------------------------
// One point per trial (rotation timeline and direction-error chart)
// ---------------------------------------------------------------------------

export interface TrialPoint {
  trialNumber: number;
  phase: PhaseName;
  isCatch: boolean;
  /** Rotation actually applied on the trial (deg, + = counterclockwise). */
  rotationDeg: number;
  targetAngleDeg: number;
  cursorShown: boolean;
  valid: boolean;
  invalidReason: string | null;
  handInitialDeg: number | null;
  handEndpointDeg: number | null;
  cursorInitialDeg: number | null;
  cursorEndpointDeg: number | null;
  /**
   * The hand direction error that would have sent the cursor straight at the
   * target on this trial: the opposite of the applied rotation.
   */
  compensationDeg: number;
  /** Whole-path error of the path the participant saw, in % of the target distance (see `seenPathError`). */
  pathErrorPct: number | null;
}

/** The whole-path error of the path the participant saw (% of the target distance); see core/record.ts. */
export const seenPathError = seenPathErrorPct;

export function trialPoints(session: SessionRecord): TrialPoint[] {
  const D = session.preset.geometry.targetDistance;
  return finalAttempts(session).map((t) => ({
    trialNumber: t.trialNumber,
    phase: t.phase,
    isCatch: t.isCatch,
    rotationDeg: t.appliedRotationDeg,
    targetAngleDeg: t.targetAngleDeg,
    cursorShown: t.cursorVisibleDuringReach,
    valid: t.valid,
    invalidReason: t.invalidReason,
    handInitialDeg: t.metrics.hand?.initialDirectionErrorDeg ?? null,
    handEndpointDeg: t.metrics.hand?.endpointDirectionErrorDeg ?? null,
    cursorInitialDeg: t.metrics.cursor?.initialDirectionErrorDeg ?? null,
    cursorEndpointDeg: t.metrics.cursor?.endpointDirectionErrorDeg ?? null,
    // `0 - x` rather than `-x` so a zero rotation gives 0, not −0.
    compensationDeg: 0 - t.appliedRotationDeg,
    pathErrorPct: seenPathError(t, D),
  }));
}

/** The initial direction error a chart should plot for the chosen path (null = nothing to plot). */
export function initialErrorFor(point: TrialPoint, kind: PathKind): number | null {
  return kind === 'hand' ? point.handInitialDeg : point.cursorInitialDeg;
}

// ---------------------------------------------------------------------------
// Target-aligned paths
// ---------------------------------------------------------------------------

/** A point of a target-aligned path, in FRACTIONS of the target distance. */
export interface NormPoint {
  /** Along the start→target axis: 0 at the start, 1 at the target distance. */
  progress: number;
  /** To the side of that axis: + = counterclockwise (left when facing the target). */
  lateral: number;
}

/**
 * The outward path of a trial, rotated so its target lies along the axis and
 * scaled by the target distance. Null when that path does not exist (cursor
 * hidden) or the reach did not complete.
 */
export function normalizedPath(trial: TrialExport, kind: PathKind, targetDistance: number): NormPoint[] | null {
  if (!trial.valid) return null;
  const path = outwardPath(reachDataOf(trial), kind);
  if (!path) return null;
  const aligned = alignPath(path, trial.targetAngleDeg);
  return aligned.progress.map((p, i) => ({
    progress: p / targetDistance,
    lateral: aligned.lateral[i] / targetDistance,
  }));
}

/** Why `normalizedPath` returned null, in words. */
export function unavailableReason(trial: TrialExport, kind: PathKind): string {
  if (!trial.valid) {
    // An invalid timeout is one where the hand never arrived. (A reach that
    // arrived and then ran out of time is valid and is drawn like any other.)
    if (trial.outcome === 'timeout') return 'timed out';
    if (trial.outcome === 'interrupted') return 'interrupted';
    return 'too few samples';
  }
  if (kind === 'cursor' && !trial.cursorVisibleDuringReach) return 'cursor was hidden';
  return 'not available';
}

/**
 * Lateral deviation at fixed progress levels, by linear interpolation at the
 * FIRST point where the path reaches each level. Null where the path never
 * gets that far along the target axis (a badly misdirected reach ends early).
 * Lets several reaches share one x axis.
 */
export function resampleByProgress(points: readonly NormPoint[], levels: readonly number[]): Array<number | null> {
  return levels.map((level) => {
    if (points.length === 0) return null;
    if (points[0].progress >= level) return points[0].lateral;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.progress < level && b.progress >= level) {
        const f = (level - a.progress) / (b.progress - a.progress);
        return a.lateral + f * (b.lateral - a.lateral);
      }
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Movement overlay panels
// ---------------------------------------------------------------------------

/** primary = the reaches the panel is about; catch = a catch trial; context = shown in gray for comparison. */
export type PathRole = 'primary' | 'catch' | 'context';

export interface PanelPath {
  trialNumber: number;
  role: PathRole;
  points: NormPoint[];
  /** Short description used in tooltips. */
  description: string;
  /** Initial direction error of the drawn path (deg, + = counterclockwise). */
  initialErrorDeg: number | null;
}

export interface PathPanel {
  key: string;
  title: string;
  caption: string;
  paths: PanelPath[];
  /** Trials that belong in the panel but could not be drawn, and why. */
  unavailable: Array<{ trialNumber: number; reason: string }>;
}

const trialRange = (numbers: number[]): string =>
  numbers.length === 0
    ? 'none'
    : numbers.length === 1
      ? `Trial ${numbers[0]}`
      : numbers[numbers.length - 1] - numbers[0] === numbers.length - 1
        ? `Trials ${numbers[0]}–${numbers[numbers.length - 1]}`
        : `Trials ${numbers.join(', ')}`;

function rotationRange(trials: TrialExport[]): string {
  if (trials.length === 0) return '';
  const angles = trials.map((t) => t.appliedRotationDeg);
  const min = Math.min(...angles);
  const max = Math.max(...angles);
  if (min === max) return min === 0 ? 'no rotation' : `rotation ${formatSignedDeg(min)}`;
  return `rotation ${formatSignedDeg(min)} to ${formatSignedDeg(max)}`;
}

function describeTrial(t: TrialExport): string {
  const kind = t.isCatch ? 'catch trial, rotation off' : t.appliedRotationDeg === 0 ? 'no rotation' : `rotation ${formatSignedDeg(t.appliedRotationDeg)}`;
  return `Trial ${t.trialNumber} · ${kind} · target at ${t.targetAngleDeg}°`;
}

/**
 * The small-multiple overlay panels: baseline, early and late rotated reaches,
 * each catch trial beside its neighbours, and the first aftereffect reach
 * against the baseline reaches.
 */
export function pathPanels(session: SessionRecord, kind: PathKind): PathPanel[] {
  const D = session.preset.geometry.targetDistance;
  const finals = finalAttempts(session);
  const byNumber = new Map(finals.map((t) => [t.trialNumber, t]));
  const groups = groupTrials(session.schedule);

  const build = (
    key: string,
    title: string,
    caption: string,
    members: Array<{ trialNumber: number; role: PathRole }>,
  ): PathPanel => {
    const panel: PathPanel = { key, title, caption, paths: [], unavailable: [] };
    for (const { trialNumber, role } of members) {
      const trial = byNumber.get(trialNumber);
      if (!trial) continue;
      const points = normalizedPath(trial, kind, D);
      if (points) {
        panel.paths.push({
          trialNumber,
          role,
          points,
          description: describeTrial(trial),
          initialErrorDeg: trial.metrics[kind]?.initialDirectionErrorDeg ?? null,
        });
      } else {
        panel.unavailable.push({ trialNumber, reason: unavailableReason(trial, kind) });
      }
    }
    return panel;
  };

  const trialsOf = (numbers: number[]) => numbers.map((n) => byNumber.get(n)).filter((t): t is TrialExport => !!t);
  const primary = (numbers: number[]) => numbers.map((trialNumber) => ({ trialNumber, role: 'primary' as const }));
  const context = (numbers: number[]) => numbers.map((trialNumber) => ({ trialNumber, role: 'context' as const }));

  const panels: PathPanel[] = [
    build('baseline', 'Baseline', `${trialRange(groups.baseline)} · no rotation`, primary(groups.baseline)),
    build(
      'early',
      'First rotated reaches',
      `${trialRange(groups.earlyPerturbed)} · ${rotationRange(trialsOf(groups.earlyPerturbed))}`,
      primary(groups.earlyPerturbed),
    ),
    build(
      'late',
      'Last rotated reaches',
      `${trialRange(groups.latePerturbed)} · ${rotationRange(trialsOf(groups.latePerturbed))}`,
      primary(groups.latePerturbed),
    ),
  ];

  groups.catches.forEach((catchTrial, i) => {
    const { before, after } = catchNeighbours(session.schedule, catchTrial);
    const neighbours = [before, after].filter((n): n is number => n !== null);
    panels.push(
      build(
        `catch-${catchTrial}`,
        groups.catches.length > 1 ? `Catch trial ${i + 1}` : 'Catch trial',
        `Trial ${catchTrial} (rotation off), with rotated trials ${neighbours.join(' and ')} in gray`,
        [...context(neighbours), { trialNumber: catchTrial, role: 'catch' }],
      ),
    );
  });

  if (groups.firstAftereffect !== null) {
    panels.push(
      build(
        'aftereffect',
        'First aftereffect reach',
        `Trial ${groups.firstAftereffect} · no rotation, with the baseline reaches in gray`,
        [...context(groups.baseline), { trialNumber: groups.firstAftereffect, role: 'primary' }],
      ),
    );
  }
  return panels;
}

// ---------------------------------------------------------------------------
// Catch trial vs neighbours: lateral deviation against progress
// ---------------------------------------------------------------------------

export interface ProgressSeries {
  trialNumber: number;
  role: 'catch' | 'before' | 'after';
  /** Column name of this series in `rows`. */
  dataKey: string;
  targetAngleDeg: number;
  rotationDeg: number;
  /** False when the path could not be drawn; `reason` then says why. */
  available: boolean;
  reason: string | null;
}

export interface CatchComparison {
  catchTrialNumber: number;
  series: ProgressSeries[];
  /**
   * One row per progress level (0–100% of the target distance). Each series has
   * a column holding its signed lateral deviation in % of the target distance,
   * or null where the reach did not get that far along the target axis.
   */
  rows: Array<Record<string, number | null>>;
  /** True when every compared reach went to the same target direction. */
  sameTarget: boolean;
}

/** Progress levels, in %, at which lateral deviation is sampled. */
export const PROGRESS_LEVELS_PCT: readonly number[] = Array.from({ length: 51 }, (_, i) => i * 2);

export function catchComparisons(session: SessionRecord, kind: PathKind): CatchComparison[] {
  const D = session.preset.geometry.targetDistance;
  const byNumber = new Map(finalAttempts(session).map((t) => [t.trialNumber, t]));
  const levels = PROGRESS_LEVELS_PCT.map((p) => p / 100);

  return groupTrials(session.schedule).catches.map((catchTrialNumber) => {
    const { before, after } = catchNeighbours(session.schedule, catchTrialNumber);
    const members: Array<{ trialNumber: number | null; role: ProgressSeries['role'] }> = [
      { trialNumber: before, role: 'before' },
      { trialNumber: catchTrialNumber, role: 'catch' },
      { trialNumber: after, role: 'after' },
    ];

    const series: ProgressSeries[] = [];
    const columns = new Map<string, Array<number | null>>();
    for (const { trialNumber, role } of members) {
      const trial = trialNumber !== null ? byNumber.get(trialNumber) : undefined;
      if (!trial) continue;
      const dataKey = `t${trial.trialNumber}`;
      const points = normalizedPath(trial, kind, D);
      series.push({
        trialNumber: trial.trialNumber,
        role,
        dataKey,
        targetAngleDeg: trial.targetAngleDeg,
        rotationDeg: trial.appliedRotationDeg,
        available: points !== null,
        reason: points === null ? unavailableReason(trial, kind) : null,
      });
      if (points) columns.set(dataKey, resampleByProgress(points, levels).map((v) => (v === null ? null : v * 100)));
    }

    const rows = PROGRESS_LEVELS_PCT.map((progressPct, i) => {
      const row: Record<string, number | null> = { progressPct };
      for (const [key, values] of columns) row[key] = values[i];
      return row;
    });

    return {
      catchTrialNumber,
      series,
      rows,
      sameTarget: new Set(series.map((s) => s.targetAngleDeg)).size <= 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Catch-trial callout (the headline finding at the top of the page)
// ---------------------------------------------------------------------------

/**
 * How far the catch-trial reach went toward cancelling a rotation that was no
 * longer there:
 *   full      about the whole rotation
 *   partial   clearly part of it
 *   little    close to the participant's ordinary aim
 *   opposite  shifted the other way
 */
export type CatchLevel = 'full' | 'partial' | 'little' | 'opposite';

/** Boundaries between the levels, as a fraction of the rotation being cancelled. */
export const CATCH_FULL_FROM = 0.75;
export const CATCH_PARTIAL_FROM = 0.25;

export interface CatchCalloutModel {
  /** The catch trial the callout reports: the first one with a usable value. */
  trialNumber: number;
  /** Initial hand direction error on that trial (deg, + = counterclockwise). */
  valueDeg: number;
  /** Earlier catch trials that had no usable value and were passed over. */
  skippedTrialNumbers: number[];
  /** Rotation on the rotated reach just before the catch trial: what the hand had been cancelling. Null if none. */
  rotationDeg: number | null;
  /** The participant's mean baseline direction, when at least two baseline reaches were valid. */
  baselineMeanDeg: number | null;
  /**
   * The shift from the participant's own baseline aim, as a fraction of what
   * would cancel the rotation exactly (1 = all of it, 0 = none, negative = the
   * other way). Null when there was no rotation to compare with.
   */
  compensation: number | null;
  level: CatchLevel | null;
}

/**
 * The data behind the catch-trial callout, or null when the session has no
 * catch trial with a usable value (none scheduled, or all invalid).
 *
 * The value shown is the raw initial direction on the catch trial. The LEVEL
 * is judged against the participant's own baseline aim rather than against 0°,
 * so that a habitual bias is not mistaken for carried-over compensation.
 */
export function catchCallout(session: SessionRecord): CatchCalloutModel | null {
  const { summary } = session;
  const index = summary.catchTrials.findIndex((c) => c.valueDeg !== null);
  if (index < 0) return null;
  const chosen = summary.catchTrials[index];
  const valueDeg = chosen.valueDeg as number;

  const byNumber = new Map(finalAttempts(session).map((t) => [t.trialNumber, t]));
  const before = chosen.neighbourBefore !== null ? byNumber.get(chosen.neighbourBefore) : undefined;
  const rotationDeg = before ? before.appliedRotationDeg : null;
  const baselineMeanDeg = summary.baseline.n >= 2 ? summary.baseline.meanDeg : null;

  let compensation: number | null = null;
  let level: CatchLevel | null = null;
  if (rotationDeg !== null && rotationDeg !== 0) {
    // Cancelling a rotation of θ exactly means shifting the hand by −θ.
    compensation = -(valueDeg - (baselineMeanDeg ?? 0)) / rotationDeg;
    level =
      compensation >= CATCH_FULL_FROM
        ? 'full'
        : compensation >= CATCH_PARTIAL_FROM
          ? 'partial'
          : compensation > -CATCH_PARTIAL_FROM
            ? 'little'
            : 'opposite';
  }

  return {
    trialNumber: chosen.trialNumber,
    valueDeg,
    skippedTrialNumbers: summary.catchTrials.slice(0, index).map((c) => c.trialNumber),
    rotationDeg,
    baselineMeanDeg,
    compensation,
    level,
  };
}

// ---------------------------------------------------------------------------
// Path efficiency and movement time, averaged over a group of trials
// ---------------------------------------------------------------------------

export interface GroupAverages {
  /** Mean hand path efficiency over the group's valid reaches (1 = straight); null if none. */
  pathEfficiency: number | null;
  /** Mean movement time, onset → arrival, over the group's valid reaches (ms); null if none. */
  movementTimeMs: number | null;
  /** Mean whole-path error of the seen path (% of the target distance, see `seenPathError`); null if none. */
  pathErrorPct: number | null;
}

/** Means of the two secondary metrics over the given trials (final attempts with valid metrics only). */
export function groupAverages(session: SessionRecord, trialNumbers: readonly number[]): GroupAverages {
  const wanted = new Set(trialNumbers);
  const trials = finalAttempts(session).filter((t) => wanted.has(t.trialNumber) && t.valid);
  const mean = (values: Array<number | null | undefined>): number | null => {
    const kept = values.filter((v): v is number => typeof v === 'number');
    return kept.length > 0 ? kept.reduce((a, b) => a + b, 0) / kept.length : null;
  };
  return {
    pathEfficiency: mean(trials.map((t) => t.metrics.hand?.pathEfficiency)),
    movementTimeMs: mean(trials.map((t) => t.metrics.movementDurationMs)),
    pathErrorPct: mean(trials.map((t) => seenPathError(t, session.preset.geometry.targetDistance))),
  };
}

// ---------------------------------------------------------------------------
// Aiming versus steering
// ---------------------------------------------------------------------------

export interface AimAndArrival {
  /** Valid reaches averaged. */
  n: number;
  /** Mean initial hand direction (deg): where the hand set off. */
  initialDeg: number;
  /** Mean hand direction on arrival (deg): where it had got to by the target's distance. */
  arrivalDeg: number;
  /** Mean rotation on those reaches (deg); −rotation would cancel it exactly. */
  rotationDeg: number;
}

/**
 * Where the hand set off versus where it arrived, averaged over the given
 * reaches (valid final attempts only). The difference is correction made
 * during the reach. Null when none of the reaches has both values.
 */
export function aimAndArrival(session: SessionRecord, trialNumbers: readonly number[]): AimAndArrival | null {
  const wanted = new Set(trialNumbers);
  const trials = finalAttempts(session).filter((t) => wanted.has(t.trialNumber) && t.valid && t.metrics.hand);
  if (trials.length === 0) return null;
  const mean = (pick: (t: TrialExport) => number) => trials.reduce((a, t) => a + pick(t), 0) / trials.length;
  return {
    n: trials.length,
    initialDeg: mean((t) => t.metrics.hand!.initialDirectionErrorDeg),
    arrivalDeg: mean((t) => t.metrics.hand!.endpointDirectionErrorDeg),
    rotationDeg: mean((t) => t.appliedRotationDeg),
  };
}

// ---------------------------------------------------------------------------
// Small formatting helpers shared by the results components
// ---------------------------------------------------------------------------

/** 372000 → "6 min 12 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds} s`;
}

/** −12.34 → "12.3° clockwise"; 0 → "0°". */
export function describeDirection(deg: number, digits = 1): string {
  const rounded = Number(Math.abs(deg).toFixed(digits));
  if (rounded === 0) return '0°';
  return `${rounded}° ${deg < 0 ? 'clockwise' : 'counterclockwise'}`;
}

/** A signed angle with its direction in words: −48.52 → "−48.5° (clockwise)"; 0 → "0°". */
export function signedWithDirection(deg: number, digits = 1): string {
  const rounded = Number(deg.toFixed(digits));
  if (rounded === 0) return '0°';
  return `${formatSignedDeg(deg, digits)} (${rounded < 0 ? 'clockwise' : 'counterclockwise'})`;
}

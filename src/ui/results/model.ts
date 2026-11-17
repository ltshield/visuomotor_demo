/**
 * results/model.ts — turns a SessionRecord into exactly the numbers each
 * results chart draws. Pure and DOM-free, so "the graphs faithfully represent
 * the recorded movement" can be checked by unit tests (model.test.ts) rather
 * than by eye.
 *
 * Every function here uses only the FINAL attempt of each trial, and reads the
 * same metrics that are written to the downloadable files.
 *
 * Key exports: `phaseBands`, `trialPoints`, `pathPanels`, `catchComparisons`,
 * `normalizedPath`, `resampleByProgress`, and their types.
 */

import { alignPath, catchNeighbours, groupTrials, outwardPath } from '../../core/analysis';
import type { PhaseName } from '../../core/presets';
import { finalAttempts, reachDataOf, type SessionRecord, type TrialExport } from '../../core/record';
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
}

export function trialPoints(session: SessionRecord): TrialPoint[] {
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

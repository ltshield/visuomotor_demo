/**
 * export.ts — turns a SessionRecord into downloadable text. Pure (no DOM);
 * `ui/download.ts` does the actual saving.
 *
 * Three files:
 *   - session JSON : everything, including every mouse sample
 *   - trials CSV   : one row per attempt, with all metrics (opens in Excel/R/Python)
 *   - events CSV   : one row per mouse sample, with target-aligned coordinates
 *
 * Missing values are written as `null` in JSON and as empty cells in CSV.
 *
 * Key exports: `sessionToJson`, `trialsToCsv`, `eventsToCsv`,
 * `exportFileNames`, `toPrettyJson`.
 */

import { alignPath, type PathMetrics } from './analysis';
import type { SessionRecord } from './record';

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null;

const isPrimitive = (v: unknown): v is Primitive =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Decimal places kept for numbers inside sample arrays (0.001 wu, 0.001 ms). */
const ARRAY_DECIMALS = 3;

/**
 * JSON with one object key per line but arrays of plain values on a single
 * line. A session holds thousands of samples; the standard pretty-printer
 * would put each number on its own line and produce an unreadable file.
 * Numbers inside such arrays are rounded to `ARRAY_DECIMALS`; all other
 * numbers (angles, metrics, timestamps) keep full precision.
 */
export function toPrettyJson(value: unknown, indent = 2): string {
  const pad = (level: number) => ' '.repeat(level * indent);
  const scalar = (v: Primitive, rounded: boolean): string => {
    if (typeof v !== 'number') return JSON.stringify(v);
    if (!Number.isFinite(v)) return 'null';
    return String(rounded ? Number(v.toFixed(ARRAY_DECIMALS)) : v);
  };

  const write = (v: unknown, level: number): string => {
    if (v === undefined) return 'null';
    if (isPrimitive(v)) return scalar(v, false);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (v.every(isPrimitive)) return `[${v.map((x) => scalar(x, true)).join(',')}]`;
      const items = v.map((x) => pad(level + 1) + write(x, level + 1));
      return `[\n${items.join(',\n')}\n${pad(level)}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, x]) => `${pad(level + 1)}${JSON.stringify(k)}: ${write(x, level + 1)}`);
    return `{\n${lines.join(',\n')}\n${pad(level)}}`;
  };

  return write(value, 0);
}

export function sessionToJson(session: SessionRecord): string {
  return toPrettyJson(session) + '\n';
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

type Cell = string | number | boolean | null | undefined;

/** Decimal places kept for numbers in CSV files. */
const CSV_DECIMALS = 4;

function formatCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(Number(value.toFixed(CSV_DECIMALS)));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // Quote text containing a delimiter, quote or line break (RFC 4180).
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header.join(',')];
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(`CSV row has ${row.length} cells but the header has ${header.length}`);
    }
    lines.push(row.map(formatCell).join(','));
  }
  return lines.join('\n') + '\n';
}

const PATH_METRIC_SUFFIXES = [
  'initial_direction_error_deg',
  'endpoint_direction_error_deg',
  'max_abs_lateral_dev',
  'signed_lateral_dev_at_max',
  'mean_abs_lateral_dev',
  'path_length',
  'path_efficiency',
] as const;

function pathMetricCells(m: PathMetrics | null): Cell[] {
  if (!m) return PATH_METRIC_SUFFIXES.map(() => null);
  return [
    m.initialDirectionErrorDeg,
    m.endpointDirectionErrorDeg,
    m.maxAbsLateralDeviation,
    m.signedLateralDeviationAtMax,
    m.meanAbsLateralDeviation,
    m.pathLength,
    m.pathEfficiency,
  ];
}

export const TRIALS_CSV_HEADER: string[] = [
  'session_id',
  'preset_id',
  'preset_version',
  'assignment_method',
  'condition_concealed',
  'run_number',
  'seed',
  'trial_number',
  'attempt',
  'is_final_attempt',
  'phase',
  'slot_in_phase',
  'is_catch',
  'perturbed_reach_number',
  'target_index',
  'target_angle_deg',
  'target_x',
  'target_y',
  'configured_rotation_deg',
  'applied_rotation_deg',
  'feedback',
  'cursor_visible_during_reach',
  'outcome',
  'hold_completed',
  'valid',
  'invalid_reason',
  'go_cue_ms',
  'movement_onset_ms',
  'completion_ms',
  'hold_completion_ms',
  'reaction_time_ms',
  'movement_duration_ms',
  'reach_sample_count',
  ...PATH_METRIC_SUFFIXES.map((s) => `hand_${s}`),
  ...PATH_METRIC_SUFFIXES.map((s) => `cursor_${s}`),
  'crossing_hand_x',
  'crossing_hand_y',
  'crossing_cursor_x',
  'crossing_cursor_y',
  'arrival_radius',
];

/**
 * One row per attempt (including interrupted and timed-out ones, flagged as such).
 *
 * `completion_ms` is ARRIVAL (the hand first reached `arrival_radius`), which
 * is what `movement_duration_ms` and every path metric are measured to.
 * `hold_completion_ms` is when the reach registered after the target hold.
 */
export function trialsToCsv(session: SessionRecord): string {
  const rows = session.trials.map((t): Cell[] => [
    session.sessionId,
    session.preset.id,
    session.preset.version,
    session.assignment.method,
    session.assignment.conditionConcealed,
    session.runNumber,
    session.seed,
    t.trialNumber,
    t.attempt,
    t.isFinalAttempt,
    t.phase,
    t.slotInPhase,
    t.isCatch,
    t.perturbedReachNumber,
    t.targetIndex,
    t.targetAngleDeg,
    t.targetX,
    t.targetY,
    t.configuredRotationDeg,
    t.appliedRotationDeg,
    t.feedback,
    t.cursorVisibleDuringReach,
    t.outcome,
    t.holdCompleted,
    t.valid,
    t.invalidReason,
    t.times.goCueMs,
    t.times.movementOnsetMs,
    t.times.completionMs,
    t.times.holdCompletionMs,
    t.metrics.reactionTimeMs,
    t.metrics.movementDurationMs,
    t.metrics.reachSampleCount,
    ...pathMetricCells(t.metrics.hand),
    ...pathMetricCells(t.metrics.cursor),
    t.crossing?.handX,
    t.crossing?.handY,
    t.crossing?.cursorX,
    t.crossing?.cursorY,
    t.crossing?.radius,
  ]);
  return toCsv(TRIALS_CSV_HEADER, rows);
}

export const EVENTS_CSV_HEADER: string[] = [
  'session_id',
  'trial_number',
  'attempt',
  'segment',
  'sample_index',
  't_ms',
  't_from_go_ms',
  'dx',
  'dy',
  'hand_x',
  'hand_y',
  'cursor_x',
  'cursor_y',
  'cursor_displayed',
  'hand_progress',
  'hand_lateral',
  'cursor_progress',
  'cursor_lateral',
];

/**
 * One row per recorded mouse sample.
 *
 * `segment` says which part of the attempt the sample belongs to:
 *   pre_reach  — at the centre before the go cue (cursor = hand)
 *   reach      — the outward reach, go cue → arrival (the only segment used for metrics)
 *   settle     — after arrival: steering onto the target and holding there
 * `reach` and `settle` share one coordinate frame and one running `sample_index`,
 * so together they are the whole recorded movement of the reach phase. An
 * attempt in which the hand never arrived has no `settle` rows.
 * The `*_progress` / `*_lateral` columns are target-aligned coordinates and are
 * filled for `reach` and `settle` samples.
 */
export function eventsToCsv(session: SessionRecord): string {
  const rows: Cell[][] = [];

  for (const t of session.trials) {
    const go = t.times.goCueMs;
    const base = (segment: string, index: number, tMs: number): Cell[] => [
      session.sessionId,
      t.trialNumber,
      t.attempt,
      segment,
      index,
      tMs,
      go !== null ? tMs - go : null,
    ];

    const pre = t.samples.preReach;
    for (let i = 0; i < pre.tMs.length; i++) {
      rows.push([...base('pre_reach', i, pre.tMs[i]), pre.dx[i], pre.dy[i], pre.x[i], pre.y[i], pre.x[i], pre.y[i], true, null, null, null, null]);
    }

    const reach = t.samples.reach;
    const hand = alignPath({ x: reach.handX, y: reach.handY, tMs: reach.tMs }, t.targetAngleDeg);
    const cursor =
      reach.cursorX && reach.cursorY
        ? alignPath({ x: reach.cursorX, y: reach.cursorY, tMs: reach.tMs }, t.targetAngleDeg)
        : null;
    // The first sample at or beyond the arrival radius opens the `settle` segment.
    const settleFrom = t.crossing ? t.crossing.sampleIndex : Infinity;
    for (let i = 0; i < reach.tMs.length; i++) {
      rows.push([
        ...base(i >= settleFrom ? 'settle' : 'reach', i, reach.tMs[i]),
        reach.dx[i],
        reach.dy[i],
        reach.handX[i],
        reach.handY[i],
        reach.cursorX ? reach.cursorX[i] : null,
        reach.cursorY ? reach.cursorY[i] : null,
        t.cursorVisibleDuringReach,
        hand.progress[i],
        hand.lateral[i],
        cursor ? cursor.progress[i] : null,
        cursor ? cursor.lateral[i] : null,
      ]);
    }
    // `samples.postReach` is always empty since schema 2, so it contributes no rows.
  }
  return toCsv(EVENTS_CSV_HEADER, rows);
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** Names like `motor-learning_rotation-sudden-45-v2_20261114-1530_session.json` (UTC time of the session). */
export function exportFileNames(session: SessionRecord): { json: string; trialsCsv: string; eventsCsv: string } {
  const stamp = session.createdAtIso.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const stem = `motor-learning_${session.preset.id}_${stamp}`;
  return {
    json: `${stem}_session.json`,
    trialsCsv: `${stem}_trials.csv`,
    eventsCsv: `${stem}_events.csv`,
  };
}

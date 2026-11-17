/**
 * record.ts — the saved form of a session: the "export schema".
 *
 * `buildSessionRecord` flattens the engine's raw attempt records, the session
 * plan and the computed metrics into one self-describing object. The results
 * page reads only this object, and the JSON download is this object, so what a
 * student sees and what they download cannot disagree.
 *
 * SCHEMA VERSIONING: bump `SCHEMA_VERSION` whenever a field is renamed,
 * removed, or changes meaning (adding fields is a minor bump). The full field
 * reference is in docs/EXPORT_SCHEMA.md.
 *
 *   2.2.0  The speed instruction (v3 presets): `preset.timing.maxMovementMs`
 *          and, per attempt, `tooSlow`. Additive.
 *   2.1.0  Adds `metrics.hand/cursor.meanSignedLateralDeviation`, the
 *          whole-path error (signed lateral deviation averaged along the
 *          outward path). Additive.
 *   2.0.0  Hold-to-complete and the jump home. `samples.reach` now runs to the
 *          end of the hold (not just to the crossing); `crossing` is the
 *          arrival at `crossing.radius` and gains `sampleIndex`; `valid` means
 *          "the hand arrived", so a timed-out reach can be valid; new
 *          `holdCompleted`, `times.holdCompletionMs`, `preset.timing.targetHoldMs`
 *          and `reflection.consciousAdjustment`; `samples.postReach` is always
 *          empty; `reflection.changedAim` is no longer asked (always null).
 *          Custom protocols arrived within 2.0.0 as well: `preset.kind`
 *          'custom', `assignment.method` 'custom-link' and
 *          `assignment.customSettings` (early 2.0.0 files lack them).
 *   1.0.0  First release.
 *
 * Key exports: `SessionRecord`, `TrialExport`, `buildSessionRecord`,
 * `finalAttempts`, `reachDataOf`, `SCHEMA_VERSION`.
 */

import {
  computeTrialMetrics,
  summarizeSession,
  type ReachData,
  type SessionSummary,
  type TrialMetrics,
} from './analysis';
import type { Assignment } from './assignment';
import type {
  AttemptTimes,
  CrossingPoint,
  EnginePhase,
  InterruptReason,
  PathSamples,
  ReachOutcome,
  ReachSamples,
} from './engine';
import { targetPosition, type Vec2 } from './geometry';
import type { FeedbackMode, PhaseName, PresetConfig } from './presets';
import type { TrialSpec } from './schedule';
import type {
  EnvironmentInfo,
  PracticeSummary,
  ReflectionAnswers,
  SessionPlan,
  SessionTimingInfo,
  TaskResult,
} from './session';

export const APP_NAME = 'visuomotor-learning-lab';
export const APP_VERSION = '2.2.0';
export const SCHEMA_VERSION = '2.2.0';

/** Plain-language key to units and signs, embedded in every file so it can be read on its own. */
export const CONVENTIONS = {
  coordinates:
    'Workspace units (wu). Origin at the central start position; +x right, +y up. 1 wu = 1 CSS pixel of mouse travel at inputGain 1.',
  angles: 'Degrees. Target directions are counterclockwise from +x (screen right). Positive = counterclockwise on screen.',
  rotation:
    'cursor = start + R(theta) * (hand - start) during the outward reach. Positive theta rotates the cursor counterclockwise relative to the hand.',
  time: 'Milliseconds on the browser monotonic clock (performance.now(); origin = page load).',
  lateralDeviation:
    'u_x*r_y - u_y*r_x with u = unit vector to the target and r = position - start. Positive = counterclockwise (left) of the start-to-target line.',
  directionError:
    'atan2(lateral, progress) of the path relative to the target direction. Positive = counterclockwise. Full compensation for a +45 deg rotation is a hand direction error of -45 deg.',
  arrival:
    'Every reach metric is measured over the outward reach only: from the go cue to ARRIVAL, the first (interpolated) moment the hand reached crossing.radius from the start. With a target hold that radius is targetDistance - targetRadius (the near edge of the target). Samples from crossing.sampleIndex onward are settling on the target and holding; no metric uses them.',
  registering:
    'A reach registers (holdCompleted) when the target zone has been occupied continuously for preset.timing.targetHoldMs. Visible cursor: the cursor centre inside the target circle. Hidden cursor: the unseen hand at least crossing.radius from the start, in any direction.',
  speed:
    'Participants were asked for quick, smooth reaches. tooSlow is true when movement onset to arrival took longer than preset.timing.maxMovementMs; the participant was then shown "Too slow". Such reaches are kept and analysed like any other. Null when the preset has no speed instruction or the hand never arrived.',
  sampleRounding: 'Numbers inside sample arrays are rounded to 3 decimal places in the JSON file.',
} as const;

/** One attempt at one trial. A trial normally has one attempt; an interrupted reach adds another. */
export interface TrialExport {
  /** 1-based position of the trial in the session. */
  trialNumber: number;
  /** 0-based position of the trial in the session. */
  trialIndex: number;
  /** 1-based attempt number for this trial. */
  attempt: number;
  /** True for the attempt that counts for this trial (the last one). Analyses use only these. */
  isFinalAttempt: boolean;

  phase: PhaseName;
  slotInPhase: number;
  isCatch: boolean;
  perturbedReachNumber: number | null;

  targetIndex: number;
  targetAngleDeg: number;
  targetX: number;
  targetY: number;

  /** Rotation the schedule called for. */
  configuredRotationDeg: number;
  /** Rotation the engine actually used in the cursor transformation. */
  appliedRotationDeg: number;
  feedback: FeedbackMode;
  cursorVisibleDuringReach: boolean;

  /** 'completed' = the reach registered; 'timeout' = time ran out first; 'interrupted' = cut off and repeated. */
  outcome: ReachOutcome;
  /** True when the target zone was held long enough for the reach to register. */
  holdCompleted: boolean;
  /** True when the movement broke the speed instruction and "Too slow" was shown; null without one. See CONVENTIONS.speed. */
  tooSlow: boolean | null;
  /**
   * True when the hand arrived (reached the arrival radius) and metrics could
   * be computed. This can be true for a 'timeout' whose hold never registered.
   */
  valid: boolean;
  /** Why not, when `valid` is false. */
  invalidReason: string | null;

  startAnchorOffset: Vec2;
  times: AttemptTimes;
  crossing: CrossingPoint | null;
  metrics: TrialMetrics;
  samples: {
    /** Movement at the centre before the go cue (identity mapping; x,y is both hand and cursor). */
    preReach: PathSamples;
    /**
     * The whole reach phase, from the go cue until the hold registered (or the
     * time limit). Samples before `crossing.sampleIndex` are the outward reach;
     * the rest are settling on the target and holding.
     */
    reach: ReachSamples;
    /** Always empty since schema 2 (the cursor jumps home; nothing follows a reach). Kept for compatibility. */
    postReach: PathSamples;
  };
}

export interface InterruptionExport {
  tMs: number;
  reason: InterruptReason;
  trialNumber: number;
  attempt: number;
  enginePhase: EnginePhase;
  resumedAtMs: number | null;
}

export interface SessionRecord {
  schemaVersion: string;
  app: { name: string; version: string };
  conventions: typeof CONVENTIONS;

  sessionId: string;
  createdAtIso: string;
  completedAtIso: string;

  /** The complete preset definition that was run, including its id and version. */
  preset: PresetConfig;
  assignment: Assignment;
  runNumber: number;
  previousPresetIds: string[];

  seed: number;
  schedule: TrialSpec[];

  environment: EnvironmentInfo;
  timing: SessionTimingInfo;
  durations: {
    /** Practice, if it was run (ms). */
    practiceMs: number | null;
    /** First recorded trial to last (ms). */
    experimentMs: number;
    /** Opening the task screen to the end of the last recorded trial (ms). */
    totalTaskMs: number;
  };
  practice: PracticeSummary;
  interruptions: InterruptionExport[];
  reflection: ReflectionAnswers | null;

  /** Every attempt, in the order it happened. */
  trials: TrialExport[];
  summary: SessionSummary;
}

/** Assemble the saved record of a finished session. Pure. */
export function buildSessionRecord(
  plan: SessionPlan,
  result: TaskResult,
  reflection: ReflectionAnswers | null,
): SessionRecord {
  const { preset } = plan;
  const { geometry, criteria } = preset;

  // The attempt that counts for each trial is the last one recorded for it.
  const lastAttemptOfTrial = new Map<number, number>();
  for (const r of result.records) lastAttemptOfTrial.set(r.trialPosition, r.attempt);

  const trials: TrialExport[] = result.records.map((r) => {
    const spec = r.trial;
    const target = targetPosition(spec.targetAngleDeg, geometry.targetDistance);
    const metrics = computeTrialMetrics(
      {
        outcome: r.outcome,
        crossing: r.crossing,
        reach: r.reach,
        targetAngleDeg: spec.targetAngleDeg,
        cursorVisibleDuringReach: r.cursorVisibleDuringReach,
        times: r.times,
      },
      geometry,
      criteria,
    );
    return {
      trialNumber: spec.trialNumber,
      trialIndex: spec.index,
      attempt: r.attempt,
      isFinalAttempt: lastAttemptOfTrial.get(r.trialPosition) === r.attempt,
      phase: spec.phase,
      slotInPhase: spec.slotInPhase,
      isCatch: spec.isCatch,
      perturbedReachNumber: spec.perturbedReachNumber,
      targetIndex: spec.targetIndex,
      targetAngleDeg: spec.targetAngleDeg,
      targetX: target.x,
      targetY: target.y,
      configuredRotationDeg: spec.rotationDeg,
      appliedRotationDeg: r.appliedRotationDeg,
      feedback: spec.feedback,
      cursorVisibleDuringReach: r.cursorVisibleDuringReach,
      outcome: r.outcome,
      holdCompleted: r.holdCompleted,
      tooSlow: r.tooSlow,
      valid: metrics.valid,
      invalidReason: metrics.nullReason,
      startAnchorOffset: { x: r.startAnchorOffset.x, y: r.startAnchorOffset.y },
      times: { ...r.times },
      crossing: r.crossing ? { ...r.crossing } : null,
      metrics,
      samples: { preReach: r.preReach, reach: r.reach, postReach: r.postReach },
    };
  });

  const finals = trials.filter((t) => t.isFinalAttempt);
  const { timing } = result;
  const totalTaskMs = timing.experimentEndedMs - timing.taskStartedMs;

  return {
    schemaVersion: SCHEMA_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    conventions: CONVENTIONS,
    sessionId: plan.sessionId,
    createdAtIso: plan.createdAtIso,
    completedAtIso: new Date(Date.parse(plan.createdAtIso) + totalTaskMs).toISOString(),
    preset,
    assignment: plan.assignment,
    runNumber: plan.runNumber,
    previousPresetIds: [...plan.previousPresetIds],
    seed: plan.seed,
    schedule: plan.schedule,
    environment: result.environment,
    timing,
    durations: {
      practiceMs: timing.practiceEndedMs !== null ? timing.practiceEndedMs - timing.taskStartedMs : null,
      experimentMs: timing.experimentEndedMs - timing.experimentStartedMs,
      totalTaskMs,
    },
    practice: result.practice,
    interruptions: result.interruptions.map((i) => ({
      tMs: i.tMs,
      reason: i.reason,
      trialNumber: i.trialPosition + 1,
      attempt: i.attempt,
      enginePhase: i.phase,
      resumedAtMs: i.resumedAtMs,
    })),
    reflection,
    trials,
    summary: summarizeSession(finals),
  };
}

/** The attempt that counts for each scheduled trial, in session order. */
export function finalAttempts(session: SessionRecord): TrialExport[] {
  return session.trials.filter((t) => t.isFinalAttempt).sort((a, b) => a.trialNumber - b.trialNumber);
}

/** Adapter: the parts of a saved trial that path analysis needs. */
export function reachDataOf(trial: TrialExport): ReachData {
  return { outcome: trial.outcome, crossing: trial.crossing, reach: trial.samples.reach };
}

/**
 * The whole-path error of the path the participant SAW: the cursor's signed
 * lateral deviation averaged along its outward path, in % of the target
 * distance (+ = counterclockwise). On a reach made with the cursor hidden
 * there was no rotation, so the cursor would have followed the hand exactly
 * and the hand's path stands in for it. Null when there is no value (an
 * invalid reach, or a file written before schema 2.1 that lacks the metric).
 *
 * Why the cursor and not the hand: once a participant has adapted, their HAND
 * path is supposed to run off to the side of the straight line to the target
 * (that is what cancels the rotation), so a hand-path "error" would score good
 * adaptation as a large error. The cursor path is the error they experienced.
 */
export function seenPathErrorPct(t: TrialExport, targetDistance: number): number | null {
  if (!t.valid) return null;
  const m = t.metrics.cursor ?? (t.appliedRotationDeg === 0 ? t.metrics.hand : null);
  const value = m?.meanSignedLateralDeviation;
  return typeof value === 'number' ? (value / targetDistance) * 100 : null;
}

/** Returns a copy of the record with the reflection answers attached. */
export function withReflection(session: SessionRecord, reflection: ReflectionAnswers): SessionRecord {
  return { ...session, reflection };
}

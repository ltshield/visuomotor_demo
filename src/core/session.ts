/**
 * session.ts — the shape of everything one run of the activity produces.
 *
 * The task screen hands back a `TaskResult` (raw engine records plus timing
 * and environment details). Those types live here, in DOM-free core code, so
 * that analysis and export can be reused and tested without a browser.
 *
 * Key exports: `TaskResult`, `EnvironmentInfo`, `SessionTimingInfo`,
 * `PracticeSummary`.
 */

import { presetForAssignment, type Assignment } from './assignment';
import type { AttemptRecord, InterruptionRecord } from './engine';
import type { PresetConfig } from './presets';
import { generateSchedule, type TrialSpec } from './schedule';

/** Everything decided before a session starts. Saved verbatim with the data. */
export interface SessionPlan {
  /** Random label for this run's data file. Not a participant identifier. */
  sessionId: string;
  preset: PresetConfig;
  assignment: Assignment;
  /** Seed that reproduces the target order via `generateSchedule(preset, seed)`. */
  seed: number;
  schedule: TrialSpec[];
  /** 1 for the first run since the page was opened, 2 for the next, and so on. */
  runNumber: number;
  /** Presets already completed during this page visit, oldest first (possible carry-over). */
  previousPresetIds: string[];
  /** Wall-clock creation time, ISO 8601 UTC. */
  createdAtIso: string;
}

/** Builds the plan for a new session. Pure: randomness and the clock are supplied by the caller. */
export function createSessionPlan(args: {
  assignment: Assignment;
  seed: number;
  sessionId: string;
  previousPresetIds: readonly string[];
  now: Date;
}): SessionPlan {
  const preset = presetForAssignment(args.assignment);
  return {
    sessionId: args.sessionId,
    preset,
    assignment: args.assignment,
    seed: args.seed,
    schedule: generateSchedule(preset, args.seed),
    runNumber: args.previousPresetIds.length + 1,
    previousPresetIds: [...args.previousPresetIds],
    createdAtIso: args.now.toISOString(),
  };
}

export interface EnvironmentInfo {
  userAgent: string;
  language: string;
  /** Browser viewport in CSS pixels when the recorded part began. */
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  /** CSS pixels per workspace unit as drawn (1 unless the window was too small to fit the workspace). */
  displayScale: number;
  /** DOM event type that supplied mouse movement (see input/pointerLock.ts). */
  moveEventSource: 'pointermove' | 'mousemove';
  /**
   * Movement events received during the recorded part, and the samples they
   * yielded. More samples than events means the mouse's individual hardware
   * reports were used (higher temporal resolution than one sample per frame).
   */
  moveEvents: number;
  moveSamples: number;
  /** Median time between animation frames in ms (≈16.7 on a 60 Hz display); null if unknown. */
  frameIntervalMs: number | null;
}

/** Milestones on the `performance.now()` timeline (ms since the page loaded). */
export interface SessionTimingInfo {
  /** The task screen opened (practice began, or the ready prompt if practice was skipped). */
  taskStartedMs: number;
  practiceEndedMs: number | null;
  /** The participant clicked to begin the recorded reaches. */
  experimentStartedMs: number;
  /** The last recorded trial ended. */
  experimentEndedMs: number;
}

export interface PracticeSummary {
  /** False when practice was skipped (a repeat run in the same visit). */
  included: boolean;
  reachesCompleted: number;
  /** Includes repeats after a timed-out or interrupted practice reach. */
  attempts: number;
}

/** Answer to the strategy-awareness question; null when it was left unanswered or the screen was skipped. */
export type ConsciousAdjustment = 'yes' | 'somewhat' | 'no' | 'unsure';

/** Optional answers given after the task and before the reveal. */
export interface ReflectionAnswers {
  /** True when the participant pressed Skip; the other fields are then empty. */
  skipped: boolean;
  /** Free text: what, if anything, seemed to change. */
  noticed: string;
  /** "Did you consciously try to adjust where you aimed during the task?" */
  consciousAdjustment: ConsciousAdjustment | null;
  /**
   * @deprecated Schema 1 asked "Did you deliberately change how you aimed?" with
   * three answers. `consciousAdjustment` replaced that question, so this is
   * always null in files written by schema 2; it is kept so the shape of
   * `reflection` did not change.
   */
  changedAim: 'yes' | 'no' | 'unsure' | null;
  /** Self-reported pointing device. */
  device: 'mouse' | 'trackpad' | 'other' | null;
}

export interface TaskResult {
  records: readonly AttemptRecord<TrialSpec>[];
  interruptions: readonly InterruptionRecord[];
  practice: PracticeSummary;
  timing: SessionTimingInfo;
  environment: EnvironmentInfo;
}

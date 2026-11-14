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

import type { AttemptRecord, InterruptionRecord } from './engine';
import type { TrialSpec } from './schedule';

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

export interface TaskResult {
  records: readonly AttemptRecord<TrialSpec>[];
  interruptions: readonly InterruptionRecord[];
  practice: PracticeSummary;
  timing: SessionTimingInfo;
  environment: EnvironmentInfo;
}

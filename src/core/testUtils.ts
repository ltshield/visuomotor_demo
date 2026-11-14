/**
 * testUtils.ts — a scripted "participant" for driving the TrialEngine in tests.
 *
 * `EngineDriver` feeds the engine evenly spaced mouse samples and frame ticks
 * on a simulated clock, so tests can express a trial in a few readable lines
 * (`driver.center(); driver.reach(45);`). It is test support only and is never
 * imported by application code.
 *
 * Key exports: `EngineDriver`, `runScriptedSession`, `taskResultFrom`,
 * `scriptedSessionRecord`.
 */

import { unitFromAngleDeg } from './geometry';
import { TrialEngine, type EngineConfig, type EngineTrial } from './engine';
import { assignPreset } from './assignment';
import type { PresetConfig } from './presets';
import { buildSessionRecord, type SessionRecord } from './record';
import type { TrialSpec } from './schedule';
import { createSessionPlan, type TaskResult } from './session';

const FRAME_MS = 16;

export interface ReachOptions {
  /** How far the hand travels in total (default: 8% beyond the target distance). */
  distance?: number;
  /** Duration of the movement in ms (default 300). */
  durationMs?: number;
  /** Interval between mouse samples in ms (default 4, i.e. 250 Hz). */
  sampleMs?: number;
}

export class EngineDriver<T extends EngineTrial = EngineTrial> {
  /** Simulated monotonic clock (ms). */
  t: number;

  constructor(
    readonly engine: TrialEngine<T>,
    readonly config: EngineConfig,
    startTimeMs = 0,
  ) {
    this.t = startTimeMs;
  }

  get phase() {
    return this.engine.getView().phase;
  }

  /** Let time pass with the mouse still, ticking once per frame. */
  wait(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + FRAME_MS);
      this.engine.tick(this.t);
    }
  }

  /**
   * Move the mouse by (dx, dy) in total, spread evenly over `durationMs`.
   * Stops early as soon as `stopWhen` returns true.
   */
  move(dx: number, dy: number, durationMs: number, sampleMs = 4, stopWhen?: () => boolean): void {
    const steps = Math.max(1, Math.round(durationMs / sampleMs));
    for (let i = 0; i < steps; i++) {
      this.t += durationMs / steps;
      this.engine.handleMove(dx / steps, dy / steps, this.t);
      this.engine.tick(this.t);
      if (stopWhen?.()) return;
    }
  }

  /** Bring the cursor to the start position and hold until the target appears. */
  center(): void {
    const { cursor } = this.engine.getView();
    this.move(-cursor.x, -cursor.y, 200);
    let guard = 0;
    while (this.phase !== 'reach') {
      this.wait(FRAME_MS);
      if (++guard > 2000) throw new Error(`go cue never arrived (phase: ${this.phase})`);
    }
  }

  /** A straight outward movement of the HAND along `handAngleDeg` (CCW from +x). */
  reach(handAngleDeg: number, options: ReachOptions = {}): void {
    const distance = options.distance ?? this.config.geometry.targetDistance * 1.08;
    const u = unitFromAngleDeg(handAngleDeg);
    this.move(
      u.x * distance,
      u.y * distance,
      options.durationMs ?? 300,
      options.sampleMs ?? 4,
      () => this.phase !== 'reach',
    );
  }

  /** Wait until the post-reach pause is over. */
  finishFeedback(): void {
    let guard = 0;
    while (this.phase === 'feedback') {
      this.wait(FRAME_MS);
      if (++guard > 2000) throw new Error('feedback phase never ended');
    }
  }

  /** One whole trial: centre, hold, reach along `handAngleDeg`, sit out the pause. */
  trial(handAngleDeg: number, options: ReachOptions = {}): void {
    this.center();
    this.reach(handAngleDeg, options);
    this.finishFeedback();
  }
}

/** Wrap a finished engine's output in a `TaskResult`, with placeholder environment details. */
export function taskResultFrom(engine: TrialEngine<TrialSpec>, startedMs: number, endedMs: number): TaskResult {
  return {
    records: engine.getRecords(),
    interruptions: engine.getInterruptions(),
    practice: { included: true, reachesCompleted: 6, attempts: 6 },
    timing: {
      taskStartedMs: startedMs - 30000,
      practiceEndedMs: startedMs - 5000,
      experimentStartedMs: startedMs,
      experimentEndedMs: endedMs,
    },
    environment: {
      userAgent: 'test-agent',
      language: 'en-US',
      viewport: { width: 1366, height: 700 },
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 1,
      displayScale: 1,
      moveEventSource: 'pointermove',
      moveEvents: 100,
      moveSamples: 400,
      frameIntervalMs: 16.7,
    },
  };
}

/**
 * A complete SessionRecord produced by a scripted participant.
 * @param linkCode     'k7m2' (sudden), 'p4x9' (gradual) or 'demo'
 * @param aimOffsetDeg hand direction relative to the target on each trial
 */
export function scriptedSessionRecord(
  linkCode: string,
  aimOffsetDeg: (trial: TrialSpec) => number,
  seed = 77,
): SessionRecord {
  const plan = createSessionPlan({
    assignment: assignPreset(linkCode, () => 0),
    seed,
    sessionId: 'scripted-session',
    previousPresetIds: [],
    now: new Date('2026-11-14T15:30:00.000Z'),
  });
  const { engine, driver } = runScriptedSession(plan.preset, plan.schedule, aimOffsetDeg);
  return buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);
}

export function engineConfigFor(preset: PresetConfig, repeatOnTimeout = false): EngineConfig {
  return { geometry: preset.geometry, timing: preset.timing, criteria: preset.criteria, repeatOnTimeout };
}

/**
 * Runs a complete session with a participant whose hand direction on each
 * trial is `targetAngle + aimOffsetDeg(trial)`. Returns the engine and driver
 * so tests can inspect records.
 */
export function runScriptedSession(
  preset: PresetConfig,
  schedule: readonly TrialSpec[],
  aimOffsetDeg: (trial: TrialSpec) => number,
  options: ReachOptions = {},
): { engine: TrialEngine<TrialSpec>; driver: EngineDriver<TrialSpec> } {
  const config = engineConfigFor(preset);
  const engine = new TrialEngine<TrialSpec>(schedule, config, { startTimeMs: 1000, initialCursor: { x: 40, y: -30 } });
  const driver = new EngineDriver(engine, config, 1000);
  for (const trial of schedule) {
    driver.trial(trial.targetAngleDeg + aimOffsetDeg(trial), options);
  }
  return { engine, driver };
}

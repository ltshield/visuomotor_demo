/**
 * engine.ts — the trial state machine and movement recorder.
 *
 * `TrialEngine` is deliberately free of DOM, React and timers. It is driven by
 * three kinds of input, each carrying an explicit monotonic timestamp (ms on
 * the `performance.now()` timeline):
 *
 *   handleMove(dx, dy, t)  a mouse delta in workspace units (+y up)
 *   tick(t)                "time has passed" — called once per animation frame
 *   interrupt()/resume()   pointer-lock or focus loss and recovery
 *
 * That makes every rule below testable with scripted input (engine.test.ts).
 *
 * LIFE OF ONE TRIAL
 *
 *   acquire ──cursor enters start circle──▶ hold ──holdMs elapsed──▶ reach
 *      ▲  ◀────cursor leaves start circle──┘                           │
 *      │                                    held in the target zone for │
 *      │                                    targetHoldMs, or timeout    ▼
 *      └──cursor JUMPS to the centre── feedbackHoldMs elapsed ───── feedback
 *
 *   acquire / hold  Cursor visible, identity mapping (cursor = hand).
 *   reach           Outward movement. cursor = start + R(θ)·(hand − start).
 *                   The cursor is drawn only if the trial's feedback is
 *                   'visible'; the hand is recorded either way.
 *   feedback        Brief pause. A registered target pulses; the cursor stays
 *                   where it was. Then the cursor jumps back to the centre.
 *
 * WHEN A REACH REGISTERS (hold-to-complete). The reach registers once the
 * "target zone" has been occupied continuously for `timing.targetHoldMs`.
 * Leaving the zone restarts the count.
 *
 *   visible cursor   zone = the target circle: the CURSOR's centre within
 *                    `targetRadius` of the target's centre.
 *   hidden cursor    zone = the target's DISTANCE: the unseen HAND at least
 *                    `arrivalRadius` from the start, in ANY direction.
 *
 * The hidden-cursor zone ignores direction on purpose. Direction is the very
 * thing those reaches measure (baseline bias, aftereffects), so it must not
 * decide whether the reach registers: a participant showing a 40° aftereffect
 * would otherwise never complete a reach, and the resulting time-outs would
 * tell them they had missed on a trial meant to give no feedback.
 *
 * With `targetHoldMs` of 0 the reach registers the instant the hand arrives,
 * which is the original (v1) crossing rule.
 *
 * ARRIVAL. Separately from registering, the engine notes the first moment the
 * hand reaches the arrival radius (`presets.arrivalRadius`), interpolated
 * between samples. All reach metrics are measured up to that point, so they do
 * not depend on how long the participant took to settle and hold.
 *
 * Four rules keep the transformation honest:
 *   1. ANCHOR AT GO: when the target appears, the virtual hand and the cursor
 *      are both reset to the exact start position, so the rotation always
 *      pivots about the centre and directions are measured from one origin.
 *   2. ARRIVE BY HAND DISTANCE: arrival is judged on the HAND's distance from
 *      the start (rotation preserves distance, so the cursor is equally far).
 *      It never depends on hitting something that may be hidden.
 *   3. NOTHING HIDDEN DECIDES A HIDDEN REACH: see the zones above.
 *   4. JUMP HOME: after the pause the virtual hand and the cursor are both
 *      placed on the start position. There is no return movement, so nothing
 *      rotated can leak into the next trial and a hidden-cursor reach never
 *      reveals where it ended.
 *
 * The engine's public `EngineView` exposes only what a renderer needs. It
 * contains no experiment-phase names, rotation angles or catch flags, so the
 * task screen cannot accidentally reveal the design.
 *
 * Key exports: `TrialEngine`, `EngineTrial`, `EngineView`, `AttemptRecord`.
 */

import {
  ZERO,
  add,
  applyCursorTransform,
  clampToSquare,
  lerp,
  norm,
  segmentCircleCrossing,
  sub,
  targetPosition,
  type Vec2,
} from './geometry';
import {
  arrivalRadius,
  targetHoldMsOf,
  type FeedbackMode,
  type MovementCriteria,
  type TaskGeometry,
  type TaskTiming,
} from './presets';

/** The minimum a trial must specify for the engine to run it. `TrialSpec` satisfies this. */
export interface EngineTrial {
  targetIndex: number;
  targetAngleDeg: number;
  /** Cursor rotation during the outward reach, degrees, + = counterclockwise. */
  rotationDeg: number;
  feedback: FeedbackMode;
}

export type EnginePhase = 'acquire' | 'hold' | 'reach' | 'feedback' | 'paused' | 'finished';

/**
 * completed   — the reach registered: the target zone was held for long enough.
 * timeout     — time ran out first. The attempt is recorded and not repeated
 *               (except in practice mode). If the hand had already arrived, the
 *               outward reach is still analysed; see `AttemptRecord.crossing`.
 * interrupted — pointer lock or focus was lost mid-reach; the partial movement
 *               is kept and the same trial is presented again.
 */
export type ReachOutcome = 'completed' | 'timeout' | 'interrupted';

export type InterruptReason = 'pointer-lock-lost' | 'window-blur' | 'tab-hidden';

export type EngineNotice = 'timeout';

export interface EngineConfig {
  geometry: TaskGeometry;
  timing: TaskTiming;
  criteria: MovementCriteria;
  /** Practice mode: repeat a timed-out reach instead of moving on. */
  repeatOnTimeout?: boolean;
}

/** Samples of the reach phase, stored column-wise (one entry per input event). */
export interface ReachSamples {
  /** Monotonic time of each sample (ms, `performance.now()` timeline). */
  tMs: number[];
  /** Mouse delta that produced the sample, workspace units, +x right / +y up. */
  dx: number[];
  dy: number[];
  /** Virtual unperturbed hand position relative to the start. */
  handX: number[];
  handY: number[];
  /** Displayed cursor position; null for the whole trial when the cursor was hidden. */
  cursorX: number[] | null;
  cursorY: number[] | null;
}

/** Samples of a movement made under the identity mapping (centring and holding before the go cue). */
export interface PathSamples {
  tMs: number[];
  dx: number[];
  dy: number[];
  x: number[];
  y: number[];
}

/**
 * ARRIVAL: the interpolated instant at which the hand first reached the
 * arrival radius. (The name "crossing" is kept from schema 1, where the radius
 * was always the target distance.)
 */
export interface CrossingPoint {
  tMs: number;
  handX: number;
  handY: number;
  /** Where the cursor was at that instant; null when the cursor was hidden. */
  cursorX: number | null;
  cursorY: number | null;
  /** The arrival radius that was crossed (wu). */
  radius: number;
  /**
   * Index, in the reach samples, of the first sample at or beyond the arrival
   * radius. Samples before it are the outward reach; samples from it onward
   * are settling onto the target and holding there.
   */
  sampleIndex: number;
}

export interface AttemptTimes {
  /** This attempt began (the cursor had just been placed on the centre). */
  acquireStartMs: number;
  /** Start of the final, successful centred hold. */
  holdStartMs: number | null;
  /** Target appeared and the hand was anchored: the start of the outward reach. */
  goCueMs: number | null;
  /** Hand first reached `criteria.onsetFraction` of the target distance (interpolated). */
  movementOnsetMs: number | null;
  /** ARRIVAL: hand first reached the arrival radius (interpolated between samples). */
  completionMs: number | null;
  /** The reach registered: the target zone had been held for `targetHoldMs`. Exactly hold start + targetHoldMs. */
  holdCompletionMs: number | null;
  /** The reach phase ended: the hold registering, the timeout, or the interruption, as the engine noticed it. */
  reachEndMs: number | null;
  /** The attempt's record was closed. */
  attemptEndMs: number;
}

export interface AttemptRecord<T extends EngineTrial = EngineTrial> {
  trial: T;
  /** 0-based position of the trial in the list given to the engine. */
  trialPosition: number;
  /** 1-based; greater than 1 only when an earlier attempt was interrupted (or timed out in practice). */
  attempt: number;
  outcome: ReachOutcome;
  /** True when the target zone was held for long enough, i.e. the reach registered. */
  holdCompleted: boolean;
  /** The rotation actually used in the cursor transformation on this attempt. */
  appliedRotationDeg: number;
  cursorVisibleDuringReach: boolean;
  /** Small cursor offset from the exact centre that was removed when the reach was anchored. */
  startAnchorOffset: Vec2;
  times: AttemptTimes;
  /** The hand's arrival at the arrival radius; null if it never got that far. */
  crossing: CrossingPoint | null;
  /** Every sample from the go cue until the reach phase ended, including settling and holding. */
  reach: ReachSamples;
  /** Movement at the centre before the go cue (identity mapping). */
  preReach: PathSamples;
  /**
   * Always empty. There is no movement after a reach any more (the cursor jumps
   * home); the field is kept so files keep the shape of schema 1.
   */
  postReach: PathSamples;
}

export interface InterruptionRecord {
  tMs: number;
  reason: InterruptReason;
  trialPosition: number;
  attempt: number;
  /** Engine phase at the moment of interruption. */
  phase: EnginePhase;
  resumedAtMs: number | null;
}

/** Everything a renderer may know. Deliberately contains nothing about the experimental design. */
export interface EngineView {
  phase: EnginePhase;
  /** Where the cursor is (or was last) drawn. */
  cursor: Vec2;
  cursorVisible: boolean;
  /** Index of the highlighted target, or null when none is lit. */
  activeTargetIndex: number | null;
  /** 0..1 progress of the centred hold, for subtle visual confirmation. */
  holdFraction: number;
  /**
   * 0..1 progress of the hold on the target. Reported only while the cursor is
   * VISIBLY inside the target; always 0 on hidden-cursor reaches, so the
   * screen never hints at how an unseen reach is going.
   */
  targetHoldFraction: number;
  /** True during the pause after a reach that registered: the lit target should pulse. */
  confirmed: boolean;
  trialsCompleted: number;
  trialsTotal: number;
  notice: EngineNotice | null;
}

/** Working state of the attempt currently in progress. */
interface AttemptBuffer {
  acquireStartMs: number;
  holdStartMs: number | null;
  goCueMs: number | null;
  movementOnsetMs: number | null;
  completionMs: number | null;
  holdCompletionMs: number | null;
  reachEndMs: number | null;
  outcome: ReachOutcome | null;
  holdCompleted: boolean;
  appliedRotationDeg: number;
  cursorVisible: boolean;
  /** Centre of this trial's target. */
  target: Vec2;
  startAnchorOffset: Vec2;
  crossing: CrossingPoint | null;
  reach: ReachSamples;
  pre: PathSamples;
}

const emptyPath = (): PathSamples => ({ tMs: [], dx: [], dy: [], x: [], y: [] });

export class TrialEngine<T extends EngineTrial = EngineTrial> {
  private readonly trials: readonly T[];
  private readonly config: EngineConfig;
  /** Hold required in the target zone (ms); 0 = register on arrival. */
  private readonly targetHoldMs: number;
  /** Distance from the start at which the hand counts as having arrived (wu). */
  private readonly arrivalR: number;

  private now: number;
  private phase: EnginePhase;
  private position = 0;
  private attempt = 1;
  private completedCount = 0;

  /** Virtual unperturbed hand position (wu, relative to the start). */
  private hand: Vec2;
  /** Position at which the cursor is drawn (or would be, if hidden). */
  private cursor: Vec2;

  /** When the current centred hold began (phase 'hold'). */
  private holdStartMs: number | null = null;
  /** When the target zone was last entered during the reach; null while outside it. */
  private targetHoldStartMs: number | null = null;
  private notice: EngineNotice | null = null;
  private current: AttemptBuffer | null = null;

  private readonly records: AttemptRecord<T>[] = [];
  private readonly interruptions: InterruptionRecord[] = [];

  constructor(
    trials: readonly T[],
    config: EngineConfig,
    options: { startTimeMs: number; initialCursor?: Vec2 },
  ) {
    this.trials = trials;
    this.config = config;
    this.targetHoldMs = targetHoldMsOf(config.timing);
    this.arrivalR = arrivalRadius(config.geometry, config.timing);
    this.now = options.startTimeMs;
    const start = this.confine(options.initialCursor ?? ZERO);
    this.hand = start;
    this.cursor = start;
    if (trials.length === 0) {
      this.phase = 'finished';
    } else {
      this.phase = 'acquire';
      this.beginAttempt(this.now);
    }
  }

  // ---- inputs -------------------------------------------------------------

  /** A mouse delta in workspace units (+x right, +y up) with its event timestamp. */
  handleMove(dx: number, dy: number, tMs: number): void {
    const t = this.advanceClock(tMs);
    const cur = this.current;
    if (!cur) return;
    const delta = { x: dx, y: dy };

    switch (this.phase) {
      case 'acquire':
      case 'hold': {
        // Between reaches the mapping is the identity and the cursor is kept
        // on screen, exactly like an ordinary pointer stopping at a screen edge.
        this.hand = this.confine(add(this.hand, delta));
        this.cursor = this.hand;
        pushPath(cur.pre, t, dx, dy, this.hand);
        this.updateCentering(t);
        break;
      }

      case 'reach': {
        // Until this event the hand was where the previous sample left it. If
        // the hold ran its full course there, the reach had already registered
        // and this movement comes after it (and is not part of the reach).
        if (this.registerHoldIfElapsed(t)) break;

        const prev = this.hand;
        const prevT = cur.reach.tMs[cur.reach.tMs.length - 1];
        this.hand = add(prev, delta); // unclamped: the hand is recorded as it really moved
        this.cursor = applyCursorTransform(this.hand, ZERO, cur.appliedRotationDeg);
        pushReach(cur.reach, t, dx, dy, this.hand, this.cursor);

        if (cur.movementOnsetMs === null) {
          const onsetRadius = this.config.criteria.onsetFraction * this.config.geometry.targetDistance;
          const f = segmentCircleCrossing(prev, this.hand, onsetRadius);
          if (f !== null) cur.movementOnsetMs = prevT + f * (t - prevT);
        }

        // Rule 2: arrival is judged on the HAND's distance from the start, once.
        if (cur.crossing === null) {
          const f = segmentCircleCrossing(prev, this.hand, this.arrivalR);
          if (f !== null) this.recordArrival(t, prev, prevT, f);
        }

        if (this.targetHoldMs > 0) {
          this.updateTargetHold(t);
        } else if (cur.crossing !== null) {
          // No hold required (v1 rule): the reach registers at the arrival
          // itself, and the cursor is shown exactly where it crossed.
          if (cur.cursorVisible && cur.crossing.cursorX !== null && cur.crossing.cursorY !== null) {
            this.cursor = { x: cur.crossing.cursorX, y: cur.crossing.cursorY };
          }
          this.registerReach(t, cur.crossing.tMs);
        }
        break;
      }

      case 'feedback': // the reach is over; the cursor stays put until it jumps home
      case 'paused':
      case 'finished':
        break; // movement is ignored
    }
  }

  /** Advance time-based transitions. Call once per animation frame with `performance.now()`. */
  tick(tMs: number): void {
    const t = this.advanceClock(tMs);
    const cur = this.current;
    if (!cur) return;
    const timing = this.config.timing;

    switch (this.phase) {
      case 'acquire':
        // The cursor may already be centred when the phase starts, with no movement to announce it.
        this.updateCentering(t);
        break;
      case 'hold':
        if (this.holdStartMs !== null && t - this.holdStartMs >= timing.holdMs) this.beginReach(t);
        break;
      case 'reach':
        if (this.registerHoldIfElapsed(t)) break;
        if (cur.goCueMs !== null && t - cur.goCueMs >= timing.reachTimeoutMs) this.timeoutReach(t);
        break;
      case 'feedback':
        if (cur.reachEndMs !== null && t - cur.reachEndMs >= timing.feedbackHoldMs) this.finishAttempt(t);
        break;
      case 'paused':
      case 'finished':
        break;
    }
  }

  /**
   * Pointer lock or window focus was lost. A reach in progress is saved as an
   * 'interrupted' attempt (never dropped) and the same trial is queued again.
   */
  interrupt(reason: InterruptReason, tMs: number): void {
    const t = this.advanceClock(tMs);
    if (this.phase === 'paused' || this.phase === 'finished') return;
    const cur = this.current;

    this.interruptions.push({
      tMs: t,
      reason,
      trialPosition: this.position,
      attempt: this.attempt,
      phase: this.phase,
      resumedAtMs: null,
    });

    if (cur && this.phase === 'reach') {
      cur.reachEndMs = t;
      cur.outcome = 'interrupted';
      this.finishAttempt(t);
    } else if (cur && this.phase === 'feedback') {
      // The reach itself had already ended normally; just close its record.
      this.finishAttempt(t);
    }
    // 'acquire' / 'hold': nothing to close — the attempt simply continues after resuming.

    if (this.isFinished()) return;
    this.phase = 'paused';
    this.holdStartMs = null;
  }

  /** Pointer lock is back. The trial restarts from the centring phase. */
  resume(tMs: number): void {
    const t = this.advanceClock(tMs);
    if (this.phase !== 'paused') return;
    const last = this.interruptions[this.interruptions.length - 1];
    if (last && last.resumedAtMs === null) last.resumedAtMs = t;
    this.phase = 'acquire';
    this.holdStartMs = null;
  }

  // ---- outputs ------------------------------------------------------------

  getView(): EngineView {
    const trial = this.trials[this.position] as T | undefined;
    const cur = this.current;
    const inReach = this.phase === 'reach' || this.phase === 'feedback';
    const visibleTrial = cur ? cur.cursorVisible : true;
    const confirmed = this.phase === 'feedback' && cur?.outcome === 'completed';

    let holdFraction = 0;
    if (this.phase === 'hold' && this.holdStartMs !== null) {
      const holdMs = this.config.timing.holdMs;
      holdFraction = holdMs > 0 ? Math.min(1, (this.now - this.holdStartMs) / holdMs) : 1;
    }

    // Progress of the target hold is shown only when the participant can
    // already see the cursor sitting in the target (rule 3).
    let targetHoldFraction = 0;
    if (this.phase === 'reach' && visibleTrial && this.targetHoldStartMs !== null && this.targetHoldMs > 0) {
      targetHoldFraction = Math.min(1, (this.now - this.targetHoldStartMs) / this.targetHoldMs);
    }

    // The target is lit for the reach and, if the reach registered, through the
    // pause that follows so it can pulse. After a timeout it simply goes dark.
    // This is the same on visible and hidden trials.
    let activeTargetIndex: number | null = null;
    if (trial && (this.phase === 'reach' || confirmed)) activeTargetIndex = trial.targetIndex;

    return {
      phase: this.phase,
      cursor: { x: this.cursor.x, y: this.cursor.y },
      cursorVisible: this.phase === 'finished' ? false : inReach ? visibleTrial : true,
      activeTargetIndex,
      holdFraction,
      targetHoldFraction,
      confirmed,
      trialsCompleted: this.completedCount,
      trialsTotal: this.trials.length,
      notice: this.notice,
    };
  }

  getRecords(): readonly AttemptRecord<T>[] {
    return this.records;
  }

  getInterruptions(): readonly InterruptionRecord[] {
    return this.interruptions;
  }

  isFinished(): boolean {
    return this.phase === 'finished';
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Input events carry the time the OS saw them, which can be marginally
   * earlier than a tick that has already been processed. Clamping keeps the
   * engine's clock (and therefore every recorded sample) non-decreasing.
   */
  private advanceClock(tMs: number): number {
    if (tMs > this.now) this.now = tMs;
    return this.now;
  }

  private confine(p: Vec2): Vec2 {
    const g = this.config.geometry;
    return clampToSquare(p, g.boundsHalfExtent - g.cursorRadius);
  }

  private beginAttempt(t: number): void {
    const trial = this.trials[this.position];
    const visible = trial.feedback === 'visible';
    this.current = {
      acquireStartMs: t,
      holdStartMs: null,
      goCueMs: null,
      movementOnsetMs: null,
      completionMs: null,
      holdCompletionMs: null,
      reachEndMs: null,
      outcome: null,
      holdCompleted: false,
      appliedRotationDeg: trial.rotationDeg,
      cursorVisible: visible,
      target: targetPosition(trial.targetAngleDeg, this.config.geometry.targetDistance),
      startAnchorOffset: ZERO,
      crossing: null,
      reach: { tMs: [], dx: [], dy: [], handX: [], handY: [], cursorX: visible ? [] : null, cursorY: visible ? [] : null },
      pre: emptyPath(),
    };
    this.phase = 'acquire';
    this.holdStartMs = null;
    this.targetHoldStartMs = null;
  }

  private updateCentering(t: number): void {
    const inside = norm(this.cursor) <= this.config.geometry.startRadius;
    if (this.phase === 'acquire' && inside) {
      this.phase = 'hold';
      this.holdStartMs = t;
    } else if (this.phase === 'hold' && !inside) {
      // Left the start circle early: the hold must begin again.
      this.phase = 'acquire';
      this.holdStartMs = null;
    }
  }

  private beginReach(t: number): void {
    const cur = this.current!;
    cur.holdStartMs = this.holdStartMs;
    cur.goCueMs = t;

    // Rule 1 — anchor at go. The cursor is somewhere inside the small start
    // circle; remember that residual offset for the record, then place both the
    // virtual hand and the cursor exactly on the start position.
    cur.startAnchorOffset = { x: this.hand.x, y: this.hand.y };
    this.hand = { x: 0, y: 0 };
    this.cursor = { x: 0, y: 0 };

    this.phase = 'reach';
    this.holdStartMs = null;
    this.targetHoldStartMs = null;
    this.notice = null;
    // The first sample is the anchored start itself, stamped with the go-cue time.
    pushReach(cur.reach, t, 0, 0, this.hand, this.cursor);
  }

  /**
   * Note the hand's arrival at the arrival radius, between the previous sample
   * (`prev` at `prevT`) and the one just recorded at `t`. Interpolating the
   * exact crossing keeps the endpoint independent of the mouse's report rate.
   */
  private recordArrival(t: number, prev: Vec2, prevT: number, f: number): void {
    const cur = this.current!;
    const crossingHand = lerp(prev, this.hand, f);
    const crossingT = prevT + f * (t - prevT);
    const crossingCursor = applyCursorTransform(crossingHand, ZERO, cur.appliedRotationDeg);
    cur.completionMs = crossingT;
    cur.crossing = {
      tMs: crossingT,
      handX: crossingHand.x,
      handY: crossingHand.y,
      cursorX: cur.cursorVisible ? crossingCursor.x : null,
      cursorY: cur.cursorVisible ? crossingCursor.y : null,
      radius: this.arrivalR,
      sampleIndex: cur.reach.tMs.length - 1,
    };
  }

  /** Is the target zone occupied right now? (See the header for the two zones.) */
  private inTargetZone(): boolean {
    const cur = this.current!;
    if (cur.cursorVisible) {
      return norm(sub(this.cursor, cur.target)) <= this.config.geometry.targetRadius;
    }
    // Rule 3: with the cursor hidden only the hand's DISTANCE counts, never its direction.
    return norm(this.hand) >= this.arrivalR;
  }

  /** Start the hold count on entering the target zone; cancel it on leaving. */
  private updateTargetHold(t: number): void {
    if (this.inTargetZone()) {
      if (this.targetHoldStartMs === null) this.targetHoldStartMs = t;
    } else {
      this.targetHoldStartMs = null; // left before the hold was up: the count starts again
    }
  }

  /**
   * Register the reach if the target zone has now been held for long enough.
   * The reach registers at exactly hold start + targetHoldMs, however late the
   * engine happens to be told (frame ticks are ~16 ms apart). Returns true if
   * it registered.
   */
  private registerHoldIfElapsed(t: number): boolean {
    const cur = this.current!;
    if (this.targetHoldMs <= 0 || this.targetHoldStartMs === null || cur.goCueMs === null) return false;
    const registeredAt = this.targetHoldStartMs + this.targetHoldMs;
    if (t < registeredAt) return false;
    // If the time limit fell before the hold was up, the limit wins; tick() times the reach out.
    if (registeredAt > cur.goCueMs + this.config.timing.reachTimeoutMs) return false;

    if (cur.crossing === null) {
      // Being in the zone implies the hand is at the arrival radius, so an
      // arrival has normally been noted already. This covers the one case
      // rounding can produce: resting exactly on the zone's inner edge.
      const i = cur.reach.tMs.length - 1;
      const cursor = applyCursorTransform(this.hand, ZERO, cur.appliedRotationDeg);
      cur.completionMs = cur.reach.tMs[i];
      cur.crossing = {
        tMs: cur.reach.tMs[i],
        handX: this.hand.x,
        handY: this.hand.y,
        cursorX: cur.cursorVisible ? cursor.x : null,
        cursorY: cur.cursorVisible ? cursor.y : null,
        radius: this.arrivalR,
        sampleIndex: i,
      };
    }
    this.registerReach(t, registeredAt);
    return true;
  }

  private registerReach(t: number, registeredAt: number): void {
    const cur = this.current!;
    cur.holdCompleted = true;
    cur.holdCompletionMs = registeredAt;
    cur.reachEndMs = t;
    cur.outcome = 'completed';
    this.targetHoldStartMs = null;
    this.phase = 'feedback';
  }

  private timeoutReach(t: number): void {
    const cur = this.current!;
    cur.reachEndMs = t;
    cur.outcome = 'timeout';
    this.targetHoldStartMs = null;
    this.notice = 'timeout';
    this.phase = 'feedback';
  }

  /** Close the current attempt's record and move to the next trial (or repeat this one). */
  private finishAttempt(t: number): void {
    const cur = this.current!;
    const record: AttemptRecord<T> = {
      trial: this.trials[this.position],
      trialPosition: this.position,
      attempt: this.attempt,
      outcome: cur.outcome!,
      holdCompleted: cur.holdCompleted,
      appliedRotationDeg: cur.appliedRotationDeg,
      cursorVisibleDuringReach: cur.cursorVisible,
      startAnchorOffset: cur.startAnchorOffset,
      times: {
        acquireStartMs: cur.acquireStartMs,
        holdStartMs: cur.holdStartMs,
        goCueMs: cur.goCueMs,
        movementOnsetMs: cur.movementOnsetMs,
        completionMs: cur.completionMs,
        holdCompletionMs: cur.holdCompletionMs,
        reachEndMs: cur.reachEndMs,
        attemptEndMs: t,
      },
      crossing: cur.crossing,
      reach: cur.reach,
      preReach: cur.pre,
      postReach: emptyPath(),
    };
    this.records.push(record);

    // Rule 4 — jump home. The virtual hand and the cursor are both placed on the
    // start position, instantly. Wherever the physical mouse now is simply
    // becomes "the centre", so there is no return movement to make or record.
    this.hand = { x: 0, y: 0 };
    this.cursor = { x: 0, y: 0 };

    const repeat =
      record.outcome === 'interrupted' ||
      (record.outcome === 'timeout' && this.config.repeatOnTimeout === true);
    if (repeat) {
      this.attempt += 1;
    } else {
      this.position += 1;
      this.attempt = 1;
      this.completedCount += 1;
    }

    if (this.position >= this.trials.length) {
      this.phase = 'finished';
      this.current = null;
    } else {
      this.beginAttempt(t);
      // The cursor is already on the centre, so the next dwell starts at once.
      this.updateCentering(t);
    }
  }
}

function pushPath(path: PathSamples, t: number, dx: number, dy: number, p: Vec2): void {
  path.tMs.push(t);
  path.dx.push(dx);
  path.dy.push(dy);
  path.x.push(p.x);
  path.y.push(p.y);
}

function pushReach(reach: ReachSamples, t: number, dx: number, dy: number, hand: Vec2, cursor: Vec2): void {
  reach.tMs.push(t);
  reach.dx.push(dx);
  reach.dy.push(dy);
  reach.handX.push(hand.x);
  reach.handY.push(hand.y);
  // Cursor columns exist only when the cursor was actually displayed.
  if (reach.cursorX && reach.cursorY) {
    reach.cursorX.push(cursor.x);
    reach.cursorY.push(cursor.y);
  }
}

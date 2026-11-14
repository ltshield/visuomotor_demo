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
 *      │                                       hand crosses the target │
 *      │                                       distance, or timeout    ▼
 *      └────────────────feedbackHoldMs elapsed──────────────────── feedback
 *
 *   acquire / hold  Cursor visible, identity mapping (cursor = hand).
 *   reach           Outward movement. cursor = start + R(θ)·(hand − start).
 *                   The cursor is drawn only if the trial's feedback is
 *                   'visible'; the hand is recorded either way.
 *   feedback        Brief pause. On visible trials the cursor stays frozen at
 *                   the point where it crossed the target distance.
 *
 * Three rules keep the transformation honest:
 *   1. ANCHOR AT GO: when the target appears, the virtual hand and the cursor
 *      are both reset to the exact start position, so the rotation always
 *      pivots about the centre and directions are measured from one origin.
 *   2. COMPLETE BY HAND DISTANCE: a reach ends when the *hand* reaches the
 *      target distance (rotation preserves distance, so the cursor is at that
 *      distance too). It never depends on hitting something that may be hidden.
 *   3. RE-ANCHOR ON RETURN: when the return begins, the virtual hand is moved
 *      to where the cursor was last drawn. The visible cursor therefore never
 *      jumps, and no rotated offset leaks into the return or the next trial.
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
  type Vec2,
} from './geometry';
import type { FeedbackMode, MovementCriteria, TaskGeometry, TaskTiming } from './presets';

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
 * completed   — the hand crossed the target distance in time.
 * timeout     — time ran out first; recorded, metrics withheld, trial not repeated
 *               (except in practice mode).
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

/** Samples of the outward reach, stored column-wise (one entry per input event). */
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

/** Samples of a movement made under the identity mapping (return, hold, post-reach). */
export interface PathSamples {
  tMs: number[];
  dx: number[];
  dy: number[];
  x: number[];
  y: number[];
}

/** The interpolated instant at which the hand crossed the target distance. */
export interface CrossingPoint {
  tMs: number;
  handX: number;
  handY: number;
  /** Where the cursor was frozen; null when the cursor was hidden. */
  cursorX: number | null;
  cursorY: number | null;
}

export interface AttemptTimes {
  /** This attempt began (start of the return-to-centre phase). */
  acquireStartMs: number;
  /** Start of the final, successful centred hold. */
  holdStartMs: number | null;
  /** Target appeared and the hand was anchored: the start of the outward reach. */
  goCueMs: number | null;
  /** Hand first reached `criteria.onsetFraction` of the target distance (interpolated). */
  movementOnsetMs: number | null;
  /** Hand crossed the target distance (interpolated between samples). */
  completionMs: number | null;
  /** The reach phase ended: the completing sample, the timeout, or the interruption. */
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
  /** The rotation actually used in the cursor transformation on this attempt. */
  appliedRotationDeg: number;
  cursorVisibleDuringReach: boolean;
  /** Small cursor offset from the exact centre that was removed when the reach was anchored. */
  startAnchorOffset: Vec2;
  times: AttemptTimes;
  crossing: CrossingPoint | null;
  reach: ReachSamples;
  /** Return-to-centre and hold movement before the go cue (identity mapping). */
  preReach: PathSamples;
  /** Hand movement during the post-reach pause, continuing the reach's hand coordinates. */
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
  reachEndMs: number | null;
  outcome: ReachOutcome | null;
  appliedRotationDeg: number;
  cursorVisible: boolean;
  startAnchorOffset: Vec2;
  crossing: CrossingPoint | null;
  /** Where the visible cursor resumes from when the return begins (rule 3). */
  returnAnchor: Vec2;
  reach: ReachSamples;
  pre: PathSamples;
  post: PathSamples;
}

const emptyPath = (): PathSamples => ({ tMs: [], dx: [], dy: [], x: [], y: [] });

export class TrialEngine<T extends EngineTrial = EngineTrial> {
  private readonly trials: readonly T[];
  private readonly config: EngineConfig;

  private now: number;
  private phase: EnginePhase;
  private position = 0;
  private attempt = 1;
  private completedCount = 0;

  /** Virtual unperturbed hand position (wu, relative to the start). */
  private hand: Vec2;
  /** Position at which the cursor is drawn (or would be, if hidden). */
  private cursor: Vec2;

  private holdStartMs: number | null = null;
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
        const prev = this.hand;
        const prevT = cur.reach.tMs[cur.reach.tMs.length - 1];
        this.hand = add(prev, delta); // unclamped: the hand is recorded as it really moved
        this.cursor = applyCursorTransform(this.hand, ZERO, cur.appliedRotationDeg);
        pushReach(cur.reach, t, dx, dy, this.hand, this.cursor);

        const g = this.config.geometry;
        if (cur.movementOnsetMs === null) {
          const onsetRadius = this.config.criteria.onsetFraction * g.targetDistance;
          const f = segmentCircleCrossing(prev, this.hand, onsetRadius);
          if (f !== null) cur.movementOnsetMs = prevT + f * (t - prevT);
        }

        // Rule 2: completion is judged on the HAND's distance from the start.
        const f = segmentCircleCrossing(prev, this.hand, g.targetDistance);
        if (f !== null) this.completeReach(t, prev, prevT, f);
        break;
      }

      case 'feedback': {
        // The reach is over and the cursor is frozen, but the hand usually
        // overshoots. Keep logging it so nothing is silently discarded.
        this.hand = add(this.hand, delta);
        pushPath(cur.post, t, dx, dy, this.hand);
        break;
      }

      case 'paused':
      case 'finished':
        break; // the pointer is not captured; stray movement is ignored
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
      cur.returnAnchor = cur.cursorVisible ? this.cursor : this.hand;
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

  /** Pointer lock is back. The trial restarts from the return-to-centre phase. */
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

    let holdFraction = 0;
    if (this.phase === 'hold' && this.holdStartMs !== null) {
      const holdMs = this.config.timing.holdMs;
      holdFraction = holdMs > 0 ? Math.min(1, (this.now - this.holdStartMs) / holdMs) : 1;
    }

    // The target stays lit through the feedback pause on visible trials, so the
    // frozen cursor can be compared with it. On hidden trials it switches off
    // at completion, which doubles as a neutral "reach registered" signal.
    let activeTargetIndex: number | null = null;
    if (trial && (this.phase === 'reach' || (this.phase === 'feedback' && visibleTrial))) {
      activeTargetIndex = trial.targetIndex;
    }

    return {
      phase: this.phase,
      cursor: { x: this.cursor.x, y: this.cursor.y },
      cursorVisible: this.phase === 'finished' ? false : inReach ? visibleTrial : true,
      activeTargetIndex,
      holdFraction,
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
      reachEndMs: null,
      outcome: null,
      appliedRotationDeg: trial.rotationDeg,
      cursorVisible: visible,
      startAnchorOffset: ZERO,
      crossing: null,
      returnAnchor: this.cursor,
      reach: { tMs: [], dx: [], dy: [], handX: [], handY: [], cursorX: visible ? [] : null, cursorY: visible ? [] : null },
      pre: emptyPath(),
      post: emptyPath(),
    };
    this.phase = 'acquire';
    this.holdStartMs = null;
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
    this.notice = null;
    // The first sample is the anchored start itself, stamped with the go-cue time.
    pushReach(cur.reach, t, 0, 0, this.hand, this.cursor);
  }

  private completeReach(t: number, prev: Vec2, prevT: number, f: number): void {
    const cur = this.current!;
    // Interpolate the exact crossing of the target distance between the last
    // two samples, so the endpoint does not depend on the mouse's report rate.
    const crossingHand = lerp(prev, this.hand, f);
    const crossingT = prevT + f * (t - prevT);
    const crossingCursor = applyCursorTransform(crossingHand, ZERO, cur.appliedRotationDeg);

    cur.completionMs = crossingT;
    cur.reachEndMs = t;
    cur.outcome = 'completed';
    cur.crossing = {
      tMs: crossingT,
      handX: crossingHand.x,
      handY: crossingHand.y,
      cursorX: cur.cursorVisible ? crossingCursor.x : null,
      cursorY: cur.cursorVisible ? crossingCursor.y : null,
    };

    // Freeze the drawn cursor on the ring where it crossed (endpoint feedback).
    this.cursor = crossingCursor;
    cur.returnAnchor = cur.cursorVisible ? crossingCursor : crossingHand;
    this.phase = 'feedback';
  }

  private timeoutReach(t: number): void {
    const cur = this.current!;
    cur.reachEndMs = t;
    cur.outcome = 'timeout';
    cur.returnAnchor = cur.cursorVisible ? this.cursor : this.hand;
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
      appliedRotationDeg: cur.appliedRotationDeg,
      cursorVisibleDuringReach: cur.cursorVisible,
      startAnchorOffset: cur.startAnchorOffset,
      times: {
        acquireStartMs: cur.acquireStartMs,
        holdStartMs: cur.holdStartMs,
        goCueMs: cur.goCueMs,
        movementOnsetMs: cur.movementOnsetMs,
        completionMs: cur.completionMs,
        reachEndMs: cur.reachEndMs,
        attemptEndMs: t,
      },
      crossing: cur.crossing,
      reach: cur.reach,
      preReach: cur.pre,
      postReach: cur.post,
    };
    this.records.push(record);

    // Rule 3 — re-anchor on return. From here the mapping is the identity, so
    // put the virtual hand where the cursor was last shown (or, on a hidden
    // trial, where the hand ended). Nothing rotated carries forward.
    this.hand = this.confine(cur.returnAnchor);
    this.cursor = this.hand;

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

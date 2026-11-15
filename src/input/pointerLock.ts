/**
 * pointerLock.ts — relative mouse input through the Pointer Lock API.
 *
 * Pointer Lock hides the operating-system pointer and delivers *relative*
 * movement (`movementX` / `movementY`) with no screen edges to stop at, which
 * is what a virtual cursor needs. Nothing about the OS mouse settings is
 * changed: we only read the movement the browser reports.
 *
 * Responsibilities:
 *   - request / release the lock (requests must come from a user gesture);
 *   - forward each movement with the event's own high-resolution timestamp
 *     (`event.timeStamp`, the same monotonic timeline as `performance.now()`),
 *     so timing never depends on rendering frames;
 *   - report loss of the lock or of window focus so the task can pause.
 *
 * EVENT SOURCE. Exactly one DOM event type supplies movement, chosen once:
 * `pointermove` where Pointer Events exist (every supported browser), else
 * `mousemove`. Browsers deliver one such event per display frame, but a
 * `pointermove` also carries the individual hardware reports it was built
 * from (`getCoalescedEvents()`, typically 125–1000 per second, each with its
 * own timestamp). We use those sub-samples for denser trajectories — but only
 * when they add up to the event's own total, so the recorded movement can
 * never disagree with what the browser reported for the event as a whole.
 * Using a single event type means a movement is never counted twice.
 *
 * Key exports: `PointerLockInput`, `toWorkspaceDelta`, `splitMovement`,
 * `sanitizeTimestamp`, `getPointerInput`.
 */

import type { InterruptReason } from '../core/engine';

export interface PointerInputListener {
  /** Relative movement in CSS pixels, browser convention (+x right, +y DOWN), with the event time in ms. */
  onMove?(movementX: number, movementY: number, tMs: number): void;
  onLockChange?(locked: boolean): void;
  /** A lock request failed; `message` is safe to show to the participant. */
  onLockError?(message: string): void;
  /** The lock or window focus was lost without the app asking for it. */
  onInterruption?(reason: InterruptReason, tMs: number): void;
  /** A mouse button was pressed while the pointer was locked. */
  onButtonDown?(tMs: number): void;
}

export type MoveEventSource = 'pointermove' | 'mousemove';

/** Minimal shape of a movement event (a MouseEvent, PointerEvent or coalesced sub-event). */
export interface MovementSample {
  movementX: number;
  movementY: number;
  timeStamp: number;
}

/**
 * Convert a browser movement (y-down, CSS px) into a workspace delta (y-up, wu).
 * This is the single place where the screen's y axis is flipped on input.
 */
export function toWorkspaceDelta(movementX: number, movementY: number, gain: number): { dx: number; dy: number } {
  return {
    dx: movementX * gain,
    dy: movementY === 0 ? 0 : -movementY * gain, // avoid producing −0
  };
}

/** How far an event timestamp may sit from "now" and still be believed (ms). */
const MAX_TIMESTAMP_SKEW_MS = 10_000;

/**
 * Event timestamps should be on the same monotonic timeline as
 * `performance.now()`. If one is wildly off (a browser reporting wall-clock
 * time, for instance), fall back to the current time rather than let a bogus
 * value jump the task's clock and freeze its timers.
 */
export function sanitizeTimestamp(eventTimeStamp: number, nowMs: number): number {
  if (!Number.isFinite(eventTimeStamp)) return nowMs;
  return Math.abs(eventTimeStamp - nowMs) <= MAX_TIMESTAMP_SKEW_MS ? eventTimeStamp : nowMs;
}

/** Largest disagreement (CSS px, per axis) tolerated between an event's total and the sum of its parts. */
const COALESCED_SUM_TOLERANCE = 1;

/**
 * Decide which samples to record for one movement event.
 *
 * `parts` are the event's coalesced sub-events. They are used only if there is
 * more than one and their movements sum to the event's own movement (within
 * rounding); otherwise the event is recorded as a single sample. Either way
 * the total movement recorded equals the browser's total for the event.
 */
export function splitMovement(event: MovementSample, parts: readonly MovementSample[]): MovementSample[] {
  if (parts.length > 1) {
    let sumX = 0;
    let sumY = 0;
    for (const p of parts) {
      sumX += p.movementX;
      sumY += p.movementY;
    }
    const consistent =
      Number.isFinite(sumX) &&
      Number.isFinite(sumY) &&
      Math.abs(sumX - event.movementX) <= COALESCED_SUM_TOLERANCE &&
      Math.abs(sumY - event.movementY) <= COALESCED_SUM_TOLERANCE;
    if (consistent) return parts.slice();
  }
  return [event];
}

export class PointerLockInput {
  private listener: PointerInputListener = {};
  /** Set when the app itself releases the lock, so that is not reported as an interruption. */
  private releasing = false;
  private attached = false;

  /** The DOM event type that supplies movement. Fixed for the lifetime of the page. */
  readonly source: MoveEventSource;
  /** Movement events handled while locked, and the samples they yielded (≥ events when sub-samples are used). */
  eventCount = 0;
  sampleCount = 0;

  constructor(private readonly target: HTMLElement) {
    this.source = typeof window !== 'undefined' && 'PointerEvent' in window ? 'pointermove' : 'mousemove';
  }

  static isSupported(): boolean {
    return (
      typeof document !== 'undefined' &&
      'pointerLockElement' in document &&
      typeof Element.prototype.requestPointerLock === 'function'
    );
  }

  setListener(listener: PointerInputListener): void {
    this.listener = listener;
    this.attach();
  }

  clearListener(): void {
    this.listener = {};
  }

  isLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /**
   * Ask the browser to capture the mouse. MUST be called synchronously from a
   * user gesture (a click or key press) or the browser will refuse. Success is
   * reported through `onLockChange(true)`, failure through `onLockError`.
   */
  request(): void {
    this.attach();
    if (this.isLocked()) return;
    try {
      // Newer browsers return a promise; older ones return undefined and rely
      // solely on the pointerlockchange / pointerlockerror events.
      const result: unknown = this.target.requestPointerLock();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err: unknown) => this.reportError(err));
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  /** Give the mouse back deliberately (e.g. when the task is finished). */
  release(): void {
    if (!this.isLocked()) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('pointerlockerror', this.handleLockError);
    document.addEventListener(this.source, this.handleMove as EventListener);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('blur', this.handleBlur);
  }

  /** Remove every DOM listener. Used by tests; the app keeps one instance for its lifetime. */
  dispose(): void {
    this.release();
    this.listener = {};
    if (!this.attached) return;
    this.attached = false;
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    document.removeEventListener('pointerlockerror', this.handleLockError);
    document.removeEventListener(this.source, this.handleMove as EventListener);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('blur', this.handleBlur);
  }

  private handleMove = (e: MouseEvent | PointerEvent): void => {
    if (!this.isLocked()) return;
    const parts =
      'getCoalescedEvents' in e && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    this.eventCount += 1;
    const now = performance.now();
    for (const s of splitMovement(e, parts)) {
      if (s.movementX === 0 && s.movementY === 0) continue;
      if (!Number.isFinite(s.movementX) || !Number.isFinite(s.movementY)) continue;
      this.sampleCount += 1;
      this.listener.onMove?.(s.movementX, s.movementY, sanitizeTimestamp(s.timeStamp, now));
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.isLocked()) this.listener.onButtonDown?.(e.timeStamp);
  };

  private handleLockChange = (): void => {
    const locked = this.isLocked();
    if (locked) {
      this.releasing = false;
      this.listener.onLockChange?.(true);
      return;
    }
    const deliberate = this.releasing;
    this.releasing = false;
    this.listener.onLockChange?.(false);
    // Esc, Alt-Tab, a system dialog…: anything other than our own release().
    if (!deliberate) this.listener.onInterruption?.('pointer-lock-lost', performance.now());
  };

  private handleLockError = (): void => {
    this.reportError(null);
  };

  private handleBlur = (): void => {
    // Some blur events are momentary (focus moving within the page). Only a
    // window that has really lost focus stops the task.
    if (typeof document.hasFocus === 'function' && document.hasFocus()) return;
    this.listener.onInterruption?.('window-blur', performance.now());
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.listener.onInterruption?.('tab-hidden', performance.now());
    }
  };

  private reportError(err: unknown): void {
    const name = err instanceof Error ? err.name : '';
    if (name) console.warn('Pointer lock request failed:', err);
    // Chrome briefly refuses to re-lock right after Esc; a second click a moment later works.
    this.listener.onLockError?.(
      name === 'NotSupportedError'
        ? 'This browser could not capture the mouse. Please use a recent desktop version of Chrome or Edge.'
        : 'The browser did not capture the mouse. Wait a second, then click the button again.',
    );
  }
}

let shared: PointerLockInput | null = null;

/** The app-wide input instance. It locks to <body>, so it survives screen changes. */
export function getPointerInput(): PointerLockInput {
  if (!shared) shared = new PointerLockInput(document.body);
  return shared;
}

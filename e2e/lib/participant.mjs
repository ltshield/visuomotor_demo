/**
 * participant.mjs — a simulated participant for full-browser tests.
 *
 * Drives the real app in a real Chromium browser through the DevTools mouse
 * API, so the events are "trusted" and travel the same path as a physical
 * mouse: Pointer Lock → pointermove → trial engine → recording.
 *
 * The participant only uses what a person could see on screen (which target
 * is lit, where the dot is, whether it is visible). It reads those from the
 * page's DOM; it has no access to the schedule, rotation or condition.
 *
 * NOTE: this is synthesized input. It verifies the software end to end, but it
 * is not a substitute for a person using a physical mouse.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toRad = (deg) => (deg * Math.PI) / 180;

/** Wrap an angle in degrees into (−180, 180]. */
export function wrapDeg(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export class Participant {
  /**
   * @param {import('playwright-core').Page} page
   * @param {{ targetDistance?: number, stepDelayMs?: number }} [options]
   */
  constructor(page, options = {}) {
    this.page = page;
    this.targetDistance = options.targetDistance ?? 240;
    this.stepDelayMs = options.stepDelayMs ?? 8;
    // Position of the synthetic mouse in page coordinates. Under Pointer Lock
    // only the DIFFERENCE between successive positions matters, and positions
    // may leave the viewport freely.
    this.pos = { x: 400, y: 300 };
  }

  /** What is currently on screen, as a person would perceive it. */
  async look() {
    return this.page.evaluate(() => {
      const task = document.querySelector('.task');
      if (!task) return null;
      const dot = task.querySelector('.cursor-dot');
      const lit = task.querySelector('.target.is-active');
      return {
        stage: task.getAttribute('data-stage'),
        phase: task.getAttribute('data-engine-phase'),
        locked: !!document.pointerLockElement,
        cursor: {
          x: Number(dot.getAttribute('cx')),
          y: Number(dot.getAttribute('cy')),
          visible: dot.style.visibility !== 'hidden',
        },
        targetAngle: lit ? Number(lit.getAttribute('data-angle')) : null,
        overlay: !!task.querySelector('.task-overlay'),
        message: task.querySelector('.task-message')?.textContent ?? '',
      };
    });
  }

  /** Poll until `predicate(look())` is true; returns that observation. */
  async waitFor(predicate, description, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const seen = await this.look();
      if (seen && predicate(seen)) return seen;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${description}. Last seen: ${JSON.stringify(seen)}`);
      }
      await sleep(10);
    }
  }

  /** Establish a known mouse position right after the pointer has been captured. */
  async settle() {
    await this.page.mouse.move(Math.round(this.pos.x), Math.round(this.pos.y));
    await sleep(30);
  }

  /**
   * Move the mouse by a workspace-frame displacement (+dx right, +dy UP),
   * spread over `steps` events. Positions are rounded to whole pixels as a real
   * mouse reports whole counts; rounding errors do not accumulate.
   */
  async moveBy(dx, dy, steps = 12, stepDelayMs = this.stepDelayMs) {
    const start = { ...this.pos };
    for (let i = 1; i <= steps; i++) {
      this.pos.x = start.x + (dx * i) / steps;
      this.pos.y = start.y - (dy * i) / steps; // screen y points down
      await this.page.mouse.move(Math.round(this.pos.x), Math.round(this.pos.y));
      if (stepDelayMs > 0) await sleep(stepDelayMs);
    }
  }

  /** Bring the dot to the centre ring and hold until a target lights up. Returns the observation at the go cue. */
  async centerAndWaitForGo() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const seen = await this.waitFor(
        (s) => s.phase === 'acquire' || s.phase === 'hold' || s.phase === 'reach',
        'the dot to be controllable',
      );
      if (seen.phase === 'reach') return seen;
      const offCentre = Math.hypot(seen.cursor.x, seen.cursor.y);
      if (offCentre > 4) {
        const steps = Math.max(4, Math.min(16, Math.round(offCentre / 20)));
        await this.moveBy(-seen.cursor.x, -seen.cursor.y, steps);
      } else {
        await sleep(40);
      }
    }
    throw new Error('Could not acquire the centre');
  }

  /**
   * Make one straight outward movement with the hand aimed along
   * `handAngleDeg` (degrees counterclockwise from screen-right).
   */
  async reach(handAngleDeg, { distance = this.targetDistance * 1.1, steps = 28 } = {}) {
    const a = toRad(handAngleDeg);
    await this.moveBy(Math.cos(a) * distance, Math.sin(a) * distance, steps);
  }

  /** Click the (captured) mouse button without moving. */
  async click() {
    await this.page.mouse.down();
    await this.page.mouse.up();
  }
}

/**
 * A minimal error-driven learner. It keeps one number, `aim` (degrees added to
 * the target direction when reaching). After a reach with visible feedback it
 * looks at where the dot crossed relative to the target and shifts its aim
 * against that error; without feedback its aim slowly relaxes toward zero.
 * This is a test fixture for producing known, structured data — not a model of
 * human learning.
 */
export class SimpleLearner {
  constructor({ learningRate = 0.3, retention = 0.97 } = {}) {
    this.learningRate = learningRate;
    this.retention = retention;
    this.aim = 0;
  }

  /** @param {number|null} cursorErrorDeg signed error seen on this trial, or null if the dot was hidden */
  update(cursorErrorDeg) {
    if (cursorErrorDeg !== null) this.aim -= this.learningRate * cursorErrorDeg;
    this.aim *= this.retention;
  }
}

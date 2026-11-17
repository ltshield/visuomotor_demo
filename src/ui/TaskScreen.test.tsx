// @vitest-environment jsdom
/**
 * Task screen wiring tests: DOM mouse events → trial engine → what is drawn,
 * and the recovery prompts. Pointer Lock itself does not exist in the test DOM,
 * so it is stubbed as "always captured"; the real thing is exercised by the
 * browser run in e2e/full-session.mjs.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SUDDEN_45_V3 } from '../core/presets';
import { generateSchedule } from '../core/schedule';
import { getPointerInput } from '../input/pointerLock';
import { getSoundCues } from './sound';
import { TaskScreen } from './TaskScreen';

beforeAll(() => {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => document.body });
  Element.prototype.requestPointerLock = vi.fn() as unknown as Element['requestPointerLock'];
  document.exitPointerLock = vi.fn();
});

afterEach(() => {
  cleanup();
  getSoundCues().setMuted(false);
});

function renderTask() {
  const schedule = generateSchedule(SUDDEN_45_V3, 9);
  const view = render(<TaskScreen preset={SUDDEN_45_V3} schedule={schedule} onComplete={() => {}} onQuit={() => {}} />);
  const root = view.container.querySelector('.task') as HTMLElement;
  const dot = view.container.querySelector('.cursor-dot') as SVGCircleElement;
  return { ...view, root, dot, phase: () => root.getAttribute('data-engine-phase') };
}

/** Dispatch one relative mouse movement the way the browser would while the pointer is captured. */
function moveMouse(movementX: number, movementY: number) {
  const event = new Event(getPointerInput().source, { bubbles: true });
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  document.body.dispatchEvent(event);
}

const dotPosition = (dot: SVGCircleElement) => ({ x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) });

describe('mouse input reaches the workspace', () => {
  it('moves the dot by the mouse movement, with screen-down mapped to workspace-down', async () => {
    const { dot, phase } = renderTask();
    await waitFor(() => expect(phase()).toBe('acquire'));
    const before = dotPosition(dot);

    moveMouse(12, -7); // 12 px right, 7 px UP on screen
    await waitFor(() => expect(dotPosition(dot).x).toBe(before.x + 12));
    // Workspace y points up, so an upward mouse movement increases y.
    expect(dotPosition(dot).y).toBe(before.y + 7);
  });

  it('starts the hold when the dot is brought into the centre ring', async () => {
    const { dot, phase } = renderTask();
    await waitFor(() => expect(phase()).toBe('acquire'));
    const { x, y } = dotPosition(dot);
    moveMouse(-x, y); // workspace +y is screen-up, so undo y with a screen-down movement
    await waitFor(() => expect(phase()).toBe('hold'));
    expect(dotPosition(dot)).toEqual({ x: 0, y: 0 });
  });
});

describe('hold on the target, then jump home', () => {
  /** Bring the dot to the centre and wait for the first practice target to light. */
  async function reachTheGoCue(dot: SVGCircleElement, phase: () => string | null) {
    await waitFor(() => expect(phase()).toBe('acquire'));
    const { x, y } = dotPosition(dot);
    moveMouse(-x, y);
    await waitFor(() => expect(phase()).toBe('reach'), { timeout: 2000 });
  }

  it('marks the target while the dot is held in it, pulses it when the reach registers, then puts the dot back on the centre', async () => {
    const { container, dot, phase } = renderTask();
    await reachTheGoCue(dot, phase);
    const lit = container.querySelector('.target.is-active') as SVGCircleElement;
    expect(lit).not.toBeNull();
    expect(lit.classList.contains('is-holding')).toBe(false);

    // Move the dot straight onto the lit target (screen y is down, workspace y is up).
    moveMouse(Number(lit.getAttribute('cx')), -Number(lit.getAttribute('cy')));
    await waitFor(() => expect(lit.classList.contains('is-holding')).toBe(true));
    expect(phase()).toBe('reach'); // not registered yet: it has to be held

    await waitFor(() => expect(phase()).toBe('feedback'), { timeout: 2000 });
    expect(lit.classList.contains('is-confirmed')).toBe(true);
    expect(lit.classList.contains('is-active')).toBe(true);

    // After the short pause the dot is at the centre and the next dwell is already running.
    await waitFor(() => expect(phase()).toBe('hold'), { timeout: 2000 });
    expect(dotPosition(dot)).toEqual({ x: 0, y: 0 });
    expect(lit.classList.contains('is-active')).toBe(false);
    expect(lit.classList.contains('is-confirmed')).toBe(false);
    expect(container.querySelector('.task-label')?.textContent).toBe('Practice · reach 2 of 6');
  });

  it('does not register when the dot only passes through the target', async () => {
    const { container, dot, phase } = renderTask();
    await reachTheGoCue(dot, phase);
    const lit = container.querySelector('.target.is-active') as SVGCircleElement;
    const tx = Number(lit.getAttribute('cx'));
    const ty = Number(lit.getAttribute('cy'));
    moveMouse(tx, -ty); // onto the target...
    moveMouse(tx * 0.3, -ty * 0.3); // ...and straight out the far side
    await new Promise((resolve) => setTimeout(resolve, 600)); // longer than the hold
    expect(phase()).toBe('reach');
    expect(lit.classList.contains('is-holding')).toBe(false);
  });
});

describe('sound control', () => {
  it('toggles with the M key, which works while the mouse is captured, and with a click', () => {
    const { container } = renderTask();
    const toggle = container.querySelector('.sound-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(document, { key: 'm' });
    expect(getSoundCues().muted).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('Sound off · press M to turn on');

    fireEvent.keyDown(document, { key: 'M' });
    expect(getSoundCues().muted).toBe(false);
    expect(toggle.textContent).toBe('Sound on · press M to mute');

    fireEvent.click(toggle);
    expect(getSoundCues().muted).toBe(true);
  });

  it('ignores M pressed with a modifier and auto-repeat', () => {
    renderTask();
    fireEvent.keyDown(document, { key: 'm', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'm', repeat: true });
    expect(getSoundCues().muted).toBe(false);
  });

  it('is silent and harmless where Web Audio is unavailable', () => {
    const sound = getSoundCues();
    expect(() => {
      sound.unlock();
      sound.dwellTick();
      sound.confirm();
    }).not.toThrow();
  });
});

describe('recovery when the task pauses while the mouse is still captured', () => {
  it('shows a click-to-continue prompt and resumes on a mouse click', async () => {
    const { phase } = renderTask();
    await waitFor(() => expect(phase()).toBe('acquire'));

    // The tab is hidden (so the task must pause) but the browser keeps the pointer captured.
    const realVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(phase()).toBe('paused'));
    await waitFor(() => expect(screen.getByText('Click the mouse button to continue.')).toBeTruthy());

    // Movement while paused is ignored.
    moveMouse(50, 50);
    expect(phase()).toBe('paused');

    // Restore visibility, then click: the task continues.
    if (realVisibility) Object.defineProperty(document, 'visibilityState', realVisibility);
    else delete (document as unknown as Record<string, unknown>).visibilityState;
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await waitFor(() => expect(phase()).toBe('acquire'));
    await waitFor(() => expect(screen.queryByText('Click the mouse button to continue.')).toBeNull());
  });
});

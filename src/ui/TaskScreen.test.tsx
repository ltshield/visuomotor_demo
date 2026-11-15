// @vitest-environment jsdom
/**
 * Task screen wiring tests: DOM mouse events → trial engine → what is drawn,
 * and the recovery prompts. Pointer Lock itself does not exist in the test DOM,
 * so it is stubbed as "always captured"; the real thing is exercised by the
 * browser run in e2e/full-session.mjs.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SUDDEN_45_V1 } from '../core/presets';
import { generateSchedule } from '../core/schedule';
import { getPointerInput } from '../input/pointerLock';
import { TaskScreen } from './TaskScreen';

beforeAll(() => {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => document.body });
  Element.prototype.requestPointerLock = vi.fn() as unknown as Element['requestPointerLock'];
  document.exitPointerLock = vi.fn();
});

afterEach(cleanup);

function renderTask() {
  const schedule = generateSchedule(SUDDEN_45_V1, 9);
  const view = render(<TaskScreen preset={SUDDEN_45_V1} schedule={schedule} onComplete={() => {}} onQuit={() => {}} />);
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

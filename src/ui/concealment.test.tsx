// @vitest-environment jsdom
/**
 * Concealment tests: nothing a participant sees before the debrief may reveal
 * the design. These render the real components and scan what is on the page.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GRADUAL_45_V3, SUDDEN_45_V3 } from '../core/presets';
import { generateSchedule } from '../core/schedule';
import { Instructor } from './Instructor';
import { Reflection } from './Reflection';
import { TASK_MESSAGES, TaskScreen } from './TaskScreen';
import { Welcome } from './Welcome';

/** Words that would give the design away if shown before the debrief. */
const REVEALING =
  /rotat|\b45\b|sudden|gradual|abrupt|catch|after-?effect|adaptation|adapt\b|baseline|perturb|washout|condition|preset|ramp|null trial|version [ab]\b/i;

beforeAll(() => {
  // jsdom has no Pointer Lock; provide just enough for the support check to pass.
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
  Element.prototype.requestPointerLock = vi.fn() as unknown as Element['requestPointerLock'];
});

afterEach(cleanup);

describe('Welcome screen', () => {
  it('reveals nothing about the design', () => {
    const { container } = render(<Welcome quickDemo={false} onStart={() => {}} />);
    expect(container.textContent).not.toMatch(REVEALING);
    expect(container.innerHTML).not.toMatch(/k7m2|p4x9/);
  });

  it('covers the required points: mouse requirement, changing feedback, local recording, Start', () => {
    render(<Welcome quickDemo={false} onStart={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/physical mouse/i);
    expect(text).toMatch(/behave differently, or disappear/i);
    expect(text).toMatch(/only in this browser tab/i);
    expect(text).toMatch(/Nothing is uploaded/i);
    expect(text).toMatch(/Chrome or Edge/i);
    const start = screen.getByRole('button', { name: 'Start' });
    expect((start as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts when Start is clicked', () => {
    const onStart = vi.fn();
    render(<Welcome quickDemo={false} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('gives a time estimate that fits the length of the session, and nothing else about it', () => {
    for (const [tier, minutes] of [
      ['quick', '3 to 5'],
      ['standard', '5 to 10'],
      ['extended', '8 to 12'],
    ] as const) {
      const { container } = render(<Welcome quickDemo={false} tier={tier} onStart={() => {}} />);
      expect(container.textContent).toContain(`It takes about ${minutes} minutes in total.`);
      expect(container.textContent).not.toMatch(REVEALING);
      // A custom link is not announced as anything special before the debrief.
      expect(screen.queryByTestId('quick-demo-badge')).toBeNull();
      expect(container.textContent).not.toMatch(/custom/i);
      cleanup();
    }
  });

  it('describes reaching to a target, holding, and the jump back', () => {
    const { container } = render(<Welcome quickDemo={false} onStart={() => {}} />);
    expect(container.textContent).toMatch(/out to a target and hold\s+it there; it then jumps back to the center/);
  });

  it('labels the Quick Demo clearly without revealing its content', () => {
    const { container } = render(<Welcome quickDemo onStart={() => {}} />);
    expect(screen.getByTestId('quick-demo-badge').textContent).toMatch(/Quick Demo/);
    expect(container.textContent).not.toMatch(REVEALING);
  });

  it('does not warn about embedding when opened in its own tab', () => {
    render(<Welcome quickDemo={false} onStart={() => {}} />);
    expect(screen.queryByTestId('framed-notice')).toBeNull();
  });

  it('offers to open in a new tab when embedded inside another page', () => {
    const realTop = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
    try {
      const { container } = render(<Welcome quickDemo={false} onStart={() => {}} />);
      const notice = screen.getByTestId('framed-notice');
      expect(notice.textContent).toMatch(/open the activity in its own tab/);
      expect(notice.querySelector('a')?.getAttribute('target')).toBe('_blank');
      expect(container.textContent).not.toMatch(REVEALING);
    } finally {
      if (realTop) Object.defineProperty(window, 'top', realTop);
    }
  });

  it('offers an unobtrusive link to the instructor page', () => {
    render(<Welcome quickDemo={false} onStart={() => {}} />);
    expect(screen.getByRole('link', { name: 'For instructors' }).getAttribute('href')).toBe('/instructor');
  });
});

describe('Task screen', () => {
  it('every on-screen instruction is neutral', () => {
    for (const message of Object.values(TASK_MESSAGES)) {
      expect(message).not.toMatch(REVEALING);
    }
  });

  it('the instructions describe holding on the target and the jump back to the center', () => {
    expect(TASK_MESSAGES['reach-first']).toMatch(/hold it there until the target flashes/);
    expect(TASK_MESSAGES.center).toMatch(/jumps back to the center/);
    expect(TASK_MESSAGES['hidden-reach']).toMatch(/hold still until it flashes/);
    // Nothing still tells people to slice through a target.
    for (const message of Object.values(TASK_MESSAGES)) expect(message).not.toMatch(/slice|through it/i);
  });

  it('offers a sound control that names its key and gives nothing away', () => {
    const { container } = render(
      <TaskScreen preset={SUDDEN_45_V3} schedule={generateSchedule(SUDDEN_45_V3, 3)} onComplete={() => {}} onQuit={() => {}} />,
    );
    const toggle = container.querySelector('.sound-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toBe('Sound on · press M to mute');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).not.toMatch(REVEALING);
  });

  for (const preset of [SUDDEN_45_V3, GRADUAL_45_V3]) {
    it(`renders nothing that identifies ${preset.id}`, () => {
      const schedule = generateSchedule(preset, 3);
      const { container } = render(
        <TaskScreen preset={preset} schedule={schedule} onComplete={() => {}} onQuit={() => {}} />,
      );
      // Neither visible text nor markup (attributes, class names) mentions the design.
      expect(container.textContent).not.toMatch(REVEALING);
      expect(container.innerHTML).not.toMatch(/sudden|gradual|baseline|adaptation|aftereffect|catch|rotat/i);
      // All eight targets and the centre ring are drawn.
      expect(container.querySelectorAll('circle.target')).toHaveLength(8);
      expect(container.querySelectorAll('circle.start-ring')).toHaveLength(1);
    });
  }

  it('renders identical markup for the sudden and gradual presets', () => {
    const a = render(
      <TaskScreen
        preset={SUDDEN_45_V3}
        schedule={generateSchedule(SUDDEN_45_V3, 3)}
        onComplete={() => {}}
        onQuit={() => {}}
      />,
    );
    const htmlA = a.container.innerHTML;
    a.unmount();
    const b = render(
      <TaskScreen
        preset={GRADUAL_45_V3}
        schedule={generateSchedule(GRADUAL_45_V3, 3)}
        onComplete={() => {}}
        onQuit={() => {}}
      />,
    );
    expect(b.container.innerHTML).toBe(htmlA);
  });
});

describe('Reflection screen', () => {
  it('asks before revealing anything and can be skipped', () => {
    const onDone = vi.fn();
    const { container } = render(<Reflection onDone={onDone} />);
    expect(container.textContent).not.toMatch(REVEALING);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledWith({
      skipped: true,
      noticed: '',
      consciousAdjustment: null,
      changedAim: null,
      device: null,
    });
  });

  it('asks the strategy-awareness question with its four answers, after the open question', () => {
    const { container } = render(<Reflection onDone={() => {}} />);
    const legends = [...container.querySelectorAll('legend')].map((el) => el.textContent);
    expect(legends[0]).toBe('Did you consciously try to adjust where you aimed during the task?');
    const group = container.querySelectorAll('fieldset')[0];
    expect([...group.querySelectorAll('label')].map((el) => el.textContent)).toEqual(['Yes', 'Somewhat', 'No', 'I’m not sure']);
    // It comes after the free-text box and before the buttons.
    const order = [...container.querySelectorAll('textarea, fieldset, button')].map((el) => el.tagName);
    expect(order).toEqual(['TEXTAREA', 'FIELDSET', 'FIELDSET', 'BUTTON', 'BUTTON']);
    // The near-duplicate question from schema 1 is gone.
    expect(container.textContent).not.toMatch(/deliberately change how you aimed/i);
  });

  it('records each answer as its own value', () => {
    for (const [label, value] of [
      ['Yes', 'yes'],
      ['Somewhat', 'somewhat'],
      ['No', 'no'],
      ['I’m not sure', 'unsure'],
    ]) {
      const onDone = vi.fn();
      render(<Reflection onDone={onDone} />);
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
      expect(onDone.mock.calls[0][0].consciousAdjustment).toBe(value);
      cleanup();
    }
  });

  it('leaves the answer null when the question is not answered', () => {
    const onDone = vi.fn();
    render(<Reflection onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
    expect(onDone.mock.calls[0][0]).toMatchObject({ skipped: false, consciousAdjustment: null, changedAim: null });
  });

  it('collects the answers when submitted', () => {
    const onDone = vi.fn();
    render(<Reflection onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Did anything seem to change/), {
      target: { value: '  The dot went sideways.  ' },
    });
    fireEvent.click(screen.getByLabelText('Somewhat'));
    fireEvent.click(screen.getByLabelText('Mouse'));
    fireEvent.click(screen.getByRole('button', { name: 'Show my results' }));
    expect(onDone).toHaveBeenCalledWith({
      skipped: false,
      noticed: 'The dot went sideways.',
      consciousAdjustment: 'somewhat',
      changedAim: null,
      device: 'mouse',
    });
  });
});

describe('Instructor page', () => {
  // The panel itself is covered in Instructor.test.tsx; here, only that it hides the design.
  it('keeps the design behind a confirmation', () => {
    const { container } = render(<Instructor />);
    expect(container.textContent).not.toMatch(/\b45\b|k7m2|p4x9|rotation-sudden/);
    expect(screen.getByRole('link', { name: 'Back to the activity' }).getAttribute('href')).toBe('/');
  });

  it('after confirmation shows the preset definitions and copyable links', () => {
    render(<Instructor />);
    fireEvent.click(screen.getByRole('button', { name: /I am an instructor/ }));
    const text = document.body.textContent ?? '';
    expect(text).toContain('rotation-sudden-45-v3');
    expect(text).toContain('rotation-gradual-45-v3');
    expect(text).toContain('rotation-quickdemo-45-v3');
    expect(text).toMatch(/6\.43°/); // the gradual ramp step is spelled out

    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    const base = `${window.location.origin}/`;
    expect(value('Random assignment link address')).toBe(base);
    expect(value('Sudden 45° link address')).toBe(`${base}?c=k7m2`);
    expect(value('Gradual 0°→45° link address')).toBe(`${base}?c=p4x9`);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
  });
});

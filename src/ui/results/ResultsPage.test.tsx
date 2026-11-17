// @vitest-environment jsdom
/**
 * Results page tests. Chart internals need a real layout engine and are
 * checked by the browser run (e2e/full-session.mjs); here we check what the
 * page says and offers: the reveal, the debrief, the participant-only data,
 * the tables, the inspector and the downloads.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../core/record';
import type { TrialSpec } from '../../core/schedule';
import { assignPreset } from '../../core/assignment';
import { encodeSettings, type InstructorSettings } from '../../core/custom';
import { buildSessionRecord } from '../../core/record';
import { createSessionPlan } from '../../core/session';
import { runScriptedSession, scriptedSessionRecord, taskResultFrom } from '../../core/testUtils';
import { catchInterpretation } from './CatchCallout';
import { METRIC_INFO } from './InfoNote';
import { catchCallout } from './model';
import { ResultsPage } from './ResultsPage';

vi.mock('../download', () => ({ downloadText: vi.fn() }));
import { downloadText } from '../download';

const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);
const sudden = scriptedSessionRecord('k7m2', aim);
const gradual = scriptedSessionRecord('p4x9', aim);
const demo = scriptedSessionRecord('demo', aim);

/** A complete scripted session run through a custom link built from instructor settings. */
function customSession(settings: InstructorSettings): SessionRecord {
  const plan = createSessionPlan({
    assignment: assignPreset(null, () => 0, encodeSettings(settings)),
    seed: 77,
    sessionId: 'custom-session',
    previousPresetIds: [],
    now: new Date('2026-11-14T15:30:00.000Z'),
  });
  const { engine, driver } = runScriptedSession(plan.preset, plan.schedule, aim);
  return buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);
}

function renderResults(session: SessionRecord, onTryOther = vi.fn()) {
  const other =
    session.preset.id === 'rotation-sudden-45-v2'
      ? 'Gradual 0°→45° rotation'
      : session.preset.id === 'rotation-gradual-45-v2'
        ? 'Sudden 45° rotation'
        : null;
  const view = render(<ResultsPage session={session} otherVersionLabel={other} onTryOther={onTryOther} />);
  return { ...view, onTryOther, text: () => view.container.textContent ?? '' };
}

afterEach(() => {
  cleanup();
  vi.mocked(downloadText).mockClear();
});

describe('reveal', () => {
  it('names the condition and how the rotation was introduced (sudden)', () => {
    const { text } = renderResults(sudden);
    expect(screen.getByTestId('revealed-condition').textContent).toBe('Sudden 45° rotation');
    expect(text()).toContain('rotated +45° (counterclockwise) all at once, on every one of the 22 non-catch reaches');
    expect(text()).toContain('It was set by the link you opened.');
  });

  it('describes the ramp for the gradual condition', () => {
    const { text } = renderResults(gradual);
    expect(screen.getByTestId('revealed-condition').textContent).toBe('Gradual 0°→45° rotation');
    expect(text()).toContain('grew from 0° to +45° (counterclockwise) in 7 equal steps of about 6.43°');
    expect(text()).toContain('then stayed at +45° for the remaining 14');
  });

  it('says when the condition was assigned at random', () => {
    const random: SessionRecord = {
      ...sudden,
      assignment: { ...sudden.assignment, method: 'random-50-50', linkCode: null },
    };
    expect(renderResults(random).text()).toContain('chosen at random (a 50/50 coin flip) when you pressed Start');
  });

  it('shows the actual completion time and how many reaches were analysed', () => {
    const { text } = renderResults(sudden);
    expect(text()).toMatch(/Time taken\d+ min \d+ s from pressing Start to your last reach/);
    expect(text()).toContain('Reaches analysed40 of 40');
  });

  it('labels the Quick Demo and does not offer another condition', () => {
    const { text } = renderResults(demo);
    expect(text()).toContain('Quick Demo: a shortened version, not comparable with the standard activity');
    expect(screen.queryByRole('button', { name: 'Try the other version' })).toBeNull();
  });

  it('warns about carry-over on a repeat run', () => {
    const second: SessionRecord = { ...gradual, runNumber: 2, previousPresetIds: ['rotation-sudden-45-v2'] };
    const { text } = renderResults(second);
    expect(text()).toContain('This was run 2 of this visit');
    expect(text()).toContain('the two runs are not a fair comparison of the versions');
  });
});

describe('catch trial callout', () => {
  /** The session with its first catch trial (20) given a chosen initial direction, or no usable value. */
  function withFirstCatch(session: SessionRecord, value: number | null): SessionRecord {
    return {
      ...session,
      summary: {
        ...session.summary,
        catchTrials: session.summary.catchTrials.map((c, i) => (i === 0 ? { ...c, valueDeg: value } : c)),
      },
    };
  }

  it('sits near the top: after the reveal and before the first chart', () => {
    renderResults(sudden);
    const callout = screen.getByTestId('catch-callout');
    const reveal = screen.getByTestId('reveal');
    const firstChart = document.querySelector('.viz-card') as HTMLElement;
    expect(reveal.compareDocumentPosition(callout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(callout.compareDocumentPosition(firstChart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the trial and gives the value with its sign and direction in words', () => {
    renderResults(withFirstCatch(sudden, -48.5));
    const callout = screen.getByTestId('catch-callout');
    expect(callout.textContent).toContain('On trial 20, the rotation was secretly removed without warning.');
    expect(screen.getByTestId('catch-callout-value').textContent).toBe('−48.5° (clockwise)');
    expect(callout.textContent).toContain('Your hand deviated −48.5° (clockwise) — most or all of the 45° it takes to cancel the rotation.');
    expect(callout.textContent).toContain('your aiming had recalibrated');
    // The mechanism is left open: one reach cannot separate strategy from implicit recalibration.
    expect(callout.textContent).toContain('whether through a deliberate strategy, through recalibration you were not aware of, or both');
    expect(callout.textContent).toContain('your baseline reaches, before any rotation, averaged +3° (counterclockwise)');
  });

  it('does not claim recalibration when the reach does not show it', () => {
    renderResults(withFirstCatch(sudden, 1.2));
    const text = screen.getByTestId('catch-callout').textContent ?? '';
    expect(text).toContain('Your hand deviated +1.2° (counterclockwise) — close to where your reaches pointed before any rotation was applied.');
    expect(text).toContain('showed little sign of still compensating');
    expect(text).not.toMatch(/had recalibrated|fully/);
  });

  it('describes a partial shift as partial', () => {
    renderResults(withFirstCatch(sudden, -20));
    const text = screen.getByTestId('catch-callout').textContent ?? '';
    expect(text).toContain('part of the way toward the 45° it takes to cancel the rotation');
    expect(text).not.toMatch(/most or all|had recalibrated/);
  });

  it('shows the second catch trial, and says so, when the first has no usable value', () => {
    renderResults(withFirstCatch(sudden, null));
    const text = screen.getByTestId('catch-callout').textContent ?? '';
    expect(text).toContain('On trial 28, the rotation was secretly removed without warning.');
    expect(text).toContain('The earlier catch trial (trial 20) had no usable value, so this later one is shown instead.');
  });

  it('is omitted when no catch trial has a usable value', () => {
    const none: SessionRecord = {
      ...sudden,
      summary: { ...sudden.summary, catchTrials: sudden.summary.catchTrials.map((c) => ({ ...c, valueDeg: null })) },
    };
    renderResults(none);
    expect(screen.queryByTestId('catch-callout')).toBeNull();
  });

  it('has a wording for every level, none of which predicts or guarantees an effect', () => {
    const base = catchCallout(sudden)!;
    for (const level of ['full', 'partial', 'little', 'opposite', null] as const) {
      const { tail, detail } = catchInterpretation({ ...base, level });
      expect(tail.length).toBeGreaterThan(10);
      expect(`${tail} ${detail}`).not.toMatch(/you (adapted|learned)|your brain|guarantee|will see/i);
    }
  });
});

describe('metric explanations', () => {
  const note = (term: string) => screen.getAllByRole('button', { name: term });

  it('offers a collapsed explanation for each metric, where that metric is shown', () => {
    renderResults(sudden);
    expect(note('Initial direction error').length).toBe(2); // the per-trial chart and the summary table
    expect(note('Catch trial error').length).toBe(3); // the callout, the per-trial chart and the catch charts
    expect(note('Late rotated reaches that look like baseline')).toHaveLength(1);
    expect(note('Path efficiency')).toHaveLength(1);
    expect(note('Movement time')).toHaveLength(1);
    // All collapsed to begin with.
    for (const button of document.querySelectorAll('.info-button')) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
    expect(document.querySelector('.info-text')).toBeNull();
  });

  it('opens and closes on click', () => {
    const { text } = renderResults(sudden);
    const button = note('Path efficiency')[0];
    expect(text()).not.toContain('1.0 = a perfectly straight line');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('1.0 = a perfectly straight line from the start to where the reach arrived');
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.textContent).toContain('curved path');
    fireEvent.click(button);
    expect(text()).not.toContain('1.0 = a perfectly straight line');
  });

  it('explains each metric in plain language', () => {
    const { text } = renderResults(sudden);
    for (const button of document.querySelectorAll('.info-button')) fireEvent.click(button);
    expect(text()).toContain('measured a quarter of the way to the target, before you had time to course-correct');
    expect(text()).toContain('Negative = clockwise of the target, positive = counterclockwise');
    expect(text()).toContain('this does NOT mean you stopped adapting');
    expect(text()).toContain('your hand error matched what it would take to cancel the rotation');
    expect(text()).toContain('the rotation was secretly removed for a single reach');
    expect(text()).toContain('It is not a measure of learning');
    expect(Object.keys(METRIC_INFO)).toHaveLength(5);
  });

  it('leaves out the catch-trial note when the session has no catch trials', () => {
    const none: SessionRecord = {
      ...sudden,
      schedule: sudden.schedule.map((t) => ({ ...t, isCatch: false })),
      trials: sudden.trials.map((t) => ({ ...t, isCatch: false })),
      summary: { ...sudden.summary, catchTrials: [] },
    };
    renderResults(none);
    expect(screen.queryAllByRole('button', { name: 'Catch trial error' })).toHaveLength(0);
    expect(note('Initial direction error').length).toBe(2);
  });

  it('adds path efficiency and movement time to the summary and the per-reach table', () => {
    renderResults(sudden);
    const table = document.querySelector('.summary-table') as HTMLElement;
    const headers = [...table.querySelectorAll('thead th')].map((el) => el.textContent);
    expect(headers).toContain('Path efficiency (mean)');
    expect(headers).toContain('Movement time (mean)');
    const baseline = within(table).getByRole('row', { name: /^Baseline reaches/ }).textContent ?? '';
    expect(baseline).toContain('1.00'); // the scripted reaches are straight
    expect(baseline).toMatch(/\d+ ms/);
    const trialHeaders = [...document.querySelectorAll('.trial-table thead th')].map((el) => el.textContent);
    expect(trialHeaders).toContain('Hand path efficiency');
  });
});

describe('strategy-awareness answer', () => {
  const answered = (value: 'yes' | 'somewhat' | 'no' | 'unsure' | null, skipped = false): SessionRecord => ({
    ...sudden,
    reflection: { skipped, noticed: '', consciousAdjustment: value, changedAim: null, device: null },
  });

  it('shows the participant’s own answer in the debrief, with the note', () => {
    for (const [value, label] of [
      ['yes', 'Yes'],
      ['somewhat', 'Somewhat'],
      ['no', 'No'],
      ['unsure', 'I’m not sure'],
    ] as const) {
      const { unmount } = renderResults(answered(value));
      const box = screen.getByTestId('strategy-answer');
      expect(document.querySelector('.debrief')?.contains(box)).toBe(true);
      expect(box.textContent).toContain('“Did you consciously try to adjust where you aimed during the task?”');
      expect(box.textContent).toContain(`You answered: ${label}.`);
      expect(box.textContent).toContain(
        'Explicit (conscious) strategies and implicit recalibration can both contribute to adaptation — and both can produce aftereffects.',
      );
      unmount();
    }
  });

  it('says so when the question was skipped or left blank, and still shows the note', () => {
    for (const session of [answered(null), answered(null, true), { ...sudden, reflection: null }]) {
      const { unmount } = renderResults(session);
      const box = screen.getByTestId('strategy-answer');
      expect(box.textContent).toContain('You did not answer this question.');
      expect(box.textContent).toContain('both can produce aftereffects');
      unmount();
    }
  });
});

describe('custom protocols', () => {
  const custom = customSession({ schedule: 'sudden', angleDeg: 30, tier: 'standard', aftereffect: 'hidden', catchTrials: true });
  const bare = customSession({ schedule: 'gradual', angleDeg: 60, tier: 'quick', aftereffect: 'visible', catchTrials: false });

  it('are labelled as custom on the results page, with their own id', () => {
    const { text } = renderResults(custom);
    expect(screen.getByTestId('custom-badge').textContent).toBe(
      'Custom protocol: set up by your instructor, not comparable with the standard versions',
    );
    expect(screen.getByTestId('revealed-condition').textContent).toBe('Custom: sudden 30° rotation');
    expect(text()).toContain('rotated +30° (counterclockwise) all at once');
    expect(text()).toContain('It was set by the link you opened, which your instructor set up.');
    expect(text()).toContain('Custom protocol: rotation-sudden-30-custom-v2');
    expect(text()).toContain('This was a custom protocol set up by your instructor (rotation-sudden-30-custom-v2)');
    expect(text()).toContain('should not be compared or pooled with theirs');
  });

  it('are not offered “the other version” and are not called a Quick Demo', () => {
    const { text } = renderResults(custom);
    expect(screen.queryByRole('button', { name: 'Try the other version' })).toBeNull();
    expect(text()).not.toContain('Quick Demo');
    expect(text()).not.toContain('other people did the');
  });

  it('standard sessions carry no custom label', () => {
    renderResults(sudden);
    expect(screen.queryByTestId('custom-badge')).toBeNull();
  });

  it('scale the callout to the chosen angle', () => {
    renderResults(custom);
    // Scripted aim on the catch trial is −35° against a baseline of +3°: more than the 30° rotation.
    expect(screen.getByTestId('catch-callout').textContent).toContain('most or all of the 30° it takes to cancel the rotation');
  });

  it('with catch trials off: no callout, no catch panels, no catch explanations', () => {
    const { text } = renderResults(bare);
    expect(screen.queryByTestId('catch-callout')).toBeNull();
    const titles = [...document.querySelectorAll('.path-panel figcaption strong')].map((el) => el.textContent);
    expect(titles).toEqual(['Baseline', 'First rotated reaches', 'Last rotated reaches', 'First aftereffect reach']);
    expect(screen.queryAllByRole('button', { name: 'Catch trial error' })).toHaveLength(0);
    expect(text()).not.toContain('Catch trials up close');
    expect(text()).not.toMatch(/Catch trials? \(trial/);
    expect(document.querySelector('.viz-legend')?.textContent).not.toBeNull();
  });

  it('with a visible-cursor aftereffect block: says so, and explains what that does', () => {
    const { text } = renderResults(bare);
    expect(text()).toContain('this time the cursor stayed visible while you reached');
    expect(text()).toContain('those reaches were themselves washing the change out');
    expect(text()).not.toContain('the cursor hidden again');
    // The chart's block label reports the cursor as visible in the aftereffect block.
    expect(text()).toContain('Baseline (trials 1–4).');
    expect(text()).toContain('Aftereffect block (trials 13–16).');
  });
});

describe('debrief', () => {
  it('explains adaptation, the removed transformation, catch trials and aftereffects', () => {
    const { text } = renderResults(sudden);
    expect(text()).toContain('visuomotor adaptation');
    expect(text()).toContain('Catch trials (trials 20 and 28).');
    expect(text()).toContain('The rotation was removed for good and the cursor hidden again');
    expect(text()).toContain('aftereffects');
    expect(text()).toContain('Baseline (trials 1–8).');
    expect(text()).toContain('Rotation block (trials 9–32).');
    expect(text()).toContain('Aftereffect block (trials 33–40).');
  });

  it('says strategy and implicit recalibration can both contribute, and explains washout', () => {
    const { text } = renderResults(sudden);
    expect(text()).toMatch(/deliberate strategy/);
    expect(text()).toMatch(/implicit recalibration/);
    expect(text()).toContain('Both can contribute');
    expect(text()).toContain('Washout is the gradual return toward baseline once normal feedback is restored');
    expect(text()).toContain('There was no separate washout block here');
  });

  it('is honest that a short session may show little or nothing', () => {
    const { text } = renderResults(sudden);
    expect(text()).toContain('some show little or no measurable adaptation or aftereffect');
    expect(text()).toContain('teaching defaults, not an optimized research protocol');
  });

  it('does not predict or guarantee an aftereffect', () => {
    const { text } = renderResults(sudden);
    expect(text()).not.toMatch(/you (adapted|learned|showed an aftereffect)|your aftereffect (was|is)|you will see/i);
    expect(text()).toContain('would appear');
  });

  it('follows the Quick Demo schedule in its trial numbers', () => {
    const { text } = renderResults(demo);
    expect(text()).toContain('Baseline (trials 1–4).');
    expect(text()).toContain('Catch trial (trial 10).');
    expect(text()).toContain('This was the Quick Demo');
  });
});

describe('participant-only data', () => {
  it('shows no class, population or other-people results and makes no significance claims', () => {
    for (const session of [sudden, gradual, demo]) {
      const { text, unmount } = renderResults(session);
      expect(text()).not.toMatch(
        /class (average|mean|results)|population (average|mean)|other (students|participants) (scored|averaged|showed)|percentile|typical participant|p\s*[<=]\s*0?\.\d|statistically significant|significantly/i,
      );
      unmount();
    }
  });

  it('states that one person’s data cannot compare the versions', () => {
    expect(renderResults(sudden).text()).toContain('One person’s data cannot show whether the two versions differ');
  });
});

describe('numbers and tables', () => {
  it('summarises the participant’s own reaches', () => {
    renderResults(sudden);
    const table = document.querySelector('.summary-table') as HTMLElement;
    const row = (label: string) => within(table).getByRole('row', { name: new RegExp(`^${label}`) }).textContent ?? '';
    expect(row('Baseline reaches')).toContain('1–8');
    expect(row('Baseline reaches')).toContain('+3°');
    expect(row('First rotated reaches')).toContain('9–12');
    expect(row('Last rotated reaches')).toContain('−35°');
    expect(row('Catch trial 1')).toContain('20');
    expect(row('Catch trial 2')).toContain('28');
    expect(row('First aftereffect reach')).toContain('−18°');
    // Relative to baseline: −18 − 3 = −21.
    expect(row('First aftereffect reach')).toContain('−21°');
    expect(row('All aftereffect reaches')).toContain('8 of 8');
  });

  it('provides a table view with every reach', () => {
    renderResults(sudden);
    const rows = document.querySelectorAll('.trial-table tbody tr');
    expect(rows).toHaveLength(40);
    expect(rows[19].textContent).toContain('catch');
    expect(rows[19].className).toContain('is-catch');
    expect(rows[0].textContent).toContain('hidden');
  });

  it('reports invalid reaches instead of hiding them', () => {
    const withTimeout: SessionRecord = {
      ...sudden,
      trials: sudden.trials.map((t) =>
        t.trialNumber === 5
          ? {
              ...t,
              outcome: 'timeout' as const,
              valid: false,
              invalidReason: 'timeout',
              crossing: null,
              metrics: { ...t.metrics, valid: false, nullReason: 'timeout' as const, hand: null, cursor: null },
            }
          : t,
      ),
      summary: { ...sudden.summary, trialsValid: 39, trialsTimedOut: 1 },
    };
    const { text } = renderResults(withTimeout);
    expect(text()).toContain('Reaches analysed39 of 40 (1 timed out before reaching the target distance)');
    expect(text()).toContain('No value is plotted for trial 5 (timed out).');
    expect(document.querySelectorAll('.trial-table tbody tr')[4].textContent).toContain('timed out');
  });

  it('says when a reach was analysed although its hold never registered', () => {
    const unregistered: SessionRecord = {
      ...sudden,
      trials: sudden.trials.map((t) =>
        t.trialNumber === 20 ? { ...t, outcome: 'timeout' as const, holdCompleted: false } : t,
      ),
    };
    const { text } = renderResults(unregistered);
    expect(text()).toContain('Reaches analysed40 of 40');
    expect(text()).toContain('On 1 of the analysed reaches the time limit arrived before the hold on the target registered');
    // The catch trial is still plotted and summarised: its outward reach was complete.
    const table = document.querySelector('.summary-table') as HTMLElement;
    expect(within(table).getByRole('row', { name: /^Catch trial 1/ }).textContent).toContain('−35°');
    fireEvent.change(screen.getByLabelText('Trial number'), { target: { value: '20' } });
    expect(document.querySelector('.inspector-details')?.textContent).toContain(
      'Reached the target distance, but time ran out before the hold registered',
    );
  });
});

describe('movement overlays and the hand / cursor switch', () => {
  it('draws every required panel with the recorded paths', () => {
    renderResults(sudden);
    const titles = [...document.querySelectorAll('.path-panel figcaption strong')].map((el) => el.textContent);
    expect(titles).toEqual([
      'Baseline',
      'First rotated reaches',
      'Last rotated reaches',
      'Catch trial 1',
      'Catch trial 2',
      'First aftereffect reach',
    ]);
    // 8 + 4 + 4 + (2 + 1) + (2 + 1) + (8 + 1) paths.
    expect(document.querySelectorAll('.path-panel polyline.path-hit')).toHaveLength(31);
  });

  it('switching to the cursor view changes the charts and explains missing cursor paths', () => {
    const { text } = renderResults(sudden);
    expect(text()).toContain('What you did: initial hand direction on every reach');
    fireEvent.click(screen.getByRole('button', { name: 'The cursor as displayed' }));
    expect(text()).toContain('What you did: initial cursor direction on every reach');
    expect(text()).toContain('The cursor was hidden on these reaches');
    // Only reaches made with a visible cursor have a cursor path: 4 + 4 + 3 + 3.
    expect(document.querySelectorAll('.path-panel polyline.path-hit')).toHaveLength(14);
    expect(screen.getByRole('button', { name: 'The cursor as displayed' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('labels the limits of comparing catch trials with reaches to other targets', () => {
    const { text } = renderResults(sudden);
    expect(text()).toContain('Limits of this comparison.');
    expect(text()).toContain('went to different targets');
  });
});

describe('trial inspector', () => {
  it('steps through individual reaches', () => {
    renderResults(sudden);
    const label = () => document.querySelector('.inspector-slider span')?.textContent;
    expect(label()).toBe('Trial 1 of 40');
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(label()).toBe('Trial 2 of 40');
    fireEvent.change(screen.getByLabelText('Trial number'), { target: { value: '20' } });
    expect(label()).toBe('Trial 20 of 40');
    const details = document.querySelector('.inspector-details')?.textContent ?? '';
    expect(details).toContain('Rotation block · catch trial');
    expect(details).toContain('Cursor rotation0°');
    expect(details).toContain('Initial hand direction−35° (35° clockwise)');
  });

  it('opens the reach whose path is clicked in an overlay panel', () => {
    renderResults(sudden);
    const latePanel = document.querySelectorAll('.path-panel')[2];
    fireEvent.click(latePanel.querySelectorAll('polyline.path-hit')[0]);
    expect(document.querySelector('.inspector-slider span')?.textContent).toBe('Trial 29 of 40');
  });

  it('says so when the cursor was hidden', () => {
    renderResults(sudden);
    expect(document.querySelector('#trial-inspector')?.textContent).toContain(
      'The cursor was hidden during this reach, so only the hand path exists.',
    );
  });

  it('shows the outward reach and, separately, what followed arrival', () => {
    renderResults(sudden);
    fireEvent.change(screen.getByLabelText('Trial number'), { target: { value: '12' } });
    const inspector = document.querySelector('#trial-inspector') as HTMLElement;
    // A rotated reach: the hand and the cursor each have a dashed after-arrival line.
    expect(inspector.querySelectorAll('polyline.inspector-after')).toHaveLength(2);
    expect(inspector.textContent).toContain('After arriving: steering onto the target and holding (not measured)');
    expect(inspector.textContent).toContain('The round marker is where the hand first got as far out as the target');
    const details = document.querySelector('.inspector-details')?.textContent ?? '';
    expect(details).toContain('OutcomeRegistered: cursor held on the target');
    expect(details).toMatch(/Hold registered\d+ ms after the target lit/);
    expect(details).toContain('Hand direction on arrival−35° (35° clockwise)');
  });

  it('describes a registered hidden-cursor reach by distance, not by hitting the target', () => {
    renderResults(sudden);
    const details = document.querySelector('.inspector-details')?.textContent ?? '';
    expect(details).toContain('OutcomeRegistered: hand held at the target distance');
  });
});

describe('downloads and next steps', () => {
  it('offers the session JSON and both CSV files', () => {
    renderResults(sudden);
    fireEvent.click(screen.getByRole('button', { name: 'Download session file (JSON)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download one row per reach (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download one row per mouse sample (CSV)' }));

    const calls = vi.mocked(downloadText).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      'motor-learning_rotation-sudden-45-v2_20261114-1530_session.json',
      'motor-learning_rotation-sudden-45-v2_20261114-1530_trials.csv',
      'motor-learning_rotation-sudden-45-v2_20261114-1530_events.csv',
    ]);
    expect(calls.map((c) => c[2])).toEqual(['application/json', 'text/csv', 'text/csv']);
    const saved = JSON.parse(calls[0][1]) as SessionRecord;
    expect(saved.sessionId).toBe(sudden.sessionId);
    expect(saved.trials).toHaveLength(40);
    expect(calls[1][1].split('\n')[0]).toContain('hand_initial_direction_error_deg');
    expect(calls[2][1].split('\n')[0]).toContain('hand_lateral');
  });

  it('says the data stays in the browser', () => {
    const { text } = renderResults(sudden);
    expect(text()).toContain('Your results exist only in this browser tab');
    expect(text()).toContain('Nothing has been sent anywhere');
  });

  it('offers the other condition only after the debrief, with a carry-over note', () => {
    const { text, onTryOther } = renderResults(sudden);
    expect(text()).toContain('The other standard version is Gradual 0°→45° rotation');
    expect(text()).toContain('carry-over can change what happens');
    fireEvent.click(screen.getByRole('button', { name: 'Try the other version' }));
    expect(onTryOther).toHaveBeenCalledTimes(1);
  });
});

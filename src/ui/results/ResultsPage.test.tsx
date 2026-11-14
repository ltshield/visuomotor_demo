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
import { scriptedSessionRecord } from '../../core/testUtils';
import { ResultsPage } from './ResultsPage';

vi.mock('../download', () => ({ downloadText: vi.fn() }));
import { downloadText } from '../download';

const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);
const sudden = scriptedSessionRecord('k7m2', aim);
const gradual = scriptedSessionRecord('p4x9', aim);
const demo = scriptedSessionRecord('demo', aim);

function renderResults(session: SessionRecord, onTryOther = vi.fn()) {
  const other =
    session.preset.id === 'rotation-sudden-45-v1'
      ? 'Gradual 0°→45° rotation'
      : session.preset.id === 'rotation-gradual-45-v1'
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
    const second: SessionRecord = { ...gradual, runNumber: 2, previousPresetIds: ['rotation-sudden-45-v1'] };
    const { text } = renderResults(second);
    expect(text()).toContain('This was run 2 of this visit');
    expect(text()).toContain('the two runs are not a fair comparison of the versions');
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
    expect(text()).toContain('Reaches analysed39 of 40 (1 timed out)');
    expect(text()).toContain('No value is plotted for trial 5 (timed out).');
    expect(document.querySelectorAll('.trial-table tbody tr')[4].textContent).toContain('timed out');
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
});

describe('downloads and next steps', () => {
  it('offers the session JSON and both CSV files', () => {
    renderResults(sudden);
    fireEvent.click(screen.getByRole('button', { name: 'Download session file (JSON)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download one row per reach (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download one row per mouse sample (CSV)' }));

    const calls = vi.mocked(downloadText).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      'motor-learning_rotation-sudden-45-v1_20261114-1530_session.json',
      'motor-learning_rotation-sudden-45-v1_20261114-1530_trials.csv',
      'motor-learning_rotation-sudden-45-v1_20261114-1530_events.csv',
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

/**
 * Reflection.tsx — optional questions asked after the task and BEFORE the
 * reveal, so answers are not coloured by knowing what happened. Skippable.
 * Answers stay in the browser and are saved inside the session data file.
 * One exception, by the participant's own later choice: if they share an
 * anonymous summary with their class, the strategy answer goes with it. The
 * free-text answer and the device answer are never sent anywhere.
 *
 * The strategy-awareness question replaces schema 1's "Did you deliberately
 * change how you aimed?": it asks the same thing with a graded answer.
 *
 * Key exports: `Reflection`, `ADJUSTMENT_CHOICES`.
 */

import { useState, type FormEvent } from 'react';
import type { ConsciousAdjustment, ReflectionAnswers } from '../core/session';

interface ReflectionProps {
  onDone: (answers: ReflectionAnswers) => void;
}

/** The strategy-awareness question and its answers, shared with the debrief so both show the same words. */
export const ADJUSTMENT_QUESTION = 'Did you consciously try to adjust where you aimed during the task?';

export const ADJUSTMENT_CHOICES: Array<{ value: ConsciousAdjustment; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'somewhat', label: 'Somewhat' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'I’m not sure' },
];

const DEVICE_CHOICES: Array<{ value: NonNullable<ReflectionAnswers['device']>; label: string }> = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'trackpad', label: 'Trackpad' },
  { value: 'other', label: 'Something else' },
];

export function Reflection({ onDone }: ReflectionProps) {
  const [noticed, setNoticed] = useState('');
  const [consciousAdjustment, setConsciousAdjustment] = useState<ConsciousAdjustment | null>(null);
  const [device, setDevice] = useState<ReflectionAnswers['device']>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone({ skipped: false, noticed: noticed.trim(), consciousAdjustment, changedAim: null, device });
  };

  return (
    <main className="page">
      <h1>All done. Before you see your results…</h1>
      <p className="lede">
        Three quick, optional questions. Answer from memory, before anything is explained. Your answers stay on this
        device and are saved with your own data file. (If you later choose to share an anonymous summary with your
        class, only your answer to the second question is included.)
      </p>

      <form className="card" onSubmit={submit}>
        <div style={{ marginBottom: 18 }}>
          <label className="field-label" htmlFor="noticed">
            Did anything seem to change during the task? Describe what you noticed.
          </label>
          <textarea
            id="noticed"
            rows={3}
            value={noticed}
            onChange={(e) => setNoticed(e.target.value)}
            placeholder="A sentence or two is plenty."
          />
        </div>

        <fieldset>
          <legend>{ADJUSTMENT_QUESTION}</legend>
          <div className="choice-row">
            {ADJUSTMENT_CHOICES.map((c) => (
              <label key={c.value}>
                <input
                  type="radio"
                  name="consciousAdjustment"
                  checked={consciousAdjustment === c.value}
                  onChange={() => setConsciousAdjustment(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>What did you use to move the dot?</legend>
          <div className="choice-row">
            {DEVICE_CHOICES.map((c) => (
              <label key={c.value}>
                <input type="radio" name="device" checked={device === c.value} onChange={() => setDevice(c.value)} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="button-row">
          <button type="submit" className="button primary">
            Show my results
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              onDone({ skipped: true, noticed: '', consciousAdjustment: null, changedAim: null, device: null })
            }
          >
            Skip
          </button>
        </div>
      </form>
    </main>
  );
}

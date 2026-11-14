/**
 * Reflection.tsx — optional questions asked after the task and BEFORE the
 * reveal, so answers are not coloured by knowing what happened. Skippable.
 * Answers stay in the browser and are saved inside the session data file.
 *
 * Key export: `Reflection`.
 */

import { useState, type FormEvent } from 'react';
import type { ReflectionAnswers } from '../core/session';

interface ReflectionProps {
  onDone: (answers: ReflectionAnswers) => void;
}

const AIM_CHOICES: Array<{ value: NonNullable<ReflectionAnswers['changedAim']>; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

const DEVICE_CHOICES: Array<{ value: NonNullable<ReflectionAnswers['device']>; label: string }> = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'trackpad', label: 'Trackpad' },
  { value: 'other', label: 'Something else' },
];

export function Reflection({ onDone }: ReflectionProps) {
  const [noticed, setNoticed] = useState('');
  const [changedAim, setChangedAim] = useState<ReflectionAnswers['changedAim']>(null);
  const [device, setDevice] = useState<ReflectionAnswers['device']>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone({ skipped: false, noticed: noticed.trim(), changedAim, device });
  };

  return (
    <main className="page">
      <h1>All done. Before you see your results…</h1>
      <p className="lede">
        Three quick, optional questions. Answer from memory, before anything is explained. Your answers stay on this
        device and are saved with your own data file.
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
          <legend>Did you deliberately change how you aimed at any point?</legend>
          <div className="choice-row">
            {AIM_CHOICES.map((c) => (
              <label key={c.value}>
                <input
                  type="radio"
                  name="changedAim"
                  checked={changedAim === c.value}
                  onChange={() => setChangedAim(c.value)}
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
            onClick={() => onDone({ skipped: true, noticed: '', changedAim: null, device: null })}
          >
            Skip
          </button>
        </div>
      </form>
    </main>
  );
}

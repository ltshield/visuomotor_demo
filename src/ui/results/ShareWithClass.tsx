/**
 * ShareWithClass.tsx — the opt-in section at the bottom of the results page
 * that adds an anonymous summary of this session to a class view.
 *
 * RULES
 *   - Explicit opt-in. Nothing is sent until the student types a class code
 *     and presses the button. The code is never pre-filled, not even from the
 *     address, and nothing is ever sent automatically.
 *   - Only the compact summary leaves the browser (see core/classShare.ts);
 *     the full session, with its mouse traces, stays local. The section shows
 *     exactly what would be sent before the student decides.
 *   - Only a first run is shared. A second run in the same visit was made
 *     knowing the design, so adding it to class data would mislead.
 *
 * Key export: `ShareWithClass`.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { buildClassSubmission } from '../../core/classShare';
import { CLASS_CODE_MAX, normalizeClassCode } from '../../core/classWire';
import type { SessionRecord } from '../../core/record';
import { submitToClass, type FetchLike } from '../classClient';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; classCode: string } | { kind: 'error'; message: string };

interface ShareWithClassProps {
  session: SessionRecord;
  /** Called after a successful share, with the class code as stored. */
  onShared?: (classCode: string) => void;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
}

export function ShareWithClass({ session, onShared, fetchImpl }: ShareWithClassProps) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // What would be sent, shown before the student decides. (The class code and time are filled in on sending.)
  const preview = useMemo(() => buildClassSubmission(session, '', new Date(0)), [session]);
  const repeatRun = session.runNumber > 1;

  const share = async (e: FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    if (normalizeClassCode(code) === null) {
      setStatus({
        kind: 'error',
        message: `A class code is letters and numbers only, up to ${CLASS_CODE_MAX} characters, with no spaces. Check the code your professor gave you.`,
      });
      return;
    }
    setStatus({ kind: 'sending' });
    const result = await submitToClass(buildClassSubmission(session, code, new Date()), fetchImpl);
    if (result.ok) {
      setStatus({ kind: 'done', classCode: result.classCode });
      onShared?.(result.classCode);
    } else {
      setStatus({ kind: 'error', message: result.message });
    }
  };

  return (
    <section className="card share" data-testid="share-with-class">
      <h3>Share your results with the class</h3>
      {repeatRun ? (
        <p className="muted" data-testid="share-unavailable">
          Only the first run of a visit can be shared. This was run {session.runNumber}, made after you had seen what
          the activity involves, so it would not be comparable with other people’s first runs.
        </p>
      ) : (
        <>
          <p className="small muted">
            Optional. This adds an <strong>anonymous</strong> summary to a class view your professor can show: two
            numbers per reach (your initial direction error and the path error of the cursor), which version you did,
            and your answer to the question about adjusting your aim. No name, no movement traces and nothing about this computer is sent, and nobody
            can tell which line is yours.
          </p>
          <form className="share-form" onSubmit={share}>
            <label className="field-label" htmlFor="class-code">
              Class code (ask your professor)
            </label>
            <div className="share-row">
              <input
                id="class-code"
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (status.kind === 'error') setStatus({ kind: 'idle' });
                }}
                maxLength={CLASS_CODE_MAX + 4}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="share-status"
              />
              <button type="submit" className="button" disabled={status.kind === 'sending' || code.trim() === ''}>
                {status.kind === 'sending' ? 'Sharing…' : 'Share anonymously'}
              </button>
            </div>
          </form>
          <div id="share-status" aria-live="polite">
            {status.kind === 'done' && (
              <p className="share-success" role="status" data-testid="share-success">
                Your data has been added to the class view. <span className="muted">(Class {status.classCode}.)</span>
              </p>
            )}
            {status.kind === 'error' && (
              <p className="share-error" role="alert" data-testid="share-error">
                {status.message}
              </p>
            )}
          </div>
          <details className="share-preview">
            <summary>See exactly what would be sent</summary>
            <p className="small muted">
              {preview.trials.length} reaches. For each: its position, block, whether it was a catch trial, the
              rotation applied, your initial direction error (<code>err</code>) and the path error of the cursor
              (<code>pe</code>), or none if that reach could not be analysed. The
              session id below is a random label; it only lets a second press replace your first instead of adding
              you twice, and it is never shown to anyone.
            </p>
            <pre className="share-json" data-testid="share-preview">
              {JSON.stringify({ ...preview, classCode: '(the code you enter)', submittedAt: '(the time you press Share)' }, null, 1)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

/**
 * InfoNote.tsx — a small "ⓘ" button that reveals a plain-language explanation
 * of one metric, plus the explanations themselves (`METRIC_INFO`).
 *
 * Collapsed by default so the page stays uncluttered; each note opens and
 * closes on its own. The button carries the metric's name as its label, so it
 * is self-describing for screen readers and does not rely on the glyph alone.
 *
 * WORDING. These notes explain how to read a number. Like the debrief, they
 * must not promise that adaptation or an aftereffect occurred.
 *
 * Key exports: `InfoNote`, `InfoNotes`, `METRIC_INFO`.
 */

import { useId, useState, type ReactNode } from 'react';

export interface MetricInfo {
  /** Short name shown on the button. */
  term: string;
  text: ReactNode;
}

/** The explanations, keyed by metric. One source for every place a metric appears. */
export const METRIC_INFO = {
  initialDirection: {
    term: 'Initial direction error',
    text: (
      <>
        Where your hand was pointing at the start of each reach, measured a quarter of the way to the target, before
        you had time to course-correct. Negative = clockwise of the target, positive = counterclockwise.
      </>
    ),
  },
  lateLooksLikeBaseline: {
    term: 'Late rotated reaches that look like baseline',
    text: (
      <>
        If the <em>cursor’s</em> path late in the rotation block looks as straight as a baseline reach, this does NOT
        mean you stopped adapting. It means you compensated exactly enough to redirect the cursor straight: your hand
        error matched what it would take to cancel the rotation. Switch the charts between “Your hand” and “The cursor
        as displayed” to see both sides of that.
      </>
    ),
  },
  catchTrial: {
    term: 'Catch trial error',
    text: (
      <>
        On a catch trial the rotation was secretly removed for a single reach. The error you made on it shows how much
        your aiming had recalibrated: a hand that sets off clockwise of the target here is still aiming as if the
        rotation were there.
      </>
    ),
  },
  pathError: {
    term: 'Path error',
    text: (
      <>
        How far the cursor’s whole outward path ran to the side of the straight line from the start to the target,
        averaged along the path, as a percentage of the distance to the target. 0% is a straight path to the target;
        positive is counterclockwise, negative clockwise. Unlike the initial direction, it includes any steering you
        did during the reach, so it is the error you actually saw. Where the cursor was hidden there was no rotation,
        so your hand’s path is used.
      </>
    ),
  },
  aimVersusSteering: {
    term: 'Aiming versus steering',
    text: (
      <>
        There are two ways to get the cursor to the target despite a rotation: aim differently from the start, or set
        off as usual and steer the cursor back while you move. The initial direction shows the first; the path error
        shows both together. If your path error shrank during the rotation block while your initial direction hardly
        changed, you were mostly steering. Slow movements leave plenty of time to steer; quick, smooth ones leave
        little, so they show changes in aim more clearly.
      </>
    ),
  },
  pathEfficiency: {
    term: 'Path efficiency',
    text: (
      <>
        1.0 = a perfectly straight line from the start to where the reach arrived. Lower values mean a curved path,
        which is common early in the rotation block, when the cursor goes somewhere unexpected and you steer it back
        in mid-reach.
      </>
    ),
  },
  movementTime: {
    term: 'Movement time',
    text: (
      <>
        Time from the start of the movement to arriving at the target’s distance. It does not include holding on the
        target. It is not a measure of learning; use it to notice whether you slowed down when the cursor misbehaved.
      </>
    ),
  },
} as const satisfies Record<string, MetricInfo>;

/** One collapsible explanation. */
export function InfoNote({ info }: { info: MetricInfo }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="info-note">
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="info-glyph" aria-hidden="true">
          ⓘ
        </span>
        <span>{info.term}</span>
      </button>
      {open && (
        <p className="info-text" id={id}>
          {info.text}
        </p>
      )}
    </div>
  );
}

/** A row of explanations, for a section that shows more than one metric. */
export function InfoNotes({ items }: { items: readonly MetricInfo[] }) {
  if (items.length === 0) return null;
  return (
    <div className="info-notes">
      {items.map((info) => (
        <InfoNote key={info.term} info={info} />
      ))}
    </div>
  );
}

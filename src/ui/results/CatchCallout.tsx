/**
 * CatchCallout.tsx — the highlighted panel near the top of the results page
 * that reports the participant's first usable catch trial: the single most
 * telling reach of the session.
 *
 * WORDING. The first sentence states what the software did. The second states
 * the measured value. What follows interprets that value, and it is chosen
 * FROM THE DATA (`CatchLevel`): the panel never says a participant's aiming
 * had recalibrated when their own reach does not show it, and it never says
 * which mechanism (strategy or implicit recalibration) was responsible,
 * because one reach cannot tell them apart.
 *
 * Key exports: `CatchCallout`, `catchInterpretation`.
 */

import { formatDeg } from '../presetText';
import { VIZ, diamondPoints } from './chartTheme';
import { InfoNote, METRIC_INFO } from './InfoNote';
import { signedWithDirection, type CatchCalloutModel } from './model';

/**
 * The sentence(s) that interpret the catch-trial value. Pure text, so the
 * wording for each level can be checked by a unit test.
 */
export function catchInterpretation(model: CatchCalloutModel): { tail: string; detail: string } {
  const size = model.rotationDeg !== null ? formatDeg(Math.abs(model.rotationDeg), 1) : null;
  switch (model.level) {
    case 'full':
      return {
        tail: `most or all of the ${size} it takes to cancel the rotation.`,
        detail:
          'Your hand set off as though the rotation were still switched on. That shows how far your aiming had recalibrated, whether through a deliberate strategy, through recalibration you were not aware of, or both.',
      };
    case 'partial':
      return {
        tail: `part of the way toward the ${size} it takes to cancel the rotation.`,
        detail:
          'Your hand was still partly aiming as though the rotation were there: some of the compensation carried over into this reach, through a deliberate strategy, through recalibration you were not aware of, or both.',
      };
    case 'little':
      return {
        tail: 'close to where your reaches pointed before any rotation was applied.',
        detail:
          'On this reach your hand showed little sign of still compensating for the rotation. That is a common result in a short session, especially if you were steering the cursor in by eye during each reach rather than changing where you first aimed.',
      };
    case 'opposite':
      return {
        tail: 'the opposite way to the one that cancels the rotation.',
        detail:
          'So this reach shows no sign of compensation carrying over. Single reaches vary a good deal; the charts below show the whole session.',
      };
    default:
      return {
        tail: 'measured a quarter of the way to the target.',
        detail: 'No rotation had been applied just before this reach, so there is nothing for it to have carried over.',
      };
  }
}

export function CatchCallout({ model }: { model: CatchCalloutModel }) {
  const { tail, detail } = catchInterpretation(model);
  const skipped = model.skippedTrialNumbers;

  return (
    <section className="card callout" data-testid="catch-callout" aria-label="Your catch trial">
      <div className="callout-mark" aria-hidden="true">
        {/* The same diamond that marks catch trials in every chart below. */}
        <svg width="26" height="26" viewBox="0 0 26 26" focusable="false">
          <polygon points={diamondPoints(13, 13, 10)} fill={VIZ.catchTrial} />
        </svg>
      </div>
      <div className="callout-body">
        <p className="callout-headline">
          On trial {model.trialNumber}, the rotation was secretly removed without warning.
        </p>
        <p className="callout-value">
          Your hand deviated <strong data-testid="catch-callout-value">{signedWithDirection(model.valueDeg)}</strong>{' '}
          — {tail}
        </p>
        <p className="callout-detail">{detail}</p>
        <p className="callout-small">
          This is your hand’s initial direction on that one reach
          {model.baselineMeanDeg !== null && (
            <>
              ; your baseline reaches, before any rotation, averaged {signedWithDirection(model.baselineMeanDeg)}
            </>
          )}
          .
          {skipped.length > 0 &&
            ` The earlier catch trial${skipped.length === 1 ? '' : 's'} (trial${skipped.length === 1 ? '' : 's'} ${skipped.join(
              ', ',
            )}) had no usable value, so this later one is shown instead.`}
        </p>
        <InfoNote info={METRIC_INFO.catchTrial} />
      </div>
    </section>
  );
}

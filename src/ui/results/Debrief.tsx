/**
 * Debrief.tsx — the plain-language explanation shown with the results.
 *
 * Wording rules: describe what was done and how to read the participant's own
 * data; never promise that adaptation or an aftereffect occurred; say plainly
 * that a short session can show little or nothing; never compare with other
 * people. Trial numbers and angles are generated from the session so the text
 * always matches the protocol that actually ran.
 *
 * Key export: `Debrief`.
 */

import { perturbedReachCount } from '../../core/presets';
import type { SessionRecord } from '../../core/record';
import { catchTrialNumbers, describePerturbation, formatSignedDeg } from '../presetText';
import { ADJUSTMENT_CHOICES, ADJUSTMENT_QUESTION } from '../Reflection';
import { aimAndArrival, describeDirection, type PhaseBand } from './model';

const span = (band: PhaseBand | undefined) => (band ? `trials ${band.firstTrial}–${band.lastTrial}` : '');

const listTrials = (numbers: number[]) =>
  numbers.length === 1 ? `trial ${numbers[0]}` : `trials ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;

export function Debrief({ session, bands }: { session: SessionRecord; bands: PhaseBand[] }) {
  const { preset } = session;
  const band = (phase: PhaseBand['phase']) => bands.find((b) => b.phase === phase);
  const catches = catchTrialNumbers(preset);
  const rotated = perturbedReachCount(preset.structure);
  const repeatRun = session.runNumber > 1;
  const otherKind = preset.perturbation.kind === 'sudden' ? 'gradual' : 'sudden';
  // The strategy-awareness answer given before the reveal, in the words of the option chosen.
  const baselineHidden = preset.structure.baseline.feedback === 'hidden';
  const aftereffectHidden = preset.structure.aftereffect.feedback === 'hidden';
  const adjustment = session.reflection?.consciousAdjustment ?? null;
  const adjustmentLabel = ADJUSTMENT_CHOICES.find((c) => c.value === adjustment)?.label ?? null;
  const fullRotation = Math.abs(preset.perturbation.kind === 'sudden' ? preset.perturbation.angleDeg : preset.perturbation.endDeg);
  // Set-off versus arrival direction on the last rotated reaches (only when the rotation was on).
  const lateTrials = session.summary.latePerturbed.trialNumbers;
  const lateValues = aimAndArrival(session, lateTrials);
  const steering = lateValues && lateValues.rotationDeg !== 0 ? lateValues : null;

  return (
    <section className="card debrief">
      <h3>What happened</h3>
      <ol className="plain-list">
        <li>
          <strong>Baseline ({span(band('baseline'))}).</strong> Nothing was changed. The cursor was hidden while you
          reached, so these reaches show your aim on its own, including any habitual bias, without corrections along
          the way.
        </li>
        <li>
          <strong>Rotation block ({span(band('adaptation'))}).</strong> With no announcement, the cursor’s motion was
          rotated relative to your hand’s motion. {describePerturbation(preset)} To send the cursor to a target you
          had to move your hand <em>clockwise</em> of that target. Changing your movements to cancel a changed
          relationship between movement and its visual result is called <strong>visuomotor adaptation</strong>.
        </li>
        {catches.length > 0 && (
          <li>
            <strong>
              Catch {catches.length === 1 ? 'trial' : 'trials'} ({listTrials(catches)}).
            </strong>{' '}
            For a single reach the rotation was switched off while the cursor stayed visible. If your movements had
            adapted, your hand would still set off clockwise of the target on such a reach, and with the rotation gone
            the cursor would go clockwise with it.
          </li>
        )}
        <li>
          <strong>Aftereffect block ({span(band('aftereffect'))}).</strong>{' '}
          {aftereffectHidden
            ? `The rotation was removed for good and the cursor hidden again${baselineHidden ? ', exactly as in the baseline' : ''} and again without announcement.`
            : 'The rotation was removed for good, without announcement, and this time the cursor stayed visible while you reached.'}{' '}
          Reaches that still veer clockwise here are <strong>aftereffects</strong>: a learned change persisting after
          its cause has gone.
          {!aftereffectHidden &&
            ' Because you could see the cursor, you could also correct it on the way, so look at the initial direction of these reaches rather than where they ended.'}
        </li>
      </ol>

      <h3>How to read your results</h3>
      <ul className="plain-list">
        <li>
          <strong>Adaptation</strong> would appear in the rotation block as your hand’s initial direction moving away
          from 0° toward the gray reference line ({formatSignedDeg(-fullRotation, 0)} while the rotation was at full
          size), and as the cursor’s path error shrinking back toward 0%.
        </li>
        {steering && (
          <li data-testid="aim-vs-steering">
            <strong>Aiming versus steering.</strong> On your last rotated reaches ({listTrials(lateTrials)}), your hand
            set off on average {describeDirection(steering.initialDeg)} of the target, and by the time it reached the
            target’s distance it was {describeDirection(steering.arrivalDeg)} of it ({formatSignedDeg(-steering.rotationDeg, 0)}{' '}
            would have cancelled the rotation exactly).{' '}
            {Math.abs(steering.arrivalDeg - steering.initialDeg) >= 5
              ? 'The difference is steering: correcting the cursor while you moved. The initial direction shows only the change in your aim; the path error shows aim and steering together.'
              : 'Your hand arrived about where it set off, so any correction was in your aim rather than made during the reach.'}
          </li>
        )}
        <li>
          <strong>An aftereffect</strong> would appear as {catches.length > 0 ? 'catch-trial and ' : ''}
          aftereffect-block points lying clockwise of your baseline points, even though the rotation was 0° on those
          reaches. Compare them with your own baseline
          rather than with 0°, because most people have a small bias of their own.
        </li>
        <li>
          <strong>Strategy and recalibration.</strong> Two different things can turn a hand clockwise. One is a
          deliberate strategy (“aim to one side of the target”). The other is an implicit recalibration of the
          relationship between hand and cursor, which happens without awareness. A strategy can be dropped as soon as
          you suspect the rotation has gone; implicit recalibration cannot simply be switched off, which is why
          aftereffects are informative. Both can contribute, and this activity cannot cleanly separate them. Your
          answer below is a clue to which you relied on.
          <div className="debrief-answer" data-testid="strategy-answer">
            <p>
              Before seeing these results you were asked: <em>“{ADJUSTMENT_QUESTION}”</em>{' '}
              {adjustmentLabel ? (
                <>
                  You answered: <strong>{adjustmentLabel}</strong>.
                </>
              ) : (
                <>You did not answer this question.</>
              )}
            </p>
            <p>
              Explicit (conscious) strategies and implicit recalibration can both contribute to adaptation — and both
              can produce aftereffects.
            </p>
          </div>
        </li>
        <li>
          <strong>Washout.</strong> Washout is the gradual return toward baseline once normal feedback is restored.
          There was no separate washout block here.{' '}
          {aftereffectHidden
            ? 'In the last block the cursor stayed hidden for each whole reach and then simply reappeared at the center, so you were never shown where those reaches ended. An aftereffect can still fade over repeated reaches, and reaches made with the cursor fully visible would wash it out much faster.'
            : 'In the last block, though, you could see the cursor on every reach. That restored normal feedback at once, so those reaches were themselves washing the change out: expect any aftereffect to be largest on the first of them and to fade quickly.'}
        </li>
      </ul>

      <h3>What your results can and cannot show</h3>
      <ul className="plain-list">
        <li>
          This was a short session with only {rotated} rotated reaches. Many people adapt only partly in that time, and
          some show little or no measurable adaptation or aftereffect. That is an ordinary outcome, not a failed
          experiment.
        </li>
        <li>
          Each point is one small mouse movement, so there is a lot of scatter from reach to reach. Look for consistent
          shifts across several reaches rather than at any single point.
        </li>
        {preset.kind === 'canonical' && (
          <li>
            You did the {preset.perturbation.kind} version; other people did the {otherKind} one. One person’s data
            cannot show whether the two versions differ. That needs many people in each version.
          </li>
        )}
        {preset.kind === 'demo' && (
          <li>
            This was the Quick Demo, which is shorter than the standard activity and uses fewer targets. Its results
            should not be compared with results from the standard versions.
          </li>
        )}
        {preset.kind === 'custom' && (
          <li>
            This was a custom protocol set up by your instructor (<code>{preset.id}</code>). Its settings differ from
            the standard versions, so its results should not be compared or pooled with theirs.
          </li>
        )}
        {repeatRun && (
          <li>
            This was not your first run in this visit. Practice and carry-over from the earlier run can change what
            happens in a later one, so the two runs are not a fair comparison of the versions.
          </li>
        )}
        <li>These are teaching defaults, not an optimized research protocol.</li>
      </ul>
    </section>
  );
}

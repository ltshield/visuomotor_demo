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
import { catchTrialNumbers, describePerturbation } from '../presetText';
import type { PhaseBand } from './model';

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
          <strong>Aftereffect block ({span(band('aftereffect'))}).</strong> The rotation was removed for good and the
          cursor hidden again, exactly as in the baseline and again without announcement. Reaches that still veer
          clockwise here are <strong>aftereffects</strong>: a learned change persisting after its cause has gone.
        </li>
      </ol>

      <h3>How to read your results</h3>
      <ul className="plain-list">
        <li>
          <strong>Adaptation</strong> would appear in the rotation block as your hand’s initial direction moving away
          from 0° toward the gray reference line (−45° while the rotation was at full size).
        </li>
        <li>
          <strong>An aftereffect</strong> would appear as catch-trial and aftereffect-block points lying clockwise of
          your baseline points, even though the rotation was 0° on those reaches. Compare them with your own baseline
          rather than with 0°, because most people have a small bias of their own.
        </li>
        <li>
          <strong>Strategy and recalibration.</strong> Two different things can turn a hand clockwise. One is a
          deliberate strategy (“aim to one side of the target”). The other is an implicit recalibration of the
          relationship between hand and cursor, which happens without awareness. A strategy can be dropped as soon as
          you suspect the rotation has gone; implicit recalibration cannot simply be switched off, which is why
          aftereffects are informative. Both can contribute, and this activity cannot cleanly separate them. Your
          answers to the questions before this page are a clue to which you relied on.
        </li>
        <li>
          <strong>Washout.</strong> Washout is the gradual return toward baseline once normal feedback is restored.
          There was no separate washout block here. In the last block, though, the cursor reappeared for each return to
          the center, which showed roughly where your reach had ended. That alone can make an aftereffect fade across
          those reaches, and repeated aftereffect reaches with the cursor fully visible would wash it out faster still.
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
        {preset.kind === 'canonical' ? (
          <li>
            You did the {preset.perturbation.kind} version; other people did the {otherKind} one. One person’s data
            cannot show whether the two versions differ. That needs many people in each version.
          </li>
        ) : (
          <li>
            This was the Quick Demo, which is shorter than the standard activity and uses fewer targets. Its results
            should not be compared with results from the standard versions.
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

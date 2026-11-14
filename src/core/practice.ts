/**
 * practice.ts — the short, unrecorded warm-up that precedes the experiment.
 *
 * Practice always uses the normal mapping (0° rotation). It contains a few
 * reaches with the cursor visible and then a few with it hidden, so that a
 * disappearing cursor is recognised as part of the task rather than a fault.
 * It deliberately says and shows nothing about any perturbation.
 *
 * Key export: `buildPracticeTrials`.
 */

import type { EngineTrial } from './engine';

/** Number of practice reaches with the cursor visible, then hidden. */
export const PRACTICE_VISIBLE_REACHES = 4;
export const PRACTICE_HIDDEN_REACHES = 2;

/**
 * Practice trials for a given set of target directions. The fixed index
 * pattern spreads the reaches around the workspace; `% n` lets the same
 * pattern serve presets with fewer targets (e.g. the four-target Quick Demo).
 */
export function buildPracticeTrials(targetAnglesDeg: readonly number[]): EngineTrial[] {
  const n = targetAnglesDeg.length;
  const visibleOrder = [0, 3, 6, 1].slice(0, PRACTICE_VISIBLE_REACHES);
  const hiddenOrder = [4, 7].slice(0, PRACTICE_HIDDEN_REACHES);

  const make = (rawIndex: number, feedback: EngineTrial['feedback']): EngineTrial => {
    const targetIndex = rawIndex % n;
    return { targetIndex, targetAngleDeg: targetAnglesDeg[targetIndex], rotationDeg: 0, feedback };
  };

  return [
    ...visibleOrder.map((i) => make(i, 'visible')),
    ...hiddenOrder.map((i) => make(i, 'hidden')),
  ];
}

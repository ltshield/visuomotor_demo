/**
 * schedule.ts — turns a preset + seed into the concrete list of trials.
 *
 * The whole session is planned up front (target, rotation and feedback for
 * every trial), so the trial engine never has to make protocol decisions and
 * the exact plan can be saved alongside the data.
 *
 * Guarantees (all covered by schedule.test.ts):
 *   - Balance: each phase is built from shuffled blocks containing every target
 *     once, so with the standard structure each direction appears once in
 *     baseline, three times in adaptation and once in aftereffect.
 *   - Reproducibility: the same preset and seed always give the same order.
 *   - Catch trials sit in ordinary adaptation slots, apply 0° rotation and do
 *     NOT advance the gradual ramp.
 *
 * Key exports: `TrialSpec`, `generateSchedule`, `rotationForPerturbedReach`.
 */

import { mulberry32, shuffled, type Rng } from './rng';
import {
  validatePreset,
  type FeedbackMode,
  type PerturbationSchedule,
  type PhaseName,
  type PresetConfig,
} from './presets';

export interface TrialSpec {
  /** 0-based position in the session. */
  index: number;
  /** 1-based position in the session (`index + 1`), convenient for people and CSV files. */
  trialNumber: number;
  phase: PhaseName;
  /** 1-based position within its phase; catch slots in the preset refer to this number. */
  slotInPhase: number;
  /** True for a zero-rotation "catch" (null) trial inside the adaptation phase. */
  isCatch: boolean;
  /**
   * 1-based running count of NON-CATCH adaptation reaches, i.e. the ramp
   * counter. Null for catch trials and for baseline/aftereffect trials.
   */
  perturbedReachNumber: number | null;
  /** Index into `structure.targetAnglesDeg`. */
  targetIndex: number;
  targetAngleDeg: number;
  /** Cursor rotation for the outward reach, degrees, + = counterclockwise. */
  rotationDeg: number;
  /** Whether the cursor is drawn during the outward reach. */
  feedback: FeedbackMode;
}

/**
 * Rotation applied on the n-th non-catch adaptation reach (n is 1-based).
 *
 * Gradual schedule: reach 1 applies `startDeg`, reach `rampReaches` applies
 * `endDeg`, and the (rampReaches − 1) steps between are equal. With the
 * canonical 0°→45° over 8 reaches that is 7 steps of 45/7 ≈ 6.43°:
 *   0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45, 45, 45, ...
 */
export function rotationForPerturbedReach(perturbation: PerturbationSchedule, reachNumber: number): number {
  if (!Number.isInteger(reachNumber) || reachNumber < 1) {
    throw new Error(`reachNumber must be a positive integer, got ${reachNumber}`);
  }
  if (perturbation.kind === 'sudden') return perturbation.angleDeg;

  const { startDeg, endDeg, rampReaches } = perturbation;
  // At and beyond the end of the ramp return endDeg itself, so the plateau is
  // exactly 45° rather than 44.99999…° from accumulated floating-point steps.
  if (reachNumber >= rampReaches) return endDeg;
  return startDeg + ((endDeg - startDeg) * (reachNumber - 1)) / (rampReaches - 1);
}

/**
 * Builds `blocks` consecutive shuffled permutations of the target indices.
 * `previousTarget` is the target of the trial just before this run; the first
 * target of each block is nudged if it would repeat the preceding target, so
 * the same direction is never presented twice in a row (including across block
 * and phase boundaries). Balance is unaffected because the nudge only swaps
 * two entries within one block.
 */
function balancedTargetRun(
  targetCount: number,
  blocks: number,
  rng: Rng,
  previousTarget: number | null,
): number[] {
  const indices = Array.from({ length: targetCount }, (_, i) => i);
  const run: number[] = [];
  let prev = previousTarget;
  for (let b = 0; b < blocks; b++) {
    const block = shuffled(indices, rng);
    if (prev !== null && block[0] === prev && targetCount > 1) {
      const j = 1 + Math.floor(rng() * (targetCount - 1));
      [block[0], block[j]] = [block[j], block[0]];
    }
    run.push(...block);
    prev = block[block.length - 1];
  }
  return run;
}

/** Deterministically expands `preset` into its full trial list for the given `seed`. */
export function generateSchedule(preset: PresetConfig, seed: number): TrialSpec[] {
  validatePreset(preset);
  const { structure, perturbation } = preset;
  const targetCount = structure.targetAnglesDeg.length;
  const rng = mulberry32(seed);
  const catchSlots = new Set(structure.adaptation.catchSlots);

  const trials: TrialSpec[] = [];
  let previousTarget: number | null = null;
  // Ramp counter: counts perturbed (non-catch) adaptation reaches only.
  let perturbedReaches = 0;

  for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
    const spec = structure[phase];
    const targets = balancedTargetRun(targetCount, spec.trials / targetCount, rng, previousTarget);
    previousTarget = targets[targets.length - 1];

    targets.forEach((targetIndex, i) => {
      const slotInPhase = i + 1;
      const isCatch = phase === 'adaptation' && catchSlots.has(slotInPhase);

      let rotationDeg = 0;
      let perturbedReachNumber: number | null = null;
      if (phase === 'adaptation' && !isCatch) {
        // Only a real perturbed reach advances the counter. A catch trial
        // leaves it untouched, so the ramp resumes exactly where it left off.
        perturbedReaches += 1;
        perturbedReachNumber = perturbedReaches;
        rotationDeg = rotationForPerturbedReach(perturbation, perturbedReaches);
      }

      trials.push({
        index: trials.length,
        trialNumber: trials.length + 1,
        phase,
        slotInPhase,
        isCatch,
        perturbedReachNumber,
        targetIndex,
        targetAngleDeg: structure.targetAnglesDeg[targetIndex],
        rotationDeg,
        feedback: spec.feedback,
      });
    });
  }
  return trials;
}

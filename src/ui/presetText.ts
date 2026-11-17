/**
 * presetText.ts — plain-language descriptions of a preset, generated from its
 * configuration so the instructor page and the debrief can never drift out of
 * step with what the software actually does.
 *
 * Key exports: `formatDeg`, `perturbedAngles`, `describePerturbation`,
 * `catchTrialNumbers`.
 */

import { perturbedReachCount, type PresetConfig } from '../core/presets';
import { rotationForPerturbedReach } from '../core/schedule';

/** Format an angle with up to `digits` decimals and a degree sign, e.g. 6.43°. Trailing zeros are dropped. */
export function formatDeg(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  return `${Object.is(rounded, -0) ? 0 : rounded}°`;
}

/** Like `formatDeg` but always shows the sign of non-zero values, e.g. +45°, −12.3°. */
export function formatSignedDeg(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0°';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}°`;
}

/** A signed percentage, e.g. +22%, −8.5%; 0 → "0%". */
export function formatSignedPct(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

/** Rotation applied on each non-catch adaptation reach, in order (reach 1 first). */
export function perturbedAngles(preset: PresetConfig): number[] {
  const n = perturbedReachCount(preset.structure);
  return Array.from({ length: n }, (_, i) => rotationForPerturbedReach(preset.perturbation, i + 1));
}

/** Session trial numbers (1-based) of the catch trials. */
export function catchTrialNumbers(preset: PresetConfig): number[] {
  return preset.structure.adaptation.catchSlots.map((slot) => preset.structure.baseline.trials + slot);
}

/**
 * One sentence describing how the rotation is introduced.
 * `tense` is 'past' for the debrief ("was rotated") and 'present' for reference material.
 */
export function describePerturbation(preset: PresetConfig, tense: 'past' | 'present' = 'past'): string {
  const p = preset.perturbation;
  const perturbed = perturbedReachCount(preset.structure);
  const past = tense === 'past';
  if (p.kind === 'sudden') {
    return `The cursor ${past ? 'was' : 'is'} rotated ${formatSignedDeg(p.angleDeg)} (counterclockwise) all at once, on every one of the ${perturbed} non-catch reaches.`;
  }
  const steps = p.rampReaches - 1;
  const stepSize = steps > 0 ? (p.endDeg - p.startDeg) / steps : 0;
  return (
    `The cursor rotation ${past ? 'grew' : 'grows'} from ${formatDeg(p.startDeg)} to ${formatSignedDeg(p.endDeg)} (counterclockwise) ` +
    `in ${steps} equal steps of about ${formatDeg(stepSize)} across the first ${p.rampReaches} non-catch reaches, ` +
    `then ${past ? 'stayed' : 'stays'} at ${formatSignedDeg(p.endDeg)} for the remaining ${perturbed - p.rampReaches}.`
  );
}

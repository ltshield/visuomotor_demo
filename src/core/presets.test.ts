import { describe, expect, it } from 'vitest';
import {
  ALL_PRESETS,
  CANONICAL_PRESETS,
  GRADUAL_45_V1,
  QUICK_DEMO_45_V1,
  SUDDEN_45_V1,
  getPresetById,
  otherCanonicalPreset,
  perturbedReachCount,
  totalTrials,
  validatePreset,
  type PresetConfig,
} from './presets';

/**
 * FROZEN SNAPSHOT of the released v1 semantics.
 *
 * If this test fails you have changed what a released preset means. Do not
 * update the snapshot: restore the preset, add a new one with a new id
 * (e.g. `rotation-sudden-45-v2`) and add its snapshot here instead.
 */
const FROZEN_STANDARD = {
  structure: {
    targetAnglesDeg: [0, 45, 90, 135, 180, 225, 270, 315],
    baseline: { trials: 8, feedback: 'hidden' },
    adaptation: { trials: 24, feedback: 'visible', catchSlots: [12, 20] },
    aftereffect: { trials: 8, feedback: 'hidden' },
  },
  geometry: {
    targetDistance: 240,
    targetRadius: 18,
    startRadius: 14,
    cursorRadius: 6,
    boundsHalfExtent: 282,
    inputGain: 1,
  },
  timing: { holdMs: 400, reachTimeoutMs: 4000, feedbackHoldMs: 500 },
  criteria: { onsetFraction: 0.05, initialDirectionFraction: 0.25, minReachSamples: 4 },
};

/** The fields that define behaviour (labels and descriptions may be reworded freely). */
const semantics = (p: PresetConfig) => ({
  id: p.id,
  version: p.version,
  kind: p.kind,
  structure: p.structure,
  perturbation: p.perturbation,
  geometry: p.geometry,
  timing: p.timing,
  criteria: p.criteria,
});

describe('stable preset identifiers', () => {
  it('uses the published ids', () => {
    expect(SUDDEN_45_V1.id).toBe('rotation-sudden-45-v1');
    expect(GRADUAL_45_V1.id).toBe('rotation-gradual-45-v1');
    expect(QUICK_DEMO_45_V1.id).toBe('rotation-quickdemo-45-v1');
  });

  it('ids are unique and resolvable', () => {
    const ids = ALL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ALL_PRESETS) expect(getPresetById(p.id)).toBe(p);
    expect(getPresetById('nope')).toBeUndefined();
  });

  it('every id ends in its version number', () => {
    for (const p of ALL_PRESETS) expect(p.id.endsWith(`-v${p.version}`)).toBe(true);
  });
});

describe('frozen v1 semantics', () => {
  it('rotation-sudden-45-v1 is unchanged', () => {
    expect(semantics(SUDDEN_45_V1)).toEqual({
      id: 'rotation-sudden-45-v1',
      version: 1,
      kind: 'canonical',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      ...FROZEN_STANDARD,
    });
  });

  it('rotation-gradual-45-v1 is unchanged', () => {
    expect(semantics(GRADUAL_45_V1)).toEqual({
      id: 'rotation-gradual-45-v1',
      version: 1,
      kind: 'canonical',
      perturbation: { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 },
      ...FROZEN_STANDARD,
    });
  });

  it('rotation-quickdemo-45-v1 is unchanged', () => {
    expect(semantics(QUICK_DEMO_45_V1)).toEqual({
      id: 'rotation-quickdemo-45-v1',
      version: 1,
      kind: 'demo',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: {
        targetAnglesDeg: [0, 90, 180, 270],
        baseline: { trials: 4, feedback: 'hidden' },
        adaptation: { trials: 8, feedback: 'visible', catchSlots: [6] },
        aftereffect: { trials: 4, feedback: 'hidden' },
      },
      geometry: FROZEN_STANDARD.geometry,
      timing: FROZEN_STANDARD.timing,
      criteria: FROZEN_STANDARD.criteria,
    });
  });
});

describe('the two canonical presets', () => {
  it('are exactly the sudden and gradual presets', () => {
    expect(CANONICAL_PRESETS.map((p) => p.id)).toEqual(['rotation-sudden-45-v1', 'rotation-gradual-45-v1']);
  });

  it('differ ONLY in the perturbation schedule', () => {
    expect(SUDDEN_45_V1.structure).toEqual(GRADUAL_45_V1.structure);
    expect(SUDDEN_45_V1.geometry).toEqual(GRADUAL_45_V1.geometry);
    expect(SUDDEN_45_V1.timing).toEqual(GRADUAL_45_V1.timing);
    expect(SUDDEN_45_V1.criteria).toEqual(GRADUAL_45_V1.criteria);
    expect(SUDDEN_45_V1.perturbation).not.toEqual(GRADUAL_45_V1.perturbation);
  });

  it('have 40 trials, 22 of them perturbed', () => {
    for (const p of CANONICAL_PRESETS) {
      expect(totalTrials(p.structure)).toBe(40);
      expect(perturbedReachCount(p.structure)).toBe(22);
    }
  });

  it('each names the other as "the other condition"; the demo has none', () => {
    expect(otherCanonicalPreset(SUDDEN_45_V1.id)).toBe(GRADUAL_45_V1);
    expect(otherCanonicalPreset(GRADUAL_45_V1.id)).toBe(SUDDEN_45_V1);
    expect(otherCanonicalPreset(QUICK_DEMO_45_V1.id)).toBeUndefined();
  });
});

describe('validatePreset', () => {
  const variant = (edit: (p: PresetConfig) => void): PresetConfig => {
    const copy: PresetConfig = structuredClone(SUDDEN_45_V1);
    edit(copy);
    return copy;
  };

  it('accepts every shipped preset', () => {
    for (const p of ALL_PRESETS) expect(() => validatePreset(p)).not.toThrow();
  });

  it('rejects trial counts that cannot be balanced across targets', () => {
    expect(() => validatePreset(variant((p) => (p.structure.baseline.trials = 7)))).toThrow(/multiple of the target count/);
    expect(() => validatePreset(variant((p) => (p.structure.adaptation.trials = 20)))).toThrow(/multiple of the target count/);
  });

  it('rejects catch slots outside the adaptation phase or duplicated', () => {
    expect(() => validatePreset(variant((p) => (p.structure.adaptation.catchSlots = [0])))).toThrow(/catch slot/);
    expect(() => validatePreset(variant((p) => (p.structure.adaptation.catchSlots = [25])))).toThrow(/catch slot/);
    expect(() => validatePreset(variant((p) => (p.structure.adaptation.catchSlots = [12, 12])))).toThrow(/unique/);
  });

  it('rejects a ramp longer than the number of perturbed reaches', () => {
    const bad = variant((p) => (p.perturbation = { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 23 }));
    expect(() => validatePreset(bad)).toThrow(/ramp is longer/);
  });

  it('rejects duplicate target directions', () => {
    expect(() => validatePreset(variant((p) => (p.structure.targetAnglesDeg[1] = 0)))).toThrow(/unique/);
  });
});

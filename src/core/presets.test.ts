import { describe, expect, it } from 'vitest';
import {
  ALL_PRESETS,
  CANONICAL_PRESETS,
  GRADUAL_45_V1,
  GRADUAL_45_V2,
  GRADUAL_45_V3,
  QUICK_DEMO_45_V1,
  QUICK_DEMO_45_V2,
  QUICK_DEMO_45_V3,
  RETIRED_PRESETS,
  SUDDEN_45_V1,
  SUDDEN_45_V2,
  SUDDEN_45_V3,
  arrivalRadius,
  getPresetById,
  isTooSlow,
  otherCanonicalPreset,
  perturbedReachCount,
  targetHoldMsOf,
  totalTrials,
  validatePreset,
  type PresetConfig,
} from './presets';

/**
 * FROZEN SNAPSHOTS of released preset semantics.
 *
 * If one of these tests fails you have changed what a released preset means.
 * Do not update the snapshot: restore the preset, add a new one with a new id
 * (e.g. `rotation-sudden-45-v3`) and add its snapshot here instead.
 */
const FROZEN_STRUCTURE = {
  targetAnglesDeg: [0, 45, 90, 135, 180, 225, 270, 315],
  baseline: { trials: 8, feedback: 'hidden' },
  adaptation: { trials: 24, feedback: 'visible', catchSlots: [12, 20] },
  aftereffect: { trials: 8, feedback: 'hidden' },
};
const FROZEN_QUICK_STRUCTURE = {
  targetAnglesDeg: [0, 90, 180, 270],
  baseline: { trials: 4, feedback: 'hidden' },
  adaptation: { trials: 8, feedback: 'visible', catchSlots: [6] },
  aftereffect: { trials: 4, feedback: 'hidden' },
};
const FROZEN_GEOMETRY = {
  targetDistance: 240,
  targetRadius: 18,
  startRadius: 14,
  cursorRadius: 6,
  boundsHalfExtent: 282,
  inputGain: 1,
};
const FROZEN_CRITERIA = { onsetFraction: 0.05, initialDirectionFraction: 0.25, minReachSamples: 4 };

/** v3: as v2, plus the speed instruction (onset → arrival within 500 ms, else "Too slow"). */
const FROZEN_V3_TIMING = { holdMs: 400, targetHoldMs: 400, maxMovementMs: 500, reachTimeoutMs: 6000, feedbackHoldMs: 300 };
/** v2 (retired): reach onto the target and hold for 400 ms; no speed instruction (the key must stay ABSENT). */
const FROZEN_V2_TIMING = { holdMs: 400, targetHoldMs: 400, reachTimeoutMs: 6000, feedbackHoldMs: 300 };
/** v1 (retired): no target hold at all. The key must stay ABSENT, not be set to 0. */
const FROZEN_V1_TIMING = { holdMs: 400, reachTimeoutMs: 4000, feedbackHoldMs: 500 };

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
    expect(SUDDEN_45_V3.id).toBe('rotation-sudden-45-v3');
    expect(GRADUAL_45_V3.id).toBe('rotation-gradual-45-v3');
    expect(QUICK_DEMO_45_V3.id).toBe('rotation-quickdemo-45-v3');
    expect(SUDDEN_45_V2.id).toBe('rotation-sudden-45-v2');
    expect(GRADUAL_45_V2.id).toBe('rotation-gradual-45-v2');
    expect(QUICK_DEMO_45_V2.id).toBe('rotation-quickdemo-45-v2');
    expect(SUDDEN_45_V1.id).toBe('rotation-sudden-45-v1');
    expect(GRADUAL_45_V1.id).toBe('rotation-gradual-45-v1');
    expect(QUICK_DEMO_45_V1.id).toBe('rotation-quickdemo-45-v1');
  });

  it('ids are unique across current and retired presets, and current ones are resolvable', () => {
    const ids = [...ALL_PRESETS, ...RETIRED_PRESETS].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ALL_PRESETS) expect(getPresetById(p.id)).toBe(p);
    expect(getPresetById('nope')).toBeUndefined();
  });

  it('every id ends in its version number', () => {
    for (const p of [...ALL_PRESETS, ...RETIRED_PRESETS]) expect(p.id.endsWith(`-v${p.version}`)).toBe(true);
  });
});

describe('frozen v3 semantics (the presets the app runs)', () => {
  it('rotation-sudden-45-v3 is unchanged', () => {
    expect(semantics(SUDDEN_45_V3)).toEqual({
      id: 'rotation-sudden-45-v3',
      version: 3,
      kind: 'canonical',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V3_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-gradual-45-v3 is unchanged', () => {
    expect(semantics(GRADUAL_45_V3)).toEqual({
      id: 'rotation-gradual-45-v3',
      version: 3,
      kind: 'canonical',
      perturbation: { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V3_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-quickdemo-45-v3 is unchanged', () => {
    expect(semantics(QUICK_DEMO_45_V3)).toEqual({
      id: 'rotation-quickdemo-45-v3',
      version: 3,
      kind: 'demo',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_QUICK_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V3_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });
});

describe('frozen v2 semantics (retired, kept for reading old files)', () => {
  it('rotation-sudden-45-v2 is unchanged', () => {
    expect(semantics(SUDDEN_45_V2)).toEqual({
      id: 'rotation-sudden-45-v2',
      version: 2,
      kind: 'canonical',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V2_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-gradual-45-v2 is unchanged', () => {
    expect(semantics(GRADUAL_45_V2)).toEqual({
      id: 'rotation-gradual-45-v2',
      version: 2,
      kind: 'canonical',
      perturbation: { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V2_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-quickdemo-45-v2 is unchanged', () => {
    expect(semantics(QUICK_DEMO_45_V2)).toEqual({
      id: 'rotation-quickdemo-45-v2',
      version: 2,
      kind: 'demo',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_QUICK_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V2_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('v2 timing has no maxMovementMs key at all', () => {
    for (const p of [SUDDEN_45_V2, GRADUAL_45_V2, QUICK_DEMO_45_V2]) expect('maxMovementMs' in p.timing).toBe(false);
  });
});
describe('frozen v1 semantics (retired, kept for reading old files)', () => {
  it('rotation-sudden-45-v1 is unchanged', () => {
    expect(semantics(SUDDEN_45_V1)).toEqual({
      id: 'rotation-sudden-45-v1',
      version: 1,
      kind: 'canonical',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V1_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-gradual-45-v1 is unchanged', () => {
    expect(semantics(GRADUAL_45_V1)).toEqual({
      id: 'rotation-gradual-45-v1',
      version: 1,
      kind: 'canonical',
      perturbation: { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 },
      structure: FROZEN_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V1_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('rotation-quickdemo-45-v1 is unchanged', () => {
    expect(semantics(QUICK_DEMO_45_V1)).toEqual({
      id: 'rotation-quickdemo-45-v1',
      version: 1,
      kind: 'demo',
      perturbation: { kind: 'sudden', angleDeg: 45 },
      structure: FROZEN_QUICK_STRUCTURE,
      geometry: FROZEN_GEOMETRY,
      timing: FROZEN_V1_TIMING,
      criteria: FROZEN_CRITERIA,
    });
  });

  it('v1 timing has no targetHoldMs key at all', () => {
    for (const p of [SUDDEN_45_V1, GRADUAL_45_V1, QUICK_DEMO_45_V1]) expect('targetHoldMs' in p.timing).toBe(false);
  });
});

describe('retired presets can no longer be run or assigned', () => {
  it('are exactly the three v2 and the three v1 presets', () => {
    expect(RETIRED_PRESETS.map((p) => p.id)).toEqual([
      'rotation-sudden-45-v2',
      'rotation-gradual-45-v2',
      'rotation-quickdemo-45-v2',
      'rotation-sudden-45-v1',
      'rotation-gradual-45-v1',
      'rotation-quickdemo-45-v1',
    ]);
  });

  it('are not in the runnable list and cannot be looked up for a session', () => {
    for (const p of RETIRED_PRESETS) {
      expect(ALL_PRESETS).not.toContain(p);
      expect(CANONICAL_PRESETS).not.toContain(p);
      expect(getPresetById(p.id)).toBeUndefined();
      expect(otherCanonicalPreset(p.id)).toBeUndefined();
    }
  });

  it('each has a current successor that differs only in timing (the trial rules)', () => {
    const pairs: Array<[PresetConfig, PresetConfig]> = [
      [SUDDEN_45_V1, SUDDEN_45_V3],
      [GRADUAL_45_V1, GRADUAL_45_V3],
      [QUICK_DEMO_45_V1, QUICK_DEMO_45_V3],
      [SUDDEN_45_V2, SUDDEN_45_V3],
      [GRADUAL_45_V2, GRADUAL_45_V3],
      [QUICK_DEMO_45_V2, QUICK_DEMO_45_V3],
    ];
    for (const [old, current] of pairs) {
      expect(current.structure).toEqual(old.structure);
      expect(current.perturbation).toEqual(old.perturbation);
      expect(current.geometry).toEqual(old.geometry);
      expect(current.criteria).toEqual(old.criteria);
      expect(current.kind).toBe(old.kind);
      expect(current.timing).not.toEqual(old.timing);
    }
  });

  it('v3 differs from v2 only by the speed instruction', () => {
    const { maxMovementMs, ...rest } = SUDDEN_45_V3.timing;
    expect(maxMovementMs).toBe(500);
    expect(rest).toEqual(SUDDEN_45_V2.timing);
  });
});

describe('the two canonical presets', () => {
  it('are exactly the v3 sudden and gradual presets', () => {
    expect(CANONICAL_PRESETS.map((p) => p.id)).toEqual(['rotation-sudden-45-v3', 'rotation-gradual-45-v3']);
  });

  it('differ ONLY in the perturbation schedule', () => {
    expect(SUDDEN_45_V3.structure).toEqual(GRADUAL_45_V3.structure);
    expect(SUDDEN_45_V3.geometry).toEqual(GRADUAL_45_V3.geometry);
    expect(SUDDEN_45_V3.timing).toEqual(GRADUAL_45_V3.timing);
    expect(SUDDEN_45_V3.criteria).toEqual(GRADUAL_45_V3.criteria);
    expect(SUDDEN_45_V3.perturbation).not.toEqual(GRADUAL_45_V3.perturbation);
  });

  it('have 40 trials, 22 of them perturbed', () => {
    for (const p of CANONICAL_PRESETS) {
      expect(totalTrials(p.structure)).toBe(40);
      expect(perturbedReachCount(p.structure)).toBe(22);
    }
  });

  it('each names the other as "the other condition"; the demo has none', () => {
    expect(otherCanonicalPreset(SUDDEN_45_V3.id)).toBe(GRADUAL_45_V3);
    expect(otherCanonicalPreset(GRADUAL_45_V3.id)).toBe(SUDDEN_45_V3);
    expect(otherCanonicalPreset(QUICK_DEMO_45_V3.id)).toBeUndefined();
  });
});

describe('target hold and arrival radius', () => {
  it('v3 and v2 presets hold for 400 ms and arrive at the near edge of the target', () => {
    for (const p of [...ALL_PRESETS, SUDDEN_45_V2, GRADUAL_45_V2, QUICK_DEMO_45_V2]) {
      expect(targetHoldMsOf(p.timing)).toBe(400);
      expect(arrivalRadius(p.geometry, p.timing)).toBe(222); // 240 − 18
    }
  });

  it('v1 presets have no hold and arrive at the target distance itself', () => {
    for (const p of [SUDDEN_45_V1, GRADUAL_45_V1, QUICK_DEMO_45_V1]) {
      expect(targetHoldMsOf(p.timing)).toBe(0);
      expect(arrivalRadius(p.geometry, p.timing)).toBe(240);
    }
  });

  it('a hold of 0 means the same as no hold', () => {
    const timing = { ...SUDDEN_45_V3.timing, targetHoldMs: 0 };
    expect(targetHoldMsOf(timing)).toBe(0);
    expect(arrivalRadius(SUDDEN_45_V3.geometry, timing)).toBe(240);
  });

  it('any cursor position inside the target circle is at or beyond the arrival radius', () => {
    // This is why the near edge is used: resting in the target implies having arrived.
    const { targetDistance: D, targetRadius: r } = SUDDEN_45_V3.geometry;
    const R = arrivalRadius(SUDDEN_45_V3.geometry, SUDDEN_45_V3.timing);
    for (let angle = 0; angle < 360; angle += 5) {
      const a = (angle * Math.PI) / 180;
      const p = { x: D + r * Math.cos(a), y: r * Math.sin(a) };
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(R - 1e-9);
    }
  });
});

describe('validatePreset', () => {
  const variant = (edit: (p: PresetConfig) => void): PresetConfig => {
    const copy: PresetConfig = structuredClone(SUDDEN_45_V3);
    edit(copy);
    return copy;
  };

  it('accepts every shipped preset, current and retired', () => {
    for (const p of [...ALL_PRESETS, ...RETIRED_PRESETS]) expect(() => validatePreset(p)).not.toThrow();
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

  it('accepts a preset with no catch trials', () => {
    expect(() => validatePreset(variant((p) => (p.structure.adaptation.catchSlots = [])))).not.toThrow();
  });

  it('rejects a ramp longer than the number of perturbed reaches', () => {
    const bad = variant((p) => (p.perturbation = { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 23 }));
    expect(() => validatePreset(bad)).toThrow(/ramp is longer/);
  });

  it('rejects duplicate target directions', () => {
    expect(() => validatePreset(variant((p) => (p.structure.targetAnglesDeg[1] = 0)))).toThrow(/unique/);
  });

  it('rejects a target hold that is negative or no shorter than the time limit', () => {
    expect(() => validatePreset(variant((p) => (p.timing.targetHoldMs = -1)))).toThrow(/targetHoldMs/);
    expect(() => validatePreset(variant((p) => (p.timing.targetHoldMs = p.timing.reachTimeoutMs)))).toThrow(/targetHoldMs/);
  });

  it('rejects a target as large as the reach itself', () => {
    expect(() => validatePreset(variant((p) => (p.geometry.targetRadius = 240)))).toThrow(/targetRadius/);
  });

  it('rejects a speed limit that is not positive or not shorter than the time limit', () => {
    expect(() => validatePreset(variant((p) => (p.timing.maxMovementMs = 0)))).toThrow(/maxMovementMs/);
    expect(() => validatePreset(variant((p) => (p.timing.maxMovementMs = p.timing.reachTimeoutMs)))).toThrow(/maxMovementMs/);
  });
});

describe('isTooSlow (the speed instruction)', () => {
  it('flags only movements longer than the limit', () => {
    expect(isTooSlow(SUDDEN_45_V3.timing, 499)).toBe(false);
    expect(isTooSlow(SUDDEN_45_V3.timing, 500)).toBe(false);
    expect(isTooSlow(SUDDEN_45_V3.timing, 501)).toBe(true);
  });

  it('has no verdict without a speed instruction or without a movement time', () => {
    expect(isTooSlow(SUDDEN_45_V2.timing, 2000)).toBeNull();
    expect(isTooSlow(SUDDEN_45_V3.timing, null)).toBeNull();
  });
});

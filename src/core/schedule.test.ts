import { describe, expect, it } from 'vitest';
import { GRADUAL_45_V3, QUICK_DEMO_45_V3, SUDDEN_45_V3, type PresetConfig } from './presets';
import { generateSchedule, rotationForPerturbedReach, type TrialSpec } from './schedule';

const SEEDS = [1, 2, 3, 42, 1234, 987654321, 0xdeadbeef];
const STEP = 45 / 7; // 7 equal steps take reach 1 (0°) to reach 8 (45°)

const phaseOf = (schedule: TrialSpec[], phase: TrialSpec['phase']) => schedule.filter((t) => t.phase === phase);
const perturbed = (schedule: TrialSpec[]) => schedule.filter((t) => t.phase === 'adaptation' && !t.isCatch);
const catches = (schedule: TrialSpec[]) => schedule.filter((t) => t.isCatch);

describe('standard 40-trial structure', () => {
  for (const preset of [SUDDEN_45_V3, GRADUAL_45_V3]) {
    describe(preset.id, () => {
      const schedule = generateSchedule(preset, 42);

      it('has 8 baseline, 24 adaptation and 8 aftereffect trials in that order', () => {
        expect(schedule).toHaveLength(40);
        expect(schedule.map((t) => t.phase)).toEqual([
          ...Array(8).fill('baseline'),
          ...Array(24).fill('adaptation'),
          ...Array(8).fill('aftereffect'),
        ]);
      });

      it('numbers trials consistently', () => {
        schedule.forEach((t, i) => {
          expect(t.index).toBe(i);
          expect(t.trialNumber).toBe(i + 1);
        });
        expect(phaseOf(schedule, 'adaptation').map((t) => t.slotInPhase)).toEqual(
          Array.from({ length: 24 }, (_, i) => i + 1),
        );
      });

      it('hides the cursor in baseline and aftereffect and shows it throughout adaptation', () => {
        expect(phaseOf(schedule, 'baseline').every((t) => t.feedback === 'hidden')).toBe(true);
        expect(phaseOf(schedule, 'adaptation').every((t) => t.feedback === 'visible')).toBe(true);
        expect(phaseOf(schedule, 'aftereffect').every((t) => t.feedback === 'hidden')).toBe(true);
      });

      it('applies zero rotation in baseline and aftereffect', () => {
        expect(phaseOf(schedule, 'baseline').every((t) => t.rotationDeg === 0)).toBe(true);
        expect(phaseOf(schedule, 'aftereffect').every((t) => t.rotationDeg === 0)).toBe(true);
      });

      it('places the two catch trials at adaptation slots 12 and 20 (session trials 20 and 28)', () => {
        const c = catches(schedule);
        expect(c.map((t) => t.slotInPhase)).toEqual([12, 20]);
        expect(c.map((t) => t.trialNumber)).toEqual([20, 28]);
        expect(c.every((t) => t.phase === 'adaptation')).toBe(true);
      });

      it('catch trials have zero rotation, a visible cursor and no ramp number', () => {
        for (const t of catches(schedule)) {
          expect(t.rotationDeg).toBe(0);
          expect(t.feedback).toBe('visible');
          expect(t.perturbedReachNumber).toBeNull();
        }
      });

      it('has exactly 22 perturbed reaches numbered 1..22 with no gaps', () => {
        expect(perturbed(schedule).map((t) => t.perturbedReachNumber)).toEqual(
          Array.from({ length: 22 }, (_, i) => i + 1),
        );
      });

      it('moves from the last adaptation trial into the aftereffect block by flipping to 0° and a hidden cursor', () => {
        const last = schedule[31];
        const first = schedule[32];
        expect(last.phase).toBe('adaptation');
        expect(last.rotationDeg).toBe(45);
        expect(first.phase).toBe('aftereffect');
        expect(first.rotationDeg).toBe(0);
        expect(first.feedback).toBe('hidden');
      });
    });
  }
});

describe('sudden preset', () => {
  const schedule = generateSchedule(SUDDEN_45_V3, 7);

  it('applies +45° on every non-catch adaptation reach, from the very first', () => {
    const p = perturbed(schedule);
    expect(p).toHaveLength(22);
    expect(p.every((t) => t.rotationDeg === 45)).toBe(true);
    expect(schedule[8].rotationDeg).toBe(45); // first adaptation trial
  });

  it('returns to the full perturbation immediately after each catch trial', () => {
    for (const c of catches(schedule)) {
      expect(schedule[c.index - 1].rotationDeg).toBe(45);
      expect(c.rotationDeg).toBe(0);
      expect(schedule[c.index + 1].rotationDeg).toBe(45);
      expect(schedule[c.index + 1].isCatch).toBe(false);
    }
  });
});

describe('gradual preset: ramp and hold', () => {
  const schedule = generateSchedule(GRADUAL_45_V3, 7);
  const angles = perturbed(schedule).map((t) => t.rotationDeg);

  it('first ramp reach applies exactly 0°', () => {
    expect(angles[0]).toBe(0);
  });

  it('8th ramp reach applies exactly 45.0°', () => {
    expect(angles[7]).toBe(45);
  });

  it('reaches 2–8 each increase by the same step, 45°/7 ≈ 6.43°', () => {
    // NOTE: the build brief quotes a step of 45/8 ≈ 5.625°, but that cannot
    // satisfy both "reach 1 = 0°" and "reach 8 = 45°" (0 + 7 × 5.625 = 39.375).
    // The endpoints are honoured; the step that follows from them is 45/7.
    for (let n = 1; n < 8; n++) {
      expect(angles[n] - angles[n - 1]).toBeCloseTo(STEP, 10);
    }
    expect(STEP).toBeCloseTo(6.4286, 4);
    expect(angles.slice(0, 8).map((a) => Number(a.toFixed(2)))).toEqual([0, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45]);
  });

  it('is strictly increasing across the ramp', () => {
    for (let n = 1; n < 8; n++) expect(angles[n]).toBeGreaterThan(angles[n - 1]);
  });

  it('holds exactly 45° for the remaining 14 non-catch reaches', () => {
    const hold = angles.slice(8);
    expect(hold).toHaveLength(14);
    expect(hold.every((a) => a === 45)).toBe(true);
  });

  it('catch trials apply 0° and are not part of the ramp sequence', () => {
    for (const c of catches(schedule)) {
      expect(c.rotationDeg).toBe(0);
      expect(c.perturbedReachNumber).toBeNull();
    }
    // The ramp sequence is built from non-catch reaches only.
    expect(perturbed(schedule).some((t) => t.isCatch)).toBe(false);
  });

  it('returns to 45° after each catch trial', () => {
    for (const c of catches(schedule)) {
      expect(schedule[c.index + 1].rotationDeg).toBe(45);
    }
  });
});

describe('gradual ramp: catch trials do not advance the ramp counter', () => {
  // Hypothetical preset with catch trials INSIDE the ramp, to prove the rule in
  // general (the canonical catch slots happen to fall after the ramp).
  const withCatchesInRamp: PresetConfig = {
    ...GRADUAL_45_V3,
    id: 'test-gradual-catch-in-ramp-v1',
    structure: {
      ...GRADUAL_45_V3.structure,
      adaptation: { trials: 24, feedback: 'visible', catchSlots: [3, 6] },
    },
  };
  const schedule = generateSchedule(withCatchesInRamp, 11);
  const adaptation = phaseOf(schedule, 'adaptation');

  it('the non-catch reaches follow the identical ramp regardless of where catches fall', () => {
    const reference = perturbed(generateSchedule(GRADUAL_45_V3, 11)).map((t) => t.rotationDeg);
    expect(perturbed(schedule).map((t) => t.rotationDeg)).toEqual(reference);
  });

  it('the reach after a catch continues one step above the reach before it', () => {
    // Slots: 1 → 0°, 2 → 1 step, [3 catch], 4 → 2 steps, 5 → 3 steps, [6 catch], 7 → 4 steps
    expect(adaptation[0].rotationDeg).toBe(0);
    expect(adaptation[1].rotationDeg).toBeCloseTo(STEP, 10);
    expect(adaptation[2].isCatch).toBe(true);
    expect(adaptation[2].rotationDeg).toBe(0);
    expect(adaptation[3].rotationDeg).toBeCloseTo(2 * STEP, 10);
    expect(adaptation[4].rotationDeg).toBeCloseTo(3 * STEP, 10);
    expect(adaptation[5].isCatch).toBe(true);
    expect(adaptation[5].rotationDeg).toBe(0);
    expect(adaptation[6].rotationDeg).toBeCloseTo(4 * STEP, 10);
  });

  it('counter values skip nothing: 1,2,(catch),3,4,(catch),5…', () => {
    expect(adaptation.slice(0, 7).map((t) => t.perturbedReachNumber)).toEqual([1, 2, null, 3, 4, null, 5]);
  });

  it('still reaches exactly 45° on the 8th non-catch reach and holds it', () => {
    const angles = perturbed(schedule).map((t) => t.rotationDeg);
    expect(angles[7]).toBe(45);
    expect(angles.slice(7).every((a) => a === 45)).toBe(true);
  });
});

describe('rotationForPerturbedReach', () => {
  it('sudden is constant', () => {
    for (const n of [1, 2, 10, 22]) expect(rotationForPerturbedReach({ kind: 'sudden', angleDeg: 45 }, n)).toBe(45);
  });

  it('gradual interpolates linearly between the two ends', () => {
    const ramp = { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 } as const;
    expect(rotationForPerturbedReach(ramp, 1)).toBe(0);
    expect(rotationForPerturbedReach(ramp, 4)).toBeCloseTo(3 * STEP, 10);
    expect(rotationForPerturbedReach(ramp, 8)).toBe(45);
    expect(rotationForPerturbedReach(ramp, 9)).toBe(45);
    expect(rotationForPerturbedReach(ramp, 100)).toBe(45);
  });

  it('a one-reach ramp is the same as sudden', () => {
    expect(rotationForPerturbedReach({ kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 1 }, 1)).toBe(45);
  });

  it('rejects non-positive or fractional reach numbers', () => {
    expect(() => rotationForPerturbedReach({ kind: 'sudden', angleDeg: 45 }, 0)).toThrow();
    expect(() => rotationForPerturbedReach({ kind: 'sudden', angleDeg: 45 }, 1.5)).toThrow();
  });
});

describe('8-target balance', () => {
  const countByTarget = (trials: TrialSpec[]) => {
    const counts = new Map<number, number>();
    for (const t of trials) counts.set(t.targetAngleDeg, (counts.get(t.targetAngleDeg) ?? 0) + 1);
    return counts;
  };

  it('each direction appears once in baseline, three times in adaptation, once in aftereffect', () => {
    for (const preset of [SUDDEN_45_V3, GRADUAL_45_V3]) {
      for (const seed of SEEDS) {
        const schedule = generateSchedule(preset, seed);
        const expected: Array<[TrialSpec['phase'], number]> = [
          ['baseline', 1],
          ['adaptation', 3],
          ['aftereffect', 1],
        ];
        for (const [phase, n] of expected) {
          const counts = countByTarget(phaseOf(schedule, phase));
          expect([...counts.keys()].sort((a, b) => a - b)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
          expect([...counts.values()].every((c) => c === n)).toBe(true);
        }
      }
    }
  });

  it('catch trials occupy ordinary slots of the balanced schedule (they are not extra trials)', () => {
    const schedule = generateSchedule(SUDDEN_45_V3, 99);
    // Counting catch trials together with perturbed trials is what gives 3 per direction.
    const withoutCatch = countByTarget(perturbed(schedule));
    const total = [...withoutCatch.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(22);
    for (const c of catches(schedule)) {
      expect(c.targetAngleDeg).toBe(SUDDEN_45_V3.structure.targetAnglesDeg[c.targetIndex]);
    }
  });

  it('target index and angle always agree', () => {
    const schedule = generateSchedule(GRADUAL_45_V3, 5);
    for (const t of schedule) {
      expect(t.targetAngleDeg).toBe(GRADUAL_45_V3.structure.targetAnglesDeg[t.targetIndex]);
    }
  });

  it('never presents the same direction twice in a row', () => {
    for (const seed of Array.from({ length: 200 }, (_, i) => i + 1)) {
      const schedule = generateSchedule(SUDDEN_45_V3, seed);
      for (let i = 1; i < schedule.length; i++) {
        expect(schedule[i].targetIndex).not.toBe(schedule[i - 1].targetIndex);
      }
    }
  });
});

describe('reproducibility', () => {
  it('the same preset and seed give the identical schedule', () => {
    expect(generateSchedule(SUDDEN_45_V3, 2024)).toEqual(generateSchedule(SUDDEN_45_V3, 2024));
  });

  it('different seeds give different target orders', () => {
    const orders = new Set(SEEDS.map((s) => generateSchedule(SUDDEN_45_V3, s).map((t) => t.targetIndex).join(',')));
    expect(orders.size).toBe(SEEDS.length);
  });

  it('sudden and gradual share the same target order for a given seed', () => {
    const a = generateSchedule(SUDDEN_45_V3, 31337).map((t) => t.targetIndex);
    const b = generateSchedule(GRADUAL_45_V3, 31337).map((t) => t.targetIndex);
    expect(a).toEqual(b);
  });

  it('the rotation schedule does not depend on the seed', () => {
    const a = generateSchedule(GRADUAL_45_V3, 1).map((t) => t.rotationDeg);
    const b = generateSchedule(GRADUAL_45_V3, 999).map((t) => t.rotationDeg);
    expect(a).toEqual(b);
  });
});

describe('Quick Demo preset', () => {
  const schedule = generateSchedule(QUICK_DEMO_45_V3, 3);

  it('has 4 baseline, 8 adaptation and 4 aftereffect trials', () => {
    expect(schedule).toHaveLength(16);
    expect(phaseOf(schedule, 'baseline')).toHaveLength(4);
    expect(phaseOf(schedule, 'adaptation')).toHaveLength(8);
    expect(phaseOf(schedule, 'aftereffect')).toHaveLength(4);
  });

  it('uses the same four targets in every phase, balanced', () => {
    for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
      const angles = phaseOf(schedule, phase).map((t) => t.targetAngleDeg).sort((a, b) => a - b);
      const per = phase === 'adaptation' ? 2 : 1;
      expect(angles).toEqual([0, 90, 180, 270].flatMap((a) => Array(per).fill(a)));
    }
  });

  it('has one catch trial at adaptation slot 6 and 7 perturbed reaches at 45°', () => {
    expect(catches(schedule).map((t) => t.slotInPhase)).toEqual([6]);
    expect(perturbed(schedule)).toHaveLength(7);
    expect(perturbed(schedule).every((t) => t.rotationDeg === 45)).toBe(true);
  });
});

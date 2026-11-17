import { describe, expect, it } from 'vitest';
import { assignPreset, presetForAssignment } from './assignment';
import {
  AFTEREFFECT_OPTIONS,
  ANGLE_OPTIONS,
  DEFAULT_SETTINGS,
  NAMED_PRESETS,
  SCHEDULE_OPTIONS,
  TIERS,
  TIER_OPTIONS,
  buildCustomLink,
  buildCustomPreset,
  customPresetId,
  decodeSettings,
  encodeSettings,
  estimateDurationMinutes,
  estimateDurationSeconds,
  matchNamedPreset,
  readCustomCode,
  resolvePreset,
  tierTrialCount,
  type InstructorSettings,
} from './custom';
import {
  ALL_PRESETS,
  GRADUAL_45_V3,
  QUICK_DEMO_45_V3,
  RETIRED_PRESETS,
  STANDARD_TIMING,
  SUDDEN_45_V3,
  perturbedReachCount,
  totalTrials,
  validatePreset,
} from './presets';
import { generateSchedule } from './schedule';
import { createSessionPlan } from './session';
import { buildSessionRecord } from './record';
import { runScriptedSession, taskResultFrom } from './testUtils';

/** Every combination the instructor page can produce: 2 × 4 × 3 × 2 × 2 = 96. */
const ALL_SETTINGS: InstructorSettings[] = [];
for (const schedule of SCHEDULE_OPTIONS) {
  for (const angleDeg of ANGLE_OPTIONS) {
    for (const tier of TIER_OPTIONS) {
      for (const aftereffect of AFTEREFFECT_OPTIONS) {
        for (const catchTrials of [true, false]) {
          ALL_SETTINGS.push({ schedule, angleDeg, tier, aftereffect, catchTrials });
        }
      }
    }
  }
}

const CANONICAL_IDS = ['rotation-sudden-45-v3', 'rotation-gradual-45-v3'];
const SHIPPED_IDS = [...ALL_PRESETS, ...RETIRED_PRESETS].map((p) => p.id);

describe('the settings space', () => {
  it('has 96 combinations', () => {
    expect(ALL_SETTINGS).toHaveLength(96);
  });

  it('starts from the canonical sudden preset', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schedule: 'sudden',
      angleDeg: 45,
      tier: 'standard',
      aftereffect: 'hidden',
      catchTrials: true,
    });
    expect(resolvePreset(DEFAULT_SETTINGS)).toBe(SUDDEN_45_V3);
  });
});

describe('canonical preset protection', () => {
  it('exactly three combinations are shipped presets, and they resolve to the very same objects', () => {
    const named = ALL_SETTINGS.filter((s) => matchNamedPreset(s) !== null);
    expect(named).toHaveLength(3);
    expect(NAMED_PRESETS.map((n) => n.preset)).toEqual([SUDDEN_45_V3, GRADUAL_45_V3, QUICK_DEMO_45_V3]);
    for (const n of NAMED_PRESETS) {
      expect(resolvePreset(n.settings)).toBe(n.preset); // identity: nothing was rebuilt or copied
      expect(resolvePreset({ ...n.settings })).toBe(n.preset);
    }
  });

  it('CHANGING ANY ONE SETTING of a canonical preset yields a custom preset with a new id', () => {
    for (const canonical of [NAMED_PRESETS[0], NAMED_PRESETS[1]]) {
      const base = canonical.settings;
      const variants: InstructorSettings[] = [
        ...ANGLE_OPTIONS.filter((a) => a !== base.angleDeg).map((angleDeg) => ({ ...base, angleDeg })),
        ...TIER_OPTIONS.filter((t) => t !== base.tier).map((tier) => ({ ...base, tier })),
        { ...base, aftereffect: 'visible' },
        { ...base, catchTrials: false },
      ];
      expect(variants).toHaveLength(7);
      for (const settings of variants) {
        const preset = resolvePreset(settings);
        // A sudden Quick-length session IS the shipped Quick Demo; everything else is custom.
        if (preset === QUICK_DEMO_45_V3) continue;
        expect(preset.kind).toBe('custom');
        expect(preset.id).toContain('-custom-');
        expect(CANONICAL_IDS).not.toContain(preset.id);
        expect(preset.id).not.toBe(canonical.preset.id);
      }
    }
  });

  it('gives the brief’s example a recognisable id', () => {
    expect(customPresetId({ ...DEFAULT_SETTINGS, angleDeg: 30 })).toBe('rotation-sudden-30-custom-v3');
    expect(resolvePreset({ ...DEFAULT_SETTINGS, angleDeg: 30 }).id).toBe('rotation-sudden-30-custom-v3');
  });

  it('NO combination other than the canonical two ever carries a canonical id', () => {
    for (const settings of ALL_SETTINGS) {
      const preset = resolvePreset(settings);
      const isCanonicalSettings = [NAMED_PRESETS[0], NAMED_PRESETS[1]].some(
        (n) => JSON.stringify(n.settings) === JSON.stringify(settings),
      );
      expect(CANONICAL_IDS.includes(preset.id)).toBe(isCanonicalSettings);
      expect(preset.kind === 'canonical').toBe(isCanonicalSettings);
    }
  });

  it('building custom presets never alters the shipped ones', () => {
    const before = JSON.stringify([SUDDEN_45_V3, GRADUAL_45_V3, QUICK_DEMO_45_V3]);
    for (const settings of ALL_SETTINGS) {
      const preset = buildCustomPreset(settings);
      // Mutating a custom preset's structure must not reach into a shipped preset.
      preset.structure.adaptation.catchSlots.push(1);
      preset.structure.targetAnglesDeg.push(999);
    }
    expect(JSON.stringify([SUDDEN_45_V3, GRADUAL_45_V3, QUICK_DEMO_45_V3])).toBe(before);
    expect(SUDDEN_45_V3.id).toBe('rotation-sudden-45-v3');
    expect(GRADUAL_45_V3.id).toBe('rotation-gradual-45-v3');
    expect(SUDDEN_45_V3.structure.adaptation.catchSlots).toEqual([12, 20]);
  });

  it('custom ids are unique: two different protocols never share one, so they are never pooled together', () => {
    const ids = ALL_SETTINGS.map(customPresetId);
    expect(new Set(ids).size).toBe(96);
    for (const id of ids) {
      expect(SHIPPED_IDS).not.toContain(id);
      expect(id).toMatch(/^rotation-(sudden|gradual)-(15|30|45|60)-custom(-quick|-extended)?(-aevisible)?(-nocatch)?-v3$/);
    }
  });

  it('names every departure from the standard defaults in the id', () => {
    expect(customPresetId({ schedule: 'gradual', angleDeg: 60, tier: 'extended', aftereffect: 'visible', catchTrials: false })).toBe(
      'rotation-gradual-60-custom-extended-aevisible-nocatch-v3',
    );
    expect(customPresetId({ ...DEFAULT_SETTINGS, tier: 'quick', angleDeg: 15 })).toBe('rotation-sudden-15-custom-quick-v3');
    expect(customPresetId({ ...DEFAULT_SETTINGS, catchTrials: false })).toBe('rotation-sudden-45-custom-nocatch-v3');
  });
});

describe('custom presets are complete, valid protocols', () => {
  it('every combination validates and generates a balanced schedule', () => {
    for (const settings of ALL_SETTINGS) {
      const preset = resolvePreset(settings);
      expect(() => validatePreset(preset)).not.toThrow();
      const schedule = generateSchedule(preset, 7);
      expect(schedule).toHaveLength(tierTrialCount(settings.tier));
      // Each direction appears equally often in each block.
      for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
        const counts = new Map<number, number>();
        for (const t of schedule.filter((x) => x.phase === phase)) counts.set(t.targetIndex, (counts.get(t.targetIndex) ?? 0) + 1);
        expect(new Set(counts.values()).size).toBe(1);
        expect(counts.size).toBe(preset.structure.targetAnglesDeg.length);
      }
    }
  });

  it('uses the same trial rules, geometry and criteria as the canonical presets', () => {
    for (const settings of ALL_SETTINGS) {
      const preset = buildCustomPreset(settings);
      expect(preset.timing).toEqual(STANDARD_TIMING);
      expect(preset.geometry).toEqual(SUDDEN_45_V3.geometry);
      expect(preset.criteria).toEqual(SUDDEN_45_V3.criteria);
      expect(preset.version).toBe(3);
      expect(preset.id.endsWith(`-v${preset.version}`)).toBe(true);
    }
  });

  it('applies the chosen angle: sudden at once, gradual from 0° up to it', () => {
    for (const angleDeg of ANGLE_OPTIONS) {
      const sudden = generateSchedule(resolvePreset({ ...DEFAULT_SETTINGS, angleDeg }), 3);
      const rotated = sudden.filter((t) => t.phase === 'adaptation' && !t.isCatch);
      expect(rotated.every((t) => t.rotationDeg === angleDeg)).toBe(true);

      const gradual = generateSchedule(resolvePreset({ ...DEFAULT_SETTINGS, schedule: 'gradual', angleDeg }), 3);
      const ramp = gradual.filter((t) => t.phase === 'adaptation' && !t.isCatch).map((t) => t.rotationDeg);
      expect(ramp[0]).toBe(0);
      expect(ramp[7]).toBe(angleDeg);
      expect(ramp[1]).toBeCloseTo(angleDeg / 7, 12);
      expect(ramp.slice(8).every((a) => a === angleDeg)).toBe(true);
    }
  });

  it('the trial-count tiers have the specified block sizes and catch trials', () => {
    const blocks = (tier: 'quick' | 'standard' | 'extended') => {
      const s = TIERS[tier].structure;
      return [s.baseline.trials, s.adaptation.trials, s.aftereffect.trials, s.adaptation.catchSlots];
    };
    expect(blocks('quick')).toEqual([4, 8, 4, [6]]);
    expect(blocks('standard')).toEqual([8, 24, 8, [12, 20]]);
    expect(blocks('extended')).toEqual([8, 48, 8, [16, 32, 44]]);
    expect(TIER_OPTIONS.map(tierTrialCount)).toEqual([16, 40, 64]);
  });

  it('extended: 64 reaches with catch trials at session trials 24, 40 and 52', () => {
    const preset = resolvePreset({ ...DEFAULT_SETTINGS, tier: 'extended' });
    expect(totalTrials(preset.structure)).toBe(64);
    expect(perturbedReachCount(preset.structure)).toBe(45);
    const schedule = generateSchedule(preset, 11);
    expect(schedule.filter((t) => t.isCatch).map((t) => t.trialNumber)).toEqual([24, 40, 52]);
    expect(schedule.filter((t) => t.isCatch).every((t) => t.rotationDeg === 0)).toBe(true);
  });

  it('a gradual ramp always finishes before the first catch trial', () => {
    for (const tier of TIER_OPTIONS) {
      const preset = resolvePreset({ schedule: 'gradual', angleDeg: 30, tier, aftereffect: 'hidden', catchTrials: true });
      const adaptation = generateSchedule(preset, 5).filter((t) => t.phase === 'adaptation');
      const firstCatch = adaptation.findIndex((t) => t.isCatch);
      const firstFull = adaptation.findIndex((t) => t.rotationDeg === 30);
      expect(firstFull).toBeGreaterThanOrEqual(0);
      expect(firstFull).toBeLessThan(firstCatch);
    }
  });

  it('catch trials off removes them without changing the number of reaches', () => {
    const preset = resolvePreset({ ...DEFAULT_SETTINGS, catchTrials: false });
    expect(preset.structure.adaptation.catchSlots).toEqual([]);
    const schedule = generateSchedule(preset, 5);
    expect(schedule).toHaveLength(40);
    expect(schedule.some((t) => t.isCatch)).toBe(false);
    expect(schedule.filter((t) => t.rotationDeg === 45)).toHaveLength(24);
  });

  it('visible-cursor aftereffect changes only the aftereffect block', () => {
    const preset = resolvePreset({ ...DEFAULT_SETTINGS, aftereffect: 'visible' });
    const schedule = generateSchedule(preset, 5);
    expect(schedule.filter((t) => t.phase === 'aftereffect').every((t) => t.feedback === 'visible' && t.rotationDeg === 0)).toBe(true);
    expect(schedule.filter((t) => t.phase === 'baseline').every((t) => t.feedback === 'hidden')).toBe(true);
  });

  it('labels and describes itself as custom', () => {
    const preset = resolvePreset({ schedule: 'gradual', angleDeg: 30, tier: 'quick', aftereffect: 'visible', catchTrials: false });
    expect(preset.label).toBe('Custom: gradual 0°→30° rotation');
    expect(preset.description).toContain('A custom protocol set up by an instructor');
    expect(preset.description).toContain('grows from 0° to +30° over the first 4 rotated reaches');
    expect(preset.description).toContain('16 reaches: 4 baseline, 8 adaptation, 4 aftereffect');
    expect(preset.description).toContain('no catch trials');
    expect(preset.description).toContain('cursor visible during the aftereffect reaches');
    expect(preset.description).toContain('Not pooled with the standard versions');
  });

  it('runs end to end: a full custom session records and analyses like a standard one', () => {
    const settings: InstructorSettings = { schedule: 'sudden', angleDeg: 60, tier: 'quick', aftereffect: 'visible', catchTrials: false };
    const assignment = assignPreset(null, () => 0, encodeSettings(settings));
    const plan = createSessionPlan({ assignment, seed: 3, sessionId: 'custom-run', previousPresetIds: [], now: new Date('2026-11-14T15:30:00.000Z') });
    const { engine, driver } = runScriptedSession(plan.preset, plan.schedule, (t) => (t.phase === 'adaptation' ? -60 : -20));
    const session = buildSessionRecord(plan, taskResultFrom(engine, 1000, driver.t), null);
    expect(session.preset.id).toBe('rotation-sudden-60-custom-quick-aevisible-nocatch-v3');
    expect(session.preset.kind).toBe('custom');
    expect(session.assignment).toMatchObject({ method: 'custom-link', customSettings: settings, conditionConcealed: true });
    expect(session.trials).toHaveLength(16);
    expect(session.trials.every((t) => t.valid && t.holdCompleted)).toBe(true);
    expect(session.summary.catchTrials).toEqual([]);
    expect(session.summary.latePerturbed.meanDeg).toBeCloseTo(-60, 4);
    // Visible aftereffect reaches have a cursor path too.
    expect(session.trials.filter((t) => t.phase === 'aftereffect').every((t) => t.metrics.cursor !== null)).toBe(true);
  });
});

describe('opaque custom link codes', () => {
  it('round-trips every combination', () => {
    for (const settings of ALL_SETTINGS) {
      expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
    }
  });

  it('gives every combination its own 4-character code that names nothing', () => {
    const codes = ALL_SETTINGS.map(encodeSettings);
    expect(new Set(codes).size).toBe(96);
    for (const code of codes) {
      expect(code).toMatch(/^a[0-9a-z]{3}$/);
      expect(code).not.toMatch(/sudden|gradual|quick|visible|catch/);
    }
  });

  it('the encoding is a published contract: these codes must never change meaning', () => {
    // If this fails, links already handed to students would run a different protocol.
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe('a0ty');
    expect(encodeSettings({ ...DEFAULT_SETTINGS, angleDeg: 30 })).toBe('a0hm');
    expect(encodeSettings({ schedule: 'gradual', angleDeg: 60, tier: 'extended', aftereffect: 'visible', catchTrials: false })).toBe('a2mv');
    expect(decodeSettings('a0hm')).toEqual({ ...DEFAULT_SETTINGS, angleDeg: 30 });
  });

  it('rejects mistyped codes instead of silently selecting another protocol', () => {
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
    for (const settings of ALL_SETTINGS) {
      const code = encodeSettings(settings);
      // Change any one of the three data characters to any other value: never accepted.
      for (let position = 1; position <= 3; position++) {
        for (const ch of digits) {
          if (ch === code[position]) continue;
          const typo = code.slice(0, position) + ch + code.slice(position + 1);
          expect(decodeSettings(typo)).toBeNull();
        }
      }
    }
  });

  it('rejects malformed codes and unknown schemes', () => {
    for (const bad of ['', 'a', 'a0f', 'a0hm2', 'b0f2', 'zzzz', 'a0f!', 'k7m2', 'demo', 'a9zz']) {
      expect(decodeSettings(bad)).toBeNull();
    }
  });

  it('is case-insensitive and tolerates stray spaces', () => {
    expect(decodeSettings(' A0HM ')).toEqual({ ...DEFAULT_SETTINGS, angleDeg: 30 });
  });

  it('reads the code from the query string', () => {
    expect(readCustomCode('?x=a0hm')).toBe('a0hm');
    expect(readCustomCode('?c=k7m2&x=A0HM')).toBe('a0hm');
    expect(readCustomCode('?c=k7m2')).toBeNull();
    expect(readCustomCode('?x=')).toBeNull();
    expect(readCustomCode('')).toBeNull();
  });

  it('builds a custom link on a base address', () => {
    expect(buildCustomLink('https://lab.example/', { ...DEFAULT_SETTINGS, angleDeg: 30 })).toBe('https://lab.example/?x=a0hm');
  });
});

describe('assignment through a custom link', () => {
  const settings: InstructorSettings = { ...DEFAULT_SETTINGS, angleDeg: 30 };

  it('assigns the custom preset, concealed, and carries the settings needed to rebuild it', () => {
    const a = assignPreset(null, () => 0.9, encodeSettings(settings));
    expect(a).toEqual({
      presetId: 'rotation-sudden-30-custom-v3',
      method: 'custom-link',
      linkCode: 'a0hm',
      ignoredLinkCode: null,
      conditionConcealed: true,
      customSettings: settings,
    });
    const preset = presetForAssignment(a);
    expect(preset.id).toBe('rotation-sudden-30-custom-v3');
    expect(preset.perturbation).toEqual({ kind: 'sudden', angleDeg: 30 });
  });

  it('is not affected by the coin', () => {
    for (const coin of [0, 0.49, 0.5, 0.99]) {
      expect(assignPreset(null, () => coin, 'a0hm').presetId).toBe('rotation-sudden-30-custom-v3');
    }
  });

  it('a custom code that spells out a canonical preset is recorded as that canonical preset', () => {
    const a = assignPreset(null, () => 0.9, encodeSettings(DEFAULT_SETTINGS));
    expect(a).toMatchObject({ presetId: 'rotation-sudden-45-v3', method: 'direct-link', customSettings: null });
    expect(presetForAssignment(a)).toBe(SUDDEN_45_V3);
  });

  it('an unreadable custom code falls back to ordinary assignment and is noted, never an error', () => {
    const random = assignPreset(null, () => 0.9, 'a0hn');
    expect(random).toMatchObject({ presetId: 'rotation-gradual-45-v3', method: 'random-50-50', ignoredLinkCode: 'a0hn', customSettings: null });
    const direct = assignPreset('k7m2', () => 0.9, 'nope');
    expect(direct).toMatchObject({ presetId: 'rotation-sudden-45-v3', method: 'direct-link', linkCode: 'k7m2', ignoredLinkCode: 'nope' });
  });

  it('a valid custom code takes precedence over a link code in the same address', () => {
    expect(assignPreset('p4x9', () => 0, 'a0hm').presetId).toBe('rotation-sudden-30-custom-v3');
  });

  it('refuses to run settings under an id they do not produce', () => {
    const a = assignPreset(null, () => 0, 'a0hm');
    expect(() => presetForAssignment({ ...a, presetId: 'rotation-sudden-45-v3' })).toThrow(/resolve to/);
  });
});

describe('duration estimate', () => {
  it('is trials × 4 s + 90 s practice + 30 s reflection', () => {
    expect(estimateDurationSeconds({ ...DEFAULT_SETTINGS, tier: 'quick' })).toBe(16 * 4 + 90 + 30);
    expect(estimateDurationSeconds(DEFAULT_SETTINGS)).toBe(40 * 4 + 90 + 30);
    expect(estimateDurationSeconds({ ...DEFAULT_SETTINGS, tier: 'extended' })).toBe(64 * 4 + 90 + 30);
  });

  it('rounds to whole minutes: about 3, 5 and 6', () => {
    expect(estimateDurationMinutes({ ...DEFAULT_SETTINGS, tier: 'quick' })).toBe(3);
    expect(estimateDurationMinutes(DEFAULT_SETTINGS)).toBe(5);
    expect(estimateDurationMinutes({ ...DEFAULT_SETTINGS, tier: 'extended' })).toBe(6);
  });

  it('depends only on the trial count', () => {
    const base = estimateDurationSeconds(DEFAULT_SETTINGS);
    expect(estimateDurationSeconds({ ...DEFAULT_SETTINGS, angleDeg: 15, schedule: 'gradual', aftereffect: 'visible', catchTrials: false })).toBe(base);
  });
});

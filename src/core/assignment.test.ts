import { describe, expect, it } from 'vitest';
import {
  LINK_CODES,
  assignOtherCondition,
  assignPreset,
  buildParticipantLink,
  linkCodeForPreset,
  presetForAssignment,
  readLinkCode,
  readSeedOverride,
} from './assignment';
import { ALL_PRESETS, GRADUAL_45_V3, QUICK_DEMO_45_V3, SUDDEN_45_V3 } from './presets';
import { mulberry32 } from './rng';
import { createSessionPlan } from './session';

describe('random 50/50 assignment', () => {
  it('assigns sudden below 0.5 and gradual from 0.5 up', () => {
    expect(assignPreset(null, () => 0).presetId).toBe(SUDDEN_45_V3.id);
    expect(assignPreset(null, () => 0.4999).presetId).toBe(SUDDEN_45_V3.id);
    expect(assignPreset(null, () => 0.5).presetId).toBe(GRADUAL_45_V3.id);
    expect(assignPreset(null, () => 0.9999).presetId).toBe(GRADUAL_45_V3.id);
  });

  it('records the method and that the condition is concealed', () => {
    expect(assignPreset(null, () => 0.2)).toEqual({
      presetId: SUDDEN_45_V3.id,
      method: 'random-50-50',
      linkCode: null,
      ignoredLinkCode: null,
      conditionConcealed: true,
      customSettings: null,
    });
  });

  it('is close to even over many draws and only ever picks a canonical preset', () => {
    const rng = mulberry32(12345);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const id = assignPreset(null, rng).presetId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual([GRADUAL_45_V3.id, SUDDEN_45_V3.id].sort());
    expect(counts[SUDDEN_45_V3.id] / 20000).toBeGreaterThan(0.48);
    expect(counts[SUDDEN_45_V3.id] / 20000).toBeLessThan(0.52);
  });

  it('never assigns the Quick Demo at random', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i++) expect(assignPreset(null, rng).presetId).not.toBe(QUICK_DEMO_45_V3.id);
  });
});

describe('direct instructor links', () => {
  it('each link code selects its preset regardless of the coin', () => {
    for (const coin of [0, 0.99]) {
      expect(assignPreset('k7m2', () => coin).presetId).toBe(SUDDEN_45_V3.id);
      expect(assignPreset('p4x9', () => coin).presetId).toBe(GRADUAL_45_V3.id);
      expect(assignPreset('demo', () => coin).presetId).toBe(QUICK_DEMO_45_V3.id);
    }
  });

  it('records the method and code, still concealed from the participant', () => {
    expect(assignPreset('p4x9', () => 0)).toEqual({
      presetId: GRADUAL_45_V3.id,
      method: 'direct-link',
      linkCode: 'p4x9',
      ignoredLinkCode: null,
      conditionConcealed: true,
      customSettings: null,
    });
  });

  it('an unrecognised code falls back to random assignment and is noted', () => {
    const a = assignPreset('zzzz', () => 0.7);
    expect(a.method).toBe('random-50-50');
    expect(a.presetId).toBe(GRADUAL_45_V3.id);
    expect(a.linkCode).toBeNull();
    expect(a.ignoredLinkCode).toBe('zzzz');
  });

  it('link codes for the canonical presets do not reveal the condition', () => {
    for (const preset of [SUDDEN_45_V3, GRADUAL_45_V3]) {
      const code = linkCodeForPreset(preset.id)!;
      expect(code).not.toMatch(/sud|grad|rot|45|abrupt|ramp|slow|fast/i);
      expect(buildParticipantLink('https://example.edu/lab/', preset.id)).not.toMatch(/sudden|gradual|rotation/i);
    }
  });

  it('every code maps to an existing preset and every preset has exactly one code', () => {
    for (const id of Object.values(LINK_CODES)) expect(ALL_PRESETS.some((p) => p.id === id)).toBe(true);
    for (const p of ALL_PRESETS) {
      expect(Object.values(LINK_CODES).filter((id) => id === p.id)).toHaveLength(1);
    }
  });

  it('published link codes are stable', () => {
    expect(LINK_CODES).toEqual({
      k7m2: 'rotation-sudden-45-v3',
      p4x9: 'rotation-gradual-45-v3',
      demo: 'rotation-quickdemo-45-v3',
    });
  });
});

describe('links and URL parameters', () => {
  it('builds the general and direct links', () => {
    const base = 'https://example.edu/lab/';
    expect(buildParticipantLink(base, null)).toBe(base);
    expect(buildParticipantLink(base, SUDDEN_45_V3.id)).toBe(`${base}?c=k7m2`);
    expect(buildParticipantLink(base, GRADUAL_45_V3.id)).toBe(`${base}?c=p4x9`);
    expect(buildParticipantLink(base, QUICK_DEMO_45_V3.id)).toBe(`${base}?c=demo`);
  });

  it('a built link round-trips through readLinkCode and assignPreset', () => {
    for (const preset of ALL_PRESETS) {
      const url = new URL(buildParticipantLink('https://example.edu/lab/', preset.id));
      const assignment = assignPreset(readLinkCode(url.search), () => 0.5);
      expect(assignment.presetId).toBe(preset.id);
      expect(presetForAssignment(assignment)).toBe(preset);
    }
  });

  it('reads the link code case-insensitively and ignores empty values', () => {
    expect(readLinkCode('?c=K7M2')).toBe('k7m2');
    expect(readLinkCode('?x=1&c=p4x9')).toBe('p4x9');
    expect(readLinkCode('')).toBeNull();
    expect(readLinkCode('?c=')).toBeNull();
  });

  it('reads a seed override only when it is a valid unsigned 32-bit integer', () => {
    expect(readSeedOverride('?seed=42')).toBe(42);
    expect(readSeedOverride('?c=k7m2&seed=4294967295')).toBe(4294967295);
    expect(readSeedOverride('?seed=4294967296')).toBeNull();
    expect(readSeedOverride('?seed=-3')).toBeNull();
    expect(readSeedOverride('?seed=abc')).toBeNull();
    expect(readSeedOverride('')).toBeNull();
  });
});

describe('trying the other condition after the debrief', () => {
  it('offers the opposite canonical preset, marked as not concealed', () => {
    expect(assignOtherCondition(SUDDEN_45_V3.id)).toEqual({
      presetId: GRADUAL_45_V3.id,
      method: 'participant-chose-other-condition',
      linkCode: null,
      ignoredLinkCode: null,
      conditionConcealed: false,
      customSettings: null,
    });
    expect(assignOtherCondition(GRADUAL_45_V3.id)!.presetId).toBe(SUDDEN_45_V3.id);
  });

  it('has nothing to offer after the Quick Demo', () => {
    expect(assignOtherCondition(QUICK_DEMO_45_V3.id)).toBeNull();
  });
});

describe('createSessionPlan', () => {
  const now = new Date('2026-11-14T15:30:00.000Z');

  it('expands the assignment into a full, reproducible plan', () => {
    const plan = createSessionPlan({
      assignment: assignPreset('p4x9', () => 0),
      seed: 2024,
      sessionId: 'session-a',
      previousPresetIds: [],
      now,
    });
    expect(plan.preset).toBe(GRADUAL_45_V3);
    expect(plan.schedule).toHaveLength(40);
    expect(plan.seed).toBe(2024);
    expect(plan.runNumber).toBe(1);
    expect(plan.previousPresetIds).toEqual([]);
    expect(plan.createdAtIso).toBe('2026-11-14T15:30:00.000Z');

    const again = createSessionPlan({
      assignment: assignPreset('p4x9', () => 0),
      seed: 2024,
      sessionId: 'session-b',
      previousPresetIds: [],
      now,
    });
    expect(again.schedule).toEqual(plan.schedule);
  });

  it('numbers repeat runs and remembers what came before', () => {
    const plan = createSessionPlan({
      assignment: assignOtherCondition(SUDDEN_45_V3.id)!,
      seed: 5,
      sessionId: 's',
      previousPresetIds: [SUDDEN_45_V3.id],
      now,
    });
    expect(plan.runNumber).toBe(2);
    expect(plan.previousPresetIds).toEqual([SUDDEN_45_V3.id]);
    expect(plan.preset).toBe(GRADUAL_45_V3);
    expect(plan.assignment.conditionConcealed).toBe(false);
  });
});

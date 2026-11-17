/**
 * The anonymous class summary: what it keeps, what it leaves out, and that the
 * server accepts exactly what the browser builds.
 */
import { describe, expect, it } from 'vitest';
import { buildClassSubmission, fullRotationDeg, tierOfPreset } from './classShare';
import { parseSubmission } from './classWire';
import { ALL_PRESETS, GRADUAL_45_V2, QUICK_DEMO_45_V2, SUDDEN_45_V2 } from './presets';
import { finalAttempts, type SessionRecord } from './record';
import type { TrialSpec } from './schedule';
import { scriptedSessionRecord } from './testUtils';

const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);

/** A scripted session with a session id of the kind the app really generates. */
function session(linkCode: string, reflection: SessionRecord['reflection'] = null): SessionRecord {
  return { ...scriptedSessionRecord(linkCode, aim), sessionId: '6f1c2a9e-3b7d-4c10-9a55-0e2f8d7b6a41', reflection };
}

const NOW = new Date('2026-11-17T18:45:00.000Z');

describe('buildClassSubmission', () => {
  it('has one entry per scheduled reach, in order, carrying that reach’s initial hand direction error', () => {
    const s = session('k7m2');
    const sub = buildClassSubmission(s, 'neuro451', NOW);
    const finals = finalAttempts(s);
    expect(sub.trials).toHaveLength(s.schedule.length);
    sub.trials.forEach((t, k) => {
      const trial = finals[k];
      expect(t.i).toBe(trial.trialIndex);
      expect(t.phase).toBe(trial.phase);
      expect(t.catch).toBe(trial.isCatch);
      expect(t.rot).toBeCloseTo(trial.appliedRotationDeg, 2);
      expect(t.valid).toBe(trial.valid);
      expect(t.err).toBeCloseTo(trial.metrics.hand!.initialDirectionErrorDeg, 2);
    });
  });

  it('rounds to two decimals', () => {
    const sub = buildClassSubmission(session('p4x9'), 'X', NOW);
    for (const t of sub.trials) {
      expect(Math.round(t.rot * 100) / 100).toBe(t.rot);
      if (t.err !== null) expect(Math.round(t.err * 100) / 100).toBe(t.err);
    }
    // The gradual ramp's fractional steps survive as two-decimal values.
    expect(sub.trials.map((t) => t.rot)).toContain(6.43);
  });

  it('labels the protocol: preset id, full rotation and length tier', () => {
    expect(buildClassSubmission(session('k7m2'), 'X', NOW)).toMatchObject({
      presetId: SUDDEN_45_V2.id,
      rotationDeg: 45,
      trialTier: 'standard',
    });
    expect(buildClassSubmission(session('p4x9'), 'X', NOW)).toMatchObject({ presetId: GRADUAL_45_V2.id, rotationDeg: 45 });
    expect(buildClassSubmission(session('demo'), 'X', NOW)).toMatchObject({ presetId: QUICK_DEMO_45_V2.id, trialTier: 'quick' });
  });

  it('carries the strategy answer only, and null when there is none', () => {
    const answered = session('k7m2', { skipped: false, noticed: 'the cursor went sideways', consciousAdjustment: 'somewhat', changedAim: null, device: 'trackpad' });
    expect(buildClassSubmission(answered, 'X', NOW).consciousAdjustment).toBe('somewhat');
    expect(buildClassSubmission(session('k7m2'), 'X', NOW).consciousAdjustment).toBeNull();
  });

  it('leaves out movement samples, timings, free text and anything about the computer', () => {
    const s = session('k7m2', { skipped: false, noticed: 'PRIVATE-NOTE-123', consciousAdjustment: 'yes', changedAim: null, device: 'trackpad' });
    const json = JSON.stringify(buildClassSubmission(s, 'neuro451', NOW));
    for (const forbidden of ['PRIVATE-NOTE-123', 'trackpad', 'test-agent', 'samples', 'handX', 'tMs', 'environment', 'seed', 'userAgent']) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(buildClassSubmission(s, 'X', NOW)).sort()).toEqual(
      ['classCode', 'consciousAdjustment', 'presetId', 'rotationDeg', 'sessionId', 'submittedAt', 'trialTier', 'trials'].sort(),
    );
  });

  it('is accepted by the server’s checks unchanged (apart from the upper-cased class code)', () => {
    for (const code of ['k7m2', 'p4x9', 'demo']) {
      const sub = buildClassSubmission(session(code), ' neuro451 ', NOW);
      const parsed = parseSubmission(JSON.parse(JSON.stringify(sub)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual({ ...sub, classCode: 'NEURO451' });
    }
  });

  it('uses the time it is given', () => {
    expect(buildClassSubmission(session('k7m2'), 'X', NOW).submittedAt).toBe('2026-11-17T18:45:00.000Z');
  });
});

describe('protocol labels', () => {
  it('gives every shipped preset a whole-degree full rotation and a tier', () => {
    for (const preset of ALL_PRESETS) {
      expect(Number.isInteger(fullRotationDeg(preset))).toBe(true);
      expect(['quick', 'standard', 'extended']).toContain(tierOfPreset(preset));
    }
    expect(fullRotationDeg(GRADUAL_45_V2)).toBe(45);
  });
});

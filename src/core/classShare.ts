/**
 * classShare.ts — builds the compact anonymous summary a student may choose
 * to share with their class. Pure and DOM-free.
 *
 * Of everything in a session record (thousands of mouse samples, timings,
 * browser details, free-text answers) this keeps two numbers per reach, the
 * initial hand direction error and the whole-path error of what the student
 * saw, plus the labels needed to plot them. The wire
 * format and its limits are in classWire.ts, which the server shares.
 *
 * Key exports: `buildClassSubmission`, `tierOfPreset`, `fullRotationDeg`.
 */

import type { ClassSubmission, WireTier, WireTrial } from './classWire';
import { totalTrials, type PresetConfig } from './presets';
import { finalAttempts, seenPathErrorPct, type SessionRecord } from './record';

/** The trial-count tier a preset belongs to, judged by its number of reaches (16 / 40 / 64). */
export function tierOfPreset(preset: PresetConfig): WireTier {
  const n = totalTrials(preset.structure);
  if (n <= 16) return 'quick';
  if (n <= 40) return 'standard';
  return 'extended';
}

/** The full size of the protocol's rotation in whole degrees (a gradual ramp's end point). */
export function fullRotationDeg(preset: PresetConfig): number {
  const p = preset.perturbation;
  return Math.round(Math.abs(p.kind === 'sudden' ? p.angleDeg : p.endDeg));
}

/** Two decimals is far finer than the measurement and keeps the payload small. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The submission for a finished session: one entry per scheduled reach (the
 * attempt that counted), in session order.
 *
 * @param classCode as typed by the student; the server validates and upper-cases it
 * @param now       wall clock, supplied by the caller
 */
export function buildClassSubmission(session: SessionRecord, classCode: string, now: Date): ClassSubmission {
  const D = session.preset.geometry.targetDistance;
  const trials: WireTrial[] = finalAttempts(session).map((t) => {
    const err = t.valid && t.metrics.hand ? t.metrics.hand.initialDirectionErrorDeg : null;
    const pe = seenPathErrorPct(t, D);
    return {
      i: t.trialIndex,
      phase: t.phase,
      catch: t.isCatch,
      rot: round2(t.appliedRotationDeg),
      err: err === null ? null : round2(err),
      pe: pe === null ? null : round2(pe),
      valid: err !== null,
    };
  });
  return {
    sessionId: session.sessionId,
    classCode: classCode.trim(),
    presetId: session.preset.id,
    rotationDeg: fullRotationDeg(session.preset),
    trialTier: tierOfPreset(session.preset),
    submittedAt: now.toISOString(),
    consciousAdjustment: session.reflection?.consciousAdjustment ?? null,
    trials,
  };
}

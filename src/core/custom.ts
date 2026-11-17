/**
 * custom.ts — instructor settings, and the presets and links built from them.
 *
 * The instructor page offers a handful of settings. Any combination is turned
 * into a full `PresetConfig` here:
 *
 *   - If the settings are exactly those of a shipped preset, that preset is
 *     returned UNCHANGED, with its canonical id.
 *   - Otherwise a new preset is built with `kind: 'custom'` and an id derived
 *     from the settings, such as `rotation-sudden-30-custom-v2`.
 *
 * CANONICAL PROTECTION. A canonical id can therefore never label anything but
 * the canonical protocol, and a custom session can never be mistaken for one:
 * class comparisons pool by preset id, and custom ids are distinct by
 * construction (`custom.test.ts` checks every combination).
 *
 * LINKS. A custom link carries the settings in one opaque query parameter
 * (`?x=a0hm`) rather than as readable words, so a student's address bar does
 * not announce "sudden, 30 degrees, visible aftereffect" before the debrief.
 * The encoding is a published contract: links already handed out must keep
 * meaning the same thing, so never reorder the option lists below. To change
 * the option set, add a new scheme letter and keep decoding the old one.
 *
 * Key exports: `InstructorSettings`, `DEFAULT_SETTINGS`, `NAMED_PRESETS`,
 * `resolvePreset`, `customPresetId`, `matchNamedPreset`, `encodeSettings`,
 * `decodeSettings`, `estimateDurationSeconds`, `TIERS`.
 */

import {
  GRADUAL_45_V2,
  QUICK_DEMO_45_V2,
  QUICK_STRUCTURE,
  STANDARD_CRITERIA,
  STANDARD_GEOMETRY,
  STANDARD_STRUCTURE,
  STANDARD_TIMING,
  SUDDEN_45_V2,
  totalTrials,
  validatePreset,
  type FeedbackMode,
  type PerturbationSchedule,
  type PresetConfig,
  type ProtocolStructure,
} from './presets';

export type ScheduleKind = 'sudden' | 'gradual';
export type TrialTier = 'quick' | 'standard' | 'extended';

/**
 * The option lists. ORDER IS PART OF THE LINK ENCODING: append, never reorder
 * or remove (see the header).
 */
export const SCHEDULE_OPTIONS = ['sudden', 'gradual'] as const satisfies readonly ScheduleKind[];
export const ANGLE_OPTIONS = [15, 30, 45, 60] as const;
export const TIER_OPTIONS = ['quick', 'standard', 'extended'] as const satisfies readonly TrialTier[];
export const AFTEREFFECT_OPTIONS = ['hidden', 'visible'] as const satisfies readonly FeedbackMode[];

export type RotationAngle = (typeof ANGLE_OPTIONS)[number];

export interface InstructorSettings {
  /** How the rotation is introduced. */
  schedule: ScheduleKind;
  /** Full size of the rotation, degrees counterclockwise. */
  angleDeg: RotationAngle;
  tier: TrialTier;
  /** Whether the cursor is shown during the aftereffect reaches. */
  aftereffect: FeedbackMode;
  catchTrials: boolean;
}

/** The settings of the canonical sudden preset; the instructor page starts here. */
export const DEFAULT_SETTINGS: InstructorSettings = Object.freeze({
  schedule: 'sudden',
  angleDeg: 45,
  tier: 'standard',
  aftereffect: 'hidden',
  catchTrials: true,
});

// ---------------------------------------------------------------------------
// Trial-count tiers
// ---------------------------------------------------------------------------

export interface TierSpec {
  label: string;
  /** Block sizes, targets and catch slots when catch trials are on. */
  structure: ProtocolStructure;
  /**
   * Non-catch reaches spanned by a gradual ramp, both ends included. The two
   * eight-target tiers share the canonical ramp (8), so "Extended" simply adds
   * reaches at full rotation; Quick has only 7 or 8 rotated reaches, so its
   * ramp is 4. Every ramp ends before that tier's first catch trial.
   */
  rampReaches: number;
}

export const TIERS: Readonly<Record<TrialTier, TierSpec>> = Object.freeze({
  // 4 baseline / 8 adaptation (1 catch) / 4 aftereffect = 16, to four targets.
  quick: { label: 'Quick', structure: QUICK_STRUCTURE, rampReaches: 4 },
  // 8 / 24 (2 catch) / 8 = 40: the canonical structure.
  standard: { label: 'Standard', structure: STANDARD_STRUCTURE, rampReaches: 8 },
  // 8 / 48 (3 catch at slots 16, 32, 44) / 8 = 64.
  extended: {
    label: 'Extended',
    structure: {
      targetAnglesDeg: STANDARD_STRUCTURE.targetAnglesDeg,
      baseline: { trials: 8, feedback: 'hidden' },
      adaptation: { trials: 48, feedback: 'visible', catchSlots: [16, 32, 44] },
      aftereffect: { trials: 8, feedback: 'hidden' },
    },
    rampReaches: 8,
  },
});

/** Number of recorded reaches in a tier. */
export function tierTrialCount(tier: TrialTier): number {
  return totalTrials(TIERS[tier].structure);
}

// ---------------------------------------------------------------------------
// Named (shipped) presets and the settings that reproduce them
// ---------------------------------------------------------------------------

export interface NamedPreset {
  /** Stable key for the instructor page's preset selector. */
  key: 'sudden' | 'gradual' | 'quick-demo';
  /** Short name for the selector. */
  name: string;
  preset: PresetConfig;
  settings: InstructorSettings;
}

export const NAMED_PRESETS: readonly NamedPreset[] = Object.freeze([
  { key: 'sudden', name: 'Sudden 45°', preset: SUDDEN_45_V2, settings: DEFAULT_SETTINGS },
  {
    key: 'gradual',
    name: 'Gradual 0°→45°',
    preset: GRADUAL_45_V2,
    settings: { schedule: 'gradual', angleDeg: 45, tier: 'standard', aftereffect: 'hidden', catchTrials: true },
  },
  {
    key: 'quick-demo',
    name: 'Quick Demo',
    preset: QUICK_DEMO_45_V2,
    settings: { schedule: 'sudden', angleDeg: 45, tier: 'quick', aftereffect: 'hidden', catchTrials: true },
  },
]);

export function sameSettings(a: InstructorSettings, b: InstructorSettings): boolean {
  return (
    a.schedule === b.schedule &&
    a.angleDeg === b.angleDeg &&
    a.tier === b.tier &&
    a.aftereffect === b.aftereffect &&
    a.catchTrials === b.catchTrials
  );
}

/** The shipped preset these settings describe exactly, or null if they describe a custom protocol. */
export function matchNamedPreset(settings: InstructorSettings): NamedPreset | null {
  return NAMED_PRESETS.find((n) => sameSettings(n.settings, settings)) ?? null;
}

// ---------------------------------------------------------------------------
// Building a preset from settings
// ---------------------------------------------------------------------------

/** Trial-rule generation of custom presets: the same hold-to-complete rules as the v2 shipped presets. */
export const CUSTOM_VERSION = 2;

/**
 * Identifier of the custom preset for these settings. Every setting that
 * differs from the standard defaults leaves a mark, so two different custom
 * protocols never share an id and data from them is never pooled:
 *
 *   rotation-<schedule>-<angle>-custom[-quick|-extended][-aevisible][-nocatch]-v2
 *
 * It always contains "-custom-", which no shipped preset id does.
 */
export function customPresetId(settings: InstructorSettings): string {
  const parts = ['rotation', settings.schedule, String(settings.angleDeg), 'custom'];
  if (settings.tier !== 'standard') parts.push(settings.tier);
  if (settings.aftereffect === 'visible') parts.push('aevisible');
  if (!settings.catchTrials) parts.push('nocatch');
  parts.push(`v${CUSTOM_VERSION}`);
  return parts.join('-');
}

function structureFor(settings: InstructorSettings): ProtocolStructure {
  const base = TIERS[settings.tier].structure;
  return {
    targetAnglesDeg: [...base.targetAnglesDeg],
    baseline: { ...base.baseline },
    adaptation: {
      trials: base.adaptation.trials,
      feedback: base.adaptation.feedback,
      catchSlots: settings.catchTrials ? [...base.adaptation.catchSlots] : [],
    },
    aftereffect: { trials: base.aftereffect.trials, feedback: settings.aftereffect },
  };
}

function perturbationFor(settings: InstructorSettings): PerturbationSchedule {
  if (settings.schedule === 'sudden') return { kind: 'sudden', angleDeg: settings.angleDeg };
  return { kind: 'gradual', startDeg: 0, endDeg: settings.angleDeg, rampReaches: TIERS[settings.tier].rampReaches };
}

/** A sentence listing what the custom protocol is, for the instructor page and the debrief. */
function describeCustom(settings: InstructorSettings): string {
  const structure = structureFor(settings);
  const n = totalTrials(structure);
  const catches = structure.adaptation.catchSlots.length;
  const rotation =
    settings.schedule === 'sudden'
      ? `a sudden +${settings.angleDeg}° rotation`
      : `a rotation that grows from 0° to +${settings.angleDeg}° over the first ${TIERS[settings.tier].rampReaches} rotated reaches`;
  return (
    `A custom protocol set up by an instructor: ${rotation}; ${TIERS[settings.tier].label.toLowerCase()} length ` +
    `(${n} reaches: ${structure.baseline.trials} baseline, ${structure.adaptation.trials} adaptation, ${structure.aftereffect.trials} aftereffect); ` +
    `${catches === 0 ? 'no catch trials' : `${catches} catch trial${catches === 1 ? '' : 's'}`}; ` +
    `cursor ${settings.aftereffect} during the aftereffect reaches. Not pooled with the standard versions.`
  );
}

/** Build the custom preset for these settings (even if they happen to match a shipped one). */
export function buildCustomPreset(settings: InstructorSettings): PresetConfig {
  const preset: PresetConfig = {
    id: customPresetId(settings),
    version: CUSTOM_VERSION,
    kind: 'custom',
    label:
      settings.schedule === 'sudden'
        ? `Custom: sudden ${settings.angleDeg}° rotation`
        : `Custom: gradual 0°→${settings.angleDeg}° rotation`,
    description: describeCustom(settings),
    structure: structureFor(settings),
    perturbation: perturbationFor(settings),
    geometry: STANDARD_GEOMETRY,
    timing: STANDARD_TIMING,
    criteria: STANDARD_CRITERIA,
  };
  validatePreset(preset);
  return preset;
}

/**
 * The preset to run for these settings: the shipped preset when they match one
 * exactly (so canonical data keeps its canonical id), otherwise a custom one.
 */
export function resolvePreset(settings: InstructorSettings): PresetConfig {
  return matchNamedPreset(settings)?.preset ?? buildCustomPreset(settings);
}

// ---------------------------------------------------------------------------
// Opaque link codes
// ---------------------------------------------------------------------------

/** Name of the URL query parameter that carries a custom-settings code. */
export const CUSTOM_PARAM = 'x';

/** Scheme letter of the current encoding. A different option set gets a different letter. */
const SCHEME = 'a';
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Settings → a 4-character code: scheme letter, two base-36 digits holding the
 * settings as one mixed-radix number, and a check digit so that a mistyped code
 * is rejected instead of silently selecting some other protocol.
 */
export function encodeSettings(settings: InstructorSettings): string {
  // Mixed radix, most significant first: schedule · angle · tier · aftereffect · catch.
  let n = SCHEDULE_OPTIONS.indexOf(settings.schedule);
  n = n * ANGLE_OPTIONS.length + ANGLE_OPTIONS.indexOf(settings.angleDeg);
  n = n * TIER_OPTIONS.length + TIER_OPTIONS.indexOf(settings.tier);
  n = n * AFTEREFFECT_OPTIONS.length + AFTEREFFECT_OPTIONS.indexOf(settings.aftereffect);
  n = n * 2 + (settings.catchTrials ? 1 : 0);
  return SCHEME + DIGITS[Math.floor(n / 36)] + DIGITS[n % 36] + checkDigit(n);
}

/** A digit that changes whenever either payload digit does (7 and 36 share no factor). */
function checkDigit(n: number): string {
  return DIGITS[(n * 7 + 11 + Math.floor(n / 36) * 5) % 36];
}

/** Code → settings, or null if the code is malformed, mistyped or from an unknown scheme. */
export function decodeSettings(code: string): InstructorSettings | null {
  const text = code.trim().toLowerCase();
  if (text.length !== 4 || text[0] !== SCHEME) return null;
  const hi = DIGITS.indexOf(text[1]);
  const lo = DIGITS.indexOf(text[2]);
  if (hi < 0 || lo < 0) return null;
  let n = hi * 36 + lo;
  if (checkDigit(n) !== text[3]) return null;

  const total =
    SCHEDULE_OPTIONS.length * ANGLE_OPTIONS.length * TIER_OPTIONS.length * AFTEREFFECT_OPTIONS.length * 2;
  if (n >= total) return null;

  const catchTrials = n % 2 === 1;
  n = Math.floor(n / 2);
  const aftereffect = AFTEREFFECT_OPTIONS[n % AFTEREFFECT_OPTIONS.length];
  n = Math.floor(n / AFTEREFFECT_OPTIONS.length);
  const tier = TIER_OPTIONS[n % TIER_OPTIONS.length];
  n = Math.floor(n / TIER_OPTIONS.length);
  const angleDeg = ANGLE_OPTIONS[n % ANGLE_OPTIONS.length];
  n = Math.floor(n / ANGLE_OPTIONS.length);
  const schedule = SCHEDULE_OPTIONS[n];
  return { schedule, angleDeg, tier, aftereffect, catchTrials };
}

/** Extract the custom-settings code from a query string such as `?x=a0hm` (null if absent). */
export function readCustomCode(search: string): string | null {
  const code = new URLSearchParams(search).get(CUSTOM_PARAM);
  return code === null || code.trim() === '' ? null : code.trim().toLowerCase();
}

/** A participant link that runs the protocol for these settings. `baseUrl` has no query or hash. */
export function buildCustomLink(baseUrl: string, settings: InstructorSettings): string {
  return `${baseUrl}?${CUSTOM_PARAM}=${encodeSettings(settings)}`;
}

// ---------------------------------------------------------------------------
// Duration estimate
// ---------------------------------------------------------------------------

/** Planning figures for the instructor page's estimate. Rough by design. */
export const SECONDS_PER_TRIAL = 4;
export const PRACTICE_SECONDS = 90;
export const REFLECTION_SECONDS = 30;

/** Approximate time for a student to complete a session: reaches + practice + reflection. */
export function estimateDurationSeconds(settings: InstructorSettings): number {
  return tierTrialCount(settings.tier) * SECONDS_PER_TRIAL + PRACTICE_SECONDS + REFLECTION_SECONDS;
}

/** The same estimate in whole minutes, never less than 1. */
export function estimateDurationMinutes(settings: InstructorSettings): number {
  return Math.max(1, Math.round(estimateDurationSeconds(settings) / 60));
}

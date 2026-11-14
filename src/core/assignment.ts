/**
 * assignment.ts — which preset a session runs, and how that was decided.
 *
 * - An ordinary visitor is assigned 50/50 at random between the two canonical
 *   presets when they press Start.
 * - An instructor can hand out a direct link to one preset. The link carries
 *   an OPAQUE code (`?c=k7m2`), never the word "sudden" or "gradual", so the
 *   address bar does not give the condition away.
 * - After the debrief a participant may choose to try the other condition;
 *   that run is recorded as not concealed.
 *
 * Key exports: `Assignment`, `assignPreset`, `assignOtherCondition`,
 * `LINK_CODES`, `readLinkCode`, `readSeedOverride`, `buildParticipantLink`.
 */

import {
  CANONICAL_PRESETS,
  GRADUAL_45_V1,
  QUICK_DEMO_45_V1,
  SUDDEN_45_V1,
  getPresetById,
  otherCanonicalPreset,
  type PresetConfig,
} from './presets';

export type AssignmentMethod =
  /** Ordinary visitor: fair coin flip between the two canonical presets. */
  | 'random-50-50'
  /** The page was opened through an instructor link naming one preset. */
  | 'direct-link'
  /** The participant asked for the other condition after seeing a debrief. */
  | 'participant-chose-other-condition';

export interface Assignment {
  presetId: string;
  method: AssignmentMethod;
  /** The link code that selected the preset, if one did. */
  linkCode: string | null;
  /** A code was present in the link but not recognised (the visitor was then assigned at random). */
  ignoredLinkCode: string | null;
  /** False only when the participant already knew which condition they were starting. */
  conditionConcealed: boolean;
}

/** Name of the URL query parameter that carries a link code. */
export const LINK_PARAM = 'c';

/**
 * Link code → preset id. The two canonical codes are deliberately meaningless.
 * These are published in instructor materials: do not change or reuse a code.
 * The Quick Demo is openly labelled as a demo, so its code is readable.
 */
export const LINK_CODES: Readonly<Record<string, string>> = Object.freeze({
  k7m2: SUDDEN_45_V1.id,
  p4x9: GRADUAL_45_V1.id,
  demo: QUICK_DEMO_45_V1.id,
});

export function linkCodeForPreset(presetId: string): string | null {
  const entry = Object.entries(LINK_CODES).find(([, id]) => id === presetId);
  return entry ? entry[0] : null;
}

/** Extract the link code from a query string such as `?c=k7m2` (null if absent). */
export function readLinkCode(search: string): string | null {
  const code = new URLSearchParams(search).get(LINK_PARAM);
  return code === null || code.trim() === '' ? null : code.trim().toLowerCase();
}

/**
 * Optional `?seed=<integer>` fixes the target order. Intended for testing and
 * for demonstrations that need a repeatable sequence; ordinary links omit it.
 */
export function readSeedOverride(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 0xffffffff ? n : null;
}

/**
 * Decide the preset for a new session.
 * @param linkCode code from the URL, or null
 * @param random   source of uniform numbers in [0, 1); injected so tests can control the coin
 */
export function assignPreset(linkCode: string | null, random: () => number): Assignment {
  const presetId = linkCode !== null ? LINK_CODES[linkCode] : undefined;
  if (linkCode !== null && presetId !== undefined) {
    return { presetId, method: 'direct-link', linkCode, ignoredLinkCode: null, conditionConcealed: true };
  }
  // Fair coin: values below 0.5 → first canonical preset, otherwise the second.
  const preset = random() < 0.5 ? CANONICAL_PRESETS[0] : CANONICAL_PRESETS[1];
  return {
    presetId: preset.id,
    method: 'random-50-50',
    linkCode: null,
    ignoredLinkCode: linkCode,
    conditionConcealed: true,
  };
}

/** Assignment for "Try the other condition" after a debrief; null if there is no counterpart. */
export function assignOtherCondition(completedPresetId: string): Assignment | null {
  const other = otherCanonicalPreset(completedPresetId);
  if (!other) return null;
  return {
    presetId: other.id,
    method: 'participant-chose-other-condition',
    linkCode: null,
    ignoredLinkCode: null,
    conditionConcealed: false,
  };
}

export function presetForAssignment(assignment: Assignment): PresetConfig {
  const preset = getPresetById(assignment.presetId);
  if (!preset) throw new Error(`Unknown preset id: ${assignment.presetId}`);
  return preset;
}

/**
 * A link to give to participants. `presetId` null gives the general link
 * (random assignment); otherwise the direct link for that preset.
 * `baseUrl` is the page address without query or hash.
 */
export function buildParticipantLink(baseUrl: string, presetId: string | null): string {
  if (presetId === null) return baseUrl;
  const code = linkCodeForPreset(presetId);
  if (!code) throw new Error(`No link code for preset ${presetId}`);
  return `${baseUrl}?${LINK_PARAM}=${code}`;
}

/**
 * assignment.ts — which preset a session runs, and how that was decided.
 *
 * - An ordinary visitor is assigned 50/50 at random between the two canonical
 *   presets when they press Start.
 * - An instructor can hand out a direct link to one preset. The link carries
 *   an OPAQUE code (`?c=k7m2`), never the word "sudden" or "gradual", so the
 *   address bar does not give the condition away.
 * - An instructor can also hand out a link to a custom protocol built on the
 *   instructor page (`?x=a0hm`, see core/custom.ts). It is just as opaque.
 * - After the debrief a participant may choose to try the other condition;
 *   that run is recorded as not concealed.
 *
 * Key exports: `Assignment`, `assignPreset`, `assignOtherCondition`,
 * `LINK_CODES`, `readLinkCode`, `readSeedOverride`, `buildParticipantLink`,
 * `presetForAssignment`.
 */

import { decodeSettings, resolvePreset, type InstructorSettings } from './custom';
import {
  CANONICAL_PRESETS,
  GRADUAL_45_V2,
  QUICK_DEMO_45_V2,
  SUDDEN_45_V2,
  getPresetById,
  otherCanonicalPreset,
  type PresetConfig,
} from './presets';

export type AssignmentMethod =
  /** Ordinary visitor: fair coin flip between the two canonical presets. */
  | 'random-50-50'
  /** The page was opened through an instructor link naming one shipped preset. */
  | 'direct-link'
  /** The page was opened through an instructor link carrying custom settings. */
  | 'custom-link'
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
  /**
   * The instructor settings carried by a custom link, when that is how the
   * preset was chosen; null otherwise. Custom presets are built from these on
   * demand rather than looked up, because there is one for every combination.
   */
  customSettings: InstructorSettings | null;
}

/** Name of the URL query parameter that carries a link code. */
export const LINK_PARAM = 'c';

/**
 * Link code → preset id. The two canonical codes are deliberately meaningless.
 * These are published in instructor materials: never reuse a code for a
 * different CONDITION. A code names a condition ("the sudden one"), not one
 * exact protocol version: when a preset is superseded (v1 → v2) its code moves
 * to the new version, so links already handed out keep working and always run
 * the current protocol. The exact version run is saved in every data file.
 * The Quick Demo is openly labelled as a demo, so its code is readable.
 */
export const LINK_CODES: Readonly<Record<string, string>> = Object.freeze({
  k7m2: SUDDEN_45_V2.id,
  p4x9: GRADUAL_45_V2.id,
  demo: QUICK_DEMO_45_V2.id,
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
 *
 * Precedence: a valid custom-settings code, then a known link code, then the
 * coin. A code that is present but not understood is recorded in
 * `ignoredLinkCode` and the visitor is assigned at random, exactly like an
 * ordinary visitor; a typo in a link never produces an error page.
 *
 * @param linkCode   `c` code from the URL, or null
 * @param random     source of uniform numbers in [0, 1); injected so tests can control the coin
 * @param customCode `x` code from the URL (custom instructor settings), or null
 */
export function assignPreset(linkCode: string | null, random: () => number, customCode: string | null = null): Assignment {
  if (customCode !== null) {
    const settings = decodeSettings(customCode);
    if (settings !== null) {
      // Settings that happen to describe a shipped preset resolve to that
      // preset and its canonical id, so its data pools where it belongs.
      const preset = resolvePreset(settings);
      const custom = preset.kind === 'custom';
      return {
        presetId: preset.id,
        method: custom ? 'custom-link' : 'direct-link',
        linkCode: customCode,
        ignoredLinkCode: null,
        conditionConcealed: true,
        customSettings: custom ? settings : null,
      };
    }
  }

  const presetId = linkCode !== null ? LINK_CODES[linkCode] : undefined;
  if (linkCode !== null && presetId !== undefined) {
    return {
      presetId,
      method: 'direct-link',
      linkCode,
      ignoredLinkCode: customCode,
      conditionConcealed: true,
      customSettings: null,
    };
  }
  // Fair coin: values below 0.5 → first canonical preset, otherwise the second.
  const preset = random() < 0.5 ? CANONICAL_PRESETS[0] : CANONICAL_PRESETS[1];
  return {
    presetId: preset.id,
    method: 'random-50-50',
    linkCode: null,
    ignoredLinkCode: customCode ?? linkCode,
    conditionConcealed: true,
    customSettings: null,
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
    customSettings: null,
  };
}

export function presetForAssignment(assignment: Assignment): PresetConfig {
  if (assignment.customSettings) {
    const preset = resolvePreset(assignment.customSettings);
    // The id recorded in the assignment and the preset actually run must agree.
    if (preset.id !== assignment.presetId) {
      throw new Error(`Custom settings resolve to ${preset.id}, not ${assignment.presetId}`);
    }
    return preset;
  }
  const preset = getPresetById(assignment.presetId);
  if (!preset) throw new Error(`Unknown preset id: ${assignment.presetId}`);
  return preset;
}

/**
 * A link to give to participants. `presetId` null gives the general link
 * (random assignment); otherwise the direct link for that shipped preset.
 * `baseUrl` is the page address without query or hash. For a custom protocol
 * use `buildCustomLink` in core/custom.ts.
 */
export function buildParticipantLink(baseUrl: string, presetId: string | null): string {
  if (presetId === null) return baseUrl;
  const code = linkCodeForPreset(presetId);
  if (!code) throw new Error(`No link code for preset ${presetId}`);
  return `${baseUrl}?${LINK_PARAM}=${code}`;
}

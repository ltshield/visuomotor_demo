/**
 * presets.ts — the versioned experimental presets. This file IS the protocol
 * configuration: every trial count, angle, radius and timing value lives here.
 *
 * VERSIONING RULE: a preset id such as `rotation-sudden-45-v1` is a promise.
 * Once students have run it, never edit its values in place — copy it, change
 * the copy, and give it a new id (`...-v2`). `presets.test.ts` contains a
 * frozen snapshot that fails if a released preset is altered.
 *
 * The two canonical presets share ONE structure, geometry, timing and set of
 * analysis criteria (`STANDARD_*` below) and differ only in `perturbation`.
 *
 * Key exports: `PresetConfig` and related types, `SUDDEN_45_V1`,
 * `GRADUAL_45_V1`, `QUICK_DEMO_45_V1`, `CANONICAL_PRESETS`, `ALL_PRESETS`,
 * `getPresetById`, `otherCanonicalPreset`, `validatePreset`.
 */

/** Whether the cursor is drawn during the OUTWARD reach. It is always drawn on the way back. */
export type FeedbackMode = 'visible' | 'hidden';

export type PhaseName = 'baseline' | 'adaptation' | 'aftereffect';

export interface TaskGeometry {
  /** Distance from the start position to every target centre (wu). */
  targetDistance: number;
  /** Drawn radius of each target (wu). Purely visual: completion uses distance, not overlap. */
  targetRadius: number;
  /** The cursor centre must be within this distance of the start to count as "centred" (wu). */
  startRadius: number;
  /** Drawn radius of the cursor dot (wu). */
  cursorRadius: number;
  /** Half-width of the square workspace. Between reaches the cursor cannot leave it. */
  boundsHalfExtent: number;
  /** Workspace units of virtual hand movement per CSS pixel of reported mouse movement. */
  inputGain: number;
}

export interface TaskTiming {
  /** How long the cursor must stay inside the start circle before a target appears (ms). */
  holdMs: number;
  /** Time allowed from target onset to crossing the target distance (ms). */
  reachTimeoutMs: number;
  /** Pause after each reach; on visible trials the cursor stays frozen where it crossed (ms). */
  feedbackHoldMs: number;
}

export interface MovementCriteria {
  /** Movement onset = hand first reaches this fraction of the target distance. */
  onsetFraction: number;
  /** Initial direction is measured where the path first reaches this fraction of the target distance. */
  initialDirectionFraction: number;
  /** Trials with fewer recorded reach samples than this are treated as degenerate (no metrics). */
  minReachSamples: number;
}

export interface PhaseSpec {
  /** Number of trials; must be a multiple of the number of targets so directions stay balanced. */
  trials: number;
  feedback: FeedbackMode;
}

export interface ProtocolStructure {
  /** Target directions in degrees CCW from +x (screen right). */
  targetAnglesDeg: number[];
  baseline: PhaseSpec;
  /**
   * `catchSlots` are 1-indexed positions *within the adaptation phase* that are
   * zero-rotation "catch" (null) trials. They occupy ordinary slots of the
   * balanced target schedule; they are not extra trials.
   */
  adaptation: PhaseSpec & { catchSlots: number[] };
  aftereffect: PhaseSpec;
}

/**
 * How the cursor rotation evolves over the NON-CATCH adaptation reaches.
 * Angles are degrees, positive = cursor rotated counterclockwise from the hand.
 */
export type PerturbationSchedule =
  | { kind: 'sudden'; angleDeg: number }
  | {
      kind: 'gradual';
      startDeg: number;
      endDeg: number;
      /**
       * Number of non-catch reaches spanned by the ramp, INCLUDING both ends:
       * reach 1 applies `startDeg`, reach `rampReaches` applies `endDeg`, and
       * the steps between are equal. Later reaches hold `endDeg`.
       */
      rampReaches: number;
    };

export type PresetKind = 'canonical' | 'demo';

export interface PresetConfig {
  id: string;
  version: number;
  kind: PresetKind;
  /** Shown only after the task (debrief) and on the instructor page. */
  label: string;
  description: string;
  structure: ProtocolStructure;
  perturbation: PerturbationSchedule;
  geometry: TaskGeometry;
  timing: TaskTiming;
  criteria: MovementCriteria;
}

// ---------------------------------------------------------------------------
// Shared building blocks for the standard 40-trial protocol
// ---------------------------------------------------------------------------

const STANDARD_GEOMETRY: TaskGeometry = {
  targetDistance: 240,
  targetRadius: 18,
  startRadius: 14,
  cursorRadius: 6,
  boundsHalfExtent: 282, // targetDistance + targetRadius + 24 wu of margin
  inputGain: 1,
};

const STANDARD_TIMING: TaskTiming = {
  holdMs: 400,
  reachTimeoutMs: 4000,
  feedbackHoldMs: 500,
};

const STANDARD_CRITERIA: MovementCriteria = {
  onsetFraction: 0.05,
  initialDirectionFraction: 0.25,
  minReachSamples: 4,
};

/** 8 baseline + 24 adaptation slots (2 of them catch trials) + 8 aftereffect = 40 reaches. */
const STANDARD_STRUCTURE: ProtocolStructure = {
  targetAnglesDeg: [0, 45, 90, 135, 180, 225, 270, 315],
  baseline: { trials: 8, feedback: 'hidden' },
  adaptation: { trials: 24, feedback: 'visible', catchSlots: [12, 20] },
  aftereffect: { trials: 8, feedback: 'hidden' },
};

// ---------------------------------------------------------------------------
// Canonical presets (v1)
// ---------------------------------------------------------------------------

export const SUDDEN_45_V1: PresetConfig = {
  id: 'rotation-sudden-45-v1',
  version: 1,
  kind: 'canonical',
  label: 'Sudden 45° rotation',
  description:
    'The cursor is rotated +45° (counterclockwise) on every non-catch adaptation reach, starting abruptly on the first one.',
  structure: STANDARD_STRUCTURE,
  perturbation: { kind: 'sudden', angleDeg: 45 },
  geometry: STANDARD_GEOMETRY,
  timing: STANDARD_TIMING,
  criteria: STANDARD_CRITERIA,
};

export const GRADUAL_45_V1: PresetConfig = {
  id: 'rotation-gradual-45-v1',
  version: 1,
  kind: 'canonical',
  label: 'Gradual 0°→45° rotation',
  description:
    'The cursor rotation ramps linearly from 0° to +45° across the first 8 non-catch adaptation reaches (7 equal steps of 45°/7 ≈ 6.43°), then holds +45° for the remaining 14.',
  structure: STANDARD_STRUCTURE,
  // Reach 1 = 0° and reach 8 = 45° exactly, so there are 7 steps of 45/7 ≈ 6.43°.
  // (A step of 45/8 = 5.625° would only reach 39.375° by reach 8.)
  perturbation: { kind: 'gradual', startDeg: 0, endDeg: 45, rampReaches: 8 },
  geometry: STANDARD_GEOMETRY,
  timing: STANDARD_TIMING,
  criteria: STANDARD_CRITERIA,
};

// ---------------------------------------------------------------------------
// Optional Quick Demo (NOT comparable with the canonical presets)
// ---------------------------------------------------------------------------

/** 4 baseline + 8 adaptation slots (1 catch) + 4 aftereffect = 16 reaches to four targets. */
export const QUICK_DEMO_45_V1: PresetConfig = {
  id: 'rotation-quickdemo-45-v1',
  version: 1,
  kind: 'demo',
  label: 'Quick Demo (sudden 45° rotation, 16 reaches)',
  description:
    'A shortened introduction: 4 baseline, 8 adaptation (one catch trial) and 4 aftereffect reaches to four targets, with a sudden +45° rotation. Too short to compare with the standard protocols.',
  structure: {
    targetAnglesDeg: [0, 90, 180, 270],
    baseline: { trials: 4, feedback: 'hidden' },
    adaptation: { trials: 8, feedback: 'visible', catchSlots: [6] },
    aftereffect: { trials: 4, feedback: 'hidden' },
  },
  perturbation: { kind: 'sudden', angleDeg: 45 },
  geometry: STANDARD_GEOMETRY,
  timing: STANDARD_TIMING,
  criteria: STANDARD_CRITERIA,
};

/** The two presets a first-time visitor is randomly assigned between. Order is fixed. */
export const CANONICAL_PRESETS: readonly PresetConfig[] = [SUDDEN_45_V1, GRADUAL_45_V1];

export const ALL_PRESETS: readonly PresetConfig[] = [SUDDEN_45_V1, GRADUAL_45_V1, QUICK_DEMO_45_V1];

export function getPresetById(id: string): PresetConfig | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}

/** For "Try the other condition": the canonical preset that is not `id` (undefined for demos). */
export function otherCanonicalPreset(id: string): PresetConfig | undefined {
  if (!CANONICAL_PRESETS.some((p) => p.id === id)) return undefined;
  return CANONICAL_PRESETS.find((p) => p.id !== id);
}

export function totalTrials(structure: ProtocolStructure): number {
  return structure.baseline.trials + structure.adaptation.trials + structure.aftereffect.trials;
}

/** Number of adaptation reaches that actually carry the perturbation. */
export function perturbedReachCount(structure: ProtocolStructure): number {
  return structure.adaptation.trials - structure.adaptation.catchSlots.length;
}

/**
 * Throws a descriptive error if a preset cannot produce a balanced, internally
 * consistent schedule. Run by the tests for every shipped preset and by
 * `generateSchedule`, so a bad edit fails loudly rather than skewing data.
 */
export function validatePreset(preset: PresetConfig): void {
  const { structure, perturbation, geometry, timing, criteria } = preset;
  const fail = (msg: string): never => {
    throw new Error(`Invalid preset "${preset.id}": ${msg}`);
  };

  const n = structure.targetAnglesDeg.length;
  if (n < 2) fail('needs at least two targets');
  if (new Set(structure.targetAnglesDeg).size !== n) fail('target angles must be unique');

  for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
    const trials = structure[phase].trials;
    if (!Number.isInteger(trials) || trials <= 0) fail(`${phase}.trials must be a positive integer`);
    // Balance: every direction appears equally often within each phase.
    if (trials % n !== 0) fail(`${phase}.trials (${trials}) must be a multiple of the target count (${n})`);
  }

  const slots = structure.adaptation.catchSlots;
  if (new Set(slots).size !== slots.length) fail('catch slots must be unique');
  for (const s of slots) {
    if (!Number.isInteger(s) || s < 1 || s > structure.adaptation.trials) {
      fail(`catch slot ${s} is outside 1..${structure.adaptation.trials}`);
    }
  }

  if (perturbation.kind === 'gradual') {
    if (!Number.isInteger(perturbation.rampReaches) || perturbation.rampReaches < 1) {
      fail('rampReaches must be a positive integer');
    }
    if (perturbation.rampReaches > perturbedReachCount(structure)) {
      fail('the ramp is longer than the number of perturbed reaches');
    }
  }

  if (geometry.targetDistance <= 0 || geometry.startRadius <= 0) fail('distances must be positive');
  if (geometry.boundsHalfExtent < geometry.targetDistance) fail('workspace bounds are smaller than the target distance');
  if (geometry.inputGain <= 0) fail('inputGain must be positive');
  if (timing.holdMs < 0 || timing.reachTimeoutMs <= 0 || timing.feedbackHoldMs < 0) fail('timing values out of range');
  if (!(criteria.onsetFraction > 0 && criteria.onsetFraction < criteria.initialDirectionFraction)) {
    fail('onsetFraction must be positive and smaller than initialDirectionFraction');
  }
  if (!(criteria.initialDirectionFraction < 1)) fail('initialDirectionFraction must be below 1');
}

/**
 * classWire.ts — the wire format of anonymous class sharing, used by BOTH the
 * browser (which builds a submission) and the server (which checks one).
 *
 * This file has no imports on purpose: the server bundle (Cloudflare Pages
 * Functions) pulls it in, and it must not drag the rest of the app with it.
 *
 * WHAT IS SENT. A compact summary only: for each reach, its position, block,
 * catch flag, the rotation applied, and one number, the initial hand direction
 * error. No movement samples, no timings, no free-text answers, no browser or
 * device details. Nothing in it identifies a person or a computer.
 *
 * The server never trusts a submission: `parseSubmission` checks every field,
 * rejects anything out of range, and copies only the fields named here.
 *
 * Key exports: `ClassSubmission`, `ClassSession`, `ClassResponse`,
 * `normalizeClassCode`, `parseSubmission`, and the limits.
 */

/** A class code is letters and digits only, at most this many. Case does not matter. */
export const CLASS_CODE_MAX = 20;
/** A submission must describe a plausible session: between this many reaches... */
export const MIN_TRIALS = 10;
/** ...and this many. */
export const MAX_TRIALS = 100;
/** Largest request body the server will read (a 64-reach submission is about 5 KB). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Most sessions one class code will hold or return. */
export const MAX_SESSIONS_PER_CLASS = 500;

export type WirePhase = 'baseline' | 'adaptation' | 'aftereffect';
export type WireTier = 'quick' | 'standard' | 'extended';
export type WireAdjustment = 'yes' | 'somewhat' | 'no' | 'unsure';

export const WIRE_PHASES: readonly WirePhase[] = ['baseline', 'adaptation', 'aftereffect'];
export const WIRE_TIERS: readonly WireTier[] = ['quick', 'standard', 'extended'];
export const WIRE_ADJUSTMENTS: readonly WireAdjustment[] = ['yes', 'somewhat', 'no', 'unsure'];

/** One reach. Short keys keep the payload small. */
export interface WireTrial {
  /** 0-based position of the reach in the session. */
  i: number;
  phase: WirePhase;
  /** True for a catch trial (rotation switched off for one reach). */
  catch: boolean;
  /** Rotation applied on this reach, degrees. */
  rot: number;
  /** Initial hand direction error, degrees; null when the reach has no usable value. */
  err: number | null;
  valid: boolean;
}

/** What the browser POSTs to /api/submit. */
export interface ClassSubmission {
  /** The session's random id. It only makes a repeat submission replace the first; it is never sent back out. */
  sessionId: string;
  classCode: string;
  presetId: string;
  /** Full size of the rotation in the protocol, whole degrees. */
  rotationDeg: number;
  trialTier: WireTier;
  /** When the browser sent it. The server stores its own receive time instead. */
  submittedAt: string;
  consciousAdjustment: WireAdjustment | null;
  trials: WireTrial[];
}

/** One anonymous session as returned by GET /api/class/<code>: no id, no time. */
export interface ClassSession {
  presetId: string;
  rotationDeg: number;
  trialTier: WireTier;
  consciousAdjustment: WireAdjustment | null;
  trials: WireTrial[];
}

export interface ClassResponse {
  ok: true;
  classCode: string;
  /** Number of sessions returned. */
  count: number;
  sessions: ClassSession[];
  /** True if the class holds more sessions than the server returns. */
  truncated: boolean;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string; field?: string };
}

/**
 * A class code as typed → its stored form (upper case), or null if it is not
 * 1–20 letters and digits. Upper-casing means "neuro451" and "NEURO451" are the
 * same class, which is what someone reading a code off a projector expects.
 */
export function normalizeClassCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (code.length < 1 || code.length > CLASS_CODE_MAX) return null;
  return /^[A-Za-z0-9]+$/.test(code) ? code.toUpperCase() : null;
}

export type ParseResult =
  | { ok: true; value: ClassSubmission }
  | { ok: false; code: string; message: string; field: string };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIntegerIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Check an untrusted request body and return a clean `ClassSubmission` holding
 * only the known fields. Anything missing, mistyped or out of range is refused
 * with the name of the offending field, so the browser can say something useful.
 */
export function parseSubmission(body: unknown): ParseResult {
  const fail = (field: string, message: string, code = 'invalid_field'): ParseResult => ({ ok: false, code, message, field });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('body', 'The request body must be a JSON object.', 'invalid_body');
  }
  const b = body as Record<string, unknown>;

  const classCode = normalizeClassCode(b.classCode);
  if (classCode === null) {
    return fail('classCode', `A class code is 1 to ${CLASS_CODE_MAX} letters and digits, with no spaces or symbols.`, 'invalid_class_code');
  }

  // A random id: hex digits and hyphens (a UUID, or the app's fallback format).
  if (typeof b.sessionId !== 'string' || !/^[0-9a-fA-F-]{16,64}$/.test(b.sessionId)) {
    return fail('sessionId', 'sessionId must be a random identifier of 16 to 64 hexadecimal characters and hyphens.');
  }
  if (typeof b.presetId !== 'string' || !/^[a-z0-9-]{3,80}$/.test(b.presetId)) {
    return fail('presetId', 'presetId must be 3 to 80 lower-case letters, digits and hyphens.');
  }
  if (!isIntegerIn(b.rotationDeg, 0, 180)) {
    return fail('rotationDeg', 'rotationDeg must be a whole number of degrees from 0 to 180.');
  }
  if (typeof b.trialTier !== 'string' || !(WIRE_TIERS as readonly string[]).includes(b.trialTier)) {
    return fail('trialTier', `trialTier must be one of: ${WIRE_TIERS.join(', ')}.`);
  }
  if (typeof b.submittedAt !== 'string' || b.submittedAt.length > 40 || Number.isNaN(Date.parse(b.submittedAt))) {
    return fail('submittedAt', 'submittedAt must be an ISO 8601 timestamp.');
  }
  const adjustment = b.consciousAdjustment ?? null;
  if (adjustment !== null && !(typeof adjustment === 'string' && (WIRE_ADJUSTMENTS as readonly string[]).includes(adjustment))) {
    return fail('consciousAdjustment', `consciousAdjustment must be null or one of: ${WIRE_ADJUSTMENTS.join(', ')}.`);
  }

  if (!Array.isArray(b.trials)) return fail('trials', 'trials must be an array.');
  if (b.trials.length < MIN_TRIALS || b.trials.length > MAX_TRIALS) {
    return fail('trials', `A submission must contain between ${MIN_TRIALS} and ${MAX_TRIALS} trials; this one has ${b.trials.length}.`, 'invalid_trial_count');
  }

  const trials: WireTrial[] = [];
  let previousIndex = -1;
  for (let k = 0; k < b.trials.length; k++) {
    const raw = b.trials[k] as Record<string, unknown> | null;
    const at = `trials[${k}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(at, 'Each trial must be an object.');
    // Positions must rise, so each (session, position) pair is unique in the table.
    if (!isIntegerIn(raw.i, 0, 999) || raw.i <= previousIndex) {
      return fail(`${at}.i`, 'Trial positions must be whole numbers from 0 to 999 in increasing order.');
    }
    previousIndex = raw.i;
    if (typeof raw.phase !== 'string' || !(WIRE_PHASES as readonly string[]).includes(raw.phase)) {
      return fail(`${at}.phase`, `phase must be one of: ${WIRE_PHASES.join(', ')}.`);
    }
    if (typeof raw.catch !== 'boolean') return fail(`${at}.catch`, 'catch must be true or false.');
    if (!isFiniteNumber(raw.rot) || Math.abs(raw.rot) > 180) return fail(`${at}.rot`, 'rot must be a number of degrees from -180 to 180.');
    const err = raw.err ?? null;
    if (err !== null && !(isFiniteNumber(err) && Math.abs(err) <= 180)) {
      return fail(`${at}.err`, 'err must be null or a number of degrees from -180 to 180.');
    }
    if (typeof raw.valid !== 'boolean') return fail(`${at}.valid`, 'valid must be true or false.');
    trials.push({ i: raw.i, phase: raw.phase as WirePhase, catch: raw.catch, rot: raw.rot, err, valid: raw.valid });
  }

  return {
    ok: true,
    value: {
      sessionId: b.sessionId.toLowerCase(),
      classCode,
      presetId: b.presetId,
      rotationDeg: b.rotationDeg,
      trialTier: b.trialTier as WireTier,
      submittedAt: b.submittedAt,
      consciousAdjustment: adjustment as WireAdjustment | null,
      trials,
    },
  };
}

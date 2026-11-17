/**
 * classApi.ts — the anonymous class-data API. Raw storage and retrieval only;
 * no analysis happens on the server.
 *
 *   POST /api/submit          store one anonymous session summary
 *   GET  /api/class/<code>    return every summary stored for a class code
 *
 * The two files under `functions/api/` are thin wrappers that route a request
 * to the handlers here. The logic lives in `src/` so it can be unit-tested
 * against a real SQLite database (classApi.test.ts) without Cloudflare.
 *
 * `Env.DB` is the D1 database, bound to the Pages project under the name `DB`.
 * If it is missing the API answers 503 "not_configured" instead of failing, so
 * a site deployed without a database still works for everything else.
 *
 * ANONYMITY. The class endpoint returns no session id and no timestamp, and
 * returns sessions in an order unrelated to when they arrived, so nothing it
 * sends can tie a curve to a person or to the moment someone pressed Share.
 *
 * COST. Reads are what a free D1 plan meters, and the class view polls. So the
 * class endpoint first asks a cheap question (how many sessions, newest
 * arrival) and answers "304 Not Modified" when nothing has changed since the
 * caller's last copy; the full read happens only when there is news.
 *
 * Key exports: `handleSubmit`, `handleClassGet`, `ensureSchema`, `Env`,
 * and the minimal D1 interfaces.
 */

import {
  MAX_BODY_BYTES,
  MAX_SESSIONS_PER_CLASS,
  normalizeClassCode,
  parseSubmission,
  type ApiError,
  type ClassResponse,
  type ClassSession,
  type WireAdjustment,
  type WirePhase,
  type WireTier,
} from '../core/classWire';
import { SCHEMA_STATEMENTS } from './schema';

// ---------------------------------------------------------------------------
// The slice of the Cloudflare D1 API this file uses
// ---------------------------------------------------------------------------

export interface D1ResultLike<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<D1ResultLike>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  /** Runs the statements as ONE transaction: all succeed or none are applied. */
  batch(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}

export interface Env {
  /** The D1 binding. Undefined when the site was deployed without one. */
  DB?: D1DatabaseLike;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store', ...headers } });
}

function error(status: number, code: string, message: string, field?: string): Response {
  const body: ApiError = { ok: false, error: field ? { code, message, field } : { code, message } };
  return json(status, body);
}

const NOT_CONFIGURED = () =>
  error(503, 'not_configured', 'Class sharing has not been set up on this site: no database is connected.');

/** For a route called with a method it does not serve. */
export function methodNotAllowed(allowed: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: 'method_not_allowed', message: `Use ${allowed} for this address.` } }),
    { status: 405, headers: { ...JSON_HEADERS, allow: allowed, 'cache-control': 'no-store' } },
  );
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Databases whose tables are known to exist, so the check runs once per database per server instance. */
const schemaReady = new WeakMap<D1DatabaseLike, Promise<void>>();

/**
 * Create the tables if they are not there yet. This makes a freshly created,
 * empty D1 database usable with no manual step, which is one less thing to get
 * wrong when setting the site up.
 */
export function ensureSchema(db: D1DatabaseLike): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql))).then(() => undefined);
    schemaReady.set(db, ready);
    // If it failed, forget it so the next request tries again.
    ready.catch(() => schemaReady.delete(db));
  }
  return ready;
}

// ---------------------------------------------------------------------------
// POST /api/submit
// ---------------------------------------------------------------------------

/**
 * Store one anonymous session summary.
 *
 * Sending the same session again REPLACES what was stored for it (matched by
 * its random session id). That makes a double click harmless, and lets a
 * student who mistyped the class code send it again to the right one.
 *
 * @param now clock, injectable for tests
 */
export async function handleSubmit(request: Request, env: Env, now: () => Date = () => new Date()): Promise<Response> {
  const db = env.DB;
  if (!db) return NOT_CONFIGURED();

  // Refuse oversized bodies before reading them when the size is declared,
  // and after reading in any case (the header can be absent or wrong).
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  let text: string;
  try {
    text = await request.text();
  } catch {
    return error(400, 'invalid_body', 'The request body could not be read.');
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) return error(400, parsed.code, parsed.message, parsed.field);
  const s = parsed.value;

  try {
    await ensureSchema(db);

    // A class code holds a bounded number of sessions (a re-send of this one does not count).
    const others = await db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE classCode = ? AND id <> ?')
      .bind(s.classCode, s.sessionId)
      .first<{ n: number }>();
    if (others && Number(others.n) >= MAX_SESSIONS_PER_CLASS) {
      return error(409, 'class_full', `This class code already holds ${MAX_SESSIONS_PER_CLASS} sessions, the most it can. Ask your professor for a new code.`);
    }

    // The reaches travel as ONE JSON parameter and are unpacked by SQLite
    // (json_each), so a session is four statements however many reaches it has.
    // Flags are sent as 0/1 so the stored values do not depend on how a JSON
    // true/false would be converted.
    const rows = JSON.stringify(
      s.trials.map((t) => ({ i: t.i, p: t.phase, c: t.catch ? 1 : 0, r: t.rot, e: t.err, v: t.valid ? 1 : 0 })),
    );

    // One transaction: remove any earlier copy of this session, then store the new one.
    const results = await db.batch([
      db.prepare('DELETE FROM trial_errors WHERE sessionId = ?').bind(s.sessionId),
      db.prepare('DELETE FROM sessions WHERE id = ?').bind(s.sessionId),
      db
        .prepare(
          'INSERT INTO sessions (id, classCode, presetId, rotationDeg, trialTier, submittedAt, consciousAdjustment) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(s.sessionId, s.classCode, s.presetId, s.rotationDeg, s.trialTier, now().toISOString(), s.consciousAdjustment),
      db
        .prepare(
          // Two parameters, in order of appearance: the session id, then the JSON array of reaches.
          `INSERT INTO trial_errors (sessionId, trialIndex, phase, isCatch, rotationApplied, initialDirErrorDeg, valid)
           SELECT ?, json_extract(value, '$.i'), json_extract(value, '$.p'), json_extract(value, '$.c'),
                  json_extract(value, '$.r'), json_extract(value, '$.e'), json_extract(value, '$.v')
           FROM json_each(?)`,
        )
        .bind(s.sessionId, rows),
    ]);

    const replaced = Number(results[1]?.meta?.changes ?? 0) > 0;
    return json(200, { ok: true, classCode: s.classCode, trials: s.trials.length, replaced });
  } catch (err) {
    console.error('submit failed', err);
    return error(500, 'storage_failed', 'The class server could not store the data. Please try again in a moment.');
  }
}

function tooLarge(): Response {
  return error(413, 'payload_too_large', `The submission is too large (the limit is ${MAX_BODY_BYTES / 1024} KB).`);
}

// ---------------------------------------------------------------------------
// GET /api/class/<code>
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  presetId: string;
  rotationDeg: number;
  trialTier: string;
  consciousAdjustment: string | null;
}

interface TrialRow {
  sessionId: string;
  trialIndex: number;
  phase: string;
  isCatch: number;
  rotationApplied: number;
  initialDirErrorDeg: number | null;
  valid: number;
}

/**
 * Return every session stored for a class code. An unknown or empty class is
 * not an error: it returns an empty list, since "nobody has shared yet" is the
 * normal state of a class view before the activity starts.
 */
/**
 * The version tag (ETag) of a class's data. It changes whenever a session is
 * added, replaced or deleted, because it is built from the count and the latest
 * receive time. It is a hash of those, so the tag itself does not give out the
 * time anyone shared.
 */
async function versionTag(classCode: string, total: number, latest: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(`${classCode}|${total}|${latest ?? ''}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `"${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

export async function handleClassGet(request: Request, env: Env, rawCode: string): Promise<Response> {
  const db = env.DB;
  if (!db) return NOT_CONFIGURED();

  const classCode = normalizeClassCode(rawCode);
  if (classCode === null) {
    return error(400, 'invalid_class_code', 'A class code is 1 to 20 letters and digits, with no spaces or symbols.', 'classCode');
  }

  try {
    await ensureSchema(db);

    // Cheap question first: has anything changed since the caller last asked?
    const state = await db
      .prepare('SELECT COUNT(*) AS n, MAX(submittedAt) AS latest FROM sessions WHERE classCode = ?')
      .bind(classCode)
      .first<{ n: number; latest: string | null }>();
    const total = Number(state?.n ?? 0);
    const etag = await versionTag(classCode, total, state?.latest ?? null);
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
    }

    // Ordered by the random id, not by arrival, so the order says nothing about who shared when.
    const sessionRows = await db
      .prepare('SELECT id, presetId, rotationDeg, trialTier, consciousAdjustment FROM sessions WHERE classCode = ? ORDER BY id LIMIT ?')
      .bind(classCode, MAX_SESSIONS_PER_CLASS)
      .all<SessionRow>();
    const trialRows = await db
      .prepare(
        `SELECT t.sessionId, t.trialIndex, t.phase, t.isCatch, t.rotationApplied, t.initialDirErrorDeg, t.valid
         FROM trial_errors t JOIN sessions s ON s.id = t.sessionId
         WHERE s.classCode = ?
         ORDER BY t.sessionId, t.trialIndex`,
      )
      .bind(classCode)
      .all<TrialRow>();

    // Group the reaches under their session. The session id is used for the
    // grouping only and is deliberately left out of what is sent back.
    const bySession = new Map<string, ClassSession>();
    for (const row of sessionRows.results ?? []) {
      bySession.set(row.id, {
        presetId: row.presetId,
        rotationDeg: Number(row.rotationDeg),
        trialTier: row.trialTier as WireTier,
        consciousAdjustment: (row.consciousAdjustment ?? null) as WireAdjustment | null,
        trials: [],
      });
    }
    for (const row of trialRows.results ?? []) {
      bySession.get(row.sessionId)?.trials.push({
        i: Number(row.trialIndex),
        phase: row.phase as WirePhase,
        catch: Number(row.isCatch) === 1,
        rot: Number(row.rotationApplied),
        err: row.initialDirErrorDeg === null ? null : Number(row.initialDirErrorDeg),
        valid: Number(row.valid) === 1,
      });
    }

    const sessions = [...bySession.values()];
    const body: ClassResponse = { ok: true, classCode, count: sessions.length, sessions, truncated: total > sessions.length };
    return json(200, body, { etag, 'cache-control': 'no-cache' });
  } catch (err) {
    console.error('class read failed', err);
    return error(500, 'storage_failed', 'The class server could not read the data. Please try again in a moment.');
  }
}

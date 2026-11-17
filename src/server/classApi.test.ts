/**
 * The class-data API, run against a real SQLite database (see testD1.ts).
 * These are the handlers Cloudflare runs; only the database engine's host differs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildClassSubmission } from '../core/classShare';
import {
  MAX_BODY_BYTES,
  MAX_SESSIONS_PER_CLASS,
  type ClassResponse,
  type ClassSubmission,
  type WireTrial,
} from '../core/classWire';
import type { TrialSpec } from '../core/schedule';
import { scriptedSessionRecord } from '../core/testUtils';
import { ensureSchema, handleClassGet, handleSubmit, methodNotAllowed } from './classApi';
import { SCHEMA_STATEMENTS } from './schema';
import { createTestD1, type TestD1 } from './testD1';

const ORIGIN = 'https://lab.example';

/** A plausible 40-reach submission. `seed` varies the session id and the errors. */
function submission(overrides: Partial<ClassSubmission> = {}, seed = 1): ClassSubmission {
  const trials: WireTrial[] = Array.from({ length: 40 }, (_, i) => {
    const phase = i < 8 ? 'baseline' : i < 32 ? 'adaptation' : 'aftereffect';
    const isCatch = i === 19 || i === 27;
    return {
      i,
      phase,
      catch: isCatch,
      rot: phase === 'adaptation' && !isCatch ? 45 : 0,
      err: Math.round((phase === 'baseline' ? 2 : -30 - seed) * 100 + i) / 100,
      valid: true,
    };
  });
  return {
    sessionId: `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`,
    classCode: 'NEURO451',
    presetId: 'rotation-sudden-45-v2',
    rotationDeg: 45,
    trialTier: 'standard',
    submittedAt: '2026-11-17T18:00:00.000Z',
    consciousAdjustment: 'somewhat',
    trials,
    ...overrides,
  };
}

function post(body: unknown, init: { raw?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`${ORIGIN}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.raw ?? JSON.stringify(body),
  });
}

const get = (code: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/class/${code}`, { headers });

/** A fixed clock that advances one second per call, so arrival order is known. */
function clock(startIso = '2026-11-17T18:00:00.000Z') {
  let t = Date.parse(startIso);
  return () => new Date((t += 1000));
}

async function submitOk(db: TestD1, body: ClassSubmission, now = clock()) {
  const res = await handleSubmit(post(body), { DB: db }, now);
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: true; classCode: string; trials: number; replaced: boolean };
}

async function readClass(db: TestD1, code: string) {
  const res = await handleClassGet(get(code), { DB: db }, code);
  expect(res.status).toBe(200);
  return (await res.json()) as ClassResponse;
}

async function expectError(res: Response, status: number, code: string, field?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; field?: string } };
  expect(body.ok).toBe(false);
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(10); // a sentence a person can act on
  if (field !== undefined) expect(body.error.field).toBe(field);
  return body.error;
}

describe('schema', () => {
  it('db/schema.sql and the statements the server runs are the same schema', () => {
    const file = readFileSync(fileURLToPath(new URL('../../db/schema.sql', import.meta.url)), 'utf8');
    const normalise = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    // Drop the comments first (one of them contains a semicolon), then split into statements.
    const fromFile = file
      .replace(/--.*$/gm, '')
      .split(';')
      .map(normalise)
      .filter((s) => s.length > 0);
    expect(fromFile).toEqual(SCHEMA_STATEMENTS.map(normalise));
  });

  it('has the tables, columns and index of the specification', () => {
    const db = createTestD1();
    for (const sql of SCHEMA_STATEMENTS) db.sqlite.exec(sql);
    const columns = (table: string) => db.rows<{ name: string; type: string; notnull: number; pk: number }>(`PRAGMA table_info(${table})`);
    expect(columns('sessions').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['id', 'TEXT', 0, 1],
      ['classCode', 'TEXT', 1, 0],
      ['presetId', 'TEXT', 1, 0],
      ['rotationDeg', 'INTEGER', 1, 0],
      ['trialTier', 'TEXT', 1, 0],
      ['submittedAt', 'TEXT', 1, 0],
      ['consciousAdjustment', 'TEXT', 0, 0],
    ]);
    expect(columns('trial_errors').map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual([
      ['sessionId', 'TEXT', 1, 1],
      ['trialIndex', 'INTEGER', 1, 2],
      ['phase', 'TEXT', 1, 0],
      ['isCatch', 'INTEGER', 1, 0],
      ['rotationApplied', 'REAL', 1, 0],
      ['initialDirErrorDeg', 'REAL', 0, 0],
      ['valid', 'INTEGER', 1, 0],
    ]);
    expect(db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_class'")).toHaveLength(1);
  });

  it('is created on first use, so an empty database needs no manual step, and only once', async () => {
    const db = createTestD1();
    expect(db.rows("SELECT name FROM sqlite_master WHERE type = 'table'")).toHaveLength(0);
    await submitOk(db, submission());
    expect(db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name)).toEqual([
      'sessions',
      'trial_errors',
    ]);
    const before = db.statementsRun;
    await ensureSchema(db);
    await ensureSchema(db);
    expect(db.statementsRun).toBe(before);
  });
});

describe('POST /api/submit: stores correctly', () => {
  it('stores the session row and one row per reach', async () => {
    const db = createTestD1();
    const body = await submitOk(db, submission());
    expect(body).toEqual({ ok: true, classCode: 'NEURO451', trials: 40, replaced: false });

    expect(db.rows('SELECT * FROM sessions')).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        classCode: 'NEURO451',
        presetId: 'rotation-sudden-45-v2',
        rotationDeg: 45,
        trialTier: 'standard',
        submittedAt: '2026-11-17T18:00:01.000Z', // the server's clock, not the browser's
        consciousAdjustment: 'somewhat',
      },
    ]);

    const trials = db.rows<Record<string, unknown>>('SELECT * FROM trial_errors ORDER BY trialIndex');
    expect(trials).toHaveLength(40);
    expect(trials[0]).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000001',
      trialIndex: 0,
      phase: 'baseline',
      isCatch: 0,
      rotationApplied: 0,
      initialDirErrorDeg: 2,
      valid: 1,
    });
    expect(trials[19]).toMatchObject({ trialIndex: 19, phase: 'adaptation', isCatch: 1, rotationApplied: 0, valid: 1 });
    expect(trials[20]).toMatchObject({ trialIndex: 20, phase: 'adaptation', isCatch: 0, rotationApplied: 45 });
    expect(trials[39]).toMatchObject({ trialIndex: 39, phase: 'aftereffect', rotationApplied: 0, initialDirErrorDeg: -30.61 });
  });

  it('stores an invalid reach as NULL with valid = 0, and a skipped answer as NULL', async () => {
    const db = createTestD1();
    const s = submission({ consciousAdjustment: null });
    s.trials[4] = { ...s.trials[4], err: null, valid: false };
    await submitOk(db, s);
    expect(db.rows('SELECT initialDirErrorDeg, valid FROM trial_errors WHERE trialIndex = 4')).toEqual([{ initialDirErrorDeg: null, valid: 0 }]);
    expect(db.rows('SELECT consciousAdjustment FROM sessions')).toEqual([{ consciousAdjustment: null }]);
  });

  it('upper-cases the class code, so "neuro451" and "NEURO451" are one class', async () => {
    const db = createTestD1();
    await submitOk(db, submission({ classCode: 'neuro451' }, 1));
    await submitOk(db, submission({ classCode: ' Neuro451 ' }, 2));
    expect(db.rows('SELECT DISTINCT classCode FROM sessions')).toEqual([{ classCode: 'NEURO451' }]);
    expect((await readClass(db, 'neuro451')).count).toBe(2);
  });

  it('copies only the known fields: extra properties are never stored', async () => {
    const db = createTestD1();
    const res = await handleSubmit(post({ ...submission(), name: 'Ada Lovelace', email: 'ada@example.edu', userAgent: 'x' }), { DB: db });
    expect(res.status).toBe(200);
    const everything = JSON.stringify([db.rows('SELECT * FROM sessions'), db.rows('SELECT * FROM trial_errors')]);
    expect(everything).not.toMatch(/Ada|example\.edu|userAgent/);
  });

  it('accepts the whole range of trial counts the protocols produce (16, 40, 64)', async () => {
    const db = createTestD1();
    for (const [n, tier, seed] of [[16, 'quick', 1], [40, 'standard', 2], [64, 'extended', 3]] as const) {
      const s = submission({ trialTier: tier }, seed);
      s.trials = Array.from({ length: n }, (_, i) => ({ ...s.trials[i % 40], i }));
      expect((await submitOk(db, s)).trials).toBe(n);
    }
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM trial_errors')[0].n).toBe(120);
  });

  it('costs a handful of statements however many reaches there are', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1)); // includes the one-off schema check
    const before = db.statementsRun;
    const big = submission({ trialTier: 'extended' }, 2);
    big.trials = Array.from({ length: 64 }, (_, i) => ({ ...big.trials[i % 40], i }));
    await submitOk(db, big);
    expect(db.statementsRun - before).toBe(5); // one count + delete, delete, insert, insert
  });
});

describe('POST /api/submit: atomic storage and repeats', () => {
  it('stores nothing at all if the write fails part-way', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1));
    db.failBatchAfter = 3; // the session row goes in, then the reaches fail
    const res = await handleSubmit(post(submission({}, 2)), { DB: db });
    await expectError(res, 500, 'storage_failed');
    // The half-written session was rolled back; the earlier one is untouched.
    expect(db.rows('SELECT id FROM sessions')).toEqual([{ id: '00000000-0000-4000-8000-000000000001' }]);
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM trial_errors')[0].n).toBe(40);
  });

  it('a failed replacement leaves the earlier copy intact', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1));
    db.failBatchAfter = 2; // both deletes done, inserts not
    await expectError(await handleSubmit(post(submission({ classCode: 'OTHER' }, 1)), { DB: db }), 500, 'storage_failed');
    expect(db.rows('SELECT classCode FROM sessions')).toEqual([{ classCode: 'NEURO451' }]);
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM trial_errors')[0].n).toBe(40);
  });

  it('sending the same session twice keeps one copy (a double click is harmless)', async () => {
    const db = createTestD1();
    expect((await submitOk(db, submission())).replaced).toBe(false);
    expect((await submitOk(db, submission())).replaced).toBe(true);
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')[0].n).toBe(1);
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM trial_errors')[0].n).toBe(40);
  });

  it('re-sending to a corrected class code moves the session there', async () => {
    const db = createTestD1();
    await submitOk(db, submission({ classCode: 'NEURO415' })); // typo
    await submitOk(db, submission({ classCode: 'NEURO451' }));
    expect((await readClass(db, 'NEURO415')).sessions).toEqual([]);
    expect((await readClass(db, 'NEURO451')).count).toBe(1);
  });

  it('refuses new sessions once a class code is full, but still accepts a re-send', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1));
    // Fill the class directly: the limit is about row counts, not about the HTTP path.
    const insert = db.sqlite.prepare(
      "INSERT INTO sessions (id, classCode, presetId, rotationDeg, trialTier, submittedAt) VALUES (?, 'NEURO451', 'p', 45, 'standard', 't')",
    );
    for (let i = 0; i < MAX_SESSIONS_PER_CLASS - 1; i++) insert.run(`filler-${i}`);

    await expectError(await handleSubmit(post(submission({}, 2)), { DB: db }), 409, 'class_full');
    expect((await submitOk(db, submission({}, 1))).replaced).toBe(true); // already a member
    expect((await submitOk(db, submission({ classCode: 'OTHERCLASS' }, 3))).classCode).toBe('OTHERCLASS');
  });
});

describe('POST /api/submit: validates the class code', () => {
  const db = createTestD1();
  const reject = async (classCode: unknown) =>
    expectError(await handleSubmit(post({ ...submission(), classCode }), { DB: db }), 400, 'invalid_class_code', 'classCode');

  it('accepts letters and digits up to 20 characters', async () => {
    for (const [i, code] of ['A', 'neuro451', 'NEURO451', 'Bio2026Fall', '12345', 'A'.repeat(20)].entries()) {
      expect((await submitOk(db, submission({ classCode: code }, 100 + i))).classCode).toBe(code.toUpperCase());
    }
  });

  it('rejects anything else, and stores nothing', async () => {
    const before = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')[0].n;
    for (const bad of ['', '   ', 'A'.repeat(21), 'NEURO 451', 'NEURO-451', 'neuro_451', 'café', "x'; DROP TABLE sessions;--", '../etc', 451, null, undefined, ['A'], {}]) {
      await reject(bad);
    }
    expect(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')[0].n).toBe(before);
  });

  it('explains the rule in the error', async () => {
    const error = await reject('NEURO 451');
    expect(error.message).toBe('A class code is 1 to 20 letters and digits, with no spaces or symbols.');
  });
});

describe('POST /api/submit: rejects oversized payloads', () => {
  it('rejects a body over the limit by its declared length, without reading it', async () => {
    const db = createTestD1();
    const res = await handleSubmit(post(submission(), { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }), { DB: db });
    await expectError(res, 413, 'payload_too_large');
    expect(db.statementsRun).toBe(0);
  });

  it('rejects a body over the limit by its actual size when the header is missing or wrong', async () => {
    const db = createTestD1();
    const padded = { ...submission(), padding: 'x'.repeat(MAX_BODY_BYTES) };
    const request = new Request(`${ORIGIN}/api/submit`, { method: 'POST', body: JSON.stringify(padded) });
    await expectError(await handleSubmit(request, { DB: db }), 413, 'payload_too_large');
    expect(db.statementsRun).toBe(0);
  });

  it('counts bytes, not characters', async () => {
    const db = createTestD1();
    // Under the limit in characters, over it in UTF-8 bytes.
    const padded = { ...submission(), padding: '€'.repeat(Math.ceil(MAX_BODY_BYTES / 3) + 10) };
    expect(JSON.stringify(padded).length).toBeLessThan(MAX_BODY_BYTES);
    const request = new Request(`${ORIGIN}/api/submit`, { method: 'POST', body: JSON.stringify(padded) });
    await expectError(await handleSubmit(request, { DB: db }), 413, 'payload_too_large');
  });

  it('accepts the largest real submission comfortably', async () => {
    const big = submission({ trialTier: 'extended' });
    big.trials = Array.from({ length: 100 }, (_, i) => ({ ...big.trials[i % 40], i, err: -123.45 }));
    expect(JSON.stringify(big).length).toBeLessThan(MAX_BODY_BYTES / 4);
    await submitOk(createTestD1(), big);
  });

  it('rejects too few or too many trials', async () => {
    const db = createTestD1();
    const withTrials = (n: number) => {
      const s = submission();
      s.trials = Array.from({ length: n }, (_, i) => ({ ...s.trials[i % 40], i }));
      return s;
    };
    for (const n of [0, 1, 9, 101, 500]) {
      const error = await expectError(await handleSubmit(post(withTrials(n)), { DB: db }), 400, 'invalid_trial_count', 'trials');
      expect(error.message).toContain(`this one has ${n}`);
    }
    await submitOk(db, { ...withTrials(10), sessionId: 'aaaaaaaa-0000-4000-8000-000000000010' });
    await submitOk(db, { ...withTrials(100), sessionId: 'aaaaaaaa-0000-4000-8000-000000000100' });
  });
});

describe('POST /api/submit: rejects malformed submissions with a structured error', () => {
  const db = createTestD1();
  const send = (body: unknown) => handleSubmit(post(body), { DB: db });

  it('invalid JSON', async () => {
    await expectError(await handleSubmit(post(null, { raw: '{not json' }), { DB: db }), 400, 'invalid_json');
    await expectError(await handleSubmit(post(null, { raw: '' }), { DB: db }), 400, 'invalid_json');
  });

  it('a body that is not an object', async () => {
    for (const body of [null, 42, 'text', [submission()]]) await expectError(await send(body), 400, 'invalid_body', 'body');
  });

  it('each session field, naming the field', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['sessionId', { sessionId: 'not-an-id!' }],
      ['sessionId', { sessionId: 'abc' }],
      ['sessionId', { sessionId: 12345 }],
      ['presetId', { presetId: 'Rotation Sudden' }],
      ['presetId', { presetId: 'x'.repeat(81) }],
      ['rotationDeg', { rotationDeg: 45.5 }],
      ['rotationDeg', { rotationDeg: -1 }],
      ['rotationDeg', { rotationDeg: '45' }],
      ['trialTier', { trialTier: 'huge' }],
      ['submittedAt', { submittedAt: 'yesterday' }],
      ['submittedAt', { submittedAt: 1700000000 }],
      ['consciousAdjustment', { consciousAdjustment: 'maybe' }],
      ['trials', { trials: 'none' }],
    ];
    for (const [field, change] of cases) {
      await expectError(await send({ ...submission(), ...change }), 400, 'invalid_field', field);
    }
  });

  it('each trial field, naming the trial', async () => {
    const withTrial = (index: number, change: Record<string, unknown>) => {
      const s = submission() as unknown as { trials: Array<Record<string, unknown>> };
      s.trials[index] = { ...s.trials[index], ...change };
      return s;
    };
    await expectError(await send(withTrial(3, { phase: 'washout' })), 400, 'invalid_field', 'trials[3].phase');
    await expectError(await send(withTrial(3, { catch: 'yes' })), 400, 'invalid_field', 'trials[3].catch');
    await expectError(await send(withTrial(3, { rot: 400 })), 400, 'invalid_field', 'trials[3].rot');
    await expectError(await send(withTrial(3, { rot: null })), 400, 'invalid_field', 'trials[3].rot');
    await expectError(await send(withTrial(3, { err: 'big' })), 400, 'invalid_field', 'trials[3].err');
    await expectError(await send(withTrial(3, { err: 999 })), 400, 'invalid_field', 'trials[3].err');
    await expectError(await send(withTrial(3, { valid: 1 })), 400, 'invalid_field', 'trials[3].valid');
    await expectError(await send(withTrial(3, { i: 2 })), 400, 'invalid_field', 'trials[3].i'); // repeats position 2
    await expectError(await send(withTrial(0, { i: -1 })), 400, 'invalid_field', 'trials[0].i');
    await expectError(await send(withTrial(5, { i: 5.5 })), 400, 'invalid_field', 'trials[5].i');
    const s = submission() as unknown as { trials: unknown[] };
    s.trials[7] = null;
    await expectError(await send(s), 400, 'invalid_field', 'trials[7]');
  });

  it('none of those stored anything', () => {
    expect(db.statementsRun).toBe(0);
  });
});

describe('GET /api/class/<code>', () => {
  it('an empty or unknown class returns an empty array, not an error', async () => {
    const db = createTestD1();
    expect(await readClass(db, 'NOBODYYET')).toEqual({ ok: true, classCode: 'NOBODYYET', count: 0, sessions: [], truncated: false });
    await submitOk(db, submission());
    expect((await readClass(db, 'ANOTHERCLASS')).sessions).toEqual([]);
  });

  it('returns ONLY the records matching the class code', async () => {
    const db = createTestD1();
    await submitOk(db, submission({ classCode: 'NEURO451' }, 1));
    await submitOk(db, submission({ classCode: 'NEURO451', presetId: 'rotation-gradual-45-v2' }, 2));
    await submitOk(db, submission({ classCode: 'BIO200' }, 3));
    await submitOk(db, submission({ classCode: 'NEURO4510' }, 4)); // a longer code that starts the same
    await submitOk(db, submission({ classCode: 'NEURO45' }, 5)); // a shorter one

    const neuro = await readClass(db, 'NEURO451');
    expect(neuro.count).toBe(2);
    expect(neuro.sessions.map((s) => s.presetId).sort()).toEqual(['rotation-gradual-45-v2', 'rotation-sudden-45-v2']);
    // Each session carries its own 40 reaches and nobody else's.
    for (const s of neuro.sessions) {
      expect(s.trials).toHaveLength(40);
      expect(s.trials.map((t) => t.i)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    }
    expect((await readClass(db, 'BIO200')).count).toBe(1);
    expect((await readClass(db, 'NEURO45')).count).toBe(1);
    expect((await readClass(db, 'NEURO4510')).count).toBe(1);
  });

  it('returns each session exactly as it was submitted', async () => {
    const db = createTestD1();
    const sent = submission({ consciousAdjustment: 'no' });
    sent.trials[6] = { ...sent.trials[6], err: null, valid: false };
    await submitOk(db, sent);
    const [received] = (await readClass(db, 'NEURO451')).sessions;
    expect(received).toEqual({
      presetId: sent.presetId,
      rotationDeg: 45,
      trialTier: 'standard',
      consciousAdjustment: 'no',
      trials: sent.trials,
    });
  });

  it('is anonymous: no session id, no timestamp, nothing but the summary', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1));
    await submitOk(db, submission({}, 2));
    const res = await handleClassGet(get('NEURO451'), { DB: db }, 'NEURO451');
    const text = await res.clone().text();
    expect(text).not.toContain('00000000-0000-4000-8000');
    expect(text).not.toMatch(/sessionId|submittedAt|2026-11-17/);
    const body = (await res.json()) as ClassResponse;
    for (const s of body.sessions) {
      expect(Object.keys(s).sort()).toEqual(['consciousAdjustment', 'presetId', 'rotationDeg', 'trialTier', 'trials']);
      for (const t of s.trials) expect(Object.keys(t).sort()).toEqual(['catch', 'err', 'i', 'phase', 'rot', 'valid']);
    }
  });

  it('does not return sessions in the order they arrived', async () => {
    const db = createTestD1();
    const now = clock();
    // Arrive in the order C, A, B (by id); they come back ordered by the random id.
    const ids = ['cccccccc-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000'];
    for (const [k, sessionId] of ids.entries()) await submitOk(db, submission({ sessionId, rotationDeg: 10 + k }), now);
    expect((await readClass(db, 'NEURO451')).sessions.map((s) => s.rotationDeg)).toEqual([11, 12, 10]);
  });

  it('accepts the code in any case and rejects an invalid one', async () => {
    const db = createTestD1();
    await submitOk(db, submission());
    expect((await readClass(db, 'neuro451')).classCode).toBe('NEURO451');
    for (const bad of ['', 'NEURO 451', 'a'.repeat(21), 'x;y', '%20']) {
      await expectError(await handleClassGet(get('x'), { DB: db }, bad), 400, 'invalid_class_code', 'classCode');
    }
  });

  it('answers "not modified" when nothing changed, without re-reading the reaches', async () => {
    const db = createTestD1();
    await submitOk(db, submission({}, 1));
    const first = await handleClassGet(get('NEURO451'), { DB: db }, 'NEURO451');
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/);
    // Opaque: the tag must not give out when anyone shared.
    expect(etag).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:/);

    const before = db.statementsRun;
    const again = await handleClassGet(get('NEURO451', { 'if-none-match': etag }), { DB: db }, 'NEURO451');
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(db.statementsRun - before).toBe(1); // only the cheap "has anything changed?" query

    // A new arrival, a replacement, or a different class all invalidate it.
    await submitOk(db, submission({}, 2));
    const changed = await handleClassGet(get('NEURO451', { 'if-none-match': etag }), { DB: db }, 'NEURO451');
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as ClassResponse).count).toBe(2);
    const etag2 = changed.headers.get('etag')!;
    await submitOk(db, submission({ consciousAdjustment: 'yes' }, 2), clock('2026-11-17T19:00:00.000Z'));
    expect((await handleClassGet(get('NEURO451', { 'if-none-match': etag2 }), { DB: db }, 'NEURO451')).status).toBe(200);
    expect((await handleClassGet(get('BIO200', { 'if-none-match': etag2 }), { DB: db }, 'BIO200')).status).toBe(200);
  });
});

describe('a site without a database', () => {
  it('answers 503 "not_configured" on both routes instead of crashing', async () => {
    await expectError(await handleSubmit(post(submission()), {}), 503, 'not_configured');
    await expectError(await handleClassGet(get('NEURO451'), {}, 'NEURO451'), 503, 'not_configured');
  });

  it('reports a wrong method with the method to use', async () => {
    const res = methodNotAllowed('POST');
    expect(res.headers.get('allow')).toBe('POST');
    await expectError(res, 405, 'method_not_allowed');
  });
});

describe('end to end: a real session, shared and read back', () => {
  const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);

  it('the summary built from a session record round-trips through the API unchanged', async () => {
    const session = scriptedSessionRecord('k7m2', aim);
    const sent = buildClassSubmission(
      { ...session, reflection: { skipped: false, noticed: 'It went sideways', consciousAdjustment: 'yes', changedAim: null, device: 'mouse' } },
      'neuro451',
      new Date('2026-11-17T18:00:00.000Z'),
    );
    // The session id here is the scripted fixture's, which is not hex; use a real-looking one.
    const body = { ...sent, sessionId: '3f2b8c1e-7a44-4d0e-9b61-0c5a2e9d7f10' };
    expect(JSON.stringify(body).length).toBeLessThan(4000); // compact: no trajectories

    const db = createTestD1();
    await submitOk(db, body);
    const [received] = (await readClass(db, 'NEURO451')).sessions;
    expect(received.presetId).toBe('rotation-sudden-45-v2');
    expect(received.trialTier).toBe('standard');
    expect(received.consciousAdjustment).toBe('yes');
    expect(received.trials).toEqual(sent.trials);
    // What the class view will plot is what the student's own results page showed.
    expect(received.trials[0].err).toBeCloseTo(3, 2);
    expect(received.trials[19]).toMatchObject({ catch: true, rot: 0 });
    expect(received.trials[19].err).toBeCloseTo(-35, 2);
    expect(received.trials[32].err).toBeCloseTo(-18, 2);
    // The free-text answer and the device never left the browser.
    expect(JSON.stringify(db.rows('SELECT * FROM sessions'))).not.toMatch(/sideways|mouse/);
  });
});

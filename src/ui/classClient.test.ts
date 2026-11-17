/**
 * The browser side of class sharing: every server answer, and every way the
 * server can be missing, becomes a result the page can show. Nothing throws.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClassResponse, ClassSubmission } from '../core/classWire';
import { fetchClass, submitToClass, type FetchLike } from './classClient';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const html = (status = 200) => new Response('<!doctype html><title>app</title>', { status, headers: { 'content-type': 'text/html' } });

const submission: ClassSubmission = {
  sessionId: '6f1c2a9e-3b7d-4c10-9a55-0e2f8d7b6a41',
  classCode: 'neuro451',
  presetId: 'rotation-sudden-45-v2',
  rotationDeg: 45,
  trialTier: 'standard',
  submittedAt: '2026-11-17T18:45:00.000Z',
  consciousAdjustment: null,
  trials: [],
};

const classData: ClassResponse = { ok: true, classCode: 'NEURO451', count: 0, sessions: [], truncated: false };

describe('submitToClass', () => {
  it('POSTs the submission as JSON to /api/submit and reports the stored class code', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ ok: true, classCode: 'NEURO451', trials: 0, replaced: false }));
    expect(await submitToClass(submission, fetchImpl)).toEqual({ ok: true, classCode: 'NEURO451', replaced: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/submit');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(submission);
  });

  it('passes on the server’s own explanation of a refusal', async () => {
    const refused = json({ ok: false, error: { code: 'invalid_class_code', message: 'A class code is 1 to 20 letters and digits.' } }, 400);
    expect(await submitToClass(submission, async () => refused)).toEqual({
      ok: false,
      code: 'invalid_class_code',
      message: 'A class code is 1 to 20 letters and digits.',
    });
  });

  it('turns a network failure into advice', async () => {
    const result = await submitToClass(submission, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result).toMatchObject({ ok: false, code: 'network' });
    if (!result.ok) expect(result.message).toMatch(/internet connection/);
  });

  it('recognises a site with no class server: the app’s own page instead of JSON, or a 404', async () => {
    for (const response of [html(200), html(404), html(405)]) {
      expect(await submitToClass(submission, async () => response)).toEqual({
        ok: false,
        code: 'unavailable',
        message: 'Class sharing is not available on this site.',
      });
    }
  });

  it('describes any other failure by its status', async () => {
    const result = await submitToClass(submission, async () => html(502));
    expect(result).toMatchObject({ ok: false, code: 'http_502' });
  });
});

describe('fetchClass', () => {
  it('asks for the class by code and returns the data with its version tag', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(classData, 200, { etag: '"NEURO451-0-0"' }));
    expect(await fetchClass('NEURO451', null, fetchImpl)).toEqual({ status: 'ok', data: classData, etag: '"NEURO451-0-0"' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/class/NEURO451');
    expect(init?.headers).toEqual({});
    expect(init?.cache).toBe('no-store');
  });

  it('sends the version it already has and accepts “unchanged”', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 304 }));
    expect(await fetchClass('NEURO451', '"NEURO451-3-9"', fetchImpl)).toEqual({ status: 'unchanged' });
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'if-none-match': '"NEURO451-3-9"' });
  });

  it('escapes the code in the address', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(classData));
    await fetchClass('A/B', null, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/class/A%2FB');
  });

  it('reports a missing database, a missing server and a network failure as errors, never throwing', async () => {
    const notConfigured = json({ ok: false, error: { code: 'not_configured', message: 'Class sharing has not been set up on this site yet.' } }, 503);
    expect(await fetchClass('X', null, async () => notConfigured)).toMatchObject({ status: 'error', code: 'not_configured' });
    expect(await fetchClass('X', null, async () => html(200))).toMatchObject({ status: 'error', code: 'unavailable' });
    expect(
      await fetchClass('X', null, async () => {
        throw new TypeError('offline');
      }),
    ).toMatchObject({ status: 'error', code: 'network' });
  });

  it('refuses JSON that is not a class response', async () => {
    expect(await fetchClass('X', null, async () => json({ hello: 'world' }))).toMatchObject({ status: 'error', code: 'unavailable' });
  });
});

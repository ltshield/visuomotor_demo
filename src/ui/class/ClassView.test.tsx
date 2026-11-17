// @vitest-environment jsdom
/**
 * The professor's class view. The chart itself needs a layout engine and is
 * checked in a real browser; here we check what the page says, how it polls,
 * and that a failed refresh never wipes what is already on screen.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassResponse, ClassSession } from '../../core/classWire';
import { GRADUAL_45_V2, SUDDEN_45_V2 } from '../../core/presets';
import type { FetchLike } from '../classClient';
import { ClassView } from './ClassView';

afterEach(cleanup);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A session with initial direction error `value` (degrees) and path error `value / 2` (%) on every reach. */
function session(presetId: string, value: number): ClassSession {
  return {
    presetId,
    rotationDeg: 45,
    trialTier: 'standard',
    consciousAdjustment: null,
    trials: Array.from({ length: 40 }, (_, i) => ({
      i,
      phase: i < 8 ? ('baseline' as const) : i < 32 ? ('adaptation' as const) : ('aftereffect' as const),
      catch: i === 19 || i === 27,
      rot: 0,
      err: value,
      pe: value / 2,
      valid: true,
    })),
  };
}

const response = (sessions: ClassSession[]): ClassResponse => ({ ok: true, classCode: 'NEURO451', count: sessions.length, sessions, truncated: false });

/** A fake server that answers each request with the next of `answers` (the last one repeats). */
function server(...answers: Array<() => Response>) {
  let k = 0;
  return vi.fn<FetchLike>(async () => answers[Math.min(k++, answers.length - 1)]());
}

describe('class view', () => {
  it('refuses something that is not a class code, without asking the server', () => {
    const fetchImpl = server(() => json(response([])));
    render(<ClassView code="not a code!" fetchImpl={fetchImpl} />);
    expect(screen.getByTestId('class-invalid').textContent).toContain('is not a class code');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows the code in capitals, how students join, and an empty chart until someone shares', async () => {
    const fetchImpl = server(() => json(response([]), 200, { etag: '"NEURO451-0-0"' }));
    render(<ClassView code="neuro451" fetchImpl={fetchImpl} pollMs={60_000} />);
    expect(screen.getByTestId('class-code').textContent).toBe('NEURO451');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/class/NEURO451');
    await waitFor(() => expect(screen.getByTestId('class-empty').textContent).toContain('Nobody has shared yet'));
    expect(screen.getByTestId('class-updated').textContent).toMatch(/^Last updated /);
    expect(screen.getByTestId('class-total').textContent).toBe('0');
    expect(document.body.textContent).toContain('enter the code NEURO451');
  });

  it('counts each version and reports the class means', async () => {
    const fetchImpl = server(() =>
      json(response([session(SUDDEN_45_V2.id, -20), session(SUDDEN_45_V2.id, -30), session(GRADUAL_45_V2.id, -10)])),
    );
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={60_000} />);
    await waitFor(() => expect(screen.getByTestId('class-total').textContent).toBe('3'));
    expect(screen.getByTestId('class-count-sudden').textContent).toBe('2');
    expect(screen.getByTestId('class-count-gradual').textContent).toBe('1');
    // Path error is shown first.
    expect(screen.getByTestId('class-chart-title').textContent).toMatch(/^Path error on every trial/);
    expect(screen.getByTestId('class-catch-sudden').textContent).toContain('−12.5% ± 3.5%');
    expect(screen.getByTestId('class-catch-sudden').textContent).toContain('n = 2');
    expect(screen.getByTestId('class-aftereffect-gradual').textContent).toContain('−5%');
    expect(screen.queryByTestId('class-empty')).toBeNull();
    expect(document.body.textContent).toContain('Descriptive only');
  });

  it('switches every number to the initial direction, and back', async () => {
    const fetchImpl = server(() => json(response([session(SUDDEN_45_V2.id, -20), session(SUDDEN_45_V2.id, -30)])));
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={60_000} />);
    await waitFor(() => expect(screen.getByTestId('class-total').textContent).toBe('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Initial direction' }));
    expect(screen.getByRole('button', { name: 'Initial direction' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('class-chart-title').textContent).toBe('Initial direction error on every trial');
    expect(screen.getByTestId('class-catch-sudden').textContent).toContain('−25° ± 7.1°');
    fireEvent.click(screen.getByRole('button', { name: 'Path error' }));
    expect(screen.getByTestId('class-catch-sudden').textContent).toContain('−12.5% ± 3.5%');
    // Switching is local: it does not ask the server again.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('polls with the version it holds, and keeps the data when the server says nothing changed', async () => {
    const fetchImpl = server(
      () => json(response([session(SUDDEN_45_V2.id, -20)]), 200, { etag: '"NEURO451-1-1"' }),
      () => new Response(null, { status: 304 }),
    );
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={25} />);
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({});
    expect(fetchImpl.mock.calls[1][1]?.headers).toEqual({ 'if-none-match': '"NEURO451-1-1"' });
    expect(screen.getByTestId('class-total').textContent).toBe('1');
    expect(screen.queryByTestId('class-problem')).toBeNull();
  });

  it('keeps showing the last data when a refresh fails, says so, and keeps trying', async () => {
    const fetchImpl = server(
      () => json(response([session(SUDDEN_45_V2.id, -20), session(GRADUAL_45_V2.id, -5)])),
      () => {
        throw new TypeError('offline');
      },
    );
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={25} />);
    await waitFor(() => expect(screen.getByTestId('class-problem').textContent).toContain('Could not reach the class server'));
    expect(screen.getByTestId('class-problem').textContent).toContain('Still showing the data from');
    expect(screen.getByTestId('class-total').textContent).toBe('2');
    const calls = fetchImpl.mock.calls.length;
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls));
  });

  it('stops refreshing on a site with no class server, and says why', async () => {
    const fetchImpl = server(() => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={25} />);
    await waitFor(() => expect(screen.getByTestId('class-problem').textContent).toContain('not available on this site'));
    expect(document.body.textContent).toContain('Not refreshing');
    // It really has stopped: several polling periods later there has been no second request.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('offers a separate view for another protocol and never pools it with the standard versions', async () => {
    const fetchImpl = server(() => json(response([session(SUDDEN_45_V2.id, -20), session('rotation-sudden-30-custom-v2', -99)])));
    render(<ClassView code="NEURO451" fetchImpl={fetchImpl} pollMs={60_000} />);
    await waitFor(() => expect(screen.getByLabelText('Protocol shown')).toBeTruthy());
    const options = [...(screen.getByLabelText('Protocol shown') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Standard versions: sudden and gradual (1)', 'rotation-sudden-30-custom-v2 (1)']);
    expect(screen.getByTestId('class-catch-sudden').textContent).toContain('−10%');
  });
});

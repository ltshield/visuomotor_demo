// @vitest-environment jsdom
/**
 * The opt-in "Share your results with the class" section: nothing is sent
 * until the student types a code and presses the button, the code is never
 * pre-filled, and every outcome is reported in words.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../core/record';
import type { TrialSpec } from '../../core/schedule';
import { scriptedSessionRecord } from '../../core/testUtils';
import type { FetchLike } from '../classClient';
import { ShareWithClass } from './ShareWithClass';

afterEach(cleanup);

const aim = (t: TrialSpec) => (t.phase === 'baseline' ? 3 : t.phase === 'adaptation' ? -35 : -18);
const session: SessionRecord = {
  ...scriptedSessionRecord('k7m2', aim),
  sessionId: '6f1c2a9e-3b7d-4c10-9a55-0e2f8d7b6a41',
  reflection: { skipped: false, noticed: 'PRIVATE-NOTE', consciousAdjustment: 'no', changedAim: null, device: 'mouse' },
};

const ok = () =>
  new Response(JSON.stringify({ ok: true, classCode: 'NEURO451', trials: 40, replaced: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const codeField = () => screen.getByLabelText(/Class code/) as HTMLInputElement;
const shareButton = () => screen.getByRole('button', { name: /Share anonymously|Sharing/ }) as HTMLButtonElement;

describe('share with the class', () => {
  it('starts empty and sends nothing on its own', () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok());
    window.history.replaceState(null, '', '/?class=NEURO451&code=NEURO451');
    render(<ShareWithClass session={session} fetchImpl={fetchImpl} />);
    // Not pre-filled, not even from the address.
    expect(codeField().value).toBe('');
    expect(shareButton().disabled).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });

  it('checks the code before sending anything', () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok());
    render(<ShareWithClass session={session} fetchImpl={fetchImpl} />);
    fireEvent.change(codeField(), { target: { value: 'NEURO 451!' } });
    fireEvent.click(shareButton());
    expect(screen.getByTestId('share-error').textContent).toMatch(/letters and numbers only/);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Editing the code clears the message.
    fireEvent.change(codeField(), { target: { value: 'NEURO451' } });
    expect(screen.queryByTestId('share-error')).toBeNull();
  });

  it('sends the summary for the typed code and confirms in the agreed words', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok());
    const onShared = vi.fn();
    render(<ShareWithClass session={session} fetchImpl={fetchImpl} onShared={onShared} />);
    fireEvent.change(codeField(), { target: { value: 'neuro451' } });
    fireEvent.click(shareButton());
    await waitFor(() => expect(screen.getByTestId('share-success').textContent).toContain('Your data has been added to the class view.'));
    expect(onShared).toHaveBeenCalledWith('NEURO451');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.classCode).toBe('neuro451');
    expect(body.trials).toHaveLength(session.schedule.length);
    expect(body.consciousAdjustment).toBe('no');
    expect(JSON.stringify(body)).not.toContain('PRIVATE-NOTE');
  });

  it('shows the server’s reason when sharing fails', async () => {
    const refused = new Response(JSON.stringify({ ok: false, error: { code: 'class_full', message: 'This class already holds 500 sessions.' } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
    render(<ShareWithClass session={session} fetchImpl={async () => refused} />);
    fireEvent.change(codeField(), { target: { value: 'NEURO451' } });
    fireEvent.click(shareButton());
    await waitFor(() => expect(screen.getByTestId('share-error').textContent).toBe('This class already holds 500 sessions.'));
    expect(screen.queryByTestId('share-success')).toBeNull();
  });

  it('shows exactly what would be sent, before anything is sent', () => {
    render(<ShareWithClass session={session} fetchImpl={vi.fn<FetchLike>()} />);
    const preview = JSON.parse(screen.getByTestId('share-preview').textContent ?? '');
    expect(preview.classCode).toBe('(the code you enter)');
    expect(preview.trials).toHaveLength(session.schedule.length);
    expect(Object.keys(preview.trials[0]).sort()).toEqual(['catch', 'err', 'i', 'pe', 'phase', 'rot', 'valid']);
  });

  it('does not offer to share a second run', () => {
    render(<ShareWithClass session={{ ...session, runNumber: 2 }} fetchImpl={vi.fn<FetchLike>()} />);
    expect(screen.getByTestId('share-unavailable').textContent).toContain('Only the first run');
    expect(screen.queryByLabelText(/Class code/)).toBeNull();
  });
});

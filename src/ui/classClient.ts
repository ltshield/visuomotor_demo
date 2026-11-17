/**
 * classClient.ts — the browser's two calls to the class-data API, with every
 * failure turned into a sentence a student or professor can act on.
 *
 * The API may be absent altogether: the site can be deployed without a
 * database, or served by a plain static host where `/api/...` returns the
 * app's own HTML. Both calls treat "the answer is not the JSON we expected" as
 * "class sharing is not available here" rather than as a crash.
 *
 * Key exports: `submitToClass`, `fetchClass`, and their result types.
 */

import type { ApiError, ClassResponse, ClassSubmission } from '../core/classWire';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ShareResult =
  | { ok: true; classCode: string; replaced: boolean }
  | { ok: false; code: string; message: string };

export type ClassFetchResult =
  /** Fresh data. `etag` identifies this version for the next request. */
  | { status: 'ok'; data: ClassResponse; etag: string | null }
  /** Nothing has changed since the version identified by the etag that was sent. */
  | { status: 'unchanged' }
  | { status: 'error'; code: string; message: string };

const UNREACHABLE = 'Could not reach the class server. Check your internet connection and try again.';
const UNAVAILABLE = 'Class sharing is not available on this site.';

/** The server's own explanation when it sent one, otherwise a general one for the status. */
async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body && body.ok === false && body.error && typeof body.error.message === 'string') {
      return { code: String(body.error.code), message: body.error.message };
    }
  } catch {
    // Not JSON: fall through to the general message.
  }
  if (response.status === 404 || response.status === 405) return { code: 'unavailable', message: UNAVAILABLE };
  return { code: `http_${response.status}`, message: `The class server answered with an error (${response.status}). Please try again in a moment.` };
}

const isJson = (response: Response) => (response.headers.get('content-type') ?? '').includes('application/json');

/** Send one anonymous summary. Never throws. */
export async function submitToClass(submission: ClassSubmission, fetchImpl: FetchLike = fetch): Promise<ShareResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submission),
    });
  } catch {
    return { ok: false, code: 'network', message: UNREACHABLE };
  }
  if (!response.ok) return { ok: false, ...(await readError(response)) };
  // A 200 that is not JSON is a static host answering with the app's own page.
  if (!isJson(response)) return { ok: false, code: 'unavailable', message: UNAVAILABLE };
  try {
    const body = (await response.json()) as { ok?: boolean; classCode?: string; replaced?: boolean };
    if (body.ok === true && typeof body.classCode === 'string') {
      return { ok: true, classCode: body.classCode, replaced: body.replaced === true };
    }
  } catch {
    // fall through
  }
  return { ok: false, code: 'unavailable', message: UNAVAILABLE };
}

/**
 * Read a class's sessions. Pass the `etag` of the copy already held to let the
 * server answer "unchanged" without re-reading everything. Never throws.
 */
export async function fetchClass(code: string, etag: string | null, fetchImpl: FetchLike = fetch): Promise<ClassFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/class/${encodeURIComponent(code)}`, {
      headers: etag ? { 'if-none-match': etag } : {},
      // Revalidation is done by hand with the etag above; keep the browser's own cache out of it.
      cache: 'no-store',
    });
  } catch {
    return { status: 'error', code: 'network', message: UNREACHABLE };
  }
  if (response.status === 304) return { status: 'unchanged' };
  if (!response.ok) return { status: 'error', ...(await readError(response)) };
  if (!isJson(response)) return { status: 'error', code: 'unavailable', message: UNAVAILABLE };
  try {
    const data = (await response.json()) as ClassResponse;
    if (data.ok === true && Array.isArray(data.sessions)) {
      return { status: 'ok', data, etag: response.headers.get('etag') };
    }
  } catch {
    // fall through
  }
  return { status: 'error', code: 'unavailable', message: UNAVAILABLE };
}

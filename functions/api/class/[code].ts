/**
 * GET /api/class/<code> — every anonymous session summary stored for a class code.
 *
 * Cloudflare Pages Function. `[code]` in the file name is the placeholder for
 * the class code; all logic is in src/server/classApi.ts, where it is unit-tested.
 */
import { handleClassGet, methodNotAllowed, type Env } from '../../../src/server/classApi';

interface Context {
  request: Request;
  env: Env;
  params: { code?: string | string[] };
}

export const onRequestGet = (context: Context): Promise<Response> => {
  const code = context.params.code;
  return handleClassGet(context.request, context.env, typeof code === 'string' ? code : '');
};

/** Any other method. (When both are exported, GET requests go to onRequestGet.) */
export const onRequest = (): Response => methodNotAllowed('GET');

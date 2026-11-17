/**
 * POST /api/submit — store one anonymous session summary in the class database.
 *
 * Cloudflare Pages Function. The file's path is its address; all logic is in
 * src/server/classApi.ts, where it is unit-tested.
 */
import { handleSubmit, methodNotAllowed, type Env } from '../../src/server/classApi';

interface Context {
  request: Request;
  env: Env;
}

export const onRequestPost = (context: Context): Promise<Response> => handleSubmit(context.request, context.env);

/** Any other method. (When both are exported, POST requests go to onRequestPost.) */
export const onRequest = (): Response => methodNotAllowed('POST');

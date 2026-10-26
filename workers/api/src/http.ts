import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { isToken } from '@mummer/crypto/light';
import { HttpError, type AppBindings } from './env.js';

export const MAX_BODY_BYTES = 96 * 1024;

type Ctx = Context<AppBindings>;

/** Read and validate a JSON body with a hard size cap (enforced while streaming, not just via Content-Length). */
export async function readBody<T>(c: Ctx, schema: ZodType<T>, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  const body = c.req.raw.body;
  if (!body) throw new HttpError(400, 'bad_request', 'A JSON body is required');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) {
    bytes.set(ch, o);
    o += ch.byteLength;
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(400, 'bad_request', 'Body is not valid JSON');
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    throw new HttpError(422, 'validation_failed', `${where}${first?.message ?? 'Invalid request'}`);
  }
  return r.data;
}

/** Parse `Authorization: Bearer <token>`. Tokens never travel in URLs or query strings. */
export function bearerToken(c: Ctx): string | undefined {
  const h = c.req.header('authorization');
  if (!h || !h.startsWith('Bearer ')) return undefined;
  const t = h.slice(7).trim();
  return isToken(t) ? t : undefined;
}

export const ID_RE = /^[0-9a-f]{32}$/;

export function pathId(c: Ctx, name: string): string {
  const v = c.req.param(name);
  if (!v || !ID_RE.test(v)) throw new HttpError(404, 'not_found', 'Not found');
  return v;
}

export function clientAddress(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

export function json<T>(c: Ctx, body: T, status: 200 | 201 = 200): Response {
  return c.json(body as never, status);
}

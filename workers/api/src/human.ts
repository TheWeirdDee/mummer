import { hashToken } from '@mummer/crypto/light';
import { HttpError, type Deps, type Env } from './env.js';
import { humanCheckRequired } from './services.js';

/**
 * Human-check tickets. The Turnstile widget runs in an isolated, sandboxed
 * frame (see apps/web/public/human-check.html) so no third-party script ever
 * shares an origin with pages that handle secrets. Its token is exchanged at
 * POST /api/human/verify for a single-use, ten-minute ticket that group
 * creation and joining consume.
 */

export const TICKET_TTL_SECONDS = 600;

export async function issueTicket(env: Env, deps: Deps, ticket: string): Promise<void> {
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  await env.DB.prepare('INSERT INTO human_tickets (hash, expires_at) VALUES (?1, ?2)').bind(hashToken(ticket), nowSec + TICKET_TTL_SECONDS).run();
}

/** Consume (delete) a valid ticket, or throw 403. A no-op where no human check is required (non-production without a secret). */
export async function consumeHumanTicket(env: Env, deps: Deps, ticket: string | undefined): Promise<void> {
  if (!humanCheckRequired(env)) return;
  if (!ticket) throw new HttpError(403, 'human_check_failed', 'Please complete the human check first.');
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  const row = await env.DB.prepare('DELETE FROM human_tickets WHERE hash = ?1 AND expires_at > ?2 RETURNING hash').bind(hashToken(ticket), nowSec).first();
  if (!row) throw new HttpError(403, 'human_check_failed', 'The human check expired or was already used. Please complete it again.');
}

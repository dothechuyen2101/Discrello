import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '../db/client';
import { findBoardByToken } from '../db/repos/boards';
import type { Board, Guild } from '../db/schema';
import type { IngestResult } from '../notifications/ingest';
import { verifyTrelloSignature } from './signature';

export interface TrelloWebhookOptions {
  db: Db;
  trelloSecret: string;
  ingest: (board: Board, guild: Guild, payload: unknown) => Promise<IngestResult>;
  onEnqueued: () => void;
}

/**
 * `HEAD|POST /webhooks/trello/:token`. Encapsulated so that the raw-body parser and the rate limit
 * apply to these routes only. Order on POST: token → signature → JSON → ingest.
 */
export const trelloWebhookRoutes: FastifyPluginAsync<TrelloWebhookOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  // Keep the exact bytes: the signature is computed over the raw body, not a re-serialization.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.head('/webhooks/trello/:token', async (_req, reply) => {
    return reply.code(200).send();
  });

  app.post<{ Params: { token: string } }>('/webhooks/trello/:token', async (req, reply) => {
    const found = await findBoardByToken(opts.db, req.params.token);
    if (!found) {
      req.log.warn({ ip: req.ip }, 'trello webhook: unknown token');
      return reply.code(404).send({ error: 'unknown_webhook' });
    }
    const { board, guild } = found;
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const ok =
      board.webhookCallbackUrl !== null &&
      verifyTrelloSignature({
        rawBody,
        callbackUrl: board.webhookCallbackUrl,
        secret: opts.trelloSecret,
        header: req.headers['x-trello-webhook'],
      });
    if (!ok) {
      req.log.warn({ ip: req.ip, boardId: board.id }, 'trello webhook: invalid signature');
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: 'invalid_json' });
    }

    const result = await opts.ingest(board, guild, payload);
    req.log.info({ boardId: board.id, result }, 'trello webhook processed');
    if (result.kind === 'enqueued' && result.status === 'pending') opts.onEnqueued();
    return reply.code(200).send({ ok: true, result: result.kind });
  });
};

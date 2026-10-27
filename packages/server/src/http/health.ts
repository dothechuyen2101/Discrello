import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client';

export const APP_VERSION = process.env['APP_VERSION'] ?? '0.1.0';

export async function healthRoutes(app: FastifyInstance, opts: { dbHandle: DbHandle }) {
  app.get('/api/health', async (_req, reply) => {
    try {
      await opts.dbHandle.ping();
      return { ok: true, version: APP_VERSION, uptimeSeconds: Math.round(process.uptime()) };
    } catch (err) {
      app.log.error({ err }, 'database ping failed');
      return reply.code(503).send({ ok: false, error: 'database_unreachable' });
    }
  });
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** Finds the built web UI: WEB_DIST env, or packages/web/dist relative to this package. */
export function findWebDist(configured?: string): string | null {
  const candidates = [
    configured,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist'),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(path.join(c, 'index.html'))) ?? null;
}

/** Serves the SPA with an index.html fallback for client-side routes. */
export async function registerStatic(app: FastifyInstance, webDist: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: false,
    index: ['index.html'],
  });
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (req.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/webhooks/')) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(404)
      .send({ error: 'not_found', message: `Route ${req.method} ${url} not found` });
  });
}

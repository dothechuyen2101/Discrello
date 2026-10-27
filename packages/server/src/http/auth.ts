import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import secureSession from '@fastify/secure-session';
import { loginSchema } from '@discrello/shared';
import type { Config } from '../config';
import { parse } from './util';

declare module '@fastify/secure-session' {
  interface SessionData {
    loggedInAt: number;
  }
}

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login']);

function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

export function isAuthenticated(req: FastifyRequest): boolean {
  return typeof req.session?.get('loggedInAt') === 'number';
}

/**
 * Single-admin auth: an encrypted, stateless session cookie set after checking ADMIN_PASSWORD.
 * Every /api/* route except /api/health and /api/auth/login requires it.
 */
export async function registerAuth(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(secureSession, {
    secret: config.SESSION_SECRET,
    salt: 'discrello-salt-1',
    cookieName: 'discrello_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
    },
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(path)) return;
    if (!isAuthenticated(req)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Login required' });
    }
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      if (!passwordMatches(body.password, config.ADMIN_PASSWORD)) {
        return reply.code(401).send({ error: 'invalid_password', message: 'Wrong password' });
      }
      req.session.set('loggedInAt', Date.now());
      return { authenticated: true };
    },
  );

  app.post('/api/auth/logout', async (req) => {
    req.session.delete();
    return { authenticated: false };
  });

  app.get('/api/auth/me', async () => ({ authenticated: true }));
}

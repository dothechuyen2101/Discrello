import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ValidationFailedError } from '../errors';
import { DiscordRequestError } from '../discord/client';
import { TrelloApiError } from '../trello/client';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Invalid input',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof ValidationFailedError) {
      return reply.code(422).send({
        error: 'validation_failed',
        code: err.validationCode,
        message: err.message,
        hint: err.hint,
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.status)
        .send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof DiscordRequestError || err instanceof TrelloApiError) {
      req.log.warn({ err }, 'upstream request failed');
      return reply.code(502).send({ error: 'upstream', message: err.message });
    }
    const fastifyErr = err as FastifyError;
    if (typeof fastifyErr?.statusCode === 'number' && fastifyErr.statusCode < 500) {
      return reply.code(fastifyErr.statusCode).send({
        error: fastifyErr.code ?? 'error',
        message: fastifyErr.message,
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
  });
}

import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  notificationsQuerySchema,
  webhookEventsQuerySchema,
} from '@discrello/shared';
import type { NotificationService } from '../../notifications/service';
import { parse } from '../util';

export async function notificationRoutes(
  app: FastifyInstance,
  opts: { notifications: NotificationService },
) {
  const { notifications } = opts;
  app.get('/api/notifications', async (req) =>
    notifications.list(parse(notificationsQuerySchema, req.query)),
  );
  app.get('/api/notifications/:id', async (req) =>
    notifications.get(parse(idParamSchema, req.params).id),
  );
  app.post('/api/notifications/:id/retry', async (req) =>
    notifications.retry(parse(idParamSchema, req.params).id),
  );
  app.get('/api/webhook-events', async (req) =>
    notifications.listEvents(parse(webhookEventsQuerySchema, req.query)),
  );
}

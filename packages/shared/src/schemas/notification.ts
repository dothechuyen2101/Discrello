import { z } from 'zod';

export const notificationStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'sent_no_mention',
  'failed',
]);

export const notificationsQuerySchema = z.object({
  guildId: z.coerce.number().int().positive().optional(),
  boardId: z.coerce.number().int().positive().optional(),
  status: notificationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const webhookEventsQuerySchema = z.object({
  boardId: z.coerce.number().int().positive().optional(),
  outcome: z.enum(['enqueued', 'ignored']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});
export type WebhookEventsQuery = z.infer<typeof webhookEventsQuerySchema>;

import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { notifications, webhookEvents } from '../db/schema';

export const NOTIFICATION_RETENTION_DAYS = 90;
export const WEBHOOK_EVENT_RETENTION_DAYS = 30;

export async function pruneOldRows(
  db: Db,
  now: Date,
): Promise<{ notifications: number; events: number }> {
  const nCut = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const eCut = new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * 86_400_000);
  const n = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, nCut))
    .returning({ id: notifications.id });
  const e = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, eCut))
    .returning({ id: webhookEvents.id });
  return { notifications: n.length, events: e.length };
}

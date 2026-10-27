import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Queryable } from '../types';
import { notifications, type Notification } from '../schema';
import { STALE_SENDING_MS } from '../../notifications/backoff';

/** Re-queues rows stuck in `sending` (the process died mid-send). */
export async function reclaimStale(db: Queryable, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SENDING_MS);
  const rows = await db
    .update(notifications)
    .set({ status: 'pending', lockedAt: null, updatedAt: now })
    .where(and(eq(notifications.status, 'sending'), lt(notifications.lockedAt, cutoff)))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Atomically claims due `pending` rows (FOR UPDATE SKIP LOCKED) and marks them `sending`. */
export async function claimDue(db: Queryable, now: Date, limit = 20): Promise<Notification[]> {
  const due = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.status, 'pending'), lte(notifications.nextAttemptAt, now)))
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  return db
    .update(notifications)
    .set({ status: 'sending', lockedAt: now, updatedAt: now })
    .where(inArray(notifications.id, due))
    .returning();
}

export async function markSent(
  db: Queryable,
  id: number,
  now: Date,
  discordMessageId: string,
  mentionVerified: boolean | null,
  /** Replaces the generic text when only some of a team's mentions did not register. */
  noMentionError = 'Message posted but Discord did not register the mention',
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: mentionVerified === false ? 'sent_no_mention' : 'sent',
      attempts: sql`${notifications.attempts} + 1`,
      discordMessageId,
      mentionVerified,
      lastError: mentionVerified === false ? noMentionError : null,
      lockedAt: null,
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(notifications.id, id));
}

export async function scheduleRetry(
  db: Queryable,
  id: number,
  now: Date,
  delayMs: number,
  error: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: 'pending',
      attempts: sql`${notifications.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      lastError: error,
      lockedAt: null,
      updatedAt: now,
    })
    .where(eq(notifications.id, id));
}

export async function markFailed(
  db: Queryable,
  id: number,
  now: Date,
  error: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: 'failed',
      attempts: sql`${notifications.attempts} + 1`,
      lastError: error,
      lockedAt: null,
      updatedAt: now,
    })
    .where(eq(notifications.id, id));
}

export async function getNotification(db: Queryable, id: number): Promise<Notification | null> {
  const rows = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface NotificationPageFilter {
  guildId?: number;
  boardId?: number;
  status?: Notification['status'];
  before?: number;
  limit: number;
}

export async function listNotifications(
  db: Queryable,
  filter: NotificationPageFilter,
): Promise<Notification[]> {
  const conds = [];
  if (filter.guildId) conds.push(eq(notifications.guildId, filter.guildId));
  if (filter.boardId) conds.push(eq(notifications.boardId, filter.boardId));
  if (filter.status) conds.push(eq(notifications.status, filter.status));
  if (filter.before) conds.push(lt(notifications.id, filter.before));
  return db
    .select()
    .from(notifications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(notifications.id))
    .limit(filter.limit);
}

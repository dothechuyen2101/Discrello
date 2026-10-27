import { eq, sql } from 'drizzle-orm';
import type { IgnoreReason, WebhookEventOutcome } from '@discrello/shared';
import type { Queryable } from '../types';
import { webhookEvents } from '../schema';

export interface RecordEventInput {
  trelloActionId: string;
  boardId: number | null;
  actionType: string;
  cardId: string | null;
  cardName: string | null;
  listId: string | null;
  listName: string | null;
  receivedAt: Date;
}

/**
 * Inserts the event with a placeholder outcome. Returns the new row id, or null when the action id
 * was already recorded (Trello redelivery) — in which case the duplicate counter is bumped.
 */
export async function recordEvent(db: Queryable, input: RecordEventInput): Promise<number | null> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ ...input, outcome: 'ignored', ignoreReason: null })
    .onConflictDoNothing({ target: webhookEvents.trelloActionId })
    .returning({ id: webhookEvents.id });
  const row = inserted[0];
  if (row) return row.id;
  await db
    .update(webhookEvents)
    .set({ duplicateCount: sql`${webhookEvents.duplicateCount} + 1` })
    .where(eq(webhookEvents.trelloActionId, input.trelloActionId));
  return null;
}

export async function finalizeEvent(
  db: Queryable,
  id: number,
  outcome: WebhookEventOutcome,
  ignoreReason: IgnoreReason | null,
): Promise<void> {
  await db.update(webhookEvents).set({ outcome, ignoreReason }).where(eq(webhookEvents.id, id));
}

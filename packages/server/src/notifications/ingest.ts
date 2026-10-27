import { eq } from 'drizzle-orm';
import { parseRevisionComment, type IgnoreReason } from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import { boards, notifications, type Board, type Guild } from '../db/schema';
import { findMappingForList } from '../db/repos/boards';
import { recipientForDelivery } from '../db/repos/recipients';
import { feedbackRef, loadFeedbackRecipient } from '../db/repos/feedback';
import { getDefaultCommentTemplate } from '../db/repos/settings';
import { finalizeEvent, recordEvent } from '../db/repos/webhookEvents';
import type { TrelloApi } from '../trello/client';
import { normalizeAction, type CardCommented } from '../trello/normalize';
import type { TrelloAction } from '../trello/types';
import { resolve, resolveComment } from './resolve';

export type IngestResult =
  | { kind: 'duplicate' }
  | { kind: 'ignored'; reason: IgnoreReason | 'malformed' }
  | { kind: 'enqueued'; notificationId: number; status: 'pending' | 'failed' };

export interface IngestDeps {
  db: Db;
  clock: Clock;
  /** Edited comments do not say which list the card is in, so it is looked up on Trello. */
  trello: Pick<TrelloApi, 'getCardList'>;
}

function rawEventFields(action: TrelloAction | null) {
  return {
    cardId: action?.data.card?.id ?? null,
    cardName: action?.data.card?.name ?? null,
    listId: action?.data.listAfter?.id ?? action?.data.list?.id ?? null,
    listName: action?.data.listAfter?.name ?? action?.data.list?.name ?? null,
  };
}

/**
 * The full pipeline for one webhook delivery, inside one transaction: normalize → dedupe by
 * action id → check the board → resolve the mapping → render → insert the outbox row.
 * Runs after the signature has been verified.
 */
export async function ingestEvent(
  deps: IngestDeps,
  board: Board,
  guild: Guild,
  payload: unknown,
): Promise<IngestResult> {
  const normalized = normalizeAction(payload);
  if (normalized.kind === 'commented') return ingestComment(deps, board, guild, normalized.event);
  const now = deps.clock();
  const action = normalized.kind === 'moved' ? null : normalized.action;
  const actionId = normalized.kind === 'moved' ? normalized.event.actionId : (action?.id ?? null);
  const actionType =
    normalized.kind === 'moved' ? normalized.event.actionType : (action?.type ?? null);

  if (!actionId || !actionType) return { kind: 'ignored', reason: 'malformed' };

  return deps.db.transaction(async (tx) => {
    const eventId = await recordEvent(tx, {
      trelloActionId: actionId,
      boardId: board.id,
      actionType,
      receivedAt: now,
      ...(normalized.kind === 'moved'
        ? {
            cardId: normalized.event.card.id,
            cardName: normalized.event.card.name,
            listId: normalized.event.list.id,
            listName: normalized.event.list.name,
          }
        : rawEventFields(action)),
    });
    if (eventId === null) return { kind: 'duplicate' };

    const ignore = async (reason: IgnoreReason): Promise<IngestResult> => {
      await finalizeEvent(tx, eventId, 'ignored', reason);
      return { kind: 'ignored', reason };
    };

    if (normalized.kind !== 'moved') return ignore('unsupported_action');
    const { event } = normalized;
    if (event.board.id !== board.trelloBoardId) return ignore('board_mismatch');

    const found = await findMappingForList(tx, board.id, event.list.id);
    const resolved = resolve({
      event,
      board,
      guild,
      mapping: found?.mapping ?? null,
      recipient: await recipientForDelivery(tx, found?.recipient ?? null, board.guildId),
    });
    if (resolved.kind === 'ignore') return ignore(resolved.reason);

    const status = resolved.missingTargetError ? 'failed' : 'pending';
    const inserted = await tx
      .insert(notifications)
      .values({
        trelloActionId: event.actionId,
        boardId: board.id,
        guildId: board.guildId,
        listMappingId: found!.mapping.id,
        roleId: found!.mapping.roleId,
        teamId: found!.mapping.teamId,
        triggerType: event.actionType,
        cardId: event.card.id,
        cardName: event.card.name,
        cardShortLink: event.card.shortLink,
        cardUrl: event.card.url,
        listId: event.list.id,
        listName: event.list.name,
        previousListName: event.previousList?.name ?? null,
        boardName: board.name,
        actorName: event.actor?.fullName || null,
        discordChannelId: resolved.channelId,
        mentionsJson: resolved.mentions,
        content: resolved.content,
        allowedMentionsJson: resolved.allowedMentions,
        status,
        attempts: 0,
        nextAttemptAt: now,
        lastError: resolved.missingTargetError,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: notifications.id });

    await finalizeEvent(tx, eventId, 'enqueued', null);
    await tx.update(boards).set({ lastEventAt: now }).where(eq(boards.id, board.id));
    return { kind: 'enqueued', notificationId: inserted[0]!.id, status };
  });
}

/**
 * Why a comment does not ping, before looking at mappings: no `comment:` prefix, or an edit of a
 * comment that already had it (an edit only pings when it is the one that adds the prefix).
 */
function commentSkipReason(event: CardCommented): IgnoreReason | null {
  if (parseRevisionComment(event.text) === null) return 'not_revision_comment';
  if (event.previousText !== null && parseRevisionComment(event.previousText) !== null) {
    return 'prefix_already_present';
  }
  return null;
}

/**
 * Revision comments: same pipeline as moves (dedupe → board check → mapping → render → outbox),
 * plus the prefix rules and a unique comment id so each comment pings at most once.
 */
async function ingestComment(
  deps: IngestDeps,
  board: Board,
  guild: Guild,
  event: CardCommented,
): Promise<IngestResult> {
  const now = deps.clock();
  const skip = commentSkipReason(event);
  const sameBoard = event.board.id === board.trelloBoardId;

  // Network call outside the transaction, and only for comments that can ping. If Trello is down
  // this throws, the webhook answers 502 and Trello redelivers later.
  let listRef = event.list;
  if (!listRef && !skip && sameBoard) {
    const current = await deps.trello.getCardList(event.card.id);
    if (current) listRef = { id: current.id, name: current.name ?? '' };
  }

  return deps.db.transaction(async (tx) => {
    const eventId = await recordEvent(tx, {
      trelloActionId: event.actionId,
      boardId: board.id,
      actionType: event.actionType,
      receivedAt: now,
      cardId: event.card.id,
      cardName: event.card.name,
      listId: listRef?.id ?? null,
      listName: listRef?.name ?? null,
    });
    if (eventId === null) return { kind: 'duplicate' };

    const ignore = async (reason: IgnoreReason): Promise<IngestResult> => {
      await finalizeEvent(tx, eventId, 'ignored', reason);
      return { kind: 'ignored', reason };
    };

    if (!sameBoard) return ignore('board_mismatch');
    if (skip) return ignore(skip);
    if (!listRef) return ignore('card_list_unknown');

    const found = await findMappingForList(tx, board.id, listRef.id);
    const feedbackTo = found ? await loadFeedbackRecipient(tx, found.mapping) : null;
    const resolved = resolveComment({
      event,
      list: listRef,
      feedback: parseRevisionComment(event.text) ?? '',
      defaultCommentTemplate: await getDefaultCommentTemplate(tx),
      board,
      guild,
      mapping: found?.mapping ?? null,
      recipient: await recipientForDelivery(tx, found?.recipient ?? null, board.guildId),
      feedbackRecipient: await recipientForDelivery(tx, feedbackTo, board.guildId),
    });
    if (resolved.kind === 'ignore') return ignore(resolved.reason);

    const status = resolved.missingTargetError ? 'failed' : 'pending';
    const inserted = await tx
      .insert(notifications)
      .values({
        trelloActionId: event.actionId,
        trelloCommentId: event.commentId,
        boardId: board.id,
        guildId: board.guildId,
        listMappingId: found!.mapping.id,
        // Who was pinged: the feedback recipient when the list has one, else the list's own.
        roleId: feedbackRef(found!.mapping) ? found!.mapping.feedbackRoleId : found!.mapping.roleId,
        teamId: feedbackRef(found!.mapping) ? found!.mapping.feedbackTeamId : found!.mapping.teamId,
        triggerType: event.actionType,
        cardId: event.card.id,
        cardName: event.card.name,
        cardShortLink: event.card.shortLink,
        cardUrl: event.card.url,
        listId: listRef.id,
        listName: listRef.name,
        previousListName: null,
        boardName: board.name,
        actorName: event.actor?.fullName || null,
        discordChannelId: resolved.channelId,
        mentionsJson: resolved.mentions,
        content: resolved.content,
        allowedMentionsJson: resolved.allowedMentions,
        status,
        attempts: 0,
        nextAttemptAt: now,
        lastError: resolved.missingTargetError,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: notifications.trelloCommentId })
      .returning({ id: notifications.id });
    // Another delivery for the same comment (e.g. the edit that re-adds the prefix) got here first.
    if (!inserted[0]) return ignore('comment_already_notified');

    await finalizeEvent(tx, eventId, 'enqueued', null);
    await tx.update(boards).set({ lastEventAt: now }).where(eq(boards.id, board.id));
    return { kind: 'enqueued', notificationId: inserted[0].id, status };
  });
}

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type {
  NotificationDto,
  NotificationsQuery,
  PageDto,
  WebhookEventDto,
  WebhookEventsQuery,
} from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import {
  boards,
  guilds,
  notifications,
  roles,
  teams,
  webhookEvents,
  type Notification,
} from '../db/schema';
import { findMappingForList } from '../db/repos/boards';
import { recipientForDelivery } from '../db/repos/recipients';
import { getNotification, listNotifications } from '../db/repos/notifications';
import { ConflictError, NotFoundError } from '../errors';
import { iso } from '../http/util';
import type { CardMoved } from '../trello/normalize';
import { resolve } from './resolve';

export interface NotificationServiceDeps {
  db: Db;
  clock: Clock;
  wake: () => void;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /**
   * Current board names, role keys and team names for a page of notifications, in one query per
   * table for the whole page (the database is ~200 ms away from the VPS, so per-row lookups add up).
   */
  private async namesFor(rows: Notification[]) {
    const boardIds = [...new Set(rows.map((r) => r.boardId))];
    const roleIds = [...new Set(rows.flatMap((r) => (r.roleId ? [r.roleId] : [])))];
    const teamIds = [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))];
    const [boardRows, roleRows, teamRows] = await Promise.all([
      boardIds.length
        ? this.deps.db
            .select({ id: boards.id, name: boards.name })
            .from(boards)
            .where(inArray(boards.id, boardIds))
        : Promise.resolve([]),
      roleIds.length
        ? this.deps.db
            .select({ id: roles.id, key: roles.key })
            .from(roles)
            .where(inArray(roles.id, roleIds))
        : Promise.resolve([]),
      teamIds.length
        ? this.deps.db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(inArray(teams.id, teamIds))
        : Promise.resolve([]),
    ]);
    return {
      boardName: new Map(boardRows.map((b) => [b.id, b.name])),
      roleKey: new Map(roleRows.map((r) => [r.id, r.key])),
      teamName: new Map(teamRows.map((t) => [t.id, t.name])),
    };
  }

  private toDto(
    row: Notification,
    names: Awaited<ReturnType<NotificationService['namesFor']>>,
  ): NotificationDto {
    return {
      id: row.id,
      trelloActionId: row.trelloActionId,
      boardId: row.boardId,
      boardName: names.boardName.get(row.boardId) ?? row.boardName,
      guildId: row.guildId,
      listMappingId: row.listMappingId,
      roleId: row.roleId,
      roleKey: row.roleId ? (names.roleKey.get(row.roleId) ?? null) : null,
      teamId: row.teamId,
      teamName: row.teamId ? (names.teamName.get(row.teamId) ?? null) : null,
      triggerType: row.triggerType,
      cardId: row.cardId,
      cardName: row.cardName,
      cardUrl: row.cardUrl,
      listId: row.listId,
      listName: row.listName,
      previousListName: row.previousListName,
      actorName: row.actorName,
      discordChannelId: row.discordChannelId,
      mentions: row.mentionsJson ?? [],
      content: row.content,
      allowedMentions: row.allowedMentionsJson,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      lastError: row.lastError,
      discordMessageId: row.discordMessageId,
      mentionVerified: row.mentionVerified,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sentAt: iso(row.sentAt),
    };
  }

  async list(query: NotificationsQuery): Promise<PageDto<NotificationDto>> {
    const rows = await listNotifications(this.deps.db, {
      guildId: query.guildId,
      boardId: query.boardId,
      status: query.status,
      before: query.before,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const names = await this.namesFor(page);
    const items = page.map((r) => this.toDto(r, names));
    return { items, nextBefore: rows.length > query.limit ? page[page.length - 1]!.id : null };
  }

  async get(id: number): Promise<NotificationDto> {
    const row = await getNotification(this.deps.db, id);
    if (!row) throw new NotFoundError(`Notification #${id} not found`);
    return this.toDto(row, await this.namesFor([row]));
  }

  /** Re-resolves the stored event against the current configuration and queues it again. */
  async retry(id: number): Promise<NotificationDto> {
    const row = await getNotification(this.deps.db, id);
    if (!row) throw new NotFoundError(`Notification #${id} not found`);
    if (row.status === 'pending' || row.status === 'sending') {
      throw new ConflictError('This notification is already queued');
    }
    const boardRows = await this.deps.db
      .select({ board: boards, guild: guilds })
      .from(boards)
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .where(eq(boards.id, row.boardId))
      .limit(1);
    const found = boardRows[0];
    if (!found) throw new ConflictError('The board of this notification no longer exists');

    const event: CardMoved = {
      actionId: row.trelloActionId,
      actionType: row.triggerType,
      occurredAt: row.createdAt.toISOString(),
      board: { id: found.board.trelloBoardId, name: found.board.name },
      list: { id: row.listId, name: row.listName },
      previousListName: undefined as never,
      previousList: row.previousListName ? { id: '', name: row.previousListName } : null,
      card: { id: row.cardId, name: row.cardName, shortLink: row.cardShortLink, url: row.cardUrl },
      actor: row.actorName ? { id: '', username: '', fullName: row.actorName } : null,
    } as CardMoved;

    const mapping = await findMappingForList(this.deps.db, row.boardId, row.listId);
    const resolved = resolve({
      event,
      board: found.board,
      guild: found.guild,
      mapping: mapping?.mapping ?? null,
      recipient: await recipientForDelivery(
        this.deps.db,
        mapping?.recipient ?? null,
        found.guild.id,
      ),
    });
    if (resolved.kind === 'ignore') {
      throw new ConflictError(
        `Nothing would be sent with the current configuration (${resolved.reason})`,
      );
    }
    const now = this.deps.clock();
    await this.deps.db
      .update(notifications)
      .set({
        listMappingId: mapping!.mapping.id,
        roleId: mapping!.mapping.roleId,
        teamId: mapping!.mapping.teamId,
        discordChannelId: resolved.channelId,
        mentionsJson: resolved.mentions,
        content: resolved.content,
        allowedMentionsJson: resolved.allowedMentions,
        status: resolved.missingTargetError ? 'failed' : 'pending',
        nextAttemptAt: now,
        lockedAt: null,
        lastError: resolved.missingTargetError,
        mentionVerified: null,
        discordMessageId: null,
        sentAt: null,
        updatedAt: now,
      })
      .where(eq(notifications.id, id));
    if (!resolved.missingTargetError) this.deps.wake();
    return this.get(id);
  }

  async listEvents(query: WebhookEventsQuery): Promise<PageDto<WebhookEventDto>> {
    const conds = [];
    if (query.boardId) conds.push(eq(webhookEvents.boardId, query.boardId));
    if (query.outcome) conds.push(eq(webhookEvents.outcome, query.outcome));
    if (query.before) conds.push(lt(webhookEvents.id, query.before));
    const rows = await this.deps.db
      .select({ e: webhookEvents, boardName: boards.name })
      .from(webhookEvents)
      .leftJoin(boards, eq(boards.id, webhookEvents.boardId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(webhookEvents.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ e, boardName }) => ({
        id: e.id,
        trelloActionId: e.trelloActionId,
        boardId: e.boardId,
        boardName,
        actionType: e.actionType,
        cardId: e.cardId,
        cardName: e.cardName,
        listId: e.listId,
        listName: e.listName,
        outcome: e.outcome,
        ignoreReason: e.ignoreReason as WebhookEventDto['ignoreReason'],
        duplicateCount: e.duplicateCount,
        receivedAt: e.receivedAt.toISOString(),
      })),
      nextBefore: rows.length > query.limit ? page[page.length - 1]!.e.id : null,
    };
  }
}

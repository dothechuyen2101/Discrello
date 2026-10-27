import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger } from 'fastify';
import {
  parseTrelloBoardRef,
  uniqueMentions,
  type BoardCreateInput,
  type BoardDetailDto,
  type BoardPatchInput,
  type BoardPreviewDto,
  type BoardSummaryDto,
  type ListMappingDto,
  type MappingPutInput,
  type MentionTarget,
  type TestSendResultDto,
  type TrelloListDto,
} from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import {
  boards,
  guilds,
  listMappings,
  roles,
  teams,
  trelloLists,
  type Board,
  type Guild,
  type ListMapping,
  type Role,
  type Team,
  type TrelloList,
} from '../db/schema';
import {
  loadRecipient,
  recipientName,
  recipientProblem,
  targetsInGuild,
  type Recipient,
} from '../db/repos/recipients';
import { FEEDBACK_ERROR_PREFIX, loadFeedbackRecipient } from '../db/repos/feedback';
import type { DiscordClient } from '../discord/client';
import { assertValid, type MentionValidator } from '../discord/validate';
import { BadRequestError, ConflictError, NotFoundError, ValidationFailedError } from '../errors';
import { iso } from '../http/util';
import { sendTestMessage } from '../notifications/testSend';
import { TrelloApiError, type TrelloApi } from '../trello/client';
import type { TrelloList as TrelloApiList } from '../trello/types';

export interface BoardServiceDeps {
  db: Db;
  trello: TrelloApi;
  discord: DiscordClient;
  validator: MentionValidator;
  clock: Clock;
  publicBaseUrl: string;
  logger: FastifyBaseLogger;
}

function toListDto(l: TrelloList): TrelloListDto {
  return {
    trelloListId: l.trelloListId,
    name: l.name,
    pos: l.pos,
    closed: l.closed,
    missing: l.missing,
  };
}

const feedbackRoles = alias(roles, 'feedback_roles');
const feedbackTeams = alias(teams, 'feedback_teams');

function toMappingDto(
  m: ListMapping,
  role: Role | null,
  team: Team | null,
  feedbackRole: Role | null,
  feedbackTeam: Team | null,
): ListMappingDto {
  return {
    id: m.id,
    trelloListId: m.trelloListId,
    roleId: role?.id ?? null,
    roleKey: role?.key ?? null,
    roleDisplayName: role?.displayName ?? null,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    messageTemplate: m.messageTemplate,
    commentTemplate: m.commentTemplate,
    feedbackRoleId: feedbackRole?.id ?? null,
    feedbackRoleDisplayName: feedbackRole?.displayName ?? null,
    feedbackTeamId: feedbackTeam?.id ?? null,
    feedbackTeamName: feedbackTeam?.name ?? null,
    overrideMention:
      m.overrideMentionKind && m.overrideMentionId
        ? { kind: m.overrideMentionKind, id: m.overrideMentionId }
        : null,
    overrideChannelId: m.overrideChannelId,
    checkStatus: m.checkStatus,
    checkError: m.checkError,
    checkedAt: iso(m.checkedAt),
    enabled: m.enabled,
    updatedAt: m.updatedAt.toISOString(),
  };
}

export class BoardService {
  constructor(private readonly deps: BoardServiceDeps) {}

  private callbackUrl(token: string): string {
    return `${this.deps.publicBaseUrl}/webhooks/trello/${token}`;
  }

  async getOrThrow(id: number): Promise<{ board: Board; guild: Guild }> {
    const rows = await this.deps.db
      .select({ board: boards, guild: guilds })
      .from(boards)
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .where(eq(boards.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundError(`Board #${id} not found`);
    return rows[0];
  }

  private async mappingsWithRecipients(boardId: number): Promise<
    Array<{
      mapping: ListMapping;
      role: Role | null;
      team: Team | null;
      feedbackRole: Role | null;
      feedbackTeam: Team | null;
    }>
  > {
    return this.deps.db
      .select({
        mapping: listMappings,
        role: roles,
        team: teams,
        feedbackRole: feedbackRoles,
        feedbackTeam: feedbackTeams,
      })
      .from(listMappings)
      .leftJoin(roles, eq(roles.id, listMappings.roleId))
      .leftJoin(teams, eq(teams.id, listMappings.teamId))
      .leftJoin(feedbackRoles, eq(feedbackRoles.id, listMappings.feedbackRoleId))
      .leftJoin(feedbackTeams, eq(feedbackTeams.id, listMappings.feedbackTeamId))
      .where(eq(listMappings.boardId, boardId));
  }

  private toSummary(
    board: Board,
    guild: Guild,
    mappingCount: number,
    mappingErrorCount: number,
  ): BoardSummaryDto {
    return {
      id: board.id,
      trelloBoardId: board.trelloBoardId,
      trelloShortLink: board.trelloShortLink,
      name: board.name,
      url: board.url,
      closed: board.closed,
      guildId: guild.id,
      guildName: guild.name,
      discordChannelId: board.discordChannelId,
      enabled: board.enabled,
      webhookStatus: board.webhookStatus,
      webhookLastCheckedAt: iso(board.webhookLastCheckedAt),
      webhookLastError: board.webhookLastError,
      webhookConsecutiveFailures: board.webhookConsecutiveFailures,
      lastEventAt: iso(board.lastEventAt),
      mappingCount,
      mappingErrorCount,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
    };
  }

  async list(): Promise<BoardSummaryDto[]> {
    const rows = await this.deps.db
      .select({ board: boards, guild: guilds })
      .from(boards)
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .orderBy(asc(boards.id));
    const counts = await this.deps.db
      .select({ boardId: listMappings.boardId, status: listMappings.checkStatus, n: count() })
      .from(listMappings)
      .groupBy(listMappings.boardId, listMappings.checkStatus);
    return rows.map(({ board, guild }) => {
      const mine = counts.filter((c) => c.boardId === board.id);
      const total = mine.reduce((a, c) => a + Number(c.n), 0);
      const errors = mine.filter((c) => c.status === 'error').reduce((a, c) => a + Number(c.n), 0);
      return this.toSummary(board, guild, total, errors);
    });
  }

  async detail(id: number): Promise<BoardDetailDto> {
    const { board, guild } = await this.getOrThrow(id);
    const [lists, mappings] = await Promise.all([
      this.deps.db
        .select()
        .from(trelloLists)
        .where(eq(trelloLists.boardId, id))
        .orderBy(asc(trelloLists.pos)),
      this.mappingsWithRecipients(id),
    ]);
    const errors = mappings.filter((m) => m.mapping.checkStatus === 'error').length;
    return {
      ...this.toSummary(board, guild, mappings.length, errors),
      webhookCallbackUrl: board.webhookCallbackUrl,
      listsSyncedAt: iso(board.listsSyncedAt),
      lists: lists.map(toListDto),
      mappings: mappings.map(({ mapping, role, team, feedbackRole, feedbackTeam }) =>
        toMappingDto(mapping, role, team, feedbackRole, feedbackTeam),
      ),
    };
  }

  private parseRef(ref: string): string {
    try {
      return parseTrelloBoardRef(ref).idOrShortLink;
    } catch (err) {
      throw new BadRequestError(
        err instanceof Error ? err.message : 'Invalid Trello board reference',
      );
    }
  }

  /**
   * Runs a Trello call made on behalf of the admin (preview, add, sync) and turns Trello's terse
   * errors into a message + hint the UI shows inline (HTTP 422).
   */
  private async onTrello<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TrelloApiError) throw await this.explainTrelloError(err);
      throw err;
    }
  }

  private async explainTrelloError(err: TrelloApiError): Promise<Error> {
    const body = err.body.toLowerCase();
    if (err.status === 401 && body.includes('invalid key')) {
      return new ValidationFailedError(
        'TRELLO_KEY_INVALID',
        'Trello rejected TRELLO_API_KEY.',
        'Copy the API key again from https://trello.com/power-ups/admin into .env and restart Discrello.',
      );
    }
    if (
      err.status === 401 &&
      (body.includes('invalid') || body.includes('expired')) &&
      body.includes('token')
    ) {
      return new ValidationFailedError(
        'TRELLO_TOKEN_INVALID',
        'Trello rejected TRELLO_API_TOKEN (revoked, expired, or created for a different API key).',
        'Generate a new token with the authorize link (install guide, section 5.2), put it in .env and restart Discrello.',
      );
    }
    if (err.status === 401) {
      const account = await this.deps.trello
        .getMe()
        .then((me) => `"${me.username}"${me.fullName ? ` (${me.fullName})` : ''}`)
        .catch(() => 'behind TRELLO_API_TOKEN');
      return new ValidationFailedError(
        'TRELLO_BOARD_NO_ACCESS',
        `The Trello account ${account} that Discrello uses is not a member of this board, so Trello refuses access.`,
        `Open the board in Trello → Share → invite ${account} as a member, then try again.`,
      );
    }
    if (err.status === 404 || (err.status === 400 && body.includes('invalid id'))) {
      return new ValidationFailedError(
        'TRELLO_BOARD_NOT_FOUND',
        'Trello has no board at this URL or ID.',
        'Open the board in Trello and copy the address from the browser (https://trello.com/b/…).',
      );
    }
    return err;
  }

  async preview(ref: string): Promise<BoardPreviewDto> {
    const idOrShortLink = this.parseRef(ref);
    const board = await this.onTrello(() => this.deps.trello.getBoard(idOrShortLink));
    const lists = await this.onTrello(() => this.deps.trello.getLists(board.id));
    const existing = await this.deps.db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.trelloBoardId, board.id))
      .limit(1);
    return {
      trelloBoardId: board.id,
      trelloShortLink: board.shortLink,
      name: board.name,
      url: board.url,
      closed: board.closed,
      lists: lists
        .sort((a, b) => a.pos - b.pos)
        .map((l) => ({
          trelloListId: l.id,
          name: l.name,
          pos: l.pos,
          closed: l.closed,
          missing: false,
        })),
      alreadyAdded: existing.length > 0,
    };
  }

  async add(input: BoardCreateInput): Promise<BoardDetailDto> {
    const idOrShortLink = this.parseRef(input.ref);
    const guildRows = await this.deps.db
      .select()
      .from(guilds)
      .where(eq(guilds.id, input.guildId))
      .limit(1);
    const guild = guildRows[0];
    if (!guild) throw new NotFoundError(`Server #${input.guildId} not found`);

    const trelloBoard = await this.onTrello(() => this.deps.trello.getBoard(idOrShortLink));
    const dup = await this.deps.db
      .select()
      .from(boards)
      .where(eq(boards.trelloBoardId, trelloBoard.id))
      .limit(1);
    if (dup[0]) throw new ConflictError(`Board "${trelloBoard.name}" is already added`);

    assertValid(
      await this.deps.validator.validate({
        discordGuildId: guild.discordGuildId,
        channelId: input.discordChannelId,
        target: null,
      }),
    );

    const lists = await this.onTrello(() => this.deps.trello.getLists(trelloBoard.id));
    const now = this.deps.clock();
    const token = randomBytes(16).toString('hex');
    const board = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(boards)
        .values({
          trelloBoardId: trelloBoard.id,
          trelloShortLink: trelloBoard.shortLink,
          name: trelloBoard.name,
          url: trelloBoard.url,
          closed: trelloBoard.closed,
          guildId: guild.id,
          discordChannelId: input.discordChannelId,
          webhookToken: token,
          webhookStatus: 'unregistered',
          listsSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.writeLists(tx, row!.id, lists, now);
      return row!;
    });
    await this.registerWebhookFor(board);
    return this.detail(board.id);
  }

  private async writeLists(
    db: Pick<Db, 'insert' | 'update' | 'select'>,
    boardId: number,
    lists: TrelloApiList[],
    now: Date,
  ): Promise<void> {
    // A constant number of statements whatever the board size: the database is ~200 ms away from
    // the VPS, and production boards have hundreds of lists (one statement per list took ~60 s
    // for a 292-list board and nginx timed the request out).
    const CHUNK = 500;
    for (let i = 0; i < lists.length; i += CHUNK) {
      await db
        .insert(trelloLists)
        .values(
          lists.slice(i, i + CHUNK).map((l) => ({
            boardId,
            trelloListId: l.id,
            name: l.name,
            pos: l.pos,
            closed: l.closed,
            missing: false,
            lastSeenAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: trelloLists.trelloListId,
          set: {
            name: sql`excluded.name`,
            pos: sql`excluded.pos`,
            closed: sql`excluded.closed`,
            missing: false,
            lastSeenAt: now,
          },
        });
    }
    // Lists Trello no longer returns are kept (their mappings too) but flagged as missing.
    if (lists.length) {
      await db
        .update(trelloLists)
        .set({ missing: true })
        .where(
          and(
            eq(trelloLists.boardId, boardId),
            notInArray(
              trelloLists.trelloListId,
              lists.map((l) => l.id),
            ),
          ),
        );
    }
  }

  async syncLists(id: number): Promise<BoardDetailDto> {
    const { board } = await this.getOrThrow(id);
    const lists = await this.onTrello(() => this.deps.trello.getLists(board.trelloBoardId));
    const now = this.deps.clock();
    await this.writeLists(this.deps.db, id, lists, now);
    await this.deps.db
      .update(boards)
      .set({ listsSyncedAt: now, updatedAt: now })
      .where(eq(boards.id, id));
    return this.detail(id);
  }

  /** Deletes the previous webhook (if any) and registers a fresh one for the current base URL. */
  private async registerWebhookFor(board: Board): Promise<void> {
    const now = this.deps.clock();
    const callbackURL = this.callbackUrl(board.webhookToken);
    try {
      if (board.webhookId) {
        await this.deps.trello.deleteWebhook(board.webhookId).catch(() => undefined);
      }
      const wh = await this.deps.trello.createWebhook({
        callbackURL,
        idModel: board.trelloBoardId,
        description: `Discrello: ${board.name}`,
      });
      await this.deps.db
        .update(boards)
        .set({
          webhookId: wh.id,
          webhookCallbackUrl: callbackURL,
          webhookStatus: 'active',
          webhookConsecutiveFailures: 0,
          webhookLastCheckedAt: now,
          webhookLastError: null,
          updatedAt: now,
        })
        .where(eq(boards.id, board.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn({ err, boardId: board.id }, 'trello webhook registration failed');
      await this.deps.db
        .update(boards)
        .set({
          webhookStatus: 'error',
          webhookLastError: message,
          webhookLastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(boards.id, board.id));
    }
  }

  async registerWebhook(id: number): Promise<BoardDetailDto> {
    const { board } = await this.getOrThrow(id);
    await this.registerWebhookFor(board);
    return this.detail(id);
  }

  /** Verifies the webhook still exists, is active and points at us; repairs it when it does not. */
  async checkWebhook(id: number): Promise<BoardDetailDto> {
    const { board } = await this.getOrThrow(id);
    const now = this.deps.clock();
    const expected = this.callbackUrl(board.webhookToken);
    try {
      const trelloBoard = await this.deps.trello.getBoard(board.trelloBoardId).catch(() => null);
      if (trelloBoard) {
        await this.deps.db
          .update(boards)
          .set({ name: trelloBoard.name, closed: trelloBoard.closed, url: trelloBoard.url })
          .where(eq(boards.id, id));
      }
      if (!board.webhookId) {
        await this.registerWebhookFor(board);
        return this.detail(id);
      }
      const wh = await this.deps.trello.getWebhook(board.webhookId);
      if (!wh) {
        this.deps.logger.warn({ boardId: id }, 'trello webhook missing, re-registering');
        await this.deps.db
          .update(boards)
          .set({ webhookStatus: 'missing' })
          .where(eq(boards.id, id));
        await this.registerWebhookFor(board);
        return this.detail(id);
      }
      if (wh.callbackURL !== expected) {
        this.deps.logger.warn(
          { boardId: id, have: wh.callbackURL, expected },
          'trello webhook URL mismatch, re-registering',
        );
        await this.deps.db
          .update(boards)
          .set({ webhookStatus: 'mismatch' })
          .where(eq(boards.id, id));
        await this.registerWebhookFor({ ...board, webhookId: wh.id });
        return this.detail(id);
      }
      let status: Board['webhookStatus'] = 'active';
      let lastError: string | null = null;
      if (!wh.active) {
        try {
          await this.deps.trello.updateWebhook(wh.id, { active: true });
          this.deps.logger.warn({ boardId: id }, 'trello webhook was inactive, re-enabled');
        } catch (err) {
          status = 'inactive';
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      await this.deps.db
        .update(boards)
        .set({
          webhookStatus: status,
          webhookCallbackUrl: wh.callbackURL,
          webhookConsecutiveFailures: wh.consecutiveFailures ?? 0,
          webhookLastCheckedAt: now,
          webhookLastError: lastError,
          updatedAt: now,
        })
        .where(eq(boards.id, id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.db
        .update(boards)
        .set({
          webhookStatus: 'error',
          webhookLastError: message,
          webhookLastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(boards.id, id));
    }
    return this.detail(id);
  }

  async patch(id: number, input: BoardPatchInput): Promise<BoardDetailDto> {
    const { board, guild } = await this.getOrThrow(id);
    if (input.discordChannelId && input.discordChannelId !== board.discordChannelId) {
      assertValid(
        await this.deps.validator.validate({
          discordGuildId: guild.discordGuildId,
          channelId: input.discordChannelId,
          target: null,
        }),
      );
      // Every mapping that inherits the board channel must still be able to ping there.
      for (const { mapping, role, team } of await this.mappingsWithRecipients(id)) {
        if (mapping.overrideChannelId || !mapping.enabled) continue;
        for (const { who, target } of await this.effectiveTargets(mapping, guild)) {
          const result = await this.deps.validator.validate({
            discordGuildId: guild.discordGuildId,
            channelId: input.discordChannelId,
            target,
          });
          if (!result.ok) {
            const list = await this.listName(id, mapping.trelloListId);
            const owner = team ? `team ${team.name}` : (role?.displayName ?? 'role');
            throw new ValidationFailedError(
              result.code,
              `List "${list}" (${owner}${who && team ? `, ${who}` : ''}): ${result.message}`,
              result.hint,
            );
          }
        }
        const feedback = await loadFeedbackRecipient(this.deps.db, mapping);
        if (feedback) {
          await this.assertRecipientPingable(
            feedback,
            guild,
            input.discordChannelId,
            `List "${await this.listName(id, mapping.trelloListId)}", ${FEEDBACK_ERROR_PREFIX}`,
          );
        }
      }
    }
    await this.deps.db
      .update(boards)
      .set({
        ...(input.discordChannelId !== undefined
          ? { discordChannelId: input.discordChannelId }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: this.deps.clock(),
      })
      .where(eq(boards.id, id));
    return this.detail(id);
  }

  async remove(id: number): Promise<void> {
    const { board } = await this.getOrThrow(id);
    if (board.webhookId) {
      try {
        await this.deps.trello.deleteWebhook(board.webhookId);
      } catch (err) {
        this.deps.logger.warn({ err, boardId: id }, 'could not delete the trello webhook');
      }
    }
    await this.deps.db.delete(boards).where(eq(boards.id, id));
  }

  private async listName(boardId: number, trelloListId: string): Promise<string> {
    const rows = await this.deps.db
      .select({ name: trelloLists.name })
      .from(trelloLists)
      .where(and(eq(trelloLists.boardId, boardId), eq(trelloLists.trelloListId, trelloListId)))
      .limit(1);
    return rows[0]?.name ?? trelloListId;
  }

  /**
   * Who this mapping pings in the board's guild: the override, else the role's target, else every
   * team member that has a target. `who` names the team member, for error messages.
   */
  async effectiveTargets(
    mapping: Pick<ListMapping, 'roleId' | 'teamId' | 'overrideMentionKind' | 'overrideMentionId'>,
    guild: Guild,
  ): Promise<Array<{ who: string | null; target: MentionTarget }>> {
    if (mapping.overrideMentionKind && mapping.overrideMentionId) {
      return [
        { who: null, target: { kind: mapping.overrideMentionKind, id: mapping.overrideMentionId } },
      ];
    }
    const recipient = await loadRecipient(this.deps.db, mapping);
    if (!recipient) return [];
    const { targets } = await targetsInGuild(this.deps.db, recipient, guild.id);
    return targets.map((t) => ({ who: t.who.displayName, target: t.target }));
  }

  /**
   * Refuses (422) when someone in `recipient` has no target in this server, or would not be
   * notified in the channel. `prefix` says where the recipient is used, e.g. "Feedback: ".
   */
  private async assertRecipientPingable(
    recipient: Recipient,
    guild: Guild,
    channelId: string,
    prefix: string,
  ): Promise<void> {
    const resolved = await targetsInGuild(this.deps.db, recipient, guild.id);
    const problem = recipientProblem(recipient, resolved, guild.name);
    if (problem) {
      throw new ValidationFailedError(problem.code, `${prefix}${problem.message}`, problem.hint);
    }
    for (const { who, target } of resolved.targets) {
      const result = await this.deps.validator.validate({
        discordGuildId: guild.discordGuildId,
        channelId,
        target,
      });
      if (!result.ok) {
        const whom =
          recipient.kind === 'team'
            ? `Team ${recipientName(recipient)}, ${who.displayName}: `
            : `${who.displayName}: `;
        throw new ValidationFailedError(
          result.code,
          `${prefix}${whom}${result.message}`,
          result.hint,
        );
      }
    }
  }

  private async recipientOrThrow(input: MappingPutInput): Promise<Recipient> {
    const recipient = await loadRecipient(this.deps.db, {
      roleId: input.roleId ?? null,
      teamId: input.teamId ?? null,
    });
    if (!recipient) {
      throw new NotFoundError(
        input.teamId ? `Team #${input.teamId} not found` : `Role #${input.roleId} not found`,
      );
    }
    return recipient;
  }

  async upsertMapping(
    boardId: number,
    trelloListId: string,
    input: MappingPutInput,
  ): Promise<ListMappingDto> {
    const { board, guild } = await this.getOrThrow(boardId);
    const listRows = await this.deps.db
      .select()
      .from(trelloLists)
      .where(and(eq(trelloLists.boardId, boardId), eq(trelloLists.trelloListId, trelloListId)))
      .limit(1);
    if (!listRows[0])
      throw new NotFoundError('Unknown list for this board — re-sync the lists from Trello');
    const recipient = await this.recipientOrThrow(input);

    // Everyone who will be pinged, each checked against the channel: a team member who would not
    // be notified blocks the save just like a single role target would.
    let targets: Array<{ who: string | null; target: MentionTarget }>;
    if (input.overrideMention) {
      targets = [{ who: null, target: input.overrideMention }];
    } else {
      const resolved = await targetsInGuild(this.deps.db, recipient, guild.id);
      const problem = recipientProblem(recipient, resolved, guild.name);
      if (problem) throw new ValidationFailedError(problem.code, problem.message, problem.hint);
      targets = resolved.targets.map((t) => ({ who: t.who.displayName, target: t.target }));
    }
    const channelId = input.overrideChannelId ?? board.discordChannelId;
    // Whoever receives the list's revision feedback, when it is not the list's own recipient.
    let feedback: Recipient | null = null;
    if (input.feedbackRoleId || input.feedbackTeamId) {
      feedback = await loadRecipient(this.deps.db, {
        roleId: input.feedbackRoleId ?? null,
        teamId: input.feedbackTeamId ?? null,
      });
      if (!feedback) {
        throw new NotFoundError(
          input.feedbackTeamId
            ? `Team #${input.feedbackTeamId} not found`
            : `Role #${input.feedbackRoleId} not found`,
        );
      }
    }
    for (const { who, target } of targets) {
      const result = await this.deps.validator.validate({
        discordGuildId: guild.discordGuildId,
        channelId,
        target,
      });
      if (!result.ok) {
        throw new ValidationFailedError(
          result.code,
          recipient.kind === 'team' && who
            ? `Team ${recipientName(recipient)}, ${who}: ${result.message}`
            : result.message,
          result.hint,
        );
      }
    }

    if (feedback)
      await this.assertRecipientPingable(feedback, guild, channelId, FEEDBACK_ERROR_PREFIX);

    const now = this.deps.clock();
    const values = {
      roleId: recipient.kind === 'role' ? recipient.role.id : null,
      teamId: recipient.kind === 'team' ? recipient.team.id : null,
      messageTemplate: input.messageTemplate,
      commentTemplate: input.commentTemplate ?? null,
      feedbackRoleId: feedback?.kind === 'role' ? feedback.role.id : null,
      feedbackTeamId: feedback?.kind === 'team' ? feedback.team.id : null,
      overrideMentionKind: input.overrideMention?.kind ?? null,
      overrideMentionId: input.overrideMention?.id ?? null,
      overrideChannelId: input.overrideChannelId ?? null,
      checkStatus: 'ok' as const,
      checkError: null,
      checkedAt: now,
      enabled: input.enabled,
      updatedAt: now,
    };
    const [row] = await this.deps.db
      .insert(listMappings)
      .values({ boardId, trelloListId, createdAt: now, ...values })
      .onConflictDoUpdate({
        target: [listMappings.boardId, listMappings.trelloListId],
        set: values,
      })
      .returning();
    return toMappingDto(
      row!,
      recipient.kind === 'role' ? recipient.role : null,
      recipient.kind === 'team' ? recipient.team : null,
      feedback?.kind === 'role' ? feedback.role : null,
      feedback?.kind === 'team' ? feedback.team : null,
    );
  }

  async deleteMapping(boardId: number, trelloListId: string): Promise<void> {
    await this.getOrThrow(boardId);
    const deleted = await this.deps.db
      .delete(listMappings)
      .where(and(eq(listMappings.boardId, boardId), eq(listMappings.trelloListId, trelloListId)))
      .returning({ id: listMappings.id });
    if (!deleted.length) throw new NotFoundError('This list is not mapped');
  }

  async testMapping(boardId: number, trelloListId: string): Promise<TestSendResultDto> {
    const { board, guild } = await this.getOrThrow(boardId);
    const rows = await this.deps.db
      .select()
      .from(listMappings)
      .where(and(eq(listMappings.boardId, boardId), eq(listMappings.trelloListId, trelloListId)))
      .limit(1);
    const mapping = rows[0];
    if (!mapping) throw new NotFoundError('This list is not mapped');
    const targets = uniqueMentions(
      (await this.effectiveTargets(mapping, guild)).map((t) => t.target),
    );
    const channelId = mapping.overrideChannelId ?? board.discordChannelId;
    return sendTestMessage(this.deps.discord, {
      channelId,
      targets,
      template: mapping.messageTemplate,
      vars: { list_name: await this.listName(boardId, trelloListId), board_name: board.name },
    });
  }

  /** Startup + periodic: repair every enabled board's webhook and remove orphans pointing at us. */
  async reconcileAll(): Promise<{ checked: number; orphansDeleted: number }> {
    const rows = await this.deps.db.select().from(boards).where(eq(boards.enabled, true));
    for (const board of rows) {
      await this.checkWebhook(board.id).catch((err) =>
        this.deps.logger.warn({ err, boardId: board.id }, 'webhook check failed'),
      );
    }
    let orphansDeleted = 0;
    try {
      const prefix = `${this.deps.publicBaseUrl}/webhooks/trello/`;
      const known = new Set(
        (await this.deps.db.select({ token: boards.webhookToken }).from(boards)).map(
          (b) => b.token,
        ),
      );
      for (const wh of await this.deps.trello.listTokenWebhooks()) {
        if (!wh.callbackURL.startsWith(prefix)) continue;
        const token = wh.callbackURL.slice(prefix.length);
        if (known.has(token)) continue;
        await this.deps.trello.deleteWebhook(wh.id);
        orphansDeleted += 1;
      }
    } catch (err) {
      if (!(err instanceof TrelloApiError)) throw err;
      this.deps.logger.warn({ err }, 'could not list trello webhooks for orphan cleanup');
    }
    return { checked: rows.length, orphansDeleted };
  }
}

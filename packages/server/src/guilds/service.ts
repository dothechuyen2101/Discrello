import { ChannelType } from 'discord-api-types/v10';
import { count, eq } from 'drizzle-orm';
import type {
  BotGuildDto,
  DiscordChannelDto,
  DiscordRoleDto,
  GuildCreateInput,
  GuildDto,
  GuildPatchInput,
} from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import { boards, guilds, type Guild } from '../db/schema';
import type { DiscordClient } from '../discord/client';
import { assertValid, type MentionValidator } from '../discord/validate';
import { ConflictError, NotFoundError } from '../errors';
import { iso } from '../http/util';

export interface GuildServiceDeps {
  db: Db;
  discord: DiscordClient;
  validator: MentionValidator;
  clock: Clock;
}

const CHANNEL_TYPES_FOR_UI = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

export function toGuildDto(row: Guild, boardCount: number): GuildDto {
  return {
    id: row.id,
    discordGuildId: row.discordGuildId,
    name: row.name,
    alertChannelId: row.alertChannelId,
    botStatus: row.botStatus,
    botCheckError: row.botCheckError,
    botCheckedAt: iso(row.botCheckedAt),
    enabled: row.enabled,
    boardCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class GuildService {
  constructor(private readonly deps: GuildServiceDeps) {}

  async getOrThrow(id: number): Promise<Guild> {
    const rows = await this.deps.db.select().from(guilds).where(eq(guilds.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError(`Server #${id} not found`);
    return rows[0];
  }

  private async boardCount(guildId: number): Promise<number> {
    const rows = await this.deps.db
      .select({ n: count() })
      .from(boards)
      .where(eq(boards.guildId, guildId));
    return Number(rows[0]?.n ?? 0);
  }

  async dto(row: Guild): Promise<GuildDto> {
    return toGuildDto(row, await this.boardCount(row.id));
  }

  async list(): Promise<GuildDto[]> {
    const rows = await this.deps.db.select().from(guilds).orderBy(guilds.id);
    return Promise.all(rows.map((r) => this.dto(r)));
  }

  async botGuilds(): Promise<BotGuildDto[]> {
    const [botGuilds, existing] = await Promise.all([
      this.deps.discord.getCurrentUserGuilds(),
      this.deps.db.select({ id: guilds.discordGuildId }).from(guilds),
    ]);
    const added = new Set(existing.map((g) => g.id));
    return botGuilds.map((g) => ({ id: g.id, name: g.name, alreadyAdded: added.has(g.id) }));
  }

  async add(input: GuildCreateInput): Promise<GuildDto> {
    const existing = await this.deps.db
      .select()
      .from(guilds)
      .where(eq(guilds.discordGuildId, input.discordGuildId))
      .limit(1);
    if (existing[0]) throw new ConflictError('This Discord server is already added');

    const data = await this.deps.validator.getGuildData(input.discordGuildId);
    assertValid(
      await this.deps.validator.validate({
        discordGuildId: input.discordGuildId,
        channelId: null,
        target: null,
      }),
    );
    if (input.alertChannelId) {
      assertValid(
        await this.deps.validator.validate({
          discordGuildId: input.discordGuildId,
          channelId: input.alertChannelId,
          target: null,
        }),
      );
    }
    const now = this.deps.clock();
    const [row] = await this.deps.db
      .insert(guilds)
      .values({
        discordGuildId: input.discordGuildId,
        name: data.guild.name,
        alertChannelId: input.alertChannelId ?? null,
        botStatus: 'ok',
        botCheckedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.dto(row!);
  }

  async patch(id: number, input: GuildPatchInput): Promise<GuildDto> {
    const guild = await this.getOrThrow(id);
    if (input.alertChannelId) {
      assertValid(
        await this.deps.validator.validate({
          discordGuildId: guild.discordGuildId,
          channelId: input.alertChannelId,
          target: null,
        }),
      );
    }
    const [row] = await this.deps.db
      .update(guilds)
      .set({
        ...(input.alertChannelId !== undefined ? { alertChannelId: input.alertChannelId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: this.deps.clock(),
      })
      .where(eq(guilds.id, id))
      .returning();
    return this.dto(row!);
  }

  async remove(id: number): Promise<void> {
    await this.getOrThrow(id);
    if ((await this.boardCount(id)) > 0) {
      throw new ConflictError('Remove the boards that use this server first');
    }
    await this.deps.db.delete(guilds).where(eq(guilds.id, id));
  }

  async check(id: number): Promise<GuildDto> {
    const guild = await this.getOrThrow(id);
    this.deps.validator.invalidate(guild.discordGuildId);
    const status = await this.deps.validator.botStatus(guild.discordGuildId);
    let name = guild.name;
    let botStatus = status.status;
    let error = status.error;
    if (status.status === 'ok') {
      const data = await this.deps.validator.getGuildData(guild.discordGuildId);
      name = data.guild.name;
      if (guild.alertChannelId) {
        const alert = await this.deps.validator.validate({
          discordGuildId: guild.discordGuildId,
          channelId: guild.alertChannelId,
          target: null,
        });
        if (!alert.ok) {
          botStatus = 'missing_permissions';
          error = `Alert channel: ${alert.message} ${alert.hint}`;
        }
      }
    }
    const [row] = await this.deps.db
      .update(guilds)
      .set({
        name,
        botStatus,
        botCheckError: error,
        botCheckedAt: this.deps.clock(),
        updatedAt: this.deps.clock(),
      })
      .where(eq(guilds.id, id))
      .returning();
    return this.dto(row!);
  }

  async channels(id: number): Promise<DiscordChannelDto[]> {
    const guild = await this.getOrThrow(id);
    const data = await this.deps.validator.getGuildData(guild.discordGuildId);
    return data.channels
      .filter((c) => CHANNEL_TYPES_FOR_UI.has(c.type) && !c.thread_metadata?.archived)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        type: c.type,
        parentId: c.parent_id ?? null,
      }));
  }

  async roles(id: number): Promise<DiscordRoleDto[]> {
    const guild = await this.getOrThrow(id);
    const data = await this.deps.validator.getGuildData(guild.discordGuildId);
    return data.roles
      .filter((r) => r.id !== data.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mentionable: r.mentionable,
        managed: r.managed,
        color: r.color,
      }));
  }
}

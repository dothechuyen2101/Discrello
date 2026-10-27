import {
  ChannelType,
  PermissionFlagsBits,
  type APIGuild,
  type APIGuildMember,
  type APIRole,
  type APIUser,
} from 'discord-api-types/v10';
import type { BotStatus, MentionTarget } from '@discrello/shared';
import type { Clock } from '../db/types';
import { ValidationFailedError } from '../errors';
import { DiscordRequestError, type DiscordClient } from './client';
import { computeChannelPermissions, hasPermission, type PermissionOverwrite } from './permissions';

/** The channel fields we read, regardless of the exact APIChannel variant. */
export interface ChannelLike {
  id: string;
  type: number;
  name?: string | null;
  parent_id?: string | null;
  position?: number;
  permission_overwrites?: PermissionOverwrite[];
  thread_metadata?: { archived?: boolean } | null;
}

export interface GuildData {
  guild: APIGuild;
  roles: APIRole[];
  channels: ChannelLike[];
  botUser: APIUser;
  botMember: APIGuildMember | null;
  fetchedAt: number;
}

export interface ValidationFailure {
  ok: false;
  code: string;
  message: string;
  hint: string;
}
export type ValidationResult = { ok: true } | ValidationFailure;

export interface ValidateTargetInput {
  discordGuildId: string;
  /** null → only check that the bot is in the guild (and the target exists / has members). */
  channelId: string | null;
  /** null → only check the bot and the channel. */
  target: MentionTarget | null;
}

const TEXT_TYPES = new Set<number>([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const THREAD_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

export function assertValid(result: ValidationResult): void {
  if (!result.ok) throw new ValidationFailedError(result.code, result.message, result.hint);
}

function fail(code: string, message: string, hint: string): ValidationFailure {
  return { ok: false, code, message, hint };
}

/**
 * Implements the "a mention must actually ping someone" rules (plan §6.1) against live Discord
 * data. Guild data is cached briefly so saving many mappings does not hammer the API.
 */
export class MentionValidator {
  private readonly guildCache = new Map<string, GuildData>();
  private readonly memberCache = new Map<
    string,
    { members: APIGuildMember[]; fetchedAt: number }
  >();
  private botUserPromise: Promise<APIUser> | null = null;

  constructor(
    private readonly discord: DiscordClient,
    private readonly opts: { cacheTtlMs?: number; clock?: Clock } = {},
  ) {}

  private nowMs(): number {
    return (this.opts.clock ?? (() => new Date()))().getTime();
  }

  private ttl(): number {
    return this.opts.cacheTtlMs ?? 60_000;
  }

  invalidate(discordGuildId?: string): void {
    if (discordGuildId) {
      this.guildCache.delete(discordGuildId);
      this.memberCache.delete(discordGuildId);
    } else {
      this.guildCache.clear();
      this.memberCache.clear();
    }
  }

  /** The bot's user, cached. `fresh` asks Discord again (health checks: is the token still valid?). */
  async botUser(opts: { fresh?: boolean } = {}): Promise<APIUser> {
    if (opts.fresh) this.botUserPromise = null;
    if (!this.botUserPromise) {
      this.botUserPromise = this.discord.getCurrentUser().catch((err) => {
        this.botUserPromise = null;
        throw err;
      });
    }
    return this.botUserPromise;
  }

  /** Throws ValidationFailedError(BOT_NOT_IN_GUILD) when the bot cannot access the guild. */
  async getGuildData(discordGuildId: string): Promise<GuildData> {
    const cached = this.guildCache.get(discordGuildId);
    if (cached && this.nowMs() - cached.fetchedAt < this.ttl()) return cached;
    const botUser = await this.botUser();
    let guild: APIGuild;
    try {
      guild = await this.discord.getGuild(discordGuildId);
    } catch (err) {
      if (DiscordRequestError.is(err) && (err.status === 403 || err.status === 404)) {
        throw new ValidationFailedError(
          'BOT_NOT_IN_GUILD',
          `The bot is not a member of Discord server ${discordGuildId}.`,
          'Invite the bot to the server with the OAuth2 URL from the Discord Developer Portal (scope "bot"), then try again.',
        );
      }
      throw err;
    }
    const [roles, channels, botMember] = await Promise.all([
      this.discord.getGuildRoles(discordGuildId),
      this.discord.getGuildChannels(discordGuildId),
      this.discord.getGuildMember(discordGuildId, botUser.id),
    ]);
    const data: GuildData = {
      guild,
      roles,
      channels: channels as unknown as ChannelLike[],
      botUser,
      botMember,
      fetchedAt: this.nowMs(),
    };
    this.guildCache.set(discordGuildId, data);
    return data;
  }

  /** Throws ValidationFailedError(MEMBERS_INTENT_DISABLED) when the privileged intent is off. */
  async getMembers(discordGuildId: string): Promise<APIGuildMember[]> {
    const cached = this.memberCache.get(discordGuildId);
    if (cached && this.nowMs() - cached.fetchedAt < this.ttl()) return cached.members;
    try {
      const members = await this.discord.listGuildMembers(discordGuildId);
      this.memberCache.set(discordGuildId, { members, fetchedAt: this.nowMs() });
      return members;
    } catch (err) {
      if (DiscordRequestError.is(err) && err.status === 403) {
        throw new ValidationFailedError(
          'MEMBERS_INTENT_DISABLED',
          'Discrello cannot list server members, so it cannot verify that a role would notify anyone.',
          'In the Discord Developer Portal open your application → Bot → Privileged Gateway Intents and enable "Server Members Intent", then try again.',
        );
      }
      throw err;
    }
  }

  /** Whether the Server Members Intent works for at least this guild. */
  async membersIntentEnabled(discordGuildId: string): Promise<boolean> {
    try {
      await this.getMembers(discordGuildId);
      return true;
    } catch (err) {
      if (
        err instanceof ValidationFailedError &&
        err.validationCode === 'MEMBERS_INTENT_DISABLED'
      ) {
        return false;
      }
      throw err;
    }
  }

  async botStatus(discordGuildId: string): Promise<{ status: BotStatus; error: string | null }> {
    try {
      const data = await this.getGuildData(discordGuildId);
      if (!data.botMember)
        return { status: 'not_in_guild', error: 'The bot is not a member of this server.' };
      return { status: 'ok', error: null };
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        return { status: 'not_in_guild', error: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'unchecked', error: message };
    }
  }

  private permissionsIn(
    data: GuildData,
    member: APIGuildMember,
    channel: ChannelLike | null,
  ): bigint {
    const overwriteSource =
      channel && THREAD_TYPES.has(channel.type)
        ? (data.channels.find((c) => c.id === channel.parent_id) ?? null)
        : channel;
    return computeChannelPermissions({
      guildId: data.guild.id,
      ownerId: data.guild.owner_id,
      roles: data.roles.map((r) => ({ id: r.id, permissions: r.permissions })),
      member: { userId: member.user.id, roleIds: member.roles },
      overwrites: overwriteSource?.permission_overwrites ?? [],
    });
  }

  async validate(input: ValidateTargetInput): Promise<ValidationResult> {
    try {
      return await this.validateInner(input);
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        return fail(err.validationCode, err.message, err.hint);
      }
      if (DiscordRequestError.is(err)) {
        return fail(
          'DISCORD_ERROR',
          `Discord request failed: ${err.message}`,
          'Check the bot token and Discord status, then try again.',
        );
      }
      throw err;
    }
  }

  private async validateInner(input: ValidateTargetInput): Promise<ValidationResult> {
    const data = await this.getGuildData(input.discordGuildId);
    const guildName = data.guild.name;
    if (!data.botMember) {
      return fail(
        'BOT_NOT_IN_GUILD',
        `The bot is not a member of ${guildName}.`,
        'Invite the bot to the server with the OAuth2 URL from the Discord Developer Portal (scope "bot"), then try again.',
      );
    }

    // 1–2. Channel + bot permissions
    let channel: ChannelLike | null = null;
    let channelLabel = '';
    if (input.channelId) {
      channel = data.channels.find((c) => c.id === input.channelId) ?? null;
      if (!channel) {
        return fail(
          'CHANNEL_NOT_FOUND',
          `Channel ${input.channelId} does not exist in ${guildName}.`,
          'Enable Developer Mode in Discord, right-click the channel and choose "Copy Channel ID". The channel must belong to this server.',
        );
      }
      channelLabel = `#${channel.name ?? channel.id}`;
      const isThread = THREAD_TYPES.has(channel.type);
      if (!TEXT_TYPES.has(channel.type) && !isThread) {
        return fail(
          'CHANNEL_WRONG_TYPE',
          `${channelLabel} is not a text channel.`,
          'Pick a text or announcement channel, or an open thread.',
        );
      }
      if (isThread && channel.thread_metadata?.archived) {
        return fail(
          'CHANNEL_ARCHIVED',
          `${channelLabel} is an archived thread.`,
          'Unarchive the thread or pick another channel.',
        );
      }
      const botPerms = this.permissionsIn(data, data.botMember, channel);
      if (!hasPermission(botPerms, PermissionFlagsBits.ViewChannel)) {
        return fail(
          'BOT_CANNOT_VIEW_CHANNEL',
          `The bot cannot see ${channelLabel}.`,
          'Grant the bot (or its role) "View Channel" in that channel\'s permission settings.',
        );
      }
      const sendFlag = isThread
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages;
      if (!hasPermission(botPerms, sendFlag)) {
        return fail(
          'BOT_CANNOT_SEND',
          `The bot cannot send messages in ${channelLabel}.`,
          `Grant the bot "${isThread ? 'Send Messages in Threads' : 'Send Messages'}" in that channel.`,
        );
      }
    }

    if (!input.target) return { ok: true };

    // 3. Role target
    if (input.target.kind === 'role') {
      const role = data.roles.find((r) => r.id === input.target!.id);
      if (!role) {
        return fail(
          'ROLE_NOT_FOUND',
          `Role ${input.target.id} does not exist in ${guildName}.`,
          'Server Settings → Roles → right-click the role → "Copy Role ID".',
        );
      }
      if (role.id === data.guild.id) {
        return fail(
          'ROLE_IS_EVERYONE',
          '@everyone cannot be used as a role target.',
          'Pick a specific role or a user.',
        );
      }
      const botPerms = this.permissionsIn(data, data.botMember, channel);
      const botMayMentionAnyRole = hasPermission(botPerms, PermissionFlagsBits.MentionEveryone);
      if (!role.mentionable && !botMayMentionAnyRole) {
        return fail(
          'ROLE_NOT_PINGABLE',
          `Role @${role.name} is not mentionable and the bot lacks "Mention @everyone, @here, and All Roles"${channelLabel ? ` in ${channelLabel}` : ''}.`,
          'Either enable "Allow anyone to @mention this role" on the role, or grant the bot that permission in the channel.',
        );
      }
      const members = await this.getMembers(input.discordGuildId);
      const holders = members.filter((m) => !m.user.bot && m.roles.includes(role.id));
      if (holders.length === 0) {
        return fail(
          'ROLE_HAS_NO_MEMBERS',
          `Role @${role.name} has no members, so a mention would notify nobody.`,
          'Assign the role to at least one person.',
        );
      }
      if (channel) {
        const seeing = holders.filter((m) =>
          hasPermission(this.permissionsIn(data, m, channel), PermissionFlagsBits.ViewChannel),
        );
        if (seeing.length === 0) {
          return fail(
            'ROLE_MEMBERS_CANNOT_SEE_CHANNEL',
            `No member of @${role.name} can see ${channelLabel}, so nobody would be notified.`,
            'Give the role access to the channel, or pick a channel its members can see.',
          );
        }
      }
      return { ok: true };
    }

    // 4. User target
    const member = await this.discord.getGuildMember(input.discordGuildId, input.target.id);
    if (!member) {
      return fail(
        'USER_NOT_IN_GUILD',
        `User ${input.target.id} is not a member of ${guildName}.`,
        'Enable Developer Mode in Discord, right-click the person → "Copy User ID". They must be a member of this server.',
      );
    }
    const display = member.nick ?? member.user.global_name ?? member.user.username;
    if (member.user.bot) {
      return fail(
        'USER_IS_BOT',
        `${display} is a bot; bots do not receive mention notifications.`,
        'Pick a human member.',
      );
    }
    if (channel) {
      const perms = this.permissionsIn(data, member, channel);
      if (!hasPermission(perms, PermissionFlagsBits.ViewChannel)) {
        return fail(
          'USER_CANNOT_SEE_CHANNEL',
          `${display} cannot see ${channelLabel}, so they would not be notified.`,
          'Give them access to the channel, or pick a channel they can see.',
        );
      }
    }
    return { ok: true };
  }
}

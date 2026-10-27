import {
  ChannelType,
  PermissionFlagsBits,
  type GuildMemberFlags,
  type RoleFlags,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type APIUser,
} from 'discord-api-types/v10';
import { computeChannelPermissions, hasPermission, type PermissionOverwrite } from './permissions';
import {
  DiscordRequestError,
  truncateContent,
  type BotGuild,
  type DiscordClient,
  type SendMessageInput,
} from './client';

export interface FakeRole {
  id: string;
  name: string;
  permissions: bigint;
  mentionable?: boolean;
  managed?: boolean;
}
export interface FakeChannel {
  id: string;
  name: string;
  type?: ChannelType;
  parentId?: string | null;
  overwrites?: PermissionOverwrite[];
  archived?: boolean;
}
export interface FakeMember {
  userId: string;
  username?: string;
  roleIds: string[];
  bot?: boolean;
}
export interface FakeGuild {
  id: string;
  name: string;
  ownerId: string;
  everyonePermissions?: bigint;
  roles: FakeRole[];
  channels: FakeChannel[];
  members: FakeMember[];
}

export interface SentMessage {
  channelId: string;
  content: string;
  allowedMentions: SendMessageInput['allowedMentions'];
  messageId: string;
}

/**
 * In-memory Discord used by the tests. It enforces the same rules as the real thing where they
 * matter to us: channel/permission checks on send, member-intent gating, and the fact that a role
 * only ends up in `mention_roles` when it is mentionable or the bot may mention everyone.
 */
export class FakeDiscordClient implements DiscordClient {
  readonly botUser: APIUser = {
    id: '999000000000000000',
    username: 'discrello',
    discriminator: '0',
    global_name: 'Discrello',
    avatar: null,
    bot: true,
  };
  readonly guilds = new Map<string, FakeGuild>();
  membersIntentEnabled = true;
  readonly sent: SentMessage[] = [];
  /** Queue of errors thrown by the next sends (null = succeed). */
  sendFailures: Array<DiscordRequestError | null> = [];
  private messageSeq = 1;

  addGuild(guild: FakeGuild): FakeGuild {
    this.guilds.set(guild.id, guild);
    return guild;
  }

  private guild(guildId: string): FakeGuild {
    const g = this.guilds.get(guildId);
    if (!g) throw new DiscordRequestError(404, 10004, 'Fetching the server: Unknown server', false);
    return g;
  }

  async getCurrentUser(): Promise<APIUser> {
    return this.botUser;
  }

  async getCurrentUserGuilds(): Promise<BotGuild[]> {
    return [...this.guilds.values()]
      .filter((g) => g.members.some((m) => m.userId === this.botUser.id))
      .map((g) => ({ id: g.id, name: g.name }));
  }

  async getGuild(guildId: string): Promise<APIGuild> {
    const g = this.guild(guildId);
    if (!g.members.some((m) => m.userId === this.botUser.id)) {
      throw new DiscordRequestError(403, 50001, 'Fetching the server: Missing access', false);
    }
    return { id: g.id, name: g.name, owner_id: g.ownerId } as APIGuild;
  }

  async getGuildRoles(guildId: string): Promise<APIRole[]> {
    const g = this.guild(guildId);
    const everyone = {
      id: g.id,
      name: '@everyone',
      permissions: (
        g.everyonePermissions ?? PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages
      ).toString(),
      mentionable: false,
      managed: false,
      color: 0,
      hoist: false,
      position: 0,
      flags: 0 as RoleFlags,
    } as unknown as APIRole;
    return [
      everyone,
      ...g.roles.map(
        (r, i) =>
          ({
            id: r.id,
            name: r.name,
            permissions: r.permissions.toString(),
            mentionable: r.mentionable ?? false,
            managed: r.managed ?? false,
            color: 0,
            hoist: false,
            position: i + 1,
            flags: 0 as RoleFlags,
          }) as unknown as APIRole,
      ),
    ];
  }

  async getGuildChannels(guildId: string): Promise<APIChannel[]> {
    const g = this.guild(guildId);
    return g.channels.map(
      (c) =>
        ({
          id: c.id,
          name: c.name,
          type: c.type ?? ChannelType.GuildText,
          guild_id: g.id,
          parent_id: c.parentId ?? null,
          permission_overwrites: (c.overwrites ?? []).map((o) => ({ ...o })),
          thread_metadata:
            c.type && [10, 11, 12].includes(c.type) ? { archived: c.archived ?? false } : undefined,
        }) as unknown as APIChannel,
    );
  }

  private toApiMember(m: FakeMember): APIGuildMember {
    return {
      user: {
        id: m.userId,
        username: m.username ?? `user_${m.userId}`,
        discriminator: '0',
        global_name: null,
        avatar: null,
        bot: m.bot ?? false,
      },
      roles: m.roleIds,
      joined_at: '2026-01-01T00:00:00.000Z',
      deaf: false,
      mute: false,
      flags: 0 as GuildMemberFlags,
    };
  }

  async getGuildMember(guildId: string, userId: string): Promise<APIGuildMember | null> {
    const g = this.guild(guildId);
    const m = g.members.find((x) => x.userId === userId);
    return m ? this.toApiMember(m) : null;
  }

  async listGuildMembers(guildId: string): Promise<APIGuildMember[]> {
    const g = this.guild(guildId);
    if (!this.membersIntentEnabled) {
      throw new DiscordRequestError(403, 50001, 'Listing server members: Missing access', false);
    }
    return g.members.map((m) => this.toApiMember(m));
  }

  /** Effective permissions of a member in a channel, using the same algorithm as the server. */
  permissionsIn(guildId: string, channelId: string, userId: string): bigint {
    const g = this.guild(guildId);
    const channel = g.channels.find((c) => c.id === channelId);
    if (!channel) return 0n;
    const member = g.members.find((m) => m.userId === userId);
    if (!member) return 0n;
    const overwriteSource =
      channel.parentId && [10, 11, 12].includes(channel.type ?? 0)
        ? g.channels.find((c) => c.id === channel.parentId)
        : channel;
    const everyonePerms =
      g.everyonePermissions ?? PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
    return computeChannelPermissions({
      guildId: g.id,
      ownerId: g.ownerId,
      roles: [
        { id: g.id, permissions: everyonePerms.toString() },
        ...g.roles.map((r) => ({ id: r.id, permissions: r.permissions.toString() })),
      ],
      member: { userId: member.userId, roleIds: member.roleIds },
      overwrites: overwriteSource?.overwrites ?? [],
    });
  }

  private findChannel(channelId: string): { guild: FakeGuild; channel: FakeChannel } | null {
    for (const g of this.guilds.values()) {
      const channel = g.channels.find((c) => c.id === channelId);
      if (channel) return { guild: g, channel };
    }
    return null;
  }

  async sendMessage(channelId: string, input: SendMessageInput): Promise<APIMessage> {
    const queued = this.sendFailures.shift();
    if (queued) throw queued;

    const found = this.findChannel(channelId);
    if (!found) {
      throw new DiscordRequestError(
        404,
        10003,
        'Sending the Discord message: Unknown channel',
        false,
      );
    }
    const { guild, channel } = found;
    const botPerms = this.permissionsIn(guild.id, channel.id, this.botUser.id);
    if (!hasPermission(botPerms, PermissionFlagsBits.ViewChannel)) {
      throw new DiscordRequestError(
        403,
        50001,
        'Sending the Discord message: Missing access',
        false,
      );
    }
    if (!hasPermission(botPerms, PermissionFlagsBits.SendMessages)) {
      throw new DiscordRequestError(
        403,
        50013,
        'Sending the Discord message: Missing permissions',
        false,
      );
    }

    const content = truncateContent(input.content);
    const messageId = `${700000000000000000n + BigInt(this.messageSeq++)}`;
    const mentionedUsers = (input.allowedMentions.users ?? [])
      .filter((id) => content.includes(`<@${id}>`))
      .map((id) => guild.members.find((m) => m.userId === id))
      .filter((m): m is FakeMember => Boolean(m));
    const canMentionAnyRole = hasPermission(botPerms, PermissionFlagsBits.MentionEveryone);
    const mentionedRoles = (input.allowedMentions.roles ?? []).filter((id) => {
      if (!content.includes(`<@&${id}>`)) return false;
      const role = guild.roles.find((r) => r.id === id);
      return Boolean(role) && (canMentionAnyRole || role!.mentionable === true);
    });

    this.sent.push({ channelId, content, allowedMentions: input.allowedMentions, messageId });
    return {
      id: messageId,
      channel_id: channelId,
      content,
      mentions: mentionedUsers.map((m) => this.toApiMember(m).user),
      mention_roles: mentionedRoles,
      mention_everyone: false,
    } as unknown as APIMessage;
  }
}

import {
  DiscordAPIError,
  HTTPError,
  RateLimitError,
  REST,
  type RESTOptions,
} from '@discordjs/rest';
import {
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type APIUser,
  type RESTGetAPICurrentUserGuildsResult,
  type RESTGetAPIGuildMembersResult,
  type RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v10';
import { DISCORD_CONTENT_LIMIT, type AllowedMentions } from '@discrello/shared';

export interface SendMessageInput {
  content: string;
  allowedMentions: AllowedMentions;
}

export interface BotGuild {
  id: string;
  name: string;
}

/** The subset of Discord's REST API that Discrello uses. Implemented by the real client and a fake. */
export interface DiscordClient {
  getCurrentUser(): Promise<APIUser>;
  getCurrentUserGuilds(): Promise<BotGuild[]>;
  getGuild(guildId: string): Promise<APIGuild>;
  getGuildRoles(guildId: string): Promise<APIRole[]>;
  getGuildChannels(guildId: string): Promise<APIChannel[]>;
  /** Resolves to null when the user is not a member (404). */
  getGuildMember(guildId: string, userId: string): Promise<APIGuildMember | null>;
  /** Requires the Server Members privileged intent; throws DiscordRequestError(403) otherwise. */
  listGuildMembers(guildId: string): Promise<APIGuildMember[]>;
  sendMessage(channelId: string, input: SendMessageInput): Promise<APIMessage>;
}

const KNOWN_CODES: Record<number, string> = {
  10003: 'Unknown channel',
  10004: 'Unknown server',
  10007: 'Unknown member',
  10011: 'Unknown role',
  10013: 'Unknown user',
  50001: 'Missing access (the bot cannot see this channel)',
  50013: 'Missing permissions',
  50035: 'Invalid request body',
  40001: 'Unauthorized (invalid bot token)',
  40002: 'Bot account not verified',
};

export class DiscordRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DiscordRequestError';
  }

  static is(err: unknown): err is DiscordRequestError {
    return err instanceof DiscordRequestError;
  }
}

export const BOT_TOKEN_REJECTED =
  'Discord rejected the bot token (HTTP 401). Put a valid token in DISCORD_BOT_TOKEN ' +
  '(Developer Portal → your application → Bot → Reset Token) and restart Discrello.';

/** @discordjs/rest throws this after it wiped the token in reaction to an earlier 401. */
const TOKEN_WIPED = /Expected token to be set for this request/;

export function toDiscordError(err: unknown, context: string): DiscordRequestError {
  if (err instanceof DiscordRequestError) return err;
  if (err instanceof DiscordAPIError && err.status === 401) {
    const code = typeof err.code === 'number' ? err.code : null;
    return new DiscordRequestError(401, code, `${context}: ${BOT_TOKEN_REJECTED}`, false);
  }
  if (err instanceof Error && TOKEN_WIPED.test(err.message)) {
    return new DiscordRequestError(401, null, `${context}: ${BOT_TOKEN_REJECTED}`, false);
  }
  if (err instanceof DiscordAPIError) {
    const code = typeof err.code === 'number' ? err.code : null;
    const label = code !== null && KNOWN_CODES[code] ? KNOWN_CODES[code] : err.message;
    return new DiscordRequestError(
      err.status,
      code,
      `${context}: ${label} (HTTP ${err.status}${code !== null ? `, code ${code}` : ''})`,
      err.status >= 500,
    );
  }
  if (err instanceof RateLimitError) {
    return new DiscordRequestError(429, null, `${context}: rate limited by Discord`, true);
  }
  if (err instanceof HTTPError) {
    return new DiscordRequestError(
      err.status,
      null,
      `${context}: HTTP ${err.status}`,
      err.status >= 500,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new DiscordRequestError(0, null, `${context}: ${message}`, true);
}

export class RestDiscordClient implements DiscordClient {
  private readonly rest: REST;

  /** `restOptions` lets tests inject `makeRequest`; production uses the defaults. */
  constructor(
    private readonly botToken: string,
    restOptions: Partial<RESTOptions> = {},
  ) {
    this.rest = new REST({ version: '10', retries: 2, ...restOptions });
  }

  private async call<T>(context: string, fn: () => Promise<unknown>): Promise<T> {
    // @discordjs/rest permanently clears its token after any 401 response, after which every
    // request fails with a misleading "Expected token to be set" until a restart. Re-arm it on
    // every call so a fixed or transient problem recovers, and a bad token keeps reporting 401.
    this.rest.setToken(this.botToken);
    try {
      return (await fn()) as T;
    } catch (err) {
      throw toDiscordError(err, context);
    }
  }

  getCurrentUser(): Promise<APIUser> {
    return this.call('Fetching the bot user', () => this.rest.get(Routes.user('@me')));
  }

  async getCurrentUserGuilds(): Promise<BotGuild[]> {
    const guilds = await this.call<RESTGetAPICurrentUserGuildsResult>(
      'Listing the servers the bot is in',
      () => this.rest.get(Routes.userGuilds(), { query: new URLSearchParams({ limit: '200' }) }),
    );
    return guilds.map((g) => ({ id: g.id, name: g.name }));
  }

  getGuild(guildId: string): Promise<APIGuild> {
    return this.call('Fetching the server', () => this.rest.get(Routes.guild(guildId)));
  }

  getGuildRoles(guildId: string): Promise<APIRole[]> {
    return this.call('Fetching server roles', () => this.rest.get(Routes.guildRoles(guildId)));
  }

  getGuildChannels(guildId: string): Promise<APIChannel[]> {
    return this.call('Fetching server channels', () =>
      this.rest.get(Routes.guildChannels(guildId)),
    );
  }

  async getGuildMember(guildId: string, userId: string): Promise<APIGuildMember | null> {
    try {
      return await this.call<APIGuildMember>('Fetching the server member', () =>
        this.rest.get(Routes.guildMember(guildId, userId)),
      );
    } catch (err) {
      if (DiscordRequestError.is(err) && err.status === 404) return null;
      throw err;
    }
  }

  async listGuildMembers(guildId: string): Promise<APIGuildMember[]> {
    const all: APIGuildMember[] = [];
    let after = '0';
    for (let page = 0; page < 50; page += 1) {
      const batch = await this.call<RESTGetAPIGuildMembersResult>('Listing server members', () =>
        this.rest.get(Routes.guildMembers(guildId), {
          query: new URLSearchParams({ limit: '1000', after }),
        }),
      );
      all.push(...batch);
      if (batch.length < 1000) break;
      const last = batch[batch.length - 1];
      if (!last?.user) break;
      after = last.user.id;
    }
    return all;
  }

  sendMessage(channelId: string, input: SendMessageInput): Promise<APIMessage> {
    const body: RESTPostAPIChannelMessageJSONBody = {
      content: truncateContent(input.content),
      allowed_mentions: input.allowedMentions,
    };
    return this.call('Sending the Discord message', () =>
      this.rest.post(Routes.channelMessages(channelId), { body }),
    );
  }
}

export function truncateContent(content: string): string {
  if (content.length <= DISCORD_CONTENT_LIMIT) return content;
  return `${content.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`;
}

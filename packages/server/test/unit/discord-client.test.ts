import { describe, expect, it } from 'vitest';
import { DiscordAPIError } from '@discordjs/rest';
import {
  BOT_TOKEN_REJECTED,
  DiscordRequestError,
  RestDiscordClient,
  toDiscordError,
} from '../../src/discord/client';

/** A fake Discord HTTP endpoint for @discordjs/rest's `makeRequest` hook. */
function fakeDiscord(responses: Array<{ status: number; body: unknown }>) {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const makeRequest = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    seen.push({ url, authorization: headers.get('authorization') });
    const next = responses.shift() ?? { status: 500, body: { message: 'no more responses' } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { makeRequest, seen };
}

describe('toDiscordError', () => {
  it('turns a 401 into an actionable, non-retryable bot-token error', () => {
    const err = new DiscordAPIError(
      { message: '401: Unauthorized', code: 0 },
      0,
      401,
      'GET',
      '/guilds/1',
      {},
    );
    const mapped = toDiscordError(err, 'Fetching the server');
    expect(mapped).toBeInstanceOf(DiscordRequestError);
    expect(mapped.status).toBe(401);
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe(`Fetching the server: ${BOT_TOKEN_REJECTED}`);
  });

  it('maps the library\'s "token was wiped" error to the same message', () => {
    const mapped = toDiscordError(
      new Error('Expected token to be set for this request, but none was present'),
      'Fetching the server',
    );
    expect(mapped.status).toBe(401);
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toContain('Discord rejected the bot token');
  });

  it('keeps other errors as they were', () => {
    const err = new DiscordAPIError(
      { message: 'Missing Access', code: 50001 },
      50001,
      403,
      'GET',
      '/guilds/1',
      {},
    );
    expect(toDiscordError(err, 'Fetching the server').message).toBe(
      'Fetching the server: Missing access (the bot cannot see this channel) (HTTP 403, code 50001)',
    );
  });
});

describe('RestDiscordClient', () => {
  it('keeps sending its token after a 401 instead of failing with "Expected token to be set"', async () => {
    const { makeRequest, seen } = fakeDiscord([
      {
        status: 200,
        body: { id: '1', username: 'bot', discriminator: '0', avatar: null, global_name: null },
      },
      { status: 401, body: { message: '401: Unauthorized', code: 0 } },
      { status: 401, body: { message: '401: Unauthorized', code: 0 } },
      { status: 200, body: { id: '100000000000000000', name: 'Server', owner_id: '2' } },
    ]);
    const client = new RestDiscordClient('the-token', { makeRequest });

    expect((await client.getCurrentUser()).username).toBe('bot');
    // Token rejected (e.g. reset in the Developer Portal): a clear message, every time.
    await expect(client.getGuild('100000000000000000')).rejects.toThrow(BOT_TOKEN_REJECTED);
    await expect(client.getGuildMember('100000000000000000', '5')).rejects.toThrow(
      BOT_TOKEN_REJECTED,
    );
    // Discord accepts it again: the client recovers without a restart.
    expect((await client.getGuild('100000000000000000')).name).toBe('Server');

    expect(seen).toHaveLength(4);
    expect(seen.every((r) => r.authorization === 'Bot the-token')).toBe(true);
  });

  it('returns null for a member that is not in the server', async () => {
    const { makeRequest } = fakeDiscord([
      { status: 404, body: { message: 'Unknown Member', code: 10007 } },
    ]);
    const client = new RestDiscordClient('the-token', { makeRequest });
    expect(await client.getGuildMember('100000000000000000', '5')).toBeNull();
  });
});

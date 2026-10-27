import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BoardDetailDto, GuildDto, RoleDto } from '@discrello/shared';
import { boards, listMappings, notifications, roleTargets } from '../../src/db/schema';
import { trelloFixtureBody } from '../helpers/fixtures';
import {
  IDS,
  TRELLO,
  makeTestContext,
  postWebhook,
  seedFakeDiscord,
  type TestContext,
} from '../helpers/app';

let ctx: TestContext;
let cookie = '';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
async function api(method: Method, url: string, payload?: unknown) {
  const res = await ctx.app.fastify.inject({
    method,
    url,
    headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  return res;
}

async function login(password = 'correct-horse-battery') {
  const res = await ctx.app.fastify.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ password }),
  });
  // Use the raw Set-Cookie header (URL-encoded value), exactly as a browser would send it back.
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  cookie = first && first.startsWith('discrello_session=') ? first.split(';')[0]! : '';
  return res;
}

function seedTrello() {
  ctx.trello.addBoard(
    {
      id: TRELLO.boardId,
      name: 'SPORTS',
      url: `https://trello.com/b/${TRELLO.shortLink}/sports`,
      shortLink: TRELLO.shortLink,
      closed: false,
    },
    [
      { id: TRELLO.list1, name: 'Script Writer Ready', pos: 1, closed: false },
      { id: TRELLO.list2, name: 'NFL editor ready', pos: 2, closed: false },
    ],
  );
}

async function addGuild(): Promise<GuildDto> {
  const res = await api('POST', '/api/guilds', {
    discordGuildId: IDS.guild,
    alertChannelId: IDS.alertChannel,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function addRole(key = 'editor'): Promise<RoleDto> {
  const res = await api('POST', '/api/roles', {
    key,
    displayName: 'Editor',
    defaultTemplate: '{mention} — {card_title} is ready for editing',
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function addBoard(guildId: number, channelId = IDS.channel): Promise<BoardDetailDto> {
  const res = await api('POST', '/api/boards', {
    ref: `https://trello.com/b/${TRELLO.shortLink}/sports`,
    guildId,
    discordChannelId: channelId,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

beforeEach(async () => {
  ctx = await makeTestContext();
  seedFakeDiscord(ctx.discord);
  seedTrello();
  cookie = '';
});

afterEach(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('protects the API behind the admin password', async () => {
    expect((await api('GET', '/api/roles')).statusCode).toBe(401);
    expect((await api('GET', '/api/health')).statusCode).toBe(200);
    expect((await login('wrong-password-here')).statusCode).toBe(401);
    expect(cookie).toBe('');
    expect((await login()).statusCode).toBe(200);
    expect(cookie).not.toBe('');
    expect((await api('GET', '/api/roles')).statusCode).toBe(200);
    expect((await api('GET', '/api/auth/me')).json()).toEqual({ authenticated: true });
    await api('POST', '/api/auth/logout');
    // the logout response clears the cookie; simulate the browser dropping it
    cookie = '';
    expect((await api('GET', '/api/roles')).statusCode).toBe(401);
  });

  it('rejects malformed bodies with 400', async () => {
    await login();
    const res = await api('POST', '/api/roles', { key: 'Bad Key!', displayName: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });

  it('rate-limits login by the IP nginx saw, not by a client-supplied X-Forwarded-For', async () => {
    // nginx appends the real client address; anything before it was sent by the client.
    const attempt = (spoofed: string) =>
      ctx.app.fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `${spoofed}, 203.0.113.5`,
        },
        payload: JSON.stringify({ password: 'wrong-password-here' }),
      });
    const codes: number[] = [];
    for (let i = 1; i <= 11; i += 1) codes.push((await attempt(`10.0.0.${i}`)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('guilds', () => {
  beforeEach(() => login());

  it('adds a server the bot is in, lists channels and roles, and rejects duplicates', async () => {
    const guild = await addGuild();
    expect(guild).toMatchObject({
      discordGuildId: IDS.guild,
      name: 'Sports Team',
      botStatus: 'ok',
      boardCount: 0,
    });
    expect((await api('POST', '/api/guilds', { discordGuildId: IDS.guild })).statusCode).toBe(409);

    const botGuilds = await api('GET', '/api/discord/bot-guilds');
    expect(botGuilds.json()).toEqual(
      expect.arrayContaining([
        { id: IDS.guild, name: 'Sports Team', alreadyAdded: true },
        { id: IDS.otherGuild, name: 'Other Team', alreadyAdded: false },
      ]),
    );
    const channels = (await api('GET', `/api/guilds/${guild.id}/channels`)).json();
    expect(channels.map((c: { name: string }) => c.name)).toEqual([
      'general',
      'discrello-alerts',
      'private',
    ]);
    const roles = (await api('GET', `/api/guilds/${guild.id}/roles`)).json();
    expect(roles.find((r: { id: string }) => r.id === IDS.quietRole)).toMatchObject({
      name: 'Quiet',
      mentionable: false,
    });
    expect(roles.some((r: { id: string }) => r.id === IDS.guild)).toBe(false);
  });

  it('refuses a server the bot is not in and an alert channel the bot cannot use', async () => {
    const res = await api('POST', '/api/guilds', { discordGuildId: '123456789012345678' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'validation_failed', code: 'BOT_NOT_IN_GUILD' });
    const bad = await api('POST', '/api/guilds', {
      discordGuildId: IDS.guild,
      alertChannelId: '123456789012345678',
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('CHANNEL_NOT_FOUND');
    expect((await api('GET', '/api/guilds')).json()).toEqual([]);
  });

  it('re-checks the bot status and blocks deletion while boards exist', async () => {
    const guild = await addGuild();
    await addBoard(guild.id);
    expect((await api('DELETE', `/api/guilds/${guild.id}`)).statusCode).toBe(409);
    const g = ctx.discord.guilds.get(IDS.guild)!;
    g.members = g.members.filter((m) => m.userId !== IDS.botUser);
    const checked = await api('POST', `/api/guilds/${guild.id}/check`);
    expect(checked.json()).toMatchObject({ botStatus: 'not_in_guild' });
  });
});

describe('roles and targets', () => {
  let guild: GuildDto;
  beforeEach(async () => {
    await login();
    guild = await addGuild();
  });

  it('blocks saving a target that would not ping anyone, and saves a working one', async () => {
    const role = await addRole();
    const bad = await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'role',
      id: IDS.quietRole,
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ error: 'validation_failed', code: 'ROLE_NOT_PINGABLE' });
    expect(bad.json().hint).toContain('Allow anyone to @mention this role');
    expect(await ctx.db.select().from(roleTargets)).toHaveLength(0);

    const empty = await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'role',
      id: IDS.emptyRole,
    });
    expect(empty.json().code).toBe('ROLE_HAS_NO_MEMBERS');

    const good = await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().targets).toEqual([
      expect.objectContaining({
        guildId: guild.id,
        mentionKind: 'user',
        mentionId: IDS.editorUser,
        checkStatus: 'ok',
      }),
    ]);
    expect((await api('GET', '/api/roles')).json()[0].targets).toHaveLength(1);
  });

  it('validates a target against the channels of the boards that use the role', async () => {
    const role = await addRole();
    const board = await addBoard(guild.id, IDS.privateChannel);
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    const mapping = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title}',
    });
    expect(mapping.statusCode).toBe(200);
    // outsider cannot see #private, where this role is now used
    const res = await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.outsiderUser,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('USER_CANNOT_SEE_CHANNEL');
  });

  it('sends a real test ping and reports the verification', async () => {
    const role = await addRole();
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    const res = await api('POST', `/api/roles/${role.id}/targets/${guild.id}/test`, {
      channelId: IDS.channel,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mentionVerified: true });
    expect(ctx.discord.sent[0]!.content).toContain(
      `<@${IDS.editorUser}> — Example card is ready for editing`,
    );
    const noTarget = await api('POST', `/api/roles/${role.id}/targets/999/test`, {
      channelId: IDS.channel,
    });
    expect(noTarget.statusCode).toBe(404);
  });

  it('removing a target flags the mappings that relied on it', async () => {
    const role = await addRole();
    const board = await addBoard(guild.id);
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} x',
    });
    await api('DELETE', `/api/roles/${role.id}/targets/${guild.id}`);
    const detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({ checkStatus: 'error' });
    expect(detail.mappings[0]!.checkError).toContain('no Discord target');
    expect((await api('DELETE', `/api/roles/${role.id}`)).statusCode).toBe(409);
  });
});

describe('boards and mappings', () => {
  let guild: GuildDto;
  let role: RoleDto;
  beforeEach(async () => {
    await login();
    guild = await addGuild();
    role = await addRole();
  });

  it('previews, adds (registering the Trello webhook), and refuses duplicates or foreign channels', async () => {
    const preview = await api('POST', '/api/trello/boards/preview', { ref: TRELLO.shortLink });
    expect(preview.json()).toMatchObject({ name: 'SPORTS', alreadyAdded: false });
    expect(preview.json().lists).toHaveLength(2);

    const wrongGuild = await api('POST', '/api/boards', {
      ref: TRELLO.shortLink,
      guildId: guild.id,
      discordChannelId: IDS.otherChannel,
    });
    expect(wrongGuild.statusCode).toBe(422);
    expect(wrongGuild.json().code).toBe('CHANNEL_NOT_FOUND');

    const board = await addBoard(guild.id);
    expect(board).toMatchObject({
      name: 'SPORTS',
      guildName: 'Sports Team',
      webhookStatus: 'active',
      mappingCount: 0,
    });
    expect(board.lists.map((l) => l.name)).toEqual(['Script Writer Ready', 'NFL editor ready']);
    const [wh] = [...ctx.trello.webhooks.values()];
    expect(wh!.callbackURL).toBe(board.webhookCallbackUrl);
    expect(wh!.callbackURL).toMatch(/^https:\/\/example\.test\/webhooks\/trello\/[0-9a-f]{32}$/);
    expect(wh!.idModel).toBe(TRELLO.boardId);

    expect(
      (
        await api('POST', '/api/boards', {
          ref: TRELLO.shortLink,
          guildId: guild.id,
          discordChannelId: IDS.channel,
        })
      ).statusCode,
    ).toBe(409);
    const badRef = await api('POST', '/api/trello/boards/preview', { ref: 'not a board' });
    expect(badRef.statusCode).toBe(400);
    expect(badRef.json().message).toContain('Trello board URL');
  });

  it('refuses a mapping whose role has no target here, then accepts it once a target exists', async () => {
    const board = await addBoard(guild.id);
    const res = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('ROLE_HAS_NO_TARGET');
    expect(await ctx.db.select().from(listMappings)).toHaveLength(0);

    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    const ok = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      roleKey: 'editor',
      checkStatus: 'ok',
      overrideMention: null,
      commentTemplate: null,
      enabled: true,
    });

    // a per-list comment template is stored, and omitting it goes back to the global default
    const withComment = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
      commentTemplate: '  {mention} — fix {card_title}: {comment_text}  ',
    });
    expect(withComment.json().commentTemplate).toBe('{mention} — fix {card_title}: {comment_text}');
    const stored: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(stored.mappings[0]!.commentTemplate).toBe(
      '{mention} — fix {card_title}: {comment_text}',
    );
    const cleared = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
    });
    expect(cleared.json().commentTemplate).toBeNull();

    // an override that cannot see the override channel is refused
    const badOverride = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} x',
      overrideMention: { kind: 'user', id: IDS.outsiderUser },
      overrideChannelId: IDS.privateChannel,
    });
    expect(badOverride.statusCode).toBe(422);
    expect(badOverride.json().code).toBe('USER_CANNOT_SEE_CHANNEL');
    // and the previous mapping is untouched
    const detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]!.overrideMention).toBeNull();

    expect(
      (
        await api('PUT', `/api/boards/${board.id}/mappings/64a0000000000000000000ff`, {
          roleId: role.id,
          messageTemplate: 'x',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api('DELETE', `/api/boards/${board.id}/mappings/${TRELLO.list2}`)).statusCode,
    ).toBe(204);
    expect(
      (await api('DELETE', `/api/boards/${board.id}/mappings/${TRELLO.list2}`)).statusCode,
    ).toBe(404);
  });

  it('re-validates every inherited mapping when the board channel changes', async () => {
    const board = await addBoard(guild.id);
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.outsiderUser,
    });
    await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} x',
    });
    const res = await api('PATCH', `/api/boards/${board.id}`, {
      discordChannelId: IDS.privateChannel,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain('NFL editor ready');
    expect(res.json().code).toBe('USER_CANNOT_SEE_CHANNEL');
    const unchanged = await ctx.db.select().from(boards);
    expect(unchanged[0]!.discordChannelId).toBe(IDS.channel);
    expect(
      (await api('PATCH', `/api/boards/${board.id}`, { enabled: false })).json(),
    ).toMatchObject({ enabled: false });
  });

  it('delivers a real ping end to end after configuring through the API', async () => {
    const board = await addBoard(guild.id);
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'role',
      id: IDS.editorsRole,
    });
    await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
    });
    const [row] = await ctx.db.select().from(boards);
    const res = await postWebhook(ctx.app, trelloFixtureBody('updateCard-move'), {
      token: row!.webhookToken,
    });
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });
    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent[0]).toMatchObject({
      channelId: IDS.channel,
      content: `<@&${IDS.editorsRole}> — NFL Week 3 recap is ready for editing`,
      allowedMentions: { parse: [], roles: [IDS.editorsRole] },
    });
    const list = await api('GET', '/api/notifications');
    expect(list.json().items[0]).toMatchObject({
      status: 'sent',
      mentionVerified: true,
      roleKey: 'editor',
      boardName: 'SPORTS',
    });
    const events = await api('GET', '/api/webhook-events');
    expect(events.json().items[0]).toMatchObject({ outcome: 'enqueued', actionType: 'updateCard' });
    const test = await api('POST', `/api/boards/${board.id}/mappings/${TRELLO.list2}/test`);
    expect(test.json()).toMatchObject({ ok: true, mentionVerified: true });
  });

  it('repairs the Trello webhook when it was disabled, deleted or points elsewhere', async () => {
    const board = await addBoard(guild.id);
    const wh = [...ctx.trello.webhooks.values()][0]!;
    wh.active = false;
    wh.consecutiveFailures = 7;
    let detail: BoardDetailDto = (
      await api('POST', `/api/boards/${board.id}/webhook/check`)
    ).json();
    expect(detail.webhookStatus).toBe('active');
    expect(wh.active).toBe(true);

    wh.callbackURL = 'https://old.example/webhooks/trello/x';
    detail = (await api('POST', `/api/boards/${board.id}/webhook/check`)).json();
    expect(detail.webhookStatus).toBe('active');
    expect([...ctx.trello.webhooks.values()][0]!.callbackURL).toBe(board.webhookCallbackUrl);

    ctx.trello.webhooks.clear();
    detail = (await api('POST', `/api/boards/${board.id}/webhook/check`)).json();
    expect(detail.webhookStatus).toBe('active');
    expect(ctx.trello.webhooks.size).toBe(1);

    expect((await api('DELETE', `/api/boards/${board.id}`)).statusCode).toBe(204);
    expect(ctx.trello.webhooks.size).toBe(0);
  });

  it('explains Trello access problems instead of passing on a bare 401/404', async () => {
    ctx.trello.privateBoards.add('PrIvAtE1');
    const noAccess = await api('POST', '/api/trello/boards/preview', {
      ref: 'https://trello.com/b/PrIvAtE1/sports',
    });
    expect(noAccess.statusCode).toBe(422);
    expect(noAccess.json()).toMatchObject({
      error: 'validation_failed',
      code: 'TRELLO_BOARD_NO_ACCESS',
    });
    // names the account to invite, so the admin knows exactly what to do
    expect(noAccess.json().message).toContain('"jane" (Jane Doe)');
    expect(noAccess.json().hint).toContain('Share');

    const addNoAccess = await api('POST', '/api/boards', {
      ref: 'PrIvAtE1',
      guildId: guild.id,
      discordChannelId: IDS.channel,
    });
    expect(addNoAccess.statusCode).toBe(422);
    expect(addNoAccess.json().code).toBe('TRELLO_BOARD_NO_ACCESS');

    const missing = await api('POST', '/api/trello/boards/preview', { ref: 'NoSuChBd' });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe('TRELLO_BOARD_NOT_FOUND');
  });

  it('syncs lists and flags the ones that disappeared', async () => {
    const board = await addBoard(guild.id);
    const fakeBoard = ctx.trello.boards.get(TRELLO.boardId)!;
    fakeBoard.lists = [
      { id: TRELLO.list1, name: 'Script Writer Ready (renamed)', pos: 1, closed: true },
      { id: '64a00000000000000000a003', name: 'ready to upload', pos: 3, closed: false },
    ];
    const detail: BoardDetailDto = (await api('POST', `/api/boards/${board.id}/sync-lists`)).json();
    expect(detail.lists).toEqual([
      expect.objectContaining({
        trelloListId: TRELLO.list1,
        name: 'Script Writer Ready (renamed)',
        closed: true,
        missing: false,
      }),
      expect.objectContaining({ trelloListId: TRELLO.list2, missing: true }),
      expect.objectContaining({
        trelloListId: '64a00000000000000000a003',
        name: 'ready to upload',
      }),
    ]);
  });

  it('handles production-sized boards (hundreds of lists with repeated names)', async () => {
    // Like the real QC board: sections that each repeat "Script Writer Ready", "SW QC STEP", …
    const stages = [
      'Script Writer Ready',
      'SW QC STEP',
      'editor ready',
      'QC STEP',
      'ready to upload',
    ];
    const bigLists = Array.from({ length: 300 }, (_, i) => ({
      id: `7b${i.toString(16).padStart(22, '0')}`,
      name: `${stages[i % stages.length]}`,
      pos: i + 1,
      closed: false,
    }));
    ctx.trello.addBoard(
      {
        id: '7c0000000000000000000001',
        name: 'QC 1 Board',
        url: 'https://trello.com/b/BiGbOaRd/qc',
        shortLink: 'BiGbOaRd',
        closed: false,
      },
      bigLists,
    );
    const created = await api('POST', '/api/boards', {
      ref: 'https://trello.com/b/BiGbOaRd',
      guildId: guild.id,
      discordChannelId: IDS.channel,
    });
    expect(created.statusCode).toBe(201);
    const board: BoardDetailDto = created.json();
    expect(board.lists).toHaveLength(300);
    expect(board.lists.map((l) => l.trelloListId)).toEqual(bigLists.map((l) => l.id));

    // Re-sync: one renamed, one archived, the last 50 removed on Trello, then one comes back.
    const fake = ctx.trello.boards.get('7c0000000000000000000001')!;
    fake.lists = bigLists
      .slice(0, 250)
      .map((l, i) =>
        i === 0
          ? { ...l, name: 'Script Writer Ready (NFL)' }
          : i === 1
            ? { ...l, closed: true }
            : l,
      );
    let detail: BoardDetailDto = (await api('POST', `/api/boards/${board.id}/sync-lists`)).json();
    expect(detail.lists).toHaveLength(300);
    expect(detail.lists[0]).toMatchObject({ name: 'Script Writer Ready (NFL)', missing: false });
    expect(detail.lists[1]).toMatchObject({ closed: true, missing: false });
    expect(detail.lists.filter((l) => l.missing)).toHaveLength(50);

    fake.lists = [...fake.lists, bigLists[299]!];
    detail = (await api('POST', `/api/boards/${board.id}/sync-lists`)).json();
    expect(detail.lists.filter((l) => l.missing)).toHaveLength(49);
    expect(detail.lists[299]).toMatchObject({ trelloListId: bigLists[299]!.id, missing: false });
  });
});

describe('notifications, settings, health', () => {
  let guild: GuildDto;
  let role: RoleDto;
  let board: BoardDetailDto;
  beforeEach(async () => {
    await login();
    guild = await addGuild();
    role = await addRole();
    board = await addBoard(guild.id);
  });

  it('retries a failed notification against the current configuration', async () => {
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} — {card_title}',
    });
    // simulate the target being removed after the mapping was saved
    await ctx.db.delete(roleTargets);
    const [row] = await ctx.db.select().from(boards);
    await postWebhook(ctx.app, trelloFixtureBody('updateCard-move'), { token: row!.webhookToken });
    let [n] = await ctx.db.select().from(notifications);
    expect(n!.status).toBe('failed');

    // put the target back and retry
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    const retried = await api('POST', `/api/notifications/${n!.id}/retry`);
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      status: 'pending',
      mentions: [{ kind: 'user', id: IDS.editorUser }],
      lastError: null,
    });
    await ctx.app.worker.processOnce();
    [n] = await ctx.db.select().from(notifications);
    expect(n!.status).toBe('sent');
    expect(ctx.discord.sent[0]!.content).toBe(`<@${IDS.editorUser}> — NFL Week 3 recap`);
    expect((await api('POST', `/api/notifications/${n!.id}/retry`)).statusCode).toBe(200);
    expect((await api('GET', `/api/notifications/${n!.id}`)).json().status).toBe('pending');
  });

  it('stores the default template and reports integration health', async () => {
    expect((await api('GET', '/api/settings')).json()).toEqual({
      defaultTemplate: '{mention} — {card_title} is ready for {list_name}',
      defaultCommentTemplate:
        '{mention} — feedback added for {card_title} by {commented_by}: {comment_text}',
    });
    expect(
      (await api('PUT', '/api/settings', { defaultTemplate: '{mention}: {card_title}' }))
        .statusCode,
    ).toBe(200);
    // Saving one template leaves the other as it was.
    expect(
      (await api('PUT', '/api/settings', { defaultCommentTemplate: '{mention} fix {card_title}' }))
        .statusCode,
    ).toBe(200);
    expect((await api('GET', '/api/settings')).json()).toEqual({
      defaultTemplate: '{mention}: {card_title}',
      defaultCommentTemplate: '{mention} fix {card_title}',
    });
    expect((await api('PUT', '/api/settings', {})).statusCode).toBe(400);
    const health = (await api('GET', '/api/health/integrations')).json();
    expect(health).toMatchObject({
      trello: { ok: true, username: 'jane' },
      discord: { ok: true, botUsername: 'discrello', membersIntentEnabled: true },
      guildCount: 1,
      publicBaseUrl: 'https://example.test',
    });
    ctx.discord.membersIntentEnabled = false;
    ctx.app.validator.invalidate();
    expect((await api('GET', '/api/health/integrations')).json().discord.membersIntentEnabled).toBe(
      false,
    );
  });

  it('detects configuration that stopped working and alerts once', async () => {
    await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, {
      kind: 'role',
      id: IDS.editorsRole,
    });
    await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
      roleId: role.id,
      messageTemplate: '{mention} x',
    });
    const g = ctx.discord.guilds.get(IDS.guild)!;
    g.roles.find((r) => r.id === IDS.editorsRole)!.mentionable = false;

    const first = (await api('POST', '/api/admin/recheck-mentions')).json();
    expect(first).toMatchObject({
      targetsChecked: 1,
      targetsFailing: 1,
      mappingsChecked: 1,
      mappingsFailing: 1,
    });
    const rolesNow: RoleDto[] = (await api('GET', '/api/roles')).json();
    expect(rolesNow[0]!.targets[0]).toMatchObject({ checkStatus: 'error' });
    expect(rolesNow[0]!.targets[0]!.checkError).toContain('not mentionable');
    const detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]!.checkStatus).toBe('error');
    expect(detail.mappingErrorCount).toBe(1);
    expect(ctx.alerts.events.filter((e) => e.kind === 'config')).toHaveLength(2);

    await api('POST', '/api/admin/recheck-mentions');
    expect(ctx.alerts.events.filter((e) => e.kind === 'config')).toHaveLength(2);

    g.roles.find((r) => r.id === IDS.editorsRole)!.mentionable = true;
    const fixed = (await api('POST', '/api/admin/recheck-mentions')).json();
    expect(fixed).toMatchObject({ targetsFailing: 0, mappingsFailing: 0 });
    const boardsList = (await api('GET', '/api/boards')).json();
    expect(boardsList[0]).toMatchObject({ mappingCount: 1, mappingErrorCount: 0 });
  });

  it('reconciles webhooks and deletes orphans pointing at this deployment', async () => {
    await ctx.trello.createWebhook({
      callbackURL: 'https://example.test/webhooks/trello/' + 'f'.repeat(32),
      idModel: 'x',
      description: 'orphan',
    });
    await ctx.trello.createWebhook({
      callbackURL: 'https://other.test/webhooks/trello/' + 'f'.repeat(32),
      idModel: 'x',
      description: 'foreign',
    });
    const res = (await api('POST', '/api/admin/reconcile')).json();
    expect(res).toEqual({ checked: 1, orphansDeleted: 1 });
    expect(ctx.trello.webhooks.size).toBe(2);
  });
});

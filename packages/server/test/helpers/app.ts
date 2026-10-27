import { PermissionFlagsBits } from 'discord-api-types/v10';
import { buildApp, type App } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { openDb, type Db, type DbHandle } from '../../src/db/client';
import { boards, guilds, listMappings, roleTargets, roles, trelloLists } from '../../src/db/schema';
import { FakeDiscordClient } from '../../src/discord/fake';
import { NoopAlerts } from '../../src/notifications/alerts';
import { FakeTrelloClient } from '../../src/trello/fake';
import { computeTrelloSignature } from '../../src/trello/signature';

export const TEST_SECRET = 'trello-test-secret';
export const PUBLIC_BASE_URL = 'https://example.test';

export const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_BASE_URL,
  DATABASE_URL: 'pglite://memory',
  TRELLO_API_KEY: 'k',
  TRELLO_API_TOKEN: 't',
  TRELLO_API_SECRET: TEST_SECRET,
  DISCORD_BOT_TOKEN: 'd',
  ADMIN_PASSWORD: 'correct-horse-battery',
  SESSION_SECRET: 'x'.repeat(32),
};

export interface TestClock {
  now: () => Date;
  advance: (ms: number) => void;
  set: (iso: string) => void;
}

export function makeClock(start = '2026-09-24T10:00:00.000Z'): TestClock {
  let current = new Date(start);
  return {
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    set: (iso) => {
      current = new Date(iso);
    },
  };
}

export interface TestContext {
  app: App;
  db: Db;
  dbHandle: DbHandle;
  discord: FakeDiscordClient;
  trello: FakeTrelloClient;
  alerts: NoopAlerts;
  clock: TestClock;
  config: Config;
  close: () => Promise<void>;
}

export async function makeTestContext(): Promise<TestContext> {
  const dbHandle = await openDb('pglite://memory');
  await dbHandle.migrate();
  const discord = new FakeDiscordClient();
  const trello = new FakeTrelloClient();
  const alerts = new NoopAlerts();
  const clock = makeClock();
  const config = loadConfig(testEnv);
  const app = await buildApp({
    config,
    dbHandle,
    discord,
    trello,
    alerts,
    clock: clock.now,
    webDist: null,
  });
  return {
    app,
    db: dbHandle.db,
    dbHandle,
    discord,
    trello,
    alerts,
    clock,
    config,
    close: async () => {
      await app.fastify.close();
      await dbHandle.close();
    },
  };
}

// ---- Discord world used by most tests ----
export const IDS = {
  guild: '100000000000000000',
  owner: '200000000000000000',
  channel: '300000000000000000',
  privateChannel: '310000000000000000',
  alertChannel: '320000000000000000',
  editorUser: '400000000000000000',
  outsiderUser: '410000000000000000',
  botUser: '999000000000000000',
  editorsRole: '500000000000000000',
  quietRole: '510000000000000000',
  emptyRole: '520000000000000000',
  otherGuild: '110000000000000000',
  otherChannel: '330000000000000000',
};

/**
 * A guild where: #general is public; #private is hidden from @everyone but visible to Editors;
 * "Editors" is mentionable, "Quiet" is not, "Empty" has no members; the bot has View+Send but not
 * Mention Everyone (unless a test grants it).
 */
export function seedFakeDiscord(
  discord: FakeDiscordClient,
  opts: { botCanMentionEveryone?: boolean } = {},
) {
  const P = PermissionFlagsBits;
  discord.addGuild({
    id: IDS.guild,
    name: 'Sports Team',
    ownerId: IDS.owner,
    roles: [
      { id: IDS.editorsRole, name: 'Editors', permissions: 0n, mentionable: true },
      { id: IDS.quietRole, name: 'Quiet', permissions: 0n, mentionable: false },
      { id: IDS.emptyRole, name: 'Empty', permissions: 0n, mentionable: true },
      {
        id: 'botrole',
        name: 'Discrello',
        permissions: opts.botCanMentionEveryone ? P.MentionEveryone : 0n,
      },
    ],
    channels: [
      { id: IDS.channel, name: 'general' },
      { id: IDS.alertChannel, name: 'discrello-alerts' },
      {
        id: IDS.privateChannel,
        name: 'private',
        overwrites: [
          { id: IDS.guild, type: 0, allow: '0', deny: P.ViewChannel.toString() },
          { id: IDS.editorsRole, type: 0, allow: P.ViewChannel.toString(), deny: '0' },
          { id: IDS.botUser, type: 1, allow: P.ViewChannel.toString(), deny: '0' },
        ],
      },
    ],
    members: [
      { userId: IDS.owner, username: 'owner', roleIds: [] },
      { userId: IDS.editorUser, username: 'editor', roleIds: [IDS.editorsRole, IDS.quietRole] },
      { userId: IDS.outsiderUser, username: 'outsider', roleIds: [] },
      { userId: IDS.botUser, username: 'discrello', roleIds: ['botrole'], bot: true },
    ],
  });
  discord.addGuild({
    id: IDS.otherGuild,
    name: 'Other Team',
    ownerId: IDS.owner,
    roles: [],
    channels: [{ id: IDS.otherChannel, name: 'general' }],
    members: [{ userId: IDS.botUser, username: 'discrello', roleIds: [], bot: true }],
  });
}

// ---- DB rows used by the pipeline tests ----
export const TRELLO = {
  boardId: '5f1a2b3c4d5e6f7a8b9c0d1e',
  shortLink: 'BoArD123',
  list1: '64a00000000000000000a001',
  list2: '64a00000000000000000a002',
  token: 'a'.repeat(32),
};

export interface SeededRows {
  guildId: number;
  roleId: number;
  boardId: number;
  mappingId: number;
}

export async function seedPipeline(
  db: Db,
  opts: {
    roleTarget?: { kind: 'user' | 'role'; id: string } | null;
    mappingOverride?: Partial<typeof listMappings.$inferInsert>;
    channelId?: string;
    alertChannelId?: string | null;
  } = {},
): Promise<SeededRows> {
  const [guild] = await db
    .insert(guilds)
    .values({
      discordGuildId: IDS.guild,
      name: 'Sports Team',
      alertChannelId: opts.alertChannelId === undefined ? IDS.alertChannel : opts.alertChannelId,
      botStatus: 'ok',
    })
    .returning();
  const [role] = await db
    .insert(roles)
    .values({
      key: 'editor',
      displayName: 'Editor',
      defaultTemplate: '{mention} — {card_title} is ready for editing',
    })
    .returning();
  const target =
    opts.roleTarget === undefined ? { kind: 'user' as const, id: IDS.editorUser } : opts.roleTarget;
  if (target) {
    await db.insert(roleTargets).values({
      roleId: role!.id,
      guildId: guild!.id,
      mentionKind: target.kind,
      mentionId: target.id,
      checkStatus: 'ok',
    });
  }
  const callbackUrl = `${PUBLIC_BASE_URL}/webhooks/trello/${TRELLO.token}`;
  const [board] = await db
    .insert(boards)
    .values({
      trelloBoardId: TRELLO.boardId,
      trelloShortLink: TRELLO.shortLink,
      name: 'SPORTS',
      url: `https://trello.com/b/${TRELLO.shortLink}/sports`,
      guildId: guild!.id,
      discordChannelId: opts.channelId ?? IDS.channel,
      webhookToken: TRELLO.token,
      webhookId: 'wh1',
      webhookCallbackUrl: callbackUrl,
      webhookStatus: 'active',
    })
    .returning();
  await db.insert(trelloLists).values([
    { boardId: board!.id, trelloListId: TRELLO.list1, name: 'Script Writer Ready', pos: 1 },
    { boardId: board!.id, trelloListId: TRELLO.list2, name: 'NFL editor ready', pos: 2 },
  ]);
  const [mapping] = await db
    .insert(listMappings)
    .values({
      boardId: board!.id,
      trelloListId: TRELLO.list2,
      roleId: role!.id,
      messageTemplate: '{mention} — {card_title} is ready for editing',
      checkStatus: 'ok',
      ...opts.mappingOverride,
    })
    .returning();
  return { guildId: guild!.id, roleId: role!.id, boardId: board!.id, mappingId: mapping!.id };
}

/** Posts a raw body to the webhook route with a valid (or deliberately broken) signature. */
export function postWebhook(
  app: App,
  rawBody: string,
  opts: { token?: string; signature?: string | null; callbackUrl?: string } = {},
) {
  const token = opts.token ?? TRELLO.token;
  const callbackUrl = opts.callbackUrl ?? `${PUBLIC_BASE_URL}/webhooks/trello/${token}`;
  const signature =
    opts.signature === undefined
      ? computeTrelloSignature(rawBody, callbackUrl, TEST_SECRET)
      : opts.signature;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-trello-webhook'] = signature;
  return app.fastify.inject({
    method: 'POST',
    url: `/webhooks/trello/${token}`,
    headers,
    payload: rawBody,
  });
}

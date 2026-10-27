import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import { FakeDiscordClient } from '../../src/discord/fake';
import { MentionValidator } from '../../src/discord/validate';
import { IDS, seedFakeDiscord } from '../helpers/app';

let discord: FakeDiscordClient;
let validator: MentionValidator;

beforeEach(() => {
  discord = new FakeDiscordClient();
  seedFakeDiscord(discord);
  validator = new MentionValidator(discord, { cacheTtlMs: 0 });
});

const v = (
  channelId: string | null,
  target: { kind: 'user' | 'role'; id: string } | null,
  guild = IDS.guild,
) => validator.validate({ discordGuildId: guild, channelId, target });

describe('MentionValidator', () => {
  it('accepts a user who can see a public channel', async () => {
    expect(await v(IDS.channel, { kind: 'user', id: IDS.editorUser })).toEqual({ ok: true });
  });

  it('accepts a mentionable role with members who can see the channel', async () => {
    expect(await v(IDS.channel, { kind: 'role', id: IDS.editorsRole })).toEqual({ ok: true });
  });

  it('rejects a non-mentionable role when the bot may not mention everyone', async () => {
    const r = await v(IDS.channel, { kind: 'role', id: IDS.quietRole });
    expect(r).toMatchObject({ ok: false, code: 'ROLE_NOT_PINGABLE' });
    if (!r.ok) {
      expect(r.message).toContain('@Quiet');
      expect(r.message).toContain('#general');
      expect(r.hint).toContain('Allow anyone to @mention this role');
    }
  });

  it('accepts a non-mentionable role when the bot may mention everyone in that channel', async () => {
    const guild = discord.guilds.get(IDS.guild)!;
    guild.channels.find((c) => c.id === IDS.channel)!.overwrites = [
      { id: IDS.botUser, type: 1, allow: P.MentionEveryone.toString(), deny: '0' },
    ];
    expect(await v(IDS.channel, { kind: 'role', id: IDS.quietRole })).toEqual({ ok: true });
    // …but not in another channel without that overwrite
    expect(await v(IDS.privateChannel, { kind: 'role', id: IDS.quietRole })).toMatchObject({
      ok: false,
      code: 'ROLE_NOT_PINGABLE',
    });
  });

  it('rejects a role with no (human) members', async () => {
    expect(await v(IDS.channel, { kind: 'role', id: IDS.emptyRole })).toMatchObject({
      ok: false,
      code: 'ROLE_HAS_NO_MEMBERS',
    });
    const guild = discord.guilds.get(IDS.guild)!;
    guild.members.find((m) => m.userId === IDS.botUser)!.roleIds.push(IDS.emptyRole);
    expect(await v(IDS.channel, { kind: 'role', id: IDS.emptyRole })).toMatchObject({
      ok: false,
      code: 'ROLE_HAS_NO_MEMBERS',
    });
  });

  it('rejects a role whose members cannot see the channel', async () => {
    const guild = discord.guilds.get(IDS.guild)!;
    // Editors lose access to #private
    const priv = guild.channels.find((c) => c.id === IDS.privateChannel)!;
    priv.overwrites = priv.overwrites!.filter((o) => o.id !== IDS.editorsRole);
    expect(await v(IDS.privateChannel, { kind: 'role', id: IDS.editorsRole })).toMatchObject({
      ok: false,
      code: 'ROLE_MEMBERS_CANNOT_SEE_CHANNEL',
    });
  });

  it('explains when the Server Members Intent is off', async () => {
    discord.membersIntentEnabled = false;
    const r = await v(IDS.channel, { kind: 'role', id: IDS.editorsRole });
    expect(r).toMatchObject({ ok: false, code: 'MEMBERS_INTENT_DISABLED' });
    if (!r.ok) expect(r.hint).toContain('Server Members Intent');
    // user targets do not need the intent
    expect(await v(IDS.channel, { kind: 'user', id: IDS.editorUser })).toEqual({ ok: true });
  });

  it('rejects unknown roles, @everyone, unknown users, bots and users who cannot see the channel', async () => {
    expect(await v(IDS.channel, { kind: 'role', id: '123456789012345678' })).toMatchObject({
      ok: false,
      code: 'ROLE_NOT_FOUND',
    });
    expect(await v(IDS.channel, { kind: 'role', id: IDS.guild })).toMatchObject({
      ok: false,
      code: 'ROLE_IS_EVERYONE',
    });
    expect(await v(IDS.channel, { kind: 'user', id: '123456789012345678' })).toMatchObject({
      ok: false,
      code: 'USER_NOT_IN_GUILD',
    });
    expect(await v(IDS.channel, { kind: 'user', id: IDS.botUser })).toMatchObject({
      ok: false,
      code: 'USER_IS_BOT',
    });
    expect(await v(IDS.privateChannel, { kind: 'user', id: IDS.outsiderUser })).toMatchObject({
      ok: false,
      code: 'USER_CANNOT_SEE_CHANNEL',
    });
    expect(await v(IDS.privateChannel, { kind: 'user', id: IDS.editorUser })).toEqual({ ok: true });
  });

  it('checks the bot and the channel itself', async () => {
    expect(await v('123456789012345678', null)).toMatchObject({
      ok: false,
      code: 'CHANNEL_NOT_FOUND',
    });
    expect(await v(IDS.otherChannel, null)).toMatchObject({ ok: false, code: 'CHANNEL_NOT_FOUND' });
    const guild = discord.guilds.get(IDS.guild)!;
    guild.channels.push({ id: '340000000000000000', name: 'voice', type: 2 });
    expect(await v('340000000000000000', null)).toMatchObject({
      ok: false,
      code: 'CHANNEL_WRONG_TYPE',
    });
    const priv = guild.channels.find((c) => c.id === IDS.privateChannel)!;
    priv.overwrites = priv.overwrites!.filter((o) => o.id !== IDS.botUser);
    expect(await v(IDS.privateChannel, null)).toMatchObject({
      ok: false,
      code: 'BOT_CANNOT_VIEW_CHANNEL',
    });
    guild.channels.find((c) => c.id === IDS.channel)!.overwrites = [
      { id: IDS.botUser, type: 1, allow: '0', deny: P.SendMessages.toString() },
    ];
    expect(await v(IDS.channel, null)).toMatchObject({ ok: false, code: 'BOT_CANNOT_SEND' });
  });

  it('handles threads: parent overwrites, archived state and the thread send permission', async () => {
    const guild = discord.guilds.get(IDS.guild)!;
    guild.channels.push({
      id: '350000000000000000',
      name: 'thread',
      type: 11,
      parentId: IDS.channel,
    });
    expect(await v('350000000000000000', { kind: 'user', id: IDS.editorUser })).toMatchObject({
      ok: false,
      code: 'BOT_CANNOT_SEND',
    });
    guild.roles.find((r) => r.id === 'botrole')!.permissions = P.SendMessagesInThreads;
    expect(await v('350000000000000000', { kind: 'user', id: IDS.editorUser })).toEqual({
      ok: true,
    });
    guild.channels.find((c) => c.id === '350000000000000000')!.archived = true;
    expect(await v('350000000000000000', null)).toMatchObject({
      ok: false,
      code: 'CHANNEL_ARCHIVED',
    });
  });

  it('reports when the bot is not in the guild', async () => {
    expect(await v(IDS.channel, null, '123456789012345678')).toMatchObject({
      ok: false,
      code: 'BOT_NOT_IN_GUILD',
    });
    const guild = discord.guilds.get(IDS.guild)!;
    guild.members = guild.members.filter((m) => m.userId !== IDS.botUser);
    expect(await v(IDS.channel, null)).toMatchObject({ ok: false, code: 'BOT_NOT_IN_GUILD' });
  });

  it('validates a role without a channel using guild-level permissions', async () => {
    expect(await v(null, { kind: 'role', id: IDS.editorsRole })).toEqual({ ok: true });
    expect(await v(null, { kind: 'role', id: IDS.quietRole })).toMatchObject({
      ok: false,
      code: 'ROLE_NOT_PINGABLE',
    });
    expect(await v(null, { kind: 'user', id: IDS.editorUser })).toEqual({ ok: true });
  });
});

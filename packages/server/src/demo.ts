/**
 * DISCRELLO_FAKE_INTEGRATIONS=1: in-memory Discord + Trello with sample data, so the UI can be
 * exercised locally without tokens. Never used in production (guarded in index.ts).
 */
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { FakeDiscordClient } from './discord/fake';
import { FakeTrelloClient } from './trello/fake';

export const DEMO = {
  guild: '100000000000000000',
  channel: '300000000000000000',
  alertChannel: '320000000000000000',
  editorUser: '400000000000000000',
  writerUser: '410000000000000000',
  editorsRole: '500000000000000000',
  quietRole: '510000000000000000',
  boardId: '5f1a2b3c4d5e6f7a8b9c0d1e',
  shortLink: 'DeMoBoRd',
  lists: {
    scriptWriter: '64a00000000000000000a001',
    scriptQc: '64a00000000000000000a002',
    editor: '64a00000000000000000a003',
    editorQc: '64a00000000000000000a004',
    upload: '64a00000000000000000a005',
  },
};

export function makeFakeIntegrations(): { discord: FakeDiscordClient; trello: FakeTrelloClient } {
  const discord = new FakeDiscordClient();
  discord.addGuild({
    id: DEMO.guild,
    name: 'Demo Sports Team',
    ownerId: '200000000000000000',
    roles: [
      { id: DEMO.editorsRole, name: 'Editors', permissions: 0n, mentionable: true },
      {
        id: DEMO.quietRole,
        name: 'Uploaders',
        permissions: 0n,
        mentionable: false,
      },
      {
        id: 'botrole',
        name: 'Discrello',
        permissions: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages,
      },
    ],
    channels: [
      { id: DEMO.channel, name: 'sports-pipeline' },
      { id: DEMO.alertChannel, name: 'discrello-alerts' },
    ],
    members: [
      { userId: '200000000000000000', username: 'owner', roleIds: [] },
      { userId: DEMO.editorUser, username: 'edith_editor', roleIds: [DEMO.editorsRole] },
      { userId: DEMO.writerUser, username: 'will_writer', roleIds: [] },
      { userId: discord.botUser.id, username: 'discrello', roleIds: ['botrole'], bot: true },
    ],
  });
  const trello = new FakeTrelloClient();
  trello.addBoard(
    {
      id: DEMO.boardId,
      name: 'SPORTS (demo)',
      url: `https://trello.com/b/${DEMO.shortLink}/sports`,
      shortLink: DEMO.shortLink,
      closed: false,
    },
    [
      { id: DEMO.lists.scriptWriter, name: 'Script Writer Ready', pos: 1, closed: false },
      { id: DEMO.lists.scriptQc, name: 'SW QC STEP', pos: 2, closed: false },
      { id: DEMO.lists.editor, name: 'NFL editor ready', pos: 3, closed: false },
      { id: DEMO.lists.editorQc, name: 'QC step', pos: 4, closed: false },
      { id: DEMO.lists.upload, name: 'ready to upload', pos: 5, closed: false },
    ],
  );
  return { discord, trello };
}

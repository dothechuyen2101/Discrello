import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardDetailDto, GuildDto, RoleDto, TeamDto } from '@discrello/shared';
import { boards, listMappings, notifications } from '../../src/db/schema';
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
function api(method: Method, url: string, payload?: unknown) {
  return ctx.app.fastify.inject({
    method,
    url,
    headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

async function login() {
  const res = await ctx.app.fastify.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  const raw = res.headers['set-cookie'];
  cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]!;
}

let guild: GuildDto;

/** A role (person) with an optional Discord target in the test server. */
async function person(
  key: string,
  displayName: string,
  target: { kind: 'user' | 'role'; id: string } | null,
): Promise<RoleDto> {
  const res = await api('POST', '/api/roles', { key, displayName });
  expect(res.statusCode).toBe(201);
  const role: RoleDto = res.json();
  if (target) {
    const t = await api('PUT', `/api/roles/${role.id}/targets/${guild.id}`, target);
    expect(t.statusCode).toBe(200);
  }
  return role;
}

async function team(name: string, members: RoleDto[]): Promise<TeamDto> {
  const res = await api('POST', '/api/teams', { name, memberRoleIds: members.map((m) => m.id) });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function addBoard(channelId = IDS.channel): Promise<BoardDetailDto> {
  const res = await api('POST', '/api/boards', {
    ref: TRELLO.shortLink,
    guildId: guild.id,
    discordChannelId: channelId,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function mapToTeam(boardId: number, teamId: number) {
  return api('PUT', `/api/boards/${boardId}/mappings/${TRELLO.list2}`, {
    teamId,
    messageTemplate: '{mention} — {card_title} is ready for editing',
  });
}

beforeEach(async () => {
  ctx = await makeTestContext();
  seedFakeDiscord(ctx.discord);
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
  await login();
  const res = await api('POST', '/api/guilds', {
    discordGuildId: IDS.guild,
    alertChannelId: IDS.alertChannel,
  });
  guild = res.json();
});

afterEach(async () => {
  await ctx.close();
});

describe('teams', () => {
  it('groups people, shows the grouping on both sides, and protects teams that lists use', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const ana = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const sports = await team('Sports', [tom, ana]);
    expect(sports).toMatchObject({
      name: 'Sports',
      usageCount: 0,
      members: [
        { roleId: tom.id, displayName: 'Tom' },
        { roleId: ana.id, displayName: 'Ana' },
      ],
    });
    expect((await api('POST', '/api/teams', { name: 'Sports' })).statusCode).toBe(409);
    const roles: RoleDto[] = (await api('GET', '/api/roles')).json();
    expect(roles.find((r) => r.id === tom.id)!.teams).toEqual([{ id: sports.id, name: 'Sports' }]);

    const board = await addBoard();
    const mapped = await mapToTeam(board.id, sports.id);
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json()).toMatchObject({
      teamId: sports.id,
      teamName: 'Sports',
      roleId: null,
      checkStatus: 'ok',
    });
    expect((await api('GET', '/api/teams')).json()[0].usageCount).toBe(1);

    // a list pings a role or a team, never both or neither
    for (const body of [{ roleId: tom.id, teamId: sports.id }, {}]) {
      const res = await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list1}`, {
        ...body,
        messageTemplate: '{mention} x',
      });
      expect(res.statusCode).toBe(400);
    }

    // a mapped team cannot be deleted or emptied, and its last member cannot be deleted
    expect((await api('DELETE', `/api/teams/${sports.id}`)).statusCode).toBe(409);
    expect((await api('DELETE', `/api/teams/${sports.id}/members/${ana.id}`)).statusCode).toBe(200);
    expect((await api('DELETE', `/api/teams/${sports.id}/members/${tom.id}`)).statusCode).toBe(409);
    expect((await api('DELETE', `/api/roles/${tom.id}`)).statusCode).toBe(409);

    const renamed = await api('PUT', `/api/teams/${sports.id}`, { name: 'NFL editors' });
    expect(renamed.json()).toMatchObject({ name: 'NFL editors' });
    const detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({ teamName: 'NFL editors' });

    await api('DELETE', `/api/boards/${board.id}/mappings/${TRELLO.list2}`);
    expect((await api('DELETE', `/api/teams/${sports.id}`)).statusCode).toBe(204);
    expect((await api('GET', '/api/teams')).json()).toEqual([]);
  });

  it('refuses a team mapping unless every member would be notified', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const nobody = await person('writer', 'Writer', null);
    const board = await addBoard(IDS.privateChannel);

    const empty = await team('Empty', []);
    const res = await mapToTeam(board.id, empty.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'TEAM_HAS_NO_MEMBERS' });

    const mixed = await team('Mixed', [tom, nobody]);
    const missing = await mapToTeam(board.id, mixed.id);
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe('ROLE_HAS_NO_TARGET');
    expect(missing.json().message).toBe('Team Mixed: Writer has no Discord target in Sports Team.');
    expect(await ctx.db.select().from(listMappings)).toHaveLength(0);

    // a member who cannot see the channel (#private) is named in the error
    const ana = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const withAna = await team('With Ana', [tom, ana]);
    const blind = await mapToTeam(board.id, withAna.id);
    expect(blind.statusCode).toBe(422);
    expect(blind.json()).toMatchObject({ code: 'USER_CANNOT_SEE_CHANNEL' });
    expect(blind.json().message).toContain('Team With Ana, Ana:');
  });

  it('checks new members and target changes against the channels where the team pings', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const ana = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const nobody = await person('writer', 'Writer', null);
    const editors = await team('Editors', [tom]);
    const board = await addBoard(IDS.privateChannel);
    expect(
      (
        await api('PUT', `/api/boards/${board.id}/mappings/${TRELLO.list2}`, {
          teamId: editors.id,
          messageTemplate: '{mention} x',
        })
      ).statusCode,
    ).toBe(200);

    // Ana cannot see #private, where the team pings
    const blind = await api('PUT', `/api/teams/${editors.id}/members/${ana.id}`);
    expect(blind.statusCode).toBe(422);
    expect(blind.json().code).toBe('USER_CANNOT_SEE_CHANNEL');
    const noTarget = await api('PUT', `/api/teams/${editors.id}/members/${nobody.id}`);
    expect(noTarget.statusCode).toBe(422);
    expect(noTarget.json().code).toBe('ROLE_HAS_NO_TARGET');
    expect((await api('GET', '/api/teams')).json()[0].members).toHaveLength(1);

    // Tom's target is now also checked against #private, because his team pings there
    const moved = await api('PUT', `/api/roles/${tom.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.outsiderUser,
    });
    expect(moved.statusCode).toBe(422);
    expect(moved.json().code).toBe('USER_CANNOT_SEE_CHANNEL');

    // a team that is not used anywhere takes anyone
    const spare = await team('Spare', []);
    expect((await api('PUT', `/api/teams/${spare.id}/members/${nobody.id}`)).statusCode).toBe(200);
  });

  it('pings every member in one message and verifies each mention', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const ana = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const crew = await person('crew', 'Crew', { kind: 'role', id: IDS.editorsRole });
    const sports = await team('Sports', [tom, ana, crew]);
    const board = await addBoard();
    expect((await mapToTeam(board.id, sports.id)).statusCode).toBe(200);

    const [row] = await ctx.db.select().from(boards);
    const res = await postWebhook(ctx.app, trelloFixtureBody('updateCard-move'), {
      token: row!.webhookToken,
    });
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });
    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent[0]).toMatchObject({
      channelId: IDS.channel,
      content: `<@${IDS.editorUser}> <@${IDS.outsiderUser}> <@&${IDS.editorsRole}> — NFL Week 3 recap is ready for editing`,
      allowedMentions: {
        parse: [],
        users: [IDS.editorUser, IDS.outsiderUser],
        roles: [IDS.editorsRole],
      },
    });
    const list = (await api('GET', '/api/notifications')).json();
    expect(list.items[0]).toMatchObject({
      status: 'sent',
      mentionVerified: true,
      teamName: 'Sports',
      roleKey: null,
      mentions: [
        { kind: 'user', id: IDS.editorUser },
        { kind: 'user', id: IDS.outsiderUser },
        { kind: 'role', id: IDS.editorsRole },
      ],
    });

    const test = await api('POST', `/api/boards/${board.id}/mappings/${TRELLO.list2}/test`);
    expect(test.json()).toMatchObject({ ok: true, mentionVerified: true });

    // one member stops being pingable: the message still goes out, and says who was missed
    const g = ctx.discord.guilds.get(IDS.guild)!;
    g.roles.find((r) => r.id === IDS.editorsRole)!.mentionable = false;
    await postWebhook(
      ctx.app,
      trelloFixtureBody('updateCard-move', (d) => {
        d.action.id = '64a1b2c3d4e5f60718293aff';
      }),
      { token: row!.webhookToken },
    );
    await ctx.app.worker.processOnce();
    const rows = await ctx.db.select().from(notifications);
    const second = rows.find((n) => n.trelloActionId === '64a1b2c3d4e5f60718293aff')!;
    expect(second).toMatchObject({ status: 'sent_no_mention', mentionVerified: false });
    expect(second.lastError).toBe(
      `Message posted but Discord did not register the mention of the role <@&${IDS.editorsRole}>`,
    );
    expect(ctx.alerts.events.at(-1)!.summary).toContain(`the role <@&${IDS.editorsRole}>`);
  });

  it('flags team lists when a member loses their target, and clears them when the member leaves', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const ana = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const sports = await team('Sports', [tom, ana]);
    const board = await addBoard();
    await mapToTeam(board.id, sports.id);

    await api('DELETE', `/api/roles/${ana.id}/targets/${guild.id}`);
    let detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({
      checkStatus: 'error',
      checkError: 'Team Sports: Ana has no Discord target in this server any more',
    });

    // the periodic re-check agrees and alerts once
    const summary = await ctx.app.services.mentionHealth.recheckAll();
    expect(summary.mappingsFailing).toBe(1);

    await api('DELETE', `/api/teams/${sports.id}/members/${ana.id}`);
    detail = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({ checkStatus: 'ok', checkError: null });
  });
});

describe('channels (folders of teams)', () => {
  it('groups teams into channels, moves them, and keeps them when the channel is deleted', async () => {
    const tom = await person('tom', 'Tom', { kind: 'user', id: IDS.editorUser });
    const created = await api('POST', '/api/team-channels', { name: 'Shorts Domination' });
    expect(created.statusCode).toBe(201);
    const shorts = created.json();
    expect(shorts).toMatchObject({ name: 'Shorts Domination', teamCount: 0 });
    expect(
      (await api('POST', '/api/team-channels', { name: 'Shorts Domination' })).statusCode,
    ).toBe(409);

    const inside = await api('POST', '/api/teams', {
      name: 'SW QC',
      memberRoleIds: [tom.id],
      channelId: shorts.id,
    });
    expect(inside.json()).toMatchObject({ name: 'SW QC', channelId: shorts.id });
    const loose = await team('Everyone', [tom]);
    expect(loose.channelId).toBeNull();
    expect((await api('POST', '/api/teams', { name: 'Ghost', channelId: 999 })).statusCode).toBe(
      404,
    );

    // move, rename without moving, and refuse an empty change
    const moved = await api('PUT', `/api/teams/${loose.id}`, { channelId: shorts.id });
    expect(moved.json()).toMatchObject({ name: 'Everyone', channelId: shorts.id });
    const renamed = await api('PUT', `/api/teams/${loose.id}`, { name: 'Whole channel' });
    expect(renamed.json()).toMatchObject({ name: 'Whole channel', channelId: shorts.id });
    expect((await api('PUT', `/api/teams/${loose.id}`, {})).statusCode).toBe(400);
    expect((await api('GET', '/api/team-channels')).json()).toMatchObject([
      { name: 'Shorts Domination', teamCount: 2 },
    ]);
    expect(
      (await api('PUT', `/api/team-channels/${shorts.id}`, { name: 'Shorts' })).json(),
    ).toMatchObject({ name: 'Shorts', teamCount: 2 });

    // deleting the folder keeps its teams (now in "No channel") and the lists that use them
    const board = await addBoard();
    expect((await mapToTeam(board.id, inside.json().id)).statusCode).toBe(200);
    expect((await api('DELETE', `/api/team-channels/${shorts.id}`)).statusCode).toBe(204);
    const teamsNow: TeamDto[] = (await api('GET', '/api/teams')).json();
    expect(teamsNow.map((t) => [t.name, t.channelId])).toEqual([
      ['SW QC', null],
      ['Whole channel', null],
    ]);
    const detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({ teamName: 'SW QC', checkStatus: 'ok' });
  });
});

describe('feedback recipient', () => {
  /** "NFL editor ready" mapped to the QC person, with revision feedback going to `feedback`. */
  function mapWithFeedback(
    boardId: number,
    qcRoleId: number,
    feedback: { feedbackRoleId?: number | null; feedbackTeamId?: number | null },
  ) {
    return api('PUT', `/api/boards/${boardId}/mappings/${TRELLO.list2}`, {
      roleId: qcRoleId,
      messageTemplate: '{mention} — {card_title} is ready for QC',
      ...feedback,
    });
  }

  it("sends revision feedback to the chosen role instead of the list's own", async () => {
    const qc = await person('mikolaj', 'Mikolaj', { kind: 'user', id: IDS.outsiderUser });
    const editor = await person('editor', 'Editor', { kind: 'user', id: IDS.editorUser });
    const board = await addBoard();
    const saved = await mapWithFeedback(board.id, qc.id, { feedbackRoleId: editor.id });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      roleDisplayName: 'Mikolaj',
      feedbackRoleId: editor.id,
      feedbackRoleDisplayName: 'Editor',
      feedbackTeamId: null,
    });

    const [row] = await ctx.db.select().from(boards);
    await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'), {
      token: row!.webhookToken,
    });
    await postWebhook(ctx.app, trelloFixtureBody('updateCard-move'), { token: row!.webhookToken });
    const rows = await ctx.db.select().from(notifications);
    const feedback = rows.find((n) => n.triggerType === 'commentCard')!;
    const move = rows.find((n) => n.triggerType === 'updateCard')!;
    expect(feedback).toMatchObject({
      roleId: editor.id,
      mentionsJson: [{ kind: 'user', id: IDS.editorUser }],
      content: `<@${IDS.editorUser}> — feedback added for NFL Week 3 recap by Mike QC: Tighten the intro and fix the score in the title.`,
    });
    // the list itself still pings the QC person
    expect(move).toMatchObject({
      roleId: qc.id,
      content: `<@${IDS.outsiderUser}> — NFL Week 3 recap is ready for QC`,
    });

    // back to "same as this list"
    const cleared = await mapWithFeedback(board.id, qc.id, {});
    expect(cleared.json()).toMatchObject({ feedbackRoleId: null, feedbackTeamId: null });
  });

  it('checks the feedback recipient like the list itself, and protects it while used', async () => {
    const qc = await person('mikolaj', 'Mikolaj', { kind: 'user', id: IDS.editorUser });
    const noTarget = await person('ghost', 'Ghost', null);
    const outsider = await person('ana', 'Ana', { kind: 'user', id: IDS.outsiderUser });
    const editors = await team('Editors', [qc]);
    const board = await addBoard(IDS.privateChannel);

    const missing = await mapWithFeedback(board.id, qc.id, { feedbackRoleId: noTarget.id });
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({ code: 'ROLE_HAS_NO_TARGET' });
    expect(missing.json().message).toMatch(/^Feedback: Role Ghost has no Discord target/);
    const cannotSee = await mapWithFeedback(board.id, qc.id, { feedbackRoleId: outsider.id });
    expect(cannotSee.json()).toMatchObject({ code: 'USER_CANNOT_SEE_CHANNEL' });
    expect(cannotSee.json().message).toMatch(/^Feedback: Ana: /);
    expect(
      (
        await mapWithFeedback(board.id, qc.id, {
          feedbackRoleId: qc.id,
          feedbackTeamId: editors.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(await ctx.db.select().from(listMappings)).toHaveLength(0);

    expect(
      (await mapWithFeedback(board.id, qc.id, { feedbackTeamId: editors.id })).statusCode,
    ).toBe(200);
    const roleNow: RoleDto[] = (await api('GET', '/api/roles')).json();
    expect(roleNow.find((r) => r.id === qc.id)!.usageCount).toBe(1);
    expect((await api('GET', '/api/teams')).json()[0].usageCount).toBe(1);

    // the team receiving feedback cannot be deleted, emptied, or given someone who would not see it
    const delTeam = await api('DELETE', `/api/teams/${editors.id}`);
    expect(delTeam.statusCode).toBe(409);
    expect(delTeam.json().message).toContain('receiving revision feedback');
    expect((await api('DELETE', `/api/teams/${editors.id}/members/${qc.id}`)).statusCode).toBe(409);
    const addOutsider = await api('PUT', `/api/teams/${editors.id}/members/${outsider.id}`);
    expect(addOutsider.json()).toMatchObject({ code: 'USER_CANNOT_SEE_CHANNEL' });

    // a role used only for feedback is protected too
    const editor = await person('editor', 'Editor', { kind: 'user', id: IDS.editorUser });
    await mapWithFeedback(board.id, qc.id, { feedbackRoleId: editor.id });
    expect((await api('DELETE', `/api/roles/${editor.id}`)).statusCode).toBe(409);
    // and so is the channel where its target is used: Ana could not see #private
    const retarget = await api('PUT', `/api/roles/${editor.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.outsiderUser,
    });
    expect(retarget.json()).toMatchObject({ code: 'USER_CANNOT_SEE_CHANNEL' });
  });

  it('flags the list when the feedback recipient loses its target, and clears it when fixed', async () => {
    const qc = await person('mikolaj', 'Mikolaj', { kind: 'user', id: IDS.outsiderUser });
    const editor = await person('editor', 'Editor', { kind: 'user', id: IDS.editorUser });
    const board = await addBoard();
    await mapWithFeedback(board.id, qc.id, { feedbackRoleId: editor.id });

    await api('DELETE', `/api/roles/${editor.id}/targets/${guild.id}`);
    let detail: BoardDetailDto = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]!.checkStatus).toBe('error');
    expect(detail.mappings[0]!.checkError).toMatch(/^Feedback: Role Editor has no Discord target/);
    const summary = await ctx.app.services.mentionHealth.recheckAll();
    expect(summary.mappingsFailing).toBe(1);

    await api('PUT', `/api/roles/${editor.id}/targets/${guild.id}`, {
      kind: 'user',
      id: IDS.editorUser,
    });
    detail = (await api('GET', `/api/boards/${board.id}`)).json();
    expect(detail.mappings[0]).toMatchObject({ checkStatus: 'ok', checkError: null });
  });
});

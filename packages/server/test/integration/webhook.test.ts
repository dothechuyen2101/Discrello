import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setSetting, SETTING_DEFAULT_COMMENT_TEMPLATE } from '../../src/db/repos/settings';
import { boards, guilds, listMappings, notifications, webhookEvents } from '../../src/db/schema';
import { DiscordRequestError } from '../../src/discord/client';
import { TrelloApiError } from '../../src/trello/client';
import { trelloFixtureBody } from '../helpers/fixtures';
import {
  IDS,
  TRELLO,
  makeTestContext,
  postWebhook,
  seedFakeDiscord,
  seedPipeline,
  type TestContext,
} from '../helpers/app';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await makeTestContext();
  seedFakeDiscord(ctx.discord);
});

afterEach(async () => {
  await ctx.close();
});

const moveBody = () => trelloFixtureBody('updateCard-move');

async function allNotifications() {
  return ctx.db.select().from(notifications);
}
async function allEvents() {
  return ctx.db.select().from(webhookEvents);
}

describe('webhook → notification pipeline', () => {
  it('delivers a ping for a mapped list move and verifies the mention', async () => {
    await seedPipeline(ctx.db);
    const res = await postWebhook(ctx.app, moveBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });

    let rows = await allNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      content: `<@${IDS.editorUser}> — NFL Week 3 recap is ready for editing`,
      allowedMentionsJson: { parse: [], users: [IDS.editorUser] },
      discordChannelId: IDS.channel,
      cardUrl: 'https://trello.com/c/AbCdEf12',
      previousListName: 'Script Writer Ready',
      actorName: 'Jane Doe',
    });

    const processed = await ctx.app.worker.processOnce();
    expect(processed).toBe(1);
    expect(ctx.discord.sent).toHaveLength(1);
    expect(ctx.discord.sent[0]).toMatchObject({
      channelId: IDS.channel,
      content: `<@${IDS.editorUser}> — NFL Week 3 recap is ready for editing`,
      allowedMentions: { parse: [], users: [IDS.editorUser] },
    });

    rows = await allNotifications();
    expect(rows[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
      mentionVerified: true,
      discordMessageId: ctx.discord.sent[0]!.messageId,
      lastError: null,
    });
    expect(rows[0]!.sentAt).not.toBeNull();

    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'enqueued', ignoreReason: null, duplicateCount: 0 });
    const [board] = await ctx.db.select().from(boards);
    expect(board!.lastEventAt).not.toBeNull();
  });

  it('accepts Trello redeliveries without creating a second notification', async () => {
    await seedPipeline(ctx.db);
    const first = await postWebhook(ctx.app, moveBody());
    const second = await postWebhook(ctx.app, moveBody());
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(await allNotifications()).toHaveLength(1);
    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.duplicateCount).toBe(1);
    await ctx.app.worker.processOnce();
    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent).toHaveLength(1);
  });

  it('rejects bad signatures, missing headers, unknown tokens and invalid JSON', async () => {
    await seedPipeline(ctx.db);
    expect((await postWebhook(ctx.app, moveBody(), { signature: 'nope' })).statusCode).toBe(401);
    expect((await postWebhook(ctx.app, moveBody(), { signature: null })).statusCode).toBe(401);
    // signature computed for a different callback URL (e.g. an attacker guessing the path)
    expect(
      (
        await postWebhook(ctx.app, moveBody(), {
          callbackUrl: 'https://evil.test/webhooks/trello/x',
        })
      ).statusCode,
    ).toBe(401);
    // one byte changed after signing
    const signedFor = moveBody();
    const tampered = signedFor.replace('NFL Week 3 recap', 'NFL Week 4 recap');
    const res = await ctx.app.fastify.inject({
      method: 'POST',
      url: `/webhooks/trello/${TRELLO.token}`,
      headers: {
        'content-type': 'application/json',
        'x-trello-webhook': (await import('../../src/trello/signature')).computeTrelloSignature(
          signedFor,
          `https://example.test/webhooks/trello/${TRELLO.token}`,
          'trello-test-secret',
        ),
      },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
    expect((await postWebhook(ctx.app, moveBody(), { token: 'b'.repeat(32) })).statusCode).toBe(
      404,
    );
    expect((await postWebhook(ctx.app, '{not json')).statusCode).toBe(400);
    expect(await allNotifications()).toHaveLength(0);
    expect(await allEvents()).toHaveLength(0);
  });

  it('answers the HEAD probe Trello sends when registering', async () => {
    const res = await ctx.app.fastify.inject({
      method: 'HEAD',
      url: `/webhooks/trello/${TRELLO.token}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('ignores events for a different board than the token belongs to', async () => {
    await seedPipeline(ctx.db);
    const body = trelloFixtureBody('updateCard-move', (d) => {
      d.action.data.board.id = '5f1a2b3c4d5e6f7a8b9c0d2f';
    });
    const res = await postWebhook(ctx.app, body);
    expect(res.json()).toEqual({ ok: true, result: 'ignored' });
    const events = await allEvents();
    expect(events[0]).toMatchObject({ outcome: 'ignored', ignoreReason: 'board_mismatch' });
    expect(await allNotifications()).toHaveLength(0);
  });

  it('ignores card creation and other unsupported actions but still records them', async () => {
    await seedPipeline(ctx.db);
    for (const name of ['createCard', 'copyCard', 'updateCard-rename']) {
      const res = await postWebhook(ctx.app, trelloFixtureBody(name));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, result: 'ignored' });
    }
    const events = await allEvents();
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.ignoreReason === 'unsupported_action')).toBe(true);
    expect(await allNotifications()).toHaveLength(0);
  });

  it('records why nothing fired: no mapping, mapping disabled, board disabled, guild disabled', async () => {
    const seeded = await seedPipeline(ctx.db);
    const intoList1 = trelloFixtureBody('updateCard-move', (d) => {
      d.action.id = '64a1b2c3d4e5f60718293a01';
      d.action.data.listAfter = { id: TRELLO.list1, name: 'Script Writer Ready' };
    });
    await postWebhook(ctx.app, intoList1);

    await ctx.db
      .update(listMappings)
      .set({ enabled: false })
      .where(eq(listMappings.id, seeded.mappingId));
    await postWebhook(
      ctx.app,
      trelloFixtureBody('updateCard-move', (d) => (d.action.id = '64a1b2c3d4e5f60718293a02')),
    );

    await ctx.db
      .update(listMappings)
      .set({ enabled: true })
      .where(eq(listMappings.id, seeded.mappingId));
    await ctx.db.update(boards).set({ enabled: false }).where(eq(boards.id, seeded.boardId));
    await postWebhook(
      ctx.app,
      trelloFixtureBody('updateCard-move', (d) => (d.action.id = '64a1b2c3d4e5f60718293a03')),
    );

    await ctx.db.update(boards).set({ enabled: true }).where(eq(boards.id, seeded.boardId));
    await ctx.db.update(guilds).set({ enabled: false }).where(eq(guilds.id, seeded.guildId));
    await postWebhook(
      ctx.app,
      trelloFixtureBody('updateCard-move', (d) => (d.action.id = '64a1b2c3d4e5f60718293a04')),
    );

    const reasons = (await allEvents()).map((e) => e.ignoreReason).sort();
    expect(reasons).toEqual(['board_disabled', 'guild_disabled', 'mapping_disabled', 'no_mapping']);
    expect(await allNotifications()).toHaveLength(0);
  });

  it('stores a failed notification with a clear error when the role has no target in this server', async () => {
    await seedPipeline(ctx.db, { roleTarget: null });
    const res = await postWebhook(ctx.app, moveBody());
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });
    const rows = await allNotifications();
    expect(rows[0]).toMatchObject({
      status: 'failed',
      mentionsJson: [],
      lastError: 'Role Editor (editor) has no Discord mention target configured for this server',
    });
    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent).toHaveLength(0);
  });

  it('retries transient Discord errors with backoff and eventually sends', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, moveBody());
    const transient = () =>
      new DiscordRequestError(502, null, 'Sending the Discord message: HTTP 502', true);
    ctx.discord.sendFailures = [transient(), transient(), null];

    await ctx.app.worker.processOnce();
    let [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row!.lastError).toContain('502');
    expect(row!.nextAttemptAt.getTime()).toBe(ctx.clock.now().getTime() + 5_000);

    // not due yet
    expect(await ctx.app.worker.processOnce()).toBe(0);

    ctx.clock.advance(5_000);
    await ctx.app.worker.processOnce();
    [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'pending', attempts: 2 });
    expect(row!.nextAttemptAt.getTime()).toBe(ctx.clock.now().getTime() + 30_000);

    ctx.clock.advance(30_000);
    await ctx.app.worker.processOnce();
    [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'sent', attempts: 3, mentionVerified: true });
    expect(ctx.discord.sent).toHaveLength(1);
    expect(ctx.alerts.events).toHaveLength(0);
  });

  it('gives up after the maximum number of attempts and alerts', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, moveBody());
    const transient = () =>
      new DiscordRequestError(503, null, 'Sending the Discord message: HTTP 503', true);
    ctx.discord.sendFailures = [
      transient(),
      transient(),
      transient(),
      transient(),
      transient(),
      transient(),
    ];
    for (let i = 0; i < 6; i += 1) {
      await ctx.app.worker.processOnce();
      ctx.clock.advance(60 * 60_000);
    }
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
    expect(ctx.alerts.events).toHaveLength(1);
    expect(ctx.alerts.events[0]).toMatchObject({ kind: 'notification' });
    expect(ctx.discord.sent).toHaveLength(0);
  });

  it('fails immediately on a permission error and alerts', async () => {
    await seedPipeline(ctx.db, { channelId: IDS.privateChannel });
    // make the private channel invisible to the bot by removing its overwrite
    const guild = ctx.discord.guilds.get(IDS.guild)!;
    const priv = guild.channels.find((c) => c.id === IDS.privateChannel)!;
    priv.overwrites = priv.overwrites!.filter((o) => o.id !== IDS.botUser);

    await postWebhook(ctx.app, moveBody());
    await ctx.app.worker.processOnce();
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row!.lastError).toContain('Missing access');
    expect(ctx.alerts.events).toHaveLength(1);
  });

  it('marks the notification sent_no_mention when Discord did not register the role ping', async () => {
    await seedPipeline(ctx.db, { roleTarget: { kind: 'role', id: IDS.quietRole } });
    await postWebhook(ctx.app, moveBody());
    await ctx.app.worker.processOnce();
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'sent_no_mention', mentionVerified: false, attempts: 1 });
    expect(row!.discordMessageId).not.toBeNull();
    expect(ctx.alerts.events).toHaveLength(1);
    expect(ctx.alerts.events[0]!.summary).toMatch(/did not notify the role/);
  });

  it('verifies a role ping when the role is mentionable', async () => {
    await seedPipeline(ctx.db, { roleTarget: { kind: 'role', id: IDS.editorsRole } });
    await postWebhook(ctx.app, moveBody());
    await ctx.app.worker.processOnce();
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'sent', mentionVerified: true });
    expect(ctx.discord.sent[0]!.allowedMentions).toEqual({ parse: [], roles: [IDS.editorsRole] });
  });

  it('verifies a non-mentionable role ping when the bot may mention everyone', async () => {
    ctx.discord.guilds.clear();
    seedFakeDiscord(ctx.discord, { botCanMentionEveryone: true });
    await seedPipeline(ctx.db, { roleTarget: { kind: 'role', id: IDS.quietRole } });
    await postWebhook(ctx.app, moveBody());
    await ctx.app.worker.processOnce();
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'sent', mentionVerified: true });
  });

  it('uses the mapping overrides for channel and mention', async () => {
    await seedPipeline(ctx.db, {
      mappingOverride: {
        overrideMentionKind: 'role',
        overrideMentionId: IDS.editorsRole,
        overrideChannelId: IDS.privateChannel,
      },
    });
    await postWebhook(ctx.app, moveBody());
    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent[0]).toMatchObject({
      channelId: IDS.privateChannel,
      content: `<@&${IDS.editorsRole}> — NFL Week 3 recap is ready for editing`,
    });
  });

  it('requeues rows stuck in sending after a crash', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, moveBody());
    const [row] = await allNotifications();
    await ctx.db
      .update(notifications)
      .set({ status: 'sending', lockedAt: new Date(ctx.clock.now().getTime() - 10 * 60_000) })
      .where(eq(notifications.id, row!.id));

    await ctx.app.worker.processOnce();
    const [after] = await allNotifications();
    expect(after).toMatchObject({ status: 'sent' });
    expect(ctx.discord.sent).toHaveLength(1);
  });

  it('never sends a claimed row twice even when processOnce runs concurrently', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, moveBody());
    await Promise.all([ctx.app.worker.processOnce(), ctx.app.worker.processOnce()]);
    expect(ctx.discord.sent).toHaveLength(1);
    const [row] = await allNotifications();
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
  });
});

describe('webhook rate limit', () => {
  it('throttles a flood of bad requests from one IP', async () => {
    await seedPipeline(ctx.db);
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (await postWebhook(ctx.app, moveBody(), { signature: 'bad' })).statusCode;
    }
    expect(last).toBe(429);
    // …without affecting the config API
    expect((await ctx.app.fastify.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(
      200,
    );
  });
});

describe('revision comments', () => {
  const CARD = '64a00000000000000000c001';
  const PLAIN_COMMENT_ID = '64a1b2c3d4e5f60718293a53';
  const REVISION_COMMENT_ID = '64a1b2c3d4e5f60718293a60';

  /** An updateComment delivery for `commentId` going from `oldText` to `newText`. */
  const editBody = (actionId: string, commentId: string, oldText: string, newText: string) =>
    trelloFixtureBody('updateComment-add-prefix', (d) => {
      d.action.id = actionId;
      d.action.data.action = { id: commentId, text: newText };
      d.action.data.old = { text: oldText };
    });

  async function ignoreReasons() {
    return (await allEvents()).map((e) => e.ignoreReason);
  }

  it("pings the role that owns the card's list, in that stage's channel, with the feedback message", async () => {
    await seedPipeline(ctx.db);
    const res = await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });

    const [n] = await allNotifications();
    expect(n).toMatchObject({
      status: 'pending',
      triggerType: 'commentCard',
      trelloActionId: REVISION_COMMENT_ID,
      trelloCommentId: REVISION_COMMENT_ID,
      listId: TRELLO.list2,
      listName: 'NFL editor ready',
      actorName: 'Mike QC',
      discordChannelId: IDS.channel,
      content: `<@${IDS.editorUser}> — feedback added for NFL Week 3 recap by Mike QC: Tighten the intro and fix the score in the title.`,
      allowedMentionsJson: { parse: [], users: [IDS.editorUser] },
    });
    // The list came with the payload: no Trello call needed.
    expect(ctx.trello.calls).not.toContain(`getCardList:${CARD}`);

    await ctx.app.worker.processOnce();
    expect(ctx.discord.sent).toHaveLength(1);
    expect((await allNotifications())[0]).toMatchObject({ status: 'sent', mentionVerified: true });
  });

  it('ignores comments without the "comment:" prefix', async () => {
    await seedPipeline(ctx.db);
    const res = await postWebhook(ctx.app, trelloFixtureBody('commentCard'));
    expect(res.json()).toEqual({ ok: true, result: 'ignored' });
    expect(await ignoreReasons()).toEqual(['not_revision_comment']);
    expect(await allNotifications()).toHaveLength(0);
  });

  it("pings once when QC edits a plain comment to add the prefix, looking up the card's list", async () => {
    await seedPipeline(ctx.db);
    ctx.trello.cardLists.set(CARD, { id: TRELLO.list2, name: 'NFL editor ready' });
    await postWebhook(ctx.app, trelloFixtureBody('commentCard'));
    const res = await postWebhook(ctx.app, trelloFixtureBody('updateComment-add-prefix'));
    expect(res.json()).toEqual({ ok: true, result: 'enqueued' });
    expect(ctx.trello.calls).toContain(`getCardList:${CARD}`);

    const rows = await allNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      triggerType: 'updateComment',
      trelloCommentId: PLAIN_COMMENT_ID,
      listName: 'NFL editor ready',
      content: `<@${IDS.editorUser}> — feedback added for NFL Week 3 recap by Mike QC: Looks good, but fix the score`,
    });
    expect(await ignoreReasons()).toEqual(['not_revision_comment', null]);
  });

  it('does not ping again when a comment that already had the prefix is edited', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));
    const edit = editBody(
      '64a1b2c3d4e5f60718293a70',
      REVISION_COMMENT_ID,
      'comment: Tighten the intro and fix the score in the title.',
      'comment: Tighten the intro, fix the score and the thumbnail.',
    );
    expect((await postWebhook(ctx.app, edit)).json()).toEqual({ ok: true, result: 'ignored' });
    expect(await ignoreReasons()).toEqual([null, 'prefix_already_present']);
    expect(await allNotifications()).toHaveLength(1);
    expect(ctx.trello.calls).not.toContain(`getCardList:${CARD}`);
  });

  it('pings at most once per comment, even if the prefix is removed and added back', async () => {
    await seedPipeline(ctx.db);
    ctx.trello.cardLists.set(CARD, { id: TRELLO.list2, name: 'NFL editor ready' });
    await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));
    const text = 'Tighten the intro and fix the score in the title.';
    await postWebhook(
      ctx.app,
      editBody('64a1b2c3d4e5f60718293a71', REVISION_COMMENT_ID, `comment: ${text}`, text),
    );
    await postWebhook(
      ctx.app,
      editBody('64a1b2c3d4e5f60718293a72', REVISION_COMMENT_ID, text, `comment: ${text}`),
    );
    expect(await ignoreReasons()).toEqual([
      null,
      'not_revision_comment',
      'comment_already_notified',
    ]);
    expect(await allNotifications()).toHaveLength(1);
  });

  it('treats Trello redeliveries of a comment as duplicates', async () => {
    await seedPipeline(ctx.db);
    await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));
    const again = await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));
    expect(again.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(await allNotifications()).toHaveLength(1);
  });

  it("uses the mapping's comment template, else the default from Settings", async () => {
    const seeded = await seedPipeline(ctx.db);
    await setSetting(ctx.db, SETTING_DEFAULT_COMMENT_TEMPLATE, '{mention} fix {card_title}');
    await postWebhook(ctx.app, trelloFixtureBody('commentCard-revision'));

    await ctx.db
      .update(listMappings)
      .set({
        commentTemplate: '{mention} — QC notes on {card_title} ({list_name}): {comment_text}',
      })
      .where(eq(listMappings.id, seeded.mappingId));
    const second = trelloFixtureBody('commentCard-revision', (d) => {
      d.action.id = '64a1b2c3d4e5f60718293a62';
      d.action.data.text = 'COMMENT: Audio is too loud';
    });
    await postWebhook(ctx.app, second);

    expect((await allNotifications()).map((n) => n.content)).toEqual([
      `<@${IDS.editorUser}> fix NFL Week 3 recap`,
      `<@${IDS.editorUser}> — QC notes on NFL Week 3 recap (NFL editor ready): Audio is too loud`,
    ]);
  });

  it('does not ping for a revision comment on a card in an unmapped or disabled list', async () => {
    const seeded = await seedPipeline(ctx.db);
    const inList1 = trelloFixtureBody('commentCard-revision', (d) => {
      d.action.data.list = { id: TRELLO.list1, name: 'Script Writer Ready' };
    });
    await postWebhook(ctx.app, inList1);
    await ctx.db
      .update(listMappings)
      .set({ enabled: false })
      .where(eq(listMappings.id, seeded.mappingId));
    const inList2 = trelloFixtureBody('commentCard-revision', (d) => {
      d.action.id = '64a1b2c3d4e5f60718293a63';
    });
    await postWebhook(ctx.app, inList2);
    expect(await ignoreReasons()).toEqual(['no_mapping', 'mapping_disabled']);
    expect(await allNotifications()).toHaveLength(0);
  });

  it('records card_list_unknown when Trello no longer knows the edited card', async () => {
    await seedPipeline(ctx.db);
    const res = await postWebhook(ctx.app, trelloFixtureBody('updateComment-add-prefix'));
    expect(res.json()).toEqual({ ok: true, result: 'ignored' });
    expect(await ignoreReasons()).toEqual(['card_list_unknown']);
  });

  it('answers 502 when the list lookup fails, so Trello redelivers, then pings on redelivery', async () => {
    await seedPipeline(ctx.db);
    ctx.trello.cardLists.set(CARD, { id: TRELLO.list2, name: 'NFL editor ready' });
    vi.spyOn(ctx.trello, 'getCardList').mockRejectedValueOnce(
      new TrelloApiError(503, 'unavailable', "Fetching the card's list"),
    );
    const failed = await postWebhook(ctx.app, trelloFixtureBody('updateComment-add-prefix'));
    expect(failed.statusCode).toBe(502);
    expect(await allEvents()).toHaveLength(0);

    const retried = await postWebhook(ctx.app, trelloFixtureBody('updateComment-add-prefix'));
    expect(retried.json()).toEqual({ ok: true, result: 'enqueued' });
    expect(await allNotifications()).toHaveLength(1);
  });
});

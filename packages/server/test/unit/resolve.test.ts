import { describe, expect, it } from 'vitest';
import {
  COMMENT_TEXT_LIMIT,
  resolve,
  resolveComment,
  type ResolveCommentInput,
  type ResolveInput,
} from '../../src/notifications/resolve';
import { normalizeAction } from '../../src/trello/normalize';
import { trelloFixture } from '../helpers/fixtures';

const movedEvent = (() => {
  const r = normalizeAction(trelloFixture('updateCard-move'));
  if (r.kind !== 'moved') throw new Error('fixture must be a move');
  return r.event;
})();

function base(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    event: movedEvent,
    board: { id: 1, enabled: true, discordChannelId: '300000000000000000', name: 'SPORTS' },
    guild: { id: 1, enabled: true },
    mapping: {
      id: 10,
      enabled: true,
      roleId: 5,
      teamId: null,
      messageTemplate: '{mention} — {card_title} is ready for editing',
      overrideMentionKind: null,
      overrideMentionId: null,
      overrideChannelId: null,
    },
    recipient: {
      label: 'Role Editor (editor)',
      targets: [{ kind: 'user', id: '400000000000000000' }],
    },
    ...overrides,
  };
}

describe('resolve', () => {
  it('notifies with the global role target and the board channel', () => {
    const r = resolve(base());
    expect(r).toMatchObject({
      kind: 'notify',
      channelId: '300000000000000000',
      mentions: [{ kind: 'user', id: '400000000000000000' }],
      content: '<@400000000000000000> — NFL Week 3 recap is ready for editing',
      allowedMentions: { parse: [], users: ['400000000000000000'] },
      missingTargetError: null,
    });
  });

  it('lets the mapping override win over the role target, and the channel override over the board channel', () => {
    const r = resolve(
      base({
        mapping: {
          ...base().mapping!,
          overrideMentionKind: 'role',
          overrideMentionId: '500000000000000000',
          overrideChannelId: '600000000000000000',
        },
      }),
    );
    expect(r).toMatchObject({
      kind: 'notify',
      channelId: '600000000000000000',
      mentions: [{ kind: 'role', id: '500000000000000000' }],
      allowedMentions: { parse: [], roles: ['500000000000000000'] },
    });
    if (r.kind === 'notify') expect(r.content.startsWith('<@&500000000000000000>')).toBe(true);
  });

  it('ignores when the guild or board is disabled, when there is no mapping, or the mapping is disabled', () => {
    expect(resolve(base({ guild: { id: 1, enabled: false } }))).toEqual({
      kind: 'ignore',
      reason: 'guild_disabled',
    });
    expect(resolve(base({ board: { ...base().board, enabled: false } }))).toEqual({
      kind: 'ignore',
      reason: 'board_disabled',
    });
    expect(resolve(base({ mapping: null }))).toEqual({ kind: 'ignore', reason: 'no_mapping' });
    expect(resolve(base({ mapping: { ...base().mapping!, enabled: false } }))).toEqual({
      kind: 'ignore',
      reason: 'mapping_disabled',
    });
  });

  it('still notifies but reports a missing target when the role has none in this guild', () => {
    const r = resolve(base({ recipient: { label: 'Role Editor (editor)', targets: [] } }));
    expect(r.kind).toBe('notify');
    if (r.kind !== 'notify') return;
    expect(r.mentions).toEqual([]);
    expect(r.missingTargetError).toMatch(/Editor \(editor\) has no Discord mention target/);
    expect(r.content).toBe(' — NFL Week 3 recap is ready for editing');
    expect(r.allowedMentions).toEqual({ parse: [] });
  });

  it('pings every member of a team in one message', () => {
    const r = resolve(
      base({
        mapping: { ...base().mapping!, roleId: null, teamId: 7 },
        recipient: {
          label: 'Team Sports',
          targets: [
            { kind: 'user', id: '400000000000000000' },
            { kind: 'role', id: '500000000000000000' },
            { kind: 'user', id: '410000000000000000' },
          ],
        },
      }),
    );
    expect(r).toMatchObject({
      kind: 'notify',
      content:
        '<@400000000000000000> <@&500000000000000000> <@410000000000000000> — NFL Week 3 recap is ready for editing',
      allowedMentions: {
        parse: [],
        users: ['400000000000000000', '410000000000000000'],
        roles: ['500000000000000000'],
      },
      missingTargetError: null,
    });
  });

  it('a mention override replaces the whole team', () => {
    const r = resolve(
      base({
        mapping: {
          ...base().mapping!,
          roleId: null,
          teamId: 7,
          overrideMentionKind: 'user',
          overrideMentionId: '420000000000000000',
        },
        recipient: { label: 'Team Sports', targets: [{ kind: 'user', id: '400000000000000000' }] },
      }),
    );
    expect(r).toMatchObject({ mentions: [{ kind: 'user', id: '420000000000000000' }] });
  });

  it('reports a team where nobody has a target in this guild', () => {
    const r = resolve(
      base({
        mapping: { ...base().mapping!, roleId: null, teamId: 7 },
        recipient: { label: 'Team Sports', targets: [] },
      }),
    );
    if (r.kind !== 'notify') throw new Error('expected notify');
    expect(r.missingTargetError).toBe(
      'Team Sports has no Discord mention target configured for this server',
    );
  });

  it('exposes every template variable', () => {
    const r = resolve(
      base({
        mapping: {
          ...base().mapping!,
          messageTemplate:
            '{mention}|{card_title}|{card_url}|{list_name}|{previous_list_name}|{board_name}|{moved_by}',
        },
      }),
    );
    if (r.kind !== 'notify') throw new Error('expected notify');
    expect(r.content).toBe(
      '<@400000000000000000>|NFL Week 3 recap|https://trello.com/c/AbCdEf12|NFL editor ready|Script Writer Ready|SPORTS|Jane Doe',
    );
  });
});

describe('resolveComment', () => {
  const commentEvent = (() => {
    const r = normalizeAction(trelloFixture('commentCard-revision'));
    if (r.kind !== 'commented') throw new Error('fixture must be a comment');
    return r.event;
  })();

  function commentInput(overrides: Partial<ResolveCommentInput> = {}): ResolveCommentInput {
    const { event: _event, ...rest } = base();
    return {
      ...rest,
      event: commentEvent,
      list: { id: '64a00000000000000000a002', name: 'NFL editor ready' },
      feedback: 'Tighten the intro',
      defaultCommentTemplate: '{mention} — feedback added for {card_title}: {comment_text}',
      ...overrides,
    };
  }

  it("uses the default comment template when the mapping has none, with the mapping's target and channel", () => {
    const r = resolveComment(
      commentInput({
        mapping: { ...base().mapping!, overrideChannelId: '600000000000000000' },
      }),
    );
    expect(r).toMatchObject({
      kind: 'notify',
      channelId: '600000000000000000',
      content: '<@400000000000000000> — feedback added for NFL Week 3 recap: Tighten the intro',
    });
  });

  it('exposes every comment variable and prefers the mapping comment template', () => {
    const r = resolveComment(
      commentInput({
        mapping: {
          ...base().mapping!,
          commentTemplate:
            '{mention}|{card_title}|{card_url}|{list_name}|{board_name}|{commented_by}|{comment_text}|{moved_by}',
        },
      }),
    );
    if (r.kind !== 'notify') throw new Error('expected notify');
    expect(r.content).toBe(
      '<@400000000000000000>|NFL Week 3 recap|https://trello.com/c/AbCdEf12|NFL editor ready|SPORTS|Mike QC|Tighten the intro|',
    );
  });

  it('cuts long feedback so the message stays within one Discord message', () => {
    const r = resolveComment(commentInput({ feedback: 'x'.repeat(5000) }));
    if (r.kind !== 'notify') throw new Error('expected notify');
    expect(r.vars.comment_text).toHaveLength(COMMENT_TEXT_LIMIT);
    expect(r.vars.comment_text!.endsWith('…')).toBe(true);
  });

  it("pings the feedback recipient instead of the list's own audience, override included", () => {
    const mapping = {
      ...base().mapping!,
      overrideMentionKind: 'role' as const,
      overrideMentionId: '500000000000000000',
      overrideChannelId: '600000000000000000',
      feedbackRoleId: 7,
    };
    const r = resolveComment(
      commentInput({
        mapping,
        feedbackRecipient: {
          label: 'Role Editor (editor)',
          targets: [{ kind: 'user', id: '410000000000000000' }],
        },
      }),
    );
    expect(r).toMatchObject({
      kind: 'notify',
      channelId: '600000000000000000',
      mentions: [{ kind: 'user', id: '410000000000000000' }],
      content: '<@410000000000000000> — feedback added for NFL Week 3 recap: Tighten the intro',
    });
    // nobody to ping: stored as failed, naming the feedback recipient
    const empty = resolveComment(
      commentInput({ mapping, feedbackRecipient: { label: 'Team Editors', targets: [] } }),
    );
    if (empty.kind !== 'notify') throw new Error('expected notify');
    expect(empty.missingTargetError).toBe(
      'Feedback recipient Team Editors has no Discord mention target configured for this server',
    );
  });

  it('applies the same mapping checks as moves', () => {
    expect(resolveComment(commentInput({ mapping: null }))).toEqual({
      kind: 'ignore',
      reason: 'no_mapping',
    });
  });
});

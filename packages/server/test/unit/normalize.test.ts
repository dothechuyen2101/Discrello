import { describe, expect, it } from 'vitest';
import { normalizeAction } from '../../src/trello/normalize';
import { trelloFixture } from '../helpers/fixtures';

describe('normalizeAction', () => {
  it('turns a list move into a CardMoved event', () => {
    const result = normalizeAction(trelloFixture('updateCard-move'));
    expect(result.kind).toBe('moved');
    if (result.kind !== 'moved') return;
    expect(result.event).toEqual({
      actionId: '64a1b2c3d4e5f60718293a4b',
      actionType: 'updateCard',
      occurredAt: '2026-09-24T01:02:03.000Z',
      board: { id: '5f1a2b3c4d5e6f7a8b9c0d1e', name: 'SPORTS' },
      list: { id: '64a00000000000000000a002', name: 'NFL editor ready' },
      previousList: { id: '64a00000000000000000a001', name: 'Script Writer Ready' },
      card: {
        id: '64a00000000000000000c001',
        name: 'NFL Week 3 recap',
        shortLink: 'AbCdEf12',
        url: 'https://trello.com/c/AbCdEf12',
      },
      actor: { id: '5a1b2c3d4e5f60718293a4b5', username: 'jane', fullName: 'Jane Doe' },
    });
  });

  it('treats a card moved in from another board as a move with no previous list', () => {
    const result = normalizeAction(trelloFixture('moveCardToBoard'));
    expect(result.kind).toBe('moved');
    if (result.kind !== 'moved') return;
    expect(result.event.list).toEqual({ id: '64a00000000000000000a002', name: 'NFL editor ready' });
    expect(result.event.previousList).toBeNull();
    expect(result.event.card.url).toBe('https://trello.com/c/MoVeDiN1');
  });

  it.each([
    'updateCard-rename',
    'updateCard-archive',
    'createCard',
    'copyCard',
    'convertToCardFromCheckItem',
    'moveCardFromBoard',
    'updateList',
  ])('ignores %s as unsupported_action', (name) => {
    const result = normalizeAction(trelloFixture(name));
    expect(result).toMatchObject({ kind: 'ignored', reason: 'unsupported_action' });
  });

  it('normalizes a new comment, with the list the card is in', () => {
    const result = normalizeAction(trelloFixture('commentCard-revision'));
    expect(result.kind).toBe('commented');
    if (result.kind !== 'commented') return;
    expect(result.event).toEqual({
      actionId: '64a1b2c3d4e5f60718293a60',
      actionType: 'commentCard',
      occurredAt: '2026-10-11T01:10:00.000Z',
      commentId: '64a1b2c3d4e5f60718293a60',
      text: 'comment: Tighten the intro and fix the score in the title.',
      previousText: null,
      board: { id: '5f1a2b3c4d5e6f7a8b9c0d1e', name: 'SPORTS' },
      list: { id: '64a00000000000000000a002', name: 'NFL editor ready' },
      card: {
        id: '64a00000000000000000c001',
        name: 'NFL Week 3 recap',
        shortLink: 'AbCdEf12',
        url: 'https://trello.com/c/AbCdEf12',
      },
      actor: { id: '5a1b2c3d4e5f60718293a4b6', username: 'qcmike', fullName: 'Mike QC' },
    });
  });

  it('normalizes a comment edit: the original comment id, new and old text, no list', () => {
    const result = normalizeAction(trelloFixture('updateComment-add-prefix'));
    expect(result.kind).toBe('commented');
    if (result.kind !== 'commented') return;
    expect(result.event).toMatchObject({
      actionId: '64a1b2c3d4e5f60718293a61',
      actionType: 'updateComment',
      commentId: '64a1b2c3d4e5f60718293a53',
      text: 'Comment: Looks good, but fix the score',
      previousText: 'Looks good',
      list: null,
    });
  });

  it('falls back to the edit action id when Trello omits the comment id', () => {
    const doc = trelloFixture<any>('updateComment-add-prefix');
    delete doc.action.data.action.id;
    delete doc.action.data.old;
    const result = normalizeAction(doc);
    expect(result).toMatchObject({
      kind: 'commented',
      event: { commentId: '64a1b2c3d4e5f60718293a61', previousText: null },
    });
  });

  it('flags comments without text or card as malformed', () => {
    const noText = trelloFixture<any>('commentCard');
    delete noText.action.data.text;
    expect(normalizeAction(noText)).toMatchObject({ kind: 'ignored', reason: 'malformed' });
    const noCard = trelloFixture<any>('updateComment-add-prefix');
    delete noCard.action.data.card;
    expect(normalizeAction(noCard)).toMatchObject({ kind: 'ignored', reason: 'malformed' });
  });

  it('flags malformed payloads', () => {
    expect(normalizeAction({})).toMatchObject({ kind: 'ignored', reason: 'malformed' });
    expect(normalizeAction(null)).toMatchObject({ kind: 'ignored', reason: 'malformed' });
    expect(normalizeAction({ action: { id: 'x', type: 'updateCard' } })).toMatchObject({
      kind: 'ignored',
      reason: 'malformed',
    });
    // A move without a card is malformed rather than silently accepted
    const doc = trelloFixture<any>('updateCard-move');
    delete doc.action.data.card;
    expect(normalizeAction(doc)).toMatchObject({ kind: 'ignored', reason: 'malformed' });
  });

  it('falls back to the card id for the URL when there is no short link', () => {
    const doc = trelloFixture<any>('updateCard-move');
    delete doc.action.data.card.shortLink;
    const result = normalizeAction(doc);
    if (result.kind !== 'moved') throw new Error('expected moved');
    expect(result.event.card.url).toBe('https://trello.com/c/64a00000000000000000c001');
  });
});

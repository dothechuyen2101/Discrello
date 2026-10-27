import { describe, expect, it } from 'vitest';
import { parseTrelloBoardRef } from '../src/trello-ref';

describe('parseTrelloBoardRef', () => {
  it('accepts a board URL with short link', () => {
    expect(parseTrelloBoardRef('https://trello.com/b/AbCd1234/sports-board')).toEqual({
      idOrShortLink: 'AbCd1234',
    });
  });
  it('accepts a bare short link and a 24-hex id', () => {
    expect(parseTrelloBoardRef('AbCd1234')).toEqual({ idOrShortLink: 'AbCd1234' });
    expect(parseTrelloBoardRef('5f1a2b3c4d5e6f7a8b9c0d1e')).toEqual({
      idOrShortLink: '5f1a2b3c4d5e6f7a8b9c0d1e',
    });
  });
  it('rejects garbage', () => {
    expect(() => parseTrelloBoardRef('not a board')).toThrow();
    expect(() => parseTrelloBoardRef('https://example.com/b/AbCd1234')).toThrow();
    expect(() => parseTrelloBoardRef('https://trello.com/c/AbCd1234/card')).toThrow();
  });
});

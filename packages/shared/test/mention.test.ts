import { describe, expect, it } from 'vitest';
import {
  allowedMentionsFor,
  formatMention,
  formatMentions,
  isSnowflake,
  uniqueMentions,
} from '../src/mention';

describe('mention helpers', () => {
  it('formats user and role mentions', () => {
    expect(formatMention({ kind: 'user', id: '123456789012345678' })).toBe('<@123456789012345678>');
    expect(formatMention({ kind: 'role', id: '123456789012345678' })).toBe(
      '<@&123456789012345678>',
    );
  });

  it('builds explicit allowed_mentions with parse always empty', () => {
    expect(allowedMentionsFor({ kind: 'user', id: '1' })).toEqual({ parse: [], users: ['1'] });
    expect(allowedMentionsFor({ kind: 'role', id: '2' })).toEqual({ parse: [], roles: ['2'] });
    expect(allowedMentionsFor(null)).toEqual({ parse: [] });
  });

  it('pings every member of a team in one message', () => {
    const team = [
      { kind: 'user' as const, id: '1' },
      { kind: 'role' as const, id: '2' },
      { kind: 'user' as const, id: '3' },
    ];
    expect(formatMentions(team)).toBe('<@1> <@&2> <@3>');
    expect(allowedMentionsFor(team)).toEqual({ parse: [], users: ['1', '3'], roles: ['2'] });
    expect(allowedMentionsFor([])).toEqual({ parse: [] });
    expect(formatMentions([])).toBe('');
  });

  it('drops repeated targets but keeps a user and a role that share an id apart', () => {
    expect(
      uniqueMentions([
        { kind: 'user', id: '1' },
        { kind: 'role', id: '1' },
        { kind: 'user', id: '1' },
      ]),
    ).toEqual([
      { kind: 'user', id: '1' },
      { kind: 'role', id: '1' },
    ]);
  });

  it('validates snowflakes', () => {
    expect(isSnowflake('123456789012345678')).toBe(true);
    expect(isSnowflake('12345')).toBe(false);
    expect(isSnowflake('abc')).toBe(false);
  });
});

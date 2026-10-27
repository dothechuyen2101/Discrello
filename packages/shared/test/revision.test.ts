import { describe, expect, it } from 'vitest';
import { parseRevisionComment } from '../src/revision';

describe('parseRevisionComment', () => {
  it.each([
    ['comment: fix the intro', 'fix the intro'],
    ['Comment: fix the intro', 'fix the intro'],
    ['COMMENT:fix the intro', 'fix the intro'],
    ['  \n comment:  fix the intro  ', 'fix the intro'],
    ['comment: line one\nline two', 'line one\nline two'],
    ['comment:', ''],
  ])('treats %j as a revision comment', (text, feedback) => {
    expect(parseRevisionComment(text)).toBe(feedback);
  });

  it.each([
    'Looks good',
    'fix the intro, comment: later',
    'comments: plural is not the prefix',
    'comment fix the intro',
    '',
  ])('ignores %j', (text) => {
    expect(parseRevisionComment(text)).toBeNull();
  });
});

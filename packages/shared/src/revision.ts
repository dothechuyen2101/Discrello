/**
 * Revision comments: a Trello comment counts as revision feedback only when it starts with this
 * prefix. Case and leading whitespace are ignored, so "Comment: fix the intro" counts too.
 */
export const REVISION_PREFIX = 'comment:';

/** The feedback without the prefix when `text` is a revision comment, otherwise null. */
export function parseRevisionComment(text: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed.slice(0, REVISION_PREFIX.length).toLowerCase() !== REVISION_PREFIX) return null;
  return trimmed.slice(REVISION_PREFIX.length).trim();
}

export type MentionKind = 'user' | 'role';

export interface MentionTarget {
  kind: MentionKind;
  id: string;
}

/**
 * Discord `allowed_mentions` payload. `parse` is always empty so that nothing in the card
 * title (e.g. "@everyone") can ping anyone; only the configured target is whitelisted.
 */
export interface AllowedMentions {
  parse: [];
  users?: string[];
  roles?: string[];
}

const SNOWFLAKE = /^\d{17,20}$/;

export function isSnowflake(value: string): boolean {
  return SNOWFLAKE.test(value);
}

export function formatMention(target: MentionTarget): string {
  return target.kind === 'role' ? `<@&${target.id}>` : `<@${target.id}>`;
}

/** A team pings every member at once: "<@1> <@2> <@&3>". */
export function formatMentions(targets: readonly MentionTarget[]): string {
  return targets.map(formatMention).join(' ');
}

/** Drops repeats (two team members sharing one Discord role), keeping the first occurrence. */
export function uniqueMentions(targets: readonly MentionTarget[]): MentionTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = `${t.kind}:${t.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function allowedMentionsFor(
  targets: MentionTarget | readonly MentionTarget[] | null,
): AllowedMentions {
  const list = !targets ? [] : 'kind' in targets ? [targets] : targets;
  const users = [...new Set(list.filter((t) => t.kind === 'user').map((t) => t.id))];
  const roles = [...new Set(list.filter((t) => t.kind === 'role').map((t) => t.id))];
  return {
    parse: [],
    ...(users.length ? { users } : {}),
    ...(roles.length ? { roles } : {}),
  };
}

export function mentionTargetsEqual(a: MentionTarget | null, b: MentionTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

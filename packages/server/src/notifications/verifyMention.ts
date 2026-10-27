import type { MentionTarget } from '@discrello/shared';

/** The parts of the Discord message object we look at after sending. */
export interface SentMessageLike {
  id: string;
  mentions?: Array<{ id: string }>;
  mention_roles?: string[];
}

export interface MentionCheck {
  /** true = everyone was pinged, false = at least one was not, null = nothing to verify. */
  verified: boolean | null;
  /** The targets Discord did not report as mentioned. */
  missed: MentionTarget[];
}

/**
 * Discord reports which users/roles a message actually mentioned (after `allowed_mentions` and
 * the sender's permissions are applied). A team ping is verified only if every member registered.
 */
export function verifyMentions(
  message: SentMessageLike,
  targets: readonly MentionTarget[],
): MentionCheck {
  if (!targets.length) return { verified: null, missed: [] };
  const users = new Set((message.mentions ?? []).map((u) => u.id));
  const roles = new Set(message.mention_roles ?? []);
  const missed = targets.filter((t) => (t.kind === 'user' ? !users.has(t.id) : !roles.has(t.id)));
  return { verified: missed.length === 0, missed };
}

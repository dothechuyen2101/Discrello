import { and, eq, inArray, isNotNull, like, or, type SQL } from 'drizzle-orm';
import type { Queryable } from '../types';
import { boards, guilds, listMappings, type ListMapping } from '../schema';
import { loadRecipient, recipientProblem, targetsInGuild, type Recipient } from './recipients';

/** Prefix of a mapping's check error caused by its feedback recipient, so it can be told apart. */
export const FEEDBACK_ERROR_PREFIX = 'Feedback: ';

/** The role or team chosen for this list's revision feedback, or null for the list's own recipient. */
export function feedbackRef(
  m: Pick<ListMapping, 'feedbackRoleId' | 'feedbackTeamId'>,
): { roleId: number | null; teamId: number | null } | null {
  if (!m.feedbackRoleId && !m.feedbackTeamId) return null;
  return { roleId: m.feedbackRoleId, teamId: m.feedbackTeamId };
}

export async function loadFeedbackRecipient(
  db: Queryable,
  m: Pick<ListMapping, 'feedbackRoleId' | 'feedbackTeamId'>,
): Promise<Recipient | null> {
  const ref = feedbackRef(m);
  return ref ? loadRecipient(db, ref) : null;
}

/**
 * Lists that use each role or team, either as the list's recipient or as its feedback recipient.
 * A list that uses the same one both ways counts once.
 */
export async function mappingUsage(
  db: Queryable,
  kind: 'role' | 'team',
  ids: number[],
): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const main = kind === 'role' ? listMappings.roleId : listMappings.teamId;
  const feedback = kind === 'role' ? listMappings.feedbackRoleId : listMappings.feedbackTeamId;
  const rows = await db
    .select({ id: listMappings.id, main, feedback })
    .from(listMappings)
    .where(or(inArray(main, ids), inArray(feedback, ids)));
  const lists = new Map<number, Set<number>>();
  for (const r of rows) {
    for (const ref of new Set([r.main, r.feedback])) {
      if (ref === null || !ids.includes(ref)) continue;
      lists.set(ref, (lists.get(ref) ?? new Set()).add(r.id));
    }
  }
  return new Map([...lists].map(([id, set]) => [id, set.size]));
}

/**
 * Re-checks, without calling Discord, the feedback recipient of every mapping that has one (in
 * one server, or all): a mapping is flagged when someone who should receive its feedback has no
 * target there, and a flag set this way is cleared once that is fixed. Errors caused by the list's
 * own recipient are left alone. Call after anything that changes targets or team members.
 */
export async function refreshFeedbackChecks(
  db: Queryable,
  now: Date,
  guildId?: number,
): Promise<void> {
  const conditions: SQL[] = [
    or(isNotNull(listMappings.feedbackRoleId), isNotNull(listMappings.feedbackTeamId))!,
  ];
  if (guildId !== undefined) conditions.push(eq(boards.guildId, guildId));
  const rows = await db
    .select({ m: listMappings, g: guilds })
    .from(listMappings)
    .innerJoin(boards, eq(boards.id, listMappings.boardId))
    .innerJoin(guilds, eq(guilds.id, boards.guildId))
    .where(and(...conditions));
  for (const { m, g } of rows) {
    const recipient = await loadFeedbackRecipient(db, m);
    if (!recipient) continue;
    const problem = recipientProblem(recipient, await targetsInGuild(db, recipient, g.id), g.name);
    const ownError = m.checkStatus === 'error' && !m.checkError?.startsWith(FEEDBACK_ERROR_PREFIX);
    if (problem && !ownError) {
      await db
        .update(listMappings)
        .set({
          checkStatus: 'error',
          checkError: `${FEEDBACK_ERROR_PREFIX}${problem.message}`,
          checkedAt: now,
        })
        .where(eq(listMappings.id, m.id));
    } else if (!problem && m.checkError?.startsWith(FEEDBACK_ERROR_PREFIX)) {
      await db
        .update(listMappings)
        .set({ checkStatus: 'ok', checkError: null, checkedAt: now })
        .where(
          and(
            eq(listMappings.id, m.id),
            like(listMappings.checkError, `${FEEDBACK_ERROR_PREFIX}%`),
          ),
        );
    }
  }
}

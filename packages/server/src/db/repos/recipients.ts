import { and, asc, eq, inArray } from 'drizzle-orm';
import { uniqueMentions, type MentionTarget } from '@discrello/shared';
import type { Queryable } from '../types';
import { roleTargets, roles, teamMembers, teams, type Role, type Team } from '../schema';

/** Who a list mapping pings, before looking at a particular Discord server. */
export type Recipient =
  { kind: 'role'; role: Role } | { kind: 'team'; team: Team; members: Role[] };

export interface RecipientTargets {
  /** The role's target, or one entry per team member that has a target in this server. */
  targets: Array<{ who: Role; target: MentionTarget }>;
  /** The role, or the team members, with no target in this server. */
  missing: Role[];
}

export interface RecipientProblem {
  code: string;
  message: string;
  hint: string;
}

/** "Role Editor (editor)" or "Team Sports", for messages and logs. */
export function recipientLabel(r: Recipient): string {
  return r.kind === 'role' ? `Role ${r.role.displayName} (${r.role.key})` : `Team ${r.team.name}`;
}

/** Display name of whoever is pinged: "Editor" or "Sports". */
export function recipientName(r: Recipient): string {
  return r.kind === 'role' ? r.role.displayName : r.team.name;
}

/** Members of each team, in the order they were added. */
export async function membersOfTeams(
  db: Queryable,
  teamIds: number[],
): Promise<Map<number, Role[]>> {
  const map = new Map<number, Role[]>(teamIds.map((id) => [id, []]));
  if (!teamIds.length) return map;
  const rows = await db
    .select({ teamId: teamMembers.teamId, role: roles })
    .from(teamMembers)
    .innerJoin(roles, eq(roles.id, teamMembers.roleId))
    .where(inArray(teamMembers.teamId, teamIds))
    .orderBy(asc(teamMembers.id));
  for (const { teamId, role } of rows) map.get(teamId)!.push(role);
  return map;
}

export async function loadRecipient(
  db: Queryable,
  ref: { roleId: number | null; teamId: number | null },
): Promise<Recipient | null> {
  if (ref.roleId) {
    const rows = await db.select().from(roles).where(eq(roles.id, ref.roleId)).limit(1);
    return rows[0] ? { kind: 'role', role: rows[0] } : null;
  }
  if (ref.teamId) {
    const rows = await db.select().from(teams).where(eq(teams.id, ref.teamId)).limit(1);
    if (!rows[0]) return null;
    const members = (await membersOfTeams(db, [rows[0].id])).get(rows[0].id) ?? [];
    return { kind: 'team', team: rows[0], members };
  }
  return null;
}

/** The Discord targets of a recipient in one server. */
export async function targetsInGuild(
  db: Queryable,
  recipient: Recipient,
  guildId: number,
): Promise<RecipientTargets> {
  const people = recipient.kind === 'role' ? [recipient.role] : recipient.members;
  if (!people.length) return { targets: [], missing: [] };
  const rows = await db
    .select()
    .from(roleTargets)
    .where(
      and(
        eq(roleTargets.guildId, guildId),
        inArray(
          roleTargets.roleId,
          people.map((p) => p.id),
        ),
      ),
    );
  const byRole = new Map(rows.map((t) => [t.roleId, t]));
  const targets: RecipientTargets['targets'] = [];
  const missing: Role[] = [];
  for (const who of people) {
    const t = byRole.get(who.id);
    if (t) targets.push({ who, target: { kind: t.mentionKind, id: t.mentionId } });
    else missing.push(who);
  }
  return { targets, missing };
}

/** The distinct mentions a recipient produces in one server (what goes into the message). */
export function mentionsOf(resolved: RecipientTargets): MentionTarget[] {
  return uniqueMentions(resolved.targets.map((t) => t.target));
}

/** What the pure resolver needs about a recipient in the board's server. */
export async function recipientForDelivery(
  db: Queryable,
  recipient: Recipient | null,
  guildId: number,
): Promise<{ label: string; targets: MentionTarget[] } | null> {
  if (!recipient) return null;
  return {
    label: recipientLabel(recipient),
    targets: mentionsOf(await targetsInGuild(db, recipient, guildId)),
  };
}

/**
 * Why this recipient cannot ping everyone it should in this server, or null when it can.
 * Saving refuses these (a mention must actually reach someone), and the periodic re-check flags them.
 */
export function recipientProblem(
  recipient: Recipient,
  resolved: RecipientTargets,
  guildName: string,
): RecipientProblem | null {
  if (recipient.kind === 'role') {
    if (resolved.targets.length) return null;
    return {
      code: 'ROLE_HAS_NO_TARGET',
      message: `Role ${recipient.role.displayName} has no Discord target in ${guildName}, so this list could not notify anyone.`,
      hint: "Set the role's Discord user or role for this server on the Roles page, or set an override on this list.",
    };
  }
  if (!recipient.members.length) {
    return {
      code: 'TEAM_HAS_NO_MEMBERS',
      message: `Team ${recipient.team.name} has no members, so this list could not notify anyone.`,
      hint: 'Add people to the team on the Roles page.',
    };
  }
  if (!resolved.missing.length) return null;
  const names = resolved.missing.map((r) => r.displayName).join(', ');
  return {
    code: 'ROLE_HAS_NO_TARGET',
    message: `Team ${recipient.team.name}: ${names} ${resolved.missing.length === 1 ? 'has' : 'have'} no Discord target in ${guildName}.`,
    hint: 'Set their Discord user or role for this server on the Roles page, or remove them from the team.',
  };
}

import { and, asc, count, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type {
  TeamChannelDto,
  TeamChannelInput,
  TeamCreateInput,
  TeamDto,
  TeamPatchInput,
} from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import {
  boards,
  guilds,
  listMappings,
  roleTargets,
  roles,
  teamChannels,
  teamMembers,
  teams,
  trelloLists,
  type Team,
  type TeamChannel,
} from '../db/schema';
import { mappingUsage, refreshFeedbackChecks } from '../db/repos/feedback';
import {
  loadRecipient,
  membersOfTeams,
  recipientProblem,
  targetsInGuild,
} from '../db/repos/recipients';
import type { MentionValidator } from '../discord/validate';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors';

export interface TeamServiceDeps {
  db: Db;
  validator: MentionValidator;
  clock: Clock;
}

/**
 * Teams group roles (people). A list mapped to a team pings every member's target in the board's
 * server, so the same rule as for a single role applies: a member who would not be notified where
 * the team is used cannot be added.
 */
export class TeamService {
  constructor(private readonly deps: TeamServiceDeps) {}

  private async getOrThrow(id: number): Promise<Team> {
    const rows = await this.deps.db.select().from(teams).where(eq(teams.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError(`Team #${id} not found`);
    return rows[0];
  }

  /** Lists that ping the team, or send it their revision feedback. */
  private usageCounts(teamIds: number[]): Promise<Map<number, number>> {
    return mappingUsage(this.deps.db, 'team', teamIds);
  }

  private async toDtos(rows: Team[]): Promise<TeamDto[]> {
    const ids = rows.map((t) => t.id);
    const [members, usage] = await Promise.all([
      membersOfTeams(this.deps.db, ids),
      this.usageCounts(ids),
    ]);
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      channelId: t.channelId,
      members: (members.get(t.id) ?? []).map((r) => ({
        roleId: r.id,
        key: r.key,
        displayName: r.displayName,
      })),
      usageCount: usage.get(t.id) ?? 0,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async dto(id: number): Promise<TeamDto> {
    return (await this.toDtos([await this.getOrThrow(id)]))[0]!;
  }

  async list(): Promise<TeamDto[]> {
    return this.toDtos(await this.deps.db.select().from(teams).orderBy(asc(teams.name)));
  }

  private async assertNameFree(name: string, exceptId?: number): Promise<void> {
    const dup = await this.deps.db.select().from(teams).where(eq(teams.name, name)).limit(1);
    if (dup[0] && dup[0].id !== exceptId)
      throw new ConflictError(`A team named "${name}" already exists`);
  }

  private async assertRolesExist(roleIds: number[]): Promise<void> {
    if (!roleIds.length) return;
    const found = await this.deps.db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.id, roleIds));
    const missing = roleIds.filter((id) => !found.some((r) => r.id === id));
    if (missing.length) throw new NotFoundError(`Role #${missing[0]} not found`);
  }

  private async assertChannelExists(channelId: number | null | undefined): Promise<void> {
    if (!channelId) return;
    await this.channelOrThrow(channelId);
  }

  async create(input: TeamCreateInput): Promise<TeamDto> {
    await this.assertNameFree(input.name);
    await this.assertChannelExists(input.channelId);
    const memberIds = [...new Set(input.memberRoleIds)];
    await this.assertRolesExist(memberIds);
    const now = this.deps.clock();
    const team = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(teams)
        .values({ name: input.name, channelId: input.channelId, createdAt: now, updatedAt: now })
        .returning();
      if (memberIds.length) {
        await tx
          .insert(teamMembers)
          .values(memberIds.map((roleId) => ({ teamId: row!.id, roleId, createdAt: now })));
      }
      return row!;
    });
    return this.dto(team.id);
  }

  /** Rename and/or move to another channel (null = "No channel"). */
  async update(id: number, input: TeamPatchInput): Promise<TeamDto> {
    await this.getOrThrow(id);
    if (input.name !== undefined) await this.assertNameFree(input.name, id);
    await this.assertChannelExists(input.channelId);
    await this.deps.db
      .update(teams)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        updatedAt: this.deps.clock(),
      })
      .where(eq(teams.id, id));
    return this.dto(id);
  }

  async remove(id: number): Promise<void> {
    await this.getOrThrow(id);
    const usage = (await this.usageCounts([id])).get(id) ?? 0;
    if (usage > 0) {
      throw new ConflictError(
        `This team is used by ${usage} list(s) (mapped, or receiving revision feedback); change those lists first`,
      );
    }
    await this.deps.db.delete(teams).where(eq(teams.id, id));
  }

  // ---- channels: folders of teams ----

  private async channelOrThrow(id: number): Promise<TeamChannel> {
    const rows = await this.deps.db
      .select()
      .from(teamChannels)
      .where(eq(teamChannels.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundError(`Channel #${id} not found`);
    return rows[0];
  }

  private async assertChannelNameFree(name: string, exceptId?: number): Promise<void> {
    const dup = await this.deps.db
      .select()
      .from(teamChannels)
      .where(eq(teamChannels.name, name))
      .limit(1);
    if (dup[0] && dup[0].id !== exceptId)
      throw new ConflictError(`A channel named "${name}" already exists`);
  }

  private async channelDto(row: TeamChannel): Promise<TeamChannelDto> {
    const [n] = await this.deps.db
      .select({ n: count() })
      .from(teams)
      .where(eq(teams.channelId, row.id));
    return {
      id: row.id,
      name: row.name,
      teamCount: Number(n!.n),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listChannels(): Promise<TeamChannelDto[]> {
    const rows = await this.deps.db.select().from(teamChannels).orderBy(asc(teamChannels.name));
    const counts = await this.deps.db
      .select({ channelId: teams.channelId, n: count() })
      .from(teams)
      .where(isNotNull(teams.channelId))
      .groupBy(teams.channelId);
    const byChannel = new Map(counts.map((c) => [c.channelId!, Number(c.n)]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      teamCount: byChannel.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async createChannel(input: TeamChannelInput): Promise<TeamChannelDto> {
    await this.assertChannelNameFree(input.name);
    const now = this.deps.clock();
    const [row] = await this.deps.db
      .insert(teamChannels)
      .values({ name: input.name, createdAt: now, updatedAt: now })
      .returning();
    return this.channelDto(row!);
  }

  async renameChannel(id: number, input: TeamChannelInput): Promise<TeamChannelDto> {
    await this.channelOrThrow(id);
    await this.assertChannelNameFree(input.name, id);
    const [row] = await this.deps.db
      .update(teamChannels)
      .set({ name: input.name, updatedAt: this.deps.clock() })
      .where(eq(teamChannels.id, id))
      .returning();
    return this.channelDto(row!);
  }

  /** The channel's teams are kept and move to "No channel" (the foreign key sets them to null). */
  async removeChannel(id: number): Promise<void> {
    await this.channelOrThrow(id);
    await this.deps.db.delete(teamChannels).where(eq(teamChannels.id, id));
  }

  /**
   * Adds a role to the team. Where the team already pings (enabled lists without a mention
   * override), the new member must have a target in that server that would be notified in that
   * channel — otherwise the add is refused, exactly like saving a mapping.
   */
  async addMember(teamId: number, roleId: number): Promise<TeamDto> {
    const team = await this.getOrThrow(teamId);
    const roleRows = await this.deps.db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    const role = roleRows[0];
    if (!role) throw new NotFoundError(`Role #${roleId} not found`);
    const already = await this.deps.db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.roleId, roleId)))
      .limit(1);
    if (already[0]) return this.dto(teamId);

    const uses = await this.deps.db
      .select({
        guild: guilds,
        channelId: boards.discordChannelId,
        overrideChannelId: listMappings.overrideChannelId,
        boardName: boards.name,
        listName: trelloLists.name,
      })
      .from(listMappings)
      .innerJoin(boards, eq(boards.id, listMappings.boardId))
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .leftJoin(
        trelloLists,
        and(
          eq(trelloLists.boardId, listMappings.boardId),
          eq(trelloLists.trelloListId, listMappings.trelloListId),
        ),
      )
      .where(
        and(
          // The lists that ping the team (unless overridden) and those sending it their feedback.
          or(
            and(eq(listMappings.teamId, teamId), isNull(listMappings.overrideMentionId)),
            eq(listMappings.feedbackTeamId, teamId),
          ),
          eq(listMappings.enabled, true),
          eq(boards.enabled, true),
        ),
      );
    const checked = new Set<string>();
    for (const use of uses) {
      const channelId = use.overrideChannelId ?? use.channelId;
      const key = `${use.guild.id}:${channelId}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const targetRows = await this.deps.db
        .select()
        .from(roleTargets)
        .where(and(eq(roleTargets.roleId, roleId), eq(roleTargets.guildId, use.guild.id)))
        .limit(1);
      const t = targetRows[0];
      if (!t) {
        throw new ValidationFailedError(
          'ROLE_HAS_NO_TARGET',
          `${role.displayName} has no Discord target in ${use.guild.name}, where team ${team.name} pings for list "${use.listName ?? '?'}" on ${use.boardName}.`,
          `Set ${role.displayName}'s Discord user or role for ${use.guild.name} first, then add them to the team.`,
        );
      }
      const result = await this.deps.validator.validate({
        discordGuildId: use.guild.discordGuildId,
        channelId,
        target: { kind: t.mentionKind, id: t.mentionId },
      });
      if (!result.ok) {
        throw new ValidationFailedError(
          result.code,
          `${role.displayName} (list "${use.listName ?? '?'}" on ${use.boardName}): ${result.message}`,
          result.hint,
        );
      }
    }
    await this.deps.db
      .insert(teamMembers)
      .values({ teamId, roleId, createdAt: this.deps.clock() })
      .onConflictDoNothing();
    await this.deps.db
      .update(teams)
      .set({ updatedAt: this.deps.clock() })
      .where(eq(teams.id, teamId));
    return this.dto(teamId);
  }

  /** A team that lists ping must keep at least one member, or those lists would ping nobody. */
  async removeMember(teamId: number, roleId: number): Promise<TeamDto> {
    const team = await this.getOrThrow(teamId);
    const members = (await membersOfTeams(this.deps.db, [teamId])).get(teamId) ?? [];
    if (!members.some((m) => m.id === roleId)) throw new NotFoundError('Not a member of this team');
    const usage = (await this.usageCounts([teamId])).get(teamId) ?? 0;
    if (members.length === 1 && usage > 0) {
      throw new ConflictError(
        `Team ${team.name} is used by ${usage} list(s) and needs at least one member; add someone else first or change those lists`,
      );
    }
    await this.deps.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.roleId, roleId)));
    const now = this.deps.clock();
    await this.deps.db.update(teams).set({ updatedAt: now }).where(eq(teams.id, teamId));

    // Removing the member who had no target fixes the lists that were flagged because of them.
    const recipient = await loadRecipient(this.deps.db, { roleId: null, teamId });
    const mapped = await this.deps.db
      .select({ id: listMappings.id, guild: guilds })
      .from(listMappings)
      .innerJoin(boards, eq(boards.id, listMappings.boardId))
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .where(and(eq(listMappings.teamId, teamId), isNull(listMappings.overrideMentionId)));
    for (const guild of new Map(mapped.map((m) => [m.guild.id, m.guild])).values()) {
      if (!recipient) break;
      const resolved = await targetsInGuild(this.deps.db, recipient, guild.id);
      if (recipientProblem(recipient, resolved, guild.name)) continue;
      await this.deps.db
        .update(listMappings)
        .set({ checkStatus: 'ok', checkError: null, checkedAt: now })
        .where(
          inArray(
            listMappings.id,
            mapped.filter((m) => m.guild.id === guild.id).map((m) => m.id),
          ),
        );
    }
    await refreshFeedbackChecks(this.deps.db, now);
    return this.dto(teamId);
  }
}

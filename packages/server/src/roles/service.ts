import { and, asc, count, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import {
  DEFAULT_GLOBAL_TEMPLATE,
  type MentionTarget,
  type RoleCreateInput,
  type RoleDto,
  type RolePatchInput,
  type RoleTargetDto,
  type TeamRefDto,
  type TestSendResultDto,
} from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import {
  boards,
  guilds,
  listMappings,
  roleTargets,
  roles,
  teamMembers,
  teams,
  type Guild,
  type Role,
  type RoleTarget,
} from '../db/schema';
import { loadRecipient, recipientProblem, targetsInGuild } from '../db/repos/recipients';
import { mappingUsage, refreshFeedbackChecks } from '../db/repos/feedback';
import type { DiscordClient } from '../discord/client';
import { assertValid, type MentionValidator } from '../discord/validate';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors';
import { iso } from '../http/util';
import { sendTestMessage } from '../notifications/testSend';
import { getDefaultTemplate } from '../db/repos/settings';

export interface RoleServiceDeps {
  db: Db;
  discord: DiscordClient;
  validator: MentionValidator;
  clock: Clock;
}

export class RoleService {
  constructor(private readonly deps: RoleServiceDeps) {}

  async getOrThrow(id: number): Promise<Role> {
    const rows = await this.deps.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError(`Role #${id} not found`);
    return rows[0];
  }

  private async guildOrThrow(id: number): Promise<Guild> {
    const rows = await this.deps.db.select().from(guilds).where(eq(guilds.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundError(`Server #${id} not found`);
    return rows[0];
  }

  /**
   * Lists that use each role directly, as the list's role or for its revision feedback (team
   * mappings are counted on the team).
   */
  private async usageCounts(): Promise<Map<number, number>> {
    const rows = await this.deps.db.select({ id: roles.id }).from(roles);
    return mappingUsage(
      this.deps.db,
      'role',
      rows.map((r) => r.id),
    );
  }

  private async teamsByRole(): Promise<Map<number, TeamRefDto[]>> {
    const rows = await this.deps.db
      .select({ roleId: teamMembers.roleId, id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .orderBy(asc(teams.name));
    const map = new Map<number, TeamRefDto[]>();
    for (const r of rows)
      map.set(r.roleId, [...(map.get(r.roleId) ?? []), { id: r.id, name: r.name }]);
    return map;
  }

  /** Enabled team mappings in this guild whose team includes this role, without a mention override. */
  private async teamMappingsOf(roleId: number, guildId: number) {
    return this.deps.db
      .select({ mappingId: listMappings.id, teamId: teams.id, teamName: teams.name })
      .from(listMappings)
      .innerJoin(boards, eq(boards.id, listMappings.boardId))
      .innerJoin(teams, eq(teams.id, listMappings.teamId))
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(
        and(
          eq(teamMembers.roleId, roleId),
          eq(boards.guildId, guildId),
          isNull(listMappings.overrideMentionId),
        ),
      );
  }

  private async targetsByRole(): Promise<Map<number, RoleTargetDto[]>> {
    const rows = await this.deps.db
      .select({ t: roleTargets, g: guilds })
      .from(roleTargets)
      .innerJoin(guilds, eq(guilds.id, roleTargets.guildId));
    const map = new Map<number, RoleTargetDto[]>();
    for (const { t, g } of rows) {
      const list = map.get(t.roleId) ?? [];
      list.push({
        guildId: g.id,
        discordGuildId: g.discordGuildId,
        guildName: g.name,
        mentionKind: t.mentionKind,
        mentionId: t.mentionId,
        checkStatus: t.checkStatus,
        checkError: t.checkError,
        checkedAt: iso(t.checkedAt),
      });
      map.set(t.roleId, list);
    }
    return map;
  }

  private toDto(
    row: Role,
    usage: number,
    targets: RoleTargetDto[],
    memberOf: TeamRefDto[],
  ): RoleDto {
    return {
      id: row.id,
      key: row.key,
      displayName: row.displayName,
      defaultTemplate: row.defaultTemplate,
      usageCount: usage,
      targets,
      teams: memberOf,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async dto(row: Role): Promise<RoleDto> {
    const [usage, targets, memberOf] = await Promise.all([
      this.usageCounts(),
      this.targetsByRole(),
      this.teamsByRole(),
    ]);
    return this.toDto(
      row,
      usage.get(row.id) ?? 0,
      targets.get(row.id) ?? [],
      memberOf.get(row.id) ?? [],
    );
  }

  async list(): Promise<RoleDto[]> {
    const [rows, usage, targets, memberOf] = await Promise.all([
      this.deps.db.select().from(roles).orderBy(roles.id),
      this.usageCounts(),
      this.targetsByRole(),
      this.teamsByRole(),
    ]);
    return rows.map((r) =>
      this.toDto(r, usage.get(r.id) ?? 0, targets.get(r.id) ?? [], memberOf.get(r.id) ?? []),
    );
  }

  async create(input: RoleCreateInput): Promise<RoleDto> {
    const dup = await this.deps.db.select().from(roles).where(eq(roles.key, input.key)).limit(1);
    if (dup[0]) throw new ConflictError(`A role with key "${input.key}" already exists`);
    const now = this.deps.clock();
    const [row] = await this.deps.db
      .insert(roles)
      .values({
        key: input.key,
        displayName: input.displayName,
        defaultTemplate: input.defaultTemplate ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.dto(row!);
  }

  async update(id: number, input: RolePatchInput): Promise<RoleDto> {
    await this.getOrThrow(id);
    if (input.key) {
      const dup = await this.deps.db.select().from(roles).where(eq(roles.key, input.key)).limit(1);
      if (dup[0] && dup[0].id !== id)
        throw new ConflictError(`A role with key "${input.key}" already exists`);
    }
    const [row] = await this.deps.db
      .update(roles)
      .set({
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.defaultTemplate !== undefined ? { defaultTemplate: input.defaultTemplate } : {}),
        updatedAt: this.deps.clock(),
      })
      .where(eq(roles.id, id))
      .returning();
    return this.dto(row!);
  }

  async remove(id: number): Promise<void> {
    const role = await this.getOrThrow(id);
    const usage = (await this.usageCounts()).get(id) ?? 0;
    if (usage > 0) {
      throw new ConflictError(
        `This role is used by ${usage} list(s) (mapped, or receiving revision feedback); change those lists first`,
      );
    }
    // Deleting the role removes it from its teams; a mapped team must keep at least one member.
    const memberOf = await this.deps.db
      .select({ teamId: teamMembers.teamId, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.roleId, id));
    for (const t of memberOf) {
      const [members] = await this.deps.db
        .select({ n: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, t.teamId));
      const mapped = (await mappingUsage(this.deps.db, 'team', [t.teamId])).get(t.teamId) ?? 0;
      if (Number(members!.n) === 1 && mapped > 0) {
        throw new ConflictError(
          `${role.displayName} is the only member of team ${t.name}, which is used by ${mapped} list(s); add someone else to the team or change those lists first`,
        );
      }
    }
    await this.deps.db.delete(roles).where(eq(roles.id, id));
  }

  /**
   * Effective channels (in one guild) where this role's target would be mentioned: lists mapped to
   * the role or to a team the role is in (unless overridden), and lists sending their revision
   * feedback to the role or to such a team.
   */
  async channelsUsingRole(roleId: number, guildId: number): Promise<string[]> {
    const teamsOfRole = this.deps.db
      .select({ id: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.roleId, roleId));
    const rows = await this.deps.db
      .select({ boardChannel: boards.discordChannelId, override: listMappings.overrideChannelId })
      .from(listMappings)
      .innerJoin(boards, eq(boards.id, listMappings.boardId))
      .where(
        and(
          or(
            and(
              or(eq(listMappings.roleId, roleId), inArray(listMappings.teamId, teamsOfRole)),
              isNull(listMappings.overrideMentionId),
            ),
            eq(listMappings.feedbackRoleId, roleId),
            inArray(listMappings.feedbackTeamId, teamsOfRole),
          ),
          eq(boards.guildId, guildId),
          eq(boards.enabled, true),
          eq(listMappings.enabled, true),
        ),
      );
    return [...new Set(rows.map((r) => r.override ?? r.boardChannel))];
  }

  /** Validates a target against every channel that would use it (or guild-wide if none). */
  async validateTarget(roleId: number, guild: Guild, target: MentionTarget): Promise<void> {
    const channels = await this.channelsUsingRole(roleId, guild.id);
    if (channels.length === 0) {
      assertValid(
        await this.deps.validator.validate({
          discordGuildId: guild.discordGuildId,
          channelId: null,
          target,
        }),
      );
      return;
    }
    for (const channelId of channels) {
      assertValid(
        await this.deps.validator.validate({
          discordGuildId: guild.discordGuildId,
          channelId,
          target,
        }),
      );
    }
  }

  async putTarget(roleId: number, guildId: number, target: MentionTarget): Promise<RoleDto> {
    const role = await this.getOrThrow(roleId);
    const guild = await this.guildOrThrow(guildId);
    await this.validateTarget(roleId, guild, target);
    const now = this.deps.clock();
    await this.deps.db
      .insert(roleTargets)
      .values({
        roleId,
        guildId,
        mentionKind: target.kind,
        mentionId: target.id,
        checkStatus: 'ok',
        checkError: null,
        checkedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [roleTargets.roleId, roleTargets.guildId],
        set: {
          mentionKind: target.kind,
          mentionId: target.id,
          checkStatus: 'ok',
          checkError: null,
          checkedAt: now,
          updatedAt: now,
        },
      });
    // Mappings relying on this target are valid again.
    await this.deps.db
      .update(listMappings)
      .set({ checkStatus: 'ok', checkError: null, checkedAt: now })
      .where(
        and(
          eq(listMappings.roleId, roleId),
          isNull(listMappings.overrideMentionId),
          inArray(
            listMappings.boardId,
            this.deps.db.select({ id: boards.id }).from(boards).where(eq(boards.guildId, guildId)),
          ),
        ),
      );
    // Team mappings are valid again once every member of the team has a target here.
    const teamMappings = await this.teamMappingsOf(roleId, guildId);
    for (const teamId of new Set(teamMappings.map((m) => m.teamId))) {
      const recipient = await loadRecipient(this.deps.db, { roleId: null, teamId });
      if (!recipient) continue;
      const resolved = await targetsInGuild(this.deps.db, recipient, guildId);
      if (recipientProblem(recipient, resolved, guild.name)) continue;
      await this.deps.db
        .update(listMappings)
        .set({ checkStatus: 'ok', checkError: null, checkedAt: now })
        .where(
          inArray(
            listMappings.id,
            teamMappings.filter((m) => m.teamId === teamId).map((m) => m.mappingId),
          ),
        );
    }
    await refreshFeedbackChecks(this.deps.db, now, guildId);
    return this.dto(role);
  }

  async deleteTarget(roleId: number, guildId: number): Promise<RoleDto> {
    const role = await this.getOrThrow(roleId);
    await this.deps.db
      .delete(roleTargets)
      .where(and(eq(roleTargets.roleId, roleId), eq(roleTargets.guildId, guildId)));
    // Mappings that relied on it are now broken; say so where the user will look.
    await this.deps.db
      .update(listMappings)
      .set({
        checkStatus: 'error',
        checkError: `Role ${role.displayName} has no Discord target in this server any more`,
        checkedAt: this.deps.clock(),
      })
      .where(
        and(
          eq(listMappings.roleId, roleId),
          isNull(listMappings.overrideMentionId),
          inArray(
            listMappings.boardId,
            this.deps.db.select({ id: boards.id }).from(boards).where(eq(boards.guildId, guildId)),
          ),
        ),
      );
    for (const m of await this.teamMappingsOf(roleId, guildId)) {
      await this.deps.db
        .update(listMappings)
        .set({
          checkStatus: 'error',
          checkError: `Team ${m.teamName}: ${role.displayName} has no Discord target in this server any more`,
          checkedAt: this.deps.clock(),
        })
        .where(eq(listMappings.id, m.mappingId));
    }
    await refreshFeedbackChecks(this.deps.db, this.deps.clock(), guildId);
    return this.dto(role);
  }

  async getTarget(roleId: number, guildId: number): Promise<RoleTarget | null> {
    const rows = await this.deps.db
      .select()
      .from(roleTargets)
      .where(and(eq(roleTargets.roleId, roleId), eq(roleTargets.guildId, guildId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async testTarget(roleId: number, guildId: number, channelId: string): Promise<TestSendResultDto> {
    const role = await this.getOrThrow(roleId);
    const guild = await this.guildOrThrow(guildId);
    const target = await this.getTarget(roleId, guildId);
    if (!target) {
      throw new ValidationFailedError(
        'ROLE_HAS_NO_TARGET',
        `Role ${role.displayName} has no Discord target in ${guild.name}.`,
        'Set the target for this server first.',
      );
    }
    assertValid(
      await this.deps.validator.validate({
        discordGuildId: guild.discordGuildId,
        channelId,
        target: { kind: target.mentionKind, id: target.mentionId },
      }),
    );
    const template =
      role.defaultTemplate ?? (await getDefaultTemplate(this.deps.db)) ?? DEFAULT_GLOBAL_TEMPLATE;
    return sendTestMessage(this.deps.discord, {
      channelId,
      targets: [{ kind: target.mentionKind, id: target.mentionId }],
      template,
      vars: { list_name: role.displayName },
    });
  }
}

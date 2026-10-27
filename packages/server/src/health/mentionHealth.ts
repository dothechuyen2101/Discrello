import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { MentionTarget } from '@discrello/shared';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import { boards, guilds, listMappings, roleTargets, roles, trelloLists } from '../db/schema';
import {
  loadRecipient,
  recipientName,
  recipientProblem,
  targetsInGuild,
} from '../db/repos/recipients';
import { FEEDBACK_ERROR_PREFIX, loadFeedbackRecipient } from '../db/repos/feedback';
import type { MentionValidator } from '../discord/validate';
import type { AlertSink } from '../notifications/alerts';
import type { RoleService } from '../roles/service';

export interface MentionHealthDeps {
  db: Db;
  validator: MentionValidator;
  roleService: RoleService;
  alerts: AlertSink;
  clock: Clock;
  logger: FastifyBaseLogger;
}

export interface MentionHealthSummary {
  targetsChecked: number;
  targetsFailing: number;
  mappingsChecked: number;
  mappingsFailing: number;
}

/**
 * Plan §6.4: re-runs the save-time validation for every role target and mapping, because
 * permissions, "mentionable" flags and memberships change after the config was saved. A transition
 * from ok to error is posted to the guild's alert channel.
 */
export class MentionHealth {
  constructor(private readonly deps: MentionHealthDeps) {}

  async recheckAll(): Promise<MentionHealthSummary> {
    this.deps.validator.invalidate();
    const summary: MentionHealthSummary = {
      targetsChecked: 0,
      targetsFailing: 0,
      mappingsChecked: 0,
      mappingsFailing: 0,
    };
    const now = this.deps.clock();

    const targets = await this.deps.db
      .select({ t: roleTargets, g: guilds, r: roles })
      .from(roleTargets)
      .innerJoin(guilds, eq(guilds.id, roleTargets.guildId))
      .innerJoin(roles, eq(roles.id, roleTargets.roleId))
      .where(eq(guilds.enabled, true));
    for (const { t, g, r } of targets) {
      summary.targetsChecked += 1;
      const channels = await this.deps.roleService.channelsUsingRole(t.roleId, t.guildId);
      let error: string | null = null;
      for (const channelId of channels.length ? channels : [null]) {
        const result = await this.deps.validator.validate({
          discordGuildId: g.discordGuildId,
          channelId,
          target: { kind: t.mentionKind, id: t.mentionId },
        });
        if (!result.ok) {
          error = `${result.message} ${result.hint}`;
          break;
        }
      }
      if (error) summary.targetsFailing += 1;
      await this.deps.db
        .update(roleTargets)
        .set({ checkStatus: error ? 'error' : 'ok', checkError: error, checkedAt: now })
        .where(eq(roleTargets.id, t.id));
      if (error && t.checkStatus !== 'error') {
        this.deps.logger.warn(
          { roleId: t.roleId, guildId: t.guildId, error },
          'role target became invalid',
        );
        await this.deps.alerts.configProblem(
          g.id,
          `Role **${r.displayName}** in ${g.name}: ${error}`,
        );
      }
    }

    const mappings = await this.deps.db
      .select({ m: listMappings, b: boards, g: guilds })
      .from(listMappings)
      .innerJoin(boards, eq(boards.id, listMappings.boardId))
      .innerJoin(guilds, eq(guilds.id, boards.guildId))
      .where(
        and(eq(boards.enabled, true), eq(guilds.enabled, true), eq(listMappings.enabled, true)),
      );
    for (const { m, b, g } of mappings) {
      summary.mappingsChecked += 1;
      const recipient = await loadRecipient(this.deps.db, m);
      const owner = recipient
        ? `${recipient.kind === 'team' ? 'team ' : ''}${recipientName(recipient)}`
        : 'deleted role';
      // Everyone this list pings: the override, else the role's target or every team member's.
      let error: string | null = null;
      let targets: Array<{ who: string | null; target: MentionTarget }> = [];
      if (m.overrideMentionKind && m.overrideMentionId) {
        targets = [{ who: null, target: { kind: m.overrideMentionKind, id: m.overrideMentionId } }];
      } else if (recipient) {
        const resolved = await targetsInGuild(this.deps.db, recipient, g.id);
        const problem = recipientProblem(recipient, resolved, g.name);
        if (problem) error = problem.message;
        targets = resolved.targets.map((t) => ({ who: t.who.displayName, target: t.target }));
      }
      for (const { who, target } of error ? [] : targets) {
        const result = await this.deps.validator.validate({
          discordGuildId: g.discordGuildId,
          channelId: m.overrideChannelId ?? b.discordChannelId,
          target,
        });
        if (!result.ok) {
          error = `${recipient?.kind === 'team' && who ? `${who}: ` : ''}${result.message} ${result.hint}`;
          break;
        }
      }
      // Whoever receives the list's revision feedback, when it is not the list's own recipient.
      const feedback = error ? null : await loadFeedbackRecipient(this.deps.db, m);
      if (feedback) {
        const resolved = await targetsInGuild(this.deps.db, feedback, g.id);
        const problem = recipientProblem(feedback, resolved, g.name);
        if (problem) error = `${FEEDBACK_ERROR_PREFIX}${problem.message}`;
        for (const { who, target } of error ? [] : resolved.targets) {
          const result = await this.deps.validator.validate({
            discordGuildId: g.discordGuildId,
            channelId: m.overrideChannelId ?? b.discordChannelId,
            target,
          });
          if (!result.ok) {
            error = `${FEEDBACK_ERROR_PREFIX}${who.displayName}: ${result.message} ${result.hint}`;
            break;
          }
        }
      }
      if (error) summary.mappingsFailing += 1;
      await this.deps.db
        .update(listMappings)
        .set({ checkStatus: error ? 'error' : 'ok', checkError: error, checkedAt: now })
        .where(eq(listMappings.id, m.id));
      if (error && m.checkStatus !== 'error') {
        const listRows = await this.deps.db
          .select({ name: trelloLists.name })
          .from(trelloLists)
          .where(and(eq(trelloLists.boardId, b.id), eq(trelloLists.trelloListId, m.trelloListId)))
          .limit(1);
        const listName = listRows[0]?.name ?? m.trelloListId;
        this.deps.logger.warn({ mappingId: m.id, error }, 'list mapping became invalid');
        await this.deps.alerts.configProblem(
          g.id,
          `Board **${b.name}**, list "${listName}" (${owner}): ${error}`,
        );
      }
    }
    return summary;
  }
}

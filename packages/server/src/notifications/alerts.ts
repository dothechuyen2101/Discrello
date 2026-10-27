import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { guilds, type Notification } from '../db/schema';
import type { DiscordClient } from '../discord/client';

export interface AlertSink {
  notificationProblem(notification: Notification, summary: string): Promise<void>;
  configProblem(guildId: number, summary: string): Promise<void>;
}

export class NoopAlerts implements AlertSink {
  readonly events: Array<{ kind: 'notification' | 'config'; guildId: number; summary: string }> =
    [];
  async notificationProblem(notification: Notification, summary: string): Promise<void> {
    this.events.push({ kind: 'notification', guildId: notification.guildId, summary });
  }
  async configProblem(guildId: number, summary: string): Promise<void> {
    this.events.push({ kind: 'config', guildId, summary });
  }
}

/** Posts problems to the guild's alert channel, if one is configured. Never throws. */
export class DiscordAlerts implements AlertSink {
  constructor(
    private readonly db: Db,
    private readonly discord: DiscordClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private async post(guildId: number, content: string): Promise<void> {
    try {
      const rows = await this.db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
      const guild = rows[0];
      if (!guild?.alertChannelId) return;
      await this.discord.sendMessage(guild.alertChannelId, {
        content: content.slice(0, 1900),
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      this.logger.warn({ err, guildId }, 'could not post to the alert channel');
    }
  }

  notificationProblem(notification: Notification, summary: string): Promise<void> {
    return this.post(
      notification.guildId,
      `⚠️ **Discrello** could not notify for **${notification.cardName}** (<${notification.cardUrl}>), list "${notification.listName}" on ${notification.boardName}:\n${summary}`,
    );
  }

  configProblem(guildId: number, summary: string): Promise<void> {
    return this.post(guildId, `⚠️ **Discrello** configuration problem:\n${summary}`);
  }
}

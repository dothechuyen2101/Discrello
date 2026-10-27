import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import type { Clock } from '../db/types';
import type { Notification } from '../db/schema';
import {
  claimDue,
  markFailed,
  markSent,
  reclaimStale,
  scheduleRetry,
} from '../db/repos/notifications';
import { formatMention } from '@discrello/shared';
import { DiscordRequestError, type DiscordClient } from '../discord/client';
import type { AlertSink } from './alerts';
import { nextAttemptDelayMs } from './backoff';
import { verifyMentions } from './verifyMention';

export interface WorkerDeps {
  db: Db;
  discord: DiscordClient;
  logger: FastifyBaseLogger;
  clock: Clock;
  alerts: AlertSink;
}

/**
 * Drains the notification outbox. Rows are claimed with FOR UPDATE SKIP LOCKED so several
 * instances could run; sends are sequential to stay well inside Discord's rate limits.
 */
export class NotificationWorker {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private running = false;
  private wakeRequested = false;

  constructor(private readonly deps: WorkerDeps) {}

  start(intervalMs = 2000): void {
    if (this.timer) return;
    this.started = true;
    this.timer = setInterval(() => void this.run(), intervalMs);
    this.timer.unref();
    void this.run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  /**
   * Called right after a webhook enqueues something so the ping goes out immediately.
   * No-op until start() — tests drive processOnce() themselves.
   */
  wake(): void {
    if (!this.started) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.wakeRequested = false;
        await this.processOnce();
      } while (this.wakeRequested);
    } catch (err) {
      this.deps.logger.error({ err }, 'notification worker cycle failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass: requeue stale rows, claim due rows, send each. Public so tests can drive it. */
  async processOnce(): Promise<number> {
    const now = this.deps.clock();
    const reclaimed = await reclaimStale(this.deps.db, now);
    if (reclaimed) this.deps.logger.warn({ reclaimed }, 'requeued notifications stuck in sending');
    const rows = await claimDue(this.deps.db, now);
    for (const row of rows) {
      await this.deliver(row);
    }
    return rows.length;
  }

  private async deliver(row: Notification): Promise<void> {
    const { db, discord, logger, alerts } = this.deps;
    const log = logger.child({ notificationId: row.id, cardId: row.cardId });
    if (!row.discordChannelId || row.content === null) {
      await markFailed(db, row.id, this.deps.clock(), 'Notification has no channel or content');
      return;
    }
    const targets = row.mentionsJson ?? [];
    try {
      const message = await discord.sendMessage(row.discordChannelId, {
        content: row.content,
        allowedMentions: row.allowedMentionsJson ?? { parse: [] },
      });
      const { verified, missed } = verifyMentions(message, targets);
      const notPinged = missed
        .map((t) => `${t.kind === 'role' ? 'the role' : 'the user'} ${formatMention(t)}`)
        .join(', ');
      await markSent(
        db,
        row.id,
        this.deps.clock(),
        message.id,
        verified,
        verified === false && missed.length < targets.length
          ? `Message posted but Discord did not register the mention of ${notPinged}`
          : undefined,
      );
      if (verified === false) {
        log.warn(
          { messageId: message.id, missed },
          'message posted but the mention did not register',
        );
        await alerts.notificationProblem(
          { ...row, status: 'sent_no_mention' },
          `Message was posted but Discord did not notify ${notPinged}. Check that the role is mentionable or that the bot may mention all roles, and that the target can see the channel.`,
        );
      } else {
        log.info({ messageId: message.id }, 'notification sent');
      }
    } catch (err) {
      const mapped = DiscordRequestError.is(err)
        ? err
        : new DiscordRequestError(0, null, err instanceof Error ? err.message : String(err), true);
      const attemptsAfter = row.attempts + 1;
      const delay = mapped.retryable ? nextAttemptDelayMs(attemptsAfter) : null;
      if (delay !== null) {
        log.warn({ err: mapped, attemptsAfter, delay }, 'send failed, will retry');
        await scheduleRetry(db, row.id, this.deps.clock(), delay, mapped.message);
        return;
      }
      log.error({ err: mapped, attemptsAfter }, 'send failed permanently');
      await markFailed(db, row.id, this.deps.clock(), mapped.message);
      await alerts.notificationProblem(
        { ...row, status: 'failed', lastError: mapped.message },
        mapped.message,
      );
    }
  }
}

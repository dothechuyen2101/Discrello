import { loadConfig } from './config';
import { openDb } from './db/client';
import { buildApp } from './app';
import { RestDiscordClient, type DiscordClient } from './discord/client';
import { TrelloClient, type TrelloApi } from './trello/client';
import { makeFakeIntegrations } from './demo';
import { Scheduler } from './jobs/scheduler';
import { pruneOldRows } from './jobs/prune';

const FIFTEEN_MINUTES = 15 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;

async function main() {
  const config = loadConfig();
  const logger =
    config.NODE_ENV === 'production'
      ? { level: config.LOG_LEVEL }
      : {
          level: config.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        };

  const dbHandle = await openDb(config.DATABASE_URL);
  // Embedded Postgres (dev/demo only) has no separate migrate step, so apply migrations here.
  if (config.DATABASE_URL.startsWith('pglite:')) await dbHandle.migrate();
  const demo =
    process.env['DISCRELLO_FAKE_INTEGRATIONS'] === '1' && config.NODE_ENV !== 'production';
  let discord: DiscordClient;
  let trello: TrelloApi;
  let fakes: ReturnType<typeof makeFakeIntegrations> | null = null;
  if (demo) {
    fakes = makeFakeIntegrations();
    ({ discord, trello } = fakes);
  } else {
    discord = new RestDiscordClient(config.DISCORD_BOT_TOKEN);
    trello = new TrelloClient(config.TRELLO_API_KEY, config.TRELLO_API_TOKEN);
  }
  const app = await buildApp({ config, dbHandle, discord, trello, logger });
  const { fastify, worker, services } = app;
  if (fakes) {
    fastify.log.warn(
      'DISCRELLO_FAKE_INTEGRATIONS=1: in-memory Discord/Trello fakes, nothing is sent anywhere',
    );
    let seen = 0;
    setInterval(() => {
      for (const m of fakes!.discord.sent.slice(seen)) {
        fastify.log.info({ channelId: m.channelId, content: m.content }, 'fake discord message');
      }
      seen = fakes!.discord.sent.length;
    }, 2_000).unref();
  }

  const scheduler = new Scheduler(fastify.log);
  const shutdown = async (signal: string) => {
    fastify.log.info({ signal }, 'shutting down');
    scheduler.stop();
    await fastify.close();
    await dbHandle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await fastify.listen({ port: config.PORT, host: config.HOST });
  worker.start();

  // Say loudly at startup if Discord rejects the bot token, instead of failing later on first use.
  discord
    .getCurrentUser()
    .then((bot) =>
      fastify.log.info({ bot: bot.username, id: bot.id }, 'discord bot token accepted'),
    )
    .catch((err: unknown) =>
      fastify.log.error({ err }, err instanceof Error ? err.message : 'discord bot check failed'),
    );

  scheduler.every(
    'webhook-health',
    FIFTEEN_MINUTES,
    async () => {
      const r = await services.boards.reconcileAll();
      fastify.log.info(r, 'webhook reconcile finished');
    },
    { runNow: true },
  );
  scheduler.every(
    'mention-health',
    FIFTEEN_MINUTES,
    async () => {
      const r = await services.mentionHealth.recheckAll();
      fastify.log.info(r, 'mention re-check finished');
    },
    { runNow: true },
  );
  scheduler.every('prune', ONE_DAY, async () => {
    const r = await pruneOldRows(dbHandle.db, new Date());
    fastify.log.info(r, 'pruned old rows');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config';
import type { DbHandle } from './db/client';
import { systemClock, type Clock } from './db/types';
import type { DiscordClient } from './discord/client';
import { MentionValidator } from './discord/validate';
import type { TrelloApi } from './trello/client';
import { trelloWebhookRoutes } from './trello/webhookRoute';
import { healthRoutes } from './http/health';
import { registerAuth } from './http/auth';
import { registerErrorHandler } from './http/errorHandler';
import { findWebDist, registerStatic } from './http/static';
import { guildRoutes } from './http/routes/guilds';
import { roleRoutes } from './http/routes/roles';
import { teamRoutes } from './http/routes/teams';
import { boardRoutes } from './http/routes/boards';
import { notificationRoutes } from './http/routes/notifications';
import { settingsRoutes } from './http/routes/settings';
import { ingestEvent } from './notifications/ingest';
import { NotificationWorker } from './notifications/worker';
import { DiscordAlerts, type AlertSink } from './notifications/alerts';
import { NotificationService } from './notifications/service';
import { GuildService } from './guilds/service';
import { RoleService } from './roles/service';
import { TeamService } from './teams/service';
import { BoardService } from './boards/service';
import { MentionHealth } from './health/mentionHealth';

export interface AppDeps {
  config: Config;
  dbHandle: DbHandle;
  discord: DiscordClient;
  trello: TrelloApi;
  logger?: FastifyServerOptions['logger'];
  clock?: Clock;
  alerts?: AlertSink;
  /** Serve the built web UI from this folder (default: auto-detect; tests pass null). */
  webDist?: string | null;
}

export interface App {
  fastify: FastifyInstance;
  worker: NotificationWorker;
  validator: MentionValidator;
  services: {
    guilds: GuildService;
    roles: RoleService;
    teams: TeamService;
    boards: BoardService;
    notifications: NotificationService;
    mentionHealth: MentionHealth;
  };
}

export async function buildApp(deps: AppDeps): Promise<App> {
  // Trust exactly TRUST_PROXY_HOPS proxies (0 = none), so the client IP is the entry nginx
  // appended rather than whatever the client put in X-Forwarded-For.
  const hops = deps.config.TRUST_PROXY_HOPS;
  const fastify = Fastify({
    logger: deps.logger ?? false,
    trustProxy: (_address: string, hop: number) => hop < hops,
  });
  const clock = deps.clock ?? systemClock;
  const db = deps.dbHandle.db;
  const alerts = deps.alerts ?? new DiscordAlerts(db, deps.discord, fastify.log);
  const validator = new MentionValidator(deps.discord, { clock });
  const worker = new NotificationWorker({
    db,
    discord: deps.discord,
    logger: fastify.log,
    clock,
    alerts,
  });

  const guilds = new GuildService({ db, discord: deps.discord, validator, clock });
  const roles = new RoleService({ db, discord: deps.discord, validator, clock });
  const teams = new TeamService({ db, validator, clock });
  const boards = new BoardService({
    db,
    trello: deps.trello,
    discord: deps.discord,
    validator,
    clock,
    publicBaseUrl: deps.config.PUBLIC_BASE_URL,
    logger: fastify.log,
  });
  const notifications = new NotificationService({ db, clock, wake: () => worker.wake() });
  const mentionHealth = new MentionHealth({
    db,
    validator,
    roleService: roles,
    alerts,
    clock,
    logger: fastify.log,
  });

  registerErrorHandler(fastify);
  await fastify.register(rateLimit, { global: false });
  await registerAuth(fastify, deps.config);

  await fastify.register(healthRoutes, { dbHandle: deps.dbHandle });
  await fastify.register(trelloWebhookRoutes, {
    db,
    trelloSecret: deps.config.TRELLO_API_SECRET,
    ingest: (board, guild, payload) =>
      ingestEvent({ db, clock, trello: deps.trello }, board, guild, payload),
    onEnqueued: () => worker.wake(),
  });
  await fastify.register(guildRoutes, { guilds });
  await fastify.register(roleRoutes, { roles });
  await fastify.register(teamRoutes, { teams });
  await fastify.register(boardRoutes, { boards });
  await fastify.register(notificationRoutes, { notifications });
  await fastify.register(settingsRoutes, {
    db,
    trello: deps.trello,
    validator,
    boards,
    mentionHealth,
    publicBaseUrl: deps.config.PUBLIC_BASE_URL,
  });

  const webDist = deps.webDist === undefined ? findWebDist(deps.config.WEB_DIST) : deps.webDist;
  if (webDist) {
    await registerStatic(fastify, webDist);
    fastify.log.info({ webDist }, 'serving web UI');
  }

  fastify.addHook('onClose', async () => worker.stop());

  return {
    fastify,
    worker,
    validator,
    services: { guilds, roles, teams, boards, notifications, mentionHealth },
  };
}

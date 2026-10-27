import type { FastifyInstance } from 'fastify';
import { settingsPutSchema, type IntegrationsHealthDto, type SettingsDto } from '@discrello/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  getDefaultCommentTemplate,
  getDefaultTemplate,
  setSetting,
  SETTING_DEFAULT_COMMENT_TEMPLATE,
  SETTING_DEFAULT_TEMPLATE,
} from '../../db/repos/settings';
import { guilds } from '../../db/schema';
import type { MentionValidator } from '../../discord/validate';
import type { TrelloApi } from '../../trello/client';
import type { BoardService } from '../../boards/service';
import type { MentionHealth } from '../../health/mentionHealth';
import { APP_VERSION } from '../health';
import { parse } from '../util';

export interface SettingsRouteDeps {
  db: Db;
  trello: TrelloApi;
  validator: MentionValidator;
  boards: BoardService;
  mentionHealth: MentionHealth;
  publicBaseUrl: string;
}

export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps) {
  const current = async (): Promise<SettingsDto> => ({
    defaultTemplate: await getDefaultTemplate(deps.db),
    defaultCommentTemplate: await getDefaultCommentTemplate(deps.db),
  });
  app.get('/api/settings', current);
  app.put('/api/settings', async (req): Promise<SettingsDto> => {
    const body = parse(settingsPutSchema, req.body);
    if (body.defaultTemplate !== undefined) {
      await setSetting(deps.db, SETTING_DEFAULT_TEMPLATE, body.defaultTemplate);
    }
    if (body.defaultCommentTemplate !== undefined) {
      await setSetting(deps.db, SETTING_DEFAULT_COMMENT_TEMPLATE, body.defaultCommentTemplate);
    }
    return current();
  });

  app.get('/api/health/integrations', async (): Promise<IntegrationsHealthDto> => {
    const trello = await deps.trello
      .getMe()
      .then((me) => ({ ok: true, username: me.username }))
      .catch((err: unknown) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    const registered = await deps.db.select().from(guilds).where(eq(guilds.enabled, true));
    let discord: IntegrationsHealthDto['discord'];
    try {
      const bot = await deps.validator.botUser({ fresh: true });
      let membersIntentEnabled: boolean | undefined;
      const sample = registered[0];
      if (sample) {
        membersIntentEnabled = await deps.validator
          .membersIntentEnabled(sample.discordGuildId)
          .catch(() => undefined);
      }
      discord = { ok: true, botUsername: bot.username, botUserId: bot.id, membersIntentEnabled };
    } catch (err) {
      discord = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return {
      trello,
      discord,
      guildCount: registered.length,
      publicBaseUrl: deps.publicBaseUrl,
      version: APP_VERSION,
    };
  });

  app.post('/api/admin/reconcile', async () => deps.boards.reconcileAll());
  app.post('/api/admin/recheck-mentions', async () => deps.mentionHealth.recheckAll());
}

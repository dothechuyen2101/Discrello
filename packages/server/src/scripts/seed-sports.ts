/**
 * Seeds the five pipeline roles with the ticket's message templates and, optionally, adds the
 * SPORTS board with its list → role mapping. Idempotent: existing rows are never overwritten.
 *
 *   pnpm seed:sports                                  # roles only
 *   pnpm seed:sports -- --board <trello url|id> --guild <discord guild id> --channel <channel id>
 *                     [--target editor=user:123 --target uploader=role:456 ...]
 */
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { loadConfig } from '../config';
import { openDb } from '../db/client';
import { guilds, roles } from '../db/schema';
import { systemClock } from '../db/types';
import { RestDiscordClient, type DiscordClient } from '../discord/client';
import { MentionValidator } from '../discord/validate';
import { GuildService } from '../guilds/service';
import { RoleService } from '../roles/service';
import { BoardService } from '../boards/service';
import { TrelloClient, type TrelloApi } from '../trello/client';
import { ValidationFailedError } from '../errors';
import { makeFakeIntegrations } from '../demo';

export const SPORTS_ROLES = [
  {
    key: 'script_writer',
    displayName: 'Script Writer',
    template: '{mention} — {card_title} is ready for script writing',
  },
  {
    key: 'quality_checker',
    displayName: 'Script QC',
    template: '{mention} — {card_title} is ready for script quality checking',
  },
  {
    key: 'editor',
    displayName: 'Editor',
    template: '{mention} — {card_title} is ready for editing',
  },
  {
    key: 'editor_qc',
    displayName: 'Editor QC',
    template: '{mention} — {card_title} is ready for editing quality check',
  },
  {
    key: 'uploader',
    displayName: 'Uploader',
    template: '{mention} — {card_title} is ready for upload',
  },
] as const;

/** Trello list name (case-insensitive, trimmed) → role key. */
export const SPORTS_LIST_ROLES: Record<string, (typeof SPORTS_ROLES)[number]['key']> = {
  'script writer ready': 'script_writer',
  'sw qc step': 'quality_checker',
  'nfl editor ready': 'editor',
  'qc step': 'editor_qc',
  'ready to upload': 'uploader',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

async function main() {
  const config = loadConfig();
  const dbHandle = await openDb(config.DATABASE_URL);
  const db = dbHandle.db;
  const log = Fastify({ logger: { level: 'warn' } }).log;
  let discord: DiscordClient;
  let trello: TrelloApi;
  if (process.env['DISCRELLO_FAKE_INTEGRATIONS'] === '1' && config.NODE_ENV !== 'production') {
    ({ discord, trello } = makeFakeIntegrations());
    console.log('Using in-memory Discord/Trello fakes (DISCRELLO_FAKE_INTEGRATIONS=1)');
  } else {
    discord = new RestDiscordClient(config.DISCORD_BOT_TOKEN);
    trello = new TrelloClient(config.TRELLO_API_KEY, config.TRELLO_API_TOKEN);
  }
  const validator = new MentionValidator(discord);
  const guildService = new GuildService({ db, discord, validator, clock: systemClock });
  const roleService = new RoleService({ db, discord, validator, clock: systemClock });
  const boardService = new BoardService({
    db,
    trello,
    discord,
    validator,
    clock: systemClock,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    logger: log,
  });
  const todo: string[] = [];

  try {
    // 1. Roles (never overwrite an existing template — it may have been edited in the UI)
    const roleIds = new Map<string, number>();
    for (const r of SPORTS_ROLES) {
      const existing = await db.select().from(roles).where(eq(roles.key, r.key)).limit(1);
      if (existing[0]) {
        roleIds.set(r.key, existing[0].id);
        console.log(`role ${r.key}: exists`);
        continue;
      }
      const created = await roleService.create({
        key: r.key,
        displayName: r.displayName,
        defaultTemplate: r.template,
      });
      roleIds.set(r.key, created.id);
      console.log(`role ${r.key}: created`);
    }

    const boardRef = arg('board');
    const guildIdArg = arg('guild');
    const channelId = arg('channel');
    if (!boardRef) {
      console.log('No --board given; roles only.');
      return;
    }
    if (!guildIdArg || !channelId)
      throw new Error('--board requires --guild <discord guild id> and --channel <channel id>');

    // 2. Guild
    let guild = (
      await db.select().from(guilds).where(eq(guilds.discordGuildId, guildIdArg)).limit(1)
    )[0];
    if (!guild) {
      const dto = await guildService.add({ discordGuildId: guildIdArg });
      guild = (await db.select().from(guilds).where(eq(guilds.id, dto.id)).limit(1))[0]!;
      console.log(`server ${dto.name}: added`);
    } else {
      console.log(`server ${guild.name}: exists`);
    }

    // 3. Optional role targets, validated exactly like the UI would
    for (const spec of args('target')) {
      const m = /^([a-z0-9_]+)=(user|role):(\d{17,20})$/.exec(spec);
      if (!m)
        throw new Error(`--target must look like editor=user:123456789012345678 (got "${spec}")`);
      const roleId = roleIds.get(m[1]!);
      if (!roleId) throw new Error(`unknown role key ${m[1]}`);
      try {
        await roleService.putTarget(roleId, guild.id, { kind: m[2] as 'user' | 'role', id: m[3]! });
        console.log(`target ${m[1]}: set`);
      } catch (err) {
        if (err instanceof ValidationFailedError) {
          console.log(`target ${m[1]}: REJECTED — ${err.message} ${err.hint}`);
          todo.push(`Set a working Discord target for ${m[1]} in ${guild.name}`);
        } else throw err;
      }
    }

    // 4. Board + mappings
    const preview = await boardService.preview(boardRef);
    let boardId: number;
    if (preview.alreadyAdded) {
      const list = await boardService.list();
      boardId = list.find((b) => b.trelloBoardId === preview.trelloBoardId)!.id;
      console.log(`board ${preview.name}: exists`);
    } else {
      const detail = await boardService.add({
        ref: boardRef,
        guildId: guild.id,
        discordChannelId: channelId,
      });
      boardId = detail.id;
      console.log(`board ${detail.name}: added (webhook ${detail.webhookStatus})`);
    }
    const detail = await boardService.detail(boardId);
    for (const list of detail.lists) {
      const roleKey = SPORTS_LIST_ROLES[list.name.trim().toLowerCase()];
      if (!roleKey) continue;
      if (detail.mappings.some((m) => m.trelloListId === list.trelloListId)) {
        console.log(`list "${list.name}": already mapped`);
        continue;
      }
      const role = SPORTS_ROLES.find((r) => r.key === roleKey)!;
      try {
        await boardService.upsertMapping(boardId, list.trelloListId, {
          roleId: roleIds.get(roleKey)!,
          messageTemplate: role.template,
          enabled: true,
        });
        console.log(`list "${list.name}" → ${roleKey}: mapped`);
      } catch (err) {
        if (err instanceof ValidationFailedError) {
          console.log(`list "${list.name}" → ${roleKey}: NOT mapped — ${err.message}`);
          todo.push(
            `Map "${list.name}" to ${roleKey} in the UI once the role has a valid Discord target`,
          );
        } else throw err;
      }
    }
  } finally {
    await dbHandle.close();
  }
  if (todo.length) {
    console.log('\nStill to do in the UI:');
    for (const t of todo) console.log(`  - ${t}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

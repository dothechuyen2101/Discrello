# Plan: Discrello — Trello → Discord role notifier (revision 2)

> Revision 2 (2026-09-24) incorporates the review feedback: Supabase instead of SQLite; several Discord servers per deployment; v1 handles card moves only; mention targets are verified to actually ping someone at config-save time; Trello signature security, dedupe, per-stage editable messages and the send log each get their own section; the "Moved to … →" prefix is dropped from templates.

> Deployment update (2026-09-24): the production VPS already runs a scraper whose nginx owns ports 80/443, so Caddy is dropped. Discrello runs in Docker bound to 127.0.0.1 behind a dedicated nginx server block with a certbot certificate, on a DuckDNS subdomain (section 17).

## 1. Context

Each list on the Trello board is a pipeline stage owned by a role (script writer → script QC → editor → editor QC → uploader). Today, when a card is handed to the next stage, the responsible person has to notice it themselves, which slows the pipeline down. We need a Discord bot that automatically pings the right person the moment a card lands in their list, reusable for future boards and future Discord servers through configuration alone.

The repo `/home/dtc/Desktop/Discrello` is currently **completely empty** (no commits). This is a greenfield project.

**Requirements from the ticket** (all must be satisfied):
1. Card enters a list → the bot posts a message in the channel, @-mentions that role's person, and names the card.
2. Reusable: the list → role → Discord ID → message mapping is configuration, not hardcoded. Adding a new board = adding config.
3. A UI to add/edit the Discord ID for each role, and to set up the list→role mapping + message per board.
4. Message text per stage is editable in the UI (not fixed strings in code).

**Additional requirements from the review** (2026-09-24):
5. Configuration and logs live in Supabase, not in a single file on the VPS.
6. A role mention must **actually notify** someone; if it cannot, fail at config-save time.
7. Verify the Trello webhook signature, since the callback is a public URL.
8. Dedupe when Trello retries; log what was sent and why anything failed.
9. Adding a second Discord server must not require another deployment.
10. v1 handles card moves only; the card-creation option defaults to off.
11. Templates carry no "Moved to {list} →" prefix.

## 2. Decisions

| Topic | Decision |
|---|---|
| Tech stack | Node.js + TypeScript. Fastify (webhook + REST API), React + Vite (UI), **Supabase Postgres via Drizzle ORM (`postgres` driver)**, `@discordjs/rest` (REST only, no gateway), Zod, Vitest (**PGlite** as in-memory Postgres for tests), pnpm workspaces |
| Storage | All configuration + logs in Supabase. The VPS container is **stateless**, no volume. Tables live in a dedicated schema `discrello` that is not in Supabase's "Exposed schemas", so nothing leaks through the anon key |
| Deployment | Docker on a VPS that already runs other production services (a YouTube Shorts scraper) whose nginx owns ports 80/443, so **no Caddy**: the container binds to `127.0.0.1:${DISCRELLO_PORT}` only, the host's nginx gets a dedicated server block that proxies a **DuckDNS subdomain** (`discrello.duckdns.org`) to it, and **certbot** issues its certificate. Local dev uses cloudflared/ngrok for Trello webhooks |
| Trigger (v1) | **Card moves only**: `updateCard` with `data.listAfter` (dragged between lists on the board) and `moveCardToBoard` (moved in from another board). Create/copy/convert: **not supported**, logged as `unsupported_action`. When added later it will be per-board opt-in, **default off** |
| Discord servers | **Several guilds per deployment**: one bot token, the bot is invited to several servers, guilds are registered in the UI, each board belongs to one guild + channel. "One guild per deployment" in revision 1 was an initial assumption, not a rule |
| Role scope | Global roles (key, name, default template) + **a mention target per guild** (`role_targets`) + optional per-mapping override |
| Mentions | **Block the save** when the target cannot ping anyone (static checks against the Discord API, section 6); **verify after sending** via the returned message; **re-check periodically** + per-guild alert channel |
| UI auth | Admin password from env + encrypted session cookie. Upgrading to Supabase Auth is later work, outside v1 |

## 3. Verified API facts

**Trello**
- Register a webhook: `POST /1/webhooks?key=&token=` with `callbackURL`, `idModel` (board id), `description`. Trello sends a **HEAD** request to callbackURL and requires **200**.
- Signature: header `X-Trello-Webhook` = base64(HMAC-SHA1(rawBody + callbackURL, **the app's OAuth secret**)). Hash the raw body, use the callbackURL exactly as registered, compare with `crypto.timingSafeEqual`.
- Retries: 3 times (after 30s, 60s, 120s), **same `action.id`**. A webhook is disabled after 30 days of consecutive failures; one 200 resets it. Responding 410 deletes it.
- Payload `{ action, model, webhook }`. Card move: `action.type='updateCard'`, `action.data.listAfter/listBefore={id,name}`, `action.data.card={id,name,shortLink,idList}`, `action.data.board`, `action.memberCreator`. `moveCardToBoard`: destination list in `action.data.list`. `moveCardFromBoard` fires on the source board → ignore.

**Discord**
- Send: `POST /channels/{id}/messages` with `content` + `allowed_mentions` (`{ parse: [], users: [id] }` or `{ parse: [], roles: [id] }`). Mention a user with `<@ID>`, a role with `<@&ID>`.
- **A role mention pings only when**: the role has `mentionable=true` OR the bot has the `MENTION_EVERYONE` permission (bit `1<<17`) in that channel, AND the role id is in `allowed_mentions.roles`. Discord "always validates `allowed_mentions` against the sender's permissions". Missing any condition → the message shows `@Role` normally but **nobody is notified**. This is the silent failure section 6 blocks.
- A user mention pings when the user is a guild member **and can see the channel** (`VIEW_CHANNEL`). A user who cannot see the channel gets no notification.
- The message object returned after sending has `mentions[]` (users) and `mention_roles[]` (role ids) reflecting the mentions that were actually processed → used for post-send verification.
- Effective member permissions in a channel: base = @everyone permissions ∪ the member's role permissions (owner or `ADMINISTRATOR` → all) → apply the @everyone overwrite → role overwrites (deny, then allow) → member overwrite.
- Endpoints needed: `GET /users/@me/guilds` (guilds the bot is in), `GET /guilds/{id}` (owner), `GET /guilds/{id}/roles`, `GET /guilds/{id}/channels` (with `permission_overwrites`), `GET /guilds/{id}/members/{userId}` (single member, **no** privileged intent needed). `GET /guilds/{id}/members?limit=1000` (listing, to count a role's members) **requires the Server Members Intent** enabled in the Developer Portal (self-service, no approval below 100 servers).

## 4. How it works

```
Trello board ──webhook POST──► /webhooks/trello/:token
                                  │ 1. look up board by token (404 if unknown)
                                  │ 2. verify HMAC signature against the stored callbackURL (401 if wrong)
                                  │ 3. ingestEvent (one Postgres transaction):
                                  │      normalize → CardMoved | null (moves only)
                                  │      dedupe: INSERT webhook_events ON CONFLICT DO NOTHING
                                  │      resolve: board → guild → list mapping → role target/override → channel
                                  │      render template → INSERT notifications(status=pending)
                                  │ 4. respond 200 immediately, worker.wake()
                                  ▼
                         NotificationWorker (polls every 2s, claims FOR UPDATE SKIP LOCKED)
                                  │ POST Discord → read mentions/mention_roles from the response
                                  │ → sent | sent_no_mention (+alert) | retry(backoff) | failed (+alert)
                                  ▼
                           Discord channel: "<@123> — Card X is ready for editing"
```

## 5. Trello webhook security

The callback is a public URL; anyone who has it can POST a forged payload to make the bot ping Discord. Two layers, both mandatory:

1. **Random per-board token** in the path: `/webhooks/trello/<32 random hex>`. Unknown token → 404, nothing processed.
2. **`X-Trello-Webhook` signature**: HMAC-SHA1 over the **raw body** (a dedicated `parseAs: 'string'` parser scoped to this route only) + `boards.webhook_callback_url` (the URL exactly as registered, stored in the DB) with `TRELLO_API_SECRET`; compared with `timingSafeEqual`. Verified **before** JSON parsing and before any other query. Missing or wrong header → 401 + warn log with IP.

Accompanying rules:
- No flag to disable verification. The app refuses to start without `TRELLO_API_SECRET`; local dev uses the real secret.
- After verification, `action.data.board.id` must still match the token's board (`board_mismatch` → ignored).
- Rate-limit the webhook route to 60 req/min/IP to block signature brute-forcing.
- Changing `PUBLIC_BASE_URL` → new callbackURL → re-register and store the new URL; verification always uses the URL in the DB, so nothing breaks mid-flight.
- Tests: known-answer HMAC; one byte of body changed → 401; different URL → 401; missing header → 401; unknown token → 404; valid payload → 200.

## 6. Making sure a mention actually pings someone

### 6.1 Validation at config-save time (blocks the save, HTTP 422)

Runs when: saving a role target (role × guild), saving a mapping (mention/channel override), changing a board's default channel, adding a guild. For target T posting into channel C of guild G, all of the following must hold:

1. **Bot** is a member of G; the bot's effective permissions in C include `VIEW_CHANNEL` + `SEND_MESSAGES` (threads: also `SEND_MESSAGES_IN_THREADS`).
2. **Channel C** belongs to G; type text (0), announcement (5) or a non-archived thread (10/11/12).
3. **T is a Discord role**: exists in G, is not `@everyone`; `mentionable=true` OR the bot has `MENTION_EVERYONE` in C; has **at least one member who holds the role and can see C** (counted from the member list, needs the Server Members Intent).
4. **T is a user**: is a member of G, not a bot; effective permissions in C include `VIEW_CHANNEL`.

Errors return `{ code, message, hint }`, e.g. `ROLE_NOT_PINGABLE`: "Role @Editors is not mentionable and the bot lacks 'Mention @everyone, @here, and All Roles' in #nfl-editing. Enable 'Allow anyone to @mention this role' on the role, or grant the bot that permission in the channel." The UI shows the error right under the form and **nothing is saved**. No "save anyway" in v1.

Scope of the check per saved object:
- Mapping: effective target (`override ?? role_target[role, guild]`) × effective channel (`override ?? board.channel`).
- Board (channel/guild change): re-run for every mapping on the board.
- Role target: run against the channel of **every board in the guild** that uses the role; if no board uses it yet, check existence + membership, and re-check permissions when the first mapping is created.
- Guild: bot is a member; if `alert_channel_id` is set, the bot can post there.

### 6.2 `allowed_mentions` is always explicit
Every outgoing message carries `allowed_mentions` containing exactly the target (`users:[id]` or `roles:[id]`, `parse: []`). A unit test guarantees it is never omitted.

### 6.3 Post-send verification
Read the returned Discord message: a user target must appear in `mentions[].id`, a role target in `mention_roles`. Missing → status `sent_no_mention`, error "Message posted but Discord did not register the mention", alerted like `failed`. (M2 confirms this behaviour with a real Discord test; if Discord does not reflect it reliably, downgrade to a warning without changing the status.)

### 6.4 Periodic re-check
A 15-minute job re-runs 6.1 for every role target and mapping of enabled boards (permissions/mentionable can change after saving). Stores `check_status`, `check_error`, `checked_at`. A transition `ok → error` → posts an alert to `guilds.alert_channel_id` (if set) + log; the UI shows a red badge on Roles and Boards. "Re-check now" button on Settings.

### 6.5 Test send
"Send test ping" on Roles (per guild) and Board detail (per mapping): sends a real message to the effective channel and reports the 6.3 verification result.

### 6.6 Discord setup requirements
Enable the **Server Members Intent** in the Developer Portal (to count a role's members). Invite the bot with View Channels, Send Messages, and Mention Everyone when non-mentionable roles are used. If the intent is off, `/api/health/integrations` reports it and every role-target check fails with a clear hint.

## 7. Dedupe, per-stage message editing in the UI, send log

### 7.1 Dedupe
- The dedupe key is Trello's `action.id`: retries carry the same id. `webhook_events.trello_action_id` UNIQUE; `INSERT … ON CONFLICT (trello_action_id) DO NOTHING RETURNING id` in the **same transaction** as the notification insert. No row returned → duplicate → bump `duplicate_count`, respond 200 silently so Trello stops retrying.
- Second layer: `notifications.trello_action_id` UNIQUE.
- The worker claims with `UPDATE notifications SET status='sending', locked_at=now() WHERE id IN (SELECT id … WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`. A row is never sent by two workers at once; a `sending` row older than 2 minutes (crash) goes back to `pending`.
- Accepted limit: a crash between Discord accepting the message and writing `sent` → at most one duplicate (Discord has no idempotency key for message creation).
- Tests: the same payload POSTed twice → 1 notification, both 200; two workers in parallel → each row sent exactly once.

### 7.2 Per-stage message editing in the UI
- Each mapping (list) has its own `message_template`, edited on Board detail with `TemplateEditor`: textarea, click-to-insert variable chips, warnings for unknown variables and a missing `{mention}`, live preview using the same renderer as the server, "Send test" button.
- Variables: `{mention}`, `{card_title}`, `{card_url}`, `{list_name}`, `{previous_list_name}`, `{board_name}`, `{moved_by}`.
- Precedence when a mapping is created: `role.default_template` → `settings.default_template`. Afterwards the mapping's template is the single source.
- Default templates from the ticket, **without the "Moved to … →" prefix** (the arrow in the ticket only denotes trigger → message):
  - `script_writer`: `{mention} — {card_title} is ready for script writing`
  - `quality_checker`: `{mention} — {card_title} is ready for script quality checking`
  - `editor`: `{mention} — {card_title} is ready for editing`
  - `editor_qc`: `{mention} — {card_title} is ready for editing quality check`
  - `uploader`: `{mention} — {card_title} is ready for upload`
  - global default (Settings): `{mention} — {card_title} is ready for {list_name}`
- No message text lives in code: the seed writes to the DB once and never overwrites existing values.

### 7.3 Send log and failure reasons
- Table `notifications`: every message sent or attempted, with board, guild, list, card, role, channel, `content`, `allowed_mentions`, `status` (`pending`/`sending`/`sent`/`sent_no_mention`/`failed`), `attempts`, `last_error` (human-readable, e.g. "Bot lacks Send Messages in #nfl-editing"), `discord_message_id`, timestamps.
- Table `webhook_events`: every received event including ignored ones, with the reason (`unsupported_action`, `no_mapping`, `guild_disabled`, `board_disabled`, `mapping_disabled`, `board_mismatch`) and `duplicate_count`.
- Notifications UI: filter by guild/board/status, error column, Retry, detail drawer (content, allowed_mentions, message id); `failed` and `sent_no_mention` highlighted; "Webhook events" tab answers "why didn't it fire".
- Proactive alerts: `failed`/`sent_no_mention` → post to the guild's `alert_channel_id` (if configured) with the card link and the error.
- Retention 90 days (`notifications`), 30 days (`webhook_events`); daily prune job.

## 8. Several Discord servers in one deployment

- One bot token; invite the bot to each server. "Guilds" UI: "Fetch servers the bot is in" (`GET /users/@me/guilds`) → pick → save to `guilds` (`discord_guild_id`, `name`, optional `alert_channel_id`). Or paste a guild id and the app checks that the bot is in it.
- A board belongs to exactly one guild; the default channel and every override channel must belong to that guild (validated on save).
- Roles are global; `role_targets` per (role, guild). The Roles page has a tab per guild showing the target + check status.
- Mention resolution: `mapping.override ?? role_targets[role, board.guild]`; missing → `failed` with a clear error (blocked at mapping save; only happens if the target was deleted afterwards).
- Adding a second server = invite the bot + add the guild in the UI + set targets for the roles in that guild. No redeploy, no env change.

## 9. Repo layout (pnpm workspaces, 3 packages)

Why a monorepo: `server` (Node) and `web` (DOM/JSX/Vite) need different tsconfigs and build tools. `shared` holds the template renderer, mention formatter and zod schemas used identically by the server and the UI preview.

```
Discrello/
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example
├── Dockerfile  docker-compose.yml  README.md
├── deploy/                    # nginx/discrello.conf.template  setup-nginx.sh  duckdns-update.sh
└── packages/
    ├── shared/src/            # @discrello/shared — pure TS, depends only on zod
    │   ├── template.ts        # renderTemplate(), TEMPLATE_VARIABLES, findUnknownVariables()
    │   ├── mention.ts         # formatMention({kind,id}), allowedMentionsFor(), isSnowflake()
    │   ├── trello-ref.ts      # parseTrelloBoardRef(urlOrId)
    │   └── schemas/           # guild.ts role.ts roleTarget.ts board.ts mapping.ts notification.ts settings.ts auth.ts
    ├── server/                # @discrello/server — tsup → dist/index.js, dist/migrate.js
    │   ├── drizzle/           # SQL migrations (committed)
    │   ├── src/
    │   │   ├── index.ts       # main: config → db → buildApp → worker/jobs → listen
    │   │   ├── migrate.ts     # runs migrations then exits (container entrypoint runs it before index)
    │   │   ├── app.ts         # buildApp(deps) — Fastify factory, deps injected for tests
    │   │   ├── config.ts      # zod-parse env, fail fast
    │   │   ├── db/            # schema.ts (pgSchema 'discrello') client.ts repos/*.ts
    │   │   ├── trello/        # client.ts signature.ts normalize.ts webhookRoute.ts types.ts
    │   │   ├── discord/       # client.ts fake.ts permissions.ts validate.ts
    │   │   ├── notifications/ # resolve.ts ingest.ts worker.ts backoff.ts verifyMention.ts alerts.ts
    │   │   ├── boards/service.ts
    │   │   ├── guilds/service.ts
    │   │   ├── jobs/          # scheduler.ts webhookHealth.ts mentionHealth.ts prune.ts
    │   │   ├── http/          # auth.ts errorHandler.ts static.ts routes/*.ts
    │   │   └── scripts/seed-sports.ts
    │   └── test/              # fixtures/trello/*.json fixtures/discord/*.json unit/ integration/ helpers/
    └── web/src/               # @discrello/web — React 19 + Vite + React Router + TanStack Query + Tailwind
        ├── api/               # client.ts hooks.ts
        ├── pages/             # Login Guilds Roles Boards AddBoard BoardDetail Notifications Settings
        └── components/        # TemplateEditor TemplatePreview MentionTargetInput MappingRow CheckStatusBadge WebhookStatusBadge ...
```

## 10. Data model (Postgres on Supabase, schema `discrello`)

Conventions: PK `bigint generated always as identity`, `timestamptz` timestamps, real booleans, Discord/Trello ids as `text`. Dedicated schema `discrello`, **not** added to Supabase's "Exposed schemas". Connect with the **Session pooler URI** (IPv4, port 5432), `postgres` driver with `max: 5`. Migrations via drizzle-kit, applied by `dist/migrate.js` before the app starts.

**`guilds`**
- `id`, `discord_guild_id` UNIQUE, `name`, `alert_channel_id` NULL
- `bot_status` (`ok`|`not_in_guild`|`missing_permissions`|`unchecked`), `bot_check_error`, `bot_checked_at`
- `enabled`, `created_at`, `updated_at`

**`roles`** (global)
- `id`, `key` UNIQUE (slug `^[a-z0-9_]+$`), `display_name`, `default_template` NULL, `created_at`, `updated_at`

**`role_targets`** (a role's mention target in one guild)
- `id`, `role_id` FK CASCADE, `guild_id` FK CASCADE, UNIQUE(`role_id`, `guild_id`)
- `mention_kind` (`user`|`role`), `mention_id` (snowflake)
- `check_status` (`ok`|`error`|`unchecked`), `check_error`, `checked_at`, `created_at`, `updated_at`

**`boards`**
- `id`, `trello_board_id` UNIQUE, `trello_short_link`, `name`, `url`, `closed`
- `guild_id` FK RESTRICT, `discord_channel_id`, `enabled`
- `webhook_token` UNIQUE (32 hex), `webhook_id`, `webhook_callback_url`, `webhook_status` (`unregistered`|`active`|`inactive`|`missing`|`mismatch`|`error`), `webhook_consecutive_failures`, `webhook_last_checked_at`, `webhook_last_error`
- `last_event_at`, `lists_synced_at`, `created_at`, `updated_at`

**`trello_lists`**: `id`, `board_id` FK CASCADE, `trello_list_id` UNIQUE, `name`, `pos`, `closed`, `missing`, `last_seen_at`

**`list_mappings`** — one row = one list that notifies; no row = no notification
- `id`, `board_id` FK CASCADE, `trello_list_id`, UNIQUE(`board_id`, `trello_list_id`)
- `role_id` FK RESTRICT, `message_template` NOT NULL
- `override_mention_kind`, `override_mention_id` (both null or both set), `override_channel_id` NULL
- `check_status`, `check_error`, `checked_at`, `enabled`, `created_at`, `updated_at`

**`webhook_events`** — dedupe + "why didn't it fire" log
- `id`, `trello_action_id` UNIQUE, `board_id` FK CASCADE, `action_type`, `card_id`, `card_name`, `list_id`, `list_name`
- `outcome` (`enqueued`|`ignored`), `ignore_reason` (`unsupported_action`|`board_mismatch`|`guild_disabled`|`board_disabled`|`no_mapping`|`mapping_disabled`), `duplicate_count` DEFAULT 0, `received_at`
- Index `(board_id, received_at DESC)`

**`notifications`** — durable outbox and send log
- `id`, `trello_action_id` UNIQUE, `board_id` FK CASCADE, `guild_id` FK RESTRICT, `list_mapping_id` FK SET NULL, `role_id` FK SET NULL
- `trigger_type`, `card_id`, `card_name`, `card_short_link`, `card_url`, `list_id`, `list_name`, `previous_list_name`, `board_name`, `actor_name`
- `discord_channel_id`, `mention_kind`, `mention_id`, `content`, `allowed_mentions_json`
- `status` (`pending`|`sending`|`sent`|`sent_no_mention`|`failed`), `attempts`, `next_attempt_at`, `locked_at`, `last_error`, `discord_message_id`, `mention_verified` boolean NULL
- `created_at`, `updated_at`, `sent_at`
- Indexes `(status, next_attempt_at)`, `(guild_id, created_at DESC)`, `(board_id, created_at DESC)`

**`settings`**: `key` PK (`default_template`), `value`

**Sessions**: no table, `@fastify/secure-session` (encrypted, stateless cookie).

## 11. Server modules — responsibility per file

- **`config.ts`**: env `PORT`, `HOST`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `TRELLO_API_KEY`, `TRELLO_API_TOKEN`, `TRELLO_API_SECRET`, `DISCORD_BOT_TOKEN`, `ADMIN_PASSWORD` (≥12), `SESSION_SECRET` (≥32), `LOG_LEVEL`. Missing → print the list and exit.
- **`db/client.ts`**: `createDb(url)` → `postgres` + `drizzle`; `createTestDb()` → PGlite + the same migrations. `db/repos/*`: plain queries. `notifications.ts` has `claimDue` (SKIP LOCKED), `reclaimStale`, `markSent`, `markSentNoMention`, `scheduleRetry`, `markFailed`, `listPage`.
- **`trello/client.ts`**: `getMe`, `getBoard`, `getLists`, `createWebhook`, `getWebhook`, `updateWebhook`, `deleteWebhook`, `listTokenWebhooks`. Throws `TrelloApiError{status, body}`.
- **`trello/signature.ts`**: `computeTrelloSignature`, `verifyTrelloSignature` (timingSafeEqual + length guard). Pure.
- **`trello/normalize.ts`**: `normalizeAction(payload): CardMoved | null`. Only `updateCard` with `data.listAfter.id` and `moveCardToBoard` (list in `data.list`). Every other action → `null` with `reason: 'unsupported_action'`.
  ```ts
  type CardMoved = {
    actionId; actionType; occurredAt;
    board: {id,name}; list: {id,name}; previousList?: {id,name};
    card: {id, name, shortLink, url};   // url = https://trello.com/c/{shortLink}
    actor?: {id, username, fullName};
  }
  ```
- **`trello/webhookRoute.ts`**: encapsulated plugin, dedicated raw-body parser, rate limit. `HEAD` → 200. `POST` → board by token → verify signature → `ingestEvent` → `worker.wake()` → 200. Errors before persisting → 500 so Trello retries.
- **`discord/client.ts`**: interface `DiscordClient { sendMessage → message object; getCurrentUser; getCurrentUserGuilds; getGuild; getGuildRoles; getGuildChannels; getGuildMember; listGuildMembers (paginated) }`. `RestDiscordClient` wraps `@discordjs/rest`. Error classification → `DiscordSendError{status, code, retryable}`: retryable = network/5xx; non-retryable = 400/401/403 (`50001`, `50013`)/404 (`10003`). Truncates `content` to ≤ 2000 chars. `fake.ts`: `FakeDiscordClient` backed by guild/roles/channels/members fixtures, records sends, programmable failures.
- **`discord/permissions.ts`**: pure `computeChannelPermissions({guild, roles, member, channel})` → bitfield; `has(perms, PermissionFlagsBits.X)`. Standard algorithm (owner/ADMINISTRATOR → all; @everyone → role overwrites → member overwrite).
- **`discord/validate.ts`**: `validateTarget({guildId, channelId, target})` implements 6.1, returns `{ ok: true }` or `{ ok: false, code, message, hint }`. Caches guild data (roles/channels/members) for 60 seconds to avoid hammering the API when saving many mappings.
- **`notifications/resolve.ts`**: pure `resolve(event, board, guild, mapping?, roleTarget?)` → `ignore(reason)` | `notify({channelId, mention, template, vars})`.
- **`notifications/ingest.ts`**: one transaction: normalize → check board id → dedupe → resolve → render → insert. Missing mention → insert as `failed` with a clear error.
- **`notifications/worker.ts`**: `start()`, `wake()`, `processOnce()` (reclaimStale → claimDue → send sequentially → `verifyMention` → update status → `alerts.notify` on failed/sent_no_mention), `stop()`. **`backoff.ts`**: `MAX_ATTEMPTS=5`, `BACKOFF_MS=[5s, 30s, 2m, 10m, 30m]`. **`verifyMention.ts`**: compares the returned message with the target. **`alerts.ts`**: posts alerts to the guild's `alert_channel_id`.
- **`boards/service.ts`**: `previewBoard`, `addBoard` (validates the channel against the guild per 6.1 before writing), `registerWebhook`, `checkWebhook`, `syncLists`, `removeBoard`, `reconcileAll`, `upsertMapping` (validates 6.1 before writing).
- **`guilds/service.ts`**: `listBotGuilds`, `addGuild` (validates bot membership + alert channel), `checkGuild`, `removeGuild` (409 if boards remain).
- **`jobs/`**: `webhookHealth` (15 min), `mentionHealth` (15 min, section 6.4), `prune` (daily).
- **`http/auth.ts`**: `@fastify/secure-session`; login rate-limited 10/min/IP, SHA-256 compared with `timingSafeEqual`; `requireAuth` on every `/api/*` except login/health. Cookie `httpOnly`, `sameSite=lax`, `secure` in production, 7 days.
- **`http/errorHandler.ts`**: ZodError → 400; `ValidationFailed` (6.1) → 422 `{code, message, hint}`; `AppError` → its status; Trello/Discord → 502; otherwise 500.
- **`http/static.ts`**: serves `web/dist` + SPA fallback (except `/api`, `/webhooks`).
- **`app.ts`** / **`index.ts`**: factory with injected deps; startup `reconcileAll` + `mentionHealth` (non-fatal); graceful shutdown.

## 12. REST API (`/api`, JSON, auth required unless marked public)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{password}` → cookie (public, rate-limited) |
| POST / GET | `/api/auth/logout`, `/api/auth/me` | |
| GET | `/api/health` | liveness + DB ping (public) |
| GET | `/api/health/integrations` | Trello token, Discord bot user, Server Members Intent enabled or not, guild count |
| GET | `/api/discord/bot-guilds` | guilds the bot is in (for adding) |
| GET/POST | `/api/guilds` | list (with bot_status, board count) / add `{discordGuildId, alertChannelId?}` (validated) |
| PATCH/DELETE | `/api/guilds/:id` | edit alert channel, enabled / delete (409 if boards remain) |
| POST | `/api/guilds/:id/check` | check bot + alert channel now |
| GET | `/api/guilds/:id/channels`, `/api/guilds/:id/roles` | UI helpers |
| GET/POST | `/api/roles` | list (with per-guild targets + check_status + usageCount) / create |
| PUT/DELETE | `/api/roles/:id` | edit key, name, default template / delete (409 if mapped) |
| PUT/DELETE | `/api/roles/:id/targets/:guildId` | set/remove the mention target in a guild (**422 if 6.1 fails**) |
| POST | `/api/roles/:id/targets/:guildId/test` | send a test ping to a given channel, returns the verification result |
| GET | `/api/boards` | list + guild + webhook status + mapping count + last event |
| POST | `/api/trello/boards/preview` | `{ref}` → board name + lists |
| POST | `/api/boards` | `{ref, guildId, discordChannelId}` → validate channel, create, register webhook |
| GET/PATCH/DELETE | `/api/boards/:id` | detail / edit channel, enabled (**422 if 6.1 fails**) / delete |
| POST | `/api/boards/:id/sync-lists` | refresh lists from Trello |
| POST | `/api/boards/:id/webhook/check`, `/webhook/register` | check / recreate the webhook |
| PUT/DELETE | `/api/boards/:id/mappings/:trelloListId` | upsert `{roleId, messageTemplate, overrideMention?, overrideChannelId?, enabled}` (**422 if 6.1 fails**) / remove |
| POST | `/api/boards/:id/mappings/:trelloListId/test` | render + real send + mention verification |
| GET | `/api/notifications` | `?guildId&boardId&status&limit&before` |
| GET / POST | `/api/notifications/:id`, `/api/notifications/:id/retry` | detail / re-resolve + re-render + `pending` |
| GET | `/api/webhook-events` | `?boardId&outcome&limit&before` |
| GET/PUT | `/api/settings` | `{defaultTemplate}` |
| POST | `/api/admin/reconcile`, `/api/admin/recheck-mentions` | run the jobs now |

Outside `/api` (no auth, signature-verified): `HEAD|POST /webhooks/trello/:token`.

## 13. UI (React, in English since the team ticket is in English)

- **Login**: password, 401 error, redirect to Boards.
- **Layout**: nav Guilds / Roles / Boards / Notifications / Settings; integration status dot; logout.
- **Guilds**: table (name, id, bot status badge, alert channel, board count); "Add server": pick from the list the bot is in or paste an id; choose alert channel; "Check now"; delete.
- **Roles**: role table (name, key, default template, "used by N mappings"); each role expands into **a tab per guild**: `MentionTargetInput` (User/Role + picker from `/guilds/:id/roles` or typed id) + `CheckStatusBadge` (ok/error with hint) + "Send test ping". A 422 on save → error + hint inline, value not saved.
- **Boards**: table: name (Trello link), guild, channel, enabled, `WebhookStatusBadge`, mapping check summary (x/y ok), last event. "Add board".
- **Add board**: paste Trello URL → Fetch → pick guild → pick channel → Create.
- **Board detail / mapping editor**: header (guild, channel, enabled, webhook badge + Check/Re-register, Re-sync lists, Remove). One `MappingRow` per list: list name, role select, Advanced (mention/channel override), `TemplateEditor` + `TemplatePreview`, `CheckStatusBadge`, enabled, Save, "Send test". A 422 on save → error + hint inside the row.
- **Notifications**: Notifications tab (filter guild/board/status; `failed` and `sent_no_mention` highlighted; Retry; drawer) and Webhook events tab (ignore reason, duplicate_count).
- **Settings**: default template, integration health (Trello user, bot username, intent status, PUBLIC_BASE_URL), "Reconcile webhooks", "Re-check mentions", version.

## 14. Edge cases & decisions

| Situation | Handling |
|---|---|
| Card dragged A→B then B→A immediately | 2 actions → 2 pings. No debounce in v1. |
| New card created / copied / converted into a mapped list | Ignored in v1, logged `unsupported_action`. Added later as per-board opt-in, default off. |
| List with no mapping | `ignored/no_mapping`. |
| Role has no target in the board's guild | Blocked at mapping save (422). If the target is deleted later → `failed` + alert. |
| Someone turns off "mentionable" or removes the bot's permission after saving | The 15-minute job detects it → red badge + alert channel message; messages sent meanwhile → `sent_no_mention` + alert. |
| Role has no members anymore | Job detects → error; messages sent ping nobody → `sent_no_mention`. |
| User leaves the server / loses channel access | Same as above. |
| Board archived / list archived | `closed` refreshed on sync/health; mapping kept (greyed). |
| Trello disables the webhook | Job detects `active:false` → re-enable; 404 → recreate. |
| `PUBLIC_BASE_URL` changes | `mismatch` → re-register; verification uses the URL in the DB. |
| Same list name on different boards | Keyed by `(board_id, trello_list_id)`. |
| Several lists → the same role | Supported; each mapping has its own template + channel. |
| Server restart with pending/sending rows | `pending` is drained; `sending` older than 2 minutes → `pending`. |
| Trello redelivery | ON CONFLICT DO NOTHING → silent 200. |
| Board id does not match the token | `board_mismatch`, warn. |
| Bad signature / missing header | 401, not processed. |
| Card title contains `@everyone`/markdown | `allowed_mentions.parse: []` blocks it; markdown left as-is. |
| Supabase temporarily unreachable | Webhook → 500 so Trello retries (up to 3 times, ~3.5 min); worker retries with backoff; `/api/health` goes red. |
| Deleting a role/guild in use | 409. |

## 15. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + DB | pnpm workspaces; Supabase project + `discrello` schema + first migration; `createTestDb()` on PGlite runs the same migrations; `pnpm build`/`test`/`dev`; `GET /api/health` pings the DB; Docker image builds |
| M1 | Pure core | Unit tests: template, mention, `normalizeAction` (moves only; a fixture per action type including ignored ones), signature, `computeChannelPermissions` (overwrite fixtures) |
| M2 | Webhook pipeline | Integration tests on PGlite: signature → dedupe → notification → worker (SKIP LOCKED) → FakeDiscord → `verifyMention`. A real Discord test confirming `mention_roles` reflects allowed_mentions |
| M3 | Validation + services + API + auth | `validateTarget` against FakeDiscord fixtures for every 6.1 rule; guilds/roles/boards/mappings API return the right 422s; add a board via curl → webhook registered → move a real card → real ping |
| M4 | Web UI | Full flow: login → add guild → roles per guild (see the 422 inline) → add board → mapping + preview + test → notifications log |
| M5 | Ops | Docker on 127.0.0.1 behind the VPS's nginx + certbot, DuckDNS subdomain; migrate before start; health jobs; alert channel; SPORTS seed; README |

## 16. Dev workflow & credentials

**Prereqs**: Node 22 LTS, pnpm (corepack), `cloudflared` or `ngrok`, Docker (deploy), a Supabase account.

**Supabase**
1. Create a project → Project Settings → Database → Connect → **Session pooler** URI (IPv4, port 5432) → `DATABASE_URL`.
2. `pnpm db:migrate` creates the `discrello` schema and tables. Do not add `discrello` to Exposed schemas (Settings → API).
3. Local tests need no Supabase: PGlite in memory.

**Trello**
1. https://trello.com/power-ups/admin → New Power-Up → "API key" tab → Generate → `TRELLO_API_KEY`; the "Secret" on the same page → `TRELLO_API_SECRET`.
2. Token: `https://trello.com/1/authorize?expiration=never&name=Discrello&scope=read&response_type=token&key=<KEY>` → `TRELLO_API_TOKEN`. The token's user must be a member of every board that will be added. (If webhook creation returns 401 with `read`, regenerate with `scope=read,write`.)

**Discord**
1. Developer Portal → New Application → Bot → Reset Token → `DISCORD_BOT_TOKEN`. Enable the **Server Members Intent** (Privileged Gateway Intents).
2. OAuth2 → URL Generator → scope `bot`, permissions View Channels, Send Messages, Mention Everyone (when non-mentionable roles are used) → invite to **each** server.
3. Developer Mode to copy ids when typing them manually.

**Run locally**
```
cp .env.example .env
cloudflared tunnel --url http://localhost:3000    # copy the URL into PUBLIC_BASE_URL
pnpm install
pnpm db:migrate
pnpm dev                                          # server :3000 + web :5173 (proxies /api)
pnpm seed:sports -- --board https://trello.com/b/XXXX/sports --guild 123 --channel 456
```

**Try it without credentials**: `DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory pnpm --filter @discrello/server dev` runs the API against in-memory Discord/Trello fakes (one demo server, one demo board with 5 lists). Messages "sent to Discord" are logged instead. Dev only; refused when `NODE_ENV=production`.

**Seed script** (idempotent, never overwrites): the 5 roles with the templates from 7.2; with `--board` it calls `addBoard` and maps lists by name: "Script Writer Ready"→script_writer, "SW QC STEP"→quality_checker, "NFL editor ready"→editor, "QC step"→editor_qc, "ready to upload"→uploader; optional `--target script_writer=user:123 …` (goes through 6.1 validation). Prints what still needs to be filled in via the UI.

## 17. Docker / deploy

**Dockerfile** multi-stage on `node:22-bookworm-slim`: `deps` (`pnpm install --frozen-lockfile`) → `build` (`pnpm -r build`, `pnpm --filter @discrello/server deploy --prod /out`) → `runtime` (copy `/out` + `drizzle/` + `web/dist`; `USER node`; `HEALTHCHECK /api/health`; `CMD ["sh","-c","node dist/migrate.js && node dist/index.js"]`). No `VOLUME`.

**docker-compose.yml**: a single `app` service (build `.`, `env_file .env`, `restart: unless-stopped`) published on `127.0.0.1:${DISCRELLO_PORT:-3100}:3000` only, `mem_limit: 512m`, json-file logs capped at 3 × 10 MB. No application data volume. The VPS runs other production services and its nginx already owns 80/443, so there is no proxy container.

**nginx + certbot** (on the host): `deploy/nginx/discrello.conf.template` is a dedicated `server` block (`listen 80; server_name $DOMAIN;` → `proxy_pass http://127.0.0.1:$DISCRELLO_PORT` with `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`). `sudo deploy/setup-nginx.sh <domain> <email> [port]` checks that no other site uses the name, that DNS points at the VPS and that the app answers; writes only `discrello.conf`; runs `nginx -t` before every reload and removes its own file if the test fails; then `certbot --nginx -d <domain> --redirect`, which adds the 443 listener and HTTP→HTTPS redirect to that block only. Renewal via certbot's timer.

**DuckDNS**: the subdomain is created once on duckdns.org (the API cannot create subdomains) next to the account's existing one; `deploy/duckdns-update.sh` (optionally from cron) points it at the VPS with `update?domains=<sub>&token=<token>&ip=` (empty IP = caller's IP). `DOMAIN=discrello.duckdns.org`, `PUBLIC_BASE_URL=https://discrello.duckdns.org`.

**Client IP behind the proxy**: `TRUST_PROXY_HOPS=1` makes Fastify trust exactly one proxy, so rate limits use the address nginx appended to `X-Forwarded-For`, not one the client supplied (trusting every hop let rotating fake IPs bypass the 10/min login limit; covered by a test).

Backups: Supabase daily backups (Pro) or `pg_dump` via cron. One instance is enough; thanks to SKIP LOCKED several instances can run later.

## 18. Verification

**Unit (vitest)**: template; mention (`allowed_mentions` always explicit); normalize (move → CardMoved; create/copy/convert/rename/archive/`moveCardFromBoard` → null); signature (known-answer, tampered body, different URL, missing header); `computeChannelPermissions` (owner, admin, deny @everyone + allow role, member overwrite, thread); `validateTarget` with fixtures: role mentionable/not × bot with/without MENTION_EVERYONE, role with 0 members, role with members who cannot see the channel, user not in guild, user who cannot see the channel, bot missing SEND_MESSAGES, channel in the wrong guild, voice channel; resolve; backoff; trello-ref.

**Integration (PGlite, `app.inject()`, FakeDiscord, stub Trello)**:
- Happy path: guild + role target + board + mapping → POST signed `updateCard-move.json` → 200 → `pending` → `processOnce()` → FakeDiscord receives `{channelId, content: "<@123> — Card is ready for editing", allowed_mentions: {parse: [], users: ['123']}}` → response has `mentions:[{id:'123'}]` → `sent`, `mention_verified=true`.
- FakeDiscord returns a message without the mention → `sent_no_mention` + alert called.
- POST twice → 1 notification, `duplicate_count=1`. Two workers in parallel → each row sent once.
- Bad signature → 401; unknown token → 404; board id mismatch → ignored; `createCard` → ignored `unsupported_action`.
- Retry: retryable error twice then OK → `attempts=2`, `sent`; 403 → `failed` + alert.
- PUT role target with a non-mentionable role fixture and no bot permission → 422 `ROLE_NOT_PINGABLE`, DB unchanged. Fix the fixture → 200.
- PUT mapping with an override channel in another guild → 422.
- Boards API; deleting a role/guild in use → 409; auth.

**Manual E2E**:
1. Tunnel + `pnpm dev` + real Supabase; add a guild; set the `editor` target to a Discord role that is **not mentionable** while the bot lacks Mention Everyone → must see a 422 with the hint. Make it mentionable → save succeeds.
2. Add the SPORTS board; map "NFL editor ready" → editor; move a card → ping within ~2s; Notifications shows `sent`, `mention_verified`.
3. Turn the role's mentionable off on Discord → move a card → `sent_no_mention` + an alert in the alert channel; wait for the job (or Re-check) → red badge.
4. Set a channel where the bot lacks permission → 422 on save; fix → saves.
5. Replay the payload with curl (recompute the signature) → no duplicate ping; change one byte → 401.
6. Kill the server with a `sending` row → restart → resent after reclaim.
7. Add a second Discord server: invite the bot → Add server → set targets → add a board → pings land in the right server, no env change.
8. VPS: `deploy/duckdns-update.sh` → `docker compose up -d --build` → `sudo deploy/setup-nginx.sh discrello.duckdns.org <email> 3100` → `https://discrello.duckdns.org/api/health` 200 → repeat step 2. The template was verified with `nginx -t` in an nginx container proxying to the app container on 127.0.0.1:3100 (health, UI, Trello HEAD probe, forged webhook 404, 401 without login, `Secure` cookie, spoofed `X-Forwarded-For` still rate-limited).

## 19. Non-goals for v1

- Triggering on card create/copy/convert into a list (later, per-board opt-in, default off).
- Supabase Auth / multi-user / permissions / config audit trail.
- Trello OAuth "connect your account".
- Mapping Trello card members/assignees to Discord users.
- Debounce/digest pings; editing/deleting sent messages; embeds/buttons; slash commands.
- Detecting users who muted the channel or are in DND (Discord does not expose it).
- Metrics/alerting beyond the alert channel + UI log + pino.

## Most important files during implementation

- `packages/server/src/db/schema.ts` — data model
- `packages/server/src/discord/validate.ts` + `permissions.ts` — the "a mention must be able to ping" rules
- `packages/server/src/trello/signature.ts` + `webhookRoute.ts` — webhook security
- `packages/server/src/notifications/ingest.ts` + `worker.ts` — dedupe, outbox, post-send verification
- `packages/shared/src/template.ts` — renderer shared by the server and the UI

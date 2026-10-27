# Discrello — Trello → Discord role notifier

When a Trello card is moved into a list, Discrello posts a message in Discord that @-mentions the
person (or role) responsible for that stage and names the card:

> @Editor — *NFL Week 3 recap* is ready for editing

Revision feedback works the same way: a Trello comment that starts with `comment:` pings the person
responsible for the list the card is in now, with a per-list "feedback added" message (user guide,
section 5.1).

Everything is configuration, not code: Discord servers, roles and their Discord targets, teams
(groups of roles that are pinged together, organised in channel folders), boards, list →
role-or-team mappings, who receives each list's revision feedback, and the message text per stage
are all managed in a small web UI and stored in Supabase (Postgres). Adding a new
board or a second Discord server never requires a deploy.

The full design is in [`docs/PLAN.en.md`](docs/PLAN.en.md) (Vietnamese: [`docs/PLAN.vi.md`](docs/PLAN.vi.md)).
How to configure and use it day to day, including how to look at the data in Supabase, is in the
user guide: [`docs/USER_GUIDE.en.md`](docs/USER_GUIDE.en.md) (Vietnamese: [`docs/USER_GUIDE.vi.md`](docs/USER_GUIDE.vi.md)).
A step-by-step installation guide in Vietnamese is in [`docs/INSTALL.vi.md`](docs/INSTALL.vi.md); the
English equivalent is the Setup / Run locally / Deploy sections below. A 3-minute narrated video
walkthrough is in [`docs/video/discrello-tutorial.en.mp4`](docs/video/discrello-tutorial.en.mp4)
(regenerate it after UI changes with [`scripts/tutorial-video`](scripts/tutorial-video/README.md)).

## How it works

```
Trello board ──webhook POST──► /webhooks/trello/<per-board token>
                                  │ verify X-Trello-Webhook HMAC signature
                                  │ dedupe by Trello action id (retries are safe)
                                  │ list → role → Discord target → channel → rendered message
                                  │ insert into the notifications outbox (Supabase)
                                  ▼
                         worker: send to Discord, verify the mention registered,
                         retry with backoff, log every attempt, alert on failure
```

Key guarantees:

- **Webhook security** – two layers: a random 32-hex token per board in the URL and Trello's
  HMAC-SHA1 signature, verified over the raw body before anything else. No off switch.
- **Dedupe** – Trello redeliveries carry the same action id; a unique index plus
  `ON CONFLICT DO NOTHING` makes them no-ops. A revision comment is also keyed by its comment id, so
  it pings at most once even when it is edited later. The worker claims rows with `FOR UPDATE SKIP LOCKED`.
- **A mention must actually ping someone** – saving a role target, a mapping or a board channel
  runs live checks against Discord (bot can see/send in the channel, role is mentionable or the bot
  may mention all roles, role has members who can see the channel, user is a member who can see
  the channel). Failures come back as HTTP 422 with a message and a hint, and nothing is saved.
  After each send the Discord response is checked (`mentions` / `mention_roles`); if the ping did
  not register the notification is marked `sent_no_mention` and an alert is posted. A 15-minute
  job re-checks every target and mapping and alerts when something that used to work breaks.
- **Send log** – every notification (content, channel, status, attempts, error, Discord message
  id) and every received webhook event (including why it was ignored) is visible in the UI.

Only card **moves** trigger notifications in v1 (`updateCard` with a list change and
`moveCardToBoard`). Card creation/copy/convert is logged as `unsupported_action` and ignored.

## Requirements

- Node.js 22+, pnpm 10 (`corepack enable`)
- A Supabase project (or any Postgres 15+)
- A Trello API key + token + secret
- A Discord application with a bot token and the **Server Members Intent** enabled
- For production: a VPS with Docker, nginx and certbot, and a (DuckDNS) hostname pointing at it

## Setup

### 1. Supabase

1. Create a project. Project Settings → Database → Connect → copy the **Session pooler** URI
   (IPv4, port 5432) into `DATABASE_URL`.
2. Tables live in a dedicated schema `discrello`. Do **not** add it to "Exposed schemas"
   (Settings → API), so nothing is reachable through the anon key.
3. `pnpm db:migrate` creates the schema and tables (the Docker image does this on start).

### 2. Trello

1. https://trello.com/power-ups/admin → New Power-Up → tab **API key** → Generate.
   `TRELLO_API_KEY` = the key, `TRELLO_API_SECRET` = the **Secret** shown next to it (it signs
   webhooks).
2. Token: open
   `https://trello.com/1/authorize?expiration=never&name=Discrello&scope=read&response_type=token&key=<KEY>`
   → Allow → `TRELLO_API_TOKEN`. The token's user must be a member of every board you add.
   (If webhook registration fails with 401, regenerate with `scope=read,write`.)

### 3. Discord

1. https://discord.com/developers/applications → New Application → **Bot** → Reset Token →
   `DISCORD_BOT_TOKEN`.
2. Same page, **Privileged Gateway Intents** → enable **Server Members Intent** (needed to verify
   that a role has members).
3. OAuth2 → URL Generator → scope `bot`, permissions **View Channels**, **Send Messages**, and
   **Mention @everyone, @here, and All Roles** if you plan to ping roles that are not
   "mentionable". Open the URL and invite the bot to **each** server you want to notify.
4. To copy ids: Discord → Settings → Advanced → Developer Mode, then right-click → Copy ID.

### 4. Environment

```
cp .env.example .env   # then fill in the values described inside
```

`ADMIN_PASSWORD` protects the UI (12+ characters); `SESSION_SECRET` is any 32+ random characters
(`openssl rand -hex 32`). `PUBLIC_BASE_URL` must be the public HTTPS URL Trello can reach.

## Run locally

```
pnpm install
cloudflared tunnel --url http://localhost:3000     # copy the https URL into PUBLIC_BASE_URL
pnpm db:migrate
pnpm dev                                           # API on :3000, UI on :5173 (proxies /api)
```

Open http://localhost:5173, log in, then: **Guilds → Add server**, **Roles → create the roles
and set a Discord target per server**, **Boards → Add board**, map lists to roles and edit the
message per list. Use **Send test** buttons to confirm a ping actually reaches someone.

Trello quick tunnels change their URL on every run; the app re-registers its webhooks on startup
when `PUBLIC_BASE_URL` changed.

### Try it without any credentials

```
DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory pnpm --filter @discrello/server dev
```

runs the API against in-memory Discord/Trello fakes seeded with a demo server (`100000000000000000`,
channel `300000000000000000`, users `400000000000000000` / `410000000000000000`, roles
`500000000000000000` / `510000000000000000`) and a demo board (`DeMoBoRd`). Messages that would go to
Discord are logged instead. Combine with `pnpm --filter @discrello/web dev` for the UI.

### Seed the SPORTS board

```
pnpm seed:sports                                                   # the 5 roles + templates only
pnpm seed:sports -- --board https://trello.com/b/XXXX/sports \
    --guild <discord guild id> --channel <channel id> \
    --target editor=user:123456789012345678 --target uploader=role:234567890123456789
```

Creates `script_writer`, `quality_checker`, `editor`, `editor_qc`, `uploader` with the ticket's
messages, adds the board, and maps "Script Writer Ready", "SW QC STEP", "NFL editor ready",
"QC step" and "ready to upload". Targets go through the same validation as the UI; anything
rejected is printed as a to-do. Existing rows are never overwritten.

## Deploy (Docker behind the VPS's nginx, certbot, DuckDNS)

The target VPS already runs other production services and its nginx owns ports 80/443, so
Discrello never takes a public port. The container is published on `127.0.0.1:${DISCRELLO_PORT}`
only (default 3100), and a dedicated nginx server block proxies the DuckDNS hostname to it.
Existing nginx sites are not modified.

```
Internet ──HTTPS──► nginx (80/443)  ├─ existing sites (untouched)
                                    └─ discrello.conf ──► 127.0.0.1:3100 ──► container
```

1. On https://www.duckdns.org, add a subdomain (e.g. `discrello`) next to the existing one and
   copy the account token.
2. On the VPS:
   ```
   git clone <repo> discrello && cd discrello
   cp .env.example .env && $EDITOR .env
   #   DOMAIN=discrello.duckdns.org   PUBLIC_BASE_URL=https://discrello.duckdns.org
   #   DISCRELLO_PORT=3100            DUCKDNS_SUBDOMAIN=discrello   DUCKDNS_TOKEN=...
   deploy/duckdns-update.sh                        # points the subdomain at this VPS
   docker compose up -d --build                    # app on 127.0.0.1:3100
   sudo apt install certbot python3-certbot-nginx  # if missing
   sudo deploy/setup-nginx.sh discrello.duckdns.org you@example.com 3100
   curl https://discrello.duckdns.org/api/health
   ```

`deploy/setup-nginx.sh` checks that the host's nginx owns port 80, DNS, the app, and that no other
site uses the name; writes only `discrello.conf` from `deploy/nginx/discrello.conf.template` into
the directory nginx actually loads (read from `nginx -T`); runs `nginx -t` before every reload
(and removes its own file if the test fails); verifies the route through the public IP (not
127.0.0.1, which another block may own); then runs `certbot --nginx --redirect` for that hostname
only. Safe to re-run. Certificates renew through certbot's timer.

The container is stateless (no volume); all state is in Supabase. It applies migrations, then
starts the API, the notification worker, and the health jobs. It is capped at 512 MB RAM and
30 MB of logs. Keep `TRUST_PROXY_HOPS=1` so rate limits use the client IP nginx saw rather than
a client-supplied `X-Forwarded-For`. Run a single instance per database. Step-by-step
instructions (Vietnamese) are in [`docs/INSTALL.vi.md`](docs/INSTALL.vi.md), section 8.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API (tsx watch) + web (vite) |
| `pnpm build` | builds `shared`, `server` (tsup → `dist/`) and `web` (vite → `dist/`) |
| `pnpm test` | unit + integration tests (PGlite in memory, fakes for Discord/Trello) |
| `pnpm typecheck` | `tsc` for every package |
| `pnpm db:generate` | drizzle-kit: create a migration from `packages/server/src/db/schema.ts` |
| `pnpm db:migrate` | apply migrations to `DATABASE_URL` |
| `pnpm seed:sports` | see above |
| `pnpm e2e:demo` | drives the built UI in headless Chrome against a demo-mode server (see `scripts/e2e-demo.mjs`) |

## Troubleshooting

- **422 when saving a role target / mapping** – read the hint: it names the role, the channel and
  the exact Discord setting to change (usually "Allow anyone to @mention this role" or a missing
  bot permission).
- **"Server Members Intent" warning on Settings** – enable it in the Developer Portal; without it
  role targets cannot be verified.
- **Webhook badge is red** – "Check now" repairs it (re-enables or re-creates the Trello webhook).
  A `mismatch` after changing `PUBLIC_BASE_URL` is expected and fixes itself on the next start.
- **Notification `sent_no_mention`** – the message was posted but nobody was pinged. The alert
  channel message says why; typically the role stopped being mentionable or the user lost access.
- **Nothing fires** – Notifications → *Webhook events* lists every delivery and the reason it was
  ignored (`unsupported_action`, `no_mapping`, `board_disabled`, …).

# Kế hoạch: Discrello — Trello → Discord role notifier (bản 2)

> Bản 2 (2026-09-24) cập nhật theo phản hồi review: Supabase thay SQLite; nhiều Discord server trong một deployment; v1 chỉ xử lý di chuyển thẻ; kiểm tra mention thực sự ping được ngay khi lưu cấu hình; bảo mật chữ ký Trello, chống trùng lặp, sửa message theo stage và nhật ký gửi được tách thành mục riêng; bỏ tiền tố "Moved to … →" khỏi template.

> Cập nhật triển khai (2026-09-24): VPS production đang chạy scraper và nginx đã giữ cổng 80/443, nên bỏ Caddy. Discrello chạy trong Docker bind vào 127.0.0.1, phía sau một server block nginx riêng với chứng chỉ certbot, dùng subdomain DuckDNS (mục 17).

## 1. Bối cảnh

Mỗi list trên board Trello là một stage do một role phụ trách (script writer → script QC → editor → editor QC → uploader). Hiện tại khi card được chuyển sang stage kế tiếp, người phụ trách phải tự để ý, làm chậm pipeline. Cần một Discord bot tự động ping đúng người ngay khi card vào list của họ, dùng lại được cho các board và các Discord server tương lai chỉ bằng cấu hình.

Repo `/home/dtc/Desktop/Discrello` hiện **trống hoàn toàn** (chưa có commit). Đây là dự án greenfield.

**Yêu cầu từ ticket** (phải thỏa mãn hết):
1. Card vào list → bot post message vào channel, @-mention người của role đó, kèm tên card.
2. Reusable: mapping list → role → Discord ID → message là cấu hình, không hardcode. Thêm board mới = thêm config.
3. Có UI để thêm/sửa Discord ID cho từng role, và thiết lập mapping list→role + message cho từng board.
4. Message text theo từng stage sửa được trên UI (không phải string cố định trong code).

**Yêu cầu bổ sung từ review** (2026-09-24):
5. Cấu hình và nhật ký nằm trên Supabase, không nằm trong một file trên VPS.
6. Mention role phải **thực sự thông báo** cho ai đó; nếu không thể, báo lỗi ngay lúc lưu cấu hình.
7. Verify chữ ký webhook Trello vì callback là URL công khai.
8. Chống trùng lặp khi Trello retry; nhật ký những gì đã gửi và lý do gửi thất bại.
9. Thêm Discord server thứ hai không cần deploy thêm.
10. v1 chỉ xử lý di chuyển thẻ; tùy chọn tạo thẻ mặc định tắt.
11. Template không có tiền tố "Moved to {list} →".

## 2. Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Tech stack | Node.js + TypeScript. Fastify (webhook + REST API), React + Vite (UI), **Supabase Postgres qua Drizzle ORM (driver `postgres`)**, `@discordjs/rest` (chỉ REST, không gateway), Zod, Vitest (**PGlite** làm Postgres in-memory cho test), pnpm workspaces |
| Lưu trữ | Toàn bộ cấu hình + nhật ký trên Supabase. Container trên VPS **stateless**, không volume. Bảng đặt trong schema riêng `discrello`, không nằm trong "Exposed schemas" của Supabase API nên không lộ qua anon key |
| Deploy | Docker trên VPS đang chạy dịch vụ production khác (scraper YouTube Shorts), nginx của máy đã giữ cổng 80/443, nên **không dùng Caddy**: container chỉ bind `127.0.0.1:${DISCRELLO_PORT}`, nginx của máy có thêm một server block riêng chuyển tiếp **subdomain DuckDNS** (`discrello.duckdns.org`) vào đó, **certbot** cấp chứng chỉ. Dev local dùng cloudflared/ngrok cho webhook Trello |
| Trigger v1 | **Chỉ di chuyển thẻ**: `updateCard` có `data.listAfter` (kéo giữa list trong board) và `moveCardToBoard` (chuyển từ board khác sang). Tạo/copy/convert card: **chưa hỗ trợ**, ghi log `unsupported_action`. Khi bổ sung sau sẽ là opt-in theo board, **mặc định tắt** |
| Discord server | **Nhiều guild trong một deployment**: một bot token, bot được mời vào nhiều server, guild đăng ký qua UI, mỗi board gắn với một guild + channel. "Một guild/deployment" ở bản 1 chỉ là giả định ban đầu, không phải quy tắc |
| Role scope | Roles toàn cục (key, tên, default template) + **mention target theo từng guild** (`role_targets`) + override tùy chọn theo mapping |
| Mention | **Chặn lưu** nếu target không thể ping được ai (kiểm tra tĩnh qua Discord API, mục 6); **xác minh sau khi gửi** qua message trả về; **kiểm tra lại định kỳ** + kênh cảnh báo theo guild |
| Auth UI | Mật khẩu admin từ env + session cookie mã hóa. Nâng lên Supabase Auth là việc sau, ngoài phạm vi v1 |

## 3. Facts API đã xác minh

**Trello**
- Đăng ký webhook: `POST /1/webhooks?key=&token=` với `callbackURL`, `idModel` (board id), `description`. Trello gửi **HEAD** tới callbackURL và cần **200**.
- Chữ ký: header `X-Trello-Webhook` = base64(HMAC-SHA1(rawBody + callbackURL, **OAuth secret của app**)). Hash raw body, dùng callbackURL đúng y như lúc đăng ký, so sánh bằng `crypto.timingSafeEqual`.
- Retry: 3 lần (sau 30s, 60s, 120s), **cùng `action.id`**. Webhook bị disable sau 30 ngày lỗi liên tục; một response 200 reset lại. Trả 410 sẽ xóa webhook.
- Payload `{ action, model, webhook }`. Card move: `action.type='updateCard'`, `action.data.listAfter/listBefore={id,name}`, `action.data.card={id,name,shortLink,idList}`, `action.data.board`, `action.memberCreator`. `moveCardToBoard`: list đích ở `action.data.list`. `moveCardFromBoard` bắn ở board nguồn → bỏ qua.

**Discord**
- Gửi tin: `POST /channels/{id}/messages` với `content` + `allowed_mentions` (`{ parse: [], users: [id] }` hoặc `{ parse: [], roles: [id] }`). Mention user `<@ID>`, role `<@&ID>`.
- **Role mention chỉ ping khi**: role có `mentionable=true` HOẶC bot có quyền `MENTION_EVERYONE` (bit `1<<17`) trong channel đó, VÀ id role có trong `allowed_mentions.roles`. Discord "luôn validate `allowed_mentions` theo quyền của người gửi". Thiếu một điều kiện → tin hiển thị `@Role` bình thường nhưng **không ai được thông báo**. Đây là lỗi âm thầm mà mục 6 chặn.
- User mention ping được khi user là member của guild **và nhìn thấy channel** (`VIEW_CHANNEL`). User không thấy channel không nhận thông báo.
- Message trả về sau khi gửi có `mentions[]` (user) và `mention_roles[]` (role id) phản ánh mention thực tế được xử lý → dùng để xác minh sau gửi.
- Quyền hiệu dụng của member trong channel: base = quyền @everyone ∪ quyền các role của member (owner hoặc `ADMINISTRATOR` → tất cả) → áp overwrite @everyone → overwrite các role (deny rồi allow) → overwrite member.
- Endpoint cần dùng: `GET /users/@me/guilds` (guild bot đang ở), `GET /guilds/{id}` (owner), `GET /guilds/{id}/roles`, `GET /guilds/{id}/channels` (kèm `permission_overwrites`), `GET /guilds/{id}/members/{userId}` (một member, **không cần** privileged intent). `GET /guilds/{id}/members?limit=1000` (liệt kê để đếm member của role) **cần bật Server Members Intent** trong Developer Portal (tự bật, không cần duyệt khi bot dưới 100 server).

## 4. Luồng hoạt động

```
Trello board ──webhook POST──► /webhooks/trello/:token
                                  │ 1. tìm board theo token (404 nếu lạ)
                                  │ 2. verify chữ ký HMAC với callbackURL đã lưu (401 nếu sai)
                                  │ 3. ingestEvent (1 transaction Postgres):
                                  │      normalize → CardMoved | null (chỉ move)
                                  │      dedupe: INSERT webhook_events ON CONFLICT DO NOTHING
                                  │      resolve: board → guild → list mapping → role target/override → channel
                                  │      render template → INSERT notifications(status=pending)
                                  │ 4. trả 200 ngay, worker.wake()
                                  ▼
                         NotificationWorker (poll 2s, claim FOR UPDATE SKIP LOCKED)
                                  │ POST Discord → đọc mentions/mention_roles trong response
                                  │ → sent | sent_no_mention (+cảnh báo) | retry(backoff) | failed (+cảnh báo)
                                  ▼
                           Discord channel: "<@123> — Card X is ready for editing"
```

## 5. Bảo mật webhook Trello

Callback là URL công khai; ai có URL đều có thể POST payload giả để bot ping vào Discord. Hai lớp bảo vệ, cả hai bắt buộc:

1. **Token ngẫu nhiên theo board** trong đường dẫn: `/webhooks/trello/<32 hex random>`. Token lạ → 404, không xử lý gì.
2. **Chữ ký `X-Trello-Webhook`**: tính HMAC-SHA1 trên **raw body** (parser riêng `parseAs: 'string'`, chỉ áp cho route này) + `boards.webhook_callback_url` (URL đúng y như lúc đăng ký, lưu trong DB) với `TRELLO_API_SECRET`; so sánh `timingSafeEqual`. Verify **trước** khi parse JSON và trước mọi truy vấn khác. Thiếu header hoặc sai → 401 + log warn kèm IP.

Quy tắc kèm theo:
- Không có cờ tắt verify. App từ chối khởi động nếu thiếu `TRELLO_API_SECRET`; dev local dùng secret thật.
- Sau verify vẫn kiểm tra `action.data.board.id` khớp board của token (`board_mismatch` → bỏ qua).
- Rate-limit route webhook 60 req/phút/IP để chặn brute-force chữ ký.
- Đổi `PUBLIC_BASE_URL` → callbackURL mới → re-register và lưu URL mới; verify luôn dùng URL trong DB nên không hỏng giữa chừng.
- Test: known-answer HMAC; sửa 1 byte body → 401; URL khác → 401; thiếu header → 401; token lạ → 404; payload hợp lệ → 200.

## 6. Đảm bảo mention thực sự ping được ai đó

### 6.1 Kiểm tra khi lưu cấu hình (chặn lưu, HTTP 422)

Áp dụng khi: lưu role target (role × guild), lưu mapping (override mention/channel), đổi channel mặc định của board, thêm guild. Với target T gửi vào channel C của guild G, tất cả phải đúng:

1. **Bot** là member của G; quyền hiệu dụng của bot trong C có `VIEW_CHANNEL` + `SEND_MESSAGES` (thread: thêm `SEND_MESSAGES_IN_THREADS`).
2. **Channel C** thuộc G; loại text (0), announcement (5) hoặc thread (10/11/12) chưa archive.
3. **T là Discord role**: tồn tại trong G, không phải `@everyone`; `mentionable=true` HOẶC bot có `MENTION_EVERYONE` trong C; có **ít nhất 1 member mang role và nhìn thấy C** (đếm qua danh sách member, cần Server Members Intent).
4. **T là user**: là member của G, không phải bot; quyền hiệu dụng trong C có `VIEW_CHANNEL`.

Lỗi trả về `{ code, message, hint }`, ví dụ `ROLE_NOT_PINGABLE`: "Role @Editors is not mentionable and the bot lacks 'Mention @everyone, @here, and All Roles' in #nfl-editing. Enable 'Allow anyone to @mention this role' on the role, or grant the bot that permission in the channel." UI hiện lỗi ngay dưới form, **không lưu**. Không có "save anyway" ở v1.

Phạm vi kiểm tra theo đối tượng lưu:
- Mapping: target hiệu dụng (`override ?? role_target[role, guild]`) × channel hiệu dụng (`override ?? board.channel`).
- Board (đổi channel/guild): chạy lại cho mọi mapping của board.
- Role target: chạy cho channel của **mọi board trong guild** đang dùng role đó; chưa có board nào dùng thì kiểm tra tồn tại + có member, và kiểm tra quyền lại khi mapping đầu tiên được tạo.
- Guild: bot là member; nếu có `alert_channel_id` thì bot gửi được vào đó.

### 6.2 `allowed_mentions` luôn tường minh
Mỗi tin gửi đi có `allowed_mentions` chỉ chứa đúng target (`users:[id]` hoặc `roles:[id]`, `parse: []`). Unit test đảm bảo không bao giờ gửi thiếu.

### 6.3 Xác minh sau khi gửi
Đọc message Discord trả về: target user phải có trong `mentions[].id`, target role phải có trong `mention_roles`. Thiếu → status `sent_no_mention`, ghi lỗi "Message posted but Discord did not register the mention", cảnh báo như `failed`. (M2 xác nhận hành vi này bằng test thật trên Discord; nếu Discord không phản ánh ổn định thì hạ xuống mức cảnh báo, không đổi status.)

### 6.4 Kiểm tra lại định kỳ
Job 15 phút chạy lại 6.1 cho mọi role target và mapping của board enabled (quyền/mentionable có thể bị đổi sau khi lưu). Lưu `check_status`, `check_error`, `checked_at`. Chuyển `ok → error` → post cảnh báo vào `guilds.alert_channel_id` (nếu có) + log; UI hiện badge đỏ trên Roles và Boards. Nút "Re-check now" trên Settings.

### 6.5 Gửi thử
Nút "Send test ping" trên Roles (theo guild) và Board detail (theo mapping): gửi tin thật vào channel hiệu dụng và báo kết quả xác minh 6.3.

### 6.6 Yêu cầu setup Discord
Bật **Server Members Intent** trong Developer Portal (để đếm member của role). Mời bot với quyền View Channels, Send Messages, và Mention Everyone nếu dùng role không mentionable. Nếu chưa bật intent, `/api/health/integrations` báo lỗi và mọi kiểm tra role target thất bại với hint rõ ràng.

## 7. Chống trùng lặp, sửa message theo stage trên UI, nhật ký gửi

### 7.1 Chống trùng lặp
- Khóa dedupe là `action.id` của Trello: retry mang cùng id. `webhook_events.trello_action_id` UNIQUE; `INSERT … ON CONFLICT (trello_action_id) DO NOTHING RETURNING id` trong **cùng transaction** với insert notification. Không có row trả về → trùng → tăng `duplicate_count`, trả 200 im lặng để Trello ngừng retry.
- Lớp 2: `notifications.trello_action_id` UNIQUE.
- Worker claim bằng `UPDATE notifications SET status='sending', locked_at=now() WHERE id IN (SELECT id … WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`. Một row không bao giờ được hai worker gửi song song; row `sending` quá 2 phút (crash) được trả về `pending`.
- Giới hạn chấp nhận: crash giữa lúc Discord nhận tin và ghi `sent` → tối đa 1 tin trùng (Discord không có idempotency key cho create message).
- Test: POST 2 lần cùng payload → 1 notification, cả hai trả 200; 2 worker chạy song song → mỗi row gửi đúng 1 lần.

### 7.2 Sửa message theo stage trên UI
- Mỗi mapping (list) có `message_template` riêng, sửa tại Board detail bằng `TemplateEditor`: textarea, chip biến click-để-chèn, cảnh báo biến lạ và thiếu `{mention}`, preview live bằng renderer dùng chung với server, nút "Send test".
- Biến: `{mention}`, `{card_title}`, `{card_url}`, `{list_name}`, `{previous_list_name}`, `{board_name}`, `{moved_by}`.
- Thứ tự ưu tiên khi tạo mapping mới: `role.default_template` → `settings.default_template`. Sau đó template của mapping là nguồn duy nhất.
- Template mặc định theo ticket, **không có tiền tố "Moved to … →"** (mũi tên trong ticket chỉ diễn tả trigger → message):
  - `script_writer`: `{mention} — {card_title} is ready for script writing`
  - `quality_checker`: `{mention} — {card_title} is ready for script quality checking`
  - `editor`: `{mention} — {card_title} is ready for editing`
  - `editor_qc`: `{mention} — {card_title} is ready for editing quality check`
  - `uploader`: `{mention} — {card_title} is ready for upload`
  - mặc định toàn cục (Settings): `{mention} — {card_title} is ready for {list_name}`
- Không có message nào nằm trong code: seed chỉ ghi vào DB lần đầu, không ghi đè nếu đã có.

### 7.3 Nhật ký gửi và lý do thất bại
- Bảng `notifications`: mọi tin đã/định gửi với board, guild, list, card, role, channel, `content`, `allowed_mentions`, `status` (`pending`/`sending`/`sent`/`sent_no_mention`/`failed`), `attempts`, `last_error` (message người đọc hiểu được, ví dụ "Bot lacks Send Messages in #nfl-editing"), `discord_message_id`, thời điểm.
- Bảng `webhook_events`: mọi event nhận được kể cả bị bỏ qua, kèm lý do (`unsupported_action`, `no_mapping`, `guild_disabled`, `board_disabled`, `mapping_disabled`, `board_mismatch`) và `duplicate_count`.
- UI Notifications: filter guild/board/status, cột lỗi, nút Retry, drawer chi tiết (content, allowed_mentions, message id); `failed` và `sent_no_mention` nổi bật; tab "Webhook events" trả lời "vì sao không bắn".
- Cảnh báo chủ động: `failed`/`sent_no_mention` → post vào `alert_channel_id` của guild (nếu cấu hình) kèm link card và lỗi.
- Lưu 90 ngày (`notifications`), 30 ngày (`webhook_events`); job prune hàng ngày.

## 8. Nhiều Discord server trong một deployment

- Một bot token; mời bot vào từng server. UI "Guilds": nút "Fetch servers the bot is in" (`GET /users/@me/guilds`) → chọn → lưu `guilds` (`discord_guild_id`, `name`, `alert_channel_id` tùy chọn). Hoặc dán guild id rồi app kiểm tra bot có trong đó không.
- Board thuộc đúng một guild; channel mặc định và mọi override channel phải thuộc guild đó (validate khi lưu).
- Role toàn cục; `role_targets` theo (role, guild). Roles page có tab theo guild, mỗi tab hiện target + trạng thái kiểm tra.
- Resolve mention: `mapping.override ?? role_targets[role, board.guild]`; thiếu → `failed` với lỗi rõ (đã bị chặn từ lúc lưu mapping, chỉ xảy ra nếu target bị xóa sau đó).
- Thêm server thứ hai = mời bot + thêm guild trên UI + đặt target cho các role trong guild đó. Không deploy lại, không đổi env.

## 9. Cấu trúc repo (pnpm workspaces, 3 package)

Lý do monorepo: `server` (Node) và `web` (DOM/JSX/Vite) cần tsconfig và build tool khác nhau. `shared` chứa template renderer, mention formatter, zod schemas dùng y hệt ở server và UI preview.

```
Discrello/
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example
├── Dockerfile  docker-compose.yml  README.md
├── deploy/                    # nginx/discrello.conf.template  setup-nginx.sh  duckdns-update.sh
└── packages/
    ├── shared/src/            # @discrello/shared — pure TS, chỉ phụ thuộc zod
    │   ├── template.ts        # renderTemplate(), TEMPLATE_VARIABLES, findUnknownVariables()
    │   ├── mention.ts         # formatMention({kind,id}), allowedMentionsFor(), isSnowflake()
    │   ├── trello-ref.ts      # parseTrelloBoardRef(urlOrId)
    │   └── schemas/           # guild.ts role.ts roleTarget.ts board.ts mapping.ts notification.ts settings.ts auth.ts
    ├── server/                # @discrello/server — tsup → dist/index.js, dist/migrate.js
    │   ├── drizzle/           # SQL migrations (commit vào repo)
    │   ├── src/
    │   │   ├── index.ts       # main: config → db → buildApp → worker/jobs → listen
    │   │   ├── migrate.ts     # chạy migration rồi thoát (entrypoint container gọi trước index)
    │   │   ├── app.ts         # buildApp(deps) — Fastify factory, inject deps để test
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

## 10. Data model (Postgres trên Supabase, schema `discrello`)

Quy ước: PK `bigint generated always as identity`, thời gian `timestamptz`, boolean thật, Discord/Trello id là `text`. Schema `discrello` riêng, **không** thêm vào "Exposed schemas" của Supabase API. Kết nối bằng **Session pooler URI** (IPv4, cổng 5432), `postgres` driver `max: 5`. Migration bằng drizzle-kit, chạy qua `dist/migrate.js` trước khi app start.

**`guilds`**
- `id`, `discord_guild_id` UNIQUE, `name`, `alert_channel_id` NULL
- `bot_status` (`ok`|`not_in_guild`|`missing_permissions`|`unchecked`), `bot_check_error`, `bot_checked_at`
- `enabled`, `created_at`, `updated_at`

**`roles`** (toàn cục)
- `id`, `key` UNIQUE (slug `^[a-z0-9_]+$`), `display_name`, `default_template` NULL, `created_at`, `updated_at`

**`role_targets`** (mention target của role trong một guild)
- `id`, `role_id` FK CASCADE, `guild_id` FK CASCADE, UNIQUE(`role_id`, `guild_id`)
- `mention_kind` (`user`|`role`), `mention_id` (snowflake)
- `check_status` (`ok`|`error`|`unchecked`), `check_error`, `checked_at`, `created_at`, `updated_at`

**`boards`**
- `id`, `trello_board_id` UNIQUE, `trello_short_link`, `name`, `url`, `closed`
- `guild_id` FK RESTRICT, `discord_channel_id`, `enabled`
- `webhook_token` UNIQUE (32 hex), `webhook_id`, `webhook_callback_url`, `webhook_status` (`unregistered`|`active`|`inactive`|`missing`|`mismatch`|`error`), `webhook_consecutive_failures`, `webhook_last_checked_at`, `webhook_last_error`
- `last_event_at`, `lists_synced_at`, `created_at`, `updated_at`

**`trello_lists`**: `id`, `board_id` FK CASCADE, `trello_list_id` UNIQUE, `name`, `pos`, `closed`, `missing`, `last_seen_at`

**`list_mappings`** — một row = một list có thông báo; không có row = không thông báo
- `id`, `board_id` FK CASCADE, `trello_list_id`, UNIQUE(`board_id`, `trello_list_id`)
- `role_id` FK RESTRICT, `message_template` NOT NULL
- `override_mention_kind`, `override_mention_id` (cùng null hoặc cùng có), `override_channel_id` NULL
- `check_status`, `check_error`, `checked_at`, `enabled`, `created_at`, `updated_at`

**`webhook_events`** — dedupe + log "vì sao không bắn"
- `id`, `trello_action_id` UNIQUE, `board_id` FK CASCADE, `action_type`, `card_id`, `card_name`, `list_id`, `list_name`
- `outcome` (`enqueued`|`ignored`), `ignore_reason` (`unsupported_action`|`board_mismatch`|`guild_disabled`|`board_disabled`|`no_mapping`|`mapping_disabled`), `duplicate_count` DEFAULT 0, `received_at`
- Index `(board_id, received_at DESC)`

**`notifications`** — outbox bền vững kiêm nhật ký
- `id`, `trello_action_id` UNIQUE, `board_id` FK CASCADE, `guild_id` FK RESTRICT, `list_mapping_id` FK SET NULL, `role_id` FK SET NULL
- `trigger_type`, `card_id`, `card_name`, `card_short_link`, `card_url`, `list_id`, `list_name`, `previous_list_name`, `board_name`, `actor_name`
- `discord_channel_id`, `mention_kind`, `mention_id`, `content`, `allowed_mentions_json`
- `status` (`pending`|`sending`|`sent`|`sent_no_mention`|`failed`), `attempts`, `next_attempt_at`, `locked_at`, `last_error`, `discord_message_id`, `mention_verified` boolean NULL
- `created_at`, `updated_at`, `sent_at`
- Index `(status, next_attempt_at)`, `(guild_id, created_at DESC)`, `(board_id, created_at DESC)`

**`settings`**: `key` PK (`default_template`), `value`

**Session**: không có bảng, `@fastify/secure-session` (cookie mã hóa, stateless).

## 11. Server modules — trách nhiệm từng file

- **`config.ts`**: env `PORT`, `HOST`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `TRELLO_API_KEY`, `TRELLO_API_TOKEN`, `TRELLO_API_SECRET`, `DISCORD_BOT_TOKEN`, `ADMIN_PASSWORD` (≥12), `SESSION_SECRET` (≥32), `LOG_LEVEL`. Thiếu → in danh sách rồi exit.
- **`db/client.ts`**: `createDb(url)` → `postgres` + `drizzle`; `createTestDb()` → PGlite + cùng bộ migration. `db/repos/*`: query thuần. `notifications.ts` có `claimDue` (SKIP LOCKED), `reclaimStale`, `markSent`, `markSentNoMention`, `scheduleRetry`, `markFailed`, `listPage`.
- **`trello/client.ts`**: `getMe`, `getBoard`, `getLists`, `createWebhook`, `getWebhook`, `updateWebhook`, `deleteWebhook`, `listTokenWebhooks`. Ném `TrelloApiError{status, body}`.
- **`trello/signature.ts`**: `computeTrelloSignature`, `verifyTrelloSignature` (timingSafeEqual + length guard). Pure.
- **`trello/normalize.ts`**: `normalizeAction(payload): CardMoved | null`. Chỉ `updateCard` có `data.listAfter.id` và `moveCardToBoard` (list ở `data.list`). Mọi action khác → `null` với `reason: 'unsupported_action'`.
  ```ts
  type CardMoved = {
    actionId; actionType; occurredAt;
    board: {id,name}; list: {id,name}; previousList?: {id,name};
    card: {id, name, shortLink, url};   // url = https://trello.com/c/{shortLink}
    actor?: {id, username, fullName};
  }
  ```
- **`trello/webhookRoute.ts`**: plugin encapsulated, raw-body parser riêng, rate-limit. `HEAD` → 200. `POST` → board theo token → verify chữ ký → `ingestEvent` → `worker.wake()` → 200. Lỗi trước khi persist → 500 để Trello retry.
- **`discord/client.ts`**: interface `DiscordClient { sendMessage → message object; getCurrentUser; getCurrentUserGuilds; getGuild; getGuildRoles; getGuildChannels; getGuildMember; listGuildMembers (phân trang) }`. `RestDiscordClient` bọc `@discordjs/rest`. Phân loại lỗi → `DiscordSendError{status, code, retryable}`: retryable = network/5xx; non-retryable = 400/401/403 (`50001`, `50013`)/404 (`10003`). Cắt `content` ≤ 2000 ký tự. `fake.ts`: `FakeDiscordClient` chạy trên fixtures guild/roles/channels/members, ghi lại các lần gửi, có thể lập trình lỗi.
- **`discord/permissions.ts`**: pure `computeChannelPermissions({guild, roles, member, channel})` → bitfield; `has(perms, PermissionFlagsBits.X)`. Thuật toán chuẩn (owner/ADMINISTRATOR → tất cả; @everyone → role overwrites → member overwrite).
- **`discord/validate.ts`**: `validateTarget({guildId, channelId, target})` thực hiện 6.1, trả `{ ok: true }` hoặc `{ ok: false, code, message, hint }`. Cache dữ liệu guild (roles/channels/members) 60 giây để tránh spam API khi lưu nhiều mapping.
- **`notifications/resolve.ts`**: pure `resolve(event, board, guild, mapping?, roleTarget?)` → `ignore(reason)` | `notify({channelId, mention, template, vars})`.
- **`notifications/ingest.ts`**: một transaction: normalize → check board id → dedupe → resolve → render → insert. Mention thiếu → insert `failed` với lỗi rõ.
- **`notifications/worker.ts`**: `start()`, `wake()`, `processOnce()` (reclaimStale → claimDue → gửi tuần tự → `verifyMention` → cập nhật status → `alerts.notify` khi failed/sent_no_mention), `stop()`. **`backoff.ts`**: `MAX_ATTEMPTS=5`, `BACKOFF_MS=[5s, 30s, 2m, 10m, 30m]`. **`verifyMention.ts`**: đối chiếu message trả về với target. **`alerts.ts`**: post cảnh báo vào `alert_channel_id` của guild.
- **`boards/service.ts`**: `previewBoard`, `addBoard` (validate channel với guild theo 6.1 trước khi ghi), `registerWebhook`, `checkWebhook`, `syncLists`, `removeBoard`, `reconcileAll`, `upsertMapping` (validate 6.1 trước khi ghi).
- **`guilds/service.ts`**: `listBotGuilds`, `addGuild` (validate bot member + alert channel), `checkGuild`, `removeGuild` (409 nếu còn board).
- **`jobs/`**: `webhookHealth` (15 phút), `mentionHealth` (15 phút, mục 6.4), `prune` (hàng ngày).
- **`http/auth.ts`**: `@fastify/secure-session`; login rate-limit 10/phút/IP, so sánh SHA-256 bằng `timingSafeEqual`; `requireAuth` cho mọi `/api/*` trừ login/health. Cookie `httpOnly`, `sameSite=lax`, `secure` ở production, 7 ngày.
- **`http/errorHandler.ts`**: ZodError → 400; `ValidationFailed` (6.1) → 422 `{code, message, hint}`; `AppError` → status; Trello/Discord → 502; còn lại 500.
- **`http/static.ts`**: serve `web/dist` + SPA fallback (trừ `/api`, `/webhooks`).
- **`app.ts`** / **`index.ts`**: factory inject deps; startup `reconcileAll` + `mentionHealth` (non-fatal); graceful shutdown.

## 12. REST API (`/api`, JSON, cần auth trừ khi ghi public)

| Method | Path | Mục đích |
|---|---|---|
| POST | `/api/auth/login` | `{password}` → cookie (public, rate-limited) |
| POST / GET | `/api/auth/logout`, `/api/auth/me` | |
| GET | `/api/health` | liveness + ping DB (public) |
| GET | `/api/health/integrations` | Trello token, Discord bot user, Server Members Intent đã bật chưa, số guild |
| GET | `/api/discord/bot-guilds` | guild bot đang ở (để chọn khi thêm) |
| GET/POST | `/api/guilds` | list (kèm bot_status, số board) / thêm `{discordGuildId, alertChannelId?}` (validate) |
| PATCH/DELETE | `/api/guilds/:id` | sửa alert channel, enabled / xóa (409 nếu còn board) |
| POST | `/api/guilds/:id/check` | kiểm tra bot + alert channel ngay |
| GET | `/api/guilds/:id/channels`, `/api/guilds/:id/roles` | helper cho UI |
| GET/POST | `/api/roles` | list (kèm targets theo guild + check_status + usageCount) / tạo |
| PUT/DELETE | `/api/roles/:id` | sửa key, tên, default template / xóa (409 nếu đang được map) |
| PUT/DELETE | `/api/roles/:id/targets/:guildId` | đặt/bỏ mention target trong guild (**422 nếu 6.1 thất bại**) |
| POST | `/api/roles/:id/targets/:guildId/test` | gửi test ping vào channel chỉ định, trả kết quả xác minh |
| GET | `/api/boards` | list + guild + webhook status + số mapping + last event |
| POST | `/api/trello/boards/preview` | `{ref}` → tên board + lists |
| POST | `/api/boards` | `{ref, guildId, discordChannelId}` → validate channel, tạo, đăng ký webhook |
| GET/PATCH/DELETE | `/api/boards/:id` | detail / sửa channel, enabled (**422 nếu 6.1 thất bại**) / xóa |
| POST | `/api/boards/:id/sync-lists` | refresh list từ Trello |
| POST | `/api/boards/:id/webhook/check`, `/webhook/register` | kiểm tra / tạo lại webhook |
| PUT/DELETE | `/api/boards/:id/mappings/:trelloListId` | upsert `{roleId, messageTemplate, overrideMention?, overrideChannelId?, enabled}` (**422 nếu 6.1 thất bại**) / bỏ |
| POST | `/api/boards/:id/mappings/:trelloListId/test` | render + gửi thật + xác minh mention |
| GET | `/api/notifications` | `?guildId&boardId&status&limit&before` |
| GET / POST | `/api/notifications/:id`, `/api/notifications/:id/retry` | chi tiết / re-resolve + re-render + `pending` |
| GET | `/api/webhook-events` | `?boardId&outcome&limit&before` |
| GET/PUT | `/api/settings` | `{defaultTemplate}` |
| POST | `/api/admin/reconcile`, `/api/admin/recheck-mentions` | chạy job ngay |

Ngoài `/api` (không auth, verify chữ ký): `HEAD|POST /webhooks/trello/:token`.

## 13. UI (React, tiếng Anh vì team ticket dùng tiếng Anh)

- **Login**: mật khẩu, lỗi 401, redirect về Boards.
- **Layout**: nav Guilds / Roles / Boards / Notifications / Settings; chấm trạng thái integration; logout.
- **Guilds**: bảng guild (tên, id, bot status badge, alert channel, số board); "Add server": chọn từ danh sách bot đang ở hoặc dán id; chọn alert channel; "Check now"; xóa.
- **Roles**: bảng role (tên, key, default template, "used by N mappings"); mỗi role mở rộng thành **tab theo guild**: `MentionTargetInput` (User/Role + picker từ `/guilds/:id/roles` hoặc nhập id) + `CheckStatusBadge` (ok/error kèm hint) + "Send test ping". Lưu bị 422 → lỗi + hint hiện inline, giá trị không được lưu.
- **Boards**: bảng: tên (link Trello), guild, channel, enabled, `WebhookStatusBadge`, mapping check summary (x/y ok), last event. "Add board".
- **Add board**: dán Trello URL → Fetch → chọn guild → chọn channel → Create.
- **Board detail / mapping editor**: header (guild, channel, enabled, webhook badge + Check/Re-register, Re-sync lists, Remove). Một `MappingRow` mỗi list: tên list, select role, Advanced (override mention/channel), `TemplateEditor` + `TemplatePreview`, `CheckStatusBadge`, enabled, Save, "Send test". Save trả 422 → lỗi + hint ngay trong row.
- **Notifications**: tab Notifications (filter guild/board/status; `failed` và `sent_no_mention` nổi bật; Retry; drawer) và tab Webhook events (lý do bỏ qua, duplicate_count).
- **Settings**: default template, integration health (Trello user, bot username, intent status, PUBLIC_BASE_URL), "Reconcile webhooks", "Re-check mentions", version.

## 14. Edge cases & quyết định

| Tình huống | Xử lý |
|---|---|
| Card kéo A→B rồi B→A ngay | 2 action → 2 ping. Không debounce ở v1. |
| Tạo card mới / copy / convert vào list đã map | v1 bỏ qua, ghi `unsupported_action`. Bổ sung sau theo opt-in từng board, mặc định tắt. |
| List không có mapping | `ignored/no_mapping`. |
| Role chưa có target trong guild của board | Chặn từ lúc lưu mapping (422). Nếu target bị xóa sau đó → `failed` + cảnh báo. |
| Ai đó tắt "mentionable" hoặc rút quyền bot sau khi lưu | Job 15 phút phát hiện → badge đỏ + cảnh báo vào alert channel; tin gửi trong lúc đó → `sent_no_mention` + cảnh báo. |
| Role không còn member nào | Job phát hiện → error; tin gửi ra không ping ai → `sent_no_mention`. |
| User rời server / mất quyền xem channel | Như trên. |
| Board archived / list archived | `closed` cập nhật khi sync/health; mapping giữ nguyên (mờ). |
| Trello disable webhook | Job phát hiện `active:false` → bật lại; 404 → tạo lại. |
| `PUBLIC_BASE_URL` đổi | `mismatch` → re-register; verify dùng URL trong DB. |
| Trùng tên list giữa các board | Key theo `(board_id, trello_list_id)`. |
| Nhiều list → cùng role | Hỗ trợ; mỗi mapping có template + channel riêng. |
| Server restart khi còn pending/sending | `pending` được drain; `sending` quá 2 phút → `pending`. |
| Trello redelivery | ON CONFLICT DO NOTHING → 200 im lặng. |
| Board id không khớp token | `board_mismatch`, warn. |
| Chữ ký sai / thiếu header | 401, không xử lý. |
| Tên card chứa `@everyone`/markdown | `allowed_mentions.parse: []` chặn; markdown giữ nguyên. |
| Supabase tạm mất kết nối | Webhook → 500 để Trello retry (tối đa 3 lần, ~3.5 phút); worker retry theo backoff; `/api/health` báo đỏ. |
| Xóa role/guild đang dùng | 409. |

## 15. Milestones

| # | Milestone | Xong khi |
|---|---|---|
| M0 | Scaffold + DB | pnpm workspaces; Supabase project + schema `discrello` + migration đầu; `createTestDb()` PGlite chạy cùng migration; `pnpm build`/`test`/`dev`; `GET /api/health` ping DB; Docker image build |
| M1 | Core thuần | Unit test: template, mention, `normalizeAction` (chỉ move; fixture cho từng action type kể cả bị bỏ qua), signature, `computeChannelPermissions` (fixtures overwrite) |
| M2 | Pipeline webhook | Integration test trên PGlite: chữ ký → dedupe → notification → worker (SKIP LOCKED) → FakeDiscord → `verifyMention`. Test thật trên Discord để xác nhận `mention_roles` phản ánh allowed_mentions |
| M3 | Validation + services + API + auth | `validateTarget` với FakeDiscord fixtures cho từng rule 6.1; guilds/roles/boards/mappings API trả 422 đúng; thêm board bằng curl → webhook đăng ký → kéo card thật → ping thật |
| M4 | Web UI | Trọn flow: login → add guild → roles per guild (thấy 422 inline) → add board → mapping + preview + test → notifications log |
| M5 | Ops | Docker trên 127.0.0.1 sau nginx + certbot của VPS, subdomain DuckDNS; migrate trước start; jobs health; alert channel; seed SPORTS; README |

## 16. Dev workflow & credentials

**Prereqs**: Node 22 LTS, pnpm (corepack), `cloudflared` hoặc `ngrok`, Docker (deploy), tài khoản Supabase.

**Supabase**
1. Tạo project → Project Settings → Database → Connect → **Session pooler** URI (IPv4, cổng 5432) → `DATABASE_URL`.
2. `pnpm db:migrate` tạo schema `discrello` và các bảng. Không thêm `discrello` vào Exposed schemas (Settings → API).
3. Test local không cần Supabase: PGlite in-memory.

**Trello**
1. https://trello.com/power-ups/admin → New Power-Up → tab "API key" → Generate → `TRELLO_API_KEY`; "Secret" cùng trang → `TRELLO_API_SECRET`.
2. Token: `https://trello.com/1/authorize?expiration=never&name=Discrello&scope=read&response_type=token&key=<KEY>` → `TRELLO_API_TOKEN`. User của token phải là member của mọi board sẽ thêm. (Nếu tạo webhook bị 401 với `read`, tạo lại với `scope=read,write`.)

**Discord**
1. Developer Portal → New Application → Bot → Reset Token → `DISCORD_BOT_TOKEN`. Bật **Server Members Intent** (Privileged Gateway Intents).
2. OAuth2 → URL Generator → scope `bot`, permissions View Channels, Send Messages, Mention Everyone (nếu dùng role không mentionable) → mời vào **từng** server.
3. Developer Mode để copy id nếu cần nhập tay.

**Chạy local**
```
cp .env.example .env
cloudflared tunnel --url http://localhost:3000    # copy URL vào PUBLIC_BASE_URL
pnpm install
pnpm db:migrate
pnpm dev                                          # server :3000 + web :5173 (proxy /api)
pnpm seed:sports -- --board https://trello.com/b/XXXX/sports --guild 123 --channel 456
```

**Chạy thử không cần credentials**: `DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory pnpm --filter @discrello/server dev` chạy API với Discord/Trello giả lập trong bộ nhớ (một server demo, một board demo 5 list). Tin nhắn "gửi Discord" được ghi ra log thay vì gửi thật. Chỉ dành cho dev, bị chặn khi `NODE_ENV=production`.

**Seed script** (idempotent, không ghi đè): 5 role với template ở mục 7.2; có `--board` thì `addBoard` và map theo tên list: "Script Writer Ready"→script_writer, "SW QC STEP"→quality_checker, "NFL editor ready"→editor, "QC step"→editor_qc, "ready to upload"→uploader; `--target script_writer=user:123 …` tùy chọn (qua validate 6.1). In ra những gì còn phải điền qua UI.

## 17. Docker / deploy

**Dockerfile** multi-stage trên `node:22-bookworm-slim`: `deps` (`pnpm install --frozen-lockfile`) → `build` (`pnpm -r build`, `pnpm --filter @discrello/server deploy --prod /out`) → `runtime` (copy `/out` + `drizzle/` + `web/dist`; `USER node`; `HEALTHCHECK /api/health`; `CMD ["sh","-c","node dist/migrate.js && node dist/index.js"]`). Không `VOLUME`.

**docker-compose.yml**: chỉ một service `app` (build `.`, `env_file .env`, `restart: unless-stopped`) publish tại `127.0.0.1:${DISCRELLO_PORT:-3100}:3000`, `mem_limit: 512m`, log json-file tối đa 3 × 10 MB. Không có volume dữ liệu ứng dụng. VPS chạy dịch vụ production khác và nginx đã giữ 80/443, nên không có container proxy.

**nginx + certbot** (trên máy chủ): `deploy/nginx/discrello.conf.template` là một `server` block riêng (`listen 80; server_name $DOMAIN;` → `proxy_pass http://127.0.0.1:$DISCRELLO_PORT` kèm `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`). `sudo deploy/setup-nginx.sh <domain> <email> [port]` kiểm tra không site nào khác dùng tên này, DNS đã trỏ về VPS và app đang trả lời; chỉ ghi file `discrello.conf`; chạy `nginx -t` trước mỗi lần reload và xóa file của mình nếu test lỗi; rồi `certbot --nginx -d <domain> --redirect`, chỉ thêm listener 443 và chuyển hướng HTTP→HTTPS vào block đó. Tự gia hạn qua timer của certbot.

**DuckDNS**: subdomain được tạo một lần trên duckdns.org (API không tạo được subdomain), nằm cạnh subdomain có sẵn của tài khoản; `deploy/duckdns-update.sh` (có thể chạy bằng cron) trỏ nó về VPS bằng `update?domains=<sub>&token=<token>&ip=` (IP để trống = IP của máy gọi). `DOMAIN=discrello.duckdns.org`, `PUBLIC_BASE_URL=https://discrello.duckdns.org`.

**IP client sau proxy**: `TRUST_PROXY_HOPS=1` khiến Fastify chỉ tin đúng một proxy, nên rate limit dùng địa chỉ do nginx ghi thêm vào `X-Forwarded-For`, không dùng địa chỉ client tự khai (tin mọi hop cho phép xoay IP giả để vượt giới hạn đăng nhập 10 lần/phút; đã có test).

Backup: Supabase tự backup hàng ngày (Pro) hoặc `pg_dump` qua cron. Chạy một instance là đủ; nhờ SKIP LOCKED có thể chạy nhiều instance sau này.

## 18. Verification

**Unit (vitest)**: template; mention (`allowed_mentions` luôn tường minh); normalize (move → CardMoved; create/copy/convert/rename/archive/`moveCardFromBoard` → null); signature (known-answer, body sửa, URL khác, thiếu header); `computeChannelPermissions` (owner, admin, deny @everyone + allow role, member overwrite, thread); `validateTarget` với fixtures: role mentionable/không + bot có/không MENTION_EVERYONE, role 0 member, role có member nhưng không thấy channel, user không trong guild, user không thấy channel, bot thiếu SEND_MESSAGES, channel sai guild, channel voice; resolve; backoff; trello-ref.

**Integration (PGlite, `app.inject()`, FakeDiscord, stub Trello)**:
- Happy path: guild+role target+board+mapping → POST `updateCard-move.json` đã ký → 200 → `pending` → `processOnce()` → FakeDiscord nhận `{channelId, content: "<@123> — Card is ready for editing", allowed_mentions: {parse: [], users: ['123']}}` → response có `mentions:[{id:'123'}]` → `sent`, `mention_verified=true`.
- FakeDiscord trả message không có mention → `sent_no_mention` + alert được gọi.
- POST 2 lần → 1 notification, `duplicate_count=1`. 2 worker song song → mỗi row gửi 1 lần.
- Chữ ký sai → 401; token lạ → 404; board id lệch → ignored; `createCard` → ignored `unsupported_action`.
- Retry: lỗi retryable 2 lần rồi OK → `attempts=2`, `sent`; 403 → `failed` + alert.
- PUT role target với fixture role không mentionable + bot không có quyền → 422 `ROLE_NOT_PINGABLE`, DB không đổi. Sửa fixture → 200.
- PUT mapping với override channel thuộc guild khác → 422.
- Boards API; xóa role/guild đang dùng → 409; auth.

**Manual E2E**:
1. Tunnel + `pnpm dev` + Supabase thật; thêm guild; đặt target cho `editor` là một Discord role **không mentionable** khi bot chưa có Mention Everyone → phải thấy 422 với hint. Bật mentionable → lưu được.
2. Thêm SPORTS board; map "NFL editor ready" → editor; kéo card → ping trong ~2s; Notifications `sent`, `mention_verified`.
3. Tắt mentionable của role trên Discord → kéo card → `sent_no_mention` + tin cảnh báo trong alert channel; chờ job (hoặc Re-check) → badge đỏ.
4. Đặt channel sai quyền → 422 khi lưu; sửa → lưu được.
5. Replay payload bằng curl (tính lại chữ ký) → không ping trùng; sửa 1 byte → 401.
6. Kill server khi còn `sending` → restart → gửi lại sau reclaim.
7. Thêm server Discord thứ hai: mời bot → Add server → đặt target → thêm board → ping đúng server, không đổi env.
8. VPS: `deploy/duckdns-update.sh` → `docker compose up -d --build` → `sudo deploy/setup-nginx.sh discrello.duckdns.org <email> 3100` → `https://discrello.duckdns.org/api/health` 200 → lặp bước 2. Template đã được kiểm chứng bằng `nginx -t` trong container nginx proxy tới container app trên 127.0.0.1:3100 (health, UI, probe HEAD của Trello, webhook giả 404, 401 khi chưa login, cookie `Secure`, `X-Forwarded-For` giả vẫn bị rate limit).

## 19. Non-goals v1

- Trigger khi tạo/copy/convert card vào list (sẽ thêm sau, opt-in theo board, mặc định tắt).
- Supabase Auth / multi-user / phân quyền / audit trail cấu hình.
- Trello OAuth "connect your account".
- Map member/assignee của card Trello sang Discord user.
- Debounce/digest ping; sửa/xóa tin đã gửi; embeds/buttons; slash commands.
- Phát hiện user mute channel hoặc DND (Discord không expose).
- Metrics/alerting ngoài alert channel + UI log + pino.

## File quan trọng nhất khi implement

- `packages/server/src/db/schema.ts` — data model
- `packages/server/src/discord/validate.ts` + `permissions.ts` — quy tắc "mention phải ping được"
- `packages/server/src/trello/signature.ts` + `webhookRoute.ts` — bảo mật webhook
- `packages/server/src/notifications/ingest.ts` + `worker.ts` — dedupe, outbox, xác minh sau gửi
- `packages/shared/src/template.ts` — renderer dùng chung server + UI

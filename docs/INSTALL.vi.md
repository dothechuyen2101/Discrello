# Discrello — Hướng dẫn cài đặt

Tài liệu này hướng dẫn cài Discrello từ đầu: chuẩn bị máy, tạo tài khoản dịch vụ (Supabase, Trello, Discord), điền cấu hình, chạy thử trên máy cá nhân và triển khai lên VPS. Sau khi cài xong, cách cấu hình và sử dụng hằng ngày nằm ở [USER_GUIDE.vi.md](USER_GUIDE.vi.md).

Tóm tắt bằng tiếng Anh có trong [README](../README.md).

---

## 1. Tổng quan

Discrello là một ứng dụng Node.js gồm ba phần:

| Thành phần | Vai trò |
|---|---|
| **Server** (`packages/server`) | Nhận webhook từ Trello, gửi tin nhắn Discord, cung cấp API cho giao diện, chạy các job kiểm tra định kỳ. |
| **Giao diện web** (`packages/web`) | Trang quản trị để cấu hình server Discord, role, board, tin nhắn và xem nhật ký. Được server phục vụ cùng địa chỉ. |
| **Database** | Supabase (Postgres), schema riêng `discrello`. Toàn bộ cấu hình và nhật ký nằm ở đây; server không lưu gì trên ổ đĩa. |

Luồng hoạt động: Trello gọi webhook tới `PUBLIC_BASE_URL/webhooks/trello/...` → server kiểm tra chữ ký → ghi vào Supabase → gửi tin nhắn Discord.

Vì Trello phải gọi được vào server, **server cần một địa chỉ HTTPS công khai**. Khi thử trên máy cá nhân dùng tunnel ([mục 7](#7-chạy-thử-trên-máy-cá-nhân)); khi chạy thật dùng VPS với nginx và subdomain DuckDNS ([mục 8](#8-triển-khai-lên-vps-docker--nginx--certbot)).

---

## 2. Yêu cầu

| Thứ cần có | Ghi chú |
|---|---|
| Node.js **22.9 trở lên** | Đã kiểm thử với Node 24 LTS. Kiểm tra: `node --version`. |
| pnpm 10 | Bật qua corepack: `corepack enable`. |
| git | Để lấy mã nguồn. |
| Tài khoản **Supabase** | Gói miễn phí là đủ. |
| Tài khoản **Trello** | Phải là thành viên của các board cần thông báo. |
| Tài khoản **Discord** | Có quyền quản lý server để mời bot. |
| Để chạy thật: **VPS** có Docker, nginx, certbot, và tài khoản **DuckDNS** | Xem [mục 8](#8-triển-khai-lên-vps-docker--nginx--certbot). |

---

## 3. Lấy mã nguồn và cài thư viện

```bash
git clone <địa-chỉ-repo> discrello
cd discrello
corepack enable
pnpm install
cp .env.example .env
```

File `.env` ở thư mục gốc của repo chứa toàn bộ cấu hình. Các mục 4 đến 6 lần lượt điền giá trị cho file này. **Không commit file `.env`** (đã có sẵn trong `.gitignore`).

---

## 4. Supabase (database)

### 4.1 Tạo project

1. Vào https://supabase.com/dashboard → **New project**.
2. Đặt **Database password** và **ghi lại**. Nên chỉ dùng chữ và số để tránh phải mã hóa ký tự trong URL.
3. Chọn region gần server của bạn.

### 4.2 Lấy chuỗi kết nối

1. Trong project, bấm nút **Connect** ở thanh trên cùng.
2. Chọn tab **Session pooler** (không dùng "Direct connection").
3. Copy chuỗi có dạng:
   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
4. Thay `[YOUR-PASSWORD]` bằng mật khẩu database, **bỏ luôn cặp ngoặc vuông**, rồi dán vào `.env`:
   ```
   DATABASE_URL=postgresql://postgres.abcdefghijklmnop:MatKhau123@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
   ```

Lưu ý quan trọng:

- **Phải dùng Session pooler.** Địa chỉ "Direct connection" (`db.<project-ref>.supabase.co`) chỉ có IPv6. Phần lớn máy cá nhân, VPS và Docker không có IPv6, nên sẽ báo `Network is unreachable`.
- Nếu mật khẩu có ký tự đặc biệt, phải mã hóa trong URL: `@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `?` → `%3F`, `%` → `%25`.
- Quên mật khẩu thì vào **Project Settings → Database → Reset database password**.
- **Không cần** anon key hay service role key. Discrello kết nối thẳng vào Postgres, không dùng Supabase API.

### 4.3 Tạo bảng

```bash
pnpm db:migrate
```

Kết quả đúng là dòng `Migrations applied`. Lệnh này tạo schema `discrello` với 9 bảng. Chạy lại nhiều lần không sao: chỉ áp dụng các migration còn thiếu.

**Không** thêm `discrello` vào **Project Settings → API → Exposed schemas**. Giữ nguyên như vậy thì dữ liệu không đọc được qua API key công khai của Supabase.

---

## 5. Trello

### 5.1 API key và secret

1. Vào https://trello.com/power-ups/admin → **New** để tạo một Power-Up (đặt tên ví dụ "Discrello", chọn workspace của bạn).
2. Mở Power-Up vừa tạo → tab **API key** → **Generate a new API key**.
3. Copy vào `.env`:
   ```
   TRELLO_API_KEY=<API key>
   TRELLO_API_SECRET=<Secret hiện ngay cạnh API key>
   ```
   **Secret** dùng để kiểm tra chữ ký của mọi webhook Trello gửi tới. Thiếu nó server sẽ không khởi động.

### 5.2 Token

Mở địa chỉ sau trong trình duyệt (thay `<KEY>` bằng API key), bấm **Allow**, copy token hiện ra:

```
https://trello.com/1/authorize?expiration=never&name=Discrello&scope=read,write&response_type=token&key=<KEY>
```

```
TRELLO_API_TOKEN=<token>
```

Token này thuộc về tài khoản Trello đang đăng nhập. **Tài khoản đó phải là thành viên của mọi board** muốn gửi thông báo, nếu không Discrello không đọc được board.

---

## 6. Discord

### 6.1 Tạo bot

1. Vào https://discord.com/developers/applications → **New Application**, đặt tên.
2. Trang **General Information**: ghi lại **Application ID**, dùng ở bước 6.2.
3. Trang **Bot** → **Reset Token** → copy token:
   ```
   DISCORD_BOT_TOKEN=<token>
   ```
4. Cũng trên trang **Bot**, mục **Privileged Gateway Intents**: bật **Server Members Intent** rồi **Save Changes**. Discrello cần quyền này để kiểm tra một Discord role có người mang hay không.

### 6.2 Mời bot vào server

Mở link sau (thay `<APPLICATION_ID>`), chọn server, bấm **Authorize**:

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=134144
```

`134144` gồm ba quyền: **View Channels**, **Send Messages**, **Mention @everyone, @here, and All Roles**. Quyền cuối chỉ cần khi ping các Discord role không bật "mentionable". Làm lại bước này cho **từng** server muốn nhận thông báo.

### 6.3 Bật Developer Mode

Discord → **User Settings → Advanced → Developer Mode**. Sau đó chuột phải vào người, role, kênh hoặc server và chọn **Copy ID** để lấy ID khi cấu hình.

---

## 7. Chạy thử trên máy cá nhân

### 7.1 Điền các biến còn lại trong `.env`

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `NODE_ENV` | `development` | Khi deploy bằng Docker sẽ tự thành `production`. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Cổng của server. |
| `LOG_LEVEL` | `info` | `debug` khi cần xem chi tiết. |
| `ADMIN_PASSWORD` | Ít nhất **12 ký tự** | Mật khẩu đăng nhập giao diện. |
| `SESSION_SECRET` | Ít nhất **32 ký tự** ngẫu nhiên | Tạo bằng `openssl rand -hex 32`. |
| `PUBLIC_BASE_URL` | URL HTTPS công khai | Điền ở bước 7.2. Không có dấu `/` ở cuối. |
| `TRUST_PROXY_HOPS` | `1` | Số proxy đứng trước app (nginx hoặc tunnel). Không tăng lên: làm vậy cho phép client giả IP để vượt giới hạn đăng nhập. |
| `DOMAIN` | `discrello.duckdns.org` | Chỉ dùng khi deploy ([mục 8](#8-triển-khai-lên-vps-docker--nginx--certbot)). |
| `DISCRELLO_PORT` | `3100` | Cổng trên VPS mà container bind vào `127.0.0.1`. Chỉ dùng khi deploy. |
| `DUCKDNS_SUBDOMAIN` / `DUCKDNS_TOKEN` | `discrello` / token | Dùng cho `deploy/duckdns-update.sh` khi deploy. |
| `DISCRELLO_FAKE_INTEGRATIONS` | `0` | `1` là chế độ demo không cần tài khoản thật ([7.5](#75-chế-độ-demo-không-cần-tài-khoản)). |

Nếu thiếu hoặc sai biến nào, server dừng ngay và in danh sách biến cần sửa.

### 7.2 Mở tunnel để Trello gọi được vào máy

Dùng Cloudflare quick tunnel (miễn phí, không cần tài khoản):

```bash
# Tải cloudflared (Linux x86_64); macOS: brew install cloudflared
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared

# Để cửa sổ này chạy
./cloudflared tunnel --url http://127.0.0.1:3000
```

Trong log sẽ có một dòng dạng `https://xxxx-xxxx.trycloudflare.com`. Điền vào `.env`:

```
PUBLIC_BASE_URL=https://xxxx-xxxx.trycloudflare.com
```

URL này **đổi mỗi lần** chạy lại tunnel. Mỗi lần đổi, cập nhật `PUBLIC_BASE_URL` rồi khởi động lại server; webhook Trello được đăng ký lại tự động.

### 7.3 Khởi động

```bash
pnpm build     # build giao diện để server phục vụ qua tunnel
pnpm dev       # server ở cổng 3000, giao diện dev ở cổng 5173
```

Có hai cách mở giao diện:

- Trên máy này: http://localhost:5173
- Từ bất kỳ đâu: URL tunnel ở bước 7.2. Server phục vụ bản giao diện đã build ở `packages/web/dist`, nên sửa giao diện xong cần `pnpm build` lại.

Đăng nhập bằng `ADMIN_PASSWORD`.

### 7.4 Kiểm tra cài đặt

1. Mở `<PUBLIC_BASE_URL>/api/health`. Kết quả đúng: `{"ok":true,...}`. Nếu báo lỗi database, xem [mục 11](#11-lỗi-thường-gặp-khi-cài).
2. Vào **Settings → Integrations**:
   - **Trello**: hiện tên tài khoản Trello.
   - **Discord bot**: hiện tên bot.
   - **Server Members Intent**: phải là enabled (hiện sau khi đã thêm ít nhất một server).
3. Vào **Servers → Add server**: server Discord đã mời bot phải có trong danh sách.

Tiếp theo làm theo [USER_GUIDE.vi.md mục 4](USER_GUIDE.vi.md#4-thiết-lập-lần-đầu) để thêm role, board và map list.

**Nạp sẵn 5 role của pipeline SPORTS** (script_writer, quality_checker, editor, editor_qc, uploader cùng tin nhắn theo ticket):

```bash
pnpm seed:sports
```

Có thể thêm luôn board và người nhận:

```bash
pnpm seed:sports -- --board https://trello.com/b/XXXX/sports \
  --guild <ID server Discord> --channel <ID kênh> \
  --target editor=user:<ID người> --target uploader=role:<ID role>
```

Lệnh này chạy lại được nhiều lần và không ghi đè dữ liệu đã có.

### 7.5 Chế độ demo không cần tài khoản

Muốn xem thử giao diện trước khi có Trello/Discord/Supabase:

```bash
DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory pnpm --filter @discrello/server dev
pnpm --filter @discrello/web dev     # cửa sổ thứ hai, mở http://localhost:5173
```

Chế độ này dùng Discord và Trello giả lập trong bộ nhớ, có sẵn một server demo và một board demo 5 list. Không có gì được gửi đi thật, và mọi dữ liệu mất khi tắt server.

---

## 8. Triển khai lên VPS (Docker + nginx + certbot)

VPS này đang chạy các dịch vụ production khác (scraper YouTube Shorts), và **nginx trên máy đã giữ cổng 80 và 443**. Vì vậy Discrello không chiếm cổng nào công khai:

```
Internet ──HTTPS──► nginx của VPS (80/443, chứng chỉ certbot)
                      ├─ server block có sẵn của scraper   (giữ nguyên)
                      └─ server block discrello.conf ──► 127.0.0.1:3100 ──► container Discrello
```

- Container Discrello chỉ lắng nghe trên `127.0.0.1:3100`, bên ngoài không truy cập thẳng được.
- nginx có thêm **một server block riêng** cho `discrello.duckdns.org`, chuyển tiếp vào cổng đó. Các site khác không bị sửa.
- certbot cấp chứng chỉ Let's Encrypt cho riêng subdomain này và tự gia hạn.
- Container được giới hạn 512 MB RAM và log tối đa 30 MB, để không ảnh hưởng scraper.

Tên miền dùng subdomain miễn phí của DuckDNS: `discrello.duckdns.org`, tạo thêm bên cạnh subdomain đang có của tài khoản.

### 8.1 Chuẩn bị trên VPS

```bash
docker compose version            # cần Docker Engine + Compose plugin
nginx -v
sudo apt install certbot python3-certbot-nginx     # nếu chưa có certbot
ss -ltn | grep ':3100 '           # không in gì = cổng 3100 còn trống
```

Nếu cổng 3100 đã bị dùng, chọn cổng khác và đặt `DISCRELLO_PORT` trong `.env` ở bước 8.3.

### 8.2 Tạo subdomain DuckDNS

1. Đăng nhập https://www.duckdns.org bằng tài khoản đang quản lý subdomain hiện có.
2. Ở ô **sub domain**, nhập `discrello` rồi bấm **add domain**. Subdomain mới nằm cạnh subdomain cũ; subdomain cũ không bị ảnh hưởng. Nếu tên đã có người dùng, chọn tên khác và dùng tên đó cho mọi bước bên dưới.
3. Copy **token** ở đầu trang (một chuỗi dạng `a1b2c3d4-...`).

IP gán lúc tạo là IP của máy bạn đang dùng, chưa phải của VPS. Bước 8.3 sẽ sửa lại.

### 8.3 Lấy mã nguồn, cấu hình và trỏ subdomain về VPS

```bash
git clone <địa-chỉ-repo> discrello
cd discrello
cp .env.example .env
nano .env
```

Điền giống [mục 4 đến 7.1](#4-supabase-database), cộng thêm:

```
DOMAIN=discrello.duckdns.org
PUBLIC_BASE_URL=https://discrello.duckdns.org
DISCRELLO_PORT=3100
TRUST_PROXY_HOPS=1
DUCKDNS_SUBDOMAIN=discrello
DUCKDNS_TOKEN=<token vừa copy>
DISCRELLO_FAKE_INTEGRATIONS=0
```

Trỏ subdomain về IP của VPS, **chạy trên VPS**:

```bash
deploy/duckdns-update.sh
# OK: discrello.duckdns.org -> <IP của VPS>
getent hosts discrello.duckdns.org       # sau khoảng 1 phút phải ra IP của VPS
```

Script chỉ cập nhật subdomain `discrello`, không đụng tới subdomain khác. Nếu IP của VPS có thể thay đổi, thêm vào `crontab -e`:

```
*/5 * * * * /đường-dẫn/discrello/deploy/duckdns-update.sh >> /var/log/duckdns-discrello.log 2>&1
```

### 8.4 Chạy container

```bash
docker compose up -d --build
docker compose ps                                  # app ở trạng thái healthy
curl http://127.0.0.1:3100/api/health              # {"ok":true,...}
```

Container tự chạy migration trước khi khởi động server. Xem log bằng `docker compose logs -f app`.

### 8.5 Tạo server block nginx và chứng chỉ SSL

Chạy một lệnh (thay email nhận thông báo của Let's Encrypt):

```bash
sudo deploy/setup-nginx.sh discrello.duckdns.org you@example.com 3100
```

Script làm lần lượt:

1. Kiểm tra cổng 80 do nginx trên máy giữ (không phải nginx trong container), không có site nginx nào khác đang dùng `discrello.duckdns.org`, subdomain đã trỏ đúng IP của VPS, và container đang trả lời trên `127.0.0.1:3100`. Sai điều nào thì dừng, chưa sửa gì.
2. Đọc `nginx -T` để biết nginx thực sự nạp site từ thư mục nào, rồi ghi **một file riêng** vào đúng chỗ đó: `/etc/nginx/sites-available/discrello.conf` kèm link trong `sites-enabled` (Ubuntu/Debian), hoặc `/etc/nginx/conf.d/discrello.conf`. File sót lại của lần chạy trước ở thư mục không được nạp sẽ bị dọn.
3. Chạy `nginx -t` và xác nhận file đã được nạp. Nếu lỗi, xóa đúng file vừa ghi rồi dừng; cấu hình nginx cũ và site của scraper giữ nguyên. Nếu đạt, `reload` nginx (không restart, không làm gián đoạn scraper).
4. Gọi `http://discrello.duckdns.org/api/health` **qua IP công khai** của VPS (đường Trello và Let's Encrypt sẽ đi) và yêu cầu nhận đúng phản hồi của Discrello. Không kiểm tra qua `127.0.0.1`, vì nếu VPS có block lắng nghe riêng `127.0.0.1:80` (ví dụ trang status) thì request sẽ rơi vào block đó.
5. Chạy `certbot --nginx -d discrello.duckdns.org --redirect`. Certbot chỉ thêm HTTPS và chuyển hướng HTTP sang HTTPS vào server block của Discrello.
6. Kiểm tra lại `https://discrello.duckdns.org/api/health`.

Script chạy lại được nhiều lần. Nếu lần trước dừng giữa chừng, cứ chạy lại cùng lệnh.

Chứng chỉ tự gia hạn qua timer của certbot. Kiểm tra: `sudo certbot renew --dry-run`.

**Làm tay thay cho script** (nếu muốn tự kiểm soát từng bước):

```bash
sed -e 's/__DOMAIN__/discrello.duckdns.org/g' -e 's/__PORT__/3100/g' \
  deploy/nginx/discrello.conf.template | sudo tee /etc/nginx/sites-available/discrello.conf
sudo ln -s /etc/nginx/sites-available/discrello.conf /etc/nginx/sites-enabled/discrello.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d discrello.duckdns.org --redirect
```

### 8.6 Kiểm tra sau khi triển khai

```bash
curl https://discrello.duckdns.org/api/health
```

1. Mở `https://discrello.duckdns.org` và đăng nhập.
2. **Settings → Integrations**: Trello, Discord bot, Server Members Intent đều bình thường; **Public base URL** là `https://discrello.duckdns.org`.
3. Trang từng board: nhãn webhook là **webhook active**. Nếu là `mismatch`, bấm **Re-register** (thường tự sửa ngay khi khởi động).
4. Kéo thử một card sang list đã map và xem ping trong Discord.

### 8.7 Chuyển từ máy cá nhân sang VPS

Nếu đã cấu hình khi chạy thử và dùng **cùng database Supabase**, không phải làm lại gì. Khi server trên VPS khởi động với `PUBLIC_BASE_URL` mới, nó tự phát hiện webhook Trello còn trỏ về URL tunnel cũ và đăng ký lại.

**Chỉ chạy một bản Discrello cho mỗi database.** Nếu vẫn để server trên máy cá nhân chạy song song, hai bản sẽ liên tục đăng ký lại webhook về địa chỉ của mình. Muốn giữ môi trường thử riêng thì tạo một project Supabase khác cho nó.

### 8.8 Gỡ Discrello khỏi VPS

Không ảnh hưởng các site khác:

```bash
docker compose down
sudo rm /etc/nginx/sites-enabled/discrello.conf /etc/nginx/sites-available/discrello.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name discrello.duckdns.org
```

Trước khi gỡ, nên xóa các board trong giao diện (**Remove board**) để webhook Trello cũng được xóa.

---

## 9. Cập nhật phiên bản mới

Trên VPS:

```bash
cd discrello
git pull
docker compose up -d --build
```

Không cần chạy lại `deploy/setup-nginx.sh`: server block nginx và chứng chỉ vẫn giữ nguyên. Chỉ chạy lại khi đổi domain hoặc `DISCRELLO_PORT`.

Trên máy cá nhân:

```bash
git pull
pnpm install
pnpm db:migrate
pnpm build
pnpm dev
```

Migration luôn chỉ thêm phần còn thiếu, không xóa dữ liệu cũ.

---

## 10. Kiểm tra mã nguồn (tùy chọn)

```bash
pnpm typecheck   # kiểm tra kiểu TypeScript
pnpm test        # 92 test, dùng Postgres trong bộ nhớ, không cần tài khoản thật
```

Thử toàn bộ giao diện trong Chrome headless với chế độ demo (cần Google Chrome):

```bash
pnpm build
# cửa sổ 1: server demo ở cổng 3987
DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory PORT=3987 \
  PUBLIC_BASE_URL=https://example.test TRELLO_API_SECRET=smoke-secret \
  ADMIN_PASSWORD=correct-horse-battery SESSION_SECRET=0123456789abcdef0123456789abcdef \
  TRELLO_API_KEY=k TRELLO_API_TOKEN=t DISCORD_BOT_TOKEN=d \
  node packages/server/dist/index.js
# cửa sổ 2
pnpm e2e:demo
```

---

## 11. Lỗi thường gặp khi cài

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `Network is unreachable` hoặc `ENETUNREACH` khi kết nối database | Đang dùng địa chỉ Direct connection `db.<ref>.supabase.co`, chỉ có IPv6. | Dùng chuỗi **Session pooler** ([4.2](#42-lấy-chuỗi-kết-nối)). |
| `password authentication failed` | Sai mật khẩu, còn cặp ngoặc `[ ]`, hoặc ký tự đặc biệt chưa mã hóa. | Bỏ ngoặc, mã hóa ký tự đặc biệt, hoặc reset mật khẩu thành chữ và số. |
| `Tenant or user not found` | Sai host pooler (region) hoặc tên user thiếu `.<project-ref>`. | Copy lại nguyên chuỗi Session pooler từ nút **Connect**. |
| Server dừng ngay với `Invalid environment configuration` | Thiếu biến, `ADMIN_PASSWORD` ngắn hơn 12 ký tự, hoặc `SESSION_SECRET` ngắn hơn 32 ký tự. | Sửa đúng các biến được liệt kê trong thông báo. |
| Lỗi nhắc tới `--env-file-if-exists` khi chạy `pnpm dev` hoặc `pnpm db:migrate` | Node.js cũ hơn 22.9. | Cài Node 24 LTS. |
| `EADDRINUSE` kèm cổng 3000 | Cổng 3000 đang bị chiếm. | Tắt tiến trình kia, hoặc đổi `PORT` (và cổng trong lệnh tunnel). |
| Board có nhãn webhook `error` | Trello không gọi được `PUBLIC_BASE_URL`: tunnel đã tắt, URL sai, hoặc chứng chỉ HTTPS không hợp lệ. | Kiểm tra `<PUBLIC_BASE_URL>/api/health` mở được từ ngoài, rồi bấm **Re-register** trên trang board. |
| **Fetch** board báo `TRELLO_BOARD_NO_ACCESS` (bản cũ: `401 – unauthorized permission requested`) | Tài khoản Trello của token không phải thành viên board. | Trên board: **Share** → mời tài khoản được nêu trong thông báo, rồi Fetch lại. |
| **Fetch** board báo `TRELLO_TOKEN_INVALID` / `TRELLO_KEY_INVALID` (bản cũ: `invalid app token` / `invalid key`) | Token hoặc key trong `.env` sai, hết hạn, hoặc token tạo cho key khác. | Tạo lại token ([5.2](#52-token)), sửa `.env`, `docker compose up -d --force-recreate`. |
| **Fetch** board báo `TRELLO_BOARD_NOT_FOUND` | URL hoặc ID board sai. | Copy địa chỉ board từ trình duyệt (`https://trello.com/b/…`). |
| Danh sách **Server the bot is in** trống | Bot chưa được mời vào server nào. | Làm [6.2](#62-mời-bot-vào-server). |
| Lưu target báo `MEMBERS_INTENT_DISABLED` | Chưa bật Server Members Intent. | Làm bước 4 của [6.1](#61-tạo-bot). |
| Đăng nhập được nhưng bị đẩy về trang login liên tục (khi deploy) | Chạy `NODE_ENV=production` mà truy cập qua `http://`; cookie đăng nhập chỉ gửi qua HTTPS. | Truy cập bằng `https://`. |
| `deploy/duckdns-update.sh` báo `KO` | Sai token, hoặc subdomain chưa được tạo trong đúng tài khoản DuckDNS. | Tạo subdomain ở [8.2](#82-tạo-subdomain-duckdns); copy lại token. |
| `setup-nginx.sh` dừng ở bước kiểm tra DNS | Subdomain chưa trỏ về IP của VPS. | Chạy `deploy/duckdns-update.sh` trên VPS, đợi 1 phút. VPS sau NAT: chạy lại với `SKIP_DNS_CHECK=1`. |
| `setup-nginx.sh` báo đã có site dùng domain này | Một file nginx khác đã khai báo `server_name` trùng. | Chọn subdomain khác, hoặc kiểm tra file được liệt kê. |
| `setup-nginx.sh` báo Discrello không trả lời trên `127.0.0.1:3100` | Container chưa chạy, hoặc `DISCRELLO_PORT` khác cổng truyền cho script. | `docker compose up -d --build`; truyền đúng cổng làm tham số thứ ba. |
| `setup-nginx.sh` báo `nginx does not route ...` | nginx nhận request nhưng không chuyển vào block của Discrello. Script in ra ai đã trả lời và các dòng `listen`/`server_name` đang chạy. | Tìm block có `listen` cụ thể hơn (ví dụ `listen <IP>:80`) hoặc `server_name` trùng trong phần in ra. Nếu cần, thêm dòng `listen` tương ứng vào `discrello.conf`. |
| `setup-nginx.sh` báo cổng 80 do `docker-proxy` giữ | nginx đang chạy trong container, không phải trên máy. | Thêm nội dung `deploy/nginx/discrello.conf.template` vào cấu hình của nginx trong container đó, với `proxy_pass` tới địa chỉ container truy cập được. |
| certbot báo lỗi challenge (`Timeout`, `Connection refused`) | Firewall hoặc nhà cung cấp VPS chặn cổng 80 từ internet. | Mở cổng 80 (Let's Encrypt cần cổng 80 để xác minh), rồi chạy lại script. |
| certbot báo `too many certificates` | Chạm giới hạn cấp chứng chỉ của Let's Encrypt cho `duckdns.org`. | Đợi rồi thử lại. Sau khi cấp được, tự gia hạn không bị ảnh hưởng. |
| `502 Bad Gateway` khi mở domain | nginx không kết nối được container. | `docker compose ps` và `curl http://127.0.0.1:3100/api/health`; kiểm tra cổng trong `/etc/nginx/sites-available/discrello.conf` khớp `DISCRELLO_PORT`. |

---

## 12. Bảo mật

- Giữ `.env` bí mật: trong đó có mật khẩu database, token Trello, token bot Discord. Nếu lộ, đổi ngay: reset mật khẩu database trên Supabase, tạo lại token Trello, bấm **Reset Token** cho bot Discord.
- Đặt `ADMIN_PASSWORD` mạnh; giao diện quản trị truy cập được từ internet.
- Container chỉ bind vào `127.0.0.1`; mọi truy cập từ ngoài đều đi qua nginx và HTTPS. Không đổi `ports` trong `docker-compose.yml` thành `0.0.0.0`.
- Giữ `TRUST_PROXY_HOPS=1`. App lấy IP do nginx ghi nhận nên client không giả được IP để vượt giới hạn đăng nhập (10 lần/phút) và giới hạn webhook (60 lần/phút).
- Không thêm schema `discrello` vào Exposed schemas của Supabase.
- Sao lưu: Supabase tự sao lưu hằng ngày ở gói trả phí. Với gói miễn phí, có thể tự sao lưu định kỳ bằng `pg_dump` phiên bản 17 trở lên (cùng phiên bản Postgres của Supabase):
  ```bash
  pg_dump "$DATABASE_URL" --schema=discrello > discrello-$(date +%F).sql
  ```

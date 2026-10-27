# Discrello — Hướng dẫn sử dụng

Tài liệu này dành cho người **cấu hình và theo dõi** Discrello: ai được ping, cho list Trello nào, trong kênh Discord nào, với nội dung gì. Cài đặt và deploy xem ở [README](../README.md). Thiết kế hệ thống xem ở [PLAN.vi.md](PLAN.vi.md).

Bản tiếng Anh: [USER_GUIDE.en.md](USER_GUIDE.en.md).

Video hướng dẫn toàn bộ quy trình thiết lập (3 phút, thuyết minh và phụ đề tiếng Anh): [video/discrello-tutorial.en.mp4](video/discrello-tutorial.en.mp4).

Tên nút và tên trang được giữ nguyên tiếng Anh như trên giao diện.

---

## 1. Discrello làm gì

Khi một card Trello được **chuyển vào một list**, Discrello gửi tin nhắn vào kênh Discord, @-mention người (hoặc Discord role) phụ trách list đó, kèm tên card:

> @Tom — NFL Week 3 recap is ready for editing

Khi có người để lại góp ý cần sửa bằng một comment Trello bắt đầu bằng `comment:`, Discrello ping đúng người đó, tức người phụ trách list mà card đang nằm (xem mục 5.1):

> @Tom — feedback added for NFL Week 3 recap by Mike: fix the score in the title

Mọi thứ đều là cấu hình trên web app: dùng những server Discord nào, ai phụ trách từng role trong pipeline, list Trello nào ứng với role nào, và nội dung từng tin nhắn. Thêm board hay thêm server Discord không cần sửa code hay deploy lại.

---

## 2. Khái niệm chính

| Thuật ngữ | Ý nghĩa |
|---|---|
| **Server** | Một server Discord (guild) đã mời bot vào và đã thêm trong Discrello. Có thể có nhiều server. |
| **Role** | Người phụ trách một stage của pipeline, ví dụ `script_writer`, `editor`, `uploader`. Role dùng chung cho mọi board và mọi server. |
| **Target** | *Ai* được ping cho một role **trong một server**: một Discord user hoặc một Discord role. Mỗi role có một target cho mỗi server. |
| **Team** | Một nhóm role (người) có tên, ví dụ "Sports editors". List được map vào team sẽ ping mọi thành viên cùng lúc, mỗi người theo target của họ trong server của board. |
| **Board** | Một board Trello đã kết nối với Discrello. Mỗi board gửi vào một server và có một kênh mặc định. |
| **List mapping** | "Khi card vào *list này*, ping *role này* (hoặc *team này*) với *tin nhắn này*." List không có mapping thì không bao giờ ping. |
| **Message template** | Nội dung tin nhắn của một mapping, có các biến như `{mention}`, `{card_title}`. |
| **Channel** | Thư mục chứa các team trên trang Roles (vd mỗi show một channel), để danh sách team và ô chọn của list gọn hơn. Chỉ dùng để sắp xếp: không phải kênh Discord và không bao giờ được ping. |
| **Revision comment** | Comment Trello bắt đầu bằng `comment:`. Nó ping **người nhận feedback** của list (mặc định là role hoặc team của chính list đó), dùng **feedback message** của mapping. |
| **Notification** | Một tin nhắn Discrello đã gửi (hoặc đã cố gửi). Được lưu trong nhật ký kèm trạng thái và lỗi. |
| **Webhook event** | Một lần Trello gửi sự kiện tới, kể cả những lần không tạo ra tin nhắn, kèm lý do. |
| **Alert channel** | Kênh tùy chọn trong mỗi server, nơi Discrello báo sự cố (gửi thất bại, cấu hình từng chạy được nay bị hỏng). |

---

## 3. Đăng nhập

Mở địa chỉ của app (giá trị `PUBLIC_BASE_URL`, hoặc `http://localhost:5173` khi chạy local) và nhập mật khẩu admin (`ADMIN_PASSWORD` trong file `.env` của server). Phiên đăng nhập kéo dài 7 ngày. Trên máy dùng chung, bấm **Logout** ở góc trên bên phải khi xong.

Thanh trên cùng có năm trang: **Servers**, **Roles**, **Boards**, **Notifications**, **Settings**. Chấm cạnh chữ "integrations" màu xanh khi cả Trello và Discord đều phản hồi, màu đỏ khi có một bên lỗi (rê chuột để xem chi tiết).

---

## 4. Thiết lập lần đầu

Làm theo đúng thứ tự. Mỗi lần lưu đều được kiểm tra trực tiếp với Discord, nên sai sót được báo ngay thay vì âm thầm hỏng về sau.

### 4.1 Mời bot vào server Discord

1. Mở link mời (thay client ID nếu dùng bot khác):
   ```
   https://discord.com/oauth2/authorize?client_id=1556973292043112488&permissions=134144&integration_type=0&scope=bot
   ```
   Các quyền gồm **View Channels**, **Send Messages** và **Mention @everyone, @here, and All Roles**. Quyền cuối chỉ cần khi ping Discord role không bật "mentionable".
2. Trong Discord Developer Portal → application của bạn → **Bot** → **Privileged Gateway Intents**, bật **Server Members Intent**. Discrello cần quyền này để xác nhận một Discord role thực sự có người mang.

### 4.2 Thêm server

**Servers → Add server**

1. Chọn server trong **Server the bot is in**, hoặc dán ID vào **…or paste a server ID**.
2. Tùy chọn: **Alert channel ID**. Sự cố sẽ được báo vào kênh này. Nên dùng một kênh riêng cho admin.
3. Lưu. Dòng server hiện **bot OK** khi bot thấy được server.

### 4.3 Chọn người được ping cho từng role

**Roles →** bấm tên role để mở ra → chọn tab của server.

1. Chọn **Discord user** và dán user ID của người đó, hoặc chọn **Discord role** và chọn role trong danh sách.
2. Bấm **Save target**. Nếu không ai có thể nhận được thông báo, việc lưu bị từ chối kèm giải thích (xem [mục 7](#7-vì-sao-không-lưu-được)).
3. Tùy chọn: chọn kênh ở **Send a test ping to** rồi bấm **Send test ping**. Kết quả cho biết Discord có ghi nhận mention hay không.

Role hiện **no target in N servers** cho tới khi có target ở mọi server đã thêm. List được map vào role chưa có target thì không lưu được.

**Cách lấy Discord ID:** Discord → User Settings → Advanced → bật **Developer Mode**. Sau đó chuột phải vào người, role (Server Settings → Roles), kênh hoặc server và chọn **Copy ID**.

Muốn thêm role mới cho pipeline, bấm **New role** (key viết thường có gạch dưới, tên hiển thị, và tin nhắn mặc định nếu muốn).

### 4.4 Thêm board Trello

**Boards → Add board**

1. Dán URL board (ví dụ `https://trello.com/b/AbCd1234/sports`) rồi bấm **Fetch**. Tên board và các list hiện ra.
2. Chọn **Server** và **Default channel** là kênh nhận ping.
3. Bấm **Create board**. Discrello đăng ký webhook Trello cho board; trang board hiện **webhook active** khi thành công.

Tài khoản Trello của `TRELLO_API_TOKEN` phải là **thành viên của board**. Nếu không, Fetch báo `TRELLO_BOARD_NO_ACCESS` kèm tên tài khoản cần mời (nút Share trên board).

### 4.5 Map list vào role và soạn tin nhắn

Trên trang board, mỗi list Trello là một dòng.

1. Chọn role hoặc team trong ô chọn (mặc định là **— No notification —**). Ô chọn có dạng cây: mỗi channel là một thư mục chứa các team của nó, thêm **Teams without a channel** và **People** (mọi role). Bấm vào thư mục để mở hoặc đóng, hoặc gõ vào **Filter…** để tìm người. Ô tin nhắn tự điền tin nhắn mặc định của role, hoặc tin nhắn mặc định chung nếu chọn team.
2. Sửa tin nhắn nếu cần. Khung **Preview** hiển thị đúng nội dung sẽ được gửi.
3. Bấm **Map list**. Dòng hiện **OK** khi kiểm tra đạt.
4. Bấm **Send test** để gửi một tin mẫu vào kênh thật.

**Advanced: override who is pinged or which channel** cho phép một list ping người khác với target của role (hoặc thay cho cả team), hoặc gửi vào kênh khác kênh mặc định của board. Cả hai đều được kiểm tra như trên khi lưu.

Thiết lập xong. Từ giờ mọi người chỉ cần di chuyển card.

### 4.6 Team: ping nhiều người cùng lúc (tùy chọn)

Mỗi list ping một role hoặc một team. Muốn một list ping nhiều người thì gom họ vào một team.

**Roles → New team**

1. Nhập tên (ví dụ `Sports editors`) và tích chọn những người trong team. Có thể sửa thành viên sau.
2. Bấm **Create team**. Team hiện ở mục **Teams** đầu trang Roles, dạng thư mục: bấm vào tên để xem từng thành viên và target Discord của họ trong từng server. Mỗi dòng role cũng hiện các team mà role đó thuộc về.
3. Trên trang board, chọn team trong ô chọn của list rồi bấm **Map list**. Khung **Preview** hiện tất cả thành viên, ví dụ `@Tom @Ana`.

Quy tắc, để team không bao giờ ping vào khoảng không:

- Mọi thành viên phải có target Discord trong server của board và phải thấy được kênh. Nếu không, **Map list** bị từ chối và nêu tên thành viên đó (xem [mục 7](#7-vì-sao-không-lưu-được)).
- **Add a person** vào một team đang được list sử dụng cũng được kiểm tra như vậy, ở mọi kênh mà team đó ping.
- Team đang được list sử dụng thì không xóa được, và không bỏ được thành viên cuối cùng. Hãy bỏ map trước.
- Đổi target Discord của một người ở trang Roles sẽ áp dụng cho mọi team có người đó.

Khi card được chuyển, mọi người trong team được ping trong **một** tin nhắn. Nếu Discord không ghi nhận mention của ai đó, notification có trạng thái `sent_no_mention` và lỗi ghi rõ người bị bỏ sót.

### 4.7 Channel: thư mục chứa team (tùy chọn)

Khi có nhiều team (nhiều show, mỗi show nhiều bước), hãy gom chúng vào các **channel**. Channel là một thư mục: trên trang Roles nó đóng/mở như thư mục trong trình quản lý file, và trong ô chọn của list ở trang board, mỗi channel là một thư mục chứa các team của nó.

1. Roles → **New channel**, gõ tên (vd `Shorts Domination`) → **Create channel**.
2. Trong thư mục của channel, **New team here** tạo team nằm sẵn trong đó. Team đã có thì chuyển bằng ô **Channel** trong phần cài đặt của team (bấm vào tên team).
3. **Rename** / **Delete** nằm trên thư mục của channel. Xóa channel thì giữ nguyên các team của nó: chúng chuyển sang **No channel**. Không list nào bị thay đổi.

Channel chỉ để sắp xếp. List chỉ ping một team hoặc một người, không bao giờ ping cả một channel; muốn ping mọi người trong channel thì giữ một team gồm tất cả họ. Một người có thể ở nhiều team, thuộc bất kỳ channel nào. Khi chưa có channel nào, các team hiển thị như trước.

---

## 5. Sử dụng hằng ngày

Di chuyển card trên Trello như bình thường. Trong vài giây, người phụ trách list đích sẽ được ping.

| Thao tác trên Trello | Có ping không? |
|---|---|
| Kéo card vào list đã map | Có |
| Chuyển card từ board khác vào list đã map | Có |
| Tạo, copy hoặc convert card ngay trong list đã map | **Không** (bản này chưa hỗ trợ; sự kiện được ghi là `unsupported_action`) |
| Chuyển card vào list chưa map | Không (ghi là `no_mapping`) |
| Comment `comment: …` trên card nằm trong list đã map | Có, gửi feedback message (xem 5.1) |
| Comment khác | Không (ghi là `not_revision_comment`) |
| Đổi tên, lưu trữ, đổi label hay hạn | Không |
| Chuyển card A → B → A liên tiếp | Hai ping, mỗi lần chuyển một ping |

### 5.1 Comment yêu cầu sửa (revision comment)

QC yêu cầu sửa bằng cách comment trên card. Comment chỉ gây ping khi **bắt đầu bằng `comment:`**:

```
comment: Tighten the intro and fix the score in the title.
```

- **Ai được ping:** **người nhận feedback** của list mà card đang nằm **lúc comment**. Mặc định là role hoặc team của chính list đó (kèm mention override). Với list QC, hãy chọn người phải sửa trong **Feedback goes to** (xem mục 6): "Editor's QC step" → feedback đi tới editor, không phải người QC vừa viết nó. Tin nhắn được gửi vào kênh của list (kể cả channel override).
- **Nội dung gửi:** **feedback message** của list (xem mục 6). Mặc định: `{mention} — feedback added for {card_title} by {commented_by}: {comment_text}`. Prefix `comment:` được bỏ khỏi `{comment_text}`; góp ý dài hơn 1.000 ký tự bị cắt và thêm `…`.
- **Prefix:** không phân biệt hoa thường và bỏ qua khoảng trắng phía trước (`Comment:` hay ` COMMENT:` đều được). Prefix phải nằm ngay đầu: `fix this, comment: later` thì không ping.
- **Sửa comment thì không ping lại.** Ngoại lệ duy nhất: QC quên prefix rồi sửa comment để thêm vào, thì lần sửa đó sẽ ping.
- **Mỗi comment ping tối đa một lần.** Xóa prefix rồi thêm lại, hay sửa một comment đã ping, đều không ping nữa.
- Comment yêu cầu sửa trên card nằm ở list chưa map, hoặc mapping đang tắt, thì không ping (ghi là `no_mapping` / `mapping_disabled`, giống khi chuyển card).

---

## 6. Sửa nội dung tin nhắn

Mỗi list mapping có tin nhắn riêng. Sửa trên trang board rồi bấm **Save**. Không có nội dung tin nhắn nào nằm trong code.

**Các biến** (bấm vào các nút bên dưới ô soạn để chèn):

| Biến | Được thay bằng |
|---|---|
| `{mention}` | Lượt ping, ví dụ `@Tom` hoặc `@Editors` |
| `{card_title}` | Tên card Trello |
| `{card_url}` | Link tới card |
| `{list_name}` | List mà card vừa vào |
| `{previous_list_name}` | List card vừa rời (để trống khi chuyển từ board khác sang) |
| `{board_name}` | Tên board Trello |
| `{moved_by}` | Thành viên Trello đã di chuyển card |

Ví dụ:

```
{mention} — {card_title} is ready for editing
{mention} — {card_title} moved from {previous_list_name} to {list_name} by {moved_by}: {card_url}
```

Quy tắc và mẹo:

- Giữ `{mention}` trong tin nhắn; thiếu nó thì không ai được ping. Trình soạn sẽ cảnh báo.
- Biến không tồn tại như `{card_name}` được giữ nguyên như gõ, và trình soạn cảnh báo.
- Tối đa 1.900 ký tự. Markdown của Discord (`**đậm**`, `_nghiêng_`) dùng được.
- Mapping mới lấy **tin nhắn mặc định của role** (Roles → Edit), hoặc **tin nhắn mặc định chung** (Settings → Default message template) khi role không có. Sau đó chỉ dùng tin nhắn riêng của mapping; đổi tin nhắn mặc định không sửa các mapping đã có.
- Tên card không bao giờ gây ping thêm: `@everyone` trong tên card chỉ hiện như chữ.

**Feedback message (cho comment yêu cầu sửa).** Mỗi mapping còn có một feedback message, dùng cho comment yêu cầu sửa trên card trong list đó. Mở mục **Feedback message for revision comments** bên dưới tin nhắn của list.

**Feedback goes to** chọn ai được ping: **Same as this list** (mặc định), hoặc bất kỳ team hay người nào trong cùng ô chọn dạng cây như của list. Khi lưu, Discrello kiểm tra họ với Discord giống như list (có target trong server này, thấy được kênh); lỗi khi lưu sẽ bắt đầu bằng `Feedback:`. Mention override trong **Advanced** chỉ áp dụng cho ping của chính list.

Nội dung tin nhắn:

- **(default)**: list dùng **Settings → Default feedback message**. Đổi mẫu mặc định này sẽ áp dụng cho mọi list chưa có feedback message riêng.
- **Customize for this list**: chép mẫu mặc định vào ô soạn riêng cho list này. **Use the default instead** quay lại dùng mẫu mặc định chung.

Feedback message có bộ biến riêng:

| Biến | Được thay bằng |
|---|---|
| `{mention}`, `{card_title}`, `{card_url}`, `{board_name}` | Như bảng trên |
| `{list_name}` | List mà card đang nằm |
| `{commented_by}` | Thành viên Trello đã viết comment |
| `{comment_text}` | Nội dung comment, đã bỏ prefix `comment:` |

`{previous_list_name}` và `{moved_by}` không có giá trị trong feedback message (còn `{comment_text}` / `{commented_by}` không có giá trị trong tin nhắn chuyển card); trình soạn sẽ cảnh báo nếu bạn dùng. Nội dung comment cũng không bao giờ gây ping thêm: `@everyone` trong comment chỉ hiện như chữ.

---

## 7. Vì sao không lưu được

Khi lưu target, mapping, kênh của board hay server, Discrello kiểm tra trực tiếp với Discord. Nếu kết quả là **không ai thực sự nhận được thông báo**, việc lưu bị từ chối, không có gì được ghi, và khung đỏ giải thích lý do cùng cách sửa.

| Mã lỗi | Ý nghĩa | Cách sửa |
|---|---|---|
| `ROLE_NOT_PINGABLE` | Discord role không bật mentionable và bot thiếu quyền "Mention @everyone, @here, and All Roles" trong kênh đó. | Server Settings → Roles → role đó → bật **Allow anyone to @mention this role**, hoặc cấp quyền đó cho bot. |
| `ROLE_HAS_NO_MEMBERS` | Không ai mang Discord role này. | Gán role cho ít nhất một người. |
| `ROLE_MEMBERS_CANNOT_SEE_CHANNEL` | Có người mang role nhưng không ai thấy kênh. | Cho role quyền xem kênh, hoặc chọn kênh khác. |
| `ROLE_NOT_FOUND` / `ROLE_IS_EVERYONE` | Sai role ID, hoặc chọn `@everyone`. | Copy lại role ID; chọn một role cụ thể. |
| `USER_NOT_IN_GUILD` | User không phải thành viên của server. | Kiểm tra user ID; mời người đó vào server. |
| `USER_CANNOT_SEE_CHANNEL` | User không thấy kênh nên sẽ không nhận được thông báo. | Cấp quyền xem kênh, hoặc chọn kênh khác. |
| `USER_IS_BOT` | Target là một bot. | Chọn người thật. |
| `ROLE_HAS_NO_TARGET` | Role của pipeline (hoặc một thành viên team, có nêu tên trong thông báo) chưa có target trong server này. | Đặt target ở trang Roles, bỏ người đó khỏi team, hoặc dùng mention override của mapping. |
| `TEAM_HAS_NO_MEMBERS` | Team chưa có ai, nên list sẽ không ping được ai. | Roles → team đó → **Add a person**. |
| `CHANNEL_NOT_FOUND` | Channel ID sai hoặc thuộc server khác. | Copy channel ID từ đúng server. |
| `CHANNEL_WRONG_TYPE` / `CHANNEL_ARCHIVED` | Kênh voice, category, hoặc thread đã lưu trữ. | Chọn kênh text, announcement, hoặc thread đang mở. |
| `BOT_CANNOT_VIEW_CHANNEL` / `BOT_CANNOT_SEND` | Bot không thấy hoặc không gửi được vào kênh. | Cài đặt kênh → Permissions → cho bot **View Channel** và **Send Messages**. |
| `BOT_NOT_IN_GUILD` | Bot không ở trong server đó. | Mời bot bằng link ở [4.1](#41-mời-bot-vào-server-discord). |
| `MEMBERS_INTENT_DISABLED` | Server Members Intent đang tắt nên không kiểm tra được thành viên của role. | Bật trong Developer Portal ([4.1](#41-mời-bot-vào-server-discord)). |
| `DISCORD_ERROR` | Discord phản hồi bất thường. | Đợi một lát rồi thử lại; xem chấm integrations. |
| `TRELLO_BOARD_NO_ACCESS` | Tài khoản Trello mà Discrello dùng không phải thành viên board nên Trello từ chối. Thông báo ghi rõ tên tài khoản. | Trong Trello: mở board → **Share** → mời tài khoản đó, rồi bấm Fetch lại. |
| `TRELLO_BOARD_NOT_FOUND` | Không có board nào ở URL hoặc ID này. | Mở board trong Trello và copy địa chỉ trên trình duyệt (`https://trello.com/b/…`). |
| `TRELLO_KEY_INVALID` / `TRELLO_TOKEN_INVALID` | Trello từ chối API key hoặc token trong `.env` của server. | Sửa `TRELLO_API_KEY` / `TRELLO_API_TOKEN` (hướng dẫn cài đặt, mục 5) rồi khởi động lại Discrello. |

---

## 8. Xem những gì đã gửi

### 8.1 Tab Notifications

Trang **Notifications** liệt kê mọi tin nhắn, mới nhất ở trên, tự làm mới mỗi 10 giây. Lọc theo server, board hoặc trạng thái. **View** hiện đúng nội dung, kênh, Discord message ID và mention đã được xác nhận hay chưa.

| Trạng thái | Ý nghĩa |
|---|---|
| `sent` | Đã gửi, và Discord xác nhận người hoặc role đã được mention. |
| `pending` / retrying | Đang chờ gửi, hoặc chờ lần thử lại sau lỗi tạm thời (Discord lỗi, bị giới hạn tốc độ). Tối đa 5 lần trong khoảng 13 phút (sau 5 giây, 30 giây, 2 phút, 10 phút). |
| `sent_no_mention` | Đã gửi, **nhưng Discord không ghi nhận mention**, nên không ai được ping (với team: lỗi ghi rõ những thành viên bị bỏ sót, những người còn lại vẫn được ping). Thường do role bị tắt mentionable hoặc người nhận mất quyền xem kênh. Có cảnh báo gửi vào alert channel. |
| `failed` | Không gửi được. Cột **Error** ghi lý do (ví dụ bot mất quyền vào kênh, hoặc role chưa có target). Có cảnh báo gửi vào alert channel. |

**Retry** dựng lại tin nhắn theo cấu hình **hiện tại** và gửi lại. Hãy sửa nguyên nhân trước rồi mới bấm Retry.

### 8.2 Tab Webhook events

Mọi lần Trello gửi sự kiện tới, kể cả những lần không tạo ra tin nhắn. Đây là chỗ trả lời câu hỏi "vì sao không có ping?".

| Lý do | Ý nghĩa |
|---|---|
| *(enqueued)* | Đã tạo notification. |
| `no_mapping` | List đích chưa được map. |
| `mapping_disabled` | Có mapping nhưng công tắc **Enabled** đang tắt. |
| `board_disabled` / `guild_disabled` | Board hoặc server đang bị tắt. |
| `unsupported_action` | Không phải di chuyển card hay comment (tạo, copy, đổi tên, lưu trữ…). |
| `not_revision_comment` | Comment (hoặc lần sửa comment) không bắt đầu bằng `comment:`. |
| `prefix_already_present` | Sửa một comment vốn đã bắt đầu bằng `comment:`; sửa comment không bao giờ ping lại. |
| `comment_already_notified` | Comment này đã ping một lần rồi (ví dụ xóa prefix rồi thêm lại). |
| `card_list_unknown` | Sửa comment trên card mà Trello không còn (đã xóa), nên không biết card nằm ở list nào. |
| `board_mismatch` | Sự kiện ghi một board khác với board mong đợi; bỏ qua để an toàn. |

**Trùng lặp:** Trello gửi lại sự kiện khi không nhận được phản hồi kịp. Discrello nhận ra lần gửi lại và không bao giờ ping hai lần; cột **duplicate** cho biết đã chặn bao nhiêu lần gửi lặp.

Request không có chữ ký Trello hợp lệ bị từ chối trước khi vào nhật ký này, nên không ai giả mạo được việc di chuyển card bằng cách gọi thẳng URL webhook.

---

## 9. Cảnh báo và kiểm tra định kỳ

- **Alert channel:** đặt riêng cho từng server (Servers → sửa). Discrello báo vào đây khi notification bị `failed` hoặc `sent_no_mention`, và khi một cấu hình từng chạy được nay bị hỏng.
- **Tự kiểm tra lại mỗi 15 phút:** mọi target và mapping được kiểm tra lại, vì quyền trên Discord có thể bị đổi sau khi lưu. Mục bị hỏng có nhãn đỏ **Broken** ở trang Roles và trang board, kèm lý do. Chạy ngay bằng **Settings → Re-check mentions**.
- **Nhãn webhook Trello** trên trang board:

| Nhãn | Ý nghĩa | Cần làm |
|---|---|---|
| `webhook active` | Trello đang gửi sự kiện tới Discrello. | — |
| `inactive` | Trello tạm dừng webhook sau nhiều lần gửi lỗi. | **Check now** bật lại. |
| `missing` | Webhook đã bị xóa phía Trello. | **Check now** hoặc **Re-register** tạo lại. |
| `mismatch` | Webhook trỏ về địa chỉ cũ (ví dụ URL công khai đã đổi). | **Re-register**; cũng tự sửa khi khởi động. |
| `error` / `unregistered` | Đăng ký thất bại hoặc chưa đăng ký. | Đọc lỗi, sửa, rồi **Re-register**. |

Việc sửa webhook này cũng tự chạy khi khởi động và mỗi 15 phút (**Settings → Reconcile webhooks** chạy ngay).

---

## 10. Các thao tác thường gặp

| Việc cần làm | Cách làm |
|---|---|
| Thêm board khác | Boards → Add board, rồi map các list. Role và target được dùng lại. |
| Thêm server Discord thứ hai | Mời bot, Servers → Add server, rồi ở trang Roles đặt target cho từng role trong tab của server mới. Không cần deploy lại. |
| Đổi người được ping cho một stage | Roles → role đó → tab server → user/role mới → Save target. Áp dụng cho mọi list map vào role đó trong server đó. |
| Một list ping người khác | Trang board → list đó → Advanced → Mention override. |
| Một list ping nhiều người | Roles → **New team** gồm những người đó, rồi chọn team cho list ở trang board ([4.6](#46-team-ping-nhiều-người-cùng-lúc-tùy-chọn)). |
| Quá nhiều team, khó tìm | Roles → **New channel**, rồi chuyển team vào đó (mục 4.7). |
| Feedback ở list QC phải tới editor | Trang board → list QC → **Feedback message for revision comments** → **Feedback goes to** → editor → Save. |
| Có người vào hoặc rời team | Roles → team đó → **Add a person** / **Remove**. Mọi list đang map vào team tự áp dụng theo. |
| Đổi kênh | Trang board → Discord destination → **Change** (kênh mặc định), hoặc Advanced → Channel override cho một list. |
| Tạm dừng thông báo | Tắt công tắc **Enabled** của list, board hoặc server. Sự kiện vẫn được ghi nhật ký. |
| Đổi tên hoặc thêm list trên Trello | Trang board → **Re-sync lists**. Mapping theo list, không theo tên. |
| Ngừng dùng một board | Trang board → **Remove board**. Thao tác này xóa luôn webhook Trello của board. |

---

## 11. Xem dữ liệu trong database

Toàn bộ dữ liệu nằm trên Supabase (Postgres), trong một schema riêng tên **`discrello`**.

### 11.1 Trên app (nên dùng)

Trang **Notifications** cho biết đã gửi gì, lỗi gì và vì sao, cùng mọi sự kiện từ Trello. Với câu hỏi hằng ngày như vậy là đủ.

### 11.2 Table Editor của Supabase

1. Mở Supabase dashboard → project → **Table Editor**
   (`https://supabase.com/dashboard/project/<project-ref>/editor`; project ref của bản deploy này là `iarcopprffkscowpbfin`).
2. Ở đầu danh sách bảng, đổi ô chọn **schema** từ `public` sang **`discrello`**.
3. Bấm vào bảng để xem.

| Bảng | Nội dung |
|---|---|
| `notifications` | Mọi tin nhắn: card, list, kênh, nội dung, trạng thái, số lần thử, lỗi, Discord message ID. |
| `webhook_events` | Mọi sự kiện Trello gửi tới và lý do bị bỏ qua; bộ đếm trùng lặp. |
| `guilds` | Các server Discord và alert channel. |
| `roles` | Các role của pipeline và tin nhắn mặc định. |
| `role_targets` | Ai được ping cho từng role trong từng server. |
| `team_channels` | Các channel: thư mục chứa team. |
| `teams` / `team_members` | Các team, channel của team, và những role thuộc mỗi team. |
| `boards` | Các board Trello, kênh và trạng thái webhook. |
| `trello_lists` | Các list của từng board (lấy từ Trello). |
| `list_mappings` | List → role hoặc team → tin nhắn, cùng các override, feedback message và người nhận feedback. |
| `settings` | Tin nhắn mặc định chung. |

> **Chỉ nên xem, không nên sửa.** Thay đổi cấu hình qua app. Sửa trực tiếp trong bảng sẽ bỏ qua bước kiểm tra với Discord ở [mục 7](#7-vì-sao-không-lưu-được). Nếu buộc phải sửa, hãy chạy **Settings → Re-check mentions** sau đó.
>
> **Không** thêm `discrello` vào *Project Settings → API → Exposed schemas*; làm vậy sẽ khiến dữ liệu đọc được bằng API key công khai.

### 11.3 SQL Editor: các truy vấn có sẵn

Supabase → **SQL Editor** → New query, dán vào, bấm **Run**.

20 notification gần nhất:

```sql
select id, created_at, status, attempts, board_name, list_name, card_name,
       mention_verified, last_error
from discrello.notifications
order by id desc
limit 20;
```

Tình hình 7 ngày qua:

```sql
select status, count(*)
from discrello.notifications
where created_at > now() - interval '7 days'
group by status
order by 2 desc;
```

Vì sao không có ping:

```sql
select received_at, action_type, outcome, ignore_reason, list_name, duplicate_count
from discrello.webhook_events
order by id desc
limit 20;
```

Ai được ping cho list nào:

```sql
select b.name as board, l.name as list,
       coalesce(r.key, 'team ' || tm.name) as role_or_team,
       coalesce(m.override_mention_kind || ':' || m.override_mention_id,
                string_agg(t.mention_kind || ':' || t.mention_id, ', ')) as pinged,
       coalesce(m.override_channel_id, b.discord_channel_id) as channel,
       m.enabled, m.check_status
from discrello.list_mappings m
join discrello.boards b on b.id = m.board_id
left join discrello.roles r on r.id = m.role_id
left join discrello.teams tm on tm.id = m.team_id
left join discrello.team_members mem on mem.team_id = m.team_id
left join discrello.trello_lists l on l.board_id = m.board_id and l.trello_list_id = m.trello_list_id
left join discrello.role_targets t
       on t.role_id = coalesce(m.role_id, mem.role_id) and t.guild_id = b.guild_id
group by m.id, b.name, b.discord_channel_id, l.name, l.pos, r.key, tm.name
order by b.name, l.pos;
```

### 11.4 Bằng phần mềm quản lý database

psql, DBeaver, TablePlus hoặc pgAdmin kết nối được bằng cùng chuỗi kết nối với app (`DATABASE_URL` trong `.env`, **Session pooler** của Supabase, cổng 5432, bắt buộc SSL):

```
psql "$DATABASE_URL" -c "select status, count(*) from discrello.notifications group by 1"
```

---

## 12. Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| Đã chuyển card nhưng không có tin nhắn | Notifications → **Webhook events**. Không có sự kiện nào: nhãn webhook của board không ở trạng thái active, hoặc server/URL công khai đang tắt. Có sự kiện kèm lý do: xem [8.2](#82-tab-webhook-events). |
| Tin nhắn đã đến nhưng không ai nhận thông báo | Trạng thái `sent_no_mention`: xem [8.1](#81-tab-notifications). Nếu trạng thái là `sent`, Discord đã mention người đó; cài đặt Discord riêng của họ (tắt tiếng server hoặc kênh) vẫn có thể chặn thông báo, và Discrello không nhìn thấy điều này. |
| Card tạo trực tiếp trong list không ping | Đúng thiết kế: bản này chỉ hỗ trợ di chuyển card. |
| Lưu target hoặc mapping bị lỗi | Đọc khung đỏ; xem [mục 7](#7-vì-sao-không-lưu-được). |
| Chấm integrations màu đỏ | Settings → Integrations cho biết bên nào lỗi (Trello token, Discord bot token, Members Intent). |
| URL công khai thay đổi (ví dụ tunnel mới) | Cập nhật `PUBLIC_BASE_URL` và khởi động lại; webhook được đăng ký lại tự động. |
| Quên mật khẩu admin | Là `ADMIN_PASSWORD` trong `.env` của server; đổi ở đó rồi khởi động lại. |

---

## 13. Thời gian lưu dữ liệu

Notification được giữ **90 ngày**, webhook event được giữ **30 ngày**; dữ liệu cũ hơn được xóa mỗi ngày. Cấu hình (server, role, target, board, mapping, tin nhắn) được giữ cho tới khi bạn xóa.

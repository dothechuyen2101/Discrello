# Discrello — User Guide

This guide is for the people who **configure and watch** Discrello: who gets pinged, for which Trello list, in which Discord channel, and with what message. Installing and deploying the app is covered in the [README](../README.md). The design is in [PLAN.en.md](PLAN.en.md).

A 3-minute narrated walkthrough of the whole setup is in [video/discrello-tutorial.en.mp4](video/discrello-tutorial.en.mp4) (captions: [.srt](video/discrello-tutorial.en.srt)).

---

## 1. What Discrello does

When a Trello card is **moved into a list**, Discrello posts a message in a Discord channel that @-mentions the person (or Discord role) responsible for that list, and names the card:

> @Tom — NFL Week 3 recap is ready for editing

When someone leaves revision feedback as a Trello comment that starts with `comment:`, Discrello pings the same person, the one responsible for the list the card is in now (see [5.1](#51-revision-comments)):

> @Tom — feedback added for NFL Week 3 recap by Mike: fix the score in the title

Everything is configuration you manage in the web app: which Discord servers are used, who is responsible for each pipeline role, which Trello lists map to which role, and the text of each message. Adding a board or a Discord server never needs a code change or a redeploy.

---

## 2. Key concepts

| Term | Meaning |
|---|---|
| **Server** | A Discord server (guild) the bot has been invited to and that you have added in Discrello. You can have several. |
| **Role** | A pipeline stage owner, e.g. `script_writer`, `editor`, `uploader`. Roles are shared by every board and server. |
| **Target** | *Who* gets pinged for a role **in one server**: a Discord user or a Discord role. Each role has one target per server. |
| **Team** | A named group of roles (people), e.g. "Sports editors". A list mapped to a team pings every member at once, each with their own target in the board's server. |
| **Board** | A Trello board connected to Discrello. Each board sends to one server and has a default channel. |
| **List mapping** | "When a card enters *this list*, ping *this role* (or *this team*) with *this message*." Lists without a mapping never ping. |
| **Message template** | The text of a mapping's message, with placeholders like `{mention}` and `{card_title}`. |
| **Channel** | A folder of teams on the Roles page (e.g. one per show), so the list of teams and the list picker stay short. Only for organising: it is not a Discord channel and is never pinged itself. |
| **Revision comment** | A Trello comment that starts with `comment:`. It pings the list's **feedback recipient** (by default the list's own role or team) with the mapping's **feedback message**. |
| **Notification** | One message Discrello sent (or tried to send). Kept in the log with its status and error. |
| **Webhook event** | One delivery from Trello, including the ones that did not produce a message, with the reason. |
| **Alert channel** | An optional channel per server where Discrello reports problems (failed sends, configuration that stopped working). |

---

## 3. Logging in

Open the app URL (the value of `PUBLIC_BASE_URL`, or `http://localhost:5173` in local development) and enter the admin password (`ADMIN_PASSWORD` in the server's `.env`). The session lasts 7 days. Use **Logout** at the top right on shared computers.

The top bar has five pages: **Servers**, **Roles**, **Boards**, **Notifications**, **Settings**. The dot next to "integrations" is green when Trello and Discord both answer, red otherwise (hover for details).

---

## 4. First-time setup

Follow the steps in order. Each save is checked live against Discord, so a mistake is reported immediately instead of failing silently later.

### 4.1 Invite the bot to your Discord server

1. Open the invite link (replace the client ID if you use another bot):
   ```
   https://discord.com/oauth2/authorize?client_id=1552355192614293534&scope=bot&permissions=134144
   ```
   The permissions are **View Channels**, **Send Messages** and **Mention @everyone, @here, and All Roles**. The last one is only needed to ping Discord roles that are not "mentionable".
2. In the Discord Developer Portal → your application → **Bot** → **Privileged Gateway Intents**, enable **Server Members Intent**. Discrello needs it to confirm that a Discord role actually has members.

### 4.2 Add the server

**Servers → Add server**

1. Pick the server from **Server the bot is in**, or paste its ID in **…or paste a server ID**.
2. Optional: **Alert channel ID**. Problems will be posted there. A private channel for admins works well.
3. Save. The row shows **bot OK** when the bot can see the server.

### 4.3 Choose who is pinged for each role

**Roles →** click a role name to expand it → pick the server tab.

1. Choose **Discord user** and paste the person's user ID, or choose **Discord role** and pick a role from the list.
2. Click **Save target**. If nobody could be notified, the save is refused with an explanation (see [section 7](#7-why-a-save-is-refused)).
3. Optional: pick a channel under **Send a test ping to** and click **Send test ping**. The result says whether Discord registered the mention.

A role shows **no target in N servers** until it has a target in every server you added. Lists mapped to a role without a target cannot be saved.

**Finding Discord IDs:** Discord → User Settings → Advanced → turn on **Developer Mode**. Then right-click a person, role (Server Settings → Roles), channel or server and choose **Copy ID**.

To add a new pipeline role, click **New role** (key in lowercase with underscores, a display name, and an optional default message).

### 4.4 Add a Trello board

**Boards → Add board**

1. Paste the board URL (e.g. `https://trello.com/b/AbCd1234/sports`) and click **Fetch**. The board name and its lists appear.
2. Pick the **Server** and the **Default channel** where pings go.
3. Click **Create board**. Discrello registers a Trello webhook for the board; the board page shows **webhook active** when it worked.

The Trello account behind `TRELLO_API_TOKEN` must be a **member of the board**. Otherwise Fetch fails with `TRELLO_BOARD_NO_ACCESS`, and the message names the account to invite (Share on the board).

### 4.5 Map lists to roles and write the messages

On the board page, every Trello list has a row.

1. Choose a role or a team in the picker (it starts at **— No notification —**). The picker is a tree: one folder per channel with its teams, **Teams without a channel**, and **People** (every role). Click a folder to open or close it, or type in **Filter…** to find someone. The message box is pre-filled with the role's default message, or the global default for a team.
2. Edit the message if needed. The **Preview** shows exactly what will be posted.
3. Click **Map list**. The row shows **OK** when the check passed.
4. Click **Send test** to post a sample message to the real channel.

**Advanced: override who is pinged or which channel** lets one list ping someone other than the role's target (or instead of the whole team), or post in another channel than the board default. Both are checked the same way when you save.

Setup is complete. From now on, moving cards is all anyone has to do.

### 4.6 Teams: ping several people at once (optional)

A list pings one role or one team. To ping several people for the same list, put them in a team.

**Roles → New team**

1. Type a name (e.g. `Sports editors`) and tick the people to put in it. You can change the members later.
2. Click **Create team**. The team appears under **Teams** at the top of the Roles page, as a folder: click its name to see each member and their Discord target per server. Each role row also shows the teams it belongs to.
3. On the board page, pick the team in the list's dropdown and click **Map list**. The **Preview** shows every member, e.g. `@Tom @Ana`.

Rules, so a team never pings nobody:

- Every member needs a Discord target in the board's server, and must be able to see the channel. Otherwise **Map list** is refused and names the member (see [section 7](#7-why-a-save-is-refused)).
- **Add a person** to a team that lists already ping is checked the same way, in every channel where the team pings.
- A team that lists use cannot be deleted, and its last member cannot be removed. Unmap it first.
- Changing a member's Discord target on the Roles page applies to every team they are in.

When a card moves, everyone in the team is pinged in **one** message. If Discord does not register one of the mentions, the notification is `sent_no_mention` and the error names who was missed.

### 4.7 Channels: folders of teams (optional)

With many teams (several shows, several steps each), group them into **channels**. A channel is a folder: on the Roles page it opens and closes like a folder in a file explorer, and in the list picker on the board page each channel is a folder with its teams inside.

1. Roles → **New channel**, type a name (e.g. `Shorts Domination`) → **Create channel**.
2. In the channel's folder, **New team here** creates a team inside it. An existing team moves with **Channel** in the team's own settings (click the team's name).
3. **Rename** / **Delete** are on the channel's folder. Deleting a channel keeps its teams: they move to **No channel**. No list changes.

A channel is only for organising. Lists ping a team or a person, never a whole channel; to ping everyone in a channel, keep a team with all of them in it. One person can be in several teams, in any channels. As long as there are no channels, teams are listed as before.

---

## 5. Everyday use

Move cards on Trello as usual. Within a couple of seconds the person responsible for the destination list is pinged.

| Action on Trello | Ping? |
|---|---|
| Drag a card into a mapped list | Yes |
| Move a card from another board into a mapped list | Yes |
| Create, copy or convert a card directly in a mapped list | **No** (not supported in this version; the event is logged as `unsupported_action`) |
| Move a card into a list with no mapping | No (logged as `no_mapping`) |
| Comment `comment: …` on a card in a mapped list | Yes, the feedback message (see 5.1) |
| Any other comment | No (logged as `not_revision_comment`) |
| Rename, archive, change labels or due dates | No |
| Move a card A → B → A quickly | Two pings, one per move |

### 5.1 Revision comments

QC asks for changes by commenting on the card. A comment pings only when it **starts with `comment:`**:

```
comment: Tighten the intro and fix the score in the title.
```

- **Who is pinged:** the list's **feedback recipient**, for the list the card is in **at the time of the comment**. By default that is the list's own role or team (with its mention override). For a QC list, choose the person who has to make the changes under **Feedback goes to** (see [6](#6-editing-messages)): "Editor's QC step" → feedback goes to the editor, not to the QC person who wrote it. The message is posted in the list's channel (including its channel override).
- **What is sent:** the list's **feedback message** (see [6](#6-editing-messages)). By default: `{mention} — feedback added for {card_title} by {commented_by}: {comment_text}`. The `comment:` prefix is removed from `{comment_text}`; feedback over 1,000 characters is cut with `…`.
- **The prefix:** upper/lower case does not matter and spaces before it are ignored (`Comment:` and ` COMMENT:` both work). It must be at the very start: `fix this, comment: later` does not ping.
- **Edited comments do not ping again.** The one exception: if QC forgot the prefix and edits the comment to add it, that edit pings.
- **At most one ping per comment.** Removing the prefix and adding it back, or editing a comment that already pinged, does not ping again.
- A revision comment on a card in a list with no mapping, or with the mapping disabled, does not ping (logged as `no_mapping` / `mapping_disabled`, like moves).

---

## 6. Editing messages

Each list mapping has its own message. Edit it on the board page and click **Save**. Nothing about messages lives in code.

**Placeholders** (click a chip under the text box to insert one):

| Placeholder | Replaced with |
|---|---|
| `{mention}` | The ping, e.g. `@Tom` or `@Editors` |
| `{card_title}` | The Trello card title |
| `{card_url}` | Link to the card |
| `{list_name}` | The list the card entered |
| `{previous_list_name}` | The list the card came from (empty when moved in from another board) |
| `{board_name}` | The Trello board name |
| `{moved_by}` | The Trello member who moved the card |

Examples:

```
{mention} — {card_title} is ready for editing
{mention} — {card_title} moved from {previous_list_name} to {list_name} by {moved_by}: {card_url}
```

Rules and tips:

- Keep `{mention}` in the message; without it nobody is pinged. The editor warns you.
- An unknown placeholder such as `{card_name}` stays as typed, and the editor warns about it.
- Maximum 1,900 characters. Discord markdown (`**bold**`, `_italic_`) works.
- A new mapping starts from the **role's default message** (Roles → Edit), or from the **global default** (Settings → Default message template) when the role has none. After that, only the mapping's own message is used; changing a default does not rewrite existing mappings.
- Card titles can never trigger extra pings: `@everyone` in a title is shown as text.

**Feedback message (revision comments).** Each mapping also has a feedback message, used for revision comments on cards in that list. Open **Feedback message for revision comments** under the list's message.

**Feedback goes to** chooses who is pinged: **Same as this list** (default), or any team or person from the same picker as the list. Saving checks them with Discord like the list itself (a target in this server, can see the channel); a refused save starts with `Feedback:`. The mention override under **Advanced** applies to the list's own pings only.

The message itself:

- **(default)**: the list uses **Settings → Default feedback message**. Changing that default changes every list that has no feedback message of its own.
- **Customize for this list**: copies the default into an editor for this list only. **Use the default instead** goes back to the shared default.

The feedback message has its own placeholders:

| Placeholder | Replaced with |
|---|---|
| `{mention}`, `{card_title}`, `{card_url}`, `{board_name}` | Same as above |
| `{list_name}` | The list the card is in |
| `{commented_by}` | The Trello member who wrote the comment |
| `{comment_text}` | The comment without the `comment:` prefix |

`{previous_list_name}` and `{moved_by}` have no value in a feedback message (and `{comment_text}` / `{commented_by}` have none in a move message); the editor warns when you use them. Comment text can never trigger extra pings either: `@everyone` in a comment is shown as text.

---

## 7. Why a save is refused

Saving a target, a mapping, a board channel or a server runs live checks against Discord. If the result is that **nobody would actually be notified**, the save is refused, nothing is stored, and a red box explains why and how to fix it.

| Message code | What it means | How to fix |
|---|---|---|
| `ROLE_NOT_PINGABLE` | The Discord role is not mentionable and the bot lacks "Mention @everyone, @here, and All Roles" in that channel. | Server Settings → Roles → the role → enable **Allow anyone to @mention this role**, or give the bot that permission. |
| `ROLE_HAS_NO_MEMBERS` | Nobody has the Discord role. | Assign the role to at least one person. |
| `ROLE_MEMBERS_CANNOT_SEE_CHANNEL` | People have the role, but none of them can see the channel. | Give the role access to the channel, or pick another channel. |
| `ROLE_NOT_FOUND` / `ROLE_IS_EVERYONE` | Wrong role ID, or `@everyone` was chosen. | Copy the role ID again; pick a specific role. |
| `USER_NOT_IN_GUILD` | That user is not a member of the server. | Check the user ID; invite the person. |
| `USER_CANNOT_SEE_CHANNEL` | The user cannot see the channel, so would not be notified. | Give access to the channel, or pick another channel. |
| `USER_IS_BOT` | The target is a bot. | Pick a person. |
| `ROLE_HAS_NO_TARGET` | The pipeline role (or a team member, named in the message) has no target in this server yet. | Set it on the Roles page, take that person out of the team, or use the mapping's mention override. |
| `TEAM_HAS_NO_MEMBERS` | The team is empty, so the list would ping nobody. | Roles → the team → **Add a person**. |
| `CHANNEL_NOT_FOUND` | The channel ID is wrong or belongs to another server. | Copy the channel ID from the right server. |
| `CHANNEL_WRONG_TYPE` / `CHANNEL_ARCHIVED` | Voice channel, category, or archived thread. | Pick a text or announcement channel, or an open thread. |
| `BOT_CANNOT_VIEW_CHANNEL` / `BOT_CANNOT_SEND` | The bot cannot see or post in the channel. | Channel settings → Permissions → allow the bot **View Channel** and **Send Messages**. |
| `BOT_NOT_IN_GUILD` | The bot is not in that server. | Invite it with the link in [4.1](#41-invite-the-bot-to-your-discord-server). |
| `MEMBERS_INTENT_DISABLED` | The Server Members Intent is off, so role members cannot be checked. | Enable it in the Developer Portal ([4.1](#41-invite-the-bot-to-your-discord-server)). |
| `DISCORD_ERROR` | Discord did not answer normally. | Wait a moment and retry; check the integrations dot. |
| `TRELLO_BOARD_NO_ACCESS` | The Trello account Discrello uses is not a member of the board, so Trello refuses access. The message names the account. | In Trello: open the board → **Share** → invite that account, then click Fetch again. |
| `TRELLO_BOARD_NOT_FOUND` | There is no board at that URL or ID. | Open the board in Trello and copy the address from the browser (`https://trello.com/b/…`). |
| `TRELLO_KEY_INVALID` / `TRELLO_TOKEN_INVALID` | Trello rejected the API key or token in the server's `.env`. | Fix `TRELLO_API_KEY` / `TRELLO_API_TOKEN` (install guide, section 5) and restart Discrello. |

---

## 8. Checking what was sent

### 8.1 Notifications tab

**Notifications** lists every message, newest first, refreshed every 10 seconds. Filter by server, board or status. **View** shows the exact text, the channel, the Discord message ID and whether the mention was confirmed.

| Status | Meaning |
|---|---|
| `sent` | Posted, and Discord confirmed the person or role was mentioned. |
| `pending` / retrying | Waiting to be sent, or waiting for the next retry after a temporary error (Discord down, rate limit). Up to 5 attempts over about 13 minutes (after 5 s, 30 s, 2 min, 10 min). |
| `sent_no_mention` | Posted, **but Discord did not register the mention**, so nobody was pinged (for a team: the error names the members who were missed; the others were pinged). Usually the role stopped being mentionable or the person lost access to the channel. An alert is posted. |
| `failed` | Not posted. The **Error** column says why (for example the bot lost access to the channel, or the role has no target). An alert is posted. |

**Retry** re-builds the message from the **current** configuration and sends it again. Fix the cause first, then click Retry.

### 8.2 Webhook events tab

Every delivery from Trello, including the ones that did not produce a message. This answers "why did nothing fire?".

| Reason | Meaning |
|---|---|
| *(enqueued)* | A notification was created. |
| `no_mapping` | The destination list has no mapping. |
| `mapping_disabled` | The mapping exists but its **Enabled** switch is off. |
| `board_disabled` / `guild_disabled` | The board or the server is switched off. |
| `unsupported_action` | Neither a card move nor a comment (create, copy, rename, archive…). |
| `not_revision_comment` | A comment (or comment edit) that does not start with `comment:`. |
| `prefix_already_present` | An edit of a comment that already started with `comment:`; edits never ping again. |
| `comment_already_notified` | This comment already pinged once (e.g. the prefix was removed and added back). |
| `card_list_unknown` | A comment edit on a card Trello no longer knows (deleted), so its list could not be found. |
| `board_mismatch` | The delivery named a different board than expected; ignored for safety. |

**Duplicates:** Trello re-sends a delivery when it does not get an answer in time. Discrello recognises the repeat and never pings twice; the **duplicate** counter shows how many repeats were absorbed.

Deliveries without a valid Trello signature are rejected before they reach this log, so nobody can fake card moves by calling the webhook URL.

---

## 9. Alerts and health checks

- **Alert channel:** set per server (Servers → edit). Discrello posts there when a notification fails or is `sent_no_mention`, and when a configuration that used to work breaks.
- **Automatic re-check every 15 minutes:** every target and mapping is re-validated, because people change Discord permissions after the fact. Broken items get a red **Broken** badge on the Roles and board pages, with the reason. Run it on demand with **Settings → Re-check mentions**.
- **Trello webhook badge** on the board page:

| Badge | Meaning | Action |
|---|---|---|
| `webhook active` | Trello delivers to Discrello. | — |
| `inactive` | Trello paused the webhook after repeated failures. | **Check now** re-enables it. |
| `missing` | The webhook was deleted on Trello's side. | **Check now** or **Re-register** creates it again. |
| `mismatch` | The webhook points at an old address (e.g. the public URL changed). | **Re-register**; also fixed automatically at startup. |
| `error` / `unregistered` | Registration failed or never happened. | Read the error, fix it, then **Re-register**. |

The same repair runs automatically at startup and every 15 minutes (**Settings → Reconcile webhooks** runs it now).

---

## 10. Common tasks

| Task | How |
|---|---|
| Add another board | Boards → Add board, then map its lists. Roles and targets are reused. |
| Add a second Discord server | Invite the bot, Servers → Add server, then on Roles set a target for each role in the new server's tab. No redeploy. |
| Change who is pinged for a stage | Roles → the role → server tab → new user/role → Save target. Applies to every list mapped to that role in that server. |
| One list pings someone else | Board page → the list → Advanced → Mention override. |
| One list pings several people | Roles → **New team** with those people, then pick the team for the list on the board page ([4.6](#46-teams-ping-several-people-at-once-optional)). |
| Too many teams to scroll through | Roles → **New channel**, then move teams into it ([4.7](#47-channels-folders-of-teams-optional)). |
| Feedback on a QC list should go to the editor | Board page → the QC list → **Feedback message for revision comments** → **Feedback goes to** → the editor → Save. |
| Someone joins or leaves a team | Roles → the team → **Add a person** / **Remove**. Every list mapped to the team follows. |
| Change the channel | Board page → Discord destination → **Change** (default channel), or Advanced → Channel override for one list. |
| Pause notifications | Switch **Enabled** off on the list, the board, or the server. Events are still logged. |
| Lists were renamed or added on Trello | Board page → **Re-sync lists**. Mappings follow the list, not its name. |
| Stop using a board | Board page → **Remove board**. This also deletes its Trello webhook. |

---

## 11. Viewing the data in the database

All data lives in Supabase (Postgres), in a separate schema named **`discrello`**.

### 11.1 In the app (recommended)

The **Notifications** page shows what was sent, what failed and why, and every Trello delivery. For day-to-day questions this is enough.

### 11.2 Supabase Table Editor

1. Open the Supabase dashboard → your project → **Table Editor**
   (`https://supabase.com/dashboard/project/<project-ref>/editor`; for this deployment the project ref is `iarcopprffkscowpbfin`).
2. At the top of the table list, change the **schema** dropdown from `public` to **`discrello`**.
3. Click a table to browse it.

| Table | Contents |
|---|---|
| `notifications` | Every message: card, list, channel, text, status, attempts, error, Discord message ID. |
| `webhook_events` | Every Trello delivery and why it was ignored; duplicate counter. |
| `guilds` | Discord servers and their alert channel. |
| `roles` | Pipeline roles and their default message. |
| `role_targets` | Who is pinged for each role in each server. |
| `team_channels` | Channels: folders of teams. |
| `teams` / `team_members` | Teams, their channel, and which roles are in each. |
| `boards` | Trello boards, their channel and webhook status. |
| `trello_lists` | The lists of each board (cached from Trello). |
| `list_mappings` | List → role or team → message, plus overrides, feedback message and feedback recipient. |
| `settings` | The global default message. |

> **Read only, please.** Change configuration through the app. Editing rows directly skips the Discord checks in [section 7](#7-why-a-save-is-refused). If you must edit, run **Settings → Re-check mentions** afterwards.
>
> Do **not** add `discrello` to *Project Settings → API → Exposed schemas*; that would make the data readable with the public API key.

### 11.3 SQL Editor: ready-made queries

Supabase → **SQL Editor** → New query, paste, **Run**.

Last 20 notifications:

```sql
select id, created_at, status, attempts, board_name, list_name, card_name,
       mention_verified, last_error
from discrello.notifications
order by id desc
limit 20;
```

Problems in the last 7 days:

```sql
select status, count(*)
from discrello.notifications
where created_at > now() - interval '7 days'
group by status
order by 2 desc;
```

Why nothing fired:

```sql
select received_at, action_type, outcome, ignore_reason, list_name, duplicate_count
from discrello.webhook_events
order by id desc
limit 20;
```

Who is pinged for which list:

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

### 11.4 From a database client

psql, DBeaver, TablePlus or pgAdmin can connect with the same connection string as the app (`DATABASE_URL` in `.env`, Supabase **Session pooler**, port 5432, SSL required):

```
psql "$DATABASE_URL" -c "select status, count(*) from discrello.notifications group by 1"
```

---

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| A card moved but nothing arrived | Notifications → **Webhook events**. No event at all: the board's webhook badge is not active, or the server/public URL is down. An event with a reason: see [8.2](#82-webhook-events-tab). |
| The message arrived but nobody got a notification | Status `sent_no_mention`: see [8.1](#81-notifications-tab). If the status is `sent`, Discord did mention the person; their own Discord settings (muted server or channel) can still silence it, which Discrello cannot see. |
| A card created directly in a list did not ping | Expected: only moves are supported in this version. |
| Saving a target or mapping fails | Read the red box; see [section 7](#7-why-a-save-is-refused). |
| The integrations dot is red | Settings → Integrations shows which side fails (Trello token, Discord bot token, Members Intent). |
| The public URL changed (e.g. a new tunnel) | Update `PUBLIC_BASE_URL` and restart; webhooks are re-registered automatically. |
| Forgot the admin password | It is `ADMIN_PASSWORD` in the server's `.env`; change it there and restart. |

---

## 13. Data retention

Notifications are kept for **90 days** and webhook events for **30 days**; older rows are removed daily. Configuration (servers, roles, targets, boards, mappings, messages) is kept until you delete it.

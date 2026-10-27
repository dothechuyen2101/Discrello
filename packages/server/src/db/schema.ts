import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AllowedMentions, MentionTarget } from '@discrello/shared';

export const discrello = pgSchema('discrello');

export const mentionKindEnum = discrello.enum('mention_kind', ['user', 'role']);
export const checkStatusEnum = discrello.enum('check_status', ['ok', 'error', 'unchecked']);
export const botStatusEnum = discrello.enum('bot_status', [
  'ok',
  'not_in_guild',
  'missing_permissions',
  'unchecked',
]);
export const webhookStatusEnum = discrello.enum('webhook_status', [
  'unregistered',
  'active',
  'inactive',
  'missing',
  'mismatch',
  'error',
]);
export const notificationStatusEnum = discrello.enum('notification_status', [
  'pending',
  'sending',
  'sent',
  'sent_no_mention',
  'failed',
]);
export const webhookEventOutcomeEnum = discrello.enum('webhook_event_outcome', [
  'enqueued',
  'ignored',
]);

const idColumn = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const guilds = discrello.table('guilds', {
  id: idColumn(),
  discordGuildId: text('discord_guild_id').notNull().unique(),
  name: text('name').notNull(),
  alertChannelId: text('alert_channel_id'),
  botStatus: botStatusEnum('bot_status').notNull().default('unchecked'),
  botCheckError: text('bot_check_error'),
  botCheckedAt: ts('bot_checked_at'),
  enabled: boolean('enabled').notNull().default(true),
  ...timestamps,
});

export const roles = discrello.table('roles', {
  id: idColumn(),
  key: text('key').notNull().unique(),
  displayName: text('display_name').notNull(),
  defaultTemplate: text('default_template'),
  ...timestamps,
});

export const roleTargets = discrello.table(
  'role_targets',
  {
    id: idColumn(),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    guildId: bigint('guild_id', { mode: 'number' })
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    mentionKind: mentionKindEnum('mention_kind').notNull(),
    mentionId: text('mention_id').notNull(),
    checkStatus: checkStatusEnum('check_status').notNull().default('unchecked'),
    checkError: text('check_error'),
    checkedAt: ts('checked_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('role_targets_role_guild_uq').on(t.roleId, t.guildId)],
);

/**
 * A "channel" in the UI: a folder that groups teams so the Roles page and the list picker stay
 * short. Only for organising; it is not a Discord channel and is never pinged itself.
 */
export const teamChannels = discrello.table('team_channels', {
  id: idColumn(),
  name: text('name').notNull().unique(),
  ...timestamps,
});

/** A named group of roles (people). Mapping a list to a team pings every member at once. */
export const teams = discrello.table('teams', {
  id: idColumn(),
  name: text('name').notNull().unique(),
  /** The folder the team is shown in; null = "No channel". Deleting the folder keeps the team. */
  channelId: bigint('channel_id', { mode: 'number' }).references(() => teamChannels.id, {
    onDelete: 'set null',
  }),
  ...timestamps,
});

export const teamMembers = discrello.table(
  'team_members',
  {
    id: idColumn(),
    teamId: bigint('team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('team_members_team_role_uq').on(t.teamId, t.roleId),
    index('team_members_role_idx').on(t.roleId),
  ],
);

export const boards = discrello.table('boards', {
  id: idColumn(),
  trelloBoardId: text('trello_board_id').notNull().unique(),
  trelloShortLink: text('trello_short_link').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  closed: boolean('closed').notNull().default(false),
  guildId: bigint('guild_id', { mode: 'number' })
    .notNull()
    .references(() => guilds.id, { onDelete: 'restrict' }),
  discordChannelId: text('discord_channel_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  webhookToken: text('webhook_token').notNull().unique(),
  webhookId: text('webhook_id'),
  webhookCallbackUrl: text('webhook_callback_url'),
  webhookStatus: webhookStatusEnum('webhook_status').notNull().default('unregistered'),
  webhookConsecutiveFailures: integer('webhook_consecutive_failures').notNull().default(0),
  webhookLastCheckedAt: ts('webhook_last_checked_at'),
  webhookLastError: text('webhook_last_error'),
  lastEventAt: ts('last_event_at'),
  listsSyncedAt: ts('lists_synced_at'),
  ...timestamps,
});

export const trelloLists = discrello.table(
  'trello_lists',
  {
    id: idColumn(),
    boardId: bigint('board_id', { mode: 'number' })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    trelloListId: text('trello_list_id').notNull().unique(),
    name: text('name').notNull(),
    pos: doublePrecision('pos').notNull().default(0),
    closed: boolean('closed').notNull().default(false),
    missing: boolean('missing').notNull().default(false),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('trello_lists_board_idx').on(t.boardId)],
);

export const listMappings = discrello.table(
  'list_mappings',
  {
    id: idColumn(),
    boardId: bigint('board_id', { mode: 'number' })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    trelloListId: text('trello_list_id').notNull(),
    /** Exactly one of roleId / teamId is set (see the check below). */
    roleId: bigint('role_id', { mode: 'number' }).references(() => roles.id, {
      onDelete: 'restrict',
    }),
    teamId: bigint('team_id', { mode: 'number' }).references(() => teams.id, {
      onDelete: 'restrict',
    }),
    messageTemplate: text('message_template').notNull(),
    /** Message for revision comments on cards in this list; null = the global default. */
    commentTemplate: text('comment_template'),
    /**
     * Who revision comments on cards in this list ping. Both null = the list's own recipient
     * (and its mention override); at most one is set.
     */
    feedbackRoleId: bigint('feedback_role_id', { mode: 'number' }).references(() => roles.id, {
      onDelete: 'restrict',
    }),
    feedbackTeamId: bigint('feedback_team_id', { mode: 'number' }).references(() => teams.id, {
      onDelete: 'restrict',
    }),
    overrideMentionKind: mentionKindEnum('override_mention_kind'),
    overrideMentionId: text('override_mention_id'),
    overrideChannelId: text('override_channel_id'),
    checkStatus: checkStatusEnum('check_status').notNull().default('unchecked'),
    checkError: text('check_error'),
    checkedAt: ts('checked_at'),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('list_mappings_board_list_uq').on(t.boardId, t.trelloListId),
    index('list_mappings_team_idx').on(t.teamId),
    check('list_mappings_role_xor_team', sql`("role_id" IS NULL) <> ("team_id" IS NULL)`),
    check(
      'list_mappings_feedback_one_recipient',
      sql`"feedback_role_id" IS NULL OR "feedback_team_id" IS NULL`,
    ),
  ],
);

export const webhookEvents = discrello.table(
  'webhook_events',
  {
    id: idColumn(),
    trelloActionId: text('trello_action_id').notNull().unique(),
    boardId: bigint('board_id', { mode: 'number' }).references(() => boards.id, {
      onDelete: 'cascade',
    }),
    actionType: text('action_type').notNull(),
    cardId: text('card_id'),
    cardName: text('card_name'),
    listId: text('list_id'),
    listName: text('list_name'),
    outcome: webhookEventOutcomeEnum('outcome').notNull(),
    ignoreReason: text('ignore_reason'),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [index('webhook_events_board_received_idx').on(t.boardId, t.receivedAt)],
);

export const notifications = discrello.table(
  'notifications',
  {
    id: idColumn(),
    trelloActionId: text('trello_action_id').notNull().unique(),
    /** Revision comments only: the comment's id, so a comment pings at most once (edits included). */
    trelloCommentId: text('trello_comment_id').unique(),
    boardId: bigint('board_id', { mode: 'number' })
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    guildId: bigint('guild_id', { mode: 'number' })
      .notNull()
      .references(() => guilds.id, { onDelete: 'restrict' }),
    listMappingId: bigint('list_mapping_id', { mode: 'number' }).references(() => listMappings.id, {
      onDelete: 'set null',
    }),
    roleId: bigint('role_id', { mode: 'number' }).references(() => roles.id, {
      onDelete: 'set null',
    }),
    teamId: bigint('team_id', { mode: 'number' }).references(() => teams.id, {
      onDelete: 'set null',
    }),
    triggerType: text('trigger_type').notNull(),
    cardId: text('card_id').notNull(),
    cardName: text('card_name').notNull(),
    cardShortLink: text('card_short_link').notNull(),
    cardUrl: text('card_url').notNull(),
    listId: text('list_id').notNull(),
    listName: text('list_name').notNull(),
    previousListName: text('previous_list_name'),
    boardName: text('board_name').notNull(),
    actorName: text('actor_name'),
    discordChannelId: text('discord_channel_id'),
    /** Everyone the message pings (one target, or every member of a team). */
    mentionsJson: jsonb('mentions_json').$type<MentionTarget[]>().notNull().default([]),
    content: text('content'),
    allowedMentionsJson: jsonb('allowed_mentions_json').$type<AllowedMentions>(),
    status: notificationStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lastError: text('last_error'),
    discordMessageId: text('discord_message_id'),
    mentionVerified: boolean('mention_verified'),
    sentAt: ts('sent_at'),
    ...timestamps,
  },
  (t) => [
    index('notifications_status_next_idx').on(t.status, t.nextAttemptAt),
    index('notifications_guild_created_idx').on(t.guildId, t.createdAt),
    index('notifications_board_created_idx').on(t.boardId, t.createdAt),
  ],
);

export const settings = discrello.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type Guild = typeof guilds.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type RoleTarget = typeof roleTargets.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamChannel = typeof teamChannels.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type TrelloList = typeof trelloLists.$inferSelect;
export type ListMapping = typeof listMappings.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

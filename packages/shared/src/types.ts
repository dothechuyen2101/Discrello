/**
 * DTOs returned by the config API. The server maps DB rows to these; the web UI consumes them.
 */
import type { MentionKind, MentionTarget } from './mention';

export type CheckStatus = 'ok' | 'error' | 'unchecked';
export type BotStatus = 'ok' | 'not_in_guild' | 'missing_permissions' | 'unchecked';
export type WebhookStatus =
  'unregistered' | 'active' | 'inactive' | 'missing' | 'mismatch' | 'error';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'sent_no_mention' | 'failed';
export type WebhookEventOutcome = 'enqueued' | 'ignored';
export type IgnoreReason =
  | 'unsupported_action'
  | 'board_mismatch'
  | 'guild_disabled'
  | 'board_disabled'
  | 'no_mapping'
  | 'mapping_disabled'
  | 'not_revision_comment'
  | 'prefix_already_present'
  | 'comment_already_notified'
  | 'card_list_unknown';

export interface GuildDto {
  id: number;
  discordGuildId: string;
  name: string;
  alertChannelId: string | null;
  botStatus: BotStatus;
  botCheckError: string | null;
  botCheckedAt: string | null;
  enabled: boolean;
  boardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleTargetDto {
  guildId: number;
  discordGuildId: string;
  guildName: string;
  mentionKind: MentionKind;
  mentionId: string;
  checkStatus: CheckStatus;
  checkError: string | null;
  checkedAt: string | null;
}

export interface TeamRefDto {
  id: number;
  name: string;
}

export interface RoleDto {
  id: number;
  key: string;
  displayName: string;
  defaultTemplate: string | null;
  /** Lists mapped to this role directly (not through a team). */
  usageCount: number;
  targets: RoleTargetDto[];
  /** Teams this role is a member of. */
  teams: TeamRefDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberDto {
  roleId: number;
  key: string;
  displayName: string;
}

/** A named group of roles (people). A list mapped to a team pings every member at once. */
export interface TeamDto {
  id: number;
  name: string;
  /** The channel (folder) the team is shown in; null = "No channel". */
  channelId: number | null;
  members: TeamMemberDto[];
  /** Lists mapped to this team, or sending it their revision feedback. */
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A "channel": a folder of teams, to keep the Roles page and the list picker short. */
export interface TeamChannelDto {
  id: number;
  name: string;
  teamCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrelloListDto {
  trelloListId: string;
  name: string;
  pos: number;
  closed: boolean;
  missing: boolean;
}

export interface ListMappingDto {
  id: number;
  trelloListId: string;
  /** Exactly one of roleId / teamId is set. */
  roleId: number | null;
  roleKey: string | null;
  roleDisplayName: string | null;
  teamId: number | null;
  teamName: string | null;
  messageTemplate: string;
  /** Message for revision comments; null = the global default from Settings. */
  commentTemplate: string | null;
  /** Who revision comments ping; both null = the list's own recipient. */
  feedbackRoleId: number | null;
  feedbackRoleDisplayName: string | null;
  feedbackTeamId: number | null;
  feedbackTeamName: string | null;
  overrideMention: MentionTarget | null;
  overrideChannelId: string | null;
  checkStatus: CheckStatus;
  checkError: string | null;
  checkedAt: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface BoardSummaryDto {
  id: number;
  trelloBoardId: string;
  trelloShortLink: string;
  name: string;
  url: string;
  closed: boolean;
  guildId: number;
  guildName: string;
  discordChannelId: string;
  enabled: boolean;
  webhookStatus: WebhookStatus;
  webhookLastCheckedAt: string | null;
  webhookLastError: string | null;
  webhookConsecutiveFailures: number;
  lastEventAt: string | null;
  mappingCount: number;
  mappingErrorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDetailDto extends BoardSummaryDto {
  webhookCallbackUrl: string | null;
  listsSyncedAt: string | null;
  lists: TrelloListDto[];
  mappings: ListMappingDto[];
}

export interface BoardPreviewDto {
  trelloBoardId: string;
  trelloShortLink: string;
  name: string;
  url: string;
  closed: boolean;
  lists: TrelloListDto[];
  alreadyAdded: boolean;
}

export interface NotificationDto {
  id: number;
  trelloActionId: string;
  boardId: number;
  boardName: string;
  guildId: number;
  listMappingId: number | null;
  roleId: number | null;
  roleKey: string | null;
  teamId: number | null;
  teamName: string | null;
  triggerType: string;
  cardId: string;
  cardName: string;
  cardUrl: string;
  listId: string;
  listName: string;
  previousListName: string | null;
  actorName: string | null;
  discordChannelId: string | null;
  /** Everyone the message pings: one target, or every member of a team. */
  mentions: MentionTarget[];
  content: string | null;
  allowedMentions: unknown;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  discordMessageId: string | null;
  mentionVerified: boolean | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface WebhookEventDto {
  id: number;
  trelloActionId: string;
  boardId: number | null;
  boardName: string | null;
  actionType: string;
  cardId: string | null;
  cardName: string | null;
  listId: string | null;
  listName: string | null;
  outcome: WebhookEventOutcome;
  ignoreReason: IgnoreReason | null;
  duplicateCount: number;
  receivedAt: string;
}

export interface SettingsDto {
  defaultTemplate: string;
  defaultCommentTemplate: string;
}

export interface DiscordChannelDto {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

export interface DiscordRoleDto {
  id: string;
  name: string;
  mentionable: boolean;
  managed: boolean;
  color: number;
}

export interface BotGuildDto {
  id: string;
  name: string;
  alreadyAdded: boolean;
}

export interface IntegrationsHealthDto {
  trello: { ok: boolean; username?: string; error?: string };
  discord: {
    ok: boolean;
    botUsername?: string;
    botUserId?: string;
    membersIntentEnabled?: boolean;
    error?: string;
  };
  guildCount: number;
  publicBaseUrl: string;
  version: string;
}

/** Result of a real test send. */
export interface TestSendResultDto {
  ok: boolean;
  messageId?: string;
  mentionVerified?: boolean;
  content?: string;
  error?: string;
}

/** Body of every 422 returned by the mention validation. */
export interface ValidationErrorDto {
  error: 'validation_failed';
  code: string;
  message: string;
  hint: string;
}

export interface PageDto<T> {
  items: T[];
  nextBefore: number | null;
}

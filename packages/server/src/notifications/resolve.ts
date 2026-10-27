import {
  allowedMentionsFor,
  formatMentions,
  renderTemplate,
  type AllowedMentions,
  type IgnoreReason,
  type MentionTarget,
  type TemplateVars,
} from '@discrello/shared';
import type { CardCommented, CardMoved } from '../trello/normalize';

export interface ResolveBoard {
  id: number;
  enabled: boolean;
  discordChannelId: string;
  name: string;
}
export interface ResolveGuild {
  id: number;
  enabled: boolean;
}
export interface ResolveMapping {
  id: number;
  enabled: boolean;
  /** Exactly one of roleId / teamId is set. */
  roleId: number | null;
  teamId: number | null;
  messageTemplate: string;
  /** Revision comments; null/absent = the global default comment template. */
  commentTemplate?: string | null;
  /** Who revision comments ping; both null/absent = the list's own recipient (and override). */
  feedbackRoleId?: number | null;
  feedbackTeamId?: number | null;
  overrideMentionKind: 'user' | 'role' | null;
  overrideMentionId: string | null;
  overrideChannelId: string | null;
}
/** Who the mapping pings, already looked up in the board's guild. */
export interface ResolveRecipient {
  /** "Role Editor (editor)" or "Team Sports", for the error stored when nobody can be pinged. */
  label: string;
  /** The role's target, or the targets of every team member that has one in this guild. */
  targets: MentionTarget[];
}

export interface ResolveInput {
  event: CardMoved;
  board: ResolveBoard;
  guild: ResolveGuild;
  mapping: ResolveMapping | null;
  recipient: ResolveRecipient | null;
}

export interface ResolveCommentInput extends Omit<ResolveInput, 'event'> {
  event: CardCommented;
  /** The list the card is in (from the payload or looked up on Trello). */
  list: { id: string; name: string };
  /** The comment text without the revision prefix. */
  feedback: string;
  /** Settings → default comment template, used when the mapping has none. */
  defaultCommentTemplate: string;
  /** The mapping's feedback recipient, looked up in the board's guild (when it has one). */
  feedbackRecipient?: ResolveRecipient | null;
}

/** Who a message pings, and how to name them when nobody can be pinged. */
interface Audience {
  mentions: MentionTarget[];
  label: string;
}

/** Longer feedback is cut so the rest of the message still fits in one Discord message. */
export const COMMENT_TEXT_LIMIT = 1000;

export type ResolveResult =
  | { kind: 'ignore'; reason: IgnoreReason }
  | {
      kind: 'notify';
      channelId: string;
      /** Everyone pinged; empty when nobody could be resolved. */
      mentions: MentionTarget[];
      /** Set when no mention target could be resolved; the notification is stored as failed. */
      missingTargetError: string | null;
      template: string;
      vars: TemplateVars;
      content: string;
      allowedMentions: AllowedMentions;
    };

export function buildTemplateVars(event: CardMoved, mentions: MentionTarget[]): TemplateVars {
  return {
    mention: formatMentions(mentions),
    card_title: event.card.name,
    card_url: event.card.url,
    list_name: event.list.name,
    previous_list_name: event.previousList?.name ?? '',
    board_name: event.board.name,
    moved_by: event.actor?.fullName ?? '',
  };
}

export function buildCommentVars(
  input: Pick<ResolveCommentInput, 'event' | 'list' | 'feedback'>,
  mentions: MentionTarget[],
): TemplateVars {
  const { event, list, feedback } = input;
  return {
    mention: formatMentions(mentions),
    card_title: event.card.name,
    card_url: event.card.url,
    list_name: list.name,
    board_name: event.board.name,
    commented_by: event.actor?.fullName ?? '',
    comment_text:
      feedback.length > COMMENT_TEXT_LIMIT
        ? `${feedback.slice(0, COMMENT_TEXT_LIMIT - 1)}…`
        : feedback,
  };
}

/**
 * The part shared by moves and comments: is the mapping live, who is pinged, in which channel.
 * The caller picks the mapping's template and builds the variables. Pure: all data is passed in.
 */
function resolveDelivery(
  input: Omit<ResolveInput, 'event'>,
  templateOf: (mapping: ResolveMapping) => string,
  varsFor: (mentions: MentionTarget[]) => TemplateVars,
  audienceOf: (mapping: ResolveMapping) => Audience,
): ResolveResult {
  const { board, guild, mapping } = input;
  if (!guild.enabled) return { kind: 'ignore', reason: 'guild_disabled' };
  if (!board.enabled) return { kind: 'ignore', reason: 'board_disabled' };
  if (!mapping) return { kind: 'ignore', reason: 'no_mapping' };
  if (!mapping.enabled) return { kind: 'ignore', reason: 'mapping_disabled' };

  const { mentions, label } = audienceOf(mapping);
  const channelId = mapping.overrideChannelId ?? board.discordChannelId;
  const template = templateOf(mapping);
  const vars = varsFor(mentions);
  const content = renderTemplate(template, vars);

  return {
    kind: 'notify',
    channelId,
    mentions,
    missingTargetError: mentions.length
      ? null
      : `${label} has no Discord mention target configured for this server`,
    template,
    vars,
    content,
    allowedMentions: allowedMentionsFor(mentions),
  };
}

/** The list's own audience: its mention override, else its role's target or every team member's. */
function listAudience(mapping: ResolveMapping, recipient: ResolveRecipient | null): Audience {
  if (mapping.overrideMentionKind && mapping.overrideMentionId) {
    return {
      mentions: [{ kind: mapping.overrideMentionKind, id: mapping.overrideMentionId }],
      label: 'Mention override',
    };
  }
  return {
    mentions: recipient?.targets ?? [],
    label:
      recipient?.label ?? (mapping.teamId ? `Team #${mapping.teamId}` : `Role #${mapping.roleId}`),
  };
}

/** Decides whether a CardMoved event produces a notification, where it goes and what it says. */
export function resolve(input: ResolveInput): ResolveResult {
  return resolveDelivery(
    input,
    (mapping) => mapping.messageTemplate,
    (mentions) => buildTemplateVars(input.event, mentions),
    (mapping) => listAudience(mapping, input.recipient),
  );
}

/**
 * Same for a revision comment, in the stage's channel with the mapping's comment template (or the
 * global default). It pings the list's feedback recipient when one is chosen (e.g. the editor, for
 * a QC list), otherwise the list's own audience.
 */
export function resolveComment(input: ResolveCommentInput): ResolveResult {
  return resolveDelivery(
    input,
    (mapping) => mapping.commentTemplate ?? input.defaultCommentTemplate,
    (mentions) => buildCommentVars(input, mentions),
    (mapping) => {
      if (!mapping.feedbackRoleId && !mapping.feedbackTeamId) {
        return listAudience(mapping, input.recipient);
      }
      const fallback = mapping.feedbackTeamId
        ? `Team #${mapping.feedbackTeamId}`
        : `Role #${mapping.feedbackRoleId}`;
      return {
        mentions: input.feedbackRecipient?.targets ?? [],
        label: `Feedback recipient ${input.feedbackRecipient?.label ?? fallback}`,
      };
    },
  );
}

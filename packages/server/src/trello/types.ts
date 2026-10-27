/** Loose typings for the parts of Trello's API and webhook payloads that we read. */

export interface TrelloEntityRef {
  id: string;
  name?: string;
  shortLink?: string;
}

export interface TrelloActionCard extends TrelloEntityRef {
  idShort?: number;
  idList?: string;
  closed?: boolean;
}

export interface TrelloActionData {
  board?: TrelloEntityRef;
  boardSource?: TrelloEntityRef;
  boardTarget?: TrelloEntityRef;
  card?: TrelloActionCard;
  cardSource?: TrelloActionCard;
  list?: TrelloEntityRef;
  listAfter?: TrelloEntityRef;
  listBefore?: TrelloEntityRef;
  old?: Record<string, unknown>;
  /** commentCard: the comment text. */
  text?: string;
  /** updateComment: the edited comment (its original commentCard action id and the new text). */
  action?: { id?: string; text?: string };
}

export interface TrelloMemberRef {
  id: string;
  username?: string;
  fullName?: string;
}

export interface TrelloAction {
  id: string;
  type: string;
  date?: string;
  idMemberCreator?: string;
  memberCreator?: TrelloMemberRef;
  data: TrelloActionData;
}

export interface TrelloWebhookPayload {
  action: TrelloAction;
  model?: unknown;
  webhook?: unknown;
}

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
  shortLink: string;
  closed: boolean;
}

export interface TrelloList {
  id: string;
  name: string;
  pos: number;
  closed: boolean;
}

export interface TrelloWebhook {
  id: string;
  idModel: string;
  callbackURL: string;
  active: boolean;
  description?: string;
  consecutiveFailures?: number;
  firstConsecutiveFailDate?: string | null;
}

export interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
}

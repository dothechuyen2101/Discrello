import type {
  TrelloAction,
  TrelloActionCard,
  TrelloEntityRef,
  TrelloWebhookPayload,
} from './types';

type CardRef = { id: string; name: string; shortLink: string; url: string };
type ActorRef = { id: string; username: string; fullName: string };

/** A card that entered a list by being moved there. */
export interface CardMoved {
  actionId: string;
  actionType: string;
  occurredAt: string | null;
  board: { id: string; name: string };
  list: { id: string; name: string };
  previousList: { id: string; name: string } | null;
  card: CardRef;
  actor: ActorRef | null;
}

/** A comment posted on a card (`commentCard`) or an edit of one (`updateComment`). */
export interface CardCommented {
  actionId: string;
  actionType: string;
  occurredAt: string | null;
  /** The comment's own id: the `commentCard` action id, also when this is a later edit of it. */
  commentId: string;
  text: string;
  /** Edits only: the text before the edit, when Trello sends it. */
  previousText: string | null;
  board: { id: string; name: string };
  /** The card's list when the payload names it (new comments do, edits usually do not). */
  list: { id: string; name: string } | null;
  card: CardRef;
  actor: ActorRef | null;
}

export type NormalizeResult =
  | { kind: 'moved'; event: CardMoved }
  | { kind: 'commented'; event: CardCommented }
  | { kind: 'ignored'; reason: 'unsupported_action' | 'malformed'; action: TrelloAction | null };

const MOVE_WITHIN_BOARD = 'updateCard';
const MOVE_FROM_OTHER_BOARD = 'moveCardToBoard';
const NEW_COMMENT = 'commentCard';
const EDITED_COMMENT = 'updateComment';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asAction(payload: unknown): TrelloAction | null {
  if (!isRecord(payload) || !isRecord(payload['action'])) return null;
  const a = payload['action'];
  if (typeof a['id'] !== 'string' || typeof a['type'] !== 'string' || !isRecord(a['data'])) {
    return null;
  }
  return a as unknown as TrelloAction;
}

function ref(v: TrelloEntityRef | undefined): { id: string; name: string } | null {
  if (!v || typeof v.id !== 'string') return null;
  return { id: v.id, name: typeof v.name === 'string' ? v.name : '' };
}

function cardRef(card: TrelloActionCard): CardRef {
  const shortLink = typeof card.shortLink === 'string' && card.shortLink ? card.shortLink : card.id;
  return {
    id: card.id,
    name: typeof card.name === 'string' ? card.name : '(untitled card)',
    shortLink,
    url: `https://trello.com/c/${shortLink}`,
  };
}

function actorOf(action: TrelloAction): ActorRef | null {
  return action.memberCreator
    ? {
        id: action.memberCreator.id,
        username: action.memberCreator.username ?? '',
        fullName: action.memberCreator.fullName ?? action.memberCreator.username ?? '',
      }
    : null;
}

/**
 * `commentCard` carries the text in `data.text`. `updateComment` carries the edited comment in
 * `data.action` ({ id, text }) and the previous text in `data.old.text`; when the comment id is
 * missing the edit's own action id is used, which only weakens the once-per-comment guarantee.
 */
function normalizeComment(action: TrelloAction): NormalizeResult {
  const { data } = action;
  const card = data.card;
  const board = ref(data.board);
  if (!card || typeof card.id !== 'string' || !board) {
    return { kind: 'ignored', reason: 'malformed', action };
  }

  let commentId: string;
  let text: unknown;
  let previousText: string | null = null;
  if (action.type === NEW_COMMENT) {
    commentId = action.id;
    text = data.text;
  } else {
    commentId = typeof data.action?.id === 'string' ? data.action.id : action.id;
    text = data.action?.text ?? data.text;
    const old = data.old?.['text'];
    previousText = typeof old === 'string' ? old : null;
  }
  if (typeof text !== 'string') return { kind: 'ignored', reason: 'malformed', action };

  return {
    kind: 'commented',
    event: {
      actionId: action.id,
      actionType: action.type,
      occurredAt: typeof action.date === 'string' ? action.date : null,
      commentId,
      text,
      previousText,
      board,
      list: ref(data.list),
      card: cardRef(card),
      actor: actorOf(action),
    },
  };
}

/**
 * Turns a raw webhook payload into a `CardMoved` or `CardCommented` event, or explains why it is
 * ignored. Supported: `updateCard` with `listAfter` (drag between lists), `moveCardToBoard`,
 * `commentCard` and `updateComment`. Everything else (create/copy/convert/rename/archive/…) is
 * `unsupported_action`. Whether a comment is a revision request is decided later, in ingest.
 */
export function normalizeAction(payload: TrelloWebhookPayload | unknown): NormalizeResult {
  const action = asAction(payload);
  if (!action) return { kind: 'ignored', reason: 'malformed', action: null };
  if (action.type === NEW_COMMENT || action.type === EDITED_COMMENT) {
    return normalizeComment(action);
  }

  const { data } = action;
  const card = data.card;
  const board = ref(data.board);

  let list: { id: string; name: string } | null = null;
  let previousList: { id: string; name: string } | null = null;

  if (action.type === MOVE_WITHIN_BOARD) {
    list = ref(data.listAfter);
    previousList = ref(data.listBefore);
    if (!list) return { kind: 'ignored', reason: 'unsupported_action', action };
  } else if (action.type === MOVE_FROM_OTHER_BOARD) {
    list = ref(data.list);
    if (!list) return { kind: 'ignored', reason: 'unsupported_action', action };
  } else {
    return { kind: 'ignored', reason: 'unsupported_action', action };
  }

  if (!card || typeof card.id !== 'string' || !board) {
    return { kind: 'ignored', reason: 'malformed', action };
  }

  return {
    kind: 'moved',
    event: {
      actionId: action.id,
      actionType: action.type,
      occurredAt: typeof action.date === 'string' ? action.date : null,
      board,
      list,
      previousList,
      card: cardRef(card),
      actor: actorOf(action),
    },
  };
}

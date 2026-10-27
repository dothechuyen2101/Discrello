import { TrelloApiError, type CreateWebhookInput, type TrelloApi } from './client';
import type {
  TrelloBoard,
  TrelloEntityRef,
  TrelloList,
  TrelloMember,
  TrelloWebhook,
} from './types';

/** In-memory Trello for tests: boards with lists, and webhooks that can be flipped inactive/deleted. */
export class FakeTrelloClient implements TrelloApi {
  readonly boards = new Map<string, TrelloBoard & { lists: TrelloList[] }>();
  readonly webhooks = new Map<string, TrelloWebhook>();
  /** Card id → the list it is in, for getCardList. */
  readonly cardLists = new Map<string, TrelloEntityRef>();
  me: TrelloMember = { id: '5a1b2c3d4e5f60718293a4b5', username: 'jane', fullName: 'Jane Doe' };
  private seq = 1;
  readonly calls: string[] = [];

  addBoard(board: TrelloBoard, lists: TrelloList[]): void {
    this.boards.set(board.id, { ...board, lists });
  }

  private findBoard(idOrShortLink: string) {
    for (const b of this.boards.values()) {
      if (b.id === idOrShortLink || b.shortLink === idOrShortLink) return b;
    }
    return null;
  }

  async getMe(): Promise<TrelloMember> {
    this.calls.push('getMe');
    return this.me;
  }

  /** Boards that exist but whose members do not include the token's account (Trello answers 401). */
  readonly privateBoards = new Set<string>();

  async getBoard(idOrShortLink: string): Promise<TrelloBoard> {
    this.calls.push(`getBoard:${idOrShortLink}`);
    if (this.privateBoards.has(idOrShortLink)) {
      throw new TrelloApiError(
        401,
        'unauthorized permission requested',
        'Fetching the Trello board',
      );
    }
    const b = this.findBoard(idOrShortLink);
    if (!b) throw new TrelloApiError(404, 'board not found', 'Fetching the Trello board');
    const { lists: _lists, ...board } = b;
    return board;
  }

  async getLists(boardId: string): Promise<TrelloList[]> {
    this.calls.push(`getLists:${boardId}`);
    const b = this.findBoard(boardId);
    if (!b) throw new TrelloApiError(404, 'board not found', 'Fetching the board lists');
    return b.lists.map((l) => ({ ...l }));
  }

  async getCardList(cardId: string): Promise<TrelloEntityRef | null> {
    this.calls.push(`getCardList:${cardId}`);
    const list = this.cardLists.get(cardId);
    return list ? { ...list } : null;
  }

  async createWebhook(input: CreateWebhookInput): Promise<TrelloWebhook> {
    this.calls.push(`createWebhook:${input.idModel}`);
    const wh: TrelloWebhook = {
      id: `wh${this.seq++}`,
      idModel: input.idModel,
      callbackURL: input.callbackURL,
      active: true,
      description: input.description,
      consecutiveFailures: 0,
    };
    this.webhooks.set(wh.id, wh);
    return wh;
  }

  async getWebhook(id: string): Promise<TrelloWebhook | null> {
    this.calls.push(`getWebhook:${id}`);
    return this.webhooks.get(id) ?? null;
  }

  async updateWebhook(
    id: string,
    patch: { active?: boolean; callbackURL?: string },
  ): Promise<TrelloWebhook> {
    this.calls.push(`updateWebhook:${id}`);
    const wh = this.webhooks.get(id);
    if (!wh) throw new TrelloApiError(404, 'webhook not found', 'Updating the Trello webhook');
    Object.assign(wh, patch);
    if (patch.active) wh.consecutiveFailures = 0;
    return wh;
  }

  async deleteWebhook(id: string): Promise<void> {
    this.calls.push(`deleteWebhook:${id}`);
    this.webhooks.delete(id);
  }

  async listTokenWebhooks(): Promise<TrelloWebhook[]> {
    this.calls.push('listTokenWebhooks');
    return [...this.webhooks.values()];
  }
}

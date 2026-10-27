import type {
  TrelloBoard,
  TrelloEntityRef,
  TrelloList,
  TrelloMember,
  TrelloWebhook,
} from './types';

export class TrelloApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    context: string,
  ) {
    super(`${context}: Trello responded ${status}${body ? ` – ${body.slice(0, 200)}` : ''}`);
    this.name = 'TrelloApiError';
  }
}

export interface CreateWebhookInput {
  callbackURL: string;
  idModel: string;
  description: string;
}

/** The subset of Trello's REST API we use. Implemented by TrelloClient and a fake for tests. */
export interface TrelloApi {
  getMe(): Promise<TrelloMember>;
  getBoard(idOrShortLink: string): Promise<TrelloBoard>;
  getLists(boardId: string): Promise<TrelloList[]>;
  /** The list a card is in now. Resolves to null when Trello no longer knows the card (404). */
  getCardList(cardId: string): Promise<TrelloEntityRef | null>;
  createWebhook(input: CreateWebhookInput): Promise<TrelloWebhook>;
  /** Resolves to null when Trello no longer knows the webhook (404). */
  getWebhook(id: string): Promise<TrelloWebhook | null>;
  updateWebhook(
    id: string,
    patch: { active?: boolean; callbackURL?: string },
  ): Promise<TrelloWebhook>;
  /** Idempotent: a 404 is treated as success. */
  deleteWebhook(id: string): Promise<void>;
  listTokenWebhooks(): Promise<TrelloWebhook[]>;
}

type FetchLike = typeof fetch;

export class TrelloClient implements TrelloApi {
  constructor(
    private readonly key: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://api.trello.com/1',
  ) {}

  private url(path: string, query: Record<string, string> = {}): string {
    const u = new URL(`${this.baseUrl}${path}`);
    u.searchParams.set('key', this.key);
    u.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    context: string,
    opts: { query?: Record<string, string>; body?: unknown; allow404?: boolean } = {},
  ): Promise<T | null> {
    const res = await this.fetchImpl(this.url(path, opts.query), {
      method,
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      throw new TrelloApiError(res.status, await res.text().catch(() => ''), context);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  async getMe(): Promise<TrelloMember> {
    const me = await this.request<TrelloMember>('GET', '/members/me', 'Fetching the Trello user', {
      query: { fields: 'id,username,fullName' },
    });
    return me!;
  }

  async getBoard(idOrShortLink: string): Promise<TrelloBoard> {
    const board = await this.request<TrelloBoard>(
      'GET',
      `/boards/${encodeURIComponent(idOrShortLink)}`,
      'Fetching the Trello board',
      { query: { fields: 'id,name,url,shortLink,closed' } },
    );
    return board!;
  }

  async getLists(boardId: string): Promise<TrelloList[]> {
    const lists = await this.request<TrelloList[]>(
      'GET',
      `/boards/${encodeURIComponent(boardId)}/lists`,
      'Fetching the board lists',
      { query: { filter: 'all', fields: 'id,name,pos,closed' } },
    );
    return lists ?? [];
  }

  getCardList(cardId: string): Promise<TrelloEntityRef | null> {
    return this.request<TrelloEntityRef>(
      'GET',
      `/cards/${encodeURIComponent(cardId)}/list`,
      "Fetching the card's list",
      { query: { fields: 'id,name' }, allow404: true },
    );
  }

  async createWebhook(input: CreateWebhookInput): Promise<TrelloWebhook> {
    const wh = await this.request<TrelloWebhook>(
      'POST',
      '/webhooks',
      'Registering the Trello webhook',
      {
        body: input,
      },
    );
    return wh!;
  }

  getWebhook(id: string): Promise<TrelloWebhook | null> {
    return this.request<TrelloWebhook>(
      'GET',
      `/webhooks/${encodeURIComponent(id)}`,
      'Checking the Trello webhook',
      { allow404: true },
    );
  }

  async updateWebhook(
    id: string,
    patch: { active?: boolean; callbackURL?: string },
  ): Promise<TrelloWebhook> {
    const wh = await this.request<TrelloWebhook>(
      'PUT',
      `/webhooks/${encodeURIComponent(id)}`,
      'Updating the Trello webhook',
      { body: patch },
    );
    return wh!;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(
      'DELETE',
      `/webhooks/${encodeURIComponent(id)}`,
      'Deleting the Trello webhook',
      {
        allow404: true,
      },
    );
  }

  async listTokenWebhooks(): Promise<TrelloWebhook[]> {
    const list = await this.request<TrelloWebhook[]>(
      'GET',
      `/tokens/${encodeURIComponent(this.token)}/webhooks`,
      'Listing the Trello webhooks',
    );
    return list ?? [];
  }
}

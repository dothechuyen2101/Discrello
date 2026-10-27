/** Thin fetch wrapper for the config API. Throws ApiError; a 401 redirects to /login via an event. */

export const UNAUTHORIZED_EVENT = 'discrello:unauthorized';

export interface ValidationIssue {
  path: string;
  message: string;
}

function messageFrom(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (typeof b['message'] === 'string') return b['message'];
    if (typeof b['error'] === 'string') return b['error'];
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 200);
  return `HTTP ${status}`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(messageFrom(status, body));
    this.name = 'ApiError';
  }

  private field(name: string): unknown {
    return this.body && typeof this.body === 'object'
      ? (this.body as Record<string, unknown>)[name]
      : undefined;
  }

  /** The 422 shape from the mention validation: { code, message, hint }. */
  get isValidationFailed(): boolean {
    return this.status === 422 && this.field('error') === 'validation_failed';
  }

  get code(): string | undefined {
    const c = this.field('code');
    return typeof c === 'string' ? c : undefined;
  }

  get hint(): string | undefined {
    const h = this.field('hint');
    return typeof h === 'string' ? h : undefined;
  }

  /** The 400 shape from zod: { issues: [{ path, message }] }. */
  get issues(): ValidationIssue[] | undefined {
    const i = this.field('issues');
    return Array.isArray(i) ? (i as ValidationIssue[]) : undefined;
  }

  static is(err: unknown): err is ApiError {
    return err instanceof ApiError;
  }
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiFetchOptions {
  /** The login call must not bounce to /login on 401. */
  skipAuthRedirect?: boolean;
}

export async function apiFetch<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers:
      body !== undefined
        ? { 'content-type': 'application/json', accept: 'application/json' }
        : { accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.skipAuthRedirect) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, parsed);
  }
  return parsed as T;
}

/** Builds a query string, skipping undefined/empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

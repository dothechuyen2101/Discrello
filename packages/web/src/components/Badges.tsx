import type { BotStatus, CheckStatus, NotificationDto, WebhookStatus } from '@discrello/shared';
import { formatDateTime } from '../lib/format';
import { Badge, type Tone } from './ui';

export function CheckStatusBadge({
  status,
  error,
  inline,
}: {
  status: CheckStatus;
  error?: string | null;
  inline?: boolean;
}) {
  const tone: Tone = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'grey';
  const label = status === 'ok' ? 'OK' : status === 'error' ? 'Broken' : 'Unchecked';
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Badge tone={tone} title={error ?? undefined}>
        {label}
      </Badge>
      {inline && status === 'error' && error && (
        <span className="max-w-md text-xs text-red-700">{error}</span>
      )}
    </span>
  );
}

const webhookTone: Record<WebhookStatus, Tone> = {
  active: 'green',
  inactive: 'red',
  missing: 'red',
  mismatch: 'red',
  error: 'red',
  unregistered: 'grey',
};

export function WebhookStatusBadge({
  status,
  lastError,
  lastCheckedAt,
  consecutiveFailures,
}: {
  status: WebhookStatus;
  lastError: string | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
}) {
  const parts = [
    `Last checked: ${formatDateTime(lastCheckedAt)}`,
    `Consecutive failures reported by Trello: ${consecutiveFailures}`,
    lastError ? `Error: ${lastError}` : null,
  ].filter(Boolean);
  return (
    <Badge tone={webhookTone[status]} title={parts.join('\n')}>
      webhook {status}
    </Badge>
  );
}

const botTone: Record<BotStatus, Tone> = {
  ok: 'green',
  not_in_guild: 'red',
  missing_permissions: 'red',
  unchecked: 'grey',
};
const botLabel: Record<BotStatus, string> = {
  ok: 'bot OK',
  not_in_guild: 'bot not in server',
  missing_permissions: 'bot missing permissions',
  unchecked: 'unchecked',
};

export function BotStatusBadge({ status, error }: { status: BotStatus; error: string | null }) {
  return (
    <Badge tone={botTone[status]} title={error ?? undefined}>
      {botLabel[status]}
    </Badge>
  );
}

export function NotificationStatusBadge({
  n,
}: {
  n: Pick<NotificationDto, 'status' | 'attempts' | 'lastError'>;
}) {
  switch (n.status) {
    case 'sent':
      return <Badge tone="green">sent</Badge>;
    case 'pending':
    case 'sending':
      return (
        <Badge tone="blue" title={n.lastError ?? undefined}>
          {n.attempts > 0 ? `retrying ${n.attempts}/5` : n.status}
        </Badge>
      );
    case 'sent_no_mention':
      return (
        <Badge tone="red" title={n.lastError ?? undefined}>
          sent, no ping
        </Badge>
      );
    case 'failed':
      return (
        <Badge tone="red" title={n.lastError ?? undefined}>
          failed
        </Badge>
      );
  }
}

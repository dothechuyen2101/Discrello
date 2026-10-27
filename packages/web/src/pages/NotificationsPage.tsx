import { useState } from 'react';
import type { NotificationDto, NotificationStatus } from '@discrello/shared';
import {
  useBoards,
  useGuilds,
  useNotifications,
  useRetryNotification,
  useWebhookEvents,
} from '../api/hooks';
import { NotificationStatusBadge } from '../components/Badges';
import { ErrorBanner } from '../components/ErrorBanner';
import { RelativeTime } from '../components/RelativeTime';
import { Button, Card, EmptyState, PageHeader, Select, Spinner } from '../components/ui';
import { formatDateTime, truncate } from '../lib/format';

const STATUSES: NotificationStatus[] = ['pending', 'sending', 'sent', 'sent_no_mention', 'failed'];

/** Feedback pings come from a new comment or from the edit that added the prefix. */
const isRevisionComment = (n: NotificationDto) =>
  n.triggerType === 'commentCard' || n.triggerType === 'updateComment';

/** Who the list pinged: a team name or a role key. */
const recipientOf = (n: NotificationDto) =>
  n.teamId ? `team ${n.teamName ?? `#${n.teamId}`}` : (n.roleKey ?? '—');

function NotificationDrawer({ n, onClose }: { n: NotificationDto; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{n.cardName}</h3>
            <p className="text-xs text-gray-500">
              {n.boardName} · {n.listName} · <NotificationStatusBadge n={n} />
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Card">
            <a
              href={n.cardUrl}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-700 hover:underline"
            >
              {n.cardUrl}
            </a>
          </Row>
          <Row label="Trigger">
            {n.triggerType}
            {n.previousListName ? ` (from "${n.previousListName}")` : ''}
            {n.actorName ? ` by ${n.actorName}` : ''}
          </Row>
          <Row label="Role / team">{recipientOf(n)}</Row>
          <Row label="Channel">
            <span className="font-mono text-xs">{n.discordChannelId ?? '—'}</span>
          </Row>
          <Row label={n.mentions.length > 1 ? 'Mentions' : 'Mention'}>
            {n.mentions.length
              ? n.mentions.map((m) => (
                  <div key={`${m.kind}:${m.id}`} className="font-mono text-xs">
                    {m.kind} {m.id}
                  </div>
                ))
              : 'none'}
          </Row>
          <Row label="Content">
            <pre className="rounded bg-gray-100 p-2 text-xs break-words whitespace-pre-wrap">
              {n.content ?? '—'}
            </pre>
          </Row>
          <Row label="allowed_mentions">
            <pre className="rounded bg-gray-100 p-2 text-xs">
              {JSON.stringify(n.allowedMentions, null, 2)}
            </pre>
          </Row>
          <Row label="Attempts">
            {n.attempts} · next attempt {formatDateTime(n.nextAttemptAt)}
          </Row>
          <Row label="Discord message">{n.discordMessageId ?? '—'}</Row>
          <Row label="Mention verified">
            {n.mentionVerified === null
              ? 'not checked'
              : n.mentionVerified
                ? 'yes'
                : 'NO — nobody was pinged'}
          </Row>
          <Row label="Error">
            {n.lastError ? <span className="text-red-700">{n.lastError}</span> : '—'}
          </Row>
          <Row label="Timestamps">
            created {formatDateTime(n.createdAt)} · sent {formatDateTime(n.sentAt)}
          </Row>
          <Row label="Trello action">
            <span className="font-mono text-xs">{n.trelloActionId}</span>
          </Row>
        </dl>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function NotificationsTab() {
  const guilds = useGuilds();
  const boards = useBoards();
  const [guildId, setGuildId] = useState<number | undefined>();
  const [boardId, setBoardId] = useState<number | undefined>();
  const [status, setStatus] = useState<NotificationStatus | undefined>();
  const q = useNotifications({ guildId, boardId, status });
  const retry = useRetryNotification();
  const [open, setOpen] = useState<NotificationDto | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select
          className="w-auto"
          value={guildId ?? ''}
          onChange={(e) => setGuildId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">All servers</option>
          {(guilds.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          value={boardId ?? ''}
          onChange={(e) => setBoardId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">All boards</option>
          {(boards.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          value={status ?? ''}
          onChange={(e) =>
            setStatus((e.target.value || undefined) as NotificationStatus | undefined)
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <span className="self-center text-xs text-gray-400">auto-refreshes every 10s</span>
      </div>
      <ErrorBanner error={q.error ?? retry.error} onDismiss={() => retry.reset()} />
      {q.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>No notifications yet. Move a card into a mapped list on Trello.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Board / list</th>
                <th>Card</th>
                <th>Role / team</th>
                <th>Status</th>
                <th>Error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr
                  key={n.id}
                  className={
                    n.status === 'failed' || n.status === 'sent_no_mention' ? 'bg-red-50/40' : ''
                  }
                >
                  <td>
                    <RelativeTime iso={n.createdAt} />
                  </td>
                  <td>
                    <div>{n.boardName}</div>
                    <div className="text-xs text-gray-500">{n.listName}</div>
                  </td>
                  <td>
                    <a
                      href={n.cardUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-700 hover:underline"
                    >
                      {truncate(n.cardName, 60)}
                    </a>
                    {isRevisionComment(n) && (
                      <div className="text-xs text-gray-500">revision comment</div>
                    )}
                  </td>
                  <td className="text-xs">{recipientOf(n)}</td>
                  <td>
                    <NotificationStatusBadge n={n} />
                    <div className="text-xs text-gray-400">
                      {n.attempts} attempt{n.attempts === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td
                    className="max-w-[240px] text-xs text-red-700"
                    title={n.lastError ?? undefined}
                  >
                    {truncate(n.lastError, 80)}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => setOpen(n)}>
                        View
                      </Button>
                      <Button
                        size="sm"
                        busy={retry.isPending && retry.variables === n.id}
                        disabled={n.status === 'pending' || n.status === 'sending'}
                        onClick={() => retry.mutate(n.id)}
                      >
                        Retry
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <Button busy={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Load more
        </Button>
      )}
      {open && <NotificationDrawer n={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function WebhookEventsTab() {
  const boards = useBoards();
  const [boardId, setBoardId] = useState<number | undefined>();
  const [outcome, setOutcome] = useState<'enqueued' | 'ignored' | undefined>();
  const q = useWebhookEvents({ boardId, outcome });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select
          className="w-auto"
          value={boardId ?? ''}
          onChange={(e) => setBoardId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">All boards</option>
          {(boards.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          value={outcome ?? ''}
          onChange={(e) =>
            setOutcome((e.target.value || undefined) as 'enqueued' | 'ignored' | undefined)
          }
        >
          <option value="">All outcomes</option>
          <option value="enqueued">enqueued</option>
          <option value="ignored">ignored</option>
        </Select>
      </div>
      <p className="text-xs text-gray-500">
        Every delivery Trello made, including the ones that did not produce a ping and why
        (unsupported action such as card creation, list not mapped, board disabled…).
      </p>
      <ErrorBanner error={q.error} />
      {q.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>No webhook deliveries received yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Board</th>
                <th>Action</th>
                <th>Card</th>
                <th>List</th>
                <th>Outcome</th>
                <th>Dups</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <RelativeTime iso={e.receivedAt} />
                  </td>
                  <td>{e.boardName ?? '—'}</td>
                  <td className="font-mono text-xs">{e.actionType}</td>
                  <td>{truncate(e.cardName, 50) || '—'}</td>
                  <td>{e.listName ?? '—'}</td>
                  <td>
                    {e.outcome === 'enqueued' ? (
                      <span className="text-green-700">enqueued</span>
                    ) : (
                      <span className="text-gray-600">
                        ignored{e.ignoreReason ? ` · ${e.ignoreReason}` : ''}
                      </span>
                    )}
                  </td>
                  <td>{e.duplicateCount || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <Button busy={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const [tab, setTab] = useState<'notifications' | 'events'>('notifications');
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="What was sent, what failed and why, and every webhook delivery from Trello."
      />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(['notifications', 'events'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t === 'notifications' ? 'Notifications' : 'Webhook events'}
          </button>
        ))}
      </div>
      <Card>{tab === 'notifications' ? <NotificationsTab /> : <WebhookEventsTab />}</Card>
    </div>
  );
}

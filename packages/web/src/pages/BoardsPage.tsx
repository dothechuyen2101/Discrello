import { Link } from 'react-router';
import { useBoards, usePatchBoard } from '../api/hooks';
import { WebhookStatusBadge } from '../components/Badges';
import { ErrorBanner } from '../components/ErrorBanner';
import { RelativeTime } from '../components/RelativeTime';
import { Button, EmptyState, PageHeader, Spinner, Toggle } from '../components/ui';

export function BoardsPage() {
  const boards = useBoards();
  const patch = usePatchBoard();
  return (
    <div>
      <PageHeader
        title="Boards"
        subtitle="Each Trello board posts to one Discord server and channel. Map its lists to roles on the board page."
        actions={
          <Link to="/boards/new">
            <Button variant="primary">Add board</Button>
          </Link>
        }
      />
      <ErrorBanner
        error={boards.error ?? patch.error}
        className="mb-3"
        onDismiss={() => patch.reset()}
      />
      {boards.isPending ? (
        <Spinner />
      ) : !boards.data?.length ? (
        <EmptyState>No boards yet. Add your first Trello board to start pinging people.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Board</th>
                <th>Server / channel</th>
                <th>Enabled</th>
                <th>Webhook</th>
                <th>Mappings</th>
                <th>Last event</th>
              </tr>
            </thead>
            <tbody>
              {boards.data.map((b) => (
                <tr key={b.id} className={b.enabled ? '' : 'opacity-60'}>
                  <td>
                    <Link
                      to={`/boards/${b.id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {b.name}
                    </Link>
                    {b.closed && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-600">
                        archived on Trello
                      </span>
                    )}
                    <div>
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-500 hover:underline"
                      >
                        open on Trello ↗
                      </a>
                    </div>
                  </td>
                  <td>
                    <div>{b.guildName}</div>
                    <div className="font-mono text-xs text-gray-500">{b.discordChannelId}</div>
                  </td>
                  <td>
                    <Toggle
                      checked={b.enabled}
                      disabled={patch.isPending}
                      onChange={(enabled) => patch.mutate({ id: b.id, input: { enabled } })}
                    />
                  </td>
                  <td>
                    <WebhookStatusBadge
                      status={b.webhookStatus}
                      lastError={b.webhookLastError}
                      lastCheckedAt={b.webhookLastCheckedAt}
                      consecutiveFailures={b.webhookConsecutiveFailures}
                    />
                    {b.webhookStatus !== 'active' && b.webhookLastError && (
                      <div className="mt-1 max-w-xs text-xs text-red-700">{b.webhookLastError}</div>
                    )}
                  </td>
                  <td>
                    {b.mappingCount} mapped
                    {b.mappingErrorCount > 0 && (
                      <span className="ml-1 text-red-700">· {b.mappingErrorCount} broken</span>
                    )}
                  </td>
                  <td>
                    <RelativeTime iso={b.lastEventAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

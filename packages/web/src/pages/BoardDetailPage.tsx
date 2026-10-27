import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DEFAULT_COMMENT_TEMPLATE, isSnowflake } from '@discrello/shared';
import {
  useBoard,
  useCheckWebhook,
  useDeleteBoard,
  useGuildChannels,
  useGuildRoles,
  usePatchBoard,
  useRegisterWebhook,
  useRoles,
  useSettings,
  useSyncLists,
  useTeamChannels,
  useTeams,
} from '../api/hooks';
import { WebhookStatusBadge } from '../components/Badges';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { MappingRow } from '../components/MappingRow';
import { RelativeTime } from '../components/RelativeTime';
import { Button, Card, Input, PageHeader, Select, Spinner, Toggle } from '../components/ui';

export function BoardDetailPage() {
  const params = useParams();
  const id = Number(params['id']);
  const navigate = useNavigate();
  const board = useBoard(id);
  const roles = useRoles();
  const teams = useTeams();
  const teamChannels = useTeamChannels();
  const settings = useSettings();
  const guildId = board.data?.guildId ?? null;
  const channels = useGuildChannels(guildId);
  const guildRoles = useGuildRoles(guildId);
  const patch = usePatchBoard();
  const sync = useSyncLists();
  const check = useCheckWebhook();
  const register = useRegisterWebhook();
  const del = useDeleteBoard();
  const [editingChannel, setEditingChannel] = useState(false);
  const [channelDraft, setChannelDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!Number.isFinite(id)) return <ErrorBanner error={new Error('Invalid board id')} />;
  if (board.isPending) return <Spinner />;
  if (board.isError) return <ErrorBanner error={board.error} />;
  const b = board.data;

  const saveChannel = () =>
    patch.mutate(
      { id, input: { discordChannelId: channelDraft } },
      { onSuccess: () => setEditingChannel(false) },
    );

  return (
    <div>
      <PageHeader
        title={
          <span>
            {b.name}
            {b.closed && (
              <span className="ml-2 align-middle text-xs font-normal text-gray-500">
                archived on Trello
              </span>
            )}
          </span>
        }
        subtitle={
          <span>
            <a href={b.url} target="_blank" rel="noreferrer" className="hover:underline">
              open on Trello ↗
            </a>
            {' · '}
            <Link to="/boards" className="hover:underline">
              all boards
            </Link>
          </span>
        }
        actions={
          <>
            <Toggle
              checked={b.enabled}
              label="Enabled"
              disabled={patch.isPending}
              onChange={(enabled) => patch.mutate({ id, input: { enabled } })}
            />
            <Button size="sm" busy={sync.isPending} onClick={() => sync.mutate(id)}>
              Re-sync lists
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Remove board
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card title="Discord destination">
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-gray-500">Server</dt>
              <dd>{b.guildName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-gray-500">Channel</dt>
              <dd className="min-w-0 flex-1">
                {editingChannel ? (
                  <div className="space-y-2">
                    {channels.data ? (
                      <Select
                        value={channelDraft}
                        onChange={(e) => setChannelDraft(e.target.value)}
                      >
                        <option value="">— pick a channel —</option>
                        {channels.data.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={channelDraft}
                        onChange={(e) => setChannelDraft(e.target.value.trim())}
                        placeholder="Channel ID"
                      />
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        busy={patch.isPending}
                        disabled={!isSnowflake(channelDraft)}
                        onClick={saveChannel}
                      >
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditingChannel(false)}>
                        Cancel
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Every mapped list that uses the board channel is re-checked against the new
                      channel.
                    </p>
                  </div>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">
                      {channels.data?.find((c) => c.id === b.discordChannelId)?.name
                        ? `#${channels.data.find((c) => c.id === b.discordChannelId)!.name}`
                        : b.discordChannelId}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        setChannelDraft(b.discordChannelId);
                        setEditingChannel(true);
                      }}
                    >
                      Change
                    </Button>
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <ErrorBanner error={patch.error} className="mt-3" onDismiss={() => patch.reset()} />
        </Card>

        <Card
          title="Trello webhook"
          actions={
            <>
              <Button size="sm" busy={check.isPending} onClick={() => check.mutate(id)}>
                Check now
              </Button>
              <Button size="sm" busy={register.isPending} onClick={() => register.mutate(id)}>
                Re-register
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <WebhookStatusBadge
              status={b.webhookStatus}
              lastError={b.webhookLastError}
              lastCheckedAt={b.webhookLastCheckedAt}
              consecutiveFailures={b.webhookConsecutiveFailures}
            />
            {b.webhookLastError && <p className="text-xs text-red-700">{b.webhookLastError}</p>}
            <p className="text-xs text-gray-500">
              Checked <RelativeTime iso={b.webhookLastCheckedAt} /> · last event{' '}
              <RelativeTime iso={b.lastEventAt} /> · lists synced{' '}
              <RelativeTime iso={b.listsSyncedAt} />
            </p>
            {b.webhookCallbackUrl && (
              <p className="font-mono text-xs break-all text-gray-400">{b.webhookCallbackUrl}</p>
            )}
          </div>
          <ErrorBanner
            error={check.error ?? register.error ?? sync.error}
            className="mt-3"
            onDismiss={() => {
              check.reset();
              register.reset();
              sync.reset();
            }}
          />
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-800">Lists → roles or teams</h2>
      <p className="mb-3 text-xs text-gray-500">
        When a card is moved into a mapped list, the role's target for {b.guildName} — or every
        member of the team — is pinged with the message below. Saving a mapping is refused if
        someone it should ping could not be notified.
      </p>
      {roles.data && roles.data.length === 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No roles yet —{' '}
          <Link to="/roles" className="underline">
            create the pipeline roles
          </Link>{' '}
          first.
        </p>
      )}
      <div className="space-y-3">
        {b.lists.map((list) => {
          const mapping = b.mappings.find((m) => m.trelloListId === list.trelloListId) ?? null;
          return (
            <MappingRow
              key={`${list.trelloListId}:${mapping?.updatedAt ?? 'unmapped'}`}
              boardId={id}
              boardName={b.name}
              boardChannelId={b.discordChannelId}
              guildId={b.guildId}
              list={list}
              mapping={mapping}
              roles={roles.data ?? []}
              teams={teams.data ?? []}
              teamChannels={teamChannels.data ?? []}
              channels={channels.data}
              guildRoles={guildRoles.data}
              defaultTemplate={
                settings.data?.defaultTemplate ??
                '{mention} — {card_title} is ready for {list_name}'
              }
              defaultCommentTemplate={
                settings.data?.defaultCommentTemplate ?? DEFAULT_COMMENT_TEMPLATE
              }
            />
          );
        })}
      </div>

      <ErrorBanner error={del.error} className="mt-3" onDismiss={() => del.reset()} />
      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${b.name}?`}
        message="The Trello webhook is deleted and all list mappings are removed. Sent notifications stay in the log."
        confirmLabel="Remove board"
        danger
        busy={del.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate(id, { onSuccess: () => navigate('/boards') })}
      />
    </div>
  );
}

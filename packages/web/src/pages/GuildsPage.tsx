import { useState, type FormEvent } from 'react';
import { isSnowflake, type GuildDto } from '@discrello/shared';
import {
  useAddGuild,
  useBotGuilds,
  useCheckGuild,
  useDeleteGuild,
  useGuildChannels,
  useGuilds,
  usePatchGuild,
} from '../api/hooks';
import { BotStatusBadge } from '../components/Badges';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { RelativeTime } from '../components/RelativeTime';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Toggle,
} from '../components/ui';

function AddGuildForm({ onDone }: { onDone: () => void }) {
  const botGuilds = useBotGuilds(true);
  const add = useAddGuild();
  const [picked, setPicked] = useState('');
  const [typed, setTyped] = useState('');
  const [alertChannelId, setAlertChannelId] = useState('');
  const discordGuildId = picked || typed.trim();
  const valid =
    isSnowflake(discordGuildId) && (alertChannelId === '' || isSnowflake(alertChannelId.trim()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { discordGuildId, alertChannelId: alertChannelId.trim() ? alertChannelId.trim() : null },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Server the bot is in"
          hint={
            botGuilds.isError
              ? 'Could not list the bot’s servers; paste the ID instead.'
              : undefined
          }
        >
          <Select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            disabled={botGuilds.isPending}
          >
            <option value="">{botGuilds.isPending ? 'Loading…' : '— Pick a server —'}</option>
            {(botGuilds.data ?? []).map((g) => (
              <option key={g.id} value={g.id} disabled={g.alreadyAdded}>
                {g.name}
                {g.alreadyAdded ? ' (already added)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="…or paste a server ID"
          hint="Developer Mode → right-click the server → Copy Server ID"
        >
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="123456789012345678"
            disabled={picked !== ''}
          />
        </Field>
      </div>
      <Field
        label="Alert channel ID (optional)"
        hint="Discrello posts here when a notification fails or a mention stops working. Must be a channel the bot can post in."
      >
        <Input
          value={alertChannelId}
          onChange={(e) => setAlertChannelId(e.target.value)}
          placeholder="Channel ID"
        />
      </Field>
      <ErrorBanner error={add.error} onDismiss={() => add.reset()} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={add.isPending} disabled={!valid}>
          Add server
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function GuildRow({ guild }: { guild: GuildDto }) {
  const [editing, setEditing] = useState(false);
  const [alertChannelId, setAlertChannelId] = useState(guild.alertChannelId ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const channels = useGuildChannels(editing ? guild.id : null);
  const patch = usePatchGuild();
  const check = useCheckGuild();
  const del = useDeleteGuild();

  const save = () =>
    patch.mutate(
      {
        id: guild.id,
        input: { alertChannelId: alertChannelId.trim() ? alertChannelId.trim() : null },
      },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <>
      <tr>
        <td>
          <div className="font-medium">{guild.name}</div>
          <div className="font-mono text-xs text-gray-500">{guild.discordGuildId}</div>
        </td>
        <td>
          <BotStatusBadge status={guild.botStatus} error={guild.botCheckError} />
          {guild.botStatus !== 'ok' && guild.botCheckError && (
            <div className="mt-1 max-w-xs text-xs text-red-700">{guild.botCheckError}</div>
          )}
          <div className="mt-1 text-xs text-gray-400">
            checked <RelativeTime iso={guild.botCheckedAt} />
          </div>
        </td>
        <td>
          {editing ? (
            <div className="space-y-1">
              {channels.data ? (
                <Select value={alertChannelId} onChange={(e) => setAlertChannelId(e.target.value)}>
                  <option value="">— none —</option>
                  {channels.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={alertChannelId}
                  onChange={(e) => setAlertChannelId(e.target.value)}
                  placeholder="Channel ID"
                />
              )}
            </div>
          ) : (
            <span className="font-mono text-xs">{guild.alertChannelId ?? '—'}</span>
          )}
        </td>
        <td>{guild.boardCount}</td>
        <td>
          <Toggle
            checked={guild.enabled}
            disabled={patch.isPending}
            onChange={(enabled) => patch.mutate({ id: guild.id, input: { enabled } })}
          />
        </td>
        <td>
          <div className="flex flex-wrap gap-1">
            {editing ? (
              <>
                <Button size="sm" variant="primary" busy={patch.isPending} onClick={save}>
                  Save
                </Button>
                <Button size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button size="sm" busy={check.isPending} onClick={() => check.mutate(guild.id)}>
              Check now
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </td>
      </tr>
      {(patch.error || del.error || check.error) && (
        <tr>
          <td colSpan={6}>
            <ErrorBanner
              error={patch.error ?? del.error ?? check.error}
              onDismiss={() => {
                patch.reset();
                del.reset();
                check.reset();
              }}
            />
          </td>
        </tr>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${guild.name}?`}
        message="Role targets for this server are deleted too. Boards using it must be removed first."
        confirmLabel="Remove"
        danger
        busy={del.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate(guild.id, { onSettled: () => setConfirmDelete(false) })}
      />
    </>
  );
}

export function GuildsPage() {
  const guilds = useGuilds();
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader
        title="Discord servers"
        subtitle="One bot, any number of servers. Invite the bot to a server, then add it here."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={adding}>
            Add server
          </Button>
        }
      />
      {adding && (
        <Card title="Add a Discord server" className="mb-4">
          <AddGuildForm onDone={() => setAdding(false)} />
        </Card>
      )}
      <ErrorBanner error={guilds.error} className="mb-3" />
      {guilds.isPending ? (
        <Spinner />
      ) : !guilds.data?.length ? (
        <EmptyState>No servers yet. Add the server your team uses to get started.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Bot</th>
                <th>Alert channel</th>
                <th>Boards</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {guilds.data.map((g) => (
                <GuildRow key={g.id} guild={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        IDs are shown raw. Enable Developer Mode in Discord (Settings → Advanced) to copy server,
        channel, user and role IDs.
      </p>
    </div>
  );
}

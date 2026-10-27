import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { isSnowflake } from '@discrello/shared';
import { useCreateBoard, useGuildChannels, useGuilds, usePreviewBoard } from '../api/hooks';
import { ErrorBanner } from '../components/ErrorBanner';
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui';

export function AddBoardPage() {
  const navigate = useNavigate();
  const guilds = useGuilds();
  const preview = usePreviewBoard();
  const create = useCreateBoard();
  const [ref, setRef] = useState('');
  const [guildId, setGuildId] = useState<number | ''>('');
  const [channelId, setChannelId] = useState('');
  const [typedChannel, setTypedChannel] = useState('');
  const channels = useGuildChannels(guildId === '' ? null : guildId);
  const effectiveChannel = channelId || typedChannel.trim();
  const canCreate =
    preview.data && !preview.data.alreadyAdded && guildId !== '' && isSnowflake(effectiveChannel);

  const fetchPreview = (e: FormEvent) => {
    e.preventDefault();
    if (ref.trim()) preview.mutate(ref.trim());
  };

  const submit = () => {
    if (guildId === '') return;
    create.mutate(
      { ref: ref.trim(), guildId, discordChannelId: effectiveChannel },
      { onSuccess: (board) => navigate(`/boards/${board.id}`) },
    );
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add a Trello board"
        subtitle="Paste the board URL, pick the Discord server and the channel the pings go to."
      />
      <Card title="1. Trello board" className="mb-4">
        <form onSubmit={fetchPreview} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Field
              label="Board URL, short link or ID"
              hint="e.g. https://trello.com/b/AbCd1234/sports"
            >
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="https://trello.com/b/…"
              />
            </Field>
          </div>
          <Button type="submit" busy={preview.isPending} disabled={!ref.trim()}>
            Fetch
          </Button>
        </form>
        <ErrorBanner error={preview.error} className="mt-3" onDismiss={() => preview.reset()} />
        {preview.data && (
          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="font-medium">
              {preview.data.name}
              {preview.data.closed && (
                <span className="ml-2 text-xs text-gray-500">(archived)</span>
              )}
            </div>
            {preview.data.alreadyAdded && (
              <p className="mt-1 text-amber-700">This board is already added.</p>
            )}
            <p className="mt-1 text-xs text-gray-500">Lists:</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {preview.data.lists.map((l) => (
                <li
                  key={l.trelloListId}
                  className={`rounded bg-white px-2 py-0.5 text-xs ring-1 ring-gray-200 ${l.closed ? 'text-gray-400 line-through' : ''}`}
                >
                  {l.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="2. Discord destination" className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Server">
            <Select
              value={guildId}
              onChange={(e) => {
                setGuildId(e.target.value ? Number(e.target.value) : '');
                setChannelId('');
              }}
            >
              <option value="">{guilds.isPending ? 'Loading…' : '— pick a server —'}</option>
              {(guilds.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            {guilds.data && guilds.data.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                No servers yet —{' '}
                <Link to="/guilds" className="underline">
                  add one first
                </Link>
                .
              </p>
            )}
          </Field>
          <Field label="Default channel" hint="Lists can override this individually later.">
            {channels.data ? (
              <Select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={guildId === ''}
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
                value={typedChannel}
                onChange={(e) => setTypedChannel(e.target.value)}
                placeholder={
                  channels.isPending && guildId !== '' ? 'Loading channels…' : 'Channel ID'
                }
                disabled={guildId === ''}
              />
            )}
          </Field>
        </div>
        {channels.isError && (
          <p className="mt-2 text-xs text-amber-700">
            Could not list channels; paste the channel ID instead.
          </p>
        )}
      </Card>

      <ErrorBanner error={create.error} className="mb-3" onDismiss={() => create.reset()} />
      <div className="flex gap-2">
        <Button variant="primary" busy={create.isPending} disabled={!canCreate} onClick={submit}>
          Create board
        </Button>
        <Link to="/boards">
          <Button>Cancel</Button>
        </Link>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Creating the board registers a Trello webhook pointing at this deployment. The channel is
        checked with Discord first.
      </p>
    </div>
  );
}

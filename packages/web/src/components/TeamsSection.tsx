import { useState, type FormEvent } from 'react';
import type { GuildDto, RoleDto, TeamChannelDto, TeamDto } from '@discrello/shared';
import {
  useAddTeamMember,
  useCreateTeam,
  useCreateTeamChannel,
  useDeleteTeam,
  useDeleteTeamChannel,
  useRemoveTeamMember,
  useRenameTeamChannel,
  useUpdateTeam,
} from '../api/hooks';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';
import { Badge, Button, Card, Field, Input, Select } from './ui';

/** "No channel" or one of the channels (folders of teams). '' = no channel. */
function ChannelSelect({
  value,
  onChange,
  channels,
}: {
  value: number | null;
  onChange: (channelId: number | null) => void;
  channels: TeamChannelDto[];
}) {
  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">No channel</option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

/** Create a team (name, channel, first members) or rename one. */
export function TeamForm({
  initial,
  roles,
  channels = [],
  defaultChannelId = null,
  onDone,
}: {
  initial?: TeamDto;
  roles: RoleDto[];
  channels?: TeamChannelDto[];
  defaultChannelId?: number | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [channelId, setChannelId] = useState<number | null>(defaultChannelId);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const mutation = initial ? update : create;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (initial) {
      update.mutate({ id: initial.id, input: { name: name.trim() } }, { onSuccess: onDone });
    } else {
      create.mutate(
        { name: name.trim(), memberRoleIds: memberIds, channelId },
        { onSuccess: onDone },
      );
    }
  };
  const toggle = (id: number) =>
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Team name" hint="Shown in the list picker on board pages.">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sports editors"
        />
      </Field>
      {!initial && channels.length > 0 && (
        <Field label="Channel" hint="The folder the team is shown in. You can move it later.">
          <ChannelSelect value={channelId} onChange={setChannelId} channels={channels} />
        </Field>
      )}
      {!initial && roles.length > 0 && (
        <fieldset>
          <legend className="mb-1 block text-xs font-semibold text-gray-600 uppercase">
            Members
          </legend>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => {
              const on = memberIds.includes(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={on}
                    onChange={() => toggle(r.id)}
                  />
                  {r.displayName}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-gray-500">You can add or remove people later.</p>
        </fieldset>
      )}
      <ErrorBanner error={mutation.error} onDismiss={() => mutation.reset()} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!name.trim()}>
          {initial ? 'Save' : 'Create team'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** One team, shown as a folder: who is in it, their Discord target per server, add/remove. */
export function TeamCard({
  team,
  roles,
  guilds,
  channels = [],
}: {
  team: TeamDto;
  roles: RoleDto[];
  guilds: GuildDto[];
  channels?: TeamChannelDto[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const add = useAddTeamMember();
  const remove = useRemoveTeamMember();
  const del = useDeleteTeam();
  const move = useUpdateTeam();

  const byId = new Map(roles.map((r) => [r.id, r]));
  const hasTargetEverywhere = (roleId: number) =>
    guilds.every((g) => byId.get(roleId)?.targets.some((t) => t.guildId === g.id));
  const withoutTarget = team.members.filter((m) => !hasTargetEverywhere(m.roleId)).length;
  const candidates = roles.filter((r) => !team.members.some((m) => m.roleId === r.id));
  const people = `${team.members.length} ${team.members.length === 1 ? 'person' : 'people'}`;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left hover:underline"
          >
            {open ? '▾' : '▸'} {team.name}
          </button>
          <span className="text-xs font-normal text-gray-500">
            {people} · used by {team.usageCount} list{team.usageCount === 1 ? '' : 's'}
          </span>
          {withoutTarget > 0 && guilds.length > 0 && (
            <Badge
              tone="amber"
              title="Lists mapped to this team cannot be saved in a server where a member has no target"
            >
              {withoutTarget} without a target
            </Badge>
          )}
        </span>
      }
      actions={
        <>
          <Button
            size="sm"
            onClick={() => {
              setEditing(true);
              setOpen(true);
            }}
          >
            Rename
          </Button>
          <span
            title={
              team.usageCount > 0 ? 'Unmap this team from every list before deleting it' : undefined
            }
          >
            <Button
              size="sm"
              variant="danger"
              disabled={team.usageCount > 0}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </span>
        </>
      }
    >
      {editing ? (
        <TeamForm initial={team} roles={roles} onDone={() => setEditing(false)} />
      ) : open ? (
        <div className="space-y-3">
          {team.members.length === 0 ? (
            <p className="text-xs text-amber-700">
              No members yet — a list cannot be mapped to this team until someone is in it.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {team.members.map((m) => {
                const role = byId.get(m.roleId);
                return (
                  <li
                    key={m.roleId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{m.displayName}</span>{' '}
                      <span className="font-mono text-xs text-gray-500">{m.key}</span>
                      <p className="text-xs text-gray-500">
                        {guilds.map((g) => {
                          const t = role?.targets.find((x) => x.guildId === g.id);
                          return (
                            <span key={g.id} className={`mr-3 ${t ? '' : 'text-amber-700'}`}>
                              {g.name}: {t ? `${t.mentionKind} ${t.mentionId}` : 'no target'}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      busy={remove.isPending && remove.variables?.roleId === m.roleId}
                      onClick={() => remove.mutate({ teamId: team.id, roleId: m.roleId })}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {candidates.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Add a person">
                <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">— pick a role —</option>
                  {candidates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                variant="primary"
                busy={add.isPending}
                disabled={!adding}
                onClick={() =>
                  add.mutate(
                    { teamId: team.id, roleId: Number(adding) },
                    { onSuccess: () => setAdding('') },
                  )
                }
              >
                Add to team
              </Button>
            </div>
          )}
          {channels.length > 0 && (
            <div className="sm:w-72">
              <Field label="Channel" hint="Moving a team does not change the lists that use it.">
                <ChannelSelect
                  value={team.channelId}
                  onChange={(channelId) => move.mutate({ id: team.id, input: { channelId } })}
                  channels={channels}
                />
              </Field>
            </div>
          )}
          <ErrorBanner error={add.error} onDismiss={() => add.reset()} />
          <ErrorBanner error={remove.error} onDismiss={() => remove.reset()} />
          <ErrorBanner error={move.error} onDismiss={() => move.reset()} />
          <p className="text-xs text-gray-500">
            A list mapped to this team pings every member at once, each with their own Discord
            target for that server. Adding someone to a team that lists already use is checked with
            Discord first, like saving a mapping.
          </p>
        </div>
      ) : team.members.length ? (
        <div className="flex flex-wrap gap-1.5">
          {team.members.map((m) => (
            <Badge key={m.roleId} tone={hasTargetEverywhere(m.roleId) ? 'grey' : 'amber'}>
              {m.displayName}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500">No members yet.</p>
      )}
      <ErrorBanner error={del.error} onDismiss={() => del.reset()} className="mt-3" />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete team ${team.name}?`}
        message="The people in it are not deleted."
        confirmLabel="Delete"
        danger
        busy={del.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate(team.id, { onSettled: () => setConfirmDelete(false) })}
      />
    </Card>
  );
}

/** Create a channel, or rename one. */
export function ChannelForm({ initial, onDone }: { initial?: TeamChannelDto; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const create = useCreateTeamChannel();
  const rename = useRenameTeamChannel();
  const mutation = initial ? rename : create;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (initial)
      rename.mutate({ id: initial.id, input: { name: name.trim() } }, { onSuccess: onDone });
    else create.mutate({ name: name.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="w-full sm:w-72">
        <Field label="Channel name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shorts Domination"
          />
        </Field>
      </div>
      <Button type="submit" variant="primary" busy={mutation.isPending} disabled={!name.trim()}>
        {initial ? 'Save' : 'Create channel'}
      </Button>
      <Button onClick={onDone}>Cancel</Button>
      <ErrorBanner error={mutation.error} onDismiss={() => mutation.reset()} className="w-full" />
    </form>
  );
}

/**
 * One channel shown as a folder that expands and collapses, with its teams inside. `channel` null
 * is the "No channel" folder for teams that are not in any channel.
 */
export function ChannelFolder({
  channel,
  teams,
  roles,
  guilds,
  channels,
  defaultOpen = false,
}: {
  channel: TeamChannelDto | null;
  teams: TeamDto[];
  roles: RoleDto[];
  guilds: GuildDto[];
  channels: TeamChannelDto[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [renaming, setRenaming] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteTeamChannel();
  const people = new Set(teams.flatMap((t) => t.members.map((m) => m.roleId))).size;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left text-sm font-semibold text-gray-800 hover:underline"
        >
          <span className="w-3 text-xs text-gray-500">{open ? '▾' : '▸'}</span>
          {channel?.name ?? 'No channel'}
          <span className="text-xs font-normal text-gray-500">
            {teams.length} {teams.length === 1 ? 'team' : 'teams'} · {people}{' '}
            {people === 1 ? 'person' : 'people'}
          </span>
        </button>
        {channel && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setOpen(true);
                setAddingTeam(true);
              }}
            >
              New team here
            </Button>
            <Button size="sm" onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {renaming && channel && (
        <div className="border-t border-gray-200 px-3 py-3">
          <ChannelForm initial={channel} onDone={() => setRenaming(false)} />
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t border-gray-200 p-3 pl-6">
          {addingTeam && channel && (
            <Card title={`New team in ${channel.name}`}>
              <TeamForm
                roles={roles}
                channels={channels}
                defaultChannelId={channel.id}
                onDone={() => setAddingTeam(false)}
              />
            </Card>
          )}
          {teams.length === 0 && !addingTeam ? (
            <p className="text-xs text-gray-500">
              No teams in this channel yet. Use "New team here", or move a team in from its own
              settings.
            </p>
          ) : (
            teams.map((t) => (
              <TeamCard key={t.id} team={t} roles={roles} guilds={guilds} channels={channels} />
            ))
          )}
        </div>
      )}
      <ErrorBanner error={del.error} onDismiss={() => del.reset()} className="m-3" />
      {channel && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete channel ${channel.name}?`}
          message={`Its ${teams.length} team(s) are kept and move to "No channel". No list changes.`}
          confirmLabel="Delete"
          danger
          busy={del.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate(channel.id, { onSettled: () => setConfirmDelete(false) })}
        />
      )}
    </div>
  );
}

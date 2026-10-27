import { useState, type FormEvent } from 'react';
import type { GuildDto, MentionTarget, RoleDto, TestSendResultDto } from '@discrello/shared';
import {
  useCreateRole,
  useDeleteRole,
  useDeleteRoleTarget,
  useGuildChannels,
  useGuildRoles,
  useGuilds,
  usePutRoleTarget,
  useRoles,
  useTeamChannels,
  useTeams,
  useTestRoleTarget,
  useUpdateRole,
} from '../api/hooks';
import { CheckStatusBadge } from '../components/Badges';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { MentionTargetInput, mentionTargetIsComplete } from '../components/MentionTargetInput';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplatePreview } from '../components/TemplatePreview';
import { ChannelFolder, ChannelForm, TeamCard, TeamForm } from '../components/TeamsSection';
import { TestSendResult } from '../components/TestSendResult';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';

function RoleForm({ initial, onDone }: { initial?: RoleDto; onDone: () => void }) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [defaultTemplate, setDefaultTemplate] = useState(initial?.defaultTemplate ?? '');
  const create = useCreateRole();
  const update = useUpdateRole();
  const mutation = initial ? update : create;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = {
      key: key.trim(),
      displayName: displayName.trim(),
      defaultTemplate: defaultTemplate.trim() || null,
    };
    if (initial) update.mutate({ id: initial.id, input }, { onSuccess: onDone });
    else create.mutate(input, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Key" hint="Lowercase letters, digits, underscores — e.g. script_writer">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="script_writer" />
        </Field>
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Script writer"
          />
        </Field>
      </div>
      <TemplateEditor
        label="Default message template (used when this role is mapped to a list)"
        value={defaultTemplate}
        onChange={setDefaultTemplate}
      />
      {defaultTemplate.trim() && (
        <TemplatePreview template={defaultTemplate} mentionLabel={`@${displayName || 'someone'}`} />
      )}
      <ErrorBanner error={mutation.error} onDismiss={() => mutation.reset()} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={!key.trim() || !displayName.trim()}
        >
          {initial ? 'Save' : 'Create role'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** The per-server target editor: who is pinged for this role in this Discord server. */
function TargetPanel({ role, guild }: { role: RoleDto; guild: GuildDto }) {
  const current = role.targets.find((t) => t.guildId === guild.id) ?? null;
  const saved: MentionTarget | null = current
    ? { kind: current.mentionKind, id: current.mentionId }
    : null;
  const [draft, setDraft] = useState<MentionTarget | null>(saved ?? { kind: 'user', id: '' });
  const [testChannel, setTestChannel] = useState('');
  const [testResult, setTestResult] = useState<TestSendResultDto | null>(null);
  const put = usePutRoleTarget();
  const remove = useDeleteRoleTarget();
  const test = useTestRoleTarget();
  const channels = useGuildChannels(guild.id);
  const guildRoles = useGuildRoles(guild.id);

  const dirty = !saved || !draft || saved.kind !== draft.kind || saved.id !== draft.id;
  const complete = draft !== null && mentionTargetIsComplete(draft) && draft.id !== '';

  const savedLabel = saved
    ? saved.kind === 'role'
      ? `@${guildRoles.data?.find((r) => r.id === saved.id)?.name ?? saved.id}`
      : `user ${saved.id}`
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Current target:</span>
        {saved ? (
          <>
            <span className="font-mono">{savedLabel}</span>
            <CheckStatusBadge status={current!.checkStatus} error={current!.checkError} />
          </>
        ) : (
          <span className="text-amber-700">
            not set — lists mapped to this role in {guild.name} cannot notify anyone
          </span>
        )}
      </div>
      {current?.checkStatus === 'error' && current.checkError && (
        <p className="text-xs text-red-700">{current.checkError}</p>
      )}

      <MentionTargetInput
        value={draft}
        onChange={setDraft}
        guildId={guild.id}
        idPrefix={`role-${role.id}-guild-${guild.id}`}
      />
      <ErrorBanner error={put.error} onDismiss={() => put.reset()} />
      <ErrorBanner error={remove.error} onDismiss={() => remove.reset()} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={put.isPending}
          disabled={!dirty || !complete}
          onClick={() => draft && put.mutate({ roleId: role.id, guildId: guild.id, target: draft })}
        >
          Save target
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="danger"
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(
                { roleId: role.id, guildId: guild.id },
                { onSuccess: () => setDraft({ kind: 'user', id: '' }) },
              )
            }
          >
            Remove target
          </Button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Saving checks with Discord that this target would really be notified (role mentionable or
        bot may mention roles, members who can see the channel, user in the server). A failing check
        is refused and explained.
      </p>

      {saved && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Send a test ping to">
              {channels.data ? (
                <Select value={testChannel} onChange={(e) => setTestChannel(e.target.value)}>
                  <option value="">— pick a channel —</option>
                  {channels.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={testChannel}
                  onChange={(e) => setTestChannel(e.target.value)}
                  placeholder="Channel ID"
                />
              )}
            </Field>
            <Button
              size="sm"
              busy={test.isPending}
              disabled={!testChannel}
              onClick={() =>
                test.mutate(
                  { roleId: role.id, guildId: guild.id, channelId: testChannel },
                  { onSuccess: setTestResult, onError: () => setTestResult(null) },
                )
              }
            >
              Send test ping
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            <ErrorBanner error={test.error} onDismiss={() => test.reset()} />
            <TestSendResult result={testResult} onDismiss={() => setTestResult(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function RoleRow({ role, guilds }: { role: RoleDto; guilds: GuildDto[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<number | null>(guilds[0]?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteRole();
  const broken = role.targets.filter((t) => t.checkStatus === 'error').length;
  const missing = guilds.filter((g) => !role.targets.some((t) => t.guildId === g.id)).length;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left hover:underline"
          >
            {open ? '▾' : '▸'} {role.displayName}
          </button>
          <span className="font-mono text-xs font-normal text-gray-500">{role.key}</span>
          <span className="text-xs font-normal text-gray-500">
            used by {role.usageCount} mapping{role.usageCount === 1 ? '' : 's'}
          </span>
          {role.teams.map((t) => (
            <Badge key={t.id} tone="blue" title={`Member of team ${t.name}`}>
              {t.name}
            </Badge>
          ))}
          {broken > 0 && (
            <CheckStatusBadge status="error" error={`${broken} server target(s) no longer work`} />
          )}
          {missing > 0 && guilds.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              no target in {missing} server{missing === 1 ? '' : 's'}
            </span>
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
            Edit
          </Button>
          <span
            title={
              role.usageCount > 0 ? 'Unmap this role from every list before deleting it' : undefined
            }
          >
            <Button
              size="sm"
              variant="danger"
              disabled={role.usageCount > 0}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </span>
        </>
      }
    >
      {editing ? (
        <RoleForm initial={role} onDone={() => setEditing(false)} />
      ) : open ? (
        <div className="space-y-4">
          {role.defaultTemplate ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-600 uppercase">Default template</p>
              <TemplatePreview
                template={role.defaultTemplate}
                mentionLabel={`@${role.displayName}`}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              No default template; new mappings start from the global default in Settings.
            </p>
          )}
          {guilds.length === 0 ? (
            <EmptyState>
              Add a Discord server first, then set who is pinged for this role.
            </EmptyState>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
                {guilds.map((g) => {
                  const t = role.targets.find((x) => x.guildId === g.id);
                  const dot = !t
                    ? 'bg-amber-400'
                    : t.checkStatus === 'error'
                      ? 'bg-red-500'
                      : 'bg-green-500';
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setTab(g.id)}
                      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm ${tab === g.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      {g.name}
                    </button>
                  );
                })}
              </div>
              {guilds
                .filter((g) => g.id === tab)
                .map((g) => (
                  <TargetPanel key={`${role.id}-${g.id}-${role.updatedAt}`} role={role} guild={g} />
                ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {guilds.map((g) => {
            const t = role.targets.find((x) => x.guildId === g.id);
            return (
              <span key={g.id} className="mr-3">
                {g.name}: {t ? `${t.mentionKind} ${t.mentionId}` : 'no target'}
              </span>
            );
          })}
        </p>
      )}
      <ErrorBanner error={del.error} onDismiss={() => del.reset()} className="mt-3" />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete role ${role.displayName}?`}
        confirmLabel="Delete"
        danger
        busy={del.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate(role.id, { onSettled: () => setConfirmDelete(false) })}
      />
    </Card>
  );
}

export function RolesPage() {
  const roles = useRoles();
  const teams = useTeams();
  const teamChannels = useTeamChannels();
  const guilds = useGuilds();
  const [creating, setCreating] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const channelList = teamChannels.data ?? [];
  const looseTeams = (teams.data ?? []).filter(
    (t) => !channelList.some((c) => c.id === t.channelId),
  );
  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="Roles are global — a pipeline stage or a person. Set, per Discord server, which user or role gets pinged. Group roles into teams to ping several people at once, and teams into channels to keep the list short."
        actions={
          <>
            <Button onClick={() => setCreatingChannel(true)} disabled={creatingChannel}>
              New channel
            </Button>
            <Button onClick={() => setCreatingTeam(true)} disabled={creatingTeam}>
              New team
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)} disabled={creating}>
              New role
            </Button>
          </>
        }
      />
      {creatingChannel && (
        <Card title="New channel" className="mb-4">
          <p className="mb-3 text-xs text-gray-500">
            A channel is a folder of teams (e.g. one per show), so the Roles page and the list
            picker on board pages stay short. It is only for organising: lists ping teams or people,
            never a whole channel.
          </p>
          <ChannelForm onDone={() => setCreatingChannel(false)} />
        </Card>
      )}
      {creatingTeam && (
        <Card title="New team" className="mb-4">
          <TeamForm
            roles={roles.data ?? []}
            channels={channelList}
            onDone={() => setCreatingTeam(false)}
          />
        </Card>
      )}
      {creating && (
        <Card title="New role" className="mb-4">
          <RoleForm onDone={() => setCreating(false)} />
        </Card>
      )}
      <ErrorBanner
        error={roles.error ?? teams.error ?? teamChannels.error ?? guilds.error}
        className="mb-3"
      />
      {roles.isPending || guilds.isPending || teams.isPending || teamChannels.isPending ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Teams</h2>
            {!teams.data?.length && !channelList.length ? (
              <EmptyState>
                No teams yet. A team groups people so that one list can ping all of them — for
                example everyone who edits Sports.
              </EmptyState>
            ) : channelList.length === 0 ? (
              // No channels yet: teams are listed as before.
              <div className="space-y-3">
                {(teams.data ?? []).map((t) => (
                  <TeamCard
                    key={t.id}
                    team={t}
                    roles={roles.data ?? []}
                    guilds={guilds.data ?? []}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {channelList.map((c) => (
                  <ChannelFolder
                    key={c.id}
                    channel={c}
                    teams={(teams.data ?? []).filter((t) => t.channelId === c.id)}
                    roles={roles.data ?? []}
                    guilds={guilds.data ?? []}
                    channels={channelList}
                  />
                ))}
                {looseTeams.length > 0 && (
                  <ChannelFolder
                    channel={null}
                    teams={looseTeams}
                    roles={roles.data ?? []}
                    guilds={guilds.data ?? []}
                    channels={channelList}
                  />
                )}
              </div>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Roles</h2>
            {!roles.data?.length ? (
              <EmptyState>
                No roles yet. Create one per pipeline stage (script writer, editor, uploader…) or
                per person.
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {roles.data.map((r) => (
                  <RoleRow key={r.id} role={r} guilds={guilds.data ?? []} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  REVISION_PREFIX,
  type DiscordChannelDto,
  type DiscordRoleDto,
  type ListMappingDto,
  type MentionTarget,
  type RoleDto,
  type TeamChannelDto,
  type TeamDto,
  type TestSendResultDto,
  type TrelloListDto,
} from '@discrello/shared';
import { useDeleteMapping, usePutMapping, useTestMapping } from '../api/hooks';
import { CheckStatusBadge } from './Badges';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';
import { MentionTargetInput, mentionTargetIsComplete } from './MentionTargetInput';
import { TemplateEditor } from './TemplateEditor';
import { TemplatePreview } from './TemplatePreview';
import { TestSendResult } from './TestSendResult';
import { TreePicker, recipientFolders } from './TreePicker';
import { Button, Field, Input, Select, Toggle } from './ui';

interface Draft {
  /** '' = no notification, 'role:<id>' or 'team:<id>'. */
  recipient: string;
  template: string;
  /** null = use the default feedback message from Settings. */
  commentTemplate: string | null;
  /** Who revision feedback pings: '' = same as the list, 'role:<id>' or 'team:<id>'. */
  feedback: string;
  overrideMention: MentionTarget | null;
  overrideChannelId: string;
  enabled: boolean;
}

function draftFrom(mapping: ListMappingDto | null): Draft {
  return {
    recipient: mapping?.teamId
      ? `team:${mapping.teamId}`
      : mapping?.roleId
        ? `role:${mapping.roleId}`
        : '',
    template: mapping?.messageTemplate ?? '',
    commentTemplate: mapping?.commentTemplate ?? null,
    feedback: mapping?.feedbackTeamId
      ? `team:${mapping.feedbackTeamId}`
      : mapping?.feedbackRoleId
        ? `role:${mapping.feedbackRoleId}`
        : '',
    overrideMention: mapping?.overrideMention ?? null,
    overrideChannelId: mapping?.overrideChannelId ?? '',
    enabled: mapping?.enabled ?? true,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.recipient === b.recipient &&
    a.template === b.template &&
    a.commentTemplate === b.commentTemplate &&
    a.feedback === b.feedback &&
    a.overrideChannelId === b.overrideChannelId &&
    a.enabled === b.enabled &&
    (a.overrideMention?.kind ?? null) === (b.overrideMention?.kind ?? null) &&
    (a.overrideMention?.id ?? null) === (b.overrideMention?.id ?? null)
  );
}

/** One Trello list on the board detail page: role or team, template, overrides, save/test/unmap. */
export function MappingRow({
  boardId,
  boardName,
  boardChannelId,
  guildId,
  list,
  mapping,
  roles,
  teams,
  teamChannels,
  channels,
  guildRoles,
  defaultTemplate,
  defaultCommentTemplate,
}: {
  boardId: number;
  boardName: string;
  boardChannelId: string;
  guildId: number;
  list: TrelloListDto;
  mapping: ListMappingDto | null;
  roles: RoleDto[];
  teams: TeamDto[];
  /** Folders of teams, for the pickers. */
  teamChannels: TeamChannelDto[];
  channels: DiscordChannelDto[] | undefined;
  guildRoles: DiscordRoleDto[] | undefined;
  defaultTemplate: string;
  defaultCommentTemplate: string;
}) {
  const initial = useMemo(() => draftFrom(mapping), [mapping]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [advanced, setAdvanced] = useState(
    Boolean(mapping?.overrideMention || mapping?.overrideChannelId),
  );
  const [feedbackOpen, setFeedbackOpen] = useState(
    Boolean(mapping?.commentTemplate || mapping?.feedbackRoleId || mapping?.feedbackTeamId),
  );
  const [templateAutoFilled, setTemplateAutoFilled] = useState(!mapping);
  const [confirmUnmap, setConfirmUnmap] = useState(false);
  const [testResult, setTestResult] = useState<TestSendResultDto | null>(null);
  const put = usePutMapping(boardId);
  const del = useDeleteMapping(boardId);
  const test = useTestMapping(boardId);

  /** 'role:<id>' / 'team:<id>' → the role or team it names. */
  const parse = (value: string) => {
    const [kind, id] = value.split(':');
    return {
      role: kind === 'role' ? (roles.find((r) => r.id === Number(id)) ?? null) : null,
      team: kind === 'team' ? (teams.find((t) => t.id === Number(id)) ?? null) : null,
    };
  };
  const { role, team } = parse(draft.recipient);
  const feedbackTo = parse(draft.feedback);
  const folders = recipientFolders(roles, teams, teamChannels);
  const targetIn = (roleId: number) =>
    roles.find((r) => r.id === roleId)?.targets.find((t) => t.guildId === guildId) ?? null;
  const dirty = !sameDraft(draft, initial);
  const complete =
    draft.recipient !== '' &&
    draft.template.trim() !== '' &&
    draft.template.length <= 1900 &&
    (draft.commentTemplate === null ||
      (draft.commentTemplate.trim() !== '' && draft.commentTemplate.length <= 1900)) &&
    mentionTargetIsComplete(draft.overrideMention) &&
    (draft.overrideMention === null || draft.overrideMention.id !== '');

  const pickRecipient = (recipient: string) => {
    const next: Draft = { ...draft, recipient };
    if (recipient !== '' && (templateAutoFilled || draft.template.trim() === '')) {
      // A role brings its own default message; a team starts from the global default.
      const r = recipient.startsWith('role:')
        ? roles.find((x) => x.id === Number(recipient.slice('role:'.length)))
        : null;
      next.template = r?.defaultTemplate ?? defaultTemplate;
      setTemplateAutoFilled(true);
    }
    setDraft(next);
  };

  const save = () => {
    if (draft.recipient === '') return;
    put.mutate(
      {
        trelloListId: list.trelloListId,
        input: {
          roleId: role?.id ?? null,
          teamId: team?.id ?? null,
          messageTemplate: draft.template.trim(),
          commentTemplate: draft.commentTemplate?.trim() || null,
          feedbackRoleId: feedbackTo.role?.id ?? null,
          feedbackTeamId: feedbackTo.team?.id ?? null,
          overrideMention: draft.overrideMention,
          overrideChannelId: draft.overrideChannelId || null,
          enabled: draft.enabled,
        },
      },
      { onSuccess: () => setTemplateAutoFilled(false) },
    );
  };

  const targetLabel = (target: MentionTarget) =>
    target.kind === 'role'
      ? `@${guildRoles?.find((r) => r.id === target.id)?.name ?? target.id}`
      : `@user:${target.id}`;
  // Label used in a preview: a role's target, else every team member.
  const labelFor = (who: { role: RoleDto | null; team: TeamDto | null }) => {
    if (who.team) {
      return who.team.members.length
        ? who.team.members.map((m) => `@${m.displayName}`).join(' ')
        : '@nobody';
    }
    const t = who.role ? targetIn(who.role.id) : null;
    if (!t) return who.role ? `@${who.role.displayName}` : '@someone';
    return targetLabel({ kind: t.mentionKind, id: t.mentionId });
  };
  // The list's own pings: the override wins.
  const mentionLabel = draft.overrideMention?.id
    ? targetLabel(draft.overrideMention)
    : labelFor({ role, team });
  const hasFeedbackRecipient = draft.feedback !== '';
  const feedbackLabel = hasFeedbackRecipient ? labelFor(feedbackTo) : mentionLabel;
  const roleHasTarget = role ? targetIn(role.id) !== null : true;
  const membersWithoutTarget = team ? team.members.filter((m) => !targetIn(m.roleId)) : [];
  const feedbackWithoutTarget = feedbackTo.team
    ? feedbackTo.team.members.filter((m) => !targetIn(m.roleId)).map((m) => m.displayName)
    : feedbackTo.role && !targetIn(feedbackTo.role.id)
      ? [feedbackTo.role.displayName]
      : [];
  const listName = role?.displayName ?? team?.name ?? 'the list';

  const tone = list.missing
    ? 'border-red-200'
    : list.closed
      ? 'border-gray-200 opacity-60'
      : mapping
        ? 'border-indigo-200'
        : 'border-gray-200';

  return (
    <div className={`rounded-lg border bg-white p-4 shadow-xs ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{list.name}</h3>
          {list.closed && (
            <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">archived</span>
          )}
          {list.missing && (
            <span className="rounded bg-red-100 px-1.5 text-xs text-red-700">
              missing on Trello
            </span>
          )}
          {mapping && <CheckStatusBadge status={mapping.checkStatus} error={mapping.checkError} />}
          {mapping && !mapping.enabled && (
            <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">disabled</span>
          )}
        </div>
        <div className="w-full sm:w-72">
          <TreePicker
            ariaLabel={`Who is pinged for ${list.name}`}
            value={draft.recipient}
            onChange={pickRecipient}
            topItems={[{ value: '', label: '— No notification —' }]}
            folders={folders}
          />
        </div>
      </div>
      {mapping?.checkStatus === 'error' && mapping.checkError && (
        <p className="mt-2 text-xs text-red-700">{mapping.checkError}</p>
      )}

      {draft.recipient !== '' && (
        <div className="mt-4 space-y-4">
          {!roleHasTarget && draft.overrideMention === null && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {role?.displayName} has no Discord target in this server yet. Set one on the Roles
              page, or set an override below — saving will be refused until someone can be pinged.
            </p>
          )}
          {team && team.members.length === 0 && draft.overrideMention === null && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Team {team.name} has no members yet. Add people to it on the Roles page — saving will
              be refused until someone can be pinged.
            </p>
          )}
          {membersWithoutTarget.length > 0 && draft.overrideMention === null && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {membersWithoutTarget.map((m) => m.displayName).join(', ')}{' '}
              {membersWithoutTarget.length === 1 ? 'has' : 'have'} no Discord target in this server
              yet. Set their target on the Roles page or take them out of the team — saving will be
              refused until everyone in {team?.name} can be pinged.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <TemplateEditor
              value={draft.template}
              onChange={(template) => {
                setTemplateAutoFilled(false);
                setDraft({ ...draft, template });
              }}
            />
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-600 uppercase">Preview</p>
              <TemplatePreview
                template={draft.template}
                mentionLabel={mentionLabel}
                vars={{
                  list_name: list.name,
                  board_name: boardName,
                  previous_list_name: 'Previous list',
                }}
              />
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setFeedbackOpen((o) => !o)}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              {feedbackOpen ? '▾' : '▸'} Feedback message for revision comments
              <span className="ml-1 font-normal text-gray-500">
                ({draft.commentTemplate === null ? 'default' : 'custom'} message ·{' '}
                {hasFeedbackRecipient
                  ? `goes to ${feedbackTo.role?.displayName ?? feedbackTo.team?.name ?? '?'}`
                  : 'same person as the list'}
                )
              </span>
            </button>
            {feedbackOpen && (
              <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-600">
                  Sent in this list's channel when someone comments on a card in this list with a
                  comment that starts with <code>{REVISION_PREFIX}</code>.
                </p>
                <div className="sm:w-96">
                  <Field
                    label="Feedback goes to"
                    hint="For a QC list, pick the person who has to make the changes (e.g. the editor)."
                  >
                    <TreePicker
                      ariaLabel={`Who receives revision feedback for ${list.name}`}
                      value={draft.feedback}
                      onChange={(feedback) => setDraft({ ...draft, feedback })}
                      topItems={[{ value: '', label: `Same as this list (${listName})` }]}
                      folders={folders}
                    />
                  </Field>
                </div>
                {feedbackWithoutTarget.length > 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {feedbackWithoutTarget.join(', ')}{' '}
                    {feedbackWithoutTarget.length === 1 ? 'has' : 'have'} no Discord target in this
                    server yet. Set it on the Roles page — saving will be refused until everyone who
                    receives the feedback can be pinged.
                  </p>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  {draft.commentTemplate === null ? (
                    <div className="space-y-2 text-xs text-gray-600">
                      <p>Using the default feedback message from Settings.</p>
                      <Button
                        size="sm"
                        onClick={() =>
                          setDraft({ ...draft, commentTemplate: defaultCommentTemplate })
                        }
                      >
                        Customize for this list
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <TemplateEditor
                        kind="comment"
                        label="Feedback message"
                        value={draft.commentTemplate}
                        onChange={(commentTemplate) => setDraft({ ...draft, commentTemplate })}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDraft({ ...draft, commentTemplate: null })}
                      >
                        Use the default instead
                      </Button>
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-600 uppercase">Preview</p>
                    <TemplatePreview
                      template={draft.commentTemplate ?? defaultCommentTemplate}
                      mentionLabel={feedbackLabel}
                      vars={{ list_name: list.name, board_name: boardName }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              {advanced ? '▾' : '▸'} Advanced: override who is pinged or which channel
            </button>
            {advanced && (
              <div className="mt-3 grid gap-4 rounded-md border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600 uppercase">
                    Mention override
                  </p>
                  <MentionTargetInput
                    value={draft.overrideMention}
                    onChange={(overrideMention) => setDraft({ ...draft, overrideMention })}
                    guildId={guildId}
                    allowInherit
                    inheritLabel={
                      team
                        ? `Ping every member of ${team.name}`
                        : `Use ${role?.displayName ?? 'the role'}'s target for this server`
                    }
                    idPrefix={`map-${list.trelloListId}`}
                  />
                </div>
                <Field label="Channel override" hint="Defaults to the board channel.">
                  {channels ? (
                    <Select
                      value={draft.overrideChannelId}
                      onChange={(e) => setDraft({ ...draft, overrideChannelId: e.target.value })}
                    >
                      <option value="">
                        Board channel (
                        {channels.find((c) => c.id === boardChannelId)?.name
                          ? `#${channels.find((c) => c.id === boardChannelId)!.name}`
                          : boardChannelId}
                        )
                      </option>
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={draft.overrideChannelId}
                      onChange={(e) =>
                        setDraft({ ...draft, overrideChannelId: e.target.value.trim() })
                      }
                      placeholder="Channel ID (empty = board channel)"
                    />
                  )}
                </Field>
              </div>
            )}
          </div>

          <ErrorBanner error={put.error} onDismiss={() => put.reset()} />
          <ErrorBanner error={del.error} onDismiss={() => del.reset()} />
          <ErrorBanner error={test.error} onDismiss={() => test.reset()} />
          <TestSendResult result={testResult} onDismiss={() => setTestResult(null)} />

          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
              label="Enabled"
            />
            <span className="flex-1" />
            {mapping && (
              <Button
                size="sm"
                busy={test.isPending}
                onClick={() => test.mutate(list.trelloListId, { onSuccess: setTestResult })}
                disabled={dirty}
              >
                Send test
              </Button>
            )}
            {mapping && (
              <Button size="sm" variant="danger" onClick={() => setConfirmUnmap(true)}>
                Unmap
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              busy={put.isPending}
              disabled={!dirty || !complete}
              onClick={save}
            >
              {mapping ? 'Save' : 'Map list'}
            </Button>
          </div>
          {dirty && mapping && (
            <p className="text-right text-xs text-gray-400">
              Unsaved changes — "Send test" uses the saved version.
            </p>
          )}
        </div>
      )}
      {draft.recipient === '' && mapping && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">Choosing "No notification" unmaps this list.</p>
          <Button size="sm" variant="danger" onClick={() => setConfirmUnmap(true)}>
            Unmap
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmUnmap}
        title={`Stop notifying for "${list.name}"?`}
        message="Cards moved into this list will no longer ping anyone."
        confirmLabel="Unmap"
        danger
        busy={del.isPending}
        onCancel={() => setConfirmUnmap(false)}
        onConfirm={() => del.mutate(list.trelloListId, { onSettled: () => setConfirmUnmap(false) })}
      />
    </div>
  );
}

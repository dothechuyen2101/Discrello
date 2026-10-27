import { useEffect, useState } from 'react';
import { REVISION_PREFIX, type TemplateKind } from '@discrello/shared';
import {
  useIntegrations,
  useRecheckMentions,
  useReconcile,
  useSaveSettings,
  useSettings,
  type RecheckResult,
  type ReconcileResult,
} from '../api/hooks';
import { ErrorBanner } from '../components/ErrorBanner';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplatePreview } from '../components/TemplatePreview';
import { Button, Card, Code, PageHeader, Spinner } from '../components/ui';

function DefaultTemplateCard({
  field,
  kind,
  title,
  label,
}: {
  field: 'defaultTemplate' | 'defaultCommentTemplate';
  kind: TemplateKind;
  title: string;
  label: string;
}) {
  const settings = useSettings();
  const save = useSaveSettings();
  const saved = settings.data?.[field];
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (saved !== undefined) setDraft(saved);
  }, [saved]);
  const dirty = saved !== undefined ? draft !== saved : false;
  return (
    <Card
      title={title}
      actions={
        <Button
          variant="primary"
          size="sm"
          busy={save.isPending}
          disabled={!dirty || !draft.trim()}
          onClick={() => save.mutate({ [field]: draft.trim() })}
        >
          Save
        </Button>
      }
    >
      {settings.isPending ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <TemplateEditor value={draft} onChange={setDraft} label={label} kind={kind} />
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-600 uppercase">Preview</p>
            <TemplatePreview template={draft} mentionLabel="@Editor" />
          </div>
        </div>
      )}
      <ErrorBanner
        error={settings.error ?? save.error}
        className="mt-3"
        onDismiss={() => save.reset()}
      />
    </Card>
  );
}

function IntegrationsCard() {
  const q = useIntegrations({ refetchInterval: 30_000 });
  const d = q.data;
  return (
    <Card
      title="Integrations"
      actions={
        <Button size="sm" busy={q.isFetching} onClick={() => q.refetch()}>
          Refresh
        </Button>
      }
    >
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBanner error={q.error} />
      ) : d ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item label="Trello">
            {d.trello.ok ? (
              <span className="text-green-700">connected as {d.trello.username}</span>
            ) : (
              <span className="text-red-700">{d.trello.error}</span>
            )}
          </Item>
          <Item label="Discord bot">
            {d.discord.ok ? (
              <span className="text-green-700">
                {d.discord.botUsername}{' '}
                <span className="font-mono text-xs text-gray-500">({d.discord.botUserId})</span>
              </span>
            ) : (
              <span className="text-red-700">{d.discord.error}</span>
            )}
          </Item>
          <Item label="Server Members Intent">
            {d.discord.membersIntentEnabled === true ? (
              <span className="text-green-700">enabled</span>
            ) : d.discord.membersIntentEnabled === false ? (
              <span className="text-red-700">
                disabled — role targets cannot be verified. In the Discord Developer Portal open
                your application → Bot → Privileged Gateway Intents and enable "Server Members
                Intent".
              </span>
            ) : (
              <span className="text-gray-500">unknown until a server is added</span>
            )}
          </Item>
          <Item label="Servers registered">{d.guildCount}</Item>
          <Item label="Public base URL">
            <Code>{d.publicBaseUrl}</Code>
          </Item>
          <Item label="Version">{d.version}</Item>
        </dl>
      ) : null}
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function MaintenanceCard() {
  const reconcile = useReconcile();
  const recheck = useRecheckMentions();
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null);
  return (
    <Card title="Maintenance">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            busy={reconcile.isPending}
            onClick={() => reconcile.mutate(undefined, { onSuccess: setReconcileResult })}
          >
            Reconcile webhooks
          </Button>
          <span className="text-gray-600">
            Re-checks every board's Trello webhook (re-enables or re-creates it) and deletes
            orphans. Runs automatically every 15 minutes.
          </span>
        </div>
        {reconcileResult && (
          <p className="text-xs text-gray-700">
            Checked {reconcileResult.checked} board(s), deleted {reconcileResult.orphansDeleted}{' '}
            orphan webhook(s).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            busy={recheck.isPending}
            onClick={() => recheck.mutate(undefined, { onSuccess: setRecheckResult })}
          >
            Re-check mentions
          </Button>
          <span className="text-gray-600">
            Re-validates every role target and list mapping against Discord. Runs automatically
            every 15 minutes; problems go to the server's alert channel.
          </span>
        </div>
        {recheckResult && (
          <p
            className={`text-xs ${recheckResult.targetsFailing + recheckResult.mappingsFailing > 0 ? 'text-red-700' : 'text-gray-700'}`}
          >
            Targets: {recheckResult.targetsFailing} failing of {recheckResult.targetsChecked} ·
            Mappings: {recheckResult.mappingsFailing} failing of {recheckResult.mappingsChecked}.
          </p>
        )}
        <ErrorBanner
          error={reconcile.error ?? recheck.error}
          onDismiss={() => {
            reconcile.reset();
            recheck.reset();
          }}
        />
      </div>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <DefaultTemplateCard
        field="defaultTemplate"
        kind="move"
        title="Default message template"
        label="Used for new mappings when the role has no default template"
      />
      <DefaultTemplateCard
        field="defaultCommentTemplate"
        kind="comment"
        title="Default feedback message"
        label={`Sent for revision comments (starting with "${REVISION_PREFIX}") on lists without their own feedback message`}
      />
      <IntegrationsCard />
      <MaintenanceCard />
    </div>
  );
}

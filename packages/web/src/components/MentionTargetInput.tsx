import { isSnowflake, type MentionKind, type MentionTarget } from '@discrello/shared';
import { useGuildRoles } from '../api/hooks';
import { Input, Select } from './ui';

type Mode = MentionKind | 'inherit';

/**
 * Picks who gets pinged: a Discord user (by ID) or a Discord role (picked from the server's roles).
 * With `allowInherit`, a third option means "use the role's default target".
 */
export function MentionTargetInput({
  value,
  onChange,
  guildId,
  allowInherit,
  inheritLabel = 'Use the role target',
  disabled,
  idPrefix,
}: {
  value: MentionTarget | null;
  onChange: (next: MentionTarget | null) => void;
  guildId: number | null;
  allowInherit?: boolean;
  inheritLabel?: string;
  disabled?: boolean;
  idPrefix: string;
}) {
  const mode: Mode = value ? value.kind : allowInherit ? 'inherit' : 'user';
  const roles = useGuildRoles(mode === 'role' ? guildId : null);

  const setMode = (next: Mode) => {
    if (next === 'inherit') onChange(null);
    else if (next !== mode) onChange({ kind: next, id: '' });
  };

  const radio = (m: Mode, label: string) => (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <input
        type="radio"
        name={`${idPrefix}-mode`}
        checked={mode === m}
        disabled={disabled}
        onChange={() => setMode(m)}
        className="accent-indigo-600"
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4">
        {allowInherit && radio('inherit', inheritLabel)}
        {radio('user', 'Discord user')}
        {radio('role', 'Discord role')}
      </div>
      {mode === 'user' && value && (
        <div>
          <Input
            placeholder="User ID (17–20 digits)"
            value={value.id}
            disabled={disabled}
            onChange={(e) => onChange({ kind: 'user', id: e.target.value.trim() })}
            inputMode="numeric"
          />
          {value.id !== '' && !isSnowflake(value.id) && (
            <p className="mt-1 text-xs text-red-600">
              Must be a Discord user ID (Developer Mode → right-click the person → Copy User ID).
            </p>
          )}
        </div>
      )}
      {mode === 'role' && value && (
        <div>
          {roles.isError || guildId === null ? (
            <Input
              placeholder="Role ID (17–20 digits)"
              value={value.id}
              disabled={disabled}
              onChange={(e) => onChange({ kind: 'role', id: e.target.value.trim() })}
              inputMode="numeric"
            />
          ) : (
            <Select
              value={value.id}
              disabled={disabled || roles.isPending}
              onChange={(e) => onChange({ kind: 'role', id: e.target.value })}
            >
              <option value="">{roles.isPending ? 'Loading roles…' : '— Pick a role —'}</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                  {r.mentionable ? '' : ' (not mentionable)'}
                  {r.managed ? ' (managed)' : ''}
                </option>
              ))}
            </Select>
          )}
          {value.id !== '' && !isSnowflake(value.id) && (
            <p className="mt-1 text-xs text-red-600">Must be a Discord role ID.</p>
          )}
          {value.id !== '' && roles.data?.find((r) => r.id === value.id)?.mentionable === false && (
            <p className="mt-1 text-xs text-amber-700">
              This role is not mentionable. Saving only works if the bot has "Mention @everyone,
              @here, and All Roles" in the target channel.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function mentionTargetIsComplete(value: MentionTarget | null): boolean {
  return value === null || isSnowflake(value.id);
}

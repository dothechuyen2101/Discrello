import { useId, useRef } from 'react';
import {
  TEMPLATE_VARIABLES_BY_KIND,
  TEMPLATE_VARIABLE_DESCRIPTIONS,
  findUnavailableVariables,
  findUnknownVariables,
  templateHasMention,
  type TemplateKind,
} from '@discrello/shared';
import { Textarea } from './ui';

const MAX_LENGTH = 1900;

export function TemplateEditor({
  value,
  onChange,
  id,
  rows = 3,
  disabled,
  label = 'Message template',
  kind = 'move',
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  rows?: number;
  disabled?: boolean;
  label?: string;
  /** Which variables are offered: a card move or a revision comment. */
  kind?: TemplateKind;
}) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const ref = useRef<HTMLTextAreaElement>(null);
  const unknown = findUnknownVariables(value);
  const unavailable = findUnavailableVariables(value, kind);
  const missingMention = value.trim() !== '' && !templateHasMention(value);

  const insert = (name: string) => {
    const el = ref.current;
    const token = `{${name}}`;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={textareaId} className="block text-xs font-semibold text-gray-600 uppercase">
        {label}
      </label>
      <Textarea
        id={textareaId}
        ref={ref}
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_VARIABLES_BY_KIND[kind].map((name) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            title={TEMPLATE_VARIABLE_DESCRIPTIONS[name]}
            onClick={() => insert(name)}
            className="rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
          >
            {`{${name}}`}
          </button>
        ))}
      </div>
      <div className="space-y-0.5 text-xs">
        {unknown.length > 0 && (
          <p className="text-amber-700">
            Unknown variable{unknown.length > 1 ? 's' : ''}:{' '}
            {unknown.map((u) => `{${u}}`).join(', ')} — they will be posted literally.
          </p>
        )}
        {unavailable.length > 0 && (
          <p className="text-amber-700">
            {unavailable.map((u) => `{${u}}`).join(', ')} {unavailable.length > 1 ? 'have' : 'has'}{' '}
            no value in this message and will be empty.
          </p>
        )}
        {missingMention && (
          <p className="text-amber-700">
            The template has no {'{mention}'}, so nobody will be pinged.
          </p>
        )}
        <p className={value.length > MAX_LENGTH ? 'text-red-600' : 'text-gray-400'}>
          {value.length} / {MAX_LENGTH}
        </p>
      </div>
    </div>
  );
}

import { renderTemplate, sampleTemplateVars, type TemplateVars } from '@discrello/shared';

/** Shows the rendered message the way Discord would, with the mention highlighted. */
export function TemplatePreview({
  template,
  vars,
  mentionLabel = '@someone',
}: {
  template: string;
  vars?: TemplateVars;
  mentionLabel?: string;
}) {
  const rendered = renderTemplate(template, sampleTemplateVars({ ...vars, mention: mentionLabel }));
  const parts = mentionLabel ? rendered.split(mentionLabel) : [rendered];
  return (
    <div className="rounded-md bg-[#313338] p-3 text-sm text-gray-100">
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
          D
        </div>
        <div className="min-w-0">
          <div className="text-xs">
            <span className="font-semibold text-white">Discrello</span>{' '}
            <span className="rounded bg-indigo-500 px-1 text-[10px] font-semibold text-white">
              BOT
            </span>
            <span className="ml-2 text-gray-400">Today</span>
          </div>
          <p className="mt-0.5 break-words whitespace-pre-wrap">
            {rendered.trim() === '' ? (
              <span className="text-gray-500 italic">(empty message)</span>
            ) : (
              parts.map((part, i) => (
                <span key={i}>
                  {part}
                  {i < parts.length - 1 && (
                    <span className="rounded bg-indigo-500/40 px-1 font-medium text-indigo-200">
                      {mentionLabel}
                    </span>
                  )}
                </span>
              ))
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

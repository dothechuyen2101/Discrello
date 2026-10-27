import type { TestSendResultDto } from '@discrello/shared';

export function TestSendResult({
  result,
  onDismiss,
}: {
  result: TestSendResultDto | null;
  onDismiss?: () => void;
}) {
  if (!result) return null;
  const ok = result.ok;
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {ok
              ? result.mentionVerified === undefined
                ? 'Test message sent.'
                : 'Test message sent and the mention registered — the target was pinged.'
              : 'Test failed'}
          </p>
          {result.error && <p className="mt-1">{result.error}</p>}
          {result.messageId && (
            <p className="mt-1 text-xs opacity-75">Discord message id {result.messageId}</p>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

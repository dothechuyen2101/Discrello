import { ApiError } from '../api/client';

/** Renders any error, with the 422 { message, hint } shape given the most prominence. */
export function ErrorBanner({
  error,
  onDismiss,
  className = '',
}: {
  error: unknown;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!error) return null;
  let title: string;
  let hint: string | undefined;
  let issues: Array<{ path: string; message: string }> | undefined;
  if (ApiError.is(error)) {
    if (error.isValidationFailed) {
      title = error.message;
      hint = error.hint;
    } else if (error.status === 400 && error.issues) {
      title = 'Invalid input';
      issues = error.issues;
    } else if (error.status === 401) {
      title = 'Login required';
    } else {
      title = error.message;
    }
  } else if (error instanceof Error) {
    title = error.message;
  } else {
    title = String(error);
  }
  return (
    <div
      role="alert"
      className={`rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{title}</p>
          {hint && <p className="mt-1 text-red-700">{hint}</p>}
          {issues && (
            <ul className="mt-1 list-disc pl-5">
              {issues.map((i, idx) => (
                <li key={idx}>
                  {i.path && <span className="font-mono">{i.path}: </span>}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-500 hover:text-red-700"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

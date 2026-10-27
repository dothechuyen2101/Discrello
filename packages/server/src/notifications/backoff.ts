/** Total number of delivery attempts before a notification is marked `failed`. */
export const MAX_ATTEMPTS = 5;

/** Delay before attempt n+1, indexed by n-1 (n = attempts made so far). */
export const BACKOFF_MS: readonly number[] = [5_000, 30_000, 120_000, 600_000, 1_800_000];

/**
 * Given the number of attempts made so far (after the one that just failed), returns the delay
 * before the next attempt, or `null` when the notification should give up.
 */
export function nextAttemptDelayMs(attemptsSoFar: number): number | null {
  if (attemptsSoFar >= MAX_ATTEMPTS) return null;
  return BACKOFF_MS[Math.min(attemptsSoFar, BACKOFF_MS.length) - 1] ?? null;
}

/** A `sending` row older than this is considered orphaned by a crash and is re-queued. */
export const STALE_SENDING_MS = 2 * 60_000;

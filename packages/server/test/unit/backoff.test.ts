import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, nextAttemptDelayMs } from '../../src/notifications/backoff';

describe('backoff', () => {
  it('escalates and then gives up', () => {
    expect(nextAttemptDelayMs(1)).toBe(5_000);
    expect(nextAttemptDelayMs(2)).toBe(30_000);
    expect(nextAttemptDelayMs(3)).toBe(120_000);
    expect(nextAttemptDelayMs(4)).toBe(600_000);
    expect(nextAttemptDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(nextAttemptDelayMs(MAX_ATTEMPTS + 3)).toBeNull();
  });
});

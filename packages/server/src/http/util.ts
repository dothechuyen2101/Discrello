import type { z } from 'zod';

/** Parses with a zod schema; a ZodError propagates to the error handler as HTTP 400. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  return schema.parse(value);
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

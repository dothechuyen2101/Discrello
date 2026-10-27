import { z } from 'zod';

export const snowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, 'Must be a Discord ID (17–20 digits)');

export const mentionKindSchema = z.enum(['user', 'role']);

export const mentionTargetSchema = z.object({
  kind: mentionKindSchema,
  id: snowflakeSchema,
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const templateSchema = z.string().trim().min(1, 'Template is required').max(1900);

import { z } from 'zod';
import { snowflakeSchema } from './common';

export const boardPreviewSchema = z.object({
  ref: z.string().trim().min(1),
});
export type BoardPreviewInput = z.infer<typeof boardPreviewSchema>;

export const boardCreateSchema = z.object({
  ref: z.string().trim().min(1),
  guildId: z.number().int().positive(),
  discordChannelId: snowflakeSchema,
});
export type BoardCreateInput = z.infer<typeof boardCreateSchema>;

export const boardPatchSchema = z.object({
  discordChannelId: snowflakeSchema.optional(),
  enabled: z.boolean().optional(),
});
export type BoardPatchInput = z.infer<typeof boardPatchSchema>;

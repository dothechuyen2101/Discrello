import { z } from 'zod';
import { snowflakeSchema } from './common';

export const guildCreateSchema = z.object({
  discordGuildId: snowflakeSchema,
  alertChannelId: snowflakeSchema.nullable().optional(),
});
export type GuildCreateInput = z.infer<typeof guildCreateSchema>;

export const guildPatchSchema = z.object({
  alertChannelId: snowflakeSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type GuildPatchInput = z.infer<typeof guildPatchSchema>;

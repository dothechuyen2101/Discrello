import { z } from 'zod';
import { mentionTargetSchema, snowflakeSchema, templateSchema } from './common';

export const roleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,50}$/, 'Key must be lowercase letters, digits or underscores');

export const roleCreateSchema = z.object({
  key: roleKeySchema,
  displayName: z.string().trim().min(1).max(100),
  defaultTemplate: templateSchema.nullable().optional(),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const rolePatchSchema = roleCreateSchema.partial();
export type RolePatchInput = z.infer<typeof rolePatchSchema>;

export const roleTargetPutSchema = mentionTargetSchema;
export type RoleTargetPutInput = z.infer<typeof roleTargetPutSchema>;

export const roleTargetTestSchema = z.object({
  channelId: snowflakeSchema,
});
export type RoleTargetTestInput = z.infer<typeof roleTargetTestSchema>;

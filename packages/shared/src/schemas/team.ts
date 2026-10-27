import { z } from 'zod';

const teamNameSchema = z.string().trim().min(1, 'Name is required').max(100);
const roleIdSchema = z.number().int().positive();

/** null = "No channel". */
const channelIdSchema = z.number().int().positive().nullable();

export const teamCreateSchema = z.object({
  name: teamNameSchema,
  /** Roles (people) to put in the team straight away. */
  memberRoleIds: z.array(roleIdSchema).max(100).optional().default([]),
  channelId: channelIdSchema.optional().default(null),
});
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

/** Rename, move to another channel, or both. */
export const teamPatchSchema = z
  .object({
    name: teamNameSchema.optional(),
    channelId: channelIdSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.channelId !== undefined, {
    message: 'Nothing to change',
  });
export type TeamPatchInput = z.infer<typeof teamPatchSchema>;

export const teamChannelSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});
export type TeamChannelInput = z.infer<typeof teamChannelSchema>;

export const teamMemberParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  roleId: z.coerce.number().int().positive(),
});

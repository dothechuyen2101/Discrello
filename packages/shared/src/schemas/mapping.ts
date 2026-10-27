import { z } from 'zod';
import { mentionTargetSchema, snowflakeSchema, templateSchema } from './common';

/** A list pings either one role (its target in the board's server) or every member of a team. */
export const mappingPutSchema = z
  .object({
    roleId: z.number().int().positive().nullable().optional(),
    teamId: z.number().int().positive().nullable().optional(),
    messageTemplate: templateSchema,
    /** null or omitted = use the global default comment template. */
    commentTemplate: templateSchema.nullable().optional(),
    /** Who revision comments ping; both null/omitted = the list's own recipient. */
    feedbackRoleId: z.number().int().positive().nullable().optional(),
    feedbackTeamId: z.number().int().positive().nullable().optional(),
    overrideMention: mentionTargetSchema.nullable().optional(),
    overrideChannelId: snowflakeSchema.nullable().optional(),
    enabled: z.boolean().optional().default(true),
  })
  .refine((m) => Boolean(m.roleId) !== Boolean(m.teamId), {
    message: 'Pick either a role or a team',
    path: ['roleId'],
  })
  .refine((m) => !(m.feedbackRoleId && m.feedbackTeamId), {
    message: 'Feedback goes to one role or one team, not both',
    path: ['feedbackRoleId'],
  });
export type MappingPutInput = z.infer<typeof mappingPutSchema>;

export const trelloListIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  trelloListId: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid Trello list id'),
});

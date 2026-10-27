import { z } from 'zod';
import { templateSchema } from './common';

/** Each field is optional so the Settings page can save one template without the other. */
export const settingsPutSchema = z
  .object({
    defaultTemplate: templateSchema.optional(),
    defaultCommentTemplate: templateSchema.optional(),
  })
  .refine((v) => v.defaultTemplate !== undefined || v.defaultCommentTemplate !== undefined, {
    message: 'Nothing to save',
  });
export type SettingsPutInput = z.infer<typeof settingsPutSchema>;

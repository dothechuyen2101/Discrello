import { eq } from 'drizzle-orm';
import { DEFAULT_COMMENT_TEMPLATE, DEFAULT_GLOBAL_TEMPLATE } from '@discrello/shared';
import type { Queryable } from '../types';
import { settings } from '../schema';

export const SETTING_DEFAULT_TEMPLATE = 'default_template';
export const SETTING_DEFAULT_COMMENT_TEMPLATE = 'default_comment_template';

export async function getSetting(db: Queryable, key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Queryable, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getDefaultTemplate(db: Queryable): Promise<string> {
  return (await getSetting(db, SETTING_DEFAULT_TEMPLATE)) ?? DEFAULT_GLOBAL_TEMPLATE;
}

export async function getDefaultCommentTemplate(db: Queryable): Promise<string> {
  return (await getSetting(db, SETTING_DEFAULT_COMMENT_TEMPLATE)) ?? DEFAULT_COMMENT_TEMPLATE;
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  /** Applies pending SQL migrations from the drizzle/ folder. */
  migrate(): Promise<void>;
  /** Cheap connectivity check used by /api/health. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Walks up from this module to find the committed migrations folder (works from src/ and dist/). */
export function findMigrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle/ migrations folder');
}

/**
 * Opens the database. `postgres://` / `postgresql://` URLs use the postgres-js driver
 * (Supabase). `pglite://memory` or `pglite://<dir>` runs an embedded Postgres — used by the
 * test-suite and for local experiments only.
 */
export async function openDb(url: string): Promise<DbHandle> {
  if (url.startsWith('pglite:')) return openPglite(url);
  return openPostgres(url);
}

async function openPglite(url: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const target = url.replace(/^pglite:\/\/?/, '');
  const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder: findMigrationsDir() }),
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.close(),
  };
}

async function openPostgres(url: string): Promise<DbHandle> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const client = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder: findMigrationsDir() }),
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.end({ timeout: 5 }),
  };
}

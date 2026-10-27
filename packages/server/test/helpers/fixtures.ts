import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function trelloFixtureRaw(name: string): string {
  return readFileSync(path.join(here, '..', 'fixtures', 'trello', `${name}.json`), 'utf8');
}

export function trelloFixture<T = unknown>(name: string): T {
  return JSON.parse(trelloFixtureRaw(name)) as T;
}

/** Same content as the file but serialized once, so the raw body and the object agree. */
export function trelloFixtureBody(name: string, mutate?: (doc: any) => void): string {
  const doc = trelloFixture<any>(name);
  mutate?.(doc);
  return JSON.stringify(doc);
}

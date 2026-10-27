import { and, eq } from 'drizzle-orm';
import type { Queryable } from '../types';
import { boards, guilds, listMappings, type Board, type Guild, type ListMapping } from '../schema';
import { loadRecipient, type Recipient } from './recipients';

export async function findBoardByToken(
  db: Queryable,
  token: string,
): Promise<{ board: Board; guild: Guild } | null> {
  const rows = await db
    .select({ board: boards, guild: guilds })
    .from(boards)
    .innerJoin(guilds, eq(guilds.id, boards.guildId))
    .where(eq(boards.webhookToken, token))
    .limit(1);
  return rows[0] ?? null;
}

/** The mapping of a list and who it pings (a role, or a team with its members). */
export async function findMappingForList(
  db: Queryable,
  boardId: number,
  trelloListId: string,
): Promise<{ mapping: ListMapping; recipient: Recipient | null } | null> {
  const rows = await db
    .select()
    .from(listMappings)
    .where(and(eq(listMappings.boardId, boardId), eq(listMappings.trelloListId, trelloListId)))
    .limit(1);
  const mapping = rows[0];
  if (!mapping) return null;
  return { mapping, recipient: await loadRecipient(db, mapping) };
}

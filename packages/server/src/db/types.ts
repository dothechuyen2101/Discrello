import type { Db } from './client';

/** Either the root database or a transaction handle — both expose the query builders. */
export type Queryable = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'query'>;

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

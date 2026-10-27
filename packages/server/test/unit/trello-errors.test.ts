import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { BoardService } from '../../src/boards/service';
import type { Db } from '../../src/db/client';
import type { DiscordClient } from '../../src/discord/client';
import type { MentionValidator } from '../../src/discord/validate';
import { ValidationFailedError } from '../../src/errors';
import { TrelloApiError } from '../../src/trello/client';
import { FakeTrelloClient } from '../../src/trello/fake';

/** Trello's real answers (checked against api.trello.com) for bad credentials. */
function serviceWhoseTrelloAnswers(status: number, body: string) {
  const trello = new FakeTrelloClient();
  trello.getBoard = async () => {
    throw new TrelloApiError(status, body, 'Fetching the Trello board');
  };
  return new BoardService({
    db: {} as Db,
    trello,
    discord: {} as DiscordClient,
    validator: {} as MentionValidator,
    clock: () => new Date(),
    publicBaseUrl: 'https://example.test',
    logger: Fastify().log,
  });
}

async function codeOf(status: number, body: string): Promise<string> {
  const err = await serviceWhoseTrelloAnswers(status, body)
    .preview('AbCd1234')
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationFailedError);
  return (err as ValidationFailedError).validationCode;
}

describe('Trello error explanations', () => {
  it('tells which credential Trello rejected', async () => {
    expect(await codeOf(401, 'invalid key')).toBe('TRELLO_KEY_INVALID');
    expect(await codeOf(401, 'invalid app token')).toBe('TRELLO_TOKEN_INVALID');
    expect(await codeOf(401, 'expired token')).toBe('TRELLO_TOKEN_INVALID');
  });

  it('separates "no access to this board" from "no such board"', async () => {
    expect(await codeOf(401, 'unauthorized permission requested')).toBe('TRELLO_BOARD_NO_ACCESS');
    expect(await codeOf(404, 'Board not found')).toBe('TRELLO_BOARD_NOT_FOUND');
    expect(await codeOf(404, 'The requested resource was not found.')).toBe(
      'TRELLO_BOARD_NOT_FOUND',
    );
    expect(await codeOf(400, 'invalid id')).toBe('TRELLO_BOARD_NOT_FOUND');
  });

  it('passes other Trello failures through unchanged', async () => {
    const err = await serviceWhoseTrelloAnswers(503, 'down')
      .preview('AbCd1234')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrelloApiError);
  });
});

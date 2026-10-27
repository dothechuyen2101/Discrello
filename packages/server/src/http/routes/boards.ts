import type { FastifyInstance } from 'fastify';
import {
  boardCreateSchema,
  boardPatchSchema,
  boardPreviewSchema,
  idParamSchema,
  mappingPutSchema,
  trelloListIdParamSchema,
} from '@discrello/shared';
import type { BoardService } from '../../boards/service';
import { parse } from '../util';

export async function boardRoutes(app: FastifyInstance, opts: { boards: BoardService }) {
  const { boards } = opts;
  app.get('/api/boards', async () => boards.list());
  app.post('/api/trello/boards/preview', async (req) =>
    boards.preview(parse(boardPreviewSchema, req.body).ref),
  );
  app.post('/api/boards', async (req, reply) => {
    const dto = await boards.add(parse(boardCreateSchema, req.body));
    return reply.code(201).send(dto);
  });
  app.get('/api/boards/:id', async (req) => boards.detail(parse(idParamSchema, req.params).id));
  app.patch('/api/boards/:id', async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return boards.patch(id, parse(boardPatchSchema, req.body));
  });
  app.delete('/api/boards/:id', async (req, reply) => {
    await boards.remove(parse(idParamSchema, req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/boards/:id/sync-lists', async (req) =>
    boards.syncLists(parse(idParamSchema, req.params).id),
  );
  app.post('/api/boards/:id/webhook/check', async (req) =>
    boards.checkWebhook(parse(idParamSchema, req.params).id),
  );
  app.post('/api/boards/:id/webhook/register', async (req) =>
    boards.registerWebhook(parse(idParamSchema, req.params).id),
  );
  app.put('/api/boards/:id/mappings/:trelloListId', async (req) => {
    const { id, trelloListId } = parse(trelloListIdParamSchema, req.params);
    return boards.upsertMapping(id, trelloListId, parse(mappingPutSchema, req.body));
  });
  app.delete('/api/boards/:id/mappings/:trelloListId', async (req, reply) => {
    const { id, trelloListId } = parse(trelloListIdParamSchema, req.params);
    await boards.deleteMapping(id, trelloListId);
    return reply.code(204).send();
  });
  app.post('/api/boards/:id/mappings/:trelloListId/test', async (req) => {
    const { id, trelloListId } = parse(trelloListIdParamSchema, req.params);
    return boards.testMapping(id, trelloListId);
  });
}

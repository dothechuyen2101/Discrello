import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  idParamSchema,
  roleCreateSchema,
  rolePatchSchema,
  roleTargetPutSchema,
  roleTargetTestSchema,
} from '@discrello/shared';
import type { RoleService } from '../../roles/service';
import { parse } from '../util';

const targetParams = z.object({
  id: z.coerce.number().int().positive(),
  guildId: z.coerce.number().int().positive(),
});

export async function roleRoutes(app: FastifyInstance, opts: { roles: RoleService }) {
  const { roles } = opts;
  app.get('/api/roles', async () => roles.list());
  app.post('/api/roles', async (req, reply) => {
    const dto = await roles.create(parse(roleCreateSchema, req.body));
    return reply.code(201).send(dto);
  });
  app.put('/api/roles/:id', async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return roles.update(id, parse(rolePatchSchema, req.body));
  });
  app.delete('/api/roles/:id', async (req, reply) => {
    await roles.remove(parse(idParamSchema, req.params).id);
    return reply.code(204).send();
  });
  app.put('/api/roles/:id/targets/:guildId', async (req) => {
    const { id, guildId } = parse(targetParams, req.params);
    return roles.putTarget(id, guildId, parse(roleTargetPutSchema, req.body));
  });
  app.delete('/api/roles/:id/targets/:guildId', async (req) => {
    const { id, guildId } = parse(targetParams, req.params);
    return roles.deleteTarget(id, guildId);
  });
  app.post('/api/roles/:id/targets/:guildId/test', async (req) => {
    const { id, guildId } = parse(targetParams, req.params);
    const { channelId } = parse(roleTargetTestSchema, req.body);
    return roles.testTarget(id, guildId, channelId);
  });
}

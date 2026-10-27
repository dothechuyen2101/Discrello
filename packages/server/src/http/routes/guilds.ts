import type { FastifyInstance } from 'fastify';
import { guildCreateSchema, guildPatchSchema, idParamSchema } from '@discrello/shared';
import type { GuildService } from '../../guilds/service';
import { parse } from '../util';

export async function guildRoutes(app: FastifyInstance, opts: { guilds: GuildService }) {
  const { guilds } = opts;
  app.get('/api/discord/bot-guilds', async () => guilds.botGuilds());
  app.get('/api/guilds', async () => guilds.list());
  app.post('/api/guilds', async (req, reply) => {
    const dto = await guilds.add(parse(guildCreateSchema, req.body));
    return reply.code(201).send(dto);
  });
  app.patch('/api/guilds/:id', async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return guilds.patch(id, parse(guildPatchSchema, req.body));
  });
  app.delete('/api/guilds/:id', async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    await guilds.remove(id);
    return reply.code(204).send();
  });
  app.post('/api/guilds/:id/check', async (req) =>
    guilds.check(parse(idParamSchema, req.params).id),
  );
  app.get('/api/guilds/:id/channels', async (req) =>
    guilds.channels(parse(idParamSchema, req.params).id),
  );
  app.get('/api/guilds/:id/roles', async (req) =>
    guilds.roles(parse(idParamSchema, req.params).id),
  );
}

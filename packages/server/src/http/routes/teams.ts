import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  teamChannelSchema,
  teamCreateSchema,
  teamMemberParamSchema,
  teamPatchSchema,
} from '@discrello/shared';
import type { TeamService } from '../../teams/service';
import { parse } from '../util';

export async function teamRoutes(app: FastifyInstance, opts: { teams: TeamService }) {
  const { teams } = opts;
  app.get('/api/teams', async () => teams.list());
  app.post('/api/teams', async (req, reply) => {
    const dto = await teams.create(parse(teamCreateSchema, req.body));
    return reply.code(201).send(dto);
  });
  app.put('/api/teams/:id', async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return teams.update(id, parse(teamPatchSchema, req.body));
  });
  app.delete('/api/teams/:id', async (req, reply) => {
    await teams.remove(parse(idParamSchema, req.params).id);
    return reply.code(204).send();
  });
  app.get('/api/team-channels', async () => teams.listChannels());
  app.post('/api/team-channels', async (req, reply) => {
    const dto = await teams.createChannel(parse(teamChannelSchema, req.body));
    return reply.code(201).send(dto);
  });
  app.put('/api/team-channels/:id', async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return teams.renameChannel(id, parse(teamChannelSchema, req.body));
  });
  app.delete('/api/team-channels/:id', async (req, reply) => {
    await teams.removeChannel(parse(idParamSchema, req.params).id);
    return reply.code(204).send();
  });
  app.put('/api/teams/:id/members/:roleId', async (req) => {
    const { id, roleId } = parse(teamMemberParamSchema, req.params);
    return teams.addMember(id, roleId);
  });
  app.delete('/api/teams/:id/members/:roleId', async (req) => {
    const { id, roleId } = parse(teamMemberParamSchema, req.params);
    return teams.removeMember(id, roleId);
  });
}

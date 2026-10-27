import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from './helpers/app';

describe('health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await makeTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns ok when the database answers', async () => {
    const res = await ctx.app.fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

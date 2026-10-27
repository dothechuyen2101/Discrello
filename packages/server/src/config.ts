import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((s) => s.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1),
  TRELLO_API_KEY: z.string().min(1),
  TRELLO_API_TOKEN: z.string().min(1),
  TRELLO_API_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  WEB_DIST: z.string().optional(),
  // Number of reverse proxies in front of the app whose X-Forwarded-For entry is trusted.
  // 1 = nginx (or a tunnel). Trusting every hop would let clients spoof their IP and bypass
  // the per-IP rate limits. 0 = no proxy, use the socket address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

import * as z from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4010),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, { error: 'Use at least 32 characters' }),
  JWT_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, { error: 'Use a number and a unit: s, m, h or d' })
    .default('12h'),
  ENABLE_RESET: z.stringbool().default(false),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
  SEED: z.coerce.number().int().default(42),
});

export type Env = z.infer<typeof envSchema>;

/** Injection token of the validated environment: `@Inject(ENV) env: Env`. */
export const ENV = Symbol('ENV');

/** Validates the environment once at startup; a bad value stops the process with every problem listed. */
export const parseEnv = (source: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment:\n${problems.join('\n')}`);
};

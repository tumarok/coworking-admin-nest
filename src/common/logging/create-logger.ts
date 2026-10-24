import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import type { Env } from '../../config/env.js';

const LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/** Logs one JSON object per line in production and enables every level up to `LOG_LEVEL`. */
export const createLogger = (env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): ConsoleLogger =>
  new ConsoleLogger({
    json: env.NODE_ENV === 'production',
    logLevels: LEVELS.slice(0, LEVELS.indexOf(env.LOG_LEVEL) + 1),
  });

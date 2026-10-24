import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { createLogger } from './common/logging/create-logger.js';
import { ENV, type Env } from './config/env.js';
import { configureApp, createHttpAdapter } from './configure-app.js';

// Variables already in the environment win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

const app = await NestFactory.create<NestExpressApplication>(AppModule, createHttpAdapter(), {
  bodyParser: false,
  bufferLogs: true,
  abortOnError: false,
});
const env = app.get<Env>(ENV);

app.useLogger(createLogger(env));
configureApp(app);
app.enableShutdownHooks();

await app.listen(env.PORT);

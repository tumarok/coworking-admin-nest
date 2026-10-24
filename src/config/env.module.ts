import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv } from './env.js';

/** Validates `process.env` when the application is created, so a bad value stops the start. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class EnvModule {}

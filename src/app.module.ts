import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock/clock.module.js';
import { EnvModule } from './config/env.module.js';

@Module({ imports: [EnvModule, ClockModule] })
export class AppModule {}

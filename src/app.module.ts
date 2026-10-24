import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock/clock.module.js';
import { EnvModule } from './config/env.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({ imports: [EnvModule, ClockModule, DatabaseModule, HealthModule] })
export class AppModule {}

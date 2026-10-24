import { Module } from '@nestjs/common';
import { ApiModule } from './api.module.js';
import { AuthCoreModule } from './common/auth/auth-core.module.js';
import { ClockModule } from './common/clock/clock.module.js';
import { EnvModule } from './config/env.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [EnvModule, ClockModule, DatabaseModule, AuthCoreModule, HealthModule, ApiModule],
})
export class AppModule {}

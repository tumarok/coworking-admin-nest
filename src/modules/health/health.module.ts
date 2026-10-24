import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthRepository } from './health.repository.js';
import { HealthService } from './health.service.js';

/** `GET /health` lives outside the API prefix: orchestrators probe it, clients never call it. */
@Module({
  controllers: [HealthController],
  providers: [HealthService, HealthRepository],
})
export class HealthModule {}

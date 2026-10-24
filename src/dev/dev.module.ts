import { Module } from '@nestjs/common';
import { ResetController } from './reset.controller.js';
import { ResetEnabledGuard } from './reset-enabled.guard.js';
import { ResetService } from './reset.service.js';

@Module({
  controllers: [ResetController],
  providers: [ResetService, ResetEnabledGuard],
})
export class DevModule {}

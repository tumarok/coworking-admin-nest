import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';
import { ResetEnabledGuard } from './reset-enabled.guard.js';
import { ResetService } from './reset.service.js';

/** For e2e runs and demos: puts the data back to the seed. Public, as in the mock API. */
@Public()
@UseGuards(ResetEnabledGuard)
@Controller('__reset')
export class ResetController {
  constructor(private readonly resets: ResetService) {}

  @Post()
  @HttpCode(204)
  async reset(): Promise<void> {
    await this.resets.reset();
  }
}

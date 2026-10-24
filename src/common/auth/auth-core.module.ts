import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { TokenService } from './token.service.js';

/** The token service and the global guard. Import it once in the application module. */
@Module({
  providers: [TokenService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenService],
})
export class AuthCoreModule {}

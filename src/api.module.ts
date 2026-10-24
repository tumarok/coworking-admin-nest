import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { API_PREFIX } from './common/http/api-prefix.js';
import { DevModule } from './dev/dev.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

// Every module with routes below the API prefix. A new feature module is added here.
const apiModules = [AuthModule, DevModule];

@Module({
  imports: [...apiModules, RouterModule.register([{ path: API_PREFIX, children: apiModules }])],
})
export class ApiModule {}

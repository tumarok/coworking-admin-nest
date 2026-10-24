import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { API_PREFIX } from '../../src/common/http/api-prefix.js';
import { ProbeController } from './probe.controller.js';

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/** The probe routes, mounted below the API prefix like a feature module. */
export const probeImports = [
  ProbeModule,
  RouterModule.register([{ path: API_PREFIX, module: ProbeModule }]),
];

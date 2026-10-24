import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { API_PREFIX } from './common/http/api-prefix.js';
import { DevModule } from './dev/dev.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';

// Every module with routes below the API prefix. A new feature module is added here.
const apiModules = [
  AuthModule,
  LocationsModule,
  RoomsModule,
  MembersModule,
  BookingsModule,
  DashboardModule,
  DevModule,
];

@Module({
  imports: [...apiModules, RouterModule.register([{ path: API_PREFIX, children: apiModules }])],
})
export class ApiModule {}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiRoute } from '../../common/openapi/api-route.js';
import { type Dashboard, dashboardQuerySchema, dashboardSchema } from '../../contract/index.js';
import { DashboardService } from './dashboard.service.js';
import type { DashboardParams } from './dashboard.types.js';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiRoute({
    summary: 'Figures of a day (today by default), the month revenue and the next bookings',
    success: { status: 200, schema: dashboardSchema },
    failures: [422],
  })
  get(@Query({ schema: dashboardQuerySchema }) query: DashboardParams): Promise<Dashboard> {
    return this.dashboard.get(query);
  }
}

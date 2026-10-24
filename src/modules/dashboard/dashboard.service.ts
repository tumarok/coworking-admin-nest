import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import type { Dashboard } from '../../contract/index.js';
import { DashboardRepository } from './dashboard.repository.js';
import type { DashboardParams } from './dashboard.types.js';
import { bookingsToday, byStatus, occupancyOf, occupancyRate } from './domain/formulas.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly clock: Clock,
  ) {}

  /** The day defaults to today's date of the clock, UTC; the upcoming bookings always run from the clock. */
  async get({ date }: DashboardParams): Promise<Dashboard> {
    const now = this.clock.now();
    const day = date ?? now.toISOString().slice(0, 10);
    const data = await this.repository.read(day, now);

    const occupancy = occupancyOf(data.locations, data.live);
    const statuses = byStatus(data.statuses);
    return {
      date: day,
      kpis: {
        bookingsToday: bookingsToday(statuses),
        occupancyRate: occupancyRate(occupancy),
        revenueMonth: data.revenueMonth,
        activeMembers: data.activeMembers,
      },
      occupancy,
      byStatus: statuses,
      upcoming: data.upcoming,
    };
  }
}

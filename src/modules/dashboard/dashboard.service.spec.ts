import { Clock } from '../../common/clock/clock.js';
import type { DashboardData, DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

const NOW = new Date('2026-10-14T23:30:00.000Z');
const data: DashboardData = {
  locations: [],
  live: [],
  statuses: [],
  revenueMonth: 0,
  activeMembers: 0,
  upcoming: [],
};

class FixedClock extends Clock {
  now(): Date {
    return NOW;
  }
}

describe('DashboardService', () => {
  const read = vi.fn<DashboardRepository['read']>();
  const service = new DashboardService(
    { read } as unknown as DashboardRepository,
    new FixedClock(),
  );

  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue(data);
  });

  it('shows the day of the clock, in UTC, when the request names none', async () => {
    const dashboard = await service.get({});

    expect(dashboard.date).toBe('2026-10-14');
    expect(read).toHaveBeenCalledWith('2026-10-14', NOW);
  });

  it('shows the day asked for, and still lists the bookings upcoming from the clock', async () => {
    const dashboard = await service.get({ date: '2027-01-02' });

    expect(dashboard.date).toBe('2027-01-02');
    expect(read).toHaveBeenCalledWith('2027-01-02', NOW);
  });

  it('has no occupancy and a rate of 0 when no location is open', async () => {
    const dashboard = await service.get({});

    expect(dashboard.occupancy).toEqual([]);
    expect(dashboard.kpis.occupancyRate).toBe(0);
  });
});

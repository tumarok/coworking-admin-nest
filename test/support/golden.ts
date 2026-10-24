import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Dashboard } from '../../src/contract/index.js';

export interface SeedGolden {
  seed: number;
  now: string;
  sequence: number;
  counts: Record<'users' | 'locations' | 'rooms' | 'members' | 'bookings', number>;
  roomsByLocation: Record<string, number>;
  roomsByStatus: Record<string, number>;
  membersByStatus: Record<string, number>;
  bookingsByStatus: Record<string, number>;
  sha256: Record<'users' | 'locations' | 'rooms' | 'members' | 'bookings', string>;
}

/** Reads `test/fixtures/golden/seed.json`: data recorded from the mock API, never edited by hand. */
export const loadSeedGolden = (): SeedGolden =>
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'golden', 'seed.json'), 'utf8'),
  ) as SeedGolden;

export interface DashboardGolden {
  seed: number;
  now: string;
  /** The answer for every recorded day, by date. */
  days: Record<string, Dashboard>;
  /** The answer without a date, and with an empty one. */
  default: Dashboard;
  emptyDate: Dashboard;
  /** The status and body for dates the mock refuses. */
  errors: Record<string, { status: number; body: unknown }>;
}

/** Reads `test/fixtures/golden/dashboard.json`: data recorded from the mock API, never edited by hand. */
export const loadDashboardGolden = (): DashboardGolden =>
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, '..', 'fixtures', 'golden', 'dashboard.json'),
      'utf8',
    ),
  ) as DashboardGolden;

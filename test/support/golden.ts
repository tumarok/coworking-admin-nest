import { readFileSync } from 'node:fs';
import path from 'node:path';

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

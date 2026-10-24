import { generateSeed } from '../src/database/seed/generate-seed.js';
import { SEED, SEED_NOW } from './support/constants.js';
import { canonicalDigest } from './support/digest.js';
import { loadSeedGolden } from './support/golden.js';

const golden = loadSeedGolden();

const countBy = <T>(rows: T[], key: (row: T) => string) => {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
};

describe('seed generator', () => {
  const data = generateSeed({ seed: SEED, now: SEED_NOW });

  it('is recorded from the same seed and instant as the mock', () => {
    expect(golden.seed).toBe(SEED);
    expect(golden.now).toBe(SEED_NOW.toISOString());
  });

  it('produces the mock data counts', () => {
    expect({
      users: data.users.length,
      locations: data.locations.length,
      rooms: data.rooms.length,
      members: data.members.length,
      bookings: data.bookings.length,
    }).toEqual(golden.counts);
    expect(data.sequence).toBe(golden.sequence);
    expect(countBy(data.rooms, (r) => r.locationId)).toEqual(golden.roomsByLocation);
    expect(countBy(data.rooms, (r) => r.status)).toEqual(golden.roomsByStatus);
    expect(countBy(data.members, (m) => m.status)).toEqual(golden.membersByStatus);
    expect(countBy(data.bookings, (b) => b.status)).toEqual(golden.bookingsByStatus);
  });

  it('produces the mock records, value for value', () => {
    expect({
      users: canonicalDigest(data.users),
      locations: canonicalDigest(data.locations),
      rooms: canonicalDigest(data.rooms),
      members: canonicalDigest(data.members),
      bookings: canonicalDigest(data.bookings),
    }).toEqual(golden.sha256);
  });

  it('is repeatable and depends on the instant', () => {
    const again = generateSeed({ seed: SEED, now: SEED_NOW });
    const later = generateSeed({ seed: SEED, now: new Date(SEED_NOW.getTime() + 60 * 60_000) });

    expect(canonicalDigest(again.bookings)).toBe(golden.sha256.bookings);
    expect(canonicalDigest(later.bookings)).not.toBe(golden.sha256.bookings);
  });

  it('numbers ids from one counter, in generation order', () => {
    expect(data.locations.map((l) => l.id)).toEqual(['loc_1', 'loc_2', 'loc_3', 'loc_4', 'loc_5']);
    expect(data.rooms[0]?.id).toBe('room_6');
    expect(data.members[0]?.id).toBe('mem_12');
    expect(data.bookings[0]?.id).toBe('bk_3a');
    expect(data.bookings.at(-1)?.id).toBe('bk_137');
  });

  it('never overlaps the bookings of a room', () => {
    const lastEnd = new Map<string, string>();
    const sorted = data.bookings.toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const booking of sorted) {
      expect(booking.startsAt >= (lastEnd.get(booking.roomId) ?? '')).toBe(true);
      lastEnd.set(booking.roomId, booking.endsAt);
    }
  });
});

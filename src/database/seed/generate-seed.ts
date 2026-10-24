import { faker } from '@faker-js/faker';
import { formatId, type IdPrefix } from '../../common/ids/ids.js';
import {
  AMENITIES,
  type Amenity,
  type Booking,
  type BookingStatus,
  type Location,
  type Member,
  type Room,
  type RoomType,
  type User,
} from '../../contract/index.js';

export type LocationRecord = Omit<Location, 'roomCount'>;
export type RoomRecord = Omit<Room, 'locationName'>;
export type BookingRecord = Omit<
  Booking,
  'roomName' | 'locationId' | 'locationName' | 'memberName'
>;

export interface SeedData {
  users: User[];
  locations: LocationRecord[];
  rooms: RoomRecord[];
  members: Member[];
  bookings: BookingRecord[];
  /** The last value of the shared id counter; the next new entity gets this plus one. */
  sequence: number;
}

export interface SeedOptions {
  seed: number;
  /** The reference point for "today"; bookings are generated around it. */
  now: Date;
}

export const DEMO_PASSWORD = 'demo1234';

const USERS: User[] = [
  { id: 'usr_admin', name: 'Alex Morgan', email: 'admin@coworking.test', role: 'admin' },
  { id: 'usr_manager', name: 'Sam Rivera', email: 'manager@coworking.test', role: 'manager' },
];

const LOCATIONS: Omit<LocationRecord, 'id'>[] = [
  {
    name: 'Riverside Hub',
    city: 'Kyiv',
    address: '12 Naberezhna St',
    timezone: 'Europe/Kyiv',
    opensAt: '08:00',
    closesAt: '21:00',
    status: 'active',
  },
  {
    name: 'Market Square Loft',
    city: 'Lviv',
    address: '3 Rynok Sq',
    timezone: 'Europe/Kyiv',
    opensAt: '08:00',
    closesAt: '20:00',
    status: 'active',
  },
  {
    name: 'Old Mill Works',
    city: 'Kraków',
    address: '41 Józefa St',
    timezone: 'Europe/Warsaw',
    opensAt: '07:30',
    closesAt: '20:00',
    status: 'active',
  },
  {
    name: 'Canal Yard',
    city: 'Berlin',
    address: '8 Ufer Str.',
    timezone: 'Europe/Berlin',
    opensAt: '08:00',
    closesAt: '22:00',
    status: 'active',
  },
  {
    name: 'Harbour Studio',
    city: 'Lisbon',
    address: '27 Rua do Cais',
    timezone: 'Europe/Lisbon',
    opensAt: '09:00',
    closesAt: '19:00',
    status: 'inactive',
  },
];

const ROOM_NAMES = [
  'Aurora',
  'Birch',
  'Cedar',
  'Delta',
  'Ember',
  'Fjord',
  'Granite',
  'Harbor',
  'Iris',
  'Juniper',
  'Kestrel',
  'Lumen',
];

const ROOM_PROFILE: Record<RoomType, { capacity: [number, number]; rate: [number, number] }> = {
  meeting_room: { capacity: [4, 12], rate: [1500, 4000] },
  private_office: { capacity: [2, 8], rate: [2000, 5000] },
  hot_desk: { capacity: [10, 40], rate: [500, 1200] },
  event_space: { capacity: [30, 120], rate: [8000, 20000] },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const startOfUtcDay = (ms: number) => ms - (ms % DAY);

/**
 * Deterministic demo data: the same seed and instant always produce the same records.
 *
 * This is a line-by-line port of the mock API's generator, and the order of the faker calls is part
 * of the result: reorder or add one and every value after it changes. A booking that is under way
 * is `checked_in` without a faker call, so the data depends on the exact instant, not only the day.
 */
export const generateSeed = ({ seed, now }: SeedOptions): SeedData => {
  const nowMs = now.getTime();
  faker.seed(seed);
  const data: SeedData = {
    users: USERS.map((user) => ({ ...user })),
    locations: [],
    rooms: [],
    members: [],
    bookings: [],
    sequence: 0,
  };
  const nextId = (prefix: IdPrefix) => formatId(prefix, ++data.sequence);

  for (const location of LOCATIONS) {
    data.locations.push({ id: nextId('loc'), ...location });
  }

  for (const location of data.locations) {
    const names = faker.helpers.shuffle(ROOM_NAMES).slice(0, faker.number.int({ min: 4, max: 7 }));
    names.forEach((name, i) => {
      const type: RoomType =
        i === 0
          ? 'hot_desk'
          : faker.helpers.arrayElement(['meeting_room', 'private_office', 'event_space'] as const);
      const profile = ROOM_PROFILE[type];
      data.rooms.push({
        id: nextId('room'),
        locationId: location.id,
        name,
        type,
        capacity: faker.number.int({ min: profile.capacity[0], max: profile.capacity[1] }),
        hourlyRate: faker.number.int({
          min: profile.rate[0],
          max: profile.rate[1],
          multipleOf: 50,
        }),
        amenities: faker.helpers.arrayElements<Amenity>(AMENITIES, { min: 1, max: 4 }),
        status: faker.helpers.weightedArrayElement([
          { weight: 12, value: 'available' as const },
          { weight: 2, value: 'maintenance' as const },
          { weight: 1, value: 'retired' as const },
        ]),
      });
    });
  }

  for (let i = 0; i < 80; i += 1) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    data.members.push({
      id: nextId('mem'),
      firstName,
      lastName,
      email: faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase(),
      phone: faker.helpers.replaceSymbols('+380 ## ### ## ##'),
      company: faker.helpers.maybe(() => faker.company.name(), { probability: 0.6 }) ?? null,
      plan: faker.helpers.arrayElement(['day_pass', 'flex', 'dedicated', 'team'] as const),
      status: faker.helpers.weightedArrayElement([
        { weight: 10, value: 'active' as const },
        { weight: 1, value: 'suspended' as const },
        { weight: 1, value: 'cancelled' as const },
      ]),
      joinedAt: new Date(nowMs - faker.number.int({ min: 10, max: 700 }) * DAY)
        .toISOString()
        .slice(0, 10),
    });
  }

  const activeMembers = data.members.filter((m) => m.status === 'active');
  const bookableRooms = data.rooms.filter((r) => {
    const location = data.locations.find((l) => l.id === r.locationId);
    return r.status === 'available' && location?.status === 'active';
  });
  const today = startOfUtcDay(nowMs);

  for (let day = -21; day <= 21; day += 1) {
    const dayStart = today + day * DAY;
    for (const room of bookableRooms) {
      // Walk the day forward so bookings of one room never overlap. 07:00–17:00 UTC sits inside the
      // opening hours of every seeded location.
      let cursor = dayStart + 7 * HOUR + faker.number.int({ min: 0, max: 3 }) * HOUR;
      const count = faker.number.int({ min: 0, max: 3 });
      for (let n = 0; n < count && cursor < dayStart + 16 * HOUR; n += 1) {
        const duration = faker.helpers.arrayElement([1, 1.5, 2, 3]) * HOUR;
        const start = cursor;
        const end = Math.min(start + duration, dayStart + 18 * HOUR);
        cursor = end + faker.helpers.arrayElement([0, 0.5, 1, 2]) * HOUR;
        data.bookings.push({
          id: nextId('bk'),
          roomId: room.id,
          memberId: faker.helpers.arrayElement(activeMembers).id,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          attendees: faker.number.int({ min: 1, max: Math.min(room.capacity, 10) }),
          status: seededStatus(start, end, nowMs),
          notes:
            faker.helpers.maybe(() => faker.lorem.sentence({ min: 3, max: 8 }), {
              probability: 0.2,
            }) ?? null,
          totalPrice: Math.round((room.hourlyRate * (end - start)) / HOUR),
          createdAt: new Date(start - faker.number.int({ min: 1, max: 14 }) * DAY).toISOString(),
        });
      }
    }
  }

  return data;
};

const seededStatus = (start: number, end: number, now: number): BookingStatus => {
  if (end <= now) {
    return faker.helpers.weightedArrayElement([
      { weight: 16, value: 'completed' as const },
      { weight: 2, value: 'cancelled' as const },
      { weight: 1, value: 'no_show' as const },
    ]);
  }
  if (start <= now) return 'checked_in';
  return faker.helpers.weightedArrayElement([
    { weight: 10, value: 'confirmed' as const },
    { weight: 4, value: 'pending' as const },
    { weight: 1, value: 'cancelled' as const },
  ]);
};

import { roomInputSchema, roomPageSchema } from './room.js';

const input = {
  locationId: 'loc_1',
  name: 'Aurora',
  type: 'meeting_room',
  capacity: 6,
  hourlyRate: 2500,
  amenities: ['projector'],
  status: 'available',
};

const messages = (value: unknown) =>
  Object.fromEntries(
    (roomInputSchema.safeParse(value).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('roomInputSchema', () => {
  it('accepts a valid room and trims the name', () => {
    expect(roomInputSchema.parse({ ...input, name: '  Aurora ' }).name).toBe('Aurora');
  });

  it('reports the limits with readable messages', () => {
    expect(messages({ ...input, name: 'A', capacity: 0, hourlyRate: -1 })).toEqual({
      name: 'At least 2 characters',
      capacity: 'At least 1 seat',
      hourlyRate: 'Cannot be negative',
    });
  });

  it('wants whole cents and a known amenity', () => {
    expect(messages({ ...input, hourlyRate: 12.5 })).toHaveProperty('hourlyRate');
    expect(messages({ ...input, amenities: ['jacuzzi'] })).toHaveProperty('amenities.0');
  });

  it('caps capacity and rate', () => {
    expect(Object.keys(messages({ ...input, capacity: 201, hourlyRate: 1_000_001 }))).toEqual([
      'capacity',
      'hourlyRate',
    ]);
  });
});

describe('roomPageSchema', () => {
  it('describes a page of rooms', () => {
    const room = { ...input, id: 'room_1', locationName: 'Riverside Hub' };

    expect(roomPageSchema.safeParse({ items: [room], total: 1, page: 1, limit: 20 }).success).toBe(
      true,
    );
  });
});

import type { Room, RoomInput } from '../../contract/index.js';
import type { RoomsRepository } from './rooms.repository.js';
import { RoomsService } from './rooms.service.js';

const room: Room = {
  id: 'room_6',
  locationId: 'loc_1',
  locationName: 'Riverside Hub',
  name: 'Aurora',
  type: 'meeting_room',
  capacity: 8,
  hourlyRate: 2500,
  amenities: ['projector'],
  status: 'available',
};
const body: RoomInput = {
  locationId: room.locationId,
  name: room.name,
  type: room.type,
  capacity: room.capacity,
  hourlyRate: room.hourlyRate,
  amenities: room.amenities,
  status: room.status,
};

describe('RoomsService', () => {
  const service = (repository: Partial<RoomsRepository>) =>
    new RoomsService(repository as RoomsRepository, { now: () => new Date(0) });

  describe('update', () => {
    it('answers 404 when the room is deleted between the lookup and the update', async () => {
      const subject = service({
        find: () => Promise.resolve(room),
        update: () => Promise.resolve('not-found'),
      });

      await expect(subject.update('room_6', body)).rejects.toMatchObject({
        status: 404,
        response: { message: 'Room not found' },
      });
    });

    it('answers 422 when the location is deleted before the update', async () => {
      const subject = service({
        find: () => Promise.resolve(room),
        update: () => Promise.resolve('no-location'),
      });

      await expect(subject.update('room_6', body)).rejects.toMatchObject({
        status: 422,
        response: { fieldErrors: { locationId: 'Location not found' } },
      });
    });

    it('does not touch the repository for a body that fails the schema', async () => {
      const update = vi.fn();
      const subject = service({ find: () => Promise.resolve(room), update });

      await expect(subject.update('room_6', { name: 'X' })).rejects.toMatchObject({ status: 422 });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('answers 422 for a location that does not exist', async () => {
      const subject = service({ create: () => Promise.resolve('no-location') });

      await expect(subject.create(body)).rejects.toMatchObject({
        status: 422,
        response: { fieldErrors: { locationId: 'Location not found' } },
      });
    });
  });

  describe('remove', () => {
    it.each([
      ['not-found', 404, 'Room not found'],
      ['has-bookings', 409, 'This room has upcoming bookings; cancel them first'],
    ] as const)('maps %s to %i', async (outcome, status, message) => {
      const subject = service({ softDelete: () => Promise.resolve(outcome) });

      await expect(subject.remove('room_6')).rejects.toMatchObject({
        status,
        response: { message },
      });
    });
  });
});

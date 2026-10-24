import type { Booking, BookingInput, BookingStatus } from '../../contract/index.js';
import type { BookingStore, BookingsRepository, RoomFacts } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

const input: BookingInput = {
  roomId: 'room_1',
  memberId: 'mem_12',
  startsAt: '2026-12-01T09:00:00.000Z',
  endsAt: '2026-12-01T10:30:00.000Z',
  attendees: 4,
  notes: null,
};
const room: RoomFacts = {
  status: 'available',
  capacity: 6,
  hourlyRate: 2500,
  location: { status: 'active', timezone: 'Europe/Kyiv', opensAt: '08:00', closesAt: '20:00' },
};
const stored = (status: BookingStatus) => ({ id: 'bk_1', status }) as Booking;
const inTheWay = [
  { id: 'bk_2', startsAt: '2026-12-01T08:30:00.000Z', endsAt: '2026-12-01T09:30:00.000Z' },
];

describe('BookingsService', () => {
  /** A store whose room and member are fine and whose room is free, unless `overrides` say otherwise. */
  const store = (overrides: Partial<BookingStore> = {}) =>
    ({
      lockBooking: () => Promise.resolve('pending'),
      lockBookings: () => Promise.resolve(new Map()),
      setStatus: () => Promise.resolve(),
      lockRoom: () => Promise.resolve(room),
      lockMember: () => Promise.resolve({ status: 'active' }),
      conflicts: () => Promise.resolve([]),
      insert: () => Promise.resolve('bk_1'),
      update: () => Promise.resolve(),
      reread: () => Promise.resolve(stored('pending')),
      ...overrides,
    }) as BookingStore;
  const service = (repository: Partial<BookingsRepository>) =>
    new BookingsService(repository as BookingsRepository, { now: () => new Date(0) });
  /** A repository that runs the write on `inside` and finds a booking in `status`. */
  const repository = (
    status: BookingStatus,
    inside: BookingStore,
    outside: Partial<BookingsRepository> = {},
  ): Partial<BookingsRepository> => ({
    find: () => Promise.resolve(stored(status)),
    transaction: (work) => work(inside),
    inTransaction: (work) => work(inside),
    ...outside,
  });

  describe('update answers in the order of the mock', () => {
    it('404 for an unknown id, before anything else', async () => {
      const transaction = vi.fn();
      const subject = service({ find: () => Promise.resolve(undefined), transaction });

      await expect(subject.update('bk_missing', {})).rejects.toMatchObject({ status: 404 });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('409 for a booking past editing, before the body is read', async () => {
      const subject = service(repository('completed', store()));

      await expect(subject.update('bk_1', {})).rejects.toMatchObject({
        status: 409,
        response: { message: 'Only pending or confirmed bookings can be edited' },
      });
    });

    it('422 for a body that fails the schema, without opening a transaction', async () => {
      const transaction = vi.fn();
      const subject = service({ ...repository('pending', store()), transaction });

      await expect(subject.update('bk_1', { roomId: 'room_1' })).rejects.toMatchObject({
        status: 422,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('422 for broken rules, before the overlap is looked for', async () => {
      const conflicts = vi.fn().mockResolvedValue(inTheWay);
      const subject = service(repository('pending', store({ conflicts })));

      await expect(subject.update('bk_1', { ...input, attendees: 99 })).rejects.toMatchObject({
        status: 422,
        response: { fieldErrors: { attendees: 'This room seats up to 6' } },
      });
      expect(conflicts).not.toHaveBeenCalled();
    });

    it('409 with the bookings in the way, and the booking itself left out of them', async () => {
      const conflicts = vi.fn().mockResolvedValue(inTheWay);
      const subject = service(repository('confirmed', store({ conflicts })));

      await expect(subject.update('bk_1', input)).rejects.toMatchObject({
        status: 409,
        response: { message: 'The room is already booked for this time', conflicts: inTheWay },
      });
      expect(conflicts).toHaveBeenCalledWith(
        'room_1',
        new Date(input.startsAt),
        new Date(input.endsAt),
        'bk_1',
      );
    });

    it('409 when the booking is cancelled between the lookup and the lock', async () => {
      const subject = service(
        repository('pending', store({ lockBooking: () => Promise.resolve('cancelled') })),
      );

      await expect(subject.update('bk_1', input)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('create', () => {
    it('writes the price and the time of the clock', async () => {
      const insert = vi.fn().mockResolvedValue('bk_1');
      const subject = service(repository('pending', store({ insert })));

      await subject.create(input);

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: 'room_1', memberId: 'mem_12', totalPrice: 3750 }),
        new Date(0),
      );
    });

    it('looks for the overlap of no booking in particular', async () => {
      const conflicts = vi.fn().mockResolvedValue([]);
      const subject = service(repository('pending', store({ conflicts })));

      await subject.create(input);

      expect(conflicts.mock.calls[0]?.[3]).toBeUndefined();
    });

    it('answers a room that is gone alone, without looking at the member', async () => {
      const lockMember = vi.fn();
      const subject = service(
        repository('pending', store({ lockRoom: () => Promise.resolve(undefined), lockMember })),
      );

      await expect(subject.create(input)).rejects.toMatchObject({
        status: 422,
        response: { fieldErrors: { roomId: 'Room not found' } },
      });
      expect(lockMember).not.toHaveBeenCalled();
    });
  });

  describe('a write the database refuses for an overlap', () => {
    it('answers 409 with the bookings in the way, found after the rollback', async () => {
      const conflicts = vi.fn().mockResolvedValue(inTheWay);
      const subject = service({
        transaction: () => Promise.resolve('overlap'),
        conflicts,
      });

      await expect(subject.create(input)).rejects.toMatchObject({
        status: 409,
        response: { conflicts: inTheWay },
      });
      expect(conflicts).toHaveBeenCalledWith(
        'room_1',
        new Date(input.startsAt),
        new Date(input.endsAt),
        undefined,
      );
    });

    it('leaves the booking itself out when it is an edit', async () => {
      const conflicts = vi.fn().mockResolvedValue(inTheWay);
      const subject = service({
        find: () => Promise.resolve(stored('pending')),
        transaction: () => Promise.resolve('overlap'),
        conflicts,
      });

      await expect(subject.update('bk_1', input)).rejects.toMatchObject({ status: 409 });
      expect(conflicts.mock.calls[0]?.[3]).toBe('bk_1');
    });
  });

  describe('changeStatus answers in the order of the mock', () => {
    it('404 for an unknown id, before the body is read', async () => {
      const inTransaction = vi.fn();
      const subject = service({ find: () => Promise.resolve(undefined), inTransaction });

      await expect(subject.changeStatus('bk_missing', {})).rejects.toMatchObject({ status: 404 });
      expect(inTransaction).not.toHaveBeenCalled();
    });

    it('422 for a body that fails the schema, before the transition is judged', async () => {
      const inTransaction = vi.fn();
      const subject = service({ ...repository('completed', store()), inTransaction });

      await expect(subject.changeStatus('bk_1', { status: 'done' })).rejects.toMatchObject({
        status: 422,
        response: { fieldErrors: { status: expect.stringContaining('Invalid option') as string } },
      });
      expect(inTransaction).not.toHaveBeenCalled();
    });

    it('409 for a move the table forbids, and for staying where it is', async () => {
      const setStatus = vi.fn();
      const subject = service(
        repository(
          'completed',
          store({ lockBooking: () => Promise.resolve('completed'), setStatus }),
        ),
      );

      await expect(subject.changeStatus('bk_1', { status: 'pending' })).rejects.toMatchObject({
        status: 409,
        response: { message: 'Cannot change status from completed to pending' },
      });
      await expect(subject.changeStatus('bk_1', { status: 'completed' })).rejects.toMatchObject({
        status: 409,
      });
      expect(setStatus).not.toHaveBeenCalled();
    });

    it('judges the status found after the lock, not the one found before', async () => {
      const subject = service(
        repository('pending', store({ lockBooking: () => Promise.resolve('cancelled') })),
      );

      await expect(subject.changeStatus('bk_1', { status: 'confirmed' })).rejects.toMatchObject({
        status: 409,
        response: { message: 'Cannot change status from cancelled to confirmed' },
      });
    });

    it('404 when the booking is gone between the lookup and the lock', async () => {
      const subject = service(
        repository('pending', store({ lockBooking: () => Promise.resolve(undefined) })),
      );

      await expect(subject.changeStatus('bk_1', { status: 'confirmed' })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('writes the status and returns the booking read back', async () => {
      const setStatus = vi.fn().mockResolvedValue(undefined);
      const subject = service(
        repository(
          'pending',
          store({ setStatus, reread: () => Promise.resolve(stored('confirmed')) }),
        ),
      );

      await expect(subject.changeStatus('bk_1', { status: 'confirmed' })).resolves.toEqual(
        stored('confirmed'),
      );
      expect(setStatus).toHaveBeenCalledWith(['bk_1'], 'confirmed');
    });
  });

  describe('bulk', () => {
    it('writes the ones that moved to the target and reports the rest', async () => {
      const lockBookings = vi.fn().mockResolvedValue(
        new Map<string, BookingStatus>([
          ['bk_1', 'pending'],
          ['bk_2', 'completed'],
        ]),
      );
      const setStatus = vi.fn().mockResolvedValue(undefined);
      const subject = service(repository('pending', store({ lockBookings, setStatus })));

      await expect(
        subject.bulk({ ids: ['bk_2', 'bk_1', 'bk_x'], action: 'confirm' }),
      ).resolves.toEqual({
        updated: ['bk_1'],
        failed: [
          { id: 'bk_2', reason: 'Cannot confirm a booking that is completed' },
          { id: 'bk_x', reason: 'Booking not found' },
        ],
      });
      expect(lockBookings).toHaveBeenCalledWith(['bk_2', 'bk_1', 'bk_x']);
      expect(setStatus).toHaveBeenCalledWith(['bk_1'], 'confirmed');
    });

    it('writes nothing when no booking can move', async () => {
      const setStatus = vi.fn();
      const subject = service(repository('pending', store({ setStatus })));

      await expect(subject.bulk({ ids: ['bk_x'], action: 'cancel' })).resolves.toEqual({
        updated: [],
        failed: [{ id: 'bk_x', reason: 'Booking not found' }],
      });
      expect(setStatus).not.toHaveBeenCalled();
    });
  });
});

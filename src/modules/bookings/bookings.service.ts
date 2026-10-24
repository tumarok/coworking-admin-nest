import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { conflict, invalid, notFound } from '../../common/errors/api-error.js';
import { toPage } from '../../common/pagination/page.js';
import { parseInput } from '../../common/validation/parse-input.js';
import {
  type Booking,
  type BookingConflict,
  type BookingInput,
  bookingInputSchema,
  type BookingStatus,
  bookingStatusChangeSchema,
  type BulkBookingRequest,
  type BulkBookingResult,
  type Page,
} from '../../contract/index.js';
import { type BookingRow, BookingsRepository, type BookingStore } from './bookings.repository.js';
import type { BookingListParams } from './bookings.types.js';
import { bookingPrice, bookingProblems, isEditable } from './domain/rules.js';
import { BULK_TARGETS, changeRefusal, planBulk } from './domain/transitions.js';

const OVERLAP_MESSAGE = 'The room is already booked for this time';

const overlap = (conflicts: BookingConflict[]) => conflict(OVERLAP_MESSAGE, { conflicts });

const assertEditable = (status: BookingStatus): void => {
  if (!isEditable(status)) throw conflict('Only pending or confirmed bookings can be edited');
};

@Injectable()
export class BookingsService {
  constructor(
    private readonly repository: BookingsRepository,
    private readonly clock: Clock,
  ) {}

  async list(params: BookingListParams): Promise<Page<Booking>> {
    const { items, total } = await this.repository.list(params);
    return toPage(items, total, params);
  }

  async get(id: string): Promise<Booking> {
    const booking = await this.repository.find(id);
    if (!booking) throw notFound('Booking');
    return booking;
  }

  async create(input: BookingInput): Promise<Booking> {
    const createdAt = this.clock.now();
    const result = await this.repository.transaction(async (store) => {
      const row = await this.checked(store, input);
      return store.reread(await store.insert(row, createdAt));
    });
    return result === 'overlap' ? this.refuse(input) : result;
  }

  /**
   * The order of the answers is the mock's: unknown id (404), a booking that is past editing (409),
   * the body (422), the rules (422) and then the overlap (409).
   */
  async update(id: string, body: unknown): Promise<Booking> {
    assertEditable((await this.get(id)).status);
    const input = parseInput(bookingInputSchema, body);
    const result = await this.repository.transaction(async (store) => {
      // The booking is locked first, so its status cannot change between the check and the write.
      const status = await store.lockBooking(id);
      if (status === undefined) throw notFound('Booking');
      assertEditable(status);

      const row = await this.checked(store, input, id);
      await store.update(id, row);
      return store.reread(id);
    });
    return result === 'overlap' ? this.refuse(input, id) : result;
  }

  /**
   * The order of the answers is the mock's: unknown id (404), the body (422) and a move the table
   * does not allow (409). Nothing else is checked: a status change takes no room or time rules.
   */
  async changeStatus(id: string, body: unknown): Promise<Booking> {
    await this.get(id);
    const { status } = parseInput(bookingStatusChangeSchema, body);
    return this.repository.inTransaction(async (store) => {
      // The booking is locked first and its status read after the lock, so that of two requests
      // for the same move only the first one finds the status it needs.
      const current = await store.lockBooking(id);
      if (current === undefined) throw notFound('Booking');
      const refusal = changeRefusal(current, status);
      if (refusal) throw conflict(refusal);

      await store.setStatus([id], status);
      return store.reread(id);
    });
  }

  /**
   * Confirms or cancels each booking named, in the order of the request, and answers 200 whatever
   * happens to them. The bookings are locked together, in one order, and their results commit
   * together, though each id is judged on its own as in the mock.
   */
  async bulk({ ids, action }: BulkBookingRequest): Promise<BulkBookingResult> {
    return this.repository.inTransaction(async (store) => {
      const plan = planBulk(ids, action, await store.lockBookings(ids));
      if (plan.updated.length > 0) await store.setStatus(plan.updated, BULK_TARGETS[action]);
      return plan;
    });
  }

  /**
   * Locks the room and the member, applies the rules of a booking and looks for an overlap, in
   * the mock's order: a room that is gone answers alone, the other field problems come together,
   * and an overlap is looked for only when there are none. Returns the row to write.
   */
  private async checked(
    store: BookingStore,
    input: BookingInput,
    exceptId?: string,
  ): Promise<BookingRow> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    const room = await store.lockRoom(input.roomId);
    if (!room) throw invalid({ roomId: 'Room not found' });
    if (!room.location) throw invalid({ roomId: 'Room has no location' });
    const member = await store.lockMember(input.memberId);

    const problems = bookingProblems(
      { room, location: room.location, member },
      input,
      startsAt,
      endsAt,
    );
    if (Object.keys(problems).length > 0) throw invalid(problems);

    const conflicts = await store.conflicts(input.roomId, startsAt, endsAt, exceptId);
    if (conflicts.length > 0) throw overlap(conflicts);

    return {
      roomId: input.roomId,
      memberId: input.memberId,
      startsAt,
      endsAt,
      attendees: input.attendees,
      notes: input.notes,
      totalPrice: bookingPrice(room.hourlyRate, startsAt, endsAt),
    };
  }

  /** The answer to a write the database refused for an overlap that the check could not see. */
  private async refuse(input: BookingInput, exceptId?: string): Promise<never> {
    const conflicts = await this.repository.conflicts(
      input.roomId,
      new Date(input.startsAt),
      new Date(input.endsAt),
      exceptId,
    );
    throw overlap(conflicts);
  }
}

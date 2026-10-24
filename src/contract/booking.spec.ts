import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  bookingInputSchema,
  bookingPageSchema,
  bookingSchema,
  bulkBookingRequestSchema,
  MAX_BULK_BOOKINGS,
  canTransition,
} from './booking.js';

const input = {
  roomId: 'room_1',
  memberId: 'mem_1',
  startsAt: '2026-10-14T09:00:00.000Z',
  endsAt: '2026-10-14T10:30:00.000Z',
  attendees: 2,
  notes: null,
};

const endsAtError = (endsAt: string) => {
  const result = bookingInputSchema.safeParse({ ...input, endsAt });
  return result.error?.issues.find((issue) => issue.path.join('.') === 'endsAt')?.message;
};

describe('bookingInputSchema', () => {
  it('accepts a booking within the length limit', () => {
    expect(bookingInputSchema.safeParse(input).success).toBe(true);
    expect(endsAtError('2026-10-14T17:00:00.000Z')).toBeUndefined();
  });

  it('rejects an end that is not after the start', () => {
    expect(endsAtError('2026-10-14T09:00:00.000Z')).toBe('End must be after start');
    expect(endsAtError('2026-10-14T08:00:00.000Z')).toBe('End must be after start');
  });

  it('rejects a booking longer than 8 hours', () => {
    expect(endsAtError('2026-10-14T17:00:01.000Z')).toBe('A booking cannot be longer than 8 hours');
  });

  it('requires the notes key but allows null, and trims the text', () => {
    const withoutNotes: Partial<typeof input> = { ...input };
    delete withoutNotes.notes;

    expect(bookingInputSchema.safeParse(withoutNotes).success).toBe(false);
    expect(bookingInputSchema.parse({ ...input, notes: '  window seat ' }).notes).toBe(
      'window seat',
    );
  });

  it('requires at least one attendee', () => {
    const result = bookingInputSchema.safeParse({ ...input, attendees: 0 });

    expect(result.error?.issues[0]?.message).toBe('At least 1 attendee');
  });
});

describe('booking status transitions', () => {
  it('allows only the moves listed for the current status', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'no_show')).toBe(true);
    expect(canTransition('pending', 'checked_in')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
  });

  it('has no way out of the terminal statuses', () => {
    const terminal = BOOKING_STATUSES.filter((status) => BOOKING_TRANSITIONS[status].length === 0);

    expect(terminal).toEqual(['completed', 'cancelled', 'no_show']);
  });
});

describe('bulkBookingRequestSchema', () => {
  it('accepts 1 to 100 ids and a known action', () => {
    expect(bulkBookingRequestSchema.safeParse({ ids: ['bk_1'], action: 'confirm' }).success).toBe(
      true,
    );
    expect(bulkBookingRequestSchema.safeParse({ ids: [], action: 'cancel' }).success).toBe(false);
    expect(
      bulkBookingRequestSchema.safeParse({
        ids: Array.from({ length: MAX_BULK_BOOKINGS + 1 }, (_, i) => `bk_${i}`),
        action: 'cancel',
      }).success,
    ).toBe(false);
    expect(
      bulkBookingRequestSchema.safeParse({
        ids: Array.from({ length: MAX_BULK_BOOKINGS }, (_, i) => `bk_${i}`),
        action: 'cancel',
      }).success,
    ).toBe(true);
    expect(bulkBookingRequestSchema.safeParse({ ids: ['bk_1'], action: 'delete' }).success).toBe(
      false,
    );
  });
});

describe('bookingSchema', () => {
  const booking = {
    id: 'bk_1',
    roomId: 'room_1',
    roomName: 'Atrium',
    locationId: 'loc_1',
    locationName: 'Riverside Hub',
    memberId: 'mem_1',
    memberName: 'Ada Lovelace',
    startsAt: '2026-10-14T09:00:00.000Z',
    endsAt: '2026-10-14T10:30:00.000Z',
    attendees: 2,
    status: 'pending',
    notes: null,
    totalPrice: 4500,
    createdAt: '2026-10-01T09:00:00.000Z',
  };

  it('accepts a booking, alone and in a page', () => {
    expect(bookingSchema.safeParse(booking).success).toBe(true);
    expect(
      bookingPageSchema.safeParse({ items: [booking], total: 1, page: 1, limit: 20 }).success,
    ).toBe(true);
  });

  it('accepts the placeholder names of a booking whose room has been deleted', () => {
    const orphan = { ...booking, roomName: '—', locationName: '—' };

    expect(bookingSchema.safeParse(orphan).success).toBe(true);
  });

  it('requires the location of the room, even a deleted one', () => {
    expect(bookingSchema.safeParse({ ...booking, locationId: '' }).success).toBe(false);
  });
});

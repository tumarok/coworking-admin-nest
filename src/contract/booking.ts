import * as z from 'zod';

import { idSchema, isoDateSchema, isoDateTimeSchema, pageOf, pageQuerySchema } from './common.js';

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Which status a booking may move to from its current one. Terminal statuses have none. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus) =>
  BOOKING_TRANSITIONS[from].includes(to);

export const MAX_BOOKING_HOURS = 8;

export const bookingSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  roomName: z.string(),
  locationId: idSchema,
  locationName: z.string(),
  memberId: idSchema,
  memberName: z.string(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  attendees: z.number().int().min(1),
  status: bookingStatusSchema,
  notes: z.string().nullable(),
  /** Computed by the server from the room's hourly rate, in cents. */
  totalPrice: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
});

export const bookingPageSchema = pageOf(bookingSchema);

export const bookingInputSchema = z
  .object({
    roomId: idSchema,
    memberId: idSchema,
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    attendees: z.number().int().min(1, { error: 'At least 1 attendee' }),
    notes: z.string().trim().max(500).nullable(),
  })
  .superRefine((v, ctx) => {
    const hours = (Date.parse(v.endsAt) - Date.parse(v.startsAt)) / 3_600_000;
    if (hours <= 0) {
      ctx.addIssue({ code: 'custom', message: 'End must be after start', path: ['endsAt'] });
    } else if (hours > MAX_BOOKING_HOURS) {
      ctx.addIssue({
        code: 'custom',
        message: `A booking cannot be longer than ${MAX_BOOKING_HOURS} hours`,
        path: ['endsAt'],
      });
    }
  });

export const bookingStatusChangeSchema = z.object({ status: bookingStatusSchema });

export const bookingListQuerySchema = pageQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: bookingStatusSchema.optional(),
  locationId: idSchema.optional(),
  roomId: idSchema.optional(),
  memberId: idSchema.optional(),
});

export const BULK_ACTIONS = ['confirm', 'cancel'] as const;

/** Most bookings one bulk request may name. */
export const MAX_BULK_BOOKINGS = 100;

export const bulkBookingRequestSchema = z.object({
  ids: z.array(idSchema).min(1).max(MAX_BULK_BOOKINGS),
  action: z.enum(BULK_ACTIONS),
});

export const bulkBookingResultSchema = z.object({
  updated: z.array(idSchema),
  failed: z.array(z.object({ id: idSchema, reason: z.string() })),
});

export type Booking = z.infer<typeof bookingSchema>;
export type BookingInput = z.infer<typeof bookingInputSchema>;
export type BookingListQuery = z.input<typeof bookingListQuerySchema>;
export type BulkBookingAction = (typeof BULK_ACTIONS)[number];
export type BulkBookingRequest = z.infer<typeof bulkBookingRequestSchema>;
export type BulkBookingResult = z.infer<typeof bulkBookingResultSchema>;

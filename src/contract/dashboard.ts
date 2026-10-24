import * as z from 'zod';

import { bookingSchema, bookingStatusSchema } from './booking.js';
import { idSchema, isoDateSchema } from './common.js';

export const dashboardQuerySchema = z.object({ date: isoDateSchema.optional() });

export const dashboardSchema = z.object({
  date: isoDateSchema,
  kpis: z.object({
    bookingsToday: z.number().int().min(0),
    /** Booked hours divided by bookable hours across all locations, 0..1. */
    occupancyRate: z.number().min(0).max(1),
    revenueMonth: z.number().int().min(0),
    activeMembers: z.number().int().min(0),
  }),
  occupancy: z.array(
    z.object({
      locationId: idSchema,
      locationName: z.string(),
      bookedHours: z.number().min(0),
      availableHours: z.number().min(0),
    }),
  ),
  byStatus: z.record(bookingStatusSchema, z.number().int().min(0)),
  upcoming: z.array(bookingSchema),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

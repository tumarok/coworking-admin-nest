import * as z from 'zod';

import { idSchema, pageOf, pageQuerySchema, timeOfDaySchema } from './common.js';

export const LOCATION_STATUSES = ['active', 'inactive'] as const;
export const TIMEZONES = [
  'Europe/Kyiv',
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/Lisbon',
  'Europe/London',
] as const;

export const locationStatusSchema = z.enum(LOCATION_STATUSES);
export const timezoneSchema = z.enum(TIMEZONES);

export const locationSchema = z.object({
  id: idSchema,
  name: z.string(),
  city: z.string(),
  address: z.string(),
  timezone: timezoneSchema,
  opensAt: timeOfDaySchema,
  closesAt: timeOfDaySchema,
  status: locationStatusSchema,
  roomCount: z.number().int().min(0),
});

export const locationPageSchema = pageOf(locationSchema);

export const locationInputSchema = z
  .object({
    name: z.string().trim().min(2, { error: 'At least 2 characters' }).max(80),
    city: z.string().trim().min(2, { error: 'At least 2 characters' }).max(60),
    address: z.string().trim().min(5, { error: 'At least 5 characters' }).max(160),
    timezone: timezoneSchema,
    opensAt: timeOfDaySchema,
    closesAt: timeOfDaySchema,
    status: locationStatusSchema,
  })
  .refine((v) => v.closesAt > v.opensAt, {
    error: 'Closing time must be after opening time',
    path: ['closesAt'],
  });

export const locationListQuerySchema = pageQuerySchema.extend({
  city: z.string().optional(),
  status: locationStatusSchema.optional(),
});

export type Location = z.infer<typeof locationSchema>;
export type LocationInput = z.infer<typeof locationInputSchema>;
export type LocationStatus = z.infer<typeof locationStatusSchema>;
export type LocationListQuery = z.input<typeof locationListQuerySchema>;

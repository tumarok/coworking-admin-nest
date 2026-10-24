import * as z from 'zod';

export const idSchema = z.string().min(1);

/** Wall-clock time of day, "HH:mm". */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use the HH:mm format' });

export const isoDateTimeSchema = z.iso.datetime();
export const isoDateSchema = z.iso.date();

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Query every list endpoint understands. Numbers arrive as strings, hence the coercion. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().optional(),
});

export type PageQuery = z.input<typeof pageQuerySchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
  });

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const bookingConflictSchema = z.object({
  id: idSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
});

/**
 * Error body of every non-2xx response. `fieldErrors` comes with 422 and maps a form field to a
 * message; `conflicts` comes with 409 when a booking overlaps existing ones.
 */
export const apiErrorSchema = z.object({
  message: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
  conflicts: z.array(bookingConflictSchema).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export type BookingConflict = z.infer<typeof bookingConflictSchema>;

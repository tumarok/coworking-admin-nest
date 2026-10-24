import type * as z from 'zod';
import type { bookingListQuerySchema } from '../../contract/index.js';

/** The list query after validation: page and limit have their defaults, `q` is trimmed. */
export type BookingListParams = z.output<typeof bookingListQuerySchema>;

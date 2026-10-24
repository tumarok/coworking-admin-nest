import type * as z from 'zod';
import type { locationListQuerySchema } from '../../contract/index.js';

/** The list query after validation: page and limit have their defaults, `q` is trimmed. */
export type LocationListParams = z.output<typeof locationListQuerySchema>;

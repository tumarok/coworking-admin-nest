import type * as z from 'zod';
import type { roomListQuerySchema } from '../../contract/index.js';

/** The list query after validation: page and limit have their defaults, `q` is trimmed. */
export type RoomListParams = z.output<typeof roomListQuerySchema>;

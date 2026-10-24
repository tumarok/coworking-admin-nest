import type * as z from 'zod';
import type { memberListQuerySchema } from '../../contract/index.js';

/** The list query after validation: page and limit have their defaults, `q` is trimmed. */
export type MemberListParams = z.output<typeof memberListQuerySchema>;

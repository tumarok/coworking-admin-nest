import type { BookingStatus } from '../../contract/index.js';

/** The statuses that keep a room and a member occupied, as the mock defines them (`rules.ts`). */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'checked_in'];

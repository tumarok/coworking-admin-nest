import {
  type BookingStatus,
  type BulkBookingAction,
  type BulkBookingResult,
  canTransition,
} from '../../../contract/index.js';

/** The status a bulk action moves bookings to. */
export const BULK_TARGETS: Record<BulkBookingAction, BookingStatus> = {
  confirm: 'confirmed',
  cancel: 'cancelled',
};

/** A status as the messages write it: only the first underscore becomes a space (`checked in`). */
export const humanStatus = (status: BookingStatus): string => status.replace('_', ' ');

/** Why a booking cannot move from one status to another; `undefined` when it can. */
export const changeRefusal = (from: BookingStatus, to: BookingStatus): string | undefined =>
  canTransition(from, to)
    ? undefined
    : `Cannot change status from ${humanStatus(from)} to ${humanStatus(to)}`;

/**
 * Applies a bulk action to the bookings in the order of the request, each on its own: one that
 * cannot move does not stop the others. A repeated id meets the status its first copy left, so
 * the later copies fail. `statuses` holds the current status of every booking that exists.
 */
export const planBulk = (
  ids: readonly string[],
  action: BulkBookingAction,
  statuses: ReadonlyMap<string, BookingStatus>,
): BulkBookingResult => {
  const target = BULK_TARGETS[action];
  const current = new Map(statuses);
  const plan: BulkBookingResult = { updated: [], failed: [] };
  for (const id of ids) {
    const status = current.get(id);
    if (status === undefined) {
      plan.failed.push({ id, reason: 'Booking not found' });
    } else if (!canTransition(status, target)) {
      plan.failed.push({ id, reason: `Cannot ${action} a booking that is ${humanStatus(status)}` });
    } else {
      current.set(id, target);
      plan.updated.push(id);
    }
  }
  return plan;
};

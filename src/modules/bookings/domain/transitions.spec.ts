import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingStatus,
} from '../../../contract/index.js';
import { BULK_TARGETS, changeRefusal, humanStatus, planBulk } from './transitions.js';

const statuses = (entries: Record<string, BookingStatus>) => new Map(Object.entries(entries));

describe('humanStatus', () => {
  it('turns only the first underscore into a space', () => {
    expect(humanStatus('checked_in')).toBe('checked in');
    expect(humanStatus('no_show')).toBe('no show');
    expect(humanStatus('pending')).toBe('pending');
    expect(humanStatus('a_b_c' as BookingStatus)).toBe('a b_c');
  });
});

describe('changeRefusal', () => {
  it.each(BOOKING_STATUSES.flatMap((from) => BOOKING_STATUSES.map((to) => [from, to] as const)))(
    'from %s to %s follows the transition table',
    (from, to) => {
      const allowed = BOOKING_TRANSITIONS[from].includes(to);

      expect(changeRefusal(from, to) === undefined).toBe(allowed);
    },
  );

  it('names both statuses in the words of the status', () => {
    expect(changeRefusal('checked_in', 'pending')).toBe(
      'Cannot change status from checked in to pending',
    );
    expect(changeRefusal('no_show', 'checked_in')).toBe(
      'Cannot change status from no show to checked in',
    );
  });

  it('refuses a move to the status a booking already has', () => {
    expect(changeRefusal('pending', 'pending')).toBe(
      'Cannot change status from pending to pending',
    );
  });
});

describe('planBulk', () => {
  it('maps confirm and cancel to their statuses', () => {
    expect(BULK_TARGETS).toEqual({ confirm: 'confirmed', cancel: 'cancelled' });
  });

  it('updates what can move and reports the rest in the order of the request', () => {
    const plan = planBulk(
      ['bk_a', 'bk_missing', 'bk_b', 'bk_c'],
      'confirm',
      statuses({ bk_a: 'pending', bk_b: 'checked_in', bk_c: 'pending' }),
    );

    expect(plan).toEqual({
      updated: ['bk_a', 'bk_c'],
      failed: [
        { id: 'bk_missing', reason: 'Booking not found' },
        { id: 'bk_b', reason: 'Cannot confirm a booking that is checked in' },
      ],
    });
  });

  it('lets a later copy of an id fail, because the first one moved it', () => {
    expect(planBulk(['bk_a', 'bk_a'], 'confirm', statuses({ bk_a: 'pending' }))).toEqual({
      updated: ['bk_a'],
      failed: [{ id: 'bk_a', reason: 'Cannot confirm a booking that is confirmed' }],
    });
    expect(planBulk(['bk_a', 'bk_a'], 'cancel', statuses({ bk_a: 'confirmed' }))).toEqual({
      updated: ['bk_a'],
      failed: [{ id: 'bk_a', reason: 'Cannot cancel a booking that is cancelled' }],
    });
  });

  it('repeats the failure of a missing id for each copy', () => {
    expect(planBulk(['x', 'x'], 'cancel', new Map()).failed).toEqual([
      { id: 'x', reason: 'Booking not found' },
      { id: 'x', reason: 'Booking not found' },
    ]);
  });

  it.each([
    ['confirm', 'pending', true],
    ['confirm', 'confirmed', false],
    ['confirm', 'checked_in', false],
    ['confirm', 'completed', false],
    ['confirm', 'cancelled', false],
    ['confirm', 'no_show', false],
    ['cancel', 'pending', true],
    ['cancel', 'confirmed', true],
    ['cancel', 'checked_in', false],
    ['cancel', 'completed', false],
    ['cancel', 'cancelled', false],
    ['cancel', 'no_show', false],
  ] as const)('%s on a %s booking updates it: %s', (action, status, updated) => {
    const plan = planBulk(['bk_a'], action, statuses({ bk_a: status }));

    expect(plan.updated).toEqual(updated ? ['bk_a'] : []);
    expect(plan.failed).toEqual(
      updated
        ? []
        : [{ id: 'bk_a', reason: `Cannot ${action} a booking that is ${humanStatus(status)}` }],
    );
  });
});

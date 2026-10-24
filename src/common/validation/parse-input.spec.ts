import { bookingInputSchema, memberInputSchema } from '../../contract/index.js';
import { ApiError } from '../errors/api-error.js';
import { parseInput } from './parse-input.js';

const failure = (run: () => unknown): ApiError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
  }
  throw new Error('expected an ApiError');
};

const member = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: ' ADA@Example.com ',
  phone: '+380 44 123 45 67',
  company: '',
  plan: 'flex',
  status: 'active',
};

describe('parseInput', () => {
  it('returns the transformed value', () => {
    expect(parseInput(memberInputSchema, member)).toMatchObject({
      email: 'ada@example.com',
      company: null,
    });
  });

  it('throws a 422 with one message per field', () => {
    const error = failure(() =>
      parseInput(memberInputSchema, { ...member, firstName: '', plan: 'vip' }),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      message: 'Validation failed',
      fieldErrors: {
        firstName: 'Required',
        plan: 'Invalid option: expected one of "day_pass"|"flex"|"dedicated"|"team"',
      },
    });
  });

  it('reports a missing body on "_"', () => {
    expect(failure(() => parseInput(bookingInputSchema, undefined)).getResponse()).toEqual({
      message: 'Validation failed',
      fieldErrors: { _: 'Invalid input: expected object, received undefined' },
    });
  });

  it('reports a refinement of the booking on the field it names', () => {
    const error = failure(() =>
      parseInput(bookingInputSchema, {
        roomId: 'room_1',
        memberId: 'mem_1',
        startsAt: '2026-10-14T10:00:00.000Z',
        endsAt: '2026-10-14T09:00:00.000Z',
        attendees: 2,
        notes: null,
      }),
    );

    expect(error.getResponse()).toMatchObject({
      fieldErrors: { endsAt: 'End must be after start' },
    });
  });
});

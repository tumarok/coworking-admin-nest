import { conflict, invalid, notFound, unauthorized } from './api-error.js';

describe('api errors', () => {
  it('carry the status and the body of the contract', () => {
    expect([unauthorized().getStatus(), unauthorized().getResponse()]).toEqual([
      401,
      { message: 'Authentication required' },
    ]);
    expect([notFound('Room').getStatus(), notFound('Room').getResponse()]).toEqual([
      404,
      { message: 'Room not found' },
    ]);
  });

  it('adds conflicts to a 409', () => {
    const conflicts = [
      { id: 'bk_1', startsAt: '2026-10-14T09:00:00Z', endsAt: '2026-10-14T10:00:00Z' },
    ];
    const error = conflict('The room is already booked for this time', { conflicts });

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      message: 'The room is already booked for this time',
      conflicts,
    });
  });

  it('adds field errors to a 422 with the usual message', () => {
    const error = invalid({ name: 'Required' });

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      message: 'Validation failed',
      fieldErrors: { name: 'Required' },
    });
  });
});

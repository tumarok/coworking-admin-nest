import { issuesToFieldErrors } from './field-errors.js';

describe('issuesToFieldErrors', () => {
  it('joins nested paths with dots', () => {
    const issues = [
      { message: 'Invalid option', path: ['amenities', 1] },
      { message: 'Required', path: ['ids', 0] },
    ];

    expect(issuesToFieldErrors(issues)).toEqual({
      'amenities.1': 'Invalid option',
      'ids.0': 'Required',
    });
  });

  it('keys the whole body as "_"', () => {
    expect(issuesToFieldErrors([{ message: 'Expected object' }])).toEqual({ _: 'Expected object' });
    expect(issuesToFieldErrors([{ message: 'Expected object', path: [] }])).toEqual({
      _: 'Expected object',
    });
  });

  it('keeps the first message of a path', () => {
    const issues = [
      { message: 'first', path: ['name'] },
      { message: 'second', path: ['name'] },
    ];

    expect(issuesToFieldErrors(issues)).toEqual({ name: 'first' });
  });

  it('reads path segments given as objects', () => {
    expect(issuesToFieldErrors([{ message: 'bad', path: [{ key: 'items' }, { key: 2 }] }])).toEqual(
      {
        'items.2': 'bad',
      },
    );
  });
});

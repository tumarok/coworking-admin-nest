import { locationInputSchema } from './location.js';

const input = {
  name: 'Riverside Hub',
  city: 'Kyiv',
  address: '12 Naberezhna St',
  timezone: 'Europe/Kyiv',
  opensAt: '08:00',
  closesAt: '21:00',
  status: 'active',
};

const messages = (value: unknown) =>
  Object.fromEntries(
    (locationInputSchema.safeParse(value).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('locationInputSchema', () => {
  it('accepts a valid location and trims the text fields', () => {
    const parsed = locationInputSchema.parse({ ...input, name: '  Riverside Hub  ' });

    expect(parsed.name).toBe('Riverside Hub');
  });

  it('requires closing time after opening time, reported on closesAt', () => {
    expect(messages({ ...input, opensAt: '10:00', closesAt: '10:00' })).toEqual({
      closesAt: 'Closing time must be after opening time',
    });
    expect(messages({ ...input, opensAt: '10:00', closesAt: '09:30' })).toEqual({
      closesAt: 'Closing time must be after opening time',
    });
  });

  it('checks the time format and the text lengths', () => {
    expect(messages({ ...input, name: 'X', address: 'Str', closesAt: '9pm' })).toEqual({
      name: 'At least 2 characters',
      address: 'At least 5 characters',
      closesAt: 'Use the HH:mm format',
    });
  });
});

import { memberFullName, memberInputSchema, memberPageSchema } from './member.js';

const input = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+380 44 123 45 67',
  company: 'Analytical Engines',
  plan: 'flex',
  status: 'active',
};

const messages = (value: unknown) =>
  Object.fromEntries(
    (memberInputSchema.safeParse(value).error?.issues ?? []).map((issue) => [
      issue.path.join('.'),
      issue.message,
    ]),
  );

describe('memberInputSchema', () => {
  it('accepts a valid member and trims the text fields', () => {
    const parsed = memberInputSchema.parse({
      ...input,
      firstName: '  Ada ',
      phone: ' +380 44 123 45 67 ',
      company: ' Analytical Engines  ',
    });

    expect(parsed).toMatchObject({
      firstName: 'Ada',
      phone: '+380 44 123 45 67',
      company: 'Analytical Engines',
    });
  });

  it('trims the email and lowers its case, as the API stores it', () => {
    expect(memberInputSchema.parse({ ...input, email: '  Ada@Example.COM ' }).email).toBe(
      'ada@example.com',
    );
  });

  it('gives a missing or non-text email the same message as a malformed one', () => {
    expect(messages({ ...input, email: undefined })).toEqual({ email: 'Enter a valid email' });
    expect(messages({ ...input, email: 42 })).toEqual({ email: 'Enter a valid email' });
  });

  it('allows a member without a company', () => {
    expect(memberInputSchema.safeParse({ ...input, company: null }).success).toBe(true);
    expect(memberInputSchema.parse({ ...input, company: '' }).company).toBeNull();
    expect(memberInputSchema.parse({ ...input, company: '   ' }).company).toBeNull();
  });

  it('reports the rules with readable messages', () => {
    expect(
      messages({ ...input, firstName: ' ', lastName: '', email: 'ada', phone: 'call me' }),
    ).toEqual({
      firstName: 'Required',
      lastName: 'Required',
      email: 'Enter a valid email',
      phone: 'Enter a valid phone number',
    });
  });

  it('caps the length of names and company', () => {
    expect(
      Object.keys(
        messages({
          ...input,
          firstName: 'a'.repeat(61),
          lastName: 'b'.repeat(61),
          company: 'c'.repeat(81),
        }),
      ),
    ).toEqual(['firstName', 'lastName', 'company']);
  });

  it('knows only the listed plans and statuses', () => {
    expect(Object.keys(messages({ ...input, plan: 'gold', status: 'banned' }))).toEqual([
      'plan',
      'status',
    ]);
  });
});

describe('memberPageSchema', () => {
  it('describes a page of members', () => {
    const member = { ...input, id: 'mem_1', joinedAt: '2026-01-31' };

    expect(
      memberPageSchema.safeParse({ items: [member], total: 1, page: 1, limit: 20 }).success,
    ).toBe(true);
  });
});

describe('memberFullName', () => {
  it('joins the first and the last name', () => {
    expect(memberFullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
  });
});

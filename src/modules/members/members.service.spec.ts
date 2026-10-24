import type { Member, MemberInput } from '../../contract/index.js';
import type { MembersRepository } from './members.repository.js';
import { MembersService } from './members.service.js';

const member: Member = {
  id: 'mem_12',
  firstName: 'Kiley',
  lastName: 'Wolf',
  email: 'kiley_wolf@example.com',
  phone: '+380 50 123 45 67',
  company: null,
  plan: 'flex',
  status: 'active',
  joinedAt: '2026-04-26',
};
const body: MemberInput = {
  firstName: member.firstName,
  lastName: member.lastName,
  email: member.email,
  phone: member.phone,
  company: member.company,
  plan: member.plan,
  status: member.status,
};
const EMAIL_TAKEN = {
  status: 422,
  response: { fieldErrors: { email: 'This email is already registered' } },
};

describe('MembersService', () => {
  const service = (repository: Partial<MembersRepository>, now = new Date(0)) =>
    new MembersService(repository as MembersRepository, { now: () => now });

  describe('create', () => {
    it('stamps the join date with the UTC date of the clock', async () => {
      const create = vi.fn().mockResolvedValue(member);
      const subject = service(
        { emailTaken: () => Promise.resolve(false), create },
        new Date('2026-10-14T23:59:59.999Z'),
      );

      await subject.create(body);

      expect(create).toHaveBeenCalledWith(body, '2026-10-14');
    });

    it('answers 422 for an address that is taken, without creating anything', async () => {
      const create = vi.fn();
      const subject = service({ emailTaken: () => Promise.resolve(true), create });

      await expect(subject.create(body)).rejects.toMatchObject(EMAIL_TAKEN);
      expect(create).not.toHaveBeenCalled();
    });

    it('answers the same 422 when the address is taken between the check and the insert', async () => {
      const subject = service({
        emailTaken: () => Promise.resolve(false),
        create: () => Promise.resolve('email-taken'),
      });

      await expect(subject.create(body)).rejects.toMatchObject(EMAIL_TAKEN);
    });
  });

  describe('update', () => {
    it('answers 404 when the member is deleted between the lookup and the update', async () => {
      const subject = service({
        find: () => Promise.resolve(member),
        emailTaken: () => Promise.resolve(false),
        update: () => Promise.resolve('not-found'),
      });

      await expect(subject.update('mem_12', body)).rejects.toMatchObject({
        status: 404,
        response: { message: 'Member not found' },
      });
    });

    it('does not count the member itself when it looks for the address', async () => {
      const emailTaken = vi.fn().mockResolvedValue(false);
      const subject = service({
        find: () => Promise.resolve(member),
        emailTaken,
        update: () => Promise.resolve(member),
      });

      await subject.update('mem_12', body);

      expect(emailTaken).toHaveBeenCalledWith(member.email, 'mem_12');
    });

    const taken: [string, Partial<MembersRepository>][] = [
      ['taken at the check', { emailTaken: () => Promise.resolve(true) }],
      [
        'taken between the check and the update',
        { emailTaken: () => Promise.resolve(false), update: () => Promise.resolve('email-taken') },
      ],
    ];

    it.each(taken)('answers 422 for an address that is %s', async (_when, overrides) => {
      const subject = service({ find: () => Promise.resolve(member), ...overrides });

      await expect(subject.update('mem_12', body)).rejects.toMatchObject(EMAIL_TAKEN);
    });

    it('does not touch the repository for a body that fails the schema', async () => {
      const update = vi.fn();
      const emailTaken = vi.fn();
      const subject = service({ find: () => Promise.resolve(member), emailTaken, update });

      await expect(subject.update('mem_12', { firstName: 'X' })).rejects.toMatchObject({
        status: 422,
      });
      expect(emailTaken).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it.each([
      ['not-found', 404, 'Member not found'],
      ['has-bookings', 409, 'This member has upcoming bookings; cancel them first'],
    ] as const)('maps %s to %i', async (outcome, status, message) => {
      const subject = service({ softDelete: () => Promise.resolve(outcome) });

      await expect(subject.remove('mem_12')).rejects.toMatchObject({
        status,
        response: { message },
      });
    });

    it('deletes with the time of the clock', async () => {
      const softDelete = vi.fn().mockResolvedValue('deleted');
      const now = new Date('2026-10-14T09:00:00.000Z');

      await service({ softDelete }, now).remove('mem_12');

      expect(softDelete).toHaveBeenCalledWith('mem_12', now);
    });
  });
});

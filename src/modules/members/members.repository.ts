import { Injectable } from '@nestjs/common';
import { OCCUPYING_STATUSES } from '../../common/bookings/occupying.js';
import { pageOffset } from '../../common/pagination/page.js';
import type { Member, MemberInput } from '../../contract/index.js';
import { nextEntityId } from '../../database/entity-id.js';
import { type DbClient, PrismaService } from '../../database/prisma.service.js';
import { allOf, containsAny } from '../../database/sql-filters.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { MemberListParams } from './members.types.js';

// The columns of a `Member`; the join date is a calendar date, read as `YYYY-MM-DD` text.
const COLUMNS = Prisma.sql`
  m.id, m.first_name AS "firstName", m.last_name AS "lastName", m.email, m.phone, m.company,
  m.plan, m.status, to_char(m.joined_at, 'YYYY-MM-DD') AS "joinedAt"`;

// What `q` searches: the full name as the mock writes it ("first last"), the email and the company.
const SEARCHED = [
  Prisma.raw(`(m.first_name || ' ' || m.last_name)`),
  Prisma.raw('m.email'),
  Prisma.raw('m.company'),
];

/** True for the error of a write that broke the unique index of the email (SQLSTATE 23505). */
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  JSON.stringify(error.meta).includes('email');

/** What became of a delete request. */
export type DeleteOutcome = 'deleted' | 'not-found' | 'has-bookings';

@Injectable()
export class MembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of the members matching the filters, by last name and first name, and the number of all matches. */
  async list(params: MemberListParams): Promise<{ items: Member[]; total: number }> {
    const { q, plan, status, limit } = params;
    const where = allOf([
      Prisma.sql`m.deleted_at IS NULL`,
      ...(q ? [containsAny(q, SEARCHED)] : []),
      ...(plan ? [Prisma.sql`m.plan = ${plan}::member_plan`] : []),
      ...(status ? [Prisma.sql`m.status = ${status}::member_status`] : []),
    ]);

    // One snapshot for both, so the total always matches the rows.
    const [items, counts] = await this.prisma.client.$transaction(
      [
        this.prisma.client.$queryRaw<Member[]>`
          SELECT ${COLUMNS} FROM members m WHERE ${where}
          ORDER BY m.last_name, m.first_name, m.seq LIMIT ${limit} OFFSET ${pageOffset(params)}`,
        this.prisma.client.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total FROM members m WHERE ${where}`,
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total: counts.at(0)?.total ?? 0 };
  }

  async find(id: string, client: DbClient = this.prisma.client): Promise<Member | undefined> {
    const rows = await client.$queryRaw<Member[]>`
      SELECT ${COLUMNS} FROM members m WHERE m.id = ${id} AND m.deleted_at IS NULL`;
    return rows.at(0);
  }

  /** Whether a member that is not deleted has the address, not counting the member `exceptId`. */
  async emailTaken(email: string, exceptId?: string): Promise<boolean> {
    const holder = await this.prisma.client.member.findFirst({
      where: { email, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    return holder !== null;
  }

  /** Creates a member; `'email-taken'` when another one got the address first. */
  async create(input: MemberInput, joinedAt: string): Promise<Member | 'email-taken'> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const { id, seq } = await nextEntityId(tx, 'mem');
        await tx.member.create({ data: { id, seq, ...input, joinedAt: new Date(joinedAt) } });
        return { id, ...input, joinedAt };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'email-taken';
      throw error;
    }
  }

  /**
   * Replaces the fields of a member that still exists (the join date stays); `'email-taken'`
   * when another one got the address first.
   */
  async update(id: string, input: MemberInput): Promise<Member | 'not-found' | 'email-taken'> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.member.updateMany({
          where: { id, deletedAt: null },
          data: input,
        });
        return (count === 0 ? undefined : await this.find(id, tx)) ?? 'not-found';
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'email-taken';
      throw error;
    }
  }

  /**
   * Soft-deletes a member that has no upcoming booking. The row is locked first: a booking being
   * added at the same moment takes a share lock on the member (its foreign key does, and the
   * bookings module must lock it `FOR SHARE` and check `deleted_at` itself), so it either is
   * counted here or waits for the delete.
   */
  softDelete(id: string, now: Date): Promise<DeleteOutcome> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM members WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) return 'not-found';

      const upcoming = await tx.booking.count({
        where: { memberId: id, status: { in: [...OCCUPYING_STATUSES] }, endsAt: { gt: now } },
      });
      if (upcoming > 0) return 'has-bookings';

      await tx.member.update({ where: { id }, data: { deletedAt: now } });
      return 'deleted';
    });
  }
}

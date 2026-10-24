import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { conflict, invalid, notFound } from '../../common/errors/api-error.js';
import { toPage } from '../../common/pagination/page.js';
import { parseInput } from '../../common/validation/parse-input.js';
import {
  type Member,
  type MemberInput,
  memberInputSchema,
  type Page,
} from '../../contract/index.js';
import { MembersRepository } from './members.repository.js';
import type { MemberListParams } from './members.types.js';

const EMAIL_TAKEN = { email: 'This email is already registered' };

@Injectable()
export class MembersService {
  constructor(
    private readonly repository: MembersRepository,
    private readonly clock: Clock,
  ) {}

  async list(params: MemberListParams): Promise<Page<Member>> {
    const { items, total } = await this.repository.list(params);
    return toPage(items, total, params);
  }

  async get(id: string): Promise<Member> {
    const member = await this.repository.find(id);
    if (!member) throw notFound('Member');
    return member;
  }

  /**
   * The address is checked first, so a refused member does not use up an id; the unique index
   * still decides when two requests with the same address get past that check together.
   */
  async create(input: MemberInput): Promise<Member> {
    if (await this.repository.emailTaken(input.email)) throw invalid(EMAIL_TAKEN);
    const joinedAt = this.clock.now().toISOString().slice(0, 10);
    const member = await this.repository.create(input, joinedAt);
    if (member === 'email-taken') throw invalid(EMAIL_TAKEN);
    return member;
  }

  /** The body is checked after the lookup, so an unknown id is 404 whatever the body holds. */
  async update(id: string, body: unknown): Promise<Member> {
    await this.get(id);
    const input = parseInput(memberInputSchema, body);
    if (await this.repository.emailTaken(input.email, id)) throw invalid(EMAIL_TAKEN);
    const member = await this.repository.update(id, input);
    if (member === 'email-taken') throw invalid(EMAIL_TAKEN);
    if (member === 'not-found') throw notFound('Member');
    return member;
  }

  async remove(id: string): Promise<void> {
    const outcome = await this.repository.softDelete(id, this.clock.now());
    if (outcome === 'not-found') throw notFound('Member');
    if (outcome === 'has-bookings') {
      throw conflict('This member has upcoming bookings; cancel them first');
    }
  }
}

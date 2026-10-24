import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `email` is looked up as given: callers lower-case it, the stored emails are lower case. */
  findByEmail(email: string) {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.client.user.findUnique({ where: { id } });
  }
}

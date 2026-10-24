import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { TokenService } from '../../common/auth/token.service.js';
import { ApiError, unauthorized } from '../../common/errors/api-error.js';
import type { LoginRequest, LoginResponse, User } from '../../contract/index.js';
import { AuthRepository } from './auth.repository.js';

const toUser = ({ id, name, email, role }: User): User => ({ id, name, email, role });

@Injectable()
export class AuthService {
  // Checked when the email is unknown, so a failed login takes as long whether or not it exists.
  private decoy: Promise<string> | undefined;

  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokenService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<LoginResponse> {
    const user = await this.repository.findByEmail(email.toLowerCase());
    const hash = user?.passwordHash ?? (await this.decoyHash());
    const matches = await argon2.verify(hash, password);
    if (!user || !matches) {
      throw new ApiError(401, { message: 'Invalid email or password' });
    }
    return { token: await this.tokens.sign(user.id), user: toUser(user) };
  }

  /** A token is valid for as long as its user exists; a user that is gone is signed out. */
  async currentUser(id: string): Promise<User> {
    const user = await this.repository.findById(id);
    if (!user) throw unauthorized();
    return toUser(user);
  }

  private decoyHash(): Promise<string> {
    this.decoy ??= argon2.hash('decoy', { type: argon2.argon2id });
    return this.decoy;
  }
}

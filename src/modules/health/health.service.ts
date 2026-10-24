import { Injectable } from '@nestjs/common';
import { HealthRepository } from './health.repository.js';

@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  /** `{ status: 'ok' }` when the database answers; a database error becomes a 500. */
  async check(): Promise<{ status: 'ok' }> {
    await this.repository.ping();
    return { status: 'ok' };
  }
}

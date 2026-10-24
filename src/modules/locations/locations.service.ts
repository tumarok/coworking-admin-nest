import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { conflict, notFound } from '../../common/errors/api-error.js';
import { toPage } from '../../common/pagination/page.js';
import { parseInput } from '../../common/validation/parse-input.js';
import {
  type Location,
  type LocationInput,
  locationInputSchema,
  type Page,
} from '../../contract/index.js';
import { LocationsRepository } from './locations.repository.js';
import type { LocationListParams } from './locations.types.js';

@Injectable()
export class LocationsService {
  constructor(
    private readonly repository: LocationsRepository,
    private readonly clock: Clock,
  ) {}

  async list(params: LocationListParams): Promise<Page<Location>> {
    const { items, total } = await this.repository.list(params);
    return toPage(items, total, params);
  }

  async get(id: string): Promise<Location> {
    const location = await this.repository.find(id);
    if (!location) throw notFound('Location');
    return location;
  }

  create(input: LocationInput): Promise<Location> {
    return this.repository.create(input);
  }

  /** The body is checked after the lookup, so an unknown id is 404 whatever the body holds. */
  async update(id: string, body: unknown): Promise<Location> {
    await this.get(id);
    const input = parseInput(locationInputSchema, body);
    const location = await this.repository.update(id, input);
    if (!location) throw notFound('Location');
    return location;
  }

  async remove(id: string): Promise<void> {
    const outcome = await this.repository.softDelete(id, this.clock.now());
    if (outcome === 'not-found') throw notFound('Location');
    if (outcome === 'has-rooms') throw conflict('Remove or move the rooms of this location first');
  }
}

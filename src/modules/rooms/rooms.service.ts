import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { conflict, invalid, notFound } from '../../common/errors/api-error.js';
import { toPage } from '../../common/pagination/page.js';
import { parseInput } from '../../common/validation/parse-input.js';
import { type Page, type Room, type RoomInput, roomInputSchema } from '../../contract/index.js';
import { RoomsRepository } from './rooms.repository.js';
import type { RoomListParams } from './rooms.types.js';

const LOCATION_NOT_FOUND = { locationId: 'Location not found' };

@Injectable()
export class RoomsService {
  constructor(
    private readonly repository: RoomsRepository,
    private readonly clock: Clock,
  ) {}

  async list(params: RoomListParams): Promise<Page<Room>> {
    const { items, total } = await this.repository.list(params);
    return toPage(items, total, params);
  }

  async get(id: string): Promise<Room> {
    const room = await this.repository.find(id);
    if (!room) throw notFound('Room');
    return room;
  }

  async create(input: RoomInput): Promise<Room> {
    const room = await this.repository.create(input);
    if (room === 'no-location') throw invalid(LOCATION_NOT_FOUND);
    return room;
  }

  /** The body is checked after the lookup, so an unknown id is 404 whatever the body holds. */
  async update(id: string, body: unknown): Promise<Room> {
    await this.get(id);
    const input = parseInput(roomInputSchema, body);
    const room = await this.repository.update(id, input);
    if (room === 'no-location') throw invalid(LOCATION_NOT_FOUND);
    if (room === 'not-found') throw notFound('Room');
    return room;
  }

  async remove(id: string): Promise<void> {
    const outcome = await this.repository.softDelete(id, this.clock.now());
    if (outcome === 'not-found') throw notFound('Room');
    if (outcome === 'has-bookings') {
      throw conflict('This room has upcoming bookings; cancel them first');
    }
  }
}

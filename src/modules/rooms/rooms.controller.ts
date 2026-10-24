import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiRoute } from '../../common/openapi/api-route.js';
import {
  type Page,
  type Room,
  type RoomInput,
  roomInputSchema,
  roomListQuerySchema,
  roomPageSchema,
  roomSchema,
} from '../../contract/index.js';
import { RoomsService } from './rooms.service.js';
import type { RoomListParams } from './rooms.types.js';

@ApiTags('Rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiRoute({
    summary: 'List rooms, sorted by location name and room name',
    success: { status: 200, schema: roomPageSchema },
    failures: [422],
  })
  list(@Query({ schema: roomListQuerySchema }) query: RoomListParams): Promise<Page<Room>> {
    return this.rooms.list(query);
  }

  @Get(':id')
  @ApiRoute({
    summary: 'Get a room',
    success: { status: 200, schema: roomSchema },
    failures: [404],
  })
  get(@Param('id') id: string): Promise<Room> {
    return this.rooms.get(id);
  }

  @Post()
  @ApiRoute({
    summary: 'Create a room',
    success: { status: 201, schema: roomSchema },
    failures: [422],
  })
  create(@Body({ schema: roomInputSchema }) body: RoomInput): Promise<Room> {
    return this.rooms.create(body);
  }

  // The body is not validated by a pipe: an unknown id must be 404 before an invalid body is 422.
  @Patch(':id')
  @ApiRoute({
    summary: 'Replace the fields of a room, moving it to another location if asked',
    success: { status: 200, schema: roomSchema },
    body: roomInputSchema,
    failures: [404, 422],
  })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Room> {
    return this.rooms.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiRoute({
    summary: 'Delete a room that has no upcoming bookings',
    success: { status: 204 },
    failures: [404, 409],
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.rooms.remove(id);
  }
}

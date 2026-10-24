import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiRoute } from '../../common/openapi/api-route.js';
import {
  type Booking,
  type BookingInput,
  bookingInputSchema,
  bookingListQuerySchema,
  bookingPageSchema,
  bookingSchema,
  type Page,
} from '../../contract/index.js';
import { BookingsService } from './bookings.service.js';
import type { BookingListParams } from './bookings.types.js';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiRoute({
    summary: 'List bookings, latest start first',
    success: { status: 200, schema: bookingPageSchema },
    failures: [422],
  })
  list(
    @Query({ schema: bookingListQuerySchema }) query: BookingListParams,
  ): Promise<Page<Booking>> {
    return this.bookings.list(query);
  }

  @Get(':id')
  @ApiRoute({
    summary: 'Get a booking',
    success: { status: 200, schema: bookingSchema },
    failures: [404],
  })
  get(@Param('id') id: string): Promise<Booking> {
    return this.bookings.get(id);
  }

  @Post()
  @ApiRoute({
    summary: 'Create a pending booking if the room is free and open at that time',
    success: { status: 201, schema: bookingSchema },
    failures: [409, 422],
  })
  create(@Body({ schema: bookingInputSchema }) body: BookingInput): Promise<Booking> {
    return this.bookings.create(body);
  }

  // The body is not validated by a pipe: an unknown id must be 404, and a booking that is past
  // editing 409, before an invalid body is 422.
  @Patch(':id')
  @ApiRoute({
    summary:
      'Replace the room, member, time, attendees and notes of a pending or confirmed booking',
    success: { status: 200, schema: bookingSchema },
    body: bookingInputSchema,
    failures: [404, 409, 422],
  })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Booking> {
    return this.bookings.update(id, body);
  }
}

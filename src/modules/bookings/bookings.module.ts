import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository],
})
export class BookingsModule {}

import { Module } from '@nestjs/common';
import { MembersController } from './members.controller.js';
import { MembersRepository } from './members.repository.js';
import { MembersService } from './members.service.js';

@Module({
  controllers: [MembersController],
  providers: [MembersService, MembersRepository],
})
export class MembersModule {}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiRoute } from '../../common/openapi/api-route.js';
import {
  type Member,
  type MemberInput,
  memberInputSchema,
  memberListQuerySchema,
  memberPageSchema,
  memberSchema,
  type Page,
} from '../../contract/index.js';
import { MembersService } from './members.service.js';
import type { MemberListParams } from './members.types.js';

@ApiTags('Members')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiRoute({
    summary: 'List members, sorted by last name and first name',
    success: { status: 200, schema: memberPageSchema },
    failures: [422],
  })
  list(@Query({ schema: memberListQuerySchema }) query: MemberListParams): Promise<Page<Member>> {
    return this.members.list(query);
  }

  @Get(':id')
  @ApiRoute({
    summary: 'Get a member',
    success: { status: 200, schema: memberSchema },
    failures: [404],
  })
  get(@Param('id') id: string): Promise<Member> {
    return this.members.get(id);
  }

  @Post()
  @ApiRoute({
    summary: 'Create a member; the email must not belong to another member',
    success: { status: 201, schema: memberSchema },
    failures: [422],
  })
  create(@Body({ schema: memberInputSchema }) body: MemberInput): Promise<Member> {
    return this.members.create(body);
  }

  // The body is not validated by a pipe: an unknown id must be 404 before an invalid body is 422.
  @Patch(':id')
  @ApiRoute({
    summary: 'Replace the fields of a member; the join date stays',
    success: { status: 200, schema: memberSchema },
    body: memberInputSchema,
    failures: [404, 422],
  })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Member> {
    return this.members.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiRoute({
    summary: 'Delete a member that has no upcoming bookings',
    success: { status: 204 },
    failures: [404, 409],
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.members.remove(id);
  }
}

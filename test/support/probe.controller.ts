import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../../src/common/auth/public.decorator.js';
import { notFound, conflict } from '../../src/common/errors/api-error.js';
import { parseInput } from '../../src/common/validation/parse-input.js';
import {
  locationInputSchema,
  pageQuerySchema,
  type LocationInput,
} from '../../src/contract/index.js';

/**
 * Routes that exercise the transport rules (body, query, errors) without any business module.
 * Public, so the transport tests need no token; `ProtectedProbeController` is the guarded route.
 */
@Public()
@Controller('probe')
export class ProbeController {
  @Post('echo')
  @HttpCode(200)
  echo(@Body({ schema: locationInputSchema }) body: LocationInput) {
    return body;
  }

  @Get('page')
  page(@Query({ schema: pageQuerySchema }) query: unknown) {
    return query;
  }

  @Get('items/:id')
  find(@Param('id') id: string) {
    if (id === 'missing') throw notFound('Item');
    return { id };
  }

  // The body is parsed after the lookup, the way PATCH handlers answer 404 before 422.
  @Patch('items/:id')
  replace(@Param('id') id: string, @Body() body: unknown) {
    if (id === 'missing') throw notFound('Item');
    return parseInput(locationInputSchema, body);
  }

  @Delete('items/:id')
  @HttpCode(204)
  remove() {
    return undefined;
  }

  @Get('conflict')
  overlap() {
    throw conflict('The room is already booked for this time', {
      conflicts: [{ id: 'bk_1', startsAt: '2026-11-03T09:00:00Z', endsAt: '2026-11-03T10:00:00Z' }],
    });
  }

  @Get('boom')
  boom() {
    throw new Error('database password is hunter2');
  }
}

/** A route behind the global guard, to show that routes are protected unless marked public. */
@Controller('probe-protected')
export class ProtectedProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

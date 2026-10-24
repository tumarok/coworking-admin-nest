import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiRoute } from '../../common/openapi/api-route.js';
import {
  type Location,
  type LocationInput,
  locationInputSchema,
  locationListQuerySchema,
  locationPageSchema,
  locationSchema,
  type Page,
} from '../../contract/index.js';
import { LocationsService } from './locations.service.js';
import type { LocationListParams } from './locations.types.js';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiRoute({
    summary: 'List locations, sorted by name',
    success: { status: 200, schema: locationPageSchema },
    failures: [422],
  })
  list(
    @Query({ schema: locationListQuerySchema }) query: LocationListParams,
  ): Promise<Page<Location>> {
    return this.locations.list(query);
  }

  @Get(':id')
  @ApiRoute({
    summary: 'Get a location',
    success: { status: 200, schema: locationSchema },
    failures: [404],
  })
  get(@Param('id') id: string): Promise<Location> {
    return this.locations.get(id);
  }

  @Post()
  @ApiRoute({
    summary: 'Create a location',
    success: { status: 201, schema: locationSchema },
    failures: [422],
  })
  create(@Body({ schema: locationInputSchema }) body: LocationInput): Promise<Location> {
    return this.locations.create(body);
  }

  // The body is not validated by a pipe: an unknown id must be 404 before an invalid body is 422.
  @Patch(':id')
  @ApiRoute({
    summary: 'Replace the fields of a location',
    success: { status: 200, schema: locationSchema },
    body: locationInputSchema,
    failures: [404, 422],
  })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Location> {
    return this.locations.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiRoute({
    summary: 'Delete a location that has no rooms',
    success: { status: 204 },
    failures: [404, 409],
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.locations.remove(id);
  }
}

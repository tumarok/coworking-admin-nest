import * as z from 'zod';
import {
  apiErrorSchema,
  locationInputSchema,
  locationPageSchema,
  locationSchema,
  loginRequestSchema,
  loginResponseSchema,
  userSchema,
} from '../../contract/index.js';

/**
 * Contract schemas that appear in the OpenAPI document as named components. A module adds its
 * schemas here; any other schema is inlined where it is used.
 */
const COMPONENTS = {
  ApiError: apiErrorSchema,
  User: userSchema,
  LoginRequest: loginRequestSchema,
  LoginResponse: loginResponseSchema,
  Location: locationSchema,
  LocationInput: locationInputSchema,
  LocationPage: locationPageSchema,
};

// Zod throws when an id is taken, so a clash shows up at startup.
for (const [id, schema] of Object.entries(COMPONENTS)) z.globalRegistry.add(schema, { id });

/** An empty registry makes `toJSONSchema` ignore the component ids and inline every schema. */
const NO_COMPONENTS = z.registry<{ id?: string }>();

/** The schema as a self-contained JSON Schema object, for places that cannot reference a component. */
export const inlineSchema = (schema: z.ZodType, io: 'input' | 'output' = 'input') =>
  z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    metadata: NO_COMPONENTS,
    unrepresentable: 'any',
  });

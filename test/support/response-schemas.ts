import type * as z from 'zod';
import {
  apiErrorSchema,
  bookingPageSchema,
  bookingSchema,
  bulkBookingResultSchema,
  dashboardSchema,
  locationPageSchema,
  locationSchema,
  loginResponseSchema,
  memberPageSchema,
  memberSchema,
  roomPageSchema,
  roomSchema,
  userSchema,
} from '../../src/contract/index.js';

interface RouteSchema {
  method: string;
  /** The OpenAPI path template below the API prefix. */
  path: string;
  /** The body of the success response; `null` for a route that answers 204 without a body. */
  success: z.ZodType | null;
}

// Every route of the API with the schema its success body has to pass.
export const ROUTE_SCHEMAS: readonly RouteSchema[] = [
  { method: 'POST', path: '/auth/login', success: loginResponseSchema },
  { method: 'GET', path: '/auth/me', success: userSchema },
  { method: 'POST', path: '/__reset', success: null },
  { method: 'GET', path: '/dashboard', success: dashboardSchema },
  { method: 'GET', path: '/locations', success: locationPageSchema },
  { method: 'GET', path: '/locations/{id}', success: locationSchema },
  { method: 'POST', path: '/locations', success: locationSchema },
  { method: 'PATCH', path: '/locations/{id}', success: locationSchema },
  { method: 'DELETE', path: '/locations/{id}', success: null },
  { method: 'GET', path: '/rooms', success: roomPageSchema },
  { method: 'GET', path: '/rooms/{id}', success: roomSchema },
  { method: 'POST', path: '/rooms', success: roomSchema },
  { method: 'PATCH', path: '/rooms/{id}', success: roomSchema },
  { method: 'DELETE', path: '/rooms/{id}', success: null },
  { method: 'GET', path: '/members', success: memberPageSchema },
  { method: 'GET', path: '/members/{id}', success: memberSchema },
  { method: 'POST', path: '/members', success: memberSchema },
  { method: 'PATCH', path: '/members/{id}', success: memberSchema },
  { method: 'DELETE', path: '/members/{id}', success: null },
  { method: 'GET', path: '/bookings', success: bookingPageSchema },
  { method: 'POST', path: '/bookings/bulk', success: bulkBookingResultSchema },
  { method: 'GET', path: '/bookings/{id}', success: bookingSchema },
  { method: 'POST', path: '/bookings', success: bookingSchema },
  { method: 'PATCH', path: '/bookings/{id}', success: bookingSchema },
  { method: 'POST', path: '/bookings/{id}/status', success: bookingSchema },
];

const matches = (template: string, path: string) =>
  new RegExp(`^${template.replace('{id}', '[^/]+')}$`).test(path);

/**
 * The schema the body of an answer has to pass: the error shape for a failure (and for a request
 * no route takes), the route's schema for a success, `null` when the answer has no body.
 */
export const schemaOf = (method: string, path: string, status: number): z.ZodType | null => {
  if (status >= 400) return apiErrorSchema;
  const bare = path.replace(/(?<=.)\/$/, '');
  const route = ROUTE_SCHEMAS.find((r) => r.method === method && matches(r.path, bare));
  if (!route) throw new Error(`No schema for ${method} ${path}`);
  return route.success;
};

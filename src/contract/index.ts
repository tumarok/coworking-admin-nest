/**
 * The API contract shared with the frontends. Types are derived from the schemas, so request
 * handling, responses and tests cannot drift apart without a compile error.
 */
export * from './auth.js';
export * from './booking.js';
export * from './common.js';
export * from './dashboard.js';
export * from './location.js';
export * from './member.js';
export * from './room.js';

/**
 * Every feature module is mounted below this path with `RouterModule`. A global prefix would not do:
 * Nest answers unknown routes only below it, and the API answers them everywhere.
 */
export const API_PREFIX = 'api/v1';

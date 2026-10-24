import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Opts a route (or a controller) out of the global `AuthGuard`: login, health and reset. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

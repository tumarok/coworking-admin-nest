import type * as z from 'zod';
import type { dashboardQuerySchema } from '../../contract/index.js';

/** The dashboard query after validation: the day is left out when the request names none. */
export type DashboardParams = z.output<typeof dashboardQuerySchema>;

import type { Page } from '../../contract/index.js';

/** The `page` and `limit` of a list request, after the query schema has applied its defaults. */
export interface PageRequest {
  page: number;
  limit: number;
}

/** Rows to skip before the requested page (`page` counts from 1). */
export const pageOffset = ({ page, limit }: PageRequest): number => (page - 1) * limit;

/** A page as the API returns it: `total` counts every match, not only the rows of this page. */
export const toPage = <T>(items: T[], total: number, { page, limit }: PageRequest): Page<T> => ({
  items,
  total,
  page,
  limit,
});

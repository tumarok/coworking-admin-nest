/**
 * Query parser for Express: a repeated key keeps its last value and nothing is nested, so
 * `a[b]=1` is simply the key `a[b]`.
 */
export const parseQuery = (queryString: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(queryString));

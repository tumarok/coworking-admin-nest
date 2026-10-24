import { invalid } from '../errors/api-error.js';

/** The part of a Standard Schema issue that is needed here; Zod issues satisfy it. */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

const segment = (key: PropertyKey | { readonly key: PropertyKey }): string =>
  String(typeof key === 'object' ? key.key : key);

/** One message per field: the first issue of a path wins, and an empty path is the whole body (`_`). */
export const issuesToFieldErrors = (issues: readonly SchemaIssue[]): Record<string, string> => {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = (issue.path ?? []).map(segment).join('.') || '_';
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
};

export const invalidFromIssues = (issues: readonly SchemaIssue[]) =>
  invalid(issuesToFieldErrors(issues));

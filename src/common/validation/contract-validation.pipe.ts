import { type ArgumentMetadata, StandardSchemaValidationPipe } from '@nestjs/common';
import { invalidFromIssues } from './field-errors.js';

const withoutEmptyValues = (query: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));

/**
 * Validates `@Body`, `@Query` and `@Param` values that carry a contract schema and answers 422 in
 * the format of the API. An empty query value means "no filter", so it is dropped before parsing.
 */
export class ContractValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({ exceptionFactory: invalidFromIssues });
  }

  override transform<T = unknown>(value: T, metadata: ArgumentMetadata): Promise<T> {
    const input =
      metadata.type === 'query' && typeof value === 'object' && value !== null
        ? (withoutEmptyValues(value as Record<string, unknown>) as T)
        : value;
    return super.transform(input, metadata);
  }
}

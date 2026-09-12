/**
 * Typed Domain Error hierarchy for Clean Architecture.
 * Replaces untyped exceptions with explicit, inspectable error codes.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly isRetryable: boolean;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly isRetryable = false;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class EntityNotFoundError extends DomainError {
  readonly code = 'ENTITY_NOT_FOUND';
  readonly isRetryable = false;
  constructor(entityName: string, entityId: string) {
    super(`${entityName} with identifier "${entityId}" was not found.`, { entityName, entityId });
  }
}

export class RepositoryError extends DomainError {
  readonly code = 'REPOSITORY_ERROR';
  readonly isRetryable: boolean;
  constructor(message: string, isRetryable = false, details?: Record<string, unknown>) {
    super(message, details);
    this.isRetryable = isRetryable;
  }
}

export class ExternalServiceError extends DomainError {
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly isRetryable: boolean;
  constructor(serviceName: string, message: string, isRetryable = true, details?: Record<string, unknown>) {
    super(`External service "${serviceName}" failure: ${message}`, details);
    this.isRetryable = isRetryable;
  }
}

export class ConcurrencyError extends DomainError {
  readonly code = 'CONCURRENCY_CONFLICT';
  readonly isRetryable = true;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

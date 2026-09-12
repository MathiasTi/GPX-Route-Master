/**
 * Core Result Pattern implementation for defensive programming.
 * Guarantees explicit type-safe error handling without throwing unchecked exceptions.
 */

export type Result<T, E extends Error = Error> =
  | { readonly success: true; readonly data: T; readonly error?: never }
  | { readonly success: false; readonly error: E; readonly data?: never };

/**
 * Creates a successful Result wrapping the provided data.
 */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * Creates a failure Result wrapping the provided error.
 */
export function err<E extends Error>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Type guard for successful Result.
 */
export function isOk<T, E extends Error>(
  result: Result<T, E>
): result is { readonly success: true; readonly data: T } {
  return result.success;
}

/**
 * Type guard for failure Result.
 */
export function isErr<T, E extends Error>(
  result: Result<T, E>
): result is { readonly success: false; readonly error: E } {
  return !result.success;
}

/**
 * Maps the success value using fn, preserving any error.
 */
export function mapOk<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (val: T) => U
): Result<U, E> {
  if (result.success) {
    return ok(fn(result.data));
  }
  return err(result.error);
}

import { Result, ok, err } from '../core/result';

/**
 * Custom error representing serialization failures.
 */
export class SerializationError extends Error {
  readonly code: 'CYCLIC_STRUCTURE' | 'SERIALIZATION_FAILED';

  constructor(message: string, code: 'CYCLIC_STRUCTURE' | 'SERIALIZATION_FAILED' = 'SERIALIZATION_FAILED') {
    super(message);
    this.name = 'SerializationError';
    this.code = code;
  }
}

export type CustomReplacer = (key: string, value: unknown) => unknown;

/**
 * Creates an intelligent cycle-breaking replacer for JSON.stringify.
 * Tracks ancestor objects in the current traversal stack so that shared non-cyclic
 * references (DAGs) are preserved, while true circular references are safely sanitized.
 */
function createSafeReplacer(customReplacer?: CustomReplacer | null): (this: unknown, key: string, value: unknown) => unknown {
  const stack: unknown[] = [];

  return function (this: unknown, key: string, value: unknown): unknown {
    // 1. Handle BigInt values (native JSON.stringify throws TypeError on BigInt)
    if (typeof value === 'bigint') {
      return value.toString();
    }

    // 2. Cycle detection on objects and non-null values
    if (typeof value === 'object' && value !== null) {
      // Find position of current container ('this') in stack
      const thisPos = stack.indexOf(this);
      if (thisPos !== -1) {
        // Pop any siblings/children that were finished
        stack.splice(thisPos + 1);
      }

      // If value is already in the active ancestor stack, it's a cyclic structure
      if (stack.includes(value)) {
        return '[Circular]';
      }

      // Check for browser DOM Node / Window instances if in DOM environment
      if (typeof Node !== 'undefined' && value instanceof Node) {
        return '[DOM Node]';
      }
      if (typeof Window !== 'undefined' && value instanceof Window) {
        return '[Window]';
      }

      stack.push(value);
    }

    // 3. Delegate to optional user-defined replacer
    if (customReplacer) {
      return customReplacer(key, value);
    }

    return value;
  };
}

/**
 * Safely converts a JavaScript value to a JSON string using Result-Pattern.
 * Completely immune to "JSON.stringify cannot serialize cyclic structures" / "Converting circular structure to JSON".
 */
export function safeJsonStringify(
  value: unknown,
  customReplacer?: CustomReplacer | null,
  space?: string | number
): Result<string, SerializationError> {
  try {
    const replacer = createSafeReplacer(customReplacer);
    const result = JSON.stringify(value, replacer as any, space);
    return ok(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isCyclic = msg.toLowerCase().includes('cyclic') || msg.toLowerCase().includes('circular');
    return err(new SerializationError(msg, isCyclic ? 'CYCLIC_STRUCTURE' : 'SERIALIZATION_FAILED'));
  }
}

/**
 * Serializes value or returns fallback on any error, guaranteed never to throw.
 */
export function safeStringifyOrFallback(
  value: unknown,
  fallback = '{}',
  customReplacer?: CustomReplacer | null,
  space?: string | number
): string {
  const res = safeJsonStringify(value, customReplacer, space);
  if (res.success && res.data !== undefined) {
    return res.data;
  }
  return fallback;
}

/**
 * Defensive JSON parse that returns a Result wrapping the parsed value or fallback.
 */
export function safeJsonParse<T>(
  jsonStr: string | null | undefined,
  fallback: T
): Result<T, Error> {
  if (!jsonStr || typeof jsonStr !== 'string') {
    return ok(fallback);
  }
  try {
    const parsed = JSON.parse(jsonStr) as T;
    return ok(parsed);
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    return err(errObj);
  }
}

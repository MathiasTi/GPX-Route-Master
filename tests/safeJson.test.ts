import { safeJsonStringify, safeStringifyOrFallback, safeJsonParse } from '../domain/serialization/safeJson';

export function runSafeJsonTests(): boolean {
  console.log('🔄 Running Safe JSON & Circular Reference Serialization Tests...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Primitive and plain objects
  const simpleObj = { name: 'Alpe d Huez', elevation: 1850, tags: ['climb', 'alps'] };
  const simpleRes = safeJsonStringify(simpleObj);
  assert(simpleRes.success && simpleRes.data.includes('Alpe d Huez'), 'Serializes standard plain object');

  // 2. DAG (Directed Acyclic Graph) with shared references
  const sharedCoord = { lat: 45.09, lng: 6.06 };
  const dagObj = {
    start: sharedCoord,
    end: sharedCoord,
    waypoints: [sharedCoord, { lat: 45.10, lng: 6.07 }]
  };
  const dagRes = safeJsonStringify(dagObj);
  assert(dagRes.success && !dagRes.data.includes('[Circular]'), 'Preserves shared non-cyclic references without false circularity');

  // 3. Direct circular reference: a.self = a
  const selfCyclic: Record<string, unknown> = { id: 'track-cycle' };
  selfCyclic.self = selfCyclic;
  const selfRes = safeJsonStringify(selfCyclic);
  assert(selfRes.success, 'Serializes direct circular reference without throwing');
  assert(selfRes.success && selfRes.data.includes('[Circular]'), 'Replaces direct cyclic reference with [Circular]');

  // 4. Deep indirect circular reference: a.b.c = a
  interface NestedNode {
    id: string;
    child?: NestedNode;
    parent?: NestedNode;
  }
  const rootNode: NestedNode = { id: 'root' };
  const childNode: NestedNode = { id: 'child', parent: rootNode };
  rootNode.child = childNode;
  const deepRes = safeJsonStringify(rootNode);
  assert(deepRes.success, 'Serializes deep indirect circular reference without throwing');
  assert(deepRes.success && deepRes.data.includes('[Circular]'), 'Deep circular reference sanitized');

  // 5. Array containing circular reference
  const cyclicArray: unknown[] = [1, 2];
  cyclicArray.push(cyclicArray);
  const arrRes = safeJsonStringify(cyclicArray);
  assert(arrRes.success && arrRes.data.includes('[Circular]'), 'Array self-reference properly sanitized');

  // 6. BigInt handling
  const bigIntObj = { count: BigInt(9007199254740991), label: 'max' };
  const bigIntRes = safeJsonStringify(bigIntObj);
  assert(bigIntRes.success && bigIntRes.data.includes('9007199254740991'), 'Converts BigInt to string safely without throw');

  // 7. safeStringifyOrFallback
  const fallbackDirect = safeStringifyOrFallback(selfCyclic, '{}');
  assert(typeof fallbackDirect === 'string' && fallbackDirect.includes('track-cycle'), 'safeStringifyOrFallback returns sanitized string');

  // 8. safeJsonParse valid JSON
  const parsedOk = safeJsonParse('{"a":1,"b":"hello"}', {});
  assert(parsedOk.success && (parsedOk.data as { a: number }).a === 1, 'safeJsonParse parses valid JSON');

  // 9. safeJsonParse invalid JSON
  const parsedErr = safeJsonParse('{invalid_json', { fallback: true });
  assert(!parsedErr.success, 'safeJsonParse returns err for invalid JSON');

  // 10. safeJsonParse null/undefined
  const parsedNull = safeJsonParse(null, []);
  assert(parsedNull.success && Array.isArray(parsedNull.data), 'safeJsonParse handles null with fallback');

  console.log(`Safe JSON Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}

// The bits of node:test and node:assert the tests use; @types/node isn't
// installed (npm test runs the .test.ts files under plain Node).
declare module 'node:test' {
  export function test(name: string, fn: () => void): void;
}
declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
  };
  export default assert;
}

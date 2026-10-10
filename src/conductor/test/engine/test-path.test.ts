// Covers: task:1
import { describe, expect, it } from 'vitest';
import { isTestPath } from '../../src/engine/gate-invalidation.js';
import { classifyTautologyPaths } from '../../src/engine/build-review-test-quality-preflight.js';

describe('engine/test-path', () => {
  it.each([
    ['test/a.ts', true],
    ['tests/unit/runner.spec.mts', true],
    ['spec/models/widget_test.rb', true],
    ['src/__tests__/helper.ts', true],
    ['src/a.test.ts', true],
    ['src/a.spec.ts', true],
    ['Tests/Foo.cs', true],
    ['src/a.ts', false],
    ['scripts/test_a.sh', false],
    ['pkg/a_test.go', false],
  ])('shares the convention for %s', (path, expected) => {
    const classified = classifyTautologyPaths([path]);
    expect(isTestPath(path)).toBe(expected);
    expect(classified.tests.includes(path) || classified.testSupport.includes(path)).toBe(expected);
  });
});

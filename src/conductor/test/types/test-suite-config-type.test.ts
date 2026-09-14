// Covers: task:1
import { expect, it } from 'vitest';
import { compileTypeFixture } from './compile-type-fixture.js';

it('accepts an ordered test_suite.commands list on HarnessConfig', () => {
  const result = compileTypeFixture('test/types/fixtures/test-suite-commands-positive.fixture.ts');

  expect(result.status, result.stderr).toBe(0);
});

it.each([
  ['suite names', 'test/types/fixtures/test-suite-commands-suite-name-negative.fixture.ts'],
  ['runner identifiers', 'test/types/fixtures/test-suite-commands-runner-identifier-negative.fixture.ts'],
])('rejects command entries with %s', (_description, fixture) => {
  const result = compileTypeFixture(fixture);

  expect(result.status, result.stderr).not.toBe(0);
});

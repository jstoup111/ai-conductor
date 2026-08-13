import { expect, it } from 'vitest';
import { compileTypeFixture } from './compile-type-fixture.js';

it('compiles only the optional boolean cumulative kickback bound block', () => {
  const result = compileTypeFixture('test/types/fixtures/cumulative-kickback-bound-config.fixture.ts');

  expect(result.status, result.stderr).toBe(0);
});

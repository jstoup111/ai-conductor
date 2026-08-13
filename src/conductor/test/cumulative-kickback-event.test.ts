import { expect, it } from 'vitest';
import type { ConductorEvent } from '../src/types/events.js';
import { compileTypeFixture } from './types/compile-type-fixture.js';

it('keeps count-only kickback consumers compatible with cumulativeCount events', () => {
  const result = compileTypeFixture('test/types/fixtures/cumulative-kickback-event.fixture.ts');
  const readCount = (event: Pick<Extract<ConductorEvent, { type: 'kickback' }>, 'count'>) => event.count;
  const event: Extract<ConductorEvent, { type: 'kickback' }> = {
    type: 'kickback', from: 'build', to: 'build_review', count: 3, cumulativeCount: 7,
  };

  expect(result.status, result.stderr).toBe(0);
  expect(readCount(event)).toBe(3);
});

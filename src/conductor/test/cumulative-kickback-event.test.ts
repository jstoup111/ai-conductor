import { describe, expect, it } from 'vitest';
import type { ConductorEvent } from '../src/types/events.js';

describe('kickback event cumulative count', () => {
  it('accepts an optional cumulative count without changing count-only consumers', () => {
    const event = {
      type: 'kickback',
      from: 'build_review',
      to: 'build',
      count: 1,
      cumulativeCount: 3,
    } satisfies Extract<ConductorEvent, { type: 'kickback' }>;

    const countOnlyConsumer = ({ count }: Extract<ConductorEvent, { type: 'kickback' }>) => count;

    expect(countOnlyConsumer(event)).toBe(1);
  });
});

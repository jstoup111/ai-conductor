import type { ConductorEvent } from '../src/types/events.js';
import { expectTypeOf, it } from 'vitest';

it('typechecks cumulativeCount on the imported kickback event', () => {
  expectTypeOf<Extract<ConductorEvent, { type: 'kickback' }>>().toHaveProperty('cumulativeCount');
});

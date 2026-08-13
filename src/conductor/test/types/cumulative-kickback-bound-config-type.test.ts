import type { HarnessConfig } from '../../src/types/config.js';
import { expectTypeOf, it } from 'vitest';

it('typechecks the imported cumulative kickback bound configuration', () => {
  expectTypeOf<HarnessConfig>().toHaveProperty('cumulative_kickback_bound');
});

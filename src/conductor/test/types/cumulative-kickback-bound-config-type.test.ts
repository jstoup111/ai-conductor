import { describe, expect, it } from 'vitest';
import type { HarnessConfig } from '../../src/types/config.js';

describe('cumulative kickback bound config type', () => {
  it('allows the optional enabled kill-switch block', () => {
    const config: HarnessConfig = {
      cumulative_kickback_bound: { enabled: false },
    };

    expect(config.cumulative_kickback_bound).toEqual({ enabled: false });
  });
});

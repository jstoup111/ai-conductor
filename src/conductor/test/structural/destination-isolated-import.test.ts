// Covers: task:12
import { describe, expect, it, vi } from 'vitest';

import { CONDUCTOR_DECOMPOSED_MODULES } from './conductor-shape-guard.js';

describe('conductor decomposition destinations', () => {
  it.each(CONDUCTOR_DECOMPOSED_MODULES.filter((path) => path !== 'engine/conductor.ts'))(
    'loads %s independently with every runtime export defined',
    async (modulePath) => {
      vi.resetModules();

      const destination = new URL(`../../src/${modulePath.replace(/\.ts$/, '.js')}`, import.meta.url).href;
      const module = await import(destination);
      for (const value of Object.values(module)) expect(value).not.toBeUndefined();
    },
  );
});

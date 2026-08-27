import { describe, expect, it } from 'vitest';
import { CONFIG_CONSUMER_KEY_SETS } from '../../src/engine/config.js';
import {
  assertRegistryCovers,
  configConsumerRegistry,
} from '../../src/engine/config-consumer-registry.js';

describe('config consumer registry', () => {
  it('is total over validator-accepted keys', () => {
    expect(() => assertRegistryCovers(CONFIG_CONSUMER_KEY_SETS, configConsumerRegistry)).not.toThrow();
  });

  it('fails for an undeclared accepted key', () => {
    expect(() => assertRegistryCovers({ top: ['present'] }, {})).toThrow('Config key is undeclared: present');
  });

  it('fails for an unresolvable consumer module', () => {
    expect(() => assertRegistryCovers({ top: ['present'] }, {
      present: { consumer: 'missing/module.ts' },
    })).toThrow('Config key present has unresolvable consumer: missing/module.ts');
  });

  it('fails for an orphaned declaration', () => {
    expect(() => assertRegistryCovers({ top: [] }, {
      gone: { consumer: 'none', reason: 'inert until migration removal' },
    })).toThrow('Config-key declaration is orphaned: gone');
  });
});

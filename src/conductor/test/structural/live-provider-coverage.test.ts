import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import { SMOKE_CAPABILITIES } from '../../src/engine/smoke-capability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const CREDENTIALED_CAPABILITY_PREFIX = 'credentialed:';

describe('structural: live provider coverage', () => {
  it('gives every registered LLM provider a live leg and capability entry', () => {
    const registry = new PluginRegistry();
    registerBuiltins(registry, new ConductorEventEmitter(), () => {});

    const registeredProviders = registry.list('llm_provider').sort();
    const liveLegProviders = LIVE_E2E_PROVIDERS.map(({ id }) => id).sort();
    const capabilityProviders = SMOKE_CAPABILITIES
      .filter((capability) => capability.startsWith(CREDENTIALED_CAPABILITY_PREFIX))
      .map((capability) => capability.slice(CREDENTIALED_CAPABILITY_PREFIX.length))
      .sort();

    expect({ liveLegProviders, capabilityProviders }).toEqual({
      liveLegProviders: registeredProviders,
      capabilityProviders: registeredProviders,
    });
  });
});

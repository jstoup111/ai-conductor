import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import { SMOKE_CAPABILITIES } from '../../src/engine/smoke-capability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const CREDENTIALED_CAPABILITY_PREFIX = 'credentialed:';

function assertLiveProviderCoverage(
  registeredProviders: readonly string[],
  liveLegProviders: readonly string[],
  capabilityProviders: readonly string[],
): void {
  for (const provider of registeredProviders) {
    if (!liveLegProviders.includes(provider)) {
      throw new Error(`Registered LLM provider ${provider} has no live E2E leg`);
    }
    if (!capabilityProviders.includes(provider)) {
      throw new Error(`Live E2E leg ${provider} has no credentialed smoke capability`);
    }
  }

  for (const provider of liveLegProviders) {
    if (!registeredProviders.includes(provider)) {
      throw new Error(`Live E2E leg ${provider} has no registered LLM provider`);
    }
  }

  for (const provider of capabilityProviders) {
    if (!registeredProviders.includes(provider)) {
      throw new Error(`Credentialed smoke capability ${provider} has no registered LLM provider`);
    }
  }
}

function currentCoverageInputs(): {
  registeredProviders: string[];
  liveLegProviders: string[];
  capabilityProviders: string[];
} {
  const registry = new PluginRegistry();
  registerBuiltins(registry, new ConductorEventEmitter(), () => {});

  return {
    registeredProviders: registry.list('llm_provider').sort(),
    liveLegProviders: LIVE_E2E_PROVIDERS.map(({ id }) => id).sort(),
    capabilityProviders: SMOKE_CAPABILITIES
      .filter((capability) => capability.startsWith(CREDENTIALED_CAPABILITY_PREFIX))
      .map((capability) => capability.slice(CREDENTIALED_CAPABILITY_PREFIX.length))
      .sort(),
  };
}

describe('structural: live provider coverage', () => {
  it('gives every registered LLM provider a live leg and capability entry', () => {
    const { registeredProviders, liveLegProviders, capabilityProviders } = currentCoverageInputs();

    expect(() => assertLiveProviderCoverage(
      registeredProviders,
      liveLegProviders,
      capabilityProviders,
    )).not.toThrow();
  });

  it('names a registered provider with no live leg', () => {
    expect(() => assertLiveProviderCoverage(
      ['claude', 'codex'],
      ['claude'],
      ['claude', 'codex'],
    )).toThrow('Registered LLM provider codex has no live E2E leg');
  });

  it('names a live leg with no capability entry', () => {
    expect(() => assertLiveProviderCoverage(
      ['claude', 'codex'],
      ['claude', 'codex'],
      ['claude'],
    )).toThrow('Live E2E leg codex has no credentialed smoke capability');
  });

  it('names a live leg left behind for an unregistered provider', () => {
    expect(() => assertLiveProviderCoverage(
      ['claude'],
      ['claude', 'codex'],
      ['claude', 'codex'],
    )).toThrow('Live E2E leg codex has no registered LLM provider');
  });

  it('passes without live-provider credentials', () => {
    const credentials = new Map(LIVE_E2E_PROVIDERS.map(
      ({ credentialEnvVar }) => [credentialEnvVar, process.env[credentialEnvVar]],
    ));

    try {
      for (const credentialEnvVar of credentials.keys()) delete process.env[credentialEnvVar];
      const { registeredProviders, liveLegProviders, capabilityProviders } = currentCoverageInputs();
      expect(() => assertLiveProviderCoverage(
        registeredProviders,
        liveLegProviders,
        capabilityProviders,
      )).not.toThrow();
    } finally {
      for (const [credentialEnvVar, credential] of credentials) {
        if (credential === undefined) delete process.env[credentialEnvVar];
        else process.env[credentialEnvVar] = credential;
      }
    }
  });
});

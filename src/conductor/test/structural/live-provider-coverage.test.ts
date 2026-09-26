// Covers: task:20
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILT_IN_PROVIDERS } from '../../src/execution/provider-catalog.js';
import { LIVE_E2E_PROVIDERS } from '../../src/engine/live-e2e-providers.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import { SMOKE_CAPABILITIES } from '../../src/engine/smoke-capability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));

function providersRequiringLiveCoverage(registry: PluginRegistry): string[] {
  return [...new Set([
    ...BUILT_IN_PROVIDERS.map(({ id }) => id),
    ...registry.list('llm_provider'),
  ])].sort();
}

describe('structural: live provider coverage', () => {
  // Covers: task:20
  it('keeps every catalog provider, descriptor, credentialed capability, and smoke leg in one mapping without discovery', async () => {
    const registry = new PluginRegistry();
    registerBuiltins(registry, new ConductorEventEmitter(), undefined, undefined, 10, new Set());
    const enginePath = join(structuralRoot, '../engine');
    const legNames = (await readdir(enginePath))
      .filter((name) => /^daemon-e2e-live-.*\.smoke\.test\.ts$/.test(name))
      .sort();
    const legs = await Promise.all(legNames.map(async (name) => ({
      file: name,
      source: await readFile(join(enginePath, name), 'utf8'),
    })));

    expect({
      registeredProviders: registry.list('llm_provider').sort(),
      providersRequiringCoverage: providersRequiringLiveCoverage(registry),
      descriptors: LIVE_E2E_PROVIDERS.map(({ id, providerKey, credentialEnvVar }) => ({
        id,
        providerKey,
        credentialEnvVar,
      })),
      credentialedCapabilities: SMOKE_CAPABILITIES.filter((capability) => capability.startsWith('credentialed:')),
      legs: legs.map(({ file, source }) => ({
        file,
        capability: source.match(/^const smokeCapability = '(credentialed:[a-z]+)';$/m)?.[1],
        providerIndex: Number(source.match(/LIVE_E2E_PROVIDERS\[(\d+)]/)?.[1]),
        delegatesToSharedBody: /import\s*\{\s*defineLiveE2EProviderSmoke,?\s*}\s*from\s*'\.\.\/fixtures\/live-e2e-run-body\.js';/s.test(source) &&
          /^defineLiveE2EProviderSmoke\(provider\);$/m.test(source),
      })),
    }).toEqual({
      registeredProviders: [],
      providersRequiringCoverage: ['claude', 'codex', 'pi'],
      descriptors: [
        { id: 'claude', providerKey: 'claude', credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN' },
        { id: 'codex', providerKey: 'codex', credentialEnvVar: 'CODEX_API_KEY' },
        { id: 'pi', providerKey: 'pi', credentialEnvVar: 'PI_API_KEY' },
      ],
      credentialedCapabilities: ['credentialed:claude', 'credentialed:codex', 'credentialed:pi'],
      legs: [
        {
          file: 'daemon-e2e-live-claude.smoke.test.ts',
          capability: 'credentialed:claude',
          providerIndex: 0,
          delegatesToSharedBody: true,
        },
        {
          file: 'daemon-e2e-live-codex.smoke.test.ts',
          capability: 'credentialed:codex',
          providerIndex: 1,
          delegatesToSharedBody: true,
        },
        {
          file: 'daemon-e2e-live-pi.smoke.test.ts',
          capability: 'credentialed:pi',
          providerIndex: 2,
          delegatesToSharedBody: false,
        },
      ],
    });
  });

  // Covers: task:20
  it('includes registered external providers in the live-coverage enumeration', () => {
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'fixture-live-provider', { invoke: async () => ({}) });

    expect(providersRequiringLiveCoverage(registry)).toEqual([
      'claude',
      'codex',
      'fixture-live-provider',
      'pi',
    ]);
  });
});

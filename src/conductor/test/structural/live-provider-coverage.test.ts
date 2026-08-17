import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import { SMOKE_CAPABILITIES } from '../../src/engine/smoke-capability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';

const structuralRoot = dirname(fileURLToPath(import.meta.url));

describe('structural: live provider coverage', () => {
  it('keeps every shipped provider, descriptor, credentialed capability, and smoke leg in one mapping', async () => {
    const registry = new PluginRegistry();
    registerBuiltins(registry, new ConductorEventEmitter(), () => {});
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
      registeredProviders: ['claude', 'codex'],
      descriptors: [
        { id: 'claude', providerKey: 'claude', credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN' },
        { id: 'codex', providerKey: 'codex', credentialEnvVar: 'CODEX_API_KEY' },
      ],
      credentialedCapabilities: ['credentialed:claude', 'credentialed:codex'],
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
      ],
    });
  });
});
